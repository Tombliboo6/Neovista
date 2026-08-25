import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STORY_FILE_BYTES,
  readStoryScriptFile,
} from './storyScriptImport.js';

const makeFile = (name, bytes) => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

test('imports UTF-8 Markdown, removes BOM, and normalizes line endings', async () => {
  const bytes = new TextEncoder().encode('\uFEFF# 第一幕\r\n\r\n鸭鸭出发。');
  const result = await readStoryScriptFile(makeFile('剧情.MD', bytes));

  assert.equal(result.text, '# 第一幕\n\n鸭鸭出发。');
  assert.equal(result.name, '剧情.MD');
  assert.equal(result.characterCount, result.text.length);
});

test('rejects empty, oversized, unsupported, and invalid UTF-8 scripts', async () => {
  await assert.rejects(
    readStoryScriptFile(makeFile('empty.md', new Uint8Array())),
    /文件为空/,
  );
  const oversized = makeFile('large.md', new Uint8Array([1]));
  oversized.size = MAX_STORY_FILE_BYTES + 1;
  await assert.rejects(readStoryScriptFile(oversized), /超过 512KB/);
  await assert.rejects(
    readStoryScriptFile(makeFile('script.pdf', new Uint8Array([1]))),
    /仅支持/,
  );
  await assert.rejects(
    readStoryScriptFile(makeFile('bad.txt', new Uint8Array([0xc3, 0x28]))),
    /UTF-8/,
  );
});

test('rejects whitespace-only scripts after decoding', async () => {
  const bytes = new TextEncoder().encode(' \n\t ');
  await assert.rejects(readStoryScriptFile(makeFile('blank.markdown', bytes)), /没有可用文字/);
});
