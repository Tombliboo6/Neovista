import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveApiUrl, resolveAssetUrl } from '../src/lib/url.js';

test('resolveApiUrl uses the provided API base for relative endpoints', () => {
  assert.equal(resolveApiUrl('/v1/templates', { apiBase: '/api' }), '/api/v1/templates');
  assert.equal(resolveApiUrl('v1/templates', { apiBase: '/api' }), '/api/v1/templates');
});

test('resolveApiUrl does not duplicate /api when callers include it', () => {
  assert.equal(resolveApiUrl('/api/v1/templates', { apiBase: '/api' }), '/api/v1/templates');
});

test('resolveAssetUrl keeps same-origin asset paths relative in production', () => {
  assert.equal(resolveAssetUrl('/static/template.png', { assetBase: '' }), '/static/template.png');
});

test('resolveAssetUrl preserves absolute asset URLs', () => {
  assert.equal(
    resolveAssetUrl('https://cdn.example.com/image.png', { assetBase: '' }),
    'https://cdn.example.com/image.png'
  );
});
