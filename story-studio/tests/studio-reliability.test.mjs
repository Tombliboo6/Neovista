import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { RequestScheduler, scheduledAgent } from '../src/providers/request-scheduler.ts';
import { productionContext, productionCheckpoint } from '../src/workers/production-context.ts';
import { createProductionJobStore } from '../web/production-jobs.mjs';
import { applyProductionResult, mergeByStableKey, productionSource } from '../web/src/production-state.ts';
import { generateStoryboardPromptsBySegment, generateStoryboardPromptsWithRepair, buildStoryboardSegmentPlan } from '../src/storyboards/storyboard-prompt-generation.ts';
import { OpenAIResponsesAgentProvider } from '../src/providers/openai-responses.ts';
import { boundedOutputBudget, returnedModelAllowed } from '../src/providers/model-capabilities.ts';
import { createCreativeSessionStore, requireSegmentApprovalForRoute, buildWebH3GenerationRequest, executeProductionJob } from '../web/local-api.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const completed = output => ({ output, providerId: 'fixture', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 });
const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
const request = { operation: 'fixture', schemaName: 'fixture', instructions: 'Return JSON', input: {}, outputSchema: schema, maxOutputTokens: 60000 };
const fixtureSource = readFileSync(new URL('./storyboard-prompt.test.mjs', import.meta.url), 'utf8');
const fixture = new Function('buildStoryboardSegmentPlan', `${fixtureSource.slice(fixtureSource.indexOf('const scene ='), fixtureSource.indexOf("test('default storyboard"))}; return { script, styleSelection, assets, validSegments };`)(buildStoryboardSegmentPlan);

test('two independent entries and their repairs share a two-slot provider pool', async () => {
  const scheduler = new RequestScheduler(); let active = 0, peak = 0, calls = 0;
  const provider = { id: 'fixture', async health() {}, async generate() { calls++; active++; peak = Math.max(peak, active); await delay(3); active--; return completed({ ok: true }); } };
  const first = scheduledAgent(provider, scheduler), second = scheduledAgent(provider, scheduler);
  await Promise.all(Array.from({ length: 12 }, async (_, index) => { await (index % 2 ? first : second).generate(request); await second.generate({ ...request, operation: 'repair' }); }));
  assert.equal(calls, 24); assert.equal(peak, 2);
});

test('a 429 delays queued work and never retries the failed call', async () => {
  const scheduler = new RequestScheduler(); scheduler.configure({ textConcurrency: 1 });
  let calls = 0;
  await assert.rejects(scheduler.run('text', async () => { calls++; throw Object.assign(new Error('limited'), { status: 429, diagnostics: { retryAfterMs: 1200 } }); }));
  await delay(1);
  assert.ok(scheduler.status().lanes.text.cooldownUntil > Date.now()); assert.equal(calls, 1);
});

