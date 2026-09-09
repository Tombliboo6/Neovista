import type {
  SceneAssetPromptDraft,
  Script,
  ScriptScene,
  StyleSelection
} from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { normalizeOptionalAgentStringList, partitionAgentDraftValidationIssues } from '../validation/agent-draft-validation.ts';

export const SCENE_ASSET_PROMPT_SCHEMA_NAME =
  'prism_autodrama_scene_asset_prompt_draft_v1';

export const SCENE_MAIN_ASSET_LAYOUT = [
  '生成一张横版16:9的单幅场景主资产图，以可复用的环境空间为唯一主体。',
  '采用该物理地点在所绑定最早剧本场次中的基础状态；后续爆炸、坍塌、燃烧、积雪变化或其他剧情造成的状态改变只记录为派生变体，不固化进主资产。',
  '清楚建立前景、中景和背景，保留人物表演区、主要通行路径、出入口、遮挡关系和足以稳定定位空间的关键地标。',
  '空间朝向、地形或建筑结构、材质、地面高度和固定地标必须能供后续不同镜头重复使用；可移动剧情道具不作为场景固定地标。',
  '使用纯环境空镜作为场景资产基准，画面内部不添加说明文字或布局标签。'
].join('\n');

export interface SceneAssetPromptGenerationInput {
  script: Script;
  styleSelection: StyleSelection;
  preferences?: {
    language?: string;
    requirements?: string[];
  };
}

export interface SceneAssetPromptGenerationDraft {
  prompts: SceneAssetPromptDraft[];
}

export type SceneAssetRecommendation = 'required' | 'text_only';

export type SceneVisualProposalDraft = Omit<SceneAssetPromptDraft, 'sections'> & {
  assetRecommendation: SceneAssetRecommendation;
  assetRecommendationReason: string;
};

export interface SceneVisualProposalGenerationDraft {
  proposals: SceneVisualProposalDraft[];
}

export interface ScenePromptFromProposalInput extends SceneAssetPromptGenerationInput {
  proposals: SceneVisualProposalDraft[];
}

export interface SceneEvidenceCatalogItem {
  evidenceId: string;
  sceneKey: string;
  field: string;
  text: string;
}

interface SceneAssetPromptRequestPayload extends SceneAssetPromptGenerationInput {
  evidenceCatalog: SceneEvidenceCatalogItem[];
}

interface SceneVisualProposalRequestPayload extends SceneAssetPromptGenerationInput {
  evidenceCatalog: SceneEvidenceCatalogItem[];
}

interface SceneAssetPromptModelDraft {
  promptKey: string;
  sceneAssetKey: string;
  name: string;
  sourceSceneKeys: string[];
  baseStateSceneKey: string;
  sourceFacts: Array<{ fact: string; sceneKey: string; evidenceId: string }>;
  stateVariants: Array<{
    sceneKey: string;
    stateDescription: string;
    evidenceIds: string[];
  }>;
  visualDesignProposal: SceneAssetPromptDraft['visualDesignProposal'];
  sections: SceneAssetPromptDraft['sections'];
}

interface SceneAssetPromptModelOutput {
  prompts: SceneAssetPromptModelDraft[];
}

type SceneVisualProposalModelDraft = Omit<
  SceneAssetPromptModelDraft,
  'sections' | 'promptKey' | 'sceneAssetKey'
> & {
  assetRecommendation: SceneAssetRecommendation;
  assetRecommendationReason: string;
};

export interface SceneVisualProposalModelOutput {
  proposals: SceneVisualProposalModelDraft[];
}

interface ScenePromptSectionsModelOutput {
  prompts: Array<{
    sceneAssetKey: string;
    sections: SceneAssetPromptDraft['sections'];
  }>;
}

export class SceneAssetPromptValidationError extends Error {
  readonly issues: string[];
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(issues: string[]) {
    super(`Scene asset prompts failed validation: ${issues.join(' | ')}`);
    this.name = 'SceneAssetPromptValidationError';
    this.issues = issues;
    this.diagnostics = undefined;
    Object.defineProperty(this, 'diagnostics', { enumerable: false, writable: true });
  }
}

