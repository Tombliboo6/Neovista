import pathlib
import sqlite3
import sys
import tempfile
import unittest

from sqlalchemy import create_engine, inspect, text


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from migrate_video_generation_schema import migrate_database


class VideoGenerationMigrationTest(unittest.TestCase):
    def _create_legacy_database(self, database_path: pathlib.Path):
        connection = sqlite3.connect(database_path)
        connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.executemany("INSERT INTO users (id) VALUES (?)", [(1,), (2,)])
        connection.execute(
            """
            CREATE TABLE credit_transactions (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                type VARCHAR(32) NOT NULL,
                amount INTEGER NOT NULL,
                status VARCHAR(16) NOT NULL,
                settlement_key VARCHAR(128),
                related_request_id VARCHAR(64),
                created_at DATETIME NOT NULL
            )
            """
        )
        connection.executemany(
            """
            INSERT INTO credit_transactions (
                id, user_id, type, amount, status,
                settlement_key, related_request_id, created_at
            ) VALUES (?, ?, 'GENERATE_HOLD', -1250, 'PENDING', NULL, ?, ?)
            """,
            [
                (10, 1, "shared-request", "2026-07-01 00:00:00"),
                (20, 2, "shared-request", "2026-07-02 00:00:00"),
                (30, 1, "second-request", "2026-07-01 00:10:00"),
            ],
        )
        connection.execute(
            """
            CREATE TABLE video_generation_tasks (
                id INTEGER PRIMARY KEY,
                task_id VARCHAR(96) NOT NULL UNIQUE,
                request_id VARCHAR(64) NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                hold_transaction_id INTEGER NOT NULL,
                selected_model VARCHAR(64) NOT NULL,
                provider_model VARCHAR(96) NOT NULL,
                api_format VARCHAR(16) NOT NULL DEFAULT 'v3',
                prompt TEXT NOT NULL,
                aspect_ratio VARCHAR(16) NOT NULL,
                resolution VARCHAR(16) NOT NULL DEFAULT '720p',
                duration_seconds INTEGER NOT NULL,
                status VARCHAR(24) NOT NULL,
                video_url TEXT,
                error_message TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO video_generation_tasks (
                id, task_id, request_id, user_id, hold_transaction_id,
                selected_model, provider_model, api_format, prompt,
                aspect_ratio, resolution, duration_seconds, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                "provider-legacy-task",
                "shared-request",
                1,
                10,
                "seedance-2.0",
                "doubao-seedance-2-0",
                "v3",
                "legacy prompt",
                "16:9",
                "720p",
                5,
                "submitted",
                "2026-07-01 00:00:00",
                "2026-07-01 00:00:00",
            ),
        )
        connection.commit()
        connection.close()

    def _unique_index_columns(self, engine):
        with engine.connect() as connection:
            rows = connection.execute(text("PRAGMA index_list(video_generation_tasks)")).fetchall()
            result = set()
            for row in rows:
                if not row[2]:
                    continue
                index_rows = connection.execute(
                    text(f'PRAGMA index_info("{row[1]}")')
                ).fetchall()
                result.add(tuple(index_row[2] for index_row in index_rows))
            return result

    def test_migration_is_idempotent_and_scopes_request_id_to_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "legacy-video.db"
            self._create_legacy_database(database_path)
            database_url = f"sqlite:///{database_path}"

            first_engine = migrate_database(database_url)
            first_engine.dispose()

            connection = sqlite3.connect(database_path)
            connection.execute(
                """
                INSERT INTO video_generation_tasks (
                    task_id, provider_task_id, request_id, user_id,
                    hold_transaction_id, selected_model, provider_model,
                    prompt, aspect_ratio, duration_seconds, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "local-intent-task",
                    None,
                    "shared-request",
                    2,
                    20,
                    "seedance-2.0",
                    "doubao-seedance-2-0",
                    "new prompt",
                    "16:9",
                    5,
                    "SUBMITTING",
                    "2026-07-02 00:00:00",
                    "2026-07-02 00:00:00",
                ),
            )
            connection.commit()
            connection.close()

            second_engine = migrate_database(database_url)
            inspector = inspect(second_engine)
            columns = {column["name"] for column in inspector.get_columns("video_generation_tasks")}
            self.assertTrue(
                {
                    "provider_task_id",
                    "attempt_count",
                    "next_poll_at",
                    "last_polled_at",
                    "deadline_at",
                    "finished_at",
                    "settlement_status",
                    "reference_paths",
                    "last_provider_error",
                    "request_fingerprint",
                }.issubset(columns)
            )

            unique_column_sets = self._unique_index_columns(second_engine)
            self.assertIn(("user_id", "request_id"), unique_column_sets)
            self.assertIn(("provider_task_id",), unique_column_sets)
            self.assertIn(("hold_transaction_id",), unique_column_sets)
            self.assertNotIn(("request_id",), unique_column_sets)

            with second_engine.connect() as db:
                rows = db.execute(
                    text(
                        "SELECT task_id, provider_task_id, attempt_count, settlement_status, deadline_at "
                        "FROM video_generation_tasks ORDER BY id"
                    )
                ).fetchall()
            self.assertEqual(rows[0][:4], ("provider-legacy-task", "provider-legacy-task", 0, "PENDING"))
            self.assertIsNotNone(rows[0][4])
            self.assertEqual(rows[1][:4], ("local-intent-task", None, 0, "PENDING"))
            self.assertIsNotNone(rows[1][4])
            second_engine.dispose()

            connection = sqlite3.connect(database_path)
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO video_generation_tasks (
                        task_id, request_id, user_id, hold_transaction_id,
                        selected_model, provider_model, prompt, aspect_ratio,
                        duration_seconds, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "same-user-duplicate",
                        "shared-request",
                        1,
                        30,
                        "seedance-2.0",
                        "doubao-seedance-2-0",
                        "duplicate",
                        "16:9",
                        5,
                        "SUBMITTING",
                        "2026-07-03 00:00:00",
                        "2026-07-03 00:00:00",
                    ),
                )
            connection.close()

    def test_migration_refuses_multiple_unresolved_tasks_for_one_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "duplicate-active-video.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                """
                INSERT INTO video_generation_tasks (
                    id, task_id, request_id, user_id, hold_transaction_id,
                    selected_model, provider_model, api_format, prompt,
                    aspect_ratio, resolution, duration_seconds, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    2,
                    "provider-second-active",
                    "second-request",
                    1,
                    30,
                    "seedance-2.0",
                    "doubao-seedance-2-0",
                    "v3",
                    "second prompt",
                    "16:9",
                    "720p",
                    5,
                    "running",
                    "2026-07-01 00:10:00",
                    "2026-07-01 00:10:00",
                ),
            )
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(RuntimeError, "投影后.*多个未完成/待复核"):
                migrate_database(f"sqlite:///{database_path}")

    def test_migration_canonicalizes_legacy_provider_active_statuses(self):
        expected_statuses = {
            "queued": "submitted",
            "pending": "submitted",
            "created": "submitted",
            "processing": "running",
        }
        for legacy_status, expected_status in expected_statuses.items():
            with self.subTest(legacy_status=legacy_status), tempfile.TemporaryDirectory() as tmpdir:
                database_path = pathlib.Path(tmpdir) / f"legacy-{legacy_status}.db"
                self._create_legacy_database(database_path)
                connection = sqlite3.connect(database_path)
                connection.execute(
                    "UPDATE video_generation_tasks SET status = ? WHERE id = 1",
                    (legacy_status,),
                )
                connection.commit()
                connection.close()

                engine = migrate_database(f"sqlite:///{database_path}")
                with engine.connect() as db:
                    row = db.execute(
                        text(
                            "SELECT status, settlement_status, deadline_at "
                            "FROM video_generation_tasks WHERE id = 1"
                        )
                    ).one()
                self.assertEqual(row[0], expected_status)
                self.assertEqual(row[1], "PENDING")
                self.assertIsNotNone(row[2])
                engine.dispose()

                connection = sqlite3.connect(database_path)
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        """
                        INSERT INTO video_generation_tasks (
                            task_id, request_id, user_id, hold_transaction_id,
                            selected_model, provider_model, prompt, aspect_ratio,
                            duration_seconds, status, created_at, updated_at
                        ) VALUES (
                            ?, ?, 1, 30, 'seedance-2.0', 'doubao-seedance-2-0',
                            'must be blocked', '16:9', 5, 'running',
                            '2026-07-01 00:10:00', '2026-07-01 00:10:00'
                        )
                        """,
                        (f"second-{legacy_status}", f"second-request-{legacy_status}"),
                    )
                connection.close()

    def test_migration_upgrades_an_existing_older_partial_unique_index(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "upgrade-partial-index.db"
            self._create_legacy_database(database_path)
            engine = migrate_database(f"sqlite:///{database_path}")
            engine.dispose()

            connection = sqlite3.connect(database_path)
            connection.execute("DROP INDEX uq_video_generation_tasks_user_unresolved")
            connection.execute(
                """
                CREATE UNIQUE INDEX uq_video_generation_tasks_user_unresolved
                ON video_generation_tasks (user_id)
                WHERE lower(status) IN (
                    'ready','creating','submitting','submit_unknown','submitted',
                    'running','finalizing','reconciliation_required'
                )
                """
            )
            connection.commit()
            connection.close()

            upgraded_engine = migrate_database(f"sqlite:///{database_path}")
            with upgraded_engine.connect() as db:
                index_sql = db.execute(
                    text(
                        "SELECT sql FROM sqlite_master WHERE type = 'index' "
                        "AND name = 'uq_video_generation_tasks_user_unresolved'"
                    )
                ).scalar_one()
            for status in ("queued", "pending", "created", "processing"):
                self.assertIn(status, index_sql.lower())
            upgraded_engine.dispose()

    def test_terminal_success_requires_capture_settlement_row(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "missing-capture.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'succeeded' WHERE id = 1"
            )
            connection.execute(
                "UPDATE credit_transactions SET status = 'SUCCESS' WHERE id = 10"
            )
            connection.commit()
            connection.close()

            engine = migrate_database(f"sqlite:///{database_path}")
            with engine.connect() as db:
                row = db.execute(
                    text(
                        "SELECT status, settlement_status FROM video_generation_tasks "
                        "WHERE id = 1"
                    )
                ).one()
            self.assertEqual(row, ("reconciliation_required", "REVIEW_REQUIRED"))
            engine.dispose()

    def test_terminal_failure_requires_refund_settlement_row(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "missing-refund.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'failed' WHERE id = 1"
            )
            connection.execute(
                "UPDATE credit_transactions SET status = 'REFUNDED' WHERE id = 10"
            )
            connection.commit()
            connection.close()

            engine = migrate_database(f"sqlite:///{database_path}")
            with engine.connect() as db:
                row = db.execute(
                    text(
                        "SELECT status, settlement_status FROM video_generation_tasks "
                        "WHERE id = 1"
                    )
                ).one()
            self.assertEqual(row, ("reconciliation_required", "REVIEW_REQUIRED"))
            engine.dispose()

    def test_terminal_success_accepts_one_matching_legacy_capture(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "matching-capture.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'succeeded' WHERE id = 1"
            )
            connection.execute(
                "UPDATE credit_transactions SET status = 'SUCCESS' WHERE id = 10"
            )
            connection.execute(
                """
                INSERT INTO credit_transactions (
                    id, user_id, type, amount, status,
                    settlement_key, related_request_id, created_at
                ) VALUES (
                    100, 1, 'GENERATE_CAPTURE', 0, 'SUCCESS',
                    NULL, 'shared-request', '2026-07-01 00:01:00'
                )
                """
            )
            connection.commit()
            connection.close()

            engine = migrate_database(f"sqlite:///{database_path}")
            with engine.connect() as db:
                row = db.execute(
                    text(
                        "SELECT status, settlement_status FROM video_generation_tasks "
                        "WHERE id = 1"
                    )
                ).one()
            self.assertEqual(row, ("succeeded", "CAPTURED"))
            engine.dispose()

    def test_terminal_failure_accepts_one_matching_keyed_refund(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "matching-refund.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'failed' WHERE id = 1"
            )
            connection.execute(
                "UPDATE credit_transactions SET status = 'REFUNDED' WHERE id = 10"
            )
            connection.execute(
                """
                INSERT INTO credit_transactions (
                    id, user_id, type, amount, status,
                    settlement_key, related_request_id, created_at
                ) VALUES (
                    100, 1, 'GENERATE_REFUND', 1250, 'SUCCESS',
                    'generation-hold:10:settlement', 'shared-request',
                    '2026-07-01 00:01:00'
                )
                """
            )
            connection.commit()
            connection.close()

            engine = migrate_database(f"sqlite:///{database_path}")
            with engine.connect() as db:
                row = db.execute(
                    text(
                        "SELECT status, settlement_status FROM video_generation_tasks "
                        "WHERE id = 1"
                    )
                ).one()
            self.assertEqual(row, ("failed", "REFUNDED"))
            engine.dispose()

    def test_terminal_success_with_opposite_settlement_requires_review(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "opposite-settlement.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'succeeded' WHERE id = 1"
            )
            connection.execute(
                "UPDATE credit_transactions SET status = 'SUCCESS' WHERE id = 10"
            )
            connection.executemany(
                """
                INSERT INTO credit_transactions (
                    id, user_id, type, amount, status,
                    settlement_key, related_request_id, created_at
                ) VALUES (?, 1, ?, ?, 'SUCCESS', NULL, 'shared-request', ?)
                """,
                [
                    (100, "GENERATE_CAPTURE", 0, "2026-07-01 00:01:00"),
                    (101, "GENERATE_REFUND", 1250, "2026-07-01 00:02:00"),
                ],
            )
            connection.commit()
            connection.close()

            engine = migrate_database(f"sqlite:///{database_path}")
            with engine.connect() as db:
                row = db.execute(
                    text(
                        "SELECT status, settlement_status FROM video_generation_tasks "
                        "WHERE id = 1"
                    )
                ).one()
            self.assertEqual(row, ("reconciliation_required", "REVIEW_REQUIRED"))
            engine.dispose()

    def test_migration_preflights_active_plus_future_review_for_same_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "active-plus-review.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                """
                INSERT INTO video_generation_tasks (
                    id, task_id, request_id, user_id, hold_transaction_id,
                    selected_model, provider_model, api_format, prompt,
                    aspect_ratio, resolution, duration_seconds, status,
                    created_at, updated_at
                ) VALUES (2, 'provider-terminal', 'terminal-request', 1, 30,
                    'seedance-2.0', 'doubao-seedance-2-0', 'v3', 'terminal prompt',
                    '16:9', '720p', 5, 'succeeded',
                    '2026-07-01 00:10:00', '2026-07-01 00:10:00')
                """
            )
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(RuntimeError, "投影后.*多个未完成/待复核"):
                migrate_database(f"sqlite:///{database_path}")

    def test_migration_preflights_two_future_reviews_for_same_user(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "two-future-reviews.db"
            self._create_legacy_database(database_path)
            connection = sqlite3.connect(database_path)
            connection.execute(
                "UPDATE video_generation_tasks SET status = 'succeeded' WHERE id = 1"
            )
            connection.execute(
                """
                INSERT INTO video_generation_tasks (
                    id, task_id, request_id, user_id, hold_transaction_id,
                    selected_model, provider_model, api_format, prompt,
                    aspect_ratio, resolution, duration_seconds, status,
                    created_at, updated_at
                ) VALUES (2, 'provider-terminal-2', 'terminal-request-2', 1, 30,
                    'seedance-2.0', 'doubao-seedance-2-0', 'v3', 'terminal prompt 2',
                    '16:9', '720p', 5, 'failed',
                    '2026-07-01 00:10:00', '2026-07-01 00:10:00')
                """
            )
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(RuntimeError, "投影后.*多个未完成/待复核"):
                migrate_database(f"sqlite:///{database_path}")

    def test_failed_future_review_preflight_preserves_existing_partial_unique_index(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database_path = pathlib.Path(tmpdir) / "preserve-partial-index.db"
            self._create_legacy_database(database_path)
            migrated_engine = migrate_database(f"sqlite:///{database_path}")
            migrated_engine.dispose()

            connection = sqlite3.connect(database_path)
            connection.execute("DROP INDEX uq_video_generation_tasks_user_unresolved")
            connection.execute(
                """
                CREATE UNIQUE INDEX uq_video_generation_tasks_user_unresolved
                ON video_generation_tasks (user_id)
                WHERE lower(status) IN (
                    'ready','creating','submitting','submit_unknown','submitted',
                    'running','finalizing','reconciliation_required'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO video_generation_tasks (
                    task_id, provider_task_id, request_id, user_id, hold_transaction_id,
                    selected_model, provider_model, api_format, prompt, aspect_ratio,
                    resolution, duration_seconds, status, settlement_status,
                    attempt_count, created_at, updated_at
                ) VALUES (
                    'local-terminal-mismatch', 'provider-terminal-mismatch',
                    'terminal-mismatch-request', 1, 30, 'seedance-2.0',
                    'doubao-seedance-2-0', 'v3', 'terminal mismatch', '16:9',
                    '720p', 5, 'succeeded', 'PENDING', 0,
                    '2026-07-01 00:10:00', '2026-07-01 00:10:00'
                )
                """
            )
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(RuntimeError, "投影后.*多个未完成/待复核"):
                migrate_database(f"sqlite:///{database_path}")

            connection = sqlite3.connect(database_path)
            index_names = {row[1] for row in connection.execute(
                "PRAGMA index_list(video_generation_tasks)"
            ).fetchall()}
            self.assertIn("uq_video_generation_tasks_user_unresolved", index_names)
            index_sql = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'index' "
                "AND name = 'uq_video_generation_tasks_user_unresolved'"
            ).fetchone()[0]
            self.assertNotIn("processing", index_sql.lower())
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """
                    INSERT INTO video_generation_tasks (
                        task_id, request_id, user_id, hold_transaction_id,
                        selected_model, provider_model, prompt, aspect_ratio,
                        duration_seconds, status, created_at, updated_at
                    ) VALUES (
                        'second-active-after-failure', 'second-active-request', 1, 20,
                        'seedance-2.0', 'doubao-seedance-2-0', 'second active', '16:9',
                        5, 'running', '2026-07-01 00:20:00', '2026-07-01 00:20:00'
                    )
                    """
                )
            connection.close()


if __name__ == "__main__":
    unittest.main()
