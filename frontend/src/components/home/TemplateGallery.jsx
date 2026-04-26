import { useState, useEffect, useMemo, useRef } from 'react';
import { Image, Loader2 } from 'lucide-react';
import TemplateDetailModal from './TemplateDetailModal';
import LazyImage from '../common/LazyImage';
import {
  getGalleryCardMediaPresentation,
  getImageLoadingStrategy,
  getNextVisibleCount,
  getPrimaryTemplateImage,
  INITIAL_GALLERY_VISIBLE_COUNT,
} from '../../lib/galleryPerformance.js';

export default function TemplateGallery() {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_GALLERY_VISIBLE_COUNT);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || []);
        setLoadError(false);
        setVisibleCount(INITIAL_GALLERY_VISIBLE_COUNT);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('加载模版失败:', err);
        setLoadError(true);
        setIsLoading(false);
      });
  }, []);

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
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-8 flex items-center justify-center gap-2 text-white/45">
          <Loader2 size={18} className="animate-spin" />
          <span>加载工作流画廊...</span>
        </div>
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="mb-4 break-inside-avoid overflow-hidden rounded-xl border"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="min-h-64 animate-pulse bg-white/5" />
              <div className="p-4 space-y-2">
                <div className="h-4 animate-pulse rounded bg-white/[0.08]" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.08]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="rounded-xl border px-5 py-6 text-sm text-white/60" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}>
          模板画廊暂时无法加载，请稍后重试。
        </div>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-6 py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs uppercase text-white/40">Workflow Library</p>
          <h2 className="text-2xl font-semibold text-white/90">专业分析图模板</h2>
        </div>
        <p className="hidden max-w-sm text-right text-sm leading-6 text-white/45 md:block">
          选择一个场景模板，进入工作区后继续补充底图、参数与图面标注。
        </p>
      </div>

      <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
        {visibleTemplates.map((template, index) => {
          const previewImage = template.thumbnail_image || getPrimaryTemplateImage(template.images || []);
          const loadingStrategy = getImageLoadingStrategy(index);
          const mediaPresentation = getGalleryCardMediaPresentation();

          return (
            <button
              key={template.id}
              onClick={() => {
                setSelectedTemplateId(template.id);
              }}
              className="relative mb-4 w-full break-inside-avoid overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-panel)' }}
            >
              {previewImage && (
                <LazyImage
                  src={previewImage}
                  alt={template.title}
                  wrapperClassName={mediaPresentation.wrapperClassName}
                  imgClassName={mediaPresentation.imgClassName}
                  skeletonClassName="bg-white/[0.08]"
                  style={mediaPresentation.style}
                  loading={loadingStrategy.loading}
                  fetchPriority={loadingStrategy.fetchPriority}
                />
              )}
              {template.is_i2i && (
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--accent-premium-soft)', color: 'var(--accent-premium)' }}>
                  <Image size={12} />
                  <span>需要底图</span>
                </div>
              )}
              <div className="p-4">
                <h4 className="mb-2 font-medium text-white/80">{template.title}</h4>
                <p className="line-clamp-2 text-xs leading-5 text-white/45">{template.tips || template.display_text || ''}</p>
              </div>
            </button>
          );
        })}
      </div>

      {visibleCount < templates.length && (
        <div ref={loadMoreRef} className="flex justify-center pt-4 text-xs text-white/40">
          正在加载更多模板...
        </div>
      )}

      <TemplateDetailModal
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </section>
  );
}
