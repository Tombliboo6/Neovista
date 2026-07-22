import { BookOpenText, Clapperboard, FileImage, Focus, ImagePlus, LayoutTemplate, MessageSquareText, PenTool, Plus, Video } from 'lucide-react';

export default function CanvasToolbar({ onAddNode, onCreateStory, onUpload, onFitView, onOpenArtboard }) {
  return (
    <div className="nv-canvas-toolbar" role="toolbar" aria-label="画布工具">
      <button type="button" className="nv-canvas-toolbar__starter" onClick={onCreateStory} title="创建剧情视频工作流">
        <LayoutTemplate size={16} />
        <span>剧情模板</span>
      </button>
      <span className="nv-canvas-toolbar__divider" />
      <button type="button" onClick={() => onAddNode('story')} title="添加剧情脚本节点">
        <BookOpenText size={16} />
        <span>剧本</span>
      </button>
      <button type="button" onClick={() => onAddNode('storyboard')} title="添加剧情分镜表">
        <Clapperboard size={16} />
        <span>分镜</span>
      </button>
      <button type="button" onClick={() => onAddNode('prompt')} title="添加提示词节点">
        <MessageSquareText size={16} />
        <span>提示词</span>
      </button>
      <button type="button" onClick={() => onAddNode('imageGenerator')} title="添加生图节点">
        <ImagePlus size={16} />
        <span>生图</span>
      </button>
      <button type="button" onClick={() => onAddNode('videoGenerator')} title="添加 Seedance 视频节点">
        <Video size={16} />
        <span>视频</span>
      </button>
      <span className="nv-canvas-toolbar__divider" />
      <button type="button" onClick={onUpload} title="上传图片">
        <FileImage size={16} />
      </button>
      <button type="button" onClick={onFitView} title="查看全部节点">
        <Focus size={16} />
      </button>
      <span className="nv-canvas-toolbar__divider" />
      <button type="button" onClick={onOpenArtboard} title="进入 Fabric 精修画板">
        <PenTool size={16} />
        <span>精修</span>
      </button>
      <button type="button" onClick={() => onAddNode('prompt')} className="nv-canvas-toolbar__compact" title="新增节点">
        <Plus size={16} />
      </button>
    </div>
  );
}
