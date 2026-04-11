import test from 'node:test';
import assert from 'node:assert/strict';

import { getGalleryCardMediaPresentation } from './galleryPerformance.js';

test('getGalleryCardMediaPresentation preserves full images in gallery cards', () => {
  assert.deepEqual(getGalleryCardMediaPresentation(), {
    wrapperClassName: 'w-full bg-slate-100 px-3 pt-3',
    imgClassName: 'mx-auto block w-full h-auto object-contain',
    style: undefined,
  });
});
