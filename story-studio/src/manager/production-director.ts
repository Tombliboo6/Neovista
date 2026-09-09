import { selfReviewingAgent } from '../providers/creative-review.ts';
import type { CharacterProfileDraft } from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest,
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import { productionCheckpoint } from '../workers/production-context.ts';
import {
  generateCharacterProfiles,
  type CharacterProfileExtractionDraft,
  type CharacterProfileExtractionInput,
} from '../characters/profile-extraction.ts';
import {
  generateSceneVisualProposals,
  type SceneAssetPromptGenerationInput,
  type SceneVisualProposalDraft,
  type SceneVisualProposalGenerationDraft,
} from '../scenes/scene-prompt-generation.ts';
import {
  generatePropVisualProposals,
  type PropVisualProposalGenerationDraft,
  type PropVisualProposalGenerationInput,
} from '../props/prop-prompt-generation.ts';

export type ProductionDirectorDecision = 'approve' | 'revise';
export type ProductionDirectorStage = 'character-profiles' | 'scene-proposals' | 'prop-proposals';

export interface ProductionDirectorReview {
  decision: ProductionDirectorDecision;
  summary: string;
  revisionInstructions: string[];
}

export interface CharacterProductionDirectorReview extends ProductionDirectorReview {
  finalCharacterNames: string[];
}

export interface DirectedStageResult<TOutput> extends AgentGenerationResult<TOutput> {
  supervision: {
    stage: ProductionDirectorStage;
    specialistRuns: number;
    directorReviews: ProductionDirectorReview[];
  };
}

export class ProductionDirectorSupervisionError extends Error {
  readonly code = 'production_director_revision_required';
  readonly stage: ProductionDirectorStage;
  readonly review: ProductionDirectorReview;
  readonly issues: string[];
  readonly diagnostics: { invalidDraft?: unknown };

  constructor(stage: ProductionDirectorStage, review: ProductionDirectorReview, invalidDraft?: unknown) {
    super(`Production director did not approve ${stage}: ${review.summary}`);
    this.name = 'ProductionDirectorSupervisionError';
    this.stage = stage;
    this.review = review;
    this.issues = [review.summary, ...review.revisionInstructions];
    this.diagnostics = { invalidDraft };
  }
}

/** A validated specialist draft survives a later review or revision failure. */
export class ProductionDirectorStageError extends Error {
  readonly code = 'production_director_incomplete';
  readonly stage: ProductionDirectorStage;
  readonly draft: unknown;
  readonly failure: unknown;
  constructor(stage: ProductionDirectorStage, draft: unknown, failure: unknown) {
    super('总导演复核未完成，已保留通过基础校验的阶段草稿，等待用户确认。');
    this.name = 'ProductionDirectorStageError';
    this.stage = stage; this.draft = draft; this.failure = failure;
  }
}

async function preserveStage<T>(stage: ProductionDirectorStage, first: AgentGenerationResult<T>, work: (save: (result: AgentGenerationResult<T>) => void) => Promise<DirectedStageResult<T>>): Promise<DirectedStageResult<T>> {
  let current = first;
  const save = (result: AgentGenerationResult<T>) => {
    current = result;
    productionCheckpoint({ candidateDraft: result.output, complete: false });
  };
  save(first);
  try { return await work(save); }
  catch (error) {
    if (error instanceof ProductionDirectorSupervisionError) throw error;
    throw new ProductionDirectorStageError(stage, current.output, error);
  }
}

export async function generateCharacterProfilesWithDirector(
  provider: AgentProvider,
  input: CharacterProfileExtractionInput,
  options: { reviewMode?: 'self' | 'director' } = {},
): Promise<DirectedStageResult<CharacterProfileExtractionDraft>> {
  const first = await generateCharacterProfiles(selfReviewingAgent(provider), input);
  if (options.reviewMode !== 'director') return directedResult(first, 'character-profiles', 1, []);
  return preserveStage('character-profiles', first, async (save) => {
    const firstReview = await reviewCharacterProfiles(provider, input, first.output, 1);
    if (firstReview.decision === 'approve' && sameNames(firstReview.finalCharacterNames, input.requiredCharacterNames)) {
      return directedResult(first, 'character-profiles', 1, [firstReview]);
    }

    const revisedNames = validateCharacterSelection(firstReview.finalCharacterNames, input.requiredCharacterNames);
    const repairInput: CharacterProfileExtractionInput = {
      ...input,
      requiredCharacterNames: revisedNames,
      preferences: withDirectorRequirements(input.preferences, firstReview),
    };
    const repaired = revisedNames.length > 0
      ? await generateCharacterProfiles(provider, repairInput)
      : { ...first, output: { profiles: [] as CharacterProfileDraft[] } };
    save(repaired);
    const finalReview = await reviewCharacterProfiles(provider, repairInput, repaired.output, 2);
    if (finalReview.decision !== 'approve' || !sameNames(finalReview.finalCharacterNames, revisedNames)) {
      throw new ProductionDirectorSupervisionError('character-profiles', finalReview, repaired.output);
    }
    return directedResult(repaired, 'character-profiles', revisedNames.length > 0 ? 2 : 1, [firstReview, finalReview]);
  });
}

