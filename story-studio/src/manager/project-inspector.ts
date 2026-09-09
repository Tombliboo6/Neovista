import { STAGE_IDS, downstreamStages, type StageId } from '../workflow/stages.ts';
import { currentWorkflowStage } from '../workflow/view-model.ts';
import type { WorkflowSnapshot } from '../workflow/runtime.ts';

export interface ProjectManagerArtifactRef {
  kind: 'script' | 'character' | 'scene' | 'prop' | 'storyboard' | 'video-prompt' | 'video' | 'music' | 'composition';
  id: string;
  label: string;
  stageId: StageId;
  status: string;
}

export interface ProjectManagerStageSummary {
  stageId: StageId;
  status: string;
  artifactCount: number;
  issues: Array<{
    code: string;
    severity: string;
    messageZh: string;
    suggestionZh: string;
  }>;
  recoveryActions: Array<{
    type: string;
    labelZh: string;
    paid: boolean;
    targetKey: string;
  }>;
}

export interface ProjectManagerContext {
  project: {
    id: string;
    name: string;
    workType: string;
    creativeDirection: string;
    duration: string;
    ratio: string;
    language: string;
    emotion: string;
  };
  currentStageId: StageId;
  activeWorkspaceSection: string;
  stages: ProjectManagerStageSummary[];
  artifacts: ProjectManagerArtifactRef[];
  storyboardReferenceBindings: ProjectManagerStoryboardReferenceBinding[];
  storyboardDiagnostics: { issues: string[]; hasRecoverableDraft: boolean };
  videoGeneration?: { selectedEngine: string; profileId: string; tasks: Array<{ segmentKey: string; engine: string; model: string; status: string; phase: string; remoteTaskId: string }> };
  projectPreferences: Array<{ id: string; text: string; createdAt: string }>;
  downstreamByStage: Record<StageId, StageId[]>;
  safety: {
    mode: 'allowlisted_commands';
    projectMutationAllowed: true;
    providerSubmissionAllowed: 'explicit_user_command_only';
    noteZh: string;
  };
}

export interface ProjectManagerStoryboardReferenceBinding {
  order: number;
  segmentKey: string;
  title: string;
  panelCount: number;
  boardStatus: string;
  visiblePreparedProps: Array<{ propAssetKey: string; propName: string }>;
  requiredPropReferences: Array<{ propAssetKey: string; propName: string }>;
  generatedPropReferences: Array<{ propAssetKey: string; propName: string }>;
  promptReferenceLabels: string[];
  missingPreparedReferences: Array<{ propAssetKey: string; propName: string; missingFrom: Array<'plan' | 'prompt' | 'generated_board'> }>;
  status: 'aligned' | 'missing_prepared_reference';
}

type UnknownRecord = Record<string, unknown>;

