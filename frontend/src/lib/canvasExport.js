export function safeCanvasToDataUrl(target, ...args) {
  if (!target || typeof target.toDataURL !== 'function') return null;

  try {
    const dataUrl = target.toDataURL(...args);
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : null;
  } catch {
    return null;
  }
}

export function getFabricImageLoadOptions(imageUrl) {
  if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
    return {};
  }

  return { crossOrigin: 'anonymous' };
}

export async function createCanvasSafeFabricImage(FabricImage, imageUrl, imageOptions) {
  return FabricImage.fromURL(
    imageUrl,
    getFabricImageLoadOptions(imageUrl),
    imageOptions,
  );
}
