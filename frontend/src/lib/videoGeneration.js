export const SEEDANCE_MODEL_ID = 'seedance-2.0';
export const SEEDANCE_MODEL_IDS = Object.freeze(['seedance-2.0', 'seedance-2.5']);
export const SEEDANCE_MIN_DURATION_SECONDS = 4;
export const SEEDANCE_MAX_DURATION_SECONDS = 15;
export const DEFAULT_SEEDANCE_RESOLUTION = '720p';
export const SEEDANCE_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720P' },
  { value: '1080p', label: '1080P' },
  { value: '4k', label: '4K' },
];
export const DEFAULT_SEEDANCE_VIDEO_MODE = 'auto';
export const ACTIVE_VIDEO_TASK_STORAGE_KEY = 'neovista_active_seedance_task_v1';
export const PENDING_VIDEO_SUBMISSION_STORAGE_KEY = 'neovista_pending_seedance_submission_v1';
export const VIDEO_POLL_REQUEST_TIMEOUT_MS = 15000;
export const VIDEO_POLL_MAX_TRANSIENT_ERRORS = 6;
export const VIDEO_POLL_RETRY_BASE_DELAY_MS = 1500;
export const VIDEO_POLL_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
export const RECOVERABLE_VIDEO_TASK_STATUSES = new Set([
  'ready',
  'creating',
  'submitting',
  'submit_unknown',
  'submitted',
  'running',
  'finalizing',
  'reconciliation_required',
]);
export const SEEDANCE_VIDEO_MODE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'first_frame', label: '首帧' },
  { value: 'reference_image', label: '参考图' },
  { value: 'reference_video', label: '参考视频' },
  { value: 'first_last_frame', label: '首尾帧' },
];

export function isSeedanceModel(model) {
  return SEEDANCE_MODEL_IDS.includes(String(model || '').trim().toLowerCase());
}

export function normalizeVideoDurationSeconds(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return SEEDANCE_MIN_DURATION_SECONDS;
  }
  return Math.min(SEEDANCE_MAX_DURATION_SECONDS, Math.max(SEEDANCE_MIN_DURATION_SECONDS, parsed));
}

export function normalizeSeedanceResolution(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SEEDANCE_RESOLUTION_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_SEEDANCE_RESOLUTION;
}

export function formatSeedanceResolutionLabel(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function getSeedanceCreditsPerSecond(value) {
  normalizeSeedanceResolution(value);
  return null;
}

export function normalizeSeedanceVideoMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'standard') {
    return normalized;
  }
  return SEEDANCE_VIDEO_MODE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_SEEDANCE_VIDEO_MODE;
}

export function resolveSeedanceVideoMode(value, imageCount, hasReferenceVideo = false) {
  const normalized = normalizeSeedanceVideoMode(value);
  if (normalized === 'auto') {
    if (hasReferenceVideo) {
      return 'reference_video';
    }
    const count = Number(imageCount);
    if (count <= 0) {
      return 'standard';
    }
    if (count === 1) {
      return 'first_frame';
    }
    return 'reference_image';
  }
  return normalized;
}

export function buildVideoTaskPollingState(task) {
  const status = String(task?.status || '').toLowerCase();
  if (status === 'reconciliation_required') {
    return {
      isTerminal: false,
      isSuccess: false,
      isAwaitingOutput: false,
      requiresReview: true,
    };
  }
  if (status === 'succeeded') {
    const hasVideoUrl = typeof task?.video_url === 'string' && task.video_url.trim().length > 0;
    return {
      isTerminal: hasVideoUrl,
      isSuccess: hasVideoUrl,
      isAwaitingOutput: !hasVideoUrl,
    };
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    return { isTerminal: true, isSuccess: false, isAwaitingOutput: false };
  }
  return { isTerminal: false, isSuccess: false, isAwaitingOutput: false };
}

