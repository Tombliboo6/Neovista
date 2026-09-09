export type BatchAsset = { key: string; selected?: boolean; participation?: string; selectionNeeded?: boolean };
export type BatchImage = { key: string; status: string; imageUrl?: string; stale?: boolean };

/** A batch owns only selected, unfinished assets; a retry is an explicit action. */
export function assetBatchState(assets: BatchAsset[], images: BatchImage[], requestKeys: Iterable<string> = []) {
  const active = new Set(requestKeys);
  const imageByKey = new Map(images.map(image => [image.key, image]));
  const eligible = assets.filter(asset => asset.selected !== false && !['voice', 'candidate'].includes(asset.participation || ''));
  const readyKeys: string[] = [], failedKeys: string[] = [], blockedKeys: string[] = [];
  let completed = 0, running = 0;
  for (const asset of eligible) {
    const image = imageByKey.get(asset.key);
    if (active.has(asset.key) || ['running', 'queued', 'submitting'].includes(image?.status || '')) { running++; continue; }
    if (image?.status === 'complete' && image.imageUrl && !image.stale) { completed++; continue; }
    if (asset.selectionNeeded) { blockedKeys.push(asset.key); continue; }
    if (image?.status === 'failed') failedKeys.push(asset.key);
    else readyKeys.push(asset.key);
  }
  return { total: eligible.length, completed, running, readyKeys, failedKeys, blockedKeys };
}

export type AssetBatchState = ReturnType<typeof assetBatchState>;

export type AssetBatchKind = 'character' | 'scene' | 'prop';
type AssetKeys = { profileKey?: string; sceneAssetKey?: string; propAssetKey?: string };
export function productionAssetBatch(kind: AssetBatchKind,
  assets: Array<AssetKeys & { selectedForProduction?: boolean; participation?: string; libraryBinding?: { selectionNeeded?: boolean } }>,
  images: Array<AssetKeys & { status: string; imageUrl?: string; stale?: boolean }>, requestKeys: Iterable<string> = []) {
  const field = { character: 'profileKey', scene: 'sceneAssetKey', prop: 'propAssetKey' }[kind] as keyof AssetKeys;
  return assetBatchState(assets.filter(asset => asset[field]).map(asset => ({ key: asset[field]!, selected: asset.selectedForProduction, participation: asset.participation, selectionNeeded: asset.libraryBinding?.selectionNeeded })),
    images.filter(image => image[field]).map(image => ({ ...image, key: image[field]! })), requestKeys);
}
