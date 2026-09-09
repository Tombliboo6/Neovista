import {
  OPTIONAL_STAGE_IDS,
  STAGE_DEPENDENCIES,
  STAGE_IDS,
  downstreamStages,
  type StageId
} from './stages.ts';

export const WORKFLOW_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type StageOutcomeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'review_required'
  | 'ready'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'stale'
  | 'skipped';

export type WorkflowIssueSeverity = 'warning' | 'blocking';
export type WorkflowIssueSource = 'schema' | 'fact' | 'policy' | 'provider' | 'runtime';
export type StageRecoveryActionType = 'inspect' | 'edit' | 'retry' | 'continue_partial' | 'skip' | 'revert';

export interface WorkflowIssue {
  code: string;
  severity: WorkflowIssueSeverity;
  source: WorkflowIssueSource;
  messageZh: string;
  suggestionZh?: string;
  field?: string;
}

export interface StageRecoveryAction {
  type: StageRecoveryActionType;
  labelZh: string;
  paid: boolean;
  targetKey?: string;
}

export interface StageOutcome {
  stageId: StageId;
  status: StageOutcomeStatus;
  revision: number;
  updatedAt: string;
  artifactCount: number;
  issues: WorkflowIssue[];
  recoveryActions: StageRecoveryAction[];
}

export type WorkflowEventKind = 'stage_status_changed' | 'stage_invalidated';

export interface WorkflowEvent {
  id: string;
  kind: WorkflowEventKind;
  stageId: StageId;
  fromStatus: StageOutcomeStatus;
  toStatus: StageOutcomeStatus;
  createdAt: string;
  summaryZh: string;
}

export interface WorkflowSnapshot {
  schemaVersion: typeof WORKFLOW_SNAPSHOT_SCHEMA_VERSION;
  revision: number;
  stages: Record<StageId, StageOutcome>;
  history: WorkflowEvent[];
  updatedAt: string;
}

export interface StagePolicy {
  stageId: StageId;
  dependencies: readonly StageId[];
  optional: boolean;
  partialAllowed: boolean;
  approvalRequired: boolean;
  maxAutomaticRepairAttempts: 0 | 1;
}

export const STAGE_POLICIES: Readonly<Record<StageId, StagePolicy>> = Object.freeze(
  Object.fromEntries(STAGE_IDS.map((stageId) => [stageId, {
    stageId,
    dependencies: STAGE_DEPENDENCIES[stageId],
    optional: OPTIONAL_STAGE_IDS.includes(stageId as (typeof OPTIONAL_STAGE_IDS)[number]),
    partialAllowed: ['character-images', 'scene-views', 'props', 'storyboard-images', 'video-prompts', 'shot-videos'].includes(stageId),
    approvalRequired: stageId !== 'intake',
    maxAutomaticRepairAttempts: ['character-profiles', 'scenes', 'props', 'storyboard-prompts', 'storyboard-images', 'video-prompts', 'music'].includes(stageId) ? 1 : 0,
  }])) as Record<StageId, StagePolicy>
);

export type WorkflowCommand =
  | { type: 'start'; stageId: StageId }
  | { type: 'submit_for_review'; stageId: StageId; artifactCount?: number; issues?: WorkflowIssue[] }
  | { type: 'approve'; stageId: StageId }
  | { type: 'fail'; stageId: StageId; issues: WorkflowIssue[]; artifactCount?: number }
  | { type: 'cancel'; stageId: StageId }
  | { type: 'skip'; stageId: StageId }
  | { type: 'change_upstream'; stageId: StageId };

