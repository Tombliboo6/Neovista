from fastapi import FastAPI, Form, File, UploadFile, HTTPException
from typing import List
from fastapi.staticfiles import StaticFiles

from google import genai

from google.genai import types

from PIL import Image

import io

import os

import uuid

import json

import sqlite3

from datetime import datetime

from pathlib import Path

import re

from dotenv import load_dotenv



app = FastAPI()

# 1. 加载环境变量 (读取 .env 文件)
load_dotenv()

# 常量定义
IMAGES_DIR = "images"
DB_PATH = "gallery.db"

# 1. 配置图片保存目录
if not os.path.exists(IMAGES_DIR):
    os.makedirs(IMAGES_DIR)

app.mount(f"/{IMAGES_DIR}", StaticFiles(directory=IMAGES_DIR), name=IMAGES_DIR)

# 历史记录文件路径
HISTORY_FILE = f"{IMAGES_DIR}/history.json"

# 2. 初始化 SQLite 数据库
def init_database():

    """初始化画廊数据库"""

    conn = sqlite3.connect(DB_PATH)

    cursor = conn.cursor()

    cursor.execute("""

        CREATE TABLE IF NOT EXISTS gallery_items (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            filename TEXT NOT NULL,

            prompt TEXT NOT NULL,

            aspect_ratio TEXT NOT NULL,

            status TEXT NOT NULL DEFAULT 'pending',

            title TEXT,

            description TEXT,

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

        )

    """)

    # 检查并添加新字段（用于升级现有数据库）

    try:

        cursor.execute("ALTER TABLE gallery_items ADD COLUMN title TEXT")

    except sqlite3.OperationalError:

        pass  # 字段已存在

    try:
        cursor.execute("ALTER TABLE gallery_items ADD COLUMN description TEXT")
    except sqlite3.OperationalError:
        pass  # 字段已存在

    # 添加社交互动字段
    try:
        cursor.execute("ALTER TABLE gallery_items ADD COLUMN likes_count INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE gallery_items ADD COLUMN favorites_count INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # 创建评论表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            username TEXT DEFAULT 'User',
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(item_id) REFERENCES gallery_items(id) ON DELETE CASCADE
        )
    """)
    
    # 添加是否包含参考图字段
    try:
        cursor.execute("ALTER TABLE gallery_items ADD COLUMN has_ref_image BOOLEAN DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # 创建多图关联表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS gallery_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            order_index INTEGER DEFAULT 0,
            FOREIGN KEY(item_id) REFERENCES gallery_items(id) ON DELETE CASCADE
        )
    """)

    conn.commit()
    conn.close()

    print("✅ 画廊数据库初始化完成")



# 启动时初始化数据库

init_database()



# 2. 配置 Google API

API_BASE_URL = os.getenv("GOOGLE_API_BASE")
API_KEY = os.getenv("GOOGLE_API_KEY")

# --- 安全检查 (如果不加这一步，Key没读到时报错很难看) ---
if not API_KEY:
    raise ValueError("❌ 未找到 GOOGLE_API_KEY，请检查 .env 文件是否保存，变量名是否正确。")

if not API_BASE_URL:
    print("⚠️ 警告: 未找到 GOOGLE_API_BASE，将使用 Google 官方默认地址 (国内可能会超时)")
else:
    print(f"🌐 正在使用 Cloudflare 代理: {API_BASE_URL}")
    # 兼容性设置：某些 SDK 版本可能还会读取这个环境变量
    os.environ["GEMINI_NEXT_GEN_API_BASE_URL"] = API_BASE_URL

# 使用 http_options 设置 base_url（推荐方式）
client = genai.Client(
    api_key=API_KEY,
    http_options=types.HttpOptions(base_url=API_BASE_URL)
)



# === 图片压缩功能 ===

def compress_image(image_bytes: bytes, max_size_mb: float = 1.5, step: int = 10) -> bytes:
    """
    压缩图片到指定大小以下
    
    Args:
        image_bytes: 原始图片字节流
        max_size_mb: 最大文件大小（MB），默认 1.5MB
        step: 每次降低的质量步长，默认 10
    
    Returns:
        压缩后的图片字节流
    """
    max_size_bytes = int(max_size_mb * 1024 * 1024)  # 转换为字节
    
    try:
        # 将字节流转为 PIL Image
        pil_image = Image.open(io.BytesIO(image_bytes))
        
        # 如果图片模式是 RGBA，转为 RGB（兼容 JPEG）
        if pil_image.mode == "RGBA":
            # 创建白色背景
            rgb_image = Image.new("RGB", pil_image.size, (255, 255, 255))
            rgb_image.paste(pil_image, mask=pil_image.split()[3])  # 使用 alpha 通道作为 mask
            pil_image = rgb_image
        elif pil_image.mode not in ("RGB", "L"):
            pil_image = pil_image.convert("RGB")
        
        # 循环压缩
        quality = 95
        compressed_bytes = io.BytesIO()
        
        while quality >= 10:
            compressed_bytes.seek(0)
            compressed_bytes.truncate(0)
            
            # 保存为 JPEG 格式
            pil_image.save(compressed_bytes, format="JPEG", quality=quality, optimize=True)
            
            # 检查大小
            current_size = len(compressed_bytes.getvalue())
            if current_size <= max_size_bytes:
                print(f"✅ 图片压缩成功: {len(image_bytes) / 1024 / 1024:.2f}MB -> {current_size / 1024 / 1024:.2f}MB (quality={quality})")
                return compressed_bytes.getvalue()
            
            # 降低质量继续压缩
            quality -= step
        
        # 如果还是太大，返回最后一次压缩的结果（至少尝试了）
        final_bytes = compressed_bytes.getvalue()
        print(f"⚠️ 图片压缩到最低质量仍较大: {len(image_bytes) / 1024 / 1024:.2f}MB -> {len(final_bytes) / 1024 / 1024:.2f}MB")
        return final_bytes
        
    except Exception as e:
        print(f"⚠️ 图片压缩失败: {e}，返回原始图片")
        return image_bytes


