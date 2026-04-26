import AgentChatInput from './AgentChatInput';
import PromptGallery from './PromptGallery';
import ChatHistory from './ChatHistory';
import { useAppStore } from '../../store/useAppStore';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

export default function RightPanel() {
  const changeTextColor = useAppStore((state) => state.changeTextColor);
  const [showGallery, setShowGallery] = useState(false);
  const colors = ['#11110f', '#b84a3a', '#5f837a', '#4f7a45', '#c89445', '#5d6470'];

  return (
    <aside className="flex h-full min-h-0 w-full flex-col" style={{ background: 'var(--surface-0)', borderLeft: '1px solid var(--border-subtle)' }}>
      <div className="space-y-4 p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <p className="text-[11px] uppercase text-white/35">NeoVista Skills</p>
          <h2 className="mt-1 text-sm font-semibold text-white/85">工作流面板</h2>
        </div>
        <button
          onClick={() => setShowGallery(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white/75 transition hover:text-white active:scale-[0.98]"
          style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <Sparkles size={15} style={{ color: 'var(--accent-premium)' }} />
          Prompt 模板库
        </button>
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHistory />
      </div>
      <AgentChatInput />
      {showGallery && <PromptGallery onClose={() => setShowGallery(false)} />}
    </aside>
  );
}
