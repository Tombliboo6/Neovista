import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import type { GenerationTask } from '../domain/contracts.js';
import type {
  ImageGenerationRequest,
  ImageProvider,
  ProviderHealth,
  ProviderHealthStatus
} from './contracts.js';

export interface OpenAIImagesProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDirectory: string;
  timeoutMs?: number;
  referenceEditMode?: 'disabled' | 'probe' | 'verified';
  maxReferenceImages?: number;
}

export interface OpenAIImagesErrorDiagnostics {
  requestId?: string;
  returnedImageCount?: number;
  responseKeys?: string[];
  outputPaths?: string[];
  phase?: 'generation_request' | 'generation_response' | 'image_download';
  elapsedMs?: number;
  timeoutMs?: number;
  transportCode?: string;
  transportMessage?: string;
}

const VOLCENGINE_SEEDREAM_5_PRO_MODEL = /^doubao-seedream-5-0-pro(?:-|$)/iu;
const VOLCENGINE_SEEDREAM_5_PRO_MAX_REFERENCES = 10;
const VOLCENGINE_SEEDREAM_OTHER_MAX_REFERENCES = 14;
const VOLCENGINE_SEEDREAM_5_PRO_MIN_PIXELS = 1280 * 720;
const VOLCENGINE_SEEDREAM_5_PRO_MAX_PIXELS = Math.floor(2048 * 2048 * 1.1025);

export class OpenAIImagesProviderError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly diagnostics: OpenAIImagesErrorDiagnostics | undefined;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      diagnostics?: OpenAIImagesErrorDiagnostics;
    } = {}
  ) {
    super(message);
    this.name = 'OpenAIImagesProviderError';
    this.status = options.status;
    this.code = options.code;
    this.diagnostics = options.diagnostics;
    Object.defineProperty(this, 'diagnostics', { enumerable: false });
  }
}

export class OpenAIImagesProvider implements ImageProvider {
  readonly id = 'openai-images';

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #outputDirectory: string;
  readonly #timeoutMs: number;
  readonly #referenceEditMode: 'disabled' | 'probe' | 'verified';
  readonly #maxReferenceImages?: number;

  constructor(options: OpenAIImagesProviderOptions) {
    this.#apiKey = required(options.apiKey, 'Images API key');
    this.#baseUrl = required(options.baseUrl, 'Images API base URL').replace(/\/$/, '');
    this.#model = required(options.model, 'Images API model');
    this.#outputDirectory = resolve(required(options.outputDirectory, 'Images output directory'));
    this.#timeoutMs = options.timeoutMs ?? 300_000;
    this.#referenceEditMode = options.referenceEditMode ?? 'disabled';
    this.#maxReferenceImages = options.maxReferenceImages;
    if (this.#maxReferenceImages !== undefined && (!Number.isInteger(this.#maxReferenceImages) || this.#maxReferenceImages < 1)) {
      throw new Error('Images maximum reference count must be a positive integer.');
    }
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    overrides: Partial<
      Pick<OpenAIImagesProviderOptions, 'timeoutMs' | 'referenceEditMode' | 'maxReferenceImages'>
    > = {}
  ): OpenAIImagesProvider {
    return new OpenAIImagesProvider({
      apiKey: environment.IMAGE_API_KEY ?? '',
      baseUrl: environment.IMAGE_API_BASE_URL ?? 'https://api.openai.com/v1',
      model: environment.IMAGE_API_MODEL ?? '',
      outputDirectory:
        environment.IMAGE_API_OUTPUT_DIR ?? './runtime-data/generated-images',
      ...overrides
    });
  }

