# Findings & Decisions

## Requirements
- 检查 NeoVista 当前整个项目的实际进度。
- 检查 `progress.md` 记录是否缺失。
- 将“已经做了但是没有更新”的内容补进进度文档。
- 以仓库当前真实状态为准，不凭空补写。

## Research Findings
- 仓库根目录原本没有 `task_plan.md`、`findings.md`、`progress.md`，只有 `EVIDENCE.md`。
- 在备份目录中找到一份旧的 Claude 风格进度文件：`/Users/zz/AI/NeoVista-standalone-backups/Neovista2.0-prune-20260411-204325/top-level-extras/PROGRESS.md`
- 该旧文件最后更新时间为 `2026-04-09`，记录了 Sprint 32-34 的历史进度，不在当前仓库根目录，也不在当前 git 历史里。
- `git log --oneline -n 12` 显示最近已提交主线包括：
  - `fix: exclude api routes from static asset caching`
  - `fix: prioritize api routes in nginx`
  - `perf: optimize gallery delivery`
  - `fix: improve gallery previews and deploy sync`
- 当前工作区存在未提交改动，主要集中在：
  - `backend/main.py`
  - `backend/llm_service.py`
  - `frontend/src/App.jsx`
  - `frontend/src/components/workspace/AgentChatInput.jsx`
  - `frontend/src/components/workspace/ChatHistory.jsx`
  - `frontend/src/store/useAppStore.js`
  - 多个前后端测试文件
- `docs/current-mode-usage-guide.md` 已记录当前系统真实行为：
  - Agent 优先级最高
  - 参考图支持上传、粘贴、多图、追加与去重
  - 有参考图时 direct chat / workspace chat 会走 Pro 多模态
  - 多图会在后端先合成为一张拼图后再送上游
- `EVIDENCE.md` 记录了先前一次关于 Agent 勾选框、模型下拉、参数调整入口、`uploadedImage` 提升到 store 的实现证据，但这部分没有沉淀到项目级 `progress.md`。
- 当前与模型调用相关的前端入口分布在：
  - `useAppStore.js`：`directChat`、`workspaceChat`、`triggerTemplateAdjustParams`、`generateImage`、`confirmGenerate`、`auditDiagram`
  - `AgentChatInput.jsx`：统一发送入口，会在不同模式下路由到聊天或生图
  - `ChatHistory.jsx`：模板“调整参数”、确认生成、直接生图
  - `TemplateDetailModal.jsx`：已存在未登录弹登录框
  - `SkillsGallery.jsx`：当前会直接触发 `generateImage`
- 当前已有登录门禁的主要是生图链路：`generateImage`、`confirmGenerate` 和模板详情页使用模板。
- 当前缺口是聊天与模板调参：`directChat`、`workspaceChat`、`triggerTemplateAdjustParams` 未统一做未登录拦截。
- 已实现的统一化方案：
  - 在 `useAppStore.js` 中新增 `ensureAuthenticatedForModelAction()`
  - `directChat`、`workspaceChat`、`triggerTemplateAdjustParams` 在进入任何消息追加或 loading 状态之前先校验登录
  - `generateImage`、`confirmGenerate`、`auditDiagram`、`batchGenerate` 也改为复用同一个 helper
- 这样可以保证：未登录时不会先把用户消息塞进聊天历史、也不会先进入“思考中/加载中”再失败，而是直接弹登录框。
- 本轮额外增强：
  - 新增 `authModalContext`
  - 被门禁拦截时，会把动作名写入上下文，例如“继续对话”“生成图片”“调整模板参数”
  - `AuthModal` 会显示“当前操作需要登录。登录后可继续XXX”
  - 明确不做登录后的自动续做，只做提示增强

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 将“整体项目进度”分为“已提交主线能力”和“当前工作区已完成改动” | 用户要看整个项目现状，同时要补记尚未更新的内容 |
| 把多张参考图贯通链路列为本次最重要的未登记进展 | 这是当前 diff 中影响范围最大、测试补充最多的一条主线 |
| 明确标注“已验证/待提交” | 避免把工作区改动误写成已经归档提交的里程碑 |
| 登录门禁采用 store 统一收口（方案 A） | 模型调用入口分散，集中管理最不容易漏 |
| “纯 UI 选择模板”不拦，“真正发起模型请求”统一拦 | 精确匹配用户“调用模型才提醒登录”的目标 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 根目录没有正式的规划三件套，无法直接“更新现有 progress.md” | 新建根目录规划文件，并以本轮核对结果作为后续恢复基线 |
| 当前项目进度分散在代码 diff、测试文件和说明文档中 | 汇总多源证据后再写入统一的项目进度文档 |
| 直接使用系统 Python 跑后端测试时缺少 `fastapi` / `pydantic` 依赖 | 改用仓库自带虚拟环境 `backend/venv/bin/python` 完成验证 |

## Resources
- `CLAUDE.md`
- `EVIDENCE.md`
- `/Users/zz/AI/NeoVista-standalone-backups/Neovista2.0-prune-20260411-204325/top-level-extras/PROGRESS.md`
- `docs/current-mode-usage-guide.md`
- `backend/main.py`
- `backend/llm_service.py`
- `frontend/src/store/useAppStore.js`
- `frontend/src/components/workspace/AgentChatInput.jsx`
- `frontend/src/components/workspace/ChatHistory.jsx`
- `frontend/src/lib/referenceImages.js`
- `tests/test_multimodal_reference_flow.py`
- `tests/test_audit_channel_resilience.py`
- `tests/test_chat_channel_config.py`
- `frontend/src/components/workspace/SkillsGallery.jsx`
- `frontend/src/components/home/TemplateDetailModal.jsx`
- `docs/superpowers/specs/2026-04-16-auth-gating-for-model-actions-design.md`
- `docs/superpowers/plans/2026-04-16-auth-gating-for-model-actions.md`

## Visual/Browser Findings
- 本轮未使用浏览器或图片查看工具；项目状态判断完全基于仓库内代码、文档与 git 记录。
