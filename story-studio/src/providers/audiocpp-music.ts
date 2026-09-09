import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import type { GenerationTask } from '../domain/contracts.js';
import type { MusicGenerationRequest, MusicProvider, ProviderHealth } from './contracts.js';

const REQUIRED_MODEL_FILES = [
  ['config.json', 107],
  ['config/language_model.json', 1_596],
  ['config/rvq_depth_decoder.json', 274],
  ['config/condition_encoder.json', 292],
  ['config/transformer.json', 294],
  ['config/vocoder.json', 251],
  ['tokenizer/tokenizer.json', 11_423_801],
  ['tokenizer/tokenizer_config.json', 377],
  ['language_model_q4_0.gguf', 6_006_866_496],
  ['rvq_depth_decoder_q8_0.gguf', 714_028_960],
  ['condition_encoder.gguf', 100_677_184],
  ['transformer_q4_0.gguf', 1_396_392_768],
  ['vocoder.gguf', 216_704_192],
] as const;

export interface AudioCppMusicProviderOptions {
  executablePath?: string;
  modelDirectory?: string;
  outputDirectory: string;
  backend?: 'cuda' | 'cpu' | 'best';
  device?: number;
  inferenceSteps?: number;
  timeoutMs?: number;
  processRunner?: AudioCppProcessRunner;
  seedFactory?: () => number;
  requiredModelFiles?: ReadonlyArray<readonly [string, number]>;
  instrumentalCondition?: string;
  generationDurationSec?: number;
  fadeOutSec?: number;
}

export type AudioCppProcessResult = { code: number; stdout: string; stderr: string };
export type AudioCppProcessRunner = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<AudioCppProcessResult>;

