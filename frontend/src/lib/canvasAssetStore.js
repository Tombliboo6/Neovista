const DATABASE_NAME = 'neovista-canvas-assets';
const DATABASE_VERSION = 1;
const STORE_NAME = 'assets';
const MAX_DIMENSION = 1536;
const TARGET_BYTES = 1.4 * 1024 * 1024;

const requireBrowserApi = (name, value) => {
  if (!value) throw new Error(`当前浏览器不支持 ${name}`);
  return value;
};

const openDatabase = () => new Promise((resolve, reject) => {
  const indexedDb = requireBrowserApi('本地素材库', globalThis.indexedDB);
  const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
  request.onerror = () => reject(request.error || new Error('本地素材库打开失败'));
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const runTransaction = async (mode, operation) => {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let operationResult;
      transaction.oncomplete = () => resolve(operationResult);
      transaction.onerror = () => reject(transaction.error || new Error('本地素材库操作失败'));
      transaction.onabort = () => reject(transaction.error || new Error('本地素材库操作已取消'));
      operationResult = operation(store);
    });
  } finally {
    database.close();
  }
};

const canvasToBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('参考图压缩失败'))),
    'image/jpeg',
    quality,
  );
});

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('参考图解码失败'));
  };
  image.src = url;
});

const compressImageFile = async (file) => {
  if (!/^image\/(jpeg|png|webp)$/.test(file?.type || '')) {
    throw new Error('仅支持 JPG、PNG、WebP 参考图');
  }

  const image = await loadImage(file);
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  const context = requireBrowserApi('图片压缩', canvas.getContext('2d'));
  let quality = 0.9;
  let blob;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    blob = await canvasToBlob(canvas, quality);
    if (blob.size <= TARGET_BYTES) break;
    if (quality > 0.48) {
      quality -= 0.1;
    } else {
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
  }

  return { blob, width, height };
};

const createAssetId = () => (
  globalThis.crypto?.randomUUID
    ? `canvas-asset-${globalThis.crypto.randomUUID()}`
    : `canvas-asset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
);

export async function saveCanvasAsset(file) {
  const { blob, width, height } = await compressImageFile(file);
  const record = {
    id: createAssetId(),
    name: file.name || '参考图',
    mimeType: blob.type || 'image/jpeg',
    size: blob.size,
    width,
    height,
    createdAt: Date.now(),
    blob,
  };

  await runTransaction('readwrite', (store) => store.put(record));
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
  };
}

export async function deleteCanvasAsset(assetId) {
  if (!assetId) return;
  await runTransaction('readwrite', (store) => store.delete(assetId));
}

const getCanvasAsset = async (assetId) => {
  if (!assetId) return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(assetId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('参考图读取失败'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('参考图读取失败'));
    };
  });
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('参考图读取失败'));
  reader.readAsDataURL(blob);
});

export async function resolveCanvasAssetDataUrls(assetReferences = []) {
  const uniqueReferences = Array.from(new Map(
    assetReferences.filter((asset) => asset?.id).map((asset) => [asset.id, asset]),
  ).values());
  const records = await Promise.all(uniqueReferences.map(async (reference) => ({
    reference,
    record: await getCanvasAsset(reference.id),
  })));
  const missingAssetIds = records.filter(({ record }) => !record?.blob).map(({ reference }) => reference.id);
  const resolvedAssets = await Promise.all(
    records
      .filter(({ record }) => record?.blob)
      .map(async ({ reference, record }) => ({
        assetId: reference.id,
        dataUrl: await blobToDataUrl(record.blob),
      })),
  );
  return {
    dataUrls: resolvedAssets.map((asset) => asset.dataUrl),
    resolvedAssets,
    missingAssetIds,
  };
}
