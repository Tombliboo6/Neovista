export const GALLERY_ASSET_RELEASE = '20260718.1';

const VERSIONED_GALLERY_PATH_PREFIXES = [
  '/gallery/',
  '/api/v1/template-thumbnails/',
  '/static/template_images/',
];

function isVersionedGalleryPath(value) {
  try {
    const { pathname } = new URL(value, 'https://neovista.local');
    return VERSIONED_GALLERY_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * Adds the stable gallery release identifier to same-name gallery assets.
 * The value only changes when gallery media is replaced, so normal browser
 * caching remains effective while a new release bypasses previously immutable
 * responses.
 */
export function getVersionedGalleryAssetUrl(value) {
  if (typeof value !== 'string' || !value || !isVersionedGalleryPath(value)) {
    return value;
  }

  const hashIndex = value.indexOf('#');
  const urlWithoutHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : value.slice(hashIndex);
  const encodedRelease = encodeURIComponent(GALLERY_ASSET_RELEASE);
  const existingVersion = /([?&])gallery_v=[^&#]*/;

  if (existingVersion.test(urlWithoutHash)) {
    return `${urlWithoutHash.replace(existingVersion, `$1gallery_v=${encodedRelease}`)}${hash}`;
  }

  const separator = urlWithoutHash.includes('?') ? '&' : '?';
  return `${urlWithoutHash}${separator}gallery_v=${encodedRelease}${hash}`;
}
