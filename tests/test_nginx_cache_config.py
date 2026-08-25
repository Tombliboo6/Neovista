import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NGINX_CONFIG = ROOT / "deploy" / "nginx" / "neovista-cn.conf"


def _extract_block(config: str, marker: str) -> str:
    start = config.index(marker)
    opening_brace = config.index("{", start)
    depth = 0
    for index in range(opening_brace, len(config)):
        if config[index] == "{":
            depth += 1
        elif config[index] == "}":
            depth -= 1
            if depth == 0:
                return config[start:index + 1]
    raise AssertionError(f"Unclosed Nginx block: {marker}")


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
        spa_location_index = config.index("location / {", sensitive_location_index)
        self.assertLess(sensitive_location_index, spa_location_index)

    def test_api_proxy_timeout_exceeds_seedance_upstream_timeout(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        api_block = _extract_block(config, "location ^~ /api/")

        self.assertIn("proxy_connect_timeout 10s;", api_block)
        self.assertIn("proxy_send_timeout 210s;", api_block)
        self.assertIn("proxy_read_timeout 210s;", api_block)

    def test_api_proxy_overwrites_untrusted_forwarded_headers(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        api_block = _extract_block(config, "location ^~ /api/")

        self.assertIn("proxy_set_header X-Forwarded-For $remote_addr;", api_block)
        self.assertIn("proxy_set_header X-Forwarded-Host $host;", api_block)
        self.assertIn('proxy_set_header Forwarded "";', api_block)
        self.assertNotIn("$proxy_add_x_forwarded_for", api_block)

        full_config = config
        self.assertNotIn("$proxy_add_x_forwarded_for", full_config)

    def test_body_limits_allow_the_backend_24_mib_reference_contract(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        video_block = _extract_block(config, "location = /api/v1/video/generate")

        self.assertIn("client_max_body_size 26M;", config)
        self.assertIn("client_max_body_size 26M;", video_block)

    def test_missing_vite_assets_strictly_return_404(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        assets_block = _extract_block(config, "location ^~ /assets/")

        self.assertIn("try_files $uri =404;", assets_block)
        self.assertNotIn("/index.html", assets_block)
        self.assertIn('Cache-Control "public, max-age=31536000, immutable"', assets_block)

    def test_stable_gallery_urls_never_inherit_immutable_asset_cache(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        gallery_block = _extract_block(config, "location ^~ /gallery/")

        self.assertIn("try_files $uri =404;", gallery_block)
        self.assertIn("expires off;", gallery_block)
        self.assertIn(
            'Cache-Control "public, max-age=3600, must-revalidate" always;',
            gallery_block,
        )
        self.assertNotIn("immutable", gallery_block)
        self.assertLess(
            config.index("location ^~ /gallery/"),
            config.index("location ~* ^/(?!api/).+\\.(js|css|png"),
        )

    def test_seedance_references_are_not_cached_or_indexed(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        seedance_block = _extract_block(config, "location ^~ /static/seedance_references/")

        self.assertIn("root /var/www/neovista/backend;", seedance_block)
        self.assertIn("try_files $uri =404;", seedance_block)
        self.assertIn('Cache-Control "private, no-store, no-cache, must-revalidate, max-age=0" always;', seedance_block)
        self.assertIn("default-src 'none'", seedance_block)
        self.assertIn("object-src 'none'", seedance_block)
        self.assertIn("frame-ancestors 'none'", seedance_block)
        self.assertIn('X-Robots-Tag "noindex, nofollow, nosnippet, noarchive" always;', seedance_block)
        self.assertIn("limit_except GET HEAD", seedance_block)
        self.assertIn("autoindex off;", seedance_block)

        generic_static_index = config.index("location ^~ /static/ {")
        seedance_index = config.index("location ^~ /static/seedance_references/")
        self.assertLess(seedance_index, generic_static_index)

    def test_api_subdomain_cannot_serve_seedance_references(self):
        config = NGINX_CONFIG.read_text(encoding="utf-8")
        api_server = config[config.rindex("server_name api.neovista.cn"):]
        seedance_block = _extract_block(api_server, "location ^~ /static/seedance_references/")

        self.assertIn("return 404;", seedance_block)
        self.assertIn("no-store", seedance_block)
        self.assertIn("X-Robots-Tag", seedance_block)
        self.assertNotIn("proxy_pass", seedance_block)


if __name__ == "__main__":
    unittest.main()
