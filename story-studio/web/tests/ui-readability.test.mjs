import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const freeCanvas = readFileSync(new URL('../src/FreeCanvas.tsx', import.meta.url), 'utf8');
const simpleEditor = readFileSync(new URL('../src/SimpleEditor.tsx', import.meta.url), 'utf8');
const simpleEditorStyles = readFileSync(new URL('../src/simple-editor.css', import.meta.url), 'utf8');
const disclosureChevron = readFileSync(new URL('../src/DisclosureChevron.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const localApi = readFileSync(new URL('../local-api.mjs', import.meta.url), 'utf8');

test('creative UI describes outcomes without exposing protocol terminology', () => {
  assert.doesNotMatch(source.replaceAll('API易', ''), /API/u);
  assert.doesNotMatch(freeCanvas, /API/u);
  assert.equal(source.match(/使用当前提示词重新生成图片/gu)?.length, 3);
  assert.match(source, /使用当前提示词重新生成分镜图/u);
});

test('idea failures persist into the project and expose a direct settings repair action', () => {
  assert.match(source, /ideaOptions: IdeaDirectionOption\[\];\s*ideaError: string;/u);
  assert.match(source, /ideaOptions, ideaError, agentTranscript/u);
  assert.match(source, /saved\.ideaError \|\| ""/u);
  assert.match(source, /检查创作设定/u);
});

test('director and free canvas are separate modes connected by stable source references', () => {
  assert.match(source, /导演模式/u);
  assert.match(source, /自由画布/u);
  assert.match(source, /directorCanvasSources/u);
  assert.match(freeCanvas, /sourceRef/u);
  assert.match(freeCanvas, /回到导演/u);
  assert.match(freeCanvas, /sourceRef: source\?\.sourceRef/u);
  assert.match(styles, /\.free-canvas-workspace/u);
});

test('current production role uses a stage-specific illustrated avatar instead of the shared title orb', () => {
  assert.match(source, /className="role-avatar"/u);
  assert.match(source, /<img src=\{currentRole\.image\} alt="" draggable=\{false\}/u);
  assert.doesNotMatch(source, /<div className="role-title"><span className="role-orb">●<\/span>/u);
  for (const asset of [
    'writer-director.webp',
    'character-designer.webp',
    'scene-designer.webp',
    'prop-designer.webp',
    'storyboard-artist.webp',
    'video-prompt-director.webp',
    'local-video-director.webp',
    'post-production-director.webp',
  ]) assert.match(source, new RegExp(`/assets/roles/${asset}`));
  assert.match(styles, /\.role-avatar \{[^}]*width: 42px;[^}]*height: 34px;[^}]*overflow: hidden;[^}]*border-radius: 999px;/u);
  assert.match(styles, /\.role-avatar img \{[^}]*object-fit: cover;/u);
});

test('settings center groups connections, creative defaults, storage and diagnostics with a motion-safe gear trigger', () => {
  assert.match(source, /连接与模型/u);
  assert.match(source, /创作默认/u);
  assert.match(source, /title="默认故事板规格"/u);
  assert.match(source, /\["3", "三宫格"\].*\["4", "四宫格"\].*\["6", "六宫格"\].*\["9", "九宫格"\]/u);
  assert.match(source, /storyboardBoardPanelCount: defaults\.storyboardBoardPanelCount/u);
  assert.match(source, /panelCount: storyboardBoardPanelCount/u);
  assert.match(source, /保存后同步当前项目，后续新项目也沿用/u);
  assert.match(source, /updateCurrentStoryboardPanelCount\(defaults\.storyboardBoardPanelCount\)/u);
  assert.match(source, /function normalizeAppCreativeDefaults/u);
  assert.match(source, /function normalizeStoredStoryboardBoardError/u);
  assert.match(source, /setStoryboardBoardError\(normalizeStoredStoryboardBoardError\(saved\.storyboardBoardError, restoredStoryboardBoardPanelCount\)\)/u);
  assert.match(source, /normalizeStoryboardBoardPanelCount\(value\?\.storyboardBoardPanelCount, defaults\.storyboardBoardPanelCount\)/u);
  assert.match(source, /const normalizedPanelCount = normalizeStoryboardBoardPanelCount\(panelCount, 3\)/u);
  assert.match(source, /setCreativeDraft\(normalizeAppCreativeDefaults\(settingsBody\.settings\.creativeDefaults\)\)/u);
  assert.match(source, /文件与存储/u);
  assert.match(source, /系统与诊断/u);
  assert.match(source, /在线音乐/u);
  assert.match(source, /你使用哪一家服务/u);
  assert.match(source, /API易[\s\S]*gpt-image-2-all/u);
  assert.match(source, /火山方舟[\s\S]*doubao-seedream-5-0-pro-260628/u);
  assert.match(source, /访问令牌/u);
  assert.match(source, /保存并检查连接/u);
  assert.match(source, /settingsContentRef\.current\?\.scrollTo\(\{ top: 0 \}\)/u);
  assert.match(source, /密钥只保存在这台电脑，不会写入项目文件/u);
  assert.match(source, /可粘贴服务根地址或完整接口地址，保存时会自动整理/u);
  assert.match(styles, /\.provider-setup-steps \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /\.provider-presets > div \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /\.settings-content \{[^}]*scrollbar-width:thin;[^}]*scrollbar-color:#80536d #171719;/u);
  assert.match(styles, /\.settings-content::-webkit-scrollbar \{[^}]*width:11px;[^}]*background:#171719;/u);
  assert.match(styles, /\.settings-content::-webkit-scrollbar-button \{[^}]*display:none;[^}]*height:0;/u);
  assert.match(styles, /\.settings-content::-webkit-scrollbar-thumb:hover \{[^}]*background:#ad658d;/u);
  assert.match(source, /className="avatar-button settings-trigger"/u);
  assert.match(source, /className="settings-gear-icon"/u);
  assert.match(source, /<path d="M12\.22 2h-\.44/u);
  assert.match(source, /<circle cx="12" cy="12" r="3"/u);
  assert.match(source, /emptyCreativeState\(appCreativeDefaultsRef\.current\)/u);
  assert.match(styles, /\.settings-gear-icon \{[^}]*width:22px;[^}]*height:22px;/u);
  assert.match(styles, /\.avatar-button \{[^}]*display:grid;[^}]*place-items:center;[^}]*padding:0;/u);
  assert.match(styles, /\.settings-trigger:hover \.settings-gear-icon \{[^}]*rotate\(64deg\)/u);
  assert.match(styles, /@keyframes settings-trigger-sheen/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^]*\.settings-trigger::after/u);
});

test('named provider models can be managed once and switched from each production surface', () => {
  assert.match(localApi, /schemaVersion: 2/u);
  assert.match(localApi, /activeProfiles: Object\.fromEntries\(activeProfileIds\)/u);
  assert.match(localApi, /\/api\/provider-settings\/activate/u);
  assert.match(source, /配置名称/u);
  assert.match(source, /添加模型/u);
  assert.match(source, /aria-label="文字模型"/u);
  assert.match(source, /aria-label="对话推理强度"/u);
  assert.match(source, /aria-pressed=\{managerReasoningEffort === effort\}/u);
  assert.doesNotMatch(source, /aria-label="添加素材"|⚡ 技能/u);
  assert.match(source, /选择后续图片模型/u);
  assert.match(source, /参考图编辑/u);
  assert.match(freeCanvas, /free-node-model-selectors/u);
  assert.match(freeCanvas, /imageProviderKind/u);
  assert.match(styles, /\.composer-model-select/u);
  assert.match(styles, /\.composer-reasoning-control/u);
  assert.match(styles, /\.generation-model-groups/u);
  assert.match(styles, /\.free-node-model-selectors/u);
});

test('text provider settings expose protocol-family presets for OpenAI, DeepSeek, Kimi, GLM and Claude', () => {
  assert.match(source, /name: "OpenAI 官方"[\s\S]*protocol: "responses"/u);
  assert.match(source, /name: "DeepSeek 官方"[\s\S]*protocol: "chat-completions"/u);
  assert.match(source, /name: "Kimi 官方"[\s\S]*protocol: "chat-completions"/u);
  assert.match(source, /name: "智谱 GLM 官方"[\s\S]*protocol: "chat-completions"/u);
  assert.match(source, /name: "Claude 官方"[\s\S]*protocol: "anthropic-messages"/u);
  assert.match(source, /文字接口协议/u);
  assert.match(source, /OpenAI Chat Completions/u);
  assert.match(source, /Anthropic Messages/u);
});

test('top-left identity uses the PRISM mark and displays the product name above the current project', () => {
  assert.match(source, /src="\/assets\/brand\/prism-mark\.svg"/u);
  assert.match(source, /className="product-name">PRISM <span>STORY STUDIO<\/span>/u);
  assert.match(source, /className="header-project-name">\{projectName\}<\/span>/u);
  assert.match(styles, /\.brand-mark img \{[^}]*width:100%;[^}]*height:100%;/u);
  assert.match(styles, /\.project-identity \.product-name \{[^}]*overflow:visible;[^}]*text-overflow:clip;/u);
  assert.match(styles, /\.project-pill \{[^}]*flex:0 0 294px;[^}]*min-width:294px;[^}]*width:294px;/u);
});

test('top-level editing desk exposes project media, player, inspector and versioned local render', () => {
  assert.match(source, /剪辑台/u);
  assert.match(source, /editorAssets/u);
  assert.match(simpleEditor, /项目素材库/u);
  assert.match(simpleEditor, /视频属性/u);
  assert.match(simpleEditor, /音频属性/u);
  assert.match(simpleEditor, /从导演镜头建立/u);
  assert.match(simpleEditor, /生成新成片/u);
  assert.match(simpleEditor, /原声/u);
  assert.match(simpleEditor, /音频/u);
  assert.match(simpleEditor, /字幕/u);
  assert.match(simpleEditorStyles, /\.simple-editor/u);
});

test('editing desk media cards show real thumbnails and the player preserves source proportions', () => {
  assert.match(simpleEditor, /asset\.kind === "image" \? <img/u);
  assert.match(simpleEditor, /asset\.kind === "video" \|\| asset\.kind === "final"/u);
  assert.match(simpleEditor, /preview-media-shell/u);
  assert.match(simpleEditor, /时间线预览/u);
  assert.match(simpleEditorStyles, /\.asset-thumb img,\.asset-thumb video\{[^}]*object-fit:cover/u);
  assert.match(simpleEditorStyles, /\.preview-media-shell>video\{[^}]*object-fit:contain!important/u);
  assert.match(simpleEditorStyles, /\.editor-preview-row,\.editor-preview\{overflow:hidden\}/u);
});

test('editing desk uses a CapCut-like preview inspector and full-width timeline layout', () => {
  assert.match(simpleEditorStyles, /\.editor-main\{[^}]*grid-template-rows:minmax\(330px,57%\) minmax\(0,43%\)/u);
  assert.match(simpleEditorStyles, /\.editor-preview-row\{[^}]*grid-template-columns:minmax\(0,1fr\) clamp\(300px,24vw,430px\)/u);
  assert.match(simpleEditorStyles, /\.preview-media-shell\{[^}]*width:auto[^}]*height:100%[^}]*aspect-ratio:16\/9/u);
  assert.match(simpleEditor, /aspectRatio: `\$\{previewSize\.width\} \/ \$\{previewSize\.height\}`/u);
});

