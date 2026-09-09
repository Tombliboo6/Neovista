import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCharacterDirectorReviewRequest,
  buildPropDirectorReviewRequest,
  buildSceneDirectorReviewRequest,
  generateCharacterProfilesWithDirector as generateCharacterProfilesWithDirectorImpl,
  generatePropVisualProposalsWithDirector as generatePropVisualProposalsWithDirectorImpl,
  generateSceneVisualProposalsWithDirector as generateSceneVisualProposalsWithDirectorImpl,
  ProductionDirectorSupervisionError,
} from '../src/manager/production-director.ts';

const generateCharacterProfilesWithDirector = (provider, input) => generateCharacterProfilesWithDirectorImpl(provider, input, { reviewMode: 'director' });
const generateSceneVisualProposalsWithDirector = (provider, input) => generateSceneVisualProposalsWithDirectorImpl(provider, input, { reviewMode: 'director' });
const generatePropVisualProposalsWithDirector = (provider, input) => generatePropVisualProposalsWithDirectorImpl(provider, input, { reviewMode: 'director' });

const scenes = Array.from({ length: 5 }, (_, index) => ({
  id: `scene-${index + 1}`,
  sceneKey: `S0${index + 1}`,
  order: index + 1,
  heading: `家庭日常${index + 1}`,
  location: ['清晨家中厨房', '上午家中玄关与餐厅', '下午家中客厅', '傍晚家中客厅', '夜晚家庭背景'][index],
  timeOfDay: ['清晨', '上午', '下午', '傍晚', '夜晚'][index],
  interiorExterior: 'interior',
  sourceSegmentIds: [`source-${index + 1}`],
  sourceStart: index * 100,
  sourceEnd: (index + 1) * 100,
  sourceEvidence: [`妈妈完成家庭动作${index + 1}。`],
  purpose: `展现家庭日常阶段${index + 1}。`,
  durationSec: 12,
  action: `妈妈在家庭空间完成动作${index + 1}，环境保持生活气息。`,
  dialogue: [],
  soundCues: [],
  transitionOut: index === 4 ? 'cut' : 'continuous',
}));

const script = {
  id: 'script-family', version: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  approval: 'approved', episodeId: 'episode-1', episodeVersion: 1,
  documentId: 'document-1', documentVersion: 1,
  title: '家庭日常', logline: '妈妈完成一天的家庭活动。', synopsis: '同一家庭空间中的连续生活。',
  targetDurationSec: 60, estimatedDurationSec: 60,
  openingHook: '清晨开始。', endingHook: '夜晚收束。', adaptationNotes: [], continuityOut: '一天结束。',
  scenes,
};

const styleSelection = {
  id: 'style-1', version: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  approval: 'approved', characterProfileSetId: 'profiles-1', characterProfileSetVersion: 1,
  source: 'style-library', name: '写实', stylePrompt: '写实电影质感。', referenceMediaPaths: [], selectedBy: 'user',
};

function profile(name, profileKey) {
  return {
    profileKey,
    name,
    aliases: [],
    introduction: `${name}在本集家庭日常中承担明确作用。`,
    identity: `${name}的剧本身份`,
    storyRole: '本集候选实体',
    personality: ['稳定'],
    motivation: '完成本集行动。',
    relationships: [],
    physicalKnownFacts: [],
    wardrobeKnownFacts: [],
    designOpenQuestions: [],
    sourceSceneKeys: ['S01'],
    sourceFacts: [{ fact: `${name}出现在家庭场次。`, sceneKey: 'S01', evidence: name === '妈妈' ? '妈妈在家庭空间完成动作1' : '环境保持生活气息' }],
  };
}

const visualDesignProposal = {
  locationIdentity: '一套可复用的家庭生活空间。',
  spatialLayout: '主要区域通过稳定动线连接。',
  terrainAndArchitecture: '住宅室内结构。',
  materialsAndSurfaces: '木质、织物与浅色墙面。',
  fixedLandmarks: ['入口', '餐桌', '客厅窗户'],
  lightingAndColor: '自然光随时间变化。',
  weatherAndAtmosphere: '温暖日常。',
  reusableCameraCoverage: '建立镜头与中近景均可复用。',
  designDecisions: [],
};

function sceneProposal(sceneKey, name = `家庭空间${sceneKey}`) {
  return {
    name,
    sourceSceneKeys: [sceneKey],
    baseStateSceneKey: sceneKey,
    sourceFacts: [{ fact: `${sceneKey}的地点事实`, sceneKey, evidenceId: `E-${sceneKey}-LOCATION` }],
    stateVariants: [],
    visualDesignProposal,
  };
}

function completed(output) {
  return {
    output,
    providerId: 'fake-agent', model: 'fake-model', status: 'completed',
    completedAt: '2026-09-01T00:00:00.000Z', elapsedMs: 1,
  };
}

