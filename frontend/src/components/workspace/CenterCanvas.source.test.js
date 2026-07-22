import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CenterCanvas.jsx', import.meta.url), 'utf8');

test('CenterCanvas uses the infinite workflow canvas while retaining Fabric as an artboard mode', () => {
  assert.match(source, /import InfiniteCanvas from '.\/canvas\/InfiniteCanvas';/);
  assert.match(source, /if \(viewMode === 'workflow'\)/);
  assert.match(source, /return <InfiniteCanvas \/>;/);
  assert.match(source, /<FabricCanvas \/>/);
  assert.match(source, /返回工作流/);
});
