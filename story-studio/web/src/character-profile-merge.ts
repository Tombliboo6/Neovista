const normalize = (value: unknown) => String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

/** Keep local identity keys when the agent changes selection or ordering. */
export function mergeCharacterProfiles(previous: any[], incoming: any[], history: any[] = []) {
  const used = new Set([...previous.map(p => p.profileKey), ...history.map(entry => entry.profile?.profileKey)]);
  const consumed = new Set<string>();
  const merged = incoming.map(candidate => {
    const matching = previous.filter(profile => [profile.name, ...(profile.aliases || [])].some(name => normalize(name) === normalize(candidate.name)));
    const old = matching.length === 1 && !consumed.has(matching[0].profileKey) ? matching[0] : undefined;
    let profileKey = old?.profileKey;
    if (!profileKey) { let index = 1; while (used.has(`C${String(index).padStart(2, '0')}`)) index++; profileKey = `C${String(index).padStart(2, '0')}`; }
    used.add(profileKey); consumed.add(profileKey);
    return { ...candidate, profileKey, stale: false,
      ...(old?.libraryBinding ? { libraryBinding: old.libraryBinding } : {}),
      ...(old?.manuallyAdded ? { manuallyAdded: true } : {}),
      ...(old?.libraryBinding?.assetId || old?.libraryBinding?.manualIdentity ? { identity: old.identity, physicalKnownFacts: old.physicalKnownFacts, wardrobeKnownFacts: old.wardrobeKnownFacts } : {}),
    };
  });
  return [...merged, ...previous.filter(profile => !consumed.has(profile.profileKey)).map(profile => profile.manuallyAdded ? profile : { ...profile, participation: 'candidate', stale: true })];
}
