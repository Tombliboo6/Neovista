import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storeSource = readFileSync(new URL('./useAppStore.js', import.meta.url), 'utf8');

test('generateImage initializes generation request state before calling fetch', () => {
  const generateImageBlockMatch = storeSource.match(
    /generateImage:\s*async[\s\S]*?const response = await fetch\(`\$\{API_BASE\}\/v1\/generate`/,
  );

  assert.ok(generateImageBlockMatch, 'expected to find generateImage fetch block');

  const generateImageBlock = generateImageBlockMatch[0];
  assert.match(
    generateImageBlock,
    /const generationRequest = createGenerationRequestState\(\);/,
  );
  assert.match(
    generateImageBlock,
    /const clearRequestState = clearGenerationRequestState\(\);/,
  );
});
