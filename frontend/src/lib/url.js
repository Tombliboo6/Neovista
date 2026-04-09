const ABSOLUTE_URL_RE = /^(?:[a-z]+:)?\/\//i;

function trimTrailingSlash(value = '') {
  return value.replace(/\/+$/, '');
}

function normalizePath(path = '') {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function isAbsoluteUrl(path = '') {
  return ABSOLUTE_URL_RE.test(path) || path.startsWith('data:') || path.startsWith('blob:');
}

export function resolveApiUrl(path, { apiBase = '/api' } = {}) {
  if (!path) return path;
  if (isAbsoluteUrl(path)) return path;

  const base = trimTrailingSlash(apiBase || '/api');
  const normalized = normalizePath(path);
  const suffix = normalized.startsWith('/api/') && base.endsWith('/api')
    ? normalized.slice(4)
    : normalized;

  return `${base}${suffix}`;
}

export function resolveAssetUrl(path, { assetBase = '' } = {}) {
  if (!path) return path;
  if (isAbsoluteUrl(path)) return path;

  const base = trimTrailingSlash(assetBase || '');
  const normalized = normalizePath(path);
  return `${base}${normalized}`;
}

export function getApiUrl(path) {
  return resolveApiUrl(path, {
    apiBase: import.meta.env.VITE_API_BASE_URL || '/api',
  });
}

export function getAssetUrl(path) {
  return resolveAssetUrl(path, {
    assetBase: import.meta.env.VITE_ASSET_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8000' : ''),
  });
}
