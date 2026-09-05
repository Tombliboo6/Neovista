from fastapi import FastAPI, HTTPException, Header, Depends, File, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal, Optional, List, Tuple, Union
from sqlalchemy import func, inspect as sqlalchemy_inspect, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from functools import lru_cache
import httpx
import os
import json
import math
import mimetypes
import re
import uuid
import base64
import io
import asyncio
import binascii
import hashlib
import ipaddress
import socket
from contextlib import suppress
from datetime import datetime, timedelta
from dotenv import load_dotenv
from PIL import Image, ImageOps
from urllib.parse import quote, urljoin, urlparse

load_dotenv()
PROCESS_STARTED_AT = datetime.utcnow()

from billing_service import (
    capture_generation_hold,
    create_generation_hold,
    create_video_generation_hold,
    refund_generation_hold,
)
from billing_router import router as billing_router
from dashboard_router import router as dashboard_router
from database import engine, Base, SessionLocal, get_db
from auth import router as auth_router, get_current_user
from admin_auth import verify_admin_access
from monitoring_service import (
    record_frontend_error_event,
    safe_record_generation_event,
    safe_record_generation_event_isolated,
    safe_update_generation_event_status,
)
from models import (
    AdminAuditLog,
    ChatSession,
    CreditTransaction,
    GenerationEvent,
    ImageGenerationTask,
    User,
    VideoGenerationTask,
)
import llm_service
from llm_service import (
    init_chat_channels,
    chat_flash,
    chat_pro,
    chat_pro_multimodal,
    chat_pro_multimodal_image,
    chat_pro_multimodal_json,
    select_workspace_chat_model,
)
from rate_limit_service import (
    check_and_increment_ip_limit,
    check_and_increment_user_limit,
    extract_client_ip,
)
from template_api_utils import serialize_template_summary
from template_prompt_utils import (
    build_effective_diagram_prompt as _build_effective_diagram_prompt,
    build_effective_template_prompt as _build_effective_template_prompt,
)
from runtime_security import (
    is_production_runtime,
    require_distinct_runtime_secrets,
    require_runtime_secret,
)
from pricing import (
    DEFAULT_SEEDANCE_MODEL,
    DEFAULT_SEEDANCE_RESOLUTION,
    MIN_VIDEO_DURATION_SECONDS,
    MAX_VIDEO_DURATION_SECONDS,
    SEEDANCE_RESOLUTION_CREDITS_PER_SECOND,
    calculate_video_generation_cost,
    get_video_duration_limits,
    get_video_resolution_pricing,
    get_resolution_pricing,
    normalize_video_model,
    normalize_video_resolution,
)

class APIChannel(BaseModel):
    name: str
    base_url: str
    api_key: str
    model: str
    product_model: Optional[str] = None

    class Config:
        frozen = True

# Production schema changes are migration-only. Development keeps the legacy
# auto-create convenience unless explicitly disabled.
schema_auto_create_default = "false" if is_production_runtime() else "true"
if os.getenv("DATABASE_SCHEMA_AUTO_CREATE_ENABLED", schema_auto_create_default).strip().lower() in {
    "1", "true", "yes"
}:
    Base.metadata.create_all(bind=engine)

app = FastAPI()

# 管理员密钥
ADMIN_SECRET_KEY = require_runtime_secret("ADMIN_SECRET_KEY", os.getenv("ADMIN_SECRET_KEY"))
require_distinct_runtime_secrets(
    "ADMIN_SECRET_KEY",
    ADMIN_SECRET_KEY,
    "JWT_SECRET_KEY",
    os.getenv("JWT_SECRET_KEY", ""),
)

# 静态文件服务
SEEDANCE_REFERENCE_VIDEO_MAX_BYTES = int(
    os.getenv("SEEDANCE_REFERENCE_VIDEO_MAX_BYTES", str(24 * 1024 * 1024))
)
SEEDANCE_REFERENCE_VIDEO_MIME_TYPES = {
    ".mp4": {"video/mp4", "application/mp4"},
    ".webm": {"video/webm"},
    ".mov": {"video/quicktime"},
}
app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS 配置（从环境变量读取）
cors_origins_str = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
print(f"✅ CORS 允许的源: {cors_origins}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载鉴权路由
app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(billing_router, prefix="/api/v1/billing", tags=["billing"])
app.include_router(dashboard_router)

# 多渠道配置
@lru_cache(maxsize=1)
def get_api_channels() -> Tuple[APIChannel, ...]:
    channels = []
    i = 1
    while True:
        name = os.getenv(f"API_CHANNEL_{i}_NAME")
        if not name:
            break
        channels.append(APIChannel(
            name=name,
            base_url=os.getenv(f"API_CHANNEL_{i}_BASE_URL"),
            api_key=os.getenv(f"API_CHANNEL_{i}_API_KEY"),
            model=os.getenv(f"API_CHANNEL_{i}_MODEL", "gemini-3.1-flash-image-preview"),
            product_model=(os.getenv(f"API_CHANNEL_{i}_PRODUCT_MODEL") or "").strip().lower() or None,
        ))
        i += 1
    return tuple(channels)

API_CHANNELS = get_api_channels()
print(f"✅ 已加载 {len(API_CHANNELS)} 个API渠道")

# DeepSeek配置（保留作为降级，但主路径走 Flash）
DEEPSEEK_CONFIG = {
    "api_key": os.getenv("DEEPSEEK_API_KEY"),
    "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
}

# 初始化 Chat 渠道（Flash / Pro）
init_chat_channels()
FREE_CHAT_DAILY_LIMIT = int(os.getenv("FREE_CHAT_DAILY_LIMIT", "30"))
FREE_AGENT_CHAT_DAILY_LIMIT = int(os.getenv("FREE_AGENT_CHAT_DAILY_LIMIT", "5"))
AUDIT_DIAGRAM_USER_HOURLY_LIMIT = int(os.getenv("AUDIT_DIAGRAM_USER_HOURLY_LIMIT", "6"))
AUDIT_DIAGRAM_IP_HOURLY_LIMIT = int(os.getenv("AUDIT_DIAGRAM_IP_HOURLY_LIMIT", "12"))
FRONTEND_ERROR_IP_HOURLY_LIMIT = int(os.getenv("FRONTEND_ERROR_IP_HOURLY_LIMIT", "60"))
FRONTEND_ERROR_USER_HOURLY_LIMIT = int(os.getenv("FRONTEND_ERROR_USER_HOURLY_LIMIT", "30"))


def _get_owned_chat_session(
    db: Session,
    *,
    session_id: str,
    current_user: User,
    create: bool,
) -> ChatSession:
    normalized_session_id = (session_id or "").strip()
    if not normalized_session_id:
        raise HTTPException(status_code=400, detail="会话 ID 不能为空")
    if len(normalized_session_id) > 64 or not re.fullmatch(r"[A-Za-z0-9._:-]+", normalized_session_id):
        raise HTTPException(status_code=400, detail="会话 ID 无效")
    session = db.query(ChatSession).filter(
        ChatSession.session_id == normalized_session_id,
    ).first()
    if session is not None:
        if session.user_id != current_user.id:
            # Legacy ownerless sessions are deliberately not claimable: doing
            # so would let whoever first presents an old id take its contents.
            raise HTTPException(status_code=404, detail="会话不存在或不属于当前用户")
        return session
    if not create:
        raise HTTPException(status_code=404, detail="会话不存在或不属于当前用户")
    session = ChatSession(
        session_id=normalized_session_id,
        user_id=current_user.id,
    )
    db.add(session)
    return session

class GenerateRequest(BaseModel):
    template_id: Optional[str] = None
    user_params: Optional[str] = Field(default=None, max_length=12000)
    image_data: Optional[str] = None
    image_datas: Optional[List[str]] = Field(default=None, max_length=9)
    custom_prompt_structure: Optional[dict] = None
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    resolution: str = "2K"
    aspect_ratio: str = "auto"
    num_images: int = Field(default=1, ge=1, le=1)
    selected_model: str = "nano-banana-2"

class GenerateResponse(BaseModel):
    image_url: str
    timestamp: int
    charged_credits: int
    remaining_credits: int
    request_id: str


class ImageTaskResponse(BaseModel):
    task_id: str
    request_id: str
    status: str
    image_url: Optional[str] = None
    charged_credits: int
    remaining_credits: int
    timestamp: int
    settlement_status: str = "PENDING"
    error_message: Optional[str] = None

class Template(BaseModel):
    id: str
    title: str
    category: str
    images: List[str]
    display_text: str
    likes: int = 0
    uses: int = 0

class AgentChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = Field(
        default=None,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )

class AgentChatResponse(BaseModel):
    session_id: str
    reply_text: str
    recommended_templates: List[Template]
    is_image_required: bool
    image_upload_prompt: Optional[str] = None
    collected_params: Optional[dict] = None

class WorkspaceChatMessage(BaseModel):
    role: str = Field(..., pattern=r"^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class WorkspaceChatRequest(BaseModel):
    messages: List[WorkspaceChatMessage] = Field(..., min_length=1, max_length=10)
    image_data: Optional[str] = Field(default=None, max_length=16 * 1024 * 1024)
    image_datas: Optional[List[str]] = Field(default=None, max_length=9)
    agent_mode: bool = False
    session_id: Optional[str] = Field(
        default=None,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )

class WorkspaceChatResponse(BaseModel):
    reply: str
    model_used: str
    ready_to_generate: bool = False
    suggested_template_id: Optional[str] = None
    suggested_params: Optional[dict] = None

    class Config:
        protected_namespaces = ()

class GenerateDiagramRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=64)
    base_image: Optional[str] = None
    base_images: Optional[List[str]] = Field(default=None, max_length=9)
    num_images: int = Field(default=1, ge=1, le=1)
    template_id: Optional[str] = None
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    resolution: str = "2K"
    aspect_ratio: str = "auto"
    selected_model: str = "nano-banana-2"

class GenerateDiagramResponse(BaseModel):
    image_url: str
    timestamp: int
    charged_credits: int
    remaining_credits: int
    request_id: str


class TemplatePromptPreviewRequest(BaseModel):
    user_params: Optional[str] = Field(default=None, max_length=12000)
    parameters: Optional[dict] = None
    custom_prompt_structure: Optional[dict] = None
    generation_mode: Literal["generate", "generate_diagram"] = "generate"


class TemplatePromptPreviewResponse(BaseModel):
    template_id: str
    template_name: str
    effective_prompt: str
    prompt_structure: Optional[dict] = None


class AdminImageSettlementRequest(BaseModel):
    action: str = Field(..., pattern=r"^(capture|refund)$")
    reason: str = Field(..., min_length=3, max_length=500)

class VideoGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    image_data: Optional[str] = None
    image_datas: Optional[List[str]] = None
    request_id: Optional[str] = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    aspect_ratio: Optional[str] = "16:9"
    resolution: Optional[str] = "720p"
    duration_seconds: Optional[int] = 5
    video_mode: Optional[str] = "auto"
    reference_video_url: Optional[str] = None
    generate_audio: bool = True
    selected_model: Optional[str] = "seedance-2.0"

class ReferenceVideoUploadResponse(BaseModel):
    video_url: str
    filename: str
    size_bytes: int

class VideoTaskResponse(BaseModel):
    task_id: str
    request_id: str
    status: str
    video_url: Optional[str] = None
    charged_credits: int
    remaining_credits: int
    timestamp: int
    settlement_status: str = "PENDING"
    error_message: Optional[str] = None
    retry_after_ms: Optional[int] = None


class VideoModelCapability(BaseModel):
    id: str
    label: str
    min_duration_seconds: int
    max_duration_seconds: int
    default_resolution: str
    resolution_credits_per_second: dict
    aspect_ratios: List[str]
    max_reference_images: int
    supports_reference_video: bool
    max_reference_video_bytes: int
    max_reference_video_duration_seconds: int


class VideoCapabilitiesResponse(BaseModel):
    enabled: bool
    disabled_reason: Optional[str] = None
    model: str
    min_duration_seconds: int
    max_duration_seconds: int
    default_resolution: str
    resolution_credits_per_second: dict
    aspect_ratios: List[str]
    max_reference_images: int
    supports_reference_video: bool
    max_reference_video_bytes: int
    max_reference_video_duration_seconds: int
    models: List[VideoModelCapability]

class FrontendErrorPayload(BaseModel):
    route: str = Field(..., min_length=1, max_length=256)
    message: str = Field(..., min_length=1, max_length=2000)
    stack: Optional[str] = Field(default=None, max_length=8000)
    user_agent: Optional[str] = Field(default=None, max_length=512)

class AuditDiagramRequest(BaseModel):
    session_id: Optional[str] = Field(
        default=None,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )
    template_id: Optional[str] = Field(default=None, max_length=64)
    image_base64: str = Field(..., min_length=1, max_length=12 * 1024 * 1024)

@app.post("/api/v1/frontend-errors")
async def create_frontend_error(
    payload: FrontendErrorPayload,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        check_and_increment_user_limit(
            db,
            current_user.id,
            "frontend_error",
            FRONTEND_ERROR_USER_HOURLY_LIMIT,
            period="hour",
        )
        check_and_increment_ip_limit(
            db,
            extract_client_ip(http_request),
            "frontend_error",
            FRONTEND_ERROR_IP_HOURLY_LIMIT,
            period="hour",
        )
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error))
    record_frontend_error_event(
        db,
        user_id=current_user.id,
        route=payload.route,
        message=payload.message,
        stack=payload.stack,
        user_agent=payload.user_agent,
    )
    return {"ok": True}

def _normalize_reference_images(
    image_data: Optional[str] = None,
    image_datas: Optional[List[str]] = None,
) -> List[str]:
    if image_datas:
        return [image for image in image_datas if isinstance(image, str) and image.strip()]
    if image_data and isinstance(image_data, str) and image_data.strip():
        return [image_data]
    return []


def _validate_chat_reference_images(reference_images: List[str]) -> List[str]:
    if len(reference_images) > 9:
        raise HTTPException(status_code=400, detail="对话参考图不能超过 9 张")
    if sum(len(item) for item in reference_images) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="对话参考图总大小过大")
    return [compress_image_for_vision(item) for item in reference_images]


def _trim_text_context_messages(
    messages: Optional[List["WorkspaceChatMessage"]] = None,
    *,
    max_messages: int = 10,
    max_total_chars: int = 4000,
) -> List["WorkspaceChatMessage"]:
    normalized_messages: List[WorkspaceChatMessage] = []
    for message in messages or []:
        if not isinstance(message, WorkspaceChatMessage):
            continue
        if message.role not in ("user", "assistant"):
            continue
        if not isinstance(message.content, str) or not message.content.strip():
            continue
        normalized_messages.append(
            WorkspaceChatMessage(role=message.role, content=message.content.strip())
        )

    trimmed_messages = normalized_messages[-max_messages:] if max_messages > 0 else normalized_messages
    total_chars = sum(len(message.content) for message in trimmed_messages)
    while len(trimmed_messages) > 1 and total_chars > max_total_chars:
        trimmed_messages = trimmed_messages[1:]
        total_chars = sum(len(message.content) for message in trimmed_messages)

    if trimmed_messages and trimmed_messages[0].role != "user":
        first_user_index = next(
            (index for index, message in enumerate(trimmed_messages) if message.role == "user"),
            -1,
        )
        if first_user_index > 0:
            trimmed_messages = trimmed_messages[first_user_index:]
        elif first_user_index == -1:
            return []

    return trimmed_messages


def _build_chat_user_message_with_images(text: str, image_datas: Optional[List[str]] = None) -> dict:
    normalized_images = _normalize_reference_images(image_datas=image_datas)
    if not normalized_images:
        return {"role": "user", "content": text}

    content = [{"type": "text", "text": text}]
    for image in normalized_images:
        content.append({
            "type": "image_url",
            "image_url": {"url": image},
        })
    return {"role": "user", "content": content}


def _decode_reference_image(image_data: str) -> Image.Image:
    raw_data = image_data.split(",", 1)[1] if image_data.startswith("data:") else image_data
    decoded = base64.b64decode(raw_data)
    image = Image.open(io.BytesIO(decoded))
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def _compose_reference_image_bytes(image_datas: Optional[List[str]] = None) -> bytes:
    normalized_images = _normalize_reference_images(image_datas=image_datas)
    if not normalized_images:
        return b""

    tile_images: List[Image.Image] = []
    max_tile_size = 1024
    for image_data in normalized_images:
        image = _decode_reference_image(image_data)
        image.thumbnail((max_tile_size, max_tile_size), Image.Resampling.LANCZOS)
        tile_images.append(image)

    columns = max(1, math.ceil(math.sqrt(len(tile_images))))
    rows = max(1, math.ceil(len(tile_images) / columns))
    cell_width = max(image.width for image in tile_images)
    cell_height = max(image.height for image in tile_images)
    gap = 24 if len(tile_images) > 1 else 0

    canvas_width = columns * cell_width + gap * (columns - 1)
    canvas_height = rows * cell_height + gap * (rows - 1)
    canvas = Image.new("RGB", (canvas_width, canvas_height), "white")

    for index, image in enumerate(tile_images):
        column = index % columns
        row = index // columns
        x = column * (cell_width + gap) + (cell_width - image.width) // 2
        y = row * (cell_height + gap) + (cell_height - image.height) // 2
        canvas.paste(image, (x, y))

    buffer = io.BytesIO()
    canvas.save(buffer, format="JPEG", quality=88, optimize=True)
    return buffer.getvalue()


def _image_data_to_inline_part(image_data: str) -> dict:
    mime_type = "image/png"
    base64_data = image_data
    if image_data.startswith("data:"):
        header, base64_data = image_data.split(",", 1)
        mime_type = header.split(":", 1)[1].split(";", 1)[0] or mime_type
    return {
        "inlineData": {
            "mimeType": mime_type,
            "data": base64_data,
        }
    }


def _append_reference_image_parts(parts: List[dict], image_datas: Optional[List[str]] = None) -> List[dict]:
    normalized_images = _normalize_reference_images(image_datas=image_datas)
    if not normalized_images:
        return parts
    composed_image_bytes = _compose_reference_image_bytes(normalized_images)
    return [{
        "inlineData": {
            "mimeType": "image/jpeg",
            "data": base64.b64encode(composed_image_bytes).decode("utf-8"),
        }
    }] + parts


def _append_validated_reference_image_parts(
    parts: List[dict],
    image_datas: Optional[List[str]] = None,
) -> List[dict]:
    try:
        return _append_reference_image_parts(parts, image_datas)
    except (binascii.Error, OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="生图参考图无法解析") from error


def _resolve_generate_diagram_reference_images(
    request_base_image: Optional[str] = None,
    request_base_images: Optional[List[str]] = None,
    session_history: Optional[List[dict]] = None,
) -> List[str]:
    request_images = _normalize_reference_images(
        image_data=request_base_image,
        image_datas=request_base_images,
    )
    if request_images:
        return request_images

    for message in reversed(session_history or []):
        history_images = _normalize_reference_images(
            image_data=message.get("image_data"),
            image_datas=message.get("image_datas"),
        )
        if history_images:
            return history_images

    return []


def _build_multimodal_prompt_from_messages(messages: List[dict]) -> str:
    role_labels = {
        "system": "系统",
        "user": "用户",
        "assistant": "助手",
    }
    lines = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, list):
            text_parts = [
                part.get("text", "").strip()
                for part in content
                if isinstance(part, dict) and part.get("type") == "text" and part.get("text", "").strip()
            ]
            content = "\n".join(text_parts).strip()
        if not isinstance(content, str) or not content.strip():
            continue
        role = role_labels.get(message.get("role"), message.get("role", "消息"))
        lines.append(f"{role}: {content}")
    return "\n\n".join(lines)


def _should_enable_prompt_consultant_mode(message: Optional[str]) -> bool:
    if not isinstance(message, str) or not message.strip():
        return False

    lowered = message.lower()
    explicit_prompt_keywords = (
        "提示词",
        "prompt",
        "反推",
        "negative prompt",
        "正向提示",
        "反向提示",
        "生图词",
        "文生图",
    )
    if any(keyword in lowered for keyword in explicit_prompt_keywords):
        return True

    preset_keywords = (
        "角色预设",
        "角色设定",
        "人物设定",
        "场景预设",
        "场景设定",
        "character preset",
        "character setup",
        "scene preset",
        "scene setup",
    )
    action_keywords = (
        "推导",
        "生成",
        "整理",
        "编写",
        "写一版",
        "写成",
        "转成",
        "改写",
        "generate",
        "write",
    )
    return any(keyword in lowered for keyword in preset_keywords) and any(
        keyword in lowered for keyword in action_keywords
    )


def _build_direct_chat_system_prompt(message: Optional[str]) -> str:
    base_prompt = """你是 NeoVista 的设计对话助手。你可以：
- 回答设计相关的问题（建筑、景观、规划、室内、产品等）
- 进行日常对话和闲聊
- 提供创意灵感和建议
- 分析用户上传的参考图片
- 根据用户提供的场景设定、角色预设、参考图和目标风格，生成适合图像模型使用的最终 prompt

边界要求：
- 你可以帮助用户分析图片并生成生图提示词
- 你可以把复杂设定整理成适合 Google Imagen 3 Pro 使用的最终 prompt
- 不要推荐模板
- 不要进入 Agent 工作流
- 不要返回 ready_to_generate、suggested_template_id、suggested_params 等控制字段
- 保持回答自然、直接、可执行

语言要求：
- 如果用户本轮消息主要是中文，必须用中文回答
- 如果用户本轮消息主要是英文或其他非中文语言，可以按用户语言回答，但必须附带中文翻译，格式为“中文翻译：...”"""

    if not _should_enable_prompt_consultant_mode(message):
        return base_prompt

    return f"""{base_prompt}

当前用户很可能希望你充当“提示词顾问”。
如果用户在请求提示词、参考图反推、角色/场景推导，请优先输出最适合 Google Imagen 3 Pro 的格式。
默认输出结构：
1. 一句简短中文说明
2. 最终 prompt

写作要求：
- 最终 prompt 必须是一整段可直接复制使用的英文自然语言描述
- 优先使用适合 Imagen 3 Pro 的描述式结构，而不是标签堆砌
- 默认不输出反向提示词、negative prompt、JSON、分栏清单
- 只有当用户明确要求多个版本时，才额外提供 Version A / Version B
- 最终 prompt 应尽量自然地覆盖主体、场景、构图、光照、材质、风格和必要约束
除非用户明确要求，否则不要输出 JSON。"""


