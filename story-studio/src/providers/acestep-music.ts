import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import type { GenerationTask } from '../domain/contracts.js';
import type { MusicGenerationRequest, MusicProvider, ProviderHealth } from './contracts.js';

const REQUIRED_FILES = [
  ['.venv/Scripts/python.exe', 1],
  ['checkpoints/acestep-v15-turbo/model.safetensors', 1_000_000_000],
  ['checkpoints/acestep-5Hz-lm-0.6B/model.safetensors', 500_000_000],
  ['checkpoints/Qwen3-Embedding-0.6B/model.safetensors', 500_000_000],
  ['checkpoints/vae/diffusion_pytorch_model.safetensors', 100_000_000],
] as const;

type FetchLike = typeof fetch;
export type AceStepProcessResult = { code: number; stdout: string; stderr: string };
export type AceStepProcessRunner = (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<AceStepProcessResult>;
export type AceStepServerLease = { owned: boolean; stop: () => Promise<void>; logs: () => string };

export interface AceStepMusicProviderOptions {
  projectDirectory?: string;
  outputDirectory: string;
  apiBaseUrl?: string;
  executablePath?: string;
  model?: string;
  lmModel?: string;
  lmBackend?: 'pt';
  overGenerateRatio?: number;
  fadeOutSec?: number;
  serverStartTimeoutMs?: number;
  generationTimeoutMs?: number;
  pollIntervalMs?: number;
  fetchFn?: FetchLike;
  processRunner?: AceStepProcessRunner;
  acquireServer?: () => Promise<AceStepServerLease>;
  sleep?: (milliseconds: number) => Promise<void>;
  seedFactory?: () => number;
  requiredFiles?: ReadonlyArray<readonly [string, number]>;
}

export class AceStepMusicProviderError extends Error {
  readonly code: string;
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(message: string, options: { code: string; diagnostics?: Record<string, unknown> }) {
    super(message);
    this.name = 'AceStepMusicProviderError';
    this.code = options.code;
    this.diagnostics = options.diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export class AceStepMusicProvider implements MusicProvider {
  readonly id = 'acestep-1.5';
  readonly #projectDirectory: string;
  readonly #outputDirectory: string;
  readonly #apiBaseUrl: string;
  readonly #executablePath: string;
  readonly #model: string;
  readonly #lmModel: string;
  readonly #lmBackend: 'pt';
  readonly #overGenerateRatio: number;
  readonly #fadeOutSec: number;
  readonly #serverStartTimeoutMs: number;
  readonly #generationTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #fetch: FetchLike;
  readonly #processRunner: AceStepProcessRunner;
  readonly #acquireServerOverride: (() => Promise<AceStepServerLease>) | undefined;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #seedFactory: () => number;
  readonly #requiredFiles: ReadonlyArray<readonly [string, number]>;

  constructor(options: AceStepMusicProviderOptions) {
    this.#projectDirectory = resolve(options.projectDirectory ?? 'E:/AI/ACE-Step-1.5');
    this.#outputDirectory = resolve(required(options.outputDirectory, 'ACE-Step music output directory'));
    this.#apiBaseUrl = (options.apiBaseUrl ?? 'http://127.0.0.1:8001').replace(/\/$/u, '');
    this.#executablePath = resolve(options.executablePath ?? join(this.#projectDirectory, '.venv/Scripts/python.exe'));
    this.#model = options.model ?? 'acestep-v15-turbo';
    this.#lmModel = options.lmModel ?? 'acestep-5Hz-lm-0.6B';
    this.#lmBackend = options.lmBackend ?? 'pt';
    this.#overGenerateRatio = finiteInRange(options.overGenerateRatio ?? 1.25, 1, 2, 'ACE-Step over-generation ratio');
    this.#fadeOutSec = finiteInRange(options.fadeOutSec ?? 1, 0, 10, 'ACE-Step fade-out duration');
    this.#serverStartTimeoutMs = options.serverStartTimeoutMs ?? 240_000;
    this.#generationTimeoutMs = options.generationTimeoutMs ?? 1_800_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#fetch = options.fetchFn ?? fetch;
    this.#processRunner = options.processRunner ?? runAceStepProcess;
    this.#acquireServerOverride = options.acquireServer;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
    this.#seedFactory = options.seedFactory ?? (() => randomInt(1, 2_147_483_647));
    this.#requiredFiles = options.requiredFiles ?? REQUIRED_FILES;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const missing: string[] = [];
    const tooSmall: string[] = [];
    for (const [relativePath, minimumSize] of this.#requiredFiles) {
      const filePath = resolve(this.#projectDirectory, relativePath);
      if (!existsSync(filePath)) missing.push(relativePath);
      else if (statSync(filePath).size < minimumSize) tooSmall.push(relativePath);
    }
    if (!existsSync(this.#executablePath) && !missing.includes('.venv/Scripts/python.exe')) missing.push('.venv/Scripts/python.exe');
    if (missing.length || tooSmall.length) {
      return {
        status: 'model_missing',
        message: `ACE-Step 1.5本机运行时不完整：缺少${missing.length}项，文件异常${tooSmall.length}项。`,
        checkedAt,
        details: { projectDirectory: this.#projectDirectory, executablePath: this.#executablePath, missing, tooSmall },
      };
    }
    const apiOnline = await this.#isApiOnline();
    return {
      status: 'ok',
      message: apiOnline ? 'ACE-Step 1.5本机模型与生成服务已就绪。' : 'ACE-Step 1.5本机模型已就绪；生成时会临时启动服务并在完成后释放显存。',
      checkedAt,
      details: {
        projectDirectory: this.#projectDirectory,
        model: this.#model,
        lmModel: this.#lmModel,
        lmBackend: this.#lmBackend,
        inferenceSteps: 8,
        overGenerateRatio: this.#overGenerateRatio,
        instrumentalMarker: '[Instrumental]',
        apiOnline,
        automaticRetry: false,
      },
    };
  }

  async submit(request: MusicGenerationRequest): Promise<GenerationTask> {
    validateRequest(request);
    const health = await this.health();
    if (health.status !== 'ok') throw new AceStepMusicProviderError(health.message, { code: health.status, ...(health.details ? { diagnostics: health.details } : {}) });

    mkdirSync(this.#outputDirectory, { recursive: true });
    const startedAt = new Date().toISOString();
    const safeTaskId = safeFilePart(request.taskId);
    const rawOutputPath = join(this.#outputDirectory, `${safeTaskId}.raw.wav`);
    const outputPath = join(this.#outputDirectory, `${safeTaskId}.wav`);
    const logPath = join(this.#outputDirectory, `${safeTaskId}.ace-step.log`);
    const manifestPath = join(this.#outputDirectory, `${safeTaskId}.json`);
    if ([rawOutputPath, outputPath, logPath, manifestPath].some(existsSync)) {
      throw new AceStepMusicProviderError('ACE-Step配乐任务文件已存在；系统没有覆盖或自动换名重试。', { code: 'output_exists' });
    }

    const seed = integerInRange(request.seed ?? this.#seedFactory(), 0, 2_147_483_647, 'ACE-Step seed');
    const inferenceSteps = integerInRange(request.inferenceSteps ?? 8, 1, 20, 'ACE-Step inference steps');
    const bpm = integerInRange(request.bpm ?? 84, 30, 300, 'ACE-Step BPM');
    const keyScale = required(request.keyScale ?? 'A Minor', 'ACE-Step key scale');
    const timeSignature = String(request.timeSignature ?? '4');
    if (!['2', '3', '4', '6'].includes(timeSignature)) throw new AceStepMusicProviderError('ACE-Step time signature must be 2, 3, 4, or 6.', { code: 'invalid_request' });
    const thinking = request.thinking !== false;
    const generationDurationSec = Math.min(480, Math.max(10, Math.ceil(request.durationSec * this.#overGenerateRatio)));
    if (generationDurationSec + 0.02 < request.durationSec) {
      throw new AceStepMusicProviderError('目标时长超过当前ACE-Step 0.6B LM的单次安全上限。', { code: 'duration_too_long' });
    }

    const lyrics = request.instrumental ? '[Instrumental]' : required(request.lyrics, 'ACE-Step lyrics');
    const vocalLanguage = request.instrumental ? 'unknown' : required(request.vocalLanguage ?? 'unknown', 'ACE-Step vocal language');
    const payload = {
      prompt: request.prompt,
      lyrics,
      instrumental: request.instrumental,
      vocal_language: vocalLanguage,
      thinking,
      model: this.#model,
      lm_model_path: this.#lmModel,
      lm_backend: this.#lmBackend,
      use_cot_caption: false,
      use_cot_language: false,
      constrained_decoding: true,
      bpm,
      key_scale: keyScale,
      time_signature: timeSignature,
      audio_duration: generationDurationSec,
      inference_steps: inferenceSteps,
      use_random_seed: false,
      seed,
      batch_size: 1,
      audio_format: 'wav',
      task_type: 'text2music',
    };

    let lease: AceStepServerLease | undefined;
    let externalTaskId = '';
    try {
      lease = await this.#acquireServer();
      const submitResponse = await this.#postJson('/release_task', payload);
      externalTaskId = stringAt(objectAt(submitResponse, 'data'), 'task_id');
      if (!externalTaskId) throw new AceStepMusicProviderError('ACE-Step没有返回任务ID。', { code: 'missing_task_id' });

      const result = await this.#waitForResult(externalTaskId);
      const audioUrl = stringAt(result, 'file');
      if (!audioUrl) throw new AceStepMusicProviderError('ACE-Step任务完成但没有返回音频地址。', { code: 'missing_audio' });
      const audioResponse = await this.#fetch(new URL(audioUrl, `${this.#apiBaseUrl}/`));
      if (!audioResponse.ok) throw new AceStepMusicProviderError(`ACE-Step音频下载失败（HTTP ${audioResponse.status}）。`, { code: 'audio_download_failed' });
      writeFileSync(rawOutputPath, Buffer.from(await audioResponse.arrayBuffer()), { flag: 'wx' });

      const rawProbe = await probeAudio(rawOutputPath, this.#processRunner);
      const trailing = await detectTrailingSilence(rawOutputPath, rawProbe.durationSec, this.#processRunner);
      const effectiveDurationSec = trailing?.startSec ?? rawProbe.durationSec;
      if (effectiveDurationSec + 0.02 < request.durationSec) {
        await decodeAudio(rawOutputPath, this.#processRunner);
        const failedAt = new Date().toISOString();
        const errorMessage = `ACE-Step文件为${rawProbe.durationSec.toFixed(3)}秒，但有效音乐约${effectiveDurationSec.toFixed(3)}秒，短于目标${request.durationSec.toFixed(3)}秒；结果可试听，系统没有自动重试。`;
        const parameters = buildParameters({ request, payload, seed, inferenceSteps, bpm, keyScale, timeSignature, thinking, generationDurationSec, rawProbe, effectiveDurationSec, rawOutputPath, manifestPath, logPath, externalTaskId, automaticRetry: false, fullDecodeVerified: true });
        writeFileSync(logPath, lease.logs(), { encoding: 'utf8', flag: 'wx' });
        writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, status: 'failed', taskId: request.taskId, provider: this.id, sourceEntityIds: request.sourceEntityIds, createdAt: startedAt, failedAt, outputPath: rawOutputPath, errorCode: 'duration_too_short', errorMessage, parameters }, null, 2), { encoding: 'utf8', flag: 'wx' });
        return { id: request.taskId, version: 1, createdAt: startedAt, updatedAt: failedAt, approval: 'draft', kind: 'music', provider: this.id, sourceEntityIds: [...request.sourceEntityIds], status: 'failed', parameters, outputPaths: [rawOutputPath], externalTaskId, errorCode: 'duration_too_short', errorMessage };
      }

      const fadeOutSec = Math.min(this.#fadeOutSec, request.durationSec);
      const fadeStartSec = Math.max(0, request.durationSec - fadeOutSec);
      const filter = [`atrim=duration=${request.durationSec}`, fadeOutSec > 0 ? `afade=t=out:st=${fadeStartSec}:d=${fadeOutSec}` : '', 'asetpts=N/SR/TB'].filter(Boolean).join(',');
      await this.#processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n', '-i', rawOutputPath, '-map', '0:a:0', '-af', filter, '-c:a', 'pcm_f32le', outputPath], { timeoutMs: 300_000 });
      const finalProbe = await probeAudio(outputPath, this.#processRunner);
      if (Math.abs(finalProbe.durationSec - request.durationSec) > 0.03) throw new AceStepMusicProviderError('ACE-Step裁切结果没有达到目标时长。', { code: 'invalid_trimmed_duration' });
      await decodeAudio(outputPath, this.#processRunner);

      const completedAt = new Date().toISOString();
      const parameters = buildParameters({ request, payload, seed, inferenceSteps, bpm, keyScale, timeSignature, thinking, generationDurationSec, rawProbe, effectiveDurationSec, finalProbe, rawOutputPath, manifestPath, logPath, externalTaskId, fadeOutSec, automaticRetry: false, fullDecodeVerified: true });
      writeFileSync(logPath, lease.logs(), { encoding: 'utf8', flag: 'wx' });
      writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, taskId: request.taskId, provider: this.id, sourceEntityIds: request.sourceEntityIds, createdAt: startedAt, completedAt, outputPath, parameters }, null, 2), { encoding: 'utf8', flag: 'wx' });
      return { id: request.taskId, version: 1, createdAt: startedAt, updatedAt: completedAt, approval: 'draft', kind: 'music', provider: this.id, sourceEntityIds: [...request.sourceEntityIds], status: 'awaiting_review', parameters, outputPaths: [outputPath], externalTaskId };
    } catch (error) {
      const wrapped = error instanceof AceStepMusicProviderError ? error : new AceStepMusicProviderError(error instanceof Error ? error.message : 'ACE-Step生成失败。', { code: 'generation_failed' });
      if (!existsSync(logPath)) writeFileSync(logPath, lease?.logs() || wrapped.message, { encoding: 'utf8', flag: 'wx' });
      if (!existsSync(manifestPath)) writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, status: 'failed', taskId: request.taskId, provider: this.id, sourceEntityIds: request.sourceEntityIds, createdAt: startedAt, failedAt: new Date().toISOString(), externalTaskId, errorCode: wrapped.code, errorMessage: wrapped.message, request: payload, automaticRetry: false }, null, 2), { encoding: 'utf8', flag: 'wx' });
      throw wrapped;
    } finally {
      await lease?.stop();
    }
  }

  async #waitForResult(taskId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + this.#generationTimeoutMs;
    while (Date.now() < deadline) {
      const response = await this.#postJson('/query_result', { task_id_list: [taskId] });
      const entries = arrayAt(response, 'data');
      const entry = entries.find((item) => stringAt(item, 'task_id') === taskId);
      const status = Number(entry?.status);
      if (status === 2) throw new AceStepMusicProviderError('ACE-Step任务返回失败；系统没有自动重试。', { code: 'upstream_failed', diagnostics: { taskId, progressText: entry?.progress_text } });
      if (status === 1) {
        const rawResult = stringAt(entry, 'result');
        let parsed: unknown;
        try { parsed = JSON.parse(rawResult); } catch { throw new AceStepMusicProviderError('ACE-Step结果JSON无法读取。', { code: 'invalid_result' }); }
        const result = Array.isArray(parsed) ? parsed[0] : undefined;
        if (!result || typeof result !== 'object') throw new AceStepMusicProviderError('ACE-Step结果为空。', { code: 'invalid_result' });
        return result as Record<string, unknown>;
      }
      await this.#sleep(this.#pollIntervalMs);
    }
    throw new AceStepMusicProviderError('ACE-Step生成超时，任务已保留且没有自动重试。', { code: 'timeout', diagnostics: { taskId } });
  }

  async #postJson(pathname: string, input: unknown): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`${this.#apiBaseUrl}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok || Number(body.code) !== 200) throw new AceStepMusicProviderError(stringAt(body, 'error') || `ACE-Step生成服务请求失败（HTTP ${response.status}）。`, { code: 'api_error', diagnostics: { pathname, status: response.status } });
    return body;
  }

  async #isApiOnline(): Promise<boolean> {
    try { return (await this.#fetch(`${this.#apiBaseUrl}/health`)).ok; } catch { return false; }
  }

  async #acquireServer(): Promise<AceStepServerLease> {
    if (this.#acquireServerOverride) return await this.#acquireServerOverride();
    if (await this.#isApiOnline()) return { owned: false, stop: async () => {}, logs: () => 'Reused an existing ACE-Step API process.' };
    return await startAceStepServer({ executablePath: this.#executablePath, projectDirectory: this.#projectDirectory, apiBaseUrl: this.#apiBaseUrl, lmModel: this.#lmModel, timeoutMs: this.#serverStartTimeoutMs, fetchFn: this.#fetch, sleep: this.#sleep });
  }
}

export async function startAceStepServer(input: { executablePath: string; projectDirectory: string; apiBaseUrl: string; lmModel: string; timeoutMs: number; fetchFn: FetchLike; sleep: (milliseconds: number) => Promise<void> }): Promise<AceStepServerLease> {
  const url = new URL(input.apiBaseUrl);
  const port = url.port || '8001';
  const cacheRoot = resolve(input.projectDirectory, '.cache');
  mkdirSync(resolve(cacheRoot, 'tmp'), { recursive: true });
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ACESTEP_PROJECT_ROOT: input.projectDirectory,
    ACESTEP_CHECKPOINTS_DIR: resolve(input.projectDirectory, 'checkpoints'),
    ACESTEP_CONFIG_PATH: 'acestep-v15-turbo',
    ACESTEP_NO_INIT: 'false',
    ACESTEP_INIT_LLM: 'true',
    ACESTEP_LM_MODEL_PATH: input.lmModel,
    ACESTEP_LM_BACKEND: 'pt',
    ACESTEP_OFFLOAD_TO_CPU: 'true',
    ACESTEP_OFFLOAD_DIT_TO_CPU: 'true',
    ACESTEP_LM_OFFLOAD_TO_CPU: 'true',
    ACESTEP_USE_FLASH_ATTENTION: 'false',
    ACESTEP_COMPILE_MODEL: 'false',
    ACESTEP_QUEUE_WORKERS: '1',
    ACESTEP_API_WORKERS: '1',
    ACESTEP_TMPDIR: resolve(cacheRoot, 'tmp'),
    HF_HOME: resolve(cacheRoot, 'huggingface'),
    MODELSCOPE_CACHE: resolve(cacheRoot, 'modelscope'),
  };
  const apiArguments = ['--host', url.hostname, '--port', port, '--download-source', 'modelscope', '--init-llm', '--lm-model-path', input.lmModel];
  const isPythonRuntime = /(?:^|[\\/])python(?:\.exe)?$/iu.test(input.executablePath);
  const child = spawn(input.executablePath, isPythonRuntime ? ['-m', 'acestep.api_server', ...apiArguments] : apiArguments, { cwd: input.projectDirectory, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  const collect = (chunk: Buffer) => { if (chunks.reduce((total, item) => total + item.length, 0) < 2_000_000) chunks.push(chunk); };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new AceStepMusicProviderError(`ACE-Step生成服务启动失败（退出码${child.exitCode}）。`, { code: 'backend_offline', diagnostics: { logs: Buffer.concat(chunks).toString('utf8').slice(-4_000) } });
    try {
      if ((await input.fetchFn(`${input.apiBaseUrl}/health`)).ok) {
        return { owned: true, stop: async () => stopChild(child), logs: () => Buffer.concat(chunks).toString('utf8') };
      }
    } catch { /* Keep waiting for the one startup attempt. */ }
    await input.sleep(1_000);
  }
  stopChild(child);
  throw new AceStepMusicProviderError('ACE-Step生成服务启动超时；没有提交音乐任务。', { code: 'backend_offline', diagnostics: { logs: Buffer.concat(chunks).toString('utf8').slice(-4_000) } });
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode === null && !child.killed) child.kill();
}

export async function runAceStepProcess(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<AceStepProcessResult> {
  return await new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectProcess(new AceStepMusicProviderError('本机音频校验超时。', { code: 'validation_timeout' }));
    }, options.timeoutMs ?? 300_000);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); rejectProcess(error); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = { code: Number(code), stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (code === 0) resolveProcess(result);
      else rejectProcess(new AceStepMusicProviderError(`${command}执行失败：${(result.stderr || result.stdout).slice(-1_200)}`, { code: `exit_${code}` }));
    });
  });
}

async function probeAudio(filePath: string, runner: AceStepProcessRunner): Promise<{ codec: string; sampleRate: number; channels: number; durationSec: number }> {
  const result = await runner('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate', '-show_entries', 'format=duration', '-of', 'json', '--', filePath], { timeoutMs: 60_000 });
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(result.stdout) as Record<string, unknown>; } catch { throw new AceStepMusicProviderError('ACE-Step音频FFprobe结果无法读取。', { code: 'invalid_audio' }); }
  const streams = Array.isArray(parsed.streams) ? parsed.streams as Array<Record<string, unknown>> : [];
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const format = parsed.format && typeof parsed.format === 'object' ? parsed.format as Record<string, unknown> : {};
  const durationSec = Number(format.duration);
  const sampleRate = Number(audio?.sample_rate);
  const channels = Number(audio?.channels);
  if (!audio || !(durationSec > 0) || !(sampleRate > 0) || !Number.isInteger(channels) || channels <= 0) throw new AceStepMusicProviderError('ACE-Step音频没有通过规格校验。', { code: 'invalid_audio' });
  return { codec: String(audio.codec_name || ''), sampleRate, channels, durationSec };
}

async function detectTrailingSilence(filePath: string, durationSec: number, runner: AceStepProcessRunner): Promise<{ startSec: number; durationSec: number } | undefined> {
  const result = await runner('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-i', filePath, '-af', 'silencedetect=noise=-50dB:d=0.5', '-f', 'null', '-'], { timeoutMs: 300_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  const starts = [...text.matchAll(/silence_start:\s*([0-9.]+)/gu)].map((match) => Number(match[1]));
  const ends = [...text.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/gu)].map((match) => ({ endSec: Number(match[1]), durationSec: Number(match[2]) }));
  const lastEnd = ends.at(-1);
  const lastStart = starts.at(-1);
  if (lastEnd && lastStart !== undefined && Math.abs(lastEnd.endSec - durationSec) <= 0.1) return { startSec: lastStart, durationSec: lastEnd.durationSec };
  return undefined;
}

async function decodeAudio(filePath: string, runner: AceStepProcessRunner): Promise<void> {
  await runner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', filePath, '-map', '0:a:0', '-f', 'null', '-'], { timeoutMs: 300_000 });
}

function buildParameters(input: Record<string, unknown>): Record<string, unknown> {
  const request = input.request as MusicGenerationRequest;
  const rawProbe = input.rawProbe as { codec: string; sampleRate: number; channels: number; durationSec: number };
  const finalProbe = input.finalProbe as { codec: string; sampleRate: number; channels: number; durationSec: number } | undefined;
  return {
    engine: 'ACE-Step 1.5', family: 'ace_step_1_5', model: (input.payload as Record<string, unknown>).model, lmModel: (input.payload as Record<string, unknown>).lm_model_path,
    lmBackend: (input.payload as Record<string, unknown>).lm_backend, requestedDurationSec: request.durationSec, generationRequestedDurationSec: input.generationDurationSec,
    generatedDurationSec: rawProbe.durationSec, effectiveDurationSec: input.effectiveDurationSec, actualDurationSec: finalProbe?.durationSec ?? rawProbe.durationSec,
    sampleRate: (finalProbe ?? rawProbe).sampleRate, channels: (finalProbe ?? rawProbe).channels, codec: (finalProbe ?? rawProbe).codec,
    inferenceSteps: input.inferenceSteps, seed: input.seed, bpm: input.bpm, keyScale: input.keyScale, timeSignature: input.timeSignature, thinking: input.thinking,
    promptSha256: createHash('sha256').update(request.prompt).digest('hex'), instrumentalCondition: '[Instrumental]', rawOutputPath: input.rawOutputPath,
    fadeOutSec: input.fadeOutSec ?? 0, automaticRetry: input.automaticRetry, fullDecodeVerified: input.fullDecodeVerified,
    manifestPath: input.manifestPath, logPath: input.logPath, externalTaskId: input.externalTaskId,
  };
}

function validateRequest(request: MusicGenerationRequest): void {
  if (!request || typeof request !== 'object' || !request.taskId?.trim() || !Array.isArray(request.sourceEntityIds)) throw new AceStepMusicProviderError('ACE-Step任务标识无效。', { code: 'invalid_request' });
  if (!request.prompt?.trim() || request.prompt.length > 2_000) throw new AceStepMusicProviderError('ACE-Step提示词必须为1至2000字符。', { code: 'invalid_prompt' });
  if (typeof request.instrumental !== 'boolean') throw new AceStepMusicProviderError('ACE-Step音乐类型无效。', { code: 'invalid_request' });
  if (!request.instrumental) {
    if (!request.lyrics?.trim() || request.lyrics.length > 4_096) throw new AceStepMusicProviderError('歌曲模式需要1至4096字符的歌词。', { code: 'invalid_lyrics' });
    if (request.vocalLanguage && !/^[a-z]{2,8}(?:-[A-Z]{2})?$/u.test(request.vocalLanguage)) throw new AceStepMusicProviderError('ACE-Step演唱语言代码无效。', { code: 'invalid_request' });
  }
  finiteInRange(request.durationSec, 1, 480, 'ACE-Step target duration');
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> { const item = value[key]; return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}; }
function arrayAt(value: Record<string, unknown>, key: string): Array<Record<string, unknown>> { const item = value[key]; return Array.isArray(item) ? item.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : []; }
function stringAt(value: Record<string, unknown> | undefined, key: string): string { return value && typeof value[key] === 'string' ? String(value[key]) : ''; }
function required(value: string, label: string): string { const normalized = String(value || '').trim(); if (!normalized) throw new AceStepMusicProviderError(`${label} is required.`, { code: 'invalid_config' }); return normalized; }
function safeFilePart(value: string): string { const safe = value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 180); if (!safe) throw new AceStepMusicProviderError('ACE-Step任务文件名无效。', { code: 'invalid_request' }); return safe; }
function integerInRange(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new AceStepMusicProviderError(`${label} must be an integer between ${minimum} and ${maximum}.`, { code: 'invalid_request' }); return value; }
function finiteInRange(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new AceStepMusicProviderError(`${label} must be between ${minimum} and ${maximum}.`, { code: 'invalid_request' }); return value; }
