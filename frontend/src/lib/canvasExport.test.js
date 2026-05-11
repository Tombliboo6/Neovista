import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFabricImageLoadOptions,
  safeCanvasToDataUrl,
} from './canvasExport.js';

test('safeCanvasToDataUrl returns data URLs from canvas-like objects', () => {
  const target = {
    toDataURL: (...args) => `data:image/png;base64,${args.join('|')}`,
  };

  assert.equal(
    safeCanvasToDataUrl(target, 'image/jpeg', 0.8),
    'data:image/png;base64,image/jpeg|0.8',
  );
});

test('safeCanvasToDataUrl returns null when export is blocked', () => {
  const target = {
    toDataURL: () => {
      throw new DOMException('Tainted canvases may not be exported', 'SecurityError');
    },
  };

  assert.equal(safeCanvasToDataUrl(target, 'image/png'), null);
  assert.equal(safeCanvasToDataUrl(null, 'image/png'), null);
});

test('getFabricImageLoadOptions avoids tainting remote canvas images', () => {
  assert.deepEqual(getFabricImageLoadOptions('https://assets.example.com/image.png'), {
    crossOrigin: 'anonymous',
  });
  assert.deepEqual(getFabricImageLoadOptions('/static/generated/image.png'), {
    crossOrigin: 'anonymous',
  });
  assert.deepEqual(getFabricImageLoadOptions('data:image/png;base64,abc'), {});
  assert.deepEqual(getFabricImageLoadOptions('blob:https://neotest.site/abc'), {});
});
