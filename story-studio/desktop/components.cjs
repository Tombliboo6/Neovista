const { existsSync, readFileSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { basename, dirname, isAbsolute, join, resolve } = require('node:path');

const H3_EXECUTABLE = 'PRISM H3 控制台.exe';

function discoverDesktopComponents(options = {}) {
  const environment = options.environment ?? process.env;
  const settings = options.settings ?? {};
  const toolsRoot = resolve(options.toolsRoot ?? join(__dirname, '..', 'desktop-resources', 'tools'));
  const pathValue = String(environment.PATH || '');
  const automaticH3Candidates = options.h3ExecutableCandidates ?? h3ExecutableCandidates(environment);

  let h3Executable = firstFile([
    settings.h3Executable,
    environment.PRISM_H3_CONSOLE_EXE,
    ...automaticH3Candidates,
  ]);
  if (!h3Executable) h3Executable = firstFile(windowsInstalledH3Candidates(options.registryQuery));
  const expectedH3DiscoveryPath = h3Executable ? join(dirname(h3Executable), 'integration', 'integration-bridge.json') : '';
  const h3Discovery = firstValidH3Discovery([
    settings.h3DiscoveryPath,
    environment.PRISM_H3_BRIDGE_DISCOVERY_PATH,
    expectedH3DiscoveryPath,
    ...automaticH3Candidates.map((candidate) => join(dirname(candidate), 'integration', 'integration-bridge.json')),
  ]);
  const ffmpeg = firstFile([
    settings.ffmpegExecutable,
    environment.FFMPEG_EXECUTABLE,
    join(toolsRoot, 'ffmpeg.exe'),
    executableOnPath('ffmpeg.exe', pathValue),
  ]);
  const ffprobe = firstFile([
    settings.ffprobeExecutable,
    environment.FFPROBE_EXECUTABLE,
    join(toolsRoot, 'ffprobe.exe'),
    executableOnPath('ffprobe.exe', pathValue),
  ]);
  const realEsrgan = firstFile([
    settings.realEsrganExecutable,
    environment.REALESRGAN_EXECUTABLE,
    join(toolsRoot, 'real-esrgan', 'realesrgan-ncnn-vulkan.exe'),
    'C:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe',
    'D:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe',
    'E:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe',
  ]);
  const realEsrganModels = realEsrgan ? join(dirname(realEsrgan), 'models') : '';
  const realEsrganReady = realEsrgan && requiredRealEsrganModels().every((name) => isFile(join(realEsrganModels, name)));
  const aceDiscovery = readAceStepDiscovery(environment);
  const aceExecutable = firstFile([
    settings.aceStepExecutable,
    environment.ACESTEP_API_EXECUTABLE,
    aceDiscovery?.executable,
    ...['C:', 'D:', 'E:'].flatMap((drive) => [
      `${drive}/AI/ACE-Step-1.5/.venv/Scripts/python.exe`,
      `${drive}/AI/ACE-Step-1.5/.venv/Scripts/acestep-api.exe`,
    ]),
  ]);
  const aceProject = firstDirectory([
    settings.aceStepProjectRoot,
    environment.ACESTEP_PROJECT_ROOT,
    aceDiscovery?.projectRoot,
    aceExecutable ? resolve(dirname(aceExecutable), '..', '..') : '',
    ...['C:', 'D:', 'E:'].map((drive) => `${drive}/AI/ACE-Step-1.5`),
  ]);
  const aceReady = Boolean(aceExecutable && aceProject && requiredAceStepFiles().every(([relativePath, minimumSize]) => isFileAtLeast(join(aceProject, ...relativePath.split('/')), minimumSize)));

  return {
    resolved: {
      h3Executable: h3Executable || '',
      h3DiscoveryPath: h3Discovery?.path || expectedH3DiscoveryPath,
      ffmpegExecutable: ffmpeg || '',
      ffprobeExecutable: ffprobe || '',
      realEsrganExecutable: realEsrgan || '',
      aceStepExecutable: aceExecutable || '',
      aceStepProjectRoot: aceProject || '',
    },
    components: [
      {
        id: 'prism-h3', label: 'PRISM H3', category: 'required',
        status: h3Discovery ? 'ready' : h3Executable ? 'installed' : 'missing',
        path: h3Executable || h3Discovery?.path || '',
        message: h3Discovery ? `集成桥接已发现 · v${h3Discovery.manifest.prismVersion}` : h3Executable ? '已找到控制台，启动后自动连接。' : '尚未找到PRISM H3控制台。',
        capabilities: ['video-generation', 'rtx-video-upscale'],
      },
      {
        id: 'ffmpeg', label: '媒体处理组件', category: 'builtin-small',
        status: ffmpeg && ffprobe ? 'ready' : ffmpeg || ffprobe ? 'incomplete' : 'missing',
        path: ffmpeg || ffprobe || '',
        message: ffmpeg && ffprobe ? 'FFmpeg与FFprobe可用。' : '剪辑、合成和媒体校验组件尚未完整安装。',
        capabilities: ['editing', 'composition', 'media-validation'],
      },
      {
        id: 'real-esrgan', label: '图片超分', category: 'builtin-small',
        status: realEsrganReady ? 'ready' : realEsrgan ? 'incomplete' : 'missing',
        path: realEsrgan || '',
        message: realEsrganReady ? 'Real-ESRGAN运行时与图片模型可用。' : realEsrgan ? '已找到程序，但图片模型不完整。' : '图片超分组件尚未安装。',
        capabilities: ['image-upscale'],
      },
      {
        id: 'ace-step', label: 'ACE-Step 1.5', category: 'optional-large',
        status: aceReady ? 'ready' : aceExecutable || aceProject ? 'incomplete' : 'missing',
        path: aceProject || aceExecutable || '',
        message: aceReady ? '本机音乐组件可用。' : aceExecutable || aceProject ? '已找到运行时，但模型文件不完整。' : '本机音乐是可选组件，可按需安装。',
        capabilities: ['local-music'],
      },
    ],
  };
}

function h3ExecutableCandidates(environment) {
  const roots = [
    environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, 'Programs') : '',
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    ...['C:', 'D:', 'E:'].flatMap((drive) => [`${drive}/Apps`, `${drive}/PRISM`]),
  ].filter(Boolean);
  return roots.flatMap((root) => [
    join(root, 'PRISM H3 控制台', H3_EXECUTABLE),
    join(root, 'PRISM-H3-Console', H3_EXECUTABLE),
  ]);
}

