import type {
  PropAssetPromptDraft,
  PropStateVariant,
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

export const PROP_ASSET_PROMPT_SCHEMA_NAME = 'prism_autodrama_prop_asset_prompt_draft_v1';

export const PROP_MAIN_ASSET_LAYOUT = [
  '生成一张横版3:2的单幅道具资产板，画面只展示同一个道具，不出现人物或手。',
  '左侧约55%为大型三分之四主视图；右侧约45%为2×2四个结构视图，依次表现正面、侧面、顶面和底部。',
  '五个视图必须是完全相同的同一件道具，尺寸比例、轮廓、材质、缺口、纹理和结构锚点一致。',
  '采用未激活、未受损、干燥洁净的基础状态；发光、雷击、碎裂、爆炸或剧情污损只作为状态变体记录，不进入主资产。',
  '使用纯净中性摄影棚背景和极窄分隔线，不渲染文字标签、尺寸标注、手、支架或比例尺。'
].join('\n');

export interface RequiredPropSpec {
  propAssetKey?: string;
  canonicalName: string;
  aliases: string[];
  requiredStateKeys?: string[];
}

export interface PropAssetPromptGenerationInput {
  script: Script;
  styleSelection: StyleSelection;
  requiredProps: RequiredPropSpec[];
  preferences?: { language?: string; requirements?: string[] };
}

export interface PropEvidenceCatalogItem {
  evidenceId: string;
  sceneKey: string;
  field: string;
  text: string;
}

export interface PropAssetPromptGenerationDraft {
  prompts: PropAssetPromptDraft[];
}

export type PropAssetRecommendation = 'required' | 'optional' | 'text_only';
export type PropVisualProposalDraft = Omit<PropAssetPromptDraft, 'sections'> & {
  assetRecommendation: PropAssetRecommendation;
  assetRecommendationReason: string;
  sourceMappingStatus?: 'resolved' | 'needs_review';
  sourceMappingNote?: string;
};
export interface PropVisualProposalGenerationDraft { proposals: PropVisualProposalDraft[] }
export interface PropVisualProposalGenerationInput {
  script: Script;
  styleSelection: StyleSelection;
  preferences?: { language?: string; requirements?: string[] };
}
export interface PropPromptFromProposalInput extends PropVisualProposalGenerationInput {
  proposals: PropVisualProposalDraft[];
}

interface PropAssetPromptRequestPayload extends PropAssetPromptGenerationInput {
  evidenceCatalog: PropEvidenceCatalogItem[];
}

interface PropAssetPromptModelDraft
  extends Omit<PropAssetPromptDraft, 'sourceFacts' | 'stateVariants'> {
  sourceFacts: Array<{ fact: string; sceneKey: string; evidenceId: string }>;
  stateVariants: Array<{
    stateKey: string;
    sceneKey: string;
    stateDescription: string;
    evidenceIds: string[];
  }>;
}

interface PropAssetPromptModelOutput { prompts: PropAssetPromptModelDraft[] }
interface PropVisualProposalModelDraft extends Omit<PropAssetPromptModelDraft, 'promptKey' | 'propAssetKey' | 'sourceSceneKeys' | 'baseStateSceneKey' | 'sourceFacts' | 'stateVariants' | 'sections'> {
  sourceFacts: Array<{ fact: string; evidenceId: string }>;
  stateVariants: Array<{ stateKey: string; stateDescription: string; evidenceIds: string[] }>;
}
interface PropVisualProposalModelOutput { proposals: PropVisualProposalModelDraft[] }
interface PropPromptSectionsModelOutput { prompts: Array<{ sections: PropAssetPromptDraft['sections'] }> }

export class PropAssetPromptValidationError extends Error {
  readonly issues: string[];
  readonly diagnostics: Record<string, unknown> | undefined;

  constructor(issues: string[]) {
    super(`Prop asset prompts failed validation: ${issues.join(' | ')}`);
    this.name = 'PropAssetPromptValidationError';
    this.issues = issues;
    this.diagnostics = undefined;
    Object.defineProperty(this, 'diagnostics', { enumerable: false, writable: true });
  }
}

export function buildPropEvidenceCatalog(script: Script): PropEvidenceCatalogItem[] {
  return script.scenes.flatMap((scene) => {
    const catalog: PropEvidenceCatalogItem[] = [
      ['HEADING', 'heading', scene.heading],
      ['LOCATION', 'location', scene.location],
      ['TIME', 'timeOfDay', scene.timeOfDay],
      ['PURPOSE', 'purpose', scene.purpose],
      ['ACTION', 'action', scene.action]
    ].map(([suffix, field, text]) => ({
      evidenceId: `E-${scene.sceneKey}-${suffix}`,
      sceneKey: scene.sceneKey,
      field,
      text
    }));
    scene.sourceEvidence.forEach((text, index) => catalog.push({
      evidenceId: `E-${scene.sceneKey}-SOURCE-${String(index + 1).padStart(2, '0')}`,
      sceneKey: scene.sceneKey,
      field: `sourceEvidence[${index}]`,
      text
    }));
    scene.dialogue.forEach((line, index) => catalog.push({
      evidenceId: `E-${scene.sceneKey}-DIALOGUE-${String(index + 1).padStart(2, '0')}`,
      sceneKey: scene.sceneKey,
      field: `dialogue[${index}].text`,
      text: line.text
    }));
    return catalog;
  });
}

export function buildPropAssetPromptRequest(
  input: PropAssetPromptGenerationInput
): AgentRequest<PropAssetPromptRequestPayload> {
  validateInput(input);
  return {
    operation: 'generate-prop-visual-proposals-and-prompts',
    schemaName: PROP_ASSET_PROMPT_SCHEMA_NAME,
    instructions: [
      '你是影视道具概念设计师。根据已批准剧本和用户已批准画风，为requiredProps中的每件剧情道具生成“视觉提案 + 道具主资产生图提示词”。当前只生成结构化文字，不调用图片模型。',
      '同一物品的不同称呼必须合并为一个propAssetKey。严格按照requiredProps顺序输出，promptKey和propAssetKey依次使用R01、R02；name使用canonicalName，aliases完整保留且不得增加剧本外别名。',
      'sourceFacts只记录剧本明确的物体身份、尺寸、材质、状态、能力表现或持有关系；每条绑定sceneKey，并只选择input.evidenceCatalog中属于该场的evidenceId。不要抄写原文，程序会回填逐字证据。',
      'baseStateDescription必须是可复用的未激活、未受损基础状态。requiredStateKeys中的激活、碎裂等变化必须逐项写入stateVariants，stateKey完全匹配，绑定实际sceneKey与一个或多个evidenceIds；不得把状态变体固化进主资产。',
      'visualDesignProposal补全对后续一致性真正有用的轮廓比例、材质表面、结构细节、色彩、尺度与身份锚点；所有补充都是待用户审批的设计决定。',
      'sections只填写中文静态图五段式的可变内容。程序负责五个标题、已批准画风和固定道具资产板布局。主资产不出现人物、手、场景、发光、雷击、碎裂、爆炸或文字标签。',
      'negativeTerms保留5至8个最高风险问题。固定布局由程序注入，模型不得改动：' + PROP_MAIN_ASSET_LAYOUT,
      '遵守preferences。输出严格符合JSON Schema，不输出解释性文字。'
    ].join('\n'),
    input: { ...input, evidenceCatalog: buildPropEvidenceCatalog(input.script) },
    outputSchema: PROP_ASSET_PROMPT_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft
  };
}

export function buildPropVisualProposalRequest(input: PropVisualProposalGenerationInput): AgentRequest<PropVisualProposalGenerationInput & { evidenceCatalog: PropEvidenceCatalogItem[] }> {
  validateStagedInput(input);
  const evidenceCatalog = buildPropEvidenceCatalog(input.script);
  return {
    operation: 'generate-prop-visual-proposals',
    schemaName: 'prism_autodrama_prop_visual_proposal_draft_v1',
    instructions: [
      '你是影视道具概念设计师。当前阶段从已批准剧本中识别影响制作的剧情道具，先判断独立资产的制作价值，再提出简短视觉方案；不写生图提示词，不调用图片模型。',
      '为每件道具给出assetRecommendation：required表示必须建立独立图片资产，optional表示只有特写、产品收束或用户强调时才值得生图，text_only表示保留完整文字设定并随分镜生成。assetRecommendationReason用一句中文说明判断依据。',
      '判断必须综合：是否具有普通文字难以锁定的独特设计、是否跨镜头反复出现且身份连续性重要、是否是品牌或剧情核心物件、是否存在必须看出是同一物件的多状态变化、是否承担容易穿帮的特写。出现次数只是参考，不得机械决定。',
      '普通食材、常见容器、临时陈设和容易由模型按文字稳定生成的物品，默认text_only；只有在产品特写、品牌识别或严格连续性确有需要时才提升为optional或required。可以把相关普通食材留给同一镜头构图，不要为了名词覆盖率逐个建立资产板。',
      'required必须少而必要；optional交给用户按镜头需要选择；text_only不会进入默认批量生图。场景固定地标、服装和角色身体特征不作为独立道具。',
      '同一物品的不同称呼合并为一个道具，并按首次出现顺序输出；name是剧本中最稳定的称呼，aliases只收录剧本已有称呼。程序负责R01、R02连续ID，不要输出编号字段。',
      'sourceFacts只填写fact与evidenceId，stateVariants只填写stateKey、stateDescription与evidenceIds；程序根据证据目录确定场次归属、顺序与基础场次并回填逐字证据，不要重复输出sceneKey、sourceSceneKeys或baseStateSceneKey。baseStateDescription采用未激活、未受损、干燥洁净的可复用基础状态；激活、破损、沾染等剧情变化只进入stateVariants。',
      'visualDesignProposal简洁说明物品身份，以及对后续一致性真正有用的轮廓、材质、结构、颜色、尺度和身份锚点；没有制作价值的字段可保持简洁。不得加入会改变剧情的新能力、机关、文字或势力符号。',
      '如果剧本确实没有需要独立生产的关键道具，返回空proposals数组，不得为凑数发明道具。',
      '输出严格符合JSON Schema，不要解释。'
    ].join('\n'),
    input: { ...input, evidenceCatalog },
    outputSchema: propVisualProposalOutputSchema(evidenceCatalog.map((item) => item.evidenceId)),
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generatePropVisualProposals(provider: AgentProvider, input: PropVisualProposalGenerationInput): Promise<AgentGenerationResult<PropVisualProposalGenerationDraft>> {
  const result = await provider.generate<PropVisualProposalModelOutput>(buildPropVisualProposalRequest(input));
  try {
    const output = acceptPropVisualProposalModelOutput(result.output, input);
    return { ...result, output };
  } catch (error) {
    attachDiagnostics(error, result);
    throw error;
  }
}

export function acceptPropVisualProposalModelOutput(
  output: PropVisualProposalModelOutput,
  input: PropVisualProposalGenerationInput,
): PropVisualProposalGenerationDraft {
  const grounded = groundPropVisualProposalEvidence(output, input);
  validatePropVisualProposalDraft(grounded, input);
  return grounded;
}

/**
 * The recovery editor may receive either the provider's raw evidence-ID shape
 * or the already-grounded draft preserved after director review. Grounded
 * drafts must be validated in place; running them through evidence grounding a
 * second time would discard their scene bindings because they no longer carry
 * evidenceId/evidenceIds.
 */
export function acceptReturnedPropVisualProposalDraft(
  output: unknown,
  input: PropVisualProposalGenerationInput,
): PropVisualProposalGenerationDraft {
  if (!isGroundedPropVisualProposalDraft(output)) {
    return acceptPropVisualProposalModelOutput(output as PropVisualProposalModelOutput, input);
  }
  const normalized = normalizeGroundedPropVisualProposalDraft(output, input);
  validatePropVisualProposalDraft(normalized, input);
  return normalized;
}

function isGroundedPropVisualProposalDraft(output: unknown): output is PropVisualProposalGenerationDraft {
  if (!output || typeof output !== 'object' || !Array.isArray((output as PropVisualProposalGenerationDraft).proposals)) return false;
  const proposals = (output as PropVisualProposalGenerationDraft).proposals;
  return proposals.length > 0 && proposals.every((proposal) => {
    if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.sourceSceneKeys) || typeof proposal.baseStateSceneKey !== 'string') return false;
    const sourceFacts = Array.isArray(proposal.sourceFacts) ? proposal.sourceFacts : [];
    const stateVariants = Array.isArray(proposal.stateVariants) ? proposal.stateVariants : [];
    const carriesRawEvidenceIds = sourceFacts.some((fact) => Object.prototype.hasOwnProperty.call(fact, 'evidenceId'))
      || stateVariants.some((variant) => Object.prototype.hasOwnProperty.call(variant, 'evidenceIds'));
    return !carriesRawEvidenceIds
      && sourceFacts.every((fact) => Object.prototype.hasOwnProperty.call(fact, 'evidence'))
      && stateVariants.every((variant) => Object.prototype.hasOwnProperty.call(variant, 'sourceEvidence'));
  });
}

function normalizeGroundedPropVisualProposalDraft(output: PropVisualProposalGenerationDraft, input: PropVisualProposalGenerationInput): PropVisualProposalGenerationDraft {
  const sceneOrder = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene.order]));
  const knownSceneKeys = new Set(sceneOrder.keys());
  return {
    proposals: output.proposals.map((proposal) => {
      const sourceFacts = Array.isArray(proposal.sourceFacts) ? structuredClone(proposal.sourceFacts) : [];
      const stateVariants = Array.isArray(proposal.stateVariants) ? proposal.stateVariants.map((variant) => {
        const sourceSceneKeys = normalizeOptionalAgentStringList(variant.sourceSceneKeys)
          .filter((sceneKey) => knownSceneKeys.has(sceneKey))
          .sort((left, right) => (sceneOrder.get(left) ?? 0) - (sceneOrder.get(right) ?? 0));
        if (sourceSceneKeys.length === 0 && knownSceneKeys.has(variant.sceneKey)) sourceSceneKeys.push(variant.sceneKey);
        return {
        ...structuredClone(variant),
        sceneKey: sourceSceneKeys[0] ?? '',
        sourceSceneKeys,
        sourceEvidence: normalizeOptionalAgentStringList(variant.sourceEvidence),
        };
      }) : [];
      const originalSceneKeys = normalizeOptionalAgentStringList(proposal.sourceSceneKeys);
      const sourceSceneKeys = [...new Set([
        ...originalSceneKeys.filter((sceneKey) => knownSceneKeys.has(sceneKey)),
        ...sourceFacts.map((fact) => fact.sceneKey).filter((sceneKey) => knownSceneKeys.has(sceneKey)),
        ...stateVariants.flatMap((variant) => variant.sourceSceneKeys),
      ])].sort((left, right) => (sceneOrder.get(left) ?? 0) - (sceneOrder.get(right) ?? 0));
      const removedBindingCount = originalSceneKeys.filter((sceneKey) => !knownSceneKeys.has(sceneKey)).length
        + (Array.isArray(proposal.stateVariants) ? proposal.stateVariants.flatMap((variant) => normalizeOptionalAgentStringList(variant.sourceSceneKeys)).filter((sceneKey) => !knownSceneKeys.has(sceneKey)).length : 0);
      const sourceMappingStatus = sourceSceneKeys.length > 0 ? 'resolved' : 'needs_review';
      const assetRecommendation = sourceMappingStatus === 'needs_review'
        ? 'text_only'
        : ['required', 'optional', 'text_only'].includes(proposal.assetRecommendation) ? proposal.assetRecommendation : 'optional';
      return {
        ...structuredClone(proposal),
        aliases: normalizeOptionalAgentStringList(proposal.aliases),
        sourceSceneKeys,
        baseStateSceneKey: sourceSceneKeys[0] ?? '',
        sourceMappingStatus,
        sourceMappingNote: sourceMappingStatus === 'needs_review'
          ? '现有依据无法对应当前剧本场次，已保留文字设定等待确认。'
          : removedBindingCount > 0
            ? `已忽略${removedBindingCount}个无法对应当前剧本的场次绑定。`
            : '',
        assetRecommendation,
        assetRecommendationReason: nonEmpty(proposal.assetRecommendationReason)
          ? proposal.assetRecommendationReason.trim()
          : sourceMappingStatus === 'needs_review'
            ? '剧本归属确认前保留文字设定并随分镜生成。'
            : '旧版提案未记录独立资产判断，按可选资产兼容保留。',
        sourceFacts,
        stateVariants,
        visualDesignProposal: proposal.visualDesignProposal ? {
          ...structuredClone(proposal.visualDesignProposal),
          repeatableAnchors: normalizeOptionalAgentStringList(proposal.visualDesignProposal.repeatableAnchors),
          designDecisions: normalizeOptionalAgentStringList(proposal.visualDesignProposal.designDecisions),
        } : proposal.visualDesignProposal,
      };
    }),
  };
}

