# PRISM Story Studio 0.1.40

本地 AI 影视创作工作台，支持小说拆集、剧本、人物库、场景与道具资产、故事板、视频提示词、视频生成、配乐和合成。提供导演流程与自由画布。

## 安装

[下载 Windows 安装包及校验文件](https://github.com/Tombliboo6/Neovista/releases/tag/story-studio-v0.1.40)。运行 `PRISM-Story-Studio-Setup-0.1.40.exe`，在设置中配置模型接口和数据目录。

视频接口包括本机 PRISM H3、MiniMax 海螺与 Seedance。H3 后端需单独安装；云端生成需要用户自己的账号与 API 配置。接口权限和真实生成质量需在配置后验收。

## 开发

在本目录操作，使用满足 `package.json` 要求的 Node.js（建议 Node.js 24）。

```powershell
npm ci
npm --prefix web install
npm run web:dev
```

开发服务仅监听本机。桌面开发运行 `npm run desktop:dev`。首次准备桌面组件会下载 `scripts/desktop-components.lock.json` 固定版本的工具并校验哈希。

```powershell
npm test
npm run web:test
npm run desktop:test
npm run check
npm run web:build
npm run desktop:pack
```

`desktop:pack` 生成 Windows 安装包和发布 ZIP。可选音乐组件参见 [组件说明](docs/OPTIONAL_COMPONENTS.md)，第三方组件使用条款参见 [第三方声明](docs/CLIENT_THIRD_PARTY_NOTICES.md)。

## 源码范围与数据

包含应用源码、自动化测试、构建脚本、依赖锁文件、安装器资源及内置画风预览。`SOURCE_MANIFEST.json` 记录导入时各原始文件的 SHA-256；本目录 README、状态说明和发布校验文件属于仓库交付说明。

API Key 保存在用户本机配置中。运行数据、客户素材、生成结果、模型文件和依赖目录不提交到 Git。正式使用请通过桌面客户端管理数据。

此目录是独立应用源码；Neovista 网页仍使用其原有构建流程。
