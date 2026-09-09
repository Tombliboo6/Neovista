import type { AgentGenerationResult, AgentProvider, AgentRequest } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';
import type { StoryboardBoardPlan } from './storyboard-board-generation.js';

export interface StoryboardReferenceRequirement {
  characters: string[];
  sceneRequired: boolean;
  props: Array<{ propName: string; state: string }>;
  decisionBasis: string[];
}

export interface StoryboardReferenceRequirementItem {
  segmentKey: string;
  requirements: StoryboardReferenceRequirement;
}

export interface StoryboardReferenceRequirementOutput {
  items: StoryboardReferenceRequirementItem[];
}

export interface StoryboardReferenceRequirementInput {
  segmentKey: string;
  storyboardText: string;
  semanticDecision: StoryboardBoardPlan['semanticDecision'];
  approvedOptions: {
    characters: string[];
    sceneAssetKey: string;
    props: Array<{ propName: string; state: string }>;
  };
}

export function buildStoryboardReferenceRequirementRequest(
  inputs: StoryboardReferenceRequirementInput[]
): AgentRequest {
  if (inputs.length === 0) throw new Error('Reference requirement request needs at least one segment.');
  const keys = inputs.map((item) => item.segmentKey);
  return {
    operation: 'decide-storyboard-reference-requirements',
    schemaName: 'prism_autodrama_storyboard_reference_requirements_v1',
    maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction,
    instructions: [
      '只判断每个故事板生图任务需要上传哪些参考资产，不重写分镜、不生成提示词、不修改semanticDecision。',
      `必须按输入顺序返回${keys.join('、')}，不得遗漏、合并或改名。`,
      'characters只能从本段可见人物与批准人物选项中选择；需要身份一致的人物才列入。',
      'sceneRequired表示是否需要上传批准场景参考；故事发生在持续地点且需要空间一致时通常为true。',
      'props只选择需要锁定身份或状态的批准关键剧情道具。雨水、泥浆、血液、烟尘、碎屑、光线等临时可见物即使出现在visibleProps中，也不要求独立参考图。',
      '不得输出资产ID、版本、文件名、路径或不存在于approvedOptions的选项。只输出简洁决定依据。'
    ].join('\n'),
    input: { segments: inputs },
    outputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        items: {
          type: 'array', minItems: inputs.length, maxItems: inputs.length,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              segmentKey: { type: 'string', enum: keys },
              requirements: {
                type: 'object', additionalProperties: false,
                properties: {
                  characters: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                  sceneRequired: { type: 'boolean' },
                  props: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { propName: { type: 'string' }, state: { type: 'string' } }, required: ['propName', 'state'] } },
                  decisionBasis: { type: 'array', minItems: 1, items: { type: 'string' } }
                },
                required: ['characters', 'sceneRequired', 'props', 'decisionBasis']
              }
            },
            required: ['segmentKey', 'requirements']
          }
        }
      },
      required: ['items']
    }
  };
}

export function validateStoryboardReferenceRequirements(
  output: StoryboardReferenceRequirementOutput,
  inputs: StoryboardReferenceRequirementInput[]
): void {
  const issues: string[] = [];
  if (!Array.isArray(output.items) || output.items.length !== inputs.length) throw new Error(`Expected ${inputs.length} reference requirement items.`);
  output.items.forEach((item, index) => {
    const input = inputs[index];
    if (item.segmentKey !== input.segmentKey) issues.push(`item ${index + 1} must be ${input.segmentKey}`);
    for (const name of item.requirements.characters) {
      if (!input.semanticDecision.visibleCharacters.includes(name) || !input.approvedOptions.characters.includes(name)) issues.push(`${item.segmentKey} invalid character ${name}`);
    }
    for (const prop of item.requirements.props) {
      if (!input.semanticDecision.visibleProps.some((visible) => visible.propName === prop.propName)) issues.push(`${item.segmentKey} reference prop ${prop.propName} is not visible`);
      if (!input.approvedOptions.props.some((option) => option.propName === prop.propName && option.state === prop.state)) issues.push(`${item.segmentKey} reference prop ${prop.propName}:${prop.state} is not approved`);
    }
  });
  if (issues.length) throw new Error(`Storyboard reference requirement validation failed: ${issues.join('; ')}`);
}

export async function generateStoryboardReferenceRequirements(
  provider: AgentProvider,
  inputs: StoryboardReferenceRequirementInput[]
): Promise<AgentGenerationResult<StoryboardReferenceRequirementOutput>> {
  const result = await provider.generate<StoryboardReferenceRequirementOutput>(buildStoryboardReferenceRequirementRequest(inputs));
  validateStoryboardReferenceRequirements(result.output, inputs);
  return result;
}
