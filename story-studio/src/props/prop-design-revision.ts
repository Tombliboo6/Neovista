import type { PropAssetPromptSections } from '../domain/contracts.js';
import type { AgentProvider } from '../providers/contracts.js';
import { loadPromptWritingStandard } from '../free-canvas/prompt-optimization.ts';
import { PROP_MAIN_ASSET_LAYOUT, type PropVisualProposalDraft } from './prop-prompt-generation.ts';

export interface PropDesignRevisionInput {
  proposal: PropVisualProposalDraft;
  currentPrompt: string;
  revisionRequest: string;
  styleName: string;
}

export interface PropDesignRevisionResult {
  proposal: PropVisualProposalDraft;
  prompt: string;
}

const visualDesignSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    objectIdentity: { type: 'string', minLength: 1, maxLength: 4_000 },
    silhouetteAndProportions: { type: 'string', minLength: 1, maxLength: 4_000 },
    materialsAndSurface: { type: 'string', minLength: 1, maxLength: 4_000 },
    constructionAndDetails: { type: 'string', minLength: 1, maxLength: 4_000 },
    colorAndFinish: { type: 'string', minLength: 1, maxLength: 4_000 },
    scaleAndHandling: { type: 'string', minLength: 1, maxLength: 4_000 },
    repeatableAnchors: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
    designDecisions: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
  },
  required: ['objectIdentity', 'silhouetteAndProportions', 'materialsAndSurface', 'constructionAndDetails', 'colorAndFinish', 'scaleAndHandling', 'repeatableAnchors', 'designDecisions'],
} as const;

const promptSectionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    basicSetting: { type: 'string', minLength: 1, maxLength: 4_000 },
    atmosphereQualityPhotography: { type: 'string', minLength: 1, maxLength: 4_000 },
    contentSpecifics: { type: 'string', minLength: 1, maxLength: 6_000 },
    cameraImaging: { type: 'string', minLength: 1, maxLength: 4_000 },
    negativeTerms: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
  },
  required: ['basicSetting', 'atmosphereQualityPhotography', 'contentSpecifics', 'cameraImaging', 'negativeTerms'],
} as const;

const propDesignRevisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    baseStateDescription: { type: 'string', minLength: 1, maxLength: 4_000 },
    stateVariants: {
      type: 'array', maxItems: 30, items: {
        type: 'object', additionalProperties: false,
        properties: {
          stateKey: { type: 'string', minLength: 1, maxLength: 200 },
          stateDescription: { type: 'string', minLength: 1, maxLength: 4_000 },
        },
        required: ['stateKey', 'stateDescription'],
      },
    },
    visualDesignProposal: visualDesignSchema,
    promptSections: promptSectionsSchema,
  },
  required: ['baseStateDescription', 'stateVariants', 'visualDesignProposal', 'promptSections'],
} as const;

