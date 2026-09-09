import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_IMAGE_TASK_CONCURRENCY, runImageTaskQueue } from '../src/workers/image-task-queue.ts';

test('image task queue defaults to concurrency three and preserves result order', async () => {
  let active = 0;
  let peak = 0;
  const results = await runImageTaskQueue([1, 2, 3, 4], async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });
  assert.equal(DEFAULT_IMAGE_TASK_CONCURRENCY, 3);
  assert.equal(peak, 3);
  assert.deepEqual(results.map((item) => item.value), [10, 20, 30, 40]);
});

test('image task queue does not retry and stops scheduling new work after a failure', async () => {
  const calls = [];
  const results = await runImageTaskQueue([1, 2, 3, 4], async (value) => {
    calls.push(value);
    if (value === 1) throw new Error('fixture failure');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return value;
  });
  assert.deepEqual(calls.sort(), [1, 2, 3]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[3].status, 'not_started');
});
