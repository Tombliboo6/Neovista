import { useState, useEffect } from 'react';
import { X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import LazyImage from '../common/LazyImage';

export default function TemplateDetailModal({ templateId, onClose }) {
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const isGenerating = false;
  const token = useAppStore((s) => s.token);
  const setShowAuthModal = useAppStore((s) => s.setShowAuthModal);

  useEffect(() => {
    if (!templateId) return;

    fetch(`/api/v1/templates/${templateId}`)
      .then(res => res.json())
      .then(data => {
        setTemplate(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('加载模版详情失败:', err);
        setLoading(false);
      });
  }, [templateId]);

  useEffect(() => {
    if (!templateId) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [templateId, onClose]);

  if (!templateId) return null;

  const handleUseTemplate = async () => {
    console.log('[TEMPLATE MODAL CONFIRM]', template?.id, template?.title);

    if (!token) {
      setShowAuthModal(true);
      return;
    }

    if (!template) return;

    // 统一跳转到工作区，不在首页直接生图
    navigate('/workspace', {
      state: {
        templateId: template.id,
        templateName: template.title
      }
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border md:flex-row"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-soft)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white/90"
        >
          <X size={20} />
        </button>

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-white/45">加载中...</div>
          </div>
        ) : template ? (
          <>
            <div className="overflow-y-auto p-6 md:w-3/5" style={{ background: 'var(--surface-0)' }}>
              {template.images && template.images.length > 0 ? (
                <div className="space-y-4">
                  {template.images.map((img, idx) => (
                    <LazyImage
                      key={idx}
                      src={img.startsWith('http') ? img : img}
                      alt={`${template.title} - ${idx + 1}`}
                      wrapperClassName="w-full rounded-lg bg-white/[0.08]"
                      imgClassName="w-full h-auto rounded-lg"
                      loading={idx === 0 ? 'eager' : 'lazy'}
                      fetchPriority={idx === 0 ? 'high' : 'auto'}
                      style={{ minHeight: '12rem' }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-white/40">
                  <ImageIcon size={48} />
                </div>
              )}
            </div>

            <div className="md:w-2/5 flex flex-col">
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="mb-4">
                  <span className="text-xs uppercase text-white/40">{template.category}</span>
                  <h2 className="mt-1 text-2xl font-semibold text-white/90">{template.title}</h2>
                </div>

                {template.is_i2i && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border p-3" style={{ background: 'var(--accent-premium-soft)', borderColor: 'rgba(200,148,69,0.24)' }}>
                    <ImageIcon size={16} style={{ color: 'var(--accent-premium)' }} />
                    <span className="text-sm" style={{ color: 'var(--accent-premium)' }}>此模版需要上传参考底图</span>
                  </div>
                )}

                <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/60">
                  {template.display_text}
                </div>
              </div>

              <div className="border-t p-6" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  onClick={handleUseTemplate}
                  disabled={isGenerating}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium text-white transition disabled:opacity-50 active:scale-[0.98]"
                  style={{ background: 'var(--accent-primary)' }}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>生成中...</span>
                    </>
                  ) : (
                    <span>使用此模版</span>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-white/45">模版不存在</div>
          </div>
        )}
      </div>
    </div>
  );
}