export async function revisePropDesign(
  provider: AgentProvider,
  input: PropDesignRevisionInput,
): Promise<PropDesignRevisionResult> {
  const proposal = validateProposal(input?.proposal);
  const currentPrompt = requiredText(input?.currentPrompt, '当前道具图片提示词', 100_000);
  const revisionRequest = requiredText(input?.revisionRequest, '道具修改要求', 4_000);
  const styleName = requiredText(input?.styleName, '当前画风', 500);
  const promptStandard = loadPromptWritingStandard();
  const result = await provider.generate<{
    baseStateDescription: string;
    stateVariants: Array<{ stateKey: string; stateDescription: string }>;
    visualDesignProposal: PropVisualProposalDraft['visualDesignProposal'];
    promptSections: PropAssetPromptSections;
  }>({
    operation: 'revise-prop-design-and-image-prompt',
    schemaName: 'prism_prop_design_revision_v1',
    maxOutputTokens: 16_000,
    instructions: [
      '你是PRISM Story Studio的道具视觉设计师。根据用户已经确认的修改要求，同步修改一个道具的文字设定与图片提示词；当前只返回文字，不调用图片模型。',
      '用户修改要求是本轮唯一修改目标。没有被点名的道具身份、剧情功能、证据、别名、状态数量、画风和资产板用途全部保留，不得改写剧情或增加不存在的功能。',
      '只修改baseStateDescription、已有stateVariants的描述、visualDesignProposal和promptSections。稳定ID、名称、别名、场次、证据和状态ID由程序保留，不得在输出中改写。',
      'stateVariants必须逐项返回现有stateKey，数量和顺序保持一致；只更新用户要求涉及的可见状态描述。',
      '用户要求加入Logo但没有给出确切图案或文字时，使用“预留清晰Logo区域”作为可编辑视觉要求，并落实位置、尺寸、颜色和材质关系；不得因此拒绝或暂停其他已明确修改。',
      'promptSections必须基于修改后的道具设定和当前提示词，只改动本轮要求涉及的内容。颜色、Logo位置、轮廓、材质、结构等要求必须写成可直接看见的结果。',
      '静态图片提示词严格使用五段式职责：基础设定；氛围、画质与摄影风格；画面内容与布局；摄影机与成像；负面词。字段正文中不要重复标题，负面词只保留5至8个当前任务最高风险问题。',
      '保持横版3:2单一道具资产板用途和现有五视图布局，不改成剧情画面、人物持物图或多镜头分镜。',
      `当前锁定画风为“${styleName}”，只能在该画风内落实道具修改。`,
      `以下是本项目当前图片与视频提示词统一规范，必须遵守：\n\n${promptStandard}`,
      '只返回严格JSON，不解释修改过程。',
    ].join('\n'),
    input: { proposal, currentPrompt, revisionRequest, styleName },
    outputSchema: propDesignRevisionSchema,
  });
  const output = result.output;
  if (!output?.visualDesignProposal || !output.promptSections) throw new Error('文字Agent没有返回完整的道具设定和图片提示词。');
  const variantDescriptions = new Map((Array.isArray(output.stateVariants) ? output.stateVariants : []).map((variant) => [requiredText(variant.stateKey, '道具状态ID', 200), requiredText(variant.stateDescription, '道具状态描述', 4_000)]));
  const expectedStateKeys = proposal.stateVariants.map((variant) => variant.stateKey);
  if (variantDescriptions.size !== expectedStateKeys.length || expectedStateKeys.some((stateKey) => !variantDescriptions.has(stateKey))) throw new Error('文字Agent返回的道具状态与现有设定不一致。');
  const visualDesignProposal = {
    objectIdentity: requiredText(output.visualDesignProposal.objectIdentity, '道具身份', 4_000),
    silhouetteAndProportions: requiredText(output.visualDesignProposal.silhouetteAndProportions, '道具轮廓与比例', 4_000),
    materialsAndSurface: requiredText(output.visualDesignProposal.materialsAndSurface, '道具材质与表面', 4_000),
    constructionAndDetails: requiredText(output.visualDesignProposal.constructionAndDetails, '道具结构与细节', 4_000),
    colorAndFinish: requiredText(output.visualDesignProposal.colorAndFinish, '道具颜色与表面处理', 4_000),
    scaleAndHandling: requiredText(output.visualDesignProposal.scaleAndHandling, '道具尺度与使用方式', 4_000),
    repeatableAnchors: textList(output.visualDesignProposal.repeatableAnchors, '道具识别锚点', 1, 20),
    designDecisions: textList(output.visualDesignProposal.designDecisions ?? [], '道具设计决策', 0, 20),
  };
  const sections: PropAssetPromptSections = {
    basicSetting: requiredText(output.promptSections.basicSetting, '基础设定', 4_000),
    atmosphereQualityPhotography: requiredText(output.promptSections.atmosphereQualityPhotography, '氛围、画质与摄影风格', 4_000),
    contentSpecifics: requiredText(output.promptSections.contentSpecifics, '画面内容与布局', 6_000),
    cameraImaging: requiredText(output.promptSections.cameraImaging, '摄影机与成像', 4_000),
    negativeTerms: textList(output.promptSections.negativeTerms, '负面词', 5, 8),
  };
  const revisedProposal: PropVisualProposalDraft = {
    ...proposal,
    baseStateDescription: requiredText(output.baseStateDescription, '道具基础状态', 4_000),
    stateVariants: proposal.stateVariants.map((variant) => ({ ...variant, stateDescription: variantDescriptions.get(variant.stateKey)! })),
    visualDesignProposal,
  };
  const prompt = [
    `道具资料：${proposal.name}（别名：${proposal.aliases.join('、')}）`,
    `画风预设：${styleName}`,
    '', '基础设定', sections.basicSetting,
    '', '氛围、画质与摄影风格', sections.atmosphereQualityPhotography,
    '', '画面内容与布局', `${PROP_MAIN_ASSET_LAYOUT}\n${sections.contentSpecifics}`,
    '', '摄影机与成像', sections.cameraImaging,
    '', '负面词', sections.negativeTerms.join('，'),
  ].join('\n');
  return { proposal: revisedProposal, prompt };
}

function validateProposal(value: PropVisualProposalDraft): PropVisualProposalDraft {
  if (!value || typeof value !== 'object') throw new Error('当前道具设定无效。');
  requiredText(value.propAssetKey, '道具ID', 200);
  requiredText(value.name, '道具名称', 500);
  if (!Array.isArray(value.aliases) || !Array.isArray(value.sourceFacts) || !Array.isArray(value.sourceSceneKeys) || !Array.isArray(value.stateVariants)) throw new Error('当前道具证据或状态无效。');
  return structuredClone(value);
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
