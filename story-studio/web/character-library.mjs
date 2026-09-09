import { createHash, randomUUID } from 'node:crypto';

const copy = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
export const characterScope = session => session.series?.rootProjectId || session.id;
const episodeNumber = session => session.series?.episodeNumber || session.state.ideaScript?.episodeNumber || 1;
const names = profile => [profile.name, ...list(profile.aliases)].map(nameKey).filter(Boolean);

export function knownCharacterAnchors(session, catalog) {
  if (!session) return [];
  const available = catalog.filter(entry => entry.scopeId === characterScope(session) && entry.approved && entry.lookId === 'base' && entry.episodeNumber <= episodeNumber(session));
  return available.filter((entry, index) => available.findIndex(other => other.identityId === entry.identityId) === index)
    .filter(entry => !available.some(other => other.identityId !== entry.identityId && names(other.profile).some(name => names(entry.profile).includes(name))))
    .map(entry => ({ name: entry.profile.name, aliases: copy(entry.profile.aliases || []), identity: entry.profile.identity, physicalKnownFacts: copy(entry.profile.physicalKnownFacts || []), wardrobeKnownFacts: copy(entry.profile.wardrobeKnownFacts || []) }));
}

export function characterPresence(script, profile) {
  const keys = names(profile);
  const hasName = value => keys.some(key => nameKey(value).includes(key));
  let voice = false;
  for (const scene of list(script?.scenes)) {
    const blocks = list(scene.blocks);
    if (blocks.length) {
      for (const block of blocks) {
        if (['dialogue', 'os'].includes(block.type) && hasName(block.speaker)) {
          if (block.type === 'os' || /画外|旁白|内心/u.test(String(block.delivery || block.note || ''))) voice = true;
          else return 'visual';
        }
        // Dialogue content can mention an absent person. Only stage action counts here.
        if (!['dialogue', 'os'].includes(block.type) && hasName(block.text)) return 'visual';
      }
    } else {
      if (list(scene.dialogue).some(line => hasName(line.speaker))) return 'visual';
      if (list(scene.beats).some(hasName)) return 'visual';
    }
  }
  return voice ? 'voice' : 'candidate';
}

function snapshot(session, profile, approvedOnly = false) {
  const state = session.state;
  if (approvedOnly && state.characterApproval !== 'approved') return null;
  const binding = profile.libraryBinding || {};
  const identityId = binding.identityId || `person-${hash([characterScope(session), session.id, profile.profileKey, profile.name])}`;
  const lookId = binding.lookId || 'base';
  const image = list(state.characterImages).find(item => item.profileKey === profile.profileKey && item.status === 'complete' && item.imageUrl && !item.stale);
  const turnaround = list(state.characterTurnarounds).find(item => item.profileKey === profile.profileKey && item.status === 'complete' && item.imageUrl && !item.stale);
  const mediaApproved = state.characterAssetsApproval === 'approved' || Boolean(binding.assetId && binding.reused && image?.imageUrl === binding.imageUrl);
  const prompt = list(state.characterImagePrompts).find(item => item.profileKey === profile.profileKey && !item.stale);
  const resources = Object.fromEntries(['characterImages', 'characterTurnarounds', 'characterImagePrompts'].map(field => [field, copy(list(state[field]).filter(item => item.profileKey === profile.profileKey))]));
  const content = { profile: copy(profile), image: image ? copy(image) : undefined, turnaround: turnaround ? copy(turnaround) : undefined, prompt: prompt ? copy(prompt) : undefined };
  // Binding/provenance never creates another content version on a later save.
  delete content.profile.libraryBinding;
  const id = `cast-${hash([identityId, lookId, state.selectedStyleId, content])}`;
  return { id, identityId, scopeId: characterScope(session), scopeName: session.series?.title || state.seriesMotherScript?.title || state.projectName || state.ideaScript?.title || '当前作品', lookId, lookName: binding.lookName || '基础造型', styleId: state.selectedStyleId || '', sourceProjectId: session.id, sourceProjectName: state.projectName || state.ideaScript?.title || '', episodeNumber: episodeNumber(session), approved: state.characterApproval === 'approved', imageApproved: mediaApproved, diagnostic: state.characterError || '', resources, ...content };
}

