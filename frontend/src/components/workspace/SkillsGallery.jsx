import { useState, useEffect } from 'react';
import { Heart, TrendingUp, Image, ArrowLeft, Zap, Edit3 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getGalleryApiEndpoint } from '../../lib/galleryPerformance.js';

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
    fetch(getGalleryApiEndpoint())
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || data || []);
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
    return <div className="p-6 text-white/45">加载中...</div>;
  }

  // 模式选择界面
  if (selectedTemplate && !mode) {
    return (
      <div className="p-6">
        <button onClick={handleBack} className="mb-4 flex items-center gap-2 text-sm text-white/50 hover:text-white/80">
          <ArrowLeft size={16} />
          返回模版列表
        </button>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white/90">{selectedTemplate.title}</h3>
          <p className="mt-1 text-xs text-white/45">选择使用方式</p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => handleModeSelect('direct')}
            className="w-full rounded-xl border p-4 text-left transition hover:bg-white/5"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg p-2" style={{ background: 'var(--accent-primary-soft)' }}>
                <Zap size={20} style={{ color: 'var(--accent-primary-strong)' }} />
              </div>
              <div>
                <h4 className="mb-1 font-semibold text-white/85">直接使用</h4>
                <p className="text-sm text-white/50">一键生成，使用默认参数</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => handleModeSelect('customize')}
            className="w-full rounded-xl border p-4 text-left transition hover:bg-white/5"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-lg p-2" style={{ background: 'var(--accent-premium-soft)' }}>
                <Edit3 size={20} style={{ color: 'var(--accent-premium)' }} />
              </div>
              <div>
                <h4 className="mb-1 font-semibold text-white/85">画面内容自定义</h4>
                <p className="text-sm text-white/50">编辑主体内容和环境描述</p>
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
        <button onClick={handleBack} className="mb-4 flex items-center gap-2 text-sm text-white/50 hover:text-white/80">
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white/90">画面内容自定义</h3>
          <p className="mt-1 text-xs text-white/45">{selectedTemplate.title}</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">
              主体与环境
            </label>
            <textarea
              value={p1Content.p1_user}
              onChange={(e) => setP1Content({ ...p1Content, p1_user: e.target.value })}
              placeholder="请用一句通顺的话描述画面的主角和它所处的场景。例如：'一座清水混凝土打造的现代博物馆，静静地坐落在雨后的都市广场中心'..."
              className="w-full rounded-lg border px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
              rows={4}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">
              内容细节
            </label>
            <textarea
              value={p1Content.p1_content}
              onChange={(e) => setP1Content({ ...p1Content, p1_content: e.target.value })}
              placeholder="详细描述材质、光照、构图和氛围。例如：'建筑表面有粗糙的木纹质感，下午的阳光洒下丁达尔效应体积光。低角度仰拍，呈现侘寂风表现风格'..."
              className="w-full rounded-lg border px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none"
              style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
              rows={4}
            />
          </div>
          <button
            onClick={handleGenerate}
            className="w-full rounded-lg px-4 py-3 text-white transition active:scale-[0.98]"
            style={{ background: 'var(--accent-primary)' }}
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
        <h3 className="mb-1 text-lg font-semibold text-white/90">NeoVista Skills</h3>
        <p className="text-xs text-white/45">Select a specialized workflow</p>
      </div>

      <div className="flex flex-col gap-4">
        {templates.map((template) => {
          const isActive = activeSkill === template.id;
          return (
            <button
              key={template.id}
              onClick={() => handleSkillClick(template)}
              className="relative rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5"
              style={{
                background: 'var(--surface-1)',
                borderColor: isActive ? 'var(--accent-primary)' : 'var(--border-subtle)',
              }}
            >
              {template.is_i2i && (
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs" style={{ background: 'var(--accent-premium-soft)', color: 'var(--accent-premium)' }}>
                  <Image size={10} />
                  <span>需底图</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <h4 className="text-sm font-medium text-white/85">{template.title}</h4>
                    <span className="text-xs text-white/35">ID: {template.id}</span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-white/50">{template.display_text || ''}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1 text-xs text-white/40">
                      <Heart size={12} />
                      <span>{template.likes || 0}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-white/40">
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
