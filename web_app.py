import streamlit as st
import requests
from PIL import Image
import io
import json
import html
from streamlit_image_select import image_select

def _preview_text(value, max_len: int) -> str:
    text = " ".join((value or "").split())
    if len(text) <= max_len:
        return text
    return text[:max_len].rstrip() + "…"

# 本地回环地址
API_URL = "http://127.0.0.1:8000/generate"
CHAT_URL = "http://127.0.0.1:8000/chat"
HISTORY_URL = "http://127.0.0.1:8000/history"
GALLERY_UPLOAD_URL = "http://127.0.0.1:8000/gallery/upload"
GALLERY_APPROVED_URL = "http://127.0.0.1:8000/gallery/approved"

# 初始化 session_state
if "user_prompt" not in st.session_state:
    st.session_state.user_prompt = ""
if "selected_ratio" not in st.session_state:
    st.session_state.selected_ratio = "16:9"
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "auto_submit" not in st.session_state:
    st.session_state.auto_submit = False

st.set_page_config(page_title="NeoVista AI", page_icon="🎨", layout="wide")
st.title("🎨 NeoVista AI Studio")

# 处理 Toast 消息
if "toast_message" in st.session_state:
    st.toast(st.session_state.toast_message, icon="✨")
    del st.session_state.toast_message

st.divider()
with st.expander("🤖 灵感助手 (AI Agent)", expanded=False):
    st.markdown("💡 描述你的想法，AI 会实时生成并优化提示词")
    for idx, message in enumerate(st.session_state.chat_history):
        if message["role"] == "user":
            with st.chat_message("user"):
                st.write(message["content"])
        elif message["role"] == "assistant":
            with st.chat_message("assistant"):
                st.write(message["content"])

                if "prompt_zh" in message and message["prompt_zh"]:
                    st.info(f"🇨🇳 中文释义: {message['prompt_zh']}")

                if "options" in message and message["options"] and len(message["options"]) > 0:
                    st.markdown("**快速选择：**")
                    cols = st.columns(len(message["options"]))
                    for col_idx, option in enumerate(message["options"]):
                        with cols[col_idx]:
                            option_label = option.split(".", 1)[0].strip() if "." in option else option[:1]
                            button_key = f"option_btn_{idx}_{col_idx}_{hash(str(option))}"
                            if st.button(option, key=button_key, use_container_width=True):
                                st.session_state.pending_chat_input = option_label
                                st.rerun()

                if "prompt" in message:
                    with st.expander("📝 查看当前提示词"):
                        st.code(message["prompt"], language="text")

                    apply_button_key = f"apply_btn_{idx}_{hash(str(message.get('prompt', '')))}"
                    if st.button("✨ 采用此方案 (并自动生成)", key=apply_button_key, type="primary"):
                        st.session_state.user_prompt = message.get("prompt", "")
                        st.session_state.selected_ratio = message.get("aspect_ratio", "16:9")
                        st.session_state.auto_submit = True
                        st.rerun()

    chat_input = None
    if "pending_chat_input" in st.session_state and st.session_state.pending_chat_input:
        chat_input = st.session_state.pending_chat_input
        del st.session_state.pending_chat_input
    else:
        chat_input = st.chat_input("💬 告诉 AI 你的创意想法或修改意见...", key="chat_input")

    if chat_input:
        st.session_state.chat_history.append({"role": "user", "content": chat_input})

        history_for_backend = []
        for msg in st.session_state.chat_history:
            if isinstance(msg, dict) and "role" in msg and "content" in msg:
                history_for_backend.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        with st.spinner("🤔 AI 正在思考并生成..."):
            try:
                history_json = json.dumps(history_for_backend, ensure_ascii=False)
                chat_response = requests.post(
                    CHAT_URL,
                    data={
                        "user_message": chat_input,
                        "history": history_json
                    },
                    timeout=30
                )

                if chat_response.status_code == 200:
                    ai_result = chat_response.json()

                    st.session_state.user_prompt = ai_result.get("prompt", "")
                    st.session_state.selected_ratio = ai_result.get("aspect_ratio", "16:9")

                    bot_response = ai_result.get("bot_response", "")
                    st.session_state.chat_history.append({
                        "role": "assistant",
                        "content": bot_response,
                        "prompt": ai_result.get("prompt", ""),
                        "prompt_zh": ai_result.get("prompt_zh", ""),
                        "aspect_ratio": ai_result.get("aspect_ratio", "16:9"),
                        "options": ai_result.get("options", [])
                    })

                    st.rerun()
                else:
                    try:
                        error_data = chat_response.json()
                        if isinstance(error_data, dict):
                            if "detail" in error_data:
                                detail = error_data["detail"]
                                if isinstance(detail, dict):
                                    error_msg = detail.get("error", "未知错误")
                                    raw_response = detail.get("raw_response")
                                else:
                                    error_msg = str(detail)
                                    raw_response = None
                            else:
                                error_msg = error_data.get("error", "未知错误")
                                raw_response = error_data.get("raw_response")
                        else:
                            error_msg = "未知错误"
                            raw_response = None

                        st.error(f"❌ AI 助手错误: {error_msg}")
                        if raw_response:
                            st.code(raw_response, language="text")
                    except:
                        st.error(f"❌ AI 助手错误: HTTP {chat_response.status_code}")
            except Exception as e:
                st.error(f"连接失败: {e}")

    if st.session_state.chat_history:
        if st.button("🗑️ 清空对话", key="clear_chat"):
            st.session_state.chat_history = []
            st.rerun()

