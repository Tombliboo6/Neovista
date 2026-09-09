import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { transformSync } from 'esbuild';
import { createCreativeSessionStore } from '../web/local-api.mjs';
import { createProductionJobStore } from '../web/production-jobs.mjs';
import { productionSource, applyProductionResult, assetProductionStage } from '../web/src/production-state.ts';
import { RequestScheduler, scheduledImage } from '../src/providers/request-scheduler.ts';
import { productionContext } from '../src/workers/production-context.ts';

const route = '/api/storyboards/boards';
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = () => new Promise(resolve => setTimeout(resolve, 2));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'prism-board-receipt-'));
  const sessions = createCreativeSessionStore({ filePath: join(directory, 'session.json') });
  const session = sessions.save({ state: { step: 'workspace', projectName: 'Receipt fixture', storyboardSegments: [{ segmentKey: 'SEG001', storyboardText: 'fixture' }], storyboardBoardPanelCount: 3, storyboardApproval: 'approved' } });
  return { directory: join(directory, 'jobs'), sessions, session };
}
const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
const receiverCode = transformSync(app.slice(app.indexOf('  async function receiveProductionJob('), app.indexOf('  async function persistCurrentProject(')), { loader: 'ts' }).code;
function receiver(session) {
  const state = structuredClone(session.state);
  state.sceneAssetsSkipped = Boolean(state.sceneAssetsSkipped);
  const deps = { productionStateRef: { current: state }, productionAppliedJobsRef: { current: state.productionAppliedJobs || {} }, activeProjectIdRef: { current: session.id }, crypto: webcrypto, productionSource, applyProductionResult, assetProductionStage };
  for (const name of ['setStoryboardBoardPlans', 'setStoryboardBoardPrompts', 'updateStoryboardBoards', 'setStoryboardBoardStatus', 'setStoryboardBoardError', 'setStoryboardAssetsApproval']) deps[name] = () => {};
  const receive = new Function('deps', `with(deps) { ${receiverCode}; return receiveProductionJob; }`)(deps);
  return { receive, deps };
}

for (const flag of [undefined, false, true]) test(`scene skip ${flag} survives save/load and browser hydration with identical signatures`, () => {
  const { sessions, session } = setup();
  const draft = { ...session.state, sceneAssetsSkipped: flag };
  const saved = sessions.save({ state: draft, expectedRevision: session.revision });
  assert.equal(saved.state.sceneAssetsSkipped, Boolean(flag));
  for (const path of [route, '/api/storyboards/segments', '/api/storyboards/board-plans', '/api/videos/prompts']) {
    assert.equal(productionSource(draft, path), productionSource(sessions.load().state, path));
    assert.equal(productionSource({ ...draft, sceneAssetsSkipped: Boolean(flag) }, path), productionSource(saved.state, path));
  }
});

test('persisted image completion reaches the actual client receiver, survives reload, and ignores older poll revisions', async () => {
  const { directory, sessions, session } = setup();
  let submissions = 0;
  const store = createProductionJobStore({ directory, sessions, async execute() { submissions++; await delay(); return { boards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: '/api/generated-images/fixture.png' }] }; } });
  let job = store.submit({ route, payload: {}, projectId: session.id, idempotencyKey: randomUUID() });
  assert.equal(job.sourceVersion, 2);
  const ui = receiver(session);
  await ui.receive(job); const initial = structuredClone(job);
  while (job.status === 'running') { await delay(); job = store.get(job.id); }
  await Promise.all([ui.receive(job), ui.receive(job)]);
  await ui.receive(initial);
  assert.equal(ui.deps.productionStateRef.current.storyboardBoards[0].imageUrl, '/api/generated-images/fixture.png');
  assert.equal(ui.deps.productionStateRef.current.storyboardBoardStatus, 'complete');
  assert.equal(ui.deps.productionAppliedJobsRef.current[job.id], job.revision);
  const saved = sessions.save({ state: ui.deps.productionStateRef.current, expectedRevision: session.revision });
  const restarted = createProductionJobStore({ directory, sessions, execute() { throw new Error('must not resubmit'); } });
  assert.equal(restarted.reconcile(saved).revision, saved.revision);
  assert.equal(submissions, 1);
});

