# Progress Log

## Session: 2026-04-16

### Phase 1: 登录门禁统一化需求确认
- **Status:** complete
- **Started:** 2026-04-16
- Actions taken:
  - 盘点当前模型调用入口，确认聊天、Agent 调参和生图分别散落在 `useAppStore` 与多个 workspace 组件中。
  - 与用户确认目标口径：只要会真正调用模型，不管是对话还是模版/生图，都要未登录先弹登录框。
  - 提出并确认采用方案 A：以 store 统一登录门禁为主，组件层只保留少量就近拦截。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)
  - `docs/superpowers/specs/2026-04-16-auth-gating-for-model-actions-design.md` (created)
  - `docs/superpowers/plans/2026-04-16-auth-gating-for-model-actions.md` (created)

### Phase 2: 登录门禁统一化实现与验证
- **Status:** complete
- **Started:** 2026-04-16
- Actions taken:
  - 按 TDD 先修改 `frontend/src/store/useAppStore.source.test.js`，补充统一门禁 helper、`directChat`、`workspaceChat`、`triggerTemplateAdjustParams` 的未登录用例。
  - 先运行 `node --test src/store/useAppStore.source.test.js`，确认新增测试在实现前失败。
  - 在 `frontend/src/store/useAppStore.js` 中新增 `ensureAuthenticatedForModelAction()`。
  - 将以下模型调用入口统一接入该 helper：
    - `directChat`
    - `workspaceChat`
    - `triggerTemplateAdjustParams`
    - `generateImage`
    - `confirmGenerate`
    - `auditDiagram`
    - `batchGenerate`
  - 调整调用顺序，确保未登录时不会先追加聊天消息，也不会先进入 loading 状态。
  - 重新运行 store 源码测试并通过。
  - 运行更宽的前端源码测试，确认多图输入、启动恢复与门禁逻辑同时保持通过。
- Files created/modified:
  - `frontend/src/store/useAppStore.js` (updated)
  - `frontend/src/store/useAppStore.source.test.js` (updated)
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 3: 登录框上下文文案优化
- **Status:** complete
- **Started:** 2026-04-16
- Actions taken:
  - 与用户确认只做“文案优化 + 登录后可继续当前操作”的提示增强，不做自动续做。
  - 为 store 新增上下文测试，要求未登录时除了弹框，还要记录 `authModalContext`。
  - 新增 `frontend/src/components/auth/AuthModal.source.test.js`，锁定登录框会展示“当前操作需要登录”和上下文提示文案。
  - 将 `ensureAuthenticatedForModelAction()` 升级为可接收动作名，并写入 `authModalContext`。
  - 将聊天、生图、审图、批量生成等门禁提示映射为对应动作名。
  - 在 `AuthModal.jsx` 中渲染上下文提示，并在登录成功后清理上下文。
- Files created/modified:
  - `frontend/src/components/auth/AuthModal.jsx` (updated)
  - `frontend/src/components/auth/AuthModal.source.test.js` (created)
  - `frontend/src/store/useAppStore.js` (updated)
  - `frontend/src/store/useAppStore.source.test.js` (updated)
  - `docs/superpowers/specs/2026-04-16-auth-gating-for-model-actions-design.md` (updated)
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 1: 需求与仓库现状核对
- **Status:** complete
- **Started:** 2026-04-16
- Actions taken:
  - 核对用户要求，确认本次目标是“检查整个项目进度”并“补齐缺失的 progress 记录”。
  - 检查根目录是否已有 `task_plan.md`、`findings.md`、`progress.md`，结论是三者均缺失。
  - 读取 `CLAUDE.md`、`EVIDENCE.md`、`docs/current-mode-usage-guide.md`，并查看 `git status`、`git log`、`git diff --stat`。
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)

### Phase 2: 项目整体进度盘点
- **Status:** complete
- Actions taken:
  - 盘点已提交主线进度：
    - Home/Workspace 双界面结构与前后端主干已存在。
    - 认证、计费、限流、模板与审图相关后端模块已在仓库内成型。
    - 最近已提交记录显示已完成静态资源缓存修复、API 路由优先级修复、Gallery 交付性能优化与部署同步修复。
  - 盘点当前工作区已完成但未登记的进度：
    - 工作区与 direct chat 已支持多张参考图输入。
    - 参考图支持上传、粘贴、累计追加、去重和删除单张。
    - 后端已新增多图归一化、拼图合成、统一多模态 prompt 组装与 JSON 包裹解析能力。
    - Agent / direct chat / 生成链路已统一支持 `image_datas` 多图字段，同时保留兼容的单图字段。
    - 生成完成后会清理旧的 `readyToGenerate` / `suggestedParams` / `suggestedTemplateId`，并退出 Agent 模式，避免残留状态污染下一轮操作。
    - 应用启动时新增 `bootstrapAuth`，可根据本地 token 自动恢复登录态并刷新计费摘要。
