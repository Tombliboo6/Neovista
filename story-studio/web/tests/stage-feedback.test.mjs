import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStageFeedback } from '../src/stage-feedback.ts';

test('citation wording and index diagnostics do not require user attention', () => {
  const result = groupStageFeedback('阿岚：S01的引用未匹配剧本原句；S02的引用未匹配剧本原句。\n阿岚：S01的引用未匹配剧本原句。');
  assert.equal(result.diagnostic.length, 2);
  assert.deepEqual(result.actionable, []);
  assert.deepEqual(result.optional, []);
});

test('mixed messages preserve failures, wrong references and character risks', () => {
  const input = ['阿岚：S01的引用未匹配剧本原句；所选原文编号不存在，需要重新绑定剧本依据。', '小禾：当前剧本正文未找到此人物名称，请确认是否保留档案', 'SEG001：图片生成失败，请检查服务连接', 'SEG002：引用了未上传的图片'];
  const original = JSON.stringify(input);
  const result = groupStageFeedback(input);
  assert.equal(result.actionable.length, 4);
  assert.match(result.actionable[0], /^阿岚：所选原文编号不存在/u);
  assert.equal(result.diagnostic.length, 1);
  assert.equal(JSON.stringify(input), original);
});

test('ordinary suggestions and unfamiliar messages remain available for optional review', () => {
  assert.deepEqual(groupStageFeedback(['镜头节奏可以舒缓一些', '服务返回新的状态码 Q17']).optional, ['镜头节奏可以舒缓一些', '服务返回新的状态码 Q17']);
  assert.deepEqual(groupStageFeedback(undefined), { actionable: [], optional: [], diagnostic: [] });
});

test('real risks override diagnostic wording and retain their identity', () => {
  const result = groupStageFeedback('人物身份冲突，引用未匹配剧本原句');
  assert.equal(result.actionable.length, 1);
  assert.equal(result.diagnostic.length, 0);
});
