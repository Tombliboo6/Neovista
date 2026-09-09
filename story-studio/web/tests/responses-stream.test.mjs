import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettingsStore, preserveAgentFailureDiagnostic, safeIdeaAgentMessage } from '../local-api.mjs';
import { OpenAIResponsesProviderError } from '../../src/providers/openai-responses.ts';

test('model health rejects HTTP 200 web pages, unrelated JSON and invalid list fallbacks', async () => {
  for (const fallback of [false, true]) for (const body of ['<html>home</html>', '{}', '{"data":[{}]}']) {
    const calls = [];
    const store = createProviderSettingsStore({ fetchImpl: async url => {
      calls.push(url);
      return fallback && calls.length === 1 ? new Response('', { status: 404 }) : new Response(body);
    } });
    store.configure({ kind: 'agent', apiKey: 'fixture-secret', baseUrl: 'https://fixture.invalid', model: 'test-model' });
    const health = await store.test('agent');
    assert.notEqual(health.status, 'ok'); assert.match(health.message, /有效模型数据/);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(url => url.includes('/models')));
  }
});

test('model health distinguishes absent model from matching read-only metadata', async () => {
  for (const [data, status] of [[[], 'model_missing'], [[{ id: 'other' }], 'model_missing'], [[{ id: 'test-model' }], 'ok']]) {
    const store = createProviderSettingsStore({ fetchImpl: async () => Response.json({ data }) });
    store.configure({ kind: 'agent', apiKey: 'fixture-secret', baseUrl: 'https://fixture.invalid/v1', model: 'test-model' });
    const health = await store.test('agent'); assert.equal(health.status, status);
    if (status === 'ok') assert.match(health.message, /实际生成权限尚未验证/);
  }
});

test('stream failure diagnostics persist with request ID and partial text independently of project results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-stream-diagnostic-'));
  const error = new OpenAIResponsesProviderError('Stream ended', { code: 'stream_incomplete', diagnostics: { externalTaskId: 'resp-fixture', operation: 'adapt-novel-to-series-plan', rawOutputText: '部分正文', stream: { receivedBytes: 100, eventCount: 2 } } });
  const { diagnosticId } = preserveAgentFailureDiagnostic(error, directory);
  const saved = JSON.parse(readFileSync(join(directory, `${diagnosticId}.json`), 'utf8'));
  assert.deepEqual(saved.diagnostics, error.diagnostics); assert.equal(saved.code, 'stream_incomplete');
  assert.equal(readdirSync(directory).length, 1); assert.match(safeIdeaAgentMessage(error), /未收到完整完成标记/);
  assert.deepEqual(preserveAgentFailureDiagnostic(new Error('ordinary'), directory), {});
});

test('diagnostic storage failure is explicit and does not replace the provider failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-stream-diagnostic-failure-'));
  const file = join(directory, 'file'); writeFileSync(file, 'occupied');
  const error = new OpenAIResponsesProviderError('Stream ended', { code: 'stream_incomplete', diagnostics: { externalTaskId: 'resp-fixture' } });
  assert.match(preserveAgentFailureDiagnostic(error, file).diagnosticSaveError, /未能保存/);
});
