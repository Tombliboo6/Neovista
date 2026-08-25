import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./LeftNav.jsx', import.meta.url), 'utf8');

test('LeftNav icon-only controls expose accessible labels', () => {
  assert.match(source, /aria-label="首页"/);
  assert.match(source, /aria-label="上传图片"/);
  assert.match(source, /aria-label=\{isWorkflow \? '导出工作流 JSON' : '下载 PNG'\}/);
  assert.match(source, /aria-label="清空画布"/);
});
