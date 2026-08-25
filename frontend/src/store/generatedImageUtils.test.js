import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeneratedImageMessage,
  getGeneratedImageUrlOrThrow,
  summarizeGeneratedImageUrl,
} from './generatedImageUtils.js';

test('getGeneratedImageUrlOrThrow returns image_url when present', () => {
  const imageUrl = getGeneratedImageUrlOrThrow({
    image_url: 'data:image/png;base64,abc123',
  });

  assert.equal(imageUrl, 'data:image/png;base64,abc123');
});

test('getGeneratedImageUrlOrThrow throws when image_url is missing', () => {
  assert.throws(
    () => getGeneratedImageUrlOrThrow({ timestamp: Date.now() }),
    /未返回图片数据/
  );
});

test('buildGeneratedImageMessage keeps image and template metadata', () => {
  const message = buildGeneratedImageMessage({
    imageUrl: 'data:image/png;base64,abc123',
    templateName: '测试模版',
    content: '图片已生成！',
    prompt: '实际发送的分析图提示词',
  });

  assert.deepEqual(message, {
    role: 'assistant',
    content: '图片已生成！',
    imageUrl: 'data:image/png;base64,abc123',
    templateName: '测试模版',
    prompt: '实际发送的分析图提示词',
  });
});

test('summarizeGeneratedImageUrl reports stable diagnostics', () => {
  const summary = summarizeGeneratedImageUrl('data:image/png;base64,abcdefghijklmnopqrstuvwxyz');

  assert.equal(summary.kind, 'data-url');
  assert.equal(summary.length, 48);
  assert.match(summary.preview, /^data:image\/png;base64,/);
});
