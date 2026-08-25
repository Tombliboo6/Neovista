import { useEffect, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { fetchTemplatePromptPreview } from '../../lib/templatePromptPreview.js';
import PromptDisclosure from './PromptDisclosure.jsx';

export default function TemplatePromptPreview({
  templateId,
  parameters = null,
  generationMode = 'generate',
  onLoaded = null,
}) {
  const token = useAppStore((state) => state.token);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPrompt('');
    setError('');
  }, [templateId, parameters, generationMode]);

  const handleLoad = async () => {
    if (!token) {
      setError('登录后可查看实际发送提示词');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const preview = await fetchTemplatePromptPreview({
        templateId,
        token,
        parameters,
        generationMode,
      });
      setPrompt(preview.effectivePrompt);
      onLoaded?.(preview);
    } catch (loadError) {
      setError(loadError.message || '提示词加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (prompt) return <PromptDisclosure prompt={prompt} />;

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleLoad}
        disabled={loading}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/75 disabled:opacity-50"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
        {loading ? '正在组装提示词' : '查看实际提示词'}
      </button>
      {error && <p className="px-1 text-[11px] leading-4 text-amber-200/65">{error}</p>}
    </div>
  );
}
