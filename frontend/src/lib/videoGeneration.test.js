import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_VIDEO_TASK_STORAGE_KEY,
  PENDING_VIDEO_SUBMISSION_STORAGE_KEY,
  buildVideoTaskPollingState,
  clearActiveVideoTask,
  clearPendingVideoSubmission,
  fetchWithAbortTimeout,
  findRecoverableVideoTask,
  formatSeedanceResolutionLabel,
  getActiveVideoTaskStorageKey,
  getPendingVideoSubmissionStorageKey,
  getVideoPollRetryDelayMs,
  getSeedanceCreditsPerSecond,
  getVideoUrlOrThrow,
  isActiveVideoTaskOwnedByUser,
  isSeedanceModel,
  isTransientVideoPollStatus,
  loadActiveVideoTask,
  loadPendingVideoSubmission,
  normalizeSeedanceResolution,
  normalizeSeedanceVideoMode,
  normalizeVideoDurationSeconds,
  parseRetryAfterMs,
  persistActiveVideoTask,
  persistPendingVideoSubmission,
  resolveSeedanceVideoMode,
} from './videoGeneration.js';

test('isSeedanceModel detects the Seedance video option only', () => {
  assert.equal(isSeedanceModel('seedance-2.0'), true);
  assert.equal(isSeedanceModel('nano-banana-2'), false);
});

test('getVideoUrlOrThrow returns content video_url from task responses', () => {
  const url = getVideoUrlOrThrow({
    status: 'succeeded',
    video_url: 'https://cdn.example.com/video.mp4',
  });

  assert.equal(url, 'https://cdn.example.com/video.mp4');
});

test('buildVideoTaskPollingState recognizes terminal and in-progress statuses', () => {
  assert.deepEqual(buildVideoTaskPollingState({ status: 'succeeded', video_url: 'https://cdn.example.com/video.mp4' }), {
    isTerminal: true,
    isSuccess: true,
    isAwaitingOutput: false,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'succeeded', video_url: null }), {
    isTerminal: false,
    isSuccess: false,
    isAwaitingOutput: true,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'failed' }), {
    isTerminal: true,
    isSuccess: false,
    isAwaitingOutput: false,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'running' }), {
    isTerminal: false,
    isSuccess: false,
    isAwaitingOutput: false,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'reconciliation_required' }), {
    isTerminal: false,
    isSuccess: false,
    isAwaitingOutput: false,
    requiresReview: true,
  });
});

test('findRecoverableVideoTask restores server tasks when local submission response was lost', () => {
  const task = findRecoverableVideoTask([
    { task_id: 'done', request_id: 'request-done', status: 'succeeded', video_url: 'https://cdn.example.com/done.mp4' },
    { task_id: 'active', request_id: 'request-active', status: 'submit_unknown', video_url: null },
  ]);

  assert.equal(task.task_id, 'active');
  assert.equal(findRecoverableVideoTask([{ task_id: 'failed', request_id: 'request-failed', status: 'failed' }]), null);
  assert.equal(findRecoverableVideoTask(null), null);
  assert.equal(findRecoverableVideoTask([
    { task_id: 'completed', request_id: 'lost-response', status: 'succeeded', video_url: 'https://cdn.example.com/completed.mp4' },
  ], 'lost-response').task_id, 'completed');
  assert.equal(findRecoverableVideoTask([
    { task_id: 'ready', request_id: 'ready-request', status: 'ready' },
  ]).task_id, 'ready');
});

test('normalizeVideoDurationSeconds clamps user input to 4-15 whole seconds', () => {
  assert.equal(normalizeVideoDurationSeconds('3'), 4);
  assert.equal(normalizeVideoDurationSeconds('4'), 4);
  assert.equal(normalizeVideoDurationSeconds('6.8'), 6);
  assert.equal(normalizeVideoDurationSeconds('15'), 15);
  assert.equal(normalizeVideoDurationSeconds('16'), 15);
  assert.equal(normalizeVideoDurationSeconds('abc'), 4);
});

test('Seedance resolution normalization never invents client-side pricing', () => {
  assert.equal(normalizeSeedanceResolution('480p'), '720p');
  assert.equal(normalizeSeedanceResolution('720p'), '720p');
  assert.equal(normalizeSeedanceResolution('1080p'), '1080p');
  assert.equal(normalizeSeedanceResolution('4K'), '4k');
  assert.equal(normalizeSeedanceResolution('2K'), '720p');
  assert.equal(getSeedanceCreditsPerSecond('720p'), null);
  assert.equal(getSeedanceCreditsPerSecond('1080p'), null);
  assert.equal(getSeedanceCreditsPerSecond('4k'), null);
  assert.equal(formatSeedanceResolutionLabel('720p'), '720P');
  assert.equal(formatSeedanceResolutionLabel('1080p'), '1080P');
  assert.equal(formatSeedanceResolutionLabel('4k'), '4K');
});

