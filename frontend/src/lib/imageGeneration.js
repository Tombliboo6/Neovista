const PENDING_IMAGE_KEY_PREFIX = 'neovista:pending-image:v1:';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
const ALLOWED_ENDPOINTS = new Set(['/generate_diagram', '/v1/generate']);

const ownerKey = (ownerUserId) => {
  const value = String(ownerUserId ?? '').trim();
  return value ? `${PENDING_IMAGE_KEY_PREFIX}${encodeURIComponent(value)}` : null;
};

const stableSerialize = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
};

const fnv1a = (value) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function createImageRequestFingerprint(endpoint, payload) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!ALLOWED_ENDPOINTS.has(normalizedEndpoint)) return null;
  return `v1-${fnv1a(`${normalizedEndpoint}\n${stableSerialize(payload || {})}`)}`;
}

const normalizePendingImageSubmission = (submission) => {
  if (!submission || typeof submission !== 'object') return null;
  const requestId = String(submission.requestId || '').trim();
  const ownerUserId = String(submission.ownerUserId ?? '').trim();
  const endpoint = String(submission.endpoint || '').trim();
  const requestFingerprint = String(submission.requestFingerprint || '').trim();
  const createdAt = Number(submission.createdAt);
  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || !ownerUserId
    || !ALLOWED_ENDPOINTS.has(endpoint)
    || !/^v1-[a-f0-9]{8}$/.test(requestFingerprint)
    || !Number.isFinite(createdAt)
    || createdAt <= 0
  ) {
    return null;
  }
  return Object.freeze({ requestId, ownerUserId, endpoint, requestFingerprint, createdAt });
};

export function loadPendingImageSubmission(storage = globalThis.localStorage, ownerUserId = null) {
  const key = ownerKey(ownerUserId);
  if (!key || !storage) return null;
  try {
    return normalizePendingImageSubmission(JSON.parse(storage.getItem(key) || 'null'));
  } catch {
    return null;
  }
}

export function persistPendingImageSubmission(submission, storage = globalThis.localStorage) {
  const normalized = normalizePendingImageSubmission(submission);
  const key = normalized && ownerKey(normalized.ownerUserId);
  if (!normalized || !key || !storage) return null;
  const existing = loadPendingImageSubmission(storage, normalized.ownerUserId);
  if (existing && existing.requestId !== normalized.requestId) return null;
  try {
    storage.setItem(key, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

export function clearPendingImageSubmission(
  storage = globalThis.localStorage,
  requestId = null,
  ownerUserId = null,
) {
  const key = ownerKey(ownerUserId);
  if (!key || !storage) return false;
  const existing = loadPendingImageSubmission(storage, ownerUserId);
  if (requestId && existing?.requestId !== String(requestId)) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function classifyImageTask(task) {
  const status = String(task?.status || '').trim().toLowerCase();
  const settlementStatus = String(task?.settlement_status || '').trim().toUpperCase();
  const imageUrl = typeof task?.image_url === 'string' ? task.image_url.trim() : '';
  return Object.freeze({
    isSuccess: status === 'succeeded' && settlementStatus === 'CAPTURED' && Boolean(imageUrl),
    isFailed: status === 'failed' && settlementStatus === 'REFUNDED',
    requiresReview: settlementStatus === 'REVIEW_REQUIRED' || status === 'reconciliation_required',
    isActive: ['ready', 'submitting', 'submit_unknown'].includes(status),
    imageUrl: imageUrl || null,
  });
}
