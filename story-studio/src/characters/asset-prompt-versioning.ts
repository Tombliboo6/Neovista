import type {
  CharacterAssetPrompt,
  CharacterAssetPromptDraft,
  CharacterAssetPromptSet,
  CharacterProfileSet,
  EntityId,
  StyleSelection
} from '../domain/contracts.js';
import { compileCharacterAssetPrompt } from './asset-prompt-generation.ts';

export interface MaterializeCharacterAssetPromptSetOptions {
  promptSetId: EntityId;
  characterProfileSet: CharacterProfileSet;
  styleSelection: StyleSelection;
  prompts: CharacterAssetPromptDraft[];
  previousPromptSet?: CharacterAssetPromptSet;
  timestamp: string;
}

export function materializeCharacterAssetPromptSet(
  options: MaterializeCharacterAssetPromptSetOptions
): CharacterAssetPromptSet {
  const previous = options.previousPromptSet;
  if (previous && previous.id !== options.promptSetId) {
    throw new Error('Previous character asset prompt set ID must match the stable prompt set ID.');
  }
  if (
    previous &&
    previous.characterProfileSetId !== options.characterProfileSet.id
  ) {
    throw new Error('Previous prompt set belongs to another character profile set.');
  }

  const previousIds = new Map(
    previous?.prompts.map((prompt) => [prompt.promptKey, prompt.id]) ?? []
  );
  const seenKeys = new Set<string>();
  const prompts: CharacterAssetPrompt[] = options.prompts.map((prompt) => {
    if (seenKeys.has(prompt.promptKey)) {
      throw new Error(`Duplicate character asset promptKey: ${prompt.promptKey}`);
    }
    seenKeys.add(prompt.promptKey);
    return {
      ...structuredClone(prompt),
      id:
        previousIds.get(prompt.promptKey) ??
        `${options.promptSetId}-${prompt.promptKey.toLowerCase()}`,
      compiledPrompt: compileCharacterAssetPrompt(prompt, {
        characterProfileSet: options.characterProfileSet,
        styleSelection: options.styleSelection
      })
    };
  });

  return {
    id: options.promptSetId,
    version: previous ? previous.version + 1 : 1,
    createdAt: previous?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    characterProfileSetId: options.characterProfileSet.id,
    characterProfileSetVersion: options.characterProfileSet.version,
    styleSelectionId: options.styleSelection.id,
    styleSelectionVersion: options.styleSelection.version,
    prompts
  };
}