test('editing desk scrubs, trims, splits and previews the assembled timeline', () => {
  assert.match(simpleEditor, /className="timeline-scrubber" aria-label="时间指针" type="range"/u);
  assert.match(simpleEditor, /onChange=\{\(event\) => seekGlobal\(Number\(event\.target\.value\), isPlaying\)\}/u);
  assert.match(simpleEditor, /const splitClipAtPlayhead = \(\) =>/u);
  assert.match(simpleEditor, /next\.splice\(index, 1, \{ \.\.\.splitTargetRange\.clip, sourceOutSec: sourceTime \}, rightClip\)/u);
  assert.match(simpleEditor, /const onClipPointerMove = \(event: ReactPointerEvent<HTMLButtonElement>\) =>/u);
  assert.match(simpleEditor, /className="clip-trim-handle start"/u);
  assert.match(simpleEditor, /pendingPreviewRef\.current = \{ clipId: next\.clip\.id, sourceTime: next\.clip\.sourceInSec, autoplay: isPlaying \}/u);
  assert.match(simpleEditor, /onEnded=\{finishCurrentClip\}/u);
  assert.match(simpleEditor, /requestAnimationFrame\(updatePlaybackFrame\)/u);
  assert.match(simpleEditor, /video\.currentTime >= range\.clip\.sourceOutSec - 0\.008/u);
  assert.match(simpleEditor, /videoRef\.current\.currentTime = Math\.max\(range\.clip\.sourceInSec, range\.clip\.sourceOutSec - 0\.001\)/u);
  assert.match(simpleEditor, /video\.currentTime >= selectedClip\.sourceInSec && video\.currentTime < selectedClip\.sourceOutSec/u);
  assert.match(simpleEditor, /const splitAudioAtPlayhead = \(\) =>/u);
  assert.match(simpleEditor, /className=\{`timeline-audio-clip/u);
  assert.match(simpleEditor, /data-audio-clip-id=\{previewAudioClip\?\.id/u);
  assert.match(simpleEditor, /timelineStartSec/u);
  assert.match(simpleEditor, /moveSubtitle\(cue\.id, -1\)/u);
  assert.match(simpleEditorStyles, /\.timeline-audio-clips\{[^}]*position:relative/u);
  assert.match(simpleEditor, /gridTemplateColumns: state\.clips\.map\(\(clip\) => `\$\{durationOf\(clip\)\}fr`\)\.join\(" "\)/u);
  assert.match(simpleEditorStyles, /\.timeline-clips\{display:grid\}/u);
  assert.match(simpleEditorStyles, /\.timeline-clip\{[^}]*min-width:0;[^}]*max-width:none/u);
});

test('director mode has a scoped gray and rose visual system with state-driven motion', () => {
  assert.match(source, /canvas-mode-\$\{canvasMode\}/u);
  assert.match(styles, /\.visual-sample-minimal\.canvas-mode-director \{/u);
  assert.match(styles, /--director-accent:#dd6eaa/u);
  assert.match(styles, /\.canvas-mode-director \.fixed-stage-layout \.node-card/u);
  assert.match(styles, /\.canvas-mode-director:has\(\.node-effect-active\) \.fixed-stage-connections path:not\(\.stage-spine\)/u);
  assert.match(styles, /@keyframes director-branch-flow/u);
  assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*\.canvas-mode-director:has\(\.node-effect-active\)/u);
});

test('director studio is the default UI and keeps one sliding mode switch across workspaces', () => {
  assert.match(source, /get\("director-ui"\) !== "classic"/u);
  assert.match(source, /directorUiPreview \? " director-ui-studio" : ""/u);
  assert.match(source, /className="director-studio-masthead"/u);
  assert.match(source, /定位当前节点/u);
  assert.match(source, /studioStageViews/u);
  assert.match(source, /stageView\.statusLabelZh/u);
  assert.match(styles, /\.visual-sample-minimal\.canvas-mode-director\.director-ui-studio \{/u);
  assert.match(styles, /--studio-accent: #d789ad/u);
  assert.match(styles, /\.director-ui-studio \.canvas-mode-switch/u);
  assert.match(styles, /\.director-ui-studio \.canvas-mode-switch::before/u);
  assert.match(styles, /\.canvas-mode-free\.director-ui-studio \.canvas-mode-switch::before \{[^}]*translateX\(100%\)/u);
  assert.match(styles, /\.canvas-mode-editor\.director-ui-studio \.canvas-mode-switch::before \{[^}]*translateX\(200%\)/u);
  assert.match(styles, /button\[aria-label="展开Agent面板"\]/u);
  assert.match(styles, /\.director-ui-studio \.h3-launch-button > i/u);
  assert.match(styles, /\.director-studio-masthead/u);
  assert.match(styles, /\.flow-content\[data-active-stage="场景"\]/u);
  assert.match(styles, /\.flow-content\[data-active-stage\]:not\(\[data-active-stage="总览"\]\) \.node-card \{\s*opacity: 1;/u);
  assert.match(source, /visibleTimelineItems/u);
  assert.match(source, /studio-history-disclosure/u);
});

test('free canvas supports persistent nodes, edges, panning and 20 percent zoom', () => {
  assert.match(freeCanvas, /nodes: FreeCanvasNode\[\]/u);
  assert.match(freeCanvas, /edges: FreeCanvasEdge\[\]/u);
  assert.match(freeCanvas, /fromNodeId/u);
  assert.match(freeCanvas, /ReactFlow/u);
  assert.match(freeCanvas, /panOnScroll/u);
  assert.match(freeCanvas, /<Handle/u);
  assert.match(freeCanvas, /onConnect=/u);
  assert.match(freeCanvas, /connectionMode=\{ConnectionMode\.Loose\}/u);
  assert.match(freeCanvas, /onConnectEnd=/u);
  assert.match(freeCanvas, /引用该节点生成/u);
  assert.match(freeCanvas, /创建并自动连接/u);
  assert.match(freeCanvas, /className=\{`free-node-face/u);
  assert.match(freeCanvas, /className=\{`free-node-editor/u);
  assert.match(freeCanvas, /free-node-text-preview/u);
  assert.match(freeCanvas, /PromptWandIcon/u);
  assert.match(freeCanvas, /PromptOptimizationLoader/u);
  assert.match(freeCanvas, /FreeCanvasReference/u);
  assert.match(freeCanvas, /item\.kind === "image" \|\| item\.kind === "video"/u);
  assert.doesNotMatch(freeCanvas, /item\.kind === "image" \|\| item\.kind === "video" \|\| item\.kind === "audio"/u);
  assert.match(freeCanvas, /描述歌曲风格、乐器、情绪、歌手声线与结构/u);
  assert.match(freeCanvas, /来自上游连线/u);
  assert.match(freeCanvas, /state\.edges[\s\S]*incoming\.get\(edge\.toNodeId\)/u);
  assert.match(styles, /\.free-node-reference-panel/u);
  assert.match(styles, /\.free-node-reference-list/u);
  assert.match(freeCanvas, /魔法棒用于优化当前内容/u);
  assert.match(freeCanvas, /魔法棒会按已选目标扩写完整/u);
  assert.match(freeCanvas, /text: \["记录创意意图", "描述角色与事件", "作为下游节点参考"\]/u);
  assert.match(freeCanvas, /按\$\{nodeLabels\[item\.kind\]\}节点格式优化，并读取已连接的上游文字/u);
  assert.match(freeCanvas, /optimizePrompt\(item\.kind, prompt, references,/u);
  assert.match(freeCanvas, /当前\$\{nodeLabels\[item\.kind\]\}已自动作为第1项/u);
  assert.match(freeCanvas, /currentMediaReference[\s\S]*upstreamReferences/u);
  assert.match(freeCanvas, /已有视频会自动作为@视频1，可用于全能参考编辑、动作借鉴或视频扩展/u);
  assert.match(freeCanvas, /onLoadedMetadata=.*mediaDurationSec/u);
  assert.match(freeCanvas, /mediaDurationSec: source\.mediaDurationSec/u);
  assert.match(freeCanvas, /outputPaths: task\.outputPaths\?\.length \? task\.outputPaths : sourceOutputPaths/u);
  assert.match(freeCanvas, /outputPaths: sourceOutputPaths, error: message/u);
  assert.doesNotMatch(freeCanvas, />文A 优化</u);
  assert.match(freeCanvas, /onCompositionStart/u);
  assert.match(freeCanvas, /onCompositionEnd/u);
  assert.match(freeCanvas, /onFocus=\{\(event\) => \{ beginEdit\(\); updateReferenceMention\(event\.currentTarget\.value, event\.currentTarget\.selectionStart\); \}\}/u);
  assert.match(freeCanvas, /scheduleDraftCommit/u);
  assert.match(freeCanvas, /停顿后自动保存/u);
  assert.match(freeCanvas, /requestEditorClose/u);
  assert.match(freeCanvas, /commitDraft\(\);\s*faceRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*hideEditor\(\);/u);
  assert.doesNotMatch(freeCanvas, /onPointerUp=\{requestEditorClose\}/u);
  assert.match(freeCanvas, /applyNodeChanges\(changes, current\)/u);
  assert.match(freeCanvas, /defaultViewport=\{state\.view\}/u);
  assert.match(freeCanvas, /onMoveEnd=\{\(_event, viewport\) => persistViewport\(viewport\)\}/u);
  assert.doesNotMatch(freeCanvas, /viewport=\{state\.view\}/u);
  assert.doesNotMatch(freeCanvas, /onViewportChange=/u);
  assert.doesNotMatch(freeCanvas, /livePositions/u);
  assert.doesNotMatch(freeCanvas, /flowNodeCacheRef/u);
  assert.match(freeCanvas, /MemoizedFreeNodeCard = memo/u);
  assert.match(freeCanvas, /onNodeDragStop=\{commitNodePosition\}/u);
  assert.match(styles, /\.free-canvas-workspace \.react-flow__node\.dragging \{[^}]*will-change:transform;/u);
  assert.match(styles, /\.free-canvas-workspace\.is-node-dragging \.react-flow__edge-path \{[^}]*filter:none;/u);
  assert.doesNotMatch(styles, /\.free-canvas-workspace \.react-flow__viewport,[^{]+backface-visibility:hidden/u);
  assert.match(freeCanvas, /change\.type === "position" && !change\.dragging && change\.position/u);
  assert.match(freeCanvas, /onPaneClick=\{\(\) => \{ setPendingNodeMenu\(null\); setCanvasContextMenu\(null\); setNodeContextMenu\(null\); setEditingNodeId\(null\); setSelectedNodeIds\(new Set\(\)\); setSelectedEdgeIds\(new Set\(\)\); \}\}/u);
  assert.match(freeCanvas, /onDoubleClick=\{\(event\) => \{ event\.stopPropagation\(\); openEditor\(\); \}\}/u);
  assert.match(freeCanvas, /使用底部工具栏添加节点，或从右侧资产库加入素材/u);
  assert.match(freeCanvas, /wasEditorOpenRef/u);
  assert.match(freeCanvas, /wasOpen && !editorOpen[\s\S]*commitDraft\(\)/u);
  assert.match(freeCanvas, /draftMediaUrlRef\.current = result\.mediaUrl;[\s\S]*mediaUrl: result\.mediaUrl/u);
  assert.match(freeCanvas, /generation\?\.status === "complete"[\s\S]*encodeURIComponent\(item\.generation\.externalTaskId\)/u);
  assert.match(source, /\/api\/free-canvas\/optimize-prompt/u);
  assert.match(source, /\/api\/free-canvas\/generate-image/u);
  assert.match(freeCanvas, /runImageGeneration/u);
  assert.match(freeCanvas, /生成图片/u);
  assert.match(freeCanvas, /向上箭头按当前参数生成/u);
  assert.match(freeCanvas, /FreeCanvasImageSettings/u);
  assert.match(freeCanvas, /persistedGenerationActive/u);
  assert.match(freeCanvas, /generationActive = generating \|\| persistedGenerationActive/u);
  assert.match(freeCanvas, /free-node-persistent-generation/u);
  assert.match(freeCanvas, /generationActive && !item\.mediaUrl/u);
  assert.match(freeCanvas, /free-node-generation-state/u);
  const upscaleTaskStart = freeCanvas.indexOf('const node = createDerivedImageNode(source, `${source.title} · ${label}`');
  const upscaleDialogClose = freeCanvas.indexOf('if (operation === "upscale") {', upscaleTaskStart);
  const upscaleRequest = freeCanvas.indexOf('await onProcessImage(', upscaleTaskStart);
  assert.ok(upscaleTaskStart >= 0 && upscaleDialogClose > upscaleTaskStart && upscaleRequest > upscaleDialogClose, '超分参数窗口应在本机处理请求等待前关闭');
  assert.match(freeCanvas, /disabled=\{generationActive \|\| optimizing/u);
  assert.match(source, /activeFreeCanvasVideoSignature/u);
  assert.match(source, /freeCanvasVideoPollInFlight/u);
  assert.match(source, /读取自由画布视频任务/u);
  assert.match(styles, /\.free-node-persistent-generation/u);
  assert.match(styles, /\.free-node-generation-state/u);
  assert.match(styles, /@keyframes free-node-generation-track/u);
  assert.match(freeCanvas, /FREE_CANVAS_IMAGE_ASPECT_RATIOS/u);
  assert.match(freeCanvas, /imageRequestSizeForAspectRatio\(aspectRatio, imageSettings\.resolution\)/u);
  assert.match(freeCanvas, /IMAGE_RESOLUTION_TIERS\.map/u);
  assert.match(freeCanvas, /free-node-image-settings-summary/u);
  assert.match(freeCanvas, /free-node-candidate-picker/u);
  assert.match(freeCanvas, /当前采用/u);
  assert.match(freeCanvas, /application\/x-prism-free-canvas-image/u);
  assert.match(freeCanvas, /materializeImageCandidate/u);
  assert.match(freeCanvas, /candidateSource/u);
  assert.match(freeCanvas, /独立候选 · 1张/u);
  assert.match(freeCanvas, /const nodeSelected = selectedNodeIds\.has\(item\.id\)/u);
  assert.match(freeCanvas, /previous\.selected === nodeSelected/u);
  assert.match(freeCanvas, /selected: nodeSelected/u);
  assert.match(freeCanvas, /const startNodeDrag = useCallback/u);
  assert.match(freeCanvas, /if \(modifiedSelection \|\| selectedNodeIds\.has\(node\.id\)\) return/u);
  assert.match(freeCanvas, /setSelectedNodeIds\(new Set\(\[node\.id\]\)\)/u);
  assert.match(freeCanvas, /onNodeDragStart=\{startNodeDrag\}/u);
  assert.match(freeCanvas, /free-node-label-grip/u);
  assert.match(styles, /\.free-node-label[^}]*height:27px[^}]*cursor:grab[^}]*pointer-events:auto/u);
  assert.match(freeCanvas, /free-node-video-drag-surface/u);
  assert.match(styles, /\.free-node-video-drag-surface[^}]*top:0[^}]*bottom:48px[^}]*cursor:grab[^}]*touch-action:none/u);
  assert.doesNotMatch(freeCanvas, /free-node-video-drag-surface[^>]*>\s*<i/u);
  assert.doesNotMatch(styles, /\.free-node-video-drag-surface i/u);
  assert.match(freeCanvas, /onContextMenuCapture=/u);
  assert.match(freeCanvas, /classList\.contains\("react-flow__pane"\)/u);
  assert.match(freeCanvas, /aria-label="画布菜单"/u);
  assert.match(freeCanvas, />导入<small>文本、图片、视频、音频<\/small>/u);
  assert.match(freeCanvas, />添加节点<\/span>/u);
  assert.match(freeCanvas, />粘贴<small>自动识别剪贴板格式<\/small>/u);
  assert.match(freeCanvas, />撤销<\/span>/u);
  assert.match(freeCanvas, />重做<\/span>/u);
  assert.match(freeCanvas, /navigator\.clipboard\?\.read/u);
  assert.match(source, /\/api\/free-canvas\/imports/u);
  assert.match(styles, /\.free-canvas-context-menu/u);
  assert.match(styles, /\.free-canvas-context-submenu/u);
  assert.match(freeCanvas, /preservedCandidates/u);
  assert.match(freeCanvas, /\[\.\.\.result\.imageUrls, \.\.\.preservedCandidates\]\.slice\(0, 12\)/u);
  assert.doesNotMatch(freeCanvas, /free-node-image-results/u);
  assert.match(freeCanvas, /aspectRatio: `\$\{imageSettings\.width\} \/ \$\{imageSettings\.height\}`/u);
  assert.match(styles, /\.free-node-face\.has-image-result \{[^}]*min-height:0;/u);
  assert.match(styles, /\.free-node-face \{[^}]*cursor:grab;/u);
  assert.match(styles, /\.free-node-candidate-picker/u);
  assert.match(styles, /\.free-node-candidate-thumbs button\.selected/u);
  assert.match(freeCanvas, /free-node-reference-tooltip/u);
  assert.match(freeCanvas, /findFreeCanvasReferenceMention/u);
  assert.match(freeCanvas, /free-node-reference-mention-menu/u);
  assert.match(freeCanvas, /输入 @ 可选择上方图片、视频或音频/u);
  assert.match(freeCanvas, /item\.kind === "image" \|\| item\.kind === "video"/u);
  assert.match(freeCanvas, /输入图片提示词；输入 @ 可选择上方参考图片进行编辑/u);
  assert.match(freeCanvas, /item\.kind === "image" && entry\.kind !== "image"/u);
  assert.doesNotMatch(freeCanvas, /@ 添加参考/u);
  assert.match(styles, /\.free-node-reference-list article \{[^}]*flex:0 0 52px;/u);
  assert.match(styles, /\.free-node-reference-mention-menu \{[^}]*z-index:95;/u);
  assert.match(styles, /article:hover \.free-node-reference-tooltip/u);
  assert.match(styles, /\.free-node-image-settings-popover/u);
  assert.match(freeCanvas, /FreeCanvasVideoSettings/u);
  assert.match(freeCanvas, /aria-label="视频生成参数"/u);
  assert.match(localApi, /const isFreeCanvasVideoRequest = url\.pathname === '\/api\/free-canvas\/generate-video'/u);
  assert.match(localApi, /isFreeCanvasVideoRequest \? safeH3Message\(error\)/u);
  assert.match(freeCanvas, /\["16:9", "9:16", "1:1", "4:3", "3:4"\]/u);
  assert.match(freeCanvas, /\["480p", "720p", "1080p"\]/u);
  assert.match(freeCanvas, /min="1" max="15"/u);
  assert.match(freeCanvas, /min="4" max="30"/u);
  assert.match(freeCanvas, /lightx2v-544p-v1/u);
  assert.match(freeCanvas, /lightx2v-768p-v1/u);
  assert.match(freeCanvas, /Spectrum/u);
  assert.match(freeCanvas, /SageAttention/u);
  assert.match(styles, /\.free-node-video-settings-popover \{[^}]*width:520px;/u);
  assert.match(styles, /\.free-node-video-range input\[type="range"\]::-webkit-slider-runnable-track/u);
  assert.match(styles, /\.free-node-video-toggles button\.selected > i::after/u);
  assert.match(freeCanvas, /FreeCanvasAudioSettings/u);
  assert.match(source, /\/api\/free-canvas\/generate-audio/u);
  assert.match(source, /onGenerateAudio=\{generateFreeCanvasAudio\}/u);
  assert.match(freeCanvas, /ACE-Step音频生成参数/u);
  assert.match(freeCanvas, /纯音乐|歌曲/u);
  assert.match(freeCanvas, /生成音频 · 调用本机ACE-Step 1\.5/u);
  assert.match(freeCanvas, /maxLength=\{item\.kind === "audio" \? 2_000 : 20_000\}/u);
  assert.match(freeCanvas, /inputMode="numeric"[\s\S]*aria-label="BPM数值"/u);
  assert.match(freeCanvas, /aria-label="BPM减少1"/u);
  assert.match(freeCanvas, /aria-label="BPM增加1"/u);
  assert.match(freeCanvas, /onBlur=\{commitBpmDraft\}/u);
  assert.match(freeCanvas, /free-node-audio-settings-summary[^\n]*onKeyDown=/u);
  assert.match(freeCanvas, /className="free-node-audio-result"/u);
  assert.match(freeCanvas, /className="free-node-audio-native"[^>]*preload="metadata"/u);
  assert.match(freeCanvas, /aria-label=\{audioPlaying \? "暂停音频" : "播放音频"\}/u);
  assert.match(freeCanvas, /aria-label="音频播放进度"/u);
  assert.match(freeCanvas, /audioWaveHeights\.map/u);
  assert.doesNotMatch(freeCanvas, /item\.mediaUrl && item\.kind === "audio" \? <audio[^>]*controls/u);
  assert.doesNotMatch(freeCanvas, /<span>BPM<\/span><input type="number"/u);
  assert.match(styles, /\.free-node-audio-settings-popover/u);
  assert.match(styles, /\.free-node\.kind-audio:has\(\.has-audio-result\) \{[^}]*min-height:176px;/u);
  assert.match(styles, /\.free-node-face\.has-audio-result \{[^}]*min-height:176px;/u);
  assert.match(styles, /\.free-node-audio-wave \{[^}]*height:35px;/u);
  assert.match(styles, /\.free-node-audio-controls \{[^}]*grid-template-columns:28px 31px minmax\(0,1fr\) 31px 28px;/u);
  assert.match(styles, /\.free-node-audio-bpm-control \{[^}]*grid-template-columns:34px minmax\(0,1fr\) 34px;/u);
  assert.match(styles, /\.free-node-audio-bpm-control button \{[^}]*height:32px;/u);
  assert.match(styles, /\.free-node-editor \{[^}]*top:calc\(100% \+ 16px\);[^}]*width:620px;/u);
  assert.match(styles, /\.free-node-optimize \{[^}]*width:36px;[^}]*height:36px;/u);
  assert.match(styles, /@keyframes free-node-loader-orbit/u);
  assert.match(freeCanvas, /GenerateArrowIcon/u);
  assert.match(freeCanvas, /ImageGenerationLoader/u);
  assert.match(styles, /\.free-node-textarea-shell > textarea::-webkit-scrollbar \{[^}]*width:6px;/u);
  assert.match(styles, /\.free-node-editor-done \{[^}]*border:1px solid #4a4d55;[^}]*background:#2a2b2f;/u);
  assert.match(styles, /@keyframes free-node-generation-spin/u);
  assert.match(freeCanvas, /function magnetizeHandle/u);
  assert.match(freeCanvas, /function canonicalConnection/u);
  assert.match(freeCanvas, /connection\.sourceHandle === "left" && connection\.targetHandle === "right"/u);
  assert.match(freeCanvas, /function canReference/u);
  assert.match(freeCanvas, /referencePurposes\(sourceKind, targetKind\)/u);
  assert.match(freeCanvas, /sourceHandle: "right", targetHandle: "left"/u);
  assert.match(freeCanvas, /左侧输入端口/u);
  assert.match(freeCanvas, /右侧输出端口/u);
  assert.match(freeCanvas, /为该节点创建输入/u);
  assert.match(freeCanvas, /引用该节点生成/u);
  assert.match(freeCanvas, /--handle-magnet-x/u);
  assert.match(styles, /\.free-node-handle\.react-flow__handle \{[^}]*width:1px;[^}]*height:1px;/u);
  assert.match(styles, /\.free-node-handle\.react-flow__handle::before \{[^}]*width:38px;[^}]*height:54px;/u);
  assert.match(styles, /--handle-visual-offset-x:-12px/u);
  assert.match(styles, /--handle-visual-offset-x:12px/u);
  assert.match(styles, /react-flow__handle-left \{[^}]*left:2px;/u);
  assert.match(styles, /react-flow__handle-right \{[^}]*right:2px;/u);
  assert.match(styles, /transform:translate\(calc\(-50% \+ var\(--handle-magnet-x\) \+ var\(--handle-visual-offset-x\)\),calc\(-50% \+ var\(--handle-magnet-y\)\)\) scale\(\.72\)/u);
  assert.match(styles, /\.free-node-handle\.react-flow__handle span \{[^}]*opacity:0;/u);
  assert.match(styles, /\.free-node:hover \.free-node-handle span,[^}]*opacity:1;/u);
  assert.doesNotMatch(styles, /\.free-node-handle\.react-flow__handle:hover\s*\{[^}]*transform:/u);
  assert.match(styles, /\.free-node-create-menu/u);
  assert.match(styles, /\.free-node-create-menu > div > button:disabled \{[^}]*cursor:not-allowed;/u);
  assert.match(styles, /\.react-flow__connection-path \{[^}]*drop-shadow/u);
  assert.match(freeCanvas, /Math\.max\(0\.2, Math\.min\(1\.8/u);
});

test('free canvas bottom-left controls organize, filter edges, toggle minimap and snap to grid', () => {
  assert.match(freeCanvas, /aria-label="画布视图工具"/u);
  assert.match(freeCanvas, /organizeFreeCanvas\(layoutNodes, state\.edges\)/u);
  assert.match(freeCanvas, /画布已整理，可撤销/u);
  assert.match(freeCanvas, /edges=\{state\.preferences\.showConnections \? flowEdges : \[\]\}/u);
  assert.match(freeCanvas, /state\.preferences\.showMiniMap && state\.nodes\.length > 0/u);
  assert.match(freeCanvas, /snapToGrid=\{state\.preferences\.snapToGrid\}/u);
  assert.match(freeCanvas, /snapGrid=\{\[22, 22\]\}/u);
  assert.match(styles, /\.free-canvas-view-tools/u);
});

test('free canvas node context menu and shared asset drawer expose real actions', () => {
  assert.match(freeCanvas, /onContextMenu=\{\(event\) => data\.openContextMenu\(event, item\.id\)\}/u);
  assert.match(freeCanvas, /保存到资产库/u);
  assert.match(freeCanvas, /复制节点/u);
  assert.match(freeCanvas, /创建副本/u);
  assert.match(freeCanvas, /复制文字/u);
  assert.match(freeCanvas, /复制图片/u);
  assert.match(freeCanvas, /断开所有连线/u);
  assert.match(freeCanvas, /删除节点/u);
  assert.match(freeCanvas, /application\/x-prism-asset-library/u);
  assert.match(freeCanvas, /application\/x-prism-director-source/u);
  assert.match(freeCanvas, /id="free-canvas-asset-library"/u);
  assert.match(freeCanvas, /filteredDirectorSources/u);
  assert.match(freeCanvas, /当前项目 · \{source\.sourceRef\.type\}/u);
  assert.match(freeCanvas, /编辑资产资料/u);
  assert.match(freeCanvas, /编辑副本/u);
  assert.match(freeCanvas, /编辑副本只修改画布节点/u);
  assert.match(freeCanvas, /method: "PATCH"/u);
  assert.match(freeCanvas, /assetLibraryEditDraft\.tags\.split/u);
  assert.match(freeCanvas, /可输入新的文件夹/u);
  assert.match(freeCanvas, /加入收藏/u);
  assert.doesNotMatch(freeCanvas, /className="free-source-dock"/u);
  assert.match(freeCanvas, /fetch\("\/api\/asset-library"/u);
  assert.match(styles, /\.free-canvas-asset-tab/u);
  assert.match(styles, /\.free-canvas-asset-library \{[^}]*width:min\(585px,calc\(100% - 36px\)\)/u);
  assert.match(styles, /\.free-asset-library-preview \{[^}]*width:81px;[^}]*height:69px;/u);
  assert.match(styles, /\.free-asset-library-list article > span strong \{[^}]*font-size:14px;/u);
  assert.match(styles, /\.free-asset-library-editor \{/u);
  assert.match(styles, /\.free-director-source-item/u);
  assert.doesNotMatch(styles, /\.free-source-dock/u);
});

test('free canvas media history persists results and exposes reusable image video and audio views', () => {
  assert.match(freeCanvas, /mediaHistory: FreeCanvasMediaHistoryItem\[\]/u);
  assert.match(freeCanvas, /collectNodeMediaHistory\(state\.nodes, state\.mediaHistory\)/u);
  assert.match(freeCanvas, /aria-label="打开历史资产"/u);
  assert.match(freeCanvas, /aria-label="历史资产"/u);
  assert.match(freeCanvas, /图片历史/u);
  assert.match(freeCanvas, /视频历史/u);
  assert.match(freeCanvas, /音频历史/u);
  assert.match(freeCanvas, /时间降序/u);
  assert.match(freeCanvas, /批量操作/u);
  assert.match(freeCanvas, /addHistoryItemsToCanvas/u);
  assert.match(freeCanvas, /downloadHistoryItems/u);
  assert.match(styles, /\.free-media-history-dialog/u);
  assert.match(styles, /--history-card-width/u);
});

test('all disclosure controls use the shared vector chevron', () => {
  assert.match(disclosureChevron, /viewBox="0 0 20 20"/u);
  assert.match(disclosureChevron, /\["disclosure-chevron", expanded \? "is-expanded" : "", className\]\.filter\(Boolean\)\.join\(" "\)/u);
  assert.match(source, /<DisclosureChevron className="project-menu-icon" \/>/u);
  assert.match(source, /<DisclosureChevron expanded=\{expanded\} \/>/u);
  assert.equal([...freeCanvas.matchAll(/free-node-settings-chevron/gmu)].length, 3);
  assert.doesNotMatch(source, /⌃|⌄/u);
  assert.doesNotMatch(freeCanvas, /⌃|⌄/u);
  assert.match(styles, /\.disclosure-chevron \{[^}]*width:28px;[^}]*height:28px;/u);
  assert.match(styles, /\.disclosure-chevron\.is-expanded \{[^}]*rotate\(180deg\)/u);
  assert.match(styles, /\.free-node-settings-chevron \{[^}]*width:26px;[^}]*height:26px;/u);
});

test('selected free-canvas nodes highlight connected Bezier edges with direction arrows', () => {
  assert.match(freeCanvas, /connectedToSelectedNode = selectedNodeIds\.has\(item\.fromNodeId\) \|\| selectedNodeIds\.has\(item\.toNodeId\)/u);
  assert.match(freeCanvas, /type: "freeRoute"/u);
  assert.match(freeCanvas, /edgeTypes=\{freeCanvasEdgeTypes\}/u);
  assert.match(freeCanvas, /className: connectedToSelectedNode \? "free-edge-active"/u);
  assert.match(freeCanvas, /getBezierPath/u);
  assert.match(freeCanvas, /markerEnd/u);
  assert.match(styles, /\.react-flow__edge\.free-edge-active \.react-flow__edge-path \{ animation:none; stroke-dasharray:none;/u);
  assert.match(styles, /prefers-reduced-motion:reduce[^}]*free-edge-active/u);
});

test('asset replacement undo is presented as a visible action inside the library', () => {
  assert.match(source, /撤回刚才替换/u);
  assert.match(styles, /\.asset-library-undo/u);
});

test('left Agent keeps completed production stages in a scrollable history', () => {
  assert.match(source, /className="agent-history-log"/u);
  assert.match(source, /制作进度/u);
  assert.match(source, /props\.postProduction\.roughCutApproval === "approved"/u);
  assert.match(styles, /\.agent-scroll \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/u);
});

test('left Agent preserves every real turn while showing only selected option records', () => {
  assert.match(source, /agentTranscript: AgentTranscriptEntry\[\]/u);
  assert.match(source, /完整对话原文/u);
  assert.match(source, /compactTranscriptOptions/u);
  assert.match(source, /aria-label="本轮选择"/u);
  assert.doesNotMatch(source, /本轮提供的全部选项/u);
  assert.match(source, /kind: "revision"/u);
  assert.match(source, /kind: "message"/u);
  assert.match(source, /kind: "action"/u);
  assert.match(source, /kind: "event"/u);
  assert.match(source, /preferredSource\?\.trim\(\) \? preferredSource : fallbackSource/u);
  assert.match(source, /提交文字分镜：每段 \$\{requestedDurationSec\} 秒/u);
  assert.match(source, /entry\.kind === "event" \? "流程记录"/u);
  assert.match(source, /entry\.kind === "action" \? "你的操作"/u);
  assert.match(source, /重新选择固定时长/u);
  assert.match(source, /固定每段时长/u);
  assert.match(source, /让 Agent 修复并写入文字分镜/u);
  assert.match(source, /按 \{durationSec\} 秒重新生成完整文字分镜/u);
  assert.match(styles, /\.agent-transcript-turn > p \{[^}]*white-space:pre-wrap;/u);
});

test('project direction and text-node optimization targets are explicit', () => {
  assert.match(source, /先确定作品方向/u);
  assert.match(source, /剧情叙事/u);
  assert.match(source, /广告营销/u);
  assert.match(source, /产品展示/u);
  assert.match(source, /知识讲解/u);
  assert.match(source, /纪录纪实/u);
  assert.match(source, /音乐与视觉/u);
  assert.match(source, /单条作品/u);
  assert.match(source, /系列连载/u);
  assert.match(source, /creativeDirection === item\.id/u);
  assert.match(source, /workType === "series"/u);
  assert.match(source, /表达气质/u);
  assert.match(source, /step === "novel" \|\| step === "idea"\) setStep\("start"\)/u);
  assert.match(source, /step === "parameters"\) setStep\("format"\)/u);
  assert.match(source, /← 返回修改方向与形式/u);
  assert.match(source, /← 返回影片参数/u);
  assert.match(source, /← 返回修改表达设定/u);
  assert.match(source, /latestIdeaAnswer\?\.text\.trim\(\) === "不再追问，直接生成剧本"/u);
  assert.match(source, /scriptRequested \? "已停止追问"/u);
  assert.match(source, /scriptRequested \? "剧本生成没有完成"/u);
  assert.match(source, /ideaScriptRequested \? props\.onFinishQuestions : props\.onRetryIdea/u);
  assert.match(source, /后续操作只会生成剧本/u);
  assert.match(freeCanvas, /优化目标/u);
  assert.match(freeCanvas, /写成剧本/u);
  assert.match(freeCanvas, /图片提示词/u);
  assert.match(freeCanvas, /视频提示词/u);
  assert.match(styles, /\.free-node-text-target/u);
});

test('canvas zoom reaches a 20 percent overview without oversized stage labels', () => {
  assert.match(source, /zoom: 0\.65/u);
  assert.match(source, /Math\.max\(0\.2, Math\.min\(1\.8/u);
  assert.match(source, /const ZOOM_STEPS = \[0\.2, 0\.35, 0\.5/u);
  assert.doesNotMatch(source, /canvasView\.zoom < 1 \? 1 \/ canvasView\.zoom : 1/u);
  assert.match(source, /<span title=\{row\.label\}>\{row\.label\}<\/span>/u);
  assert.match(styles, /\.stage-row-guide span \{[^}]*width:170px;[^}]*max-width:170px;[^}]*overflow:hidden;[^}]*font-size:14px;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;/u);
});

test('overview zoom keeps generated character images and turnaround boards visible', () => {
  assert.match(styles, /\.fixed-stage-layout\.zoom-overview \.character-result-node \{[^}]*width:1180px;[^}]*min-height:700px;/u);
  assert.match(styles, /\.fixed-stage-layout\.zoom-overview \.character-result-layout \{ display:block; \}/u);
  assert.match(styles, /\.fixed-stage-layout\.zoom-overview \.character-turnaround-preview \{ display:grid; \}/u);
});

test('series planning reserves a full row before character and downstream stages', () => {
  assert.match(source, /const seriesLayoutOffset = brief\.workType === "series" \? 240 : 0/u);
  assert.match(source, /const assetPosition = \{ x: rowStartX, y: 940 \+ seriesLayoutOffset \}/u);
  assert.match(source, /const position = \{ x: rowStartX \+ index \* 1240, y: assetPosition\.y \}/u);
  assert.match(source, /const storyboardPosition = \{ x: rowStartX, y: 4500 \+ seriesLayoutOffset \}/u);
  assert.match(styles, /\.fixed-stage-layout \.series-plan-node \{[^}]*height:650px;[^}]*overflow:hidden;/u);
});

test('Ctrl plus wheel is captured across the application and only changes the canvas zoom', () => {
  assert.match(source, /function handleApplicationCtrlWheel\(event: WheelEvent\)/u);
  assert.match(source, /if \(!event\.ctrlKey \|\| !canvas\) return;/u);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/u);
  assert.match(source, /window\.addEventListener\("wheel", handleApplicationCtrlWheel, \{ passive: false, capture: true \}\)/u);
  assert.match(source, /window\.removeEventListener\("wheel", handleApplicationCtrlWheel, \{ capture: true \}\)/u);
  assert.match(source, /pointerInsideCanvas \? event\.clientX - rect\.left : rect\.width \/ 2/u);
  assert.match(source, /const nextZoom = stepZoom\(current\.zoom, event\.deltaY < 0 \? 1 : -1\)/u);
});

test('plain canvas wheel pans without changing the surrounding application scale', () => {
  assert.match(source, /function handleCanvasWheel/u);
  assert.match(source, /if \(event\.ctrlKey\) return;/u);
  assert.match(source, /y: Math\.round\(current\.y - \(event\.shiftKey \? 0 : event\.deltaY \* deltaScale\)\)/u);
  assert.match(source, /onWheel=\{handleCanvasWheel\}/u);
  assert.doesNotMatch(source, /onWheel=\{zoomAtPointer\}/u);
});

test('H3 control node uses the open left column instead of remaining a small generic card', () => {
  assert.match(source, /const h3SettingsVisible = assetStageVisible \|\| storyboardAssetsApproval === "approved" \|\| videoPrompts\.length > 0 \|\| shotVideoTasks\.length > 0 \|\| shotVideosApproval === "approved"/u);
  assert.match(source, /\{h3SettingsVisible && <H3ControlNode/u);
  assert.match(source, /const shotVideoPosition = \{ x: stageSpineX - 850 - 45, y: storyboardPosition\.y \}/u);
  assert.match(source, /const videoWorkspaceCenterX = \(shotVideoPosition\.x \+ storyboardRightX\) \/ 2/u);
  assert.match(source, /"视频": \{ x: videoWorkspaceCenterX, y: storyboardPosition\.y \+ 430, zoom: 0\.5 \}/u);
  assert.match(styles, /\.fixed-stage-layout \.local-video-stage-node \{[^}]*width:850px;[^}]*min-height:700px;/u);
  assert.match(styles, /\.h3-settings-grid select,\.h3-settings-grid input \{[^}]*min-height:50px;[^}]*font-size:16px;/u);
});

test('desktop canvas reaches the top navigation while live status stays in the application bar', () => {
  assert.match(styles, /\.workspace \{[^}]*top: 20px;/u);
  assert.match(styles, /\.flow-canvas \{[^}]*inset: 0;/u);
  assert.match(source, /className="topbar-leading"[\s\S]*className=\{`topbar-canvas-status[\s\S]*className="canvas-mode-switch"/u);
  assert.doesNotMatch(source, /className="canvas-heading"/u);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.flow-canvas \{ inset:0; \}/u);
});

test('director header uses one compact bar with an axis-centered workspace switch', () => {
  assert.match(source, /className="topbar-leading"[\s\S]*className="canvas-mode-switch"[\s\S]*className="stage-nav"/u);
  assert.match(styles, /\.topbar \{[^}]*display:flex;[^}]*border:1px solid rgba\(255,255,255,\.07\);/u);
  assert.match(styles, /\.canvas-mode-switch \{[^}]*position:absolute;[^}]*left:50%;[^}]*transform:translate\(-50%,-50%\);/u);
  assert.match(styles, /\.project-pill \{[^}]*width:294px;[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none;/u);
  assert.match(styles, /\.stage-nav \{[^}]*position:absolute;[^}]*left:max\(calc\(50% \+ 105px\),calc\(75% - 265px\)\);[^}]*border:0;[^}]*background:transparent;/u);
  assert.match(styles, /@media \(max-width:1499px\) and \(min-width:1201px\) \{[\s\S]*\.stage-nav \{ left:calc\(50% \+ 105px\); \}[\s\S]*\.h3-launch-button > span:not\(\.h3-launch-glyph\) \{ display:none; \}/u);
  assert.match(styles, /\.topbar-canvas-status \{[^}]*margin-left:clamp\(48px,6vw,156px\);[^}]*pointer-events:none;/u);
  assert.match(styles, /@media \(max-width:1499px\) and \(min-width:1201px\) \{\s*\.topbar-canvas-status \{ max-width:220px; margin-left:28px; \}/u);
  assert.match(styles, /@media \(max-width:1200px\) \{\s*\.stage-nav \{ display:none; \}\s*\.topbar-canvas-status \{ max-width:180px; margin-left:16px; \}/u);
});

