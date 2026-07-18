import os
import re
import sqlite3
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


DEPLOY = Path(__file__).resolve().parents[1]
SCRIPTS = DEPLOY / "scripts"


class ReleaseHardeningTests(unittest.TestCase):
    def test_shell_scripts_parse_are_executable_and_paid_scripts_refuse(self):
        scripts = sorted(SCRIPTS.glob("*.sh"))
        self.assertTrue(scripts)
        for script in scripts:
            with self.subTest(script=script.name):
                self.assertTrue(os.access(script, os.X_OK))
                subprocess.run(["bash", "-n", str(script)], check=True)

        for name, refusal in (
            ("migrate-neovista-production.sh", "Refusing to enter maintenance mode"),
            ("smoke-neovista-production.sh", "Refusing paid smoke test"),
            ("rollback-neovista-production.sh", "Refusing paired production rollback"),
        ):
            result = subprocess.run(
                ["bash", str(SCRIPTS / name)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn(refusal, result.stderr)

    def test_migration_is_root_only_manifest_bound_and_leaves_edge_stopped(self):
        source = (SCRIPTS / "migrate-neovista-production.sh").read_text()
        for required in (
            'BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/neovista/releases}"',
            'EXPECTED_CANDIDATE_MANIFEST="${EXPECTED_CANDIDATE_MANIFEST:?',
            'CANDIDATE_VENV="${CANDIDATE_VENV:?',
            '$(basename -- "$CANDIDATE_VENV_REAL")" == "$RELEASE_CODE_REF"',
            'cmp -s "$EXPECTED_SORTED" "$ACTUAL_MANIFEST"',
            "Stray Uvicorn process remains",
            "Port 8000 is still listening",
            "A process still holds the production database",
            "stop_release_services_fail_closed",
            "systemctl kill --kill-who=all --signal=KILL",
            "ix_chat_sessions_user_id",
            "require_env_equals IMAGE_GENERATION_FEATURE_ENABLED false",
            "require_env_equals DATABASE_SCHEMA_AUTO_CREATE_ENABLED false",
            'CANONICAL_ROLLBACK_DATABASE_BACKUP="${CANONICAL_ROLLBACK_DATABASE_BACKUP:-}"',
            'canonical_database_file="canonical-neovista.db"',
            'migration_database_url="sqlite:///$DB_PATH"',
            'DATABASE_URL="$migration_database_url"',
            'rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/neovista.conf',
            '! -type l',
            "Nginx remains stopped",
        ):
            with self.subTest(required=required):
                self.assertIn(required, source)
        start_api = source.rindex('systemctl start "$SERVICE"')
        final_stopped_assertion = source.index(
            "! systemctl is-active --quiet nginx", start_api
        )
        self.assertLess(start_api, final_stopped_assertion)

        rollback_source = (SCRIPTS / "rollback-neovista-production.sh").read_text()
        self.assertIn('CANONICAL_DATABASE_FILE="$(manifest_value canonical_database_file', rollback_source)
        self.assertIn('[[ "$count" == "1" ]] || return 1', rollback_source)
        self.assertIn('$RELEASE_BACKUP_REAL/$CANONICAL_DATABASE_FILE', rollback_source)
        self.assertIn('mv -Tf "$restore_tmp" "$DB_PATH"', rollback_source)
        self.assertNotIn('install -m 600 -o ecs-user -g ecs-user "$restore_tmp" "$DB_PATH"', rollback_source)

        unit_source = (DEPLOY / "systemd" / "neovista-api.service").read_text()
        self.assertIn(
            'Environment="PATH=/var/www/neovista/backend/.venv-current/bin:',
            unit_source,
        )
        self.assertIn(":/usr/bin:/sbin:/bin\"", unit_source)

    def test_pre_migration_inventory_uses_only_legacy_video_columns(self):
        source = (SCRIPTS / "migrate-neovista-production.sh").read_text()
        inventory_start = source.index("# Inventory contains identifiers/status only")
        migration_start = source.index('for migration in "${migrations[@]}"', inventory_start)
        inventory_block = source[inventory_start:migration_start]
        self.assertIn("SELECT task_id,status,hold_transaction_id", inventory_block)
        self.assertNotIn("provider_task_id", inventory_block)
        self.assertNotIn("settlement_status", inventory_block)

    def test_environment_updater_is_nonsecret_allowlisted_and_refuses_by_default(self):
        updater = SCRIPTS / "update-neovista-production-env.sh"
        source = updater.read_text()
        for required in (
            'keys[++count] = "NEOVISTA_ENV"; values[count] = "production"',
            'keys[++count] = "DATABASE_SCHEMA_AUTO_CREATE_ENABLED"; values[count] = "false"',
            'keys[++count] = "DATABASE_URL"; values[count] = "sqlite:////var/lib/neovista/neovista.db"',
            'keys[++count] = "IMAGE_GENERATION_FEATURE_ENABLED"; values[count] = "false"',
            'keys[++count] = "SEEDANCE_FEATURE_ENABLED"; values[count] = "false"',
            'keys[++count] = "API_CHANNEL_3_PRODUCT_MODEL"; values[count] = "nano-banana-pro"',
            'keys[++count] = "API_CHANNEL_3_MODEL"; values[count] = "nano-banana-pro"',
        ):
            with self.subTest(required=required):
                self.assertIn(required, source)
        for forbidden in (
            'keys[++count] = "ADMIN_SECRET_KEY"',
            'keys[++count] = "JWT_SECRET_KEY"',
            'keys[++count] = "SEEDANCE_API_KEY"',
            'keys[++count] = "SEEDANCE_BASE_URL"',
            'keys[++count] = "API_CHANNEL_1_KEY"',
            'keys[++count] = "API_CHANNEL_1_BASE_URL"',
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        refused = subprocess.run(
            ["bash", str(updater)], capture_output=True, text=True, check=False
        )
        self.assertEqual(refused.returncode, 2)
        self.assertIn("Refusing production environment update", refused.stderr)

        awk_match = re.search(
            r"\nawk '(.*?)\n' \"\$ENV_FILE\" >\"\$next\"",
            source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(awk_match)
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / ".env"
            env_file.write_text(
                "ADMIN_SECRET_KEY=must-remain-byte-for-byte\n"
                "API_CHANNEL_1_API_KEY=must-also-remain\n"
                "NEOVISTA_ENV=development\n"
                "NEOVISTA_ENV=duplicate\n"
                "API_CHANNEL_3_MODEL=old-flash-route\n"
            )
            transformed = subprocess.run(
                ["awk", awk_match.group(1), str(env_file)],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        self.assertIn("ADMIN_SECRET_KEY=must-remain-byte-for-byte\n", transformed)
        self.assertIn("API_CHANNEL_1_API_KEY=must-also-remain\n", transformed)
        self.assertEqual(transformed.count("NEOVISTA_ENV="), 1)
        self.assertIn("NEOVISTA_ENV=production\n", transformed)
        self.assertEqual(transformed.count("API_CHANNEL_3_MODEL="), 1)
        self.assertIn("API_CHANNEL_3_MODEL=nano-banana-pro\n", transformed)

    def test_smoke_has_stable_ids_exact_cost_and_reference_only_edge(self):
        source = (SCRIPTS / "smoke-neovista-production.sh").read_text()
        for required in (
            "/var/backups/neovista/smoke",
            "expected_image_request_id",
            "expected_video_request_id",
            "image_task_count",
            "video_task_count",
            'resolution:"1K"',
            'duration_seconds:5,resolution:"720p"',
            'video_mode:"first_frame"',
            "--slurpfile image",
            "abs(h.amount)=30",
            "abs(h.amount)=1250",
            "set_feature_flags false",
            "neovista-cn-smoke-reference.conf",
            "video_was_terminal",
            "neovista_require_terminal_reference_evidence",
            "expected_video_retry_request_id",
            "neovista_require_refunded_video_attempt_eligible",
            "video-attempt-a2.env",
            "video-request-a2.json",
            "reference$VIDEO_ATTEMPT_SUFFIX",
            "NET_SMOKE_SPEND",
        ):
            with self.subTest(required=required):
                self.assertIn(required, source)
        persist_reference = source.index('reference_state="$reference_prefix.env"')
        terminal_guard = source.index(
            "neovista_require_terminal_reference_evidence", persist_reference
        )
        database_recovery = source.index(
            "SELECT CASE WHEN json_valid(reference_paths)", terminal_guard
        )
        poll_provider = source.index("for _ in $(seq 1 120)")
        self.assertLess(terminal_guard, database_recovery)
        self.assertLess(persist_reference, poll_provider)

    def test_terminal_video_resume_requires_existing_reference_evidence(self):
        guard = SCRIPTS / "smoke-state-guards.sh"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = [root / name for name in ("state", "get", "head", "post")]
            command = (
                f'source "{guard}"; '
                "neovista_require_terminal_reference_evidence succeeded CAPTURED "
                + " ".join(f'"{path}"' for path in files)
            )
            missing = subprocess.run(
                ["bash", "-c", command], capture_output=True, text=True, check=False
            )
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("refusing replay/new request", missing.stderr)
            for path in files:
                path.touch()
            complete = subprocess.run(
                ["bash", "-c", command], capture_output=True, text=True, check=False
            )
            self.assertEqual(complete.returncode, 0)
            files[0].unlink()
            files[0].symlink_to(files[1])
            symlinked = subprocess.run(
                ["bash", "-c", command], capture_output=True, text=True, check=False
            )
            self.assertNotEqual(symlinked.returncode, 0)
            files[0].unlink()
            files[0].touch()
            nonterminal = subprocess.run(
                [
                    "bash",
                    "-c",
                    f'source "{guard}"; neovista_require_terminal_reference_evidence '
                    f'running PENDING "{files[0]}.missing" "{files[1]}.missing" '
                    f'"{files[2]}.missing" "{files[3]}.missing"',
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(nonterminal.returncode, 0)

    def test_refunded_video_retry_guard_requires_exact_preaccept_rejection_ledger(self):
        guard = SCRIPTS / "smoke-state-guards.sh"
        request_id = "prod-video-smoke-eligible-a1"

        def create_database(path, mutations=()):
            with sqlite3.connect(path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE video_generation_tasks (
                      id INTEGER PRIMARY KEY, user_id INTEGER, request_id TEXT,
                      hold_transaction_id INTEGER, status TEXT,
                      settlement_status TEXT, provider_task_id TEXT,
                      video_url TEXT, api_format TEXT, selected_model TEXT,
                      duration_seconds INTEGER, resolution TEXT,
                      aspect_ratio TEXT, request_fingerprint TEXT
                    );
                    CREATE TABLE credit_transactions (
                      id INTEGER PRIMARY KEY, user_id INTEGER,
                      related_request_id TEXT, type TEXT, status TEXT,
                      amount INTEGER, idempotency_key TEXT,
                      settlement_key TEXT, error_code TEXT
                    );
                    CREATE TABLE generation_events (
                      id INTEGER PRIMARY KEY, user_id INTEGER,
                      request_id TEXT, entrypoint TEXT, status TEXT,
                      error_code TEXT
                    );
                    """
                )
                connection.execute(
                    "INSERT INTO video_generation_tasks VALUES "
                    "(1,25,?,208,'failed','REFUNDED',NULL,NULL,'v3',"
                    "'seedance-2.0',5,'720p','16:9',?)",
                    (request_id, "a" * 64),
                )
                connection.execute(
                    "INSERT INTO credit_transactions VALUES "
                    "(208,25,?,'GENERATE_HOLD','REFUNDED',-1250,NULL,NULL,"
                    "'SEEDANCE_CREATE_REJECTED')",
                    (request_id,),
                )
                connection.execute(
                    "INSERT INTO credit_transactions VALUES "
                    "(209,25,?,'GENERATE_REFUND','SUCCESS',1250,NULL,"
                    "'generation-hold:208:settlement','SEEDANCE_CREATE_REJECTED')",
                    (request_id,),
                )
                connection.execute(
                    "INSERT INTO generation_events VALUES "
                    "(46,25,?,'video_generate','FAILED','SEEDANCE_CREATE_REJECTED')",
                    (request_id,),
                )
                for statement, parameters in mutations:
                    connection.execute(statement, parameters)

        def run_guard(database):
            return subprocess.run(
                [
                    "bash",
                    "-c",
                    'source "$1"; '
                    'neovista_require_refunded_video_attempt_eligible "$2" "$3" "$4"',
                    "bash",
                    str(guard),
                    str(database),
                    "25",
                    request_id,
                ],
                capture_output=True,
                text=True,
                check=False,
            )

        cases = {
            "valid": (),
            "provider accepted": (
                ("UPDATE video_generation_tasks SET provider_task_id=?", ("provider-1",)),
            ),
            "review required": (
                ("UPDATE video_generation_tasks SET settlement_status=?", ("REVIEW_REQUIRED",)),
            ),
            "wrong refund": (
                ("UPDATE credit_transactions SET amount=1249 WHERE id=209", ()),
            ),
            "extra transaction": (
                (
                    "INSERT INTO credit_transactions VALUES "
                    "(210,25,?,'GENERATE_CAPTURE','SUCCESS',0,NULL,"
                    "'generation-hold:208:settlement',NULL)",
                    (request_id,),
                ),
            ),
            "extra event": (
                (
                    "INSERT INTO generation_events VALUES "
                    "(47,25,?,'video_generate','FAILED','SEEDANCE_CREATE_REJECTED')",
                    (request_id,),
                ),
            ),
        }
        with tempfile.TemporaryDirectory() as temporary:
            for index, (name, mutations) in enumerate(cases.items()):
                with self.subTest(case=name):
                    database = Path(temporary) / f"case-{index}.db"
                    create_database(database, mutations)
                    result = run_guard(database)
                    if name == "valid":
                        self.assertEqual(result.returncode, 0, result.stderr)
                    else:
                        self.assertNotEqual(result.returncode, 0)

    def test_runtime_preflight_enforces_unique_production_schema_flags(self):
        runtime = SCRIPTS / "check-neovista-runtime.sh"
        source = runtime.read_text()
        self.assertIn('[[ "$count" == "1" ]] || return 1', source)
        self.assertIn('[[ "$neovista_env" == "production" ]] || fail_runtime', source)
        self.assertIn('[[ "$schema_auto_create" == "false" ]] || fail_runtime', source)
        service = (DEPLOY / "systemd/neovista-api.service").read_text()
        self.assertIn("ExecStartPre=/var/www/neovista/deploy/scripts/check-neovista-runtime.sh", service)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "neovista.db"
            with sqlite3.connect(database) as connection:
                for table in (
                    "users",
                    "credit_transactions",
                    "chat_sessions",
                    "video_generation_tasks",
                    "image_generation_tasks",
                ):
                    connection.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
                connection.execute(
                    "CREATE INDEX ix_chat_sessions_user_id ON chat_sessions(id)"
                )
            os.chmod(database, 0o600)

            venv = root / "venv"
            (venv / "bin").mkdir(parents=True)
            python = venv / "bin/python"
            python.touch()
            os.chmod(python, 0o755)
            venv_link = root / "venv-current"
            venv_link.symlink_to(venv)

            # The production script intentionally expects ecs-user ownership and
            # GNU stat output. Mock only stat so this Mac test can exercise the
            # real parser/SQLite/symlink checks without weakening production code.
            tools = root / "tools"
            tools.mkdir()
            stat_tool = tools / "stat"
            stat_tool.write_text("#!/usr/bin/env bash\nprintf 'ecs-user:ecs-user:600\\n'\n")
            os.chmod(stat_tool, 0o755)

            env_file = root / ".env"
            environment = {
                **os.environ,
                "PATH": f"{tools}:{os.environ['PATH']}",
                "DATABASE_PATH": str(database),
                "NEOVISTA_ENV_FILE": str(env_file),
                "NEOVISTA_VENV_LINK": str(venv_link),
            }

            def run_with(lines):
                env_file.write_text("\n".join(lines) + "\n")
                os.chmod(env_file, 0o600)
                return subprocess.run(
                    [str(runtime)],
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )

            self.assertEqual(
                run_with(
                    [
                        "NEOVISTA_ENV=production",
                        "DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false",
                    ]
                ).returncode,
                0,
            )
            self.assertNotEqual(
                run_with(
                    [
                        "NEOVISTA_ENV=development",
                        "DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false",
                    ]
                ).returncode,
                0,
            )
            self.assertNotEqual(
                run_with(
                    [
                        "NEOVISTA_ENV=production",
                        "NEOVISTA_ENV=production",
                        "DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false",
                    ]
                ).returncode,
                0,
            )
            self.assertNotEqual(
                run_with(
                    [
                        "NEOVISTA_ENV=production",
                        "DATABASE_SCHEMA_AUTO_CREATE_ENABLED=true",
                    ]
                ).returncode,
                0,
            )

    def test_nginx_modes_are_fail_closed_and_body_limit_matches_backend(self):
        production = (DEPLOY / "nginx/neovista-cn.conf").read_text()
        smoke = (DEPLOY / "nginx/neovista-cn-smoke-reference.conf").read_text()
        maintenance = (DEPLOY / "nginx/neovista-cn-maintenance.conf").read_text()
        self.assertIn("client_max_body_size 26M", production)
        self.assertIn("location ^~ /static/seedance_references/", production)
        self.assertIn("limit_except GET HEAD", production)
        self.assertIn("no-store", production)
        self.assertIn("X-Robots-Tag", production)
        gallery = production[
            production.index("location ^~ /gallery/") :
            production.index("location = /favicon.ico")
        ]
        self.assertIn('max-age=3600, must-revalidate', gallery)
        self.assertNotIn("immutable", gallery)
        self.assertNotIn("proxy_pass", smoke)
        self.assertIn("limit_except GET HEAD", smoke)
        self.assertIn('return 503 "NeoVista production smoke test', smoke)
        self.assertNotIn("proxy_pass", maintenance)
        self.assertNotIn("seedance_references/ {", maintenance)

    def test_cleanup_supports_old_schema_preserves_active_and_rejects_other_root(self):
        cleanup = SCRIPTS / "cleanup-seedance-references.sh"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app"
            references = root / "backend/static/seedance_references"
            references.mkdir(parents=True)
            outside = Path(temporary) / "outside"
            outside.mkdir()
            database = Path(temporary) / "neovista.db"
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "CREATE TABLE video_generation_tasks "
                    "(id INTEGER PRIMARY KEY, status TEXT)"
                )
            legacy = references / "legacy.jpg"
            legacy.touch()
            old = time.time() - 48 * 3600
            os.utime(legacy, (old, old))
            environment = {
                **os.environ,
                "APP_ROOT": str(root),
                "DATABASE_PATH": str(database),
            }
            result = subprocess.run(
                [str(cleanup), "--delete", "--ttl-hours", "24"],
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertIn("eligible=1", result.stdout)
            self.assertFalse(legacy.exists())

            unsafe = subprocess.run(
                [str(cleanup), "--delete", "--ttl-hours", "24"],
                env={**environment, "SEEDANCE_REFERENCE_DIR": str(outside)},
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(unsafe.returncode, 2)
            self.assertIn("Refusing unsafe reference directory", unsafe.stderr)

            with sqlite3.connect(database) as connection:
                connection.execute(
                    "ALTER TABLE video_generation_tasks ADD COLUMN reference_paths TEXT"
                )
                connection.execute(
                    "INSERT INTO video_generation_tasks(status, reference_paths) "
                    "VALUES ('running', ?) ",
                    ('{"local_paths":["static/seedance_references/active.jpg"]}',),
                )
            active = references / "active.jpg"
            stale = references / "stale.jpg"
            active.touch()
            stale.touch()
            os.utime(active, (old, old))
            os.utime(stale, (old, old))
            subprocess.run(
                [str(cleanup), "--delete", "--ttl-hours", "24"],
                env=environment,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(active.exists())
            self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