export interface LegacyWorkflowProjectionInput {
  step?: unknown;
  ideaScript?: unknown;
  ideaError?: unknown;
  episodeScripts?: unknown;
  scriptApproval?: unknown;
  selectedStyleId?: unknown;
  characterStatus?: unknown;
  characterError?: unknown;
  characterProfiles?: unknown;
  characterApproval?: unknown;
  characterImageStatus?: unknown;
  characterTurnarounds?: unknown;
  characterImageError?: unknown;
  characterImages?: unknown;
  characterAssetsApproval?: unknown;
  sceneStatus?: unknown;
  sceneError?: unknown;
  sceneProposals?: unknown;
  sceneProposalApproval?: unknown;
  sceneImageStatus?: unknown;
  sceneImageError?: unknown;
  sceneImages?: unknown;
  sceneMainApproval?: unknown;
  sceneViews?: unknown;
  sceneAssetsApproval?: unknown;
  propStatus?: unknown;
  propError?: unknown;
  propProposals?: unknown;
  propProposalApproval?: unknown;
  propImageStatus?: unknown;
  propImageError?: unknown;
  propImages?: unknown;
  propAssetsApproval?: unknown;
  storyboardStatus?: unknown;
  storyboardError?: unknown;
  storyboardSegments?: unknown;
  storyboardApproval?: unknown;
  storyboardBoardStatus?: unknown;
  storyboardBoardError?: unknown;
  storyboardBoards?: unknown;
  storyboardAssetsApproval?: unknown;
  videoPromptStatus?: unknown;
  videoPromptError?: unknown;
  videoPrompts?: unknown;
  videoPromptsApproval?: unknown;
  shotVideoTasks?: unknown;
  shotVideosApproval?: unknown;
  postProduction?: unknown;
}

const RESOLVED_STATUSES = new Set<StageOutcomeStatus>(['ready', 'skipped']);
const ACTIVE_STATUSES = new Set(['queued', 'submitting', 'running']);
const COMPLETE_STATUSES = new Set(['complete', 'completed', 'awaiting_review']);
const FAILED_STATUSES = new Set(['failed', 'unqualified', 'needs_revision']);

export function createEmptyWorkflowSnapshot(now = new Date().toISOString()): WorkflowSnapshot {
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
    revision: 0,
    stages: Object.fromEntries(STAGE_IDS.map((stageId) => [stageId, createStageOutcome(stageId, 'idle', 0, now)])) as Record<StageId, StageOutcome>,
    history: [],
    updatedAt: now,
  };
}

export function deriveWorkflowSnapshot(
  legacy: LegacyWorkflowProjectionInput,
  previous?: WorkflowSnapshot,
  now = new Date().toISOString()
): WorkflowSnapshot {
  const sanitizedPrevious = previous ? sanitizeWorkflowSnapshot(previous, now) : createEmptyWorkflowSnapshot(now);
  const safePrevious = isUninitializedProject(legacy) && hasOnlySyntheticDefaultStyleActivity(sanitizedPrevious)
    ? createEmptyWorkflowSnapshot(now)
    : sanitizedPrevious;
  const projected = projectLegacyStages(legacy, now);
  const stages = {} as Record<StageId, StageOutcome>;
  const changes: WorkflowEvent[] = [];

  for (const stageId of STAGE_IDS) {
    const prior = safePrevious.stages[stageId];
    const next = projected[stageId];
    const changed = prior.status !== next.status || prior.artifactCount !== next.artifactCount || !sameIssues(prior.issues, next.issues);
    stages[stageId] = changed
      ? { ...next, revision: prior.revision + 1, updatedAt: now }
      : { ...next, revision: prior.revision, updatedAt: prior.updatedAt };
    if (prior.status !== next.status) changes.push(createWorkflowEvent(stageId, prior.status, next.status, now));
  }

  return {
    schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
    revision: safePrevious.revision + (changes.length > 0 ? 1 : 0),
    stages,
    history: [...safePrevious.history, ...changes].slice(-2_000),
    updatedAt: changes.length > 0 ? now : safePrevious.updatedAt,
  };
}

