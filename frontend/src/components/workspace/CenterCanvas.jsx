import FabricCanvas from './FabricCanvas';
import InfiniteCanvas from './canvas/InfiniteCanvas';
import { useCanvasGraphStore } from '../../store/useCanvasGraphStore';
import { ArrowLeft, Workflow } from 'lucide-react';

export default function CenterCanvas() {
  const viewMode = useCanvasGraphStore((state) => state.viewMode);
  const setViewMode = useCanvasGraphStore((state) => state.setViewMode);

  if (viewMode === 'workflow') {
    return <InfiniteCanvas />;
  }

  return (
    <div className="flex h-full flex-1 items-center justify-center p-6 lg:p-8" style={{ background: 'var(--surface-0)' }}>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-white/40" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setViewMode('workflow')}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-white/55 transition hover:bg-white/10 hover:text-white/80"
          >
            <ArrowLeft size={14} />
            返回工作流
          </button>
          <span className="flex items-center gap-2"><Workflow size={13} />Fabric 精修画板</span>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <div className="h-full w-full overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-paper)' }}>
            <FabricCanvas />
          </div>
        </div>
      </div>
    </div>
  );
}