- Files created/modified:
  - `EVIDENCE.md` (read for evidence)
  - `docs/current-mode-usage-guide.md` (read for current behavior)
  - `backend/main.py` (existing uncommitted progress, inspected)
  - `backend/llm_service.py` (existing uncommitted progress, inspected)
  - `frontend/src/App.jsx` (existing uncommitted progress, inspected)
  - `frontend/src/components/workspace/AgentChatInput.jsx` (existing uncommitted progress, inspected)
  - `frontend/src/components/workspace/ChatHistory.jsx` (existing uncommitted progress, inspected)
  - `frontend/src/store/useAppStore.js` (existing uncommitted progress, inspected)

### Phase 3: 已完成但此前未登记的具体补记
- **Status:** complete
- Actions taken:
  - 补记“多参考图贯通”主线：
    - 前端状态从单张 `uploadedImage` 升级为 `uploadedImages`。
    - 新增 `frontend/src/lib/referenceImages.js` 统一处理标准化、合并、去重、粘贴提取与格式过滤。
    - `AgentChatInput` 支持多选上传、剪贴板粘贴、缩略图列表、删除单张、清空全部。
    - `ChatHistory` 的“确认生成”已改为可携带多张参考图继续生成。
  - 补记“聊天/模型路由增强”：
    - `select_workspace_chat_model(agent_mode, has_reference_images)` 会在存在参考图时强制选择 Pro。
    - `direct_chat` 新增提示词顾问模式，可在非 Agent 模式下根据角色/场景设定与参考图整理 Imagen 风格 prompt。
    - `workspace_chat` 在最后一条用户消息上支持带图多模态输入，并改进 JSON 解析鲁棒性。
  - 补记“后端生成与审图健壮性”：
    - `generate_image`、`generate_diagram` 已统一接受 `image_datas/base_images`。
    - 多图在后端先压缩与拼接，再作为单张合成图送入上游视觉链路。
    - 审图返回 JSON 时新增 Markdown 代码块包裹兼容解析。
  - 补记“配套测试进展”：
    - 新增/更新前端源码级测试，覆盖启动恢复登录态、上传多图状态、AgentChatInput 多图输入能力。
    - 新增/更新后端测试，覆盖多图参考流、Pro 多模态容灾回退、带参考图时工作区聊天模型选择。
- Files created/modified:
  - `frontend/src/lib/referenceImages.js` (new, existing uncommitted progress)
  - `frontend/src/lib/referenceImages.test.js` (new, existing uncommitted progress)
  - `frontend/src/components/workspace/AgentChatInput.source.test.js` (new, existing uncommitted progress)
  - `frontend/src/App.source.test.js` (existing uncommitted progress, inspected)
  - `frontend/src/store/useAppStore.source.test.js` (existing uncommitted progress, inspected)
  - `tests/test_multimodal_reference_flow.py` (new, existing uncommitted progress)
  - `tests/test_audit_channel_resilience.py` (existing uncommitted progress, inspected)
  - `tests/test_chat_channel_config.py` (existing uncommitted progress, inspected)

### Phase 4: 验证与同步
- **Status:** complete
- Actions taken:
  - 运行前端源码级测试：
    - `node --test src/lib/referenceImages.test.js src/components/workspace/AgentChatInput.source.test.js src/store/useAppStore.source.test.js src/App.source.test.js`
    - 结果：15 项通过，0 项失败。
  - 首次使用系统 Python 运行后端测试时，因当前 shell 未安装 `fastapi` / `pydantic` 失败。
  - 改用仓库虚拟环境运行后端测试：
    - `backend/venv/bin/python -m unittest tests.test_multimodal_reference_flow tests.test_audit_channel_resilience tests.test_chat_channel_config`
    - 结果：16 项通过，0 项失败。
  - 已将验证状态回写本文件，确保“已完成但未登记”的内容同时具备测试依据。
- Files created/modified:
  - `progress.md` (updated)

## Session: 2026-04-18 至 2026-04-22