export function applyWorkflowCommand(
  snapshot: WorkflowSnapshot,
  command: WorkflowCommand,
  now = new Date().toISOString()
): WorkflowSnapshot {
  const current = sanitizeWorkflowSnapshot(snapshot, now);
  const target = current.stages[command.stageId];
  let nextStatus = target.status;
  let artifactCount = target.artifactCount;
  let issues = target.issues;

  if (command.type === 'start') {
    const unresolved = unresolvedDependencies(current, command.stageId);
    if (unresolved.length > 0) throw new WorkflowTransitionError('workflow_dependencies_unresolved', command.stageId, unresolved);
    nextStatus = 'running'; issues = [];
  } else if (command.type === 'submit_for_review') {
    if (!['running', 'partial', 'failed', 'review_required'].includes(target.status)) throw new WorkflowTransitionError('workflow_stage_not_running', command.stageId);
    artifactCount = Math.max(0, Math.floor(command.artifactCount ?? target.artifactCount));
    issues = uniqueIssues(command.issues ?? []);
    nextStatus = issues.some((item) => item.severity === 'blocking') ? (artifactCount > 0 ? 'partial' : 'blocked') : 'review_required';
  } else if (command.type === 'approve') {
    if (!['review_required', 'partial'].includes(target.status)) throw new WorkflowTransitionError('workflow_stage_not_reviewable', command.stageId);
    if (target.issues.some((item) => item.severity === 'blocking')) throw new WorkflowTransitionError('workflow_stage_has_blocking_issues', command.stageId);
    nextStatus = 'ready';
  } else if (command.type === 'fail') {
    artifactCount = Math.max(0, Math.floor(command.artifactCount ?? target.artifactCount));
    issues = uniqueIssues(command.issues);
    nextStatus = artifactCount > 0 && STAGE_POLICIES[command.stageId].partialAllowed ? 'partial' : 'failed';
  } else if (command.type === 'cancel') {
    if (!['queued', 'running'].includes(target.status)) throw new WorkflowTransitionError('workflow_stage_not_cancellable', command.stageId);
    nextStatus = 'cancelled';
  } else if (command.type === 'skip') {
    if (!STAGE_POLICIES[command.stageId].optional) throw new WorkflowTransitionError('workflow_stage_not_optional', command.stageId);
    nextStatus = 'skipped'; issues = [];
  }

  let stages = { ...current.stages, [command.stageId]: stageWithStatus(target, nextStatus, artifactCount, issues, now) };
  const events: WorkflowEvent[] = target.status === nextStatus ? [] : [createWorkflowEvent(command.stageId, target.status, nextStatus, now)];

  if (command.type === 'change_upstream') {
    stages = { ...current.stages };
    for (const stageId of downstreamStages(command.stageId)) {
      const stage = stages[stageId];
      if (!RESOLVED_STATUSES.has(stage.status) && stage.status !== 'review_required' && stage.status !== 'partial') continue;
      stages[stageId] = stageWithStatus(stage, 'stale', stage.artifactCount, stage.issues, now);
      events.push(createWorkflowEvent(stageId, stage.status, 'stale', now, 'stage_invalidated'));
    }
  }

  return {
    schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
    revision: current.revision + (events.length > 0 ? 1 : 0),
    stages,
    history: [...current.history, ...events].slice(-2_000),
    updatedAt: events.length > 0 ? now : current.updatedAt,
  };
}

export function unresolvedDependencies(snapshot: WorkflowSnapshot, stageId: StageId): StageId[] {
  return STAGE_DEPENDENCIES[stageId].filter((dependency) => !RESOLVED_STATUSES.has(snapshot.stages[dependency].status));
}

export function sanitizeWorkflowSnapshot(input: unknown, now = new Date().toISOString()): WorkflowSnapshot {
  if (!input || typeof input !== 'object') return createEmptyWorkflowSnapshot(now);
  const value = input as Partial<WorkflowSnapshot>;
  const rawStages = value.stages && typeof value.stages === 'object' ? value.stages : {} as Partial<Record<StageId, StageOutcome>>;
  const stages = {} as Record<StageId, StageOutcome>;
  for (const stageId of STAGE_IDS) {
    const raw = rawStages[stageId];
    const status = isStageOutcomeStatus(raw?.status) ? raw.status : 'idle';
    stages[stageId] = {
      stageId,
      status,
      revision: boundedInteger(raw?.revision, 0, 1_000_000),
      updatedAt: boundedText(raw?.updatedAt, 100) || now,
      artifactCount: boundedInteger(raw?.artifactCount, 0, 1_000_000),
      issues: Array.isArray(raw?.issues) ? raw.issues.slice(0, 100).map(sanitizeWorkflowIssue).filter((issue): issue is WorkflowIssue => Boolean(issue)) : [],
      recoveryActions: recoveryActionsFor(stageId, status, Array.isArray(raw?.issues) ? raw.issues.map(sanitizeWorkflowIssue).filter((issue): issue is WorkflowIssue => Boolean(issue)) : []),
    };
  }
  const history = Array.isArray(value.history) ? value.history.slice(-2_000).map(sanitizeWorkflowEvent).filter((event): event is WorkflowEvent => Boolean(event)) : [];
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_SCHEMA_VERSION,
    revision: boundedInteger(value.revision, 0, 1_000_000_000),
    stages,
    history,
    updatedAt: boundedText(value.updatedAt, 100) || now,
  };
}