function windowsInstalledH3Candidates(registryQuery = queryRegistryKey) {
  if (process.platform !== 'win32' && registryQuery === queryRegistryKey) return [];
  const uninstallRoots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const candidates = [];
  for (const root of uninstallRoots) {
    let searchOutput = '';
    try { searchOutput = registryQuery(root, true); } catch { continue; }
    const keys = String(searchOutput).split(/\r?\n/u).map((line) => line.trim()).filter((line) => /^HKEY_/iu.test(line));
    for (const key of keys) {
      let details = '';
      try { details = registryQuery(key, false); } catch { continue; }
      const displayName = registryValue(details, 'DisplayName');
      if (!/^PRISM H3 控制台(?:\s|$)/iu.test(displayName)) continue;
      const uninstall = registryValue(details, 'UninstallString');
      const displayIcon = registryValue(details, 'DisplayIcon');
      const uninstallExecutable = quotedOrBareExecutable(uninstall);
      const iconExecutable = quotedOrBareExecutable(displayIcon);
      for (const source of [uninstallExecutable, iconExecutable]) {
        if (!source || !isAbsolute(source)) continue;
        candidates.push(join(dirname(resolve(source)), H3_EXECUTABLE));
      }
    }
  }
  return uniqueAbsolute(candidates);
}

function queryRegistryKey(key, search) {
  const args = ['query', key];
  if (search) args.push('/s', '/f', 'PRISM H3 控制台', '/d');
  const bytes = execFileSync('reg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gbk').decode(bytes); }
}

function registryValue(output, name) {
  const match = String(output).match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'imu'));
  return match?.[1]?.trim() || '';
}

function quotedOrBareExecutable(value) {
  if (!value) return '';
  const quoted = value.match(/^"([^"]+\.exe)"/iu);
  if (quoted) return quoted[1];
  const bare = value.match(/^(.+?\.exe)(?:\s|,|$)/iu);
  return bare?.[1]?.trim() || '';
}

function firstValidH3Discovery(candidates) {
  for (const candidate of uniqueAbsolute(candidates)) {
    if (!isFile(candidate)) continue;
    try {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8'));
      if (manifest.schemaVersion === 1 && manifest.apiVersion === 1 && /^http:\/\/127\.0\.0\.1:\d+$/u.test(String(manifest.baseUrl || '')) && typeof manifest.token === 'string' && manifest.token.length >= 32 && Number.isInteger(manifest.pid)) {
        return { path: candidate, manifest };
      }
    } catch {
      // Continue to the next candidate; invalid files are never trusted.
    }
  }
  return null;
}

