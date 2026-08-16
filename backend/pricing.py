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
SEEDANCE_CREDITS_PER_SECOND: Final[int] = int(os.getenv("SEEDANCE_CREDITS_PER_SECOND", "120"))
DEFAULT_SEEDANCE_MODEL: Final[str] = "seedance-2.0"
DEFAULT_SEEDANCE_RESOLUTION: Final[str] = "720p"
SEEDANCE_RESOLUTION_CREDITS_PER_SECOND: Final[Dict[str, int]] = {
    "720p": 250,
    "1080p": 300,
    "4k": 600,
}
SEEDANCE_25_RESOLUTION_CREDITS_PER_SECOND: Final[Dict[str, int]] = {
    "720p": 275,
    "1080p": 330,
    "4k": 660,
}
MIN_VIDEO_DURATION_SECONDS: Final[int] = 4
MAX_VIDEO_DURATION_SECONDS: Final[int] = int(os.getenv("MAX_VIDEO_DURATION_SECONDS", "15"))
SEEDANCE_25_MIN_VIDEO_DURATION_SECONDS: Final[int] = 2
SEEDANCE_25_MAX_VIDEO_DURATION_SECONDS: Final[int] = int(
    os.getenv("SEEDANCE_25_MAX_VIDEO_DURATION_SECONDS", "30")
)
SEEDANCE_MODEL_RESOLUTION_CREDITS_PER_SECOND: Final[Dict[str, Dict[str, int]]] = {
    "seedance-2.0": SEEDANCE_RESOLUTION_CREDITS_PER_SECOND,
    "seedance-2.5": SEEDANCE_25_RESOLUTION_CREDITS_PER_SECOND,
}
SEEDANCE_MODEL_DURATION_LIMITS: Final[Dict[str, tuple[int, int]]] = {
    "seedance-2.0": (MIN_VIDEO_DURATION_SECONDS, MAX_VIDEO_DURATION_SECONDS),
    "seedance-2.5": (
        SEEDANCE_25_MIN_VIDEO_DURATION_SECONDS,
        SEEDANCE_25_MAX_VIDEO_DURATION_SECONDS,
    ),
}
MODEL_SURCHARGE_PER_IMAGE: Final[Dict[str, int]] = {
    "nano-banana-2": 0,
    "nano-banana-pro": 30,
    "gpt-image-2": 0,
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


def calculate_video_generation_cost(
    duration_seconds: int,
    selected_model: Optional[str] = None,
    resolution: Optional[str] = None,
) -> int:
    model = normalize_video_model(selected_model)
    min_duration, max_duration = get_video_duration_limits(model)
    if duration_seconds < min_duration:
        raise ValueError(f"视频时长不能少于 {min_duration} 秒")
    if duration_seconds > max_duration:
        raise ValueError(f"视频时长不能超过 {max_duration} 秒")
    normalized_resolution = normalize_video_resolution(resolution, model)
    pricing = get_video_resolution_pricing(model)
    return pricing[normalized_resolution] * duration_seconds


def normalize_video_model(selected_model: Optional[str] = None) -> str:
    normalized = (selected_model or DEFAULT_SEEDANCE_MODEL).strip().lower()
    if normalized not in SEEDANCE_MODEL_RESOLUTION_CREDITS_PER_SECOND:
        raise ValueError(f"不支持的视频模型: {selected_model}")
    return normalized


def get_video_duration_limits(selected_model: Optional[str] = None) -> tuple[int, int]:
    model = normalize_video_model(selected_model)
    return SEEDANCE_MODEL_DURATION_LIMITS[model]


def get_video_resolution_pricing(selected_model: Optional[str] = None) -> Dict[str, int]:
    model = normalize_video_model(selected_model)
    return SEEDANCE_MODEL_RESOLUTION_CREDITS_PER_SECOND[model]


def normalize_video_resolution(
    resolution: Optional[str] = None,
    selected_model: Optional[str] = None,
) -> str:
    pricing = get_video_resolution_pricing(selected_model)
    normalized = (resolution or DEFAULT_SEEDANCE_RESOLUTION).strip().lower()
    if normalized not in pricing:
        raise ValueError(f"不支持的视频清晰度: {resolution}")
    return normalized
