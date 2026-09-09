import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNovelText } from '../src/intake/normalize.ts';
import { createNovelDocument, preSplitNovel } from '../src/intake/pre-split.ts';

test('novel normalization is deterministic and removes transport-only formatting', () => {
  assert.equal(
    normalizeNovelText('\uFEFF第一章  \r\n\r\n\r\n内容一。  \r\n'),
    '第一章\n\n内容一。'
  );
});

test('chapter headings produce traceable segments without an API call', () => {
  const document = createNovelDocument({
    id: 'novel-fixture',
    title: '虚构测试小说',
    sourceName: 'fixture.txt',
    text: '第一章 起点\n人物进入房间。\n\n第二章 转折\n门外传来响声。',
    now: '2026-08-21T00:00:00.000Z'
  });

  const segments = preSplitNovel(document, {
    minimumCharacters: 5,
    targetCharacters: 20,
    maximumCharacters: 40
  });

  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((segment) => segment.heading), ['第一章 起点', '第二章 转折']);
  assert.deepEqual(segments.map((segment) => segment.order), [1, 2]);
  assert.equal(segments[0].text, document.text.slice(segments[0].sourceStart, segments[0].sourceEnd));
  assert.equal(segments[1].text, document.text.slice(segments[1].sourceStart, segments[1].sourceEnd));
});

test('long content prefers paragraph boundaries and keeps deterministic IDs', () => {
  const document = createNovelDocument({
    id: 'novel-long-fixture',
    title: '长文本测试',
    sourceName: 'long-fixture.txt',
    text: '甲'.repeat(12) + '\n\n' + '乙'.repeat(12) + '\n\n' + '丙'.repeat(12),
    now: '2026-08-21T00:00:00.000Z'
  });
  const options = {
    minimumCharacters: 8,
    targetCharacters: 14,
    maximumCharacters: 20
  };

  const first = preSplitNovel(document, options);
  const second = preSplitNovel(document, options);

  assert.ok(first.length > 1);
  assert.deepEqual(first.map((segment) => segment.id), second.map((segment) => segment.id));
  assert.equal(first.map((segment) => segment.text).join(''), document.text);
  assert.ok(first.every((segment) => segment.characterCount <= options.maximumCharacters));
});
