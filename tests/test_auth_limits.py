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

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_auth_limit_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

import auth as auth_module
import database as database_module
from models import Base


class AuthLimitTest(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()
        self.engine = create_engine(f"sqlite:///{TEST_DB_PATH}", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        database_module.SessionLocal = self.Session
        Base.metadata.create_all(bind=self.engine)

        self.app = FastAPI()
        self.app.include_router(auth_module.router, prefix="/api/v1/auth")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_send_code_returns_429_after_ip_hourly_limit(self):
        with patch.object(auth_module, "SEND_CODE_IP_HOURLY_LIMIT", 1):
            with patch.object(auth_module, "send_verification_email", return_value=True):
                first = self.client.post(
                    "/api/v1/auth/send-code",
                    json={"email": "limit@example.com"},
                    headers={"x-forwarded-for": "8.8.8.8"},
                )
                second = self.client.post(
                    "/api/v1/auth/send-code",
                    json={"email": "limit@example.com"},
                    headers={"x-forwarded-for": "8.8.8.8"},
                )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)


if __name__ == "__main__":
    unittest.main()
