# 三种视频生成接口 · 0.1.40

2026-09-09。已实现本机 H3、MiniMax API、Seedance API，导演模式与自由画布共用原中文视频提示词，在提交时选择生成方式。本文描述0.1.40的实际实现与验收边界。

## 使用流程

1. 右上角设置中配置“本机 H3”“MiniMax 视频”或“Seedance 视频”。两个云接口分别保存地址、模型、密钥及多套命名配置。
2. 先按原流程生成、编辑和确认视频提示词。导演画布“视频参数”与自由画布视频节点均提供三种生成方式。
3. 选择接口配置、模式、分辨率及声音选项后点击生成。切换方式只影响下一次明确提交；运行中任务和旧视频继续使用提交时的服务身份。
4. 结果下载并解码后进入待验收，可播放、进入剪辑台和粗剪。时长、尺寸或音轨差异显示在结果旁。

## 当前能力

| 入口 | 当前实现 | 提交边界 |
| --- | --- | --- |
| 本机 H3 | 沿用原适配器、GPU 队列、全能参考、加速和连续镜头 | 以本机节点、模型、显存及现有预检为准 |
| MiniMax API | 海螺 2.3、2.3 Fast、Hailuo-02；文生与首帧；适配器包含 Hailuo-02 首尾帧协议 | 768P 的 6/10 秒，1080P 的 6 秒；2000 字符；无声；Fast 必须有首帧；当前界面未提供首尾帧模式 |
| Seedance API | 火山方舟中国区视频任务协议；文生、单张首帧、最多 9 张图片参考；可选择生成声音 | 4–15 秒整数，480P/720P/1080P；多图参考需支持该能力的 Seedance 2.0 模型；具体权限由账号决定 |

导演多图分镜可使用 H3 或 Seedance。MiniMax 在导演模式支持独立文生提示词，在自由画布支持文生及单张首帧。当前 MiniMax 文生仅接受 16:9；图生比例由首帧决定。MiniMax 云端接入是上述海螺公开协议，不能据此认定云端 H3 接口已接入。

云端视频、音频参考暂未开放；保留图片参考。时长超限、多图模式不兼容、仍有图片引用的文生提示词、缺少首帧等情况在付费 POST 前阻断，显示具体原因。当前不自动拆段、缩短时长或改写提示词。两个云接口不提供取消按钮，服务商任务不会因为切换模型或关闭窗口被删除。

## 代码与协议

- `src/providers/cloud-video.mjs`：MiniMax/Seedance HTTP、能力检查、图片字节编码、提示词标签转换、状态及下载。外部请求留在 Provider 层。
- `web/video-jobs.mjs`：云任务日志、重复提交保护、原配置版本绑定、重开恢复、下载与结果状态。
- `web/local-api.mjs`：工作流审批、配置持久化、三接口路由、媒体解码和原剪辑流程衔接。
- `web/src/VideoEngineControls.tsx`：复用生成方式选择器、配置刷新、提交待核实和原结果下载恢复。
- `App.tsx`、`FreeCanvas.tsx`、总管上下文：实际生成方式、任务参数、结果与恢复操作。

MiniMax 默认地址 `https://api.minimaxi.com/v1`，使用 `POST /video_generation`、`GET /query/video_generation` 和 `GET /files/retrieve`。关闭接口提示词优化，保留用户已确认正文。

Seedance 默认地址 `https://ark.cn-beijing.volces.com/api/v3`，使用 `POST /contents/generations/tasks` 与 `GET /contents/generations/tasks/:id`。模型填写账号可用的模型 ID 或接入点 ID。Seedance 只转换必要的 Picture/Subject 引用标记，按上传顺序声明图片与人物绑定，保存原文及实际提交文本。

参考图片使用 Base64 数据 URL，JPG/PNG/WebP，每张小于 20MB。云端不会收到本地磁盘路径或 localhost 素材地址。模型更具体的图片尺寸、格式和权限限制仍以服务商返回为准。

## 任务与凭据

