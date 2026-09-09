import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { productionContext } from '../src/workers/production-context.ts';
import { applyProductionResult, mergeByStableKey, PRODUCTION_ROUTES, productionSource } from './src/production-state.ts';

const digest = value => createHash('sha256').update(value).digest('hex');
const terminal = job => !['queued', 'running'].includes(job.status);
const safeError = error => ({ message: error instanceof Error ? error.message : String(error), code: error?.code || 'generation_failed' });

export function createProductionJobStore({ directory, sessions, execute, recoverResult }) {
  mkdirSync(directory, { recursive: true });
  const jobs = new Map();
  const path = id => resolve(directory, `${id}.json`);
  const persist = job => {
    job.revision = (job.revision || 0) + 1; job.updatedAt = new Date().toISOString();
    const temporary = `${path(job.id)}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(job), 'utf8'); renameSync(temporary, path(job.id));
  };
  for (const filename of readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name))) {
    try {
      const job = JSON.parse(readFileSync(resolve(directory, filename), 'utf8'));
      if (job.id !== filename.slice(0, -5)) continue;
      if (!terminal(job)) {
        job.status = 'interrupted'; job.error = '本地服务已重启，已保存的结果可继续使用；未确认的上游请求请先核对结果。';
        for (const call of job.calls ?? []) if (['queued', 'running'].includes(call.phase)) call.phase = call.phase === 'queued' ? 'not_started' : 'unknown';
        persist(job);
      }
      const recovered = terminal(job) && recoverResult?.(job);
      if (recovered) { job.result = recovered; persist(job); }
      jobs.set(job.id, job);
    } catch { /* A damaged record does not hide the other tasks. */ }
  }
  function publicJob(job, includeResult = true) {
    if (!job) return null;
    const { payload, sourceState, ...view } = job;
    return { ...view, calls: (job.calls ?? []).map(({ output, diagnostics, ...call }) => ({ ...call, diagnostics: diagnostics ? { ...diagnostics, rawOutputText: undefined } : undefined })), ...(includeResult ? {} : { result: undefined }) };
  }
  function checkpoint(job, incoming) {
    const result = { ...(job.result || {}), ...incoming };
    for (const key of ['plans', 'prompts', 'boards']) if (Array.isArray(incoming[key])) result[key] = mergeByStableKey(job.result?.[key], incoming[key]);
    job.result = result; persist(job);
  }
  async function start(job) {
    job.status = 'running'; persist(job);
    try {
      const result = await productionContext.run({
        event: event => {
          const index = job.calls.findIndex(call => call.callId === event.callId);
          if (index < 0) job.calls.push(event); else job.calls[index] = { ...job.calls[index], ...event };
          persist(job);
        }, checkpoint: result => checkpoint(job, result),
      }, () => execute(job.route, job.payload));
      checkpoint(job, result);
      job.status = result.complete === false || result.error || result.validationErrors?.length || result.boards?.some(item => item.status === 'failed') || result.prompts?.some(item => ['failed', 'needs_revision'].includes(item.status)) ? 'partial' : 'completed';
    } catch (error) {
      const detail = safeError(error); job.status = job.result ? 'partial' : 'failed'; job.error = detail.message; job.code = detail.code;
      if (error?.diagnostics?.draft || error?.diagnostics?.outline) checkpoint(job, { ...error.diagnostics.draft, ...(error.diagnostics.outline ? { outline: error.diagnostics.outline } : {}), complete: false, error: job.result?.error || detail.message, validationIssues: error.issues ?? [] });
    }
    persist(job);
  }
  return {
    submit({ route, payload, projectId, idempotencyKey }) {
      if (!PRODUCTION_ROUTES.includes(route)) throw new Error('此任务类型不支持后台执行。');
      const session = sessions.load();
      if (!session || session.id !== projectId) throw new Error('项目已经切换，请保存当前项目后提交。');
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(idempotencyKey || '')) throw new Error('任务请求编号无效。');
      const sourceHash = digest(productionSource(session.state, route));
      const inputHash = digest(JSON.stringify(payload));
      const duplicate = [...jobs.values()].find(job => job.projectId === projectId && (job.idempotencyKey === idempotencyKey || (!terminal(job) && job.route === route && job.inputHash === inputHash && job.sourceHash === sourceHash)));
      if (duplicate) return publicJob(duplicate);
      const job = { id: randomUUID(), idempotencyKey, projectId, route, sourceVersion: 2, sourceHash, inputHash, payload: structuredClone(payload), status: 'queued', calls: [], revision: 0, createdAt: new Date().toISOString() };
      jobs.set(job.id, job); persist(job);
      // The running promise belongs to the server, not the HTTP response.
      void start(job).catch(error => { job.status = 'failed'; job.error = safeError(error).message; try { persist(job); } catch {} });
      return publicJob(job);
    },
    get(id) { return publicJob(jobs.get(id)); },
    list(projectId) { return [...jobs.values()].filter(job => job.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(job => publicJob(job)); },
    reconcile(session) {
      if (!session) return session;
      let state = session.state;
      for (const job of [...jobs.values()].filter(job => job.projectId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (Number(state.productionAppliedJobs?.[job.id]) >= job.revision) continue;
        if (digest(productionSource(state, job.route, job.sourceVersion ?? 1)) !== job.sourceHash) continue;
        state = applyProductionResult(state, publicJob(job));
      }
      return state === session.state ? session : sessions.save({ state, expectedRevision: session.revision });
    },
    matches(id, state) { const job = jobs.get(id); return Boolean(job && digest(productionSource(state, job.route, job.sourceVersion ?? 1)) === job.sourceHash); },
    diagnostic(id) { const job = jobs.get(id); return job ? { ...publicJob(job), calls: job.calls } : null; },
  };
}
