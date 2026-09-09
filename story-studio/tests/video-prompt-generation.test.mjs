import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEpisodeVideoPromptBatchRequest, buildEpisodeVideoPromptRepairRequest, buildSegmentVideoPromptRequest, compileSegmentVideoPrompt, compileSegmentVideoPromptDraft, normalizeSegmentVideoPromptBookkeeping, normalizeSegmentVideoPromptReferences, sanitizeCompiledVideoPrompt, validateEpisodeVideoPromptBatch, validateSegmentVideoPromptPlan } from '../src/videos/video-prompt-generation.ts';

const segment = {
  id: 'seg001', segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '雨夜孤影', durationSec: 15,
  characters: ['张浩然'], sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: ['A1'], dialogueEvidenceIds: ['D1'], soundCueIds: ['S1'], referenceAssetIds: [], transition: 'cut',
  storyboardText: '暴雨中张浩然冷冷开口。',
  groundedEvidence: [{ evidenceId: 'D1', sceneKey: 'S01', kind: 'dialogue', text: '出来吧，何必遮遮掩掩的。', speakerName: '张浩然', delivery: '冷冷开口' }]
};
const directorPanels = Array.from({ length: 6 }, (_, index) => {
  const secondShot = index >= 3;
  return {
    panelKey: `P${String(index + 1).padStart(2, '0')}`, order: index + 1, startSec: index * 2.5, endSec: (index + 1) * 2.5,
    shotGroupKey: secondShot ? 'SH02' : 'SH01', transitionFromPrevious: index === 0 ? 'initial' : index === 3 ? 'cut' : 'continuous', cutTrigger: index === 0 ? 'initial' : index === 3 ? 'attention-shift' : 'none',
    startState: `状态${index}`, actionUnitKey: secondShot ? 'AU02' : 'AU01', actionOwner: '张浩然', actionSummary: secondShot ? '张浩然向画外人物发问' : '张浩然在雨中站稳', actionPhase: index % 3 === 0 ? 'setup' : index % 3 === 1 ? 'progress' : 'complete', endState: `状态${index + 1}`,
    shotSize: '中景', camera: '低机位', visual: `张浩然完成动作${index + 1}`, characters: ['张浩然'], visibleProps: []
  };
});
const boardPlan = {
  panelCount: 6,
  semanticDecision: { visibleCharacters: ['张浩然'], characterStates: [{ characterName: '张浩然', state: '湿透空手' }], visibleProps: [], sceneState: '暴雨夜山道', excludedElements: ['林无双'], decisionBasis: ['剧本'] },
  panels: directorPanels,
  imagePromptSections: { basicSetting: '六格', atmosphereQualityPhotography: '雨夜', contentLayout: '3列×2行 P01 P02 P03 P04 P05 P06', cameraImaging: '机位', negativeTerms: ['a', 'b', 'c', 'd', 'e'] }
};
const input = { segment, boardPlan, styleName: '3D玄幻', sceneAssetKey: 'L01' };
const plan = {
  segmentKey: 'SEG001', durationSec: 15,
  referenceRequirements: { storyboardBoardRequired: true, characters: [{ characterName: '张浩然', role: '锁定身份' }], scene: { required: true, sceneAssetKey: 'L01', role: '锁定空间' }, props: [], decisionBasis: ['本段语义'] },
  videoPromptSections: {
    basicSetting: '3D玄幻，暴雨夜荒野山道，张浩然空手。',
    soundPolicy: '无背景音乐，无旁白，保留对白与持续雨声。',
    atmosphereQualityPhotography: '冷青色电影质感。',
    shotExecution: 'P01 0-2.5秒。P02 2.5-5秒。P03 5-7.5秒。P04 7.5-10秒，张浩然说：“出来吧，何必遮遮掩掩的。” P05 10-12.5秒。P06 12.5-15秒。',
    negativeTerms: ['第二人物', '道具', '字幕', '身份漂移', '场景漂移']
  }
};

test('single, batch and repair share concise references and compile grouped storyboard mapping once', () => {
  const boundInput = { ...structuredClone(input), referenceBindings: [
    { pictureTag: '<Picture 1>', label: '张浩然', entityName: '张浩然', role: '身份', assetKind: 'character', subjectTag: '<Subject 1>' },
    { pictureTag: '<Picture 2>', label: '六宫格', entityName: 'SEG001', role: '构图', assetKind: 'storyboard' },
  ] };
  const draft = normalizeSegmentVideoPromptBookkeeping({ videoPromptSections: {
    basicSetting: '雨夜山道。<Subject 1>是<Picture 1>中的张浩然，保持身份和服装。',
    soundPolicy: '无背景音乐，无旁白；保留对白和持续雨声。', atmosphereQualityPhotography: '冷青色电影质感。',
    timelineBeats: [
      { panelKeys: ['P01', 'P02', 'P03'], execution: '中景，<Subject 1>在雨中站稳，衣角随风摆动。' },
      { panelKeys: ['P04', 'P05', 'P06'], execution: '切至近景，<Subject 1>冷冷开口：“出来吧，何必遮遮掩掩的。”' },
    ], negativeTerms: ['身份漂移', '拼版边框', '字幕水印', '多余人物', '多余道具'],
  } }, boundInput);
  const requests = [buildSegmentVideoPromptRequest(boundInput), buildEpisodeVideoPromptBatchRequest([boundInput]),
    buildEpisodeVideoPromptRepairRequest([{ input: boundInput, draft, validationCodes: ['reference_binding_missing'], validationIssues: ['检查主体出场'] }])];
  for (const request of requests) {
    assert.match(request.instructions, /来源定义一次，实际作用处引用/u);
    assert.doesNotMatch(request.instructions, /每个故事板时间段的execution必须|人物每次作为动作|各时间段引用本段故事板/u);
  }
  const compiled = compileSegmentVideoPrompt(boundInput, draft, '人物与故事板');
  assert.equal((compiled.match(/<Picture 2>/gu) ?? []).length, 1);
  assert.match(compiled, /0—7.5秒对应第1、2、3格；7.5—15秒对应第4、5、6格/u);
  assert.doesNotMatch(compiled.split('画面内容与镜头执行')[1], /<Picture|P0\d|开始状态|结束状态/u);
  const bad = structuredClone(draft);
  bad.videoPromptSections.timelineBeats[1].panelKeys = ['P04', 'P06'];
  assert.throws(() => compileSegmentVideoPrompt(boundInput, bad, ''), /panel keys|画格/u);
});

