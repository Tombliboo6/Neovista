import { Paperclip, Send, Loader2, X, Bot } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

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
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > TARGET_MAX_BYTES && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > TARGET_MAX_BYTES) {
          canvas.width = Math.round(width * 0.7); canvas.height = Math.round(height * 0.7);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          quality = 0.7;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
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
  const isWorkspaceChatLoading = useAppStore((s) => s.isWorkspaceChatLoading);
  const workspaceChat = useAppStore((s) => s.workspaceChat);
  const directChat = useAppStore((s) => s.directChat);
  const generateImage = useAppStore((s) => s.generateImage);
  const fabricInstance = useAppStore((s) => s.fabricInstance);
  const activeSkill = useAppStore((s) => s.activeSkill);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const aspectRatio = useAppStore((s) => s.aspectRatio);
  const setAspectRatio = useAppStore((s) => s.setAspectRatio);
  const readyToGenerate = useAppStore((s) => s.readyToGenerate);
  const suggestedParams = useAppStore((s) => s.suggestedParams);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const uploadedImage = useAppStore((s) => s.uploadedImage);
  const setUploadedImage = useAppStore((s) => s.setUploadedImage);
  const fileInputRef = useRef(null);
  const isLoading = isGenerating || isWorkspaceChatLoading;

  const getSelectedCanvasImageDataURL = () => {
    if (!fabricInstance) return null;
    const activeObj = fabricInstance.getActiveObject();
    if (activeObj && activeObj.type === 'image') {
      try { return activeObj.toDataURL({ format: 'jpeg', quality: 0.85, multiplier: 1 }); } catch { return null; }
    }
    return null;
  };

  const resolveImageData = () => uploadedImage || getSelectedCanvasImageDataURL() || null;

  const checkTemplateNeedsUploadedImage = async (templateId) => {
    if (!templateId) return false;
    try {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      const template = await response.json();
      return template.is_i2i === true;
    } catch { return false; }
  };

  const buildFinalPromptStructure = async (templateId, suggestedParams) => {
    if (!templateId || !suggestedParams) return null;
    try {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      const template = await response.json();
      if (!template.prompt_structure) return null;
      const finalStructure = { ...template.prompt_structure };
      Object.keys(finalStructure).forEach(key => {
        if (typeof finalStructure[key] === 'string') {
          Object.keys(suggestedParams).forEach(paramKey => {
            finalStructure[key] = finalStructure[key].replace(new RegExp(`{${paramKey}}`, 'g'), suggestedParams[paramKey] || '');
          });
        }
      });
      return finalStructure;
    } catch { return null; }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !isLoading && chatInput.trim()) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    if (isLoading || !chatInput.trim()) return;
    const userInput = chatInput.trim();
    if (agentMode) {
      workspaceChat(userInput, uploadedImage);
      setChatInput('');
      return;
    }
    if (activeSkill && selectedModel) {
      const needsImage = await checkTemplateNeedsUploadedImage(activeSkill);
      const finalImage = resolveImageData();
      if (needsImage && !finalImage) { toast.error('该模板需要先上传参考底图'); setChatInput(''); return; }
      generateImage(userInput, activeSkill, null, needsImage ? finalImage : null);
      setChatInput('');
      return;
    }
    if (selectedModel && (uploadedImage || getSelectedCanvasImageDataURL())) {
      generateImage(userInput, null, null, resolveImageData());
      setChatInput('');
      return;
    }
    if (selectedModel && !uploadedImage) {
      generateImage(userInput, null, null, null);
      setChatInput('');
      return;
    }
    directChat(userInput, uploadedImage);
    setChatInput('');
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) { toast.error('仅支持 JPG/PNG/WebP 格式'); return; }
    const toastId = file.size > TARGET_MAX_BYTES ? toast.loading('图片较大，正在自动压缩...') : null;
    try {
      const { dataUrl, wasCompressed, originalKB, finalKB } = await compressImage(file);
      setUploadedImage(dataUrl);
      if (toastId) toast.dismiss(toastId);
      if (wasCompressed) toast.success(`已自动压缩：${originalKB}KB → ${finalKB}KB`, { duration: 3000 });
    } catch (err) {
      if (toastId) toast.dismiss(toastId);
      toast.error('图片处理失败：' + err.message);
    }
    e.target.value = '';
  };

  const ratios = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'];

  return (
    <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      {/* 控制栏 */}
      <div className="mb-2.5 flex items-center gap-2 flex-wrap">
        {/* CSS Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div className="relative">
            <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} className="sr-only" />
            <div className={`w-8 h-4 rounded-full transition-colors duration-200 ${agentMode ? 'bg-brand-blue' : 'bg-white/20'}`} />
            <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${agentMode ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
          <Bot size={13} className={agentMode ? 'text-brand-blue' : 'text-white/40'} />
          <span className="text-xs text-white/50">Agent</span>
        </label>

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="text-xs rounded-lg px-2 py-1 text-white/60 focus:outline-none focus:ring-1 focus:ring-brand-blue/50"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          <option value="">仅对话</option>
          <option value="nano-banana-2">Nano 2</option>
          <option value="nano-banana-pro">Nano Pro</option>
        </select>

        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
          className="text-xs rounded-lg px-2 py-1 text-white/60 focus:outline-none focus:ring-1 focus:ring-brand-blue/50"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          {ratios.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* 上传图片预览 */}
      {uploadedImage && (
        <div className="mb-2 flex items-center gap-2">
          <img src={uploadedImage} alt="" className="w-10 h-10 object-cover rounded-lg" style={{ border: '1px solid var(--border-subtle)' }} />
          <button onClick={() => setUploadedImage(null)} className="p-1 rounded-lg hover:bg-white/10 transition">
            <X size={13} className="text-white/40" />
          </button>
        </div>
      )}

      {/* 输入框 */}
      <div className="relative rounded-xl overflow-hidden" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={agentMode ? '描述你的设计需求...' : '输入参数直接生图...'}
          className="w-full resize-none bg-transparent px-3 py-2.5 pr-16 text-sm text-white/80 placeholder-white/25 focus:outline-none disabled:opacity-50"
          rows={2}
          style={{ maxHeight: '120px' }}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || (!agentMode && !selectedModel)}
            className="p-1.5 rounded-lg transition hover:bg-white/10 disabled:opacity-30"
            title="上传图片"
          >
            <Paperclip size={14} className="text-white/40" />
          </button>
          <button
            onClick={handleSend}
            disabled={isLoading || !chatInput.trim()}
            className="p-1.5 rounded-lg transition disabled:opacity-30"
            style={{ background: chatInput.trim() && !isLoading ? 'var(--brand-blue)' : 'var(--surface-2)' }}
          >
            {isLoading ? <Loader2 size={14} className="text-white animate-spin" /> : <Send size={14} className="text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