// The immutable snapshots live with their originating project. Library views aggregate
// them without changing other episodes or introducing a second transactional writer.
export function preserveCharacterHistory(state, previous, session) {
  const next = copy(state);
  const history = new Map([...list(next.characterLibraryHistory), ...list(previous?.characterLibraryHistory)].map(item => [item.id, item]));
  if (previous) {
    for (const profile of list(previous.characterProfiles)) {
      const item = snapshot({ ...session, state: previous }, profile, false);
      if (item && (!list(next.characterProfiles).some(p => p.profileKey === profile.profileKey) || previous.characterApproval === 'approved')) history.set(item.id, item);
    }
  }
  for (const profile of list(next.characterProfiles)) {
    const old = list(previous?.characterProfiles).find(item => item.profileKey === profile.profileKey && item.name === profile.name);
    profile.libraryBinding ||= copy(old?.libraryBinding || { identityId: `person-${hash([characterScope(session), session.id, profile.profileKey, profile.name])}`, lookId: 'base', lookName: '基础造型' });
    const item = snapshot({ ...session, state: next }, profile, true);
    if (item) history.set(item.id, item);
  }
  next.characterLibraryHistory = [...history.values()];
  if (JSON.stringify(next.characterLibraryHistory).length > 8_000_000) throw new Error('人物版本记录已达到当前项目容量，请先导出项目后再继续。');
  return next;
}

export function buildCharacterCatalog(sessions, externalAssets = []) {
  const entries = new Map();
  const usage = new Map();
  for (const session of sessions) {
    for (const item of list(session.state.characterLibraryHistory)) entries.set(item.id, copy(item));
    for (const profile of list(session.state.characterProfiles)) {
      const item = snapshot(session, profile);
      if (!entries.get(item.id)?.approved || (item.approved && item.imageApproved)) entries.set(item.id, item);
      const key = `${characterScope(session)}:${item.identityId}`;
      const used = usage.get(key) || new Map();
      used.set(session.id, { projectId: session.id, episodeNumber: episodeNumber(session), projectName: session.state.projectName || session.state.ideaScript?.title || '' });
      usage.set(key, used);
    }
  }
  for (const session of sessions) {
    const scopeId = characterScope(session);
    const planned = [session.state.seriesMotherScript, session.state.ideaScript, ...list(session.state.episodeScripts).map(item => item.script)].flatMap(script => list(script?.characters));
    for (const candidate of planned) {
      if (!candidate?.name || [...entries.values()].some(item => item.scopeId === scopeId && names(item.profile).includes(nameKey(candidate.name)))) continue;
      const identityId = `planned-${hash([scopeId, nameKey(candidate.name)])}`;
      entries.set(identityId, { id: identityId, identityId, scopeId, scopeName: session.series?.title || session.state.seriesMotherScript?.title || session.state.projectName || '当前作品', sourceProjectId: session.id, sourceProjectName: session.state.projectName || '', episodeNumber: 0, approved: false, imageApproved: false, lookId: 'base', lookName: '基础造型', styleId: '', profile: manualProfile(candidate.name, candidate.role || '人物资料待补充') });
    }
  }
  for (const asset of externalAssets.filter(item => item.type === 'character')) {
    if (entries.has(asset.id)) continue;
    const profile = asset.characterProfile || manualProfile(asset.name, asset.description || asset.name);
    entries.set(asset.id, { id: asset.id, identityId: asset.characterIdentityId || `external-${asset.familyKey || asset.id}`, scopeId: asset.scopeId || asset.sourceProjectId, scopeName: asset.sourceProjectName || '资产库', sourceProjectId: asset.sourceProjectId, sourceProjectName: asset.sourceProjectName, episodeNumber: 0, lookId: asset.lookId || 'base', lookName: asset.lookName || '基础造型', styleId: asset.styleId || '', approved: true, imageApproved: true, profile, image: asset.media?.mainImageUrl ? { profileKey: profile.profileKey, name: profile.name, status: 'complete', imageUrl: asset.media.mainImageUrl } : undefined, turnaround: asset.media?.auxiliaryImageUrl ? { profileKey: profile.profileKey, name: profile.name, status: 'complete', imageUrl: asset.media.auxiliaryImageUrl } : undefined });
  }
  return [...entries.values()].map(item => ({ ...item, usages: [...(usage.get(`${item.scopeId}:${item.identityId}`)?.values() || [])] }));
}

function manualProfile(name, description) {
  return { profileKey: '', name, aliases: [], introduction: description, identity: description, storyRole: '本集人物', personality: [], motivation: '', relationships: [], physicalKnownFacts: [], wardrobeKnownFacts: [], designOpenQuestions: [], sourceSceneKeys: [], sourceFacts: [] };
}

function nextProfileKey(state) {
  const keys = new Set([...list(state.characterProfiles).map(p => p.profileKey), ...list(state.characterLibraryHistory).map(item => item.profile?.profileKey)]);
  let index = 1; while (keys.has(`C${String(index).padStart(2, '0')}`)) index++;
  return `C${String(index).padStart(2, '0')}`;
}

