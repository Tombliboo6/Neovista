export function normalizeReferenceImages(input) {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.filter((image) => typeof image === 'string' && image.trim().length > 0);
  }

  if (typeof input === 'string' && input.trim().length > 0) {
    return [input];
  }

  return [];
}

export function resolveReferenceImages(uploadedImages = [], fallbackImage = null) {
  const preferredImages = normalizeReferenceImages(uploadedImages);
  if (preferredImages.length > 0) {
    return preferredImages;
  }

  return normalizeReferenceImages(fallbackImage);
}

export function mergeReferenceImages(existingImages = [], incomingImages = []) {
  const merged = [
    ...normalizeReferenceImages(existingImages),
    ...normalizeReferenceImages(incomingImages),
  ];

  return Array.from(new Set(merged));
}

function buildFileIdentity(file) {
  return [
    file?.name || '',
    file?.type || '',
    file?.size || 0,
    file?.lastModified || 0,
  ].join('::');
}

export function collectClipboardImageFiles(clipboardDataOrItems = []) {
  const clipboardItems = Array.isArray(clipboardDataOrItems)
    ? clipboardDataOrItems
    : Array.from(clipboardDataOrItems?.items || []);
  const clipboardFiles = Array.isArray(clipboardDataOrItems)
    ? []
    : Array.from(clipboardDataOrItems?.files || []);

  const files = [
    ...clipboardItems
      .filter((item) => item?.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean),
    ...clipboardFiles.filter((file) => file && typeof file.type === 'string' && file.type.startsWith('image/')),
  ];

  const seen = new Set();
  return files.filter((file) => {
    const identity = buildFileIdentity(file);
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

export function collectSupportedImageFiles(fileList = []) {
  return Array.from(fileList).filter(
    (file) => file && /^image\/(jpeg|png|webp)$/.test(file.type),
  );
}
