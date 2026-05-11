import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from pricing import calculate_generation_cost, calculate_video_generation_cost


class BillingPricingTest(unittest.TestCase):
    def test_nano_banana_2_resolution_pricing(self):
        self.assertEqual(calculate_generation_cost("1K", 1, "nano-banana-2"), 30)
        self.assertEqual(calculate_generation_cost("2K", 1, "nano-banana-2"), 50)
        self.assertEqual(calculate_generation_cost("4K", 1, "nano-banana-2"), 90)

    def test_nano_banana_pro_adds_30_credits_per_image(self):
        self.assertEqual(calculate_generation_cost("1K", 1, "nano-banana-pro"), 60)
        self.assertEqual(calculate_generation_cost("2K", 1, "nano-banana-pro"), 80)
        self.assertEqual(calculate_generation_cost("4K", 1, "nano-banana-pro"), 120)

    def test_gpt_image_2_uses_nano_banana_2_pricing(self):
        self.assertEqual(calculate_generation_cost("1K", 1, "gpt-image-2"), 30)
        self.assertEqual(calculate_generation_cost("2K", 1, "gpt-image-2"), 50)
        self.assertEqual(calculate_generation_cost("4K", 1, "gpt-image-2"), 90)

    def test_num_images_multiplier(self):
        self.assertEqual(calculate_generation_cost("2K", 3, "nano-banana-2"), 150)
        self.assertEqual(calculate_generation_cost("2K", 3, "nano-banana-pro"), 240)

    def test_defaults_to_nano_banana_2_pricing(self):
        self.assertEqual(calculate_generation_cost("4K", 2), 180)

    def test_seedance_video_pricing_uses_resolution_per_second_rates(self):
        self.assertEqual(calculate_video_generation_cost(5, "seedance-2.0", "480p"), 1000)
        self.assertEqual(calculate_video_generation_cost(5, "seedance-2.0", "720p"), 1250)
        self.assertEqual(calculate_video_generation_cost(5, "seedance-2.0", "1080p"), 1500)

    def test_seedance_video_pricing_defaults_to_720p(self):
        self.assertEqual(calculate_video_generation_cost(5, "seedance-2.0"), 1250)

    def test_seedance_video_pricing_rejects_unsupported_resolution(self):
        with self.assertRaisesRegex(ValueError, "不支持的视频清晰度"):
            calculate_video_generation_cost(5, "seedance-2.0", "2K")


if __name__ == "__main__":
    unittest.main()
