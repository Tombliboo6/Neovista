import AgentChatInput from './AgentChatInput';
import PromptGallery from './PromptGallery';
import ChatHistory from './ChatHistory';
import { useAppStore } from '../../store/useAppStore';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

export default function RightPanel() {
  const changeTextColor = useAppStore((state) => state.changeTextColor);
  const [showGallery, setShowGallery] = useState(false);
  const colors = ['#000000', '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

  return (
    <div className="w-full flex flex-col h-full min-h-0" style={{ background: 'var(--surface-0)', borderLeft: '1px solid var(--border-subtle)' }}>
      <div className="p-4 space-y-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setShowGallery(true)}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:text-white transition flex items-center justify-center gap-2"
          style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <Sparkles size={15} className="text-brand-gold" />
          Prompt 模板库
        </button>
        <div>
          <div className="text-xs text-white/30 mb-2">文字颜色</div>
          <div className="flex gap-2">
            {colors.map(color => (
              <button
                key={color}
                onClick={() => changeTextColor(color)}
                className="w-6 h-6 rounded-full border-2 transition hover:scale-110"
                style={{ backgroundColor: color, borderColor: 'rgba(255,255,255,0.15)' }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatHistory />
      </div>
      <AgentChatInput />
      {showGallery && <PromptGallery onClose={() => setShowGallery(false)} />}
    </div>
  );
}