test('top stage navigation animates the real canvas through overview, pan and focus phases', () => {
  assert.match(source, /setStageNavigationRequest\(\(current\) => Math\.abs\(current\) \+ 1\)/u);
  assert.match(source, /const targetByStage: Record<string/u);
  assert.match(source, /"剧本": \{ x: scriptPosition\.x/u);
  assert.match(source, /const rowCenterX = \(positions: CanvasPoint\[\], cardWidth: number/u);
  assert.match(source, /const storyboardCenterX = rowCenterX\(storyboardNodes\.map/u);
  assert.match(source, /"视频": \{ x: videoWorkspaceCenterX, y: storyboardPosition\.y/u);
  assert.match(source, /const videoParametersTarget = \{ x: shotVideoPosition\.x \+ 425, y: shotVideoPosition\.y \+ 350, zoom: 0\.72 \}/u);
  assert.match(source, /navigationRequest < 0 && h3SettingsVisible \? videoParametersTarget/u);
  assert.match(source, /animateView\(canvasView, overviewAtCurrent, 260\)/u);
  assert.match(source, /animateView\(overviewAtCurrent, overviewAtTarget, 420\)/u);
  assert.match(source, /animateView\(overviewAtTarget, finalView/u);
  assert.match(source, /prefers-reduced-motion: reduce/u);
  assert.match(source, /cancelCanvasNavigation\(\)/u);
  assert.match(source, /aria-current=\{activeStage === item \? "page"/u);
});

test('storyboard navigation and typography use available card space for readable text', () => {
  assert.match(source, /"分镜": \{ x: storyboardCenterX,[^\n]*zoom: 0\.65 \}/u);
  assert.match(source, /"视频": \{ x: videoWorkspaceCenterX,[^\n]*zoom: 0\.5 \}/u);
  assert.match(styles, /text-rendering: optimizeLegibility;/u);
  assert.match(styles, /\.fixed-stage-layout \.storyboard-card-copy p \{[^}]*font-size:20px;[^}]*line-height:1\.78;/u);
  assert.match(source, /function StoryboardCardCopy\(\{ segment \}: \{ segment: StoryboardSegment \}\)/u);
  assert.match(source, /: <StoryboardCardCopy segment=\{segment\} \/>\}/u);
  assert.match(source, /const humanReadableSceneTime =/u);
  assert.match(source, /"日": "白天", "夜": "夜晚"/u);
  assert.match(source, /function StoryboardCardCopy/u);
  assert.match(source, /<p>\{humanReadableStoryboardText\(segment\.storyboardText\)\}<\/p>/u);
  assert.match(source, /文字分镜待确认/u);
  assert.doesNotMatch(source, /文字分镜待处理/u);
  assert.match(source, /const storyboardTextCardHeight = \(value: string\) => Math\.max\(490, 315 \+ estimateStoryboardTextLines\(value\) \* 36\);/u);
  assert.match(source, /const storyboardRowHeights = Array\.from/u);
  assert.match(source, /const \[storyboardNodeHeights, setStoryboardNodeHeights\] = useState<Record<string, number>>\(\{\}\);/u);
  assert.match(source, /querySelectorAll<HTMLElement>\("\.storyboard-segment-node\[data-node-id\]"\)/u);
  assert.match(source, /Math\.ceil\(Math\.max\(node\.offsetHeight, node\.scrollHeight\)\)/u);
  assert.doesNotMatch(source, /height=\{cardHeight\}/u);
  assert.match(source, /data-node-id=\{nodeId\}/u);
  assert.match(styles, /\.storyboard-segment-node\.text-only \.storyboard-media-panel \{[^}]*height:auto;[^}]*overflow:visible;/u);
  assert.match(styles, /\.storyboard-segment-node\.text-only \.storyboard-card-copy p \{[^}]*display:block;[^}]*overflow:visible;[^}]*-webkit-line-clamp:unset;/u);
  assert.match(styles, /\.fixed-stage-layout \.storyboard-node-actions button \{[^}]*min-height:50px;[^}]*font-size:15px;/u);
  assert.match(source, /if \(measuredHeights\.length === rowSegments\.length\) return Math\.max\(\.\.\.measuredHeights\);/u);
  assert.doesNotMatch(source, /return 920/u);
  assert.match(source, /onOpenStoryboardText=\{onOpenStoryboardText\}/u);
  assert.match(source, />查看 \/ 编辑分镜设定<\/button>/u);
  assert.match(styles, /\.storyboard-board-frame img \{[^}]*object-fit:contain;/u);
  assert.match(styles, /\.fixed-stage-layout \.storyboard-segment-node \{[^}]*height:auto;[^}]*overflow:visible;/u);
  assert.match(styles, /\.fixed-stage-layout \.storyboard-media-panel \{[^}]*flex:none;[^}]*height:auto;[^}]*overflow:visible;/u);
  assert.match(styles, /\.storyboard-review-actions \.storyboard-regenerate-action \{ grid-column:1\/-1; \}/u);
});

