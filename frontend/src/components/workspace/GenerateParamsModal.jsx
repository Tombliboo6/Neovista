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
  const modelLabel = normalizedModel === 'nano-banana-pro' ? 'Nano Banana Pro' : 'Nano Banana 2';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-gray-100 rounded transition"
        >
          <X size={18} className="text-gray-500" />
        </button>

        <h3 className="text-lg font-semibold text-gray-800 mb-4">生图参数确认</h3>
        <p className="text-xs text-gray-500 mb-4">当前模型：{modelLabel}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">画质选择</label>
            <div className="flex gap-2">
              {['1K', '2K', '4K'].map(res => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className={`flex-1 py-2 text-sm rounded transition ${
                    resolution === res
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  >
                  <div className="font-medium">{res}</div>
                  <div className={`text-[11px] ${resolution === res ? 'text-white/80' : 'text-gray-500'}`}>
                    {resolutionPricing[res]} 点
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1</span>
              <span>2</span>
              <span>3</span>
              <span>4</span>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
            <div className="text-sm text-gray-700">预计扣费</div>
            <div className="text-lg font-semibold text-blue-700">{totalCost} 点</div>
            <div className="text-xs text-gray-500 mt-1">
              计费规则：当前模型分辨率单价 × 生图数量
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            确认生成
          </button>
        </div>
      </div>
    </div>
  );
}
