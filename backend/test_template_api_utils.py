import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from template_api_utils import build_gallery_thumbnail_url, serialize_template_summary


class TemplateApiUtilsTest(unittest.TestCase):
    def test_build_gallery_thumbnail_url_rewrites_template_image_paths(self):
        self.assertEqual(
            build_gallery_thumbnail_url("/static/template_images/1_1_1_0.png"),
            "/api/v1/template-thumbnails/1_1_1_0.png",
        )

    def test_build_gallery_thumbnail_url_preserves_non_template_paths(self):
        self.assertEqual(
            build_gallery_thumbnail_url("https://example.com/image.png"),
            "https://example.com/image.png",
        )
        self.assertIsNone(build_gallery_thumbnail_url(None))

    def test_serialize_template_summary_removes_heavy_prompt_fields(self):
        summary = serialize_template_summary(
            {
                "id": "1.1.1",
                "title": "测试模板",
                "category_id": "1",
                "category_name": "分析",
                "subcategory_id": "1.1",
                "subcategory_name": "区位",
                "tips": "提示",
                "images": ["/static/template_images/1_1_1_0.png"],
                "is_i2i": True,
                "is_multi_step": False,
                "prompt_structure": {"p1": "heavy"},
                "real_prompt": "very heavy prompt",
                "display_text": "展示文案",
                "likes": 3,
                "uses": 9,
            }
        )

        self.assertEqual(summary["thumbnail_image"], "/api/v1/template-thumbnails/1_1_1_0.png")
        self.assertNotIn("prompt_structure", summary)
        self.assertNotIn("real_prompt", summary)
        self.assertEqual(summary["title"], "测试模板")
        self.assertEqual(summary["category_name"], "分析")


if __name__ == "__main__":
    unittest.main()