st.divider()

with st.sidebar:
    st.header("📚 历史记录")
    try:
        history_response = requests.get(HISTORY_URL, timeout=5)
        if history_response.status_code == 200:
            history_data = history_response.json()
            images = history_data.get("images", [])
            if images:
                for item in images:
                    image_url = item.get("url")
                    prompt_text = item.get("prompt", "")
                    if image_url:
                        st.image(image_url, use_container_width=True)
                        if prompt_text:
                            st.caption(f"💭 {prompt_text[:50]}..." if len(prompt_text) > 50 else f"💭 {prompt_text}")
                        st.divider()
            else:
                st.info("暂无历史记录")
        else:
            st.warning("无法加载历史记录")
    except Exception as e:
        st.warning(f"加载历史记录失败: {e}")

# === 输入区域 ===
with st.form("my_form"):
    # 增加提示词输入框高度
    prompt = st.text_area(
        "✨ 描述你的创意:", 
        height=300,  # 增大高度，方便长文本编辑
        value=st.session_state.user_prompt,
        key="user_prompt",
        help="详细描述画面内容、风格、光影等细节"
    )
    
    st.markdown("---")
    
    # 优化上传区域布局：使用两列，左侧说明，右侧上传，或直接缩小上传组件占比
    # 这里我们简单直接地修正文案并放在一个 expander 或者紧凑布局中
    # 修正 Limit 提示为实际的 10MB
    uploaded_file = st.file_uploader(
        "🖼️ 上传参考图 (可选) - Limit 10MB", 
        type=["jpg", "png", "jpeg"],
        help="上传一张参考图，AI 将参考其构图或色彩。文件大小限制 10MB。"
    )
    
    submitted = st.form_submit_button("🚀 开始创作", type="primary", use_container_width=True)

# === 逻辑处理 ===
# 定义 should_generate：按钮提交 或 自动提交触发
should_generate = submitted or st.session_state.get("auto_submit", False)

# 使用当前会话里的比例（无 UI 选择器）
aspect_ratio = st.session_state.selected_ratio

# 如果自动提交被触发，使用 session_state 中的值
if st.session_state.get("auto_submit", False) and st.session_state.user_prompt:
    prompt = st.session_state.user_prompt
    aspect_ratio = st.session_state.selected_ratio
    # 重置 auto_submit 标志，防止死循环
    st.session_state.auto_submit = False

