import { Home, Folder, Settings, User, MousePointer, Paintbrush, Undo2, Redo2, Trash2, ArrowUp, ArrowDown, Type, Upload, Download, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

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

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file);
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

        <button onClick={() => setDrawingMode(false)} className={btn(!drawingMode)} style={buttonStyle(!drawingMode)} title="选择" aria-label="选择"><MousePointer size={18} /></button>
        <button onClick={() => setDrawingMode(true)} className={btn(drawingMode)} style={buttonStyle(drawingMode)} title="画笔" aria-label="画笔"><Paintbrush size={18} /></button>
        <button onClick={addText} className={btn(false)} style={buttonStyle(false)} title="文字" aria-label="添加文字"><Type size={18} /></button>

        {divider}

        <label className={btn(false) + ' cursor-pointer'} style={buttonStyle(false)} title="上传图片" aria-label="上传图片">
          <Upload size={18} />
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
        <button onClick={() => saveProject()} className={btn(false)} style={buttonStyle(false)} title="保存" aria-label="保存项目"><Save size={18} /></button>
        <button onClick={downloadCanvas} className={btn(false)} style={buttonStyle(false)} title="下载 PNG" aria-label="下载 PNG"><Download size={18} /></button>

        {divider}

        <button onClick={bringForward} className={btn(false)} style={buttonStyle(false)} title="上移一层" aria-label="上移一层"><ArrowUp size={18} /></button>
        <button onClick={sendBackward} className={btn(false)} style={buttonStyle(false)} title="下移一层" aria-label="下移一层"><ArrowDown size={18} /></button>

        {divider}

        <button onClick={undo} disabled={historyIndex <= 0} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="撤销" aria-label="撤销"><Undo2 size={18} /></button>
        <button onClick={redo} disabled={historyIndex >= canvasHistory.length - 1} className={btn(false) + ' disabled:opacity-20'} style={buttonStyle(false)} title="重做" aria-label="重做"><Redo2 size={18} /></button>
        <button onClick={clearCanvas} className="rounded-xl p-2.5 text-red-400/60 transition hover:bg-red-500/10 hover:text-red-300 active:scale-[0.96]" title="清空" aria-label="清空画布"><Trash2 size={18} /></button>

        {divider}

        <button onClick={() => navigate('/settings')} className={btn(false)} style={buttonStyle(false)} title="设置" aria-label="设置"><Settings size={18} /></button>
      </div>

      <button onClick={() => navigate('/profile')} className={btn(false)} style={buttonStyle(false)} title="个人中心" aria-label="个人中心"><User size={18} /></button>
    </div>
  );
}
