import streamlit as st
import requests

# API 地址
GALLERY_ADMIN_UPLOAD_URL = "http://127.0.0.1:8000/gallery/admin/upload"
GALLERY_APPROVED_URL = "http://127.0.0.1:8000/gallery/approved"
GALLERY_PENDING_URL = "http://127.0.0.1:8000/gallery/pending"
GALLERY_AUDIT_URL = "http://127.0.0.1:8000/gallery/audit"
GALLERY_DELETE_URL = "http://127.0.0.1:8000/gallery/delete"
GALLERY_UPDATE_URL = "http://127.0.0.1:8000/gallery/update"
GALLERY_DELETE_IMAGE_URL = "http://127.0.0.1:8000/gallery/delete_image"

st.set_page_config(page_title="NeoVista 管理后台", page_icon="🔐")
st.title("🔐 NeoVista 管理后台")

# === 密码验证 ===
if "admin_authenticated" not in st.session_state:
    st.session_state.admin_authenticated = False

if not st.session_state.admin_authenticated:
    st.markdown("---")
    admin_password = st.text_input("请输入管理员密码", type="password", key="admin_pwd_main")
    
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        if st.button("🔓 登录", use_container_width=True, key="admin_login_btn"):
            if admin_password == "admin123":
                st.session_state.admin_authenticated = True
                st.rerun()
            else:
                st.error("❌ 密码错误")
    
    st.stop()

# === 管理界面 ===
st.success("✅ 已登录管理后台")

@st.dialog("✏️ 编辑作品", width="large")
def edit_dialog(item):
    """编辑画廊作品模态框"""
    item_id = item.get("id")
    
    # === 1. 图片管理区域 (移出 form) ===
    st.markdown("### 🖼️ 图片管理")
    
    # 展示所有图片（如果有）
    image_urls = item.get("image_urls", [])
    if not image_urls and item.get("url"):
        image_urls = [item.get("url")]
    
    if image_urls:
        # 简单展示多张图
        cols_preview = st.columns(min(len(image_urls), 3))
        for idx, url in enumerate(image_urls):
            with cols_preview[idx % 3]:
                st.image(url, use_container_width=True)
                # 添加删除按钮
                filename = url.split("/")[-1]
                # 使用 container width 让按钮对齐更好看
                if st.button("🗑️ 删除", key=f"del_img_{item_id}_{filename}", help="删除这张图片", use_container_width=True):
                    try:
                        del_resp = requests.post(
                            GALLERY_DELETE_IMAGE_URL, 
                            data={"item_id": item_id, "filename": filename},
                            timeout=5
                        )
                        if del_resp.status_code == 200:
                            res = del_resp.json()
                            if res.get("success"):
                                st.success("图片已删除")
                                st.rerun()
                            else:
                                st.error(f"删除失败: {res.get('error')}")
                        else:
                            st.error("请求失败")
                    except Exception as e:
                        st.error(f"出错: {e}")
    else:
        st.info("暂无图片")

    st.markdown("---")

    # === 2. 信息编辑表单 (保留在 form 内) ===
    st.markdown("### 📝 信息编辑")
    with st.form(key=f"edit_form_{item_id}"):
        new_title = st.text_input("标题 (Title)", value=item.get("title") or "")
        new_desc = st.text_area("描述 (Description)", value=item.get("description") or "", height=100)
        new_prompt = st.text_area("提示词 (Prompt)", value=item.get("prompt") or "", height=100)
        new_ratio = st.text_input("比例 (Aspect Ratio)", value=item.get("aspect_ratio") or "16:9")
        
        st.markdown("**新增图片 (可选)**")
        new_files = st.file_uploader("上传新图片 (支持多选)", type=["jpg", "png", "jpeg"], key=f"new_files_{item_id}", accept_multiple_files=True)
        
        st.markdown("---")
        submitted = st.form_submit_button("💾 保存修改", type="primary", use_container_width=True)
        
        if submitted:
            # 构造请求数据
            data = {
                "item_id": item_id,
                "title": new_title,
                "description": new_desc,
                "prompt": new_prompt,
                "aspect_ratio": new_ratio
            }
            files = []
            if new_files:
                for f in new_files:
                    files.append(("files", (f.name, f, f.type)))
            
            try:
                with st.spinner("正在保存..."):
                    # 注意：requests 处理多文件上传时，files 参数应该是 [('files', (filename, file_obj, content_type)), ...]
                    resp = requests.post(GALLERY_UPDATE_URL, data=data, files=files if files else None, timeout=30)
                    if resp.status_code == 200:
                        res_json = resp.json()
                        if res_json.get("success"):
                            st.success("✅ 修改成功")
                            st.rerun()
                        else:
                            st.error(f"修改失败: {res_json.get('error')}")
                    else:
                        st.error(f"请求失败: {resp.status_code}")
            except Exception as e:
                st.error(f"请求出错: {e}")

