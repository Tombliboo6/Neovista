import type {
  EntityId,
  SceneAssetPrompt,
  SceneAssetPromptDraft,
  SceneAssetPromptSet,
  Script,
  StyleSelection
} from '../domain/contracts.js';
import {
  compileSceneAssetPrompt,
  validateSceneAssetPromptDraft
} from './scene-prompt-generation.ts';

export interface MaterializeSceneAssetPromptSetOptions {
  promptSetId: EntityId;
  script: Script;
  styleSelection: StyleSelection;
  prompts: SceneAssetPromptDraft[];
  previousPromptSet?: SceneAssetPromptSet;
  timestamp: string;
}

export function materializeSceneAssetPromptSet(
  options: MaterializeSceneAssetPromptSetOptions
): SceneAssetPromptSet {
  validateSceneAssetPromptDraft(
    { prompts: options.prompts },
    { script: options.script, styleSelection: options.styleSelection }
  );
  const previous = options.previousPromptSet;
  if (previous && previous.id !== options.promptSetId) {
    throw new Error('Previous scene prompt set ID must match the stable prompt set ID.');
  }
  const previousIds = new Map(
    previous?.prompts.map((prompt) => [prompt.sceneAssetKey, prompt.id]) ?? []
  );
  const prompts: SceneAssetPrompt[] = options.prompts.map((prompt) => ({
    ...structuredClone(prompt),
    id:
      previousIds.get(prompt.sceneAssetKey) ??
      `${options.promptSetId}-${prompt.sceneAssetKey.toLowerCase()}`,
    compiledPrompt: compileSceneAssetPrompt(prompt, {
      script: options.script,
      styleSelection: options.styleSelection
    })
  }));
  return {
    id: options.promptSetId,
    version: previous ? previous.version + 1 : 1,
    createdAt: previous?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    scriptId: options.script.id,
    scriptVersion: options.script.version,
    styleSelectionId: options.styleSelection.id,
    styleSelectionVersion: options.styleSelection.version,
    prompts
  };
}
