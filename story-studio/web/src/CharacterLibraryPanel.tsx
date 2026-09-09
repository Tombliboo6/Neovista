import { useEffect, useRef, useState } from 'react';

export type CharacterLibraryEntry = {
  id: string; identityId: string; scopeId: string; scopeName: string; lookId: string; lookName: string; styleId: string;
  approved: boolean; imageApproved?: boolean; profile: { name: string; aliases?: string[]; introduction: string; identity: string }; image?: { imageUrl: string };
  usages: Array<{ projectId: string; episodeNumber: number; projectName: string }>;
};
export type CharacterRosterAction = { action: string; profileKey?: string; assetId?: string; name?: string; description?: string; imageUrl?: string; participation?: "visual" | "voice"; profile?: unknown };

export function CharacterLibraryPanel({ projectId, currentProfiles, target, onAction, onUpload, onClose }: {
  projectId: string; currentProfiles: Array<{ name: string; libraryBinding?: { identityId: string } }>; target?: { profileKey: string; name: string; identityId?: string };
  onAction: (action: CharacterRosterAction) => Promise<void>; onUpload: (file: File) => Promise<string>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<CharacterLibraryEntry[]>([]);
  const [scopeId, setScopeId] = useState('');
  const [allWorks, setAllWorks] = useState(false);
  const [mode, setMode] = useState<'library' | 'new'>('library');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [upload, setUpload] = useState<File | null>(null);
  const [voiceOnly, setVoiceOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestBusy = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/characters/library', { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || body.projectId !== projectId) throw new Error('项目已改变，请重新打开人物库。');
      setEntries(body.entries); setScopeId(body.scopeId); setLoading(false);
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setLoading(false); } });
    return () => controller.abort();
  }, [projectId]);
  // A text revision using the same image is one selectable appearance. Prefer approved records.
  const options = entries.filter(entry => (allWorks || entry.scopeId === scopeId) && (!target || entry.identityId === target.identityId || [entry.profile.name, ...(entry.profile.aliases || [])].includes(target.name)) && [entry.profile.name, ...(entry.profile.aliases || []), entry.lookName, entry.scopeName].join(' ').includes(query.trim()))
    .sort((a, b) => Number(b.approved) - Number(a.approved) || Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .filter((entry, index, values) => values.findIndex(item => item.identityId === entry.identityId && item.lookId === entry.lookId && item.image?.imageUrl === entry.image?.imageUrl) === index);
  async function act(action: CharacterRosterAction) {
    if (requestBusy.current) return;
    requestBusy.current = true; setBusy(true); setError('');
    try {
      if (upload && action.action === 'new') action.imageUrl = await onUpload(upload);
      await onAction(action); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作未完成，请保留当前内容后重试。'); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="character-library-dialog" aria-labelledby="character-library-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="character-library-title">{target ? `${target.name} · 造型与版本` : '添加角色'}</h2><button type="button" aria-label="关闭人物库" disabled={busy} onClick={onClose}>×</button></header>
    <div className="character-library-tabs"><button type="button" disabled={busy} aria-pressed={mode === 'library'} onClick={() => setMode('library')}>从人物库选择</button><button type="button" disabled={busy} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>{target ? '新增造型' : '新建角色'}</button></div>
    {mode === 'library' ? <>
      <div className="character-library-filter"><input aria-label="搜索人物" placeholder="搜索人物或造型" value={query} onChange={event => setQuery(event.target.value)} /><label><input type="checkbox" checked={allWorks} onChange={event => setAllWorks(event.target.checked)} />查看其他作品</label></div>
      {loading ? <p role="status">正在读取人物库…</p> : <div className="character-library-list">{options.map(entry => { const present = !target && currentProfiles.some(profile => profile.libraryBinding?.identityId === entry.identityId || profile.name === entry.profile.name); return <article key={entry.id}>
        {entry.image ? <img src={entry.image.imageUrl} alt={`${entry.profile.name} · ${entry.lookName}`} /> : <span className="character-library-avatar" aria-hidden="true">{entry.profile.name.slice(0, 1)}</span>}
        <div><strong>{entry.profile.name}</strong><p>{entry.lookName} · {entry.image ? '已有形象' : '文字档案'}{!entry.approved || (entry.image && !entry.imageApproved) ? ' · 待确认' : ''}</p><small>{entry.scopeName}{entry.usages.length ? ` · 用于第 ${[...new Set(entry.usages.map(use => use.episodeNumber))].sort((a, b) => a - b).join('、')} 集` : ''}</small></div>
        <button type="button" disabled={busy || present} onClick={() => void act({ action: 'import', assetId: entry.id, profileKey: target?.profileKey })}>{present ? '已在本集' : target ? '使用此版本' : '加入本集'}</button>
      </article>; })}{!options.length && <p className="muted">{query ? '没有匹配的人物。' : '本剧暂时没有可选人物，可新建角色或查看其他作品。'}</p>}</div>}
    </> : <form onSubmit={event => { event.preventDefault(); void act({ action: target ? 'new-look' : 'new', profileKey: target?.profileKey, name, description, participation: voiceOnly ? "voice" : "visual" }); }}>
      <label>{target ? '造型名称' : '角色名称'}<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={target ? '例如：雨夜披风' : '输入人物名称'} /></label>
      <label>{target ? '造型说明' : '人物说明'}<textarea required maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder={target ? '描述本次衣着或外观状态' : '简述人物身份和本集作用'} /></label>
      {!target && <label className="character-voice-choice"><input type="checkbox" checked={voiceOnly} disabled={busy} onChange={event => { setVoiceOnly(event.target.checked); setUpload(null); }} />仅声音角色</label>}
      {!target && !voiceOnly && <label>角色图片（可选）<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setUpload(event.target.files?.[0] || null)} /></label>}
      <button className="primary-button" disabled={busy || !name.trim() || !description.trim()}>{busy ? '正在保存…' : target ? '建立造型草稿' : '加入本集'}</button>
    </form>}
    {error && <p className="agent-error" role="alert">{error}</p>}
  </dialog>;
}
