import FabricCanvas from './FabricCanvas';
import { useAppStore } from '../../store/useAppStore';

export default function CenterCanvas() {
  const setCanvasDataUrl = useAppStore((state) => state.setCanvasDataUrl);

  const exportCanvas = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setCanvasDataUrl(dataUrl);
    }
  };

  return (
    <div className="flex-1 h-full flex items-center justify-center p-8" style={{ background: 'var(--surface-0)' }}>
      <div className="w-full h-full shadow-lg rounded-lg overflow-hidden" onClick={exportCanvas}>
        <FabricCanvas />
      </div>
    </div>
  );
}
