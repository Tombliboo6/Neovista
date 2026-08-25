import os
import pathlib
import sys
import unittest
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

import email_utils


class EmailUtilsTest(unittest.TestCase):
    def setUp(self):
        self.original_api_key = os.environ.get("RESEND_API_KEY")
        self.original_from_email = os.environ.get("RESEND_FROM_EMAIL")

    def tearDown(self):
        if self.original_api_key is None:
            os.environ.pop("RESEND_API_KEY", None)
        else:
            os.environ["RESEND_API_KEY"] = self.original_api_key

        if self.original_from_email is None:
            os.environ.pop("RESEND_FROM_EMAIL", None)
        else:
            os.environ["RESEND_FROM_EMAIL"] = self.original_from_email

    def test_send_verification_email_uses_configured_sender(self):
        os.environ["RESEND_API_KEY"] = "test-api-key"
        os.environ["RESEND_FROM_EMAIL"] = "noreply@example.com"

        with self.assertLogs(email_utils.logger, level="INFO") as captured:
            with patch.object(
                email_utils.resend.Emails,
                "send",
                return_value={"id": "provider-response-should-not-be-logged"},
            ) as send_mock:
                success = email_utils.send_verification_email("user@example.com", "123456")

        self.assertTrue(success)
        send_mock.assert_called_once()
        params = send_mock.call_args.args[0]
        self.assertEqual(params["from"], "noreply@example.com")
        self.assertEqual(params["to"], ["user@example.com"])
        logs = "\n".join(captured.output)
        self.assertNotIn("user@example.com", logs)
        self.assertNotIn("provider-response-should-not-be-logged", logs)

    def test_send_verification_email_returns_false_without_sender(self):
        os.environ["RESEND_API_KEY"] = "test-api-key"
        os.environ.pop("RESEND_FROM_EMAIL", None)

        with patch.object(email_utils.resend.Emails, "send") as send_mock:
            success = email_utils.send_verification_email("user@example.com", "123456")

        self.assertFalse(success)
        send_mock.assert_not_called()

    def test_send_verification_email_rejects_non_six_digit_code(self):
        os.environ["RESEND_API_KEY"] = "test-api-key"
        os.environ["RESEND_FROM_EMAIL"] = "noreply@example.com"

        with patch.object(email_utils.resend.Emails, "send") as send_mock:
            success = email_utils.send_verification_email("user@example.com", "１２３４５６")

        self.assertFalse(success)
        send_mock.assert_not_called()

    def test_provider_exception_does_not_log_recipient_or_response(self):
        os.environ["RESEND_API_KEY"] = "test-api-key"
        os.environ["RESEND_FROM_EMAIL"] = "noreply@example.com"
        provider_message = "provider response for private-user@example.com: sensitive-body"

        with self.assertLogs(email_utils.logger, level="WARNING") as captured:
            with patch.object(
                email_utils.resend.Emails,
                "send",
                side_effect=RuntimeError(provider_message),
            ):
                success = email_utils.send_verification_email("private-user@example.com", "123456")

        self.assertFalse(success)
        logs = "\n".join(captured.output)
        self.assertIn("RuntimeError", logs)
        self.assertNotIn("private-user@example.com", logs)
        self.assertNotIn("sensitive-body", logs)


if __name__ == "__main__":
    unittest.main()
