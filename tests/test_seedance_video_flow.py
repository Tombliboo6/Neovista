import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ["SEEDANCE_API_KEY"] = "test-seedance-key"
os.environ["SEEDANCE_BASE_URL"] = "https://ai.comfly.chat"
os.environ["SEEDANCE_MODEL"] = "doubao-seedance-2-0-260128"
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main
from billing_service import grant_welcome_credits
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

    @property
    def headers(self):
        return {"host": "neotest.site", "x-forwarded-proto": "https"}


class SeedanceVideoFlowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()
        self.user = User(email="video@example.com", hashed_password="hashed", credits=0)
        self.db.add(self.user)
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
        self.engine.dispose()

    async def test_create_seedance_video_task_uses_v3_official_payload_and_records_hold(self):
        request = main.VideoGenerateRequest(
            prompt="生成一个滨水更新片区分析动画",
            aspect_ratio="16:9",
            duration_seconds=5,
            resolution="1080p",
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

        self.assertEqual(response.task_id, "cgt-test-1")
        self.assertEqual(response.status, "submitted")
        self.assertEqual(response.charged_credits, 1500)
        self.assertEqual(response.remaining_credits, 1500)
        self.assertEqual(_SeedanceAsyncClient.last_post_url, "https://ai.comfly.chat/seedance/v3/contents/generations/tasks")
        self.assertEqual(_SeedanceAsyncClient.last_headers["Authorization"], "Bearer test-seedance-key")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["model"], "doubao-seedance-2-0-260128")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["resolution"], "1080p")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["ratio"], "16:9")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["duration"], 5)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["watermark"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["camera_fixed"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["generate_audio"], False)
        self.assertEqual(_SeedanceAsyncClient.last_post_json["content"][0]["type"], "text")
        self.assertEqual(_SeedanceAsyncClient.last_post_json["content"][0]["text"], "生成一个滨水更新片区分析动画")
        self.assertNotIn("--ratio", _SeedanceAsyncClient.last_post_json["content"][0]["text"])
        self.assertNotIn("--duration", _SeedanceAsyncClient.last_post_json["content"][0]["text"])

        task = self.db.query(VideoGenerationTask).filter(VideoGenerationTask.task_id == "cgt-test-1").one()
        self.assertEqual(task.status, "submitted")
        self.assertEqual(task.resolution, "1080p")
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

        self.assertEqual(first_response.task_id, "cgt-original")
        self.assertEqual(duplicate_response.task_id, "cgt-original")
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

        self.assertEqual(response.task_id, "cgt-first-last-task")
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

        task = self.db.query(VideoGenerationTask).filter(VideoGenerationTask.task_id == "cgt-first-last-task").one()
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

        self.assertEqual(response.task_id, "cgt-reference-task")
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
            await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)

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
            response = await main.get_video_generation_task("cgt-query-task", self.user, self.db)

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
            await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)

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
            response = await main.get_video_generation_task("cgt-test-2", self.user, self.db)

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
            await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)

        task = self.db.query(VideoGenerationTask).filter(VideoGenerationTask.task_id == "cgt-transient-502").one()
        task.status = "running"
        self.db.add(task)
        self.db.commit()

        with patch.object(main.httpx, "AsyncClient", lambda timeout=180.0: _SeedanceAsyncClient(
            get_response=_response(
                "GET",
                "https://ai.comfly.chat/seedance/v3/contents/generations/tasks/cgt-transient-502",
                {"detail": "Bad Gateway"},
                status_code=502,
            )
        )):
            response = await main.get_video_generation_task("cgt-transient-502", self.user, self.db)

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
            await main.create_video_generation_task(create_request, _FakeRequest(), self.user, self.db)

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
            response = await main.get_video_generation_task("cgt-test-3", self.user, self.db)

        self.assertEqual(response.status, "failed")
        self.assertEqual(response.remaining_credits, 3000)
        hold = self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_HOLD").one()
        self.assertEqual(hold.status, "REFUNDED")
        self.assertIsInstance(hold.error_message, str)
        self.assertIn("Invalid parameters", hold.error_message)
        self.assertEqual(self.db.query(CreditTransaction).filter(CreditTransaction.type == "GENERATE_REFUND").count(), 1)

    def test_saved_seedance_reference_image_is_publicly_readable_under_restrictive_umask(self):
        image_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
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