export function buildSceneAssetPromptRequest(
  input: SceneAssetPromptGenerationInput
): AgentRequest<SceneAssetPromptRequestPayload> {
  validateInput(input);
  const evidenceCatalog = buildSceneEvidenceCatalog(input.script);
  return {
    operation: 'generate-scene-visual-proposals-and-prompts',
    schemaName: SCENE_ASSET_PROMPT_SCHEMA_NAME,
    instructions: [
      '你是影视场景概念设计师。根据已批准剧本和用户已批准画风，为本集所有物理场景生成“视觉提案 + 场景主资产生图提示词”。当前只写结构化文本，不调用图片模型。',
      '先判断各剧本场次是否属于同一物理地点；同一地点的连续状态必须合并为一个sceneAssetKey，不得因为镜头目的、人物动作或破坏前后状态而重复建立地点。sceneAssetKey和promptKey均使用L01、L02的连续格式，按首次出现顺序排列。',
      '归并依据是可复用物理空间的身份、结构、出入口和固定地标，而不是地点标题的逐字匹配。时间、天气、光线、人物动作、镜头景别、机位或临时陈设本身不足以证明出现了新物理场景；相同的宽泛地点名称也不足以证明空间必然相同。',
      'sourceSceneKeys必须将script.scenes完整、唯一、按顺序覆盖；每个地点至少绑定一个场次，baseStateSceneKey必须是该地点最早绑定的场次。',
      'sourceFacts只记录剧本明确的地点、时间、天气、空间或环境事实；每条都必须绑定sceneKey，并从input.evidenceCatalog选择属于该场的evidenceId。不要抄写或改写证据原文，程序会按evidenceId回填逐字文本。不得把视觉设计补充冒充为剧本事实。',
      'visualDesignProposal负责说明地点辨识度、空间布局、关键地标、材质、光色、天气氛围和可复用镜头覆盖；只保留对后续连续性真正有帮助的信息。设计必须服务剧情，不增加会改变剧情的新结构或功能。',
      '场景主资产使用最早绑定场次的基础环境状态。后续毁坏、坍塌、爆炸后、火灾后等状态只写入stateVariants并绑定实际sceneKey，同时从input.evidenceCatalog选择一个或多个属于该场的evidenceIds；不要抄写证据原文，不要把后续状态固化到主资产提示词。',
      '主资产是纯环境空镜，不放人物、角色剪影、怪物或人群；人皇印、武器和其他可移动剧情道具留到独立道具资产或具体镜头阶段。天气、时间与环境本身的稳定状态可以保留。',
      'sections只填写中文静态图五段式提示词的可变内容。程序负责五个标题、已批准画风和固定横版16:9场景布局；不要重写固定版式，不要在正向段落散布普通负面约束。',
      'negativeTerms保留5至8个当前场景最高风险问题，重点防止人物混入、空间结构混乱、固定地标漂移、剧情状态提前、道具混入、文字水印和透视错误。',
      '固定主资产布局由程序注入，模型不得改动：' + SCENE_MAIN_ASSET_LAYOUT,
      '遵守preferences中的语言和附加要求。输出必须严格符合JSON Schema，不要输出解释性文字。'
    ].join('\n'),
    input: { ...input, evidenceCatalog },
    outputSchema: SCENE_ASSET_PROMPT_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export function buildSceneVisualProposalRequest(
  input: SceneAssetPromptGenerationInput
): AgentRequest<SceneVisualProposalRequestPayload> {
  validateInput(input);
  const evidenceCatalog = buildSceneEvidenceCatalog(input.script);
  return {
    operation: 'generate-scene-visual-proposals',
    schemaName: 'prism_autodrama_scene_visual_proposal_draft_v1',
    instructions: [
      '你是影视场景概念设计师。当前阶段只为已批准剧本提出简短、可审核的场景视觉提案，不写生图提示词，不调用图片模型。',
      '你负责判断哪些剧本场次可以共用同一份可复用物理场景资产。不要按location标题逐字匹配，也不要机械地一场一资产；应综合地点身份、空间结构、出入口与固定地标，判断一份稳定环境设计是否能支撑这些场次。',
      '为每个物理场景给出assetRecommendation：required表示建议建立固定场景资产，text_only表示不必独立制作、随分镜按文字生成。assetRecommendationReason用一句中文说明判断依据。跨场复用、复杂空间连续性、多机位调度、关键建立镜头或环境状态变化优先required；普通、一次性且容易由文字稳定生成的地点优先text_only。出现次数只是依据之一。',
      '时间、天气、光线、人物动作、镜头景别、机位、前景产品台或虚化背景本身都不足以证明出现了新物理场景；反过来，仅仅都写“家中”也不足以证明空间必然相同。根据剧本实际空间关系决定合并或拆分。',
      '每个proposal必须返回sourceSceneKeys和baseStateSceneKey。全部script.scenes必须完整、唯一覆盖，不得遗漏或重复；每组内部按剧本顺序排列，proposal按各组第一次出现的场次排序，baseStateSceneKey必须是该组最早场次。稳定ID由程序按返回顺序注入。',
      'sourceFacts只记录剧本明确事实，每条从input.evidenceCatalog选择同场evidenceId；程序将按ID回填逐字证据。',
      'visualDesignProposal简洁说明地点辨识度、空间布局、关键地标、材质、光色、天气氛围和可复用镜头覆盖；没有明确依据或制作价值的字段可保持简洁。不得写完整生图提示词。',
      '主场景采用最早场次的基础环境状态；后续毁坏、坍塌、爆炸、燃烧等只写入stateVariants并绑定同场证据，不得提前固化。',
      '只有同一物理地点在后续绑定场次中确实发生环境状态变化时才填写stateVariants；只有一个绑定场次的分组必须返回空数组，baseStateSceneKey本身不得成为状态变化项。',
      '场景资产为纯环境空镜，不加入人物、怪物、人群或可移动剧情道具。',
      '遵守preferences中的语言和附加要求。输出严格符合JSON Schema，不要解释。'
    ].join('\n'),
    input: { ...input, evidenceCatalog },
    outputSchema: sceneVisualProposalOutputSchema(input.script.scenes.map((scene) => scene.sceneKey)),
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generateSceneVisualProposals(
  provider: AgentProvider,
  input: SceneAssetPromptGenerationInput
): Promise<AgentGenerationResult<SceneVisualProposalGenerationDraft>> {
  const result = await provider.generate<SceneVisualProposalModelOutput>(
    buildSceneVisualProposalRequest(input)
  );
  try {
    const grounded = groundSceneProposalEvidence(result.output, input);
    validateSceneVisualProposalDraft(grounded, input);
    return { ...result, output: grounded };
  } catch (error) {
    attachValidationDiagnostics(error, result);
    throw error;
  }
}

export function acceptSceneVisualProposalModelOutput(
  output: SceneVisualProposalModelOutput,
  input: SceneAssetPromptGenerationInput
): SceneVisualProposalGenerationDraft {
  const grounded = groundSceneProposalEvidence(output, input);
  validateSceneVisualProposalDraft(grounded, input);
  return grounded;
}

export function buildScenePromptsFromProposalsRequest(
  input: ScenePromptFromProposalInput
): AgentRequest<ScenePromptFromProposalInput> {
  validateSceneVisualProposalDraft({ proposals: input.proposals }, input);
  return {
    operation: 'generate-scene-prompts-from-approved-proposals',
    schemaName: 'prism_autodrama_scene_prompt_sections_v1',
    instructions: [
      '你是影视场景生图提示词设计师。用户已经确认input.proposals中的视觉提案；当前只把每个提案转换为静态场景主资产的中文五段式可变内容，不改变提案，不合并或新增场景。',
      '按proposals原顺序逐项返回，sceneAssetKey必须完全一致。',
      'sections只填写五段式的可变内容。程序负责段落标题、已批准画风和固定场景主资产布局。',
      '主资产采用baseStateSceneKey的基础环境状态；stateVariants仅供连续性参考，不得把后续剧情状态提前写入主图。',
      '画面是纯环境空镜，不放人物、角色剪影、怪物、人群或可移动剧情道具。',
      'negativeTerms保留5至8个最高风险问题，避免人物混入、空间结构混乱、固定地标漂移、剧情状态提前、道具混入、文字水印和透视错误。',
      '固定版式由程序注入，模型不得改动：' + SCENE_MAIN_ASSET_LAYOUT,
      '输出严格符合JSON Schema，不要解释。'
    ].join('\n'),
    input,
    outputSchema: SCENE_PROMPT_SECTIONS_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generateScenePromptsFromProposals(
  provider: AgentProvider,
  input: ScenePromptFromProposalInput
): Promise<AgentGenerationResult<SceneAssetPromptGenerationDraft>> {
  const result = await provider.generate<ScenePromptSectionsModelOutput>(
    buildScenePromptsFromProposalsRequest(input)
  );
  try {
    if (!Array.isArray(result.output.prompts)) {
      throw new SceneAssetPromptValidationError(['prompts must be an array']);
    }
    const prompts = input.proposals.map((proposal, index) => {
      const output = result.output.prompts[index];
      if (!output || output.sceneAssetKey !== proposal.sceneAssetKey) {
        throw new SceneAssetPromptValidationError([
          'generated prompt sections must match every approved proposal in order'
        ]);
      }
      return {
        ...structuredClone(proposal),
        sections: output.sections ? {
          ...structuredClone(output.sections),
          negativeTerms: normalizeOptionalAgentStringList(output.sections.negativeTerms),
        } : output.sections,
      };
    });
    if (result.output.prompts.length !== prompts.length) {
      throw new SceneAssetPromptValidationError([
        'generated prompt sections must match every approved proposal in order'
      ]);
    }
    validateSceneAssetPromptDraft({ prompts }, input);
    return { ...result, output: { prompts } };
  } catch (error) {
    attachValidationDiagnostics(error, result);
    throw error;
  }
}

export async function generateSceneAssetPrompts(
  provider: AgentProvider,
  input: SceneAssetPromptGenerationInput
): Promise<AgentGenerationResult<SceneAssetPromptGenerationDraft>> {
  const result = await provider.generate<SceneAssetPromptModelOutput>(
    buildSceneAssetPromptRequest(input)
  );
  try {
    const groundedOutput = groundSceneEvidence(result.output, input);
    validateSceneAssetPromptDraft(groundedOutput, input);
    return { ...result, output: groundedOutput };
  } catch (error) {
    if (error instanceof SceneAssetPromptValidationError) {
      Object.defineProperty(error, 'diagnostics', {
        enumerable: false,
        value: {
          providerId: result.providerId,
          model: result.model,
          externalTaskId: result.externalTaskId,
          completedAt: result.completedAt,
          elapsedMs: result.elapsedMs,
          usage: result.usage,
          invalidDraft: structuredClone(result.output)
        }
      });
    }
    throw error;
  }
}

export function buildSceneEvidenceCatalog(script: Script): SceneEvidenceCatalogItem[] {
  return script.scenes.flatMap((scene) => {
    const fixed = [
      ['HEADING', 'heading', scene.heading],
      ['LOCATION', 'location', scene.location],
      ['TIME', 'timeOfDay', scene.timeOfDay],
      ['PURPOSE', 'purpose', scene.purpose],
      ['ACTION', 'action', scene.action]
    ];
    const catalog = fixed.map(([suffix, field, text]) => ({
      evidenceId: `E-${scene.sceneKey}-${suffix}`,
      sceneKey: scene.sceneKey,
      field,
      text
    }));
    scene.sourceEvidence.forEach((text, index) => {
      catalog.push({
        evidenceId: `E-${scene.sceneKey}-SOURCE-${String(index + 1).padStart(2, '0')}`,
        sceneKey: scene.sceneKey,
        field: `sourceEvidence[${index}]`,
        text
      });
    });
    return catalog;
  });
}

function groundSceneEvidence(
  output: SceneAssetPromptModelOutput,
  input: SceneAssetPromptGenerationInput
): SceneAssetPromptGenerationDraft {
  if (!Array.isArray(output.prompts)) {
    throw new SceneAssetPromptValidationError(['prompts must be an array']);
  }
  const catalog = new Map(
    buildSceneEvidenceCatalog(input.script).map((item) => [item.evidenceId, item])
  );
  const issues: string[] = [];
  const prompts = output.prompts.map((prompt, promptIndex) => {
    const stateVariants = Array.isArray(prompt.stateVariants)
      ? prompt.stateVariants.filter((variant) => variant?.sceneKey !== prompt.baseStateSceneKey).map((variant) => {
          const evidenceItems = Array.isArray(variant.evidenceIds)
            ? variant.evidenceIds.map((evidenceId) => catalog.get(evidenceId))
            : [];
          if (
            evidenceItems.length === 0 ||
            evidenceItems.some((evidence) => !evidence || evidence.sceneKey !== variant.sceneKey)
          ) {
            issues.push(`prompt ${promptIndex + 1} selected invalid state-variant evidence IDs`);
          }
          return {
            sceneKey: variant.sceneKey,
            stateDescription: variant.stateDescription,
            sourceEvidence: evidenceItems.flatMap((evidence) => evidence ? [evidence.text] : [])
          };
        })
      : [];
    return {
      ...structuredClone(prompt),
      visualDesignProposal: prompt.visualDesignProposal ? {
        ...structuredClone(prompt.visualDesignProposal),
        fixedLandmarks: normalizeOptionalAgentStringList(prompt.visualDesignProposal.fixedLandmarks),
        designDecisions: normalizeOptionalAgentStringList(prompt.visualDesignProposal.designDecisions),
      } : prompt.visualDesignProposal,
      sections: prompt.sections ? {
        ...structuredClone(prompt.sections),
        negativeTerms: normalizeOptionalAgentStringList(prompt.sections.negativeTerms),
      } : prompt.sections,
      sourceFacts: Array.isArray(prompt.sourceFacts)
        ? prompt.sourceFacts.map((fact) => {
            const evidence = catalog.get(fact.evidenceId);
            if (!evidence || evidence.sceneKey !== fact.sceneKey) {
              issues.push(`prompt ${promptIndex + 1} selected an invalid source evidence ID`);
            }
            return {
              fact: fact.fact,
              sceneKey: fact.sceneKey,
              evidence: evidence?.text ?? ''
            };
          })
        : [],
      stateVariants
    };
  });
  return { prompts };
}

function groundSceneProposalEvidence(
  output: SceneVisualProposalModelOutput,
  input: SceneAssetPromptGenerationInput
): SceneVisualProposalGenerationDraft {
  if (!Array.isArray(output.proposals)) {
    throw new SceneAssetPromptValidationError(['proposals must be an array']);
  }
  const sceneOrder = new Map(input.script.scenes.map((scene, index) => [scene.sceneKey, index]));
  const orderedProposals = output.proposals
    .map((proposal) => {
      const sourceSceneKeys = Array.isArray(proposal.sourceSceneKeys)
        ? [...new Set(proposal.sourceSceneKeys.filter((sceneKey) => sceneOrder.has(sceneKey)))].sort(
            (left, right) => (sceneOrder.get(left) ?? Number.POSITIVE_INFINITY) -
              (sceneOrder.get(right) ?? Number.POSITIVE_INFINITY)
          )
        : proposal.sourceSceneKeys;
      const recommended = proposal.assetRecommendation === 'required' || proposal.assetRecommendation === 'text_only'
        ? proposal.assetRecommendation
        : (Array.isArray(sourceSceneKeys) && sourceSceneKeys.length > 1) || (Array.isArray(proposal.stateVariants) && proposal.stateVariants.length > 0)
          ? 'required'
          : 'text_only';
      return {
        ...structuredClone(proposal),
        assetRecommendation: recommended,
        assetRecommendationReason: nonEmpty(proposal.assetRecommendationReason)
          ? proposal.assetRecommendationReason
          : recommended === 'required'
            ? '需要保持跨场次空间连续性或剧情状态一致。'
            : '单次普通地点可在对应分镜中直接完成。',
        visualDesignProposal: proposal.visualDesignProposal ? {
          ...structuredClone(proposal.visualDesignProposal),
          fixedLandmarks: normalizeOptionalAgentStringList(proposal.visualDesignProposal.fixedLandmarks),
          designDecisions: normalizeOptionalAgentStringList(proposal.visualDesignProposal.designDecisions),
        } : proposal.visualDesignProposal,
        sourceSceneKeys,
      };
    })
    .sort((left, right) => {
      const leftOrder = Array.isArray(left.sourceSceneKeys)
        ? Math.min(...left.sourceSceneKeys.map((sceneKey) => sceneOrder.get(sceneKey) ?? Number.POSITIVE_INFINITY))
        : Number.POSITIVE_INFINITY;
      const rightOrder = Array.isArray(right.sourceSceneKeys)
        ? Math.min(...right.sourceSceneKeys.map((sceneKey) => sceneOrder.get(sceneKey) ?? Number.POSITIVE_INFINITY))
        : Number.POSITIVE_INFINITY;
      return leftOrder - rightOrder;
    });
  const grounded = groundSceneEvidence(
    {
      prompts: orderedProposals.map((proposal, index) => ({
        ...proposal,
        baseStateSceneKey: Array.isArray(proposal.sourceSceneKeys) && proposal.sourceSceneKeys.length > 0
          ? proposal.sourceSceneKeys[0]
          : proposal.baseStateSceneKey,
        promptKey: `L${String(index + 1).padStart(2, '0')}`,
        sceneAssetKey: `L${String(index + 1).padStart(2, '0')}`,
        sections: {
          basicSetting: '',
          atmosphereQualityPhotography: '',
          contentSpecifics: '',
          cameraImaging: '',
          negativeTerms: []
        }
      }))
    },
    input
  );
  return {
    proposals: grounded.prompts.map(({ sections: _sections, ...proposal }) => proposal)
  };
}

function attachValidationDiagnostics(
  error: unknown,
  result: AgentGenerationResult<unknown>
): void {
  if (!(error instanceof SceneAssetPromptValidationError)) return;
  Object.defineProperty(error, 'diagnostics', {
    enumerable: false,
    value: {
      providerId: result.providerId,
      model: result.model,
      externalTaskId: result.externalTaskId,
      completedAt: result.completedAt,
      elapsedMs: result.elapsedMs,
      usage: result.usage,
      invalidDraft: structuredClone(result.output)
    }
  });
}

export function validateSceneVisualProposalDraft(
  draft: SceneVisualProposalGenerationDraft,
  input: SceneAssetPromptGenerationInput
): string[] {
  validateInput(input);
  if (!Array.isArray(draft.proposals)) {
    throw new SceneAssetPromptValidationError(['proposals must be an array']);
  }
  if (draft.proposals.length === 0) {
    throw new SceneAssetPromptValidationError(['at least one scene proposal is required']);
  }
  const issues: string[] = [];
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  const assignedKeys: string[] = [];
  const sceneOrder = new Map(input.script.scenes.map((scene, index) => [scene.sceneKey, index]));
  let priorGroupFirstOrder = -1;
  draft.proposals.forEach((proposal, index) => {
    const expectedKey = `L${String(index + 1).padStart(2, '0')}`;
    if (proposal.promptKey !== expectedKey || proposal.sceneAssetKey !== expectedKey) {
      issues.push(`proposal ${index + 1} must use promptKey and sceneAssetKey ${expectedKey}`);
    }
    if (!nonEmpty(proposal.name) || !Array.isArray(proposal.sourceSceneKeys) || proposal.sourceSceneKeys.length === 0) {
      issues.push(`proposal ${index + 1} must name a scene and bind source scenes`);
      return;
    }
    if (!['required', 'text_only'].includes(proposal.assetRecommendation) || !nonEmpty(proposal.assetRecommendationReason)) {
      issues.push(`proposal ${index + 1} requires an asset recommendation and reason`);
    }
    if (proposal.baseStateSceneKey !== proposal.sourceSceneKeys[0]) {
      issues.push(`proposal ${index + 1} baseStateSceneKey must be its earliest source scene`);
    }
    const sourceOrders = proposal.sourceSceneKeys.map((sceneKey) => sceneOrder.get(sceneKey) ?? Number.POSITIVE_INFINITY);
    if (sourceOrders.some((order, keyIndex) => keyIndex > 0 && order <= sourceOrders[keyIndex - 1]!)) {
      issues.push(`proposal ${index + 1} sourceSceneKeys must follow script order`);
    }
    if (sourceOrders[0]! <= priorGroupFirstOrder) {
      issues.push('scene proposals must be ordered by their earliest source scene');
    }
    priorGroupFirstOrder = sourceOrders[0]!;
    for (const sceneKey of proposal.sourceSceneKeys) {
      if (!sceneByKey.has(sceneKey)) issues.push(`proposal ${index + 1} references unknown scene ${sceneKey}`);
      assignedKeys.push(sceneKey);
    }
    validateSourceFacts(proposal as SceneAssetPromptDraft, sceneByKey, index, issues);
    validateVariants(proposal as SceneAssetPromptDraft, sceneByKey, index, issues);
    if (!completeVisualDesign(proposal.visualDesignProposal)) {
      issues.push(`proposal ${index + 1} has an incomplete visual design proposal`);
    }
  });
  const expectedKeys = input.script.scenes.map((scene) => scene.sceneKey);
  if (assignedKeys.length !== expectedKeys.length || new Set(assignedKeys).size !== assignedKeys.length || expectedKeys.some((sceneKey) => !assignedKeys.includes(sceneKey))) {
    issues.push('scene proposals must cover every script scene exactly once and in order');
  }
  const report = partitionAgentDraftValidationIssues('scene-proposal', issues);
  if (report.blockingIssues.length > 0) throw new SceneAssetPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function validateSceneAssetPromptDraft(
  draft: SceneAssetPromptGenerationDraft,
  input: SceneAssetPromptGenerationInput
): string[] {
  validateInput(input);
  if (!Array.isArray(draft.prompts)) {
    throw new SceneAssetPromptValidationError(['prompts must be an array']);
  }
  if (draft.prompts.length === 0) {
    throw new SceneAssetPromptValidationError(['at least one scene prompt is required']);
  }
  const issues: string[] = [];
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  const assignedKeys: string[] = [];
  const sceneOrder = new Map(input.script.scenes.map((scene, index) => [scene.sceneKey, index]));
  let priorGroupFirstOrder = -1;

  draft.prompts.forEach((prompt, index) => {
    const expectedKey = `L${String(index + 1).padStart(2, '0')}`;
    if (prompt.promptKey !== expectedKey || prompt.sceneAssetKey !== expectedKey) {
      issues.push(`prompt ${index + 1} must use promptKey and sceneAssetKey ${expectedKey}`);
    }
    if (!nonEmpty(prompt.name) || !Array.isArray(prompt.sourceSceneKeys) || prompt.sourceSceneKeys.length === 0) {
      issues.push(`prompt ${index + 1} must name a scene and bind source scenes`);
      return;
    }
    if (prompt.baseStateSceneKey !== prompt.sourceSceneKeys[0]) {
      issues.push(`prompt ${index + 1} baseStateSceneKey must be its earliest source scene`);
    }
    const sourceOrders = prompt.sourceSceneKeys.map((sceneKey) => sceneOrder.get(sceneKey) ?? Number.POSITIVE_INFINITY);
    if (sourceOrders.some((order, keyIndex) => keyIndex > 0 && order <= sourceOrders[keyIndex - 1]!)) {
      issues.push(`prompt ${index + 1} sourceSceneKeys must follow script order`);
    }
    if (sourceOrders[0]! <= priorGroupFirstOrder) {
      issues.push('scene prompts must be ordered by their earliest source scene');
    }
    priorGroupFirstOrder = sourceOrders[0]!;
    for (const sceneKey of prompt.sourceSceneKeys) {
      if (!sceneByKey.has(sceneKey)) issues.push(`prompt ${index + 1} references unknown scene ${sceneKey}`);
      assignedKeys.push(sceneKey);
    }
    validateSourceFacts(prompt, sceneByKey, index, issues);
    validateVariants(prompt, sceneByKey, index, issues);
    if (!completeVisualDesign(prompt.visualDesignProposal)) {
      issues.push(`prompt ${index + 1} has an incomplete visual design proposal`);
    }
    if (!completeSections(prompt.sections)) {
      issues.push(`prompt ${index + 1} has incomplete prompt sections`);
    }
    const negativeCount = prompt.sections?.negativeTerms?.length ?? 0;
    if (negativeCount < 5 || negativeCount > 8) {
      issues.push(`prompt ${index + 1} negativeTerms must contain 5 to 8 items`);
    }
  });

  const expectedKeys = input.script.scenes.map((scene) => scene.sceneKey);
  if (assignedKeys.length !== expectedKeys.length || new Set(assignedKeys).size !== assignedKeys.length || expectedKeys.some((sceneKey) => !assignedKeys.includes(sceneKey))) {
    issues.push('scene prompts must cover every script scene exactly once and in order');
  }
  const report = partitionAgentDraftValidationIssues('scene-asset-prompt', issues);
  if (report.blockingIssues.length > 0) throw new SceneAssetPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function compileSceneAssetPrompt(
  draft: SceneAssetPromptDraft,
  input: SceneAssetPromptGenerationInput
): string {
  validateSceneAssetPromptDraft({ prompts: [asFirstPrompt(draft)] }, {
    ...input,
    script: {
      ...input.script,
      scenes: input.script.scenes.filter((scene) => draft.sourceSceneKeys.includes(scene.sceneKey))
    }
  });
  return [
    `场景资料：${draft.name}（${draft.sourceSceneKeys.join('、')}）`,
    `画风预设：${input.styleSelection.name}`,
    '',
    '基础设定',
    draft.sections.basicSetting.trim(),
    '',
    '氛围、画质与摄影风格',
    `${input.styleSelection.stylePrompt.trim()}\n${draft.sections.atmosphereQualityPhotography.trim()}`,
    '',
    '画面内容与布局',
    `${SCENE_MAIN_ASSET_LAYOUT}\n${draft.sections.contentSpecifics.trim()}`,
    '',
    '摄影机与成像',
    draft.sections.cameraImaging.trim(),
    '',
    '负面词',
    draft.sections.negativeTerms.map((term) => term.trim()).join('，')
  ].join('\n');
}

function asFirstPrompt(prompt: SceneAssetPromptDraft): SceneAssetPromptDraft {
  return { ...prompt, promptKey: 'L01', sceneAssetKey: 'L01' };
}

function validateSourceFacts(
  prompt: SceneAssetPromptDraft,
  sceneByKey: Map<string, ScriptScene>,
  index: number,
  issues: string[]
): void {
  if (!Array.isArray(prompt.sourceFacts) || prompt.sourceFacts.length === 0) {
    issues.push(`prompt ${index + 1} requires sourceFacts`);
    return;
  }
  for (const fact of prompt.sourceFacts) {
    const scene = sceneByKey.get(fact.sceneKey);
    if (!scene || !prompt.sourceSceneKeys.includes(fact.sceneKey)) {
      issues.push(`prompt ${index + 1} has a source fact for an unbound scene`);
      continue;
    }
    if (!nonEmpty(fact.fact) || !nonEmpty(fact.evidence) || !sceneText(scene).includes(fact.evidence)) {
      issues.push(`prompt ${index + 1} source evidence is not verbatim in ${fact.sceneKey}`);
    }
  }
}

function validateVariants(
  prompt: SceneAssetPromptDraft,
  sceneByKey: Map<string, ScriptScene>,
  index: number,
  issues: string[]
): void {
  if (!Array.isArray(prompt.stateVariants)) {
    issues.push(`prompt ${index + 1} stateVariants must be an array`);
    return;
  }
  const seen = new Set<string>();
  for (const variant of prompt.stateVariants) {
    if (
      !sceneByKey.has(variant.sceneKey) ||
      !prompt.sourceSceneKeys.includes(variant.sceneKey) ||
      variant.sceneKey === prompt.baseStateSceneKey ||
      seen.has(variant.sceneKey) ||
      !nonEmpty(variant.stateDescription) ||
      !Array.isArray(variant.sourceEvidence) ||
      variant.sourceEvidence.length === 0 ||
      variant.sourceEvidence.some(
        (evidence) => !nonEmpty(evidence) || !sceneText(sceneByKey.get(variant.sceneKey)!).includes(evidence)
      )
    ) {
      issues.push(`prompt ${index + 1} has an invalid state variant`);
    }
    seen.add(variant.sceneKey);
  }
}

function validateInput(input: SceneAssetPromptGenerationInput): void {
  if (input.script.approval !== 'approved') {
    throw new Error('Script must be approved before scene prompt generation.');
  }
  if (input.styleSelection.approval !== 'approved') {
    throw new Error('Visual style must be approved before scene prompt generation.');
  }
  if (input.script.scenes.length === 0) throw new Error('Approved script requires scenes.');
}

function completeVisualDesign(value: SceneAssetPromptDraft['visualDesignProposal'] | undefined): boolean {
  if (!value) return false;
  if (
    ![
      value.locationIdentity,
      value.spatialLayout,
      value.terrainAndArchitecture,
      value.materialsAndSurfaces,
      value.lightingAndColor,
      value.weatherAndAtmosphere,
      value.reusableCameraCoverage
    ].every(nonEmpty)
  ) return false;
  return (
    Array.isArray(value.fixedLandmarks) &&
    value.fixedLandmarks.every(nonEmpty) &&
    Array.isArray(value.designDecisions) &&
    value.designDecisions.every(nonEmpty)
  );
}

function completeSections(value: SceneAssetPromptDraft['sections'] | undefined): boolean {
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

function sceneText(scene: ScriptScene): string {
  return [
    scene.heading,
    scene.location,
    scene.timeOfDay,
    scene.purpose,
    scene.action,
    ...scene.sourceEvidence
  ].join('\n');
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const SCENE_ASSET_PROMPT_OUTPUT_SCHEMA: Record<string, unknown> = {
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
          promptKey: { type: 'string', pattern: '^L[0-9]{2,}$' },
          sceneAssetKey: { type: 'string', pattern: '^L[0-9]{2,}$' },
          name: { type: 'string' },
          sourceSceneKeys: { type: 'array', minItems: 1, items: { type: 'string' } },
          baseStateSceneKey: { type: 'string' },
          sourceFacts: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', additionalProperties: false,
              properties: { fact: { type: 'string' }, sceneKey: { type: 'string' }, evidenceId: { type: 'string' } },
              required: ['fact', 'sceneKey', 'evidenceId']
            }
          },
          stateVariants: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                sceneKey: { type: 'string' },
                stateDescription: { type: 'string' },
                evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } }
              },
              required: ['sceneKey', 'stateDescription', 'evidenceIds']
            }
          },
          visualDesignProposal: {
            type: 'object', additionalProperties: false,
            properties: {
              locationIdentity: { type: 'string' }, spatialLayout: { type: 'string' },
              terrainAndArchitecture: { type: 'string' }, materialsAndSurfaces: { type: 'string' },
              fixedLandmarks: { type: 'array', items: { type: 'string' } },
              lightingAndColor: { type: 'string' }, weatherAndAtmosphere: { type: 'string' },
              reusableCameraCoverage: { type: 'string' },
              designDecisions: { type: 'array', items: { type: 'string' } }
            },
            required: ['locationIdentity', 'spatialLayout', 'terrainAndArchitecture', 'materialsAndSurfaces', 'fixedLandmarks', 'lightingAndColor', 'weatherAndAtmosphere', 'reusableCameraCoverage', 'designDecisions']
          },
          sections: {
            type: 'object', additionalProperties: false,
            properties: {
              basicSetting: { type: 'string' }, atmosphereQualityPhotography: { type: 'string' },
              contentSpecifics: { type: 'string' }, cameraImaging: { type: 'string' },
              negativeTerms: { type: 'array', items: { type: 'string' } }
            },
            required: ['basicSetting', 'atmosphereQualityPhotography', 'contentSpecifics', 'cameraImaging', 'negativeTerms']
          }
        },
        required: ['promptKey', 'sceneAssetKey', 'name', 'sourceSceneKeys', 'baseStateSceneKey', 'sourceFacts', 'stateVariants', 'visualDesignProposal', 'sections']
      }
    }
  },
  required: ['prompts']
};

