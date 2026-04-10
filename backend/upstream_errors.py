import httpx


UPSTREAM_UNAVAILABLE_STATUSES = {502, 503, 504}


def summarize_response_text(text: str, limit: int = 240) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit - 3]}..."


def format_upstream_error(channel_name: str, error: Exception) -> str:
    base = f"渠道 {channel_name} 失败: {type(error).__name__}"

    if isinstance(error, httpx.HTTPStatusError):
        base += f" {error.response.status_code}"
        body = summarize_response_text(error.response.text)
        if body:
            base += f" body={body}"
        return base

    if isinstance(error, httpx.TimeoutException):
        return f"{base} timeout"

    return f"{base} {str(error)}".rstrip()


def map_upstream_failure_status(error: Exception) -> int:
    if isinstance(error, httpx.TimeoutException):
        return 503

    if isinstance(error, httpx.HTTPStatusError):
        if error.response.status_code in UPSTREAM_UNAVAILABLE_STATUSES:
            return 503

    return 500
