import pathlib
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from billing_service import (
    capture_generation_hold,
    create_generation_hold,
    create_video_generation_hold,
    refund_generation_hold,
)
from models import Base, CreditTransaction, User
from pricing import calculate_video_generation_cost


class BillingSettlementAtomicityTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = pathlib.Path(self.temp_dir.name) / "settlement.db"
        self.engine = create_engine(
            f"sqlite:///{database_path}",
            connect_args={"check_same_thread": False, "timeout": 10},
        )
        self.Session = sessionmaker(
            bind=self.engine,
            autocommit=False,
            autoflush=False,
        )
        Base.metadata.create_all(bind=self.engine)

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _create_hold(self, *, email: str, request_id: str, idempotency_key: str):
        with self.Session() as db:
            user = User(email=email, hashed_password="hashed", credits=300)
            db.add(user)
            db.commit()
            db.refresh(user)
            hold = create_generation_hold(
                db,
                user,
                resolution="2K",
                num_images=1,
                request_id=request_id,
                idempotency_key=idempotency_key,
            )
            db.commit()
            return user.id, hold.id

    def _settle(self, hold_id: int, operation: str, barrier: threading.Barrier):
        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            barrier.wait(timeout=5)
            if operation == "capture":
                settlement = capture_generation_hold(db, hold)
            else:
                settlement = refund_generation_hold(
                    db,
                    hold,
                    error_code="UPSTREAM_FAILED",
                    error_message="provider failed",
                )
            result = settlement.id, settlement.type
            db.commit()
            return result

    def _reserve_video(self, user_id: int, barrier: threading.Barrier):
        with self.Session() as db:
            user = db.get(User, user_id)
            barrier.wait(timeout=5)
            hold = create_video_generation_hold(
                db,
                user,
                duration_seconds=5,
                resolution="720p",
                request_id="video-race-request",
                idempotency_key="video-race-idempotency",
                selected_model="seedance-2.0",
            )
            hold_id = hold.id
            db.commit()
            return hold_id

    def _run_concurrently(self, hold_id: int, *operations: str):
        barrier = threading.Barrier(len(operations))
        with ThreadPoolExecutor(max_workers=len(operations)) as executor:
            futures = [
                executor.submit(self._settle, hold_id, operation, barrier)
                for operation in operations
            ]
            return [future.result(timeout=15) for future in futures]

    def test_repeated_capture_and_refund_return_the_same_settlement(self):
        user_id, hold_id = self._create_hold(
            email="repeat@example.com",
            request_id="same-request",
            idempotency_key="repeat-hold",
        )

        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            first = capture_generation_hold(db, hold)
            second = capture_generation_hold(db, hold)
            opposite = refund_generation_hold(
                db,
                hold,
                error_code="LATE_FAILURE",
                error_message="late failure must not refund",
            )
            db.commit()

            self.assertEqual(first.id, second.id)
            self.assertEqual(first.id, opposite.id)
            self.assertEqual(first.type, "GENERATE_CAPTURE")
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.settlement_key.is_not(None))
                .count(),
                1,
            )
            self.assertEqual(db.get(User, user_id).credits, 250)

    def test_legacy_refund_is_reused_without_double_refund(self):
        user_id, hold_id = self._create_hold(
            email="legacy-refund@example.com",
            request_id="legacy-refunded-request",
            idempotency_key="legacy-refunded-hold",
        )

        with self.Session() as db:
            user = db.get(User, user_id)
            user.credits += 50
            legacy_refund = CreditTransaction(
                user_id=user_id,
                type="GENERATE_REFUND",
                amount=50,
                status="SUCCESS",
                balance_after=user.credits,
                related_request_id="legacy-refunded-request",
                error_code="UPSTREAM_FAILED",
                error_message="legacy provider failure",
            )
            db.add_all([user, legacy_refund])
            db.commit()
            legacy_refund_id = legacy_refund.id

        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            settlement = refund_generation_hold(
                db,
                hold,
                error_code="REPLAYED_FAILURE",
                error_message="must not add credits again",
            )
            opposite = capture_generation_hold(db, hold)
            db.commit()

            self.assertEqual(settlement.id, legacy_refund_id)
            self.assertEqual(opposite.id, legacy_refund_id)
            self.assertEqual(settlement.type, "GENERATE_REFUND")
            self.assertEqual(db.get(User, user_id).credits, 300)
            normalized_hold = db.get(CreditTransaction, hold_id)
            self.assertEqual(normalized_hold.status, "REFUNDED")
            self.assertIsNone(normalized_hold.idempotency_key)
            self.assertEqual(
                settlement.settlement_key,
                f"generation-hold:{hold_id}:settlement",
            )
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_REFUND")
                .count(),
                1,
            )

    def test_ambiguous_legacy_refunds_fail_closed_without_balance_change(self):
        user_id, hold_id = self._create_hold(
            email="legacy-ambiguous@example.com",
            request_id="legacy-ambiguous-request",
            idempotency_key="legacy-ambiguous-hold",
        )

        with self.Session() as db:
            user = db.get(User, user_id)
            user.credits = 300
            for suffix in ("a", "b"):
                db.add(CreditTransaction(
                    user_id=user_id,
                    type="GENERATE_REFUND",
                    amount=50,
                    status="SUCCESS",
                    balance_after=300,
                    related_request_id="legacy-ambiguous-request",
                    error_code=f"LEGACY_{suffix.upper()}",
                ))
            db.add(user)
            db.commit()

        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            with self.assertRaisesRegex(ValueError, "歧义"):
                refund_generation_hold(
                    db,
                    hold,
                    error_code="REPLAYED_FAILURE",
                    error_message="must fail closed",
                )
            db.rollback()

        with self.Session() as db:
            self.assertEqual(db.get(User, user_id).credits, 300)
            self.assertEqual(db.get(CreditTransaction, hold_id).status, "PENDING")
            self.assertTrue(all(
                item.settlement_key is None
                for item in db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_REFUND")
                .all()
            ))

    def test_two_users_with_same_request_id_settle_independently(self):
        first_user_id, first_hold_id = self._create_hold(
            email="first@example.com",
            request_id="shared-request",
            idempotency_key="first-hold",
        )
        second_user_id, second_hold_id = self._create_hold(
            email="second@example.com",
            request_id="shared-request",
            idempotency_key="second-hold",
        )

        with self.Session() as db:
            capture_generation_hold(db, db.get(CreditTransaction, first_hold_id))
            refund_generation_hold(
                db,
                db.get(CreditTransaction, second_hold_id),
                error_code="UPSTREAM_FAILED",
                error_message="provider failed",
            )
            db.commit()

            settlements = (
                db.query(CreditTransaction)
                .filter(CreditTransaction.type.in_(("GENERATE_CAPTURE", "GENERATE_REFUND")))
                .all()
            )
            self.assertEqual(len(settlements), 2)
            self.assertEqual(len({item.settlement_key for item in settlements}), 2)
            self.assertEqual(db.get(User, first_user_id).credits, 250)
            self.assertEqual(db.get(User, second_user_id).credits, 300)

    def test_concurrent_capture_calls_create_one_capture(self):
        user_id, hold_id = self._create_hold(
            email="capture-race@example.com",
            request_id="capture-race",
            idempotency_key="capture-race-hold",
        )

        results = self._run_concurrently(hold_id, "capture", "capture")

        self.assertEqual(len({result[0] for result in results}), 1)
        self.assertEqual({result[1] for result in results}, {"GENERATE_CAPTURE"})
        with self.Session() as db:
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_CAPTURE")
                .count(),
                1,
            )
            self.assertEqual(db.get(User, user_id).credits, 250)

    def test_concurrent_video_hold_with_same_idempotency_key_charges_once(self):
        with self.Session() as db:
            user = User(
                email="video-hold-race@example.com",
                hashed_password="hashed",
                credits=5000,
            )
            db.add(user)
            db.commit()
            user_id = user.id

        barrier = threading.Barrier(2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(self._reserve_video, user_id, barrier)
                for _ in range(2)
            ]
            hold_ids = [future.result(timeout=15) for future in futures]

        expected_cost = calculate_video_generation_cost(
            5,
            "seedance-2.0",
            "720p",
        )
        self.assertEqual(len(set(hold_ids)), 1)
        with self.Session() as db:
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_HOLD")
                .count(),
                1,
            )
            self.assertEqual(db.get(User, user_id).credits, 5000 - expected_cost)

    def test_concurrent_refunds_restore_credits_once(self):
        user_id, hold_id = self._create_hold(
            email="refund-race@example.com",
            request_id="refund-race",
            idempotency_key="refund-race-hold",
        )

        results = self._run_concurrently(hold_id, "refund", "refund")

        self.assertEqual(len({result[0] for result in results}), 1)
        self.assertEqual({result[1] for result in results}, {"GENERATE_REFUND"})
        with self.Session() as db:
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_REFUND")
                .count(),
                1,
            )
            self.assertEqual(db.get(User, user_id).credits, 300)

    def test_concurrent_capture_and_refund_choose_one_terminal_outcome(self):
        user_id, hold_id = self._create_hold(
            email="mixed-race@example.com",
            request_id="mixed-race",
            idempotency_key="mixed-race-hold",
        )

        results = self._run_concurrently(hold_id, "capture", "refund")

        self.assertEqual(len({result[0] for result in results}), 1)
        self.assertEqual(len({result[1] for result in results}), 1)
        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            settlement = (
                db.query(CreditTransaction)
                .filter(CreditTransaction.settlement_key.is_not(None))
                .one()
            )
            user = db.get(User, user_id)
            if settlement.type == "GENERATE_CAPTURE":
                self.assertEqual(hold.status, "SUCCESS")
                self.assertEqual(user.credits, 250)
            else:
                self.assertEqual(settlement.type, "GENERATE_REFUND")
                self.assertEqual(hold.status, "REFUNDED")
                self.assertEqual(user.credits, 300)

    def test_settlement_unique_error_rolls_back_hold_and_refund_balance(self):
        user_id, hold_id = self._create_hold(
            email="settlement-conflict@example.com",
            request_id="settlement-conflict",
            idempotency_key="settlement-conflict-hold",
        )
        settlement_key = f"generation-hold:{hold_id}:settlement"
        with self.Session() as db:
            db.add(
                CreditTransaction(
                    user_id=user_id,
                    type="WELCOME_GRANT",
                    amount=0,
                    status="SUCCESS",
                    balance_after=250,
                    settlement_key=settlement_key,
                    related_request_id="unrelated",
                )
            )
            db.commit()

        with self.Session() as db:
            hold = db.get(CreditTransaction, hold_id)
            with self.assertRaises(IntegrityError):
                refund_generation_hold(
                    db,
                    hold,
                    error_code="UPSTREAM_FAILED",
                    error_message="provider failed",
                )
            db.rollback()

        with self.Session() as db:
            self.assertEqual(db.get(CreditTransaction, hold_id).status, "PENDING")
            self.assertEqual(db.get(User, user_id).credits, 250)
            self.assertEqual(
                db.query(CreditTransaction)
                .filter(CreditTransaction.type == "GENERATE_REFUND")
                .count(),
                0,
            )


if __name__ == "__main__":
    unittest.main()
