import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSceneViewRequest, compileSceneViewPrompt, SceneViewValidationError } from '../src/scenes/scene-view-generation.ts';

const mainAsset = {
  id: 'scene-main-l01', version: 1, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', approval: 'approved',
  kind: 'scene', name: '侏罗纪原始丛林', description: '场景主资产', promptAnchor: '已批准场景主图',
  mediaPaths: ['runtime-data/generated-images/scene-l01.png'], sourceEntityIds: ['web-approved-script', 'web-style-3d-fantasy']
};
const input = { taskId: 'scene-view-l01-v1', mainAsset, referenceEditMode: 'verified', fixedLandmarks: ['左侧巨树', '中央溪流', '右侧岩壁'], spatialLayout: '溪流由前景通向背景，巨树和岩壁分列两侧' };

test('scene view prompt is a fixed four-panel Chinese asset template', () => {
  const prompt = compileSceneViewPrompt(input);
  for (const heading of ['基础设定', '氛围、画质与摄影风格', '画面内容与布局', '摄影机与成像', '负面词']) assert.equal(prompt.split(heading).length - 1, 1);
  assert.match(prompt, /严格2列×2行四宫格/);
  assert.match(prompt, /反打视角/);
  assert.match(prompt, /左侧巨树、中央溪流、右侧岩壁/);
  assert.doesNotMatch(prompt, /声音总则/);
});

test('scene view request binds one available scene main image without approval', () => {
  const request = buildSceneViewRequest(input);
  assert.deepEqual(request.referenceMediaPaths, mainAsset.mediaPaths);
  assert.deepEqual(request.referenceAssetVersions, { 'scene-main-l01': 1 });
  assert.equal(request.width, 1536);
  assert.equal(request.height, 1024);
  assert.equal(request.count, 1);
  assert.equal(request.quality, 'high');
});

test('scene view request rejects non-scene parents or a missing main image', () => {
  assert.throws(() => buildSceneViewRequest({ ...input, mainAsset: { ...mainAsset, kind: 'character' } }), /require a scene main asset/);
  assert.throws(() => buildSceneViewRequest({ ...input, mainAsset: { ...mainAsset, mediaPaths: [] } }), (error) => error instanceof SceneViewValidationError && error.code === 'invalid_reference_count');
});
