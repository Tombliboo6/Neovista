import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudVideoProvider, VideoApiError } from '../src/providers/cloud-video.mjs';
import { createVideoJobStore } from '../web/video-jobs.mjs';

const config = { apiKey: 'fixture-private-key', baseUrl: 'https://video.example/v1', model: 'MiniMax-Hailuo-2.3', profileId: 'p1', revision: 'r1' };
const request = { prompt: '基础设定：山间清晨。声音总则：环境声。氛围、画质与摄影风格：写实。画面内容与镜头执行：云雾轻动。负面词：画面闪烁。', mode: 'text', referenceMediaPaths: [], referenceLabels: [], durationSec: 6, aspectRatio: '16:9', cloudResolution: '768p', generateAudio: false, seed: 42 };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('MiniMax posts the approved prompt once and resolves task, file, download in separate calls', async () => {
  const calls = [];
  const api = new CloudVideoProvider('minimax', config, { fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    return json(calls.length === 1 ? { task_id: 'mm1' } : calls.length === 2 ? { status: 'Success', file_id: 'f1' } : { file: { download_url: 'https://cdn.example/movie.mp4' } });
  } });
  const body = await api.prepare(request);
  assert.equal(body.prompt, request.prompt); assert.equal(body.prompt_optimizer, false);
  assert.equal(body.resolution, '768P'); assert.equal(body.duration, 6);
  assert.equal(await api.submitPrepared(body), 'mm1');
  assert.deepEqual(await api.status('mm1'), { status: 'succeeded', downloadUrl: 'https://cdn.example/movie.mp4', fileId: 'f1' });
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.match(calls[1].url, /query\/video_generation\?task_id=mm1/u);
  assert.match(calls[2].url, /files\/retrieve\?file_id=f1/u);
});

test('MiniMax rejects incompatible duration, references, audio, first-frame and prompt lengths before network work', async () => {
  let calls = 0;
  const api = new CloudVideoProvider('minimax', config, { fetchImpl: () => { calls++; throw Error('network'); } });
  for (const patch of [{ durationSec: 15 }, { mode: 'reference', referenceMediaPaths: ['unused.png'] }, { generateAudio: true }, { cloudResolution: '480p' }, { prompt: '文'.repeat(2001) }, { mode: 'first' }, { prompt: '<Picture 1> 清晨' }]) await assert.rejects(api.prepare({ ...request, ...patch }));
  assert.equal(calls, 0);
});

