export const STAGE_IDS = [
  'intake',
  'episode-plan',
  'script',
  'character-profiles',
  'style-selection',
  'character-images',
  'scenes',
  'scene-views',
  'props',
  'storyboard-prompts',
  'storyboard-images',
  'video-prompts',
  'shot-videos',
  'music',
  'composition'
] as const;

export type StageId = (typeof STAGE_IDS)[number];
export type StageState = 'empty' | 'running' | 'reviewing' | 'ready' | 'skipped' | 'stale' | 'failed';

export const OPTIONAL_STAGE_IDS = ['scene-views', 'props', 'music'] as const satisfies readonly StageId[];

export function isStageResolved(stage: StageId, state: StageState): boolean {
  return state === 'ready' || (state === 'skipped' && OPTIONAL_STAGE_IDS.includes(stage as (typeof OPTIONAL_STAGE_IDS)[number]));
}

export const STAGE_DEPENDENCIES: Readonly<Record<StageId, readonly StageId[]>> = {
  intake: [],
  'episode-plan': ['intake'],
  script: ['episode-plan'],
  'character-profiles': ['script'],
  'style-selection': ['character-profiles'],
  'character-images': ['character-profiles', 'style-selection'],
  scenes: ['script', 'style-selection', 'character-images'],
  'scene-views': ['scenes'],
  props: ['script', 'style-selection', 'scene-views'],
  'storyboard-prompts': ['script', 'character-images', 'scenes', 'scene-views', 'props'],
  'storyboard-images': ['storyboard-prompts', 'character-images', 'scenes', 'scene-views', 'props'],
  'video-prompts': ['storyboard-images', 'character-images', 'scenes', 'scene-views', 'props'],
  'shot-videos': ['video-prompts', 'storyboard-images'],
  music: ['script', 'shot-videos'],
  composition: ['shot-videos', 'music']
};

export function downstreamStages(changedStage: StageId): StageId[] {
  const affected = new Set<StageId>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const stage of STAGE_IDS) {
      if (stage === changedStage || affected.has(stage)) continue;
      const dependencies = STAGE_DEPENDENCIES[stage];
      if (dependencies.includes(changedStage) || dependencies.some((item) => affected.has(item))) {
        affected.add(stage);
        changed = true;
      }
    }
  }

  return STAGE_IDS.filter((stage) => affected.has(stage));
}

export type WorkflowStageStates = Readonly<Record<StageId, StageState>>;

export interface StageInvalidationResult {
  states: Record<StageId, StageState>;
  invalidated: StageId[];
}

export function invalidateReadyDownstreamStages(
  currentStates: WorkflowStageStates,
  changedStage: StageId
): StageInvalidationResult {
  const states = { ...currentStates };
  const invalidated: StageId[] = [];

  for (const stage of downstreamStages(changedStage)) {
    if (states[stage] !== 'ready' && states[stage] !== 'skipped') continue;
    states[stage] = 'stale';
    invalidated.push(stage);
  }

  return { states, invalidated };
}