export function buildProjectManagerContext(session: unknown): ProjectManagerContext {
  const envelope = objectValue(session);
  const state = objectValue(envelope.state);
  const workflow = workflowValue(envelope.workflow);
  const stages = STAGE_IDS.map((stageId) => summarizeStage(workflow, stageId));
  const artifacts = collectArtifacts(state);
  let storyboardDraft: any = {};
  try { storyboardDraft = JSON.parse(textValue(state.storyboardRejectedDraft, '{}')); } catch { /* Report unavailable drafts explicitly. */ }

  return {
    project: {
      id: textValue(envelope.id, 'unsaved-project'),
      name: textValue(state.projectName, textValue(objectValue(state.ideaScript).title, '未命名项目')),
      workType: textValue(state.workType, 'single'),
      creativeDirection: textValue(state.creativeDirection, 'story'),
      duration: textValue(state.duration, ''),
      ratio: textValue(state.ratio, ''),
      language: textValue(state.language, ''),
      emotion: textValue(state.customEmotion, textValue(state.emotion, '')),
    },
    currentStageId: currentWorkflowStage(workflow),
    activeWorkspaceSection: textValue(state.activeStage, '总览'),
    stages,
    artifacts,
    videoGeneration: {
      selectedEngine: textValue(objectValue(state.h3GenerationSettings).engine, 'local'),
      profileId: textValue(objectValue(state.h3GenerationSettings).profileId, ''),
      tasks: (Array.isArray(state.shotVideoTasks) ? state.shotVideoTasks : []).slice(0, 200).map(candidate => {
        const task = objectValue(candidate); const parameters = objectValue(task.parameters);
        return { segmentKey: textValue(task.segmentKey, ''), engine: textValue(parameters.videoEngine, 'local'), model: textValue(parameters.model, ''), status: textValue(task.status, ''), phase: textValue(parameters.phase, ''), remoteTaskId: textValue(parameters.remoteTaskId, textValue(task.externalTaskId, '')) };
      }),
    },
    storyboardReferenceBindings: collectStoryboardReferenceBindings(state),
    storyboardDiagnostics: {
      issues: (Array.isArray(state.storyboardRejectedIssues) ? state.storyboardRejectedIssues : []).filter((value): value is string => typeof value === 'string').slice(0, 20),
      hasRecoverableDraft: Boolean(storyboardDraft?.outline?.length || storyboardDraft?.segments?.length),
    },
    projectPreferences: Array.isArray(objectValue(state.managerMemory).explicitPreferences)
      ? (objectValue(state.managerMemory).explicitPreferences as unknown[]).slice(-50).flatMap((candidate) => {
        const item = objectValue(candidate);
        const text = textValue(item.text, '');
        return text ? [{ id: textValue(item.id, text), text, createdAt: textValue(item.createdAt, '') }] : [];
      })
      : [],
    downstreamByStage: Object.fromEntries(STAGE_IDS.map((stageId) => [stageId, downstreamStages(stageId)])) as Record<StageId, StageId[]>,
    safety: {
      mode: 'allowlisted_commands',
      projectMutationAllowed: true,
      providerSubmissionAllowed: 'explicit_user_command_only',
      noteZh: '总管可在用户明确要求修改时直接执行白名单命令并写入项目；媒体生成仍使用独立的明确提交。',
    },
  };
}

