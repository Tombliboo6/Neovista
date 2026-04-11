import os
import pathlib
import sys
import unittest
from unittest.mock import mock_open, patch
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
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main
from billing_service import grant_welcome_credits
from models import Base, ChatSession, User


class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
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
                                    "data": "ZmFrZS1pbWFnZQ=="
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

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_success_response())):
                response = await main.generate_image(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 120)
        self.assertEqual(response.charged_credits, 80)

    async def test_upstream_503_refunds_credits(self):
        request = main.GenerateRequest(
            template_id=None,
            user_params="test prompt",
            resolution="2K",
            num_images=1,
        )

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_error_response(503))):
                with self.assertRaises(HTTPException):
                    await main.generate_image(request, self.user, self.db)

        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 200)

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

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_success_response())):
                with patch("builtins.open", mock_open(read_data=template_payload)):
                    response = await main.generate_diagram(request, self.user, self.db)

        self.assertEqual(response.remaining_credits, 120)
        self.assertEqual(response.charged_credits, 80)

    async def test_generate_diagram_503_refunds_credits(self):
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

        with patch.object(main, "API_CHANNELS", (main.APIChannel(name="Test", base_url="https://example.com", api_key="key", model="gemini"),)):
            with patch.object(main.httpx, "AsyncClient", lambda timeout=60.0: _FakeAsyncClient(_error_response(503))):
                with patch("builtins.open", mock_open(read_data=template_payload)):
                    with self.assertRaises(HTTPException):
                        await main.generate_diagram(request, self.user, self.db)

        self.db.refresh(self.user)
        self.assertEqual(self.user.credits, 200)


if __name__ == "__main__":
    unittest.main()
