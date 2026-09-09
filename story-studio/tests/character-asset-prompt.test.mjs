import { assetBoardLayoutIssues } from '../src/validation/asset-board-validation.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCharacterAssetPromptRequest,
  CHARACTER_MAIN_ASSET_LAYOUT,
  CHARACTER_TURNAROUND_LAYOUT,
  CHARACTER_ASSET_PROMPT_SCHEMA_NAME,
  CharacterAssetPromptValidationError,
  compileCharacterAssetPrompt,
  generateCharacterAssetPrompts,
  validateCharacterAssetPromptDraft
} from '../src/characters/asset-prompt-generation.ts';
import { materializeCharacterAssetPromptSet } from '../src/characters/asset-prompt-versioning.ts';

const profiles = {
  id: 'profiles-episode-1',
  version: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved',
  scriptId: 'script-1',
  scriptVersion: 2,
  profiles: [
    {
      id: 'profile-zhang',
      profileKey: 'C01',
      name: '张浩然',
      aliases: [],
      introduction: '宗门第一天才。',
      identity: '宗门弟子',
      storyRole: '主角',
      personality: ['决绝'],
      motivation: '阻止林无双夺印。',
      relationships: [],
      physicalKnownFacts: ['脸色苍白'],
      wardrobeKnownFacts: [],
      designOpenQuestions: ['年龄', '发型', '服装'],
      sourceSceneKeys: ['S01'],
      sourceFacts: [{ fact: '中毒', sceneKey: 'S01', evidence: '中了剧毒' }]
    },
    {
      id: 'profile-lin',
      profileKey: 'C02',
      name: '林无双',
      aliases: [],
      introduction: '雨夜截杀者。',
      identity: '宗门弟子',
      storyRole: '反派',
      personality: ['冷酷'],
      motivation: '夺取人皇印。',
      relationships: [],
      physicalKnownFacts: ['双眼可变成金黄色'],
      wardrobeKnownFacts: [],
      designOpenQuestions: ['年龄', '发型', '服装'],
      sourceSceneKeys: ['S01'],
      sourceFacts: [{ fact: '金眸', sceneKey: 'S01', evidence: '双眼变成金黄色' }]
    }
  ]
};

const style = {
  id: 'style-episode-1',
  version: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved',
  characterProfileSetId: profiles.id,
  characterProfileSetVersion: profiles.version,
  source: 'style-library',
  name: '3D玄幻',
  stylePrompt: '高品质东方玄幻三维动画电影风格。',
  referenceMediaPaths: ['runtime-data/style-presets/06-3D玄幻.png'],
  selectedBy: 'user'
};

const input = { characterProfileSet: profiles, styleSelection: style };

function promptFor(index, profile) {
  return {
    promptKey: `P${String(index + 1).padStart(2, '0')}`,
    characterProfileId: profile.id,
    characterName: profile.name,
    visualDesignProposal: {
      ageRange: '二十四至二十七岁',
      faceAndFeatures: '轮廓清晰，眉眼有辨识度',
      hair: '黑色长发半束',
      bodyAndProportions: '修长但有力量感',
      skinAndComplexion: '自然肤色，面色略苍白',
      wardrobe: '深青色玄幻宗门长袍，层次清晰',
      footwear: '深色长靴',
      accessories: ['窄腰封'],
      repeatableIdentityAnchors: ['眉峰略高', '左眼尾浅痣', '窄长下颌'],
      naturalAsymmetry: ['左侧眉峰比右侧略高']
    },
    sections: {
      basicSetting: '同一名东方玄幻男性角色，完整人物资产板。',
      atmosphereQualityPhotography: '中性棚拍光，材质细节清晰。',
      contentSpecifics: '人物自然站立，服装结构和手部完整可见。',
      cameraImaging: '主全身使用标准镜头观感，主脸近景保持自然透视。',
      negativeTerms: ['多人混入', '身份漂移', '服装不一致', '缺手缺脚', '重复面孔', '文字水印']
    }
  };
}

