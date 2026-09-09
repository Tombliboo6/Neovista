import { mergeCharacterProfiles } from './character-profile-merge.ts';
import { changedStoryboardImageKeys } from '../../src/videos/storyboard-video-references.ts';

export const PRODUCTION_ROUTES = [
  '/api/characters/profiles', '/api/scenes/proposals', '/api/props/proposals',
  '/api/storyboards/segments', '/api/storyboards/board-plans', '/api/storyboards/boards',
  '/api/videos/prompts', '/api/videos/prompts/repair',
] as const;

export function productionSource(state: Record<string, any>, route: string, sourceVersion = 2): string {
  const assetStage = assetProductionStage(route);
  // Version 1 sessions omitted this flag on disk. Preserve that signature only
  // for the equivalent false state; a deliberate skip must still invalidate it.
  const sceneAssetsSkipped = sourceVersion === 1 && !state.sceneAssetsSkipped ? undefined : Boolean(state.sceneAssetsSkipped);
  const base = assetStage ? [state.ideaScript, ...(assetStage === 'character' ? [] : [state.selectedStyleId, state.characterProfiles])]
    : [state.ideaScript, state.selectedStyleId, state.generationPreset, state.characterProfiles, state.characterImages, sceneAssetsSkipped, state.sceneProposals, state.sceneImages, state.propProposals, state.propImages, state.storyboardSegmentDurationSec];
  if (!assetStage && route !== '/api/storyboards/segments') base.push(state.storyboardSegments, state.storyboardBoardPanelCount);
  if (route.startsWith('/api/videos/')) base.push(state.storyboardBoardPlans, state.storyboardBoards);
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && !['approval', 'queueState', 'error', 'updatedAt', 'previousVersions'].includes(key)).map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(base));
}

export function assetProductionStage(route: string): string | undefined {
  return ({ '/api/characters/profiles': 'character', '/api/scenes/proposals': 'scene', '/api/props/proposals': 'prop' } as Record<string, string>)[route];
}

export function mergeByStableKey(previous: any[] = [], incoming: any[] = [], key = 'segmentKey'): any[] {
  const values = new Map(previous.map(item => [item[key], item]));
  for (const item of incoming) {
    const old = values.get(item[key]);
    // A failed attempt is evidence, not a replacement for a usable asset.
    if ((item.status === 'failed' || (item.status === 'needs_revision' && !String(item.prompt || '').trim())) && (old?.imageUrl || old?.prompt)) { values.set(item[key], { ...old, ...(old.imageUrl ? { status: 'complete', queueState: undefined } : {}), error: item.error }); continue; }
    const candidate = { ...old, ...item };
    const content = (value: any) => JSON.stringify([value?.imageUrl, value?.prompt, value?.plan, value?.storyboardText, value?.visualDesignProposal, value?.sourceFacts, value?.identity, value?.assetRecommendation]);
    const changed = old && content(old) !== content(candidate);
    if (changed) {
      const { previousVersions, ...previous } = old;
      candidate.previousVersions = [...(previousVersions ?? []), previous].slice(-20);
      candidate.version = (old.version || 1) + 1;
      candidate.approval = 'draft';
    } else if (old?.approval) candidate.approval = old.approval;
    values.set(item[key], candidate);
  }
  return [...values.values()];
}