# === 管理员直接上传 ===
with st.expander("📤 管理员直接发布", expanded=False):
    admin_upload_files = st.file_uploader(
        "选择图片文件（最多9张）",
        type=["jpg", "jpeg", "png"],
        key="admin_upload",
        accept_multiple_files=True,
    )
    admin_upload_title = st.text_input("标题 (Title)", key="admin_title")
    admin_upload_prompt = st.text_area("提示词 (Prompt)", key="admin_prompt")
    admin_upload_description = st.text_area("描述 (Description)", height=100, key="admin_desc")
    admin_gen_mode = st.radio(
        "生成方式",
        options=["文生图", "图生图"],
        index=0,
        horizontal=True,
        key="admin_gen_mode",
    )
    admin_upload_ratio = st.radio(
        "图片比例",
        options=['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'],
        index=5,
        horizontal=True,
        key="admin_ratio"
    )
    
    if st.button("🚀 立即发布", key="admin_upload_btn"):
        if not admin_upload_files:
            st.error("请选择图片文件")
        elif len(admin_upload_files) > 9:
            st.error("最多只能上传9张图片")
        elif not admin_upload_prompt:
            st.error("请填写提示词")
        else:
            try:
                files = []
                for f in admin_upload_files:
                    files.append(("files", (f.name, f, f.type)))
                data = {
                    "title": admin_upload_title if admin_upload_title else None,
                    "prompt": admin_upload_prompt,
                    "description": admin_upload_description if admin_upload_description else None,
                    "aspect_ratio": admin_upload_ratio,
                    "has_ref_image": admin_gen_mode == "图生图",
                }
                upload_response = requests.post(
                    GALLERY_ADMIN_UPLOAD_URL,
                    files=files,
                    data=data,
                    timeout=30
                )
                if upload_response.status_code == 200:
                    upload_result = upload_response.json()
                    if upload_result.get("success"):
                        st.success("✅ 管理员上传成功，已直接发布")
                        st.rerun()
                    else:
                        st.error(f"上传失败: {upload_result.get('error', '未知错误')}")
                else:
                    st.error(f"上传请求失败: {upload_response.status_code}")
            except Exception as upload_err:
                st.error(f"上传时出错: {upload_err}")

st.divider()

