import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_alerts_service_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"

from models import AlertEvent, Base, GenerationEvent, User


class AlertsServiceTest(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

        self.engine = create_engine(
            f"sqlite:///{TEST_DB_PATH}",
            connect_args={"check_same_thread": False},
        )
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)

        self.db = self.Session()
        self.user = User(
            email="alerts@example.com",
            hashed_password="hashed",
            credits=0,
            created_at=datetime.utcnow(),
        )
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_generation_failure_rule_activates_alert(self):
        now = datetime(2026, 4, 22, 12, 0, 0)
        self.db.add_all(
            [
                GenerationEvent(
                    request_id="fail-1",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name=None,
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="FAILED",
                    error_code="UPSTREAM_HTTP_503",
                    error_message="503",
                    created_at=now - timedelta(minutes=5),
                ),
                GenerationEvent(
                    request_id="fail-2",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name=None,
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="FAILED",
                    error_code="UPSTREAM_HTTP_503",
                    error_message="503",
                    created_at=now - timedelta(minutes=8),
                ),
                GenerationEvent(
                    request_id="ok-1",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name="provider",
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="SUCCESS",
                    created_at=now - timedelta(minutes=4),
                ),
            ]
        )
        self.db.commit()

        from alerts_service import evaluate_alerts

        evaluate_alerts(self.db, now=now)

        active = (
            self.db.query(AlertEvent)
            .filter(AlertEvent.type == "generation_failure_rate_high", AlertEvent.status == "ACTIVE")
            .one()
        )
        self.assertIn("15", active.message)

    def test_alert_resolves_when_metric_recovers(self):
        start = datetime(2026, 4, 22, 12, 0, 0)
        self.db.add_all(
            [
                GenerationEvent(
                    request_id="fail-1",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name=None,
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="FAILED",
                    error_code="UPSTREAM_HTTP_503",
                    error_message="503",
                    created_at=start - timedelta(minutes=5),
                ),
                GenerationEvent(
                    request_id="fail-2",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name=None,
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="FAILED",
                    error_code="UPSTREAM_HTTP_503",
                    error_message="503",
                    created_at=start - timedelta(minutes=6),
                ),
            ]
        )
        self.db.commit()

        from alerts_service import evaluate_alerts

        evaluate_alerts(self.db, now=start)

        recovery_now = start + timedelta(minutes=20)
        self.db.add_all(
            [
                GenerationEvent(
                    request_id="ok-1",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name="provider",
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="SUCCESS",
                    created_at=recovery_now - timedelta(minutes=4),
                ),
                GenerationEvent(
                    request_id="ok-2",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name="provider",
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="SUCCESS",
                    created_at=recovery_now - timedelta(minutes=3),
                ),
                GenerationEvent(
                    request_id="ok-3",
                    user_id=self.user.id,
                    entrypoint="generate",
                    template_id=None,
                    selected_model="nano-banana-2",
                    provider_name="provider",
                    resolution="2K",
                    aspect_ratio="1:1",
                    num_images=1,
                    status="SUCCESS",
                    created_at=recovery_now - timedelta(minutes=2),
                ),
            ]
        )
        self.db.commit()

        evaluate_alerts(self.db, now=recovery_now)

        resolved = (
            self.db.query(AlertEvent)
            .filter(AlertEvent.type == "generation_failure_rate_high", AlertEvent.status == "RESOLVED")
            .one()
        )
        self.assertIsNotNone(resolved.resolved_at)


if __name__ == "__main__":
    unittest.main()