if should_generate and prompt:
    # 检查上传文件的大小和分辨率
    file_valid = True
    if uploaded_file:
        # 检查文件大小
        if uploaded_file.size > 10 * 1024 * 1024:  # 5MB
            st.error("图片太大！请上传 10MB 以内的图片")
            file_valid = False
        else:
            # 检查图片分辨率
            try:
                # 读取图片文件
                image_bytes = uploaded_file.read()
                image = Image.open(io.BytesIO(image_bytes))
                
                if image.width > 4000 or image.height > 4000:
                    st.error("分辨率太高！请使用 4000x4000 像素以内的图片")
                    file_valid = False
                else:
                    # 重置文件指针，以便后续使用
                    uploaded_file.seek(0)
            except Exception as img_err:
                st.error(f"无法读取图片: {img_err}")
                file_valid = False
    
    # 只有通过检查才继续处理
    if file_valid:
        with st.spinner("🎨 AI 正在挥洒创意..."):
            try:
                # 构造请求
                data = {
                    "prompt": prompt,
                    "aspect_ratio": aspect_ratio
                }
                files = {"image": (uploaded_file.name, uploaded_file, uploaded_file.type)} if uploaded_file else None

                response = requests.post(API_URL, data=data, files=files)
            
                if response.status_code == 200:
                    res = response.json()
                    
                    # 检查是否有错误
                    if "error" in res:
                        error_msg = res.get("error", "未知错误")
                        st.error(f"❌ 生成失败: {error_msg}")
                        # 如果是地理位置限制，给出友好提示
                        if "location" in error_msg.lower() or "not supported" in error_msg.lower():
                            st.warning("⚠️ 提示：当前地理位置可能不支持该 API，请检查 API 配置或使用 VPN。")
                    else:
                    # 获取两个不同的链接
                    # 兼容旧代码：如果后端只返回了 url，就把它当作预览图
                        preview_url = res.get("preview_url") or res.get("url")
                        download_url = res.get("download_url") or res.get("url") # 新增的 PNG 链接
                    
                    if preview_url:
                        st.success("创作完成！")
                        
                        # 1. 展示预览图 (JPG)
                        st.image(preview_url, caption="预览图 (JPEG)", use_container_width=True)
                        
                        # 2. 生成下载按钮 (PNG)
                        if download_url:
                            # 这是一个小技巧：前端服务器替用户去拿高清图数据
                            # 如果是 localhost 环境，这里会自动请求 NeoVista.cn/images/...
                            try:
                                # 下载 PNG 图片的二进制数据
                                png_data = requests.get(download_url).content
                                
                                # 创建下载按钮
                                st.download_button(
                                    label="📥 下载高清原图 (.png)",
                                    data=png_data,
                                    file_name="neovista_hd_image.png",
                                    mime="image/png"
                                )
                            except Exception as dl_err:
                                st.warning(f"准备下载文件时出错: {dl_err}")
                                # 如果按钮失败，提供一个直接链接作为备选
                                st.markdown(f"[点击这里直接打开原图]({download_url})")
                        
                        # 3. 投稿到精选画廊按钮
                        if preview_url:
                            st.divider()
                            st.subheader("📤 投稿到精选画廊")
                            
                            # 从URL中提取文件名（例如：http://NeoVista.cn/images/xxx.jpg）
                            filename = preview_url.split("/")[-1]
                            
                            # 投稿信息输入框
                            gallery_title = st.text_input("给图片起个名字 (Title)", key=f"title_{filename}")
                            gallery_description = st.text_area("分享你的创作灵感 (Description)", height=100, key=f"desc_{filename}")
                            gallery_gen_mode = st.radio(
                                "生成方式",
                                options=["文生图", "图生图"],
                                index=1 if uploaded_file else 0,
                                horizontal=True,
                                key=f"gallery_gen_mode_{filename}",
                            )
                            
                            if st.button("✨ 投稿到精选画廊", key=f"submit_{filename}"):
                                # 检查是否填写了标题或描述
                                if not gallery_title and not gallery_description:
                                    st.warning("请至少填写标题或描述")
                                else:
                                    try:
                                        upload_response = requests.post(
                                            GALLERY_UPLOAD_URL,
                                            data={
                                                "filename": filename,
                                                "prompt": prompt,
                                                "ratio": aspect_ratio,
                                                "title": gallery_title if gallery_title else None,
                                                "description": gallery_description if gallery_description else None,
                                                "has_ref_image": gallery_gen_mode == "图生图",
                                            },
                                            timeout=10
                                        )
                                        if upload_response.status_code == 200:
                                            upload_result = upload_response.json()
                                            if upload_result.get("success"):
                                                st.success("投稿成功，等待审核")
                                            else:
                                                st.error(f"投稿失败: {upload_result.get('error', '未知错误')}")
                                        else:
                                            st.error("投稿请求失败")
                                    except Exception as upload_err:
                                        st.error(f"投稿时出错: {upload_err}")
                                
                        with st.expander("👀 查看优化后的提示词"):
                            st.info(res.get("optimized_prompt"))
                    else:
                        st.error("未找到图片链接")
                else:
                    st.error(f"服务器错误: {response.status_code}")
                    
            except Exception as e:
                st.error(f"连接失败: {e}")

