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


if __name__ == "__main__":
    unittest.main()