function collectStoryboardReferenceBindings(state: UnknownRecord): ProjectManagerStoryboardReferenceBinding[] {
  const proposals = Array.isArray(state.propProposals) ? state.propProposals.map(objectValue) : [];
  const preparedPropKeys = new Set((Array.isArray(state.propImages) ? state.propImages : []).flatMap((candidate) => {
    const item = objectValue(candidate);
    const key = textValue(item.propAssetKey, '');
    return key && textValue(item.status, '') === 'complete' && textValue(item.imageUrl, '') ? [key] : [];
  }));
  const propByName = new Map<string, { propAssetKey: string; propName: string }>();
  proposals.forEach((proposal) => {
    const propAssetKey = textValue(proposal.propAssetKey, '');
    const propName = textValue(proposal.name, propAssetKey);
    if (!propAssetKey || !preparedPropKeys.has(propAssetKey)) return;
    [propName, ...(Array.isArray(proposal.aliases) ? proposal.aliases : [])].forEach((candidate) => {
      const name = typeof candidate === 'string' ? candidate.trim() : '';
      if (name) propByName.set(name, { propAssetKey, propName });
    });
  });
  const plans = new Map((Array.isArray(state.storyboardBoardPlans) ? state.storyboardBoardPlans : []).map((candidate) => {
    const item = objectValue(candidate);
    return [textValue(item.segmentKey, ''), objectValue(item.plan)] as const;
  }).filter(([key]) => key));
  const prompts = new Map((Array.isArray(state.storyboardBoardPrompts) ? state.storyboardBoardPrompts : []).map((candidate) => {
    const item = objectValue(candidate);
    return [textValue(item.segmentKey, ''), item] as const;
  }).filter(([key]) => key));
  const boards = new Map((Array.isArray(state.storyboardBoards) ? state.storyboardBoards : []).map((candidate) => {
    const item = objectValue(candidate);
    return [textValue(item.segmentKey, ''), item] as const;
  }).filter(([key]) => key));

  return (Array.isArray(state.storyboardSegments) ? state.storyboardSegments : []).slice(0, 200).map((candidate, index) => {
    const segment = objectValue(candidate);
    const segmentKey = textValue(segment.segmentKey, `SEG${String(index + 1).padStart(3, '0')}`);
    const plan = plans.get(segmentKey) ?? {};
    const semanticDecision = objectValue(plan.semanticDecision);
    const visibleNames = uniqueText([
      ...(Array.isArray(semanticDecision.visibleProps) ? semanticDecision.visibleProps.map((item) => textValue(objectValue(item).propName, '')) : []),
      ...(Array.isArray(plan.panels) ? plan.panels.flatMap((panel) => {
        const visibleProps = objectValue(panel).visibleProps;
        return Array.isArray(visibleProps) ? visibleProps : [];
      }) : []),
    ]);
    const visiblePreparedProps = uniqueProps(visibleNames.flatMap((name) => propByName.get(name) ? [propByName.get(name)!] : []));
    const requirements = objectValue(plan.referenceRequirements);
    const requiredNames = Array.isArray(requirements.props) ? requirements.props.map((item) => textValue(objectValue(item).propName, '')) : [];
    const requiredPropReferences = uniqueProps(requiredNames.flatMap((name) => propByName.get(name) ? [propByName.get(name)!] : []));
    const storedPrompt = prompts.get(segmentKey);
    const prompt = textValue(storedPrompt?.prompt, '');
    const promptReferenceLabels = prompt.match(/^参考图：(.*)$/mu)?.[1]
      ?.split('、').map((item) => item.trim()).filter(Boolean) ?? [];
    const board = objectValue(boards.get(segmentKey));
    const generatedReferenceIds = Array.isArray(board.referenceAssetIds) ? board.referenceAssetIds.flatMap((value) => typeof value === 'string' ? [value] : []) : [];
    const locallyRepairedPropNames = Array.isArray(storedPrompt?.referenceBindingAddedProps)
      ? storedPrompt.referenceBindingAddedProps.flatMap((value) => typeof value === 'string' ? [value] : [])
      : [];
    const generatedPropReferences = uniqueProps(proposals.flatMap((proposal) => {
      const propAssetKey = textValue(proposal.propAssetKey, '');
      const propName = textValue(proposal.name, propAssetKey);
      return generatedReferenceIds.includes(`web-storyboard-prop-${propAssetKey.toLowerCase()}-dormant`) ? [{ propAssetKey, propName }] : [];
    }));
    const missingPreparedReferences = visiblePreparedProps.flatMap((prop) => {
      const missingFrom: Array<'plan' | 'prompt' | 'generated_board'> = [];
      if (!requiredPropReferences.some((item) => item.propAssetKey === prop.propAssetKey)) missingFrom.push('plan');
      if (!promptReferenceLabels.some((label) => label === prop.propName || label.includes(prop.propName))) missingFrom.push('prompt');
      if ((generatedReferenceIds.length > 0 && !generatedPropReferences.some((item) => item.propAssetKey === prop.propAssetKey))
        || textValue(board.status, '') === 'complete' && locallyRepairedPropNames.includes(prop.propName)) missingFrom.push('generated_board');
      return missingFrom.length ? [{ ...prop, missingFrom }] : [];
    });
    return {
      order: Math.max(1, Number(segment.order) || index + 1),
      segmentKey,
      title: textValue(segment.title, segmentKey),
      panelCount: Math.max(0, Number(plan.panelCount) || Number(prompts.get(segmentKey)?.panelCount) || Number(objectValue(boards.get(segmentKey)).panelCount) || 0),
      boardStatus: textValue(board.status, 'idle'),
      visiblePreparedProps,
      requiredPropReferences,
      generatedPropReferences,
      promptReferenceLabels,
      missingPreparedReferences,
      status: missingPreparedReferences.length ? 'missing_prepared_reference' as const : 'aligned' as const,
    };
  });
}

function uniqueText(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))];
}

function uniqueProps(values: Array<{ propAssetKey: string; propName: string }>) {
  return [...new Map(values.map((value) => [value.propAssetKey, value])).values()];
}

export function getProjectOverview(context: ProjectManagerContext) {
  return {
    project: context.project,
    currentStageId: context.currentStageId,
    activeWorkspaceSection: context.activeWorkspaceSection,
    stageStatusCounts: Object.fromEntries([...new Set(context.stages.map((stage) => stage.status))].map((status) => [status, context.stages.filter((stage) => stage.status === status).length])),
    blockingIssues: context.stages.flatMap((stage) => stage.issues.filter((issue) => issue.severity === 'blocking').map((issue) => ({ stageId: stage.stageId, ...issue }))),
    artifactCount: context.artifacts.length,
    safety: context.safety,
  };
}

export function getWorkflowStatus(context: ProjectManagerContext) {
  return context.stages;
}

export function getStageDetails(context: ProjectManagerContext, stageId: StageId) {
  const stage = context.stages.find((candidate) => candidate.stageId === stageId);
  if (!stage) return null;
  return {
    ...stage,
    artifacts: context.artifacts.filter((artifact) => artifact.stageId === stageId),
    downstreamStages: context.downstreamByStage[stageId],
  };
}

