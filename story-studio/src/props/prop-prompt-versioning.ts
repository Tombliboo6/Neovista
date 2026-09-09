import type {
  EntityId,
  PropAssetPrompt,
  PropAssetPromptDraft,
  PropAssetPromptSet,
  Script,
  StyleSelection
} from '../domain/contracts.js';
import {
  compilePropAssetPrompt,
  validatePropAssetPromptDraft,
  type RequiredPropSpec
} from './prop-prompt-generation.ts';

export interface MaterializePropAssetPromptSetOptions {
  promptSetId: EntityId;
  script: Script;
  styleSelection: StyleSelection;
  requiredProps: RequiredPropSpec[];
  prompts: PropAssetPromptDraft[];
  previousPromptSet?: PropAssetPromptSet;
  timestamp: string;
}

export function materializePropAssetPromptSet(options: MaterializePropAssetPromptSetOptions): PropAssetPromptSet {
  const input = { script: options.script, styleSelection: options.styleSelection, requiredProps: options.requiredProps };
  validatePropAssetPromptDraft({ prompts: options.prompts }, input);
  if (options.previousPromptSet && options.previousPromptSet.id !== options.promptSetId) throw new Error('Previous prop prompt set ID must match.');
  const previousIds = new Map(options.previousPromptSet?.prompts.map((prompt) => [prompt.propAssetKey, prompt.id]) ?? []);
  const prompts: PropAssetPrompt[] = options.prompts.map((prompt) => ({
    ...structuredClone(prompt),
    id: previousIds.get(prompt.propAssetKey) ?? `${options.promptSetId}-${prompt.propAssetKey.toLowerCase()}`,
    compiledPrompt: compilePropAssetPrompt(prompt, input)
  }));
  return {
    id: options.promptSetId,
    version: options.previousPromptSet ? options.previousPromptSet.version + 1 : 1,
    createdAt: options.previousPromptSet?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    scriptId: options.script.id,
    scriptVersion: options.script.version,
    styleSelectionId: options.styleSelection.id,
    styleSelectionVersion: options.styleSelection.version,
    prompts
  };
}