export function applyProductionResult(state: Record<string, any>, job: any): Record<string, any> {
  if (job.stale) return state;
  const result = job.result || {};
  const terminal = !['queued', 'running'].includes(job.status);
  const error = result.error || job.error || result.validationErrors?.map((item: any) => `${item.segmentKey}：${item.message}`).join('；') || result.boards?.filter((item: any) => item.status === 'failed').map((item: any) => `${item.segmentKey}：${item.error}`).join('；') || '';
  const applied = { ...(state.productionAppliedJobs || {}), [job.id]: job.revision };
  const common = { ...state, productionAppliedJobs: applied };
  const assetStage = assetProductionStage(job.route);
  if (assetStage) {
    const field = assetStage === 'character' ? 'characterProfiles' : `${assetStage}Proposals`;
    const outputKey = assetStage === 'character' ? 'profiles' : 'proposals';
    const key = assetStage === 'character' ? 'profileKey' : `${assetStage}AssetKey`;
    const incoming = result[outputKey] ?? (job.status === 'interrupted' ? result.candidateDraft?.[outputKey] : undefined);
    const old = state[field] ?? [];
    // Intermediate drafts are durable, but become editable only after the run ends.
    const usable = terminal && Array.isArray(incoming);
    const values = usable && assetStage === 'character' ? mergeCharacterProfiles(old, incoming, state.characterLibraryHistory) : usable ? mergeByStableKey(old, incoming.map((item: any) => ({ ...item, stale: false })), key).map((item: any) => incoming.some((x: any) => x[key] === item[key]) ? item : { ...item, stale: true, selectedForProduction: false }) : old;
    const changed = usable && JSON.stringify(old) !== JSON.stringify(values);
    const approvalField = assetStage === 'character' ? 'characterApproval' : `${assetStage}ProposalApproval`;
    const warning = [error, ...(result.warnings ?? [])].filter((text, index, values) => text && values.indexOf(text) === index).join('；');
    const next: Record<string, any> = { ...common, [field]: values, [`${assetStage}Status`]: !terminal ? 'running' : usable || old.length ? 'complete' : 'failed', [`${assetStage}Error`]: warning,
      [approvalField]: changed ? 'draft' : state[approvalField],
      [`${assetStage}RejectedDraft`]: usable ? '' : result.returnedDraft ?? state[`${assetStage}RejectedDraft`] ?? '',
      [`${assetStage}RejectedIssues`]: usable ? [] : result.validationIssues ?? state[`${assetStage}RejectedIssues`] ?? [],
    };
    if (changed) {
      next[`${assetStage}ImageStatus`] = 'idle'; next[`${assetStage}AssetsApproval`] = 'draft';
      const changedCharacterKeys = new Set(values.filter((profile: any) => {
        const prior = old.find((candidate: any) => candidate.profileKey === profile.profileKey);
        return !prior || JSON.stringify([prior.name, prior.identity, prior.physicalKnownFacts, prior.wardrobeKnownFacts]) !== JSON.stringify([profile.name, profile.identity, profile.physicalKnownFacts, profile.wardrobeKnownFacts]);
      }).map((profile: any) => profile.profileKey));
      for (const suffix of ['Images', 'ImagePrompts', ...(assetStage === 'scene' ? ['Views'] : assetStage === 'character' ? ['Turnarounds'] : [])]) next[`${assetStage}${suffix}`] = (state[`${assetStage}${suffix}`] ?? []).map((item: any) => assetStage === 'character' && !changedCharacterKeys.has(item.profileKey) ? item : ({ ...item, stale: true }));
      for (const downstream of ['storyboardSegments', 'storyboardBoardPlans', 'storyboardBoardPrompts', 'storyboardBoards', 'videoPrompts', 'shotVideoTasks']) next[downstream] = (state[downstream] ?? []).map((item: any) => ({ ...item, stale: true, approval: 'draft', ...(downstream === 'videoPrompts' ? { status: 'stale' } : {}) }));
      next.storyboardApproval = 'draft'; next.storyboardAssetsApproval = 'draft'; next.videoPromptsApproval = 'draft'; next.shotVideosApproval = 'draft';
      if (assetStage === 'scene') { next.sceneAssetsSkipped = false; next.sceneMainApproval = 'draft'; }
    }
    return next;
  }
  if (job.route === '/api/storyboards/segments') {
    let priorDraft: any = {};
    try { priorDraft = JSON.parse(state.storyboardRejectedDraft || '{}'); } catch { /* Keep usable segment records. */ }
    const outline = result.outline?.length ? result.outline : priorDraft.outline ?? [];
    const segments = result.segments ?? state.storyboardSegments ?? [];
    const changed = segments.filter((item: any) => JSON.stringify(item) !== JSON.stringify((state.storyboardSegments ?? []).find((old: any) => old.segmentKey === item.segmentKey))).map((item: any) => item.segmentKey);
    return { ...common, storyboardSegments: segments, storyboardWarnings: result.warnings ?? [], storyboardStatus: terminal ? (result.complete === true ? 'complete' : 'failed') : 'running', storyboardError: error,
      storyboardRejectedDraft: JSON.stringify({ segments, outline }), storyboardRejectedIssues: result.validationIssues ?? result.validationErrors?.map((x: any) => `${x.segmentKey}：${x.message}`) ?? state.storyboardRejectedIssues ?? [],
      storyboardApproval: changed.length ? 'draft' : state.storyboardApproval,
      storyboardBoardPlans: (state.storyboardBoardPlans ?? []).map((item: any) => changed.includes(item.segmentKey) ? { ...item, stale: true } : item),
      storyboardBoardPrompts: (state.storyboardBoardPrompts ?? []).map((item: any) => changed.includes(item.segmentKey) ? { ...item, stale: true } : item),
      storyboardBoards: (state.storyboardBoards ?? []).map((item: any) => changed.includes(item.segmentKey) ? { ...item, stale: true } : item),
      videoPrompts: (state.videoPrompts ?? []).map((item: any) => changed.includes(item.segmentKey) ? { ...item, status: 'stale', approval: 'draft' } : item),
      storyboardAssetsApproval: changed.length ? 'draft' : state.storyboardAssetsApproval, videoPromptsApproval: changed.length ? 'draft' : state.videoPromptsApproval };
  }
  if (job.route.startsWith('/api/storyboards/')) {
    const changedBoards = changedStoryboardImageKeys(state.storyboardBoards, result.boards);
    return { ...common, storyboardBoardPlans: mergeByStableKey(state.storyboardBoardPlans, (result.plans ?? []).map((x: any) => ({ ...x, stale: false, generationPreset: x.generationPreset ?? state.generationPreset }))), storyboardBoardPrompts: mergeByStableKey(state.storyboardBoardPrompts, (result.prompts ?? []).map((x: any) => ({ ...x, stale: false, generationPreset: x.generationPreset ?? state.generationPreset }))),
      ...(changedBoards.size ? { videoPrompts: (state.videoPrompts ?? []).map((item: any) => changedBoards.has(item.segmentKey) ? { ...item, stale: true, status: 'stale', approval: 'draft' } : item), videoPromptsApproval: 'draft', shotVideoTasks: (state.shotVideoTasks ?? []).map((item: any) => changedBoards.has(item.segmentKey) ? { ...item, stale: true, approval: 'draft' } : item), shotVideosApproval: 'draft' } : {}),
      storyboardBoards: mergeByStableKey(state.storyboardBoards, (result.boards ?? []).map((x: any) => ({ ...x, stale: false, queueState: undefined, error: x.error ?? '', panelCount: x.panelCount ?? state.storyboardBoardPanelCount, generationPreset: x.generationPreset ?? state.generationPreset }))), storyboardBoardStatus: terminal ? (error ? 'failed' : job.route.endsWith('/boards') ? 'complete' : 'idle') : 'running', storyboardBoardError: error, storyboardAssetsApproval: 'draft' };
  }
  const incoming = result.prompts ?? (result.prompt ? [result.prompt] : []);
  const prompts = mergeByStableKey(state.videoPrompts, incoming.map((item: any) => ({ ...item, approval: 'draft' })));
  const complete = (state.storyboardSegments ?? []).every((segment: any) => prompts.some(item => item.segmentKey === segment.segmentKey && item.status === 'complete' && item.prompt));
  return { ...common, videoPrompts: prompts, videoPromptStatus: terminal ? (complete ? 'complete' : 'failed') : 'running', videoPromptError: error, videoPromptsApproval: 'draft' };
}
