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
    `p-3 rounded-lg transition ${active ? 'bg-brand-blue/15 text-brand-blue' : 'text-white/40 hover:bg-white/10 hover:text-white/70'}`;

  return (
    <div className="w-16 flex flex-col items-center py-6" style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border-subtle)' }}>
      <div className="flex-1 flex flex-col items-center gap-5">
        <button onClick={() => navigate('/')} className={btn(false)} title="首页"><Home size={18} /></button>
        <button onClick={() => navigate('/workspace')} className={btn(false)} title="项目"><Folder size={18} /></button>

        <div className="w-6 h-px my-1" style={{ background: 'var(--border-subtle)' }} />

        <button onClick={() => setDrawingMode(false)} className={btn(!drawingMode)} title="选择"><MousePointer size={18} /></button>
        <button onClick={() => setDrawingMode(true)} className={btn(drawingMode)} title="画笔"><Paintbrush size={18} /></button>
        <button onClick={addText} className={btn(false)} title="文字"><Type size={18} /></button>

        <div className="w-6 h-px my-1" style={{ background: 'var(--border-subtle)' }} />

        <label className={btn(false) + ' cursor-pointer'} title="上传图片">
          <Upload size={18} />
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
        <button onClick={() => saveProject()} className={btn(false)} title="保存"><Save size={18} /></button>
        <button onClick={downloadCanvas} className={btn(false)} title="下载 PNG"><Download size={18} /></button>

        <div className="w-6 h-px my-1" style={{ background: 'var(--border-subtle)' }} />

        <button onClick={bringForward} className={btn(false)} title="上移一层"><ArrowUp size={18} /></button>
        <button onClick={sendBackward} className={btn(false)} title="下移一层"><ArrowDown size={18} /></button>

        <div className="w-6 h-px my-1" style={{ background: 'var(--border-subtle)' }} />

        <button onClick={undo} disabled={historyIndex <= 0} className={btn(false) + ' disabled:opacity-20'} title="撤销"><Undo2 size={18} /></button>
        <button onClick={redo} disabled={historyIndex >= canvasHistory.length - 1} className={btn(false) + ' disabled:opacity-20'} title="重做"><Redo2 size={18} /></button>
        <button onClick={clearCanvas} className="p-3 rounded-lg transition text-red-400/60 hover:bg-red-500/10 hover:text-red-400" title="清空"><Trash2 size={18} /></button>

        <div className="w-6 h-px my-1" style={{ background: 'var(--border-subtle)' }} />

        <button onClick={() => navigate('/settings')} className={btn(false)} title="设置"><Settings size={18} /></button>
      </div>

      <button onClick={() => navigate('/profile')} className={btn(false)} title="个人中心"><User size={18} /></button>
    </div>
  );
}
