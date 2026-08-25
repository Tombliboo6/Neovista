import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const HISTORY_LIMIT = 50;
export const CANVAS_GRAPH_STORAGE_KEY = 'neovista.canvas.graph.v1';

const invalidateGenerationDraft = (draft, reason) => {
  if (!draft) return null;
  const staleReasons = Array.from(new Set([...(draft.staleReasons || []), reason].filter(Boolean)));
  return {
    ...draft,
    stale: true,
    staleReasons,
  };
};

const hasStructuralChanges = (changes = []) => changes.some((change) => (
  ['add', 'remove', 'replace', 'reset'].includes(change.type)
));

const resetCompiledShotStatuses = (node) => {
  if (node.type !== 'storyboard' || !Array.isArray(node.data?.shots)) return node;
  return {
    ...node,
    data: {
      ...node.data,
      shots: node.data.shots.map((shot) => (
        shot.status === 'compiled' ? { ...shot, status: 'draft' } : shot
      )),
    },
  };
};

const migrateCanvasNode = (node) => {
  const data = node.data || {};
  if (node.type === 'character') {
    return {
      ...node,
      data: {
        ...data,
        appearanceNotes: data.appearanceNotes || data.visualNotes || '',
        wardrobeNotes: data.wardrobeNotes || '',
        negativePrompt: data.negativePrompt || '',
        referenceAssets: data.referenceAssets || [],
        includeInGeneration: data.includeInGeneration ?? data.locked ?? true,
      },
    };
  }
  if (node.type === 'scene') {
    return {
      ...node,
      data: {
        ...data,
        negativePrompt: data.negativePrompt || '',
        referenceAssets: data.referenceAssets || [],
        includeInGeneration: data.includeInGeneration ?? data.locked ?? true,
      },
    };
  }
  if (node.type === 'continuity') {
    return {
      ...node,
      data: {
        ...data,
        selectedRules: data.selectedRules || data.lockedRules || [],
      },
    };
  }
  if (node.type === 'storyboard') {
    return resetCompiledShotStatuses({
      ...node,
      data: {
        ...data,
        shots: (data.shots || []).map((shot) => ({ ...shot, axis: shot.axis || '' })),
      },
    });
  }
  return node;
};

const STORY_STARTER_SHOTS = [
  {
    id: 'shot-01',
    index: 1,
    title: '雨幕中的旧影院',
    description: '雨夜，旧电影院霓虹灯忽明忽暗，主角撑伞走入画面。',
    prompt: '雨夜旧电影院外景，湿润路面反射青绿色霓虹，主角撑黑伞入画，电影感广角镜头',
    shotSize: '远景',
    camera: '缓慢推进',
    axis: '保持人物从画面左侧向右侧移动',
    duration: 5,
    status: 'draft',
  },
  {
    id: 'shot-02',
    index: 2,
    title: '空放映厅的回声',
    description: '主角穿过空放映厅，手电光扫过蒙尘座椅。',
    prompt: '废弃电影院内景，手电光划过红色旧座椅，人物背影，低照度，浅景深',
    shotSize: '中景',
    camera: '肩扛跟随',
    axis: '保持人物从画面左侧向右侧移动',
    duration: 6,
    status: 'draft',
  },
  {
    id: 'shot-03',
    index: 3,
    title: '银幕后的来信',
    description: '银幕背后，一封旧信贴在生锈胶片盒上。',
    prompt: '银幕背后特写，生锈胶片盒与泛黄信封，尘埃漂浮，暖色聚光，悬疑氛围',
    shotSize: '特写',
    camera: '微距静止',
    axis: '沿用上一镜头人物朝向',
    duration: 5,
    status: 'draft',
  },
];