# === 待审核列表 ===
st.subheader("📋 待审核图片")
try:
    pending_response = requests.get(GALLERY_PENDING_URL, timeout=5)
    if pending_response.status_code == 200:
        pending_data = pending_response.json()
        pending_items = pending_data.get("items", [])
        
        if pending_items:
            st.info(f"共有 {len(pending_items)} 张图片待审核")
            for item in pending_items:
                st.divider()
                item_id = item.get("id")
                image_url = item.get("url")
                prompt = item.get("prompt", "")
                ratio = item.get("aspect_ratio", "")
                title = item.get("title", "")
                description = item.get("description", "")
                
                if image_url:
                    if title:
                        st.markdown(f"#### {title}")
                    st.image(image_url, use_container_width=True)
                    st.caption(f"💭 Prompt: {prompt}")
                    if description:
                        st.text(f"📝 {description}")
                    st.caption(f"📐 比例: {ratio}")
                    
                    col1, col2 = st.columns(2)
                    with col1:
                        if st.button("✅ 通过", key=f"approve_{item_id}"):
                            try:
                                audit_response = requests.post(
                                    GALLERY_AUDIT_URL,
                                    data={"item_id": item_id, "action": "approve"},
                                    timeout=5
                                )
                                if audit_response.status_code == 200:
                                    audit_result = audit_response.json()
                                    if audit_result.get("success"):
                                        st.success("已通过审核")
                                        st.rerun()
                                    else:
                                        st.error(f"操作失败: {audit_result.get('error')}")
                                else:
                                    st.error("审核请求失败")
                            except Exception as audit_err:
                                st.error(f"审核时出错: {audit_err}")
                    
                    with col2:
                        if st.button("❌ 拒绝", key=f"reject_{item_id}"):
                            try:
                                audit_response = requests.post(
                                    GALLERY_AUDIT_URL,
                                    data={"item_id": item_id, "action": "reject"},
                                    timeout=5
                                )
                                if audit_response.status_code == 200:
                                    audit_result = audit_response.json()
                                    if audit_result.get("success"):
                                        st.success("已拒绝")
                                        st.rerun()
                                    else:
                                        st.error(f"操作失败: {audit_result.get('error')}")
                                else:
                                    st.error("审核请求失败")
                            except Exception as audit_err:
                                st.error(f"审核时出错: {audit_err}")
        else:
            st.info("暂无待审核图片")
    else:
        st.warning("无法加载待审核列表")
except Exception as e:
    st.warning(f"加载待审核列表失败: {e}")

st.divider()

# === 已审核通过的图片列表（画廊管理）===
st.subheader("🏆 已审核通过的图片（画廊管理）")
try:
    approved_response = requests.get(GALLERY_APPROVED_URL, timeout=5)
    if approved_response.status_code == 200:
        approved_data = approved_response.json()
        approved_items = approved_data.get("items", [])
        
        if approved_items:
            st.info(f"共有 {len(approved_items)} 张已审核通过的图片")
            for item in approved_items:
                st.divider()
                item_id = item.get("id")
                image_url = item.get("url")
                prompt = item.get("prompt", "")
                ratio = item.get("aspect_ratio", "")
                title = item.get("title", "")
                description = item.get("description", "")
                
                if image_url:
                    if title:
                        st.markdown(f"#### {title}")
                    st.image(image_url, use_container_width=True)
                    st.caption(f"💭 Prompt: {prompt}")
                    if description:
                        st.text(f"📝 {description}")
                    st.caption(f"📐 比例: {ratio}")
                    
                    col_action1, col_action2 = st.columns([1, 1])
                    with col_action1:
                        if st.button("✏️ 编辑", key=f"edit_btn_{item_id}", use_container_width=True):
                            edit_dialog(item)
                    
                    with col_action2:
                        # 删除按钮（红色样式）
                        if st.button("🗑️ 删除", key=f"delete_{item_id}", type="secondary", use_container_width=True):
                            try:
                                delete_response = requests.delete(
                                    f"{GALLERY_DELETE_URL}/{item_id}",
                                    timeout=5
                                )
                                if delete_response.status_code == 200:
                                    delete_result = delete_response.json()
                                    if delete_result.get("success"):
                                        st.success("✅ 删除成功")
                                        st.rerun()
                                    else:
                                        st.error(f"删除失败: {delete_result.get('error', '未知错误')}")
                                else:
                                    st.error(f"删除请求失败: {delete_response.status_code}")
                            except Exception as delete_err:
                                st.error(f"删除时出错: {delete_err}")
        else:
            st.info("暂无已审核通过的图片")
    else:
        st.warning("无法加载已审核图片列表")
except Exception as e:
    st.warning(f"加载已审核图片列表失败: {e}")

# === 退出登录 ===
st.divider()
if st.button("🚪 退出登录"):
    st.session_state.admin_authenticated = False
    st.rerun()
