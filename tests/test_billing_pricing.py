import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from pricing import calculate_generation_cost


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


if __name__ == "__main__":
    unittest.main()
