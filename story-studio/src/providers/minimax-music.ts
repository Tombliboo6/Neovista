import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GenerationTask } from '../domain/contracts.js';
import type { MusicGenerationRequest, MusicProvider, ProviderHealth } from './contracts.js';

export interface MiniMaxMusicProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDirectory: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class MiniMaxMusicProviderError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(message: string, options: { status?: number; code?: string; diagnostics?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'MiniMaxMusicProviderError';
    this.status = options.status;
    this.code = options.code;
    this.diagnostics = options.diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export class MiniMaxMusicProvider implements MusicProvider {
  readonly id = 'minimax-music-3';
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #outputDirectory: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: MiniMaxMusicProviderOptions) {
    this.#apiKey = required(options.apiKey, 'MiniMax Music API key');
    this.#baseUrl = required(options.baseUrl, 'MiniMax Music API base URL').replace(/\/$/u, '');
    this.#model = required(options.model, 'MiniMax Music model');
    this.#outputDirectory = resolve(required(options.outputDirectory, 'MiniMax Music output directory'));
    this.#timeoutMs = options.timeoutMs ?? 360_000;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.#fetch(`${this.#baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        signal: AbortSignal.timeout(Math.min(this.#timeoutMs, 30_000)),
      });
      return { status: response.ok ? 'ok' : response.status === 401 || response.status === 403 ? 'auth_error' : response.status === 429 ? 'rate_limited' : 'down', message: response.ok ? 'MiniMax Music API is reachable.' : `MiniMax Music API health check failed with HTTP ${response.status}.`, checkedAt, details: { model: this.#model } };
    } catch (error) {
      return { status: 'backend_offline', message: safeMessage(error, this.#apiKey), checkedAt, details: { model: this.#model } };
    }
  }

  async submit(request: MusicGenerationRequest): Promise<GenerationTask> {
    validateRequest(request);
    const startedAt = new Date().toISOString();
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/music_generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.#model,
          prompt: request.prompt,
          stream: false,
          output_format: 'url',
          audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
          aigc_watermark: false,
          lyrics_optimizer: false,
          is_instrumental: true,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new MiniMaxMusicProviderError(safeMessage(error, this.#apiKey), { code: 'network_error' });
    }

    const body = parseJson(await response.text());
    const traceId = stringAt(body, 'trace_id') || response.headers.get('trace-id') || response.headers.get('x-request-id') || undefined;
    const baseResp = objectAt(body, 'base_resp');
    const upstreamCode = numberAt(baseResp, 'status_code');
    if (!response.ok || upstreamCode !== 0) {
      const message = stringAt(baseResp, 'status_msg') || `MiniMax Music API failed with HTTP ${response.status}.`;
      throw new MiniMaxMusicProviderError(redact(message, this.#apiKey), { status: response.status, code: upstreamCode === undefined ? `http_${response.status}` : String(upstreamCode), diagnostics: traceId ? { traceId } : undefined });
    }

    const data = objectAt(body, 'data');
    if (numberAt(data, 'status') !== 2) throw new MiniMaxMusicProviderError('MiniMax Music API did not return a completed result.', { status: response.status, code: 'music_not_completed', diagnostics: traceId ? { traceId } : undefined });
    const audioUrl = stringAt(data, 'audio');
    if (!audioUrl || !/^https:\/\//u.test(audioUrl)) throw new MiniMaxMusicProviderError('MiniMax Music API did not return a downloadable audio URL.', { status: response.status, code: 'missing_audio_url', diagnostics: traceId ? { traceId } : undefined });

    let audioResponse: Response;
    try {
      audioResponse = await this.#fetch(audioUrl, { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new MiniMaxMusicProviderError(safeMessage(error, this.#apiKey), { code: 'audio_download_error', diagnostics: traceId ? { traceId } : undefined });
    }
    if (!audioResponse.ok) throw new MiniMaxMusicProviderError(`MiniMax music download failed with HTTP ${audioResponse.status}.`, { status: audioResponse.status, code: 'audio_download_error', diagnostics: traceId ? { traceId } : undefined });
    const bytes = Buffer.from(await audioResponse.arrayBuffer());
    if (bytes.length < 256 || !looksLikeMp3(bytes)) throw new MiniMaxMusicProviderError('Downloaded MiniMax music is not a readable MP3 file.', { code: 'invalid_audio_bytes', diagnostics: { ...(traceId ? { traceId } : {}), byteLength: bytes.length } });

    await mkdir(this.#outputDirectory, { recursive: true });
    const outputPath = join(this.#outputDirectory, `${safeFilePart(request.taskId)}.mp3`);
    await writeFile(outputPath, bytes, { flag: 'wx' });
    const extraInfo = objectAt(body, 'extra_info');
    const completedAt = new Date().toISOString();
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
      parameters: {
        model: this.#model,
        requestedDurationSec: request.durationSec,
        instrumental: true,
        sampleRate: 44100,
        bitrate: 256000,
        format: 'mp3',
        musicDurationMs: numberAt(extraInfo, 'music_duration'),
        musicSampleRate: numberAt(extraInfo, 'music_sample_rate'),
        musicChannels: numberAt(extraInfo, 'music_channel'),
        musicSize: numberAt(extraInfo, 'music_size') ?? bytes.length,
        promptSha256: createHash('sha256').update(request.prompt).digest('hex'),
        automaticRetry: false,
        downloadedImmediately: true,
      },
      outputPaths: [outputPath],
      ...(traceId ? { externalTaskId: traceId } : {}),
    };
  }
}

function validateRequest(request: MusicGenerationRequest): void {
  if (!request || typeof request !== 'object') throw new MiniMaxMusicProviderError('Music request is required.', { code: 'invalid_request' });
  if (!request.taskId?.trim() || request.taskId.length > 240 || !Array.isArray(request.sourceEntityIds)) throw new MiniMaxMusicProviderError('Music task identity is invalid.', { code: 'invalid_request' });
  if (!request.prompt?.trim() || request.prompt.length > 2000) throw new MiniMaxMusicProviderError('Music prompt must contain 1 to 2000 characters.', { code: 'invalid_prompt' });
  if (!Number.isFinite(request.durationSec) || request.durationSec <= 0) throw new MiniMaxMusicProviderError('Music duration must be positive.', { code: 'invalid_duration' });
  if (request.instrumental !== true) throw new MiniMaxMusicProviderError('This workflow only allows instrumental music.', { code: 'vocals_not_allowed' });
}

function looksLikeMp3(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function parseJson(raw: string): Record<string, unknown> {
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function objectAt(value: unknown, key: string): Record<string, unknown> { const item = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}; }
function stringAt(value: unknown, key: string): string | undefined { const item = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; return typeof item === 'string' && item.trim() ? item : undefined; }
function numberAt(value: unknown, key: string): number | undefined { const item = value && typeof value === 'object' && !Array.isArray(value) ? Number((value as Record<string, unknown>)[key]) : NaN; return Number.isFinite(item) ? item : undefined; }
function safeFilePart(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 240); }
function required(value: string, label: string): string { if (!value?.trim()) throw new Error(`${label} is required.`); return value.trim(); }
function redact(value: string, secret: string): string { return secret ? value.split(secret).join('[REDACTED]') : value; }
function safeMessage(error: unknown, secret: string): string { return redact(error instanceof Error ? error.message : String(error), secret).slice(0, 800); }
