import hashlib
import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_redeem_code_flow.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

import billing_router as billing_router_module
import database as database_module
from models import AdminAuditLog, Base, RedemptionCode, User


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
        self.admin_user = User(email="admin@example.com", hashed_password="hashed", credits=100, is_admin=True)
        self.db.add(self.user)
        self.db.add(self.admin_user)
        self.db.commit()
        self.db.refresh(self.user)
        self.db.refresh(self.admin_user)

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
        self.app.dependency_overrides[billing_router_module.get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def override_admin_user(self):
        admin_dependency = getattr(
            billing_router_module,
            "get_optional_user",
            billing_router_module.get_current_user,
        )
        self.app.dependency_overrides[admin_dependency] = lambda: self.admin_user

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_redeem_code_credits_account_once(self):
        response = self.client.post("/api/v1/billing/redeem", json={"code": self.raw_code})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["credits"], 1100)

    def test_redeem_code_cannot_be_reused(self):
        first = self.client.post("/api/v1/billing/redeem", json={"code": self.raw_code})
        second = self.client.post("/api/v1/billing/redeem", json={"code": self.raw_code})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 400)

    def test_admin_generate_redemption_codes_writes_audit_log(self):
        self.override_admin_user()

        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            json={"credits": 500, "count": 2, "batch": "wechat-2026-04"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 2)
        self.assertEqual(len(data["codes"]), 2)

        audit_log = self.db.query(AdminAuditLog).filter(AdminAuditLog.action == "GENERATE_REDEMPTION_CODES").one()
        self.assertEqual(audit_log.actor_user_id, self.admin_user.id)
        self.assertIn("wechat-2026-04", audit_log.details)

    def test_admin_token_can_generate_redemption_codes_for_console(self):
        response = self.client.post(
            "/api/v1/billing/admin/redemption-codes",
            headers={"x-admin-token": "test-admin-secret"},
            json={"credits": 1000, "count": 1, "batch": "wechat-2026-05-10yuan"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(len(data["codes"]), 1)

        audit_log = self.db.query(AdminAuditLog).filter(AdminAuditLog.action == "GENERATE_REDEMPTION_CODES").one()
        self.assertEqual(audit_log.actor_user_id, self.admin_user.id)
        self.assertIn("wechat-2026-05-10yuan", audit_log.details)

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

        self.override_admin_user()

        with patch.object(
            billing_router_module,
            "_generate_plain_code",
            side_effect=lambda prefix: next(generated_codes),
        ):
            response = self.client.post(
                "/api/v1/billing/admin/redemption-codes",
                json={"credits": 500, "count": 1, "batch": "collision-test"},
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["codes"], ["NV-DDDD-EEEE-FFFF"])


if __name__ == "__main__":
    unittest.main()
