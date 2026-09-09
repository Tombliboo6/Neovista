import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_STORYBOARD_BOARD_PANEL_COUNT, buildStoryboardBoardPlanRequest, compileStoryboardBoardImagePrompt, normalizeStoryboardBoardPlan, normalizeStoryboardBoardPlanReferences, validateStoryboardBoardPlan } from '../src/storyboards/storyboard-board-generation.ts';

const segment = {
  id: 'set-seg001', segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '雨夜孤影', durationSec: 15,
  characters: ['张浩然'], sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: [], dialogueEvidenceIds: [], soundCueIds: [], referenceAssetIds: [],
  storyboardText: '雨夜荒野山道，张浩然冷冷开口。', transition: 'cut', groundedEvidence: []
};
const input = { segment, panelCount: 6, styleName: '3D玄幻', characterAnchor: '同一张浩然', sceneAnchor: '同一荒野山道' };
const directorPanels = Array.from({ length: 6 }, (_, index) => {
  const secondShot = index >= 3;
  const actionUnitKey = secondShot ? 'AU02' : 'AU01';
  return {
    panelKey: `P${String(index + 1).padStart(2, '0')}`, order: index + 1, startSec: index * 2.5, endSec: (index + 1) * 2.5,
    shotGroupKey: secondShot ? 'SH02' : 'SH01', transitionFromPrevious: index === 0 ? 'initial' : index === 3 ? 'cut' : 'continuous', cutTrigger: index === 0 ? 'initial' : index === 3 ? 'attention-shift' : 'none',
    startState: `状态${index}`, actionUnitKey, actionOwner: '张浩然', actionSummary: secondShot ? '张浩然回应画外动静' : '张浩然在雨中站稳', actionPhase: index % 3 === 0 ? 'setup' : index % 3 === 1 ? 'progress' : 'complete', endState: `状态${index + 1}`,
    shotSize: '中景', camera: '低机位', visual: `张浩然完成动作${index + 1}`, characters: ['张浩然'], visibleProps: []
  };
});
const plan = {
  panelCount: 6,
  semanticDecision: { visibleCharacters: ['张浩然'], characterStates: [{ characterName: '张浩然', state: '雨中' }], visibleProps: [], sceneState: '雨夜山道', excludedElements: [], decisionBasis: ['剧本'] },
  referenceRequirements: { characters: ['张浩然'], sceneRequired: true, props: [], decisionBasis: ['人物与场景需要参考'] },
  panels: directorPanels,
  imagePromptSections: { basicSetting: '六宫格基础设定', atmosphereQualityPhotography: '电影风格', contentLayout: '3列×2行，P01动作1，P02动作2，P03动作3，P04动作4，P05动作5，P06动作6。', cameraImaging: '按各格机位', negativeTerms: ['格数错误', '人物漂移', '文字', '水印', '场景漂移'] }
};

test('storyboard boards default to a selectable three-panel layout', () => {
  assert.equal(DEFAULT_STORYBOARD_BOARD_PANEL_COUNT, 3);
  const request = buildStoryboardBoardPlanRequest({ ...input, panelCount: undefined });
  assert.equal(request.input.panelCount, 3);
  assert.equal(request.outputSchema.properties.panels.minItems, 3);
  assert.equal(request.outputSchema.properties.panelCount, undefined);
  assert.equal(request.outputSchema.properties.panels.items.properties.panelKey, undefined);
  assert.equal(request.outputSchema.properties.imagePromptSections.properties.contentLayout, undefined);
  assert.equal(request.outputSchema.properties.imagePromptSections.properties.negativeTerms.minItems, undefined);
  assert.equal(request.outputSchema.properties.imagePromptSections.properties.negativeTerms.maxItems, undefined);
  const normalized = normalizeStoryboardBoardPlan(plan, input);
  assert.doesNotMatch(normalized.imagePromptSections.basicSetting, /3:2/);
});

