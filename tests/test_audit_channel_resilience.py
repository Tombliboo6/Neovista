import pathlib
import sys
import unittest
from unittest.mock import patch

import httpx

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

import llm_service


class _SequencedAsyncClient:
    outcomes = []
    timeouts = []
    requests = []

    def __init__(self, timeout):
        self._timeout = timeout
        type(self).timeouts.append(timeout)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, json, headers):
        type(self).requests.append((url, json, headers))
        outcome = type(self).outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class AuditChannelResilienceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _SequencedAsyncClient.outcomes = []
        _SequencedAsyncClient.timeouts = []
        _SequencedAsyncClient.requests = []

    async def test_chat_pro_multimodal_json_retries_then_falls_back_to_next_channel(self):
        channels = (
            llm_service.ChatChannel(
                name="primary",
                base_url="https://primary.example.com",
                api_key="key-1",
                model="gemini-primary",
            ),
            llm_service.ChatChannel(
                name="secondary",
                base_url="https://secondary.example.com",
                api_key="key-2",
                model="gemini-secondary",
            ),
        )
        success_response = httpx.Response(
            200,
            request=httpx.Request("POST", "https://secondary.example.com/v1/chat/completions"),
            json={
                "choices": [
                    {
                        "message": {
                            "content": "{\"is_pass\": true, \"overview\": \"ok\", \"positive\": [], \"negative\": [], \"suggestions\": []}"
                        }
                    }
                ]
            },
        )

        _SequencedAsyncClient.outcomes = [
            httpx.ReadTimeout("timed out"),
            httpx.ReadTimeout("timed out again"),
            success_response,
        ]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                result = await llm_service.chat_pro_multimodal_json(
                    "请审核这张建筑分析图",
                    b"fake-image-bytes",
                )

        self.assertIn("\"is_pass\": true", result)
        self.assertEqual(len(_SequencedAsyncClient.requests), 3)
        self.assertEqual(_SequencedAsyncClient.timeouts, [90.0, 90.0, 90.0])
        self.assertEqual(_SequencedAsyncClient.requests[0][0], "https://primary.example.com/v1/chat/completions")
        self.assertEqual(_SequencedAsyncClient.requests[-1][0], "https://secondary.example.com/v1/chat/completions")


if __name__ == "__main__":
    unittest.main()
