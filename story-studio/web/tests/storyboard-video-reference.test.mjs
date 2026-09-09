import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { attachStoryboardVideoImage, buildWebH3GenerationRequest, createCreativeSessionStore } from '../local-api.mjs';
import { applyProductionResult } from '../src/production-state.ts';
import { normalizeStoryboardVideoReferences, withStoryboardVideoGuide } from '../../src/videos/storyboard-video-references.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=', 'base64');
const dir = mkdtempSync(join(tmpdir(), 'prism-grid-reference-'));
writeFileSync(join(dir, 'grid.png'), png);
const board = { imageUrl: '/api/generated-images/grid.png', pictureTag: '<Picture 1>', panelCount: 3 };

test('storyboard attachment contains file bytes and rejects invalid or external media', () => {
  const input = { segment: { segmentKey: 'SEG003' }, storyboardReference: board };
  attachStoryboardVideoImage(input, dir);
  assert.equal(input.storyboardImage.data, readFileSync(join(dir, 'grid.png')).toString('base64'));
  assert.equal(input.storyboardImage.id, 'SEG003-storyboard');
  writeFileSync(join(dir, 'invalid.png'), 'not an image');
  for (const imageUrl of ['https://example.invalid/grid.png', '/api/generated-images/../grid.png', '/api/generated-images/invalid.png']) {
    assert.throws(() => attachStoryboardVideoImage({ ...input, storyboardReference: { ...board, imageUrl } }, dir));
  }
  assert.throws(() => attachStoryboardVideoImage({ ...input, referenceBindings: Array(10).fill({}) }, dir), /超过9张/u);
});

test('whole grid alone is a valid Ref2VA input and maps grouped panels to exact timeline ranges', () => {
  const prompt = { segmentKey: 'SEG003', status: 'complete', approval: 'approved', prompt: '基础设定\n人物位于室内。\n声音总则\n自然环境声。\n画面内容与镜头执行\n0—3秒：按<Picture 1>第1、2格，人物转身。\n3—5秒：按<Picture 1>第3格，人物停下。\n负面词\n拼版边框', referenceLayoutVersion: 2, referenceLabels: ['SEG003整张3宫格'], referenceImageUrls: [board.imageUrl], storyboardReference: board,
    plan: { videoPromptSections: { timelineBeats: [{ startSec: 0, endSec: 3, panelKeys: ['P01', 'P02'] }, { startSec: 3, endSec: 5, panelKeys: ['P03'] }] } } };
  const state = { storyboardSegments: [{ segmentKey: 'SEG003', title: '镜头', durationSec: 5 }], storyboardBoards: [{ segmentKey: 'SEG003', status: 'complete', imageUrl: board.imageUrl }], videoPrompts: [prompt] };
  const request = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG003', mode: 'reference' }, { generatedImageDirectory: dir });
  assert.equal(request.mode, 'reference');
  assert.deepEqual(request.referenceMediaPaths, [join(dir, 'grid.png')]);
  assert.match(request.prompt, /0—3秒对应第1、2格；3—5秒对应第3格/u);
  assert.match(request.prompt, /单幅全屏视频画面/u);
  assert.equal(withStoryboardVideoGuide(request.prompt, board, prompt.plan), request.prompt, 'guidance is idempotent');
  const edited = request.prompt.replace('0—3秒对应第1、2格；3—5秒对应第3格', '0—2秒对应第1、2格；2—5秒对应第3格');
  assert.equal(withStoryboardVideoGuide(edited, board, prompt.plan), edited, 'user-approved timeline edits survive an older structured draft');
  const filePath = join(dir, 'session.json');
  createCreativeSessionStore({ filePath }).save({ state: { step: 'workspace', ...state } });
  const restored = createCreativeSessionStore({ filePath }).load().state;
  assert.deepEqual(restored.videoPrompts[0].storyboardReference, board);
  assert.equal(restored.videoPrompts[0].referenceLayoutVersion, 2);
  assert.deepEqual(buildWebH3GenerationRequest({ state: restored }, { segmentKey: 'SEG003', mode: 'reference' }, { generatedImageDirectory: dir }).referenceMediaPaths, request.referenceMediaPaths);
  state.storyboardBoards[0].imageUrl = '/api/generated-images/new.png';
  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG003' }, { generatedImageDirectory: dir }), /故事板已变化/u);
  assert.equal(prompt.approval, 'approved', 'submission validation does not mutate saved work');
});

test('edited reference errors are blocked before H3 and remain intact after save', () => {
  for (const body of ['人物站立。', '0—5秒：按<>第1格站立。', '0—5秒：按<P01>第1格站立。']) {
    const prompt = { segmentKey: 'SEG003', status: 'complete', approval: 'approved', prompt: `基础设定\n人物站立。\n声音总则\n风声。\n画面内容与镜头执行\n${body}`, referenceLayoutVersion: 2, referenceLabels: ['SEG003整张3宫格'], referenceImageUrls: [board.imageUrl], storyboardReference: board };
    const state = { storyboardSegments: [{ segmentKey: 'SEG003', durationSec: 5 }], videoPrompts: [prompt] };
    const original = structuredClone(state);
    assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG003', mode: 'reference' }, { generatedImageDirectory: dir }), /引用需要修正/u);
    assert.deepEqual(state, original);
    const store = createCreativeSessionStore({ filePath: join(dir, `invalid-${body.length}.json`) });
    store.save({ state: { step: 'workspace', ...state } });
    assert.ok(store.load().state.videoPrompts[0].prompt.includes(body));
  }
});

