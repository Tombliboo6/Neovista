import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYSTEMD_CONFIG = ROOT / "deploy" / "systemd" / "neovista-api.service"
NGINX_CONFIG = ROOT / "deploy" / "nginx" / "neovista-cn.conf"
BOOTSTRAP_CONFIG = ROOT / "deploy" / "nginx" / "neovista-cn-bootstrap.conf"
RUNBOOK = ROOT / "deploy" / "PRODUCTION_RUNBOOK_NEOVISTA_CN.md"
MIGRATE_SCRIPT = ROOT / "deploy" / "scripts" / "migrate-neovista-production.sh"
CLEANUP_SCRIPT = ROOT / "deploy" / "scripts" / "cleanup-seedance-references.sh"
VERIFY_SCRIPT = ROOT / "deploy" / "scripts" / "verify-neovista-production.sh"
SMOKE_SCRIPT = ROOT / "deploy" / "scripts" / "smoke-neovista-production.sh"
ROLLBACK_SCRIPT = ROOT / "deploy" / "scripts" / "rollback-neovista-production.sh"
RUNTIME_CHECK = ROOT / "deploy" / "scripts" / "check-neovista-runtime.sh"
MAINTENANCE_CONFIG = ROOT / "deploy" / "nginx" / "neovista-cn-maintenance.conf"
SMOKE_CONFIG = ROOT / "deploy" / "nginx" / "neovista-cn-smoke-reference.conf"


