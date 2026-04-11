export const INITIAL_GALLERY_VISIBLE_COUNT = 16;
export const GALLERY_BATCH_SIZE = 12;
export const EAGER_GALLERY_IMAGE_COUNT = 4;

export function getGalleryCardMediaPresentation() {
  return {
    wrapperClassName: 'w-full bg-slate-100 px-3 pt-3',
    imgClassName: 'mx-auto block w-full h-auto object-contain',
    style: undefined,
  };
}

export function getPrimaryTemplateImage(images = []) {
  return images.length > 0 ? images[images.length - 1] : null;
}

export function getNextVisibleCount(currentCount, totalCount, batchSize = GALLERY_BATCH_SIZE) {
  return Math.min(totalCount, currentCount + batchSize);
}

export function getImageLoadingStrategy(index, eagerCount = EAGER_GALLERY_IMAGE_COUNT) {
  if (index < eagerCount) {
    return {
      loading: 'eager',
      fetchPriority: 'high',
    };
  }

  return {
    loading: 'lazy',
    fetchPriority: 'auto',
  };
}
