import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import './production-queue.css';

const labels: Record<string, string> = { queued: '排队', running: '生成中', validating: '校验中', completed: '已返回', partial: '待处理', failed: '失败', interrupted: '已中断', unknown: '待核对', not_started: '未提交' };
const routes: Record<string, string> = { '/api/characters/profiles': '角色设定', '/api/scenes/proposals': '场景提案', '/api/props/proposals': '道具提案', '/api/storyboards/segments': '文字分镜', '/api/storyboards/board-plans': '宫格规划', '/api/storyboards/boards': '故事板图片', '/api/videos/prompts': '视频提示词', '/api/videos/prompts/repair': '提示词修复' };
const operations: Record<string, string> = { 'extract-character-profiles': '角色设定', 'generate-scene-visual-proposals': '场景提案', 'generate-prop-visual-proposals': '道具提案', 'production-director-review-character-profiles': '总导演复核角色', 'production-director-review-scene-proposals': '总导演复核场景', 'production-director-review-prop-proposals': '总导演复核道具' };

export function ProductionQueue({ projectId, onJobs, children }: { projectId: string; onJobs: (jobs: any[]) => void; children?: ReactNode }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [limits, setLimits] = useState({ textConcurrency: 2, imageConcurrency: 2, requestsPerMinute: 0, tokensPerMinute: 0 });
  const [appliedLimits, setAppliedLimits] = useState<typeof limits | null>(null);
  const [imageLane, setImageLane] = useState<{ active: number; queued: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const edited = useRef(false);
  const [message, setMessage] = useState('');
  const callback = useRef(onJobs); callback.current = onJobs;
  useEffect(() => {
    let cancelled = false, fetching = false;
    const refresh = async () => {
      if (!projectId || fetching) return;
      fetching = true;
      try {
        const response = await fetch(`/api/production-jobs?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('暂时无法读取制作任务；后台记录会保留。');
        const body = await response.json();
        if (!cancelled) {
          setJobs(current => (body.jobs || []).map((job: any) => ({ ...job, detail: current.find(old => old.id === job.id)?.detail })));
          callback.current(body.jobs || []);
          if (body.scheduler?.limits) { setAppliedLimits(body.scheduler.limits); if (!edited.current) setLimits(body.scheduler.limits); }
          if (body.scheduler?.lanes?.image) setImageLane(body.scheduler.lanes.image);
        }
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : '任务状态暂不可用。'); }
      finally { fetching = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 1500);
    void fetch('/api/production-settings').then(response => response.json()).then(body => { if (!cancelled && body.limits) { setAppliedLimits(body.limits); if (!edited.current) setLimits(body.limits); } }).catch(() => {});
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId]);
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/production-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(limits) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '调度设置未保存。');
      edited.current = false;
      setAppliedLimits(body.limits); setLimits(body.limits);
      setMessage(`已生效：文字 ${body.limits.textConcurrency} 路，图片 ${body.limits.imageConcurrency} 路。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '设置保存失败。'); }
    finally { setSaving(false); }
  }
  function editLimits(patch: Partial<typeof limits>) { edited.current = true; setLimits(current => ({ ...current, ...patch })); setMessage(''); }
  const pendingChanges = appliedLimits && JSON.stringify(limits) !== JSON.stringify(appliedLimits);
  async function inspect(id: string) {
    try { const response = await fetch(`/api/production-jobs/${encodeURIComponent(id)}?diagnostics=1`); const body = await response.json(); if (!response.ok || !body.job) throw new Error(body.error || '诊断暂不可用'); setJobs(current => current.map(job => job.id === id ? { ...job, detail: body.job } : job)); } catch (error) { setMessage(error instanceof Error ? error.message : '读取失败'); }
  }
  const active = jobs.filter(job => ['queued', 'running'].includes(job.status));
  const calls = active.flatMap(job => job.calls || []);
  const queued = calls.filter(call => call.phase === 'queued').length;
  const running = calls.filter(call => call.phase === 'running').length;
  return <details className="production-queue" open>
    <summary>并发设置与制作记录{active.length ? running || queued ? ` · 正在生成 ${running} · 排队 ${queued}` : ` · ${active.length} 项处理中` : ''}</summary>
    <div className="production-queue-body">
      <p>任务结果持续保存在本机。生成与修复共用并发额度。</p>
      <p role="status">{appliedLimits ? `当前生效：文字 ${appliedLimits.textConcurrency} 路 · 图片 ${appliedLimits.imageConcurrency} 路` : '正在读取生效设置…'}{imageLane ? ` · 图片执行 ${imageLane.active} · 排队 ${imageLane.queued}` : ''}</p>
      <div className="production-limits">
        <label>文字并发<select disabled={saving} value={limits.textConcurrency} onChange={event => editLimits({ textConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 路{n === 2 ? '（默认）' : ''}</option>)}</select></label>
        <label>图片并发<select disabled={saving} value={limits.imageConcurrency} onChange={event => editLimits({ imageConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} 路</option>)}</select></label>
        <label>每分钟请求上限<input disabled={saving} type="number" min="0" value={limits.requestsPerMinute} onChange={event => editLimits({ requestsPerMinute: Number(event.target.value) })} /></label>
        <label>每分钟估算 Token 上限<input disabled={saving} type="number" min="0" value={limits.tokensPerMinute} onChange={event => editLimits({ tokensPerMinute: Number(event.target.value) })} /></label>
        <button type="button" disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : '保存调度设置'}</button>
      </div>
      <small>速率填 0 表示仅限制并发。请根据服务商额度填写；Token 为保守估算。</small>
      {pendingChanges && <p role="status">有未保存的修改，点击“保存调度设置”后生效。</p>}
      {message && <p role="status">{message}</p>}
      {children}
      {jobs.length === 0 && <p>提交角色、场景、道具提案或分镜任务后，可在这里查看进度和返回原稿。</p>}
      {jobs.slice(-20).reverse().map(job => <details key={job.id} className="production-job">
        <summary>{routes[job.route] || '制作任务'} · {labels[job.status] || job.status}{job.route === '/api/storyboards/boards' ? ` · 已保存 ${(job.result?.boards || []).filter((board: any) => board.status === 'complete' && board.imageUrl).length} 张图片` : job.result?.prompts?.length ? ` · 已保存 ${job.result.prompts.length} 段` : job.result?.segments?.length ? ` · 已保存 ${job.result.segments.length} 段` : ''}</summary>
        {job.error && <p role="status">{job.error}</p>}{job.result?.error && <p>{job.result.error}</p>}
        <small>任务编号：{job.id} · 更新：{new Date(job.updatedAt).toLocaleString()}</small>
        <ul>{(job.calls || []).map((call: any) => <li key={call.callId}><strong>{operations[call.operation] || call.targetKeys?.join('、') || (call.operation === 'plan-storyboard-evidence' ? '整集证据分配' : '制作规划')}</strong> · {labels[call.phase] || call.phase}{call.elapsedMs != null ? ` · ${(call.elapsedMs / 1000).toFixed(1)} 秒` : ''}{call.externalTaskId && <small>请求：{call.externalTaskId}</small>}{call.usage && <small>输入 {call.usage.inputTokens ?? '—'} / 输出 {call.usage.outputTokens ?? '—'} Token</small>}{call.error && <p>{call.error}</p>}</li>)}</ul>
        <button type="button" onClick={() => void inspect(job.id)}>读取请求诊断与返回原稿</button>{job.detail && <pre>{JSON.stringify(job.detail.calls, null, 2)}</pre>}
        {job.result && <details><summary>查看已保存草稿与校验结果</summary><pre>{JSON.stringify(job.result, null, 2)}</pre></details>}
      </details>)}
    </div>
  </details>;
}