export async function generateSceneVisualProposalsWithDirector(
  provider: AgentProvider,
  input: SceneAssetPromptGenerationInput,
  options: { reviewMode?: 'self' | 'director' } = {},
): Promise<DirectedStageResult<SceneVisualProposalGenerationDraft>> {
  const first = await generateSceneVisualProposals(selfReviewingAgent(provider), input);
  if (options.reviewMode !== 'director') return directedResult(first, 'scene-proposals', 1, []);
  return preserveStage('scene-proposals', first, async (save) => {
    const firstReview = await reviewSceneProposals(provider, input, first.output, 1);
    if (firstReview.decision === 'approve') {
      return directedResult(first, 'scene-proposals', 1, [firstReview]);
    }

    const repairInput: SceneAssetPromptGenerationInput = {
      ...input,
      preferences: withDirectorRequirements(input.preferences, firstReview),
    };
    const repaired = await generateSceneVisualProposals(provider, repairInput);
    save(repaired);
    const finalReview = await reviewSceneProposals(provider, input, repaired.output, 2);
    return directedResult(repaired, 'scene-proposals', 2, [firstReview, finalReview]);
  });
}

export async function generatePropVisualProposalsWithDirector(
  provider: AgentProvider,
  input: PropVisualProposalGenerationInput,
  options: { reviewMode?: 'self' | 'director' } = {},
): Promise<DirectedStageResult<PropVisualProposalGenerationDraft>> {
  const first = await generatePropVisualProposals(selfReviewingAgent(provider), input);
  if (options.reviewMode !== 'director') return directedResult(first, 'prop-proposals', 1, []);
  return preserveStage('prop-proposals', first, async (save) => {
    const firstReview = await reviewPropProposals(provider, input, first.output, 1);
    if (firstReview.decision === 'approve') {
      return directedResult(first, 'prop-proposals', 1, [firstReview]);
    }

    const repairInput: PropVisualProposalGenerationInput = {
      ...input,
      preferences: withDirectorRequirements(input.preferences, firstReview),
    };
    const repaired = await generatePropVisualProposals(provider, repairInput);
    save(repaired);
    const finalReview = await reviewPropProposals(provider, input, repaired.output, 2);
    return directedResult(repaired, 'prop-proposals', 2, [firstReview, finalReview]);
  });
}

export function buildCharacterDirectorReviewRequest(
  input: CharacterProfileExtractionInput,
  draft: CharacterProfileExtractionDraft,
  round: 1 | 2,
): AgentRequest {
  return {
    operation: 'production-director-review-character-profiles',
    schemaName: 'prism_autodrama_director_character_review_v1',
    instructions: [
      '你是本项目的总导演，独立审核人物策划Agent的阶段结果。你负责语义和制作判断，程序不会用关键词替你判断实体类别。',
      '结合完整剧本、原始候选名称和人物档案，判断每个对象是否确实需要跨镜头保持身份连续的人物资产，并检查是否遗漏实际需要的人物、是否把空间、物件、声音、抽象概念或临时群体当成了人物。不要按词表机械判断，要依据其在剧本中的真实功能。',
      '同时检查人物档案是否忠于剧本证据，是否把未知年龄、外貌、服装或关系伪装成既定事实，以及人物之间是否自相矛盾。',
      '可以approve，也可以revise。finalCharacterNames只能从input.requiredCharacterNames中选择，保持原始出现顺序；不要发明新名称。需要返修时给出少量、明确、可由人物策划Agent执行的revisionInstructions。',
      `这是第${round}次总导演审核。第二次仍有实质问题时继续返回revise，程序会停下并交给用户，不得勉强通过。`,
      '只输出严格结构化结果，不解释审核过程。',
    ].join('\n'),
    input: { ...input, draft },
    outputSchema: CHARACTER_DIRECTOR_REVIEW_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.directionQuestion,
  };
}