const validDraft = {
  prompts: profiles.profiles.map((profile, index) => promptFor(index, profile))
};

test('prompt generation is gated by approved profiles and user-approved style', () => {
  const request = buildCharacterAssetPromptRequest(input);
  assert.equal(request.operation, 'generate-character-asset-board-prompts');
  assert.equal(request.schemaName, CHARACTER_ASSET_PROMPT_SCHEMA_NAME);
  assert.equal(request.maxOutputTokens, 40_000);
  assert.match(request.instructions, /当前只写提示词，不调用图片模型/);
  assert.match(request.instructions, /面部近景 \+ 主全身/);
  assert.match(request.instructions, /不在首张人物主资产中生成三视图/);
  assert.match(request.instructions, /雨湿、泥渍、中毒/);
  assert.match(request.instructions, /一件代表性道具/);

  assert.throws(
    () =>
      buildCharacterAssetPromptRequest({
        ...input,
        styleSelection: { ...style, approval: 'draft' }
      }),
    /style must be approved/
  );
});

test('valid API draft covers every approved character and design requirement', () => {
  assert.doesNotThrow(() => validateCharacterAssetPromptDraft(validDraft, input));

  const missing = { prompts: [validDraft.prompts[0]] };
  assert.deepEqual(validateCharacterAssetPromptDraft(missing, input), [
    'prompt count must match approved character profile count',
    'prompts must cover approved character profiles exactly once and in order',
  ]);

  const tooManyNegatives = structuredClone(validDraft);
  tooManyNegatives.prompts[0].sections.negativeTerms.push('额外一', '额外二', '额外三');
  assert.deepEqual(validateCharacterAssetPromptDraft(tooManyNegatives, input), []);
});

test('compiler owns the five-section Chinese format and neutral dual-panel main asset layout', () => {
  const compiled = compileCharacterAssetPrompt(validDraft.prompts[0], input);
  for (const heading of [
    '基础设定',
    '氛围、画质与摄影风格',
    '画面内容与布局',
    '摄影机与成像',
    '负面词'
  ]) {
    assert.equal(compiled.split(heading).length - 1, 1, `${heading} should appear once`);
  }
  assert.match(compiled, /左侧约50%为一张大型正面头肩近景/);
  assert.match(compiled, /右侧约50%为一张大型主全身定妆图/);
  assert.match(compiled, /右侧主全身图可持有一件/);
  assert.doesNotMatch(compiled, /右下为三个等宽身体服装视图/);
  assert.match(compiled, /高品质东方玄幻三维动画电影风格/);
  assert.doesNotMatch(compiled, /oii/i);
  assert.doesNotMatch(compiled, /声音总则/);
  assert.ok(CHARACTER_MAIN_ASSET_LAYOUT.length > 100);
  assert.match(CHARACTER_TURNAROUND_LAYOUT, /完整正面、严格左侧面和完整背面/);
  assert.match(CHARACTER_TURNAROUND_LAYOUT, /不持道具/);
});

test('provider output is validated before prompts are accepted', async () => {
  const fakeProvider = {
    id: 'fake-agent',
    async health() {
      return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' };
    },
    async generate() {
      return {
        output: validDraft,
        providerId: 'fake-agent',
        model: 'fake-model',
        status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z',
        elapsedMs: 1
      };
    }
  };
  const result = await generateCharacterAssetPrompts(fakeProvider, input);
  assert.equal(result.output.prompts.length, 2);
});