test('character workspace stays compact until a turnaround request exists', () => {
  assert.match(source, /index \* 1240/u);
  assert.match(source, /className=\{`character-result-node \$\{turnaround \? "turnaround-expanded" : "turnaround-collapsed"\}/u);
  assert.match(source, /\{turnaround && <div className=\{`character-turnaround-preview \$\{turnaround\.status\}`\}>/u);
  assert.doesNotMatch(source, /className="turnaround-plus"/u);
  assert.match(source, /className="turnaround-generate-button"/u);
  assert.match(source, /生成角色三视图/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-node \{[^}]*width:1180px;[^}]*height:700px;[^}]*display:grid;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-node\.turnaround-collapsed \{[^}]*width:820px;[^}]*height:760px;[^}]*grid-template-columns:minmax\(0,1fr\);/u);
  assert.match(styles, /\.fixed-stage-layout \.character-turnaround-preview \{[^}]*grid-column:2;[^}]*grid-row:4;[^}]*height:100%;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-copy p \{[^}]*font-size:15px;[^}]*line-height:1\.6;/u);
});

test('scene workspace keeps main and multi-angle results in one stable media viewport', () => {
  assert.match(source, /const \[sceneMediaViewByKey, setSceneMediaViewByKey\] = useState<Record<string, "main" \| "views">>\(\{\}\);/u);
  assert.match(source, /className="scene-media-tabs" role="tablist"/u);
  assert.match(source, />主图<\/button>/u);
  assert.match(source, />多角度\{view\?\.status/u);
  assert.match(source, /const generateSceneViews = \(\) => \{\s*selectSceneMedia\("views"\);\s*onGenerateSceneView\(proposal\.sceneAssetKey\);/u);
  assert.match(source, /<div className="scene-media-viewport">/u);
  assert.match(source, /<div className=\{`scene-view-preview \$\{view\.status\}`\}>/u);
  assert.match(source, /<button type="button" className="scene-view-generate"[^>]*aria-label=\{`生成\$\{proposal\.name\}场景多角度图`\}/u);
  assert.match(source, /<strong>生成场景多角度图<\/strong><small>使用当前主图，点击即生成四宫格<\/small>/u);
  assert.match(styles, /\.fixed-stage-layout \.scene-proposal-node \{[^}]*min-height:1020px;[^}]*height:1020px;/u);
  assert.doesNotMatch(styles, /\.scene-proposal-node\.scene-view-expanded/u);
  assert.match(styles, /\.scene-media-viewport \{[^}]*aspect-ratio:16\/9;[^}]*overflow:hidden;/u);
  assert.match(styles, /\.scene-view-preview img \{[^}]*object-fit:contain;/u);
  assert.match(styles, /\.scene-view-generate \{[^}]*width:100%;[^}]*height:100%;[^}]*place-items:center;/u);
  assert.match(styles, /\.visual-sample-minimal \.node-card \.scene-view-generate \{ border-color:rgba\(236,93,166,\.58\)!important;/u);
});

test('scene multi-angle generation fills the shared media viewport with a four-view motion state', () => {
  assert.match(source, /className="scene-view-generating" role="status"/u);
  assert.match(source, /\["左前视角", "右前视角", "左后视角", "右后视角"\]\.map/u);
  assert.match(source, /正在分析空间、透视与固定地标/u);
  assert.match(source, /className="scene-view-generation-track" aria-hidden="true"/u);
  assert.match(styles, /\.scene-view-preview\.running \{[^}]*display:grid;[^}]*place-items:center;/u);
  assert.match(styles, /\.scene-view-generation-grid \{[^}]*width:min\(420px,72%\);[^}]*grid-template-columns:1fr 1fr;[^}]*grid-template-rows:1fr 1fr;/u);
  assert.match(styles, /@keyframes scene-view-angle-focus/u);
  assert.match(styles, /@keyframes scene-view-angle-outline/u);
  assert.match(styles, /@keyframes scene-view-track/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\) \{ \.scene-view-generation-grid/u);
});

test('empty prop stage uses a compact inline status instead of a second placeholder card', () => {
  assert.match(source, /className=\{`prop-stage-inline-status \$\{propStatus\}/u);
  assert.match(source, /未发现需要独立制作的道具/u);
  assert.doesNotMatch(source, /<NodeCard nodeId="prop-stage"/u);
  assert.match(styles, /\.prop-stage-inline-status \{[^}]*position:absolute;[^}]*width:600px;[^}]*min-height:78px;/u);
});

