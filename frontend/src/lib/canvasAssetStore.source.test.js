import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./canvasAssetStore.js', import.meta.url), 'utf8');

test('canvas references are compressed and persisted outside the graph JSON', () => {
  assert.match(source, /neovista-canvas-assets/);
  assert.match(source, /indexedDB/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /saveCanvasAsset/);
  assert.match(source, /resolveCanvasAssetDataUrls/);
  assert.match(source, /missingAssetIds/);
});
