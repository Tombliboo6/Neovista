import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import type { GenerationTask } from '../domain/contracts.js';
import type { ProviderHealth, VideoGenerationRequest, VideoProvider } from './contracts.js';

export interface PrismH3Discovery {
  schemaVersion: 1;
  apiVersion: 1;
  baseUrl: string;
  token: string;
  pid: number;
  prismVersion: string;
  updatedAt: string;
}

export interface PrismH3ProviderOptions {
  discoveryPath?: string;
  fetchImpl?: typeof fetch;
}

export interface PrismH3RecoverableJob {
  externalTaskId: string;
  segmentKey?: string;
  status: 'queued' | 'running' | 'awaiting_review' | 'failed';
}

export interface PrismH3MemoryReleaseResult {
  status: 'released' | 'backend_offline';
}

export class PrismH3ProviderError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(message: string, options: { code: string; status?: number; diagnostics?: Record<string, unknown> }) {
    super(message);
    this.name = 'PrismH3ProviderError';
    this.code = options.code;
    this.status = options.status;
    this.diagnostics = options.diagnostics;
  }
}

export class PrismH3Provider implements VideoProvider {
  readonly id = 'prism-h3' as const;
  readonly #explicitDiscoveryPath: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: PrismH3ProviderOptions = {}) {
    this.#explicitDiscoveryPath = options.discoveryPath ? resolveDiscoveryPath(options.discoveryPath) : undefined;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    let discoveryPath = this.#currentDiscoveryPath();
    let discovery: PrismH3Discovery;
    try {
      discovery = await this.#readDiscovery(discoveryPath);
    } catch (error) {
      return {
        status: 'backend_offline',
        message: '尚未发现正在运行的 PRISM H3 控制台，请先启动 PRISM H3。',
        checkedAt,
        details: { discoveryPath, reason: error instanceof Error ? error.message : String(error) },
      };
    }
    try {
      let body: Record<string, any>;
      try {
        body = await this.#request('/api/integration/v1/status', discovery, {}, true);
      } catch (firstError) {
        const refreshedPath = this.#currentDiscoveryPath();
        const refreshed = await this.#readDiscovery(refreshedPath);
        if (refreshedPath === discoveryPath && refreshed.baseUrl === discovery.baseUrl && refreshed.token === discovery.token) throw firstError;
        discoveryPath = refreshedPath;
        discovery = refreshed;
        body = await this.#request('/api/integration/v1/status', discovery, {}, true);
      }
      if (body.online !== true) {
        return {
          status: 'backend_offline',
          message: 'PRISM H3 控制台已连接，但 ComfyUI 后端当前离线。',
          checkedAt,
          details: publicStatusDetails(discovery, body, discoveryPath),
        };
      }
      const capabilities = recordAt(body, 'capabilities');
      if (capabilities?.baseReady !== true) {
        const missing = Array.isArray(capabilities?.missing) ? capabilities.missing.join('、') : '';
        return { status: 'model_missing', message: missing ? `PRISM H3 缺少：${missing}` : 'PRISM H3 基础模型或节点未就绪。', checkedAt, details: publicStatusDetails(discovery, body, discoveryPath) };
      }
      return {
        status: Number(body.running || 0) + Number(body.pending || 0) > 0 ? 'queue_busy' : 'ok',
        message: Number(body.running || 0) + Number(body.pending || 0) > 0 ? 'PRISM H3 在线，当前队列已有任务。' : 'PRISM H3 在线且基础视频能力就绪。',
        checkedAt,
        details: publicStatusDetails(discovery, body, discoveryPath),
      };
    } catch (error) {
      return { status: 'backend_offline', message: safeProviderMessage(error), checkedAt, details: { discoveryPath, prismVersion: discovery.prismVersion } };
    }
  }

  async presets(): Promise<Record<string, unknown>> {
    const discovery = await this.#readDiscovery();
    return this.#request('/api/integration/v1/presets', discovery);
  }

  async releaseMemoryIfIdle(): Promise<PrismH3MemoryReleaseResult> {
    let discovery: PrismH3Discovery;
    try {
      discovery = await this.#readDiscovery();
    } catch {
      return { status: 'backend_offline' };
    }
    const status = await this.#request('/api/integration/v1/status', discovery, {}, true);
    if (status.online !== true) return { status: 'backend_offline' };
    if (Number(status.running || 0) + Number(status.pending || 0) > 0) {
      throw new PrismH3ProviderError('PRISM H3当前仍有视频任务，不能释放模型显存。', { code: 'queue_busy' });
    }
    await this.#request('/api/integration/v1/actions', discovery, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'free-memory' }),
    });
    return { status: 'released' };
  }

  async recoverableJobs(): Promise<PrismH3RecoverableJob[]> {
    const discovery = await this.#readDiscovery();
    const status = await this.#request('/api/integration/v1/status', discovery);
    const history = await this.#request('/api/integration/v1/history', discovery);
    const jobs = new Map<string, PrismH3RecoverableJob>();
    const addActive = (value: unknown, jobStatus: 'queued' | 'running') => {
      const record = recordAt(value);
      const promptId = typeof record?.promptId === 'string' ? record.promptId : '';
      if (!promptId) return;
      const title = typeof record?.title === 'string' ? record.title : '';
      jobs.set(promptId, { externalTaskId: promptId, segmentKey: segmentKeyFromText(title), status: jobStatus });
    };
    for (const item of Array.isArray(status.runningJobs) ? status.runningJobs : []) addActive(item, 'running');
    for (const item of Array.isArray(status.pendingJobs) ? status.pendingJobs : []) addActive(item, 'queued');
    if (typeof status.runningPromptId === 'string' && status.runningPromptId && !jobs.has(status.runningPromptId)) jobs.set(status.runningPromptId, { externalTaskId: status.runningPromptId, status: 'running' });
    for (const promptId of Array.isArray(status.pendingPromptIds) ? status.pendingPromptIds : []) if (typeof promptId === 'string' && promptId && !jobs.has(promptId)) jobs.set(promptId, { externalTaskId: promptId, status: 'queued' });
    for (const item of Array.isArray(history.items) ? history.items : []) {
      const record = recordAt(item);
      const promptId = typeof record?.promptId === 'string' ? record.promptId : '';
      if (!promptId || jobs.has(promptId)) continue;
      const filename = typeof record?.filename === 'string' ? record.filename : '';
      const failed = typeof record?.error === 'string' && Boolean(record.error);
      const completed = record?.completed === true && Boolean(filename);
      if (!failed && !completed) continue;
      jobs.set(promptId, { externalTaskId: promptId, segmentKey: segmentKeyFromText(filename), status: completed ? 'awaiting_review' : 'failed' });
    }
    return [...jobs.values()];
  }

  async submit(request: VideoGenerationRequest): Promise<GenerationTask> {
    validateVideoRequest(request);
    const discovery = await this.#readDiscovery();
    const mediaReferences = request.referenceMedia?.length
      ? request.referenceMedia
      : request.referenceMediaPaths.map((path, index) => ({ path, kind: 'image' as const, label: request.referenceLabels?.[index] }));
    const storedMedia = [] as Array<{ stored: string; kind: 'image' | 'video' | 'audio'; label?: string; frames?: number; useAudio?: boolean }>;
    for (const reference of mediaReferences) storedMedia.push({ ...reference, stored: await this.#uploadMedia(discovery, reference.path, reference.kind) });
    const storedImages = storedMedia.filter((item) => item.kind === 'image');
    const storedVideos = storedMedia.filter((item) => item.kind === 'video');
    const storedAudios = storedMedia.filter((item) => item.kind === 'audio');
    const mode = request.mode ?? (storedMedia.length ? 'reference' : 'text');
    const referenceTags = [
      ...storedImages.map((item, index) => `<Picture ${index + 1}>${item.label ? `：${item.label}` : ''}`),
      ...storedVideos.map((item, index) => `<Video ${index + 1}>${item.label ? `：${item.label}` : ''}`),
      ...storedAudios.map((item, index) => `<Audio ${index + 1}>${item.label ? `：${item.label}` : ''}`),
    ];
    const referencePrompt = mode === 'reference' && referenceTags.length
      ? `${referenceTags.join('；')}\n${request.prompt}`
      : request.prompt;
    const payload = {
      mode,
      prompt: referencePrompt,
      resolution: request.resolution ?? '480p',
      customWidth: request.resolution === 'custom' ? request.width : undefined,
      customHeight: request.resolution === 'custom' ? request.height : undefined,
      aspectRatio: request.aspectRatio ?? '16:9',
      frameFit: request.frameFit ?? 'cover',
      seconds: request.durationSec,
      steps: request.inferenceSteps,
      seed: request.seed ?? 0,
      sage: request.sage ?? true,
      spectrum: request.spectrum ?? false,
      accelerationModel: request.accelerationModel ?? 'none',
      turboLowVram: request.turboLowVram ?? false,
      secondPass: request.secondPass ?? false,
      rtxUpscale: request.rtxUpscale ?? false,
      rtxUpscaleScale: request.rtxUpscaleScale,
      rtxUpscaleQuality: request.rtxUpscaleQuality,
      cropDelivery: request.cropDelivery ?? false,
      title: request.title || request.taskId,
      confirmRisk: request.confirmRisk ?? true,
      ...(request.continuity ? {
        motionContext: {
          chainId: request.continuity.chainId,
          segmentIndex: request.continuity.segmentIndex,
          segmentCount: request.continuity.segmentCount,
        },
      } : {}),
      ...(mode === 'first' ? { firstFrame: storedImages[0]?.stored } : {}),
      ...(mode === 'first-last' ? { firstFrame: storedImages[0]?.stored, lastFrame: storedImages[1]?.stored } : {}),
      ...(mode === 'reference' ? {
        referenceImages: storedImages.map((item) => item.stored),
        referenceVideos: storedVideos.map((item) => ({ file: item.stored, frames: item.frames, useAudio: item.useAudio === true })),
        referenceAudios: storedAudios.map((item) => item.stored),
      } : {}),
    };
    const body = await this.#request('/api/integration/v1/generate', discovery, { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
    const promptId = requiredResponseString(body.promptId, 'PRISM H3未返回prompt ID');
    const timestamp = new Date().toISOString();
    return {
      id: request.taskId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      approval: 'draft',
      kind: 'video',
      provider: this.id,
      sourceEntityIds: [...request.sourceEntityIds],
      status: 'queued',
      parameters: {
        ...payload,
        prompt: request.prompt,
        compiledPrompt: referencePrompt,
        referenceAssetIds: [...request.referenceAssetIds],
        referenceAssetVersions: { ...request.referenceAssetVersions },
        referenceMediaPaths: [...request.referenceMediaPaths],
        referenceMedia: mediaReferences.map((item) => ({ ...item })),
        storedReferences: storedMedia.map((item) => ({ ...item })),
        continuity: request.continuity ? { ...request.continuity } : undefined,
        prismVersion: discovery.prismVersion,
        bridgeApiVersion: discovery.apiVersion,
        frames: body.frames,
        sampledFrames: body.sampledFrames,
        actualSeconds: body.actualSeconds,
        automaticRetry: false,
      },
      outputPaths: [],
      externalTaskId: promptId,
    };
  }

  async status(externalTaskId: string): Promise<GenerationTask> {
    if (!externalTaskId.trim()) throw new PrismH3ProviderError('缺少PRISM H3任务编号。', { code: 'missing_prompt_id' });
    const discovery = await this.#readDiscovery();
    const status = await this.#request('/api/integration/v1/status', discovery);
    const runningIds = [status.runningPromptId, ...(Array.isArray(status.runningJobs) ? status.runningJobs.map((item) => recordAt(item)?.promptId) : [])].filter(Boolean);
    const pendingIds = Array.isArray(status.pendingPromptIds) ? status.pendingPromptIds : [];
    if (runningIds.includes(externalTaskId)) return taskSnapshot(externalTaskId, 'running');
    if (pendingIds.includes(externalTaskId)) return taskSnapshot(externalTaskId, 'queued');
    const history = await this.#request('/api/integration/v1/history', discovery);
    const item = Array.isArray(history.items) ? history.items.find((candidate) => recordAt(candidate)?.promptId === externalTaskId) : undefined;
    if (!item || typeof item !== 'object') throw new PrismH3ProviderError('PRISM H3历史中未找到该任务。', { code: 'task_not_found', diagnostics: { externalTaskId } });
    const value = item as Record<string, unknown>;
    const completed = value.completed === true && typeof value.filename === 'string' && value.filename;
    const failed = typeof value.error === 'string' && value.error;
    const task = taskSnapshot(externalTaskId, completed ? 'awaiting_review' : failed ? 'failed' : 'running');
    task.parameters = { ...value, prismVersion: discovery.prismVersion, automaticRetry: false };
    if (completed) task.outputPaths = [resolve(String(value.outputDirectory || ''), String(value.subfolder || ''), String(value.filename))];
    if (failed) {
      task.errorCode = 'generation_failed';
      task.errorMessage = String(value.error);
    }
    return task;
  }

  async cancel(externalTaskId: string): Promise<void> {
    const discovery = await this.#readDiscovery();
    const status = await this.#request('/api/integration/v1/status', discovery);
    const running = status.runningPromptId === externalTaskId || (Array.isArray(status.runningJobs) && status.runningJobs.some((item) => recordAt(item)?.promptId === externalTaskId));
    const pending = Array.isArray(status.pendingPromptIds) && status.pendingPromptIds.includes(externalTaskId);
    if (!running && !pending) throw new PrismH3ProviderError('该任务已不在PRISM H3队列中，请刷新状态。', { code: 'task_not_active' });
    await this.#request('/api/integration/v1/actions', discovery, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: running ? 'cancel-running' : 'cancel-pending', promptId: externalTaskId }),
    });
  }

  async media(externalTaskId: string, range?: string): Promise<Response> {
    const discovery = await this.#readDiscovery();
    const history = await this.#request('/api/integration/v1/history', discovery);
    const item = Array.isArray(history.items) ? history.items.find((candidate) => recordAt(candidate)?.promptId === externalTaskId) : undefined;
    const value = recordAt(item);
    if (!value?.filename) throw new PrismH3ProviderError('该任务还没有可播放的视频结果。', { code: 'media_not_ready' });
    const query = new URLSearchParams({ filename: String(value.filename), subfolder: String(value.subfolder || ''), type: String(value.type || 'output') });
    if (value.outputDirectory) query.set('root', String(value.outputDirectory));
    const headers = new Headers({ authorization: `Bearer ${discovery.token}` });
    if (range) headers.set('range', range);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await this.#fetch(`${discovery.baseUrl}/api/integration/v1/media?${query.toString()}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new PrismH3ProviderError(`PRISM H3媒体代理返回HTTP ${response.status}。`, { code: 'media_proxy_failed', status: response.status });
    return response;
  }

  async #uploadMedia(discovery: PrismH3Discovery, mediaPath: string, kind: 'image' | 'video' | 'audio'): Promise<string> {
    if (!isAbsolute(mediaPath)) throw new PrismH3ProviderError('PRISM H3参考媒体必须使用绝对路径。', { code: 'invalid_reference_path' });
    const bytes = await readFile(mediaPath);
    const form = new FormData();
    form.append('file', new File([bytes], basename(mediaPath), { type: mimeFor(mediaPath) }));
    form.append('kind', kind);
    const body = await this.#request('/api/integration/v1/upload', discovery, { method: 'POST', body: form });
    return requiredResponseString(body.stored, 'PRISM H3未返回上传后的参考媒体位置');
  }

  #currentDiscoveryPath() {
    return resolveDiscoveryPath(this.#explicitDiscoveryPath);
  }

  async #readDiscovery(discoveryPath = this.#currentDiscoveryPath()): Promise<PrismH3Discovery> {
    const raw = JSON.parse(await readFile(discoveryPath, 'utf8')) as Partial<PrismH3Discovery>;
    if (raw.schemaVersion !== 1 || raw.apiVersion !== 1 || typeof raw.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(raw.baseUrl) || typeof raw.token !== 'string' || raw.token.length < 32 || !Number.isInteger(raw.pid)) {
      throw new PrismH3ProviderError('PRISM H3桥接发现文件无效。', { code: 'invalid_discovery' });
    }
    return raw as PrismH3Discovery;
  }

  async #request(pathname: string, discovery: PrismH3Discovery, init: RequestInit = {}, acceptOfflineStatus = false): Promise<Record<string, any>> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${discovery.token}`);
      response = await this.#fetch(`${discovery.baseUrl}${pathname}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new PrismH3ProviderError('无法连接正在运行的PRISM H3控制台。', { code: 'bridge_offline', diagnostics: { reason: error instanceof Error ? error.message : String(error) } });
    }
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || (body.ok === false && !acceptOfflineStatus)) {
      throw new PrismH3ProviderError(String(body.error || `PRISM H3桥接返回HTTP ${response.status}`), {
        code: body.riskConfirmationRequired ? 'risk_confirmation_required' : response.status === 401 ? 'bridge_unauthorized' : 'bridge_request_failed',
        status: response.status,
        diagnostics: body.riskConfirmationRequired ? { riskConfirmationRequired: true } : undefined,
      });
    }
    return body;
  }
}

