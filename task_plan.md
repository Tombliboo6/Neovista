# Task Plan: 校对项目进度并补齐 progress.md

## Goal
基于当前仓库代码、文档与未提交改动，梳理 NeoVista 的当前项目进度，并把已经完成但尚未登记的内容准确写入根目录 `progress.md`。

## Current Phase
Phase 5

## Phases

### Phase 1: 需求与现状核对
- [x] 理解用户要“检查整个项目进度并补齐 progress.md”
- [x] 查找现有 `task_plan.md`、`findings.md`、`progress.md`
- [x] 核对仓库内可作为证据的文档与代码改动
- **Status:** complete

### Phase 2: 项目进度梳理
- [x] 提炼已提交的项目主线能力
- [x] 提炼当前工作区已完成但未登记的功能
- [x] 区分“已实现”“已验证”“待提交”三类状态
- **Status:** complete

### Phase 3: 文档补齐
- [x] 创建根目录规划文件骨架
- [x] 写入 `findings.md`
- [x] 写入 `progress.md`
- **Status:** complete

### Phase 4: 验证
- [x] 运行与本次登记内容相关的前后端测试
- [x] 将验证结果补回 `progress.md`
- [x] 检查文档内容与仓库实际状态是否一致
- **Status:** complete

### Phase 5: 交付
- [x] 向用户汇报当前项目进度与本次补齐内容
- [x] 说明验证结果与剩余风险
- **Status:** complete

## Key Questions
1. 根目录是否已有正式的 `progress.md` 可直接更新？
2. 当前哪些功能已经实现但还未被项目级进度文档记录？
3. 需要如何区分已提交历史与当前工作区未提交进展？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 在根目录新建 `task_plan.md`、`findings.md`、`progress.md` | 仓库根目录原本不存在正式规划文件，本次任务需要可持续的项目进度基线 |
| 以代码 diff、测试文件、`EVIDENCE.md` 与 `docs/current-mode-usage-guide.md` 为主要证据源 | 这些内容直接反映当前系统真实行为与未登记进展 |
| 在 `progress.md` 中拆分“整体项目快照”和“本轮补记进展” | 既回答“整个项目进度”，也精确补齐未更新内容 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 根目录缺少 `task_plan.md` / `findings.md` / `progress.md` | 1 | 按项目当前状态创建最小可用版本，并将本轮核对结果落盘 |
| 系统 Python 缺少后端测试依赖 | 1 | 改用仓库自带 `backend/venv/bin/python` 运行后端测试 |

## Notes
- `CLAUDE.md` 要求不得擅改 `.env` 与核心 API 配置，本次仅补齐进度文档与做只读核对。
- 当前工作区存在多处未提交改动，本次将其视为“已实现但待提交/待最终确认”的最新进度。

## Follow-up Task: 登录门禁统一化

### Goal
让所有会调用模型的前端交互在未登录时统一弹出登录框，而不是只有生图链路拦截。

### Current Phase
Phase 1

### Phases

#### Phase 1: 需求与设计确认
- [x] 盘点当前模型调用入口
- [x] 与用户确认“所有模型调用都需登录”
- [x] 确认采用方案 A：store 统一门禁
- [x] 写入设计文档并等待用户确认
- **Status:** complete

#### Phase 2: 测试先行
- [x] 为 `directChat`、`workspaceChat`、`triggerTemplateAdjustParams` 补充未登录用例
- [x] 验证现有 `generateImage`、`confirmGenerate` 门禁不回退
- **Status:** complete

#### Phase 3: 实现统一门禁
- [x] 在 store 中抽取统一鉴权 helper
- [x] 将所有模型调用入口接入 helper
- [x] 保持组件层少量就近拦截但不依赖组件层兜底
- **Status:** complete

#### Phase 4: 验证与文档同步
- [x] 运行前端相关测试
- [x] 更新 `progress.md`
- **Status:** complete

#### Phase 5: 交付
- [x] 向用户汇报结果与剩余风险
- **Status:** complete

## Follow-up Task: 登录框上下文文案优化

### Goal
在未登录触发模型调用时，让登录框明确提示“当前操作需要登录，登录后可继续当前操作”，但不自动续做。

### Current Phase
Phase 4

### Phases

#### Phase 1: 体验方案确认
- [x] 与用户确认采用“文案优化 + 提示可继续当前操作”
- [x] 明确不做自动续做
- **Status:** complete

#### Phase 2: 测试先行
- [x] 为 store 上下文字段补测试
- [x] 为 `AuthModal` 提示文案补测试
- **Status:** complete

#### Phase 3: 实现
- [x] 为统一门禁 helper 增加动作上下文
- [x] 在 `AuthModal` 中展示上下文提示
- [x] 成功登录后清理上下文
- **Status:** complete

#### Phase 4: 验证与同步
- [x] 运行前端相关测试
- [x] 更新设计与进度文档
- **Status:** complete