function invalidate(state, keys) {
  state.characterApproval = 'draft'; state.characterAssetsApproval = 'draft'; state.activeStage = '角色';
  // Keep generated media and original task statuses; staleness requests review only.
  const profiles = list(state.characterProfiles).filter(p => keys.includes(p.profileKey));
  const affectedNames = new Set(profiles.flatMap(p => [p.name, ...list(p.aliases)]));
  const segments = list(state.storyboardSegments).filter(s => !list(s.characters).length || s.characters.some(n => affectedNames.has(n)));
  const segmentKeys = new Set(segments.map(s => s.segmentKey));
  for (const field of ['storyboardSegments', 'storyboardBoardPlans', 'storyboardBoardPrompts', 'storyboardBoards', 'videoPrompts', 'shotVideoTasks']) {
    state[field] = list(state[field]).map(item => segmentKeys.has(item.segmentKey) ? { ...item, stale: true, approval: 'draft', ...(field === 'videoPrompts' ? { status: 'stale' } : {}) } : item);
  }
  if (segmentKeys.size) {
    state.storyboardApproval = 'draft'; state.storyboardAssetsApproval = 'draft'; state.videoPromptsApproval = 'draft'; state.shotVideosApproval = 'draft';
    if (state.postProduction) {
      for (const field of ['roughCut', 'musicPrompt', 'music', 'finalComposition']) if (state.postProduction[field]?.status === 'complete') state.postProduction[field] = { ...state.postProduction[field], status: 'stale' };
      state.postProduction.roughCutApproval = 'draft'; state.postProduction.musicPromptApproval = 'draft';
    }
  }
}

function attach(state, profile, entry, preserveEpisode) {
  const profileKey = profile.profileKey;
  const stable = entry.profile;
  const bound = { ...(preserveEpisode ? profile : entry.sourceProjectId === state.characterCurrentProjectId ? copy(stable) : { ...manualProfile(stable.name, stable.identity || stable.introduction), personality: copy(stable.personality || []) }), aliases: copy(stable.aliases || []), identity: stable.identity, physicalKnownFacts: copy(stable.physicalKnownFacts || []), wardrobeKnownFacts: copy(stable.wardrobeKnownFacts || []), profileKey, libraryBinding: { identityId: entry.identityId, scopeId: entry.scopeId, assetId: entry.id, lookId: entry.lookId, lookName: entry.lookName, reused: true, imageUrl: entry.image?.imageUrl }, participation: profile.participation || 'visual' };
  if (!preserveEpisode) bound.manuallyAdded = true;
  state.characterProfiles = [...list(state.characterProfiles).filter(p => p.profileKey !== profileKey), bound];
  // Selecting a version replaces the entire appearance pair, including an absent auxiliary view.
  for (const [field, value] of [['characterImages', entry.image], ['characterTurnarounds', entry.turnaround], ['characterImagePrompts', entry.prompt]]) {
    state[field] = list(state[field]).filter(item => item.profileKey !== profileKey);
    if (value) state[field].push({ ...copy(value), profileKey, name: bound.name, stale: false, generationPreset: copy(value.generationPreset || (state.generationPreset ? { ...state.generationPreset, styleId: entry.styleId || state.generationPreset.styleId } : undefined)) });
  }
  state.characterAssetProfileKeys = list(state.characterImages).filter(i => i.imageUrl && !i.stale && i.status === 'complete').map(i => i.profileKey);
  return bound;
}

export function assertCharacterMutationIdle(state) {
  if (Object.values(state).some(v => v === 'running') || ['characterTurnarounds', 'sceneViews', 'shotVideoTasks', 'storyboardBoards', 'episodeScripts'].some(key => list(state[key]).some(item => ['running', 'queued', 'submitting'].includes(item.status)))) throw new Error('当前任务正在执行，请完成后再调整本集人物。');
}