export function buildSceneDirectorReviewRequest(
  input: SceneAssetPromptGenerationInput,
  draft: SceneVisualProposalGenerationDraft,
  round: 1 | 2,
): AgentRequest {
  return {
    operation: 'production-director-review-scene-proposals',
    schemaName: 'prism_autodrama_director_scene_review_v1',
    instructions: [
      '你是本项目的总导演，独立审核场景设计Agent的阶段结果。场景是否合并或拆分由你根据剧本语义和后续制作复用价值判断，程序不按地点字符串、房间名称或时间词替你决定。',
      '判断每份提案是否代表稳定、可复用的物理空间；检查拆分是否只是由时间、光线、机位、临时陈设或镜头目的造成，也检查合并是否掩盖了实际不同的空间结构、出入口、固定地标或制作需求。',
      '以最少但够用的场景资产支撑后续制作为目标。只出现一次的一次性布景、产品桌面、过渡空间或临时机位，通常可以留到分镜阶段直接完成，不必为了每个剧本场次单独建立场景资产。',
      '复用价值要结合关联场次数量判断，但不得只按次数机械决定：跨多个场次且需要空间连续性的地点优先保留；单次出现但承担关键建立镜头或复杂多角度调度的地点也可以保留。',
      '复核每个场景的assetRecommendation与理由：required表示建议建立固定资产，text_only表示随分镜生成。必要性判断必须与复用价值、空间连续性、镜头调度和剧情状态变化一致。',
      '同时检查全部场次的剧情状态、空间连续性、证据和视觉提案是否足以支撑后续分镜，不要求某种固定分组数量。',
      '可以approve，也可以revise。需要返修时，只指出影响制作的实质问题，并给出少量、明确、可由场景设计Agent执行的revisionInstructions。',
      round === 1
        ? '这是第一次总导演审核。确有影响场景资产归并或复用的实质问题时返回revise，由场景设计Agent定向返修一次。'
        : '这是第二次交付审核。只要提案已经形成最少且可用的稳定场景资产集合，就返回approve；仍可在具体分镜中明确的窗景、机位、临时桌面或局部空间关系写入revisionInstructions作为后续制作提示，不要据此阻断场景阶段。只有场景实体归并本身仍然错误、无法支撑后续分镜时才返回revise。',
      '只输出严格结构化结果，不解释审核过程。',
    ].join('\n'),
    input: { ...input, draft },
    outputSchema: DIRECTOR_REVIEW_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.directionQuestion,
  };
}

export function buildPropDirectorReviewRequest(
  input: PropVisualProposalGenerationInput,
  draft: PropVisualProposalGenerationDraft,
  round: 1 | 2,
): AgentRequest {
  return {
    operation: 'production-director-review-prop-proposals',
    schemaName: 'prism_autodrama_director_prop_review_v1',
    instructions: [
      '你是本项目的总导演，独立审核道具设计Agent的阶段结果。程序只确认数据可读取、证据编号真实存在和稳定ID，不替你判断道具语义。',
      '结合完整剧本、全部场次、证据原文和候选提案，复核每件道具的assetRecommendation。目标不是把所有名词做成资产，而是用最少但够用的独立图片支撑后续制作。',
      'required只保留普通文字难以锁定、跨镜头身份连续性重要、承担品牌或剧情核心、存在必须保持同一物件关系的多状态变化，或特写穿帮成本高的物件；optional留给特写或产品收束等条件成立时由用户选择；常见食材、常见容器和临时陈设通常应为text_only并随分镜生成。出现次数不得单独决定等级。',
      '检查同一道具是否被重复拆分、不同道具是否被错误合并、普通环境陈设是否被误当成剧情道具，以及真正需要保持识别连续性的物品是否遗漏。若多件普通食材可在同一镜头中由文字控制，不要为每件食材建立独立资产板。',
      '状态是否可以由多个场次共同证明、多个场次是否描述同一稳定状态、基础状态与剧情变化的划分是否合理，均由你按剧情与制作语义判断。不得因为证据跨场就机械要求拆分或否决。',
      '同时检查视觉提案是否忠于剧本事实，未知的材质、结构、颜色和功能是否明确保留为设计决定，是否加入改变剧情的新能力、机关、文字或势力符号。',
      '可以approve，也可以revise。需要返修时，只指出影响后续资产与分镜制作的实质问题，并给出少量、明确、可由道具设计Agent执行的revisionInstructions。',
      `这是第${round}次总导演审核。第二次仍有实质问题时继续返回revise，程序会停下并交给用户，不得勉强通过。`,
      '只输出严格结构化结果，不解释审核过程。',
    ].join('\n'),
    input: { ...input, draft },
    outputSchema: DIRECTOR_REVIEW_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.directionQuestion,
  };
}

