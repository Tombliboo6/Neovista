import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from optimize_frontend_gallery import calculate_resize_size


class OptimizeFrontendGalleryTest(unittest.TestCase):
    def test_calculate_resize_size_keeps_small_images_unchanged(self):
        self.assertEqual(calculate_resize_size(800, 600, max_edge=1200), (800, 600))

    def test_calculate_resize_size_scales_landscape_images(self):
        self.assertEqual(calculate_resize_size(2400, 1200, max_edge=1200), (1200, 600))

    def test_calculate_resize_size_scales_portrait_images(self):
        self.assertEqual(calculate_resize_size(1000, 2500, max_edge=1000), (400, 1000))


if __name__ == "__main__":
    unittest.main()