export class WorkflowTransitionError extends Error {
  readonly code: string;
  readonly stageId: StageId;
  readonly dependencies: StageId[];

  constructor(code: string, stageId: StageId, dependencies: StageId[] = []) {
    super(workflowTransitionMessage(code, stageId, dependencies));
    this.name = 'WorkflowTransitionError';
    this.code = code;
    this.stageId = stageId;
    this.dependencies = dependencies;
  }
}

function projectLegacyStages(input: LegacyWorkflowProjectionInput, now: string): Record<StageId, StageOutcome> {
  const post = objectValue(input.postProduction);
  const roughCut = objectValue(post.roughCut);
  const musicPrompt = objectValue(post.musicPrompt);
  const music = objectValue(post.music);
  const finalComposition = objectValue(post.finalComposition);
  const shotTasks = arrayValue(input.shotVideoTasks);
  const profileCount = arrayValue(input.characterProfiles).length;
  const sceneProposalCount = arrayValue(input.sceneProposals).length;
  const propProposalCount = arrayValue(input.propProposals).length;
  const projectInitialized = !isUninitializedProject(input);
  const hasSelectedStyle = projectInitialized && Boolean(input.ideaScript) && typeof input.selectedStyleId === 'string' && Boolean(input.selectedStyleId.trim());

  const raw: Record<StageId, { status: StageOutcomeStatus; count?: number; error?: unknown }> = {
    intake: { status: input.step && input.step !== 'start' ? 'ready' : 'idle', count: input.step && input.step !== 'start' ? 1 : 0 },
    'episode-plan': { status: input.ideaScript || arrayValue(input.episodeScripts).length > 0 ? approvalStatus(input.scriptApproval) : 'idle', count: input.ideaScript ? 1 : arrayValue(input.episodeScripts).length },
    script: { status: input.ideaScript ? approvalStatus(input.scriptApproval) : input.ideaError ? 'failed' : 'idle', count: input.ideaScript ? 1 : 0, error: input.ideaError },
    'character-profiles': { status: aggregateStatus(input.characterStatus, input.characterApproval, profileCount), count: profileCount, error: input.characterError },
    'style-selection': { status: hasSelectedStyle ? 'ready' : 'idle', count: hasSelectedStyle ? 1 : 0 },
    'character-images': { status: aggregateStatus(arrayValue(input.characterTurnarounds).some(item => ACTIVE_STATUSES.has(String(objectValue(item).status))) ? 'running' : input.characterImageStatus, input.characterAssetsApproval, completedCount(input.characterImages)), count: completedCount(input.characterImages), error: input.characterImageError },
    scenes: { status: assetStageStatus(input.sceneStatus, input.sceneImageStatus, input.sceneProposalApproval, input.sceneMainApproval ?? input.sceneProposalApproval, sceneProposalCount, completedCount(input.sceneImages)), count: completedCount(input.sceneImages) || sceneProposalCount, error: input.sceneImageError || input.sceneError },
    'scene-views': { status: input.sceneAssetsApproval === 'approved' ? (arrayValue(input.sceneViews).length > 0 ? 'ready' : 'skipped') : aggregateItemStatus(input.sceneViews), count: completedCount(input.sceneViews) },
    props: { status: input.propAssetsApproval === 'approved' && propProposalCount === 0 ? 'skipped' : assetStageStatus(input.propStatus, input.propImageStatus, input.propProposalApproval, input.propAssetsApproval ?? input.propProposalApproval, propProposalCount, completedCount(input.propImages)), count: completedCount(input.propImages) || propProposalCount, error: input.propImageError || input.propError },
    'storyboard-prompts': { status: aggregateStatus(input.storyboardStatus, input.storyboardApproval, arrayValue(input.storyboardSegments).length), count: arrayValue(input.storyboardSegments).length, error: input.storyboardError },
    'storyboard-images': { status: aggregateStatus(input.storyboardBoardStatus, input.storyboardAssetsApproval, completedCount(input.storyboardBoards)), count: completedCount(input.storyboardBoards), error: input.storyboardBoardError },
    'video-prompts': { status: aggregateStatus(input.videoPromptStatus, input.videoPromptsApproval, completedCount(input.videoPrompts)), count: completedCount(input.videoPrompts), error: input.videoPromptError },
    'shot-videos': { status: input.shotVideosApproval === 'approved' ? 'ready' : aggregateItemStatus(shotTasks), count: shotTasks.filter((item) => item && typeof item === 'object' && COMPLETE_STATUSES.has(String((item as Record<string, unknown>).status))).length },
    music: { status: post.audioMode === 'native' ? 'skipped' : post.musicPromptApproval === 'approved' || COMPLETE_STATUSES.has(String(music.status)) ? 'ready' : aggregateItemStatus([musicPrompt, music]), count: COMPLETE_STATUSES.has(String(music.status)) ? 1 : 0, error: musicPrompt.error || music.error },
    composition: {
      status: post.roughCutApproval === 'approved' && post.audioMode === 'native' && post.subtitles === 'none'
        ? 'ready'
        : aggregateItemStatus([roughCut, finalComposition]),
      count: COMPLETE_STATUSES.has(String(finalComposition.status)) || (post.roughCutApproval === 'approved' && post.audioMode === 'native' && post.subtitles === 'none') ? 1 : 0,
      error: finalComposition.error || roughCut.error,
    },
  };

  return Object.fromEntries(STAGE_IDS.map((stageId) => {
    const projected = raw[stageId];
    const issues = legacyErrorIssue(projected.error);
    return [stageId, createStageOutcome(stageId, projected.status, projected.count ?? 0, now, issues ? [issues] : [])];
  })) as Record<StageId, StageOutcome>;
}

