import {
  normalizeSeedanceVideoMode,
  resolveSeedanceVideoMode,
} from './videoGeneration.js';

export const SEEDANCE_REQUEST_MODEL = 'seedance-2.0';
export const MAX_SEEDANCE_PROMPT_CHARS = 4000;

const normalizeText = (value) => String(value ?? '').trim();

const hashText = (value) => {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashes[0] = Math.imul(hashes[0] ^ code, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ code, 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ code, 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ code, 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, '0')).join('');
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

export function getVideoModelCapabilities(capabilities, model = null) {
  if (!capabilities || typeof capabilities !== 'object') return null;
  const normalizedModel = normalizeText(model || capabilities.model || SEEDANCE_REQUEST_MODEL).toLowerCase();
  if (Array.isArray(capabilities.models) && capabilities.models.length > 0) {
    return capabilities.models.find((candidate) => (
      normalizeText(candidate?.id).toLowerCase() === normalizedModel
    )) || null;
  }
  const rootModel = normalizeText(capabilities.model || SEEDANCE_REQUEST_MODEL).toLowerCase();
  return normalizedModel === rootModel ? capabilities : null;
}

export function isUsableVideoCapabilities(capabilities, model = null) {
  if (capabilities?.enabled !== true) return false;
  const modelCapabilities = getVideoModelCapabilities(capabilities, model);
  if (!modelCapabilities) return false;
  const min = Number(modelCapabilities.min_duration_seconds);
  const max = Number(modelCapabilities.max_duration_seconds);
  const pricing = modelCapabilities.resolution_credits_per_second;
  const defaultResolution = normalizeText(modelCapabilities.default_resolution).toLowerCase();
  const aspectRatios = modelCapabilities.aspect_ratios;
  const maxReferenceImages = Number(modelCapabilities.max_reference_images);
  return Number.isFinite(min)
    && Number.isFinite(max)
    && min > 0
    && max >= min
    && pricing
    && typeof pricing === 'object'
    && Object.keys(pricing).length > 0
    && Object.values(pricing).every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
    && Object.prototype.hasOwnProperty.call(pricing, defaultResolution)
    && Array.isArray(aspectRatios)
    && aspectRatios.length > 0
    && aspectRatios.every((value) => normalizeText(value).length > 0)
    && Number.isInteger(maxReferenceImages)
    && maxReferenceImages >= 0;
}

export function getAvailableVideoModels(capabilities) {
  if (capabilities?.enabled !== true) return [];
  if (Array.isArray(capabilities.models) && capabilities.models.length > 0) {
    return capabilities.models.filter((model) => (
      normalizeText(model?.id).length > 0
      && isUsableVideoCapabilities(capabilities, model.id)
    ));
  }
  if (!isUsableVideoCapabilities(capabilities)) return [];
  return [{
    ...capabilities,
    id: normalizeText(capabilities.model || SEEDANCE_REQUEST_MODEL),
    label: 'Seedance 2.0',
  }];
}

export function normalizeDraftDuration(value, capabilities, model = null) {
  if (!isUsableVideoCapabilities(capabilities, model)) return null;
  const modelCapabilities = getVideoModelCapabilities(capabilities, model);
  const min = Number(modelCapabilities.min_duration_seconds);
  const max = Number(modelCapabilities.max_duration_seconds);
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
}

export function normalizeDraftResolution(value, capabilities, model = null) {
  if (!isUsableVideoCapabilities(capabilities, model)) return null;
  const modelCapabilities = getVideoModelCapabilities(capabilities, model);
  const pricing = modelCapabilities.resolution_credits_per_second;
  const normalized = normalizeText(value).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(pricing, normalized)) return normalized;
  const serverDefault = normalizeText(modelCapabilities.default_resolution).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(pricing, serverDefault)) return serverDefault;
  return Object.keys(pricing)[0] || null;
}

export function createReferenceSignature(referenceImages = []) {
  const normalized = Array.isArray(referenceImages) ? referenceImages : [];
  return `${normalized.length}:${normalized.map((image) => {
    const value = String(image ?? '');
    return `${value.length}-${hashText(value)}`;
  }).join('.')}`;
}

export function createReferenceVideoSignature(referenceVideo = null) {
  const value = typeof referenceVideo === 'string'
    ? referenceVideo
    : referenceVideo?.video_url;
  const normalized = normalizeText(value);
  return normalized ? `1:${normalized.length}-${hashText(normalized)}` : null;
}

export function createGenerationRequestDto({
  model,
  prompt,
  duration,
  resolution,
  aspectRatio,
  frameMode,
  referenceImages = [],
  referenceSignature = null,
  referenceCount = null,
  hasReferenceVideo = false,
  referenceVideoSignature = null,
  capabilities,
}) {
  const normalizedModel = normalizeText(model) || SEEDANCE_REQUEST_MODEL;
  const count = Number.isInteger(referenceCount)
    ? referenceCount
    : (Array.isArray(referenceImages) ? referenceImages.length : 0);
  const normalizedFrameMode = resolveSeedanceVideoMode(
    normalizeSeedanceVideoMode(frameMode),
    count,
    Boolean(hasReferenceVideo),
  );
  const modelCapabilities = getVideoModelCapabilities(capabilities, normalizedModel);
  const normalizedDuration = normalizeDraftDuration(duration, capabilities, normalizedModel);
  const normalizedResolution = normalizeDraftResolution(resolution, capabilities, normalizedModel);
  const creditsPerSecond = normalizedResolution
    ? Number(modelCapabilities?.resolution_credits_per_second?.[normalizedResolution])
    : null;
  const dto = {
    model: normalizedModel,
    prompt: normalizeText(prompt),
    duration: normalizedDuration,
    resolution: normalizedResolution,
    aspectRatio: normalizeText(aspectRatio) || '16:9',
    frameMode: normalizedFrameMode,
    referenceCount: count,
    referenceSignature: referenceSignature || createReferenceSignature(referenceImages),
    hasReferenceVideo: Boolean(hasReferenceVideo),
    referenceVideoSignature: referenceVideoSignature || null,
    creditsPerSecond: Number.isFinite(creditsPerSecond) ? creditsPerSecond : null,
    estimatedCredits: Number.isFinite(creditsPerSecond) && Number.isFinite(normalizedDuration)
      ? creditsPerSecond * normalizedDuration
      : null,
  };
  return Object.freeze(dto);
}

export function fingerprintGenerationRequestDto(request) {
  return `REQ-${hashText(stableSerialize(request)).toUpperCase()}`;
}

export function createImmutableGenerationRequest(input) {
  const request = createGenerationRequestDto(input);
  return Object.freeze({
    request,
    fingerprint: fingerprintGenerationRequestDto(request),
  });
}

export function compareGenerationRequest(draftRequest, liveRequest) {
  const fields = [
    'model',
    'prompt',
    'duration',
    'resolution',
    'aspectRatio',
    'frameMode',
    'referenceCount',
    'referenceSignature',
    'hasReferenceVideo',
    'referenceVideoSignature',
    'creditsPerSecond',
    'estimatedCredits',
  ];
  const changedFields = fields.filter((field) => draftRequest?.[field] !== liveRequest?.[field]);
  return {
    stale: changedFields.length > 0,
    changedFields,
    fingerprint: fingerprintGenerationRequestDto(liveRequest),
  };
}
