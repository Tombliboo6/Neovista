import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyFreeCanvasImport, pastedMediaUrl } from '../src/free-canvas-imports.ts';

test('free canvas import recognizes text, image, video and audio by MIME or extension', () => {
  assert.equal(classifyFreeCanvasImport('notes.md', ''), 'text');
  assert.equal(classifyFreeCanvasImport('frame.bin', 'image/png'), 'image');
  assert.equal(classifyFreeCanvasImport('scene.MP4', ''), 'video');
  assert.equal(classifyFreeCanvasImport('theme.wav', 'application/octet-stream'), 'audio');
  assert.equal(classifyFreeCanvasImport('archive.zip', 'application/zip'), null);
});

test('pasted media URLs become media nodes while ordinary text stays text', () => {
  assert.deepEqual(pastedMediaUrl('https://cdn.example.test/demo/video.mp4?token=1'), {
    kind: 'video', url: 'https://cdn.example.test/demo/video.mp4?token=1', title: 'video.mp4',
  });
  assert.deepEqual(pastedMediaUrl('/api/free-canvas/imports/example.wav'), {
    kind: 'audio', url: '/api/free-canvas/imports/example.wav', title: 'example.wav',
  });
  assert.equal(pastedMediaUrl('一段普通文本'), null);
});
