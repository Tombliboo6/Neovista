import os
import pathlib
import sqlite3
import sys
import tempfile
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

TEST_DB_PATH = pathlib.Path(tempfile.gettempdir()) / "neovista_monitoring_schema_test.db"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")

from database import create_db_engine
from models import User


class MonitoringSchemaTest(unittest.TestCase):
    def tearDown(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def test_user_model_exposes_monitoring_columns(self):
        self.assertIn("created_at", User.__table__.columns)
        self.assertIn("last_login_at", User.__table__.columns)

    def test_migration_adds_monitoring_columns_and_tables_to_legacy_db(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

        connection = sqlite3.connect(TEST_DB_PATH)
        try:
            connection.execute(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email VARCHAR NOT NULL,
                    hashed_password VARCHAR NOT NULL,
                    credits INTEGER DEFAULT 0,
                    is_admin BOOLEAN DEFAULT 0
                )
                """
            )
            connection.commit()
        finally:
            connection.close()

        from migrate_monitoring_schema import migrate_database

        migrate_database(f"sqlite:///{TEST_DB_PATH}")

        engine = create_db_engine(f"sqlite:///{TEST_DB_PATH}")
        with engine.begin() as db_connection:
            user_columns = {
                row[1]
                for row in db_connection.exec_driver_sql("PRAGMA table_info(users)").fetchall()
            }
            tables = {
                row[0]
                for row in db_connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }

        self.assertIn("created_at", user_columns)
        self.assertIn("last_login_at", user_columns)
        self.assertIn("generation_events", tables)
        self.assertIn("frontend_error_events", tables)
        self.assertIn("alert_events", tables)


if __name__ == "__main__":
    unittest.main()