  static fromEditEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    overrides: Partial<
      Pick<OpenAIImagesProviderOptions, 'timeoutMs' | 'referenceEditMode' | 'maxReferenceImages'>
    > = {}
  ): OpenAIImagesProvider {
    return new OpenAIImagesProvider({
      apiKey: environment.IMAGE_EDIT_API_KEY ?? '',
      baseUrl: environment.IMAGE_EDIT_API_BASE_URL ?? '',
      model: environment.IMAGE_EDIT_API_MODEL ?? '',
      outputDirectory:
        environment.IMAGE_API_OUTPUT_DIR ?? './runtime-data/generated-images',
      ...overrides
    });
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(
        `${this.#baseUrl}/models/${encodeURIComponent(this.#model)}`,
        {
          headers: { Authorization: `Bearer ${this.#apiKey}` },
          signal: AbortSignal.timeout(Math.min(this.#timeoutMs, 30_000))
        }
      );
      if (response.ok) {
        return {
          status: 'ok',
          message: `Image model ${this.#model} is reachable.`,
          checkedAt,
          details: { model: this.#model }
        };
      }
      return {
        status: healthStatusFor(response.status),
        message: `Image model health check failed with HTTP ${response.status}.`,
        checkedAt,
        details: { model: this.#model, httpStatus: response.status }
      };
    } catch (error) {
      return {
        status: 'backend_offline',
        message: safeErrorMessage(error, this.#apiKey),
        checkedAt,
        details: { model: this.#model }
      };
    }
  }

  async submit(request: ImageGenerationRequest): Promise<GenerationTask> {
    validateRequest(request);
    const isReferenceEdit = request.referenceMediaPaths.length > 0;
    const apiYiReverseProtocol = isApiYiReverseImageModel(this.#baseUrl, this.#model);
    const volcengineSeedreamProtocol = isVolcengineSeedreamModel(this.#baseUrl, this.#model);
    if (isReferenceEdit && this.#referenceEditMode === 'disabled') {
      throw new OpenAIImagesProviderError(
        'Reference-image editing is not enabled until the relay edit endpoint is verified.',
        { code: 'image_edit_not_verified' }
      );
    }
    if (isReferenceEdit && this.#maxReferenceImages !== undefined && request.referenceMediaPaths.length > this.#maxReferenceImages) {
      throw new OpenAIImagesProviderError(
        `This controlled reference-edit path allows at most ${this.#maxReferenceImages} reference image(s).`,
        { code: 'invalid_reference_count' }
      );
    }
    if (volcengineSeedreamProtocol) validateVolcengineSeedreamRequest(request, this.#model);

    const startedAt = new Date().toISOString();
    const requestStarted = Date.now();
    const requestSignal = AbortSignal.timeout(this.#timeoutMs);
    let response: Response;
    try {
      response = volcengineSeedreamProtocol
        ? await fetch(`${this.#baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.#apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(await createVolcengineSeedreamBody(request, this.#model)),
            signal: requestSignal
          })
        : isReferenceEdit
        ? await fetch(`${this.#baseUrl}/images/edits`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.#apiKey}` },
            body: await createEditFormData(request, this.#model, this.#baseUrl),
            signal: requestSignal
          })
        : await fetch(`${this.#baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.#apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: this.#model,
              prompt: request.prompt,
              n: request.count,
              size: `${request.width}x${request.height}`,
              quality: request.quality ?? 'high',
              output_format: request.outputFormat ?? 'png'
            }),
            signal: requestSignal
          });
    } catch (error) {
      if (error instanceof OpenAIImagesProviderError) throw error;
      throw imageTransportError(error, this.#apiKey, 'generation_request', requestStarted, this.#timeoutMs, requestSignal);
    }

    let rawBody: string;
    try { rawBody = await response.text(); }
    catch (error) {
      throw imageTransportError(error, this.#apiKey, 'generation_response', requestStarted, this.#timeoutMs, requestSignal, response);
    }
    const body = parseJsonObject(rawBody);
    const requestId =
      response.headers.get('x-request-id') ??
      response.headers.get('x-tt-logid') ??
      stringAt(body, 'id');

    if (!response.ok) {
      const upstreamError = objectAt(body, 'error');
      const message =
        stringAt(upstreamError, 'message') ??
        `Images API failed with HTTP ${response.status}.`;
      throw new OpenAIImagesProviderError(redact(message, this.#apiKey), {
        status: response.status,
        code: stringAt(upstreamError, 'code') ?? stringAt(upstreamError, 'type'),
        diagnostics: requestId ? { requestId } : undefined
      });
    }

    const data = body.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new OpenAIImagesProviderError('Images API response did not contain image data.', {
        status: response.status,
        code: 'missing_image_data',
        diagnostics: {
          ...(requestId ? { requestId } : {}),
          responseKeys: Object.keys(body)
        }
      });
    }

    await mkdir(this.#outputDirectory, { recursive: true });
    const outputPaths: string[] = [];
    const outputMedia: Array<{
      path: string;
      format: 'png' | 'webp' | 'jpeg';
      actualWidth: number;
      actualHeight: number;
      dimensionsMatch: boolean;
    }> = [];
    for (let index = 0; index < data.length; index += 1) {
      const item = data[index];
      if (!isObject(item)) continue;
      const bytes = await imageBytesFrom(item, this.#apiKey, this.#timeoutMs);
      const format = detectImageFormat(bytes);
      if (!format) {
        throw new OpenAIImagesProviderError('Images API returned undecodable image bytes.', {
          status: response.status,
          code: 'invalid_image_bytes',
          diagnostics: {
            ...(requestId ? { requestId } : {}),
            returnedImageCount: data.length
          }
        });
      }
      const dimensions = imageDimensions(bytes, format);
      if (!dimensions) {
        throw new OpenAIImagesProviderError(
          'Images API returned image bytes without readable dimensions.',
          {
            status: response.status,
            code: 'invalid_image_dimensions',
            diagnostics: {
              ...(requestId ? { requestId } : {}),
              returnedImageCount: data.length
            }
          }
        );
      }
      const outputPath = join(
        this.#outputDirectory,
        `${safeFilePart(request.taskId)}-${String(index + 1).padStart(2, '0')}.${format}`
      );
      await writeFile(outputPath, bytes);
      outputPaths.push(outputPath);
      outputMedia.push({
        path: outputPath,
        format,
        actualWidth: dimensions.width,
        actualHeight: dimensions.height,
        dimensionsMatch:
          dimensions.width === request.width && dimensions.height === request.height
      });
    }

    if (outputPaths.length !== request.count) {
      throw new OpenAIImagesProviderError(
        `Images API returned ${outputPaths.length} valid images; expected ${request.count}.`,
        {
          status: response.status,
          code: 'image_count_mismatch',
          diagnostics: {
            ...(requestId ? { requestId } : {}),
            returnedImageCount: outputPaths.length,
            outputPaths: [...outputPaths]
          }
        }
      );
    }

    const completedAt = new Date().toISOString();
    const dimensionsMatch = outputMedia.every((item) => item.dimensionsMatch);
    const dimensionsAccepted = dimensionsMatch || apiYiReverseProtocol && outputMedia.every((item) => aspectRatioMatches(
      item.actualWidth,
      item.actualHeight,
      request.width,
      request.height
    ));
    return {
      id: request.taskId,
      version: 1,
      createdAt: startedAt,
      updatedAt: completedAt,
      approval: 'draft',
      kind: 'image',
      provider: volcengineSeedreamProtocol ? 'volcengine-seedream' : this.id,
      sourceEntityIds: [...request.sourceEntityIds],
      status: dimensionsAccepted ? 'awaiting_review' : 'failed',
      parameters: {
        model: this.#model,
        operation: isReferenceEdit ? 'edit' : 'generation',
        protocol: volcengineSeedreamProtocol ? 'volcengine-ark-image-generation' : apiYiReverseProtocol ? 'apiyi-reverse-image' : 'openai-images',
        referenceEditMode: this.#referenceEditMode,
        referenceImageCount: request.referenceMediaPaths.length,
        ...(this.#maxReferenceImages === undefined ? {} : { maxReferenceImages: this.#maxReferenceImages }),
        width: request.width,
        height: request.height,
        count: request.count,
        quality: request.quality ?? 'high',
        outputFormat: request.outputFormat ?? 'png',
        promptSha256: createHash('sha256').update(request.prompt).digest('hex'),
        sourceEntityVersions: { ...request.sourceEntityVersions },
        referenceAssetIds: [...request.referenceAssetIds],
        referenceAssetVersions: { ...request.referenceAssetVersions },
        referenceMediaPaths: [...request.referenceMediaPaths],
        outputMedia,
        dimensionsMatch,
        dimensionsAccepted,
        automaticRetry: false
      },
      outputPaths,
      ...(!dimensionsAccepted
        ? {
            errorCode: 'image_dimensions_mismatch',
            errorMessage: `Images API output dimensions did not match requested ${request.width}x${request.height}.`
          }
        : {}),
      ...(requestId ? { externalTaskId: requestId } : {})
    };
  }
}

async function createVolcengineSeedreamBody(
  request: ImageGenerationRequest,
  model: string
): Promise<Record<string, unknown>> {
  const referenceImages = await Promise.all(request.referenceMediaPaths.map(async (referencePath) => {
    let bytes: Buffer;
    try {
      bytes = await readFile(referencePath);
    } catch (error) {
      throw new OpenAIImagesProviderError(
        `Unable to read reference image: ${safeErrorMessage(error, '')}`,
        { code: 'reference_image_read_error' }
      );
    }
    const format = detectImageFormat(bytes);
    if (!format) {
      throw new OpenAIImagesProviderError(
        'Reference image is not a supported PNG, WebP, or JPEG file.',
        { code: 'invalid_reference_image' }
      );
    }
    if (bytes.length > 30 * 1024 * 1024) {
      throw new OpenAIImagesProviderError(
        'Volcengine Seedream reference images must not exceed 30 MB each.',
        { code: 'seedream_reference_too_large' }
      );
    }
    return `data:${mimeTypeFor(format)};base64,${bytes.toString('base64')}`;
  }));

  return {
    model,
    prompt: request.prompt,
    ...(referenceImages.length === 0
      ? {}
      : { image: referenceImages.length === 1 ? referenceImages[0] : referenceImages }),
    size: `${request.width}x${request.height}`,
    response_format: 'url',
    output_format: request.outputFormat ?? 'png',
    watermark: false
  };
}

async function createEditFormData(
  request: ImageGenerationRequest,
  model: string,
  baseUrl: string
): Promise<FormData> {
  const form = new FormData();
  const apiYiReverseProtocol = isApiYiReverseImageModel(baseUrl, model);
  form.append('model', model);
  form.append('prompt', request.prompt);
  if (!apiYiReverseProtocol) {
    form.append('n', String(request.count));
    form.append('size', `${request.width}x${request.height}`);
    form.append('quality', request.quality ?? 'high');
    form.append('output_format', request.outputFormat ?? 'png');
  }
  for (const referencePath of request.referenceMediaPaths) {
    let bytes: Buffer;
    try {
      bytes = await readFile(referencePath);
    } catch (error) {
      throw new OpenAIImagesProviderError(
        `Unable to read reference image: ${safeErrorMessage(error, '')}`,
        { code: 'reference_image_read_error' }
      );
    }
    const format = detectImageFormat(bytes);
    if (!format) {
      throw new OpenAIImagesProviderError(
        'Reference image is not a supported PNG, WebP, or JPEG file.',
        { code: 'invalid_reference_image' }
      );
    }
    form.append(
      apiYiReverseProtocol ? 'image' : 'image[]',
      new Blob([bytes], { type: mimeTypeFor(format) }),
      basename(referencePath)
    );
  }
  return form;
}

function isApiYiReverseImageModel(baseUrl: string, model: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return (hostname === 'api.apiyi.com' || hostname.endsWith('.apiyi.com')) && /^gpt-image-2-(?:all|vip)$/iu.test(model.trim());
  } catch {
    return false;
  }
}

function isVolcengineSeedreamModel(baseUrl: string, model: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname.toLowerCase() === 'ark.cn-beijing.volces.com'
      && /^\/api\/v3\/?$/iu.test(url.pathname)
      && /^doubao-seedream-/iu.test(model.trim());
  } catch {
    return false;
  }
}

function validateVolcengineSeedreamRequest(request: ImageGenerationRequest, model: string): void {
  const maximumReferences = VOLCENGINE_SEEDREAM_5_PRO_MODEL.test(model)
    ? VOLCENGINE_SEEDREAM_5_PRO_MAX_REFERENCES
    : VOLCENGINE_SEEDREAM_OTHER_MAX_REFERENCES;
  if (request.referenceMediaPaths.length > maximumReferences) {
    throw new OpenAIImagesProviderError(
      `Volcengine Seedream accepts at most ${maximumReferences} reference images for this model.`,
      { code: 'invalid_reference_count' }
    );
  }
  if (request.count !== 1) {
    throw new OpenAIImagesProviderError(
      'The current Volcengine Seedream adapter generates one image per request.',
      { code: 'seedream_single_output_only' }
    );
  }
  if ((request.outputFormat ?? 'png') === 'webp') {
    throw new OpenAIImagesProviderError(
      'Volcengine Seedream supports PNG or JPEG output, not WebP.',
      { code: 'seedream_output_format_unsupported' }
    );
  }
  if (VOLCENGINE_SEEDREAM_5_PRO_MODEL.test(model)) {
    const pixels = request.width * request.height;
    const ratio = request.width / request.height;
    if (pixels < VOLCENGINE_SEEDREAM_5_PRO_MIN_PIXELS || pixels > VOLCENGINE_SEEDREAM_5_PRO_MAX_PIXELS || ratio < 1 / 16 || ratio > 16) {
      throw new OpenAIImagesProviderError(
        'Volcengine Seedream 5.0 Pro output dimensions are outside the supported pixel or aspect-ratio range.',
        { code: 'seedream_dimensions_unsupported' }
      );
    }
  }
}

function aspectRatioMatches(actualWidth: number, actualHeight: number, expectedWidth: number, expectedHeight: number): boolean {
  const actualRatio = actualWidth / actualHeight;
  const expectedRatio = expectedWidth / expectedHeight;
  return Number.isFinite(actualRatio) && Number.isFinite(expectedRatio) && Math.abs(actualRatio - expectedRatio) / expectedRatio <= 0.02;
}

async function imageBytesFrom(
  item: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number
): Promise<Buffer> {
  const base64 = stringAt(item, 'b64_json');
  if (base64) {
    const payload = /^data:image\/[a-z0-9.+-]+;base64,/iu.test(base64) ? base64.slice(base64.indexOf(',') + 1) : base64;
    return Buffer.from(payload, 'base64');
  }

  const url = stringAt(item, 'url');
  if (url) {
    const started = Date.now();
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      throw imageTransportError(error, apiKey, 'image_download', started, timeoutMs, signal);
    }
    if (!response.ok) {
      throw new OpenAIImagesProviderError(
        `Generated image download failed with HTTP ${response.status}.`,
        { status: response.status, code: 'image_download_error' }
      );
    }
    try { return Buffer.from(await response.arrayBuffer()); }
    catch (error) { throw imageTransportError(error, apiKey, 'image_download', started, timeoutMs, signal, response); }
  }

  throw new OpenAIImagesProviderError('Image result has neither b64_json nor url.', {
    code: 'missing_image_content'
  });
}

function validateRequest(request: ImageGenerationRequest): void {
  if (!nonEmpty(request.taskId)) throw new Error('Image taskId is required.');
  if (!nonEmpty(request.prompt)) throw new Error('Image prompt is required.');
  if (!Number.isInteger(request.width) || request.width <= 0) {
    throw new Error('Image width must be a positive integer.');
  }
  if (!Number.isInteger(request.height) || request.height <= 0) {
    throw new Error('Image height must be a positive integer.');
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 4) {
    throw new Error('Image count must be an integer between 1 and 4.');
  }
  if (!Array.isArray(request.sourceEntityIds)) {
    throw new Error('Image sourceEntityIds must be an array.');
  }
  if (!Array.isArray(request.referenceAssetIds) || !Array.isArray(request.referenceMediaPaths)) {
    throw new Error('Image reference fields must be arrays.');
  }
  validateVersionMap(request.sourceEntityVersions, request.sourceEntityIds, 'source entity');
  validateVersionMap(
    request.referenceAssetVersions,
    request.referenceAssetIds,
    'reference asset'
  );
}

function validateVersionMap(
  versions: Record<string, number> | undefined,
  ids: string[],
  label: string
): void {
  if (!versions) return;
  for (const [id, version] of Object.entries(versions)) {
    if (!ids.includes(id) || !Number.isInteger(version) || version < 1) {
      throw new Error(`Image ${label} versions must match request IDs and use positive integers.`);
    }
  }
}

function detectImageFormat(bytes: Buffer): 'png' | 'webp' | 'jpeg' | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return undefined;
}

function imageDimensions(
  bytes: Buffer,
  format: 'png' | 'webp' | 'jpeg'
): { width: number; height: number } | undefined {
  if (format === 'png') {
    if (bytes.length < 24) return undefined;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'jpeg') return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return undefined;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  return undefined;
}

function mimeTypeFor(format: 'png' | 'webp' | 'jpeg'): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function parseJsonObject(rawBody: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(rawBody);
    if (isObject(value)) return value;
  } catch {
    // Converted to a stable provider error below.
  }
  throw new OpenAIImagesProviderError('Images API returned a non-JSON response.', {
    code: 'invalid_response_body'
  });
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeErrorMessage(error: unknown, apiKey: string): string {
  return redact(error instanceof Error ? error.message : 'Unknown Images provider error.', apiKey);
}

function imageTransportError(error: unknown, apiKey: string, phase: NonNullable<OpenAIImagesErrorDiagnostics['phase']>, started: number, timeoutMs: number, signal: AbortSignal, response?: Response): OpenAIImagesProviderError {
  const source = error as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  const transportCode = source?.cause?.code ?? source?.code;
  const timeout = source?.name === 'TimeoutError' || signal.reason?.name === 'TimeoutError' || ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'].includes(String(transportCode));
  const message = safeErrorMessage(error, apiKey);
  return new OpenAIImagesProviderError(message, {
    code: timeout ? 'image_request_timeout' : phase === 'image_download' ? 'image_download_error' : 'network_error',
    status: response?.status,
    diagnostics: {
      phase, elapsedMs: Date.now() - started, timeoutMs,
      ...(transportCode != null ? { transportCode: String(transportCode) } : {}),
      transportMessage: redact(source?.cause?.message || message, apiKey).slice(0, 400),
      ...(response?.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id')! } : {}),
    },
  });
}

function redact(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, '[REDACTED]') : value;
}

function healthStatusFor(status: number): ProviderHealthStatus {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'model_missing';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'backend_offline';
  return 'down';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const nested = value?.[key];
  return isObject(nested) ? nested : undefined;
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const nested = value?.[key];
  return typeof nested === 'string' ? nested : undefined;
}
