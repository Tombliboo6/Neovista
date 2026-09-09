import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/PromptMaster.tsx', import.meta.url), 'utf8');
const localApi = readFileSync(new URL('../local-api.mjs', import.meta.url), 'utf8');
const desktopMain = readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8');
const desktopServer = readFileSync(new URL('../../desktop/server.cjs', import.meta.url), 'utf8');

test('prompt master has an independent route without replacing the Studio app', () => {
  assert.match(main, /pathname === "\/prompt-master"/);
  assert.match(main, /import\("\.\/PromptMaster"\)/);
  assert.match(main, /import\("\.\/App"\)/);
});

test('prompt director only calls its own text APIs plus read-only Studio context', () => {
  const endpoints = [...new Set([...source.matchAll(/fetch\("([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(endpoints, ['/api/creative-session', '/api/prompt-master/generate', '/api/prompt-master/provider-settings/configure', '/api/prompt-master/provider-settings/status', '/api/prompt-master/provider-settings/test']);
  assert.doesNotMatch(source, /\/api\/(?:h3\/generations|free-canvas\/generate-(?:image|video|audio)|postproduction\/music)/);
  assert.doesNotMatch(source, /\/api\/provider-settings/);
});

test('prompt director exposes two formats, Agent revision and local versions', () => {
  assert.match(source, /图片提示词/);
  assert.match(source, /视频提示词/);
  assert.match(source, /文字提示词/);
  assert.match(source, /音乐提示词/);
  assert.match(source, /故事梗概/);
  assert.match(source, /短剧本/);
  assert.match(source, /分镜脚本/);
  assert.match(source, /中文五段式/);
  assert.match(source, /H3标准英文格式/);
  assert.match(source, /mediaType/);
  assert.match(source, /Agent修改/);
  assert.match(source, /function changeFormat/);
  assert.match(source, /if \(result\.trim\(\)\) archiveResult\(result\)/);
  assert.match(source, /成品提示词/);
  assert.match(source, /保存版本/);
});

test('prompt director uses a separate provider store and desktop encrypted file', () => {
  assert.match(localApi, /const promptMasterStore = createProviderSettingsStore/);
  assert.match(localApi, /prompt-director-provider-settings\.json/);
  assert.match(localApi, /promptMasterStore\.runPromptDirector/);
  assert.match(desktopMain, /prompt-director-provider-settings\.bin/);
  assert.match(desktopServer, /promptMasterProviderSettingsStorage/);
});
