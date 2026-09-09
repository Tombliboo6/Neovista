import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSceneAssetPromptRequest,
  buildSceneEvidenceCatalog,
  buildSceneVisualProposalRequest,
  compileSceneAssetPrompt,
  generateSceneAssetPrompts,
  generateScenePromptsFromProposals,
  generateSceneVisualProposals,
  SCENE_ASSET_PROMPT_SCHEMA_NAME,
  SCENE_MAIN_ASSET_LAYOUT,
  SceneAssetPromptValidationError,
  validateSceneAssetPromptDraft
} from '../src/scenes/scene-prompt-generation.ts';
import { materializeSceneAssetPromptSet } from '../src/scenes/scene-prompt-versioning.ts';

const script = {
  id: 'script-episode-1', version: 2,
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved', episodeId: 'episode-1', episodeVersion: 1,
  documentId: 'document-1', documentVersion: 1,
  title: '雨夜背叛', logline: '雨夜决裂。', synopsis: '同一片荒野中的背叛与毁灭。',
  targetDurationSec: 105, estimatedDurationSec: 105,
  openingHook: '雨夜截杀', endingHook: '人印俱消', adaptationNotes: [], continuityOut: '荒野被毁。',
  scenes: [
    {
      id: 'script-episode-1-s01', sceneKey: 'S01', order: 1, heading: '雨夜截杀',
      location: '荒野山道，大雨之中', timeOfDay: '夜晚', interiorExterior: 'exterior',
      sourceSegmentIds: ['segment-1'], sourceStart: 0, sourceEnd: 400,
      sourceEvidence: ['出来吧，何必遮遮掩掩的。'],
      purpose: '在暴雨荒野揭开背叛。', durationSec: 60,
      action: '暴雨如注，泥泞山道延伸进黑暗。', dialogue: [], soundCues: [], transitionOut: 'continuous'
    },
    {
      id: 'script-episode-1-s02', sceneKey: 'S02', order: 2, heading: '石印碎，人消',
      location: '同一片荒野，暴雨与毁灭之中', timeOfDay: '夜晚', interiorExterior: 'exterior',
      sourceSegmentIds: ['segment-2'], sourceStart: 400, sourceEnd: 887,
      sourceEvidence: ['张浩然，你终究还是死在了我的手中！'],
      purpose: '同一地点在爆炸后被摧毁。', durationSec: 45,
      action: '大地碎裂，空间坍塌，四周被摧毁。', dialogue: [], soundCues: [], transitionOut: 'cut'
    }
  ]
};

const style = {
  id: 'style-episode-1', version: 1,
  createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved', characterProfileSetId: 'profiles-1', characterProfileSetVersion: 1,
  source: 'style-library', name: '3D玄幻',
  stylePrompt: '高品质东方玄幻三维动画电影风格。',
  referenceMediaPaths: ['runtime-data/style-presets/06-3D玄幻.png'], selectedBy: 'user'
};

const input = { script, styleSelection: style };

const prompt = {
  promptKey: 'L01', sceneAssetKey: 'L01', name: '雨夜荒野山道',
  sourceSceneKeys: ['S01', 'S02'], baseStateSceneKey: 'S01',
  sourceFacts: [
    { fact: '地点为荒野山道并有大雨', sceneKey: 'S01', evidence: '荒野山道，大雨之中' },
    { fact: '第二场仍为同一片荒野', sceneKey: 'S02', evidence: '同一片荒野，暴雨与毁灭之中' }
  ],
  stateVariants: [{
    sceneKey: 'S02',
    stateDescription: '爆炸后大地碎裂、空间坍塌的毁灭状态。',
    sourceEvidence: ['大地碎裂，空间坍塌，四周被摧毁。']
  }],
  visualDesignProposal: {
    locationIdentity: '偏远宗门辖境外的险峻荒野山道。',
    spatialLayout: '山道由左前方弯向右后方，中央留出交锋区。',
    terrainAndArchitecture: '无建筑，低矮山脊与岩壁围合泥泞山道。',
    materialsAndSurfaces: '湿泥、深灰岩石、稀疏灌木和积水。',
    fixedLandmarks: ['左侧断裂岩柱', '右侧倾斜枯树', '远处V形山口'],
    lightingAndColor: '冷蓝黑夜色配低反差天光。',
    weatherAndAtmosphere: '持续暴雨、低云和远处薄雾。',
    reusableCameraCoverage: '山口、岩柱和枯树可组成正反打稳定轴线。',
    designDecisions: ['新增断裂岩柱、倾斜枯树和V形山口作为待审批地标。']
  },
  sections: {
    basicSetting: '东方玄幻世界的雨夜荒野山道基础状态。',
    atmosphereQualityPhotography: '冷峻压抑，湿润材质清晰，电影级环境渲染。',
    contentSpecifics: '前景积水和碎石，中景泥泞交锋区，背景山口没入低云。',
    cameraImaging: '24毫米广角建立镜头，略低于人眼的平视机位，深景深。',
    negativeTerms: ['人物或人群', '剧情道具', '爆炸后废墟提前出现', '空间结构混乱', '固定地标缺失', '文字水印', '过度广角畸变']
  }
};

