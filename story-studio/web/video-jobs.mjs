import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CloudVideoProvider, videoProviderKind } from '../src/providers/cloud-video.mjs';

const terminal = new Set(['awaiting_review', 'failed', 'cancelled']);
const safeMessage = error => error?.name === 'VideoApiError' || error?.constructor?.name === 'VideoApiError' ? error.message : '视频任务暂时无法处理。原任务已保留，请检查接口配置、网络和本地输出目录。';

export function createVideoJobStore({ directory, outputDirectory, configuration, probeMedia, providerFactory = (engine, config) => new CloudVideoProvider(engine, config), pollIntervalMs = 15_000 }) {
  mkdirSync(directory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  const jobs = new Map();
  const locks = new Map();
  const queriedAt = new Map();
  const submissions = new Map();
  const save = job => {
    job.updatedAt = new Date().toISOString();
    const path = resolve(directory, `${job.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(job));
    renameSync(`${path}.tmp`, path);
  };
  for (const file of readdirSync(directory).filter(name => /^cv-[\da-f-]+\.json$/u.test(name))) {
    try {
      const job = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
      if (file !== `${job.id}.json` || !job.projectId || !['minimax', 'seedance'].includes(job.engine)) continue;
      if (!terminal.has(job.status) && !job.remoteTaskId) {
        job.phase = 'submission_unknown'; job.status = 'running';
        job.error = '服务中断时尚未记录远端任务编号，请在服务商控制台核实接单情况。';
      } else if (job.phase === 'downloading') job.phase = 'download_failed';
      jobs.set(job.id, job);
    } catch { /* A damaged task cannot erase neighboring task records. */ }
  }
  const requireJob = (projectId, id) => {
    const job = jobs.get(id);
    if (!job || job.projectId !== projectId) throw new Error('当前项目没有这个视频任务。');
    return job;
  };
  const providerFor = job => providerFactory(job.engine, configuration(videoProviderKind(job.engine), job.profileId, job.configurationRevision));
  const view = job => ({
    id: job.id, segmentKey: job.segmentKey, projectId: job.projectId, provider: job.engine, requestId: job.requestId, createdAt: job.createdAt,
    // Stable local ID makes old media consumers work without depending on the active provider.
    externalTaskId: job.id, remoteTaskId: job.remoteTaskId, status: job.status,
    outputPaths: job.outputPaths || [], errorMessage: job.error || '', updatedAt: job.updatedAt,
    parameters: { videoEngine: job.engine, profileId: job.profileId, model: job.model, phase: job.phase, remoteTaskId: job.remoteTaskId,
      durationSec: job.request.durationSec, resolution: job.request.cloudResolution, aspectRatio: job.request.aspectRatio,
      mode: job.request.mode, seed: job.request.seed, generateAudio: job.request.generateAudio, mediaProbe: job.mediaProbe, mediaWarnings: job.mediaWarnings },
  });
  async function poll(job, retryDownload = false) {
    if (locks.has(job.id)) return locks.get(job.id);
    if (terminal.has(job.status) || !job.remoteTaskId || (job.phase === 'download_failed' && !retryDownload)) return view(job);
    if (!retryDownload && Date.now() - (queriedAt.get(job.id) || 0) < pollIntervalMs) return view(job);
    queriedAt.set(job.id, Date.now());
    const work = (async () => {
      try {
        const provider = providerFor(job);
        const remote = await provider.status(job.remoteTaskId);
        if (remote.status === 'succeeded') {
          if (!remote.downloadUrl) throw new Error('远端结果没有下载地址。');
          job.phase = 'downloading'; job.status = 'running'; job.error = ''; save(job);
          const output = resolve(outputDirectory, `${job.id}.mp4`);
          const partial = `${output}.part`;
          try {
            await provider.download(remote.downloadUrl, partial);
            const probe = await probeMedia(partial);
            if (!probe || !Number.isFinite(probe.durationSec) || probe.durationSec <= 0) throw new Error('视频媒体信息无效。');
            renameSync(partial, output);
            const warnings = [];
            if (Math.abs(probe.durationSec - job.request.durationSec) > 0.5) warnings.push(`实际时长 ${probe.durationSec.toFixed(2)} 秒，请求 ${job.request.durationSec} 秒`);
            const expectedEdge = Number.parseInt(job.request.cloudResolution, 10);
            if (probe.width && probe.height && Math.min(probe.width, probe.height) !== expectedEdge) warnings.push(`实际尺寸 ${probe.width}×${probe.height}，请求 ${job.request.cloudResolution.toUpperCase()}`);
            if (job.request.generateAudio && !probe.audioPresent) warnings.push('请求生成声音，结果未检测到音轨');
            job.mediaProbe = probe; job.mediaWarnings = warnings; job.outputPaths = [output]; job.status = 'awaiting_review'; job.phase = 'ready';
            job.error = warnings.length ? `结果已保存，验收时请检查：${warnings.join('；')}。` : '';
          } catch {
            job.phase = 'download_failed';
            job.error = '服务商已完成视频，但下载或媒体校验未完成。可重试下载原结果，不会重新生成。';
          }
        } else if (['failed', 'expired', 'cancelled'].includes(remote.status)) {
          job.status = remote.status === 'cancelled' ? 'cancelled' : 'failed'; job.phase = remote.status;
          job.error = remote.status === 'cancelled' ? '' : `服务商视频任务${remote.status === 'expired' ? '已过期' : '失败'}${remote.errorCode ? `（${remote.errorCode}）` : ''}。原参数和任务编号已保留。`;
        } else { job.status = remote.status; job.phase = remote.status; job.error = ''; }
      } catch (error) { job.error = safeMessage(error); }
      save(job);
      return view(job);
    })().finally(() => locks.delete(job.id));
    locks.set(job.id, work);
    return work;
  }
  async function submit(input) {
    const { projectId, segmentKey, engine, profileId, request, requestId } = input;
    if (!projectId || !segmentKey || !/^[a-zA-Z0-9_-]{8,100}$/u.test(requestId || '')) throw new Error('视频提交缺少项目、镜头或请求编号。');
    const key = `${projectId}:${requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify({ segmentKey, engine, profileId, request })).digest('hex');
    const existing = [...jobs.values()].find(job => job.projectId === projectId && job.requestId === requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('同一请求编号不能提交不同的视频参数。');
      return view(existing);
    }
    if (submissions.has(key)) {
      const pending = submissions.get(key);
      if (pending.fingerprint !== fingerprint) throw new Error('同一请求编号不能提交不同的视频参数。');
      return pending.promise;
    }
    const promise = (async () => {
      if ([...jobs.values()].some(job => job.projectId === projectId && job.segmentKey === segmentKey && !terminal.has(job.status))) throw new Error('本镜头已有视频任务，请先处理当前任务。');
      const config = configuration(videoProviderKind(engine), profileId);
      const provider = providerFactory(engine, config);
      const body = await provider.prepare(request);
      if ([...jobs.values()].some(job => job.projectId === projectId && job.segmentKey === segmentKey && !terminal.has(job.status))) throw new Error('本镜头已有视频任务，请先处理当前任务。');
      const job = { id: `cv-${randomUUID()}`, projectId, segmentKey, engine, profileId: config.profileId,
        configurationRevision: config.revision, model: config.model, request, requestId, fingerprint,
        submittedPrompt: body.prompt || body.content?.find(item => item.type === 'text')?.text || request.prompt,
        status: 'queued', phase: 'submitting', createdAt: new Date().toISOString() };
      jobs.set(job.id, job); save(job);
      // A journal entry exists before the only paid POST. Restart only polls known IDs.
      void provider.submitPrepared(body).then(remoteTaskId => {
        job.remoteTaskId = remoteTaskId; job.phase = 'queued'; save(job);
      }).catch(error => {
        job.status = error.uncertain ? 'running' : 'failed';
        job.phase = error.uncertain ? 'submission_unknown' : 'failed'; job.error = safeMessage(error); save(job);
      });
      return view(job);
    })().finally(() => submissions.delete(key));
    submissions.set(key, { promise, fingerprint });
    return promise;
  }
  const timer = pollIntervalMs > 0 ? setInterval(() => {
    for (const job of jobs.values()) if (!terminal.has(job.status) && job.remoteTaskId) void poll(job);
  }, pollIntervalMs) : null;
  timer?.unref();
  return {
    submit,
    list: projectId => [...jobs.values()].filter(job => job.projectId === projectId).map(view),
    status: async (projectId, id) => poll(requireJob(projectId, id)),
    retryDownload: async (projectId, id) => poll(requireJob(projectId, id), true),
    async reconcile(projectId, id, remoteTaskId) {
      const job = requireJob(projectId, id);
      if (job.phase !== 'submission_unknown') throw new Error('这个任务无需核实接单。');
      if (remoteTaskId) {
        if (!/^[a-zA-Z0-9_.:-]{1,200}$/u.test(remoteTaskId)) throw new Error('服务商任务编号格式无效。');
        if ([...jobs.values()].some(item => item.id !== id && item.engine === job.engine && item.remoteTaskId === remoteTaskId)) throw new Error('这个服务商任务已绑定到其他镜头。');
        await providerFor(job).status(remoteTaskId);
        job.remoteTaskId = remoteTaskId; job.phase = 'queued'; job.status = 'queued'; job.error = '';
      } else { job.phase = 'confirmed_not_submitted'; job.status = 'failed'; job.error = '已由用户核实服务商未接单，可手动重新提交。'; }
      save(job); return view(job);
    },
    mediaPath(projectId, id) {
      const job = requireJob(projectId, id);
      const expected = resolve(outputDirectory, `${job.id}.mp4`);
      return job.status === 'awaiting_review' && job.outputPaths?.[0] === expected && existsSync(expected) ? expected : null;
    },
    has: id => jobs.has(id),
    close: () => { if (timer) clearInterval(timer); },
  };
}
