import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Workspace.jsx', import.meta.url), 'utf8');

test('Workspace defines desktop panel width constraints around the canvas', () => {
  assert.match(source, /const RIGHT_PANEL_DEFAULT_WIDTH = 384;/);
  assert.match(source, /const RIGHT_PANEL_WIDE_WIDTH = 520;/);
  assert.match(source, /const RIGHT_PANEL_MIN_WIDTH = 360;/);
  assert.match(source, /const RIGHT_PANEL_MAX_WIDTH = 560;/);
  assert.match(source, /const CENTER_CANVAS_MIN_WIDTH = 760;/);
  assert.match(source, /localStorage\.getItem\(RIGHT_PANEL_WIDTH_STORAGE_KEY\)/);
});

test('Workspace exposes drag resizing and a wide panel mode for desktop use', () => {
  assert.match(source, /const handlePanelResizePointerDown = \(event\) =>/);
  assert.match(source, /window\.addEventListener\('pointermove', handlePointerMove\)/);
  assert.match(source, /window\.addEventListener\('pointerup', handlePointerUp\)/);
  assert.match(source, /aria-label="拖拽调整右侧面板宽度"/);
  assert.match(source, /aria-label="切换宽面板模式"/);
  assert.match(source, /setRightPanelWidth\(nextWidth\);/);
});