test('prop proposal refresh keeps the last usable proposal actionable when replacement fails', () => {
  assert.match(source, /const hasReusableProposals = propProposals\.length > 0/u);
  assert.match(source, /setPropStatus\(hasReusableProposals \? "complete" : "failed"\)/u);
  assert.match(source, /if \(Array\.isArray\(saved\.propProposals\) && saved\.propProposals\.length > 0\) \{ setPropStatus\("complete"\)/u);
  assert.match(source, /disabled=\{propProposalApproval !== "approved"\} onClick=\{\(\) => onRegenerateProp/u);
});

test('task status opens into a real list of current parallel work', () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(false\)/u);
  assert.match(source, /characterImageRequestCount=\{characterImageRequestKeys\.length\}/u);
  assert.match(source, /sceneViewRunningCount=\{sceneViews\.filter\(\(item\) => item\.status === "running"\)\.length\}/u);
  assert.match(source, /h3RunningCount=\{shotVideoTasks\.filter/u);
  assert.match(source, /aria-label=\{expanded \? "收起任务列表" : "展开任务列表"\}/u);
  assert.match(source, /aria-expanded=\{expanded\} aria-controls="task-status-detail" onClick=\{\(\) => setExpanded/u);
  assert.match(source, /className="task-status-detail" id="task-status-detail"/u);
  assert.match(source, /activeTasks\.map\(\(task\) => <li key=\{task\.key\}>/u);
  assert.match(styles, /\.task-status-detail \{[^}]*border-top:1px solid rgba\(255,255,255,\.06\);/u);
  assert.match(styles, /\.task-status-detail ul \{[^}]*max-height:244px;[^}]*overflow:auto;/u);
  assert.match(styles, /\.task-status\.expanded \{[^}]*border-color:rgba\(221,110,170,\.3\);/u);
});

test('character copy moves above a larger main image and both assets open the image viewer', () => {
  assert.match(source, /<div className="character-result-copy">[\s\S]*<\/div>\s*<div className="character-result-layout">/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-node > \.node-head,[^}]*\.character-result-node > \.character-result-copy \{ grid-column:1\/-1; \}/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-layout \{[^}]*grid-column:1;[^}]*grid-row:4;[^}]*display:block;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-copy > strong,[^}]*white-space:normal;[^}]*overflow-wrap:anywhere;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-result-copy p \{[^}]*-webkit-line-clamp:2;/u);
  assert.match(source, /onViewImage\(image\.imageUrl!, `\$\{profile\.name\} · 角色主图`\)/u);
  assert.match(source, /onViewImage\(turnaround\.imageUrl!, `\$\{profile\.name\} · 角色三视图`\)/u);
  assert.match(source, /查看角色主图大图/u);
  assert.match(source, /查看角色三视图大图/u);
});

test('right canvas control opens a real cross-project asset library with direct upload and management', () => {
  assert.match(source, /<CanvasTools onOpenAssets=\{\(\) => setAssetLibraryOpen\(true\)\}/u);
  assert.match(source, /GLOBAL ASSET LIBRARY/u);
  assert.match(source, /\/api\/asset-library\/use/u);
  assert.match(source, /\/api\/free-canvas\/imports/u);
  assert.match(source, /\/api\/asset-library\/folders/u);
  assert.match(source, /上传资产/u);
  assert.match(source, /新建文件夹/u);
  assert.match(source, /收藏/u);
  assert.match(source, /添加参考图/u);
  assert.match(source, /可同时上传多张参考图，第一张作为封面/u);
  assert.doesNotMatch(source, /最多10张参考图/u);
  assert.doesNotMatch(source, /超过4张/u);
  assert.doesNotMatch(source, /最多使用3张图片参考/u);
  assert.match(source, /已保存到人物库/u);
  assert.match(source, /setVideoPrompts\(\(current\) => current\.map\(\(item\) => item\.status === "failed" \? item : \{ \.\.\.item, status: "stale", approval: "draft" \}\)\)/u);
  assert.match(source, /roughCut: current\.roughCut\.status === "complete" \? \{ \.\.\.current\.roughCut, status: "stale" \}/u);
  assert.match(styles, /\.canvas-tools \.asset-library-trigger \{[^}]*width:82px;/u);
  assert.match(styles, /\.asset-library-body \{[^}]*min-height:0;[^}]*grid-template-columns:minmax\(0,1fr\) 420px;/u);
});

test('asset library enters from the right and closes after clicking the left backdrop', () => {
  assert.match(source, /className=\{`asset-library-backdrop \$\{closing \? "closing" : ""\}`\}/u);
  assert.match(source, /if \(event\.target === event\.currentTarget\) requestClose\(\)/u);
  assert.match(source, /closeTimerRef\.current = window\.setTimeout\(onClose, 320\)/u);
  assert.match(source, /event\.key === "Escape"/u);
  assert.match(styles, /@keyframes asset-library-drawer-in \{ from \{[^}]*translateX\(calc\(100% \+ 28px\)\)/u);
  assert.match(styles, /\.asset-library-backdrop\.closing \.asset-library-modal \{ animation:asset-library-drawer-out/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
});

test('canvas heading follows the selected production stage instead of staying on character handoff text', () => {
  assert.match(source, /stageForWorkspaceSection\(activeStage as WorkspaceSection, workflowSnapshot\)/u);
  assert.match(source, /const canvasWorkflowView = toStageViewModel/u);
  assert.match(source, /const canvasStatusText = assetStageVisible \? canvasWorkflowView\.summaryZh/u);
  assert.match(source, /const canvasStatusConfirmed = assetStageVisible \? canvasWorkflowView\.isResolved/u);
  assert.match(source, /<ConfirmedIndicator label=\{canvasStatusText\} \/>/u);
  assert.match(source, /canvasStatusPending \? "amber-dot" : "green-dot"/u);
  assert.doesNotMatch(source, /const canvasStatusByStage/u);
});

test('confirmed canvas nodes use a compact dot instead of repeating status copy', () => {
  assert.match(source, /function isConfirmedNodeStatus\(status: string\)/u);
  assert.match(source, /已确认\|已批准\|已完成\|已用于\|已跳过\|已留存\|已记录/u);
  assert.match(source, /function ConfirmedIndicator/u);
  assert.match(source, /<ConfirmedIndicator label=\{status\} className="node-status" \/>/u);
  assert.match(source, /<ConfirmedIndicator label=\{canvasStatusText\} \/>/u);
  assert.match(source, /<ConfirmedIndicator label="已留存" className="history-confirmed" \/>/u);
  assert.match(styles, /\.confirmed-indicator \{[^}]*width:16px;[^}]*border-radius:50%;[^}]*background:transparent;/u);
  assert.match(styles, /\.confirmed-indicator-dot \{[^}]*width:6px;[^}]*border-radius:50%;[^}]*background:currentColor;/u);
});

test('studio preview uses readable confirmation marks and quiet media placeholders', () => {
  assert.match(styles, /\.director-ui-studio \.confirmed-indicator-dot::before \{[^}]*content: "✓";/u);
  assert.match(styles, /\.director-ui-studio \.node-status\.confirmed-indicator::after \{[^}]*content: "已确认";/u);
  assert.match(styles, /\.director-ui-studio \.node-effect-confirmed \.node-status\.confirmed-indicator::before \{[^}]*display: none;/u);
  assert.match(styles, /\.canvas-mode-director\.director-ui-studio :is\(\.scene-empty-frame, \.prop-empty-frame, \.storyboard-empty-frame\)::before/u);
  assert.match(styles, /\.canvas-mode-director\.director-ui-studio :is\(\.scene-empty-frame, \.prop-empty-frame, \.storyboard-empty-frame\) \{[^}]*border: 0;[^}]*border-top: 1px solid[^}]*background: transparent;/u);
  assert.match(styles, /\.canvas-mode-director\.director-ui-studio :is\(\.scene-empty-frame, \.prop-empty-frame, \.storyboard-empty-frame\)::before \{[^}]*display: none;/u);
  assert.match(source, /sceneStageSkipped \? "本片不建立固定场景"/u);
  assert.match(source, /sceneStageSkipped \? "已跳过"/u);
});

test('storyboard image generation morphs one container through work and result states', () => {
  assert.match(source, /const imageState = isQueued \? "queued" : isRunning \? "generating" : hasCandidates \? "selection" : hasImage \? "ready"/u);
  assert.match(source, /data-generation-state=\{imageState\}/u);
  assert.match(source, /aria-live="polite"/u);
  assert.doesNotMatch(styles, /\.storyboard-segment-node \{[^}]*transition:height/u);
  assert.match(source, /new ResizeObserver\(measure\)/u);
  assert.match(styles, /\.storyboard-media-panel\.state-generating \.storyboard-board-frame::before/u);
  assert.match(source, /className="storyboard-generation-grid" data-panel-count=\{panelCount\}[^]*Array\.from\(\{ length: panelCount \}/u);
  assert.match(source, /逐格构图 · 校对人物、场景与动作连续性/u);
  assert.match(styles, /\.storyboard-generation-grid \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /storyboard-generation-grid\[data-panel-count="3"\][^}]*grid-template-rows:1fr/u);
  assert.match(styles, /storyboard-generation-grid\[data-panel-count="4"\][^}]*repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(styles, /storyboard-generation-grid\[data-panel-count="9"\][^}]*repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /@keyframes storyboard-cell-develop/u);
  assert.match(styles, /@keyframes storyboard-grid-scan/u);
  assert.match(styles, /@keyframes storyboard-track-travel/u);
  assert.match(styles, /@keyframes storyboard-result-image/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
});

test('saved image moderation errors are localized with a manual correction suggestion', () => {
  assert.match(source, /function localizeStoredImageError/u);
  assert.match(source, /moderation_blocked[\s\S]*?安全审核拦截[\s\S]*?处理建议[\s\S]*?非接触、非伤害/u);
  assert.match(source, /const restoredStoryboardBoards =[\s\S]*?localizeStoredImageError\(item\.error\)/u);
  assert.match(source, /setStoryboardBoards\(restoredStoryboardBoards\)/u);
});

test('storyboard image and video pages use directional sliding with zoom-safe type', () => {
  assert.match(source, /storyboard-media-tabs showing-\$\{mediaType\}/u);
  assert.match(source, /storyboard-media-page storyboard-media-page-\$\{mediaType\}/u);
  assert.match(styles, /\.storyboard-media-tabs\.showing-video::before \{ transform:translateX\(var\(--media-tab-width\)\); \}/u);
  assert.match(styles, /@keyframes storyboard-page-from-left/u);
  assert.match(styles, /@keyframes storyboard-page-from-right/u);
  assert.match(styles, /\.storyboard-segment-node h3 \{ font-size:30px; \}/u);
  assert.match(styles, /\.storyboard-video-primary-actions button,[^}]*font-size:17px;/u);
  assert.match(source, /shot-continuity-control mode-\$\{selectedMode\}/u);
  assert.match(styles, /\.shot-continuity-control\.mode-continue > div::before \{[^}]*transform:translateX\(100%\)/u);
  assert.match(styles, /\.storyboard-segment-node \.video-prompt-ready \{[^}]*border:0;[^}]*background:#141416;/u);
  assert.match(styles, /\.storyboard-segment-node \.shot-video-meta span \{[^}]*background:transparent;/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[^]*\.shot-continuity-control > div::before/u);
  assert.match(source, /videoPrompt\?\.status === "running" \? "video-prompt-updating"/u);
  assert.match(source, /className="video-prompt-running-banner" role="status" aria-live="polite"/u);
  assert.match(source, /正在修复 \$\{segment\.segmentKey\} 视频提示词/u);
  assert.match(styles, /\.storyboard-segment-node\.video-prompt-updating[^}]*animation:video-prompt-card-border 1\.7s/u);
  assert.match(styles, /@keyframes video-prompt-running-dot/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[^]*\.video-prompt-running-banner > span i/u);
  assert.doesNotMatch(source, /确认提示词后可生成视频/u);
  assert.doesNotMatch(source, /点击下方按钮即可查看或编辑；全部确认后开放H3提交/u);
  assert.match(source, /<section key=\{segment\.segmentKey\} className=\{task\?\.status \|\| "idle"\}><header>/u);
  assert.match(styles, /\.local-video-generation-step \.video-generation-list section[^}]*display:grid;[^}]*border-radius:0;[^}]*background:transparent;/u);
  assert.match(styles, /\.local-video-generation-step \.video-generation-list section[^}]*width:100%;[^}]*grid-template-columns:minmax\(0,1fr\);[^}]*justify-content:stretch;/u);
  assert.match(styles, /\.local-video-generation-step \.video-generation-list section > header \{[^}]*grid-template-columns:minmax\(0,1fr\) auto;/u);
  assert.match(styles, /\.local-video-generation-step \.shot-continuity-control\.compact > div \{[^}]*width:100%;[^}]*grid-template-columns:1fr 1fr;/u);
  assert.match(styles, /\.local-video-generation-step \.shot-continuity-control\.compact button,[^}]*width:100%;/u);
  assert.match(styles, /\.shot-continuity-control\.compact\.mode-continue > div::before \{[^}]*transform:translateX\(100%\)/u);
  assert.match(styles, /\.local-video-generation-step \.video-settings-reminder small \{[^}]*display:none;/u);
});

