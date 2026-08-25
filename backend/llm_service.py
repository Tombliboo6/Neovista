"""
NeoVista LLM Service — 纯函数网关
无状态，接收 messages 返回 reply，阅后即焚
多渠道容灾：按序尝试，首个成功即返回
"""

import os
import base64
import httpx
from typing import List, Optional, Tuple
from functools import lru_cache
from pydantic import BaseModel


SAFE_CHAT_REJECTION_STATUS_CODES = frozenset({
    400,
    401,
    403,
    404,
    405,
    413,
    415,
    422,
    429,
})


class ChatProviderError(RuntimeError):
    """Sanitized provider failure with an explicit replay-safety disposition."""

    def __init__(self, *, safe_to_retry: bool, failure_kind: str):
        super().__init__("Chat service temporarily unavailable")
        self.safe_to_retry = safe_to_retry
        self.failure_kind = failure_kind


class ChatChannel(BaseModel):
    name: str
    base_url: str
    api_key: str
    model: str

    class Config:
        frozen = True


@lru_cache(maxsize=1)
def _load_split_chat_channels(kind: str, default_model: str) -> Tuple[ChatChannel, ...]:
    """动态加载 CHAT_FLASH_CHANNEL_1/2... 或 CHAT_PRO_CHANNEL_1/2... 环境变量"""
    channels = []
    i = 1
    while True:
        prefix = f"CHAT_{kind}_CHANNEL_{i}"
        name = os.getenv(f"{prefix}_NAME")
        if not name:
            break
        channels.append(ChatChannel(
            name=name,
            base_url=os.getenv(f"{prefix}_BASE_URL"),
            api_key=os.getenv(f"{prefix}_API_KEY"),
            model=os.getenv(f"{prefix}_MODEL", default_model),
        ))
        i += 1
    return tuple(channels)


@lru_cache(maxsize=1)
def _load_legacy_chat_channels(model_field: str, default_model: str) -> Tuple[ChatChannel, ...]:
    """兼容旧的 CHAT_CHANNEL_1/2... 变量写法"""
    channels = []
    i = 1
    while True:
        prefix = f"CHAT_CHANNEL_{i}"
        name = os.getenv(f"{prefix}_NAME")
        if not name:
            break
        channels.append(ChatChannel(
            name=name,
            base_url=os.getenv(f"{prefix}_BASE_URL"),
            api_key=os.getenv(f"{prefix}_API_KEY"),
            model=os.getenv(f"{prefix}_{model_field}", default_model),
        ))
        i += 1
    return tuple(channels)


@lru_cache(maxsize=1)
def get_flash_chat_channels() -> Tuple[ChatChannel, ...]:
    channels = _load_split_chat_channels("FLASH", "gemini-2.0-flash")
    if channels:
        return channels
    return _load_legacy_chat_channels("FLASH_MODEL", "gemini-2.0-flash")


@lru_cache(maxsize=1)
def get_pro_chat_channels() -> Tuple[ChatChannel, ...]:
    channels = _load_split_chat_channels("PRO", "gemini-2.5-pro")
    if channels:
        return channels
    return _load_legacy_chat_channels("PRO_MODEL", "gemini-2.5-pro")


FLASH_CHAT_CHANNELS = get_flash_chat_channels()
PRO_CHAT_CHANNELS = get_pro_chat_channels()


def init_chat_channels():
    """启动时调用，加载渠道配置"""
    global FLASH_CHAT_CHANNELS, PRO_CHAT_CHANNELS
    _load_split_chat_channels.cache_clear()
    _load_legacy_chat_channels.cache_clear()
    get_flash_chat_channels.cache_clear()
    get_pro_chat_channels.cache_clear()

    FLASH_CHAT_CHANNELS = get_flash_chat_channels()
    PRO_CHAT_CHANNELS = get_pro_chat_channels()

    print(f"✅ 已加载 {len(FLASH_CHAT_CHANNELS)} 个Flash Chat渠道")
    print(f"✅ 已加载 {len(PRO_CHAT_CHANNELS)} 个Pro Chat渠道")