const SCENE_VISUAL_PROPOSAL_ITEM_PROPERTIES = {
  name: { type: 'string' },
  assetRecommendation: { type: 'string', enum: ['required', 'text_only'] },
  assetRecommendationReason: { type: 'string' },
  sourceSceneKeys: { type: 'array', minItems: 1, items: { type: 'string' } },
  baseStateSceneKey: { type: 'string' },
  sourceFacts: {
    type: 'array', minItems: 1,
    items: {
      type: 'object', additionalProperties: false,
      properties: { fact: { type: 'string' }, sceneKey: { type: 'string' }, evidenceId: { type: 'string' } },
      required: ['fact', 'sceneKey', 'evidenceId']
    }
  },
  stateVariants: {
    type: 'array',
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        sceneKey: { type: 'string' }, stateDescription: { type: 'string' },
        evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } }
      },
      required: ['sceneKey', 'stateDescription', 'evidenceIds']
    }
  },
  visualDesignProposal: {
    type: 'object', additionalProperties: false,
    properties: {
      locationIdentity: { type: 'string' }, spatialLayout: { type: 'string' },
      terrainAndArchitecture: { type: 'string' }, materialsAndSurfaces: { type: 'string' },
      fixedLandmarks: { type: 'array', items: { type: 'string' } },
      lightingAndColor: { type: 'string' }, weatherAndAtmosphere: { type: 'string' },
      reusableCameraCoverage: { type: 'string' },
      designDecisions: { type: 'array', items: { type: 'string' } }
    },
    required: ['locationIdentity', 'spatialLayout', 'terrainAndArchitecture', 'materialsAndSurfaces', 'fixedLandmarks', 'lightingAndColor', 'weatherAndAtmosphere', 'reusableCameraCoverage', 'designDecisions']
  }
};

