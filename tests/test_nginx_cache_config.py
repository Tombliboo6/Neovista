import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NGINX_CONFIG = ROOT / "deploy" / "nginx" / "neovista.conf"


class NginxCacheConfigTests(unittest.TestCase):
    def test_index_html_is_served_with_no_cache_headers(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")

        self.assertRegex(config, r"location = /index\.html\s*\{")
        self.assertRegex(config, r'add_header Cache-Control "no-store, no-cache, must-revalidate"')
        self.assertRegex(config, r'expires -1;')

    def test_favicon_ico_falls_back_to_svg_asset(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")

        self.assertRegex(config, r"location = /favicon\.ico\s*\{")
        self.assertRegex(config, r"try_files /favicon\.svg =404;")

    def test_security_headers_are_enabled(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")

        self.assertIn('add_header Strict-Transport-Security "max-age=15552000" always;', config)
        self.assertIn('add_header X-Content-Type-Options "nosniff" always;', config)
        self.assertIn('add_header X-Frame-Options "DENY" always;', config)
        self.assertIn('add_header Referrer-Policy "strict-origin-when-cross-origin" always;', config)

    def test_sensitive_paths_are_blocked_before_spa_fallback(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")

        self.assertIn("location ~* ^(", config)
        self.assertIn(".*\\.env", config)
        self.assertIn(".*\\.git", config)
        self.assertIn(".*\\.db", config)
        self.assertIn(".*\\.pem", config)
        self.assertIn("/backend/", config)
        self.assertRegex(config, r"return 404;")
        sensitive_location_index = config.index("location ~* ^(")
        spa_location_index = config.index("location / {")
        self.assertLess(sensitive_location_index, spa_location_index)


if __name__ == "__main__":
    unittest.main()
