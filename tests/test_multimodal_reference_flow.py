import json
import os
import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main

SAMPLE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=="


class MultimodalReferenceFlowTest(unittest.TestCase):
    def test_normalize_reference_images_keeps_plural_order(self):
        image_list = main._normalize_reference_images(
            image_data="legacy-image",
            image_datas=["image-a", "image-b"],
        )

        self.assertEqual(image_list, ["image-a", "image-b"])

    def test_build_chat_user_message_includes_every_reference_image(self):
        message = main._build_chat_user_message_with_images(
            "请分析这些参考图",
            ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
        )

        self.assertEqual(message["role"], "user")
        self.assertEqual(message["content"][0]["type"], "text")
        self.assertEqual(message["content"][1]["type"], "image_url")
        self.assertEqual(message["content"][2]["type"], "image_url")

    def test_generate_diagram_request_images_override_session_history_images(self):
        session_history = [
            {
                "role": "user",
                "image_data": "history-image",
            }
        ]

        images = main._resolve_generate_diagram_reference_images(
            request_base_image="explicit-image",
            request_base_images=["image-a", "image-b"],
            session_history=session_history,
        )

        self.assertEqual(images, ["image-a", "image-b"])

    def test_compose_reference_image_bytes_merges_multiple_images_for_upstream_calls(self):
        merged = main._compose_reference_image_bytes([SAMPLE_IMAGE, SAMPLE_IMAGE])

        self.assertIsInstance(merged, bytes)
        self.assertGreater(len(merged), 0)

    def test_append_reference_image_parts_collapses_multiple_images_into_one_inline_part(self):
        parts = main._append_reference_image_parts(
            [{"text": "请参考这些图片生图"}],
            [SAMPLE_IMAGE, SAMPLE_IMAGE],
        )

        inline_parts = [part for part in parts if "inlineData" in part]
        self.assertEqual(len(inline_parts), 1)
        self.assertEqual(inline_parts[0]["inlineData"]["mimeType"], "image/jpeg")

    def test_build_multimodal_prompt_keeps_text_from_user_message_with_images(self):
        prompt = main._build_multimodal_prompt_from_messages(
            [
                {"role": "system", "content": "系统提示"},
                main._build_chat_user_message_with_images("请参考这两张图继续分析", [SAMPLE_IMAGE, SAMPLE_IMAGE]),
            ]
        )

        self.assertIn("系统: 系统提示", prompt)
        self.assertIn("用户: 请参考这两张图继续分析", prompt)

    def test_parse_json_object_response_supports_markdown_wrapped_payload(self):
        parsed = main._parse_json_object_response(
            """```json
{
  "reply": "继续补充标题和数据",
  "ready_to_generate": false,
  "suggested_template_id": null,
  "suggested_params": {"title": "", "data": ""}
}
```"""
        )

        self.assertEqual(parsed["reply"], "继续补充标题和数据")
        self.assertFalse(parsed["ready_to_generate"])

    def test_direct_chat_prompt_consultant_mode_detects_scene_and_character_prompt_requests(self):
        self.assertTrue(
            main._should_enable_prompt_consultant_mode(
                "我会给你一个场景设定和角色预设，请帮我推导一版生图提示词"
            )
        )
        self.assertFalse(
            main._should_enable_prompt_consultant_mode(
                "这张图的构图和信息层级有什么问题？"
            )
        )

    def test_build_direct_chat_system_prompt_allows_prompt_consulting_without_entering_agent_flow(self):
        system_prompt = main._build_direct_chat_system_prompt(
            "请根据角色设定和场景预设整理一版 prompt"
        )

        self.assertIn("一句简短中文说明", system_prompt)
        self.assertIn("最终 prompt", system_prompt)
        self.assertNotIn("正向提示词", system_prompt)
        self.assertNotIn("3. 反向提示词", system_prompt)
        self.assertIn("不要返回 ready_to_generate", system_prompt)


if __name__ == "__main__":
    unittest.main()
