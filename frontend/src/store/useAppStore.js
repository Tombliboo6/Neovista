import { create } from 'zustand';
import toast from 'react-hot-toast';
import {
  buildGeneratedImageMessage,
  getGeneratedImageUrlOrThrow,
  summarizeGeneratedImageUrl,
} from './generatedImageUtils.js';
import {
  cancelGenerationRequestState,
  clearGenerationRequestState,
  createGenerationRequestState,
  isAbortGenerationError,
} from '../lib/generationRequestState.js';
import {
  applyThemePreference,
  getStoredThemePreference,
  persistThemePreference,
} from '../lib/themeState.js';
import { normalizeReferenceImages } from '../lib/referenceImages.js';
import { fetchTemplatePromptPreview } from '../lib/templatePromptPreview.js';
import {
  createCanvasSafeFabricImage,
  safeCanvasToDataUrl,
} from '../lib/canvasExport.js';
import {
  getImageCapabilityModel,
  normalizeImageAspectRatio,
  normalizeImageResolution,
  parseImageCapabilities,
} from '../lib/imageGenerationCapabilities.js';
import {
  classifyImageTask,
  clearPendingImageSubmission,
  createImageRequestFingerprint,
  loadPendingImageSubmission,
  persistPendingImageSubmission,
} from '../lib/imageGeneration.js';
import {
  compareGenerationRequest,
  createGenerationRequestDto,
  createReferenceVideoSignature,
  getVideoModelCapabilities,
  isUsableVideoCapabilities,
} from '../lib/canvasGenerationDraft.js';
import {
  buildVideoTaskPollingState,
  clearActiveVideoTask,
  clearPendingVideoSubmission,
  fetchWithAbortTimeout,
  findRecoverableVideoTask,
  getVideoPollRetryDelayMs,
  getVideoUrlOrThrow,
  isActiveVideoTaskOwnedByUser,
  isSeedanceModel,
  isTransientVideoPollStatus,
  loadActiveVideoTask,
  loadPendingVideoSubmission,
  normalizeSeedanceResolution,
  normalizeSeedanceVideoMode,
  normalizeVideoDurationSeconds,
  persistActiveVideoTask,
  persistPendingVideoSubmission,
  VIDEO_POLL_MAX_TRANSIENT_ERRORS,
  VIDEO_POLL_RETRY_MAX_DELAY_MS,
} from '../lib/videoGeneration.js';
import {
  validateSeedanceReferenceVideoDuration,
  validateSeedanceReferenceVideoFile,
} from '../lib/referenceVideo.js';

const initialTheme = getStoredThemePreference();
applyThemePreference(initialTheme);

// API 基础路径（开发和生产都用相对路径，Vite proxy 处理）
const API_BASE = '/api';

const normalizeVideoDurationForCapabilities = (value, capabilities, model = null) => {
  const fallback = normalizeVideoDurationSeconds(value);
  const modelCapabilities = getVideoModelCapabilities(capabilities, model);
  const min = Number(modelCapabilities?.min_duration_seconds);
  const max = Number(modelCapabilities?.max_duration_seconds);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
};

const normalizeVideoResolutionForCapabilities = (value, capabilities, model = null) => {
  const modelCapabilities = getVideoModelCapabilities(capabilities, model);
  const options = modelCapabilities?.resolution_credits_per_second;
  const normalized = String(value || '').trim().toLowerCase();
  if (options && Object.prototype.hasOwnProperty.call(options, normalized)) {
    return normalized;
  }
  const serverDefault = String(modelCapabilities?.default_resolution || '').trim().toLowerCase();
  if (options && Object.prototype.hasOwnProperty.call(options, serverDefault)) {
    return serverDefault;
  }
  return normalizeSeedanceResolution(value);
};

// 规范化后端响应（过滤 JSON，只提取纯文本）
const normalizeBackendReply = (raw) => {
  if (!raw) return '';

  // 如果是对象，直接提取字段
  if (typeof raw === 'object' && raw !== null) {
    if (raw.reply_text) return String(raw.reply_text);
    if (raw.reply) return String(raw.reply);
    if (raw.content) return String(raw.content);
    return '';
  }

  // 如果是字符串，先清理 markdown 代码块
  if (typeof raw === 'string') {
    // 移除 markdown fenced code block（```json ... ``` 或 ``` ... ```）
    let cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim();

    // 尝试解析为 JSON
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.reply_text) return String(parsed.reply_text);
      if (parsed.reply) return String(parsed.reply);
      if (parsed.content) return String(parsed.content);
      return '';
    } catch {
      // 不是 JSON，返回清理后的文本
      return cleaned;
    }
  }

  // 其他类型转为字符串
  return String(raw);
};

// 统一解析 Agent 控制字段
const parseAgentControlPayload = (data) => {
  let replyText = '';
  let readyToGenerate = false;
  let suggestedParams = null;
  let suggestedTemplateId = null;

  // 先从顶层提取
  if (typeof data.ready_to_generate !== 'undefined') {
    readyToGenerate = !!data.ready_to_generate;
  }
  if (data.suggested_params) {
    suggestedParams = data.suggested_params;
  }
  if (data.suggested_template_id) {
    suggestedTemplateId = data.suggested_template_id;
  }

  // 提取 replyText
  replyText = normalizeBackendReply(data.reply || data.reply_text || '');

  // 尝试从 data.reply 中解析 JSON
  if (data.reply && typeof data.reply === 'string') {
    let cleaned = data.reply.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim();
    try {
      const parsed = JSON.parse(cleaned);

      // 如果 JSON 中有控制字段，覆盖顶层字段
      if (typeof parsed.ready_to_generate !== 'undefined') {
        readyToGenerate = !!parsed.ready_to_generate;
      }
      if (parsed.suggested_params) {
        suggestedParams = parsed.suggested_params;
      }
      if (parsed.suggested_template_id) {
        suggestedTemplateId = parsed.suggested_template_id;
      }

      // 提取纯文本
      if (parsed.reply_text) {
        replyText = String(parsed.reply_text);
      } else if (parsed.reply) {
        replyText = String(parsed.reply);
      }
    } catch {
      // 不是 JSON，保持原 replyText
    }
  }

  console.log('[PARSE AGENT PAYLOAD]', {
    readyToGenerate,
    hasSuggestedParams: Boolean(suggestedParams),
    hasSuggestedTemplateId: Boolean(suggestedTemplateId),
    replyTextLength: replyText.length
  });

  return { replyText, readyToGenerate, suggestedParams, suggestedTemplateId };
};

// 智能截断历史记录（UI 与 API 解耦）
const prepareMessagesForAPI = (messages, maxMessages = 10, maxTotalChars = 4000) => {
  // 1. 过滤掉纯 UI 消息
  const apiMessages = messages.filter(msg =>
    msg.role === 'user' || msg.role === 'assistant'
  );

  // 2. 保留最近 N 条
  let trimmedMessages = apiMessages;
  if (apiMessages.length > maxMessages) {
    trimmedMessages = apiMessages.slice(-maxMessages);
  }

  // 3. 控制总文本长度，优先保留最近消息
  let totalChars = trimmedMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  while (trimmedMessages.length > 1 && totalChars > maxTotalChars) {
    trimmedMessages = trimmedMessages.slice(1);
    totalChars = trimmedMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
  }

  // 4. 确保首条为 user（OpenAI API 要求）
  if (trimmedMessages.length > 0 && trimmedMessages[0].role !== 'user') {
    const firstUserIndex = trimmedMessages.findIndex(msg => msg.role === 'user');
    if (firstUserIndex > 0) {
      trimmedMessages = trimmedMessages.slice(firstUserIndex);
    } else if (firstUserIndex === -1) {
      return [];
    }
  }

  // 5. 转换为 API 格式
  return trimmedMessages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
};

const createClientRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const loadFabric = () => import('fabric');

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_MAX_POLL_ATTEMPTS = 600;
const VIDEO_ABSENCE_CONFIRMATION_ATTEMPTS = 3;
const VIDEO_ABSENCE_CONFIRMATION_DELAY_MS = 1000;
const IMAGE_ABSENCE_CONFIRMATION_ATTEMPTS = 3;
const IMAGE_ABSENCE_CONFIRMATION_DELAY_MS = 1000;
const IMAGE_SUBMISSION_SAFETY_WINDOW_MS = 60000;
let videoCapabilitiesLoadPromise = null;
let imageCapabilitiesLoadPromise = null;

const sleepWithAbort = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Aborted', 'AbortError'));
    return;
  }

  const handleAbort = () => {
    clearTimeout(timeoutId);
    reject(new DOMException('Aborted', 'AbortError'));
  };
  const timeoutId = setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', handleAbort, { once: true });
  if (signal?.aborted) {
    handleAbort();
  }
});

const readResponseJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const getApiErrorMessage = (payload, fallback) => {
  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  if (detail && typeof detail === 'object') {
    const message = detail.message || detail.detail;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

const appendWorkspaceMessage = (set, get, message) => {
  set({ workspaceChatMessages: [...get().workspaceChatMessages, message] });
};

const persistVideoTaskState = (set, task, expectedCurrentTaskId = null) => {
  const persistedTask = persistActiveVideoTask(
    task,
    globalThis.localStorage,
    expectedCurrentTaskId,
  );
  if (persistedTask) {
    set({ activeVideoTask: persistedTask });
  }
  return persistedTask;
};

const clearAccountScopedGenerationState = () => ({
  ...clearGenerationRequestState(),
  pendingImageRequest: null,
  isRecoveringImageRequest: false,
  activeVideoTask: null,
  activeVideoPollingTaskId: null,
  isRecoveringVideoTask: false,
  isGenerating: false,
  workspaceChatMessages: [],
  uploadedImages: [],
  seedanceReferenceVideo: null,
  isSeedanceReferenceVideoUploading: false,
  generatedImage: null,
  canvasDataUrl: null,
});

const isSameAuthContext = (get, { token, ownerUserId, authEpoch }) => (
  get().token === token
  && get().authEpoch === authEpoch
  && String(get().user?.id ?? '') === String(ownerUserId ?? '')
);

const isValidServerVideoTask = (task) => Boolean(
  task
  && typeof task === 'object'
  && String(task.task_id || '').trim()
  && String(task.request_id || '').trim()
);

const lookupSeedanceTaskForRecovery = async ({ token, requestId, signal = null }) => {
  const normalizedRequestId = String(requestId || '').trim();
  if (normalizedRequestId) {
    const requestResponse = await fetchWithAbortTimeout(
      fetch,
      `${API_BASE}/v1/video/tasks/by-request/${encodeURIComponent(normalizedRequestId)}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      },
      { signal, timeoutMs: 10000 },
    );
    if (requestResponse.ok) {
      const task = await readResponseJson(requestResponse);
      return isValidServerVideoTask(task)
        ? { task, absenceConfirmed: false }
        : { task: null, absenceConfirmed: false };
    }
    if (requestResponse.status !== 404) {
      return { task: null, absenceConfirmed: false, status: requestResponse.status };
    }
  }

  const listResponse = await fetchWithAbortTimeout(
    fetch,
    `${API_BASE}/v1/video/tasks?limit=20`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
    { signal, timeoutMs: 10000 },
  );
  if (!listResponse.ok) {
    return { task: null, absenceConfirmed: false, status: listResponse.status };
  }
  const tasks = await readResponseJson(listResponse);
  if (!Array.isArray(tasks)) {
    return { task: null, absenceConfirmed: false };
  }
  const recoverableTask = findRecoverableVideoTask(tasks, normalizedRequestId);
  return {
    task: recoverableTask,
    absenceConfirmed: !recoverableTask,
  };
};

const lookupImageTaskForRecovery = async ({ token, requestId, signal = null }) => {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    return { task: null, absenceConfirmed: false };
  }
  const response = await fetchWithAbortTimeout(
    fetch,
    `${API_BASE}/v1/image/tasks/by-request/${encodeURIComponent(normalizedRequestId)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
    { signal, timeoutMs: 10000 },
  );
  if (response.status === 404) {
    return { task: null, absenceConfirmed: true };
  }
  if (!response.ok) {
    return { task: null, absenceConfirmed: false, status: response.status };
  }
  const task = await readResponseJson(response);
  if (!task || String(task.request_id || '').trim() !== normalizedRequestId) {
    return { task: null, absenceConfirmed: false };
  }
  return { task, absenceConfirmed: false };
};

const isCurrentVideoWatch = (get, controller, taskId, authContext) => (
  get().activeGenerationController === controller
  && get().activeVideoPollingTaskId === taskId
  && isSameAuthContext(get, authContext)
);

const finishVideoWatch = (set, get, controller, taskId, authContext, nextState = {}) => {
  if (!isCurrentVideoWatch(get, controller, taskId, authContext)) {
    return;
  }
  set({
    ...clearGenerationRequestState(),
    activeVideoPollingTaskId: null,
    isGenerating: false,
    ...nextState,
  });
};

const pauseVideoWatch = ({ set, get, generationRequest, task, authContext, message }) => {
  if (!isCurrentVideoWatch(get, generationRequest.controller, task.taskId, authContext)) {
    return;
  }
  const persistedTask = persistVideoTaskState(set, task, task.taskId);
  if (!persistedTask) {
    finishVideoWatch(set, get, generationRequest.controller, task.taskId, authContext, {
      activeVideoTask: loadActiveVideoTask(globalThis.localStorage, authContext.ownerUserId),
    });
    return;
  }
  appendWorkspaceMessage(set, get, {
    role: 'assistant',
    content: message,
  });
  finishVideoWatch(set, get, generationRequest.controller, task.taskId, authContext);
};

const watchSeedanceVideoTask = async ({
  set,
  get,
  task,
  token,
  ownerUserId,
  authEpoch,
  generationRequest,
}) => {
  const authContext = { token, ownerUserId, authEpoch };
  if (!isCurrentVideoWatch(get, generationRequest.controller, task.taskId, authContext)) {
    return;
  }
  let currentTask = persistVideoTaskState(set, task, task.taskId);
  if (!currentTask) {
    finishVideoWatch(set, get, generationRequest.controller, task.taskId, authContext, {
      activeVideoTask: loadActiveVideoTask(globalThis.localStorage, ownerUserId),
    });
    return;
  }
  let consecutiveTransientErrors = 0;
  let consecutiveConfirmedAbsences = 0;
  let nextDelayMs = 0;

  try {
    for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
      if (nextDelayMs > 0) {
        await sleepWithAbort(nextDelayMs, generationRequest.signal);
      }
      nextDelayMs = VIDEO_POLL_INTERVAL_MS;

      let taskResponse;
      try {
        taskResponse = await fetchWithAbortTimeout(
          fetch,
          `${API_BASE}/v1/video/tasks/${encodeURIComponent(currentTask.taskId)}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          },
          { signal: generationRequest.signal },
        );
      } catch (error) {
        if (isAbortGenerationError(error)) {
          throw error;
        }

        consecutiveTransientErrors += 1;
        if (consecutiveTransientErrors > VIDEO_POLL_MAX_TRANSIENT_ERRORS) {
          pauseVideoWatch({
            set,
            get,
            generationRequest,
            task: currentTask,
            authContext,
            message: `Seedance 任务仍在云端运行，连续查询失败后已暂停查看。任务 ID：${currentTask.taskId}。刷新页面或重新登录后会自动恢复查询。`,
          });
          return;
        }
        nextDelayMs = getVideoPollRetryDelayMs({ retryAttempt: consecutiveTransientErrors });
        continue;
      }

      if (isTransientVideoPollStatus(taskResponse.status)) {
        consecutiveTransientErrors += 1;
        if (consecutiveTransientErrors > VIDEO_POLL_MAX_TRANSIENT_ERRORS) {
          pauseVideoWatch({
            set,
            get,
            generationRequest,
            task: currentTask,
            authContext,
            message: `Seedance 任务仍在云端运行，上游服务暂时繁忙，已暂停查看。任务 ID：${currentTask.taskId}。刷新页面或重新登录后会自动恢复查询。`,
          });
          return;
        }
        nextDelayMs = getVideoPollRetryDelayMs({
          retryAttempt: consecutiveTransientErrors,
          retryAfter: taskResponse.headers.get('Retry-After'),
        });
        continue;
      }

      let taskData;
      if (taskResponse.status === 404) {
        const recovery = await lookupSeedanceTaskForRecovery({
          token,
          requestId: currentTask.requestId,
          signal: generationRequest.signal,
        });
        if (!isCurrentVideoWatch(get, generationRequest.controller, currentTask.taskId, authContext)) {
          return;
        }
        if (recovery.task?.task_id) {
          consecutiveConfirmedAbsences = 0;
          const recoveredTaskId = String(recovery.task.task_id);
          const previousTaskId = currentTask.taskId;
          const recoveredTask = persistVideoTaskState(set, {
            ...currentTask,
            taskId: recoveredTaskId,
            requestId: recovery.task.request_id || currentTask.requestId,
            lastStatus: recovery.task.status || currentTask.lastStatus,
            lastCheckedAt: Date.now(),
          }, previousTaskId);
          if (!recoveredTask) {
            finishVideoWatch(set, get, generationRequest.controller, previousTaskId, authContext, {
              activeVideoTask: loadActiveVideoTask(globalThis.localStorage, ownerUserId),
            });
            return;
          }
          if (recoveredTaskId !== previousTaskId) {
            clearActiveVideoTask(globalThis.localStorage, previousTaskId, ownerUserId);
            set({ activeVideoPollingTaskId: recoveredTaskId });
          }
          currentTask = recoveredTask;
          taskData = recovery.task;
        } else if (recovery.absenceConfirmed) {
          consecutiveConfirmedAbsences += 1;
          if (consecutiveConfirmedAbsences < VIDEO_ABSENCE_CONFIRMATION_ATTEMPTS) {
            nextDelayMs = VIDEO_ABSENCE_CONFIRMATION_DELAY_MS;
            continue;
          }
          clearActiveVideoTask(globalThis.localStorage, currentTask.taskId, ownerUserId);
          set({ activeVideoTask: null });
          appendWorkspaceMessage(set, get, {
            role: 'assistant',
            content: `Seedance 任务已连续确认不存在，已解除本地恢复锁。任务 ID：${currentTask.taskId}。`,
          });
          finishVideoWatch(set, get, generationRequest.controller, currentTask.taskId, authContext);
          return;
        } else {
          pauseVideoWatch({
            set,
            get,
            generationRequest,
            task: currentTask,
            authContext,
            message: `暂时无法确认 Seedance 任务状态，这不会取消云端生成。任务 ID：${currentTask.taskId}。刷新页面或重新登录后会自动恢复查询。`,
          });
          return;
        }
      } else {
        taskData = await readResponseJson(taskResponse);
      }
      if (!isCurrentVideoWatch(get, generationRequest.controller, currentTask.taskId, authContext)) {
        return;
      }
      if (!taskResponse.ok && taskResponse.status !== 404) {
        const authHint = [401, 403].includes(taskResponse.status)
          ? '登录状态已失效，重新登录后会自动恢复查询。'
          : '刷新页面或重新登录后会自动恢复查询。';
        pauseVideoWatch({
          set,
          get,
          generationRequest,
          task: currentTask,
          authContext,
          message: `暂时无法查询 Seedance 任务，这不会取消云端生成。任务 ID：${currentTask.taskId}。${authHint}`,
        });
        return;
      }

      consecutiveTransientErrors = 0;
      consecutiveConfirmedAbsences = 0;
      const persistedCurrentTask = persistVideoTaskState(set, {
        ...currentTask,
        lastStatus: taskData.status || currentTask.lastStatus,
        lastCheckedAt: Date.now(),
      }, currentTask.taskId);
      if (!persistedCurrentTask) {
        finishVideoWatch(set, get, generationRequest.controller, currentTask.taskId, authContext, {
          activeVideoTask: loadActiveVideoTask(globalThis.localStorage, ownerUserId),
        });
        return;
      }
      currentTask = persistedCurrentTask;

      const taskState = buildVideoTaskPollingState(taskData);
      if (taskState.requiresReview) {
        pauseVideoWatch({
          set,
          get,
          generationRequest,
          task: currentTask,
          authContext,
          message: taskData.error_message
            || `Seedance 任务需要人工核对，积分仍处于预占状态。任务 ID：${currentTask.taskId}。`,
        });
        return;
      }
      if (!taskState.isTerminal) {
        const serverRetryAfterMs = Number(taskData.retry_after_ms);
        if (Number.isFinite(serverRetryAfterMs) && serverRetryAfterMs > 0) {
          nextDelayMs = Math.min(
            VIDEO_POLL_RETRY_MAX_DELAY_MS,
            Math.max(nextDelayMs, serverRetryAfterMs),
          );
        }
        continue;
      }

      const settlementStatus = String(taskData.settlement_status || '').toUpperCase();
      const expectedSettlement = taskState.isSuccess ? 'CAPTURED' : 'REFUNDED';
      if (settlementStatus !== expectedSettlement) {
        pauseVideoWatch({
          set,
          get,
          generationRequest,
          task: currentTask,
          authContext,
          message: taskData.error_message
            || `Seedance 任务已结束，但积分结算状态为 ${settlementStatus}，需要人工复核。任务 ID：${currentTask.taskId}。`,
        });
        return;
      }

      clearActiveVideoTask(globalThis.localStorage, currentTask.taskId, ownerUserId);
      set({ activeVideoTask: null });
      if (!taskState.isSuccess) {
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: settlementStatus === 'REFUNDED'
            ? 'Seedance 视频生成失败，积分已自动退回。'
            : 'Seedance 视频生成失败，请在积分记录中确认结算状态。',
        });
        finishVideoWatch(set, get, generationRequest.controller, currentTask.taskId, authContext);
        get().refreshBilling().catch(() => null);
        return;
      }

      const videoUrl = getVideoUrlOrThrow(taskData);
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: 'Seedance 视频已生成',
        videoUrl,
      });
      finishVideoWatch(set, get, generationRequest.controller, currentTask.taskId, authContext, {
        generatedImage: null,
        chatInput: '',
      });

      const currentUser = get().user;
      if (currentUser && typeof taskData.remaining_credits === 'number') {
        get().setUser({ ...currentUser, credits: taskData.remaining_credits });
      }
      get().refreshBilling().catch(() => null);
      return;
    }

    pauseVideoWatch({
      set,
      get,
      generationRequest,
      task: currentTask,
      authContext,
      message: `Seedance 任务仍在生成中，已暂停长时间查看。任务 ID：${currentTask.taskId}。刷新页面或重新登录后会自动恢复查询。`,
    });
  } catch (error) {
    if (isAbortGenerationError(error)) {
      return;
    }

    console.error('Failed to watch Seedance video task:', error);
    pauseVideoWatch({
      set,
      get,
      generationRequest,
      task: currentTask,
      authContext,
      message: `Seedance 任务查询已暂停，但这不会取消云端生成。任务 ID：${currentTask.taskId}。刷新页面或重新登录后会自动恢复查询。`,
    });
  }
};

const addGeneratedImageToCanvas = async ({
  fabricInstance,
  imageUrl,
  setProgrammaticUpdate,
}) => {
  if (!fabricInstance || !imageUrl) {
    return;
  }

  setProgrammaticUpdate(true);
  try {
    const { FabricImage } = await loadFabric();
    const img = await createCanvasSafeFabricImage(FabricImage, imageUrl);
    const scale = Math.min(
      fabricInstance.width * 0.6 / img.width,
      fabricInstance.height * 0.6 / img.height
    );
    img.scale(scale);
    fabricInstance.centerObject(img);
    fabricInstance.add(img);
    fabricInstance.setActiveObject(img);
    fabricInstance.renderAll();
  } catch (error) {
    console.error('Failed to render generated image on canvas:', {
      error,
      image: summarizeGeneratedImageUrl(imageUrl),
    });
    toast.error('图片已生成，但画布加载失败，请先在对话区查看结果');
  } finally {
    setProgrammaticUpdate(false);
  }
};

export const useAppStore = create((set, get) => ({
  // 用户认证状态
  user: null,
  billingSummary: null,
  token: localStorage.getItem('token') || null,
  authEpoch: 0,
  setUser: (user) => {
    const previousUserId = get().user?.id;
    const identityChanged = String(previousUserId ?? '') !== String(user?.id ?? '');
    if (identityChanged) {
      get().activeGenerationController?.abort();
      set((state) => ({
        user,
        authEpoch: state.authEpoch + 1,
        ...clearAccountScopedGenerationState(),
      }));
    } else {
      set({ user });
    }
    if (user?.id && identityChanged) {
      queueMicrotask(() => {
        get().recoverPendingImageRequest?.();
        get().recoverActiveVideoTask?.();
      });
    }
  },
  setToken: (token) => {
    const tokenChanged = get().token !== token;
    if (tokenChanged) {
      get().activeGenerationController?.abort();
    }
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set((state) => ({
      token,
      ...(tokenChanged ? {
        user: null,
        billingSummary: null,
        authEpoch: state.authEpoch + 1,
        ...clearAccountScopedGenerationState(),
      } : {}),
    }));
  },
  bootstrapAuth: async () => {
    const { token, authEpoch, refreshBilling } = get();
    const isCurrentBootstrap = () => (
      get().token === token && get().authEpoch === authEpoch
    );

    if (!token) {
      get().activeGenerationController?.abort();
      set((state) => ({
        user: null,
        billingSummary: null,
        authEpoch: state.authEpoch + 1,
        ...clearAccountScopedGenerationState(),
      }));
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();

      if (!isCurrentBootstrap()) {
        return;
      }

      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          get().activeGenerationController?.abort();
          localStorage.removeItem('token');
          set((state) => ({
            user: null,
            token: null,
            billingSummary: null,
            authEpoch: state.authEpoch + 1,
            ...clearAccountScopedGenerationState(),
          }));
        } else {
          console.error('Failed to bootstrap auth state:', getApiErrorMessage(data, `HTTP ${response.status}`));
        }
        return;
      }

      get().setUser(data);
      refreshBilling().catch(() => null);
    } catch (error) {
      if (!isCurrentBootstrap()) {
        return;
      }
      console.error('Failed to bootstrap auth state:', error);
    }
  },
  logout: () => {
    get().activeGenerationController?.abort();
    localStorage.removeItem('token');
    set((state) => ({
      user: null,
      token: null,
      billingSummary: null,
      authEpoch: state.authEpoch + 1,
      ...clearAccountScopedGenerationState(),
    }));
  },
  ensureAuthenticatedForModelAction: (actionLabel = '当前操作') => {
    const { token, setShowAuthModal, setAuthModalContext } = get();
    if (!token) {
      setAuthModalContext({
        actionLabel,
        message: `登录后可继续${actionLabel}`
      });
      setShowAuthModal(true);
      return false;
    }
    return true;
  },

  activeSkill: null,
  setActiveSkill: (skillId) => set({ activeSkill: skillId }),

  // 模板已加载状态
  activeTemplateName: null,
  setActiveTemplateName: (name) => set({ activeTemplateName: name }),

  // 清除模板状态
  clearTemplateState: () => set({
    activeSkill: null,
    activeTemplateName: null,
    canvasDirty: false,
    suggestedTemplateId: null,
    suggestedParams: null,
    readyToGenerate: false,
    uploadedImages: []
  }),

  // 触发模板参数调整（调用 Agent 1）
  triggerTemplateAdjustParams: async () => {
    const {
      activeSkill,
      activeTemplateName,
      homeSessionId,
      workspaceChatMessages,
      token,
      ensureAuthenticatedForModelAction,
    } = get();

    if (!activeSkill) return;
    if (!ensureAuthenticatedForModelAction('调整模板参数')) {
      return;
    }

    set({ isWorkspaceChatLoading: true });

    // 构造 Agent 1 请求消息
    const userMsg = {
      role: 'user',
      content: `我选择了模版「${activeTemplateName || activeSkill}」，请帮我理清参数应该怎么写。`
    };
    const updated = [...workspaceChatMessages, userMsg];
    set({ workspaceChatMessages: updated });

    try {
      const apiMessages = prepareMessagesForAPI(updated, 10);

      const response = await fetch('/api/v1/agent/workspace-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: apiMessages,
          session_id: homeSessionId,
          agent_mode: true,
          template_id: activeSkill
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg = { role: 'assistant', content: data.detail || '对话失败，请重试' };
        set({
          workspaceChatMessages: [...updated, errorMsg],
          isWorkspaceChatLoading: false
        });
        return;
      }

      // 统一解析 Agent 控制字段
      const { replyText, readyToGenerate, suggestedParams, suggestedTemplateId } = parseAgentControlPayload(data);
      const assistantMsg = { role: 'assistant', content: replyText };

      set({
        workspaceChatMessages: [...updated, assistantMsg],
        readyToGenerate,
        suggestedParams,
        suggestedTemplateId,
        isWorkspaceChatLoading: false,
      });

      // 不自动生成，等待用户手动点击
    } catch (error) {
      console.error('Agent 1 调用失败:', error);
      const errorMsg = { role: 'assistant', content: '对话失败，请重试' };
      set({
        workspaceChatMessages: [...updated, errorMsg],
        isWorkspaceChatLoading: false
      });
    }
  },

  // 进入模板调参模式
  enterTemplateAdjustMode: () => {
    set({
      agentMode: true,
      selectedModel: 'nano-banana-2'
    });
  },

  // 画布脏状态管理
  canvasDirty: false,
  isProgrammaticUpdate: false,
  markCanvasDirty: () => set({ canvasDirty: true }),
  resetCanvasDirty: () => set({ canvasDirty: false }),
  setProgrammaticUpdate: (value) => set({ isProgrammaticUpdate: value }),

  showAuthModal: false,
  authModalContext: null,
  setAuthModalContext: (context) => set({ authModalContext: context }),
  setShowAuthModal: (show) => set((state) => ({
    showAuthModal: show,
    authModalContext: show ? state.authModalContext : null,
  })),

  showGenerateModal: false,
  setShowGenerateModal: (show) => set({ showGenerateModal: show }),
  showRedeemModal: false,
  setShowRedeemModal: (show) => set({ showRedeemModal: show }),

  chatInput: '',
  setChatInput: (input) => set({ chatInput: input }),

  isGenerating: false,
  isGenerationCancelable: false,
  activeGenerationController: null,
  pendingImageRequest: null,
  isRecoveringImageRequest: false,
  activeVideoTask: null,
  activeVideoPollingTaskId: null,
  isRecoveringVideoTask: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  recoverPendingImageRequest: async ({ notify = true } = {}) => {
    const { token, user, authEpoch, isRecoveringImageRequest } = get();
    const pending = loadPendingImageSubmission(globalThis.localStorage, user?.id);
    if (!token || !user?.id || !pending || isRecoveringImageRequest) {
      return false;
    }
    const authContext = { token, ownerUserId: user.id, authEpoch };
    set({ pendingImageRequest: pending, isRecoveringImageRequest: true });
    try {
      let task = null;
      let absenceConfirmed = false;
      for (let attempt = 0; attempt < IMAGE_ABSENCE_CONFIRMATION_ATTEMPTS; attempt += 1) {
        const recovery = await lookupImageTaskForRecovery({
          token,
          requestId: pending.requestId,
        });
        if (!isSameAuthContext(get, authContext)) return false;
        if (recovery.task) {
          task = recovery.task;
          absenceConfirmed = false;
          break;
        }
        if (!recovery.absenceConfirmed) {
          return false;
        }
        absenceConfirmed = true;
        if (attempt + 1 < IMAGE_ABSENCE_CONFIRMATION_ATTEMPTS) {
          await sleepWithAbort(IMAGE_ABSENCE_CONFIRMATION_DELAY_MS);
        }
      }

      if (!isSameAuthContext(get, authContext)) return false;
      if (!task) {
        if (absenceConfirmed) {
          const markerAge = Date.now() - pending.createdAt;
          if (markerAge >= IMAGE_SUBMISSION_SAFETY_WINDOW_MS) {
            clearPendingImageSubmission(
              globalThis.localStorage,
              pending.requestId,
              user.id,
            );
            set({ pendingImageRequest: null });
            if (notify) {
              appendWorkspaceMessage(set, get, {
                role: 'assistant',
                content: '已连续确认上一条生图请求未在服务器创建，本地提交锁已解除，可以安全重新提交。',
              });
            }
          } else if (notify) {
            appendWorkspaceMessage(set, get, {
              role: 'assistant',
              content: `服务器暂未查到上一条生图请求，安全等待窗口内仍保留 request_id：${pending.requestId}，请勿改用新标识重复提交。`,
            });
          }
        }
        return false;
      }

      const taskState = classifyImageTask(task);
      if (taskState.isSuccess) {
        clearPendingImageSubmission(globalThis.localStorage, pending.requestId, user.id);
        set({
          pendingImageRequest: null,
          generatedImage: { url: taskState.imageUrl, timestamp: task.timestamp },
        });
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: '已恢复上一条生图请求的结果。',
          imageUrl: taskState.imageUrl,
        });
        await addGeneratedImageToCanvas({
          fabricInstance: get().fabricInstance,
          imageUrl: taskState.imageUrl,
          setProgrammaticUpdate: get().setProgrammaticUpdate,
        });
        const currentUser = get().user;
        if (currentUser && typeof task.remaining_credits === 'number') {
          get().setUser({ ...currentUser, credits: task.remaining_credits });
        }
        get().refreshBilling().catch(() => null);
        return true;
      }

      if (taskState.isFailed || (
        String(task.status || '').toLowerCase() === 'succeeded'
        && String(task.settlement_status || '').toUpperCase() === 'CAPTURED'
      )) {
        clearPendingImageSubmission(globalThis.localStorage, pending.requestId, user.id);
        set({ pendingImageRequest: null });
        if (notify) {
          appendWorkspaceMessage(set, get, {
            role: 'assistant',
            content: taskState.isFailed
              ? '上一条生图请求已明确失败，积分已退回。'
              : (task.error_message || '上一条生图请求已完成，但图片已超过本地保留期。'),
          });
        }
        get().refreshBilling().catch(() => null);
        return true;
      }

      if (notify) {
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: taskState.requiresReview
            ? `上一条生图请求结果仍需人工复核，系统已保留 request_id：${pending.requestId}，不会重复提交。`
            : `上一条生图请求仍在处理，系统已保留 request_id：${pending.requestId}，不会重复提交。`,
        });
      }
      return true;
    } catch (error) {
      if (!isAbortGenerationError(error)) {
        console.error('Failed to recover image generation request:', error);
      }
      return false;
    } finally {
      if (isSameAuthContext(get, authContext)) {
        set({ isRecoveringImageRequest: false });
      }
    }
  },
  stopWatchingVideoTask: ({ notify = true } = {}) => {
    const {
      activeGenerationController,
      activeVideoPollingTaskId,
      activeVideoTask,
    } = get();
    if (!activeGenerationController || !activeVideoPollingTaskId) {
      return false;
    }

    activeGenerationController.abort();
    set({
      ...clearGenerationRequestState(),
      activeVideoPollingTaskId: null,
      isGenerating: false,
    });

    if (notify) {
      const taskId = activeVideoTask?.taskId || activeVideoPollingTaskId;
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: `已停止查看 Seedance 任务进度，但没有取消云端生成。任务 ID：${taskId}。刷新页面或重新登录后会自动恢复查询。`,
      });
      toast('已停止查看，云端任务仍在运行');
    }
    return true;
  },
  resumeActiveVideoTask: () => {
    const {
      token,
      user,
      authEpoch,
      activeGenerationController,
      activeVideoPollingTaskId,
    } = get();
    const storedTask = loadActiveVideoTask(globalThis.localStorage, user?.id);
    if (!token || !user || !storedTask || !isActiveVideoTaskOwnedByUser(storedTask, user)) {
      return false;
    }
    if (activeGenerationController || activeVideoPollingTaskId === storedTask.taskId) {
      return false;
    }

    const reboundTask = persistActiveVideoTask({
      ...storedTask,
      ownerUserId: storedTask.ownerUserId || user.id,
    }, globalThis.localStorage, storedTask.taskId);
    if (!reboundTask) {
      set({ activeVideoTask: loadActiveVideoTask(globalThis.localStorage, user.id) });
      return false;
    }
    const generationRequest = createGenerationRequestState();
    set({
      activeVideoTask: reboundTask,
      activeVideoPollingTaskId: reboundTask.taskId,
      isGenerating: true,
      ...generationRequest.nextState,
      workspaceChatMessages: [...get().workspaceChatMessages, {
        role: 'assistant',
        content: `正在恢复查询 Seedance 任务进度… 任务 ID：${reboundTask.taskId}`,
      }],
    });
    void watchSeedanceVideoTask({
      set,
      get,
      task: reboundTask,
      token,
      ownerUserId: user.id,
      authEpoch,
      generationRequest,
    });
    return true;
  },
  recoverActiveVideoTask: async ({ requestId = null } = {}) => {
    const {
      token,
      user,
      authEpoch,
      activeGenerationController,
      activeVideoPollingTaskId,
      isRecoveringVideoTask,
    } = get();
    if (!token || !user || activeGenerationController || activeVideoPollingTaskId || isRecoveringVideoTask) {
      return false;
    }

    const authContext = { token, ownerUserId: user.id, authEpoch };
    const pendingSubmission = loadPendingVideoSubmission(globalThis.localStorage, user.id);
    const preferredRequestId = String(
      requestId || pendingSubmission?.requestId || '',
    ).trim();
    if (!preferredRequestId && get().resumeActiveVideoTask()) {
      return true;
    }

    set({ isRecoveringVideoTask: true });
    try {
      const confirmationAttempts = preferredRequestId
        ? VIDEO_ABSENCE_CONFIRMATION_ATTEMPTS
        : 1;
      let recoverableTask = null;
      let absenceConfirmed = false;
      for (let attempt = 0; attempt < confirmationAttempts; attempt += 1) {
        const recovery = await lookupSeedanceTaskForRecovery({
          token,
          requestId: preferredRequestId,
        });
        if (!isSameAuthContext(get, authContext)) {
          return false;
        }
        if (recovery.task) {
          recoverableTask = recovery.task;
          absenceConfirmed = false;
          break;
        }
        if (!recovery.absenceConfirmed) {
          return get().resumeActiveVideoTask();
        }
        absenceConfirmed = true;
        if (attempt + 1 < confirmationAttempts) {
          await sleepWithAbort(VIDEO_ABSENCE_CONFIRMATION_DELAY_MS);
        }
      }

      if (!isSameAuthContext(get, authContext)) {
        return false;
      }
      if (!recoverableTask) {
        if (preferredRequestId && absenceConfirmed) {
          clearPendingVideoSubmission(globalThis.localStorage, preferredRequestId, user.id);
          const storedTask = loadActiveVideoTask(globalThis.localStorage, user.id);
          if (storedTask?.requestId === preferredRequestId) {
            clearActiveVideoTask(globalThis.localStorage, storedTask.taskId, user.id);
            set({ activeVideoTask: null });
          }
          appendWorkspaceMessage(set, get, {
            role: 'assistant',
            content: '已连续确认该 Seedance 请求未创建云端任务，本地提交锁已解除，可以安全重试。',
          });
        }
        return get().resumeActiveVideoTask();
      }

      const currentStoredTask = loadActiveVideoTask(globalThis.localStorage, user.id);
      const recoveredTaskId = String(recoverableTask.task_id || '');
      const recoveredRequestId = String(recoverableTask.request_id || '');
      if (
        currentStoredTask
        && (
          currentStoredTask.taskId !== recoveredTaskId
          || currentStoredTask.requestId !== recoveredRequestId
        )
      ) {
        const currentMarkerWasConfirmedAbsent = Boolean(
          preferredRequestId
          && currentStoredTask.requestId === preferredRequestId
          && recoveredRequestId !== preferredRequestId
        );
        if (currentMarkerWasConfirmedAbsent) {
          clearActiveVideoTask(
            globalThis.localStorage,
            currentStoredTask.taskId,
            user.id,
          );
        } else {
          set({ activeVideoTask: currentStoredTask });
          return get().resumeActiveVideoTask();
        }
      }
      const persistedTask = persistActiveVideoTask({
        taskId: recoveredTaskId,
        requestId: recoveredRequestId,
        ownerUserId: user.id,
        createdAt: Date.now(),
        lastCheckedAt: Date.now(),
        lastStatus: recoverableTask.status,
      }, globalThis.localStorage);
      if (!persistedTask) {
        set({ activeVideoTask: loadActiveVideoTask(globalThis.localStorage, user.id) });
        return get().resumeActiveVideoTask();
      }
      if (preferredRequestId) {
        clearPendingVideoSubmission(globalThis.localStorage, preferredRequestId, user.id);
      }
      set({ activeVideoTask: persistedTask });
      return get().resumeActiveVideoTask();
    } catch (error) {
      if (!isAbortGenerationError(error)) {
        console.error('Failed to recover Seedance video task:', error);
      }
      return false;
    } finally {
      if (isSameAuthContext(get, authContext)) {
        set({ isRecoveringVideoTask: false });
      }
    }
  },
  cancelActiveGeneration: () => {
    const { activeGenerationController, activeVideoPollingTaskId } = get();
    if (!activeGenerationController) return false;
    if (activeVideoPollingTaskId) {
      return get().stopWatchingVideoTask();
    }

    set({
      ...cancelGenerationRequestState(activeGenerationController),
      isGenerating: false,
    });
    return true;
  },

  generatedImage: null,
  setGeneratedImage: (image) => set({ generatedImage: image }),

  chatHistory: [],
  addChatMessage: (role, content, imageUrl = null, imageDatas = null) => {
    const { chatHistory } = get();
    set({
      chatHistory: [...chatHistory, { role, content, imageUrl, imageDatas, timestamp: Date.now() }]
    });
  },
  clearChatHistory: () => set({ chatHistory: [] }),

  // === 多 Agent 路由：首页 + 画布对话 ===
  homeSessionId: null,         // 首页会话ID
  homeChatMessages: [],        // 首页对话历史 [{role, content}]
  workspaceChatMessages: [],   // 画布对话历史
  readyToGenerate: false,      // Flash 判断参数就绪
  suggestedParams: null,       // Flash 建议的生图参数
  suggestedTemplateId: null,   // Flash 建议的模版ID
  isWorkspaceChatLoading: false,
  agentMode: false,            // Agent 对话模式
  uploadedImages: [],          // 用户上传的参考底图
  assetUsageConfirmed: false,  // 素材使用权确认
  resolution: '1K',            // 生图分辨率 / 质量档位（以后端能力为准）
  aspectRatio: 'auto',         // 生图比例
  numImages: 1,                // 生图数量（默认 1 张）
  imageCapabilities: null,
  isImageCapabilitiesLoading: false,
  videoDurationSeconds: 5,     // Seedance 视频时长
  videoResolution: '720p',     // Seedance 视频清晰度
  videoFrameMode: 'auto',      // Seedance 视频输入模式
  videoGenerateAudio: true,    // Seedance 是否生成同步音效
  seedanceReferenceVideo: null,
  isSeedanceReferenceVideoUploading: false,
  videoCapabilities: null,
  isVideoCapabilitiesLoading: false,
  selectedModel: '',           // 生图模型（默认未选择）
  theme: initialTheme,
  setAgentMode: (mode) => set({ agentMode: mode }),
  setUploadedImages: (images) => set({ uploadedImages: images }),
  setAssetUsageConfirmed: (confirmed) => set({ assetUsageConfirmed: confirmed }),
  removeUploadedImageAt: (index) => set((state) => ({
    uploadedImages: state.uploadedImages.filter((_, currentIndex) => currentIndex !== index),
  })),
  setResolution: (res) => set((state) => ({
    resolution: normalizeImageResolution(
      state.imageCapabilities,
      state.selectedModel,
      res,
    ) || state.resolution,
  })),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setNumImages: () => set({ numImages: 1 }),
  setVideoDurationSeconds: (duration) => set({
    videoDurationSeconds: normalizeVideoDurationForCapabilities(
      duration,
      get().videoCapabilities,
      get().selectedModel,
    ),
  }),
  setVideoResolution: (resolution) => set({
    videoResolution: normalizeVideoResolutionForCapabilities(
      resolution,
      get().videoCapabilities,
      get().selectedModel,
    ),
  }),
  setVideoFrameMode: (mode) => set((state) => {
    const videoFrameMode = normalizeSeedanceVideoMode(mode);
    return {
      videoFrameMode,
      seedanceReferenceVideo: videoFrameMode === 'reference_video'
        ? state.seedanceReferenceVideo
        : null,
    };
  }),
  setVideoGenerateAudio: (enabled) => set({ videoGenerateAudio: Boolean(enabled) }),
  clearSeedanceReferenceVideo: () => set((state) => ({
    seedanceReferenceVideo: null,
    videoFrameMode: state.videoFrameMode === 'reference_video' ? 'auto' : state.videoFrameMode,
  })),
  uploadSeedanceReferenceVideo: async (file, durationSeconds) => {
    const {
      token,
      user,
      authEpoch,
      ensureAuthenticatedForModelAction,
    } = get();
    if (!ensureAuthenticatedForModelAction('上传参考视频')) {
      return null;
    }

    validateSeedanceReferenceVideoFile(file);
    const authContext = { token, ownerUserId: user?.id, authEpoch };
    set({ isSeedanceReferenceVideoUploading: true });

    try {
      const capabilities = await get().loadVideoCapabilities();
      if (!isSameAuthContext(get, authContext)) return null;
      const modelCapabilities = getVideoModelCapabilities(capabilities, get().selectedModel);
      if (modelCapabilities?.supports_reference_video !== true) {
        throw new Error('Seedance 参考视频服务当前不可用');
      }
      const duration = validateSeedanceReferenceVideoDuration(
        durationSeconds,
        modelCapabilities.max_reference_video_duration_seconds,
      );
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/v1/video/reference-upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await readResponseJson(response);
      if (!isSameAuthContext(get, authContext)) return null;
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, '参考视频上传失败'));
      }
      if (typeof data?.video_url !== 'string' || !data.video_url.trim()) {
        throw new Error('参考视频上传成功，但未返回视频地址');
      }

      const referenceVideo = {
        ...data,
        duration_seconds: duration,
      };
      set({
        seedanceReferenceVideo: referenceVideo,
        videoFrameMode: 'reference_video',
      });
      return referenceVideo;
    } finally {
      set({ isSeedanceReferenceVideoUploading: false });
    }
  },
  setSelectedModel: (model) => set((state) => {
    const normalized = String(model || '').trim().toLowerCase();
    if (!normalized) {
      return { selectedModel: '', numImages: 1 };
    }
    if (isSeedanceModel(normalized)) {
      const modelCapabilities = getVideoModelCapabilities(state.videoCapabilities, normalized);
      const maxReferenceDuration = Number(
        modelCapabilities?.max_reference_video_duration_seconds,
      );
      const referenceDuration = Number(state.seedanceReferenceVideo?.duration_seconds);
      const clearReferenceVideo = Number.isFinite(maxReferenceDuration)
        && Number.isFinite(referenceDuration)
        && referenceDuration > maxReferenceDuration;
      return {
        selectedModel: normalized,
        videoDurationSeconds: normalizeVideoDurationForCapabilities(
          state.videoDurationSeconds,
          state.videoCapabilities,
          normalized,
        ),
        videoResolution: normalizeVideoResolutionForCapabilities(
          state.videoResolution,
          state.videoCapabilities,
          normalized,
        ),
        seedanceReferenceVideo: clearReferenceVideo ? null : state.seedanceReferenceVideo,
        videoFrameMode: clearReferenceVideo && state.videoFrameMode === 'reference_video'
          ? 'auto'
          : state.videoFrameMode,
        numImages: 1,
      };
    }
    const capabilityModel = getImageCapabilityModel(state.imageCapabilities, normalized);
    if (!capabilityModel) {
      return { selectedModel: '', numImages: 1 };
    }
    return {
      selectedModel: capabilityModel.id,
      resolution: normalizeImageResolution(
        state.imageCapabilities,
        capabilityModel.id,
        state.resolution,
      ),
      aspectRatio: normalizeImageAspectRatio(
        state.imageCapabilities,
        capabilityModel.id,
        state.aspectRatio,
      ) || state.aspectRatio,
      numImages: 1,
    };
  }),
  loadImageCapabilities: async () => {
    if (imageCapabilitiesLoadPromise) return imageCapabilitiesLoadPromise;
    set({ isImageCapabilitiesLoading: true });
    let requestPromise;
    requestPromise = (async () => {
      try {
        const response = await fetchWithAbortTimeout(
          fetch,
          `${API_BASE}/v1/image/capabilities`,
          {},
          { timeoutMs: 10000 },
        );
        const data = await readResponseJson(response);
        if (!response.ok) {
          throw new Error(getApiErrorMessage(data, '生图能力请求失败'));
        }
        const parsed = parseImageCapabilities(data);
        set((state) => {
          const selectedImageModel = getImageCapabilityModel(parsed, state.selectedModel);
          const selectedModel = isSeedanceModel(state.selectedModel)
            ? state.selectedModel
            : (selectedImageModel?.id || '');
          return {
            imageCapabilities: parsed,
            selectedModel,
            resolution: selectedImageModel
              ? normalizeImageResolution(parsed, selectedImageModel.id, state.resolution)
              : state.resolution,
            numImages: 1,
          };
        });
        return parsed;
      } catch (error) {
        console.error('Failed to load image capabilities:', error);
        const unavailable = Object.freeze({
          enabled: false,
          disabledReason: '生图服务状态暂不可用',
          defaultModel: null,
          maxNumImages: 1,
          models: Object.freeze([]),
        });
        set((state) => ({
          imageCapabilities: unavailable,
          selectedModel: isSeedanceModel(state.selectedModel) ? state.selectedModel : '',
          numImages: 1,
        }));
        return unavailable;
      } finally {
        if (imageCapabilitiesLoadPromise === requestPromise) {
          imageCapabilitiesLoadPromise = null;
          set({ isImageCapabilitiesLoading: false });
        }
      }
    })();
    imageCapabilitiesLoadPromise = requestPromise;
    return requestPromise;
  },
  loadVideoCapabilities: async () => {
    if (videoCapabilitiesLoadPromise) {
      return videoCapabilitiesLoadPromise;
    }
    set({ isVideoCapabilitiesLoading: true });
    let requestPromise;
    requestPromise = (async () => {
      try {
        const response = await fetchWithAbortTimeout(
          fetch,
          `${API_BASE}/v1/video/capabilities`,
          {},
          { timeoutMs: 10000 },
        );
        const data = await readResponseJson(response);
        if (
          !response.ok
          || typeof data?.enabled !== 'boolean'
          || (data.enabled === true && !isUsableVideoCapabilities(data))
        ) {
          throw new Error(getApiErrorMessage(data, 'Seedance capability request failed'));
        }
        set((state) => ({
          videoCapabilities: data,
          videoDurationSeconds: normalizeVideoDurationForCapabilities(
            state.videoDurationSeconds,
            data,
            isSeedanceModel(state.selectedModel) ? state.selectedModel : data.model,
          ),
          videoResolution: normalizeVideoResolutionForCapabilities(
            state.videoResolution,
            data,
            isSeedanceModel(state.selectedModel) ? state.selectedModel : data.model,
          ),
        }));
        return data;
      } catch (error) {
        console.error('Failed to load Seedance capabilities:', error);
        const unavailable = {
          enabled: false,
          disabled_reason: 'Seedance 服务状态暂不可用',
        };
        set({ videoCapabilities: unavailable });
        return unavailable;
      } finally {
        if (videoCapabilitiesLoadPromise === requestPromise) {
          videoCapabilitiesLoadPromise = null;
          set({ isVideoCapabilitiesLoading: false });
        }
      }
    })();
    videoCapabilitiesLoadPromise = requestPromise;
    return requestPromise;
  },
  setTheme: (theme) => {
    const nextTheme = persistThemePreference(theme);
    applyThemePreference(nextTheme);
    set({ theme: nextTheme });
  },

  refreshBilling: async () => {
    const { token, user, authEpoch } = get();
    if (!token || !user?.id) {
      set({ billingSummary: null });
      return null;
    }
    const authContext = { token, ownerUserId: user.id, authEpoch };

    const response = await fetch(`${API_BASE}/v1/billing/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!isSameAuthContext(get, authContext)) {
      return null;
    }
    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, '刷新账单信息失败'));
    }

    set((state) => {
      if (
        state.token !== token
        || state.authEpoch !== authEpoch
        || String(state.user?.id ?? '') !== String(user.id)
      ) {
        return {};
      }
      return {
        billingSummary: data,
        user: { ...state.user, credits: data.credits },
      };
    });

    return data;
  },

  redeemCode: async (code) => {
    const { token, user, setUser, refreshBilling } = get();
    if (!token) {
      throw new Error('请先登录');
    }

    const response = await fetch(`${API_BASE}/v1/billing/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || '兑换失败');
    }

    const summary = await refreshBilling().catch(() => null);

    if (!summary && user) {
      setUser({ ...user, credits: data.credits });
    }

    return {
      ...data,
      credits: summary?.credits ?? data.credits
    };
  },

  addHomeChatMessage: (role, content) => {
    const { homeChatMessages } = get();
    set({ homeChatMessages: [...homeChatMessages, { role, content }] });
  },

  addSystemMessage: (content) => {
    const { workspaceChatMessages } = get();
    set({
      workspaceChatMessages: [...workspaceChatMessages, {
        role: 'system',
        content,
        timestamp: Date.now()
      }]
    });
  },

  initWorkspaceFromHome: (messages, sessionId) => {
    // 剥离 system 消息，仅保留 user/assistant
    const filtered = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
    set({
      workspaceChatMessages: filtered,
      homeSessionId: sessionId,
      readyToGenerate: false,
      suggestedParams: null
    });
  },

  initWorkspaceWithMessage: async (initMessage, sessionId) => {
    // 从首页跳转，调用 Agent 1
    const { token, ensureAuthenticatedForModelAction } = get();
    if (!ensureAuthenticatedForModelAction('初始化工作区对话')) {
      return;
    }
    set({ homeSessionId: sessionId, isWorkspaceChatLoading: true });

    try {
      const response = await fetch(`${API_BASE}/v1/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: initMessage, session_id: sessionId }),
      });

      const data = await response.json();

      const replyText = normalizeBackendReply(data.reply_text || data.reply);

      set({
        workspaceChatMessages: [
          { role: 'user', content: initMessage },
          { role: 'assistant', content: replyText }
        ],
        isWorkspaceChatLoading: false
      });
    } catch (error) {
      console.error('Agent 1 调用失败:', error);
      set({ isWorkspaceChatLoading: false });
    }
  },

  directChat: async (message, imageDatas) => {
    const { workspaceChatMessages, token, ensureAuthenticatedForModelAction } = get();
    if (!ensureAuthenticatedForModelAction('继续对话')) {
      return;
    }
    const normalizedImages = normalizeReferenceImages(imageDatas);

    const userMsg = { role: 'user', content: message, imageDatas: [...normalizedImages] };
    const updated = [...workspaceChatMessages, userMsg];
    set({ workspaceChatMessages: updated, isWorkspaceChatLoading: true });

    try {
      const apiMessages = prepareMessagesForAPI(updated, 10, 4000);
      const response = await fetch('/api/v1/direct-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message,
          messages: apiMessages,
          image_data: normalizedImages[0] || null,
          image_datas: normalizedImages.length > 0 ? normalizedImages : null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg = { role: 'assistant', content: data.detail || '对话失败，请重试' };
        set({
          workspaceChatMessages: [...updated, errorMsg],
          isWorkspaceChatLoading: false
        });
        return;
      }

      const replyText = normalizeBackendReply(data.reply);
      const assistantMsg = { role: 'assistant', content: replyText };
      set({
        workspaceChatMessages: [...updated, assistantMsg],
        isWorkspaceChatLoading: false,
      });

    } catch (error) {
      console.error('Direct chat failed:', error);
      const errorMsg = { role: 'assistant', content: '对话失败，请重试' };
      set({
        workspaceChatMessages: [...updated, errorMsg],
        isWorkspaceChatLoading: false
      });
    }
  },

  workspaceChat: async (message, imageDatas) => {
    const {
      homeSessionId,
      workspaceChatMessages,
      addChatMessage,
      agentMode,
      token,
      ensureAuthenticatedForModelAction,
    } = get();
    if (!ensureAuthenticatedForModelAction('继续 Agent 对话')) {
      return;
    }
    const normalizedImages = normalizeReferenceImages(imageDatas);

    // 追加用户消息
    const userMsg = { role: 'user', content: message, imageDatas: [...normalizedImages] };
    const updated = [...workspaceChatMessages, userMsg];
    set({ workspaceChatMessages: updated, isWorkspaceChatLoading: true });
    addChatMessage('user', message, null, [...normalizedImages]);

    try {
      // 智能截断历史记录（UI 显示全部，API 只发送必要上下文）
      const apiMessages = prepareMessagesForAPI(updated, 10);

      const response = await fetch(`${API_BASE}/v1/agent/workspace-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: apiMessages,
          image_data: normalizedImages[0] || null,
          image_datas: normalizedImages.length > 0 ? normalizedImages : null,
          agent_mode: agentMode,
          session_id: homeSessionId
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        addChatMessage('assistant', data.detail || '对话失败，请重试');
        set({ isWorkspaceChatLoading: false });
        return;
      }

      // 统一解析 Agent 控制字段
      const { replyText, readyToGenerate, suggestedParams, suggestedTemplateId } = parseAgentControlPayload(data);

      const assistantMsg = { role: 'assistant', content: replyText };
      set({
        workspaceChatMessages: [...updated, assistantMsg],
        readyToGenerate,
        suggestedParams,
        suggestedTemplateId,
        isWorkspaceChatLoading: false,
      });
      addChatMessage('assistant', replyText);

      // 不自动触发生图，等待用户点击"确认生成"按钮
    } catch (error) {
      console.error('Workspace chat failed:', error);
      addChatMessage('assistant', '对话失败，请重试');
      set({ isWorkspaceChatLoading: false });
    }
  },

  confirmGenerate: async () => {
    const {
      homeSessionId,
      token,
      suggestedTemplateId,
      addChatMessage,
      fabricInstance,
      setProgrammaticUpdate,
      activeSkill,
      resolution,
      aspectRatio,
      selectedModel,
      user,
      setUser,
      refreshBilling,
      uploadedImages,
      suggestedParams,
      ensureAuthenticatedForModelAction,
    } = get();

    if (!homeSessionId) {
      addChatMessage('assistant', '会话ID丢失，请刷新页面重试');
      return;
    }

    if (!ensureAuthenticatedForModelAction('生成图片')) {
      return;
    }
    if (!user?.id) {
      addChatMessage('assistant', '登录状态仍在同步，请稍后再提交生图请求。');
      return;
    }

    const imageCapabilities = await get().loadImageCapabilities();
    const currentModel = get().selectedModel || selectedModel;
    const capabilityModel = getImageCapabilityModel(imageCapabilities, currentModel);
    if (!imageCapabilities?.enabled || !capabilityModel) {
      addChatMessage('assistant', imageCapabilities?.disabledReason || '生图服务能力未加载，已阻止提交');
      return;
    }
    const requestResolution = normalizeImageResolution(imageCapabilities, currentModel, resolution);
    const requestAspectRatio = normalizeImageAspectRatio(imageCapabilities, currentModel, aspectRatio);
    if (!requestResolution || !requestAspectRatio) {
      addChatMessage('assistant', '当前模型参数未通过能力校验，已阻止提交');
      return;
    }

    // 底图硬校验
    if (suggestedTemplateId) {
      const response = await fetch(`${API_BASE}/v1/templates`);
      const data = await response.json();
      const template = data.templates.find(t => t.id === suggestedTemplateId);

      if (template && template.is_i2i) {
        const hasImage = uploadedImages.length > 0 || (fabricInstance && fabricInstance.getObjects().some(obj => obj.type === 'image'));
        if (!hasImage) {
          addChatMessage('assistant', '当前模版需要参考底图。请先在左侧工作区（Fabric 画布）中上传或粘贴您的场地底图，然后再点击生成。');
          set({ isGenerating: false });
          return;
        }
      }
    }

    const generationRequest = createGenerationRequestState();
    const clearRequestState = clearGenerationRequestState();

    set({
      readyToGenerate: false,
      isGenerating: true,
      ...generationRequest.nextState,
    });

    try {
      // 提取并压缩 i2i 底图（如果存在）
      let base_image = null;
      if (fabricInstance) {
        const objects = fabricInstance.getObjects();
        const uploadedImage = objects.find(obj => obj.type === 'image' && obj.name === 'uploaded');

        if (uploadedImage) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const maxSize = 1024;
          const scale = Math.min(maxSize / uploadedImage.width, maxSize / uploadedImage.height, 1);

          canvas.width = uploadedImage.width * scale;
          canvas.height = uploadedImage.height * scale;
          ctx.drawImage(uploadedImage.getElement(), 0, 0, canvas.width, canvas.height);

          let quality = 0.8;
          let compressed = safeCanvasToDataUrl(canvas, 'image/jpeg', quality);

          if (!compressed) {
            addChatMessage('assistant', '参考底图导出失败，请重新上传图片后再试。');
            set({ ...clearRequestState, isGenerating: false });
            return;
          }

          while (compressed.length > 2 * 1024 * 1024 && quality > 0.1) {
            quality -= 0.1;
            compressed = safeCanvasToDataUrl(canvas, 'image/jpeg', quality);
            if (!compressed) {
              addChatMessage('assistant', '参考底图导出失败，请重新上传图片后再试。');
              set({ ...clearRequestState, isGenerating: false });
              return;
            }
          }

          base_image = compressed;
        }
      }

      const baseImages = uploadedImages.length > 0
        ? uploadedImages
        : normalizeReferenceImages(base_image);
      if (baseImages.length > 0 && !capabilityModel.supportsReferenceImages) {
        addChatMessage('assistant', '当前模型不支持参考图，已阻止提交');
        set({ ...clearRequestState, isGenerating: false });
        return;
      }

      const promptPreview = await fetchTemplatePromptPreview({
        templateId: activeSkill || suggestedTemplateId,
        token,
        parameters: suggestedParams,
        generationMode: 'generate_diagram',
      });

      const requestPayload = {
        session_id: homeSessionId,
        base_image: baseImages[0] || null,
        base_images: baseImages.length > 0 ? baseImages : null,
        num_images: 1,
        template_id: activeSkill || suggestedTemplateId,
        resolution: requestResolution,
        aspect_ratio: requestAspectRatio,
        selected_model: currentModel,
      };
      const endpoint = '/generate_diagram';
      const requestFingerprint = createImageRequestFingerprint(endpoint, requestPayload);
      const storedPending = loadPendingImageSubmission(globalThis.localStorage, user.id);
      if (storedPending && (
        storedPending.endpoint !== endpoint
        || storedPending.requestFingerprint !== requestFingerprint
      )) {
        addChatMessage('assistant', '已有生图请求尚未确认结束，正在恢复上一条请求。为避免重复扣费，暂不提交新请求。');
        set({ ...clearRequestState, isGenerating: false, pendingImageRequest: storedPending });
        void get().recoverPendingImageRequest();
        return;
      }
      const requestId = storedPending?.requestId || createClientRequestId();
      const pendingMarker = persistPendingImageSubmission({
        requestId,
        ownerUserId: user.id,
        endpoint,
        requestFingerprint,
        createdAt: storedPending?.createdAt || Date.now(),
      });
      if (!pendingMarker) {
        addChatMessage('assistant', '无法安全保存生图请求标识，已阻止提交，请刷新后重试。');
        set({ ...clearRequestState, isGenerating: false });
        return;
      }
      set({ pendingImageRequest: pendingMarker });

      const response = await fetch(`${API_BASE}/generate_diagram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        signal: generationRequest.signal,
        body: JSON.stringify({
          request_id: requestId,
          ...requestPayload,
        }),
      });

      set(clearRequestState);
      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.detail || '生成失败';
        addChatMessage('assistant', `生成失败: ${errorMsg}`);
        if ([400, 401, 402, 403, 404, 422, 429].includes(response.status)) {
          clearPendingImageSubmission(globalThis.localStorage, requestId, user.id);
          set({ pendingImageRequest: null });
        } else {
          void get().recoverPendingImageRequest();
        }
        set({ ...clearRequestState, isGenerating: false });
        return;
      }

      const imageUrl = getGeneratedImageUrlOrThrow(data);
      clearPendingImageSubmission(globalThis.localStorage, requestId, user.id);
      console.log('生图返回数据:', {
        ...data,
        image_url: summarizeGeneratedImageUrl(imageUrl),
      });

      // 添加到 workspaceChatMessages（包含审图按钮和模板溯源）
      const { workspaceChatMessages, activeTemplateName } = get();
      const newMessage = buildGeneratedImageMessage({
        content: '图片已生成！如需调整参数，请直接告诉我。',
        imageUrl,
        templateName: (activeSkill || suggestedTemplateId) ? activeTemplateName : null,
        prompt: promptPreview.effectivePrompt,
      });
      console.log('准备添加生图消息:', {
        hasImage: Boolean(newMessage.imageUrl),
        hasTemplate: Boolean(newMessage.templateName),
      });

      set({
        workspaceChatMessages: [...workspaceChatMessages, newMessage]
      });

      // 自动加载到画布
      await addGeneratedImageToCanvas({
        fabricInstance,
        imageUrl,
        setProgrammaticUpdate,
      });

      set({
        ...clearRequestState,
        pendingImageRequest: null,
        generatedImage: { url: imageUrl, timestamp: data.timestamp },
        isGenerating: false,
        readyToGenerate: false,
        suggestedParams: null,
        suggestedTemplateId: null,
        agentMode: false,
      });

      if (user && typeof data.remaining_credits === 'number') {
        setUser({ ...user, credits: data.remaining_credits });
      }
      refreshBilling().catch(() => null);

    } catch (error) {
      if (isAbortGenerationError(error)) {
        get().addSystemMessage('已停止等待生图响应；这不代表云端生成已取消，系统会按原 request_id 恢复结果');
        toast('已停止等待，不代表云端生图已取消');
        set({ ...clearRequestState, isGenerating: false });
        void get().recoverPendingImageRequest();
        return;
      }

      console.error('生图失败:', error);
      toast.error(`生图异常: ${error.message || '网络错误'}`);
      addChatMessage('assistant', '暂时无法确认生图结果。系统已保留 request_id，将继续恢复，请勿立即重复提交。');
      set({ ...clearRequestState, isGenerating: false });
      void get().recoverPendingImageRequest();
    }
  },

  dismissGenerate: () => {
    const { workspaceChatMessages } = get();
    // 注入重置指令防止 LLM 死循环
    const resetMsg = {
      role: 'user',
      content: '参数有误，请取消就绪状态，根据我的新需求重新调整参数。'
    };
    set({
      readyToGenerate: false,
      suggestedParams: null,
      workspaceChatMessages: [...workspaceChatMessages, resetMsg],
    });
  },

  auditDiagram: async (imageUrl) => {
    console.log('🔍 审图函数被调用');
    console.log('imageUrl:', summarizeGeneratedImageUrl(imageUrl));

    const { token, addChatMessage, ensureAuthenticatedForModelAction } = get();

    console.log('token:', token ? '存在' : '不存在');

    if (!imageUrl) {
      console.log('缺少 imageUrl，提前返回');
      return;
    }

    if (!ensureAuthenticatedForModelAction('进行审图分析')) {
      console.log('缺少 token 或 imageUrl，提前返回');
      return;
    }

    addChatMessage('assistant', '正在进行专业审图分析...');

    try {
      console.log('发送审图请求...');
      const response = await fetch('/api/audit_diagram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image_base64: imageUrl
        })
      });

      const data = await response.json();

      console.log('审图请求完成:', {
        ok: response.ok,
        status: response.status,
        passed: response.ok ? Boolean(data.is_pass) : null,
      });

      if (response.ok) {
        let message = '审图报告\n\n';

        // 审核结果
        message += `${data.is_pass ? '审核通过' : '需要改进'}\n\n`;

        // 核心评价
        if (data.overview) {
          message += `${data.overview}\n\n`;
        }

        // 闪光点
        if (data.positive && data.positive.length > 0) {
          message += `闪光点：\n`;
          data.positive.forEach((item) => {
            message += `• ${item}\n`;
          });
          message += '\n';
        }

        // 需要改进
        if (data.negative && data.negative.length > 0) {
          message += `需要改进：\n`;
          data.negative.forEach((item) => {
            message += `• ${item}\n`;
          });
          message += '\n';
        }

        // 改进建议
        if (data.suggestions && data.suggestions.length > 0) {
          message += `改进建议：\n`;
          data.suggestions.forEach((item) => {
            message += `• ${item}\n`;
          });
        }

        addChatMessage('assistant', message);

        // 同时添加到 workspaceChatMessages（带结构化审图数据）
        const { workspaceChatMessages } = get();
        set({
          workspaceChatMessages: [...workspaceChatMessages, {
            role: 'assistant',
            content: message,
            auditData: {
              is_pass: data.is_pass,
              overview: data.overview,
              positive: data.positive || [],
              negative: data.negative || [],
              suggestions: data.suggestions || [],
            }
          }]
        });
      } else {
        addChatMessage('assistant', `审图失败: ${data.detail || '未知错误'}`);
      }
    } catch (error) {
      console.error('审图失败:', error);
      addChatMessage('assistant', '审图失败，请稍后重试');
    }
  },

  drawingMode: false,
  setDrawingMode: (mode) => set({ drawingMode: mode }),

  canvasDataUrl: null,
  setCanvasDataUrl: (dataUrl) => set({ canvasDataUrl: dataUrl }),

  canvasHistory: [],
  historyIndex: -1,
  fabricInstance: null,
  setFabricInstance: (instance) => set({ fabricInstance: instance }),

  saveCanvasState: () => {
    const { fabricInstance, canvasHistory, historyIndex } = get();
    if (!fabricInstance) return;

    const json = fabricInstance.toJSON();
    const newHistory = canvasHistory.slice(0, historyIndex + 1);
    newHistory.push(json);

    set({
      canvasHistory: newHistory.slice(-50),
      historyIndex: newHistory.length - 1
    });
  },

  undo: () => {
    const { fabricInstance, canvasHistory, historyIndex } = get();
    if (!fabricInstance || historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    fabricInstance.loadFromJSON(canvasHistory[newIndex], () => {
      fabricInstance.renderAll();
    });
    set({ historyIndex: newIndex });
  },

  redo: () => {
    const { fabricInstance, canvasHistory, historyIndex } = get();
    if (!fabricInstance || historyIndex >= canvasHistory.length - 1) return;

    const newIndex = historyIndex + 1;
    fabricInstance.loadFromJSON(canvasHistory[newIndex], () => {
      fabricInstance.renderAll();
    });
    set({ historyIndex: newIndex });
  },

  clearCanvas: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    fabricInstance.clear();
    fabricInstance.backgroundColor = '#ffffff';
    fabricInstance.renderAll();
    set({ canvasHistory: [], historyIndex: -1 });
  },

  deleteSelected: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const activeObjects = fabricInstance.getActiveObjects();
    if (activeObjects.length > 0) {
      activeObjects.forEach(obj => fabricInstance.remove(obj));
      fabricInstance.discardActiveObject();
      fabricInstance.renderAll();
    }
  },

  bringForward: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const activeObject = fabricInstance.getActiveObject();
    if (activeObject) {
      fabricInstance.bringForward(activeObject);
      fabricInstance.renderAll();
    }
  },

  sendBackward: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const activeObject = fabricInstance.getActiveObject();
    if (activeObject) {
      fabricInstance.sendBackward(activeObject);
      fabricInstance.renderAll();
    }
  },

  addText: async () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const { IText } = await loadFabric();
    const text = new IText('双击编辑文字', {
      left: fabricInstance.width / 2 - 60,
      top: fabricInstance.height / 2 - 20,
      fontSize: 24,
      fill: '#000000',
      fontFamily: 'Inter, sans-serif'
    });

    fabricInstance.add(text);
    fabricInstance.setActiveObject(text);
    fabricInstance.renderAll();
  },

  changeTextColor: (color) => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const activeObject = fabricInstance.getActiveObject();
    if (activeObject && activeObject.type === 'i-text') {
      activeObject.set('fill', color);
      fabricInstance.renderAll();
    }
  },

  uploadImage: (file) => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const { FabricImage } = await loadFabric();
      FabricImage.fromURL(e.target.result)
        .then((img) => {
          const maxWidth = fabricInstance.width * 0.5;
          const maxHeight = fabricInstance.height * 0.5;
          const scale = Math.min(maxWidth / img.width, maxHeight / img.height);

          img.scale(scale);
          fabricInstance.centerObject(img);
          fabricInstance.add(img);
          fabricInstance.setActiveObject(img);
          fabricInstance.renderAll();
        });
    };
    reader.readAsDataURL(file);
  },

  downloadCanvas: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const activeObject = fabricInstance.getActiveObject();

    if (activeObject) {
      // 有选中对象，仅下载选中对象
      const dataURL = safeCanvasToDataUrl(activeObject, {
        format: 'png',
        quality: 1,
        multiplier: 2
      });

      if (!dataURL) {
        toast.error('当前对象无法导出，请重新上传图片后再试');
        return;
      }

      const link = document.createElement('a');
      link.download = `neovista-selection-${Date.now()}.png`;
      link.href = dataURL;
      link.click();
    } else {
      // 无选中对象，显示 Toast 提示
      toast.error('请先选择要下载的对象', {
        duration: 2000,
        style: {
          background: '#FEE2E2',
          color: '#991B1B',
        },
      });
    }
  },

  saveProject: (projectName) => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const thumbnail = safeCanvasToDataUrl(fabricInstance, {
      format: 'png',
      quality: 0.8,
    });
    if (!thumbnail) {
      toast.error('项目缩略图生成失败，请重新上传图片后再试');
      return;
    }
    const recentProjects = JSON.parse(localStorage.getItem('neovista_recent_projects') || '[]');

    recentProjects.unshift({
      id: Date.now(),
      name: projectName || `项目 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      thumbnail,
      timestamp: Date.now()
    });

    localStorage.setItem('neovista_recent_projects', JSON.stringify(recentProjects.slice(0, 10)));
  },

  batchGenerate: async (userParams = '', count = 3) => {
    const { activeSkill, addChatMessage, ensureAuthenticatedForModelAction } = get();

    if (!activeSkill) {
      addChatMessage('assistant', '请先选择一个模版');
      return;
    }

    if (!ensureAuthenticatedForModelAction('批量生成图片')) {
      return;
    }
    if (Number(count) > 1) {
      addChatMessage('assistant', '为避免多扣积分，当前版本已停用批量生图，本次只提交 1 张。');
    }
    return get().generateImage(userParams, activeSkill, null, null);
  },

  batchResults: [],

  generateImage: async (
    userParams = '',
    templateId = null,
    customPromptStructure = null,
    imageDatas = null,
    effectivePrompt = '',
  ) => {
    const {
      activeSkill,
      addChatMessage,
      canvasDataUrl,
      token,
      user,
      setUser,
      resolution,
      aspectRatio,
      setProgrammaticUpdate,
      selectedModel,
      refreshBilling,
      ensureAuthenticatedForModelAction,
      setShowAuthModal,
    } = get();

    const finalTemplateId = templateId || activeSkill;

    if (!ensureAuthenticatedForModelAction('生成图片')) {
      return;
    }
    if (!user?.id) {
      addChatMessage('assistant', '登录状态仍在同步，请稍后再提交生图请求。');
      return;
    }

    const imageCapabilities = await get().loadImageCapabilities();
    const currentModel = get().selectedModel || selectedModel;
    const capabilityModel = getImageCapabilityModel(imageCapabilities, currentModel);
    const requestResolution = normalizeImageResolution(
      imageCapabilities,
      currentModel,
      get().resolution || resolution,
    );
    const requestAspectRatio = normalizeImageAspectRatio(
      imageCapabilities,
      currentModel,
      get().aspectRatio || aspectRatio,
    );
    if (!imageCapabilities?.enabled || !capabilityModel || !requestResolution || !requestAspectRatio) {
      addChatMessage('assistant', imageCapabilities?.disabledReason || '生图模型与价格能力未加载，已阻止提交');
      return;
    }

    // 如果有模板，检查是否为图生图模版
    if (finalTemplateId) {
      try {
        const templateRes = await fetch(`${API_BASE}/v1/templates/${finalTemplateId}`);
        const templateData = await templateRes.json();
        const normalizedImages = normalizeReferenceImages(imageDatas);
        const fallbackCanvasImages = normalizeReferenceImages(canvasDataUrl);

        if (templateData.is_i2i && normalizedImages.length === 0 && fallbackCanvasImages.length === 0) {
          addChatMessage('assistant', '此模版需要上传底图，请先在画布中上传图片或绘制内容');
          return;
        }
      } catch (error) {
        console.error('获取模版信息失败:', error);
      }
    }

    addChatMessage('user', userParams || '生成图片');

    const generationRequest = createGenerationRequestState();
    const clearRequestState = clearGenerationRequestState();

    set({
      isGenerating: true,
      ...generationRequest.nextState,
    });

    try {
      const finalImageList = (() => {
        const normalizedImages = normalizeReferenceImages(imageDatas);
        if (normalizedImages.length > 0) {
          return normalizedImages;
        }
        return normalizeReferenceImages(canvasDataUrl);
      })();
      if (finalImageList.length > 0 && !capabilityModel.supportsReferenceImages) {
        addChatMessage('assistant', '当前模型不支持参考图，已阻止提交');
        set({ ...clearRequestState, isGenerating: false });
        return;
      }

      let resolvedPromptStructure = customPromptStructure;
      let resolvedEffectivePrompt = String(effectivePrompt || '').trim();
      if (finalTemplateId && !resolvedEffectivePrompt) {
        const preview = await fetchTemplatePromptPreview({
          templateId: finalTemplateId,
          token,
          userParams,
          customPromptStructure,
        });
        resolvedPromptStructure = preview.promptStructure;
        resolvedEffectivePrompt = preview.effectivePrompt;
      }

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const requestPayload = {
        template_id: finalTemplateId || null,
        user_params: userParams,
        image_data: finalImageList[0] || null,
        image_datas: finalImageList.length > 0 ? finalImageList : null,
        custom_prompt_structure: resolvedPromptStructure,
        resolution: requestResolution,
        aspect_ratio: requestAspectRatio,
        num_images: 1,
        selected_model: currentModel,
      };
      const endpoint = '/v1/generate';
      const requestFingerprint = createImageRequestFingerprint(endpoint, requestPayload);
      const storedPending = loadPendingImageSubmission(globalThis.localStorage, user.id);
      if (storedPending && (
        storedPending.endpoint !== endpoint
        || storedPending.requestFingerprint !== requestFingerprint
      )) {
        addChatMessage('assistant', '已有生图请求尚未确认结束，正在恢复上一条请求。为避免重复扣费，暂不提交新请求。');
        set({ ...clearRequestState, isGenerating: false, pendingImageRequest: storedPending });
        void get().recoverPendingImageRequest();
        return;
      }
      const requestId = storedPending?.requestId || createClientRequestId();
      const pendingMarker = persistPendingImageSubmission({
        requestId,
        ownerUserId: user.id,
        endpoint,
        requestFingerprint,
        createdAt: storedPending?.createdAt || Date.now(),
      });
      if (!pendingMarker) {
        addChatMessage('assistant', '无法安全保存生图请求标识，已阻止提交，请刷新后重试。');
        set({ ...clearRequestState, isGenerating: false });
        return;
      }
      set({ pendingImageRequest: pendingMarker });

      const response = await fetch(`${API_BASE}/v1/generate`, {
        method: 'POST',
        headers,
        signal: generationRequest.signal,
        body: JSON.stringify({
          request_id: requestId,
          ...requestPayload,
        }),
      });

      set(clearRequestState);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setShowAuthModal(true);
        } else if (response.status === 402) {
          addChatMessage('assistant', '积分不足，请充值');
        } else {
          addChatMessage('assistant', data.detail || '生成失败，请重试');
        }
        if ([400, 401, 402, 403, 404, 422, 429].includes(response.status)) {
          clearPendingImageSubmission(globalThis.localStorage, requestId, user.id);
          set({ pendingImageRequest: null });
        } else {
          void get().recoverPendingImageRequest();
        }
        set({ ...clearRequestState, isGenerating: false });
        return;
      }

      const imageUrl = getGeneratedImageUrlOrThrow(data);
      clearPendingImageSubmission(globalThis.localStorage, requestId, user.id);
      addChatMessage('assistant', '已生成图片', imageUrl);

      // 同时添加到 workspaceChatMessages（用于显示审图按钮和模板溯源）
      const { workspaceChatMessages, activeTemplateName } = get();
      set({
        workspaceChatMessages: [...workspaceChatMessages, buildGeneratedImageMessage({
          content: '已生成图片',
          imageUrl,
          templateName: finalTemplateId ? activeTemplateName : null,
          prompt: resolvedEffectivePrompt,
        })]
      });

      // 自动加载到画布
      const { fabricInstance } = get();
      await addGeneratedImageToCanvas({
        fabricInstance,
        imageUrl,
        setProgrammaticUpdate,
      });


      if (user && typeof data.remaining_credits === 'number') {
        setUser({ ...user, credits: data.remaining_credits });
      }
      refreshBilling().catch(() => null);

      set({
        ...clearRequestState,
        pendingImageRequest: null,
        generatedImage: {
          url: imageUrl,
          timestamp: data.timestamp,
        },
        isGenerating: false,
        readyToGenerate: false,
        suggestedParams: null,
        suggestedTemplateId: null,
        agentMode: false,
        chatInput: '',
        canvasDataUrl: null,
      });
    } catch (error) {
      if (isAbortGenerationError(error)) {
        get().addSystemMessage('已停止等待生图响应；这不代表云端生成已取消，系统会按原 request_id 恢复结果');
        toast('已停止等待，不代表云端生图已取消');
        set({ ...clearRequestState, isGenerating: false });
        void get().recoverPendingImageRequest();
        return;
      }

      console.error('Failed to generate image:', error);
      addChatMessage('assistant', '暂时无法确认生图结果。系统已保留 request_id，将继续恢复，请勿立即重复提交。');
      set({ ...clearRequestState, isGenerating: false });
      void get().recoverPendingImageRequest();
    }
  },

  generateVideo: async (userParams, imageDatas, compiledRequest = null) => {
    const {
      token,
      user,
      selectedModel,
      aspectRatio,
      videoDurationSeconds,
      videoResolution,
      videoFrameMode,
      videoGenerateAudio,
      seedanceReferenceVideo,
      authEpoch,
      ensureAuthenticatedForModelAction,
    } = get();

    if (!ensureAuthenticatedForModelAction('生成视频')) {
      return;
    }

    const authContext = { token, ownerUserId: user?.id, authEpoch };
    if (!user?.id || !isSameAuthContext(get, authContext)) {
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: '登录状态仍在同步，请稍后再提交 Seedance 任务。',
      });
      return;
    }

    const capabilities = await get().loadVideoCapabilities();
    if (!isSameAuthContext(get, authContext)) {
      return;
    }
    if (!isUsableVideoCapabilities(capabilities, selectedModel)) {
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: capabilities?.disabled_reason || 'Seedance 视频服务暂不可用，请稍后再试。',
      });
      toast.error('Seedance 视频服务暂不可用');
      return;
    }

    const normalizedImages = normalizeReferenceImages(imageDatas);
    const referenceVideoUrl = seedanceReferenceVideo?.video_url || null;
    const freshRequest = createGenerationRequestDto({
      model: selectedModel,
      prompt: userParams,
      duration: videoDurationSeconds,
      resolution: videoResolution,
      aspectRatio,
      frameMode: videoFrameMode,
      referenceImages: normalizedImages,
      hasReferenceVideo: Boolean(referenceVideoUrl),
      referenceVideoSignature: createReferenceVideoSignature(seedanceReferenceVideo),
      capabilities,
    });
    if (compiledRequest) {
      const comparison = compareGenerationRequest(compiledRequest, freshRequest);
      if (comparison.stale) {
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: `Seedance 请求参数或价格已变化（${comparison.changedFields.join('、')}），请重新编译后再提交。`,
        });
        toast.error('Seedance 请求已过期，请重新编译');
        return;
      }
    }
    const requestDto = compiledRequest || freshRequest;

    const storedActiveTask = loadActiveVideoTask(globalThis.localStorage, user.id);
    const storedPendingSubmission = loadPendingVideoSubmission(globalThis.localStorage, user.id);
    if (
      (storedActiveTask && isActiveVideoTaskOwnedByUser(storedActiveTask, user))
      || storedPendingSubmission
    ) {
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: '已有 Seedance 任务尚未确认结束，正在恢复该任务。为避免重复扣费，暂不提交新任务。',
      });
      void get().recoverActiveVideoTask({
        requestId: storedPendingSubmission?.requestId || null,
      });
      toast('正在恢复上一条 Seedance 任务');
      return;
    }

    const userMsg = {
      role: 'user',
      content: requestDto.prompt || '生成视频',
      imageDatas: [...normalizedImages],
    };
    const updated = [...get().workspaceChatMessages, userMsg];
    const generationRequest = createGenerationRequestState();
    const clearRequestState = clearGenerationRequestState();
    const requestId = createClientRequestId();
    persistPendingVideoSubmission({
      requestId,
      ownerUserId: user?.id || null,
      createdAt: Date.now(),
    });

    set({
      workspaceChatMessages: updated,
      isGenerating: true,
      activeVideoPollingTaskId: null,
      ...generationRequest.nextState,
    });

    try {
      const response = await fetch(`${API_BASE}/v1/video/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        signal: generationRequest.signal,
        body: JSON.stringify({
          request_id: requestId,
          prompt: requestDto.prompt,
          image_datas: normalizedImages.length > 0 ? normalizedImages : null,
          aspect_ratio: requestDto.aspectRatio,
          resolution: requestDto.resolution,
          video_mode: requestDto.frameMode,
          reference_video_url: seedanceReferenceVideo?.video_url || null,
          duration_seconds: requestDto.duration,
          generate_audio: Boolean(videoGenerateAudio),
          selected_model: requestDto.model,
        }),
      });
      const createdTask = await readResponseJson(response);

      if (
        !isSameAuthContext(get, authContext)
        || get().activeGenerationController !== generationRequest.controller
      ) {
        return;
      }

      if (!response.ok) {
        if ([400, 401, 402, 403, 404, 422, 423, 429].includes(response.status)) {
          clearPendingVideoSubmission(globalThis.localStorage, requestId, user.id);
        }
        const errorText = response.status === 402
          ? '积分不足，请充值'
          : getApiErrorMessage(createdTask, '视频任务创建失败');
        appendWorkspaceMessage(set, get, { role: 'assistant', content: errorText });
        set({
          ...clearRequestState,
          isGenerating: false,
        });
        if ([408, 409].includes(response.status) || response.status >= 500) {
          void get().recoverActiveVideoTask({ requestId });
        } else if (response.status === 423) {
          void get().recoverActiveVideoTask();
        }
        return;
      }

      const taskId = String(createdTask.task_id || '').trim();
      if (!taskId) {
        throw new Error('Seedance 任务已提交，但响应中缺少任务 ID');
      }
      const activeVideoTask = persistVideoTaskState(set, {
        taskId,
        requestId: createdTask.request_id || requestId,
        ownerUserId: user?.id || null,
        createdAt: Date.now(),
        lastCheckedAt: null,
        lastStatus: createdTask.status || 'submitted',
      });
      if (!activeVideoTask) {
        set({
          ...clearRequestState,
          activeVideoPollingTaskId: null,
          isGenerating: false,
        });
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: '另一标签页已更新 Seedance 恢复状态，正在按请求标识重新核对，未重复提交。',
        });
        void get().recoverActiveVideoTask({ requestId });
        return;
      }
      clearPendingVideoSubmission(globalThis.localStorage, requestId, user.id);
      set((state) => ({
        activeVideoPollingTaskId: taskId,
        ...(referenceVideoUrl && state.seedanceReferenceVideo?.video_url === referenceVideoUrl
          ? { seedanceReferenceVideo: null, videoFrameMode: 'auto' }
          : {}),
      }));
      appendWorkspaceMessage(set, get, {
        role: 'assistant',
        content: 'Seedance 视频任务已提交，正在生成...',
      });
      await watchSeedanceVideoTask({
        set,
        get,
        task: activeVideoTask,
        token,
        ownerUserId: user?.id,
        authEpoch,
        generationRequest,
      });
    } catch (error) {
      if (
        !isSameAuthContext(get, authContext)
        || get().activeGenerationController !== generationRequest.controller
      ) {
        return;
      }
      if (isAbortGenerationError(error)) {
        get().addSystemMessage('已停止等待 Seedance 提交结果；这不代表云端任务已取消');
        toast('已停止等待，不代表云端任务已取消');
        if (get().activeGenerationController === generationRequest.controller) {
          set({ ...clearRequestState, activeVideoPollingTaskId: null, isGenerating: false });
        }
        return;
      }

      console.error('Failed to generate video:', error);
      set({
        ...clearRequestState,
        activeVideoPollingTaskId: null,
        isGenerating: false,
      });
      const recovered = await get().recoverActiveVideoTask({ requestId });
      const pendingSubmission = loadPendingVideoSubmission(globalThis.localStorage, user.id);
      if (
        !recovered
        && isSameAuthContext(get, authContext)
        && pendingSubmission?.requestId === requestId
      ) {
        appendWorkspaceMessage(set, get, {
          role: 'assistant',
          content: '暂时无法确认 Seedance 提交结果。系统会保留请求标识，并在刷新或重新登录后继续恢复，请勿立即重复提交。',
        });
      }
    }
  },
}));
