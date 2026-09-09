import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { PrismH3Provider } from '../src/providers/prism-h3.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'prism-h3-provider-'));
  const discoveryPath = join(root, 'integration-bridge.json');
  writeFileSync(discoveryPath, JSON.stringify({ schemaVersion: 1, apiVersion: 1, baseUrl: 'http://127.0.0.1:57501', token: 'a'.repeat(64), pid: 1234, prismVersion: '0.4.47', updatedAt: new Date().toISOString() }));
  return { root, discoveryPath };
}

test('H3 health reports a missing PRISM console without starting anything', async () => {
  const provider = new PrismH3Provider({ discoveryPath: join(tmpdir(), `missing-prism-${Date.now()}.json`), fetchImpl: async () => { throw new Error('must not fetch'); } });
  const health = await provider.health();
  assert.equal(health.status, 'backend_offline');
  assert.match(health.message, /启动 PRISM H3/);
});

test('H3 health reads capabilities through the authenticated PRISM bridge', async () => {
  const { discoveryPath } = fixture();
  const requests = [];
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return Response.json({ ok: true, online: true, running: 0, pending: 0, runtimeProfile: '12gb_stable', device: 'RTX', capabilities: { baseReady: true, referenceReady: true } });
  } });
  const health = await provider.health();
  assert.equal(health.status, 'ok');
  assert.equal(health.details.prismVersion, '0.4.47');
  assert.equal(requests[0].url, 'http://127.0.0.1:57501/api/integration/v1/status');
  assert.equal(requests[0].authorization, `Bearer ${'a'.repeat(64)}`);
});

test('H3 provider follows a newly discovered bridge path without restarting Story Studio', async () => {
  const first = fixture();
  const second = fixture();
  writeFileSync(second.discoveryPath, JSON.stringify({ schemaVersion: 1, apiVersion: 1, baseUrl: 'http://127.0.0.1:57502', token: 'b'.repeat(64), pid: 5678, prismVersion: '0.4.48', updatedAt: new Date().toISOString() }));
  const previous = process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH;
  const requests = [];
  try {
    process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH = first.discoveryPath;
    const provider = new PrismH3Provider({ fetchImpl: async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
      return Response.json({ ok: true, online: true, running: 0, pending: 0, capabilities: { baseReady: true } });
    } });
    assert.equal((await provider.health()).status, 'ok');
    process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH = second.discoveryPath;
    assert.equal((await provider.health()).status, 'ok');
  } finally {
    if (previous === undefined) delete process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH;
    else process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH = previous;
  }
  assert.equal(requests[0].url, 'http://127.0.0.1:57501/api/integration/v1/status');
  assert.equal(requests[1].url, 'http://127.0.0.1:57502/api/integration/v1/status');
  assert.equal(requests[1].authorization, `Bearer ${'b'.repeat(64)}`);
});

test('H3 health distinguishes a connected PRISM console from an offline ComfyUI backend', async () => {
  const { discoveryPath } = fixture();
  const provider = new PrismH3Provider({
    discoveryPath,
    fetchImpl: async () => Response.json({ ok: false, online: false, error: 'fetch failed' }),
  });
  const health = await provider.health();
  assert.equal(health.status, 'backend_offline');
  assert.equal(health.message, 'PRISM H3 控制台已连接，但 ComfyUI 后端当前离线。');
  assert.equal(health.details.prismVersion, '0.4.47');
  assert.equal(health.details.backendError, 'fetch failed');
  assert.equal(health.details.discoveryPath, discoveryPath);
});

test('H3 memory release only runs through the bridge while the queue is idle', async () => {
  const { discoveryPath } = fixture();
  const requests = [];
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    requests.push({ pathname, body: init?.body });
    if (pathname.endsWith('/status')) return Response.json({ ok: true, online: true, running: 0, pending: 0 });
    if (pathname.endsWith('/actions')) return Response.json({ ok: true });
    throw new Error(`unexpected ${pathname}`);
  } });
  assert.deepEqual(await provider.releaseMemoryIfIdle(), { status: 'released' });
  assert.deepEqual(requests.map((item) => item.pathname), ['/api/integration/v1/status', '/api/integration/v1/actions']);
  assert.deepEqual(JSON.parse(requests[1].body), { action: 'free-memory' });
});

test('H3 memory release preserves active video tasks', async () => {
  const { discoveryPath } = fixture();
  let actions = 0;
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/status')) return Response.json({ ok: true, online: true, running: 1, pending: 0 });
    actions += 1;
    return Response.json({ ok: true });
  } });
  await assert.rejects(() => provider.releaseMemoryIfIdle(), (error) => error?.code === 'queue_busy');
  assert.equal(actions, 0);
});

