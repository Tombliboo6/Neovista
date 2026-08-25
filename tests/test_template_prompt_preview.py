import os
import pathlib
import sys
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("IMAGE_GENERATION_FEATURE_ENABLED", "true")
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main


class TemplatePromptPreviewTest(unittest.TestCase):
    def setUp(self):
        self.template = {
            "id": "1.1.1",
            "title": "区位分析",
            "real_prompt": "REAL PROMPT {title}",
            "prompt_structure": {
                "p0_text": "标题：{title}",
                "p1_user": "{user_input}",
                "p1_content": "绘制场地分析图",
                "p2_lighting": "自然光照，柔和阴影",
            },
        }

    def test_prompt_preview_uses_real_prompt_without_overrides(self):
        prompt, structure = main._build_effective_template_prompt(self.template)

        self.assertEqual(prompt, "REAL PROMPT {title}")
        self.assertIsNone(structure)

    def test_prompt_preview_resolves_parameters_with_generation_rules(self):
        prompt, structure = main._build_effective_template_prompt(
            self.template,
            parameters={"title": "成都", "user_input": "强调公共交通"},
        )

        self.assertEqual(structure["p0_text"], "标题：成都")
        self.assertEqual(structure["p1_user"], "强调公共交通")
        self.assertIn("标题：成都", prompt)
        self.assertIn("强调公共交通", prompt)
        self.assertIn("绘制场地分析图", prompt)
        self.assertNotIn("自然光照，柔和阴影", prompt)

    def test_prompt_preview_route_is_registered(self):
        paths = {route.path for route in main.app.routes}

        self.assertIn("/api/v1/templates/{template_id}/prompt-preview", paths)

    def test_diagram_prompt_preview_matches_session_generation_prompt(self):
        prompt = main._build_effective_diagram_prompt(
            self.template,
            parameters={"title": "成都", "data": "轨道站点", "user_input": "突出换乘"},
        )

        self.assertIn("REAL PROMPT 成都", prompt)
        self.assertIn("负面提示词:", prompt)


if __name__ == "__main__":
    unittest.main()
