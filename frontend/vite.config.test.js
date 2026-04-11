import test from 'node:test';
import assert from 'node:assert/strict';

import viteConfig from './vite.config.js';

test('dev server proxies static assets to the backend', () => {
  assert.equal(
    viteConfig.server?.proxy?.['/static']?.target,
    'http://localhost:8000'
  );
});
