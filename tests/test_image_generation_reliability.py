import base64
import os
import pathlib
import sys
import unittest
import json
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("IMAGE_GENERATION_FEATURE_ENABLED", "true")
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main
from models import AdminAuditLog, Base, CreditTransaction, ImageGenerationTask, User

VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def _success_response(image_data=VALID_PNG_BASE64):
    return httpx.Response(
        200,
        request=httpx.Request("POST", "https://provider.example.com/generate"),
        json={
            "candidates": [{
                "content": {"parts": [{"inlineData": {"data": image_data}}]},
            }],
        },
    )


def _error_response(status_code):
    return httpx.Response(
        status_code,
        request=httpx.Request("POST", "https://provider.example.com/generate"),
        json={"error": "provider-secret-body-must-not-be-persisted"},
    )


class _CountingClient:
    calls = 0
    response = _success_response()
    responses = []
    raised_error = None

    def __init__(self, timeout):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        type(self).calls += 1
        if type(self).raised_error is not None:
            raise type(self).raised_error
        if type(self).responses:
            return type(self).responses.pop(0)
        return type(self).response


class ImageGenerationReliabilityTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()
        self.user = User(email="image-reliability@example.com", hashed_password="hash", credits=1000)
        self.admin = User(
            email="image-admin@example.com",
            hashed_password="hash",
            credits=0,
            is_admin=True,
        )
        self.db.add_all([self.user, self.admin])
        self.db.commit()
        self.db.refresh(self.user)
        self.db.refresh(self.admin)
        self.nano_channel = main.APIChannel(
            name="Nano relay",
            base_url="https://provider.example.com",
            api_key="provider-key",
            model="gemini-3.1-flash-image-preview",
            product_model="nano-banana-2",
        )
        _CountingClient.calls = 0
        _CountingClient.response = _success_response()
        _CountingClient.responses = []
        _CountingClient.raised_error = None

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _request(self, request_id, prompt="a safe prompt"):
        return main.GenerateRequest(
            template_id=None,
            user_params=prompt,
            request_id=request_id,
            resolution="1K",
            aspect_ratio="1:1",
            num_images=1,
            selected_model="nano-banana-2",
        )

    async def _generate(self, request):
        with patch.object(main, "API_CHANNELS", (self.nano_channel,)):
            with patch.object(main.httpx, "AsyncClient", _CountingClient):
                return await main.generate_image(request, self.user, self.db)

    async def test_completed_request_is_reused_without_second_provider_call_or_charge(self):
        request = self._request("image-idempotent-1")
        first = await self._generate(request)
        credits_after_first = first.remaining_credits
        second = await self._generate(request)

        self.assertEqual(first.image_url, second.image_url)
        self.assertEqual(second.remaining_credits, credits_after_first)
        self.assertEqual(_CountingClient.calls, 1)
        self.assertEqual(self.db.query(ImageGenerationTask).count(), 1)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_HOLD",
            ).count(),
            1,
        )
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_CAPTURE",
            ).count(),
            1,
        )

    async def test_post_commit_response_failure_never_downgrades_captured_success(self):
        original_builder = main._build_image_success_response_from_task
        calls = 0

        def flaky_builder(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("simulated response serialization failure")
            return original_builder(*args, **kwargs)

        with patch.object(main, "_build_image_success_response_from_task", side_effect=flaky_builder):
            response = await self._generate(self._request("image-post-commit-recovery"))

        self.assertEqual(response.request_id, "image-post-commit-recovery")
        task = self.db.query(ImageGenerationTask).one()
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        self.assertEqual(task.status, "succeeded")
        self.assertEqual(task.settlement_status, "CAPTURED")
        self.assertEqual(hold.status, "SUCCESS")
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_CAPTURE",
            ).count(),
            1,
        )

    async def test_owner_can_recover_image_by_request_and_other_user_cannot(self):
        await self._generate(self._request("image-owner-recovery"))
        recovered = await main.get_image_generation_task_by_request_id(
            "image-owner-recovery",
            self.user,
            self.db,
        )
        self.assertEqual(recovered.status, "succeeded")
        self.assertEqual(recovered.settlement_status, "CAPTURED")
        self.assertTrue(recovered.image_url.startswith("data:image/png;base64,"))

        other_user = User(email="image-other@example.com", hashed_password="hash", credits=1000)
        self.db.add(other_user)
        self.db.commit()
        self.db.refresh(other_user)
        with self.assertRaises(HTTPException) as context:
            await main.get_image_generation_task_by_request_id(
                "image-owner-recovery",
                other_user,
                self.db,
            )
        self.assertEqual(context.exception.status_code, 404)

    async def test_feature_flag_blocks_before_hold_and_provider(self):
        with patch.dict(os.environ, {"IMAGE_GENERATION_FEATURE_ENABLED": "false"}):
            with self.assertRaises(HTTPException) as context:
                await self._generate(self._request("image-maintenance-block"))
            capabilities = await main.get_image_capabilities()
        self.assertEqual(context.exception.status_code, 503)
        self.assertFalse(capabilities["enabled"])
        self.assertEqual(_CountingClient.calls, 0)
        self.assertEqual(self.db.query(ImageGenerationTask).count(), 0)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_HOLD",
            ).count(),
            0,
        )

    async def test_reference_actual_file_and_declared_mime_are_checked_before_hold(self):
        invalid_request = self._request("image-invalid-reference")
        invalid_request.image_data = "data:image/png;base64," + base64.b64encode(b"not-an-image").decode()
        with self.assertRaises(HTTPException) as invalid_context:
            await self._generate(invalid_request)
        self.assertEqual(invalid_context.exception.status_code, 400)

        mismatch_request = self._request("image-mime-mismatch")
        mismatch_request.image_data = f"data:image/jpeg;base64,{VALID_PNG_BASE64}"
        with self.assertRaises(HTTPException) as mismatch_context:
            await self._generate(mismatch_request)
        self.assertEqual(mismatch_context.exception.status_code, 400)
        self.assertEqual(_CountingClient.calls, 0)
        self.assertEqual(self.db.query(ImageGenerationTask).count(), 0)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_HOLD",
            ).count(),
            0,
        )

    async def test_reference_pixel_limit_is_checked_before_hold(self):
        request = self._request("image-pixel-limit")
        request.image_data = f"data:image/png;base64,{VALID_PNG_BASE64}"
        with patch.dict(os.environ, {"IMAGE_GENERATION_MAX_REFERENCE_PIXELS": "0"}):
            with self.assertRaises(HTTPException) as context:
                await self._generate(request)
        self.assertEqual(context.exception.status_code, 413)
        self.assertEqual(_CountingClient.calls, 0)
        self.assertEqual(self.db.query(ImageGenerationTask).count(), 0)

    async def test_same_request_id_with_different_fingerprint_conflicts(self):
        await self._generate(self._request("image-conflict-1", "first prompt"))
        with self.assertRaises(HTTPException) as context:
            await self._generate(self._request("image-conflict-1", "changed prompt"))
        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(_CountingClient.calls, 1)

    async def test_timeout_keeps_single_pending_hold_and_blocks_replay(self):
        _CountingClient.raised_error = httpx.ReadTimeout(
            "late timeout",
            request=httpx.Request("POST", "https://provider.example.com/generate"),
        )
        request = self._request("image-timeout-1")
        with self.assertRaises(HTTPException) as context:
            await self._generate(request)
        self.assertEqual(context.exception.status_code, 504)
        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 970)
        task = self.db.query(ImageGenerationTask).one()
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        self.assertEqual(task.status, "submit_unknown")
        self.assertEqual(task.settlement_status, "REVIEW_REQUIRED")
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type.in_(("GENERATE_CAPTURE", "GENERATE_REFUND")),
            ).count(),
            0,
        )

        _CountingClient.raised_error = None
        with self.assertRaises(HTTPException) as replay_context:
            await self._generate(request)
        self.assertEqual(replay_context.exception.status_code, 423)
        self.assertEqual(_CountingClient.calls, 1)

    async def test_http_422_is_explicit_failure_and_refunds_once_without_body_leak(self):
        _CountingClient.response = _error_response(422)
        with self.assertRaises(HTTPException):
            await self._generate(self._request("image-rejected-1"))
        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 1000)
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        refunds = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_REFUND",
        ).all()
        task = self.db.query(ImageGenerationTask).one()
        self.assertEqual(hold.status, "REFUNDED")
        self.assertEqual(len(refunds), 1)
        self.assertEqual(task.settlement_status, "REFUNDED")
        self.assertNotIn("provider-secret-body", task.last_provider_error)
        self.assertNotIn("provider-secret-body", hold.error_message)

    async def test_http_503_is_unknown_and_never_refunds(self):
        _CountingClient.response = _error_response(503)
        with self.assertRaises(HTTPException) as context:
            await self._generate(self._request("image-503-unknown"))
        self.assertEqual(context.exception.status_code, 504)
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_REFUND",
            ).count(),
            0,
        )

    async def test_clear_pre_acceptance_rejection_uses_configured_backup_channel(self):
        backup_channel = main.APIChannel(
            name="Nano backup relay",
            base_url="https://backup.example.com",
            api_key="backup-key",
            model="gemini-3.1-flash-image-preview",
            product_model="nano-banana-2",
        )
        _CountingClient.responses = [_error_response(404), _success_response()]
        with patch.object(main, "API_CHANNELS", (self.nano_channel, backup_channel)):
            with patch.object(main.httpx, "AsyncClient", _CountingClient):
                response = await main.generate_image(
                    self._request("image-safe-failover"),
                    self.user,
                    self.db,
                )

        self.assertEqual(_CountingClient.calls, 2)
        self.assertEqual(response.remaining_credits, 970)
        task = self.db.query(ImageGenerationTask).one()
        self.assertEqual(task.provider_name, backup_channel.name)
        self.assertEqual(task.settlement_status, "CAPTURED")

    async def test_ambiguous_503_never_uses_configured_backup_channel(self):
        backup_channel = main.APIChannel(
            name="Nano backup relay",
            base_url="https://backup.example.com",
            api_key="backup-key",
            model="gemini-3.1-flash-image-preview",
            product_model="nano-banana-2",
        )
        _CountingClient.responses = [_error_response(503), _success_response()]
        with patch.object(main, "API_CHANNELS", (self.nano_channel, backup_channel)):
            with patch.object(main.httpx, "AsyncClient", _CountingClient):
                with self.assertRaises(HTTPException) as context:
                    await main.generate_image(
                        self._request("image-no-unsafe-failover"),
                        self.user,
                        self.db,
                    )

        self.assertEqual(context.exception.status_code, 504)
        self.assertEqual(_CountingClient.calls, 1)
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        self.assertEqual(hold.status, "PENDING")

    async def test_admin_refund_is_audited_and_idempotent(self):
        _CountingClient.raised_error = httpx.ReadTimeout(
            "late timeout",
            request=httpx.Request("POST", "https://provider.example.com/generate"),
        )
        with self.assertRaises(HTTPException):
            await self._generate(self._request("image-admin-review"))
        task = self.db.query(ImageGenerationTask).one()
        settlement_request = main.AdminImageSettlementRequest(
            action="refund",
            reason="供应商后台确认未创建任务",
        )
        first = await main.admin_settle_image_generation_review(
            task.task_id,
            settlement_request,
            self.admin,
            os.environ["ADMIN_SECRET_KEY"],
            self.db,
        )
        second = await main.admin_settle_image_generation_review(
            task.task_id,
            settlement_request,
            self.admin,
            os.environ["ADMIN_SECRET_KEY"],
            self.db,
        )
        self.assertEqual(first["settlement_status"], "REFUNDED")
        self.assertEqual(second["settlement_status"], "REFUNDED")
        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 1000)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_REFUND",
            ).count(),
            1,
        )
        self.assertEqual(
            self.db.query(AdminAuditLog).filter(
                AdminAuditLog.action == "IMAGE_REVIEW_REFUND",
            ).count(),
            2,
        )

    async def test_readiness_and_admin_list_expose_unknown_image_hold(self):
        _CountingClient.raised_error = httpx.ReadTimeout(
            "late timeout",
            request=httpx.Request("POST", "https://provider.example.com/generate"),
        )
        with self.assertRaises(HTTPException):
            await self._generate(self._request("image-ready-review"))

        with patch.object(main, "SessionLocal", self.Session):
            readiness = await main.readiness_check()
        self.assertEqual(readiness.status_code, 503)
        payload = json.loads(readiness.body)
        self.assertFalse(payload["checks"]["image_backlog"])
        self.assertEqual(payload["metrics"]["review_required_image_tasks"], 1)
        self.assertEqual(payload["metrics"]["pending_image_holds"], 1)
        self.assertEqual(payload["metrics"]["orphan_pending_image_holds"], 0)

        reviews = await main.admin_list_image_generation_reviews(
            50,
            self.admin,
            self.db,
        )
        self.assertEqual(reviews["count"], 1)
        self.assertEqual(reviews["items"][0]["settlement_status"], "REVIEW_REQUIRED")

    async def test_oversized_provider_result_is_not_stored_or_captured(self):
        _CountingClient.response = _success_response("x" * 1024)
        with patch.object(main, "IMAGE_GENERATION_MAX_RESULT_BYTES", 128):
            with self.assertRaises(HTTPException):
                await self._generate(self._request("image-result-too-large"))
        task = self.db.query(ImageGenerationTask).one()
        hold = self.db.query(CreditTransaction).filter(
            CreditTransaction.type == "GENERATE_HOLD",
        ).one()
        self.assertIsNone(task.image_url)
        self.assertEqual(task.settlement_status, "REVIEW_REQUIRED")
        self.assertEqual(hold.status, "PENDING")

    def test_request_model_rejects_multiple_images_before_billing(self):
        with self.assertRaises(ValidationError):
            main.GenerateRequest(
                user_params="prompt",
                request_id="image-count-2",
                num_images=2,
            )

    async def test_capabilities_only_expose_explicit_product_mappings(self):
        channels = (
            self.nano_channel,
            main.APIChannel(
                name="Nano Pro relay",
                base_url="https://provider.example.com",
                api_key="pro-key",
                model="nano-banana-pro",
                product_model="nano-banana-pro",
            ),
            main.APIChannel(
                name="GPT relay",
                base_url="https://provider.example.com",
                api_key="gpt-key",
                model="gpt-image-2",
                product_model="gpt-image-2",
            ),
        )
        with patch.object(main, "API_CHANNELS", channels):
            capabilities = await main.get_image_capabilities()
        self.assertTrue(capabilities["enabled"])
        self.assertEqual(capabilities["max_num_images"], 1)
        self.assertEqual(
            [model["id"] for model in capabilities["models"]],
            ["nano-banana-2", "nano-banana-pro", "gpt-image-2"],
        )
        self.assertEqual(
            capabilities["models"][0]["resolutions"][1],
            {"value": "2K", "label": "2K", "credits": 50},
        )
        self.assertEqual(capabilities["models"][2]["resolution_semantics"], "quality")
        self.assertEqual(capabilities["models"][2]["resolutions"][2]["label"], "高质量")

    async def test_user_hourly_rate_limit_runs_before_second_hold(self):
        _CountingClient.response = _error_response(422)
        with patch.dict(os.environ, {"IMAGE_GENERATE_USER_HOURLY_LIMIT": "1"}):
            with self.assertRaises(HTTPException):
                await self._generate(self._request("image-rate-limit-1"))
            with self.assertRaises(HTTPException) as context:
                await self._generate(self._request("image-rate-limit-2"))
        self.assertEqual(context.exception.status_code, 429)
        self.assertEqual(_CountingClient.calls, 1)
        self.assertEqual(
            self.db.query(CreditTransaction).filter(
                CreditTransaction.type == "GENERATE_HOLD",
            ).count(),
            1,
        )


if __name__ == "__main__":
    unittest.main()
