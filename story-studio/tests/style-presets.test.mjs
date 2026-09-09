import assert from 'node:assert/strict';
import test from 'node:test';

import { getStylePreset, normalizeStylePresetId, STYLE_PRESETS } from '../src/styles/presets.ts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

test('the style library contains twelve pure visual styles across six media categories', () => {
  assert.deepEqual(
    STYLE_PRESETS.map((preset) => preset.name),
    [
      '真人电影写实',
      '影视级写实CG',
      '风格化3D动画',
      '2D赛璐璐动画',
      '2D国漫厚涂',
      '条漫／网漫风',
      '商业手绘插画',
      '水彩绘本',
      '国风水墨',
      '工笔重彩',
      '古典油画',
      '黑白漫画'
    ]
  );
  assert.equal(STYLE_PRESETS.length, 12);
  assert.equal(new Set(STYLE_PRESETS.map((preset) => preset.id)).size, 12);
  assert.equal(new Set(STYLE_PRESETS.map((preset) => preset.previewMediaPath)).size, 12);
  assert.equal(STYLE_PRESETS.every((preset) => existsSync(resolve(preset.previewMediaPath))), true);
  assert.deepEqual(new Set(STYLE_PRESETS.map((preset) => preset.category)), new Set(['真人', '3D', '2D', '插画', '传统绘画', '漫画']));
  assert.doesNotMatch(STYLE_PRESETS.map((preset) => `${preset.name} ${preset.description} ${preset.styleAnchor}`).join('\n'), /校园|悬疑|宫廷|仙侠|都市|家庭/u);
});

test('the realistic CG preset describes medium and rendering rather than story subject', () => {
  const preset = getStylePreset('3d-fantasy');
  assert.equal(preset.name, '影视级写实CG');
  assert.match(preset.description, /写实三维影视渲染/u);
  assert.match(preset.styleAnchor, /高精度三维建模/u);
  assert.match(preset.styleAnchor, /物理材质/u);
});

test('the stylized 3D preset contains a production-grade visual anchor', () => {
  const preset = getStylePreset('ancient-3d-drama');
  assert.equal(preset.name, '风格化3D动画');
  assert.match(preset.description, /3D漫剧/u);
  assert.match(preset.styleAnchor, /艺术概括/u);
  assert.match(preset.styleAnchor, /三维建模/u);
  assert.match(preset.styleAnchor, /统一的造型语言/u);
});

test('removed draft style ids migrate to the closest current drawing medium', () => {
  assert.equal(normalizeStylePresetId('modern-social-realism'), 'ancient-live-action');
  assert.equal(getStylePreset('modern-social-realism').name, '真人电影写实');
  assert.equal(normalizeStylePresetId('cyber-scifi-cinema'), '3d-fantasy');
});
