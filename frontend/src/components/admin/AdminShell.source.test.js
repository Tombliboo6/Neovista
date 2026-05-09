import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AdminShell.jsx', import.meta.url), 'utf8');

test('AdminShell reads adminToken and renders Dashboard / Templates / Redemption Codes nav items', () => {
  assert.match(source, /localStorage\.getItem\('adminToken'\)/);
  assert.match(source, /label: 'Dashboard'/);
  assert.match(source, /label: 'Templates'/);
  assert.match(source, /label: '兑换码'/);
  assert.match(source, /to: '\/admin\/redemption-codes'/);
});

test('AdminShell renders nested admin content via Outlet', () => {
  assert.match(source, /<Outlet \/>/);
});
