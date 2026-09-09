import type { EntityId, Script, StoryboardAssetReference, StoryboardPromptSet, StoryboardSegment, StoryboardSegmentDraft, StyleSelection } from '../domain/contracts.js';
import { DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC, collectStoryboardValidationWarnings, groundStoryboardEvidence, normalizeStoryboardPromptDraft, validateStoryboardPromptDraft } from './storyboard-prompt-generation.ts';

export interface MaterializeStoryboardPromptSetOptions {
  promptSetId: EntityId;
  script: Script;
  styleSelection: StyleSelection;
  assets: StoryboardAssetReference[];
  segments: StoryboardSegmentDraft[];
  segmentDurationSec?: number;
  previousPromptSet?: StoryboardPromptSet;
  timestamp: string;
}

export function materializeStoryboardPromptSet(options: MaterializeStoryboardPromptSetOptions): StoryboardPromptSet {
  const segmentDurationSec = options.segmentDurationSec ?? DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC;
  const input = { script: options.script, styleSelection: options.styleSelection, assets: options.assets, segmentDurationSec };
  const normalized = normalizeStoryboardPromptDraft({ segments: options.segments }, input);
  validateStoryboardPromptDraft(normalized, input);
  if (options.previousPromptSet && options.previousPromptSet.id !== options.promptSetId) throw new Error('Previous storyboard prompt set ID must match.');
  const previousIds = new Map(options.previousPromptSet?.segments.map((segment) => [segment.segmentKey, segment.id]) ?? []);
  const segments: StoryboardSegment[] = normalized.segments.map((segment) => ({ ...structuredClone(segment), id: previousIds.get(segment.segmentKey) ?? `${options.promptSetId}-${segment.segmentKey.toLowerCase()}`, groundedEvidence: groundStoryboardEvidence(segment, options.script) }));
  return {
    id: options.promptSetId,
    version: options.previousPromptSet ? options.previousPromptSet.version + 1 : 1,
    createdAt: options.previousPromptSet?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    episodeId: options.script.episodeId,
    scriptId: options.script.id,
    scriptVersion: options.script.version,
    styleSelectionId: options.styleSelection.id,
    styleSelectionVersion: options.styleSelection.version,
    assetVersions: Object.fromEntries(options.assets.map((asset) => [asset.assetId, asset.version])),
    estimatedDurationSec: segments.reduce((sum, segment) => sum + segment.durationSec, 0),
    segmentDurationSec,
    validationWarnings: collectStoryboardValidationWarnings(normalized, input),
    segments
  };
}
