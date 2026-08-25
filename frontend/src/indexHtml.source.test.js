import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('index.html carries production SEO metadata and localized language', () => {
  assert.match(source, /<html lang="zh-CN">/);
  assert.match(source, /<meta name="description" content="NeoVista 是面向建筑、景观与规划设计师的 AIGC 智能分析图工作流平台/);
  assert.match(source, /<link rel="canonical" href="https:\/\/neovista\.cn\/" \/>/);
  assert.match(source, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  assert.doesNotMatch(source, /\/vite\.svg/);
});
