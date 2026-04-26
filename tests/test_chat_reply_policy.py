import os
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main


class ChatReplyPolicyTest(unittest.IsolatedAsyncioTestCase):
    async def test_direct_chat_with_messages_uses_recent_context_for_flash(self):
        request = main.DirectChatRequest(
            message="最后一条问题",
            messages=[
                main.WorkspaceChatMessage(role="user", content="第一条问题"),
                main.WorkspaceChatMessage(role="assistant", content="第一条回答"),
                main.WorkspaceChatMessage(role="user", content="最后一条问题"),
            ],
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "chat_flash", new=AsyncMock(return_value="结合上下文的回答")) as flash_mock:
                    response = await main.direct_chat(request, object(), None)

        self.assertEqual(response.reply, "结合上下文的回答")
        flash_mock.assert_awaited_once()
        messages_arg = flash_mock.await_args.args[0]
        self.assertEqual(messages_arg[1]["role"], "user")
        self.assertEqual(messages_arg[1]["content"], "第一条问题")
        self.assertEqual(messages_arg[2]["role"], "assistant")
        self.assertEqual(messages_arg[2]["content"], "第一条回答")
        self.assertEqual(messages_arg[3]["role"], "user")
        self.assertEqual(messages_arg[3]["content"], "最后一条问题")

    async def test_direct_chat_with_images_uses_multimodal_prompt_and_preserves_order(self):
        request = main.DirectChatRequest(
            message="请分析这两张图",
            image_data="legacy-image",
            image_datas=["image-a", "image-b"],
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "chat_pro_multimodal", new=AsyncMock(return_value="已分析")) as multimodal_mock:
                    response = await main.direct_chat(request, object(), None)

        self.assertEqual(response.reply, "已分析")
        multimodal_mock.assert_awaited_once()
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: 请分析这两张图", prompt_arg)
        self.assertEqual(images_arg, ["image-a", "image-b"])

    async def test_direct_chat_with_images_includes_recent_context_in_multimodal_prompt(self):
        request = main.DirectChatRequest(
            message="最后一条看图问题",
            image_data="legacy-image",
            image_datas=["image-a"],
            messages=[
                main.WorkspaceChatMessage(role="user", content="先帮我记住这是一张校园图"),
                main.WorkspaceChatMessage(role="assistant", content="好的，我会结合校园场景来分析。"),
                main.WorkspaceChatMessage(role="user", content="最后一条看图问题"),
            ],
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "_chat_with_reference_images", new=AsyncMock(return_value="已结合上下文分析")) as multimodal_mock:
                    response = await main.direct_chat(request, object(), None)

        self.assertEqual(response.reply, "已结合上下文分析")
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: 先帮我记住这是一张校园图", prompt_arg)
        self.assertIn("助手: 好的，我会结合校园场景来分析。", prompt_arg)
        self.assertIn("用户: 最后一条看图问题", prompt_arg)
        self.assertEqual(images_arg, ["image-a"])

    async def test_direct_chat_chinese_request_enforces_chinese_reply(self):
        request = main.DirectChatRequest(message="请分析这张图的问题")

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(
                    main,
                    "chat_flash",
                    new=AsyncMock(side_effect=["This answer stayed in English.", "这是中文回复。"]),
                ):
                    response = await main.direct_chat(request, object(), None)

        self.assertEqual(response.reply, "这是中文回复。")

    async def test_direct_chat_english_request_appends_chinese_translation(self):
        request = main.DirectChatRequest(message="Please analyze this image")

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(
                    main,
                    "chat_flash",
                    new=AsyncMock(
                        side_effect=[
                            "This is the English answer.",
                            "This is the English answer.\n\n中文翻译：这是中文翻译。",
                        ]
                    ),
                ):
                    response = await main.direct_chat(request, object(), None)

        self.assertIn("This is the English answer.", response.reply)
        self.assertIn("中文翻译：", response.reply)

    async def test_workspace_chat_with_images_uses_multimodal_prompt_json_mode_and_preserves_order(self):
        request = main.WorkspaceChatRequest(
            messages=[main.WorkspaceChatMessage(role="user", content="Analyze these references")],
            image_data="legacy-image",
            image_datas=["image-a", "image-b"],
            agent_mode=False,
            session_id=None,
        )

        payload = """{"reply":"分析完成","ready_to_generate":false,"suggested_template_id":null,"suggested_params":null}"""

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "chat_pro_multimodal", new=AsyncMock(return_value=payload)) as multimodal_mock:
                    response = await main.workspace_chat(request, object(), None)

        self.assertEqual(response.reply, "分析完成")
        multimodal_mock.assert_awaited_once()
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: Analyze these references", prompt_arg)
        self.assertEqual(images_arg, ["image-a", "image-b"])
        self.assertTrue(multimodal_mock.await_args.kwargs["json_mode"])

    async def test_workspace_chat_language_fix_preserves_control_fields(self):
        request = main.WorkspaceChatRequest(
            messages=[main.WorkspaceChatMessage(role="user", content="请继续确认参数")],
            agent_mode=False,
            session_id=None,
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(
                    main,
                    "chat_flash",
                    new=AsyncMock(
                        side_effect=[
                            """{"reply":"Please provide the title first.","ready_to_generate":false,"suggested_template_id":"1.1.1","suggested_params":{"title":"","data":""}}""",
                            "请先提供标题。",
                        ]
                    ),
                ):
                    response = await main.workspace_chat(request, object(), None)

        self.assertEqual(response.reply, "请先提供标题。")
        self.assertFalse(response.ready_to_generate)
        self.assertEqual(response.suggested_template_id, "1.1.1")
        self.assertEqual(response.suggested_params, {"title": "", "data": ""})


if __name__ == "__main__":
    unittest.main()
