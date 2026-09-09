import type { StageId } from './stages.ts';
import type { StageOutcome, StageOutcomeStatus, WorkflowSnapshot } from './runtime.ts';

export type StageTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export interface StageViewModel {
  stageId: StageId;
  labelZh: string;
  statusLabelZh: string;
  summaryZh: string;
  tone: StageTone;
  artifactCount: number;
  isBusy: boolean;
  isResolved: boolean;
  issues: StageOutcome['issues'];
  recoveryActions: StageOutcome['recoveryActions'];
}

const STAGE_LABELS: Readonly<Record<StageId, string>> = Object.freeze({
  intake: '项目设定',
  'episode-plan': '集数规划',
  script: '剧本',
  'character-profiles': '角色设定',
  'style-selection': '画风选择',
  'character-images': '角色图片',
  scenes: '场景资产',
  'scene-views': '场景多角度',
  props: '道具资产',
  'storyboard-prompts': '文字分镜',
  'storyboard-images': '故事板图片',
  'video-prompts': '视频提示词',
  'shot-videos': '分段视频',
  music: '配乐',
  composition: '最终合成',
});

const STATUS_PRESENTATION: Readonly<Record<StageOutcomeStatus, { label: string; summary: string; tone: StageTone }>> = Object.freeze({
  idle: { label: '未开始', summary: '尚未开始', tone: 'neutral' },
  queued: { label: '排队中', summary: '已进入队列', tone: 'active' },
  running: { label: '处理中', summary: '正在处理', tone: 'active' },
  review_required: { label: '待确认', summary: '结果已返回，等待确认', tone: 'warning' },
  ready: { label: '已确认', summary: '结果已确认', tone: 'success' },
  partial: { label: '部分完成', summary: '部分完成，成功结果已保留', tone: 'warning' },
  blocked: { label: '需要修改', summary: '结果需要修改后再继续', tone: 'danger' },
  failed: { label: '未完成', summary: '本次未完成，已有结果已保留', tone: 'danger' },
  cancelled: { label: '已取消', summary: '任务已取消', tone: 'neutral' },
  stale: { label: '需要复核', summary: '上游内容已变化，需要复核', tone: 'warning' },
  skipped: { label: '已跳过', summary: '此可选环节已跳过', tone: 'success' },
});

export function stageLabelZh(stageId: StageId): string {
  return STAGE_LABELS[stageId];
}

export function toStageViewModel(outcome: StageOutcome): StageViewModel {
  const presentation = STATUS_PRESENTATION[outcome.status];
  const issueSummary = outcome.issues[0]?.messageZh?.trim();
  return {
    stageId: outcome.stageId,
    labelZh: STAGE_LABELS[outcome.stageId],
    statusLabelZh: presentation.label,
    summaryZh: issueSummary || `${STAGE_LABELS[outcome.stageId]}${presentation.summary}`,
    tone: presentation.tone,
    artifactCount: outcome.artifactCount,
    isBusy: outcome.status === 'queued' || outcome.status === 'running',
    isResolved: outcome.status === 'ready' || outcome.status === 'skipped',
    issues: outcome.issues,
    recoveryActions: outcome.recoveryActions,
  };
}

export type WorkspaceSection = '总览' | '剧本' | '角色' | '场景' | '道具' | '分镜' | '视频';

export function stageForWorkspaceSection(section: WorkspaceSection, snapshot: WorkflowSnapshot): StageId {
  if (section === '总览') return currentWorkflowStage(snapshot);
  if (section === '剧本') return 'script';
  if (section === '角色') return snapshot.stages['character-profiles'].status === 'ready' ? 'character-images' : 'character-profiles';
  if (section === '场景') return snapshot.stages.scenes.status === 'ready' && snapshot.stages['scene-views'].status !== 'skipped' ? 'scene-views' : 'scenes';
  if (section === '道具') return 'props';
  if (section === '分镜') return snapshot.stages['storyboard-prompts'].status === 'ready' ? 'storyboard-images' : 'storyboard-prompts';
  return snapshot.stages['video-prompts'].status === 'ready' ? 'shot-videos' : 'video-prompts';
}

export function currentWorkflowStage(snapshot: WorkflowSnapshot): StageId {
  const outcomes = Object.values(snapshot.stages);
  return outcomes.find((stage) => stage.status === 'running' || stage.status === 'queued')?.stageId
    ?? outcomes.find((stage) => stage.status === 'partial' || stage.status === 'blocked' || stage.status === 'failed' || stage.status === 'stale')?.stageId
    ?? outcomes.find((stage) => stage.status === 'review_required')?.stageId
    ?? [...outcomes].reverse().find((stage) => stage.status === 'ready')?.stageId
    ?? [...outcomes].reverse().find((stage) => stage.status === 'skipped')?.stageId
    ?? 'intake';
}
