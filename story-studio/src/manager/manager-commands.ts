import { downstreamStages, type StageId } from '../workflow/stages.ts';
import type { ProjectManagerProviderImpact, ProjectManagerTurn } from './global-manager.ts';
import type { ProjectManagerArtifactRef, ProjectManagerContext } from './project-inspector.ts';

export type ProjectManagerCommandKind =
  | 'navigate'
  | 'retry_character_profiles'
  | 'retry_storyboard_segments'
  | 'revise_character_design'
  | 'revise_prop_design'
  | 'regenerate_character_image'
  | 'regenerate_scene_image'
  | 'regenerate_prop_image'
  | 'regenerate_storyboard_image'
  | 'regenerate_video_prompt'
  | 'remember_preference';

export type ProjectManagerCommandStatus = 'ready' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ProjectManagerFollowUpChoice = 'mainline' | 'sync_downstream';

export interface ProjectManagerCommand {
  id: string;
  kind: ProjectManagerCommandKind;
  stageId: StageId;
  summaryZh: string;
  status: ProjectManagerCommandStatus;
  requiresConfirmation: boolean;
  providerImpact: ProjectManagerProviderImpact;
  targetArtifact?: ProjectManagerArtifactRef;
  instructionZh?: string;
  preferenceText?: string;
  downstreamImpact: StageId[];
  createdAt: string;
  completedAt?: string;
  resultZh?: string;
  errorZh?: string;
  followUpChoice?: ProjectManagerFollowUpChoice;
}

