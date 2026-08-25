import { useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';

export default function PromptDisclosure({ prompt, label = '实际发送提示词' }) {
  const [copied, setCopied] = useState(false);
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) return null;

  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(normalizedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <details className="group rounded-lg border border-white/10 bg-black/15">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs text-white/55">
        <span>{label}</span>
        <ChevronDown size={13} className="transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white/75"
            title="复制提示词"
            aria-label="复制提示词"
          >
            {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
          </button>
        </div>
        <pre className="max-h-56 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-white/65">{normalizedPrompt}</pre>
      </div>
    </details>
  );
}
