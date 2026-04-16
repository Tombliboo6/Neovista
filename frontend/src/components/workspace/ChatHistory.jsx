import { useAppStore } from '../../store/useAppStore';
import { User, Bot, Trash2, CheckCircle, RotateCcw, FileSearch, Info, ThumbsUp, AlertTriangle, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import GenerateParamsModal from './GenerateParamsModal';
import toast from 'react-hot-toast';
import { resolveReferenceImages } from '../../lib/referenceImages.js';

function AuditCard({ data }) {
  return (
    <div className="mt-2 rounded-xl overflow-hidden text-xs" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-2)' }}>
      {/* 状态徽章 + overview */}
      <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${data.is_pass ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
          {data.is_pass ? <CheckCircle size={11} /> : <AlertTriangle size={11} />}
          {data.is_pass ? '审核通过' : '需要改进'}
        </span>
        {data.overview && <p className="text-white/70 leading-relaxed">{data.overview}</p>}
      </div>

      {/* 亮点 + 问题 双栏 */}
      {(data.positive?.length > 0 || data.negative?.length > 0) && (
        <div className="grid grid-cols-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="px-3 py-2.5" style={{ borderRight: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-1 text-green-400 font-medium mb-1.5">
              <ThumbsUp size={11} /> 亮点
            </div>
            {data.positive.map((item, i) => (
              <p key={i} className="text-white/60 mb-1 leading-relaxed">· {item}</p>
            ))}
          </div>
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1 text-amber-400 font-medium mb-1.5">
              <AlertTriangle size={11} /> 问题
            </div>
            {data.negative.map((item, i) => (
              <p key={i} className="text-white/60 mb-1 leading-relaxed">· {item}</p>
            ))}
          </div>
        </div>
      )}

      {/* 建议 */}
      {data.suggestions?.length > 0 && (
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1 text-blue-400 font-medium mb-1.5">
            <Lightbulb size={11} /> 建议
          </div>
          {data.suggestions.map((item, i) => (
            <p key={i} className="text-white/60 mb-1 leading-relaxed">{i + 1}. {item}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatHistory() {
  const workspaceChatMessages = useAppStore((s) => s.workspaceChatMessages);
  const clearChatHistory = useAppStore((s) => s.clearChatHistory);
  const readyToGenerate = useAppStore((s) => s.readyToGenerate);
  const suggestedParams = useAppStore((s) => s.suggestedParams);
  const suggestedTemplateId = useAppStore((s) => s.suggestedTemplateId);
  const confirmGenerate = useAppStore((s) => s.confirmGenerate);
  const dismissGenerate = useAppStore((s) => s.dismissGenerate);
  const isGenerating = useAppStore((s) => s.isGenerating);
  const isGenerationCancelable = useAppStore((s) => s.isGenerationCancelable);
  const isWorkspaceChatLoading = useAppStore((s) => s.isWorkspaceChatLoading);
  const setResolution = useAppStore((s) => s.setResolution);
  const resolution = useAppStore((s) => s.resolution);
  const setNumImages = useAppStore((s) => s.setNumImages);
  const auditDiagram = useAppStore((s) => s.auditDiagram);
  const showGenerateModal = useAppStore((s) => s.showGenerateModal);
  const setShowGenerateModal = useAppStore((s) => s.setShowGenerateModal);
  const activeTemplateName = useAppStore((s) => s.activeTemplateName);
  const activeSkill = useAppStore((s) => s.activeSkill);
  const clearTemplateState = useAppStore((s) => s.clearTemplateState);
  const triggerTemplateAdjustParams = useAppStore((s) => s.triggerTemplateAdjustParams);
  const enterTemplateAdjustMode = useAppStore((s) => s.enterTemplateAdjustMode);
  const generateImage = useAppStore((s) => s.generateImage);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const addSystemMessage = useAppStore((s) => s.addSystemMessage);
  const uploadedImages = useAppStore((s) => s.uploadedImages);
  const fabricInstance = useAppStore((s) => s.fabricInstance);

  const handleGenerateClick = () => {
    if (!selectedModel) {
      addSystemMessage('⚠️ 请先在右下角选择生图模型（Nano Banana 2 或 Nano Banana Pro）');
      return;
    }
    setShowGenerateModal(true);
  };

  const handleConfirmGenerate = (params) => {
    setResolution(params.resolution);
    setNumImages(params.numImages);
    if (activeSkill) {
      generateImage('', activeSkill);
    } else {
      confirmGenerate();
    }
  };

  const handleAdjustParams = () => {
    enterTemplateAdjustMode();
    triggerTemplateAdjustParams();
  };

  const handleConfirmGenerateClick = async () => {
    if (!selectedModel) { toast.error('请先选择生图模型'); return; }
    const templateId = activeSkill || suggestedTemplateId;
    if (!templateId) { toast.error('未找到模板信息'); return; }
    try {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      const template = await response.json();
      const needsImage = template.is_i2i === true;
      const getCanvasImage = () => {
        if (!fabricInstance) return null;
        const obj = fabricInstance.getObjects().find(o => o.type === 'image');
        if (!obj) return null;
        try { return obj.toDataURL({ format: 'jpeg', quality: 0.85 }); } catch { return null; }
      };
      const resolvedImages = resolveReferenceImages(uploadedImages, getCanvasImage());
      if (needsImage && resolvedImages.length === 0) { toast.error('该模板需要先上传参考底图（或在画布中放置图片）'); return; }
      const buildFinalPromptStructure = async (templateId, suggestedParams) => {
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
      };
      const finalStructure = await buildFinalPromptStructure(templateId, suggestedParams);
      generateImage('', templateId, finalStructure, needsImage ? resolvedImages : null);
    } catch (error) {
      console.error('确认生成失败:', error);
      toast.error('确认生成失败，请重试');
    }
  };

  if (workspaceChatMessages.length === 0 && !readyToGenerate && !activeTemplateName) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-medium text-white/40">对话历史</span>
        <button onClick={clearChatHistory} className="p-1 rounded transition hover:bg-white/10" title="清空历史">
          <Trash2 size={13} className="text-white/30" />
        </button>
      </div>

      {/* 模板已加载操作区 */}
      {activeTemplateName && (
        <div className="mx-3 my-2 p-3 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid rgba(37,99,235,0.3)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-blue-400 font-medium truncate">{activeTemplateName}</span>
            <button onClick={clearTemplateState} className="text-xs text-white/30 hover:text-white/60 ml-2 flex-shrink-0">清除</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGenerateClick} className="flex-1 px-3 py-1.5 bg-brand-blue text-white text-xs rounded-lg hover:bg-blue-500 transition">直接生图</button>
            <button onClick={handleAdjustParams} className="flex-1 px-3 py-1.5 text-white/60 text-xs rounded-lg transition hover:bg-white/10" style={{ border: '1px solid var(--border-subtle)' }}>调整参数</button>
          </div>
        </div>
      )}

      {/* Feed 流消息列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {workspaceChatMessages.map((msg, idx) => (
          <div key={idx}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] px-3 py-2 rounded-xl text-xs text-white/80" style={{ background: 'var(--surface-2)' }}>
                  {msg.content}
                </div>
              </div>
            ) : msg.role === 'system' ? (
              <div className="px-3 py-2 rounded-lg text-xs text-amber-400/80" style={{ background: 'rgba(245,158,11,0.08)' }}>
                {msg.content}
              </div>
            ) : (
              <div className="space-y-1">
                {/* 审图数据用结构化卡片，否则显示文本 */}
                {msg.auditData ? (
                  <AuditCard data={msg.auditData} />
                ) : (
                  !msg.imageUrl && (
                    <div className="px-3 py-2 rounded-xl text-xs text-white/70 leading-relaxed break-words overflow-hidden w-full" style={{ background: 'var(--surface-1)' }}>
                      {msg.content}
                    </div>
                  )
                )}
                {msg.imageUrl && (
                  <div className="space-y-1.5">
                    <img src={msg.imageUrl} alt="" className="w-full rounded-xl object-cover" style={{ maxHeight: '200px' }} />
                    {msg.templateName && <p className="text-xs text-white/25 px-1">模板：{msg.templateName}</p>}
                    <button
                      onClick={() => auditDiagram(msg.imageUrl)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-blue-400 transition hover:bg-blue-500/10"
                      style={{ border: '1px solid rgba(37,99,235,0.3)' }}
                    >
                      <FileSearch size={12} /> 审图分析
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* 加载动画 */}
        {(isGenerating || isWorkspaceChatLoading) && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex gap-1">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-pulse" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
            <span className="text-xs text-white/40">
              {isGenerating
                ? (isGenerationCancelable ? '生图请求发送中，可在右下角取消...' : '图片处理中...')
                : '思考中...'}
            </span>
          </div>
        )}

        {/* 参数就绪确认区 */}
        {readyToGenerate && suggestedParams && (activeSkill || suggestedTemplateId) && (
          <div className="p-3 rounded-xl" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <p className="text-xs text-green-400 font-medium mb-2">参数已就绪，准备生成</p>
            <div className="flex gap-2">
              <button onClick={handleConfirmGenerateClick} disabled={isGenerating} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-500 transition disabled:opacity-50">
                <CheckCircle size={12} /> 确认生成
              </button>
              <button onClick={dismissGenerate} disabled={isGenerating} className="flex items-center gap-1 px-3 py-1.5 text-white/50 text-xs rounded-lg transition hover:bg-white/10 disabled:opacity-50" style={{ border: '1px solid var(--border-subtle)' }}>
                <RotateCcw size={12} /> 继续调整
              </button>
            </div>
          </div>
        )}
      </div>

      <GenerateParamsModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onConfirm={handleConfirmGenerate}
      />
    </div>
  );
}
