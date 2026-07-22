import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CanvasNodes.jsx', import.meta.url), 'utf8');

test('narrative canvas exposes editable story, character, scene, and continuity nodes', () => {
  assert.match(source, /export function StoryNode/);
  assert.match(source, /export function CharacterNode/);
  assert.match(source, /export function SceneNode/);
  assert.match(source, /export function ContinuityNode/);
  assert.doesNotMatch(source, /交给 Agent 拆解/);
  assert.match(source, /ReferenceAssetPicker/);
  assert.match(source, /saveCanvasAsset/);
  assert.match(source, /参与镜头约束/);
  assert.match(source, /selectedRules/);
});

test('storyboard compiles connected constraints and real references for Seedance', () => {
  assert.match(source, /export function StoryboardNode/);
  assert.match(source, /shot\.shotSize/);
  assert.match(source, /shot\.camera/);
  assert.match(source, /shot\.duration/);
  assert.match(source, /activeShot\.axis/);
  assert.match(source, /compileShotGenerationDraft/);
  assert.match(source, /resolveCanvasAssetDataUrls/);
  assert.match(source, /setUploadedImages\(resolved\.dataUrls\)/);
  assert.match(source, /setSelectedModel\('seedance-2\.0'\)/);
  assert.match(source, /setVideoDurationSeconds/);
  assert.match(source, /编译到 Seedance/);
  assert.match(source, /status: 'compiled'/);
});
