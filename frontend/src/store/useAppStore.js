import { create } from 'zustand';
import * as fabric from 'fabric';
import toast from 'react-hot-toast';
import {
  buildGeneratedImageMessage,
  getGeneratedImageUrlOrThrow,
  summarizeGeneratedImageUrl,
} from './generatedImageUtils.js';

// API 基础路径（开发和生产都用相对路径，Vite proxy 处理）
const API_BASE = '/api';

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
    suggestedParams,
    suggestedTemplateId,
    replyTextLength: replyText.length
  });

  return { replyText, readyToGenerate, suggestedParams, suggestedTemplateId };
};

// 智能截断历史记录（UI 与 API 解耦）
const prepareMessagesForAPI = (messages, maxMessages = 10) => {
  // 1. 过滤掉纯 UI 消息
  const apiMessages = messages.filter(msg =>
    msg.role === 'user' || msg.role === 'assistant'
  );

  // 2. 保留最近 N 条
  let trimmedMessages = apiMessages;
  if (apiMessages.length > maxMessages) {
    trimmedMessages = apiMessages.slice(-maxMessages);
  }

  // 3. 确保首条为 user（OpenAI API 要求）
  if (trimmedMessages.length > 0 && trimmedMessages[0].role !== 'user') {
    const firstUserIndex = trimmedMessages.findIndex(msg => msg.role === 'user');
    if (firstUserIndex > 0) {
      trimmedMessages = trimmedMessages.slice(firstUserIndex);
    } else if (firstUserIndex === -1) {
      return [];
    }
  }

  // 4. 转换为 API 格式
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
    const img = await fabric.FabricImage.fromURL(imageUrl);
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
  setUser: (user) => set({ user }),
  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null, billingSummary: null });
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
    uploadedImage: null
  }),

  // 触发模板参数调整（调用 Agent 1）
  triggerTemplateAdjustParams: async () => {
    const { activeSkill, activeTemplateName, homeSessionId, workspaceChatMessages } = get();

    if (!activeSkill) return;

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
        headers: { 'Content-Type': 'application/json' },
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
  setShowAuthModal: (show) => set({ showAuthModal: show }),

  showGenerateModal: false,
  setShowGenerateModal: (show) => set({ showGenerateModal: show }),
  showRedeemModal: false,
  setShowRedeemModal: (show) => set({ showRedeemModal: show }),

  chatInput: '',
  setChatInput: (input) => set({ chatInput: input }),

  isGenerating: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),

  generatedImage: null,
  setGeneratedImage: (image) => set({ generatedImage: image }),

  chatHistory: [],
  addChatMessage: (role, content, imageUrl = null) => {
    const { chatHistory } = get();
    set({
      chatHistory: [...chatHistory, { role, content, imageUrl, timestamp: Date.now() }]
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
  uploadedImage: null,         // 用户上传的参考底图
  resolution: '2K',            // 生图分辨率
  aspectRatio: '1:1',          // 生图比例
  numImages: 1,                // 生图数量（默认 1 张）
  selectedModel: '',           // 生图模型（默认未选择）
  setAgentMode: (mode) => set({ agentMode: mode }),
  setUploadedImage: (image) => set({ uploadedImage: image }),
  setResolution: (res) => set({ resolution: res }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setNumImages: (num) => set({ numImages: num }),
  setSelectedModel: (model) => set({ selectedModel: model }),

  refreshBilling: async () => {
    const { token, user } = get();
    if (!token) {
      set({ billingSummary: null });
      return null;
    }

    const response = await fetch(`${API_BASE}/v1/billing/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || '刷新账单信息失败');
    }

    set((state) => ({
      billingSummary: data,
      user: user && state.user ? { ...state.user, credits: data.credits } : state.user,
    }));

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
    set({ homeSessionId: sessionId, isWorkspaceChatLoading: true });

    try {
      const response = await fetch(`${API_BASE}/v1/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  directChat: async (message, imageData) => {
    const { workspaceChatMessages } = get();

    const userMsg = { role: 'user', content: message };
    const updated = [...workspaceChatMessages, userMsg];
    set({ workspaceChatMessages: updated, isWorkspaceChatLoading: true });

    try {
      const response = await fetch('/api/v1/direct-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          image_data: imageData || null
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

  workspaceChat: async (message, imageData) => {
    const { homeSessionId, workspaceChatMessages, addChatMessage, agentMode } = get();

    // 追加用户消息
    const userMsg = { role: 'user', content: message };
    const updated = [...workspaceChatMessages, userMsg];
    set({ workspaceChatMessages: updated, isWorkspaceChatLoading: true });
    addChatMessage('user', message);

    try {
      // 智能截断历史记录（UI 显示全部，API 只发送必要上下文）
      const apiMessages = prepareMessagesForAPI(updated, 10);

      const response = await fetch(`${API_BASE}/v1/agent/workspace-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          image_data: imageData || null,
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
    const { homeSessionId, token, suggestedTemplateId, addChatMessage, setShowAuthModal, fabricInstance, setProgrammaticUpdate, numImages, activeSkill, resolution, aspectRatio, user, setUser, refreshBilling } = get();

    if (!homeSessionId) {
      addChatMessage('assistant', '会话ID丢失，请刷新页面重试');
      return;
    }

    if (!token) {
      setShowAuthModal(true);
      return;
    }

    // 底图硬校验
    if (suggestedTemplateId) {
      const response = await fetch(`${API_BASE}/v1/templates`);
      const data = await response.json();
      const template = data.templates.find(t => t.id === suggestedTemplateId);

      if (template && template.is_i2i) {
        const hasImage = fabricInstance && fabricInstance.getObjects().some(obj => obj.type === 'image');
        if (!hasImage) {
          addChatMessage('assistant', '当前模版需要参考底图。请先在左侧工作区（Fabric 画布）中上传或粘贴您的场地底图，然后再点击生成。');
          set({ isGenerating: false });
          return;
        }
      }
    }

    set({ readyToGenerate: false, isGenerating: true });

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
          let compressed = canvas.toDataURL('image/jpeg', quality);

          while (compressed.length > 2 * 1024 * 1024 && quality > 0.1) {
            quality -= 0.1;
            compressed = canvas.toDataURL('image/jpeg', quality);
          }

          base_image = compressed;
        }
      }

      const response = await fetch(`${API_BASE}/generate_diagram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          request_id: createClientRequestId(),
          session_id: homeSessionId,
          base_image,
          num_images: numImages,
          template_id: activeSkill || suggestedTemplateId,
          resolution: resolution,
          aspect_ratio: aspectRatio
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.detail || '生成失败';
        addChatMessage('assistant', `生成失败: ${errorMsg}`);
        set({ isGenerating: false });
        return;
      }

      const imageUrl = getGeneratedImageUrlOrThrow(data);
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
      });
      console.log('准备添加的消息:', newMessage);

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
        generatedImage: { url: imageUrl, timestamp: data.timestamp },
        isGenerating: false
      });

      if (user && typeof data.remaining_credits === 'number') {
        setUser({ ...user, credits: data.remaining_credits });
      }
      refreshBilling().catch(() => null);

    } catch (error) {
      console.error('生图失败:', error);
      toast.error(`生图异常: ${error.message || '网络错误'}`);
      addChatMessage('assistant', `生图失败: ${error.message || '网络错误'}`);
      set({ isGenerating: false });
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
    console.log('imageUrl:', imageUrl);

    const { token, addChatMessage } = get();

    console.log('token:', token ? '存在' : '不存在');

    if (!token || !imageUrl) {
      console.log('❌ 缺少 token 或 imageUrl，提前返回');
      return;
    }

    addChatMessage('assistant', '正在进行专业审图分析...');

    try {
      console.log('📡 发送审图请求...');
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

      console.log('审图返回数据:', data);

      if (response.ok) {
        let message = '📊 审图报告\n\n';

        // 审核结果
        message += `${data.is_pass ? '✅ 审核通过' : '⚠️ 需要改进'}\n\n`;

        // 核心评价
        if (data.overview) {
          message += `${data.overview}\n\n`;
        }

        // 闪光点
        if (data.positive && data.positive.length > 0) {
          message += `💡 闪光点：\n`;
          data.positive.forEach((item) => {
            message += `• ${item}\n`;
          });
          message += '\n';
        }

        // 需要改进
        if (data.negative && data.negative.length > 0) {
          message += `⚠️ 需要改进：\n`;
          data.negative.forEach((item) => {
            message += `• ${item}\n`;
          });
          message += '\n';
        }

        // 改进建议
        if (data.suggestions && data.suggestions.length > 0) {
          message += `💡 改进建议：\n`;
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

  addText: () => {
    const { fabricInstance } = get();
    if (!fabricInstance) return;

    const text = new fabric.IText('双击编辑文字', {
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
    reader.onload = (e) => {
      fabric.FabricImage.fromURL(e.target.result)
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
      const dataURL = activeObject.toDataURL({
        format: 'png',
        quality: 1,
        multiplier: 2
      });

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

    const thumbnail = fabricInstance.toDataURL({ format: 'png', quality: 0.8 });
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
    const { activeSkill, addChatMessage } = get();

    if (!activeSkill) {
      addChatMessage('assistant', '请先选择一个模版');
      return;
    }

    addChatMessage('user', `批量生成 ${count} 个方案`);

    set({ isGenerating: true });

    try {
      const canvasDataUrl = get().canvasDataUrl;
      const results = [];

      for (let i = 0; i < count; i++) {
        const response = await fetch(`${API_BASE}/v1/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: activeSkill,
            user_params: userParams ? `${userParams} (方案 ${i + 1})` : `方案 ${i + 1}`,
            image_data: canvasDataUrl,
          }),
        });

        const data = await response.json();
        results.push(data.image_url);
      }

      addChatMessage('assistant', `已生成 ${count} 个方案`, results[0]);

      set({
        generatedImage: { url: results[0], timestamp: Date.now() },
        batchResults: results,
        isGenerating: false,
        chatInput: '',
        canvasDataUrl: null,
      });
    } catch (error) {
      console.error('Batch generation failed:', error);
      addChatMessage('assistant', '批量生成失败');
      set({ isGenerating: false });
    }
  },

  batchResults: [],

  generateImage: async (userParams = '', templateId = null, customPromptStructure = null, imageData = null) => {
    const { activeSkill, addChatMessage, canvasDataUrl, token, user, setUser, setShowAuthModal, resolution, aspectRatio, setProgrammaticUpdate, numImages, refreshBilling } = get();

    const finalTemplateId = templateId || activeSkill;

    if (!token) {
      setShowAuthModal(true);
      return;
    }

    // 如果有模板，检查是否为图生图模版
    if (finalTemplateId) {
      try {
        const templateRes = await fetch(`${API_BASE}/v1/templates/${finalTemplateId}`);
        const templateData = await templateRes.json();

        if (templateData.is_i2i && !imageData && !canvasDataUrl) {
          addChatMessage('assistant', '此模版需要上传底图，请先在画布中上传图片或绘制内容');
          return;
        }
      } catch (error) {
        console.error('获取模版信息失败:', error);
      }
    }

    addChatMessage('user', userParams || '生成图片');

    set({ isGenerating: true });

    try {
      const finalImageData = imageData || canvasDataUrl;

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const response = await fetch(`${API_BASE}/v1/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          request_id: createClientRequestId(),
          template_id: finalTemplateId || null,
          user_params: userParams,
          image_data: finalImageData,
          custom_prompt_structure: customPromptStructure,
          resolution: resolution,
          aspect_ratio: aspectRatio,
          num_images: numImages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setShowAuthModal(true);
        } else if (response.status === 402) {
          addChatMessage('assistant', '积分不足，请充值');
        } else {
          addChatMessage('assistant', data.detail || '生成失败，请重试');
        }
        set({ isGenerating: false });
        return;
      }

      const imageUrl = getGeneratedImageUrlOrThrow(data);
      addChatMessage('assistant', '已生成图片', imageUrl);

      // 同时添加到 workspaceChatMessages（用于显示审图按钮和模板溯源）
      const { workspaceChatMessages, activeTemplateName } = get();
      set({
        workspaceChatMessages: [...workspaceChatMessages, buildGeneratedImageMessage({
          content: '已生成图片',
          imageUrl,
          templateName: finalTemplateId ? activeTemplateName : null,
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
        generatedImage: {
          url: imageUrl,
          timestamp: data.timestamp,
        },
        isGenerating: false,
        chatInput: '',
        canvasDataUrl: null,
      });
    } catch (error) {
      console.error('Failed to generate image:', error);
      addChatMessage('assistant', '生成失败，请重试');
      set({ isGenerating: false });
    }
  },
}));