function isUninitializedProject(input: LegacyWorkflowProjectionInput): boolean {
  return !input.step || input.step === 'start';
}

function hasOnlySyntheticDefaultStyleActivity(snapshot: WorkflowSnapshot): boolean {
  const style = snapshot.stages['style-selection'];
  if (style.status !== 'ready' || style.artifactCount !== 1 || style.issues.length > 0) return false;
  if (snapshot.history.some((event) => event.stageId !== 'style-selection')) return false;
  return STAGE_IDS.every((stageId) => stageId === 'style-selection' || (
    snapshot.stages[stageId].status === 'idle'
    && snapshot.stages[stageId].artifactCount === 0
    && snapshot.stages[stageId].issues.length === 0
  ));
}

function createStageOutcome(stageId: StageId, status: StageOutcomeStatus, artifactCount: number, now: string, issues: WorkflowIssue[] = []): StageOutcome {
  return { stageId, status, revision: 0, updatedAt: now, artifactCount, issues, recoveryActions: recoveryActionsFor(stageId, status, issues) };
}

function stageWithStatus(stage: StageOutcome, status: StageOutcomeStatus, artifactCount: number, issues: WorkflowIssue[], now: string): StageOutcome {
  return { ...stage, status, artifactCount, issues: uniqueIssues(issues), recoveryActions: recoveryActionsFor(stage.stageId, status, issues), revision: stage.revision + 1, updatedAt: now };
}

function recoveryActionsFor(stageId: StageId, status: StageOutcomeStatus, issues: WorkflowIssue[]): StageRecoveryAction[] {
  const actions: StageRecoveryAction[] = [];
  if (issues.length > 0 || ['failed', 'blocked', 'partial'].includes(status)) actions.push({ type: 'inspect', labelZh: '查看问题与修改建议', paid: false });
  if (['review_required', 'partial', 'blocked', 'failed', 'stale'].includes(status)) actions.push({ type: 'edit', labelZh: '修改现有内容', paid: false });
  if (['failed', 'cancelled', 'blocked', 'partial'].includes(status)) actions.push({ type: 'retry', labelZh: '手动重试失败项', paid: true });
  if (status === 'partial' && STAGE_POLICIES[stageId].partialAllowed) actions.push({ type: 'continue_partial', labelZh: '保留成功项并继续', paid: false });
  if (STAGE_POLICIES[stageId].optional && ['idle', 'failed', 'blocked'].includes(status)) actions.push({ type: 'skip', labelZh: '跳过此可选环节', paid: false });
  if (['ready', 'review_required', 'partial', 'stale'].includes(status)) actions.push({ type: 'revert', labelZh: '回到上一版本', paid: false });
  return actions;
}