const createId = (type = 'node') => `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const snapshotGraph = (state) => ({
  nodes: state.nodes.map((node) => ({ ...node, data: { ...node.data } })),
  edges: state.edges.map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined })),
});

const getNodeDefaults = (type) => {
  if (type === 'story') {
    return {
      title: '剧情脚本',
      text: '',
      genre: '都市悬疑',
      targetDuration: 45,
      outputType: 'story',
      status: 'draft',
    };
  }

  if (type === 'character') {
    return {
      title: '角色资产',
      name: '未命名角色',
      role: '主要角色',
      description: '',
      appearanceNotes: '',
      wardrobeNotes: '',
      negativePrompt: '',
      referenceAssets: [],
      includeInGeneration: true,
      outputType: 'character',
    };
  }

  if (type === 'scene') {
    return {
      title: '场景资产',
      name: '未命名场景',
      time: '日间',
      description: '',
      visualNotes: '',
      negativePrompt: '',
      referenceAssets: [],
      includeInGeneration: true,
      outputType: 'scene',
    };
  }

  if (type === 'continuity') {
    return {
      title: '连续性控制',
      rules: ['角色脸型与发型', '服装与道具', '场景光向', '镜头轴线'],
      selectedRules: ['角色脸型与发型', '服装与道具'],
      outputType: 'continuity',
    };
  }

  if (type === 'storyboard') {
    return {
      title: '剧情分镜表',
      shots: [],
      activeShotId: null,
      model: 'Seedance 2.0',
      aspectRatio: '16:9',
      outputType: 'storyboard',
    };
  }

  if (type === 'prompt') {
    return {
      title: '提示词',
      text: '',
      outputType: 'text',
    };
  }

  if (type === 'image') {
    return {
      title: '图片素材',
      url: '',
      outputType: 'image',
    };
  }

  if (type === 'video') {
    return {
      title: '视频素材',
      url: '',
      outputType: 'video',
    };
  }

  return {
    title: type === 'videoGenerator' ? 'Seedance 视频' : 'AI 生图',
    generationKind: type === 'videoGenerator' ? 'video' : 'image',
    outputType: type === 'videoGenerator' ? 'video' : 'image',
    status: 'idle',
  };
};

export const buildCanvasNode = (type, position, data = {}) => ({
  id: createId(type),
  type,
  position,
  data: {
    ...getNodeDefaults(type),
    ...data,
  },
});

export const useCanvasGraphStore = create(
  persist(
    (set, get) => ({
      viewMode: 'workflow',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      generationDraft: null,
      past: [],
      future: [],

      setViewMode: (viewMode) => set({ viewMode }),
      setViewport: (viewport) => set({ viewport }),
      setGenerationDraft: (generationDraft) => set({ generationDraft }),
      clearGenerationDraft: () => set({ generationDraft: null }),
      markGenerationDraftStale: (reasons = []) => set((state) => ({
        generationDraft: (Array.isArray(reasons) ? reasons : [reasons]).reduce(
          (draft, reason) => invalidateGenerationDraft(draft, reason),
          state.generationDraft,
        ),
      })),

      checkpoint: () => set((state) => ({
        past: [...state.past, snapshotGraph(state)].slice(-HISTORY_LIMIT),
        future: [],
      })),

      onNodesChange: (changes) => set((state) => ({
        nodes: applyNodeChanges(changes, state.nodes),
        generationDraft: hasStructuralChanges(changes)
          ? invalidateGenerationDraft(state.generationDraft, '画布节点结构已变化')
          : state.generationDraft,
      })),

      onEdgesChange: (changes) => set((state) => ({
        edges: applyEdgeChanges(changes, state.edges),
        generationDraft: hasStructuralChanges(changes)
          ? invalidateGenerationDraft(state.generationDraft, '镜头连接关系已变化')
          : state.generationDraft,
      })),

      connect: (connection) => {
        get().checkpoint();
        set((state) => ({
          edges: addEdge({
            ...connection,
            id: createId('edge'),
            type: 'smoothstep',
            animated: true,
          }, state.edges),
          generationDraft: invalidateGenerationDraft(state.generationDraft, '镜头连接关系已变化'),
        }));
      },

      addNode: (type, position, data = {}) => {
        const node = buildCanvasNode(type, position, data);
        get().checkpoint();
        set((state) => ({
          nodes: [...state.nodes, node],
          generationDraft: invalidateGenerationDraft(state.generationDraft, '画布节点结构已变化'),
        }));
        return node.id;
      },

      addAssetNode: ({ kind, url, title, position }) => {
        if (!url) return null;
        const existing = get().nodes.find((node) => node.data?.url === url);
        if (existing) return existing.id;

        return get().addNode(kind === 'video' ? 'video' : 'image', position, {
          title: title || (kind === 'video' ? '生成视频' : '生成图片'),
          url,
          source: 'generation',
        });
      },

      createStoryStarter: (position = { x: 96, y: 96 }) => {
        const storyNode = buildCanvasNode('story', position, {
          title: '雨夜影院 · 剧情脚本',
          text: '一场暴雨让年轻的城市档案员林澈躲进即将拆除的旧电影院。她在空放映厅里发现一卷没有片名的胶片，以及一封写给二十年后的信。',
          status: 'ready',
        });
        const characterNode = buildCanvasNode('character', {
          x: position.x + 390,
          y: position.y - 80,
        }, {
          title: '角色资产 · 林澈',
          name: '林澈',
          role: '主角 · 城市档案员',
          description: '28岁，冷静敏锐，对城市旧物有职业性的好奇。',
          appearanceNotes: '低马尾、冷静神态、人物面部轮廓保持一致。',
          wardrobeNotes: '深色短风衣、黑伞，雨水打湿发梢。',
          negativePrompt: '不要改变发型、年龄、风衣颜色和黑伞。',
        });
        const sceneNode = buildCanvasNode('scene', {
          x: position.x + 390,
          y: position.y + 250,
        }, {
          title: '场景资产 · 旧电影院',
          name: '长宁旧电影院',
          time: '雨夜',
          description: '停业多年的单厅电影院，红色绒布座椅与老式放映机仍被保留。',
          visualNotes: '青绿色霓虹、湿润地面反射、室内暖色尘埃光。',
          negativePrompt: '不要改成现代影院，不要改变红色座椅与青绿色霓虹主色。',
        });
        const continuityNode = buildCanvasNode('continuity', {
          x: position.x + 390,
          y: position.y + 550,
        });
        const storyboardNode = buildCanvasNode('storyboard', {
          x: position.x + 790,
          y: position.y + 40,
        }, {
          shots: STORY_STARTER_SHOTS.map((shot) => ({ ...shot })),
          activeShotId: STORY_STARTER_SHOTS[0].id,
        });
        const nodes = [storyNode, characterNode, sceneNode, continuityNode, storyboardNode];
        const edges = [
          { id: createId('edge'), source: storyNode.id, target: storyboardNode.id, targetHandle: 'script', type: 'smoothstep', animated: true },
          { id: createId('edge'), source: characterNode.id, target: storyboardNode.id, targetHandle: 'character', type: 'smoothstep', animated: true },
          { id: createId('edge'), source: sceneNode.id, target: storyboardNode.id, targetHandle: 'scene', type: 'smoothstep', animated: true },
          { id: createId('edge'), source: continuityNode.id, target: storyboardNode.id, targetHandle: 'continuity', type: 'smoothstep', animated: true },
        ];

        get().checkpoint();
        set((state) => ({
          nodes: [...state.nodes.map((node) => ({ ...node, selected: false })), ...nodes],
          edges: [...state.edges, ...edges],
          generationDraft: invalidateGenerationDraft(state.generationDraft, '剧情工作流结构已变化'),
        }));
        return nodes.map((node) => node.id);
      },

      updateNodeData: (nodeId, patch) => set((state) => ({
        nodes: state.nodes.map((node) => {
          const updatedNode = node.id === nodeId
            ? { ...node, data: { ...node.data, ...patch } }
            : node;
          const preservesProvidedShotStatuses = node.id === nodeId
            && Object.prototype.hasOwnProperty.call(patch, 'shots');
          return preservesProvidedShotStatuses ? updatedNode : resetCompiledShotStatuses(updatedNode);
        }),
        generationDraft: invalidateGenerationDraft(state.generationDraft, '镜头内容或约束已变化'),
      })),

      deleteSelected: () => {
        const { nodes, edges } = get();
        const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
        const selectedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

        get().checkpoint();
        set({
          nodes: nodes.filter((node) => !selectedNodeIds.has(node.id)),
          edges: edges.filter((edge) => (
            !selectedEdgeIds.has(edge.id)
            && !selectedNodeIds.has(edge.source)
            && !selectedNodeIds.has(edge.target)
          )),
          generationDraft: invalidateGenerationDraft(get().generationDraft, '镜头连接关系或节点已删除'),
        });
      },

      duplicateSelected: () => {
        const selectedNodes = get().nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) return;
        get().checkpoint();

        const copies = selectedNodes.map((node) => ({
          ...node,
          id: createId(node.type),
          position: { x: node.position.x + 32, y: node.position.y + 32 },
          selected: true,
          data: { ...node.data, title: `${node.data?.title || '节点'} 副本` },
        }));

        set((state) => ({
          nodes: [
            ...state.nodes.map((node) => ({ ...node, selected: false })),
            ...copies,
          ],
          generationDraft: invalidateGenerationDraft(state.generationDraft, '画布节点结构已变化'),
        }));
      },

      clearGraph: () => {
        if (get().nodes.length === 0 && get().edges.length === 0) return;
        get().checkpoint();
        set((state) => ({
          nodes: [],
          edges: [],
          generationDraft: invalidateGenerationDraft(state.generationDraft, '画布内容已清空'),
        }));
      },

      undo: () => {
        const { past } = get();
        if (past.length === 0) return;
        const previous = past[past.length - 1];
        set((state) => ({
          nodes: previous.nodes,
          edges: previous.edges,
          past: state.past.slice(0, -1),
          future: [snapshotGraph(state), ...state.future].slice(0, HISTORY_LIMIT),
          generationDraft: invalidateGenerationDraft(state.generationDraft, '画布已撤销到其他版本'),
        }));
      },

      redo: () => {
        const { future } = get();
        if (future.length === 0) return;
        const next = future[0];
        set((state) => ({
          nodes: next.nodes,
          edges: next.edges,
          past: [...state.past, snapshotGraph(state)].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
          generationDraft: invalidateGenerationDraft(state.generationDraft, '画布已重做到其他版本'),
        }));
      },
    }),
    {
      name: CANVAS_GRAPH_STORAGE_KEY,
      version: 2,
      migrate: (persistedState) => ({
        ...persistedState,
        nodes: (persistedState?.nodes || []).map(migrateCanvasNode),
      }),
      partialize: ({ nodes, edges, viewport, viewMode }) => ({
        nodes: nodes.map(resetCompiledShotStatuses),
        edges,
        viewport,
        viewMode,
      }),
    },
  ),
);