const validDraft = { prompts: [prompt] };
const modelDraft = {
  prompts: [{
    ...structuredClone(prompt),
    sourceFacts: [
      { fact: '地点为荒野山道并有大雨', sceneKey: 'S01', evidenceId: 'E-S01-LOCATION' },
      { fact: '第二场仍为同一片荒野', sceneKey: 'S02', evidenceId: 'E-S02-LOCATION' }
    ],
    stateVariants: [{
      sceneKey: 'S02',
      stateDescription: '爆炸后大地碎裂、空间坍塌的毁灭状态。',
      evidenceIds: ['E-S02-ACTION']
    }]
  }]
};

test('scene prompt generation is gated and asks for grouped visual proposals plus prompts', () => {
  const request = buildSceneAssetPromptRequest(input);
  assert.equal(request.operation, 'generate-scene-visual-proposals-and-prompts');
  assert.equal(request.schemaName, SCENE_ASSET_PROMPT_SCHEMA_NAME);
  assert.match(request.instructions, /同一物理地点/);
  assert.match(request.instructions, /视觉提案 \+ 场景主资产生图提示词/);
  assert.match(request.instructions, /当前只写结构化文本，不调用图片模型/);
  assert.match(request.instructions, /不要抄写或改写证据原文/);
  assert.match(request.instructions, /纯环境空镜/);
  assert.ok(Array.isArray(request.input.evidenceCatalog));
  assert.equal('sceneGroupingPlan' in request.input, false);
  assert.equal(request.input.evidenceCatalog.find((item) => item.evidenceId === 'E-S01-LOCATION').text, '荒野山道，大雨之中');
  assert.equal(buildSceneEvidenceCatalog(script).some((item) => item.evidenceId === 'E-S02-ACTION'), true);
  assert.throws(
    () => buildSceneAssetPromptRequest({ ...input, script: { ...script, approval: 'draft' } }),
    /Script must be approved/
  );
});

test('scene proposal request lets the Agent group reusable physical spaces while coverage stays validated', () => {
  const request = buildSceneVisualProposalRequest(input);
  const proposalSchema = request.outputSchema.properties.proposals;
  const itemProperties = proposalSchema.items.properties;

  assert.equal(proposalSchema.minItems, 1);
  assert.equal(proposalSchema.maxItems, input.script.scenes.length);
  assert.deepEqual(itemProperties.sourceSceneKeys.items.enum, ['S01', 'S02']);
  assert.deepEqual(itemProperties.baseStateSceneKey.enum, ['S01', 'S02']);
  assert.deepEqual(itemProperties.assetRecommendation.enum, ['required', 'text_only']);
  assert.equal(proposalSchema.items.required.includes('assetRecommendationReason'), true);
  assert.equal('sceneAssetKey' in itemProperties, false);
  assert.equal('sceneGroupingPlan' in request.input, false);
  assert.match(request.instructions, /你负责判断/u);
  assert.match(request.instructions, /不要按location标题逐字匹配/u);
  assert.match(request.instructions, /随分镜按文字生成/u);
  assert.match(request.instructions, /完整、唯一覆盖/u);
});

test('scene proposal stage accepts an Agent semantic merge across differently worded scene locations', async () => {
  const householdLocations = [
    '清晨家中厨房',
    '上午出门前的家中玄关与餐厅',
    '下午家中客厅',
    '傍晚家中客厅',
    '夜晚纯净产品台与虚化家庭背景',
  ];
  const householdScript = {
    ...script,
    scenes: householdLocations.map((location, index) => ({
      ...structuredClone(script.scenes[0]),
      id: `script-episode-1-household-${index + 1}`,
      sceneKey: `S0${index + 1}`,
      order: index + 1,
      heading: `家庭日常${index + 1}`,
      location,
      sourceEvidence: [`家庭场次${index + 1}`],
      purpose: `展现家庭日常阶段${index + 1}。`,
      action: `家庭空间中的动作阶段${index + 1}。`,
    })),
  };
  const householdInput = { ...input, script: householdScript };
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-30T00:00:00.000Z' }; },
    async generate() {
      return {
        output: {
          proposals: [{
            name: '可复用家庭公共空间',
            sourceSceneKeys: ['S01', 'S02', 'S03', 'S04', 'S05'],
            baseStateSceneKey: 'S01',
            sourceFacts: [{ fact: '基础地点为清晨家中厨房', sceneKey: 'S01', evidenceId: 'E-S01-LOCATION' }],
            stateVariants: [],
            visualDesignProposal: prompt.visualDesignProposal,
          }],
        },
        providerId: 'fake-agent', model: 'fake-model', status: 'completed',
        completedAt: '2026-08-30T00:00:00.000Z', elapsedMs: 1,
      };
    },
  };

  const result = await generateSceneVisualProposals(fakeProvider, householdInput);
  assert.equal(result.output.proposals.length, 1);
  assert.equal(result.output.proposals[0].sceneAssetKey, 'L01');
  assert.deepEqual(result.output.proposals[0].sourceSceneKeys, ['S01', 'S02', 'S03', 'S04', 'S05']);
  assert.equal(result.output.proposals[0].assetRecommendation, 'required');
});

