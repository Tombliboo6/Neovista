import type {
  EpisodePlan,
  NovelSegment,
  ScriptDraft,
  ScriptSceneDraft
} from '../domain/contracts.js';
import type {
  AgentGenerationResult,
  AgentProvider,
  AgentRequest
} from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export const SCRIPT_DRAFT_SCHEMA_NAME = 'prism_autodrama_episode_script_draft_v1';

export interface ScriptGenerationPreferences {
  language?: string;
  durationToleranceSec?: number;
  allowNarration?: boolean;
  requirements?: string[];
}

export interface ScriptGenerationInput {
  documentId: string;
  documentVersion: number;
  episode: EpisodePlan;
  segments: NovelSegment[];
  globalContext?: {
    premise: string;
    centralConflict: string;
    continuityRisks: string[];
  };
  preferences?: ScriptGenerationPreferences;
}

export class ScriptDraftValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Episode script draft failed validation: ${issues.join(' | ')}`);
    this.name = 'ScriptDraftValidationError';
    this.issues = issues;
  }
}

export function buildEpisodeScriptRequest(
  input: ScriptGenerationInput
): AgentRequest<ScriptGenerationInput> {
  validateScriptGenerationInput(input);

  return {
    operation: 'generate-episode-script',
    schemaName: SCRIPT_DRAFT_SCHEMA_NAME,
    instructions: [
      '你是专业短剧编剧，负责把已经审批的单集规划扩写成可继续拆分镜的完整剧本。',
      '只能使用本集 episode 与 segments 中已经发生的信息，不得引用下一集、未提供原文或自行补写新的事实、人物、道具、声音来源和因果结果。',
      '可以为影视表达压缩原文、把叙述转为表演或对白，但不能改变人物关系、行为动机、事件结果、信息差和 continuityIn/continuityOut。',
      '先按可表演的动作、对白、反应、停顿和转场规划场次与时长；estimatedDurationSec 必须等于全部场次 durationSec 之和，并接近 episode.targetDurationSec。',
      '每个输入 segment ID 必须且只能分配给一个场次，所有场次保持原文顺序并完整覆盖本集，不得遗漏、重复或倒序。',
      '每场 sourceStart/sourceEnd 必须对应其首尾 segment；sourceEvidence 至少包含一句从该场原文逐字复制的短句，用于证明核心内容来源。',
      '第一场必须承载 episode.openingHookEvidence 所在原文，最后一场必须承载 episode.endingHookEvidence 所在原文。',
      'sceneKey 使用 S01、S02 的连续格式，作为后续版本和分镜绑定的稳定场次键。',
      'dialogue.kind 只能为 dialogue、voiceover 或 internal_monologue；角色资产尚未生成，只填写 speakerName，不得编造 asset ID。',
      '遵守 preferences 中的语言、旁白开关和附加要求；当 allowNarration=false 时，只能使用 dialogue，不得输出 voiceover 或 internal_monologue。',
      'action 写可见动作、人物反应和必要环境变化；soundCues 只写原文有依据或动作必然产生的声音。当前阶段不要写镜头焦段、运镜或图片/视频生成提示词。',
      'openingHook、endingHook 要分别形成开场吸引点和集尾卡点，但必须忠于本集已经分配的原文。',
      '输出必须严格符合 JSON Schema，不要输出解释性文字。'
    ].join('\n'),
    input,
    outputSchema: SCRIPT_DRAFT_OUTPUT_SCHEMA,
    maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset
  };
}

export async function generateEpisodeScript(
  provider: AgentProvider,
  input: ScriptGenerationInput
): Promise<AgentGenerationResult<ScriptDraft>> {
  const result = await provider.generate<ScriptDraft>(buildEpisodeScriptRequest(input));
  validateEpisodeScriptDraft(result.output, input);
  return result;
}

export function validateEpisodeScriptDraft(
  draft: ScriptDraft,
  input: ScriptGenerationInput
): void {
  const issues: string[] = [];
  const segmentById = new Map(input.segments.map((segment) => [segment.id, segment]));
  const assignedSegmentIds: string[] = [];

  if (!hasCompleteScriptFields(draft)) {
    issues.push('script is missing required editorial fields');
  }
  if (!Array.isArray(draft.scenes) || draft.scenes.length === 0) {
    issues.push('at least one script scene is required');
  }

  for (let index = 0; index < draft.scenes.length; index += 1) {
    const scene = draft.scenes[index];
    if (!scene) continue;
    const expectedOrder = index + 1;
    const expectedKey = `S${String(expectedOrder).padStart(2, '0')}`;

    if (scene.order !== expectedOrder) {
      issues.push(`scene ${expectedOrder} has non-contiguous order`);
    }
    if (scene.sceneKey !== expectedKey) {
      issues.push(`scene ${expectedOrder} must use sceneKey ${expectedKey}`);
    }
    if (!hasCompleteSceneFields(scene)) {
      issues.push(`scene ${expectedOrder} is missing required fields`);
    }
    if (
      input.preferences?.allowNarration === false &&
      scene.dialogue.some((line) => line.kind !== 'dialogue')
    ) {
      issues.push(`scene ${expectedOrder} uses narration while allowNarration is false`);
    }
    if (!Array.isArray(scene.sourceSegmentIds) || scene.sourceSegmentIds.length === 0) {
      issues.push(`scene ${expectedOrder} has no source segments`);
      continue;
    }

    const sourceSegments = scene.sourceSegmentIds
      .map((id) => segmentById.get(id))
      .filter((segment): segment is NovelSegment => segment !== undefined);

    if (sourceSegments.length !== scene.sourceSegmentIds.length) {
      issues.push(`scene ${expectedOrder} references unknown source segments`);
      continue;
    }
    if (!isConsecutive(sourceSegments.map((segment) => segment.order))) {
      issues.push(`scene ${expectedOrder} source segments are not consecutive`);
    }
    if (scene.sourceStart !== sourceSegments[0]?.sourceStart) {
      issues.push(`scene ${expectedOrder} sourceStart does not match its first segment`);
    }
    if (scene.sourceEnd !== sourceSegments.at(-1)?.sourceEnd) {
      issues.push(`scene ${expectedOrder} sourceEnd does not match its last segment`);
    }

    const assignedText = sourceSegments.map((segment) => segment.text).join('');
    if (!Array.isArray(scene.sourceEvidence) || scene.sourceEvidence.length === 0) {
      issues.push(`scene ${expectedOrder} requires sourceEvidence`);
    } else if (scene.sourceEvidence.some((evidence) => !nonEmpty(evidence) || !assignedText.includes(evidence))) {
      issues.push(`scene ${expectedOrder} sourceEvidence is not in assigned source`);
    }

    assignedSegmentIds.push(...scene.sourceSegmentIds);
  }

  const expectedSegmentIds = input.segments.map((segment) => segment.id);
  if (assignedSegmentIds.join('\u0000') !== expectedSegmentIds.join('\u0000')) {
    issues.push('source segments are not covered exactly once in original order');
  }

  const firstSceneText = sourceTextForScene(draft.scenes[0], segmentById);
  if (!firstSceneText.includes(input.episode.openingHookEvidence)) {
    issues.push('first scene does not contain the approved opening hook evidence');
  }
  const lastSceneText = sourceTextForScene(draft.scenes.at(-1), segmentById);
  if (!lastSceneText.includes(input.episode.endingHookEvidence)) {
    issues.push('last scene does not contain the approved ending hook evidence');
  }

  const sceneDurationTotal = draft.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (Math.abs(sceneDurationTotal - draft.estimatedDurationSec) > 0.01) {
    issues.push('estimatedDurationSec must equal the sum of scene durations');
  }
  if (draft.targetDurationSec !== input.episode.targetDurationSec) {
    issues.push('targetDurationSec must match the approved episode plan');
  }
  const tolerance =
    input.preferences?.durationToleranceSec ??
    Math.max(10, Math.round(input.episode.targetDurationSec * 0.15));
  if (Math.abs(draft.estimatedDurationSec - input.episode.targetDurationSec) > tolerance) {
    issues.push(`estimatedDurationSec exceeds the allowed tolerance of ${tolerance} seconds`);
  }

  if (issues.length > 0) {
    throw new ScriptDraftValidationError(issues);
  }
}

function validateScriptGenerationInput(input: ScriptGenerationInput): void {
  if (input.episode.approval !== 'approved') {
    throw new Error('Episode plan must be approved before script generation.');
  }
  if (input.segments.length === 0) {
    throw new Error('Script generation requires at least one source segment.');
  }
  if (input.preferences?.durationToleranceSec !== undefined && input.preferences.durationToleranceSec < 0) {
    throw new Error('Duration tolerance must not be negative.');
  }

  const inputSegmentIds = input.segments.map((segment) => segment.id);
  if (inputSegmentIds.join('\u0000') !== input.episode.sourceSegmentIds.join('\u0000')) {
    throw new Error('Input segments must exactly match the approved episode source segments.');
  }

  for (let index = 0; index < input.segments.length; index += 1) {
    const segment = input.segments[index];
    if (!segment) continue;
    if (
      segment.documentId !== input.documentId ||
      segment.documentVersion !== input.documentVersion
    ) {
      throw new Error('Every script segment must belong to the requested document version.');
    }
    if (index > 0 && segment.order !== input.segments[index - 1]!.order + 1) {
      throw new Error('Script source segments must be ordered contiguously.');
    }
  }

  if (input.episode.sourceStart !== input.segments[0]?.sourceStart) {
    throw new Error('Episode sourceStart must match the first script segment.');
  }
  if (input.episode.sourceEnd !== input.segments.at(-1)?.sourceEnd) {
    throw new Error('Episode sourceEnd must match the last script segment.');
  }
}

function hasCompleteScriptFields(draft: ScriptDraft): boolean {
  return [
    draft.title,
    draft.logline,
    draft.synopsis,
    draft.openingHook,
    draft.endingHook,
    draft.continuityOut
  ].every(nonEmpty);
}

function hasCompleteSceneFields(scene: ScriptSceneDraft): boolean {
  if (
    ![
      scene.sceneKey,
      scene.heading,
      scene.location,
      scene.timeOfDay,
      scene.purpose,
      scene.action
    ].every(nonEmpty)
  ) {
    return false;
  }
  if (scene.durationSec <= 0) return false;
  if (!Array.isArray(scene.dialogue) || !Array.isArray(scene.soundCues)) return false;
  return scene.dialogue.every(
    (line) =>
      ['dialogue', 'voiceover', 'internal_monologue'].includes(line.kind) &&
      [line.speakerName, line.text, line.delivery].every(nonEmpty)
  );
}

function sourceTextForScene(
  scene: ScriptSceneDraft | undefined,
  segmentById: Map<string, NovelSegment>
): string {
  if (!scene || !Array.isArray(scene.sourceSegmentIds)) return '';
  return scene.sourceSegmentIds.map((id) => segmentById.get(id)?.text ?? '').join('');
}

function isConsecutive(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value === values[index - 1]! + 1);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const SCRIPT_DRAFT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    logline: { type: 'string' },
    synopsis: { type: 'string' },
    targetDurationSec: { type: 'number', exclusiveMinimum: 0 },
    estimatedDurationSec: { type: 'number', exclusiveMinimum: 0 },
    openingHook: { type: 'string' },
    endingHook: { type: 'string' },
    scenes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sceneKey: { type: 'string', pattern: '^S[0-9]{2,}$' },
          order: { type: 'integer', minimum: 1 },
          heading: { type: 'string' },
          location: { type: 'string' },
          timeOfDay: { type: 'string' },
          interiorExterior: { type: 'string', enum: ['interior', 'exterior', 'mixed'] },
          sourceSegmentIds: { type: 'array', minItems: 1, items: { type: 'string' } },
          sourceStart: { type: 'integer', minimum: 0 },
          sourceEnd: { type: 'integer', minimum: 1 },
          sourceEvidence: { type: 'array', minItems: 1, items: { type: 'string' } },
          purpose: { type: 'string' },
          durationSec: { type: 'number', exclusiveMinimum: 0 },
          action: { type: 'string' },
          dialogue: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: {
                  type: 'string',
                  enum: ['dialogue', 'voiceover', 'internal_monologue']
                },
                speakerName: { type: 'string' },
                text: { type: 'string' },
                delivery: { type: 'string' }
              },
              required: ['kind', 'speakerName', 'text', 'delivery']
            }
          },
          soundCues: { type: 'array', items: { type: 'string' } },
          transitionOut: {
            type: 'string',
            enum: ['cut', 'continuous', 'dissolve', 'fade_to_black']
          }
        },
        required: [
          'sceneKey',
          'order',
          'heading',
          'location',
          'timeOfDay',
          'interiorExterior',
          'sourceSegmentIds',
          'sourceStart',
          'sourceEnd',
          'sourceEvidence',
          'purpose',
          'durationSec',
          'action',
          'dialogue',
          'soundCues',
          'transitionOut'
        ]
      }
    },
    adaptationNotes: { type: 'array', items: { type: 'string' } },
    continuityOut: { type: 'string' }
  },
  required: [
    'title',
    'logline',
    'synopsis',
    'targetDurationSec',
    'estimatedDurationSec',
    'openingHook',
    'endingHook',
    'scenes',
    'adaptationNotes',
    'continuityOut'
  ]
};
