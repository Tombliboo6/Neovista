# PRISM ACE-Step 1.5 离线安装包

ACE-Step 1.5 是 PRISM Story Studio 的可选本机音乐组件。PRISM H3 已经包含 RTX 视频超分，本安装包不会重复安装视频超分组件。

## 安装

1. 保持 `PRISM-ACE-Step-1.5-Setup.exe`、`7za.exe` 和 `payload` 文件夹在同一目录。
2. 双击 `PRISM-ACE-Step-1.5-Setup.exe`。
3. 只需选择安装位置，再点击“开始安装”。
4. 安装器会依次检查磁盘空间、校验全部离线分卷、创建目录、解压运行时、重建可迁移 Python 路径并执行导入验证。
5. 安装完成后启动 PRISM Story Studio；Studio 会读取本机发现信息并自动连接该组件。

安装全程不联网，也不会提交音乐生成任务。建议使用 Windows 10/11 64 位系统和 NVIDIA CUDA 显卡；本包内运行时为 Python 3.12、PyTorch 2.7.1 + CUDA 12.8。

## 空间

安装器会根据载荷清单计算实际空间，并额外预留 2 GiB。请把所有分卷完整下载到本机后再开始安装。

## 日志与错误

安装器会在 `%LOCALAPPDATA%\PRISM\ACE-Step\install-logs` 保存日志。失败窗口会显示错误代码、明确原因和日志路径。

- `ACE-PAYLOAD-PART-MISSING`：缺少某个分卷。
- `ACE-PAYLOAD-HASH-MISMATCH`：分卷损坏或复制不完整。
- `ACE-DISK-SPACE`：目标磁盘空间不足。
- `ACE-DESTINATION-NOT-EMPTY`：目标目录已有文件，为保护现有模型不执行覆盖。
- `ACE-EXTRACT-FAILED`：离线载荷解压失败，日志中保留 7-Zip 退出码。
- `ACE-PYTHON-IMPORT`：文件已解压，但 ACE-Step Python 运行时导入失败。

本安装器和 PRISM Story Studio 当前未做代码签名，Windows 可能显示 SmartScreen 提示。请先核对 `SHA256SUMS.txt`，确认文件来自可信发布者。
