import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAIResponsesAgentProvider, OpenAIResponsesProviderError } from '../src/providers/openai-responses.ts';
import { generatePropVisualProposalsWithDirector as generatePropVisualProposalsWithDirectorImpl, generateSceneVisualProposalsWithDirector as generateSceneVisualProposalsWithDirectorImpl, generateCharacterProfilesWithDirector as generateCharacterProfilesWithDirectorImpl, ProductionDirectorStageError } from '../src/manager/production-director.ts';
import { scheduledAgent, RequestScheduler } from '../src/providers/request-scheduler.ts';
import { productionContext } from '../src/workers/production-context.ts';
import { createProductionJobStore } from '../web/production-jobs.mjs';
import { applyProductionResult, productionSource } from '../web/src/production-state.ts';
import { preserveUsableAssetDraft, executeProductionJob, TEXT_AGENT_TRANSIENT_RETRY_COUNT } from '../web/local-api.mjs';

const generateCharacterProfilesWithDirector = (provider, input) => generateCharacterProfilesWithDirectorImpl(provider, input, { reviewMode: 'director' });
const generateSceneVisualProposalsWithDirector = (provider, input) => generateSceneVisualProposalsWithDirectorImpl(provider, input, { reviewMode: 'director' });
const generatePropVisualProposalsWithDirector = (provider, input) => generatePropVisualProposalsWithDirectorImpl(provider, input, { reviewMode: 'director' });

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const source = readFileSync(new URL('./production-director.test.mjs', import.meta.url), 'utf8');
const { script, styleSelection, profile, sceneProposal, completed } = new Function(`${source.slice(source.indexOf('const scenes ='), source.indexOf("test('production director"))}; return { script, styleSelection, profile, sceneProposal, completed };`)();
const propScript = { ...script, scenes: script.scenes.map((scene, index) => ({ ...scene, ...(index === 0 ? { sourceEvidence: ['无线耳机放在桌上。'] } : {}) })) };
const propDraft = {
  proposals: [{ name: '无线耳机', aliases: ['无线耳机'], baseStateDescription: '成对洁净完好。', sourceFacts: [{ fact: '无线耳机放在桌上。', evidenceId: 'E-S01-SOURCE-01' }], stateVariants: [],
    visualDesignProposal: { objectIdentity: '一对无线耳机。', silhouetteAndProportions: '小型入耳式。', materialsAndSurface: '哑光塑料。', constructionAndDetails: '两枚结构对应。', colorAndFinish: '浅灰。', scaleAndHandling: '单手拿取。', repeatableAnchors: ['短柄', '圆润腔体'], designDecisions: [] } }],
};
const request = { operation: 'production-director-review-prop-proposals', schemaName: 'review', instructions: '审核并返回 JSON', input: { draft: { proposals: [{ propAssetKey: 'R01' }] } }, outputSchema: { type: 'object', additionalProperties: false, required: ['decision'], properties: { decision: { type: 'string', enum: ['approve', 'revise'] } } } };
function chatResponse(text, finish_reason = 'stop') {
  return new Response(JSON.stringify({ id: 'review-request', model: 'fixture', choices: [{ finish_reason, message: { role: 'assistant', content: text, reasoning_content: 'private-reasoning-fixture' } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }), { headers: { 'content-type': 'application/json' } });
}
const provider = () => new OpenAIResponsesAgentProvider({ apiKey: 'fixture-key', model: 'fixture', baseUrl: 'https://fixture.invalid/v1', protocol: 'chat-completions', transientRetryCount: 0 });

test('compatible formatting is recovered from the same response with schema validation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return chatResponse('复核结果如下：\n```json\n{"decision":"approve"}\n```'); };
  const result = await provider().generate(request);
  assert.deepEqual(result.output, { decision: 'approve' }); assert.equal(calls, 1);
  assert.equal(result.externalTaskId, 'review-request'); assert.equal(result.usage.inputTokens, 10);
});

for (const [text, finish, code] of [
  ['', 'stop', 'missing_output_text'],
  ['{"decision":"approve"}', 'length', 'incomplete_response'],
  ['{"decision":7}', 'stop', 'schema_validation_failed'],
  ['{"decision":', 'stop', 'invalid_structured_output'],
  ['{"decision":"approve"}\n{"decision":"revise"}', 'stop', 'invalid_structured_output'],
]) test(`compatible review diagnoses ${code} and preserves evidence without another request: ${text.slice(0, 20)}`, async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return chatResponse(text, finish); };
  await assert.rejects(provider().generate(request), error => {
    assert.equal(error.code, code); assert.equal(error.diagnostics.externalTaskId, 'review-request');
    assert.equal(error.diagnostics.rawOutputText, text); assert.equal(error.diagnostics.responseStatus, finish);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /private-reasoning-fixture/); return true;
  });
  assert.equal(calls, 1); assert.equal(TEXT_AGENT_TRANSIENT_RETRY_COUNT, 0);
});

