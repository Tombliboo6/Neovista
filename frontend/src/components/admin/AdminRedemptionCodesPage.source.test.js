import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const componentUrl = new URL('./AdminRedemptionCodesPage.jsx', import.meta.url);
const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';

test('AdminRedemptionCodesPage component exists', () => {
  assert.ok(existsSync(componentUrl));
});

test('AdminRedemptionCodesPage posts generation requests with the admin token', () => {
  assert.match(source, /localStorage\.getItem\('adminToken'\)/);
  assert.match(source, /fetch\('\/api\/v1\/billing\/admin\/redemption-codes'/);
  assert.match(source, /'x-admin-token': adminToken/);
  assert.match(source, /JSON\.stringify\(\{/);
  assert.match(source, /credits:/);
  assert.match(source, /count:/);
  assert.match(source, /batch:/);
  assert.match(source, /expires_days:/);
});

test('AdminRedemptionCodesPage exposes amount shortcuts and generated codes', () => {
  assert.match(source, /const amountPresets = \[5, 10, 20, 50\];/);
  assert.match(source, /\{preset\} 元/);
  assert.match(source, /生成兑换码/);
  assert.match(source, /generatedCodes\.map/);
  assert.match(source, /navigator\.clipboard\.writeText/);
});
