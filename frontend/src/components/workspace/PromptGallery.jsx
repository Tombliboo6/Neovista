import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { X } from 'lucide-react';
import ImageCarousel from './ImageCarousel';
import TemplatePromptPreview from './TemplatePromptPreview.jsx';
import {
  getTemplateCarouselImages,
  getNextVisibleCount,
  INITIAL_GALLERY_VISIBLE_COUNT,
} from '../../lib/galleryPerformance.js';

export default function PromptGallery({ onClose }) {
  const [templates, setTemplates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(INITIAL_GALLERY_VISIBLE_COUNT);
  const loadMoreRef = useRef(null);
  const setActiveSkill = useAppStore((state) => state.setActiveSkill);
  const setActiveTemplateName = useAppStore((state) => state.setActiveTemplateName);

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load templates:', err);
        setLoading(false);
      });
  }, []);

  // 提取大分类
  const getCategoryName = (template) => {
    return template.category_name || template.category_id || '';
  };

  const categories = ['全部', ...new Set(templates.map(t => getCategoryName(t)).filter(Boolean))];

  const filteredTemplates = selectedCategory === '全部'
    ? templates
    : templates.filter(t => getCategoryName(t) === selectedCategory);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setVisibleCount((current) => getNextVisibleCount(current, filteredTemplates.length));
    }, {
      rootMargin: '280px 0px',
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredTemplates.length]);

  const visibleTemplates = useMemo(
    () => filteredTemplates.slice(0, visibleCount),
    [filteredTemplates, visibleCount],
  );

  const handleUsePrompt = (template) => {
    setActiveSkill(template.id);
    setActiveTemplateName(template.title);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center justify-between border-b p-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h2 className="text-2xl font-semibold text-white/90">Prompt 模板库</h2>
            <p className="mt-1 text-sm text-white/45">精选专业建筑分析图提示词</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white/80" title="关闭">
            <X size={24} />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b px-6 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat);
                setVisibleCount(INITIAL_GALLERY_VISIBLE_COUNT);
              }}
              className="whitespace-nowrap rounded-full px-4 py-2 text-sm transition active:scale-[0.98]"
              style={{
                background: selectedCategory === cat ? 'var(--accent-primary)' : 'var(--surface-2)',
                color: selectedCategory === cat ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-white/45">加载中...</div>
            </div>
          ) : (
            <div style={{ columnCount: 3, columnGap: '1.5rem' }}>
              {visibleTemplates.map((template, index) => (
                <div key={template.id} className="mb-6 overflow-hidden rounded-xl border transition hover:-translate-y-0.5" style={{ breakInside: 'avoid', background: 'var(--surface-0)', borderColor: 'var(--border-subtle)' }}>
                  <ImageCarousel images={getTemplateCarouselImages(template)} cardIndex={index} />
                  <div className="p-4">
                    <h3 className="mb-2 text-sm font-semibold text-white/85">{template.title}</h3>
                    <p className="mb-4 line-clamp-3 text-sm leading-6 text-white/50">
                      {template.tips || template.display_text?.slice(0, 100) || template.real_prompt?.slice(0, 100)}
                    </p>
                    <div className="space-y-2">
                      <button
                        onClick={() => handleUsePrompt(template)}
                        className="w-full rounded-lg px-3 py-2 text-sm text-white transition active:scale-[0.98]"
                        style={{ background: 'var(--accent-primary)' }}
                      >
                        使用此模板
                      </button>
                      <TemplatePromptPreview templateId={template.id} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && visibleCount < filteredTemplates.length && (
          <div ref={loadMoreRef} className="pb-6 text-center text-xs text-white/40">
            正在加载更多模板...
          </div>
        )}
      </div>
    </div>
  );
}