export function buildPropPromptsFromProposalsRequest(input: PropPromptFromProposalInput): AgentRequest<PropPromptFromProposalInput> {
  validatePropVisualProposalDraft({ proposals: input.proposals }, input, input.proposals.map((proposal) => proposal.propAssetKey));
  return {
    operation: 'generate-prop-prompts-from-approved-proposals',
    schemaName: 'prism_autodrama_prop_prompt_sections_v1',
    instructions: [
      '你是影视道具生图提示词设计师。用户已经批准input.proposals，只把每个提案转换为中文静态图五段式可变内容，不改变、合并或新增道具。',
      '严格按proposals顺序逐项返回。程序负责绑定propAssetKey，不要重复输出道具ID。主资产只表现未激活、未受损基础状态；所有stateVariants不得提前进入主资产。',
      '程序负责五段标题、已批准画风和固定3:2资产板布局。画面不得出现人物、手、场景、文字标签或状态特效。',
      'negativeTerms保留5至8个最高风险问题。固定布局：' + PROP_MAIN_ASSET_LAYOUT,
      '输出严格符合JSON Schema，不要解释。'
    ].join('\n'),
    input,
    outputSchema: propPromptSectionsOutputSchema(input.proposals.length),
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generatePropPromptsFromProposals(provider: AgentProvider, input: PropPromptFromProposalInput): Promise<AgentGenerationResult<PropAssetPromptGenerationDraft>> {
  const result = await provider.generate<PropPromptSectionsModelOutput>(buildPropPromptsFromProposalsRequest(input));
  try {
    if (!Array.isArray(result.output?.prompts) || result.output.prompts.length !== input.proposals.length) throw new PropAssetPromptValidationError(['prompt sections must match approved proposals']);
    const prompts = input.proposals.map((proposal, index) => {
      const output = result.output.prompts[index];
      if (!output) throw new PropAssetPromptValidationError(['prompt sections must match approved proposals']);
      return {
        ...structuredClone(proposal),
        sections: output.sections ? {
          ...structuredClone(output.sections),
          negativeTerms: normalizeOptionalAgentStringList(output.sections.negativeTerms),
        } : output.sections,
      };
    });
    const requiredProps = input.proposals.map((proposal) => ({ propAssetKey: proposal.propAssetKey, canonicalName: proposal.name, aliases: proposal.aliases, requiredStateKeys: proposal.stateVariants.map((variant) => variant.stateKey) }));
    validatePropAssetPromptDraft({ prompts }, { ...input, requiredProps });
    return { ...result, output: { prompts } };
  } catch (error) {
    attachDiagnostics(error, result);
    throw error;
  }
}

function groundPropVisualProposalEvidence(
  output: PropVisualProposalModelOutput,
  input: PropVisualProposalGenerationInput
): PropVisualProposalGenerationDraft {
  if (!Array.isArray(output?.proposals)) throw new PropAssetPromptValidationError(['proposals must be an array']);
  const evidenceCatalog = buildPropEvidenceCatalog(input.script);
  const catalog = new Map(evidenceCatalog.map((item) => [item.evidenceId.toUpperCase(), item]));
  const sceneOrder = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene.order]));
  const proposals = output.proposals.map((proposal, index) => {
    const candidate = proposal && typeof proposal === 'object' ? proposal : {} as PropVisualProposalModelDraft;
    const sourceSceneKeys = new Set<string>();
    let invalidEvidenceCount = 0;
    const sourceFacts = Array.isArray(candidate.sourceFacts) ? candidate.sourceFacts.map((fact) => {
      const evidence = findPropEvidence(catalog, fact?.evidenceId);
      if (!evidence) invalidEvidenceCount += 1;
      if (evidence) sourceSceneKeys.add(evidence.sceneKey);
      return { fact: fact?.fact, sceneKey: evidence?.sceneKey ?? '', evidence: evidence?.text ?? '' };
    }) : [];
    const stateVariants = Array.isArray(candidate.stateVariants) ? candidate.stateVariants.map((variant) => {
      const evidenceItems = Array.isArray(variant.evidenceIds)
        ? [...new Set(variant.evidenceIds.map((id) => String(id).trim().toUpperCase()))].map((id) => catalog.get(id))
        : [];
      const validEvidence = evidenceItems.filter((item): item is PropEvidenceCatalogItem => Boolean(item));
      const evidenceSceneKeys = [...new Set(validEvidence.map((item) => item.sceneKey))].sort(
        (left, right) => (sceneOrder.get(left) ?? Number.POSITIVE_INFINITY) - (sceneOrder.get(right) ?? Number.POSITIVE_INFINITY),
      );
      if (evidenceItems.length === 0 || validEvidence.length !== evidenceItems.length) {
        invalidEvidenceCount += Math.max(1, evidenceItems.length - validEvidence.length);
      }
      validEvidence.forEach((item) => sourceSceneKeys.add(item.sceneKey));
      return {
        stateKey: variant?.stateKey,
        sceneKey: evidenceSceneKeys[0] ?? '',
        sourceSceneKeys: evidenceSceneKeys,
        stateDescription: variant?.stateDescription,
        sourceEvidence: validEvidence.map((item) => item.text)
      };
    }) : [];
    const orderedSourceSceneKeys = [...sourceSceneKeys].sort(
      (left, right) => (sceneOrder.get(left) ?? Number.POSITIVE_INFINITY) - (sceneOrder.get(right) ?? Number.POSITIVE_INFINITY)
    );
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const aliases = [...new Set([name, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])].map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
    const key = `R${String(index + 1).padStart(2, '0')}`;
    const sourceMappingStatus = orderedSourceSceneKeys.length > 0 ? 'resolved' : 'needs_review';
    return {
      ...structuredClone(candidate),
      promptKey: key,
      propAssetKey: key,
      name,
      aliases,
      assetRecommendation: sourceMappingStatus === 'needs_review' ? 'text_only' : ['required', 'optional', 'text_only'].includes(candidate.assetRecommendation) ? candidate.assetRecommendation : 'optional',
      assetRecommendationReason: typeof candidate.assetRecommendationReason === 'string' && candidate.assetRecommendationReason.trim() ? candidate.assetRecommendationReason.trim() : '旧版提案未记录独立资产判断，按可选资产兼容保留。',
      sourceMappingStatus,
      sourceMappingNote: sourceMappingStatus === 'needs_review'
        ? '现有依据无法对应当前剧本场次，已保留文字设定等待确认。'
        : invalidEvidenceCount > 0
          ? `已忽略${invalidEvidenceCount}条无法对应当前剧本的依据。`
          : '',
      sourceSceneKeys: orderedSourceSceneKeys,
      baseStateSceneKey: orderedSourceSceneKeys[0] ?? '',
      sourceFacts,
      stateVariants,
      visualDesignProposal: candidate.visualDesignProposal ? {
        ...structuredClone(candidate.visualDesignProposal),
        repeatableAnchors: normalizeOptionalAgentStringList(candidate.visualDesignProposal.repeatableAnchors),
        designDecisions: normalizeOptionalAgentStringList(candidate.visualDesignProposal.designDecisions),
      } : candidate.visualDesignProposal,
    };
  });
  return { proposals };
}

