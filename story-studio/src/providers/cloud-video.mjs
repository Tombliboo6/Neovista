import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

export const CLOUD_VIDEO_ENGINES = ['minimax', 'seedance'];
export const videoProviderKind = engine => `${engine}-video`;
export const stableVideoSeed = requestId => createHash('sha256').update(String(requestId)).digest().readUInt32BE(0) & 0x7fffffff;

export class VideoApiError extends Error {
  constructor(message, { uncertain = false } = {}) { super(message); this.uncertain = uncertain; }
}

// Image bytes travel with the request. localhost URLs and Windows paths are never sent upstream.
async function imageDataUrl(path) {
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(path).toLowerCase()];
  if (!mime) throw new VideoApiError('视频参考图仅支持 JPG、PNG、WebP。');
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size >= 20 * 1024 * 1024) throw new VideoApiError('每张视频参考图必须小于 20MB，且文件可读取。');
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

export function validateCloudVideoRequest(engine, configuration, request) {
  if (!CLOUD_VIDEO_ENGINES.includes(engine)) throw new VideoApiError('视频接口类型无效。');
  if (!configuration?.model || !configuration?.apiKey) throw new VideoApiError('请先在设置中保存这个视频接口的地址、模型和密钥。');
  const paths = request.referenceMediaPaths || [];
  const mode = request.mode || 'text';
  if (!request.prompt?.trim()) throw new VideoApiError('请先确认视频提示词。');
  if (request.continuity) throw new VideoApiError('连续链使用本机 H3，请将本段改为独立生成后使用视频 API。');
  if (request.referenceMedia?.some(item => item.kind !== 'image')) throw new VideoApiError('当前视频 API 接入支持图片参考，请使用本机 H3 处理音频或视频参考。');
  if (mode === 'text' && (paths.length || /<(?:Picture|Subject)\s*\d+>|<图片\d+>/iu.test(request.prompt))) throw new VideoApiError('文生视频提示词仍引用了图片，请使用参考模式，或先编辑并确认独立的文生视频提示词。');
  if (mode !== 'text' && !paths.length) throw new VideoApiError('这个模式需要已确认的参考图。');
  if (mode === 'first' && paths.length !== 1) throw new VideoApiError('首帧模式必须恰好使用一张首帧图。');
  if (mode === 'first-last' && paths.length !== 2) throw new VideoApiError('首尾帧模式必须恰好使用两张图片。');
  if (!Number.isInteger(request.durationSec)) throw new VideoApiError('视频 API 时长必须是整数秒。');
  if (engine === 'minimax') {
    if (mode === 'reference') throw new VideoApiError('当前 MiniMax 海螺接口支持文生、首帧和首尾帧，不支持把多图全能参考直接提交。当前导演分镜可使用本机 H3 或 Seedance；独立文生提示词可使用 MiniMax。');
    if (!['text', 'first', 'first-last'].includes(mode)) throw new VideoApiError('MiniMax 生成模式无效。');
    if (request.prompt.length > 2000) throw new VideoApiError(`MiniMax 提示词上限为 2000 字符，当前 ${request.prompt.length} 字符。请精简并重新确认。`);
    if (!['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'].includes(configuration.model)) throw new VideoApiError('当前 MiniMax 适配支持 MiniMax-Hailuo-2.3、MiniMax-Hailuo-2.3-Fast、MiniMax-Hailuo-02，请核对模型名。');
    if (mode === 'text' && configuration.model.endsWith('-Fast')) throw new VideoApiError('MiniMax Hailuo Fast 需要首帧图片。');
    if (mode === 'first-last' && configuration.model !== 'MiniMax-Hailuo-02') throw new VideoApiError('MiniMax 首尾帧模式需要 MiniMax-Hailuo-02。');
    if (!['768p', '1080p'].includes(request.cloudResolution)) throw new VideoApiError('MiniMax 分辨率请选择 768P 或 1080P。');
    if (![6, 10].includes(request.durationSec) || (request.cloudResolution === '1080p' && request.durationSec !== 6)) throw new VideoApiError('MiniMax 支持 768P 的 6/10 秒，或 1080P 的 6 秒。请先调整并确认分段时长；系统不会自动截短镜头。');
    if (request.generateAudio) throw new VideoApiError('当前 MiniMax 海螺接口输出无声视频，请关闭生成声音，或选择 Seedance / 本机 H3。');
    if (mode === 'text' && request.aspectRatio !== '16:9') throw new VideoApiError('当前 MiniMax 文生接口未提供画面比例参数，本接入仅接受 16:9，避免静默忽略项目比例。');
  } else {
    if (!['text', 'first', 'first-last', 'reference'].includes(mode)) throw new VideoApiError('Seedance 生成模式无效。');
    if (paths.length > 9) throw new VideoApiError('Seedance 图片参考最多 9 张。');
    if (request.durationSec < 4 || request.durationSec > 15) throw new VideoApiError('当前 Seedance 接入的分段时长为 4 至 15 秒，请使用支持相应时长的模型。');
    if (!['480p', '720p', '1080p'].includes(request.cloudResolution)) throw new VideoApiError('Seedance 分辨率请选择 480P、720P 或 1080P，并确认所用模型支持。');
    if (request.prompt.length > 10000) throw new VideoApiError('Seedance 提示词超过当前接入的 10000 字符上限。');
  }
}

