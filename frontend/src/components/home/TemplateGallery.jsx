import { useState, useEffect } from 'react';
import { Image, Loader2 } from 'lucide-react';
import TemplateDetailModal from './TemplateDetailModal';

export default function TemplateGallery() {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

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
                  src={template.images[template.images.length - 1].startsWith('http')
                    ? template.images[template.images.length - 1]
                    : template.images[template.images.length - 1]}
                  alt={template.title}
                  className="w-full h-auto"
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

      <TemplateDetailModal
        templateId={selectedTemplateId}
        onClose={() => setSelectedTemplateId(null)}
      />
    </div>
  );
}