def should_use_pro(image_data: Optional[str]) -> bool:
    """检测图片是否需要 Pro 模型处理"""
    if not image_data:
        return False
    # 提取 base64 数据
    if image_data.startswith("data:"):
        raw = image_data.split(",", 1)[1]
    else:
        raw = image_data
    # base64 大小估算原始字节: len * 3/4
    estimated_bytes = len(raw) * 3 // 4
    # 低于 100KB 降级 Flash
    if estimated_bytes < 100 * 1024:
        return False
    return True


def select_workspace_chat_model(agent_mode: bool, has_reference_images: bool = False) -> str:
    """工作区聊天按 Agent 开关选择模型；审图仍走单独 Pro 接口。"""
    return "pro" if agent_mode or has_reference_images else "flash"


def _chat_failure_disposition(exception: Exception) -> Tuple[bool, str]:
    """Return whether a fresh request is provably safe after this failure.

    Connect/pool acquisition failures happen before a request can be accepted.
    Explicit client-side rejection statuses are also treated as not accepted.
    Read/write/transport failures, 5xx responses, and malformed success bodies are
    submission-ambiguous and must never be replayed automatically.
    """
    if isinstance(exception, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
        return True, "not_sent"
    if isinstance(exception, httpx.HTTPStatusError):
        response = exception.response
        if response is not None and response.status_code in SAFE_CHAT_REJECTION_STATUS_CODES:
            return True, "rejected"
    return False, "unknown"


def _provider_failure_log_label(exception: Exception, failure_kind: str) -> str:
    """Build a bounded label without serializing provider messages or requests."""
    return f"{type(exception).__name__}/{failure_kind}"


def _resolve_chat_url(channel: ChatChannel) -> str:
    """智能拼接 chat completions URL"""
    base = channel.base_url.rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    if base.endswith('/v1') or base.endswith('/openai'):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


async def _call_openai_compat(
    channel: ChatChannel, model: str, messages: List[dict], timeout: float = 30.0
) -> str:
    """调用 OpenAI 兼容格式 /v1/chat/completions"""
    url = _resolve_chat_url(channel)
    headers = {
        "Authorization": f"Bearer {channel.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def _call_openai_compat_json(
    channel: ChatChannel, model: str, messages: List[dict], timeout: float = 30.0
) -> str:
    """调用 OpenAI 兼容格式，强制 JSON 输出"""
    url = _resolve_chat_url(channel)
    headers = {
        "Authorization": f"Bearer {channel.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def _call_openai_compat_multimodal_image(
    channel: ChatChannel,
    model: str,
    prompt: str,
    image_bytes: bytes,
    timeout: float = 90.0,
    max_tokens: int = 4000,
) -> str:
    """调用 OpenAI 兼容多模态 chat/completions，返回纯文本内容。"""
    url = _resolve_chat_url(channel)
    headers = {
        "Authorization": f"Bearer {channel.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode()}"
                        },
                    },
                ],
            }
        ],
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def _call_openai_compat_multimodal_prompt(
    channel: ChatChannel,
    model: str,
    prompt: str,
    image_urls: List[str],
    *,
    timeout: float = 90.0,
    max_tokens: int = 4000,
    json_mode: bool = False,
) -> str:
    """调用 OpenAI 兼容多模态 chat/completions，支持多张 data URL 图片。"""
    url = _resolve_chat_url(channel)
    headers = {
        "Authorization": f"Bearer {channel.api_key}",
        "Content-Type": "application/json",
    }
    content = [{"type": "text", "text": prompt}]
    for image_url in image_urls:
        content.append({
            "type": "image_url",
            "image_url": {"url": image_url},
        })

    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "temperature": 0.7,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def chat_flash(messages: List[dict], json_mode: bool = False) -> str:
    """Flash 多渠道容灾调用"""
    if not FLASH_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_failure_kind = "unknown"
    for ch in FLASH_CHAT_CHANNELS:
        try:
            caller = _call_openai_compat_json if json_mode else _call_openai_compat
            result = await caller(ch, ch.model, messages)
            print("[Flash] Chat 调用成功")
            return result
        except Exception as error:
            safe_to_retry, last_failure_kind = _chat_failure_disposition(error)
            print(
                "⚠️  [Flash] Chat 调用失败: "
                f"{_provider_failure_log_label(error, last_failure_kind)}"
            )
            if not safe_to_retry:
                raise ChatProviderError(
                    safe_to_retry=False,
                    failure_kind=last_failure_kind,
                ) from None

    raise ChatProviderError(safe_to_retry=True, failure_kind=last_failure_kind)


