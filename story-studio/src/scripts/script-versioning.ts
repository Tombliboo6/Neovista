import type {
  EpisodePlan,
  EntityId,
  Script,
  ScriptDraft,
  ScriptScene
} from '../domain/contracts.js';

export interface MaterializeScriptOptions {
  scriptId: EntityId;
  documentId: EntityId;
  documentVersion: number;
  episode: EpisodePlan;
  draft: ScriptDraft;
  previousScript?: Script;
  timestamp: string;
}

export function materializeScriptVersion(options: MaterializeScriptOptions): Script {
  const { previousScript } = options;
  if (previousScript && previousScript.id !== options.scriptId) {
    throw new Error('Previous script ID must match the requested stable script ID.');
  }
  if (previousScript && previousScript.episodeId !== options.episode.id) {
    throw new Error('Previous script belongs to another episode.');
  }

  const previousSceneIds = new Map(
    previousScript?.scenes.map((scene) => [scene.sceneKey, scene.id]) ?? []
  );
  const seenSceneKeys = new Set<string>();
  const scenes: ScriptScene[] = options.draft.scenes.map((scene) => {
    if (seenSceneKeys.has(scene.sceneKey)) {
      throw new Error(`Duplicate sceneKey: ${scene.sceneKey}`);
    }
    seenSceneKeys.add(scene.sceneKey);

    return {
      ...structuredClone(scene),
      id: previousSceneIds.get(scene.sceneKey) ?? `${options.scriptId}-${scene.sceneKey.toLowerCase()}`
    };
  });

  return {
    ...structuredClone(options.draft),
    id: options.scriptId,
    version: previousScript ? previousScript.version + 1 : 1,
    createdAt: previousScript?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    episodeId: options.episode.id,
    episodeVersion: options.episode.version,
    documentId: options.documentId,
    documentVersion: options.documentVersion,
    scenes
  };
}
