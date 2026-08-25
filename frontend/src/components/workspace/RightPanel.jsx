import AgentChatInput from './AgentChatInput';
import PromptGallery from './PromptGallery';
import ChatHistory from './ChatHistory';
import { useAppStore } from '../../store/useAppStore';
import { useCanvasGraphStore } from '../../store/useCanvasGraphStore';
import { createElement, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clapperboard, FileCheck2, MapPin, Sparkles, UserRound } from 'lucide-react';

export default function RightPanel() {
  const changeTextColor = useAppStore((state) => state.changeTextColor);
  const canvasNodes = useCanvasGraphStore((state) => state.nodes);
  const viewMode = useCanvasGraphStore((state) => state.viewMode);
  const generationDraft = useCanvasGraphStore((state) => state.generationDraft);
  const [showGallery, setShowGallery] = useState(false);
  const colors = ['#11110f', '#b84a3a', '#5f837a', '#4f7a45', '#c89445', '#5d6470'];
  const storyMode = viewMode === 'workflow' && canvasNodes.some((node) => node.type === 'story' || node.type === 'storyboard');
  const characterCount = canvasNodes.filter((node) => node.type === 'character').length;
  const sceneCount = canvasNodes.filter((node) => node.type === 'scene').length;
  const shotCount = canvasNodes
    .filter((node) => node.type === 'storyboard')
    .reduce((sum, node) => sum + (node.data?.shots?.length || 0), 0);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col" style={{ background: 'var(--surface-0)', borderLeft: '1px solid var(--border-subtle)' }}>
      <div className="space-y-4 p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <p className="text-[11px] uppercase text-white/35">NeoVista Skills</p>
          <h2 className="mt-1 text-sm font-semibold text-white/85">{storyMode ? '剧情制作面板' : '工作流面板'}</h2>
        </div>
        <button
          onClick={() => setShowGallery(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white/75 transition hover:text-white active:scale-[0.98]"
          style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <Sparkles size={15} style={{ color: 'var(--accent-premium)' }} />
          Prompt 模板库
        </button>
        {storyMode ? (
          <div>
            <div className="mb-2 text-xs text-white/35">项目资产</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: UserRound, label: '角色', value: characterCount },
                { icon: MapPin, label: '场景', value: sceneCount },
                { icon: Clapperboard, label: '镜头', value: shotCount },
              ].map(({ icon, label, value }) => (
                <div key={label} className="rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/35">{createElement(icon, { size: 11 })}{label}</div>
                  <div className="mt-1 text-sm font-semibold text-white/75">{value}</div>
                </div>
              ))}
            </div>
            <section className="mt-3 rounded-xl p-3" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/70">
                  <FileCheck2 size={13} style={{ color: 'var(--accent-primary-strong)' }} />
                  镜头请求预览
                </div>
                {generationDraft ? (
                  <span className={`text-[10px] ${generationDraft.ok && !generationDraft.stale ? 'text-emerald-300/75' : 'text-rose-300/75'}`}>
                    {generationDraft.stale ? '请求已过期' : (generationDraft.ok ? '校验通过' : '校验失败')}
                  </span>
                ) : null}
              </div>

              {!generationDraft ? (
                <p className="mt-2 text-[11px] leading-5 text-white/35">
                  选择一条分镜并点击“编译到 Seedance”，这里会展示真实请求内容和校验结果。
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 font-mono text-[10px] text-white/45">
                    {generationDraft.ok && !generationDraft.stale ? <CheckCircle2 size={12} className="text-emerald-300/70" /> : <AlertTriangle size={12} className="text-rose-300/70" />}
                    {generationDraft.requestFingerprint || generationDraft.id}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                    <div className="flex justify-between gap-2"><dt className="text-white/30">镜头</dt><dd className="truncate text-white/55">{generationDraft.shotTitle || generationDraft.shotIndex}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-white/30">参考图</dt><dd className="text-white/55">{generationDraft.referenceCount || 0} 张</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-white/30">规则</dt><dd className="text-white/55">{generationDraft.continuityRules?.length || 0} 项</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-white/30">时长</dt><dd className="text-white/55">{generationDraft.duration}s</dd></div>
                    {generationDraft.request ? (
                      <>
                        <div className="flex justify-between gap-2"><dt className="text-white/30">清晰度</dt><dd className="text-white/55">{generationDraft.request.resolution}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-white/30">输入模式</dt><dd className="text-white/55">{generationDraft.request.frameMode}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-white/30">预计积分</dt><dd className="text-white/55">{generationDraft.request.estimatedCredits}</dd></div>
                      </>
                    ) : null}
                  </dl>
                  {(generationDraft.staleReasons || []).map((message) => (
                    <p key={message} className="rounded-md bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-200/80">{message}</p>
                  ))}
                  {(generationDraft.errors || []).map((message) => (
                    <p key={message} className="rounded-md bg-rose-400/10 px-2 py-1.5 text-[10px] leading-4 text-rose-200/80">{message}</p>
                  ))}
                  {(generationDraft.warnings || []).map((message) => (
                    <p key={message} className="rounded-md bg-amber-300/10 px-2 py-1.5 text-[10px] leading-4 text-amber-100/65">{message}</p>
                  ))}
                  <div className="text-[10px] leading-4 text-white/35">
                    {[...(generationDraft.sources?.characters || []), ...(generationDraft.sources?.scenes || [])].join(' · ') || '未连接角色或场景资产'}
                  </div>
                  <details className="group rounded-lg bg-black/15 px-2 py-1.5">
                    <summary className="cursor-pointer text-[10px] text-white/50">查看最终提示词</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-[10px] leading-4 text-white/45">{generationDraft.prompt}</pre>
                  </details>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div>
            <div className="mb-2 text-xs text-white/35">文字颜色</div>
            <div className="flex gap-2">
              {colors.map(color => (
                <button
                  key={color}
                  onClick={() => changeTextColor(color)}
                  className="h-6 w-6 rounded-full border-2 transition hover:scale-110"
                  style={{ backgroundColor: color, borderColor: 'rgba(255,255,255,0.18)' }}
                  title={color}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHistory storyMode={storyMode} />
      </div>
      <AgentChatInput />
      {showGallery && <PromptGallery onClose={() => setShowGallery(false)} />}
    </aside>
  );
}
