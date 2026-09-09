import { useEffect, useState } from 'react';

export type VideoEngineSettings = {
  engine?: 'local' | 'minimax' | 'seedance';
  profileId?: string;
  cloudResolution?: '480p' | '720p' | '768p' | '1080p';
  generateAudio?: boolean;
};
export const videoEngineLabel = (engine?: string) => engine === 'minimax' ? 'MiniMax' : engine === 'seedance' ? 'Seedance' : '本机 H3';
export const usesCloudVideo = (settings: VideoEngineSettings) => settings.engine === 'minimax' || settings.engine === 'seedance';
type Profile = { id: string; name: string; model: string; active: boolean };
type Provider = { kind: string; profiles?: Profile[] };

export function VideoEngineControls({ settings, onChange, showMode = true, context = 'director' }: {
  settings: VideoEngineSettings & { mode: 'text' | 'reference' };
  onChange: (patch: VideoEngineSettings & { mode?: 'text' | 'reference' }) => void;
  showMode?: boolean;
  context?: 'director' | 'canvas';
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cloud = usesCloudVideo(settings);
  useEffect(() => {
    if (!cloud) return;
    let cancelled = false;
    setLoading(true); setError('');
    void fetch('/api/provider-settings/status', { cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.providers)) throw new Error('无法读取接口配置，请刷新配置。');
      if (!cancelled) setProviders(body.providers);
    }).catch(() => { if (!cancelled) setError('无法读取接口配置，请刷新配置。'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cloud, settings.engine, refresh]);
  const profiles = providers.find(item => item.kind === `${settings.engine}-video`)?.profiles || [];
  const selected = profiles.find(profile => profile.id === settings.profileId) || (!settings.profileId ? profiles.find(profile => profile.active) : undefined);
  return <section className="video-engine-controls" aria-label="视频生成方式">
    <label>生成方式<select value={settings.engine || 'local'} onChange={event => {
      const engine = event.target.value as VideoEngineSettings['engine'];
      onChange({ engine, profileId: '', cloudResolution: engine === 'minimax' ? '768p' : '720p', generateAudio: engine === 'seedance' });
    }}><option value="local">本机 H3</option><option value="minimax">MiniMax API</option><option value="seedance">Seedance API</option></select></label>
    {cloud && <>
      <label>接口配置<select value={settings.profileId || ''} disabled={loading} onChange={event => onChange({ profileId: event.target.value })}>
        <option value="">{loading ? '正在读取配置…' : '使用当前已启用配置'}</option>
        {settings.profileId && !profiles.some(item => item.id === settings.profileId) && <option value={settings.profileId}>原配置已不可用，请重新选择</option>}
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}
      </select></label>
      <div className="video-engine-profile-status"><small>{selected ? `模型：${selected.model}` : loading ? '正在读取…' : `请在右上角设置中添加 ${videoEngineLabel(settings.engine)} 视频接口。`}</small><button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新配置</button></div>
      {error && <p role="alert">{error}</p>}
      <div className="h3-settings-grid">
        {showMode && <label>生成模式<select value={settings.mode} onChange={event => onChange({ mode: event.target.value as 'text' | 'reference' })}><option value="reference">多图参考</option><option value="text">文生视频</option></select></label>}
        <label>分辨率<select value={settings.cloudResolution || (settings.engine === 'minimax' ? '768p' : '720p')} onChange={event => onChange({ cloudResolution: event.target.value as VideoEngineSettings['cloudResolution'] })}>
          {settings.engine === 'minimax' ? <option value="768p">768P</option> : <><option value="480p">480P</option><option value="720p">720P</option></>}<option value="1080p">1080P</option>
        </select></label>
      </div>
      {settings.engine === 'seedance' && <label className="h3-switch"><input type="checkbox" checked={settings.generateAudio !== false} onChange={event => onChange({ generateAudio: event.target.checked })} />生成声音</label>}
      <p className="h3-safety-note">{settings.engine === 'minimax' ? context === 'canvas' ? '海螺接口支持文生与单张首帧，768P 支持 6/10 秒，1080P 支持 6 秒，输出无声视频。' : '海螺接口：768P 支持 6/10 秒，1080P 支持 6 秒，输出无声视频。导演分镜的多图参考请使用本机 H3 或 Seedance；MiniMax 可提交独立的文生提示词。' : '多图参考请配置 Seedance 2.0 系列模型。分辨率与声音以模型权限为准。'}提示词继续共用，点击生成按钮时才会提交。</p>
    </>}
  </section>;
}

export function CloudVideoTaskActions({ taskId, phase }: { taskId: string; phase?: unknown }) {
  const [remoteId, setRemoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/videos/generations/${encodeURIComponent(taskId)}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作未完成。');
      setMessage(action === 'retry-download' ? result.task?.errorMessage || '原任务结果已下载，正在更新镜头状态。' : '核实结果已保存，正在更新镜头状态。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作未完成。'); }
    finally { setBusy(false); }
  }
  if (!['submission_unknown', 'download_failed'].includes(String(phase))) return null;
  return <div className="cloud-video-task-actions">
    {phase === 'download_failed' ? <button disabled={busy} onClick={() => void act('retry-download')}>{busy ? '正在下载原结果…' : '重试下载原结果'}</button> : <>
      <label>服务商任务编号<input value={remoteId} onChange={event => setRemoteId(event.target.value)} placeholder="核实控制台后填写" /></label>
      <button disabled={busy || !remoteId.trim()} onClick={() => void act('reconcile', { remoteTaskId: remoteId.trim() })}>绑定并查询已有任务</button>
      <details><summary>已在服务商控制台核实未接单</summary><p>仅在确认没有生成任务后使用此操作，再由你决定是否重新生成。</p><button disabled={busy} onClick={() => void act('reconcile', { confirmedNotSubmitted: true })}>确认服务商未接单</button></details>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
