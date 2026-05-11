from fastapi import FastAPI, HTTPException, Header, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Tuple, Union
from sqlalchemy.orm import Session
from functools import lru_cache
import httpx
import os
import json
import math
import mimetypes
import re
import traceback
import uuid
import base64
import io
from datetime import datetime
from dotenv import load_dotenv
from PIL import Image, ImageOps

load_dotenv()

from billing_service import (
    capture_generation_hold,
    create_generation_hold,
    refund_generation_hold,
)
from billing_router import router as billing_router
from dashboard_router import router as dashboard_router
from database import engine, Base, get_db
from auth import router as auth_router, get_current_user, get_optional_user
from monitoring_service import record_frontend_error_event, safe_record_generation_event
from models import User, ChatSession
from llm_service import (
    init_chat_channels,
    chat_flash,
    chat_pro,
    chat_pro_multimodal,
    chat_pro_multimodal_image,
    chat_pro_multimodal_json,
    select_workspace_chat_model,
)
from rate_limit_service import check_and_increment_ip_limit, extract_client_ip
from template_api_utils import serialize_template_summary

class APIChannel(BaseModel):
    name: str
    base_url: str
    api_key: str
    model: str

    class Config:
        frozen = True

# 初始化数据库
Base.metadata.create_all(bind=engine)

app = FastAPI()

# 管理员密钥
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY")
if not ADMIN_SECRET_KEY:
    raise RuntimeError("ADMIN_SECRET_KEY 环境变量未设置，请在 .env 中配置")

# 静态文件服务
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
            model=os.getenv(f"API_CHANNEL_{i}_MODEL", "gemini-3.1-flash-image-preview")
        ))
        i += 1
    return tuple(channels)

API_CHANNELS = get_api_channels()
print(f"✅ 已加载 {len(API_CHANNELS)} 个API渠道")
for ch in API_CHANNELS:
    print(f"  - {ch.name}: {ch.base_url}")

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

class GenerateRequest(BaseModel):
    template_id: Optional[str] = None
    user_params: Optional[str] = None
    image_data: Optional[str] = None
    image_datas: Optional[List[str]] = None
    custom_prompt_structure: Optional[dict] = None
    request_id: Optional[str] = None
    resolution: Optional[str] = "2K"  # 新增：1K/2K/4K
    aspect_ratio: Optional[str] = "auto"  # 新增：生图比例
    num_images: Optional[int] = 1
    selected_model: Optional[str] = "nano-banana-2"

class GenerateResponse(BaseModel):
    image_url: str
    timestamp: int
    charged_credits: int
    remaining_credits: int
    request_id: str

class Template(BaseModel):
    id: str
    title: str
    category: str
    images: List[str]
    display_text: str
    likes: int = 0
    uses: int = 0

class AgentChatRequest(BaseModel):
    query: str
    session_id: Optional[str] = None

class AgentChatResponse(BaseModel):
    session_id: str
    reply_text: str
    recommended_templates: List[Template]
    is_image_required: bool
    image_upload_prompt: Optional[str] = None
    collected_params: Optional[dict] = None

class WorkspaceChatMessage(BaseModel):
    role: str
    content: str


class WorkspaceChatRequest(BaseModel):
    messages: List[WorkspaceChatMessage]
    image_data: Optional[str] = None
    image_datas: Optional[List[str]] = None
    agent_mode: bool = False
    session_id: Optional[str] = None

class WorkspaceChatResponse(BaseModel):
    reply: str
    model_used: str
    ready_to_generate: bool = False
    suggested_template_id: Optional[str] = None
    suggested_params: Optional[dict] = None

    class Config:
        protected_namespaces = ()

class GenerateDiagramRequest(BaseModel):
    session_id: str
    base_image: Optional[str] = None
    base_images: Optional[List[str]] = None
    num_images: Optional[int] = 1
    template_id: Optional[str] = None
    request_id: Optional[str] = None
    resolution: Optional[str] = "2K"
    aspect_ratio: Optional[str] = "auto"
    selected_model: Optional[str] = "nano-banana-2"

class GenerateDiagramResponse(BaseModel):
    image_url: str
    timestamp: int
    charged_credits: int
    remaining_credits: int
    request_id: str

class FrontendErrorPayload(BaseModel):
    route: str
    message: str
    stack: Optional[str] = None
    user_agent: Optional[str] = None

class AuditDiagramRequest(BaseModel):
    session_id: Optional[str] = None
    template_id: Optional[str] = None
    image_base64: str

