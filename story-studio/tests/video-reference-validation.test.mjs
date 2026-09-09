import test from 'node:test';
import assert from 'node:assert/strict';
import { videoReferenceIssues } from '../src/videos/video-reference-validation.ts';
import { sanitizeCompiledVideoPrompt } from '../src/videos/video-prompt-generation.ts';
const bindings = [
  { pictureTag: '<Picture 1>', subjectTag: '<Subject 1>', assetKind: 'character' },
  { pictureTag: '<Picture 2>', assetKind: 'scene' },
  { pictureTag: '<Picture 3>', assetKind: 'prop' },
  { pictureTag: '<Picture 4>', assetKind: 'storyboard', panelCount: 3 },
];
const prompt = `基础设定
<Subject 1>是<Picture 1>中的人物。<Picture 2>控制村路空间。<Picture 3>控制草叶形制。
声音总则
自然风声。
画面内容与镜头执行
0—5秒：按<Picture 4>第1格建立<Picture 2>中的村路，<Subject 1>摊开手掌，<Picture 3>中的草叶浮起。
5—10秒：按<Picture 4>第2格，<Subject 1>注视草叶。
10—15秒：按<Picture 4>第3格，推近<Subject 1>的侧脸。
负面词
拼版边框`;
test('complete reference contract accepts chronological subject and visual bindings', () => {
  assert.deepEqual(videoReferenceIssues(prompt, bindings), []);
  assert.deepEqual(videoReferenceIssues(prompt.replaceAll('秒：按', '秒：\n按'), bindings), []);
});
test('incomplete mapping without a timed guide and missing subject use remain actionable', () => {
  const broken = '故事板参考：<Picture 4>第1、2、3格\n' + prompt.replaceAll('按<Picture 4>第2格', '切至近景').replaceAll('<Subject 1>注视', '人物注视');
  assert.match(videoReferenceIssues(broken, bindings).join(), /缺少可核对的画格与时间对应/);
  const noExecution = prompt.split('画面内容与镜头执行')[0] + '画面内容与镜头执行\n人物站立。';
  assert.match(videoReferenceIssues(noExecution, bindings).join(), /镜头执行缺少<Subject 1>/);
});
test('cleanup preserves malformed angle tags for diagnosis instead of producing empty brackets', () => {
  for (const token of ['<P04>', '< P04 >', '<Picture 4>', '<Subject 1>']) assert.equal(sanitizeCompiledVideoPrompt(token), token);
  for (const token of ['<P04>', '<>', '<Picture n>', '<Picture 99>']) assert.ok(videoReferenceIssues(prompt.replace('按<Picture 4>第2格', `按${token}第2格`), bindings).length);
});
test('negative terms cannot satisfy a missing execution reference', () => {
  const broken = prompt.replaceAll('<Subject 1>', '人物') + '\n<Subject 1>';
  assert.match(videoReferenceIssues(broken, bindings).join(), /镜头执行缺少<Subject 1>/);
});

const concise = `故事板参考：<Picture 4>是本段整张3宫格故事板，控制构图与镜头顺序。0—5秒对应第1格；5—10秒对应第2格；10—15秒对应第3格。
基础设定
<Subject 1>是<Picture 1>中的人物，保持身份和服装。<Picture 2>控制村路空间。<Picture 3>控制草叶形制。
声音总则
持续风声。
画面内容与镜头执行
0—5秒：中景，<Subject 1>位于村路中央，摊开手掌，草叶缓缓浮起。
5—10秒：他抬眼注视草叶，手掌停在胸前。
10—15秒：镜头推近侧脸，草叶在指尖上方停稳。
负面词
拼版边框`;

test('centralized mapping and source-only scene/prop references accept natural continuous action', () => {
  assert.deepEqual(videoReferenceIssues(concise, bindings), []);
  assert.equal((concise.match(/<Picture 4>/gu) ?? []).length, 1);
  const moved = concise.replace('基础设定\n<Subject 1>是<Picture 1>中的人物，保持身份和服装。', '角色资产参考：<Subject 1>是<Picture 1>中的人物，保持身份和服装。\n基础设定\n');
  assert.deepEqual(videoReferenceIssues(moved, bindings), []);
});

test('centralized mappings still reject omitted, swapped, duplicate and out-of-range panels', () => {
  for (const [before, after] of [
    ['；10—15秒对应第3格', ''], ['第2格', '第3格'], ['第3格', '第2格'], ['第3格', '第9格'],
    ['5—10秒对应', '6—10秒对应'], ['10—15秒对应', '10—14秒对应'],
  ]) assert.ok(videoReferenceIssues(concise.replace(before, after), bindings).length, after);
  assert.ok(videoReferenceIssues(concise.replace('5—10秒：他', '5—10秒：按<Picture 4>第1格，他'), bindings).some(issue => issue.includes('不一致')));
});

test('known labels cannot conceal a swapped subject source or satisfy use in the negative section', () => {
  const other = [...bindings, { pictureTag: '<Picture 5>', subjectTag: '<Subject 2>', assetKind: 'character' }];
  const paired = concise.replace('<Subject 1>是<Picture 1>', '<Subject 1>是<Picture 5>').replace('声音总则', '<Subject 2>是<Picture 1>中的第二人物。\n声音总则').replace('5—10秒：他', '5—10秒：<Subject 2>看着他');
  assert.match(videoReferenceIssues(paired, other).join(), /身份绑定/u);
  assert.match(videoReferenceIssues(concise.replace('<Subject 1>位于', '人物位于') + '\n<Subject 1>', bindings).join(), /镜头执行缺少/u);
});
