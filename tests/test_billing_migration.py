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

    def test_existing_credit_transactions_gain_unique_settlement_key(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = pathlib.Path(tmpdir) / "legacy-billing.db"
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
                """
                CREATE TABLE credit_transactions (
                    id INTEGER PRIMARY KEY,
                    transaction_id VARCHAR(64) NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    type VARCHAR(32) NOT NULL,
                    amount INTEGER NOT NULL,
                    status VARCHAR(16) NOT NULL,
                    balance_after INTEGER NOT NULL,
                    idempotency_key VARCHAR(128) UNIQUE,
                    related_request_id VARCHAR(64),
                    error_code VARCHAR(64),
                    error_message TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO users (id, email, hashed_password, credits) VALUES (?, ?, ?, ?)",
                (1, "legacy-billing@example.com", "hashed", 100),
            )
            conn.commit()
            conn.close()

    def test_legacy_refund_normalizes_pending_hold_without_changing_balance(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = pathlib.Path(tmpdir) / "legacy-refund.db"
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
                """
                CREATE TABLE credit_transactions (
                    id INTEGER PRIMARY KEY,
                    transaction_id VARCHAR(64) NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    type VARCHAR(32) NOT NULL,
                    amount INTEGER NOT NULL,
                    status VARCHAR(16) NOT NULL,
                    balance_after INTEGER NOT NULL,
                    idempotency_key VARCHAR(128) UNIQUE,
                    related_request_id VARCHAR(64),
                    error_code VARCHAR(64),
                    error_message TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO users (id, email, hashed_password, credits) VALUES (?, ?, ?, ?)",
                (1, "legacy-refund@example.com", "hashed", 100),
            )
            conn.execute(
                """
                INSERT INTO credit_transactions (
                    id, transaction_id, user_id, type, amount, status,
                    balance_after, idempotency_key, related_request_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    10,
                    "legacy-hold",
                    1,
                    "GENERATE_HOLD",
                    -50,
                    "PENDING",
                    50,
                    "generate:1:legacy-refunded-request",
                    "legacy-refunded-request",
                    "2026-07-01 00:00:00",
                    "2026-07-01 00:00:00",
                ),
            )
            conn.execute(
                """
                INSERT INTO credit_transactions (
                    id, transaction_id, user_id, type, amount, status,
                    balance_after, related_request_id, error_code, error_message,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    11,
                    "legacy-refund",
                    1,
                    "GENERATE_REFUND",
                    50,
                    "SUCCESS",
                    100,
                    "legacy-refunded-request",
                    "UPSTREAM_FAILED",
                    "legacy provider failure",
                    "2026-07-01 00:01:00",
                    "2026-07-01 00:01:00",
                ),
            )
            conn.commit()
            conn.close()

            database_url = f"sqlite:///{db_path}"
            first_engine = migrate_database(database_url)
            first_engine.dispose()
            second_engine = migrate_database(database_url)
            second_engine.dispose()

            conn = sqlite3.connect(db_path)
            balance = conn.execute(
                "SELECT credits FROM users WHERE id = 1"
            ).fetchone()[0]
            hold = conn.execute(
                "SELECT status, idempotency_key FROM credit_transactions WHERE id = 10"
            ).fetchone()
            refund = conn.execute(
                "SELECT settlement_key FROM credit_transactions WHERE id = 11"
            ).fetchone()
            transaction_count = conn.execute(
                "SELECT COUNT(*) FROM credit_transactions"
            ).fetchone()[0]
            conn.close()

            self.assertEqual(balance, 100)
            self.assertEqual(hold, ("REFUNDED", None))
            self.assertEqual(refund, ("generation-hold:10:settlement",))
            self.assertEqual(transaction_count, 2)

    def test_ambiguous_legacy_settlements_remain_pending_for_review(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = pathlib.Path(tmpdir) / "ambiguous-refund.db"
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
                """
                CREATE TABLE credit_transactions (
                    id INTEGER PRIMARY KEY,
                    transaction_id VARCHAR(64) NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    type VARCHAR(32) NOT NULL,
                    amount INTEGER NOT NULL,
                    status VARCHAR(16) NOT NULL,
                    balance_after INTEGER NOT NULL,
                    idempotency_key VARCHAR(128) UNIQUE,
                    related_request_id VARCHAR(64),
                    error_code VARCHAR(64),
                    error_message TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO users (id, email, hashed_password, credits) VALUES (1, 'ambiguous@example.com', 'hashed', 100)"
            )
            rows = [
                (20, "hold", "GENERATE_HOLD", -50, "PENDING", 50, "hold-key", "2026-07-01 00:00:00"),
                (21, "refund-a", "GENERATE_REFUND", 50, "SUCCESS", 100, None, "2026-07-01 00:01:00"),
                (22, "refund-b", "GENERATE_REFUND", 50, "SUCCESS", 100, None, "2026-07-01 00:02:00"),
            ]
            for row in rows:
                conn.execute(
                    """
                    INSERT INTO credit_transactions (
                        id, transaction_id, user_id, type, amount, status,
                        balance_after, idempotency_key, related_request_id,
                        created_at, updated_at
                    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'ambiguous-request', ?, ?)
                    """,
                    row + (row[-1],),
                )
            conn.commit()
            conn.close()

            engine = migrate_database(f"sqlite:///{db_path}")
            engine.dispose()

            conn = sqlite3.connect(db_path)
            hold = conn.execute(
                "SELECT status, idempotency_key FROM credit_transactions WHERE id = 20"
            ).fetchone()
            settlement_keys = conn.execute(
                "SELECT settlement_key FROM credit_transactions WHERE id IN (21, 22) ORDER BY id"
            ).fetchall()
            balance = conn.execute("SELECT credits FROM users WHERE id = 1").fetchone()[0]
            conn.close()

            self.assertEqual(hold, ("PENDING", "hold-key"))
            self.assertEqual(settlement_keys, [(None,), (None,)])
            self.assertEqual(balance, 100)

            database_url = f"sqlite:///{db_path}"
            engine = migrate_database(database_url)
            engine.dispose()
            engine = migrate_database(database_url)
            inspector = inspect(engine)
            columns = {column["name"] for column in inspector.get_columns("credit_transactions")}
            self.assertIn("settlement_key", columns)
            indexes = {index["name"]: index for index in inspector.get_indexes("credit_transactions")}
            self.assertTrue(indexes["uq_credit_transactions_settlement_key"]["unique"])
            engine.dispose()

            conn = sqlite3.connect(db_path)
            insert_values = (
                1,
                "GENERATE_CAPTURE",
                0,
                "SUCCESS",
                100,
                "generation-hold:1:settlement",
                "shared-request",
                "2026-07-01 00:00:00",
                "2026-07-01 00:00:00",
            )
            conn.execute(
                """
                INSERT INTO credit_transactions (
                    transaction_id, user_id, type, amount, status, balance_after,
                    settlement_key, related_request_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("settlement-1",) + insert_values,
            )
            conn.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO credit_transactions (
                        transaction_id, user_id, type, amount, status, balance_after,
                        settlement_key, related_request_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("settlement-2",) + insert_values,
                )
            conn.close()


if __name__ == "__main__":
    unittest.main()
