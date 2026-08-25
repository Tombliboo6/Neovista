import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const componentUrl = new URL('./AdminRedemptionCodesPage.jsx', import.meta.url);
const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : '';

test('AdminRedemptionCodesPage component exists', () => {
  assert.ok(existsSync(componentUrl));
});

test('AdminRedemptionCodesPage posts generation requests with bearer and admin tokens', () => {
  assert.match(source, /localStorage\.getItem\('adminToken'\)/);
  assert.match(source, /localStorage\.getItem\('token'\)/);
  assert.match(source, /fetch\('\/api\/v1\/billing\/admin\/redemption-codes'/);
  assert.match(source, /'Authorization': `Bearer \$\{userToken\}`/);
  assert.match(source, /'x-admin-token': adminToken/);
  assert.match(source, /JSON\.stringify\(\{/);
  assert.match(source, /credits:/);
  assert.match(source, /count:/);
  assert.match(source, /batch:/);
  assert.match(source, /expires_days:/);
});

test('AdminRedemptionCodesPage clears stale admin credentials on 401 and 403', () => {
  assert.match(source, /response\.status === 401/);
  assert.match(source, /response\.status === 403/);
  assert.match(source, /localStorage\.removeItem\('token'\)/);
  assert.ok((source.match(/localStorage\.removeItem\('adminToken'\)/g) || []).length >= 3);
  assert.match(source, /登录状态已失效，请重新登录后再试/);
  assert.match(source, /管理员权限验证失败，请重新确认管理员账号和令牌/);
});

test('AdminRedemptionCodesPage exposes amount shortcuts and generated codes', () => {
  assert.match(source, /const amountPresets = \[5, 10, 20, 50\];/);
  assert.match(source, /\{preset\} 元/);
  assert.match(source, /生成兑换码/);
  assert.match(source, /generatedCodes\.map/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /const MAX_CREDITS_PER_CODE = 100_000;/);
  assert.match(source, /const MAX_BATCH_COUNT = 100;/);
});