### Phase 5: 邮件验证码发送链路修复
- **Status:** complete
- **Started:** 2026-04-18
- Actions taken:
  - 核对邮箱验证码发送失败原因，确认问题不在 `RESEND_API_KEY`，而在发件人地址仍使用硬编码测试地址。
  - 将邮件发送逻辑改为强制读取 `RESEND_FROM_EMAIL`，未配置时直接失败并输出明确日志，避免继续使用错误 sender 假装成功。
  - 补充 `.env.example` 的邮件配置示例，要求使用已在 Resend 验证过的发件邮箱。
  - 新增回归测试，覆盖“使用配置 sender 发送成功”与“缺少 sender 时拒绝发送”两种场景。
- Files created/modified:
  - `backend/email_utils.py` (updated)
  - `backend/.env.example` (updated)
  - `tests/test_email_utils.py` (created)
  - `progress.md` (updated)

### Phase 6: 对话链路增强补记
- **Status:** complete
- **Started:** 2026-04-20
- Actions taken:
  - 将工作区用户消息扩展为可携带 `imageDatas`，发送时把“本轮图片快照 + 文字”一起固化到聊天历史中，避免 UI 只显示文字。
  - `ChatHistory` 增加同一条用户消息内的图片缩略图展示，图文保持同轮关联。
  - `/api/v1/direct-chat` 增加最近上下文透传能力，前端发送最近 10 条消息并限制总文本长度，后端兼容读取 `messages` 参与 prompt 组装。
  - `/api/v1/direct-chat` 与 `/api/v1/agent/workspace-chat` 的带图对话改为逐张原图走多模态链路，不再默认只依赖拼图后的单张 JPEG。
  - 后端新增语言策略：中文请求强制中文回复；英文或其他非中文请求允许原语言回答，但必须附带 `中文翻译：...`。
  - 为 direct-chat / workspace-chat 补充语言修正与控制字段保持测试，防止 JSON 控制字段在翻译修正时被破坏。
- Files created/modified:
  - `backend/main.py` (updated)
  - `frontend/src/store/useAppStore.js` (updated)
  - `frontend/src/components/workspace/ChatHistory.jsx` (updated)
  - `frontend/src/components/workspace/ChatHistory.source.test.js` (created)
  - `tests/test_chat_reply_policy.py` (created)
  - `progress.md` (updated)

### Phase 7: 生产日志本机观察脚本
- **Status:** complete
- **Started:** 2026-04-20
- Actions taken:
  - 新增本机脚本，通过现有 SSH key 持续观察云服务器 `neovista-api` 的 `journalctl -f` 输出，不需要每次手动登录服务器。
  - 提供两种查看模式：
    - 过滤版：聚焦 `POST /api/`、`GET /api/`、`Traceback`、`ERROR`、`Exception` 以及模型调用关键前缀。
    - 原始版：输出完整 `neovista-api` journal 流。
  - 增加 `.command` 启动器，方便在 macOS 上双击打开监视窗口。
  - 为三份脚本补充源码级测试，锁定 SSH 参数、`--since` 支持、keepalive 和启动器约定。
- Files created/modified:
  - `scripts/watch-prod-api-logs.sh` (created)
  - `scripts/watch-prod-api-logs-raw.sh` (created)
  - `scripts/watch-prod-api-logs.command` (created)
  - `tests/test_watch_prod_api_logs_scripts.py` (created)
  - `progress.md` (updated)

### Phase 8: GPT Image 2.0 渠道接入与图生图扩展
- **Status:** complete
- **Started:** 2026-04-22
- Actions taken:
  - 新增 `GPT Image 2.0` 作为网页生图模型选项，并将其定价对齐 `Nano 2`。
  - 后端按模型分流生图请求：
    - 纯文本生图走 `/v1/images/generations`
    - 带参考图或 i2i 模板走 `/v1/images/edits`
  - GPT 图生图分支改为使用 `multipart/form-data` 上传 `image[]`，兼容上游返回 `b64_json` 或 `url` 两种结果格式。
  - 放宽 GPT edits 分支超时时间，减少参考图编辑场景下的超时误判。
  - 补充后端计费与渠道流测试，覆盖 Nano 2 定价、文生图 generations 分支、带参考图 edits 分支、i2i 模板 edits 分支。