test('production UI sends twelve video segments as one persistent job', async () => {
  const source = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  async function generateVideoPrompts('), end = source.indexOf('  async function repairVideoPrompts(', start);
  const code = transformSync(source.slice(start, end), { loader: 'ts' }).code;
  const segments = Array.from({ length: 12 }, (_, i) => ({ segmentKey: `SEG${String(i + 1).padStart(3, '0')}` }));
  let submissions = 0, prompts = [];
  const noop = () => {};
  const deps = { ideaScript: {}, videoPromptStatus: 'idle', videoPrompts: [], storyboardSegments: segments, productionStateRef: { current: {} }, persistCurrentProject: async () => {}, setVideoPromptStatus: noop, setVideoPromptError: noop, setVideoPromptsApproval: noop, setVideoPrompts: update => { prompts = update(prompts); }, mergeByStableKey, videoPromptBasePayload: () => ({}), areAllVideoPromptsComplete: (_, values) => values.length === 12, postWorkflowRequest: async (_, payload) => { submissions++; assert.equal(payload.requestedSegmentKeys.length, 12); return { prompts: payload.requestedSegmentKeys.map(segmentKey => ({ segmentKey, status: 'complete', prompt: 'fixture' })) }; } };
  await new Function('deps', `with(deps) { ${code}; return generateVideoPrompts(); }`)(deps);
  assert.equal(submissions, 1); assert.equal(prompts.length, 12);
});

test('a failed sibling repair preserves a successful repaired segment', async () => {
  const initial = fixture.validSegments(); initial[0].storyboardText = '缺少对白'; initial[4].storyboardText = '缺少对白'; let repairCalls = 0;
  const provider = { id: 'fixture', async generate(input) {
    if (input.operation === 'generate-concise-storyboard-segments') return completed({ segments: initial });
    if (++repairCalls === 1) return completed({ segment: fixture.validSegments()[0] });
    await delay(3); throw new Error('fixture sibling failure');
  } };
  await assert.rejects(generateStoryboardPromptsWithRepair(provider, fixture), error => {
    assert.match(error.diagnostics.repairFailure, /sibling failure/);
    assert.equal(error.diagnostics.draft.segments[0].storyboardText, fixture.validSegments()[0].storyboardText); return true;
  });
  assert.equal(repairCalls, 2);
});

test('segment generation preserves partial progress and resumes only its missing segment', async () => {
  const segments = fixture.validSegments(), outline = segments.map(item => ({ segmentKey: item.segmentKey, actionEvidenceIds: item.actionEvidenceIds, dialogueEvidenceIds: item.dialogueEvidenceIds, soundCueIds: item.soundCueIds, intent: item.title }));
  const operations = [], checkpoints = []; let failing = true;
  const provider = { id: 'fixture', async generate(input) {
    operations.push(input.operation);
    if (input.operation === 'plan-storyboard-evidence') return completed({ items: outline });
    const key = input.input.currentSlot?.segmentKey;
    assert.ok(key, 'resume must not regenerate whole initial batch');
    if (key === 'SEG003' && failing) throw new Error('fixture invalid JSON');
    return completed({ segment: segments.find(item => item.segmentKey === key) });
  } };
  const first = await productionContext.run({ event() {}, checkpoint(result) { checkpoints.push(result); } }, () => generateStoryboardPromptsBySegment(provider, fixture));
  assert.equal(first.complete, false); assert.equal(first.segments.length, 6); assert.ok(checkpoints.length >= 6);
  const before = operations.length; failing = false;
  const resumed = await generateStoryboardPromptsBySegment(provider, fixture, { ...first, repairOnly: true });
  assert.equal(resumed.complete, true); assert.equal(resumed.segments.length, 7);
  assert.deepEqual(operations.slice(before), ['generate-storyboard-segment']);
});

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages']) test(`${protocol} rejects invalid field types locally and retains the response`, async () => {
  const original = globalThis.fetch;
  const model = protocol === 'anthropic-messages' ? 'claude-sonnet-4-6' : 'fixture';
  globalThis.fetch = async () => new Response(JSON.stringify(protocol === 'responses'
    ? { id: 'schema-request', model: 'fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":"wrong"}' }] }] }
    : protocol === 'anthropic-messages' ? { id: 'schema-request', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: '{"ok":"wrong"}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    : { id: 'schema-request', model: 'fixture', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":"wrong"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  try {
    const provider = new OpenAIResponsesAgentProvider({ apiKey: 'fixture-key', baseUrl: 'https://fixture.invalid/v1', model, protocol, transientRetryCount: 0 });
    await assert.rejects(provider.generate(request), error => { assert.ok(error.code); assert.match(JSON.stringify(error.diagnostics), /wrong/); return true; });
  } finally { globalThis.fetch = original; }
});

test('output budgets honor provider caps and aliases require explicit mapping', () => {
  assert.equal(boundedOutputBudget(request, { maxOutputTokens: 8192 }, 32000), 8192);
  assert.ok(boundedOutputBudget(request, { contextWindowTokens: 4096 }, 32000) < 4096);
  assert.throws(() => boundedOutputBudget({ ...request, instructions: 'x'.repeat(5000) }, { contextWindowTokens: 4096 }, 32000));
  assert.equal(returnedModelAllowed('model', 'snapshot', {}), false);
  assert.equal(returnedModelAllowed('model', 'snapshot', { allowedReturnedModels: ['snapshot'] }), true);
});

