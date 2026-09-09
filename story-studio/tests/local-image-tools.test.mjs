import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { LocalImageToolsProvider } from '../src/providers/local-image-tools.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'prism-image-tools-'));
  const runtime = join(root, 'runtime');
  const models = join(runtime, 'models');
  const output = join(root, 'output');
  mkdirSync(models, { recursive: true });
  const executable = join(runtime, 'realesrgan-ncnn-vulkan.exe');
  const source = join(root, 'source.png');
  writeFileSync(executable, 'fixture');
  writeFileSync(source, 'fixture');
  for (const name of ['realesrgan-x4plus.param', 'realesrgan-x4plus.bin', 'realesrgan-x4plus-anime.param', 'realesrgan-x4plus-anime.bin', 'realesr-animevideov3-x2.param', 'realesr-animevideov3-x2.bin']) writeFileSync(join(models, name), 'fixture');
  return { root, output, executable, source };
}

test('local image tools use the native anime 2x model without mismatched tile assembly', async () => {
  const { output, executable, source } = fixture();
  const calls = [];
  const provider = new LocalImageToolsProvider({ outputDirectory: output, realEsrganExecutable: executable, processRunner: async (command, args) => {
    calls.push({ command, args });
    if (String(command).includes('ffprobe')) return { code: 0, stdout: JSON.stringify({ streams: [{ width: calls.length > 2 ? 640 : 320, height: calls.length > 2 ? 480 : 240 }] }), stderr: '' };
    writeFileSync(args[args.indexOf('-o') + 1], 'result');
    return { code: 0, stdout: '', stderr: '' };
  } });
  const result = await provider.run({ taskId: 'upscale-once', sourcePath: source, operation: 'upscale', upscaleScale: 2, upscaleModel: 'anime' });
  const generationCalls = calls.filter((call) => call.command === executable);
  assert.equal(generationCalls.length, 1);
  assert.deepEqual(generationCalls[0].args.slice(0, 8), ['-i', source, '-o', join(output, 'upscale-once.png'), '-n', 'realesr-animevideov3', '-s', '2']);
  assert.deepEqual(result.parameters.pipeline, { model: 'realesr-animevideov3', nativeScale: 2, outputScale: 2, downsampled: false });
  assert.equal(result.parameters.automaticRetry, false);
  assert.equal(result.outputPath, join(output, 'upscale-once.png'));
});

test('local image tools make general 2x output through native 4x plus Lanczos downsampling', async () => {
  const { output, executable, source } = fixture();
  const calls = [];
  let probes = 0;
  const provider = new LocalImageToolsProvider({ outputDirectory: output, realEsrganExecutable: executable, processRunner: async (command, args) => {
    calls.push({ command, args });
    if (String(command).includes('ffprobe')) {
      probes += 1;
      return { code: 0, stdout: JSON.stringify({ streams: [{ width: probes === 1 ? 320 : 640, height: probes === 1 ? 240 : 480 }] }), stderr: '' };
    }
    const target = command === executable ? args[args.indexOf('-o') + 1] : args.at(-1);
    writeFileSync(target, 'result');
    return { code: 0, stdout: '', stderr: '' };
  } });
  const result = await provider.run({ taskId: 'general-upscale-2x', sourcePath: source, operation: 'upscale', upscaleScale: 2, upscaleModel: 'general' });
  const generationCall = calls.find((call) => call.command === executable);
  const downsampleCall = calls.find((call) => call.command === 'ffmpeg');
  assert.deepEqual(generationCall.args.slice(4, 8), ['-n', 'realesrgan-x4plus', '-s', '4']);
  assert.ok(downsampleCall.args.includes('scale=640:480:flags=lanczos'));
  assert.deepEqual(result.parameters.pipeline, { model: 'realesrgan-x4plus', nativeScale: 4, outputScale: 2, downsampled: true, downsampleFilter: 'lanczos' });
});

test('local image rotation creates a new PNG and does not invoke Real-ESRGAN', async () => {
  const { output, executable, source } = fixture();
  const calls = [];
  let probes = 0;
  const provider = new LocalImageToolsProvider({ outputDirectory: output, realEsrganExecutable: executable, processRunner: async (command, args) => {
    calls.push({ command, args });
    if (String(command).includes('ffprobe')) {
      probes += 1;
      return { code: 0, stdout: JSON.stringify({ streams: [{ width: probes === 1 ? 320 : 240, height: probes === 1 ? 240 : 320 }] }), stderr: '' };
    }
    writeFileSync(args.at(-1), 'result');
    return { code: 0, stdout: '', stderr: '' };
  } });
  const result = await provider.run({ taskId: 'rotate-once', sourcePath: source, operation: 'rotate-counterclockwise' });
  assert.equal(calls.filter((call) => call.command === executable).length, 0);
  assert.equal(calls.filter((call) => call.command === 'ffmpeg').length, 1);
  assert.ok(calls.find((call) => call.command === 'ffmpeg').args.includes('transpose=2'));
  assert.equal(result.operation, 'rotate-counterclockwise');
});
