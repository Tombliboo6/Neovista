const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } = require('electron');
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { dirname, isAbsolute, join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { startDesktopServer } = require('./server.cjs');
const { discoverDesktopComponents, validateAceStepInstallation, validateH3Executable } = require('./components.cjs');

const PRODUCT_NAME = 'PRISM Story Studio';
let mainWindow = null;
let desktopServer = null;
let desktopOrigin = '';
let shuttingDown = false;
let activeDataRoot = '';
let desktopComponents = { resolved: {}, components: [] };

app.setName(PRODUCT_NAME);
if (process.env.PRISM_STORY_STUDIO_USER_DATA_ROOT && isAbsolute(process.env.PRISM_STORY_STUDIO_USER_DATA_ROOT)) {
  app.setPath('userData', resolve(process.env.PRISM_STORY_STUDIO_USER_DATA_ROOT));
}
app.setAppUserModelId('com.prism.storystudio');

function logPath() {
  return join(app.getPath('logs'), 'desktop-main.log');
}

function desktopLog(message) {
  try {
    mkdirSync(dirname(logPath()), { recursive: true });
    writeFileSync(logPath(), `${new Date().toISOString()} ${message}\n`, { encoding: 'utf8', flag: 'a' });
  } catch {
    // Logging must not block startup.
  }
}

function desktopSettingsPath() {
  return join(app.getPath('userData'), 'desktop-settings.json');
}

function encryptedProviderPath(filename = 'provider-settings.bin') {
  return join(app.getPath('userData'), filename);
}

function readDesktopSettings() {
  try { return JSON.parse(readFileSync(desktopSettingsPath(), 'utf8')); } catch { return {}; }
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function updateDesktopSettings(patch) {
  const current = readDesktopSettings();
  writeJsonAtomically(desktopSettingsPath(), { ...current, ...patch, schemaVersion: 1, updatedAt: new Date().toISOString() });
}

function resolveDataRoot() {
  const configured = process.env.PRISM_STORY_STUDIO_DATA_ROOT || readDesktopSettings().dataRoot;
  if (configured && isAbsolute(configured)) return resolve(configured);
  return join(app.getPath('videos'), PRODUCT_NAME);
}

function providerSettingsStorage(filename = 'provider-settings.bin') {
  return {
    load() {
      const filePath = encryptedProviderPath(filename);
      if (!existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(readFileSync(filePath)));
    },
    save(payload) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用，无法保存 API 配置。');
      const filePath = encryptedProviderPath(filename);
      mkdirSync(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(payload)));
      renameSync(temporary, filePath);
    },
  };
}

function runtimeRoot() {
  return app.isPackaged ? join(process.resourcesPath, 'desktop-dist') : resolve(__dirname, '..', 'desktop-dist');
}

function configureExternalRuntimes() {
  const bundledTools = app.isPackaged ? join(process.resourcesPath, 'tools') : resolve(__dirname, '..', 'desktop-resources', 'tools');
  if (existsSync(bundledTools)) process.env.PATH = `${bundledTools};${process.env.PATH || ''}`;
  desktopComponents = discoverDesktopComponents({ toolsRoot: bundledTools, settings: readDesktopSettings() });
  const resolvedComponents = desktopComponents.resolved;
  const executableDirectories = [resolvedComponents.ffmpegExecutable, resolvedComponents.ffprobeExecutable].filter(Boolean).map(dirname);
  if (executableDirectories.length) process.env.PATH = `${[...new Set(executableDirectories)].join(';')};${process.env.PATH || ''}`;
  if (resolvedComponents.h3Executable) process.env.PRISM_H3_CONSOLE_EXE = resolvedComponents.h3Executable;
  if (resolvedComponents.h3DiscoveryPath) process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH = resolvedComponents.h3DiscoveryPath;
  if (resolvedComponents.ffmpegExecutable) process.env.FFMPEG_EXECUTABLE = resolvedComponents.ffmpegExecutable;
  if (resolvedComponents.ffprobeExecutable) process.env.FFPROBE_EXECUTABLE = resolvedComponents.ffprobeExecutable;
  if (resolvedComponents.ffmpegExecutable && dirname(resolvedComponents.ffmpegExecutable).toLowerCase() === bundledTools.toLowerCase()) {
    process.env.PRISM_FFMPEG_VIDEO_ENCODER = 'h264_mf';
  }
  if (resolvedComponents.realEsrganExecutable) process.env.REALESRGAN_EXECUTABLE = resolvedComponents.realEsrganExecutable;
  if (resolvedComponents.aceStepExecutable) process.env.ACESTEP_API_EXECUTABLE = resolvedComponents.aceStepExecutable;
  if (resolvedComponents.aceStepProjectRoot) process.env.ACESTEP_PROJECT_ROOT = resolvedComponents.aceStepProjectRoot;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: '#08080a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (desktopOrigin && !url.startsWith(desktopOrigin)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(desktopOrigin);
}

