import { mkdir, stat, unlink } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { ImageToolProvider, ImageToolRequest, ImageToolResult, ProviderHealth } from './contracts.js';

export interface ProcessResult { code: number; stdout: string; stderr: string }
export type ProcessRunner = (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<ProcessResult>;

export interface LocalImageToolsProviderOptions {
  outputDirectory: string;
  realEsrganExecutable?: string;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  processRunner?: ProcessRunner;
}

export class LocalImageToolsProviderError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.name = 'LocalImageToolsProviderError'; this.code = code; }
}

export class LocalImageToolsProvider implements ImageToolProvider {
  readonly id = 'local-image-tools';
  readonly #outputDirectory: string;
  readonly #realEsrganExecutable: string;
  readonly #ffmpegExecutable: string;
  readonly #ffprobeExecutable: string;
  readonly #processRunner: ProcessRunner;

  constructor(options: LocalImageToolsProviderOptions) {
    this.#outputDirectory = resolve(options.outputDirectory);
    this.#realEsrganExecutable = resolve(options.realEsrganExecutable ?? process.env.REALESRGAN_EXECUTABLE ?? 'D:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe');
    this.#ffmpegExecutable = options.ffmpegExecutable ?? 'ffmpeg';
    this.#ffprobeExecutable = options.ffprobeExecutable ?? 'ffprobe';
    this.#processRunner = options.processRunner ?? runProcess;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const runtime = await stat(this.#realEsrganExecutable);
      if (!runtime.isFile()) throw new Error('Real-ESRGAN executable is not a file.');
      const modelsDirectory = join(resolve(this.#realEsrganExecutable, '..'), 'models');
      await Promise.all([
        'realesrgan-x4plus.param', 'realesrgan-x4plus.bin',
        'realesrgan-x4plus-anime.param', 'realesrgan-x4plus-anime.bin',
        'realesr-animevideov3-x2.param', 'realesr-animevideov3-x2.bin',
      ].map((name) => stat(join(modelsDirectory, name))));
      return { status: 'ok', message: 'Real-ESRGAN图片超分运行时可用。', checkedAt, details: { executable: this.#realEsrganExecutable, modelsDirectory } };
    } catch (error) {
      return { status: 'model_missing', message: `Real-ESRGAN图片超分运行时不可用：${error instanceof Error ? error.message : String(error)}`, checkedAt, details: { executable: this.#realEsrganExecutable } };
    }
  }

  async run(request: ImageToolRequest): Promise<ImageToolResult> {
    validateRequest(request);
    const source = resolve(request.sourcePath);
    const sourceDimensions = await probeDimensions(source, this.#ffprobeExecutable, this.#processRunner);
    await mkdir(this.#outputDirectory, { recursive: true });
    const safeTaskId = request.taskId.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 180);
    const outputPath = join(this.#outputDirectory, `${safeTaskId}.png`);
    let upscalePipeline: Record<string, unknown> | undefined;
    if (request.operation === 'upscale') {
      const health = await this.health();
      if (health.status !== 'ok') throw new LocalImageToolsProviderError(health.message, 'realesrgan_unavailable');
      const scale = request.upscaleScale ?? 2;
      const modelFamily = request.upscaleModel ?? 'general';
      if (modelFamily === 'anime' && scale === 2) {
        const model = 'realesr-animevideov3';
        await expectSuccess(this.#processRunner(this.#realEsrganExecutable, ['-i', source, '-o', outputPath, '-n', model, '-s', '2', '-f', 'png'], { cwd: resolve(this.#realEsrganExecutable, '..'), timeoutMs: 20 * 60_000 }), 'Real-ESRGAN图片超分失败');
        upscalePipeline = { model, nativeScale: 2, outputScale: 2, downsampled: false };
      } else if (scale === 4) {
        const model = modelFamily === 'anime' ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus';
        await expectSuccess(this.#processRunner(this.#realEsrganExecutable, ['-i', source, '-o', outputPath, '-n', model, '-s', '4', '-f', 'png'], { cwd: resolve(this.#realEsrganExecutable, '..'), timeoutMs: 20 * 60_000 }), 'Real-ESRGAN图片超分失败');
        upscalePipeline = { model, nativeScale: 4, outputScale: 4, downsampled: false };
      } else {
        const model = 'realesrgan-x4plus';
        const nativeOutputPath = join(this.#outputDirectory, `${safeTaskId}.native-4x.png`);
        try {
          await expectSuccess(this.#processRunner(this.#realEsrganExecutable, ['-i', source, '-o', nativeOutputPath, '-n', model, '-s', '4', '-f', 'png'], { cwd: resolve(this.#realEsrganExecutable, '..'), timeoutMs: 20 * 60_000 }), 'Real-ESRGAN图片超分失败');
          await expectSuccess(this.#processRunner(this.#ffmpegExecutable, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n', '-i', nativeOutputPath, '-vf', `scale=${sourceDimensions.width * 2}:${sourceDimensions.height * 2}:flags=lanczos`, '-frames:v', '1', outputPath], { timeoutMs: 10 * 60_000 }), 'Real-ESRGAN 2倍成像失败');
        } finally {
          await unlink(nativeOutputPath).catch(() => {});
        }
        upscalePipeline = { model, nativeScale: 4, outputScale: 2, downsampled: true, downsampleFilter: 'lanczos' };
      }
    } else {
      const transpose = request.operation === 'rotate-clockwise' ? '1' : '2';
      await expectSuccess(this.#processRunner(this.#ffmpegExecutable, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n', '-i', source, '-vf', `transpose=${transpose}`, '-frames:v', '1', outputPath], { timeoutMs: 5 * 60_000 }), '图片旋转失败');
    }
    const output = await stat(outputPath).catch(() => null);
    if (!output?.isFile() || output.size < 1) throw new LocalImageToolsProviderError('图片处理没有产生可用文件。', 'missing_output');
    const outputDimensions = await probeDimensions(outputPath, this.#ffprobeExecutable, this.#processRunner);
    const expectedDimensions = request.operation === 'upscale'
      ? { width: sourceDimensions.width * (request.upscaleScale ?? 2), height: sourceDimensions.height * (request.upscaleScale ?? 2) }
      : { width: sourceDimensions.height, height: sourceDimensions.width };
    if (outputDimensions.width !== expectedDimensions.width || outputDimensions.height !== expectedDimensions.height) {
      throw new LocalImageToolsProviderError(`图片处理结果尺寸异常：预期${expectedDimensions.width}×${expectedDimensions.height}，实际${outputDimensions.width}×${outputDimensions.height}。`, 'invalid_output_dimensions');
    }
    return {
      taskId: request.taskId,
      provider: this.id,
      operation: request.operation,
      outputPath,
      sourceWidth: sourceDimensions.width,
      sourceHeight: sourceDimensions.height,
      outputWidth: outputDimensions.width,
      outputHeight: outputDimensions.height,
      parameters: request.operation === 'upscale'
        ? { scale: request.upscaleScale ?? 2, model: request.upscaleModel ?? 'general', pipeline: upscalePipeline, automaticRetry: false }
        : { direction: request.operation === 'rotate-clockwise' ? 'clockwise' : 'counterclockwise', automaticRetry: false },
    };
  }
}

function validateRequest(request: ImageToolRequest) {
  if (!request?.taskId || !/^[a-zA-Z0-9._-]{1,240}$/u.test(request.taskId)) throw new LocalImageToolsProviderError('图片工具任务ID无效。', 'invalid_task_id');
  if (!request.sourcePath || !['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(extname(request.sourcePath).toLowerCase())) throw new LocalImageToolsProviderError('图片工具只支持PNG、JPEG、WebP或BMP输入。', 'invalid_source');
  if (!['rotate-clockwise', 'rotate-counterclockwise', 'upscale'].includes(request.operation)) throw new LocalImageToolsProviderError('图片工具操作无效。', 'invalid_operation');
  if (request.operation === 'upscale' && request.upscaleScale !== undefined && request.upscaleScale !== 2 && request.upscaleScale !== 4) throw new LocalImageToolsProviderError('图片超分只支持2倍或4倍。', 'invalid_scale');
}

async function probeDimensions(filePath: string, ffprobe: string, runner: ProcessRunner) {
  const result = await runner(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', '--', filePath], { timeoutMs: 60_000 });
  if (result.code !== 0) throw new LocalImageToolsProviderError(`无法读取图片尺寸：${result.stderr.trim() || 'ffprobe失败'}`, 'probe_failed');
  try {
    const parsed = JSON.parse(result.stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const width = Number(parsed.streams?.[0]?.width);
    const height = Number(parsed.streams?.[0]?.height);
    if (width > 0 && height > 0) return { width, height };
  } catch { /* normalized below */ }
  throw new LocalImageToolsProviderError('无法读取图片宽高。', 'invalid_dimensions');
}

async function expectSuccess(promise: Promise<ProcessResult>, label: string) {
  const result = await promise;
  if (result.code !== 0) throw new LocalImageToolsProviderError(`${label}：${result.stderr.trim() || `进程退出码${result.code}`}`, 'process_failed');
}

function runProcess(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<ProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill(); rejectPromise(new LocalImageToolsProviderError(`${basename(command)}执行超时。`, 'process_timeout')); }, options.timeoutMs ?? 300_000);
    child.on('error', (error) => { clearTimeout(timer); rejectPromise(new LocalImageToolsProviderError(`${basename(command)}无法启动：${error.message}`, 'process_start_failed')); });
    child.on('close', (code) => { clearTimeout(timer); resolvePromise({ code: code ?? -1, stdout, stderr }); });
  });
}
