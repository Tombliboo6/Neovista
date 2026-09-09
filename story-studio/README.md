# PRISM Story Studio

本地 AI 影视创作工作台，支持从小说与创意出发，完成剧本、人物与场景资产、故事板、视频、配乐和最终合成。

当前版本：**0.1.40**。面向 Windows 桌面使用，提供导演流程与自由画布两种创作方式。源码工程名为 `prism-autodrama`。

## 下载与安装

[下载 Story Studio 0.1.40 安装包](https://github.com/Tombliboo6/Neovista/releases/tag/story-studio-v0.1.40)

1. 下载并运行 `PRISM-Story-Studio-Setup-0.1.40.exe`，选择程序安装位置。
2. 启动客户端，在“设置 → 文件与存储”确认项目库位置。
3. 在“连接与模型”配置文字、图片及所需的视频或音乐接口。
4. 在“系统与诊断”检查本机组件状态，再开始创作。

客户端内置 FFmpeg、FFprobe 和 Real-ESRGAN 图片超分组件。使用本机视频生成时，另行安装并连接 PRISM H3；使用本机 ACE-Step 配乐时，另行安装对应组件。云视频需要用户自己的服务商账号与调用权限。

安装包校验：

```powershell
Get-FileHash .\PRISM-Story-Studio-Setup-0.1.40.exe -Algorithm SHA256
```

与 Release 中的 `.sha256` 文件对照。本版本安装包的 SHA-256 为：

```text
4C19DD74E621BA1146C6C154907239E8A1391746E2CDE1326B50979A30DC2827
```

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 剧本创作 | 小说导入、智能拆集、分集剧本生成、编辑与确认 |
| 人物与资产 | 跨集人物库、人物造型、场景与道具资产、批量生成与复用 |
| 故事板 | 文字分镜、宫格故事板、批量生成、失败诊断与恢复 |
| 视频制作 | 视频提示词、参考资产绑定、提交前校验、生成任务和结果管理 |
| 自由画布 | 节点组织、连接与参考关系、对齐、复制粘贴、撤销与重做 |
| 配乐与成片 | 音乐提示词、配乐接口、媒体处理、粗剪与最终合成 |
| 任务管理 | 进度与队列、并发控制、错误记录、项目保存与历史结果保留 |

### 视频接口

| 接口 | 使用条件 |
| --- | --- |
| PRISM H3 | 本机独立安装后端，按当前节点与模型能力选择生成模式 |
| MiniMax 海螺 API | 配置服务商接口，支持当前适配的文生视频与首帧生成 |
| Seedance API | 配置方舟兼容接口，按模型能力使用图片参考协议 |

接口能力、参数约束与任务恢复设计见 [视频接口架构](docs/VIDEO_PROVIDER_ARCHITECTURE_2026-09-09.md)。

## 基本创作流程

```text
导入小说或创意
  → 拆集与剧本确认
  → 选择画风、整理人物与资产
  → 生成并确认人物、场景和道具图片
  → 文字分镜与故事板
  → 视频提示词确认、选择接口生成
  → 配乐、合成与成片验收
```

逐阶段审批模式下，按界面确认后进入后续制作。修改上游内容会将受影响的下游标记为待更新，已有结果继续保留。任务失败时先查看错误与服务商任务状态，再决定恢复、修正或重试。

## 源码运行

建议使用 **Node.js 24**；根目录声明的最低版本为 `22.13.0`，还需满足网页依赖的运行要求。以下命令在包含本文件的应用目录执行。

```powershell
npm ci
npm --prefix web install
npm run web:dev
```

打开终端输出的本机地址。Vite 同时加载本地 API 插件，文字和媒体生成仍需要配置对应接口。

需要在后台运行已构建的网页时：

```powershell
npm run web:build
npm run web:open
```

该启动器使用 `http://127.0.0.1:5173/`，日志位于 `runtime-data/logs/web-dev.log`。正式桌面客户端使用动态本机端口。

### 桌面开发与打包

桌面准备脚本会校验并复制已准备好的第三方组件。先依据 [组件锁文件](scripts/desktop-components.lock.json) 准备匹配的文件与许可证，再通过以下环境变量指定目录：

| 环境变量 | 目录内容 |
| --- | --- |
| `PRISM_FFMPEG_BUNDLE_ROOT` | 包含 `bin/` 和许可证的 FFmpeg 发行目录 |
| `PRISM_REALESRGAN_BUNDLE_ROOT` | Real-ESRGAN 程序、模型及对应发行文件 |
| `PRISM_COMPONENT_LICENSE_ROOT` | 脚本要求的 Real-ESRGAN、ncnn 等许可证文件 |

具体路径结构和校验要求见 [组件准备脚本](scripts/prepare-desktop-components.mjs)。构建还需要 `build/` 安装器资源；内置画风预览位于 `runtime-data/style-presets/v2/`。这些文件在已有开发工作区中可用，从 Git 获取源码时应确认资源齐全；Neovista 的发布源码快照包含上述资源。

准备完成后执行：

```powershell
npm run desktop:dev
```

生成 Windows 安装包及发布 ZIP：

```powershell
npm run desktop:pack
```

产物位于 `release/`。打包包含第三方组件校验、网页构建、桌面运行模块构建、安装器生成及发布包组装。

## 测试与验证

```powershell
npm test
npm run web:test
npm run desktop:test
npm run check
npm run web:build
```

0.1.40 已验证：核心测试 **423/423**、网页测试 **350/350**、桌面测试 **7/7**，项目检查与生产构建通过。

本机安装及数据保留已完成验证。云视频账号权限、真实输出画质和音轨质量仍需配置账号后实际验收；自动化测试通过不能替代真实生成与最终成片检查。

## 数据与配置

- 桌面客户端默认将项目、素材和成片存入用户视频目录下的 `PRISM Story Studio` 文件夹，可在设置中调整。
- 桌面 API Key 使用 Windows 安全存储加密保存；开发环境可参考 [.env.example](.env.example) 配置本机环境。
- 项目、资产和任务保留稳定 ID、版本与审批状态。升级前建议备份项目库。
- API Key、客户原文、客户素材、运行数据、生成结果和模型文件不提交到 Git。
- 本项目按本机单用户工作台设计；公网服务需要单独设计鉴权、隔离和部署方案。

## 目录导航

| 目录 | 用途 |
| --- | --- |
| `src/` | 领域模型、创作流程、Provider 适配、提示词与校验 |
| `web/` | React 界面、本地 API、任务与数据存储 |
| `desktop/` | Electron 启动、本机服务及组件发现 |
| `scripts/` | 开发启动、构建、组件校验和发布组装 |
| `tests/`、`web/tests/` | 核心、桌面与网页测试 |
| `docs/` | 架构、使用说明、验收与版本记录 |
| `.ai-pm/` | 当前项目状态、问题与测试记录 |
| `runtime-data/` | 开发环境运行数据与本机资源 |
| `release/` | 本机生成的安装包与发布文件 |

## 进一步阅读

- [当前项目状态](.ai-pm/PROJECT_STATE.md)
- [架构说明](docs/ARCHITECTURE.md)
- [验收标准](docs/ACCEPTANCE.md)
- [视频接口架构](docs/VIDEO_PROVIDER_ARCHITECTURE_2026-09-09.md)
- [可选组件](docs/OPTIONAL_COMPONENTS.md)
- [第三方组件声明](docs/CLIENT_THIRD_PARTY_NOTICES.md)
- [Neovista 发布源码](https://github.com/Tombliboo6/Neovista/tree/story-studio-v0.1.40/story-studio)