test('every supported storyboard count normalizes, validates, and compiles with its own layout', () => {
  const layouts = new Map([[3, '3列×1行'], [4, '2列×2行'], [6, '3列×2行'], [9, '3列×3行']]);
  for (const [panelCount, layout] of layouts) {
    const variableInput = { ...input, panelCount };
    const draft = structuredClone(plan);
    draft.panels = Array.from({ length: panelCount }, (_, index) => ({
      ...directorPanels[index % directorPanels.length],
      panelKey: `P${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      visual: `张浩然完成动作${index + 1}`,
      startState: `状态${index}`,
      endState: `状态${index + 1}`,
    }));
    const normalized = normalizeStoryboardBoardPlan(draft, variableInput);
    assert.equal(normalized.panelCount, panelCount);
    assert.equal(normalized.panels.length, panelCount);
    assert.doesNotThrow(() => validateStoryboardBoardPlan(normalized, 15, panelCount));
    const prompt = compileStoryboardBoardImagePrompt(variableInput, normalized);
    assert.match(prompt, new RegExp(layout, 'u'));
    assert.match(prompt, new RegExp(`P${String(panelCount).padStart(2, '0')}`, 'u'));
  }
});

test('program assigns stable panel IDs while preserving model timing and visual content', () => {
  const drifted = structuredClone(plan);
  drifted.panelCount = 4;
  drifted.panels.forEach((panel, index) => {
    panel.panelKey = `坏编号${index}`;
    panel.order = 99 - index;
    panel.startSec = index === 0 ? 1 : index * 2;
    panel.endSec = index * 2 + 1;
    panel.startState = `模型写法${index}`;
    panel.shotGroupKey = index % 2 ? 'SH09' : 'SH03';
    panel.transitionFromPrevious = index === 0 ? 'cut' : 'initial';
    panel.cutTrigger = 'none';
    panel.actionUnitKey = index < 2 ? 'AU09' : index < 5 ? 'AU03' : 'AU09';
    panel.actionPhase = 'complete';
  });
  drifted.imagePromptSections.basicSetting = '普通故事板';
  drifted.imagePromptSections.contentLayout = '没有画格编号';
  drifted.imagePromptSections.cameraImaging = '';

  const normalized = normalizeStoryboardBoardPlan(drifted, input);

  assert.equal(normalized.panelCount, 6);
  assert.deepEqual(normalized.panels.map((panel) => panel.panelKey), ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
  assert.deepEqual(normalized.panels.map((panel) => [panel.startSec, panel.endSec]), drifted.panels.map(panel => [panel.startSec, panel.endSec]));
  assert.equal(normalized.panels[1].startState, drifted.panels[1].startState);
  assert.match(normalized.imagePromptSections.basicSetting, /3列×2行/);
  assert.match(normalized.imagePromptSections.contentLayout, /P01（1-1秒）/);
  assert.match(normalized.imagePromptSections.contentLayout, /P06（10-11秒）/);
  assert.match(normalized.panels[0].visual, /张浩然完成动作1/);
  assert.doesNotThrow(() => validateStoryboardBoardPlan(normalized, 15, 6));
});

test('six-panel plan covers the segment continuously', () => {
  assert.doesNotThrow(() => validateStoryboardBoardPlan(plan, 15, 6));
  const broken = structuredClone(plan);
  broken.panels[2].startSec = 4;
  assert.match(validateStoryboardBoardPlan(broken, 15, 6).join('\n'), /not continuous/);
});

test('AI continuity planning permits different state wording and cut decisions', () => {
  const brokenState = structuredClone(plan);
  brokenState.panels[1].startState = '人物和道具突然换位';
  assert.deepEqual(validateStoryboardBoardPlan(brokenState, 15, 6), []);

  const unjustifiedCut = structuredClone(plan);
  unjustifiedCut.panels[3].cutTrigger = 'none';
  assert.deepEqual(validateStoryboardBoardPlan(unjustifiedCut, 15, 6), []);
});

test('action phase labels are semantic planning data reviewed by the AI', () => {
  const duplicateCompletion = structuredClone(plan);
  duplicateCompletion.panels[1].actionPhase = 'complete';
  assert.deepEqual(validateStoryboardBoardPlan(duplicateCompletion, 15, 6), []);

  const repeatedUnit = structuredClone(plan);
  repeatedUnit.panels[4].actionUnitKey = 'AU01';
  repeatedUnit.panels[4].actionSummary = '张浩然在雨中站稳';
  assert.deepEqual(validateStoryboardBoardPlan(repeatedUnit, 15, 6), []);
});

test('malformed plans report missing fields instead of throwing TypeError', () => {
  assert.throws(
    () => validateStoryboardBoardPlan({ panelCount: 6 }, 15, 6),
    (error) => error instanceof Error && error.constructor.name === 'Error' && /plan\.panels must be an array/.test(error.message),
  );
  const warnings = validateStoryboardBoardPlan({ panelCount: 6, panels: [], semanticDecision: {}, referenceRequirements: { characters: null, props: null, sceneRequired: true }, imagePromptSections: {} }, 15, 6);
  assert.match(warnings.join('\n'), /plan\.semanticDecision is invalid/);
  assert.match(warnings.join('\n'), /plan\.referenceRequirements is invalid/);
});

test('compiled image prompt owns the selected six-panel board layout', () => {
  const prompt = compileStoryboardBoardImagePrompt(input, plan);
  assert.match(prompt, /3列×2行/);
  assert.match(prompt, /P01/);
  assert.match(prompt, /P06/);
  assert.match(prompt, /动作1/);
  assert.match(prompt, /动作6/);
  assert.match(prompt, /负面词/);
});

test('reference requirements can exclude transient visible material without removing it from the scene', () => {
  const withBlood = structuredClone(plan);
  withBlood.semanticDecision.visibleProps = [{ propName: '污血', state: '被雨水稀释' }];
  withBlood.referenceRequirements = { characters: ['张浩然'], sceneRequired: true, props: [], decisionBasis: ['污血是临时物质，不需要资产图'] };
  assert.doesNotThrow(() => validateStoryboardBoardPlan(withBlood, 15, 6));
  withBlood.referenceRequirements.props = [{ propName: '不存在的道具', state: '激活' }];
  assert.deepEqual(validateStoryboardBoardPlan(withBlood, 15, 6), []);
});

test('approved reference candidates preserve director judgment and complete visible prepared props', () => {
  const drifted = structuredClone(plan);
  drifted.semanticDecision.visibleProps = [{ propName: '充电盒', state: '打开' }, { propName: '耳机', state: '升起' }];
  drifted.panels[4].visibleProps = ['充电盒'];
  drifted.panels[5].visibleProps = ['充电盒', '耳机'];
  drifted.referenceRequirements = { characters: ['陈曜'], sceneRequired: false, props: [{ propName: '充电盒', state: '打开' }], decisionBasis: ['总导演按可见内容选择'] };
  const normalized = normalizeStoryboardBoardPlanReferences(drifted, {
    ...input,
    allowedReferenceContext: { characters: ['张浩然'], sceneRequired: true, props: [{ propName: '充电盒', state: 'dormant' }, { propName: '耳机', state: 'dormant' }] },
  });

  assert.deepEqual(normalized.referenceRequirements, {
    characters: ['张浩然'],
    sceneRequired: false,
    props: [{ propName: '充电盒', state: 'dormant' }, { propName: '耳机', state: 'dormant' }],
    decisionBasis: ['总导演按可见内容选择'],
  });
  assert.doesNotThrow(() => validateStoryboardBoardPlan(normalized, 15, 6, {
    characters: ['张浩然'], sceneRequired: true, props: [{ propName: '充电盒', state: 'dormant' }, { propName: '耳机', state: 'dormant' }],
  }));
});

test('approved character reference may represent a photo, advertisement, or video without physical presence', () => {
  const mediated = structuredClone(plan);
  mediated.semanticDecision.visibleCharacters = ['张浩然'];
  mediated.referenceRequirements.characters = ['张浩然', '陈曜'];

  assert.doesNotThrow(() => validateStoryboardBoardPlan(mediated, 15, 6, {
    characters: ['张浩然', '陈曜'],
    sceneRequired: true,
    props: [],
  }));
  assert.doesNotThrow(() => compileStoryboardBoardImagePrompt({
    ...input,
    allowedReferenceContext: { characters: ['张浩然', '陈曜'], sceneRequired: true, props: [] },
  }, mediated));
  assert.deepEqual(validateStoryboardBoardPlan(mediated, 15, 6), []);
});