test('single-scene proposals discard model-only base-state variants instead of blocking the stage', async () => {
  const singleSceneInput = { ...input, script: { ...script, scenes: [script.scenes[0]] } };
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-30T00:00:00.000Z' }; },
    async generate() {
      return {
        output: {
          proposals: [{
            name: prompt.name,
            sourceSceneKeys: ['S01'],
            baseStateSceneKey: 'S01',
            sourceFacts: [{ fact: '地点为荒野山道并有大雨', sceneKey: 'S01', evidenceId: 'E-S01-LOCATION' }],
            stateVariants: [{ sceneKey: 'S01', stateDescription: '把基础场次误写成后续状态。', evidenceIds: ['E-S01-ACTION'] }],
            visualDesignProposal: prompt.visualDesignProposal,
          }],
        },
        providerId: 'fake-agent', model: 'fake-model', status: 'completed',
        completedAt: '2026-08-30T00:00:00.000Z', elapsedMs: 1,
      };
    },
  };

  const result = await generateSceneVisualProposals(fakeProvider, singleSceneInput);
  assert.equal(result.output.proposals.length, 1);
  assert.deepEqual(result.output.proposals[0].sourceSceneKeys, ['S01']);
  assert.deepEqual(result.output.proposals[0].stateVariants, []);
  assert.equal(result.output.proposals[0].assetRecommendation, 'required');
});

test('later-scene variant evidence drift is retained for review', async () => {
  const invalidProposal = {
    name: prompt.name,
    sourceSceneKeys: ['S01', 'S02'],
    baseStateSceneKey: 'S01',
    sourceFacts: modelDraft.prompts[0].sourceFacts,
    stateVariants: [{ sceneKey: 'S02', stateDescription: '爆炸后的环境状态。', evidenceIds: ['E-S01-ACTION'] }],
    visualDesignProposal: prompt.visualDesignProposal,
  };
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-30T00:00:00.000Z' }; },
    async generate() {
      return { output: { proposals: [invalidProposal] }, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-30T00:00:00.000Z', elapsedMs: 1 };
    },
  };
  const result = await generateSceneVisualProposals(fakeProvider, input);
  assert.equal(result.output.proposals[0].stateVariants[0].sourceEvidence.length, 1);
});

test('one reusable location can cover consecutive script scenes and preserve state variants', () => {
  assert.doesNotThrow(() => validateSceneAssetPromptDraft(validDraft, input));
  const missing = structuredClone(validDraft);
  missing.prompts[0].sourceSceneKeys = ['S01'];
  missing.prompts[0].stateVariants = [];
  assert.match(validateSceneAssetPromptDraft(missing, input).join('\n'), /cover every script scene exactly once/);
  const invented = structuredClone(validDraft);
  invented.prompts[0].sourceFacts[0].evidence = '荒野里有一座宗门石门';
  assert.match(validateSceneAssetPromptDraft(invented, input).join('\n'), /source evidence is not verbatim/);
});

test('scene compiler owns the five-section 16:9 empty-environment master layout', () => {
  const compiled = compileSceneAssetPrompt(prompt, input);
  for (const heading of ['基础设定', '氛围、画质与摄影风格', '画面内容与布局', '摄影机与成像', '负面词']) {
    assert.equal(compiled.split(heading).length - 1, 1, `${heading} should appear once`);
  }
  assert.match(compiled, /横版16:9的单幅场景主资产图/);
  assert.match(compiled, /后续爆炸、坍塌/);
  assert.match(compiled, /高品质东方玄幻三维动画电影风格/);
  assert.match(compiled, /人物表演区/);
  assert.ok(SCENE_MAIN_ASSET_LAYOUT.length > 100);
  assert.doesNotMatch(compiled, /声音总则/);
});

test('provider output is validated before scene proposals are accepted', async () => {
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() {
      return { output: modelDraft, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 1 };
    }
  };
  const result = await generateSceneAssetPrompts(fakeProvider, input);
  assert.equal(result.output.prompts.length, 1);
});