test('production director removes a semantic non-character through one targeted specialist repair', async () => {
  const operations = [];
  let specialistRuns = 0;
  let directorRuns = 0;
  const provider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-09-01T00:00:00.000Z' }; },
    async generate(request) {
      operations.push(request.operation);
      if (request.operation === 'extract-character-profiles') {
        specialistRuns += 1;
        return completed(specialistRuns === 1
          ? { profiles: [profile('妈妈', 'C01'), profile('环境', 'C02')] }
          : { profiles: [profile('妈妈', 'C01')] });
      }
      directorRuns += 1;
      return completed(directorRuns === 1
        ? { decision: 'revise', summary: '环境承担空间功能，不需要人物身份连续性。', revisionInstructions: ['只保留需要人物身份连续的妈妈。'], finalCharacterNames: ['妈妈'] }
        : { decision: 'approve', summary: '人物范围与剧本功能一致。', revisionInstructions: [], finalCharacterNames: ['妈妈'] });
    },
  };

  const result = await generateCharacterProfilesWithDirector(provider, {
    script,
    requiredCharacterNames: ['妈妈', '环境'],
    preferences: { language: '中文' },
  });

  assert.deepEqual(result.output.profiles.map((item) => item.name), ['妈妈']);
  assert.equal(result.supervision.specialistRuns, 2);
  assert.equal(result.supervision.directorReviews.length, 2);
  assert.deepEqual(operations, [
    'extract-character-profiles',
    'production-director-review-character-profiles',
    'extract-character-profiles',
    'production-director-review-character-profiles',
  ]);
});

test('production director can return over-split scene proposals for semantic regrouping', async () => {
  let specialistRuns = 0;
  let directorRuns = 0;
  const provider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-09-01T00:00:00.000Z' }; },
    async generate(request) {
      if (request.operation === 'generate-scene-visual-proposals') {
        specialistRuns += 1;
        return completed(specialistRuns === 1
          ? { proposals: scenes.map((scene) => sceneProposal(scene.sceneKey)) }
          : { proposals: [{
              ...sceneProposal('S01', '可复用家庭生活空间'),
              sourceSceneKeys: scenes.map((scene) => scene.sceneKey),
              baseStateSceneKey: 'S01',
            }] });
      }
      directorRuns += 1;
      return completed(directorRuns === 1
        ? { decision: 'revise', summary: '当前拆分主要跟随时间与镜头用途，没有形成五个独立物理空间。', revisionInstructions: ['根据稳定空间结构与复用价值重新归并。'] }
        : { decision: 'approve', summary: '场景资产范围可以支撑后续分镜复用。', revisionInstructions: [] });
    },
  };

  const result = await generateSceneVisualProposalsWithDirector(provider, { script, styleSelection });
  assert.equal(result.output.proposals.length, 1);
  assert.deepEqual(result.output.proposals[0].sourceSceneKeys, ['S01', 'S02', 'S03', 'S04', 'S05']);
  assert.equal(result.supervision.specialistRuns, 2);
  assert.equal(result.supervision.directorReviews.length, 2);
});

test('a second scene director revision becomes a user-reviewable advisory instead of blocking the stage', async () => {
  let directorRuns = 0;
  const provider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-09-01T00:00:00.000Z' }; },
    async generate(request) {
      if (request.operation === 'generate-scene-visual-proposals') {
        return completed({ proposals: scenes.map((scene) => sceneProposal(scene.sceneKey)) });
      }
      directorRuns += 1;
      return completed({ decision: 'revise', summary: `第${directorRuns}轮仍需调整。`, revisionInstructions: ['重新判断空间复用关系。'] });
    },
  };

  const result = await generateSceneVisualProposalsWithDirector(provider, { script, styleSelection });
  assert.equal(result.output.proposals.length, scenes.length);
  assert.equal(result.supervision.specialistRuns, 2);
  assert.equal(result.supervision.directorReviews.length, 2);
  assert.equal(result.supervision.directorReviews[1].decision, 'revise');
  assert.match(result.supervision.directorReviews[1].revisionInstructions.join('；'), /重新判断空间复用关系/u);
  assert.equal(directorRuns, 2);
});

test('director review requests state semantic authority without fixing a group count', () => {
  const characterRequest = buildCharacterDirectorReviewRequest(
    { script, requiredCharacterNames: ['妈妈', '环境'] },
    { profiles: [profile('妈妈', 'C01'), profile('环境', 'C02')] },
    1,
  );
  const sceneRequest = buildSceneDirectorReviewRequest(
    { script, styleSelection },
    { proposals: [] },
    1,
  );
  assert.match(characterRequest.instructions, /不会用关键词替你判断/u);
  assert.match(sceneRequest.instructions, /不要求某种固定分组数量/u);
  assert.match(sceneRequest.instructions, /最少但够用的场景资产/u);
  assert.match(buildSceneDirectorReviewRequest({ script, styleSelection }, { proposals: [] }, 2).instructions, /不要据此阻断场景阶段/u);
  assert.doesNotMatch(sceneRequest.instructions, /厨房.*客厅/u);
});

