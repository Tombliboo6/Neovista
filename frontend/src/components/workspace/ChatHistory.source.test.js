import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatHistory.jsx', import.meta.url), 'utf8');

test('ChatHistory renders uploaded user images together with the same user message', () => {
  assert.match(source, /msg\.imageDatas\?\.length > 0/);
  assert.match(source, /msg\.imageDatas\.map\(\(imageSrc,\s*imageIndex\)/);
  assert.match(source, /<img[\s\S]*src=\{imageSrc\}[\s\S]*alt=""/);
  assert.match(source, /<div className="max-w-\[85%\] space-y-2">/);
  assert.match(source, /className="max-w-\[85%\] rounded-xl px-3 py-2 text-xs text-white\/80"/);
});