async function runAcceptanceCapture() {
  const outputRoot = process.env.PRISM_STORY_STUDIO_ACCEPTANCE_ROOT;
  if (!outputRoot || !isAbsolute(outputRoot) || !mainWindow) return;
  const resolvedOutputRoot = resolve(outputRoot);
  mkdirSync(resolvedOutputRoot, { recursive: true });
  mainWindow.show();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  const shellState = await mainWindow.webContents.executeJavaScript(`({
    title: document.title,
    bodyText: document.body.innerText,
    gearCount: document.querySelectorAll('.settings-gear-icon').length,
    prismLogoCount: document.querySelectorAll('.brand-mark img[src*="prism-mark"]').length,
    productNameVisible: document.body.innerText.toUpperCase().includes('PRISM STORY STUDIO')
  })`);
  writeJsonAtomically(join(resolvedOutputRoot, 'shell-state.json'), shellState);
  try {
    writeFileSync(join(resolvedOutputRoot, 'shell.png'), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    writeFileSync(join(resolvedOutputRoot, 'shell-capture-error.txt'), `${String(error)}\n`, 'utf8');
  }
  await mainWindow.webContents.executeJavaScript(`document.querySelector('button[aria-label="打开设置"]')?.click()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  const settingsState = await mainWindow.webContents.executeJavaScript(`({
    dialogVisible: Boolean(document.querySelector('[role="dialog"][aria-label="设置"]')),
    bodyText: document.body.innerText,
    sections: [...document.querySelectorAll('.settings-nav button strong')].map((item) => item.textContent),
    gearBounds: (() => { const gear = document.querySelector('.settings-gear-icon'); if (!gear) return null; const box = gear.getBoundingClientRect(); return { width: box.width, height: box.height, centerX: box.left + box.width / 2, centerY: box.top + box.height / 2 }; })()
  })`);
  writeJsonAtomically(join(resolvedOutputRoot, 'settings-state.json'), settingsState);
  try {
    writeFileSync(join(resolvedOutputRoot, 'settings.png'), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    writeFileSync(join(resolvedOutputRoot, 'settings-capture-error.txt'), `${String(error)}\n`, 'utf8');
  }
  await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-nav button')].find((button) => button.innerText.includes('文件与存储'))?.click()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const storageState = await mainWindow.webContents.executeJavaScript(`({
    projectLibraryVisible: Boolean(document.querySelector('.desktop-library-card')),
    projectLibraryPath: document.querySelector('.desktop-library-card strong')?.textContent || '',
    actions: [...document.querySelectorAll('.desktop-library-card button')].map((button) => button.textContent)
  })`);
  writeJsonAtomically(join(resolvedOutputRoot, 'storage-state.json'), storageState);
  try {
    writeFileSync(join(resolvedOutputRoot, 'storage.png'), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    writeFileSync(join(resolvedOutputRoot, 'storage-capture-error.txt'), `${String(error)}\n`, 'utf8');
  }
  await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-nav button')].find((button) => button.innerText.includes('系统与诊断'))?.click()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  const componentState = await mainWindow.webContents.executeJavaScript(`({
    cards: [...document.querySelectorAll('.component-summary section')].map((card) => ({
      label: card.querySelector('strong')?.textContent || '',
      message: card.querySelector('small')?.textContent || '',
      path: card.querySelector('code')?.textContent || '',
      status: card.querySelector('b')?.textContent || ''
    })),
    locateH3Visible: [...document.querySelectorAll('.component-summary button')].some((button) => button.textContent.includes('定位H3')),
    locateAceVisible: [...document.querySelectorAll('.component-summary button')].some((button) => button.textContent.includes('定位ACE')),
  })`);
  writeJsonAtomically(join(resolvedOutputRoot, 'components-state.json'), componentState);
  try {
    writeFileSync(join(resolvedOutputRoot, 'components.png'), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    writeFileSync(join(resolvedOutputRoot, 'components-capture-error.txt'), `${String(error)}\n`, 'utf8');
  }
  desktopLog(`acceptance capture written to ${resolvedOutputRoot}`);
}

function registerDesktopIpc() {
  ipcMain.handle('desktop:get-info', () => ({
    productName: PRODUCT_NAME,
    version: app.getVersion(),
    dataRoot: activeDataRoot,
    logs: app.getPath('logs'),
    packaged: app.isPackaged,
    components: desktopComponents.components,
  }));
  ipcMain.handle('desktop:choose-project-library', async () => {
    const selection = await dialog.showOpenDialog(mainWindow, { title: '选择项目库目录', defaultPath: activeDataRoot, properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true };
    const dataRoot = resolve(selection.filePaths[0]);
    updateDesktopSettings({ dataRoot });
    return { canceled: false, dataRoot, restartRequired: dataRoot !== activeDataRoot };
  });
  ipcMain.handle('desktop:open-project-library', async () => {
    mkdirSync(activeDataRoot, { recursive: true });
    const error = await shell.openPath(activeDataRoot);
    return { ok: !error, error };
  });
  ipcMain.handle('desktop:choose-h3-installation', async () => {
    const current = desktopComponents.resolved.h3Executable || undefined;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择 PRISM H3 控制台',
      defaultPath: current ? dirname(current) : undefined,
      properties: ['openFile'],
      filters: [{ name: 'PRISM H3 控制台', extensions: ['exe'] }],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true };
    const executable = validateH3Executable(selection.filePaths[0]);
    updateDesktopSettings({ h3Executable: executable, h3DiscoveryPath: join(dirname(executable), 'integration', 'integration-bridge.json') });
    configureExternalRuntimes();
    desktopLog(`PRISM H3 location activated without restart: ${executable}`);
    return { canceled: false, executable, restartRequired: false, components: desktopComponents.components };
  });
  ipcMain.handle('desktop:choose-ace-step-installation', async () => {
    const current = desktopComponents.resolved.aceStepProjectRoot || undefined;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择 ACE-Step 1.5 安装目录',
      defaultPath: current,
      properties: ['openDirectory'],
    });
    if (selection.canceled || selection.filePaths.length !== 1) return { canceled: true };
    const selected = validateAceStepInstallation(selection.filePaths[0]);
    updateDesktopSettings({ aceStepExecutable: selected.executable, aceStepProjectRoot: selected.projectRoot });
    return { canceled: false, ...selected, restartRequired: selected.executable !== desktopComponents.resolved.aceStepExecutable };
  });
}

async function bootstrap() {
  activeDataRoot = resolveDataRoot();
  mkdirSync(activeDataRoot, { recursive: true });
  process.env.PRISM_STORY_STUDIO_VERSION = app.getVersion();
  configureExternalRuntimes();
  desktopServer = await startDesktopServer({
    runtimeRoot: runtimeRoot(),
    dataRoot: activeDataRoot,
    providerSettingsStorage: providerSettingsStorage(),
    promptMasterProviderSettingsStorage: providerSettingsStorage('prompt-director-provider-settings.bin'),
    log: desktopLog,
  });
  desktopOrigin = desktopServer.origin;
  await createWindow();
  await runAcceptanceCapture();
  desktopLog(`ready version=${app.getVersion()} packaged=${app.isPackaged} dataRoot=${activeDataRoot}`);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await desktopServer?.close(); } catch (error) { desktopLog(`server close failed: ${String(error)}`); }
  desktopServer = null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    registerDesktopIpc();
    try {
      await bootstrap();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      desktopLog(`bootstrap failed: ${error instanceof Error ? error.stack || message : message}`);
      await dialog.showMessageBox({ type: 'error', title: `${PRODUCT_NAME} 启动失败`, message, detail: `日志：${logPath()}` });
      app.quit();
    }
  });
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
