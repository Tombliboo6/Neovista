import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ProjectGrid() {
  const navigate = useNavigate();

  const mockProjects = [
    {
      id: 1,
      name: '场地肌理分析',
      time: '2小时前',
      image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 2,
      name: '日照分析图',
      time: '1天前',
      image: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 3,
      name: '体块推演',
      time: '3天前',
      image: 'https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&w=600&q=80'
    },
    {
      id: 4,
      name: '流线分析',
      time: '1周前',
      image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=600&q=80'
    },
  ];

  return (
    <div className="w-full max-w-6xl mx-auto mt-16 px-6 pb-16">
      <h2 className="text-xl font-semibold text-slate-800 mb-6">最近项目</h2>

      <div className="grid grid-cols-4 gap-6">
        {/* 新建项目卡片 */}
        <button
          onClick={() => navigate('/workspace')}
          className="aspect-square border-2 border-dashed border-gray-200 bg-gray-50/50 rounded-xl flex flex-col items-center justify-center hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 group"
        >
          <Plus size={32} className="text-gray-400 group-hover:text-gray-600 transition-colors mb-2" />
          <span className="text-sm text-gray-500 group-hover:text-gray-700 transition-colors">New Project</span>
        </button>

        {/* 项目卡片 */}
        {mockProjects.map((project) => (
          <div
            key={project.id}
            onClick={() => navigate('/workspace')}
            className="aspect-square bg-white rounded-xl border border-gray-100 overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]"
          >
            <div className="h-3/4 overflow-hidden">
              <img
                src={project.image}
                alt={project.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="h-1/4 p-4 flex flex-col justify-center">
              <h3 className="text-sm font-medium text-slate-800 truncate">{project.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{project.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
