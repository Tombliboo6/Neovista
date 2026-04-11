import { useState, useEffect, useMemo, useRef } from 'react';
import { Image, Loader2 } from 'lucide-react';
import TemplateDetailModal from './TemplateDetailModal';
import LazyImage from '../common/LazyImage';
import {
  getImageLoadingStrategy,
  getNextVisibleCount,
  getPrimaryTemplateImage,
  INITIAL_GALLERY_VISIBLE_COUNT,
} from '../../lib/galleryPerformance.js';

export default function TemplateGallery() {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_GALLERY_VISIBLE_COUNT);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || []);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('加载模版失败:', err);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    setVisibleCount(INITIAL_GALLERY_VISIBLE_COUNT);
  }, [templates.length]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setVisibleCount((current) => getNextVisibleCount(current, templates.length));
    }, {
      rootMargin: '300px 0px',
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [templates.length]);

  const visibleTemplates = useMemo(
    () => templates.slice(0, visibleCount),
    [templates, visibleCount],
  );

  if (isLoading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center justify-center gap-2 text-gray-500 mb-8">
          <Loader2 size={20} className="animate-spin" />
          <span>加载灵感画廊...</span>
        </div>
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg overflow-hidden border border-gray-200 bg-white break-inside-avoid mb-4"
            >
              <div className="aspect-[4/5] animate-pulse bg-slate-100" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-6 py-16">
      <h2 className="text-2xl font-semibold text-slate-800 mb-8">灵感画廊</h2>

      <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
        {visibleTemplates.map((template, index) => {
          const previewImage = getPrimaryTemplateImage(template.images || []);
          const loadingStrategy = getImageLoadingStrategy(index);

          return (
            <button
              key={template.id}
              onClick={() => {
                console.log('[TEMPLATE CARD CLICK]', template.id, template.title);
                setSelectedTemplateId(template.id);
              }}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition text-left relative break-inside-avoid mb-4 w-full"
            >
              {previewImage && (
                <LazyImage
                  src={previewImage}
                  alt={template.title}
                  wrapperClassName="w-full"
                  imgClassName="w-full h-full object-cover"
                  skeletonClassName="bg-slate-100"
                  style={{ aspectRatio: '4 / 5' }}
                  loading={loadingStrategy.loading}
                  fetchPriority={loadingStrategy.fetchPriority}
                />
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
          );
        })}
      </div>

      {visibleCount < templates.length && (
        <div ref={loadMoreRef} className="flex justify-center pt-4 text-xs text-gray-400">
          正在加载更多灵感...
        </div>
      )}

      <TemplateDetailModal
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
