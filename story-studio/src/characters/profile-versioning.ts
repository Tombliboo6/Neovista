import type {
  CharacterProfile,
  CharacterProfileDraft,
  CharacterProfileSet,
  EntityId,
  Script
} from '../domain/contracts.js';

export interface MaterializeCharacterProfileSetOptions {
  profileSetId: EntityId;
  script: Script;
  profiles: CharacterProfileDraft[];
  previousProfileSet?: CharacterProfileSet;
  timestamp: string;
}

export function materializeCharacterProfileSet(
  options: MaterializeCharacterProfileSetOptions
): CharacterProfileSet {
  const previous = options.previousProfileSet;
  if (previous && previous.id !== options.profileSetId) {
    throw new Error('Previous character profile set ID must match the stable profile set ID.');
  }
  if (previous && previous.scriptId !== options.script.id) {
    throw new Error('Previous character profile set belongs to another script.');
  }

  const previousIds = new Map(
    previous?.profiles.map((profile) => [profile.profileKey, profile.id]) ?? []
  );
  const seenKeys = new Set<string>();
  const profiles: CharacterProfile[] = options.profiles.map((profile) => {
    if (seenKeys.has(profile.profileKey)) {
      throw new Error(`Duplicate character profileKey: ${profile.profileKey}`);
    }
    seenKeys.add(profile.profileKey);
    return {
      ...structuredClone(profile),
      id:
        previousIds.get(profile.profileKey) ??
        `${options.profileSetId}-${profile.profileKey.toLowerCase()}`
    };
  });

  return {
    id: options.profileSetId,
    version: previous ? previous.version + 1 : 1,
    createdAt: previous?.createdAt ?? options.timestamp,
    updatedAt: options.timestamp,
    approval: 'draft',
    scriptId: options.script.id,
    scriptVersion: options.script.version,
    profiles
  };
}
