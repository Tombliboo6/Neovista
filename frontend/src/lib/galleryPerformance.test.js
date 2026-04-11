import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImageLoadingStrategy,
  getNextVisibleCount,
  getPrimaryTemplateImage,
} from './galleryPerformance.js';

test('getPrimaryTemplateImage prefers the last gallery image and tolerates empty input', () => {
  assert.equal(getPrimaryTemplateImage([]), null);
  assert.equal(getPrimaryTemplateImage(['a.png', 'b.png', 'c.png']), 'c.png');
});

test('getNextVisibleCount increments in batches without overshooting the total', () => {
  assert.equal(getNextVisibleCount(12, 40, 12), 24);
  assert.equal(getNextVisibleCount(36, 40, 12), 40);
  assert.equal(getNextVisibleCount(40, 40, 12), 40);
});

test('getImageLoadingStrategy keeps only the first few cards eager', () => {
  assert.deepEqual(getImageLoadingStrategy(0, 4), {
    loading: 'eager',
    fetchPriority: 'high',
  });
  assert.deepEqual(getImageLoadingStrategy(3, 4), {
    loading: 'eager',
    fetchPriority: 'high',
  });
  assert.deepEqual(getImageLoadingStrategy(4, 4), {
    loading: 'lazy',
    fetchPriority: 'auto',
  });
});
