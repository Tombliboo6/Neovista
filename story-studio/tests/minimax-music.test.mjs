import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MiniMaxMusicProvider, MiniMaxMusicProviderError } from '../src/providers/minimax-music.ts';

function mp3Bytes() {
  const bytes = Buffer.alloc(512, 0);
  bytes.write('ID3', 0, 'ascii');
  return bytes;
}

test('MiniMax Music provider submits one instrumental URL request and immediately saves MP3', async () => {
  const calls = [];
  const outputDirectory = mkdtempSync(join(tmpdir(), 'autodrama-music-'));
  const provider = new MiniMaxMusicProvider({
    apiKey: 'music-secret', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3.0', outputDirectory,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/music_generation')) return new Response(JSON.stringify({ data: { audio: 'https://cdn.example.test/result.mp3', status: 2 }, trace_id: 'trace-1', extra_info: { music_duration: 60780, music_sample_rate: 44100, music_channel: 2, music_size: 512 }, base_resp: { status_code: 0, status_msg: 'success' } }), { status: 200 });
      return new Response(mp3Bytes(), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    },
  });
  const task = await provider.submit({ taskId: 'music-project-001', sourceEntityIds: ['rough-cut-001'], prompt: '电影感纯音乐，无人声、无歌词。', durationSec: 60.78, instrumental: true });
  assert.equal(calls.length, 2);
  const requestBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(requestBody, { model: 'music-3.0', prompt: '电影感纯音乐，无人声、无歌词。', stream: false, output_format: 'url', audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' }, aigc_watermark: false, lyrics_optimizer: false, is_instrumental: true });
  assert.equal(task.status, 'awaiting_review');
  assert.equal(task.externalTaskId, 'trace-1');
  assert.equal(task.parameters.automaticRetry, false);
  assert.equal(task.parameters.downloadedImmediately, true);
  assert.deepEqual(readFileSync(task.outputPaths[0]), mp3Bytes());
});

test('MiniMax Music provider preserves one upstream failure and never downloads or retries', async () => {
  let calls = 0;
  const provider = new MiniMaxMusicProvider({
    apiKey: 'music-secret', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3.0', outputDirectory: mkdtempSync(join(tmpdir(), 'autodrama-music-fail-')),
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }), { status: 200 }); },
  });
  await assert.rejects(() => provider.submit({ taskId: 'music-fail-001', sourceEntityIds: [], prompt: '纯音乐。', durationSec: 10, instrumental: true }), (error) => error instanceof MiniMaxMusicProviderError && error.code === '1008');
  assert.equal(calls, 1);
});

test('MiniMax Music provider blocks vocals and overlong prompts before network access', async () => {
  let calls = 0;
  const provider = new MiniMaxMusicProvider({ apiKey: 'music-secret', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3.0', outputDirectory: mkdtempSync(join(tmpdir(), 'autodrama-music-validation-')), fetchImpl: async () => { calls += 1; return new Response('{}'); } });
  await assert.rejects(() => provider.submit({ taskId: 'music-vocals', sourceEntityIds: [], prompt: '歌曲', durationSec: 10, instrumental: false }), /only allows instrumental/u);
  await assert.rejects(() => provider.submit({ taskId: 'music-long', sourceEntityIds: [], prompt: '音'.repeat(2001), durationSec: 10, instrumental: true }), /1 to 2000/u);
  assert.equal(calls, 0);
});
