import test from 'node:test';
import assert from 'node:assert/strict';

import { BASE_RESOLUTION_PRICING, calculateGenerationCost, getResolutionPricing } from './generationPricing.js';

test('nano banana 2 pricing matches billing rules', () => {
  assert.deepEqual(BASE_RESOLUTION_PRICING, {
    '1K': 30,
    '2K': 50,
    '4K': 90,
  });
});

test('unsupported image models never invent a price surcharge', () => {
  assert.deepEqual(getResolutionPricing('nano-banana-pro'), {
    '1K': 30,
    '2K': 50,
    '4K': 90,
  });
});

test('legacy estimator is single-image only while live prices come from capabilities', () => {
  assert.equal(calculateGenerationCost('2K', 3, 'nano-banana-2'), 50);
  assert.equal(calculateGenerationCost('4K', 2, 'nano-banana-pro'), 90);
});
