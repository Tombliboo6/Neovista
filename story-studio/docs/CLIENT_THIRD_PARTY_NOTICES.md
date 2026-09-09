# PRISM Story Studio 第三方许可证

PRISM Story Studio 使用以下开源组件。各组件版权归其权利人所有，并按对应许可证使用。

## 桌面运行时

- Electron 43.3.0 — MIT License
- Electron 随附的 Chromium、Node.js 及其他组件 — 许可证全文见客户端安装目录中的 `LICENSE` 与 `LICENSES.chromium.html`

## 客户端界面运行时

### MIT License

- React 19.2.8
- React DOM 19.2.8
- Scheduler 0.27.0
- React Flow (`@xyflow/react`) 12.11.5
- XYFlow System 0.0.81
- Zustand 4.5.7
- Classcat 5.0.5
- use-sync-external-store 1.6.0

### ISC License

- d3-color 3.1.0
- d3-dispatch 3.0.1
- d3-drag 3.0.0
- d3-interpolate 3.0.1
- d3-selection 3.0.0
- d3-timer 3.0.1
- d3-transition 3.0.1
- d3-zoom 3.0.0

### BSD 3-Clause License

- d3-ease 3.0.1

## 文字模型适配运行时

### Apache License 2.0

- Vercel AI SDK (`ai`) 7.0.92
- Vercel AI SDK Anthropic Provider (`@ai-sdk/anthropic`) 4.0.49
- Vercel AI SDK OpenAI-Compatible Provider (`@ai-sdk/openai-compatible`) 3.0.43

## 内置媒体组件

- FFmpeg `n8.1.2-50-g1a748fe2cd-20260829`，BtbN `win64-lgpl-shared-8.1` 构建 — LGPL v3。客户端把 FFmpeg 作为独立程序与可替换的动态库调用，没有重命名或静态链接这些库。完整许可证位于安装目录 `resources/tools/licenses/FFmpeg-LGPLv3.txt`。上游源码与构建脚本分别见 [FFmpeg](https://github.com/FFmpeg/FFmpeg/tree/1a748fe2cd) 和 [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-08-29-13-12)。
- Real-ESRGAN NCNN Vulkan `v0.2.5.0-20220424` — Real-ESRGAN 主项目 BSD 3-Clause，NCNN 实现 MIT，Tencent NCNN BSD 3-Clause。完整许可证位于安装目录 `resources/tools/licenses/`。

组件版本、来源与 SHA-256 已锁定在 `scripts/desktop-components.lock.json`。PRISM H3 与 ACE-Step 不是本安装包的一部分；客户端只发现并连接用户本机已有的独立安装。

组件版本和许可证依据本次锁定的生产依赖生成。对应项目主页及完整许可证文本可从各组件发布包与官方仓库获取。本说明用于提供第三方组件归属与分发材料，不构成法律意见；对外商业分发前仍应进行一次许可证与专利合规复核。

## Ajv

- Ajv 8.20.0，MIT License，JSON Schema 本地校验。
- https://github.com/ajv-validator/ajv
