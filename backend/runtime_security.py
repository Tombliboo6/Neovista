import os


_PLACEHOLDER_FRAGMENTS = (
    "your-secret",
    "your_secret",
    "change-in-production",
    "change_me",
    "changeme",
    "placeholder",
    "example-secret",
)


def is_production_runtime() -> bool:
    return os.getenv("NEOVISTA_ENV", os.getenv("APP_ENV", "development")).strip().lower() in {
        "prod", "production"
    }


def require_runtime_secret(name: str, value: str | None) -> str:
    if not value:
        raise RuntimeError(f"{name} 环境变量未设置")
    if not is_production_runtime():
        return value
    normalized = value.strip()
    lowered = normalized.lower()
    if (
        normalized != value
        or len(normalized.encode("utf-8")) < 32
        or len(set(normalized)) < 8
        or any(fragment in lowered for fragment in _PLACEHOLDER_FRAGMENTS)
    ):
        raise RuntimeError(f"{name} 未达到生产环境密钥强度要求")
    return value


def require_distinct_runtime_secrets(
    first_name: str,
    first_value: str,
    second_name: str,
    second_value: str,
) -> None:
    if is_production_runtime() and first_value == second_value:
        raise RuntimeError(f"{first_name} 与 {second_name} 必须使用不同密钥")