test('batched drafting and targeted repair retain segment-scoped image attachments outside the text JSON', () => {
  const inputs = ['SEG001', 'SEG009'].map(key => ({ ...structuredClone(input), segment: { ...segment, segmentKey: key }, storyboardImage: { id: `${key}-storyboard`, description: `${key}专用图`, mediaType: 'image/png', data: `${key}-bytes` } }));
  const request = buildEpisodeVideoPromptBatchRequest(inputs);
  assert.deepEqual(request.images.map(image => image.id), ['SEG001-storyboard', 'SEG009-storyboard']);
  assert.deepEqual(request.input.segments.map(item => item.storyboardImageId), request.images.map(image => image.id));
  assert.equal(JSON.stringify(request.input).includes('-bytes'), false);
  const repair = buildEpisodeVideoPromptRepairRequest([{ input: inputs[1], draft: plan, validationCodes: ['manual_draft_review'], validationIssues: ['调整最后一格'] }]);
  assert.deepEqual(repair.images.map(image => image.id), ['SEG009-storyboard']);
  assert.equal(repair.input.segments.length, 1);
});

test('video prompt request uses structured panels when no readable image is attached', () => {
  const request = buildSegmentVideoPromptRequest(input);
  assert.equal(request.maxOutputTokens, 60000);
  assert.equal(request.input.panelCount, 6);
  assert.deepEqual(request.input.panelPlan, boardPlan.panels);
  assert.match(request.instructions, /不宣称已看图/);
  assert.match(request.instructions, /internal_monologue/);
  assert.match(request.instructions, /最小完整控制/);
  assert.match(request.instructions, /自主输出自然语言正文/);
  assert.equal(request.input.executionConstraints.mergeAdjacentPanels, true);
  assert.equal(request.input.executionConstraints.timingAndCameraPlanning, 'ai');
  assert.deepEqual(request.outputSchema.required, ['videoPromptSections']);
  assert.deepEqual(request.outputSchema.properties.videoPromptSections.required, ['basicSetting', 'soundPolicy', 'atmosphereQualityPhotography', 'timelineBeats', 'negativeTerms']);
  assert.deepEqual(request.outputSchema.properties.videoPromptSections.properties.timelineBeats.items.required, ['panelKeys', 'startSec', 'endSec', 'shotGroupKey', 'transitionFromPrevious', 'cutTrigger', 'startState', 'endState', 'actionUnitKeys', 'execution']);
  assert.equal(request.outputSchema.properties.videoPromptSections.properties.negativeTerms.minItems, undefined);
  assert.equal(request.outputSchema.properties.videoPromptSections.properties.negativeTerms.maxItems, undefined);
  assert.equal(request.outputSchema.properties.videoPromptSections.properties.timelineBeats.items.properties.startSec.type, 'number');
  assert.equal('referenceRequirements' in request.outputSchema.properties, false);
  assert.equal('shotExecution' in request.outputSchema.properties.videoPromptSections.properties, false);
  assert.equal('storyboardImagePath' in request.input, false);
});

test('video prompt reference bindings keep uploaded picture order and require stable subject use', () => {
  const referenceInput = structuredClone(input);
  referenceInput.referenceBindings = [
    { pictureTag: '<Picture 1>', label: '张浩然角色主图', assetKind: 'character', entityName: '张浩然', role: '仅锁定人物身份与服装，不作为首帧', subjectTag: '<Subject 1>' },
    { pictureTag: '<Picture 2>', label: '雨夜山道场景主图', assetKind: 'scene', entityName: 'L01', role: '仅锁定空间和照明，不作为首帧' },
  ];
  const request = buildSegmentVideoPromptRequest(referenceInput);
  assert.deepEqual(request.input.referenceBindings, referenceInput.referenceBindings);
  assert.match(request.instructions, /<Picture 1>=张浩然角色主图/u);
  assert.match(request.instructions, /<Subject 1>/u);
  assert.match(request.instructions, /来源定义一次，实际作用处引用/u);
  assert.match(request.instructions, /主体首次出场、切镜后重新出场、多人动作归属可能混淆时/u);
  assert.match(request.instructions, /程序将其编译成正文前的一条故事板参考说明/u);

  const boundPlan = structuredClone(plan);
  boundPlan.videoPromptSections.basicSetting = '<Subject 1>是<Picture 1>中的张浩然；<Picture 2>仅控制雨夜山道的空间与照明，均不作为首帧。';
  boundPlan.videoPromptSections.shotExecution = boundPlan.videoPromptSections.shotExecution.replaceAll('张浩然', '<Subject 1>').replace('P01 0-2.5秒。', 'P01 0-2.5秒，以<Picture 2>中的山道空间建立镜头。');
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(boundPlan, referenceInput));

  const missingBinding = structuredClone(boundPlan);
  missingBinding.videoPromptSections.basicSetting = missingBinding.videoPromptSections.basicSetting.replace('<Picture 2>', '雨夜山道');
  assert.throws(() => validateSegmentVideoPromptPlan(missingBinding, referenceInput), /基础设定缺少/);

  const executionOnlyNamesAssets = structuredClone(boundPlan);
  executionOnlyNamesAssets.videoPromptSections.shotExecution = executionOnlyNamesAssets.videoPromptSections.shotExecution.replaceAll('<Subject 1>', '张浩然').replaceAll('<Picture 2>', '雨夜山道');
  assert.throws(() => validateSegmentVideoPromptPlan(executionOnlyNamesAssets, referenceInput), /镜头执行缺少/);
});

