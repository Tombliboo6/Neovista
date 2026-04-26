import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ProjectGrid() {
  const navigate = useNavigate();

  const mockProjects = [
    {
      id: 1,
      name: '场地肌理分析',
      time: '2小时前',
      image: '/gallery/image14.png'
    },
    {
      id: 2,
      name: '日照分析图',
      time: '1天前',
      image: '/gallery/image63.png'
    },
    {
      id: 3,
      name: '体块推演',
      time: '3天前',
      image: '/gallery/image108.png'
    },
    {
      id: 4,
      name: '流线分析',
      time: '1周前',
      image: '/gallery/image134.png'
    },
  ];

  return (
    <div className="mx-auto mt-16 w-full max-w-6xl px-6 pb-16">
      <div className="mb-6">
        <p className="mb-1 text-xs uppercase text-white/40">Studio Archive</p>
        <h2 className="text-xl font-semibold text-white/90">最近项目</h2>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <button
          onClick={() => navigate('/workspace')}
          className="group flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed transition-all duration-300 active:scale-[0.98]"
          style={{ borderColor: 'var(--border-strong)', background: 'rgba(255,255,255,0.025)' }}
        >
          <Plus size={30} className="mb-2 text-white/35 transition-colors group-hover:text-white/65" />
          <span className="text-sm text-white/45 transition-colors group-hover:text-white/70">新建项目</span>
        </button>

        {mockProjects.map((project) => (
          <div
            key={project.id}
            onClick={() => navigate('/workspace')}
            className="aspect-square cursor-pointer overflow-hidden rounded-xl border transition-all duration-300 hover:-translate-y-1"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-panel)' }}
          >
            <div className="h-3/4 overflow-hidden">
              <img
                src={project.image}
                alt={project.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="h-1/4 p-4 flex flex-col justify-center">
              <h3 className="truncate text-sm font-medium text-white/80">{project.name}</h3>
              <p className="mt-1 text-xs text-white/40">{project.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