@st.dialog("画廊详情", width="large")
def show_gallery_modal(item):
    """显示画廊详情模态框"""
    item_id = item.get("id")
    # 获取图片列表，兼容旧数据
    image_urls = item.get("image_urls")
    if not image_urls:
        image_urls = [item.get("url")] if item.get("url") else []
    
    title = item.get("title") or "未命名"
    description = item.get("description") or "未填写描述"
    prompt = item.get("prompt") or "未填写 Prompt"
    ratio = item.get("aspect_ratio")
    created_at = item.get("created_at")
    filename = item.get("filename")
    has_ref_image = item.get("has_ref_image", False)
    
    # 获取实时互动数据
    likes = item.get("likes_count", 0)
    favorites = item.get("favorites_count", 0)

    # 左右分栏
    col_media, col_info = st.columns([2, 1])
    
    with col_media:
        # 轮播逻辑
        total_images = len(image_urls)
        
        # 使用 session_state 记录当前图片索引
        current_idx_key = f"gallery_idx_{item_id}"
        if current_idx_key not in st.session_state:
            st.session_state[current_idx_key] = 0
            
        current_idx = st.session_state[current_idx_key]
        
        # 确保索引在有效范围内
        if current_idx >= total_images:
            current_idx = 0
            st.session_state[current_idx_key] = 0
            
        current_url = image_urls[current_idx]
        
        url_lower = str(current_url).lower()
        if url_lower.endswith(".mp4") or url_lower.endswith(".webm") or url_lower.endswith(".mov"):
            st.video(current_url, autoplay=True, loop=True)
        else:
            st.image(current_url, use_container_width=True)
            
        # 如果有多张图片，显示翻页按钮和指示器
        if total_images > 1:
            # 定义更新函数（闭包，捕获 current_idx_key 和 total_images）
            def update_index(delta):
                # 确保 key 存在，虽然理论上肯定存在
                if current_idx_key in st.session_state:
                    st.session_state[current_idx_key] = (st.session_state[current_idx_key] + delta) % total_images

            col_prev, col_indicator, col_next = st.columns([1, 2, 1])
            with col_prev:
                # 使用 on_click 回调，args 传递参数
                st.button("◀", key=f"prev_{item_id}", on_click=update_index, args=(-1,))
            with col_indicator:
                st.markdown(f"<div style='text-align: center; color: rgba(255,255,255,0.6); padding-top: 10px;'>{current_idx + 1} / {total_images}</div>", unsafe_allow_html=True)
            with col_next:
                # 使用 on_click 回调
                st.button("▶", key=f"next_{item_id}", on_click=update_index, args=(1,))
            
    with col_info:
        st.subheader(title)
        
        # 作者信息 (Mock)
        st.markdown("**作者**: DrDr")
        
        st.markdown("---")
        st.caption(description)
        
        with st.expander("📝 完整 Prompt", expanded=False):
            st.code(prompt, language="text")
            
        with st.expander("⚙️ 参数信息", expanded=False):
            st.markdown(f"**比例**: {ratio}")
            st.markdown(f"**时间**: {created_at}")
            st.markdown(f"**文件**: {filename}")
            
        st.markdown("---")
        
        # 一键做同款按钮
        if st.button("🪄 一键做同款", key=f"apply_btn_{item_id}", use_container_width=True, type="primary"):
            st.session_state.user_prompt = prompt
            st.session_state.selected_ratio = ratio or "16:9"
            
            # 设置提示信息标志
            if has_ref_image:
                st.session_state.toast_message = "提示词已应用！⚠️ 此效果原图使用了参考图，建议您也上传一张。"
            else:
                st.session_state.toast_message = "提示词已应用！"
                
            st.rerun()
            
        st.markdown("---")
        
        # 底部互动栏
        # 使用 Streamlit 按钮实现互动
        # 注意：在 st.dialog 中，按钮点击会触发 rerun，dialog 会重新渲染
        # 我们需要处理点击事件
        
        col_like, col_fav, col_comment = st.columns(3)
        
        with col_like:
            if st.button(f"❤️ {likes}", key=f"like_btn_{item_id}", use_container_width=True):
                try:
                    # 简化逻辑：这里假设点击就是点赞（+1），实际应该判断当前用户是否点过
                    # 但由于没有用户系统，我们做个简单的 toggle 模拟或者直接加
                    requests.post("http://127.0.0.1:8000/gallery/like", data={"item_id": item_id, "action": "like"})
                    st.rerun()
                except:
                    pass
        
        with col_fav:
            if st.button(f"⭐ {favorites}", key=f"fav_btn_{item_id}", use_container_width=True):
                try:
                    requests.post("http://127.0.0.1:8000/gallery/favorite", data={"item_id": item_id, "action": "add"})
                    st.rerun()
                except:
                    pass
        
        with col_comment:
            if st.button("💬 评论", key=f"comment_btn_{item_id}", use_container_width=True):
                # 切换评论显示状态
                if f"show_comments_{item_id}" not in st.session_state:
                    st.session_state[f"show_comments_{item_id}"] = True
                else:
                    st.session_state[f"show_comments_{item_id}"] = not st.session_state[f"show_comments_{item_id}"]
                st.rerun()

        # 评论区
        if st.session_state.get(f"show_comments_{item_id}", False):
            st.markdown("### 评论区")
            try:
                comments_response = requests.get(f"http://127.0.0.1:8000/gallery/comments/{item_id}", timeout=2)
                comments = comments_response.json().get("comments", []) if comments_response.status_code == 200 else []
                
                if comments:
                    for c in comments:
                        st.markdown(f"**{c.get('username', 'User')}**: {c.get('content')}")
                        st.caption(c.get('created_at', '')[:16])
                        st.divider()
                else:
                    st.info("暂无评论")
                    
                # 发表评论
                with st.form(f"comment_form_{item_id}", clear_on_submit=True):
                    new_comment = st.text_input("写下你的评论...")
                    if st.form_submit_button("发送"):
                        if new_comment:
                            requests.post("http://127.0.0.1:8000/gallery/comment", data={"item_id": item_id, "content": new_comment, "username": "Guest"})
                            st.rerun()
            except Exception as e:
                st.error(f"加载评论失败")


