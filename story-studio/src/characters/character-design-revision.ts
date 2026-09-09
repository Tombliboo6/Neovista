import type { CharacterProfileDraft } from '../domain/contracts.js';
import type { AgentProvider } from '../providers/contracts.js';
import { loadPromptWritingStandard } from '../free-canvas/prompt-optimization.ts';

export interface CharacterDesignRevisionInput {
  profile: CharacterProfileDraft;
  currentPrompt: string;
  revisionRequest: string;
  styleName: string;
}

export interface CharacterDesignRevisionResult {
  profile: CharacterProfileDraft;
  prompt: string;
}

const editableProfileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    introduction: { type: 'string', minLength: 1, maxLength: 4_000 },
    identity: { type: 'string', minLength: 1, maxLength: 2_000 },
    storyRole: { type: 'string', minLength: 1, maxLength: 2_000 },
    personality: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } },
    motivation: { type: 'string', minLength: 1, maxLength: 2_000 },
    physicalKnownFacts: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
    wardrobeKnownFacts: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
    designOpenQuestions: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
  },
  required: ['introduction', 'identity', 'storyRole', 'personality', 'motivation', 'physicalKnownFacts', 'wardrobeKnownFacts', 'designOpenQuestions'],
} as const;

const characterDesignRevisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profile: editableProfileSchema,
    promptSections: {
      type: 'object',
      additionalProperties: false,
      properties: {
        basicSetting: { type: 'string', minLength: 1, maxLength: 4_000 },
        atmosphereQualityPhotography: { type: 'string', minLength: 1, maxLength: 4_000 },
        contentLayout: { type: 'string', minLength: 1, maxLength: 6_000 },
        cameraImaging: { type: 'string', minLength: 1, maxLength: 4_000 },
        negativeTerms: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      required: ['basicSetting', 'atmosphereQualityPhotography', 'contentLayout', 'cameraImaging', 'negativeTerms'],
    },
  },
  required: ['profile', 'promptSections'],
} as const;

export async function reviseCharacterDesign(
  provider: AgentProvider,
  input: CharacterDesignRevisionInput,
): Promise<CharacterDesignRevisionResult> {
  const profile = validateProfile(input?.profile);
  const currentPrompt = requiredText(input?.currentPrompt, '当前角色图片提示词', 100_000);
  const revisionRequest = requiredText(input?.revisionRequest, '人物修改要求', 4_000);
  const styleName = requiredText(input?.styleName, '当前画风', 500);
  const promptStandard = loadPromptWritingStandard();
  const result = await provider.generate<{
    profile: Pick<CharacterProfileDraft, 'introduction' | 'identity' | 'storyRole' | 'personality' | 'motivation' | 'physicalKnownFacts' | 'wardrobeKnownFacts' | 'designOpenQuestions'>;
    promptSections: { basicSetting: string; atmosphereQualityPhotography: string; contentLayout: string; cameraImaging: string; negativeTerms: string[] };
  }>({
    operation: 'revise-character-profile-and-image-prompt',
    schemaName: 'prism_character_design_revision_v1',
    maxOutputTokens: 16_000,
    instructions: [
      '你是PRISM Story Studio的人物视觉设计师。根据用户已经确认的修改要求，同步修改一个人物的文字设定与角色图片提示词；当前只返回文字，不调用图片模型。',
      '用户修改要求是本轮唯一修改目标。没有被点名的人物身份、剧情功能、关系、性格核心、服装体系、画风和资产板用途全部保留，不得重写剧情或增加新身份。',
      'profile只返回可编辑字段的完整新值。人物稳定ID、姓名、别名、关系、剧本证据和场次归属由程序保留，不得在输出中改写。用户已明确补充的年龄、外貌、体态或服装可写入对应事实，并从designOpenQuestions移除已经解决的问题。',
      'promptSections必须以修改后的人物设定和当前提示词为基础，只改动本轮要求涉及的描述。年龄等关键视觉要求要同时落实到基础设定、可见外貌与身份锚点，使用具体可见特征表达。',
      '静态图片提示词严格使用五段式职责：基础设定；氛围、画质与摄影风格；画面内容与布局；摄影机与成像；负面词。字段正文中不要重复标题，负面词只保留5至8个当前任务最高风险问题。',
      '现有角色主资产图仍是横版双栏人物资产用途；保持面部近景与完整主全身的既有布局，不改成剧情画面、三视图或多镜头分镜。',
      `当前锁定画风为“${styleName}”，只能在该画风内落实人物修改。`,
      `以下是本项目当前图片与视频提示词统一规范，必须遵守：\n\n${promptStandard}`,
      '只返回严格JSON，不解释修改过程。',
    ].join('\n'),
    input: { profile, currentPrompt, revisionRequest, styleName },
    outputSchema: characterDesignRevisionSchema,
  });
  const editable = result.output?.profile;
  const sections = result.output?.promptSections;
  if (!editable || !sections) throw new Error('文字Agent没有返回完整的人物设定和图片提示词。');
  const revisedProfile: CharacterProfileDraft = {
    ...profile,
    introduction: requiredText(editable.introduction, '人物简介', 4_000),
    identity: requiredText(editable.identity, '人物身份', 2_000),
    storyRole: requiredText(editable.storyRole, '剧情定位', 2_000),
    personality: textList(editable.personality, '人物性格', 1, 20),
    motivation: requiredText(editable.motivation, '人物动机', 2_000),
    physicalKnownFacts: textList(editable.physicalKnownFacts, '外貌与体态', 0, 30),
    wardrobeKnownFacts: textList(editable.wardrobeKnownFacts, '服装与配饰', 0, 30),
    designOpenQuestions: textList(editable.designOpenQuestions, '待确认问题', 0, 30),
  };
  const negativeTerms = textList(sections.negativeTerms, '负面词', 5, 8);
  const prompt = [
    `人物资料：${profile.name}（${profile.profileKey}）`,
    `画风预设：${styleName}`,
    '',
    '基础设定', requiredText(sections.basicSetting, '基础设定', 4_000),
    '',
    '氛围、画质与摄影风格', requiredText(sections.atmosphereQualityPhotography, '氛围、画质与摄影风格', 4_000),
    '',
    '画面内容与布局', requiredText(sections.contentLayout, '画面内容与布局', 6_000),
    '',
    '摄影机与成像', requiredText(sections.cameraImaging, '摄影机与成像', 4_000),
    '',
    '负面词', negativeTerms.join('，'),
  ].join('\n');
  return { profile: revisedProfile, prompt };
}

function validateProfile(value: CharacterProfileDraft): CharacterProfileDraft {
  if (!value || typeof value !== 'object') throw new Error('当前人物设定无效。');
  requiredText(value.profileKey, '人物ID', 200);
  requiredText(value.name, '人物姓名', 500);
  requiredText(value.introduction, '人物简介', 4_000);
  if (!Array.isArray(value.sourceFacts) || !Array.isArray(value.sourceSceneKeys)) throw new Error('当前人物剧本证据无效。');
  return JSON.parse(JSON.stringify(value));
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new Error(`${label}无效。`);
  return text;
}

function textList(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}无效。`);
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (items.length < minimum || items.length > maximum) throw new Error(`${label}数量无效。`);
  return items;
}
