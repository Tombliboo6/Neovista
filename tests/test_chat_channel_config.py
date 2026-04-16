import pathlib
import sys
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

import llm_service


class ChatChannelConfigTest(unittest.TestCase):
    def test_split_flash_and_pro_channels_can_use_different_api_keys(self):
        env = {
            "CHAT_FLASH_CHANNEL_1_NAME": "Flash Primary",
            "CHAT_FLASH_CHANNEL_1_BASE_URL": "https://flash.example.com",
            "CHAT_FLASH_CHANNEL_1_API_KEY": "flash-key-1",
            "CHAT_FLASH_CHANNEL_1_MODEL": "gemini-3.1-flash-lite-preview",
            "CHAT_PRO_CHANNEL_1_NAME": "Pro Primary",
            "CHAT_PRO_CHANNEL_1_BASE_URL": "https://pro.example.com",
            "CHAT_PRO_CHANNEL_1_API_KEY": "pro-key-1",
            "CHAT_PRO_CHANNEL_1_MODEL": "gemini-3.1-pro-preview",
        }

        with patch.dict("os.environ", env, clear=True):
            llm_service.get_flash_chat_channels.cache_clear()
            llm_service.get_pro_chat_channels.cache_clear()

            flash_channels = llm_service.get_flash_chat_channels()
            pro_channels = llm_service.get_pro_chat_channels()

        self.assertEqual(len(flash_channels), 1)
        self.assertEqual(len(pro_channels), 1)
        self.assertEqual(flash_channels[0].api_key, "flash-key-1")
        self.assertEqual(pro_channels[0].api_key, "pro-key-1")
        self.assertEqual(flash_channels[0].model, "gemini-3.1-flash-lite-preview")
        self.assertEqual(pro_channels[0].model, "gemini-3.1-pro-preview")

    def test_legacy_chat_channel_env_still_populates_both_flash_and_pro(self):
        env = {
            "CHAT_CHANNEL_1_NAME": "Legacy Channel",
            "CHAT_CHANNEL_1_BASE_URL": "https://legacy.example.com",
            "CHAT_CHANNEL_1_API_KEY": "legacy-key",
            "CHAT_CHANNEL_1_FLASH_MODEL": "gemini-3.1-flash-lite-preview",
            "CHAT_CHANNEL_1_PRO_MODEL": "gemini-3.1-pro-preview",
        }

        with patch.dict("os.environ", env, clear=True):
            llm_service.get_flash_chat_channels.cache_clear()
            llm_service.get_pro_chat_channels.cache_clear()

            flash_channels = llm_service.get_flash_chat_channels()
            pro_channels = llm_service.get_pro_chat_channels()

        self.assertEqual(len(flash_channels), 1)
        self.assertEqual(len(pro_channels), 1)
        self.assertEqual(flash_channels[0].api_key, "legacy-key")
        self.assertEqual(pro_channels[0].api_key, "legacy-key")
        self.assertEqual(flash_channels[0].model, "gemini-3.1-flash-lite-preview")
        self.assertEqual(pro_channels[0].model, "gemini-3.1-pro-preview")

    def test_workspace_agent_chat_uses_flash_when_agent_mode_is_off(self):
        self.assertEqual(llm_service.select_workspace_chat_model(False), "flash")

    def test_workspace_agent_chat_uses_pro_when_agent_mode_is_on(self):
        self.assertEqual(llm_service.select_workspace_chat_model(True), "pro")

    def test_workspace_chat_with_reference_images_uses_pro(self):
        self.assertEqual(llm_service.select_workspace_chat_model(False, has_reference_images=True), "pro")


if __name__ == "__main__":
    unittest.main()
