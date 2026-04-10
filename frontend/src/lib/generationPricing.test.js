import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateGenerationCost, RESOLUTION_PRICING } from './generationPricing.js';

test('resolution pricing matches billing rules', () => {
  assert.deepEqual(RESOLUTION_PRICING, {
    '1K': 30,
    '2K': 50,
    '4K': 90,
  });
});

test('generation cost scales linearly with image count', () => {
  assert.equal(calculateGenerationCost('2K', 3), 150);
  assert.equal(calculateGenerationCost('4K', 2), 180);
});