- Files created/modified:
  - `backend/main.py` (updated)
  - `backend/pricing.py` (updated)
  - `frontend/src/components/workspace/AgentChatInput.jsx` (updated)
  - `frontend/src/components/workspace/GenerateParamsModal.jsx` (updated)
  - `frontend/src/lib/generationPricing.js` (updated)
  - `tests/test_billing_pricing.py` (updated)
  - `tests/test_generate_billing_flow.py` (updated)
  - `progress.md` (updated)

### Phase 9: 生图比例“跟随模型”能力
- **Status:** complete
- **Started:** 2026-04-22
- Actions taken:
  - 将生图比例默认值从固定 `1:1` 调整为 `auto`，前端下拉框新增并置顶 `跟随模型` 选项。
  - 保持比例值原样透传到后端，不再在 UI 层将“跟随模型”伪装成固定方图。
  - 后端新增 `auto` 语义：
    - GPT Image 2.0 映射为 `size=auto`
    - Gemini 分支在 `auto` 时不再传固定 `imageConfig.aspectRatio`
  - 为前后端补充源码与后端测试，确保 `auto` 不会被改写回 `1:1`。
- Files created/modified:
  - `backend/main.py` (updated)
  - `frontend/src/components/workspace/AgentChatInput.jsx` (updated)
  - `frontend/src/components/workspace/AgentChatInput.source.test.js` (updated)
  - `frontend/src/store/useAppStore.js` (updated)
  - `frontend/src/store/useAppStore.source.test.js` (updated)
  - `tests/test_generate_billing_flow.py` (updated)
  - `progress.md` (updated)

## 当前项目状态快照
- **整体状态:** 核心产品骨架已成型，已覆盖首页、工作区、鉴权、计费/积分、模板生图、Agent 对话、审图与部署修复等主线能力。
- **最近已提交里程碑:** 静态资源缓存修复、Nginx API 优先级修复、Gallery 性能优化、预览与部署同步修复。
- **当前工作区新增但待提交进度:** 多参考图输入与后端合成链路、direct chat 提示词顾问模式、对话图文同发与中文回复策略、验证码 sender 配置修复、生产日志观察脚本、GPT Image 2.0 接入与图生图扩展、比例“跟随模型(auto)”能力、对应测试补齐。
- **需要继续关注:** 当前这些最新能力仍处于工作区未提交状态，最终归档前需要完成测试核验与提交存档。

## 历史进度回填
- **来源:** 备份文件 `/Users/zz/AI/NeoVista-standalone-backups/Neovista2.0-prune-20260411-204325/top-level-extras/PROGRESS.md`
- **说明:** 以下内容是 `2026-04-09` 留下的历史快照，作为项目进度补档保留；其中旧 TODO 和“待上线”描述不一定仍代表今天的真实状态。

### Sprint 34（生产部署配置，历史记录更新时间 2026-04-09）
- 已完成腾讯云 Ubuntu 单机部署方案整理。
- 后端侧历史记录包括：
  - `backend/main.py` 改为环境变量驱动 CORS，并新增 `/api/health` 健康检查接口。
  - `backend/database.py` 支持 `DATABASE_URL` 环境变量，并只输出数据库类型避免泄露密码。
  - `backend/.env.example`、`backend/static/.gitkeep` 已补齐。
- 前端侧历史记录包括：
  - `frontend/src/store/useAppStore.js` 统一切到相对路径 `/api` 调用。
- 部署侧历史记录包括：
  - `deploy/systemd/neovista-api.service`
  - `deploy/nginx/neovista.conf`
  - `DEPLOY_TENCENT_UBUNTU.md`

### Sprint 33（模板 prompt_structure 补全，历史记录更新时间 2026-04-08）
- 已补全 `templates_v2.json` 中 20 个模板的 `prompt_structure`。
- 相关历史文件：
  - `backend/templates_v2.json`
  - `backend/update_prompt_structures.py`
- 旧记录中的提交哈希：`90a8c42`

### Sprint 32（比例选择与审图修复，历史记录更新时间 2026-04-07 / 2026-04-01）
- 审图接口历史修复：
  - `AuditDiagramRequest.session_id` 改为可选。
  - 新增 `template_id` 字段。
  - 无 session 时改为空对象兜底，修复 404 “会话不存在”。
- 生图比例选择历史能力：
  - 前端增加 `aspectRatio` 状态与比例下拉框。
  - 生图请求携带 `aspect_ratio`。
  - 后端增加 `aspect_ratio` 字段与尺寸映射逻辑，并向 Gemini payload 透传比例。
- 旧记录中的提交哈希：
  - 审图修复：待存档
  - 比例选择：`2872dc1`