function approvalStatus(approval: unknown): StageOutcomeStatus {
  return approval === 'approved' ? 'ready' : 'review_required';
}

function assetStageStatus(designStatus: unknown, imageStatus: unknown, designApproval: unknown, imageApproval: unknown, designCount: number, imageCount: number): StageOutcomeStatus {
  const statuses = [imageStatus, designStatus].map(value => String(value ?? 'idle'));
  const rawStatus = statuses.find(status => ACTIVE_STATUSES.has(status)) ?? statuses.find(status => FAILED_STATUSES.has(status)) ?? statuses.find(status => status !== 'idle') ?? 'idle';
  const hasImageWork = statuses[0] !== 'idle' || imageCount > 0;
  return aggregateStatus(rawStatus, hasImageWork ? imageApproval : designApproval, imageCount || designCount);
}

function aggregateStatus(rawStatus: unknown, approval: unknown, artifactCount: number): StageOutcomeStatus {
  const status = String(rawStatus ?? 'idle');
  if (ACTIVE_STATUSES.has(status)) return 'running';
  if (FAILED_STATUSES.has(status)) return artifactCount > 0 ? 'partial' : 'failed';
  if (status === 'stale') return 'stale';
  if (status === 'cancelled') return 'cancelled';
  if (approval === 'approved') return 'ready';
  if (COMPLETE_STATUSES.has(status)) return artifactCount > 0 ? 'review_required' : 'blocked';
  return artifactCount > 0 ? 'review_required' : 'idle';
}

function aggregateItemStatus(value: unknown): StageOutcomeStatus {
  const items = arrayValue(value);
  if (items.length === 0) return 'idle';
  const statuses = items.map((item) => String(objectValue(item).status ?? 'idle'));
  if (statuses.some((status) => ACTIVE_STATUSES.has(status))) return 'running';
  const complete = statuses.filter((status) => COMPLETE_STATUSES.has(status)).length;
  const failed = statuses.filter((status) => FAILED_STATUSES.has(status)).length;
  if (complete === statuses.length) return 'review_required';
  if (complete > 0 && failed > 0) return 'partial';
  if (failed === statuses.length) return 'failed';
  return complete > 0 ? 'partial' : 'idle';
}

function completedCount(value: unknown): number {
  return arrayValue(value).filter((item) => COMPLETE_STATUSES.has(String(objectValue(item).status ?? 'complete'))).length;
}

function legacyErrorIssue(value: unknown): WorkflowIssue | null {
  const message = boundedText(value, 2_000);
  if (!message) return null;
  const [reason, suggestion] = message.split(/修改建议：/u, 2);
  return {
    code: 'legacy_stage_error',
    severity: 'blocking',
    source: /API|HTTP|网络|连接|超时/u.test(reason) ? 'provider' : 'runtime',
    messageZh: reason.trim(),
    ...(suggestion?.trim() ? { suggestionZh: suggestion.trim() } : { suggestionZh: '保留现有结果，查看失败项后修改或手动重试；系统不会自动再次提交。' }),
  };
}

function createWorkflowEvent(stageId: StageId, fromStatus: StageOutcomeStatus, toStatus: StageOutcomeStatus, createdAt: string, kind: WorkflowEventKind = 'stage_status_changed'): WorkflowEvent {
  return {
    id: `workflow-${stageId}-${createdAt}-${fromStatus}-${toStatus}`,
    kind,
    stageId,
    fromStatus,
    toStatus,
    createdAt,
    summaryZh: kind === 'stage_invalidated'
      ? `${stageLabel(stageId)}因上游内容变化而需要复核`
      : `${stageLabel(stageId)}：${statusLabel(fromStatus)} → ${statusLabel(toStatus)}`,
  };
}

