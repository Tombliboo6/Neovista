import { useState, useEffect } from 'react';
import { Image, Loader2 } from 'lucide-react';
import TemplateDetailModal from './TemplateDetailModal';
import { getApiUrl, getAssetUrl } from '../../lib/url';

const INITIAL_TEMPLATE_COUNT = 12;

export default function TemplateGallery() {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    fetch(getApiUrl(`/v1/templates?limit=${INITIAL_TEMPLATE_COUNT}`))
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || []);
        setHasMore((data.total || 0) > (data.templates || []).length);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('加载模版失败:', err);
        setIsLoading(false);
      });
  }, []);

  const handleLoadMore = () => {
    setIsLoadingMore(true);

    fetch(getApiUrl('/v1/templates'))
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || []);
        setHasMore(false);
        setIsLoadingMore(false);
      })
      .catch(err => {
        console.error('加载更多模版失败:', err);
        setIsLoadingMore(false);
      });
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <Loader2 size={20} className="animate-spin" />
          <span>加载灵感画廊...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-16">
      <h2 className="text-2xl font-semibold text-slate-800 mb-8">灵感画廊</h2>

      <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => {
              console.log('[TEMPLATE CARD CLICK]', template.id, template.title);
              setSelectedTemplateId(template.id);
            }}
            className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition text-left relative break-inside-avoid mb-4 w-full"
          >
            {template.images && template.images.length > 0 && (
              <div className="w-full">
                <img
                  src={getAssetUrl(template.images[template.images.length - 1])}
                  alt={template.title}
                  className="w-full h-auto"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}
            {template.is_i2i && (
              <div className="absolute top-2 right-2 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded flex items-center gap-1">
                <Image size={12} />
                <span>需要底图</span>
              </div>
            )}
            <div className="p-4">
              <h4 className="font-medium text-slate-800 mb-2">{template.title}</h4>
              <p className="text-xs text-gray-500 line-clamp-2">{template.tips || template.display_text || ''}</p>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore && <Loader2 size={16} className="animate-spin" />}
            <span>{isLoadingMore ? '加载更多模版中...' : '查看更多模版'}</span>
          </button>
        </div>
      )}

      <TemplateDetailModal
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