class DeploymentHardeningTests(unittest.TestCase):
    def test_production_artifacts_do_not_reference_legacy_domain(self):
        production_files = (
            SYSTEMD_CONFIG,
            NGINX_CONFIG,
            BOOTSTRAP_CONFIG,
            RUNBOOK,
            MIGRATE_SCRIPT,
            CLEANUP_SCRIPT,
            VERIFY_SCRIPT,
            SMOKE_SCRIPT,
            ROLLBACK_SCRIPT,
            RUNTIME_CHECK,
            MAINTENANCE_CONFIG,
            SMOKE_CONFIG,
        )
        for path in production_files:
            with self.subTest(path=path):
                self.assertNotIn("neotest.site", path.read_text(encoding="utf-8"))

    def test_systemd_is_aliyun_single_process_and_local_proxy_only(self):
        service = SYSTEMD_CONFIG.read_text(encoding="utf-8")

        self.assertIn("User=ecs-user", service)
        self.assertIn("Group=ecs-user", service)
        self.assertIn("--host 127.0.0.1", service)
        self.assertIn("--proxy-headers", service)
        self.assertIn("--forwarded-allow-ips=127.0.0.1", service)
        exec_start = next(line for line in service.splitlines() if line.startswith("ExecStart="))
        self.assertNotIn("--workers", exec_start)
        self.assertIn("SEEDANCE_RECONCILER_ENABLED=true", service)
        self.assertIn("NEOVISTA_ENV=production", service)
        self.assertIn("DATABASE_SCHEMA_AUTO_CREATE_ENABLED=false", service)
        self.assertIn("check-neovista-runtime.sh", service)
        self.assertIn("exactly one Uvicorn process", service)

    def test_systemd_sandbox_has_only_required_write_paths(self):
        service = SYSTEMD_CONFIG.read_text(encoding="utf-8")
        required = (
            "UMask=0077",
            "NoNewPrivileges=true",
            "PrivateTmp=true",
            "PrivateDevices=true",
            "ProtectSystem=strict",
            "ProtectHome=true",
            "ProtectKernelTunables=true",
            "ProtectKernelModules=true",
            "ProtectKernelLogs=true",
            "ProtectControlGroups=true",
            "ReadOnlyPaths=/var/www/neovista/backend/.env",
            "ReadWritePaths=/var/lib/neovista",
            "ReadWritePaths=/var/www/neovista/backend/static",
            "RestrictSUIDSGID=true",
            "RestrictRealtime=true",
            "LockPersonality=true",
            "CapabilityBoundingSet=",
            "AmbientCapabilities=",
        )
        for directive in required:
            with self.subTest(directive=directive):
                self.assertIn(directive, service)

    def test_maintenance_migration_order_and_fail_closed_trap(self):
        script = MIGRATE_SCRIPT.read_text(encoding="utf-8")

        stop_nginx = script.index('systemctl stop nginx')
        stop_api = script.index('systemctl stop "$SERVICE"', stop_nginx)
        backup = script.index(".backup '$release_backup/neovista.db'", stop_api)
        billing = script.index("migrate_billing_schema.py")
        video = script.index("migrate_video_generation_schema.py", billing)
        image = script.index("migrate_image_generation_schema.py", video)
        migration_loop = script.index('for migration in "${migrations[@]}"', backup)
        start_api = script.rindex('systemctl start "$SERVICE"')
        nginx_still_stopped = script.index(
            "! systemctl is-active --quiet nginx", start_api
        )
        self.assertLess(stop_nginx, stop_api)
        self.assertLess(stop_api, backup)
        self.assertLess(billing, video)
        self.assertLess(video, image)
        self.assertLess(backup, migration_loop)
        self.assertLess(migration_loop, start_api)
        self.assertLess(start_api, nginx_still_stopped)
        self.assertIn("PRAGMA integrity_check", script)
        self.assertIn("PRAGMA foreign_key_check", script)
        self.assertIn("previous_artifact_dir", script)
        self.assertNotIn("git -C", script)
        self.assertIn("Do not roll back code alone", script)
        self.assertIn("/var/backups/neovista/releases", script)
        self.assertIn("EXPECTED_CANDIDATE_MANIFEST", script)
        self.assertIn("CANDIDATE_VENV", script)
        self.assertIn("/etc/nginx/sites-enabled/neovista", script)
        self.assertIn("/etc/nginx/sites-available/neovista", script)

    def test_reference_cleanup_is_dry_run_and_preserves_active_tasks(self):
        script = CLEANUP_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('MODE="dry-run"', script)
        self.assertIn("TTL_HOURS >= 24", script)
        self.assertIn("reconciliation_required", script)
        self.assertIn("json_each", script)
        self.assertIn('if [[ "$MODE" == "delete" ]]', script)

    def test_runbook_requires_strict_readiness_paid_cap_and_paired_rollback(self):
        guide = RUNBOOK.read_text(encoding="utf-8")

        self.assertIn("billing -> video -> image", guide)
        self.assertIn("`.backup`", guide)
        self.assertIn("status=ready", guide)
        self.assertIn("1K 生图 30 点，加 1 个 Seedance 2.0、5 秒、720p 视频 1250 点", guide)
        self.assertIn("合计恰好 1280 点", guide)
        self.assertIn("旧代码、旧 venv、旧 systemd unit 与迁移前 DB 必须成对恢复", guide)
        self.assertIn("SEEDANCE_FEATURE_ENABLED=false", guide)
        self.assertIn("SEEDANCE_FEATURE_ENABLED=true", guide)
        self.assertIn("IMAGE_GENERATION_FEATURE_ENABLED=false", guide)
        self.assertIn("IMAGE_GENERATION_FEATURE_ENABLED=true", guide)
        self.assertIn("PREVIOUS_ARTIFACT_DIR", guide)
        self.assertIn("reconciliation_required/REVIEW_REQUIRED", guide)

    def test_environment_and_image_review_gates_fail_closed(self):
        migrate = MIGRATE_SCRIPT.read_text(encoding="utf-8")
        verify = VERIFY_SCRIPT.read_text(encoding="utf-8")

        for expected in (
            "PUBLIC_BASE_URL",
            "CORS_ALLOW_ORIGINS",
            "NEOVISTA_ENV",
            "DATABASE_SCHEMA_AUTO_CREATE_ENABLED",
            "IMAGE_GENERATION_FEATURE_ENABLED",
            "SEEDANCE_FEATURE_ENABLED",
            "SEEDANCE_RECONCILER_ENABLED",
            "SEEDANCE_REFERENCE_ALLOWED_HOSTS",
            "SEEDANCE_REFERENCE_GC_ENABLED",
            "SEEDANCE_REFERENCE_TTL_SECONDS",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, migrate)
                self.assertIn(expected, verify)
        self.assertIn("IMAGE_REVIEW_REQUIRED", migrate)
        self.assertIn("ORPHAN_IMAGE_HOLDS", migrate)
        self.assertIn("never auto-refund", migrate)
        self.assertIn("ix_chat_sessions_user_id", migrate)
        self.assertIn("uq_image_generation_tasks_user_request", migrate)
        self.assertIn("uq_image_generation_tasks_hold_transaction_id", verify)

    def test_shell_scripts_parse_and_migrator_refuses_without_confirmation(self):
        for script in (
            MIGRATE_SCRIPT,
            CLEANUP_SCRIPT,
            VERIFY_SCRIPT,
            SMOKE_SCRIPT,
            ROLLBACK_SCRIPT,
            RUNTIME_CHECK,
        ):
            with self.subTest(script=script):
                subprocess.run(["bash", "-n", str(script)], check=True)

        result = subprocess.run(
            ["bash", str(MIGRATE_SCRIPT)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Refusing to enter maintenance mode", result.stderr)


if __name__ == "__main__":
    unittest.main()
