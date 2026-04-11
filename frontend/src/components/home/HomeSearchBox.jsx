import { useState, useRef, useEffect } from 'react';
import { Search, Paperclip, Image, Box } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HomeSearchBox() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const handleGlobalKeydown = (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleGlobalKeydown);
    return () => document.removeEventListener('keydown', handleGlobalKeydown);
  }, []);

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && query.trim()) {
      e.preventDefault();
      const newSessionId = crypto.randomUUID();
      navigate('/workspace', { state: { sessionId: newSessionId, initMessage: query.trim() } });
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-32 px-4">
      <div
        className="relative rounded-2xl border px-6 py-5 flex items-center gap-4 transition-all duration-300"
        style={{
          background: 'var(--surface-1)',
          borderColor: isFocused ? 'var(--brand-blue)' : 'var(--border-subtle)',
          boxShadow: isFocused ? '0 0 0 3px rgba(37,99,235,0.15), 0 8px 30px rgba(0,0,0,0.3)' : '0 8px 30px rgba(0,0,0,0.2)',
        }}
      >
        <Search size={20} className="flex-shrink-0" style={{ color: isFocused ? 'var(--brand-blue)' : 'rgba(255,255,255,0.3)' }} />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="描述你的设计需求，AI 将为你生成专业分析图..."
          className="flex-1 text-lg bg-transparent focus:ring-0 focus:outline-none placeholder-white/25 text-white/90"
        />

        <div className="flex items-center gap-1 flex-shrink-0">
          {[{ icon: Paperclip, title: '附件' }, { icon: Image, title: '上传图片' }, { icon: Box, title: '3D模型' }].map(({ icon: Icon, title }) => (
            <button key={title} className="p-2 rounded-lg transition hover:bg-white/10" title={title}>
              <Icon size={18} className="text-white/30 hover:text-white/60 transition" />
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-white/25 text-xs mt-3">按 <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/40 font-mono">/</kbd> 快速聚焦</p>
    </div>
  );
}
