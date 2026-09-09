import type { IdeaScript } from '../ideas/idea-agent.js';
import { ideaScriptSchema } from '../ideas/idea-agent.ts';
import type { AgentProvider } from '../providers/contracts.js';
import { TEXT_TOKEN_BUDGETS } from '../providers/token-budgets.ts';

export async function reviseIdeaScript(
  provider: AgentProvider,
  input: { currentScript: IdeaScript; revisionRequest: string; sourceContext?: string }
): Promise<IdeaScript> {
  const revisionRequest = input.revisionRequest.trim();
  if (!revisionRequest || revisionRequest.length > 2_000) throw new Error('剧本修改意见长度无效。');
  if (!input.currentScript?.title || !Array.isArray(input.currentScript.scenes)) throw new Error('当前剧本无效。');

  const result = await provider.generate<IdeaScript>({
    operation: 'revise-approved-draft-script',
    schemaName: 'idea_script_revision_v1',
    maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft,
    instructions: [
      '你是PRISM AutoDrama的编剧导演。根据用户的明确修改意见修订当前剧本，并返回一份完整替换稿。',
      '只修改意见涉及的内容，保留已经成立的人物、因果、场景顺序与有效表达；不得把局部修改扩写成完全不同的故事。',
      '若提供sourceContext，人物、关系、关键事件与世界设定必须忠于该素材。',
      '保持当前剧本的workType、durationSec、ratio、language与emotion不变。',
      '场景blocks继续按实际发生顺序交织动作、对白、内心OS、音效与转场。',
      '只输出结构化的完整剧本，不解释修改过程。'
    ].join('\n'),
    input: {
      currentScript: input.currentScript,
      revisionRequest,
      sourceContext: input.sourceContext?.slice(0, 120_000) ?? ''
    },
    outputSchema: ideaScriptSchema
  });

  const revised = result.output;
  if (!revised?.title || !Array.isArray(revised.scenes) || revised.scenes.length === 0) throw new Error('文字Agent没有返回完整修订剧本。');
  const lockedValues = {
    workType: input.currentScript.workType ?? 'single',
    durationSec: input.currentScript.durationSec,
    ratio: input.currentScript.ratio,
    language: input.currentScript.language,
    emotion: input.currentScript.emotion,
  } as const;
  for (const field of ['workType', 'durationSec', 'ratio', 'language', 'emotion'] as const) {
    if (revised[field] !== lockedValues[field]) throw new Error(`文字Agent修改了锁定参数：${field}。`);
  }
  return revised;
}