test('video prompt repair request returns the rejected draft, exact validation failures, and grounded evidence to the Agent once', () => {
  const repairInput = structuredClone(input);
  repairInput.segment.groundedEvidence[0].speechKind = 'internal_monologue';
  repairInput.segment.groundedEvidence[0].text = '眼泪早就干了，如今连一滴也哭不出来。';
  const request = buildEpisodeVideoPromptRepairRequest([{
    input: repairInput,
    draft: plan,
    validationCodes: ['shot execution must preserve dialogue B-S01-D09', 'B-S01-D09 internal monologue must be an audible inner voice'],
    validationIssues: ['没有逐字保留对白（B-S01-D09）', '内心独白没有明确写成可听见的内心声'],
  }]);
  assert.equal(request.operation, 'repair-episode-video-prompts-batch');
  assert.equal(request.schemaName, 'prism_autodrama_episode_video_prompts_repair_v1');
  assert.match(request.instructions, /唯一一次校正回合/u);
  assert.match(request.instructions, /groundedEvidence/u);
  assert.match(request.instructions, /只修正实际失败项/u);
  assert.match(request.instructions, /逐字对白按原顺序拆到相邻时间段/u);
  assert.match(request.instructions, /不得删字、改写或加速对白/u);
  assert.deepEqual(request.input.segments[0].repairContext.validationCodes, ['shot execution must preserve dialogue B-S01-D09', 'B-S01-D09 internal monologue must be an audible inner voice']);
  assert.deepEqual(request.input.segments[0].repairContext.validationIssues, ['没有逐字保留对白（B-S01-D09）', '内心独白没有明确写成可听见的内心声']);
  assert.equal(request.input.segments[0].repairContext.previousDraft.soundPolicy, plan.videoPromptSections.soundPolicy);
  assert.equal(request.input.segments[0].segment.groundedEvidence[0].speechKind, 'internal_monologue');
  assert.equal(request.input.segments[0].segment.groundedEvidence[0].text, '眼泪早就干了，如今连一滴也哭不出来。');
  assert.deepEqual(request.outputSchema.required, ['items']);
});

test('video prompt generation accepts legacy boards with stable panel identities', () => {
  const legacy = structuredClone(input);
  for (const panel of legacy.boardPlan.panels) {
    delete panel.shotGroupKey;
    delete panel.actionUnitKey;
  }
  assert.doesNotThrow(() => buildSegmentVideoPromptRequest(legacy));
});

test('video prompt validation preserves panel order, dialogue, and semantic references', () => {
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(plan, input));
  const broken = structuredClone(plan);
  broken.referenceRequirements.props.push({ propName: '人皇印', state: '激活', role: '道具' });
  assert.match(validateSegmentVideoPromptPlan(broken, input).join('\n'), /prop reference requirements mismatch/);
});

test('a single visible character may be continued by an unambiguous pronoun in later timeline beats', () => {
  const pronounPlan = normalizeSegmentVideoPromptBookkeeping({
    videoPromptSections: {
      basicSetting: '3D玄幻，暴雨夜荒野山道，张浩然空手。',
      soundPolicy: '无背景音乐，无旁白，保留对白与持续雨声。',
      atmosphereQualityPhotography: '冷青色电影质感。',
      timelineBeats: [
        { panelKeys: ['P01', 'P02', 'P03'], execution: '镜头以低机位中景建立山道，张浩然在雨中站稳。' },
        { panelKeys: ['P04', 'P05'], execution: '他冷冷开口：“出来吧，何必遮遮掩掩的。”' },
        { panelKeys: ['P06'], execution: '他保持戒备，雨声持续。' },
      ],
      negativeTerms: ['第二人物', '多余道具', '字幕水印', '身份漂移', '场景漂移'],
    },
  }, input);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(pronounPlan, input));
});

test('a bound Subject tag explicitly names its character as the action owner', () => {
  const referenceInput = structuredClone(input);
  referenceInput.referenceBindings = [
    { pictureTag: '<Picture 1>', label: '张浩然角色主图', assetKind: 'character', entityName: '张浩然', role: '锁定人物身份与服装', subjectTag: '<Subject 1>' },
    { pictureTag: '<Picture 2>', label: '雨夜山道场景主图', assetKind: 'scene', entityName: 'L01', role: '锁定空间和照明' },
  ];
  const subjectPlan = normalizeSegmentVideoPromptBookkeeping({
    videoPromptSections: {
      basicSetting: '<Subject 1>是<Picture 1>中的张浩然；<Picture 2>锁定雨夜山道的空间和照明。',
      soundPolicy: '无背景音乐，无旁白，保留对白与持续雨声。',
      atmosphereQualityPhotography: '冷青色电影质感。',
      timelineBeats: [
        { panelKeys: ['P01', 'P02', 'P03'], execution: '以<Picture 2>中的山道建立镜头，<Subject 1>在雨中站稳。' },
        { panelKeys: ['P04', 'P05'], execution: '<Subject 1>冷冷开口：“出来吧，何必遮遮掩掩的。”' },
        { panelKeys: ['P06'], execution: '<Subject 1>保持戒备，雨声持续。' },
      ],
      negativeTerms: ['第二人物', '多余道具', '字幕水印', '身份漂移', '场景漂移'],
    },
  }, referenceInput);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(subjectPlan, referenceInput));
  assert.doesNotMatch(validateSegmentVideoPromptPlan(subjectPlan, referenceInput).join('\n'), /must name action owner/u);
});

