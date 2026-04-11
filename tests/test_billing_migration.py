import pathlib
import sqlite3
import sys
import tempfile
import unittest

from sqlalchemy import create_engine, inspect, text

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from migrate_billing_schema import migrate_database


class BillingMigrationTest(unittest.TestCase):
    def test_existing_users_survive_and_new_tables_are_created(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = pathlib.Path(tmpdir) / "legacy.db"
            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email VARCHAR NOT NULL UNIQUE,
                    hashed_password VARCHAR NOT NULL,
                    credits INTEGER DEFAULT 5,
                    is_admin BOOLEAN DEFAULT 0
                )
                """
            )
            conn.execute(
                "INSERT INTO users (email, hashed_password, credits, is_admin) VALUES (?, ?, ?, ?)",
                ("legacy@example.com", "hashed", 88, 0),
            )
            conn.commit()
            conn.close()

            database_url = f"sqlite:///{db_path}"
            migrate_database(database_url)
            migrate_database(database_url)

            engine = create_engine(database_url, connect_args={"check_same_thread": False})
            inspector = inspect(engine)
            table_names = set(inspector.get_table_names())

            self.assertIn("users", table_names)
            self.assertIn("credit_transactions", table_names)
            self.assertIn("redemption_codes", table_names)
            self.assertIn("usage_counters", table_names)
            self.assertIn("admin_audit_logs", table_names)

            with engine.connect() as db:
                row = db.execute(text("SELECT email, credits FROM users WHERE email = :email"), {"email": "legacy@example.com"}).fetchone()
            self.assertEqual(row[0], "legacy@example.com")
            self.assertEqual(row[1], 88)


if __name__ == "__main__":
    unittest.main()