function findPropEvidence(catalog: Map<string, PropEvidenceCatalogItem>, evidenceId: unknown): PropEvidenceCatalogItem | undefined {
  return typeof evidenceId === 'string' ? catalog.get(evidenceId.trim().toUpperCase()) : undefined;
}

export async function generatePropAssetPrompts(
  provider: AgentProvider,
  input: PropAssetPromptGenerationInput
): Promise<AgentGenerationResult<PropAssetPromptGenerationDraft>> {
  const result = await provider.generate<PropAssetPromptModelOutput>(buildPropAssetPromptRequest(input));
  try {
    const output = groundEvidence(result.output, input);
    validatePropAssetPromptDraft(output, input);
    return { ...result, output };
  } catch (error) {
    if (error instanceof PropAssetPromptValidationError) {
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

function groundEvidence(
  output: PropAssetPromptModelOutput,
  input: PropAssetPromptGenerationInput
): PropAssetPromptGenerationDraft {
  if (!Array.isArray(output?.prompts)) throw new PropAssetPromptValidationError(['prompts must be an array']);
  const catalog = new Map(buildPropEvidenceCatalog(input.script).map((item) => [item.evidenceId, item]));
  const issues: string[] = [];
  const prompts = output.prompts.map((prompt, index) => ({
    ...structuredClone(prompt),
    visualDesignProposal: prompt.visualDesignProposal ? {
      ...structuredClone(prompt.visualDesignProposal),
      repeatableAnchors: normalizeOptionalAgentStringList(prompt.visualDesignProposal.repeatableAnchors),
      designDecisions: normalizeOptionalAgentStringList(prompt.visualDesignProposal.designDecisions),
    } : prompt.visualDesignProposal,
    sections: prompt.sections ? {
      ...structuredClone(prompt.sections),
      negativeTerms: normalizeOptionalAgentStringList(prompt.sections.negativeTerms),
    } : prompt.sections,
    sourceFacts: Array.isArray(prompt.sourceFacts) ? prompt.sourceFacts.map((fact) => {
      const evidence = catalog.get(fact.evidenceId);
      if (!evidence || evidence.sceneKey !== fact.sceneKey) issues.push(`prompt ${index + 1} selected invalid source evidence`);
      return { fact: fact.fact, sceneKey: fact.sceneKey, evidence: evidence?.text ?? '' };
    }) : [],
    stateVariants: Array.isArray(prompt.stateVariants) ? prompt.stateVariants.map((variant) => {
      const items = Array.isArray(variant.evidenceIds) ? variant.evidenceIds.map((id) => catalog.get(id)) : [];
      const validItems = items.filter((item): item is PropEvidenceCatalogItem => Boolean(item));
      const sourceSceneKeys = [...new Set(validItems.map((item) => item.sceneKey))].sort(
        (left, right) => (input.script.scenes.find((scene) => scene.sceneKey === left)?.order ?? Number.POSITIVE_INFINITY) - (input.script.scenes.find((scene) => scene.sceneKey === right)?.order ?? Number.POSITIVE_INFINITY),
      );
      if (items.length === 0 || validItems.length !== items.length) {
        issues.push(`prompt ${index + 1} selected invalid state evidence`);
      }
      return {
        stateKey: variant.stateKey,
        sceneKey: sourceSceneKeys[0] ?? variant.sceneKey,
        sourceSceneKeys,
        stateDescription: variant.stateDescription,
        sourceEvidence: validItems.map((item) => item.text)
      };
    }) : []
  }));
  return { prompts };
}

function attachDiagnostics(error: unknown, result: AgentGenerationResult<unknown>): void {
  if (!(error instanceof PropAssetPromptValidationError)) return;
  Object.defineProperty(error, 'diagnostics', { enumerable: false, value: { providerId: result.providerId, model: result.model, externalTaskId: result.externalTaskId, completedAt: result.completedAt, elapsedMs: result.elapsedMs, usage: result.usage, invalidDraft: structuredClone(result.output) } });
}

export function validatePropVisualProposalDraft(draft: PropVisualProposalGenerationDraft, input: PropVisualProposalGenerationInput, expectedPropAssetKeys?: string[]): string[] {
  validateStagedInput(input);
  if (!Array.isArray(draft.proposals)) throw new PropAssetPromptValidationError(['proposals must be an array']);
  const issues: string[] = [];
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  draft.proposals.forEach((proposal, index) => {
    const key = expectedPropAssetKeys?.[index] ?? `R${String(index + 1).padStart(2, '0')}`;
    if (proposal.promptKey !== key || proposal.propAssetKey !== key) issues.push(`proposal ${index + 1} must use ${key}`);
    if (!nonEmpty(proposal.name) || !Array.isArray(proposal.aliases) || proposal.aliases.length === 0 || !proposal.aliases.every(nonEmpty)) issues.push(`proposal ${index + 1} requires a stable identity and aliases`);
    if (!['required', 'optional', 'text_only'].includes(proposal.assetRecommendation) || !nonEmpty(proposal.assetRecommendationReason)) issues.push(`proposal ${index + 1} requires an asset recommendation and reason`);
    if (!Array.isArray(proposal.sourceSceneKeys) || proposal.sourceSceneKeys.length === 0 || proposal.baseStateSceneKey !== proposal.sourceSceneKeys[0] || proposal.sourceSceneKeys.some((sceneKey) => !sceneByKey.has(sceneKey))) issues.push(`proposal ${index + 1} source mapping needs review`);
    if (nonEmpty(proposal.sourceMappingNote)) issues.push(`proposal ${index + 1} source mapping adjusted: ${proposal.sourceMappingNote}`);
    if (!nonEmpty(proposal.baseStateDescription)) issues.push(`proposal ${index + 1} requires a base state`);
    validateFacts(proposal as PropAssetPromptDraft, sceneByKey, index, issues);
    for (const variant of Array.isArray(proposal.stateVariants) ? proposal.stateVariants : []) {
      const sourceSceneKeys = variantSourceSceneKeys(variant);
      if (!nonEmpty(variant.stateKey) || sourceSceneKeys.length === 0 || variant.sceneKey !== sourceSceneKeys[0] || sourceSceneKeys.some((sceneKey) => !sceneByKey.has(sceneKey)) || !nonEmpty(variant.stateDescription) || !Array.isArray(variant.sourceEvidence) || !variant.sourceEvidence.length || variant.sourceEvidence.some((evidence) => !evidenceExistsInScenes(evidence, sourceSceneKeys, sceneByKey))) issues.push(`proposal ${index + 1} has an invalid state variant`);
    }
    if (!completePropVisualDesign(proposal.visualDesignProposal)) issues.push(`proposal ${index + 1} has an incomplete visual design proposal`);
  });
  const report = partitionAgentDraftValidationIssues('prop-proposal', issues);
  if (report.blockingIssues.length) throw new PropAssetPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function validatePropAssetPromptDraft(
  draft: PropAssetPromptGenerationDraft,
  input: PropAssetPromptGenerationInput
): string[] {
  validateInput(input);
  const issues: string[] = [];
  if (!Array.isArray(draft.prompts) || draft.prompts.length !== input.requiredProps.length) {
    throw new PropAssetPromptValidationError(['prompts must exactly cover requiredProps']);
  }
  const sceneByKey = new Map(input.script.scenes.map((scene) => [scene.sceneKey, scene]));
  draft.prompts.forEach((prompt, index) => {
    const spec = input.requiredProps[index];
    const key = spec.propAssetKey ?? `R${String(index + 1).padStart(2, '0')}`;
    if (prompt.promptKey !== key || prompt.propAssetKey !== key) issues.push(`prompt ${index + 1} must use ${key}`);
    if (prompt.name !== spec.canonicalName || !sameStrings(prompt.aliases, spec.aliases)) issues.push(`prompt ${index + 1} identity does not match required prop`);
    const sourceSceneKeys = Array.isArray(prompt.sourceSceneKeys) ? prompt.sourceSceneKeys : [];
    if (!sourceSceneKeys.length || prompt.baseStateSceneKey !== sourceSceneKeys[0]) issues.push(`prompt ${index + 1} requires ordered source scenes and earliest base scene`);
    if (sourceSceneKeys.some((key) => !sceneByKey.has(key))) issues.push(`prompt ${index + 1} references an unknown scene`);
    if (!nonEmpty(prompt.baseStateDescription)) issues.push(`prompt ${index + 1} requires a base state`);
    validateFacts(prompt, sceneByKey, index, issues);
    const requiredStates = spec.requiredStateKeys ?? [];
    const stateVariants = Array.isArray(prompt.stateVariants) ? prompt.stateVariants : [];
    if (!sameStrings(stateVariants.map((item) => item.stateKey), requiredStates)) issues.push(`prompt ${index + 1} state variants do not match required states`);
    for (const variant of stateVariants) {
      const sourceSceneKeys = variantSourceSceneKeys(variant);
      if (sourceSceneKeys.length === 0 || variant.sceneKey !== sourceSceneKeys[0] || sourceSceneKeys.some((sceneKey) => !sceneByKey.has(sceneKey)) || !nonEmpty(variant.stateDescription) || !Array.isArray(variant.sourceEvidence) || !variant.sourceEvidence.length || variant.sourceEvidence.some((evidence) => !evidenceExistsInScenes(evidence, sourceSceneKeys, sceneByKey))) {
        issues.push(`prompt ${index + 1} has an invalid state variant`);
      }
    }
    if (!completePropVisualDesign(prompt.visualDesignProposal)) {
      issues.push(`prompt ${index + 1} has an incomplete visual design proposal`);
    }
    if (!completePropSections(prompt.sections)) {
      issues.push(`prompt ${index + 1} has incomplete prompt sections`);
    }
    const negativeCount = prompt.sections?.negativeTerms?.length ?? 0;
    if (negativeCount < 5 || negativeCount > 8) {
      issues.push(`prompt ${index + 1} negativeTerms must contain 5 to 8 items`);
    }
  });
  const report = partitionAgentDraftValidationIssues('prop-asset-prompt', issues);
  if (report.blockingIssues.length) throw new PropAssetPromptValidationError(report.blockingIssues);
  return report.warnings;
}

export function compilePropAssetPrompt(
  draft: PropAssetPromptDraft,
  input: PropAssetPromptGenerationInput
): string {
  const design = draft.visualDesignProposal;
  return [
    `道具资料：${draft.name}（别名：${draft.aliases.join('、')}）`,
    `画风预设：${input.styleSelection.name}`,
    '', '基础设定', `横版3:2中性摄影棚道具资产板。${design.objectIdentity}\n${design.silhouetteAndProportions}`,
    '', '氛围、画质与摄影风格', `${input.styleSelection.stylePrompt.trim()}\n均匀中性棚拍光，曝光与白平衡一致。${design.materialsAndSurface}\n${design.colorAndFinish}`,
    '', '画面内容与布局', `${PROP_MAIN_ASSET_LAYOUT}\n基础状态：${draft.baseStateDescription}\n${design.constructionAndDetails}\n识别特征：${design.repeatableAnchors.join('；')}`,
    '', '摄影机与成像', '主视图使用标准镜头自然透视，各结构视图按对应观察方向端正拍摄，统一物体尺度，景深覆盖全部需要展示的结构。',
    '', '负面词', ['不同道具混入', '结构不一致', '人物', '手部', '文字标签', '剧情场景混入', ...draft.sections.negativeTerms.map((term) => term.trim())].filter((term, index, all) => all.indexOf(term) === index).slice(0, 8).join('，')
  ].join('\n');
}

function validateInput(input: PropAssetPromptGenerationInput): void {
  if (input.script.approval !== 'approved') throw new Error('Script must be approved before prop prompt generation.');
  if (input.styleSelection.approval !== 'approved') throw new Error('Style must be approved before prop prompt generation.');
  if (!input.requiredProps.length) throw new Error('At least one required prop is needed.');
}

function validateStagedInput(input: PropVisualProposalGenerationInput): void {
  if (input.script.approval !== 'approved') throw new Error('Script must be approved before prop design.');
  if (input.styleSelection.approval !== 'approved') throw new Error('Style must be approved before prop design.');
}

function validateFacts(prompt: PropAssetPromptDraft, scenes: Map<string, ScriptScene>, index: number, issues: string[]): void {
  if (!Array.isArray(prompt.sourceFacts) || !prompt.sourceFacts.length) { issues.push(`prompt ${index + 1} requires source facts`); return; }
  const sourceSceneKeys = Array.isArray(prompt.sourceSceneKeys) ? prompt.sourceSceneKeys : [];
  for (const fact of prompt.sourceFacts) {
    const scene = scenes.get(fact.sceneKey);
    if (!scene || !sourceSceneKeys.includes(fact.sceneKey) || !nonEmpty(fact.fact) || !nonEmpty(fact.evidence) || !sceneText(scene).includes(fact.evidence)) {
      issues.push(`prompt ${index + 1} has invalid source evidence`);
    }
  }
}

function sceneText(scene: ScriptScene): string {
  return [scene.heading, scene.location, scene.timeOfDay, scene.purpose, scene.action, ...scene.sourceEvidence, ...scene.dialogue.map((line) => line.text)].join('\n');
}

function variantSourceSceneKeys(variant: PropStateVariant): string[] {
  const values = Array.isArray(variant.sourceSceneKeys) && variant.sourceSceneKeys.length > 0
    ? variant.sourceSceneKeys
    : [variant.sceneKey];
  return [...new Set(values.filter(nonEmpty))];
}

function evidenceExistsInScenes(evidence: string, sceneKeys: string[], scenes: Map<string, ScriptScene>): boolean {
  return sceneKeys.some((sceneKey) => {
    const scene = scenes.get(sceneKey);
    return Boolean(scene && sceneText(scene).includes(evidence));
  });
}

function sameStrings(actual: unknown, expected: unknown): boolean {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function completePropVisualDesign(value: PropAssetPromptDraft['visualDesignProposal'] | undefined): boolean {
  return Boolean(
    value &&
    [value.objectIdentity, value.silhouetteAndProportions, value.materialsAndSurface, value.constructionAndDetails, value.colorAndFinish, value.scaleAndHandling].every(nonEmpty) &&
    Array.isArray(value.repeatableAnchors) && value.repeatableAnchors.every(nonEmpty) &&
    Array.isArray(value.designDecisions) && value.designDecisions.every(nonEmpty)
  );
}

function completePropSections(value: PropAssetPromptDraft['sections'] | undefined): boolean {
  return Boolean(
    value &&
    [value.basicSetting, value.atmosphereQualityPhotography, value.contentSpecifics, value.cameraImaging].every(nonEmpty) &&
    Array.isArray(value.negativeTerms) && value.negativeTerms.every(nonEmpty)
  );
}

const PROP_ASSET_PROMPT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  properties: {
    prompts: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false,
      properties: {
        promptKey: { type: 'string', pattern: '^R[0-9]{2,}$' }, propAssetKey: { type: 'string', pattern: '^R[0-9]{2,}$' },
        name: { type: 'string' }, aliases: { type: 'array', minItems: 1, items: { type: 'string' } },
        sourceSceneKeys: { type: 'array', minItems: 1, items: { type: 'string' } }, baseStateSceneKey: { type: 'string' }, baseStateDescription: { type: 'string' },
        sourceFacts: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { fact: { type: 'string' }, sceneKey: { type: 'string' }, evidenceId: { type: 'string' } }, required: ['fact', 'sceneKey', 'evidenceId'] } },
        stateVariants: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { stateKey: { type: 'string' }, sceneKey: { type: 'string' }, stateDescription: { type: 'string' }, evidenceIds: { type: 'array', minItems: 1, items: { type: 'string' } } }, required: ['stateKey', 'sceneKey', 'stateDescription', 'evidenceIds'] } },
        visualDesignProposal: { type: 'object', additionalProperties: false, properties: {
          objectIdentity: { type: 'string' }, silhouetteAndProportions: { type: 'string' }, materialsAndSurface: { type: 'string' }, constructionAndDetails: { type: 'string' }, colorAndFinish: { type: 'string' }, scaleAndHandling: { type: 'string' },
          repeatableAnchors: { type: 'array', items: { type: 'string' } }, designDecisions: { type: 'array', items: { type: 'string' } }
        }, required: ['objectIdentity', 'silhouetteAndProportions', 'materialsAndSurface', 'constructionAndDetails', 'colorAndFinish', 'scaleAndHandling', 'repeatableAnchors', 'designDecisions'] },
        sections: { type: 'object', additionalProperties: false, properties: { basicSetting: { type: 'string' }, atmosphereQualityPhotography: { type: 'string' }, contentSpecifics: { type: 'string' }, cameraImaging: { type: 'string' }, negativeTerms: { type: 'array', items: { type: 'string' } } }, required: ['basicSetting', 'atmosphereQualityPhotography', 'contentSpecifics', 'cameraImaging', 'negativeTerms'] }
      },
      required: ['promptKey', 'propAssetKey', 'name', 'aliases', 'sourceSceneKeys', 'baseStateSceneKey', 'baseStateDescription', 'sourceFacts', 'stateVariants', 'visualDesignProposal', 'sections']
    } }
  }, required: ['prompts']
};

