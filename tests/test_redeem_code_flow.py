import hashlib
import json
import os
import pathlib
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_redeem_code_flow.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-at-least-32-bytes-long")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

import auth as auth_module
import billing_router as billing_router_module
import database as database_module
from billing_service import redeem_code
from models import AdminAuditLog, Base, CreditTransaction, RedemptionCode, User


class RedeemCodeFlowTest(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()
        self.engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        database_module.SessionLocal = self.Session
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()

        self.user = User(email="redeem@example.com", hashed_password="hashed", credits=100)
        self.other_user = User(email="other-redeem@example.com", hashed_password="hashed", credits=50)
        self.admin_user = User(email="admin@example.com", hashed_password="hashed", credits=100, is_admin=True)
        self.db.add(self.user)
        self.db.add(self.other_user)
        self.db.add(self.admin_user)
        self.db.commit()
        self.db.refresh(self.user)
        self.db.refresh(self.other_user)
        self.db.refresh(self.admin_user)

        self.user_headers = {
            "authorization": f"Bearer {auth_module.create_access_token({'sub': self.user.email, 'user_id': self.user.id})}",
        }
        self.other_user_headers = {
            "authorization": f"Bearer {auth_module.create_access_token({'sub': self.other_user.email, 'user_id': self.other_user.id})}",
        }
        self.admin_bearer_headers = {
            "authorization": f"Bearer {auth_module.create_access_token({'sub': self.admin_user.email, 'user_id': self.admin_user.id})}",
        }
        self.admin_headers = {
            **self.admin_bearer_headers,
            "x-admin-token": "test-admin-secret",
        }

        self.raw_code = "NV-A8F9-2B4C"
        self.code = RedemptionCode(
            code_hash=hashlib.sha256(self.raw_code.encode("utf-8")).hexdigest(),
            credits=1000,
            status="ACTIVE",
        )
        self.db.add(self.code)
        self.db.commit()

        self.app = FastAPI()
        self.app.include_router(billing_router_module.router, prefix="/api/v1/billing")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_redeem_code_credits_account_once(self):
        response = self.client.post(
            "/api/v1/billing/redeem",
            headers=self.user_headers,
            json={"code": self.raw_code},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["credits"], 1100)

    def test_repeated_redeem_by_same_user_returns_original_response(self):
        first = self.client.post(
            "/api/v1/billing/redeem",
            headers=self.user_headers,
            json={"code": self.raw_code},
        )
        second = self.client.post(
            "/api/v1/billing/redeem",
            headers=self.user_headers,
            json={"code": self.raw_code},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        with self.Session() as session:
            user = session.query(User).filter(User.id == self.user.id).one()
            self.assertEqual(user.credits, 1100)
            self.assertEqual(
                session.query(CreditTransaction).filter(CreditTransaction.type == "REDEEM").count(),
                1,
            )

    def test_redeemed_code_is_not_idempotent_for_another_user(self):
        first = self.client.post(
            "/api/v1/billing/redeem",
            headers=self.user_headers,
            json={"code": self.raw_code},
        )
        second = self.client.post(
            "/api/v1/billing/redeem",
            headers=self.other_user_headers,
            json={"code": self.raw_code},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)
        with self.Session() as session:
            other_user = session.query(User).filter(User.id == self.other_user.id).one()
            self.assertEqual(other_user.credits, 50)

    def test_admin_generate_redemption_codes_writes_audit_log(self):
        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            headers=self.admin_headers,
            json={"credits": 500, "count": 2, "batch": "wechat-2026-04"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 2)
        self.assertEqual(len(data["codes"]), 2)

        self.db.expire_all()
        audit_log = self.db.query(AdminAuditLog).filter(AdminAuditLog.action == "GENERATE_REDEMPTION_CODES").one()
        self.assertEqual(audit_log.actor_user_id, self.admin_user.id)
        details = json.loads(audit_log.details)
        self.assertEqual(
            set(details),
            {"batch", "count", "credits", "code_hash_digest"},
        )
        self.assertEqual(details["batch"], "wechat-2026-04")
        self.assertEqual(details["count"], 2)
        self.assertEqual(details["credits"], 500)
        code_hashes = sorted(
            hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()
            for code in data["codes"]
        )
        expected_digest = hashlib.sha256("|".join(code_hashes).encode("utf-8")).hexdigest()
        self.assertEqual(details["code_hash_digest"], expected_digest)
        for code in data["codes"]:
            self.assertNotIn(code, audit_log.details)

    def test_admin_token_without_bearer_cannot_generate_redemption_codes(self):
        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            headers={"x-admin-token": "test-admin-secret"},
            json={"credits": 1000, "count": 1, "batch": "wechat-2026-05-10yuan"},
        )

        self.assertEqual(response.status_code, 401)

    def test_admin_bearer_without_admin_token_cannot_generate_redemption_codes(self):
        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            headers=self.admin_bearer_headers,
            json={"credits": 1000, "count": 1},
        )

        self.assertEqual(response.status_code, 403)

    def test_non_admin_bearer_with_admin_token_cannot_generate_redemption_codes(self):
        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            headers={**self.user_headers, "x-admin-token": "test-admin-secret"},
            json={"credits": 1000, "count": 1},
        )

        self.assertEqual(response.status_code, 403)

    def test_admin_batch_limits_reject_unbounded_credits_and_count(self):
        payloads = [
            {"credits": billing_router_module.MAX_REDEMPTION_CREDITS_PER_CODE + 1, "count": 1},
            {"credits": 1000, "count": billing_router_module.MAX_REDEMPTION_BATCH_COUNT + 1},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/v1/billing/admin/redemption-codes",
                    headers=self.admin_headers,
                    json=payload,
                )
                self.assertEqual(response.status_code, 422)

        with self.Session() as session:
            self.assertEqual(session.query(AdminAuditLog).count(), 0)
            self.assertEqual(session.query(RedemptionCode).count(), 1)

    def test_admin_generate_redemption_codes_retries_hash_collision(self):
        existing_code = "NV-AAAA-BBBB-CCCC"
        self.db.add(
            RedemptionCode(
                code_hash=hashlib.sha256(existing_code.strip().upper().encode("utf-8")).hexdigest(),
                credits=500,
                status="ACTIVE",
            )
        )
        self.db.commit()

        generated_codes = iter([
            existing_code,
            "NV-DDDD-EEEE-FFFF",
        ])

        with patch.object(
            billing_router_module,
            "_generate_plain_code",
            side_effect=lambda prefix: next(generated_codes),
        ):
            response = self.client.post(
                "/api/v1/billing/admin/redemption-codes",
                headers=self.admin_headers,
                json={"credits": 500, "count": 1, "batch": "collision-test"},
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["codes"], ["NV-DDDD-EEEE-FFFF"])

    def _redeem_in_new_session(self, user_id):
        session = self.Session()
        try:
            user = session.query(User).filter(User.id == user_id).one()
            transaction, balance = redeem_code(session, user, self.raw_code)
            transaction_id = transaction.transaction_id
            session.commit()
            return "ok", transaction_id, balance
        except ValueError as error:
            session.rollback()
            return "error", str(error), None
        finally:
            session.close()

    def test_concurrent_same_user_redeem_is_single_credit_and_same_response(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(self._redeem_in_new_session, [self.user.id, self.user.id]))

        self.assertEqual([result[0] for result in results], ["ok", "ok"])
        self.assertEqual(len({result[1] for result in results}), 1)
        self.assertEqual({result[2] for result in results}, {1100})
        with self.Session() as session:
            user = session.query(User).filter(User.id == self.user.id).one()
            self.assertEqual(user.credits, 1100)
            self.assertEqual(
                session.query(CreditTransaction).filter(CreditTransaction.type == "REDEEM").count(),
                1,
            )

    def test_concurrent_different_users_cannot_double_redeem(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(self._redeem_in_new_session, [self.user.id, self.other_user.id]))

        self.assertEqual(sorted(result[0] for result in results), ["error", "ok"])
        with self.Session() as session:
            users = session.query(User).filter(User.id.in_([self.user.id, self.other_user.id])).all()
            self.assertEqual(sum(user.credits for user in users), 1150)
            self.assertEqual(
                session.query(CreditTransaction).filter(CreditTransaction.type == "REDEEM").count(),
                1,
            )


if __name__ == "__main__":
    unittest.main()
