import { useState } from 'react';
import { Clock } from 'lucide-react';

export default function RecentProjects() {
  const [projects] = useState(() => {
    const stored = localStorage.getItem('neovista_recent_projects');
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  });

  if (projects.length === 0) return null;

  return (
    <section className="mb-10 mt-10">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="mb-1 text-xs uppercase text-white/40">Recent Archive</p>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white/90">
            <Clock size={18} />
            最近项目
          </h2>
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {projects.map((project) => (
          <div
            key={project.id}
            className="w-52 flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border transition hover:-translate-y-0.5"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-panel)' }}
          >
            <img
              src={project.thumbnail}
              alt={project.name}
              className="h-32 w-full object-cover"
            />
            <div className="p-3">
              <p className="truncate text-sm font-medium text-white/80">{project.name}</p>
              <p className="mt-1 text-xs text-white/40">
                {new Date(project.timestamp).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
