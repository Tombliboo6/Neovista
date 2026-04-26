import { useState } from 'react';
import { X } from 'lucide-react';
import { calculateGenerationCost, getResolutionPricing, normalizeGenerationModel } from '../../lib/generationPricing';
import { useAppStore } from '../../store/useAppStore';

export default function GenerateParamsModal({ isOpen, onClose, onConfirm }) {
  const [resolution, setResolution] = useState('2K');
  const [numImages, setNumImages] = useState(1);
  const selectedModel = useAppStore((s) => s.selectedModel);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm({ resolution, numImages });
    onClose();
  };

  const normalizedModel = normalizeGenerationModel(selectedModel);
  const resolutionPricing = getResolutionPricing(normalizedModel);
  const totalCost = calculateGenerationCost(resolution, numImages, normalizedModel);
  const modelLabel = normalizedModel === 'nano-banana-pro'
    ? 'Nano Banana Pro'
    : normalizedModel === 'gpt-image-2'
      ? 'GPT Image 2.0'
      : 'Nano Banana 2';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-md rounded-2xl border p-6"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-soft)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white/80"
        >
          <X size={18} />
        </button>

        <h3 className="mb-2 text-lg font-semibold text-white/90">生图参数确认</h3>
        <p className="mb-4 text-xs text-white/45">当前模型：{modelLabel}</p>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">画质选择</label>
            <div className="flex gap-2">
              {['1K', '2K', '4K'].map(res => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className="flex-1 rounded-lg py-2 text-sm transition active:scale-[0.98]"
                  style={{
                    background: resolution === res ? 'var(--accent-primary)' : 'var(--surface-2)',
                    color: resolution === res ? '#fff' : 'var(--text-secondary)',
                  }}
                  >
                  <div className="font-medium">{res}</div>
                  <div className={`text-[11px] ${resolution === res ? 'text-white/80' : 'text-white/40'}`}>
                    {resolutionPricing[res]} 点
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">
              生图数量：{numImages} 张
            </label>
            <input
              type="range"
              min="1"
              max="4"
              value={numImages}
              onChange={(e) => setNumImages(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="mt-1 flex justify-between text-xs text-white/40">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
            </div>
          </div>

          <div className="rounded-xl border px-3 py-2" style={{ background: 'var(--accent-primary-soft)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-sm text-white/70">预计扣费</div>
            <div className="text-lg font-semibold" style={{ color: 'var(--accent-primary-strong)' }}>{totalCost} 点</div>
            <div className="mt-1 text-xs text-white/45">
              计费规则：当前模型分辨率单价 × 生图数量
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg px-4 py-2 text-white/65 transition hover:bg-white/10"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 rounded-lg px-4 py-2 text-white transition active:scale-[0.98]"
            style={{ background: 'var(--accent-primary)' }}
          >
            确认生成
          </button>
        </div>
      </div>
    </div>
  );
}
