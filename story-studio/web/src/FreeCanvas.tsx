import { createPortal } from "react-dom";
import { canvasRemovalError } from './free-canvas-integrity';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent as ReactChangeEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  getBezierPath,
  MarkerType,
  ConnectionLineType,
  ConnectionMode,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  addEdge,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DisclosureChevron } from "./DisclosureChevron";
import { findFreeCanvasReferenceMention, freeCanvasReferenceMentionLabel, freeCanvasReferenceMentionToken, type FreeCanvasReferenceMentionKind, type FreeCanvasReferenceMentionRange } from "./free-canvas-reference-mentions";
import { classifyFreeCanvasImport, pastedMediaUrl, type FreeCanvasImportKind } from "./free-canvas-imports";
import { arrangeCanvasSelection, type CanvasArrangement } from "./free-canvas-alignment";
import { referencePurposes, referencePurposeLabels, referenceInputError, type CanvasReferencePurpose } from "../../src/free-canvas/reference-contract";
import { organizeFreeCanvas } from "./free-canvas-layout";
import { FreeCanvasHistory, applyCanvasGraphChange } from "./free-canvas-history";
import { copyCanvasSelection, pasteCanvasSelection, type CanvasClipboard } from "./free-canvas-clipboard";
import { freeCanvasCapacityError, freeCanvasCapacityNotice } from "../../src/free-canvas/capacity";
import { IMAGE_RESOLUTION_TIERS, imageRequestSizeForAspectRatio, normalizeImageResolutionTier, type ImageResolutionTier } from "../../src/presets/generation-preset";

export type CanvasMode = "director" | "free" | "editor";
export type FreeCanvasNodeKind = "text" | "image" | "video" | "audio" | "director";
export type FreeCanvasTextOutputTarget = "script" | "image" | "video";
export type FreeCanvasProviderKind = "agent" | "image" | "image-edit" | "music" | "h3" | "minimax-video" | "seedance-video";
export type FreeCanvasProviderStatus = { kind: FreeCanvasProviderKind; activeProfileId: string; profiles: Array<{ id: string; name: string; model: string; active: boolean }> };
export type DirectorSourceType = "script" | "character" | "scene" | "prop" | "storyboard" | "video" | "postproduction";

export type DirectorSourceRef = { type: DirectorSourceType; stableId: string; label: string; version?: number };
export type DirectorCanvasSource = { sourceRef: DirectorSourceRef; title: string; kind: FreeCanvasNodeKind; content?: string; mediaUrl?: string };
export type FreeCanvasImageSettings = {
  width: number;
  height: number;
  resolution: ImageResolutionTier;
  quality: "auto" | "low" | "medium" | "high";
  count: 1 | 2 | 3 | 4;
  outputFormat: "png" | "webp" | "jpeg";
};
export type FreeCanvasVideoSettings = VideoEngineSettings & {
  mode: "auto" | "text" | "first" | "reference";
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution: "480p" | "720p" | "1080p";
  durationSec: number;
  qualityPreset: "standard" | "balanced" | "fast" | "custom";
  inferenceSteps: number;
  accelerationModel: "none" | "turbo4" | "lightx2v-544p-v1" | "lightx2v-768p-v1";
  spectrum: boolean;
  sage: boolean;
  seed?: number;
};
export type FreeCanvasAudioSettings = {
  mode: "instrumental" | "song";
  durationSec: number;
  bpm: number;
  keyScale: string;
  timeSignature: "2" | "3" | "4" | "6";
  inferenceSteps: number;
  seed: number;
  thinking: boolean;
  lyrics: string;
  vocalLanguage: string;
};
export type FreeCanvasNode = {
  id: string; kind: FreeCanvasNodeKind; title: string; content: string; x: number; y: number;
  mediaUrl?: string; mediaUrls?: string[]; mediaDurationSec?: number; sourceRef?: DirectorSourceRef; createdAt: string;
  libraryAssetRef?: { assetId: string; name: string; version: number };
  candidateSource?: { nodeId: string; taskId?: string; resultIndex: number };
  imageSettings?: FreeCanvasImageSettings;
  videoSettings?: FreeCanvasVideoSettings;
  audioSettings?: FreeCanvasAudioSettings;
  textOptimizationTarget?: FreeCanvasTextOutputTarget;
  generation?: { status: "submitting" | "queued" | "running" | "complete" | "partial" | "failed"; taskId: string; provider?: string; externalTaskId?: string; outputPaths?: string[]; parameters?: Record<string, unknown>; error?: string; updatedAt: string };
};
export type FreeCanvasEdge = { purpose?: CanvasReferencePurpose; id: string; fromNodeId: string; toNodeId: string; sourceHandle?: string | null; targetHandle?: string | null };
export type FreeCanvasPreferences = { showConnections: boolean; showMiniMap: boolean; snapToGrid: boolean };
export type FreeCanvasMediaHistoryKind = "image" | "video" | "audio";
export type FreeCanvasMediaHistoryItem = {
  id: string; kind: FreeCanvasMediaHistoryKind; title: string; mediaUrl: string; prompt: string; createdAt: string;
  sourceNodeId?: string; taskId?: string; provider?: string; mediaDurationSec?: number;
};
export type FreeCanvasState = { view: { x: number; y: number; zoom: number }; nodes: FreeCanvasNode[]; edges: FreeCanvasEdge[]; preferences: FreeCanvasPreferences; mediaHistory: FreeCanvasMediaHistoryItem[] };
export type FreeCanvasReference = { purpose?: CanvasReferencePurpose } & Pick<FreeCanvasNode, "id" | "kind" | "title" | "content" | "mediaUrl" | "mediaDurationSec" | "videoSettings" | "generation">;
type FreeCanvasAssetLibraryType = "character" | "scene" | "prop" | "style" | "lora" | "text" | "image" | "video" | "audio";
type FreeCanvasAssetLibraryItem = {
  id: string; version: number; type: FreeCanvasAssetLibraryType; name: string; description: string; content?: string; tags: string[]; prompt: string;
  media: { mainImageUrl?: string; auxiliaryImageUrl?: string; referenceImageUrls?: string[]; videoUrl?: string; audioUrl?: string };
  sourceProjectName: string; sourceAssetKey: string; folder: string; favorite: boolean; updatedAt: string;
};
type FreeCanvasAssetEditDraft = { name: string; description: string; folder: string; favorite: boolean; tags: string };

export const defaultFreeCanvasState = (): FreeCanvasState => ({
  view: { x: 0, y: 0, zoom: 0.75 }, nodes: [], edges: [],
  preferences: { showConnections: true, showMiniMap: true, snapToGrid: false },
  mediaHistory: [],
});
const FREE_CANVAS_IMAGE_ASPECT_RATIOS = ["1:1", "3:2", "2:3"] as const;
type FreeCanvasImageAspectRatio = (typeof FREE_CANVAS_IMAGE_ASPECT_RATIOS)[number];
const defaultImageSettings = (): FreeCanvasImageSettings => ({ width: 1536, height: 1024, resolution: "1k", quality: "high", count: 1, outputFormat: "png" });
const defaultVideoSettings = (): FreeCanvasVideoSettings => ({ mode: "auto", aspectRatio: "16:9", resolution: "480p", durationSec: 5, qualityPreset: "standard", inferenceSteps: 20, accelerationModel: "none", spectrum: true, sage: true });
const defaultAudioSettings = (): FreeCanvasAudioSettings => ({ mode: "instrumental", durationSec: 30, bpm: 84, keyScale: "A Minor", timeSignature: "4", inferenceSteps: 8, seed: 20260826, thinking: true, lyrics: "", vocalLanguage: "zh" });

function normalizeImageSettings(value?: Partial<FreeCanvasImageSettings>): FreeCanvasImageSettings {
  const defaults = defaultImageSettings();
  const requestedWidth = Number(value?.width);
  const requestedHeight = Number(value?.height);
  const exact = IMAGE_RESOLUTION_TIERS.flatMap((resolution) => FREE_CANVAS_IMAGE_ASPECT_RATIOS.map((aspectRatio) => ({
    resolution,
    aspectRatio,
    ...imageRequestSizeForAspectRatio(aspectRatio, resolution),
  }))).find((item) => item.width === requestedWidth && item.height === requestedHeight);
  const resolution = exact?.resolution ?? normalizeImageResolutionTier(value?.resolution, defaults.resolution);
  const aspectRatio: FreeCanvasImageAspectRatio = exact?.aspectRatio
    ?? (requestedWidth === requestedHeight ? "1:1" : requestedWidth > requestedHeight ? "3:2" : requestedWidth < requestedHeight ? "2:3" : "3:2");
  const { width, height } = imageRequestSizeForAspectRatio(aspectRatio, resolution);
  return {
    width, height, resolution,
    quality: (["auto", "low", "medium", "high"] as const).includes(value?.quality as FreeCanvasImageSettings["quality"]) ? value!.quality! : defaults.quality,
    count: ([1, 2, 3, 4] as const).includes(value?.count as FreeCanvasImageSettings["count"]) ? value!.count! : defaults.count,
    outputFormat: (["png", "webp", "jpeg"] as const).includes(value?.outputFormat as FreeCanvasImageSettings["outputFormat"]) ? value!.outputFormat! : defaults.outputFormat,
  };
}

function normalizeVideoSettings(value?: Partial<FreeCanvasVideoSettings>): FreeCanvasVideoSettings {
  const defaults = defaultVideoSettings();
  return {
    ...(value?.engine === 'minimax' || value?.engine === 'seedance' ? { engine: value.engine, profileId: value.profileId || '', cloudResolution: value.cloudResolution || (value.engine === 'minimax' ? '768p' as const : '720p' as const), generateAudio: value.generateAudio === true } : {}),
    mode: (["auto", "text", "first", "reference"] as const).includes(value?.mode as FreeCanvasVideoSettings["mode"]) ? value!.mode! : defaults.mode,
    aspectRatio: (["16:9", "9:16", "1:1", "4:3", "3:4"] as const).includes(value?.aspectRatio as FreeCanvasVideoSettings["aspectRatio"]) ? value!.aspectRatio! : defaults.aspectRatio,
    resolution: (["480p", "720p", "1080p"] as const).includes(value?.resolution as FreeCanvasVideoSettings["resolution"]) ? value!.resolution! : defaults.resolution,
    durationSec: Math.max(1, Math.min(15, Math.round(Number(value?.durationSec) || defaults.durationSec))),
    qualityPreset: (["standard", "balanced", "fast", "custom"] as const).includes(value?.qualityPreset as FreeCanvasVideoSettings["qualityPreset"]) ? value!.qualityPreset! : defaults.qualityPreset,
    inferenceSteps: Math.max(4, Math.min(30, Math.round(Number(value?.inferenceSteps) || defaults.inferenceSteps))),
    accelerationModel: (["none", "turbo4", "lightx2v-544p-v1", "lightx2v-768p-v1"] as const).includes(value?.accelerationModel as FreeCanvasVideoSettings["accelerationModel"]) ? value!.accelerationModel! : defaults.accelerationModel,
    spectrum: typeof value?.spectrum === "boolean" ? value.spectrum : defaults.spectrum,
    sage: typeof value?.sage === "boolean" ? value.sage : defaults.sage,
    seed: Number.isInteger(value?.seed) && Number(value?.seed) >= 0 ? Number(value!.seed) : undefined,
  };
}

function normalizeAudioSettings(value?: Partial<FreeCanvasAudioSettings>): FreeCanvasAudioSettings {
  const defaults = defaultAudioSettings();
  return {
    mode: value?.mode === "song" ? "song" : "instrumental",
    durationSec: Math.max(5, Math.min(300, Math.round(Number(value?.durationSec) || defaults.durationSec))),
    bpm: Math.max(30, Math.min(300, Math.round(Number(value?.bpm) || defaults.bpm))),
    keyScale: typeof value?.keyScale === "string" && value.keyScale.trim() ? value.keyScale.trim().slice(0, 80) : defaults.keyScale,
    timeSignature: (["2", "3", "4", "6"] as const).includes(value?.timeSignature as FreeCanvasAudioSettings["timeSignature"]) ? value!.timeSignature! : defaults.timeSignature,
    inferenceSteps: Math.max(1, Math.min(20, Math.round(Number(value?.inferenceSteps) || defaults.inferenceSteps))),
    seed: Number.isInteger(value?.seed) ? Math.max(0, Math.min(2_147_483_647, Number(value!.seed))) : defaults.seed,
    thinking: typeof value?.thinking === "boolean" ? value.thinking : defaults.thinking,
    lyrics: typeof value?.lyrics === "string" ? value.lyrics.slice(0, 4_096) : "",
    vocalLanguage: typeof value?.vocalLanguage === "string" && /^[a-z]{2,8}(?:-[A-Z]{2})?$/u.test(value.vocalLanguage) ? value.vocalLanguage : defaults.vocalLanguage,
  };
}

function mediaHistoryId(kind: FreeCanvasMediaHistoryKind, mediaUrl: string) {
  let hash = 2166136261;
  for (const character of `${kind}:${mediaUrl}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `media-${kind}-${(hash >>> 0).toString(36)}`;
}

function normalizeMediaHistory(items: unknown): FreeCanvasMediaHistoryItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.slice(0, 2_000).flatMap((candidate): FreeCanvasMediaHistoryItem[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<FreeCanvasMediaHistoryItem>;
    if (!(["image", "video", "audio"] as const).includes(item.kind as FreeCanvasMediaHistoryKind) || typeof item.mediaUrl !== "string" || !item.mediaUrl.trim()) return [];
    const mediaUrl = item.mediaUrl.trim().slice(0, 20_000);
    const key = `${item.kind}:${mediaUrl}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: typeof item.id === "string" && item.id.trim() ? item.id.slice(0, 200) : mediaHistoryId(item.kind as FreeCanvasMediaHistoryKind, mediaUrl),
      kind: item.kind as FreeCanvasMediaHistoryKind,
      title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, 160) : `${item.kind === "image" ? "图片" : item.kind === "video" ? "视频" : "音频"}历史`,
      mediaUrl,
      prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 20_000) : "",
      createdAt: typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : new Date().toISOString(),
      sourceNodeId: typeof item.sourceNodeId === "string" ? item.sourceNodeId.slice(0, 200) : undefined,
      taskId: typeof item.taskId === "string" ? item.taskId.slice(0, 200) : undefined,
      provider: typeof item.provider === "string" ? item.provider.slice(0, 200) : undefined,
      mediaDurationSec: Number.isFinite(Number(item.mediaDurationSec)) && Number(item.mediaDurationSec) > 0 ? Math.min(86_400, Number(item.mediaDurationSec)) : undefined,
    }];
  });
}

