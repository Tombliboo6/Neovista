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
  assert.match(source, /setSelectedModel\(compiledRequest\.request\.model\)/);
  assert.match(source, /setVideoDurationSeconds/);
  assert.match(source, /const hasReferenceVideo = Boolean\(seedanceReferenceVideo\?\.video_url\)/);
  assert.match(source, /requestedFrameMode = hasReferenceVideo/);
  assert.match(source, /referenceVideoSignature: createReferenceVideoSignature\(seedanceReferenceVideo\)/);
  assert.match(source, /createImmutableGenerationRequest/);
  assert.match(source, /编译到 Seedance/);
  assert.match(source, /status: 'compiled'/);
});

test('story nodes import UTF-8 Markdown and generation nodes fail closed', () => {
  assert.match(source, /readStoryScriptFile/);
  assert.match(source, /STORY_FILE_ACCEPT/);
  assert.match(source, /总提示词超过 4000 字会明确阻止发送/);
  assert.match(source, /if \(!prompt\)/);
  assert.match(source, /setChatInput\(prompt\)/);
  assert.match(source, /setUploadedImages\(referenceUrls\)/);
  assert.match(source, /加载到右侧生成器/);
});
