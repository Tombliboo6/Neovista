import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createProviderSettingsStore } from '../web/local-api.mjs';

const require = createRequire(import.meta.url);
const { CONTENT_SECURITY_POLICY, startDesktopServer } = require('../desktop/server.cjs');
const { discoverDesktopComponents, requiredRealEsrganModels, validateAceStepInstallation, validateH3Executable, windowsInstalledH3Candidates } = require('../desktop/components.cjs');

test('desktop server uses a random loopback port, secure cookie and same-origin API boundary', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-story-desktop-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtimeRoot = join(directory, 'runtime');
  const webRoot = join(runtimeRoot, 'web');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>PRISM Story Studio</title><div id="root"></div>', 'utf8');
  writeFileSync(join(runtimeRoot, 'local-api.mjs'), `export function createLocalApiRuntime(){return{handle(request,response){if(request.url==='/api/ping'){response.setHeader('content-type','application/json');response.end(JSON.stringify({ok:true}));return true}return false}}}`, 'utf8');

  const server = await startDesktopServer({ runtimeRoot, dataRoot: join(directory, 'data'), providerSettingsStorage: { load: () => null, save: () => {} } });
  context.after(() => server.close());
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.notEqual(server.port, 5173);

  const page = await fetch(server.origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  const cookie = page.headers.get('set-cookie');
  assert.match(cookie, /^prism_story_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\//u);

  const blocked = await fetch(`${server.origin}/api/ping`);
  assert.equal(blocked.status, 403);
  const accepted = await fetch(`${server.origin}/api/ping`, { headers: { cookie: cookie.split(';')[0], origin: server.origin } });
  assert.deepEqual(await accepted.json(), { ok: true });
  const crossOrigin = await fetch(`${server.origin}/api/ping`, { headers: { cookie: cookie.split(';')[0], origin: 'https://example.com' } });
  assert.equal(crossOrigin.status, 403);
});

test('desktop provider persistence stores complete configuration through the supplied encrypted-storage adapter', () => {
  let encryptedPayload = null;
  const first = createProviderSettingsStore({
    persistence: { load: () => null, save: (payload) => { encryptedPayload = structuredClone(payload); } },
  });
  first.configure({ kind: 'agent', baseUrl: 'https://api.example.com/v1', model: 'story-agent', apiKey: 'secret-key-1234' });
  assert.equal(encryptedPayload.providers[0].apiKey, 'secret-key-1234');

  const restored = createProviderSettingsStore({ persistence: { load: () => encryptedPayload, save: () => {} } });
  const status = restored.status().find((item) => item.kind === 'agent');
  assert.equal(status.kind, 'agent');
  assert.equal(status.configured, true);
  assert.equal(status.baseUrl, 'https://api.example.com/v1');
  assert.equal(status.model, 'story-agent');
  assert.equal(status.keyHint, '••••1234');
  assert.equal(status.profiles.length, 1);
  assert.equal(status.profiles[0].id, status.activeProfileId);
  assert.equal(status.profiles[0].active, true);
});

test('desktop release metadata uses fixed dependency versions and the final product identity', () => {
  const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const webPackage = JSON.parse(readFileSync(new URL('../web/package.json', import.meta.url), 'utf8'));
  const desktopBuildScript = readFileSync(new URL('../scripts/build-desktop.mjs', import.meta.url), 'utf8');
  assert.equal(rootPackage.build.productName, 'PRISM Story Studio');
  assert.equal(rootPackage.build.appId, 'com.prism.storystudio');
  assert.equal(rootPackage.build.nsis.deleteAppDataOnUninstall, false);
  for (const version of [...Object.values(rootPackage.dependencies), ...Object.values(rootPackage.devDependencies), ...Object.values(webPackage.dependencies), ...Object.values(webPackage.devDependencies)]) {
    assert.doesNotMatch(version, /latest|\*|\^|~/u);
  }
  assert.match(desktopBuildScript, /createRequire as __prismCreateRequire/u, 'the ESM desktop bundle must support dependencies that dynamically load Node built-ins');
});

test('desktop component discovery resolves a custom H3 installation and bundled small tools', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-story-components-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const h3Root = join(directory, 'custom-h3');
  const h3Executable = join(h3Root, 'PRISM H3 控制台.exe');
  const h3Discovery = join(h3Root, 'integration', 'integration-bridge.json');
  const toolsRoot = join(directory, 'tools');
  const realRoot = join(toolsRoot, 'real-esrgan');
  const modelsRoot = join(realRoot, 'models');
  const aceRoot = join(directory, 'ace-step');
  const aceExecutable = join(aceRoot, '.venv', 'Scripts', 'python.exe');
  mkdirSync(join(h3Root, 'integration'), { recursive: true });
  mkdirSync(modelsRoot, { recursive: true });
  mkdirSync(dirname(aceExecutable), { recursive: true });
  for (const filePath of [h3Executable, join(toolsRoot, 'ffmpeg.exe'), join(toolsRoot, 'ffprobe.exe'), join(realRoot, 'realesrgan-ncnn-vulkan.exe'), aceExecutable]) writeFileSync(filePath, 'fixture');
  for (const name of requiredRealEsrganModels()) writeFileSync(join(modelsRoot, name), 'model');
  for (const [relativePath, size] of [['checkpoints/acestep-v15-turbo/model.safetensors', 1_000_000_000], ['checkpoints/acestep-5Hz-lm-0.6B/model.safetensors', 500_000_000], ['checkpoints/Qwen3-Embedding-0.6B/model.safetensors', 500_000_000], ['checkpoints/vae/diffusion_pytorch_model.safetensors', 100_000_000]]) {
    const filePath = join(aceRoot, ...relativePath.split('/'));
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'fixture');
    truncateSync(filePath, size);
  }
  writeFileSync(h3Discovery, JSON.stringify({ schemaVersion: 1, apiVersion: 1, baseUrl: 'http://127.0.0.1:54321', token: 'x'.repeat(64), pid: 1234, prismVersion: '0.4.47', updatedAt: new Date().toISOString() }));

  const result = discoverDesktopComponents({ toolsRoot, settings: { h3Executable, aceStepExecutable: aceExecutable, aceStepProjectRoot: aceRoot }, environment: { PATH: '' } });
  assert.equal(result.resolved.h3DiscoveryPath, h3Discovery);
  assert.equal(result.components.find((item) => item.id === 'prism-h3').status, 'ready');
  assert.equal(result.components.find((item) => item.id === 'ffmpeg').status, 'ready');
  assert.equal(result.components.find((item) => item.id === 'real-esrgan').status, 'ready');
  assert.equal(result.components.find((item) => item.id === 'ace-step').status, 'ready');
});

