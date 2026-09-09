import type { EpisodePlanDraft, NovelSegment } from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export const EPISODE_SPLIT_SCHEMA_NAME = 'prism_autodrama_episode_plan_drafts_v1';

export interface EpisodeSplitPreferences {
  targetDurationSec: number;
  minimumEpisodes?: number;
  maximumEpisodes?: number;
  genre?: string;
  requirements?: string[];
}

export interface SemanticEpisodeSplitInput {
  documentId: string;
  documentVersion: number;
  segments: NovelSegment[];
  preferences: EpisodeSplitPreferences;
}

export interface StoryCharacterAnalysis {
  name: string;
  role: string;
  goal: string;
  initialState: string;
}

export interface GlobalStoryAnalysis {
  premise: string;
  centralConflict: string;
  mainCharacters: StoryCharacterAnalysis[];
  majorTurningPoints: string[];
  continuityRisks: string[];
}

export interface SemanticEpisodeSplitOutput {
  globalAnalysis: GlobalStoryAnalysis;
  episodes: EpisodePlanDraft[];
}

export class SemanticSplitValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Semantic episode split failed validation: ${issues.join(' | ')}`);
    this.name = 'SemanticSplitValidationError';
    this.issues = issues;
  }
}

export function buildSemanticEpisodeSplitRequest(
  input: SemanticEpisodeSplitInput
): AgentRequest<SemanticEpisodeSplitInput> {
  validateInput(input);

  return {
    operation: 'split-novel-into-episodes',
    schemaName: EPISODE_SPLIT_SCHEMA_NAME,
    instructions: [
      '你是专业短剧总编剧，负责根据完整小说内容进行语义拆集。',
      '先建立全局人物、主线冲突、关键转折与连续性风险，再规划每一集；不能只按章节数量或字数平均切分。',
      'preferences.targetDurationSec 是单集目标成片时长。先根据可拍摄对话、动作、反应、转场和必要停顿估算整段内容时长，再自动决定集数并寻找接近目标时长的剧情边界；集数上下限仅在 preferences 明确提供时才生效。',
      '目标时长是软约束：优先保证冲突、转折和阶段性回报完整，不能为了凑时长在动作或因果链中间硬切；最后一集可因剩余剧情量合理缩短。',
      '每集必须具备明确的开场钩子、核心冲突推进、转折、阶段性回报和能驱动下一集的结尾钩子。',
      '输入 segments 是按原文顺序排列的最小可分配单元。每个 segment ID 必须且只能使用一次，保持原顺序，不得遗漏、重复或虚构原文。',
      '每集 sourceStart/sourceEnd 必须等于该集首尾 segment 的边界，sourceSegmentIds 必须连续。',
      'openingHook 和 endingHook 只能改写本集已分配原文中实际发生的内容，不得提前使用下一集事件，也不得增加原文不存在的动作、声音、道具状态或因果。',
      'openingHookEvidence 和 endingHookEvidence 必须逐字复制本集原文中的短句，分别证明开头与结尾钩子的依据。',
      'continuityIn/continuityOut 要明确记录人物状态、信息差、道具或未解决冲突，供后续剧本和镜头阶段继承。',
      '每集 targetDurationSec 必须填写基于本集已分配剧情估算的成片秒数，而不是机械复制输入目标值。',
      '输出必须严格符合 JSON Schema，不要输出解释性文字。'
    ].join('\n'),
    input,
    outputSchema: EPISODE_SPLIT_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft
  };
}

export async function splitNovelSemantically(
  provider: AgentProvider,
  input: SemanticEpisodeSplitInput
): Promise<AgentGenerationResult<SemanticEpisodeSplitOutput>> {
  const result = await provider.generate<SemanticEpisodeSplitOutput>(
    buildSemanticEpisodeSplitRequest(input)
  );
  validateSemanticEpisodeSplitOutput(result.output, input);
  return result;
}

export function validateSemanticEpisodeSplitOutput(
  output: SemanticEpisodeSplitOutput,
  input: SemanticEpisodeSplitInput
): void {
  const issues: string[] = [];
  const segmentById = new Map(input.segments.map((segment) => [segment.id, segment]));
  const assignedSegmentIds: string[] = [];

  if (!output.globalAnalysis || !nonEmpty(output.globalAnalysis.premise)) {
    issues.push('globalAnalysis.premise is required');
  }
  if (!output.globalAnalysis || !nonEmpty(output.globalAnalysis.centralConflict)) {
    issues.push('globalAnalysis.centralConflict is required');
  }
  if (!Array.isArray(output.episodes) || output.episodes.length === 0) {
    issues.push('at least one episode is required');
  }

  if (
    input.preferences.minimumEpisodes !== undefined &&
    output.episodes.length < input.preferences.minimumEpisodes
  ) {
    issues.push(`episode count is below minimum ${input.preferences.minimumEpisodes}`);
  }
  if (
    input.preferences.maximumEpisodes !== undefined &&
    output.episodes.length > input.preferences.maximumEpisodes
  ) {
    issues.push(`episode count exceeds maximum ${input.preferences.maximumEpisodes}`);
  }

  for (let index = 0; index < output.episodes.length; index += 1) {
    const episode = output.episodes[index];
    if (!episode) continue;
    const expectedEpisodeNumber = index + 1;

    if (episode.episodeNumber !== expectedEpisodeNumber) {
      issues.push(`episode ${expectedEpisodeNumber} has non-contiguous episodeNumber`);
    }
    if (!Array.isArray(episode.sourceSegmentIds) || episode.sourceSegmentIds.length === 0) {
      issues.push(`episode ${expectedEpisodeNumber} has no source segments`);
      continue;
    }

    const sourceSegments = episode.sourceSegmentIds
      .map((id) => segmentById.get(id))
      .filter((segment): segment is NovelSegment => segment !== undefined);

    if (sourceSegments.length !== episode.sourceSegmentIds.length) {
      issues.push(`episode ${expectedEpisodeNumber} references unknown source segments`);
      continue;
    }
    if (!isConsecutive(sourceSegments.map((segment) => segment.order))) {
      issues.push(`episode ${expectedEpisodeNumber} source segments are not consecutive`);
    }
    if (episode.sourceStart !== sourceSegments[0]?.sourceStart) {
      issues.push(`episode ${expectedEpisodeNumber} sourceStart does not match its first segment`);
    }
    if (episode.sourceEnd !== sourceSegments.at(-1)?.sourceEnd) {
      issues.push(`episode ${expectedEpisodeNumber} sourceEnd does not match its last segment`);
    }
    if (!hasCompleteEditorialFields(episode)) {
      issues.push(`episode ${expectedEpisodeNumber} is missing editorial analysis fields`);
    }
    const assignedText = sourceSegments.map((segment) => segment.text).join('');
    if (!assignedText.includes(episode.openingHookEvidence)) {
      issues.push(`episode ${expectedEpisodeNumber} openingHookEvidence is not in assigned source`);
    }
    if (!assignedText.includes(episode.endingHookEvidence)) {
      issues.push(`episode ${expectedEpisodeNumber} endingHookEvidence is not in assigned source`);
    }

    assignedSegmentIds.push(...episode.sourceSegmentIds);
  }

  const expectedIds = input.segments.map((segment) => segment.id);
  if (assignedSegmentIds.join('\u0000') !== expectedIds.join('\u0000')) {
    issues.push('source segments are not covered exactly once in original order');
  }

  if (issues.length > 0) {
    throw new SemanticSplitValidationError(issues);
  }
}

function validateInput(input: SemanticEpisodeSplitInput): void {
  if (input.segments.length === 0) {
    throw new Error('Semantic episode splitting requires at least one pre-split segment.');
  }
  if (input.preferences.targetDurationSec <= 0) {
    throw new Error('Target episode duration must be greater than zero.');
  }
  if (
    input.preferences.minimumEpisodes !== undefined &&
    input.preferences.maximumEpisodes !== undefined &&
    input.preferences.minimumEpisodes > input.preferences.maximumEpisodes
  ) {
    throw new Error('Minimum episode count must not exceed maximum episode count.');
  }

  for (let index = 0; index < input.segments.length; index += 1) {
    const segment = input.segments[index];
    if (!segment) continue;
    if (
      segment.documentId !== input.documentId ||
      segment.documentVersion !== input.documentVersion
    ) {
      throw new Error('Every segment must belong to the requested document version.');
    }
    if (segment.order !== index + 1) {
      throw new Error('Pre-split segments must be ordered contiguously.');
    }
  }
}

function hasCompleteEditorialFields(episode: EpisodePlanDraft): boolean {
  return [
    episode.title,
    episode.synopsis,
    episode.openingHook,
    episode.openingHookEvidence,
    episode.endingHook,
    episode.endingHookEvidence,
    episode.continuityIn,
    episode.continuityOut,
    episode.boundaryReason,
    episode.dramaticArc?.setup,
    episode.dramaticArc?.escalation,
    episode.dramaticArc?.turningPoint,
    episode.dramaticArc?.payoff
  ].every(nonEmpty);
}

function isConsecutive(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1]! + 1);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const EPISODE_SPLIT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    globalAnalysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        premise: { type: 'string' },
        centralConflict: { type: 'string' },
        mainCharacters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              goal: { type: 'string' },
              initialState: { type: 'string' }
            },
            required: ['name', 'role', 'goal', 'initialState']
          }
        },
        majorTurningPoints: { type: 'array', items: { type: 'string' } },
        continuityRisks: { type: 'array', items: { type: 'string' } }
      },
      required: [
        'premise',
        'centralConflict',
        'mainCharacters',
        'majorTurningPoints',
        'continuityRisks'
      ]
    },
    episodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          episodeNumber: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          sourceSegmentIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          sourceStart: { type: 'integer', minimum: 0 },
          sourceEnd: { type: 'integer', minimum: 1 },
          synopsis: { type: 'string' },
          openingHook: { type: 'string' },
          openingHookEvidence: { type: 'string' },
          endingHook: { type: 'string' },
          endingHookEvidence: { type: 'string' },
          targetDurationSec: { type: 'number', exclusiveMinimum: 0 },
          keyCharacters: { type: 'array', items: { type: 'string' } },
          dramaticArc: {
            type: 'object',
            additionalProperties: false,
            properties: {
              setup: { type: 'string' },
              escalation: { type: 'string' },
              turningPoint: { type: 'string' },
              payoff: { type: 'string' }
            },
            required: ['setup', 'escalation', 'turningPoint', 'payoff']
          },
          continuityIn: { type: 'string' },
          continuityOut: { type: 'string' },
          boundaryReason: { type: 'string' }
        },
        required: [
          'episodeNumber',
          'title',
          'sourceSegmentIds',
          'sourceStart',
          'sourceEnd',
          'synopsis',
          'openingHook',
          'openingHookEvidence',
          'endingHook',
          'endingHookEvidence',
          'targetDurationSec',
          'keyCharacters',
          'dramaticArc',
          'continuityIn',
          'continuityOut',
          'boundaryReason'
        ]
      }
    }
  },
  required: ['globalAnalysis', 'episodes']
};