export function compileProjectManagerCommands(
  turn: ProjectManagerTurn,
  context: ProjectManagerContext,
  createdAt = new Date().toISOString(),
): ProjectManagerCommand[] {
  const artifacts = new Map(context.artifacts.map((artifact) => [`${artifact.kind}:${artifact.id}`, artifact]));
  const boundTargets = turn.targetArtifacts.flatMap((artifact) => {
    const matched = artifacts.get(`${artifact.kind}:${artifact.id}`);
    return matched ? [matched] : [];
  });
  const commands: ProjectManagerCommand[] = [];
  const compiledCharacterRevisions = new Set<string>();
  const compiledPropRevisions = new Set<string>();
  const compiledCommands = new Set<string>();

  turn.proposedActions.forEach((action) => {
    if (action.actionType === 'inspect' || action.actionType === 'navigate') {
      const target = projectManagerNavigationTarget(action.stageId, boundTargets);
      commands.push(command('navigate', action.stageId, action.summaryZh, false, 'none', target, '', createdAt, commands.length));
      return;
    }
    if (action.actionType === 'remember_preference') {
      const preferenceText = action.preferenceText?.trim();
      if (preferenceText) commands.push(command('remember_preference', action.stageId, action.summaryZh, true, 'none', undefined, preferenceText, createdAt, commands.length));
      return;
    }
    if (!['edit_draft', 'regenerate'].includes(action.actionType)) return;

    const characterProfileStage = context.stages?.find((stage) => stage.stageId === 'character-profiles');
    if (action.stageId === 'character-profiles' && action.providerImpact === 'agent' && characterProfileStage?.status === 'failed') {
      const commandKey = 'retry_character_profiles:character-profiles';
      if (!compiledCommands.has(commandKey)) {
        commands.push(command('retry_character_profiles', 'character-profiles', '让 Agent 依据当前已确认剧本重新整理角色档案。', true, 'agent', undefined, '', createdAt, commands.length));
        compiledCommands.add(commandKey);
      }
      return;
    }

    const storyboardStage = context.stages?.find((stage) => stage.stageId === 'storyboard-prompts');
    if (action.stageId === 'storyboard-prompts' && action.providerImpact === 'agent' && storyboardStage?.status === 'failed') {
      const commandKey = 'retry_storyboard_segments:storyboard-prompts';
      if (!compiledCommands.has(commandKey)) {
        commands.push(command('retry_storyboard_segments', 'storyboard-prompts', '让 Agent 修复当前文字分镜，通过校验后写入项目。', true, 'agent', undefined, '', createdAt, commands.length));
        compiledCommands.add(commandKey);
      }
      return;
    }

    const candidates = boundTargets.filter((artifact) => commandKindFor(action.stageId, artifact, action.providerImpact));
    if (candidates.length === 0) return;
    const mentionedCandidates = candidates.filter((target) => actionMentionsTarget(action.summaryZh, target));
    const actionTargets = mentionedCandidates.length > 0 ? mentionedCandidates : candidates;
    actionTargets.forEach((target) => {
      const kind = commandKindFor(action.stageId, target, action.providerImpact);
      if (!kind) return;
      const commandKey = `${kind}:${target.kind}:${target.id}`;
      if (compiledCommands.has(commandKey)) return;
      if (kind === 'revise_character_design') {
        const revisionKey = `${target.kind}:${target.id}`;
        if (compiledCharacterRevisions.has(revisionKey)) return;
        compiledCharacterRevisions.add(revisionKey);
        const revisionActions = turn.proposedActions.filter((candidate) => candidate.actionType === 'edit_draft'
          && candidate.providerImpact === 'agent'
          && ['character-profiles', 'character-images'].includes(candidate.stageId)
          && (boundTargets.filter((artifact) => artifact.kind === 'character').length === 1 || actionMentionsTarget(candidate.summaryZh, target)));
        const instructionZh = (revisionActions.length ? revisionActions : [action]).map((candidate) => candidate.summaryZh.trim()).filter(Boolean).join('\n');
        const summaryZh = `修改${target.label || target.id}的人物设定与图片提示词。`;
        commands.push(command(kind, 'character-images', summaryZh, true, expectedProviderImpact(kind), target, '', createdAt, commands.length, instructionZh));
        compiledCommands.add(commandKey);
        return;
      }
      if (kind === 'revise_prop_design') {
        const revisionKey = `${target.kind}:${target.id}`;
        if (compiledPropRevisions.has(revisionKey)) return;
        compiledPropRevisions.add(revisionKey);
        const revisionActions = turn.proposedActions.filter((candidate) => candidate.actionType === 'edit_draft'
          && candidate.providerImpact === 'agent'
          && candidate.stageId === 'props'
          && (boundTargets.filter((artifact) => artifact.kind === 'prop').length === 1 || actionMentionsTarget(candidate.summaryZh, target)));
        const instructionZh = (revisionActions.length ? revisionActions : [action]).map((candidate) => candidate.summaryZh.trim()).filter(Boolean).join('\n');
        const summaryZh = `修改${target.label || target.id}的道具设定与图片提示词。`;
        commands.push(command(kind, 'props', summaryZh, true, expectedProviderImpact(kind), target, '', createdAt, commands.length, instructionZh));
        compiledCommands.add(commandKey);
        return;
      }
      commands.push(command(kind, action.stageId, action.summaryZh, true, expectedProviderImpact(kind), target, '', createdAt, commands.length, kind === 'regenerate_video_prompt' ? action.summaryZh.trim() : undefined));
      compiledCommands.add(commandKey);
    });
  });

  return commands.slice(0, 12);
}

export function projectManagerNavigationTarget(stageId: StageId, targets: ProjectManagerArtifactRef[]) {
  const kind = stageId === 'video-prompts' ? 'video-prompt'
    : ['storyboard-prompts', 'storyboard-images'].includes(stageId) ? 'storyboard'
      : ['character-profiles', 'style-selection', 'character-images'].includes(stageId) ? 'character'
        : ['scenes', 'scene-views'].includes(stageId) ? 'scene'
          : stageId === 'props' ? 'prop'
            : stageId === 'shot-videos' ? 'video'
              : stageId === 'music' ? 'music'
                : stageId === 'composition' ? 'composition'
                  : stageId === 'script' ? 'script'
                    : '';
  if (!kind) return undefined;
  const matches = targets.filter((target) => target.kind === kind);
  return matches.length === 1 ? matches[0] : undefined;
}

