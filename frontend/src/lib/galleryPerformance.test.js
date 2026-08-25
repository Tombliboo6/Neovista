import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getGalleryApiEndpoint,
  getImageLoadingStrategy,
  getNextVisibleCount,
  getPrimaryTemplateImage,
  getTemplateCarouselImages,
  getTemplatePreviewImage,
} from './galleryPerformance.js';
import { GALLERY_ASSET_RELEASE } from './galleryAssets.js';

test('getPrimaryTemplateImage prefers the last gallery image and tolerates empty input', () => {
  assert.equal(getPrimaryTemplateImage([]), null);
  assert.equal(getPrimaryTemplateImage(['a.png', 'b.png', 'c.png']), 'c.png');
});

test('getNextVisibleCount increments in batches without overshooting the total', () => {
  assert.equal(getNextVisibleCount(12, 40, 12), 24);
  assert.equal(getNextVisibleCount(36, 40, 12), 40);
  assert.equal(getNextVisibleCount(40, 40, 12), 40);
});

test('getImageLoadingStrategy keeps only the first few cards eager', () => {
  assert.deepEqual(getImageLoadingStrategy(0, 4), {
    loading: 'eager',
    fetchPriority: 'high',
  });
  assert.deepEqual(getImageLoadingStrategy(3, 4), {
    loading: 'eager',
    fetchPriority: 'high',
  });
  assert.deepEqual(getImageLoadingStrategy(4, 4), {
    loading: 'lazy',
    fetchPriority: 'auto',
  });
});

test('getGalleryApiEndpoint uses the compact v1 template summary API', () => {
  assert.equal(getGalleryApiEndpoint(), '/api/v1/templates');
});

test('getTemplatePreviewImage prefers generated thumbnails over original images', () => {
  assert.equal(
    getTemplatePreviewImage({
      thumbnail_image: '/api/v1/template-thumbnails/demo.webp',
      images: ['/static/template_images/original.png'],
    }),
    `/api/v1/template-thumbnails/demo.webp?gallery_v=${GALLERY_ASSET_RELEASE}`,
  );
  assert.equal(
    getTemplatePreviewImage({ images: ['/a.png', '/b.png'] }),
    '/b.png',
  );
  assert.equal(getTemplatePreviewImage({ images: [] }), null);
  assert.equal(
    getTemplatePreviewImage({ images: ['/gallery/image1.png'] }),
    `/gallery/image1.png?gallery_v=${GALLERY_ASSET_RELEASE}`,
  );
});

test('getTemplateCarouselImages keeps modal cards on thumbnails when available', () => {
  assert.deepEqual(
    getTemplateCarouselImages({
      thumbnail_image: '/api/v1/template-thumbnails/demo.webp',
      images: ['/static/template_images/original.png'],
    }),
    [`/api/v1/template-thumbnails/demo.webp?gallery_v=${GALLERY_ASSET_RELEASE}`],
  );
  assert.deepEqual(
    getTemplateCarouselImages({ images: ['/a.png', '/b.png'] }),
    ['/a.png', '/b.png'],
  );
  assert.deepEqual(
    getTemplateCarouselImages({ images: ['/gallery/image1.png', '/gallery/image2.png'] }),
    [
      `/gallery/image1.png?gallery_v=${GALLERY_ASSET_RELEASE}`,
      `/gallery/image2.png?gallery_v=${GALLERY_ASSET_RELEASE}`,
    ],
  );
});
