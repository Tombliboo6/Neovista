import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderSettingsStore, createCreativeSessionStore, requireWorkflowDependenciesForRoute, runLocalRoughCut } from '../local-api.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('three video engines coexist with existing providers; pinned credentials survive editing, switching and removal', () => {
  let saved;
  const persistence = { load: () => saved, save: value => { saved = structuredClone(value); } };
  const store = createProviderSettingsStore({ persistence });
  store.configure({ kind: 'h3', baseUrl: 'http://127.0.0.1:8188' });
  const first = store.configure({ kind: 'seedance-video', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'ep-original', apiKey: 'original-key-fixture' });
  const pinned = store.videoConfiguration('seedance-video', first.activeProfileId);
  store.configure({ kind: 'seedance-video', profileId: first.activeProfileId, baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'ep-new', apiKey: 'new-key-fixture' });
  store.configure({ kind: 'minimax-video', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-Hailuo-2.3', apiKey: 'minimax-key-fixture' });
  store.remove('seedance-video', first.activeProfileId);
  const restored = createProviderSettingsStore({ persistence });
  const original = restored.videoConfiguration('seedance-video', pinned.profileId, pinned.revision);
  assert.equal(original.model, 'ep-original'); assert.equal(original.apiKey, 'original-key-fixture');
  assert.throws(() => restored.videoConfiguration('minimax-video', pinned.profileId, pinned.revision));
  assert.throws(() => restored.videoConfiguration('minimax-video', 'missing-profile'));
  assert.deepEqual(restored.status().map(item => item.kind), ['agent', 'image', 'image-edit', 'music', 'h3', 'minimax-video', 'seedance-video']);
  assert.doesNotMatch(JSON.stringify(restored.status()), /original-key-fixture|new-key-fixture|minimax-key-fixture|videoConfigurationHistory/u);
  assert.equal(restored.status().find(item => item.kind === 'h3').baseUrl, 'http://127.0.0.1:8188');
});

test('video connection checks do not submit a paid generation', async () => {
  const calls = [];
  const store = createProviderSettingsStore({ fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ items: [] })); } });
  store.configure({ kind: 'minimax-video', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-Hailuo-2.3', apiKey: 'minimax-fixture-key' });
  store.configure({ kind: 'seedance-video', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'ep-fixture', apiKey: 'seedance-fixture-key' });
  const mini = await store.test('minimax-video'); assert.equal(mini.status, 'configured'); assert.equal(calls.length, 0);
  const seed = await store.test('seedance-video'); assert.equal(seed.status, 'ok'); assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET'); assert.match(calls[0].url, /contents\/generations\/tasks\?page_size=1/u);
});

test('project roundtrip preserves video engine settings and durable submission identity without rewriting prompts', t => {
  const root = mkdtempSync(join(tmpdir(), 'prism-video-settings-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { filePath: join(root, 'session.json'), projectDirectory: join(root, 'projects') };
  const store = createCreativeSessionStore(options);
  const settings = { engine: 'seedance', profileId: 'seedance-p1', cloudResolution: '720p', generateAudio: true, mode: 'reference' };
  store.save({ state: { step: 'workspace', projectName: '视频接口验收', h3GenerationSettings: settings,
    videoPrompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: '已确认的中文正文', approval: 'approved' }],
    shotVideoTasks: [{ segmentKey: 'SEG001', status: 'submitting', updatedAt: new Date().toISOString(), submissionIntent: { requestId: 'request-preserved', settings, continuityMode: 'independent', queuedAt: new Date().toISOString() } }],
  } });
  const restored = createCreativeSessionStore(options).load();
  assert.equal(restored.state.h3GenerationSettings.engine, 'seedance');
  assert.equal(restored.state.h3GenerationSettings.profileId, 'seedance-p1');
  assert.equal(restored.state.h3GenerationSettings.cloudResolution, '720p');
  assert.equal(restored.state.videoPrompts[0].prompt, '已确认的中文正文');
  assert.equal(restored.state.shotVideoTasks[0].submissionIntent.requestId, 'request-preserved');
  assert.equal(requireWorkflowDependenciesForRoute(restored, '/api/videos/generations'), 'shot-videos');
});

test('rough cut distinguishes deliberately silent API video from a missing requested soundtrack', async t => {
  const root = mkdtempSync(join(tmpdir(), 'prism-silent-video-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'silent.mp4'); writeFileSync(source, 'fixture');
  const calls = [];
  const processRunner = async (command, args) => {
    if (command === 'ffprobe') return { stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '24/1' }, ...(args.at(-1) === source ? [] : [{ codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }])], format: { duration: '6' } }) };
    calls.push(args); if (args.includes('-filter_complex')) writeFileSync(args.at(-1), 'rendered');
    return { stdout: '', stderr: '', code: 0 };
  };
  const saved = { id: 'silence', state: { shotVideosApproval: 'approved', storyboardSegments: [{ segmentKey: 'SEG001', order: 1 }], shotVideoTasks: [{ segmentKey: 'SEG001', status: 'awaiting_review', outputPaths: [source], parameters: { videoEngine: 'minimax', generateAudio: false } }] } };
  const result = await runLocalRoughCut(saved, { outputDirectory: root, processRunner });
  assert.equal(result.status, 'complete');
  assert.match(calls[0].join(' '), /anullsrc=r=48000:cl=stereo,atrim=duration=6/u);
  assert.equal(JSON.parse(readFileSync(result.manifestPath, 'utf8')).assemblyMode, 'normalized-with-intentional-silence');
  saved.state.shotVideoTasks[0].parameters.generateAudio = true;
  await assert.rejects(runLocalRoughCut(saved, { outputDirectory: root, processRunner }), /要求原声却缺少音轨/u);
});