def _parse_json_object_response(text: str) -> dict:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*\n", "", cleaned)
        cleaned = re.sub(r"\n```\s*$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not json_match:
            raise
        return json.loads(json_match.group())


def _message_prefers_chinese(message: Optional[str]) -> bool:
    if not isinstance(message, str):
        return False
    return bool(re.search(r"[\u4e00-\u9fff]", message))


def _reply_has_chinese(text: Optional[str]) -> bool:
    if not isinstance(text, str):
        return False
    return bool(re.search(r"[\u4e00-\u9fff]", text))


async def _enforce_reply_language(user_message: Optional[str], reply_text: str) -> str:
    """保证最终回复符合中文策略。"""
    cleaned = (reply_text or "").strip()
    if not cleaned:
        return cleaned

    if _message_prefers_chinese(user_message):
        if _reply_has_chinese(cleaned):
            return cleaned
        try:
            rewritten = await chat_flash([
                {
                    "role": "system",
                    "content": "请把给定答复改写成自然、准确、简洁的中文。只返回中文，不要解释。",
                },
                {
                    "role": "user",
                    "content": f"用户原始消息：{user_message or ''}\n\n当前答复：{cleaned}",
                },
            ], json_mode=False)
        except (llm_service.ChatProviderError, RuntimeError):
            print("⚠️  对话语言改写未完成，返回已生成的原始答复")
            return cleaned
        return (rewritten or "").strip() or cleaned

    if "中文翻译：" in cleaned and _reply_has_chinese(cleaned):
        return cleaned

    if _reply_has_chinese(cleaned) and not re.search(r"[A-Za-z]", cleaned):
        return cleaned

    try:
        rewritten = await chat_flash([
            {
                "role": "system",
                "content": (
                    "保留答复的原始语言内容，并在末尾补上一段中文翻译。"
                    "输出格式必须是原文后空一行，再写“中文翻译：<翻译内容>”。"
                ),
            },
            {
                "role": "user",
                "content": f"用户原始消息：{user_message or ''}\n\n当前答复：{cleaned}",
            },
        ], json_mode=False)
    except (llm_service.ChatProviderError, RuntimeError):
        print("⚠️  对话语言改写未完成，返回已生成的原始答复")
        return cleaned
    return (rewritten or "").strip() or cleaned


async def _chat_with_reference_images(
    prompt: str,
    reference_images: Optional[List[str]] = None,
    *,
    json_mode: bool = False,
) -> str:
    normalized_images = _normalize_reference_images(image_datas=reference_images)
    if not normalized_images:
        raise ValueError("reference_images 不能为空")

    try:
        return await chat_pro_multimodal(
            prompt,
            normalized_images,
            json_mode=json_mode,
        )
    except llm_service.ChatProviderError as multimodal_error:
        if not multimodal_error.safe_to_retry:
            raise
        composed_image = _compose_reference_image_bytes(normalized_images)
        if not composed_image:
            raise

        print("⚠️  多图请求未被接收，安全回退为单张拼图")
        return await chat_pro_multimodal_image(
            prompt,
            composed_image,
        )


# Agent 3 / generated-asset helpers
def _validated_image_bytes_to_data_uri(
    raw_bytes: bytes,
    *,
    max_bytes: int,
    max_pixels: int,
    label: str,
) -> str:
    if not raw_bytes or len(raw_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"{label}过大")
    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            detected_format = (probe.format or "").upper()
            if detected_format not in {"PNG", "JPEG", "WEBP"}:
                raise HTTPException(status_code=400, detail=f"{label}文件格式无效")
            if probe.width <= 0 or probe.height <= 0 or probe.width * probe.height > max_pixels:
                raise HTTPException(status_code=413, detail=f"{label}像素尺寸过大")
            probe.verify()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail=f"{label}不是有效的图片文件")

    detected_mime = {
        "PNG": "image/png",
        "JPEG": "image/jpeg",
        "WEBP": "image/webp",
    }[detected_format]
    return f"data:{detected_mime};base64,{base64.b64encode(raw_bytes).decode()}"


def _normalize_generated_image_payload(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=502, detail="供应商未返回有效图片")
    normalized = value.strip()
    if normalized.startswith("https://"):
        return normalized
    if normalized.startswith("http://"):
        raise HTTPException(status_code=502, detail="供应商返回了不安全的图片 URL")

    encoded = normalized
    if normalized.startswith("data:"):
        if "," not in normalized or ";base64" not in normalized.split(",", 1)[0].lower():
            raise HTTPException(status_code=502, detail="供应商图片 data URL 无效")
        encoded = normalized.split(",", 1)[1]
    max_result_bytes = IMAGE_GENERATION_MAX_RESULT_BYTES
    max_raw_bytes = max(1, (max_result_bytes * 3) // 4 - 1024)
    if len(encoded) > ((max_raw_bytes + 2) // 3) * 4 + 8:
        raise HTTPException(status_code=413, detail="供应商图片超过持久化上限")
    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=502, detail="供应商图片 Base64 数据无效")
    return _validated_image_bytes_to_data_uri(
        raw_bytes,
        max_bytes=max_raw_bytes,
        max_pixels=int(os.getenv("IMAGE_GENERATION_MAX_RESULT_PIXELS", "40000000")),
        label="供应商图片",
    )


async def _assert_public_https_url(url: str) -> None:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or (parsed.port is not None and parsed.port != 443)
    ):
        raise HTTPException(status_code=502, detail="供应商图片 URL 不安全")
    try:
        address_rows = await asyncio.to_thread(
            socket.getaddrinfo,
            parsed.hostname,
            443,
            0,
            socket.SOCK_STREAM,
        )
    except OSError:
        raise HTTPException(status_code=502, detail="供应商图片主机无法解析")
    addresses = {row[4][0].split("%", 1)[0] for row in address_rows}
    if not addresses:
        raise HTTPException(status_code=502, detail="供应商图片主机无法解析")
    for address in addresses:
        try:
            if not ipaddress.ip_address(address).is_global:
                raise HTTPException(status_code=502, detail="供应商图片 URL 指向非公网地址")
        except ValueError:
            raise HTTPException(status_code=502, detail="供应商图片主机解析结果无效")


async def _download_remote_generated_image(url: str) -> str:
    max_result_bytes = IMAGE_GENERATION_MAX_RESULT_BYTES
    max_raw_bytes = max(1, (max_result_bytes * 3) // 4 - 1024)
    current_url = url
    timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _redirect in range(4):
            await _assert_public_https_url(current_url)
            async with client.stream(
                "GET",
                current_url,
                headers={"User-Agent": "NeoVista-Generated-Asset/1"},
            ) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=502, detail="供应商图片重定向缺少目标")
                    current_url = urljoin(current_url, location)
                    continue
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError:
                    raise HTTPException(status_code=502, detail="供应商图片下载失败")
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > max_raw_bytes:
                            raise HTTPException(status_code=413, detail="供应商图片超过持久化上限")
                    except ValueError:
                        raise HTTPException(status_code=502, detail="供应商图片长度响应无效")
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > max_raw_bytes:
                        raise HTTPException(status_code=413, detail="供应商图片超过持久化上限")
                return _validated_image_bytes_to_data_uri(
                    bytes(chunks),
                    max_bytes=max_raw_bytes,
                    max_pixels=int(os.getenv("IMAGE_GENERATION_MAX_RESULT_PIXELS", "40000000")),
                    label="供应商图片",
                )
    raise HTTPException(status_code=502, detail="供应商图片重定向次数过多")


def compress_image_for_vision(base64_str: str, max_size_mb: float = 3.5) -> str:
    """Strictly validate an audit image and compress it below the model limit."""
    if not isinstance(base64_str, str) or not base64_str.strip():
        raise HTTPException(status_code=400, detail="审图图片不能为空")

    value = base64_str.strip()
    declared_mime = "image/png"
    encoded = value
    if value.startswith("data:"):
        if "," not in value:
            raise HTTPException(status_code=400, detail="审图图片 data URL 无效")
        header, encoded = value.split(",", 1)
        if ";base64" not in header.lower():
            raise HTTPException(status_code=400, detail="审图图片必须使用 Base64 data URL")
        declared_mime = header.split(":", 1)[1].split(";", 1)[0].strip().lower()
    if declared_mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="审图图片仅支持 PNG、JPEG 或 WebP")

    max_bytes = int(os.getenv("AUDIT_IMAGE_MAX_BYTES", str(8 * 1024 * 1024)))
    if len(encoded) > ((max_bytes + 2) // 3) * 4 + 8:
        raise HTTPException(status_code=413, detail="审图图片过大，请压缩后重试")
    try:
        img_data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="审图图片 Base64 数据无效")
    if not img_data or len(img_data) > max_bytes:
        raise HTTPException(status_code=413, detail="审图图片过大，请压缩后重试")

    max_pixels = int(os.getenv("AUDIT_IMAGE_MAX_PIXELS", "24000000"))
    try:
        with Image.open(io.BytesIO(img_data)) as probe:
            detected_format = (probe.format or "").upper()
            if detected_format not in {"PNG", "JPEG", "WEBP"}:
                raise HTTPException(status_code=400, detail="审图图片文件格式无效")
            if probe.width <= 0 or probe.height <= 0 or probe.width * probe.height > max_pixels:
                raise HTTPException(status_code=413, detail="审图图片像素尺寸过大")
            probe.verify()

        with Image.open(io.BytesIO(img_data)) as source:
            source = ImageOps.exif_transpose(source)
            source.load()
            if len(img_data) <= max_size_mb * 1024 * 1024 and max(source.size) <= 2048:
                detected_mime = {
                    "PNG": "image/png",
                    "JPEG": "image/jpeg",
                    "WEBP": "image/webp",
                }[detected_format]
                return f"data:{detected_mime};base64,{base64.b64encode(img_data).decode()}"

            source.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            if source.mode != "RGB":
                source = source.convert("RGB")
            buffer = io.BytesIO()
            source.save(buffer, format="JPEG", quality=85, optimize=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="审图图片不是有效的图片文件")

    compressed = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/jpeg;base64,{compressed}"

def _is_auto_aspect_ratio(aspect_ratio: Optional[str]) -> bool:
    return not isinstance(aspect_ratio, str) or not aspect_ratio.strip() or aspect_ratio.strip().lower() == "auto"


def get_dimensions_from_resolution_and_ratio(resolution: str, aspect_ratio: str) -> Tuple[int, int]:
    """根据画质和比例计算实际尺寸"""
    # 基准尺寸映射（1K档位）
    base_dimensions = {
        "1:1": (1024, 1024),
        "3:4": (1024, 1365),
        "4:3": (1365, 1024),
        "9:16": (1024, 1820),
        "16:9": (1820, 1024),
        "21:9": (2100, 900)
    }

    # 分辨率倍率
    multipliers = {
        "1K": 1.0,
        "2K": 1.5,
        "4K": 2.0
    }

    base_w, base_h = base_dimensions.get(aspect_ratio, (1024, 1024))
    multiplier = multipliers.get(resolution, 1.5)

    width = int(base_w * multiplier)
    height = int(base_h * multiplier)

    return (width, height)


class UpstreamGenerationError(Exception):
    def __init__(
        self,
        *,
        last_error,
        error_code: str,
        error_message: str,
        outcome_unknown: bool = False,
    ):
        super().__init__(error_message)
        self.last_error = last_error
        self.error_code = error_code
        self.error_message = error_message
        self.outcome_unknown = outcome_unknown


def _extract_generated_image(data: dict) -> Optional[str]:
    candidates = data.get("candidates") or []
    if not candidates:
        return None

    content = candidates[0].get("content") or {}
    for part in content.get("parts") or []:
        inline_data = part.get("inlineData") or {}
        image_data = inline_data.get("data")
        if image_data:
            return image_data
    return None


def _extract_openai_generated_image(data: dict) -> Optional[str]:
    for item in data.get("data") or []:
        image_data = item.get("b64_json")
        if isinstance(image_data, str) and image_data.strip():
            return image_data
        image_url = item.get("url")
        if isinstance(image_url, str) and image_url.strip():
            return image_url
    return None


def _is_openai_image_model(model_name: Optional[str]) -> bool:
    return isinstance(model_name, str) and model_name.strip().lower().startswith("gpt-image")


def _select_api_channels_for_model(selected_model: Optional[str] = None) -> Tuple[APIChannel, ...]:
    normalized = (selected_model or "").strip().lower()
    return tuple(
        channel for channel in API_CHANNELS
        if channel.product_model == normalized and _image_channel_mapping_is_valid(channel)
    )


def _build_prompt_text_from_parts(parts: List[dict]) -> str:
    text_parts = [
        part.get("text", "").strip()
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str) and part.get("text", "").strip()
    ]
    return "\n\n".join(text_parts).strip()


def _resolve_openai_image_size(aspect_ratio: str) -> str:
    if _is_auto_aspect_ratio(aspect_ratio):
        return "auto"
    portrait_ratios = {"2:3", "3:4", "9:16"}
    landscape_ratios = {"3:2", "4:3", "16:9", "21:9"}
    if aspect_ratio in portrait_ratios:
        return "1024x1536"
    if aspect_ratio in landscape_ratios:
        return "1536x1024"
    return "1024x1024"


def _resolve_openai_image_quality(resolution: str) -> str:
    return {
        "1K": "low",
        "2K": "medium",
        "4K": "high",
    }.get(resolution, "medium")


def _decode_reference_image_upload(image_data: str, *, index: int) -> Tuple[str, bytes, str]:
    mime_type = "image/png"
    base64_data = image_data
    if image_data.startswith("data:"):
        header, base64_data = image_data.split(",", 1)
        mime_type = header.split(":", 1)[1].split(";", 1)[0] or mime_type

    extension = mimetypes.guess_extension(mime_type) or ".png"
    if mime_type == "image/jpeg":
        extension = ".jpg"
    filename = f"reference-{index}{extension}"
    return filename, base64.b64decode(base64_data), mime_type


def _build_openai_image_edit_files(reference_images: Optional[List[str]] = None) -> List[Tuple[str, Tuple[str, bytes, str]]]:
    files: List[Tuple[str, Tuple[str, bytes, str]]] = []
    for index, image_data in enumerate(_normalize_reference_images(image_datas=reference_images), start=1):
        filename, raw_bytes, mime_type = _decode_reference_image_upload(image_data, index=index)
        files.append(("image", (filename, raw_bytes, mime_type)))
    return files


IMAGE_GENERATION_RESOLUTIONS = {"1K", "2K", "4K"}
IMAGE_GENERATION_ASPECT_RATIOS = {
    "auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"
}
IMAGE_GENERATION_MODELS = {"nano-banana-2", "nano-banana-pro", "gpt-image-2"}
IMAGE_GENERATION_ACTIVE_STATUSES = {"ready", "submitting", "submit_unknown"}
IMAGE_GENERATION_MAX_PROMPT_CHARS = 16000
IMAGE_GENERATION_MAX_REFERENCE_CHARS = 16 * 1024 * 1024
IMAGE_GENERATION_MAX_REFERENCE_TOTAL_CHARS = 24 * 1024 * 1024
IMAGE_GENERATION_MAX_REFERENCE_BYTES = 8 * 1024 * 1024
IMAGE_GENERATION_MAX_REFERENCE_TOTAL_BYTES = 18 * 1024 * 1024
IMAGE_GENERATION_MAX_RESULT_BYTES = 32 * 1024 * 1024


def _image_generation_feature_enabled() -> bool:
    return os.getenv("IMAGE_GENERATION_FEATURE_ENABLED", "false").strip().lower() in {
        "1", "true", "yes"
    }


def _image_channel_mapping_is_valid(channel: APIChannel) -> bool:
    parsed_base_url = urlparse((channel.base_url or "").strip())
    if (
        not channel.name.strip()
        or not channel.api_key.strip()
        or not channel.model.strip()
        or parsed_base_url.scheme != "https"
        or not parsed_base_url.hostname
        or parsed_base_url.username
        or parsed_base_url.password
        or parsed_base_url.fragment
    ):
        return False
    if channel.product_model == "gpt-image-2":
        return _is_openai_image_model(channel.model)
    if channel.product_model in {"nano-banana-2", "nano-banana-pro"}:
        return not _is_openai_image_model(channel.model)
    return False


def _chat_channel_config_is_valid(channel) -> bool:
    parsed_base_url = urlparse((getattr(channel, "base_url", "") or "").strip())
    return bool(
        (getattr(channel, "name", "") or "").strip()
        and (getattr(channel, "api_key", "") or "").strip()
        and (getattr(channel, "model", "") or "").strip()
        and parsed_base_url.scheme == "https"
        and parsed_base_url.hostname
        and not parsed_base_url.username
        and not parsed_base_url.password
        and not parsed_base_url.fragment
    )


def _chat_config_is_valid() -> bool:
    return bool(
        llm_service.FLASH_CHAT_CHANNELS
        and llm_service.PRO_CHAT_CHANNELS
        and all(_chat_channel_config_is_valid(channel) for channel in llm_service.FLASH_CHAT_CHANNELS)
        and all(_chat_channel_config_is_valid(channel) for channel in llm_service.PRO_CHAT_CHANNELS)
    )


def _configured_image_generation_models() -> set:
    return {
        channel.product_model
        for channel in API_CHANNELS
        if (
            channel.product_model in IMAGE_GENERATION_MODELS
            and _image_channel_mapping_is_valid(channel)
        )
    }


def _normalize_image_generation_inputs(
    *,
    prompt: str,
    resolution: str,
    aspect_ratio: str,
    selected_model: str,
    num_images: int,
    reference_images: List[str],
) -> Tuple[str, str, str]:
    normalized_prompt = (prompt or "").strip()
    if not normalized_prompt:
        raise HTTPException(status_code=400, detail="生图提示词不能为空")
    if len(normalized_prompt) > IMAGE_GENERATION_MAX_PROMPT_CHARS:
        raise HTTPException(status_code=400, detail="生图提示词过长")
    if num_images != 1:
        raise HTTPException(status_code=400, detail="当前每次请求仅支持生成 1 张图片")

    normalized_resolution = (resolution or "").strip().upper()
    if normalized_resolution not in IMAGE_GENERATION_RESOLUTIONS:
        raise HTTPException(status_code=400, detail="不支持的生图分辨率")
    normalized_aspect_ratio = (aspect_ratio or "").strip().lower() or "auto"
    normalized_model = (selected_model or "").strip().lower()
    if normalized_model not in _configured_image_generation_models():
        raise HTTPException(status_code=400, detail="该生图模型当前没有可用的独立供应商渠道")
    supported_aspect_ratios = (
        {"auto", "1:1", "2:3", "3:2"}
        if normalized_model == "gpt-image-2"
        else {"auto", "1:1", "3:4", "4:3", "9:16", "16:9", "21:9"}
    )
    if normalized_aspect_ratio not in supported_aspect_ratios:
        raise HTTPException(status_code=400, detail="当前模型不支持该生图画面比例")
    if len(reference_images) > 9:
        raise HTTPException(status_code=400, detail="生图参考图不能超过 9 张")
    if any(len(item) > IMAGE_GENERATION_MAX_REFERENCE_CHARS for item in reference_images):
        raise HTTPException(status_code=413, detail="单张生图参考图过大")
    if sum(len(item) for item in reference_images) > IMAGE_GENERATION_MAX_REFERENCE_TOTAL_CHARS:
        raise HTTPException(status_code=413, detail="生图参考图总大小过大")
    decoded_total = 0
    for item in reference_images:
        encoded = item.strip()
        declared_mime = None
        if encoded.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="生图参考图必须使用本地上传的数据")
        if encoded.startswith("data:"):
            if "," not in encoded:
                raise HTTPException(status_code=400, detail="生图参考图格式无效")
            header, encoded = encoded.split(",", 1)
            declared_mime = header.split(":", 1)[1].split(";", 1)[0].lower()
            if declared_mime not in {"image/png", "image/jpeg", "image/webp"}:
                raise HTTPException(status_code=400, detail="生图参考图仅支持 PNG、JPEG 或 WebP")
        try:
            raw_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="生图参考图 Base64 数据无效")
        decoded_size = len(raw_bytes)
        if decoded_size > IMAGE_GENERATION_MAX_REFERENCE_BYTES:
            raise HTTPException(status_code=413, detail="单张生图参考图解码后过大")
        canonical_data_uri = _validated_image_bytes_to_data_uri(
            raw_bytes,
            max_bytes=IMAGE_GENERATION_MAX_REFERENCE_BYTES,
            max_pixels=int(os.getenv("IMAGE_GENERATION_MAX_REFERENCE_PIXELS", "24000000")),
            label="生图参考图",
        )
        detected_mime = canonical_data_uri.split(":", 1)[1].split(";", 1)[0]
        if declared_mime is not None and declared_mime != detected_mime:
            raise HTTPException(status_code=400, detail="生图参考图声明格式与实际文件不一致")
        decoded_total += decoded_size
    if decoded_total > IMAGE_GENERATION_MAX_REFERENCE_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="生图参考图解码后总大小过大")
    return normalized_resolution, normalized_aspect_ratio, normalized_model