export function changeCharacterRoster(session, input, catalog) {
  assertCharacterMutationIdle(session.state);
  let state = preserveCharacterHistory(session.state, session.state, session);
  state.characterRosterVersion = 1;
  state.characterCurrentProjectId = session.id;
  const action = input.action;
  if (['reconcile', 'approve-profiles'].includes(action)) {
    const original = [...list(state.characterProfiles)];
    for (const profile of original) {
      const presence = profile.participation || characterPresence(state.ideaScript, profile);
      if (presence === 'candidate' && !profile.manuallyAdded) {
        const item = snapshot({ ...session, state }, profile);
        if (!state.characterLibraryHistory.some(x => x.id === item.id)) state.characterLibraryHistory.push(item);
        invalidate(state, [profile.profileKey]);
        state.characterProfiles = state.characterProfiles.filter(p => p.profileKey !== profile.profileKey);
        // Images and prompts remain in the snapshot, outside the current production inputs.
        for (const field of ['characterImages', 'characterTurnarounds', 'characterImagePrompts']) state[field] = list(state[field]).filter(p => p.profileKey !== profile.profileKey);
        continue;
      }
      profile.participation = presence;
      if (profile.libraryBinding?.assetId || profile.libraryBinding?.manualIdentity || profile.manuallyAdded) continue;
      const matches = catalog.filter(item => item.approved && item.scopeId === characterScope(session) && item.sourceProjectId !== session.id && item.episodeNumber <= episodeNumber(session) && names(item.profile).some(n => names(profile).includes(n)));
      const identities = [...new Set(matches.map(item => item.identityId))];
      if (matches.length) profile.libraryBinding.selectionNeeded = true;
      if (identities.length === 1) {
        const compatible = matches.filter(item => item.lookId === 'base' && (!item.styleId || item.styleId === state.selectedStyleId));
        // Prefer a confirmed image; do not guess between multiple distinct approved looks.
        const images = compatible.filter(item => item.image && item.imageApproved);
        const variants = [...new Set(images.map(item => item.image.imageUrl))];
        const selected = variants.length === 1 ? images[0] : variants.length === 0 ? compatible[0] : undefined;
        if (selected) attach(state, profile, selected.imageApproved ? selected : { ...selected, image: undefined, turnaround: undefined, prompt: undefined }, true);
      }
    }
    state.characterRosterVersion = 1;
    if (!/失败|超时|未完成|不存在|冲突|连接|权限|余额/u.test(String(state.characterError || ''))) state.characterError = '';
    state.characterStatus = 'complete';
    if (action === 'approve-profiles') state.characterApproval = 'approved';
  } else if (action === 'new') {
    const name = String(input.name || '').trim(); const description = String(input.description || '').trim();
    if (!name || name.length > 100 || !description || description.length > 2000) throw new Error('请填写角色名称和简短说明。');
    if (list(state.characterProfiles).some(p => names(p).includes(nameKey(name)))) throw new Error('本集已有这个人物，请直接使用现有角色。');
    const profile = { ...manualProfile(name, description), profileKey: nextProfileKey(state), manuallyAdded: true, participation: input.participation === 'voice' ? 'voice' : 'visual', libraryBinding: { identityId: `person-${randomUUID()}`, manualIdentity: true, lookId: 'base', lookName: '基础造型' } };
    state.characterProfiles.push(profile);
    if (input.imageUrl) {
      if (typeof input.imageUrl !== 'string' || !/^\/api\/(?:generated-images|free-canvas\/imports)\/[^/?#]+\.(?:png|jpe?g|webp)$/iu.test(input.imageUrl)) throw new Error('角色图片必须先上传到本机素材库。');
      state.characterImages = [...list(state.characterImages), { profileKey: profile.profileKey, name, status: 'complete', imageUrl: input.imageUrl, generationPreset: copy(state.generationPreset) }];
    }
    invalidate(state, [profile.profileKey]); state.characterStatus = 'complete';
  } else if (action === 'import') {
    const entry = catalog.find(item => item.id === input.assetId);
    if (!entry) throw new Error('人物版本已不存在，请刷新人物库。');
    const existing = list(state.characterProfiles).find(p => p.profileKey === input.profileKey);
    if (input.profileKey && !existing) throw new Error('目标人物已改变，请刷新后再选择。');
    if (!existing && list(state.characterProfiles).some(p => p.libraryBinding?.identityId === entry.identityId || names(p).some(n => names(entry.profile).includes(n)))) throw new Error('本集已有这个人物，请在其角色卡上选择造型。');
    const profile = existing || { profileKey: nextProfileKey(state), participation: 'visual' };
    if (existing && existing.libraryBinding?.identityId !== entry.identityId && !names(existing).some(n => names(entry.profile).includes(n))) throw new Error('所选资产属于另一人物，请使用“添加角色”。');
    attach(state, profile, entry, Boolean(existing)); invalidate(state, [profile.profileKey]); state.characterStatus = 'complete';
  } else if (action === 'remove') {
    const profile = list(state.characterProfiles).find(p => p.profileKey === input.profileKey);
    if (!profile) throw new Error('本集已没有这个人物。');
    const item = snapshot({ ...session, state }, profile);
    state.characterLibraryHistory = [...state.characterLibraryHistory.filter(i => i.id !== item.id), item];
    invalidate(state, [profile.profileKey]);
    state.characterProfiles = state.characterProfiles.filter(p => p.profileKey !== profile.profileKey);
    for (const field of ['characterImages', 'characterTurnarounds', 'characterImagePrompts']) state[field] = list(state[field]).filter(p => p.profileKey !== profile.profileKey);
  } else if (action === 'new-look') {
    const profile = list(state.characterProfiles).find(p => p.profileKey === input.profileKey);
    const label = String(input.name || '').trim();
    if (!profile || !label || label.length > 100) throw new Error('请填写造型名称。');
    const item = snapshot({ ...session, state }, profile);
    state.characterLibraryHistory = [...state.characterLibraryHistory.filter(i => i.id !== item.id), item];
    invalidate(state, [profile.profileKey]);
    const anchor = item.imageApproved && item.image ? item : catalog.find(entry => entry.identityId === item.identityId && entry.approved && entry.imageApproved && entry.image);
    profile.libraryBinding = { identityId: item.identityId, manualIdentity: true, lookId: `look-${randomUUID()}`, lookName: label, ...(anchor ? { identityImageUrl: anchor.image.imageUrl, identityAssetId: anchor.id } : {}) };
    profile.wardrobeKnownFacts = [String(input.description || label).trim()];
    for (const field of ['characterImages', 'characterTurnarounds', 'characterImagePrompts']) state[field] = list(state[field]).filter(p => p.profileKey !== profile.profileKey);
  } else if (action === 'update-profile') {
    const profile = list(state.characterProfiles).find(p => p.profileKey === input.profileKey);
    if (!profile || !input.profile || JSON.stringify(input.profile).length > 30000) throw new Error('人物资料无效，请重新打开角色资料。');
    const before = snapshot({ ...session, state }, profile);
    state.characterLibraryHistory = [...state.characterLibraryHistory.filter(item => item.id !== before.id), before];
    for (const field of ['introduction', 'identity', 'storyRole', 'motivation']) {
      if (typeof input.profile[field] !== 'string') throw new Error('人物资料字段不完整。');
      profile[field] = input.profile[field].trim();
    }
    for (const field of ['personality', 'physicalKnownFacts', 'wardrobeKnownFacts', 'designOpenQuestions']) {
      if (!Array.isArray(input.profile[field]) || input.profile[field].some(item => typeof item !== 'string')) throw new Error('人物资料字段不完整。');
      profile[field] = input.profile[field].map(item => item.trim()).filter(Boolean);
    }
    const appearanceChanged = ['identity', 'physicalKnownFacts', 'wardrobeKnownFacts'].some(field => JSON.stringify(profile[field]) !== JSON.stringify(before.profile[field]));
    if (appearanceChanged) {
      profile.libraryBinding = { ...profile.libraryBinding, assetId: undefined, reused: false, manualIdentity: true, ...(before.imageApproved && before.image ? { identityImageUrl: before.image.imageUrl, identityAssetId: before.id } : {}) };
      for (const field of ['characterImages', 'characterTurnarounds', 'characterImagePrompts']) state[field] = list(state[field]).filter(item => item.profileKey !== profile.profileKey);
    }
    invalidate(state, [profile.profileKey]);
  } else if (action === 'approve-assets') {
    if (state.characterApproval !== 'approved') throw new Error('请先确认本集角色设定。');
    state.characterAssetsApproval = 'approved'; state.activeStage = '场景';
  } else throw new Error('不支持的人物操作。');
  state.characterAssetProfileKeys = list(state.characterImages).filter(i => i.imageUrl && i.status === 'complete' && !i.stale).map(i => i.profileKey);
  delete state.characterCurrentProjectId;
  return preserveCharacterHistory(state, session.state, session);
}

export function catalogAsset(entry) {
  return { id: entry.id, familyKey: entry.identityId, version: 1, type: 'character', name: entry.profile.name, description: entry.profile.introduction, tags: [entry.lookName], prompt: entry.prompt?.prompt || '', media: { mainImageUrl: entry.image?.imageUrl, auxiliaryImageUrl: entry.turnaround?.imageUrl, referenceImageUrls: [entry.image?.imageUrl, entry.turnaround?.imageUrl].filter(Boolean) }, sourceProjectId: entry.sourceProjectId, sourceProjectName: entry.scopeName, sourceAssetKey: entry.profile.profileKey, folder: entry.scopeName, favorite: false, status: entry.approved ? 'approved' : 'draft', usages: entry.usages.map(use => ({ ...use, targetName: entry.profile.name, targetKey: entry.profile.profileKey, targetType: 'character', appliedAt: '' })), createdAt: '', updatedAt: '', managedCharacter: true };
}
