import os
from typing import Dict, Final

CREDITS_PER_YUAN: Final[int] = int(os.getenv("CREDITS_PER_YUAN", "100"))
WELCOME_CREDITS: Final[int] = int(os.getenv("WELCOME_CREDITS", "200"))
RESOLUTION_PRICING: Final[Dict[str, int]] = {
    "1K": 20,
    "2K": 50,
    "4K": 80,
}


def calculate_generation_cost(resolution: str, num_images: int) -> int:
    if resolution not in RESOLUTION_PRICING:
        raise ValueError(f"不支持的分辨率: {resolution}")
    if num_images <= 0:
        raise ValueError("生成数量必须大于 0")
    return RESOLUTION_PRICING[resolution] * num_images
