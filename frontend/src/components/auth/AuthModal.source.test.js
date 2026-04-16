import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AuthModal.jsx', import.meta.url), 'utf8');

test('AuthModal renders contextual guidance for blocked model actions', () => {
  assert.match(source, /const\s*\{\s*setToken,\s*setUser,\s*refreshBilling,\s*authModalContext,\s*setAuthModalContext\s*\}\s*=\s*useAppStore\(\);/);
  assert.match(source, /当前操作需要登录/);
  assert.match(source, /authModalContext\?\.message/);
  assert.match(source, /登录后可继续当前操作/);
});
