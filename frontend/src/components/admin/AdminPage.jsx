import { useState, useEffect } from 'react';
import { Edit2, Trash2, Plus, Save, X, Image as ImageIcon } from 'lucide-react';
import TemplateDetailModal from '../home/TemplateDetailModal';

export default function AdminPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const adminToken = localStorage.getItem('adminToken');

  useEffect(() => {
    if (!adminToken) {
      const token = window.prompt('请输入管理员密钥：');
      if (token) {
        localStorage.setItem('adminToken', token);
        window.location.reload();
      } else {
        window.location.href = '/';
      }
    } else {
      loadTemplates();
    }
  }, [adminToken]);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/v1/admin/templates', {
        headers: { 'x-admin-token': adminToken }
      });
      if (response.status === 403) {
        localStorage.removeItem('adminToken');
        window.location.reload();
        return;
      }
      const data = await response.json();
      setTemplates(data.templates);
    } catch (error) {
      console.error('加载失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800">模版管理后台</h1>
          <button
            onClick={() => window.location.href = '/'}
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            返回首页
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">加载中...</div>
        ) : (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="relative bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition break-inside-avoid mb-4 w-full group"
              >
                <button
                  onClick={() => setSelectedTemplateId(template.id)}
                  className="w-full text-left"
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
                      <ImageIcon size={12} />
                      <span>需要底图</span>
                    </div>
                  )}
                  <div className="p-4">
                    <h4 className="font-medium text-slate-800 mb-2">{template.title}</h4>
                    <p className="text-xs text-gray-500 line-clamp-2">{template.display_text}</p>
                  </div>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTemplate(template);
                    setShowModal(true);
                  }}
                  className="absolute bottom-4 right-4 p-2 bg-blue-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition shadow-lg hover:bg-blue-700"
                  title="编辑模版"
                >
                  <Edit2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showModal && editingTemplate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">编辑模版: {editingTemplate.id}</h2>
                <button onClick={() => setShowModal(false)}>
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">标题</label>
                  <input
                    type="text"
                    value={editingTemplate.title}
                    onChange={(e) => setEditingTemplate({...editingTemplate, title: e.target.value})}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">分类</label>
                  <input
                    type="text"
                    value={editingTemplate.category}
                    onChange={(e) => setEditingTemplate({...editingTemplate, category: e.target.value})}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editingTemplate.is_i2i}
                      onChange={(e) => setEditingTemplate({...editingTemplate, is_i2i: e.target.checked})}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium">是否为图生图模版（需要底图）</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">图片URL（每行一个）</label>
                  <textarea
                    value={(editingTemplate.images || []).join('\n')}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      images: e.target.value.split('\n').filter(url => url.trim())
                    })}
                    className="w-full border rounded px-3 py-2 h-24 text-sm font-mono"
                    placeholder="/static/template_images/1_1_1_0.png"
                  />
                  <p className="text-xs text-gray-500 mt-1">示例: /static/template_images/9_3_3_0.png</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P0 - 文字与标识</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p0_text || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p0_text: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-20 text-sm"
                    placeholder="标题、数据标注、字体等文字内容"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P1 - 主体与环境</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p1_user || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p1_user: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-24 text-sm"
                    placeholder="用户输入指令、主体内容描述"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P1 - 内容细节</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p1_content || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p1_content: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-24 text-sm"
                    placeholder="功能分析、空间关系等内容描述"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P2 - 光影与氛围</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p2_lighting || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p2_lighting: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-20 text-sm"
                    placeholder="光照、阴影、氛围描述"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P3 - 构图镜头色彩</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p3_composition || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p3_composition: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-20 text-sm"
                    placeholder="构图、视角、色彩体系"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P4 - 媒介与渲染</label>
                  <textarea
                    value={editingTemplate.prompt_structure?.p4_rendering || ''}
                    onChange={(e) => setEditingTemplate({
                      ...editingTemplate,
                      prompt_structure: {...(editingTemplate.prompt_structure || {}), p4_rendering: e.target.value}
                    })}
                    className="w-full border rounded px-3 py-2 h-20 text-sm"
                    placeholder="风格、渲染质感、媒介"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">前端展示文案 (display_text)</label>
                  <textarea
                    value={editingTemplate.display_text}
                    onChange={(e) => setEditingTemplate({...editingTemplate, display_text: e.target.value})}
                    className="w-full border rounded px-3 py-2 h-20"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={async () => {
                      try {
                        await fetch(`/api/v1/admin/templates/${editingTemplate.id}`, {
                          method: 'PUT',
                          headers: {
                            'Content-Type': 'application/json',
                            'x-admin-token': adminToken
                          },
                          body: JSON.stringify(editingTemplate)
                        });
                        setShowModal(false);
                        loadTemplates();
                      } catch (error) {
                        alert('保存失败: ' + error.message);
                      }
                    }}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <TemplateDetailModal
          templateId={selectedTemplateId}
          onClose={() => setSelectedTemplateId(null)}
        />
      </div>
    </div>
  );
}