# === 中文提示词优化 ===

def optimize_prompt(user_prompt: str):

    print(f"🔄 正在优化中文提示词: {user_prompt}")

    try:

        response = client.models.generate_content(

            model="gemini-2.0-flash",

            contents=f"""

            你是一个专业的AI绘图提示词专家。

            请将用户的以下输入翻译成英文，并扩充细节使其适合高质量绘图。

            

            用户输入: {user_prompt}

            

            请直接输出最终的英文提示词。

            """

        )

        return response.text.strip()

    except Exception as e:

        print(f"⚠️ 翻译失败，使用原提示词: {e}")

        return user_prompt


# === 历史记录管理 ===

def save_to_history(file_id: str, original_prompt: str, optimized_prompt: str, jpg_filename: str):

    """保存图片生成记录到历史文件"""

    try:

        # 读取现有历史记录

        if os.path.exists(HISTORY_FILE):

            with open(HISTORY_FILE, "r", encoding="utf-8") as f:

                history = json.load(f)

        else:

            history = []

        

        # 添加新记录

        history.append({

            "file_id": file_id,

            "prompt": original_prompt,

            "optimized_prompt": optimized_prompt,

            "timestamp": datetime.now().isoformat(),

            "jpg_filename": jpg_filename

        })

        

        # 保存历史记录（只保留最近100条，避免文件过大）

        if len(history) > 100:

            history = history[-100:]

        

        with open(HISTORY_FILE, "w", encoding="utf-8") as f:

            json.dump(history, f, ensure_ascii=False, indent=2)

            

    except Exception as e:

        print(f"⚠️ 保存历史记录失败: {e}")


def get_history() -> list:

    """获取历史记录列表"""

    try:

        if not os.path.exists(HISTORY_FILE):

            return []

        

        with open(HISTORY_FILE, "r", encoding="utf-8") as f:

            history = json.load(f)

        

        # 按时间戳倒序排列（最新的在前）

        history.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        

        # 只返回前5条

        return history[:5]

        

    except Exception as e:

        print(f"⚠️ 读取历史记录失败: {e}")

        return []



# === AI 灵感助手接口 ===