test('video prompt reference validation excludes transient visible material without assets', () => {
  const transientInput = structuredClone(input);
  transientInput.boardPlan.semanticDecision.visibleProps = [
    { propName: '雨水', state: '持续落下' },
    { propName: '泥浆', state: '脚边飞溅' }
  ];
  transientInput.boardPlan.referenceRequirements = {
    characters: ['张浩然'], sceneRequired: true, props: [], decisionBasis: ['雨水和泥浆不需要独立资产']
  };
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(plan, transientInput));
});

test('video prompt reference normalization only keeps assets approved by the storyboard plan', () => {
  const controlledInput = structuredClone(input);
  controlledInput.boardPlan.referenceRequirements = {
    characters: ['张浩然'],
    sceneRequired: true,
    props: [{ propName: '藤蔓绊索', state: '两棵树之间打结形成' }],
    decisionBasis: ['沿用已确认资产'],
  };
  const drifted = structuredClone(plan);
  drifted.referenceRequirements.characters.push({ characterName: '迅猛龙', role: '新增角色参考' });
  drifted.referenceRequirements.scene = { required: true, sceneAssetKey: '错误场景', role: '改写场景' };
  drifted.referenceRequirements.props = [
    { propName: '藤蔓绊索', state: '缠在树间', role: '改写道具状态' },
    { propName: '泥浆', state: '飞溅', role: '新增道具参考' },
  ];
  const normalized = normalizeSegmentVideoPromptReferences(drifted, controlledInput);
  assert.deepEqual(normalized.referenceRequirements.characters.map((item) => item.characterName), ['张浩然']);
  assert.equal(normalized.referenceRequirements.scene.sceneAssetKey, 'L01');
  assert.deepEqual(normalized.referenceRequirements.props, [{ propName: '藤蔓绊索', state: '两棵树之间打结形成', role: '改写道具状态' }]);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(normalized, controlledInput));
});

test('video prompt can use structured planning without a storyboard board image', () => {
  const withoutBoard = { ...structuredClone(input), storyboardBoardAvailable: false };
  const normalized = normalizeSegmentVideoPromptReferences(structuredClone(plan), withoutBoard);
  assert.equal(normalized.referenceRequirements.storyboardBoardRequired, false);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(normalized, withoutBoard));
  const request = buildSegmentVideoPromptRequest(withoutBoard);
  assert.equal(request.input.storyboardBoardAvailable, false);
  assert.match(request.instructions, /本段没有可读取的6宫格故事板图片/u);
});

