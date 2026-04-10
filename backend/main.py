from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from functools import lru_cache
import httpx
import os
import json
import re
import traceback
import uuid
import base64
import io
from datetime import datetime
from dotenv import load_dotenv
from PIL import Image

load_dotenv()

from database import engine, Base, get_db
from auth import router as auth_router, get_current_user
from models import User, ChatSession
from llm_service import init_chat_channels, chat_flash, chat_pro, should_use_pro, CHAT_CHANNELS
from upstream_errors import format_upstream_error, map_upstream_failure_status

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

class GenerateRequest(BaseModel):
    template_id: Optional[str] = None
    user_params: Optional[str] = None
    image_data: Optional[str] = None
    custom_prompt_structure: Optional[dict] = None
    resolution: Optional[str] = "2K"  # 新增：1K/2K/4K
    aspect_ratio: Optional[str] = "1:1"  # 新增：生图比例
    num_images: Optional[int] = 1

class GenerateResponse(BaseModel):
    image_url: str
    timestamp: int

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
    num_images: Optional[int] = 1
    template_id: Optional[str] = None
    resolution: Optional[str] = "2K"
    aspect_ratio: Optional[str] = "1:1"

class GenerateDiagramResponse(BaseModel):
    image_url: str
    timestamp: int

class AuditDiagramRequest(BaseModel):
    session_id: Optional[str] = None
    template_id: Optional[str] = None
    image_base64: str

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
async def get_templates(limit: Optional[int] = None):
    """获取所有 Prompt 模版"""
    try:
        with open('templates_v2.json', 'r', encoding='utf-8') as f:
            templates = json.load(f)

        safe_templates = []
        for template in templates:
            images = template.get('images', [])
            summary_text = template.get('tips') or template.get('display_text', '')
            safe_templates.append({
                'id': template['id'],
                'title': template['title'],
                'category_id': template.get('category_id', ''),
                'category_name': template.get('category_name', ''),
                'subcategory_id': template.get('subcategory_id', ''),
                'subcategory_name': template.get('subcategory_name', ''),
                'tips': template.get('tips', ''),
                'images': images[-1:] if images else [],
                'is_i2i': template.get('is_i2i', False),
                'is_multi_step': template.get('is_multi_step', False),
                'display_text': summary_text[:160],
                'likes': template.get('likes', 0),
                'uses': template.get('uses', 0),
            })

        if limit is not None and limit >= 0:
            safe_templates = safe_templates[:limit]

        return {"templates": safe_templates, "total": len(templates)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
async def agent_chat(request: AgentChatRequest, db: Session = Depends(get_db)):
    """智能接待Agent - 多轮对话 + 参数提取 MVP"""
    try:
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

    except Exception as e:
        import traceback
        print(f"❌ agent_chat 错误: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class DirectChatRequest(BaseModel):
    message: str
    image_data: Optional[str] = None

class DirectChatResponse(BaseModel):
    reply: str

@app.post("/api/v1/direct-chat")
async def direct_chat(request: DirectChatRequest):
    """普通对话接口 - 非 Agent，不涉及参数提炼或模板推荐"""
    try:
        system_prompt = """你是 NeoVista 的友好助手。你可以：
- 回答设计相关的问题（建筑、景观、规划、室内、产品等）
- 进行日常对话和闲聊
- 提供创意灵感和建议
- 回答技术问题

你不需要推荐模板或整理生图参数，只需要自然地对话即可。"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.message}
        ]

        reply_raw = await chat_flash(messages, json_mode=False)

        return DirectChatResponse(reply=reply_raw)

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/agent/workspace-chat")
async def workspace_chat(request: WorkspaceChatRequest, db: Session = Depends(get_db)):
    """画布对话Agent - Flash参数拆解 / Pro复杂图片分析"""
    try:
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
- 回复要简洁专业，像一个资深建筑设计顾问"""

        # 构建消息：system + 用户对话历史（限20轮）
        trimmed = request.messages[-40:]  # 20轮 = 40条消息
        messages = [{"role": "system", "content": workspace_system}]
        for m in trimmed:
            if m.role in ("user", "assistant"):
                messages.append({"role": m.role, "content": m.content})

        # 路由：Pro or Flash
        use_pro = should_use_pro(request.image_data)
        model_used = "pro" if use_pro else "flash"

        if use_pro:
            reply_raw = await chat_pro(messages)
        else:
            reply_raw = await chat_flash(messages, json_mode=True)

        # 尝试解析 JSON
        try:
            parsed = json.loads(reply_raw)
            reply_text = parsed.get("reply", reply_raw)
            ready = parsed.get("ready_to_generate", False)
            tpl_id = parsed.get("suggested_template_id")
            params = parsed.get("suggested_params")
        except (json.JSONDecodeError, ValueError):
            reply_text = reply_raw
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

    # 检查积分（本地开发环境暂时禁用）
    # if current_user.credits <= 0:
    #     raise HTTPException(status_code=402, detail="积分不足，请充值")

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
    if request.image_data:
        print("包含画布上下文")
        if request.image_data.startswith("data:"):
            base64_data = request.image_data.split(",")[1]
        else:
            base64_data = request.image_data

        parts.insert(0, {
            "inlineData": {
                "mimeType": "image/png",
                "data": base64_data
            }
        })

    # 计算实际尺寸
    width, height = get_dimensions_from_resolution_and_ratio(request.resolution, request.aspect_ratio)

    print(f"[GENERATE PAYLOAD] template_id={request.template_id}, resolution={request.resolution}, aspect_ratio={request.aspect_ratio}, dimensions={width}x{height}, has_image={bool(request.image_data)}")

    last_error = None
    for channel in API_CHANNELS:
        try:
            print(f"尝试渠道: {channel.name} (分辨率: {request.resolution}, 比例: {request.aspect_ratio}, 尺寸: {width}x{height})")

            url = f"{channel.base_url}/v1/models/{channel.model}:generateContent"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {channel.api_key}"
            }
            payload = {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "responseModalities": ["IMAGE"],
                    "imageConfig": {"aspectRatio": request.aspect_ratio}
                }
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()

            print(f"渠道 {channel.name} 成功")

            # 解析响应
            if "candidates" in data and len(data["candidates"]) > 0:
                parts_response = data["candidates"][0]["content"]["parts"]
                image_data = None
                for part in parts_response:
                    if "inlineData" in part:
                        image_data = part["inlineData"]["data"]
                        break

                if image_data:
                    import time

                    # 扣减积分（本地开发环境暂时禁用）
                    # current_user.credits -= 1
                    # db.commit()

                    return GenerateResponse(
                        image_url=f"data:image/png;base64,{image_data}",
                        timestamp=int(time.time() * 1000)
                    )

        except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
            print(f"⚠️  {format_upstream_error(channel.name, e)}")
            last_error = e
            continue
        except Exception as e:
            print(f"⚠️  渠道 {channel.name} 异常: {str(e)}")
            last_error = e
            continue

    # 所有渠道均失败
    raise HTTPException(
        status_code=map_upstream_failure_status(last_error),
        detail=f"所有API渠道均失败: {format_upstream_error('最后渠道', last_error)}"
    )

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
        is_i2i = template.get('is_i2i', False)
        if is_i2i:
            # 从会话历史中查找最后一张用户上传的图片
            history = json.loads(session.chat_history)
            image_data = None
            for msg in reversed(history):
                if msg.get('role') == 'user' and 'image_data' in msg:
                    image_data = msg['image_data']
                    break

            if not image_data:
                raise HTTPException(status_code=400, detail="此模版需要底图，但会话中未找到图片")

            if image_data.startswith("data:"):
                base64_data = image_data.split(",")[1]
            else:
                base64_data = image_data

            parts.insert(0, {
                "inlineData": {
                    "mimeType": "image/png",
                    "data": base64_data
                }
            })

        # 6. 调用 Google Imagen API
        # 计算实际尺寸
        width, height = get_dimensions_from_resolution_and_ratio(request.resolution, request.aspect_ratio)
        print(f"[GENERATE_DIAGRAM PAYLOAD] template_id={session.template_id}, resolution={request.resolution}, aspect_ratio={request.aspect_ratio}, dimensions={width}x{height}")

        last_error = None
        for channel in API_CHANNELS:
            try:
                url = f"{channel.base_url}/v1/models/{channel.model}:generateContent"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {channel.api_key}"
                }
                payload = {
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE"],
                        "imageConfig": {"aspectRatio": request.aspect_ratio}
                    }
                }

                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()

                # 解析响应
                if "candidates" in data and len(data["candidates"]) > 0:
                    parts_response = data["candidates"][0]["content"]["parts"]
                    image_data = None
                    for part in parts_response:
                        if "inlineData" in part:
                            image_data = part["inlineData"]["data"]
                            break

                    if image_data:
                        import time
                        return GenerateDiagramResponse(
                            image_url=f"data:image/png;base64,{image_data}",
                            timestamp=int(time.time() * 1000)
                        )

            except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
                print(f"渠道 {channel.name} 失败: {e}")
                last_error = e
                continue
            except Exception as e:
                print(f"渠道 {channel.name} 异常: {e}")
                last_error = e
                continue

        raise HTTPException(status_code=500, detail=f"所有渠道失败: {str(last_error)}")

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

        # 5. 调用 Chat 渠道的 Pro 模型进行视觉审图
        for ch in CHAT_CHANNELS:
            try:
                print(f"[审图] 尝试渠道: {ch.name}")

                # 智能拼接 URL
                base = ch.base_url.rstrip('/')
                if base.endswith('/chat/completions'):
                    url = base
                elif base.endswith('/v1'):
                    url = f"{base}/chat/completions"
                else:
                    url = f"{base}/v1/chat/completions"

                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {ch.api_key}"
                }

                payload = {
                    "model": ch.pro_model,
                    "stream": False,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"{system_prompt}\n\n请审核这张建筑分析图"},
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64.b64encode(img_data).decode()}"}}
                            ]
                        }
                    ],
                    "temperature": 0.7,
                    "max_tokens": 4000
                }

                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    data = response.json()
                    text = data["choices"][0]["message"]["content"]
                    print(f"[审图] 返回内容: {text[:200]}...")

                    # 尝试解析 JSON
                    try:
                        result = json.loads(text)
                    except json.JSONDecodeError:
                        # 清理 Markdown 代码块标记
                        text = text.strip()
                        if text.startswith('```'):
                            text = re.sub(r'^```(?:json)?\s*\n', '', text)
                            text = re.sub(r'\n```\s*$', '', text)

                        try:
                            result = json.loads(text)
                        except json.JSONDecodeError:
                            # 尝试提取 JSON 部分
                            json_match = re.search(r'\{.*\}', text, re.DOTALL)
                            if json_match:
                                result = json.loads(json_match.group())
                            else:
                                print(f"[审图] 无法解析 JSON，返回默认响应")
                                return DEFAULT_AUDIT_RESPONSE

                    # 验证并标准化数据结构
                    standardized = {
                        "is_pass": result.get("is_pass", False),
                        "overview": result.get("overview", "审图完成"),
                        "positive": result.get("positive", []),
                        "negative": result.get("negative", []),
                        "suggestions": result.get("suggestions", [])
                    }

                    print(f"[审图] 渠道 {ch.name} 成功")
                    return standardized

            except Exception as e:
                print(f"⚠️  [审图] 渠道 {ch.name} 失败: {e}")
                traceback.print_exc()
                continue

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
