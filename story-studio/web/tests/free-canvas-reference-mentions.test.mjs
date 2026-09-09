import assert from 'node:assert/strict';
import test from 'node:test';

const mentions = await import(new URL(`../src/free-canvas-reference-mentions.ts?test=${Date.now()}`, import.meta.url));

test('free canvas reference mention opens at the cursor and closes after a complete token', () => {
  assert.deepEqual(mentions.findFreeCanvasReferenceMention('人物看向@', 5), { start: 4, end: 5, query: '' });
  assert.deepEqual(mentions.findFreeCanvasReferenceMention('使用@图片', 5), { start: 2, end: 5, query: '图片' });
  assert.equal(mentions.findFreeCanvasReferenceMention('使用@图片1', 6), null);
  assert.equal(mentions.findFreeCanvasReferenceMention('mail@test', 9), null);
});

test('free canvas reference mentions compile to H3 tags and validate available media', () => {
  assert.equal(
    mentions.compileFreeCanvasReferenceMentions('保持@图片1构图，参考@视频1动作，使用@音频1。', { image: 1, video: 1, audio: 1 }),
    '保持<Picture 1>构图，参考<Video 1>动作，使用<Audio 1>。',
  );
  assert.throws(() => mentions.compileFreeCanvasReferenceMentions('使用@图片2', { image: 1 }), /当前只有1项图片参考/u);
});

test('image reference mentions compile to ordered edit references and reject unsupported media', () => {
  assert.equal(
    mentions.compileFreeCanvasImageReferenceMentions('保持@图片1人物，把@图片2背景改为雨夜。', 2),
    '保持参考图1人物，把参考图2背景改为雨夜。',
  );
  assert.throws(() => mentions.compileFreeCanvasImageReferenceMentions('使用@图片2', 1), /当前只有1项图片参考/u);
  assert.throws(() => mentions.compileFreeCanvasImageReferenceMentions('参考@视频1动作', 1), /图片节点不能使用@视频1/u);
});
