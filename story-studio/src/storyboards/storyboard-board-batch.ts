import type { AgentGenerationResult, AgentProvider, AgentRequest } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import {
  buildStoryboardBoardPlanRequest,
  normalizeStoryboardBoardPlan,
  validateStoryboardBoardPlan,
  type StoryboardBoardPlan,
  type StoryboardBoardPlanInput
} from './storyboard-board-generation.ts';

export interface StoryboardBoardBatchItem {
  segmentKey: string;
  plan: StoryboardBoardPlan;
  validationWarnings?: string[];
}

export interface StoryboardBoardBatchOutput {
  items: StoryboardBoardBatchItem[];
}

export interface StoryboardBoardBatchPartialResult extends AgentGenerationResult<StoryboardBoardBatchOutput> {
  validationErrors: Array<{ segmentKey: string; message: string }>;
}

export function buildStoryboardBoardBatchRequest(inputs: StoryboardBoardPlanInput[]): AgentRequest {
  if (inputs.length === 0) throw new Error('Storyboard board batch requires at least one segment.');
  const requests = inputs.map((input) => buildStoryboardBoardPlanRequest(input));
  const segmentKeys = inputs.map((input) => input.segment.segmentKey);
  if (new Set(segmentKeys).size !== segmentKeys.length) throw new Error('Storyboard board batch segment keys must be unique.');
  return {
    operation: 'plan-storyboard-board-panels-batch',
    schemaName: 'prism_autodrama_storyboard_board_batch_v3',
    maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction,
    instructions: [
      '必须生成最终答案，最终答案只能是一个完整可解析的JSON对象；不得只输出推理过程、分析、说明文字或空正文。顶层必须使用items数组并严格符合JSON Schema。',
      `一次处理${inputs.length}个独立分镜，按各自durationSec和输入顺序分别生成故事板画格规划与完整五段式隐藏生图提示词。`,
      `必须按顺序返回${segmentKeys.join('、')}，每段只能出现一次，不得合并或遗漏。`,
      '每段都必须独立完成语义判断、按各自panelCount连续规划并生成对应宫格图片提示词；不得把前一段人物、道具或场景状态机械带入后一段。',
      '相邻段可使用continuityContext保持空间轴线与状态衔接，但不能提前展示下一段事件。',
      requests[0].instructions
    ].join('\n'),
    input: {
      segments: requests.map((request) => request.input)
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          minItems: inputs.length,
          maxItems: inputs.length,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              segmentKey: { type: 'string', enum: segmentKeys },
              plan: requests[0].outputSchema
            },
            required: ['segmentKey', 'plan']
          }
        }
      },
      required: ['items']
    }
  };
}

export function validateStoryboardBoardBatch(
  output: StoryboardBoardBatchOutput,
  inputs: StoryboardBoardPlanInput[]
): void {
  if (!Array.isArray(output.items) || output.items.length !== inputs.length) {
    throw new Error(`Storyboard board batch expected ${inputs.length} items.`);
  }
  output.items.forEach((item, index) => {
    const input = inputs[index];
    if (!item || typeof item !== 'object' || item.segmentKey !== input.segment.segmentKey) {
      throw new Error(`Storyboard board batch item ${index + 1} must be ${input.segment.segmentKey}.`);
    }
    try {
      item.validationWarnings = validateStoryboardBoardPlan(item.plan, input.segment.durationSec, input.panelCount ?? 3, input.allowedReferenceContext);
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^Storyboard board plan validation failed:\s*/i, '') : 'unknown plan error';
      throw new Error(`Storyboard board batch ${input.segment.segmentKey} validation failed: ${detail}`);
    }
  });
}

export async function generateStoryboardBoardBatch(
  provider: AgentProvider,
  inputs: StoryboardBoardPlanInput[]
): Promise<AgentGenerationResult<StoryboardBoardBatchOutput>> {
  const result = await provider.generate<StoryboardBoardBatchOutput>(buildStoryboardBoardBatchRequest(inputs));
  const output = Array.isArray(result.output?.items)
    ? {
        ...result.output,
        items: result.output.items.map((item, index) => ({
          ...item,
          plan: normalizeStoryboardBoardPlan(item.plan, inputs[index])
        }))
      }
    : result.output;
  validateStoryboardBoardBatch(output, inputs);
  return { ...result, output };
}

export async function generateStoryboardBoardBatchPartial(
  provider: AgentProvider,
  inputs: StoryboardBoardPlanInput[]
): Promise<StoryboardBoardBatchPartialResult> {
  const result = await provider.generate<StoryboardBoardBatchOutput>(buildStoryboardBoardBatchRequest(inputs));
  const accepted = acceptStoryboardBoardBatchPartial(result.output, inputs);
  return { ...result, ...accepted };
}

export function acceptStoryboardBoardBatchPartial(
  output: StoryboardBoardBatchOutput,
  inputs: StoryboardBoardPlanInput[]
): Pick<StoryboardBoardBatchPartialResult, 'output' | 'validationErrors'> {
  if (!Array.isArray(output?.items)) throw new Error(`Storyboard board batch expected ${inputs.length} items.`);
  const candidates = new Map<string, StoryboardBoardBatchItem>();
  for (const item of output.items) {
    if (item && typeof item === 'object' && typeof item.segmentKey === 'string' && !candidates.has(item.segmentKey)) candidates.set(item.segmentKey, item);
  }
  const items: StoryboardBoardBatchItem[] = [];
  const validationErrors: Array<{ segmentKey: string; message: string }> = [];
  for (const input of inputs) {
    const segmentKey = input.segment.segmentKey;
    const candidate = candidates.get(segmentKey);
    if (!candidate) {
      validationErrors.push({ segmentKey, message: `Storyboard board batch ${segmentKey} validation failed: missing batch item` });
      continue;
    }
    const item = { ...candidate, plan: normalizeStoryboardBoardPlan(candidate.plan, input) };
    try {
      const validationWarnings = validateStoryboardBoardPlan(item.plan, input.segment.durationSec, input.panelCount ?? 3, input.allowedReferenceContext);
      items.push({ ...item, validationWarnings });
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^Storyboard board plan validation failed:\s*/i, '') : 'unknown plan error';
      validationErrors.push({ segmentKey, message: `Storyboard board batch ${segmentKey} validation failed: ${detail}` });
    }
  }
  return { output: { items }, validationErrors };
}
