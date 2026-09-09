import type { AssetBatchState } from './asset-batch';

export function AssetBatchActions({ label, state, disabled = false, onGenerate, onRetry }: {
  label: string; state: AssetBatchState; disabled?: boolean; onGenerate: () => void; onRetry: () => void;
}) {
  if (!state.total) return null;
  const busy = disabled || state.running > 0;
  return <section className="asset-batch-actions" aria-label={`${label}批量生成`}>
    <div className="asset-batch-summary" role="status" aria-live="polite">
      <strong>{state.completed === state.total ? `全部${label}图已完成` : `批量生成${label}图`}</strong>
      <span>已完成 {state.completed}/{state.total}{state.running > 0 ? ` · ${state.running} 项处理中` : ''}{state.failedKeys.length > 0 ? ` · ${state.failedKeys.length} 项失败` : ''}</span>
    </div>
    {state.readyKeys.length > 0 && <button type="button" className="primary-button" disabled={busy} onClick={onGenerate}>{state.running ? '批量生成中…' : `一键生成${state.completed || state.failedKeys.length ? '剩余' : '全部'}${label}（${state.readyKeys.length}）`}</button>}
    {state.failedKeys.length > 0 && <button type="button" className={state.readyKeys.length ? 'secondary-button' : 'primary-button'} disabled={busy} onClick={onRetry}>重试失败项（{state.failedKeys.length}）</button>}
    {state.blockedKeys.length > 0 && <small>{state.blockedKeys.length} 位角色可先选择已有形象。</small>}
  </section>;
}
