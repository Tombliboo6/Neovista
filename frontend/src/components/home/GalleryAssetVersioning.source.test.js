import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const templateGallerySource = readFileSync(new URL('./TemplateGallery.jsx', import.meta.url), 'utf8');
const templateDetailSource = readFileSync(new URL('./TemplateDetailModal.jsx', import.meta.url), 'utf8');
const projectGridSource = readFileSync(new URL('./ProjectGrid.jsx', import.meta.url), 'utf8');
const promptGallerySource = readFileSync(new URL('../workspace/PromptGallery.jsx', import.meta.url), 'utf8');
const lazyImageSource = readFileSync(new URL('../common/LazyImage.jsx', import.meta.url), 'utf8');

test('gallery cards and eager image loading use the centralized versioned URL path', () => {
  assert.match(templateGallerySource, /getTemplatePreviewImage\(template\)/);
  assert.match(promptGallerySource, /getTemplateCarouselImages\(template\)/);
  assert.match(lazyImageSource, /getVersionedGalleryAssetUrl\(src\)/);
  assert.match(lazyImageSource, /src=\{resolvedSrc\}/);
});

test('gallery detail and recent-project images cannot bypass gallery versioning', () => {
  assert.match(templateDetailSource, /<LazyImage/);
  assert.match(projectGridSource, /src=\{getVersionedGalleryAssetUrl\(project\.image\)\}/);
});
