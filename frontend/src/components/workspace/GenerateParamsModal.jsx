import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getImageCapabilityModel } from '../../lib/imageGenerationCapabilities';
import { useAppStore } from '../../store/useAppStore';

export default function GenerateParamsModal({ isOpen, onClose, onConfirm }) {
  const [resolution, setResolution] = useState('');
  const selectedModel = useAppStore((s) => s.selectedModel);
  const imageCapabilities = useAppStore((s) => s.imageCapabilities);
  const loadImageCapabilities = useAppStore((s) => s.loadImageCapabilities);
  const capabilityModel = getImageCapabilityModel(imageCapabilities, selectedModel);
  const resolutionOptions = capabilityModel?.resolutions || [];
  const effectiveResolution = resolutionOptions.some((option) => option.value === resolution)
    ? resolution
    : (resolutionOptions[0]?.value || '');
  const selectedOption = resolutionOptions.find((option) => option.value === effectiveResolution) || null;

  useEffect(() => {
    if (!isOpen) return;
    void loadImageCapabilities();
  }, [isOpen, loadImageCapabilities]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!capabilityModel || !selectedOption) return;
    onConfirm({ resolution: selectedOption.value, numImages: 1 });
    onClose();
  };

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
        <p className="mb-4 text-xs text-white/45">当前模型：{capabilityModel?.label || '能力未加载'}</p>

        {capabilityModel ? <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-white/70">
              {capabilityModel.resolutionSemantics === 'quality' ? '质量档位' : '输出尺寸'}
            </label>
            <div className="flex gap-2">
              {resolutionOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setResolution(option.value)}
                  className="flex-1 rounded-lg py-2 text-sm transition active:scale-[0.98]"
                  style={{
                    background: effectiveResolution === option.value ? 'var(--accent-primary)' : 'var(--surface-2)',
                    color: effectiveResolution === option.value ? '#fff' : 'var(--text-secondary)',
                  }}
                  >
                  <div className="font-medium">{option.label}</div>
                  <div className={`text-[11px] ${effectiveResolution === option.value ? 'text-white/80' : 'text-white/40'}`}>
                    {option.credits} 点
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border px-3 py-2 text-sm text-white/60" style={{ borderColor: 'var(--border-subtle)' }}>
            当前仅支持单张生成，防止重复扣费。
          </div>

          <div className="rounded-xl border px-3 py-2" style={{ background: 'var(--accent-primary-soft)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-sm text-white/70">预计扣费</div>
            <div className="text-lg font-semibold" style={{ color: 'var(--accent-primary-strong)' }}>{selectedOption?.credits ?? '—'} 点</div>
            <div className="mt-1 text-xs text-white/45">
              价格与档位来自当前服务器能力接口
            </div>
          </div>
        </div> : (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-3 text-sm text-amber-100/70">
            生图模型、价格或档位能力尚未通过校验，已禁止提交。
          </div>
        )}

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
            disabled={!capabilityModel || !selectedOption}
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