function collectNodeMediaHistory(nodes: FreeCanvasNode[], existing: FreeCanvasMediaHistoryItem[]) {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => `${item.kind}:${item.mediaUrl}`));
  for (const node of nodes) {
    if (node.kind !== "image" && node.kind !== "video" && node.kind !== "audio") continue;
    const kind: FreeCanvasMediaHistoryKind = node.kind;
    const urls = [...new Set([...(node.mediaUrls || []), node.mediaUrl].filter((url): url is string => typeof url === "string" && Boolean(url.trim())))];
    urls.forEach((mediaUrl, index) => {
      const key = `${kind}:${mediaUrl}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({
        id: mediaHistoryId(kind, mediaUrl), kind,
        title: urls.length > 1 ? `${node.title} · ${index + 1}` : node.title,
        mediaUrl, prompt: node.content, sourceNodeId: node.id,
        taskId: node.generation?.taskId, provider: node.generation?.provider,
        mediaDurationSec: kind === "video" ? node.mediaDurationSec : undefined,
        createdAt: node.generation && ["complete", "partial"].includes(node.generation.status) ? node.generation.updatedAt : node.createdAt,
      });
    });
  }
  return merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 2_000);
}

export function normalizeFreeCanvasState(value?: Partial<FreeCanvasState>): FreeCanvasState {
  const defaults = defaultFreeCanvasState();
  const nodes = Array.isArray(value?.nodes) ? value.nodes.filter((item): item is FreeCanvasNode => Boolean(item && typeof item.id === "string")).map((item) => ({
    ...item,
    kind: (["text", "image", "video", "audio", "director"] as const).includes(item.kind) ? item.kind : "text",
    title: typeof item.title === "string" ? item.title.slice(0, 160) : "未命名节点",
    content: typeof item.content === "string" ? item.content.slice(0, 20_000) : "",
    x: Number.isFinite(item.x) ? Math.max(-100_000, Math.min(100_000, item.x)) : 0,
    y: Number.isFinite(item.y) ? Math.max(-100_000, Math.min(100_000, item.y)) : 0,
    mediaUrl: typeof item.mediaUrl === "string" && item.mediaUrl.trim()
      ? item.mediaUrl.trim().slice(0, 20_000)
      : item.kind === "video" && item.generation?.status === "complete" && ["prism-h3", "minimax", "seedance"].includes(item.generation.provider || "") && item.generation.externalTaskId
        ? `/api/h3/media/${encodeURIComponent(item.generation.externalTaskId)}`
        : undefined,
    mediaUrls: Array.isArray(item.mediaUrls) ? item.mediaUrls.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).slice(0, 12).map((url) => url.slice(0, 20_000)) : undefined,
    mediaDurationSec: item.kind === "video" && Number.isFinite(Number(item.mediaDurationSec)) && Number(item.mediaDurationSec) > 0 ? Math.min(86_400, Number(item.mediaDurationSec)) : undefined,
    candidateSource: item.candidateSource && typeof item.candidateSource.nodeId === "string" && Number.isInteger(item.candidateSource.resultIndex) ? {
      nodeId: item.candidateSource.nodeId.slice(0, 200),
      taskId: typeof item.candidateSource.taskId === "string" ? item.candidateSource.taskId.slice(0, 200) : undefined,
      resultIndex: Math.max(0, Math.min(99, item.candidateSource.resultIndex)),
    } : undefined,
    libraryAssetRef: item.libraryAssetRef && typeof item.libraryAssetRef.assetId === "string" ? {
      assetId: item.libraryAssetRef.assetId.slice(0, 200),
      name: typeof item.libraryAssetRef.name === "string" ? item.libraryAssetRef.name.slice(0, 160) : "资产库资产",
      version: Math.max(1, Math.min(100_000, Math.round(Number(item.libraryAssetRef.version) || 1))),
    } : undefined,
    imageSettings: item.kind === "image" ? normalizeImageSettings(item.imageSettings) : undefined,
    videoSettings: item.kind === "video" ? normalizeVideoSettings(item.videoSettings) : undefined,
    audioSettings: item.kind === "audio" ? normalizeAudioSettings(item.audioSettings) : undefined,
    textOptimizationTarget: item.kind === "text" && (["script", "image", "video"] as const).includes(item.textOptimizationTarget as FreeCanvasTextOutputTarget) ? item.textOptimizationTarget : item.kind === "text" ? "script" : undefined,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
  })) : [];
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Array.isArray(value?.edges) ? value.edges
    .filter((item): item is FreeCanvasEdge => Boolean(item && typeof item.id === "string" && nodeIds.has(item.fromNodeId) && nodeIds.has(item.toNodeId) && item.fromNodeId !== item.toNodeId))
    .map((item) => ({ ...item, sourceHandle: "right", targetHandle: "left" })) : [];
  const mediaHistory = collectNodeMediaHistory(nodes, normalizeMediaHistory(value?.mediaHistory));
  return {
    view: {
      x: Number.isFinite(value?.view?.x) ? Number(value!.view!.x) : defaults.view.x,
      y: Number.isFinite(value?.view?.y) ? Number(value!.view!.y) : defaults.view.y,
      zoom: Math.max(0.2, Math.min(1.8, Number(value?.view?.zoom) || defaults.view.zoom)),
    },
    nodes,
    edges,
    preferences: {
      showConnections: typeof value?.preferences?.showConnections === "boolean" ? value.preferences.showConnections : defaults.preferences.showConnections,
      showMiniMap: typeof value?.preferences?.showMiniMap === "boolean" ? value.preferences.showMiniMap : defaults.preferences.showMiniMap,
      snapToGrid: typeof value?.preferences?.snapToGrid === "boolean" ? value.preferences.snapToGrid : defaults.preferences.snapToGrid,
    },
    mediaHistory,
  };
}

const nodeLabels: Record<FreeCanvasNodeKind, string> = { text: "文本", image: "图片", video: "视频", audio: "音频", director: "导演资产" };
const nodeIcons: Record<FreeCanvasNodeKind, string> = { text: "T", image: "▧", video: "▶", audio: "♫", director: "↗" };
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function canonicalConnection(connection: Edge | Connection): Connection | null {
  if (!connection.source || !connection.target || connection.source === connection.target) return null;
  if (connection.sourceHandle === "right" && connection.targetHandle === "left") return {
    source: connection.source, target: connection.target, sourceHandle: "right", targetHandle: "left",
  };
  if (connection.sourceHandle === "left" && connection.targetHandle === "right") return {
    source: connection.target, target: connection.source, sourceHandle: "right", targetHandle: "left",
  };
  return null;
}

function canReference(sourceKind?: FreeCanvasNodeKind, targetKind?: FreeCanvasNodeKind) {
  if (!sourceKind || !targetKind) return false;
  return referencePurposes(sourceKind, targetKind).length > 0;
}

type FreeNodeData = {
  item: FreeCanvasNode;
  editorHost: HTMLDivElement | null;
  patchNode: (nodeId: string, patch: Partial<FreeCanvasNode>, separateOperation?: boolean) => void;
  patchResult: (nodeId: string, patch: Partial<FreeCanvasNode>) => void;
  beginEdit: () => void;
  onReturnToDirector: (source: DirectorSourceRef) => void;
  optimizePrompt: (kind: Exclude<FreeCanvasNodeKind, "director">, prompt: string, references: FreeCanvasReference[], options?: { audioMode?: FreeCanvasAudioSettings["mode"]; textTarget?: FreeCanvasTextOutputTarget }) => Promise<string>;
  generateImage: (nodeId: string, taskId: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasImageSettings) => Promise<{ imageUrls: string[]; provider: string; status: "complete" | "partial"; warning?: string }>;
  generateVideo: (nodeId: string, taskId: string, title: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasVideoSettings, onProgress: (task: { status: string; provider?: string; externalTaskId?: string; outputPaths?: string[]; parameters?: Record<string, unknown>; errorMessage?: string }) => void) => Promise<{ mediaUrl: string; outputPaths: string[]; provider: string; externalTaskId: string }>;
  generateAudio: (nodeId: string, taskId: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasAudioSettings) => Promise<{ mediaUrl: string; outputPaths: string[]; provider: string; externalTaskId?: string; status: "complete" | "partial"; warning?: string }>;
  references: FreeCanvasReference[];
  removeReference: (sourceNodeId: string) => void;
  editorOpen: boolean;
  showEditor: () => void;
  hideEditor: () => void;
  imageAction: (nodeId: string, action: "view" | "rotate-clockwise" | "rotate-counterclockwise" | "upscale" | "edit") => void;
  openContextMenu: (event: ReactMouseEvent<HTMLElement>, nodeId: string) => void;
  providers: FreeCanvasProviderStatus[];
  onProviderProfile: (kind: FreeCanvasProviderKind, profileId: string) => void;
};
type FlowNode = Node<FreeNodeData, "freeNode">;
type FreeCanvasRouteData = { purpose?: CanvasReferencePurpose } & Record<string, unknown>;
type FreeCanvasFlowEdge = Edge<FreeCanvasRouteData, "freeRoute">;
type PendingNodeMenu = {
  left: number;
  top: number;
  flowX: number;
  flowY: number;
  sourceNodeId: string;
  sourceHandle: string | null;
};
type CanvasContextMenu = { left: number; top: number; flowX: number; flowY: number; nodeTypesOpen: boolean; submenuLeft: boolean };
type NodeContextMenu = { left: number; top: number; nodeId: string };
type ImportedNodeDraft = { kind: FreeCanvasImportKind; title: string; content?: string; mediaUrl?: string };
type ImageAiOperation = "outpaint" | "restyle" | "relight" | "replace-background" | "edit" | "remove" | "character-turnaround" | "scene-multiview";
type ImageToolDialog = { sourceNodeId: string; mode: "upscale" | "ai" };

function FreeCanvasRoutedEdge({ sourceX, sourceY, targetX, targetY, style, interactionWidth, markerEnd, label, selected }: EdgeProps<FreeCanvasFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition: Position.Right, targetPosition: Position.Left });
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth ?? 24} label={selected ? label : undefined} labelX={labelX} labelY={labelY} labelStyle={{ fill: "#f1f1f4", fontSize: 12 }} labelBgStyle={{ fill: "#303038" }} />;
}

const freeCanvasEdgeTypes = { freeRoute: FreeCanvasRoutedEdge };

const imageAiOperationMeta: Record<ImageAiOperation, { label: string; hint: string }> = {
  outpaint: { label: "扩图", hint: "补充希望延展出的环境和构图" },
  restyle: { label: "改风格", hint: "例如：清透日系动画、电影写实、水彩插画" },
  relight: { label: "改光照", hint: "例如：雨夜霓虹、清晨逆光、柔和棚拍" },
  "replace-background": { label: "换背景", hint: "描述新的背景、空间关系和光线" },
  edit: { label: "修改画面", hint: "描述要修改的对象、位置与最终状态" },
  remove: { label: "清除元素", hint: "描述要清除的元素及其所在位置" },
  "character-turnaround": { label: "人物三视图", hint: "生成正面、严格侧面和背面角色设定板" },
  "scene-multiview": { label: "场景多视图", hint: "生成同一场景的正视、侧视、反向和俯视布局板" },
};

function buildImageAiPrompt(operation: ImageAiOperation, instruction: string) {
  const clean = instruction.trim();
  const specific = clean || ({
    outpaint: "在不裁切原有主体的前提下自然延展画面环境，补齐新画幅中的空间、光线与材质。",
    restyle: "保持画面内容和构图关系，统一转换为指定视觉风格。",
    relight: "保持人物、物体和构图不变，按指定时间与光源关系重新布光。",
    "replace-background": "保持前景主体身份、姿态和比例，替换为指定背景并统一透视与光线。",
    edit: "按要求修改指定画面内容，未点名区域保持稳定。",
    remove: "清除指定元素，以周围真实纹理、结构和光照自然补全。",
    "character-turnaround": "提取主要人物，生成同一角色的正面、严格左侧面和完整背面三视图。",
    "scene-multiview": "提取固定场景结构，生成正视、左侧视、反向视角和俯视布局四个一致视图。",
  } satisfies Record<ImageAiOperation, string>)[operation];
  const board = operation === "character-turnaround" || operation === "scene-multiview";
  return `参考图：@图片1

关键限制
${operation === "remove" ? "只清除明确指定的元素，保留其余画面内容。" : operation === "outpaint" ? "原图区域完整保留，新区域与原图无缝衔接。" : "保持参考图中未要求改变的主体身份、结构与关键视觉关系。"}

基础设定
以@图片1为唯一视觉参考。${specific}${board ? "输出一张完整横向设定板。" : "输出一张完成编辑的独立图片。"}

氛围、画质与摄影风格
延续参考图的清晰度、材质表现和色彩逻辑；新增或修改区域达到同等细节密度，边缘自然，光影统一。

画面内容与布局
${operation === "character-turnaround" ? "画面从左到右依次排布同一人物的正面、严格左侧面、完整背面；三个人物等高、全身完整、服装和体型一致，背景简洁。" : operation === "scene-multiview" ? "画面使用四格清晰分区，分别呈现同一场景的正视、左侧视、反向视角和俯视布局；固定地标、出入口、家具与空间尺度一致。" : specific}

摄影机与成像
${board ? "正交感设定图视角，各分区比例统一，透视关系清楚，主体完整可读。" : "延续参考图的镜头高度、透视和焦点关系；修改结果清楚可见且与原画面自然融合。"}

负面词
主体身份漂移，结构错乱，重复元素，接缝，透视冲突，模糊，文字水印`;
}

const freeNodeSuggestions: Record<FreeCanvasNodeKind, string[]> = {
  text: ["记录创意意图", "描述角色与事件", "作为下游节点参考"],
  image: ["描述画面内容", "角色与场景设定", "构图和摄影风格"],
  video: ["描述动作与结果", "设置镜头与节拍", "补充声音要求"],
  audio: ["描述情绪与用途", "设置速度和乐器", "规划音乐结构"],
  director: ["来自导演模式", "保留稳定来源", "可继续连接节点"],
};

function magnetizeHandle(event: ReactMouseEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const offsetX = Math.max(-14, Math.min(14, (event.clientX - rect.left - rect.width / 2) * .72));
  const offsetY = Math.max(-18, Math.min(18, (event.clientY - rect.top - rect.height / 2) * .72));
  event.currentTarget.style.setProperty("--handle-magnet-x", `${offsetX.toFixed(1)}px`);
  event.currentTarget.style.setProperty("--handle-magnet-y", `${offsetY.toFixed(1)}px`);
}

function releaseHandleMagnet(event: ReactMouseEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty("--handle-magnet-x", "0px");
  event.currentTarget.style.setProperty("--handle-magnet-y", "0px");
}

function PromptWandIcon() {
  return <svg className="free-node-wand-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m4.5 19.5 10-10" />
    <path d="m12.8 7.2 4 4" />
    <path d="M18.5 3.5v3M17 5h3M6.2 5.2v2.4M5 6.4h2.4M18.2 16.4v2.8M16.8 17.8h2.8" />
  </svg>;
}

function PromptOptimizationLoader() {
  return <span className="free-node-optimize-loader" aria-hidden="true"><i /><i /><i /></span>;
}

function GenerateArrowIcon() {
  return <svg className="free-node-generate-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5" /><path d="m7.5 9.5 4.5-4.5 4.5 4.5" /></svg>;
}

function ImageGenerationLoader() {
  return <span className="free-node-generation-loader" aria-hidden="true" />;
}

function ImageToolIcon({ kind }: { kind: "view" | "download" | "rotate" | "upscale" | "edit" }) {
  if (kind === "view") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.7 10s2.7-4.2 7.3-4.2 7.3 4.2 7.3 4.2-2.7 4.2-7.3 4.2S2.7 10 2.7 10Z"/><circle cx="10" cy="10" r="2.2"/></svg>;
  if (kind === "download") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v8"/><path d="m6.8 8.7 3.2 3.2 3.2-3.2"/><path d="M4 15.5h12"/></svg>;
  if (kind === "rotate") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.4 7.2A6 6 0 1 0 16 11"/><path d="M15.4 3.8v3.6H12"/></svg>;
  if (kind === "upscale") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4"/><path d="m8 8-4-4m8 4 4-4m-4 8 4 4m-8-4-4 4"/></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 16 1-4 8.2-8.2 3 3L8 15Z"/><path d="m11.8 5.2 3 3"/><path d="M12.5 14.5h4"/></svg>;
}

function CanvasViewToolIcon({ kind }: { kind: "organize" | "connections" | "minimap" | "snap" }) {
  if (kind === "organize") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="6" height="5" rx="1.2"/><rect x="14.5" y="4" width="6" height="5" rx="1.2"/><rect x="3.5" y="15" width="6" height="5" rx="1.2"/><rect x="14.5" y="15" width="6" height="5" rx="1.2"/><path d="M9.5 6.5h5M6.5 9v6m11-6v6M9.5 17.5h5"/></svg>;
  if (kind === "connections") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 6h3.5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3H17M13.5 10a4.5 4.5 0 0 1 3.5-4h0"/></svg>;
  if (kind === "minimap") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 5-2 6 2 5-2v16l-5 2-6-2-5 2Z"/><path d="M9 3v16m6-14v16"/><circle cx="15" cy="10" r="1.5"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4m4 0h4M3 13h3m12 0h3"/><circle cx="12" cy="13" r="1.5"/></svg>;
}

function HistoryToolIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 8.2A8 8 0 1 1 4 12"/><path d="M4.8 3.8v4.4h4.4"/><path d="M12 7.5V12l3.2 2"/></svg>;
}

const audioWaveHeights = [34, 58, 42, 76, 52, 88, 64, 44, 72, 96, 68, 48, 82, 57, 91, 62, 38, 70, 86, 54, 78, 46, 66, 40];

function formatAudioTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function AudioPlayIcon({ playing }: { playing: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <><path d="M7 5.5v9" /><path d="M13 5.5v9" /></> : <path d="m7 5 7 5-7 5Z" />}</svg>;
}

function AudioVolumeIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 8h3l3.5-3v10l-3.5-3h-3Z" /><path d="M14 7.2a4 4 0 0 1 0 5.6" />{muted ? <path d="m13.8 8.2 3 3m0-3-3 3" /> : <path d="M15.8 5.4a6.5 6.5 0 0 1 0 9.2" />}</svg>;
}

function FreeNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { item, patchNode, patchResult, beginEdit, onReturnToDirector, optimizePrompt, generateImage, generateVideo, generateAudio, references: upstreamReferences, removeReference, editorOpen, showEditor, hideEditor, imageAction, providers, onProviderProfile } = data;
  const interactiveClass = "nodrag nowheel nopan";
  const [optimizing, setOptimizing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [videoSettingsOpen, setVideoSettingsOpen] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [referenceMention, setReferenceMention] = useState<FreeCanvasReferenceMentionRange | null>(null);
  const [referenceMentionSelection, setReferenceMentionSelection] = useState(0);
  const [optimizeError, setOptimizeError] = useState("");
  const [draftContent, setDraftContent] = useState(item.content);
  const [draftMediaUrl, setDraftMediaUrl] = useState(item.mediaUrl || "");
  const draftContentRef = useRef(item.content);
  const draftMediaUrlRef = useRef(item.mediaUrl || "");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const imageSettingsRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const generatingRef = useRef(false);
  const wasEditorOpenRef = useRef(editorOpen);
  const persistedDraftRef = useRef({ content: item.content, mediaUrl: item.mediaUrl });
  const persistedGenerationActive = ["submitting", "queued", "running"].includes(item.generation?.status || "");
  const generationActive = generating || persistedGenerationActive;
  const visibleError = optimizeError || item.generation?.error || "";
  const generationStateLabel = item.kind === "image" && item.generation?.provider === "local-image-tools"
    ? item.content.includes("超分") ? "图片超分中" : "图片处理中"
    : `${nodeLabels[item.kind]}生成中`;
  const generationStateDetail = item.kind === "image" && item.generation?.provider === "local-image-tools"
    ? "本机图片工具正在处理"
    : item.generation?.status === "queued" ? "任务已进入队列" : "任务正在执行";
  const imageSettings = normalizeImageSettings(item.imageSettings);
  const videoSettings = normalizeVideoSettings(item.videoSettings);
  const audioSettings = normalizeAudioSettings(item.audioSettings);
  const textOptimizationTarget: FreeCanvasTextOutputTarget = item.textOptimizationTarget === "image" || item.textOptimizationTarget === "video" ? item.textOptimizationTarget : "script";
  const imageProviderKind: FreeCanvasProviderKind = upstreamReferences.some((reference) => reference.kind === "image" && reference.mediaUrl) ? "image-edit" : "image";
  const agentProvider = providers.find((provider) => provider.kind === "agent");
  const imageProvider = providers.find((provider) => provider.kind === imageProviderKind);
  const [bpmDraft, setBpmDraft] = useState(String(audioSettings.bpm));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const referenceMentionEnabled = item.kind === "image" || item.kind === "video";
  const currentMediaReference = useMemo<FreeCanvasReference | null>(() => {
    const mediaUrl = draftMediaUrl.trim();
    if (!mediaUrl || (item.kind !== "image" && item.kind !== "video")) return null;
    if (item.kind === "video" && usesCloudVideo(item.videoSettings || {})) return null;
    return {
      id: item.id,
      kind: item.kind,
      title: `当前${nodeLabels[item.kind]} · ${item.title}`,
      content: "",
      mediaUrl,
      mediaDurationSec: item.mediaDurationSec,
      videoSettings: item.videoSettings,
      generation: item.generation,
    };
  }, [draftMediaUrl, item.generation, item.id, item.kind, item.mediaDurationSec, item.title, item.videoSettings]);
  const references = useMemo(() => currentMediaReference
    ? [currentMediaReference, ...upstreamReferences.filter((reference) => reference.id !== item.id)]
    : upstreamReferences,
  [currentMediaReference, item.id, upstreamReferences]);
  const imageCandidates = item.kind === "image" ? (item.mediaUrls?.length ? item.mediaUrls : item.mediaUrl ? [item.mediaUrl] : []) : [];
  const referenceMedia = useMemo(() => {
    const counts: Record<FreeCanvasReferenceMentionKind, number> = { image: 0, video: 0, audio: 0 };
    return references.flatMap((reference) => {
      if (reference.kind !== "image" && reference.kind !== "video" && reference.kind !== "audio") return [];
      const index = counts[reference.kind]++;
      return [{ reference, kind: reference.kind, index, token: freeCanvasReferenceMentionToken(reference.kind, index) }];
    });
  }, [references]);
  const referenceMediaById = useMemo(() => new Map(referenceMedia.map((entry) => [entry.reference.id, entry])), [referenceMedia]);
  const referenceMentionOptions = useMemo(() => {
    if (!referenceMention) return [];
    const rawQuery = referenceMention.query.trim().toLowerCase();
    const prefix = rawQuery.match(/^(图片|视频|音频)/u)?.[1] || "";
    const query = rawQuery.replace(/^(图片|视频|音频)/u, "");
    return referenceMedia.filter((entry) => {
      if (item.kind === "image" && entry.kind !== "image") return false;
      const label = freeCanvasReferenceMentionLabel(entry.kind);
      return (!prefix || label === prefix) && (!query || String(entry.index + 1).includes(query) || entry.reference.title.toLowerCase().includes(query));
    });
  }, [item.kind, referenceMedia, referenceMention]);
  const selectedCandidateIndex = Math.max(0, imageCandidates.findIndex((url) => url === item.mediaUrl));
  const selectCandidate = (index: number) => {
    const url = imageCandidates[(index + imageCandidates.length) % imageCandidates.length];
    if (url && url !== item.mediaUrl) patchNode(item.id, { mediaUrl: url });
  };
  const beginCandidateDrag = (event: ReactDragEvent<HTMLButtonElement>, url: string, index: number) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-prism-free-canvas-image", JSON.stringify({ sourceNodeId: item.id, url, index }));
  };
  const patchImageSettings = (patch: Partial<FreeCanvasImageSettings>) => patchNode(item.id, { imageSettings: normalizeImageSettings({ ...imageSettings, ...patch }) });
  const imageAspectRatio: FreeCanvasImageAspectRatio = imageSettings.width === imageSettings.height ? "1:1" : imageSettings.width > imageSettings.height ? "3:2" : "2:3";
  const selectImageAspectRatio = (aspectRatio: FreeCanvasImageAspectRatio) => patchNode(item.id, { imageSettings: normalizeImageSettings({ ...imageSettings, ...imageRequestSizeForAspectRatio(aspectRatio, imageSettings.resolution) }) });
  const selectImageResolution = (resolution: ImageResolutionTier) => patchNode(item.id, { imageSettings: normalizeImageSettings({ ...imageSettings, ...imageRequestSizeForAspectRatio(imageAspectRatio, resolution), resolution }) });
  const patchVideoSettings = (patch: Partial<FreeCanvasVideoSettings>) => patchNode(item.id, { videoSettings: normalizeVideoSettings({ ...videoSettings, ...patch }) });
  const patchAudioSettings = (patch: Partial<FreeCanvasAudioSettings>) => patchNode(item.id, { audioSettings: normalizeAudioSettings({ ...audioSettings, ...patch }) });
  useEffect(() => setBpmDraft(String(audioSettings.bpm)), [audioSettings.bpm]);
  useEffect(() => {
    if (!imageSettingsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || imageSettingsRef.current?.contains(target)) return;
      setImageSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [imageSettingsOpen]);
  const parsedBpmDraft = () => {
    const parsed = Number.parseInt(bpmDraft, 10);
    return Number.isFinite(parsed) ? Math.max(30, Math.min(300, parsed)) : audioSettings.bpm;
  };
  const commitBpmDraft = () => {
    const bpm = parsedBpmDraft();
    setBpmDraft(String(bpm));
    if (bpm !== audioSettings.bpm) patchAudioSettings({ bpm });
  };
  const stepBpm = (delta: number) => {
    const bpm = Math.max(30, Math.min(300, parsedBpmDraft() + delta));
    setBpmDraft(String(bpm));
    if (bpm !== audioSettings.bpm) patchAudioSettings({ bpm });
  };
  useEffect(() => {
    setAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [item.mediaUrl]);
  const effectiveAudioDuration = audioDuration > 0 ? audioDuration : audioSettings.durationSec;
  const audioProgress = effectiveAudioDuration > 0 ? Math.min(1, audioCurrentTime / effectiveAudioDuration) : 0;
  const toggleAudioPlayback = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setAudioPlaying(false));
    else audio.pause();
  };
  const toggleAudioMuted = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const muted = !audioMuted;
    setAudioMuted(muted);
    if (audioRef.current) audioRef.current.muted = muted;
  };
  const selectVideoPreset = (qualityPreset: FreeCanvasVideoSettings["qualityPreset"]) => {
    if (qualityPreset === "standard") patchVideoSettings({ qualityPreset, inferenceSteps: 20, accelerationModel: "none", spectrum: true });
    else if (qualityPreset === "balanced") patchVideoSettings({ qualityPreset, inferenceSteps: 10, accelerationModel: "none", spectrum: true });
    else if (qualityPreset === "fast") patchVideoSettings({ qualityPreset, inferenceSteps: 6, accelerationModel: "turbo4", spectrum: false });
    else patchVideoSettings({ qualityPreset });
  };
  const videoAccelerationLabel = { none: "原生", turbo4: "Turbo", "lightx2v-544p-v1": "LightX 544P", "lightx2v-768p-v1": "LightX 768P" }[videoSettings.accelerationModel];
  const commitTimerRef = useRef<number | null>(null);
  const clearCommitTimer = () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  };
  const commitDraft = () => {
    clearCommitTimer();
    const patch: Partial<FreeCanvasNode> = {};
    if (draftContentRef.current !== item.content) patch.content = draftContentRef.current;
    if (draftMediaUrlRef.current !== (item.mediaUrl || "")) patch.mediaUrl = draftMediaUrlRef.current;
    if (Object.keys(patch).length) patchNode(item.id, patch);
  };
  const scheduleDraftCommit = () => {
    clearCommitTimer();
    if (composingRef.current) return;
    commitTimerRef.current = window.setTimeout(() => { commitTimerRef.current = null; commitDraft(); }, 420);
  };
  const updateReferenceMention = (value: string, cursor: number) => {
    if (!referenceMentionEnabled) { setReferenceMention(null); return; }
    setReferenceMention(findFreeCanvasReferenceMention(value, cursor));
    setReferenceMentionSelection(0);
  };
  const selectReferenceMention = (entry: (typeof referenceMedia)[number]) => {
    if (!referenceMention) return;
    const current = draftContentRef.current;
    const before = current.slice(0, referenceMention.start);
    const after = current.slice(referenceMention.end);
    const trailingSpace = after && !/^\s/u.test(after) ? " " : "";
    const next = `${before}${entry.token}${trailingSpace}${after}`;
    const cursor = before.length + entry.token.length + trailingSpace.length;
    draftContentRef.current = next;
    setDraftContent(next);
    setReferenceMention(null);
    scheduleDraftCommit();
    window.requestAnimationFrame(() => { promptRef.current?.focus(); promptRef.current?.setSelectionRange(cursor, cursor); });
  };
  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!referenceMention) return;
    if (event.key === "Escape") { event.preventDefault(); setReferenceMention(null); return; }
    if (!referenceMentionOptions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setReferenceMentionSelection((current) => (current + direction + referenceMentionOptions.length) % referenceMentionOptions.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectReferenceMention(referenceMentionOptions[referenceMentionSelection] || referenceMentionOptions[0]);
    }
  };
  useEffect(() => {
    const previous = persistedDraftRef.current;
    persistedDraftRef.current = { content: item.content, mediaUrl: item.mediaUrl };
    if (previous.content !== item.content || previous.mediaUrl !== item.mediaUrl) {
      clearCommitTimer();
      if (previous.content !== item.content) { draftContentRef.current = item.content; setDraftContent(item.content); }
      if (previous.mediaUrl !== item.mediaUrl) { draftMediaUrlRef.current = item.mediaUrl || ""; setDraftMediaUrl(item.mediaUrl || ""); }
      setReferenceMention(null);
    }
    const wasOpen = wasEditorOpenRef.current;
    wasEditorOpenRef.current = editorOpen;
    if (wasOpen && !editorOpen) {
      setReferenceMention(null);
      commitDraft();
      return;
    }
    if (editorOpen) return;
    draftContentRef.current = item.content; setDraftContent(item.content);
    draftMediaUrlRef.current = item.mediaUrl || ""; setDraftMediaUrl(item.mediaUrl || "");
  }, [editorOpen, item.content, item.mediaUrl]);
  useEffect(() => () => clearCommitTimer(), []);
  const openEditor = () => {
    draftContentRef.current = item.content; setDraftContent(item.content);
    draftMediaUrlRef.current = item.mediaUrl || ""; setDraftMediaUrl(item.mediaUrl || "");
    showEditor(); setOptimizeError("");
  };
  const closeEditor = () => {
    composingRef.current = false;
    setReferenceMention(null);
    clearCommitTimer();
    commitDraft();
    faceRef.current?.focus({ preventScroll: true });
    hideEditor();
  };
  const requestEditorClose = (event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); closeEditor(); };
  const runOptimization = async () => {
    const prompt = draftContentRef.current.trim();
    const hasReferenceText = references.some((reference) => reference.title.trim() || reference.content.trim());
    if ((!prompt && !hasReferenceText) || item.kind === "director" || optimizing) return;
    clearCommitTimer();
    setOptimizing(true); setOptimizeError("");
    try {
      const optimized = await optimizePrompt(item.kind, prompt, references, item.kind === "audio" ? { audioMode: audioSettings.mode } : item.kind === "text" ? { textTarget: textOptimizationTarget } : undefined);
      draftContentRef.current = optimized;
      setDraftContent(optimized);
      patchNode(item.id, { content: optimized }, true);
    } catch (error) {
      setOptimizeError(error instanceof Error ? error.message : "提示词没有优化成功，原文已保留。");
    } finally {
      setOptimizing(false);
    }
  };
  const runImageGeneration = async () => {
    const prompt = draftContentRef.current.trim();
    const hasReferenceText = references.some((reference) => reference.content.trim());
    if (item.kind !== "image" || generatingRef.current || persistedGenerationActive || optimizing || (!prompt && !hasReferenceText)) return;
    const inputError = referenceInputError({ ...item, videoSettings }, references, true);
    if (inputError) { setOptimizeError(inputError); return; }
    clearCommitTimer();
    const taskId = nextId("free-canvas-image");
    const startedAt = new Date().toISOString();
    generatingRef.current = true;
    setGenerating(true); setOptimizeError("");
    patchResult(item.id, { content: draftContentRef.current, generation: { status: "submitting", taskId, updatedAt: startedAt } });
    try {
      const result = await generateImage(item.id, taskId, prompt, references, imageSettings);
      const preservedCandidates = imageCandidates.filter((url) => !result.imageUrls.includes(url));
      draftMediaUrlRef.current = result.imageUrls[0];
      setDraftMediaUrl(result.imageUrls[0]);
      patchResult(item.id, { mediaUrl: result.imageUrls[0], mediaUrls: [...result.imageUrls, ...preservedCandidates].slice(0, 12), generation: { status: result.status, taskId, provider: result.provider, error: result.warning, updatedAt: new Date().toISOString() } });
      if (result.warning) setOptimizeError(result.warning);
      hideEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片没有生成成功，提示词和旧结果已保留。";
      setOptimizeError(message);
      patchResult(item.id, { generation: { status: "failed", taskId, error: message, updatedAt: new Date().toISOString() } });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };
  const runVideoGeneration = async () => {
    const prompt = draftContentRef.current.trim();
    const hasReferenceText = references.some((reference) => reference.content.trim());
    if (item.kind !== "video" || generatingRef.current || persistedGenerationActive || optimizing || (!prompt && !hasReferenceText)) return;
    const inputError = referenceInputError({ ...item, videoSettings }, references, true);
    if (inputError) { setOptimizeError(inputError); return; }
    clearCommitTimer();
    const taskId = nextId("free-canvas-video");
    const startedAt = new Date().toISOString();
    const sourceOutputPaths = item.generation?.outputPaths;
    let submittedExternalTaskId = "";
    generatingRef.current = true;
    setGenerating(true); setOptimizeError(""); setReferenceMention(null); setVideoSettingsOpen(false);
    patchResult(item.id, { content: draftContentRef.current, generation: { status: "submitting", taskId, provider: item.generation?.provider, outputPaths: sourceOutputPaths, updatedAt: startedAt } });
    try {
      const result = await generateVideo(item.id, taskId, item.title, prompt, references, videoSettings, (task) => {
        submittedExternalTaskId = task.externalTaskId || submittedExternalTaskId;
        const status = task.status === "running" ? "running" : task.status === "queued" ? "queued" : task.status === "failed" ? "failed" : "submitting";
        patchResult(item.id, { generation: { status, taskId, provider: task.provider || "prism-h3", parameters: task.parameters, externalTaskId: submittedExternalTaskId || undefined, outputPaths: task.outputPaths?.length ? task.outputPaths : sourceOutputPaths, error: task.errorMessage, updatedAt: new Date().toISOString() } });
      });
      draftMediaUrlRef.current = result.mediaUrl;
      setDraftMediaUrl(result.mediaUrl);
      patchResult(item.id, { mediaUrl: result.mediaUrl, mediaDurationSec: videoSettings.durationSec, generation: { status: "complete", taskId, provider: result.provider, externalTaskId: result.externalTaskId, outputPaths: result.outputPaths, updatedAt: new Date().toISOString() } });
      hideEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频没有生成成功，提示词、参数和旧结果已保留。";
      setOptimizeError(message);
      patchResult(item.id, { generation: { status: submittedExternalTaskId ? "running" : "failed", taskId, provider: usesCloudVideo(videoSettings) ? videoSettings.engine : "prism-h3", externalTaskId: submittedExternalTaskId || undefined, outputPaths: sourceOutputPaths, error: message, updatedAt: new Date().toISOString() } });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };
  const runAudioGeneration = async () => {
    const prompt = draftContentRef.current.trim();
    const hasReferenceText = references.some((reference) => reference.kind === "text" && reference.content.trim());
    if (item.kind !== "audio" || generatingRef.current || persistedGenerationActive || optimizing || (!prompt && !hasReferenceText)) return;
    if (audioSettings.mode === "song" && !audioSettings.lyrics.trim()) { setOptimizeError("歌曲模式需要先填写歌词。"); return; }
    const inputError = referenceInputError({ ...item, videoSettings }, references, true);
    if (inputError) { setOptimizeError(inputError); return; }
    clearCommitTimer();
    const taskId = nextId("free-canvas-audio");
    const startedAt = new Date().toISOString();
    generatingRef.current = true;
    setGenerating(true); setOptimizeError(""); setAudioSettingsOpen(false);
    patchResult(item.id, { content: draftContentRef.current, audioSettings, generation: { status: "submitting", taskId, provider: "acestep-1.5", updatedAt: startedAt } });
    try {
      const result = await generateAudio(item.id, taskId, prompt, references, audioSettings);
      draftMediaUrlRef.current = result.mediaUrl;
      setDraftMediaUrl(result.mediaUrl);
      patchResult(item.id, { mediaUrl: result.mediaUrl, generation: { status: result.status, taskId, provider: result.provider, externalTaskId: result.externalTaskId, outputPaths: result.outputPaths, error: result.warning, updatedAt: new Date().toISOString() } });
      if (result.warning) setOptimizeError(result.warning);
      hideEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : "音频没有生成成功，提示词、参数和旧结果已保留。";
      setOptimizeError(message);
      patchResult(item.id, { generation: { status: "failed", taskId, provider: "acestep-1.5", error: message, updatedAt: new Date().toISOString() } });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };
  return <article className={`free-node kind-${item.kind} ${selected ? "selected" : ""}`} onContextMenu={(event) => data.openContextMenu(event, item.id)}>
    <Handle id="left" className="free-node-handle free-node-handle-input" type="target" position={Position.Left} aria-label={`${item.title}左侧输入端口`} onMouseMove={magnetizeHandle} onMouseLeave={releaseHandleMagnet}><span>+</span></Handle>
    <div className="free-node-label" title={`拖动${item.title}`}><span>{nodeIcons[item.kind]}</span><b>{item.title}</b><i className="free-node-label-grip" aria-hidden="true">⠿</i></div>
    {item.kind === "image" && item.mediaUrl && <div className={`free-node-image-toolbar ${interactiveClass}`} aria-label="图片结果工具" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => imageAction(item.id, "view")} aria-label="查看大图" title="查看大图"><ImageToolIcon kind="view" /></button>
      <a href={item.mediaUrl} download aria-label="下载原图" title="下载原图"><ImageToolIcon kind="download" /></a>
      <button type="button" onClick={() => imageAction(item.id, "rotate-counterclockwise")} aria-label="向左旋转并生成新节点" title="向左旋转"><span className="free-node-tool-left-rotate"><ImageToolIcon kind="rotate" /></span></button>
      <button type="button" onClick={() => imageAction(item.id, "rotate-clockwise")} aria-label="向右旋转并生成新节点" title="向右旋转"><ImageToolIcon kind="rotate" /></button>
      <button type="button" onClick={() => imageAction(item.id, "upscale")} aria-label="Real-ESRGAN超分" title="Real-ESRGAN超分"><ImageToolIcon kind="upscale" /></button>
      <button type="button" onClick={() => imageAction(item.id, "edit")} aria-label="Image 2编辑与派生" title="Image 2编辑与派生"><ImageToolIcon kind="edit" /></button>
    </div>}
    <div ref={faceRef} className={`free-node-face ${item.kind === "image" && item.mediaUrl ? "has-image-result" : ""} ${item.kind === "audio" && item.mediaUrl ? "has-audio-result" : ""}`} style={item.kind === "image" && item.mediaUrl ? { aspectRatio: `${imageSettings.width} / ${imageSettings.height}` } : undefined} role="button" tabIndex={0} aria-label={`编辑${item.title}`} onDoubleClick={(event) => { event.stopPropagation(); openEditor(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(); } }}>
      {generationActive && !item.mediaUrl ? <div className="free-node-generation-state" role="status" aria-live="polite"><ImageGenerationLoader /><strong>{generationStateLabel}</strong><small>{generationStateDetail}</small><i aria-hidden="true" /></div>
        : item.generation?.status === "failed" && !item.mediaUrl ? <div className="free-node-generation-state is-failed" role="alert"><b aria-hidden="true">!</b><strong>处理未完成</strong><small>{item.generation.error || "请查看任务记录"}</small></div>
        : item.kind === "text" && item.content.trim() ? <pre className="free-node-text-preview">{item.content}</pre> : item.mediaUrl && item.kind === "image" ? <img src={item.mediaUrl} alt={`${item.title}，候选${selectedCandidateIndex + 1}`} draggable={false} /> : item.mediaUrl && item.kind === "video" ? <><video className={interactiveClass} src={item.mediaUrl} controls onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0 && Math.abs(duration - Number(item.mediaDurationSec || 0)) > .01) patchResult(item.id, { mediaDurationSec: duration }); }} /><span className="free-node-video-drag-surface" title={`拖动${item.title}`} /></> : item.mediaUrl && item.kind === "audio" ? <div className="free-node-audio-result">
        <audio ref={audioRef} className="free-node-audio-native" src={item.mediaUrl} preload="metadata" onLoadedMetadata={(event) => setAudioDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={(event) => setAudioDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={(event) => setAudioCurrentTime(event.currentTarget.currentTime)} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} />
        <div className="free-node-audio-identity"><span className="free-node-audio-cover" aria-hidden="true"><i>♫</i><b /></span><div><small>ACE-STEP AUDIO</small><strong>{audioSettings.mode === "song" ? "歌曲" : "纯音乐"}<em><i />已生成</em></strong><span>{audioSettings.bpm} BPM · {audioSettings.keyScale} · {audioSettings.timeSignature === "6" ? "6/8" : `${audioSettings.timeSignature}/4`}</span></div></div>
        <div className="free-node-audio-wave" aria-hidden="true">{audioWaveHeights.map((height, index) => <i key={`${height}:${index}`} className={index / audioWaveHeights.length <= audioProgress ? "played" : ""} style={{ "--audio-bar-height": `${height}%` } as CSSProperties} />)}</div>
        <div className={`free-node-audio-controls ${interactiveClass}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={toggleAudioPlayback} aria-label={audioPlaying ? "暂停音频" : "播放音频"}><AudioPlayIcon playing={audioPlaying} /></button>
          <span>{formatAudioTime(audioCurrentTime)}</span>
          <input type="range" min="0" max={Math.max(effectiveAudioDuration, 1)} step="0.01" value={Math.min(audioCurrentTime, Math.max(effectiveAudioDuration, 1))} style={{ "--audio-progress": `${audioProgress * 100}%` } as CSSProperties} aria-label="音频播放进度" onChange={(event) => { const nextTime = Number(event.target.value); setAudioCurrentTime(nextTime); if (audioRef.current) audioRef.current.currentTime = nextTime; }} />
          <span>{formatAudioTime(effectiveAudioDuration)}</span>
          <button type="button" onClick={toggleAudioMuted} aria-label={audioMuted ? "取消静音" : "静音音频"}><AudioVolumeIcon muted={audioMuted} /></button>
        </div>
      </div> : <>
        <div className="free-node-empty-glyph">{nodeIcons[item.kind]}</div>
        <small>尝试：</small>
        <ul>{freeNodeSuggestions[item.kind].map((suggestion, index) => <li key={suggestion}><i>{["▤", "▶", "▧", "♫"][index] || "·"}</i>{suggestion}</li>)}</ul>
      </>}
      {imageCandidates.length > 1 && <div className={`free-node-candidate-picker ${interactiveClass}`} aria-label={`${imageCandidates.length}张候选图片`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="free-node-candidate-arrow" onClick={() => selectCandidate(selectedCandidateIndex - 1)} aria-label="上一张候选">‹</button>
        <div className="free-node-candidate-thumbs">{imageCandidates.map((url, index) => <button type="button" key={`${url}:${index}`} draggable className={selectedCandidateIndex === index ? "selected" : ""} onDragStart={(event) => beginCandidateDrag(event, url, index)} onClick={() => selectCandidate(index)} title={`候选${index + 1} · 点击采用，拖到画布可拆为独立节点`} aria-label={`候选${index + 1}${selectedCandidateIndex === index ? "，当前采用" : ""}`}><img src={url} alt="" draggable={false} /></button>)}</div>
        <span>{selectedCandidateIndex + 1}/{imageCandidates.length}</span>
        <button type="button" className="free-node-candidate-arrow" onClick={() => selectCandidate(selectedCandidateIndex + 1)} aria-label="下一张候选">›</button>
      </div>}
      {item.kind !== "text" && item.content.trim() && <span className="free-node-content-state">{item.candidateSource ? "独立候选 · 1张" : "已有提示词 · 双击编辑"}</span>}
      {generationActive && item.mediaUrl && <span className="free-node-persistent-generation" aria-label={`${nodeLabels[item.kind]}正在生成`}><ImageGenerationLoader /><b>{item.generation?.status === "queued" ? "排队中" : item.generation?.status === "submitting" ? "提交中" : "生成中"}</b></span>}
    </div>
    {editorOpen && data.editorHost && createPortal(<section className={`free-node-editor ${interactiveClass}`} aria-label={`${item.title}输入面板`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); closeEditor(); } }}>
      <header><span>{nodeIcons[item.kind]} {nodeLabels[item.kind]}输入</span><button onPointerDown={requestEditorClose} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); closeEditor(); } }} aria-label="收起输入框">↙</button></header>
      <strong className="free-canvas-panel-title">{item.title}</strong>
      {referenceInputError({ ...item, videoSettings }, references) && <p role="alert" className="free-canvas-input-error">{referenceInputError({ ...item, videoSettings }, references)}</p>}
      {(references.length > 0 || referenceMentionEnabled) && <div className="free-node-reference-panel">
        <header><strong>参考素材</strong><b>{references.length}</b><small>{item.kind === "audio" ? "来自上游连线 · 文字内容可辅助音乐描述" : currentMediaReference ? `当前${nodeLabels[item.kind]}已自动作为第1项 · 可输入 @ 调用` : "来自上游连线 · 在下方提示词输入 @ 调用"}</small></header>
        <div className="free-node-reference-list">{references.map((reference, index) => <article key={reference.id} className={`${reference.id === item.id ? "is-current-media " : ""}kind-${reference.kind}`} tabIndex={0} aria-label={`${reference.title}，悬停或聚焦查看完整参考`}>
          <i className={referenceMediaById.has(reference.id) ? "has-mention-token" : ""}>{referenceMediaById.get(reference.id)?.token.replace("@", "") || index + 1}</i>
          {reference.mediaUrl && reference.kind === "image" ? <img src={reference.mediaUrl} alt={reference.title} draggable={false} />
            : reference.mediaUrl && reference.kind === "video" ? <video src={reference.mediaUrl} muted preload="metadata" />
              : <span>{nodeIcons[reference.kind]}</span>}
          {reference.id !== item.id && <button type="button" className="free-node-reference-remove" aria-label={`移除${reference.title}参考`} onClick={() => removeReference(reference.id)}>×</button>}
          <div className="free-node-reference-tooltip" role="tooltip"><strong>{reference.title}</strong>{reference.id === item.id ? <p>当前节点正在编辑的媒体，提交时会自动带入。</p> : reference.content.trim() ? <p>{reference.content}</p> : <p>该参考节点没有文字内容。</p>}<small>{reference.id === item.id ? "当前素材" : referencePurposeLabels[reference.purpose || referencePurposes(reference.kind, item.kind)[0]] || "待调整的引用"}</small></div>
        </article>)}</div>
        {!references.length && <p className="free-node-reference-empty">{item.kind === "image" ? "先从上游图片节点连线到当前图片节点" : item.kind === "audio" ? "可连接上游文本节点提供音乐创作意图" : "先从上游图片、视频或音频节点连线到当前视频节点"}</p>}
      </div>}
      {!item.sourceRef && ["image", "video", "audio"].includes(item.kind) && <input className="free-node-url" value={draftMediaUrl} placeholder="可选：粘贴本机媒体地址" onFocus={beginEdit} onChange={(event) => { draftMediaUrlRef.current = event.target.value; setDraftMediaUrl(event.target.value); scheduleDraftCommit(); }} onBlur={commitDraft} />}
      {item.kind === "text" && <fieldset className="free-node-text-target"><legend>优化目标</legend><div>{([
        ["script", "写成剧本"],
        ["image", "图片提示词"],
        ["video", "视频提示词"],
      ] as const).map(([target, label]) => <button type="button" key={target} className={textOptimizationTarget === target ? "selected" : ""} onClick={() => patchNode(item.id, { textOptimizationTarget: target })}>{label}</button>)}</div></fieldset>}
      <div className="free-node-textarea-shell">
        <textarea ref={promptRef} value={draftContent} maxLength={item.kind === "audio" ? 2_000 : 20_000} placeholder={item.kind === "video" ? (referenceMedia.length ? "输入视频提示词；输入 @ 可选择上方图片、视频或音频……" : "输入视频提示词；先连接上游参考素材后可输入 @ 调用……") : item.kind === "image" ? (referenceMedia.some((entry) => entry.kind === "image") ? "输入图片提示词；输入 @ 可选择上方参考图片进行编辑……" : "输入图片提示词；先连接上游图片后可输入 @ 调用……") : item.kind === "audio" ? (audioSettings.mode === "song" ? "描述歌曲风格、乐器、情绪、歌手声线与结构……" : "描述纯音乐的用途、风格、乐器、情绪与结构……") : references.length ? `已引用${references.length}个上游节点，可在这里补充本节点的生成要求……` : item.sourceRef ? "来自导演模式的关联资产，可在这里补充后续要求。" : "写下你想讲的故事、场景、角色或生成要求……"} onFocus={(event) => { beginEdit(); updateReferenceMention(event.currentTarget.value, event.currentTarget.selectionStart); }} onCompositionStart={() => { composingRef.current = true; clearCommitTimer(); }} onCompositionEnd={(event) => { composingRef.current = false; draftContentRef.current = event.currentTarget.value; setDraftContent(event.currentTarget.value); updateReferenceMention(event.currentTarget.value, event.currentTarget.selectionStart); scheduleDraftCommit(); }} onChange={(event) => { draftContentRef.current = event.target.value; setDraftContent(event.target.value); updateReferenceMention(event.target.value, event.target.selectionStart); scheduleDraftCommit(); }} onClick={(event) => updateReferenceMention(event.currentTarget.value, event.currentTarget.selectionStart)} onKeyDown={handlePromptKeyDown} onBlur={() => { commitDraft(); window.setTimeout(() => setReferenceMention(null), 120); }} />
        {referenceMentionEnabled && referenceMention && <div className="free-node-reference-mention-menu" role="listbox" aria-label="选择提示词中的参考素材">
          <header><strong>选择上方参考素材</strong><span>{item.kind === "image" ? "输入 图片 可筛选" : "输入 图片 / 视频 / 音频 可筛选"}</span></header>
          {referenceMentionOptions.length ? referenceMentionOptions.map((entry, optionIndex) => <button type="button" role="option" aria-selected={optionIndex === referenceMentionSelection} className={optionIndex === referenceMentionSelection ? "active" : ""} key={entry.reference.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectReferenceMention(entry)}>
            {entry.kind === "image" && entry.reference.mediaUrl ? <img src={entry.reference.mediaUrl} alt="" /> : entry.kind === "video" && entry.reference.mediaUrl ? <video src={entry.reference.mediaUrl} muted preload="metadata" /> : <i>{nodeIcons[entry.kind]}</i>}
            <span><strong>{entry.token}</strong><small>{entry.reference.title}</small></span>
          </button>) : <p>{item.kind === "image" ? (referenceMedia.some((entry) => entry.kind === "image") ? "没有匹配的参考图片" : "请先从上游连入参考图片") : (referenceMedia.length ? "没有匹配的参考素材" : "请先从上游连入参考图片、视频或音频")}</p>}
        </div>}
      </div>
      {item.kind === "image" && <div className="free-node-image-settings" ref={imageSettingsRef}>
        <button type="button" className="free-node-image-settings-summary" aria-expanded={imageSettingsOpen} onClick={() => setImageSettingsOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setImageSettingsOpen((open) => !open); } }}>
          <span>▱</span><strong>{imageAspectRatio}</strong><span>{imageSettings.resolution.toUpperCase()}</span><span>{imageSettings.width}×{imageSettings.height}</span><span>{{ auto: "自动画质", low: "低画质", medium: "标准画质", high: "高画质" }[imageSettings.quality]}</span><span>{imageSettings.outputFormat.toUpperCase()}</span><span>{imageSettings.count}张</span><DisclosureChevron className="free-node-settings-chevron" expanded={imageSettingsOpen} />
        </button>
        {imageSettingsOpen && <section className="free-node-image-settings-popover" aria-label="图片生成参数">
          <fieldset><legend>画质</legend><div>{(["auto", "low", "medium", "high"] as const).map((quality) => <button type="button" key={quality} className={imageSettings.quality === quality ? "selected" : ""} onClick={() => patchImageSettings({ quality })}>{{ auto: "自动", low: "低", medium: "标准", high: "高" }[quality]}</button>)}</div></fieldset>
          <fieldset><legend>分辨率</legend><div>{IMAGE_RESOLUTION_TIERS.map((resolution) => {
            const size = imageRequestSizeForAspectRatio(imageAspectRatio, resolution);
            return <button type="button" key={resolution} className={imageSettings.resolution === resolution ? "selected" : ""} onClick={() => selectImageResolution(resolution)}><strong>{resolution.toUpperCase()}</strong><small>{size.width}×{size.height}</small></button>;
          })}</div></fieldset>
          <fieldset><legend>画幅与尺寸</legend><div>{[
            ...FREE_CANVAS_IMAGE_ASPECT_RATIOS.map((aspectRatio) => ({ aspectRatio, ...imageRequestSizeForAspectRatio(aspectRatio, imageSettings.resolution) })),
          ].map((size) => <button type="button" key={size.aspectRatio} className={imageAspectRatio === size.aspectRatio ? "selected" : ""} onClick={() => selectImageAspectRatio(size.aspectRatio)}><strong>{size.aspectRatio}</strong><small>{size.width}×{size.height}</small></button>)}</div></fieldset>
          <fieldset><legend>生成数量</legend><div>{([1, 2, 3, 4] as const).map((count) => <button type="button" key={count} className={imageSettings.count === count ? "selected" : ""} onClick={() => patchImageSettings({ count })}>{count}张</button>)}</div></fieldset>
          <fieldset><legend>文件格式</legend><div>{(["png", "webp", "jpeg"] as const).map((outputFormat) => <button type="button" key={outputFormat} className={imageSettings.outputFormat === outputFormat ? "selected" : ""} onClick={() => patchImageSettings({ outputFormat })}>{outputFormat.toUpperCase()}</button>)}</div></fieldset>
        </section>}
      </div>}
      {item.kind === "video" && <div className="free-node-video-settings">
        <button type="button" className="free-node-video-settings-summary" aria-expanded={videoSettingsOpen} onClick={() => setVideoSettingsOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setVideoSettingsOpen((open) => !open); } }}>
          <span className="free-node-video-summary-icon">▶</span><strong>{videoSettings.aspectRatio}</strong><span>{usesCloudVideo(videoSettings) ? videoEngineLabel(videoSettings.engine) : videoSettings.resolution.toUpperCase()}</span><span>{videoSettings.durationSec}秒</span>{!usesCloudVideo(videoSettings) && <><span>{videoAccelerationLabel}</span><span>{videoSettings.inferenceSteps}步</span></>}<DisclosureChevron className="free-node-settings-chevron" expanded={videoSettingsOpen} />
        </button>
        {videoSettingsOpen && <section className="free-node-video-settings-popover" aria-label="视频生成参数">
          <header><div><span>{videoEngineLabel(videoSettings.engine)}</span><strong>视频生成参数</strong></div><small>当前节点独立保存</small></header><VideoEngineControls settings={{ ...videoSettings, mode: videoSettings.mode === "text" ? "text" : "reference" }} onChange={patchVideoSettings} showMode={false} context="canvas" />
          <fieldset><legend>生成模式</legend><div>{([[
            "auto", "自动", "按参考判断"], ["text", "文生视频", "仅文字"], ["first", "首帧", "单张图片"], ["reference", "全能参考", "图/视频/音频"],
          ] as const).map(([mode, label, note]) => <button type="button" key={mode} disabled={videoSettings.engine === "minimax" && mode === "reference"} className={videoSettings.mode === mode ? "selected" : ""} onClick={() => patchVideoSettings({ mode })}><strong>{mode === "reference" && usesCloudVideo(videoSettings) ? "多图参考" : label}</strong><small>{mode === "reference" && usesCloudVideo(videoSettings) ? videoSettings.engine === "minimax" ? "此接口不支持" : "图片参考" : note}</small></button>)}</div></fieldset>
          {!usesCloudVideo(videoSettings) && <fieldset className="free-node-video-presets"><legend>质量预设</legend><div>{([
            ["standard", "标准", "20步 · Spectrum"], ["balanced", "均衡", "10步 · Spectrum"], ["fast", "极速", "6步 · Turbo"], ["custom", "自定义", "手动组合"],
          ] as const).map(([value, label, note]) => <button type="button" key={value} className={videoSettings.qualityPreset === value ? "selected" : ""} onClick={() => selectVideoPreset(value)}><strong>{label}</strong><small>{note}</small></button>)}</div></fieldset>}
          <div className="free-node-video-setting-grid">
            <fieldset><legend>画面比例</legend><div>{(["16:9", "9:16", "1:1", "4:3", "3:4"] as const).map((aspectRatio) => <button type="button" key={aspectRatio} className={videoSettings.aspectRatio === aspectRatio ? "selected" : ""} onClick={() => patchVideoSettings({ aspectRatio })}>{aspectRatio}</button>)}</div></fieldset>
            {!usesCloudVideo(videoSettings) && <fieldset><legend>分辨率</legend><div>{(["480p", "720p", "1080p"] as const).map((resolution) => <button type="button" key={resolution} className={videoSettings.resolution === resolution ? "selected" : ""} onClick={() => patchVideoSettings({ resolution })}>{resolution.toUpperCase()}</button>)}</div></fieldset>}
          </div>
          <fieldset className="free-node-video-range"><legend><span>视频时长</span><b>{videoSettings.durationSec}秒</b></legend><input type="range" min="1" max="15" step="1" value={videoSettings.durationSec} style={{ "--range-progress": `${((videoSettings.durationSec - 1) / 14) * 100}%` } as CSSProperties} onChange={(event) => patchVideoSettings({ durationSec: Number(event.target.value) })} /><div><span>1秒</span>{(videoSettings.engine === "minimax" ? [6, 10] : [5, 10, 15]).map((durationSec) => <button type="button" key={durationSec} onClick={() => patchVideoSettings({ durationSec })}>{durationSec}秒</button>)}<span>15秒</span></div></fieldset>
          {!usesCloudVideo(videoSettings) && <><fieldset><legend>加速节点</legend><div>{([
            ["none", "原生", "稳定"], ["turbo4", "Turbo", "极速"], ["lightx2v-544p-v1", "LightX 544P", "低分辨率"], ["lightx2v-768p-v1", "LightX 768P", "高分辨率"],
          ] as const).map(([accelerationModel, label, note]) => <button type="button" key={accelerationModel} className={videoSettings.accelerationModel === accelerationModel ? "selected" : ""} onClick={() => patchVideoSettings({ accelerationModel, qualityPreset: "custom" })}><strong>{label}</strong><small>{note}</small></button>)}</div></fieldset>
          <fieldset className="free-node-video-range"><legend><span>采样步数</span><b>{videoSettings.inferenceSteps}步</b></legend><input type="range" min="4" max="30" step="1" value={videoSettings.inferenceSteps} style={{ "--range-progress": `${((videoSettings.inferenceSteps - 4) / 26) * 100}%` } as CSSProperties} onChange={(event) => patchVideoSettings({ inferenceSteps: Number(event.target.value), qualityPreset: "custom" })} /><div><span>4步</span>{[6, 10, 20].map((inferenceSteps) => <button type="button" key={inferenceSteps} onClick={() => patchVideoSettings({ inferenceSteps, qualityPreset: "custom" })}>{inferenceSteps}</button>)}<span>30步</span></div></fieldset>
          <fieldset className="free-node-video-toggles"><legend>加速组件</legend><div><button type="button" role="switch" aria-checked={videoSettings.spectrum} className={videoSettings.spectrum ? "selected" : ""} onClick={() => patchVideoSettings({ spectrum: !videoSettings.spectrum, qualityPreset: "custom" })}><i /><span><strong>Spectrum</strong><small>推理加速</small></span></button><button type="button" role="switch" aria-checked={videoSettings.sage} className={videoSettings.sage ? "selected" : ""} onClick={() => patchVideoSettings({ sage: !videoSettings.sage })}><i /><span><strong>SageAttention</strong><small>注意力加速</small></span></button></div></fieldset>
          </>}{videoSettings.engine !== 'minimax' && <fieldset className="free-node-video-seed"><legend>随机种子</legend><div><input type="number" min="0" step="1" value={videoSettings.seed ?? ""} placeholder="留空随机" onChange={(event) => patchVideoSettings({ seed: event.target.value === "" ? undefined : Math.max(0, Math.round(Number(event.target.value))) })} /><button type="button" onClick={() => patchVideoSettings({ seed: undefined })}>随机</button></div></fieldset>}
          <footer><span>参数只保存到当前视频节点</span><small>右下生成键提交到{videoEngineLabel(videoSettings.engine)}</small></footer>
        </section>}
      </div>}
      {item.kind === "audio" && <div className="free-node-audio-settings">
        <button type="button" className="free-node-audio-settings-summary" aria-expanded={audioSettingsOpen} onClick={() => setAudioSettingsOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setAudioSettingsOpen((open) => !open); } }}><span>♫</span><strong>{audioSettings.mode === "song" ? "歌曲" : "纯音乐"}</strong><span>{audioSettings.durationSec}秒</span><span>{audioSettings.bpm} BPM</span><span>{audioSettings.inferenceSteps}步</span><DisclosureChevron className="free-node-settings-chevron" expanded={audioSettingsOpen} /></button>
        {audioSettingsOpen && <section className="free-node-audio-settings-popover" aria-label="ACE-Step音频生成参数">
          <header><div><span>ACE-STEP 1.5</span><strong>音频生成参数</strong></div><small>本机 Turbo · 48kHz WAV</small></header>
          <fieldset><legend>音频类型</legend><div><button type="button" className={audioSettings.mode === "instrumental" ? "selected" : ""} onClick={() => patchAudioSettings({ mode: "instrumental" })}><strong>纯音乐</strong><small>器乐配乐</small></button><button type="button" className={audioSettings.mode === "song" ? "selected" : ""} onClick={() => patchAudioSettings({ mode: "song" })}><strong>歌曲</strong><small>歌词与歌声</small></button></div></fieldset>
          {audioSettings.mode === "song" && <fieldset className="free-node-audio-lyrics"><legend><span>歌词</span><b>{audioSettings.lyrics.length}/4096</b></legend><textarea value={audioSettings.lyrics} maxLength={4_096} placeholder="使用 [Verse]、[Chorus] 等结构标签填写歌词……" onChange={(event) => patchAudioSettings({ lyrics: event.target.value })} /></fieldset>}
          <fieldset className="free-node-video-range"><legend><span>目标时长</span><b>{audioSettings.durationSec}秒</b></legend><input type="range" min="5" max="300" step="1" value={audioSettings.durationSec} style={{ "--range-progress": `${((audioSettings.durationSec - 5) / 295) * 100}%` } as CSSProperties} onChange={(event) => patchAudioSettings({ durationSec: Number(event.target.value) })} /><div><span>5秒</span>{[30, 60, 120].map((durationSec) => <button type="button" key={durationSec} onClick={() => patchAudioSettings({ durationSec })}>{durationSec}秒</button>)}<span>300秒</span></div></fieldset>
          <div className="free-node-audio-setting-grid"><label className="free-node-audio-bpm"><span>BPM</span><div className="free-node-audio-bpm-control"><button type="button" aria-label="BPM减少1" onClick={() => stepBpm(-1)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); stepBpm(-1); } }}>−</button><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={bpmDraft} aria-label="BPM数值" onChange={(event) => { if (/^\d{0,3}$/u.test(event.target.value)) setBpmDraft(event.target.value); }} onBlur={commitBpmDraft} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { setBpmDraft(String(audioSettings.bpm)); event.currentTarget.blur(); } else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); stepBpm(event.key === "ArrowUp" ? 1 : -1); } }} /><button type="button" aria-label="BPM增加1" onClick={() => stepBpm(1)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); stepBpm(1); } }}>＋</button></div></label><label><span>调性</span><input type="text" maxLength={80} value={audioSettings.keyScale} onChange={(event) => patchAudioSettings({ keyScale: event.target.value })} /></label><label><span>拍号</span><select value={audioSettings.timeSignature} onChange={(event) => patchAudioSettings({ timeSignature: event.target.value as FreeCanvasAudioSettings["timeSignature"] })}><option value="2">2/4</option><option value="3">3/4</option><option value="4">4/4</option><option value="6">6/8</option></select></label><label><span>演唱语言</span><select value={audioSettings.vocalLanguage} disabled={audioSettings.mode !== "song"} onChange={(event) => patchAudioSettings({ vocalLanguage: event.target.value })}><option value="zh">中文</option><option value="en">英文</option><option value="ja">日文</option><option value="ko">韩文</option><option value="es">西班牙语</option><option value="fr">法语</option></select></label></div>
          <fieldset className="free-node-video-range"><legend><span>Turbo步数</span><b>{audioSettings.inferenceSteps}步</b></legend><input type="range" min="1" max="20" step="1" value={audioSettings.inferenceSteps} style={{ "--range-progress": `${((audioSettings.inferenceSteps - 1) / 19) * 100}%` } as CSSProperties} onChange={(event) => patchAudioSettings({ inferenceSteps: Number(event.target.value) })} /><div><span>1步</span>{[4, 8, 12].map((inferenceSteps) => <button type="button" key={inferenceSteps} onClick={() => patchAudioSettings({ inferenceSteps })}>{inferenceSteps}步</button>)}<span>20步</span></div></fieldset>
          <div className="free-node-audio-setting-grid"><label><span>Seed</span><input type="number" min="0" max="2147483647" value={audioSettings.seed} onChange={(event) => patchAudioSettings({ seed: Number(event.target.value) })} /></label><button type="button" role="switch" aria-checked={audioSettings.thinking} className={`free-node-audio-thinking ${audioSettings.thinking ? "selected" : ""}`} onClick={() => patchAudioSettings({ thinking: !audioSettings.thinking })}><i /><span><strong>Thinking</strong><small>由作曲模型补全结构</small></span></button></div>
          <footer><span>参数保存到当前音频节点</span><small>生成完成后试听验收</small></footer>
        </section>}
      </div>}
      {item.kind !== "director" && <div className="free-node-model-selectors" aria-label="当前模型">
        <label><span>文字模型</span><select value={agentProvider?.activeProfileId || ""} onChange={(event) => onProviderProfile("agent", event.target.value)} disabled={!agentProvider?.profiles.length}><option value="" disabled>{agentProvider?.profiles.length ? "选择模型" : "未配置"}</option>{agentProvider?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select><DisclosureChevron /></label>
        {item.kind === "image" && <label><span>{imageProviderKind === "image-edit" ? "参考图模型" : "图片模型"}</span><select value={imageProvider?.activeProfileId || ""} onChange={(event) => onProviderProfile(imageProviderKind, event.target.value)} disabled={!imageProvider?.profiles.length}><option value="" disabled>{imageProvider?.profiles.length ? "选择模型" : "未配置"}</option>{imageProvider?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select><DisclosureChevron /></label>}
      </div>}
      {visibleError && <p className="free-node-optimize-error">{visibleError}</p>}
      <footer><span>{draftContent.length}/{item.kind === "audio" ? 2_000 : 20_000} · 停顿后自动保存</span><div>
        {item.kind !== "director" && <button className={`free-node-optimize ${optimizing ? "is-optimizing" : ""}`} disabled={(!draftContent.trim() && !references.some((reference) => reference.title.trim() || reference.content.trim())) || draftContent.length > 5_000 || optimizing || generationActive} title={optimizing ? "文字Agent正在优化提示词" : item.kind === "text" ? `按${textOptimizationTarget === "script" ? "剧本" : textOptimizationTarget === "image" ? "图片提示词" : "视频提示词"}扩写 · 调用文字Agent` : `按${nodeLabels[item.kind]}格式优化 · 调用文字Agent`} aria-label={optimizing ? "文字Agent正在优化提示词" : item.kind === "text" ? `按${textOptimizationTarget === "script" ? "剧本" : textOptimizationTarget === "image" ? "图片提示词" : "视频提示词"}扩写 · 调用文字Agent` : `按${nodeLabels[item.kind]}格式优化 · 调用文字Agent`} aria-busy={optimizing} onClick={() => void runOptimization()}>{optimizing ? <PromptOptimizationLoader /> : <PromptWandIcon />}</button>}
        {item.kind === "image" ? <button className={`free-node-editor-done ${generationActive ? "is-generating" : ""}`} disabled={generationActive || optimizing || (!draftContent.trim() && !references.some((reference) => reference.content.trim()))} onClick={() => void runImageGeneration()} aria-label={generationActive ? "正在生成图片" : "生成图片"} title={generationActive ? "正在生成图片" : "生成图片"}>{generationActive ? <ImageGenerationLoader /> : <GenerateArrowIcon />}</button>
          : item.kind === "video" ? <button className={`free-node-editor-done ${generationActive ? "is-generating" : ""}`} disabled={generationActive || optimizing || (!draftContent.trim() && !references.some((reference) => reference.content.trim()))} onClick={() => void runVideoGeneration()} aria-label={generationActive ? "正在生成视频" : `生成视频 · ${videoEngineLabel(videoSettings.engine)}`} title={generationActive ? "正在生成视频" : `生成视频 · ${videoEngineLabel(videoSettings.engine)}`}>{generationActive ? <ImageGenerationLoader /> : <GenerateArrowIcon />}</button>
            : item.kind === "audio" ? <button className={`free-node-editor-done ${generationActive ? "is-generating" : ""}`} disabled={generationActive || optimizing || (!draftContent.trim() && !references.some((reference) => reference.kind === "text" && reference.content.trim())) || (audioSettings.mode === "song" && !audioSettings.lyrics.trim())} onClick={() => void runAudioGeneration()} aria-label={generationActive ? "正在生成音频" : "生成音频 · 调用本机ACE-Step 1.5"} title={generationActive ? "正在生成音频" : "生成音频 · 调用本机ACE-Step 1.5"}>{generationActive ? <ImageGenerationLoader /> : <GenerateArrowIcon />}</button>
              : <button className="free-node-editor-done" onPointerDown={requestEditorClose} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); closeEditor(); } }} aria-label="保存并收起"><GenerateArrowIcon /></button>}
      </div></footer>
      {item.kind !== "director" && <small className="free-node-api-note">{item.kind === "text" ? `魔法棒会按已选目标扩写完整${textOptimizationTarget === "script" ? "剧本" : textOptimizationTarget === "image" ? "图片提示词" : "视频提示词"}。` : `按${nodeLabels[item.kind]}节点格式优化，并读取已连接的上游文字。`} {item.kind === "image" ? `已有图片会自动作为@图片1；向上箭头按当前参数生成${imageSettings.count}张图片。` : item.kind === "video" ? usesCloudVideo(videoSettings) ? "云端视频使用已连接的图片参考；本节点已有视频保留为结果。" : "已有视频会自动作为@视频1，可用于全能参考编辑、动作借鉴或视频扩展。" : item.kind === "audio" ? `向上箭头按当前${audioSettings.mode === "song" ? "歌曲" : "纯音乐"}参数提交本机ACE-Step 1.5。` : "魔法棒用于优化当前内容；"} 失败不重试，原文、参数和旧结果保留。</small>}
      {item.generation?.externalTaskId?.startsWith("cv-") && <CloudVideoTaskActions taskId={item.generation.externalTaskId} phase={item.generation.parameters?.phase} />}{item.sourceRef && <button className="free-node-return" onClick={() => onReturnToDirector(item.sourceRef!)}>回到导演模式中的来源资产</button>}
    </section>, data.editorHost)}
    <Handle id="right" className="free-node-handle free-node-handle-output" type="source" position={Position.Right} aria-label={`${item.title}右侧输出端口`} onMouseMove={magnetizeHandle} onMouseLeave={releaseHandleMagnet}><span>+</span></Handle>
  </article>;
}

