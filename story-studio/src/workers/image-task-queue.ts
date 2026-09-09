export const DEFAULT_IMAGE_TASK_CONCURRENCY = 3;

export interface QueuedTaskResult<T> {
  index: number;
  status: 'fulfilled' | 'rejected' | 'not_started';
  value?: T;
  reason?: unknown;
}

export async function runImageTaskQueue<TInput, TOutput>(
  inputs: TInput[],
  worker: (input: TInput, index: number) => Promise<TOutput>,
  options: { concurrency?: number; stopSchedulingOnFailure?: boolean } = {}
): Promise<Array<QueuedTaskResult<TOutput>>> {
  const concurrency = options.concurrency ?? DEFAULT_IMAGE_TASK_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Image task queue concurrency must be a positive integer.');
  const results: Array<QueuedTaskResult<TOutput>> = inputs.map((_, index) => ({ index, status: 'not_started' }));
  let cursor = 0;
  let stopped = false;

  async function consume(): Promise<void> {
    while (!stopped) {
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      try {
        const value = await worker(inputs[index], index);
        results[index] = { index, status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { index, status: 'rejected', reason };
        if (options.stopSchedulingOnFailure ?? true) stopped = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => consume()));
  return results;
}