@app.post("/chat")
async def chat_with_ai(
    user_message: str = Form(...),
    history: str = Form(None)
):
    """AI 灵感助手：根据用户输入生成专业的绘画参数 JSON"""
    try:
        system_prompt = """你是 Google Imagen 3 的专家级 Prompt Engineer。
你的任务是维护和更新用户的绘图需求。

**核心规则：**
1. **全程记忆：** 你必须阅读完整的 messages 历史，理解整个对话上下文。
2. **识别选项：** 当用户回复简短的内容（如 "A", "B", "1", "选项一", "写实点", "更暖一些"）时，你必须回头看上一轮对话，找到该选项对应的具体描述（例如 "A" 代表 "Cyberpunk style", "B" 代表 "竹林背景"）。
3. **增量修改 (Incremental Update) - 关键规则：** 
   - 如果用户是在进行多轮对话（比如选择了 "B. 赛博风格"），**必须保留**上一轮 Prompt 中的主体对象、动作、构图等核心元素。
   - **只修改**用户提到的那个维度（如风格、颜色、背景、光影）。
   - **严禁**每次都重新创造一个新场景！例如：如果上一轮是"一只猫坐在窗台上"，用户选择"赛博风格"，应该变成"一只赛博风格的猫坐在未来城市的窗台上"，而不是完全重写。
4. **强制重写 (Rewrite)：** 用户的每一次修改意见，你都必须**立即更新**到 JSON 的 `prompt` 字段中。**绝对不要**照搬上一轮的 Prompt！必须根据用户的最新选择，重新生成一段完整的、包含新细节的英文 Prompt。
5. **立即创作 (Drafting)：** 根据当前所有已知信息（包括用户的最新选择），补充细节（光影、构图、质感、氛围），生成一段**完整的、自然语言风格的**英文 Prompt。要求：
   - 必须是一段流畅的英文段落，不要使用逗号分隔的单词堆砌（Tag soup）
   - 不要使用负面提示词（Negative Prompt）
   - 包含主体、光影、构图、风格和氛围的完整描述
6. **引导对话 (Guiding)：** 在生成 Prompt 之后，用中文向用户提问，引导其优化下一个关键点，并给出 2-3 个具体选项（格式：A. 选项1, B. 选项2, C. 选项3）。

**强制 JSON 输出格式（每次回复必须是 JSON）：**
{
    "thought": "保留了主体[猫]，将风格从[写实]修改为[赛博朋克]，背景从[窗台]改为[未来城市窗台]...",
    "prompt": "Full English prompt with the new changes included... (这里必须是完整的、更新后的英文提示词段落)",
    "prompt_zh": "完整的中文翻译版本，帮助用户理解英文提示词的含义",
    "aspect_ratio": "16:9",
    "bot_response": "已为您切换到赛博风格！\\n\\n接下来您希望调整什么？\\n选项：[A. 暖色调] [B. 冷色调] [C. 自然光]",
    "options": ["A. 暖色调", "B. 冷色调", "C. 自然光"]
}

**重要规则：**
- aspect_ratio 必须是 ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] 中的一个
- prompt 必须是自然语言段落，不是 tag 列表
- prompt_zh 是 prompt 的完整中文翻译，帮助用户理解
- **关键：每次回复的 prompt 必须反映用户的最新选择，不能重复上一轮的 prompt！**
- **增量修改：必须保留上一轮的核心元素，只修改用户指定的维度！**
- thought 字段必须解释你保留了什么，修改了什么
- bot_response 是中文引导语，用于在对话中引导用户
- options 是选项列表，从 bot_response 中提取（格式：["A. 选项1", "B. 选项2", "C. 选项3"]）
- 只返回纯 JSON 字符串，不要包含 Markdown 代码块标记（如 ```json），不要包含其他废话"""

        # 构建完整的对话历史
        conversation_parts = []
        
        # 添加 System Prompt
        conversation_parts.append(system_prompt)
        conversation_parts.append("\n\n=== 对话历史 ===\n")
        
        # 解析并添加历史对话
        if history:
            try:
                history_list = json.loads(history)
                # 只提取 role 和 content，过滤掉其他字段
                for msg in history_list:
                    if isinstance(msg, dict) and "role" in msg and "content" in msg:
                        # 对于 assistant 消息，只保留 content（引导语），不包含 prompt
                        if msg["role"] == "assistant":
                            conversation_parts.append(f"Assistant: {msg['content']}")
                        elif msg["role"] == "user":
                            conversation_parts.append(f"User: {msg['content']}")
            except json.JSONDecodeError as e:
                print(f"⚠️ 历史记录解析失败: {e}，将只使用当前消息")
        
        # 添加当前用户消息
        conversation_parts.append(f"\nUser: {user_message}")
        conversation_parts.append("\n\n请根据以上完整对话历史，理解用户的意图（特别是如果用户选择了选项A/B/C，请找到对应的具体描述），然后生成更新后的 JSON。")
        
        # 构建完整的对话内容
        full_conversation = "\n".join(conversation_parts)
        
        # Debug: 打印对话历史（仅前800字符）
        print(f"📝 对话历史预览 ({len(full_conversation)} 字符): {full_conversation[:800]}...")
        
        # 调用 Gemini Flash 模型，传入完整对话历史
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=full_conversation
        )
        
        raw_text = response.text.strip()
        
        # 尝试提取 JSON（去除可能的 Markdown 代码块标记）
        json_text = raw_text
        # 移除 ```json 和 ``` 标记
        json_text = re.sub(r'^```json\s*', '', json_text, flags=re.MULTILINE)
        json_text = re.sub(r'^```\s*$', '', json_text, flags=re.MULTILINE)
        json_text = json_text.strip()
        
        # 尝试解析 JSON
        try:
            result = json.loads(json_text)
            
            # 验证必需字段
            required_fields = ["thought", "prompt", "aspect_ratio", "bot_response"]
            for field in required_fields:
                if field not in result:
                    raise ValueError(f"缺少必需字段: {field}")
            
            # 如果没有 prompt_zh，尝试从 prompt 生成（可选）
            if "prompt_zh" not in result or not result["prompt_zh"]:
                result["prompt_zh"] = ""  # 设为空字符串，前端会处理
            
            # 如果没有 options，尝试从 bot_response 中提取
            if "options" not in result or not result["options"]:
                # 尝试从 bot_response 中提取选项（格式：选项：[A. xxx] [B. xxx]）
                options_match = re.findall(r'\[([A-Z]\.\s*[^\]]+)\]', result.get("bot_response", ""))
                result["options"] = options_match if options_match else []
            
            # 验证 aspect_ratio 是否在允许的列表中
            valid_ratios = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']
            if result["aspect_ratio"] not in valid_ratios:
                # 如果不在列表中，使用默认值
                result["aspect_ratio"] = "16:9"
            
            return result
            
        except json.JSONDecodeError as e:
            # JSON 解析失败，返回 500 错误和原始文本
            print(f"⚠️ JSON 解析失败: {e}")
            print(f"原始响应: {raw_text}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "AI 返回的格式不正确，无法解析 JSON",
                    "raw_response": raw_text
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 聊天接口错误: {e}")
        raise HTTPException(
            status_code=500,
            detail={"error": str(e)}
        )


# === 核心接口 ===

@app.post("/generate")

async def generate_image(

    prompt: str = Form(...),

    aspect_ratio: str = Form("16:9"),

    image: UploadFile = File(None)

):

    # 1. 提示词优化

    final_prompt = optimize_prompt(prompt)
    
    # 2. 提取并添加图片比例到 prompt 中
    # 现在 aspect_ratio 格式是 "16:9" 或 "1:1" 等，直接使用即可
    ratio_value = aspect_ratio.strip() if aspect_ratio else "16:9"
    final_prompt = f"{final_prompt}, aspect ratio {ratio_value}"

    

    try:

        # 3. 准备内容 (文字 + 可选的图片)

        contents = [final_prompt]

        if image:

            print(f"📂 收到参考图: {image.filename}")

            img_bytes = await image.read()
            
            # 压缩图片（如果过大）
            original_size_mb = len(img_bytes) / 1024 / 1024
            if original_size_mb > 2.5:
                print(f"📦 图片大小 {original_size_mb:.2f}MB，开始压缩...")
                img_bytes = compress_image(img_bytes, max_size_mb=1.5)
            
            # 使用压缩后的字节流创建 PIL Image
            pil_image = Image.open(io.BytesIO(img_bytes))

            contents.append(pil_image)



        # 4. 调用绘图模型

        print("🎨 开始请求绘图...")

        response = client.models.generate_content(

            model="gemini-3-pro-image-preview",

            contents=contents,

            config=types.GenerateContentConfig(

                response_modalities=["IMAGE"],

            )

        )



        # 5. 保存结果 (同时保存 PNG 和 JPEG)

        for part in response.candidates[0].content.parts:

            if part.inline_data:

                # 生成唯一 ID

                file_id = str(uuid.uuid4())

                

                # === A. 保存高清 PNG 原图 (用于下载，无损格式) ===
                png_filename = f"{file_id}.png"
                png_path = f"images/{png_filename}"
                
                try:
                    # 读取原始图片
                    img_original = Image.open(io.BytesIO(part.inline_data.data))
                    
                    # 强制放大 2 倍 (Upscale 2x)
                    # 使用 LANCZOS 滤镜保证放大后的清晰度
                    width, height = img_original.size
                    new_size = (width * 2, height * 2)
                    img_upscaled = img_original.resize(new_size, Image.Resampling.LANCZOS)
                    
                    # 保存放大后的 PNG
                    img_upscaled.save(png_path, "PNG")
                    print(f"✅ 已保存 Upscale 2x 无损 PNG 原图: {png_filename} ({new_size})")
                    
                except Exception as e:
                    print(f"⚠️ 图片放大保存失败，回退到原始保存: {e}")
                    with open(png_path, "wb") as f:
                        f.write(part.inline_data.data)

                

                # === B. 保存压缩 JPEG 预览图 (用于网页显示) ===

                jpg_filename = f"{file_id}.jpg"

                jpg_path = f"images/{jpg_filename}"

                try:

                    # 重新打开图片数据（因为上面可能已经消耗了 BytesIO）

                    img_for_jpg = Image.open(io.BytesIO(part.inline_data.data))

                    # 如果图片有透明度，需要转换为 RGB（JPEG 不支持透明度）

                    if img_for_jpg.mode in ("RGBA", "LA", "P"):

                        # 创建白色背景

                        rgb_image = Image.new("RGB", img_for_jpg.size, (255, 255, 255))

                        if img_for_jpg.mode == "P" and "transparency" in img_for_jpg.info:

                            img_for_jpg = img_for_jpg.convert("RGBA")

                        if img_for_jpg.mode in ("RGBA", "LA"):

                            rgb_image.paste(img_for_jpg, mask=img_for_jpg.split()[-1])

                        else:

                            rgb_image.paste(img_for_jpg)

                        img_for_jpg = rgb_image

                    elif img_for_jpg.mode not in ("RGB", "L"):

                        img_for_jpg = img_for_jpg.convert("RGB")

                    img_for_jpg.save(jpg_path, "JPEG", quality=85, optimize=True)

                    print(f"✅ 已保存 JPEG 预览图: {jpg_filename}")

                except Exception as e:

                    print(f"⚠️ JPEG 预览图保存失败: {e}")

                

                # === C. 保存到历史记录 ===

                save_to_history(file_id, prompt, final_prompt, jpg_filename)

                

                # === D. 返回两个链接 ===

                # 这里假设你的域名已经配置好，如果是 IP 访问请换回 IP

                base_url = "http://NeoVista.cn/images"

                

                return {

                    "preview_url": f"{base_url}/{jpg_filename}",  # 预览用小图

                    "download_url": f"{base_url}/{png_filename}", # 下载用大图

                    "optimized_prompt": final_prompt

                }

                

    except Exception as e:

        print(f"❌ 画图失败: {e}")
        
        # 优化错误显示：如果是 HTML 错误（如 Cloudflare 报错），提取核心信息
        error_str = str(e)
        
        # 检查是否包含 HTML 标签
        if "<html" in error_str.lower() or "<!doctype" in error_str.lower():
            # 尝试提取状态码
            status_match = re.search(r'(\d{3})', error_str)
            if status_match:
                status_code = status_match.group(1)
                if status_code in ["502", "500", "504"]:
                    error_message = f"Google API 服务暂时不可用（错误代码: {status_code}），请稍后重试"
                else:
                    error_message = f"Google API 请求失败（错误代码: {status_code}）"
            else:
                error_message = "Google API 服务暂时不可用或超时，请稍后重试"
        # 检查是否是超时错误
        elif "timeout" in error_str.lower() or "timed out" in error_str.lower():
            error_message = "Google API 请求超时，图片可能过大，请尝试使用更小的图片或稍后重试"
        # 检查是否是 502/500 错误
        elif "502" in error_str or "500" in error_str or "504" in error_str:
            error_message = "Google API 服务暂时不可用，请稍后重试"
        else:
            # 其他错误，返回原始错误信息（但截断过长的内容）
            if len(error_str) > 500:
                error_message = error_str[:500] + "...（错误信息过长，已截断）"
            else:
                error_message = error_str
        
        return {"error": error_message}



    return {"error": "生成失败"}


# === 历史记录接口 ===

@app.get("/history")

async def get_history_endpoint():

    """返回最近5张生成图片的历史记录"""

    try:

        history = get_history()

        base_url = "http://NeoVista.cn/images"

        

        # 构建返回数据

        images = []

        for item in history:

            jpg_filename = item.get("jpg_filename", "")

            if jpg_filename and os.path.exists(f"images/{jpg_filename}"):

                images.append({

                    "url": f"{base_url}/{jpg_filename}",

                    "prompt": item.get("prompt", ""),

                    "optimized_prompt": item.get("optimized_prompt", ""),

                    "timestamp": item.get("timestamp", "")

                })

        

        return {"images": images}

        

    except Exception as e:

        print(f"❌ 获取历史记录失败: {e}")

        return {"images": [], "error": str(e)}


# === 画廊接口 ===

@app.post("/gallery/upload")
async def gallery_upload(
    files: List[UploadFile] = File(None),
    filename: str = Form(None),
    filenames: str = Form(None),
    prompt: str = Form(...),
    ratio: str = Form(...),
    title: str = Form(None),
    description: str = Form(None),
    has_ref_image: bool = Form(False)
):
    """用户投稿到画廊（支持多图；兼容 filename/filenames 引用已有文件）"""
    try:
        resolved_filenames: List[str] = []

        if files:
            if len(files) > 9:
                return {"success": False, "error": "最多只能上传9张图片"}

            for file in files:
                if not file or not file.filename:
                    continue

                image_bytes = await file.read()
                compressed_bytes = compress_image(image_bytes)

                saved_filename = f"{uuid.uuid4()}.jpg"
                filepath = os.path.join(IMAGES_DIR, saved_filename)

                with open(filepath, "wb") as f:
                    f.write(compressed_bytes)
                resolved_filenames.append(saved_filename)
        else:
            raw_list: List[str] = []
            if filenames:
                try:
                    parsed = json.loads(filenames)
                    if isinstance(parsed, list):
                        raw_list = [str(x) for x in parsed]
                    else:
                        raw_list = [str(parsed)]
                except Exception:
                    raw_list = [x.strip() for x in filenames.split(",") if x.strip()]
            elif filename:
                raw_list = [filename]

            raw_list = [x for x in raw_list if x]
            if len(raw_list) > 9:
                return {"success": False, "error": "最多只能上传9张图片"}

            for fname in raw_list:
                safe_name = os.path.basename(fname)
                if safe_name != fname:
                    return {"success": False, "error": "文件名非法"}
                path = os.path.join(IMAGES_DIR, safe_name)
                if not os.path.exists(path):
                    return {"success": False, "error": f"文件不存在: {safe_name}"}
                resolved_filenames.append(safe_name)

        if not resolved_filenames:
            return {"success": False, "error": "未找到可投稿的图片"}

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cover_filename = resolved_filenames[0]

        cursor.execute("""
            INSERT INTO gallery_items (filename, prompt, aspect_ratio, status, title, description, has_ref_image)
            VALUES (?, ?, ?, 'pending', ?, ?, ?)
        """, (cover_filename, prompt, ratio, title, description, has_ref_image))
        
        item_id = cursor.lastrowid
        
        # 2. 插入图片关联记录
        for idx, fname in enumerate(resolved_filenames):
            cursor.execute("""
                INSERT INTO gallery_images (item_id, filename, order_index)
                VALUES (?, ?, ?)
            """, (item_id, fname, idx))

        conn.commit()
        conn.close()
        return {"success": True, "id": item_id, "message": "投稿成功，等待审核"}
    except Exception as e:
        print(f"❌ 投稿失败: {e}")
        return {"success": False, "error": str(e)}


@app.get("/gallery/approved")
def get_approved_gallery():
    """获取审核通过的画廊内容（包含多图信息）"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 1. 获取所有通过审核的作品
        cursor.execute("""
            SELECT id, filename, prompt, aspect_ratio, title, description, created_at, likes_count, favorites_count, has_ref_image
            FROM gallery_items
            WHERE status = 'approved'
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()
        
        # 2. 获取所有相关的图片
        # 一次性查出所有关联图片，避免 N+1 查询
        cursor.execute("""
            SELECT item_id, filename 
            FROM gallery_images 
            ORDER BY order_index ASC
        """)
        image_rows = cursor.fetchall()
        
        conn.close()

        # 构建 item_id -> [filenames] 的映射
        images_map = {}
        for item_id, fname in image_rows:
            if item_id not in images_map:
                images_map[item_id] = []
            images_map[item_id].append(fname)

        base_url = "http://NeoVista.cn/images"
        items = []

        for row in rows:
            item_id = row[0]
            cover_filename = row[1]
            
            # 获取该作品的所有图片
            item_filenames = images_map.get(item_id, [])
            
            # 兼容性处理：如果 gallery_images 表里没有数据（旧数据），则使用 gallery_items 的 filename
            if not item_filenames and cover_filename:
                item_filenames = [cover_filename]
                
            # 构建图片 URL 列表
            image_urls = [f"{base_url}/{fname}" for fname in item_filenames]
            
            items.append({
                "id": item_id,
                "filename": cover_filename,
                "url": image_urls[0] if image_urls else "", # 封面图 URL，兼容旧前端
                "image_urls": image_urls, # 新增字段：所有图片 URL
                "prompt": row[2],
                "aspect_ratio": row[3],
                "title": row[4],
                "description": row[5],
                "created_at": row[6],
                "likes_count": row[7] or 0,
                "favorites_count": row[8] or 0,
                "has_ref_image": bool(row[9])
            })
            
        return {"items": items}
    except Exception as e:
        print(f"❌ 获取画廊失败: {e}")
        return {"error": str(e)}


@app.get("/gallery/pending")

async def gallery_pending():

    """获取所有待审核的图片"""

    try:

        conn = sqlite3.connect(DB_PATH)

        cursor = conn.cursor()

        cursor.execute("""

            SELECT id, filename, prompt, aspect_ratio, title, description, created_at

            FROM gallery_items

            WHERE status = 'pending'

            ORDER BY created_at DESC

        """)

        rows = cursor.fetchall()

        conn.close()

        base_url = "http://NeoVista.cn/images"

        items = []

        for row in rows:

            items.append({

                "id": row[0],

                "filename": row[1],

                "url": f"{base_url}/{row[1]}",

                "prompt": row[2],

                "aspect_ratio": row[3],

                "title": row[4],

                "description": row[5],

                "created_at": row[6]

            })

        return {"items": items}

    except Exception as e:

        print(f"❌ 获取待审核图片失败: {e}")

        return {"items": [], "error": str(e)}


@app.post("/gallery/like")
async def gallery_like(item_id: int = Form(...), action: str = Form(...)):
    """点赞/取消点赞"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        if action == "like":
            cursor.execute("UPDATE gallery_items SET likes_count = likes_count + 1 WHERE id = ?", (item_id,))
        elif action == "unlike":
            cursor.execute("UPDATE gallery_items SET likes_count = MAX(0, likes_count - 1) WHERE id = ?", (item_id,))
            
        conn.commit()
        
        # 获取最新点赞数
        cursor.execute("SELECT likes_count FROM gallery_items WHERE id = ?", (item_id,))
        new_count = cursor.fetchone()[0]
        
        conn.close()
        return {"success": True, "new_count": new_count}
    except Exception as e:
        print(f"❌ 点赞失败: {e}")
        return {"success": False, "error": str(e)}

@app.post("/gallery/favorite")
async def gallery_favorite(item_id: int = Form(...), action: str = Form(...)):
    """收藏/取消收藏"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        if action == "add":
            cursor.execute("UPDATE gallery_items SET favorites_count = favorites_count + 1 WHERE id = ?", (item_id,))
        elif action == "remove":
            cursor.execute("UPDATE gallery_items SET favorites_count = MAX(0, favorites_count - 1) WHERE id = ?", (item_id,))
            
        conn.commit()
        
        # 获取最新收藏数
        cursor.execute("SELECT favorites_count FROM gallery_items WHERE id = ?", (item_id,))
        new_count = cursor.fetchone()[0]
        
        conn.close()
        return {"success": True, "new_count": new_count}
    except Exception as e:
        print(f"❌ 收藏失败: {e}")
        return {"success": False, "error": str(e)}

@app.get("/gallery/comments/{item_id}")
async def get_comments(item_id: int):
    """获取评论列表"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, username, content, created_at 
            FROM comments 
            WHERE item_id = ? 
            ORDER BY created_at DESC
        """, (item_id,))
        rows = cursor.fetchall()
        conn.close()
        
        comments = []
        for row in rows:
            comments.append({
                "id": row[0],
                "username": row[1],
                "content": row[2],
                "created_at": row[3]
            })
        return {"comments": comments}
    except Exception as e:
        print(f"❌ 获取评论失败: {e}")
        return {"comments": [], "error": str(e)}