test('H3 generation uses a large frame-sequence motion state instead of a small spinner', () => {
  assert.match(source, /const h3Generating = Boolean\(task && \["submitting", "queued", "running"\]\.includes\(task\.status\)\)/u);
  assert.match(source, /className=\{`shot-video-generating \$\{task\?\.status \|\| "running"\}`\} role="status" aria-live="polite"/u);
  assert.match(source, /className="shot-video-generation-stage"[^]*Array\.from\(\{ length: 3 \}/u);
  assert.match(source, /正在逐帧生成镜头，完成后会在这里直接显示视频/u);
  assert.match(styles, /\.shot-video-generation-visual \{[^}]*width:min\(390px,86%\)/u);
  assert.match(styles, /\.shot-video-generation-stage \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/u);
  assert.match(styles, /@keyframes shot-video-frame-develop/u);
  assert.match(styles, /@keyframes shot-video-scan/u);
  assert.match(styles, /@keyframes shot-video-track-travel/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^]*\.shot-video-generating::before/u);
});

test('video prompt batches expose per-segment progress and repair content validation failures only once', () => {
  assert.match(source, /function areAllVideoPromptsComplete\(segments: StoryboardSegment\[\], prompts: VideoPromptResult\[\]\)/u);
  assert.match(source, /areAllVideoPromptsComplete\(restoredStoryboardSegments, restoredVideoPrompts\)/u);
  assert.match(source, /const complete = areAllVideoPromptsComplete\(storyboardSegments, updatedPrompts\)/u);
  assert.match(source, /setVideoPromptStatus\(complete \? "complete" : "failed"\)/u);
  assert.match(source, /setVideoPromptError\(complete \? "" : currentVideoPromptProblemSummary/u);
  assert.match(source, /return !current\?\.prompt\.trim\(\) \|\| current\.status === "stale"/u);
  assert.match(source, /生成缺失的 \{missingCount\} 段/u);
  assert.doesNotMatch(source, /missingRequestCount/u);
  assert.match(source, /问题已按分段列出；已完成段落不会被重写/u);
  assert.match(source, /status: "running" \| "complete" \| "needs_revision"/u);
  assert.match(source, /让 Agent 修复本段/u);
  assert.match(source, /查看 \/ 编辑视频提示词/u);
  assert.match(source, /重新生成本段提示词/u);
  assert.match(source, /function regenerateVideoPromptInEditor\(segmentKey: string\)/u);
  assert.match(source, /const regenerated = await generateVideoPrompts\(\[segmentKey\]\)/u);
  assert.match(source, /if \(next && videoPromptEditorKeyRef\.current === segmentKey\) setVideoPromptEditorText\(next\.prompt\)/u);
  assert.match(source, /新提示词生成未完成/u);
  assert.match(source, /当前显示并保留的是上一次可用提示词/u);
  assert.match(source, /完成后会直接更新下方提示词/u);
  assert.match(source, /保存并重新生成本段视频/u);
  assert.match(source, /saveVideoPromptAndGenerate/u);
  assert.match(source, /function closeVideoPromptEditor\(\)/u);
  assert.match(source, /edited !== current\.prompt\) updateVideoPrompt/u);
  assert.match(source, /onClose=\{closeVideoPromptEditor\}/u);
  assert.doesNotMatch(source, />仅保存视频提示词</u);
  assert.match(source, /关闭窗口时会自动保存实际修改/u);
  assert.match(source, /promptOverride \? \{ videoPrompts: availablePrompts, videoPromptsApproval: promptApproval \} : \{\}/u);
  assert.doesNotMatch(source, /最多2次文字API/u);
  assert.match(source, /查看自动校正前的草稿与首轮问题/u);
  assert.match(source, /function normalizeStoredVideoPromptResult/u);
  assert.match(source, /replaceAll\("undefined宫格", storyboardBoardLabel\(panelCount\)\)/u);
  assert.match(source, /<StageFeedback messages=\{result.validationWarnings\}/u);
  assert.match(source, /<StageFeedback messages=\{prompt.validationWarnings\}/u);
  assert.match(styles, /\.video-prompt-repair-history/u);
  assert.match(styles, /\.video-prompt-regeneration-error/u);
  assert.doesNotMatch(source, /只有ID、剧情事实、对白、顺序或时长等必要校验失败时/u);
  assert.doesNotMatch(source, /节奏、措辞和密度只显示建议，不占修复调用/u);
  assert.doesNotMatch(source, /校验失败段只自动校正一次/u);
  assert.match(source, /onRegenerate=\{\(\) => void regenerateVideoPromptInEditor\(videoPromptEditorKey\)\}/u);
  assert.match(source, /videoPrompt\?\.status === "running"\) return "视频提示词生成中"/u);
  assert.match(source, /videoPrompt\?\.status === "running" && hasVideoWorkspace\) setMediaType\("video"\)/u);
  assert.match(source, /className="video-prompt-generation" role="status"/u);
  assert.match(source, /本次生成内完成自检；返回后可查看、编辑或局部修改/u);
  assert.match(source, /disabled=\{promptGenerating && !hasPrompt\}/u);
  assert.match(styles, /\.video-prompt-generation-sheet/u);
  assert.match(styles, /@keyframes video-prompt-line/u);
  assert.match(styles, /@keyframes video-prompt-scan/u);
  assert.match(styles, /\.video-prompt-problem-list/u);
  assert.match(styles, /\.video-prompt-card-issues/u);
  assert.match(source, /查看上次处理详情/u);
  assert.match(source, /\/api\/videos\/prompts\/repair/u);
  assert.match(source, /onRepairPrompt=\{onRepairVideoPrompt\}/u);
  assert.match(source, /function repairVideoPrompts\(segmentKeys: string\[\]\)/u);
  assert.match(source, /让 Agent 修复 \{revisionCount\} 个问题段/u);
  assert.doesNotMatch(source, /重新生成全部 \{segments\.length\} 段/u);
  assert.doesNotMatch(source, /allPromptsReady/u);
  assert.match(source, /const canGenerateCurrentSegment = Boolean\(value.trim\(\)\)/u);
  assert.match(styles, /\.video-prompt-validation/u);
  assert.match(styles, /\.video-prompt-validation\.advisory/u);
  assert.match(styles, /\.video-prompt-card-advisory/u);
  assert.match(source, /<section className="character-prompt-modal prompt-editor-modal"[^>]*aria-label="角色图片提示词"/u);
  assert.match(source, /<section className="character-prompt-modal prompt-editor-modal"[^>]*aria-label="场景图片提示词"/u);
  assert.match(source, /<section className="character-prompt-modal prompt-editor-modal"[^>]*aria-label="道具图片提示词"/u);
  assert.match(source, /<section className="character-prompt-modal prompt-editor-modal"[^>]*aria-label="故事板图片提示词"/u);
  assert.match(styles, /\.prompt-editor-modal textarea::-webkit-scrollbar-thumb/u);
  assert.match(styles, /\.prompt-editor-actions \{ grid-template-columns:/u);
  assert.match(styles, /\.video-prompt-modal-actions \{ grid-template-columns:minmax\(0,\.85fr\) minmax\(0,1\.15fr\); \}/u);
  assert.match(source, /className="video-prompt-modal-body"/u);
  assert.match(styles, /\.video-prompt-modal \{[^}]*height:calc\(100vh - 56px\)[^}]*grid-template-rows:auto minmax\(0,1fr\) auto auto;[^}]*overflow:hidden;/u);
  assert.match(styles, /\.video-prompt-modal-body \{[^}]*min-height:0;[^}]*overflow-y:auto;[^}]*overflow-x:hidden;/u);
  assert.match(styles, /\.video-prompt-modal-body textarea \{[^}]*height:clamp\(360px,52vh,620px\);[^}]*max-height:none;/u);
  assert.doesNotMatch(styles, /\.video-prompt-modal textarea \{ min-height:480px;/u);
});

test('canvas motion effects are state-driven, lightweight and motion-safe', () => {
  assert.match(source, /function ThinkingOrbs/u);
  assert.match(source, /function MusicThinkingWave/u);
  assert.match(source, /prompt\.status === "running" \? <MusicThinkingWave \/> : <span>♪<\/span>/u);
  assert.match(source, /function CanvasProgressEffect/u);
  assert.match(source, /function canvasNodeEffect/u);
  assert.match(source, /data-effect-state=\{effect\}/u);
  assert.match(source, /<CanvasProgressEffect completed=\{readyCount\}/u);
  assert.match(styles, /\.thinking-orbs i \{[^}]*animation:thinking-orb-wave/u);
  assert.match(styles, /\.music-thinking-wave i \{[^}]*animation:music-thinking-wave/u);
  assert.match(styles, /\.music-progress-track i \{[^}]*animation:music-progress-runner/u);
  assert.match(styles, /\.music-generation-progress li\.active > i \{[^}]*animation:music-progress-dot/u);
  assert.match(styles, /\.node-effect-active \.node-motion-effect::after,\.node-effect-active \.node-motion-effect i \{ display:none; \}/u);
  assert.match(styles, /\.node-motion-effect \{[^}]*pointer-events:none;/u);
  assert.match(styles, /\.node-effect-result \.node-motion-effect::before/u);
  assert.match(styles, /\.node-effect-confirmed \.node-status\.confirmed-indicator::before \{[^}]*left:50%;[^}]*top:50%;[^}]*transform:translate\(-50%,-50%\);/u);
  assert.match(styles, /\.canvas-generation-progress\.active > i em/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.music-progress-track i,[\s\S]*animation:none !important;/u);
});

test('project switcher shows the real project and flushes local state before create or select', () => {
  assert.match(source, /<Header projectName=\{projectName\} saveStatus=\{sessionSaveStatus\}/u);
  assert.match(source, /className=\{`project-pill save-\$\{saveStatus\}`\}/u);
  assert.match(source, /className="header-project-name">\{projectName\}<\/span><i aria-hidden="true" \/>\{saveLabel\}/u);
  assert.match(source, /async function persistCurrentProject/u);
  assert.match(source, /async function createProject\(\)[\s\S]*?await persistCurrentProject\(\);[\s\S]*?\/api\/projects\/create/u);
  assert.match(source, /async function selectProject\(id: string\)[\s\S]*?await persistCurrentProject\(\);[\s\S]*?\/api\/projects\/select/u);
  assert.match(source, /先完整保存当前画布，再开始一条新的创作流程/u);
  assert.match(styles, /\.project-identity strong \{[^}]*text-overflow:ellipsis/u);
  assert.match(styles, /@keyframes project-save-pulse/u);
});

test('revision conflicts synchronize the latest project and discard stale queued saves without retrying the action', () => {
  assert.match(source, /class CreativeSessionSynchronizedError extends Error/u);
  assert.match(source, /const sessionSaveEpoch = useRef\(0\)/u);
  assert.match(source, /const saveEpoch = sessionSaveEpoch\.current;[\s\S]*?if \(saveEpoch !== sessionSaveEpoch\.current\) return;/u);
  assert.match(source, /response\.status === 409 && body\.code === "creative_session_revision_conflict" && body\.session/u);
  assert.match(source, /sessionSaveEpoch\.current \+= 1;[\s\S]*?applyCreativeSession\(body\.session\);[\s\S]*?throw new CreativeSessionSynchronizedError\(\)/u);
  assert.doesNotMatch(source, /creative_session_revision_conflict[\s\S]{0,500}postWorkflowRequest/u);
});