export function findRecoverableVideoTask(tasks, preferredRequestId = null) {
  if (!Array.isArray(tasks)) {
    return null;
  }
  const normalizedPreferredRequestId = String(preferredRequestId || '').trim();
  if (normalizedPreferredRequestId) {
    const preferredTask = tasks.find((task) => (
      String(task?.request_id || '').trim() === normalizedPreferredRequestId
      && Boolean(task?.task_id)
    ));
    if (preferredTask) {
      return preferredTask;
    }
  }
  return tasks.find((task) => {
    const status = String(task?.status || '').trim().toLowerCase();
    if (RECOVERABLE_VIDEO_TASK_STATUSES.has(status)) {
      return Boolean(task?.task_id && task?.request_id);
    }
    return status === 'succeeded'
      && Boolean(task?.task_id && task?.request_id)
      && !String(task?.video_url || '').trim();
  }) || null;
}

function normalizeOwnerUserId(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  const normalized = String(value).trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function getLegacyOwnerScopedStorageKey(baseKey, ownerUserId) {
  const normalizedOwnerUserId = normalizeOwnerUserId(ownerUserId);
  return normalizedOwnerUserId
    ? `${baseKey}:${encodeURIComponent(normalizedOwnerUserId)}`
    : null;
}

function getOwnerStoragePrefix(baseKey, ownerUserId) {
  const legacyKey = getLegacyOwnerScopedStorageKey(baseKey, ownerUserId);
  return legacyKey ? `${legacyKey}:` : null;
}

function getOwnerItemStorageKey(baseKey, ownerUserId, itemId) {
  const prefix = getOwnerStoragePrefix(baseKey, ownerUserId);
  const normalizedItemId = String(itemId || '').trim();
  return prefix && normalizedItemId && normalizedItemId.length <= 128
    ? `${prefix}${encodeURIComponent(normalizedItemId)}`
    : null;
}

function listStorageKeys(storage) {
  if (!storage || typeof storage.key !== 'function' || !Number.isFinite(Number(storage.length))) {
    return [];
  }
  const keys = [];
  for (let index = 0; index < Number(storage.length); index += 1) {
    const key = storage.key(index);
    if (typeof key === 'string') {
      keys.push(key);
    }
  }
  return keys;
}

function selectNewestMetadata(items, identityField) {
  return items.sort((left, right) => (
    right.createdAt - left.createdAt
    || String(right[identityField]).localeCompare(String(left[identityField]))
  ))[0] || null;
}

export function getActiveVideoTaskStorageKey(ownerUserId, taskId) {
  return getOwnerItemStorageKey(ACTIVE_VIDEO_TASK_STORAGE_KEY, ownerUserId, taskId);
}

export function getPendingVideoSubmissionStorageKey(ownerUserId, requestId) {
  return getOwnerItemStorageKey(PENDING_VIDEO_SUBMISSION_STORAGE_KEY, ownerUserId, requestId);
}

function normalizePendingVideoSubmissionMetadata(submission) {
  const requestId = String(submission?.requestId || submission?.request_id || '').trim();
  const ownerUserId = normalizeOwnerUserId(submission?.ownerUserId ?? submission?.owner_user_id);
  const createdAt = Number(submission?.createdAt || submission?.created_at || Date.now());
  if (!requestId || requestId.length > 128 || !ownerUserId || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }
  return {
    requestId,
    ownerUserId,
    createdAt,
  };
}

export function persistPendingVideoSubmission(submission, storage = globalThis.localStorage) {
  const normalized = normalizePendingVideoSubmissionMetadata(submission);
  const storageKey = getPendingVideoSubmissionStorageKey(
    normalized?.ownerUserId,
    normalized?.requestId,
  );
  if (!normalized || !storage || !storageKey) {
    return normalized;
  }
  try {
    storage.setItem(storageKey, JSON.stringify(normalized));
  } catch {
    // Server-side task discovery remains the fallback when storage is unavailable.
  }
  return normalized;
}

export function loadPendingVideoSubmission(storage = globalThis.localStorage, ownerUserId = null) {
  const normalizedOwnerUserId = normalizeOwnerUserId(ownerUserId);
  const prefix = getOwnerStoragePrefix(PENDING_VIDEO_SUBMISSION_STORAGE_KEY, normalizedOwnerUserId);
  if (!storage || !prefix) {
    return null;
  }
  const candidates = [];
  try {
    for (const storageKey of listStorageKeys(storage)) {
      if (!storageKey.startsWith(prefix)) {
        continue;
      }
      try {
        const normalized = normalizePendingVideoSubmissionMetadata(
          JSON.parse(storage.getItem(storageKey) || 'null'),
        );
        if (
          !normalized
          || normalized.ownerUserId !== normalizedOwnerUserId
          || getPendingVideoSubmissionStorageKey(normalized.ownerUserId, normalized.requestId) !== storageKey
        ) {
          storage.removeItem(storageKey);
          continue;
        }
        candidates.push(normalized);
      } catch {
        storage.removeItem(storageKey);
      }
    }

    const legacyKeys = [
      getLegacyOwnerScopedStorageKey(PENDING_VIDEO_SUBMISSION_STORAGE_KEY, normalizedOwnerUserId),
      PENDING_VIDEO_SUBMISSION_STORAGE_KEY,
    ];
    for (const legacyKey of legacyKeys) {
      const legacyRaw = storage.getItem(legacyKey);
      if (!legacyRaw) {
        continue;
      }
      const legacy = normalizePendingVideoSubmissionMetadata(JSON.parse(legacyRaw));
      if (legacy?.ownerUserId === normalizedOwnerUserId) {
        persistPendingVideoSubmission(legacy, storage);
        storage.removeItem(legacyKey);
        candidates.push(legacy);
      }
    }
    return selectNewestMetadata(candidates, 'requestId');
  } catch {
    return null;
  }
}

export function clearPendingVideoSubmission(
  storage = globalThis.localStorage,
  expectedRequestId = null,
  ownerUserId = null,
) {
  const requestId = String(
    expectedRequestId || loadPendingVideoSubmission(storage, ownerUserId)?.requestId || '',
  ).trim();
  const storageKey = getPendingVideoSubmissionStorageKey(ownerUserId, requestId);
  if (!storage || !storageKey) {
    return false;
  }
  try {
    if (storage.getItem(storageKey) === null) {
      return false;
    }
    storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function getVideoUrlOrThrow(task) {
  const videoUrl = typeof task?.video_url === 'string' ? task.video_url.trim() : '';
  if (!videoUrl) {
    throw new Error('视频生成成功，但未返回视频地址');
  }
  return videoUrl;
}

export function normalizeActiveVideoTaskMetadata(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }

  const taskId = String(task.taskId || task.task_id || '').trim();
  const requestId = String(task.requestId || task.request_id || '').trim();
  if (!taskId || taskId.length > 128 || requestId.length > 128) {
    return null;
  }

  const createdAt = Number(task.createdAt || task.created_at || Date.now());
  const lastCheckedAt = Number(task.lastCheckedAt || task.last_checked_at || 0);
  return {
    taskId,
    requestId,
    ownerUserId: normalizeOwnerUserId(task.ownerUserId ?? task.owner_user_id),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    lastCheckedAt: Number.isFinite(lastCheckedAt) && lastCheckedAt > 0 ? lastCheckedAt : null,
    lastStatus: String(task.lastStatus || task.last_status || task.status || 'submitted').trim().toLowerCase(),
  };
}

export function loadActiveVideoTask(storage = globalThis.localStorage, ownerUserId = null) {
  const normalizedOwnerUserId = normalizeOwnerUserId(ownerUserId);
  const prefix = getOwnerStoragePrefix(ACTIVE_VIDEO_TASK_STORAGE_KEY, normalizedOwnerUserId);
  if (!storage || !prefix) {
    return null;
  }

  const candidates = [];
  try {
    for (const storageKey of listStorageKeys(storage)) {
      if (!storageKey.startsWith(prefix)) {
        continue;
      }
      try {
        const normalized = normalizeActiveVideoTaskMetadata(
          JSON.parse(storage.getItem(storageKey) || 'null'),
        );
        if (
          !normalized
          || normalized.ownerUserId !== normalizedOwnerUserId
          || getActiveVideoTaskStorageKey(normalized.ownerUserId, normalized.taskId) !== storageKey
        ) {
          storage.removeItem(storageKey);
          continue;
        }
        candidates.push(normalized);
      } catch {
        storage.removeItem(storageKey);
      }
    }

    const legacyKeys = [
      getLegacyOwnerScopedStorageKey(ACTIVE_VIDEO_TASK_STORAGE_KEY, normalizedOwnerUserId),
      ACTIVE_VIDEO_TASK_STORAGE_KEY,
    ];
    for (const legacyKey of legacyKeys) {
      const legacyRaw = storage.getItem(legacyKey);
      if (!legacyRaw) {
        continue;
      }
      const legacy = normalizeActiveVideoTaskMetadata(JSON.parse(legacyRaw));
      if (legacy?.ownerUserId === normalizedOwnerUserId) {
        persistActiveVideoTask(legacy, storage);
        storage.removeItem(legacyKey);
        candidates.push(legacy);
      }
    }
    return selectNewestMetadata(candidates, 'taskId');
  } catch {
    return null;
  }
}

export function persistActiveVideoTask(task, storage = globalThis.localStorage) {
  const normalized = normalizeActiveVideoTaskMetadata(task);
  const storageKey = getActiveVideoTaskStorageKey(normalized?.ownerUserId, normalized?.taskId);
  if (!normalized || !storage || !storageKey) {
    return normalized;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(normalized));
  } catch {
    // Polling still works for this tab when persistence is unavailable.
  }
  return normalized;
}

export function clearActiveVideoTask(
  storage = globalThis.localStorage,
  expectedTaskId = null,
  ownerUserId = null,
) {
  const taskId = String(
    expectedTaskId || loadActiveVideoTask(storage, ownerUserId)?.taskId || '',
  ).trim();
  const storageKey = getActiveVideoTaskStorageKey(ownerUserId, taskId);
  if (!storage || !storageKey) {
    return false;
  }
  try {
    if (storage.getItem(storageKey) === null) {
      return false;
    }
    storage.removeItem(storageKey);
    return true;
  } catch {
    // Ignore storage failures; there is no safe fallback mutation to perform.
    return false;
  }
}

export function isActiveVideoTaskOwnedByUser(task, user) {
  const normalized = normalizeActiveVideoTaskMetadata(task);
  const userId = normalizeOwnerUserId(user?.id);
  return Boolean(normalized && userId && (!normalized.ownerUserId || normalized.ownerUserId === userId));
}

export function isTransientVideoPollStatus(status) {
  const numericStatus = Number(status);
  return numericStatus === 429 || (numericStatus >= 500 && numericStatus <= 599);
}

export function parseRetryAfterMs(value, now = Date.now()) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return 0;
  }

  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
}