test('optional design notes and short negative-term lists do not reject usable scene drafts', async () => {
  const relaxedDraft = structuredClone(modelDraft);
  delete relaxedDraft.prompts[0].visualDesignProposal.designDecisions;
  relaxedDraft.prompts[0].sections.negativeTerms = ['人物混入', '文字水印'];
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() { return { output: relaxedDraft, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 1 }; }
  };

  const result = await generateSceneAssetPrompts(fakeProvider, input);
  assert.deepEqual(result.output.prompts[0].visualDesignProposal.designDecisions, []);
  assert.deepEqual(validateSceneAssetPromptDraft(result.output, input), []);

  const proposalRequest = buildSceneVisualProposalRequest(input);
  assert.equal(proposalRequest.outputSchema.properties.proposals.items.properties.visualDesignProposal.required.includes('designDecisions'), true);
});

test('staged scene flow creates proposals first and prompt sections only after approval', async () => {
  const operations = [];
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate(request) {
      operations.push(request.operation);
      const output = request.operation === 'generate-scene-visual-proposals'
        ? { proposals: modelDraft.prompts.map(({ sections: _sections, promptKey: _promptKey, sceneAssetKey: _sceneAssetKey, ...proposal }) => proposal) }
        : { prompts: [{ sceneAssetKey: 'L01', sections: prompt.sections }] };
      return { output, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 1 };
    }
  };
  const proposalResult = await generateSceneVisualProposals(fakeProvider, input);
  assert.equal(proposalResult.output.proposals.length, 1);
  assert.equal('sections' in proposalResult.output.proposals[0], false);
  assert.deepEqual(proposalResult.output.proposals[0].sourceSceneKeys, ['S01', 'S02']);
  assert.equal(proposalResult.output.proposals[0].sceneAssetKey, 'L01');
  const promptResult = await generateScenePromptsFromProposals(fakeProvider, { ...input, proposals: proposalResult.output.proposals });
  assert.deepEqual(operations, ['generate-scene-visual-proposals', 'generate-scene-prompts-from-approved-proposals']);
  assert.equal(promptResult.output.prompts[0].sections.basicSetting, prompt.sections.basicSetting);
});

test('invalid source evidence is retained as an editable review warning', async () => {
  const invalidDraft = structuredClone(modelDraft);
  invalidDraft.prompts[0].sourceFacts[0].evidenceId = 'E-S01-NOT-REAL';
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() {
      return {
        output: invalidDraft, providerId: 'fake-agent', model: 'fake-model',
        externalTaskId: 'scene-response-1', status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 123,
        usage: { inputTokens: 10, outputTokens: 20 }
      };
    }
  };
  const result = await generateSceneAssetPrompts(fakeProvider, input);
  assert.equal(result.externalTaskId, 'scene-response-1');
  assert.equal(result.output.prompts[0].sourceFacts[0].evidence, '');
  assert.match(validateSceneAssetPromptDraft(result.output, input).join('\n'), /source evidence is not verbatim/);
});

test('invalid scene proposal output retains request diagnostics for the web error boundary', async () => {
  const invalidProposals = { proposals: [] };
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() {
      return {
        output: invalidProposals, providerId: 'fake-agent', model: 'fake-model',
        externalTaskId: 'scene-proposal-response-2', status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 456,
        usage: { inputTokens: 30, outputTokens: 40 },
      };
    },
  };

  await assert.rejects(
    () => generateSceneVisualProposals(fakeProvider, input),
    (error) => {
      assert.ok(error instanceof SceneAssetPromptValidationError);
      assert.equal(error.diagnostics.externalTaskId, 'scene-proposal-response-2');
      assert.equal(error.diagnostics.elapsedMs, 456);
      assert.deepEqual(error.diagnostics.usage, { inputTokens: 30, outputTokens: 40 });
      assert.deepEqual(error.diagnostics.invalidDraft.proposals, []);
      assert.equal(Object.keys(error).includes('diagnostics'), false);
      return true;
    },
  );
});

test('scene prompt revisions preserve set and matching location IDs', () => {
  const first = materializeSceneAssetPromptSet({
    promptSetId: 'scene-prompts-episode-1', script, styleSelection: style,
    prompts: validDraft.prompts, timestamp: '2026-08-21T01:00:00.000Z'
  });
  const revised = structuredClone(validDraft.prompts);
  revised[0].sections.basicSetting = '修改后的场景基础设定。';
  const second = materializeSceneAssetPromptSet({
    promptSetId: first.id, script, styleSelection: style, prompts: revised,
    previousPromptSet: first, timestamp: '2026-08-21T02:00:00.000Z'
  });
  assert.equal(first.prompts[0].id, second.prompts[0].id);
  assert.equal(second.version, 2);
  assert.equal(second.approval, 'draft');
});