async def chat_pro(messages: List[dict]) -> str:
    """Pro 多渠道容灾调用"""
    if not PRO_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_failure_kind = "unknown"
    for ch in PRO_CHAT_CHANNELS:
        try:
            result = await _call_openai_compat(ch, ch.model, messages, timeout=60.0)
            print("[Pro] Chat 调用成功")
            return result
        except Exception as error:
            safe_to_retry, last_failure_kind = _chat_failure_disposition(error)
            print(
                "⚠️  [Pro] Chat 调用失败: "
                f"{_provider_failure_log_label(error, last_failure_kind)}"
            )
            if not safe_to_retry:
                raise ChatProviderError(
                    safe_to_retry=False,
                    failure_kind=last_failure_kind,
                ) from None

    raise ChatProviderError(safe_to_retry=True, failure_kind=last_failure_kind)


async def chat_pro_multimodal_json(
    prompt: str,
    image_bytes: bytes,
    *,
    timeout: float = 90.0,
    max_tokens: int = 4000,
) -> str:
    """兼容旧接口名，复用单图多模态 Pro 调用。"""
    return await chat_pro_multimodal_image(
        prompt,
        image_bytes,
        timeout=timeout,
        max_tokens=max_tokens,
    )


async def chat_pro_multimodal_image(
    prompt: str,
    image_bytes: bytes,
    *,
    timeout: float = 90.0,
    max_tokens: int = 4000,
) -> str:
    """Pro 多渠道容灾调用，支持带单张图片的多模态对话。"""
    if not PRO_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_failure_kind = "unknown"
    for ch in PRO_CHAT_CHANNELS:
        try:
            result = await _call_openai_compat_multimodal_image(
                ch,
                ch.model,
                prompt,
                image_bytes,
                timeout=timeout,
                max_tokens=max_tokens,
            )
            print("[Pro Vision] Chat 调用成功")
            return result
        except Exception as error:
            safe_to_retry, last_failure_kind = _chat_failure_disposition(error)
            print(
                "⚠️  [Pro Vision] Chat 调用失败: "
                f"{_provider_failure_log_label(error, last_failure_kind)}"
            )
            if not safe_to_retry:
                raise ChatProviderError(
                    safe_to_retry=False,
                    failure_kind=last_failure_kind,
                ) from None

    raise ChatProviderError(safe_to_retry=True, failure_kind=last_failure_kind)


async def chat_pro_multimodal(
    prompt: str,
    image_urls: List[str],
    *,
    timeout: float = 90.0,
    max_tokens: int = 4000,
    json_mode: bool = False,
) -> str:
    """Pro 多渠道容灾调用，支持多张 data URL 图片的多模态对话。"""
    if not PRO_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_failure_kind = "unknown"
    for ch in PRO_CHAT_CHANNELS:
        try:
            result = await _call_openai_compat_multimodal_prompt(
                ch,
                ch.model,
                prompt,
                image_urls,
                timeout=timeout,
                max_tokens=max_tokens,
                json_mode=json_mode,
            )
            print("[Pro Vision Prompt] Chat 调用成功")
            return result
        except Exception as error:
            safe_to_retry, last_failure_kind = _chat_failure_disposition(error)
            print(
                "⚠️  [Pro Vision Prompt] Chat 调用失败: "
                f"{_provider_failure_log_label(error, last_failure_kind)}"
            )
            if not safe_to_retry:
                raise ChatProviderError(
                    safe_to_retry=False,
                    failure_kind=last_failure_kind,
                ) from None

    raise ChatProviderError(safe_to_retry=True, failure_kind=last_failure_kind)