@app.post("/gallery/comment")
async def post_comment(item_id: int = Form(...), content: str = Form(...), username: str = Form("User")):
    """发表评论"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO comments (item_id, content, username)
            VALUES (?, ?, ?)
        """, (item_id, content, username))
        conn.commit()
        comment_id = cursor.lastrowid
        conn.close()
        return {"success": True, "id": comment_id}
    except Exception as e:
        print(f"❌ 发表评论失败: {e}")
        return {"success": False, "error": str(e)}

@app.post("/gallery/update")
async def gallery_update(
    item_id: int = Form(...),
    title: str = Form(None),
    description: str = Form(None),
    prompt: str = Form(None),
    aspect_ratio: str = Form(None),
    files: List[UploadFile] = File(None)
):
    """更新画廊图片信息（支持新增图片）"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 1. 如果有新文件上传，追加到 gallery_images
        if files:
            # 获取当前该作品的图片数量，以便确定 order_index
            cursor.execute("SELECT COUNT(*) FROM gallery_images WHERE item_id = ?", (item_id,))
            current_count = cursor.fetchone()[0]
            
            for idx, file in enumerate(files):
                # 检查文件类型
                if file.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
                    continue
                
                # 读取并保存新文件
                image_bytes = await file.read()
                compressed_bytes = compress_image(image_bytes)
                
                ext = Path(file.filename).suffix or ".jpg"
                new_filename = f"{uuid.uuid4()}{ext}"
                new_filepath = os.path.join(IMAGES_DIR, new_filename)
                
                with open(new_filepath, "wb") as f:
                    f.write(compressed_bytes)
                
                # 插入新记录
                cursor.execute("""
                    INSERT INTO gallery_images (item_id, filename, order_index)
                    VALUES (?, ?, ?)
                """, (item_id, new_filename, current_count + idx))
                
                # 如果是第一张图（可能是旧数据迁移或者完全新增），同时也更新 gallery_items.filename 以保持封面一致
                if current_count == 0 and idx == 0:
                     cursor.execute("UPDATE gallery_items SET filename = ? WHERE id = ?", (new_filename, item_id))

        # 2. 更新文本字段
        if title is not None:
            cursor.execute("UPDATE gallery_items SET title = ? WHERE id = ?", (title, item_id))
        if description is not None:
            cursor.execute("UPDATE gallery_items SET description = ? WHERE id = ?", (description, item_id))
        if prompt is not None:
            cursor.execute("UPDATE gallery_items SET prompt = ? WHERE id = ?", (prompt, item_id))
        if aspect_ratio is not None:
            cursor.execute("UPDATE gallery_items SET aspect_ratio = ? WHERE id = ?", (aspect_ratio, item_id))
            
        conn.commit()
        conn.close()
        return {"success": True}
        
    except Exception as e:
        print(f"❌ 更新失败: {e}")
        return {"success": False, "error": str(e)}

@app.post("/gallery/audit")

async def gallery_audit(

    item_id: int = Form(...),

    action: str = Form(...)

):

    """管理员审核（通过或拒绝）"""

    try:

        if action not in ["approve", "reject"]:

            return {"success": False, "error": "无效的操作，必须是 'approve' 或 'reject'"}

        new_status = "approved" if action == "approve" else "rejected"

        conn = sqlite3.connect(DB_PATH)

        cursor = conn.cursor()

        cursor.execute("""

            UPDATE gallery_items

            SET status = ?

            WHERE id = ?

        """, (new_status, item_id))

        conn.commit()

        conn.close()

        return {"success": True, "message": f"操作成功：{action}"}

    except Exception as e:

        print(f"❌ 审核操作失败: {e}")

        return {"success": False, "error": str(e)}


@app.post("/gallery/admin/upload")

async def gallery_admin_upload(

    files: List[UploadFile] = File(...),

    title: str = Form(None),

    prompt: str = Form(...),

    description: str = Form(None),

    aspect_ratio: str = Form(...),
    has_ref_image: bool = Form(False)

):

    """管理员直接上传图片到画廊（状态直接设为 approved，支持多图）"""

    try:

        if not files:
            return {"success": False, "error": "未选择文件"}

        if len(files) > 9:
            return {"success": False, "error": "最多只能上传9张图片"}

        stored_filenames: List[str] = []

        for file in files:
            if not file or not file.filename:
                continue

            file_ext = os.path.splitext(file.filename)[1] or ".jpg"
            file_ext_lower = file_ext.lower()

            if file.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
                return {"success": False, "error": f"不支持的文件类型: {file.content_type}"}

            file_id = str(uuid.uuid4())
            raw_filename = f"{file_id}{file_ext_lower}"
            raw_path = os.path.join(IMAGES_DIR, raw_filename)

            file_bytes = await file.read()

            with open(raw_path, "wb") as f:
                f.write(file_bytes)

            stored_filename = raw_filename
            if file_ext_lower == ".png":
                try:
                    img = Image.open(io.BytesIO(file_bytes))
                    jpg_filename = f"{file_id}.jpg"
                    jpg_path = os.path.join(IMAGES_DIR, jpg_filename)
                    img.save(jpg_path, "JPEG", quality=85, optimize=True)
                    stored_filename = jpg_filename
                except Exception as e:
                    print(f"⚠️ 生成 JPG 预览图失败: {e}")

            stored_filenames.append(stored_filename)

        if not stored_filenames:
            return {"success": False, "error": "未找到可用的图片文件"}

        cover_filename = stored_filenames[0]

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO gallery_items (filename, prompt, aspect_ratio, status, title, description, has_ref_image)
            VALUES (?, ?, ?, 'approved', ?, ?, ?)
            """,
            (cover_filename, prompt, aspect_ratio, title, description, has_ref_image),
        )

        item_id = cursor.lastrowid

        for idx, fname in enumerate(stored_filenames):
            cursor.execute(
                """
                INSERT INTO gallery_images (item_id, filename, order_index)
                VALUES (?, ?, ?)
                """,
                (item_id, fname, idx),
            )

        conn.commit()
        conn.close()

        return {"success": True, "id": item_id, "message": "管理员上传成功，已直接发布"}

    except Exception as e:

        print(f"❌ 管理员上传失败: {e}")

        return {"success": False, "error": str(e)}


