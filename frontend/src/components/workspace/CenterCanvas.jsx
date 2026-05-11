import FabricCanvas from './FabricCanvas';
import { useAppStore } from '../../store/useAppStore';
import { safeCanvasToDataUrl } from '../../lib/canvasExport.js';

export default function CenterCanvas() {
  const setCanvasDataUrl = useAppStore((state) => state.setCanvasDataUrl);

  const exportCanvas = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const dataUrl = safeCanvasToDataUrl(canvas, 'image/png');
      if (dataUrl) setCanvasDataUrl(dataUrl);
    }
  };

  return (
    <div className="flex h-full flex-1 items-center justify-center p-6 lg:p-8" style={{ background: 'var(--surface-0)' }}>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-soft)' }}>
        <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-white/40" style={{ borderColor: 'var(--border-subtle)' }}>
          <span>Canvas Workspace</span>
          <span>Fabric Stage</span>
        </div>
        <div className="min-h-0 flex-1 p-3" onClick={exportCanvas}>
          <div className="h-full w-full overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-paper)' }}>
        <FabricCanvas />
          </div>
        </div>
      </div>
    </div>
  );
}
