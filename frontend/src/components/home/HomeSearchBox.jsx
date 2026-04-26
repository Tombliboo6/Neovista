import { useState, useRef, useEffect } from 'react';
import { ArrowRight, Box, Image, MapPin, Paperclip, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function HomeSearchBox() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setIsSubmitting(true);
      const newSessionId = crypto.randomUUID();
      navigate('/workspace', { state: { sessionId: newSessionId, initMessage: query.trim() } });
    }
  };

  const tools = [
    { icon: <Paperclip size={15} />, title: '附件', label: '资料' },
    { icon: <Image size={15} />, title: '上传图片', label: '底图' },
    { icon: <Box size={15} />, title: '3D模型', label: '模型' },
    { icon: <MapPin size={15} />, title: '地理定位', label: '区位' },
  ];

  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 pb-8 pt-28 sm:px-6 lg:pt-32">
      <div className="mb-8 grid gap-4 md:grid-cols-[1fr_18rem] md:items-end">
        <div>
          <p className="mb-3 text-xs uppercase text-white/40">NeoVista Design Console</p>
          <h1 className="max-w-3xl font-display text-4xl font-semibold leading-tight text-white/90 md:text-6xl">
            用一句设计意图，启动专业分析图工作流
          </h1>
        </div>
        <div className="hidden border-l pl-5 text-sm leading-6 text-white/45 md:block" style={{ borderColor: 'var(--border-subtle)' }}>
          场地语境、环境性能、概念体块、流线组织与成果展示，统一进入同一个创作入口。
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-[28px] border p-4 transition-all duration-300 sm:p-5"
        style={{
          background: 'var(--surface-1)',
          borderColor: isFocused ? 'var(--accent-primary)' : 'var(--border-subtle)',
          boxShadow: isFocused ? '0 0 0 3px var(--accent-primary-soft), var(--shadow-soft)' : 'var(--shadow-panel)',
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="mt-1 hidden h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl sm:flex"
            style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary-strong)' }}
          >
            <Search size={19} />
          </div>

          <textarea
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="例如：为滨水更新片区生成场地肌理、慢行流线与生态滞洪关系分析图"
            disabled={isSubmitting}
            className="min-h-[112px] flex-1 resize-none bg-transparent text-lg leading-8 text-white/90 placeholder-white/25 focus:outline-none disabled:opacity-60"
          />
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-wrap items-center gap-2">
            {tools.map(({ icon, title, label }) => (
              <button
                key={title}
                type="button"
                className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-white/50 transition hover:bg-white/10 hover:text-white/75 active:scale-[0.98]"
                title={title}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              if (!query.trim() || isSubmitting) return;
              setIsSubmitting(true);
              const newSessionId = crypto.randomUUID();
              navigate('/workspace', { state: { sessionId: newSessionId, initMessage: query.trim() } });
            }}
            disabled={!query.trim() || isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            style={{ background: query.trim() ? 'var(--accent-primary)' : 'var(--surface-3)' }}
          >
            <span>{isSubmitting ? '进入工作区' : '开始分析'}</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {!query.trim() && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/40">
          {['场地与语境分析', '环境与物理性能', '概念与体块推演'].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setQuery(`生成${item}图，要求保留清晰标注、轴测空间关系和专业图例。`);
                inputRef.current?.focus();
              }}
              className="rounded-full border px-3 py-1.5 transition hover:text-white/70"
              style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.025)' }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
