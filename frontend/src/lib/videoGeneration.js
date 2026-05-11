export const SEEDANCE_MODEL_ID = 'seedance-2.0';
export const SEEDANCE_MIN_DURATION_SECONDS = 5;
export const SEEDANCE_MAX_DURATION_SECONDS = 15;
export const DEFAULT_SEEDANCE_RESOLUTION = '720p';
export const SEEDANCE_RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p', creditsPerSecond: 200 },
  { value: '720p', label: '720p', creditsPerSecond: 250 },
  { value: '1080p', label: '1080p', creditsPerSecond: 300 },
];
export const DEFAULT_SEEDANCE_VIDEO_MODE = 'auto';
export const SEEDANCE_VIDEO_MODE_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'first_frame', label: '首帧' },
  { value: 'reference_image', label: '参考图' },
  { value: 'first_last_frame', label: '首尾帧' },
];

export function isSeedanceModel(model) {
  return model === SEEDANCE_MODEL_ID;
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

export function getSeedanceCreditsPerSecond(value) {
  const normalized = normalizeSeedanceResolution(value);
  return SEEDANCE_RESOLUTION_OPTIONS.find((option) => option.value === normalized).creditsPerSecond;
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

export function resolveSeedanceVideoMode(value, imageCount) {
  const normalized = normalizeSeedanceVideoMode(value);
  if (normalized === 'auto') {
    const count = Number(imageCount);
    if (count <= 0) {
      return 'standard';
    }
    if (count === 1) {
      return 'first_frame';
    }
    if (count === 2) {
      return 'first_last_frame';
    }
    return 'reference_image';
  }
  return normalized;
}

export function buildVideoTaskPollingState(task) {
  const status = String(task?.status || '').toLowerCase();
  if (status === 'succeeded') {
    return { isTerminal: true, isSuccess: true };
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    return { isTerminal: true, isSuccess: false };
  }
  return { isTerminal: false, isSuccess: false };
}

export function getVideoUrlOrThrow(task) {
  const videoUrl = typeof task?.video_url === 'string' ? task.video_url.trim() : '';
  if (!videoUrl) {
    throw new Error('视频生成成功，但未返回视频地址');
  }
  return videoUrl;
}