- 原工作流依赖和审批检查继续有效。每次提交带项目、段号或自由节点 ID，以及稳定请求 ID；同一请求重复到达只创建一个任务。同一镜头已有活动任务时阻止第二个任务。
- 先保存 `cv-UUID` 本地任务，再执行一次创建请求。远端 ID 单独保存。原参数、提交正文、配置版本和历史输出留在任务目录中。
- 配置版本使用桌面端现有私密持久化通道；改配置、切换默认项或移除配置后，旧任务仍使用原版本查询。项目、公共状态及任务日志不含密钥。
- 创建请求断线、5xx 或未返回 ID 时进入“提交结果待核实”。用户可填写控制台找到的任务 ID，或明确确认未接单后重新发起；程序不自动重复付费 POST。
- 重开只查询已知远端 ID。后台查询周期 15 秒，界面轮询复用查询缓存；同任务查询及下载互斥。云任务不占用本地 GPU 或文字/图片调度槽。当前没有账号级在途生成数量控制。
- 下载失败保存原任务，用户点击重试只下载原结果。下载仅接受 HTTPS，限制 512MB，不向下载主机转发 API Key。
- MiniMax 测试连接显示“配置已保存”，不假装完成鉴权；Seedance 使用只读任务查询验证接口可达。模型生成权限与额度需要真实任务验证。

## 结果与剪辑

视频先写入临时文件，经过 ffprobe 和 FFmpeg 全文件解码后进入正式输出目录。保存实际时长、尺寸、帧率与音轨信息；参数差异保留媒体并提示待人工检查。

云任务结果复用现有 `outputPaths` 和 `/api/h3/media/:cv-id` 播放路径，支持 Range；地址中的 h3 是兼容路由，任务的实际服务由自身记录决定。`/api/videos/generations/:id` 统一查询云任务及原 H3 任务，`/api/videos/jobs` 只返回当前项目云任务。

明确选择无声生成的云视频在粗剪时使用等长静音轨对齐时间线，原素材不改写，清单记录 `normalized-with-intentional-silence`。请求原声却缺音轨的镜头继续阻断。不同帧率或不一致的原声音频规格沿用原粗剪检查，需处理后再拼接。媒体可解码与整片内容、镜头完整性及声音质量验收分别记录。

## 验收与交付

核心与网页回归、TypeScript/生产构建、桌面打包和项目基线检查见 `.ai-pm/TEST_LOG.md` 的 STUDIO-VIDEO-PROVIDERS-187。

隔离完整应用使用模拟云传输和本地合成视频，验证 MiniMax/Seedance 导演提交、自由画布 MiniMax 首帧、重复提交、超限拒绝、Range 206、缺声提示、原配置恢复及真实 FFmpeg 粗剪解码。测试没有使用真实账号、提交真实云生成或启动 H3 推理。模拟输出不能证明真实服务的模型权限、画质、音画效果或实际参数遵从性。

候选安装包：`release/PRISM-Story-Studio-Setup-0.1.40.exe`（242043375 字节）。SHA-256：`4C19DD74E621BA1146C6C154907239E8A1391746E2CDE1326B50979A30DC2827`。桌面运行文件46项一致，ZIP的7个文件完整性与内容哈希通过。

0.1.40 已按用户要求安装并启动。本机安装验收见 `STUDIO_VIDEO_PROVIDERS_0.1.40.md`。该版本也包含已完成的视频引用规则更新。

## 协议依据

- [MiniMax 视频生成指南](https://platform.minimax.io/docs/guides/video-generation)
- [MiniMax 文生视频](https://platform.minimax.io/docs/api-reference/video-generation-t2v)
- [MiniMax 图生视频](https://platform.minimax.io/docs/api-reference/video-generation-i2v)
- [MiniMax 首尾帧](https://platform.minimax.io/docs/api-reference/video-generation-fl2v)
- [火山引擎官方 Python SDK 视频任务实现](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py)
- [火山引擎官方任务输入类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py)
