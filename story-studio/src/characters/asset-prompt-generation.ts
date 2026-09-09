import type {
  CharacterAssetPromptDraft,
  CharacterProfileSet,
  StyleSelection
} from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { normalizeOptionalAgentStringList, partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';

export const CHARACTER_ASSET_PROMPT_SCHEMA_NAME =
  'prism_autodrama_character_asset_prompt_draft_v1';

export const CHARACTER_MAIN_ASSET_LAYOUT = [
  '使用横版3:2的双栏人物主资产图，纯净中性摄影棚背景，两个画面区域使用窄分隔线。',
  '左侧约50%为一张大型正面头肩近景，完整显示发型轮廓、脸部、颈部、肩部和上胸衣领，作为唯一主要面部与身份锚点。',
  '右侧约50%为一张大型主全身定妆图：人物正面略带三分之二侧转，完整露出头顶、双手和双鞋。',
  '人物使用干净、干燥、无伤、无战损的可复用基础定妆，不固化雨水、泥渍、中毒、血迹、异常肤色或特定场景光线。',
  '若已批准人物事实中存在能表达角色身份或当前剧情功能的代表性道具，右侧主全身图可持有一件；左侧面部近景不出现道具，道具不得遮挡脸部、双手或服装轮廓。',
  '两个画面区域保持同一人物、年龄、身材比例、肤色、发型、服装、鞋履和配饰，光线、曝光、白平衡、背景和分隔方式一致。',
  '主资产图内部不生成任何文字标签，不在这张图中混入三视图或设定草图。'
].join('\n');

export const REALISTIC_CHARACTER_ASSET_LAYOUT = [
  '横版3:2人物资产板，纯净中性摄影棚背景，窄分隔线。',
  '左侧约42%为大型主全身定妆图，正面略带四分之三侧转，完整露出头顶、双手和双鞋。',
  '右上约58%为大型正面头肩近景，作为主要面部与身份锚点。',
  '右下三个等宽身体服装视图从左到右为正面、严格左侧面、完整背面；上沿裁在下巴下方，保留颈部、衣领、肩膀、躯干、双臂、双手、双腿和鞋，脸部及头发位于裁切范围外。',
  '每个视图保持同一人物、年龄、体型、肤色、发型、服装、鞋履和配饰；中性站姿，双手自然下垂。'
].join('\n');

function usesRealisticAssetBoard(input: CharacterAssetPromptGenerationInput): boolean {
  return input.styleSelection.name === '真人电影写实';
}


export const CHARACTER_TURNAROUND_LAYOUT = [
  '使用横版3:2的详细人物三视图，以已批准的人物主资产图作为唯一身份、脸部、发型、体型和服装参考。',
  '画面中三个等宽全身视图从左到右依次为完整正面、严格左侧面和完整背面，每个视图都完整露出头顶、双手和双鞋。',
  '三个视图使用同一人物、同一中性表情、同一发型、同一服装、同一配饰和自然下垂的空手站姿，不持道具，便于检查身体与服装结构。',
  '纯净中性摄影棚背景，视点高度、人物比例、曝光、白平衡和地面高度完全一致，不生成文字标签。'
].join('\n');

/** @deprecated Use CHARACTER_MAIN_ASSET_LAYOUT for the first character image. */
export const CHARACTER_ASSET_BOARD_LAYOUT = CHARACTER_MAIN_ASSET_LAYOUT;

export interface CharacterAssetPromptGenerationInput {
  characterProfileSet: CharacterProfileSet;
  styleSelection: StyleSelection;
  preferences?: {
    language?: string;
    requirements?: string[];
  };
}

export interface CharacterAssetPromptGenerationDraft {
  prompts: CharacterAssetPromptDraft[];
}

export class CharacterAssetPromptValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Character asset prompts failed validation: ${issues.join(' | ')}`);
    this.name = 'CharacterAssetPromptValidationError';
    this.issues = issues;
  }
}

export function buildCharacterAssetPromptRequest(
  input: CharacterAssetPromptGenerationInput
): AgentRequest<CharacterAssetPromptGenerationInput> {
  validateInput(input);

  return {
    operation: 'generate-character-asset-board-prompts',
    schemaName: CHARACTER_ASSET_PROMPT_SCHEMA_NAME,
    instructions: [
      `你是角色视觉设计师，负责根据已审批人物介绍和用户锁定画风，为每个角色生成一份${usesRealisticAssetBoard(input) ? '含主全身、面部近景与身体服装视图的完整人物资产板' : '“面部近景 + 主全身”双栏人物主资产'}生图提示词草稿。当前只写提示词，不调用图片模型。`,
      '只为 characterProfileSet.profiles 中的角色各输出一项，保持原顺序，不得遗漏、重复或新增角色；promptKey 使用 P01、P02 的连续格式，并原样填写对应 characterProfileId 与 characterName。',
      '人物介绍中的 physicalKnownFacts、wardrobeKnownFacts、身份、性格和关系是已审批事实，不得改写为冲突设定；designOpenQuestions 才允许进行视觉设计。',
      'visualDesignProposal明确人物最重要的面部、体型、服装与可重复身份特征；其余细节只在确有设计价值时填写。这些内容是待用户审核的设计提案，不得冒充原文事实。',
      '服装与配饰必须符合人物身份、剧情功能和 styleSelection 的统一画风；同一角色所有视图使用完全一致的设计。不要为角色增加会改变剧情的武器、法宝、伤疤、宗门徽记或身份。',
      '主资产必须是可长期复用的干净基础定妆：保留稳定身份、面部、发型、体型和常规服装，不把雨湿、泥渍、中毒、血迹、战损、受伤、能力激活或特定场景光线固化进人物资产。',
      '只有在已批准人物事实中明确出现、且能表达角色身份或当前剧情功能时，才允许选择一件代表性道具；它只出现在右侧主全身图，不出现在左侧面部近景，不得遮挡人物，不得写入人物身份锚点。没有合格道具时保持空手。',
      'sections 只填写五段式中文静态图片提示词的可变内容：basicSetting、atmosphereQualityPhotography、contentSpecifics、cameraImaging、negativeTerms。程序会负责标题、画风锚点和固定资产板布局。',
      '必须读取 styleSelection.stylePrompt 的完整预设画风锚点，并在 atmosphereQualityPhotography 中结合当前角色扩写其人物造型语言、材质渲染、光影、色彩和成像质感；不得只重复风格名称，也不得写入任何产品名、平台名、竞品名、品牌名或“某某式”来源表达。',
      'contentSpecifics 只补充人物在各面板的可见状态、服装结构、姿态和视觉重点，不要重写固定版式；cameraImaging 只写摄影机与成像；不要在正向段落重复负面约束。',
      'negativeTerms 必须为5至8个当前人物资产板最高风险问题，不写泛滥的通用词，不与正向段落机械重复。',
      '固定人物主资产版式由程序注入，模型不得改动：' + (usesRealisticAssetBoard(input) ? REALISTIC_CHARACTER_ASSET_LAYOUT : CHARACTER_MAIN_ASSET_LAYOUT),
      usesRealisticAssetBoard(input) ? '右下身体服装视图的裁切必须位于下巴下方，面部身份由右上大近景控制。' : '不在首张人物主资产中生成三视图。三视图是用户在画布上批准主资产后，点击独立按钮才触发的后续派生资产。',
      '资产板固定使用3:2画幅和中性棚拍。剧情场地、时刻、正在发生的动作、工作台及剧情画幅不进入资产板。人物的个性只通过visualDesignProposal中的稳定外形与服装表现。',
      '遵守 preferences 中的语言和附加要求。输出必须严格符合JSON Schema，不要输出解释性文字。'
    ].join('\n'),
    input,
    outputSchema: CHARACTER_ASSET_PROMPT_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generateCharacterAssetPrompts(
  provider: AgentProvider,
  input: CharacterAssetPromptGenerationInput
): Promise<AgentGenerationResult<CharacterAssetPromptGenerationDraft>> {
  const result = await provider.generate<CharacterAssetPromptGenerationDraft>(
    buildCharacterAssetPromptRequest(input)
  );
  if (Array.isArray(result.output.prompts)) {
    result.output.prompts.forEach((prompt, index) => {
      const profile = input.characterProfileSet.profiles[index];
      if (!profile) return;
      prompt.promptKey = `P${String(index + 1).padStart(2, '0')}`;
      prompt.characterProfileId = profile.id;
      prompt.characterName = profile.name;
      if (prompt.visualDesignProposal) {
        prompt.visualDesignProposal.accessories = normalizeOptionalAgentStringList(prompt.visualDesignProposal.accessories);
        prompt.visualDesignProposal.repeatableIdentityAnchors = normalizeOptionalAgentStringList(prompt.visualDesignProposal.repeatableIdentityAnchors);
        prompt.visualDesignProposal.naturalAsymmetry = normalizeOptionalAgentStringList(prompt.visualDesignProposal.naturalAsymmetry);
      }
      if (prompt.sections) prompt.sections.negativeTerms = normalizeOptionalAgentStringList(prompt.sections.negativeTerms);
    });
  }
  validateCharacterAssetPromptDraft(result.output, input);
  return result;
}

export function validateCharacterAssetPromptDraft(
  draft: CharacterAssetPromptGenerationDraft,
  input: CharacterAssetPromptGenerationInput
): string[] {
  const issues: string[] = [];
  if (!Array.isArray(draft.prompts)) {
    throw new CharacterAssetPromptValidationError(['prompts must be an array']);
  }

  const profiles = input.characterProfileSet.profiles;
  if (draft.prompts.length !== profiles.length) {
    issues.push('prompt count must match approved character profile count');
  }

  draft.prompts.forEach((prompt, index) => {
    validatePromptAt(prompt, profiles[index], index, issues);
  });

  const actualIds = draft.prompts.map((prompt) => prompt.characterProfileId);
  const expectedIds = profiles.map((profile) => profile.id);
  if (actualIds.join('\u0000') !== expectedIds.join('\u0000')) {
    issues.push('prompts must cover approved character profiles exactly once and in order');
  }

  const report = partitionAgentDraftValidationIssues('character-asset-prompt', issues);
  if (report.blockingIssues.length > 0) throw new CharacterAssetPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function compileCharacterAssetPrompt(
  draft: CharacterAssetPromptDraft,
  input: CharacterAssetPromptGenerationInput
): string {
  validateInput(input);
  const index = input.characterProfileSet.profiles.findIndex(
    (profile) => profile.id === draft.characterProfileId
  );
  if (index < 0) {
    throw new CharacterAssetPromptValidationError([
      'prompt does not reference an approved character profile'
    ]);
  }
  const issues: string[] = [];
  validatePromptAt(draft, input.characterProfileSet.profiles[index], index, issues);
  const report = partitionAgentDraftValidationIssues('character-asset-prompt', issues);
  if (report.blockingIssues.length > 0) throw new CharacterAssetPromptValidationError(report.blockingIssues);

  const design = draft.visualDesignProposal;
  const identity = [design.ageRange, design.faceAndFeatures, design.hair, design.bodyAndProportions, design.skinAndComplexion, design.wardrobe, design.footwear, ...design.accessories, ...design.repeatableIdentityAnchors, ...design.naturalAsymmetry].filter(Boolean).join('；');
  return removeExternalStyleAttribution([
    `人物资料：${draft.characterName}（${draft.characterProfileId}）`,
    `画风预设：${input.styleSelection.name}`,
    '',
    '基础设定',
    `横版3:2中性摄影棚人物定妆资产板。角色：${draft.characterName}。${identity}。`,
    '',
    '氛围、画质与摄影风格',
    `${input.styleSelection.stylePrompt.trim()}\n均匀柔和的中性棚拍光，曝光与白平衡一致，服装材质清晰。`,
    '',
    '画面内容与布局',
    usesRealisticAssetBoard(input) ? REALISTIC_CHARACTER_ASSET_LAYOUT : CHARACTER_MAIN_ASSET_LAYOUT,
    '',
    '摄影机与成像',
    '全身与身体服装视图使用标准镜头自然透视，机位端正，身体比例与地面高度一致；面部近景使用中长焦观感，焦点落在双眼。景深覆盖各视图需要展示的人物细节。',
    '',
    '负面词',
    ['身份漂移', '服装不一致', '缺手缺脚', '文字标签', '剧情场景混入', ...draft.sections.negativeTerms.map((term) => term.trim())].filter((term, index, all) => all.indexOf(term) === index).slice(0, 8).join('，')
  ].join('\n'));
}

function removeExternalStyleAttribution(value: string): string {
  return value
    .replace(/OiiOii式/gi, '双栏')
    .replace(/Oii式/gi, '双栏')
    .replace(/OiiOii/gi, '')
    .replace(/Oii/gi, '');
}

function validatePromptAt(
  prompt: CharacterAssetPromptDraft,
  profile: CharacterProfileSet['profiles'][number] | undefined,
  index: number,
  issues: string[]
): void {
  const position = index + 1;
  const expectedKey = `P${String(position).padStart(2, '0')}`;
  if (index < 0 || prompt.promptKey !== expectedKey) {
    issues.push(`prompt ${Math.max(position, 1)} must use promptKey ${expectedKey}`);
  }
  if (
    !profile ||
    prompt.characterProfileId !== profile.id ||
    normalize(prompt.characterName) !== normalize(profile.name)
  ) {
    issues.push(`prompt ${Math.max(position, 1)} does not match the approved character profile`);
  }
  if (!completeVisualDesign(prompt.visualDesignProposal)) {
    issues.push(`prompt ${Math.max(position, 1)} has an incomplete visual design proposal`);
  }
  if (!completeSections(prompt.sections)) {
    issues.push(`prompt ${Math.max(position, 1)} has incomplete prompt sections`);
  }
  const negativeCount = prompt.sections?.negativeTerms?.length ?? 0;
  if (negativeCount < 5 || negativeCount > 8) {
    issues.push(`prompt ${Math.max(position, 1)} negativeTerms must contain 5 to 8 items`);
  }
}

function validateInput(input: CharacterAssetPromptGenerationInput): void {
  const profiles = input.characterProfileSet;
  const style = input.styleSelection;
  if (profiles.approval !== 'approved') {
    throw new Error('Character profiles must be approved before prompt generation.');
  }
  if (style.approval !== 'approved') {
    throw new Error('Visual style must be approved before prompt generation.');
  }
  if (
    style.characterProfileSetId !== profiles.id ||
    style.characterProfileSetVersion !== profiles.version
  ) {
    throw new Error('Visual style does not match the approved character profile version.');
  }
  if (profiles.profiles.length === 0) {
    throw new Error('At least one approved character profile is required.');
  }
}

function completeVisualDesign(
  value: CharacterAssetPromptDraft['visualDesignProposal'] | undefined
): boolean {
  if (!value) return false;
  if (
    ![
      value.ageRange,
      value.faceAndFeatures,
      value.hair,
      value.bodyAndProportions,
      value.skinAndComplexion,
      value.wardrobe,
      value.footwear
    ].every(nonEmpty)
  ) {
    return false;
  }
  return (
    Array.isArray(value.accessories) &&
    value.accessories.every(nonEmpty) &&
    Array.isArray(value.repeatableIdentityAnchors) &&
    value.repeatableIdentityAnchors.every(nonEmpty) &&
    Array.isArray(value.naturalAsymmetry) &&
    value.naturalAsymmetry.every(nonEmpty)
  );
}

function completeSections(
  value: CharacterAssetPromptDraft['sections'] | undefined
): boolean {
  return Boolean(
    value &&
      [
        value.basicSetting,
        value.atmosphereQualityPhotography,
        value.contentSpecifics,
        value.cameraImaging
      ].every(nonEmpty) &&
      Array.isArray(value.negativeTerms) &&
      value.negativeTerms.every(nonEmpty)
  );
}

function normalize(value: string): string {
  return value.trim();
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const CHARACTER_ASSET_PROMPT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          promptKey: { type: 'string', pattern: '^P[0-9]{2,}$' },
          characterProfileId: { type: 'string' },
          characterName: { type: 'string' },
          visualDesignProposal: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ageRange: { type: 'string' },
              faceAndFeatures: { type: 'string' },
              hair: { type: 'string' },
              bodyAndProportions: { type: 'string' },
              skinAndComplexion: { type: 'string' },
              wardrobe: { type: 'string' },
              footwear: { type: 'string' },
              accessories: { type: 'array', items: { type: 'string' } },
              repeatableIdentityAnchors: {
                type: 'array',
                items: { type: 'string' }
              },
              naturalAsymmetry: {
                type: 'array',
                minItems: 1,
                items: { type: 'string' }
              }
            },
            required: [
              'ageRange',
              'faceAndFeatures',
              'hair',
              'bodyAndProportions',
              'skinAndComplexion',
              'wardrobe',
              'footwear',
              'accessories',
              'repeatableIdentityAnchors',
              'naturalAsymmetry'
            ]
          },
          sections: {
            type: 'object',
            additionalProperties: false,
            properties: {
              basicSetting: { type: 'string' },
              atmosphereQualityPhotography: { type: 'string' },
              contentSpecifics: { type: 'string' },
              cameraImaging: { type: 'string' },
              negativeTerms: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: [
              'basicSetting',
              'atmosphereQualityPhotography',
              'contentSpecifics',
              'cameraImaging',
              'negativeTerms'
            ]
          }
        },
        required: [
          'promptKey',
          'characterProfileId',
          'characterName',
          'visualDesignProposal',
          'sections'
        ]
      }
    }
  },
  required: ['prompts']
};
