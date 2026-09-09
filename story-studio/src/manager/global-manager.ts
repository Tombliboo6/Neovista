import type { AgentProvider } from '../providers/contracts.ts';
import { STAGE_IDS, downstreamStages, type StageId } from '../workflow/stages.ts';
import type { ProjectManagerArtifactRef, ProjectManagerContext } from './project-inspector.ts';

export type ProjectManagerIntent = 'status' | 'diagnose' | 'change_plan' | 'explain';
export type ProjectManagerActionType = 'inspect' | 'navigate' | 'edit_draft' | 'review' | 'regenerate' | 'remember_preference';
export type ProjectManagerProviderImpact = 'none' | 'agent' | 'image' | 'image-edit' | 'h3' | 'music';

export interface ProjectManagerConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ProjectManagerProposedAction {
  order: number;
  stageId: StageId;
  actionType: ProjectManagerActionType;
  summaryZh: string;
  requiresConfirmation: boolean;
  providerImpact: ProjectManagerProviderImpact;
  preferenceText: string;
}

export interface ProjectManagerTurn {
  mode: 'command_plan';
  replyZh: string;
  intent: ProjectManagerIntent;
  diagnosisZh: string;
  targetStages: StageId[];
  targetArtifacts: ProjectManagerArtifactRef[];
  proposedActions: ProjectManagerProposedAction[];
  downstreamImpact: StageId[];
  projectChanged: false;
  providerCallsStarted: false;
}

export async function runProjectManagerTurn(
  provider: AgentProvider,
  input: {
    message: string;
    history?: ProjectManagerConversationMessage[];
    context: ProjectManagerContext;
  },
  options: { maxOutputTokens?: number } = {},
): Promise<ProjectManagerTurn> {
  const message = validateMessage(input.message);
  const history = sanitizeHistory(input.history);
  const result = await provider.generate<Omit<ProjectManagerTurn, 'mode' | 'projectChanged' | 'providerCallsStarted'>>({
    operation: 'project-manager-command-turn',
    schemaName: 'project_manager_command_turn',
    maxOutputTokens: options.maxOutputTokens ?? 16_000,
    instructions: [
      '你是PRISM Story Studio的全局项目总管，兼具制片人、总导演与技术协调能力。',
      '视频生成方式支持本机H3、MiniMax与Seedance。videoGeneration中的selectedEngine只控制未来提交，tasks.engine与model才是已有任务的服务身份；诊断云端任务时不要声称本机H3正在生成。submission_unknown表示接单情况未明，只建议核实服务商任务号；download_failed只补下载原结果，不能建议自动重新生成。',
      '你可以读取项目并生成可执行的白名单命令。用户本轮已明确要求修改或写入时，系统会立即执行文字修复；不得回答“当前只读”或虚假声称尚未执行的动作已完成。',
      '先从工作流阶段、问题、恢复动作和项目实体中定位问题源头，再区分表面结果与真正需要修改的上游环节。',
      '工作流issues中的失败步骤、影响范围、HTTP状态、错误代码、请求ID、模型和阶段边界属于系统事实。诊断失败时必须优先引用这些事实；不得把“画格规划与图片提示词”的文字请求失败说成图片生成失败，也不得在没有字段证据时猜测是某个SEG内容、提示词校验或图片服务造成。',
      '如果issues明确说明媒体生成尚未开始，必须直接告诉用户当前失败只发生在文字阶段；如果只有upstream_error，应说明上游没有正常返回，但不能虚构更具体的服务器原因。',
      '如果issues包含自动恢复次数或恢复记录，必须说明系统已经使用相同设置完成有限恢复；不得把恢复过程说成更换模型、改写提示词或图片生成。',
      '用户提到人物、场景、道具或镜头时，优先绑定上下文中真实存在的稳定ID；无法唯一定位时明确指出缺少的信息。',
      'storyboardReferenceBindings是分镜顺序、宫格结果、画面可见道具、已绑定参考图和缺失参考的权威对应表。“第一张/第二张宫格图”按order直接定位，不得让用户再手动查SEG。',
      '当missingPreparedReferences非空时，直接说明具体SEG漏用了哪个道具ID与名称；不要再提出查看道具设定、查SEG、核对文字分镜等多步排查。只提出该SEG一个regenerate动作，summaryZh写成“修复SEG对道具的参考绑定，并使用当前提示词重新生成宫格图”。该动作确认后会先同步当前参考绑定再提交一次图片生成。',
      '当同一问题已有唯一根因和唯一可执行修复时，只保留一个主动作；不要把诊断过程拆成多个inspect或navigate选项。',
      '人物文字设定与角色图片提示词是两个不同修改面：查看年龄、身份、外貌、体态、服装等人物档案时使用character-profiles；查看或修改生图提示词时使用character-images。',
      '用户明确要求修改人物年龄、形象或角色图片提示词时，必须提出providerImpact为agent的edit_draft动作，不能只给inspect、navigate或图片regenerate。若人物设定和图片提示词都要同步，依次列出两个edit_draft，最后再把图片regenerate作为独立后续动作。',
      '当character-profiles阶段已经失败且项目中没有可修改的角色档案时，针对character-profiles提出providerImpact为agent的regenerate动作，让系统重新整理整个角色档案；不得声称已准备局部修改，也不得要求用户提供不存在的角色ID。',
      '当storyboard-prompts阶段失败且用户要求修复、修改或写入时，必须提出providerImpact为agent的regenerate动作。该命令只重新整理文字分镜并写入，不会生成图片或视频，不得只提出inspect或navigate。',
      '用户明确要求修改道具设定、外观、颜色、Logo位置或道具图片提示词时，必须针对每个真实道具ID提出providerImpact为agent的edit_draft动作，summaryZh必须同时写明道具ID和具体修改内容，不能只给inspect、navigate或图片regenerate。用户还要求更新图片时，再为每个道具追加独立regenerate动作。',
      'Logo的具体图案或文字尚未提供时，不得让整个修改停住：在edit_draft里明确预留Logo区域及已知位置、颜色和材质关系，确切Logo内容继续保持可编辑。',
      'proposedActions按实际执行顺序列出。纯查看和导航的providerImpact为none；文字草稿修改为agent；媒体重新生成为对应provider。',
      '所有edit_draft、review和regenerate动作都必须标记requiresConfirmation=true。系统会把用户本轮明确的“帮我改”“直接修改”视为对文字修改的授权并立即执行；媒体生成仍由独立命令控制。你负责给出准确的结构化动作，不得要求用户在对话中重复确认。',
      '只有用户明确说“记住”“以后默认”或同义表达时，才可提出remember_preference；preferenceText只写用户明确表达的项目内偏好，并必须确认。其他动作的preferenceText固定为空字符串。',
      'downstreamImpact只列修改目标之后会受影响的阶段，不得虚构已经发生的失效。',
      '用户明确说“帮我改”“直接修改”“重试修改”或同义表达时，replyZh直接说明已定位修改目标并开始执行；不要再要求确认，不要重复建议“先修改”，不要再次索要已经说过的信息。只输出结构化结果。',
    ].join('\n'),
    input: {
      message,
      recentConversation: history,
      projectContext: input.context,
    },
    outputSchema: projectManagerTurnSchema,
  });

  return normalizeTurn(result.output, input.context, message);
}

const projectManagerTurnSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    replyZh: { type: 'string', minLength: 1, maxLength: 4_000 },
    intent: { type: 'string', enum: ['status', 'diagnose', 'change_plan', 'explain'] },
    diagnosisZh: { type: 'string', minLength: 1, maxLength: 4_000 },
    targetStages: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', enum: STAGE_IDS } },
    targetArtifacts: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['script', 'character', 'scene', 'prop', 'storyboard', 'video-prompt', 'video', 'music', 'composition'] },
          id: { type: 'string' }, label: { type: 'string' }, stageId: { type: 'string', enum: STAGE_IDS }, status: { type: 'string' },
        },
        required: ['kind', 'id', 'label', 'stageId', 'status'],
      },
    },
    proposedActions: {
      type: 'array', maxItems: 12, items: {
        type: 'object', additionalProperties: false,
        properties: {
          order: { type: 'integer', minimum: 1, maximum: 12 },
          stageId: { type: 'string', enum: STAGE_IDS },
          actionType: { type: 'string', enum: ['inspect', 'navigate', 'edit_draft', 'review', 'regenerate', 'remember_preference'] },
          summaryZh: { type: 'string', minLength: 1, maxLength: 1_000 },
          requiresConfirmation: { type: 'boolean' },
          providerImpact: { type: 'string', enum: ['none', 'agent', 'image', 'image-edit', 'h3', 'music'] },
          preferenceText: { type: 'string', maxLength: 1_000 },
        },
        required: ['order', 'stageId', 'actionType', 'summaryZh', 'requiresConfirmation', 'providerImpact', 'preferenceText'],
      },
    },
    downstreamImpact: { type: 'array', maxItems: 15, uniqueItems: true, items: { type: 'string', enum: STAGE_IDS } },
  },
  required: ['replyZh', 'intent', 'diagnosisZh', 'targetStages', 'targetArtifacts', 'proposedActions', 'downstreamImpact'],
} as const;

