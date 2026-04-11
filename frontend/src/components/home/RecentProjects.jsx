import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export default function RecentProjects() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const stored = localStorage.getItem('neovista_recent_projects');
    if (stored) {
      setProjects(JSON.parse(stored));
    }
  }, []);

  if (projects.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
        <Clock size={20} />
        最近项目
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {projects.map((project) => (
          <div
            key={project.id}
            className="flex-shrink-0 w-48 bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition cursor-pointer"
          >
            <img
              src={project.thumbnail}
              alt={project.name}
              className="w-full h-32 object-cover rounded-t-lg"
            />
            <div className="p-3">
              <p className="text-sm font-medium text-slate-800 truncate">{project.name}</p>
              <p className="text-xs text-gray-500 mt-1">
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
    </div>
  );
}
