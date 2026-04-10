import pathlib
import sys
import unittest

import httpx

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from upstream_errors import format_upstream_error, map_upstream_failure_status, summarize_response_text


class UpstreamErrorsTest(unittest.TestCase):
    def test_summarize_response_text_compacts_and_truncates(self):
        text = "service   overloaded\n\nplease retry later " * 20
        summary = summarize_response_text(text, limit=40)

        self.assertEqual(summary, "service overloaded please retry later...")

    def test_format_upstream_error_includes_status_and_body_summary(self):
        request = httpx.Request("POST", "https://example.com")
        response = httpx.Response(
            503,
            request=request,
            text='{"error":"quota exceeded","message":"retry later"}',
        )
        error = httpx.HTTPStatusError("boom", request=request, response=response)

        message = format_upstream_error("Demo Channel", error)

        self.assertIn("渠道 Demo Channel 失败: HTTPStatusError 503", message)
        self.assertIn('body={"error":"quota exceeded","message":"retry later"}', message)

    def test_map_upstream_failure_status_returns_503_for_retryable_upstream_failures(self):
        request = httpx.Request("POST", "https://example.com")
        response = httpx.Response(503, request=request, text="service unavailable")
        http_error = httpx.HTTPStatusError("boom", request=request, response=response)

        self.assertEqual(map_upstream_failure_status(http_error), 503)
        self.assertEqual(map_upstream_failure_status(httpx.ReadTimeout("timeout")), 503)

    def test_map_upstream_failure_status_keeps_500_for_unexpected_errors(self):
        self.assertEqual(map_upstream_failure_status(RuntimeError("unexpected")), 500)


if __name__ == "__main__":
    unittest.main()
