import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GALLERY_ASSET_RELEASE,
  getVersionedGalleryAssetUrl,
} from './galleryAssets.js';

test('getVersionedGalleryAssetUrl adds one stable release query to gallery media', () => {
  assert.equal(
    getVersionedGalleryAssetUrl('/gallery/image1.png'),
    `/gallery/image1.png?gallery_v=${GALLERY_ASSET_RELEASE}`,
  );
  assert.equal(
    getVersionedGalleryAssetUrl('/api/v1/template-thumbnails/demo.webp'),
    `/api/v1/template-thumbnails/demo.webp?gallery_v=${GALLERY_ASSET_RELEASE}`,
  );
  assert.equal(
    getVersionedGalleryAssetUrl('/static/template_images/original.png'),
    `/static/template_images/original.png?gallery_v=${GALLERY_ASSET_RELEASE}`,
  );
});

test('getVersionedGalleryAssetUrl is idempotent and replaces an older release', () => {
  const current = `/gallery/image1.png?gallery_v=${GALLERY_ASSET_RELEASE}`;
  assert.equal(getVersionedGalleryAssetUrl(current), current);
  assert.equal(
    getVersionedGalleryAssetUrl('/gallery/image1.png?size=small&gallery_v=old#preview'),
    `/gallery/image1.png?size=small&gallery_v=${GALLERY_ASSET_RELEASE}#preview`,
  );
});

test('getVersionedGalleryAssetUrl preserves unrelated and non-string values', () => {
  assert.equal(getVersionedGalleryAssetUrl('/api/v1/generated-images/demo.png'), '/api/v1/generated-images/demo.png');
  assert.equal(getVersionedGalleryAssetUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  assert.equal(getVersionedGalleryAssetUrl(null), null);
});
