import pathlib
import sys
import unittest
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from billing_service import (
    create_generation_hold,
    capture_generation_hold,
    grant_welcome_credits,
    refund_generation_hold,
)
from models import Base, CreditTransaction, RedemptionCode, UsageCounter, User


class BillingServiceTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _create_user(self, *, credits=0, email="user@example.com"):
        user = User(email=email, hashed_password="hashed", credits=credits)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def test_grant_welcome_credits_creates_success_ledger_and_updates_balance(self):
        user = self._create_user(credits=0)

        transaction, balance = grant_welcome_credits(self.db, user, source="register")

        self.db.refresh(user)
        self.assertEqual(balance, 200)
        self.assertEqual(user.credits, 200)
        self.assertEqual(transaction.type, "WELCOME_GRANT")
        self.assertEqual(transaction.status, "SUCCESS")
        self.assertEqual(transaction.amount, 200)

    def test_create_generation_hold_deducts_balance_when_sufficient(self):
        user = self._create_user(credits=300, email="hold@example.com")

        hold = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-1",
            idempotency_key="idem-1",
        )

        self.db.refresh(user)
        self.assertEqual(user.credits, 250)
        self.assertEqual(hold.type, "GENERATE_HOLD")
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(hold.amount, -50)

    def test_create_generation_hold_rejects_insufficient_balance(self):
        user = self._create_user(credits=10, email="poor@example.com")

        with self.assertRaises(ValueError):
            create_generation_hold(
                self.db,
                user,
                resolution="2K",
                num_images=1,
                request_id="req-2",
                idempotency_key="idem-2",
            )

    def test_capture_generation_hold_marks_success_without_double_deduct(self):
        user = self._create_user(credits=300, email="capture@example.com")
        hold = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-3",
            idempotency_key="idem-3",
        )

        capture = capture_generation_hold(self.db, hold)

        self.db.refresh(user)
        self.assertEqual(user.credits, 250)
        self.assertEqual(capture.type, "GENERATE_CAPTURE")
        self.assertEqual(capture.status, "SUCCESS")

    def test_refund_generation_hold_restores_balance_and_records_refund(self):
        user = self._create_user(credits=300, email="refund@example.com")
        hold = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-4",
            idempotency_key="idem-4",
        )

        refund = refund_generation_hold(
            self.db,
            hold,
            error_code="UPSTREAM_503",
            error_message="provider unavailable",
        )

        self.db.refresh(user)
        self.assertEqual(user.credits, 300)
        self.assertEqual(refund.type, "GENERATE_REFUND")
        self.assertEqual(refund.status, "SUCCESS")
        self.assertEqual(refund.amount, 50)

    def test_duplicate_idempotency_key_does_not_double_charge(self):
        user = self._create_user(credits=300, email="idem@example.com")

        first = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-5",
            idempotency_key="idem-5",
        )
        second = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-5",
            idempotency_key="idem-5",
        )

        self.db.refresh(user)
        self.assertEqual(user.credits, 250)
        self.assertEqual(first.id, second.id)
        self.assertEqual(self.db.query(CreditTransaction).count(), 1)

    def test_refunded_hold_with_same_idempotency_key_creates_new_hold(self):
        user = self._create_user(credits=300, email="refund-retry@example.com")

        first_hold = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-6",
            idempotency_key="idem-6",
        )
        refund_generation_hold(
            self.db,
            first_hold,
            error_code="UPSTREAM_503",
            error_message="provider unavailable",
        )
        self.db.commit()
        self.db.refresh(user)

        second_hold = create_generation_hold(
            self.db,
            user,
            resolution="2K",
            num_images=1,
            request_id="req-6-retry",
            idempotency_key="idem-6",
        )

        self.db.refresh(user)
        self.assertNotEqual(first_hold.id, second_hold.id)
        self.assertEqual(second_hold.status, "PENDING")
        self.assertEqual(user.credits, 250)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").count(),
            2,
        )


if __name__ == "__main__":
    unittest.main()
