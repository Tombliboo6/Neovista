import os
from datetime import datetime
from typing import Any, Dict

import httpx


def _empty_traffic_payload() -> Dict[str, Any]:
    return {
        "summary": {
            "today": {"pv": None, "uv": None},
            "series": [],
            "available": False,
        },
        "top_pages": [],
        "sources": [],
        "devices": [],
    }


def get_traffic_snapshot() -> Dict[str, Any]:
    base_url = os.getenv("UMAMI_BASE_URL")
    website_id = os.getenv("UMAMI_WEBSITE_ID")
    api_token = os.getenv("UMAMI_API_TOKEN")

    if not base_url or not website_id or not api_token:
        return _empty_traffic_payload()

    headers = {"Authorization": f"Bearer {api_token}"}
    params = {
        "startAt": int(datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000),
        "endAt": int(datetime.utcnow().timestamp() * 1000),
    }

    try:
        response = httpx.get(
            f"{base_url.rstrip('/')}/api/websites/{website_id}/stats",
            headers=headers,
            params=params,
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
        return {
            "summary": {
                "today": {
                    "pv": payload.get("pageviews"),
                    "uv": payload.get("visitors"),
                },
                "series": payload.get("series") or [],
                "available": True,
            },
            "top_pages": payload.get("top_pages") or [],
            "sources": payload.get("sources") or [],
            "devices": payload.get("devices") or [],
        }
    except Exception:
        return _empty_traffic_payload()
