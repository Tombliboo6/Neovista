import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { approveReadyVideoPrompts, confirmVideoPromptDraft, isReadyVideoPrompt } from '../src/video-prompt-recovery.ts';
import { buildWebH3GenerationRequest, createCreativeSessionStore } from '../local-api.mjs';
import { PrismH3Provider } from '../../src/providers/prism-h3.ts';
import { deriveWorkflowSnapshot } from '../../src/workflow/runtime.ts';

const blocked = { segmentKey: 'SEG003', prompt: '基础设定\n人物凝视远处。', status: 'needs_revision', approval: 'draft', validationCodes: ['shot execution must preserve dialogue B-S01-D02'], validationIssues: ['没有逐字保留对白（B-S01-D02）'], error: '校验未通过', referenceImageUrls: [], referenceLabels: [] };
function saveAndReload(state) {
  const filePath = join(mkdtempSync(join(tmpdir(), 'prism-prompt-recovery-')), 'session.json');
  createCreativeSessionStore({ filePath }).save({ state: { step: 'workspace', ...state } });
  return createCreativeSessionStore({ filePath }).load().state;
}
test('explicit adoption keeps the unchanged draft and diagnostics through a saved-project round trip', () => {
  const original = structuredClone(blocked);
  const accepted = confirmVideoPromptDraft(blocked, blocked.prompt, '2026-09-07T00:00:00.000Z');
  assert.deepEqual(blocked, original);
  assert.equal(isReadyVideoPrompt(accepted), true);
  assert.equal(accepted.approval, 'approved');
  assert.equal(accepted.prompt, blocked.prompt);
  assert.deepEqual(accepted.manualReview.validationCodes, blocked.validationCodes);
  const state = saveAndReload({ videoPrompts: [accepted], videoPromptStatus: 'complete', videoPromptsApproval: 'draft' });
  const restored = JSON.parse(JSON.stringify(state)).videoPrompts[0];
  assert.equal(restored.approval, 'approved');
  assert.equal(restored.status, 'complete');
  assert.deepEqual(restored.manualReview, accepted.manualReview);
  assert.equal(confirmVideoPromptDraft(blocked, ' '), blocked);
  const running = { ...blocked, status: 'running' };
  assert.equal(confirmVideoPromptDraft(running, blocked.prompt), running);
});

test('continuing ready segments preserves unresolved siblings and the partial workflow', () => {
  const ready = { ...blocked, segmentKey: 'SEG001', status: 'complete', error: undefined, validationCodes: [], validationIssues: [] };
  const stale = { ...ready, segmentKey: 'SEG002', stale: true };
  const next = approveReadyVideoPrompts([ready, stale, blocked], ['SEG001', 'SEG002', 'SEG003']);
  assert.equal(next[0].approval, 'approved');
  assert.equal(next[1], stale);
  assert.equal(next[2], blocked);
  const state = saveAndReload({ videoPrompts: next, videoPromptStatus: 'failed', videoPromptsApproval: 'draft', videoPromptError: 'SEG003需要处理' });
  assert.equal(state.videoPrompts[0].approval, 'approved');
  assert.equal(state.videoPrompts[2].status, 'needs_revision');
  assert.equal(deriveWorkflowSnapshot(state).stages['video-prompts'].status, 'partial');
});

test('director and bridge submit 720p 10s unchanged once, including partial approval', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-risk-recovery-'));
  const discoveryPath = join(root, 'bridge.json');
  writeFileSync(discoveryPath, JSON.stringify({ schemaVersion: 1, apiVersion: 1, baseUrl: 'http://127.0.0.1:57501', token: 'a'.repeat(64), pid: 1234, prismVersion: '0.4.47' }));
  const state = { videoPromptsApproval: 'draft', storyboardSegments: [{ segmentKey: 'SEG001', title: '镜头', durationSec: 10 }], videoPrompts: [{ ...blocked, segmentKey: 'SEG001', status: 'complete', approval: 'approved' }, blocked] };
  const request = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'text', resolution: '720p', qualityPreset: 'standard', seed: 99 });
  assert.equal(request.confirmRisk, true);
  assert.deepEqual([request.width, request.height, request.durationSec, request.inferenceSteps, request.seed], [1280, 736, 10, 20, 99]);
  let calls = 0;
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (_url, init) => {
    calls++;
    const payload = JSON.parse(init.body);
    assert.equal(payload.confirmRisk, true);
    assert.deepEqual([payload.resolution, payload.seconds, payload.steps, payload.seed], ['720p', 10, 20, 99]);
    return Response.json({ ok: true, promptId: 'fixture-h3' });
  } });
  await provider.submit(request);
  assert.equal(calls, 1);
  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG003', mode: 'text' }), /尚未确认/);
  let failedCalls = 0;
  const unavailable = new PrismH3Provider({ discoveryPath, fetchImpl: async () => { failedCalls++; return Response.json({ ok: false, error: 'Ref2VA模型未安装' }, { status: 409 }); } });
  await assert.rejects(unavailable.submit(request), /模型未安装/);
  assert.equal(failedCalls, 1);
});
