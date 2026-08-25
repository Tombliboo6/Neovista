import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_monitoring_ingest_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ.setdefault("IMAGE_GENERATION_FEATURE_ENABLED", "true")

import auth as auth_module
import database as database_module
from billing_service import grant_welcome_credits
from models import Base, FrontendErrorEvent, GenerationEvent, User

os.chdir(BACKEND_DIR)
import main


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return self._response


def _error_response(status_code):
    return httpx.Response(
        status_code,
        request=httpx.Request("POST", "https://example.com"),
        json={"error": "upstream failed"},
    )


class MonitoringAuthLifecycleTest(unittest.TestCase):
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

        self.app = FastAPI()
        self.app.include_router(auth_module.router, prefix="/api/v1/auth")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_new_user_row_sets_created_at(self):
        with self.Session() as session:
            user = User(
                email="register@example.com",
                hashed_password=auth_module.hash_password("Password123"),
                credits=0,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            self.assertIsNotNone(user)
            self.assertIsNotNone(user.created_at)

    def test_login_updates_last_login_at(self):
        with self.Session() as session:
            user = User(
                email="login@example.com",
                hashed_password=auth_module.hash_password("Password123"),
                credits=0,
                created_at=datetime.utcnow(),
                last_login_at=None,
            )
            session.add(user)
            session.commit()

        response = self.client.post(
            "/api/v1/auth/login",
            json={
                "email": "login@example.com",
                "password": "Password123",
            },
        )

        self.assertEqual(response.status_code, 200)

        with self.Session() as session:
            user = session.query(User).filter(User.email == "login@example.com").first()
            self.assertIsNotNone(user)
            self.assertIsNotNone(user.last_login_at)


class MonitoringEventIngestTest(unittest.IsolatedAsyncioTestCase):
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
        self.db = self.Session()
        self.user = User(
            email="events@example.com",
            hashed_password=auth_module.hash_password("Password123"),
            credits=0,
            created_at=datetime.utcnow(),
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)
        grant_welcome_credits(self.db, self.user)
        self.db.commit()
        self.db.refresh(self.user)
        self.token = auth_module.create_access_token({"sub": self.user.email, "user_id": self.user.id})

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_frontend_error_endpoint_persists_event(self):
        response = self.client.post(
            "/api/v1/frontend-errors",
            json={
                "route": "/workspace",
                "message": "boom",
                "stack": "stacktrace",
                "user_agent": "pytest",
            },
            headers={"authorization": f"Bearer {self.token}"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

        with self.Session() as session:
            events = session.query(FrontendErrorEvent).all()
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0].route, "/workspace")
            self.assertEqual(events[0].user_id, self.user.id)

    def test_frontend_error_endpoint_requires_authentication(self):
        response = self.client.post(
            "/api/v1/frontend-errors",
            json={"route": "/workspace", "message": "boom"},
        )
        self.assertEqual(response.status_code, 401)
        with self.Session() as session:
            self.assertEqual(session.query(FrontendErrorEvent).count(), 0)

    async def test_generate_failure_persists_generation_event(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            request_id="req-monitoring-1",
            resolution="2K",
            num_images=1,
        )

        with patch.object(
            main,
            "API_CHANNELS",
            (
                main.APIChannel(
                    name="Test",
                    base_url="https://example.com",
                    api_key="key",
                    model="gemini",
                    product_model="nano-banana-2",
                ),
            ),
        ):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_error_response(503))):
                with self.assertRaises(main.HTTPException):
                    await main.generate_image(request, self.user, self.db)

        events = (
            self.db.query(GenerationEvent)
            .filter(GenerationEvent.request_id == "req-monitoring-1")
            .order_by(GenerationEvent.id.asc())
            .all()
        )
        self.assertEqual([event.status for event in events], ["REVIEW_REQUIRED"])
        self.assertEqual(events[-1].error_code, "UPSTREAM_HTTP_503")
        self.assertNotIn("upstream failed", events[-1].error_message)


if __name__ == "__main__":
    unittest.main()
