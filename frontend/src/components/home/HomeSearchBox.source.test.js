import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./HomeSearchBox.jsx', import.meta.url), 'utf8');

test('HomeSearchBox constrains mobile text and controls to avoid horizontal overflow', () => {
  assert.match(source, /overflow-x-hidden/);
  assert.match(source, /break-words/);
  assert.match(source, /text-3xl/);
  assert.match(source, /min-w-0/);
});
