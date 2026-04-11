import { useState, useEffect } from 'react';
import { X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import LazyImage from '../common/LazyImage';

export default function TemplateDetailModal({ templateId, onClose }) {
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const generateImage = useAppStore((s) => s.generateImage);
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
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow-lg transition"
        >
          <X size={20} className="text-gray-600" />
        </button>

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-gray-500">加载中...</div>
          </div>
        ) : template ? (
          <>
            <div className="md:w-3/5 bg-gray-50 p-6 overflow-y-auto">
              {template.images && template.images.length > 0 ? (
                <div className="space-y-4">
                  {template.images.map((img, idx) => (
                    <LazyImage
                      key={idx}
                      src={img.startsWith('http') ? img : img}
                      alt={`${template.title} - ${idx + 1}`}
                      wrapperClassName="w-full rounded-lg bg-slate-100"
                      imgClassName="w-full h-auto rounded-lg"
                      loading={idx === 0 ? 'eager' : 'lazy'}
                      fetchPriority={idx === 0 ? 'high' : 'auto'}
                      style={{ minHeight: '12rem' }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <ImageIcon size={48} />
                </div>
              )}
            </div>

            <div className="md:w-2/5 flex flex-col">
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="mb-4">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">{template.category}</span>
                  <h2 className="text-2xl font-semibold text-slate-800 mt-1">{template.title}</h2>
                </div>

                {template.is_i2i && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                    <ImageIcon size={16} className="text-amber-600" />
                    <span className="text-sm text-amber-900">此模版需要上传参考底图</span>
                  </div>
                )}

                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {template.display_text}
                </div>
              </div>

              <div className="p-6 border-t border-gray-200">
                <button
                  onClick={handleUseTemplate}
                  disabled={isGenerating}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
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
            <div className="text-gray-500">模版不存在</div>
          </div>
        )}
      </div>
    </div>
  );
}
