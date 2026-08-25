import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_auth_limit_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-at-least-32-bytes-long")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

import auth as auth_module
import database as database_module
from models import Base, EmailVerification, UsageCounter, User


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

    def _post_register(self, email, code="123456", *, ip="7.7.7.7", password="Password123"):
        return self.client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "code": code},
            headers={"x-forwarded-for": ip},
        )

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

    def test_send_code_normalizes_email_and_uses_six_digit_secret_code(self):
        with patch.object(auth_module.secrets, "randbelow", return_value=42):
            with patch.object(auth_module, "send_verification_email", return_value=True) as send_mock:
                response = self.client.post(
                    "/api/v1/auth/send-code",
                    json={"email": "  User.Name@Example.COM  "},
                    headers={"x-forwarded-for": "8.8.4.4"},
                )

        self.assertEqual(response.status_code, 200)
        send_mock.assert_called_once_with("user.name@example.com", "000042")
        with self.Session() as session:
            verification = session.query(EmailVerification).one()
            self.assertEqual(verification.email, "user.name@example.com")
            self.assertEqual(verification.code, "000042")

    def test_send_code_returns_429_after_normalized_email_limit_across_ips(self):
        with patch.object(auth_module, "SEND_CODE_IP_HOURLY_LIMIT", 100):
            with patch.object(auth_module, "SEND_CODE_EMAIL_HOURLY_LIMIT", 1):
                with patch.object(auth_module, "send_verification_email", return_value=True):
                    first = self.client.post(
                        "/api/v1/auth/send-code",
                        json={"email": "Target@Example.COM"},
                        headers={"x-forwarded-for": "8.8.8.1"},
                    )
                    second = self.client.post(
                        "/api/v1/auth/send-code",
                        json={"email": " target@example.com "},
                        headers={"x-forwarded-for": "8.8.8.2"},
                    )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        with self.Session() as session:
            counter = session.query(UsageCounter).filter(UsageCounter.subject_type == "send_code_email").one()
            self.assertEqual(len(counter.subject_key), 64)
            self.assertNotIn("target", counter.subject_key)
            self.assertNotIn("@", counter.subject_key)

    def test_send_code_rejects_invalid_or_oversized_email_before_delivery(self):
        invalid_emails = [
            "missing-at.example.com",
            "a@localhost",
            "a..b@example.com",
            "a@-example.com",
            f"{'a' * 243}@example.com",
        ]
        with patch.object(auth_module, "send_verification_email") as send_mock:
            for email in invalid_emails:
                with self.subTest(email=email[:32]):
                    response = self.client.post("/api/v1/auth/send-code", json={"email": email})
                    self.assertEqual(response.status_code, 422)
        send_mock.assert_not_called()

    def test_failed_delivery_removes_unusable_verification_code(self):
        with patch.object(auth_module, "send_verification_email", return_value=False):
            response = self.client.post(
                "/api/v1/auth/send-code",
                json={"email": "delivery@example.com"},
                headers={"x-forwarded-for": "8.8.4.5"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "暂时无法发送验证码，请稍后再试")
        with self.Session() as session:
            self.assertEqual(session.query(EmailVerification).count(), 0)

    def test_login_returns_429_after_ip_hourly_limit(self):
        with patch.object(auth_module, "LOGIN_IP_HOURLY_LIMIT", 1, create=True):
            with patch.object(auth_module, "LOGIN_EMAIL_HOURLY_LIMIT", 100, create=True):
                first = self.client.post(
                    "/api/v1/auth/login",
                    json={"email": "missing@example.com", "password": "wrongpass1"},
                    headers={"x-forwarded-for": "9.9.9.9"},
                )
                second = self.client.post(
                    "/api/v1/auth/login",
                    json={"email": "other@example.com", "password": "wrongpass1"},
                    headers={"x-forwarded-for": "9.9.9.9"},
                )

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)

    def test_login_returns_429_after_email_hourly_limit(self):
        with patch.object(auth_module, "LOGIN_IP_HOURLY_LIMIT", 100, create=True):
            with patch.object(auth_module, "LOGIN_EMAIL_HOURLY_LIMIT", 1, create=True):
                first = self.client.post(
                    "/api/v1/auth/login",
                    json={"email": "target@example.com", "password": "wrongpass1"},
                    headers={"x-forwarded-for": "9.9.9.10"},
                )
                second = self.client.post(
                    "/api/v1/auth/login",
                    json={"email": "target@example.com", "password": "wrongpass1"},
                    headers={"x-forwarded-for": "9.9.9.11"},
                )

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)

    def test_login_normalizes_email(self):
        with self.Session() as session:
            session.add(
                User(
                    email="login-normalized@example.com",
                    hashed_password=auth_module.hash_password("Password123"),
                    credits=0,
                )
            )
            session.commit()

        response = self.client.post(
            "/api/v1/auth/login",
            json={"email": " LOGIN-NORMALIZED@Example.COM ", "password": "Password123"},
            headers={"x-forwarded-for": "9.9.9.12"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], "login-normalized@example.com")

    def test_login_and_register_reject_oversized_strings_and_non_six_digit_codes(self):
        oversized_email = f"{'a' * 243}@example.com"
        login_cases = [
            {"email": oversized_email, "password": "Password123"},
            {"email": "user@example.com", "password": "x" * 25},
        ]
        for payload in login_cases:
            with self.subTest(endpoint="login", field=list(payload.values())[0][:16]):
                response = self.client.post("/api/v1/auth/login", json=payload)
                self.assertEqual(response.status_code, 422)

        invalid_codes = ["12345", "1234567", "12345a", "１２３４５６", 123456]
        for code in invalid_codes:
            with self.subTest(endpoint="register", code=code):
                response = self.client.post(
                    "/api/v1/auth/register",
                    json={"email": "user@example.com", "password": "Password123", "code": code},
                )
                self.assertEqual(response.status_code, 422)

    def test_register_rate_limits_normalized_email_across_ips(self):
        with patch.object(auth_module, "REGISTER_IP_DAILY_LIMIT", 100):
            with patch.object(auth_module, "REGISTER_EMAIL_DAILY_LIMIT", 1):
                first = self._post_register("Target@Example.COM", ip="7.7.7.1")
                second = self._post_register(" target@example.com ", ip="7.7.7.2")

        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
        with self.Session() as session:
            counter = session.query(UsageCounter).filter(UsageCounter.subject_type == "register_email").one()
            self.assertEqual(len(counter.subject_key), 64)
            self.assertNotIn("target", counter.subject_key)

    def test_register_existing_expired_and_wrong_code_share_generic_error(self):
        with self.Session() as session:
            session.add(
                User(
                    email="existing@example.com",
                    hashed_password=auth_module.hash_password("Password123"),
                    credits=0,
                )
            )
            session.add(
                EmailVerification(
                    email="expired@example.com",
                    code="123456",
                    expires_at=datetime.now() - timedelta(minutes=1),
                )
            )
            session.commit()

        with patch.object(auth_module, "REGISTER_IP_DAILY_LIMIT", 100):
            with patch.object(auth_module, "REGISTER_EMAIL_DAILY_LIMIT", 100):
                existing = self._post_register("existing@example.com", ip="7.7.8.1")
                wrong_code = self._post_register("new@example.com", ip="7.7.8.2")
                expired = self._post_register("expired@example.com", ip="7.7.8.3")

        for response in (existing, wrong_code, expired):
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], auth_module.GENERIC_REGISTRATION_ERROR)

    def test_register_normalizes_email_on_success(self):
        with self.Session() as session:
            session.add(
                EmailVerification(
                    email="new-user@example.com",
                    code="654321",
                    expires_at=datetime.now() + timedelta(minutes=5),
                )
            )
            session.commit()

        response = self._post_register(
            " NEW-USER@Example.COM ",
            code="654321",
            ip="7.7.9.1",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], "new-user@example.com")
        with self.Session() as session:
            user = session.query(User).filter(User.email == "new-user@example.com").one()
            self.assertEqual(user.email, "new-user@example.com")


if __name__ == "__main__":
    unittest.main()