def _image_generation_request_fingerprint(
    *,
    entrypoint: str,
    prompt: str,
    resolution: str,
    aspect_ratio: str,
    selected_model: str,
    num_images: int,
    reference_images: List[str],
) -> str:
    canonical = json.dumps(
        {
            "entrypoint": entrypoint,
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "selected_model": selected_model,
            "num_images": num_images,
            "reference_sha256": [
                hashlib.sha256(item.strip().encode("utf-8")).hexdigest()
                for item in reference_images
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _sanitized_upstream_error(error_code: str) -> str:
    """Return an operator-usable error without provider bodies, keys, or prompts."""
    if error_code.startswith("UPSTREAM_HTTP_"):
        return f"供应商返回 HTTP {error_code.rsplit('_', 1)[-1]}"
    if error_code == "UPSTREAM_TIMEOUT":
        return "供应商响应超时，提交结果未知"
    if error_code == "UPSTREAM_TRANSPORT_UNKNOWN":
        return "供应商连接中断，提交结果未知"
    if error_code == "UPSTREAM_EMPTY_IMAGE":
        return "供应商响应中缺少图片"
    return "供应商生图失败"


def _get_seedance_base_url() -> str:
    base_url = os.getenv("SEEDANCE_BASE_URL", "https://ai.comfly.chat").strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=500, detail="Seedance API 地址必须是有效的 HTTPS URL")
    return base_url


def _get_seedance_model(selected_model: Optional[str] = None) -> str:
    try:
        normalized = normalize_video_model(selected_model)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    environment_name, default_model = {
        "seedance-2.0": ("SEEDANCE_MODEL", "doubao-seedance-2-0-260128"),
        "seedance-2.5": ("SEEDANCE_25_MODEL", "doubao-seedance-2.5"),
    }[normalized]
    model = os.getenv(environment_name, default_model).strip()
    if not model:
        raise HTTPException(status_code=500, detail=f"Seedance API 未配置：缺少 {environment_name}")
    return model


def _get_seedance_api_key() -> str:
    api_key = os.getenv("SEEDANCE_API_KEY", "").strip()
    placeholder_prefixes = ("your-", "replace-", "changeme", "example-")
    if not api_key or api_key.lower().startswith(placeholder_prefixes):
        raise HTTPException(status_code=500, detail="Seedance API 未配置：缺少 SEEDANCE_API_KEY")
    return api_key


SEEDANCE_ASPECT_RATIOS = ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9")
SEEDANCE_ACTIVE_STATUSES = {
    "ready",
    "creating",
    "submitting",
    "submit_unknown",
    "submitted",
    "running",
    "finalizing",
    # Legacy provider statuses may already exist in production rows. Keep them
    # active until the forward migration canonicalizes them.
    "queued",
    "pending",
    "created",
    "processing",
}
SEEDANCE_LEGACY_ACTIVE_STATUS_MAP = {
    "queued": "submitted",
    "pending": "submitted",
    "created": "submitted",
    "processing": "running",
}
SEEDANCE_FAILURE_STATUSES = {"failed", "error", "cancelled", "canceled"}
SEEDANCE_SUCCESS_STATUSES = {"succeeded", "success", "completed"}
_seedance_reconciler_task = None
_seedance_admin_reconcile_jobs = set()
_seedance_reconciler_last_success_at = None
_seedance_reconciler_last_error_at = None
_seedance_reconciler_last_error_type = None


def _normalize_seedance_aspect_ratio(aspect_ratio: Optional[str]) -> str:
    normalized = (aspect_ratio or "16:9").strip()
    if normalized == "auto":
        return "16:9"
    if normalized not in SEEDANCE_ASPECT_RATIOS:
        raise HTTPException(status_code=400, detail="不支持的视频画面比例")
    return normalized


def _normalize_seedance_selected_model(selected_model: Optional[str]) -> str:
    try:
        return normalize_video_model(selected_model)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


def _seedance_retry_delay_seconds(attempt_count: int) -> int:
    return min(60, max(3, 3 * (2 ** min(max(attempt_count, 0), 4))))


def _seedance_task_deadline() -> datetime:
    return datetime.utcnow() + timedelta(seconds=_seedance_task_deadline_seconds())


def _seedance_task_deadline_seconds() -> int:
    seconds = int(os.getenv("SEEDANCE_TASK_DEADLINE_SECONDS", "7200"))
    return max(300, seconds)


def _ensure_seedance_task_deadline(task: VideoGenerationTask) -> datetime:
    if task.deadline_at is None:
        task.deadline_at = (task.created_at or datetime.utcnow()) + timedelta(
            seconds=_seedance_task_deadline_seconds()
        )
    return task.deadline_at


def _seedance_provider_idempotency_key(*, user_id: int, request_id: str) -> str:
    scoped_value = f"video-generate:{user_id}:{request_id}"
    return hashlib.sha256(scoped_value.encode("utf-8")).hexdigest()


def _seedance_request_fingerprint(
    *,
    prompt: str,
    aspect_ratio: str,
    resolution: str,
    duration_seconds: int,
    selected_model: str,
    video_mode: str,
    reference_images: List[str],
    reference_video_url: Optional[str] = None,
    generate_audio: Optional[bool] = None,
) -> str:
    image_identities = []
    for image in reference_images:
        normalized = image.strip()
        if normalized.startswith(("http://", "https://")):
            image_identities.append({"url": normalized})
        else:
            image_identities.append({
                "sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
            })
    canonical_payload = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "duration_seconds": duration_seconds,
        "selected_model": selected_model,
        "video_mode": video_mode,
        "references": image_identities,
    }
    if reference_video_url:
        canonical_payload["reference_video"] = {"url": reference_video_url.strip()}
    if generate_audio is not None:
        canonical_payload["generate_audio"] = generate_audio
    canonical = json.dumps(
        canonical_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _normalize_seedance_video_mode(
    video_mode: Optional[str],
    *,
    image_count: int,
    has_reference_video: bool = False,
) -> str:
    normalized = (video_mode or "auto").strip().lower().replace("-", "_")
    if normalized not in {
        "auto",
        "standard",
        "first_frame",
        "reference_image",
        "reference_video",
        "first_last_frame",
    }:
        raise HTTPException(status_code=400, detail="不支持的视频生成模式")
    if normalized == "auto":
        if has_reference_video:
            return "reference_video"
        if image_count == 0:
            return "standard"
        if image_count == 1:
            return "first_frame"
        if image_count == 2:
            return "first_last_frame"
        return "reference_image"
    if normalized == "standard":
        if image_count == 1:
            return "first_frame"
        if image_count >= 2:
            return "reference_image"
    return normalized


def _validate_seedance_media_mode(video_mode: str, image_count: int, reference_video_url: Optional[str]):
    if video_mode == "first_frame" and image_count != 1:
        raise HTTPException(status_code=400, detail="首帧图生视频需要上传 1 张图片")
    if video_mode == "first_last_frame" and image_count != 2:
        raise HTTPException(status_code=400, detail="首尾帧视频需要上传首帧和尾帧两张图")
    if video_mode == "reference_image" and not 1 <= image_count <= 9:
        raise HTTPException(status_code=400, detail="参考图视频需要上传 1-9 张图片")
    if video_mode == "reference_video" and not reference_video_url:
        raise HTTPException(status_code=400, detail="参考视频模式需要先上传参考视频")
    if reference_video_url and video_mode != "reference_video":
        raise HTTPException(status_code=400, detail="已上传参考视频，请选择参考视频模式或移除视频")


def _validate_seedance_image_mode(video_mode: str, image_count: int):
    _validate_seedance_media_mode(video_mode, image_count, None)


def _get_seedance_image_role(video_mode: str, image_index: int) -> Optional[str]:
    if video_mode == "first_frame":
        return "first_frame"
    if video_mode == "first_last_frame":
        return "first_frame" if image_index == 0 else "last_frame"
    if video_mode in {"reference_image", "reference_video"}:
        return "reference_image"
    return None


def _build_seedance_prompt(prompt: str, *, aspect_ratio: str, duration_seconds: int) -> str:
    cleaned = (prompt or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="视频生成需要提供 prompt")
    return cleaned


def _build_seedance_provider_prompt(
    prompt: str,
    *,
    aspect_ratio: str,
    resolution: str,
    duration_seconds: int,
) -> str:
    cleaned = _build_seedance_prompt(
        prompt,
        aspect_ratio=aspect_ratio,
        duration_seconds=duration_seconds,
    )
    return (
        f"{cleaned} --resolution {resolution} --ratio {aspect_ratio} "
        f"--duration {duration_seconds} --camerafixed false --watermark false"
    )


def _build_public_base_url(request: Optional[Request] = None) -> str:
    configured_base_url = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    parsed = urlparse(configured_base_url)
    if (
        not configured_base_url
        or parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise HTTPException(
            status_code=500,
            detail="Seedance 本地参考图需要配置规范的 HTTPS PUBLIC_BASE_URL",
        )
    return configured_base_url


def _validate_seedance_reference_url(image_url: str) -> str:
    parsed = urlparse(image_url.strip())
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Seedance 远程参考图必须使用 HTTPS")
    if parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=400, detail="Seedance 远程参考图 URL 不允许包含凭据或片段")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local")):
        raise HTTPException(status_code=400, detail="Seedance 参考图地址不允许指向本地网络")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise HTTPException(status_code=400, detail="Seedance 参考图地址不允许指向私有网络")

    allowed_hosts = {
        item.strip().lower()
        for item in os.getenv("SEEDANCE_REFERENCE_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    public_base_url = os.getenv("PUBLIC_BASE_URL", "").strip()
    if public_base_url:
        public_hostname = urlparse(public_base_url).hostname
        if public_hostname:
            allowed_hosts.add(public_hostname.rstrip(".").lower())
    if not allowed_hosts or hostname not in allowed_hosts:
        raise HTTPException(status_code=400, detail="Seedance 参考图域名不在允许列表")
    return image_url.strip()


def _normalize_seedance_reference_video_url(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip()
    if not normalized:
        return None
    validated = _validate_seedance_reference_url(normalized)
    extension = os.path.splitext(urlparse(validated).path)[1].lower()
    if extension not in SEEDANCE_REFERENCE_VIDEO_MIME_TYPES:
        raise HTTPException(status_code=400, detail="参考视频地址必须指向 MP4、WebM 或 MOV 文件")
    return validated


def _seedance_local_reference_path_from_url(reference_url: Optional[str]) -> Optional[str]:
    if not reference_url:
        return None
    public_base_url = _build_public_base_url()
    expected_prefix = f"{public_base_url}/static/seedance_references/"
    if not reference_url.startswith(expected_prefix):
        return None

    filename = os.path.basename(urlparse(reference_url).path)
    if not re.fullmatch(r"[a-f0-9]{32}\.(?:mp4|webm|mov)", filename):
        raise HTTPException(status_code=400, detail="参考视频地址无效，请重新上传")
    reference_root = os.path.realpath(os.path.join("static", "seedance_references"))
    candidate = os.path.realpath(os.path.join(reference_root, filename))
    if os.path.dirname(candidate) != reference_root or not os.path.isfile(candidate):
        raise HTTPException(status_code=400, detail="参考视频已失效，请重新上传")
    return candidate


def _validate_seedance_reference_video_signature(extension: str, header: bytes):
    if extension == ".webm":
        if not header.startswith(b"\x1a\x45\xdf\xa3"):
            raise HTTPException(status_code=400, detail="参考视频不是有效的 WebM 文件")
        return
    if len(header) < 12 or (header[4:8] != b"ftyp" and b"moov" not in header[:32]):
        raise HTTPException(status_code=400, detail="参考视频不是有效的 MP4/MOV 文件")


def _decode_seedance_reference_image(image_data: str) -> Tuple[bytes, str]:
    if not image_data.startswith("data:") or "," not in image_data:
        raise HTTPException(status_code=400, detail="Seedance 参考图必须是 data URL 或受信任的 HTTPS 地址")
    header, encoded = image_data.split(",", 1)
    declared_mime = header.split(":", 1)[1].split(";", 1)[0].strip().lower()
    if declared_mime not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=400, detail="Seedance 参考图仅支持 PNG、JPEG 或 WebP")
    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Seedance 参考图 Base64 数据无效")

    max_bytes = int(os.getenv("SEEDANCE_REFERENCE_MAX_BYTES", str(8 * 1024 * 1024)))
    if len(raw_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail="Seedance 参考图过大，请压缩后重试")

    max_pixels = int(os.getenv("SEEDANCE_REFERENCE_MAX_PIXELS", str(24_000_000)))
    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw_bytes)) as source:
            source = ImageOps.exif_transpose(source)
            if source.width <= 0 or source.height <= 0 or source.width * source.height > max_pixels:
                raise HTTPException(status_code=413, detail="Seedance 参考图像素尺寸过大")
            source.load()
            output = io.BytesIO()
            has_alpha = "A" in source.getbands()
            if has_alpha:
                source.convert("RGBA").save(output, format="PNG", optimize=True)
                extension = ".png"
            else:
                source.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
                extension = ".jpg"
            return output.getvalue(), extension
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Seedance 参考图不是有效的图片文件")


def _save_seedance_reference_image(
    image_data: str,
    *,
    index: int,
    public_base_url: str,
    saved_paths: Optional[List[str]] = None,
) -> str:
    if image_data.startswith(("http://", "https://")):
        return _validate_seedance_reference_url(image_data)

    sanitized_bytes, extension = _decode_seedance_reference_image(image_data)
    safe_filename = f"{uuid.uuid4().hex}{extension}"
    relative_dir = "seedance_references"
    target_dir = os.path.join("static", relative_dir)
    os.makedirs(target_dir, exist_ok=True)
    os.chmod(target_dir, 0o755)
    target_path = os.path.join(target_dir, safe_filename)
    with open(target_path, "xb") as file_handle:
        file_handle.write(sanitized_bytes)
    os.chmod(target_path, 0o644)
    if saved_paths is not None:
        saved_paths.append(target_path)

    return f"{public_base_url}/static/{relative_dir}/{safe_filename}"


def _serialize_seedance_reference_state(
    *,
    local_paths: List[str],
    image_urls: List[str],
    video_mode: str,
    generate_audio: bool,
    reference_video_url: Optional[str] = None,
) -> str:
    return json.dumps(
        {
            "local_paths": local_paths,
            "image_urls": image_urls,
            "video_mode": video_mode,
            "generate_audio": generate_audio,
            "reference_video_url": reference_video_url,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _parse_seedance_reference_state(
    reference_paths_value,
) -> Tuple[List[str], List[str], Optional[str], Optional[bool], Optional[str]]:
    if not reference_paths_value:
        return [], [], None, None, None
    if isinstance(reference_paths_value, str):
        try:
            value = json.loads(reference_paths_value)
        except json.JSONDecodeError:
            return [], [], None, None, None
    else:
        value = reference_paths_value
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)], [], None, None, None
    if not isinstance(value, dict):
        return [], [], None, None, None
    local_paths = [item for item in value.get("local_paths", []) if isinstance(item, str)]
    image_urls = [item for item in value.get("image_urls", []) if isinstance(item, str)]
    video_mode = value.get("video_mode")
    generate_audio = value.get("generate_audio")
    reference_video_url = value.get("reference_video_url")
    return (
        local_paths,
        image_urls,
        video_mode if isinstance(video_mode, str) else None,
        generate_audio if isinstance(generate_audio, bool) else None,
        reference_video_url if isinstance(reference_video_url, str) else None,
    )


def _cleanup_seedance_reference_paths(reference_paths_value) -> int:
    paths, _, _, _, _ = _parse_seedance_reference_state(reference_paths_value)

    root = os.path.realpath(os.path.join("static", "seedance_references"))
    removed = 0
    for candidate in paths:
        if not isinstance(candidate, str):
            continue
        resolved = os.path.realpath(candidate)
        if os.path.dirname(resolved) != root:
            continue
        with suppress(FileNotFoundError):
            os.remove(resolved)
            removed += 1
    return removed


def _build_seedance_content(
    *,
    prompt: str,
    image_urls: Optional[List[str]],
    aspect_ratio: str,
    resolution: str,
    duration_seconds: int,
    video_mode: str,
    reference_video_url: Optional[str] = None,
) -> List[dict]:
    content = [{
        "type": "text",
        "text": _build_seedance_provider_prompt(
            prompt,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration_seconds=duration_seconds,
        ),
    }]
    for image_index, image_url in enumerate(image_urls or []):
        image_item = {
            "type": "image_url",
            "image_url": {"url": image_url},
        }
        role = _get_seedance_image_role(video_mode, image_index)
        if role:
            image_item["role"] = role
        content.append(image_item)
    if reference_video_url:
        content.append({
            "type": "video_url",
            "video_url": {"url": reference_video_url},
            "role": "reference_video",
        })
    return content


async def _create_seedance_task(
    *,
    prompt: str,
    image_urls: Optional[List[str]],
    aspect_ratio: str,
    resolution: str,
    duration_seconds: int,
    video_mode: str,
    generate_audio: bool,
    reference_video_url: Optional[str],
    idempotency_key: str,
    provider_model: str,
) -> Tuple[str, str]:
    api_key = _get_seedance_api_key()
    payload = {
        "model": provider_model,
        "content": _build_seedance_content(
            prompt=prompt,
            image_urls=image_urls,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration_seconds=duration_seconds,
            video_mode=video_mode,
            reference_video_url=reference_video_url,
        ),
        "ratio": aspect_ratio,
        "resolution": resolution,
        "duration": duration_seconds,
        "watermark": False,
        "camera_fixed": False,
        "generate_audio": generate_audio,
    }
    url = f"{_get_seedance_base_url()}/seedance/v3/contents/generations/tasks"
    timeout = httpx.Timeout(
        connect=float(os.getenv("SEEDANCE_CONNECT_TIMEOUT_SECONDS", "10")),
        read=float(os.getenv("SEEDANCE_CREATE_READ_TIMEOUT_SECONDS", "120")),
        write=float(os.getenv("SEEDANCE_WRITE_TIMEOUT_SECONDS", "30")),
        pool=float(os.getenv("SEEDANCE_POOL_TIMEOUT_SECONDS", "10")),
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
                "X-Request-Id": idempotency_key,
            },
        )
        response.raise_for_status()
        data = response.json()

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Seedance 创建任务返回了无效响应")
    task_id = str(data.get("id") or "").strip()
    if not task_id or len(task_id) > 96:
        raise HTTPException(status_code=502, detail="Seedance 创建任务成功但未返回 id")
    return task_id, provider_model


async def _query_seedance_task(task_id: str) -> dict:
    api_key = _get_seedance_api_key()
    encoded_task_id = quote(task_id, safe="")
    url = f"{_get_seedance_base_url()}/seedance/v3/contents/generations/tasks/{encoded_task_id}"
    timeout = httpx.Timeout(
        connect=float(os.getenv("SEEDANCE_CONNECT_TIMEOUT_SECONDS", "10")),
        read=float(os.getenv("SEEDANCE_QUERY_READ_TIMEOUT_SECONDS", "20")),
        write=float(os.getenv("SEEDANCE_WRITE_TIMEOUT_SECONDS", "30")),
        pool=float(os.getenv("SEEDANCE_POOL_TIMEOUT_SECONDS", "10")),
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        return response.json()


async def _query_seedance_v2_video_task(task_id: str) -> dict:
    api_key = _get_seedance_api_key()
    encoded_task_id = quote(task_id, safe="")
    url = f"{_get_seedance_base_url()}/v2/videos/generations/{encoded_task_id}"
    timeout = httpx.Timeout(
        connect=float(os.getenv("SEEDANCE_CONNECT_TIMEOUT_SECONDS", "10")),
        read=float(os.getenv("SEEDANCE_QUERY_READ_TIMEOUT_SECONDS", "20")),
        write=float(os.getenv("SEEDANCE_WRITE_TIMEOUT_SECONDS", "30")),
        pool=float(os.getenv("SEEDANCE_POOL_TIMEOUT_SECONDS", "10")),
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        return response.json()


def _extract_seedance_video_url(data, *, depth: int = 0) -> Optional[str]:
    if depth > 6:
        return None
    if isinstance(data, dict):
        value = data.get("video_url")
        if isinstance(value, str) and value.strip():
            parsed = urlparse(value.strip())
            if (
                parsed.scheme == "https"
                and parsed.hostname
                and not parsed.username
                and not parsed.password
                and not parsed.fragment
            ):
                hostname = parsed.hostname.rstrip(".").lower()
                try:
                    address = ipaddress.ip_address(hostname)
                except ValueError:
                    address = None
                allowed_hosts = {
                    item.strip().lower()
                    for item in os.getenv("SEEDANCE_VIDEO_ALLOWED_HOSTS", "").split(",")
                    if item.strip()
                }
                if (not address or address.is_global) and (
                    not allowed_hosts or hostname in allowed_hosts
                ):
                    return value.strip()
        for key in ("content", "data", "output", "result"):
            nested = data.get(key)
            if isinstance(nested, (dict, list)):
                nested_url = _extract_seedance_video_url(nested, depth=depth + 1)
                if nested_url:
                    return nested_url
    elif isinstance(data, list):
        for nested in data[:20]:
            nested_url = _extract_seedance_video_url(nested, depth=depth + 1)
            if nested_url:
                return nested_url
    return None


def _format_seedance_error_message(error_value) -> str:
    generic_message = "Seedance 视频生成失败"
    if isinstance(error_value, dict):
        code = error_value.get("code")
        if isinstance(code, (str, int)):
            normalized_code = str(code).strip()
            if re.fullmatch(r"(?:[0-9]{1,10}|[A-Z][A-Z0-9_]{1,31})", normalized_code):
                return f"{generic_message}（错误码：{normalized_code}）"
    return generic_message


def _find_video_task_by_request_id(db: Session, *, user_id: int, request_id: str) -> Optional[VideoGenerationTask]:
    return db.query(VideoGenerationTask).filter(
        VideoGenerationTask.request_id == request_id,
        VideoGenerationTask.user_id == user_id,
    ).first()


def _build_video_task_response_from_record(
    db: Session,
    task: VideoGenerationTask,
    current_user: User,
) -> VideoTaskResponse:
    hold_txn = db.query(CreditTransaction).filter(CreditTransaction.id == task.hold_transaction_id).first()
    db.refresh(current_user)
    next_poll_at = getattr(task, "next_poll_at", None)
    retry_after_ms = None
    if next_poll_at:
        retry_after_ms = max(0, int((next_poll_at - datetime.utcnow()).total_seconds() * 1000))
    settlement_status = getattr(task, "settlement_status", None) or (hold_txn.status if hold_txn else "UNKNOWN")
    return VideoTaskResponse(
        task_id=task.task_id,
        request_id=task.request_id,
        status=task.status,
        video_url=task.video_url,
        charged_credits=abs(hold_txn.amount) if hold_txn else 0,
        remaining_credits=current_user.credits,
        timestamp=int(datetime.utcnow().timestamp() * 1000),
        settlement_status=settlement_status,
        error_message=task.error_message,
        retry_after_ms=retry_after_ms,
    )


def _schedule_seedance_retry(task: VideoGenerationTask, *, error_message: Optional[str] = None):
    now = datetime.utcnow()
    task.attempt_count = int(getattr(task, "attempt_count", 0) or 0) + 1
    task.last_polled_at = now
    task.last_provider_error = (error_message or "Seedance 暂时不可用")[:1000]
    deadline_at = _ensure_seedance_task_deadline(task)
    if now >= deadline_at:
        task.status = "reconciliation_required"
        task.settlement_status = "REVIEW_REQUIRED"
        task.error_message = "任务超过自动对账时限，需要管理员复核；积分仍处于预占状态"
        task.next_poll_at = None
        return
    task.next_poll_at = now + timedelta(seconds=_seedance_retry_delay_seconds(task.attempt_count))


def _mark_seedance_submission_unknown(
    db: Session,
    task: VideoGenerationTask,
    *,
    error_message: str,
):
    task.status = "submit_unknown"
    task.settlement_status = "PENDING"
    task.last_provider_error = error_message[:1000]
    task.error_message = "上游提交结果暂未确认，系统将继续自动对账；积分保持预占，不会重复扣除"
    task.next_poll_at = datetime.utcnow() + timedelta(seconds=_seedance_retry_delay_seconds(0))
    db.add(task)
    db.commit()
    db.refresh(task)


def _settle_seedance_hold(
    db: Session,
    task: VideoGenerationTask,
    *,
    outcome: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Tuple[str, Optional[str]]:
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
        CreditTransaction.user_id == task.user_id,
        CreditTransaction.type == "GENERATE_HOLD",
    ).first()
    if not hold_txn:
        return "REVIEW_REQUIRED", "积分预占记录缺失，需要管理员复核"

    expected_type = "GENERATE_CAPTURE" if outcome == "success" else "GENERATE_REFUND"
    expected_hold_status = "SUCCESS" if outcome == "success" else "REFUNDED"
    opposite_hold_status = "REFUNDED" if outcome == "success" else "SUCCESS"
    settlement_key = f"generation-hold:{hold_txn.id}:settlement"

    if hold_txn.status == "PENDING":
        try:
            with db.begin_nested():
                if outcome == "success":
                    settlement = capture_generation_hold(
                        db,
                        hold_txn,
                        provider_meta={"channel": "Seedance"},
                    )
                else:
                    settlement = refund_generation_hold(
                        db,
                        hold_txn,
                        error_code=error_code or "SEEDANCE_TASK_FAILED",
                        error_message=error_message or "Seedance 视频生成失败",
                    )
                db.flush()
        except Exception as error:
            return (
                "REVIEW_REQUIRED",
                f"积分结算事务异常（{type(error).__name__}），需要管理员复核",
            )
        if settlement.type != expected_type:
            return "REVIEW_REQUIRED", "积分预占已按相反结果结算，需要管理员复核"
        return ("CAPTURED" if outcome == "success" else "REFUNDED"), None

    if hold_txn.status == opposite_hold_status:
        return "REVIEW_REQUIRED", "供应商终态与积分结算方向冲突，需要管理员复核"
    if hold_txn.status != expected_hold_status:
        return "REVIEW_REQUIRED", f"未知积分预占状态：{hold_txn.status}"

    settlement = db.query(CreditTransaction).filter(
        CreditTransaction.settlement_key == settlement_key,
        CreditTransaction.user_id == task.user_id,
        CreditTransaction.type == expected_type,
    ).first()
    if not settlement:
        return "REVIEW_REQUIRED", "积分预占已终结但缺少唯一结算流水，需要管理员复核"
    return ("CAPTURED" if outcome == "success" else "REFUNDED"), None


def _mark_seedance_submission_failed(
    db: Session,
    task: VideoGenerationTask,
    *,
    error_code: str,
    error_message: str,
):
    settlement_status, settlement_error = _settle_seedance_hold(
        db,
        task,
        outcome="failure",
        error_code=error_code,
        error_message=error_message,
    )
    if settlement_status == "REFUNDED":
        task.status = "failed"
        task.finished_at = datetime.utcnow()
    else:
        task.status = "reconciliation_required"
    task.settlement_status = settlement_status
    task.error_message = settlement_error or error_message
    task.next_poll_at = None
    db.add(task)
    db.commit()
    db.refresh(task)
    _cleanup_task_seedance_references(db, task)


def _mark_seedance_reconciliation_required(
    db: Session,
    task: VideoGenerationTask,
    *,
    error_message: str,
):
    task.status = "reconciliation_required"
    task.settlement_status = "REVIEW_REQUIRED"
    task.error_message = error_message[:1000]
    task.next_poll_at = None
    db.add(task)
    db.commit()
    db.refresh(task)


def _claim_seedance_submission(db: Session, task: VideoGenerationTask) -> bool:
    now = datetime.utcnow()
    lease_seconds = max(180, int(os.getenv("SEEDANCE_SUBMIT_LEASE_SECONDS", "180")))
    updated = (
        db.query(VideoGenerationTask)
        .filter(
            VideoGenerationTask.id == task.id,
            VideoGenerationTask.status == "ready",
            or_(
                VideoGenerationTask.next_poll_at.is_(None),
                VideoGenerationTask.next_poll_at <= now,
            ),
        )
        .update(
            {
                VideoGenerationTask.status: "submitting",
                VideoGenerationTask.next_poll_at: now + timedelta(seconds=lease_seconds),
                VideoGenerationTask.last_polled_at: now,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    db.refresh(task)
    return updated == 1


async def _submit_seedance_task_record(
    db: Session,
    task: VideoGenerationTask,
) -> VideoGenerationTask:
    if task.status != "ready":
        return task
    if datetime.utcnow() >= _ensure_seedance_task_deadline(task):
        _mark_seedance_reconciliation_required(
            db,
            task,
            error_message="任务在提交前已超过自动处理时限；积分仍处于预占状态",
        )
        return task
    if not _claim_seedance_submission(db, task):
        return task

    (
        _,
        image_urls,
        stored_video_mode,
        stored_generate_audio,
        reference_video_url,
    ) = _parse_seedance_reference_state(
        task.reference_paths
    )
    video_mode = stored_video_mode or _normalize_seedance_video_mode(
        "auto",
        image_count=len(image_urls),
    )
    generate_audio = stored_generate_audio if stored_generate_audio is not None else False
    provider_task_id = None
    provider_model = None
    try:
        provider_task_id, provider_model = await _create_seedance_task(
            prompt=task.prompt,
            image_urls=image_urls,
            aspect_ratio=task.aspect_ratio,
            resolution=task.resolution,
            duration_seconds=task.duration_seconds,
            video_mode=video_mode,
            generate_audio=generate_audio,
            reference_video_url=reference_video_url,
            idempotency_key=_seedance_provider_idempotency_key(
                user_id=task.user_id,
                request_id=task.request_id,
            ),
            provider_model=(
                task.provider_model
                or _get_seedance_model(task.selected_model)
            ),
        )
        task.provider_task_id = provider_task_id
        task.provider_model = provider_model
        task.status = "submitted"
        task.error_message = None
        task.last_provider_error = None
        task.next_poll_at = datetime.utcnow() + timedelta(seconds=3)
        db.add(task)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            persisted_task = db.query(VideoGenerationTask).filter(
                VideoGenerationTask.id == task.id,
            ).first()
            if persisted_task:
                _mark_seedance_reconciliation_required(
                    db,
                    persisted_task,
                    error_message="供应商任务 ID 与其他本地任务冲突，需要管理员复核；积分保持预占",
                )
                return persisted_task
            raise
        db.refresh(task)
        return task
    except httpx.HTTPStatusError as error:
        status_code = error.response.status_code if error.response is not None else None
        if status_code is not None and 400 <= status_code < 500 and status_code not in {408, 409}:
            hold_txn = db.query(CreditTransaction).filter(
                CreditTransaction.id == task.hold_transaction_id,
            ).first()
            if not hold_txn:
                _mark_seedance_reconciliation_required(
                    db,
                    task,
                    error_message="供应商拒绝任务，但本地积分预占记录缺失，需要管理员复核",
                )
                return task
            message = f"Seedance 拒绝创建任务（HTTP {status_code}）"
            _mark_seedance_submission_failed(
                db,
                task,
                error_code="SEEDANCE_CREATE_REJECTED",
                error_message=message,
            )
            safe_update_generation_event_status(
                SessionLocal,
                request_id=task.request_id,
                user_id=task.user_id,
                entrypoint="video_generate",
                status="FAILED",
                error_code="SEEDANCE_CREATE_REJECTED",
                error_message=message,
            )
            return task
        _mark_seedance_submission_unknown(
            db,
            task,
            error_message=f"创建响应不确定: HTTP {status_code or 'unknown'}",
        )
        return task
    except (httpx.TimeoutException, httpx.RequestError) as error:
        _mark_seedance_submission_unknown(
            db,
            task,
            error_message=f"创建响应不确定: {type(error).__name__}",
        )
        return task
    except Exception as error:
        db.rollback()
        persisted_task = db.query(VideoGenerationTask).filter(
            VideoGenerationTask.id == task.id,
        ).first()
        if not persisted_task:
            raise HTTPException(
                status_code=503,
                detail="Seedance 提交结果未知，请使用原请求 ID 查询",
            )
        if provider_task_id:
            persisted_task.provider_task_id = provider_task_id
            persisted_task.provider_model = provider_model or persisted_task.provider_model
        _mark_seedance_submission_unknown(
            db,
            persisted_task,
            error_message=f"创建响应解析或持久化失败: {type(error).__name__}",
        )
        return persisted_task


def _claim_seedance_poll(
    db: Session,
    task: VideoGenerationTask,
    *,
    include_review_required: bool = False,
) -> bool:
    now = datetime.utcnow()
    lease_seconds = max(90, int(os.getenv("SEEDANCE_POLL_LEASE_SECONDS", "90")))
    eligible_statuses = set(SEEDANCE_ACTIVE_STATUSES)
    if include_review_required:
        eligible_statuses.add("reconciliation_required")
    updated = (
        db.query(VideoGenerationTask)
        .filter(
            VideoGenerationTask.id == task.id,
            func.lower(VideoGenerationTask.status).in_(eligible_statuses),
            or_(
                VideoGenerationTask.next_poll_at.is_(None),
                VideoGenerationTask.next_poll_at <= now,
            ),
        )
        .update(
            {
                VideoGenerationTask.next_poll_at: now + timedelta(seconds=max(10, lease_seconds)),
                VideoGenerationTask.last_polled_at: now,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    db.refresh(task)
    return updated == 1


def _reload_claimed_seedance_task(
    db: Session,
    task: VideoGenerationTask,
    claim_marker: Optional[datetime],
) -> Tuple[VideoGenerationTask, bool]:
    """Reload after an upstream await and reject stale/non-monotonic writes."""
    db.expire_all()
    persisted = db.query(VideoGenerationTask).filter(
        VideoGenerationTask.id == task.id,
    ).populate_existing().first()
    if persisted is None:
        return task, False
    if (
        str(persisted.status or "").lower() in {"succeeded", "failed"}
        or str(persisted.settlement_status or "").upper() in {"CAPTURED", "REFUNDED"}
    ):
        return persisted, False
    if claim_marker is not None and persisted.last_polled_at != claim_marker:
        return persisted, False
    return persisted, True


def _normalize_seedance_provider_status(raw_status: Optional[str], *, video_url: Optional[str]) -> str:
    normalized = str(raw_status or "running").strip().lower()
    if normalized in SEEDANCE_SUCCESS_STATUSES:
        return "succeeded" if video_url else "finalizing"
    if normalized in SEEDANCE_FAILURE_STATUSES:
        return "failed"
    if normalized in {"queued", "pending", "submitted", "created"}:
        return "submitted"
    return "running"


def _cleanup_task_seedance_references(db: Session, task: VideoGenerationTask):
    reference_paths = getattr(task, "reference_paths", None)
    _cleanup_seedance_reference_paths(reference_paths)
    if reference_paths:
        task.reference_paths = "[]"
        db.add(task)
        db.commit()


async def _reconcile_seedance_task_record(
    db: Session,
    task: VideoGenerationTask,
    *,
    force: bool = False,
) -> VideoGenerationTask:
    poll_claimed = False
    claim_marker = None
    normalized_task_status = str(task.status or "").strip().lower()
    canonical_active_status = SEEDANCE_LEGACY_ACTIVE_STATUS_MAP.get(
        normalized_task_status,
        normalized_task_status,
    )
    if canonical_active_status in SEEDANCE_ACTIVE_STATUSES and task.status != canonical_active_status:
        task.status = canonical_active_status
        task.deadline_at = task.deadline_at or _seedance_task_deadline()
        task.next_poll_at = None
        db.add(task)
        db.commit()
        db.refresh(task)
    if task.status not in SEEDANCE_ACTIVE_STATUSES:
        if not (force and task.status == "reconciliation_required"):
            return task
        if not _claim_seedance_poll(db, task, include_review_required=True):
            db.refresh(task)
            return task
        poll_claimed = True
        claim_marker = task.last_polled_at
        task.status = "submitted" if task.provider_task_id else "submit_unknown"
        task.settlement_status = "PENDING"
        task.error_message = None
        task.deadline_at = _seedance_task_deadline()
        db.add(task)
        db.commit()
        db.refresh(task)

    if task.status == "ready":
        return await _submit_seedance_task_record(db, task)

    if task.status in {"creating", "submitting"} and not task.provider_task_id:
        if task.next_poll_at and task.next_poll_at > datetime.utcnow() and not force:
            return task
        _mark_seedance_submission_unknown(
            db,
            task,
            error_message="提交进程中断，无法确认供应商是否已接收任务",
        )
        return task

    provider_task_id = getattr(task, "provider_task_id", None) or (
        task.task_id if getattr(task, "api_format", "v3") == "v2" else None
    )
    if not provider_task_id:
        _schedule_seedance_retry(task, error_message="上游任务 ID 尚未确认")
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    if not poll_claimed:
        if not _claim_seedance_poll(db, task):
            return task
        claim_marker = task.last_polled_at

    try:
        if task.api_format == "v2":
            data = await _query_seedance_v2_video_task(provider_task_id)
        else:
            data = await _query_seedance_task(provider_task_id)
    except httpx.HTTPStatusError as error:
        task, owns_claim = _reload_claimed_seedance_task(db, task, claim_marker)
        if not owns_claim:
            return task
        status_code = error.response.status_code if error.response is not None else None
        _schedule_seedance_retry(task, error_message=f"上游查询 HTTP {status_code or 'unknown'}")
        db.add(task)
        db.commit()
        db.refresh(task)
        return task
    except (httpx.TimeoutException, httpx.RequestError) as error:
        task, owns_claim = _reload_claimed_seedance_task(db, task, claim_marker)
        if not owns_claim:
            return task
        _schedule_seedance_retry(task, error_message=type(error).__name__)
        db.add(task)
        db.commit()
        db.refresh(task)
        return task
    except Exception as error:
        task, owns_claim = _reload_claimed_seedance_task(db, task, claim_marker)
        if not owns_claim:
            return task
        _schedule_seedance_retry(task, error_message=f"无效上游响应: {type(error).__name__}")
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    if not isinstance(data, dict):
        task, owns_claim = _reload_claimed_seedance_task(db, task, claim_marker)
        if not owns_claim:
            return task
        _schedule_seedance_retry(task, error_message="上游查询返回了非对象 JSON")
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    task, owns_claim = _reload_claimed_seedance_task(db, task, claim_marker)
    if not owns_claim:
        return task
    video_url = _extract_seedance_video_url(data)
    task.status = _normalize_seedance_provider_status(data.get("status"), video_url=video_url)
    task.attempt_count = 0
    task.last_provider_error = None
    task.last_polled_at = datetime.utcnow()
    task.next_poll_at = None
    if video_url:
        task.video_url = video_url

    provider_terminal_status = task.status if task.status in {"succeeded", "failed"} else None
    if task.status == "succeeded":
        settlement_status, settlement_error = _settle_seedance_hold(
            db,
            task,
            outcome="success",
        )
        task.settlement_status = settlement_status
        if settlement_status == "CAPTURED":
            task.finished_at = datetime.utcnow()
            task.error_message = None
        else:
            task.status = "reconciliation_required"
            task.error_message = settlement_error
            task.next_poll_at = None
    elif task.status == "failed":
        provider_error_message = _format_seedance_error_message(
            data.get("error") or data.get("message")
        )
        settlement_status, settlement_error = _settle_seedance_hold(
            db,
            task,
            outcome="failure",
            error_code="SEEDANCE_TASK_FAILED",
            error_message=provider_error_message,
        )
        task.settlement_status = settlement_status
        if settlement_status == "REFUNDED":
            task.finished_at = datetime.utcnow()
            task.error_message = provider_error_message
        else:
            task.status = "reconciliation_required"
            task.error_message = settlement_error or provider_error_message
            task.next_poll_at = None
    else:
        if datetime.utcnow() >= _ensure_seedance_task_deadline(task):
            task.status = "reconciliation_required"
            task.settlement_status = "REVIEW_REQUIRED"
            task.error_message = "任务超过自动对账时限，需要管理员复核；积分仍处于预占状态"
            task.next_poll_at = None
        else:
            task.settlement_status = "PENDING"
            task.next_poll_at = datetime.utcnow() + timedelta(
                seconds=int(os.getenv("SEEDANCE_PROVIDER_POLL_INTERVAL_SECONDS", "10"))
            )

    db.add(task)
    db.commit()
    db.refresh(task)

    if provider_terminal_status:
        _cleanup_task_seedance_references(db, task)
        safe_update_generation_event_status(
            SessionLocal,
            request_id=task.request_id,
            user_id=task.user_id,
            entrypoint="video_generate",
            status=(
                "SUCCESS"
                if task.status == "succeeded"
                else "FAILED" if task.status == "failed" else "REVIEW_REQUIRED"
            ),
            error_code=(
                None
                if task.status == "succeeded"
                else "SEEDANCE_TASK_FAILED" if task.status == "failed" else "SEEDANCE_SETTLEMENT_CONFLICT"
            ),
            error_message=task.error_message,
        )
    return task


def _cleanup_expired_seedance_reference_files(db: Session) -> int:
    if os.getenv("SEEDANCE_REFERENCE_GC_ENABLED", "true").strip().lower() not in {"1", "true", "yes"}:
        return 0
    target_dir = os.path.realpath(os.path.join("static", "seedance_references"))
    if not os.path.isdir(target_dir):
        return 0
    active_paths = set()
    for value, in db.query(VideoGenerationTask.reference_paths).filter(
        func.lower(VideoGenerationTask.status).in_(SEEDANCE_ACTIVE_STATUSES)
    ).all():
        local_paths, _, _, _, _ = _parse_seedance_reference_state(value)
        active_paths.update(os.path.realpath(item) for item in local_paths)
    ttl_seconds = int(os.getenv("SEEDANCE_REFERENCE_TTL_SECONDS", "86400"))
    cutoff = datetime.utcnow().timestamp() - max(3600, ttl_seconds)
    removed = 0
    for entry in os.scandir(target_dir):
        if not entry.is_file(follow_symlinks=False):
            continue
        resolved = os.path.realpath(entry.path)
        if resolved in active_paths or entry.stat(follow_symlinks=False).st_mtime >= cutoff:
            continue
        with suppress(FileNotFoundError):
            os.remove(resolved)
            removed += 1
    return removed


async def _reconcile_pending_seedance_tasks_once(
    *,
    limit: int = 20,
    include_review_required: bool = False,
) -> int:
    selector_db = SessionLocal()
    try:
        now = datetime.utcnow()
        eligible_statuses = set(SEEDANCE_ACTIVE_STATUSES)
        if include_review_required:
            eligible_statuses.add("reconciliation_required")
        task_ids = [
            row[0]
            for row in (
                selector_db.query(VideoGenerationTask.id)
                .filter(
                    func.lower(VideoGenerationTask.status).in_(eligible_statuses),
                    or_(
                        VideoGenerationTask.next_poll_at.is_(None),
                        VideoGenerationTask.next_poll_at <= now,
                    ),
                )
                .order_by(VideoGenerationTask.created_at.asc())
                .limit(max(1, min(limit, 100)))
                .all()
            )
        ]
    finally:
        selector_db.close()

    concurrency = max(1, min(int(os.getenv("SEEDANCE_RECONCILER_CONCURRENCY", "4")), 8))
    semaphore = asyncio.Semaphore(concurrency)

    async def reconcile_one(task_id: int) -> Tuple[int, bool]:
        async with semaphore:
            task_db = SessionLocal()
            try:
                task = task_db.query(VideoGenerationTask).filter(
                    VideoGenerationTask.id == task_id,
                ).first()
                if not task:
                    return 0, False
                await _reconcile_seedance_task_record(
                    task_db,
                    task,
                    force=include_review_required and task.status == "reconciliation_required",
                )
                return 1, False
            except Exception as error:
                task_db.rollback()
                print(
                    "⚠️ Seedance 单任务对账异常: "
                    f"{type(error).__name__}"
                )
                return 0, True
            finally:
                task_db.close()

    results = await asyncio.gather(*(reconcile_one(task_id) for task_id in task_ids))
    gc_db = SessionLocal()
    try:
        _cleanup_expired_seedance_reference_files(gc_db)
        _cleanup_expired_image_generation_results(gc_db)
    finally:
        gc_db.close()
    if any(had_error for _, had_error in results):
        raise RuntimeError("one or more Seedance tasks failed reconciliation")
    return sum(processed for processed, _ in results)


async def _seedance_reconciler_loop():
    global _seedance_reconciler_last_success_at
    global _seedance_reconciler_last_error_at
    global _seedance_reconciler_last_error_type
    interval = max(3, int(os.getenv("SEEDANCE_RECONCILER_INTERVAL_SECONDS", "10")))
    while True:
        try:
            await _reconcile_pending_seedance_tasks_once()
            _seedance_reconciler_last_success_at = datetime.utcnow()
            _seedance_reconciler_last_error_at = None
            _seedance_reconciler_last_error_type = None
        except asyncio.CancelledError:
            raise
        except Exception as error:
            _seedance_reconciler_last_error_at = datetime.utcnow()
            _seedance_reconciler_last_error_type = type(error).__name__
            print(f"⚠️ Seedance 对账循环异常: {type(error).__name__}")
        await asyncio.sleep(interval)


@app.on_event("startup")
async def _start_seedance_reconciler():
    global _seedance_reconciler_task
    global _seedance_reconciler_last_success_at
    global _seedance_reconciler_last_error_at
    global _seedance_reconciler_last_error_type
    enabled = os.getenv("SEEDANCE_RECONCILER_ENABLED", "true").strip().lower() in {"1", "true", "yes"}
    if enabled and (_seedance_reconciler_task is None or _seedance_reconciler_task.done()):
        _seedance_reconciler_last_success_at = None
        _seedance_reconciler_last_error_at = None
        _seedance_reconciler_last_error_type = None
        _seedance_reconciler_task = asyncio.create_task(_seedance_reconciler_loop())


@app.on_event("shutdown")
async def _stop_seedance_reconciler():
    global _seedance_reconciler_task
    if _seedance_reconciler_task and not _seedance_reconciler_task.done():
        _seedance_reconciler_task.cancel()
        with suppress(asyncio.CancelledError):
            await _seedance_reconciler_task
    _seedance_reconciler_task = None
    pending_admin_jobs = list(_seedance_admin_reconcile_jobs)
    for task in pending_admin_jobs:
        task.cancel()
    if pending_admin_jobs:
        await asyncio.gather(*pending_admin_jobs, return_exceptions=True)
    _seedance_admin_reconcile_jobs.clear()


def _create_generation_hold_or_raise(
    db: Session,
    current_user: User,
    *,
    resolution: str,
    num_images: int,
    request_id: str,
    idempotency_key: str,
    selected_model: Optional[str] = None,
):
    try:
        hold_txn = create_generation_hold(
            db,
            current_user,
            resolution=resolution,
            num_images=num_images,
            request_id=request_id,
            idempotency_key=idempotency_key,
            selected_model=selected_model,
        )
        db.commit()
        db.refresh(current_user)
        return hold_txn
    except ValueError:
        db.rollback()
        raise HTTPException(status_code=402, detail="积分不足，请充值")
    except Exception as error:
        db.rollback()
        print(f"⚠️ 创建积分预占异常: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="创建扣费预占失败，请稍后重试")


def _find_image_generation_task(
    db: Session,
    *,
    user_id: int,
    request_id: str,
) -> Optional[ImageGenerationTask]:
    return db.query(ImageGenerationTask).filter(
        ImageGenerationTask.user_id == user_id,
        ImageGenerationTask.request_id == request_id,
    ).first()


def _image_provider_idempotency_key(*, user_id: int, request_id: str) -> str:
    value = f"image-generate:{user_id}:{request_id}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _build_image_success_response_from_task(
    response_model,
    *,
    db: Session,
    task: ImageGenerationTask,
    current_user: User,
):
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
        CreditTransaction.user_id == current_user.id,
        CreditTransaction.type == "GENERATE_HOLD",
    ).first()
    settlement = None
    if hold_txn is not None:
        settlement = db.query(CreditTransaction).filter(
            CreditTransaction.settlement_key == f"generation-hold:{hold_txn.id}:settlement",
            CreditTransaction.type == "GENERATE_CAPTURE",
            CreditTransaction.status == "SUCCESS",
        ).first()
    if task.status == "succeeded" and (
        not task.image_url
        or (task.result_expires_at is not None and task.result_expires_at <= datetime.utcnow())
    ):
        raise HTTPException(
            status_code=410,
            detail="该生图结果已超过保留期；如需重新生成，请使用新的 request_id",
        )
    if (
        task.status != "succeeded"
        or hold_txn is None
        or hold_txn.status != "SUCCESS"
        or settlement is None
    ):
        raise HTTPException(
            status_code=409,
            detail="生图结果与积分结算记录不一致，需要管理员复核",
        )
    db.refresh(current_user)
    timestamp_source = task.finished_at or task.updated_at or task.created_at or datetime.utcnow()
    return response_model(
        image_url=task.image_url,
        timestamp=int(timestamp_source.timestamp() * 1000),
        charged_credits=abs(hold_txn.amount),
        remaining_credits=current_user.credits,
        request_id=task.request_id,
    )


def _build_image_task_response_from_record(
    db: Session,
    task: ImageGenerationTask,
    current_user: User,
) -> ImageTaskResponse:
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
        CreditTransaction.user_id == current_user.id,
        CreditTransaction.type == "GENERATE_HOLD",
    ).first()
    remaining_credits = db.query(User.credits).filter(User.id == current_user.id).scalar()
    result_available = bool(
        task.status == "succeeded"
        and task.settlement_status == "CAPTURED"
        and task.image_url
        and (task.result_expires_at is None or task.result_expires_at > datetime.utcnow())
    )
    timestamp_source = task.finished_at or task.updated_at or task.created_at or datetime.utcnow()
    error_message = task.error_message
    if task.status == "succeeded" and not result_available and not error_message:
        error_message = "生图任务已完成，但结果已超过本地保留期"
    return ImageTaskResponse(
        task_id=task.task_id,
        request_id=task.request_id,
        status=task.status,
        image_url=task.image_url if result_available else None,
        charged_credits=abs(hold_txn.amount) if hold_txn is not None else 0,
        remaining_credits=int(remaining_credits if remaining_credits is not None else current_user.credits),
        timestamp=int(timestamp_source.timestamp() * 1000),
        settlement_status=task.settlement_status,
        error_message=error_message,
    )


def _resolve_existing_image_generation_task(
    response_model,
    *,
    db: Session,
    task: ImageGenerationTask,
    current_user: User,
    request_fingerprint: str,
):
    if task.request_fingerprint != request_fingerprint:
        raise HTTPException(status_code=409, detail="request_id 已被另一组生图参数使用")
    if task.status == "succeeded":
        return _build_image_success_response_from_task(
            response_model,
            db=db,
            task=task,
            current_user=current_user,
        )
    if task.status in IMAGE_GENERATION_ACTIVE_STATUSES or task.settlement_status == "REVIEW_REQUIRED":
        raise HTTPException(
            status_code=423,
            detail=(
                f"生图请求 {task.request_id} 正在处理或结果未知；"
                "为避免重复生成和重复成本，已禁止自动重放，请联系管理员复核"
            ),
        )
    raise HTTPException(
        status_code=409,
        detail="该 request_id 已完成失败结算；如需重新生成，请使用新的 request_id",
    )


def _create_image_generation_intent(
    *,
    db: Session,
    current_user: User,
    request_id: str,
    entrypoint: str,
    template_id: Optional[str],
    selected_model: str,
    request_fingerprint: str,
    resolution: str,
    aspect_ratio: str,
    num_images: int,
) -> Tuple[ImageGenerationTask, bool]:
    idempotency_key = f"image-generate:{current_user.id}:{request_id}"
    orphan_hold = db.query(CreditTransaction).filter(
        CreditTransaction.idempotency_key == idempotency_key,
        CreditTransaction.type == "GENERATE_HOLD",
        CreditTransaction.status != "REFUNDED",
    ).first()
    if orphan_hold:
        raise HTTPException(
            status_code=423,
            detail=(
                "发现缺少任务记录的历史生图积分预占，供应商提交结果未知；"
                "为避免重复生成和重复成本，已停止自动重放"
            ),
        )

    task = ImageGenerationTask(
        task_id=uuid.uuid4().hex,
        request_id=request_id,
        user_id=current_user.id,
        hold_transaction_id=None,
        entrypoint=entrypoint,
        template_id=template_id,
        selected_model=selected_model,
        request_fingerprint=request_fingerprint,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        num_images=num_images,
        status="ready",
        settlement_status="PENDING",
    )
    try:
        db.add(task)
        db.flush()
        hold_txn = create_generation_hold(
            db,
            current_user,
            resolution=resolution,
            num_images=num_images,
            request_id=request_id,
            idempotency_key=idempotency_key,
            selected_model=selected_model,
        )
        task.hold_transaction_id = hold_txn.id
        db.add(task)
        db.commit()
        db.refresh(task)
        db.refresh(current_user)
        return task, True
    except ValueError:
        db.rollback()
        raise HTTPException(status_code=402, detail="积分不足，请充值")
    except IntegrityError:
        db.rollback()
        existing_task = _find_image_generation_task(
            db,
            user_id=current_user.id,
            request_id=request_id,
        )
        if existing_task:
            return existing_task, False
        raise HTTPException(status_code=409, detail="生图请求正在并发创建，请稍后查询")
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        print(f"⚠️ 生图任务初始化异常: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="生图任务初始化失败，积分未扣除")


def _set_image_task_unknown(
    db: Session,
    task: ImageGenerationTask,
    *,
    error_code: str,
) -> None:
    task.status = "submit_unknown"
    task.settlement_status = "REVIEW_REQUIRED"
    task.last_provider_error = _sanitized_upstream_error(error_code)
    task.error_message = "供应商提交结果未知；积分继续预占，禁止自动重放"
    db.add(task)
    db.commit()


def _settle_failed_image_task(
    db: Session,
    task: ImageGenerationTask,
    *,
    error_code: str,
) -> None:
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
    ).first()
    if hold_txn is None:
        task.status = "reconciliation_required"
        task.settlement_status = "REVIEW_REQUIRED"
        task.error_message = "生图积分预占记录缺失，需要管理员复核"
    else:
        settlement = refund_generation_hold(
            db,
            hold_txn,
            error_code=error_code,
            error_message=_sanitized_upstream_error(error_code),
        )
        if settlement.type != "GENERATE_REFUND":
            raise ValueError("积分预占已经按成功结果结算，需要管理员复核")
        task.status = "failed"
        task.settlement_status = "REFUNDED"
        task.finished_at = datetime.utcnow()
        task.last_provider_error = _sanitized_upstream_error(error_code)
        task.error_message = "供应商明确失败，积分已退回"
    db.add(task)
    db.commit()


def _complete_image_generation_task(
    response_model,
    *,
    db: Session,
    current_user: User,
    task: ImageGenerationTask,
    image_data: str,
    provider_name: str,
):
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
    ).first()
    if hold_txn is None:
        raise ValueError("生图积分预占记录缺失")
    image_url = (
        image_data
        if image_data.startswith(("http://", "https://", "data:"))
        else f"data:image/png;base64,{image_data}"
    )
    result_size_bytes = len(image_url.encode("utf-8"))
    if result_size_bytes > IMAGE_GENERATION_MAX_RESULT_BYTES:
        raise ValueError("生图结果超过本地安全持久化上限")
    settlement = capture_generation_hold(
        db,
        hold_txn,
        provider_meta={"channel": provider_name},
    )
    if settlement.type != "GENERATE_CAPTURE":
        raise ValueError("积分预占已经按失败结果退款，需要管理员复核")
    task.status = "succeeded"
    task.settlement_status = "CAPTURED"
    task.provider_name = provider_name
    task.image_url = image_url
    task.result_size_bytes = result_size_bytes
    result_ttl_seconds = max(
        86400,
        int(os.getenv("IMAGE_GENERATION_RESULT_TTL_SECONDS", str(7 * 86400))),
    )
    task.result_expires_at = datetime.utcnow() + timedelta(seconds=result_ttl_seconds)
    task.last_provider_error = None
    task.error_message = None
    task.finished_at = datetime.utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return _build_image_success_response_from_task(
        response_model,
        db=db,
        task=task,
        current_user=current_user,
    )


def _cleanup_expired_image_generation_results(db: Session) -> int:
    now = datetime.utcnow()
    deleted_count = db.query(ImageGenerationTask).filter(
        ImageGenerationTask.image_url.is_not(None),
        ImageGenerationTask.result_expires_at.is_not(None),
        ImageGenerationTask.result_expires_at <= now,
    ).update(
        {
            ImageGenerationTask.image_url: None,
            ImageGenerationTask.result_size_bytes: 0,
            ImageGenerationTask.result_expires_at: None,
        },
        synchronize_session=False,
    )
    if deleted_count:
        db.commit()
    return int(deleted_count or 0)


def _safe_update_image_generation_event(
    db: Session,
    *,
    request_id: str,
    user_id: int,
    entrypoint: str,
    status: str,
    provider_name: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    try:
        event = db.query(GenerationEvent).filter(
            GenerationEvent.request_id == request_id,
            GenerationEvent.user_id == user_id,
            GenerationEvent.entrypoint == entrypoint,
        ).order_by(GenerationEvent.id.desc()).first()
        if event is None:
            return
        event.status = status
        event.provider_name = provider_name
        event.error_code = error_code
        event.error_message = error_message
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()
        print("⚠️ 生图监控事件更新失败")


async def _run_durable_image_generation(
    response_model,
    *,
    db: Session,
    current_user: User,
    request_id: str,
    entrypoint: str,
    template_id: Optional[str],
    prompt: str,
    parts: List[dict],
    reference_images: List[str],
    resolution: str,
    aspect_ratio: str,
    selected_model: str,
    num_images: int,
    http_request: Request = None,
):
    if not _image_generation_feature_enabled():
        raise HTTPException(status_code=503, detail="生图功能正在维护")
    _cleanup_expired_image_generation_results(db)
    resolution, aspect_ratio, selected_model = _normalize_image_generation_inputs(
        prompt=prompt,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        selected_model=selected_model,
        num_images=num_images,
        reference_images=reference_images,
    )
    request_fingerprint = _image_generation_request_fingerprint(
        entrypoint=entrypoint,
        prompt=prompt,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        selected_model=selected_model,
        num_images=num_images,
        reference_images=reference_images,
    )
    existing_task = _find_image_generation_task(
        db,
        user_id=current_user.id,
        request_id=request_id,
    )
    if existing_task:
        return _resolve_existing_image_generation_task(
            response_model,
            db=db,
            task=existing_task,
            current_user=current_user,
            request_fingerprint=request_fingerprint,
        )

    try:
        check_and_increment_user_limit(
            db,
            current_user.id,
            "image_generate",
            int(os.getenv("IMAGE_GENERATE_USER_HOURLY_LIMIT", "12")),
            period="hour",
        )
        if http_request is not None:
            check_and_increment_ip_limit(
                db,
                extract_client_ip(http_request),
                "image_generate",
                int(os.getenv("IMAGE_GENERATE_IP_HOURLY_LIMIT", "30")),
                period="hour",
            )
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error))

    task, created = _create_image_generation_intent(
        db=db,
        current_user=current_user,
        request_id=request_id,
        entrypoint=entrypoint,
        template_id=template_id,
        selected_model=selected_model,
        request_fingerprint=request_fingerprint,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        num_images=num_images,
    )
    if not created:
        return _resolve_existing_image_generation_task(
            response_model,
            db=db,
            task=task,
            current_user=current_user,
            request_fingerprint=request_fingerprint,
        )

    task.status = "submitting"
    db.add(task)
    db.commit()
    safe_record_generation_event(
        db,
        request_id=request_id,
        user_id=current_user.id,
        entrypoint=entrypoint,
        template_id=template_id,
        selected_model=selected_model,
        provider_name=None,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        num_images=num_images,
        status="PENDING",
    )

    try:
        image_data, provider_name = await _request_image_from_channels(
            parts=parts,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            selected_model=selected_model,
            reference_images=reference_images,
            payload_log=(
                f"[IMAGE PAYLOAD] entrypoint={entrypoint}, template_id={template_id}, "
                f"selected_model={selected_model}, resolution={resolution}, "
                f"aspect_ratio={aspect_ratio}, dimensions={{width}}x{{height}}, "
                f"reference_count={len(reference_images)}"
            ),
            provider_idempotency_key=_image_provider_idempotency_key(
                user_id=current_user.id,
                request_id=request_id,
            ),
        )
    except asyncio.CancelledError:
        _set_image_task_unknown(db, task, error_code="UPSTREAM_TRANSPORT_UNKNOWN")
        raise
    except UpstreamGenerationError as error:
        if error.outcome_unknown:
            _set_image_task_unknown(db, task, error_code=error.error_code)
            _safe_update_image_generation_event(
                db,
                request_id=request_id,
                user_id=current_user.id,
                entrypoint=entrypoint,
                status="REVIEW_REQUIRED",
                error_code=error.error_code,
                error_message=_sanitized_upstream_error(error.error_code),
            )
            raise HTTPException(
                status_code=504,
                detail=(
                    "供应商提交结果未知，积分仍处于预占状态；"
                    "请勿使用同一 request_id 重试，并联系管理员复核"
                ),
            )
        try:
            _settle_failed_image_task(db, task, error_code=error.error_code)
        except Exception as settlement_error:
            db.rollback()
            task = _find_image_generation_task(
                db,
                user_id=current_user.id,
                request_id=request_id,
            )
            if task:
                _set_image_task_unknown(db, task, error_code="LOCAL_SETTLEMENT_UNKNOWN")
            print(f"⚠️ 生图失败结算异常: {type(settlement_error).__name__}")
            raise HTTPException(status_code=500, detail="生图失败结算需要管理员复核，积分仍处于预占状态")
        _safe_update_image_generation_event(
            db,
            request_id=request_id,
            user_id=current_user.id,
            entrypoint=entrypoint,
            status="FAILED",
            error_code=error.error_code,
            error_message=_sanitized_upstream_error(error.error_code),
        )
        status_code = 503 if error.error_code.startswith("UPSTREAM_HTTP_5") else 502
        raise HTTPException(status_code=status_code, detail="生图服务明确失败，积分已退回")

    try:
        response = _complete_image_generation_task(
            response_model,
            db=db,
            current_user=current_user,
            task=task,
            image_data=image_data,
            provider_name=provider_name,
        )
    except Exception as finalization_error:
        db.rollback()
        try:
            task = _find_image_generation_task(
                db,
                user_id=current_user.id,
                request_id=request_id,
            )
        except Exception:
            db.rollback()
            task = None

        # capture_generation_hold(), the task transition and result persistence
        # are committed atomically.  A refresh/serialization failure after that
        # commit must never downgrade the durable success to submit_unknown.
        if task and task.status == "succeeded" and task.settlement_status == "CAPTURED":
            try:
                response = _build_image_success_response_from_task(
                    response_model,
                    db=db,
                    task=task,
                    current_user=current_user,
                )
            except Exception as recovery_error:
                db.rollback()
                print(
                    "⚠️ 生图已完成结算，但响应构建失败: "
                    f"{type(recovery_error).__name__}"
                )
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "生图已完成并结算，但响应暂时无法返回；"
                        f"请使用同一 request_id（{request_id}）查询结果"
                    ),
                )
        else:
            if task:
                _set_image_task_unknown(db, task, error_code="LOCAL_FINALIZATION_UNKNOWN")
            print(f"⚠️ 生图本地落库/结算异常: {type(finalization_error).__name__}")
            raise HTTPException(
                status_code=500,
                detail="供应商已返回结果，但本地结算失败；积分仍处于预占状态，需要管理员复核",
            )

    _safe_update_image_generation_event(
        db,
        request_id=request_id,
        user_id=current_user.id,
        entrypoint=entrypoint,
        provider_name=provider_name,
        status="SUCCESS",
    )
    return response


async def _request_image_from_channels(
    *,
    parts: List[dict],
    resolution: str,
    aspect_ratio: str,
    selected_model: Optional[str],
    reference_images: Optional[List[str]] = None,
    payload_log: str,
    provider_idempotency_key: str,
) -> Tuple[str, str]:
    width: Union[int, str]
    height: Union[int, str]
    if _is_auto_aspect_ratio(aspect_ratio):
        width, height = "auto", "auto"
    else:
        width, height = get_dimensions_from_resolution_and_ratio(resolution, aspect_ratio)
    print(payload_log.format(width=width, height=height))

    channels = _select_api_channels_for_model(selected_model)
    if not channels:
        raise UpstreamGenerationError(
            last_error=None,
            error_code="UPSTREAM_CHANNEL_NOT_CONFIGURED",
            error_message=f"未找到适用于模型 {selected_model or 'default'} 的生图渠道",
        )

    # Synchronous image APIs cannot be reconciled by provider task id.  Never
    # switch channels after a timeout, transport break, 5xx, ambiguous 4xx, or
    # malformed success because the first relay may still complete and charge.
    # A second configured route is attempted only when the relay gives a clear
    # pre-acceptance rejection (auth, missing route/model, or rate limit).
    safe_failover_statuses = {401, 403, 404, 429}
    last_safe_error: Optional[UpstreamGenerationError] = None

    for channel_index, channel in enumerate(channels):
        print(
            f"尝试渠道: {channel.name} "
            f"(分辨率: {resolution}, 比例: {aspect_ratio}, 尺寸: {width}x{height})"
        )
        headers = {
            "Authorization": f"Bearer {channel.api_key}",
            "Idempotency-Key": provider_idempotency_key,
            "X-Request-Id": provider_idempotency_key,
        }
        try:
            if _is_openai_image_model(channel.model):
                openai_prompt = _build_prompt_text_from_parts(parts)
                if reference_images:
                    url = f"{channel.base_url}/v1/images/edits"
                    payload = {
                        "model": channel.model,
                        "prompt": openai_prompt,
                        "size": _resolve_openai_image_size(aspect_ratio),
                        "quality": _resolve_openai_image_quality(resolution),
                    }
                    request_kwargs = {
                        "data": payload,
                        "files": _build_openai_image_edit_files(reference_images),
                        "headers": headers,
                    }
                    timeout = 180.0
                else:
                    url = f"{channel.base_url}/v1/images/generations"
                    payload = {
                        "model": channel.model,
                        "prompt": openai_prompt,
                        "size": _resolve_openai_image_size(aspect_ratio),
                        "quality": _resolve_openai_image_quality(resolution),
                        "response_format": "b64_json",
                    }
                    request_kwargs = {
                        "json": payload,
                        "headers": {**headers, "Content-Type": "application/json"},
                    }
                    timeout = 120.0
            else:
                url = f"{channel.base_url}/v1/models/{channel.model}:generateContent"
                image_config = {"imageSize": resolution}
                if not _is_auto_aspect_ratio(aspect_ratio):
                    image_config["aspectRatio"] = aspect_ratio
                payload = {
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE"],
                        "responseFormat": {"image": image_config},
                    },
                }
                timeout = 60.0
                request_kwargs = {
                    "json": payload,
                    "headers": {**headers, "Content-Type": "application/json"},
                }
        except Exception as error:
            print(f"⚠️ 渠道 {channel.name} 请求构建失败: {type(error).__name__}")
            raise UpstreamGenerationError(
                last_error=error,
                error_code="UPSTREAM_REQUEST_INVALID",
                error_message="生图请求无法安全构建",
            ) from error

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, **request_kwargs)
        except httpx.TimeoutException as error:
            print(f"⚠️ 渠道 {channel.name} 响应超时；提交结果未知")
            raise UpstreamGenerationError(
                last_error=error,
                error_code="UPSTREAM_TIMEOUT",
                error_message="供应商响应超时，提交结果未知",
                outcome_unknown=True,
            ) from error
        except httpx.RequestError as error:
            print(f"⚠️ 渠道 {channel.name} 连接中断；提交结果未知: {type(error).__name__}")
            raise UpstreamGenerationError(
                last_error=error,
                error_code="UPSTREAM_TRANSPORT_UNKNOWN",
                error_message="供应商连接中断，提交结果未知",
                outcome_unknown=True,
            ) from error

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            error_code = f"UPSTREAM_HTTP_{response.status_code}"
            print(f"⚠️ 渠道 {channel.name} 返回 HTTP {response.status_code}")
            has_next_channel = channel_index + 1 < len(channels)
            if response.status_code in safe_failover_statuses and has_next_channel:
                last_safe_error = UpstreamGenerationError(
                    last_error=error,
                    error_code=error_code,
                    error_message=_sanitized_upstream_error(error_code),
                )
                print(f"渠道 {channel.name} 明确拒绝且未受理，安全切换备用渠道")
                continue
            outcome_unknown = response.status_code >= 500 or response.status_code in {408, 409, 425}
            raise UpstreamGenerationError(
                last_error=error,
                error_code=error_code,
                error_message=(
                    "供应商可能已受理请求，结果未知"
                    if outcome_unknown
                    else _sanitized_upstream_error(error_code)
                ),
                outcome_unknown=outcome_unknown,
            ) from error

        try:
            data = response.json()
            image_data = (
                _extract_openai_generated_image(data)
                if _is_openai_image_model(channel.model)
                else _extract_generated_image(data)
            )
        except Exception as error:
            print(f"⚠️ 渠道 {channel.name} 成功响应无法解析；结果未知")
            raise UpstreamGenerationError(
                last_error=error,
                error_code="UPSTREAM_RESPONSE_UNKNOWN",
                error_message="供应商成功响应无法解析，结果未知",
                outcome_unknown=True,
            ) from error
        if not image_data:
            raise UpstreamGenerationError(
                last_error=None,
                error_code="UPSTREAM_EMPTY_IMAGE",
                error_message="供应商响应中缺少图片，结果需要复核",
                outcome_unknown=True,
            )
        try:
            image_data = (
                await _download_remote_generated_image(image_data)
                if image_data.startswith("https://")
                else _normalize_generated_image_payload(image_data)
            )
        except Exception as error:
            print(f"⚠️ 渠道 {channel.name} 已生成图片但结果资产校验或固化失败")
            raise UpstreamGenerationError(
                last_error=error,
                error_code="UPSTREAM_IMAGE_ASSET_UNKNOWN",
                error_message="供应商已生成图片，但结果资产无法安全固化",
                outcome_unknown=True,
            ) from error
        print(f"渠道 {channel.name} 成功")
        return image_data, channel.name

    if last_safe_error is not None:
        raise last_safe_error
    raise UpstreamGenerationError(
        last_error=None,
        error_code="UPSTREAM_CHANNEL_NOT_CONFIGURED",
        error_message="没有可用的生图渠道",
    )


def _refund_generation_hold_safely(
    db: Session,
    hold_txn,
    *,
    error_code: str,
    error_message: str,
):
    if hold_txn is None or hold_txn.status != "PENDING":
        return

    try:
        settlement = refund_generation_hold(
            db,
            hold_txn,
            error_code=error_code,
            error_message=error_message,
        )
        if settlement.type != "GENERATE_REFUND":
            raise ValueError("积分预占已经按成功结果结算")
        db.commit()
    except Exception as error:
        db.rollback()
        print(f"⚠️ 积分预占安全退款异常: {type(error).__name__}")


def _build_generation_error(last_error, *, prefix: str) -> HTTPException:
    if isinstance(last_error, httpx.TimeoutException):
        return HTTPException(status_code=504, detail="生成超时，积分已退回，请稍后重试")
    if isinstance(last_error, httpx.HTTPStatusError) and last_error.response.status_code in (502, 503, 504):
        return HTTPException(status_code=503, detail="生成服务暂时不可用，积分已退回，请稍后重试")
    if last_error is None:
        return HTTPException(status_code=500, detail=f"{prefix}，积分已退回")
    return HTTPException(status_code=500, detail=f"{prefix}，积分已退回，请稍后重试")


def _build_generation_success_response(
    response_model,
    *,
    db: Session,
    current_user: User,
    hold_txn,
    request_id: str,
    image_data: str,
    provider_name: str,
):
    settlement = capture_generation_hold(
        db,
        hold_txn,
        provider_meta={"channel": provider_name},
    )
    if settlement.type != "GENERATE_CAPTURE":
        raise ValueError("积分预占已经按失败结果退款，需要管理员复核")
    db.commit()
    db.refresh(current_user)
    if image_data.startswith(("http://", "https://", "data:")):
        image_url = image_data
    else:
        image_url = f"data:image/png;base64,{image_data}"
    return response_model(
        image_url=image_url,
        timestamp=int(datetime.utcnow().timestamp() * 1000),
        charged_credits=abs(hold_txn.amount),
        remaining_credits=current_user.credits,
        request_id=request_id,
    )

DEFAULT_AUDIT_RESPONSE = {
    "is_pass": False,
    "positive_feedback": "图片已收到，但审核服务暂时不可用",
    "audit_report": {
        "consistency": "审核服务异常，请稍后重试",
        "visual_quality": "无法完成视觉质量检查",
        "hallucinations": "无法完成幻觉检测"
    },
    "ai_fix_prompts": "",
    "manual_fix_suggestions": ["请联系技术支持"]
}

@app.get("/api/v1/templates")
async def get_templates():
    """获取所有 Prompt 模版"""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)
        summaries = [serialize_template_summary(template) for template in templates]
        return JSONResponse(
            content={"templates": summaries, "total": len(summaries)},
            headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=3600"},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="模版服务暂时不可用")


@app.get("/api/v1/template-thumbnails/{filename}")
async def get_template_thumbnail(filename: str):
    """首页画廊缩略图，避免首屏直接加载原始大图。"""
    safe_filename = os.path.basename(filename)
    image_path = os.path.join("static", "template_images", safe_filename)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="缩略图源文件不存在")

    try:
        with Image.open(image_path) as img:
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "A" in img.getbands() else "RGB")

            max_width = 560
            if img.width > max_width:
                ratio = max_width / float(img.width)
                target_size = (max_width, max(1, int(img.height * ratio)))
                img = img.resize(target_size, Image.Resampling.LANCZOS)

            buffer = io.BytesIO()
            img.save(buffer, format="WEBP", quality=72, method=6)

        return Response(
            content=buffer.getvalue(),
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=2592000, stale-while-revalidate=86400"},
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="缩略图生成失败")

