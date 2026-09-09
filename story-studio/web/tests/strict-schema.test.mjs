import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettingsStore } from '../local-api.mjs';
import { OpenAIResponsesProviderError } from '../../src/providers/openai-responses.ts';

test('per-segment schema failures retain original diagnostics and never invoke the image provider', async () => {
  const source = readFileSync(new URL('./local-api.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("test('storyboard boards bind every prepared prop that the director marks visible'");
  const fixture = source.slice(source.indexOf('  const generatedImageDirectory', start), source.indexOf('  const store =', start));
  const { baseInput, segment, generatedImageDirectory } = new Function('mkdtempSync', 'join', 'tmpdir', 'writeFileSync', `${fixture}; return { baseInput, segment, generatedImageDirectory };`)(mkdtempSync, join, tmpdir, writeFileSync);
  const directory = mkdtempSync(join(tmpdir(), 'prism-schema-diagnostics-'));
  let textCalls = 0, imageCalls = 0;
  const store = createProviderSettingsStore({
    generatedImageDirectory, agentDiagnosticDirectory: directory,
    agentProviderFactory: () => ({ id: 'fixture', async generate(request) {
      textCalls++;
      throw new OpenAIResponsesProviderError("Invalid schema: required is missing 'startSec'", {
        status: 400, code: 'invalid_json_schema', diagnostics: { operation: request.operation, requestedModel: 'gpt-5.6-sol', externalTaskId: 'req-schema-fixture', targetKeys: ['SEG001'] },
      });
    } }),
    imageProviderFactory: () => { imageCalls++; throw new Error('image generation must not start'); },
  });
  store.configure({ kind: 'agent', apiKey: 'test-secret', baseUrl: 'https://fixture.invalid/v1', model: 'gpt-5.6-sol' });
  const before = structuredClone(baseInput);
  const result = await store.runStoryboardBoardPlans({ ...baseInput, segments: [segment] });
  assert.equal(textCalls, 1); assert.equal(imageCalls, 0);
  assert.deepEqual(baseInput, before);
  assert.equal(result.validationErrors.length, 1);
  assert.match(result.error, /规划未完成/);
  assert.doesNotMatch(result.error, /缺少真实镜头内容/);
  const failure = result.validationErrors[0];
  assert.match(failure.message, /startSec/);
  assert.match(failure.message, /req-schema-fixture/);
  assert.equal(failure.message.match(/现有内容已保留/g)?.length, 1);
  assert.ok(failure.diagnosticId);
  const saved = JSON.parse(readFileSync(join(directory, `${failure.diagnosticId}.json`), 'utf8'));
  assert.equal(saved.code, 'invalid_json_schema');
  assert.equal(saved.status, 400);
  assert.match(saved.message, /startSec/);
  assert.equal(saved.diagnostics.externalTaskId, 'req-schema-fixture');
  assert.equal(readdirSync(directory).length, 1);
});