test('desktop component discovery never trusts an invalid H3 bridge manifest', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-story-h3-invalid-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const h3Executable = join(directory, 'PRISM H3 控制台.exe');
  const invalidDiscovery = join(directory, 'integration', 'integration-bridge.json');
  mkdirSync(join(directory, 'integration'), { recursive: true });
  writeFileSync(h3Executable, 'fixture');
  writeFileSync(invalidDiscovery, JSON.stringify({ baseUrl: 'http://example.com', token: 'short' }));
  const result = discoverDesktopComponents({ toolsRoot: join(directory, 'tools'), settings: { h3Executable }, environment: { PATH: '' }, h3ExecutableCandidates: [] });
  assert.equal(result.resolved.h3DiscoveryPath, invalidDiscovery);
  assert.equal(result.components.find((item) => item.id === 'prism-h3').status, 'installed');
  assert.equal(validateH3Executable(h3Executable), h3Executable);
});

test('desktop component discovery can resolve a customer H3 install from Windows uninstall metadata', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-story-h3-registry-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, 'Customer H3', 'PRISM H3 控制台.exe');
  const uninstaller = join(dirname(executable), 'Uninstall PRISM H3 控制台.exe');
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, 'fixture');
  const key = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\fixture-h3';
  const registryQuery = (target, search) => search
    ? `${key}\n`
    : `${key}\n    DisplayName    REG_SZ    PRISM H3 控制台 0.4.47\n    UninstallString    REG_SZ    "${uninstaller}" /currentuser\n`;
  assert.deepEqual(windowsInstalledH3Candidates(registryQuery), [executable]);
  const result = discoverDesktopComponents({
    toolsRoot: join(directory, 'tools'),
    settings: {},
    environment: { PATH: '' },
    h3ExecutableCandidates: [],
    registryQuery,
  });
  assert.equal(result.resolved.h3Executable, executable);
  assert.equal(result.resolved.h3DiscoveryPath, join(dirname(executable), 'integration', 'integration-bridge.json'));
  assert.equal(result.components.find((item) => item.id === 'prism-h3').status, 'installed');
});

test('ACE-Step manual selection validates an installation directory and resolves its Python runtime', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-story-ace-select-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, '.venv', 'Scripts', 'python.exe');
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, 'fixture');
  for (const [relativePath, size] of [['checkpoints/acestep-v15-turbo/model.safetensors', 1_000_000_000], ['checkpoints/acestep-5Hz-lm-0.6B/model.safetensors', 500_000_000], ['checkpoints/Qwen3-Embedding-0.6B/model.safetensors', 500_000_000], ['checkpoints/vae/diffusion_pytorch_model.safetensors', 100_000_000]]) {
    const filePath = join(directory, ...relativePath.split('/'));
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, 'fixture');
    truncateSync(filePath, size);
  }
  assert.deepEqual(validateAceStepInstallation(directory), { executable, projectRoot: directory });
});
