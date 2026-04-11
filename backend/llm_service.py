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
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception


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
    for ch in FLASH_CHAT_CHANNELS:
        print(f"  - [Flash] {ch.name}: {ch.base_url}")

    print(f"✅ 已加载 {len(PRO_CHAT_CHANNELS)} 个Pro Chat渠道")
    for ch in PRO_CHAT_CHANNELS:
        print(f"  - [Pro] {ch.name}: {ch.base_url}")


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


def select_workspace_chat_model(agent_mode: bool) -> str:
    """工作区聊天按 Agent 开关选择模型；审图仍走单独 Pro 接口。"""
    return "pro" if agent_mode else "flash"


def is_retryable_http_error(exception):
    """只重试网络层错误和特定 HTTP 状态码"""
    if isinstance(exception, (httpx.ReadTimeout, httpx.ConnectError, httpx.NetworkError)):
        return True
    if isinstance(exception, httpx.HTTPStatusError):
        return exception.response.status_code in (502, 503, 504)
    return False


def _resolve_chat_url(channel: ChatChannel) -> str:
    """智能拼接 chat completions URL"""
    base = channel.base_url.rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    if base.endswith('/v1') or base.endswith('/openai'):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=3),
    retry=retry_if_exception(is_retryable_http_error)
)
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


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=3),
    retry=retry_if_exception(is_retryable_http_error)
)
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


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=3),
    retry=retry_if_exception(is_retryable_http_error)
)
async def _call_openai_compat_multimodal_json(
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


async def chat_flash(messages: List[dict], json_mode: bool = False) -> str:
    """Flash 多渠道容灾调用"""
    if not FLASH_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_error = None
    for ch in FLASH_CHAT_CHANNELS:
        try:
            print(f"[Flash] 尝试渠道: {ch.name}")
            caller = _call_openai_compat_json if json_mode else _call_openai_compat
            result = await caller(ch, ch.model, messages)
            print(f"[Flash] 渠道 {ch.name} 成功")
            return result
        except Exception as e:
            print(f"⚠️  [Flash] 渠道 {ch.name} 失败: {e}")
            last_error = e
            continue

    raise RuntimeError(f"所有 Chat 渠道均失败: {last_error}")


async def chat_pro(messages: List[dict]) -> str:
    """Pro 多渠道容灾调用"""
    if not PRO_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_error = None
    for ch in PRO_CHAT_CHANNELS:
        try:
            print(f"[Pro] 尝试渠道: {ch.name}")
            result = await _call_openai_compat(ch, ch.model, messages, timeout=60.0)
            print(f"[Pro] 渠道 {ch.name} 成功")
            return result
        except Exception as e:
            print(f"⚠️  [Pro] 渠道 {ch.name} 失败: {e}")
            last_error = e
            continue

    raise RuntimeError(f"所有 Chat 渠道均失败: {last_error}")


async def chat_pro_multimodal_json(
    prompt: str,
    image_bytes: bytes,
    *,
    timeout: float = 90.0,
    max_tokens: int = 4000,
) -> str:
    """Pro 多渠道容灾调用，支持带图片的审图请求。"""
    if not PRO_CHAT_CHANNELS:
        raise RuntimeError("未配置任何 Chat 渠道")

    last_error = None
    for ch in PRO_CHAT_CHANNELS:
        try:
            print(f"[Pro Vision] 尝试渠道: {ch.name}")
            result = await _call_openai_compat_multimodal_json(
                ch,
                ch.model,
                prompt,
                image_bytes,
                timeout=timeout,
                max_tokens=max_tokens,
            )
            print(f"[Pro Vision] 渠道 {ch.name} 成功")
            return result
        except Exception as e:
            print(f"⚠️  [Pro Vision] 渠道 {ch.name} 失败: {e}")
            last_error = e
            continue

    raise RuntimeError(f"所有 Chat 渠道均失败: {last_error}")