test('Seedance video mode resolves official v3 image roles by image count', () => {
  assert.equal(normalizeSeedanceVideoMode('first_frame'), 'first_frame');
  assert.equal(normalizeSeedanceVideoMode('reference_image'), 'reference_image');
  assert.equal(normalizeSeedanceVideoMode('reference_video'), 'reference_video');
  assert.equal(normalizeSeedanceVideoMode('first_last_frame'), 'first_last_frame');
  assert.equal(normalizeSeedanceVideoMode('unknown'), 'auto');
  assert.equal(resolveSeedanceVideoMode('auto', 0), 'standard');
  assert.equal(resolveSeedanceVideoMode('auto', 1), 'first_frame');
  assert.equal(resolveSeedanceVideoMode('auto', 2), 'reference_image');
  assert.equal(resolveSeedanceVideoMode('auto', 3), 'reference_image');
  assert.equal(resolveSeedanceVideoMode('auto', 0, true), 'reference_video');
  assert.equal(resolveSeedanceVideoMode('auto', 2, true), 'reference_video');
  assert.equal(resolveSeedanceVideoMode('reference_image', 2), 'reference_image');
});

function createMemoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('active Seedance task metadata persists without prompt or reference image data', () => {
  const storage = createMemoryStorage();
  const persisted = persistActiveVideoTask({
    taskId: 'task-123',
    requestId: 'request-456',
    ownerUserId: 9,
    status: 'submitted',
    prompt: 'must not be stored',
    image_datas: ['data:image/png;base64,private'],
  }, storage);

  assert.equal(persisted.taskId, 'task-123');
  assert.equal(persisted.ownerUserId, '9');
  const raw = storage.getItem(getActiveVideoTaskStorageKey(9, 'task-123'));
  assert.equal(raw.includes('must not be stored'), false);
  assert.equal(raw.includes('base64'), false);
  assert.deepEqual(loadActiveVideoTask(storage, 9), persisted);
  assert.equal(isActiveVideoTaskOwnedByUser(persisted, { id: 9 }), true);
  assert.equal(isActiveVideoTaskOwnedByUser(persisted, { id: 10 }), false);

  assert.equal(clearActiveVideoTask(storage, 'another-task', 9), false);
  assert.notEqual(loadActiveVideoTask(storage, 9), null);
  assert.equal(clearActiveVideoTask(storage, 'task-123', 9), true);
  assert.equal(loadActiveVideoTask(storage, 9), null);
});

test('pending submission metadata preserves only the scoped request identity', () => {
  const storage = createMemoryStorage();
  const pending = persistPendingVideoSubmission({
    requestId: 'request-before-post',
    ownerUserId: 12,
    prompt: 'must not persist',
    image_datas: ['data:image/png;base64,private'],
  }, storage);

  assert.equal(pending.requestId, 'request-before-post');
  const raw = storage.getItem(getPendingVideoSubmissionStorageKey(12, 'request-before-post'));
  assert.equal(raw.includes('must not persist'), false);
  assert.equal(raw.includes('base64'), false);
  assert.deepEqual(loadPendingVideoSubmission(storage, 12), pending);
  assert.equal(clearPendingVideoSubmission(storage, 'different-request', 12), false);
  assert.notEqual(loadPendingVideoSubmission(storage, 12), null);
  assert.equal(clearPendingVideoSubmission(storage, 'request-before-post', 12), true);
  assert.equal(loadPendingVideoSubmission(storage, 12), null);
});

test('Seedance recovery metadata is isolated per signed-in account', () => {
  const storage = createMemoryStorage();
  persistActiveVideoTask({
    taskId: 'task-a',
    requestId: 'request-a',
    ownerUserId: 'user-a',
  }, storage);
  persistActiveVideoTask({
    taskId: 'task-b',
    requestId: 'request-b',
    ownerUserId: 'user-b',
  }, storage);
  persistPendingVideoSubmission({
    requestId: 'pending-a',
    ownerUserId: 'user-a',
  }, storage);
  persistPendingVideoSubmission({
    requestId: 'pending-b',
    ownerUserId: 'user-b',
  }, storage);

  assert.equal(loadActiveVideoTask(storage, 'user-a').taskId, 'task-a');
  assert.equal(loadActiveVideoTask(storage, 'user-b').taskId, 'task-b');
  assert.equal(loadPendingVideoSubmission(storage, 'user-a').requestId, 'pending-a');
  assert.equal(loadPendingVideoSubmission(storage, 'user-b').requestId, 'pending-b');

  assert.equal(clearActiveVideoTask(storage, 'task-b', 'user-a'), false);
  assert.equal(clearPendingVideoSubmission(storage, 'pending-b', 'user-a'), false);
  assert.equal(loadActiveVideoTask(storage, 'user-b').taskId, 'task-b');
  assert.equal(loadPendingVideoSubmission(storage, 'user-b').requestId, 'pending-b');
});

