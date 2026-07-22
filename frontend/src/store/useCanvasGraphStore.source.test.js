import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useCanvasGraphStore.js', import.meta.url), 'utf8');

test('canvas graph state persists separately from model and API state', () => {
  assert.match(source, /neovista\.canvas\.graph\.v1/);
  assert.match(source, /partialize: \(\{ nodes, edges, viewport, viewMode \}\)/);
  assert.match(source, /version: 2/);
  assert.match(source, /migrateCanvasNode/);
  assert.match(source, /nodes: nodes\.map\(resetCompiledShotStatuses\)/);
  assert.match(source, /generationDraft: null/);
  assert.doesNotMatch(source, /partialize: \([^)]*generationDraft/);
  assert.doesNotMatch(source, /fetch\(/);
});

test('canvas graph state supports history, connections, and result deduplication', () => {
  assert.match(source, /connect: \(connection\) =>/);
  assert.match(source, /checkpoint: \(\) =>/);
  assert.match(source, /undo: \(\) =>/);
  assert.match(source, /redo: \(\) =>/);
  assert.match(source, /node\.data\?\.url === url/);
});

test('canvas graph state includes the narrative video starter workflow', () => {
  assert.match(source, /createStoryStarter: \(position/);
  assert.match(source, /buildCanvasNode\('story'/);
  assert.match(source, /buildCanvasNode\('character'/);
  assert.match(source, /buildCanvasNode\('scene'/);
  assert.match(source, /buildCanvasNode\('continuity'/);
  assert.match(source, /buildCanvasNode\('storyboard'/);
  assert.match(source, /STORY_STARTER_SHOTS/);
  assert.match(source, /targetHandle: 'continuity'/);
  assert.match(source, /appearanceNotes/);
  assert.match(source, /wardrobeNotes/);
  assert.match(source, /referenceAssets/);
  assert.match(source, /selectedRules/);
  assert.match(source, /status === 'compiled'/);
});