test('Seedance maps uploaded image order and subjects without rewriting production content', async t => {
  const root = mkdtempSync(join(tmpdir(), 'prism-cloud-ref-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = [join(root, 'character.png'), join(root, 'board.png')];
  paths.forEach((path, index) => writeFileSync(path, `image-${index}`));
  const api = new CloudVideoProvider('seedance', { ...config, model: 'ep-seedance' });
  const body = await api.prepare({ ...request, cloudResolution: '720p', mode: 'reference', referenceMediaPaths: paths, referenceLabels: ['角色主图：林舟', '四宫格分镜'], prompt: '<Picture 1>定义<Subject 1>的身份。<Subject 1>按<Picture 2>第2格抬手。' });
  assert.equal(body.content[1].role, 'reference_image');
  assert.equal(body.content[1].image_url.url, `data:image/png;base64,${Buffer.from('image-0').toString('base64')}`);
  assert.match(body.content[0].text, /<Subject_1>按<Image_2>第2格抬手/u);
  assert.doesNotMatch(JSON.stringify(body), /character\.png|board\.png|Picture /u);
  assert.equal(body.seed, 42); assert.equal(body.generate_audio, false);
});

test('POST connection loss or missing task ID is ambiguous and is never retried', async () => {
  for (const response of [null, {}]) {
    let calls = 0;
    const api = new CloudVideoProvider('seedance', config, { fetchImpl: async () => { calls++; if (!response) throw Error('lost'); return json(response); } });
    await assert.rejects(api.submitPrepared({}), error => error instanceof VideoApiError && error.uncertain);
    assert.equal(calls, 1);
  }
});

test('download never forwards API credentials and persists received media', async t => {
  const root = mkdtempSync(join(tmpdir(), 'prism-cloud-download-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  let init;
  const api = new CloudVideoProvider('seedance', config, { fetchImpl: async (_, options) => { init = options; return new Response('video-bytes'); } });
  await api.download('https://cdn.example/video.mp4?signature=fixture', join(root, 'video.part'));
  assert.equal(init.headers, undefined); assert.equal(readFileSync(join(root, 'video.part'), 'utf8'), 'video-bytes');
  await assert.rejects(api.download('http://cdn.example/video', join(root, 'unsafe.part')));
});

function jobFixture(t, hooks = {}) {
  const root = mkdtempSync(join(tmpdir(), 'prism-video-job-'));
  const configurations = [];
  let posts = 0; let downloads = 0;
  const factory = () => createVideoJobStore({
    directory: join(root, 'jobs'), outputDirectory: join(root, 'videos'), pollIntervalMs: 0,
    configuration: (kind, profileId, revision) => { configurations.push({ kind, profileId, revision }); return { ...config, profileId: profileId || 'p1', revision: revision || 'r1' }; },
    probeMedia: async () => ({ durationSec: 6, width: 1280, height: 720, audioPresent: false }),
    providerFactory: () => ({ prepare: async value => value,
      submitPrepared: async () => { posts++; if (hooks.submit) return hooks.submit(); return 'remote-1'; },
      status: async () => hooks.status ? hooks.status() : ({ status: 'succeeded', downloadUrl: 'https://cdn.example/video.mp4' }),
      download: async (_, path) => { downloads++; if (hooks.download) return hooks.download(path); writeFileSync(path, 'media'); },
    }),
  });
  const store = factory();
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const input = { projectId: 'project1', segmentKey: 'SEG001', engine: 'seedance', profileId: 'p1', request: { ...request, cloudResolution: '720p' }, requestId: 'request-0001' };
  return { store, input, root, factory, configurations, counts: () => ({ posts, downloads }) };
}

test('durable job deduplicates concurrent POSTs, pins profile revision and returns only decoded local media', async t => {
  const f = jobFixture(t);
  const [one, two] = await Promise.all([f.store.submit(f.input), f.store.submit(f.input)]);
  assert.equal(one.id, two.id); assert.equal(f.counts().posts, 1);
  await new Promise(resolve => setImmediate(resolve));
  const ready = await f.store.status('project1', one.id);
  assert.equal(ready.status, 'awaiting_review'); assert.equal(ready.parameters.phase, 'ready');
  assert.equal(ready.remoteTaskId, 'remote-1');
  assert.equal(f.configurations.at(-1).revision, 'r1');
  assert.equal(f.store.mediaPath('project1', one.id), ready.outputPaths[0]);
  assert.throws(() => f.store.mediaPath('another-project', one.id));
  await assert.rejects(f.store.submit({ ...f.input, request: { ...f.input.request, durationSec: 10 } }), /不同的视频参数/u);
  const journal = readFileSync(join(f.root, 'jobs', readdirSync(join(f.root, 'jobs'))[0]), 'utf8');
  assert.doesNotMatch(journal, /fixture-private-key|signature=|downloadUrl/u);
});

test('unknown submission survives restart with zero replay and supports explicit reconciliation', async t => {
  const f = jobFixture(t, { submit: () => { throw new VideoApiError('未知接单', { uncertain: true }); } });
  const submitted = await f.store.submit(f.input);
  await new Promise(resolve => setImmediate(resolve));
  const restored = f.factory(); t.after(() => restored.close());
  const unknown = await restored.status('project1', submitted.id);
  assert.equal(unknown.parameters.phase, 'submission_unknown'); assert.equal(f.counts().posts, 1);
  assert.equal((await restored.reconcile('project1', submitted.id, 'remote-found')).remoteTaskId, 'remote-found');
  assert.equal((await restored.status('project1', submitted.id)).status, 'awaiting_review');
  assert.equal(f.counts().posts, 1);
});

test('download failure preserves remote identity; explicit retry only downloads original result', async t => {
  let attempt = 0;
  const f = jobFixture(t, { download: path => { if (++attempt === 1) throw Error('offline'); writeFileSync(path, 'media'); } });
  const submitted = await f.store.submit(f.input); await new Promise(resolve => setImmediate(resolve));
  const failed = await f.store.status('project1', submitted.id);
  assert.equal(failed.parameters.phase, 'download_failed'); assert.equal(failed.status, 'running');
  await f.store.status('project1', submitted.id); assert.equal(f.counts().downloads, 1);
  const done = await f.store.retryDownload('project1', submitted.id);
  assert.equal(done.status, 'awaiting_review'); assert.deepEqual(f.counts(), { posts: 1, downloads: 2 });
});

test('distinct submit IDs cannot concurrently create two jobs for one active shot', async t => {
  const f = jobFixture(t, { status: () => ({ status: 'running' }) });
  const results = await Promise.allSettled([f.store.submit(f.input), f.store.submit({ ...f.input, requestId: 'request-0002' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.counts().posts, 1);
});

test('Seedance task failure is terminal while HTTP authentication errors remain query failures', async () => {
  const api = new CloudVideoProvider('seedance', config, { fetchImpl: async () => json({ status: 'failed', error: { code: 'ContentPolicyViolation', message: 'private provider details' } }) });
  assert.deepEqual(await api.status('task-failed'), { status: 'failed', errorCode: 'ContentPolicyViolation' });
  const rejected = new CloudVideoProvider('seedance', config, { fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'Unauthorized' } }), { status: 401 }) });
  await assert.rejects(rejected.status('task-failed'), /Unauthorized/u);
});

test('remote failed task retains its ID and safe reason without downloading or retrying', async t => {
  const f = jobFixture(t, { status: () => ({ status: 'failed', errorCode: 'ContentPolicyViolation' }) });
  const job = await f.store.submit(f.input); await new Promise(resolve => setImmediate(resolve));
  const result = await f.store.status('project1', job.id);
  assert.equal(result.status, 'failed'); assert.equal(result.remoteTaskId, 'remote-1');
  assert.match(result.errorMessage, /ContentPolicyViolation/u);
  assert.deepEqual(f.counts(), { posts: 1, downloads: 0 });
});

test('decoded result preserves media and exposes duration, resolution and missing-audio differences for review', async t => {
  const f = jobFixture(t);
  const job = await f.store.submit({ ...f.input, request: { ...f.input.request, durationSec: 10, cloudResolution: '1080p', generateAudio: true } });
  await new Promise(resolve => setImmediate(resolve));
  const result = await f.store.status('project1', job.id);
  assert.equal(result.status, 'awaiting_review'); assert.equal(result.parameters.mediaWarnings.length, 3);
  assert.match(result.errorMessage, /实际时长.*实际尺寸.*未检测到音轨/u);
  assert.equal(result.outputPaths.length, 1);
});