# === 精选画廊展示 ===
@st.cache_data(ttl=60)
def fetch_gallery_images():
    """获取已审核的画廊图片（带缓存，60秒有效期）"""
    try:
        gallery_response = requests.get(GALLERY_APPROVED_URL, timeout=5)
        if gallery_response.status_code == 200:
            gallery_data = gallery_response.json()
            return gallery_data.get("items", [])
        else:
            return []
    except Exception as e:
        print(f"加载画廊失败: {e}")
        return []

st.divider()
st.header("🏆 精选画廊 / Gallery")

gallery_items = fetch_gallery_images()

if gallery_items:
    # 使用 Masonry (瀑布流) 布局
    # Streamlit 原生实现：创建 N 列，将图片依次分配给各列
    cols_count = 3
    cols = st.columns(cols_count)
    
    for idx, item in enumerate(gallery_items):
        # 轮询分配给列
        col = cols[idx % cols_count]
        
        with col:
            # 使用 container 包裹每个卡片，确保垂直间距
            with st.container():
                image_url = item.get("url")
                if image_url:
                    st.image(image_url, use_container_width=True)
                    
                    title = item.get("title") or "未命名"
                    description = item.get("description") or ""
                    
                    st.markdown(f"**{title}**")
                    if description:
                        st.caption(description[:50] + "..." if len(description) > 50 else description)
                        
                    # 这里的 key 必须唯一
                    if st.button("🔍 查看详情", key=f"view_btn_{item.get('id')}", use_container_width=True):
                        show_gallery_modal(item)
                    
                    # 添加垂直间距
                    st.markdown("<div style='margin-bottom: 24px;'></div>", unsafe_allow_html=True)

else:
    st.info("画廊暂无内容，快来投稿吧！")
