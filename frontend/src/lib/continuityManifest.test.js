import test from 'node:test';
import assert from 'node:assert/strict';
import { compileShotGenerationDraft } from './continuityManifest.js';

const connectedGraph = ({ includeReference = true } = {}) => {
  const nodes = [
    { id: 'story', type: 'story', data: { title: '剧本', text: '三只鸭子完成校园任务。' } },
    {
      id: 'character',
      type: 'character',
      data: {
        name: '饭团',
        role: '学姐',
        description: '校园探索特工',
        appearanceNotes: '黄色圆润身体，蓝色领巾',
        wardrobeNotes: '蓝色领巾保持不变',
        negativePrompt: '不要改变领巾颜色',
        includeInGeneration: true,
        referenceAssets: includeReference ? [{ id: 'asset-1', name: '饭团人物板.jpg' }] : [],
      },
    },
    {
      id: 'scene',
      type: 'scene',
      data: {
        name: '校园广场',
        time: '清晨',
        description: '树荫与教学楼之间的广场',
        visualNotes: '晨光从画面左侧照入',
        includeInGeneration: true,
        referenceAssets: [],
      },
    },
    { id: 'continuity', type: 'continuity', data: { selectedRules: ['角色脸型与发型', '服装与道具', '场景光向', '镜头轴线'] } },
    { id: 'storyboard', type: 'storyboard', data: { aspectRatio: '16:9' } },
  ];
  const edges = [
    { source: 'story', target: 'storyboard', targetHandle: 'script' },
    { source: 'character', target: 'storyboard', targetHandle: 'character' },
    { source: 'scene', target: 'storyboard', targetHandle: 'scene' },
    { source: 'continuity', target: 'storyboard', targetHandle: 'continuity' },
  ];
  return { nodes, edges };
};

test('compiles only connected assets into an auditable Seedance draft', () => {
  const { nodes, edges } = connectedGraph();
  const draft = compileShotGenerationDraft({
    storyboardId: 'storyboard',
    shot: {
      id: 'shot-1',
      index: 1,
      title: '进入广场',
      prompt: '饭团走入校园广场',
      shotSize: '全景',
      camera: '缓慢推进',
      axis: '保持从左向右运动',
      duration: 6,
    },
    nodes,
    edges,
  });

  assert.equal(draft.ok, true);
  assert.equal(draft.referenceAssets.length, 1);
  assert.match(draft.prompt, /饭团/);
  assert.match(draft.prompt, /蓝色领巾保持不变/);
  assert.match(draft.prompt, /校园广场/);
  assert.match(draft.prompt, /保持从左向右运动/);
  assert.match(draft.prompt, /不要改变领巾颜色/);
  assert.match(draft.id, /^NV-[A-F0-9]{8}$/);
});

test('blocks compilation when a selected identity rule has no character reference', () => {
  const { nodes, edges } = connectedGraph({ includeReference: false });
  const draft = compileShotGenerationDraft({
    storyboardId: 'storyboard',
    shot: { id: 'shot-1', prompt: '饭团走入广场', axis: '从左向右', duration: 5 },
    nodes,
    edges,
  });

  assert.equal(draft.ok, false);
  assert.ok(draft.errors.some((error) => error.includes('没有参考图')));
});