test('owner-scoped storage migrates matching legacy records without claiming another account', () => {
  const storage = createMemoryStorage();
  storage.setItem(ACTIVE_VIDEO_TASK_STORAGE_KEY, JSON.stringify({
    taskId: 'legacy-task',
    requestId: 'legacy-request',
    ownerUserId: 'user-a',
    createdAt: Date.now(),
  }));
  storage.setItem(PENDING_VIDEO_SUBMISSION_STORAGE_KEY, JSON.stringify({
    requestId: 'legacy-pending',
    ownerUserId: 'user-a',
    createdAt: Date.now(),
  }));

  assert.equal(loadActiveVideoTask(storage, 'user-b'), null);
  assert.equal(loadPendingVideoSubmission(storage, 'user-b'), null);
  assert.notEqual(storage.getItem(ACTIVE_VIDEO_TASK_STORAGE_KEY), null);
  assert.notEqual(storage.getItem(PENDING_VIDEO_SUBMISSION_STORAGE_KEY), null);

  assert.equal(loadActiveVideoTask(storage, 'user-a').taskId, 'legacy-task');
  assert.equal(loadPendingVideoSubmission(storage, 'user-a').requestId, 'legacy-pending');
  assert.equal(storage.getItem(ACTIVE_VIDEO_TASK_STORAGE_KEY), null);
  assert.equal(storage.getItem(PENDING_VIDEO_SUBMISSION_STORAGE_KEY), null);
});

test('a delayed watcher cannot overwrite a newer task marker in another tab', () => {
  const storage = createMemoryStorage();
  const taskA = {
    taskId: 'task-a',
    requestId: 'request-a',
    ownerUserId: 'user-a',
  };
  const taskB = {
    taskId: 'task-b',
    requestId: 'request-b',
    ownerUserId: 'user-a',
  };

  assert.ok(persistActiveVideoTask(taskA, storage));
  assert.equal(clearActiveVideoTask(storage, 'task-a', 'user-a'), true);
  assert.ok(persistActiveVideoTask(taskB, storage));
  assert.ok(persistActiveVideoTask(taskA, storage, 'task-a'));
  assert.equal(clearActiveVideoTask(storage, 'task-a', 'user-a'), true);
  assert.equal(loadActiveVideoTask(storage, 'user-a').taskId, 'task-b');
});

test('active task records use independent per-task keys', () => {
  const storage = createMemoryStorage();
  const taskA = {
    taskId: 'task-a',
    requestId: 'request-a',
    ownerUserId: 'user-a',
    createdAt: 100,
  };
  const taskB = {
    taskId: 'task-b',
    requestId: 'request-b',
    ownerUserId: 'user-a',
    createdAt: 200,
  };

  assert.ok(persistActiveVideoTask(taskA, storage));
  assert.ok(persistActiveVideoTask(taskB, storage));
  assert.notEqual(
    getActiveVideoTaskStorageKey('user-a', 'task-a'),
    getActiveVideoTaskStorageKey('user-a', 'task-b'),
  );
  assert.equal(loadActiveVideoTask(storage, 'user-a').taskId, 'task-b');
  assert.equal(clearActiveVideoTask(storage, 'task-a', 'user-a'), true);
  assert.equal(loadActiveVideoTask(storage, 'user-a').taskId, 'task-b');
});

test('pending submissions use independent per-request keys across tabs', () => {
  const storage = createMemoryStorage();
  persistPendingVideoSubmission({
    requestId: 'request-a',
    ownerUserId: 'user-a',
    createdAt: 100,
  }, storage);
  persistPendingVideoSubmission({
    requestId: 'request-b',
    ownerUserId: 'user-a',
    createdAt: 200,
  }, storage);

  assert.equal(loadPendingVideoSubmission(storage, 'user-a').requestId, 'request-b');
  assert.equal(clearPendingVideoSubmission(storage, 'request-a', 'user-a'), true);
  assert.equal(loadPendingVideoSubmission(storage, 'user-a').requestId, 'request-b');
});

test('video polling retry helpers handle 429/5xx, Retry-After, backoff, and jitter', () => {
  assert.equal(isTransientVideoPollStatus(429), true);
  assert.equal(isTransientVideoPollStatus(503), true);
  assert.equal(isTransientVideoPollStatus(404), false);
  assert.equal(parseRetryAfterMs('7'), 7000);
  assert.equal(parseRetryAfterMs('invalid'), 0);
  assert.equal(getVideoPollRetryDelayMs({ retryAttempt: 1, random: () => 0 }), 1500);
  assert.equal(getVideoPollRetryDelayMs({ retryAttempt: 2, random: () => 1 }), 3750);
  assert.equal(getVideoPollRetryDelayMs({ retryAttempt: 1, retryAfter: '9', random: () => 0 }), 9000);
});

test('fetchWithAbortTimeout turns a per-request timeout into a TimeoutError', async () => {
  const neverCompletes = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    fetchWithAbortTimeout(neverCompletes, '/task', {}, { timeoutMs: 5 }),
    { name: 'TimeoutError' },
  );
});

test('fetchWithAbortTimeout preserves an explicit stop-watching abort', async () => {
  const parentController = new AbortController();
  const neverCompletes = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const request = fetchWithAbortTimeout(neverCompletes, '/task', {}, {
    timeoutMs: 1000,
    signal: parentController.signal,
  });
  parentController.abort();

  await assert.rejects(request, { name: 'AbortError' });
});