export class AudioCppMusicProviderError extends Error {
  readonly code: string;
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(message: string, options: { code: string; diagnostics?: Record<string, unknown> }) {
    super(message);
    this.name = 'AudioCppMusicProviderError';
    this.code = options.code;
    this.diagnostics = options.diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export class AudioCppMusicProvider implements MusicProvider {
  readonly id = 'audiocpp-minimax-music-3';
  readonly #executablePath: string;
  readonly #modelDirectory: string;
  readonly #outputDirectory: string;
  readonly #backend: 'cuda' | 'cpu' | 'best';
  readonly #device: number;
  readonly #inferenceSteps: number;
  readonly #timeoutMs: number;
  readonly #processRunner: AudioCppProcessRunner;
  readonly #seedFactory: () => number;
  readonly #requiredModelFiles: ReadonlyArray<readonly [string, number]>;
  readonly #instrumentalCondition: string;
  readonly #generationDurationSec: number | undefined;
  readonly #fadeOutSec: number;

  constructor(options: AudioCppMusicProviderOptions) {
    this.#executablePath = resolve(options.executablePath ?? 'E:/AI/audio.cpp/release-0.6.1/audiocpp_cli.exe');
    this.#modelDirectory = resolve(options.modelDirectory ?? 'E:/AI/MiniMax-Music3-GGUF');
    this.#outputDirectory = resolve(required(options.outputDirectory, 'audio.cpp music output directory'));
    this.#backend = options.backend ?? 'cuda';
    this.#device = integerInRange(options.device ?? 0, 0, 32, 'audio.cpp device');
    this.#inferenceSteps = integerInRange(options.inferenceSteps ?? 30, 1, 200, 'audio.cpp inference steps');
    this.#timeoutMs = options.timeoutMs ?? 1_800_000;
    this.#processRunner = options.processRunner ?? runAudioCppProcess;
    this.#seedFactory = options.seedFactory ?? (() => randomInt(1, 2_147_483_647));
    this.#requiredModelFiles = options.requiredModelFiles ?? REQUIRED_MODEL_FILES;
    this.#instrumentalCondition = normalizeInstrumentalCondition(options.instrumentalCondition ?? '[Instrumental]');
    this.#generationDurationSec = options.generationDurationSec === undefined ? undefined : finiteInRange(options.generationDurationSec, 1, 300, 'audio.cpp generation duration');
    this.#fadeOutSec = finiteInRange(options.fadeOutSec ?? 1.5, 0, 30, 'audio.cpp fade-out duration');
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!existsSync(this.#executablePath)) {
      return { status: 'backend_offline', message: '没有找到E盘 audio.cpp 可执行文件。', checkedAt, details: { executablePath: this.#executablePath, modelDirectory: this.#modelDirectory } };
    }
    const missing: string[] = [];
    const sizeMismatch: string[] = [];
    for (const [relativePath, expectedSize] of this.#requiredModelFiles) {
      const filePath = resolve(this.#modelDirectory, relativePath);
      if (!existsSync(filePath)) missing.push(relativePath);
      else if (statSync(filePath).size !== expectedSize) sizeMismatch.push(relativePath);
    }
    if (missing.length || sizeMismatch.length) {
      return {
        status: 'model_missing',
        message: `MiniMax Music 3本机模型不完整：缺少${missing.length}项，大小不符${sizeMismatch.length}项。`,
        checkedAt,
        details: { executablePath: this.#executablePath, modelDirectory: this.#modelDirectory, missing, sizeMismatch },
      };
    }
    return {
      status: 'ok',
      message: '本机 audio.cpp 与 MiniMax Music 3 Q4/Q8/Q4 已就绪。',
      checkedAt,
      details: {
        executablePath: this.#executablePath,
        modelDirectory: this.#modelDirectory,
        backend: this.#backend,
        device: this.#device,
        precision: 'Q4/Q8/Q4',
        inferenceSteps: this.#inferenceSteps,
        memSaver: true,
        automaticRetry: false,
        generationDurationSec: this.#generationDurationSec,
        instrumentalCondition: this.#instrumentalCondition,
      },
    };
  }

  async submit(request: MusicGenerationRequest): Promise<GenerationTask> {
    validateRequest(request);
    const health = await this.health();
    if (health.status !== 'ok') throw new AudioCppMusicProviderError(health.message, { code: health.status, diagnostics: health.details });

    mkdirSync(this.#outputDirectory, { recursive: true });
    const startedAt = new Date().toISOString();
    const safeTaskId = safeFilePart(request.taskId);
    const outputPath = join(this.#outputDirectory, `${safeTaskId}.wav`);
    const generationDurationSec = Math.max(request.durationSec, this.#generationDurationSec ?? request.durationSec);
    const generatedOutputPath = generationDurationSec > request.durationSec ? join(this.#outputDirectory, `${safeTaskId}.raw.wav`) : outputPath;
    const logPath = join(this.#outputDirectory, `${safeTaskId}.audio-cpp.log`);
    const manifestPath = join(this.#outputDirectory, `${safeTaskId}.json`);
    if ([outputPath, generatedOutputPath, logPath, manifestPath].some(existsSync)) throw new AudioCppMusicProviderError('本机配乐任务文件已存在；系统没有覆盖或自动换名重试。', { code: 'output_exists' });

    const seed = integerInRange(request.seed ?? this.#seedFactory(), 0, 2_147_483_647, 'audio.cpp seed');
    const args = buildAudioCppMusicArgs({
      backend: this.#backend,
      device: this.#device,
      modelDirectory: this.#modelDirectory,
      prompt: request.prompt,
      durationSec: generationDurationSec,
      inferenceSteps: this.#inferenceSteps,
      seed,
      outputPath: generatedOutputPath,
      logPath,
      instrumentalCondition: this.#instrumentalCondition,
    });

    let cliResult: AudioCppProcessResult;
    try {
      cliResult = await this.#processRunner(this.#executablePath, args, { timeoutMs: this.#timeoutMs });
    } catch (error) {
      throw new AudioCppMusicProviderError(safeProcessMessage(error), { code: error instanceof AudioCppMusicProviderError ? error.code : 'generation_failed', diagnostics: { logPath, automaticRetry: false } });
    }
    if (!existsSync(generatedOutputPath) || statSync(generatedOutputPath).size < 44) throw new AudioCppMusicProviderError('audio.cpp退出后没有生成可读取的WAV文件。', { code: 'missing_output', diagnostics: { logPath } });

    const generatedProbeResult = await this.#processRunner('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate', '-show_entries', 'format=duration', '-of', 'json', '--', generatedOutputPath], { timeoutMs: 60_000 });
    const generatedProbe = parseAudioProbe(generatedProbeResult.stdout);
    if (generatedProbe.durationSec + 0.02 < request.durationSec) {
      const failedAt = new Date().toISOString();
      await this.#processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', generatedOutputPath, '-map', '0:a:0', '-f', 'null', '-'], { timeoutMs: 300_000 });
      const errorMessage = `本机模型只生成了${generatedProbe.durationSec.toFixed(3)}秒，短于目标${request.durationSec.toFixed(3)}秒；结果可试听，但不能标记完成或进入最终合成，也没有自动重试。`;
      const parameters = {
        engine: 'audio.cpp 0.6.1', family: 'minimax_music3', backend: this.#backend, device: this.#device,
        quantization: { languageModel: 'q4_0', rvqDepthDecoder: 'q8_0', flowTransformer: 'q4_0' }, memSaver: true,
        requestedDurationSec: request.durationSec, generationRequestedDurationSec: generationDurationSec, generatedDurationSec: generatedProbe.durationSec,
        actualDurationSec: generatedProbe.durationSec, sampleRate: generatedProbe.sampleRate, channels: generatedProbe.channels, codec: generatedProbe.codec,
        inferenceSteps: this.#inferenceSteps, seed, promptSha256: createHash('sha256').update(request.prompt).digest('hex'),
        instrumentalCondition: this.#instrumentalCondition, rawOutputPath: generatedOutputPath, fadeOutSec: 0, automaticRetry: false,
        fullDecodeVerified: true, logPath, manifestPath, cliExitCode: cliResult.code,
      };
      writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, status: 'failed', taskId: request.taskId, provider: this.id, sourceEntityIds: request.sourceEntityIds, createdAt: startedAt, failedAt, outputPath: generatedOutputPath, errorCode: 'duration_too_short', errorMessage, parameters }, null, 2), { encoding: 'utf8', flag: 'wx' });
      return {
        id: request.taskId, version: 1, createdAt: startedAt, updatedAt: failedAt, approval: 'draft', kind: 'music', provider: this.id,
        sourceEntityIds: [...request.sourceEntityIds], status: 'failed', parameters, outputPaths: [generatedOutputPath], externalTaskId: safeTaskId,
        errorCode: 'duration_too_short', errorMessage,
      };
    }

    let probe = generatedProbe;
    if (generatedOutputPath !== outputPath) {
      const fadeOutSec = Math.min(this.#fadeOutSec, request.durationSec);
      const fadeStartSec = Math.max(0, request.durationSec - fadeOutSec);
      const filter = [`atrim=duration=${request.durationSec}`, fadeOutSec > 0 ? `afade=t=out:st=${fadeStartSec}:d=${fadeOutSec}` : '', 'asetpts=N/SR/TB'].filter(Boolean).join(',');
      await this.#processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n', '-i', generatedOutputPath, '-map', '0:a:0', '-af', filter, '-c:a', 'pcm_s16le', outputPath], { timeoutMs: 300_000 });
      const finalProbeResult = await this.#processRunner('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate', '-show_entries', 'format=duration', '-of', 'json', '--', outputPath], { timeoutMs: 60_000 });
      probe = parseAudioProbe(finalProbeResult.stdout);
    }
    await this.#processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', outputPath, '-map', '0:a:0', '-f', 'null', '-'], { timeoutMs: 300_000 });

    const completedAt = new Date().toISOString();
    const parameters = {
      engine: 'audio.cpp 0.6.1',
      family: 'minimax_music3',
      backend: this.#backend,
      device: this.#device,
      quantization: { languageModel: 'q4_0', rvqDepthDecoder: 'q8_0', flowTransformer: 'q4_0' },
      memSaver: true,
      requestedDurationSec: request.durationSec,
      generationRequestedDurationSec: generationDurationSec,
      generatedDurationSec: generatedProbe.durationSec,
      actualDurationSec: probe.durationSec,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      codec: probe.codec,
      inferenceSteps: this.#inferenceSteps,
      seed,
      promptSha256: createHash('sha256').update(request.prompt).digest('hex'),
      instrumentalCondition: this.#instrumentalCondition,
      rawOutputPath: generatedOutputPath !== outputPath ? generatedOutputPath : undefined,
      fadeOutSec: generatedOutputPath !== outputPath ? Math.min(this.#fadeOutSec, request.durationSec) : 0,
      automaticRetry: false,
      fullDecodeVerified: true,
      logPath,
      manifestPath,
      cliExitCode: cliResult.code,
    };
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      taskId: request.taskId,
      provider: this.id,
      sourceEntityIds: request.sourceEntityIds,
      createdAt: startedAt,
      completedAt,
      outputPath,
      parameters,
      stdoutTail: cliResult.stdout.slice(-4_000),
      stderrTail: cliResult.stderr.slice(-4_000),
    }, null, 2), { encoding: 'utf8', flag: 'wx' });

    return {
      id: request.taskId,
      version: 1,
      createdAt: startedAt,
      updatedAt: completedAt,
      approval: 'draft',
      kind: 'music',
      provider: this.id,
      sourceEntityIds: [...request.sourceEntityIds],
      status: 'awaiting_review',
      parameters,
      outputPaths: [outputPath],
      externalTaskId: safeTaskId,
    };
  }
}

export function buildAudioCppMusicArgs(input: { backend: string; device: number; modelDirectory: string; prompt: string; durationSec: number; inferenceSteps: number; seed: number; outputPath: string; logPath: string; instrumentalCondition?: string }): string[] {
  return [
    '--backend', input.backend,
    '--device', String(input.device),
    '--task', 'gen',
    '--family', 'minimax_music3',
    '--model', input.modelDirectory,
    '--text', input.prompt,
    '--lyrics', normalizeInstrumentalCondition(input.instrumentalCondition ?? '[Instrumental]'),
    '--duration-seconds', String(input.durationSec),
    '--num-inference-steps', String(input.inferenceSteps),
    '--seed', String(input.seed),
    '--session-option', 'language_model_gguf=language_model_q4_0.gguf',
    '--session-option', 'rvq_depth_decoder_gguf=rvq_depth_decoder_q8_0.gguf',
    '--session-option', 'flow_transformer_gguf=transformer_q4_0.gguf',
    '--session-option', 'mem_saver=true',
    '--out', input.outputPath,
    '--log',
    '--log-file', input.logPath,
    '--metrics',
  ];
}

export async function runAudioCppProcess(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<AudioCppProcessResult> {
  return await new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectProcess(new AudioCppMusicProviderError(`audio.cpp运行超过${Math.round((options.timeoutMs ?? 1_800_000) / 1000)}秒，任务已停止且没有自动重试。`, { code: 'timeout' }));
    }, options.timeoutMs ?? 1_800_000);
    child.stdout.on('data', (chunk: Buffer) => { if (Buffer.concat(stdout).length < 2_000_000) stdout.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).length < 2_000_000) stderr.push(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectProcess(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = { code: Number(code), stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (code === 0) resolveProcess(result);
      else rejectProcess(new AudioCppMusicProviderError(`audio.cpp生成失败（退出码${code}）：${(result.stderr || result.stdout).slice(-1_200)}`, { code: `exit_${code}` }));
    });
  });
}

function parseAudioProbe(raw: string): { codec: string; sampleRate: number; channels: number; durationSec: number } {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { throw new AudioCppMusicProviderError('本机配乐的FFprobe结果无法读取。', { code: 'invalid_audio' }); }
  const streams = Array.isArray(parsed.streams) ? parsed.streams as Array<Record<string, unknown>> : [];
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const format = parsed.format && typeof parsed.format === 'object' ? parsed.format as Record<string, unknown> : {};
  const durationSec = Number(format.duration);
  const sampleRate = Number(audio?.sample_rate);
  const channels = Number(audio?.channels);
  if (!audio || !Number.isFinite(durationSec) || durationSec <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) throw new AudioCppMusicProviderError('本机配乐没有通过音频规格校验。', { code: 'invalid_audio' });
  return { codec: String(audio.codec_name || ''), sampleRate, channels, durationSec };
}

function validateRequest(request: MusicGenerationRequest): void {
  if (!request || typeof request !== 'object') throw new AudioCppMusicProviderError('Music request is required.', { code: 'invalid_request' });
  if (!request.taskId?.trim() || request.taskId.length > 240 || !Array.isArray(request.sourceEntityIds)) throw new AudioCppMusicProviderError('Music task identity is invalid.', { code: 'invalid_request' });
  if (!request.prompt?.trim() || request.prompt.length > 2000) throw new AudioCppMusicProviderError('Music prompt must contain 1 to 2000 characters.', { code: 'invalid_prompt' });
  if (!Number.isFinite(request.durationSec) || request.durationSec <= 0 || request.durationSec > 300) throw new AudioCppMusicProviderError('Music duration must be between 0 and 300 seconds.', { code: 'invalid_duration' });
  if (request.instrumental !== true) throw new AudioCppMusicProviderError('This workflow only allows instrumental music.', { code: 'vocals_not_allowed' });
}

function integerInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function finiteInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function normalizeInstrumentalCondition(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 24 || lines.some((line) => !/^\[(?:Intro|Instrumental|Solo|Outro)\]$/u.test(line))) {
    throw new Error('audio.cpp instrumental condition may contain only Intro, Instrumental, Solo, and Outro section tags.');
  }
  return lines.join('\n');
}
function safeFilePart(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 240); }
function required(value: string, label: string): string { if (!value?.trim()) throw new Error(`${label} is required.`); return value.trim(); }
function safeProcessMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1_500); }