@app.post("/api/v1/frontend-errors")
async def create_frontend_error(
    payload: FrontendErrorPayload,
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    record_frontend_error_event(
        db,
        user_id=current_user.id if current_user else None,
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
        return (rewritten or "").strip() or cleaned

    if "中文翻译：" in cleaned and _reply_has_chinese(cleaned):
        return cleaned

    if _reply_has_chinese(cleaned) and not re.search(r"[A-Za-z]", cleaned):
        return cleaned

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
    except Exception as multimodal_error:
        composed_image = _compose_reference_image_bytes(normalized_images)
        if not composed_image:
            raise multimodal_error

        print(
            "⚠️  多图 data URL 对话失败，回退为单张拼图发送："
            f"{multimodal_error}"
        )
        return await chat_pro_multimodal_image(
            prompt,
            composed_image,
        )


# Agent 3 辅助函数
def compress_image_for_vision(base64_str: str, max_size_mb: float = 3.5) -> str:
    """压缩图片到 3.5MB 以下"""
    img_data = base64.b64decode(base64_str.split(',')[1] if ',' in base64_str else base64_str)

    if len(img_data) <= max_size_mb * 1024 * 1024:
        return base64_str

    img = Image.open(io.BytesIO(img_data))
    img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=85, optimize=True)
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
    def __init__(self, *, last_error, error_code: str, error_message: str):
        super().__init__(error_message)
        self.last_error = last_error
        self.error_code = error_code
        self.error_message = error_message


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
    wants_openai_image = _is_openai_image_model(selected_model)
    filtered = tuple(
        channel for channel in API_CHANNELS
        if _is_openai_image_model(channel.model) == wants_openai_image
    )
    return filtered


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
    portrait_ratios = {"3:4", "9:16"}
    landscape_ratios = {"4:3", "16:9", "21:9"}
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
        files.append(("image[]", (filename, raw_bytes, mime_type)))
    return files


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
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"创建扣费预占失败: {str(e)}")


async def _request_image_from_channels(
    *,
    parts: List[dict],
    resolution: str,
    aspect_ratio: str,
    selected_model: Optional[str],
    reference_images: Optional[List[str]] = None,
    payload_log: str,
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

    last_error = None
    error_code = "UPSTREAM_FAILED"
    error_message = "所有API渠道均失败"

    for channel in channels:
        try:
            print(f"尝试渠道: {channel.name} (分辨率: {resolution}, 比例: {aspect_ratio}, 尺寸: {width}x{height})")

            headers = {"Authorization": f"Bearer {channel.api_key}"}
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
                        "headers": {
                            **headers,
                            "Content-Type": "application/json",
                        },
                    }
                    timeout = 120.0
            else:
                url = f"{channel.base_url}/v1/models/{channel.model}:generateContent"
                payload = {
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE"],
                    }
                }
                if not _is_auto_aspect_ratio(aspect_ratio):
                    payload["generationConfig"]["imageConfig"] = {"aspectRatio": aspect_ratio}
                timeout = 60.0
                request_kwargs = {
                    "json": payload,
                    "headers": {
                        **headers,
                        "Content-Type": "application/json",
                    },
                }

            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, **request_kwargs)
                response.raise_for_status()
                data = response.json()

            print(f"渠道 {channel.name} 成功")
            image_data = (
                _extract_openai_generated_image(data)
                if _is_openai_image_model(channel.model)
                else _extract_generated_image(data)
            )
            if image_data:
                return image_data, channel.name

            error_code = "UPSTREAM_EMPTY_IMAGE"
            error_message = f"渠道 {channel.name} 返回结果中缺少图片数据"
        except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
            error_msg = f"渠道 {channel.name} 失败: {type(e).__name__}"
            if isinstance(e, httpx.HTTPStatusError):
                error_msg += f" {e.response.status_code}"
                error_code = f"UPSTREAM_HTTP_{e.response.status_code}"
            else:
                error_code = "UPSTREAM_TIMEOUT"
            error_message = error_msg
            print(f"⚠️  {error_msg}")
            last_error = e
            continue
        except Exception as e:
            print(f"⚠️  渠道 {channel.name} 异常: {str(e)}")
            error_code = "UPSTREAM_EXCEPTION"
            error_message = str(e)
            last_error = e
            continue

    raise UpstreamGenerationError(
        last_error=last_error,
        error_code=error_code,
        error_message=error_message,
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
        refund_generation_hold(
            db,
            hold_txn,
            error_code=error_code,
            error_message=error_message,
        )
        db.commit()
    except Exception:
        db.rollback()
        traceback.print_exc()


def _build_generation_error(last_error, *, prefix: str) -> HTTPException:
    if isinstance(last_error, httpx.TimeoutException):
        return HTTPException(status_code=504, detail="生成超时，积分已退回，请稍后重试")
    if isinstance(last_error, httpx.HTTPStatusError) and last_error.response.status_code in (502, 503, 504):
        return HTTPException(status_code=503, detail="生成服务暂时不可用，积分已退回，请稍后重试")
    if last_error is None:
        return HTTPException(status_code=500, detail=f"{prefix}，积分已退回")
    return HTTPException(status_code=500, detail=f"{prefix}，积分已退回: {str(last_error)}")


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
    capture_generation_hold(db, hold_txn, provider_meta={"channel": provider_name})
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"缩略图生成失败: {str(e)}")