export function getVideoPollRetryDelayMs({
  retryAttempt,
  retryAfter,
  now = Date.now(),
  random = Math.random,
} = {}) {
  const attempt = Math.max(1, Number.parseInt(String(retryAttempt ?? 1), 10) || 1);
  const exponentialDelay = Math.min(
    VIDEO_POLL_RETRY_MAX_DELAY_MS,
    VIDEO_POLL_RETRY_BASE_DELAY_MS * (2 ** Math.min(attempt - 1, 10)),
  );
  const jitter = Math.round(exponentialDelay * 0.25 * Math.max(0, Math.min(1, Number(random()) || 0)));
  const retryAfterDelay = parseRetryAfterMs(retryAfter, now);
  return Math.min(
    VIDEO_POLL_RETRY_MAX_DELAY_MS,
    Math.max(exponentialDelay + jitter, retryAfterDelay),
  );
}

function createAbortError(message = '请求已停止') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export async function fetchWithAbortTimeout(
  fetchImpl,
  input,
  init = {},
  { timeoutMs = VIDEO_POLL_REQUEST_TIMEOUT_MS, signal: parentSignal } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  if (parentSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let didTimeout = false;
  const handleParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', handleParentAbort, { once: true });
  if (parentSignal?.aborted) {
    handleParentAbort();
  }
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, Math.max(1, Number(timeoutMs) || VIDEO_POLL_REQUEST_TIMEOUT_MS));

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (didTimeout && !parentSignal?.aborted) {
      const timeoutError = new Error('视频任务查询超时');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    if (parentSignal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', handleParentAbort);
  }
}
