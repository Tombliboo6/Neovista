import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStoryboardBoardBatchRequest, generateStoryboardBoardBatchPartial, validateStoryboardBoardBatch } from '../src/storyboards/storyboard-board-batch.ts';

function input(segmentKey) {
  return {
    segment: { id: segmentKey, segmentKey, sceneKey: 'S01', order: Number(segmentKey.slice(3)), title: segmentKey, durationSec: 15, characters: ['张浩然'], sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: [], dialogueEvidenceIds: [], soundCueIds: [], referenceAssetIds: [], storyboardText: `${segmentKey}内容`, transition: 'continuous', groundedEvidence: [] },
    panelCount: 6, styleName: '3D玄幻', characterAnchor: '人物', sceneAnchor: '场景'
  };
}
function plan(label) {
  return {
    panelCount: 6,
    semanticDecision: { visibleCharacters: ['张浩然'], characterStates: [{ characterName: '张浩然', state: label }], visibleProps: [], sceneState: '雨夜', excludedElements: [], decisionBasis: ['剧本'] },
    referenceRequirements: { characters: ['张浩然'], sceneRequired: true, props: [], decisionBasis: ['人物与场景需要参考'] },
    panels: Array.from({ length: 6 }, (_, index) => {
      const secondShot = index >= 3;
      return {
        panelKey: `P${String(index + 1).padStart(2, '0')}`, order: index + 1, startSec: index * 2.5, endSec: (index + 1) * 2.5,
        shotGroupKey: secondShot ? 'SH02' : 'SH01', transitionFromPrevious: index === 0 ? 'initial' : index === 3 ? 'cut' : 'continuous', cutTrigger: index === 0 ? 'initial' : index === 3 ? 'attention-shift' : 'none',
        startState: `${label}状态${index}`, actionUnitKey: secondShot ? 'AU02' : 'AU01', actionOwner: '张浩然', actionSummary: secondShot ? `${label}回应` : `${label}行动`, actionPhase: index % 3 === 0 ? 'setup' : index % 3 === 1 ? 'progress' : 'complete', endState: `${label}状态${index + 1}`,
        shotSize: '中景', camera: '低机位', visual: `张浩然${label}${index}`, characters: ['张浩然'], visibleProps: []
      };
    }),
    imagePromptSections: { basicSetting: '3列×2行六格', atmosphereQualityPhotography: '电影', contentLayout: 'P01 P02 P03 P04 P05 P06', cameraImaging: '各格独立', negativeTerms: ['a', 'b', 'c', 'd', 'e'] }
  };
}

test('storyboard board batch requests ordered independent segment plans', () => {
  const request = buildStoryboardBoardBatchRequest([input('SEG002'), input('SEG003')]);
  assert.equal(request.maxOutputTokens, 60000);
  assert.equal(request.input.segments.length, 2);
  assert.equal(request.outputSchema.properties.items.minItems, 2);
  assert.match(request.instructions, /不得合并或遗漏/);
  assert.match(request.instructions, /必须生成最终答案/);
  assert.match(request.instructions, /完整可解析的JSON对象/);
  assert.match(request.instructions, /不得只输出推理过程/);
});

test('storyboard board batch validates every item in exact segment order', () => {
  const inputs = [input('SEG002'), input('SEG003')];
  assert.doesNotThrow(() => validateStoryboardBoardBatch({ items: [{ segmentKey: 'SEG002', plan: plan('二') }, { segmentKey: 'SEG003', plan: plan('三') }] }, inputs));
  assert.throws(() => validateStoryboardBoardBatch({ items: [{ segmentKey: 'SEG003', plan: plan('三') }, { segmentKey: 'SEG002', plan: plan('二') }] }, inputs), /must be SEG002/);
});

test('storyboard board batch identifies the malformed segment and field', () => {
  const inputs = [input('SEG002'), input('SEG003')];
  assert.throws(
    () => validateStoryboardBoardBatch({ items: [{ segmentKey: 'SEG002', plan: plan('二') }, { segmentKey: 'SEG003', plan: { panelCount: 6 } }] }, inputs),
    /SEG003 validation failed: plan\.panels must be an array/,
  );
});

test('partial storyboard validation preserves valid segments and reports only the malformed segment', async () => {
  const inputs = [input('SEG002'), input('SEG003')];
  const provider = {
    id: 'fake-agent',
    async health() { throw new Error('not used'); },
    async generate() {
      return {
        output: { items: [{ segmentKey: 'SEG002', plan: plan('二') }, { segmentKey: 'SEG003', plan: { panelCount: 6 } }] },
        providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };
  const result = await generateStoryboardBoardBatchPartial(provider, inputs);
  assert.deepEqual(result.output.items.map((item) => item.segmentKey), ['SEG002']);
  assert.deepEqual(result.validationErrors.map((item) => item.segmentKey), ['SEG003']);
  assert.match(result.validationErrors[0].message, /plan\.panels must be an array/);
});

test('partial storyboard validation accepts every segment when only model bookkeeping drifts', async () => {
  const inputs = [input('SEG002'), input('SEG003')];
  const drifted = (label) => {
    const value = plan(label);
    value.panelCount = 9;
    value.panels.forEach((panel, index) => {
      panel.panelKey = 'P99';
      panel.order = 6 - index;
      panel.startSec = index + 0.1;
      panel.endSec = index + 0.2;
      panel.startState = `${label}不匹配${index}`;
      panel.shotGroupKey = 'SH09';
      panel.transitionFromPrevious = 'cut';
      panel.cutTrigger = 'none';
      panel.actionUnitKey = 'AU09';
      panel.actionPhase = 'complete';
    });
    value.imagePromptSections.basicSetting = '普通故事板';
    value.imagePromptSections.contentLayout = '';
    return value;
  };
  const provider = {
    id: 'fake-agent',
    async health() { throw new Error('not used'); },
    async generate() {
      return {
        output: { items: [{ segmentKey: 'SEG002', plan: drifted('二') }, { segmentKey: 'SEG003', plan: drifted('三') }] },
        providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };

  const result = await generateStoryboardBoardBatchPartial(provider, inputs);

  assert.deepEqual(result.validationErrors, []);
  assert.deepEqual(result.output.items.map((item) => item.segmentKey), ['SEG002', 'SEG003']);
  assert.deepEqual(result.output.items[0].plan.panels.map((panel) => panel.panelKey), ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
});