test('project name is editable and synchronized across the script, detail modal, header, and project manager', () => {
  assert.match(source, /type CreativeSessionState = \{\s*step: SetupStep;\s*projectName: string;/u);
  assert.match(source, /function EditableProjectName/u);
  assert.match(source, /className="script-draft-project-name"/u);
  assert.match(source, /className="script-modal-project-title"/u);
  assert.match(source, /async function renameCurrentProject/u);
  assert.match(source, /\/api\/projects\/rename/u);
  assert.match(source, /aria-label=\{`\$\{project\.name\}项目名`\}/u);
  assert.match(source, /className="project-name-edit-button" aria-label="修改项目名" data-tooltip="修改"/u);
  assert.match(source, /inputRef\.current\?\.select\(\)/u);
  assert.match(styles, /\.editable-project-name input/u);
  assert.match(styles, /\.editable-project-name\.is-editing \.project-name-edit-button/u);
  assert.match(styles, /\.project-name-edit-button:hover::after/u);
  assert.match(styles, /\.project-list article > div > input/u);
});

test('initial project hydration cannot persist default state over the loaded project', () => {
  assert.match(source, /const \[sessionSaveReady, setSessionSaveReady\] = useState\(false\)/u);
  assert.match(source, /applyCreativeSession\(body\.session\);[\s\S]*?setSessionSaveReady\(true\)/u);
  assert.match(source, /if \(!sessionSaveReady \|\| characterRosterBusy\) return;[\s\S]*?persistCurrentProject\(state\)/u);
  assert.doesNotMatch(source, /if \(!sessionHydrated\) return;\s*const state = creativeStateSnapshot\(\)/u);
});

test('topbar replaces publishing placeholders with an honest animated H3 launcher', () => {
  assert.doesNotMatch(source, /className="safe-badge">本地草稿/u);
  assert.doesNotMatch(source, /className="publish-button"/u);
  assert.match(source, /className=\{`h3-launcher h3-\$\{state\}`\}/u);
  assert.match(source, /视频后端已就绪/u);
  assert.match(source, /视频后端未启动/u);
  assert.match(source, /启动并连接/u);
  assert.match(source, /打开 H3 工作台/u);
  assert.match(source, /ComfyUI 网页不弹出/u);
  assert.match(source, /window\.setInterval\(\(\) => void refreshH3Status\(true\), 3000\)/u);
  assert.match(source, /h3ConnectInFlight/u);
  assert.doesNotMatch(source, /window\.setTimeout\(\(\) => void refreshH3Status\(true\), 2500\)/u);
  assert.match(source, /localGpuActive/u);
  assert.match(source, /本机GPU已进入独占任务/u);
  assert.match(styles, /\.h3-status-popover/u);
  assert.match(styles, /@keyframes h3-edge-scan/u);
  assert.match(styles, /@keyframes h3-ready-pulse/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.h3-launcher::before/u);
});

test('character images are generated per profile and become automatic downstream references', () => {
  assert.match(source, /onSkipCharacterProfiles=\{skipCharacterProfiles\}/u);
  assert.doesNotMatch(source, /onToggleCharacterAssetProfile/u);
  assert.match(source, /onGenerateCharacterImage=\{\(profileKey\) => void generateCharacterImages\(\[profileKey\]\)\}/u);
  assert.match(source, /生成角色图/u);
  assert.match(source, /已作为图片参考/u);
  assert.match(source, /使用完整文字设定/u);
  assert.match(source, /characterImageRequestKeysRef\.current\.add\(profileKey\)/u);
  assert.match(source, /!characterImageRequestKeysRef\.current\.has\(profile\.profileKey\)/u);
  assert.match(source, /setCharacterImages\(\(current\) => \{/u);
  assert.match(source, /setCharacterAssetProfileKeys\(\(current\) => \{/u);
  assert.match(source, /className="generate-character-reference" disabled=\{!selectedStyle \|\| generating\}/u);
  assert.match(source, /className="canvas-character-generate" disabled=\{!selectedStyle\}/u);
  assert.match(source, /onClick=\{\(\) => onRegenerateImage\(profile\.profileKey\)\}/u);
  assert.match(source, /className="character-image-generating" role="status"/u);
  assert.match(source, /className="character-generation-stage character-main-generation-stage"/u);
  assert.match(source, /src="\/assets\/ui\/character-generation-loading-v1\.png"/u);
  assert.match(source, /人物形象正在成形/u);
  assert.match(source, /className="character-image-regenerating" role="status"/u);
  assert.match(source, /className="character-image-generating character-turnaround-generating" role="status"/u);
  assert.match(source, /className="character-generation-stage character-turnaround-generation-stage"/u);
  assert.match(source, /src="\/assets\/ui\/character-turnaround-loading-v1\.png"/u);
  assert.match(styles, /\.canvas-character-generate/u);
  assert.match(styles, /@keyframes character-develop-scan/u);
  assert.match(styles, /\.character-generation-stage:not\(\.character-turnaround-generation-stage\) \{[^}]*animation:none/u);
  assert.match(styles, /\.character-generation-stage:not\(\.character-turnaround-generation-stage\)::after,[^{]+\{ display:none/u);
  assert.match(styles, /\.character-main-generation-stage \{[^}]*width:min\(500px,88%\)!important;[^}]*aspect-ratio:3\/2/u);
  assert.match(styles, /\.character-main-generation-stage > img \{[^}]*object-fit:cover/u);
  assert.match(styles, /\.character-image-generating:not\(\.character-turnaround-generating\) > \.character-generation-track > i \{[^}]*animation-duration:2\.15s/u);
  assert.match(styles, /\.character-turnaround-generation-stage > img \{[^}]*object-fit:contain/u);
  assert.match(styles, /\.character-turnaround-generating > strong \{[^}]*font-size:15px/u);
  assert.match(styles, /\.character-turnaround-generating > \.character-generation-track \{[^}]*margin-top:6px/u);
  assert.doesNotMatch(styles, /\.character-turnaround-preview\.running \{[^}]*animation:/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\) \{ \.character-generation-stage/u);
  assert.doesNotMatch(source, /profiles: characterProfiles\.filter\(\(profile\) => characterAssetProfileKeys/u);
  assert.doesNotMatch(source, /requestedProfiles\.length === 0 \|\| characterImageStatus === "running"/u);
  assert.match(source, /className="remove-character"/u);
  assert.match(source, /本片无固定人物，跳过角色档案/u);
  assert.doesNotMatch(source, /每个画面角色都会保留完整文字设定/u);
});

test('optional short-video stages can be skipped in favor of prompt-first direct H3 generation', () => {
  assert.match(source, /function DirectVideoChoice/u);
  assert.match(source, /"直接生成视频"/u);
  assert.doesNotMatch(source, /会先调用一次文字 Agent 生成并保存完整视频提示词/u);
  assert.match(source, /async function generateDirectVideo\(\)/u);
  assert.match(source, /kind: "video", prompt: directVideoPromptSource\(ideaScript\)/u);
  assert.match(source, /videoPromptsApproval: "approved"/u);
  assert.match(source, /mode: "text"/u);
  assert.match(source, /本机PRISM H3当前未连接，已停在视频生成页等待启动/u);
  assert.match(source, /跳过角色图片，进入场景设计/u);
  assert.match(source, /跳过道具图片，进入分镜设计/u);
  assert.doesNotMatch(localApi, /分镜设计至少需要一个已确认场景文字设定/u);
  assert.match(localApi, /sceneAsset\?\.sceneAssetKey \|\| `text-scene-\$\{segment\.sceneKey\}`/u);
  assert.match(localApi, /不使用固定角色、场景或道具资产，以已确认剧本和文字分镜为准/u);
  assert.doesNotMatch(source, /自动重试直接生成/u);
});

test('prop review batches the accepted custom selection without regenerating completed work', () => {
  const propReview = source.slice(source.indexOf('function PropDesignStep'), source.indexOf('function StoryboardDesignStep'));
  assert.match(propReview, /readyToGeneratePropKeys/u);
  assert.match(propReview, /const productionProposals = proposals\.filter/u);
  assert.match(propReview, /AssetBatchActions label="道具"/u);
  assert.match(propReview, /其余物品保留文字设定并随分镜生成/u);
  assert.match(propReview, /onGenerateBatch\(true\)/u);
  assert.match(propReview, /!completedImageKeys\.has\(proposal\.propAssetKey\) && !runningImageKeys\.has\(proposal\.propAssetKey\)/u);
});

test('left Agent keeps workflow history in project data without rendering the verbose log', () => {
  assert.doesNotMatch(source, /className="agent-workflow-history"/u);
  assert.doesNotMatch(source, />完整运行记录</u);
  assert.doesNotMatch(source, /可以先改为 10 秒或 15 秒/u);
  assert.doesNotMatch(source, /本次失败、所选时长和错误已经留在完整记录中/u);
  assert.match(source, /workflow: WorkflowSnapshot/u);
  assert.match(source, /setWorkflowSnapshot\(body\.session\.workflow\)/u);
});

test('free-canvas node and reference copy remains readable at zoomed-out working scales', () => {
  assert.match(styles, /\.free-node-text-preview \{[^}]*max-height:none;[^}]*overflow-y:auto;[^}]*padding:0 6px 0 0;[^}]*border-radius:0;[^}]*background:transparent;[^}]*font-size:14px;[^}]*line-height:1\.55;/u);
  assert.match(styles, /\.free-node\.kind-text \{[^}]*background:#2b2b2e;/u);
  assert.match(styles, /\.free-node-face:has\(\.free-node-text-preview\) \{[^}]*height:220px;[^}]*padding:22px 18px 18px 20px;[^}]*overflow:hidden;/u);
  assert.match(styles, /\.free-node-face > small \{\s*font-size:12px;/u);
  assert.match(styles, /\.free-node-face li \{\s*font-size:12px;/u);
  assert.match(styles, /\.free-node-editor > header \{\s*font-size:12px;/u);
  assert.match(styles, /\.free-node-reference-panel > header,[\s\S]*font-size:11px;/u);
  assert.match(styles, /\.free-node-reference-panel > header small \{\s*font-size:10px;/u);
  assert.match(styles, /\.free-node-editor \.free-node-url \{[\s\S]*font-size:12px;/u);
});

test('free-canvas image settings close after a pointer starts outside the parameter panel', () => {
  assert.match(freeCanvas, /const imageSettingsRef = useRef<HTMLDivElement \| null>\(null\)/u);
  assert.match(freeCanvas, /document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/u);
  assert.match(freeCanvas, /imageSettingsRef\.current\?\.contains\(target\)/u);
  assert.match(freeCanvas, /className="free-node-image-settings" ref=\{imageSettingsRef\}/u);
});

test('scene and prop images follow the per-card optional reference workflow', () => {
  assert.match(source, /sceneImageRequestKeysRef\.current\.add\(sceneAssetKey\)/u);
  assert.match(source, /propImageRequestKeysRef\.current\.add\(propAssetKey\)/u);
  assert.match(source, /!sceneImageRequestKeysRef\.current\.has\(proposal\.sceneAssetKey\)/u);
  assert.match(source, /!propImageRequestKeysRef\.current\.has\(proposal\.propAssetKey\)/u);
  assert.doesNotMatch(source, /sceneProposalApproval !== "approved" \|\| sceneImageStatus === "running"/u);
  assert.doesNotMatch(source, /propProposalApproval !== "approved" \|\| propImageStatus === "running"/u);
  assert.match(source, /生成场景图/u);
  assert.match(source, /生成道具图/u);
  assert.match(source, /propAssetRecommendation\(proposal\) !== "text_only"/u);
  assert.match(source, /按需生成道具图/u);
  assert.match(source, /当前失败记录缺少可定位诊断；剧本与场景资产已保留，系统未自动重试。后续请求会显示具体失败环节。/u);
  assert.match(source, /className="character-generation-stage scene-generation-stage"/u);
  assert.match(source, /src="\/assets\/ui\/scene-generation-loading-v1\.png"/u);
  assert.match(styles, /\.scene-generation-stage \{[^}]*width:280px!important;[^}]*height:158px!important/u);
  assert.match(styles, /\.scene-generation-stage > img \{[^}]*object-fit:cover/u);
  assert.match(source, /className="character-generation-stage prop-generation-stage"/u);
  assert.match(source, /src="\/assets\/ui\/prop-generation-loading-v1\.png"/u);
  assert.match(source, /className="character-image-placeholder prop-image-placeholder"/u);
  assert.match(source, /className="prop-generation-preview" src="\/assets\/ui\/prop-generation-loading-v1\.png"/u);
  assert.match(styles, /\.prop-generation-stage \{[^}]*width:min\(520px,94%\)!important;[^}]*aspect-ratio:3\/2/u);
  assert.match(styles, /\.prop-generation-stage > img \{[^}]*object-fit:cover/u);
  assert.match(styles, /\.prop-image-placeholder > \.prop-generation-preview \{[^}]*width:100%;[^}]*height:100%;[^}]*object-fit:cover/u);
  assert.match(styles, /\.prop-image-placeholder-copy \{[^}]*width:100%;[^}]*min-height:42%/u);
  assert.match(source, /可一键生成已选场景主图，也可在右侧逐张调整/u);
  assert.match(source, /右侧只显示已选资产，其余物品保留文字设定并随分镜生成/u);
  assert.doesNotMatch(source, /可以不生成、只生成一部分或全部生成/u);
  assert.doesNotMatch(source, /生成提示词与场景主图 · 调用文字与图片API/u);
  assert.doesNotMatch(source, /生成提示词与道具主图 · 调用文字与图片API/u);
  assert.match(source, /busy=\{sceneImageRequestKeys\.includes\(scenePromptEditorKey\)\}/u);
  assert.match(source, /busy=\{propImageRequestKeys\.includes\(propPromptEditorKey\)\}/u);
  assert.match(source, /return \{ sceneAssetKey: proposal\.sceneAssetKey, name: proposal\.name, status: "failed" as const, error: message \}/u);
  assert.match(source, /return \{ propAssetKey: proposal\.propAssetKey, name: proposal\.name, status: "failed" as const, error: message \}/u);
});

