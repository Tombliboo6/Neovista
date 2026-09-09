import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GENERATION_STYLE_ID,
  applyGenerationPresetToPrompt,
  evolveGenerationPreset,
  imageRequestSizeForAspectRatio,
  isGenerationStyleCompatible,
  normalizeGenerationPreset,
} from '../src/presets/generation-preset.ts';

test('legacy project settings migrate to a versioned generation preset', () => {
  const preset = normalizeGenerationPreset(undefined, { styleId: '2d-anime', aspectRatio: '9:16' }, '2026-08-30T00:00:00.000Z');
  assert.deepEqual(preset, {
    id: 'project-generation-preset',
    version: 1,
    styleId: '2d-anime',
    aspectRatio: '9:16',
    imageResolution: '1k',
    createdAt: '2026-08-30T00:00:00.000Z',
  });
  assert.equal(normalizeGenerationPreset(undefined).styleId, DEFAULT_GENERATION_STYLE_ID);
});

test('preset changes create a new immutable version while no-op selection keeps identity', () => {
  const current = normalizeGenerationPreset(undefined, {}, '2026-08-30T00:00:00.000Z');
  assert.equal(evolveGenerationPreset(current, { aspectRatio: '16:9' }), current);
  const next = evolveGenerationPreset(current, { aspectRatio: '3:4' }, '2026-08-30T00:01:00.000Z');
  assert.equal(next.version, current.version + 1);
  assert.equal(next.styleId, current.styleId);
  assert.equal(next.aspectRatio, '3:4');
  assert.equal(next.imageResolution, '1k');
  assert.equal(current.aspectRatio, '16:9');
  const highResolution = evolveGenerationPreset(next, { imageResolution: '4k' }, '2026-08-30T00:02:00.000Z');
  assert.equal(highResolution.version, next.version + 1);
  assert.equal(highResolution.imageResolution, '4k');
});

test('visual references remain compatible across ratio changes but not style changes', () => {
  const reference = normalizeGenerationPreset({ styleId: '2d-anime', aspectRatio: '16:9' });
  assert.equal(isGenerationStyleCompatible(reference, { styleId: '2d-anime' }), true);
  assert.equal(isGenerationStyleCompatible(reference, { styleId: 'ancient-live-action' }), false);
});

test('image request sizes stay within supported provider dimensions for every ratio', () => {
  assert.deepEqual(imageRequestSizeForAspectRatio('16:9'), { width: 1536, height: 1024 });
  assert.deepEqual(imageRequestSizeForAspectRatio('4:3'), { width: 1536, height: 1024 });
  assert.deepEqual(imageRequestSizeForAspectRatio('1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(imageRequestSizeForAspectRatio('9:16'), { width: 1024, height: 1536 });
  assert.deepEqual(imageRequestSizeForAspectRatio('3:4'), { width: 1024, height: 1536 });
  assert.deepEqual(imageRequestSizeForAspectRatio('16:9', '2k'), { width: 2048, height: 1152 });
  assert.deepEqual(imageRequestSizeForAspectRatio('9:16', '4k'), { width: 2160, height: 3840 });
  assert.deepEqual(imageRequestSizeForAspectRatio('1:1', '4k'), { width: 2880, height: 2880 });
  assert.deepEqual(imageRequestSizeForAspectRatio('4:3', '4k'), { width: 3264, height: 2448 });
  assert.deepEqual(imageRequestSizeForAspectRatio('3:2', '4k'), { width: 3504, height: 2336 });
});

test('prompt snapshot carries the selected target ratio exactly once', () => {
  const preset = normalizeGenerationPreset({ aspectRatio: '9:16' });
  const once = applyGenerationPresetToPrompt('人物走入室内。', preset);
  const twice = applyGenerationPresetToPrompt(once, preset);
  assert.match(once, /目标画面比例：9:16/u);
  assert.equal(twice, once);
});
