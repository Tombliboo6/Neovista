import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RightPanel.jsx', import.meta.url), 'utf8');

test('RightPanel exposes story-specific production context', () => {
  assert.match(source, /useCanvasGraphStore/);
  assert.match(source, /剧情制作面板/);
  assert.match(source, /项目资产/);
  assert.match(source, /characterCount/);
  assert.match(source, /sceneCount/);
  assert.match(source, /shotCount/);
  assert.match(source, /generationDraft/);
  assert.match(source, /镜头请求预览/);
  assert.match(source, /查看最终提示词/);
  assert.match(source, /校验通过/);
  assert.match(source, /校验失败/);
  assert.match(source, /<ChatHistory storyMode=\{storyMode\}/);
});