### 历史 TODO（仅作补档，不作为当前真实待办）
- 旧文件中保留了当时的部署前检查、上线后优化、低优先级迭代项。
- 这些条目反映的是 `2026-04-09` 当时的上下文，不应直接替代当前迭代计划。

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 文档与仓库状态核对 | `git status --short`, `git log --oneline -n 12`, `git diff --stat` | 能定位当前项目主线与未登记进度 | 已定位提交历史与未提交改动范围 | ✓ |
| 前端源码级测试 | `node --test src/lib/referenceImages.test.js src/components/workspace/AgentChatInput.source.test.js src/store/useAppStore.source.test.js src/App.source.test.js` | 多图输入、状态管理与启动恢复相关测试通过 | 15 项通过，0 项失败 | ✓ |
| 后端多模态与渠道配置测试 | `backend/venv/bin/python -m unittest tests.test_multimodal_reference_flow tests.test_audit_channel_resilience tests.test_chat_channel_config` | 多图参考流、Pro 容灾回退、带参考图模型选择通过 | 16 项通过，0 项失败 | ✓ |
| 登录门禁源码测试（red） | `node --test src/store/useAppStore.source.test.js` | 新增门禁测试在实现前失败 | 4 项新增测试失败，证明测试有效 | ✓ |
| 登录门禁源码测试（green） | `node --test src/store/useAppStore.source.test.js` | 统一门禁 helper 与三条缺口路径通过 | 9 项通过，0 项失败 | ✓ |
| 登录门禁回归测试 | `node --test src/lib/referenceImages.test.js src/components/workspace/AgentChatInput.source.test.js src/store/useAppStore.source.test.js src/App.source.test.js` | 门禁改动不破坏已有前端源码行为 | 19 项通过，0 项失败 | ✓ |
| 登录框上下文源码测试 | `node --test src/components/auth/AuthModal.source.test.js` | 登录框展示“当前操作需要登录”和继续提示 | 1 项通过，0 项失败 | ✓ |
| 登录框上下文回归测试 | `node --test src/lib/referenceImages.test.js src/components/auth/AuthModal.source.test.js src/components/workspace/AgentChatInput.source.test.js src/store/useAppStore.source.test.js src/App.source.test.js` | 新上下文文案不破坏既有前端源码行为 | 21 项通过，0 项失败 | ✓ |
| 邮件 sender 与对话策略测试 | `backend/venv/bin/python -m unittest tests/test_chat_reply_policy.py tests/test_email_utils.py` | direct-chat 上下文、图文多模态、中英回复策略与邮件 sender 规则通过 | 9 项通过，0 项失败 | ✓ |
| 生产日志脚本测试 | `python3 -m unittest tests/test_watch_prod_api_logs_scripts.py` | 过滤版/原始版/.command 启动器满足约定 | 1 项通过，0 项失败 | ✓ |
| GPT Image 与比例 auto 后端测试 | `backend/venv/bin/python -m unittest tests/test_generate_billing_flow.py tests/test_billing_pricing.py` | GPT Image 渠道、edits 分支与 auto 比例逻辑通过 | 15 项通过，0 项失败 | ✓ |
| 比例 auto 前端源码测试 | `node --test frontend/src/components/workspace/AgentChatInput.source.test.js frontend/src/store/useAppStore.source.test.js` | “跟随模型”选项与默认 `auto` 状态通过 | 16 项通过，0 项失败 | ✓ |
| 比例 auto 语法检查 | `backend/venv/bin/python -m py_compile backend/main.py && node --check frontend/src/store/useAppStore.js` | 后端与前端 store 语法正确 | 命令成功退出 | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-04-16 | 根目录不存在 `progress.md` | 1 | 创建根目录进度文件，并基于实际仓库状态回填 |
| 2026-04-16 | 系统 Python 缺少后端测试依赖 | 1 | 改用 `backend/venv/bin/python` 重跑后端测试并通过 |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 5，本轮进度核对、补记和验证都已完成 |
| Where am I going? | 向用户交付结果，并提醒后续可按当前工作区改动进行存档 |
| What's the goal? | 让项目级进度文档准确反映 NeoVista 当前实际进度 |
| What have I learned? | 多图参考链路、聊天路由增强和状态恢复能力已经实现，但此前未写入统一进度文档 |
| What have I done? | 已建立根目录规划文件，补记整体项目快照与当前未登记进展，并完成前后端针对性验证 |
