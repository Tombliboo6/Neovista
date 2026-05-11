import { Paperclip, Send, Loader2, X, Bot } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useRef } from 'react';
import toast from 'react-hot-toast';
import { buildGenerationButtonState } from '../../lib/generationRequestState.js';
import {
  collectClipboardImageFiles,
  collectSupportedImageFiles,
  mergeReferenceImages,
  resolveReferenceImages,
} from '../../lib/referenceImages.js';
import { safeCanvasToDataUrl } from '../../lib/canvasExport.js';

const TARGET_MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1536;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.onload = () => {
        let { width, height } = img;
        const originalSize = file.size;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.9;
        let dataUrl = safeCanvasToDataUrl(canvas, 'image/jpeg', quality);
        if (!dataUrl) {
          reject(new Error('图片导出失败'));
          return;
        }
        while (dataUrl.length > TARGET_MAX_BYTES && quality > 0.1) {
          quality -= 0.1;
          dataUrl = safeCanvasToDataUrl(canvas, 'image/jpeg', quality);
          if (!dataUrl) {
            reject(new Error('图片导出失败'));
            return;
          }
        }
        if (dataUrl.length > TARGET_MAX_BYTES) {
          canvas.width = Math.round(width * 0.7);
          canvas.height = Math.round(height * 0.7);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          quality = 0.7;
          dataUrl = safeCanvasToDataUrl(canvas, 'image/jpeg', quality);
          if (!dataUrl) {
            reject(new Error('图片导出失败'));
            return;
          }
        }
        const finalKB = Math.round(dataUrl.length / 1024);
        const originalKB = Math.round(originalSize / 1024);
        resolve({ dataUrl, wasCompressed: originalSize > TARGET_MAX_BYTES, originalKB, finalKB });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function AgentChatInput() {
  const chatInput = useAppStore((s) => s.chatInput);
  const setChatInput = useAppStore((s) => s.setChatInput);
  const isGenerating = useAppStore((s) => s.isGenerating);
  const isGenerationCancelable = useAppStore((s) => s.isGenerationCancelable);
  const isWorkspaceChatLoading = useAppStore((s) => s.isWorkspaceChatLoading);
  const workspaceChat = useAppStore((s) => s.workspaceChat);
  const directChat = useAppStore((s) => s.directChat);
  const generateImage = useAppStore((s) => s.generateImage);
  const cancelActiveGeneration = useAppStore((s) => s.cancelActiveGeneration);
  const fabricInstance = useAppStore((s) => s.fabricInstance);
  const activeSkill = useAppStore((s) => s.activeSkill);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const aspectRatio = useAppStore((s) => s.aspectRatio);
  const setAspectRatio = useAppStore((s) => s.setAspectRatio);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const uploadedImages = useAppStore((s) => s.uploadedImages);
  const setUploadedImages = useAppStore((s) => s.setUploadedImages);
  const removeUploadedImageAt = useAppStore((s) => s.removeUploadedImageAt);
  const fileInputRef = useRef(null);
  const isLoading = isGenerating || isWorkspaceChatLoading;
  const sendButtonState = buildGenerationButtonState({
    isGenerating,
    isGenerationCancelable,
    hasInput: !!chatInput.trim(),
  });

  const getSelectedCanvasImageDataURL = () => {
    if (!fabricInstance) return null;
    const activeObj = fabricInstance.getActiveObject();
    if (activeObj && activeObj.type === 'image') {
      return safeCanvasToDataUrl(activeObj, {
        format: 'jpeg',
        quality: 0.85,
        multiplier: 1,
      });
    }
    return null;
  };

  const resolveImageDataList = () => resolveReferenceImages(uploadedImages, getSelectedCanvasImageDataURL());

  const checkTemplateNeedsUploadedImage = async (templateId) => {
    if (!templateId) return false;
    try {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      const template = await response.json();
      return template.is_i2i === true;
    } catch {
      return false;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !isLoading && chatInput.trim()) {
      e.preventDefault();
      handleSend();
    }
  };

  const replaceUploadedImagesFromFiles = async (files) => {
    if (!files.length) return;

    const toastId = files.some((file) => file.size > TARGET_MAX_BYTES)
      ? toast.loading('图片较大，正在自动压缩...')
      : null;

    try {
      const compressedImages = [];
      let compressedCount = 0;
      let originalKBTotal = 0;
      let finalKBTotal = 0;

      for (const file of files) {
        const { dataUrl, wasCompressed, originalKB, finalKB } = await compressImage(file);
        compressedImages.push(dataUrl);
        originalKBTotal += originalKB;
        finalKBTotal += finalKB;
        if (wasCompressed) {
          compressedCount += 1;
        }
      }

      setUploadedImages(mergeReferenceImages(uploadedImages, compressedImages));
      if (toastId) toast.dismiss(toastId);
      if (compressedCount > 0) {
        toast.success(`已更新 ${compressedImages.length} 张参考图：${originalKBTotal}KB → ${finalKBTotal}KB`, { duration: 3000 });
      }
    } catch (err) {
      if (toastId) toast.dismiss(toastId);
      toast.error('图片处理失败：' + err.message);
    }
  };

  const handleSend = async () => {
    if (isLoading || !chatInput.trim()) return;
    const userInput = chatInput.trim();
    const referenceImages = resolveImageDataList();

    if (agentMode) {
      workspaceChat(userInput, resolveImageDataList());
      setChatInput('');
      return;
    }

    if (activeSkill && selectedModel) {
      const needsImage = await checkTemplateNeedsUploadedImage(activeSkill);
      if (needsImage && referenceImages.length === 0) {
        toast.error('该模板需要先上传参考底图');
        setChatInput('');
        return;
      }
      generateImage(userInput, activeSkill, null, needsImage ? referenceImages : null);
      setChatInput('');
      return;
    }

    if (selectedModel && referenceImages.length > 0) {
      generateImage(userInput, null, null, resolveImageDataList());
      setChatInput('');
      return;
    }

    if (selectedModel && referenceImages.length === 0) {
      generateImage(userInput, null, null, null);
      setChatInput('');
      return;
    }

    directChat(userInput, resolveImageDataList());
    setChatInput('');
  };

  const handlePrimaryAction = () => {
    if (sendButtonState.mode === 'cancel') {
      cancelActiveGeneration();
      return;
    }

    handleSend();
  };

  const handleFileSelect = async (e) => {
    const files = collectSupportedImageFiles(e.target.files || []);
    if (files.length === 0) {
      toast.error('仅支持 JPG/PNG/WebP 格式');
      e.target.value = '';
      return;
    }

    await replaceUploadedImagesFromFiles(files);
    e.target.value = '';
  };

  const handlePaste = async (e) => {
    const files = collectSupportedImageFiles(collectClipboardImageFiles(e.clipboardData));
    if (files.length === 0) return;

    e.preventDefault();
    await replaceUploadedImagesFromFiles(files);
  };

  const ratios = [
    { value: 'auto', label: '跟随模型' },
    { value: '1:1', label: '1:1' },
    { value: '3:4', label: '3:4' },
    { value: '4:3', label: '4:3' },
    { value: '9:16', label: '9:16' },
    { value: '16:9', label: '16:9' },
    { value: '21:9', label: '21:9' },
  ];

  return (
    <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} className="sr-only" />
            <div className="h-4 w-8 rounded-full transition-colors duration-200" style={{ background: agentMode ? 'var(--accent-primary)' : 'rgba(255,255,255,0.16)' }} />
            <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${agentMode ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <Bot size={13} style={{ color: agentMode ? 'var(--accent-primary-strong)' : 'var(--text-muted)' }} />
          <span className="text-xs text-white/50">Agent</span>
        </label>

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          <option value="">仅对话</option>
          <option value="nano-banana-2">Nano 2</option>
          <option value="nano-banana-pro">Nano Pro</option>
          <option value="gpt-image-2">GPT Image 2.0</option>
        </select>

        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          {ratios.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
        </select>
      </div>

      {uploadedImages.length > 0 && (
        <div className="mb-2 flex items-center gap-2 overflow-x-auto rounded-xl border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.025)' }}>
          {uploadedImages.map((imageUrl, index) => (
            <div key={`${index}-${imageUrl.slice(0, 24)}`} className="relative flex-shrink-0">
              <img src={imageUrl} alt="" className="w-10 h-10 object-cover rounded-lg" style={{ border: '1px solid var(--border-subtle)' }} />
              <button
                onClick={() => removeUploadedImageAt(index)}
                className="absolute -top-1 -right-1 p-0.5 rounded-full hover:bg-white/10 transition"
                style={{ background: 'var(--surface-2)' }}
                aria-label={`移除第 ${index + 1} 张参考图`}
              >
                <X size={11} className="text-white/50" />
              </button>
            </div>
          ))}
          <button onClick={() => setUploadedImages([])} className="flex-shrink-0 rounded-lg px-2 py-1 text-[11px] text-white/50 transition hover:bg-white/10">
            清空
          </button>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-panel)' }}>
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isLoading}
          placeholder={agentMode ? '描述需要细化的图面问题、标注或空间关系' : '输入分析图生成要求'}
          className="w-full resize-none bg-transparent px-3 py-3 pr-16 text-sm leading-6 text-white/80 placeholder-white/25 focus:outline-none disabled:opacity-50"
          rows={2}
          style={{ maxHeight: '120px' }}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileSelect} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="rounded-lg p-1.5 transition hover:bg-white/10 disabled:opacity-30"
            title="上传图片"
            aria-label="上传图片"
          >
            <Paperclip size={14} className="text-white/40" />
          </button>
          <button
            onClick={handlePrimaryAction}
            disabled={isWorkspaceChatLoading || sendButtonState.disabled}
            className="rounded-lg p-1.5 transition disabled:opacity-30 active:scale-[0.96]"
            title={sendButtonState.mode === 'cancel' ? '取消生图' : '发送'}
            aria-label={sendButtonState.mode === 'cancel' ? '取消生图' : '发送'}
            style={{
              background: sendButtonState.mode === 'cancel'
                ? 'rgba(239,68,68,0.9)'
                : chatInput.trim() && !isLoading
                  ? 'var(--accent-primary)'
                  : 'var(--surface-2)',
            }}
          >
            {sendButtonState.mode === 'cancel'
              ? <X size={14} className="text-white" />
              : sendButtonState.mode === 'loading'
                ? <Loader2 size={14} className="text-white animate-spin" />
                : <Send size={14} className="text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
