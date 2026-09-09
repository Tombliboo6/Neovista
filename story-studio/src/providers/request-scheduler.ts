import { withCreativeSelfReview } from './creative-review.ts';
import { randomUUID } from 'node:crypto';
import type { AgentProvider, AgentRequest, ImageProvider } from './contracts.js';
import { productionContext } from '../workers/production-context.ts';

export type RequestLane = 'text' | 'image';
export interface RequestLimits { textConcurrency: number; imageConcurrency: number; requestsPerMinute: number; tokensPerMinute: number; }
export const DEFAULT_REQUEST_LIMITS: RequestLimits = { textConcurrency: 2, imageConcurrency: 2, requestsPerMinute: 0, tokensPerMinute: 0 };
type Entry = { work: () => Promise<unknown>; resolve: (value: any) => void; reject: (error: unknown) => void; tokens: number; };

export class RequestScheduler {
  #limits = { ...DEFAULT_REQUEST_LIMITS };
  #lanes = { text: { active: 0, waiting: [] as Entry[], cooldownUntil: 0 }, image: { active: 0, waiting: [] as Entry[], cooldownUntil: 0 } };
  #history: { at: number; tokens: number }[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  configure(input: Partial<RequestLimits>) {
    const next = { ...this.#limits, ...input };
    for (const [key, max] of [['textConcurrency', 4], ['imageConcurrency', 4], ['requestsPerMinute', 100000], ['tokensPerMinute', 100000000]] as const) {
      if (!Number.isInteger(next[key]) || next[key] < (key.endsWith('Concurrency') ? 1 : 0) || next[key] > max) throw new Error(`无效的任务额度：${key}`);
    }
    this.#limits = next; this.#pump(); return this.status();
  }
  status() {
    return { limits: { ...this.#limits }, lanes: Object.fromEntries(Object.entries(this.#lanes).map(([key, lane]) => [key, { active: lane.active, queued: lane.waiting.length, cooldownUntil: lane.cooldownUntil }])) };
  }
  run<T>(lane: RequestLane, work: () => Promise<T>, tokens = 0): Promise<T> {
    if (this.#limits.tokensPerMinute && tokens > this.#limits.tokensPerMinute) return Promise.reject(new Error('单次任务估算 Token 超过每分钟额度，请缩小任务或调整额度。'));
    return new Promise<T>((resolve, reject) => { this.#lanes[lane].waiting.push({ work, resolve, reject, tokens }); this.#pump(); });
  }
  #pump() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    const now = Date.now();
    this.#history = this.#history.filter(entry => now - entry.at < 60000);
    for (const name of ['text', 'image'] as const) {
      const lane = this.#lanes[name];
      const limit = name === 'text' ? this.#limits.textConcurrency : this.#limits.imageConcurrency;
      while (lane.active < limit && lane.waiting.length && now >= lane.cooldownUntil) {
        const entry = lane.waiting[0];
        if (this.#limits.requestsPerMinute && this.#history.length >= this.#limits.requestsPerMinute) break;
        if (this.#limits.tokensPerMinute && this.#history.reduce((n, x) => n + x.tokens, 0) + entry.tokens > this.#limits.tokensPerMinute) break;
        lane.waiting.shift(); lane.active++; this.#history.push({ at: now, tokens: entry.tokens });
        Promise.resolve().then(entry.work).then(entry.resolve, error => {
          if (Number(error?.status) === 429 || error?.code === 'rate_limited') lane.cooldownUntil = Date.now() + Math.max(1000, Number(error?.diagnostics?.retryAfterMs) || 30000);
          entry.reject(error);
        }).finally(() => { lane.active--; this.#pump(); });
      }
    }
    if (Object.values(this.#lanes).some(lane => lane.waiting.length)) this.#timer = setTimeout(() => this.#pump(), 1000);
  }
}

// All settings stores, tabs, generation and repair entry points share this pool.
export const sharedRequestScheduler = new RequestScheduler();

function targetKeys(request: AgentRequest): string[] {
  const input = request.input as any;
  return [...new Set<string>([input?.segmentKey, input?.segment?.segmentKey, input?.currentSlot?.segmentKey, input?.currentSegment?.segmentKey, ...(input?.segments ?? []).map((x: any) => x.segmentKey ?? x.segment?.segmentKey)].filter(Boolean))];
}

export function scheduledAgent(provider: AgentProvider, scheduler = sharedRequestScheduler): AgentProvider {
  return {
    id: provider.id, health: () => provider.health(),
    async generate<T>(request: AgentRequest) {
      const context = productionContext.getStore();
      const event = { callId: randomUUID(), operation: request.operation, targetKeys: targetKeys(request) };
      context?.event({ ...event, phase: 'queued' });
      return scheduler.run('text', async () => {
        context?.event({ ...event, phase: 'running' });
        try {
          const result = await provider.generate<T>(withCreativeSelfReview(request));
          context?.event({ ...event, phase: 'completed', externalTaskId: result.externalTaskId, elapsedMs: result.elapsedMs, usage: result.usage, output: result.output });
          return result;
        } catch (error) {
          const detail = error as any;
          context?.event({ ...event, phase: 'failed', error: detail.message, code: detail.code, diagnostics: detail.diagnostics });
          throw error;
        }
      }, Buffer.byteLength(JSON.stringify(request.input), 'utf8') + (request.maxOutputTokens ?? 32000));
    },
  };
}

export function scheduledImage(provider: ImageProvider, scheduler = sharedRequestScheduler): ImageProvider {
  return { id: provider.id, health: () => provider.health(), async submit(request) {
    const context = productionContext.getStore();
    const event = { callId: randomUUID(), operation: 'generate-image', targetKeys: request.targetKeys ?? [request.taskId] };
    context?.event({ ...event, phase: 'queued' });
    let startedAt: number | undefined;
    try {
      return await scheduler.run('image', async () => {
        startedAt = Date.now();
        context?.event({ ...event, phase: 'running' });
        const result = await provider.submit(request);
        context?.event({ ...event, phase: result.status === 'failed' ? 'failed' : 'completed', externalTaskId: result.externalTaskId, elapsedMs: Date.now() - startedAt, output: { status: result.status, outputPaths: result.outputPaths }, error: result.errorMessage, code: result.errorCode });
        return result;
      });
    } catch (error) {
      const detail = error as any;
      context?.event({ ...event, phase: 'failed', elapsedMs: startedAt ? Date.now() - startedAt : undefined, externalTaskId: detail.diagnostics?.externalTaskId, error: detail.message, code: detail.code, diagnostics: detail.diagnostics });
      throw error;
    }
  } };
}
