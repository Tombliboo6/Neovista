import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectClipboardImageFiles,
  collectSupportedImageFiles,
  mergeReferenceImages,
  normalizeReferenceImages,
  resolveReferenceImages,
} from './referenceImages.js';

test('normalizeReferenceImages accepts either a single image or an ordered list', () => {
  assert.deepEqual(normalizeReferenceImages(null), []);
  assert.deepEqual(normalizeReferenceImages('data:image/png;base64,AAA'), ['data:image/png;base64,AAA']);
  assert.deepEqual(
    normalizeReferenceImages(['image-a', '', 'image-b']),
    ['image-a', 'image-b'],
  );
});

test('resolveReferenceImages prefers uploaded images over a fallback canvas image', () => {
  assert.deepEqual(
    resolveReferenceImages(['image-a', 'image-b'], 'canvas-image'),
    ['image-a', 'image-b'],
  );
  assert.deepEqual(resolveReferenceImages([], 'canvas-image'), ['canvas-image']);
});

test('mergeReferenceImages appends new images across multiple pastes/uploads without duplicates', () => {
  assert.deepEqual(
    mergeReferenceImages(['image-a'], ['image-b', 'image-a', '', null]),
    ['image-a', 'image-b'],
  );
  assert.deepEqual(
    mergeReferenceImages([], ['image-a', 'image-b']),
    ['image-a', 'image-b'],
  );
});

test('collectClipboardImageFiles extracts every pasted image file', () => {
  const png = { name: 'a.png' };
  const jpg = { name: 'b.jpg' };
  const files = collectClipboardImageFiles([
    { kind: 'file', type: 'image/png', getAsFile: () => png },
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
    { kind: 'file', type: 'image/jpeg', getAsFile: () => jpg },
  ]);

  assert.deepEqual(files, [png, jpg]);
});

test('collectClipboardImageFiles also reads clipboardData.files and deduplicates overlaps', () => {
  const png = { name: 'a.png', type: 'image/png', size: 100, lastModified: 1 };
  const jpg = { name: 'b.jpg', type: 'image/jpeg', size: 200, lastModified: 2 };
  const files = collectClipboardImageFiles({
    items: [
      { kind: 'file', type: 'image/png', getAsFile: () => png },
    ],
    files: [
      png,
      jpg,
      { name: 'note.txt', type: 'text/plain', size: 1, lastModified: 3 },
    ],
  });

  assert.deepEqual(files, [png, jpg]);
});

test('collectSupportedImageFiles keeps supported uploads and drops unsupported ones', () => {
  const files = collectSupportedImageFiles([
    { name: 'a.png', type: 'image/png' },
    { name: 'b.gif', type: 'image/gif' },
    { name: 'c.webp', type: 'image/webp' },
  ]);

  assert.deepEqual(files, [
    { name: 'a.png', type: 'image/png' },
    { name: 'c.webp', type: 'image/webp' },
  ]);
});