@app.get("/api/templates")
async def get_templates_v2():
    """获取所有 Prompt 模版（工作区使用，包含 prompt_structure）"""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        # 返回完整数据（包含 prompt_structure）
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
                'is_i2i': t.get('is_i2i', False),
                'prompt_structure': t.get('prompt_structure', {})
            })

        return safe_templates
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
async def agent_chat(request: AgentChatRequest, http_request: Request, db: Session = Depends(get_db)):
    """智能接待Agent - 多轮对话 + 参数提取 MVP"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "agent_chat", FREE_AGENT_CHAT_DAILY_LIMIT, period="day")

        # 1. 会话管理
        if request.session_id:
            session = db.query(ChatSession).filter(ChatSession.session_id == request.session_id).first()
            if not session:
                # 如果传了 session_id 但不存在，创建新会话
                session = ChatSession(session_id=request.session_id)
                db.add(session)
                db.commit()
                db.refresh(session)
        else:
            session = ChatSession(session_id=str(uuid.uuid4()))
            db.add(session)
            db.commit()
            db.refresh(session)

        # 2. 加载历史和模版
        history = json.loads(session.chat_history)
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
        except Exception as e:
            print(f"Flash失败: {e}")
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
        session.chat_history = json.dumps(history)
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

    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        import traceback
        print(f"❌ agent_chat 错误: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class DirectChatRequest(BaseModel):
    message: str
    messages: Optional[List[WorkspaceChatMessage]] = None
    image_data: Optional[str] = None
    image_datas: Optional[List[str]] = None

class DirectChatResponse(BaseModel):
    reply: str

@app.post("/api/v1/direct-chat")
async def direct_chat(request: DirectChatRequest, http_request: Request, db: Session = Depends(get_db)):
    """普通对话接口 - 非 Agent，不涉及参数提炼或模板推荐"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "direct_chat", FREE_CHAT_DAILY_LIMIT, period="day")
        reference_images = _normalize_reference_images(
            image_data=request.image_data,
            image_datas=request.image_datas,
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

    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/agent/workspace-chat")
async def workspace_chat(request: WorkspaceChatRequest, http_request: Request, db: Session = Depends(get_db)):
    """画布对话Agent - Flash参数拆解 / Pro复杂图片分析"""
    try:
        client_ip = extract_client_ip(http_request)
        check_and_increment_ip_limit(db, client_ip, "workspace_chat", FREE_AGENT_CHAT_DAILY_LIMIT, period="day")
        reference_images = _normalize_reference_images(
            image_data=request.image_data,
            image_datas=request.image_datas,
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
        trimmed = request.messages[-40:]  # 20轮 = 40条消息
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
        if request.session_id:
            session = db.query(ChatSession).filter(ChatSession.session_id == request.session_id).first()
            if not session:
                session = ChatSession(session_id=request.session_id)
                db.add(session)

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

    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/generate")
async def generate_image(
    request: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 🔍 DEBUG 日志
    print("\n" + "="*60)
    print("[GENERATE DEBUG]")
    print(f"template_id: {request.template_id}")
    print(f"user_params: {request.user_params}")
    print(f"custom_prompt_structure: {request.custom_prompt_structure}")
    print(f"custom_prompt_structure type: {type(request.custom_prompt_structure)}")
    print("="*60 + "\n")
    reference_images = _normalize_reference_images(
        image_data=request.image_data,
        image_datas=request.image_datas,
    )

    request_id = request.request_id or str(uuid.uuid4())
    idempotency_key = f"generate:{current_user.id}:{request_id}"
    hold_txn = None

    # 根据 template_id 查询模版（支持 null）
    try:
        if request.template_id:
            # 有模板：使用模板逻辑
            with open('templates_v2.json', 'r', encoding='utf-8') as f:
                templates = json.load(f)

            template = next((t for t in templates if t['id'] == request.template_id), None)
            if not template:
                raise HTTPException(status_code=404, detail="模版不存在")

            # 新逻辑：用户提供信息 → 使用 prompt_structure；没提供 → 使用 real_prompt
            if request.user_params or request.custom_prompt_structure:
                # 优先使用 custom_prompt_structure，否则使用模板的 prompt_structure
                ps = request.custom_prompt_structure if request.custom_prompt_structure else template.get('prompt_structure', {})

                # 确保 ps 是字典类型
                if not isinstance(ps, dict):
                    print(f"⚠️ custom_prompt_structure 不是字典类型: {type(ps)}, 使用模板默认")
                    ps = template.get('prompt_structure', {})

                prompt_parts = []
                for key in ['p0_text', 'p1_user', 'p1_content', 'p2_lighting', 'p3_composition', 'p4_rendering']:
                    value = ps.get(key, '').strip()
                    if value and value not in ['{user_input}', '{title}', '标题：{title}，数据标注：{data}，字体：无衬线黑体', '自然光照，柔和阴影', '标准构图', '高质量渲染']:
                        prompt_parts.append(value)
                base_prompt = '\n\n'.join(prompt_parts)

                if request.user_params:
                    enhanced_prompt = f"{base_prompt}\n\n用户补充: {request.user_params}"
                else:
                    enhanced_prompt = base_prompt

                print(f"✅ 使用 prompt_structure 组装，最终 prompt 长度: {len(enhanced_prompt)}")
                print(f"最终 prompt 预览: {enhanced_prompt[:200]}...")
            else:
                enhanced_prompt = template.get('real_prompt', '').strip()
                print(f"✅ 使用 real_prompt，长度: {len(enhanced_prompt)}")

            print(f"使用模版 {request.template_id}: {template['title']}")
            print(f"Prompt长度: {len(enhanced_prompt)}")
        else:
            # 无模板：自由生图模式
            if not request.user_params:
                raise HTTPException(status_code=400, detail="自由生图模式需要提供 user_params")

            enhanced_prompt = request.user_params
            print(f"自由生图模式，Prompt: {enhanced_prompt[:100]}...")

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="模版数据文件不存在")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询模版失败: {str(e)}")

    # 构建 parts 数组
    parts = [{"text": enhanced_prompt}]

    # 如果有图片数据，添加到 parts
    if reference_images:
        print(f"包含画布上下文，共 {len(reference_images)} 张参考图")
        if not _is_openai_image_model(request.selected_model):
            parts = _append_reference_image_parts(parts, reference_images)

    hold_txn = _create_generation_hold_or_raise(
        db,
        current_user,
        resolution=request.resolution,
        num_images=request.num_images or 1,
        request_id=request_id,
        idempotency_key=idempotency_key,
        selected_model=request.selected_model,
    )

    try:
        image_data, provider_name = await _request_image_from_channels(
            parts=parts,
            resolution=request.resolution,
            aspect_ratio=request.aspect_ratio,
            selected_model=request.selected_model,
            reference_images=reference_images,
            payload_log=(
                f"[GENERATE PAYLOAD] template_id={request.template_id}, "
                f"selected_model={request.selected_model}, "
                f"resolution={request.resolution}, aspect_ratio={request.aspect_ratio}, "
                f"dimensions={{width}}x{{height}}, image_count={len(reference_images)}"
            ),
        )
        response = _build_generation_success_response(
            GenerateResponse,
            db=db,
            current_user=current_user,
            hold_txn=hold_txn,
            request_id=request_id,
            image_data=image_data,
            provider_name=provider_name,
        )
        safe_record_generation_event(
            db,
            request_id=request_id,
            user_id=current_user.id,
            entrypoint="generate",
            template_id=request.template_id,
            selected_model=request.selected_model,
            provider_name=provider_name,
            resolution=request.resolution,
            aspect_ratio=request.aspect_ratio,
            num_images=request.num_images or 1,
            status="SUCCESS",
        )
        return response
    except UpstreamGenerationError as e:
        _refund_generation_hold_safely(
            db,
            hold_txn,
            error_code=e.error_code,
            error_message=e.error_message,
        )
        safe_record_generation_event(
            db,
            request_id=request_id,
            user_id=current_user.id,
            entrypoint="generate",
            template_id=request.template_id,
            selected_model=request.selected_model,
            provider_name=None,
            resolution=request.resolution,
            aspect_ratio=request.aspect_ratio,
            num_images=request.num_images or 1,
            status="FAILED",
            error_code=e.error_code,
            error_message=e.error_message,
        )
        raise _build_generation_error(e.last_error, prefix="所有API渠道均失败")
    except Exception as e:
        _refund_generation_hold_safely(
            db,
            hold_txn,
            error_code="INTERNAL_EXCEPTION",
            error_message=str(e),
        )
        safe_record_generation_event(
            db,
            request_id=request_id,
            user_id=current_user.id,
            entrypoint="generate",
            template_id=request.template_id,
            selected_model=request.selected_model,
            provider_name=None,
            resolution=request.resolution,
            aspect_ratio=request.aspect_ratio,
            num_images=request.num_images or 1,
            status="FAILED",
            error_code="INTERNAL_EXCEPTION",
            error_message=str(e),
        )
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"生成失败，积分已退回: {str(e)}")

@app.get("/")
async def root():
    return {"message": "NeoVista Backend API"}

@app.get("/api/v1/channels")
async def get_channels():
    return {
        "total": len(API_CHANNELS),
        "channels": [{"name": ch.name, "base_url": ch.base_url} for ch in API_CHANNELS]
    }

@app.post("/api/generate_diagram")
async def generate_diagram(
    request: GenerateDiagramRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Agent 2: 生图执行引擎 - 从会话中读取参数并生成图片"""
    print("=" * 50)
    print("🎨 generate_diagram 接口被调用")
    print(f"session_id: {request.session_id}")
    print("=" * 50)
    request_id = request.request_id or str(uuid.uuid4())
    idempotency_key = f"generate-diagram:{current_user.id}:{request_id}"
    try:
        # 1. 查询会话
        session = db.query(ChatSession).filter(ChatSession.session_id == request.session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")

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

        # 4. 组装 Prompt
        base_prompt = template.get('real_prompt', '').strip()
        if not base_prompt:
            ps = template.get('prompt_structure', {})
            parts = []
            for key in ['p0_text', 'p1_user', 'p1_content', 'p2_lighting', 'p3_composition', 'p4_rendering']:
                val = ps.get(key, '').strip()
                if val:
                    parts.append(val)
            base_prompt = '\n\n'.join(parts)

        # 替换占位符
        final_prompt = base_prompt.replace('{title}', collected.get('title', ''))
        final_prompt = final_prompt.replace('{data}', collected.get('data', ''))
        final_prompt = final_prompt.replace('{user_input}', collected.get('user_input', ''))

        # 强制添加负面提示词
        negative_prompt = "neon lights, glowing effects, over-rendered, chaotic lines, cinematic lighting, messy, cyberpunk, dark background"
        final_prompt = f"{final_prompt}\n\n负面提示词: {negative_prompt}"

        print(f"生图 Prompt 长度: {len(final_prompt)}")

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
            if not _is_openai_image_model(request.selected_model):
                parts = _append_reference_image_parts(parts, reference_images)

        hold_txn = _create_generation_hold_or_raise(
            db,
            current_user,
            resolution=request.resolution,
            num_images=request.num_images or 1,
            request_id=request_id,
            idempotency_key=idempotency_key,
            selected_model=request.selected_model,
        )

        try:
            image_data, provider_name = await _request_image_from_channels(
                parts=parts,
                resolution=request.resolution,
                aspect_ratio=request.aspect_ratio,
                selected_model=request.selected_model,
                reference_images=reference_images,
                payload_log=(
                    f"[GENERATE_DIAGRAM PAYLOAD] template_id={session.template_id}, "
                    f"selected_model={request.selected_model}, "
                    f"resolution={request.resolution}, aspect_ratio={request.aspect_ratio}, "
                    "dimensions={width}x{height}"
                ),
            )
            response = _build_generation_success_response(
                GenerateDiagramResponse,
                db=db,
                current_user=current_user,
                hold_txn=hold_txn,
                request_id=request_id,
                image_data=image_data,
                provider_name=provider_name,
            )
            safe_record_generation_event(
                db,
                request_id=request_id,
                user_id=current_user.id,
                entrypoint="generate_diagram",
                template_id=session.template_id,
                selected_model=request.selected_model,
                provider_name=provider_name,
                resolution=request.resolution,
                aspect_ratio=request.aspect_ratio,
                num_images=request.num_images or 1,
                status="SUCCESS",
            )
            return response
        except UpstreamGenerationError as e:
            _refund_generation_hold_safely(
                db,
                hold_txn,
                error_code=e.error_code,
                error_message=e.error_message,
            )
            safe_record_generation_event(
                db,
                request_id=request_id,
                user_id=current_user.id,
                entrypoint="generate_diagram",
                template_id=session.template_id,
                selected_model=request.selected_model,
                provider_name=None,
                resolution=request.resolution,
                aspect_ratio=request.aspect_ratio,
                num_images=request.num_images or 1,
                status="FAILED",
                error_code=e.error_code,
                error_message=e.error_message,
            )
            raise _build_generation_error(e.last_error, prefix="所有渠道失败")
        except Exception as e:
            _refund_generation_hold_safely(
                db,
                hold_txn,
                error_code="INTERNAL_EXCEPTION",
                error_message=str(e),
            )
            safe_record_generation_event(
                db,
                request_id=request_id,
                user_id=current_user.id,
                entrypoint="generate_diagram",
                template_id=session.template_id,
                selected_model=request.selected_model,
                provider_name=None,
                resolution=request.resolution,
                aspect_ratio=request.aspect_ratio,
                num_images=request.num_images or 1,
                status="FAILED",
                error_code="INTERNAL_EXCEPTION",
                error_message=str(e),
            )
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"生成失败，积分已退回: {str(e)}")

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/audit_diagram")
async def audit_diagram(
    request: AuditDiagramRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Agent 3: 多模态视觉审图节点"""
    try:
        # 1. 查询会话（session_id 可选）
        session = None
        if request.session_id:
            session = db.query(ChatSession).filter(ChatSession.session_id == request.session_id).first()

        # 2. 提取用户意图参数
        collected = json.loads(session.collected_params or '{}') if session else {}
        user_intent = json.dumps({
            "title": str(collected.get("title", ""))[:200],
            "data": str(collected.get("data", ""))[:500],
            "template_id": collected.get("template_id", "")
        }, ensure_ascii=False)

        # 3. 压缩图片
        compressed_image = compress_image_for_vision(request.image_base64)
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
            print(f"[审图] 返回内容: {text[:200]}...")

            # 尝试解析 JSON
            try:
                result = _parse_json_object_response(text)
            except json.JSONDecodeError:
                print(f"[审图] 无法解析 JSON，返回默认响应")
                return DEFAULT_AUDIT_RESPONSE

            standardized = {
                "is_pass": result.get("is_pass", False),
                "overview": result.get("overview", "审图完成"),
                "positive": result.get("positive", []),
                "negative": result.get("negative", []),
                "suggestions": result.get("suggestions", [])
            }

            print("[审图] 审图渠道成功")
            return standardized
        except Exception as e:
            print(f"⚠️  [审图] 所有审图渠道失败: {e}")
            traceback.print_exc()
            return DEFAULT_AUDIT_RESPONSE

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        return DEFAULT_AUDIT_RESPONSE

# ==================== 管理员后台路由 ====================

def verify_admin_token(x_admin_token: str = Header(None)):
    """管理员鉴权依赖"""
    if x_admin_token != ADMIN_SECRET_KEY:
        raise HTTPException(status_code=403, detail="无效的管理员令牌")
    return True

@app.get("/api/v1/admin/templates")
async def admin_get_templates(x_admin_token: str = Header(None)):
    """管理员获取所有模版（包含 prompt_structure）"""
    verify_admin_token(x_admin_token)
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)
        return {"templates": templates, "total": len(templates)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/v1/admin/templates/{template_id}")
async def admin_update_template(template_id: str, template_data: dict, x_admin_token: str = Header(None)):
    """管理员更新模版（支持 P0-P4 字段）"""
    verify_admin_token(x_admin_token)
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/admin/templates")
async def admin_create_template(template_data: dict, x_admin_token: str = Header(None)):
    """管理员新增模版（支持 P0-P4 字段）"""
    verify_admin_token(x_admin_token)
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        templates.append(template_data)
        with open('templates_v2.json', 'w', encoding='utf-8') as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)
        return {"message": "新增成功", "template": template_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/admin/templates/{template_id}")
async def admin_delete_template(template_id: str, x_admin_token: str = Header(None)):
    """管理员删除模版"""
    verify_admin_token(x_admin_token)
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        templates = [t for t in templates if t['id'] != template_id]
        with open('templates_v2.json', 'w', encoding='utf-8') as f:
            json.dump(templates, f, ensure_ascii=False, indent=2)
        return {"message": "删除成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