@app.delete("/gallery/delete/{item_id}")
async def gallery_delete(item_id: int):
    """删除整个画廊作品"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 1. 获取该作品所有图片文件
        cursor.execute("SELECT filename FROM gallery_images WHERE item_id = ?", (item_id,))
        image_rows = cursor.fetchall()
        
        # 兼容性：如果 gallery_images 没有记录，检查 gallery_items 的 filename
        if not image_rows:
            cursor.execute("SELECT filename FROM gallery_items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if row and row[0]:
                image_rows = [(row[0],)]
        
        # 2. 删除数据库记录
        cursor.execute("DELETE FROM gallery_items WHERE id = ?", (item_id,))
        # gallery_images 和 comments 会因 ON DELETE CASCADE 自动删除
        
        conn.commit()
        conn.close()
        
        # 3. 删除磁盘文件
        for (filename,) in image_rows:
            if filename:
                filepath = os.path.join(IMAGES_DIR, filename)
                if os.path.exists(filepath):
                    try:
                        os.remove(filepath)
                    except Exception as e:
                        print(f"删除文件失败: {filepath}, {e}")
                        
                # 同时也尝试删除 png 原图
                png_path = os.path.join(IMAGES_DIR, f"{filename.split('.')[0]}.png")
                if os.path.exists(png_path):
                     try:
                        os.remove(png_path)
                     except:
                         pass

        return {"success": True}
    except Exception as e:
        print(f"❌ 删除失败: {e}")
        return {"success": False, "error": str(e)}

@app.post("/gallery/delete_image")
async def gallery_delete_image(item_id: int = Form(...), filename: str = Form(...)):
    """删除画廊作品中的单张图片"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 1. 检查是否是最后一张图片
        cursor.execute("SELECT COUNT(*) FROM gallery_images WHERE item_id = ?", (item_id,))
        count = cursor.fetchone()[0]
        
        # 如果是最后一张，不允许删除（必须通过删除整个作品来操作），或者删除后作品就没图了
        # 这里策略：如果只剩一张，提示用户去删除整个作品
        if count <= 1:
             # 再次检查 gallery_items 里的 filename 是否也只有这张
             cursor.execute("SELECT filename FROM gallery_items WHERE id = ?", (item_id,))
             cover = cursor.fetchone()[0]
             if cover == filename or count == 1:
                 conn.close()
                 return {"success": False, "error": "这是最后一张图片，请直接删除整个作品"}

        # 2. 删除 gallery_images 记录
        cursor.execute("DELETE FROM gallery_images WHERE item_id = ? AND filename = ?", (item_id, filename))
        
        # 3. 检查是否删除了封面图 (gallery_items.filename)
        cursor.execute("SELECT filename FROM gallery_items WHERE id = ?", (item_id,))
        current_cover = cursor.fetchone()[0]
        
        if current_cover == filename:
            # 需要更新封面图为剩下的第一张
            cursor.execute("SELECT filename FROM gallery_images WHERE item_id = ? ORDER BY order_index ASC LIMIT 1", (item_id,))
            new_cover_row = cursor.fetchone()
            if new_cover_row:
                new_cover = new_cover_row[0]
                cursor.execute("UPDATE gallery_items SET filename = ? WHERE id = ?", (new_cover, item_id))
            else:
                # 理论上不会走到这，因为前面检查了 count <= 1
                cursor.execute("UPDATE gallery_items SET filename = '' WHERE id = ?", (item_id,))
        
        conn.commit()
        conn.close()
        
        # 4. 删除磁盘文件
        if filename:
            filepath = os.path.join(IMAGES_DIR, filename)
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    print(f"删除文件失败: {filepath}, {e}")
                    
            # 同时也尝试删除 png 原图
            png_path = os.path.join(IMAGES_DIR, f"{filename.split('.')[0]}.png")
            if os.path.exists(png_path):
                    try:
                        os.remove(png_path)
                    except:
                        pass
                        
        return {"success": True}
    except Exception as e:
        print(f"❌ 删除图片失败: {e}")
        return {"success": False, "error": str(e)}
        return {"success": False, "error": str(e)}