export function compileSeedancePrompt(request) {
  // Only transport tags change; common Chinese production prose stays intact.
  let text = request.prompt.replace(/<Picture\s+(\d+)>/giu, '<Image_$1>');
  const labels = request.referenceLabels || [];
  const declarations = (request.referenceMediaPaths || []).map((_, index) => `<Image_${index + 1}>：${labels[index] || `参考图片${index + 1}`}`);
  let subject = 0;
  labels.forEach((label, index) => {
    if (/(?:角色|人物)主图/u.test(label)) {
      subject += 1;
      text = text.replace(new RegExp(`<Subject\\s+${subject}>`, 'giu'), `<Subject_${subject}>`);
      declarations.push(`<Subject_${subject}> 使用 <Image_${index + 1}> 的人物身份`);
    }
  });
  if (/<Subject\s+\d+>/iu.test(text)) throw new VideoApiError('人物参考绑定缺少明确的角色图片，请修正参考标签后提交 Seedance。');
  return declarations.length ? `参考绑定：\n${declarations.join('\n')}\n\n${text}` : text;
}

export class CloudVideoProvider {
  constructor(engine, configuration, { fetchImpl = globalThis.fetch } = {}) {
    this.engine = engine;
    this.configuration = { ...configuration };
    this.fetch = fetchImpl;
  }