async function reviewCharacterProfiles(
  provider: AgentProvider,
  input: CharacterProfileExtractionInput,
  draft: CharacterProfileExtractionDraft,
  round: 1 | 2,
): Promise<CharacterProductionDirectorReview> {
  const result = await provider.generate<CharacterProductionDirectorReview>(
    buildCharacterDirectorReviewRequest(input, draft, round),
  );
  const review = normalizeCharacterReview(result.output, input.requiredCharacterNames);
  validateReview(review, true);
  return review;
}

async function reviewSceneProposals(
  provider: AgentProvider,
  input: SceneAssetPromptGenerationInput,
  draft: SceneVisualProposalGenerationDraft,
  round: 1 | 2,
): Promise<ProductionDirectorReview> {
  const result = await provider.generate<ProductionDirectorReview>(
    buildSceneDirectorReviewRequest(input, draft, round),
  );
  const review = normalizeReview(result.output);
  validateReview(review, false);
  return review;
}

async function reviewPropProposals(
  provider: AgentProvider,
  input: PropVisualProposalGenerationInput,
  draft: PropVisualProposalGenerationDraft,
  round: 1 | 2,
): Promise<ProductionDirectorReview> {
  const result = await provider.generate<ProductionDirectorReview>(
    buildPropDirectorReviewRequest(input, draft, round),
  );
  const review = normalizeReview(result.output);
  validateReview(review, false);
  return review;
}

function normalizeReview(value: ProductionDirectorReview): ProductionDirectorReview {
  return {
    decision: value?.decision,
    summary: typeof value?.summary === 'string' ? value.summary.trim() : '',
    revisionInstructions: Array.isArray(value?.revisionInstructions)
      ? value.revisionInstructions.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

function normalizeCharacterReview(
  value: CharacterProductionDirectorReview,
  originalNames: string[],
): CharacterProductionDirectorReview {
  const base = normalizeReview(value);
  const selected = new Set(
    Array.isArray(value?.finalCharacterNames)
      ? value.finalCharacterNames.map((name) => String(name).trim()).filter(Boolean)
      : [],
  );
  return {
    ...base,
    finalCharacterNames: originalNames.filter((name) => selected.has(name)),
  };
}

function validateReview(
  review: ProductionDirectorReview | CharacterProductionDirectorReview,
  characterReview: boolean,
): void {
  if (!['approve', 'revise'].includes(review.decision)) {
    throw new Error('Production director returned an invalid decision.');
  }
  if (!review.summary) throw new Error('Production director review requires a summary.');
  if (review.decision === 'revise' && review.revisionInstructions.length === 0) {
    throw new Error('Production director revision requires actionable instructions.');
  }
  if (characterReview && !Array.isArray((review as CharacterProductionDirectorReview).finalCharacterNames)) {
    throw new Error('Production director character review requires finalCharacterNames.');
  }
}

function validateCharacterSelection(selected: string[], original: string[]): string[] {
  const originalSet = new Set(original);
  if (selected.some((name) => !originalSet.has(name))) {
    throw new Error('Production director selected an unknown character name.');
  }
  return selected;
}

function withDirectorRequirements<T extends { language?: string; requirements?: string[] } | undefined>(
  preferences: T,
  review: ProductionDirectorReview,
): { language?: string; requirements: string[] } {
  return {
    ...(preferences ?? {}),
    requirements: [
      ...(preferences?.requirements ?? []),
      `总导演返修：${review.revisionInstructions.join('；')}`,
    ],
  };
}

function directedResult<TOutput>(
  result: AgentGenerationResult<TOutput>,
  stage: ProductionDirectorStage,
  specialistRuns: number,
  reviews: ProductionDirectorReview[],
): DirectedStageResult<TOutput> {
  return {
    ...result,
    supervision: { stage, specialistRuns, directorReviews: reviews },
  };
}

function sameNames(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

const DIRECTOR_REVIEW_PROPERTIES = {
  decision: { type: 'string', enum: ['approve', 'revise'] },
  summary: { type: 'string' },
  revisionInstructions: { type: 'array', maxItems: 6, items: { type: 'string' } },
};

const DIRECTOR_REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: DIRECTOR_REVIEW_PROPERTIES,
  required: ['decision', 'summary', 'revisionInstructions'],
};

const CHARACTER_DIRECTOR_REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...DIRECTOR_REVIEW_PROPERTIES,
    finalCharacterNames: { type: 'array', items: { type: 'string' } },
  },
  required: ['decision', 'summary', 'revisionInstructions', 'finalCharacterNames'],
};
