from __future__ import annotations

from typing import Any, Dict, Optional


def build_gallery_thumbnail_url(image_path: Optional[str]) -> Optional[str]:
    if not image_path:
        return None
    if image_path.startswith("/static/template_images/"):
        filename = image_path.rsplit("/", 1)[-1]
        return f"/api/v1/template-thumbnails/{filename}"
    return image_path


def serialize_template_summary(template: Dict[str, Any]) -> Dict[str, Any]:
    images = template.get("images") or []
    return {
        "id": template["id"],
        "title": template["title"],
        "category_id": template.get("category_id", ""),
        "category_name": template.get("category_name", ""),
        "subcategory_id": template.get("subcategory_id", ""),
        "subcategory_name": template.get("subcategory_name", ""),
        "tips": template.get("tips", ""),
        "images": images,
        "thumbnail_image": build_gallery_thumbnail_url(images[-1] if images else None),
        "is_i2i": template.get("is_i2i", False),
        "is_multi_step": template.get("is_multi_step", False),
        "display_text": template.get("display_text", ""),
        "likes": template.get("likes", 0),
        "uses": template.get("uses", 0),
    }