const MemoizedFreeNodeCard = memo(FreeNodeCard, (previous, next) => previous.data === next.data && previous.selected === next.selected);
const nodeTypes = { freeNode: MemoizedFreeNodeCard };

export function FreeCanvasWorkspace(props: React.ComponentProps<typeof FreeCanvasWorkspaceContent> & { projectId?: string }) {
  return <FreeCanvasWorkspaceContent key={props.projectId} {...props} />;
}

function FreeCanvasWorkspaceContent({ state, sources, providers, onProviderProfile, onChange: onStateChange, onReturnToDirector, onOptimizePrompt, onGenerateImage, onProcessImage, onGenerateVideo, onGenerateAudio, onImportMedia }: {
  state: FreeCanvasState;
  sources: DirectorCanvasSource[];
  providers: FreeCanvasProviderStatus[];
  onProviderProfile: (kind: FreeCanvasProviderKind, profileId: string) => void;
  onChange: React.Dispatch<React.SetStateAction<FreeCanvasState>>;
  onReturnToDirector: (source: DirectorSourceRef) => void;
  onOptimizePrompt: FreeNodeData["optimizePrompt"];
  onGenerateImage: (nodeId: string, taskId: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasImageSettings) => Promise<{ imageUrls: string[]; provider: string; status: "complete" | "partial"; warning?: string }>;
  onProcessImage: (input: { taskId: string; mediaUrl: string; operation: "rotate-clockwise" | "rotate-counterclockwise" | "upscale"; upscaleScale?: 2 | 4; upscaleModel?: "general" | "anime" }) => Promise<{ imageUrl: string; provider: string; operation: "rotate-clockwise" | "rotate-counterclockwise" | "upscale"; outputWidth: number; outputHeight: number; parameters: Record<string, unknown> }>;
  onGenerateVideo: FreeNodeData["generateVideo"];
  onGenerateAudio: FreeNodeData["generateAudio"];
  onImportMedia: (blob: Blob, name: string, expectedKind: Exclude<FreeCanvasImportKind, "text">) => Promise<{ kind: Exclude<FreeCanvasImportKind, "text">; originalName: string; mediaUrl: string }>;
}) {
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const liveViewportRef = useRef<Viewport>(state.view);
  const connectStartRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const copiedNodeRef = useRef<CanvasClipboard | null>(null);
  const historyRef = useRef(new FreeCanvasHistory());
  const historyGroupRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const editingRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const [pendingNodeMenu, setPendingNodeMenu] = useState<PendingNodeMenu | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenu | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState("");
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [displayZoom, setDisplayZoom] = useState(state.view.zoom);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [imageViewer, setImageViewer] = useState<{ src: string; title: string } | null>(null);
  const [imageToolDialog, setImageToolDialog] = useState<ImageToolDialog | null>(null);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [imageToolError, setImageToolError] = useState("");
  const [imageAiOperation, setImageAiOperation] = useState<ImageAiOperation>("outpaint");
  const [imageAiInstruction, setImageAiInstruction] = useState("");
  const [imageAiSize, setImageAiSize] = useState<"square" | "landscape" | "portrait">("landscape");
  const [imageUpscaleScale, setImageUpscaleScale] = useState<2 | 4>(2);
  const [imageUpscaleModel, setImageUpscaleModel] = useState<"general" | "anime">("general");
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibraryItems, setAssetLibraryItems] = useState<FreeCanvasAssetLibraryItem[]>([]);
  const [assetLibraryFolders, setAssetLibraryFolders] = useState<string[]>([]);
  const [assetLibraryScope, setAssetLibraryScope] = useState<"project" | "library">("library");
  const [assetLibraryQuery, setAssetLibraryQuery] = useState("");
  const [assetLibraryFilter, setAssetLibraryFilter] = useState<"all" | "character" | "scene" | "prop" | "style" | "image" | "video" | "audio">("all");
  const [assetLibraryFolder, setAssetLibraryFolder] = useState("__all__");
  const [assetLibraryBusy, setAssetLibraryBusy] = useState(false);
  const [assetLibraryError, setAssetLibraryError] = useState("");
  const [assetLibraryNotice, setAssetLibraryNotice] = useState("");
  const [assetLibraryEditingId, setAssetLibraryEditingId] = useState<string | null>(null);
  const [assetLibraryEditDraft, setAssetLibraryEditDraft] = useState<FreeCanvasAssetEditDraft>({ name: "", description: "", folder: "", favorite: false, tags: "" });
  const [mediaHistoryOpen, setMediaHistoryOpen] = useState(false);
  const [mediaHistoryKind, setMediaHistoryKind] = useState<FreeCanvasMediaHistoryKind>("image");
  const [mediaHistoryZoom, setMediaHistoryZoom] = useState(100);
  const [mediaHistoryDescending, setMediaHistoryDescending] = useState(true);
  const [mediaHistoryBatchMode, setMediaHistoryBatchMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nextHistory = collectNodeMediaHistory(state.nodes, state.mediaHistory);
    if (nextHistory.length === state.mediaHistory.length && nextHistory.every((item, index) => item.id === state.mediaHistory[index]?.id)) return;
    onStateChange((current) => {
      const merged = collectNodeMediaHistory(current.nodes, current.mediaHistory);
      return merged.length === current.mediaHistory.length && merged.every((item, index) => item.id === current.mediaHistory[index]?.id)
        ? current : { ...current, mediaHistory: merged };
    });
  }, [onStateChange, state.mediaHistory, state.nodes]);

  const mediaHistoryCounts = useMemo(() => ({
    image: state.mediaHistory.filter((item) => item.kind === "image").length,
    video: state.mediaHistory.filter((item) => item.kind === "video").length,
    audio: state.mediaHistory.filter((item) => item.kind === "audio").length,
  }), [state.mediaHistory]);
  const visibleMediaHistory = useMemo(() => state.mediaHistory
    .filter((item) => item.kind === mediaHistoryKind)
    .sort((a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) * (mediaHistoryDescending ? 1 : -1)),
  [mediaHistoryDescending, mediaHistoryKind, state.mediaHistory]);
  const groupedMediaHistory = useMemo(() => {
    const groups = new Map<string, FreeCanvasMediaHistoryItem[]>();
    for (const item of visibleMediaHistory) {
      const date = new Date(item.createdAt);
      const key = Number.isNaN(date.getTime()) ? "日期未记录" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return [...groups.entries()];
  }, [visibleMediaHistory]);
  const selectedMediaHistory = useMemo(() => state.mediaHistory.filter((item) => selectedHistoryIds.has(item.id)), [selectedHistoryIds, state.mediaHistory]);

  const remember = useCallback(() => {
    historyGroupRef.current += 1;
  }, []);
  const onChange = useCallback((update: React.SetStateAction<FreeCanvasState>) => {
    const previous = stateRef.current;
    const next = typeof update === "function" ? update(previous) : update;
    const capacityError = canvasRemovalError(previous, next) || freeCanvasCapacityError(next, previous);
    if (capacityError) { setCanvasNotice(capacityError); return false; }
    historyRef.current.record(previous, next, historyGroupRef.current);
    stateRef.current = next;
    // Apply against React's latest state so concurrent provider writes are retained.
    onStateChange((current) => {
      const result = typeof update === "function" ? update(current) : update;
      return canvasRemovalError(current, result) || freeCanvasCapacityError(result, current) ? current : result;
    });
    setHistoryTick((value) => value + 1);
    return true;
  }, [onStateChange]);
  const openNodeContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    setPendingNodeMenu(null);
    setCanvasContextMenu(null);
    setEditingNodeId(null);
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedEdgeIds(new Set());
    setNodeContextMenu({
      left: Math.max(10, Math.min(rect.width - 226, event.clientX - rect.left)),
      top: Math.max(10, Math.min(rect.height - 420, event.clientY - rect.top)),
      nodeId,
    });
  }, []);
  const beginEdit = useCallback(() => {
    if (editingRef.current) return;
    editingRef.current = true;
    remember();
  }, [remember]);
  const patchNode = useCallback((nodeId: string, patch: Partial<FreeCanvasNode>, separateOperation = false) => {
    if (separateOperation || !editingRef.current) remember();
    onChange((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === nodeId ? { ...item, ...patch } : item) }));
  }, [onChange, remember]);
  const patchResult = useCallback((nodeId: string, patch: Partial<FreeCanvasNode>) => {
    const update = (current: FreeCanvasState): FreeCanvasState => ({ ...current, nodes: current.nodes.map((item) => item.id === nodeId ? { ...item, ...patch } : item) });
    stateRef.current = update(stateRef.current);
    onStateChange(update);
  }, [onStateChange]);
  const closeNodeEditor = useCallback(() => setEditingNodeId(null), []);
  const ensureCapacity = useCallback((nodes: number, edges = 0) => {
    const current = stateRef.current;
    const error = freeCanvasCapacityError({ nodes: [...current.nodes, ...Array(nodes)], edges: [...current.edges, ...Array(edges)] }, current);
    if (error) setCanvasNotice(error);
    return !error;
  }, []);
  const removeReference = useCallback((targetNodeId: string, sourceNodeId: string) => {
    if (!state.edges.some((edge) => edge.fromNodeId === sourceNodeId && edge.toNodeId === targetNodeId)) return;
    remember();
    onChange((current) => ({ ...current, edges: current.edges.filter((edge) => !(edge.fromNodeId === sourceNodeId && edge.toNodeId === targetNodeId)) }));
  }, [onChange, remember, state.edges]);

  function createDerivedImageNode(source: FreeCanvasNode, title: string, content: string, taskId: string, provider: string) {
    remember();
    const node: FreeCanvasNode = {
      id: nextId("node"), kind: "image", title, content,
      x: source.x + 360, y: source.y + Math.min(180, state.nodes.filter((item) => item.x > source.x).length * 24),
      imageSettings: normalizeImageSettings({ ...source.imageSettings, count: 1 }),
      createdAt: new Date().toISOString(),
      generation: { status: "submitting", taskId, provider, updatedAt: new Date().toISOString() },
    };
    const edge: FreeCanvasEdge = { id: nextId("edge"), fromNodeId: source.id, toNodeId: node.id, sourceHandle: "right", targetHandle: "left" };
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, node], edges: [...current.edges, edge] }))) return;
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    return node;
  }

  async function runLocalImageTool(source: FreeCanvasNode, operation: "rotate-clockwise" | "rotate-counterclockwise" | "upscale") {
    if (!source.mediaUrl || imageToolBusy) return;
    const taskId = nextId(`free-canvas-${operation}`);
    const label = operation === "upscale" ? `Real-ESRGAN ${imageUpscaleScale}×超分` : operation === "rotate-clockwise" ? "向右旋转" : "向左旋转";
    const node = createDerivedImageNode(source, `${source.title} · ${label}`, label, taskId, "local-image-tools");
    if (!node) return;
    setImageToolBusy(true);
    setImageToolError("");
    if (operation === "upscale") {
      setImageToolDialog(null);
      setCanvasNotice(`${label}已开始`);
    }
    try {
      const result = await onProcessImage({ taskId, mediaUrl: source.mediaUrl, operation, upscaleScale: imageUpscaleScale, upscaleModel: imageUpscaleModel });
      const rotatedSettings = operation.startsWith("rotate") && source.imageSettings && source.imageSettings.width !== source.imageSettings.height
        ? normalizeImageSettings({ ...source.imageSettings, width: source.imageSettings.height, height: source.imageSettings.width, count: 1 })
        : normalizeImageSettings({ ...source.imageSettings, count: 1 });
      patchResult(node.id, {
        mediaUrl: result.imageUrl, mediaUrls: [result.imageUrl], imageSettings: rotatedSettings,
        generation: { status: "complete", taskId, provider: result.provider, outputPaths: [result.imageUrl], updatedAt: new Date().toISOString() },
      });
      setImageToolDialog(null);
      setCanvasNotice(`${label}完成，已生成新节点`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label}没有完成，原图已保留。`;
      patchResult(node.id, { generation: { status: "failed", taskId, provider: "local-image-tools", error: message, updatedAt: new Date().toISOString() } });
      setImageToolError(message);
      setCanvasNotice(`${label}未完成，可在结果节点查看错误`);
    } finally {
      setImageToolBusy(false);
    }
  }

  async function runAiImageDerivation(source: FreeCanvasNode) {
    if (!source.mediaUrl || imageToolBusy) return;
    const meta = imageAiOperationMeta[imageAiOperation];
    const prompt = buildImageAiPrompt(imageAiOperation, imageAiInstruction);
    const taskId = nextId(`free-canvas-${imageAiOperation}`);
    const node = createDerivedImageNode(source, `${source.title} · ${meta.label}`, prompt, taskId, "image-edit");
    if (!node) return;
    const resolution = normalizeImageSettings(source.imageSettings).resolution;
    const size = imageRequestSizeForAspectRatio(
      imageAiOperation === "character-turnaround" || imageAiOperation === "scene-multiview" || imageAiSize === "landscape" ? "3:2" : imageAiSize === "portrait" ? "2:3" : "1:1",
      resolution,
    );
    const settings = normalizeImageSettings({ ...source.imageSettings, ...size, count: 1, outputFormat: "png" });
    const reference: FreeCanvasReference = { id: source.id, kind: "image", title: source.title, content: source.content, mediaUrl: source.mediaUrl, generation: source.generation };
    patchResult(node.id, { imageSettings: settings });
    setImageToolBusy(true);
    setImageToolError("");
    try {
      const result = await onGenerateImage(node.id, taskId, prompt, [reference], settings);
      patchResult(node.id, {
        mediaUrl: result.imageUrls[0], mediaUrls: result.imageUrls,
        generation: { status: result.status, taskId, provider: result.provider, outputPaths: result.imageUrls, error: result.warning, updatedAt: new Date().toISOString() },
      });
      setImageToolDialog(null);
      setCanvasNotice(`${meta.label}完成，已生成新节点`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${meta.label}没有完成，原图和参数已保留。`;
      patchResult(node.id, { generation: { status: "failed", taskId, provider: "image-edit", error: message, updatedAt: new Date().toISOString() } });
      setImageToolError(message);
    } finally {
      setImageToolBusy(false);
    }
  }

  const imageAction = useCallback((nodeId: string, action: "view" | "rotate-clockwise" | "rotate-counterclockwise" | "upscale" | "edit") => {
    const source = state.nodes.find((item) => item.id === nodeId && item.kind === "image" && item.mediaUrl);
    if (!source?.mediaUrl) return;
    setImageToolError("");
    if (action === "view") { setImageViewer({ src: source.mediaUrl, title: source.title }); return; }
    if (action === "upscale") { setImageToolDialog({ sourceNodeId: nodeId, mode: "upscale" }); return; }
    if (action === "edit") { setImageAiInstruction(""); setImageToolDialog({ sourceNodeId: nodeId, mode: "ai" }); return; }
    void runLocalImageTool(source, action);
  }, [state.nodes]);

  useEffect(() => {
    const stopEditing = () => { editingRef.current = false; };
    window.addEventListener("focusout", stopEditing);
    return () => window.removeEventListener("focusout", stopEditing);
  }, []);

  useEffect(() => {
    setFlowNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      const domainNodes = new Map(state.nodes.map((item) => [item.id, item]));
      const incoming = new Map<string, FreeCanvasReference[]>();
      for (const edge of state.edges) {
        const source = domainNodes.get(edge.fromNodeId);
        if (!source) continue;
        const references = incoming.get(edge.toNodeId) || [];
        references.push({ purpose: edge.purpose, id: source.id, kind: source.kind, title: source.title, content: source.content, mediaUrl: source.mediaUrl, mediaDurationSec: source.mediaDurationSec, videoSettings: source.videoSettings, generation: source.generation });
        incoming.set(edge.toNodeId, references);
      }
      return state.nodes.map((item) => {
        const previous = existing.get(item.id);
        const editorOpen = editingNodeId === item.id;
        const nodeSelected = selectedNodeIds.has(item.id);
        const references = incoming.get(item.id) || [];
        const sameReferences = previous?.data.references.length === references.length
          && previous.data.references.every((reference, index) => reference.id === references[index]?.id
            && reference.purpose === references[index]?.purpose
            && reference.kind === references[index]?.kind
            && reference.title === references[index]?.title
            && reference.content === references[index]?.content
            && reference.mediaUrl === references[index]?.mediaUrl
            && reference.mediaDurationSec === references[index]?.mediaDurationSec
            && reference.generation === references[index]?.generation
            && reference.videoSettings === references[index]?.videoSettings);
        const stableData = previous
          && previous.data.editorHost === editorHost
          && previous.data.item === item
          && previous.data.patchNode === patchNode
          && previous.data.beginEdit === beginEdit
          && previous.data.onReturnToDirector === onReturnToDirector
          && previous.data.optimizePrompt === onOptimizePrompt
          && previous.data.generateImage === onGenerateImage
           && previous.data.generateVideo === onGenerateVideo
          && previous.data.generateAudio === onGenerateAudio
          && previous.data.imageAction === imageAction
          && previous.data.openContextMenu === openNodeContextMenu
          && previous.data.providers === providers
          && previous.data.onProviderProfile === onProviderProfile
          && sameReferences
          && previous.data.editorOpen === editorOpen
          && previous.selected === nodeSelected;
        const savedPosition = { x: item.x, y: item.y };
        if (stableData && previous.position.x === savedPosition.x && previous.position.y === savedPosition.y) return previous;
        return {
          id: item.id,
          type: "freeNode",
          position: savedPosition,
          selected: nodeSelected,
          data: {
            item, editorHost, patchNode, patchResult, beginEdit, onReturnToDirector, optimizePrompt: onOptimizePrompt, generateImage: onGenerateImage, generateVideo: onGenerateVideo, generateAudio: onGenerateAudio, imageAction, openContextMenu: openNodeContextMenu, providers, onProviderProfile,
            references,
            removeReference: (sourceNodeId: string) => removeReference(item.id, sourceNodeId),
            editorOpen,
            showEditor: () => { setEditingNodeId(item.id); setSelectedNodeIds(new Set([item.id])); setSelectedEdgeIds(new Set()); },
            hideEditor: closeNodeEditor,
          },
        } satisfies FlowNode;
      });
    });
  }, [beginEdit, closeNodeEditor, editorHost, editingNodeId, imageAction, onGenerateAudio, onGenerateImage, onGenerateVideo, onOptimizePrompt, onProviderProfile, onReturnToDirector, openNodeContextMenu, patchNode, patchResult, providers, removeReference, selectedNodeIds, state.edges, state.nodes]);
  const flowEdges = useMemo<FreeCanvasFlowEdge[]>(() => {
    return state.edges.map((item) => {
      const selected = selectedEdgeIds.has(item.id);
      const connectedToSelectedNode = selectedNodeIds.has(item.fromNodeId) || selectedNodeIds.has(item.toNodeId);
      return {
        id: item.id,
        source: item.fromNodeId,
        target: item.toNodeId,
        sourceHandle: item.sourceHandle,
        targetHandle: item.targetHandle,
        selected,
        className: connectedToSelectedNode ? "free-edge-active" : undefined,
        type: "freeRoute",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: selected ? "#ff62c2" : "#8daac0" },
        label: referencePurposeLabels[item.purpose || referencePurposes(state.nodes.find(n => n.id === item.fromNodeId)?.kind || "", state.nodes.find(n => n.id === item.toNodeId)?.kind || "")[0]] || "待调整的引用",
        data: { purpose: item.purpose },
        style: { stroke: selected ? "#ff62c2" : connectedToSelectedNode ? "#8dd8ff" : "#6d91ae", strokeWidth: selected || connectedToSelectedNode ? 2.4 : 1.8 },
      };
    });
  }, [selectedEdgeIds, selectedNodeIds, state.edges, state.nodes]);

  const addNode = useCallback((kind: FreeCanvasNodeKind, source?: DirectorCanvasSource, at?: { x: number; y: number }) => {
    const existing = source && state.nodes.find((item) => item.sourceRef?.type === source.sourceRef.type && item.sourceRef?.stableId === source.sourceRef.stableId);
    if (existing) {
      setSelectedNodeIds(new Set([existing.id]));
      void flowRef.current?.fitView({ nodes: [{ id: existing.id }], duration: 350, padding: 1.4, maxZoom: 1 });
      return existing.id;
    }
    remember();
    const index = state.nodes.length;
    const node: FreeCanvasNode = {
      id: nextId("node"), kind: source?.kind || kind, title: source?.title || `新${nodeLabels[kind]}节点`, content: source?.content || "",
      mediaUrl: source?.mediaUrl, sourceRef: source?.sourceRef,
      x: at?.x ?? Math.round((180 - state.view.x) / state.view.zoom + (index % 3) * 380),
      y: at?.y ?? Math.round((150 - state.view.y) / state.view.zoom + Math.floor(index / 3) * 290), createdAt: new Date().toISOString(),
    };
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, node] }))) return;
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    return node.id;
  }, [onChange, remember, state.nodes, state.view.x, state.view.y, state.view.zoom]);

  const addImportedNodes = useCallback((drafts: ImportedNodeDraft[], at: { x: number; y: number }) => {
    if (!drafts.length) return;
    remember();
    const createdAt = new Date().toISOString();
    const nodes = drafts.map((draft, index): FreeCanvasNode => ({
      id: nextId("node"), kind: draft.kind, title: draft.title.slice(0, 160), content: (draft.content || "").slice(0, 20_000), mediaUrl: draft.mediaUrl,
      x: Math.round(at.x - 150 + (index % 3) * 330), y: Math.round(at.y - 70 + Math.floor(index / 3) * 250), createdAt,
    }));
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, ...nodes] }))) return;
    setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
    setSelectedEdgeIds(new Set());
    setCanvasNotice(`已加入 ${nodes.length} 个节点`);
  }, [onChange, remember]);

  const addHistoryItemsToCanvas = useCallback((items: FreeCanvasMediaHistoryItem[]) => {
    if (!items.length) return;
    const viewport = viewportRef.current?.getBoundingClientRect();
    const center = flowRef.current?.screenToFlowPosition({ x: (viewport?.left || 0) + (viewport?.width || 960) / 2, y: (viewport?.top || 0) + (viewport?.height || 640) / 2 })
      || { x: Math.round((480 - state.view.x) / state.view.zoom), y: Math.round((320 - state.view.y) / state.view.zoom) };
    remember();
    const createdAt = new Date().toISOString();
    const nodes = items.map((item, index): FreeCanvasNode => ({
      id: nextId("node"), kind: item.kind, title: item.title, content: item.prompt, mediaUrl: item.mediaUrl,
      mediaUrls: item.kind === "image" ? [item.mediaUrl] : undefined,
      mediaDurationSec: item.kind === "video" ? item.mediaDurationSec : undefined,
      x: Math.round(center.x - 150 + (index % 4) * 330), y: Math.round(center.y - 90 + Math.floor(index / 4) * 250), createdAt,
    }));
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, ...nodes] }))) return;
    setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
    setSelectedEdgeIds(new Set());
    setMediaHistoryOpen(false);
    setMediaHistoryBatchMode(false);
    setSelectedHistoryIds(new Set());
    setCanvasNotice(`已从历史加入 ${nodes.length} 个媒体节点`);
  }, [onChange, remember, state.view.x, state.view.y, state.view.zoom]);

  const downloadHistoryItems = useCallback((items: FreeCanvasMediaHistoryItem[]) => {
    items.forEach((item, index) => {
      window.setTimeout(() => {
        const anchor = document.createElement("a");
        anchor.href = item.mediaUrl;
        anchor.download = item.title;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }, index * 120);
    });
    setCanvasNotice(`已开始下载 ${items.length} 个历史媒体`);
  }, []);

  const createSelectionCopy = useCallback((source: CanvasClipboard, at: { x: number; y: number }) => {
    const copied = pasteCanvasSelection(source, at, nextId, new Date().toISOString());
    if (!copied.nodes.length) return;
    remember();
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, ...copied.nodes], edges: [...current.edges, ...copied.edges] }))) return;
    setSelectedNodeIds(new Set(copied.nodes.map((node) => node.id)));
    setSelectedEdgeIds(new Set());
    setEditingNodeId(null);
    setNodeContextMenu(null);
    setCanvasNotice(`已创建 ${copied.nodes.length} 个节点副本，保留 ${copied.edges.length} 条内部连线`);
    return copied.nodes[0];
  }, [onChange, remember]);

  const copyNode = useCallback((node: FreeCanvasNode) => {
    copiedNodeRef.current = copyCanvasSelection([node], [], new Set([node.id]));
    setNodeContextMenu(null);
    setCanvasNotice("节点已复制，可在画布粘贴");
  }, []);

  const duplicateNode = useCallback((node: FreeCanvasNode) => {
    createSelectionCopy(copyCanvasSelection([node], [], new Set([node.id])), { x: node.x + 44, y: node.y + 44 });
  }, [createSelectionCopy]);
  const copySelection = useCallback(() => {
    copiedNodeRef.current = copyCanvasSelection(state.nodes, state.edges, selectedNodeIds);
    setCanvasNotice(`已复制 ${copiedNodeRef.current.nodes.length} 个节点，可在画布粘贴`);
  }, [selectedNodeIds, state.edges, state.nodes]);
  const duplicateSelection = useCallback(() => {
    const selection = copyCanvasSelection(state.nodes, state.edges, selectedNodeIds);
    if (!selection.nodes.length) return;
    createSelectionCopy(selection, { x: Math.min(...selection.nodes.map((node) => node.x)) + 44, y: Math.min(...selection.nodes.map((node) => node.y)) + 44 });
  }, [createSelectionCopy, selectedNodeIds, state.edges, state.nodes]);
  const deleteSelection = useCallback(() => {
    if (!selectedNodeIds.size && !selectedEdgeIds.size) return;
    remember();
    const applied = onChange((current) => ({ ...current,
      nodes: current.nodes.filter((node) => !selectedNodeIds.has(node.id)),
      edges: current.edges.filter((edge) => !selectedEdgeIds.has(edge.id) && !selectedNodeIds.has(edge.fromNodeId) && !selectedNodeIds.has(edge.toNodeId)),
    }));
    if (!applied) return;
    setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); setEditingNodeId(null);
    setCanvasNotice("所选内容已删除，可撤销");
  }, [onChange, remember, selectedEdgeIds, selectedNodeIds]);

  const disconnectNode = useCallback((nodeId: string) => {
    if (!state.edges.some((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId)) return;
    remember();
    onChange((current) => ({ ...current, edges: current.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) }));
    setNodeContextMenu(null);
    setCanvasNotice("节点连线已断开，可撤销");
  }, [onChange, remember, state.edges]);

  const deleteNode = useCallback((nodeId: string) => {
    remember();
    const applied = onChange((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    }));
    if (!applied) return;
    setNodeContextMenu(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setCanvasNotice("节点已删除，可撤销");
  }, [onChange, remember]);

  const writeClipboardText = useCallback(async (value: string, notice: string) => {
    copiedNodeRef.current = null;
    await navigator.clipboard.writeText(value);
    setNodeContextMenu(null);
    setCanvasNotice(notice);
  }, []);

  const copyImageToClipboard = useCallback(async (node: FreeCanvasNode) => {
    if (!node.mediaUrl || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前浏览器没有开放图片剪贴板权限。");
    const response = await fetch(node.mediaUrl);
    if (!response.ok) throw new Error("图片读取失败。");
    const sourceBlob = await response.blob();
    let pngBlob = sourceBlob;
    if (sourceBlob.type !== "image/png") {
      const bitmap = await createImageBitmap(sourceBlob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
      pngBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片剪贴板转换失败。")), "image/png"));
    }
    copiedNodeRef.current = null;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    setNodeContextMenu(null);
    setCanvasNotice("图片已复制到系统剪贴板");
  }, []);

  const loadAssetLibrary = useCallback(async () => {
    setAssetLibraryBusy(true);
    setAssetLibraryError("");
    try {
      const response = await fetch("/api/asset-library", { cache: "no-store" });
      const body = await response.json() as { assets?: FreeCanvasAssetLibraryItem[]; folders?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error || "资产库读取失败。");
      setAssetLibraryItems(Array.isArray(body.assets) ? body.assets.map((asset) => ({ ...asset, folder: asset.folder || "", favorite: asset.favorite === true })) : []);
      setAssetLibraryFolders(Array.isArray(body.folders) ? body.folders : []);
    } catch (error) {
      setAssetLibraryError(error instanceof Error ? error.message : "资产库读取失败。");
    } finally {
      setAssetLibraryBusy(false);
    }
  }, []);

  const beginAssetLibraryEdit = useCallback((asset: FreeCanvasAssetLibraryItem) => {
    setAssetLibraryEditingId(asset.id);
    setAssetLibraryEditDraft({ name: asset.name, description: asset.description || "", folder: asset.folder || "", favorite: asset.favorite === true, tags: asset.tags.join("，") });
    setAssetLibraryError("");
    setAssetLibraryNotice("");
  }, []);

  const saveAssetLibraryEdit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assetLibraryEditingId || !assetLibraryEditDraft.name.trim() || assetLibraryBusy) return;
    setAssetLibraryBusy(true);
    setAssetLibraryError("");
    setAssetLibraryNotice("");
    try {
      const response = await fetch("/api/asset-library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: assetLibraryEditingId,
          patch: {
            name: assetLibraryEditDraft.name.trim(),
            description: assetLibraryEditDraft.description.trim(),
            folder: assetLibraryEditDraft.folder.trim(),
            favorite: assetLibraryEditDraft.favorite,
            tags: assetLibraryEditDraft.tags.split(/[，,\n]/u).map((tag) => tag.trim()).filter(Boolean),
          },
        }),
      });
      const body = await response.json() as { asset?: FreeCanvasAssetLibraryItem; assets?: FreeCanvasAssetLibraryItem[]; folders?: string[]; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error || "资产资料没有保存。");
      setAssetLibraryItems(Array.isArray(body.assets) ? body.assets : assetLibraryItems.map((item) => item.id === body.asset!.id ? body.asset! : item));
      setAssetLibraryFolders(Array.isArray(body.folders) ? body.folders : assetLibraryFolders);
      setAssetLibraryEditingId(null);
      setAssetLibraryNotice(`“${body.asset.name}”的资料已保存。`);
    } catch (error) {
      setAssetLibraryError(error instanceof Error ? error.message : "资产资料没有保存。");
    } finally {
      setAssetLibraryBusy(false);
    }
  }, [assetLibraryBusy, assetLibraryEditDraft, assetLibraryEditingId, assetLibraryFolders, assetLibraryItems]);

  useEffect(() => { if (assetLibraryOpen) void loadAssetLibrary(); }, [assetLibraryOpen, loadAssetLibrary]);

  const saveNodeAsAsset = useCallback(async (node: FreeCanvasNode) => {
    const type = node.kind === "director" ? "text" : node.kind;
    const hasPayload = type === "text" ? Boolean(node.content.trim()) : Boolean(node.mediaUrl);
    if (!hasPayload || assetLibraryBusy) return;
    setAssetLibraryBusy(true);
    setAssetLibraryError("");
    try {
      const media = type === "image" ? { mainImageUrl: node.mediaUrl, referenceImageUrls: node.mediaUrl ? [node.mediaUrl] : [] }
        : type === "video" ? { videoUrl: node.mediaUrl } : type === "audio" ? { audioUrl: node.mediaUrl } : {};
      const editingExisting = Boolean(node.libraryAssetRef?.assetId);
      const response = await fetch("/api/asset-library", {
        method: editingExisting ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingExisting ? {
          id: node.libraryAssetRef!.assetId,
          patch: { name: node.title, description: node.content.slice(0, 500), content: type === "text" ? node.content : "", prompt: type === "text" ? "" : node.content, media },
        } : {
          type, name: node.title, sourceAssetKey: node.sourceRef?.stableId || node.id,
          description: node.content.slice(0, 500), content: type === "text" ? node.content : "", prompt: type === "text" ? "" : node.content,
          tags: [node.kind, node.sourceRef?.type, node.generation?.provider].filter(Boolean),
          media,
        }),
      });
      const body = await response.json() as { asset?: FreeCanvasAssetLibraryItem; assets?: FreeCanvasAssetLibraryItem[]; error?: string };
      if (!response.ok || !body.asset) throw new Error(body.error || "资产没有保存。");
      setAssetLibraryItems(Array.isArray(body.assets) ? body.assets : [body.asset, ...assetLibraryItems]);
      patchNode(node.id, { libraryAssetRef: { assetId: body.asset.id, name: body.asset.name, version: body.asset.version } });
      setNodeContextMenu(null);
      setAssetLibraryOpen(true);
      setCanvasNotice(editingExisting ? "资产库内容已更新" : "已保存到资产库");
    } catch (error) {
      setAssetLibraryError(error instanceof Error ? error.message : "资产没有保存。");
      setCanvasNotice(error instanceof Error ? error.message : "资产没有保存。");
    } finally {
      setAssetLibraryBusy(false);
    }
  }, [assetLibraryBusy, assetLibraryItems, patchNode]);

  const addAssetNode = useCallback((asset: FreeCanvasAssetLibraryItem, at: { x: number; y: number }) => {
    const kind: Exclude<FreeCanvasNodeKind, "director"> | null = asset.type === "text" ? "text"
      : ["image", "character", "scene", "prop", "style"].includes(asset.type) ? "image"
        : asset.type === "video" ? "video" : asset.type === "audio" ? "audio" : null;
    const mediaUrl = kind === "image" ? asset.media.mainImageUrl : kind === "video" ? asset.media.videoUrl : kind === "audio" ? asset.media.audioUrl : undefined;
    if (!kind || (kind !== "text" && !mediaUrl)) { setAssetLibraryError("这个资产类型不能直接创建画布节点。"); return; }
    remember();
    const node: FreeCanvasNode = {
      id: nextId("node"), kind, title: asset.name, content: kind === "text" ? asset.content || asset.description || asset.prompt : asset.prompt || asset.description || "",
      mediaUrl, x: Math.round(at.x), y: Math.round(at.y), createdAt: new Date().toISOString(),
      libraryAssetRef: { assetId: asset.id, name: asset.name, version: asset.version },
    };
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, node] }))) return;
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setCanvasNotice(`已从资产库加入${nodeLabels[kind]}节点`);
  }, [onChange, remember]);

  const uploadImportedMedia = useCallback(async (blob: Blob, name: string, expectedKind: Exclude<FreeCanvasImportKind, "text">): Promise<ImportedNodeDraft> => {
    const asset = await onImportMedia(blob, name, expectedKind);
    return { kind: expectedKind, title: asset.originalName || name, mediaUrl: asset.mediaUrl };
  }, [onImportMedia]);

  const importFiles = useCallback(async (files: File[], at: { x: number; y: number }) => {
    if (!files.length || importBusy) return;
    if (!ensureCapacity(files.filter((file) => classifyFreeCanvasImport(file.name, file.type)).length)) return;
    setImportBusy(true);
    try {
      const drafts: ImportedNodeDraft[] = [];
      const errors: string[] = [];
      for (const file of files) {
        const kind = classifyFreeCanvasImport(file.name, file.type);
        if (!kind) { errors.push(`${file.name}：无法识别格式`); continue; }
        try {
          if (kind === "text") {
            const content = await file.text();
            if (content.length > 20_000) throw new Error("文本超过单节点 20000 字上限");
            drafts.push({ kind, title: file.name || "导入的文本", content });
          } else {
            drafts.push(await uploadImportedMedia(file, file.name || `导入的${nodeLabels[kind]}`, kind));
          }
        } catch (error) {
          errors.push(`${file.name || "文件"}：${error instanceof Error ? error.message : "导入失败"}`);
        }
      }
      addImportedNodes(drafts, at);
      if (errors.length) window.alert(errors.join("\n"));
    } finally {
      setImportBusy(false);
    }
  }, [addImportedNodes, ensureCapacity, importBusy, uploadImportedMedia]);

  const pasteAt = useCallback(async (at: { x: number; y: number }) => {
    if (importBusy) return;
    if (copiedNodeRef.current) {
      createSelectionCopy(copiedNodeRef.current, { x: at.x - 150, y: at.y - 70 });
      setCanvasContextMenu(null);
      return;
    }
    if (!ensureCapacity(1)) return;
    setImportBusy(true);
    try {
      const drafts: ImportedNodeDraft[] = [];
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const mediaType = item.types.find((type) => /^(?:image|video|audio)\//u.test(type));
          if (mediaType) {
            const kind = classifyFreeCanvasImport("", mediaType);
            if (kind && kind !== "text") {
              const extension = mediaType.split("/")[1]?.replace("jpeg", "jpg").replace("mpeg", "mp3") || kind;
              drafts.push(await uploadImportedMedia(await item.getType(mediaType), `剪贴板-${kind}-${Date.now()}.${extension}`, kind));
              continue;
            }
          }
          if (item.types.includes("text/plain")) {
            const textValue = await (await item.getType("text/plain")).text();
            if (!textValue.trim()) continue;
            if (textValue.length > 20_000) throw new Error("剪贴板文本超过单节点 20000 字上限。");
            const media = pastedMediaUrl(textValue);
            drafts.push(media ? { kind: media.kind, title: media.title, mediaUrl: media.url } : { kind: "text", title: "粘贴的文本", content: textValue });
          }
        }
      } else {
        const textValue = await navigator.clipboard.readText();
        if (textValue.length > 20_000) throw new Error("剪贴板文本超过单节点 20000 字上限。");
        const media = pastedMediaUrl(textValue);
        if (textValue.trim()) drafts.push(media ? { kind: media.kind, title: media.title, mediaUrl: media.url } : { kind: "text", title: "粘贴的文本", content: textValue });
      }
      if (!drafts.length) throw new Error("剪贴板里没有可识别的文本、图片、视频或音频。");
      addImportedNodes(drafts, at);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法读取剪贴板内容。");
    } finally {
      setImportBusy(false);
      setCanvasContextMenu(null);
    }
  }, [addImportedNodes, createSelectionCopy, ensureCapacity, importBusy, uploadImportedMedia]);

  const openCanvasContextMenu = useCallback((event: MouseEvent | ReactMouseEvent<Element>) => {
    event.preventDefault();
    if (!viewportRef.current || !flowRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setPendingNodeMenu(null);
    setNodeContextMenu(null);
    setEditingNodeId(null);
    setCanvasContextMenu({
      left: Math.max(10, Math.min(rect.width - 224, event.clientX - rect.left)),
      top: Math.max(10, Math.min(rect.height - 310, event.clientY - rect.top)),
      flowX: point.x, flowY: point.y, nodeTypesOpen: false, submenuLeft: event.clientX - rect.left > rect.width - 380,
    });
  }, []);

  const onImportInputChange = useCallback((event: ReactChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    const at = canvasContextMenu ? { x: canvasContextMenu.flowX, y: canvasContextMenu.flowY } : flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setCanvasContextMenu(null);
    if (at) void importFiles(files, at);
  }, [canvasContextMenu, importFiles]);

  useEffect(() => {
    if (!canvasNotice) return;
    const timer = window.setTimeout(() => setCanvasNotice(""), 1_800);
    return () => window.clearTimeout(timer);
  }, [canvasNotice]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length) setSelectedNodeIds((current) => {
      const next = new Set(current);
      selectionChanges.forEach((change) => change.selected ? next.add(change.id) : next.delete(change.id));
      return next;
    });
    const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    const settledPositions = new Map(changes.flatMap((change) => change.type === "position" && !change.dragging && change.position ? [[change.id, change.position] as const] : []));
    if (!removedIds.size && !settledPositions.size) return;
    if (!draggingNodeId && settledPositions.size) remember();
    onChange((current) => ({
      ...current,
      nodes: current.nodes.filter((item) => !removedIds.has(item.id)).map((item) => settledPositions.has(item.id) ? { ...item, ...settledPositions.get(item.id)! } : item),
      edges: removedIds.size ? current.edges.filter((edge) => !removedIds.has(edge.fromNodeId) && !removedIds.has(edge.toNodeId)) : current.edges,
    }));
  }, [draggingNodeId, onChange, remember]);
  const commitNodePosition = useCallback<OnNodeDrag<FlowNode>>((_event, node, draggedNodes) => {
    const positions = new Map((draggedNodes.length ? draggedNodes : [node]).map((item) => [item.id, item.position]));
    setDraggingNodeId(null);
    onChange((current) => ({ ...current, nodes: current.nodes.map((item) => positions.has(item.id) ? { ...item, x: positions.get(item.id)!.x, y: positions.get(item.id)!.y } : item) }));
  }, [onChange]);
  const startNodeDrag = useCallback<OnNodeDrag<FlowNode>>((event, node) => {
    remember();
    setDraggingNodeId(node.id);
    const modifiedSelection = "ctrlKey" in event && (event.ctrlKey || event.metaKey || event.shiftKey);
    if (modifiedSelection || selectedNodeIds.has(node.id)) return;
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setFlowNodes((current) => current.map((item) => item.selected === (item.id === node.id) ? item : { ...item, selected: item.id === node.id }));
  }, [remember, selectedNodeIds]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length) setSelectedEdgeIds((current) => {
      const next = new Set(current);
      selectionChanges.forEach((change) => change.selected ? next.add(change.id) : next.delete(change.id));
      return next;
    });
    const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    if (removedIds.size) onChange((current) => ({ ...current, edges: current.edges.filter((edge) => !removedIds.has(edge.id)) }));
  }, [onChange]);

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    const canonical = canonicalConnection(connection);
    if (!canonical) return false;
    const sourceKind = state.nodes.find((item) => item.id === canonical.source)?.kind;
    const targetKind = state.nodes.find((item) => item.id === canonical.target)?.kind;
    const target = state.nodes.find(item => item.id === canonical.target);
    const incoming = state.edges.filter(edge => edge.toNodeId === canonical.target).flatMap(edge => {
      const source = state.nodes.find(n => n.id === edge.fromNodeId); return source ? [{ ...source, purpose: edge.purpose }] : [];
    });
    const source = state.nodes.find(item => item.id === canonical.source);
    return Boolean(target && source && !referenceInputError(target, [...incoming, source])) && canReference(sourceKind, targetKind)
      && !state.edges.some((edge) => edge.fromNodeId === canonical.source && edge.toNodeId === canonical.target);
  }, [state.edges, state.nodes]);
  const onConnect = useCallback((connection: Connection) => {
    const canonical = canonicalConnection(connection);
    if (!canonical || !isValidConnection(connection)) return;
    remember();
    const purpose = referencePurposes(state.nodes.find(n => n.id === canonical.source)!.kind, state.nodes.find(n => n.id === canonical.target)!.kind)[0];
    const id = nextId("edge");
    const nextEdges = addEdge({ ...canonical, id, data: { purpose } }, flowEdges);
    setSelectedEdgeIds(new Set([id])); setSelectedNodeIds(new Set()); setEditingNodeId(null);
    onChange((current) => ({ ...current, edges: nextEdges.map((edge) => ({ purpose: edge.data?.purpose as CanvasReferencePurpose | undefined, id: edge.id, fromNodeId: edge.source, toNodeId: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })) }));
  }, [flowEdges, isValidConnection, onChange, remember, state.nodes]);
  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    const canonical = canonicalConnection(connection);
    if (!canonical) return;
    const sourceKind = state.nodes.find((item) => item.id === canonical.source)?.kind;
    const targetKind = state.nodes.find((item) => item.id === canonical.target)?.kind;
    if (!canReference(sourceKind, targetKind)
      || state.edges.some((edge) => edge.id !== oldEdge.id && edge.fromNodeId === canonical.source && edge.toNodeId === canonical.target)) return;
    const target = state.nodes.find(n => n.id === canonical.target)!;
    const source = state.nodes.find(n => n.id === canonical.source)!;
    const incoming = state.edges.filter(e => e.id !== oldEdge.id && e.toNodeId === target.id).flatMap(e => {
      const n = state.nodes.find(n => n.id === e.fromNodeId); return n ? [{ ...n, purpose: e.purpose }] : [];
    });
    const inputError = referenceInputError(target, [...incoming, source]);
    if (inputError) { setCanvasNotice(inputError); return; }
    remember();
    const previousPurpose = state.edges.find(edge => edge.id === oldEdge.id)?.purpose;
    const allowedPurposes = referencePurposes(sourceKind!, targetKind!);
    const purpose = previousPurpose && allowedPurposes.includes(previousPurpose) ? previousPurpose : allowedPurposes[0];
    const nextEdges = reconnectEdge(oldEdge, canonical, flowEdges, { shouldReplaceId: false }).map(edge => edge.id === oldEdge.id ? { ...edge, data: { ...edge.data, purpose } } : edge);
    onChange((current) => ({ ...current, edges: nextEdges.map((edge) => ({ purpose: edge.data?.purpose as CanvasReferencePurpose | undefined, id: edge.id, fromNodeId: edge.source, toNodeId: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })) }));
  }, [flowEdges, onChange, remember, state.edges, state.nodes]);

  const onConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
    setPendingNodeMenu(null);
    connectStartRef.current = params.nodeId ? { nodeId: params.nodeId, handleId: params.handleId } : null;
  }, []);
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, isValid: boolean) => {
    const started = connectStartRef.current;
    connectStartRef.current = null;
    if (isValid || !started || !viewportRef.current || !flowRef.current) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    const target = document.elementFromPoint(point.clientX, point.clientY);
    const targetNodeId = target?.closest(".react-flow__node")?.getAttribute("data-id");
    if (targetNodeId) {
      const sourceId = started.handleId === "left" ? targetNodeId : started.nodeId;
      const destinationId = started.handleId === "left" ? started.nodeId : targetNodeId;
      const source = stateRef.current.nodes.find(n => n.id === sourceId), destination = stateRef.current.nodes.find(n => n.id === destinationId);
      const incoming = stateRef.current.edges.filter(e => e.toNodeId === destinationId).flatMap(e => {
        const n = stateRef.current.nodes.find(n => n.id === e.fromNodeId); return n ? [{ ...n, purpose: e.purpose }] : [];
      });
      setCanvasNotice(sourceId === destinationId ? "节点不能连接自身。" : stateRef.current.edges.some(e => e.fromNodeId === sourceId && e.toNodeId === destinationId) ? "这两个节点已连接。" : source && destination ? referenceInputError(destination, [...incoming, source]) || "请将连线拖到输入端口。" : "请连接有效的节点端口。");
      return;
    }
    if (!target?.closest(".react-flow__pane")) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const flowPoint = flowRef.current.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    setPendingNodeMenu({
      left: Math.max(12, Math.min(rect.width - 238, point.clientX - rect.left + 12)),
      top: Math.max(12, Math.min(rect.height - 278, point.clientY - rect.top + 12)),
      flowX: flowPoint.x,
      flowY: flowPoint.y,
      sourceNodeId: started.nodeId,
      sourceHandle: started.handleId,
    });
  }, []);
  const createConnectedNode = useCallback((kind: Exclude<FreeCanvasNodeKind, "director">) => {
    if (!pendingNodeMenu) return;
    const source = state.nodes.find((item) => item.id === pendingNodeMenu.sourceNodeId);
    const placeOnLeft = pendingNodeMenu.sourceHandle === "left";
    if (!source || !canReference(placeOnLeft ? kind : source.kind, placeOnLeft ? source.kind : kind)) return;
    remember();
    const node: FreeCanvasNode = {
      id: nextId("node"), kind, title: `新${nodeLabels[kind]}节点`, content: "",
      x: Math.round(pendingNodeMenu.flowX + (placeOnLeft ? -332 : 32)),
      y: Math.round(pendingNodeMenu.flowY - 76), createdAt: new Date().toISOString(),
    };
    const edge: FreeCanvasEdge = placeOnLeft
      ? { id: nextId("edge"), fromNodeId: node.id, toNodeId: source.id, sourceHandle: "right", targetHandle: "left" }
      : { id: nextId("edge"), fromNodeId: source.id, toNodeId: node.id, sourceHandle: "right", targetHandle: "left" };
    const destination = placeOnLeft ? source : node;
    const incoming = state.edges.filter(e => e.toNodeId === destination.id).flatMap(e => {
      const n = state.nodes.find(n => n.id === e.fromNodeId); return n ? [{ ...n, purpose: e.purpose }] : [];
    });
    const inputError = referenceInputError(destination, [...incoming, placeOnLeft ? node : source]);
    if (inputError) { setCanvasNotice(inputError); return; }
    edge.purpose = referencePurposes(placeOnLeft ? node.kind : source.kind, destination.kind)[0];
    if (!onChange((current) => ({ ...current, nodes: [...current.nodes, node], edges: [...current.edges, edge] }))) return;
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeIds(new Set());
    setPendingNodeMenu(null);
  }, [onChange, pendingNodeMenu, remember, state.edges, state.nodes]);

  const materializeImageCandidate = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const raw = event.dataTransfer.getData("application/x-prism-free-canvas-image");
    if (!raw || !flowRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const payload = JSON.parse(raw) as { sourceNodeId?: string; url?: string; index?: number };
      const source = state.nodes.find((item) => item.id === payload.sourceNodeId && item.kind === "image");
      const candidates = source?.mediaUrls?.length ? source.mediaUrls : source?.mediaUrl ? [source.mediaUrl] : [];
      const index = Number.isInteger(payload.index) ? Number(payload.index) : -1;
      if (!source || index < 0 || candidates[index] !== payload.url) return;
      const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      remember();
      const node: FreeCanvasNode = {
        id: nextId("node"), kind: "image", title: `${source.title} · 候选${index + 1}`, content: source.content,
        mediaUrl: payload.url, mediaUrls: [payload.url!], imageSettings: normalizeImageSettings({ ...source.imageSettings, count: 1 }),
        candidateSource: { nodeId: source.id, taskId: source.generation?.taskId, resultIndex: index },
        x: Math.round(point.x - 150), y: Math.round(point.y - 100), createdAt: new Date().toISOString(),
      };
      if (!onChange((current) => ({ ...current, nodes: [...current.nodes, node] }))) return;
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeIds(new Set());
    } catch {
      // Ignore foreign or malformed drag payloads without mutating the canvas.
    }
  }, [onChange, remember, state.nodes]);

  const materializeCanvasDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const directorSourceKey = event.dataTransfer.getData("application/x-prism-director-source");
    if (directorSourceKey && flowRef.current) {
      const source = sources.find((item) => `${item.sourceRef.type}:${item.sourceRef.stableId}` === directorSourceKey);
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(source.kind, source, { x: point.x - 150, y: point.y - 70 });
      return;
    }
    const assetId = event.dataTransfer.getData("application/x-prism-asset-library");
    if (assetId && flowRef.current) {
      const asset = assetLibraryItems.find((item) => item.id === assetId);
      if (!asset) return;
      event.preventDefault();
      event.stopPropagation();
      const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addAssetNode(asset, { x: point.x - 150, y: point.y - 70 });
      return;
    }
    materializeImageCandidate(event);
  }, [addAssetNode, addNode, assetLibraryItems, materializeImageCandidate, sources]);

  const undo = useCallback(() => {
    const before = stateRef.current;
    const graph = historyRef.current.undo(before, (next) => {
      const error = canvasRemovalError(before, next) || freeCanvasCapacityError(next, before);
      if (error) setCanvasNotice(`无法撤销：${error}`);
      return !error;
    });
    if (graph === before) return;
    stateRef.current = { ...before, ...graph };
    onStateChange((current) => ({ ...current, ...applyCanvasGraphChange(current, before, graph) }));
    remember(); editingRef.current = false;
    setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); setHistoryTick((value) => value + 1);
  }, [onStateChange, remember]);
  const redo = useCallback(() => {
    const before = stateRef.current;
    const graph = historyRef.current.redo(before, (next) => {
      const error = canvasRemovalError(before, next) || freeCanvasCapacityError(next, before);
      if (error) setCanvasNotice(`无法重做：${error}`);
      return !error;
    });
    if (graph === before) return;
    stateRef.current = { ...before, ...graph };
    onStateChange((current) => ({ ...current, ...applyCanvasGraphChange(current, before, graph) }));
    remember(); editingRef.current = false;
    setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); setHistoryTick((value) => value + 1);
  }, [onStateChange, remember]);
  const patchPreferences = useCallback((patch: Partial<FreeCanvasPreferences>) => {
    onChange((current) => ({ ...current, preferences: { ...current.preferences, ...patch } }));
  }, [onChange]);
  const arrangeSelection = useCallback((action: CanvasArrangement) => {
    const nodes = state.nodes.map(node => ({ ...node, ...flowRef.current?.getNode(node.id)?.measured }));
    const positions = arrangeCanvasSelection(nodes, state.edges, selectedNodeIds, action);
    if (!positions.size) return;
    remember();
    onChange(current => ({ ...current, nodes: current.nodes.map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id)! } : node) }));
    setCanvasNotice("所选节点已排列，可撤销");
  }, [state.nodes, state.edges, selectedNodeIds, remember, onChange]);

  const organizeCanvas = useCallback(() => {
    if (!state.nodes.length) {
      setCanvasNotice("画布中还没有节点");
      return;
    }
    const layoutNodes = state.nodes.map((node) => {
      const measured = flowRef.current?.getNode(node.id)?.measured;
      const image = node.kind === "image" && node.mediaUrl ? normalizeImageSettings(node.imageSettings) : null;
      return { ...node, width: measured?.width ?? 300, height: measured?.height ?? (image ? 300 * image.height / image.width : 220) };
    });
    const positions = organizeFreeCanvas(layoutNodes, state.edges);
    remember();
    onChange((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, ...position } : node;
      }),
    }));
    setCanvasContextMenu(null);
    setPendingNodeMenu(null);
    setCanvasNotice("画布已整理，可撤销");
    window.requestAnimationFrame(() => void flowRef.current?.fitView({ padding: .2, duration: 450, minZoom: .2, maxZoom: 1 }));
  }, [onChange, remember, state.edges, state.nodes]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape" && (pendingNodeMenu || canvasContextMenu || nodeContextMenu || assetLibraryOpen || mediaHistoryOpen)) { event.preventDefault(); setPendingNodeMenu(null); setCanvasContextMenu(null); setNodeContextMenu(null); setAssetLibraryOpen(false); setAssetLibraryEditingId(null); setMediaHistoryOpen(false); return; }
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape" && editingNodeId) { event.preventDefault(); closeNodeEditor(); return; }
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (target?.closest("[role='dialog']") || assetLibraryOpen || mediaHistoryOpen || imageViewer || imageToolDialog) return;
      if (event.key === "Escape") { event.preventDefault(); setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); return; }
      if (event.key === "Enter" && selectedNodeIds.size === 1 && !target?.closest("button, a, select")) { event.preventDefault(); setEditingNodeId([...selectedNodeIds][0]); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); return; }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "a") { event.preventDefault(); setEditingNodeId(null); setSelectedNodeIds(new Set(state.nodes.map((node) => node.id))); setSelectedEdgeIds(new Set()); return; }
      if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key.toLowerCase() === "c" && selectedNodeIds.size) { event.preventDefault(); copySelection(); }
      if (event.key.toLowerCase() === "d" && selectedNodeIds.size) { event.preventDefault(); duplicateSelection(); }
      if (event.key.toLowerCase() === "v" && flowRef.current && viewportRef.current) {
        event.preventDefault();
        const rect = viewportRef.current.getBoundingClientRect();
        void pasteAt(flowRef.current.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assetLibraryOpen, canvasContextMenu, closeNodeEditor, copySelection, deleteSelection, duplicateSelection, editingNodeId, imageToolDialog, imageViewer, mediaHistoryOpen, nodeContextMenu, pasteAt, pendingNodeMenu, redo, selectedNodeIds, state.nodes, undo]);

  const persistViewport = useCallback((viewport: Viewport) => {
    const next = { x: viewport.x, y: viewport.y, zoom: Math.max(.2, Math.min(1.8, viewport.zoom)) };
    liveViewportRef.current = next;
    setDisplayZoom(next.zoom);
    onChange((current) => Math.abs(current.view.x - next.x) < .01
      && Math.abs(current.view.y - next.y) < .01
      && Math.abs(current.view.zoom - next.zoom) < .0001
      ? current : { ...current, view: next });
  }, [onChange]);
  useEffect(() => {
    const incoming = state.view;
    const live = liveViewportRef.current;
    if (Math.abs(incoming.x - live.x) < .01 && Math.abs(incoming.y - live.y) < .01 && Math.abs(incoming.zoom - live.zoom) < .0001) return;
    liveViewportRef.current = incoming;
    setDisplayZoom(incoming.zoom);
    void flowRef.current?.setViewport(incoming, { duration: 0 });
  }, [state.view.x, state.view.y, state.view.zoom]);

  const imageToolSource = imageToolDialog ? state.nodes.find((item) => item.id === imageToolDialog.sourceNodeId && item.kind === "image") : undefined;
  const contextNode = nodeContextMenu ? state.nodes.find((item) => item.id === nodeContextMenu.nodeId) : undefined;
  const contextNodeCanSave = Boolean(contextNode && (contextNode.kind === "text" || contextNode.kind === "director" ? contextNode.content.trim() : contextNode.mediaUrl));
  const filteredAssets = useMemo(() => {
    if (assetLibraryScope !== "library") return [];
    const query = assetLibraryQuery.trim().toLocaleLowerCase();
    return assetLibraryItems.filter((asset) => {
      const groupMatches = assetLibraryFilter === "all" || asset.type === assetLibraryFilter;
      const folderMatches = assetLibraryFolder === "__all__" || assetLibraryFolder === "__favorites__"
        ? assetLibraryFolder !== "__favorites__" || asset.favorite
        : asset.folder === assetLibraryFolder;
      if (!groupMatches || !folderMatches) return false;
      return !query || `${asset.name} ${asset.description} ${asset.tags.join(" ")} ${asset.sourceProjectName} ${asset.folder}`.toLocaleLowerCase().includes(query);
    });
  }, [assetLibraryFilter, assetLibraryFolder, assetLibraryItems, assetLibraryQuery, assetLibraryScope]);

  const filteredDirectorSources = useMemo(() => {
    if (assetLibraryScope !== "project") return [];
    const query = assetLibraryQuery.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      const sourceCategory = source.sourceRef.type === "character" ? "character" : source.sourceRef.type === "scene" ? "scene" : source.sourceRef.type === "prop" ? "prop" : source.kind === "image" ? "image" : source.kind === "video" ? "video" : source.kind === "audio" ? "audio" : "all";
      return (assetLibraryFilter === "all" || assetLibraryFilter === sourceCategory)
        && (!query || `${source.title} ${source.sourceRef.type} ${source.sourceRef.stableId}`.toLocaleLowerCase().includes(query));
    });
  }, [assetLibraryFilter, assetLibraryQuery, assetLibraryScope, sources]);

  const insertAssetAtCenter = useCallback((asset: FreeCanvasAssetLibraryItem) => {
    if (!flowRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const point = flowRef.current.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addAssetNode(asset, { x: point.x - 150, y: point.y - 70 });
  }, [addAssetNode]);

  const insertDirectorSourceAtCenter = useCallback((source: DirectorCanvasSource) => {
    if (!flowRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const point = flowRef.current.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(source.kind, source, { x: point.x - 150, y: point.y - 70 });
  }, [addNode]);

  const editDirectorSourceCopy = useCallback((source: DirectorCanvasSource) => {
    if (!flowRef.current || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const point = flowRef.current.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const nodeId = addNode(source.kind, source, { x: point.x - 150, y: point.y - 70 });
    if (!nodeId) return;
    setEditingNodeId(nodeId);
    setAssetLibraryOpen(false);
    setAssetLibraryEditingId(null);
  }, [addNode]);

  return (
    <section className={`free-canvas-workspace ${draggingNodeId ? "is-node-dragging" : ""}`} aria-label="自由画布">
      <div className="free-canvas-title"><div><small>自由画布</small><strong>节点试验工作区</strong></div><span>拖卡片移动 · 拖端口连线 · 空格拖动画布 · Ctrl+滚轮缩放</span></div>
      <div ref={viewportRef} className="free-canvas-viewport" onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-prism-free-canvas-image") || event.dataTransfer.types.includes("application/x-prism-asset-library") || event.dataTransfer.types.includes("application/x-prism-director-source")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }} onDrop={materializeCanvasDrop} onContextMenuCapture={(event) => {
        if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("react-flow__pane")) return;
        openCanvasContextMenu(event);
      }}>
        <input ref={importInputRef} className="free-canvas-import-input" type="file" multiple accept="text/*,.txt,.md,.markdown,.json,.csv,.srt,.vtt,.ass,image/*,video/*,audio/*" onChange={onImportInputChange} />
        <ReactFlow<FlowNode, Edge>
          nodes={flowNodes}
          edges={state.preferences.showConnections ? flowEdges : []}
          nodeTypes={nodeTypes}
          edgeTypes={freeCanvasEdgeTypes}
          defaultViewport={state.view}
          minZoom={.2}
          maxZoom={1.8}
          onInit={(instance) => { flowRef.current = instance; }}
          onMove={(_event, viewport) => { liveViewportRef.current = viewport; }}
          onMoveEnd={(_event, viewport) => persistViewport(viewport)}
          onNodeClick={() => { setEditingNodeId(null); }}
          onNodeDoubleClick={(_event, node) => { setEditingNodeId(node.id); setSelectedNodeIds(new Set([node.id])); }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={startNodeDrag}
          onNodeDragStop={commitNodePosition}
          onSelectionDragStart={(event, nodes) => { if (nodes[0]) startNodeDrag(event.nativeEvent, nodes[0], nodes); }}
          onSelectionDragStop={(event, nodes) => { if (nodes[0]) commitNodePosition(event.nativeEvent, nodes[0], nodes); }}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={(event, connectionState) => onConnectEnd(event, Boolean(connectionState.isValid))}
          onReconnect={onReconnect}
          onBeforeDelete={async () => { remember(); return true; }}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={44}
          reconnectRadius={30}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: "#79c8ff", strokeWidth: 2.2 }}
          defaultEdgeOptions={{ type: "freeRoute", animated: false }}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          panActivationKeyCode="Space"
          panOnScroll
          panOnScrollSpeed={.75}
          zoomOnScroll={false}
          zoomActivationKeyCode="Control"
          zoomOnPinch
          zoomOnDoubleClick={false}
          snapToGrid={state.preferences.snapToGrid}
          snapGrid={[22, 22]}
          multiSelectionKeyCode={["Control", "Meta"]}
          deleteKeyCode={null}
          autoPanOnNodeDrag
          autoPanOnConnect
          onPaneClick={() => { setPendingNodeMenu(null); setCanvasContextMenu(null); setNodeContextMenu(null); setEditingNodeId(null); setSelectedNodeIds(new Set()); setSelectedEdgeIds(new Set()); }}
          elevateEdgesOnSelect
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            "controls.ariaLabel": "画布控制",
            "controls.zoomIn.ariaLabel": "放大",
            "controls.zoomOut.ariaLabel": "缩小",
            "controls.fitView.ariaLabel": "适配视图",
            "minimap.ariaLabel": "画布缩略图",
            "handle.ariaLabel": "连接端口",
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(255,255,255,.13)" />
          {state.preferences.showMiniMap && state.nodes.length > 0 && <MiniMap className="free-canvas-minimap" pannable zoomable nodeColor="#3b3b43" maskColor="rgba(8,8,10,.72)" />}
        </ReactFlow>
        {pendingNodeMenu && <div className="free-node-create-menu nodrag nowheel nopan" style={{ left: pendingNodeMenu.left, top: pendingNodeMenu.top }} role="menu" aria-label="选择新节点类型">
          <header><span>{pendingNodeMenu.sourceHandle === "left" ? "为该节点创建输入" : "引用该节点生成"}</span><button onClick={() => setPendingNodeMenu(null)} aria-label="关闭节点菜单">×</button></header>
          <div>
            {(["text", "image", "video", "audio"] as const).map((kind) => {
              const source = state.nodes.find((item) => item.id === pendingNodeMenu.sourceNodeId);
              const placeOnLeft = pendingNodeMenu.sourceHandle === "left";
              const allowed = Boolean(source && canReference(placeOnLeft ? kind : source.kind, placeOnLeft ? source.kind : kind));
              return <button key={kind} role="menuitem" disabled={!allowed} title={allowed ? "创建并自动连接" : "当前节点类型不接受这种参考"} onClick={() => createConnectedNode(kind)}><i>{nodeIcons[kind]}</i><span>{nodeLabels[kind]}<small>{allowed ? "创建并自动连接" : "不支持这种输入关系"}</small></span><b>＋</b></button>;
            })}
          </div>
        </div>}
        {canvasContextMenu && <div className={`free-canvas-context-menu nodrag nowheel nopan ${canvasContextMenu.submenuLeft ? "submenu-opens-left" : ""}`} style={{ left: canvasContextMenu.left, top: canvasContextMenu.top }} role="menu" aria-label="画布菜单" onContextMenu={(event) => event.preventDefault()}>
          <button role="menuitem" disabled={importBusy} onClick={() => importInputRef.current?.click()}><i>↓</i><span>导入<small>文本、图片、视频、音频</small></span></button>
          <button role="menuitem" aria-expanded={canvasContextMenu.nodeTypesOpen} onClick={() => setCanvasContextMenu((current) => current ? { ...current, nodeTypesOpen: !current.nodeTypesOpen } : current)}><i>＋</i><span>添加节点</span><b>›</b></button>
          {canvasContextMenu.nodeTypesOpen && <div className="free-canvas-context-submenu" role="menu" aria-label="添加节点类型">
            {(["text", "image", "video", "audio"] as const).map((kind) => <button key={kind} role="menuitem" onClick={() => { addNode(kind, undefined, { x: canvasContextMenu.flowX - 150, y: canvasContextMenu.flowY - 70 }); setCanvasContextMenu(null); }}><i>{nodeIcons[kind]}</i><span>{nodeLabels[kind]}节点</span></button>)}
          </div>}
          <button role="menuitem" disabled={importBusy} onClick={() => void pasteAt({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY })}><i>▣</i><span>粘贴<small>自动识别剪贴板格式</small></span><kbd>Ctrl V</kbd></button>
          <hr />
          <button role="menuitem" disabled={!historyRef.current.canUndo} onClick={() => { undo(); setCanvasContextMenu(null); }}><i>↶</i><span>撤销</span><kbd>Ctrl Z</kbd></button>
          <button role="menuitem" disabled={!historyRef.current.canRedo} onClick={() => { redo(); setCanvasContextMenu(null); }}><i>↷</i><span>重做</span><kbd>Ctrl ⇧ Z</kbd></button>
        </div>}
        {nodeContextMenu && contextNode && <div className="free-canvas-context-menu free-node-context-menu nodrag nowheel nopan" style={{ left: nodeContextMenu.left, top: nodeContextMenu.top }} role="menu" aria-label={`${contextNode.title}节点菜单`} onContextMenu={(event) => event.preventDefault()}>
          <button role="menuitem" disabled={!contextNodeCanSave || assetLibraryBusy} title={contextNodeCanSave ? "保存为跨项目可复用资产" : "节点还没有可保存的内容"} onClick={() => void saveNodeAsAsset(contextNode)}><i>◇</i><span>{contextNode.libraryAssetRef ? "更新资产库内容" : "保存到资产库"}<small>{contextNode.libraryAssetRef ? contextNode.libraryAssetRef.name : "跨项目复用"}</small></span></button>
          <button role="menuitem" onClick={() => copyNode(contextNode)}><i>▣</i><span>复制节点<small>内容、参数和媒体引用</small></span><kbd>Ctrl C</kbd></button>
          <button role="menuitem" onClick={() => duplicateNode(contextNode)}><i>⧉</i><span>创建副本</span><kbd>Ctrl D</kbd></button>
          {(contextNode.kind === "text" || contextNode.kind === "director") && <button role="menuitem" disabled={!contextNode.content.trim()} onClick={() => void writeClipboardText(contextNode.content, "文字已复制到系统剪贴板").catch((error) => setCanvasNotice(error instanceof Error ? error.message : "文字复制失败"))}><i>T</i><span>复制文字</span></button>}
          {contextNode.kind === "image" && <button role="menuitem" disabled={!contextNode.mediaUrl} onClick={() => void copyImageToClipboard(contextNode).catch((error) => setCanvasNotice(error instanceof Error ? error.message : "图片复制失败"))}><i>▧</i><span>复制图片<small>写入系统剪贴板</small></span></button>}
          {(contextNode.kind === "video" || contextNode.kind === "audio") && <button role="menuitem" disabled={!contextNode.mediaUrl} onClick={() => void writeClipboardText(contextNode.mediaUrl || "", "媒体地址已复制").catch((error) => setCanvasNotice(error instanceof Error ? error.message : "地址复制失败"))}><i>↗</i><span>复制媒体地址</span></button>}
          {contextNode.mediaUrl && <a role="menuitem" href={contextNode.mediaUrl} download onClick={() => setNodeContextMenu(null)}><i>↓</i><span>下载{nodeLabels[contextNode.kind]}</span></a>}
          {contextNode.generation?.taskId && <button role="menuitem" onClick={() => void writeClipboardText(contextNode.generation!.taskId, "Task ID已复制").catch((error) => setCanvasNotice(error instanceof Error ? error.message : "Task ID复制失败"))}><i>#</i><span>复制 Task ID<small>{contextNode.generation.provider || "生成任务"}</small></span></button>}
          {contextNode.sourceRef && <button role="menuitem" onClick={() => { setNodeContextMenu(null); onReturnToDirector(contextNode.sourceRef!); }}><i>↗</i><span>定位导演模式来源</span></button>}
          <hr />
          <button role="menuitem" disabled={!state.edges.some((edge) => edge.fromNodeId === contextNode.id || edge.toNodeId === contextNode.id)} onClick={() => disconnectNode(contextNode.id)}><i>⌁</i><span>断开所有连线</span></button>
          <button role="menuitem" className="danger" onClick={() => deleteNode(contextNode.id)}><i>×</i><span>删除节点<small>可撤销</small></span></button>
        </div>}
        {(canvasNotice || freeCanvasCapacityNotice(state)) && <div className="free-canvas-notice" role="status">{canvasNotice || freeCanvasCapacityNotice(state)}</div>}
        {state.nodes.length === 0 && <div className="free-canvas-empty"><strong>从一个节点开始</strong><span>使用底部工具栏添加节点，或从右侧资产库加入素材。</span></div>}
      </div>
      <button type="button" className={`free-canvas-asset-tab ${assetLibraryOpen ? "is-open" : ""}`} aria-expanded={assetLibraryOpen} aria-controls="free-canvas-asset-library" onClick={() => setAssetLibraryOpen((current) => { if (current) setAssetLibraryEditingId(null); return !current; })}><i>▦</i><span>资产库</span></button>
      {assetLibraryOpen && <aside id="free-canvas-asset-library" className="free-canvas-asset-library" aria-label="跨项目资产库">
        <header><div><small>ASSETS</small><strong>资产库</strong></div><button type="button" onClick={() => { setAssetLibraryOpen(false); setAssetLibraryEditingId(null); }} aria-label="收起资产库">×</button></header>
        <div className="free-asset-library-scope" aria-label="资产范围"><button type="button" className={assetLibraryScope === "project" ? "active" : ""} onClick={() => { setAssetLibraryScope("project"); setAssetLibraryFilter("all"); setAssetLibraryEditingId(null); }}>当前项目</button><button type="button" className={assetLibraryScope === "library" ? "active" : ""} onClick={() => { setAssetLibraryScope("library"); setAssetLibraryFilter("all"); }}>跨项目资产</button></div>
        <div className="free-asset-library-search"><input value={assetLibraryQuery} onChange={(event) => setAssetLibraryQuery(event.target.value)} placeholder="搜索名称、文件夹或来源项目" /><button type="button" disabled={assetLibraryBusy} onClick={() => void loadAssetLibrary()} aria-label="刷新资产库">↻</button></div>
        <nav aria-label="资产类型筛选">{(["all", "character", "scene", "prop", "style", "image", "video", "audio"] as const).map((filter) => <button type="button" key={filter} className={assetLibraryFilter === filter ? "active" : ""} onClick={() => setAssetLibraryFilter(filter)}>{{ all: "全部", character: "人物", scene: "场景", prop: "道具", style: "风格", image: "图片", video: "视频", audio: "音频" }[filter]}</button>)}</nav>
        {assetLibraryScope === "library" && <div className="free-asset-library-folders"><button type="button" className={assetLibraryFolder === "__all__" ? "active" : ""} onClick={() => setAssetLibraryFolder("__all__")}>全部资产</button><button type="button" className={assetLibraryFolder === "__favorites__" ? "active" : ""} onClick={() => setAssetLibraryFolder("__favorites__")}>★ 收藏</button>{assetLibraryFolders.map((folder) => <button type="button" key={folder} className={assetLibraryFolder === folder ? "active" : ""} onClick={() => setAssetLibraryFolder(folder)}>▰ {folder}</button>)}</div>}
        {assetLibraryError && <p className="free-asset-library-error" role="alert">{assetLibraryError}</p>}
        {assetLibraryNotice && <p className="free-asset-library-notice" role="status">{assetLibraryNotice}</p>}
        {assetLibraryScope === "library" && assetLibraryEditingId && <form className="free-asset-library-editor" onSubmit={saveAssetLibraryEdit}>
          <header><strong>编辑资产资料</strong><button type="button" onClick={() => setAssetLibraryEditingId(null)}>取消</button></header>
          <label>名称<input required maxLength={200} value={assetLibraryEditDraft.name} onChange={(event) => setAssetLibraryEditDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>文件夹<input list="free-asset-library-folder-options" maxLength={200} value={assetLibraryEditDraft.folder} onChange={(event) => setAssetLibraryEditDraft((current) => ({ ...current, folder: event.target.value }))} placeholder="可输入新的文件夹" /></label>
          <label className="wide">简介<textarea value={assetLibraryEditDraft.description} onChange={(event) => setAssetLibraryEditDraft((current) => ({ ...current, description: event.target.value }))} placeholder="角色设定、素材用途或其他说明" /></label>
          <label className="wide">标签<input value={assetLibraryEditDraft.tags} onChange={(event) => setAssetLibraryEditDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="用逗号分隔" /></label>
          <label className="free-asset-library-favorite"><input type="checkbox" checked={assetLibraryEditDraft.favorite} onChange={(event) => setAssetLibraryEditDraft((current) => ({ ...current, favorite: event.target.checked }))} />加入收藏</label>
          <button className="free-asset-library-save" disabled={assetLibraryBusy || !assetLibraryEditDraft.name.trim()}>保存修改</button>
        </form>}
        <datalist id="free-asset-library-folder-options">{assetLibraryFolders.map((folder) => <option key={folder} value={folder} />)}</datalist>
        <div className="free-asset-library-list">{filteredDirectorSources.map((source) => {
          const sourceKey = `${source.sourceRef.type}:${source.sourceRef.stableId}`;
          const added = state.nodes.some((item) => item.sourceRef?.type === source.sourceRef.type && item.sourceRef?.stableId === source.sourceRef.stableId);
          return <article key={sourceKey} className="free-director-source-item" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-prism-director-source", sourceKey); }}>
            <div className={`free-asset-library-preview kind-${source.kind}`}>{source.mediaUrl ? source.kind === "video" ? <video src={source.mediaUrl} muted preload="metadata" /> : <img src={source.mediaUrl} alt="" draggable={false} /> : <i>{nodeIcons[source.kind]}</i>}</div>
            <span><strong>{source.title}</strong><small>当前项目 · {source.sourceRef.type} · {source.sourceRef.stableId}</small></span>
            <div className="free-asset-library-item-actions"><button type="button" onClick={() => editDirectorSourceCopy(source)}>编辑副本</button><button type="button" onClick={() => insertDirectorSourceAtCenter(source)}>{added ? "定位" : "加入画布"}</button></div>
          </article>;
        })}{filteredAssets.map((asset) => {
          const mediaUrl = asset.media.mainImageUrl || asset.media.videoUrl || asset.media.audioUrl;
          const visualType = ["character", "scene", "prop", "style"].includes(asset.type) ? "image" : asset.type;
          return <article key={asset.id} className={assetLibraryEditingId === asset.id ? "is-editing" : ""} draggable={visualType !== "lora"} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-prism-asset-library", asset.id); }}>
            <div className={`free-asset-library-preview kind-${visualType}`}>{asset.media.mainImageUrl ? <img src={asset.media.mainImageUrl} alt="" draggable={false} /> : asset.media.videoUrl ? <video src={asset.media.videoUrl} muted preload="metadata" /> : <i>{visualType === "audio" ? "♫" : visualType === "text" ? "T" : "LoRA"}</i>}</div>
            <span><strong>{asset.favorite ? "★ " : ""}{asset.name}</strong><small>{asset.folder || asset.sourceProjectName} · {{ character: "人物", scene: "场景", prop: "道具", style: "风格", lora: "LoRA", text: "文本", image: "图片", video: "视频", audio: "音频" }[asset.type]}</small></span>
            <div className="free-asset-library-item-actions"><button type="button" onClick={() => beginAssetLibraryEdit(asset)}>编辑</button><button type="button" disabled={visualType === "lora" || !mediaUrl && visualType !== "text"} onClick={() => insertAssetAtCenter(asset)}>加入画布</button></div>
          </article>;
        })}{!assetLibraryBusy && filteredAssets.length === 0 && filteredDirectorSources.length === 0 && <p className="free-asset-library-empty">当前筛选下还没有资产。</p>}{assetLibraryBusy && <p className="free-asset-library-empty">正在读取资产库…</p>}</div>
        <footer>{assetLibraryScope === "project" ? "当前项目内容可以加入画布；编辑副本只修改画布节点。" : "跨项目资产可直接编辑资料，也可以拖入或加入当前视图。"}</footer>
      </aside>}
      <div className="free-canvas-view-tools" aria-label="画布视图工具">
        <button type="button" data-tooltip="整理画布" aria-label="整理画布" onClick={organizeCanvas}><CanvasViewToolIcon kind="organize" /></button>
        <button type="button" className={state.preferences.showConnections ? "is-active" : ""} data-tooltip={state.preferences.showConnections ? "隐藏连线" : "显示连线"} aria-label={state.preferences.showConnections ? "隐藏连线" : "显示连线"} aria-pressed={state.preferences.showConnections} onClick={() => patchPreferences({ showConnections: !state.preferences.showConnections })}><CanvasViewToolIcon kind="connections" /></button>
        <button type="button" className={state.preferences.showMiniMap ? "is-active" : ""} data-tooltip={state.preferences.showMiniMap ? "隐藏小地图" : "显示小地图"} aria-label={state.preferences.showMiniMap ? "隐藏小地图" : "显示小地图"} aria-pressed={state.preferences.showMiniMap} onClick={() => patchPreferences({ showMiniMap: !state.preferences.showMiniMap })}><CanvasViewToolIcon kind="minimap" /></button>
        <button type="button" className={state.preferences.snapToGrid ? "is-active" : ""} data-tooltip={state.preferences.snapToGrid ? "关闭网格吸附" : "开启网格吸附"} aria-label={state.preferences.snapToGrid ? "关闭网格吸附" : "开启网格吸附"} aria-pressed={state.preferences.snapToGrid} onClick={() => patchPreferences({ snapToGrid: !state.preferences.snapToGrid })}><CanvasViewToolIcon kind="snap" /></button>
      </div>
      {selectedEdgeIds.size === 1 && !editingNodeId && (() => {
        const edge = state.edges.find(e => selectedEdgeIds.has(e.id));
        const source = state.nodes.find(n => n.id === edge?.fromNodeId), target = state.nodes.find(n => n.id === edge?.toNodeId);
        if (!edge || !source || !target) return null;
        const purposes = referencePurposes(source.kind, target.kind);
        const value = edge.purpose || purposes[0] || "";
        return <section className="free-canvas-edge-inspector nodrag nowheel nopan" aria-label="连线用途">
          <strong>{source.title} → {target.title}</strong>
          <label>输入用途<select aria-label="输入用途" value={value} onChange={event => {
            remember(); const purpose = event.target.value as CanvasReferencePurpose;
            onChange(current => ({ ...current, edges: current.edges.map(e => e.id === edge.id ? { ...e, purpose } : e) }));
          }}>{!purposes.includes(value as CanvasReferencePurpose) && <option value={value}>待调整</option>}{purposes.map(p => <option key={p} value={p}>{referencePurposeLabels[p]}</option>)}</select></label>
          <p>{referenceInputError(target, state.edges.filter(e => e.toNodeId === target.id).flatMap(e => {
            const n = state.nodes.find(n => n.id === e.fromNodeId); return n ? [{ ...n, purpose: e.purpose }] : [];
          })) || "作为生成输入；执行由生成按钮触发。"}</p>
          <button type="button" onClick={deleteSelection}>删除连线</button>
        </section>;
      })()}
      <div ref={setEditorHost} className={`free-canvas-editor-host${editingNodeId ? " is-open" : ""}`} />
      {selectedNodeIds.size > 1 && !editingNodeId && <div className="free-canvas-selection-tools nodrag nowheel nopan" role="toolbar" aria-label="所选节点操作">
        <span>已选 {selectedNodeIds.size} 个节点</span>
        <select aria-label="排列所选节点" defaultValue="" onChange={(event) => { if (event.target.value) arrangeSelection(event.target.value as CanvasArrangement); event.target.value = ""; }}>
          <option value="" disabled>对齐与分布</option>
          <option value="left">左对齐</option><option value="center">水平居中</option><option value="right">右对齐</option>
          <option value="top">顶对齐</option><option value="middle">垂直居中</option><option value="bottom">底对齐</option>
          <option value="horizontal" disabled={selectedNodeIds.size < 3}>水平等距</option><option value="vertical" disabled={selectedNodeIds.size < 3}>垂直等距</option>
        </select>
        <button type="button" onClick={() => arrangeSelection("organize")}>整理所选</button>
        <button type="button" onClick={copySelection} title="复制所选 Ctrl+C">复制</button>
        <button type="button" onClick={duplicateSelection} title="创建所选副本 Ctrl+D">创建副本</button>
        <button type="button" onClick={deleteSelection} title="删除所选 Delete">删除</button>
      </div>}
      <div className="free-canvas-toolbar nodrag nowheel nopan" aria-label="自由画布工具栏" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <button onClick={() => addNode("text")} title="文本节点">T</button><button onClick={() => addNode("image")} title="图片节点">▧</button><button onClick={() => addNode("video")} title="视频节点">▶</button><button onClick={() => addNode("audio")} title="音频节点">♫</button><button className="free-canvas-history-button" onClick={() => { setMediaHistoryKind(mediaHistoryCounts.image ? "image" : mediaHistoryCounts.video ? "video" : "audio"); setMediaHistoryOpen(true); }} title="历史资产" aria-label="打开历史资产" aria-expanded={mediaHistoryOpen}><HistoryToolIcon /></button><i />
        <button disabled={!historyRef.current.canUndo} onClick={undo} title="撤销 Ctrl+Z">↶</button><button disabled={!historyRef.current.canRedo} onClick={redo} title="重做 Ctrl+Shift+Z">↷</button>
        <span className="free-canvas-history-sentinel" aria-hidden="true">{historyTick}</span>
      </div>
      {mediaHistoryOpen && <div className="free-media-history-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaHistoryOpen(false); }}>
        <section className="free-media-history-dialog" role="dialog" aria-modal="true" aria-label="历史资产">
          <header>
            <strong>历史资产</strong>
            <div className="free-media-history-window-actions"><div className="free-media-history-zoom" aria-label="历史缩略图大小"><button type="button" disabled={mediaHistoryZoom <= 70} onClick={() => setMediaHistoryZoom((value) => Math.max(70, value - 15))}>−</button><span>{mediaHistoryZoom}%</span><button type="button" disabled={mediaHistoryZoom >= 130} onClick={() => setMediaHistoryZoom((value) => Math.min(130, value + 15))}>＋</button></div><button type="button" className="free-media-history-close" onClick={() => setMediaHistoryOpen(false)} aria-label="关闭历史资产">×</button></div>
          </header>
          <div className="free-media-history-controls">
            <nav aria-label="历史媒体类型">{(["image", "video", "audio"] as const).map((kind) => <button type="button" key={kind} className={mediaHistoryKind === kind ? "active" : ""} onClick={() => { setMediaHistoryKind(kind); setSelectedHistoryIds(new Set()); }}>{{ image: "图片历史", video: "视频历史", audio: "音频历史" }[kind]}<b>({mediaHistoryCounts[kind]})</b></button>)}</nav>
            <div><button type="button" onClick={() => setMediaHistoryDescending((value) => !value)}>{mediaHistoryDescending ? "↓ 时间降序" : "↑ 时间升序"}</button><span /><button type="button" className={mediaHistoryBatchMode ? "active" : ""} onClick={() => { setMediaHistoryBatchMode((value) => !value); setSelectedHistoryIds(new Set()); }}>☷ 批量操作</button></div>
          </div>
          {mediaHistoryBatchMode && <div className="free-media-history-batch"><span>已选择 <b>{selectedMediaHistory.length}</b> 项</span><button type="button" onClick={() => setSelectedHistoryIds(new Set(visibleMediaHistory.map((item) => item.id)))}>全选当前</button><button type="button" disabled={!selectedMediaHistory.length} onClick={() => addHistoryItemsToCanvas(selectedMediaHistory)}>加入画布</button><button type="button" disabled={!selectedMediaHistory.length} onClick={() => downloadHistoryItems(selectedMediaHistory)}>下载所选</button></div>}
          <div className="free-media-history-scroll" style={{ "--history-card-width": `${Math.round(150 * mediaHistoryZoom / 100)}px` } as CSSProperties}>
            {groupedMediaHistory.map(([date, items]) => <section className="free-media-history-day" key={date}><h3>{date}</h3><div>{items.map((item) => {
              const selected = selectedHistoryIds.has(item.id);
              const toggleSelected = () => setSelectedHistoryIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; });
              return <article key={item.id} className={selected ? "selected" : ""}>
                {mediaHistoryBatchMode && <label className="free-media-history-check"><input type="checkbox" checked={selected} onChange={toggleSelected} /><i /></label>}
                {item.kind === "image" ? <button type="button" className="free-media-history-preview" onClick={() => mediaHistoryBatchMode ? toggleSelected() : setImageViewer({ src: item.mediaUrl, title: item.title })}><img src={item.mediaUrl} alt={item.title} loading="lazy" /></button>
                  : item.kind === "video" ? <div className="free-media-history-preview"><video src={item.mediaUrl} controls preload="metadata" /></div>
                    : <div className="free-media-history-preview free-media-history-audio"><i>♫</i><audio src={item.mediaUrl} controls preload="metadata" /></div>}
                <footer><span><strong title={item.title}>{item.title}</strong><small>{item.provider || "本地媒体"}</small></span><div><button type="button" onClick={() => addHistoryItemsToCanvas([item])}>加入画布</button><a href={item.mediaUrl} download={item.title}>下载</a></div></footer>
              </article>;
            })}</div></section>)}
            {!visibleMediaHistory.length && <div className="free-media-history-empty"><HistoryToolIcon /><strong>这里还没有{nodeLabels[mediaHistoryKind]}历史</strong><span>对应媒体进入画布后会自动归档到这里。</span></div>}
            {visibleMediaHistory.length > 0 && <p className="free-media-history-end">已显示全部历史</p>}
          </div>
        </section>
      </div>}
      <div className="free-canvas-zoom"><button onClick={() => void flowRef.current?.zoomOut({ duration: 180 })}>−</button><span>{Math.round(displayZoom * 100)}%</span><button onClick={() => void flowRef.current?.zoomIn({ duration: 180 })}>+</button><button onClick={() => void flowRef.current?.fitView({ padding: .2, duration: 350, minZoom: .2, maxZoom: 1 })}>适配</button></div>
      {imageViewer && <div className="free-image-viewer" role="dialog" aria-modal="true" aria-label={`${imageViewer.title}大图预览`} onMouseDown={(event) => { if (event.target === event.currentTarget) setImageViewer(null); }}>
        <header><div><small>图片预览</small><strong>{imageViewer.title}</strong></div><div><a href={imageViewer.src} download title="下载图片"><ImageToolIcon kind="download" />下载</a><button type="button" onClick={() => setImageViewer(null)} aria-label="关闭大图预览">×</button></div></header>
        <div><img src={imageViewer.src} alt={imageViewer.title} /></div>
      </div>}
      {imageToolDialog && imageToolSource?.mediaUrl && <div className="free-image-tool-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageToolBusy) setImageToolDialog(null); }}>
        <section className="free-image-tool-dialog" role="dialog" aria-modal="true" aria-label={imageToolDialog.mode === "upscale" ? "Real-ESRGAN图片超分" : "Image 2图片编辑与派生"}>
          <header><div><small>{imageToolDialog.mode === "upscale" ? "本地图片处理" : "参考图编辑"}</small><strong>{imageToolDialog.mode === "upscale" ? "Real-ESRGAN 图片超分" : "Image 2 编辑与派生"}</strong></div><button type="button" disabled={imageToolBusy} onClick={() => setImageToolDialog(null)} aria-label="关闭图片工具">×</button></header>
          <div className="free-image-tool-source"><img src={imageToolSource.mediaUrl} alt="待处理原图"/><span><strong>{imageToolSource.title}</strong><small>原图保留 · 结果创建为右侧新节点</small></span></div>
          {imageToolDialog.mode === "upscale" ? <>
            <fieldset><legend>放大倍数</legend><div>{([2, 4] as const).map((scale) => <button type="button" key={scale} className={imageUpscaleScale === scale ? "selected" : ""} onClick={() => setImageUpscaleScale(scale)}><strong>{scale}×</strong><small>{scale === 2 ? "常用 · 更快" : "最大细节 · 更慢"}</small></button>)}</div></fieldset>
            <fieldset><legend>图像模型</legend><div><button type="button" className={imageUpscaleModel === "general" ? "selected" : ""} onClick={() => setImageUpscaleModel("general")}><strong>通用照片</strong><small>Real-ESRGAN x4plus</small></button><button type="button" className={imageUpscaleModel === "anime" ? "selected" : ""} onClick={() => setImageUpscaleModel("anime")}><strong>动漫插画</strong><small>Real-ESRGAN x4plus-anime</small></button></div></fieldset>
            <p>图片超分由本机 Real-ESRGAN 执行；视频仍使用 PRISM H3 的 RTX 视频超分。</p>
          </> : <>
            <div className="free-image-operation-grid">{(Object.keys(imageAiOperationMeta) as ImageAiOperation[]).map((operation) => <button type="button" key={operation} className={imageAiOperation === operation ? "selected" : ""} onClick={() => { setImageAiOperation(operation); setImageToolError(""); }}><strong>{imageAiOperationMeta[operation].label}</strong><small>{imageAiOperationMeta[operation].hint}</small></button>)}</div>
            {imageAiOperation !== "character-turnaround" && imageAiOperation !== "scene-multiview" && <fieldset><legend>输出画幅</legend><div>{(["landscape", "square", "portrait"] as const).map((value) => <button type="button" key={value} className={imageAiSize === value ? "selected" : ""} onClick={() => setImageAiSize(value)}><strong>{{ landscape: "3:2", square: "1:1", portrait: "2:3" }[value]}</strong><small>{{ landscape: "横图", square: "方图", portrait: "竖图" }[value]}</small></button>)}</div></fieldset>}
            <label className="free-image-tool-instruction"><span>{imageAiOperationMeta[imageAiOperation].label}要求</span><textarea value={imageAiInstruction} maxLength={2_000} placeholder={imageAiOperationMeta[imageAiOperation].hint} onChange={(event) => setImageAiInstruction(event.target.value)} /></label>
            <p>提交时当前图会作为 <b>@图片1</b>；生成提示词将保留这个引用标记和你的具体要求。</p>
          </>}
          {imageToolError && <p className="free-image-tool-error" role="alert">{imageToolError}</p>}
          <footer><button type="button" disabled={imageToolBusy} onClick={() => setImageToolDialog(null)}>取消</button><button type="button" className="primary" disabled={imageToolBusy} onClick={() => imageToolDialog.mode === "upscale" ? void runLocalImageTool(imageToolSource, "upscale") : void runAiImageDerivation(imageToolSource)}>{imageToolBusy ? "处理中…" : imageToolDialog.mode === "upscale" ? `生成${imageUpscaleScale}×超分节点` : `生成${imageAiOperationMeta[imageAiOperation].label}节点`}</button></footer>
        </section>
      </div>}
    </section>
  );
}
import { CloudVideoTaskActions, VideoEngineControls, videoEngineLabel, usesCloudVideo, type VideoEngineSettings } from './VideoEngineControls';
