import type { AgentProvider, AgentRequest } from './contracts.js';

/** One generation includes a bounded editorial pass; it does not schedule another call. */
export const CREATIVE_SELF_REVIEW = [
  '创作与交付自检：在本次生成内完成起草和一次自检，直接交付可用正文，不输出思维过程。',
  '结合完整输入判断人物、物体、环境、镜头和声音的真实关系。静态画面与光影变化可以直接描述状态；动作主体允许自然指代，不要求逐句重复名称。',
  '自主选择有助于表达的镜头、节奏、段落、措辞与信息密度。上游规划中的建议时间、镜头组、动作标签和状态措辞可按本段实际执行需要调整；保留用户确认的剧情事实、逐字对白、人物身份、实际参考绑定与目标时长。',
  '自检只处理会改变结果的矛盾、遗漏、因果顺序、空间关系和不可执行动作。发现问题就在原稿对应位置修订，保留已正确内容；不为满足固定词句、固定节拍数或抽象完美标准重写。',
  '用户提出局部修改时，以当前草稿和修改要求为依据。上游已确认事实若存在无法自行解决的冲突，在已有说明字段引用具体输入并提出建议，交由用户决定；不得伪造素材、审批、任务完成状态或外部执行权限。',
].join('\n');

export function withCreativeSelfReview(request: AgentRequest): AgentRequest {
  if (!/^(?:generate-|plan-|repair-|design-|adapt-|extract-character-)/u.test(request.operation)
    || request.instructions.includes(CREATIVE_SELF_REVIEW)) return request;
  return { ...request, instructions: `${request.instructions}\n${CREATIVE_SELF_REVIEW}` };
}

export function selfReviewingAgent(provider: AgentProvider): AgentProvider {
  return {
    id: provider.id,
    health: () => provider.health(),
    generate: (request) => provider.generate(withCreativeSelfReview(request)),
  };
}
