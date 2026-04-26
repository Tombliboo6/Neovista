import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AdminShell.jsx', import.meta.url), 'utf8');

test('AdminShell reads adminToken and renders Dashboard / Templates nav items', () => {
  assert.match(source, /localStorage\.getItem\('adminToken'\)/);
  assert.match(source, />Dashboard</);
  assert.match(source, />Templates</);
});

test('AdminShell renders nested admin content via Outlet', () => {
  assert.match(source, /<Outlet \/>/);
});