@app.get("/api/templates")
async def get_templates_v2():
    """Legacy public template list; prompt internals remain admin-only."""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        safe_templates = []
        for t in templates:
            safe_templates.append({
                'id': t['id'],
                'title': t['title'],
                'category': t.get('category_name', ''),
                'images': t['images'],
                'display_text': t.get('display_text', ''),
                'likes': t.get('likes', 0),
                'uses': t.get('uses', 0),
                'is_i2i': t.get('is_i2i', False)
            })

        return safe_templates
    except Exception:
        raise HTTPException(status_code=500, detail="模版服务暂时不可用")

@app.get("/api/v1/templates/{template_id}")
async def get_template_detail(template_id: str):
    """获取单个模版详情 - 已脱敏，不包含 prompt_structure"""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        template = next((t for t in templates if t['id'] == template_id), None)
        if not template:
            raise HTTPException(status_code=404, detail="模版不存在")

        return {
            'id': template['id'],
            'title': template['title'],
            'category': template.get('category_name', ''),
            'images': template['images'],
            'display_text': template.get('display_text', ''),
            'is_i2i': template.get('is_i2i', False),
            'likes': template.get('likes', 0),
            'uses': template.get('uses', 0)
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="模版服务暂时不可用")


@app.post(
    "/api/v1/templates/{template_id}/prompt-preview",
    response_model=TemplatePromptPreviewResponse,
)
async def preview_template_prompt(
    template_id: str,
    request: TemplatePromptPreviewRequest,
    current_user: User = Depends(get_current_user),
):
    del current_user
    try:
        with open("templates_v2.json", "r", encoding="utf-8") as template_file:
            templates = json.load(template_file)
        template = next((item for item in templates if item.get("id") == template_id), None)
        if not template:
            raise HTTPException(status_code=404, detail="模版不存在")

        if request.generation_mode == "generate_diagram":
            effective_prompt = _build_effective_diagram_prompt(
                template,
                parameters=request.parameters,
            )
            prompt_structure = None
        else:
            effective_prompt, prompt_structure = _build_effective_template_prompt(
                template,
                user_params=request.user_params,
                custom_prompt_structure=request.custom_prompt_structure,
                parameters=request.parameters,
            )
        if not effective_prompt:
            raise HTTPException(status_code=422, detail="模版提示词为空，请联系管理员补充")
        return TemplatePromptPreviewResponse(
            template_id=template_id,
            template_name=template.get("title", template_id),
            effective_prompt=effective_prompt,
            prompt_structure=prompt_structure,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="提示词预览失败")

