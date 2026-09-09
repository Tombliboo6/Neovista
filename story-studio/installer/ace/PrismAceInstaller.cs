using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("PRISM ACE-Step 1.5 Installer")]
[assembly: System.Reflection.AssemblyDescription("Offline installer for the PRISM ACE-Step 1.5 local music component")]
[assembly: System.Reflection.AssemblyCompany("PRISM")]
[assembly: System.Reflection.AssemblyProduct("PRISM ACE-Step 1.5")]
[assembly: System.Reflection.AssemblyVersion("1.5.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.5.0.0")]

namespace PrismAceInstaller
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new InstallerForm(Environment.GetCommandLineArgs());
            if (form.AcceptanceMode)
            {
                Environment.ExitCode = form.RunAcceptanceSynchronously();
                form.Dispose();
                return;
            }
            Application.Run(form);
        }
    }

    internal sealed class PayloadPart
    {
        public string FileName;
        public long Bytes;
        public string Sha256;
    }

    internal sealed class PayloadManifest
    {
        public string Product;
        public string Version;
        public long UnpackedBytes;
        public readonly List<PayloadPart> Parts = new List<PayloadPart>();

        public static PayloadManifest Load(string filePath)
        {
            if (!File.Exists(filePath))
                throw new InstallException("ACE-MANIFEST-MISSING", "离线载荷清单不存在。请确认安装器与 payload 文件夹放在一起。");

            var result = new PayloadManifest();
            foreach (var raw in File.ReadAllLines(filePath, Encoding.UTF8))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal)) continue;
                if (line.StartsWith("PRODUCT=", StringComparison.Ordinal)) result.Product = line.Substring(8);
                else if (line.StartsWith("VERSION=", StringComparison.Ordinal)) result.Version = line.Substring(8);
                else if (line.StartsWith("UNPACKED_BYTES=", StringComparison.Ordinal))
                    result.UnpackedBytes = ParseLong(line.Substring(15), "ACE-MANIFEST-INVALID");
                else if (line.StartsWith("PART|", StringComparison.Ordinal))
                {
                    var fields = line.Split('|');
                    if (fields.Length != 4) throw new InstallException("ACE-MANIFEST-INVALID", "载荷清单中的分卷记录格式不正确。");
                    result.Parts.Add(new PayloadPart
                    {
                        FileName = fields[1],
                        Bytes = ParseLong(fields[2], "ACE-MANIFEST-INVALID"),
                        Sha256 = fields[3].ToUpperInvariant()
                    });
                }
            }
            if (result.Product != "PRISM ACE-Step 1.5" || string.IsNullOrWhiteSpace(result.Version) ||
                result.UnpackedBytes <= 0 || result.Parts.Count == 0)
                throw new InstallException("ACE-MANIFEST-INVALID", "载荷清单缺少产品、版本、体积或分卷信息。");
            return result;
        }

        private static long ParseLong(string value, string code)
        {
            long number;
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number < 0)
                throw new InstallException(code, "载荷清单包含无效数字。");
            return number;
        }
    }

    internal sealed class InstallException : Exception
    {
        public readonly string Code;
        public InstallException(string code, string message) : base(message) { Code = code; }
        public InstallException(string code, string message, Exception inner) : base(message, inner) { Code = code; }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly TextBox _pathBox = new TextBox();
        private readonly Button _browseButton = new Button();
        private readonly Button _installButton = new Button();
        private readonly Button _openLogButton = new Button();
        private readonly ProgressBar _progress = new ProgressBar();
        private readonly Label _stageLabel = new Label();
        private readonly Label _detailLabel = new Label();
        private readonly RichTextBox _details = new RichTextBox();
        private readonly Stopwatch _elapsed = new Stopwatch();
        private readonly object _logLock = new object();
        private string _logPath;
        private bool _installing;
        private readonly bool _acceptanceMode;

        internal bool AcceptanceMode { get { return _acceptanceMode; } }

        public InstallerForm(string[] arguments)
        {
            _acceptanceMode = arguments.Any(value => value.Equals("--acceptance", StringComparison.OrdinalIgnoreCase));
            Text = "PRISM ACE-Step 1.5 安装器";
            ClientSize = new Size(760, 520);
            MinimumSize = new Size(760, 520);
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(246, 245, 249);
            Font = new Font("Microsoft YaHei UI", 9F);

            var header = new GradientPanel();
            header.Dock = DockStyle.Top;
            header.Height = 112;
            Controls.Add(header);

            var title = new Label();
            title.Text = "PRISM ACE-Step 1.5";
            title.ForeColor = Color.White;
            title.Font = new Font("Segoe UI", 21F, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(28, 20);
            header.Controls.Add(title);

            var subtitle = new Label();
            subtitle.Text = "本机音乐可选组件 · 离线一键安装";
            subtitle.ForeColor = Color.FromArgb(225, 220, 242);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 68);
            header.Controls.Add(subtitle);

            var pathLabel = new Label();
            pathLabel.Text = "安装目录";
            pathLabel.Font = new Font(Font, FontStyle.Bold);
            pathLabel.AutoSize = true;
            pathLabel.Location = new Point(28, 134);
            Controls.Add(pathLabel);

            _pathBox.Location = new Point(28, 158);
            _pathBox.Size = new Size(596, 30);
            _pathBox.Text = DefaultInstallDirectory();
            var installDirectoryArgument = arguments.FirstOrDefault(value => value.StartsWith("--install-dir=", StringComparison.OrdinalIgnoreCase));
            if (installDirectoryArgument != null) _pathBox.Text = installDirectoryArgument.Substring("--install-dir=".Length);
            Controls.Add(_pathBox);

            _browseButton.Text = "选择…";
            _browseButton.Location = new Point(636, 156);
            _browseButton.Size = new Size(96, 32);
            _browseButton.Click += BrowseClicked;
            Controls.Add(_browseButton);

            _stageLabel.Text = "准备安装";
            _stageLabel.Font = new Font(Font, FontStyle.Bold);
            _stageLabel.Location = new Point(28, 210);
            _stageLabel.Size = new Size(704, 24);
            Controls.Add(_stageLabel);

            _progress.Location = new Point(28, 238);
            _progress.Size = new Size(704, 22);
            Controls.Add(_progress);

            _detailLabel.Text = "安装器会校验全部分卷、创建目录、解压运行时并验证 Python 环境。";
            _detailLabel.ForeColor = Color.FromArgb(80, 78, 88);
            _detailLabel.Location = new Point(28, 270);
            _detailLabel.Size = new Size(704, 42);
            Controls.Add(_detailLabel);

            _details.Location = new Point(28, 318);
            _details.Size = new Size(704, 116);
            _details.ReadOnly = true;
            _details.BackColor = Color.White;
            _details.BorderStyle = BorderStyle.FixedSingle;
            _details.Text = "等待开始。安装期间不会联网，也不会自动提交音乐生成任务。";
            Controls.Add(_details);

            _openLogButton.Text = "打开日志";
            _openLogButton.Location = new Point(28, 460);
            _openLogButton.Size = new Size(106, 34);
            _openLogButton.Enabled = false;
            _openLogButton.Click += OpenLogClicked;
            Controls.Add(_openLogButton);

            _installButton.Text = "开始安装";
            _installButton.Location = new Point(584, 456);
            _installButton.Size = new Size(148, 40);
            _installButton.BackColor = Color.FromArgb(99, 66, 160);
            _installButton.ForeColor = Color.White;
            _installButton.FlatStyle = FlatStyle.Flat;
            _installButton.FlatAppearance.BorderSize = 0;
            _installButton.Click += InstallClicked;
            Controls.Add(_installButton);

            FormClosing += OnFormClosing;
            if (_acceptanceMode)
            {
                Opacity = 0;
                ShowInTaskbar = false;
            }
        }

        internal int RunAcceptanceSynchronously()
        {
            _installing = true;
            _elapsed.Start();
            try
            {
                Install();
                return 0;
            }
            catch (InstallException error)
            {
                Log(error.Code + ": " + error);
                return 1;
            }
            catch (Exception error)
            {
                Log("ACE-INSTALL-UNEXPECTED: " + error);
                return 1;
            }
            finally
            {
                _elapsed.Stop();
                _installing = false;
            }
        }

        private static string DefaultInstallDirectory()
        {
            try
            {
                var e = new DriveInfo("E");
                if (e.IsReady && e.DriveType == DriveType.Fixed) return @"E:\AI\ACE-Step-1.5";
            }
            catch { }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM", "ACE-Step-1.5");
        }

        private void BrowseClicked(object sender, EventArgs e)
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择 ACE-Step 1.5 的安装位置";
                dialog.ShowNewFolderButton = true;
                var current = _pathBox.Text.Trim();
                if (Directory.Exists(current)) dialog.SelectedPath = current;
                else
                {
                    var parent = Path.GetDirectoryName(current);
                    if (Directory.Exists(parent)) dialog.SelectedPath = parent;
                }
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    var selected = dialog.SelectedPath;
                    if (!selected.EndsWith("ACE-Step-1.5", StringComparison.OrdinalIgnoreCase))
                        selected = Path.Combine(selected, "ACE-Step-1.5");
                    _pathBox.Text = selected;
                }
            }
        }

        private async void InstallClicked(object sender, EventArgs e)
        {
            if (_installing) return;
            _installing = true;
            SetControlsForInstall(true);
            _elapsed.Restart();
            try
            {
                await Task.Run((Action)Install);
                UpdateProgress(100, "安装完成", "ACE-Step 1.5 已完成校验，PRISM Story Studio 会自动发现这个组件。");
                AppendDetail("安装成功。可以关闭安装器并启动 PRISM Story Studio。");
                BeginInvoke((Action)(() =>
                {
                    if (_acceptanceMode)
                    {
                        Environment.ExitCode = 0;
                        Close();
                        return;
                    }
                    _installButton.Text = "完成";
                    _installButton.Enabled = true;
                    _installButton.Click -= InstallClicked;
                    _installButton.Click += delegate { Close(); };
                }));
            }
            catch (InstallException error)
            {
                ShowFailure(error.Code, error.Message, error);
            }
            catch (Exception error)
            {
                ShowFailure("ACE-INSTALL-UNEXPECTED", "安装器遇到未预期错误。", error);
            }
            finally
            {
                _elapsed.Stop();
                _installing = false;
            }
        }

        private void Install()
        {
            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var payloadDirectory = Path.Combine(baseDirectory, "payload");
            var manifestPath = Path.Combine(payloadDirectory, "payload.manifest");
            var sevenZipPath = Path.Combine(baseDirectory, "7za.exe");
            InitializeLog();
            var manifest = PayloadManifest.Load(manifestPath);
            var destination = NormalizeDestination(ReadPath());
            Log("Product: " + manifest.Product);
            Log("Version: " + manifest.Version);
            Log("Destination: " + destination);

            UpdateProgress(1, "安装前检查", "正在检查系统、目标目录和磁盘空间…");
            if (!Environment.Is64BitOperatingSystem)
                throw new InstallException("ACE-OS-UNSUPPORTED", "ACE-Step 1.5 只支持 64 位 Windows。");
            if (!File.Exists(sevenZipPath))
                throw new InstallException("ACE-EXTRACTOR-MISSING", "7za.exe 不存在，离线安装包不完整。");

            var root = Path.GetPathRoot(destination);
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root))
                throw new InstallException("ACE-DESTINATION-INVALID", "安装目录所在磁盘不存在。");
            var drive = new DriveInfo(root);
            var required = manifest.UnpackedBytes + 2L * 1024 * 1024 * 1024;
            if (drive.AvailableFreeSpace < required)
                throw new InstallException("ACE-DISK-SPACE", string.Format("磁盘空间不足：至少需要 {0}，当前可用 {1}。", FormatBytes(required), FormatBytes(drive.AvailableFreeSpace)));
            if (Directory.Exists(destination) && Directory.EnumerateFileSystemEntries(destination).Any())
                throw new InstallException("ACE-DESTINATION-NOT-EMPTY", "安装目录不是空目录。为避免覆盖已有模型或环境，请选择新的空目录。");

            VerifyPayload(payloadDirectory, manifest);
            Directory.CreateDirectory(destination);
            ExtractPayload(sevenZipPath, payloadDirectory, manifest, destination);
            ConfigurePortableRuntime(destination);
            VerifyInstallation(destination);
            WriteDiscovery(destination, manifest.Version);
            Log("Installation completed successfully.");
        }

        private void VerifyPayload(string payloadDirectory, PayloadManifest manifest)
        {
            var total = manifest.Parts.Sum(p => p.Bytes);
            long completed = 0;
            var buffer = new byte[4 * 1024 * 1024];
            var timer = Stopwatch.StartNew();
            for (var index = 0; index < manifest.Parts.Count; index++)
            {
                var part = manifest.Parts[index];
                var filePath = Path.Combine(payloadDirectory, part.FileName);
                if (!File.Exists(filePath))
                    throw new InstallException("ACE-PAYLOAD-PART-MISSING", "缺少离线分卷：" + part.FileName);
                var info = new FileInfo(filePath);
                if (info.Length != part.Bytes)
                    throw new InstallException("ACE-PAYLOAD-SIZE-MISMATCH", "离线分卷体积不符：" + part.FileName);

                using (var sha = SHA256.Create())
                using (var stream = File.OpenRead(filePath))
                {
                    int count;
                    while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        sha.TransformBlock(buffer, 0, count, null, 0);
                        completed += count;
                        var ratio = total == 0 ? 0 : completed / (double)total;
                        var speed = completed / Math.Max(0.1, timer.Elapsed.TotalSeconds);
                        UpdateProgress(2 + (int)(ratio * 43), "校验离线载荷",
                            string.Format("分卷 {0}/{1} · {2:P1} · {3}/s · 已用 {4}",
                                index + 1, manifest.Parts.Count, ratio, FormatBytes((long)speed), FormatElapsed(timer.Elapsed)));
                    }
                    sha.TransformFinalBlock(new byte[0], 0, 0);
                    var actual = BitConverter.ToString(sha.Hash).Replace("-", "");
                    if (!actual.Equals(part.Sha256, StringComparison.OrdinalIgnoreCase))
                        throw new InstallException("ACE-PAYLOAD-HASH-MISMATCH", "离线分卷校验失败：" + part.FileName + "。请重新复制该分卷。");
                }
                Log("Verified payload part: " + part.FileName);
            }
        }

        private void ExtractPayload(string sevenZipPath, string payloadDirectory, PayloadManifest manifest, string destination)
        {
            var firstPart = Path.Combine(payloadDirectory, manifest.Parts[0].FileName);
            UpdateProgress(46, "解压运行时与模型", "正在创建安装目录并解压文件…");
            var start = new ProcessStartInfo
            {
                FileName = sevenZipPath,
                Arguments = "x -y -bb0 -bsp1 -o" + Quote(destination) + " " + Quote(firstPart),
                WorkingDirectory = payloadDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            using (var process = Process.Start(start))
            {
                if (process == null) throw new InstallException("ACE-EXTRACTOR-START", "无法启动离线解压程序。");
                var output = new StringBuilder();
                var error = new StringBuilder();
                var outputTask = PumpProcessStream(process.StandardOutput, output, true);
                var errorTask = PumpProcessStream(process.StandardError, error, true);
                process.WaitForExit();
                Task.WaitAll(outputTask, errorTask);
                Log("7za exit code: " + process.ExitCode);
                if (output.Length > 0) Log(output.ToString());
                if (error.Length > 0) Log(error.ToString());
                if (process.ExitCode != 0)
                    throw new InstallException("ACE-EXTRACT-FAILED", "解压失败（退出码 " + process.ExitCode + "）。请查看安装日志中的 7za 输出。");
            }
        }

        private async Task PumpProcessStream(StreamReader reader, StringBuilder captured, bool parseProgress)
        {
            var chars = new char[512];
            int count;
            while ((count = await reader.ReadAsync(chars, 0, chars.Length).ConfigureAwait(false)) > 0)
            {
                var chunk = new string(chars, 0, count);
                if (captured.Length < 200000) captured.Append(chunk);
                if (!parseProgress) continue;
                var matches = Regex.Matches(chunk, @"(?<!\d)(\d{1,3})%");
                if (matches.Count > 0)
                {
                    int percent;
                    if (int.TryParse(matches[matches.Count - 1].Groups[1].Value, out percent))
                        UpdateProgress(46 + Math.Min(47, percent * 47 / 100), "解压运行时与模型",
                            string.Format("解压进度 {0}% · 总用时 {1}", percent, FormatElapsed(_elapsed.Elapsed)));
                }
            }
        }

        private void ConfigurePortableRuntime(string destination)
        {
            UpdateProgress(94, "配置可迁移运行时", "正在重建 Python 环境路径…");
            var pythonHome = Path.Combine(destination, "runtime", "python");
            var python = Path.Combine(destination, ".venv", "Scripts", "python.exe");
            var config = Path.Combine(destination, ".venv", "pyvenv.cfg");
            if (!File.Exists(Path.Combine(pythonHome, "python.exe")) || !File.Exists(python))
                throw new InstallException("ACE-PYTHON-MISSING", "解压完成，但 Python 运行时不完整。");
            var content = "home = " + pythonHome + Environment.NewLine +
                          "implementation = CPython" + Environment.NewLine +
                          "uv = 0.11.24" + Environment.NewLine +
                          "version_info = 3.12.10" + Environment.NewLine +
                          "include-system-site-packages = false" + Environment.NewLine +
                          "prompt = ace-step" + Environment.NewLine;
            File.WriteAllText(config, content, new UTF8Encoding(false));

            var launcher = "@echo off\r\ncd /d \"%~dp0\"\r\n\"%~dp0.venv\\Scripts\\python.exe\" -m acestep.api_server %*\r\n";
            File.WriteAllText(Path.Combine(destination, "启动 ACE-Step API.cmd"), launcher, Encoding.Default);
            Log("Portable Python home: " + pythonHome);
        }

        private void VerifyInstallation(string destination)
        {
            UpdateProgress(96, "验证安装结果", "正在检查模型文件并导入 ACE-Step 运行时…");
            VerifyMinimumSize(destination, @".venv\Scripts\python.exe", 1);
            VerifyMinimumSize(destination, @"checkpoints\acestep-v15-turbo\model.safetensors", 1000000000L);
            VerifyMinimumSize(destination, @"checkpoints\acestep-5Hz-lm-0.6B\model.safetensors", 500000000L);
            VerifyMinimumSize(destination, @"checkpoints\Qwen3-Embedding-0.6B\model.safetensors", 500000000L);
            VerifyMinimumSize(destination, @"checkpoints\vae\diffusion_pytorch_model.safetensors", 100000000L);

            var python = Path.Combine(destination, ".venv", "Scripts", "python.exe");
            var start = new ProcessStartInfo
            {
                FileName = python,
                Arguments = "-c " + Quote("import sys, acestep; print(sys.executable); print(acestep.__file__)"),
                WorkingDirectory = destination,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(start))
            {
                if (process == null) throw new InstallException("ACE-PYTHON-START", "无法启动 ACE-Step Python。");
                var stdout = process.StandardOutput.ReadToEnd();
                var stderr = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(120000))
                {
                    try { process.Kill(); } catch { }
                    throw new InstallException("ACE-PYTHON-TIMEOUT", "ACE-Step Python 验证超过 120 秒。");
                }
                Log(stdout);
                Log(stderr);
                if (process.ExitCode != 0)
                    throw new InstallException("ACE-PYTHON-IMPORT", "ACE-Step Python 导入失败（退出码 " + process.ExitCode + "）。");
            }
        }

        private static void VerifyMinimumSize(string destination, string relativePath, long minimumSize)
        {
            var filePath = Path.Combine(destination, relativePath);
            if (!File.Exists(filePath) || new FileInfo(filePath).Length < minimumSize)
                throw new InstallException("ACE-VERIFY-FILE-MISSING", "安装后文件缺失或体积异常：" + relativePath);
        }

        private void WriteDiscovery(string destination, string version)
        {
            UpdateProgress(99, "注册组件", "正在写入 PRISM Story Studio 自动发现信息…");
            var discoveryDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM", "ACE-Step");
            Directory.CreateDirectory(discoveryDirectory);
            var python = Path.Combine(destination, ".venv", "Scripts", "python.exe");
            var json = "{\n" +
                       "  " + QuoteJson("schemaVersion") + ": 1,\n" +
                       "  " + QuoteJson("product") + ": " + QuoteJson("PRISM ACE-Step 1.5") + ",\n" +
                       "  " + QuoteJson("version") + ": " + QuoteJson(version) + ",\n" +
                       "  " + QuoteJson("installDirectory") + ": " + QuoteJson(destination) + ",\n" +
                       "  " + QuoteJson("pythonExecutable") + ": " + QuoteJson(python) + ",\n" +
                       "  " + QuoteJson("installedAt") + ": " + QuoteJson(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)) + "\n" +
                       "}\n";
            File.WriteAllText(Path.Combine(discoveryDirectory, "installation.json"), json, new UTF8Encoding(false));
            File.Copy(_logPath, Path.Combine(destination, "安装日志.txt"), true);
        }

        private string ReadPath()
        {
            if (InvokeRequired) return (string)Invoke(new Func<string>(ReadPath));
            return _pathBox.Text;
        }

        private static string NormalizeDestination(string input)
        {
            if (string.IsNullOrWhiteSpace(input))
                throw new InstallException("ACE-DESTINATION-EMPTY", "请选择安装目录。");
            try
            {
                var full = Path.GetFullPath(Environment.ExpandEnvironmentVariables(input.Trim().Trim('"')));
                if (full.Equals(Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase))
                    throw new InstallException("ACE-DESTINATION-ROOT", "不能直接安装到磁盘根目录，请选择或创建一个文件夹。");
                return full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            }
            catch (InstallException) { throw; }
            catch (Exception error)
            {
                throw new InstallException("ACE-DESTINATION-INVALID", "安装目录格式不正确。", error);
            }
        }

        private void InitializeLog()
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM", "ACE-Step", "install-logs");
            Directory.CreateDirectory(directory);
            _logPath = Path.Combine(directory, "install-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".log");
            Log("PRISM ACE-Step 1.5 installer started.");
            if (!_acceptanceMode) BeginInvoke((Action)(() => { _openLogButton.Enabled = true; }));
        }

        private void Log(string value)
        {
            if (string.IsNullOrEmpty(_logPath)) return;
            lock (_logLock)
            {
                File.AppendAllText(_logPath, DateTime.Now.ToString("o", CultureInfo.InvariantCulture) + " " + value + Environment.NewLine, Encoding.UTF8);
            }
        }

        private void ShowFailure(string code, string message, Exception error)
        {
            Log(code + ": " + error);
            BeginInvoke((Action)(() =>
            {
                _progress.Style = ProgressBarStyle.Continuous;
                _stageLabel.Text = "安装未完成 · " + code;
                _detailLabel.Text = message;
                _details.Text = message + Environment.NewLine + Environment.NewLine + "错误代码：" + code +
                                (string.IsNullOrEmpty(_logPath) ? "" : Environment.NewLine + "日志：" + _logPath);
                _installButton.Text = "重试";
                _installButton.Enabled = true;
                _browseButton.Enabled = true;
                _pathBox.Enabled = true;
                if (_acceptanceMode)
                {
                    Environment.ExitCode = 1;
                    Close();
                }
                else
                {
                    MessageBox.Show(this, message + Environment.NewLine + Environment.NewLine + "错误代码：" + code +
                        (string.IsNullOrEmpty(_logPath) ? "" : Environment.NewLine + "日志：" + _logPath),
                        "PRISM ACE-Step 1.5 安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }));
        }

        private void UpdateProgress(int value, string stage, string detail)
        {
            if (_acceptanceMode) return;
            if (IsDisposed) return;
            BeginInvoke((Action)(() =>
            {
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = Math.Max(0, Math.Min(100, value));
                _stageLabel.Text = stage;
                _detailLabel.Text = detail;
                _details.Text = detail + Environment.NewLine +
                                "总进度：" + _progress.Value + "%" + Environment.NewLine +
                                "已用时间：" + FormatElapsed(_elapsed.Elapsed) +
                                (string.IsNullOrEmpty(_logPath) ? "" : Environment.NewLine + "日志：" + _logPath);
            }));
        }

        private void AppendDetail(string text)
        {
            if (_acceptanceMode) return;
            BeginInvoke((Action)(() => _details.AppendText(Environment.NewLine + text)));
        }

        private void SetControlsForInstall(bool installing)
        {
            _pathBox.Enabled = !installing;
            _browseButton.Enabled = !installing;
            _installButton.Enabled = !installing;
        }

        private void OpenLogClicked(object sender, EventArgs e)
        {
            if (!string.IsNullOrEmpty(_logPath) && File.Exists(_logPath))
                Process.Start(new ProcessStartInfo { FileName = _logPath, UseShellExecute = true });
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_installing || _acceptanceMode) return;
            var result = MessageBox.Show(this, "安装正在进行。中途退出会保留已写入的文件，之后需要选择新的空目录重新安装。确定退出吗？",
                "确认退出", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (result != DialogResult.Yes) e.Cancel = true;
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static string QuoteJson(string value)
        {
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
        }

        private static string FormatBytes(long bytes)
        {
            var value = (double)bytes;
            var units = new[] { "B", "KB", "MB", "GB", "TB" };
            var index = 0;
            while (value >= 1024 && index < units.Length - 1) { value /= 1024; index++; }
            return value.ToString(index >= 3 ? "0.00" : "0.0", CultureInfo.InvariantCulture) + " " + units[index];
        }

        private static string FormatElapsed(TimeSpan elapsed)
        {
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00}:{2:00}", (int)elapsed.TotalHours, elapsed.Minutes, elapsed.Seconds);
        }
    }

    internal sealed class GradientPanel : Panel
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            using (var brush = new System.Drawing.Drawing2D.LinearGradientBrush(ClientRectangle,
                Color.FromArgb(23, 18, 36), Color.FromArgb(107, 68, 165), 0F))
                e.Graphics.FillRectangle(brush, ClientRectangle);
            base.OnPaint(e);
        }
    }
}
