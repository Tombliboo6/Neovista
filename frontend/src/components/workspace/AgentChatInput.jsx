import { Paperclip, Send, Loader2, X, Bot, Film, Volume2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useCanvasGraphStore } from '../../store/useCanvasGraphStore';
import { useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { buildGenerationButtonState } from '../../lib/generationRequestState.js';
import {
  collectClipboardImageFiles,
  collectSupportedImageFiles,
  mergeReferenceImages,
  resolveReferenceImages,
} from '../../lib/referenceImages.js';
import { safeCanvasToDataUrl } from '../../lib/canvasExport.js';
import {
  formatSeedanceResolutionLabel,
  isSeedanceModel,
  SEEDANCE_VIDEO_MODE_OPTIONS,
} from '../../lib/videoGeneration.js';
import {
  compareGenerationRequest,
  createGenerationRequestDto,
  createReferenceSignature,
  createReferenceVideoSignature,
  getAvailableVideoModels,
  getVideoModelCapabilities,
  isUsableVideoCapabilities,
} from '../../lib/canvasGenerationDraft.js';
import { getImageCapabilityModel } from '../../lib/imageGenerationCapabilities.js';
import {
  readSeedanceReferenceVideoDuration,
  validateSeedanceReferenceVideoFile,
} from '../../lib/referenceVideo.js';

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
  const generateVideo = useAppStore((s) => s.generateVideo);
  const cancelActiveGeneration = useAppStore((s) => s.cancelActiveGeneration);
  const fabricInstance = useAppStore((s) => s.fabricInstance);
  const activeSkill = useAppStore((s) => s.activeSkill);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const imageCapabilities = useAppStore((s) => s.imageCapabilities);
  const loadImageCapabilities = useAppStore((s) => s.loadImageCapabilities);
  const aspectRatio = useAppStore((s) => s.aspectRatio);
  const setAspectRatio = useAppStore((s) => s.setAspectRatio);
  const videoDurationSeconds = useAppStore((s) => s.videoDurationSeconds);
  const setVideoDurationSeconds = useAppStore((s) => s.setVideoDurationSeconds);
  const videoResolution = useAppStore((s) => s.videoResolution);
  const setVideoResolution = useAppStore((s) => s.setVideoResolution);
  const videoFrameMode = useAppStore((s) => s.videoFrameMode);
  const setVideoFrameMode = useAppStore((s) => s.setVideoFrameMode);
  const videoGenerateAudio = useAppStore((s) => s.videoGenerateAudio);
  const setVideoGenerateAudio = useAppStore((s) => s.setVideoGenerateAudio);
  const seedanceReferenceVideo = useAppStore((s) => s.seedanceReferenceVideo);
  const isSeedanceReferenceVideoUploading = useAppStore((s) => s.isSeedanceReferenceVideoUploading);
  const uploadSeedanceReferenceVideo = useAppStore((s) => s.uploadSeedanceReferenceVideo);
  const clearSeedanceReferenceVideo = useAppStore((s) => s.clearSeedanceReferenceVideo);
  const videoCapabilities = useAppStore((s) => s.videoCapabilities);
  const loadVideoCapabilities = useAppStore((s) => s.loadVideoCapabilities);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const uploadedImages = useAppStore((s) => s.uploadedImages);
  const canvasNodes = useCanvasGraphStore((state) => state.nodes);
  const canvasViewMode = useCanvasGraphStore((state) => state.viewMode);
  const generationDraft = useCanvasGraphStore((state) => state.generationDraft);
  const clearGenerationDraft = useCanvasGraphStore((state) => state.clearGenerationDraft);
  const markGenerationDraftStale = useCanvasGraphStore((state) => state.markGenerationDraftStale);
  const setUploadedImages = useAppStore((s) => s.setUploadedImages);
  const removeUploadedImageAt = useAppStore((s) => s.removeUploadedImageAt);
  const fileInputRef = useRef(null);
  const referenceVideoInputRef = useRef(null);
  const isLoading = isGenerating || isWorkspaceChatLoading || isSeedanceReferenceVideoUploading;
  const sendButtonState = buildGenerationButtonState({
    isGenerating,
    isGenerationCancelable,
    hasInput: !!chatInput.trim(),
  });
  const storyMode = canvasViewMode === 'workflow' && canvasNodes.some((node) => node.type === 'story' || node.type === 'storyboard');
  const inputPlaceholder = storyMode
    ? '先在分镜表编译镜头，再检查并发送 Seedance 请求'
    : (agentMode ? '描述需要细化的图面问题、标注或空间关系' : '输入分析图生成要求');
  const seedanceModels = getAvailableVideoModels(videoCapabilities);
  const activeVideoCapabilities = getVideoModelCapabilities(videoCapabilities, selectedModel);
  const seedanceEnabled = seedanceModels.length > 0;
  const activeSeedanceEnabled = isUsableVideoCapabilities(videoCapabilities, selectedModel);
  const seedanceMinDuration = Number(activeVideoCapabilities?.min_duration_seconds);
  const seedanceMaxDuration = Number(activeVideoCapabilities?.max_duration_seconds);
  const capabilityPricing = activeSeedanceEnabled
    ? activeVideoCapabilities.resolution_credits_per_second
    : null;
  const seedanceResolutionOptions = capabilityPricing
    ? Object.entries(capabilityPricing).map(([value, creditsPerSecond]) => ({
      value,
      label: formatSeedanceResolutionLabel(value),
      creditsPerSecond: Number(creditsPerSecond),
    }))
    : [];
  const selectedCreditsPerSecond = capabilityPricing?.[videoResolution];
  const seedanceUnavailable = isSeedanceModel(selectedModel) && !activeSeedanceEnabled;
  const supportsReferenceVideo = activeSeedanceEnabled
    && activeVideoCapabilities?.supports_reference_video === true;
  const seedanceVideoModeOptions = supportsReferenceVideo
    ? SEEDANCE_VIDEO_MODE_OPTIONS
    : SEEDANCE_VIDEO_MODE_OPTIONS.filter((option) => option.value !== 'reference_video');
  const imageModels = imageCapabilities?.enabled === true ? imageCapabilities.models : [];
  const selectedImageModel = getImageCapabilityModel(imageCapabilities, selectedModel);
  const imageUnavailable = Boolean(selectedModel)
    && !isSeedanceModel(selectedModel)
    && !selectedImageModel;
  const referenceSignature = useMemo(
    () => createReferenceSignature(uploadedImages),
    [uploadedImages],
  );
  const liveDraftRequest = useMemo(() => {
    if (!generationDraft?.request || !activeSeedanceEnabled) return null;
    return createGenerationRequestDto({
      model: selectedModel,
      prompt: chatInput,
      duration: videoDurationSeconds,
      resolution: videoResolution,
      aspectRatio,
      frameMode: videoFrameMode,
      referenceSignature,
      referenceCount: uploadedImages.length,
      hasReferenceVideo: Boolean(seedanceReferenceVideo?.video_url),
      referenceVideoSignature: createReferenceVideoSignature(seedanceReferenceVideo),
      capabilities: videoCapabilities,
    });
  }, [
    aspectRatio,
    chatInput,
    generationDraft?.request,
    referenceSignature,
    seedanceReferenceVideo,
    activeSeedanceEnabled,
    selectedModel,
    uploadedImages.length,
    videoCapabilities,
    videoDurationSeconds,
    videoFrameMode,
    videoResolution,
  ]);
  const draftComparison = generationDraft?.request && liveDraftRequest
    ? compareGenerationRequest(generationDraft.request, liveDraftRequest)
    : null;
  const canvasDraftStale = Boolean(
    generationDraft?.stale
    || (generationDraft?.request && (!draftComparison || draftComparison.stale)),
  );
  const canvasDraftBlocked = isSeedanceModel(selectedModel)
    && storyMode
    && (!generationDraft?.ok || !generationDraft?.request || canvasDraftStale);

  useEffect(() => {
    void loadVideoCapabilities();
  }, [loadVideoCapabilities]);

  useEffect(() => {
    void loadImageCapabilities();
  }, [loadImageCapabilities]);

  useEffect(() => {
    if (!draftComparison?.stale || generationDraft?.stale) return;
    markGenerationDraftStale(draftComparison.changedFields.map((field) => `生成字段已变化：${field}`));
  }, [draftComparison, generationDraft?.stale, markGenerationDraftStale]);

  useEffect(() => {
    if (storyMode && agentMode) setAgentMode(false);
  }, [agentMode, setAgentMode, storyMode]);

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

    if (isSeedanceModel(selectedModel)) {
      if (!activeSeedanceEnabled) {
        toast.error(videoCapabilities?.disabled_reason || 'Seedance 服务当前不可用');
        return;
      }
      if (referenceImages.length > Number(activeVideoCapabilities.max_reference_images)) {
        toast.error(`Seedance 当前最多支持 ${activeVideoCapabilities.max_reference_images} 张参考图`);
        return;
      }
      if (videoFrameMode === 'reference_video' && !seedanceReferenceVideo?.video_url) {
        toast.error('请先上传参考视频');
        return;
      }
      if (storyMode) {
        if (!generationDraft?.ok || !generationDraft?.request) {
          toast.error('请先在分镜表重新编译当前镜头');
          return;
        }
        if (canvasDraftStale || draftComparison?.fingerprint !== generationDraft.requestFingerprint) {
          toast.error('镜头请求已经过期，请重新编译后再发送');
          return;
        }
      }
      void generateVideo(
        userInput,
        referenceImages,
        storyMode ? generationDraft.request : null,
      );
      if (storyMode) clearGenerationDraft();
      setChatInput('');
      return;
    }

    if (selectedModel && !selectedImageModel) {
      toast.error(imageCapabilities?.disabledReason || '生图模型能力未加载，已阻止提交');
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

  const handleReferenceVideoSelect = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!supportsReferenceVideo) {
      toast.error('Seedance 参考视频服务当前不可用');
      return;
    }

    let toastId;
    try {
      validateSeedanceReferenceVideoFile(file);
      const durationSeconds = await readSeedanceReferenceVideoDuration(
        file,
        activeVideoCapabilities?.max_reference_video_duration_seconds,
      );
      toastId = toast.loading('正在上传参考视频...');
      const uploaded = await uploadSeedanceReferenceVideo(file, durationSeconds);
      if (uploaded) {
        toast.success('参考视频已上传，将用于动作与镜头参考');
      }
    } catch (error) {
      toast.error(error.message || '参考视频上传失败');
    } finally {
      if (toastId) toast.dismiss(toastId);
    }
  };

  const handlePaste = async (e) => {
    const files = collectSupportedImageFiles(collectClipboardImageFiles(e.clipboardData));
    if (files.length === 0) return;

    e.preventDefault();
    await replaceUploadedImagesFromFiles(files);
  };

  const ratioValues = isSeedanceModel(selectedModel)
    ? (Array.isArray(activeVideoCapabilities?.aspect_ratios)
      ? activeVideoCapabilities.aspect_ratios
      : [])
    : (selectedImageModel?.aspectRatios || ['auto']);
  const ratios = ratioValues.map((value) => ({
    value,
    label: value === 'auto' ? '跟随模型' : value,
  }));

  return (
    <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        {!storyMode && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className="relative">
              <input type="checkbox" checked={agentMode} onChange={(e) => setAgentMode(e.target.checked)} className="sr-only" />
              <div className="h-4 w-8 rounded-full transition-colors duration-200" style={{ background: agentMode ? 'var(--accent-primary)' : 'rgba(255,255,255,0.16)' }} />
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${agentMode ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <Bot size={13} style={{ color: agentMode ? 'var(--accent-primary-strong)' : 'var(--text-muted)' }} />
            <span className="text-xs text-white/50">Agent</span>
          </label>
        )}

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          <option value="">仅对话</option>
          {imageModels.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
          {seedanceEnabled ? seedanceModels.map((model) => (
            <option key={model.id} value={model.id}>{model.label} 视频</option>
          )) : (
            <option
              value={isSeedanceModel(selectedModel) ? selectedModel : 'seedance-2.0'}
              disabled
            >
              Seedance 视频（暂不可用）
            </option>
          )}
        </select>

        {imageCapabilities && imageCapabilities.enabled !== true && !isSeedanceModel(selectedModel) ? (
          <button
            type="button"
            className="text-[11px] text-amber-300/70 underline decoration-amber-300/20 underline-offset-2"
            onClick={() => void loadImageCapabilities()}
          >
            {imageCapabilities.disabledReason || '生图服务暂不可用'} · 重试
          </button>
        ) : null}

        <select
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
          className="rounded-lg px-2 py-1 text-xs text-white/60 focus:outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
        >
          {ratios.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
        </select>

        {isSeedanceModel(selectedModel) && activeSeedanceEnabled && (
          <>
            <label className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/60" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <span>时长</span>
              <input
                type="number"
                min={seedanceMinDuration}
                max={seedanceMaxDuration}
                step={1}
                value={videoDurationSeconds}
                onChange={(e) => setVideoDurationSeconds(e.target.value)}
                className="w-10 bg-transparent text-right text-white/70 focus:outline-none"
                aria-label="视频时长"
              />
              <span>秒</span>
            </label>

            <label className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/60" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <span>清晰度</span>
              <select
                value={videoResolution}
                onChange={(e) => setVideoResolution(e.target.value)}
                className="bg-transparent text-white/70 focus:outline-none"
                aria-label="视频清晰度"
              >
                {seedanceResolutionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {Number.isFinite(Number(selectedCreditsPerSecond)) ? (
                <span className="text-[11px] text-white/35">{Number(selectedCreditsPerSecond)}点/秒</span>
              ) : null}
            </label>

            <label className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/60" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
              <span>模式</span>
              <select
                value={videoFrameMode}
                onChange={(e) => setVideoFrameMode(e.target.value)}
                className="bg-transparent text-white/70 focus:outline-none"
                aria-label="视频输入模式"
              >
                {seedanceVideoModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-white/60"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}
              title="为生成的视频添加同步音效"
            >
              <Volume2 size={12} style={{ color: videoGenerateAudio ? 'var(--accent-primary-strong)' : 'var(--text-muted)' }} />
              <span>音效</span>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={videoGenerateAudio}
                  onChange={(event) => setVideoGenerateAudio(event.target.checked)}
                  className="sr-only"
                  aria-label="生成音效"
                />
                <div
                  className="h-4 w-8 rounded-full transition-colors duration-200"
                  style={{ background: videoGenerateAudio ? 'var(--accent-primary)' : 'rgba(255,255,255,0.16)' }}
                />
                <div className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform duration-200 ${videoGenerateAudio ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </label>
          </>
        )}
        {isSeedanceModel(selectedModel) && !activeSeedanceEnabled && (
          <button
            type="button"
            className="text-[11px] text-amber-300/70 underline decoration-amber-300/20 underline-offset-2"
            onClick={() => void loadVideoCapabilities()}
          >
            {videoCapabilities?.disabled_reason || '正在检查 Seedance 服务状态…'} · 重试
          </button>
        )}
        {isSeedanceModel(selectedModel) && storyMode && generationDraft?.stale && (
          <span className="text-[11px] text-rose-300/75">
            请求已过期，请回到分镜表重新编译
          </span>
        )}
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

      {isSeedanceModel(selectedModel) && seedanceReferenceVideo && (
        <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.025)' }}>
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--surface-2)' }}>
            <Film size={16} className="text-white/55" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-white/70">{seedanceReferenceVideo.filename}</div>
            <div className="text-[11px] text-white/35">
              参考视频 · {Number(seedanceReferenceVideo.duration_seconds).toFixed(1)}秒
            </div>
          </div>
          <button
            type="button"
            onClick={clearSeedanceReferenceVideo}
            className="rounded-lg p-1.5 transition hover:bg-white/10"
            title="移除参考视频"
            aria-label="移除参考视频"
          >
            <X size={13} className="text-white/45" />
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
          placeholder={inputPlaceholder}
          aria-label={inputPlaceholder}
          className="w-full resize-none bg-transparent px-3 py-3 pr-16 text-sm leading-6 text-white/80 placeholder-white/25 focus:outline-none disabled:opacity-50"
          rows={2}
          style={{ maxHeight: '120px' }}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileSelect} />
          <input ref={referenceVideoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" className="hidden" onChange={handleReferenceVideoSelect} />
          {isSeedanceModel(selectedModel) && supportsReferenceVideo && (
            <button
              type="button"
              onClick={() => referenceVideoInputRef.current?.click()}
              disabled={isLoading}
              className="rounded-lg p-1.5 transition hover:bg-white/10 disabled:opacity-30"
              title={`上传参考视频（最长${activeVideoCapabilities.max_reference_video_duration_seconds}秒，最大24MB）`}
              aria-label="上传参考视频"
            >
              {isSeedanceReferenceVideoUploading
                ? <Loader2 size={14} className="animate-spin text-white/50" />
                : <Film size={14} className="text-white/40" />}
            </button>
          )}
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
            disabled={isWorkspaceChatLoading || sendButtonState.disabled || seedanceUnavailable || imageUnavailable || canvasDraftBlocked}
            className="rounded-lg p-1.5 transition disabled:opacity-30 active:scale-[0.96]"
            title={sendButtonState.mode === 'cancel' ? '取消生图' : '发送'}
            aria-label={sendButtonState.mode === 'cancel' ? '取消生图' : '发送'}
            style={{
              background: sendButtonState.mode === 'cancel'
                ? 'rgba(239,68,68,0.9)'
                : chatInput.trim() && !isLoading && !seedanceUnavailable && !imageUnavailable && !canvasDraftBlocked
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
