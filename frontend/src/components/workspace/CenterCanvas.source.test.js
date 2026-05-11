import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CenterCanvas.jsx', import.meta.url), 'utf8');

test('CenterCanvas exports through safe canvas helper instead of raw toDataURL', () => {
  assert.match(source, /import \{ safeCanvasToDataUrl \} from '..\/..\/lib\/canvasExport\.js';/);
  assert.match(source, /const dataUrl = safeCanvasToDataUrl\(canvas,\s*'image\/png'\);/);
  assert.doesNotMatch(source, /canvas\.toDataURL\('image\/png'\)/);
});