function resolveDiscoveryPath(explicit?: string) {
  const configured = explicit || process.env.PRISM_H3_BRIDGE_DISCOVERY_PATH;
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('PRISM_H3_BRIDGE_DISCOVERY_PATH must be absolute.');
    return resolve(configured);
  }
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'PRISM H3 控制台', 'integration', 'integration-bridge.json') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'PRISM H3 控制台', 'integration', 'integration-bridge.json') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'PRISM H3 控制台', 'integration', 'integration-bridge.json') : '',
    ...['C:', 'D:', 'E:'].flatMap((drive) => [
      `${drive}/Apps/PRISM H3 控制台/integration/integration-bridge.json`,
      `${drive}/PRISM/PRISM H3 控制台/integration/integration-bridge.json`,
    ]),
  ].filter(Boolean).map((candidate) => resolve(candidate));
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0] || resolve('integration-bridge.json');
}

function validateVideoRequest(request: VideoGenerationRequest) {
  if (!request.taskId?.trim() || !request.prompt?.trim()) throw new PrismH3ProviderError('视频任务ID和提示词不能为空。', { code: 'invalid_request' });
  if (!Number.isInteger(request.durationSec) || request.durationSec < 1 || request.durationSec > 15) throw new PrismH3ProviderError('视频时长必须是1至15秒整数。', { code: 'invalid_duration' });
  if (!Number.isInteger(request.inferenceSteps) || request.inferenceSteps < 4 || request.inferenceSteps > 30) throw new PrismH3ProviderError('采样步数必须是4至30的整数。', { code: 'invalid_steps' });
  const mediaReferences = request.referenceMedia?.length
    ? request.referenceMedia
    : request.referenceMediaPaths.map((path) => ({ path, kind: 'image' as const }));
  const images = mediaReferences.filter((item) => item.kind === 'image');
  const videos = mediaReferences.filter((item) => item.kind === 'video');
  const audios = mediaReferences.filter((item) => item.kind === 'audio');
  if (images.length > 9 || videos.length > 3 || audios.length > 3) throw new PrismH3ProviderError('全能参考最多支持9张图片、3段视频和3段独立音频。', { code: 'invalid_references' });
  if (videos.some((item) => !Number.isInteger(item.frames) || Number(item.frames) < 48 || Number(item.frames) > 360)) throw new PrismH3ProviderError('参考视频帧数必须是48至360帧。', { code: 'invalid_references' });
  if (request.mode === 'first' && (mediaReferences.length !== 1 || images.length !== 1)) throw new PrismH3ProviderError('首帧模式必须恰好提供一张参考图。', { code: 'invalid_references' });
  if (request.mode === 'first-last' && (mediaReferences.length !== 2 || images.length !== 2)) throw new PrismH3ProviderError('首尾帧模式必须恰好提供两张参考图。', { code: 'invalid_references' });
  if (request.mode === 'reference' && mediaReferences.length < 1) throw new PrismH3ProviderError('全能参考模式至少需要一项图片、视频或音频参考。', { code: 'invalid_references' });
  if (request.continuity) {
    if (request.continuity.engine !== 'herrgotts' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(request.continuity.chainId)) throw new PrismH3ProviderError('Herrgotts续接链编号无效。', { code: 'invalid_continuity' });
    if (!Number.isInteger(request.continuity.segmentCount) || request.continuity.segmentCount < 2 || request.continuity.segmentCount > 8) throw new PrismH3ProviderError('Herrgotts续接链必须包含2至8段。', { code: 'invalid_continuity' });
    if (!Number.isInteger(request.continuity.segmentIndex) || request.continuity.segmentIndex < 1 || request.continuity.segmentIndex > request.continuity.segmentCount) throw new PrismH3ProviderError('Herrgotts续接段序号无效。', { code: 'invalid_continuity' });
    if (request.continuity.segmentIndex > 1 && !request.continuity.sourceSegmentId) throw new PrismH3ProviderError('Herrgotts续接段必须绑定明确的来源分镜。', { code: 'invalid_continuity' });
  }
}