function command(
  kind: ProjectManagerCommandKind,
  stageId: StageId,
  summaryZh: string,
  requiresConfirmation: boolean,
  providerImpact: ProjectManagerProviderImpact,
  targetArtifact: ProjectManagerArtifactRef | undefined,
  preferenceText: string,
  createdAt: string,
  index: number,
  instructionZh = '',
): ProjectManagerCommand {
  return {
    id: `manager-command-${createdAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
    kind,
    stageId,
    summaryZh,
    status: requiresConfirmation ? 'awaiting_confirmation' : 'ready',
    requiresConfirmation,
    providerImpact,
    ...(targetArtifact ? { targetArtifact } : {}),
    ...(instructionZh ? { instructionZh } : {}),
    ...(preferenceText ? { preferenceText } : {}),
    downstreamImpact: downstreamStages(stageId),
    createdAt,
  };
}

function commandKindFor(stageId: StageId, target: ProjectManagerArtifactRef, providerImpact: ProjectManagerProviderImpact): ProjectManagerCommandKind | null {
  if (['character-profiles', 'character-images'].includes(stageId) && target.kind === 'character' && providerImpact === 'agent') return 'revise_character_design';
  if (stageId === 'props' && target.kind === 'prop' && providerImpact === 'agent') return 'revise_prop_design';
  if (stageId === 'character-images' && target.kind === 'character' && ['image', 'image-edit'].includes(providerImpact)) return 'regenerate_character_image';
  if (stageId === 'scenes' && target.kind === 'scene' && ['image', 'image-edit'].includes(providerImpact)) return 'regenerate_scene_image';
  if (stageId === 'props' && target.kind === 'prop' && ['image', 'image-edit'].includes(providerImpact)) return 'regenerate_prop_image';
  if (stageId === 'storyboard-images' && target.kind === 'storyboard' && ['image', 'image-edit'].includes(providerImpact)) return 'regenerate_storyboard_image';
  if (stageId === 'video-prompts' && ['storyboard', 'video-prompt'].includes(target.kind) && providerImpact === 'agent') return 'regenerate_video_prompt';
  return null;
}

function expectedProviderImpact(kind: ProjectManagerCommandKind): ProjectManagerProviderImpact {
  if (kind === 'retry_character_profiles' || kind === 'retry_storyboard_segments' || kind === 'revise_character_design' || kind === 'revise_prop_design') return 'agent';
  if (kind === 'regenerate_character_image' || kind === 'regenerate_scene_image' || kind === 'regenerate_prop_image') return 'image';
  if (kind === 'regenerate_storyboard_image') return 'image-edit';
  if (kind === 'regenerate_video_prompt') return 'agent';
  return 'none';
}

function actionMentionsTarget(summaryZh: string, target: ProjectManagerArtifactRef): boolean {
  const summary = summaryZh.toLocaleLowerCase('zh-CN');
  return [target.id, target.label].filter(Boolean).some((value) => summary.includes(value.toLocaleLowerCase('zh-CN')));
}

export function restoreProjectManagerCommands(
  turn: ProjectManagerTurn,
  existing: ProjectManagerCommand[] = [],
): ProjectManagerCommand[] {
  const compiled = compileProjectManagerCommandsFromArtifacts(turn, turn.targetArtifacts, new Date().toISOString());
  const unmatched = new Set(existing);
  const restored = compiled.map((candidate) => {
    const matched = existing.find((current) => commandSignature(current) === commandSignature(candidate));
    if (!matched) return candidate;
    unmatched.delete(matched);
    const restoredCommand = { ...candidate, ...matched, targetArtifact: matched.targetArtifact || candidate.targetArtifact, instructionZh: matched.instructionZh || candidate.instructionZh };
    if (restoredCommand.kind === 'regenerate_character_image' && restoredCommand.status === 'completed' && !restoredCommand.followUpChoice) {
      return { ...restoredCommand, resultZh: '新的角色图片已生成。可以保留更新返回主线，也可以检查并同步后续内容。' };
    }
    return restoredCommand;
  });
  return [...restored, ...unmatched].slice(0, 12);
}

function compileProjectManagerCommandsFromArtifacts(
  turn: ProjectManagerTurn,
  artifacts: ProjectManagerArtifactRef[],
  createdAt: string,
): ProjectManagerCommand[] {
  return compileProjectManagerCommands(turn, { artifacts } as ProjectManagerContext, createdAt);
}

function commandSignature(command: ProjectManagerCommand): string {
  return [command.kind, command.stageId, command.targetArtifact?.kind || '', command.targetArtifact?.id || '', command.preferenceText || ''].join(':');
}