test('persisted jobs deduplicate, checkpoint before completion and reconcile exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-jobs-'));
  let session = { id: 'project', revision: 1, state: { storyboardSegments: [{ segmentKey: 'SEG001' }], videoPrompts: [] } }, writes = 0, executions = 0, finish;
  const sessions = { load: () => session, save: ({ state }) => { writes++; session = { ...session, state, revision: session.revision + 1 }; return session; } };
  const store = createProductionJobStore({ directory, sessions, async execute() { executions++; productionCheckpoint({ prompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: 'saved' }] }); await new Promise(resolve => { finish = resolve; }); return { prompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: 'saved' }] }; } });
  const input = { projectId: 'project', route: '/api/videos/prompts', payload: {}, idempotencyKey: 'fixture-0001' };
  const first = store.submit(input); const duplicate = store.submit({ ...input, idempotencyKey: 'fixture-0002' });
  assert.equal(first.id, duplicate.id); assert.equal(executions, 1);
  assert.equal(JSON.parse(readFileSync(join(directory, `${first.id}.json`), 'utf8')).result.prompts[0].prompt, 'saved');
  finish(); await delay(5); store.reconcile(session); assert.equal(session.state.videoPrompts[0].prompt, 'saved');
  const before = writes; store.reconcile(session); assert.equal(writes, before);
  const reloaded = createProductionJobStore({ directory, sessions, execute() { throw new Error('restart must not submit'); } });
  assert.equal(reloaded.get(first.id).status, 'completed');
});

test('restart distinguishes not submitted and unknown calls without retrying', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-interrupted-')), id = '11111111-1111-4111-a111-111111111111';
  writeFileSync(join(directory, `${id}.json`), JSON.stringify({ id, status: 'running', calls: [{ callId: 'one', phase: 'queued' }, { callId: 'two', phase: 'running' }], result: { segments: [{ segmentKey: 'SEG001' }] } }));
  const store = createProductionJobStore({ directory, sessions: {}, execute() { throw new Error('no retry'); } });
  assert.equal(store.get(id).status, 'interrupted');
  assert.deepEqual(store.get(id).calls.map(call => call.phase), ['not_started', 'unknown']);
  assert.equal(store.get(id).result.segments.length, 1);
});

test('a one-segment source edit preserves other approvals and all old media', () => {
  const segments = [{ segmentKey: 'SEG001', storyboardText: 'old' }, { segmentKey: 'SEG002', storyboardText: 'unchanged' }];
  const state = { storyboardSegments: segments, storyboardBoards: segments.map(item => ({ segmentKey: item.segmentKey, imageUrl: item.segmentKey, approval: 'approved' })), videoPrompts: segments.map(item => ({ segmentKey: item.segmentKey, status: 'complete', prompt: item.segmentKey, approval: 'approved' })) };
  const next = applyProductionResult(state, { id: 'job', revision: 1, route: '/api/storyboards/segments', status: 'completed', result: { segments: [{ ...segments[0], storyboardText: 'new' }, segments[1]], complete: true } });
  assert.equal(next.storyboardBoards[0].stale, true); assert.equal(next.storyboardBoards[0].imageUrl, 'SEG001');
  assert.equal(next.videoPrompts[1].approval, 'approved');
  assert.equal(mergeByStableKey(state.videoPrompts, [{ segmentKey: 'SEG001', status: 'failed', error: 'failure' }])[0].prompt, 'SEG001');
});

test('source signatures survive persistence key ordering and retain stale protection', () => {
  const sessions = createCreativeSessionStore({ filePath: join(mkdtempSync(join(tmpdir(), 'prism-source-')), 'session.json') });
  const saved = sessions.save({ state: { step: 'workspace', projectName: 'fixture' } });
  const reloaded = sessions.load();
  assert.equal(productionSource(saved.state, '/api/videos/prompts'), productionSource(reloaded.state, '/api/videos/prompts'));
  assert.equal(productionSource({ ideaScript: { a: 1, b: 2 } }, ''), productionSource({ ideaScript: { b: 2, a: 1 } }, ''));
  assert.notEqual(productionSource({ ideaScript: { a: 1 } }, ''), productionSource({ ideaScript: { a: 2 } }, ''));
});

