import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_dashboard_api_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

import database as database_module
from models import AlertEvent, Base, FrontendErrorEvent, GenerationEvent, User

os.chdir(BACKEND_DIR)
import main


class DashboardApiTest(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

        self.engine = create_engine(
            f"sqlite:///{TEST_DB_PATH}",
            connect_args={"check_same_thread": False},
        )
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        database_module.SessionLocal = self.Session
        Base.metadata.create_all(bind=self.engine)

        self.client = TestClient(main.app)
        self.admin_headers = {"x-admin-token": "test-admin-secret"}

        with self.Session() as session:
            user = User(
                email="dashboard@example.com",
                hashed_password="hashed",
                credits=120,
                created_at=datetime.utcnow() - timedelta(hours=2),
                last_login_at=datetime.utcnow() - timedelta(minutes=30),
            )
            session.add(user)
            session.flush()

            session.add(
                GenerationEvent(
                    request_id="req-1",
                    user_id=user.id,
                    entrypoint="generate",
                    template_id="1.1.1",
                    selected_model="nano-banana-2",
                    provider_name="TestProvider",
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="FAILED",
                    error_code="UPSTREAM_HTTP_503",
                    error_message="503",
                    created_at=datetime.utcnow() - timedelta(minutes=20),
                )
            )
            session.add(
                FrontendErrorEvent(
                    user_id=user.id,
                    route="/workspace",
                    message="boom",
                    stack="stacktrace",
                    user_agent="pytest",
                    created_at=datetime.utcnow() - timedelta(minutes=10),
                )
            )
            session.add(
                AlertEvent(
                    type="umami_unavailable",
                    status="ACTIVE",
                    message="Umami unavailable",
                    fingerprint="umami_unavailable",
                    triggered_at=datetime.utcnow() - timedelta(minutes=5),
                    last_evaluated_at=datetime.utcnow() - timedelta(minutes=1),
                )
            )
            session.commit()

    def tearDown(self):
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_dashboard_overview_requires_admin_token(self):
        response = self.client.get("/api/v1/admin/dashboard/overview")
        self.assertEqual(response.status_code, 403)

    def test_dashboard_overview_returns_expected_sections(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/overview",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("kpis", payload)
        self.assertIn("today", payload)
        self.assertIn("status", payload)

    def test_dashboard_traffic_returns_normalized_shape(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/traffic",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("summary", payload)
        self.assertIn("top_pages", payload)
        self.assertIn("sources", payload)
        self.assertIn("devices", payload)

    def test_dashboard_users_returns_expected_sections(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/users",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("totals", payload)
        self.assertIn("trends", payload)
        self.assertIn("recent_registrations", payload)

    def test_dashboard_generations_returns_expected_sections(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/generations",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("summary", payload)
        self.assertIn("records", payload)
        self.assertIn("model_ranking", payload)
        self.assertIn("template_ranking", payload)

    def test_dashboard_errors_returns_expected_sections(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/errors",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("frontend_errors", payload)
        self.assertIn("backend_summary", payload)
        self.assertIn("upstream_failures", payload)

    def test_dashboard_alerts_returns_expected_sections(self):
        response = self.client.get(
            "/api/v1/admin/dashboard/alerts",
            headers=self.admin_headers,
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("active_alerts", payload)
        self.assertIn("recent_history", payload)

    def test_public_channels_endpoint_does_not_expose_provider_details(self):
        channels = (
            main.APIChannel(
                name="PrivateProvider",
                base_url="https://private-provider.example.com",
                api_key="secret-key",
                model="private-model",
            ),
        )

        with patch.object(main, "API_CHANNELS", channels):
            response = self.client.get("/api/v1/channels")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertTrue(payload["configured"])
        self.assertNotIn("channels", payload)
        self.assertNotIn("private-provider", response.text)
        self.assertNotIn("secret-key", response.text)

    def test_admin_channels_endpoint_requires_admin_token(self):
        response = self.client.get("/api/v1/admin/channels")

        self.assertEqual(response.status_code, 403)

    def test_admin_channels_endpoint_exposes_non_secret_provider_metadata(self):
        channels = (
            main.APIChannel(
                name="PrivateProvider",
                base_url="https://private-provider.example.com",
                api_key="secret-key",
                model="private-model",
            ),
        )

        with patch.object(main, "API_CHANNELS", channels):
            response = self.client.get(
                "/api/v1/admin/channels",
                headers=self.admin_headers,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["channels"][0]["name"], "PrivateProvider")
        self.assertEqual(payload["channels"][0]["base_url"], "https://private-provider.example.com")
        self.assertNotIn("api_key", payload["channels"][0])
        self.assertNotIn("secret-key", response.text)


if __name__ == "__main__":
    unittest.main()