test('production director reviews prop semantics after traceable evidence is grounded', async () => {
  const operations = [];
  const provider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-09-01T00:00:00.000Z' }; },
    async generate(request) {
      operations.push(request.operation);
      if (request.operation === 'generate-prop-visual-proposals') {
        return completed({ proposals: [{
          name: '无线耳机', aliases: ['耳机', '无线耳机'], baseStateDescription: '成对收纳、洁净完好。',
          sourceFacts: [{ fact: '耳机作为同一件可复用物品出现。', evidenceId: 'E-S01-SOURCE-01' }],
          stateVariants: [{ stateKey: 'paired-clean', stateDescription: '成对洁净状态。', evidenceIds: ['E-S01-SOURCE-01', 'E-S04-SOURCE-01'] }],
          visualDesignProposal: {
            objectIdentity: '一对日常使用的无线耳机。', silhouetteAndProportions: '两枚小型入耳式耳机。',
            materialsAndSurface: '细腻哑光塑料。', constructionAndDetails: '左右耳机结构对应。', colorAndFinish: '中性浅色。',
            scaleAndHandling: '可由单手拿取。', repeatableAnchors: ['短柄', '圆润腔体', '细小状态灯'], designDecisions: [],
          },
        }] });
      }
      return completed({ decision: 'approve', summary: '跨场证据共同描述同一可复用状态，语义成立。', revisionInstructions: [] });
    },
  };
  const propScript = {
    ...script,
    scenes: scenes.map((item, index) => ({
      ...item,
      sourceEvidence: index === 0 || index === 3 ? ['无线耳机在家庭空间中出现。'] : item.sourceEvidence,
    })),
  };

  const result = await generatePropVisualProposalsWithDirector(provider, { script: propScript, styleSelection });
  assert.deepEqual(operations, ['generate-prop-visual-proposals', 'production-director-review-prop-proposals']);
  assert.deepEqual(result.output.proposals[0].stateVariants[0].sourceSceneKeys, ['S01', 'S04']);
  assert.equal(result.supervision.specialistRuns, 1);
});

test('production director retains a valid prop draft when final review is advisory', async () => {
  const operations = [];
  let specialistRound = 0;
  const provider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-09-01T00:00:00.000Z' }; },
    async generate(request) {
      operations.push(request.operation);
      if (request.operation === 'generate-prop-visual-proposals') {
        specialistRound += 1;
        return completed({ proposals: [{
          name: '无线耳机', aliases: ['无线耳机'], baseStateDescription: '成对收纳、洁净完好。',
          sourceFacts: [{ fact: '无线耳机在家庭空间中出现。', evidenceId: 'E-S01-SOURCE-01' }], stateVariants: [],
          visualDesignProposal: {
            objectIdentity: '一对日常使用的无线耳机。', silhouetteAndProportions: '两枚小型入耳式耳机。',
            materialsAndSurface: '细腻哑光塑料。', constructionAndDetails: '左右耳机结构对应。', colorAndFinish: '中性浅色。',
            scaleAndHandling: '可由单手拿取。', repeatableAnchors: ['短柄', '圆润腔体'], designDecisions: [],
          },
        }] });
      }
      return completed({ decision: 'revise', summary: '建议在分镜中明确耳机摆放方向。', revisionInstructions: ['在特写镜头中明确左右耳机朝向。'] });
    },
  };
  const propScript = {
    ...script,
    scenes: scenes.map((item, index) => ({
      ...item,
      sourceEvidence: index === 0 ? ['无线耳机在家庭空间中出现。'] : item.sourceEvidence,
    })),
  };

  const result = await generatePropVisualProposalsWithDirector(provider, { script: propScript, styleSelection });

  assert.equal(specialistRound, 2);
  assert.equal(result.output.proposals[0].sourceSceneKeys[0], 'S01');
  assert.equal(result.supervision.directorReviews.at(-1).decision, 'revise');
  assert.deepEqual(operations, [
    'generate-prop-visual-proposals',
    'production-director-review-prop-proposals',
    'generate-prop-visual-proposals',
    'production-director-review-prop-proposals',
  ]);
});

test('prop director instructions assign semantic authority to the director', () => {
  const request = buildPropDirectorReviewRequest(
    { script, styleSelection },
    { proposals: [] },
    1,
  );
  assert.match(request.instructions, /多个场次共同证明/u);
  assert.match(request.instructions, /均由你按剧情与制作语义判断/u);
  assert.match(request.instructions, /程序只确认数据可读取、证据编号真实存在和稳定ID/u);
  assert.match(request.instructions, /最少但够用/u);
  assert.match(request.instructions, /常见食材、常见容器和临时陈设通常应为text_only/u);
  assert.match(request.instructions, /出现次数不得单独决定等级/u);
});
