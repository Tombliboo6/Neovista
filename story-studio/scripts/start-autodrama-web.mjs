import { appendFileSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const APP_URL = 'http://127.0.0.1:5173/';
const STATUS_URL = `${APP_URL}api/provider-settings/status`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDirectory = join(repoRoot, 'runtime-data', 'logs');
const logPath = join(logDirectory, 'web-dev.log');
const shouldOpenBrowser = !process.argv.includes('--no-open');

async function main() {
  let service = await getServiceStatus();
  let started = false;

  if (!service) {
    startBackgroundService();
    started = true;
    service = await waitForService(20_000);
  }

  if (!service) {
    throw new Error(`本机网页未能在 20 秒内启动。请查看日志：${logPath}`);
  }

  if (shouldOpenBrowser) openDefaultBrowser(APP_URL);

  console.log(started ? 'PRISM AutoDrama 网页已在后台启动。' : 'PRISM AutoDrama 网页已经在运行。');
  const restored = service.filter((provider) => provider?.configured).map((provider) => provider.kind);
  console.log(restored.length > 0
    ? `已从本机私密存储恢复 Provider：${restored.join('、')}。`
    : '没有发现可自动恢复的完整 API 配置；仍可在网页设置中填写。');
  console.log(`入口：${APP_URL}`);
}

async function getServiceStatus() {
  try {
    const response = await fetch(STATUS_URL, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return null;
    const body = await response.json();
    const providers = Array.isArray(body) ? body : body.providers;
    if (!Array.isArray(providers)) return null;
    const kinds = new Set(providers.map((item) => item?.kind));
    return kinds.has('agent') && kinds.has('h3') ? providers : null;
  } catch {
    return null;
  }
}

function startBackgroundService() {
  mkdirSync(logDirectory, { recursive: true });
  appendFileSync(logPath, `\n[${new Date().toISOString()}] launcher starting stable web:serve\n`, 'utf8');
  const logFd = openSync(logPath, 'a');
  const command = process.env.ComSpec || 'cmd.exe';
  const child = spawn(command, ['/d', '/s', '/c', 'npm run web:serve'], {
    cwd: repoRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
}

async function waitForService(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getServiceStatus();
    if (status) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  return null;
}

function openDefaultBrowser(url) {
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
    'Start-Process -FilePath $args[0]',
    url,
  ], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