test('realistic asset compilation keeps approved visual identity and excludes conflicting scene framing', () => {
  const realistic = { ...input, styleSelection: { ...style, name: '真人电影写实' } };
  const draft = structuredClone(validDraft.prompts[0]);
  draft.sections.basicSetting = '16:9清晨旧钟表铺工作台前的半身修钟画面';
  draft.sections.atmosphereQualityPhotography = '窗边晨光照亮工作台';
  draft.sections.contentSpecifics = '手持镊子操作钟摆';
  draft.sections.cameraImaging = '16:9半身裁切';
  const compiled = compileCharacterAssetPrompt(draft, realistic);
  assert.match(compiled, /横版3:2/);
  assert.match(compiled, /左侧约42%/);
  assert.match(compiled, /右下三个等宽身体服装视图/);
  assert.match(compiled, /下巴下方/);
  assert.match(compiled, /深青色玄幻宗门长袍/);
  assert.match(compiled, /左眼尾浅痣/);
  assert.doesNotMatch(compiled, /16:9|工作台|修钟|手持镊子|半身裁切/);
  assert.equal(draft.sections.basicSetting, '16:9清晨旧钟表铺工作台前的半身修钟画面');
  assert.deepEqual(assetBoardLayoutIssues(compiled), []);
  assert.equal(assetBoardLayoutIssues(compiled + '\n\n目标画面比例：16:9。').length, 1);
  assert.deepEqual(assetBoardLayoutIssues('基础设定\n横版3:2道具资产板，钟面时间固定在8:20。另一只钟显示9:16。', '道具'), []);
});

test('optional accessories and short negative-term lists are normalized without rejecting characters', async () => {
  const relaxedDraft = structuredClone(validDraft);
  delete relaxedDraft.prompts[0].visualDesignProposal.accessories;
  relaxedDraft.prompts[0].sections.negativeTerms = ['身份漂移', '文字水印'];
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() { return { output: relaxedDraft, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 1 }; }
  };

  const result = await generateCharacterAssetPrompts(fakeProvider, input);
  assert.deepEqual(result.output.prompts[0].visualDesignProposal.accessories, []);
  assert.deepEqual(validateCharacterAssetPromptDraft(result.output, input), []);

  const request = buildCharacterAssetPromptRequest(input);
  assert.equal(request.outputSchema.properties.prompts.items.properties.visualDesignProposal.required.includes('accessories'), true);
});

test('program restores prompt bookkeeping fields without changing visual content', async () => {
  const drifted = structuredClone(validDraft);
  drifted.prompts[0].promptKey = 'P99';
  drifted.prompts[0].characterProfileId = 'made-up-id';
  drifted.prompts[0].characterName = '张 浩然';
  const fakeProvider = {
    id: 'fake-agent',
    async health() { return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' }; },
    async generate() {
      return { output: drifted, providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-21T00:00:00.000Z', elapsedMs: 1 };
    }
  };

  const result = await generateCharacterAssetPrompts(fakeProvider, input);

  assert.equal(result.output.prompts[0].promptKey, 'P01');
  assert.equal(result.output.prompts[0].characterProfileId, profiles.profiles[0].id);
  assert.equal(result.output.prompts[0].characterName, profiles.profiles[0].name);
  assert.equal(result.output.prompts[0].sections.basicSetting, validDraft.prompts[0].sections.basicSetting);
});

test('prompt set revisions preserve stable set and prompt IDs', () => {
  const first = materializeCharacterAssetPromptSet({
    promptSetId: 'character-prompts-episode-1',
    characterProfileSet: profiles,
    styleSelection: style,
    prompts: validDraft.prompts,
    timestamp: '2026-08-21T01:00:00.000Z'
  });
  const revised = structuredClone(validDraft.prompts);
  revised[0].sections.basicSetting = '修改后的基础设定。';
  const second = materializeCharacterAssetPromptSet({
    promptSetId: 'character-prompts-episode-1',
    characterProfileSet: profiles,
    styleSelection: style,
    prompts: revised,
    previousPromptSet: first,
    timestamp: '2026-08-21T02:00:00.000Z'
  });
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.equal(second.approval, 'draft');
  assert.deepEqual(
    second.prompts.map((prompt) => prompt.id),
    first.prompts.map((prompt) => prompt.id)
  );
  assert.match(second.prompts[1].compiledPrompt, /P02|林无双/);
});