function normalizeTurn(value: Omit<ProjectManagerTurn, 'mode' | 'projectChanged' | 'providerCallsStarted'>, context: ProjectManagerContext, message: string): ProjectManagerTurn {
  const targetStages = uniqueStages(value.targetStages);
  const artifactIndex = new Map(context.artifacts.map((artifact) => [`${artifact.kind}:${artifact.id}`, artifact]));
  const targetArtifacts = (Array.isArray(value.targetArtifacts) ? value.targetArtifacts : []).flatMap((artifact) => {
    const matched = artifactIndex.get(`${artifact.kind}:${artifact.id}`);
    return matched ? [matched] : [];
  }).slice(0, 20);
  let proposedActions = (Array.isArray(value.proposedActions) ? value.proposedActions : []).flatMap((action, index) => {
    if (!STAGE_IDS.includes(action.stageId) || !['inspect', 'navigate', 'edit_draft', 'review', 'regenerate', 'remember_preference'].includes(action.actionType)) return [];
    const changesState = ['edit_draft', 'review', 'regenerate', 'remember_preference'].includes(action.actionType);
    const providerImpact = ['none', 'agent', 'image', 'image-edit', 'h3', 'music'].includes(action.providerImpact) ? action.providerImpact : 'none';
    return [{
      order: index + 1,
      stageId: action.stageId,
      actionType: action.actionType,
      summaryZh: String(action.summaryZh || '').trim().slice(0, 1_000),
      requiresConfirmation: changesState || action.requiresConfirmation === true,
      providerImpact,
      preferenceText: typeof action.preferenceText === 'string' ? action.preferenceText.trim().slice(0, 1_000) : '',
    }];
  }).filter((action) => action.summaryZh).slice(0, 12);
  const storyboardStageFailed = context.stages.some((stage) => stage.stageId === 'storyboard-prompts' && stage.status === 'failed');
  const explicitStoryboardRepair = storyboardStageFailed
    && /(?:修改|修复|写入|处理|改好|重新整理)/u.test(message)
    && !/(?:为什么|怎么回事|在修复了吗|修好了吗|修复了吗)/u.test(message);
  if (explicitStoryboardRepair) {
    proposedActions = [{
      order: 1,
      stageId: 'storyboard-prompts',
      actionType: 'regenerate',
      summaryZh: '修复当前文字分镜的对白、说话人和时间顺序问题，校验通过后写入项目。',
      requiresConfirmation: true,
      providerImpact: 'agent',
      preferenceText: '',
    }];
  }
  const targetedStoryboardKeys = new Set(targetArtifacts.filter((artifact) => artifact.kind === 'storyboard').map((artifact) => artifact.id));
  const missingBinding = context.storyboardReferenceBindings.find((binding) => targetedStoryboardKeys.has(binding.segmentKey) && binding.missingPreparedReferences.length > 0);
  if (missingBinding) {
    const missingLabel = missingBinding.missingPreparedReferences.map((prop) => `${prop.propAssetKey}「${prop.propName}」`).join('、');
    proposedActions = [{
      order: 1,
      stageId: 'storyboard-images',
      actionType: 'regenerate',
      summaryZh: `修复 ${missingBinding.segmentKey} 对 ${missingLabel} 的参考绑定，并使用当前提示词重新生成${missingBinding.panelCount || ''}宫格图。`,
      requiresConfirmation: true,
      providerImpact: 'image-edit',
      preferenceText: '',
    }];
  } else {
    const storyboardRegenerations = proposedActions.filter((action) => action.stageId === 'storyboard-images' && action.actionType === 'regenerate');
    if (targetedStoryboardKeys.size === 1 && storyboardRegenerations.length === 1) {
      proposedActions = proposedActions.filter((action) => action === storyboardRegenerations[0]
        || !['storyboard-prompts', 'storyboard-images'].includes(action.stageId)
        || !['inspect', 'navigate'].includes(action.actionType));
      proposedActions = proposedActions.map((action, index) => ({ ...action, order: index + 1 }));
    }
  }
  const allowedDownstream = new Set(targetStages.flatMap((stageId) => downstreamStages(stageId)));
  const downstreamImpact = uniqueStages(value.downstreamImpact).filter((stageId) => allowedDownstream.has(stageId));

  return {
    mode: 'command_plan',
    replyZh: missingBinding
      ? `问题已定位：${missingBinding.segmentKey}「${missingBinding.title}」的当前分镜参考漏用了${missingBinding.missingPreparedReferences.map((prop) => `${prop.propAssetKey}「${prop.propName}」`).join('、')}。下方只保留一个修复并重新生成操作。`
      : String(value.replyZh || '').trim().slice(0, 4_000),
    intent: ['status', 'diagnose', 'change_plan', 'explain'].includes(value.intent) ? value.intent : 'explain',
    diagnosisZh: missingBinding
      ? `${missingBinding.segmentKey}的画面规划包含${missingBinding.missingPreparedReferences.map((prop) => prop.propName).join('、')}，但当前参考绑定不完整。`
      : String(value.diagnosisZh || '').trim().slice(0, 4_000),
    targetStages,
    targetArtifacts,
    proposedActions,
    downstreamImpact,
    projectChanged: false,
    providerCallsStarted: false,
  };
}

function validateMessage(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2_000) throw new Error('总管消息必须是1至2000个字符。');
  return value.trim();
}

function sanitizeHistory(value: unknown): ProjectManagerConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, 4_000) : '';
    return role && text ? [{ role, text }] : [];
  });
}

function uniqueStages(value: unknown): StageId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((stageId): stageId is StageId => STAGE_IDS.includes(stageId as StageId)))];
}
