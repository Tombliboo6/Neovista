export const SEEDANCE_REFERENCE_VIDEO_MAX_BYTES = 24 * 1024 * 1024;
export const SEEDANCE_REFERENCE_VIDEO_MAX_DURATION_SECONDS = 15;

const MIME_TYPES_BY_EXTENSION = {
  '.mp4': new Set(['video/mp4', 'application/mp4']),
  '.webm': new Set(['video/webm']),
  '.mov': new Set(['video/quicktime']),
};

export function validateSeedanceReferenceVideoFile(file) {
  if (!file || typeof file.name !== 'string') {
    throw new Error('请选择参考视频文件');
  }

  const filename = file.name.trim();
  const extension = filename.includes('.')
    ? `.${filename.split('.').pop().toLowerCase()}`
    : '';
  const allowedMimeTypes = MIME_TYPES_BY_EXTENSION[extension];
  const mimeType = String(file.type || '').split(';', 1)[0].trim().toLowerCase();
  if (!allowedMimeTypes || (mimeType && mimeType !== 'application/octet-stream' && !allowedMimeTypes.has(mimeType))) {
    throw new Error('参考视频仅支持 MP4、WebM 或 MOV 格式');
  }

  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('参考视频文件为空');
  }
  if (size > SEEDANCE_REFERENCE_VIDEO_MAX_BYTES) {
    throw new Error('参考视频不能超过 24MB');
  }
  return file;
}

export function validateSeedanceReferenceVideoDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('无法读取参考视频时长');
  }
  if (duration > SEEDANCE_REFERENCE_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error('参考视频不能超过 15 秒');
  }
  return duration;
}

export function readSeedanceReferenceVideoDuration(file) {
  validateSeedanceReferenceVideoFile(file);
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      try {
        const duration = validateSeedanceReferenceVideoDuration(video.duration);
        cleanup();
        resolve(duration);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('无法读取参考视频，请检查文件是否损坏'));
    };
    video.src = objectUrl;
  });
}
