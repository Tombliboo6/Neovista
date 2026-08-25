import pathlib
import sqlite3
import sys
import tempfile
import unittest

from sqlalchemy import inspect, text


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from migrate_image_generation_schema import migrate_database


class ImageGenerationMigrationTest(unittest.TestCase):
    def _create_production_legacy_copy(self, database_path: pathlib.Path):
        connection = sqlite3.connect(database_path)
        connection.execute(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email VARCHAR NOT NULL UNIQUE,
                hashed_password VARCHAR NOT NULL,
                credits INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.executemany(
            "INSERT INTO users (id, email, hashed_password, credits) VALUES (?, ?, 'hash', ?)",
            [(1, "legacy-one@example.com", 170), (2, "legacy-two@example.com", 150)],
        )
        connection.execute(
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
                settlement_key VARCHAR(128),
                related_request_id VARCHAR(64),
                error_code VARCHAR(64),
                error_message TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.executemany(
            """
            INSERT INTO credit_transactions (
                id, transaction_id, user_id, type, amount, status,
                balance_after, idempotency_key, related_request_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, 'GENERATE_HOLD', ?, 'PENDING', ?, ?, ?, ?, ?)
            """,
            [
                (
                    10,
                    "legacy-generate-hold",
                    1,
                    -30,
                    170,
                    "generate:1:legacy-request-1",
                    "legacy-request-1",
                    "2026-06-01 00:00:00",
                    "2026-06-01 00:00:00",
                ),
                (
                    20,
                    "legacy-diagram-hold",
                    2,
                    -50,
                    150,
                    "generate-diagram:2:legacy-request-2",
                    "legacy-request-2",
                    "2026-06-02 00:00:00",
                    "2026-06-02 00:00:00",
                ),
            ],
        )
        connection.commit()
        connection.close()

    def test_production_legacy_copy_migrates_idempotently_without_settling_holds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "production-copy.db"
            self._create_production_legacy_copy(database_path)
            database_url = f"sqlite:///{database_path}"

            first_engine = migrate_database(database_url)
            first_engine.dispose()
            second_engine = migrate_database(database_url)

            inspector = inspect(second_engine)
            columns = {
                column["name"]
                for column in inspector.get_columns("image_generation_tasks")
            }
            self.assertTrue(
                {
                    "request_fingerprint",
                    "settlement_status",
                    "image_url",
                    "result_size_bytes",
                    "result_expires_at",
                }.issubset(columns)
            )
            with second_engine.connect() as db:
                holds = db.execute(
                    text(
                        "SELECT id, amount, status, idempotency_key "
                        "FROM credit_transactions ORDER BY id"
                    )
                ).fetchall()
                users = db.execute(text("SELECT id, credits FROM users ORDER BY id")).fetchall()
                review_tasks = db.execute(
                    text(
                        "SELECT request_id, status, settlement_status, hold_transaction_id "
                        "FROM image_generation_tasks ORDER BY hold_transaction_id"
                    )
                ).fetchall()
            self.assertEqual(
                holds,
                [
                    (10, -30, "PENDING", "generate:1:legacy-request-1"),
                    (20, -50, "PENDING", "generate-diagram:2:legacy-request-2"),
                ],
            )
            self.assertEqual(users, [(1, 170), (2, 150)])
            self.assertEqual(
                review_tasks,
                [
                    ("legacy-request-1", "reconciliation_required", "REVIEW_REQUIRED", 10),
                    ("legacy-request-2", "reconciliation_required", "REVIEW_REQUIRED", 20),
                ],
            )
            second_engine.dispose()

    def test_unique_user_request_and_hold_constraints_are_enforced(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "constraints.db"
            self._create_production_legacy_copy(database_path)
            migrate_database(f"sqlite:///{database_path}").dispose()
            connection = sqlite3.connect(database_path)
            connection.execute("DELETE FROM image_generation_tasks")
            connection.commit()
            row = (
                "task-one",
                "shared-request",
                1,
                10,
                "generate",
                "nano-banana-2",
                "a" * 64,
                "1K",
                "1:1",
                1,
                "ready",
                "PENDING",
                "2026-07-18 00:00:00",
                "2026-07-18 00:00:00",
            )
            connection.execute(
                """
                INSERT INTO image_generation_tasks (
                    task_id, request_id, user_id, hold_transaction_id,
                    entrypoint, selected_model, request_fingerprint,
                    resolution, aspect_ratio, num_images, status,
                    settlement_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )
            connection.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO image_generation_tasks (
                        task_id, request_id, user_id, entrypoint, selected_model,
                        request_fingerprint, resolution, aspect_ratio, num_images,
                        status, settlement_status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "task-duplicate-request",
                        "shared-request",
                        1,
                        "generate",
                        "nano-banana-2",
                        "b" * 64,
                        "1K",
                        "1:1",
                        1,
                        "ready",
                        "PENDING",
                        "2026-07-18 00:00:01",
                        "2026-07-18 00:00:01",
                    ),
                )
            connection.rollback()
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO image_generation_tasks (
                        task_id, request_id, user_id, hold_transaction_id,
                        entrypoint, selected_model, request_fingerprint,
                        resolution, aspect_ratio, num_images, status,
                        settlement_status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "task-duplicate-hold",
                        "other-request",
                        2,
                        10,
                        "generate",
                        "nano-banana-2",
                        "c" * 64,
                        "1K",
                        "1:1",
                        1,
                        "ready",
                        "PENDING",
                        "2026-07-18 00:00:02",
                        "2026-07-18 00:00:02",
                    ),
                )
            connection.close()


if __name__ == "__main__":
    unittest.main()
