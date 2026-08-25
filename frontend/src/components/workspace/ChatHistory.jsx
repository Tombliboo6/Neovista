import { useAppStore } from '../../store/useAppStore';
import { Trash2, CheckCircle, RotateCcw, FileSearch, ThumbsUp, AlertTriangle, Lightbulb, Download } from 'lucide-react';
import GenerateParamsModal from './GenerateParamsModal';
import toast from 'react-hot-toast';
import { resolveReferenceImages } from '../../lib/referenceImages.js';
import PromptDisclosure from './PromptDisclosure.jsx';
import TemplatePromptPreview from './TemplatePromptPreview.jsx';
import { fetchTemplatePromptPreview } from '../../lib/templatePromptPreview.js';

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
          <div className="mb-1.5 flex items-center gap-1 font-medium" style={{ color: 'var(--accent-primary-strong)' }}>
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

export default function ChatHistory({ storyMode = false }) {
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
  const token = useAppStore((s) => s.token);

  const handleGenerateClick = () => {
    if (!selectedModel) {
      addSystemMessage('提示：请先在右下角选择当前服务器提供的生图模型');
      return;
    }
    setShowGenerateModal(true);
  };

  const handleConfirmGenerate = (params) => {
    setResolution(params.resolution);
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

  const downloadViaLink = (imageUrl, filename) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadImage = async (imageUrl) => {
    if (!imageUrl) return;

    const filename = `neovista-generated-${Date.now()}.png`;
    if (imageUrl.startsWith('data:')) {
      downloadViaLink(imageUrl, filename);
      return;
    }

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error('download failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      downloadViaLink(objectUrl, filename);
      URL.revokeObjectURL(objectUrl);
    } catch {
      downloadViaLink(imageUrl, filename);
      toast('如果浏览器没有直接保存，请在打开的图片中右键另存为');
    }
  };

  const handleConfirmGenerateClick = async () => {
    if (!selectedModel) { toast.error('请先选择生图模型'); return; }
    const templateId = activeSkill || suggestedTemplateId;
    if (!templateId) { toast.error('未找到模板信息'); return; }
    try {
      const response = await fetch(`/api/v1/templates/${templateId}`);
      const template = await response.json();
      if (!response.ok) throw new Error(template.detail || '模板信息加载失败');
      const needsImage = template.is_i2i === true;
      const getCanvasImage = () => {
        if (!fabricInstance) return null;
        const obj = fabricInstance.getObjects().find(o => o.type === 'image');
        if (!obj) return null;
        try { return obj.toDataURL({ format: 'jpeg', quality: 0.85 }); } catch { return null; }
      };
      const resolvedImages = resolveReferenceImages(uploadedImages, getCanvasImage());
      if (needsImage && resolvedImages.length === 0) { toast.error('该模板需要先上传参考底图（或在画布中放置图片）'); return; }
      const preview = await fetchTemplatePromptPreview({
        templateId,
        token,
        parameters: suggestedParams,
      });
      generateImage(
        '',
        templateId,
        preview.promptStructure,
        needsImage ? resolvedImages : null,
        preview.effectivePrompt,
      );
    } catch (error) {
      console.error('确认生成失败:', error);
      toast.error('确认生成失败，请重试');
    }
  };

  if (workspaceChatMessages.length === 0 && !readyToGenerate && !activeTemplateName) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex flex-1 items-center justify-center px-5 text-center">
          <div className="max-w-[260px]">
            <p className="mb-2 text-sm font-medium text-white/70">{storyMode ? '选择一个镜头继续' : '等待你的图面指令'}</p>
            <p className="text-xs leading-5 text-white/40">
              {storyMode ? '在分镜表补齐镜头、轴线与参考图，再编译为可检查的 Seedance 请求。' : '选择模板、上传底图，或直接描述你想生成的分析图。'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-xs font-medium text-white/40">对话历史</span>
        <button onClick={clearChatHistory} className="p-1 rounded transition hover:bg-white/10" title="清空历史">
          <Trash2 size={13} className="text-white/30" />
        </button>
      </div>

      {activeTemplateName && (
        <div className="mx-3 my-2 rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--accent-primary-soft)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="truncate text-xs font-medium" style={{ color: 'var(--accent-primary-strong)' }}>{activeTemplateName}</span>
            <button onClick={clearTemplateState} className="text-xs text-white/30 hover:text-white/60 ml-2 flex-shrink-0">清除</button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGenerateClick} className="flex-1 rounded-lg px-3 py-1.5 text-xs text-white transition active:scale-[0.98]" style={{ background: 'var(--accent-primary)' }}>直接生图</button>
            <button onClick={handleAdjustParams} className="flex-1 px-3 py-1.5 text-white/60 text-xs rounded-lg transition hover:bg-white/10" style={{ border: '1px solid var(--border-subtle)' }}>调整参数</button>
          </div>
          <div className="mt-2">
            <TemplatePromptPreview
              templateId={activeSkill || suggestedTemplateId}
              parameters={(activeSkill || suggestedTemplateId) === suggestedTemplateId ? suggestedParams : null}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {workspaceChatMessages.map((msg, idx) => (
          <div key={idx}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] space-y-2">
                  {msg.imageDatas?.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {msg.imageDatas.map((imageSrc, imageIndex) => (
                        <img
                          key={`${idx}-${imageIndex}`}
                          src={imageSrc}
                          alt=""
                          className="w-full rounded-xl object-cover"
                          style={{ maxHeight: '160px' }}
                        />
                      ))}
                    </div>
                  )}
                  <div className="max-w-[85%] rounded-xl px-3 py-2 text-xs text-white/80" style={{ background: 'var(--surface-2)' }}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ) : msg.role === 'system' ? (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--accent-premium-soft)', color: 'var(--accent-premium)' }}>
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
                    <PromptDisclosure prompt={msg.prompt} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleDownloadImage(msg.imageUrl)}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition hover:bg-white/10"
                        style={{ border: '1px solid var(--border-subtle)', color: 'var(--accent-primary-strong)' }}
                      >
                        <Download size={12} /> 下载原图
                      </button>
                      <button
                        onClick={() => auditDiagram(msg.imageUrl)}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition hover:bg-white/10"
                        style={{ border: '1px solid var(--border-subtle)', color: 'var(--accent-primary-strong)' }}
                      >
                        <FileSearch size={12} /> 审图分析
                      </button>
                    </div>
                  </div>
                )}
                {msg.videoUrl && (
                  <div className="space-y-1.5">
                    <video
                      controls
                      src={msg.videoUrl}
                      className="w-full rounded-xl"
                      style={{ maxHeight: '260px', background: 'black' }}
                    />
                    <p className="text-xs text-white/25 px-1">Seedance 2.0 视频</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {(isGenerating || isWorkspaceChatLoading) && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex gap-1">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: 'var(--accent-primary)', animationDelay: `${delay}ms` }} />
              ))}
            </div>
            <span className="text-xs text-white/40">
              {isGenerating
                ? (isGenerationCancelable ? '生图请求发送中，可在右下角取消...' : '图片处理中...')
                : '思考中...'}
            </span>
          </div>
        )}

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