test('one approved board can proceed while an unrelated board is missing', () => {
  const state = { storyboardSegments: [{ segmentKey: 'SEG001' }, { segmentKey: 'SEG002' }], storyboardBoards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: 'fixture.png', approval: 'approved' }] };
  assert.doesNotThrow(() => requireSegmentApprovalForRoute({ state }, '/api/videos/prompts', { requestedSegmentKeys: ['SEG001'] }));
  assert.throws(() => requireSegmentApprovalForRoute({ state }, '/api/videos/prompts', { requestedSegmentKeys: ['SEG002'] }), /SEG002/);
  state.storyboardBoards[0].stale = true;
  assert.throws(() => requireSegmentApprovalForRoute({ state }, '/api/videos/prompts', { requestedSegmentKeys: ['SEG001'] }), /SEG001/);
});

test('one approved video prompt can proceed while the full stage is draft', () => {
  const state = { videoPromptsApproval: 'draft', storyboardSegments: [{ segmentKey: 'SEG001', title: 'fixture', durationSec: 5 }], videoPrompts: [{ segmentKey: 'SEG001', approval: 'approved', status: 'complete', prompt: 'fixture', referenceImageUrls: [], referenceLabels: [] }] };
  assert.doesNotThrow(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'text' }));
  state.videoPrompts[0].approval = 'draft';
  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'text' }), /SEG001/);
});

test('twelve-segment backend dispatch saves eleven successes when segment seven fails', async () => {
  const segments = Array.from({ length: 12 }, (_, i) => ({ segmentKey: `SEG${String(i + 1).padStart(3, '0')}` }));
  let active = 0, peak = 0; const saved = [], requested = [];
  const store = { async runVideoPrompts(input) {
    assert.equal(input.requestedSegmentKeys.length, 1);
    const [segmentKey] = input.requestedSegmentKeys; requested.push(segmentKey);
    active++; peak = Math.max(peak, active); await delay(2); active--;
    if (segmentKey === 'SEG007') throw new Error('fixture invalid JSON');
    return { prompts: [{ segmentKey, status: 'complete', prompt: 'fixture' }] };
  } };
  const result = await productionContext.run({ event() {}, checkpoint(value) { saved.push(...value.prompts); } }, () => executeProductionJob(store, '/api/videos/prompts', { segments }));
  assert.equal(peak, 2); assert.equal(requested.length, 12); assert.equal(saved.length, 11); assert.equal(result.prompts.length, 11);
  assert.match(result.error, /SEG007/);
  assert.deepEqual(result.prompts.map(item => item.segmentKey), segments.filter(item => item.segmentKey !== 'SEG007').map(item => item.segmentKey));
});

test('repeated checkpoints preserve approvals and changed results retain history', () => {
  const initial = [{ segmentKey: 'SEG001', prompt: 'first', approval: 'approved', version: 1 }];
  const repeated = mergeByStableKey(initial, [{ segmentKey: 'SEG001', prompt: 'first', approval: 'draft' }]);
  assert.equal(repeated[0].approval, 'approved'); assert.equal(repeated[0].previousVersions, undefined);
  const changed = mergeByStableKey(repeated, [{ segmentKey: 'SEG001', prompt: 'second' }]);
  assert.equal(changed[0].version, 2); assert.equal(changed[0].previousVersions[0].prompt, 'first'); assert.equal(changed[0].approval, 'draft');
});

test('an explicitly approved text plan remains a valid route without a storyboard image', () => {
  const state = { storyboardSegments: [{ segmentKey: 'SEG001' }], storyboardBoardPlans: [{ segmentKey: 'SEG001', approval: 'approved', plan: {} }], storyboardBoards: [] };
  assert.doesNotThrow(() => requireSegmentApprovalForRoute({ state }, '/api/videos/prompts', { requestedSegmentKeys: ['SEG001'] }));
  state.storyboardBoardPlans[0].stale = true;
  assert.throws(() => requireSegmentApprovalForRoute({ state }, '/api/videos/prompts', { requestedSegmentKeys: ['SEG001'] }), /SEG001/);
});