function readAceStepDiscovery(environment) {
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData) return null;
  const discoveryPath = join(localAppData, 'PRISM', 'ACE-Step', 'installation.json');
  if (!isFile(discoveryPath)) return null;
  try {
    const value = JSON.parse(readFileSync(discoveryPath, 'utf8'));
    if (value.schemaVersion !== 1 || value.product !== 'PRISM ACE-Step 1.5') return null;
    const projectRoot = typeof value.installDirectory === 'string' ? resolve(value.installDirectory) : '';
    const executable = typeof value.pythonExecutable === 'string' ? resolve(value.pythonExecutable) : '';
    if (!isDirectory(projectRoot) || !isFile(executable) || !executable.toLowerCase().startsWith(projectRoot.toLowerCase())) return null;
    return { projectRoot, executable };
  } catch {
    return null;
  }
}

function firstFile(candidates) {
  return uniqueAbsolute(candidates).find(isFile) || '';
}

function firstDirectory(candidates) {
  return uniqueAbsolute(candidates).find(isDirectory) || '';
}

function uniqueAbsolute(candidates) {
  const values = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim() || !isAbsolute(candidate)) continue;
    const normalized = resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
}

function executableOnPath(name, pathValue) {
  for (const entry of pathValue.split(';').map((value) => value.trim()).filter(Boolean)) {
    const candidate = resolve(entry, name);
    if (isFile(candidate)) return candidate;
  }
  return '';
}

function isFile(target) {
  try { return existsSync(target) && statSync(target).isFile(); } catch { return false; }
}

function isDirectory(target) {
  try { return existsSync(target) && statSync(target).isDirectory(); } catch { return false; }
}

function isFileAtLeast(target, minimumSize) {
  try { return isFile(target) && statSync(target).size >= minimumSize; } catch { return false; }
}

function requiredAceStepFiles() {
  return [
    ['checkpoints/acestep-v15-turbo/model.safetensors', 1_000_000_000],
    ['checkpoints/acestep-5Hz-lm-0.6B/model.safetensors', 500_000_000],
    ['checkpoints/Qwen3-Embedding-0.6B/model.safetensors', 500_000_000],
    ['checkpoints/vae/diffusion_pytorch_model.safetensors', 100_000_000],
  ];
}

function requiredRealEsrganModels() {
  return [
    'realesr-animevideov3-x2.param', 'realesr-animevideov3-x2.bin',
    'realesrgan-x4plus.param', 'realesrgan-x4plus.bin',
    'realesrgan-x4plus-anime.param', 'realesrgan-x4plus-anime.bin',
  ];
}

function validateH3Executable(target) {
  if (!target || !isAbsolute(target) || !isFile(target) || basename(target).toLowerCase() !== H3_EXECUTABLE.toLowerCase()) {
    throw new Error(`请选择 ${H3_EXECUTABLE}`);
  }
  return resolve(target);
}

function validateAceStepInstallation(target) {
  if (!target || !isAbsolute(target)) throw new Error('请选择 ACE-Step 1.5 安装目录');
  let projectRoot = resolve(target);
  if (isFile(projectRoot)) {
    const name = basename(projectRoot).toLowerCase();
    if (!['python.exe', 'acestep-api.exe'].includes(name)) throw new Error('请选择 ACE-Step 1.5 安装目录');
    projectRoot = resolve(dirname(projectRoot), '..', '..');
  }
  if (!isDirectory(projectRoot)) throw new Error('ACE-Step 安装目录不存在');
  const executable = firstFile([
    join(projectRoot, '.venv', 'Scripts', 'python.exe'),
    join(projectRoot, '.venv', 'Scripts', 'acestep-api.exe'),
  ]);
  if (!executable) throw new Error('ACE-Step Python 运行时不存在，请重新安装 ACE-Step 组件');
  for (const [relativePath, minimumSize] of requiredAceStepFiles()) {
    if (!isFileAtLeast(join(projectRoot, ...relativePath.split('/')), minimumSize)) throw new Error(`ACE-Step 模型文件缺失或异常：${relativePath}`);
  }
  return { executable, projectRoot };
}

module.exports = { discoverDesktopComponents, requiredRealEsrganModels, validateAceStepInstallation, validateH3Executable, windowsInstalledH3Candidates };
