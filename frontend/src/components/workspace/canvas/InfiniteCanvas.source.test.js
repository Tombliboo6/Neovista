import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InfiniteCanvas.jsx', import.meta.url), 'utf8');

test('InfiniteCanvas exposes the core node-canvas interactions', () => {
  assert.match(source, /ReactFlowProvider/);
  assert.match(source, /<MiniMap/);
  assert.match(source, /onDoubleClickCapture=\{handlePaneDoubleClick\}/);
  assert.match(source, /classList\?\.contains\('react-flow__pane'\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /onDrop=\{handleDrop\}/);
  assert.match(source, /selectionKeyCode=\{\['Meta', 'Control'\]\}/);
  assert.match(source, /snapToGrid/);
});

test('InfiniteCanvas imports existing generation results as media nodes', () => {
  assert.match(source, /workspaceChatMessages/);
  assert.match(source, /message\.imageUrl/);
  assert.match(source, /message\.videoUrl/);
  assert.match(source, /addAssetNode\(\{/);
});

test('InfiniteCanvas keeps Fabric as a separate artboard mode', () => {
  assert.match(source, /onOpenArtboard=\{\(\) => setViewMode\('artboard'\)\}/);
});

test('InfiniteCanvas exposes the narrative-video canvas workflow', () => {
  assert.match(source, /story: StoryNode/);
  assert.match(source, /character: CharacterNode/);
  assert.match(source, /scene: SceneNode/);
  assert.match(source, /continuity: ContinuityNode/);
  assert.match(source, /storyboard: StoryboardNode/);
  assert.match(source, /createStoryStarter/);
  assert.match(source, /剧情视频模板/);
  assert.match(source, /targetNode\.type === 'storyboard'/);
});
