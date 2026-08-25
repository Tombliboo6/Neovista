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

    def _channels(self):
        return (
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

    @staticmethod
    def _success_response(content="分析完成"):
        return httpx.Response(
            200,
            request=httpx.Request("POST", "https://secondary.example.com/v1/chat/completions"),
            json={"choices": [{"message": {"content": content}}]},
        )

    async def test_read_timeout_is_unknown_and_never_replayed_or_failed_over(self):
        channels = self._channels()
        secret_error = httpx.ReadTimeout(
            "upstream https://secret.example/internal echoed private prompt",
            request=httpx.Request("POST", "https://primary.example.com/v1/chat/completions"),
        )
        _SequencedAsyncClient.outcomes = [secret_error, self._success_response()]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                with patch("builtins.print") as print_mock:
                    with self.assertRaises(llm_service.ChatProviderError) as raised:
                        await llm_service.chat_pro_multimodal_json(
                            "请审核这张建筑分析图",
                            b"fake-image-bytes",
                        )

        self.assertFalse(raised.exception.safe_to_retry)
        self.assertEqual(raised.exception.failure_kind, "unknown")
        self.assertEqual(str(raised.exception), "Chat service temporarily unavailable")
        self.assertEqual(len(_SequencedAsyncClient.requests), 1)
        rendered_logs = "\n".join(
            " ".join(str(value) for value in call.args)
            for call in print_mock.call_args_list
        )
        self.assertNotIn("secret.example", rendered_logs)
        self.assertNotIn("private prompt", rendered_logs)

    async def test_http_503_is_unknown_and_never_failed_over(self):
        channels = self._channels()
        upstream_503 = httpx.Response(
            503,
            request=httpx.Request("POST", "https://primary.example.com/v1/chat/completions"),
            json={"error": {"message": "sensitive upstream body"}},
        )
        _SequencedAsyncClient.outcomes = [upstream_503, self._success_response()]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                with self.assertRaises(llm_service.ChatProviderError) as raised:
                    await llm_service.chat_pro_multimodal_image(
                        "请分析这些参考图",
                        b"fake-image-bytes",
                    )

        self.assertFalse(raised.exception.safe_to_retry)
        self.assertEqual(len(_SequencedAsyncClient.requests), 1)

    async def test_connect_failure_can_safely_fail_over_once(self):
        channels = self._channels()
        _SequencedAsyncClient.outcomes = [
            httpx.ConnectError(
                "connection refused",
                request=httpx.Request("POST", "https://primary.example.com/v1/chat/completions"),
            ),
            self._success_response("safe failover succeeded"),
        ]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                result = await llm_service.chat_pro_multimodal_image(
                    "请分析这些参考图",
                    b"fake-image-bytes",
                )

        self.assertEqual(result, "safe failover succeeded")
        self.assertEqual(len(_SequencedAsyncClient.requests), 2)
        self.assertEqual(_SequencedAsyncClient.timeouts, [90.0, 90.0])

    async def test_explicit_pre_acceptance_rejection_can_fail_over(self):
        channels = self._channels()
        rejected = httpx.Response(
            429,
            request=httpx.Request("POST", "https://primary.example.com/v1/chat/completions"),
            json={"error": {"message": "quota details must not escape"}},
        )
        _SequencedAsyncClient.outcomes = [rejected, self._success_response("second channel")]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                result = await llm_service.chat_pro_multimodal_image(
                    "请分析这些参考图",
                    b"fake-image-bytes",
                )

        self.assertEqual(result, "second channel")
        self.assertEqual(len(_SequencedAsyncClient.requests), 2)

    async def test_malformed_200_is_unknown_and_never_failed_over(self):
        channels = self._channels()
        malformed = httpx.Response(
            200,
            request=httpx.Request("POST", "https://primary.example.com/v1/chat/completions"),
            json={"unexpected": "shape"},
        )
        _SequencedAsyncClient.outcomes = [malformed, self._success_response()]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                with self.assertRaises(llm_service.ChatProviderError) as raised:
                    await llm_service.chat_pro_multimodal_image(
                        "请分析这些参考图",
                        b"fake-image-bytes",
                    )

        self.assertFalse(raised.exception.safe_to_retry)
        self.assertEqual(len(_SequencedAsyncClient.requests), 1)

    async def test_chat_pro_multimodal_json_preserves_success_payload(self):
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

        _SequencedAsyncClient.outcomes = [success_response]

        with patch.object(llm_service, "PRO_CHAT_CHANNELS", channels):
            with patch.object(llm_service.httpx, "AsyncClient", _SequencedAsyncClient):
                result = await llm_service.chat_pro_multimodal_json(
                    "请审核这张建筑分析图",
                    b"fake-image-bytes",
                )

        self.assertIn("\"is_pass\": true", result)
        self.assertEqual(len(_SequencedAsyncClient.requests), 1)
        self.assertEqual(_SequencedAsyncClient.timeouts, [90.0])
        self.assertEqual(_SequencedAsyncClient.requests[0][0], "https://primary.example.com/v1/chat/completions")

    def test_audit_route_never_logs_provider_response_body(self):
        source = (REPO_ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        self.assertNotIn('返回内容: {text[:200]}', source)
        self.assertIn('供应商返回成功（响应长度: {len(text)}）', source)

    def test_production_request_paths_never_emit_raw_tracebacks(self):
        for relative_path in ("backend/main.py", "backend/monitoring_service.py"):
            with self.subTest(relative_path=relative_path):
                source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertNotIn("traceback.print_exc", source)

if __name__ == "__main__":
    unittest.main()
