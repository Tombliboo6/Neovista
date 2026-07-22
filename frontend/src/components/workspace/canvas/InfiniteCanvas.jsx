import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpenText, Clapperboard, ImagePlus, Link2, MapPin, MessageSquareText, UserRound, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useCanvasGraphStore } from '../../../store/useCanvasGraphStore';
import CanvasToolbar from './CanvasToolbar';
import {
  CharacterNode,
  ContinuityNode,
  GenerationNode,
  ImageNode,
  PromptNode,
  SceneNode,
  StoryboardNode,
  StoryNode,
  VideoNode,
} from './CanvasNodes';
import './infiniteCanvas.css';

const CANVAS_NODE_TYPES = {
  story: StoryNode,
  character: CharacterNode,
  scene: SceneNode,
  continuity: ContinuityNode,
  storyboard: StoryboardNode,
  prompt: PromptNode,
  image: ImageNode,
  video: VideoNode,
  imageGenerator: GenerationNode,
  videoGenerator: GenerationNode,
};

const isTextInput = (element) => (
  element?.tagName === 'INPUT'
  || element?.tagName === 'TEXTAREA'
  || element?.isContentEditable
);

function CanvasSurface() {
  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadPositionRef = useRef(null);
  const importedResultUrlsRef = useRef(new Set());
  const [menu, setMenu] = useState(null);
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow();
  const nodes = useCanvasGraphStore((state) => state.nodes);
  const edges = useCanvasGraphStore((state) => state.edges);
  const viewport = useCanvasGraphStore((state) => state.viewport);
  const onNodesChange = useCanvasGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasGraphStore((state) => state.onEdgesChange);
  const connect = useCanvasGraphStore((state) => state.connect);
  const addNode = useCanvasGraphStore((state) => state.addNode);
  const addAssetNode = useCanvasGraphStore((state) => state.addAssetNode);
  const createStoryStarter = useCanvasGraphStore((state) => state.createStoryStarter);
  const checkpoint = useCanvasGraphStore((state) => state.checkpoint);
  const deleteSelected = useCanvasGraphStore((state) => state.deleteSelected);
  const duplicateSelected = useCanvasGraphStore((state) => state.duplicateSelected);
  const undo = useCanvasGraphStore((state) => state.undo);
  const redo = useCanvasGraphStore((state) => state.redo);
  const setViewport = useCanvasGraphStore((state) => state.setViewport);
  const setViewMode = useCanvasGraphStore((state) => state.setViewMode);
  const workspaceChatMessages = useAppStore((state) => state.workspaceChatMessages);
  const generatedImage = useAppStore((state) => state.generatedImage);

  const defaultEdgeOptions = useMemo(() => ({
    type: 'smoothstep',
    animated: true,
    style: { stroke: 'var(--accent-primary-strong)', strokeWidth: 1.5 },
  }), []);

  const getCanvasCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 240, y: 160 };
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  const addAtCenter = useCallback((type) => {
    const center = getCanvasCenter();
    const layoutOffsets = [
      { x: -320, y: -140 },
      { x: 40, y: -210 },
      { x: 40, y: 100 },
      { x: -320, y: 190 },
    ];
    const index = nodes.length;
    const offset = layoutOffsets[index % layoutOffsets.length];
    const cascade = Math.floor(index / layoutOffsets.length) * 36;
    addNode(type, {
      x: center.x + offset.x + cascade,
      y: center.y + offset.y + cascade,
    });
    setMenu(null);
  }, [addNode, getCanvasCenter, nodes.length]);

  const createStoryAtOpenSpace = useCallback(() => {
    const center = getCanvasCenter();
    const position = nodes.length === 0
      ? { x: center.x - 620, y: center.y - 300 }
      : {
        x: Math.max(...nodes.map((node) => node.position.x + (node.width || 320))) + 180,
        y: Math.min(...nodes.map((node) => node.position.y)),
      };
    createStoryStarter(position);
    requestAnimationFrame(() => setCenter(
      position.x + 705,
      position.y + 415,
      { zoom: 0.59, duration: 420 },
    ));
  }, [createStoryStarter, getCanvasCenter, nodes, setCenter]);

  const addFileAsImage = useCallback((file, position) => {
    if (!file?.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      addAssetNode({
        kind: 'image',
        url: reader.result,
        title: file.name || '上传图片',
        position,
      });
    };
    reader.readAsDataURL(file);
  }, [addAssetNode]);

  const handleFileInput = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      const center = uploadPositionRef.current || getCanvasCenter();
      addFileAsImage(file, { x: center.x - 140, y: center.y - 100 });
    }
    event.target.value = '';
    uploadPositionRef.current = null;
  };

  const handlePaneDoubleClick = (event) => {
    if (!event.target?.classList?.contains('react-flow__pane')) return;
    event.preventDefault();
    event.stopPropagation();
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const rect = wrapperRef.current?.getBoundingClientRect();
    setMenu({
      position,
      left: event.clientX - (rect?.left || 0),
      top: event.clientY - (rect?.top || 0),
    });
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addFileAsImage(file, position);
  };

  const isValidConnection = useCallback((connection) => {
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    if (targetNode.type === 'storyboard') {
      const acceptedTypes = {
        script: ['story', 'text'],
        character: ['character'],
        scene: ['scene'],
        continuity: ['continuity'],
      };
      return acceptedTypes[connection.targetHandle]?.includes(sourceNode.data?.outputType) || false;
    }

    if (!targetNode.type?.endsWith('Generator')) return false;

    if (connection.targetHandle === 'prompt') return sourceNode.data?.outputType === 'text';
    if (connection.targetHandle === 'reference') {
      return ['image', 'video'].includes(sourceNode.data?.outputType);
    }
    return false;
  }, [nodes]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isTextInput(document.activeElement)) return;
      const modifier = event.metaKey || event.ctrlKey;

      if ((event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelected();
      } else if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, duplicateSelected, redo, undo]);

  useEffect(() => {
    const resultItems = [
      ...(workspaceChatMessages || []).flatMap((message) => [
        message.imageUrl ? { kind: 'image', url: message.imageUrl, title: 'AI 生成图片' } : null,
        message.videoUrl ? { kind: 'video', url: message.videoUrl, title: 'Seedance 生成视频' } : null,
      ]),
      generatedImage?.url ? { kind: 'image', url: generatedImage.url, title: 'AI 生成图片' } : null,
    ].filter(Boolean);

    const unseenResults = resultItems.filter((item) => !importedResultUrlsRef.current.has(item.url));
    if (unseenResults.length === 0) return;

    const center = getCanvasCenter();
    unseenResults.forEach((item, index) => {
      importedResultUrlsRef.current.add(item.url);
      addAssetNode({
        ...item,
        position: { x: center.x - 140 + index * 36, y: center.y - 100 + index * 36 },
      });
    });
  }, [addAssetNode, generatedImage, getCanvasCenter, workspaceChatMessages]);

  return (
    <main
      ref={wrapperRef}
      className="nv-infinite-canvas"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={(event) => {
        const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'));
        if (file) addFileAsImage(file, getCanvasCenter());
      }}
      onDoubleClickCapture={handlePaneDoubleClick}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={CANVAS_NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        onPaneClick={() => setMenu(null)}
        onNodeDragStart={checkpoint}
        onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
        isValidConnection={isValidConnection}
        defaultViewport={viewport}
        defaultEdgeOptions={defaultEdgeOptions}
        minZoom={0.15}
        maxZoom={2.5}
        snapToGrid
        snapGrid={[16, 16]}
        panOnDrag={[0, 1, 2]}
        selectionKeyCode={['Meta', 'Control']}
        multiSelectionKeyCode={['Meta', 'Control']}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(248, 246, 240, 0.14)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => (node.type?.includes('video') ? '#c89445' : '#5f837a')}
          maskColor="rgba(10, 10, 9, 0.66)"
          position="bottom-right"
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      <CanvasToolbar
        onAddNode={addAtCenter}
        onCreateStory={createStoryAtOpenSpace}
        onUpload={() => fileInputRef.current?.click()}
        onFitView={() => fitView({ padding: 0.22, duration: 260 })}
        onOpenArtboard={() => setViewMode('artboard')}
      />

      <div className="nv-canvas-statusbar">
        <span>{nodes.length} 个节点</span>
        <span>{edges.length} 条连接</span>
        <span>双击空白处添加节点</span>
      </div>

      {nodes.length === 0 ? (
        <section className="nv-canvas-empty" aria-label="空画布引导">
          <p className="nv-canvas-empty__eyebrow">NeoVista Canvas</p>
          <h1>从故事开始，完成一支视频</h1>
          <p>填写剧本，绑定角色与场景参考，编排分镜，再逐镜编译到 Seedance。</p>
          <div>
            <button type="button" onClick={createStoryAtOpenSpace}><Clapperboard size={16} />剧情视频模板</button>
            <button type="button" onClick={() => addAtCenter('prompt')}><MessageSquareText size={16} />提示词</button>
            <button type="button" onClick={() => addAtCenter('imageGenerator')}><ImagePlus size={16} />AI 生图</button>
            <button type="button" onClick={() => addAtCenter('videoGenerator')}><Video size={16} />Seedance 视频</button>
          </div>
        </section>
      ) : null}

      {menu ? (
        <div className="nv-canvas-menu" style={{ left: menu.left, top: menu.top }} role="menu">
          <button type="button" onClick={() => { addNode('story', menu.position); setMenu(null); }}><BookOpenText size={15} />剧情脚本</button>
          <button type="button" onClick={() => { addNode('character', menu.position); setMenu(null); }}><UserRound size={15} />角色资产</button>
          <button type="button" onClick={() => { addNode('scene', menu.position); setMenu(null); }}><MapPin size={15} />场景资产</button>
          <button type="button" onClick={() => { addNode('continuity', menu.position); setMenu(null); }}><Link2 size={15} />连续性控制</button>
          <button type="button" onClick={() => { addNode('storyboard', menu.position); setMenu(null); }}><Clapperboard size={15} />剧情分镜表</button>
          <span className="nv-canvas-menu__divider" />
          <button type="button" onClick={() => { addNode('prompt', menu.position); setMenu(null); }}><MessageSquareText size={15} />提示词</button>
          <button type="button" onClick={() => { addNode('imageGenerator', menu.position); setMenu(null); }}><ImagePlus size={15} />AI 生图</button>
          <button type="button" onClick={() => { addNode('videoGenerator', menu.position); setMenu(null); }}><Video size={15} />Seedance 视频</button>
          <button type="button" onClick={() => { uploadPositionRef.current = menu.position; fileInputRef.current?.click(); setMenu(null); }}><ImagePlus size={15} />上传图片</button>
        </div>
      ) : null}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
    </main>
  );
}

export default function InfiniteCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasSurface />
    </ReactFlowProvider>
  );
}