test('centralized storyboard mapping survives save and builds H3 input without repeated picture labels', () => {
  for (const name of ['person.png', 'scene.png', 'prop.png']) writeFileSync(join(dir, name), png);
  const currentBoard = { ...board, pictureTag: '<Picture 4>' };
  const prompt = { segmentKey: 'SEG003', status: 'complete', approval: 'approved', referenceLayoutVersion: 2,
    referenceLabels: ['人物主图', '场景', '道具', 'SEG003整张3宫格'], referenceImageUrls: ['/api/generated-images/person.png', '/api/generated-images/scene.png', '/api/generated-images/prop.png', board.imageUrl], storyboardReference: currentBoard,
    prompt: '基础设定\n<Subject 1>是<Picture 1>中的人物。<Picture 2>控制房间空间。<Picture 3>控制杯子形制。\n声音总则\n风声。\n画面内容与镜头执行\n0—3秒：中景，<Subject 1>在桌边拿起杯子，低头看向杯口。\n3—5秒：他轻轻转动杯子，停在胸前。\n负面词\n拼版边框',
    plan: { videoPromptSections: { timelineBeats: [{ startSec: 0, endSec: 3, panelKeys: ['P01', 'P02'] }, { startSec: 3, endSec: 5, panelKeys: ['P03'] }] } },
  };
  const state = { storyboardSegments: [{ segmentKey: 'SEG003', durationSec: 5 }], storyboardBoards: [{ segmentKey: 'SEG003', status: 'complete', imageUrl: board.imageUrl }], videoPrompts: [prompt] };
  const snapshot = structuredClone(state);
  const store = createCreativeSessionStore({ filePath: join(dir, 'concise-reference.json') });
  store.save({ state: { step: 'workspace', ...state } });
  const restored = store.load();
  const request = buildWebH3GenerationRequest(restored, { segmentKey: 'SEG003' }, { generatedImageDirectory: dir });
  assert.equal((request.prompt.match(/<Picture 4>/gu) ?? []).length, 1);
  assert.deepEqual(request.referenceMediaPaths.map(path => path.split(/[\\/]/u).at(-1)), ['person.png', 'scene.png', 'prop.png', 'grid.png']);
  assert.doesNotMatch(request.prompt.split('画面内容与镜头执行')[1], /<Picture/u);
  assert.deepEqual(state, snapshot);
  const edited = structuredClone(restored);
  edited.state.videoPrompts[0].prompt = request.prompt.replace('3—5秒对应第3格', '3—5秒对应第2格');
  assert.throws(() => buildWebH3GenerationRequest(edited, { segmentKey: 'SEG003' }, { generatedImageDirectory: dir }), /完整覆盖/u);
  assert.match(edited.state.videoPrompts[0].prompt, /3—5秒对应第2格/u);
});

test('old reference order migration is stable and preserves the authored prompt and diagnostics', () => {
  const old = { prompt: '<Picture 1>中的角色', error: '已保留诊断', referenceLabels: ['SEG001整张六宫格', '角色'], referenceImageUrls: ['grid', 'character'] };
  const current = normalizeStoryboardVideoReferences(old);
  assert.deepEqual(current.referenceImageUrls, ['character', 'grid']);
  assert.equal(current.storyboardReference.pictureTag, '<Picture 2>');
  assert.equal(current.prompt, old.prompt);
  assert.equal(current.error, old.error);
  assert.deepEqual(normalizeStoryboardVideoReferences(current), current);
  assert.deepEqual(old.referenceImageUrls, ['grid', 'character']);
});

test('replacing one storyboard invalidates only its downstream approval while retaining all media', () => {
  const state = { storyboardBoards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: 'old' }], videoPrompts: [{ segmentKey: 'SEG001', prompt: '正文1', status: 'complete', approval: 'approved' }, { segmentKey: 'SEG002', prompt: '正文2', status: 'complete', approval: 'approved' }], shotVideoTasks: [{ segmentKey: 'SEG001', status: 'awaiting_review', outputPaths: ['old.mp4'] }] };
  const next = applyProductionResult(state, { id: 'board-job', revision: 1, status: 'completed', route: '/api/storyboards/boards', result: { boards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: 'new' }] } });
  assert.equal(next.videoPrompts[0].status, 'stale');
  assert.equal(next.videoPrompts[0].prompt, '正文1');
  assert.equal(next.videoPrompts[1].approval, 'approved');
  assert.deepEqual(next.shotVideoTasks[0].outputPaths, ['old.mp4']);
  assert.equal(next.shotVideoTasks[0].stale, true);
  const unchanged = applyProductionResult(state, { id: 'board-job', revision: 2, status: 'completed', route: '/api/storyboards/boards', result: { boards: state.storyboardBoards } });
  assert.equal(unchanged.videoPrompts[0].approval, 'approved');
});
