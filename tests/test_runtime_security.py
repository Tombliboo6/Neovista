import os
import pathlib
import sys
import unittest
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from runtime_security import (
    is_production_runtime,
    require_distinct_runtime_secrets,
    require_runtime_secret,
)


class RuntimeSecurityTest(unittest.TestCase):
    def test_development_accepts_short_local_secret(self):
        with patch.dict(os.environ, {"NEOVISTA_ENV": "development"}, clear=False):
            self.assertEqual(require_runtime_secret("TEST_SECRET", "local"), "local")

    def test_production_requires_strong_non_placeholder_secret(self):
        with patch.dict(os.environ, {"NEOVISTA_ENV": "production"}, clear=False):
            self.assertTrue(is_production_runtime())
            rejected = (
                None,
                "short-secret",
                "your-secret-" + "x" * 32,
                "a" * 64,
                " strong-but-surrounded-by-spaces-1234567890 ",
            )
            for value in rejected:
                with self.subTest(value_type=type(value).__name__):
                    with self.assertRaises(RuntimeError):
                        require_runtime_secret("TEST_SECRET", value)

            strong = "J7!vQ2@kL9#rT4$mN8%wX3&cP6*zS1_y"
            self.assertEqual(require_runtime_secret("TEST_SECRET", strong), strong)

    def test_production_requires_distinct_admin_and_jwt_secrets(self):
        with patch.dict(os.environ, {"NEOVISTA_ENV": "production"}, clear=False):
            with self.assertRaises(RuntimeError) as raised:
                require_distinct_runtime_secrets(
                    "ADMIN_SECRET_KEY",
                    "same-secret-value",
                    "JWT_SECRET_KEY",
                    "same-secret-value",
                )
        self.assertNotIn("same-secret-value", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
