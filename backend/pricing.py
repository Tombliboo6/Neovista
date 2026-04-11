import os
from typing import Dict, Final, Optional

CREDITS_PER_YUAN: Final[int] = int(os.getenv("CREDITS_PER_YUAN", "100"))
WELCOME_CREDITS: Final[int] = int(os.getenv("WELCOME_CREDITS", "200"))
DEFAULT_GENERATION_MODEL: Final[str] = "nano-banana-2"
BASE_RESOLUTION_PRICING: Final[Dict[str, int]] = {
    "1K": 30,
    "2K": 50,
    "4K": 90,
}
MODEL_SURCHARGE_PER_IMAGE: Final[Dict[str, int]] = {
    "nano-banana-2": 0,
    "nano-banana-pro": 30,
}


def normalize_generation_model(selected_model: Optional[str] = None) -> str:
    normalized = (selected_model or DEFAULT_GENERATION_MODEL).strip().lower()
    if normalized in MODEL_SURCHARGE_PER_IMAGE:
        return normalized
    return DEFAULT_GENERATION_MODEL


def get_resolution_pricing(selected_model: Optional[str] = None) -> Dict[str, int]:
    model = normalize_generation_model(selected_model)
    surcharge = MODEL_SURCHARGE_PER_IMAGE[model]
    if surcharge == 0:
        return BASE_RESOLUTION_PRICING
    return {
        resolution: price + surcharge
        for resolution, price in BASE_RESOLUTION_PRICING.items()
    }


def calculate_generation_cost(
    resolution: str,
    num_images: int,
    selected_model: Optional[str] = None,
) -> int:
    resolution_pricing = get_resolution_pricing(selected_model)
    if resolution not in resolution_pricing:
        raise ValueError(f"不支持的分辨率: {resolution}")
    if num_images <= 0:
        raise ValueError("生成数量必须大于 0")
    return resolution_pricing[resolution] * num_images