test('video prompt requests keep the selected storyboard count through every supported grid size', () => {
  for (const panelCount of [3, 4, 6, 9]) {
    const variableInput = structuredClone(input);
    variableInput.storyboardImage = { id: 'SEG001-storyboard', description: '本段故事板', mediaType: 'image/png', data: 'fixture-bytes' };
    variableInput.boardPlan.panelCount = panelCount;
    variableInput.boardPlan.panels = Array.from({ length: panelCount }, (_, index) => ({
      ...directorPanels[index % directorPanels.length],
      panelKey: `P${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      startSec: index,
      endSec: index + 1,
      transitionFromPrevious: index === 0 ? 'initial' : 'continuous',
      cutTrigger: index === 0 ? 'initial' : 'none',
    }));
    const request = buildSegmentVideoPromptRequest(variableInput);
    assert.equal(request.input.panelCount, panelCount);
    assert.equal(request.input.panelPlan.length, panelCount);
    assert.match(request.instructions, new RegExp(`实际读取附件SEG001-storyboard中的整张${panelCount}宫格故事板`, 'u'));
    assert.equal(request.images[0].data, 'fixture-bytes');
    if (panelCount !== 6) assert.doesNotMatch(request.instructions, /六宫格/u);

    const withoutBoard = { ...variableInput, storyboardImage: undefined, storyboardBoardAvailable: false };
    const missingRequest = buildSegmentVideoPromptRequest(withoutBoard);
    assert.match(missingRequest.instructions, new RegExp(`没有可读取的${panelCount}宫格故事板图片`, 'u'));

    const normalized = normalizeSegmentVideoPromptBookkeeping({
      videoPromptSections: structuredClone(plan.videoPromptSections),
    }, variableInput);
    assert.deepEqual(normalized.referenceRequirements.decisionBasis, [`沿用已确认${panelCount}宫格故事板规划的参考资产要求`]);
  }
});

test('sound policy phrasing is reviewed by the AI', () => {
  const broken = structuredClone(plan);
  broken.videoPromptSections.soundPolicy = '第8秒张浩然说：“出来吧，何必遮遮掩掩的。”';
  assert.deepEqual(validateSegmentVideoPromptPlan(broken, input), []);
});

test('silent video language surfaces do not produce keyword-based advice', () => {
  const silentInput = structuredClone(input);
  silentInput.segment.groundedEvidence = [];
  silentInput.segment.dialogueEvidenceIds = [];
  silentInput.segment.storyboardText = '四位年轻人安静围坐吃火锅。';
  const silentPlan = structuredClone(plan);
  silentPlan.videoPromptSections.soundPolicy = '全片零人声，无背景音乐、无对白、无旁白；音轨仅包含火锅沸腾声与碗碟轻碰声。';
  silentPlan.videoPromptSections.shotExecution = 'P01。P02。P03。P04。P05。P06，四人安静用餐，火锅蒸汽持续上升。';
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(silentPlan, silentInput));

  const quoted = structuredClone(silentPlan);
  quoted.videoPromptSections.shotExecution += '最终形成“热气腾腾、丰盛共享”的广告收束。';
  assert.deepEqual(validateSegmentVideoPromptPlan(quoted, silentInput), []);

  const vocalAmbience = structuredClone(silentPlan);
  vocalAmbience.videoPromptSections.soundPolicy = '无背景音乐、无对白、无旁白，保留餐厅顾客谈笑声。';
  assert.deepEqual(validateSegmentVideoPromptPlan(vocalAmbience, silentInput), []);
});

test('video prompt validation accepts exact dialogue split across adjacent quoted shot beats', () => {
  const split = structuredClone(plan);
  split.videoPromptSections.shotExecution = 'P01。P02。P03。P04 张浩然说：“出来吧，”；P05 接着说：“何必遮遮掩掩的。”；P06。';
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(split, input));
  split.videoPromptSections.shotExecution = 'P01。P02。P03。P04 张浩然说：“出来，”；P05 接着说：“何必遮掩的。”；P06。';
  assert.throws(() => validateSegmentVideoPromptPlan(split, input), /preserve dialogue/);
});

test('video prompt validation accepts punctuation-only drift at a split dialogue boundary', () => {
  const split = structuredClone(plan);
  split.videoPromptSections.shotExecution = 'P01。P02。P03。P04 张浩然说：‘出来吧……’；P05 接着说：‘……何必遮遮掩掩的。’；P06。';
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(split, input));
});

test('internal monologue presentation is reviewed by the AI', () => {
  const monologueInput = structuredClone(input);
  monologueInput.segment.groundedEvidence[0].speechKind = 'internal_monologue';
  const broken = structuredClone(plan);
  broken.videoPromptSections.shotExecution = 'P01 0-2.5秒。P02 2.5-5秒。P03 5-7.5秒。P04 7.5-10秒，张浩然嘴唇微动，低声说出：“出来吧，何必遮遮掩掩的。” P05 10-12.5秒。P06 12.5-15秒。';
  assert.deepEqual(validateSegmentVideoPromptPlan(broken, monologueInput), []);
  broken.videoPromptSections.shotExecution = 'P01 0-2.5秒。P02 2.5-5秒。P03 5-7.5秒。P04 7.5-10秒，张浩然嘴唇保持闭合、没有口型，可听见他的内心声：“出来吧，何必遮遮掩掩的。” P05 10-12.5秒。P06 12.5-15秒。';
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(broken, monologueInput));
});

test('short clip beat density is selected by the AI', () => {
  const shortInput = structuredClone(input);
  shortInput.segment.durationSec = 5;
  shortInput.boardPlan.panels = Array.from({ length: 6 }, (_, index) => ({ ...shortInput.boardPlan.panels[index], startSec: Number((index * 5 / 6).toFixed(2)), endSec: Number(((index + 1) * 5 / 6).toFixed(2)) }));
  const shortPlan = structuredClone(plan);
  shortPlan.durationSec = 5;
  shortPlan.videoPromptSections.shotExecution = '0-0.83秒（P01）。0.83-1.67秒（P02）。1.67-2.5秒（P03）。2.5-3.33秒（P04）张浩然说：“出来吧，何必遮遮掩掩的。”3.33-4.17秒（P05）。4.17-5秒（P06）。';
  assert.deepEqual(validateSegmentVideoPromptPlan(shortPlan, shortInput), []);
  shortPlan.videoPromptSections.shotExecution = '0-1.2秒（P01-P02），连续起身。1.2-2.5秒（P03），情绪转变。2.5-4秒（P04-P05），张浩然说：“出来吧，何必遮遮掩掩的。”4-5秒（P06），动作达到明确结果。';
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(shortPlan, shortInput));
  const request = buildSegmentVideoPromptRequest(shortInput);
  assert.match(request.instructions, /3至5个自然时间段/);
  assert.equal(request.outputSchema.properties.videoPromptSections.properties.timelineBeats.minItems, 1);
  assert.equal(request.outputSchema.properties.videoPromptSections.properties.timelineBeats.maxItems, undefined);
  assert.equal(request.input.requiredTransition, '');
});

test('structured timeline compiles readably and rejects missing panel coverage', () => {
  const shortInput = structuredClone(input);
  shortInput.segment.durationSec = 5;
  shortInput.boardPlan.panels = Array.from({ length: 6 }, (_, index) => ({ ...shortInput.boardPlan.panels[index], startSec: Number((index * 5 / 6).toFixed(2)), endSec: Number(((index + 1) * 5 / 6).toFixed(2)) }));
  const structuredPlan = structuredClone(plan);
  structuredPlan.durationSec = 5;
  delete structuredPlan.videoPromptSections.shotExecution;
  structuredPlan.videoPromptSections.timelineBeats = [
    { startSec: 0, endSec: 1.2, panelKeys: ['P01', 'P02'], shotGroupKey: 'SH01', transitionFromPrevious: 'initial', cutTrigger: 'initial', startState: '状态0', actionUnitKeys: ['AU01'], execution: '张浩然在雨中站稳，抬头确认前方。', endState: '状态2' },
    { startSec: 1.2, endSec: 2.5, panelKeys: ['P03'], shotGroupKey: 'SH01', transitionFromPrevious: 'continuous', cutTrigger: 'none', startState: '状态2', actionUnitKeys: ['AU01'], execution: '张浩然收紧肩背，视线转冷。', endState: '状态3' },
    { startSec: 2.5, endSec: 4, panelKeys: ['P04', 'P05'], shotGroupKey: 'SH02', transitionFromPrevious: 'cut', cutTrigger: 'attention-shift', startState: '状态3', actionUnitKeys: ['AU02'], execution: '张浩然现场说：“出来吧，何必遮遮掩掩的。”', endState: '状态5' },
    { startSec: 4, endSec: 5, panelKeys: ['P06'], shotGroupKey: 'SH02', transitionFromPrevious: 'continuous', cutTrigger: 'none', startState: '状态5', actionUnitKeys: ['AU02'], execution: '张浩然保持戒备，雨声持续。', endState: '状态6' },
  ];
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(structuredPlan, shortInput));
  const compiled = compileSegmentVideoPrompt(shortInput, structuredPlan, '整张六宫格故事板');
  assert.match(compiled, /0-1.2秒：张浩然在雨中站稳，抬头确认前方。/);
  assert.match(compiled, /2.5-4秒：切镜后，张浩然现场说：“出来吧，何必遮遮掩掩的。”/);
  assert.match(compiled, /4-5秒：张浩然保持戒备，雨声持续。/);
  assert.doesNotMatch(compiled, /\b(?:P|SH|AU)\d{2,}\b|actionOwner|actionSummary|从“|结束为“/u);
  const broken = structuredClone(structuredPlan);
  broken.videoPromptSections.timelineBeats[1].panelKeys = ['P04'];
  assert.throws(() => validateSegmentVideoPromptPlan(broken, shortInput), /cover panel keys exactly once and in order/);
});

test('legacy compiled prompts are presented as natural Chinese without validation ledger fields', () => {
  const legacy = `画面内容与镜头执行
0-5秒（P01—P02，SH01，初始镜头）：从“麻子妈正对宋老太”开始；麻子妈推动轮椅转向电梯口。AU01（actionOwner：麻子妈；actionSummary：开始转动轮椅，准备离开；阶段：complete；可见结果：轮椅转向走廊电梯口方向）。；结束为“麻子妈背对宋老太，轮椅渐远。”。
5-10秒（P03—P04，SH02，切镜：注意力中心转移）：从“宋老太犹豫”开始；宋老太开口叫住麻子妈。AU04（actionOwner：宋老太；actionSummary：开口说出“她姨！……我跟你，跟你一道。”；阶段：complete；可见结果：麻子妈停下轮椅；speechKind：dialogue，现场说话口型；表演状态：嘴唇颤抖后终于出声）。；结束为“麻子妈停下轮椅。”。`;
  const cleaned = sanitizeCompiledVideoPrompt(legacy);
  assert.match(cleaned, /0-5秒：麻子妈推动轮椅转向电梯口。麻子妈开始转动轮椅，准备离开，轮椅转向走廊电梯口方向。/u);
  assert.match(cleaned, /5-10秒：切镜后，宋老太开口叫住麻子妈。宋老太开口说出“她姨！……我跟你，跟你一道。”，麻子妈停下轮椅；表演为嘴唇颤抖后终于出声。/u);
  assert.doesNotMatch(cleaned, /\b(?:P|SH|AU)\d{2,}\b|actionOwner|actionSummary|speechKind|阶段：complete|从“|结束为“|。；/u);
});

test('legacy action ledger variants keep their production meaning while removing bookkeeping syntax', () => {
  const legacy = `0-5秒（P01—P02，SH01，初始镜头）：从“门口”开始；AU01｜actionOwner：宋老太；actionSummary：挥手道别并说“路上慢点。”；当前阶段：complete；可见结果：宋老太笑着挥手。AU02｜actionOwner：宋老太；actionSummary：低头看向裤腿；当前阶段：complete；可见结果：裤腿颜色变深。同步声音：晨风。；结束为“她低头。”。
5-10秒（P03—P04，SH02，切镜：注意力中心转移）：从“她坐在床边”开始；【AU03｜宋老太｜目光空洞凝视墙角：已完成；可见结果：她眼神失焦。】镜头缓慢推近。；结束为“她眼神失焦。”。
10-15秒（P05—P06，SH02，连续镜头）：从“她站在门口”开始；AU04（宋老太，阶段：完成）：她举起拐杖，speechKind：dialogue，口型同步说：“你来吧。”可见结果：对方停下。；结束为“对方停下。”。`;
  const cleaned = sanitizeCompiledVideoPrompt(legacy);
  assert.match(cleaned, /宋老太挥手道别并说“路上慢点。”，宋老太笑着挥手。/u);
  assert.match(cleaned, /宋老太目光空洞凝视墙角，她眼神失焦。/u);
  assert.match(cleaned, /宋老太举起拐杖，口型同步说：“你来吧。”对方停下。/u);
  assert.doesNotMatch(cleaned, /\b(?:P|SH|AU)\d{2,}\b|actionOwner|actionSummary|speechKind|当前阶段|可见结果|已完成|从“|结束为“|[｜【】]|。。|，：/u);
});

test('legacy bookkeeping is filled while model-authored sound policy is preserved', () => {
  const shortInput = structuredClone(input);
  shortInput.segment.durationSec = 5;
  shortInput.boardPlan.panels = Array.from({ length: 6 }, (_, index) => ({ ...shortInput.boardPlan.panels[index], startSec: Number((index * 5 / 6).toFixed(2)), endSec: Number(((index + 1) * 5 / 6).toFixed(2)) }));
  const returned = structuredClone(plan);
  delete returned.segmentKey;
  delete returned.durationSec;
  delete returned.referenceRequirements;
  delete returned.videoPromptSections.shotExecution;
  returned.videoPromptSections.soundPolicy = '持续雨声；对白“出来吧，何必遮遮掩掩的。”由张浩然现场说出。';
  returned.videoPromptSections.timelineBeats = [
    { panelKeys: ['P01', 'P02', 'P03'], execution: '张浩然在雨中站稳。' },
    { panelKeys: ['P04', 'P05'], execution: '张浩然现场说：“出来吧，何必遮遮掩掩的。”' },
    { panelKeys: ['P06'], execution: '张浩然保持戒备，雨声持续。' },
  ];
  const normalized = normalizeSegmentVideoPromptBookkeeping(returned, shortInput);
  assert.equal(normalized.segmentKey, 'SEG001');
  assert.equal(normalized.durationSec, 5);
  assert.equal(normalized.videoPromptSections.soundPolicy, returned.videoPromptSections.soundPolicy);
  assert.deepEqual(normalized.videoPromptSections.timelineBeats.map((beat) => [beat.startSec, beat.endSec]), [[0, 2.5], [2.5, 4.17], [4.17, 5]]);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(normalized, shortInput));
  const draft = compileSegmentVideoPromptDraft(normalized, '已确认参考资产');
  assert.match(draft, /基础设定/u);

  normalized.videoPromptSections.timelineBeats[1].execution = '张浩然沉默看向远方。';
  assert.throws(() => validateSegmentVideoPromptPlan(normalized, shortInput), /preserve dialogue/u);
});

test('natural language cleanup is delegated to AI while factual contracts remain checked', () => {
  const draft = {
    videoPromptSections: {
      basicSetting: '3D玄幻，暴雨夜荒野山道，张浩然空手。',
      soundPolicy: '无背景音乐，无旁白，保留对白与持续雨声。',
      atmosphereQualityPhotography: '冷青色电影质感。',
      timelineBeats: [
        { panelKeys: ['P01', 'P02', 'P03'], execution: '镜头以低机位中景建立山道，张浩然在雨中站稳，抬头确认前方。' },
        { panelKeys: ['P04', 'P05'], execution: '切到正面近景，张浩然冷冷开口：“出来吧，何必遮遮掩掩的。”' },
        { panelKeys: ['P06'], execution: '张浩然保持戒备，雨声持续，镜头停在他冷峻的眼神上。' },
      ],
      negativeTerms: ['第二人物', '多余道具', '字幕水印', '身份漂移', '场景漂移']
    }
  };
  const normalized = normalizeSegmentVideoPromptBookkeeping(draft, input);
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(normalized, input));

  const leaked = structuredClone(normalized);
  leaked.videoPromptSections.timelineBeats[0].execution += ' actionOwner：张浩然；AU01已完成。';
  assert.deepEqual(validateSegmentVideoPromptPlan(leaked, input), []);

  const repeated = structuredClone(normalized);
  repeated.videoPromptSections.timelineBeats[2].execution = repeated.videoPromptSections.timelineBeats[0].execution;
  assert.deepEqual(validateSegmentVideoPromptPlan(repeated, input), []);
});

test('dialogue pacing is reviewed by the AI without a lexical speed threshold', () => {
  const dialogueInput = structuredClone(input);
  dialogueInput.segment.groundedEvidence[0].text = '你现在马上离开这里，沿着走廊一直走到尽头，再按下电梯按钮等我过来，千万不要回头。';
  const draft = {
    videoPromptSections: {
      basicSetting: '3D玄幻，暴雨夜荒野山道，张浩然空手。',
      soundPolicy: '无背景音乐，无旁白，保留对白与持续雨声。',
      atmosphereQualityPhotography: '冷青色电影质感。',
      timelineBeats: [
        { panelKeys: ['P01', 'P02', 'P03'], execution: '镜头以低机位中景建立山道，张浩然在雨中站稳。' },
        { panelKeys: ['P04', 'P05'], execution: `张浩然现场说：“${dialogueInput.segment.groundedEvidence[0].text}”` },
        { panelKeys: ['P06'], execution: '张浩然保持戒备，雨声持续。' },
      ],
      negativeTerms: ['第二人物', '多余道具', '字幕水印', '身份漂移', '场景漂移']
    }
  };
  const normalized = normalizeSegmentVideoPromptBookkeeping(draft, dialogueInput);
  assert.deepEqual(validateSegmentVideoPromptPlan(normalized, dialogueInput), []);
});

test('AI video planning may regroup shots and revise action states', () => {
  const shortInput = structuredClone(input);
  shortInput.segment.durationSec = 5;
  shortInput.boardPlan.panels = Array.from({ length: 6 }, (_, index) => ({ ...shortInput.boardPlan.panels[index], startSec: Number((index * 5 / 6).toFixed(2)), endSec: Number(((index + 1) * 5 / 6).toFixed(2)) }));
  const structured = structuredClone(plan);
  structured.durationSec = 5;
  delete structured.videoPromptSections.shotExecution;
  structured.videoPromptSections.timelineBeats = [
    { startSec: 0, endSec: 2.5, panelKeys: ['P01', 'P02', 'P03'], shotGroupKey: 'SH01', transitionFromPrevious: 'initial', cutTrigger: 'initial', startState: '状态0', actionUnitKeys: ['AU01'], execution: '张浩然完成站稳动作。', endState: '状态3' },
    { startSec: 2.5, endSec: 4, panelKeys: ['P04', 'P05'], shotGroupKey: 'SH02', transitionFromPrevious: 'cut', cutTrigger: 'attention-shift', startState: '状态3', actionUnitKeys: ['AU02'], execution: '张浩然说：“出来吧，何必遮遮掩掩的。”', endState: '状态5' },
    { startSec: 4, endSec: 5, panelKeys: ['P06'], shotGroupKey: 'SH02', transitionFromPrevious: 'continuous', cutTrigger: 'none', startState: '状态5', actionUnitKeys: ['AU02'], execution: '张浩然保持动作结果。', endState: '状态6' },
  ];
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(structured, shortInput));

  const crossesCut = structuredClone(structured);
  crossesCut.videoPromptSections.timelineBeats[0].panelKeys.push('P04');
  crossesCut.videoPromptSections.timelineBeats[1].panelKeys = ['P05'];
  assert.deepEqual(validateSegmentVideoPromptPlan(crossesCut, shortInput), []);

  const rewritesState = structuredClone(structured);
  rewritesState.videoPromptSections.timelineBeats[1].startState = '人物突然换位';
  assert.deepEqual(validateSegmentVideoPromptPlan(rewritesState, shortInput), []);
});

test('required end-title wording is preserved while negative-term phrasing is flexible', () => {
  const endingInput = structuredClone(input);
  endingInput.requiredTransition = '硬切至黑场。字幕浮现：“活着，就是使命。”';
  const endingPlan = structuredClone(plan);
  assert.throws(() => validateSegmentVideoPromptPlan(endingPlan, endingInput), /required transition text/);
  endingPlan.videoPromptSections.shotExecution = 'P01 0-2.5秒。P02 2.5-5秒。P03 5-7.5秒。P04 7.5-10秒，张浩然说：“出来吧，何必遮遮掩掩的。” P05 10-12.5秒。P06 12.5-14秒；14-15秒硬切至黑场，片尾字幕逐字浮现：“活着，就是使命。”';
  endingPlan.videoPromptSections.negativeTerms = ['身份漂移', '场景漂移', '动作跳变', '出现字幕', '黑场缺失'];
  assert.deepEqual(validateSegmentVideoPromptPlan(endingPlan, endingInput), []);
  endingPlan.videoPromptSections.negativeTerms = ['身份漂移', '场景漂移', '动作跳变', '片尾字幕错字', '黑场缺失'];
  assert.doesNotThrow(() => validateSegmentVideoPromptPlan(endingPlan, endingInput));
});

test('video prompt compiler emits the Chinese five-section production format', () => {
  const prompt = compileSegmentVideoPrompt(input, plan, '整张六宫格故事板、张浩然人物图、L01场景图');
  assert.match(prompt, /基础设定/);
  assert.match(prompt, /声音总则/);
  assert.match(prompt, /画面内容与镜头执行/);
  assert.match(prompt, /负面词/);
  assert.match(prompt, /建议时长：15秒/);
});

test('episode video prompt batch returns every independent segment in order', () => {
  const secondInput = structuredClone(input);
  secondInput.segment.segmentKey = 'SEG002';
  secondInput.segment.id = 'seg002';
  const secondPlan = structuredClone(plan);
  secondPlan.segmentKey = 'SEG002';
  const request = buildEpisodeVideoPromptBatchRequest([input, secondInput]);
  assert.equal(request.maxOutputTokens, 60000);
  assert.deepEqual(request.input.segments.map((item) => item.segment.segmentKey), ['SEG001', 'SEG002']);
  assert.match(request.instructions, /彼此独立/);
  assert.match(request.instructions, /【SEG001差异】/);
  assert.match(request.instructions, /【SEG002差异】/);
  assert.match(request.instructions, /禁止把第一段的时长/);
  assert.equal(request.instructions.match(/采用“最小完整控制”/gu)?.length, 1);
  assert.deepEqual(request.outputSchema.properties.items.items.properties.plan.required, ['videoPromptSections']);
  const output = { items: [{ segmentKey: 'SEG001', plan }, { segmentKey: 'SEG002', plan: secondPlan }] };
  assert.doesNotThrow(() => validateEpisodeVideoPromptBatch(output, [input, secondInput]));
  output.items.reverse();
  assert.throws(() => validateEpisodeVideoPromptBatch(output, [input, secondInput]), /must be SEG001/);
});

test('batch request keeps short-clip and ending rules scoped to their own segment', () => {
  const shortEndingInput = structuredClone(input);
  shortEndingInput.segment.segmentKey = 'SEG002';
  shortEndingInput.segment.durationSec = 5;
  shortEndingInput.requiredTransition = '硬切至黑场。字幕浮现：“活着，就是使命。”';
  const request = buildEpisodeVideoPromptBatchRequest([input, shortEndingInput]);
  assert.equal(request.input.segments[0].executionConstraints.timingAndCameraPlanning, 'ai');
  assert.equal(request.input.segments[0].requiredTransition, '');
  assert.equal(request.input.segments[1].executionConstraints.timingAndCameraPlanning, 'ai');
  assert.equal(request.input.segments[1].requiredTransition, '硬切至黑场。字幕浮现：“活着，就是使命。”');
  assert.match(request.instructions, /【SEG002差异】[\s\S]*这是4至6秒短镜头/);
  assert.match(request.instructions, /【SEG002差异】[\s\S]*requiredTransition是已批准的结尾执行指令/);
});
