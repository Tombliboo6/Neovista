import base64
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ["SEEDANCE_API_KEY"] = "test-seedance-key"
os.environ["SEEDANCE_BASE_URL"] = "https://ai.comfly.chat"
os.environ["SEEDANCE_MODEL"] = "doubao-seedance-2-0-260128"
os.environ["SEEDANCE_FEATURE_ENABLED"] = "true"
os.environ["SEEDANCE_REFERENCE_ALLOWED_HOSTS"] = "cdn.example.com"
os.environ["PUBLIC_BASE_URL"] = "https://neotest.site"
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main
from billing_service import create_video_generation_hold, grant_welcome_credits, refund_generation_hold
from models import Base, CreditTransaction, User, VideoGenerationTask
from pricing import calculate_video_generation_cost


class _SeedanceAsyncClient:
    last_post_url = None
    last_post_json = None
    last_get_url = None
    last_headers = None
    post_calls = 0

    def __init__(self, *, post_response=None, get_response=None):
        self._post_response = post_response
        self._get_response = get_response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        type(self).post_calls += 1
        type(self).last_post_url = url
        type(self).last_post_json = kwargs.get("json")
        type(self).last_headers = kwargs.get("headers")
        return self._post_response

    async def get(self, url, **kwargs):
        type(self).last_get_url = url
        type(self).last_headers = kwargs.get("headers")
        return self._get_response


def _response(method, url, payload, status_code=200):
    return httpx.Response(
        status_code,
        request=httpx.Request(method, url),
        json=payload,
    )


class _FakeRequest:
    base_url = "https://neotest.site/"
    client = None

    @property
    def headers(self):
        return {"host": "neotest.site", "x-forwarded-proto": "https"}


class SeedanceVideoFlowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.original_session_local = main.SessionLocal
        main.SessionLocal = self.Session
        self.db = self.Session()
        self.user = User(email="video@example.com", hashed_password="hashed", credits=0)
        self.admin = User(
            email="video-admin@example.com",
            hashed_password="hashed",
            credits=0,
            is_admin=True,
        )
        self.db.add_all([self.user, self.admin])
        self.db.commit()
        self.db.refresh(self.user)
        _SeedanceAsyncClient.last_post_url = None
        _SeedanceAsyncClient.last_post_json = None
        _SeedanceAsyncClient.last_get_url = None
        _SeedanceAsyncClient.last_headers = None
        _SeedanceAsyncClient.post_calls = 0
        grant_welcome_credits(self.db, self.user)
        self.user.credits = 3000
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

    def tearDown(self):
        self.db.close()
        main.SessionLocal = self.original_session_local
        self.engine.dispose()

    def _task_by_request_id(self, request_id):
        return self.db.query(VideoGenerationTask).filter(
            VideoGenerationTask.user_id == self.user.id,
            VideoGenerationTask.request_id == request_id,
        ).one()

    def _make_task_due(self, task):
        task.next_poll_at = None
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

    def test_legacy_provider_active_statuses_remain_reconcilable(self):
        self.assertTrue(
            {"queued", "pending", "created", "processing"}.issubset(
                main.SEEDANCE_ACTIVE_STATUSES
            )
        )

    def test_force_reconciliation_uses_the_same_database_poll_lease(self):
        hold = create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id="force-lease-request",
            idempotency_key="video-generate:force-lease-request",
            selected_model="seedance-2.0",
        )
        task = VideoGenerationTask(
            task_id="force-lease-task",
            provider_task_id="force-lease-provider",
            request_id="force-lease-request",
            user_id=self.user.id,
            hold_transaction_id=hold.id,
            selected_model="seedance-2.0",
            provider_model="doubao-seedance-2-0-260128",
            api_format="v3",
            prompt="lease test",
            aspect_ratio="16:9",
            resolution="720p",
            duration_seconds=5,
            status="reconciliation_required",
            settlement_status="REVIEW_REQUIRED",
            next_poll_at=None,
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)

        self.assertTrue(
            main._claim_seedance_poll(self.db, task, include_review_required=True)
        )
        with self.Session() as competing_db:
            competing_task = competing_db.query(VideoGenerationTask).filter_by(id=task.id).one()
            self.assertFalse(
                main._claim_seedance_poll(
                    competing_db,
                    competing_task,
                    include_review_required=True,
                )
            )

    def test_stale_seedance_poll_cannot_downgrade_a_terminal_task(self):
        hold = create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id="monotonic-request",
            idempotency_key="video-generate:monotonic-request",
            selected_model="seedance-2.0",
        )
        task = VideoGenerationTask(
            task_id="monotonic-task",
            provider_task_id="monotonic-provider",
            request_id="monotonic-request",
            user_id=self.user.id,
            hold_transaction_id=hold.id,
            selected_model="seedance-2.0",
            provider_model="doubao-seedance-2-0-260128",
            api_format="v3",
            prompt="monotonic test",
            aspect_ratio="16:9",
            resolution="720p",
            duration_seconds=5,
            status="submitted",
            settlement_status="PENDING",
            next_poll_at=None,
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        self.assertTrue(main._claim_seedance_poll(self.db, task))
        stale_claim_marker = task.last_polled_at

        with self.Session() as winning_db:
            winning_task = winning_db.query(VideoGenerationTask).filter_by(id=task.id).one()
            winning_task.status = "succeeded"
            winning_task.settlement_status = "CAPTURED"
            winning_task.video_url = "https://cdn.example.com/final.mp4"
            winning_task.last_polled_at = stale_claim_marker + timedelta(seconds=1)
            winning_db.commit()

        persisted, owns_claim = main._reload_claimed_seedance_task(
            self.db,
            task,
            stale_claim_marker,
        )
        self.assertFalse(owns_claim)
        self.assertEqual(persisted.status, "succeeded")
        self.assertEqual(persisted.settlement_status, "CAPTURED")

    def test_readiness_schema_requires_all_settlement_and_video_unique_indexes(self):
        self.assertTrue(main._readiness_schema_is_current(self.db))
        self.db.execute(text("DROP INDEX uq_credit_transactions_settlement_key"))
        self.db.commit()
        self.assertFalse(main._readiness_schema_is_current(self.db))

    def test_reconciler_health_requires_a_recent_success_after_the_last_error(self):
        class _RunningTask:
            @staticmethod
            def done():
                return False

        original_values = (
            main._seedance_reconciler_task,
            main._seedance_reconciler_last_success_at,
            main._seedance_reconciler_last_error_at,
            main._seedance_reconciler_last_error_type,
        )
        now = datetime.utcnow()
        try:
            main._seedance_reconciler_task = _RunningTask()
            main._seedance_reconciler_last_success_at = now - timedelta(seconds=5)
            main._seedance_reconciler_last_error_at = None
            main._seedance_reconciler_last_error_type = None
            self.assertTrue(main._seedance_reconciler_is_healthy(now))

            main._seedance_reconciler_last_error_at = now
            main._seedance_reconciler_last_error_type = "RuntimeError"
            self.assertFalse(main._seedance_reconciler_is_healthy(now))

            main._seedance_reconciler_last_error_at = None
            main._seedance_reconciler_last_success_at = now - timedelta(minutes=5)
            self.assertFalse(main._seedance_reconciler_is_healthy(now))
        finally:
            (
                main._seedance_reconciler_task,
                main._seedance_reconciler_last_success_at,
                main._seedance_reconciler_last_error_at,
                main._seedance_reconciler_last_error_type,
            ) = original_values

    async def test_readiness_is_fail_closed_for_historical_video_work_when_feature_is_off(self):
        with (
            patch.dict(os.environ, {
                "SEEDANCE_FEATURE_ENABLED": "false",
                "IMAGE_REQUIRED_PRODUCT_MODELS": "",
            }),
            patch.object(main, "_chat_config_is_valid", return_value=True),
        ):
            empty_response = await main.readiness_check()
        self.assertEqual(empty_response.status_code, 200)

        hold = create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id="ready-historical-task",
            idempotency_key="video-generate:ready-historical-task",
            selected_model="seedance-2.0",
        )
        self.db.add(VideoGenerationTask(
            task_id="ready-historical-task",
            provider_task_id="provider-ready-historical-task",
            request_id="ready-historical-task",
            user_id=self.user.id,
            hold_transaction_id=hold.id,
            selected_model="seedance-2.0",
            provider_model="doubao-seedance-2-0",
            api_format="v3",
            prompt="historical task",
            aspect_ratio="16:9",
            resolution="720p",
            duration_seconds=5,
            status="reconciliation_required",
            settlement_status="REVIEW_REQUIRED",
            deadline_at=datetime.utcnow() + timedelta(hours=1),
        ))
        self.db.commit()

        with (
            patch.dict(os.environ, {
                "SEEDANCE_FEATURE_ENABLED": "false",
                "IMAGE_REQUIRED_PRODUCT_MODELS": "",
            }),
            patch.object(main, "_seedance_reconciler_task", None),
            patch.object(main, "_chat_config_is_valid", return_value=True),
        ):
            blocked_response = await main.readiness_check()
        self.assertEqual(blocked_response.status_code, 503)

    async def test_create_seedance_video_task_uses_v3_official_payload_and_records_hold(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个滨水更新片区分析动画",
            aspect_ratio="16:9",
            duration_seconds=5,
            resolution="4K",
            request_id="video-req-1",
        )
        client_factory = lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "cgt-test-1"},
            )
        )

        with patch.object(main.httpx, "AsyncClient", client_factory):
            response = await main.create_video_generation_task(
                request,
                _FakeRequest(),
                self.user,
                self.db,
            )

        self.assertTrue(response.task_id)
        self.assertNotEqual(response.task_id, "cgt-test-1")
        self.assertEqual(response.status, "submitted")
        self.assertEqual(response.charged_credits, 3000)
        self.assertEqual(response.remaining_credits, 0)
        self.assertEqual(_SeedanceAsyncClient.last_post_url, "https://ai.comfly.chat/seedance/v3/contents/generations/tasks")
        self.assertEqual(_SeedanceAsyncClient.last_headers["Authorization"], "Bearer test-seedance-key")
        expected_provider_key = main._seedance_provider_idempotency_key(
            user_id=self.user.id,
            request_id="video-req-1",
        )
        self.assertEqual(_SeedanceAsyncClient.last_headers["Idempotency-Key"], expected_provider_key)
        self.assertEqual(_SeedanceAsyncClient.last_headers["X-Request-Id"], expected_provider_key)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["model"], "doubao-seedance-2-0-260128")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["resolution"], "4k")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["ratio"], "16:9")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["duration"], 5)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["watermark"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["camera_fixed"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["generate_audio"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["content"][0]["type"], "text")
        self.assertEqual(
            _SeedanceAsyncClient.last_post_json["content"][0]["text"],
            (
                "生成一个滨水更新片区分析动画 "
                "--resolution 4k --ratio 16:9 --duration 5 "
                "--camerafixed false --watermark false"
            ),
        )

        task = self._task_by_request_id("video-req-1")
        self.assertEqual(task.task_id, response.task_id)
        self.assertEqual(task.provider_task_id, "cgt-test-1")
        self.assertEqual(task.status, "submitted")
        self.assertEqual(task.resolution, "4k")
        self.assertEqual(task.hold_transaction_id, self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one().id)

    async def test_duplicate_seedance_request_id_returns_existing_task_without_new_upstream_task(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个滨水更新片区分析动画",
            duration_seconds=5,
            request_id="video-duplicate-req",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-original"})
        )):
            first_response = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-orphan"})
        )):
            duplicate_response = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(first_response.task_id, duplicate_response.task_id)
        self.assertNotEqual(first_response.task_id, "cgt-original")
        self.assertEqual(_SeedanceAsyncClient.post_calls, 1)
        self.assertEqual(
            self.db.query(VideoGenerationTask).filter(VideoGenerationTask.request_id == "video-duplicate-req").count(),
            1,
        )

    async def test_create_seedance_first_last_frame_task_uses_v3_official_roles(self):
        request = main.VideoGenerateRequest(
            prompt="让首帧平滑过渡到尾帧",
            image_datas=[
                "https://cdn.example.com/start.png",
                "https://cdn.example.com/end.png",
            ],
            aspect_ratio="16:9",
            duration_seconds=8,
            resolution="720p",
            video_mode="first_last_frame",
            request_id="video-first-last-req",
        )
        client_factory = lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "cgt-first-last-task"},
            )
        )

        with patch.object(main.httpx, "AsyncClient", client_factory):
            response = await main.create_video_generation_task(
                request,
                _FakeRequest(),
                self.user,
                self.db,
            )

        self.assertTrue(response.task_id)
        self.assertNotEqual(response.task_id, "cgt-first-last-task")
        self.assertEqual(_SeedanceAsyncClient.last_post_url, "https://ai.comfly.chat/seedance/v3/contents/generations/tasks")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["model"], "doubao-seedance-2-0-260128")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["duration"], 8)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["resolution"], "720p")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["ratio"], "16:9")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["content"][1], {
            "type": "image_url",
            "image_url": {"url": "https://cdn.example.com/start.png"},
            "role": "first_frame",
        })
        self.assertEqual(_SeedanceAsyncClient.last_post_json["content"][2], {
            "type": "image_url",
            "image_url": {"url": "https://cdn.example.com/end.png"},
            "role": "last_frame",
        })

        task = self._task_by_request_id("video-first-last-req")
        self.assertEqual(task.provider_task_id, "cgt-first-last-task")
        self.assertEqual(task.api_format, "v3")
        self.assertEqual(task.resolution, "720p")
        self.assertEqual(task.duration_seconds, 8)

    async def test_create_seedance_reference_image_task_uses_v3_reference_roles(self):
        request = main.VideoGenerateRequest(
            prompt="参考这些建筑分析图生成动态画面",
            image_datas=[
                "https://cdn.example.com/ref-a.png",
                "https://cdn.example.com/ref-b.png",
                "https://cdn.example.com/ref-c.png",
            ],
            video_mode="reference_image",
            request_id="video-reference-image-req",
        )
        client_factory = lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "cgt-reference-task"},
            )
        )

        with patch.object(main.httpx, "AsyncClient", client_factory):
            response = await main.create_video_generation_task(
                request,
                _FakeRequest(),
                self.user,
                self.db,
            )

        self.assertTrue(response.task_id)
        self.assertNotEqual(response.task_id, "cgt-reference-task")
        image_items = _SeedanceAsyncClient.last_post_json["content"][1:]
        self.assertEqual([item["role"] for item in image_items], ["reference_image", "reference_image", "reference_image"])
        self.assertEqual([item["image_url"]["url"] for item in image_items], [
            "https://cdn.example.com/ref-a.png",
            "https://cdn.example.com/ref-b.png",
            "https://cdn.example.com/ref-c.png",
        ])

    async def test_query_seedance_first_last_frame_task_uses_v3_endpoint(self):
        create_request = main.VideoGenerateRequest(
            prompt="让首帧平滑过渡到尾帧",
            image_datas=[
                "https://cdn.example.com/start.png",
                "https://cdn.example.com/end.png",
            ],
            video_mode="first_last_frame",
            request_id="video-first-last-query",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-query-task"})
        )):
            created = await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-first-last-query"))

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-query-task",
                {
                    "id": "cgt-query-task",
                    "status": "succeeded",
                    "content": {"video_url": "https://cdn.example.com/first-last.mp4"},
                },
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(_SeedanceAsyncClient.last_get_url, "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-query-task")
        self.assertEqual(response.status, "succeeded")
        self.assertEqual(response.video_url, "https://cdn.example.com/first-last.mp4")

    async def test_seedance_first_last_frame_requires_two_images(self):
        request = main.VideoGenerateRequest(
            prompt="让首帧平滑过渡到尾帧",
            image_datas=["https://cdn.example.com/start.png"],
            video_mode="first_last_frame",
            request_id="video-first-last-missing-image",
        )

        with self.assertRaisesRegex(main.HTTPException, "首尾帧"):
            await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(_SeedanceAsyncClient.post_calls, 0)
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").count(), 0)

    async def test_query_seedance_video_task_captures_hold_when_succeeded(self):
        create_request = main.VideoGenerateRequest(
            prompt="生成一个场地分析动画",
            duration_seconds=5,
            request_id="video-req-2",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-test-2"})
        )):
            created = await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-req-2"))

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-test-2",
                {
                    "id": "cgt-test-2",
                    "status": "succeeded",
                    "content": {"video_url": "https://cdn.example.com/video.mp4"},
                },
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "succeeded")
        self.assertEqual(response.video_url, "https://cdn.example.com/video.mp4")
        self.assertEqual(response.remaining_credits, 1750)
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_CAPTURE").count(), 1)

    async def test_query_seedance_video_task_keeps_running_when_upstream_query_is_transient_502(self):
        create_request = main.VideoGenerateRequest(
            prompt="生成一个场地分析动画",
            duration_seconds=5,
            request_id="video-req-transient-502",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-transient-502"})
        )):
            created = await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)

        task = self._task_by_request_id("video-req-transient-502")
        task.status = "running"
        self._make_task_due(task)

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-transient-502",
                {"detail": "Bad Gateway"},
                status_code=502,
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "running")
        self.assertIsNone(response.video_url)
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one()
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_REFUND").count(), 0)
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_CAPTURE").count(), 0)

    async def test_query_seedance_video_task_refunds_when_failed_with_structured_error(self):
        create_request = main.VideoGenerateRequest(
            prompt="生成一个场地分析动画",
            duration_seconds=5,
            request_id="video-req-3",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks", {"id": "cgt-test-3"})
        )):
            created = await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-req-3"))

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-test-3",
                {
                    "id": "cgt-test-3",
                    "status": "failed",
                    "error": {
                        "code": "1007",
                        "message": "Invalid parameters in request: image_url was not found",
                    },
                },
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "failed")
        self.assertEqual(response.remaining_credits, 3000)
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one()
        self.assertEqual(hold.status, "REFUNDED")
        self.assertIsInstance(hold.error_message, str)
        self.assertEqual(hold.error_message, "Seedance 视频生成失败（错误码：1007）")
        self.assertNotIn("Invalid parameters", hold.error_message)
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_REFUND").count(), 1)

    def test_seedance_provider_error_message_never_echoes_url_prompt_or_body(self):
        message = main._format_seedance_error_message(
            {
                "code": "VALIDATION_1007",
                "message": (
                    "private prompt at https://provider.example/internal "
                    "using secret-key-material"
                ),
                "debug": {"request_body": "sensitive"},
            }
        )

        self.assertEqual(
            message,
            "Seedance 视频生成失败（错误码：VALIDATION_1007）",
        )
        self.assertNotIn("provider.example", message)
        self.assertNotIn("private prompt", message)
        self.assertNotIn("secret-key-material", message)
        self.assertEqual(
            main._format_seedance_error_message(
                "raw body with https://provider.example and a private prompt"
            ),
            "Seedance 视频生成失败",
        )

    async def test_create_timeout_keeps_durable_unknown_task_and_pending_hold(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个需要恢复的场地动画",
            request_id="video-timeout-request",
        )
        timeout = httpx.ReadTimeout(
            "timed out",
            request=httpx.Request("POST", "https://ai.comfly.chat/seedance/v3/contents/generations/tasks"),
        )

        with patch.object(main, "_create_seedance_task", new=AsyncMock(side_effect=timeout)):
            response = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(response.status, "submit_unknown")
        self.assertEqual(response.settlement_status, "PENDING")
        task = self._task_by_request_id("video-timeout-request")
        self.assertIsNone(task.provider_task_id)
        self.assertEqual(task.status, "submit_unknown")
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.id == task.hold_transaction_id).one()
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(self.user.credits, 1750)

    async def test_ready_intent_is_submitted_by_reconciler_after_request_process_stops(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个可由后台恢复提交的动画",
            request_id="video-ready-recovery",
        )
        leave_ready = AsyncMock(side_effect=lambda _db, task: task)
        with patch.object(main, "_submit_seedance_task_record", new=leave_ready):
            response = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(response.status, "ready")
        task = self._task_by_request_id("video-ready-recovery")
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-recovered-ready"},
            )
        )):
            reconciled = await main._reconcile_seedance_task_record(self.db, task)

        self.assertEqual(reconciled.status, "submitted")
        self.assertEqual(reconciled.provider_task_id, "provider-recovered-ready")
        self.assertEqual(_SeedanceAsyncClient.post_calls, 1)

    async def test_succeeded_without_video_url_stays_finalizing_and_hold_remains_pending(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个等待视频地址的动画",
            request_id="video-finalizing-url",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-finalizing"},
            )
        )):
            created = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-finalizing-url"))

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/provider-finalizing",
                {"id": "provider-finalizing", "status": "succeeded", "content": {}},
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "finalizing")
        self.assertEqual(response.settlement_status, "PENDING")
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one()
        self.assertEqual(hold.status, "PENDING")
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_CAPTURE").count(), 0)

    async def test_running_task_past_deadline_moves_to_review(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个超时动画",
            request_id="video-provider-deadline",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-deadline"},
            )
        )):
            created = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)
        task = self._task_by_request_id("video-provider-deadline")
        task.deadline_at = datetime.utcnow() - timedelta(seconds=1)
        self._make_task_due(task)

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/provider-deadline",
                {"id": "provider-deadline", "status": "running"},
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "reconciliation_required")
        self.assertEqual(response.settlement_status, "REVIEW_REQUIRED")

    async def test_provider_success_after_refund_is_reported_as_settlement_conflict(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个结算冲突测试动画",
            request_id="video-settlement-conflict",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-settlement-conflict"},
            )
        )):
            created = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)
        task = self._task_by_request_id("video-settlement-conflict")
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.id == task.hold_transaction_id).one()
        refund_generation_hold(
            self.db,
            hold,
            error_code="TEST_REFUND",
            error_message="forced refund",
        )
        self.db.commit()
        self._make_task_due(task)

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/provider-settlement-conflict",
                {
                    "id": "provider-settlement-conflict",
                    "status": "succeeded",
                    "content": {"video_url": "https://cdn.example.com/conflict.mp4"},
                },
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "reconciliation_required")
        self.assertEqual(response.settlement_status, "REVIEW_REQUIRED")
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_CAPTURE").count(), 0)

    async def test_private_or_malformed_reference_is_rejected_before_hold(self):
        for request_id, image_data in (
            ("video-private-reference", "https://127.0.0.1/internal.png"),
            ("video-malformed-base64", "data:image/png;base64,not-valid-base64!"),
        ):
            with self.subTest(request_id=request_id):
                request = main.VideoGenerateRequest(
                    prompt="生成参考图动画",
                    image_datas=[image_data],
                    video_mode="first_frame",
                    request_id=request_id,
                )
                with self.assertRaises(main.HTTPException):
                    await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").count(), 0)

    async def test_same_request_id_with_different_reference_is_rejected(self):
        first = main.VideoGenerateRequest(
            prompt="生成参考图动画",
            image_datas=["https://cdn.example.com/first.png"],
            video_mode="first_frame",
            request_id="video-fingerprint-conflict",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-fingerprint"},
            )
        )):
            await main.create_video_generation_task(first, _FakeRequest(), self.user, self.db)

        changed = first.model_copy(update={"image_datas": ["https://cdn.example.com/second.png"]})
        with self.assertRaisesRegex(main.HTTPException, "request_id"):
            await main.create_video_generation_task(changed, _FakeRequest(), self.user, self.db)

    def test_provider_idempotency_key_is_scoped_per_user(self):
        first = main._seedance_provider_idempotency_key(user_id=1, request_id="shared-request-id")
        second = main._seedance_provider_idempotency_key(user_id=2, request_id="shared-request-id")
        self.assertNotEqual(first, second)
        self.assertEqual(len(first), 64)

    async def test_settlement_database_error_moves_terminal_task_to_review(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个结算异常动画",
            request_id="video-settlement-error",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-settlement-error"},
            )
        )):
            created = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-settlement-error"))

        with patch.object(
            main,
            "capture_generation_hold",
            side_effect=RuntimeError("database unavailable"),
        ), patch.object(
            main.httpx,
            "AsyncClient",
            lambda timeout=180.0: _SeedanceAsyncClient(
                get_response=_response(
                    "GET",
                    "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/provider-settlement-error",
                    {
                        "id": "provider-settlement-error",
                        "status": "succeeded",
                        "content": {"video_url": "https://cdn.example.com/settlement-error.mp4"},
                    },
                )
            ),
        ):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "reconciliation_required")
        self.assertEqual(response.settlement_status, "REVIEW_REQUIRED")
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one()
        self.assertEqual(hold.status, "PENDING")

    async def test_non_object_provider_response_is_retried_without_settlement(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个协议异常动画",
            request_id="video-invalid-provider-json",
        )
        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            post_response=_response(
                "POST",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks",
                {"id": "provider-invalid-json"},
            )
        )):
            created = await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)
        self._make_task_due(self._task_by_request_id("video-invalid-provider-json"))

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/provider-invalid-json",
                ["unexpected"],
            )
        )):
            response = await main.get_video_generation_task(created.task_id, self.user, self.db)

        self.assertEqual(response.status, "submitted")
        self.assertEqual(response.settlement_status, "PENDING")

    async def test_mismatched_orphan_hold_is_not_reused(self):
        hold = create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id="video-orphan-hold",
            idempotency_key=f"video-generate:{self.user.id}:video-orphan-hold",
            selected_model="seedance-2.0",
        )
        self.db.commit()
        self.assertEqual(abs(hold.amount), 1250)
        request = main.VideoGenerateRequest(
            prompt="生成一个价格不同的动画",
            duration_seconds=6,
            request_id="video-orphan-hold",
        )

        with self.assertRaisesRegex(main.HTTPException, "历史积分预占"):
            await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(self.db.query(VideoGenerationTask).count(), 0)

    async def test_matching_orphan_hold_is_never_replayed_upstream(self):
        request_id = "video-matching-orphan-hold"
        hold = create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id=request_id,
            idempotency_key=f"video-generate:{self.user.id}:{request_id}",
            selected_model="seedance-2.0",
        )
        self.db.commit()
        provider_create = AsyncMock()
        request = main.VideoGenerateRequest(
            prompt="不得重放的未知提交",
            duration_seconds=5,
            resolution="720p",
            request_id=request_id,
        )

        with patch.object(main, "_create_seedance_task", new=provider_create):
            with self.assertRaisesRegex(main.HTTPException, "提交结果未知") as raised:
                await main.create_video_generation_task(
                    request,
                    _FakeRequest(),
                    self.user,
                    self.db,
                )

        self.assertEqual(raised.exception.status_code, 423)
        provider_create.assert_not_awaited()
        self.assertEqual(self.db.query(VideoGenerationTask).count(), 0)
        self.db.refresh(hold)
        self.assertEqual(hold.status, "PENDING")

    async def test_readiness_blocks_orphan_video_hold_and_admin_review_lists_it(self):
        request_id = "ready-orphan-video-hold"
        create_video_generation_hold(
            self.db,
            self.user,
            duration_seconds=5,
            resolution="720p",
            request_id=request_id,
            idempotency_key=f"video-generate:{self.user.id}:{request_id}",
            selected_model="seedance-2.0",
        )
        self.db.commit()

        with (
            patch.dict(os.environ, {"SEEDANCE_FEATURE_ENABLED": "false"}),
            patch.object(main, "_seedance_reconciler_task", None),
        ):
            response = await main.readiness_check()
        self.assertEqual(response.status_code, 503)
        payload = json.loads(response.body)
        self.assertEqual(payload["metrics"]["pending_video_holds"], 1)
        self.assertEqual(payload["metrics"]["orphan_pending_video_holds"], 1)
        self.assertFalse(payload["checks"]["video_backlog"])

        review = await main.admin_list_video_generation_reviews(
            limit=10,
            admin_user=self.admin,
            db=self.db,
        )
        self.assertEqual(review["count"], 1)
        self.assertEqual(review["items"][0]["status"], "missing_task")
        self.assertEqual(review["items"][0]["request_id"], request_id)

    async def test_capabilities_expose_only_production_seedance_resolutions(self):
        with patch.dict(os.environ, {"SEEDANCE_FEATURE_ENABLED": "true"}):
            capabilities = await main.get_video_capabilities()

        self.assertTrue(capabilities.enabled)
        self.assertEqual(capabilities.default_resolution, "720p")
        self.assertEqual(capabilities.resolution_credits_per_second, {
            "720p": 250,
            "1080p": 300,
            "4k": 600,
        })

    async def test_feature_flag_disables_new_tasks_and_capabilities(self):
        request = main.VideoGenerateRequest(
            prompt="不应提交的动画",
            request_id="video-feature-disabled",
        )
        with patch.dict(os.environ, {"SEEDANCE_FEATURE_ENABLED": "false"}):
            capabilities = await main.get_video_capabilities()
            self.assertFalse(capabilities.enabled)
            with self.assertRaisesRegex(main.HTTPException, "维护"):
                await main.create_video_generation_task(request, _FakeRequest(), self.user, self.db)

        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").count(), 0)

    def test_saved_seedance_reference_image_is_publicly_readable_under_restrictive_umask(self):
        image_buffer = io.BytesIO()
        Image.new("RGB", (2, 2), color=(255, 255, 255)).save(image_buffer, format="PNG")
        image_data = "data:image/png;base64," + base64.b64encode(image_buffer.getvalue()).decode("ascii")
        old_cwd = os.getcwd()
        old_umask = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                os.chdir(temp_dir)
                url = main._save_seedance_reference_image(
                    image_data,
                    index=0,
                    public_base_url="https://neotest.site",
                )
                saved_path = pathlib.Path(temp_dir) / url.removeprefix("https://neotest.site/")
                self.assertTrue(saved_path.exists())
                self.assertEqual(saved_path.parent.stat().st_mode & 0o755, 0o755)
                self.assertEqual(saved_path.stat().st_mode & 0o644, 0o644)
        finally:
            os.umask(old_umask)
            os.chdir(old_cwd)

    def test_seedance_video_pricing_rejects_duration_below_five_seconds(self):
        with self.assertRaisesRegex(ValueError, "不能少于 5 秒"):
            calculate_video_generation_cost(4, "seedance-2.0")


if __name__ == "__main__":
    unittest.main()
