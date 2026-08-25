import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./TopNav.jsx', import.meta.url), 'utf8');

test('TopNav exposes an explicit professional canvas entry', () => {
  assert.match(source, /import \{ Link \} from 'react-router-dom';/);
  assert.match(source, /data-testid="professional-canvas-entry"/);
  assert.match(source, /aria-label="进入专业画布"/);
  assert.match(source, /to="\/workspace"/);
  assert.match(source, />专业画布<\/span>/);
});
