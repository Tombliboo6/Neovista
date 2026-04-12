import { useState, useEffect } from 'react';
import { Heart, TrendingUp, Image, ArrowLeft, Zap, Edit3 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export default function SkillsGallery() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [mode, setMode] = useState(null);
  const [p1Content, setP1Content] = useState({ p1_user: '', p1_content: '' });
  const activeSkill = useAppStore((state) => state.activeSkill);
  const setActiveSkill = useAppStore((state) => state.setActiveSkill);
  const generateImage = useAppStore((state) => state.generateImage);
  const canvasDataUrl = useAppStore((state) => state.canvasDataUrl);

  useEffect(() => {
    fetch('/api/templates')
      .then(res => res.json())
      .then(data => {
        setTemplates(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load templates:', err);
        setLoading(false);
      });
  }, []);

  const handleSkillClick = (template) => {
    setSelectedTemplate(template);
    setActiveSkill(template.id);
    // 初始化为空，让用户看到placeholder引导词
    setP1Content({
      p1_user: '',
      p1_content: ''
    });
  };

  const handleModeSelect = (selectedMode) => {
    if (selectedMode === 'direct') {
      // 直接使用：立即生成
      generateImage('', selectedTemplate.id, null, canvasDataUrl);
      setSelectedTemplate(null);
    } else {
      // 画面内容自定义：显示编辑界面
      setMode('customize');
    }
  };

  const handleGenerate = () => {
    const customPrompt = {
      ...selectedTemplate.prompt_structure,
      p1_user: p1Content.p1_user,
      p1_content: p1Content.p1_content
    };
    generateImage('', selectedTemplate.id, customPrompt, canvasDataUrl);
    setSelectedTemplate(null);
    setMode(null);
  };

  const handleBack = () => {
    if (mode) {
      setMode(null);
    } else {
      setSelectedTemplate(null);
    }
  };

  if (loading) {
    return <div className="p-6 text-gray-400">加载中...</div>;
  }

  // 模式选择界面
  if (selectedTemplate && !mode) {
    return (
      <div className="p-6">
        <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-4">
          <ArrowLeft size={16} />
          返回模版列表
        </button>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-800">{selectedTemplate.title}</h3>
          <p className="text-xs text-gray-500 mt-1">选择使用方式</p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => handleModeSelect('direct')}
            className="w-full p-4 border-2 rounded-lg text-left hover:border-blue-500 hover:bg-blue-50/50 transition"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Zap size={20} className="text-blue-600" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800 mb-1">直接使用</h4>
                <p className="text-sm text-gray-600">一键生成，使用默认参数</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => handleModeSelect('customize')}
            className="w-full p-4 border-2 rounded-lg text-left hover:border-purple-500 hover:bg-purple-50/50 transition"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Edit3 size={20} className="text-purple-600" />
              </div>
              <div>
                <h4 className="font-semibold text-slate-800 mb-1">画面内容自定义</h4>
                <p className="text-sm text-gray-600">编辑主体内容和环境描述</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // P1 编辑界面
  if (selectedTemplate && mode === 'customize') {
    return (
      <div className="p-6">
        <button onClick={handleBack} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 mb-4">
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-800">画面内容自定义</h3>
          <p className="text-xs text-gray-500 mt-1">{selectedTemplate.title}</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              主体与环境
            </label>
            <textarea
              value={p1Content.p1_user}
              onChange={(e) => setP1Content({ ...p1Content, p1_user: e.target.value })}
              placeholder="请用一句通顺的话描述画面的主角和它所处的场景。例如：'一座清水混凝土打造的现代博物馆，静静地坐落在雨后的都市广场中心'..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder:text-gray-500/50"
              rows={4}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              内容细节
            </label>
            <textarea
              value={p1Content.p1_content}
              onChange={(e) => setP1Content({ ...p1Content, p1_content: e.target.value })}
              placeholder="详细描述材质、光照、构图和氛围。例如：'建筑表面有粗糙的木纹质感，下午的阳光洒下丁达尔效应体积光。低角度仰拍，呈现侘寂风表现风格'..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 placeholder:text-gray-500/50"
              rows={4}
            />
          </div>
          <button
            onClick={handleGenerate}
            className="w-full bg-purple-600 text-white px-4 py-3 rounded-lg hover:bg-purple-700 transition"
          >
            生成图片
          </button>
        </div>
      </div>
    );
  }

  // 模版列表
  return (
    <div className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">NeoVista Skills</h3>
        <p className="text-xs text-gray-400">Select a specialized workflow</p>
      </div>

      <div className="flex flex-col gap-4">
        {templates.map((template) => {
          const isActive = activeSkill === template.id;
          return (
            <button
              key={template.id}
              onClick={() => handleSkillClick(template)}
              className={`bg-white border rounded-lg p-4 text-left hover:-translate-y-0.5 transition-all duration-200 relative ${
                isActive ? 'border-blue-500 shadow-sm' : 'border-gray-100 hover:border-blue-500'
              }`}
            >
              {template.is_i2i && (
                <div className="absolute top-2 right-2 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                  <Image size={10} />
                  <span>需底图</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <h4 className="text-sm font-medium text-slate-800">{template.title}</h4>
                    <span className="text-xs text-gray-400">ID: {template.id}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{template.display_text || ''}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Heart size={12} />
                      <span>{template.likes || 0}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <TrendingUp size={12} />
                      <span>{template.uses || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
