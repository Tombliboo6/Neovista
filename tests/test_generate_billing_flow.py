import os
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, mock_open, patch
import json

import httpx
from fastapi import HTTPException
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
from billing_service import grant_welcome_credits
from models import Base, ChatSession, User

VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
VALID_PNG_DATA_URL = f"data:image/png;base64,{VALID_PNG_BASE64}"


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return self._response


class _RecordingAsyncClient:
    last_url = None
    last_json = None
    last_data = None
    last_files = None
    last_headers = None

    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        type(self).last_url = url
        type(self).last_json = kwargs.get("json")
        type(self).last_data = kwargs.get("data")
        type(self).last_files = kwargs.get("files")
        type(self).last_headers = kwargs.get("headers")
        return self._response


def _success_response():
    return httpx.Response(
        200,
        request=httpx.Request("POST", "https://example.com"),
        json={
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "data": VALID_PNG_BASE64
                                }
                            }
                        ]
                    }
                }
            ]
        },
    )


def _error_response(status_code):
    return httpx.Response(
        status_code,
        request=httpx.Request("POST", "https://example.com"),
        json={"error": "upstream failed"},
    )


def _gpt_image_success_response():
    return httpx.Response(
        200,
        request=httpx.Request("POST", "https://example.com/v1/images/generations"),
        json={
            "data": [
                {
                    "b64_json": VALID_PNG_BASE64
                }
            ]
        },
    )


def _gpt_image_url_success_response():
    return httpx.Response(
        200,
        request=httpx.Request("POST", "https://example.com/v1/images/edits"),
        json={
            "data": [
                {
                    "url": "https://cdn.example.com/generated-image.png"
                }
            ]
        },
    )


class GenerateBillingFlowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.Session()
        self.user = User(email="billing@example.com", hashed_password="hashed", credits=0)
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)
        grant_welcome_credits(self.db, self.user)
        self.db.commit()
        self.db.refresh(self.user)
        self.chat_session = ChatSession(
            session_id="session-1",
            user_id=self.user.id,
            template_id="1.1.1",
            collected_params=json.dumps({"title": "测试标题", "data": "测试数据", "user_input": "测试补充"}),
            chat_history="[]",
        )
        self.db.add(self.chat_session)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    async def test_generate_returns_402_when_balance_is_insufficient(self):
        self.user.credits = 10
        self.db.add(self.user)
        self.db.commit()
        self.db.refresh(self.user)

        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            resolution="2K",
            num_images=1,
        )

        channels = (
            main.APIChannel(
                name="Nano 2",
                base_url="https://example.com",
                api_key="key",
                model="gemini",
                product_model="nano-banana-2",
            ),
        )
        with patch.object(main, "API_CHANNELS", channels):
            with self.assertRaises(HTTPException) as ctx:
                await main.generate_image(request, self.user, self.db)

        self.assertEqual(ctx.exception.status_code, 402)

    async def test_successful_generate_returns_remaining_credits(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            resolution="2K",
            num_images=1,
            selected_model="nano-banana-pro",
        )

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="nano-banana-pro", product_model="nano-banana-pro"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_success_response())):
                response = await main.generate_image(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 120)
        self.assertEqual(response.charged_credits, 80)

    async def test_upstream_503_keeps_hold_for_manual_review(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            resolution="2K",
            num_images=1,
        )

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini", product_model="nano-banana-2"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_error_response(503))):
                with self.assertRaises(HTTPException):
                    await main.generate_image(request, self.user, self.db)

        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 150)
        task = self.db.query(main.ImageGenerationTask).one()
        self.assertEqual(task.status, "submit_unknown")
        self.assertEqual(task.settlement_status, "REVIEW_REQUIRED")

    async def test_generate_diagram_success_returns_remaining_credits(self):
        request = main.GenerateDiagramRequest(
            session_id="session-1",
            resolution="2K",
            num_images=1,
            aspect_ratio="1:1",
            selected_model="nano-banana-pro",
        )
        template_payload = json.dumps([
            {
                "id": "1.1.1",
                "real_prompt": "标题 {title} 数据 {data} 输入 {user_input}",
                "is_i2i": False,
            }
        ])

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="nano-banana-pro", product_model="nano-banana-pro"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_success_response())):
                with patch("builtins.open", mock_open(read_data=template_payload)):
                    response = await main.generate_diagram(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 120)
        self.assertEqual(response.charged_credits, 80)

    async def test_generate_diagram_503_keeps_hold_for_manual_review(self):
        request = main.GenerateDiagramRequest(
            session_id="session-1",
            resolution="2K",
            num_images=1,
            aspect_ratio="1:1",
        )
        template_payload = json.dumps([
            {
                "id": "1.1.1",
                "real_prompt": "标题 {title} 数据 {data} 输入 {user_input}",
                "is_i2i": False,
            }
        ])

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini", product_model="nano-banana-2"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_error_response(503))):
                with patch("builtins.open", mock_open(read_data=template_payload)):
                    with self.assertRaises(HTTPException):
                        await main.generate_diagram(request, self.user, self.db)

        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 150)
        task = self.db.query(main.ImageGenerationTask).one()
        self.assertEqual(task.status, "submit_unknown")
        self.assertEqual(task.settlement_status, "REVIEW_REQUIRED")

    async def test_gpt_image_2_generate_uses_openai_images_endpoint_and_nano2_pricing(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt for gpt image",
            resolution="2K",
            aspect_ratio="1:1",
            num_images=1,
            selected_model="gpt-image-2",
        )

        channels = (
            main.APIChannel(name="Gemini", base_url="https://gemini.example.com", api_key="key-1", model="gemini-3.1-flash-image-preview", product_model="nano-banana-2"),
            main.APIChannel(name="GPT Image", base_url="https://openai.example.com", api_key="key-2", model="gpt-image-2", product_model="gpt-image-2"),
        )

        _RecordingAsyncClient.last_url = None
        _RecordingAsyncClient.last_json = None
        _RecordingAsyncClient.last_headers = None

        with patch.object(main, "API_CHANNELS", channels):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _RecordingAsyncClient(_gpt_image_success_response())):
                response = await main.generate_image(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 150)
        self.assertEqual(response.charged_credits, 50)
        self.assertEqual(_RecordingAsyncClient.last_url, "https://openai.example.com/v1/images/generations")
        self.assertEqual(_RecordingAsyncClient.last_json["model"], "gpt-image-2")
        self.assertEqual(_RecordingAsyncClient.last_json["prompt"], "test prompt for gpt image")
        self.assertEqual(_RecordingAsyncClient.last_json["size"], "1024x1024")
        self.assertEqual(_RecordingAsyncClient.last_json["quality"], "medium")
        self.assertEqual(_RecordingAsyncClient.last_headers["Authorization"], "Bearer key-2")

    async def test_gpt_image_2_generate_with_auto_aspect_ratio_uses_auto_size(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt for gpt image",
            resolution="2K",
            num_images=1,
            aspect_ratio="auto",
            selected_model="gpt-image-2",
        )

        channels = (
            main.APIChannel(name="GPT Image", base_url="https://openai.example.com", api_key="key-2", model="gpt-image-2", product_model="gpt-image-2"),
        )

        _RecordingAsyncClient.last_url = None
        _RecordingAsyncClient.last_json = None
        _RecordingAsyncClient.last_headers = None

        with patch.object(main, "API_CHANNELS", channels):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _RecordingAsyncClient(_gpt_image_success_response())):
                await main.generate_image(request, self.user, self.db)

        self.assertEqual(_RecordingAsyncClient.last_url, "https://openai.example.com/v1/images/generations")
        self.assertEqual(_RecordingAsyncClient.last_json["size"], "auto")

    async def test_gemini_generate_with_auto_aspect_ratio_omits_fixed_image_config_ratio(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            resolution="2K",
            num_images=1,
            aspect_ratio="auto",
            selected_model="nano-banana-2",
        )

        channels = (
            main.APIChannel(name="Gemini", base_url="https://gemini.example.com", api_key="key-1", model="gemini-3.1-flash-image-preview", product_model="nano-banana-2"),
        )

        _RecordingAsyncClient.last_url = None
        _RecordingAsyncClient.last_json = None
        _RecordingAsyncClient.last_headers = None

        with patch.object(main, "API_CHANNELS", channels):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _RecordingAsyncClient(_success_response())):
                await main.generate_image(request, self.user, self.db)

        generation_config = _RecordingAsyncClient.last_json["generationConfig"]
        self.assertEqual(_RecordingAsyncClient.last_url, "https://gemini.example.com/v1/models/gemini-3.1-flash-image-preview:generateContent")
        self.assertEqual(generation_config["responseModalities"], ["IMAGE"])
        self.assertEqual(
            generation_config["responseFormat"]["image"],
            {"imageSize": "2K"},
        )
        self.assertIn("Idempotency-Key", _RecordingAsyncClient.last_headers)
        self.assertEqual(
            _RecordingAsyncClient.last_headers["Idempotency-Key"],
            _RecordingAsyncClient.last_headers["X-Request-Id"],
        )

    async def test_gpt_image_2_with_reference_images_uses_edits_endpoint(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="edit this reference image",
            image_datas=[VALID_PNG_DATA_URL],
            resolution="1K",
            aspect_ratio="1:1",
            num_images=1,
            selected_model="gpt-image-2",
        )

        channels = (
            main.APIChannel(name="GPT Image", base_url="https://openai.example.com", api_key="key-2", model="gpt-image-2", product_model="gpt-image-2"),
        )

        _RecordingAsyncClient.last_url = None
        _RecordingAsyncClient.last_json = None
        _RecordingAsyncClient.last_data = None
        _RecordingAsyncClient.last_files = None
        _RecordingAsyncClient.last_headers = None

        with patch.object(main, "API_CHANNELS", channels):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _RecordingAsyncClient(_gpt_image_success_response())):
                response = await main.generate_image(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 170)
        self.assertEqual(response.charged_credits, 30)
        self.assertEqual(_RecordingAsyncClient.last_url, "https://openai.example.com/v1/images/edits")
        self.assertIsNone(_RecordingAsyncClient.last_json)
        self.assertEqual(_RecordingAsyncClient.last_data["model"], "gpt-image-2")
        self.assertEqual(_RecordingAsyncClient.last_data["prompt"], "edit this reference image")
        self.assertEqual(_RecordingAsyncClient.last_data["size"], "1024x1024")
        self.assertEqual(_RecordingAsyncClient.last_data["quality"], "low")
        self.assertEqual(_RecordingAsyncClient.last_headers["Authorization"], "Bearer key-2")
        self.assertEqual(len(_RecordingAsyncClient.last_files), 1)
        self.assertEqual(_RecordingAsyncClient.last_files[0][0], "image")
        self.assertEqual(_RecordingAsyncClient.last_files[0][1][0], "reference-1.png")
        self.assertEqual(_RecordingAsyncClient.last_files[0][1][2], "image/png")

    async def test_gpt_image_2_generate_diagram_i2i_uses_edits_endpoint_and_accepts_url_response(self):
        request = main.GenerateDiagramRequest(
            session_id="session-1",
            resolution="2K",
            num_images=1,
            aspect_ratio="1:1",
            selected_model="gpt-image-2",
            base_images=[VALID_PNG_DATA_URL],
        )
        template_payload = json.dumps([
            {
                "id": "1.1.1",
                "real_prompt": "标题 {title} 数据 {data} 输入 {user_input}",
                "is_i2i": True,
            }
        ])

        _RecordingAsyncClient.last_url = None
        _RecordingAsyncClient.last_json = None
        _RecordingAsyncClient.last_data = None
        _RecordingAsyncClient.last_files = None
        _RecordingAsyncClient.last_headers = None

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="GPT Image", base_url="https://openai.example.com", api_key="key-2", model="gpt-image-2", product_model="gpt-image-2"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _RecordingAsyncClient(_gpt_image_url_success_response())):
                with patch.object(
                    main,
                    "_download_remote_generated_image",
                    new=AsyncMock(return_value=VALID_PNG_DATA_URL),
                ):
                    with patch("builtins.open", mock_open(read_data=template_payload)):
                        response = await main.generate_diagram(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 150)
        self.assertEqual(response.charged_credits, 50)
        self.assertEqual(response.image_url, VALID_PNG_DATA_URL)
        self.assertEqual(_RecordingAsyncClient.last_url, "https://openai.example.com/v1/images/edits")
        self.assertEqual(_RecordingAsyncClient.last_data["model"], "gpt-image-2")
        self.assertIn("标题 测试标题 数据 测试数据 输入 测试补充", _RecordingAsyncClient.last_data["prompt"])
        self.assertEqual(len(_RecordingAsyncClient.last_files), 1)


if __name__ == "__main__":
    unittest.main()
