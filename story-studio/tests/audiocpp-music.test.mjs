import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AudioCppMusicProvider, AudioCppMusicProviderError, buildAudioCppMusicArgs } from '../src/providers/audiocpp-music.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-audiocpp-'));
  const executablePath = join(root, 'audiocpp_cli.exe');
  const modelDirectory = join(root, 'model');
  const modelFile = join(root, 'model.bin');
  const outputDirectory = join(root, 'outputs');
  writeFileSync(executablePath, 'exe');
  writeFileSync(modelFile, 'model');
  return { root, executablePath, modelDirectory: root, modelFile, outputDirectory };
}

test('audio.cpp local Music provider fixes Q4/Q8/Q4 arguments and validates the generated WAV once', async () => {
  const paths = fixture();
  const calls = [];
  const processRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === paths.executablePath) {
      writeFileSync(args[args.indexOf('--out') + 1], Buffer.alloc(64, 1));
      return { code: 0, stdout: 'wall_ms=1000', stderr: '' };
    }
    if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', channels: 2, sample_rate: '44100' }], format: { duration: '9.996' } }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const provider = new AudioCppMusicProvider({
    executablePath: paths.executablePath,
    modelDirectory: paths.modelDirectory,
    outputDirectory: paths.outputDirectory,
    requiredModelFiles: [['model.bin', 5]],
    processRunner,
    seedFactory: () => 20260824,
  });
  const health = await provider.health();
  assert.equal(health.status, 'ok');
  const task = await provider.submit({ taskId: 'local-music-001', sourceEntityIds: ['rough-cut.mp4'], prompt: '克制的纯器乐电影配乐。', durationSec: 10, instrumental: true, seed: 20260827 });
  assert.equal(calls.length, 3);
  assert.equal(task.provider, 'audiocpp-minimax-music-3');
  assert.equal(task.status, 'awaiting_review');
  assert.equal(task.parameters.seed, 20260827);
  assert.equal(task.parameters.fullDecodeVerified, true);
  assert.equal(task.parameters.automaticRetry, false);
  assert.equal(readFileSync(task.outputPaths[0]).length, 64);
  const args = calls[0].args;
  assert.equal(args[args.indexOf('--lyrics') + 1], '[Instrumental]');
  assert.equal(args[args.indexOf('--num-inference-steps') + 1], '30');
  assert.equal(args[args.indexOf('--seed') + 1], '20260827');
  assert.ok(args.includes('language_model_gguf=language_model_q4_0.gguf'));
  assert.ok(args.includes('rvq_depth_decoder_gguf=rvq_depth_decoder_q8_0.gguf'));
  assert.ok(args.includes('flow_transformer_gguf=transformer_q4_0.gguf'));
  assert.ok(args.includes('mem_saver=true'));
  assert.equal(calls[1].command, 'ffprobe');
  assert.equal(calls[2].command, 'ffmpeg');
});

test('audio.cpp local Music provider preserves a failure and does not retry', async () => {
  const paths = fixture();
  let calls = 0;
  const provider = new AudioCppMusicProvider({
    executablePath: paths.executablePath,
    modelDirectory: paths.modelDirectory,
    outputDirectory: paths.outputDirectory,
    requiredModelFiles: [['model.bin', 5]],
    processRunner: async () => { calls += 1; throw new AudioCppMusicProviderError('CUDA failed', { code: 'exit_1' }); },
  });
  await assert.rejects(() => provider.submit({ taskId: 'local-music-fail', sourceEntityIds: [], prompt: '纯音乐。', durationSec: 10, instrumental: true }), (error) => error instanceof AudioCppMusicProviderError && error.code === 'exit_1');
  assert.equal(calls, 1);
});

test('audio.cpp Music CLI argument builder never invokes a shell or omits the instrumental condition', () => {
  const args = buildAudioCppMusicArgs({ backend: 'cuda', device: 0, modelDirectory: 'E:/model', prompt: '提示词', durationSec: 60.78, inferenceSteps: 30, seed: 9, outputPath: 'E:/out.wav', logPath: 'E:/out.log' });
  assert.deepEqual(args.slice(0, 12), ['--backend', 'cuda', '--device', '0', '--task', 'gen', '--family', 'minimax_music3', '--model', 'E:/model', '--text', '提示词']);
  assert.equal(args[args.indexOf('--duration-seconds') + 1], '60.78');
  assert.equal(args[args.indexOf('--lyrics') + 1], '[Instrumental]');
});