function taskSnapshot(externalTaskId: string, status: GenerationTask['status']): GenerationTask {
  const timestamp = new Date().toISOString();
  return { id: `h3-${externalTaskId}`, version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'draft', kind: 'video', provider: 'prism-h3', sourceEntityIds: [], status, parameters: {}, outputPaths: [], externalTaskId };
}

function publicStatusDetails(discovery: PrismH3Discovery, body: Record<string, any>, discoveryPath: string) {
  return { discoveryPath, prismVersion: discovery.prismVersion, bridgeApiVersion: discovery.apiVersion, runtimeProfile: body.runtimeProfile, device: body.device, vramTotal: body.vramTotal, vramFree: body.vramFree, running: body.running, pending: body.pending, capabilities: body.capabilities, backendError: body.error };
}

function recordAt(value: unknown, key?: string): Record<string, any> | undefined {
  const candidate = key ? (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined) : value;
  return candidate && typeof candidate === 'object' ? candidate as Record<string, any> : undefined;
}

function segmentKeyFromText(value: string) {
  return value.match(/(?:^|_)(SEG\d{3})(?:\b|_)/iu)?.[1]?.toUpperCase();
}

function requiredResponseString(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) throw new PrismH3ProviderError(message, { code: 'invalid_bridge_response' });
  return value;
}

function safeProviderMessage(error: unknown) {
  return error instanceof PrismH3ProviderError ? error.message : 'PRISM H3桥接当前不可访问。';
}

function mimeFor(mediaPath: string) {
  const extension = extname(mediaPath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.flac') return 'audio/flac';
  return 'image/jpeg';
}