test('H3 reference submission uploads approved images then returns the prompt id without retry', async () => {
  const { root, discoveryPath } = fixture();
  const imagePath = join(root, 'reference.png');
  writeFileSync(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const calls = [];
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    calls.push({ pathname, method: init?.method || 'GET', body: init?.body });
    if (pathname.endsWith('/upload')) return Response.json({ ok: true, stored: 'h3-local-console/reference.png' });
    if (pathname.endsWith('/generate')) return Response.json({ ok: true, promptId: 'prompt-001', frames: 124, sampledFrames: 124, actualSeconds: 5.1667 });
    throw new Error(`unexpected ${pathname}`);
  } });
  const task = await provider.submit({
    taskId: 'shot-video-seg001-v1', title: 'SEG001', sourceEntityIds: ['SEG001'], prompt: '人物继续前行。',
    referenceAssetIds: ['character-1'], referenceAssetVersions: { 'character-1': 1 }, referenceLabels: ['人物定妆'], referenceMediaPaths: [imagePath],
    width: 864, height: 480, durationSec: 5, inferenceSteps: 20, precision: 'bf16', acceleration: [], mode: 'reference', resolution: '480p', aspectRatio: '16:9', seed: 7, sage: true, spectrum: true,
  });
  assert.deepEqual(calls.map((item) => item.pathname), ['/api/integration/v1/upload', '/api/integration/v1/generate']);
  const submitted = JSON.parse(calls[1].body);
  assert.match(submitted.prompt, /^<Picture 1>：人物定妆/u);
  assert.deepEqual(submitted.referenceImages, ['h3-local-console/reference.png']);
  assert.equal(task.externalTaskId, 'prompt-001');
  assert.equal(task.status, 'queued');
  assert.equal(task.parameters.automaticRetry, false);
});

test('H3 Herrgotts submission forwards motion context without manufacturing a tail frame', async () => {
  const { discoveryPath } = fixture();
  let submitted;
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/generate')) {
      submitted = JSON.parse(init.body);
      return Response.json({ ok: true, promptId: 'prompt-herrgotts', frames: 124, sampledFrames: 124, actualSeconds: 5.1667 });
    }
    throw new Error(`unexpected ${pathname}`);
  } });
  const task = await provider.submit({
    taskId: 'shot-video-seg002-v1', title: 'SEG002', sourceEntityIds: ['SEG002'], prompt: '人物继续前行。',
    referenceAssetIds: [], referenceMediaPaths: [], width: 864, height: 480, durationSec: 5, inferenceSteps: 20, precision: 'bf16', acceleration: [], mode: 'text',
    continuity: { engine: 'herrgotts', chainId: 'autodrama-seg001-chain', segmentIndex: 2, segmentCount: 3, sourceSegmentId: 'SEG001' },
  });
  assert.deepEqual(submitted.motionContext, { chainId: 'autodrama-seg001-chain', segmentIndex: 2, segmentCount: 3 });
  assert.equal('firstFrame' in submitted, false);
  assert.equal('lastFrame' in submitted, false);
  assert.equal(task.parameters.continuity.sourceSegmentId, 'SEG001');
});

test('H3 task status follows exact queue prompt ids and completed history outputs', async () => {
  const { discoveryPath } = fixture();
  let phase = 'running';
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/status')) return Response.json({ ok: true, online: true, runningPromptId: phase === 'running' ? 'prompt-001' : '', pendingPromptIds: [] });
    if (pathname.endsWith('/history')) return Response.json({ ok: true, items: [{ promptId: 'prompt-001', completed: true, filename: 'result.mp4', subfolder: 'video', outputDirectory: 'E:/AI/ComfyUI-H3/ComfyUI/output', frames: 124 }] });
    throw new Error(`unexpected ${pathname}`);
  } });
  assert.equal((await provider.status('prompt-001')).status, 'running');
  phase = 'complete';
  const completed = await provider.status('prompt-001');
  assert.equal(completed.status, 'awaiting_review');
  assert.match(completed.outputPaths[0], /video[\\/]result\.mp4$/u);
});

test('H3 recoverable jobs expose safe segment bindings for active and completed tasks', async () => {
  const { discoveryPath } = fixture();
  const provider = new PrismH3Provider({ discoveryPath, fetchImpl: async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/status')) return Response.json({
      ok: true,
      online: true,
      runningPromptId: 'prompt-005',
      runningJobs: [{ promptId: 'prompt-005', title: 'SEG005 · 喘息与坚定' }],
      pendingPromptIds: ['prompt-006'],
      pendingJobs: [{ promptId: 'prompt-006', title: 'SEG006 · 继续走' }],
    });
    if (pathname.endsWith('/history')) return Response.json({ ok: true, items: [{ promptId: 'prompt-004', completed: true, filename: 'H3_UI_SEG004_·_躲入岩缝.mp4' }] });
    throw new Error(`unexpected ${pathname}`);
  } });
  const jobs = await provider.recoverableJobs();
  assert.deepEqual(jobs, [
    { externalTaskId: 'prompt-005', segmentKey: 'SEG005', status: 'running' },
    { externalTaskId: 'prompt-006', segmentKey: 'SEG006', status: 'queued' },
    { externalTaskId: 'prompt-004', segmentKey: 'SEG004', status: 'awaiting_review' },
  ]);
  assert.equal(JSON.stringify(jobs).includes('喘息与坚定'), false);
});