test('audio.cpp Music provider accepts an instrumental-only section scaffold without changing the default', () => {
  const scaffold = '[Intro]\n[Instrumental]\n[Solo]\n[Instrumental]\n[Outro]\n[Instrumental]';
  const args = buildAudioCppMusicArgs({ backend: 'cuda', device: 0, modelDirectory: 'E:/model', prompt: '提示词', durationSec: 90, inferenceSteps: 30, seed: 10, outputPath: 'E:/out.wav', logPath: 'E:/out.log', instrumentalCondition: scaffold });
  assert.equal(args[args.indexOf('--lyrics') + 1], scaffold);
  assert.throws(() => buildAudioCppMusicArgs({ backend: 'cuda', device: 0, modelDirectory: 'E:/model', prompt: '提示词', durationSec: 90, inferenceSteps: 30, seed: 10, outputPath: 'E:/out.wav', logPath: 'E:/out.log', instrumentalCondition: '[Verse]\nwords' }), /instrumental condition/u);
});

test('audio.cpp web profile over-generates, trims with a fade, and validates the final target duration', async () => {
  const paths = fixture();
  const calls = [];
  let probes = 0;
  const scaffold = '[Intro]\n[Instrumental]\n[Instrumental]\n[Solo]\n[Instrumental]\n[Outro]\n[Instrumental]';
  const provider = new AudioCppMusicProvider({
    executablePath: paths.executablePath,
    modelDirectory: paths.modelDirectory,
    outputDirectory: paths.outputDirectory,
    requiredModelFiles: [['model.bin', 5]],
    instrumentalCondition: scaffold,
    generationDurationSec: 90,
    fadeOutSec: 1.5,
    seedFactory: () => 11,
    processRunner: async (command, args) => {
      calls.push({ command, args });
      if (command === paths.executablePath) writeFileSync(args[args.indexOf('--out') + 1], Buffer.alloc(64, 1));
      if (command === 'ffmpeg' && args.includes('-af')) writeFileSync(args.at(-1), Buffer.alloc(64, 2));
      if (command === 'ffprobe') {
        probes += 1;
        return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', channels: 2, sample_rate: '44100' }], format: { duration: probes === 1 ? '74.849524' : '60.782688' } }), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const task = await provider.submit({ taskId: 'web-music-001', sourceEntityIds: [], prompt: '纯音乐。', durationSec: 60.782688, instrumental: true });
  const cliArgs = calls[0].args;
  assert.equal(cliArgs[cliArgs.indexOf('--duration-seconds') + 1], '90');
  assert.equal(cliArgs[cliArgs.indexOf('--lyrics') + 1], scaffold);
  assert.equal(task.parameters.generatedDurationSec, 74.849524);
  assert.equal(task.parameters.actualDurationSec, 60.782688);
  assert.equal(task.parameters.fadeOutSec, 1.5);
  assert.ok(calls.some(({ command, args }) => command === 'ffmpeg' && args.includes('-af') && args.some((value) => String(value).includes('afade=t=out'))));
});

test('audio.cpp web profile preserves a short raw result and rejects completion without retrying', async () => {
  const paths = fixture();
  let cliCalls = 0;
  let decodeCalls = 0;
  const provider = new AudioCppMusicProvider({
    executablePath: paths.executablePath,
    modelDirectory: paths.modelDirectory,
    outputDirectory: paths.outputDirectory,
    requiredModelFiles: [['model.bin', 5]],
    generationDurationSec: 90,
    processRunner: async (command, args) => {
      if (command === paths.executablePath) { cliCalls += 1; writeFileSync(args[args.indexOf('--out') + 1], Buffer.alloc(64, 1)); }
      if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', channels: 2, sample_rate: '44100' }], format: { duration: '20.49161' } }), stderr: '' };
      if (command === 'ffmpeg' && args.includes('null')) decodeCalls += 1;
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const task = await provider.submit({ taskId: 'web-music-short', sourceEntityIds: [], prompt: '纯音乐。', durationSec: 60.782688, instrumental: true });
  assert.equal(task.status, 'failed');
  assert.equal(task.errorCode, 'duration_too_short');
  assert.match(task.errorMessage, /结果可试听/u);
  assert.equal(task.outputPaths.length, 1);
  assert.equal(task.parameters.fullDecodeVerified, true);
  assert.equal(cliCalls, 1);
  assert.equal(decodeCalls, 1);
  const manifest = JSON.parse(readFileSync(join(paths.outputDirectory, 'web-music-short.json'), 'utf8'));
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.outputPath, task.outputPaths[0]);
});