test('legacy image jobs match an omitted false flag but still reject changed script, segment, preset, or a deliberate skip', async () => {
  const { directory, sessions, session } = setup();
  createProductionJobStore({ directory, sessions, async execute() { return {}; } });
  const id = randomUUID();
  const old = { id, projectId: session.id, route, status: 'completed', revision: 3, createdAt: '2026-01-01', sourceHash: hash(productionSource({ ...session.state, sceneAssetsSkipped: undefined }, route, 1)), result: { boards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: '/api/generated-images/legacy.png' }] } };
  writeFileSync(join(directory, `${id}.json`), JSON.stringify(old));
  const store = createProductionJobStore({ directory, sessions, execute() { throw new Error('must not resubmit'); } });
  assert.ok(store.matches(id, session.state));
  const ui = receiver(session); await ui.receive(store.get(id));
  assert.equal(ui.deps.productionStateRef.current.storyboardBoards[0].imageUrl, '/api/generated-images/legacy.png');
  for (const change of [{ sceneAssetsSkipped: true }, { ideaScript: { id: 'changed' } }, { storyboardSegments: [{ segmentKey: 'SEG001', storyboardText: 'changed' }] }, { generationPreset: { ...session.state.generationPreset, version: 9 } }]) {
    const state = { ...session.state, ...change };
    assert.equal(store.matches(id, state), false);
    const changedUi = receiver({ ...session, state }); await changedUi.receive(old);
    assert.equal(changedUi.deps.productionStateRef.current.storyboardBoards.length, 0);
  }
  const recovered = store.reconcile(session);
  assert.equal(recovered.state.storyboardBoards[0].imageUrl, '/api/generated-images/legacy.png');
  assert.equal(recovered.state.storyboardApproval, 'approved');
  assert.equal(store.reconcile(recovered).revision, recovered.revision);
});

test('a completed board clears its pending flag and retains previous usable images', () => {
  const before = { storyboardBoardPanelCount: 3, storyboardBoards: [{ segmentKey: 'SEG001', status: 'running', queueState: 'queued', imageUrl: '/old.png', error: 'earlier failure', approval: 'approved' }] };
  const after = applyProductionResult(before, { id: 'fixture', revision: 3, route, status: 'completed', result: { boards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: '/new.png' }] } });
  assert.equal(after.storyboardBoards[0].queueState, undefined);
  assert.equal(after.storyboardBoards[0].error, '');
  assert.equal(after.storyboardBoards[0].previousVersions[0].imageUrl, '/old.png');
  assert.equal(after.storyboardBoards[0].approval, 'draft');
  const failed = applyProductionResult(before, { id: 'fixture', revision: 3, route, status: 'partial', result: { boards: [{ segmentKey: 'SEG001', status: 'failed', error: 'new failure' }] } });
  assert.equal(failed.storyboardBoards[0].imageUrl, '/old.png');
  assert.equal(failed.storyboardBoards[0].status, 'complete');
  assert.equal(failed.storyboardBoards[0].queueState, undefined);
  assert.equal(failed.storyboardBoards[0].error, 'new failure');
});

test('twelve image requests expose queued, active and terminal events with two concurrent calls and no retry', async () => {
  const scheduler = new RequestScheduler();
  const events = [], started = [], releases = []; let active = 0, peak = 0;
  const provider = scheduledImage({ id: 'image-fixture', async health() {}, async submit(request) {
    started.push(request.targetKeys[0]); active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve)); active--;
    if (request.targetKeys[0] === 'SEG003') throw Object.assign(new Error('fixture network error'), { code: 'network_error', diagnostics: { externalTaskId: 'failed-image-request' } });
    return { status: 'completed', externalTaskId: request.taskId, outputPaths: [`/${request.taskId}.png`] };
  } }, scheduler);
  const pending = productionContext.run({ event: event => events.push(event), checkpoint() {} }, () => Promise.allSettled(Array.from({ length: 12 }, (_, i) => provider.submit({ taskId: `image-${i}`, targetKeys: [`SEG${String(i + 1).padStart(3, '0')}`] }))));
  await delay();
  assert.equal(events.filter(x => x.phase === 'queued').length, 12);
  assert.equal(events.filter(x => x.phase === 'running').length, 2);
  assert.equal(scheduler.status().lanes.image.queued, 10);
  while (started.length < 12 || active) { releases.splice(0).forEach(release => release()); await delay(); }
  const result = await pending;
  assert.equal(peak, 2); assert.equal(started.length, 12);
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 11);
  const failed = events.filter(x => x.phase === 'failed');
  assert.equal(failed.length, 1); assert.deepEqual(failed[0].targetKeys, ['SEG003']);
  assert.equal(failed[0].externalTaskId, 'failed-image-request');
  assert.equal(events.filter(x => x.phase === 'completed').length, 11);
  assert.equal(new Set(events.map(x => x.callId)).size, 12);
});
