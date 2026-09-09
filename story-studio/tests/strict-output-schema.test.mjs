import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeStrictOutputSchema, strictOutputSchemaIssues } from '../src/providers/strict-output-schema.ts';
import { OpenAIResponsesAgentProvider } from '../src/providers/openai-responses.ts';
import { buildStoryboardBoardPlanRequest } from '../src/storyboards/storyboard-board-generation.ts';
import { buildStoryboardBoardBatchRequest } from '../src/storyboards/storyboard-board-batch.ts';
import { buildSegmentVideoPromptRequest, buildEpisodeVideoPromptBatchRequest } from '../src/videos/video-prompt-generation.ts';
import { safeIdeaAgentMessage } from '../web/local-api.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const fixtureSource = readFileSync(new URL('./video-prompt-generation.test.mjs', import.meta.url), 'utf8');
const { input: videoInput } = new Function(`${fixtureSource.slice(fixtureSource.indexOf('const segment ='), fixtureSource.indexOf("test('"))}; return { input };`)();
const boardInput = { segment: videoInput.segment, styleName: videoInput.styleName, characterAnchor: '', sceneAnchor: '' };

test('single and batch storyboard requests satisfy strict schema rules for every panel count', () => {
  for (const panelCount of [3, 4, 6, 9]) {
    const input = { ...boardInput, panelCount };
    for (const request of [buildStoryboardBoardPlanRequest(input), buildStoryboardBoardBatchRequest([input]), buildStoryboardBoardBatchRequest([input, { ...input, segment: { ...input.segment, segmentKey: 'SEG002' } }])]) {
      assert.deepEqual(strictOutputSchemaIssues(normalizeStrictOutputSchema(request.outputSchema)), [], request.schemaName);
    }
  }
});

test('single and batch video requests include every timeline field in the strict contract', () => {
  for (const request of [buildSegmentVideoPromptRequest(videoInput), buildEpisodeVideoPromptBatchRequest([videoInput]), buildEpisodeVideoPromptBatchRequest([videoInput, { ...videoInput, segment: { ...videoInput.segment, segmentKey: 'SEG002' } }])]) {
    assert.deepEqual(strictOutputSchemaIssues(normalizeStrictOutputSchema(request.outputSchema)), [], request.schemaName);
  }
});

test('preflight rejects the reported missing timeline fields before making any paid request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network must not be reached'); };
  const request = buildStoryboardBoardBatchRequest([{ ...boardInput, panelCount: 3 }]);
  const panel = request.outputSchema.properties.items.items.properties.plan.properties.panels.items;
  panel.required = panel.required.filter(name => !['startSec', 'endSec', 'shotGroupKey', 'transitionFromPrevious', 'cutTrigger'].includes(name));
  const provider = new OpenAIResponsesAgentProvider({ apiKey: 'test-secret', baseUrl: 'https://fixture.invalid/v1', model: 'gpt-5.6-sol', transientRetryCount: 2 });
  await assert.rejects(provider.generate(request), error => {
    assert.equal(error.code, 'invalid_local_json_schema');
    assert.equal(error.diagnostics.attemptCount, 0);
    assert.equal(error.diagnostics.retryCount, 0);
    assert.deepEqual(error.diagnostics.targetKeys, [videoInput.segment.segmentKey]);
    assert.match(error.diagnostics.schemaIssues[0], /panels.items.required: 缺少 startSec, endSec, shotGroupKey, transitionFromPrevious, cutTrigger/);
    assert.match(safeIdeaAgentMessage(error), /尚未向文字服务发送请求/);
    assert.match(safeIdeaAgentMessage(error), /startSec/);
    return true;
  });
  assert.equal(calls, 0);
});

test('strict inspection follows nullable branches and definitions without treating property names as schema keywords', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['uniqueItems', 'optional'], properties: {
    uniqueItems: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    optional: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/nested' }] },
  }, $defs: { nested: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } } } };
  const before = structuredClone(schema), normalized = normalizeStrictOutputSchema(schema);
  assert.deepEqual(schema, before);
  assert.ok(normalized.properties.uniqueItems);
  assert.equal(normalized.properties.uniqueItems.uniqueItems, undefined);
  assert.deepEqual(strictOutputSchemaIssues(normalized), []);
  normalized.$defs.nested.required = [];
  assert.match(strictOutputSchemaIssues(normalized)[0], /\$defs.nested.required: 缺少 value/);
});

test('strict inspection reports undeclared required fields, open objects, missing items and empty enums', () => {
  const issues = strictOutputSchemaIssues({ type: 'object', properties: {
    list: { type: 'array' }, choice: { type: 'string', enum: [] },
  }, required: ['list', 'choice', 'ghost'] });
  assert.ok(issues.some(issue => issue.includes('ghost')));
  assert.ok(issues.some(issue => issue.includes('additionalProperties')));
  assert.ok(issues.some(issue => issue.includes('有效 items')));
  assert.ok(issues.some(issue => issue.includes('enum 不能为空')));
});