test('fixed scene assets use an Agent recommendation before the user continues', () => {
  assert.match(source, /sceneAssetsSkipped: boolean/u);
  assert.match(source, /function skipSceneAssets\(\)/u);
  assert.match(source, /onSkipSceneAssets=\{skipSceneAssets\}/u);
  assert.match(source, /Agent 将先判断场景资产需求/u);
  assert.match(source, /Agent 建议保留 \$\{selectedKeys\.length\} 个固定场景/u);
  assert.match(source, /aria-label="自定义固定场景"/u);
  assert.match(source, /出现于 \{new Set\(proposal\.sourceSceneKeys\)\.size\} 个场次/u);
  assert.doesNotMatch(source, /跳过只是不建立可复用场景资产；剧本中的产品、环境和镜头描述仍会进入后续分镜/u);
  assert.match(source, /sceneProposals: sceneAssetsSkipped \? \[\] : sceneProposals/u);
  assert.match(source, /sceneImages: sceneAssetsSkipped \? \[\] : sceneImages/u);
  assert.match(source, /setAgentTranscript\(\(current\) => \[\.\.\.current, createTranscriptEntry\(\{ role: "user", kind: "action", text: "本片不建立固定场景资产，继续进入道具设计" \}\)\]\)/u);
  assert.match(source, /正文没有符合场景提案所需的结构字段/u);
  assert.match(source, /输出适配失败，不是你的广告需求有问题/u);
  assert.match(source, /Agent 已返回的正文/u);
  assert.match(source, /高级：查看结构化返回内容/u);
  assert.match(source, /保存结构化修改/u);
  assert.match(source, /returnedDraft: sceneRejectedDraft/u);
  assert.match(source, /未通过原因：/u);
  assert.match(source, /Agent 已返回的正文：/u);
  assert.match(source, /function workflowRequestError\(body: AgentFailureBody/u);
  assert.match(source, /if \(!response\.ok \|\| !body\.turn\) throw workflowRequestError/u);
  assert.match(source, /if \(!response\.ok \|\| !body\.optimizedPrompt\) throw workflowRequestError/u);
  assert.match(styles, /\.agent-error span \{[^}]*white-space:pre-wrap/u);
  assert.match(styles, /\.rejected-agent-draft > textarea/u);
});

test('storyboard boards are optional references after structured planning is ready', () => {
  assert.match(source, /async function prepareStoryboardBoardPlans\(recoverReturnedDraft = false\)/u);
  assert.match(source, /\/api\/storyboards\/board-plans/u);
  assert.match(source, /returnedDraft: storyboardBoardRejectedDraft/u);
  assert.match(source, /本地恢复已返回的规划/u);
  assert.match(source, /重新请求 Agent/u);
  assert.match(source, /storyboardBoardRejectedDraft/u);
  assert.match(source, /storyboardBoardRejectedIssues/u);
  assert.match(source, /\{boardLabel\}图片按需生成/u);
  assert.doesNotMatch(source, /可以生成0张、部分或全部\{boardLabel\}/u);
  assert.match(source, /确认当前分镜，进入视频提示词/u);
  assert.doesNotMatch(source, /没有故事板图片的分段直接使用文字规划，不会补生图/u);
  assert.match(source, /board\.status === "idle" \? <div className="storyboard-media-optional"/u);
  assert.match(source, /title="本项目故事板规格"/u);
  assert.match(source, /storyboardBoardPanelCount=\{storyboardBoardPanelCount\}/u);
  assert.match(source, /const storyboardPanelCount = storyboardBoardPanelCount/u);
  assert.match(source, /storyboardPromptPanelCount\(item\) === storyboardPanelCount/u);
  assert.match(source, /storyboardPlanPanelCount\(item\) === storyboardBoardPanelCount/u);
  assert.doesNotMatch(source, /storyboardBoardPrompts\[0\]\?\.panelCount, 6/u);
  assert.match(styles, /\.storyboard-media-optional/u);
});

test('the Agent header exposes one global workflow back control without discarding results', () => {
  assert.match(source, /className="workflow-back-button" aria-label="返回上一步"/u);
  assert.match(source, /async function returnToPreviousWorkflowStep\(reportInConversation = false\)/u);
  const reopenSource = source.slice(source.indexOf('async function returnToPreviousWorkflowStep()'), source.indexOf('async function executePreparedManagerCommands'));
  assert.doesNotMatch(reopenSource, /setStoryboardBoards\(\[\]\)|setStoryboardBoardPrompts\(\[\]\)|setVideoPrompts\(\[\]\)|setShotVideoTasks\(\[\]\)/u);
  assert.match(styles, /\.agent-head-actions \.workflow-back-button/u);
  assert.match(source, /setActiveStage\(stageItems\.includes\(saved\.activeStage\) \? saved\.activeStage/u);
});

test('style, ratio and image resolution are compact canvas presets instead of a blocking character-stage step', () => {
  assert.match(source, /function GenerationPresetControl/u);
  assert.match(source, /\{canvasMode === "director" && <GenerationPresetControl/u);
  assert.doesNotMatch(source, /step === "workspace" && canvasMode === "director" && <GenerationPresetControl/u);
  assert.match(source, /aria-label="当前生成预设"/u);
  assert.match(source, /选择后续画风/u);
  assert.match(source, /选择后续画面比例/u);
  assert.match(source, /选择后续图片分辨率/u);
  assert.match(source, /从下一次图片提交开始生效/u);
  assert.match(source, /title=\{item\.description\}/u);
  assert.match(source, /\{item\.category\} · \{item\.description\}/u);
  assert.match(source, /GENERATION_ASPECT_RATIOS\.map/u);
  assert.match(source, /IMAGE_RESOLUTION_TIERS\.map/u);
  assert.match(source, /const controlRef = useRef<HTMLElement \| null>\(null\)/u);
  assert.match(source, /document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/u);
  assert.match(source, /!controlRef\.current\?\.contains\(target\)\) setOpen\(null\)/u);
  assert.match(source, /aria-label=\{`风格：\$\{selectedStyle\?\.name/u);
  assert.match(source, /aria-label=\{`生成比例：\$\{preset\.aspectRatio\}`\}/u);
  assert.match(source, /aria-label=\{`图片分辨率：\$\{preset\.imageResolution\.toUpperCase\(\)\}`\}/u);
  assert.match(source, /className="video-parameters-trigger" aria-label="视频参数"/u);
  assert.match(source, /onVideoSettings=\{\(\) => \{ setActiveStage\("视频"\); setStageNavigationRequest\(\(current\) => -\(Math\.abs\(current\) \+ 1\)\); \}\}/u);
  assert.match(styles, /\.generation-preset-control \{[^}]*z-index:32/u);
  assert.match(styles, /\.generation-preset-buttons \{[^}]*height:34px;[^}]*border-radius:999px/u);
  assert.match(styles, /\.generation-preset-buttons > button \{[^}]*height:26px;[^}]*font-size:10px/u);
  assert.match(styles, /\.generation-preset-buttons > button\.video-parameters-trigger/u);
  assert.match(styles, /\.generation-preset-popover/u);
  assert.match(styles, /\.generation-resolution-options/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons \{[^}]*height: 42px;[^}]*border: 0;[^}]*border-radius: 11px;/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons > button \{[^}]*height: 36px;[^}]*font-variant-numeric: tabular-nums;/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons > button \+ button::before \{[^}]*height: 16px;/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons > button\.active::after/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons > button:focus-visible/u);
  assert.match(styles, /\.director-ui-studio \.generation-preset-buttons \.disclosure-chevron \{[^}]*width: 9px;[^}]*height: 9px;[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/u);
  const characterDesign = source.slice(source.indexOf('function CharacterDesignStep'), source.indexOf('function SceneDesignStep'));
  assert.doesNotMatch(characterDesign, /className="style-selection-step"/u);
  assert.match(characterDesign, /className="character-reference-actions(?: [^"]+)?"/u);
});

test('free canvas image nodes save independent 1K, 2K and 4K selector values', () => {
  assert.match(freeCanvas, /resolution: ImageResolutionTier/u);
  assert.match(freeCanvas, /<fieldset><legend>分辨率<\/legend>/u);
  assert.match(freeCanvas, /IMAGE_RESOLUTION_TIERS\.map/u);
  assert.match(freeCanvas, /selectImageResolution\(resolution\)/u);
  assert.match(freeCanvas, /imageRequestSizeForAspectRatio\(aspectRatio, imageSettings\.resolution\)/u);
});

test('director H3 settings default to a real random-seed toggle and freeze one seed per submission', () => {
  assert.match(source, /randomSeed: true/u);
  assert.match(source, /function createRandomH3Seed\(\): number/u);
  assert.match(source, /window\.crypto\.getRandomValues\(values\)/u);
  assert.match(source, /materializeH3SubmissionSettings\(h3GenerationSettings\)/u);
  assert.match(source, /settings: materializeH3SubmissionSettings\(h3GenerationSettings\), generationPreset/u);
  assert.match(source, /h3RequestSettings\(submissionIntent\.settings\)/u);
  assert.match(source, /checked=\{settings\.randomSeed\}/u);
  assert.match(source, /disabled=\{settings\.randomSeed\}/u);
  assert.match(styles, /\.h3-toggle > input:checked \+ span/u);
});

test('review stages place the highlighted confirmation after review content and alternate actions', () => {
  const scriptReview = source.slice(source.indexOf('function IdeaScriptStep'), source.indexOf('function DirectVideoChoice'));
  assert.ok(scriptReview.indexOf('className="script-draft-card"') < scriptReview.indexOf('<StageFinalActions className="question-actions"'));
  const characterReview = source.slice(source.indexOf('function CharacterDesignStep'), source.indexOf('function SceneDesignStep'));
  assert.ok(characterReview.indexOf('<DirectVideoChoice') < characterReview.indexOf('<StageFinalActions className="character-approval-actions"'));
  assert.match(characterReview, /<StageFinalActions className="character-reference-actions">/u);
  for (const component of ['scene-design-step', 'prop-design-step', 'storyboard-design-step', 'video-prompt-design-step', 'local-video-generation-step']) {
    const start = source.indexOf(`className="step-card-wrap ${component}`);
    const end = source.indexOf('\nfunction ', start);
    assert.match(source.slice(start, end), /<StageFinalActions/u, `${component} should expose a final confirmation region`);
  }
  assert.match(source, /aria-label="当前可执行选项"/u);
  assert.match(source, /createPortal\(content, host\)/u);
  assert.match(styles, /\.stage-final-confirmation \{ order:100;[^}]*display:grid/u);
  assert.match(styles, /\.stage-final-confirmation > \.primary-button \{ order:100;[^}]*width:100%/u);
});

test('scene proposal failure keeps prior approvals and exposes no-cost recovery before a paid retry', () => {
  const sceneReview = source.slice(source.indexOf('function SceneDesignStep'), source.indexOf('function PropDesignStep'));
  assert.match(sceneReview, /角色参考已确认/u);
  assert.match(sceneReview, /← 返回修改角色参考/u);
  assert.match(sceneReview, /查看 \{rejectedIssues\.length\} 条诊断详情/u);
  assert.match(sceneReview, /高级：查看结构化返回内容/u);
  assert.match(sceneReview, /保存结构化修改/u);
  assert.match(sceneReview, /跳过固定场景，继续制作/u);
  assert.match(sceneReview, /前面已确认的内容保持不变/u);
  assert.match(sceneReview, /<StageFinalActions className="scene-failure-recovery">/u);
  assert.ok(sceneReview.indexOf('跳过固定场景，继续制作') < sceneReview.indexOf('让场景 Agent 重新整理'));
  assert.match(styles, /\.scene-failure-diagnostics summary/u);
});

test('director asset cards keep full copy and use enlarged icon-free generation placeholders', () => {
  assert.match(styles, /\.fixed-stage-layout \.scene-proposal-copy,\.fixed-stage-layout \.prop-proposal-copy \{[^}]*height:auto;[^}]*overflow:visible;/u);
  assert.match(styles, /\.fixed-stage-layout \.scene-proposal-copy-content > p,[^}]*display:block;[^}]*overflow:visible;[^}]*-webkit-line-clamp:unset;/u);
  assert.match(source, /const \[sceneCopyRowHeight, setSceneCopyRowHeight\] = useState\(0\);/u);
  assert.match(source, /querySelectorAll<HTMLElement>\("\.scene-proposal-copy-content"\)/u);
  assert.match(source, /new ResizeObserver\(synchronizeRowHeight\)/u);
  assert.match(source, /style=\{sceneCopyRowHeight > 0 \? \{ minHeight: `\$\{sceneCopyRowHeight\}px` \} : undefined\}/u);
  assert.match(styles, /\.scene-proposal-copy-content \{ display:flow-root; \}/u);
  assert.match(styles, /\.fixed-stage-layout \.scene-proposal-node > \.node-head \{ min-height:25px; \}/u);
  assert.match(styles, /\.fixed-stage-layout \.character-image-placeholder strong \{[^}]*font-size:16\.5px;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-image-placeholder small \{[^}]*font-size:13\.5px;/u);
  assert.match(styles, /\.fixed-stage-layout \.character-image-placeholder \.canvas-character-generate \{[^}]*min-height:57px;[^}]*font-size:15px;/u);
  assert.match(styles, /\.fixed-stage-layout \.storyboard-media-optional strong \{ font-size:16\.5px;/u);
  assert.match(styles, /\.scene-empty-frame, \.prop-empty-frame, \.storyboard-empty-frame\) > strong \{[\s\S]*?font-size: 18px;/u);
  assert.doesNotMatch(source, /<div className="character-image-placeholder"><span className="character-placeholder-icon">/u);
  assert.doesNotMatch(source, /<div className="prop-image-placeholder-copy"><span className="character-placeholder-icon">/u);
  assert.doesNotMatch(source, /<div className="storyboard-media-optional"><span>◇<\/span>/u);
});

test('scene and prop recommendations keep one primary action with custom disclosure', () => {
  const sceneReview = source.slice(source.indexOf('function SceneDesignStep'), source.indexOf('function PropDesignStep'));
  const propReview = source.slice(source.indexOf('function PropDesignStep'), source.indexOf('function StoryboardDesignStep'));
  assert.match(sceneReview, /function SceneUsageSummary/u);
  assert.match(sceneReview, /关联场次 \{occurrenceCount\} 次/u);
  assert.match(sceneReview, /sceneAssetRecommendationCopy/u);
  assert.match(sceneReview, /<button className="primary-button" onClick=\{\(\) => onApprove\(selectedKeys\)\}>继续<\/button>/u);
  assert.match(sceneReview, /aria-expanded=\{customOpen\}/u);
  assert.match(sceneReview, />自定义<\/button>/u);
  assert.match(sceneReview, /选择需要保留为固定资产的场景/u);
  assert.match(propReview, /Agent 建议保留 \$\{selectedKeys\.length\} 件固定道具/u);
  assert.match(propReview, /aria-label="自定义固定道具"/u);
  assert.match(styles, /\.scene-usage-summary/u);
  assert.match(styles, /\.scene-usage-summary\.compact/u);
  assert.match(styles, /\.asset-recommendation-actions \{[^}]*grid-template-columns:minmax\(0,1fr\) auto/u);
  assert.match(styles, /\.asset-custom-list > label/u);
});

test('image prompt suggestions use shared feedback while generation failures remain visible', () => {
  assert.match(source, /body\.validationWarnings\.join\("；"\)/u);
  assert.match(source, /characterImageAdviceRef\.current/u);
  assert.match(source, /sceneImageAdviceRef\.current/u);
  assert.match(source, /propImageAdviceRef\.current/u);
  assert.doesNotMatch(source, /角色图片提示词可继续使用，另有优化建议/u);
  assert.doesNotMatch(source, /场景图片提示词可继续使用，另有优化建议/u);
  assert.doesNotMatch(source, /道具图片提示词可继续使用，另有优化建议/u);
  assert.match(source, /imageStatus === "failed" && !imageAdvice/u);
});

test('single-story script canvas shows real preview copy at normal zoom', () => {
  assert.match(source, /className="script-node-summary"/u);
  assert.match(source, /script\.scenes\.slice\(0, 3\)/u);
  assert.match(styles, /\.fixed-stage-layout \.script-node \{ width: 520px; min-height: 430px;/u);
  assert.match(styles, /\.script-node-summary \{ display: block;/u);
});

test('idea questions show the current role once and use the question label only for round status', () => {
  assert.match(source, /\{currentRole\.label\}<\/div>/u);
  assert.match(source, /<div className="current-question">[\s\S]*?<small>\{busy \? scriptRequested \? "正在生成剧本" : "正在分析" : `第 \$\{round\} 轮`\}<\/small>/u);
  assert.doesNotMatch(source, /<small>编剧导演 ·/u);
});

test('emotion selection shows ranked Agent recommendations with loading and recovery states', () => {
  const emotionStep = source.slice(source.indexOf('function EmotionStep'), source.indexOf('function ReadyStep'));
  assert.match(source, /\/api\/idea-agent\/tones/u);
  assert.match(source, /确认参数，让 Agent 推荐\{props\.creativeDirection === "story" \? "情绪" : "气质"\}/u);
  assert.match(emotionStep, /Agent 推荐/u);
  assert.match(emotionStep, /最推荐/u);
  assert.match(emotionStep, /重新推荐/u);
  assert.match(emotionStep, /emotion-card-placeholder/u);
  assert.match(styles, /\.emotion-recommendation-head/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\) \{ \.emotion-card-placeholder/u);
});
