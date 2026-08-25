import { Home, Folder, Settings, User, MousePointer, Paintbrush, Undo2, Redo2, Trash2, ArrowUp, ArrowDown, Type, Upload, Download, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import { useCanvasGraphStore } from '../../store/useCanvasGraphStore';

export default function LeftNav() {
  const navigate = useNavigate();
  const drawingMode = useAppStore((state) => state.drawingMode);
  const setDrawingMode = useAppStore((state) => state.setDrawingMode);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const clearCanvas = useAppStore((state) => state.clearCanvas);
  const historyIndex = useAppStore((state) => state.historyIndex);
  const canvasHistory = useAppStore((state) => state.canvasHistory);
  const bringForward = useAppStore((state) => state.bringForward);
  const sendBackward = useAppStore((state) => state.sendBackward);
  const addText = useAppStore((state) => state.addText);
  const uploadImage = useAppStore((state) => state.uploadImage);
  const downloadCanvas = useAppStore((state) => state.downloadCanvas);
  const saveProject = useAppStore((state) => state.saveProject);
  const viewMode = useCanvasGraphStore((state) => state.viewMode);
  const setViewMode = useCanvasGraphStore((state) => state.setViewMode);
  const graphNodes = useCanvasGraphStore((state) => state.nodes);
  const graphEdges = useCanvasGraphStore((state) => state.edges);
  const graphPast = useCanvasGraphStore((state) => state.past);
  const graphFuture = useCanvasGraphStore((state) => state.future);
  const graphAddNode = useCanvasGraphStore((state) => state.addNode);
  const graphAddAssetNode = useCanvasGraphStore((state) => state.addAssetNode);
  const graphUndo = useCanvasGraphStore((state) => state.undo);
  const graphRedo = useCanvasGraphStore((state) => state.redo);
  const graphClear = useCanvasGraphStore((state) => state.clearGraph);
  const isWorkflow = viewMode === 'workflow';

  const getNextNodePosition = () => ({
    x: 96 + (graphNodes.length % 2) * 360,
    y: 96 + Math.floor(graphNodes.length / 2) * 280,
  });

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isWorkflow) {
      uploadImage(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      graphAddAssetNode({
        kind: 'image',
        url: reader.result,
        title: file.name || '上传图片',
        position: getNextNodePosition(),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleAddText = () => {
    if (isWorkflow) {
      graphAddNode('prompt', getNextNodePosition());
      return;
    }
    addText();
  };

  const handleSave = () => {
    if (!isWorkflow) {
      saveProject();
      return;
    }
    toast.success('工作流已自动保存在本机');
  };

  const handleDownload = () => {
    if (!isWorkflow) {
      downloadCanvas();
      return;
    }

    const blob = new Blob([
      JSON.stringify({ schemaVersion: 1, nodes: graphNodes, edges: graphEdges }, null, 2),
    ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `neovista-workflow-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const btn = (active) =>
    `rounded-xl p-2.5 transition active:scale-[0.96] ${
      active ? 'text-white shadow-sm' : 'text-white/40 hover:bg-white/10 hover:text-white/70'
    }`;

  const buttonStyle = (active) => active
    ? { background: 'var(--accent-primary)', border: '1px solid rgba(255,255,255,0.08)' }
    : { border: '1px solid transparent' };

  const divider = <div className="my-1 h-px w-7" style={{ background: 'var(--border-subtle)' }} />;

  return (
    <div className="flex w-[68px] flex-col items-center py-5" style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border-subtle)' }}>
      <div className="flex flex-1 flex-col items-center gap-3">
        <button onClick={() => navigate('/')} className={btn(false)} style={buttonStyle(false)} title="首页" aria-label="首页"><Home size={18} /></button>
        <button onClick={() => navigate('/workspace')} className={btn(false)} style={buttonStyle(false)} title="项目" aria-label="项目"><Folder size={18} /></button>

        {divider}

        <button onClick={() => { setViewMode('workflow'); setDrawingMode(false); }} className={btn(isWorkflow)} style={buttonStyle(isWorkflow)} title="工作流画布" aria-label="工作流画布"><MousePointer size={18} /></button>
        <button onClick={() => { setViewMode('artboard'); setDrawingMode(true); }} className={btn(!isWorkflow && drawingMode)} style={buttonStyle(!isWorkflow && drawingMode)} title="精修画笔" aria-label="精修画笔"><Paintbrush size={18} /></button>
        <button onClick={handleAddText} className={btn(false)} style={buttonStyle(false)} title={isWorkflow ? '添加提示词节点' : '添加文字'} aria-label={isWorkflow ? '添加提示词节点' : '添加文字'}><Type size={18} /></button>

        {divider}

        <label className={btn(false) + ' cursor-pointer'} style={buttonStyle(false)} title="上传图片" aria-label="上传图片">
          <Upload size={18} />
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
        <button onClick={handleSave} className={btn(false)} style={buttonStyle(false)} title="保存" aria-label="保存项目"><Save size={18} /></button>
        <button onClick={handleDownload} className={btn(false)} style={buttonStyle(false)} title={isWorkflow ? '导出工作流 JSON' : '下载 PNG'} aria-label={isWorkflow ? '导出工作流 JSON' : '下载 PNG'}><Download size={18} /></button>

        {divider}

        <button onClick={bringForward} disabled={isWorkflow} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="上移一层（精修模式）" aria-label="上移一层"><ArrowUp size={18} /></button>
        <button onClick={sendBackward} disabled={isWorkflow} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="下移一层（精修模式）" aria-label="下移一层"><ArrowDown size={18} /></button>

        {divider}

        <button onClick={isWorkflow ? graphUndo : undo} disabled={isWorkflow ? graphPast.length === 0 : historyIndex <= 0} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="撤销" aria-label="撤销"><Undo2 size={18} /></button>
        <button onClick={isWorkflow ? graphRedo : redo} disabled={isWorkflow ? graphFuture.length === 0 : historyIndex >= canvasHistory.length - 1} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="重做" aria-label="重做"><Redo2 size={18} /></button>
        <button onClick={isWorkflow ? graphClear : clearCanvas} className="rounded-xl p-2.5 text-red-400/60 transition hover:bg-red-500/10 hover:text-red-300 active:scale-[0.96]" title="清空" aria-label="清空画布"><Trash2 size={18} /></button>

        {divider}

        <button onClick={() => navigate('/settings')} className={btn(false)} style={buttonStyle(false)} title="设置" aria-label="设置"><Settings size={18} /></button>
      </div>

      <button onClick={() => navigate('/profile')} className={btn(false)} style={buttonStyle(false)} title="个人中心" aria-label="个人中心"><User size={18} /></button>
    </div>
  );
}
