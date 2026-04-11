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

test('nano banana pro adds 30 credits per image at each resolution', () => {
  assert.deepEqual(getResolutionPricing('nano-banana-pro'), {
    '1K': 60,
    '2K': 80,
    '4K': 120,
  });
});

test('generation cost scales linearly with image count for each model', () => {
  assert.equal(calculateGenerationCost('2K', 3, 'nano-banana-2'), 150);
  assert.equal(calculateGenerationCost('4K', 2, 'nano-banana-pro'), 240);
});
