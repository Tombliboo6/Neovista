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

        with patch.object(email_utils.resend.Emails, "send", return_value={"id": "email_123"}) as send_mock:
            success = email_utils.send_verification_email("user@example.com", "123456")

        self.assertTrue(success)
        send_mock.assert_called_once()
        params = send_mock.call_args.args[0]
        self.assertEqual(params["from"], "noreply@example.com")

    def test_send_verification_email_returns_false_without_sender(self):
        os.environ["RESEND_API_KEY"] = "test-api-key"
        os.environ.pop("RESEND_FROM_EMAIL", None)

        with patch.object(email_utils.resend.Emails, "send") as send_mock:
            success = email_utils.send_verification_email("user@example.com", "123456")

        self.assertFalse(success)
        send_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
