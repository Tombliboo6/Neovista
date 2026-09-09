import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AceStepMusicProvider } from '../src/providers/acestep-music.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-acestep-'));
  const executablePath = join(root, 'acestep-api.exe');
  const outputDirectory = join(root, 'outputs');
  writeFileSync(executablePath, 'exe');
  writeFileSync(join(root, 'runtime.bin'), 'runtime');
  return { root, executablePath, outputDirectory };
}

function apiFixture(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/health')) return new Response('{}', { status: 503 });
    if (url.endsWith('/release_task')) return Response.json({ code: 200, data: { task_id: 'ace-task-1' } });
    if (url.endsWith('/query_result')) return Response.json({ code: 200, data: [{ task_id: 'ace-task-1', status: 1, result: JSON.stringify([{ file: '/audio/generated.wav' }]) }] });
    if (url.endsWith('/audio/generated.wav')) return new Response(Buffer.alloc(64, 1), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
}

test('ACE-Step submits once, enforces instrumental settings, trims and fully decodes the result', async () => {
  const paths = fixture();
  const fetchCalls = [];
  const processCalls = [];
  let probeCount = 0;
  let stopped = 0;
  const provider = new AceStepMusicProvider({
    projectDirectory: paths.root,
    executablePath: paths.executablePath,
    outputDirectory: paths.outputDirectory,
    requiredFiles: [['runtime.bin', 1]],
    fetchFn: apiFixture(fetchCalls),
    acquireServer: async () => ({ owned: true, logs: () => 'ACE test log', stop: async () => { stopped += 1; } }),
    sleep: async () => {},
    processRunner: async (command, args) => {
      processCalls.push({ command, args });
      if (command === 'ffprobe') {
        probeCount += 1;
        return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_f32le', channels: 2, sample_rate: '48000' }], format: { duration: probeCount === 1 ? '75' : '60' } }), stderr: '' };
      }
      if (command === 'ffmpeg' && args.some((value) => String(value).includes('silencedetect'))) return { code: 0, stdout: '', stderr: 'silence_start: 68\nsilence_end: 75 | silence_duration: 7' };
      if (command === 'ffmpeg' && args.includes('-af') && args.some((value) => String(value).includes('atrim='))) writeFileSync(args.at(-1), Buffer.alloc(64, 2));
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const task = await provider.submit({ taskId: 'ace-music-ok', sourceEntityIds: ['rough-cut.mp4'], prompt: '克制的纯器乐电影配乐。', durationSec: 60, instrumental: true, seed: 9, bpm: 92, keyScale: 'D Minor', timeSignature: '4', inferenceSteps: 8, thinking: true });
  const releaseCalls = fetchCalls.filter(({ url }) => url.endsWith('/release_task'));
  assert.equal(releaseCalls.length, 1);
  const payload = JSON.parse(releaseCalls[0].init.body);
  assert.equal(payload.lyrics, '[Instrumental]');
  assert.equal(payload.audio_duration, 75);
  assert.equal(payload.seed, 9);
  assert.equal(payload.bpm, 92);
  assert.equal(payload.key_scale, 'D Minor');
  assert.equal(payload.inference_steps, 8);
  assert.equal(task.provider, 'acestep-1.5');
  assert.equal(task.status, 'awaiting_review');
  assert.equal(task.parameters.effectiveDurationSec, 68);
  assert.equal(task.parameters.actualDurationSec, 60);
  assert.equal(task.parameters.automaticRetry, false);
  assert.equal(task.parameters.fullDecodeVerified, true);
  assert.ok(existsSync(task.outputPaths[0]));
  assert.ok(processCalls.some(({ command, args }) => command === 'ffmpeg' && args.some((value) => String(value).includes('afade=t=out'))));
  assert.equal(stopped, 1);
});

test('ACE-Step preserves one decodable short result without resubmitting or changing parameters', async () => {
  const paths = fixture();
  const fetchCalls = [];
  let stopped = 0;
  const provider = new AceStepMusicProvider({
    projectDirectory: paths.root,
    executablePath: paths.executablePath,
    outputDirectory: paths.outputDirectory,
    requiredFiles: [['runtime.bin', 1]],
    fetchFn: apiFixture(fetchCalls),
    acquireServer: async () => ({ owned: true, logs: () => 'short result', stop: async () => { stopped += 1; } }),
    sleep: async () => {},
    processRunner: async (command, args) => {
      if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_f32le', channels: 2, sample_rate: '48000' }], format: { duration: '75' } }), stderr: '' };
      if (command === 'ffmpeg' && args.some((value) => String(value).includes('silencedetect'))) return { code: 0, stdout: '', stderr: 'silence_start: 55\nsilence_end: 75 | silence_duration: 20' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const task = await provider.submit({ taskId: 'ace-music-short', sourceEntityIds: [], prompt: '纯器乐。', durationSec: 60, instrumental: true, seed: 11 });
  assert.equal(task.status, 'failed');
  assert.equal(task.errorCode, 'duration_too_short');
  assert.match(task.errorMessage, /结果可试听/u);
  assert.equal(fetchCalls.filter(({ url }) => url.endsWith('/release_task')).length, 1);
  assert.equal(fetchCalls.filter(({ url }) => url.endsWith('/query_result')).length, 1);
  assert.ok(existsSync(task.outputPaths[0]));
  assert.equal(readFileSync(task.outputPaths[0]).length, 64);
  assert.equal(task.parameters.seed, 11);
  assert.equal(task.parameters.automaticRetry, false);
  assert.equal(stopped, 1);
});

test('ACE-Step song mode forwards lyrics and vocal language once', async () => {
  const paths = fixture();
  const fetchCalls = [];
  let probeCount = 0;
  const provider = new AceStepMusicProvider({
    projectDirectory: paths.root,
    executablePath: paths.executablePath,
    outputDirectory: paths.outputDirectory,
    requiredFiles: [['runtime.bin', 1]],
    fetchFn: apiFixture(fetchCalls),
    acquireServer: async () => ({ owned: true, logs: () => 'song result', stop: async () => {} }),
    sleep: async () => {},
    processRunner: async (command, args) => {
      if (command === 'ffprobe') {
        probeCount += 1;
        return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_f32le', channels: 2, sample_rate: '48000' }], format: { duration: probeCount === 1 ? '38' : '30' } }), stderr: '' };
      }
      if (command === 'ffmpeg' && args.some((value) => String(value).includes('silencedetect'))) return { code: 0, stdout: '', stderr: '' };
      if (command === 'ffmpeg' && args.includes('-af') && args.some((value) => String(value).includes('atrim='))) writeFileSync(args.at(-1), Buffer.alloc(64, 2));
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  await provider.submit({ taskId: 'ace-song-ok', sourceEntityIds: ['audio-node-1'], prompt: '明亮的中文流行摇滚，女声主唱。', lyrics: '[Verse]\n沿着晨光奔跑\n[Chorus]\n此刻自由闪耀', vocalLanguage: 'zh', durationSec: 30, instrumental: false, seed: 12, bpm: 108, keyScale: 'C Major', timeSignature: '4', inferenceSteps: 8 });
  const payload = JSON.parse(fetchCalls.find(({ url }) => url.endsWith('/release_task')).init.body);
  assert.equal(payload.instrumental, false);
  assert.equal(payload.vocal_language, 'zh');
  assert.match(payload.lyrics, /沿着晨光奔跑/u);
});

test('ACE-Step song mode requires lyrics before submitting', async () => {
  const paths = fixture();
  const provider = new AceStepMusicProvider({ projectDirectory: paths.root, executablePath: paths.executablePath, outputDirectory: paths.outputDirectory, requiredFiles: [['runtime.bin', 1]] });
  await assert.rejects(() => provider.submit({ taskId: 'ace-song-empty', sourceEntityIds: [], prompt: '中文流行歌曲。', durationSec: 30, instrumental: false }), /需要1至4096字符/u);
});
