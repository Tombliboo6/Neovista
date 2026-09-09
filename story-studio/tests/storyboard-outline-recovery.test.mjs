import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildStoryboardSegmentPlan, collectStoryboardOutlineIssues, reconcileStoryboardOutline, generateStoryboardPromptsBySegment, StoryboardPromptValidationError } from '../src/storyboards/storyboard-prompt-generation.ts';
import { productionContext } from '../src/workers/production-context.ts';
import { recoverStoryboardJobResult, structuredInputError, executeProductionJob } from '../web/local-api.mjs';
import { createProductionJobStore } from '../web/production-jobs.mjs';
import { productionSource, applyProductionResult } from '../web/src/production-state.ts';
import { buildProjectManagerContext } from '../src/manager/project-inspector.ts';
import { deriveWorkflowSnapshot } from '../src/workflow/runtime.ts';

const source = readFileSync(new URL('./storyboard-prompt.test.mjs', import.meta.url), 'utf8');
const fixture = new Function('buildStoryboardSegmentPlan', `${source.slice(source.indexOf('const scene ='), source.indexOf("test('default storyboard"))}; return { script, styleSelection, assets, validSegments };`)(buildStoryboardSegmentPlan);
const plan = () => fixture.validSegments().map(s => ({ segmentKey: s.segmentKey, actionEvidenceIds: s.actionEvidenceIds, dialogueEvidenceIds: s.dialogueEvidenceIds, soundCueIds: s.soundCueIds, intent: s.title }));
const completed = output => ({ output, providerId: 'fixture', model: 'fixture', completedAt: new Date().toISOString() });
const duplicate = () => { const items = plan(); items[1].actionEvidenceIds.unshift('B-S01-A01'); return items; };

test('outline diagnostics identify exact duplicate, owners and source text', () => {
  const issues = collectStoryboardOutlineIssues(duplicate(), fixture);
  assert.equal(issues.length, 1);
  for (const text of ['B-S01-A01', 'S01动作1。', 'SEG001、SEG002', '重复分配']) assert.ok(issues[0].includes(text));
});

test('redundant action ownership is repaired locally with complete ordered coverage and retained input', () => {
  const original = duplicate(), snapshot = structuredClone(original);
  const result = reconcileStoryboardOutline(original, fixture);
  assert.deepEqual(original, snapshot); assert.deepEqual(result.outline, plan()); assert.equal(result.adjustments.length, 1);
});

for (const [name, change, message] of [
  ['missing', p => p[0].actionEvidenceIds.pop(), '遗漏动作'],
  ['order', p => p[0].actionEvidenceIds.reverse(), '顺序错误'],
  ['unknown', p => p[0].actionEvidenceIds.push('B-S01-A99'), '未知动作'],
  ['scene', p => { p[0].actionEvidenceIds.push(p[4].actionEvidenceIds.shift()); }, '其他场次'],
  ['dialogue duplicate', p => p[1].dialogueEvidenceIds.push('B-S01-D01'), '对白'],
]) test(`outline ${name} remains blocked with specific diagnostics`, () => {
  const items = duplicate(); change(items);
  assert.ok(collectStoryboardOutlineIssues(items, fixture).some(issue => issue.includes(message)));
  assert.deepEqual(reconcileStoryboardOutline(items, fixture).outline, items);
});

test('fresh duplicate outline proceeds with one planning call and keeps original checkpoint', async () => {
  const calls = [], checkpoints = [], segments = fixture.validSegments();
  const provider = { async generate(request) { calls.push(request.operation); return completed(request.operation === 'plan-storyboard-evidence' ? { items: duplicate() } : { segment: segments.find(s => s.segmentKey === request.input.currentSlot.segmentKey) }); } };
  const result = await productionContext.run({ event() {}, checkpoint: value => checkpoints.push(value) }, () => generateStoryboardPromptsBySegment(provider, fixture));
  assert.equal(result.complete, true); assert.equal(calls.filter(x => x === 'plan-storyboard-evidence').length, 1);
  assert.ok(checkpoints.some(c => c.originalOutline?.[1].actionEvidenceIds.includes('B-S01-A01')));
});

test('invalid returned plan is retained before stopping without segment calls', async () => {
  const items = plan(); items[0].actionEvidenceIds.shift(); const checkpoints = []; let calls = 0;
  await assert.rejects(productionContext.run({ event() {}, checkpoint: value => checkpoints.push(value) }, () => generateStoryboardPromptsBySegment({ async generate() { calls++; return completed({ items }); } }, fixture)), error => {
    assert.ok(error instanceof StoryboardPromptValidationError); assert.deepEqual(error.diagnostics.draft.outline, items);
    assert.deepEqual(structuredInputError(error).outline, items); return true;
  });
  assert.equal(calls, 1); assert.deepEqual(checkpoints.at(-1).outline, items);
});

test('explicit repair validates saved outline and performs only one failed outline repair', async () => {
  const items = plan(); items[0].actionEvidenceIds.shift(); const operations = [];
  await assert.rejects(generateStoryboardPromptsBySegment({ async generate(request) { operations.push(request.operation); assert.ok(request.input.validationIssues[0].includes('遗漏')); return completed({ items }); } }, fixture, { outline: items, repairOnly: true }), /遗漏/);
  assert.deepEqual(operations, ['repair-storyboard-evidence']);
});