export function searchProjectArtifacts(context: ProjectManagerContext, query: string) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return [];
  return context.artifacts.filter((artifact) => `${artifact.id}\n${artifact.label}\n${artifact.kind}`.toLocaleLowerCase('zh-CN').includes(normalized));
}

function summarizeStage(workflow: WorkflowSnapshot, stageId: StageId): ProjectManagerStageSummary {
  const stage = workflow.stages[stageId];
  return {
    stageId,
    status: stage.status,
    artifactCount: stage.artifactCount,
    issues: stage.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      messageZh: issue.messageZh,
      suggestionZh: issue.suggestionZh ?? '',
    })),
    recoveryActions: stage.recoveryActions.map((action) => ({
      type: action.type,
      labelZh: action.labelZh,
      paid: action.paid,
      targetKey: action.targetKey ?? '',
    })),
  };
}

function collectArtifacts(state: UnknownRecord): ProjectManagerArtifactRef[] {
  const artifacts: ProjectManagerArtifactRef[] = [];
  const script = objectValue(state.ideaScript);
  if (Object.keys(script).length > 0) artifacts.push({ kind: 'script', id: textValue(script.id, 'SCRIPT'), label: textValue(script.title, '剧本'), stageId: 'script', status: textValue(state.scriptApproval, 'draft') });

  pushArrayArtifacts(artifacts, state.characterProfiles, 'character', 'character-profiles', ['profileKey', 'id'], ['name'], 'complete');
  pushArrayArtifacts(artifacts, state.sceneProposals, 'scene', 'scenes', ['sceneAssetKey', 'id'], ['name'], textValue(state.sceneProposalApproval, 'draft'));
  pushArrayArtifacts(artifacts, state.propProposals, 'prop', 'props', ['propAssetKey', 'id'], ['name'], textValue(state.propProposalApproval, 'draft'));
  pushArrayArtifacts(artifacts, state.storyboardSegments, 'storyboard', 'storyboard-prompts', ['segmentKey', 'id'], ['title'], textValue(state.storyboardApproval, 'draft'));
  pushArrayArtifacts(artifacts, state.videoPrompts, 'video-prompt', 'video-prompts', ['segmentKey', 'id'], ['title', 'segmentKey'], textValue(state.videoPromptsApproval, 'draft'));
  pushArrayArtifacts(artifacts, state.shotVideoTasks, 'video', 'shot-videos', ['segmentKey', 'externalTaskId'], ['segmentKey'], 'idle');

  const post = objectValue(state.postProduction);
  const music = objectValue(post.music);
  if (Object.keys(music).length > 0) artifacts.push({ kind: 'music', id: textValue(music.externalTaskId, 'MUSIC'), label: textValue(music.filename, '配乐'), stageId: 'music', status: textValue(music.status, 'idle') });
  const composition = objectValue(post.finalComposition);
  if (Object.keys(composition).length > 0) artifacts.push({ kind: 'composition', id: textValue(composition.filename, 'COMPOSITION'), label: textValue(composition.filename, '最终成片'), stageId: 'composition', status: textValue(composition.status, 'idle') });
  return artifacts.slice(0, 500);
}

function pushArrayArtifacts(
  target: ProjectManagerArtifactRef[],
  value: unknown,
  kind: ProjectManagerArtifactRef['kind'],
  stageId: StageId,
  idFields: string[],
  labelFields: string[],
  fallbackStatus: string,
) {
  if (!Array.isArray(value)) return;
  value.slice(0, 200).forEach((candidate, index) => {
    const item = objectValue(candidate);
    const id = firstText(item, idFields, `${stageId}-${index + 1}`);
    const label = firstText(item, labelFields, id);
    target.push({ kind, id, label, stageId, status: textValue(item.status, fallbackStatus) });
  });
}

function firstText(value: UnknownRecord, fields: string[], fallback: string) {
  for (const field of fields) {
    const result = textValue(value[field], '');
    if (result) return result;
  }
  return fallback;
}

function workflowValue(value: unknown): WorkflowSnapshot {
  const candidate = objectValue(value) as Partial<WorkflowSnapshot>;
  if (candidate.stages && STAGE_IDS.every((stageId) => candidate.stages?.[stageId])) return candidate as WorkflowSnapshot;
  throw new Error('当前项目没有可供总管读取的工作流快照。');
}

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function textValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
