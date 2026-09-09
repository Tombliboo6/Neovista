import type {
  CharacterProfileSet,
  EntityId,
  StyleSelection,
  StyleSelectionSource
} from '../domain/contracts.js';

export interface MaterializeStyleSelectionOptions {
  selectionId: EntityId;
  characterProfileSet: CharacterProfileSet;
  source: StyleSelectionSource;
  name: string;
  stylePrompt: string;
  referenceMediaPaths?: string[];
  selectedBy: 'user';
  previousSelection?: StyleSelection;
  timestamp: string;
}

export function materializeStyleSelectionDraft(
  options: MaterializeStyleSelectionOptions
): StyleSelection {
  if (options.characterProfileSet.approval !== 'approved') {
    throw new Error('Character profiles must be approved before style selection.');
  }
  if (options.selectedBy !== 'user') {
    throw new Error('The final visual style must be selected by the user.');
  }
  if (!nonEmpty(options.name) || !nonEmpty(options.stylePrompt)) {
    throw new Error('Style selection requires a name and a production style prompt.');
  }

  const referenceMediaPaths = options.referenceMediaPaths ?? [];
  if (options.source === 'reference-image' && referenceMediaPaths.length === 0) {
    throw new Error('Reference-image style selection requires at least one reference image.');
  }

  const previous = options.previousSelection;
  if (previous && previous.id !== options.selectionId) {
    throw new Error('Previous style selection ID must match the stable selection ID.');
  }
  if (
    previous &&
    previous.characterProfileSetId !== options.characterProfileSet.id
  ) {
    throw new Error('Previous style selection belongs to another character profile set.');
  }

  return {
    id: options.selectionId,
    version: previous ? previous.version + 1 : 1,
    createdAt: previous?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    characterProfileSetId: options.characterProfileSet.id,
    characterProfileSetVersion: options.characterProfileSet.version,
    source: options.source,
    name: options.name.trim(),
    stylePrompt: options.stylePrompt.trim(),
    referenceMediaPaths: [...referenceMediaPaths],
    selectedBy: 'user'
  };
}

export function requireCharacterImagePrerequisites(
  characterProfileSet: CharacterProfileSet,
  styleSelection: StyleSelection
): void {
  if (characterProfileSet.approval !== 'approved') {
    throw new Error('Character profiles must be approved before character image generation.');
  }
  if (styleSelection.approval !== 'approved') {
    throw new Error('Visual style must be selected and approved before character image generation.');
  }
  if (
    styleSelection.characterProfileSetId !== characterProfileSet.id ||
    styleSelection.characterProfileSetVersion !== characterProfileSet.version
  ) {
    throw new Error('Visual style does not match the approved character profile version.');
  }
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