test('saved duplicate plan resumes segment generation without another planning request', async () => {
  const operations = [], segments = fixture.validSegments();
  const result = await generateStoryboardPromptsBySegment({ async generate(request) { operations.push(request.operation); return completed({ segment: segments.find(s => s.segmentKey === request.input.currentSlot.segmentKey) }); } }, fixture, { outline: duplicate(), repairOnly: true });
  assert.equal(result.complete, true); assert.deepEqual(operations, Array(7).fill('generate-storyboard-segment'));
});

test('outline repair cannot change an existing successful segment assignment', async () => {
  const items = plan(); items[0].actionEvidenceIds.shift(); const segments = fixture.validSegments();
  const changed = plan(); changed[0].actionEvidenceIds.pop(); changed[1].actionEvidenceIds.unshift('B-S01-A02'); let calls = 0;
  await assert.rejects(generateStoryboardPromptsBySegment({ async generate() { calls++; return completed({ items: changed }); } }, fixture, { outline: items, segments: [segments[0]], repairOnly: true }), /已保存正文/);
  assert.equal(calls, 1);
});

test('outline repair network failure preserves its input checkpoint', async () => {
  const items = plan(); items[0].actionEvidenceIds.shift(); const checkpoints = [];
  await assert.rejects(productionContext.run({ event() {}, checkpoint: x => checkpoints.push(x) }, () => generateStoryboardPromptsBySegment({ async generate() { throw new Error('offline'); } }, fixture, { outline: items, repairOnly: true })), /offline/);
  assert.deepEqual(checkpoints[0].outline, items);
});

const archived = () => ({ id: 'af95f7cf-5e32-4342-a2e1-01f16c113a87', projectId: 'project', route: '/api/storyboards/segments', status: 'partial', revision: 2, createdAt: '2026-01-01T00:00:00Z',
  error: 'Storyboard prompt validation failed: 整集规划必须按顺序完整分配每条动作',
  payload: { segmentDurationSec: 15, script: { durationSec: 30, title: '测试', logline: '测试', endingHook: '结束', scenes: [{ location: '室内', time: '白天', blocks: [{ type: 'action', text: '角色抬手；同伴走近。' }] }] } },
  calls: [{ callId: 'fixture-call', operation: 'plan-storyboard-evidence', phase: 'completed', output: { items: ['SEG001', 'SEG002'].map(segmentKey => ({ segmentKey, actionEvidenceIds: ['B-S01-A01'], dialogueEvidenceIds: [], soundCueIds: [], intent: '动作' })) } }],
  result: { complete: false, error: '旧错误' },
});

test('historical recovery restores original plan and detailed manager context without executing work', () => {
  const job = archived(), directory = mkdtempSync(join(tmpdir(), 'prism-outline-'));
  let session = { id: 'project', revision: 1, state: { ideaScript: job.payload.script, storyboardRejectedDraft: '{"segments":[],"outline":[]}', productionAppliedJobs: { [job.id]: 2 } } };
  job.sourceVersion = 2; job.sourceHash = createHash('sha256').update(productionSource(session.state, job.route)).digest('hex');
  writeFileSync(join(directory, job.id + '.json'), JSON.stringify(job));
  let executions = 0, writes = 0;
  const sessions = { load: () => session, save: ({ state }) => { writes++; return session = { ...session, state, revision: session.revision + 1 }; } };
  const options = { directory, sessions, recoverResult: recoverStoryboardJobResult, execute() { executions++; } };
  const store = createProductionJobStore(options); store.reconcile(session); store.reconcile(session);
  const recovered = JSON.parse(session.state.storyboardRejectedDraft);
  assert.equal(recovered.outline.length, 2); assert.deepEqual(store.diagnostic(job.id).calls, job.calls);
  assert.equal(writes, 1); assert.equal(executions, 0);
  assert.deepEqual(buildProjectManagerContext({ ...session, workflow: deriveWorkflowSnapshot(session.state) }).storyboardDiagnostics, { issues: session.state.storyboardRejectedIssues, hasRecoverableDraft: true });
  const revision = store.get(job.id).revision; assert.equal(createProductionJobStore(options).get(job.id).revision, revision);
  const state = { ...session.state, ideaScript: { ...session.state.ideaScript, title: '新剧本' }, productionAppliedJobs: {} };
  assert.equal(store.reconcile({ ...session, state }).state, state);
});

test('failed empty repair keeps a recovered plan available', () => {
  const job = archived(), result = recoverStoryboardJobResult(job);
  const first = applyProductionResult({}, { ...job, result });
  const second = applyProductionResult(first, { ...job, id: 'empty-repair', result: { complete: false, error: 'empty draft' } });
  assert.deepEqual(JSON.parse(second.storyboardRejectedDraft).outline, result.outline);
});

test('production error checkpoint presents exact details and preserves outline', async () => {
  const checkpoints = [], items = plan(); items[0].actionEvidenceIds.shift();
  const issues = collectStoryboardOutlineIssues(items, fixture);
  await assert.rejects(productionContext.run({ event() {}, checkpoint: x => checkpoints.push(x) }, () => executeProductionJob({ async runStoryboardSegments() { throw new StoryboardPromptValidationError(issues, { outline: items }); } }, '/api/storyboards/segments', {})));
  assert.deepEqual(checkpoints[0].outline, items); assert.ok(checkpoints[0].error.includes('B-S01-A01')); assert.ok(!checkpoints[0].error.includes('自动进入'));
});