for (const [stage, generate, input, output] of [
  ['prop', generatePropVisualProposalsWithDirector, { script: propScript, styleSelection }, propDraft],
  ['scene', generateSceneVisualProposalsWithDirector, { script, styleSelection }, { proposals: script.scenes.map(scene => sceneProposal(scene.sceneKey)) }],
  ['character', generateCharacterProfilesWithDirector, { script, requiredCharacterNames: ['妈妈'] }, { profiles: [profile('妈妈', 'C01')] }],
]) test(`${stage} checkpoints a usable specialist draft before a failed director review`, async () => {
  const checkpoints = []; let calls = 0;
  const failure = new OpenAIResponsesProviderError('invalid review', { code: 'invalid_structured_output', diagnostics: { externalTaskId: 'failed-review', rawOutputText: '{broken' } });
  const fake = { id: 'fixture', async generate() { if (++calls === 1) return completed(output); assert.equal(checkpoints.length, 1); throw failure; } };
  await assert.rejects(productionContext.run({ event() {}, checkpoint: value => checkpoints.push(value) }, () => generate(fake, input)), error => {
    assert.ok(error instanceof ProductionDirectorStageError); assert.equal(error.failure, failure);
    assert.deepEqual(error.draft, checkpoints[0].candidateDraft); return true;
  });
  assert.equal(calls, 2); assert.equal(checkpoints[0].complete, false);
});

test('a later revision failure preserves the initial grounded prop draft', async () => {
  let calls = 0;
  const fake = { id: 'fixture', async generate() {
    if (++calls === 1) return completed(propDraft);
    if (calls === 2) return completed({ decision: 'revise', summary: '明确颜色。', revisionInstructions: ['使用中性灰。'] });
    throw new Error('revision unavailable');
  } };
  const result = await preserveUsableAssetDraft(() => generatePropVisualProposalsWithDirector(fake, { script: propScript, styleSelection }));
  assert.equal(calls, 3); assert.equal(result.output.proposals[0].propAssetKey, 'R01');
  assert.equal(result.supervision.status, 'incomplete'); assert.match(result.reviewWarning, /待你确认/);
  assert.equal(result.output.proposals[0].approval, undefined);
});

