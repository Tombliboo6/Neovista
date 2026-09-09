import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettingsStore } from '../local-api.mjs';
test('bare origin resolves and persists /v1 through read-only metadata', async () => {
 const urls = [];
 const options = { filePath: join(mkdtempSync(join(tmpdir(), 'prism-resolution-')), 'settings.json'), fetchImpl: async (url, init) => {
 urls.push(String(url)); assert.equal(init.method ?? 'GET', 'GET');
 return String(url).includes('/v1/') ? Response.json({ id: 'fixture' }) : new Response('<html>home</html>');
 } };
 const store = createProviderSettingsStore(options);
 store.configure({ kind: 'image', apiKey: 'fixture-key-1234', baseUrl: 'https://fixture.invalid', model: 'fixture' });
 const health = await store.test('image');
 assert.equal(health.status, 'ok');
 assert.equal(health.details.resolvedBaseUrl, 'https://fixture.invalid/v1');
 assert.equal(createProviderSettingsStore(options).status().find(p => p.kind === 'image').baseUrl, 'https://fixture.invalid/v1');
 assert.equal(urls.length, 3);
});
for (const [base, code, payload, expectedCalls, expectedStatus] of [
 ['https://fixture.invalid', 200, { id: 'fixture' }, 1, 'ok'],
 ['https://fixture.invalid', 401, {}, 1, 'auth_error'],
 ['https://fixture.invalid', 429, {}, 1, 'rate_limited'],
 ['https://fixture.invalid/custom', 404, {}, 2, 'backend_offline'],
]) test(`metadata ${code} at ${base} reports ${expectedStatus}`, async () => {
 const urls = [];
 const store = createProviderSettingsStore({ fetchImpl: async url => { urls.push(String(url)); return Response.json(payload, { status: code }); } });
 store.configure({ kind: 'agent', apiKey: 'fixture-key-1234', baseUrl: base, model: 'fixture' });
 assert.equal((await store.test('agent')).status, expectedStatus);
 assert.equal(urls.length, expectedCalls);
 assert.equal(store.status().find(p => p.kind === 'agent').baseUrl, base);
});
