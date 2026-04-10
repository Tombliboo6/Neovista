import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from pricing import calculate_generation_cost


class BillingPricingTest(unittest.TestCase):
    def test_resolution_pricing(self):
        self.assertEqual(calculate_generation_cost("1K", 1), 30)
        self.assertEqual(calculate_generation_cost("2K", 1), 50)
        self.assertEqual(calculate_generation_cost("4K", 1), 90)

    def test_num_images_multiplier(self):
        self.assertEqual(calculate_generation_cost("2K", 3), 150)

    def test_higher_resolution_multiplier(self):
        self.assertEqual(calculate_generation_cost("4K", 2), 180)


if __name__ == "__main__":
    unittest.main()
