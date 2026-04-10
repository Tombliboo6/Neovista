import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { X, Copy, Check } from 'lucide-react';
import ImageCarousel from './ImageCarousel';

export default function PromptGallery({ onClose }) {
  const [templates, setTemplates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [copiedId, setCopiedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const generateImage = useAppStore((state) => state.generateImage);
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

  const handleUsePrompt = (template) => {
    setActiveSkill(template.id);
    setActiveTemplateName(template.title);
    onClose();
  };

  const handleCopy = (id, prompt) => {
    navigator.clipboard.writeText(prompt);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-6xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Prompt 模板库</h2>
            <p className="text-sm text-gray-500 mt-1">精选专业建筑分析图提示词</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={24} />
          </button>
        </div>

        <div className="flex gap-2 px-6 py-4 border-b overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : (
            <div style={{ columnCount: 3, columnGap: '1.5rem' }}>
              {filteredTemplates.map(template => (
                <div key={template.id} className="bg-white border rounded-lg overflow-hidden hover:shadow-lg transition mb-6" style={{ breakInside: 'avoid' }}>
                  <ImageCarousel images={template.images} />
                  <div className="p-4">
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">{template.title}</h3>
                    <p className="text-sm text-gray-600 line-clamp-3 mb-4">
                      {template.tips || template.display_text?.slice(0, 100) || template.real_prompt?.slice(0, 100)}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUsePrompt(template)}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition"
                      >
                        使用此模板
                      </button>
                      <button
                        onClick={() => handleCopy(template.id, template.display_text || template.real_prompt || '')}
                        className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-50 transition"
                      >
                        {copiedId === template.id ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