test('persistent prop job retains both requests, reconciles once and keeps user approval pending', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-asset-review-'));
  let session = { id: 'fixture-project', revision: 1, state: { ideaScript: propScript, selectedStyleId: 'fixture', propProposals: [], propProposalApproval: 'draft', propImages: [], storyboardBoards: [{ segmentKey: 'SEG001', imageUrl: '/previous.png' }] } };
  const sessions = { load: () => session, save: ({ state }) => (session = { ...session, state, revision: session.revision + 1 }) };
  const scheduler = new RequestScheduler(); let calls = 0;
  const fake = scheduledAgent({ id: 'fixture', async generate() { if (++calls === 1) return completed(propDraft); throw new OpenAIResponsesProviderError('invalid review', { code: 'invalid_structured_output', diagnostics: { externalTaskId: 'failed-review', rawOutputText: '{broken' } }); } }, scheduler);
  const store = { async runPropProposals() {
    const result = await preserveUsableAssetDraft(() => generatePropVisualProposalsWithDirector(fake, { script: propScript, styleSelection }));
    return { proposals: result.output.proposals, complete: false, error: result.reviewWarning, warnings: [result.reviewWarning] };
  } };
  const jobs = createProductionJobStore({ directory, sessions, execute: (route, payload) => executeProductionJob(store, route, payload) });
  const job = jobs.submit({ route: '/api/props/proposals', payload: {}, projectId: session.id, idempotencyKey: 'fixture-props-once' });
  for (let i = 0; i < 100 && ['queued', 'running'].includes(jobs.get(job.id).status); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(jobs.get(job.id).status, 'partial'); assert.equal(calls, 2);
  const saved = JSON.parse(readFileSync(join(directory, `${job.id}.json`), 'utf8'));
  assert.equal(saved.result.candidateDraft.proposals[0].propAssetKey, 'R01');
  assert.equal(saved.calls[0].output.proposals[0].name, '无线耳机'); assert.equal(saved.calls[1].diagnostics.rawOutputText, '{broken');
  jobs.reconcile(session); assert.equal(session.state.propStatus, 'complete'); assert.equal(session.state.propProposalApproval, 'draft');
  assert.equal(session.state.propProposals[0].name, '无线耳机'); assert.equal(session.state.storyboardBoards[0].imageUrl, '/previous.png');
  assert.equal(session.state.storyboardBoards[0].stale, true);
  const revision = session.revision; jobs.reconcile(session); assert.equal(session.revision, revision);
  const restarted = createProductionJobStore({ directory, sessions, execute() { throw new Error('must not retry'); } });
  assert.equal(restarted.diagnostic(job.id).calls[1].diagnostics.externalTaskId, 'failed-review');
  assert.equal(calls, 2);
});

test('interrupted review exposes its saved proposal for user review and changed script prevents reconciliation', () => {
  const state = { ideaScript: { id: 'script', version: 1 }, propProposals: [], propProposalApproval: 'draft' };
  const job = { id: 'job', route: '/api/props/proposals', revision: 2, status: 'interrupted', error: '请求状态待核对', result: { candidateDraft: { proposals: [{ propAssetKey: 'R01', name: '耳机' }] } } };
  const next = applyProductionResult(state, job);
  assert.equal(next.propStatus, 'complete'); assert.equal(next.propProposalApproval, 'draft'); assert.equal(next.propProposals[0].name, '耳机');
  assert.equal(productionSource(state, job.route), productionSource(next, job.route));
  assert.notEqual(productionSource(state, job.route), productionSource({ ...state, ideaScript: { id: 'script', version: 2 } }, job.route));
});

for (const [stage, generate, input, output] of [
  ['prop', generatePropVisualProposalsWithDirectorImpl, { script: propScript, styleSelection }, propDraft],
  ['scene', generateSceneVisualProposalsWithDirectorImpl, { script, styleSelection }, { proposals: script.scenes.map(scene => sceneProposal(scene.sceneKey)) }],
  ['character', generateCharacterProfilesWithDirectorImpl, { script, requiredCharacterNames: ['妈妈'] }, { profiles: [profile('妈妈', 'C01')] }],
]) test(`${stage} default self-review returns its draft after one call for user approval`, async () => {
  let calls = 0;
  const result = await generate({ id: 'fixture', async generate(request) {
    calls++; assert.match(request.instructions, /本次生成内完成起草和一次自检/u);
    return completed(output);
  } }, input);
  assert.equal(calls, 1);
  assert.equal(result.supervision.specialistRuns, 1);
  assert.deepEqual(result.supervision.directorReviews, []);
  assert.equal(result.output.approval, undefined);
});
