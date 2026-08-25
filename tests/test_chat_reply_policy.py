import os
import pathlib
import sys
import unittest
import base64
import io
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from fastapi import HTTPException
from PIL import Image


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"

os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("ADMIN_SECRET_KEY", "test-admin-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.chdir(BACKEND_DIR)
sys.path.insert(0, str(BACKEND_DIR))

import main


def _png_data_url(color):
    buffer = io.BytesIO()
    Image.new("RGB", (1, 1), color).save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"


IMAGE_A = _png_data_url("red")
IMAGE_B = _png_data_url("blue")


class ChatReplyPolicyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=1)
        self.user_limit_patcher = patch.object(main, "check_and_increment_user_limit")
        self.user_limit_patcher.start()

    def tearDown(self):
        self.user_limit_patcher.stop()

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
                    response = await main.direct_chat(request, object(), self.user, None)

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
            image_data=IMAGE_A,
            image_datas=[IMAGE_A, IMAGE_B],
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "chat_pro_multimodal", new=AsyncMock(return_value="已分析")) as multimodal_mock:
                    response = await main.direct_chat(request, object(), self.user, None)

        self.assertEqual(response.reply, "已分析")
        multimodal_mock.assert_awaited_once()
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: 请分析这两张图", prompt_arg)
        self.assertEqual(images_arg, [IMAGE_A, IMAGE_B])

    async def test_direct_chat_with_images_includes_recent_context_in_multimodal_prompt(self):
        request = main.DirectChatRequest(
            message="最后一条看图问题",
            image_data=IMAGE_A,
            image_datas=[IMAGE_A],
            messages=[
                main.WorkspaceChatMessage(role="user", content="先帮我记住这是一张校园图"),
                main.WorkspaceChatMessage(role="assistant", content="好的，我会结合校园场景来分析。"),
                main.WorkspaceChatMessage(role="user", content="最后一条看图问题"),
            ],
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "_chat_with_reference_images", new=AsyncMock(return_value="已结合上下文分析")) as multimodal_mock:
                    response = await main.direct_chat(request, object(), self.user, None)

        self.assertEqual(response.reply, "已结合上下文分析")
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: 先帮我记住这是一张校园图", prompt_arg)
        self.assertIn("助手: 好的，我会结合校园场景来分析。", prompt_arg)
        self.assertIn("用户: 最后一条看图问题", prompt_arg)
        self.assertEqual(images_arg, [IMAGE_A])

    async def test_direct_chat_chinese_request_enforces_chinese_reply(self):
        request = main.DirectChatRequest(message="请分析这张图的问题")

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(
                    main,
                    "chat_flash",
                    new=AsyncMock(side_effect=["This answer stayed in English.", "这是中文回复。"]),
                ):
                    response = await main.direct_chat(request, object(), self.user, None)

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
                    response = await main.direct_chat(request, object(), self.user, None)

        self.assertIn("This is the English answer.", response.reply)
        self.assertIn("中文翻译：", response.reply)

    async def test_language_rewrite_unknown_submission_returns_first_completed_reply(self):
        provider_failure = main.llm_service.ChatProviderError(
            safe_to_retry=False,
            failure_kind="unknown",
        )

        with patch.object(
            main,
            "chat_flash",
            new=AsyncMock(side_effect=provider_failure),
        ):
            result = await main._enforce_reply_language(
                "请用中文回答",
                "A completed English answer.",
            )

        self.assertEqual(result, "A completed English answer.")

    async def test_workspace_chat_with_images_uses_multimodal_prompt_json_mode_and_preserves_order(self):
        request = main.WorkspaceChatRequest(
            messages=[main.WorkspaceChatMessage(role="user", content="Analyze these references")],
            image_data=IMAGE_A,
            image_datas=[IMAGE_A, IMAGE_B],
            agent_mode=False,
            session_id=None,
        )

        payload = """{"reply":"分析完成","ready_to_generate":false,"suggested_template_id":null,"suggested_params":null}"""

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(main, "chat_pro_multimodal", new=AsyncMock(return_value=payload)) as multimodal_mock:
                    response = await main.workspace_chat(request, object(), self.user, None)

        self.assertEqual(response.reply, "分析完成")
        multimodal_mock.assert_awaited_once()
        prompt_arg, images_arg = multimodal_mock.await_args.args[:2]
        self.assertIn("用户: Analyze these references", prompt_arg)
        self.assertEqual(images_arg, [IMAGE_A, IMAGE_B])
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
                    response = await main.workspace_chat(request, object(), self.user, None)

        self.assertEqual(response.reply, "请先提供标题。")
        self.assertFalse(response.ready_to_generate)
        self.assertEqual(response.suggested_template_id, "1.1.1")
        self.assertEqual(response.suggested_params, {"title": "", "data": ""})

    async def test_multimodal_unknown_submission_never_replays_as_composed_image(self):
        unknown = main.llm_service.ChatProviderError(
            safe_to_retry=False,
            failure_kind="unknown",
        )

        with patch.object(
            main,
            "chat_pro_multimodal",
            new=AsyncMock(side_effect=unknown),
        ) as multimodal_mock:
            with patch.object(main, "_compose_reference_image_bytes") as compose_mock:
                with patch.object(
                    main,
                    "chat_pro_multimodal_image",
                    new=AsyncMock(),
                ) as single_image_mock:
                    with self.assertRaises(main.llm_service.ChatProviderError):
                        await main._chat_with_reference_images(
                            "private prompt",
                            [IMAGE_A, IMAGE_B],
                        )

        multimodal_mock.assert_awaited_once()
        compose_mock.assert_not_called()
        single_image_mock.assert_not_awaited()

    async def test_multimodal_proven_unaccepted_request_can_use_composed_image(self):
        safe_failure = main.llm_service.ChatProviderError(
            safe_to_retry=True,
            failure_kind="rejected",
        )

        with patch.object(
            main,
            "chat_pro_multimodal",
            new=AsyncMock(side_effect=safe_failure),
        ):
            with patch.object(
                main,
                "_compose_reference_image_bytes",
                return_value=b"merged-image",
            ) as compose_mock:
                with patch.object(
                    main,
                    "chat_pro_multimodal_image",
                    new=AsyncMock(return_value="fallback result"),
                ) as single_image_mock:
                    result = await main._chat_with_reference_images(
                        "private prompt",
                        [IMAGE_A, IMAGE_B],
                    )

        self.assertEqual(result, "fallback result")
        compose_mock.assert_called_once_with([IMAGE_A, IMAGE_B])
        single_image_mock.assert_awaited_once_with("private prompt", b"merged-image")

    async def test_direct_chat_provider_failure_returns_only_generic_detail(self):
        request = main.DirectChatRequest(message="private user prompt")
        provider_failure = main.llm_service.ChatProviderError(
            safe_to_retry=False,
            failure_kind="unknown",
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(main, "check_and_increment_ip_limit"):
                with patch.object(
                    main,
                    "chat_flash",
                    new=AsyncMock(side_effect=provider_failure),
                ):
                    with self.assertRaises(HTTPException) as raised:
                        await main.direct_chat(request, object(), self.user, None)

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(
            raised.exception.detail,
            "对话服务暂时不可用，请稍后重试",
        )
        self.assertNotIn("private user prompt", raised.exception.detail)

    async def test_workspace_chat_rate_limit_returns_429(self):
        request = main.WorkspaceChatRequest(
            messages=[main.WorkspaceChatMessage(role="user", content="继续分析")],
            agent_mode=True,
            session_id=None,
        )

        with patch.object(main, "extract_client_ip", return_value="1.1.1.1"):
            with patch.object(
                main,
                "check_and_increment_ip_limit",
                side_effect=ValueError("请求过于频繁，请稍后再试"),
            ):
                with self.assertRaises(HTTPException) as raised:
                    await main.workspace_chat(request, object(), self.user, None)

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail, "请求过于频繁，请稍后再试")


if __name__ == "__main__":
    unittest.main()