function sanitizeWorkflowIssue(value: unknown): WorkflowIssue | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<WorkflowIssue>;
  const messageZh = boundedText(item.messageZh, 2_000);
  if (!messageZh) return null;
  return {
    code: boundedText(item.code, 200) || 'workflow_issue',
    severity: item.severity === 'warning' ? 'warning' : 'blocking',
    source: ['schema', 'fact', 'policy', 'provider', 'runtime'].includes(String(item.source)) ? item.source as WorkflowIssueSource : 'runtime',
    messageZh,
    ...(boundedText(item.suggestionZh, 2_000) ? { suggestionZh: boundedText(item.suggestionZh, 2_000) } : {}),
    ...(boundedText(item.field, 500) ? { field: boundedText(item.field, 500) } : {}),
  };
}

function sanitizeWorkflowEvent(value: unknown): WorkflowEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<WorkflowEvent>;
  if (!STAGE_IDS.includes(item.stageId as StageId) || !isStageOutcomeStatus(item.fromStatus) || !isStageOutcomeStatus(item.toStatus)) return null;
  const createdAt = boundedText(item.createdAt, 100);
  if (!createdAt) return null;
  return {
    id: boundedText(item.id, 500) || `workflow-${item.stageId}-${createdAt}`,
    kind: item.kind === 'stage_invalidated' ? 'stage_invalidated' : 'stage_status_changed',
    stageId: item.stageId as StageId,
    fromStatus: item.fromStatus,
    toStatus: item.toStatus,
    createdAt,
    summaryZh: boundedText(item.summaryZh, 1_000) || `${stageLabel(item.stageId as StageId)}状态已更新`,
  };
}

function isStageOutcomeStatus(value: unknown): value is StageOutcomeStatus {
  return ['idle', 'queued', 'running', 'review_required', 'ready', 'partial', 'blocked', 'failed', 'cancelled', 'stale', 'skipped'].includes(String(value));
}

function uniqueIssues(issues: WorkflowIssue[]): WorkflowIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.field ?? ''}:${issue.messageZh}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameIssues(left: WorkflowIssue[], right: WorkflowIssue[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum;
}

function stageLabel(stageId: StageId): string {
  return ({
    intake: '项目输入', 'episode-plan': '集数规划', script: '剧本', 'character-profiles': '角色设定', 'style-selection': '视觉风格',
    'character-images': '角色图片', scenes: '场景资产', 'scene-views': '场景多角度', props: '道具资产',
    'storyboard-prompts': '文字分镜', 'storyboard-images': '故事板分镜', 'video-prompts': '视频提示词',
    'shot-videos': '镜头视频', music: '配乐', composition: '最终合成',
  } satisfies Record<StageId, string>)[stageId];
}

function statusLabel(status: StageOutcomeStatus): string {
  return ({
    idle: '未开始', queued: '排队中', running: '生成中', review_required: '待确认', ready: '已确认', partial: '部分完成',
    blocked: '需要修改', failed: '失败', cancelled: '已取消', stale: '需要复核', skipped: '已跳过',
  } satisfies Record<StageOutcomeStatus, string>)[status];
}

function workflowTransitionMessage(code: string, stageId: StageId, dependencies: StageId[]): string {
  if (code === 'workflow_dependencies_unresolved') return `${stageLabel(stageId)}暂时不能开始，仍需先完成：${dependencies.map(stageLabel).join('、')}。`;
  if (code === 'workflow_stage_not_running') return `${stageLabel(stageId)}当前不在可提交状态。`;
  if (code === 'workflow_stage_not_reviewable') return `${stageLabel(stageId)}当前没有可确认的草稿。`;
  if (code === 'workflow_stage_has_blocking_issues') return `${stageLabel(stageId)}仍有必须处理的问题，不能确认。`;
  if (code === 'workflow_stage_not_cancellable') return `${stageLabel(stageId)}当前没有可取消的任务。`;
  if (code === 'workflow_stage_not_optional') return `${stageLabel(stageId)}是必要环节，不能跳过。`;
  return `${stageLabel(stageId)}状态转移无效。`;
}
