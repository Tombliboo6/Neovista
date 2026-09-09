import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalGpuBusyError, LocalGpuCoordinator } from '../src/providers/local-gpu-coordinator.ts';

test('local GPU coordinator rejects overlapping work and releases its lock after completion', async () => {
  const coordinator = new LocalGpuCoordinator();
  let finish;
  const first = coordinator.runExclusive({ kind: 'ace-music', taskId: 'music-1', label: 'ACE-Step音乐生成' }, async () => await new Promise((resolve) => { finish = resolve; }));
  assert.equal(coordinator.status().active?.taskId, 'music-1');
  await assert.rejects(
    () => coordinator.runExclusive({ kind: 'image-upscale', taskId: 'image-1', label: '图片超分' }, async () => undefined),
    (error) => error instanceof LocalGpuBusyError && error.active.taskId === 'music-1',
  );
  finish('done');
  assert.equal(await first, 'done');
  assert.deepEqual(coordinator.status(), { busy: false });
});

test('local GPU coordinator releases its lock when a task fails', async () => {
  const coordinator = new LocalGpuCoordinator();
  await assert.rejects(() => coordinator.runExclusive({ kind: 'image-upscale', taskId: 'image-failed', label: '图片超分' }, async () => { throw new Error('failed'); }), /failed/u);
  assert.deepEqual(coordinator.status(), { busy: false });
});
