import { Handle, Position } from '@xyflow/react';
import {
  Check,
  Clapperboard,
  FileCheck2,
  FileText,
  FileUp,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  MapPin,
  MessageSquareText,
  Play,
  Plus,
  Sparkles,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { createElement, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  deleteCanvasAsset,
  resolveCanvasAssetDataUrls,
  saveCanvasAsset,
} from '../../../lib/canvasAssetStore';
import { compileShotGenerationDraft } from '../../../lib/continuityManifest';
import {
  createImmutableGenerationRequest,
  createReferenceVideoSignature,
  getVideoModelCapabilities,
  isUsableVideoCapabilities,
} from '../../../lib/canvasGenerationDraft';
import { readStoryScriptFile, STORY_FILE_ACCEPT } from '../../../lib/storyScriptImport';
import { getImageCapabilityModel } from '../../../lib/imageGenerationCapabilities';
import { isSeedanceModel } from '../../../lib/videoGeneration';
import { useAppStore } from '../../../store/useAppStore';
import { useCanvasGraphStore } from '../../../store/useCanvasGraphStore';

const STATUS_LABELS = {
  draft: '草稿',
  idle: '待配置',
  ready: '已就绪',
  compiled: '已编译',
  running: '生成中',
  success: '已完成',
  error: '需修正',
};

function NodeShell({ icon, title, meta, status, children, className = '' }) {
  return (
    <article className={`nv-canvas-node ${className}`}>
      <header className="nv-canvas-node__header">
        <span className="nv-canvas-node__icon">{createElement(icon, { size: 15 })}</span>
        <span className="nv-canvas-node__title">{title}</span>
        {status ? <span className={`nv-canvas-node__status is-${status}`}>{STATUS_LABELS[status] || status}</span> : null}
        {meta ? <span className="nv-canvas-node__meta">{meta}</span> : null}
      </header>
      {children}
    </article>
  );
}

function OutputHandle({ type = 'default' }) {
  return (
    <Handle
      id="output"
      type="source"
      position={Position.Right}
      className={`nv-canvas-handle is-${type}`}
    />
  );
}

function Field({ label, children }) {
  return (
    <label className="nv-asset-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ConstraintToggle({ included, onClick }) {
  return (
    <button
      type="button"
      className={`nodrag nv-constraint-toggle ${included ? 'is-included' : ''}`}
      onClick={onClick}
      aria-pressed={included}
      title={included ? '该资产会进入已连接镜头的请求' : '该资产不会进入镜头请求'}
    >
      {included ? <Check size={12} /> : <X size={12} />}
      {included ? '参与镜头约束' : '暂不参与'}
    </button>
  );
}

function ReferenceAssetPicker({ assets = [], onChange, label }) {
  const inputRef = useRef(null);
  const [previews, setPreviews] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!assets.length) {
      setPreviews([]);
      return () => { alive = false; };
    }

    resolveCanvasAssetDataUrls(assets)
      .then(({ resolvedAssets }) => {
        if (alive) setPreviews(resolvedAssets || []);
      })
      .catch(() => {
        if (alive) setPreviews([]);
      });
    return () => { alive = false; };
  }, [assets]);

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    setIsSaving(true);
    try {
      const saved = [];
      for (const file of files) saved.push(await saveCanvasAsset(file));
      onChange([...assets, ...saved]);
      toast.success(`已保存 ${saved.length} 张${label}参考图`);
    } catch (error) {
      toast.error(error?.message || '参考图保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const removeAsset = async (assetId) => {
    try {
      await deleteCanvasAsset(assetId);
      onChange(assets.filter((asset) => asset.id !== assetId));
    } catch (error) {
      toast.error(error?.message || '参考图移除失败');
    }
  };

  return (
    <div className="nv-reference-picker">
      <div className="nv-reference-picker__head">
        <span>{label}参考图</span>
        <small>{assets.length} 张 · 请求最多取 4 张</small>
      </div>
      {previews.length > 0 ? (
        <div className="nv-reference-picker__grid">
          {previews.map((preview, index) => (
            <figure key={preview.assetId}>
              <img src={preview.dataUrl} alt={`${label}参考图 ${index + 1}`} draggable={false} />
              <button
                type="button"
                className="nodrag"
                onClick={() => removeAsset(preview.assetId)}
                aria-label={`移除${label}参考图 ${index + 1}`}
              >
                <X size={11} />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p className="nv-reference-picker__empty">尚未保存参考图</p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={handleFiles}
      />
      <button
        type="button"
        className="nodrag nv-reference-picker__upload"
        onClick={() => inputRef.current?.click()}
        disabled={isSaving}
      >
        <ImagePlus size={13} />
        {isSaving ? '正在保存…' : `添加${label}参考图`}
      </button>
    </div>
  );
}

export function StoryNode({ id, data }) {
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const inputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);

  const importScript = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsImporting(true);
    try {
      const script = await readStoryScriptFile(file);
      updateNodeData(id, {
        text: script.text,
        scriptFileName: script.name,
        scriptFileBytes: script.byteSize,
        status: 'draft',
      });
      toast.success(`已导入 ${script.name} · ${script.characterCount} 字`);
    } catch (error) {
      toast.error(error?.message || '剧本导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <NodeShell icon={FileText} title={data.title || '剧情脚本'} status={data.status || 'draft'} className="is-story">
      <div className="nv-story-meta">
        <span>{data.genre || '剧情短片'}</span>
        <span>目标 {data.targetDuration || 45}s</span>
      </div>
      <div className="nv-story-import">
        <input
          ref={inputRef}
          type="file"
          accept={STORY_FILE_ACCEPT}
          hidden
          onChange={importScript}
        />
        <button
          type="button"
          className="nodrag nv-canvas-node__action"
          disabled={isImporting}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp size={13} />
          {isImporting ? '正在读取…' : '导入 Markdown / TXT'}
        </button>
        <span title={data.scriptFileName || undefined}>
          {data.scriptFileName || 'UTF-8 · 最大 512KB'}
        </span>
      </div>
      <textarea
        className="nodrag nowheel nv-canvas-node__textarea nv-canvas-node__textarea--story"
        value={data.text || ''}
        onChange={(event) => updateNodeData(id, { text: event.target.value, status: 'draft' })}
        placeholder="粘贴故事梗概、对白或完整剧本…"
        aria-label="剧情脚本内容"
      />
      <p className="nv-node-functional-note">
        当前 {(data.text || '').length} 字。连接到分镜表后会完整进入编译；总提示词超过 4000 字会明确阻止发送，不会静默截断。
      </p>
      <OutputHandle type="story" />
    </NodeShell>
  );
}

export function PromptNode({ id, data }) {
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const setChatInput = useAppStore((state) => state.setChatInput);

  const loadPrompt = () => {
    if (!data.text?.trim()) {
      toast('先写一段提示词');
      return;
    }
    setChatInput(data.text.trim());
    toast.success('提示词已加载到右侧生成器');
  };

  return (
    <NodeShell icon={MessageSquareText} title={data.title || '提示词'} meta="文本">
      <textarea
        className="nodrag nowheel nv-canvas-node__textarea"
        value={data.text || ''}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        placeholder="描述空间、镜头、材质、光线与构图…"
        aria-label="节点提示词"
      />
      <button type="button" className="nodrag nv-canvas-node__action" onClick={loadPrompt}>
        加载到生成器
      </button>
      <OutputHandle type="text" />
    </NodeShell>
  );
}

export function CharacterNode({ id, data }) {
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const assets = data.referenceAssets || [];
  return (
    <NodeShell icon={UserRound} title={data.title || '角色资产'} meta="角色" className="is-asset">
      <div className="nv-asset-card">
        <Field label="角色名称">
          <input
            className="nodrag nv-asset-card__name"
            value={data.name || ''}
            onChange={(event) => updateNodeData(id, { name: event.target.value })}
            aria-label="角色名称"
          />
        </Field>
        <Field label="剧情身份">
          <input
            className="nodrag nv-asset-card__input"
            value={data.role || ''}
            onChange={(event) => updateNodeData(id, { role: event.target.value })}
            aria-label="剧情身份"
          />
        </Field>
        <Field label="人物描述">
          <textarea
            className="nodrag nowheel"
            value={data.description || ''}
            onChange={(event) => updateNodeData(id, { description: event.target.value })}
            aria-label="角色描述"
          />
        </Field>
        <Field label="外观锚点">
          <textarea
            className="nodrag nowheel"
            value={data.appearanceNotes || data.visualNotes || ''}
            onChange={(event) => updateNodeData(id, { appearanceNotes: event.target.value })}
            placeholder="脸型、发型、年龄、体态、气质"
            aria-label="角色外观锚点"
          />
        </Field>
        <Field label="服装与道具锚点">
          <textarea
            className="nodrag nowheel"
            value={data.wardrobeNotes || ''}
            onChange={(event) => updateNodeData(id, { wardrobeNotes: event.target.value })}
            placeholder="服装颜色、材质、随身道具"
            aria-label="服装与道具锚点"
          />
        </Field>
        <Field label="禁止变化">
          <textarea
            className="nodrag nowheel"
            value={data.negativePrompt || ''}
            onChange={(event) => updateNodeData(id, { negativePrompt: event.target.value })}
            placeholder="例如：不要改变发型、年龄和服装颜色"
            aria-label="角色禁止变化"
          />
        </Field>
        <ReferenceAssetPicker
          assets={assets}
          label="角色"
          onChange={(referenceAssets) => updateNodeData(id, { referenceAssets })}
        />
        <ConstraintToggle
          included={data.includeInGeneration !== false}
          onClick={() => updateNodeData(id, { includeInGeneration: data.includeInGeneration === false })}
        />
      </div>
      <OutputHandle type="character" />
    </NodeShell>
  );
}

export function SceneNode({ id, data }) {
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const assets = data.referenceAssets || [];
  return (
    <NodeShell icon={MapPin} title={data.title || '场景资产'} meta="场景" className="is-asset">
      <div className="nv-asset-card">
        <Field label="场景名称">
          <input
            className="nodrag nv-asset-card__name"
            value={data.name || ''}
            onChange={(event) => updateNodeData(id, { name: event.target.value })}
            aria-label="场景名称"
          />
        </Field>
        <Field label="时间 / 天气">
          <input
            className="nodrag nv-asset-card__input"
            value={data.time || ''}
            onChange={(event) => updateNodeData(id, { time: event.target.value })}
            aria-label="场景时间与天气"
          />
        </Field>
        <Field label="空间内容">
          <textarea
            className="nodrag nowheel"
            value={data.description || ''}
            onChange={(event) => updateNodeData(id, { description: event.target.value })}
            aria-label="场景描述"
          />
        </Field>
        <Field label="光线、材质与色彩锚点">
          <textarea
            className="nodrag nowheel"
            value={data.visualNotes || ''}
            onChange={(event) => updateNodeData(id, { visualNotes: event.target.value })}
            placeholder="季节、主光方向、材质、空间结构与色调"
            aria-label="场景视觉锚点"
          />
        </Field>
        <Field label="禁止变化">
          <textarea
            className="nodrag nowheel"
            value={data.negativePrompt || ''}
            onChange={(event) => updateNodeData(id, { negativePrompt: event.target.value })}
            placeholder="例如：不要改变建筑年代、主色与空间布局"
            aria-label="场景禁止变化"
          />
        </Field>
        <ReferenceAssetPicker
          assets={assets}
          label="场景"
          onChange={(referenceAssets) => updateNodeData(id, { referenceAssets })}
        />
        <ConstraintToggle
          included={data.includeInGeneration !== false}
          onClick={() => updateNodeData(id, { includeInGeneration: data.includeInGeneration === false })}
        />
      </div>
      <OutputHandle type="scene" />
    </NodeShell>
  );
}

export function ContinuityNode({ id, data }) {
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const selectedRules = data.selectedRules || data.lockedRules || [];

  const toggleRule = (rule) => {
    updateNodeData(id, {
      selectedRules: selectedRules.includes(rule)
        ? selectedRules.filter((item) => item !== rule)
        : [...selectedRules, rule],
    });
  };

  return (
    <NodeShell icon={Link2} title={data.title || '连续性控制'} meta={`${selectedRules.length}/${data.rules?.length || 0}`} className="is-continuity">
      <div className="nv-continuity-list">
        {(data.rules || []).map((rule) => {
          const selected = selectedRules.includes(rule);
          return (
            <button type="button" className={`nodrag ${selected ? 'is-selected' : ''}`} key={rule} onClick={() => toggleRule(rule)} aria-pressed={selected}>
              {selected ? <Check size={12} /> : <Plus size={12} />}
              <span>{rule}</span>
            </button>
          );
        })}
      </div>
      <p className="nv-continuity-note">规则会在编译时逐项校验。只有已连接、参与生成且字段完整的资产会进入请求。</p>
      <OutputHandle type="continuity" />
    </NodeShell>
  );
}

export function StoryboardNode({ id, data }) {
  const nodes = useCanvasGraphStore((state) => state.nodes);
  const edges = useCanvasGraphStore((state) => state.edges);
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const setGenerationDraft = useCanvasGraphStore((state) => state.setGenerationDraft);
  const setChatInput = useAppStore((state) => state.setChatInput);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const setVideoDurationSeconds = useAppStore((state) => state.setVideoDurationSeconds);
  const videoResolution = useAppStore((state) => state.videoResolution);
  const setVideoResolution = useAppStore((state) => state.setVideoResolution);
  const setVideoFrameMode = useAppStore((state) => state.setVideoFrameMode);
  const setAspectRatio = useAppStore((state) => state.setAspectRatio);
  const setUploadedImages = useAppStore((state) => state.setUploadedImages);
  const loadVideoCapabilities = useAppStore((state) => state.loadVideoCapabilities);
  const videoCapabilities = useAppStore((state) => state.videoCapabilities);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const seedanceReferenceVideo = useAppStore((state) => state.seedanceReferenceVideo);
  const shots = data.shots || [];
  const activeShot = shots.find((shot) => shot.id === data.activeShotId) || shots[0] || null;
  const storyboardVideoModel = isSeedanceModel(selectedModel) ? selectedModel : 'seedance-2.0';
  const storyboardVideoCapabilities = getVideoModelCapabilities(
    videoCapabilities,
    storyboardVideoModel,
  );
  const minVideoDuration = Number(storyboardVideoCapabilities?.min_duration_seconds) || 4;
  const maxVideoDuration = Number(storyboardVideoCapabilities?.max_duration_seconds) || 15;

  const selectShot = (shotId) => updateNodeData(id, { activeShotId: shotId });

  const updateShot = (shotId, patch) => {
    updateNodeData(id, {
      activeShotId: shotId,
      shots: shots.map((shot) => (
        shot.id === shotId ? { ...shot, ...patch, status: 'draft' } : shot
      )),
    });
  };

  const prepareShot = async (shot) => {
    const draft = compileShotGenerationDraft({ storyboardId: id, shot, nodes, edges });
    setAgentMode(false);

    if (!draft.ok) {
      setUploadedImages([]);
      updateNodeData(id, {
        activeShotId: shot.id,
        shots: shots.map((item) => item.id === shot.id ? { ...item, status: 'error' } : item),
      });
      setGenerationDraft({ ...draft, compiledAt: new Date().toISOString(), referenceCount: 0 });
      toast.error(draft.errors[0]);
      return;
    }

    try {
      const capabilities = await loadVideoCapabilities();
      if (!isUsableVideoCapabilities(capabilities, storyboardVideoModel)) {
        const failedDraft = {
          ...draft,
          ok: false,
          errors: [
            ...draft.errors,
            capabilities?.disabled_reason || 'Seedance 能力与计费参数未通过校验，请稍后重试',
          ],
          compiledAt: new Date().toISOString(),
          referenceCount: 0,
        };
        setUploadedImages([]);
        updateNodeData(id, {
          activeShotId: shot.id,
          shots: shots.map((item) => item.id === shot.id ? { ...item, status: 'error' } : item),
        });
        setGenerationDraft(failedDraft);
        toast.error(failedDraft.errors.at(-1));
        return;
      }

      const resolved = await resolveCanvasAssetDataUrls(draft.referenceAssets);
      if (resolved.missingAssetIds.length > 0) {
        const failedDraft = {
          ...draft,
          ok: false,
          errors: [...draft.errors, '部分参考图已从本地素材库丢失，请重新添加'],
          compiledAt: new Date().toISOString(),
          referenceCount: resolved.dataUrls.length,
        };
        setUploadedImages([]);
        updateNodeData(id, {
          activeShotId: shot.id,
          shots: shots.map((item) => item.id === shot.id ? { ...item, status: 'error' } : item),
        });
        setGenerationDraft(failedDraft);
        toast.error(failedDraft.errors.at(-1));
        return;
      }

      const hasReferenceVideo = Boolean(seedanceReferenceVideo?.video_url);
      const requestedFrameMode = hasReferenceVideo
        ? 'reference_video'
        : (resolved.dataUrls.length > 0 ? 'reference_image' : 'auto');
      const compiledRequest = createImmutableGenerationRequest({
        model: storyboardVideoModel,
        prompt: draft.prompt,
        duration: draft.duration,
        resolution: videoResolution,
        aspectRatio: draft.aspectRatio,
        frameMode: requestedFrameMode,
        referenceImages: resolved.dataUrls,
        hasReferenceVideo,
        referenceVideoSignature: createReferenceVideoSignature(seedanceReferenceVideo),
        capabilities,
      });

      setSelectedModel(compiledRequest.request.model);
      setVideoDurationSeconds(compiledRequest.request.duration);
      setVideoResolution(compiledRequest.request.resolution);
      setVideoFrameMode(requestedFrameMode);
      setAspectRatio(compiledRequest.request.aspectRatio);
      setChatInput(compiledRequest.request.prompt);
      setUploadedImages(resolved.dataUrls);
      updateNodeData(id, {
        activeShotId: shot.id,
        shots: shots.map((item) => item.id === shot.id ? { ...item, status: 'compiled' } : item),
      });
      setGenerationDraft({
        ...draft,
        compiledAt: new Date().toISOString(),
        referenceCount: resolved.dataUrls.length,
        stale: false,
        staleReasons: [],
        request: compiledRequest.request,
        requestFingerprint: compiledRequest.fingerprint,
      });
      toast.success(`已编译 ${draft.id} · ${resolved.dataUrls.length} 张参考图`);
    } catch (error) {
      toast.error(error?.message || '镜头请求编译失败');
    }
  };

  const addShot = () => {
    const nextIndex = shots.length + 1;
    const nextShot = {
      id: `shot-${Date.now()}`,
      index: nextIndex,
      title: `新镜头 ${nextIndex}`,
      description: '补充画面动作与叙事目的。',
      prompt: '',
      shotSize: '中景',
      camera: '固定机位',
      axis: '沿用上一镜头人物朝向与运动方向',
      duration: 5,
      status: 'draft',
    };
    updateNodeData(id, { shots: [...shots, nextShot], activeShotId: nextShot.id });
  };

  return (
    <NodeShell icon={Clapperboard} title={data.title || '剧情分镜表'} meta={`${shots.length} 镜头 · ${data.aspectRatio || '16:9'}`} className="is-storyboard">
      <Handle id="script" type="target" position={Position.Left} className="nv-canvas-handle is-story is-storyboard-script" />
      <Handle id="character" type="target" position={Position.Left} className="nv-canvas-handle is-character is-storyboard-character" />
      <Handle id="scene" type="target" position={Position.Left} className="nv-canvas-handle is-scene is-storyboard-scene" />
      <Handle id="continuity" type="target" position={Position.Left} className="nv-canvas-handle is-continuity is-storyboard-continuity" />
      <div className="nv-storyboard-head">
        <div><span>生成模型</span><strong>{data.model || 'Seedance 2.0'}</strong></div>
        <label>
          <span>画幅</span>
          <select className="nodrag" value={data.aspectRatio || '16:9'} onChange={(event) => updateNodeData(id, { aspectRatio: event.target.value })}>
            {['16:9', '9:16', '1:1', '4:3', '3:4'].map((ratio) => <option key={ratio}>{ratio}</option>)}
          </select>
        </label>
        <div><span>总时长</span><strong>{shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0)}s</strong></div>
        <button type="button" className="nodrag" onClick={addShot}><Plus size={13} />镜头</button>
      </div>
      <div className="nv-storyboard-body">
        <div className="nv-storyboard-shots nowheel">
          {shots.length === 0 ? <p className="nv-storyboard-empty">连接剧本，或点击“镜头”建立第一条分镜。</p> : null}
          {shots.map((shot) => {
            const active = shot.id === activeShot?.id;
            return (
              <section className={`nodrag nv-shot-card ${active ? 'is-active' : ''}`} key={shot.id} onClick={() => selectShot(shot.id)}>
                <div className="nv-shot-card__index">{String(shot.index).padStart(2, '0')}</div>
                <div className="nv-shot-card__body">
                  <div className="nv-shot-card__title"><strong>{shot.title}</strong><span>{STATUS_LABELS[shot.status] || '草稿'}</span></div>
                  <p>{shot.description}</p>
                  <div className="nv-shot-card__meta">
                    <span>{shot.shotSize}</span><span>{shot.camera}</span><span>{shot.duration}s</span>
                  </div>
                </div>
                <button type="button" title="编译到 Seedance" onClick={(event) => { event.stopPropagation(); void prepareShot(shot); }}><FileCheck2 size={13} /></button>
              </section>
            );
          })}
        </div>
        {activeShot ? (
          <section className="nv-shot-editor nodrag nowheel" aria-label={`编辑镜头 ${activeShot.index}`}>
            <div className="nv-shot-editor__head">
              <span>镜头 {String(activeShot.index).padStart(2, '0')}</span>
              <strong>{STATUS_LABELS[activeShot.status] || '草稿'}</strong>
            </div>
            <Field label="标题">
              <input value={activeShot.title || ''} onChange={(event) => updateShot(activeShot.id, { title: event.target.value })} />
            </Field>
            <Field label="叙事动作">
              <textarea value={activeShot.description || ''} onChange={(event) => updateShot(activeShot.id, { description: event.target.value })} />
            </Field>
            <Field label="生成画面">
              <textarea value={activeShot.prompt || ''} onChange={(event) => updateShot(activeShot.id, { prompt: event.target.value })} />
            </Field>
            <div className="nv-shot-editor__row">
              <Field label="景别">
                <select value={activeShot.shotSize || '中景'} onChange={(event) => updateShot(activeShot.id, { shotSize: event.target.value })}>
                  {['大全景', '远景', '全景', '中景', '近景', '特写'].map((value) => <option key={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="时长">
                <input type="number" min={minVideoDuration} max={maxVideoDuration} value={activeShot.duration || 5} onChange={(event) => updateShot(activeShot.id, { duration: Number(event.target.value) })} />
              </Field>
            </div>
            <Field label="运镜">
              <input value={activeShot.camera || ''} onChange={(event) => updateShot(activeShot.id, { camera: event.target.value })} />
            </Field>
            <Field label="轴线规则">
              <input value={activeShot.axis || ''} onChange={(event) => updateShot(activeShot.id, { axis: event.target.value })} />
            </Field>
            <button type="button" className="nv-shot-editor__compile" onClick={() => void prepareShot(activeShot)}>
              <FileCheck2 size={13} />编译到 Seedance
            </button>
          </section>
        ) : null}
      </div>
      <OutputHandle type="storyboard" />
    </NodeShell>
  );
}

export function ImageNode({ data }) {
  return (
    <NodeShell icon={ImageIcon} title={data.title || '图片素材'} meta="图像" className="is-media">
      <div className="nv-canvas-node__media">
        {data.url ? (
          <img src={data.url} alt={data.title || '画布图片素材'} draggable={false} />
        ) : (
          <div className="nv-canvas-node__empty">
            <ImageIcon size={22} />
            <span>拖入图片或连接生成结果</span>
          </div>
        )}
      </div>
      <OutputHandle type="image" />
    </NodeShell>
  );
}

export function VideoNode({ data }) {
  return (
    <NodeShell icon={Video} title={data.title || '视频素材'} meta="视频" className="is-media">
      <div className="nv-canvas-node__media">
        {data.url ? (
          <video className="nodrag nowheel" src={data.url} controls preload="metadata" aria-label={data.title || '画布视频素材'} />
        ) : (
          <div className="nv-canvas-node__empty">
            <Video size={22} />
            <span>连接 Seedance 结果</span>
          </div>
        )}
      </div>
      <OutputHandle type="video" />
    </NodeShell>
  );
}

export function GenerationNode({ id, data }) {
  const nodes = useCanvasGraphStore((state) => state.nodes);
  const edges = useCanvasGraphStore((state) => state.edges);
  const updateNodeData = useCanvasGraphStore((state) => state.updateNodeData);
  const setChatInput = useAppStore((state) => state.setChatInput);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const setAgentMode = useAppStore((state) => state.setAgentMode);
  const setUploadedImages = useAppStore((state) => state.setUploadedImages);
  const setVideoFrameMode = useAppStore((state) => state.setVideoFrameMode);
  const videoCapabilities = useAppStore((state) => state.videoCapabilities);
  const imageCapabilities = useAppStore((state) => state.imageCapabilities);
  const isVideo = data.generationKind === 'video';

  const prepareGeneration = () => {
    const incoming = edges.filter((edge) => edge.target === id);
    const promptSourceId = incoming.find((edge) => edge.targetHandle === 'prompt')?.source;
    const referenceSourceIds = incoming
      .filter((edge) => edge.targetHandle === 'reference')
      .map((edge) => edge.source);
    const promptNode = nodes.find((node) => node.id === promptSourceId);
    const referenceUrls = nodes
      .filter((node) => (
        referenceSourceIds.includes(node.id)
        && node.data?.outputType === 'image'
        && node.data?.url
      ))
      .map((node) => node.data.url);
    const prompt = promptNode?.data?.text?.trim() || data.prompt?.trim() || '';

    setAgentMode(false);
    setChatInput(prompt);
    setUploadedImages(referenceUrls);
    if (!prompt) {
      updateNodeData(id, { status: 'error' });
      toast.error('生成节点缺少提示词，已清除旧提示词与参考图');
      return;
    }
    if (isVideo && !isUsableVideoCapabilities(videoCapabilities)) {
      updateNodeData(id, { status: 'error' });
      toast.error('Seedance 能力与价格尚未通过校验');
      return;
    }
    const imageModel = isVideo
      ? null
      : getImageCapabilityModel(imageCapabilities, imageCapabilities?.defaultModel);
    if (!isVideo && !imageModel) {
      updateNodeData(id, { status: 'error' });
      toast.error('生图模型与价格尚未通过校验');
      return;
    }
    setSelectedModel(isVideo ? 'seedance-2.0' : imageModel.id);
    if (isVideo && referenceUrls.length > 0) setVideoFrameMode('reference_image');
    updateNodeData(id, { status: 'ready' });
    toast.success(isVideo ? '已加载到 Seedance 参数区，请检查后发送' : '已加载到生图参数区，请检查后发送');
  };

  return (
    <NodeShell
      icon={isVideo ? Play : Sparkles}
      title={data.title || (isVideo ? 'Seedance 视频' : 'AI 生图')}
      status={data.status || 'idle'}
      className="is-generator"
    >
      <Handle id="prompt" type="target" position={Position.Left} className="nv-canvas-handle is-text is-prompt" />
      <Handle id="reference" type="target" position={Position.Left} className="nv-canvas-handle is-image is-reference" />
      <div className="nv-canvas-node__ports">
        <span><i className="is-text" />提示词</span>
        <span><i className="is-image" />参考素材</span>
      </div>
      <p className="nv-canvas-node__description">
        {isVideo ? '连接提示词和参考图，在右侧确认时长、清晰度与模式。' : '连接提示词与参考图，在右侧确认模型与比例。'}
      </p>
      <button type="button" className="nodrag nv-canvas-node__primary" onClick={prepareGeneration}>
        加载到右侧生成器
      </button>
      <OutputHandle type={isVideo ? 'video' : 'image'} />
    </NodeShell>
  );
}