  async api(path, body) {
    const submitting = body !== undefined;
    let response;
    try {
      response = await this.fetch(`${this.configuration.baseUrl.replace(/\/$/u, '')}${path}`, {
        method: submitting ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${this.configuration.apiKey}`, ...(submitting ? { 'Content-Type': 'application/json' } : {}) },
        ...(submitting ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(submitting ? 120_000 : 30_000),
      });
    } catch { throw new VideoApiError(submitting ? '提交连接中断，无法确认服务商是否接单。请在服务商控制台核实任务编号，系统不会自动重新提交。' : '视频任务查询暂时失败，原任务和参数已保留。', { uncertain: submitting }); }
    let data;
    try { data = await response.json(); } catch { throw new VideoApiError(`视频接口返回不可读取的数据（HTTP ${response.status}）。`, { uncertain: submitting }); }
    const terminalTaskError = !submitting && ['failed', 'expired', 'cancelled'].includes(data.status);
    if (!response.ok || (data.error && !terminalTaskError) || Number(data.base_resp?.status_code || 0) !== 0) {
      const code = String(data.error?.code || data.base_resp?.status_code || response.status).replace(/[^a-zA-Z0-9_.-]/gu, '').slice(0, 100);
      // Provider bodies may contain request text or credentials. Persist only safe error codes.
      throw new VideoApiError(`视频接口请求失败（HTTP ${response.status}，代码 ${code}）。请检查模型权限、参数或额度。`, { uncertain: submitting && response.status >= 500 });
    }
    return data;
  }

  async prepare(request) {
    validateCloudVideoRequest(this.engine, this.configuration, request);
    const images = await Promise.all((request.referenceMediaPaths || []).map(imageDataUrl));
    if (this.engine === 'minimax') return {
      model: this.configuration.model, prompt: request.prompt, prompt_optimizer: false,
      duration: request.durationSec, resolution: request.cloudResolution.toUpperCase(),
      ...(images[0] ? { first_frame_image: images[0] } : {}), ...(images[1] ? { last_frame_image: images[1] } : {}),
    };
    return {
      model: this.configuration.model,
      content: [{ type: 'text', text: compileSeedancePrompt(request) }, ...images.map((url, index) => ({
        type: 'image_url', image_url: { url },
        role: request.mode === 'first' || request.mode === 'first-last' ? index === 0 ? 'first_frame' : 'last_frame' : 'reference_image',
      }))], duration: request.durationSec, ratio: request.aspectRatio, resolution: request.cloudResolution,
      generate_audio: request.generateAudio !== false, seed: request.seed,
    };
  }

  async submitPrepared(body) {
    const data = await this.api(this.engine === 'minimax' ? '/video_generation' : '/contents/generations/tasks', body);
    const id = this.engine === 'minimax' ? data.task_id : data.id;
    if (typeof id !== 'string' || !id.trim()) throw new VideoApiError('接口未返回任务编号，请到服务商控制台核实接单情况。', { uncertain: true });
    return id;
  }

  async status(id) {
    if (this.engine === 'minimax') {
      const data = await this.api(`/query/video_generation?task_id=${encodeURIComponent(id)}`);
      if (data.status === 'Success') {
        if (!data.file_id) throw new VideoApiError('MiniMax 已完成，但未返回文件编号。');
        const file = await this.api(`/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`);
        if (!file.file?.download_url) throw new VideoApiError('MiniMax 文件暂时没有下载地址。');
        return { status: 'succeeded', downloadUrl: file.file.download_url, fileId: data.file_id };
      }
      const status = { Preparing: 'queued', Queueing: 'queued', Processing: 'running', Fail: 'failed' }[data.status];
      if (!status) throw new VideoApiError('MiniMax 返回未知任务状态，等待后续查询。');
      return { status };
    }
    const data = await this.api(`/contents/generations/tasks/${encodeURIComponent(id)}`);
    if (!['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled'].includes(data.status)) throw new VideoApiError('Seedance 返回未知任务状态，等待后续查询。');
    return { status: data.status, ...(data.content?.video_url ? { downloadUrl: data.content.video_url } : {}), ...(data.error?.code ? { errorCode: String(data.error.code).replace(/[^a-zA-Z0-9_.-]/gu, '').slice(0, 100) } : {}) };
  }

  async health() {
    if (this.engine === 'minimax') return { status: 'configured', message: '配置已保存。MiniMax 没有适用于当前接入的无生成鉴权探测；提交权限与额度需在实际任务中验证。', checkedAt: new Date().toISOString() };
    await this.api('/contents/generations/tasks?page_size=1');
    return { status: 'ok', message: 'Seedance 任务查询接口可用，模型生成权限仍以实际提交为准。', checkedAt: new Date().toISOString() };
  }

  async download(url, path) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new VideoApiError('服务商没有返回安全的 HTTPS 下载地址。');
    // Signed output URLs already carry their own authorization; never forward the provider key.
    const response = await this.fetch(url, { signal: AbortSignal.timeout(180_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new VideoApiError(`视频下载失败（HTTP ${response.status}），可重试下载原任务。`);
    let bytes = 0;
    const limit = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 512 * 1024 * 1024 ? new Error('视频文件超过 512MB 下载上限。') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(path));
    if (!bytes) throw new VideoApiError('服务商返回空视频文件。');
  }
}