function propVisualProposalOutputSchema(evidenceIds: string[]): Record<string, unknown> {
  const evidenceIdSchema = { type: 'string', enum: evidenceIds };
  const properties = {
  name: { type: 'string' }, aliases: { type: 'array', minItems: 1, items: { type: 'string' } },
  assetRecommendation: { type: 'string', enum: ['required', 'optional', 'text_only'] }, assetRecommendationReason: { type: 'string' },
  baseStateDescription: { type: 'string' },
  sourceFacts: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { fact: { type: 'string' }, evidenceId: evidenceIdSchema }, required: ['fact', 'evidenceId'] } },
  stateVariants: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { stateKey: { type: 'string' }, stateDescription: { type: 'string' }, evidenceIds: { type: 'array', minItems: 1, items: evidenceIdSchema }, }, required: ['stateKey', 'stateDescription', 'evidenceIds'] } },
  visualDesignProposal: { type: 'object', additionalProperties: false, properties: { objectIdentity: { type: 'string' }, silhouetteAndProportions: { type: 'string' }, materialsAndSurface: { type: 'string' }, constructionAndDetails: { type: 'string' }, colorAndFinish: { type: 'string' }, scaleAndHandling: { type: 'string' }, repeatableAnchors: { type: 'array', items: { type: 'string' } }, designDecisions: { type: 'array', items: { type: 'string' } } }, required: ['objectIdentity', 'silhouetteAndProportions', 'materialsAndSurface', 'constructionAndDetails', 'colorAndFinish', 'scaleAndHandling', 'repeatableAnchors', 'designDecisions'] }
  };
  return { type: 'object', additionalProperties: false, properties: { proposals: { type: 'array', items: { type: 'object', additionalProperties: false, properties, required: ['name', 'aliases', 'assetRecommendation', 'assetRecommendationReason', 'baseStateDescription', 'sourceFacts', 'stateVariants', 'visualDesignProposal'] } } }, required: ['proposals'] };
}

function propPromptSectionsOutputSchema(expectedCount: number): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: { prompts: { type: 'array', minItems: expectedCount, maxItems: expectedCount, items: { type: 'object', additionalProperties: false, properties: { sections: { type: 'object', additionalProperties: false, properties: { basicSetting: { type: 'string' }, atmosphereQualityPhotography: { type: 'string' }, contentSpecifics: { type: 'string' }, cameraImaging: { type: 'string' }, negativeTerms: { type: 'array', items: { type: 'string' } } }, required: ['basicSetting', 'atmosphereQualityPhotography', 'contentSpecifics', 'cameraImaging', 'negativeTerms'] } }, required: ['sections'] } } }, required: ['prompts'] };
}