def _keyword_match(query: str, templates: list):
    """关键词匹配降级方案"""
    query_lower = query.lower()
    keywords_map = {
        '场地': ['1.1', '1.2', '1.3'],
        '区位': ['1.1'],
        '日照': ['2.1'],
        '风': ['2.2'],
        '体块': ['3.1', '3.2'],
        '功能': ['4.1', '4.2'],
        '流线': ['5.1', '5.2'],
        '剖面': ['6.1', '6.2'],
        '植物': ['8.1', '8.2']
    }

    matched_ids = []
    for keyword, ids in keywords_map.items():
        if keyword in query_lower:
            matched_ids.extend(ids)

    matched_templates = [t for t in templates if t['id'] in matched_ids[:6]]
    reply_text = f"为您找到 {len(matched_templates)} 个相关模版" if matched_templates else "未找到匹配模版，显示推荐模版"

    if not matched_templates:
        matched_templates = templates[:6]

    return matched_templates, reply_text

@app.post("/api/v1/agent/chat")
async def agent_chat(
    request: AgentChatRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """智能接待Agent - 多轮对话 + 参数提取 MVP"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "agent_chat", FREE_AGENT_CHAT_DAILY_LIMIT, period="day")
        check_and_increment_user_limit(
            db,
            current_user.id,
            "agent_chat",
            FREE_AGENT_CHAT_DAILY_LIMIT,
            period="day",
        )

        # 1. 会话管理
        if request.session_id:
            session = _get_owned_chat_session(
                db,
                session_id=request.session_id,
                current_user=current_user,
                create=True,
            )
        else:
            session = _get_owned_chat_session(
                db,
                session_id=str(uuid.uuid4()),
                current_user=current_user,
                create=True,
            )
        db.commit()
        db.refresh(session)

        # 2. 加载历史和模版
        history = json.loads(session.chat_history)
        if not isinstance(history, list):
            history = []
        history = history[-20:]
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)
        
        # 3. 构建模版列表
        categories = {}
        for t in templates:
            cat = t.get('category_name', '')
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(f"{t['id']}: {t['title']}")
        template_list = "\n".join([f"{cat}: {', '.join(items[:6])}" for cat, items in sorted(categories.items())])

        # 4. System Prompt
        system_prompt = f"""你是 NeoVista 助手，专业但友好。

模版：
{template_list}

任务：
1. 理解需求，可适度闲聊
2. 推荐模版
3. 提取参数：{{title}}（标题）、{{data}}（数据）

JSON输出：
{{
  "reply_text": "回复",
  "template_ids": ["ID"],
  "collected_params": {{"title": null, "data": null}},
  "is_image_required": false,
  "image_upload_prompt": null
}}"""

        # 5. 调用LLM
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-20:])
        messages.append({"role": "user", "content": request.query})
        
        try:
            raw = await chat_flash(messages, json_mode=True)
            ai_response = json.loads(raw)
        except Exception as error:
            print(f"Flash失败: {type(error).__name__}")
            matched_templates, reply_text = _keyword_match(request.query, templates)
            ai_response = {"reply_text": reply_text, "template_ids": [t['id'] for t in matched_templates], "collected_params": {}, "is_image_required": False, "image_upload_prompt": None}

        # 6. 更新会话状态
        reply_text = ai_response.get('reply_text', '')
        template_ids = ai_response.get('template_ids', [])
        collected = ai_response.get('collected_params', {})
        
        if collected:
            existing = json.loads(session.collected_params or '{}')
            existing.update(collected)
            session.collected_params = json.dumps(existing)
        
        if template_ids:
            session.template_id = template_ids[0]

        # 7. 保存对话历史
        history.append({"role": "user", "content": request.query})
        history.append({"role": "assistant", "content": reply_text})
        session.chat_history = json.dumps(history[-20:])
        session.updated_at = datetime.utcnow()
        db.commit()
        
        # 8. 构建返回
        matched_templates = [t for t in templates if t['id'] in template_ids]
        safe_templates = [Template(id=t['id'], title=t['title'], category=t.get('category_name', ''), images=t['images'], display_text=t['display_text'], likes=t.get('likes', 0), uses=t.get('uses', 0)) for t in matched_templates]

        return AgentChatResponse(
            session_id=session.session_id,
            reply_text=reply_text,
            recommended_templates=safe_templates,
            is_image_required=ai_response.get('is_image_required', False),
            image_upload_prompt=ai_response.get('image_upload_prompt'),
            collected_params=json.loads(session.collected_params or '{}')
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as error:
        print(f"❌ agent_chat 错误: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="对话请求处理失败")


class DirectChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    messages: Optional[List[WorkspaceChatMessage]] = Field(default=None, max_length=10)
    image_data: Optional[str] = Field(default=None, max_length=16 * 1024 * 1024)
    image_datas: Optional[List[str]] = Field(default=None, max_length=9)

class DirectChatResponse(BaseModel):
    reply: str

@app.post("/api/v1/direct-chat")
async def direct_chat(
    request: DirectChatRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """普通对话接口 - 非 Agent，不涉及参数提炼或模板推荐"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "direct_chat", FREE_CHAT_DAILY_LIMIT, period="day")
        check_and_increment_user_limit(
            db,
            current_user.id,
            "direct_chat",
            FREE_CHAT_DAILY_LIMIT,
            period="day",
        )
        reference_images = _validate_chat_reference_images(
            _normalize_reference_images(
                image_data=request.image_data,
                image_datas=request.image_datas,
            )
        )
        conversation_messages = _trim_text_context_messages(request.messages)
        if not conversation_messages:
            conversation_messages = [WorkspaceChatMessage(role="user", content=request.message.strip())]

        latest_user_message = next(
            (message.content for message in reversed(conversation_messages) if message.role == "user"),
            request.message,
        )
        system_prompt = _build_direct_chat_system_prompt(latest_user_message)

        messages = [{"role": "system", "content": system_prompt}]
        last_index = len(conversation_messages) - 1
        for index, message in enumerate(conversation_messages):
            if message.role == "user" and index == last_index and reference_images:
                messages.append(_build_chat_user_message_with_images(message.content, reference_images))
            else:
                messages.append({"role": message.role, "content": message.content})

        if reference_images:
            prompt = _build_multimodal_prompt_from_messages(messages)
            reply_raw = await _chat_with_reference_images(
                prompt,
                reference_images,
            )
        else:
            reply_raw = await chat_flash(messages, json_mode=False)

        reply_text = await _enforce_reply_language(latest_user_message, reply_raw)

        return DirectChatResponse(reply=reply_text)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except llm_service.ChatProviderError:
        raise HTTPException(status_code=503, detail="对话服务暂时不可用，请稍后重试")
    except RuntimeError:
        raise HTTPException(status_code=503, detail="对话服务暂时不可用，请稍后重试")
    except Exception as error:
        print(f"❌ direct_chat 错误: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="对话请求处理失败")

@app.post("/api/v1/agent/workspace-chat")
async def workspace_chat(
    request: WorkspaceChatRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """画布对话Agent - Flash参数拆解 / Pro复杂图片分析"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "workspace_chat", FREE_AGENT_CHAT_DAILY_LIMIT, period="day")
        check_and_increment_user_limit(
            db,
            current_user.id,
            "workspace_chat",
            FREE_AGENT_CHAT_DAILY_LIMIT,
            period="day",
        )
        session = None
        if request.session_id:
            session = _get_owned_chat_session(
                db,
                session_id=request.session_id,
                current_user=current_user,
                create=True,
            )
            if session.id is None:
                db.commit()
                db.refresh(session)
        reference_images = _validate_chat_reference_images(
            _normalize_reference_images(
                image_data=request.image_data,
                image_datas=request.image_datas,
            )
        )

        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        # 构建模版列表供AI参考 - 按分类分组
        categories = {}
        for t in templates:
            cat = t.get('category_name', t.get('category_id', ''))
            if cat not in categories:
                categories[cat] = []
            categories[cat].append(f"{t['id']}: {t['title']}")

        template_list = "\n".join([
            f"分类 {cat}: {', '.join(items[:8])}{'...' if len(items) > 8 else ''}"
            for cat, items in sorted(categories.items())
        ])

        workspace_system = f"""你是NeoVista画布工作区的AI参数提炼师。你的职责是通过对话帮助用户明确生图参数。

可用模版列表：
{template_list}

工作流程：
1. 理解用户的设计意图
2. 推荐合适的模版（如果用户还没选择）
3. 提炼两个核心参数：
   - title: 图纸标题（如"场地肌理分析"、"日照分析图"）
   - data: 具体数据标注（如"夏至日照时长8h"、"主入口宽度12m"）
4. 当 title 和 data 都已明确时，设置 ready_to_generate=true

你必须返回JSON格式：
{{
  "reply": "你的回复文本",
  "ready_to_generate": true或false,
  "suggested_template_id": "推荐的模版ID或null",
  "suggested_params": {{
    "title": "图纸标题",
    "data": "数据标注"
  }}
}}

注意：
- 只有当 title 和 data 都已确认时，才设 ready_to_generate=true
- 如果参数还不够明确，设 ready_to_generate=false，继续追问
- 回复要简洁专业，像一个资深建筑设计顾问
- 如果用户本轮消息主要是中文，reply 必须用中文
- 如果用户本轮消息主要是英文或其他非中文语言，reply 可以按用户语言回答，但必须附带中文翻译，格式为“中文翻译：...”"""

        # 构建消息：system + 用户对话历史（限20轮）
        trimmed = _trim_text_context_messages(
            request.messages,
            max_messages=10,
            max_total_chars=4000,
        )
        messages = [{"role": "system", "content": workspace_system}]
        last_index = len(trimmed) - 1
        for index, m in enumerate(trimmed):
            if m.role in ("user", "assistant"):
                if m.role == "user" and index == last_index and reference_images:
                    messages.append(_build_chat_user_message_with_images(m.content, reference_images))
                else:
                    messages.append({"role": m.role, "content": m.content})

        # 工作区聊天按 Agent 模式显式选择渠道；复杂视觉审图由单独接口承担
        model_used = select_workspace_chat_model(
            request.agent_mode,
            has_reference_images=bool(reference_images),
        )

        if reference_images:
            multimodal_prompt = _build_multimodal_prompt_from_messages(messages)
            reply_raw = await _chat_with_reference_images(
                multimodal_prompt,
                reference_images,
                json_mode=True,
            )
        elif model_used == "pro":
            reply_raw = await chat_pro(messages)
        else:
            reply_raw = await chat_flash(messages, json_mode=True)

        # 尝试解析 JSON
        try:
            parsed = _parse_json_object_response(reply_raw)
            reply_text = await _enforce_reply_language(request.messages[-1].content if request.messages else "", parsed.get("reply", reply_raw))
            ready = parsed.get("ready_to_generate", False)
            tpl_id = parsed.get("suggested_template_id")
            params = parsed.get("suggested_params")
        except (json.JSONDecodeError, ValueError):
            reply_text = await _enforce_reply_language(request.messages[-1].content if request.messages else "", reply_raw)
            ready = False
            tpl_id = None
            params = None

        # 保存参数到数据库
        if session is not None:
            if tpl_id:
                session.template_id = tpl_id
            if params:
                session.collected_params = json.dumps(params, ensure_ascii=False)
            db.commit()
            db.refresh(session)

        return WorkspaceChatResponse(
            reply=reply_text,
            model_used=model_used,
            ready_to_generate=ready,
            suggested_template_id=tpl_id,
            suggested_params=params,
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except llm_service.ChatProviderError:
        raise HTTPException(status_code=503, detail="对话服务暂时不可用，请稍后重试")
    except RuntimeError:
        raise HTTPException(status_code=503, detail="对话服务暂时不可用，请稍后重试")
    except Exception as error:
        print(f"❌ workspace_chat 错误: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="对话请求处理失败")

@app.post("/api/v1/video/reference-upload", response_model=ReferenceVideoUploadResponse)
async def upload_seedance_reference_video(
    http_request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if os.getenv("SEEDANCE_FEATURE_ENABLED", "false").strip().lower() not in {"1", "true", "yes"}:
        await file.close()
        raise HTTPException(status_code=503, detail="Seedance 视频功能正在维护，暂不接受参考视频")

    try:
        check_and_increment_user_limit(
            db,
            current_user.id,
            "video_reference_upload",
            int(os.getenv("VIDEO_REFERENCE_UPLOAD_USER_HOURLY_LIMIT", "30")),
            period="hour",
        )
        check_and_increment_ip_limit(
            db,
            extract_client_ip(http_request),
            "video_reference_upload",
            int(os.getenv("VIDEO_REFERENCE_UPLOAD_IP_HOURLY_LIMIT", "60")),
            period="hour",
        )
    except ValueError as error:
        await file.close()
        raise HTTPException(status_code=429, detail=str(error))

    original_filename = os.path.basename(file.filename or "")[:255]
    extension = os.path.splitext(original_filename)[1].lower()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    allowed_mime_types = SEEDANCE_REFERENCE_VIDEO_MIME_TYPES.get(extension)
    if not allowed_mime_types or (
        content_type
        and content_type != "application/octet-stream"
        and content_type not in allowed_mime_types
    ):
        await file.close()
        raise HTTPException(status_code=400, detail="参考视频仅支持 MP4、WebM 或 MOV 格式")

    target_dir = os.path.join("static", "seedance_references")
    os.makedirs(target_dir, exist_ok=True)
    os.chmod(target_dir, 0o755)
    safe_filename = f"{uuid.uuid4().hex}{extension}"
    target_path = os.path.join(target_dir, safe_filename)
    temporary_path = f"{target_path}.part"
    size_bytes = 0
    header = bytearray()

    try:
        with open(temporary_path, "xb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > SEEDANCE_REFERENCE_VIDEO_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="参考视频不能超过 24MB")
                if len(header) < 64:
                    header.extend(chunk[:64 - len(header)])
                output.write(chunk)
        if size_bytes == 0:
            raise HTTPException(status_code=400, detail="参考视频文件为空")
        _validate_seedance_reference_video_signature(extension, bytes(header))
        os.replace(temporary_path, target_path)
        os.chmod(target_path, 0o644)
    except Exception:
        with suppress(FileNotFoundError):
            os.remove(temporary_path)
        with suppress(FileNotFoundError):
            os.remove(target_path)
        raise
    finally:
        await file.close()

    public_base_url = _build_public_base_url(http_request)
    return ReferenceVideoUploadResponse(
        video_url=f"{public_base_url}/static/seedance_references/{safe_filename}",
        filename=original_filename,
        size_bytes=size_bytes,
    )


@app.post("/api/v1/video/generate")
async def create_video_generation_task(
    request: VideoGenerateRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    request_id = request.request_id or str(uuid.uuid4())
    duration_seconds = request.duration_seconds if request.duration_seconds is not None else 5
    generate_audio = bool(request.generate_audio)
    aspect_ratio = _normalize_seedance_aspect_ratio(request.aspect_ratio)
    selected_model = _normalize_seedance_selected_model(request.selected_model)
    prompt = _build_seedance_prompt(
        request.prompt,
        aspect_ratio=aspect_ratio,
        duration_seconds=duration_seconds,
    )
    raw_reference_images = _normalize_reference_images(
        image_data=request.image_data,
        image_datas=request.image_datas,
    )
    reference_video_url = _normalize_seedance_reference_video_url(request.reference_video_url)
    video_mode = _normalize_seedance_video_mode(
        request.video_mode,
        image_count=len(raw_reference_images),
        has_reference_video=bool(reference_video_url),
    )
    _validate_seedance_media_mode(video_mode, len(raw_reference_images), reference_video_url)
    try:
        resolution = normalize_video_resolution(request.resolution, selected_model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    request_fingerprint = _seedance_request_fingerprint(
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        duration_seconds=duration_seconds,
        selected_model=selected_model,
        video_mode=video_mode,
        reference_images=raw_reference_images,
        reference_video_url=reference_video_url,
        generate_audio=generate_audio,
    )
    legacy_request_fingerprint = _seedance_request_fingerprint(
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        duration_seconds=duration_seconds,
        selected_model=selected_model,
        video_mode=video_mode,
        reference_images=raw_reference_images,
        reference_video_url=reference_video_url,
    )
    idempotency_key = f"video-generate:{current_user.id}:{request_id}"

    existing_task = _find_video_task_by_request_id(db, user_id=current_user.id, request_id=request_id)
    if existing_task:
        fingerprint_mismatch = (
            existing_task.request_fingerprint is not None
            and existing_task.request_fingerprint
            not in {request_fingerprint, legacy_request_fingerprint}
        )
        legacy_mismatch = existing_task.request_fingerprint is None and any((
            existing_task.prompt != prompt,
            existing_task.aspect_ratio != aspect_ratio,
            existing_task.resolution != resolution,
            existing_task.duration_seconds != duration_seconds,
            existing_task.selected_model != selected_model,
        ))
        if fingerprint_mismatch or legacy_mismatch:
            raise HTTPException(status_code=409, detail="request_id 已被另一组视频参数使用")
        return _build_video_task_response_from_record(db, existing_task, current_user)

    if os.getenv("SEEDANCE_FEATURE_ENABLED", "false").strip().lower() not in {"1", "true", "yes"}:
        raise HTTPException(status_code=503, detail="Seedance 视频功能正在维护，暂不接受新任务")

    unresolved_task = (
        db.query(VideoGenerationTask)
        .filter(
            VideoGenerationTask.user_id == current_user.id,
            func.lower(VideoGenerationTask.status).in_(
                set(SEEDANCE_ACTIVE_STATUSES) | {"reconciliation_required"}
            ),
        )
        .order_by(VideoGenerationTask.created_at.desc())
        .first()
    )
    if unresolved_task:
        raise HTTPException(
            status_code=423,
            detail=f"已有未结束的 Seedance 任务，请先恢复任务 {unresolved_task.task_id}",
        )

    # Fail before reserving credits or publishing reference files when the provider
    # configuration is invalid. These helpers intentionally do not expose secrets.
    _get_seedance_api_key()
    _get_seedance_base_url()
    provider_model = _get_seedance_model(selected_model)

    existing_hold = db.query(CreditTransaction).filter(
        CreditTransaction.idempotency_key == idempotency_key,
        CreditTransaction.type == "GENERATE_HOLD",
        CreditTransaction.status != "REFUNDED",
    ).first()
    try:
        estimated_cost = calculate_video_generation_cost(
            duration_seconds,
            selected_model,
            resolution,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if existing_hold and any((
        existing_hold.status != "PENDING",
        existing_hold.user_id != current_user.id,
        existing_hold.related_request_id != request_id,
        abs(existing_hold.amount) != estimated_cost,
    )):
        raise HTTPException(
            status_code=409,
            detail="发现与当前参数不一致的历史积分预占，请联系管理员复核后再提交",
        )
    if existing_hold:
        raise HTTPException(
            status_code=423,
            detail=(
                "发现缺少任务记录的历史积分预占，供应商提交结果未知；"
                "为避免重复生成和重复成本，已停止自动重放，请联系管理员复核"
            ),
        )
    db.refresh(current_user)
    if existing_hold is None and current_user.credits < estimated_cost:
        raise HTTPException(status_code=402, detail="积分不足，请充值")

    try:
        check_and_increment_user_limit(
            db,
            current_user.id,
            "video_generate",
            int(os.getenv("VIDEO_GENERATE_USER_HOURLY_LIMIT", "12")),
            period="hour",
        )
        check_and_increment_ip_limit(
            db,
            extract_client_ip(http_request),
            "video_generate",
            int(os.getenv("VIDEO_GENERATE_IP_HOURLY_LIMIT", "30")),
            period="hour",
        )
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error))

    has_local_reference_images = any(
        not image.strip().startswith(("http://", "https://"))
        for image in raw_reference_images
    )
    public_base_url = _build_public_base_url(http_request) if has_local_reference_images else ""
    saved_reference_paths: List[str] = []
    try:
        local_reference_video_path = _seedance_local_reference_path_from_url(reference_video_url)
        if local_reference_video_path:
            saved_reference_paths.append(local_reference_video_path)
        reference_images = [
            _save_seedance_reference_image(
                image_data,
                index=index,
                public_base_url=public_base_url,
                saved_paths=saved_reference_paths,
            )
            for index, image_data in enumerate(raw_reference_images, start=1)
        ]
        total_reference_bytes = sum(
            os.path.getsize(path) for path in saved_reference_paths if os.path.exists(path)
        )
        max_total_bytes = int(
            os.getenv("SEEDANCE_REFERENCE_TOTAL_MAX_BYTES", str(36 * 1024 * 1024))
        )
        if total_reference_bytes > max_total_bytes:
            raise HTTPException(status_code=413, detail="Seedance 参考图总大小过大，请减少图片或压缩后重试")
    except Exception:
        _cleanup_seedance_reference_paths(saved_reference_paths)
        raise

    created_new_hold = existing_hold is None
    hold_txn = existing_hold
    task = None
    try:
        if hold_txn is None:
            hold_txn = create_video_generation_hold(
                db,
                current_user,
                duration_seconds=duration_seconds,
                resolution=resolution,
                request_id=request_id,
                idempotency_key=idempotency_key,
                selected_model=selected_model,
            )

        task = VideoGenerationTask(
            task_id=uuid.uuid4().hex,
            provider_task_id=None,
            request_id=request_id,
            user_id=current_user.id,
            hold_transaction_id=hold_txn.id,
            selected_model=selected_model,
            provider_model=provider_model,
            api_format="v3",
            prompt=prompt,
            request_fingerprint=request_fingerprint,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration_seconds=duration_seconds,
            status="ready",
            settlement_status="PENDING",
            reference_paths=_serialize_seedance_reference_state(
                local_paths=saved_reference_paths,
                image_urls=reference_images,
                video_mode=video_mode,
                generate_audio=generate_audio,
                reference_video_url=reference_video_url,
            ),
            attempt_count=0,
            next_poll_at=None,
            deadline_at=_seedance_task_deadline(),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
    except IntegrityError:
        db.rollback()
        _cleanup_seedance_reference_paths(saved_reference_paths)
        existing_task = _find_video_task_by_request_id(
            db,
            user_id=current_user.id,
            request_id=request_id,
        )
        if existing_task:
            return _build_video_task_response_from_record(db, existing_task, current_user)
        unresolved_task = (
            db.query(VideoGenerationTask)
            .filter(
                VideoGenerationTask.user_id == current_user.id,
                func.lower(VideoGenerationTask.status).in_(
                    set(SEEDANCE_ACTIVE_STATUSES) | {"reconciliation_required"}
                ),
            )
            .order_by(VideoGenerationTask.created_at.desc())
            .first()
        )
        if unresolved_task:
            raise HTTPException(
                status_code=423,
                detail=f"已有未结束的 Seedance 任务，请先恢复任务 {unresolved_task.task_id}",
            )
        raise HTTPException(status_code=409, detail="视频任务正在提交，请稍后重试")
    except ValueError as error:
        db.rollback()
        _cleanup_seedance_reference_paths(saved_reference_paths)
        if str(error) == "积分不足":
            raise HTTPException(status_code=402, detail="积分不足，请充值")
        raise HTTPException(status_code=400, detail=str(error))
    except Exception:
        existing_hold_id = hold_txn.id if hold_txn is not None else None
        db.rollback()
        _cleanup_seedance_reference_paths(saved_reference_paths)
        if not created_new_hold and existing_hold_id is not None:
            persisted_hold = db.query(CreditTransaction).filter(
                CreditTransaction.id == existing_hold_id,
            ).first()
        else:
            persisted_hold = None
        if persisted_hold and persisted_hold.status == "PENDING":
            _refund_generation_hold_safely(
                db,
                persisted_hold,
                error_code="SEEDANCE_INTENT_PERSIST_FAILED",
                error_message="视频任务本地记录创建失败",
            )
        raise HTTPException(status_code=500, detail="视频任务初始化失败，积分未扣除或已退回")

    safe_record_generation_event_isolated(
        SessionLocal,
        request_id=request_id,
        user_id=current_user.id,
        entrypoint="video_generate",
        template_id=None,
        selected_model=selected_model,
        provider_name="Seedance",
        resolution=resolution,
        aspect_ratio=aspect_ratio,
        num_images=len(reference_images),
        status="PENDING",
    )

    task = await _submit_seedance_task_record(db, task)
    return _build_video_task_response_from_record(db, task, current_user)


def _build_video_model_capability(selected_model: str) -> VideoModelCapability:
    normalized_model = _normalize_seedance_selected_model(selected_model)
    min_duration, max_duration = get_video_duration_limits(normalized_model)
    return VideoModelCapability(
        id=normalized_model,
        label={
            "seedance-2.0": "Seedance 2.0",
            "seedance-2.5": "Seedance 2.5",
        }[normalized_model],
        min_duration_seconds=min_duration,
        max_duration_seconds=max_duration,
        default_resolution=DEFAULT_SEEDANCE_RESOLUTION,
        resolution_credits_per_second=dict(
            get_video_resolution_pricing(normalized_model)
        ),
        aspect_ratios=list(SEEDANCE_ASPECT_RATIOS),
        max_reference_images=9,
        supports_reference_video=True,
        max_reference_video_bytes=SEEDANCE_REFERENCE_VIDEO_MAX_BYTES,
        max_reference_video_duration_seconds=(
            30 if normalized_model == "seedance-2.5" else 15
        ),
    )


@app.get("/api/v1/video/capabilities", response_model=VideoCapabilitiesResponse)
async def get_video_capabilities():
    enabled = os.getenv("SEEDANCE_FEATURE_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
    disabled_reason = None
    if enabled:
        try:
            _get_seedance_api_key()
            _get_seedance_base_url()
            _get_seedance_model("seedance-2.0")
            _get_seedance_model("seedance-2.5")
            _build_public_base_url()
        except HTTPException:
            enabled = False
            disabled_reason = "Seedance 服务配置尚未就绪"
    else:
        disabled_reason = "Seedance 视频功能正在维护"
    return VideoCapabilitiesResponse(
        enabled=enabled,
        disabled_reason=disabled_reason,
        model="seedance-2.0",
        min_duration_seconds=MIN_VIDEO_DURATION_SECONDS,
        max_duration_seconds=MAX_VIDEO_DURATION_SECONDS,
        default_resolution=DEFAULT_SEEDANCE_RESOLUTION,
        resolution_credits_per_second=dict(SEEDANCE_RESOLUTION_CREDITS_PER_SECOND),
        aspect_ratios=list(SEEDANCE_ASPECT_RATIOS),
        max_reference_images=9,
        supports_reference_video=True,
        max_reference_video_bytes=SEEDANCE_REFERENCE_VIDEO_MAX_BYTES,
        max_reference_video_duration_seconds=15,
        models=[
            _build_video_model_capability("seedance-2.0"),
            _build_video_model_capability("seedance-2.5"),
        ],
    )


@app.get("/api/v1/video/tasks", response_model=List[VideoTaskResponse])
async def list_video_generation_tasks(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tasks = (
        db.query(VideoGenerationTask)
        .filter(VideoGenerationTask.user_id == current_user.id)
        .order_by(VideoGenerationTask.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [_build_video_task_response_from_record(db, task, current_user) for task in tasks]


@app.get("/api/v1/video/tasks/by-request/{request_id}", response_model=VideoTaskResponse)
async def get_video_generation_task_by_request_id(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not 8 <= len(request_id) <= 64 or not re.fullmatch(r"[A-Za-z0-9._:-]+", request_id):
        raise HTTPException(status_code=400, detail="无效的视频请求 ID")
    task = _find_video_task_by_request_id(
        db,
        user_id=current_user.id,
        request_id=request_id,
    )
    if not task:
        raise HTTPException(status_code=404, detail="视频任务不存在")
    return _build_video_task_response_from_record(db, task, current_user)


@app.get("/api/v1/video/tasks/{task_id}")
async def get_video_generation_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.query(VideoGenerationTask).filter(
        VideoGenerationTask.task_id == task_id,
        VideoGenerationTask.user_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="视频任务不存在")
    if task.status in SEEDANCE_ACTIVE_STATUSES:
        task = await _reconcile_seedance_task_record(db, task)
    return _build_video_task_response_from_record(db, task, current_user)


@app.post("/api/v1/admin/video/reconcile")
async def admin_reconcile_video_generation_tasks(
    limit: int = 20,
    wait: bool = False,
    admin_user: User = Depends(verify_admin_access),
    db: Session = Depends(get_db),
):
    bounded_limit = max(1, min(limit, 100))
    db.add(AdminAuditLog(
        actor_user_id=admin_user.id,
        action="VIDEO_RECONCILE_REQUEST",
        details=json.dumps({"limit": bounded_limit, "wait": bool(wait)}, ensure_ascii=False),
    ))
    db.commit()
    reconcile_job = _reconcile_pending_seedance_tasks_once(
        limit=bounded_limit,
        include_review_required=True,
    )
    if wait:
        reconciled = await reconcile_job
        return {"ok": True, "queued": False, "reconciled": reconciled}

    task = asyncio.create_task(reconcile_job)
    _seedance_admin_reconcile_jobs.add(task)
    task.add_done_callback(_seedance_admin_reconcile_jobs.discard)
    return {"ok": True, "queued": True, "limit": bounded_limit}


@app.get("/api/v1/admin/video/reviews")
async def admin_list_video_generation_reviews(
    limit: int = 50,
    admin_user: User = Depends(verify_admin_access),
    db: Session = Depends(get_db),
):
    bounded_limit = max(1, min(limit, 100))
    orphan_holds = (
        db.query(CreditTransaction)
        .outerjoin(
            VideoGenerationTask,
            VideoGenerationTask.hold_transaction_id == CreditTransaction.id,
        )
        .filter(
            CreditTransaction.type == "GENERATE_HOLD",
            CreditTransaction.status == "PENDING",
            CreditTransaction.idempotency_key.like("video-generate:%"),
            VideoGenerationTask.id.is_(None),
        )
        .order_by(CreditTransaction.created_at.asc())
        .limit(bounded_limit)
        .all()
    )
    remaining_limit = max(0, bounded_limit - len(orphan_holds))
    tasks = (
        db.query(VideoGenerationTask)
        .filter(
            or_(
                VideoGenerationTask.status == "reconciliation_required",
                VideoGenerationTask.settlement_status == "REVIEW_REQUIRED",
            )
        )
        .order_by(VideoGenerationTask.created_at.asc())
        .limit(remaining_limit)
        .all()
    )
    items = [
        {
            "task_id": None,
            "provider_task_id": None,
            "request_id": hold.related_request_id,
            "user_id": hold.user_id,
            "status": "missing_task",
            "settlement_status": "REVIEW_REQUIRED",
            "hold_status": hold.status,
            "reserved_credits": abs(hold.amount),
            "last_provider_error": None,
            "error_message": "视频积分预占缺少任务记录，供应商提交结果未知",
            "created_at": hold.created_at.isoformat() if hold.created_at else None,
            "deadline_at": None,
        }
        for hold in orphan_holds
    ]
    for task in tasks:
        hold = db.query(CreditTransaction).filter(
            CreditTransaction.id == task.hold_transaction_id,
        ).first()
        items.append({
            "task_id": task.task_id,
            "provider_task_id": task.provider_task_id,
            "request_id": task.request_id,
            "user_id": task.user_id,
            "status": task.status,
            "settlement_status": task.settlement_status,
            "hold_status": hold.status if hold else "MISSING",
            "reserved_credits": abs(hold.amount) if hold else None,
            "last_provider_error": task.last_provider_error,
            "error_message": task.error_message,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "deadline_at": task.deadline_at.isoformat() if task.deadline_at else None,
        })
    return {"count": len(items), "items": items}


@app.get("/api/v1/admin/image/reviews")
async def admin_list_image_generation_reviews(
    limit: int = 50,
    admin_user: User = Depends(verify_admin_access),
    db: Session = Depends(get_db),
):
    bounded_limit = max(1, min(limit, 100))
    legacy_or_current_image_hold = or_(
        CreditTransaction.idempotency_key.like("image-generate:%"),
        CreditTransaction.idempotency_key.like("generate:%"),
        CreditTransaction.idempotency_key.like("generate-diagram:%"),
    )
    orphan_holds = (
        db.query(CreditTransaction)
        .outerjoin(
            ImageGenerationTask,
            ImageGenerationTask.hold_transaction_id == CreditTransaction.id,
        )
        .filter(
            CreditTransaction.type == "GENERATE_HOLD",
            CreditTransaction.status == "PENDING",
            legacy_or_current_image_hold,
            ImageGenerationTask.id.is_(None),
        )
        .order_by(CreditTransaction.created_at.asc())
        .limit(bounded_limit)
        .all()
    )
    remaining_limit = max(0, bounded_limit - len(orphan_holds))
    tasks = (
        db.query(ImageGenerationTask)
        .filter(
            or_(
                func.lower(ImageGenerationTask.status).in_(IMAGE_GENERATION_ACTIVE_STATUSES),
                ImageGenerationTask.status == "reconciliation_required",
                ImageGenerationTask.settlement_status == "REVIEW_REQUIRED",
            )
        )
        .order_by(ImageGenerationTask.created_at.asc())
        .limit(remaining_limit)
        .all()
    )
    items = [
        {
            "task_id": None,
            "request_id": hold.related_request_id,
            "user_id": hold.user_id,
            "entrypoint": None,
            "status": "missing_task",
            "settlement_status": "REVIEW_REQUIRED",
            "hold_status": hold.status,
            "reserved_credits": abs(hold.amount),
            "last_provider_error": None,
            "error_message": "生图积分预占缺少任务记录，供应商提交结果未知",
            "created_at": hold.created_at.isoformat() if hold.created_at else None,
        }
        for hold in orphan_holds
    ]
    for task in tasks:
        hold = db.query(CreditTransaction).filter(
            CreditTransaction.id == task.hold_transaction_id,
        ).first()
        items.append({
            "task_id": task.task_id,
            "request_id": task.request_id,
            "user_id": task.user_id,
            "entrypoint": task.entrypoint,
            "status": task.status,
            "settlement_status": task.settlement_status,
            "hold_status": hold.status if hold else "MISSING",
            "reserved_credits": abs(hold.amount) if hold else None,
            "last_provider_error": task.last_provider_error,
            "error_message": task.error_message,
            "created_at": task.created_at.isoformat() if task.created_at else None,
        })
    return {"count": len(items), "items": items}


@app.post("/api/v1/admin/image/reviews/{task_id}/settle")
async def admin_settle_image_generation_review(
    task_id: str,
    request: AdminImageSettlementRequest,
    current_user: User = Depends(get_current_user),
    x_admin_token: str = Header(None),
    db: Session = Depends(get_db),
):
    if x_admin_token != ADMIN_SECRET_KEY:
        raise HTTPException(status_code=401, detail="无效的管理员令牌")
    actor = db.merge(current_user)
    if not actor.is_admin:
        raise HTTPException(status_code=403, detail="审计操作人不是有效管理员")
    task = db.query(ImageGenerationTask).filter(
        ImageGenerationTask.task_id == task_id,
    ).first()
    if task is None:
        raise HTTPException(status_code=404, detail="生图复核任务不存在")
    explicitly_reviewable = (
        task.settlement_status == "REVIEW_REQUIRED"
        or task.status == "reconciliation_required"
    )
    stale_active = (
        task.status in IMAGE_GENERATION_ACTIVE_STATUSES
        and task.created_at is not None
        and (datetime.utcnow() - task.created_at).total_seconds()
        >= max(60, int(os.getenv("IMAGE_READY_MAX_ACTIVE_AGE_SECONDS", "600")))
    )
    already_settled = task.settlement_status in {"CAPTURED", "REFUNDED"}
    if not explicitly_reviewable and not stale_active and not already_settled:
        raise HTTPException(status_code=409, detail="该生图任务当前不处于人工复核状态")
    hold_txn = db.query(CreditTransaction).filter(
        CreditTransaction.id == task.hold_transaction_id,
        CreditTransaction.type == "GENERATE_HOLD",
        CreditTransaction.user_id == task.user_id,
    ).first()
    if hold_txn is None:
        raise HTTPException(status_code=409, detail="生图积分预占记录缺失，无法自动结算")

    settlement_key = f"generation-hold:{hold_txn.id}:settlement"
    existing_settlement = db.query(CreditTransaction).filter(
        CreditTransaction.settlement_key == settlement_key,
        CreditTransaction.status == "SUCCESS",
    ).first()
    expected_type = "GENERATE_CAPTURE" if request.action == "capture" else "GENERATE_REFUND"
    if existing_settlement is not None and existing_settlement.type != expected_type:
        raise HTTPException(status_code=409, detail="该预占已按相反方向结算，拒绝覆盖")

    try:
        if existing_settlement is None:
            if request.action == "capture":
                settlement = capture_generation_hold(
                    db,
                    hold_txn,
                    provider_meta={"manual_review": True},
                )
            else:
                settlement = refund_generation_hold(
                    db,
                    hold_txn,
                    error_code="ADMIN_REVIEW_REFUND",
                    error_message="管理员复核后显式退款",
                )
        else:
            settlement = existing_settlement

        if settlement.type != expected_type:
            raise HTTPException(status_code=409, detail="该预占已按相反方向结算，拒绝覆盖")

        if request.action == "capture":
            task.status = "settled_without_result" if not task.image_url else "succeeded"
            task.settlement_status = "CAPTURED"
        else:
            task.status = "failed"
            task.settlement_status = "REFUNDED"
        task.finished_at = task.finished_at or datetime.utcnow()
        task.error_message = f"管理员显式{request.action}：{request.reason}"
        db.add(task)
        db.add(AdminAuditLog(
            actor_user_id=actor.id,
            action=f"IMAGE_REVIEW_{request.action.upper()}",
            details=json.dumps(
                {
                    "task_id": task.task_id,
                    "request_id": task.request_id,
                    "hold_transaction_id": hold_txn.id,
                    "settlement_transaction_id": settlement.transaction_id,
                    "reason": request.reason,
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
        ))
        db.commit()
        user = db.query(User).filter(User.id == task.user_id).first()
        return {
            "ok": True,
            "task_id": task.task_id,
            "request_id": task.request_id,
            "action": request.action,
            "status": task.status,
            "settlement_status": task.settlement_status,
            "hold_status": hold_txn.status,
            "remaining_credits": user.credits if user else None,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as error:
        db.rollback()
        print(f"⚠️ 管理员生图结算失败: {type(error).__name__}")
        raise HTTPException(status_code=409, detail="管理员结算失败，数据库未提交任何部分结果")


@app.post("/api/v1/generate")
async def generate_image(
    request: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    reference_images = _normalize_reference_images(
        image_data=request.image_data,
        image_datas=request.image_datas,
    )

    request_id = request.request_id or str(uuid.uuid4())

    # 根据 template_id 查询模版（支持 null）
    try:
        if request.template_id:
            # 有模板：使用模板逻辑
            with open('templates_v2.json', 'r', encoding='utf-8') as f:
                templates = json.load(f)

            template = next((t for t in templates if t['id'] == request.template_id), None)
            if not template:
                raise HTTPException(status_code=404, detail="模版不存在")

            enhanced_prompt, _ = _build_effective_template_prompt(
                template,
                user_params=request.user_params,
                custom_prompt_structure=request.custom_prompt_structure,
            )
        else:
            # 无模板：自由生图模式
            if not request.user_params:
                raise HTTPException(status_code=400, detail="自由生图模式需要提供 user_params")

            enhanced_prompt = request.user_params

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="模版数据文件不存在")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询模版失败: {str(e)}")

    normalized_resolution, normalized_aspect_ratio, normalized_model = (
        _normalize_image_generation_inputs(
            prompt=enhanced_prompt,
            resolution=request.resolution,
            aspect_ratio=request.aspect_ratio,
            selected_model=request.selected_model,
            num_images=request.num_images,
            reference_images=reference_images,
        )
    )

    # 构建 parts 数组
    parts = [{"text": enhanced_prompt}]

    # 如果有图片数据，添加到 parts
    if reference_images:
        print(f"包含画布上下文，共 {len(reference_images)} 张参考图")
        if not _is_openai_image_model(normalized_model):
            parts = _append_validated_reference_image_parts(parts, reference_images)

    return await _run_durable_image_generation(
        GenerateResponse,
        db=db,
        current_user=current_user,
        request_id=request_id,
        entrypoint="generate",
        template_id=request.template_id,
        prompt=enhanced_prompt,
        parts=parts,
        reference_images=reference_images,
        resolution=normalized_resolution,
        aspect_ratio=normalized_aspect_ratio,
        selected_model=normalized_model,
        num_images=request.num_images,
        http_request=http_request,
    )

@app.get("/")
async def root():
    return {"message": "NeoVista Backend API"}

@app.get("/api/v1/channels")
async def get_channels():
    return {
        "total": len(API_CHANNELS),
        "configured": bool(API_CHANNELS),
    }


@app.get("/api/v1/image/capabilities")
async def get_image_capabilities():
    aspect_ratios = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9", "21:9"]
    configured_models = _configured_image_generation_models()
    models = []
    if "nano-banana-2" in configured_models:
        channel = next(
            channel for channel in API_CHANNELS
            if (
                channel.product_model == "nano-banana-2"
                and _image_channel_mapping_is_valid(channel)
            )
        )
        pricing = get_resolution_pricing("nano-banana-2")
        models.append({
            "id": "nano-banana-2",
            "label": "Nano 2",
            "provider_model": channel.model,
            "resolution_semantics": "pixel_size",
            "resolutions": [
                {"value": value, "label": value, "credits": pricing[value]}
                for value in ("1K", "2K", "4K")
            ],
            "aspect_ratios": aspect_ratios,
            "supports_reference_images": True,
        })
    if "nano-banana-pro" in configured_models:
        channel = next(
            channel for channel in API_CHANNELS
            if (
                channel.product_model == "nano-banana-pro"
                and _image_channel_mapping_is_valid(channel)
            )
        )
        pricing = get_resolution_pricing("nano-banana-pro")
        models.append({
            "id": "nano-banana-pro",
            "label": "Nano Pro",
            "provider_model": channel.model,
            "resolution_semantics": "pixel_size",
            "resolutions": [
                {"value": value, "label": value, "credits": pricing[value]}
                for value in ("1K", "2K", "4K")
            ],
            "aspect_ratios": aspect_ratios,
            "supports_reference_images": True,
        })
    if "gpt-image-2" in configured_models:
        channel = next(
            channel for channel in API_CHANNELS
            if (
                channel.product_model == "gpt-image-2"
                and _image_channel_mapping_is_valid(channel)
            )
        )
        pricing = get_resolution_pricing("gpt-image-2")
        labels = {"1K": "低质量", "2K": "中质量", "4K": "高质量"}
        models.append({
            "id": "gpt-image-2",
            "label": "GPT Image 2.0",
            "provider_model": channel.model,
            "resolution_semantics": "quality",
            "resolutions": [
                {"value": value, "label": labels[value], "credits": pricing[value]}
                for value in ("1K", "2K", "4K")
            ],
            "aspect_ratios": ["auto", "1:1", "2:3", "3:2"],
            "supports_reference_images": True,
        })
    default_model = "nano-banana-2" if "nano-banana-2" in configured_models else (
        models[0]["id"] if models else "nano-banana-2"
    )
    feature_enabled = _image_generation_feature_enabled()
    return {
        "enabled": feature_enabled and bool(models),
        "disabled_reason": (
            None
            if feature_enabled and models
            else "生图功能正在维护" if not feature_enabled else "生图供应商渠道尚未配置完成"
        ),
        "default_model": default_model,
        "max_num_images": 1,
        "models": models,
    }


@app.get("/api/v1/image/tasks/by-request/{request_id}", response_model=ImageTaskResponse)
async def get_image_generation_task_by_request_id(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not 8 <= len(request_id) <= 64 or not re.fullmatch(r"[A-Za-z0-9._:-]+", request_id):
        raise HTTPException(status_code=400, detail="无效的生图请求 ID")
    task = _find_image_generation_task(
        db,
        user_id=current_user.id,
        request_id=request_id,
    )
    if task is None:
        raise HTTPException(status_code=404, detail="生图任务不存在")
    return _build_image_task_response_from_record(db, task, current_user)


@app.get("/api/v1/admin/channels")
async def admin_get_channels(admin_user: User = Depends(verify_admin_access)):
    return {
        "total": len(API_CHANNELS),
        "channels": [
            {
                "name": ch.name,
                "base_url": ch.base_url,
                "model": ch.model,
                "product_model": ch.product_model,
            }
            for ch in API_CHANNELS
        ],
    }

@app.post("/api/generate_diagram")
async def generate_diagram(
    request: GenerateDiagramRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    http_request: Request = None,
):
    """Agent 2: 生图执行引擎 - 从会话中读取参数并生成图片"""
    request_id = request.request_id or str(uuid.uuid4())
    try:
        # 1. 查询会话
        session = _get_owned_chat_session(
            db,
            session_id=request.session_id,
            current_user=current_user,
            create=False,
        )

        # 2. 校验参数完整性
        if not session.template_id:
            raise HTTPException(status_code=400, detail="未选择模版，无法生成")

        collected = json.loads(session.collected_params or '{}')
        if not collected.get('title') or not collected.get('data'):
            raise HTTPException(status_code=400, detail="参数不完整，缺少 title 或 data")

        # 3. 读取模版
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        template = next((t for t in templates if t['id'] == session.template_id), None)
        if not template:
            raise HTTPException(status_code=404, detail="模版不存在")

        # 4. 组装与预览接口完全一致的 Prompt
        final_prompt = _build_effective_diagram_prompt(template, parameters=collected)

        # 5. 构建 API 请求
        parts = [{"text": final_prompt}]

        # 检查是否为 i2i 模式
        reference_images: List[str] = []
        is_i2i = template.get('is_i2i', False)
        if is_i2i:
            history = json.loads(session.chat_history or "[]")
            reference_images = _resolve_generate_diagram_reference_images(
                request_base_image=request.base_image,
                request_base_images=request.base_images,
                session_history=history,
            )

            if not reference_images:
                raise HTTPException(status_code=400, detail="此模版需要底图，但会话中未找到图片")
        normalized_resolution, normalized_aspect_ratio, normalized_model = (
            _normalize_image_generation_inputs(
                prompt=final_prompt,
                resolution=request.resolution,
                aspect_ratio=request.aspect_ratio,
                selected_model=request.selected_model,
                num_images=request.num_images,
                reference_images=reference_images,
            )
        )
        if reference_images and not _is_openai_image_model(normalized_model):
            parts = _append_validated_reference_image_parts(parts, reference_images)

        return await _run_durable_image_generation(
            GenerateDiagramResponse,
            db=db,
            current_user=current_user,
            request_id=request_id,
            entrypoint="generate_diagram",
            template_id=session.template_id,
            prompt=final_prompt,
            parts=parts,
            reference_images=reference_images,
            resolution=normalized_resolution,
            aspect_ratio=normalized_aspect_ratio,
            selected_model=normalized_model,
            num_images=request.num_images,
            http_request=http_request,
        )

    except HTTPException:
        raise
    except Exception as error:
        print(f"⚠️ 生图请求处理异常: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="生图请求处理失败")

@app.post("/api/audit_diagram")
async def audit_diagram(
    request: AuditDiagramRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Agent 3: 多模态视觉审图节点"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(
            db,
            client_ip,
            "audit_diagram",
            AUDIT_DIAGRAM_IP_HOURLY_LIMIT,
            period="hour",
        )
        check_and_increment_user_limit(
            db,
            current_user.id,
            "audit_diagram",
            AUDIT_DIAGRAM_USER_HOURLY_LIMIT,
            period="hour",
        )
        # 1. 查询会话（session_id 可选）
        session = None
        if request.session_id:
            session = _get_owned_chat_session(
                db,
                session_id=request.session_id,
                current_user=current_user,
                create=False,
            )

        # 2. 提取用户意图参数
        collected = json.loads(session.collected_params or '{}') if session else {}
        user_intent = json.dumps({
            "title": str(collected.get("title", ""))[:200],
            "data": str(collected.get("data", ""))[:500],
            "template_id": collected.get("template_id", "")
        }, ensure_ascii=False)

        # 3. Validate and materialize the image.  A remote URL is accepted
        # only when it is the persisted result of this user's own task; this
        # prevents audit from becoming a general-purpose server-side fetcher.
        audit_image_source = request.image_base64.strip()
        if audit_image_source.startswith(("http://", "https://")):
            owned_result = db.query(ImageGenerationTask.id).filter(
                ImageGenerationTask.user_id == current_user.id,
                ImageGenerationTask.status == "succeeded",
                ImageGenerationTask.settlement_status == "CAPTURED",
                ImageGenerationTask.image_url == audit_image_source,
            ).first()
            if owned_result is None:
                raise HTTPException(status_code=400, detail="远程审图图片不是当前用户的生成结果")
            audit_image_source = await _download_remote_generated_image(audit_image_source)
        compressed_image = compress_image_for_vision(audit_image_source)
        img_data = base64.b64decode(compressed_image.split(',')[1] if ',' in compressed_image else compressed_image)

        # 4. 构建 System Prompt
        system_prompt = f"""# Role & Tone
你是建筑教学助理和项目审核人，采用"三明治反馈法"：先肯定闪光点，再指出硬伤。

# Task
对比用户意图与生成图，排查专业硬伤，输出结构化审核报告。

<user_intent>
{user_intent}
</user_intent>

# Evaluation Criteria

### 1. 闪光点挖掘 (Positive Reinforcement)
客观寻找图面优点（色彩尝试、构图张力等）进行专业表扬。

### 2. 意图映射与当代叙事 (Intent & Narrative)
- 核心意图是否落实？流线/水文分析是否有明确箭头和线型？
- 是否包含比例合理的"尺度人（Scale Figures）"交代空间尺度？

### 3. 认知负荷与图底关系 (Cognitive Load & Hierarchy) **[致命错误]**
- 图例是否清晰？视觉焦点是否控制得当？分析线条是否相互干扰导致信息过载？
- 城市/地形基底是否退让处理（低饱和度/白模）？
- 核心分析数据是否处于第一视觉层级？

### 4. 几何逻辑与幻觉排查 (Logic & Hallucinations) **[致命错误]**
- 轴测图 Z 轴是否垂直对齐？严禁物理体块"熔接（Melting）"
- 严禁"霓虹光晕"或"过度写实材质"
- **AI生成的文字通常是乱码，必须精准指出位置并附带相对坐标**
  - 格式：[区域描述 (x: 百分比, y: 百分比)]
  - 示例：[右上角乱码 (x: 85%, y: 12%)]
- 指出影响表达的噪点或无逻辑乱线，同样附带坐标

# Pass/Fail Criteria
- **is_pass = true**: 意图完整落实 + 无几何硬伤 + 最多1处轻微幻觉（如边缘小噪点）
- **is_pass = false**: 核心元素缺失 OR 体块熔接 OR 3处以上乱码 OR 图底关系混乱

# Output Format
必须且只能输出以下 JSON 结构，不要添加任何 Markdown 标记（如 ```json）：
{{
  "is_pass": true/false,
  "overview": "一句话核心评价（50字以内）",
  "positive": ["优点1", "优点2", "优点3"],
  "negative": ["致命伤1", "致命伤2"],
  "suggestions": ["修改建议1", "修改建议2"]
}}

注意：
- positive 数组：列出3-5个具体优点
- negative 数组：只列出致命硬伤，如果没有则为空数组 []
- suggestions 数组：针对 negative 提出的改进建议
- 输出必须是纯 JSON，不要包含任何其他文字"""

        # 5. 调用带重试的 Pro 渠道进行视觉审图
        try:
            text = await chat_pro_multimodal_json(
                f"{system_prompt}\n\n请审核这张建筑分析图",
                img_data,
                timeout=90.0,
                max_tokens=4000,
            )
            print(f"[审图] 供应商返回成功（响应长度: {len(text)}）")

            # 尝试解析 JSON
            try:
                result = _parse_json_object_response(text)
            except json.JSONDecodeError:
                print("[审图] 无法解析供应商 JSON")
                raise HTTPException(status_code=502, detail="审图服务返回格式无效")

            standardized = {
                "is_pass": result.get("is_pass", False),
                "overview": result.get("overview", "审图完成"),
                "positive": result.get("positive", []),
                "negative": result.get("negative", []),
                "suggestions": result.get("suggestions", [])
            }

            print("[审图] 审图渠道成功")
            return standardized
        except HTTPException:
            raise
        except Exception as error:
            print(f"⚠️  [审图] 所有审图渠道失败: {type(error).__name__}")
            raise HTTPException(status_code=503, detail="审图服务暂时不可用，请稍后重试")

    except HTTPException:
        raise
    except Exception as error:
        print(f"⚠️ 审图请求处理异常: {type(error).__name__}")
        raise HTTPException(status_code=500, detail="审图请求处理失败")

# ==================== 管理员后台路由 ====================

def _require_admin_template_mutations_enabled() -> None:
    if os.getenv("ADMIN_TEMPLATE_MUTATIONS_ENABLED", "false").strip().lower() not in {
        "1", "true", "yes"
    }:
        raise HTTPException(status_code=503, detail="生产环境已停用模板文件写入，请通过版本发布更新模板")


def _validate_admin_template_payload(template_data: dict) -> None:
    try:
        serialized = json.dumps(template_data, ensure_ascii=False)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="模板数据必须是有效 JSON 对象")
    if len(serialized.encode("utf-8")) > 256 * 1024:
        raise HTTPException(status_code=413, detail="模板数据过大")

@app.get("/api/v1/admin/templates")
async def admin_get_templates(admin_user: User = Depends(verify_admin_access)):
    """管理员获取所有模版（包含 prompt_structure）"""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)
        return {"templates": templates, "total": len(templates)}
    except Exception:
        raise HTTPException(status_code=500, detail="模板数据读取失败")

@app.put("/api/v1/admin/templates/{template_id}")
async def admin_update_template(
    template_id: str,
    template_data: dict,
    admin_user: User = Depends(verify_admin_access),
):
    """管理员更新模版（支持 P0-P4 字段）"""
    _require_admin_template_mutations_enabled()
    _validate_admin_template_payload(template_data)
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        for i, t in enumerate(templates):
            if t['id'] == template_id:
                templates[i] = {**t, **template_data, 'id': template_id}
                with open('templates_v2.json', 'w', encoding='utf-8') as f:
                    json.dump(templates, f, ensure_ascii=False, indent=2)
                return {"message": "更新成功", "template": templates[i]}

        raise HTTPException(status_code=404, detail="模版不存在")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="模板更新失败")

@app.post("/api/v1/admin/templates")
async def admin_create_template(
    template_data: dict,
    admin_user: User = Depends(verify_admin_access),
):
    """管理员新增模版（支持 P0-P4 字段）"""
    _require_admin_template_mutations_enabled()
    _validate_admin_template_payload(template_data)
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        templates.append(template_data)
        with open('templates_v2.json', 'w', encoding='utf-8') as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)
        return {"message": "新增成功", "template": template_data}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="模板创建失败")

@app.delete("/api/v1/admin/templates/{template_id}")
async def admin_delete_template(
    template_id: str,
    admin_user: User = Depends(verify_admin_access),
):
    """管理员删除模版"""
    _require_admin_template_mutations_enabled()
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        templates = [t for t in templates if t['id'] != template_id]
        with open('templates_v2.json', 'w', encoding='utf-8') as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)
        return {"message": "删除成功"}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="模板删除失败")

@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


def _readiness_schema_is_current(db: Session) -> bool:
    bind = db.get_bind()
    inspector = sqlalchemy_inspect(bind)
    table_names = set(inspector.get_table_names())
    if not {
        "chat_sessions",
        "credit_transactions",
        "image_generation_tasks",
        "video_generation_tasks",
    }.issubset(table_names):
        return False

    credit_columns = {
        column["name"] for column in inspector.get_columns("credit_transactions")
    }
    video_columns = {
        column["name"] for column in inspector.get_columns("video_generation_tasks")
    }
    image_columns = {
        column["name"] for column in inspector.get_columns("image_generation_tasks")
    }
    chat_session_columns = {
        column["name"] for column in inspector.get_columns("chat_sessions")
    }
    if "user_id" not in chat_session_columns:
        return False
    if "settlement_key" not in credit_columns:
        return False
    if not {
        "task_id",
        "provider_task_id",
        "request_id",
        "request_fingerprint",
        "user_id",
        "hold_transaction_id",
        "status",
        "settlement_status",
        "next_poll_at",
        "deadline_at",
    }.issubset(video_columns):
        return False
    if not {
        "task_id",
        "request_id",
        "request_fingerprint",
        "user_id",
        "hold_transaction_id",
        "status",
        "settlement_status",
        "image_url",
        "result_size_bytes",
        "result_expires_at",
    }.issubset(image_columns):
        return False

    expected_indexes = {
        "uq_credit_transactions_settlement_key": ("credit_transactions", ("settlement_key",)),
        "uq_video_generation_tasks_user_request": (
            "video_generation_tasks",
            ("user_id", "request_id"),
        ),
        "uq_video_generation_tasks_provider_task_id": (
            "video_generation_tasks",
            ("provider_task_id",),
        ),
        "uq_video_generation_tasks_hold_transaction_id": (
            "video_generation_tasks",
            ("hold_transaction_id",),
        ),
        "uq_video_generation_tasks_user_unresolved": (
            "video_generation_tasks",
            ("user_id",),
        ),
        "uq_image_generation_tasks_user_request": (
            "image_generation_tasks",
            ("user_id", "request_id"),
        ),
        "uq_image_generation_tasks_hold_transaction_id": (
            "image_generation_tasks",
            ("hold_transaction_id",),
        ),
    }
    indexes_by_table = {
        table_name: {
            index["name"]: index
            for index in inspector.get_indexes(table_name)
        }
        for table_name in {table for table, _ in expected_indexes.values()}
    }
    for index_name, (table_name, expected_columns) in expected_indexes.items():
        index = indexes_by_table[table_name].get(index_name)
        if not index or not index.get("unique"):
            return False
        if tuple(index.get("column_names") or ()) != expected_columns:
            return False

    chat_session_indexes = {
        index["name"]: index
        for index in inspector.get_indexes("chat_sessions")
    }
    owner_index = chat_session_indexes.get("ix_chat_sessions_user_id")
    if not owner_index or tuple(owner_index.get("column_names") or ()) != ("user_id",):
        return False

    if bind.dialect.name == "sqlite":
        partial_index_sql = db.execute(
            text(
                "SELECT sql FROM sqlite_master "
                "WHERE type = 'index' AND name = 'uq_video_generation_tasks_user_unresolved'"
            )
        ).scalar()
        normalized_sql = " ".join(str(partial_index_sql or "").lower().split())
        required_partial_tokens = (
            " where ",
            "submit_unknown",
            "finalizing",
            "queued",
            "pending",
            "created",
            "processing",
            "reconciliation_required",
        )
        if any(token not in normalized_sql for token in required_partial_tokens):
            return False
    return True


def _seedance_reconciler_is_healthy(now: datetime) -> bool:
    if _seedance_reconciler_task is None or _seedance_reconciler_task.done():
        return False
    if _seedance_reconciler_last_success_at is None:
        return False
    interval = max(3, int(os.getenv("SEEDANCE_RECONCILER_INTERVAL_SECONDS", "10")))
    max_success_age = max(60, interval * 3)
    if (now - _seedance_reconciler_last_success_at).total_seconds() > max_success_age:
        return False
    if (
        _seedance_reconciler_last_error_at is not None
        and _seedance_reconciler_last_error_at >= _seedance_reconciler_last_success_at
    ):
        return False
    return True


@app.get("/api/ready")
async def readiness_check():
    """Read-only readiness signal for deploys and monitoring; never calls providers."""
    checks = {
        "database": False,
        "schema": False,
        "database_writable": False,
        "reconciler": False,
        "seedance_config": False,
        "image_config": False,
        "chat_config": False,
        "video_backlog": False,
        "image_backlog": False,
        "image_result_storage": False,
    }
    metrics = {
        "active_video_tasks": 0,
        "review_required_tasks": 0,
        "pending_video_holds": 0,
        "orphan_pending_video_holds": 0,
        "oldest_active_age_seconds": None,
        "reconciler_last_success_age_seconds": None,
        "reconciler_last_error_type": _seedance_reconciler_last_error_type,
        "active_image_tasks": 0,
        "preexisting_active_image_tasks": 0,
        "active_image_tasks_without_pending_hold": 0,
        "review_required_image_tasks": 0,
        "pending_image_holds": 0,
        "orphan_pending_image_holds": 0,
        "oldest_active_image_age_seconds": None,
        "stored_image_result_bytes": 0,
        "expired_image_results": 0,
    }
    readiness_bind = None
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = True
        readiness_bind = db.get_bind()
        checks["schema"] = _readiness_schema_is_current(db)

        active_query = db.query(VideoGenerationTask).filter(
            func.lower(VideoGenerationTask.status).in_(SEEDANCE_ACTIVE_STATUSES)
        )
        metrics["active_video_tasks"] = active_query.count()
        oldest_active = active_query.order_by(VideoGenerationTask.created_at.asc()).first()
        if oldest_active and oldest_active.created_at:
            metrics["oldest_active_age_seconds"] = max(
                0,
                int((datetime.utcnow() - oldest_active.created_at).total_seconds()),
            )
        metrics["review_required_tasks"] = db.query(VideoGenerationTask).filter(
            or_(
                VideoGenerationTask.status == "reconciliation_required",
                VideoGenerationTask.settlement_status == "REVIEW_REQUIRED",
            )
        ).count()
        pending_video_holds_query = (
            db.query(CreditTransaction.id)
            .outerjoin(
                VideoGenerationTask,
                VideoGenerationTask.hold_transaction_id == CreditTransaction.id,
            )
            .filter(
                CreditTransaction.type == "GENERATE_HOLD",
                CreditTransaction.status == "PENDING",
                or_(
                    CreditTransaction.idempotency_key.like("video-generate:%"),
                    VideoGenerationTask.id.is_not(None),
                ),
            )
        )
        metrics["pending_video_holds"] = pending_video_holds_query.count()
        metrics["orphan_pending_video_holds"] = pending_video_holds_query.filter(
            CreditTransaction.idempotency_key.like("video-generate:%"),
            VideoGenerationTask.id.is_(None),
        ).count()

        active_image_query = db.query(ImageGenerationTask).filter(
            func.lower(ImageGenerationTask.status).in_(IMAGE_GENERATION_ACTIVE_STATUSES)
        )
        metrics["active_image_tasks"] = active_image_query.count()
        metrics["preexisting_active_image_tasks"] = active_image_query.filter(
            ImageGenerationTask.created_at < PROCESS_STARTED_AT,
        ).count()
        metrics["active_image_tasks_without_pending_hold"] = (
            db.query(ImageGenerationTask)
            .outerjoin(
                CreditTransaction,
                CreditTransaction.id == ImageGenerationTask.hold_transaction_id,
            )
            .filter(
                func.lower(ImageGenerationTask.status).in_(IMAGE_GENERATION_ACTIVE_STATUSES),
                or_(
                    CreditTransaction.id.is_(None),
                    CreditTransaction.status != "PENDING",
                ),
            )
            .count()
        )
        oldest_active_image = active_image_query.order_by(
            ImageGenerationTask.created_at.asc()
        ).first()
        if oldest_active_image and oldest_active_image.created_at:
            metrics["oldest_active_image_age_seconds"] = max(
                0,
                int((datetime.utcnow() - oldest_active_image.created_at).total_seconds()),
            )
        metrics["review_required_image_tasks"] = db.query(ImageGenerationTask).filter(
            or_(
                ImageGenerationTask.status == "reconciliation_required",
                ImageGenerationTask.settlement_status == "REVIEW_REQUIRED",
            )
        ).count()
        image_hold_selector = or_(
            CreditTransaction.idempotency_key.like("image-generate:%"),
            CreditTransaction.idempotency_key.like("generate:%"),
            CreditTransaction.idempotency_key.like("generate-diagram:%"),
        )
        pending_image_holds_query = (
            db.query(CreditTransaction.id)
            .outerjoin(
                ImageGenerationTask,
                ImageGenerationTask.hold_transaction_id == CreditTransaction.id,
            )
            .filter(
                CreditTransaction.type == "GENERATE_HOLD",
                CreditTransaction.status == "PENDING",
                image_hold_selector,
            )
        )
        metrics["pending_image_holds"] = pending_image_holds_query.count()
        metrics["orphan_pending_image_holds"] = pending_image_holds_query.filter(
            ImageGenerationTask.id.is_(None),
        ).count()
        metrics["stored_image_result_bytes"] = int(
            db.query(func.coalesce(func.sum(ImageGenerationTask.result_size_bytes), 0)).scalar() or 0
        )
        metrics["expired_image_results"] = db.query(ImageGenerationTask).filter(
            ImageGenerationTask.image_url.is_not(None),
            ImageGenerationTask.result_expires_at.is_not(None),
            ImageGenerationTask.result_expires_at <= datetime.utcnow(),
        ).count()
    except Exception:
        db.rollback()
    finally:
        db.close()

    try:
        if readiness_bind is None:
            raise RuntimeError("database bind is unavailable")
        with readiness_bind.begin() as connection:
            connection.execute(text("UPDATE users SET credits = credits WHERE 1 = 0"))
        checks["database_writable"] = True
    except Exception:
        checks["database_writable"] = False

    feature_enabled = os.getenv("SEEDANCE_FEATURE_ENABLED", "false").strip().lower() in {
        "1", "true", "yes"
    }
    reconciler_enabled = os.getenv("SEEDANCE_RECONCILER_ENABLED", "true").strip().lower() in {
        "1", "true", "yes"
    }
    has_historical_video_work = bool(
        metrics["active_video_tasks"] or metrics["pending_video_holds"]
    )
    requires_seedance_runtime = feature_enabled or has_historical_video_work
    now = datetime.utcnow()
    if _seedance_reconciler_last_success_at is not None:
        metrics["reconciler_last_success_age_seconds"] = max(
            0,
            int((now - _seedance_reconciler_last_success_at).total_seconds()),
        )
    if requires_seedance_runtime:
        try:
            _get_seedance_api_key()
            _get_seedance_base_url()
            _get_seedance_model()
            _build_public_base_url()
            checks["seedance_config"] = True
        except HTTPException:
            checks["seedance_config"] = False
        checks["reconciler"] = reconciler_enabled and _seedance_reconciler_is_healthy(now)
    else:
        checks["seedance_config"] = True
        checks["reconciler"] = True
    required_image_models = {
        item.strip().lower()
        for item in os.getenv(
            "IMAGE_REQUIRED_PRODUCT_MODELS",
            "nano-banana-2,nano-banana-pro,gpt-image-2",
        ).split(",")
        if item.strip()
    }
    checks["image_config"] = required_image_models.issubset(
        _configured_image_generation_models()
    )
    checks["chat_config"] = _chat_config_is_valid()
    max_review_required = max(
        0,
        int(os.getenv("SEEDANCE_READY_MAX_REVIEW_REQUIRED", "0")),
    )
    oldest_age = metrics["oldest_active_age_seconds"] or 0
    checks["video_backlog"] = (
        metrics["review_required_tasks"] <= max_review_required
        and oldest_age <= _seedance_task_deadline_seconds() + 300
        and metrics["orphan_pending_video_holds"] == 0
    )
    max_image_review_required = max(
        0,
        int(os.getenv("IMAGE_READY_MAX_REVIEW_REQUIRED", "0")),
    )
    checks["image_backlog"] = (
        metrics["review_required_image_tasks"] <= max_image_review_required
        and metrics["orphan_pending_image_holds"] == 0
        and metrics["preexisting_active_image_tasks"] == 0
        and metrics["active_image_tasks_without_pending_hold"] == 0
        and metrics["pending_image_holds"] == metrics["active_image_tasks"]
        and (metrics["oldest_active_image_age_seconds"] or 0) <= max(
            60,
            int(os.getenv("IMAGE_READY_MAX_ACTIVE_AGE_SECONDS", "600")),
        )
    )
    checks["image_result_storage"] = (
        metrics["stored_image_result_bytes"]
        <= max(
            IMAGE_GENERATION_MAX_RESULT_BYTES,
            int(os.getenv("IMAGE_READY_MAX_STORED_RESULT_BYTES", str(2 * 1024 * 1024 * 1024))),
        )
        and metrics["expired_image_results"] == 0
    )
    core_ready = all(
        checks[key]
        for key in (
            "database",
            "schema",
            "database_writable",
            "reconciler",
            "seedance_config",
            "image_config",
            "chat_config",
        )
    )
    workload_ready = all(
        checks[key]
        for key in ("video_backlog", "image_backlog", "image_result_storage")
    )
    ready = core_ready and workload_ready
    degraded = core_ready and not workload_ready
    payload = {
        "status": "degraded" if degraded else "ready" if ready else "not_ready",
        "checks": checks,
        "metrics": metrics,
        "timestamp": datetime.now().isoformat(),
    }
    return JSONResponse(status_code=200 if ready else 503, content=payload)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