function sceneVisualProposalOutputSchema(sceneKeys: string[]): Record<string, unknown> {
  const properties = structuredClone(SCENE_VISUAL_PROPOSAL_ITEM_PROPERTIES) as Record<string, any>;
  properties.sourceSceneKeys.items = { type: 'string', enum: sceneKeys };
  properties.baseStateSceneKey = { type: 'string', enum: sceneKeys };
  return {
    type: 'object', additionalProperties: false,
    properties: {
      proposals: {
        type: 'array', minItems: 1, maxItems: sceneKeys.length,
        items: {
          type: 'object', additionalProperties: false,
          properties,
          required: ['name', 'assetRecommendation', 'assetRecommendationReason', 'sourceSceneKeys', 'baseStateSceneKey', 'sourceFacts', 'stateVariants', 'visualDesignProposal']
        }
      }
    },
    required: ['proposals']
  };
}

const SCENE_PROMPT_SECTIONS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  properties: {
    prompts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          sceneAssetKey: { type: 'string', pattern: '^L[0-9]{2,}$' },
          sections: {
            type: 'object', additionalProperties: false,
            properties: {
              basicSetting: { type: 'string' }, atmosphereQualityPhotography: { type: 'string' },
              contentSpecifics: { type: 'string' }, cameraImaging: { type: 'string' },
              negativeTerms: { type: 'array', items: { type: 'string' } }
            },
            required: ['basicSetting', 'atmosphereQualityPhotography', 'contentSpecifics', 'cameraImaging', 'negativeTerms']
          }
        },
        required: ['sceneAssetKey', 'sections']
      }
    }
  },
  required: ['prompts']
};
