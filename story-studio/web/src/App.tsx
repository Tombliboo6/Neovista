import { AssetBatchActions } from './AssetBatchActions';
import { CloudVideoTaskActions, VideoEngineControls, videoEngineLabel, usesCloudVideo, type VideoEngineSettings } from './VideoEngineControls';
import { productionAssetBatch, type AssetBatchKind } from './asset-batch';
import { CharacterLibraryPanel, type CharacterRosterAction } from './CharacterLibraryPanel';
import { hasActiveCanvasGeneration } from './free-canvas-integrity';
import { StageFeedback } from './StageFeedback';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { changedStoryboardImageKeys, normalizeStoryboardVideoReferences, type StoryboardVideoReference } from "../../src/videos/storyboard-video-references";
import "./final-composition.css";
import { DisclosureChevron } from "./DisclosureChevron";
import { selectEpisodeCharacters } from "./episode-characters";
import { defaultFreeCanvasState, FreeCanvasWorkspace, normalizeFreeCanvasState, type CanvasMode, type DirectorCanvasSource, type DirectorSourceRef, type FreeCanvasAudioSettings, type FreeCanvasImageSettings, type FreeCanvasNode, type FreeCanvasReference, type FreeCanvasState, type FreeCanvasTextOutputTarget, type FreeCanvasVideoSettings } from "./FreeCanvas";
import { defaultEditorState, normalizeEditorState, SimpleEditor, type EditorAsset, type EditorState } from "./SimpleEditor";
import { createEmptyWorkflowSnapshot, type WorkflowSnapshot } from "../../src/workflow/runtime";
import { currentWorkflowStage, stageForWorkspaceSection, toStageViewModel, type WorkspaceSection } from "../../src/workflow/view-model";
import { DEFAULT_GENERATION_STYLE_ID, evolveGenerationPreset, GENERATION_ASPECT_RATIOS, IMAGE_RESOLUTION_TIERS, imageRequestSizeForAspectRatio, isGenerationStyleCompatible, normalizeGenerationPreset, type GenerationAspectRatio, type GenerationPresetSnapshot, type ImageResolutionTier } from "../../src/presets/generation-preset";
import type { ProjectManagerTurn } from "../../src/manager/global-manager";
import { projectManagerNavigationTarget, restoreProjectManagerCommands, type ProjectManagerCommand, type ProjectManagerFollowUpChoice } from "../../src/manager/manager-commands";
import { activeManagerCommandEntry, managerLocalWorkflowIntent, managerMessageExecutionIntent } from "./manager-conversation";
import { latestTimelineTimestamp, orderAgentTimeline, type AgentTimelineItem } from "./agent-timeline";
import { resolveWorkflowBack, type WorkflowBackApprovalKey } from "./workflow-back";
import { ProductionQueue } from "./ProductionQueue";
import { approveReadyVideoPrompts, confirmVideoPromptDraft, isReadyVideoPrompt, type RecoverableVideoPrompt } from "./video-prompt-recovery";
import { applyProductionResult, assetProductionStage, mergeByStableKey, PRODUCTION_ROUTES, productionSource } from "./production-state";

type SetupStep = "start" | "novel" | "idea" | "format" | "parameters" | "emotion" | "idea-questions" | "idea-script" | "workspace";
type CreationSource = "novel" | "idea";
type WorkType = "single" | "series";
type CreativeDirection = "story" | "commercial" | "product" | "knowledge" | "documentary" | "music_visual";
type ToneOption = { name: string; note: string; tone: string };

const creativeDirections: Array<{ id: CreativeDirection; label: string; description: string; icon: string }> = [
  { id: "story", label: "剧情叙事", description: "以人物、事件、冲突和情绪推进为核心。", icon: "▶" },
  { id: "commercial", label: "广告营销", description: "服务品牌、活动、门店或转化目标。", icon: "◆" },
  { id: "product", label: "产品展示", description: "集中呈现外观、材质、功能、用法与效果。", icon: "▣" },
  { id: "knowledge", label: "知识讲解", description: "用于科普、教程、课程、观点和信息解释。", icon: "◎" },
  { id: "documentary", label: "纪录纪实", description: "围绕真实人物、事件、采访或现场观察展开。", icon: "◉" },
  { id: "music_visual", label: "音乐与视觉", description: "以音乐、节奏、氛围和视觉概念驱动表达。", icon: "♫" },
];
const creativeDirectionIds = creativeDirections.map((item) => item.id);
const creativeDirectionLabel = (direction: CreativeDirection) => creativeDirections.find((item) => item.id === direction)?.label || "剧情叙事";
const workTypeLabel = (workType: WorkType) => workType === "series" ? "系列连载" : "单条作品";
const usesShortDurationPresets = (direction: CreativeDirection) => ["commercial", "product", "music_visual"].includes(direction);
const humanReadableSceneTime = (value: string) => ({ "日": "白天", "夜": "夜晚", "昼": "白天" }[value.trim()] || value);
const humanReadableStoryboardText = (value: string) => value
  .replace(/([·・]\s*)日(?=[。；，、,.!！?？\s]|$)/gu, "$1白天")
  .replace(/([·・]\s*)夜(?=[。；，、,.!！?？\s]|$)/gu, "$1夜晚");
const estimateStoryboardTextLines = (value: string) => humanReadableStoryboardText(value)
  .split(/\r?\n/u)
  .reduce((total, line) => {
    const visualUnits = Array.from(line).reduce((units, character) => units + (/^[\x00-\x7F]$/u.test(character) ? 0.55 : 1), 0);
    return total + Math.max(1, Math.ceil(visualUnits / 22));
  }, 0);
const storyboardTextCardHeight = (value: string) => Math.max(490, 315 + estimateStoryboardTextLines(value) * 36);

const emotions: ToneOption[] = [
  { name: "悲壮", note: "压迫中保留人物尊严与牺牲感", tone: "cyan" },
  { name: "悬疑", note: "延迟信息揭示，强调未知威胁", tone: "violet" },
  { name: "紧张", note: "加快节奏，增强危机和追迫感", tone: "blue" },
  { name: "冲突", note: "突出立场对撞与对白锋芒", tone: "red" },
  { name: "使命", note: "强化选择、承担与目标感", tone: "gold" },
];
const commercialTones: ToneOption[] = [
  { name: "高端质感", note: "突出材质、光影与品牌级完成度", tone: "violet" },
  { name: "热烈诱人", note: "强化色彩、温度、动势和感官吸引力", tone: "red" },
  { name: "清爽自然", note: "明亮、克制，突出真实成分与轻盈体验", tone: "cyan" },
  { name: "科技专业", note: "强调结构、性能、精度与可信度", tone: "blue" },
  { name: "温暖亲和", note: "以生活感和舒适氛围建立好感", tone: "gold" },
];
const knowledgeTones: ToneOption[] = [
  { name: "清晰理性", note: "层次明确，优先保证信息理解效率", tone: "blue" },
  { name: "轻松易懂", note: "用生活化表达降低理解门槛", tone: "cyan" },
  { name: "专业权威", note: "强调依据、结构和可信表达", tone: "violet" },
  { name: "活泼亲切", note: "节奏轻快，增强交流感和记忆点", tone: "gold" },
  { name: "极简克制", note: "减少装饰，让核心信息成为视觉重点", tone: "red" },
];
const documentaryTones: ToneOption[] = [
  { name: "真实克制", note: "尊重事实和现场，不制造多余戏剧性", tone: "blue" },
  { name: "人文温暖", note: "关注人物处境、关系和细微情感", tone: "gold" },
  { name: "冷静观察", note: "保持距离，以环境和行为呈现信息", tone: "cyan" },
  { name: "历史厚重", note: "强化时间沉淀、背景脉络与材料质感", tone: "violet" },
  { name: "现场紧迫", note: "突出当下进程、环境变化和行动压力", tone: "red" },
];
const musicVisualTones: ToneOption[] = [
  { name: "梦幻诗意", note: "以意象、光色和流动节奏营造感受", tone: "violet" },
  { name: "强烈节奏", note: "动作、剪辑和视觉变化紧扣音乐律动", tone: "red" },
  { name: "实验先锋", note: "使用大胆构图、材质和视觉转换", tone: "blue" },
  { name: "复古怀旧", note: "突出年代色彩、颗粒和记忆氛围", tone: "gold" },
  { name: "沉浸氛围", note: "让空间、声音和缓慢变化主导体验", tone: "cyan" },
];
const toneOptionsForDirection = (direction: CreativeDirection): ToneOption[] => {
  if (direction === "story") return emotions;
  if (direction === "knowledge") return knowledgeTones;
  if (direction === "documentary") return documentaryTones;
  if (direction === "music_visual") return musicVisualTones;
  return commercialTones;
};

function toneRecommendationContextKey(values: Array<string | number>) {
  const source = values.join('|');
  let hash = 2166136261;
  for (const character of source) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `tone-${(hash >>> 0).toString(36)}`;
}

const stageItems = ["总览", "剧本", "角色", "场景", "道具", "分镜", "视频"];
function managerStageNavigation(stageId: ProjectManagerCommand["stageId"]) {
  if (["intake", "episode-plan"].includes(stageId)) return "总览";
  if (stageId === "script") return "剧本";
  if (["character-profiles", "style-selection", "character-images"].includes(stageId)) return "角色";
  if (["scenes", "scene-views"].includes(stageId)) return "场景";
  if (stageId === "props") return "道具";
  if (["storyboard-prompts", "storyboard-images"].includes(stageId)) return "分镜";
  return "视频";
}
function managerProviderLabel(command: ProjectManagerCommand) {
  if (command.providerImpact === "none") return "不调用生成服务";
  if (command.providerImpact === "agent") return "文字 Agent";
  if (command.providerImpact === "image-edit") return "图片编辑服务";
  if (command.providerImpact === "image") return "图片生成服务";
  if (command.providerImpact === "h3") return "PRISM H3";
  return "音乐生成服务";
}
function managerNavigationButtonLabel(command: ProjectManagerCommand, again = false) {
  const prefix = again ? "再次打开" : "打开";
  if (command.stageId === "character-profiles") return `${prefix}人物设定`;
  if (command.stageId === "character-images") return `${prefix}图片提示词`;
  if (command.stageId === "storyboard-prompts") return `${prefix}文字分镜`;
  if (command.stageId === "storyboard-images") return `${prefix}分镜图片提示词`;
  if (command.stageId === "video-prompts") return `${prefix}视频提示词`;
  return command.targetArtifact ? `${prefix}修改位置` : "前往";
}
type IdeaAnswer = { question: string; answer: string };
type IdeaDirectionOption = { id: string; label: string; description: string };
type AgentTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  kind: "source" | "question" | "answer" | "revision" | "message" | "reply" | "action" | "event";
  text: string;
  options?: IdeaDirectionOption[];
  selectedOptionId?: string;
  selectedOptionIds?: string[];
  createdAt: string;
};
type ManagerTranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  turn?: ProjectManagerTurn;
  commands?: ProjectManagerCommand[];
};
type ProjectManagerMemory = {
  explicitPreferences: Array<{ id: string; text: string; sourceCommandId: string; createdAt: string }>;
};
type IdeaScript = {
  title: string; logline: string; genre: string; durationSec: number; ratio: string; language: string; emotion: string;
  workType?: WorkType; plannedEpisodeCount?: number; episodeNumber?: number;
  seriesPlan?: Array<{ episodeNumber: number; title: string; summary: string; hook: string }>;
  characters: Array<{ name: string; role: string; goal: string }>;
  scenes: Array<{ id: string; location: string; time: string; summary: string; beats: string[]; dialogue: Array<{ speaker: string; line: string }>; blocks?: Array<{ type: "action" | "dialogue" | "os" | "sfx" | "transition"; speaker: string; delivery: string; text: string }> }>;
  endingHook: string;
};

type ProviderKind = "agent" | "image" | "image-edit" | "music" | "h3" | "minimax-video" | "seedance-video";
type TextProviderProtocol = "auto" | "responses" | "chat-completions" | "anthropic-messages";
type TextCapabilities = { maxOutputTokens?: number; contextWindowTokens?: number; allowedReturnedModels?: string[] };
type ProviderProfilePublic = {
  capabilities?: TextCapabilities;
  id: string;
  name: string;
  configured: boolean;
  baseUrl: string;
  model: string;
  keyHint: string;
  active: boolean;
  protocol?: TextProviderProtocol;
};
type ProviderPublicStatus = {
  kind: ProviderKind;
  configured: boolean;
  baseUrl: string;
  model: string;
  keyHint: string;
  activeProfileId: string;
  profiles: ProviderProfilePublic[];
};

function normalizeProviderStatus(provider: ProviderPublicStatus): ProviderPublicStatus {
  const legacyProfileId = provider.activeProfileId || `legacy-${provider.kind}`;
  const profiles = Array.isArray(provider.profiles)
    ? provider.profiles
    : provider.configured
      ? [{
          id: legacyProfileId,
          name: provider.model || "默认模型",
          configured: true,
          baseUrl: provider.baseUrl || "",
          model: provider.model || "",
          keyHint: provider.keyHint || "",
          active: true,
          protocol: "auto" as TextProviderProtocol,
        }]
      : [];
  const activeProfileId = provider.activeProfileId || profiles.find((profile) => profile.active)?.id || profiles[0]?.id || "";
  return { ...provider, activeProfileId, profiles: profiles.map((profile) => ({ ...profile, active: profile.id === activeProfileId })) };
}

function normalizeProviderStatuses(providers: ProviderPublicStatus[]) {
  return providers.map(normalizeProviderStatus);
}
type ProviderTestResult = { status: string; message: string; checkedAt: string; details?: { resolvedBaseUrl?: string } };
type SettingsSection = "connections" | "creative" | "storage" | "diagnostics";
type StoryboardBoardPanelCount = 3 | 4 | 6 | 9;
type AppCreativeDefaults = {
  storyboardSegmentDurationSec: 5 | 10 | 15;
  storyboardBoardPanelCount: StoryboardBoardPanelCount;
  h3QualityPreset: "standard" | "balanced" | "fast";
  h3Resolution: "480p" | "720p" | "1080p";
  subtitles: "ask" | "none" | "burned";
  audioMode: "ask" | "native" | "native_with_music" | "music_only";
};
type AppSettingsStatus = {
  settings: { creativeDefaults: AppCreativeDefaults };
  storage: Array<{ id: string; label: string; path: string; available: boolean }>;
  diagnostics: { appVersion: string; localService: string; nodeVersion: string; platform: string; configuredProviders?: number; totalProviders?: number };
};
type ProjectSummary = { id: string; name: string; status: string; updatedAt: string; active: boolean; seriesProjectId?: string; episodeNumber?: number };
type AssetLibraryType = "character" | "scene" | "prop" | "style" | "lora" | "text" | "image" | "video" | "audio";
type AssetLibraryItem = {
  managedCharacter?: boolean;
  id: string; familyKey: string; version: number; type: AssetLibraryType; name: string; description: string; tags: string[]; prompt: string;
  content?: string;
  media: { mainImageUrl?: string; auxiliaryImageUrl?: string; referenceImageUrls?: string[]; videoUrl?: string; audioUrl?: string };
  modelResource?: { filePath: string; backend: string; baseModel: string; defaultStrength: number; sha256?: string; integrationStatus: "registered_only" };
  sourceProjectId: string; sourceProjectName: string; sourceAssetKey: string; status: "approved";
  folder: string; favorite: boolean;
  usages: Array<{ projectId: string; projectName: string; targetType: string; targetKey: string; targetName: string; appliedAt: string }>;
  createdAt: string; updatedAt: string;
};
type AssetLibraryInput = {
  type: AssetLibraryType; name: string; sourceAssetKey?: string; description?: string; content?: string; tags?: string[]; prompt?: string; folder?: string; favorite?: boolean;
  media?: { mainImageUrl?: string; auxiliaryImageUrl?: string; referenceImageUrls?: string[]; videoUrl?: string; audioUrl?: string };
  modelResource?: { filePath: string; backend?: string; baseModel?: string; defaultStrength?: number; sha256?: string };
};
type AssetLibraryTarget = { type: "character" | "scene" | "prop"; key: string; name: string };
type AssetReplacementUndo = { id: string; assetId: string; assetName: string; targetType: string; targetKey: string; targetName: string; createdAt: string };
type CanvasPoint = { x: number; y: number };
type CanvasView = { x: number; y: number; zoom: number; nodes: Record<string, CanvasPoint> };
type ScriptApproval = "draft" | "approved";
type EpisodeScriptRecord = {
  scriptKey: string;
  episodeNumber: number;
  version: number;
  status: "idle" | "running" | "complete" | "failed";
  approval: ScriptApproval;
  script?: IdeaScript;
  error?: string;
};
type CharacterStageStatus = "idle" | "running" | "complete" | "failed";
type CharacterProfile = {
  participation?: "visual" | "voice" | "candidate"; manuallyAdded?: boolean; libraryBinding?: { identityId: string; lookId: string; lookName: string; assetId?: string; reused?: boolean; selectionNeeded?: boolean };
  profileKey: string; name: string; aliases: string[]; introduction: string; identity: string; storyRole: string;
  personality: string[]; motivation: string; relationships: Array<{ targetName: string; relationship: string }>;
  physicalKnownFacts: string[]; wardrobeKnownFacts: string[]; designOpenQuestions: string[];
  sourceSceneKeys: string[]; sourceFacts: Array<{ fact: string; sceneKey: string; evidence: string }>;
};
type StylePreset = { id: string; name: string; description: string; styleAnchor: string; category: string; recommendationPriority: number; previewPalette: [string, string, string]; previewLabel: string; imageUrl?: string };
type PresetTracked = { previousVersions?: any[]; version?: number; generationPreset?: GenerationPresetSnapshot; stale?: boolean; approval?: ScriptApproval };
const usesCurrentGenerationPreset = (value: PresetTracked | null | undefined, preset: GenerationPresetSnapshot) => Boolean(value?.generationPreset && value.generationPreset.styleId === preset.styleId && value.generationPreset.aspectRatio === preset.aspectRatio);
type CharacterImageResult = PresetTracked & { profileKey: string; name: string; status: "complete" | "failed"; imageUrl?: string; error?: string };
type CharacterImagePrompt = PresetTracked & { profileKey: string; name: string; styleId: string; prompt: string };
type CharacterTurnaroundResult = { profileKey: string; name: string; status: "running" | "complete" | "failed"; imageUrl?: string; error?: string };
type CharacterImageStatus = "idle" | "running" | "complete" | "failed";
type SceneStageStatus = "idle" | "running" | "complete" | "failed";
type SceneVisualProposal = {
  promptKey: string; sceneAssetKey: string; name: string; sourceSceneKeys: string[]; baseStateSceneKey: string;
  assetRecommendation?: "required" | "text_only"; assetRecommendationReason?: string;
  selectedForProduction?: boolean;
  sourceFacts: Array<{ fact: string; sceneKey: string; evidence: string }>;
  stateVariants: Array<{ sceneKey: string; stateDescription: string; sourceEvidence: string[] }>;
  visualDesignProposal: {
    locationIdentity: string; spatialLayout: string; terrainAndArchitecture: string; materialsAndSurfaces: string;
    fixedLandmarks: string[]; lightingAndColor: string; weatherAndAtmosphere: string;
    reusableCameraCoverage: string; designDecisions: string[];
  };
};
const sceneAssetRecommendation = (proposal: SceneVisualProposal): "required" | "text_only" => proposal.assetRecommendation === "text_only" ? "text_only" : "required";
const sceneAssetRecommendationCopy = (proposal: SceneVisualProposal) => sceneAssetRecommendation(proposal) === "required" ? "建议保留" : "无需固定资产";
type SceneImagePrompt = PresetTracked & { sceneAssetKey: string; name: string; styleId: string; prompt: string };
type SceneImageResult = PresetTracked & { sceneAssetKey: string; name: string; status: "complete" | "failed"; imageUrl?: string; error?: string };
type SceneViewResult = { sceneAssetKey: string; name: string; status: "running" | "complete" | "failed" | "needs_selection"; imageUrl?: string; imageUrls?: string[]; error?: string };
type PropVisualProposal = {
  promptKey: string; propAssetKey: string; name: string; aliases: string[]; sourceSceneKeys: string[]; baseStateSceneKey: string; baseStateDescription: string;
  assetRecommendation?: "required" | "optional" | "text_only"; assetRecommendationReason?: string;
  sourceMappingStatus?: "resolved" | "needs_review"; sourceMappingNote?: string;
  selectedForProduction?: boolean;
  sourceFacts: Array<{ fact: string; sceneKey: string; evidence: string }>;
  stateVariants: Array<{ stateKey: string; sceneKey: string; sourceSceneKeys?: string[]; stateDescription: string; sourceEvidence: string[] }>;
  visualDesignProposal: { objectIdentity: string; silhouetteAndProportions: string; materialsAndSurface: string; constructionAndDetails: string; colorAndFinish: string; scaleAndHandling: string; repeatableAnchors: string[]; designDecisions: string[] };
};
const propAssetRecommendation = (proposal: PropVisualProposal): "required" | "optional" | "text_only" => ["required", "optional", "text_only"].includes(proposal.assetRecommendation || "") ? proposal.assetRecommendation! : "optional";
const propAssetRecommendationCopy = (proposal: PropVisualProposal) => propAssetRecommendation(proposal) === "required" ? "建议建立独立资产" : propAssetRecommendation(proposal) === "optional" ? "按镜头需要选择" : "默认随分镜生成";
type PropImagePrompt = PresetTracked & { propAssetKey: string; name: string; styleId: string; prompt: string };
type PropImageResult = PresetTracked & { propAssetKey: string; name: string; status: "complete" | "failed"; imageUrl?: string; error?: string };
type StoryboardSegment = {
  segmentKey: string; sceneKey: string; sceneKeys?: string[]; order: number; title: string; durationSec: number; characters: string[];
  sceneAssetKey?: string; sceneViewKey: string; propStateKey: string; storyboardText: string; transition: string;
  actionEvidenceIds: string[]; dialogueEvidenceIds: string[]; soundCueIds: string[]; referenceAssetIds: string[];
};
type StoryboardBoardPlan = PresetTracked & { segmentKey: string; plan: unknown; stale?: boolean };
type StoryboardBoardPrompt = PresetTracked & { segmentKey: string; title: string; panelCount?: StoryboardBoardPanelCount; prompt: string; referenceBindingAddedProps?: string[] };
type StoryboardBoardResult = PresetTracked & { segmentKey: string; title: string; panelCount?: StoryboardBoardPanelCount; status: "idle" | "running" | "complete" | "failed" | "needs_selection"; queueState?: "queued"; imageUrl?: string; imageUrls?: string[]; referenceAssetIds?: string[]; referenceLabels?: string[]; videoUrl?: string; error?: string };
type StoryboardBoardGenerationJob = {
  segmentKey: string;
  panelCount: StoryboardBoardPanelCount;
  generationPreset: GenerationPresetSnapshot;
  payload: Record<string, unknown>;
  resolve: () => void;
};

type VideoPromptResult = {
  segmentKey: string; title: string; durationSec: number; status: "running" | "complete" | "needs_revision" | "failed" | "stale";
  prompt: string; referenceLabels: string[]; referenceImageUrls: string[]; plan?: unknown; error?: string; validationIssues?: string[]; validationCodes?: string[]; validationWarnings?: string[]; validationWarningCodes?: string[]; repairAttempted?: boolean;
  repairSourcePrompt?: string; repairSourceValidationIssues?: string[]; repairSourceValidationCodes?: string[];
  manualReview?: RecoverableVideoPrompt['manualReview'];
  referenceLayoutVersion?: number; storyboardReference?: StoryboardVideoReference; storyboardVisionVersion?: number;
} & PresetTracked;
function areAllVideoPromptsComplete(segments: StoryboardSegment[], prompts: VideoPromptResult[]) {
  return segments.length > 0 && segments.every((segment) => prompts.some((item) => item.segmentKey === segment.segmentKey && isReadyVideoPrompt(item)));
}

const VIDEO_PROMPT_ADVISORY_CODE_PATTERNS = [
  /timeline beats must cover panel keys exactly once and in order/iu,
  /timeline beat \d+ does not continue the previous end state/iu,
  /reference binding shot execution must use/iu,
] as const;

function isVideoPromptAdvisoryCode(value: string) {
  return VIDEO_PROMPT_ADVISORY_CODE_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeStoredVideoPromptSeverity(item: VideoPromptResult): VideoPromptResult {
  if (item.status !== "needs_revision" || !item.prompt.trim()) return item;
  const issueCodes = Array.isArray(item.validationCodes) ? item.validationCodes : [];
  const issueMessages = Array.isArray(item.validationIssues) ? item.validationIssues : [];
  const blockingIndexes = issueCodes.map((code, index) => ({ code, index })).filter(({ code }) => !isVideoPromptAdvisoryCode(code));
  const advisoryIndexes = issueCodes.map((code, index) => ({ code, index })).filter(({ code }) => isVideoPromptAdvisoryCode(code));
  if (advisoryIndexes.length === 0) return item;
  const warningCodes = [...new Set([...(item.validationWarningCodes || []), ...advisoryIndexes.map(({ code }) => code)])];
  const warningMessages = [...new Set([...(item.validationWarnings || []), ...advisoryIndexes.map(({ index }) => issueMessages[index]).filter(Boolean)])];
  if (blockingIndexes.length === 0) {
    return { ...item, status: "complete", error: undefined, validationIssues: undefined, validationCodes: undefined, validationWarnings: warningMessages, validationWarningCodes: warningCodes };
  }
  const validationCodes = blockingIndexes.map(({ code }) => code);
  const validationIssues = blockingIndexes.map(({ index }) => issueMessages[index]).filter(Boolean);
  return { ...item, error: `需要修改：${validationIssues.join("；")}。Agent草稿已保留，可直接打开修改。`, validationIssues, validationCodes, validationWarnings: warningMessages, validationWarningCodes: warningCodes };
}

function currentVideoPromptProblemSummary(segments: StoryboardSegment[], prompts: VideoPromptResult[]) {
  const problems = segments.flatMap((segment) => {
    const prompt = prompts.find((item) => item.segmentKey === segment.segmentKey);
    if (prompt?.status === "needs_revision" && prompt.prompt.trim()) return [`${segment.segmentKey}（${(prompt.validationIssues || []).join("；") || "草稿需要修改"}）`];
    if (!prompt?.prompt.trim() || prompt.status === "failed" || prompt.status === "stale") return [`${segment.segmentKey}（尚无可用提示词）`];
    return [];
  });
  return problems.length ? `${problems.length}段需要处理：${problems.join("；")}` : "";
}
type H3Health = { status: string; message: string; checkedAt: string; details?: Record<string, unknown> };
type LocalGpuStatus = { busy: boolean; active?: { kind: "h3-submit" | "ace-music" | "image-upscale"; taskId: string; label: string; startedAt: string } };
type H3Connection = { status: "idle" | "checking" | "starting" | "online" | "offline"; health?: H3Health; localGpu?: LocalGpuStatus; error?: string };
type LocalMusicConnection = { status: "idle" | "checking" | "ready" | "unavailable"; health?: H3Health; error?: string };
type H3GenerationSettings = VideoEngineSettings & {
  mode: "text" | "reference";
  qualityPreset: "standard" | "balanced" | "fast" | "custom";
  resolution: "480p" | "720p" | "1080p";
  inferenceSteps: number;
  accelerationModel: "none" | "turbo4" | "lightx2v-544p-v1" | "lightx2v-768p-v1";
  spectrum: boolean;
  sage: boolean;
  randomSeed: boolean;
  seed: number;
};
type ShotVideoTask = {
  segmentKey: string;
  status: "waiting_dependency" | "submitting" | "queued" | "running" | "awaiting_review" | "failed" | "cancelled";
  externalTaskId?: string;
  outputPaths?: string[];
  parameters?: Record<string, unknown>;
  submissionIntent?: ShotVideoSubmissionIntent;
  error?: string;
  updatedAt: string;
} & PresetTracked;
type ShotContinuityMode = "independent" | "start_chain" | "continue";
type ShotVideoSubmissionIntent = {
  requestId?: string;
  continuityMode: ShotContinuityMode;
  sourceSegmentKey?: string;
  settings: H3GenerationSettings;
  generationPreset: GenerationPresetSnapshot;
  queuedAt: string;
};
type H3TaskResponse = {
  status: "queued" | "running" | "awaiting_review" | "completed" | "failed" | "cancelled";
  externalTaskId?: string;
  outputPaths?: string[];
  parameters?: Record<string, unknown>;
  errorMessage?: string;
  updatedAt?: string;
};
type H3RecoverableJob = {
  externalTaskId: string;
  segmentKey?: string;
  status: "queued" | "running" | "awaiting_review" | "failed";
};
type RoughCutResult = {
  status: "idle" | "running" | "complete" | "failed" | "stale";
  filename?: string; outputPath?: string; mediaUrl?: string; manifestPath?: string; clipCount?: number; durationSec?: number;
  width?: number; height?: number; fps?: string; audioPresent?: boolean; error?: string; createdAt?: string;
};
type MusicCue = {
  segmentKey: string; startSec: number; endSec: number; musicalFunction: string;
  energy: "low" | "medium" | "high"; instrumentation: string; mixNote: string;
};
type MusicPromptPlan = {
  title: string; creativeDirection: string; minimaxPrompt: string; instrumental: true;
  targetDurationSec: number; cues: MusicCue[]; mixGuidance: string[];
};
type MusicPromptResult = {
  status: "idle" | "running" | "complete" | "needs_revision" | "failed" | "stale";
  plan?: MusicPromptPlan; error?: string; validationIssues?: string[]; validationWarnings?: string[]; repairAttempted?: boolean; updatedAt?: string;
};
type MusicGenerationResult = {
  status: "idle" | "running" | "complete" | "failed" | "unqualified" | "stale";
  filename?: string; outputPath?: string; mediaUrl?: string; durationSec?: number; requestedDurationSec?: number;
  provider?: string; inferenceSteps?: number; seed?: number; externalTaskId?: string; error?: string; createdAt?: string; startedAt?: string;
};
type FinalCompositionResult = {
  status: "idle" | "running" | "complete" | "failed" | "stale";
  filename?: string; outputPath?: string; mediaUrl?: string; manifestPath?: string; subtitlePath?: string; subtitleCount?: number;
  durationSec?: number; width?: number; height?: number; fps?: string; audioPresent?: boolean; audioMode?: string; error?: string; createdAt?: string;
};
type PostProductionState = {
  view: "overview" | "discussion" | "shots";
  audioMode: "undecided" | "native" | "native_with_music" | "music_only";
  subtitles: "undecided" | "none" | "burned";
  musicSeed: number;
  musicBpm: number;
  musicKeyScale: string;
  musicTimeSignature: "2" | "3" | "4" | "6";
  musicInferenceSteps: number;
  musicThinking: boolean;
  notes: string[];
  agentReply: string;
  roughCut: RoughCutResult;
  roughCutApproval: ScriptApproval;
  musicPrompt: MusicPromptResult;
  musicPromptApproval: ScriptApproval;
  music: MusicGenerationResult;
  musicApproval: ScriptApproval;
  finalComposition: FinalCompositionResult;
};

const defaultAppCreativeDefaults = (): AppCreativeDefaults => ({
  storyboardSegmentDurationSec: 15,
  storyboardBoardPanelCount: 3,
  h3QualityPreset: "standard",
  h3Resolution: "480p",
  subtitles: "ask",
  audioMode: "ask",
});

function normalizeStoryboardBoardPanelCount(value: unknown, fallback: StoryboardBoardPanelCount): StoryboardBoardPanelCount {
  const panelCount = Number(value);
  return [3, 4, 6, 9].includes(panelCount) ? panelCount as StoryboardBoardPanelCount : fallback;
}

function normalizeAppCreativeDefaults(value: Partial<AppCreativeDefaults> | null | undefined): AppCreativeDefaults {
  const defaults = defaultAppCreativeDefaults();
  const storyboardSegmentDurationSec = Number(value?.storyboardSegmentDurationSec);
  return {
    storyboardSegmentDurationSec: [5, 10, 15].includes(storyboardSegmentDurationSec)
      ? storyboardSegmentDurationSec as AppCreativeDefaults["storyboardSegmentDurationSec"]
      : defaults.storyboardSegmentDurationSec,
    storyboardBoardPanelCount: normalizeStoryboardBoardPanelCount(value?.storyboardBoardPanelCount, defaults.storyboardBoardPanelCount),
    h3QualityPreset: ["standard", "balanced", "fast"].includes(String(value?.h3QualityPreset)) ? value!.h3QualityPreset! : defaults.h3QualityPreset,
    h3Resolution: ["480p", "720p", "1080p"].includes(String(value?.h3Resolution)) ? value!.h3Resolution! : defaults.h3Resolution,
    subtitles: ["ask", "none", "burned"].includes(String(value?.subtitles)) ? value!.subtitles! : defaults.subtitles,
    audioMode: ["ask", "native", "native_with_music", "music_only"].includes(String(value?.audioMode)) ? value!.audioMode! : defaults.audioMode,
  };
}

function storyboardBoardLabel(panelCount: StoryboardBoardPanelCount): string {
  return `${normalizeStoryboardBoardPanelCount(panelCount, 3)}宫格`;
}

function normalizeStoredStoryboardBoardError(value: unknown, panelCount: StoryboardBoardPanelCount): string {
  const source = typeof value === "string" ? value : "";
  const marker = "\n\nAgent 已返回的正文：\n";
  const message = (source.includes(marker) ? source.slice(0, source.indexOf(marker)) : source).slice(0, 4_000);
  if (!message.includes("undefined")) return message;
  return message
    .replaceAll("undefined宫格", storyboardBoardLabel(panelCount))
    .replaceAll("undefined格", `${panelCount}格`);
}

function storyboardPlanPanelCount(item: StoryboardBoardPlan | undefined): StoryboardBoardPanelCount {
  const plan = item?.plan && typeof item.plan === "object" ? item.plan as { panelCount?: unknown } : undefined;
  return normalizeStoryboardBoardPanelCount(plan?.panelCount, 6);
}

function storyboardPromptPanelCount(item: StoryboardBoardPrompt | undefined): StoryboardBoardPanelCount {
  return normalizeStoryboardBoardPanelCount(item?.panelCount, 6);
}

function storyboardBoardResultPanelCount(item: StoryboardBoardResult | undefined): StoryboardBoardPanelCount {
  return normalizeStoryboardBoardPanelCount(item?.panelCount, 6);
}

function repairStoredVideoPromptPanelReference(value: unknown, panelCount: StoryboardBoardPanelCount): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replaceAll("undefined宫格", storyboardBoardLabel(panelCount))
    .replaceAll("undefined格", `${panelCount}格`);
}

function removeResolvedSubjectOwnerWarnings(item: VideoPromptResult): VideoPromptResult {
  const warningCodes = Array.isArray(item.validationWarningCodes) ? item.validationWarningCodes : [];
  const warnings = Array.isArray(item.validationWarnings) ? item.validationWarnings : [];
  const beats = (item.plan as { videoPromptSections?: { timelineBeats?: Array<{ execution?: string }> } } | undefined)?.videoPromptSections?.timelineBeats;
  if (!warningCodes.length || !Array.isArray(beats)) return item;
  const keep = warningCodes.map((code) => {
    const match = code.match(/^timeline beat (\d+) must name action owner (.+)$/iu);
    if (!match) return true;
    const beat = beats[Number(match[1]) - 1];
    if (!beat?.execution) return true;
    const owner = match[2];
    const subjectTags = [...item.prompt.matchAll(/<Subject\s+\d+>/giu)].map((candidate) => candidate[0]);
    const boundSubject = subjectTags.find((tag) => {
      const position = item.prompt.indexOf(tag);
      return position >= 0 && item.prompt.slice(position, position + 160).includes(owner);
    });
    return !(boundSubject && beat.execution.includes(boundSubject));
  });
  if (keep.every(Boolean)) return item;
  return {
    ...item,
    validationWarningCodes: warningCodes.filter((_, index) => keep[index]),
    validationWarnings: warnings.filter((_, index) => keep[index]),
  };
}

function normalizeStoredVideoPromptResult(item: VideoPromptResult, plans: StoryboardBoardPlan[], boards: StoryboardBoardResult[], fallbackPanelCount: StoryboardBoardPanelCount): VideoPromptResult {
  item = normalizeStoryboardVideoReferences(item);
  const firstReferenceUrl = Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls[0] : undefined;
  const board = boards.find((candidate) => candidate.segmentKey === item.segmentKey && (!firstReferenceUrl || candidate.imageUrl === (item.storyboardReference?.imageUrl || firstReferenceUrl)));
  const panelCount = board
    ? normalizeStoryboardBoardPanelCount(board.panelCount, 6)
    : storyboardPlanPanelCount(plans.find((candidate) => candidate.segmentKey === item.segmentKey)) || fallbackPanelCount;
  return normalizeStoredVideoPromptSeverity(removeResolvedSubjectOwnerWarnings({
    ...item,
    prompt: repairStoredVideoPromptPanelReference(item.prompt, panelCount) || "",
    referenceLabels: Array.isArray(item.referenceLabels) ? item.referenceLabels.map((label) => repairStoredVideoPromptPanelReference(label, panelCount) || "").filter(Boolean) : [],
    repairSourcePrompt: repairStoredVideoPromptPanelReference(item.repairSourcePrompt, panelCount),
  }));
}

const defaultH3GenerationSettings = (defaults: AppCreativeDefaults = defaultAppCreativeDefaults()): H3GenerationSettings => ({
  mode: "reference",
  qualityPreset: defaults.h3QualityPreset,
  resolution: defaults.h3Resolution,
  inferenceSteps: defaults.h3QualityPreset === "balanced" ? 10 : defaults.h3QualityPreset === "fast" ? 6 : 20,
  accelerationModel: defaults.h3QualityPreset === "fast" ? "turbo4" : "none",
  spectrum: defaults.h3QualityPreset !== "fast",
  sage: true,
  randomSeed: true,
  seed: 123456789,
});

const defaultPostProductionState = (defaults: AppCreativeDefaults = defaultAppCreativeDefaults()): PostProductionState => ({
  view: "overview", audioMode: defaults.audioMode === "ask" ? "undecided" : defaults.audioMode, subtitles: defaults.subtitles === "ask" ? "undecided" : defaults.subtitles, musicSeed: 20260826, musicBpm: 84, musicKeyScale: "A Minor", musicTimeSignature: "4", musicInferenceSteps: 8, musicThinking: true, notes: [], agentReply: "",
  roughCut: { status: "idle" }, roughCutApproval: "draft",
  musicPrompt: { status: "idle" }, musicPromptApproval: "draft",
  music: { status: "idle" }, musicApproval: "draft", finalComposition: { status: "idle" },
});

function normalizePostProductionState(value?: Partial<PostProductionState>): PostProductionState {
  const defaults = defaultPostProductionState();
  const roughCut = value?.roughCut && ["idle", "running", "complete", "failed", "stale"].includes(value.roughCut.status) ? value.roughCut : defaults.roughCut;
  const musicPrompt = value?.musicPrompt && ["idle", "running", "complete", "needs_revision", "failed", "stale"].includes(value.musicPrompt.status) ? value.musicPrompt : defaults.musicPrompt;
  const music = value?.music && ["idle", "running", "complete", "failed", "unqualified", "stale"].includes(value.music.status) ? value.music : defaults.music;
  const finalComposition = value?.finalComposition && ["idle", "running", "complete", "failed", "stale"].includes(value.finalComposition.status) ? value.finalComposition : defaults.finalComposition;
  const localizedMusicPrompt: MusicPromptResult = musicPrompt.status === "failed" && /minimaxPrompt must assign the complete melodic role to instruments/u.test(musicPrompt.error || "")
    ? { ...musicPrompt, error: "配乐方案已经返回，但提示词没有明确写出由哪些乐器完整承担旋律与主题。可改为：‘钢琴、低音弦乐和克制打击乐完整承担旋律、主题、节奏与情绪表达。’本次旧草稿未被保存，请重新生成一次；新流程会自动校正一次并保留仍需修改的草稿。" }
    : musicPrompt;
  return {
    view: ["overview", "discussion", "shots"].includes(value?.view || "") ? value!.view! : defaults.view,
    audioMode: ["undecided", "native", "native_with_music", "music_only"].includes(value?.audioMode || "") ? value!.audioMode! : defaults.audioMode,
    subtitles: ["undecided", "none", "burned"].includes(value?.subtitles || "") ? value!.subtitles! : defaults.subtitles,
    musicSeed: Number.isInteger(Number(value?.musicSeed)) ? Math.max(0, Math.min(2_147_483_647, Number(value?.musicSeed))) : defaults.musicSeed,
    musicBpm: Number.isInteger(Number(value?.musicBpm)) ? Math.max(30, Math.min(300, Number(value?.musicBpm))) : defaults.musicBpm,
    musicKeyScale: typeof value?.musicKeyScale === "string" && value.musicKeyScale.trim() ? value.musicKeyScale.slice(0, 80) : defaults.musicKeyScale,
    musicTimeSignature: ["2", "3", "4", "6"].includes(value?.musicTimeSignature || "") ? value!.musicTimeSignature! : defaults.musicTimeSignature,
    musicInferenceSteps: Number.isInteger(Number(value?.musicInferenceSteps)) ? Math.max(1, Math.min(20, Number(value?.musicInferenceSteps))) : defaults.musicInferenceSteps,
    musicThinking: value?.musicThinking !== false,
    notes: Array.isArray(value?.notes) ? value!.notes!.filter((item) => typeof item === "string").slice(-30) : [],
    agentReply: typeof value?.agentReply === "string" ? value.agentReply : "",
    roughCut: roughCut.status === "running" ? { ...roughCut, status: "failed", error: "上次本地粗剪因页面关闭而中断；没有自动重试。" } : roughCut,
    roughCutApproval: value?.roughCutApproval === "approved" ? "approved" : "draft",
    musicPrompt: localizedMusicPrompt.status === "running" ? { ...localizedMusicPrompt, status: "failed", error: "上次配乐提示词请求因页面关闭而中断；没有自动重试。" } : localizedMusicPrompt,
    musicPromptApproval: value?.musicPromptApproval === "approved" ? "approved" : "draft",
    music: music.status === "running" ? { ...music, status: "failed", error: "上次音乐生成因页面关闭而中断；没有自动重试。" } : music,
    musicApproval: value?.musicApproval === "approved" ? "approved" : "draft",
    finalComposition: finalComposition.status === "running" ? { ...finalComposition, status: "failed", error: "上次最终合成因页面关闭而中断；没有自动重试。" } : finalComposition,
  };
}

function normalizeH3GenerationSettings(value?: Partial<H3GenerationSettings>): H3GenerationSettings {
  const defaults = defaultH3GenerationSettings();
  const seed = Number(value?.seed);
  return {
    ...(value?.engine === 'minimax' || value?.engine === 'seedance' ? { engine: value.engine, profileId: value.profileId || '', cloudResolution: value.cloudResolution || (value.engine === 'minimax' ? '768p' as const : '720p' as const), generateAudio: value.generateAudio === true } : {}),
    mode: value?.mode === "text" ? "text" : "reference",
    qualityPreset: ["standard", "balanced", "fast", "custom"].includes(value?.qualityPreset || "") ? value!.qualityPreset! : defaults.qualityPreset,
    resolution: ["480p", "720p", "1080p"].includes(value?.resolution || "") ? value!.resolution! : defaults.resolution,
    inferenceSteps: Math.max(1, Math.min(60, Number(value?.inferenceSteps) || defaults.inferenceSteps)),
    accelerationModel: ["none", "turbo4", "lightx2v-544p-v1", "lightx2v-768p-v1"].includes(value?.accelerationModel || "") ? value!.accelerationModel! : defaults.accelerationModel,
    spectrum: typeof value?.spectrum === "boolean" ? value.spectrum : defaults.spectrum,
    sage: typeof value?.sage === "boolean" ? value.sage : defaults.sage,
    randomSeed: typeof value?.randomSeed === "boolean" ? value.randomSeed : defaults.randomSeed,
    seed: Number.isInteger(seed) ? Math.max(0, Math.min(2_147_483_647, seed)) : defaults.seed,
  };
}

function createRandomH3Seed(): number {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return values[0] & 0x7fffffff;
}

function materializeH3SubmissionSettings(settings: H3GenerationSettings): H3GenerationSettings {
  const normalized = normalizeH3GenerationSettings(settings);
  return normalized.randomSeed ? { ...normalized, seed: createRandomH3Seed() } : normalized;
}

function h3RequestSettings(settings: H3GenerationSettings): Omit<H3GenerationSettings, "randomSeed"> {
  const { randomSeed: _randomSeed, ...requestSettings } = settings;
  return requestSettings;
}

function sanitizeProductionPrompt(value: string): string {
  return value.replace(/OiiOii式/gi, "双栏").replace(/Oii式/gi, "双栏").replace(/OiiOii/gi, "").replace(/Oii/gi, "");
}

function localizeStoredImageError(value?: string): string | undefined {
  if (!value) return value;
  if (/moderation_blocked|(?:rejected|blocked).*(?:safety|moderation)|(?:safety|moderation).*(?:rejected|blocked)/iu.test(value)) {
    return "图片请求被安全审核拦截。错误代码：moderation_blocked。处理建议：保留剧情目标，将可能涉及未成年人、威胁、伤害或其他敏感内容的动作改为非接触、非伤害表达，并检查参考图后再手动提交。没有自动重试。";
  }
  return value;
}

async function readApiJson<T>(response: Response, actionLabel: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(response.status === 404 ? `本地服务尚未加载${actionLabel}接口，请刷新页面后再试。` : `${actionLabel}接口返回了空响应，请确认本地服务仍在运行；系统没有自动重试。`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${actionLabel}接口返回了无法读取的内容，请刷新页面后再试；系统没有自动重试。`); }
}

class WorkflowRequestError extends Error {
  readonly summary: string;
  readonly returnedDraft: string;
  readonly validationIssues: string[];

  constructor(summary: string, returnedDraft = "", validationIssues: string[] = []) {
    const issueText = validationIssues.length > 0 ? `\n\n未通过原因：\n${validationIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}` : "";
    super(`${summary}${issueText}`);
    this.name = "WorkflowRequestError";
    this.summary = summary;
    this.returnedDraft = returnedDraft;
    this.validationIssues = validationIssues;
  }
}

class CreativeSessionSynchronizedError extends Error {
  constructor() {
    super("项目已同步到最新版本。本次操作未提交，请再次点击刚才的操作。");
    this.name = "CreativeSessionSynchronizedError";
  }
}

type AgentFailureBody = { error?: string; issues?: Array<{ messageZh?: string; suggestionZh?: string }>; returnedDraft?: string; validationIssues?: string[] };
type TextReasoningEffort = "low" | "medium" | "high";

function workflowRequestError(body: AgentFailureBody, fallback: string): WorkflowRequestError {
  const suggestions = (body.issues || []).map((issue) => issue.suggestionZh?.trim()).filter(Boolean);
  const validationIssues = Array.isArray(body.validationIssues) ? body.validationIssues.map(String).filter(Boolean) : (body.issues || []).map((issue) => issue.messageZh?.trim()).filter((value): value is string => Boolean(value));
  const summary = [body.error || fallback, suggestions.length > 0 ? `修改建议：${suggestions.join("；")}` : ""].filter(Boolean).join(" ");
  return new WorkflowRequestError(summary, typeof body.returnedDraft === "string" ? body.returnedDraft : "", validationIssues);
}
type CreativeSessionState = {
  step: SetupStep;
  projectName: string;
  creationSource: CreationSource;
  workType: WorkType;
  creativeDirection: CreativeDirection;
  novelText: string;
  novelName: string;
  duration: string;
  customDurationSec: string;
  episodeCountMode: "agent" | "fixed";
  episodeCount: string;
  ratio: string;
  generationPreset: GenerationPresetSnapshot;
  generationPresetHistory: GenerationPresetSnapshot[];
  language: string;
  emotion: string;
  customEmotion: string;
  emotionRecommendations: ToneOption[];
  emotionRecommendationContext: string;
  emotionRecommendationError: string;
  activeStage: string;
  ideaText: string;
  ideaAnswers: IdeaAnswer[];
  ideaAnswer: string;
  ideaQuestion: string;
  ideaOptions: IdeaDirectionOption[];
  ideaError: string;
  agentTranscript: AgentTranscriptEntry[];
  managerTranscript: ManagerTranscriptEntry[];
  managerMemory: ProjectManagerMemory;
  ideaScript: IdeaScript | null;
  seriesMotherScript?: IdeaScript | null;
  episodeScripts: EpisodeScriptRecord[];
  scriptApproval: ScriptApproval;
  scriptRevisionText: string;
  characterStatus: CharacterStageStatus;
  characterLibraryHistory?: any[]; characterRosterVersion?: number;
  characterProfiles: CharacterProfile[];
  characterAssetProfileKeys: string[];
  characterError: string;
  characterApproval: ScriptApproval;
  selectedStyleId: string;
  characterImageStatus: CharacterImageStatus;
  characterImages: CharacterImageResult[];
  characterImagePrompts: CharacterImagePrompt[];
  characterAssetsApproval: ScriptApproval;
  characterTurnarounds: CharacterTurnaroundResult[];
  characterImageError: string;
  sceneStatus: SceneStageStatus;
  sceneProposals: SceneVisualProposal[];
  sceneError: string;
  sceneRejectedDraft: string;
  sceneRejectedIssues: string[];
  sceneProposalApproval: ScriptApproval;
  sceneImageStatus: SceneStageStatus;
  sceneImagePrompts: SceneImagePrompt[];
  sceneImages: SceneImageResult[];
  sceneImageError: string;
  sceneMainApproval: ScriptApproval;
  sceneViews: SceneViewResult[];
  sceneAssetsApproval: ScriptApproval;
  sceneAssetsSkipped: boolean;
  propStatus: SceneStageStatus;
  propProposals: PropVisualProposal[];
  propError: string;
  propRejectedDraft: string;
  propRejectedIssues: string[];
  propProposalApproval: ScriptApproval;
  propImageStatus: SceneStageStatus;
  propImagePrompts: PropImagePrompt[];
  propImages: PropImageResult[];
  propImageError: string;
  propAssetsApproval: ScriptApproval;
  storyboardSegmentDurationSec: number;
  storyboardBoardPanelCount: StoryboardBoardPanelCount;
  storyboardStatus: SceneStageStatus;
  storyboardSegments: StoryboardSegment[];
  storyboardWarnings: string[];
  storyboardError: string;
  storyboardRejectedDraft?: string;
  storyboardRejectedIssues?: string[];
  productionAppliedJobs?: Record<string, number>;
  storyboardApproval: ScriptApproval;
  storyboardBoardStatus: SceneStageStatus;
  storyboardBoardPlans: StoryboardBoardPlan[];
  storyboardBoardPrompts: StoryboardBoardPrompt[];
  storyboardBoards: StoryboardBoardResult[];
  storyboardBoardError: string;
  storyboardBoardRejectedDraft: string;
  storyboardBoardRejectedIssues: string[];
  storyboardAssetsApproval: ScriptApproval;
  videoPromptStatus: SceneStageStatus;
  videoPrompts: VideoPromptResult[];
  videoPromptError: string;
  videoPromptsApproval: ScriptApproval;
  h3GenerationSettings: H3GenerationSettings;
  shotVideoTasks: ShotVideoTask[];
  shotContinuityModes: Record<string, ShotContinuityMode>;
  shotVideosApproval: ScriptApproval;
  postProduction: PostProductionState;
  canvasView: CanvasView;
  canvasMode: CanvasMode;
  freeCanvas: FreeCanvasState;
  editor: EditorState;
};

type CreativeSessionEnvelope = {
  schemaVersion: 2;
  id: string;
  revision: number;
  updatedAt: string;
  state: CreativeSessionState;
  workflow: WorkflowSnapshot;
};

const defaultCanvasView = (): CanvasView => ({
  x: 0,
  y: 0,
  zoom: 0.65,
  nodes: {},
});

function normalizeCanvasView(value?: Partial<CanvasView>): CanvasView {
  const defaults = defaultCanvasView();
  return {
    x: Number.isFinite(value?.x) ? Number(value?.x) : defaults.x,
    y: Number.isFinite(value?.y) ? Number(value?.y) : defaults.y,
    zoom: Math.max(0.2, Math.min(1.8, Number(value?.zoom) || defaults.zoom)),
    nodes: {},
  };
}

const providerDefinitions: Array<{
  kind: ProviderKind;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  needsKey: boolean;
}> = [
  { kind: "agent", name: "文字 Agent", description: "拆集、剧本、人物与提示词", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "", needsKey: true },
  { kind: "image", name: "图片生成", description: "人物、场景与道具主资产", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-image-2", needsKey: true },
  { kind: "image-edit", name: "参考图编辑", description: "三视图、多视角与故事板", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-image-2", needsKey: true },
  { kind: "music", name: "在线音乐", description: "可选的在线配乐生成服务", defaultBaseUrl: "https://api.minimaxi.com/v1", defaultModel: "music-3.0", needsKey: true },
  { kind: "h3", name: "PRISM H3", description: "本机视频生成后端，无需Key", defaultBaseUrl: "http://127.0.0.1:8188", defaultModel: "", needsKey: false },
  { kind: "minimax-video", name: "MiniMax 视频", description: "海螺在线视频生成", defaultBaseUrl: "https://api.minimaxi.com/v1", defaultModel: "MiniMax-Hailuo-2.3", needsKey: true },
  { kind: "seedance-video", name: "Seedance 视频", description: "火山方舟视频生成", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "", needsKey: true },
];

type ProviderPreset = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  model?: string;
  protocol?: TextProviderProtocol;
};

const providerPresets: Record<ProviderKind, ProviderPreset[]> = {
  'minimax-video': [{ id: 'minimax-video', name: 'MiniMax 官方', description: '海螺 2.3 视频', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-Hailuo-2.3' }],
  'seedance-video': [{ id: 'seedance-video', name: '火山方舟', description: '填写已开通的 Seedance 模型 ID 或推理接入点 ID', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }],
  agent: [
    { id: "openai", name: "OpenAI 官方", description: "Responses 协议", baseUrl: "https://api.openai.com/v1", protocol: "responses" },
    { id: "deepseek", name: "DeepSeek 官方", description: "Chat Completions", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", protocol: "chat-completions" },
    { id: "kimi", name: "Kimi 官方", description: "Chat Completions", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", protocol: "chat-completions" },
    { id: "glm", name: "智谱 GLM 官方", description: "Chat Completions", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3", protocol: "chat-completions" },
    { id: "claude", name: "Claude 官方", description: "Anthropic Messages", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6", protocol: "anthropic-messages" },
  ],
  image: [
    { id: "openai", name: "OpenAI 官方", description: "官方图片生成服务", baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
    { id: "apiyi", name: "API易", description: "自动填写兼容地址与模型", baseUrl: "https://api.apiyi.com/v1", model: "gpt-image-2" },
    { id: "volcengine-seedream", name: "火山方舟", description: "Seedream 官方图片生成", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-5-0-pro-260628" },
  ],
  "image-edit": [
    { id: "openai", name: "OpenAI 官方", description: "官方参考图编辑服务", baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
    { id: "apiyi", name: "API易", description: "支持多张参考图的编辑通道", baseUrl: "https://api.apiyi.com/v1", model: "gpt-image-2-all" },
    { id: "volcengine-seedream", name: "火山方舟", description: "Seedream 单图与多参考图", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-5-0-pro-260628" },
  ],
  music: [
    { id: "minimax", name: "MiniMax 官方", description: "Music 3 在线音乐服务", baseUrl: "https://api.minimaxi.com/v1", model: "music-3.0" },
  ],
  h3: [
    { id: "local", name: "本机 PRISM H3", description: "自动连接本机视频后端", baseUrl: "http://127.0.0.1:8188" },
  ],
};

function matchesProviderPreset(draft: { baseUrl: string; model: string; protocol: TextProviderProtocol; capabilities?: TextCapabilities }, preset: ProviderPreset) {
  const normalizedDraftUrl = draft.baseUrl.trim().replace(/\/$/u, "");
  const normalizedPresetUrl = preset.baseUrl.replace(/\/$/u, "");
  return normalizedDraftUrl === normalizedPresetUrl
    && (!preset.model || draft.model.trim() === preset.model)
    && (!preset.protocol || draft.protocol === preset.protocol);
}

function normalizeEpisodeScriptRecords(value: unknown, fallbackScript: IdeaScript | null, fallbackApproval: ScriptApproval): EpisodeScriptRecord[] {
  const records = Array.isArray(value) ? value.flatMap((candidate): EpisodeScriptRecord[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Partial<EpisodeScriptRecord>;
    const episodeNumber = Math.floor(Number(item.episodeNumber));
    if (episodeNumber < 1 || episodeNumber > 30) return [];
    const status = ["idle", "running", "complete", "failed"].includes(item.status || "") ? item.status! : item.script ? "complete" : "idle";
    return [{
      scriptKey: `EP${String(episodeNumber).padStart(3, "0")}`,
      episodeNumber,
      version: Math.max(0, Math.floor(Number(item.version) || (item.script ? 1 : 0))),
      status: status === "running" ? "failed" : status,
      approval: item.approval === "approved" ? "approved" : "draft",
      script: item.script ? sanitizeIdeaScriptCharacters(item.script) : item.script,
      error: status === "running" ? "上次分集剧本请求因页面关闭而中断；旧版本仍保留，系统没有自动重试。" : item.error,
    }];
  }) : [];
  if (fallbackScript?.workType === "series" && !records.some((item) => item.episodeNumber === (fallbackScript.episodeNumber || 1))) {
    const episodeNumber = fallbackScript.episodeNumber || 1;
    records.push({ scriptKey: `EP${String(episodeNumber).padStart(3, "0")}`, episodeNumber, version: 1, status: "complete", approval: fallbackApproval === "approved" ? "approved" : "draft", script: fallbackScript });
  }
  return records.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

function sanitizeIdeaScriptCharacters(script: IdeaScript): IdeaScript {
  const seen = new Set<string>();
  return {
    ...script,
    characters: (Array.isArray(script.characters) ? script.characters : []).filter((character) => {
      const name = character?.name?.trim();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    }),
  };
}

function emptyCreativeState(defaults: AppCreativeDefaults = defaultAppCreativeDefaults()): CreativeSessionState {
  const generationPreset = normalizeGenerationPreset(undefined, { styleId: DEFAULT_GENERATION_STYLE_ID, aspectRatio: '16:9' });
  return {
    step: "start", projectName: "", creationSource: "novel", workType: "single", creativeDirection: "story", novelText: "", novelName: "",
    duration: "60秒", customDurationSec: "120", episodeCountMode: "agent", episodeCount: "8", ratio: "16:9", generationPreset, generationPresetHistory: [generationPreset], language: "中文",
    emotion: "悲壮", customEmotion: "", emotionRecommendations: [], emotionRecommendationContext: "", emotionRecommendationError: "", activeStage: "总览", ideaText: "", ideaAnswers: [], ideaAnswer: "", ideaQuestion: "", ideaOptions: [], ideaError: "", agentTranscript: [], managerTranscript: [], managerMemory: { explicitPreferences: [] }, ideaScript: null, episodeScripts: [], scriptApproval: "draft", scriptRevisionText: "", characterStatus: "idle", characterProfiles: [], characterAssetProfileKeys: [], characterError: "", characterApproval: "draft", selectedStyleId: DEFAULT_GENERATION_STYLE_ID, characterImageStatus: "idle", characterImages: [], characterImagePrompts: [], characterAssetsApproval: "draft", characterTurnarounds: [], characterImageError: "", sceneStatus: "idle", sceneProposals: [], sceneError: "", sceneRejectedDraft: "", sceneRejectedIssues: [], sceneProposalApproval: "draft", sceneImageStatus: "idle", sceneImagePrompts: [], sceneImages: [], sceneImageError: "", sceneMainApproval: "draft", sceneViews: [], sceneAssetsApproval: "draft", sceneAssetsSkipped: false, propStatus: "idle", propProposals: [], propError: "", propRejectedDraft: "", propRejectedIssues: [], propProposalApproval: "draft", propImageStatus: "idle", propImagePrompts: [], propImages: [], propImageError: "", propAssetsApproval: "draft", storyboardSegmentDurationSec: defaults.storyboardSegmentDurationSec, storyboardBoardPanelCount: defaults.storyboardBoardPanelCount, storyboardStatus: "idle", storyboardSegments: [], storyboardWarnings: [], storyboardError: "", storyboardApproval: "draft", storyboardBoardStatus: "idle", storyboardBoardPlans: [], storyboardBoardPrompts: [], storyboardBoards: [], storyboardBoardError: "", storyboardBoardRejectedDraft: "", storyboardBoardRejectedIssues: [], storyboardAssetsApproval: "draft", videoPromptStatus: "idle", videoPrompts: [], videoPromptError: "", videoPromptsApproval: "draft", h3GenerationSettings: defaultH3GenerationSettings(defaults), shotVideoTasks: [], shotContinuityModes: {}, shotVideosApproval: "draft", postProduction: defaultPostProductionState(defaults), canvasView: defaultCanvasView(), canvasMode: "director", freeCanvas: defaultFreeCanvasState(), editor: defaultEditorState(),
  };
}

function createTranscriptEntry(entry: Omit<AgentTranscriptEntry, "id" | "createdAt">): AgentTranscriptEntry {
  return {
    ...entry,
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };
}

function createManagerTranscriptEntry(entry: Omit<ManagerTranscriptEntry, "id" | "createdAt">): ManagerTranscriptEntry {
  return {
    ...entry,
    id: `manager-turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };
}

function restoreManagerCommandTargets(entries: ManagerTranscriptEntry[]): ManagerTranscriptEntry[] {
  return entries.map((entry) => {
    const commands = entry.turn ? restoreProjectManagerCommands(entry.turn, entry.commands || []) : entry.commands || [];
    return {
      ...entry,
      commands: commands.map((command) => command.kind !== "navigate" || command.targetArtifact ? command : {
      ...command,
      targetArtifact: projectManagerNavigationTarget(command.stageId, entry.turn?.targetArtifacts || []),
      }),
    };
  });
}

function compactTranscriptOptions(entries: AgentTranscriptEntry[]): AgentTranscriptEntry[] {
  return entries.map((entry, index) => {
    if (entry.kind !== "question" || !entry.options?.length) return entry;
    const answer = entries[index + 1];
    const selectedIds = answer?.kind === "answer" ? answer.selectedOptionIds || (answer.selectedOptionId ? [answer.selectedOptionId] : []) : [];
    const options = entry.options.filter((option) => selectedIds.includes(option.id));
    return { ...entry, options: options.length ? options : undefined };
  });
}

function transcriptFromSavedState(saved: CreativeSessionState): AgentTranscriptEntry[] {
  const entries: AgentTranscriptEntry[] = Array.isArray(saved.agentTranscript) ? [...saved.agentTranscript] : [];
  const preferredSource = saved.creationSource === "idea" ? saved.ideaText : saved.novelText;
  const fallbackSource = saved.creationSource === "idea" ? saved.novelText : saved.ideaText;
  const sourceText = preferredSource?.trim() ? preferredSource : fallbackSource;
  if (sourceText?.trim() && !["start", "idea", "novel"].includes(saved.step) && !entries.some((entry) => entry.kind === "source")) {
    entries.unshift(createTranscriptEntry({ role: "user", kind: "source", text: sourceText }));
  }
  (saved.ideaAnswers || []).forEach((answer) => {
    if (!entries.some((entry) => entry.kind === "question" && entry.text === answer.question)) entries.push(createTranscriptEntry({ role: "assistant", kind: "question", text: answer.question }));
    if (!entries.some((entry) => entry.kind === "answer" && entry.text === answer.answer)) entries.push(createTranscriptEntry({ role: "user", kind: "answer", text: answer.answer }));
  });
  (saved.postProduction?.notes || []).forEach((message) => {
    if (!entries.some((entry) => entry.kind === "message" && entry.text === message)) entries.push(createTranscriptEntry({ role: "user", kind: "message", text: message }));
  });
  if (saved.storyboardStatus === "failed" && saved.storyboardError?.trim()) {
    const durationSec = [5, 10, 15].includes(saved.storyboardSegmentDurationSec) ? saved.storyboardSegmentDurationSec : 15;
    const actionText = `提交文字分镜：每段 ${durationSec} 秒`;
    const eventText = `文字分镜没有完成：${saved.storyboardError}`;
    if (!entries.some((entry) => entry.kind === "action" && entry.text === actionText)) entries.push(createTranscriptEntry({ role: "user", kind: "action", text: actionText }));
    if (!entries.some((entry) => entry.kind === "event" && entry.text === eventText)) entries.push(createTranscriptEntry({ role: "assistant", kind: "event", text: eventText }));
  }
  return compactTranscriptOptions(entries);
}

export function App() {
  const [step, setStep] = useState<SetupStep>("start");
  const [projectName, setProjectName] = useState("");
  const [creationSource, setCreationSource] = useState<CreationSource>("novel");
  const [workType, setWorkType] = useState<WorkType>("single");
  const [creativeDirection, setCreativeDirection] = useState<CreativeDirection>("story");
  const [novelText, setNovelText] = useState("");
  const [novelName, setNovelName] = useState("");
  const [duration, setDuration] = useState("60秒");
  const [customDurationSec, setCustomDurationSec] = useState("120");
  const [episodeCountMode, setEpisodeCountMode] = useState<"agent" | "fixed">("agent");
  const [episodeCount, setEpisodeCount] = useState("8");
  const [ratio, setRatio] = useState("16:9");
  const [generationPreset, setGenerationPreset] = useState<GenerationPresetSnapshot>(() => normalizeGenerationPreset(undefined, { styleId: DEFAULT_GENERATION_STYLE_ID, aspectRatio: '16:9' }));
  const [generationPresetHistory, setGenerationPresetHistory] = useState<GenerationPresetSnapshot[]>(() => [generationPreset]);
  const [language, setLanguage] = useState("中文");
  const [emotion, setEmotion] = useState("悲壮");
  const [customEmotion, setCustomEmotion] = useState("");
  const [emotionRecommendations, setEmotionRecommendations] = useState<ToneOption[]>([]);
  const [emotionRecommendationContext, setEmotionRecommendationContext] = useState("");
  const [emotionRecommendationBusy, setEmotionRecommendationBusy] = useState(false);
  const [emotionRecommendationError, setEmotionRecommendationError] = useState("");
  const [activeStage, setActiveStage] = useState("总览");
  const [stageNavigationRequest, setStageNavigationRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ProviderPublicStatus[]>([]);
  const [providerSwitchError, setProviderSwitchError] = useState("");
  const [ideaText, setIdeaText] = useState("");
  const [ideaAnswers, setIdeaAnswers] = useState<IdeaAnswer[]>([]);
  const [ideaAnswer, setIdeaAnswer] = useState("");
  const [ideaQuestion, setIdeaQuestion] = useState("");
  const [ideaOptions, setIdeaOptions] = useState<IdeaDirectionOption[]>([]);
  const [agentTranscript, setAgentTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [managerTranscript, setManagerTranscript] = useState<ManagerTranscriptEntry[]>([]);
  const managerTranscriptRef = useRef<ManagerTranscriptEntry[]>([]);
  const [managerMemory, setManagerMemory] = useState<ProjectManagerMemory>({ explicitPreferences: [] });
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [ideaScript, setIdeaScript] = useState<IdeaScript | null>(null);
  const [seriesMotherScript, setSeriesMotherScript] = useState<IdeaScript | null>(null);
  const [episodeScripts, setEpisodeScripts] = useState<EpisodeScriptRecord[]>([]);
  const [scriptApproval, setScriptApproval] = useState<ScriptApproval>("draft");
  const [scriptRevisionText, setScriptRevisionText] = useState("");
  const [scriptRevisionOpen, setScriptRevisionOpen] = useState(false);
  const [scriptRevisionBusy, setScriptRevisionBusy] = useState(false);
  const [scriptRevisionError, setScriptRevisionError] = useState("");
  const [characterStatus, setCharacterStatus] = useState<CharacterStageStatus>("idle");
  const [characterProfiles, setCharacterProfiles] = useState<CharacterProfile[]>([]);
  const [characterAssetProfileKeys, setCharacterAssetProfileKeys] = useState<string[]>([]);
  const [characterError, setCharacterError] = useState("");
  const [characterApproval, setCharacterApproval] = useState<ScriptApproval>("draft");
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState(DEFAULT_GENERATION_STYLE_ID);
  const [characterImageStatus, setCharacterImageStatus] = useState<CharacterImageStatus>("idle");
  const [characterImages, setCharacterImages] = useState<CharacterImageResult[]>([]);
  const [characterImagePrompts, setCharacterImagePrompts] = useState<CharacterImagePrompt[]>([]);
  const [characterImageRequestKeys, setCharacterImageRequestKeys] = useState<string[]>([]);
  const characterImageRequestKeysRef = useRef<Set<string>>(new Set());
  const characterImageFailureMessagesRef = useRef<Map<string, string>>(new Map());
  const characterImageAdviceRef = useRef("");
  const [characterAssetsApproval, setCharacterAssetsApproval] = useState<ScriptApproval>("draft");
  const [characterTurnarounds, setCharacterTurnarounds] = useState<CharacterTurnaroundResult[]>([]);
  const [characterImageError, setCharacterImageError] = useState("");
  const [sceneStatus, setSceneStatus] = useState<SceneStageStatus>("idle");
  const [sceneProposals, setSceneProposals] = useState<SceneVisualProposal[]>([]);
  const [sceneError, setSceneError] = useState("");
  const [sceneRejectedDraft, setSceneRejectedDraft] = useState("");
  const [sceneRejectedIssues, setSceneRejectedIssues] = useState<string[]>([]);
  const [sceneProposalApproval, setSceneProposalApproval] = useState<ScriptApproval>("draft");
  const [sceneImageStatus, setSceneImageStatus] = useState<SceneStageStatus>("idle");
  const [sceneImagePrompts, setSceneImagePrompts] = useState<SceneImagePrompt[]>([]);
  const [sceneImages, setSceneImages] = useState<SceneImageResult[]>([]);
  const [sceneImageRequestKeys, setSceneImageRequestKeys] = useState<string[]>([]);
  const sceneImageRequestKeysRef = useRef<Set<string>>(new Set());
  const sceneImageFailureMessagesRef = useRef<Map<string, string>>(new Map());
  const sceneImageAdviceRef = useRef("");
  const [sceneImageError, setSceneImageError] = useState("");
  const [sceneMainApproval, setSceneMainApproval] = useState<ScriptApproval>("draft");
  const [sceneViews, setSceneViews] = useState<SceneViewResult[]>([]);
  const [sceneAssetsApproval, setSceneAssetsApproval] = useState<ScriptApproval>("draft");
  const [sceneAssetsSkipped, setSceneAssetsSkipped] = useState(false);
  const [propStatus, setPropStatus] = useState<SceneStageStatus>("idle");
  const [propProposals, setPropProposals] = useState<PropVisualProposal[]>([]);
  const [propError, setPropError] = useState("");
  const [propRejectedDraft, setPropRejectedDraft] = useState("");
  const [propRejectedIssues, setPropRejectedIssues] = useState<string[]>([]);
  const [propProposalApproval, setPropProposalApproval] = useState<ScriptApproval>("draft");
  const [propImageStatus, setPropImageStatus] = useState<SceneStageStatus>("idle");
  const [propImagePrompts, setPropImagePrompts] = useState<PropImagePrompt[]>([]);
  const [propImages, setPropImages] = useState<PropImageResult[]>([]);
  const [propImageRequestKeys, setPropImageRequestKeys] = useState<string[]>([]);
  const propImageRequestKeysRef = useRef<Set<string>>(new Set());
  const propImageFailureMessagesRef = useRef<Map<string, string>>(new Map());
  const propImageAdviceRef = useRef("");
  const [propImageError, setPropImageError] = useState("");
  const [propAssetsApproval, setPropAssetsApproval] = useState<ScriptApproval>("draft");
  const [storyboardSegmentDurationSec, setStoryboardSegmentDurationSec] = useState(15);
  const [storyboardBoardPanelCount, setStoryboardBoardPanelCount] = useState<StoryboardBoardPanelCount>(3);
  const [storyboardStatus, setStoryboardStatus] = useState<SceneStageStatus>("idle");
  const [storyboardSegments, setStoryboardSegments] = useState<StoryboardSegment[]>([]);
  const [storyboardWarnings, setStoryboardWarnings] = useState<string[]>([]);
  const [storyboardError, setStoryboardError] = useState("");
  const [storyboardApproval, setStoryboardApproval] = useState<ScriptApproval>("draft");
  const [storyboardBoardStatus, setStoryboardBoardStatus] = useState<SceneStageStatus>("idle");
  const [storyboardBoardPlans, setStoryboardBoardPlans] = useState<StoryboardBoardPlan[]>([]);
  const [storyboardBoardPrompts, setStoryboardBoardPrompts] = useState<StoryboardBoardPrompt[]>([]);
  const [storyboardBoards, setStoryboardBoards] = useState<StoryboardBoardResult[]>([]);
  const storyboardBoardsRef = useRef<StoryboardBoardResult[]>([]);
  const [storyboardBoardRequestKeys, setStoryboardBoardRequestKeys] = useState<string[]>([]);
  const storyboardBoardRequestKeysRef = useRef<Set<string>>(new Set());
  const storyboardBoardActiveKeysRef = useRef<Set<string>>(new Set());
  const storyboardBoardQueueRef = useRef<StoryboardBoardGenerationJob[]>([]);
  const storyboardBoardFailureMessagesRef = useRef<Map<string, string>>(new Map());
  const storyboardBoardAdviceRef = useRef("");
  const [storyboardBoardError, setStoryboardBoardError] = useState("");
  const [storyboardBoardRejectedDraft, setStoryboardBoardRejectedDraft] = useState("");
  const [storyboardBoardRejectedIssues, setStoryboardBoardRejectedIssues] = useState<string[]>([]);
  const [storyboardAssetsApproval, setStoryboardAssetsApproval] = useState<ScriptApproval>("draft");
  const [videoPromptStatus, setVideoPromptStatus] = useState<SceneStageStatus>("idle");
  const [videoPrompts, setVideoPrompts] = useState<VideoPromptResult[]>([]);
  const [videoPromptError, setVideoPromptError] = useState("");
  const [videoPromptsApproval, setVideoPromptsApproval] = useState<ScriptApproval>("draft");
  const [directVideoBusy, setDirectVideoBusy] = useState(false);
  const [directVideoError, setDirectVideoError] = useState("");
  const [h3Connection, setH3Connection] = useState<H3Connection>({ status: "idle" });
  const h3ConnectInFlight = useRef(false);
  const [h3GenerationSettings, setH3GenerationSettings] = useState<H3GenerationSettings>(defaultH3GenerationSettings);
  const [shotVideoTasks, setShotVideoTasks] = useState<ShotVideoTask[]>([]);
  const [shotContinuityModes, setShotContinuityModes] = useState<Record<string, ShotContinuityMode>>({});
  const [shotVideosApproval, setShotVideosApproval] = useState<ScriptApproval>("draft");
  const [postProduction, setPostProduction] = useState<PostProductionState>(defaultPostProductionState);
  const [localMusicConnection, setLocalMusicConnection] = useState<LocalMusicConnection>({ status: "idle" });
  const shotVideoPollInFlight = useRef(false);
  const freeCanvasVideoPollInFlight = useRef(false);
  const shotVideoTasksRef = useRef<ShotVideoTask[]>([]);
  const shotVideoDependencyDispatchKeys = useRef<Set<string>>(new Set());
  const shotVideoBatchKeys = useRef<Set<string>>(new Set());
  const sessionSaveSequence = useRef(0);
  const sessionSaveEpoch = useRef(0);
  const sessionRevision = useRef(0);
  const [activeProjectId, setActiveProjectId] = useState("");
  const activeProjectIdRef = useRef("");
  const productionAppliedJobsRef = useRef<Record<string, number>>({});
  const productionStateRef = useRef<CreativeSessionState | null>(null);
  const [storyboardRejectedDraft, setStoryboardRejectedDraft] = useState("");
  const [storyboardRejectedIssues, setStoryboardRejectedIssues] = useState<string[]>([]);
  const sessionSaveChain = useRef<Promise<void>>(Promise.resolve());
  const appCreativeDefaultsRef = useRef<AppCreativeDefaults>(defaultAppCreativeDefaults());
  const [workflowSnapshot, setWorkflowSnapshot] = useState<WorkflowSnapshot>(() => createEmptyWorkflowSnapshot());
  const [shotVideoBatchSubmitting, setShotVideoBatchSubmitting] = useState(false);
  const [videoPromptEditorKey, setVideoPromptEditorKey] = useState("");
  const [videoPromptEditorText, setVideoPromptEditorText] = useState("");
  const videoPromptEditorKeyRef = useRef("");
  const videoPromptRepairInFlight = useRef(false);
  const [storyboardPromptEditorKey, setStoryboardPromptEditorKey] = useState("");
  const [storyboardPromptEditorText, setStoryboardPromptEditorText] = useState("");
  const [storyboardTextEditorKey, setStoryboardTextEditorKey] = useState("");
  const [storyboardTextEditorText, setStoryboardTextEditorText] = useState("");
  const [propPromptEditorKey, setPropPromptEditorKey] = useState("");
  const [propPromptEditorText, setPropPromptEditorText] = useState("");
  const [scenePromptEditorKey, setScenePromptEditorKey] = useState("");
  const [scenePromptEditorText, setScenePromptEditorText] = useState("");
  const [imageViewer, setImageViewer] = useState<{ src: string; title: string } | null>(null);
  const [characterProfileEditor, setCharacterProfileEditor] = useState<CharacterProfile | null>(null);
  const [promptEditorKey, setPromptEditorKey] = useState("");
  const [promptEditorText, setPromptEditorText] = useState("");
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState("");
  const [novelBusy, setNovelBusy] = useState(false);
  const [novelError, setNovelError] = useState("");
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [sessionSaveReady, setSessionSaveReady] = useState(false);
  const [sessionSaveStatus, setSessionSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [scriptDetailsOpen, setScriptDetailsOpen] = useState(false);
  const [seriesPlanOpen, setSeriesPlanOpen] = useState(false);
  const [episodeOpening, setEpisodeOpening] = useState(false);
  const [episodeProductionError, setEpisodeProductionError] = useState("");
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(null);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [projectManagerBusy, setProjectManagerBusy] = useState(false);
  const [projectManagerError, setProjectManagerError] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false);
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<string | undefined>();
  const [characterRosterBusy, setCharacterRosterBusy] = useState(false);
  const [characterRosterError, setCharacterRosterError] = useState("");
  const characterRosterBusyRef = useRef(false);
  const characterLibraryHistoryRef = useRef<any[]>([]);
  const characterRosterVersionRef = useRef<number | undefined>(undefined);
  const characterReconciledRef = useRef("");
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetLibraryRefresh, setAssetLibraryRefresh] = useState(0);
  const [canvasView, setCanvasView] = useState<CanvasView>(defaultCanvasView);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("director");
  const [freeCanvas, setFreeCanvas] = useState<FreeCanvasState>(defaultFreeCanvasState);
  const freeCanvasStateRef = useRef(freeCanvas);
  freeCanvasStateRef.current = freeCanvas;
  const canvasProjectTransitionRef = useRef(false);
  const changeProjectCanvas = useMemo<React.Dispatch<React.SetStateAction<FreeCanvasState>>>(() => (update) => {
    if (activeProjectIdRef.current !== activeProjectId) return;
    const current = freeCanvasStateRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    freeCanvasStateRef.current = next;
    setFreeCanvas(next);
  }, [activeProjectId]);
  function assertCanvasProjectReady() {
    if (canvasProjectTransitionRef.current) throw new Error('项目正在切换，请在项目打开后再执行任务。');
  }

  const [editor, setEditor] = useState<EditorState>(defaultEditorState);

  function updateShotVideoTasks(updater: (current: ShotVideoTask[]) => ShotVideoTask[]) {
    const next = updater(shotVideoTasksRef.current);
    shotVideoTasksRef.current = next;
    setShotVideoTasks(next);
    return next;
  }

  function updateStoryboardBoards(updater: (current: StoryboardBoardResult[]) => StoryboardBoardResult[]) {
    const next = updater(storyboardBoardsRef.current);
    const changed = changedStoryboardImageKeys(storyboardBoardsRef.current, next);
    if (changed.size) {
      setVideoPrompts(current => current.map(item => changed.has(item.segmentKey) ? { ...item, stale: true, status: "stale", approval: "draft" } : item));
      setVideoPromptsApproval("draft");
      updateShotVideoTasks(current => current.map(item => changed.has(item.segmentKey) ? { ...item, stale: true, approval: "draft" } : item));
      setShotVideosApproval("draft");
    }
    storyboardBoardsRef.current = next;
    setStoryboardBoards(next);
    return next;
  }

  function applyCreativeState(saved: CreativeSessionState) {
    storyboardBoardQueueRef.current = [];
    storyboardBoardRequestKeysRef.current.clear();
    storyboardBoardActiveKeysRef.current.clear();
    storyboardBoardFailureMessagesRef.current.clear();
    storyboardBoardAdviceRef.current = "";
    setStoryboardBoardRequestKeys([]);
    const restoredPreset = normalizeGenerationPreset(saved.generationPreset, { styleId: saved.selectedStyleId, aspectRatio: saved.ratio });
    const restoredPresetHistory = (Array.isArray(saved.generationPresetHistory) ? saved.generationPresetHistory : [])
      .map((item) => normalizeGenerationPreset(item, restoredPreset))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.version === item.version) === index);
    if (!restoredPresetHistory.some((item) => item.version === restoredPreset.version)) restoredPresetHistory.push(restoredPreset);
    setStep(saved.step);
    setProjectName(saved.projectName?.trim() || saved.ideaScript?.title?.trim() || saved.novelName?.replace(/\.(txt|md)$/i, "").trim() || saved.ideaText?.trim().slice(0, 24) || "新作品项目");
    setCreationSource(saved.creationSource || (saved.step.startsWith("idea") ? "idea" : "novel"));
    setWorkType(saved.workType || "single");
    setCreativeDirection(creativeDirectionIds.includes(saved.creativeDirection) ? saved.creativeDirection : "story");
    setNovelText(saved.novelText);
    setNovelName(saved.novelName);
    setDuration(saved.duration || "60秒");
    setCustomDurationSec(saved.customDurationSec || "120");
    setEpisodeCountMode(saved.episodeCountMode || "agent");
    setEpisodeCount(saved.episodeCount || "8");
    setRatio(saved.ratio || "16:9");
    setGenerationPreset(restoredPreset);
    setGenerationPresetHistory(restoredPresetHistory.sort((a, b) => a.version - b.version));
    setLanguage(saved.language || "中文");
    setEmotion(saved.emotion || "悲壮");
    setCustomEmotion(saved.customEmotion);
    setEmotionRecommendations(Array.isArray(saved.emotionRecommendations) ? saved.emotionRecommendations : []);
    setEmotionRecommendationContext(saved.emotionRecommendationContext || "");
    setEmotionRecommendationError(saved.emotionRecommendationError || "");
    setEmotionRecommendationBusy(false);
    setActiveStage(stageItems.includes(saved.activeStage) ? saved.activeStage : saved.storyboardAssetsApproval === "approved" ? "视频" : "总览");
    setIdeaText(saved.ideaText);
    setIdeaAnswers(saved.ideaAnswers);
    setIdeaAnswer(saved.ideaAnswer);
    const repeatedQuestion = saved.ideaQuestion && saved.ideaAnswers.some((item) => questionFingerprint(item.question) === questionFingerprint(saved.ideaQuestion));
    setIdeaQuestion(repeatedQuestion ? "" : saved.ideaQuestion);
    setIdeaOptions(repeatedQuestion ? [] : saved.ideaOptions);
    setAgentTranscript(transcriptFromSavedState(saved));
    const restoredManagerTranscript = Array.isArray(saved.managerTranscript) ? restoreManagerCommandTargets(saved.managerTranscript) : [];
    managerTranscriptRef.current = restoredManagerTranscript;
    setManagerTranscript(restoredManagerTranscript);
    setManagerMemory(saved.managerMemory?.explicitPreferences ? saved.managerMemory : { explicitPreferences: [] });
    setManagerBusy(false);
    setManagerError("");
    setIdeaError(repeatedQuestion ? "编剧导演重复了已经回答的问题，系统已拦截。你可以直接生成剧本，或重新请求一个新的问题。" : saved.ideaError || "");
    const restoredIdeaScript = saved.ideaScript ? sanitizeIdeaScriptCharacters(saved.ideaScript) : null;
    setIdeaScript(restoredIdeaScript);
    setSeriesMotherScript(saved.seriesMotherScript || ((restoredIdeaScript?.episodeNumber || 1) > 1 ? saved.episodeScripts?.find(item => item.episodeNumber === 1)?.script : null) || null);
    setEpisodeScripts(normalizeEpisodeScriptRecords(saved.episodeScripts, restoredIdeaScript, saved.scriptApproval));
    setScriptApproval(saved.scriptApproval === "approved" ? "approved" : "draft");
    setScriptRevisionText(saved.scriptRevisionText || "");
    setScriptRevisionOpen(false);
    setScriptRevisionError("");
    characterLibraryHistoryRef.current = saved.characterLibraryHistory || [];
    characterRosterVersionRef.current = saved.characterRosterVersion;
    setCharacterLibraryOpen(false); setCharacterRosterError("");
    const restoredCharacterProfiles = Array.isArray(saved.characterProfiles) ? saved.characterProfiles : [];
    setCharacterProfiles(restoredCharacterProfiles);
    const restoredProfileKeys = new Set(restoredCharacterProfiles.map((profile) => profile.profileKey));
    const restoredCharacterImages = Array.isArray(saved.characterImages) ? saved.characterImages.filter((image) => restoredProfileKeys.has(image.profileKey)).map((image) => ({ ...image, generationPreset: image.generationPreset ? normalizeGenerationPreset(image.generationPreset, restoredPreset) : restoredPreset, error: localizeStoredImageError(image.error) })) : [];
    setCharacterAssetProfileKeys(restoredCharacterImages.filter((image) => image.status === "complete" && image.imageUrl && restoredProfileKeys.has(image.profileKey)).map((image) => image.profileKey));
    if (saved.characterStatus === "running") {
      setCharacterStatus("failed");
      setCharacterError("上次角色请求因页面关闭而中断，剧本仍已锁定；需要你手动重新提交。 ");
    } else {
      setCharacterStatus(["complete", "failed"].includes(saved.characterStatus) ? saved.characterStatus : "idle");
      setCharacterError(saved.characterError || "");
    }
    setCharacterApproval(saved.characterApproval === "approved" ? "approved" : "draft");
    setSelectedStyleId(restoredPreset.styleId);
    setCharacterImages(restoredCharacterImages);
    characterImageRequestKeysRef.current.clear();
    characterImageFailureMessagesRef.current = new Map(restoredCharacterImages.filter((image) => image.status === "failed").map((image) => [image.profileKey, image.error || "角色图生成没有完成。"]));
    characterImageAdviceRef.current = String(saved.characterImageError || "").startsWith("优化建议：") ? String(saved.characterImageError).slice("优化建议：".length) : "";
    setCharacterImageRequestKeys([]);
    setCharacterImagePrompts(Array.isArray(saved.characterImagePrompts) ? saved.characterImagePrompts.map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset, prompt: sanitizeProductionPrompt(item.prompt) })) : []);
    setCharacterAssetsApproval(saved.characterAssetsApproval === "approved" ? "approved" : "draft");
    setCharacterTurnarounds(Array.isArray(saved.characterTurnarounds) ? saved.characterTurnarounds.map((item) => item.status === "running" ? { ...item, status: "failed" as const, error: "上次三视图任务因页面关闭而中断，没有自动重试。" } : item) : []);
    if (saved.characterImageStatus === "running") {
      setCharacterImageStatus("failed");
      setCharacterImageError("上次角色图请求因页面关闭而中断；已有结果会保留，不会自动重试。 ");
    } else {
      setCharacterImageStatus(["complete", "failed"].includes(saved.characterImageStatus) ? saved.characterImageStatus : "idle");
      setCharacterImageError(localizeStoredImageError(saved.characterImageError) || "");
    }
    setSceneProposals(Array.isArray(saved.sceneProposals) ? saved.sceneProposals : []);
    setSceneRejectedDraft(typeof saved.sceneRejectedDraft === "string" ? saved.sceneRejectedDraft : "");
    setSceneRejectedIssues(Array.isArray(saved.sceneRejectedIssues) ? saved.sceneRejectedIssues.map(String) : []);
    setSceneProposalApproval(saved.sceneProposalApproval === "approved" ? "approved" : "draft");
    setSceneImagePrompts(Array.isArray(saved.sceneImagePrompts) ? saved.sceneImagePrompts.map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset })) : []);
    const restoredSceneImages = Array.isArray(saved.sceneImages) ? saved.sceneImages.map((image) => ({ ...image, generationPreset: image.generationPreset ? normalizeGenerationPreset(image.generationPreset, restoredPreset) : restoredPreset, error: localizeStoredImageError(image.error) })) : [];
    setSceneImages(restoredSceneImages);
    sceneImageRequestKeysRef.current.clear();
    sceneImageFailureMessagesRef.current = new Map(restoredSceneImages.filter((image) => image.status === "failed").map((image) => [image.sceneAssetKey, image.error || "场景图生成没有完成。"]))
    sceneImageAdviceRef.current = String(saved.sceneImageError || "").startsWith("优化建议：") ? String(saved.sceneImageError).slice("优化建议：".length) : "";
    setSceneImageRequestKeys([]);
    if (saved.sceneStatus === "running") {
      setSceneStatus("failed");
      setSceneError("上次场景视觉提案请求因页面关闭而中断，没有自动重试。");
    } else {
      setSceneStatus(["complete", "failed"].includes(saved.sceneStatus) ? saved.sceneStatus : "idle");
      setSceneError(saved.sceneError || "");
    }
    if (saved.sceneImageStatus === "running") {
      setSceneImageStatus("failed");
      setSceneImageError("上次场景图请求因页面关闭而中断；已有提示词和图片仍保留，没有自动重试。");
    } else {
      setSceneImageStatus(["complete", "failed"].includes(saved.sceneImageStatus) ? saved.sceneImageStatus : "idle");
      setSceneImageError(localizeStoredImageError(saved.sceneImageError) || "");
    }
    setSceneMainApproval(saved.sceneMainApproval === "approved" ? "approved" : "draft");
    setSceneViews(Array.isArray(saved.sceneViews) ? saved.sceneViews.map((item) => item.status === "running" ? { ...item, status: "failed" as const, error: "上次场景多角度任务因页面关闭而中断，没有自动重试。" } : item) : []);
    setSceneAssetsApproval(saved.sceneAssetsApproval === "approved" ? "approved" : "draft");
    setSceneAssetsSkipped(Boolean(saved.sceneAssetsSkipped));
    setPropProposals(Array.isArray(saved.propProposals) ? saved.propProposals : []);
    setPropRejectedDraft(typeof saved.propRejectedDraft === "string" ? saved.propRejectedDraft : "");
    setPropRejectedIssues(Array.isArray(saved.propRejectedIssues) ? saved.propRejectedIssues.map(String) : []);
    setPropProposalApproval(saved.propProposalApproval === "approved" ? "approved" : "draft");
    setPropImagePrompts(Array.isArray(saved.propImagePrompts) ? saved.propImagePrompts.map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset })) : []);
    const restoredPropImages = Array.isArray(saved.propImages) ? saved.propImages.map((image) => ({ ...image, generationPreset: image.generationPreset ? normalizeGenerationPreset(image.generationPreset, restoredPreset) : restoredPreset, error: localizeStoredImageError(image.error) })) : [];
    setPropImages(restoredPropImages);
    propImageRequestKeysRef.current.clear();
    propImageFailureMessagesRef.current = new Map(restoredPropImages.filter((image) => image.status === "failed").map((image) => [image.propAssetKey, image.error || "道具图生成没有完成。"]))
    propImageAdviceRef.current = String(saved.propImageError || "").startsWith("优化建议：") ? String(saved.propImageError).slice("优化建议：".length) : "";
    setPropImageRequestKeys([]);
    setPropAssetsApproval(saved.propAssetsApproval === "approved" ? "approved" : "draft");
    if (saved.propStatus === "running") { setPropStatus("failed"); setPropError("上次道具视觉提案请求因页面关闭而中断，没有自动重试。"); } else if (Array.isArray(saved.propProposals) && saved.propProposals.length > 0) { setPropStatus("complete"); setPropError(saved.propStatus === "failed" ? `重新分析没有完成，当前道具提案已保留。${saved.propError || ""}` : saved.propError || ""); } else { setPropStatus(["complete", "failed"].includes(saved.propStatus) ? saved.propStatus : "idle"); setPropError(saved.propError || ""); }
    if (saved.propImageStatus === "running") { setPropImageStatus("failed"); setPropImageError("上次道具图片请求因页面关闭而中断；已有结果会保留，没有自动重试。"); } else { setPropImageStatus(["complete", "failed"].includes(saved.propImageStatus) ? saved.propImageStatus : "idle"); setPropImageError(localizeStoredImageError(saved.propImageError) || ""); }
    setStoryboardSegmentDurationSec([5, 10, 15].includes(saved.storyboardSegmentDurationSec) ? saved.storyboardSegmentDurationSec : 15);
    const restoredStoryboardBoardPanelCount = normalizeStoryboardBoardPanelCount(saved.storyboardBoardPanelCount, 3);
    setStoryboardBoardPanelCount(restoredStoryboardBoardPanelCount);
    const restoredStoryboardSegments = Array.isArray(saved.storyboardSegments) ? saved.storyboardSegments : [];
    setStoryboardSegments(restoredStoryboardSegments);
    setStoryboardWarnings(Array.isArray(saved.storyboardWarnings) ? saved.storyboardWarnings : []);
    setStoryboardApproval(saved.storyboardApproval === "approved" ? "approved" : "draft");
    const restoredStoryboardBoardPlans = Array.isArray(saved.storyboardBoardPlans) ? saved.storyboardBoardPlans.map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset })) : [];
    const restoredStoryboardBoardPrompts = Array.isArray(saved.storyboardBoardPrompts) ? saved.storyboardBoardPrompts.map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset })) : [];
    const restoredStoryboardBoards = Array.isArray(saved.storyboardBoards) ? saved.storyboardBoards.map((item) => item.status === "running" ? { ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset, status: "failed" as const, error: "上次故事板任务因页面关闭而中断，没有自动重试。" } : { ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset, error: localizeStoredImageError(item.error) }) : [];
    setStoryboardBoardPlans(restoredStoryboardBoardPlans);
    setStoryboardBoardPrompts(restoredStoryboardBoardPrompts);
    storyboardBoardsRef.current = restoredStoryboardBoards;
    setStoryboardBoards(restoredStoryboardBoards);
    setStoryboardAssetsApproval(saved.storyboardAssetsApproval === "approved" ? "approved" : "draft");
    if (saved.storyboardStatus === "running" && !Object.keys(saved.productionAppliedJobs || {}).length) { setStoryboardStatus("failed"); setStoryboardError("上次文字分镜请求因页面关闭而中断，没有自动重试。"); } else { setStoryboardStatus(["running", "complete", "failed"].includes(saved.storyboardStatus) ? saved.storyboardStatus : "idle"); setStoryboardError(saved.storyboardError || ""); }
    setStoryboardBoardRejectedDraft(typeof saved.storyboardBoardRejectedDraft === "string" ? saved.storyboardBoardRejectedDraft : "");
    setStoryboardBoardRejectedIssues(Array.isArray(saved.storyboardBoardRejectedIssues) ? saved.storyboardBoardRejectedIssues.map(String) : []);
    if (saved.storyboardBoardStatus === "running" && !Object.keys(saved.productionAppliedJobs || {}).length) { setStoryboardBoardStatus("failed"); setStoryboardBoardError("上次故事板请求因页面关闭而中断；已有规划和图片仍保留，没有自动重试。"); } else { setStoryboardBoardStatus(["running", "complete", "failed"].includes(saved.storyboardBoardStatus) ? saved.storyboardBoardStatus : "idle"); setStoryboardBoardError(normalizeStoredStoryboardBoardError(saved.storyboardBoardError, restoredStoryboardBoardPanelCount)); }
    const restoredVideoPrompts = Array.isArray(saved.videoPrompts) ? saved.videoPrompts.map((item) => normalizeStoredVideoPromptResult(item.status === "running" ? item.prompt?.trim() ? { ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset, status: "complete" as const, error: "上次更新请求因页面关闭而中断，已保留原提示词。" } : { ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset, status: "failed" as const, error: "上次视频提示词请求因页面关闭而中断，没有自动重试。" } : { ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, restoredPreset) : restoredPreset }, restoredStoryboardBoardPlans, restoredStoryboardBoards, restoredStoryboardBoardPanelCount)) : [];
    setVideoPrompts(restoredVideoPrompts);
    setVideoPromptsApproval(saved.videoPromptsApproval === "approved" ? "approved" : "draft");
    if (areAllVideoPromptsComplete(restoredStoryboardSegments, restoredVideoPrompts)) { setVideoPromptStatus("complete"); setVideoPromptError(""); } else if (saved.videoPromptStatus === "running" && Object.keys(saved.productionAppliedJobs || {}).length) { setVideoPromptStatus("running"); setVideoPromptError(saved.videoPromptError || ""); } else if (saved.videoPromptStatus === "running") { setVideoPromptStatus("failed"); setVideoPromptError("上次视频提示词请求因页面关闭而中断；已有草稿仍保留，没有自动重试。"); } else if ((!saved.videoPromptStatus || saved.videoPromptStatus === "idle") && restoredVideoPrompts.length === 0) { setVideoPromptStatus("idle"); setVideoPromptError(""); } else { const currentProblemSummary = currentVideoPromptProblemSummary(restoredStoryboardSegments, restoredVideoPrompts); setVideoPromptStatus(currentProblemSummary ? "failed" : "idle"); setVideoPromptError(saved.videoPromptError || currentProblemSummary); }
    setH3GenerationSettings(normalizeH3GenerationSettings(saved.h3GenerationSettings));
    updateShotVideoTasks(() => Array.isArray(saved.shotVideoTasks) ? saved.shotVideoTasks.map((task) => task.status === "submitting" && !task.externalTaskId ? { ...task, generationPreset: task.generationPreset ? normalizeGenerationPreset(task.generationPreset, restoredPreset) : restoredPreset, status: "failed" as const, error: "上次页面在取得PRISM任务编号前中断；系统没有自动重提。", updatedAt: new Date().toISOString() } : { ...task, generationPreset: task.generationPreset ? normalizeGenerationPreset(task.generationPreset, restoredPreset) : restoredPreset }) : []);
    setShotContinuityModes(saved.shotContinuityModes && typeof saved.shotContinuityModes === "object" ? Object.fromEntries(Object.entries(saved.shotContinuityModes).filter(([, mode]) => mode === "independent" || mode === "start_chain" || mode === "continue")) : {});
    setShotVideosApproval(saved.shotVideosApproval === "approved" ? "approved" : "draft");
    setPostProduction(normalizePostProductionState(saved.postProduction));
    const legacyNodeLayout = Object.keys(saved.canvasView?.nodes || {}).length > 0;
    const savedView = normalizeCanvasView(saved.canvasView);
    setCanvasView(legacyNodeLayout ? defaultCanvasView() : savedView);
    setCanvasMode(saved.canvasMode === "free" || saved.canvasMode === "editor" ? saved.canvasMode : "director");
    setFreeCanvas(normalizeFreeCanvasState(saved.freeCanvas));
    setEditor(normalizeEditorState(saved.editor));
  }

  function applyCreativeSession(session: CreativeSessionEnvelope) {
    activeProjectIdRef.current = session.id;
    setActiveProjectId(session.id);
    productionAppliedJobsRef.current = session.state.productionAppliedJobs || {};
    setStoryboardRejectedDraft(session.state.storyboardRejectedDraft || "");
    setStoryboardRejectedIssues(session.state.storyboardRejectedIssues || []);
    sessionRevision.current = Math.max(0, Number(session.revision) || 0);
    setWorkflowSnapshot(session.workflow || createEmptyWorkflowSnapshot(session.updatedAt));
    applyCreativeState(session.state);
  }

  useEffect(() => {
    void fetch("/api/app-settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("load failed")))
      .then((body: AppSettingsStatus) => { if (body.settings?.creativeDefaults) appCreativeDefaultsRef.current = normalizeAppCreativeDefaults(body.settings.creativeDefaults); })
      .catch(() => { /* New projects continue with conservative local defaults. */ });
  }, []);

  async function refreshProviderStatuses() {
    const response = await fetch("/api/provider-settings/status", { cache: "no-store" });
    const body = await readApiJson<{ providers?: ProviderPublicStatus[]; error?: string }>(response, "读取模型配置");
    if (!response.ok || !Array.isArray(body.providers)) throw new Error(body.error || "模型配置暂时无法读取。");
    const providers = normalizeProviderStatuses(body.providers);
    setProviderStatuses(providers);
    return providers;
  }

  async function activateProviderProfile(kind: ProviderKind, profileId: string) {
    setProviderSwitchError("");
    try {
      const response = await fetch("/api/provider-settings/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, profileId }) });
      const body = await readApiJson<{ provider?: ProviderPublicStatus; error?: string }>(response, "切换模型");
      if (!response.ok || !body.provider) throw new Error(body.error || "模型没有切换成功。");
      const provider = normalizeProviderStatus(body.provider);
      setProviderStatuses((current) => [...current.filter((item) => item.kind !== kind), provider]);
    } catch (caught) {
      setProviderSwitchError(caught instanceof Error ? caught.message : "模型没有切换成功。");
    }
  }

  useEffect(() => {
    void refreshProviderStatuses().catch(() => setProviderSwitchError("模型配置暂时无法读取，请在设置中检查连接。"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let saveReadyTimer: number | undefined;
    void fetch("/api/creative-session", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("load failed")))
      .then((body: { session?: CreativeSessionEnvelope | null }) => {
        if (cancelled) return;
        if (body.session?.state) applyCreativeSession(body.session);
        saveReadyTimer = window.setTimeout(() => {
          if (cancelled) return;
          setSessionHydrated(true);
          setSessionSaveReady(true);
        }, 0);
      })
      .catch(() => { if (!cancelled) { setSessionHydrated(true); setSessionSaveStatus("error"); } });
    return () => { cancelled = true; if (saveReadyTimer !== undefined) window.clearTimeout(saveReadyTimer); };
  }, []);

  useEffect(() => {
    void fetch("/api/style-presets", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("load failed")))
      .then((body: { presets?: StylePreset[] }) => setStylePresets(Array.isArray(body.presets) ? body.presets : []))
      .catch(() => setStylePresets([]));
  }, []);

  useEffect(() => { void refreshLocalMusicStatus(false); }, []);

  function creativeStateSnapshot(): CreativeSessionState {
    return {
      productionAppliedJobs: productionAppliedJobsRef.current, storyboardRejectedDraft, storyboardRejectedIssues,
      step, projectName, creationSource, workType, creativeDirection, novelText, novelName, duration, customDurationSec, episodeCountMode, episodeCount, ratio, generationPreset, generationPresetHistory, language, emotion, customEmotion, emotionRecommendations, emotionRecommendationContext, emotionRecommendationError,
      managerMemory,
      characterLibraryHistory: characterLibraryHistoryRef.current, characterRosterVersion: characterRosterVersionRef.current,
      activeStage, ideaText, ideaAnswers, ideaAnswer, ideaQuestion, ideaOptions, ideaError, agentTranscript: compactTranscriptOptions(agentTranscript), managerTranscript, ideaScript, seriesMotherScript, episodeScripts, scriptApproval, scriptRevisionText, characterStatus, characterProfiles, characterAssetProfileKeys, characterError, characterApproval, selectedStyleId, characterImageStatus, characterImages, characterImagePrompts, characterAssetsApproval, characterTurnarounds, characterImageError, sceneStatus, sceneProposals, sceneError, sceneRejectedDraft, sceneRejectedIssues, sceneProposalApproval, sceneImageStatus, sceneImagePrompts, sceneImages, sceneImageError, sceneMainApproval, sceneViews, sceneAssetsApproval, sceneAssetsSkipped, propStatus, propProposals, propError, propRejectedDraft, propRejectedIssues, propProposalApproval, propImageStatus, propImagePrompts, propImages, propImageError, propAssetsApproval, storyboardSegmentDurationSec, storyboardBoardPanelCount, storyboardStatus, storyboardSegments, storyboardWarnings, storyboardError, storyboardApproval, storyboardBoardStatus, storyboardBoardPlans, storyboardBoardPrompts, storyboardBoards, storyboardBoardError, storyboardBoardRejectedDraft, storyboardBoardRejectedIssues, storyboardAssetsApproval, videoPromptStatus, videoPrompts, videoPromptError, videoPromptsApproval, h3GenerationSettings, shotVideoTasks, shotContinuityModes, shotVideosApproval, postProduction, canvasView, canvasMode, freeCanvas, editor,
    };
  }

  productionStateRef.current = creativeStateSnapshot();

  async function receiveProductionJob(job: any) {
    const current = productionStateRef.current;
    if (!current || job.projectId !== activeProjectIdRef.current || job.stale || Number(productionAppliedJobsRef.current[job.id]) >= job.revision) return;
    const source = productionSource(current, job.route, job.sourceVersion ?? 1);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    if (job.projectId !== activeProjectIdRef.current || Number(productionAppliedJobsRef.current[job.id]) >= job.revision) return;
    if ([...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== job.sourceHash || source !== productionSource(productionStateRef.current!, job.route, job.sourceVersion ?? 1)) return;
    const next = applyProductionResult(productionStateRef.current!, job) as CreativeSessionState;
    productionAppliedJobsRef.current = next.productionAppliedJobs || {};
    productionStateRef.current = next;
    const assetStage = assetProductionStage(job.route);
    if (assetStage) {
      if (assetStage === 'character') {
        characterRosterVersionRef.current = undefined;
        setCharacterProfiles(next.characterProfiles); setCharacterStatus(next.characterStatus); setCharacterError(next.characterError); setCharacterApproval(next.characterApproval);
        setCharacterImages(next.characterImages); setCharacterImagePrompts(next.characterImagePrompts); setCharacterTurnarounds(next.characterTurnarounds); setCharacterImageStatus(next.characterImageStatus); setCharacterAssetsApproval(next.characterAssetsApproval);
      } else if (assetStage === 'scene') {
        setSceneProposals(next.sceneProposals); setSceneStatus(next.sceneStatus); setSceneError(next.sceneError); setSceneProposalApproval(next.sceneProposalApproval);
        setSceneRejectedDraft(next.sceneRejectedDraft); setSceneRejectedIssues(next.sceneRejectedIssues); setSceneImages(next.sceneImages); setSceneImagePrompts(next.sceneImagePrompts); setSceneViews(next.sceneViews); setSceneImageStatus(next.sceneImageStatus); setSceneAssetsApproval(next.sceneAssetsApproval); setSceneMainApproval(next.sceneMainApproval); setSceneAssetsSkipped(next.sceneAssetsSkipped ?? false);
      } else {
        setPropProposals(next.propProposals); setPropStatus(next.propStatus); setPropError(next.propError); setPropProposalApproval(next.propProposalApproval);
        setPropRejectedDraft(next.propRejectedDraft); setPropRejectedIssues(next.propRejectedIssues); setPropImages(next.propImages); setPropImagePrompts(next.propImagePrompts); setPropImageStatus(next.propImageStatus); setPropAssetsApproval(next.propAssetsApproval);
      }
      setStoryboardSegments(next.storyboardSegments); setStoryboardApproval(next.storyboardApproval); setStoryboardBoardPlans(next.storyboardBoardPlans); setStoryboardBoardPrompts(next.storyboardBoardPrompts); updateStoryboardBoards(() => next.storyboardBoards); setStoryboardAssetsApproval(next.storyboardAssetsApproval); setVideoPrompts(next.videoPrompts); setVideoPromptsApproval(next.videoPromptsApproval); setShotVideoTasks(next.shotVideoTasks); setShotVideosApproval(next.shotVideosApproval);
    } else if (job.route === '/api/storyboards/segments') {
      setStoryboardSegments(next.storyboardSegments); setStoryboardStatus(next.storyboardStatus); setStoryboardError(next.storyboardError); setStoryboardWarnings(next.storyboardWarnings);
      setStoryboardRejectedDraft(next.storyboardRejectedDraft || ''); setStoryboardRejectedIssues(next.storyboardRejectedIssues || []); setStoryboardApproval(next.storyboardApproval);
      setStoryboardBoardPlans(next.storyboardBoardPlans); setStoryboardBoardPrompts(next.storyboardBoardPrompts); updateStoryboardBoards(() => next.storyboardBoards); setStoryboardAssetsApproval(next.storyboardAssetsApproval);
      setVideoPrompts(next.videoPrompts); setVideoPromptsApproval(next.videoPromptsApproval);
    } else if (job.route.startsWith('/api/storyboards/')) {
      setStoryboardBoardPlans(next.storyboardBoardPlans); setStoryboardBoardPrompts(next.storyboardBoardPrompts); updateStoryboardBoards(() => next.storyboardBoards); setStoryboardBoardStatus(next.storyboardBoardStatus); setStoryboardBoardError(next.storyboardBoardError); setStoryboardAssetsApproval(next.storyboardAssetsApproval);
    } else {
      setVideoPrompts(next.videoPrompts); setVideoPromptStatus(next.videoPromptStatus); setVideoPromptError(next.videoPromptError); setVideoPromptsApproval(next.videoPromptsApproval);
    }
  }

  async function persistCurrentProject(state = creativeStateSnapshot()) {
    const requestId = ++sessionSaveSequence.current;
    const saveEpoch = sessionSaveEpoch.current;
    setSessionSaveStatus("saving");
    const operation = sessionSaveChain.current.then(async () => {
      if (saveEpoch !== sessionSaveEpoch.current) return;
      const response = await fetch("/api/creative-session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, expectedRevision: sessionRevision.current }),
      });
      const body = await readApiJson<{ session?: CreativeSessionEnvelope; error?: string; code?: string }>(response, "项目保存");
      if (response.status === 409 && body.code === "creative_session_revision_conflict" && body.session) {
        sessionSaveEpoch.current += 1;
        sessionSaveSequence.current += 1;
        applyCreativeSession(body.session);
        setSessionSaveStatus("saved");
        throw new CreativeSessionSynchronizedError();
      }
      if (!response.ok || !body.session) throw new Error(body.error || "本机项目保存失败");
      sessionRevision.current = body.session.revision;
      activeProjectIdRef.current = body.session.id;
      setActiveProjectId(body.session.id);
      setWorkflowSnapshot(body.session.workflow);
      if (requestId === sessionSaveSequence.current) setSessionSaveStatus("saved");
    }).catch((error) => {
      if (requestId === sessionSaveSequence.current) setSessionSaveStatus("error");
      throw error;
    });
    sessionSaveChain.current = operation.catch(() => undefined);
    return operation;
  }

  async function postWorkflowRequest<T extends { error?: string; issues?: Array<{ messageZh?: string; suggestionZh?: string }>; returnedDraft?: string; validationIssues?: string[] }>(
    url: string,
    payload: unknown,
    actionLabel: string,
    persist = true,
  ): Promise<T> {
    if (persist) await persistCurrentProject();
    if ((PRODUCTION_ROUTES as readonly string[]).includes(url)) {
      const projectId = activeProjectIdRef.current;
      const response = await fetch('/api/production-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: url, payload, projectId, idempotencyKey: crypto.randomUUID() }) });
      const submitted = await readApiJson<{ job?: any; error?: string }>(response, actionLabel);
      if (!response.ok || !submitted.job) throw new Error(submitted.error || `${actionLabel}未受理。`);
      let job = submitted.job;
      while (['queued', 'running'].includes(job.status)) {
        await receiveProductionJob(job);
        await new Promise(resolve => window.setTimeout(resolve, 1200));
        const status = await fetch(`/api/production-jobs/${encodeURIComponent(job.id)}`, { cache: 'no-store' });
        if (!status.ok) throw new Error(`任务 ${job.id} 的状态暂时不可用，请在制作任务中查看。`);
        job = (await status.json()).job;
      }
      if (activeProjectIdRef.current !== projectId) throw new CreativeSessionSynchronizedError();
      if (job.stale) throw new CreativeSessionSynchronizedError();
      await receiveProductionJob(job);
      if (!job.result || (assetProductionStage(url) && !Array.isArray(job.result.proposals) && !Array.isArray(job.result.profiles))) throw workflowRequestError(job.result || { error: job.error }, `${actionLabel}未完成。`);
      return { ...job.result, ...(job.status !== 'completed' ? { complete: false } : {}), error: job.result.error || job.error || '' } as T;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await readApiJson<T>(response, actionLabel);
    if (!response.ok) {
      throw workflowRequestError(body, `${actionLabel}没有完成。`);
    }
    return body;
  }

  useEffect(() => {
    if (!sessionHydrated) return;
    const recoverable = sceneViews.filter((item) => item.status === "failed" && (item.error?.includes("image_count_mismatch") || item.error?.includes("returned 2")));
    if (recoverable.length === 0) return;
    let cancelled = false;
    void Promise.all(recoverable.map(async (item) => {
      const response = await fetch("/api/scenes/view-candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneAssetKey: item.sceneAssetKey, name: item.name }) });
      const body = await response.json() as { view?: SceneViewResult };
      return response.ok ? body.view : undefined;
    })).then((recovered) => {
      if (cancelled) return;
      setSceneViews((current) => current.map((item) => recovered.find((candidate) => candidate?.sceneAssetKey === item.sceneAssetKey) || item));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionHydrated, sceneViews]);

  useEffect(() => {
    if (!sessionSaveReady || characterRosterBusy) return;
    const state = creativeStateSnapshot();
    const timer = window.setTimeout(() => {
      if (characterRosterBusyRef.current) return;
      void persistCurrentProject(state).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sessionSaveReady, characterRosterBusy, step, projectName, creationSource, workType, creativeDirection, novelText, novelName, duration, customDurationSec, episodeCountMode, episodeCount, ratio, generationPreset, generationPresetHistory, language, emotion, customEmotion, emotionRecommendations, emotionRecommendationContext, emotionRecommendationError, activeStage, ideaText, ideaAnswers, ideaAnswer, ideaQuestion, ideaOptions, ideaError, agentTranscript, managerTranscript, ideaScript, seriesMotherScript, episodeScripts, scriptApproval, scriptRevisionText, characterStatus, characterProfiles, characterAssetProfileKeys, characterError, characterApproval, selectedStyleId, characterImageStatus, characterImages, characterImagePrompts, characterAssetsApproval, characterTurnarounds, characterImageError, sceneStatus, sceneProposals, sceneError, sceneRejectedDraft, sceneRejectedIssues, sceneProposalApproval, sceneImageStatus, sceneImagePrompts, sceneImages, sceneImageError, sceneMainApproval, sceneViews, sceneAssetsApproval, sceneAssetsSkipped, propStatus, propProposals, propError, propRejectedDraft, propRejectedIssues, propProposalApproval, propImageStatus, propImagePrompts, propImages, propImageError, propAssetsApproval, storyboardSegmentDurationSec, storyboardBoardPanelCount, storyboardStatus, storyboardSegments, storyboardWarnings, storyboardError, storyboardApproval, storyboardBoardStatus, storyboardBoardPlans, storyboardBoardPrompts, storyboardBoards, storyboardBoardError, storyboardBoardRejectedDraft, storyboardBoardRejectedIssues, storyboardAssetsApproval, videoPromptStatus, videoPrompts, videoPromptError, videoPromptsApproval, h3GenerationSettings, shotVideoTasks, shotContinuityModes, shotVideosApproval, postProduction, canvasView, canvasMode, freeCanvas, editor]);

  const selectedEmotion = customEmotion.trim() || emotion;
  const minimumDurationSec = workType === "single" && creativeDirection !== "story" ? 5 : 15;
  const resolvedDuration = duration === "自定义" ? `${Math.max(minimumDurationSec, Number(customDurationSec) || 120)}秒` : duration;
  const brief = useMemo(
    () => ({
      workType,
      creativeDirection,
      duration: resolvedDuration,
      ratio,
      language,
      emotion: selectedEmotion,
      episodeCount: workType === "series" ? (episodeCountMode === "agent" ? "由 Agent 建议" : `${Math.max(2, Number(episodeCount) || 8)}集`) : "1条",
    }),
    [workType, creativeDirection, resolvedDuration, ratio, language, selectedEmotion, episodeCountMode, episodeCount],
  );
  const directorCanvasSources = useMemo<DirectorCanvasSource[]>(() => {
    const sources: DirectorCanvasSource[] = [];
    if (ideaScript) sources.push({ sourceRef: { type: "script", stableId: `EP${String(ideaScript.episodeNumber || 1).padStart(3, "0")}`, label: ideaScript.title, version: episodeScripts.find((item) => item.episodeNumber === (ideaScript.episodeNumber || 1))?.version || 1 }, title: `剧本 · ${ideaScript.title}`, kind: "director", content: `${ideaScript.logline}\n\n${ideaScript.endingHook}` });
    characterImages.filter((item) => item.status === "complete" && item.imageUrl).forEach((item) => sources.push({ sourceRef: { type: "character", stableId: item.profileKey, label: item.name }, title: `角色 · ${item.name}`, kind: "image", mediaUrl: item.imageUrl }));
    sceneImages.filter((item) => item.status === "complete" && item.imageUrl).forEach((item) => sources.push({ sourceRef: { type: "scene", stableId: item.sceneAssetKey, label: item.name }, title: `场景 · ${item.name}`, kind: "image", mediaUrl: item.imageUrl }));
    propImages.filter((item) => item.status === "complete" && item.imageUrl).forEach((item) => sources.push({ sourceRef: { type: "prop", stableId: item.propAssetKey, label: item.name }, title: `道具 · ${item.name}`, kind: "image", mediaUrl: item.imageUrl }));
    storyboardBoards.filter((item) => item.status === "complete" && item.imageUrl).forEach((item) => sources.push({ sourceRef: { type: "storyboard", stableId: item.segmentKey, label: item.title }, title: `分镜 · ${item.title}`, kind: "image", mediaUrl: item.imageUrl }));
    shotVideoTasks.filter((item) => item.status === "awaiting_review" && item.externalTaskId).forEach((item) => sources.push({ sourceRef: { type: "video", stableId: item.segmentKey, label: item.segmentKey }, title: `视频 · ${item.segmentKey}`, kind: "video", mediaUrl: `/api/h3/media/${encodeURIComponent(item.externalTaskId!)}` }));
    if (postProduction.roughCut.status === "complete" && postProduction.roughCut.mediaUrl) sources.push({ sourceRef: { type: "postproduction", stableId: "rough-cut", label: "粗剪" }, title: "后期 · 粗剪", kind: "video", mediaUrl: postProduction.roughCut.mediaUrl });
    if (["complete", "unqualified"].includes(postProduction.music.status) && postProduction.music.mediaUrl) sources.push({ sourceRef: { type: "postproduction", stableId: "music", label: "配乐" }, title: "后期 · 配乐", kind: "audio", mediaUrl: postProduction.music.mediaUrl });
    return sources;
  }, [ideaScript, episodeScripts, characterImages, sceneImages, propImages, storyboardBoards, shotVideoTasks, postProduction.roughCut, postProduction.music]);

  const editorAssets = useMemo<EditorAsset[]>(() => {
    const assets: EditorAsset[] = [...editor.importedAssets];
    const addImageAssets = (items: Array<{status: string; imageUrl?: string; name?: string}>, prefix: string) => items.filter(item => item.status === "complete" && item.imageUrl).forEach(item => assets.push({id: `${prefix}:${item.imageUrl}`, kind: "image", title: `${prefix} · ${item.name || "参考图"}`, mediaUrl: item.imageUrl, source: "director"}));
    addImageAssets(characterImages, "角色主图");
    addImageAssets(characterTurnarounds, "角色三视图");
    addImageAssets(sceneImages, "场景主图");
    addImageAssets(sceneViews, "场景多角度");
    addImageAssets(propImages, "道具主图");
    const segmentByKey = new Map(storyboardSegments.map((segment) => [segment.segmentKey, segment]));
    shotVideoTasks.filter((task) => task.status === "awaiting_review" && task.externalTaskId).forEach((task) => {
      const segment = segmentByKey.get(task.segmentKey);
      assets.push({ id: `director-video:${task.segmentKey}:${task.externalTaskId}`, kind: "video", title: segment?.title || `镜头 ${task.segmentKey}`, mediaUrl: `/api/h3/media/${encodeURIComponent(task.externalTaskId!)}`, durationSec: segment?.durationSec || 5, source: "director", segmentKey: task.segmentKey, familyKey: task.segmentKey, version: 1, createdAt: task.updatedAt });
    });
    freeCanvas.mediaHistory.forEach((item) => assets.push({ id: `free:${item.id}`, kind: item.kind, title: item.title, mediaUrl: item.mediaUrl, durationSec: item.mediaDurationSec, source: "free", createdAt: item.createdAt }));
    storyboardBoards.filter((item) => item.status === "complete" && item.imageUrl).forEach((item) => assets.push({ id: `storyboard:${item.segmentKey}`, kind: "image", title: `分镜 · ${item.title}`, mediaUrl: item.imageUrl, source: "director", segmentKey: item.segmentKey }));
    if (postProduction.roughCut.status === "complete" && postProduction.roughCut.mediaUrl) assets.push({ id: "post:rough-cut", kind: "video", title: "导演粗剪", mediaUrl: postProduction.roughCut.mediaUrl, durationSec: postProduction.roughCut.durationSec, source: "postproduction", createdAt: postProduction.roughCut.createdAt });
    if (["complete", "unqualified"].includes(postProduction.music.status) && postProduction.music.mediaUrl) assets.push({ id: "post:music", kind: "audio", title: "项目配乐", mediaUrl: postProduction.music.mediaUrl, durationSec: postProduction.music.durationSec, source: "postproduction", createdAt: postProduction.music.createdAt });
    if (postProduction.finalComposition.status === "complete" && postProduction.finalComposition.mediaUrl) assets.push({ id: "post:final", kind: "final", title: "导演成片", mediaUrl: postProduction.finalComposition.mediaUrl, durationSec: postProduction.finalComposition.durationSec, source: "postproduction", createdAt: postProduction.finalComposition.createdAt });
    editor.renders.filter((render) => render.status === "complete" && render.mediaUrl).forEach((render, index) => assets.push({ id: `editor-render:${render.filename || index}`, kind: "final", title: `剪辑成片 ${editor.renders.length - index}`, mediaUrl: render.mediaUrl, durationSec: render.durationSec, source: "postproduction", createdAt: render.createdAt }));
    const seen = new Set<string>();
    return assets.filter((asset) => { const key = `${asset.kind}:${asset.mediaUrl || asset.id}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  }, [editor.importedAssets, editor.renders, characterImages, characterTurnarounds, sceneImages, sceneViews, propImages, storyboardSegments, shotVideoTasks, freeCanvas.mediaHistory, storyboardBoards, postProduction.roughCut, postProduction.music, postProduction.finalComposition]);

  const returnToDirector = (source: DirectorSourceRef) => {
    const stageByType: Record<DirectorSourceRef["type"], string> = { script: "剧本", character: "角色", scene: "场景", prop: "道具", storyboard: "分镜", video: "视频", postproduction: "视频" };
    setCanvasMode("director"); setActiveStage(stageByType[source.type]); setStageNavigationRequest((current) => Math.abs(current) + 1);
  };

  async function changeCharacters(action: CharacterRosterAction, snapshot = productionStateRef.current || creativeStateSnapshot()) {
    if (characterRosterBusyRef.current || canvasProjectTransitionRef.current) throw new Error("当前操作尚未完成，请稍候。");
    characterRosterBusyRef.current = true; canvasProjectTransitionRef.current = true;
    setCharacterRosterBusy(true); setCharacterRosterError("");
    try {
      await persistCurrentProject(snapshot);
      const response = await fetch("/api/characters/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...action, projectId: activeProjectIdRef.current, expectedRevision: sessionRevision.current }) });
      const body = await readApiJson<{ session?: CreativeSessionEnvelope; error?: string }>(response, "本集人物");
      if (!response.ok || !body.session) throw new Error(body.error || "人物操作未完成。");
      sessionSaveEpoch.current += 1; sessionSaveSequence.current += 1;
      applyCreativeSession(body.session); setAssetLibraryRefresh(value => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "人物操作未完成。";
      setCharacterRosterError(message); throw error;
    } finally {
      characterRosterBusyRef.current = false; canvasProjectTransitionRef.current = false; setCharacterRosterBusy(false);
    }
  }

  function openCharacterLibrary(profileKey?: string) {
    setCharacterLibraryTarget(profileKey); setCharacterLibraryOpen(true);
  }

  useEffect(() => {
    if (!sessionHydrated || activeStage !== "角色" || characterStatus !== "complete" || characterAssetsApproval === "approved" || characterRosterBusy || characterImageStatus === "running") return;
    if (characterRosterVersionRef.current === 1 && characterProfiles.every(profile => profile.libraryBinding)) return;
    const signature = JSON.stringify([activeProjectId, characterProfiles, selectedStyleId, productionAppliedJobsRef.current]);
    if (characterReconciledRef.current === signature) return;
    characterReconciledRef.current = signature;
    void changeCharacters({ action: "reconcile" }).catch(() => undefined);
  }, [sessionHydrated, activeProjectId, activeStage, characterStatus, characterProfiles, characterAssetsApproval, characterRosterBusy, characterImageStatus]);

  async function saveAssetToLibrary(input: AssetLibraryInput) {
    const response = await fetch("/api/asset-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = await readApiJson<{ asset?: AssetLibraryItem; error?: string }>(response, "资产库");
    if (!response.ok || !body.asset) throw new Error(body.error || "资产没有保存。");
    setAssetLibraryRefresh((current) => current + 1);
    setAssetLibraryOpen(true);
  }

  async function applyAssetFromLibrary(asset: AssetLibraryItem, target: AssetLibraryTarget) {
    const response = await fetch("/api/asset-library/use", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: asset.id, targetType: target.type, targetKey: target.key, targetName: target.name, beforeState: creativeStateSnapshot() }) });
    const body = await readApiJson<{ asset?: AssetLibraryItem; undo?: AssetReplacementUndo; error?: string }>(response, "资产应用");
    if (!response.ok || !body.asset || !body.undo) throw new Error(body.error || "资产没有应用。");
    if (target.type === "character" && asset.type === "character" && asset.media.mainImageUrl) {
      setCharacterImages((current) => [...current.filter((item) => item.profileKey !== target.key), { profileKey: target.key, name: target.name, status: "complete", imageUrl: asset.media.mainImageUrl }]);
      if (asset.media.auxiliaryImageUrl) setCharacterTurnarounds((current) => [...current.filter((item) => item.profileKey !== target.key), { profileKey: target.key, name: target.name, status: "complete", imageUrl: asset.media.auxiliaryImageUrl }]);
      setCharacterAssetsApproval("draft");
    }
    if (target.type === "scene" && asset.type === "scene" && asset.media.mainImageUrl) {
      setSceneImages((current) => [...current.filter((item) => item.sceneAssetKey !== target.key), { sceneAssetKey: target.key, name: target.name, status: "complete", imageUrl: asset.media.mainImageUrl }]);
      if (asset.media.auxiliaryImageUrl) setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== target.key), { sceneAssetKey: target.key, name: target.name, status: "complete", imageUrl: asset.media.auxiliaryImageUrl }]);
      setSceneMainApproval("draft"); setSceneAssetsApproval("draft");
    }
    if (target.type === "prop" && asset.type === "prop" && asset.media.mainImageUrl) {
      setPropImages((current) => [...current.filter((item) => item.propAssetKey !== target.key), { propAssetKey: target.key, name: target.name, status: "complete", imageUrl: asset.media.mainImageUrl }]);
      setPropAssetsApproval("draft");
    }
    setStoryboardAssetsApproval("draft");
    setVideoPrompts((current) => current.map((item) => item.status === "failed" ? item : { ...item, status: "stale", approval: "draft" }));
    setVideoPromptsApproval("draft");
    setShotVideosApproval("draft");
    setPostProduction((current) => ({
      ...current,
      roughCut: current.roughCut.status === "complete" ? { ...current.roughCut, status: "stale" } : current.roughCut,
      roughCutApproval: "draft",
      musicPrompt: ["complete", "needs_revision"].includes(current.musicPrompt.status) ? { ...current.musicPrompt, status: "stale" } : current.musicPrompt,
      musicPromptApproval: "draft",
      music: current.music.status === "complete" ? { ...current.music, status: "stale" } : current.music,
    }));
    setAssetLibraryRefresh((current) => current + 1);
    return body.undo;
  }

  async function undoAssetFromLibrary(undoId: string) {
    sessionSaveSequence.current += 1;
    const response = await fetch("/api/asset-library/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ undoId }) });
    const body = await readApiJson<{ session?: CreativeSessionEnvelope; error?: string }>(response, "资产撤回");
    if (!response.ok || !body.session?.state) throw new Error(body.error || "资产替换没有撤回。");
    applyCreativeSession(body.session);
    setAssetLibraryRefresh((current) => current + 1);
  }

  async function openProjectManager() {
    setProjectManagerOpen(true);
    setProjectManagerError("");
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const body = await response.json() as { projects?: ProjectSummary[] };
      if (response.ok && body.projects) setProjects(body.projects);
    } catch {
      setProjects([]);
    }
  }

  async function createProject() {
    if (canvasProjectTransitionRef.current) return;
    if (hasActiveCanvasGeneration(freeCanvasStateRef.current)) { setProjectManagerError('画布任务正在执行，请等待结果返回后再切换项目。'); return; }
    canvasProjectTransitionRef.current = true;
    setProjectManagerBusy(true);
    setProjectManagerError("");
    try {
      await persistCurrentProject();
      setSessionHydrated(false);
      const response = await fetch("/api/projects/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: emptyCreativeState(appCreativeDefaultsRef.current) }) });
      const body = await response.json() as { session?: CreativeSessionEnvelope; projects?: ProjectSummary[]; error?: string };
      if (!response.ok || !body.session) throw new Error(body.error || "新建项目失败");
      applyCreativeSession(body.session);
      setProjects(body.projects ?? []);
      setSessionSaveStatus("saved");
      setProjectManagerOpen(false);
    } catch (error) {
      setProjectManagerError(error instanceof Error ? error.message : "新建项目失败");
    } finally {
      canvasProjectTransitionRef.current = false;
      setProjectManagerBusy(false);
      setSessionHydrated(true);
    }
  }

  async function openEpisodeProduction(episodeNumber: number) {
    if (episodeOpening) return;
    if (canvasProjectTransitionRef.current) return;
    if (hasActiveCanvasGeneration(freeCanvasStateRef.current)) { setEpisodeProductionError('画布任务正在执行，请等待结果返回后再切换项目。'); return; }
    canvasProjectTransitionRef.current = true;
    setEpisodeOpening(true);
    setEpisodeProductionError("");
    try {
      await persistCurrentProject();
      setSessionHydrated(false);
      const response = await fetch('/api/projects/episode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeNumber, projectId: activeProjectIdRef.current, expectedRevision: sessionRevision.current }) });
      const body = await readApiJson<{ session?: CreativeSessionEnvelope; projects?: ProjectSummary[]; error?: string }>(response, '进入本集制作');
      if (!response.ok || !body.session) throw new Error(body.error || '本集制作项目没有打开。');
      applyCreativeSession(body.session);
      setProjects(body.projects ?? []);
      setSelectedEpisodeNumber(null);
      setSessionSaveStatus('saved');
    } catch (error) {
      setEpisodeProductionError(error instanceof Error ? error.message : '本集制作项目没有打开。');
    } finally {
      canvasProjectTransitionRef.current = false;
      setSessionHydrated(true);
      setEpisodeOpening(false);
    }
  }

  async function selectProject(id: string) {
    if (canvasProjectTransitionRef.current) return;
    if (hasActiveCanvasGeneration(freeCanvasStateRef.current)) { setProjectManagerError('画布任务正在执行，请等待结果返回后再切换项目。'); return; }
    canvasProjectTransitionRef.current = true;
    setProjectManagerBusy(true);
    setProjectManagerError("");
    try {
      await persistCurrentProject();
      setSessionHydrated(false);
      const response = await fetch("/api/projects/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await response.json() as { session?: CreativeSessionEnvelope; projects?: ProjectSummary[]; error?: string };
      if (!response.ok || !body.session) throw new Error(body.error || "打开项目失败");
      applyCreativeSession(body.session);
      setProjects(body.projects ?? []);
      setSessionSaveStatus("saved");
      setProjectManagerOpen(false);
    } catch (error) {
      setProjectManagerError(error instanceof Error ? error.message : "打开项目失败");
    } finally {
      canvasProjectTransitionRef.current = false;
      setProjectManagerBusy(false);
      setSessionHydrated(true);
    }
  }

  async function renameCurrentProject(value: string) {
    const name = value.trim();
    if (!name || name === projectName || name.length > 120) return;
    const nextScript = ideaScript && workType !== "series" ? { ...ideaScript, title: name } : ideaScript;
    setProjectName(name);
    setIdeaScript(nextScript);
    setProjects((current) => current.map((project) => project.active ? { ...project, name } : project));
    try {
      await persistCurrentProject({ ...creativeStateSnapshot(), projectName: name, ideaScript: nextScript });
    } catch {
      // The edited value remains visible and the save indicator exposes the persistence failure.
    }
  }

  async function renameProject(id: string, value: string) {
    const name = value.trim();
    if (!name || name.length > 120) return;
    setProjectManagerBusy(true);
    setProjectManagerError("");
    try {
      const response = await fetch("/api/projects/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) });
      const body = await response.json() as { session?: CreativeSessionEnvelope; active?: boolean; projects?: ProjectSummary[]; error?: string };
      if (!response.ok || !body.session || !body.projects) throw new Error(body.error || "项目名保存失败");
      if (body.active) applyCreativeSession(body.session);
      setProjects(body.projects);
      setSessionSaveStatus("saved");
    } catch (error) {
      setProjectManagerError(error instanceof Error ? error.message : "项目名保存失败");
    } finally {
      setProjectManagerBusy(false);
    }
  }

  async function requestEmotionRecommendations(force = false) {
    const sourceText = (creationSource === "idea" ? ideaText : novelText).trim();
    const recommendationInput = {
      sourceText: sourceText.slice(0, 20_000),
      creationSource,
      workType,
      creativeDirection,
      durationSec: Math.max(minimumDurationSec, Number.parseInt(resolvedDuration, 10) || 60),
      ratio,
      language,
    };
    const contextKey = toneRecommendationContextKey(Object.values(recommendationInput));
    setStep("emotion");
    if (!force && emotionRecommendations.length === 4 && emotionRecommendationContext === contextKey) {
      setEmotionRecommendationError("");
      return;
    }
    setEmotionRecommendationBusy(true);
    setEmotionRecommendationError("");
    try {
      const response = await fetch("/api/idea-agent/tones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recommendationInput),
      });
      const body = await response.json() as { recommendations?: ToneOption[]; error?: string };
      if (!response.ok || !Array.isArray(body.recommendations) || body.recommendations.length !== 4) throw new Error(body.error || "编剧导演暂时无法完成情绪推荐。");
      setEmotionRecommendations(body.recommendations);
      setEmotionRecommendationContext(contextKey);
      setEmotion(body.recommendations[0].name);
      setCustomEmotion("");
    } catch (caught) {
      setEmotionRecommendations([]);
      setEmotionRecommendationContext("");
      setEmotionRecommendationError(caught instanceof Error ? caught.message : "编剧导演暂时无法完成情绪推荐。");
    } finally {
      setEmotionRecommendationBusy(false);
    }
  }

  async function requestIdeaTurn(answers: IdeaAnswer[], forceScript = false) {
    setStep("idea-questions");
    setIdeaBusy(true);
    setIdeaError("");
    if (forceScript || answers.some((item) => questionFingerprint(item.question) === questionFingerprint(ideaQuestion))) {
      setIdeaQuestion("");
      setIdeaOptions([]);
    }
    try {
      const response = await fetch("/api/idea-agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: ideaText,
          answers: answers.map(({ question, answer }) => ({ question, answer })),
          forceScript,
          production: {
            workType,
            creativeDirection,
            durationSec: Math.max(minimumDurationSec, Number.parseInt(resolvedDuration, 10) || 60),
            episodeCountMode,
            episodeCount: workType === "series" && episodeCountMode === "fixed" ? Math.max(2, Number(episodeCount) || 8) : null,
            ratio,
            language,
            emotion: selectedEmotion,
          },
        }),
      });
      const body = await response.json() as { turn?: { status: "question" | "script"; question: string; options: IdeaDirectionOption[]; script: IdeaScript | null } } & AgentFailureBody;
      if (!response.ok || !body.turn) throw workflowRequestError(body, "编剧导演暂时无法完成这轮分析。");
      if (body.turn.status === "script" && body.turn.script) {
        const nextProjectName = !ideaScript && (!projectName.trim() || projectName === "新短剧项目" || projectName === "新作品项目") ? body.turn.script.title : projectName;
        const nextScript = body.turn.script.workType === "series" ? body.turn.script : { ...body.turn.script, title: nextProjectName };
        setProjectName(nextProjectName);
        setIdeaScript(nextScript);
        setEpisodeScripts(nextScript.workType === "series" ? [{ scriptKey: "EP001", episodeNumber: 1, version: 1, status: "complete", approval: "draft", script: nextScript }] : []);
        setScriptApproval("draft");
        resetCharacterImageRuntime();
        setCharacterStatus("idle"); setCharacterProfiles([]); setCharacterAssetProfileKeys([]); setCharacterError(""); setCharacterApproval("draft"); setSelectedStyleId(generationPreset.styleId); setCharacterImageStatus("idle"); setCharacterImages(current => current.map(item => ({ ...item, stale: true }))); setCharacterImagePrompts(current => current.map(item => ({ ...item, stale: true }))); setCharacterAssetsApproval("draft"); setCharacterTurnarounds(current => current.map(item => ({ ...item, stale: true }))); setCharacterImageError("");
        setStep("idea-script");
      } else {
        setIdeaQuestion(body.turn.question);
        setIdeaOptions(body.turn.options);
      }
    } catch (caught) {
      setIdeaError(caught instanceof Error ? caught.message : "编剧导演暂时无法完成这轮分析。");
    } finally {
      setIdeaBusy(false);
    }
  }

  async function requestProjectManagerTurn(message: string, reasoningEffort: TextReasoningEffort) {
    const normalized = message.trim();
    if (!normalized || normalized.length > 2_000 || managerBusy) return;
    const userEntry = createManagerTranscriptEntry({ role: "user", text: normalized });
    const currentTranscript = managerTranscriptRef.current;
    const pendingTranscript = [...currentTranscript, userEntry];
    const executionIntent = managerMessageExecutionIntent(normalized);
    const directStoryboardRepairRequested = storyboardStatus === "failed" && executionIntent === "change" && (
      /(文字分镜|对白|逐字|说话人|时间顺序|错误|问题)/.test(normalized)
      || /^(?:请)?(?:把)?错误的地方(?:修改|修复|改好)(?:了|一下)?[。！!]*$/.test(normalized)
      || /^(?:那)?(?:你)?(?:直接)?写入(?:啊|吧|一下)?[。！!]*$/.test(normalized)
    );
    const preparedEntry = executionIntent === "confirm" ? activeManagerCommandEntry(currentTranscript) : undefined;
    const preparedCommands = preparedEntry?.commands?.filter((command) => ["ready", "awaiting_confirmation", "failed"].includes(command.status)
      && ["navigate", "retry_character_profiles", "retry_storyboard_segments", "revise_character_design", "revise_prop_design", "regenerate_character_image", "regenerate_scene_image", "regenerate_prop_image", "regenerate_storyboard_image", "regenerate_video_prompt", "remember_preference"].includes(command.kind)) || [];
    managerTranscriptRef.current = pendingTranscript;
    setManagerTranscript(pendingTranscript);
    setManagerBusy(true);
    setManagerError("");
    try {
      if (managerLocalWorkflowIntent(normalized) === "workflow-back") {
        await returnToPreviousWorkflowStep(true);
        return;
      }
      await persistCurrentProject({ ...creativeStateSnapshot(), managerTranscript: pendingTranscript });
      if (directStoryboardRepairRequested) {
        const createdAt = new Date().toISOString();
        const repairCommand: ProjectManagerCommand = {
          id: `manager-storyboard-repair-${Date.now()}`,
          kind: "retry_storyboard_segments",
          stageId: "storyboard-prompts",
          summaryZh: "修复当前文字分镜，通过校验后写入项目。",
          status: "ready",
          requiresConfirmation: false,
          providerImpact: "agent",
          downstreamImpact: [],
          createdAt,
        };
        const responseEntry = createManagerTranscriptEntry({
          role: "assistant",
          text: "正在修复文字分镜；仅处理未通过校验的文字内容，通过复核后写入项目，不会启动图片或视频生成。",
          commands: [repairCommand],
        });
        const repairTranscript = [...pendingTranscript, responseEntry];
        managerTranscriptRef.current = repairTranscript;
        setManagerTranscript(repairTranscript);
        await executePreparedManagerCommands(responseEntry.id, [repairCommand]);
        return;
      }
      if (preparedEntry && preparedCommands.length > 0) {
        const workingEntry = createManagerTranscriptEntry({ role: "assistant", text: "已收到确认，正在执行已经准备好的修改。" });
        managerTranscriptRef.current = [...managerTranscriptRef.current, workingEntry];
        setManagerTranscript(managerTranscriptRef.current);
        await executePreparedManagerCommands(preparedEntry.id, preparedCommands);
        return;
      }
      const response = await fetch("/api/project-manager/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: normalized,
          reasoningEffort,
          history: currentTranscript.slice(-12).map(({ role, text }) => ({ role, text })),
        }),
      });
      const body = await response.json() as { turn?: ProjectManagerTurn; commands?: ProjectManagerCommand[] } & AgentFailureBody;
      if (!response.ok || !body.turn) throw workflowRequestError(body, "全局总管暂时无法完成这轮分析。");
      const commands = Array.isArray(body.commands) ? body.commands : [];
      const executableCommands = executionIntent === "change" ? commands.filter((command) => ["ready", "awaiting_confirmation"].includes(command.status)
        && ["navigate", "retry_character_profiles", "retry_storyboard_segments", "revise_character_design", "revise_prop_design", "regenerate_video_prompt", "remember_preference"].includes(command.kind)) : [];
      const responseText = executableCommands.length > 0 ? "已定位到修改目标，正在执行。" : body.turn.replyZh;
      const responseEntry = createManagerTranscriptEntry({ role: "assistant", text: responseText, turn: body.turn, commands });
      const completedTranscript = [...pendingTranscript, responseEntry];
      managerTranscriptRef.current = completedTranscript;
      setManagerTranscript(completedTranscript);
      if (executableCommands.length > 0) await executePreparedManagerCommands(responseEntry.id, executableCommands);
      else await persistCurrentProject({ ...creativeStateSnapshot(), managerTranscript: completedTranscript });
    } catch (caught) {
      setManagerError(caught instanceof Error ? caught.message : "PRISM Agent 暂时无法完成这轮分析。");
    } finally {
      setManagerBusy(false);
    }
  }

  async function returnToPreviousWorkflowStep(reportInConversation = false) {
    const transition = resolveWorkflowBack({ step, creationSource, scriptApproval, characterApproval, characterAssetsApproval, sceneProposalApproval, sceneMainApproval, sceneAssetsApproval, propProposalApproval, propAssetsApproval, storyboardApproval, storyboardAssetsApproval, videoPromptsApproval, shotVideosApproval });
    if (!transition) {
      if (!reportInConversation) return;
      const boundaryEntry = createManagerTranscriptEntry({ role: "assistant", text: "当前已经是流程第一步。" });
      const boundaryTranscript = [...managerTranscriptRef.current, boundaryEntry];
      managerTranscriptRef.current = boundaryTranscript;
      setManagerTranscript(boundaryTranscript);
      await persistCurrentProject({ ...creativeStateSnapshot(), managerTranscript: boundaryTranscript });
      return;
    }
    const nextStep = (transition.step || step) as SetupStep;
    const nextActiveStage = transition.activeStage || activeStage;
    let nextTranscript = managerTranscriptRef.current;
    if (reportInConversation) {
      const resultEntry = createManagerTranscriptEntry({ role: "assistant", text: "已返回上一步，当前项目内容均已保留。" });
      nextTranscript = [...nextTranscript, resultEntry];
      managerTranscriptRef.current = nextTranscript;
      setManagerTranscript(nextTranscript);
    }
    const nextState: CreativeSessionState = { ...creativeStateSnapshot(), step: nextStep, activeStage: nextActiveStage, managerTranscript: nextTranscript };
    if (transition.reopenApproval) nextState[transition.reopenApproval] = "draft";
    setStep(nextStep);
    setActiveStage(nextActiveStage);
    if (transition.reopenApproval) reopenWorkflowApproval(transition.reopenApproval);
    if (transition.activeStage) setStageNavigationRequest((current) => Math.abs(current) + 1);
    setManagerError("");
    await persistCurrentProject(nextState);
  }

  function reopenWorkflowApproval(key: WorkflowBackApprovalKey) {
    if (key === "scriptApproval") setScriptApproval("draft");
    else if (key === "characterApproval") setCharacterApproval("draft");
    else if (key === "characterAssetsApproval") setCharacterAssetsApproval("draft");
    else if (key === "sceneProposalApproval") setSceneProposalApproval("draft");
    else if (key === "sceneMainApproval") setSceneMainApproval("draft");
    else if (key === "sceneAssetsApproval") setSceneAssetsApproval("draft");
    else if (key === "propProposalApproval") setPropProposalApproval("draft");
    else if (key === "propAssetsApproval") setPropAssetsApproval("draft");
    else if (key === "storyboardApproval") setStoryboardApproval("draft");
    else if (key === "storyboardAssetsApproval") setStoryboardAssetsApproval("draft");
    else if (key === "videoPromptsApproval") setVideoPromptsApproval("draft");
    else if (key === "shotVideosApproval") setShotVideosApproval("draft");
  }

  async function executePreparedManagerCommands(entryId: string, commands: ProjectManagerCommand[]) {
    for (const command of commands) await executeProjectManagerCommand(entryId, command.id);
    const executed = managerTranscriptRef.current.find((entry) => entry.id === entryId)?.commands?.filter((command) => commands.some((candidate) => candidate.id === command.id)) || [];
    const completed = executed.filter((command) => command.status === "completed");
    const failed = executed.filter((command) => command.status === "failed");
    const resultText = failed.length > 0
      ? `已执行 ${executed.length} 项修改：${completed.length} 项完成，${failed.length} 项未完成。${failed.map((command) => command.errorZh).filter(Boolean).join("；")}`
      : `已完成 ${completed.length} 项修改。${completed.map((command) => command.resultZh).filter(Boolean).join("；")}`;
    const resultEntry = createManagerTranscriptEntry({ role: "assistant", text: resultText });
    const nextTranscript = [...managerTranscriptRef.current, resultEntry];
    managerTranscriptRef.current = nextTranscript;
    setManagerTranscript(nextTranscript);
    await persistCurrentProject({ ...creativeStateSnapshot(), managerTranscript: nextTranscript });
  }

  async function executeManagerCommandWithFeedback(entryId: string, commandId: string) {
    const command = managerTranscriptRef.current.find((entry) => entry.id === entryId)?.commands?.find((candidate) => candidate.id === commandId);
    if (!command) return;
    if (command.kind === "navigate") {
      await executeProjectManagerCommand(entryId, commandId);
      return;
    }
    if (!["ready", "awaiting_confirmation", "failed"].includes(command.status)) return;
    await executePreparedManagerCommands(entryId, [command]);
  }

  function patchManagerCommand(entryId: string, commandId: string, patch: Partial<ProjectManagerCommand>) {
    const nextTranscript = managerTranscriptRef.current.map((entry) => entry.id !== entryId ? entry : {
      ...entry,
      commands: entry.commands?.map((command) => command.id === commandId ? { ...command, ...patch } : command),
    });
    managerTranscriptRef.current = nextTranscript;
    setManagerTranscript(nextTranscript);
  }

  async function executeProjectManagerCommand(entryId: string, commandId: string) {
    const entry = managerTranscriptRef.current.find((candidate) => candidate.id === entryId);
    const command = entry?.commands?.find((candidate) => candidate.id === commandId);
    if (!command) return;
    const completedAt = new Date().toISOString();
    if (command.kind === "navigate") {
      try {
        setActiveStage(managerStageNavigation(command.stageId));
        setStageNavigationRequest((current) => Math.abs(current) + 1);
        const target = command.targetArtifact ?? projectManagerNavigationTarget(command.stageId, entry?.turn?.targetArtifacts || []);
        let opened = false;
        if (target?.kind === "video-prompt" && videoPrompts.some((item) => item.segmentKey === target.id && item.prompt.trim())) { openVideoPrompt(target.id); opened = true; }
        else if (target?.kind === "storyboard" && command.stageId === "storyboard-prompts" && storyboardSegments.some((item) => item.segmentKey === target.id)) { openStoryboardText(target.id); opened = true; }
        else if (target?.kind === "storyboard" && command.stageId === "storyboard-images" && storyboardBoardPrompts.some((item) => item.segmentKey === target.id)) { openStoryboardPrompt(target.id); opened = true; }
        else if (target?.kind === "character" && command.stageId === "character-profiles") { opened = openCharacterProfile(target.id); }
        else if (target?.kind === "character" && command.stageId === "character-images" && characterImagePrompts.some((item) => item.profileKey === target.id)) { openCharacterPrompt(target.id); opened = true; }
        else if (target?.kind === "scene" && sceneImagePrompts.some((item) => item.sceneAssetKey === target.id)) { openScenePrompt(target.id); opened = true; }
        else if (target?.kind === "prop" && propImagePrompts.some((item) => item.propAssetKey === target.id)) { openPropPrompt(target.id); opened = true; }
        patchManagerCommand(entryId, commandId, { status: "ready", completedAt, errorZh: "", resultZh: opened ? "已打开对应修改内容。" : "已定位到对应制作环节。" });
      } catch (caught) {
        patchManagerCommand(entryId, commandId, { status: "failed", completedAt, errorZh: caught instanceof Error ? caught.message : "没有打开对应修改位置。" });
      }
      return;
    }
    if (command.kind === "regenerate_character_image" && entry?.commands?.some((candidate) => candidate.kind === "revise_character_design" && candidate.targetArtifact?.id === command.targetArtifact?.id && candidate.status !== "completed")) return;
    if (command.kind === "regenerate_prop_image" && entry?.commands?.some((candidate) => candidate.kind === "revise_prop_design" && candidate.targetArtifact?.id === command.targetArtifact?.id && candidate.status !== "completed")) return;
    if (!["ready", "awaiting_confirmation"].includes(command.status) && !(["retry_character_profiles", "retry_storyboard_segments", "revise_character_design", "revise_prop_design"].includes(command.kind) && command.status === "failed")) return;
    patchManagerCommand(entryId, commandId, { status: "running", errorZh: "", resultZh: "" });
    try {
      if (command.kind === "remember_preference") {
        const preferenceText = command.preferenceText?.trim();
        if (!preferenceText) throw new Error("这条偏好没有可保存的明确内容。");
        setManagerMemory((current) => current.explicitPreferences.some((item) => item.text === preferenceText) ? current : {
          explicitPreferences: [...current.explicitPreferences, { id: `preference-${Date.now()}`, text: preferenceText, sourceCommandId: command.id, createdAt: completedAt }].slice(-50),
        });
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt, resultZh: "已保存为当前项目的创作偏好。" });
        return;
      }
      if (command.kind === "retry_character_profiles") {
        const result = await startCharacterDesign();
        if (!result.ok) throw new Error(result.error || "角色档案仍未形成可用结果。");
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: `角色档案已重新整理并写入，共 ${result.count} 个角色。` });
        return;
      }
      if (command.kind === "retry_storyboard_segments") {
        const result = await requestStoryboardSegments(true);
        if (!result.ok) throw new Error(result.error || "文字分镜仍未形成可用结果。");
        setActiveStage("分镜");
        setStageNavigationRequest((current) => Math.abs(current) + 1);
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: `文字分镜已修复并写入，共 ${result.count} 段；图片和视频生成均未启动。` });
        return;
      }
      const targetId = command.targetArtifact?.id;
      if (!targetId) throw new Error("命令没有绑定唯一项目实体，未执行。");
      if (command.kind === "revise_character_design") {
        const profile = characterProfiles.find((item) => item.profileKey === targetId);
        const currentPrompt = characterImagePrompts.find((item) => item.profileKey === targetId);
        if (!profile || !currentPrompt?.prompt.trim()) throw new Error("没有找到这个角色的完整人物设定和图片提示词。");
        const body = await postWorkflowRequest<{ profile?: CharacterProfile; prompt?: CharacterImagePrompt; error?: string }>("/api/characters/revise-design", {
          profile,
          currentPrompt: currentPrompt.prompt,
          revisionRequest: command.instructionZh || command.summaryZh,
          styleId: selectedStyleId,
          generationPreset,
        }, "人物设定与图片提示词修改");
        if (!body.profile || !body.prompt?.prompt.trim()) throw new Error(body.error || "本次修改没有返回完整的人物设定和图片提示词。");
        setCharacterProfiles((current) => current.map((item) => item.profileKey === targetId ? body.profile! : item));
        setCharacterImagePrompts((current) => [...current.filter((item) => item.profileKey !== targetId), body.prompt!]);
        setCharacterApproval("approved");
        setCharacterAssetsApproval("draft");
        setActiveStage("角色");
        setStageNavigationRequest((current) => Math.abs(current) + 1);
        openCharacterPromptResult(body.prompt);
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: "修改后的人物设定与图片提示词已保存并打开，请先检查新提示词。" });
        return;
      } else if (command.kind === "revise_prop_design") {
        const proposal = propProposals.find((item) => item.propAssetKey === targetId);
        const currentPrompt = propImagePrompts.find((item) => item.propAssetKey === targetId);
        if (!proposal || !currentPrompt?.prompt.trim()) throw new Error("没有找到这个道具的完整设定和图片提示词。");
        const body = await postWorkflowRequest<{ proposal?: PropVisualProposal; prompt?: PropImagePrompt; error?: string }>("/api/props/revise-design", {
          script: ideaScript,
          profiles: characterProfiles,
          proposal,
          currentPrompt: currentPrompt.prompt,
          revisionRequest: command.instructionZh || command.summaryZh,
          styleId: selectedStyleId,
          generationPreset,
        }, "道具设定与图片提示词修改");
        if (!body.proposal || !body.prompt?.prompt.trim()) throw new Error(body.error || "本次修改没有返回完整的道具设定和图片提示词。");
        setPropProposals((current) => current.map((item) => item.propAssetKey === targetId ? body.proposal! : item));
        setPropImagePrompts((current) => [...current.filter((item) => item.propAssetKey !== targetId), body.prompt!]);
        setPropProposalApproval("approved");
        setPropAssetsApproval("draft");
        setActiveStage("道具");
        setStageNavigationRequest((current) => Math.abs(current) + 1);
        setPropPromptEditorKey(body.prompt.propAssetKey);
        setPropPromptEditorText(body.prompt.prompt);
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: "修改后的道具设定与图片提示词已保存并打开，请检查新提示词。" });
        return;
      } else if (command.kind === "regenerate_character_image") {
        if (!characterProfiles.some((item) => item.profileKey === targetId) || characterImageRequestKeysRef.current.has(targetId)) throw new Error("目标角色不存在或当前已有任务在执行。");
        await generateCharacterImages([targetId]);
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: "新的角色图片已生成。可以保留更新返回主线，也可以检查并同步后续内容。" });
        return;
      } else if (command.kind === "regenerate_scene_image") {
        if (!sceneProposals.some((item) => item.sceneAssetKey === targetId) || sceneImageRequestKeysRef.current.has(targetId)) throw new Error("目标场景不存在或当前已有任务在执行。");
        await generateSceneImages([targetId]);
      } else if (command.kind === "regenerate_prop_image") {
        if (!propProposals.some((item) => item.propAssetKey === targetId) || propImageRequestKeysRef.current.has(targetId)) throw new Error("目标道具不存在或当前已有任务在执行。");
        await generatePropImages([targetId]);
      } else if (command.kind === "regenerate_storyboard_image") {
        if (!storyboardSegments.some((item) => item.segmentKey === targetId) || storyboardApproval !== "approved" || storyboardBoardRequestKeysRef.current.has(targetId)) throw new Error("目标分镜当前不满足重新生成条件。");
        await generateStoryboardBoards([targetId]);
      } else if (command.kind === "regenerate_video_prompt") {
        if (!storyboardSegments.some((item) => item.segmentKey === targetId) || storyboardAssetsApproval !== "approved" || videoPromptStatus === "running") throw new Error("目标视频提示词当前不满足重新生成条件。");
        const updatedPrompts = await generateVideoPrompts([targetId], command.instructionZh || command.summaryZh);
        const updatedPrompt = updatedPrompts.find((item) => item.segmentKey === targetId && item.prompt.trim());
        if (!updatedPrompt) throw new Error("本次修改没有返回新的可用提示词，请查看对应卡片中的错误。");
        setActiveStage(managerStageNavigation(command.stageId));
        setStageNavigationRequest((current) => Math.abs(current) + 1);
        openVideoPromptResult(updatedPrompt);
        patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: "修改后的提示词已打开，可直接查看和继续编辑。" });
        return;
      }
      patchManagerCommand(entryId, commandId, { status: "completed", completedAt: new Date().toISOString(), resultZh: "已通过原阶段流程执行；最终结果和错误以对应卡片为准。" });
    } catch (caught) {
      patchManagerCommand(entryId, commandId, { status: "failed", completedAt: new Date().toISOString(), errorZh: caught instanceof Error ? caught.message : "命令没有完成。" });
    }
  }

  function cancelProjectManagerCommand(entryId: string, commandId: string) {
    patchManagerCommand(entryId, commandId, { status: "cancelled", completedAt: new Date().toISOString(), resultZh: "已取消，没有提交生成任务。" });
  }

  function preservedMainlineStage() {
    if (shotVideoTasks.length || videoPrompts.length || postProduction.roughCut.status !== "idle" || postProduction.finalComposition.status !== "idle") return "视频";
    if (storyboardSegments.length || storyboardBoards.length || storyboardBoardPrompts.length) return "分镜";
    if (propProposals.length || propImages.length) return "道具";
    if (sceneProposals.length || sceneImages.length) return "场景";
    return "角色";
  }

  function handleCharacterImageFollowUp(entryId: string, commandId: string, choice: ProjectManagerFollowUpChoice) {
    const command = managerTranscript.find((entry) => entry.id === entryId)?.commands?.find((candidate) => candidate.id === commandId);
    if (command?.kind !== "regenerate_character_image" || command.status !== "completed") return;
    const profile = characterProfiles.find((item) => item.profileKey === command.targetArtifact?.id);
    setCharacterAssetsApproval("approved");
    if (choice === "mainline") {
      const stage = preservedMainlineStage();
      setActiveStage(stage);
      setStageNavigationRequest((current) => Math.abs(current) + 1);
      patchManagerCommand(entryId, commandId, { followUpChoice: choice, resultZh: `新的角色设定与图片已保留，已返回${stage}主线。` });
      return;
    }
    const matchedSegmentKeys = profile ? storyboardSegments.filter((segment) => segment.characters.includes(profile.name)).map((segment) => segment.segmentKey) : [];
    const affectedSegmentKeys = matchedSegmentKeys.length ? matchedSegmentKeys : storyboardSegments.map((segment) => segment.segmentKey);
    setStoryboardAssetsApproval("draft");
    markVideoPromptsStale(affectedSegmentKeys);
    setShotVideosApproval("draft");
    setPostProduction((current) => ({
      ...current,
      roughCut: current.roughCut.status === "complete" ? { ...current.roughCut, status: "stale", error: "角色形象已更新，旧粗剪继续保留，待相关镜头更新后再处理。" } : current.roughCut,
      roughCutApproval: "draft",
      finalComposition: current.finalComposition.status === "complete" ? { ...current.finalComposition, status: "stale", error: "角色形象已更新，旧成片继续保留。" } : current.finalComposition,
    }));
    setActiveStage("分镜");
    setStageNavigationRequest((current) => Math.abs(current) + 1);
    patchManagerCommand(entryId, commandId, {
      followUpChoice: choice,
      resultZh: affectedSegmentKeys.length ? `已定位到分镜，${affectedSegmentKeys.length}段相关内容已设为待更新；现有图片和视频均继续保留。` : "已定位到分镜；现有内容继续保留。",
    });
  }

  function openProjectManagerCommandResult(entryId: string, commandId: string) {
    const command = managerTranscript.find((entry) => entry.id === entryId)?.commands?.find((candidate) => candidate.id === commandId);
    if (!command?.targetArtifact?.id) return;
    setActiveStage(managerStageNavigation(command.stageId));
    setStageNavigationRequest((current) => Math.abs(current) + 1);
    if (command.kind === "regenerate_video_prompt") openVideoPrompt(command.targetArtifact.id);
    else if (command.kind === "revise_character_design") openCharacterPrompt(command.targetArtifact.id);
    else if (command.kind === "revise_prop_design") openPropPrompt(command.targetArtifact.id);
  }

  async function requestNovelScript() {
    setNovelBusy(true);
    setNovelError("");
    try {
      const response = await fetch("/api/novel-adaptation/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          novelText,
          sourceName: novelName || "粘贴文本素材",
          production: {
            workType,
            creativeDirection,
            durationSec: Math.max(minimumDurationSec, Number.parseInt(resolvedDuration, 10) || 60),
            episodeCountMode,
            episodeCount: workType === "series" && episodeCountMode === "fixed" ? Math.max(2, Number(episodeCount) || 8) : null,
            ratio,
            language,
            emotion: selectedEmotion,
          },
        }),
      });
      const body = await readApiJson<{ script?: IdeaScript } & AgentFailureBody>(response, workType === "series" ? "智能拆集" : "剧本生成");
      if ((!response.ok || !body.script) && body.returnedDraft) {
        setAgentTranscript(current => [...current, { id: crypto.randomUUID(), role: 'assistant', kind: 'event', text: `剧本返回稿 · 待修正\n${(body.validationIssues || []).join('\n')}\n\n${body.returnedDraft}`, createdAt: new Date().toISOString() }]);
      }
      if (!response.ok || !body.script) throw workflowRequestError(body, workType === "series" ? "编剧导演暂时无法完成智能拆集。" : "编剧导演暂时无法完成剧本改编。");
      const nextProjectName = !ideaScript && (!projectName.trim() || projectName === "新短剧项目" || projectName === "新作品项目") ? body.script.title : projectName;
      const nextScript = body.script.workType === "series" ? body.script : { ...body.script, title: nextProjectName };
      setProjectName(nextProjectName);
      setIdeaScript(nextScript);
      setEpisodeScripts(nextScript.workType === "series" ? [{ scriptKey: "EP001", episodeNumber: 1, version: 1, status: "complete", approval: "draft", script: nextScript }] : []);
      setScriptApproval("draft");
      resetCharacterImageRuntime();
      setCharacterStatus("idle"); setCharacterProfiles([]); setCharacterAssetProfileKeys([]); setCharacterError(""); setCharacterApproval("draft"); setSelectedStyleId(generationPreset.styleId); setCharacterImageStatus("idle"); setCharacterImages(current => current.map(item => ({ ...item, stale: true }))); setCharacterImagePrompts(current => current.map(item => ({ ...item, stale: true }))); setCharacterAssetsApproval("draft"); setCharacterTurnarounds(current => current.map(item => ({ ...item, stale: true }))); setCharacterImageError("");
      setStep("idea-script");
    } catch (caught) {
      const fallback = workType === "series" ? "编剧导演暂时无法完成智能拆集。" : "编剧导演暂时无法完成剧本改编。";
      const message = caught instanceof TypeError && /fetch|network|load failed/iu.test(caught.message)
        ? "无法连接PRISM本机服务，请确认网页服务仍在运行后再手动提交。"
        : caught instanceof Error ? caught.message : fallback;
      setNovelError(/自动重试/u.test(message) ? message : `${message} 系统没有自动重试。`);
    } finally {
      setNovelBusy(false);
    }
  }

  async function requestScriptRevision() {
    const revisionRequest = scriptRevisionText.trim();
    if (!ideaScript || !revisionRequest) return;
    setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "user", kind: "revision", text: revisionRequest })]);
    setScriptRevisionBusy(true);
    setScriptRevisionError("");
    try {
      const response = await fetch("/api/script/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentScript: ideaScript,
          revisionRequest,
          sourceContext: creationSource === "novel" ? novelText : ideaText,
        }),
      });
      const body = await response.json() as { script?: IdeaScript } & AgentFailureBody;
      if (!response.ok || !body.script) throw workflowRequestError(body, "编剧导演暂时无法完成这次修改。");
      const revisedScript = body.script.workType === "series" ? body.script : { ...body.script, title: projectName };
      setIdeaScript(revisedScript);
      if (revisedScript.workType === "series") {
        const revisedEpisodeNumber = revisedScript.episodeNumber || 1;
        setEpisodeScripts((current) => {
          const previous = current.find((item) => item.episodeNumber === revisedEpisodeNumber);
          const next = { scriptKey: `EP${String(revisedEpisodeNumber).padStart(3, "0")}`, episodeNumber: revisedEpisodeNumber, version: (previous?.version || 0) + 1, status: "complete" as const, approval: "draft" as const, script: revisedScript };
          return [...current.filter((item) => item.episodeNumber !== revisedEpisodeNumber), next].sort((a, b) => a.episodeNumber - b.episodeNumber);
        });
      }
      setScriptApproval("draft");
      resetCharacterImageRuntime();
      setCharacterStatus("idle"); setCharacterProfiles([]); setCharacterAssetProfileKeys([]); setCharacterError(""); setCharacterApproval("draft"); setSelectedStyleId(generationPreset.styleId); setCharacterImageStatus("idle"); setCharacterImages(current => current.map(item => ({ ...item, stale: true }))); setCharacterImagePrompts(current => current.map(item => ({ ...item, stale: true }))); setCharacterAssetsApproval("draft"); setCharacterTurnarounds(current => current.map(item => ({ ...item, stale: true }))); setCharacterImageError("");
      setScriptRevisionText("");
      setScriptRevisionOpen(false);
      setStep("idea-script");
    } catch (caught) {
      setScriptRevisionError(caught instanceof Error ? caught.message : "编剧导演暂时无法完成这次修改。");
    } finally {
      setScriptRevisionBusy(false);
    }
  }

  async function optimizeFreeCanvasPrompt(kind: "text" | "image" | "video" | "audio", prompt: string, references: Array<Pick<FreeCanvasReference, "kind" | "title" | "content" | "purpose">>, options?: { audioMode?: FreeCanvasAudioSettings["mode"]; textTarget?: FreeCanvasTextOutputTarget }) {
    const response = await fetch("/api/free-canvas/optimize-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, prompt, references: references.map(({ kind: referenceKind, title, content, purpose }) => ({ kind: referenceKind, title, content, purpose })), audioMode: options?.audioMode, textTarget: options?.textTarget }),
    });
    const body = await response.json() as { optimizedPrompt?: string } & AgentFailureBody;
    if (!response.ok || !body.optimizedPrompt) throw workflowRequestError(body, "提示词没有优化成功，原文已保留。");
    return body.optimizedPrompt;
  }

  async function generateFreeCanvasImage(nodeId: string, taskId: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasImageSettings) {
    assertCanvasProjectReady();
    const response = await fetch("/api/free-canvas/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, taskId, prompt, references: references.map(({ id, kind, title, content, mediaUrl, purpose }) => ({ id, kind, title, content, mediaUrl, purpose })), settings }),
    });
    const body = await response.json() as { imageUrls?: string[]; provider?: string; status?: "complete" | "partial"; warning?: string; error?: string };
    if (!response.ok || !body.imageUrls?.length || !body.provider) throw new Error(body.error || "图片没有生成成功，提示词和旧结果已保留。");
    return { imageUrls: body.imageUrls, provider: body.provider, status: body.status === "partial" ? "partial" as const : "complete" as const, warning: body.warning };
  }

  async function processFreeCanvasImage(input: { taskId: string; mediaUrl: string; operation: "rotate-clockwise" | "rotate-counterclockwise" | "upscale"; upscaleScale?: 2 | 4; upscaleModel?: "general" | "anime" }) {
    assertCanvasProjectReady();
    const response = await fetch("/api/free-canvas/image-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json() as { imageUrl?: string; provider?: string; operation?: typeof input.operation; outputWidth?: number; outputHeight?: number; parameters?: Record<string, unknown>; error?: string };
    if (!response.ok || !body.imageUrl || !body.provider || !body.operation) throw new Error(body.error || "图片处理没有完成，原图已保留。");
    return { imageUrl: body.imageUrl, provider: body.provider, operation: body.operation, outputWidth: Number(body.outputWidth) || 0, outputHeight: Number(body.outputHeight) || 0, parameters: body.parameters || {} };
  }

  async function generateFreeCanvasVideo(nodeId: string, taskId: string, title: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasVideoSettings, onProgress: (task: { status: string; provider?: string; externalTaskId?: string; outputPaths?: string[]; parameters?: Record<string, unknown>; errorMessage?: string }) => void) {
    assertCanvasProjectReady();
    if (usesCloudVideo(settings)) {
      const snapshot = creativeStateSnapshot();
      await persistCurrentProject({ ...snapshot, freeCanvas: { ...snapshot.freeCanvas, nodes: snapshot.freeCanvas.nodes.map(node => node.id === nodeId ? { ...node, content: prompt, videoSettings: settings, generation: { ...node.generation, taskId, status: 'submitting', provider: settings.engine, updatedAt: new Date().toISOString() } } : node) } });
    }
    const response = await fetch("/api/free-canvas/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId, nodeId, taskId, title, prompt, references, settings }),
    });
    const submitted = await response.json() as { task?: { status: string; provider?: string; externalTaskId?: string; outputPaths?: string[]; parameters?: Record<string, unknown>; errorMessage?: string }; error?: string };
    if (!response.ok || !submitted.task?.externalTaskId) throw new Error(submitted.error || "视频接口没有返回任务编号，参数和旧结果已保留。");
    let task = submitted.task;
    const externalTaskId = task.externalTaskId!;
    onProgress(task);
    for (let attempt = 0; attempt < 900; attempt += 1) {
      if (task.status === "awaiting_review") return { mediaUrl: `/api/h3/media/${encodeURIComponent(task.externalTaskId!)}`, outputPaths: task.outputPaths || [], provider: task.provider || "prism-h3", externalTaskId: task.externalTaskId! };
      if (task.status === "failed" || task.status === "cancelled") throw new Error(task.errorMessage || "视频任务失败或已取消，原参数与结果已保留。");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      const statusResponse = await fetch(`/api/videos/generations/${encodeURIComponent(externalTaskId)}`, { cache: "no-store" });
      const statusBody = await statusResponse.json() as { task?: typeof task; error?: string };
      if (!statusResponse.ok || !statusBody.task) throw new Error(`${statusBody.error || "无法刷新本机PRISM H3任务状态"}；任务没有被重新提交。`);
      task = statusBody.task;
      onProgress(task);
    }
    throw new Error("本机PRISM H3任务仍在执行，任务没有被重新提交；可稍后从任务记录继续查看。");
  }

  async function generateFreeCanvasAudio(nodeId: string, taskId: string, prompt: string, references: FreeCanvasReference[], settings: FreeCanvasAudioSettings) {
    assertCanvasProjectReady();
    const response = await fetch("/api/free-canvas/generate-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, taskId, prompt, references: references.map(({ id, kind, title, content, purpose }) => ({ id, kind, title, content, purpose })), settings }),
    });
    const body = await readApiJson<{ audio?: MusicGenerationResult; error?: string }>(response, "ACE-Step自由画布音频生成");
    if (!response.ok || !body.audio?.mediaUrl || !body.audio.provider) throw new Error(body.error || "ACE-Step没有返回可播放的本地音频。" );
    if (body.audio.status !== "complete" && body.audio.status !== "unqualified") throw new Error(body.audio.error || "ACE-Step没有返回合格的可播放音频。");
    return {
      mediaUrl: body.audio.mediaUrl,
      outputPaths: body.audio.outputPath ? [body.audio.outputPath] : [],
      provider: body.audio.provider,
      externalTaskId: body.audio.externalTaskId,
      status: body.audio.status === "unqualified" ? "partial" as const : "complete" as const,
      warning: body.audio.status === "unqualified" ? body.audio.error || "音频时长未达到目标，结果已保留供试听。" : undefined,
    };
  }

  async function importFreeCanvasMedia(blob: Blob, name: string, expectedKind: "image" | "video" | "audio") {
    const response = await fetch("/api/free-canvas/imports", {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
      body: blob,
    });
    const body = await readApiJson<{ asset?: { kind?: string; originalName?: string; mediaUrl?: string }; error?: string }>(response, "导入自由画布媒体");
    if (!response.ok || body.asset?.kind !== expectedKind || !body.asset.mediaUrl) throw new Error(body.error || `${name} 导入失败。`);
    return { kind: expectedKind, originalName: String(body.asset.originalName || name), mediaUrl: body.asset.mediaUrl };
  }

  async function importEditorMedia(file: File): Promise<EditorAsset> {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const expectedKind: "image" | "video" | "audio" = file.type.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "mkv", "avi"].includes(extension) ? "video" : file.type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension) ? "audio" : "image";
    const durationSec = expectedKind === "image" ? undefined : await new Promise<number | undefined>((resolveDuration) => {
      const element = document.createElement(expectedKind);
      const objectUrl = URL.createObjectURL(file);
      element.preload = "metadata";
      element.onloadedmetadata = () => { const value = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined; URL.revokeObjectURL(objectUrl); resolveDuration(value); };
      element.onerror = () => { URL.revokeObjectURL(objectUrl); resolveDuration(undefined); };
      element.src = objectUrl;
    });
    const imported = await importFreeCanvasMedia(file, file.name, expectedKind);
    const asset: EditorAsset = { id: `import:${Date.now().toString(36)}:${file.name}`, kind: expectedKind, title: imported.originalName, mediaUrl: imported.mediaUrl, durationSec, source: "import", createdAt: new Date().toISOString() };
    setEditor((current) => ({ ...current, importedAssets: [...current.importedAssets, asset].slice(-2_000) }));
    return asset;
  }

  async function generateEpisodeFromSeriesPlan(episodeNumber: number) {
    if (!ideaScript || ideaScript.workType !== "series" || !ideaScript.seriesPlan?.some((item) => item.episodeNumber === episodeNumber)) return;
    const previousRecord = episodeScripts.find((item) => item.episodeNumber === episodeNumber);
    setEpisodeScripts((current) => {
      const running: EpisodeScriptRecord = {
        scriptKey: `EP${String(episodeNumber).padStart(3, "0")}`,
        episodeNumber,
        version: previousRecord?.version || 0,
        status: "running",
        approval: previousRecord?.approval || "draft",
        script: previousRecord?.script,
      };
      return [...current.filter((item) => item.episodeNumber !== episodeNumber), running].sort((a, b) => a.episodeNumber - b.episodeNumber);
    });
    try {
      const priorEpisodeScript = episodeScripts.find((item) => item.episodeNumber === episodeNumber - 1)?.script ?? null;
      const response = await fetch("/api/script/episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesScript: seriesMotherScript || ideaScript, sourceText: creationSource === "novel" ? novelText : [ideaText || novelText, ...ideaAnswers.map(item => item.answer)].join("\n"), episodeNumber, priorEpisodeScript }),
      });
      const body = await readApiJson<{ script?: IdeaScript } & AgentFailureBody>(response, "分集剧本生成");
      if (!response.ok || !body.script) throw workflowRequestError(body, `第${episodeNumber}集剧本没有生成。`);
      setEpisodeScripts((current) => {
        const latest = current.find((item) => item.episodeNumber === episodeNumber);
        const complete: EpisodeScriptRecord = { scriptKey: `EP${String(episodeNumber).padStart(3, "0")}`, episodeNumber, version: (latest?.version || 0) + 1, status: "complete", approval: "draft", script: body.script };
        return [...current.filter((item) => item.episodeNumber !== episodeNumber), complete].sort((a, b) => a.episodeNumber - b.episodeNumber);
      });
      setSelectedEpisodeNumber(episodeNumber);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : `第${episodeNumber}集剧本没有生成。`;
      setEpisodeScripts((current) => {
        const latest = current.find((item) => item.episodeNumber === episodeNumber);
        const failed: EpisodeScriptRecord = { scriptKey: `EP${String(episodeNumber).padStart(3, "0")}`, episodeNumber, version: latest?.version || 0, status: "failed", approval: latest?.approval || "draft", script: latest?.script, error: `${message} 系统没有自动重试，旧版本仍保留。` };
        return [...current.filter((item) => item.episodeNumber !== episodeNumber), failed].sort((a, b) => a.episodeNumber - b.episodeNumber);
      });
    }
  }

  function enterCharacterDesign() {
    if (!ideaScript) return;
    setScriptApproval("approved");
    if (ideaScript.workType === "series") setEpisodeScripts((current) => current.map((item) => item.episodeNumber === (ideaScript.episodeNumber || 1) ? { ...item, approval: "approved" } : item));
    setStep("workspace");
    setActiveStage("角色");
    setCharacterStatus("idle");
    setCharacterProfiles([]);
    setCharacterAssetProfileKeys([]);
    setCharacterError("");
    resetCharacterImageRuntime();
    setCharacterApproval("draft"); setSelectedStyleId(generationPreset.styleId); setCharacterImageStatus("idle"); setCharacterImages(current => current.map(item => ({ ...item, stale: true }))); setCharacterImagePrompts(current => current.map(item => ({ ...item, stale: true }))); setCharacterAssetsApproval("draft"); setCharacterTurnarounds(current => current.map(item => ({ ...item, stale: true }))); setCharacterImageError("");
  }

  async function startCharacterDesign(): Promise<{ ok: boolean; count: number; error?: string }> {
    if (!ideaScript || scriptApproval !== "approved") return { ok: false, count: 0, error: "当前没有已确认剧本，无法整理角色档案。" };
    if (characterStatus === "running") return { ok: false, count: 0, error: "角色档案正在整理，请等待当前任务完成。" };
    setCharacterStatus("running");
    setCharacterError("");
    try {
      const body = await postWorkflowRequest<{ profiles?: CharacterProfile[]; warnings?: string[]; error?: string }>("/api/characters/profiles", { script: ideaScript }, "角色设定");
      if (!Array.isArray(body.profiles)) throw new Error(body.error || "角色设计师暂时无法完成人物档案。 ");

      setCharacterAssetProfileKeys([]);
      return { ok: true, count: body.profiles.length };
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return { ok: false, count: 0, error: '项目状态已同步。' };
      const message = caught instanceof Error ? caught.message : "角色设计师暂时无法完成人物档案。 ";
      setCharacterStatus(characterProfiles.length ? "complete" : "failed");
      setCharacterError(message);
      return { ok: false, count: 0, error: message };
    }
  }

  function skipCharacterProfiles() {
    if (!ideaScript || (ideaScript.workType !== "single" && selectEpisodeCharacters(ideaScript).length > 0) || characterStatus === "running") return;
    setCharacterStatus("complete");
    setCharacterProfiles([]);
    setCharacterAssetProfileKeys([]);
    setCharacterError("");
    setCharacterApproval("approved");
    resetCharacterImageRuntime();
    setCharacterImageStatus("idle");
    setCharacterImages(current => current.map(item => ({ ...item, stale: true })));
    setCharacterImagePrompts(current => current.map(item => ({ ...item, stale: true })));
    setCharacterTurnarounds(current => current.map(item => ({ ...item, stale: true })));
    setCharacterImageError("");
  }

  function removeCharacterProfile(profileKey: string) {
    void changeCharacters({ action: "remove", profileKey }).catch(() => undefined);
  }

  function resetCharacterImageRuntime() {
    characterImageRequestKeysRef.current.clear();
    characterImageFailureMessagesRef.current.clear();
    characterImageAdviceRef.current = "";
    setCharacterImageRequestKeys([]);
  }

  function characterImageFailureMessage() {
    const failures = [...characterImageFailureMessagesRef.current.values()];
    return failures.length > 0 ? `${failures.length}个角色图请求失败；${failures[0]}` : "";
  }

  async function generateAssetBatch(kind: AssetBatchKind, retry = false) {
    const approval = kind === "character" ? characterApproval : kind === "scene" ? sceneProposalApproval : propProposalApproval;
    if (approval !== "approved" || !selectedStyleId) return;
    const assets = kind === "character" ? characterProfiles : kind === "scene" ? sceneProposals : propProposals;
    const images = kind === "character" ? characterImages : kind === "scene" ? sceneImages : propImages;
    const requests = kind === "character" ? characterImageRequestKeysRef.current : kind === "scene" ? sceneImageRequestKeysRef.current : propImageRequestKeysRef.current;
    const batch = productionAssetBatch(kind, assets, images, requests);
    const keys = retry ? batch.failedKeys : batch.readyKeys;
    if (!keys.length || batch.running) return;
    if (kind === "character") await generateCharacterImages(keys);
    else if (kind === "scene") await generateSceneImages(keys);
    else await generatePropImages(keys);
  }

  async function generateCharacterImages(explicitProfileKeys?: string[], promptOverride?: CharacterImagePrompt[]) {
    const requestedKeys = explicitProfileKeys?.length ? new Set(explicitProfileKeys) : new Set(characterProfiles.map((profile) => profile.profileKey));
    const requestedProfiles = characterProfiles.filter((profile) => profile.participation !== "voice" && requestedKeys.has(profile.profileKey) && !characterImageRequestKeysRef.current.has(profile.profileKey));
    if (!selectedStyleId || requestedProfiles.length === 0) return;
    const reusablePrompts = promptOverride ?? characterImagePrompts;
    const requestedProfileKeys = requestedProfiles.map((profile) => profile.profileKey);
    if (requestedProfileKeys.length === 0) return;
    const activeRequestedKeys = new Set(requestedProfileKeys);
    requestedProfileKeys.forEach((profileKey) => {
      characterImageRequestKeysRef.current.add(profileKey);
      characterImageFailureMessagesRef.current.delete(profileKey);
    });
    setCharacterImageRequestKeys([...characterImageRequestKeysRef.current]);
    setCharacterImageStatus("running");
    setCharacterImageError(characterImageFailureMessage());
    try {
      const body = await postWorkflowRequest<{ images?: CharacterImageResult[]; prompts?: CharacterImagePrompt[]; validationWarnings?: string[]; error?: string }>("/api/characters/images", { profiles: requestedProfiles, styleId: selectedStyleId, generationPreset, prompts: reusablePrompts.filter((prompt) => activeRequestedKeys.has(prompt.profileKey) && prompt.styleId === selectedStyleId && usesCurrentGenerationPreset(prompt, generationPreset)), requestedProfileKeys }, "角色图生成");
      if (!Array.isArray(body.images)) throw new Error(body.error || "角色图生成没有完成。 ");
      if (Array.isArray(body.validationWarnings) && body.validationWarnings.length > 0) characterImageAdviceRef.current = body.validationWarnings.join("；");
      const incomingPrompts = Array.isArray(body.prompts) ? body.prompts : [];
      setCharacterImagePrompts((current) => {
        const next = new Map(current.map((prompt) => [prompt.profileKey, prompt]));
        incomingPrompts.forEach((prompt) => next.set(prompt.profileKey, { ...prompt, generationPreset: prompt.generationPreset || generationPreset }));
        return [...next.values()];
      });
      setCharacterImages((current) => {
        const mergedByKey = new Map(current.map((image) => [image.profileKey, image]));
        body.images!.forEach((incoming) => {
          const existing = mergedByKey.get(incoming.profileKey);
          if (!(incoming.status === "failed" && existing?.status === "complete")) mergedByKey.set(incoming.profileKey, { ...incoming, generationPreset: incoming.generationPreset || generationPreset });
        });
        return characterProfiles.map((profile) => mergedByKey.get(profile.profileKey)).filter((image): image is CharacterImageResult => Boolean(image));
      });
      setCharacterAssetProfileKeys((current) => {
        const next = new Set(current);
        body.images!.filter((image) => image.status === "complete" && image.imageUrl).forEach((image) => next.add(image.profileKey));
        return characterProfiles.map((profile) => profile.profileKey).filter((profileKey) => next.has(profileKey));
      });
      const incomingByKey = new Map(body.images.map((image) => [image.profileKey, image]));
      requestedProfileKeys.forEach((profileKey) => {
        const result = incomingByKey.get(profileKey);
        if (result?.status === "complete" && result.imageUrl) characterImageFailureMessagesRef.current.delete(profileKey);
        else characterImageFailureMessagesRef.current.set(profileKey, result?.error || "图片服务没有返回这个角色的完整结果。");
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "角色图生成没有完成。";
      requestedProfileKeys.forEach((profileKey) => characterImageFailureMessagesRef.current.set(profileKey, message));
      setCharacterImages(current => {
        const next = new Map(current.map(image => [image.profileKey, image]));
        for (const profile of requestedProfiles) {
          const existing = next.get(profile.profileKey);
          if (existing?.status !== "complete" || !existing.imageUrl) next.set(profile.profileKey, { profileKey: profile.profileKey, name: profile.name, status: "failed", error: message });
        }
        return [...next.values()];
      });
    } finally {
      requestedProfileKeys.forEach((profileKey) => characterImageRequestKeysRef.current.delete(profileKey));
      const remainingRequestKeys = [...characterImageRequestKeysRef.current];
      setCharacterImageRequestKeys(remainingRequestKeys);
      const failureMessage = characterImageFailureMessage();
      setCharacterImageError(failureMessage || (characterImageAdviceRef.current ? `优化建议：${characterImageAdviceRef.current}` : ""));
      setCharacterImageStatus(remainingRequestKeys.length > 0 ? "running" : characterImageFailureMessagesRef.current.size > 0 ? "failed" : "complete");
    }
  }

  function removeCharacterImage(profileKey: string) {
    if (characterImageRequestKeysRef.current.has(profileKey) || characterAssetsApproval === "approved") return;
    const remainingImages = characterImages.filter((image) => image.profileKey !== profileKey);
    characterImageFailureMessagesRef.current.delete(profileKey);
    setCharacterImages(remainingImages);
    setCharacterAssetProfileKeys(remainingImages.filter((image) => image.status === "complete" && image.imageUrl).map((image) => image.profileKey));
    setCharacterImagePrompts((current) => current.filter((prompt) => prompt.profileKey !== profileKey));
    setCharacterTurnarounds((current) => current.filter((turnaround) => turnaround.profileKey !== profileKey));
    setCharacterImageStatus(characterImageRequestKeysRef.current.size > 0 ? "running" : characterImageFailureMessagesRef.current.size > 0 ? "failed" : remainingImages.some((image) => image.status === "complete") ? "complete" : "idle");
    setCharacterImageError(characterImageFailureMessage());
  }

  function selectCharacterStyle(styleId: string) {
    const next = evolveGenerationPreset(generationPreset, { styleId });
    if (next === generationPreset) return;
    setGenerationPreset(next);
    setGenerationPresetHistory((current) => [...current.filter((item) => item.version !== next.version), next].sort((a, b) => a.version - b.version));
    setSelectedStyleId(next.styleId);
  }

  function selectGenerationRatio(aspectRatio: GenerationAspectRatio) {
    const next = evolveGenerationPreset(generationPreset, { aspectRatio });
    if (next === generationPreset) return;
    setGenerationPreset(next);
    setGenerationPresetHistory((current) => [...current.filter((item) => item.version !== next.version), next].sort((a, b) => a.version - b.version));
  }

  function selectGenerationImageResolution(imageResolution: ImageResolutionTier) {
    const next = evolveGenerationPreset(generationPreset, { imageResolution });
    if (next === generationPreset) return;
    setGenerationPreset(next);
    setGenerationPresetHistory((current) => [...current.filter((item) => item.version !== next.version), next].sort((a, b) => a.version - b.version));
  }

  function selectInitialProjectRatio(value: string) {
    const aspectRatio = GENERATION_ASPECT_RATIOS.includes(value as GenerationAspectRatio) ? value as GenerationAspectRatio : '16:9';
    setRatio(aspectRatio);
    if (step === "workspace") return;
    const next = { ...generationPreset, aspectRatio };
    setGenerationPreset(next);
    setGenerationPresetHistory((current) => [...current.filter((item) => item.version !== next.version), next].sort((a, b) => a.version - b.version));
  }

  function openCharacterProfile(profileKey: string) {
    const profile = characterProfiles.find((item) => item.profileKey === profileKey);
    if (!profile) return false;
    setCharacterProfileEditor(structuredClone(profile));
    return true;
  }

  async function saveCharacterProfile(profile: CharacterProfile) {
    const normalized: CharacterProfile = {
      ...profile,
      introduction: profile.introduction.trim(),
      identity: profile.identity.trim(),
      storyRole: profile.storyRole.trim(),
      motivation: profile.motivation.trim(),
      personality: profile.personality.map((item) => item.trim()).filter(Boolean),
      physicalKnownFacts: profile.physicalKnownFacts.map((item) => item.trim()).filter(Boolean),
      wardrobeKnownFacts: profile.wardrobeKnownFacts.map((item) => item.trim()).filter(Boolean),
      designOpenQuestions: profile.designOpenQuestions.map((item) => item.trim()).filter(Boolean),
    };
    try {
      await changeCharacters({ action: "update-profile", profileKey: normalized.profileKey, profile: normalized });
      setCharacterProfileEditor(null);
    } catch (reason) { setCharacterError(reason instanceof Error ? reason.message : "人物资料没有保存。"); }
  }

  function openCharacterPrompt(profileKey: string) {
    const savedPrompt = characterImagePrompts.find((item) => item.profileKey === profileKey);
    if (!savedPrompt) return;
    setPromptEditorKey(profileKey);
    setPromptEditorText(savedPrompt.prompt);
  }

  function openCharacterPromptResult(prompt: CharacterImagePrompt) {
    setPromptEditorKey(prompt.profileKey);
    setPromptEditorText(prompt.prompt);
  }

  function updateCharacterPrompt(profileKey: string, prompt: string) {
    const value = sanitizeProductionPrompt(prompt.trim());
    if (!value) return characterImagePrompts;
    const next = characterImagePrompts.map((item) => item.profileKey === profileKey ? { ...item, prompt: value } : item);
    setCharacterImagePrompts(next);
    return next;
  }

  async function generateCharacterTurnaround(profileKey: string) {
    const profile = characterProfiles.find((item) => item.profileKey === profileKey);
    const image = characterImages.find((item) => item.profileKey === profileKey && item.status === "complete" && item.imageUrl);
    if (!profile || !image?.imageUrl || characterTurnarounds.some((item) => item.profileKey === profileKey && item.status === "running")) return;
    setCharacterTurnarounds((current) => [...current.filter((item) => item.profileKey !== profileKey), { profileKey, name: profile.name, status: "running" }]);
    try {
      const body = await postWorkflowRequest<{ turnaround?: CharacterTurnaroundResult; error?: string }>("/api/characters/turnaround", { profileKey, name: profile.name, imageUrl: image.imageUrl }, "角色三视图");
      if (!body.turnaround) throw new Error(body.error || "角色三视图没有完成。");
      setCharacterTurnarounds((current) => [...current.filter((item) => item.profileKey !== profileKey), body.turnaround!]);
    } catch (caught) {
      setCharacterTurnarounds((current) => [...current.filter((item) => item.profileKey !== profileKey), { profileKey, name: profile.name, status: "failed", error: caught instanceof Error ? caught.message : "角色三视图没有完成。" }]);
    }
  }

  function approveCharacterAssets() {
    if (!selectedStyleId) return;
    void changeCharacters({ action: "approve-assets" }).catch(() => undefined);
  }

  async function requestSceneProposals() {
    if (!ideaScript || !selectedStyleId || sceneStatus === "running") return;
    setSceneAssetsSkipped(false);
    setSceneStatus("running");
    setSceneError("");
    try {
      const body = await postWorkflowRequest<{ proposals?: SceneVisualProposal[]; warnings?: string[]; error?: string }>("/api/scenes/proposals", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId }, "场景视觉提案");
      if (!Array.isArray(body.proposals)) throw new Error(body.error || "场景视觉提案没有完成。");
      sceneImageRequestKeysRef.current.clear(); sceneImageFailureMessagesRef.current.clear(); sceneImageAdviceRef.current = ""; setSceneImageRequestKeys([]);
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      setSceneStatus(sceneProposals.length ? "complete" : "failed");
      setSceneError(caught instanceof WorkflowRequestError ? caught.summary : caught instanceof Error ? caught.message : "场景视觉提案没有完成。");
      if (caught instanceof WorkflowRequestError) {
        if (caught.returnedDraft) setSceneRejectedDraft(caught.returnedDraft);
        if (caught.validationIssues.length > 0) setSceneRejectedIssues(caught.validationIssues);
      }
    }
  }

  async function validateSceneRejectedDraft() {
    if (!ideaScript || !selectedStyleId || !sceneRejectedDraft.trim() || sceneStatus === "running") return;
    setSceneStatus("running");
    setSceneError("");
    try {
      const body = await postWorkflowRequest<{ proposals?: SceneVisualProposal[]; warnings?: string[]; error?: string; returnedDraft?: string; validationIssues?: string[] }>("/api/scenes/proposals", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId, returnedDraft: sceneRejectedDraft }, "场景视觉提案本地校验");
      if (!Array.isArray(body.proposals)) throw new Error(body.error || "修改后的场景提案没有通过校验。");
      sceneImageRequestKeysRef.current.clear(); sceneImageFailureMessagesRef.current.clear(); sceneImageAdviceRef.current = ""; setSceneImageRequestKeys([]);
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      setSceneStatus(sceneProposals.length ? "complete" : "failed");
      setSceneError(caught instanceof WorkflowRequestError ? caught.summary : caught instanceof Error ? caught.message : "修改后的场景提案没有通过校验。");
      if (caught instanceof WorkflowRequestError) {
        if (caught.returnedDraft) setSceneRejectedDraft(caught.returnedDraft);
        setSceneRejectedIssues(caught.validationIssues);
      }
    }
  }

  function approveSceneProposals(selectedKeys: string[]) {
    if (sceneStatus !== "complete" || sceneProposals.length === 0) return;
    if (selectedKeys.length === 0) {
      skipSceneAssets();
      return;
    }
    setSceneAssetsSkipped(false);
    setSceneProposals((current) => current.map((proposal) => ({ ...proposal, selectedForProduction: selectedKeys.includes(proposal.sceneAssetKey) })));
    setSceneProposalApproval("approved");
    setSceneError(current => current.startsWith('提案已保留，待你确认。') ? '' : current);
  }

  async function generateSceneImages(explicitSceneKeys?: string[], promptOverride?: SceneImagePrompt[]) {
    if (!ideaScript || !selectedStyleId || sceneProposalApproval !== "approved") return;
    setSceneAssetsSkipped(false);
    const requestedKeys = new Set(explicitSceneKeys?.length ? explicitSceneKeys : sceneProposals.filter((proposal) => proposal.selectedForProduction !== false).map((proposal) => proposal.sceneAssetKey));
    const requestedProposals = sceneProposals.filter((proposal) => requestedKeys.has(proposal.sceneAssetKey) && !sceneImageRequestKeysRef.current.has(proposal.sceneAssetKey));
    if (requestedProposals.length === 0) return;
    const reusablePrompts = promptOverride ?? sceneImagePrompts;
    const requestedSceneKeys = requestedProposals.map((proposal) => proposal.sceneAssetKey);
    requestedSceneKeys.forEach((sceneAssetKey) => {
      sceneImageRequestKeysRef.current.add(sceneAssetKey);
      sceneImageFailureMessagesRef.current.delete(sceneAssetKey);
    });
    setSceneImageRequestKeys([...sceneImageRequestKeysRef.current]);
    setSceneImageStatus("running");
    setSceneImageError("");
    setSceneMainApproval("draft");
    setSceneViews((current) => current.filter((item) => !requestedKeys.has(item.sceneAssetKey)));
    setSceneAssetsApproval("draft");
    try {
      const body = await postWorkflowRequest<{ images?: SceneImageResult[]; prompts?: SceneImagePrompt[]; validationWarnings?: string[]; error?: string }>("/api/scenes/images", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId, generationPreset, proposals: sceneProposals, prompts: reusablePrompts.filter((prompt) => prompt.styleId === selectedStyleId && usesCurrentGenerationPreset(prompt, generationPreset)), requestedSceneKeys }, "场景提示词与主图");
      if (!Array.isArray(body.images) || !Array.isArray(body.prompts)) throw new Error(body.error || "场景提示词或主图没有完成。");
      if (Array.isArray(body.validationWarnings) && body.validationWarnings.length > 0) sceneImageAdviceRef.current = body.validationWarnings.join("；");
      setSceneImagePrompts((current) => sceneProposals.map((proposal) => {
        const incoming = body.prompts?.find((item) => item.sceneAssetKey === proposal.sceneAssetKey);
        return incoming ? { ...incoming, generationPreset: incoming.generationPreset || generationPreset } : current.find((item) => item.sceneAssetKey === proposal.sceneAssetKey);
      }).filter((item): item is SceneImagePrompt => Boolean(item)));
      setSceneImages((current) => sceneProposals.map((proposal) => {
        const incoming = body.images?.find((image) => image.sceneAssetKey === proposal.sceneAssetKey);
        const existing = current.find((image) => image.sceneAssetKey === proposal.sceneAssetKey);
        return incoming?.status === "failed" && existing?.status === "complete" && existing.imageUrl ? existing : incoming ? { ...incoming, generationPreset: incoming.generationPreset || generationPreset } : existing;
      }).filter((image): image is SceneImageResult => Boolean(image)));
      body.images.forEach((image) => {
        if (image.status === "failed") sceneImageFailureMessagesRef.current.set(image.sceneAssetKey, image.error || `${image.name}场景图没有完成。`);
        else sceneImageFailureMessagesRef.current.delete(image.sceneAssetKey);
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "场景提示词或主图没有完成。";
      setSceneImages((current) => sceneProposals.map((proposal) => {
        const existing = current.find((image) => image.sceneAssetKey === proposal.sceneAssetKey);
        if (!requestedKeys.has(proposal.sceneAssetKey) || existing?.status === "complete" && existing.imageUrl) return existing;
        return { sceneAssetKey: proposal.sceneAssetKey, name: proposal.name, status: "failed" as const, error: message };
      }).filter((image): image is SceneImageResult => Boolean(image)));
      requestedSceneKeys.forEach((sceneAssetKey) => sceneImageFailureMessagesRef.current.set(sceneAssetKey, message));
    } finally {
      requestedSceneKeys.forEach((sceneAssetKey) => sceneImageRequestKeysRef.current.delete(sceneAssetKey));
      const remainingRequestKeys = [...sceneImageRequestKeysRef.current];
      const failures = [...sceneImageFailureMessagesRef.current.values()];
      setSceneImageRequestKeys(remainingRequestKeys);
      setSceneImageStatus(remainingRequestKeys.length > 0 ? "running" : failures.length > 0 ? "failed" : "complete");
      setSceneImageError(failures.length > 0 ? `${failures.length}个场景图未完成；${failures[0]}` : sceneImageAdviceRef.current ? `优化建议：${sceneImageAdviceRef.current}` : "");
    }
  }

  function openScenePrompt(sceneAssetKey: string) {
    const savedPrompt = sceneImagePrompts.find((item) => item.sceneAssetKey === sceneAssetKey);
    if (!savedPrompt) return;
    setScenePromptEditorKey(sceneAssetKey);
    setScenePromptEditorText(savedPrompt.prompt);
  }

  function updateScenePrompt(sceneAssetKey: string, prompt: string) {
    const value = sanitizeProductionPrompt(prompt.trim());
    if (!value) return sceneImagePrompts;
    const next = sceneImagePrompts.map((item) => item.sceneAssetKey === sceneAssetKey ? { ...item, prompt: value } : item);
    setSceneImagePrompts(next);
    setSceneMainApproval("draft"); setSceneViews([]); setSceneAssetsApproval("draft");
    return next;
  }

  function approveSceneMainImages() {
    if (!sceneProposals.every((proposal) => sceneImages.some((image) => image.sceneAssetKey === proposal.sceneAssetKey && image.status === "complete"))) return;
    setSceneMainApproval("approved");
  }

  async function generateSceneView(sceneAssetKey: string) {
    if (sceneViews.some((item) => item.sceneAssetKey === sceneAssetKey && item.status === "running")) return;
    const proposal = sceneProposals.find((item) => item.sceneAssetKey === sceneAssetKey);
    const image = sceneImages.find((item) => item.sceneAssetKey === sceneAssetKey && item.status === "complete" && item.imageUrl);
    if (!proposal || !image?.imageUrl) return;
    setSceneAssetsApproval("draft");
    setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== sceneAssetKey), { sceneAssetKey, name: proposal.name, status: "running" }]);
    try {
      const body = await postWorkflowRequest<{ view?: SceneViewResult; error?: string }>("/api/scenes/views", { sceneAssetKey, name: proposal.name, imageUrl: image.imageUrl, fixedLandmarks: proposal.visualDesignProposal.fixedLandmarks, spatialLayout: proposal.visualDesignProposal.spatialLayout }, "场景多角度图");
      if (!body.view) throw new Error(body.error || "场景多角度图没有完成。");
      setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== sceneAssetKey), body.view!]);
    } catch (caught) {
      setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== sceneAssetKey), { sceneAssetKey, name: proposal.name, status: "failed", error: caught instanceof Error ? caught.message : "场景多角度图没有完成。" }]);
    }
  }

  async function recoverSceneViewCandidates(sceneAssetKey: string) {
    const proposal = sceneProposals.find((item) => item.sceneAssetKey === sceneAssetKey);
    if (!proposal) return;
    try {
      const response = await fetch("/api/scenes/view-candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneAssetKey, name: proposal.name }) });
      const body = await response.json() as { view?: SceneViewResult; error?: string };
      if (!response.ok || !body.view) throw new Error(body.error || "没有读取到已保留候选图。");
      setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== sceneAssetKey), body.view!]);
    } catch (caught) {
      setSceneViews((current) => [...current.filter((item) => item.sceneAssetKey !== sceneAssetKey), { sceneAssetKey, name: proposal.name, status: "failed", error: caught instanceof Error ? caught.message : "没有读取到已保留候选图。" }]);
    }
  }

  function selectSceneViewCandidate(sceneAssetKey: string, imageUrl: string) {
    setSceneViews((current) => current.map((item) => item.sceneAssetKey === sceneAssetKey ? { ...item, status: "complete", imageUrl } : item));
  }

  function approveSceneAssets() {
    if (sceneProposalApproval !== "approved" || sceneImageRequestKeysRef.current.size > 0 || sceneViews.some((item) => item.status === "running")) return;
    setSceneAssetsSkipped(false);
    setSceneMainApproval("approved");
    setSceneAssetsApproval("approved");
    setActiveStage("道具");
  }

  function skipSceneAssets() {
    if (sceneStatus === "running" || sceneImageStatus === "running" || sceneImageRequestKeysRef.current.size > 0 || sceneViews.some((item) => item.status === "running")) return;
    setSceneAssetsSkipped(true);
    setSceneProposals((current) => current.map((proposal) => ({ ...proposal, selectedForProduction: false })));
    setSceneProposalApproval("approved");
    setSceneMainApproval("approved");
    setSceneAssetsApproval("approved");
    setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "user", kind: "action", text: "本片不建立固定场景资产，继续进入道具设计" })]);
    setActiveStage("道具");
  }

  async function requestPropProposals() {
    if (!ideaScript || !selectedStyleId || propStatus === "running") return;
    const hasReusableProposals = propProposals.length > 0;
    setPropStatus("running"); setPropError("");
    try {
      const body = await postWorkflowRequest<{ proposals?: PropVisualProposal[]; warnings?: string[]; error?: string }>("/api/props/proposals", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId }, "道具视觉提案");
      if (!Array.isArray(body.proposals)) throw new Error(body.error || "道具视觉提案没有完成。");
      propImageRequestKeysRef.current.clear(); propImageFailureMessagesRef.current.clear(); propImageAdviceRef.current = ""; setPropImageRequestKeys([]);
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      const message = caught instanceof WorkflowRequestError ? caught.summary : caught instanceof Error ? caught.message : "道具视觉提案没有完成。";
      setPropStatus(hasReusableProposals ? "complete" : "failed");
      setPropError(hasReusableProposals ? `重新分析没有完成，当前道具提案已保留。${message}` : message);
      if (caught instanceof WorkflowRequestError) {
        if (!hasReusableProposals && caught.returnedDraft) setPropRejectedDraft(caught.returnedDraft);
        if (!hasReusableProposals && caught.validationIssues.length > 0) setPropRejectedIssues(caught.validationIssues);
      }
    }
  }

  async function validatePropRejectedDraft() {
    if (!ideaScript || !selectedStyleId || !propRejectedDraft.trim() || propStatus === "running") return;
    setPropStatus("running");
    setPropError("");
    try {
      const body = await postWorkflowRequest<{ proposals?: PropVisualProposal[]; warnings?: string[]; error?: string; returnedDraft?: string; validationIssues?: string[] }>("/api/props/proposals", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId, returnedDraft: propRejectedDraft }, "道具视觉提案本地校验");
      if (!Array.isArray(body.proposals)) throw new Error(body.error || "修改后的道具提案没有通过校验。");
      propImageRequestKeysRef.current.clear(); propImageFailureMessagesRef.current.clear(); propImageAdviceRef.current = ""; setPropImageRequestKeys([]);
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      setPropStatus(propProposals.length ? "complete" : "failed");
      setPropError(caught instanceof WorkflowRequestError ? caught.summary : caught instanceof Error ? caught.message : "修改后的道具提案没有通过校验。");
      if (caught instanceof WorkflowRequestError) {
        if (caught.returnedDraft) setPropRejectedDraft(caught.returnedDraft);
        setPropRejectedIssues(caught.validationIssues);
      }
    }
  }

  function approvePropProposals(selectedKeys: string[]) {
    if (propStatus !== "complete") return;
    if (selectedKeys.length === 0) {
      skipPropDesign();
      return;
    }
    setPropProposals((current) => current.map((proposal) => ({ ...proposal, selectedForProduction: selectedKeys.includes(proposal.propAssetKey) })));
    setPropProposalApproval("approved");
    setPropError(current => current.startsWith('提案已保留，待你确认。') ? '' : current);
  }

  async function generatePropImages(explicitPropKeys?: string[], promptOverride?: PropImagePrompt[]) {
    if (!ideaScript || !selectedStyleId || propProposalApproval !== "approved" || propProposals.length === 0) return;
    const requestedKeys = new Set(explicitPropKeys?.length ? explicitPropKeys : propProposals.filter((proposal) => proposal.selectedForProduction !== false).map((proposal) => proposal.propAssetKey));
    const requestedProposals = propProposals.filter((proposal) => requestedKeys.has(proposal.propAssetKey) && !propImageRequestKeysRef.current.has(proposal.propAssetKey));
    if (requestedProposals.length === 0) return;
    const reusablePrompts = promptOverride ?? propImagePrompts;
    const requestedPropKeys = requestedProposals.map((proposal) => proposal.propAssetKey);
    requestedPropKeys.forEach((propAssetKey) => {
      propImageRequestKeysRef.current.add(propAssetKey);
      propImageFailureMessagesRef.current.delete(propAssetKey);
    });
    setPropImageRequestKeys([...propImageRequestKeysRef.current]);
    setPropImageStatus("running"); setPropImageError("");
    setPropAssetsApproval("draft");
    try {
      const body = await postWorkflowRequest<{ images?: PropImageResult[]; prompts?: PropImagePrompt[]; validationWarnings?: string[]; error?: string }>("/api/props/images", { script: ideaScript, profiles: characterProfiles, styleId: selectedStyleId, generationPreset, proposals: propProposals, prompts: reusablePrompts.filter((prompt) => prompt.styleId === selectedStyleId && usesCurrentGenerationPreset(prompt, generationPreset)), requestedPropKeys }, "道具提示词与主图");
      if (!Array.isArray(body.images) || !Array.isArray(body.prompts)) throw new Error(body.error || "道具提示词或主图没有完成。");
      if (Array.isArray(body.validationWarnings) && body.validationWarnings.length > 0) propImageAdviceRef.current = body.validationWarnings.join("；");
      setPropImagePrompts((current) => propProposals.map((proposal) => {
        const incoming = body.prompts?.find((item) => item.propAssetKey === proposal.propAssetKey);
        return incoming ? { ...incoming, generationPreset: incoming.generationPreset || generationPreset } : current.find((item) => item.propAssetKey === proposal.propAssetKey);
      }).filter((item): item is PropImagePrompt => Boolean(item)));
      setPropImages((current) => propProposals.map((proposal) => {
        const incoming = body.images?.find((image) => image.propAssetKey === proposal.propAssetKey);
        const existing = current.find((image) => image.propAssetKey === proposal.propAssetKey);
        return incoming?.status === "failed" && existing?.status === "complete" && existing.imageUrl ? existing : incoming ? { ...incoming, generationPreset: incoming.generationPreset || generationPreset } : existing;
      }).filter((image): image is PropImageResult => Boolean(image)));
      body.images.forEach((image) => {
        if (image.status === "failed") propImageFailureMessagesRef.current.set(image.propAssetKey, image.error || `${image.name}道具图没有完成。`);
        else propImageFailureMessagesRef.current.delete(image.propAssetKey);
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "道具提示词或主图没有完成。";
      setPropImages((current) => propProposals.map((proposal) => {
        const existing = current.find((image) => image.propAssetKey === proposal.propAssetKey);
        if (!requestedKeys.has(proposal.propAssetKey) || existing?.status === "complete" && existing.imageUrl) return existing;
        return { propAssetKey: proposal.propAssetKey, name: proposal.name, status: "failed" as const, error: message };
      }).filter((image): image is PropImageResult => Boolean(image)));
      requestedPropKeys.forEach((propAssetKey) => propImageFailureMessagesRef.current.set(propAssetKey, message));
    } finally {
      requestedPropKeys.forEach((propAssetKey) => propImageRequestKeysRef.current.delete(propAssetKey));
      const remainingRequestKeys = [...propImageRequestKeysRef.current];
      const failures = [...propImageFailureMessagesRef.current.values()];
      setPropImageRequestKeys(remainingRequestKeys);
      setPropImageStatus(remainingRequestKeys.length > 0 ? "running" : failures.length > 0 ? "failed" : "complete");
      setPropImageError(failures.length > 0 ? `${failures.length}个道具图未完成；${failures[0]}` : propImageAdviceRef.current ? `优化建议：${propImageAdviceRef.current}` : "");
    }
  }

  function openPropPrompt(propAssetKey: string) { const prompt = propImagePrompts.find((item) => item.propAssetKey === propAssetKey); if (!prompt) return; setPropPromptEditorKey(propAssetKey); setPropPromptEditorText(prompt.prompt); }
  function updatePropPrompt(propAssetKey: string, prompt: string) { const value = sanitizeProductionPrompt(prompt.trim()); if (!value) return propImagePrompts; const next = propImagePrompts.map((item) => item.propAssetKey === propAssetKey ? { ...item, prompt: value } : item); setPropImagePrompts(next); setPropAssetsApproval("draft"); return next; }
  function approvePropAssets() {
    if (propProposalApproval !== "approved" || propImageRequestKeysRef.current.size > 0) return;
    setPropAssetsApproval("approved"); setActiveStage("分镜");
  }

  function skipPropDesign() {
    if (propStatus === "running" || propImageStatus === "running") return;
    if (propStatus === "idle") { setPropStatus("complete"); setPropProposals([]); setPropError(""); }
    else setPropProposals((current) => current.map((proposal) => ({ ...proposal, selectedForProduction: false })));
    setPropProposalApproval("approved"); setPropAssetsApproval("approved"); setActiveStage("分镜");
  }

  function storyboardBasePayload() {
    return {
      script: ideaScript,
      profiles: characterProfiles,
      styleId: selectedStyleId,
      generationPreset,
      characterImages: characterImages.filter((item) => !item.stale && isGenerationStyleCompatible(item.generationPreset, generationPreset)),
      sceneProposals: sceneAssetsSkipped ? [] : sceneProposals,
      sceneImages: sceneAssetsSkipped ? [] : sceneImages.filter((item) => !item.stale && isGenerationStyleCompatible(item.generationPreset, generationPreset)),
      propProposals,
      propImages: propImages.filter((item) => !item.stale && isGenerationStyleCompatible(item.generationPreset, generationPreset)),
      segmentDurationSec: storyboardSegmentDurationSec,
      panelCount: storyboardBoardPanelCount,
    };
  }

  function updateCurrentStoryboardPanelCount(panelCount: StoryboardBoardPanelCount) {
    const normalizedPanelCount = normalizeStoryboardBoardPanelCount(panelCount, 3);
    if (normalizedPanelCount === normalizeStoryboardBoardPanelCount(storyboardBoardPanelCount, 3)) return;
    const hadBoardWork = storyboardBoardStatus !== "idle" || storyboardBoardPlans.length > 0 || storyboardBoardPrompts.length > 0 || storyboardBoards.length > 0;
    setStoryboardBoardPanelCount(normalizedPanelCount);
    setStoryboardBoardStatus("idle");
    setStoryboardAssetsApproval("draft");
    setStoryboardBoardError(hadBoardWork ? `当前项目已切换为${storyboardBoardLabel(normalizedPanelCount)}；原规格结果仍保留，但不会进入本规格的后续流程。请重新准备${normalizedPanelCount}格规划。` : "");
    markVideoPromptsStale();
  }

  async function requestStoryboardSegments(isRepair = false): Promise<{ ok: boolean; count: number; error?: string }> {
    if (!ideaScript || propAssetsApproval !== "approved" || storyboardStatus === "running") return { ok: false, count: 0, error: storyboardStatus === "running" ? "文字分镜任务正在执行。" : "文字分镜前置内容尚未准备好。" };
    const requestedDurationSec = storyboardSegmentDurationSec;
    setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "user", kind: "action", text: isRepair ? `修复文字分镜并写入：每段 ${requestedDurationSec} 秒` : `提交文字分镜：每段 ${requestedDurationSec} 秒` })]);
    setStoryboardStatus("running"); setStoryboardError(""); setStoryboardWarnings([]); setStoryboardApproval("draft");
    try {
      const body = await postWorkflowRequest<{ segments?: StoryboardSegment[]; warnings?: string[]; error?: string; complete?: boolean; outline?: unknown; validationIssues?: string[] }>("/api/storyboards/segments", { ...storyboardBasePayload(), ...(isRepair ? { repairOnly: true, returnedDraft: storyboardRejectedDraft || JSON.stringify({ segments: storyboardSegments }) } : {}) }, isRepair ? "修复文字分镜" : "文字分镜");
      if (!Array.isArray(body.segments)) throw new Error(body.error || "文字分镜没有完成。");
      setStoryboardSegments(body.segments); setStoryboardWarnings(Array.isArray(body.warnings) ? body.warnings : []); setStoryboardStatus(body.complete === false ? "failed" : "complete"); setStoryboardError(body.error || ""); setStoryboardRejectedDraft(JSON.stringify({ segments: body.segments, outline: body.outline })); setStoryboardRejectedIssues(body.validationIssues || []);
      setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "assistant", kind: "event", text: body.complete === false ? `已保存 ${body.segments!.length} 段文字分镜，待处理：${body.error || "请查看制作任务"}` : `文字分镜已完成：按每段 ${requestedDurationSec} 秒生成 ${body.segments!.length} 段，等待确认。` })]);
      const changedKeys = body.segments.filter(segment => JSON.stringify(segment) !== JSON.stringify(storyboardSegments.find(old => old.segmentKey === segment.segmentKey))).map(segment => segment.segmentKey);
      setStoryboardBoardPlans(current => current.map(item => changedKeys.includes(item.segmentKey) ? { ...item, stale: true } : item));
      setStoryboardBoardPrompts(current => current.map(item => changedKeys.includes(item.segmentKey) ? { ...item, stale: true } : item));
      updateStoryboardBoards(current => current.map(item => changedKeys.includes(item.segmentKey) ? { ...item, stale: true } : item));
      setStoryboardAssetsApproval("draft"); markVideoPromptsStale(changedKeys);
      return { ok: body.complete !== false, count: body.segments.length, error: body.error };
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return { ok: false, count: 0 };
      const message = caught instanceof Error ? caught.message : "文字分镜没有完成。";
      setStoryboardStatus("failed"); setStoryboardError(message);
      setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "assistant", kind: "event", text: `文字分镜没有完成：${message}` })]);
      return { ok: false, count: 0, error: message };
    }
  }

  function approveStoryboardSegments() {
    if (storyboardStatus !== "complete" || storyboardSegments.length === 0) return;
    setStoryboardApproval("approved");
  }

  async function prepareStoryboardBoardPlans(recoverReturnedDraft = false) {
    if (!ideaScript || storyboardApproval !== "approved" || storyboardBoardStatus === "running") return;
    const boardLabel = storyboardBoardLabel(storyboardBoardPanelCount);
    setStoryboardBoardStatus("running"); setStoryboardBoardError(""); setStoryboardAssetsApproval("draft");
    try {
      const body = await postWorkflowRequest<{ plans?: StoryboardBoardPlan[]; prompts?: StoryboardBoardPrompt[]; validationErrors?: Array<{ segmentKey: string; message: string }>; validationWarnings?: Array<{ segmentKey: string; message: string }>; error?: string }>("/api/storyboards/board-plans", { ...storyboardBasePayload(), segments: storyboardSegments, plans: storyboardBoardPlans.filter((item) => !item.stale && usesCurrentGenerationPreset(item, generationPreset) && storyboardPlanPanelCount(item) === storyboardBoardPanelCount), prompts: storyboardBoardPrompts.filter((item) => !item.stale && usesCurrentGenerationPreset(item, generationPreset) && storyboardPromptPanelCount(item) === storyboardBoardPanelCount), ...(recoverReturnedDraft && storyboardBoardRejectedDraft ? { returnedDraft: storyboardBoardRejectedDraft } : {}) }, recoverReturnedDraft ? `${storyboardBoardPanelCount}格规划本地恢复` : `${storyboardBoardPanelCount}格规划`);
      if (!Array.isArray(body.plans) || !Array.isArray(body.prompts)) throw new Error(body.error || `${storyboardBoardPanelCount}格规划没有完成。`);
      const trackedPlans = body.plans.map((item) => ({ ...item, generationPreset: item.generationPreset || generationPreset }));
      const trackedPrompts = body.prompts.map((item) => ({ ...item, generationPreset: item.generationPreset || generationPreset }));
      setStoryboardBoardPlans(trackedPlans); setStoryboardBoardPrompts(trackedPrompts);
      setStoryboardBoardRejectedDraft(""); setStoryboardBoardRejectedIssues([]);
      updateStoryboardBoards((current) => storyboardSegments.map((segment) => current.find((item) => item.segmentKey === segment.segmentKey && storyboardBoardResultPanelCount(item) === storyboardBoardPanelCount) || { segmentKey: segment.segmentKey, title: segment.title, panelCount: storyboardBoardPanelCount, status: "idle" as const, generationPreset }));
      const complete = storyboardSegments.every((segment) => body.plans!.some((item) => item.segmentKey === segment.segmentKey) && body.prompts!.some((item) => item.segmentKey === segment.segmentKey));
      setStoryboardBoardStatus(complete ? "idle" : "failed");
      const advice = Array.isArray(body.validationWarnings) ? body.validationWarnings.map((item) => `${item.segmentKey}：${item.message}`).join("；") : "";
      setStoryboardBoardError(body.error || (complete ? (advice ? `优化建议：${advice}` : "") : `部分${storyboardBoardPanelCount}格规划尚未完成；已有合格规划已经保留，没有自动重试。`));
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      setStoryboardBoardStatus("failed");
      setStoryboardBoardError(caught instanceof WorkflowRequestError ? caught.summary : caught instanceof Error ? caught.message : `${boardLabel}规划没有完成。`);
      if (caught instanceof WorkflowRequestError) {
        if (caught.returnedDraft) setStoryboardBoardRejectedDraft(caught.returnedDraft);
        setStoryboardBoardRejectedIssues(caught.validationIssues);
      }
    }
  }

  function refreshStoryboardBoardQueueState() {
    const requestKeys = Array.from(storyboardBoardRequestKeysRef.current);
    setStoryboardBoardRequestKeys(requestKeys);
    if (requestKeys.length > 0) {
      setStoryboardBoardStatus("running");
      const failureCount = storyboardBoardFailureMessagesRef.current.size;
      setStoryboardBoardError(failureCount > 0 ? `${failureCount}段故事板图片需要处理；其余并行或排队任务仍会继续。` : "");
      return;
    }
    const currentBoards = storyboardBoardsRef.current;
    const allComplete = storyboardSegments.length > 0 && storyboardSegments.every((segment) => currentBoards.some((item) => item.segmentKey === segment.segmentKey && storyboardBoardResultPanelCount(item) === storyboardBoardPanelCount && usesCurrentGenerationPreset(item, generationPreset) && item.status === "complete" && item.imageUrl));
    if (storyboardBoardFailureMessagesRef.current.size > 0) {
      setStoryboardBoardStatus("failed");
      setStoryboardBoardError(Array.from(storyboardBoardFailureMessagesRef.current.entries()).map(([segmentKey, message]) => `${segmentKey}：${message}`).join("；"));
    } else {
      setStoryboardBoardStatus(allComplete ? "complete" : "idle");
      setStoryboardBoardError(storyboardBoardAdviceRef.current);
    }
  }

  async function generateStoryboardBoards(explicitSegmentKeys?: string[], promptOverride?: StoryboardBoardPrompt[]) {
    const planningBusy = storyboardBoardStatus === "running" && storyboardBoardRequestKeysRef.current.size === 0;
    if (!ideaScript || storyboardApproval !== "approved" || planningBusy) return;
    const requestedPanelCount = storyboardBoardPanelCount;
    const prompts = (promptOverride ?? storyboardBoardPrompts).filter((item) => !item.stale && usesCurrentGenerationPreset(item, generationPreset) && storyboardPromptPanelCount(item) === requestedPanelCount);
    const candidateKeys = explicitSegmentKeys ?? (prompts.length > 0
      ? storyboardSegments.filter((segment) => !storyboardBoardsRef.current.some((item) => item.segmentKey === segment.segmentKey && storyboardBoardResultPanelCount(item) === requestedPanelCount && usesCurrentGenerationPreset(item, generationPreset) && item.status === "complete" && !item.stale && item.imageUrl)).map((segment) => segment.segmentKey)
      : storyboardSegments.map((segment) => segment.segmentKey));
    const validSegmentKeys = new Set(storyboardSegments.map((segment) => segment.segmentKey));
    const requestedSegmentKeys = Array.from(new Set(candidateKeys)).filter((segmentKey) => validSegmentKeys.has(segmentKey) && !storyboardBoardRequestKeysRef.current.has(segmentKey));
    if (requestedSegmentKeys.length === 0) return;
    setStoryboardBoardStatus("running"); setStoryboardBoardError(""); setStoryboardAssetsApproval("draft");
    markVideoPromptsStale(requestedSegmentKeys);
    updateStoryboardBoards((current) => {
      const next = [...current];
      for (const segmentKey of requestedSegmentKeys) {
        const segment = storyboardSegments.find((item) => item.segmentKey === segmentKey)!;
        const index = next.findIndex((item) => item.segmentKey === segmentKey && storyboardBoardResultPanelCount(item) === requestedPanelCount && usesCurrentGenerationPreset(item, generationPreset));
        const existing = index >= 0 ? next[index] : undefined;
        const running: StoryboardBoardResult = { ...(existing || { segmentKey, title: segment.title }), panelCount: requestedPanelCount, generationPreset, status: "running", queueState: "queued", error: undefined };
        if (index >= 0) next[index] = running; else next.push(running);
      }
      return next;
    });
    const payload = { ...storyboardBasePayload(), panelCount: requestedPanelCount, segments: storyboardSegments, plans: storyboardBoardPlans.filter((item) => !item.stale && usesCurrentGenerationPreset(item, generationPreset) && storyboardPlanPanelCount(item) === requestedPanelCount), prompts };
    const projectId = activeProjectIdRef.current;
    requestedSegmentKeys.forEach(key => storyboardBoardRequestKeysRef.current.add(key));
    refreshStoryboardBoardQueueState();
    try {
      const body = await postWorkflowRequest<{ boards?: StoryboardBoardResult[]; error?: string }>("/api/storyboards/boards", { ...payload, requestedSegmentKeys }, "故事板图片");
      if (activeProjectIdRef.current !== projectId) return;
      for (const key of requestedSegmentKeys) {
        const item = body.boards?.find(board => board.segmentKey === key);
        if (item?.status === "complete") storyboardBoardFailureMessagesRef.current.delete(key);
        else storyboardBoardFailureMessagesRef.current.set(key, item?.error || body.error || "本段图片尚未完成，请查看制作任务。");
      }
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError || activeProjectIdRef.current !== projectId) return;
      const message = caught instanceof Error ? caught.message : "请查看制作任务。";
      requestedSegmentKeys.forEach(key => storyboardBoardFailureMessagesRef.current.set(key, message));
      updateStoryboardBoards(current => current.map(item => requestedSegmentKeys.includes(item.segmentKey) ? { ...item, status: item.imageUrl ? "complete" : "failed", error: message } : item));
    } finally {
      if (activeProjectIdRef.current === projectId) { requestedSegmentKeys.forEach(key => storyboardBoardRequestKeysRef.current.delete(key)); refreshStoryboardBoardQueueState(); }
    }
  }

  function openStoryboardPrompt(segmentKey: string) { const prompt = storyboardBoardPrompts.find((item) => item.segmentKey === segmentKey); if (!prompt) return; setStoryboardPromptEditorKey(segmentKey); setStoryboardPromptEditorText(prompt.prompt); }
  function openStoryboardText(segmentKey: string) { const segment = storyboardSegments.find((item) => item.segmentKey === segmentKey); if (!segment) return; setStoryboardTextEditorKey(segmentKey); setStoryboardTextEditorText(segment.storyboardText); }
  function updateStoryboardText(segmentKey: string, storyboardText: string) {
    const value = storyboardText.trim();
    if (!value) return;
    setStoryboardSegments((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, storyboardText: value } : item));
    setStoryboardApproval("draft");
    setStoryboardAssetsApproval("draft");
    setStoryboardBoardPlans(current => current.map(item => item.segmentKey === segmentKey ? { ...item, stale: true } : item));
    setStoryboardBoardPrompts(current => current.map(item => item.segmentKey === segmentKey ? { ...item, stale: true } : item));
    updateStoryboardBoards(current => current.map(item => item.segmentKey === segmentKey ? { ...item, stale: true, approval: "draft" } : item));
    markVideoPromptsStale([segmentKey]);
  }
  function updateStoryboardPrompt(segmentKey: string, prompt: string) { const value = sanitizeProductionPrompt(prompt.trim()); if (!value) return storyboardBoardPrompts; const next = storyboardBoardPrompts.map((item) => item.segmentKey === segmentKey ? { ...item, prompt: value } : item); setStoryboardBoardPrompts(next); setStoryboardAssetsApproval("draft"); markVideoPromptsStale([segmentKey]); return next; }
  function selectStoryboardCandidate(segmentKey: string, imageUrl: string) { const next = updateStoryboardBoards((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, status: "complete", imageUrl } : item)); storyboardBoardFailureMessagesRef.current.delete(segmentKey); setStoryboardBoardStatus(storyboardSegments.every((segment) => next.some((item) => item.segmentKey === segment.segmentKey && item.status === "complete" && item.imageUrl)) ? "complete" : "idle"); markVideoPromptsStale([segmentKey]); }
  function approveStoryboardAssets() {
    const plansReady = storyboardSegments.length > 0 && storyboardSegments.every((segment) => storyboardBoardPlans.some((item) => !item.stale && item.segmentKey === segment.segmentKey && storyboardPlanPanelCount(item) === storyboardBoardPanelCount) && storyboardBoardPrompts.some((item) => !item.stale && item.segmentKey === segment.segmentKey && storyboardPromptPanelCount(item) === storyboardBoardPanelCount));
    if (!plansReady || storyboardBoardStatus === "running") return;
    setStoryboardBoardPlans(current => current.map(item => !item.stale ? { ...item, approval: "approved" } : item));
    updateStoryboardBoards(current => current.map(item => item.status === "complete" && !item.stale ? { ...item, approval: "approved" } : item));
    setStoryboardAssetsApproval("approved"); setActiveStage("视频");
  }

  function markVideoPromptsStale(segmentKeys?: string[]) {
    setVideoPrompts((current) => current.map((item) => !segmentKeys || segmentKeys.includes(item.segmentKey) ? { ...item, status: "stale", approval: "draft" } : item));
    setVideoPromptsApproval("draft");
  }

  function videoPromptBasePayload() {
    return { ...storyboardBasePayload(), segments: storyboardSegments, plans: storyboardBoardPlans.filter((item) => !item.stale && storyboardPlanPanelCount(item) === storyboardBoardPanelCount), boards: storyboardBoards.filter((item) => !item.stale && storyboardBoardResultPanelCount(item) === storyboardBoardPanelCount && isGenerationStyleCompatible(item.generationPreset, generationPreset)) };
  }

  function directVideoPromptSource(script: IdeaScript) {
    const sceneText = script.scenes.map((scene, index) => {
      const blocks = Array.isArray(scene.blocks) && scene.blocks.length
        ? scene.blocks.map((block) => [block.type, block.speaker, block.delivery, block.text].filter(Boolean).join("：")).join("\n")
        : [...scene.beats, ...scene.dialogue.map((line) => `${line.speaker}：${line.line}`)].join("\n");
      return `场景${index + 1}｜${scene.location}｜${humanReadableSceneTime(scene.time)}\n${scene.summary}\n${blocks}`;
    }).join("\n\n");
    return [
      `请把以下已确认的${creativeDirectionLabel(creativeDirection)}脚本整理成一条可直接提交视频模型的完整中文视频提示词。`,
      `目标时长：${script.durationSec}秒`,
      `画幅：${script.ratio}`,
      `语言：${script.language}`,
      `标题：${script.title}`,
      `核心表达：${script.logline}`,
      sceneText,
      `结尾：${script.endingHook}`,
    ].join("\n\n").slice(0, 9_800);
  }

  function directVideoSegment(script: IdeaScript): StoryboardSegment {
    const scene = script.scenes[0];
    const storyboardText = script.scenes.map((item) => [item.summary, ...item.beats, ...(item.blocks || []).map((block) => block.text)].filter(Boolean).join("；")).join("；");
    return {
      segmentKey: "SEG001",
      sceneKey: scene?.id || "DIRECT",
      order: 1,
      title: script.title,
      durationSec: script.durationSec,
      characters: [],
      sceneViewKey: "text-only",
      propStateKey: "none",
      storyboardText: storyboardText || script.logline,
      transition: script.endingHook,
      actionEvidenceIds: [],
      dialogueEvidenceIds: [],
      soundCueIds: [],
      referenceAssetIds: [],
    };
  }

  async function generateDirectVideo() {
    if (!ideaScript || directVideoBusy) return;
    if (ideaScript.workType !== "single" || ideaScript.durationSec > 15) {
      setDirectVideoError("直接生成适用于15秒以内的单条短视频；更长作品仍需先拆分镜头。 ");
      return;
    }
    setDirectVideoBusy(true);
    setDirectVideoError("");
    try {
      const promptResponse = await fetch("/api/free-canvas/optimize-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video", prompt: directVideoPromptSource(ideaScript), references: [] }),
      });
      const promptBody = await readApiJson<{ optimizedPrompt?: string; error?: string }>(promptResponse, "直接生成视频提示词");
      const prompt = String(promptBody.optimizedPrompt || "").trim();
      if (!promptResponse.ok || !prompt) throw new Error(promptBody.error || "视频提示词没有生成。 ");

      const segment = directVideoSegment(ideaScript);
      const promptResult: VideoPromptResult = {
        segmentKey: segment.segmentKey,
        title: segment.title,
        durationSec: segment.durationSec,
        status: "complete",
        prompt,
        referenceLabels: [],
        referenceImageUrls: [],
        generationPreset,
      };
      const directSettings = materializeH3SubmissionSettings(normalizeH3GenerationSettings({ ...h3GenerationSettings, mode: "text" }));
      const transcript = [
        ...agentTranscript,
        createTranscriptEntry({ role: "user", kind: "action", text: "跳过剩余资产环节，直接生成视频" }),
        createTranscriptEntry({ role: "assistant", kind: "event", text: `视频提示词已保存，准备提交到${videoEngineLabel(directSettings.engine)}。` }),
      ];
      const directState: CreativeSessionState = {
        ...creativeStateSnapshot(),
        activeStage: "视频",
        agentTranscript: compactTranscriptOptions(transcript),
        characterStatus: characterStatus === "failed" ? "failed" : "complete",
        characterApproval: "approved",
        characterAssetsApproval: "approved",
        sceneProposalApproval: "approved",
        sceneMainApproval: "approved",
        sceneAssetsApproval: "approved",
        sceneAssetsSkipped: sceneProposals.length === 0,
        propStatus: propStatus === "failed" ? "failed" : "complete",
        propProposalApproval: "approved",
        propAssetsApproval: "approved",
        storyboardStatus: "complete",
        storyboardSegments: [segment],
        storyboardWarnings: [],
        storyboardError: "",
        storyboardApproval: "approved",
        storyboardBoardStatus: "idle",
        storyboardBoardPlans: [],
        storyboardBoardPrompts: [],
        storyboardBoards: [],
        storyboardBoardError: "",
        storyboardAssetsApproval: "approved",
        videoPromptStatus: "complete",
        videoPrompts: [promptResult],
        videoPromptError: "",
        videoPromptsApproval: "approved",
        h3GenerationSettings: directSettings,
        shotVideoTasks: [],
        shotContinuityModes: {},
        shotVideosApproval: "draft",
      };
      await persistCurrentProject(directState);
      applyCreativeState(directState);

      if (!usesCloudVideo(directSettings)) {
      const statusResponse = await fetch("/api/h3/status", { cache: "no-store" });
      const statusBody = await readApiJson<{ health?: H3Health; localGpu?: LocalGpuStatus; error?: string }>(statusResponse, "PRISM H3连接");
      const online = statusResponse.ok && Boolean(statusBody.health && ["ok", "queue_busy"].includes(statusBody.health.status));
      if (!online) {
        setH3Connection({ status: "offline", health: statusBody.health, localGpu: statusBody.localGpu, error: statusBody.error || statusBody.health?.message || "视频提示词已保存；启动PRISM H3后即可提交。" });
        setDirectVideoError("视频提示词已经生成并保存；本机PRISM H3当前未连接，已停在视频生成页等待启动。 ");
        return;
      }

      setH3Connection({ status: "online", health: statusBody.health, localGpu: statusBody.localGpu, error: "" });
      }
      const requestId = window.crypto.randomUUID();
      const submittingTask: ShotVideoTask = { segmentKey: segment.segmentKey, status: "submitting", submissionIntent: { requestId, continuityMode: 'independent', settings: directSettings, generationPreset, queuedAt: new Date().toISOString() }, generationPreset, updatedAt: new Date().toISOString() };
      setShotVideoTasks([submittingTask]);
      await persistCurrentProject({ ...directState, shotVideoTasks: [submittingTask] });
      const generationResponse = await fetch("/api/videos/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, requestId, segmentKey: segment.segmentKey, continuityMode: "independent", generationPreset, aspectRatio: generationPreset.aspectRatio, ...h3RequestSettings(directSettings), mode: "text" }),
      });
      const generationBody = await readApiJson<{ task?: H3TaskResponse; error?: string }>(generationResponse, "直接提交PRISM H3视频");
      if (!generationResponse.ok || !generationBody.task?.externalTaskId) throw new Error(generationBody.error || "PRISM H3没有返回任务编号。 ");
      const task = generationBody.task;
      setShotVideoTasks([{
        segmentKey: segment.segmentKey,
        status: task.status === "completed" ? "awaiting_review" : task.status,
        externalTaskId: task.externalTaskId,
        outputPaths: task.outputPaths || [],
        parameters: task.parameters || {},
        error: task.errorMessage,
        generationPreset,
        updatedAt: task.updatedAt || new Date().toISOString(),
      }]);
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      const message = caught instanceof Error ? caught.message : "直接生成视频没有完成。 ";
      setDirectVideoError(`${message} 已有提示词和结果会保留，系统没有自动重试。`);
      setShotVideoTasks((current) => current.map((task) => task.status === "submitting" ? { ...task, status: "failed", error: message, updatedAt: new Date().toISOString() } : task));
    } finally {
      setDirectVideoBusy(false);
    }
  }

  async function generateVideoPrompts(explicitSegmentKeys?: string[], revisionRequest?: string): Promise<VideoPromptResult[]> {
    if (!ideaScript || videoPromptStatus === "running") return [];
    const requestedSegmentKeys = explicitSegmentKeys ?? storyboardSegments.filter(segment => {
      const current = videoPrompts.find(item => item.segmentKey === segment.segmentKey);
      return !current?.prompt.trim() || current.status === "stale" || current.status === "failed";
    }).map(segment => segment.segmentKey);
    if (!requestedSegmentKeys.length) return [];
    try {
      await persistCurrentProject();
      setVideoPromptStatus("running"); setVideoPromptError(""); setVideoPromptsApproval("draft");
      const body = await postWorkflowRequest<{ prompts?: VideoPromptResult[]; error?: string }>("/api/videos/prompts", { ...videoPromptBasePayload(), requestedSegmentKeys, revisionRequest, currentDrafts: revisionRequest ? videoPrompts.filter(item => requestedSegmentKeys.includes(item.segmentKey)).map(item => ({ segmentKey: item.segmentKey, prompt: item.prompt, plan: item.plan })) : undefined }, "视频提示词", false);
      if (!Array.isArray(body.prompts)) throw new Error(body.error || "视频提示词没有返回草稿。");
      setVideoPrompts(current => mergeByStableKey(current, body.prompts!.map(prompt => ({ ...prompt, approval: "draft" }))));
      const all = new Map((productionStateRef.current?.videoPrompts || videoPrompts).map(item => [item.segmentKey, item]));
      body.prompts.forEach(item => all.set(item.segmentKey, item));
      setVideoPromptStatus(areAllVideoPromptsComplete(storyboardSegments, [...all.values()]) ? "complete" : "failed");
      setVideoPromptError(body.error || "");
      return body.prompts;
    } catch (error) {
      if (error instanceof CreativeSessionSynchronizedError) return [];
      setVideoPromptStatus("failed"); setVideoPromptError(error instanceof Error ? error.message : "任务未完成，请查看制作任务。"); return [];
    }
  }

  async function repairVideoPrompts(segmentKeys: string[]): Promise<void> {
    const requestedKeys = [...new Set(segmentKeys)];
    const repairable = requestedKeys.map((segmentKey) => videoPrompts.find((item) => item.segmentKey === segmentKey)).filter((item): item is VideoPromptResult => Boolean(item?.status === "needs_revision" && item.prompt?.trim()));
    if (videoPromptStatus === "running" || videoPromptRepairInFlight.current) return;
    if (repairable.length === 0) { setVideoPromptError("当前所选分段没有可修复正文，请先生成该段提示词。"); return; }
    videoPromptRepairInFlight.current = true;
    try {
    try {
      await persistCurrentProject();
    } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
      setVideoPromptError(caught instanceof Error ? caught.message : "项目保存没有完成，问题段落未提交修复。");
      return;
    }
    setVideoPromptStatus("running");
    setVideoPromptError("");
    setVideoPromptsApproval("draft");
    const finalByKey = new Map(videoPrompts.map((item) => [item.segmentKey, item]));
    const requestErrors: string[] = [];
    for (const current of repairable) {
      finalByKey.set(current.segmentKey, { ...current, status: "running" });
      setVideoPrompts(storyboardSegments.map((segment) => finalByKey.get(segment.segmentKey)).filter((item): item is VideoPromptResult => Boolean(item)));
      try {
        const body = await postWorkflowRequest<{ prompt?: VideoPromptResult; error?: string }>("/api/videos/prompts/repair", {
          ...videoPromptBasePayload(),
          segmentKey: current.segmentKey,
          draft: current.plan,
          currentPrompt: videoPromptEditorKeyRef.current === current.segmentKey ? videoPromptEditorText : current.prompt,
          validationCodes: current.validationCodes,
          validationIssues: current.validationIssues,
        }, `修复${current.segmentKey}视频提示词`, false);
        if (!body.prompt) throw new Error(body.error || "Agent没有返回可读取的修复草稿。");
        const repaired = { ...body.prompt, generationPreset: body.prompt.generationPreset || generationPreset };
        finalByKey.set(current.segmentKey, repaired);
        if (videoPromptEditorKeyRef.current === current.segmentKey) setVideoPromptEditorText(repaired.prompt);
      } catch (caught) {
      if (caught instanceof CreativeSessionSynchronizedError) return;
        const message = caught instanceof Error ? caught.message : "本段修复没有完成。";
        finalByKey.set(current.segmentKey, { ...current, error: `${message} 当前草稿已保留。` });
        requestErrors.push(`${current.segmentKey}：${message}`);
      }
      setVideoPrompts(storyboardSegments.map((segment) => finalByKey.get(segment.segmentKey)).filter((item): item is VideoPromptResult => Boolean(item)));
    }
    const next = storyboardSegments.map((segment) => finalByKey.get(segment.segmentKey)).filter((item): item is VideoPromptResult => Boolean(item));
    const complete = areAllVideoPromptsComplete(storyboardSegments, next);
    setVideoPromptStatus(complete ? "complete" : "failed");
    setVideoPromptError(complete ? "" : requestErrors.join("；") || currentVideoPromptProblemSummary(storyboardSegments, next));
    } finally { videoPromptRepairInFlight.current = false; }
  }

  async function repairVideoPrompt(segmentKey: string): Promise<void> {
    await repairVideoPrompts([segmentKey]);
  }

  function openVideoPromptResult(prompt: VideoPromptResult) { if (!prompt.prompt.trim()) return; videoPromptEditorKeyRef.current = prompt.segmentKey; setVideoPromptEditorKey(prompt.segmentKey); setVideoPromptEditorText(prompt.prompt); }
  function openVideoPrompt(segmentKey: string) { const prompt = videoPrompts.find((item) => item.segmentKey === segmentKey); if (prompt) openVideoPromptResult(prompt); }
  function updatedVideoPromptsWithDraft(segmentKey: string, prompt: string): VideoPromptResult[] | null { const value = sanitizeProductionPrompt(prompt.trim()); if (!value) return null; return videoPrompts.map((item) => item.segmentKey === segmentKey ? { ...confirmVideoPromptDraft(item, value), approval: "draft" as const } : item); }
  function updateVideoPrompt(segmentKey: string, prompt: string) { const updatedPrompts = updatedVideoPromptsWithDraft(segmentKey, prompt); if (!updatedPrompts) return; const complete = areAllVideoPromptsComplete(storyboardSegments, updatedPrompts); setVideoPrompts(updatedPrompts); setVideoPromptStatus(complete ? "complete" : "failed"); setVideoPromptError(complete ? "" : currentVideoPromptProblemSummary(storyboardSegments, updatedPrompts)); setVideoPromptsApproval("draft"); }
  function confirmCurrentVideoPrompt(segmentKey: string, value: string) {
    const prompt = sanitizeProductionPrompt(value.trim());
    if (!prompt || videoPromptStatus === "running") return;
    const next = videoPrompts.map(item => item.segmentKey === segmentKey ? confirmVideoPromptDraft(item, prompt) : item);
    const complete = areAllVideoPromptsComplete(storyboardSegments, next);
    setVideoPrompts(next);
    setVideoPromptStatus(complete ? "complete" : "failed");
    setVideoPromptError(complete ? "" : currentVideoPromptProblemSummary(storyboardSegments, next));
    setVideoPromptsApproval("draft");
    videoPromptEditorKeyRef.current = "";
    setVideoPromptEditorKey("");
    setVideoPromptEditorText("");
  }
  function continueWithReadyVideoPrompts() {
    const next = approveReadyVideoPrompts(videoPrompts, storyboardSegments.map(item => item.segmentKey));
    if (!next.some(item => isReadyVideoPrompt(item) && item.approval === "approved")) return;
    setVideoPrompts(next);
    setVideoPromptsApproval(areAllVideoPromptsComplete(storyboardSegments, next) ? "approved" : "draft");
    setActiveStage("视频");
  }
  function closeVideoPromptEditor() {
    const current = videoPrompts.find((item) => item.segmentKey === videoPromptEditorKey);
    const edited = sanitizeProductionPrompt(videoPromptEditorText.trim());
    if (current && current.status !== "running" && edited && edited !== current.prompt) updateVideoPrompt(videoPromptEditorKey, edited);
    videoPromptEditorKeyRef.current = "";
    setVideoPromptEditorKey("");
    setVideoPromptEditorText("");
  }
  async function regenerateVideoPromptInEditor(segmentKey: string) {
    const regenerated = await generateVideoPrompts([segmentKey]);
    const next = regenerated.find((item) => item.segmentKey === segmentKey && item.prompt.trim());
    if (next && videoPromptEditorKeyRef.current === segmentKey) setVideoPromptEditorText(next.prompt);
  }
  async function saveVideoPromptAndGenerate(segmentKey: string, prompt: string) {
    const drafts = updatedVideoPromptsWithDraft(segmentKey, prompt);
    if (!drafts) return;
    const updatedPrompts = drafts.map(item => item.segmentKey === segmentKey ? { ...item, approval: "approved" as const, stale: false } : item);
    const complete = areAllVideoPromptsComplete(storyboardSegments, updatedPrompts);
    setVideoPrompts(updatedPrompts);
    setVideoPromptStatus(complete ? "complete" : "failed");
    setVideoPromptError(complete ? "" : currentVideoPromptProblemSummary(storyboardSegments, updatedPrompts));
    setVideoPromptsApproval("draft");
    videoPromptEditorKeyRef.current = "";
    setVideoPromptEditorKey("");
    setVideoPromptEditorText("");
    await submitShotVideo(segmentKey, false, undefined, false, { prompts: updatedPrompts, approval: "draft" });
  }
  function approveVideoPrompts() { if (!storyboardSegments.every((segment) => videoPrompts.some((item) => item.segmentKey === segment.segmentKey && item.status === "complete" && !item.stale && item.prompt.trim()))) return; setVideoPrompts(current => current.map(item => item.status === "complete" && !item.stale ? { ...item, approval: "approved" } : item)); setVideoPromptsApproval("approved"); }

  function updateH3GenerationSettings(patch: Partial<H3GenerationSettings>) {
    setH3GenerationSettings((current) => normalizeH3GenerationSettings({ ...current, ...patch }));
    setShotVideosApproval("draft");
  }

  async function refreshH3Status(background = false) {
    if (!background) setH3Connection((current) => ({ ...current, status: "checking", error: "" }));
    try {
      const response = await fetch("/api/h3/status", { cache: "no-store" });
      const body = await readApiJson<{ health?: H3Health; localGpu?: LocalGpuStatus; error?: string }>(response, "PRISM H3连接");
      if (!response.ok || !body.health) throw new Error(body.error || "无法读取PRISM H3状态。");
      const online = body.health.status === "ok" || body.health.status === "queue_busy";
      if (background && h3ConnectInFlight.current && !online) return;
      setH3Connection({ status: online ? "online" : "offline", health: body.health, localGpu: body.localGpu, error: online ? "" : body.health.message });
    } catch (caught) {
      if (background && h3ConnectInFlight.current) return;
      setH3Connection({ status: "offline", error: caught instanceof Error ? caught.message : "无法连接PRISM H3。" });
    }
  }

  async function startPrismH3() {
    if (h3ConnectInFlight.current) return;
    h3ConnectInFlight.current = true;
    setH3Connection((current) => ({ ...current, status: "starting", error: "" }));
    try {
      const response = await fetch("/api/h3/start", { method: "POST" });
      const body = await readApiJson<{ connected?: boolean; bridgeConnected?: boolean; launched?: boolean; pending?: boolean; health?: H3Health; message?: string; error?: string }>(response, "启动并连接PRISM H3");
      if (!response.ok || !body.launched) throw new Error(body.error || "PRISM H3没有成功启动。");
      const online = body.connected === true || body.health?.status === "ok" || body.health?.status === "queue_busy";
      setH3Connection({
        status: online ? "online" : "offline",
        health: body.health,
        error: online ? "" : body.message || body.health?.message || "PRISM H3正在启动，客户端会继续自动连接。",
      });
    } catch (caught) {
      setH3Connection({ status: "offline", error: caught instanceof Error ? caught.message : "PRISM H3没有成功启动。" });
    } finally {
      h3ConnectInFlight.current = false;
    }
  }

  async function findRecoverableH3Job(segmentKey: string, activeOnly = false) {
    const response = await fetch("/api/h3/jobs", { cache: "no-store" });
    const body = await readApiJson<{ jobs?: H3RecoverableJob[]; error?: string }>(response, "读取视频任务队列");
    if (!response.ok) throw new Error(body.error || "无法读取视频任务队列。");
    return (body.jobs || []).find((job) => job.segmentKey === segmentKey && (!activeOnly || job.status === "queued" || job.status === "running"));
  }

  async function submitShotVideo(segmentKey: string, fromBatch = false, queuedIntent?: ShotVideoSubmissionIntent, dispatchWaiting = false, promptOverride?: { prompts: VideoPromptResult[]; approval: ScriptApproval }) {
    if (!fromBatch && shotVideoBatchKeys.current.has(segmentKey)) return false;
    const existing = shotVideoTasksRef.current.find((task) => task.segmentKey === segmentKey);
    const alreadyActive = ["waiting_dependency", "submitting", "queued", "running"].includes(existing?.status || "");
    const promptApproval = promptOverride?.approval ?? videoPromptsApproval;
    const availablePrompts = promptOverride?.prompts ?? videoPrompts;
    const approvedPrompt = availablePrompts.find((item) => item.segmentKey === segmentKey && item.status === "complete" && !item.stale);
    if (!approvedPrompt || (promptApproval !== "approved" && approvedPrompt.approval !== "approved") || (alreadyActive && !(dispatchWaiting && existing?.status === "waiting_dependency"))) return false;
    if (!queuedIntent && !usesCurrentGenerationPreset(approvedPrompt, generationPreset)) {
      setVideoPromptError(`当前镜头仍使用预设 v${approvedPrompt?.generationPreset?.version || 1}；请先按右上角预设 v${generationPreset.version} 重新生成并确认该段提示词。`);
      setActiveStage("视频");
      return false;
    }
    const now = new Date().toISOString();
    const segmentIndex = storyboardSegments.findIndex((segment) => segment.segmentKey === segmentKey);
    const continuityMode = queuedIntent?.continuityMode ?? (usesCloudVideo(h3GenerationSettings) ? "independent" : shotContinuityModes[segmentKey] ?? "independent");
    const sourceSegmentKey = queuedIntent?.sourceSegmentKey ?? (continuityMode === "continue" ? storyboardSegments[segmentIndex - 1]?.segmentKey : undefined);
    const submissionIntent: ShotVideoSubmissionIntent = queuedIntent ?? { requestId: window.crypto.randomUUID(), continuityMode, sourceSegmentKey, settings: materializeH3SubmissionSettings(h3GenerationSettings), generationPreset, queuedAt: now };
    const submissionPreset = submissionIntent.generationPreset || existing?.generationPreset || generationPreset;
    const sourceTask = sourceSegmentKey ? shotVideoTasksRef.current.find((task) => task.segmentKey === sourceSegmentKey) : undefined;
    const sourceContinuity = sourceTask?.parameters?.continuity as { engine?: string; chainId?: string; segmentIndex?: number } | undefined;
    const sourceReady = continuityMode !== "continue" || (sourceTask?.status === "awaiting_review" && sourceContinuity?.engine === "herrgotts" && Boolean(sourceContinuity.chainId));
    setShotVideosApproval("draft");
    setPostProduction((current) => ({ ...current, roughCut: current.roughCut.status === "complete" ? { ...current.roughCut, status: "stale" } : current.roughCut, roughCutApproval: "draft", agentReply: "镜头已重新提交，已有粗剪仍保留但已标记为需要更新。" }));
    if (!sourceReady) {
      const waitingTasks = updateShotVideoTasks((current) => [...current.filter((task) => task.segmentKey !== segmentKey), {
        segmentKey, status: "waiting_dependency", submissionIntent, generationPreset: submissionPreset, error: "", updatedAt: now,
      }]);
      await persistCurrentProject({ ...creativeStateSnapshot(), ...(promptOverride ? { videoPrompts: availablePrompts, videoPromptsApproval: promptApproval } : {}), shotVideoTasks: waitingTasks });
      return true;
    }
    const submittingTasks = updateShotVideoTasks((current) => [...current.filter((task) => task.segmentKey !== segmentKey), {
      segmentKey, status: "submitting", submissionIntent, generationPreset: submissionPreset, error: "", updatedAt: now,
    }]);
    try {
      // Persist the completed source task and this exact queued intent before the service reloads the project state.
      await persistCurrentProject({ ...creativeStateSnapshot(), ...(promptOverride ? { videoPrompts: availablePrompts, videoPromptsApproval: promptApproval } : {}), shotVideoTasks: submittingTasks });
      const body = await postWorkflowRequest<{ task?: H3TaskResponse; error?: string }>("/api/videos/generations", { projectId: activeProjectId, requestId: submissionIntent.requestId || window.crypto.randomUUID(), segmentKey, continuityMode, sourceSegmentKey, generationPreset: submissionPreset, aspectRatio: submissionPreset.aspectRatio, ...h3RequestSettings(submissionIntent.settings) }, `提交${videoEngineLabel(submissionIntent.settings.engine)}视频`, false);
      if (!body.task?.externalTaskId) throw new Error(body.error || "视频接口没有返回任务编号。");
      const task = body.task;
      if (!usesCloudVideo(submissionIntent.settings)) setH3Connection((current) => ({ ...current, status: "online", error: "" }));
      updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? {
        segmentKey,
        status: task.status === "completed" ? "awaiting_review" : task.status,
        externalTaskId: task.externalTaskId,
        outputPaths: task.outputPaths || [],
        parameters: task.parameters || {},
        submissionIntent: undefined,
        error: task.errorMessage,
        generationPreset: submissionPreset,
        updatedAt: task.updatedAt || new Date().toISOString(),
      } : item));
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "PRISM H3视频提交失败。";
      if (usesCloudVideo(submissionIntent.settings)) {
        try {
          const response = await fetch('/api/videos/jobs', { cache: 'no-store' });
          const recovered = await response.json() as { jobs?: Array<H3TaskResponse & { requestId?: string }> };
          const task = recovered.jobs?.find(item => item.requestId === submissionIntent.requestId);
          if (task?.externalTaskId) {
            updateShotVideoTasks(current => current.map(item => item.segmentKey === segmentKey ? { ...item, status: task.status === 'completed' ? 'awaiting_review' : task.status, externalTaskId: task.externalTaskId, outputPaths: task.outputPaths || [], parameters: task.parameters, error: task.errorMessage, submissionIntent: undefined, updatedAt: task.updatedAt || now } : item));
            return true;
          }
        } catch { /* The durable request ID remains available for recovery. */ }
        updateShotVideoTasks(current => current.map(item => item.segmentKey === segmentKey ? { ...item, status: 'failed', error: message, updatedAt: now } : item));
        return false;
      }
      try {
        const recovered = await findRecoverableH3Job(segmentKey, true);
        if (recovered) {
          setH3Connection((current) => current.status === "online" && !current.error ? current : { ...current, status: "online", error: "" });
          updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, status: recovered.status, externalTaskId: recovered.externalTaskId, submissionIntent: undefined, error: "", updatedAt: new Date().toISOString() } : item));
          return true;
        }
      } catch {
        // Recovery is read-only and must never turn into a hidden resubmission.
      }
      updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, status: "failed", error: message, updatedAt: new Date().toISOString() } : item));
      return false;
    }
  }

  async function submitUnstartedShotVideos(limit?: number) {
    if (shotVideoBatchKeys.current.size > 0) return;
    const unstarted = storyboardSegments.filter((segment) => videoPrompts.some(item => item.segmentKey === segment.segmentKey && isReadyVideoPrompt(item) && (videoPromptsApproval === "approved" || item.approval === "approved")) && !shotVideoTasks.some((task) => task.segmentKey === segment.segmentKey));
    const selected = typeof limit === "number" ? unstarted.slice(0, limit) : unstarted;
    shotVideoBatchKeys.current = new Set(selected.map((segment) => segment.segmentKey));
    setShotVideoBatchSubmitting(selected.length > 0);
    try {
      for (const segment of selected) {
        const accepted = await submitShotVideo(segment.segmentKey, true);
        shotVideoBatchKeys.current.delete(segment.segmentKey);
        if (!accepted) break;
      }
    } finally {
      shotVideoBatchKeys.current.clear();
      setShotVideoBatchSubmitting(false);
    }
  }

  async function cancelShotVideo(segmentKey: string) {
    const task = shotVideoTasksRef.current.find((item) => item.segmentKey === segmentKey);
    if (task?.status === "waiting_dependency") {
      updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, status: "cancelled", submissionIntent: undefined, error: "", updatedAt: new Date().toISOString() } : item));
      return;
    }
    if (!task?.externalTaskId || !["queued", "running"].includes(task.status)) return;
    try {
      const response = await fetch(`/api/videos/generations/${encodeURIComponent(task.externalTaskId)}/cancel`, { method: "POST" });
      const body = await readApiJson<{ cancelled?: boolean; error?: string }>(response, "取消PRISM H3任务");
      if (!response.ok || !body.cancelled) throw new Error(body.error || "PRISM H3没有确认取消任务。");
      updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, status: "cancelled", error: "", updatedAt: new Date().toISOString() } : item));
    } catch (caught) {
      updateShotVideoTasks((current) => current.map((item) => item.segmentKey === segmentKey ? { ...item, error: caught instanceof Error ? caught.message : "取消任务失败；任务状态未被改写。", updatedAt: new Date().toISOString() } : item));
    }
  }

  function approveShotVideos() {
    if (!storyboardSegments.length || !storyboardSegments.every((segment) => shotVideoTasks.some((task) => task.segmentKey === segment.segmentKey && task.status === "awaiting_review"))) return;
    setShotVideosApproval("approved");
    setPostProduction((current) => ({ ...current, view: "overview", agentReply: current.agentReply || "六个镜头已经确认。建议先生成无配乐粗剪，检查顺序、节奏和衔接。" }));
  }

  async function generateRoughCut() {
    if (shotVideosApproval !== "approved" || postProduction.roughCut.status === "running") return;
    setPostProduction((current) => ({ ...current, view: "overview", roughCutApproval: "draft", roughCut: { ...current.roughCut, status: "running", error: "" }, agentReply: "正在按SEG顺序生成本地无配乐粗剪，现有H3原声会完整保留。" }));
    try {
      const body = await postWorkflowRequest<{ roughCut?: RoughCutResult; error?: string }>("/api/postproduction/rough-cut", undefined, "生成本地粗剪");
      if (body.roughCut?.status !== "complete") throw new Error(body.error || "本地粗剪没有返回可播放文件。");
      setPostProduction((current) => ({ ...current, roughCut: body.roughCut!, agentReply: `无配乐粗剪已完成，共${body.roughCut!.clipCount || storyboardSegments.length}段。请先播放检查镜头顺序、节奏和衔接。` }));
    } catch (caught) {
      setPostProduction((current) => ({ ...current, roughCut: { ...current.roughCut, status: "failed", error: caught instanceof Error ? caught.message : "本地粗剪失败；系统没有自动重试。" }, agentReply: "粗剪没有完成，现有镜头和旧结果都已保留；系统没有自动重试。" }));
    }
  }

  function approveRoughCut() {
    if (postProduction.roughCut.status !== "complete") return;
    setPostProduction((current) => ({ ...current, roughCutApproval: "approved", view: "discussion", agentReply: "粗剪已确认。下一步请确定原声、配乐和字幕方案。" }));
  }

  function skipSoundDesign() {
    if (postProduction.roughCut.status !== "complete") return;
    setPostProduction((current) => ({
      ...current,
      roughCutApproval: "approved",
      view: "overview",
      audioMode: "native",
      subtitles: "none",
      musicPrompt: ["complete", "needs_revision"].includes(current.musicPrompt.status) ? { ...current.musicPrompt, status: "stale", error: "当前采用原声粗剪，既有配乐方案继续保留。" } : current.musicPrompt,
      musicPromptApproval: "draft",
      music: current.music.status === "complete" ? { ...current.music, status: "stale", error: "当前采用原声粗剪，既有配乐文件继续保留。" } : current.music,
      musicApproval: "draft",
      finalComposition: current.finalComposition.status === "complete" ? { ...current.finalComposition, status: "stale", error: "当前采用原声粗剪，既有精修成片继续保留。" } : current.finalComposition,
      agentReply: "粗剪已确认并作为当前成片：保留现有原声，不添加配乐或字幕，可直接播放和下载。",
    }));
    setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "user", kind: "action", text: "确认粗剪，跳过声音设计、配乐和字幕，直接使用原声粗剪" })]);
  }

  function skipMusicDesign() {
    updatePostProductionPlan({ view: "overview", audioMode: "native" });
    setPostProduction((current) => ({ ...current, agentReply: current.subtitles === "none" ? "配乐设计已跳过。当前原声粗剪可直接作为成片。" : "配乐设计已跳过，保留现有原声；字幕方案仍可单独决定。" }));
    setAgentTranscript((current) => [...current, createTranscriptEntry({ role: "user", kind: "action", text: "跳过配乐设计，保留现有原声" })]);
  }

  function updatePostProductionPlan(patch: Partial<Pick<PostProductionState, "view" | "audioMode" | "subtitles">>) {
    setPostProduction((current) => {
      const changesMusicInputs = (patch.audioMode !== undefined && patch.audioMode !== current.audioMode) || (patch.subtitles !== undefined && patch.subtitles !== current.subtitles);
      return {
        ...current, ...patch,
        musicPrompt: changesMusicInputs && ["complete", "needs_revision"].includes(current.musicPrompt.status) ? { ...current.musicPrompt, status: "stale", error: "声音或字幕方案已修改，需要手动重新生成配乐提示词。" } : current.musicPrompt,
        musicPromptApproval: changesMusicInputs ? "draft" : current.musicPromptApproval,
        music: changesMusicInputs && current.music.status === "complete" ? { ...current.music, status: "stale", error: "声音或字幕方案已修改，旧配乐仍保留但不能直接进入最终合成。" } : current.music,
        musicApproval: changesMusicInputs ? "draft" : current.musicApproval,
        finalComposition: changesMusicInputs && current.finalComposition.status === "complete" ? { ...current.finalComposition, status: "stale", error: "声音或字幕方案已修改，旧成片仍保留。" } : current.finalComposition,
      };
    });
  }

  async function generateMusicPrompt() {
    if (!ideaScript || postProduction.roughCutApproval !== "approved" || postProduction.musicPrompt.status === "running") return;
    if (!["native_with_music", "music_only"].includes(postProduction.audioMode) || !["none", "burned"].includes(postProduction.subtitles)) return;
    const targetDurationSec = postProduction.roughCut.durationSec;
    if (!targetDurationSec) return;
    setPostProduction((current) => ({ ...current, musicPromptApproval: "draft", musicPrompt: { status: "running" }, agentReply: "正在由文字Agent生成ACE-Step 1.5配乐提示词；本次不会调用音乐模型。" }));
    try {
      const body = await postWorkflowRequest<{ status?: "complete" | "needs_revision"; plan?: MusicPromptPlan; validationIssues?: string[]; validationWarnings?: string[]; repairAttempted?: boolean; error?: string }>("/api/postproduction/music-prompt", {
        projectTitle: ideaScript.title,
        logline: ideaScript.logline,
        targetDurationSec,
        audioMode: postProduction.audioMode,
        subtitles: postProduction.subtitles,
        segments: storyboardSegments.map(({ segmentKey, title, durationSec, storyboardText, transition }) => ({ segmentKey, title, durationSec, storyboardText, transition })),
      }, "生成配乐方案与提示词");
      if (!body.plan) throw new Error(body.error || "文字Agent没有返回可编辑的配乐方案。" );
      if (body.status === "needs_revision") {
        const issues = Array.isArray(body.validationIssues)
          ? body.validationIssues
          : ["Agent草稿仍有未通过项，请按提示修改后确认。"];
        setPostProduction((current) => ({ ...current, musicPrompt: { status: "needs_revision", plan: body.plan, validationIssues: issues, repairAttempted: body.repairAttempted === true, error: `Agent草稿已保留：${issues.join("；")}`, updatedAt: new Date().toISOString() }, agentReply: "文字Agent已返回草稿并完成一次自动校正，但仍有明确问题。草稿已保留，可直接修改，不必盲目重试。" }));
      } else {
        setPostProduction((current) => ({ ...current, musicPrompt: { status: "complete", plan: body.plan, validationWarnings: Array.isArray(body.validationWarnings) ? body.validationWarnings : [], repairAttempted: body.repairAttempted === true, updatedAt: new Date().toISOString() }, agentReply: "配乐方案已生成，请确认后生成音乐。" }));
      }
    } catch (caught) {
      setPostProduction((current) => ({ ...current, musicPrompt: { status: "failed", error: caught instanceof Error ? caught.message : "配乐提示词没有完成；系统没有自动重试。", updatedAt: new Date().toISOString() }, agentReply: "配乐提示词没有完成，粗剪与声音方案均已保留；系统没有自动重试。" }));
    }
  }

  function updateMusicPrompt(value: string) {
    setPostProduction((current) => {
      const creatingLocalDraft = !current.musicPrompt.plan;
      const targetDurationSec = current.roughCut.durationSec || storyboardSegments.reduce((total, segment) => total + segment.durationSec, 0) || 60;
      const sourceDurationSec = storyboardSegments.reduce((total, segment) => total + segment.durationSec, 0) || targetDurationSec;
      let cueStartSec = 0;
      const cues: MusicCue[] = storyboardSegments.map((segment, index) => {
        const cueEndSec = index === storyboardSegments.length - 1 ? targetDurationSec : Math.min(targetDurationSec, cueStartSec + segment.durationSec / sourceDurationSec * targetDurationSec);
        const cue = {
          segmentKey: segment.segmentKey,
          startSec: Number(cueStartSec.toFixed(2)),
          endSec: Number(cueEndSec.toFixed(2)),
          musicalFunction: `${segment.title}的情绪承接与推进`,
          energy: "low" as const,
          instrumentation: "钢琴、中低音弦乐与克制打击乐共同承担旋律、主题、节奏与情绪表达。",
          mixNote: "保持对白与现场声清晰，配乐位于叙事之后。",
        };
        cueStartSec = cueEndSec;
        return cue;
      });
      const fallbackPrompt = `纯器乐写实电影配乐，目标时长约${targetDurationSec.toFixed(1)}秒。钢琴、中低音弦乐与克制打击乐完整承担旋律、主题、节奏和情绪表达。整体从低能量克制铺陈开始，随剧情逐步推进，在关键情绪处短暂抬升，结尾自然收束。保留充足动态与对白空间，段落衔接连续，音色真实，混音克制。`;
      const plan: MusicPromptPlan = current.musicPrompt.plan || {
        title: `${ideaScript?.title || "本片"} · 可编辑配乐草稿`,
        creativeDirection: "以克制、连贯的器乐层次承接全片情绪；请结合画面节奏继续调整下方提示词。",
        minimaxPrompt: fallbackPrompt,
        instrumental: true,
        targetDurationSec,
        cues,
        mixGuidance: ["对白与关键现场声保持清晰。", "配乐动态服从叙事转折。", "片尾自然收束并预留淡出空间。"],
      };
      return {
        ...current,
        musicPromptApproval: "draft",
        musicPrompt: {
          ...current.musicPrompt,
          status: creatingLocalDraft ? "needs_revision" : "complete",
          plan: { ...plan, minimaxPrompt: creatingLocalDraft && !value.trim() ? fallbackPrompt : value },
          validationIssues: creatingLocalDraft ? ["这是本地建立的可编辑基础草稿；请结合影片情绪检查并修改提示词后再确认。"] : undefined,
          validationWarnings: undefined,
          error: undefined,
          updatedAt: new Date().toISOString(),
        },
        music: current.music.status === "complete" ? { ...current.music, status: "stale", error: "配乐提示词已修改，旧音乐仍保留。" } : current.music,
        musicApproval: "draft",
        finalComposition: current.finalComposition.status === "complete" ? { ...current.finalComposition, status: "stale", error: "配乐提示词已修改，旧成片仍保留。" } : current.finalComposition,
        agentReply: creatingLocalDraft ? "已在本地建立可编辑的配乐基础草稿，请修改提示词后确认。" : current.agentReply,
      };
    });
  }

  function updateMusicSeed(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647 || postProduction.music.status === "running") return;
    setPostProduction((current) => ({ ...current, musicSeed: value }));
  }

  function updateMusicSettings(patch: Partial<Pick<PostProductionState, "musicBpm" | "musicKeyScale" | "musicTimeSignature" | "musicInferenceSteps" | "musicThinking">>) {
    if (postProduction.music.status === "running") return;
    setPostProduction((current) => ({ ...current, ...patch }));
  }

  function approveMusicPrompt() {
    if (postProduction.musicPrompt.status !== "complete" || !postProduction.musicPrompt.plan?.minimaxPrompt.trim() || postProduction.musicPrompt.plan.minimaxPrompt.length > 2000) return;
    setPostProduction((current) => ({ ...current, musicPromptApproval: "approved", agentReply: "配乐提示词已确认。下一步可用本机ACE-Step 1.5生成；当前仍未调用音乐模型。" }));
  }

  async function refreshLocalMusicStatus(showChecking = true) {
    if (showChecking) setLocalMusicConnection((current) => ({ ...current, status: "checking", error: "" }));
    try {
      const response = await fetch("/api/postproduction/local-music/status", { cache: "no-store" });
      const body = await readApiJson<{ health?: H3Health; error?: string }>(response, "本机配乐引擎状态");
      if (!response.ok || !body.health) throw new Error(body.error || "无法读取本机配乐引擎状态。");
      setLocalMusicConnection({ status: body.health.status === "ok" ? "ready" : "unavailable", health: body.health, error: body.health.status === "ok" ? "" : body.health.message });
    } catch (caught) {
      setLocalMusicConnection({ status: "unavailable", error: caught instanceof Error ? caught.message : "无法读取本机配乐引擎状态。" });
    }
  }

  async function generateMusicWith() {
    if (postProduction.musicPromptApproval !== "approved" || postProduction.musicPrompt.status !== "complete" || postProduction.music.status === "running") return;
    if (localMusicConnection.status !== "ready") return;
    setPostProduction((current) => ({ ...current, musicApproval: "draft", music: { ...current.music, status: "running", error: "", startedAt: new Date().toISOString(), seed: current.musicSeed, inferenceSteps: current.musicInferenceSteps, provider: "acestep-1.5" }, finalComposition: current.finalComposition.status === "complete" ? { ...current.finalComposition, status: "stale", error: "正在生成新配乐，旧成片仍保留。" } : current.finalComposition, agentReply: `正在用本机ACE-Step 1.5生成纯音乐，Seed ${current.musicSeed}，${current.musicBpm} BPM，${current.musicKeyScale}，${current.musicInferenceSteps}步。目标时长会按约1.25倍生成后裁切；失败不会自动改参或重试。` }));
    try {
      const body = await postWorkflowRequest<{ music?: MusicGenerationResult; error?: string }>("/api/postproduction/local-music", { seed: postProduction.musicSeed, bpm: postProduction.musicBpm, keyScale: postProduction.musicKeyScale, timeSignature: postProduction.musicTimeSignature, inferenceSteps: postProduction.musicInferenceSteps, thinking: postProduction.musicThinking }, "ACE-Step本机生成配乐");
      if (!body.music) throw new Error(body.error || "ACE-Step没有返回可播放的本地文件。" );
      if (body.music.status === "complete") {
        setPostProduction((current) => ({ ...current, music: body.music!, agentReply: "ACE-Step配乐已经生成、裁切并保存到E盘。请在右侧“10 · 配乐设计”节点试听；不会自动进入最终合成。" }));
      } else if (body.music.status === "unqualified" && body.music.mediaUrl) {
        setPostProduction((current) => ({ ...current, music: body.music!, musicApproval: "draft", agentReply: `本机配乐时长未达标，但可解码结果已经保留。请在右侧“10 · 配乐设计”节点试听；该结果不能进入最终合成，系统没有自动重试。` }));
      } else {
        throw new Error(body.music.error || "ACE-Step没有返回合格的可播放文件。");
      }
    } catch (caught) {
      setPostProduction((current) => ({ ...current, music: { ...current.music, status: "failed", error: caught instanceof Error ? caught.message : "配乐生成失败；系统没有自动重试。" }, agentReply: "配乐没有完成，粗剪、提示词和旧结果均已保留；系统没有自动重试。" }));
    }
  }

  async function generateFinalComposition() {
    if (postProduction.finalComposition.status === "running" || postProduction.roughCutApproval !== "approved") return;
    if (postProduction.audioMode !== "native" && postProduction.music.status !== "complete") return;
    setPostProduction((current) => ({ ...current, musicApproval: current.audioMode === "native" ? current.musicApproval : "approved", finalComposition: { ...current.finalComposition, status: "running", error: "" }, agentReply: current.audioMode === "native" ? "正在本机保留H3原声、烧录已批准字幕并完整解码校验；不会调用模型或覆盖旧文件。" : "配乐已确认，正在本机混音、烧录已批准字幕并完整解码校验；不会调用模型或覆盖旧文件。" }));
    try {
      const body = await postWorkflowRequest<{ finalComposition?: FinalCompositionResult; session?: CreativeSessionEnvelope; error?: string }>("/api/postproduction/final-composition", {}, "生成最终成片");
      if (body.session) {
        sessionRevision.current = body.session.revision;
        setWorkflowSnapshot(body.session.workflow);
      }
      if (body.finalComposition?.status !== "complete") throw new Error(body.error || "最终合成没有返回可播放文件。");
      setPostProduction((current) => ({ ...current, musicApproval: current.audioMode === "native" ? current.musicApproval : "approved", finalComposition: body.finalComposition!, agentReply: "最终成片已完成并通过完整解码校验。请完整播放，进行最终人工验收。" }));
    } catch (caught) {
      setPostProduction((current) => ({ ...current, finalComposition: { ...current.finalComposition, status: "failed", error: caught instanceof Error ? caught.message : "最终合成失败；系统没有自动重试。" }, agentReply: "最终合成没有完成；粗剪、配乐、字幕和旧结果均已保留，系统没有自动重试。" }));
    }
  }

  async function renderEditorComposition() {
    if (!editor.clips.length || editor.renderStatus === "running") return;
    const running: EditorState = { ...editor, renderStatus: "running", renderError: "" };
    setEditor(running);
    try {
      await persistCurrentProject({ ...creativeStateSnapshot(), canvasMode: "editor", editor: running });
      const response = await fetch("/api/editor/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await readApiJson<{ editor?: EditorState; render?: EditorState["renders"][number]; session?: CreativeSessionEnvelope; error?: string }>(response, "剪辑台生成成片");
      if (body.session) {
        sessionRevision.current = body.session.revision;
        setWorkflowSnapshot(body.session.workflow);
      }
      if (!response.ok || body.render?.status !== "complete") throw new Error(body.error || "剪辑台没有返回可播放成片。");
      setEditor(normalizeEditorState(body.editor || { ...running, renderStatus: "idle", renders: [...running.renders, body.render] }));
    } catch (caught) {
      setEditor((current) => ({ ...current, renderStatus: "failed", renderError: caught instanceof Error ? caught.message : "剪辑台合成失败；时间线和已有成片仍已保留。" }));
    }
  }

  const interruptedShotVideoSignature = shotVideoTasks
    .filter((task) => task.status === "failed" && !task.externalTaskId && task.error?.includes("取得PRISM任务编号"))
    .map((task) => task.segmentKey)
    .sort()
    .join("|");

  useEffect(() => {
    if (!sessionHydrated || !interruptedShotVideoSignature) return;
    let cancelled = false;
    void fetch("/api/h3/jobs", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("load failed")))
      .then((body: { jobs?: H3RecoverableJob[] }) => {
        if (cancelled || !Array.isArray(body.jobs)) return;
        updateShotVideoTasks((current) => {
          let changed = false;
          const next = current.map((task) => {
            if (task.status !== "failed" || task.externalTaskId || !task.error?.includes("取得PRISM任务编号")) return task;
            const recovered = body.jobs!.find((job) => job.segmentKey === task.segmentKey);
            if (!recovered) return task;
            changed = true;
            return { ...task, status: recovered.status, externalTaskId: recovered.externalTaskId, error: "", updatedAt: new Date().toISOString() };
          });
          return changed ? next : current;
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionHydrated, interruptedShotVideoSignature]);

  const activeShotVideoSignature = shotVideoTasks
    .filter((task) => task.externalTaskId && ["queued", "running"].includes(task.status))
    .map((task) => `${task.segmentKey}:${task.externalTaskId}:${task.status}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!sessionHydrated || !activeProjectId) return;
    let cancelled = false;
    void fetch('/api/videos/jobs', { cache: 'no-store' }).then(async response => {
      const body = await response.json() as { jobs?: Array<H3TaskResponse & { projectId: string; requestId: string; segmentKey: string }> };
      if (!response.ok || cancelled || !body.jobs?.length) return;
      updateShotVideoTasks(current => current.map(item => {
        const job = body.jobs!.find(candidate => candidate.projectId === activeProjectId && (candidate.externalTaskId === item.externalTaskId || candidate.requestId === item.submissionIntent?.requestId));
        return job ? { ...item, externalTaskId: job.externalTaskId, status: job.status === 'completed' ? 'awaiting_review' : job.status, outputPaths: job.outputPaths || [], parameters: job.parameters, error: job.errorMessage, submissionIntent: undefined, updatedAt: job.updatedAt || item.updatedAt } : item;
      }));
      setFreeCanvas(current => ({ ...current, nodes: current.nodes.map(node => {
        const job = body.jobs!.find(candidate => candidate.projectId === activeProjectId && candidate.segmentKey === `free:${node.id}` && candidate.requestId === node.generation?.taskId);
        if (!job || !node.generation) return node;
        const complete = job.status === 'completed' || job.status === 'awaiting_review';
        return { ...node, ...(complete && job.externalTaskId ? { mediaUrl: `/api/h3/media/${encodeURIComponent(job.externalTaskId)}` } : {}), generation: { ...node.generation, status: complete ? 'complete' : job.status === 'failed' || job.status === 'cancelled' ? 'failed' : 'running', externalTaskId: job.externalTaskId, outputPaths: job.outputPaths || [], parameters: job.parameters, error: job.errorMessage, updatedAt: job.updatedAt || node.generation.updatedAt } };
      }) }));
    }).catch(() => { /* Existing task IDs remain available to the status poller. */ });
    return () => { cancelled = true; };
  }, [sessionHydrated, activeProjectId]);

  useEffect(() => {
    if (!sessionHydrated || !activeShotVideoSignature) return;
    let cancelled = false;
    const poll = async () => {
      if (shotVideoPollInFlight.current) return;
      const activeTasks = shotVideoTasks.filter((task) => task.externalTaskId && ["queued", "running"].includes(task.status));
      if (!activeTasks.length) return;
      shotVideoPollInFlight.current = true;
      const results = await Promise.all(activeTasks.map(async (savedTask) => {
        try {
          const response = await fetch(`/api/videos/generations/${encodeURIComponent(savedTask.externalTaskId!)}`, { cache: "no-store" });
          const body = await readApiJson<{ task?: H3TaskResponse; error?: string }>(response, "读取视频任务");
          if (!response.ok || !body.task) throw new Error(body.error || "暂时无法读取视频任务。");
          return { savedTask, task: body.task };
        } catch (caught) {
          return { savedTask, error: caught instanceof Error ? caught.message : "PRISM H3连接暂时中断；原任务仍保留。" };
        }
      }));
      shotVideoPollInFlight.current = false;
      if (cancelled) return;
      const successful = results.filter((result): result is { savedTask: ShotVideoTask; task: H3TaskResponse } => Boolean("task" in result && result.task));
      if (successful.length) {
        if (successful.some(item => !item.savedTask.externalTaskId?.startsWith('cv-'))) setH3Connection((current) => current.status === "online" && !current.error ? current : { ...current, status: "online", error: "" });
        updateShotVideoTasks((current) => {
          let changed = false;
          const next = current.map((item) => {
            const result = successful.find((candidate) => candidate.savedTask.segmentKey === item.segmentKey && candidate.savedTask.externalTaskId === item.externalTaskId);
            if (!result) return item;
            const nextStatus = result.task.status === "completed" ? "awaiting_review" : result.task.status;
            const nextOutputs = result.task.outputPaths?.length ? result.task.outputPaths : item.outputPaths;
            const nextError = result.task.errorMessage || "";
            if (nextStatus === item.status && nextError === (item.error || "") && result.task.parameters?.phase === item.parameters?.phase && JSON.stringify(nextOutputs || []) === JSON.stringify(item.outputPaths || [])) return item;
            changed = true;
            return { ...item, status: nextStatus, outputPaths: nextOutputs, parameters: { ...(item.parameters || {}), ...(result.task.parameters || {}), continuity: item.parameters?.continuity || result.task.parameters?.continuity }, error: nextError, updatedAt: result.task.updatedAt || new Date().toISOString() };
          });
          return changed ? next : current;
        });
      } else {
        const failure = results.find((result) => "error" in result)?.error || "PRISM H3连接暂时中断；原任务仍保留。";
        if (activeTasks.some(item => !item.externalTaskId?.startsWith("cv-"))) setH3Connection((current) => current.status === "offline" && current.error === failure ? current : { ...current, status: "offline", error: failure });
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sessionHydrated, activeShotVideoSignature]);

  const activeFreeCanvasVideoSignature = freeCanvas.nodes
    .filter((node) => node.kind === "video" && node.generation?.externalTaskId && ["submitting", "queued", "running"].includes(node.generation.status))
    .map((node) => `${node.id}:${node.generation!.externalTaskId}:${node.generation!.status}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!sessionHydrated || !activeFreeCanvasVideoSignature) return;
    let cancelled = false;
    const poll = async () => {
      if (freeCanvasVideoPollInFlight.current) return;
      const activeNodes = freeCanvas.nodes.filter((node) => node.kind === "video" && node.generation?.externalTaskId && ["submitting", "queued", "running"].includes(node.generation.status));
      if (!activeNodes.length) return;
      freeCanvasVideoPollInFlight.current = true;
      const results = await Promise.all(activeNodes.map(async (node) => {
        try {
          const response = await fetch(`/api/videos/generations/${encodeURIComponent(node.generation!.externalTaskId!)}`, { cache: "no-store" });
          const body = await readApiJson<{ task?: H3TaskResponse; error?: string }>(response, "读取自由画布视频任务");
          if (!response.ok || !body.task) throw new Error(body.error || "暂时无法读取自由画布视频任务。");
          return { nodeId: node.id, externalTaskId: node.generation!.externalTaskId!, task: body.task };
        } catch (caught) {
          return { nodeId: node.id, externalTaskId: node.generation!.externalTaskId!, error: caught instanceof Error ? caught.message : "PRISM H3连接暂时中断；原任务仍保留。" };
        }
      }));
      freeCanvasVideoPollInFlight.current = false;
      if (cancelled) return;
      const successful = results.filter((result): result is { nodeId: string; externalTaskId: string; task: H3TaskResponse } => "task" in result);
      if (successful.length) {
        if (successful.some(item => !item.externalTaskId.startsWith('cv-'))) setH3Connection((current) => current.status === "online" && !current.error ? current : { ...current, status: "online", error: "" });
        setFreeCanvas((current) => {
          let changed = false;
          const nodes = current.nodes.map((node) => {
            const result = successful.find((candidate) => candidate.nodeId === node.id && candidate.externalTaskId === node.generation?.externalTaskId);
            if (!result || !node.generation) return node;
            const status: NonNullable<FreeCanvasNode["generation"]>["status"] = result.task.status === "completed" || result.task.status === "awaiting_review" ? "complete" : result.task.status === "failed" || result.task.status === "cancelled" ? "failed" : result.task.status === "queued" ? "queued" : "running";
            const outputPaths = result.task.outputPaths?.length ? result.task.outputPaths : node.generation.outputPaths;
            const error = result.task.errorMessage || undefined;
            const mediaUrl = status === "complete" ? `/api/h3/media/${encodeURIComponent(result.externalTaskId)}` : node.mediaUrl;
            if (status === node.generation.status && error === node.generation.error && result.task.parameters?.phase === node.generation.parameters?.phase && mediaUrl === node.mediaUrl && JSON.stringify(outputPaths || []) === JSON.stringify(node.generation.outputPaths || [])) return node;
            changed = true;
            return { ...node, mediaUrl, generation: { ...node.generation, status, provider: node.generation.provider || "prism-h3", outputPaths, parameters: result.task.parameters, error, updatedAt: result.task.updatedAt || new Date().toISOString() } };
          });
          return changed ? { ...current, nodes } : current;
        });
      } else {
        const failure = results.find((result) => "error" in result)?.error || "PRISM H3连接暂时中断；原任务仍保留。";
        if (activeNodes.some(item => !item.generation?.externalTaskId?.startsWith("cv-"))) setH3Connection((current) => current.status === "offline" && current.error === failure ? current : { ...current, status: "offline", error: failure });
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sessionHydrated, activeFreeCanvasVideoSignature]);

  const waitingShotVideoSignature = shotVideoTasks
    .filter((task) => task.status === "waiting_dependency" && task.submissionIntent?.continuityMode === "continue")
    .map((task) => {
      const source = shotVideoTasks.find((candidate) => candidate.segmentKey === task.submissionIntent?.sourceSegmentKey);
      const continuity = source?.parameters?.continuity as { engine?: string; chainId?: string } | undefined;
      return `${task.segmentKey}:${task.submissionIntent?.sourceSegmentKey}:${source?.status || "missing"}:${continuity?.engine || ""}:${continuity?.chainId || ""}`;
    })
    .sort()
    .join("|");

  useEffect(() => {
    if (!sessionHydrated || !waitingShotVideoSignature || h3Connection.status !== "idle") return;
    void refreshH3Status(true);
  }, [sessionHydrated, h3Connection.status, waitingShotVideoSignature]);

  useEffect(() => {
    if (!sessionHydrated) return;
    void refreshH3Status(true);
    const timer = window.setInterval(() => void refreshH3Status(true), 3000);
    return () => window.clearInterval(timer);
  }, [sessionHydrated]);

  useEffect(() => {
    if (!sessionHydrated || h3Connection.status !== "online" || !waitingShotVideoSignature) return;
    const ready = shotVideoTasks.filter((task) => {
      if (task.status !== "waiting_dependency" || task.submissionIntent?.continuityMode !== "continue") return false;
      const source = shotVideoTasks.find((candidate) => candidate.segmentKey === task.submissionIntent?.sourceSegmentKey);
      const continuity = source?.parameters?.continuity as { engine?: string; chainId?: string } | undefined;
      return source?.status === "awaiting_review" && continuity?.engine === "herrgotts" && Boolean(continuity.chainId);
    });
    const next = ready.find((task) => !shotVideoDependencyDispatchKeys.current.has(task.segmentKey));
    if (!next?.submissionIntent) return;
    shotVideoDependencyDispatchKeys.current.add(next.segmentKey);
    void submitShotVideo(next.segmentKey, true, next.submissionIntent, true)
      .finally(() => shotVideoDependencyDispatchKeys.current.delete(next.segmentKey));
  }, [sessionHydrated, h3Connection.status, waitingShotVideoSignature]);

  const selectedStyle = stylePresets.find((preset) => preset.id === selectedStyleId) || null;
  const scriptVisible = Boolean(ideaScript);
  const scriptApproved = scriptVisible && scriptApproval === "approved";
  const assetStageVisible = step === "workspace" && scriptApproved;
  const storyboardPlansReady = storyboardSegments.length > 0 && storyboardSegments.every((segment) => storyboardBoardPlans.some((item) => !item.stale && item.segmentKey === segment.segmentKey && storyboardPlanPanelCount(item) === storyboardBoardPanelCount) && storyboardBoardPrompts.some((item) => !item.stale && item.segmentKey === segment.segmentKey && storyboardPromptPanelCount(item) === storyboardBoardPanelCount));
  const canvasWorkflowView = toStageViewModel(workflowSnapshot.stages[stageForWorkspaceSection(activeStage as WorkspaceSection, workflowSnapshot)]);
  const canvasStatusText = assetStageVisible ? canvasWorkflowView.summaryZh : scriptVisible ? "剧本草案待确认" : ["idea-questions", "idea-script", "workspace"].includes(step) ? "前置设置已完成" : "等待完成前置设置";
  const canvasStatusPending = assetStageVisible ? !canvasWorkflowView.isResolved : /等待|待确认|失败|未完成/.test(canvasStatusText);
  const canvasStatusConfirmed = assetStageVisible ? canvasWorkflowView.isResolved : !canvasStatusPending && isConfirmedNodeStatus(canvasStatusText);
  const directorUiPreview = new URLSearchParams(window.location.search).get("director-ui") !== "classic";
  const studioStageViews = Object.fromEntries(stageItems.map((item) => {
    const view = toStageViewModel(workflowSnapshot.stages[stageForWorkspaceSection(item as WorkspaceSection, workflowSnapshot)]);
    return [item, view];
  })) as Record<string, ReturnType<typeof toStageViewModel>>;
  const focusDirectorStage = (nextStage: string) => {
    setActiveStage(nextStage);
    setStageNavigationRequest((current) => Math.abs(current) + 1);
  };

  return (
    <main className={`app-shell visual-sample-minimal canvas-mode-${canvasMode}${directorUiPreview ? " director-ui-studio" : ""}`}>
      <div className="dot-grid" aria-hidden="true" />
      <TaskStatus step={step} scriptPlanningBusy={novelBusy || ideaBusy} emotionBusy={emotionRecommendationBusy} episodeBusyCount={episodeScripts.filter(item => item.status === "running").length} seriesPlanning={workType === "series"} characterStatus={characterStatus} characterImageStatus={characterImageStatus} characterImageRequestCount={characterImageRequestKeys.length} characterTurnaroundRunningCount={characterTurnarounds.filter(item => item.status === "running").length} sceneStatus={sceneStatus} sceneImageStatus={sceneImageStatus} sceneImageRequestCount={sceneImageRequestKeys.length} sceneViewRunningCount={sceneViews.filter((item) => item.status === "running").length} propStatus={propStatus} propImageStatus={propImageStatus} propImageRequestCount={propImageRequestKeys.length} storyboardStatus={storyboardStatus} storyboardBoardStatus={storyboardBoardStatus} storyboardBoardRequestCount={storyboardBoardRequestKeys.length} storyboardPlansReady={storyboardPlansReady} videoPromptStatus={videoPromptStatus} videoPromptRunningCount={videoPrompts.filter((item) => item.status === "running").length} h3RunningCount={shotVideoTasks.filter((task) => ["submitting", "queued", "running"].includes(task.status)).length}  hidden={canvasMode !== "director"}>
      <ProductionQueue projectId={activeProjectId} onJobs={(jobs) => { void (async () => { for (const job of jobs) await receiveProductionJob(job); })(); }}>
        {storyboardSegments.length > 0 && <details className="production-job"><summary>逐段审核与继续制作</summary><p>打开图片或提示词检查后，可仅确认这一段。</p>{storyboardSegments.map(segment => {
          const board = storyboardBoards.find(item => item.segmentKey === segment.segmentKey);
          const prompt = videoPrompts.find(item => item.segmentKey === segment.segmentKey);
          const plan = storyboardBoardPlans.find(item => item.segmentKey === segment.segmentKey && !item.stale);
          const planApproved = plan && (plan.approval === "approved" || storyboardAssetsApproval === "approved");
          const boardReady = board?.status === "complete" && board.imageUrl && !board.stale;
          const boardApproved = boardReady && (board.approval === "approved" || storyboardAssetsApproval === "approved");
          const promptReady = prompt?.status === "complete" && prompt.prompt && !prompt.stale;
          const promptApproved = promptReady && (prompt.approval === "approved" || videoPromptsApproval === "approved");
          return <div className="production-segment" key={segment.segmentKey}><strong>{segment.segmentKey} · {segment.title}</strong>
            {boardReady && <button type="button" onClick={() => setImageViewer({ src: board.imageUrl!, title: segment.title })}>查看图片</button>}
            {boardReady && !boardApproved && <button type="button" onClick={() => { const boards = storyboardBoards.map(item => item.segmentKey === segment.segmentKey ? { ...item, approval: "approved" as const } : item); updateStoryboardBoards(() => boards); void persistCurrentProject({ ...creativeStateSnapshot(), storyboardBoards: boards }).catch(error => setStoryboardBoardError(error.message)); }}>确认本段图片</button>}
            {!boardReady && plan && !planApproved && <button type="button" onClick={() => { const plans = storyboardBoardPlans.map(item => item === plan ? { ...item, approval: "approved" as const } : item); setStoryboardBoardPlans(plans); void persistCurrentProject({ ...creativeStateSnapshot(), storyboardBoardPlans: plans }).catch(error => setStoryboardBoardError(error.message)); }}>确认本段规划，使用文字与已有资产</button>}
            {(boardApproved || planApproved) && !promptReady && <button type="button" disabled={videoPromptStatus === "running"} onClick={() => void generateVideoPrompts([segment.segmentKey])}>生成本段提示词</button>}
            {prompt?.prompt && <button type="button" onClick={() => openVideoPrompt(segment.segmentKey)}>查看提示词</button>}
            {promptReady && !promptApproved && <button type="button" onClick={() => { const prompts = videoPrompts.map(item => item.segmentKey === segment.segmentKey ? { ...item, approval: "approved" as const } : item); setVideoPrompts(prompts); void persistCurrentProject({ ...creativeStateSnapshot(), videoPrompts: prompts }).catch(error => setVideoPromptError(error.message)); }}>确认本段提示词</button>}
            {promptApproved && <button type="button" disabled={h3Connection.status !== "online" || ["submitting", "queued", "running", "waiting_dependency"].includes(shotVideoTasks.find(item => item.segmentKey === segment.segmentKey)?.status || "")} onClick={() => void submitShotVideo(segment.segmentKey)}>生成本段视频</button>}
            {(board?.previousVersions?.length || prompt?.previousVersions?.length) ? <details><summary>历史版本</summary>{board?.previousVersions?.filter(item => item.imageUrl).map((item, index) => <button type="button" key={index} onClick={() => setImageViewer({ src: item.imageUrl, title: `${segment.segmentKey} · 历史图片 ${index + 1}` })}>查看图片版本 {index + 1}</button>)}{prompt?.previousVersions?.filter(item => item.prompt).map((item, index) => <details key={index}><summary>提示词版本 {index + 1}</summary><pre>{item.prompt}</pre></details>)}</details> : null}
            {!boardReady && <small>等待本段故事板图片</small>}
          </div>;
        })}</details>}
      </ProductionQueue>
      </TaskStatus>
      <Header projectName={projectName} saveStatus={sessionSaveStatus} activeStage={activeStage} canvasMode={canvasMode} canvasStatusText={canvasStatusText} canvasStatusPending={canvasStatusPending} canvasStatusConfirmed={canvasStatusConfirmed} h3Connection={h3Connection} onCanvasMode={setCanvasMode} onStageChange={focusDirectorStage} onRefreshH3={() => void refreshH3Status()} onOpenH3={() => void startPrismH3()} onOpenSettings={() => setSettingsOpen(true)} onOpenProjects={() => void openProjectManager()} />
      {directorUiPreview && canvasMode === "director" && <section className="director-studio-masthead" aria-label="导演制作阶段">
        <div className={`director-studio-heading tone-${canvasWorkflowView.tone}`}>
          <div><strong>{activeStage}</strong><span>{canvasWorkflowView.statusLabelZh}</span></div>
          <p>{canvasStatusText}</p>
          <button type="button" onClick={() => focusDirectorStage(activeStage)}>定位当前节点</button>
        </div>
        <nav>{stageItems.map((item, index) => {
          const stageView = studioStageViews[item];
          return <button type="button" key={item} className={`${item === activeStage ? "active " : ""}tone-${stageView.tone}`.trim()} aria-current={item === activeStage ? "page" : undefined} aria-label={`${item}，${stageView.statusLabelZh}`} onClick={() => focusDirectorStage(item)}><i>{String(index + 1).padStart(2, "0")}</i><span>{item}<small>{stageView.statusLabelZh}</small></span></button>;
        })}</nav>
      </section>}
      {canvasMode === "director" && <GenerationPresetControl presets={stylePresets} preset={generationPreset} history={generationPresetHistory} imageProvider={providerStatuses.find((provider) => provider.kind === "image")} imageEditProvider={providerStatuses.find((provider) => provider.kind === "image-edit")} videoSettingsAvailable={assetStageVisible} onStyle={selectCharacterStyle} onRatio={selectGenerationRatio} onImageResolution={selectGenerationImageResolution} onImageModel={(kind, profileId) => void activateProviderProfile(kind, profileId)} onVideoSettings={() => { setActiveStage("视频"); setStageNavigationRequest((current) => -(Math.abs(current) + 1)); }} />}

      {canvasMode === "director" ? <>
      <AgentPanel
        workflow={workflowSnapshot}
        activeStage={activeStage}
        directorUiPreview={directorUiPreview}
        step={step}
        projectName={projectName}
        onProjectName={(value) => void renameCurrentProject(value)}
        creationSource={creationSource}
        workType={workType}
        creativeDirection={creativeDirection}
        brief={brief}
        novelText={novelText}
        novelName={novelName}
        duration={duration}
        customDurationSec={customDurationSec}
        episodeCountMode={episodeCountMode}
        episodeCount={episodeCount}
        ratio={ratio}
        language={language}
        emotion={emotion}
        customEmotion={customEmotion}
        emotionRecommendations={emotionRecommendations}
        emotionRecommendationBusy={emotionRecommendationBusy}
        emotionRecommendationError={emotionRecommendationError}
        onRetryEmotionRecommendations={() => void requestEmotionRecommendations(true)}
        onDuration={setDuration}
        onCustomDurationSec={setCustomDurationSec}
        onEpisodeCountMode={setEpisodeCountMode}
        onEpisodeCount={setEpisodeCount}
        onWorkType={(value) => {
          setWorkType(value);
          const allowedDurations = value === "series"
            ? ["60秒", "90秒", "120秒", "180秒", "自定义"]
            : usesShortDurationPresets(creativeDirection)
              ? ["10秒", "15秒", "30秒", "60秒", "自定义"]
              : ["30秒", "60秒", "90秒", "180秒", "自定义"];
          if (!allowedDurations.includes(duration)) setDuration(value === "series" ? "90秒" : usesShortDurationPresets(creativeDirection) ? "30秒" : "60秒");
        }}
        onCreativeDirection={(value) => {
          setCreativeDirection(value);
          setCustomEmotion("");
          setEmotionRecommendations([]);
          setEmotionRecommendationContext("");
          setEmotionRecommendationError("");
          const toneOptions = toneOptionsForDirection(value);
          if (!toneOptions.some((item) => item.name === emotion)) setEmotion(toneOptions[0].name);
          const allowedDurations = workType === "series"
            ? ["60秒", "90秒", "120秒", "180秒", "自定义"]
            : usesShortDurationPresets(value)
              ? ["10秒", "15秒", "30秒", "60秒", "自定义"]
              : ["30秒", "60秒", "90秒", "180秒", "自定义"];
          if (!allowedDurations.includes(duration)) setDuration(workType === "series" ? "90秒" : usesShortDurationPresets(value) ? "30秒" : "60秒");
        }}
        onRatio={selectInitialProjectRatio}
        onLanguage={setLanguage}
        onEmotion={(value) => {
          setEmotion(value);
          setCustomEmotion("");
        }}
        onCustomEmotion={setCustomEmotion}
        onNovelText={setNovelText}
        onNovelName={setNovelName}
        onContinue={() => {
          if (step === "novel" || step === "idea") {
            const sourceText = step === "idea" ? ideaText.trim() : novelText;
            if (sourceText.trim()) setAgentTranscript((current) => [
              ...current,
              createTranscriptEntry({ role: "assistant", kind: "question", text: step === "idea" ? "先说出你的创作想法" : "请上传或粘贴文本素材" }),
              createTranscriptEntry({ role: "user", kind: "source", text: sourceText }),
            ]);
            setStep("format");
          }
          else if (step === "format") {
            const selectedDirection = creativeDirections.find((option) => option.id === creativeDirection)!;
            const selectedForm: IdeaDirectionOption = workType === "series"
              ? { id: "series", label: "系列连载", description: "先建立完整系列规划，再按集推进制作。" }
              : { id: "single", label: "单条作品", description: "在当前时长内完成一条独立作品。" };
            setAgentTranscript((current) => [
              ...current,
              createTranscriptEntry({ role: "assistant", kind: "question", text: "这次作品的创作方向是什么？", options: [selectedDirection] }),
              createTranscriptEntry({ role: "user", kind: "answer", text: selectedDirection.label, selectedOptionId: selectedDirection.id }),
              createTranscriptEntry({ role: "assistant", kind: "question", text: "这次采用哪种内容形式？", options: [selectedForm] }),
              createTranscriptEntry({ role: "user", kind: "answer", text: selectedForm.label, selectedOptionId: selectedForm.id }),
            ]);
            setStep("parameters");
          }
          else if (step === "parameters") {
            const durationOptions = workType === "single" && usesShortDurationPresets(creativeDirection)
              ? [["10秒", "短版表达"], ["15秒", "标准短广告"], ["30秒", "完整展示"], ["60秒", "长版表达"], ["自定义", "5—600秒"]]
              : workType === "single"
                ? [["30秒", "极短叙事"], ["60秒", "标准短视频"], ["90秒", "完整转折"], ["180秒", "长故事"], ["自定义", "15—600秒"]]
              : [["60秒", "快节奏"], ["90秒", "标准单集"], ["120秒", "内容展开"], ["180秒", "长单集"], ["自定义", "15—600秒"]];
            const parameterOptions: IdeaDirectionOption[] = [
              ...durationOptions.map(([label, description]) => ({ id: `duration-${label}`, label: `${workType === "single" ? "成片" : "单集"}时长 · ${label}`, description })),
              ...["16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => ({ id: `ratio-${value}`, label: `画面比例 · ${value}`, description: "画布与成片比例" })),
              ...["中文", "英文", "日文"].map((value) => ({ id: `language-${value}`, label: `对白语言 · ${value}`, description: "剧本对白语言" })),
              ...(workType === "series" ? [
                { id: "episodes-agent", label: "预计集数 · 由 Agent 规划", description: "根据素材体量规划整个系列" },
                { id: "episodes-fixed", label: "预计集数 · 指定集数", description: "按当前填写的集数规划系列" },
              ] : []),
            ];
            const resolvedDurationValue = duration === "自定义" ? `${Math.max(minimumDurationSec, Number(customDurationSec) || 120)}秒（自定义）` : duration;
            const selectedOptionIds = [`duration-${duration}`, `ratio-${ratio}`, `language-${language}`];
            if (workType === "series") selectedOptionIds.push(`episodes-${episodeCountMode}`);
            const parameterAnswer = [
              `${workType === "single" ? "成片" : "单集"}时长：${resolvedDurationValue}`,
              ...(workType === "series" ? [`预计集数：${episodeCountMode === "fixed" ? `${Math.max(2, Number(episodeCount) || 8)}集` : "由 Agent 规划"}`] : []),
              `画面比例：${ratio}`,
              `对白语言：${language}`,
            ].join("\n");
            setAgentTranscript((current) => [
              ...current,
              createTranscriptEntry({ role: "assistant", kind: "question", text: "先确认影片参数", options: parameterOptions.filter((option) => selectedOptionIds.includes(option.id)) }),
              createTranscriptEntry({ role: "user", kind: "answer", text: parameterAnswer, selectedOptionIds }),
            ]);
            void requestEmotionRecommendations();
          }
          else if (step === "emotion") {
            const toneOptions = emotionRecommendations.length ? emotionRecommendations : toneOptionsForDirection(creativeDirection);
            const emotionOptions: IdeaDirectionOption[] = [
              ...toneOptions.map((item) => ({ id: `emotion-${item.name}`, label: item.name, description: item.note })),
              { id: "emotion-custom", label: creativeDirection === "story" ? "自定义情绪" : "自定义气质", description: creativeDirection === "story" ? "输入当前项目需要的主情绪" : "输入当前作品需要的表达气质" },
            ];
            const emotionValue = customEmotion.trim() || emotion;
            const selectedEmotionOptionId = customEmotion.trim() ? "emotion-custom" : `emotion-${emotion}`;
            setAgentTranscript((current) => [
              ...current,
              createTranscriptEntry({ role: "assistant", kind: "question", text: creativeDirection === "story" ? "选择本集主情绪" : "选择作品表达气质", options: emotionOptions.filter((option) => option.id === selectedEmotionOptionId) }),
              createTranscriptEntry({ role: "user", kind: "answer", text: emotionValue, selectedOptionId: selectedEmotionOptionId }),
            ]);
            if (creationSource === "idea") void requestIdeaTurn([]);
            else setStep("workspace");
          }
        }}
        onBack={() => {
          if (step === "novel" || step === "idea") setStep("start");
          else if (step === "format") setStep(creationSource);
          else if (step === "parameters") setStep("format");
          else if (step === "emotion") setStep("parameters");
          else if (step === "workspace" || step === "idea-questions") setStep("emotion");
        }}
        onPrepareSplit={() => void requestNovelScript()}
        novelBusy={novelBusy}
        novelError={novelError}
        onOpenSettings={() => setSettingsOpen(true)}
        ideaText={ideaText}
        ideaAnswers={ideaAnswers}
        ideaAnswer={ideaAnswer}
        onIdeaText={setIdeaText}
        onIdeaAnswer={setIdeaAnswer}
        onChooseNovel={() => { setCreationSource("novel"); setStep("novel"); }}
        onChooseIdea={() => { setCreationSource("idea"); setStep("idea"); }}
        ideaQuestion={ideaQuestion}
        ideaOptions={ideaOptions}
        agentTranscript={agentTranscript}
        managerTranscript={managerTranscript}
        managerBusy={managerBusy}
        managerError={managerError}
        ideaScript={ideaScript}
        scriptApproval={scriptApproval}
        scriptRevisionText={scriptRevisionText}
        scriptRevisionOpen={scriptRevisionOpen}
        scriptRevisionBusy={scriptRevisionBusy}
        scriptRevisionError={scriptRevisionError}
        characterStatus={characterStatus}
        characterProfiles={characterProfiles}
        characterError={characterError}
        characterApproval={characterApproval}
        stylePresets={stylePresets}
        selectedStyleId={selectedStyleId}
        characterImageStatus={characterImageStatus}
        characterImages={characterImages}
        characterImagePrompts={characterImagePrompts}
        characterImageRequestKeys={characterImageRequestKeys}
        characterAssetsApproval={characterAssetsApproval}
        characterImageError={characterImageError}
        sceneStatus={sceneStatus}
        sceneProposals={sceneProposals}
        sceneError={sceneError}
        sceneRejectedDraft={sceneRejectedDraft}
        sceneRejectedIssues={sceneRejectedIssues}
        sceneProposalApproval={sceneProposalApproval}
        sceneImageStatus={sceneImageStatus}
        sceneImages={sceneImages}
        sceneImageRequestKeys={sceneImageRequestKeys}
        sceneImageError={sceneImageError}
        sceneMainApproval={sceneMainApproval}
        sceneViews={sceneViews}
        sceneAssetsApproval={sceneAssetsApproval}
        propStatus={propStatus}
        propProposals={propProposals}
        propError={propError}
        propRejectedDraft={propRejectedDraft}
        propRejectedIssues={propRejectedIssues}
        propProposalApproval={propProposalApproval}
        propImageStatus={propImageStatus}
        propImages={propImages}
        propImageRequestKeys={propImageRequestKeys}
        propImageError={propImageError}
        propAssetsApproval={propAssetsApproval}
        storyboardSegmentDurationSec={storyboardSegmentDurationSec}
        storyboardBoardPanelCount={storyboardBoardPanelCount}
        storyboardStatus={storyboardStatus}
        storyboardSegments={storyboardSegments}
        storyboardWarnings={storyboardWarnings}
        storyboardError={storyboardError}
        storyboardApproval={storyboardApproval}
        storyboardBoardStatus={storyboardBoardStatus}
        storyboardBoardPlans={storyboardBoardPlans}
        storyboardBoardPrompts={storyboardBoardPrompts}
        storyboardBoards={storyboardBoards}
        storyboardBoardError={storyboardBoardError}
        storyboardBoardRejectedDraft={storyboardBoardRejectedDraft}
        storyboardBoardRejectedIssues={storyboardBoardRejectedIssues}
        storyboardAssetsApproval={storyboardAssetsApproval}
        videoPromptStatus={videoPromptStatus}
        videoPrompts={videoPrompts}
        videoPromptError={videoPromptError}
        videoPromptsApproval={videoPromptsApproval}
        directVideoBusy={directVideoBusy}
        directVideoError={directVideoError}
        h3Connection={h3Connection}
        h3GenerationSettings={h3GenerationSettings}
        shotVideoTasks={shotVideoTasks}
        shotContinuityModes={shotContinuityModes}
        shotVideosApproval={shotVideosApproval}
        shotVideoBatchSubmitting={shotVideoBatchSubmitting}
        postProduction={postProduction}
        localMusicConnection={localMusicConnection}
        ideaBusy={ideaBusy}
        ideaError={ideaError}
        onSubmitIdeaAnswer={() => {
          const answer = ideaAnswer.trim();
          if (!answer || !ideaQuestion) return;
          const selectedOption = ideaOptions.find((option) => `${option.label}：${option.description}` === answer);
          setAgentTranscript((current) => [
            ...current,
            createTranscriptEntry({ role: "assistant", kind: "question", text: ideaQuestion, options: selectedOption ? [{ ...selectedOption }] : undefined }),
            createTranscriptEntry({ role: "user", kind: "answer", text: answer, selectedOptionId: selectedOption?.id }),
          ]);
          const nextAnswers = [...ideaAnswers, { question: ideaQuestion, answer }];
          setIdeaAnswers(nextAnswers);
          setIdeaAnswer("");
          void requestIdeaTurn(nextAnswers);
        }}
        onFinishQuestions={() => {
          if (ideaQuestion) setAgentTranscript((current) => [
            ...current,
            createTranscriptEntry({ role: "assistant", kind: "question", text: ideaQuestion }),
            createTranscriptEntry({ role: "user", kind: "answer", text: "不再追问，直接生成剧本" }),
          ]);
          void requestIdeaTurn(ideaAnswers, true);
        }}
        onRetryIdea={() => void requestIdeaTurn(ideaAnswers)}
        onOpenScript={() => setScriptDetailsOpen(true)}
        onRevisionText={setScriptRevisionText}
        onOpenRevision={() => { setScriptRevisionOpen(true); setScriptRevisionError(""); }}
        onCancelRevision={() => { setScriptRevisionOpen(false); setScriptRevisionError(""); }}
        onSubmitRevision={() => void requestScriptRevision()}
        onRestart={() => {
          if (!window.confirm("重新开始会清空当前项目里的创作流程。要保留这份草稿，请先在项目管理中点击“新建项目”。确定重新开始吗？")) return;
          applyCreativeState(emptyCreativeState(appCreativeDefaultsRef.current));
        }}
        onAcceptIdeaScript={enterCharacterDesign}
        onRetryCharacterDesign={() => void startCharacterDesign()}
        onSkipCharacterProfiles={skipCharacterProfiles}
        characterTools={<div className="character-tools"><button className="secondary-button" disabled={characterRosterBusy || characterStatus === "running" || characterImageStatus === "running"} onClick={() => openCharacterLibrary()}>＋ 添加角色</button>{characterRosterBusy && <span role="status">正在保存人物…</span>}{characterRosterError && <p role="alert">{characterRosterError}</p>}</div>}
        onManageCharacter={openCharacterLibrary}
        onRemoveCharacterProfile={removeCharacterProfile}
        onApproveCharacters={() => void changeCharacters({ action: "approve-profiles" }).catch(() => undefined)}
        onGenerateAssetBatch={(kind, retry) => void generateAssetBatch(kind, retry)}
        onGenerateCharacterImage={(profileKey) => void generateCharacterImages([profileKey])}
        onRemoveCharacterImage={removeCharacterImage}
        onViewCharacterImage={(imageUrl, name) => setImageViewer({ src: imageUrl, title: `${name} · 角色图` })}
        onApproveCharacterAssets={approveCharacterAssets}
        onModifyCharacterAssets={() => { setCharacterAssetsApproval("draft"); setActiveStage("角色"); const first = characterImagePrompts[0]; if (first) openCharacterPrompt(first.profileKey); }}
        onRequestSceneProposals={() => void requestSceneProposals()}
        onApproveSceneProposals={approveSceneProposals}
        onGenerateSceneImages={() => void generateSceneImages()}
        onApproveSceneMainImages={approveSceneMainImages}
        onApproveSceneAssets={approveSceneAssets}
        onSkipSceneAssets={skipSceneAssets}
        onSceneRejectedDraft={setSceneRejectedDraft}
        onValidateSceneRejectedDraft={() => void validateSceneRejectedDraft()}
        onRequestPropProposals={() => void requestPropProposals()}
        onPropRejectedDraft={setPropRejectedDraft}
        onValidatePropRejectedDraft={() => void validatePropRejectedDraft()}
        onApprovePropProposals={approvePropProposals}
        onGeneratePropImages={(propKeys) => void generatePropImages(propKeys)}
        onApprovePropAssets={approvePropAssets}
        onSkipPropDesign={skipPropDesign}
        onStoryboardDuration={setStoryboardSegmentDurationSec}
        onStoryboardPanelCount={updateCurrentStoryboardPanelCount}
        onRequestStoryboardSegments={() => void requestStoryboardSegments()}
        onApproveStoryboardSegments={approveStoryboardSegments}
        onPrepareStoryboardBoards={() => void prepareStoryboardBoardPlans()}
        onRecoverStoryboardBoards={() => void prepareStoryboardBoardPlans(true)}
        onGenerateStoryboardBoards={() => void generateStoryboardBoards()}
        onApproveStoryboardAssets={approveStoryboardAssets}
        onWorkflowBack={() => void returnToPreviousWorkflowStep().catch((caught) => setManagerError(caught instanceof Error ? caught.message : "没有保存本次工作流调整。"))}
        onDirectVideo={() => void generateDirectVideo()}
        onGenerateVideoPrompts={() => void generateVideoPrompts()}
        onOpenVideoPrompt={openVideoPrompt}
        onRepairVideoPrompt={(segmentKey) => void repairVideoPrompt(segmentKey)}
        onRepairProblemVideoPrompts={() => void repairVideoPrompts(videoPrompts.filter((item) => item.status === "needs_revision" && item.prompt.trim()).map((item) => item.segmentKey))}
        onApproveVideoPrompts={approveVideoPrompts}
        onContinueReadyVideoPrompts={continueWithReadyVideoPrompts}
        onGenerateNextVideo={() => void submitUnstartedShotVideos(1)}
        onGenerateRemainingVideos={() => void submitUnstartedShotVideos()}
        onShotContinuityMode={(segmentKey, mode) => setShotContinuityModes((current) => ({ ...current, [segmentKey]: mode }))}
        onModifyVideoPrompt={openVideoPrompt}
        onRefreshH3={() => void refreshH3Status()}
        onStartH3={() => void startPrismH3()}
        onApproveShotVideos={approveShotVideos}
        onGenerateRoughCut={() => void generateRoughCut()}
        onApproveRoughCut={approveRoughCut}
        onSkipSoundDesign={skipSoundDesign}
        onPostProductionPlan={updatePostProductionPlan}
        onGenerateMusicPrompt={() => void generateMusicPrompt()}
        onUpdateMusicPrompt={updateMusicPrompt}
        onMusicSeed={updateMusicSeed}
        onMusicSettings={updateMusicSettings}
        onApproveMusicPrompt={approveMusicPrompt}
        onGenerateLocalMusic={() => void generateMusicWith()}
        onRefreshLocalMusic={() => void refreshLocalMusicStatus()}
        onSkipMusicDesign={skipMusicDesign}
        onGenerateFinalComposition={() => void generateFinalComposition()}
        onManagerMessage={(message, reasoningEffort) => void requestProjectManagerTurn(message, reasoningEffort)}
        onManagerCommand={(entryId, commandId) => void executeManagerCommandWithFeedback(entryId, commandId)}
        onOpenManagerCommandResult={openProjectManagerCommandResult}
        onManagerFollowUp={handleCharacterImageFollowUp}
        onCancelManagerCommand={cancelProjectManagerCommand}
        agentProvider={providerStatuses.find((provider) => provider.kind === "agent")}
        providerSwitchError={providerSwitchError}
        onAgentModel={(profileId) => void activateProviderProfile("agent", profileId)}
      />

      <Workspace onOpenCharacterLibrary={openCharacterLibrary} onRemoveCharacter={removeCharacterProfile} stage={step} activeStage={activeStage} navigationRequest={stageNavigationRequest} directorUiPreview={directorUiPreview} brief={brief} script={ideaScript} seriesMotherScript={seriesMotherScript} episodeScripts={episodeScripts} scriptApproval={scriptApproval} characterStatus={characterStatus} characterProfiles={characterProfiles} characterError={characterError} characterApproval={characterApproval} selectedStyle={selectedStyle} characterImageStatus={characterImageStatus} characterImages={characterImages} characterImagePrompts={characterImagePrompts} characterImageRequestKeys={characterImageRequestKeys} characterAssetsApproval={characterAssetsApproval} characterTurnarounds={characterTurnarounds} sceneStatus={sceneStatus} sceneProposals={sceneProposals} sceneProposalApproval={sceneProposalApproval} sceneImageStatus={sceneImageStatus} sceneImagePrompts={sceneImagePrompts} sceneImages={sceneImages} sceneImageRequestKeys={sceneImageRequestKeys} sceneMainApproval={sceneMainApproval} sceneViews={sceneViews} sceneAssetsApproval={sceneAssetsApproval} sceneAssetsSkipped={sceneAssetsSkipped} propStatus={propStatus} propProposals={propProposals} propProposalApproval={propProposalApproval} propImageStatus={propImageStatus} propImagePrompts={propImagePrompts} propImages={propImages} propImageRequestKeys={propImageRequestKeys} propAssetsApproval={propAssetsApproval} storyboardStatus={storyboardStatus} storyboardSegments={storyboardSegments} storyboardBoardPanelCount={storyboardBoardPanelCount} storyboardBoardStatus={storyboardBoardStatus} storyboardBoardPrompts={storyboardBoardPrompts} storyboardBoards={storyboardBoards} storyboardAssetsApproval={storyboardAssetsApproval} videoPromptStatus={videoPromptStatus} videoPrompts={videoPrompts} videoPromptsApproval={videoPromptsApproval} h3Connection={h3Connection} h3GenerationSettings={h3GenerationSettings} shotVideoTasks={shotVideoTasks} shotContinuityModes={shotContinuityModes} shotVideosApproval={shotVideosApproval} postProduction={postProduction} projectName={projectName} canvasView={canvasView} onCanvasView={setCanvasView} onOpenScript={() => setScriptDetailsOpen(true)} onOpenSeriesPlan={() => setSeriesPlanOpen(true)} onOpenEpisodeScript={setSelectedEpisodeNumber} onOpenEpisodeProduction={(number) => void openEpisodeProduction(number)} episodeOpening={episodeOpening} episodeProductionError={episodeProductionError} onGenerateEpisode={(episodeNumber) => void generateEpisodeFromSeriesPlan(episodeNumber)} onEditPrompt={openCharacterPrompt} onRegenerateImage={(profileKey) => void generateCharacterImages([profileKey])} onGenerateTurnaround={(profileKey) => void generateCharacterTurnaround(profileKey)} onViewImage={(src, title) => setImageViewer({ src, title })} onSaveAsset={saveAssetToLibrary} onOpenAssetLibrary={() => setAssetLibraryOpen(true)} onEditScenePrompt={openScenePrompt} onRegenerateScene={(sceneAssetKey) => void generateSceneImages([sceneAssetKey])} onGenerateSceneView={(sceneAssetKey) => void generateSceneView(sceneAssetKey)} onRecoverSceneViewCandidates={(sceneAssetKey) => void recoverSceneViewCandidates(sceneAssetKey)} onSelectSceneViewCandidate={selectSceneViewCandidate} onEditPropPrompt={openPropPrompt} onRegenerateProp={(propAssetKey) => void generatePropImages([propAssetKey])} onOpenStoryboardText={openStoryboardText} onEditStoryboardPrompt={openStoryboardPrompt} onRegenerateStoryboard={(segmentKey) => void generateStoryboardBoards([segmentKey])} onSelectStoryboardCandidate={selectStoryboardCandidate} onEditVideoPrompt={openVideoPrompt} onRegenerateVideoPrompt={(segmentKey) => void generateVideoPrompts([segmentKey])} onRepairVideoPrompt={(segmentKey) => void repairVideoPrompt(segmentKey)} onRefreshH3={() => void refreshH3Status()} onStartH3={() => void startPrismH3()} onH3Settings={updateH3GenerationSettings} onShotContinuityMode={(segmentKey, mode) => setShotContinuityModes((current) => ({ ...current, [segmentKey]: mode }))} onSubmitShotVideo={(segmentKey) => void submitShotVideo(segmentKey)} onCancelShotVideo={(segmentKey) => void cancelShotVideo(segmentKey)} onApproveShotVideos={approveShotVideos} onGenerateMusicPrompt={() => void generateMusicPrompt()} onUpdateMusicPrompt={updateMusicPrompt} onApproveMusicPrompt={approveMusicPrompt} />
      <CanvasTools onOpenAssets={() => setAssetLibraryOpen(true)} />
      <ZoomControl zoom={canvasView.zoom} onChange={(zoom) => setCanvasView((current) => ({ ...current, zoom }))} onReset={() => setCanvasView(defaultCanvasView())} />
      </> : canvasMode === "free" ? <FreeCanvasWorkspace projectId={activeProjectId} state={freeCanvas} sources={directorCanvasSources} providers={providerStatuses} onProviderProfile={(kind, profileId) => void activateProviderProfile(kind, profileId)} onChange={changeProjectCanvas} onReturnToDirector={returnToDirector} onOptimizePrompt={optimizeFreeCanvasPrompt} onGenerateImage={generateFreeCanvasImage} onProcessImage={processFreeCanvasImage} onGenerateVideo={generateFreeCanvasVideo} onGenerateAudio={generateFreeCanvasAudio} onImportMedia={importFreeCanvasMedia} /> : <SimpleEditor state={editor} assets={editorAssets} onChange={setEditor} onImportMedia={importEditorMedia} onRender={renderEditorComposition} onViewImage={(src, title) => setImageViewer({src, title})} />}
      {settingsOpen && <SettingsModal onClose={() => { setSettingsOpen(false); void refreshProviderStatuses().catch(() => undefined); }} onProvidersChange={setProviderStatuses} onCreativeDefaults={(defaults) => { appCreativeDefaultsRef.current = defaults; updateCurrentStoryboardPanelCount(defaults.storyboardBoardPanelCount); }} />}
      {scriptDetailsOpen && ideaScript && <ScriptDetailsModal script={ideaScript} projectName={projectName} onProjectName={(value) => void renameCurrentProject(value)} brief={brief} scriptApproval={scriptApproval} episodeNumber={ideaScript.episodeNumber || 1} onClose={() => setScriptDetailsOpen(false)} />}
      {seriesPlanOpen && ideaScript?.workType === "series" && <SeriesPlanModal script={seriesMotherScript || ideaScript} brief={brief} onClose={() => setSeriesPlanOpen(false)} />}
      {selectedEpisodeNumber !== null && episodeScripts.find((item) => item.episodeNumber === selectedEpisodeNumber)?.script && <ScriptDetailsModal script={episodeScripts.find((item) => item.episodeNumber === selectedEpisodeNumber)!.script!} projectName={projectName} onProjectName={(value) => void renameCurrentProject(value)} brief={brief} scriptApproval={episodeScripts.find((item) => item.episodeNumber === selectedEpisodeNumber)!.approval} episodeNumber={selectedEpisodeNumber} onClose={() => setSelectedEpisodeNumber(null)} />}
      {characterProfileEditor && <CharacterProfileModal profile={characterProfileEditor} onChange={(patch) => setCharacterProfileEditor((current) => current ? { ...current, ...patch } : current)} onClose={() => setCharacterProfileEditor(null)} onSave={() => saveCharacterProfile(characterProfileEditor)} />}
      {promptEditorKey && <CharacterPromptModal profile={characterProfiles.find((item) => item.profileKey === promptEditorKey)} value={promptEditorText} busy={characterImageRequestKeys.includes(promptEditorKey)} onChange={setPromptEditorText} onClose={() => { setPromptEditorKey(""); setPromptEditorText(""); }} onSave={() => { updateCharacterPrompt(promptEditorKey, promptEditorText); setPromptEditorKey(""); setPromptEditorText(""); }} onRegenerate={() => { const key = promptEditorKey; const next = updateCharacterPrompt(key, promptEditorText); setPromptEditorKey(""); setPromptEditorText(""); void generateCharacterImages([key], next); }} />}
      {scenePromptEditorKey && <ScenePromptModal proposal={sceneProposals.find((item) => item.sceneAssetKey === scenePromptEditorKey)} value={scenePromptEditorText} busy={sceneImageRequestKeys.includes(scenePromptEditorKey)} onChange={setScenePromptEditorText} onClose={() => { setScenePromptEditorKey(""); setScenePromptEditorText(""); }} onSave={() => { updateScenePrompt(scenePromptEditorKey, scenePromptEditorText); setScenePromptEditorKey(""); setScenePromptEditorText(""); }} onRegenerate={() => { const key = scenePromptEditorKey; const next = updateScenePrompt(key, scenePromptEditorText); setScenePromptEditorKey(""); setScenePromptEditorText(""); void generateSceneImages([key], next); }} />}
      {propPromptEditorKey && <PropPromptModal proposal={propProposals.find((item) => item.propAssetKey === propPromptEditorKey)} value={propPromptEditorText} busy={propImageRequestKeys.includes(propPromptEditorKey)} onChange={setPropPromptEditorText} onClose={() => { setPropPromptEditorKey(""); setPropPromptEditorText(""); }} onSave={() => { updatePropPrompt(propPromptEditorKey, propPromptEditorText); setPropPromptEditorKey(""); setPropPromptEditorText(""); }} onRegenerate={() => { const key = propPromptEditorKey; const next = updatePropPrompt(key, propPromptEditorText); setPropPromptEditorKey(""); setPropPromptEditorText(""); void generatePropImages([key], next); }} />}
      {storyboardTextEditorKey && <StoryboardTextModal segment={storyboardSegments.find((item) => item.segmentKey === storyboardTextEditorKey)} value={storyboardTextEditorText} onChange={setStoryboardTextEditorText} onClose={() => { setStoryboardTextEditorKey(""); setStoryboardTextEditorText(""); }} onSave={() => { updateStoryboardText(storyboardTextEditorKey, storyboardTextEditorText); setStoryboardTextEditorKey(""); setStoryboardTextEditorText(""); }} />}
      {storyboardPromptEditorKey && <StoryboardPromptModal segment={storyboardSegments.find((item) => item.segmentKey === storyboardPromptEditorKey)} value={storyboardPromptEditorText} busy={storyboardBoardRequestKeys.includes(storyboardPromptEditorKey)} onChange={setStoryboardPromptEditorText} onClose={() => { setStoryboardPromptEditorKey(""); setStoryboardPromptEditorText(""); }} onSave={() => { updateStoryboardPrompt(storyboardPromptEditorKey, storyboardPromptEditorText); setStoryboardPromptEditorKey(""); setStoryboardPromptEditorText(""); }} onRegenerate={() => { const key = storyboardPromptEditorKey; const next = updateStoryboardPrompt(key, storyboardPromptEditorText); setStoryboardPromptEditorKey(""); setStoryboardPromptEditorText(""); void generateStoryboardBoards([key], next); }} />}
      {videoPromptEditorKey && <VideoPromptModal segment={storyboardSegments.find((item) => item.segmentKey === videoPromptEditorKey)} result={videoPrompts.find((item) => item.segmentKey === videoPromptEditorKey)} value={videoPromptEditorText} busy={videoPrompts.find((item) => item.segmentKey === videoPromptEditorKey)?.status === "running"} videoTask={shotVideoTasks.find((item) => item.segmentKey === videoPromptEditorKey)} onChange={setVideoPromptEditorText} onClose={closeVideoPromptEditor} onSave={() => confirmCurrentVideoPrompt(videoPromptEditorKey, videoPromptEditorText)} onSaveAndGenerate={() => void saveVideoPromptAndGenerate(videoPromptEditorKey, videoPromptEditorText)} onRepair={() => void repairVideoPrompt(videoPromptEditorKey)} onRegenerate={() => void regenerateVideoPromptInEditor(videoPromptEditorKey)} />}
      {imageViewer && <ImageViewerModal src={imageViewer.src} title={imageViewer.title} onClose={() => setImageViewer(null)} />}
      {projectManagerOpen && <ProjectManagerModal projects={projects} busy={projectManagerBusy} error={projectManagerError} onClose={() => { if (!projectManagerBusy) setProjectManagerOpen(false); }} onCreate={() => void createProject()} onSelect={(id) => void selectProject(id)} onRename={(id, name) => void renameProject(id, name)} />}
      {characterLibraryOpen && <CharacterLibraryPanel currentProfiles={characterProfiles} projectId={activeProjectId} target={characterLibraryTarget ? (() => { const profile = characterProfiles.find(item => item.profileKey === characterLibraryTarget); return profile ? { profileKey: profile.profileKey, name: profile.name, identityId: profile.libraryBinding?.identityId } : undefined; })() : undefined} onAction={changeCharacters} onUpload={async file => (await importFreeCanvasMedia(file, file.name, "image")).mediaUrl} onClose={() => setCharacterLibraryOpen(false)} />}
      {assetLibraryOpen && <AssetLibraryModal refreshKey={assetLibraryRefresh} targets={[...characterProfiles.map((item) => ({ type: "character" as const, key: item.profileKey, name: item.name })), ...sceneProposals.filter((item) => item.selectedForProduction !== false).map((item) => ({ type: "scene" as const, key: item.sceneAssetKey, name: item.name })), ...propProposals.filter((item) => item.selectedForProduction !== false).map((item) => ({ type: "prop" as const, key: item.propAssetKey, name: item.name }))]} onImportCharacter={async (assetId, profileKey) => { await changeCharacters({ action: "import", assetId, profileKey }); }} onApply={applyAssetFromLibrary} onUndo={undoAssetFromLibrary} onClose={() => setAssetLibraryOpen(false)} onViewImage={(src, title) => setImageViewer({ src, title })} />}
    </main>
  );
}

function SettingsGearIcon() {
  return <svg className="settings-gear-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

function BackArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5M8.5 12H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function GenerationPresetControl({ presets, preset, history, imageProvider, imageEditProvider, videoSettingsAvailable, onStyle, onRatio, onImageResolution, onImageModel, onVideoSettings }: {
  presets: StylePreset[];
  preset: GenerationPresetSnapshot;
  history: GenerationPresetSnapshot[];
  imageProvider?: ProviderPublicStatus;
  imageEditProvider?: ProviderPublicStatus;
  videoSettingsAvailable: boolean;
  onStyle: (styleId: string) => void;
  onRatio: (ratio: GenerationAspectRatio) => void;
  onImageResolution: (imageResolution: ImageResolutionTier) => void;
  onImageModel: (kind: "image" | "image-edit", profileId: string) => void;
  onVideoSettings: () => void;
}) {
  const [open, setOpen] = useState<"style" | "ratio" | "resolution" | "model" | null>(null);
  const controlRef = useRef<HTMLElement | null>(null);
  const selectedStyle = presets.find((item) => item.id === preset.styleId);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !controlRef.current?.contains(target)) setOpen(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [open]);
  return <aside ref={controlRef} className="generation-preset-control" aria-label="当前生成预设">
    <div className="generation-preset-buttons">
      <button type="button" className={open === "style" ? "active" : ""} aria-label={`风格：${selectedStyle?.name || "真人电影写实"}`} title={selectedStyle?.name || "真人电影写实"} aria-expanded={open === "style"} onClick={() => setOpen((current) => current === "style" ? null : "style")}>
        <span>风格</span><DisclosureChevron />
      </button>
      <button type="button" className={open === "ratio" ? "active" : ""} aria-label={`生成比例：${preset.aspectRatio}`} aria-expanded={open === "ratio"} onClick={() => setOpen((current) => current === "ratio" ? null : "ratio")}>
        <span>{preset.aspectRatio}</span><DisclosureChevron />
      </button>
      <button type="button" className={open === "resolution" ? "active" : ""} aria-label={`图片分辨率：${preset.imageResolution.toUpperCase()}`} aria-expanded={open === "resolution"} onClick={() => setOpen((current) => current === "resolution" ? null : "resolution")}>
        <span>{preset.imageResolution.toUpperCase()}</span><DisclosureChevron />
      </button>
      <button type="button" className={open === "model" ? "active" : ""} aria-label={`图片模型：${imageProvider?.profiles.find((profile) => profile.active)?.name || "未配置"}`} aria-expanded={open === "model"} onClick={() => setOpen((current) => current === "model" ? null : "model")}>
        <span>图片模型</span><DisclosureChevron />
      </button>
      <button type="button" className="video-parameters-trigger" aria-label="视频参数" title={videoSettingsAvailable ? "定位到视频参数" : "确认剧本后可设置视频参数"} disabled={!videoSettingsAvailable} onClick={() => { setOpen(null); onVideoSettings(); }}>
        <span>视频参数</span>
      </button>
    </div>
    {open && <div className={`generation-preset-popover preset-${open}`}>
      <header><div><small>当前生成预设</small><strong>{open === "style" ? "选择后续画风" : open === "ratio" ? "选择后续画面比例" : open === "resolution" ? "选择后续图片分辨率" : "选择后续图片模型"}</strong></div><span>{open === "model" ? `${(imageProvider?.profiles.length || 0) + (imageEditProvider?.profiles.length || 0)} 个` : `v${preset.version}`}</span></header>
      {open === "style" ? <div className="generation-style-options">{presets.map((item) => <button type="button" key={item.id} title={item.description} className={item.id === preset.styleId ? "selected" : ""} onClick={() => { onStyle(item.id); setOpen(null); }}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="generation-style-fallback" style={{ "--preset-a": item.previewPalette[0], "--preset-b": item.previewPalette[1] } as React.CSSProperties} />}
        <span><strong>{item.name}</strong><small>{item.category} · {item.description}</small></span>{item.id === preset.styleId && <i aria-hidden="true">✓</i>}
      </button>)}</div> : open === "ratio" ? <div className="generation-ratio-options">{GENERATION_ASPECT_RATIOS.map((item) => <button type="button" key={item} className={item === preset.aspectRatio ? "selected" : ""} onClick={() => { onRatio(item); setOpen(null); }}><span className={`generation-ratio-shape ratio-${item.replace(':', '-')}`} aria-hidden="true" /><strong>{item}</strong>{item === preset.aspectRatio && <i aria-hidden="true">✓</i>}</button>)}</div> : open === "resolution" ? <div className="generation-resolution-options">{IMAGE_RESOLUTION_TIERS.map((item) => {
        const size = imageRequestSizeForAspectRatio(preset.aspectRatio, item);
        return <button type="button" key={item} className={item === preset.imageResolution ? "selected" : ""} onClick={() => { onImageResolution(item); setOpen(null); }}><strong>{item.toUpperCase()}</strong><small>{size.width}×{size.height}</small>{item === preset.imageResolution && <i aria-hidden="true">✓</i>}</button>;
      })}</div> : <div className="generation-model-groups"><section><header><strong>图片生成</strong><small>人物、场景与道具主图</small></header><div className="generation-model-options">{imageProvider?.profiles.length ? imageProvider.profiles.map((profile) => <button type="button" key={profile.id} className={profile.active ? "selected" : ""} onClick={() => onImageModel("image", profile.id)}><span><strong>{profile.name}</strong><small>{profile.model}</small></span>{profile.active && <i aria-hidden="true">✓</i>}</button>) : <p>请先在设置中添加图片生成模型。</p>}</div></section><section><header><strong>参考图编辑</strong><small>多视图与故事板</small></header><div className="generation-model-options">{imageEditProvider?.profiles.length ? imageEditProvider.profiles.map((profile) => <button type="button" key={profile.id} className={profile.active ? "selected" : ""} onClick={() => onImageModel("image-edit", profile.id)}><span><strong>{profile.name}</strong><small>{profile.model}</small></span>{profile.active && <i aria-hidden="true">✓</i>}</button>) : <p>请先在设置中添加参考图编辑模型。</p>}</div></section></div>}
      <footer><strong>从下一次图片提交开始生效</strong><span>已完成结果保持原参数；切换模型不会重提已有任务。</span><small>{open === "model" ? "模型配置保存在这台电脑" : `本项目已保存 ${history.length} 个预设版本`}</small></footer>
    </div>}
  </aside>;
}

function Header({
  projectName,
  saveStatus,
  activeStage,
  canvasMode,
  canvasStatusText,
  canvasStatusPending,
  canvasStatusConfirmed,
  h3Connection,
  onCanvasMode,
  onStageChange,
  onRefreshH3,
  onOpenH3,
  onOpenSettings,
  onOpenProjects,
}: {
  projectName: string;
  saveStatus: "loading" | "saving" | "saved" | "error";
  activeStage: string;
  canvasMode: CanvasMode;
  canvasStatusText: string;
  canvasStatusPending: boolean;
  canvasStatusConfirmed: boolean;
  h3Connection: H3Connection;
  onCanvasMode: (mode: CanvasMode) => void;
  onStageChange: (stage: string) => void;
  onRefreshH3: () => void;
  onOpenH3: () => void;
  onOpenSettings: () => void;
  onOpenProjects: () => void;
}) {
  const saveLabel = saveStatus === "saved" ? "已保存到本机" : saveStatus === "saving" ? "正在保存" : saveStatus === "error" ? "保存失败" : "正在读取";
  const details = h3Connection.health?.details || {};
  const running = Number(details.running || 0);
  const pending = Number(details.pending || 0);
  const queueCount = running + pending;
  const localGpuActive = h3Connection.localGpu?.busy ? h3Connection.localGpu.active : undefined;
  const busy = Boolean(localGpuActive) || h3Connection.status === "online" && (h3Connection.health?.status === "queue_busy" || queueCount > 0);
  const consoleOnline = Boolean(details.prismVersion);
  const state = h3Connection.status === "checking"
    ? "checking"
    : h3Connection.status === "starting"
      ? "starting"
      : busy
        ? "busy"
        : h3Connection.status === "online"
          ? "online"
          : h3Connection.status === "offline" && consoleOnline
            ? "backend-offline"
            : h3Connection.status === "offline"
              ? "console-offline"
              : "idle";
  const statusLabel = state === "checking" ? "正在检查"
    : state === "starting" ? "正在启动"
      : state === "busy" ? localGpuActive?.label || `生成中${queueCount ? ` · ${queueCount}` : ""}`
        : state === "online" ? "视频后端已就绪"
          : state === "backend-offline" ? "视频后端未启动"
            : state === "console-offline" ? "H3 工作台未启动"
              : "H3 尚未检查";
  const actionLabel = state === "starting" ? "正在启动并连接"
    : state === "checking" ? "正在重新连接"
      : state === "online" || state === "busy" || state === "backend-offline" ? "打开 H3 工作台"
        : "启动并连接";
  const statusMessage = localGpuActive
    ? "本机GPU已进入独占任务；PRISM H3、ACE-Step与图片超分会按顺序使用显存。"
    : h3Connection.health?.message || h3Connection.error || "启动 PRISM H3 工作台后，ComfyUI 作为后台服务运行，不会自动打开后端网页。";
  return (
    <header className="topbar">
      <div className="topbar-leading">
        <button className={`project-pill save-${saveStatus}`} aria-label={`打开项目管理，PRISM Story Studio，当前项目：${projectName}，${saveLabel}`} onClick={onOpenProjects}>
          <span className="brand-mark" aria-hidden="true"><img src="/assets/brand/prism-mark.svg" alt="" /></span>
          <span className="project-identity"><strong className="product-name">PRISM <span>STORY STUDIO</span></strong><small><span className="header-project-name">{projectName}</span><i aria-hidden="true" />{saveLabel}</small></span>
          <DisclosureChevron className="project-menu-icon" />
        </button>
        {canvasMode === "director" && <div className={`topbar-canvas-status ${canvasStatusConfirmed ? "confirmed" : ""}`} role="status">
          {canvasStatusConfirmed ? <ConfirmedIndicator label={canvasStatusText} /> : <><span className={canvasStatusPending ? "amber-dot" : "green-dot"} />{canvasStatusText}</>}
        </div>}
      </div>

      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button className={canvasMode === "director" ? "active" : ""} onClick={() => onCanvasMode("director")}>导演模式</button>
        <button className={canvasMode === "free" ? "active" : ""} onClick={() => onCanvasMode("free")}>自由画布</button>
        <button className={canvasMode === "editor" ? "active" : ""} onClick={() => onCanvasMode("editor")}>剪辑台</button>
      </div>

      {canvasMode === "director" ? <nav className="stage-nav" aria-label="制作阶段">
        {stageItems.map((item) => (
        <button
          key={item}
          className={activeStage === item ? "active" : ""}
          aria-current={activeStage === item ? "page" : undefined}
          onClick={() => onStageChange(item)}
        >
          {item}
        </button>
        ))}
      </nav> : null}

      <div className="top-actions">
        <div className={`h3-launcher h3-${state}`}>
          <button className="h3-status" type="button" onClick={onRefreshH3} disabled={state === "checking" || state === "starting"} aria-label={`${statusLabel}，点击刷新`}>
            <span className="h3-state-orbit" aria-hidden="true"><i /></span>
            <span><small>{localGpuActive ? "本机 GPU" : "PRISM H3"}</small><strong>{statusLabel}</strong></span>
          </button>
          <button className="h3-launch-button" type="button" onClick={onOpenH3} disabled={state === "checking" || state === "starting"}>
            <span className="h3-launch-glyph" aria-hidden="true">H3</span>
            <span>{actionLabel}</span>
            <i aria-hidden="true">↗</i>
          </button>
          <div className="h3-status-popover" role="status">
            <div><span className="h3-state-orbit" aria-hidden="true"><i /></span><strong>{statusLabel}</strong></div>
            <p>{statusMessage}</p>
            <small>{localGpuActive ? `任务 ${localGpuActive.taskId}` : queueCount ? `运行 ${running} · 排队 ${pending}` : "工作台窗口可见 · ComfyUI 网页不弹出"}</small>
          </div>
        </div>
        <button className="avatar-button settings-trigger" aria-label="打开设置" onClick={onOpenSettings}><SettingsGearIcon /></button>
      </div>
    </header>
  );
}

type Brief = { workType: WorkType; creativeDirection: CreativeDirection; duration: string; ratio: string; language: string; emotion: string; episodeCount: string };

const AgentActionHostContext = createContext<HTMLElement | null>(null);

function StageFinalActions({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const host = useContext(AgentActionHostContext);
  const content = <div className={[className, "stage-final-confirmation"].filter(Boolean).join(" ")}>{children}</div>;
  return host ? createPortal(content, host) : content;
}

function AgentPanel(props: {
  workflow: WorkflowSnapshot;
  activeStage: string;
  directorUiPreview: boolean;
  step: SetupStep;
  projectName: string;
  onProjectName: (value: string) => void;
  creationSource: CreationSource;
  workType: WorkType;
  creativeDirection: CreativeDirection;
  brief: Brief;
  novelText: string;
  novelName: string;
  duration: string;
  customDurationSec: string;
  episodeCountMode: "agent" | "fixed";
  episodeCount: string;
  ratio: string;
  language: string;
  emotion: string;
  customEmotion: string;
  emotionRecommendations: ToneOption[];
  emotionRecommendationBusy: boolean;
  emotionRecommendationError: string;
  onRetryEmotionRecommendations: () => void;
  onDuration: (value: string) => void;
  onCustomDurationSec: (value: string) => void;
  onEpisodeCountMode: (value: "agent" | "fixed") => void;
  onEpisodeCount: (value: string) => void;
  onWorkType: (value: WorkType) => void;
  onCreativeDirection: (value: CreativeDirection) => void;
  onRatio: (value: string) => void;
  onLanguage: (value: string) => void;
  onEmotion: (value: string) => void;
  onCustomEmotion: (value: string) => void;
  onNovelText: (value: string) => void;
  onNovelName: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onPrepareSplit: () => void;
  novelBusy: boolean;
  novelError: string;
  onOpenSettings: () => void;
  ideaText: string;
  ideaAnswers: IdeaAnswer[];
  ideaAnswer: string;
  ideaQuestion: string;
  ideaOptions: IdeaDirectionOption[];
  agentTranscript: AgentTranscriptEntry[];
  managerTranscript: ManagerTranscriptEntry[];
  managerBusy: boolean;
  managerError: string;
  ideaScript: IdeaScript | null;
  scriptApproval: ScriptApproval;
  scriptRevisionText: string;
  scriptRevisionOpen: boolean;
  scriptRevisionBusy: boolean;
  scriptRevisionError: string;
  characterStatus: CharacterStageStatus;
  characterProfiles: CharacterProfile[];
  characterError: string;
  characterApproval: ScriptApproval;
  stylePresets: StylePreset[];
  selectedStyleId: string;
  characterImageStatus: CharacterImageStatus;
  characterImages: CharacterImageResult[];
  characterImagePrompts: CharacterImagePrompt[];
  characterImageRequestKeys: string[];
  characterAssetsApproval: ScriptApproval;
  characterImageError: string;
  sceneStatus: SceneStageStatus;
  sceneProposals: SceneVisualProposal[];
  sceneError: string;
  sceneRejectedDraft: string;
  sceneRejectedIssues: string[];
  sceneProposalApproval: ScriptApproval;
  sceneImageStatus: SceneStageStatus;
  sceneImages: SceneImageResult[];
  sceneImageRequestKeys: string[];
  sceneImageError: string;
  sceneMainApproval: ScriptApproval;
  sceneViews: SceneViewResult[];
  sceneAssetsApproval: ScriptApproval;
  propStatus: SceneStageStatus;
  propProposals: PropVisualProposal[];
  propError: string;
  propRejectedDraft: string;
  propRejectedIssues: string[];
  propProposalApproval: ScriptApproval;
  propImageStatus: SceneStageStatus;
  propImages: PropImageResult[];
  propImageRequestKeys: string[];
  propImageError: string;
  propAssetsApproval: ScriptApproval;
  storyboardSegmentDurationSec: number;
  storyboardBoardPanelCount: StoryboardBoardPanelCount;
  storyboardStatus: SceneStageStatus;
  storyboardSegments: StoryboardSegment[];
  storyboardWarnings: string[];
  storyboardError: string;
  storyboardApproval: ScriptApproval;
  storyboardBoardStatus: SceneStageStatus;
  storyboardBoardPlans: StoryboardBoardPlan[];
  storyboardBoardPrompts: StoryboardBoardPrompt[];
  storyboardBoards: StoryboardBoardResult[];
  storyboardBoardError: string;
  storyboardBoardRejectedDraft: string;
  storyboardBoardRejectedIssues: string[];
  storyboardAssetsApproval: ScriptApproval;
  videoPromptStatus: SceneStageStatus;
  videoPrompts: VideoPromptResult[];
  videoPromptError: string;
  videoPromptsApproval: ScriptApproval;
  directVideoBusy: boolean;
  directVideoError: string;
  h3Connection: H3Connection;
  h3GenerationSettings: H3GenerationSettings;
  shotVideoTasks: ShotVideoTask[];
  shotContinuityModes: Record<string, ShotContinuityMode>;
  shotVideosApproval: ScriptApproval;
  shotVideoBatchSubmitting: boolean;
  postProduction: PostProductionState;
  localMusicConnection: LocalMusicConnection;
  ideaBusy: boolean;
  ideaError: string;
  onIdeaText: (value: string) => void;
  onIdeaAnswer: (value: string) => void;
  onChooseNovel: () => void;
  onChooseIdea: () => void;
  onSubmitIdeaAnswer: () => void;
  onFinishQuestions: () => void;
  onRetryIdea: () => void;
  onOpenScript: () => void;
  onRevisionText: (value: string) => void;
  onOpenRevision: () => void;
  onCancelRevision: () => void;
  onSubmitRevision: () => void;
  onRestart: () => void;
  onAcceptIdeaScript: () => void;
  onRetryCharacterDesign: () => void;
  onSkipCharacterProfiles: () => void;
  characterTools: React.ReactNode; onManageCharacter: (profileKey?: string) => void;
  onRemoveCharacterProfile: (profileKey: string) => void;
  onApproveCharacters: () => void;
  onGenerateAssetBatch: (kind: AssetBatchKind, retry?: boolean) => void;
  onGenerateCharacterImage: (profileKey: string) => void;
  onRemoveCharacterImage: (profileKey: string) => void;
  onViewCharacterImage: (imageUrl: string, name: string) => void;
  onApproveCharacterAssets: () => void;
  onModifyCharacterAssets: () => void;
  onRequestSceneProposals: () => void;
  onApproveSceneProposals: (selectedKeys: string[]) => void;
  onGenerateSceneImages: () => void;
  onApproveSceneMainImages: () => void;
  onApproveSceneAssets: () => void;
  onSkipSceneAssets: () => void;
  onSceneRejectedDraft: (value: string) => void;
  onValidateSceneRejectedDraft: () => void;
  onRequestPropProposals: () => void;
  onPropRejectedDraft: (value: string) => void;
  onValidatePropRejectedDraft: () => void;
  onApprovePropProposals: (selectedKeys: string[]) => void;
  onGeneratePropImages: (propKeys?: string[]) => void;
  onApprovePropAssets: () => void;
  onSkipPropDesign: () => void;
  onStoryboardDuration: (durationSec: number) => void;
  onStoryboardPanelCount: (panelCount: StoryboardBoardPanelCount) => void;
  onRequestStoryboardSegments: () => void;
  onApproveStoryboardSegments: () => void;
  onPrepareStoryboardBoards: () => void;
  onRecoverStoryboardBoards: () => void;
  onGenerateStoryboardBoards: () => void;
  onApproveStoryboardAssets: () => void;
  onWorkflowBack: () => void;
  onDirectVideo: () => void;
  onGenerateVideoPrompts: () => void;
  onOpenVideoPrompt: (segmentKey: string) => void;
  onRepairVideoPrompt: (segmentKey: string) => void;
  onRepairProblemVideoPrompts: () => void;
  onApproveVideoPrompts: () => void;
  onContinueReadyVideoPrompts: () => void;
  onGenerateNextVideo: () => void;
  onGenerateRemainingVideos: () => void;
  onShotContinuityMode: (segmentKey: string, mode: ShotContinuityMode) => void;
  onModifyVideoPrompt: (segmentKey: string) => void;
  onRefreshH3: () => void;
  onStartH3: () => void;
  onApproveShotVideos: () => void;
  onGenerateRoughCut: () => void;
  onApproveRoughCut: () => void;
  onSkipSoundDesign: () => void;
  onPostProductionPlan: (patch: Partial<Pick<PostProductionState, "view" | "audioMode" | "subtitles">>) => void;
  onGenerateMusicPrompt: () => void;
  onUpdateMusicPrompt: (value: string) => void;
  onMusicSeed: (value: number) => void;
  onMusicSettings: (patch: Partial<Pick<PostProductionState, "musicBpm" | "musicKeyScale" | "musicTimeSignature" | "musicInferenceSteps" | "musicThinking">>) => void;
  onApproveMusicPrompt: () => void;
  onGenerateLocalMusic: () => void;
  onRefreshLocalMusic: () => void;
  onSkipMusicDesign: () => void;
  onGenerateFinalComposition: () => void;
  onManagerMessage: (message: string, reasoningEffort: TextReasoningEffort) => void;
  onManagerCommand: (entryId: string, commandId: string) => void;
  onOpenManagerCommandResult: (entryId: string, commandId: string) => void;
  onManagerFollowUp: (entryId: string, commandId: string, choice: ProjectManagerFollowUpChoice) => void;
  onCancelManagerCommand: (entryId: string, commandId: string) => void;
  agentProvider?: ProviderPublicStatus;
  providerSwitchError: string;
  onAgentModel: (profileId: string) => void;
}) {
  const [managerDraft, setManagerDraft] = useState("");
  const [managerReasoningEffort, setManagerReasoningEffort] = useState<TextReasoningEffort>("medium");
  const [studioRecordOpen, setStudioRecordOpen] = useState(false);
  const [agentActionHost, setAgentActionHost] = useState<HTMLDivElement | null>(null);
  const [agentActionUpdatedAt, setAgentActionUpdatedAt] = useState(() => new Date().toISOString());
  const agentScrollRef = useRef<HTMLDivElement | null>(null);
  const agentActionSignature = [
    props.step,
    props.ideaQuestion,
    props.ideaOptions.map((option) => option.id).join(","),
    props.ideaAnswers.length,
    props.ideaBusy,
    props.ideaError,
    props.emotionRecommendationBusy,
    props.emotionRecommendationError,
    props.emotionRecommendations.map((option) => option.name).join(","),
    props.novelBusy,
    props.novelError,
    props.scriptRevisionOpen,
    props.scriptRevisionBusy,
    props.scriptRevisionError,
    props.scriptApproval,
    props.characterStatus,
    props.characterApproval,
    props.characterAssetsApproval,
    props.sceneStatus,
    props.sceneProposalApproval,
    props.sceneAssetsApproval,
    props.propStatus,
    props.propProposalApproval,
    props.propAssetsApproval,
    props.storyboardStatus,
    props.storyboardApproval,
    props.storyboardBoardStatus,
    props.storyboardAssetsApproval,
    props.videoPromptStatus,
    props.videoPromptsApproval,
    props.directVideoBusy,
    props.directVideoError,
    props.h3Connection.status,
    props.shotVideoBatchSubmitting,
    props.shotVideoTasks.length,
    props.shotVideosApproval,
    props.postProduction.view,
    props.postProduction.roughCut.status,
    props.postProduction.musicPrompt.status,
    props.postProduction.music.status,
  ].join("|");
  const managerCommandSignature = props.managerTranscript.flatMap((entry) => entry.commands || []).map((command) => `${command.id}:${command.status}:${command.completedAt || ""}`).join("|");
  useEffect(() => {
    setAgentActionUpdatedAt(new Date().toISOString());
  }, [agentActionSignature]);
  useLayoutEffect(() => {
    const scrollToLatest = () => {
      const container = agentScrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    scrollToLatest();
    const frame = requestAnimationFrame(scrollToLatest);
    const settleTimer = window.setTimeout(scrollToLatest, 120);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settleTimer); };
  }, [props.agentTranscript.length, props.managerTranscript.length, managerCommandSignature, props.managerBusy, props.managerError, props.workflow.revision, agentActionHost, agentActionSignature]);
  const submitManagerDraft = () => {
    const message = managerDraft.trim();
    if (!message || props.managerBusy) return;
    props.onManagerMessage(message, managerReasoningEffort);
    setManagerDraft("");
  };
  const historyItems: React.ReactNode[] = [];
  const addHistory = (key: string, index: string, title: string, summary: React.ReactNode) => historyItems.push(
    <article className="agent-history-entry" key={key}>
      <span className="agent-history-index">{index}</span>
      <div><strong>{title}</strong><p>{summary}</p></div>
      <ConfirmedIndicator label="已留存" className="history-confirmed" />
    </article>,
  );
  const setupRecorded = ["idea-questions", "idea-script", "workspace"].includes(props.step);
  if (setupRecorded) addHistory("brief", "01", "项目设定", <>{workTypeLabel(props.brief.workType)} · {creativeDirectionLabel(props.brief.creativeDirection)}{props.brief.workType === "series" ? ` · ${props.brief.episodeCount}` : ""} · {props.brief.duration} · {props.brief.ratio} · {props.brief.language} · {props.brief.emotion}</>);
  if (props.scriptApproval === "approved" && props.ideaScript) addHistory("script", "02", `剧本《${props.ideaScript.title}》`, <>{props.ideaScript.scenes.length} 场 · {props.ideaScript.durationSec} 秒；{props.ideaScript.logline}</>);
  if (props.characterAssetsApproval === "approved") {
    const imageProfileKeys = new Set(props.characterImages.filter((item) => item.status === "complete" && item.imageUrl).map((item) => item.profileKey));
    const imageProfiles = props.characterProfiles.filter((profile) => imageProfileKeys.has(profile.profileKey));
    addHistory("characters", "03", imageProfiles.length > 0 ? "角色参考" : "视觉风格", imageProfiles.length > 0 ? <>{imageProfiles.map((profile) => profile.name).join("、")} · {imageProfiles.length} 张角色图已作为图片参考，其余角色使用完整文字设定</> : <>全片统一视觉风格 · 角色使用完整文字设定</>);
  }
  if (props.sceneAssetsApproval === "approved") { const count = props.sceneProposals.filter((item) => item.selectedForProduction !== false).length; addHistory("scenes", "04", count > 0 ? "场景资产" : "场景按分镜生成", <>{count > 0 ? `${count} 个固定场景已保留` : "场景使用完整文字设定"}</>); }
  if (props.propAssetsApproval === "approved") { const count = props.propProposals.filter((item) => item.selectedForProduction !== false).length; addHistory("props", "05", count > 0 ? "道具资产" : "道具按分镜生成", <>{count > 0 ? `${count} 个固定道具已保留` : "道具使用完整文字设定"}</>); }
  if (props.storyboardAssetsApproval === "approved") addHistory("storyboards", "06", "分镜资产", <>{props.storyboardSegments.length} 段分镜 · 每段固定 {props.storyboardSegmentDurationSec} 秒</>);
  if (props.videoPromptsApproval === "approved") addHistory("video-prompts", "07", "视频提示词", <>{props.videoPrompts.length} 段独立提示词已保留</>);
  if (props.shotVideosApproval === "approved") addHistory("shot-videos", "08", "镜头视频", <>{props.shotVideoTasks.filter((task) => task.status === "awaiting_review").length} 段本机视频结果已保留</>);
  if (props.postProduction.roughCutApproval === "approved") addHistory("rough-cut", "09", "粗剪", <>{props.postProduction.roughCut.clipCount || props.storyboardSegments.length} 段 · {props.postProduction.roughCut.durationSec?.toFixed(1) || "—"} 秒</>);
  const currentStageOutcome = props.workflow.stages[currentWorkflowStage(props.workflow)];
  const currentStageView = toStageViewModel(currentStageOutcome);
  const latestIdeaAnswer = [...props.agentTranscript].reverse().find((entry) => entry.role === "user" && entry.kind === "answer");
  const ideaScriptRequested = latestIdeaAnswer?.text.trim() === "不再追问，直接生成剧本";
  const currentRole = props.shotVideosApproval === "approved" ? { label: "后期导演", image: "/assets/roles/post-production-director.webp" }
    : props.videoPromptsApproval === "approved" ? { label: "视频生成导演", image: "/assets/roles/local-video-director.webp" }
    : props.storyboardAssetsApproval === "approved" ? { label: "视频提示词导演", image: "/assets/roles/video-prompt-director.webp" }
    : props.propAssetsApproval === "approved" ? { label: "分镜师", image: "/assets/roles/storyboard-artist.webp" }
    : props.sceneAssetsApproval === "approved" ? { label: "道具设计师", image: "/assets/roles/prop-designer.webp" }
    : props.characterAssetsApproval === "approved" ? { label: "场景设计师", image: "/assets/roles/scene-designer.webp" }
    : props.scriptApproval === "approved" ? { label: "角色设计师", image: "/assets/roles/character-designer.webp" }
    : { label: "编剧导演", image: "/assets/roles/writer-director.webp" };
  type TimelineValue =
    | { type: "agent"; entry: AgentTranscriptEntry }
    | { type: "manager"; entry: ManagerTranscriptEntry }
    | { type: "workflow" }
    | { type: "manager-status" };
  const currentContentUpdatedAt = latestTimelineTimestamp([agentActionUpdatedAt, currentStageOutcome.updatedAt, props.agentTranscript.at(-1)?.createdAt]);
  const timelineItems = orderAgentTimeline<TimelineValue>([
    ...props.agentTranscript.map((entry): AgentTimelineItem<TimelineValue> => ({ id: `agent:${entry.id}`, kind: "agent", createdAt: entry.createdAt, value: { type: "agent", entry } })),
    ...props.managerTranscript.slice(-20).map((entry): AgentTimelineItem<TimelineValue> => ({ id: `manager:${entry.id}`, kind: "manager", createdAt: entry.createdAt, value: { type: "manager", entry } })),
    { id: "workflow:current", kind: "workflow", createdAt: currentContentUpdatedAt, value: { type: "workflow" } },
    ...((props.managerBusy || props.managerError) ? [{ id: "manager:status", kind: "manager-status" as const, createdAt: props.managerTranscript.at(-1)?.createdAt || new Date().toISOString(), value: { type: "manager-status" as const } }] : []),
  ]);
  const selectedStageView = toStageViewModel(props.workflow.stages[stageForWorkspaceSection(props.activeStage as WorkspaceSection, props.workflow)]);
  const visibleTimelineItems = props.directorUiPreview && !studioRecordOpen
    ? timelineItems.filter((item) => ["manager", "workflow", "manager-status"].includes(item.value.type))
    : timelineItems;

  return (
    <aside className="agent-panel">
      <div className="agent-head">
        <span className="agent-chip"><span>✦</span> PRISM Agent</span>
        <div className="agent-head-actions">
          {props.step !== "start" && <button className="workflow-back-button" aria-label="返回上一步" title="返回上一步" disabled={props.managerBusy} onClick={props.onWorkflowBack}><BackArrowIcon /></button>}
          {props.step !== "start" && <button className="restart-button" onClick={props.onRestart}>重新开始</button>}
          <button className="api-settings-button settings-trigger" aria-label="打开设置" onClick={props.onOpenSettings}><SettingsGearIcon /><span className="settings-trigger-label">设置</span></button>
          <button aria-label="展开Agent面板">↗</button>
        </div>
      </div>

      {props.directorUiPreview && <section className={`studio-stage-context tone-${selectedStageView.tone}`} aria-label="正在查看的制作阶段">
        <div><span>正在查看</span><strong>{props.activeStage}</strong><b>{selectedStageView.statusLabelZh}</b></div>
        <p>{selectedStageView.summaryZh}</p>
        <small>当前制作：{currentStageView.labelZh}</small>
      </section>}

      <div className="agent-scroll" ref={agentScrollRef}>
        {historyItems.length > 0 && (props.directorUiPreview ? <details className="agent-history-log studio-history-disclosure">
          <summary><span>制作记录</span><small>{historyItems.length} 个已留存节点</small></summary>
          <div>{historyItems}</div>
        </details> : <section className="agent-history-log" aria-label="从项目开始保留的制作记录">
          <header><span>制作进度</span><small>{historyItems.length} 个已留存节点</small></header>
          <div>{historyItems}</div>
        </section>)}
        <section className="agent-transcript agent-conversation-stream" aria-label="完整对话原文">
          {props.directorUiPreview ? <header className="studio-record-header"><span>{studioRecordOpen ? "全部制作与对话" : "当前对话与操作"}</span><button type="button" aria-expanded={studioRecordOpen} onClick={() => setStudioRecordOpen((current) => !current)}>{studioRecordOpen ? "返回当前" : `查看全部 ${props.agentTranscript.length + props.managerTranscript.length}`}</button></header> : (props.agentTranscript.length > 0 || props.managerTranscript.length > 0) && <header><span>完整对话原文</span><small>{props.agentTranscript.length + props.managerTranscript.length} 条 · 按发生顺序留存</small></header>}
          <div className="agent-transcript-turns">{visibleTimelineItems.map((item) => {
            if (item.value.type === "agent") {
              const { entry } = item.value;
              const index = props.agentTranscript.findIndex((candidate) => candidate.id === entry.id);
              const nextEntry = props.agentTranscript[index + 1];
              const selectedOptionIds = entry.kind === "question" && nextEntry?.kind === "answer"
                ? nextEntry.selectedOptionIds || (nextEntry.selectedOptionId ? [nextEntry.selectedOptionId] : [])
                : [];
              const visibleOptions = entry.options?.filter((option) => selectedOptionIds.includes(option.id)) || [];
              const label = entry.role === "assistant"
                ? entry.kind === "question" ? "编剧导演提问" : entry.kind === "event" ? "流程记录" : "PRISM Agent 回复"
                : entry.kind === "source" ? "你的原始输入" : entry.kind === "revision" ? "你的剧本修改要求" : entry.kind === "message" ? "你的留言" : entry.kind === "action" ? "你的操作" : "你的回答";
              return <article className={`agent-transcript-turn ${entry.role}`} key={item.id}>
                <span>{label}</span><p>{entry.text}</p>
                {entry.kind === "question" && visibleOptions.length > 0 && <ol aria-label="本轮选择">{visibleOptions.map((option, optionIndex) => <li className="selected" key={option.id || `${entry.id}-${optionIndex}`}><b>{option.label}</b><small>{option.description}</small><em>已选择</em></li>)}</ol>}
              </article>;
            }
            if (item.value.type === "manager") {
              const { entry } = item.value;
              return <article className={`manager-conversation-turn ${entry.role}`} key={item.id} aria-label="PRISM Agent 诊断对话"><span>{entry.role === "assistant" ? "PRISM Agent" : "你"}</span><p>{entry.text}</p>{entry.role === "assistant" && !!entry.commands?.length && <section className="manager-command-tail manager-command-inline" aria-label="这条回复的可执行操作">{entry.commands.map((command) => {
                const waitingForPromptRevision = command.kind === "regenerate_character_image" && entry.commands?.some((candidate) => candidate.kind === "revise_character_design" && candidate.targetArtifact?.id === command.targetArtifact?.id && candidate.status !== "completed")
                  || command.kind === "regenerate_prop_image" && entry.commands?.some((candidate) => candidate.kind === "revise_prop_design" && candidate.targetArtifact?.id === command.targetArtifact?.id && candidate.status !== "completed");
                return <div className={`manager-command manager-command-${command.status}`} key={command.id}>
                  <div><strong>{command.summaryZh}</strong><small>{command.targetArtifact ? `${command.targetArtifact.label} · ` : ""}{managerProviderLabel(command)}</small></div>
              {command.status === "running" ? <div className="manager-command-state running" role="status" aria-live="polite"><i aria-hidden="true" /><span><b>正在执行</b><small>{command.kind === "retry_storyboard_segments" ? "正在修复文字分镜：问题段并行校正后整体复校，通过即写入项目。" : "PRISM Agent 正在处理并写入项目，请稍候。"}</small></span></div> : command.status === "completed" ? <><div className="manager-command-state completed" role="status"><i aria-hidden="true" /><span><b>执行完成</b><small>{command.resultZh}</small></span></div>{command.kind === "navigate" && <button className="manager-command-result-action" onClick={() => props.onManagerCommand(entry.id, command.id)}>{managerNavigationButtonLabel(command, true)}</button>}{["revise_character_design", "revise_prop_design", "regenerate_video_prompt"].includes(command.kind) && command.targetArtifact && <button className="manager-command-result-action" onClick={() => props.onOpenManagerCommandResult(entry.id, command.id)}>查看修改结果</button>}{command.kind === "regenerate_character_image" && <div className={`manager-command-followup ${command.followUpChoice ? "resolved" : ""}`} aria-label="角色更新后的下一步">{command.followUpChoice === "mainline" ? <button onClick={() => props.onManagerFollowUp(entry.id, command.id, "mainline")}>前往当前主线</button> : command.followUpChoice === "sync_downstream" ? <button onClick={() => props.onManagerFollowUp(entry.id, command.id, "sync_downstream")}>前往待更新分镜</button> : <><button onClick={() => props.onManagerFollowUp(entry.id, command.id, "mainline")}>保留更新，返回主线</button><button className="secondary" onClick={() => props.onManagerFollowUp(entry.id, command.id, "sync_downstream")}>检查并同步后续内容</button></>}</div>}</> : command.status === "cancelled" ? <div className="manager-command-state cancelled" role="status"><i aria-hidden="true" /><span><b>已取消</b><small>{command.resultZh}</small></span></div> : command.status === "failed" ? <><div className="manager-command-state failed" role="alert"><i aria-hidden="true" /><span><b>执行未完成</b><small>{command.errorZh}</small></span></div>{command.kind === "navigate" && <button className="manager-command-result-action" onClick={() => props.onManagerCommand(entry.id, command.id)}>{managerNavigationButtonLabel(command, true)}</button>}{["retry_character_profiles", "retry_storyboard_segments", "revise_character_design", "revise_prop_design"].includes(command.kind) && <button className="manager-command-result-action" onClick={() => props.onManagerCommand(entry.id, command.id)}>{["retry_character_profiles", "retry_storyboard_segments"].includes(command.kind) ? "重新执行" : "再次修改"}</button>}</> : <div className="manager-command-actions"><button disabled={waitingForPromptRevision} onClick={() => props.onManagerCommand(entry.id, command.id)}>{waitingForPromptRevision ? "等待前一项完成" : command.kind === "retry_character_profiles" ? "确认并重新整理" : command.kind === "retry_storyboard_segments" ? "修复并写入文字分镜" : ["revise_character_design", "revise_prop_design"].includes(command.kind) ? "确认并修改" : command.kind === "regenerate_storyboard_image" ? "确认修复并重新生成" : command.requiresConfirmation ? "确认并执行" : managerNavigationButtonLabel(command)}</button>{command.requiresConfirmation && <button className="secondary" onClick={() => props.onCancelManagerCommand(entry.id, command.id)}>取消</button>}</div>}
                </div>;
              })}</section>}</article>;
            }
            if (item.value.type === "workflow") return <AgentActionHostContext.Provider value={agentActionHost} key={item.id}><section className="agent-section agent-current-section" aria-label="当前结果与选项">
              <section className={`agent-workflow-current tone-${currentStageView.tone}`} aria-label="当前工作流状态">
                <header><span>{currentStageView.labelZh}</span><strong>{currentStageView.statusLabelZh}</strong></header>
                <p>{currentStageView.summaryZh}</p>
                {currentStageView.issues[0]?.suggestionZh && <small>修改建议：{currentStageView.issues[0].suggestionZh}</small>}
                {currentStageView.recoveryActions.length > 0 && <div>{currentStageView.recoveryActions.map((action) => action.type === "continue_partial" && currentStageView.stageId === "video-prompts" ? <button type="button" key={action.type} disabled={props.videoPromptStatus === "running" || !props.videoPrompts.some(item => isReadyVideoPrompt(item))} onClick={props.onContinueReadyVideoPrompts}>保留成功项并继续</button> : <span key={`${action.type}-${action.targetKey || "stage"}`}>{action.labelZh}{action.paid ? " · 会调用生成服务" : ""}</span>)}</div>}
              </section>
              {(props.agentTranscript.length > 0 || props.managerTranscript.length > 0 || historyItems.length > 0) && <div className="agent-current-divider"><span>当前环节</span></div>}
              <div className="role-title"><span className="role-avatar" aria-hidden="true"><img src={currentRole.image} alt="" draggable={false} /></span>{currentRole.label}</div>
              {props.step === "start" && <StartStep onChooseNovel={props.onChooseNovel} onChooseIdea={props.onChooseIdea} />}
              {props.step === "novel" && <NovelStep {...props} />}
              {props.step === "format" && <FormatStep creationSource={props.creationSource} workType={props.workType} creativeDirection={props.creativeDirection} onWorkType={props.onWorkType} onCreativeDirection={props.onCreativeDirection} onContinue={props.onContinue} onBack={props.onBack} />}
              {props.step === "parameters" && <ParameterStep {...props} />}
              {props.step === "emotion" && <EmotionStep {...props} />}
              {props.step === "workspace" && !props.ideaScript && <ReadyStep brief={props.brief} onBack={props.onBack} busy={props.novelBusy} error={props.novelError} onSubmit={props.onPrepareSplit} />}
              {props.step === "workspace" && props.ideaScript && props.scriptApproval === "approved" && props.characterAssetsApproval !== "approved" && <CharacterDesignStep onGenerateBatch={retry => props.onGenerateAssetBatch("character", retry)} tools={props.characterTools} onManage={props.onManageCharacter} script={props.ideaScript} status={props.characterStatus} profiles={props.characterProfiles} error={props.characterError} approval={props.characterApproval} presets={props.stylePresets} selectedStyleId={props.selectedStyleId} imageStatus={props.characterImageStatus} images={props.characterImages} imageRequestKeys={props.characterImageRequestKeys} imageError={props.characterImageError} directVideoBusy={props.directVideoBusy} directVideoError={props.directVideoError} onOpenScript={props.onOpenScript} onStart={props.onRetryCharacterDesign} onSkip={props.onSkipCharacterProfiles} onRemove={props.onRemoveCharacterProfile} onApprove={props.onApproveCharacters} onGenerateImage={props.onGenerateCharacterImage} onRemoveImage={props.onRemoveCharacterImage} onViewImage={props.onViewCharacterImage} onApproveAssets={props.onApproveCharacterAssets} onDirectVideo={props.onDirectVideo} />}
              {props.step === "workspace" && props.ideaScript && props.characterAssetsApproval === "approved" && props.sceneAssetsApproval !== "approved" && <SceneDesignStep onGenerateBatch={retry => props.onGenerateAssetBatch("scene", retry)} script={props.ideaScript} profiles={props.characterProfiles} status={props.sceneStatus} proposals={props.sceneProposals} error={props.sceneError} rejectedDraft={props.sceneRejectedDraft} rejectedIssues={props.sceneRejectedIssues} proposalApproval={props.sceneProposalApproval} imageStatus={props.sceneImageStatus} images={props.sceneImages} imageRequestKeys={props.sceneImageRequestKeys} imageError={props.sceneImageError} views={props.sceneViews} assetsApproval={props.sceneAssetsApproval} directVideoBusy={props.directVideoBusy} directVideoError={props.directVideoError} onStart={props.onRequestSceneProposals} onApprove={props.onApproveSceneProposals} onApproveAssets={props.onApproveSceneAssets} onSkip={props.onSkipSceneAssets} onDirectVideo={props.onDirectVideo} onRejectedDraft={props.onSceneRejectedDraft} onValidateRejectedDraft={props.onValidateSceneRejectedDraft} onModify={props.onModifyCharacterAssets} />}
              {props.step === "workspace" && props.ideaScript && props.sceneAssetsApproval === "approved" && props.propAssetsApproval !== "approved" && <PropDesignStep onGenerateBatch={retry => props.onGenerateAssetBatch("prop", retry)} script={props.ideaScript} status={props.propStatus} proposals={props.propProposals} error={props.propError} rejectedDraft={props.propRejectedDraft} rejectedIssues={props.propRejectedIssues} proposalApproval={props.propProposalApproval} imageStatus={props.propImageStatus} images={props.propImages} imageRequestKeys={props.propImageRequestKeys} imageError={props.propImageError} assetsApproval={props.propAssetsApproval} directVideoBusy={props.directVideoBusy} directVideoError={props.directVideoError} onStart={props.onRequestPropProposals} onApprove={props.onApprovePropProposals} onGenerateImages={props.onGeneratePropImages} onApproveAssets={props.onApprovePropAssets} onSkip={props.onSkipPropDesign} onDirectVideo={props.onDirectVideo} onRejectedDraft={props.onPropRejectedDraft} onValidateRejectedDraft={props.onValidatePropRejectedDraft} />}
              {props.step === "workspace" && props.ideaScript && props.propAssetsApproval === "approved" && props.storyboardAssetsApproval !== "approved" && <StoryboardDesignStep durationSec={props.storyboardSegmentDurationSec} panelCount={props.storyboardBoardPanelCount} status={props.storyboardStatus} segments={props.storyboardSegments} warnings={props.storyboardWarnings} error={props.storyboardError} approval={props.storyboardApproval} boardStatus={props.storyboardBoardStatus} boardError={props.storyboardBoardError} rejectedDraft={props.storyboardBoardRejectedDraft} rejectedIssues={props.storyboardBoardRejectedIssues} plans={props.storyboardBoardPlans} prompts={props.storyboardBoardPrompts} boards={props.storyboardBoards} assetsApproval={props.storyboardAssetsApproval} directVideoBusy={props.directVideoBusy} directVideoError={props.directVideoError} onDuration={props.onStoryboardDuration} onPanelCount={props.onStoryboardPanelCount} onStart={props.onRequestStoryboardSegments} onApprove={props.onApproveStoryboardSegments} onPrepare={props.onPrepareStoryboardBoards} onRecover={props.onRecoverStoryboardBoards} onGenerate={props.onGenerateStoryboardBoards} onApproveAssets={props.onApproveStoryboardAssets} onDirectVideo={props.onDirectVideo} />}
              {props.step === "workspace" && props.ideaScript && props.storyboardAssetsApproval === "approved" && props.videoPromptsApproval !== "approved" && <VideoPromptDesignStep segments={props.storyboardSegments} status={props.videoPromptStatus} prompts={props.videoPrompts} error={props.videoPromptError} approval={props.videoPromptsApproval} onGenerate={props.onGenerateVideoPrompts} onOpenPrompt={props.onOpenVideoPrompt} onRepairPrompt={props.onRepairVideoPrompt} onRepairProblems={props.onRepairProblemVideoPrompts} onApprove={props.onApproveVideoPrompts} onContinueReady={props.onContinueReadyVideoPrompts} />}
              {props.step === "workspace" && props.ideaScript && (props.videoPromptsApproval === "approved" || props.videoPrompts.some(item => isReadyVideoPrompt(item) && item.approval === "approved")) && props.shotVideosApproval !== "approved" && <LocalVideoGenerationStep readySegmentKeys={props.videoPrompts.filter(item => isReadyVideoPrompt(item) && (props.videoPromptsApproval === "approved" || item.approval === "approved")).map(item => item.segmentKey)} segments={props.storyboardSegments} tasks={props.shotVideoTasks} continuityModes={props.shotContinuityModes} connection={props.h3Connection} settings={props.h3GenerationSettings} approval={props.shotVideosApproval} batchSubmitting={props.shotVideoBatchSubmitting} onGenerateNext={props.onGenerateNextVideo} onGenerateRemaining={props.onGenerateRemainingVideos} onContinuityMode={props.onShotContinuityMode} onModifyPrompt={props.onModifyVideoPrompt} onRefresh={props.onRefreshH3} onStart={props.onStartH3} onApprove={props.onApproveShotVideos} />}
              {props.step === "workspace" && props.ideaScript && props.shotVideosApproval === "approved" && <PostProductionStep segments={props.storyboardSegments} state={props.postProduction} localMusicConnection={props.localMusicConnection} onGenerateRoughCut={props.onGenerateRoughCut} onApproveRoughCut={props.onApproveRoughCut} onSkipSoundDesign={props.onSkipSoundDesign} onPlan={props.onPostProductionPlan} onGenerateMusicPrompt={props.onGenerateMusicPrompt} onUpdateMusicPrompt={props.onUpdateMusicPrompt} onMusicSeed={props.onMusicSeed} onMusicSettings={props.onMusicSettings} onApproveMusicPrompt={props.onApproveMusicPrompt} onGenerateLocalMusic={props.onGenerateLocalMusic} onRefreshLocalMusic={props.onRefreshLocalMusic} onSkipMusicDesign={props.onSkipMusicDesign} onGenerateFinalComposition={props.onGenerateFinalComposition} onModifyPrompt={props.onModifyVideoPrompt} />}
              {props.step === "idea" && <IdeaStep ideaText={props.ideaText} onIdeaText={props.onIdeaText} onContinue={props.onContinue} onBack={props.onBack} />}
              {props.step === "idea-questions" && <IdeaQuestionsStep ideaText={props.ideaText} answers={props.ideaAnswers} answer={props.ideaAnswer} question={props.ideaQuestion} options={props.ideaOptions} busy={props.ideaBusy} error={props.ideaError} scriptRequested={ideaScriptRequested} onAnswer={props.onIdeaAnswer} onSubmit={props.onSubmitIdeaAnswer} onFinish={props.onFinishQuestions} onRetry={ideaScriptRequested ? props.onFinishQuestions : props.onRetryIdea} onBack={props.onBack} />}
              {(props.step === "idea-script" || props.step === "workspace") && props.ideaScript && props.scriptApproval !== "approved" && <IdeaScriptStep script={props.ideaScript} projectName={props.projectName} onProjectName={props.onProjectName} answeredRounds={props.ideaAnswers.length} revisionText={props.scriptRevisionText} revisionOpen={props.scriptRevisionOpen} revisionBusy={props.scriptRevisionBusy} revisionError={props.scriptRevisionError} onRevisionText={props.onRevisionText} onOpenRevision={props.onOpenRevision} onCancelRevision={props.onCancelRevision} onSubmitRevision={props.onSubmitRevision} onOpenScript={props.onOpenScript} onAccept={props.onAcceptIdeaScript} />}
              <div className="agent-action-tail" ref={setAgentActionHost} aria-label="当前可执行选项" />
            </section></AgentActionHostContext.Provider>;
            return <div className="manager-console manager-console-compact" key={item.id}>{props.managerBusy && <p className="manager-console-note" role="status">PRISM Agent 正在分析当前项目…</p>}{props.managerError && <p className="manager-error">{props.managerError}</p>}</div>;
          })}</div>
        </section>
      </div>

      <div className="composer">
        <div className="composer-context"><span>PRISM Agent</span><small>项目诊断</small></div>
        <textarea aria-label="给PRISM Agent发消息" value={managerDraft} maxLength={2_000} onChange={(event) => setManagerDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitManagerDraft(); } }} placeholder="问当前项目任何环节的问题……" />
        <div className="composer-actions">
          <div><div className="composer-reasoning-control" role="group" aria-label="对话推理强度"><span>推理</span>{(["low", "medium", "high"] as const).map((effort) => <button type="button" key={effort} aria-pressed={managerReasoningEffort === effort} disabled={props.managerBusy} onClick={() => setManagerReasoningEffort(effort)}>{effort === "low" ? "低" : effort === "medium" ? "中" : "高"}</button>)}</div><label className="composer-model-select"><span aria-hidden="true">◇</span><select aria-label="文字模型" value={props.agentProvider?.activeProfileId || ""} onChange={(event) => props.onAgentModel(event.target.value)} disabled={!props.agentProvider?.profiles.length}><option value="" disabled>{props.agentProvider?.profiles.length ? "选择文字模型" : "未配置文字模型"}</option>{props.agentProvider?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select><DisclosureChevron /></label></div>
          <button className="send-button" aria-label="发送给PRISM Agent" disabled={props.managerBusy || !managerDraft.trim()} onClick={submitManagerDraft}>{props.managerBusy ? "…" : "↑"}</button>
        </div>
        {props.providerSwitchError && <small className="composer-model-error" role="status">{props.providerSwitchError}</small>}
      </div>
    </aside>
  );
}

function StartStep({ onChooseNovel, onChooseIdea }: { onChooseNovel: () => void; onChooseIdea: () => void }) {
  return (
    <div className="step-card-wrap start-step">
      <p className="eyebrow">创建影视项目</p>
      <h1>你想从哪里开始？</h1>
      <p className="muted">有完整内容就导入文本素材；只有一个想法也可以，Agent 会用最多 3 轮问题补齐制作所需信息。</p>
      <div className="creation-mode-grid">
        <button className="creation-mode-card" onClick={onChooseNovel}>
          <span className="mode-icon">文</span><div><strong>导入文本素材</strong><small>上传 TXT / Markdown，保留原始内容与证据</small></div><b>→</b>
        </button>
        <button className="creation-mode-card idea-mode" onClick={onChooseIdea}>
          <span className="mode-icon">✦</span><div><strong>说出你的想法</strong><small>一句话开始，Agent 最多追问 3 轮后给出执行脚本</small></div><b>→</b>
        </button>
      </div>
      <p className="start-gate">两种方式都会先形成可审核脚本，不会直接触发图片或视频生成。</p>
    </div>
  );
}

function IdeaStep({ ideaText, onIdeaText, onContinue, onBack }: { ideaText: string; onIdeaText: (value: string) => void; onContinue: () => void; onBack: () => void }) {
  return (
    <div className="step-card-wrap">
      <button className="text-back" onClick={onBack}>← 返回创作方式</button>
      <p className="eyebrow">从灵感开始</p>
      <h1>先说出你的创作想法</h1>
      <p className="muted">不用写完整方案，一句话也可以。Agent 只追问真正影响成片的问题，最多 3 轮。</p>
      <label className="idea-field">
        <span>你的想法</span>
        <textarea value={ideaText} onChange={(event) => onIdeaText(event.target.value)} placeholder="例如：为参考图中的火锅底料制作一支10秒商业广告……" maxLength={800} />
        <small>{ideaText.length}/800</small>
      </label>
      <div className="idea-examples"><span>也可以写：</span><button onClick={() => onIdeaText("末日列车上，一个只能预知十分钟未来的女孩必须找出伪装成人类的怪物。")}>剧情叙事</button><button onClick={() => onIdeaText("为参考图中的火锅底料制作一支10秒商业广告，突出红油质感和产品包装。")}>广告营销</button><button onClick={() => onIdeaText("用60秒讲清楚家用净水器滤芯的工作原理和更换步骤。")}>知识讲解</button></div>
      <div className="sticky-action"><button className="primary-button" disabled={ideaText.trim().length < 8} onClick={onContinue}>确认想法，选择方向与形式</button></div>
    </div>
  );
}

function IdeaQuestionsStep({ ideaText, answers, answer, question, options, busy, error, scriptRequested, onAnswer, onSubmit, onFinish, onRetry, onBack }: { ideaText: string; answers: IdeaAnswer[]; answer: string; question: string; options: IdeaDirectionOption[]; busy: boolean; error: string; scriptRequested: boolean; onAnswer: (value: string) => void; onSubmit: () => void; onFinish: () => void; onRetry: () => void; onBack: () => void }) {
  const round = Math.min(answers.length + 1, 3);
  return (
    <div className="step-card-wrap question-step">
      <button className="text-back" onClick={onBack}>← 返回修改表达设定</button>
      <div className={`question-progress ${scriptRequested ? "script-requested" : ""}`}><span>{scriptRequested ? "编剧导演生成剧本" : "编剧导演追问"}</span><div>{[0, 1, 2].map((index) => <i key={index} className={index < round ? "active" : ""} />)}</div><b>{scriptRequested ? "已停止追问" : `${round}/3`}</b></div>
      {answers.length === 0 && <div className="idea-origin"><span>你的想法</span><p>{ideaText}</p></div>}
      {(busy || question) && <div className="current-question"><span className={`role-orb ${busy ? "thinking" : ""}`}>●</span><div><small>{busy ? scriptRequested ? "正在生成剧本" : "正在分析" : `第 ${round} 轮`}</small><h2>{busy ? scriptRequested ? "正在根据现有信息生成完整剧本……" : "正在判断还缺少哪些关键信息……" : question}</h2></div></div>}
      {!busy && !question && !error ? <div className="agent-error"><strong>{scriptRequested ? "剧本还没有写入" : "上一轮没有写入"}</strong><span>{scriptRequested ? "停止追问的选择和已有回答均已保留，可以重新提交一次剧本生成。" : "你的已有选择已经保留，可以继续请求新的问题，或基于现有信息生成剧本。"}</span><div className="question-actions"><button onClick={onRetry}>{scriptRequested || answers.length >= 3 ? "重新生成剧本" : "继续请求新问题"}</button>{!scriptRequested && answers.length >= 1 && answers.length < 3 && <button onClick={onFinish}>基于现有信息生成剧本</button>}</div></div> : error ? <div className="agent-error"><strong>{scriptRequested ? "剧本生成没有完成" : "这轮没有完成"}</strong><span>{error}</span><div className="question-actions"><button onClick={onRetry}>{scriptRequested || answers.length >= 3 ? "重新生成剧本" : "重新请求新问题"}</button><button className="secondary-button" onClick={onBack}>检查创作设定</button>{!scriptRequested && answers.length >= 1 && answers.length < 3 && <button onClick={onFinish}>基于现有信息生成剧本</button>}</div></div> : <>
        {!busy && options.length > 0 && <div className="direction-options" aria-label="创作方向选项">{options.map((option) => {
          const optionValue = `${option.label}：${option.description}`;
          return <button key={option.id} className={answer === optionValue ? "selected" : ""} onClick={() => onAnswer(optionValue)}><span>{option.label}</span><small>{option.description}</small><b>选择</b></button>;
        })}</div>}
        <label className="question-answer"><span>或者，说出你自己的方向</span><textarea disabled={busy || !question} value={answer} onChange={(event) => onAnswer(event.target.value)} placeholder={busy ? "编剧导演正在思考……" : "可以组合上面的方向，也可以完全自定义……"} maxLength={500} /><small>{answer.length}/500</small></label>
        <div className="question-actions"><button className="primary-button" disabled={busy || answer.trim().length < 2} onClick={onSubmit}>{round >= 3 ? "提交，由编剧导演生成剧本" : "回答，交给编剧导演判断"}</button>{answers.length >= 1 && <button className="secondary-button" disabled={busy} onClick={onFinish}>不再追问，直接生成剧本</button>}</div>
      </>}
      <p className="start-gate">{scriptRequested ? "已按你的选择停止追问；后续操作只会生成剧本。" : "由文字 Agent 动态判断问题；信息充分时会提前出剧本，最多追问 3 轮。"}</p>
    </div>
  );
}

function questionFingerprint(value: string) {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function EditableProjectName({ value, onCommit, className = "", prefix = "《", suffix = "》" }: { value: string; onCommit: (value: string) => void; className?: string; prefix?: string; suffix?: string }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlurRef = useRef(false);
  useEffect(() => { setDraft(value); setEditing(false); }, [value]);
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next) { setDraft(value); return; }
    if (next !== value) onCommit(next);
  };
  const beginEditing = () => {
    setEditing(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };
  return <div className={`editable-project-name ${editing ? "is-editing" : ""} ${className}`.trim()}>
    <span className="project-name-bookend" aria-hidden="true">{prefix}</span>
    <span className="editable-project-name-field">
      <span className="editable-project-name-measure" aria-hidden="true">{draft || value}</span>
      <input ref={inputRef} size={1} aria-label="项目名" value={draft} maxLength={120} onFocus={() => setEditing(true)} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
        if (cancelBlurRef.current) { cancelBlurRef.current = false; setDraft(value); setEditing(false); return; }
        commit();
      }} onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); cancelBlurRef.current = true; setDraft(value); event.currentTarget.blur(); }
    }} />
    </span>
    <span className="project-name-bookend" aria-hidden="true">{suffix}</span>
    <button type="button" className="project-name-edit-button" aria-label="修改项目名" data-tooltip="修改" onMouseDown={(event) => event.preventDefault()} onClick={beginEditing}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.9 2.7a2 2 0 0 1 2.8 2.8L7.4 14.8l-3.7.8.8-3.7 9.4-9.2Z" /><path d="m12.6 4 3.4 3.4" /></svg>
    </button>
  </div>;
}

function IdeaScriptStep({ script, projectName, onProjectName, answeredRounds, revisionText, revisionOpen, revisionBusy, revisionError, onRevisionText, onOpenRevision, onCancelRevision, onSubmitRevision, onOpenScript, onAccept }: { script: IdeaScript; projectName: string; onProjectName: (value: string) => void; answeredRounds: number; revisionText: string; revisionOpen: boolean; revisionBusy: boolean; revisionError: string; onRevisionText: (value: string) => void; onOpenRevision: () => void; onCancelRevision: () => void; onSubmitRevision: () => void; onOpenScript: () => void; onAccept: () => void }) {
  return (
    <div className="step-card-wrap script-draft-step">
      <p className="eyebrow">编剧导演已完成 · 共追问 {answeredRounds} 轮</p>
      <EditableProjectName value={projectName} onCommit={onProjectName} className="script-draft-project-name" />
      <p className="muted">{script.logline}</p>
      <div className="script-meta"><span>{script.genre}</span><span>{script.durationSec}秒</span><span>{script.ratio}</span><span>{script.language}</span><span>{script.emotion}</span></div>
      <div className="notice-box"><span>✓</span><p><strong>剧本草案等待你的确认</strong><br />只有你点击满意后，项目才进入角色与视觉资产阶段。</p></div>
      <div className="script-draft-card">
        <div><span>{script.workType === "series" ? "系列出镜主体规划" : "主要出镜主体"}</span><p>{script.characters.map((character) => `${character.name}（${character.role}）：${character.goal}`).join("；")}</p></div>
        {script.workType === "series" && script.seriesPlan && script.seriesPlan.length > 0 && <section><b>系列规划 · {script.plannedEpisodeCount}集</b>{script.seriesPlan.map((episode) => <p key={episode.episodeNumber}><strong>第{episode.episodeNumber}集《{episode.title}》：</strong>{episode.summary}；收束点：{episode.hook}</p>)}</section>}
        {script.workType === "series" && <section><b>第{script.episodeNumber || 1}集正式剧本</b><p>以下场景、动作和对白是本集后续角色、场景、道具与分镜阶段的唯一剧情依据。</p></section>}
        {script.scenes.map((scene, index) => <SceneScreenplay key={scene.id} scene={scene} index={index} />)}
        <section className="ending-hook"><b>结尾钩子</b><p>{script.endingHook}</p></section>
      </div>
      {revisionOpen && <div className="script-revision-box">
        <label><span>告诉编剧导演需要修改什么</span><textarea value={revisionText} onChange={(event) => onRevisionText(event.target.value)} maxLength={2000} placeholder="例如：保留现有结局，但让第二场冲突更强；对白更克制，不要增加新角色。" /></label>
        <small>{revisionText.length}/2000</small>
        {revisionError && <div className="agent-error"><strong>这次修改没有完成</strong><span>{revisionError}</span></div>}
        <div className="revision-actions"><button className="primary-button" disabled={!revisionText.trim() || revisionBusy} onClick={onSubmitRevision}>{revisionBusy ? "正在修改剧本…" : "提交剧本修改"}</button><button className="secondary-button" disabled={revisionBusy} onClick={onCancelRevision}>暂不修改</button></div>
        <p>提交后将生成修改稿；失败不会自动重试，当前剧本会保留。</p>
      </div>}
      {!revisionOpen && <StageFinalActions className="question-actions"><button className="primary-button" onClick={onAccept}>满意，进入角色设计</button><button className="secondary-button" onClick={onOpenRevision}>需要修改剧本</button><button className="secondary-button" onClick={onOpenScript}>查看完整剧本</button></StageFinalActions>}
    </div>
  );
}

function DirectVideoChoice({ busy, error, onDirectVideo }: { busy: boolean; error: string; onDirectVideo: () => void }) {
  return <StageFinalActions className="direct-video-choice">
    <button className="secondary-button direct-video-button" disabled={busy} onClick={onDirectVideo}>{busy ? "正在先生成视频提示词…" : "直接生成视频"}</button>
    {error && <div className="agent-warning"><strong>直接生成状态</strong><span>{error}</span></div>}
  </StageFinalActions>;
}

function CharacterDesignStep({ onGenerateBatch, tools, onManage, script, status, profiles, error, approval, presets, selectedStyleId, imageStatus, images, imageRequestKeys, imageError, directVideoBusy, directVideoError, onOpenScript, onStart, onSkip, onRemove, onApprove, onGenerateImage, onRemoveImage, onViewImage, onApproveAssets, onDirectVideo }: { onGenerateBatch: (retry?: boolean) => void; tools: React.ReactNode; onManage: (profileKey?: string) => void; script: IdeaScript; status: CharacterStageStatus; profiles: CharacterProfile[]; error: string; approval: ScriptApproval; presets: StylePreset[]; selectedStyleId: string; imageStatus: CharacterImageStatus; images: CharacterImageResult[]; imageRequestKeys: string[]; imageError: string; directVideoBusy: boolean; directVideoError: string; onOpenScript: () => void; onStart: () => void; onSkip: () => void; onRemove: (profileKey: string) => void; onApprove: () => void; onGenerateImage: (profileKey: string) => void; onRemoveImage: (profileKey: string) => void; onViewImage: (imageUrl: string, name: string) => void; onApproveAssets: () => void; onDirectVideo: () => void }) {
  const batch = productionAssetBatch("character", profiles, images, imageRequestKeys);
  const selectedStyle = presets.find((preset) => preset.id === selectedStyleId);
  const episodeCharacters = selectEpisodeCharacters(script);
  const completedImages = images.filter((image) => image.status === "complete" && image.imageUrl);
  const canContinueWithoutAssets = script.workType === "single" || episodeCharacters.length === 0;
  const imageAdvice = imageError.startsWith("优化建议：");
  const imageMessage = imageAdvice ? imageError.slice("优化建议：".length) : imageError;
  return (
    <div className="step-card-wrap character-design-step">
      {tools}
      <p className="eyebrow">剧本已锁定</p>
      <h1>{approval === "approved" ? "建立角色视觉参考" : status === "complete" ? "确认角色文字设定" : "角色视觉规划"}</h1>
      <button className="secondary-button compact-button" onClick={onOpenScript}>查看已确认剧本</button>

      {status === "idle" && <div className="character-entry-options">
        <div className="notice-box"><span>{episodeCharacters.length}</span><p><strong>识别到 {episodeCharacters.length} 个画面角色</strong><br />可生成完整角色简介，作为后续画面的基础文字参考。</p></div>
        <button className="primary-button" onClick={onStart}>生成角色简介</button>
        {canContinueWithoutAssets && <button className="secondary-button optional-skip-button" onClick={onSkip}>本片无固定人物，跳过角色档案</button>}
      </div>}

      {status !== "idle" && status !== "failed" && <div className="character-roster" aria-live="polite">
        {(status === "complete" ? profiles : episodeCharacters).map((character, index) => {
          const profile = "profileKey" in character ? character : profiles.find((item) => item.name === character.name);
          const name = character.name;
          const image = profile ? images.find((item) => item.profileKey === profile.profileKey) : undefined;
          const generating = profile ? imageRequestKeys.includes(profile.profileKey) : false;
          return <article key={profile?.profileKey || name} className={`${profile ? "ready" : status === "running" ? "loading" : ""} ${image?.status === "complete" ? "image-ready" : ""}`}>
            <div className="character-avatar">{name.slice(0, 1)}</div>
            <div><strong>{name}</strong>{profile?.libraryBinding?.lookId !== "base" && profile?.libraryBinding?.lookName && <small>当前造型：{profile.libraryBinding.lookName}</small>}<span>{profile ? [profile.identity, profile.storyRole].filter(Boolean).join(" / ") : `第${script.episodeNumber || 1}集画面角色`}</span>{profile ? <p>{profile.introduction}</p> : <p>正在依据本集场景与对白建立档案。</p>}</div>
            {profile && approval !== "approved" ? <div className="character-card-actions"><button type="button" className="remove-character" onClick={() => onRemove(profile.profileKey)}>移出本集</button><button type="button" onClick={() => onManage(profile.profileKey)}>造型与版本</button></div> : profile ? <div className="character-card-actions"><details className="character-card-menu"><summary>角色操作</summary><button type="button" disabled={generating} onClick={() => onManage(profile.profileKey)}>造型与版本</button><button type="button" disabled={generating} onClick={() => onRemove(profile.profileKey)}>移出本集</button></details>
              {profile.participation === "voice" ? <span className="character-reference-status">仅声音角色</span> : image?.status === "complete" && image.imageUrl ? <><span className="character-reference-status">{profile.libraryBinding?.reused ? "✓ 已复用已有形象" : "✓ 已作为图片参考"}</span><button type="button" onClick={() => onViewImage(image.imageUrl!, profile.name)}>查看角色图</button><button type="button" disabled={generating} onClick={() => onGenerateImage(profile.profileKey)}>{generating ? "正在重新生成…" : "重新生成角色图"}</button><button type="button" className="remove-character" disabled={generating} onClick={() => onRemoveImage(profile.profileKey)}>删除角色图</button></> : <>{profile.libraryBinding?.selectionNeeded ? <button type="button" disabled={generating} onClick={() => onManage(profile.profileKey)}>选择已有形象</button> : <span className="character-reference-status">使用完整文字设定</span>}<button type="button" className="generate-character-reference" disabled={!selectedStyle || generating} onClick={() => onGenerateImage(profile.profileKey)}>{generating ? "正在生成角色图…" : image?.status === "failed" ? "重新生成角色图" : "生成角色图"}</button>{image?.status === "failed" && <button type="button" className="remove-character" disabled={generating} onClick={() => onRemoveImage(profile.profileKey)}>清除失败记录</button>}</>}
            </div> : <small>{status === "running" ? `正在分析 ${index + 1}/${episodeCharacters.length}` : "文字设定已保留"}</small>}
          </article>;
        })}
      </div>}

      {status === "running" && <div className="character-progress"><ThinkingOrbs /><div><strong>角色设计师正在阅读剧本</strong><p>正在归纳人物身份、目标、关系与剧情作用……</p><i /></div></div>}
      {status === "complete" && error && <StageFeedback messages={error} />}
      {status === "failed" && <div className="agent-error character-stage-error"><strong>角色档案没有写入</strong><span>{error || "角色文字结果没有形成可用档案，剧本和已有内容仍保留。"}</span><p><b>出错位置</b><span>角色文字档案生成与整理</span></p><button onClick={onStart}>让 Agent 重新整理角色档案</button>{canContinueWithoutAssets && <button className="secondary-button optional-skip-button" onClick={onSkip}>本片无固定人物，跳过角色档案</button>}</div>}
      {canContinueWithoutAssets && <DirectVideoChoice busy={directVideoBusy} error={directVideoError} onDirectVideo={onDirectVideo} />}
      {status === "complete" && approval !== "approved" && <StageFinalActions className="character-approval-actions"><div className="notice-box"><span>{profiles.length}</span><p><strong>{profiles.length} 个角色文字设定已就绪</strong><br />人物资产板固定为3:2，分辨率与画风使用右上角当前预设；确认后可一键生成全部角色图。</p></div><button className="primary-button" onClick={onApprove}>确认角色设定</button><button className="secondary-button" onClick={onStart}>重新生成角色简介</button></StageFinalActions>}
      {status === "complete" && approval === "approved" && <StageFinalActions className="character-reference-actions">
        <AssetBatchActions label="角色" state={batch} disabled={!selectedStyle} onGenerate={() => onGenerateBatch()} onRetry={() => onGenerateBatch(true)} />
        <button className={`${batch.completed === batch.total && batch.total > 0 ? "primary-button" : "secondary-button"} generate-character-images`} disabled={!selectedStyle || imageStatus === "running"} onClick={onApproveAssets}>{completedImages.length > 0 ? "确认当前角色参考，进入场景设计" : "跳过角色图片，进入场景设计"}</button>
        {imageAdvice && <StageFeedback messages={imageMessage} />}
        {imageStatus === "failed" && !imageAdvice && <div className="agent-error"><strong>部分角色图需要处理</strong><span>{imageMessage}</span>{images.some((image) => image.status === "complete") && <span>已经完成的角色图仍保留在画布中。</span>}</div>}
      </StageFinalActions>}
    </div>
  );
}

function SceneDesignStep({ onGenerateBatch, script, profiles, status, proposals, error, rejectedDraft, rejectedIssues, proposalApproval, imageStatus, images, imageRequestKeys, imageError, views, assetsApproval, directVideoBusy, directVideoError, onStart, onApprove, onApproveAssets, onSkip, onDirectVideo, onRejectedDraft, onValidateRejectedDraft, onModify }: { onGenerateBatch: (retry?: boolean) => void; script: IdeaScript; profiles: CharacterProfile[]; status: SceneStageStatus; proposals: SceneVisualProposal[]; error: string; rejectedDraft: string; rejectedIssues: string[]; proposalApproval: ScriptApproval; imageStatus: SceneStageStatus; images: SceneImageResult[]; imageRequestKeys: string[]; imageError: string; views: SceneViewResult[]; assetsApproval: ScriptApproval; directVideoBusy: boolean; directVideoError: string; onStart: () => void; onApprove: (selectedKeys: string[]) => void; onApproveAssets: () => void; onSkip: () => void; onDirectVideo: () => void; onRejectedDraft: (value: string) => void; onValidateRejectedDraft: () => void; onModify: () => void }) {
  const batch = productionAssetBatch("scene", proposals, images, imageRequestKeys);
  const recommendationSignature = proposals.map((proposal) => `${proposal.sceneAssetKey}:${sceneAssetRecommendation(proposal)}`).join("|");
  const [customOpen, setCustomOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  useEffect(() => {
    setSelectedKeys(proposals.filter((proposal) => sceneAssetRecommendation(proposal) === "required").map((proposal) => proposal.sceneAssetKey));
    setCustomOpen(false);
  }, [recommendationSignature]);
  const productionProposals = proposals.filter((proposal) => proposal.selectedForProduction !== false);
  const completedImageCount = productionProposals.filter((proposal) => images.some((image) => image.sceneAssetKey === proposal.sceneAssetKey && image.status === "complete" && image.imageUrl)).length;
  const completedViewCount = productionProposals.filter((proposal) => views.some((view) => view.sceneAssetKey === proposal.sceneAssetKey && view.status === "complete")).length;
  const viewRunning = views.some((view) => view.status === "running");
  const imageAdvice = imageError.startsWith("优化建议：");
  const imageMessage = imageAdvice ? imageError.slice("优化建议：".length) : imageError;
  const displayedError = /错误代码：invalid_structured_output/.test(error)
    ? "文字 Agent 已返回正文，但正文没有符合场景提案所需的结构字段，因此系统无法安全写入项目。这是输出适配失败，不是你的广告需求有问题；你可以重新生成，也可以跳过固定场景资产继续制作。"
    : error;
  const failedSummary = rejectedIssues.length > 0
    ? `文字 Agent 已返回场景提案，其中 ${rejectedIssues.length} 项结构内容需要整理。已确认剧本和角色参考均保留，本次只停在场景提案。`
    : displayedError;
  return <div className="step-card-wrap scene-design-step">
    <p className="eyebrow">角色参考已确认</p><h1>场景设计</h1>
    <button className="text-back scene-return-link" onClick={onModify}>← 返回修改角色参考</button>
    {status === "idle" && <><div className="notice-box"><span>{profiles.length}</span><p><strong>Agent 将先判断场景资产需求</strong><br />根据复用次数、空间连续性和剧情状态给出默认选择。</p></div><button className="primary-button" onClick={onStart}>继续</button></>}
    {status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>场景设计师正在整理地点与空间关系</strong><small>当前只生成视觉提案，不生成图片。</small></div>}
    {status === "failed" && <><div className="agent-error"><strong>场景视觉提案需要整理</strong><span>{failedSummary}</span>{rejectedIssues.length > 0 && <details className="scene-failure-diagnostics"><summary>查看 {rejectedIssues.length} 条诊断详情</summary><span>{displayedError}</span><ul className="agent-validation-issues">{rejectedIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></details>}</div>{rejectedDraft && <details className="rejected-agent-draft"><summary>高级：查看结构化返回内容</summary><textarea value={rejectedDraft} onChange={(event) => onRejectedDraft(event.target.value)} spellCheck={false} /><button className="primary-button" disabled={!rejectedDraft.trim()} onClick={onValidateRejectedDraft}>保存结构化修改</button></details>}<StageFinalActions className="scene-failure-recovery"><div className="notice-box"><span>↺</span><p><strong>继续整理场景提案</strong><br />场景 Agent 会重新判断最少且够用的固定场景；前面已确认的内容保持不变。</p></div><button className="secondary-button optional-skip-button" onClick={onSkip}>跳过固定场景，继续制作</button><button className="primary-button" onClick={onStart}>让场景 Agent 重新整理</button></StageFinalActions></>}
    {status === "complete" && proposalApproval !== "approved" && <StageFinalActions>{error && <StageFeedback messages={error} />}<div className="asset-recommendation-summary"><strong>{selectedKeys.length > 0 ? `Agent 建议保留 ${selectedKeys.length} 个固定场景` : "Agent 建议本段不准备固定场景"}</strong><span>{selectedKeys.length > 0 ? "其余地点随分镜生成。" : "全部地点随分镜生成。"}</span></div><div className="asset-recommendation-actions"><button className="primary-button" onClick={() => onApprove(selectedKeys)}>继续</button><button className="secondary-button" aria-expanded={customOpen} onClick={() => setCustomOpen((current) => !current)}>自定义</button></div>{customOpen && <div className="asset-custom-list" aria-label="自定义固定场景"><p>选择需要保留为固定资产的场景</p>{proposals.map((proposal) => { const selected = selectedKeys.includes(proposal.sceneAssetKey); return <label key={proposal.sceneAssetKey} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedKeys((current) => selected ? current.filter((key) => key !== proposal.sceneAssetKey) : [...current, proposal.sceneAssetKey])} /><span><strong>{proposal.name}</strong><small>出现于 {new Set(proposal.sourceSceneKeys).size} 个场次 · {sceneAssetRecommendationCopy(proposal)}</small><em>{proposal.assetRecommendationReason || (sceneAssetRecommendation(proposal) === "required" ? "需要保持空间与画面连续性。" : "可在对应分镜中直接完成。")}</em></span></label>})}</div>}</StageFinalActions>}
    {status === "complete" && proposalApproval === "approved" && assetsApproval !== "approved" && <StageFinalActions><AssetBatchActions label="场景" state={batch} onGenerate={() => onGenerateBatch()} onRetry={() => onGenerateBatch(true)} /><div className="notice-box"><span>{completedImageCount}/{productionProposals.length}</span><p><strong>已选场景参考</strong><br />可一键生成已选场景主图，也可在右侧逐张调整。</p></div>{imageRequestKeys.length > 0 && <div className="agent-loading"><ThinkingOrbs /><strong>{imageRequestKeys.length} 张场景图正在处理</strong><small>其他场景仍可继续点击生成。</small></div>}{completedImageCount > 0 && <p className="muted">已完成 {completedImageCount} 张主图、{completedViewCount} 张可选多角度图。多角度图可在对应场景卡片中继续补充。</p>}{imageAdvice && <StageFeedback messages={imageMessage} />}{imageStatus === "failed" && !imageAdvice && <div className="agent-error"><strong>部分场景图需要处理</strong><span>{imageMessage}</span><span>完整文字设定与成功图片都已保留。</span></div>}<button className={batch.completed === batch.total ? "primary-button" : "secondary-button"} disabled={imageRequestKeys.length > 0 || viewRunning} onClick={onApproveAssets}>确认场景参考，进入道具设计</button><button className="secondary-button optional-skip-button" disabled={imageRequestKeys.length > 0 || viewRunning} onClick={onSkip}>不使用固定场景参考，直接继续</button></StageFinalActions>}
    {assetsApproval === "approved" && <div className="notice-box"><span>✓</span><p><strong>场景资产阶段已完成</strong><br />主图、提示词和多角度图均保留，右侧已建立道具设计下一阶段节点。</p></div>}
    <DirectVideoChoice busy={directVideoBusy} error={directVideoError} onDirectVideo={onDirectVideo} />
  </div>;
}

function SceneUsageSummary({ proposal, compact = false }: { proposal: SceneVisualProposal; compact?: boolean }) {
  const sceneKeys = [...new Set(proposal.sourceSceneKeys.filter(Boolean))];
  const occurrenceCount = sceneKeys.length;
  const recommended = sceneAssetRecommendation(proposal) === "required";
  return <div className={`scene-usage-summary ${recommended ? "recurring" : "single"} ${compact ? "compact" : ""}`}>
    <div><strong>关联场次 {occurrenceCount} 次</strong><span>{sceneKeys.join("、")}</span></div>
    <b>{sceneAssetRecommendationCopy(proposal)}</b>
    {!compact && <small>{proposal.assetRecommendationReason || (recommended ? "生成后可稳定空间与光色连续性。" : "可直接在对应分镜中完成。")}</small>}
  </div>;
}

function PropDesignStep({ onGenerateBatch, script, status, proposals, error, rejectedDraft, rejectedIssues, proposalApproval, imageStatus, images, imageRequestKeys, imageError, assetsApproval, directVideoBusy, directVideoError, onStart, onApprove, onGenerateImages, onApproveAssets, onSkip, onDirectVideo, onRejectedDraft, onValidateRejectedDraft }: { onGenerateBatch: (retry?: boolean) => void; script: IdeaScript; status: SceneStageStatus; proposals: PropVisualProposal[]; error: string; rejectedDraft: string; rejectedIssues: string[]; proposalApproval: ScriptApproval; imageStatus: SceneStageStatus; images: PropImageResult[]; imageRequestKeys: string[]; imageError: string; assetsApproval: ScriptApproval; directVideoBusy: boolean; directVideoError: string; onStart: () => void; onApprove: (selectedKeys: string[]) => void; onGenerateImages: (propKeys: string[]) => void; onApproveAssets: () => void; onSkip: () => void; onDirectVideo: () => void; onRejectedDraft: (value: string) => void; onValidateRejectedDraft: () => void }) {
  const batch = productionAssetBatch("prop", proposals, images, imageRequestKeys);
  const recommendationSignature = proposals.map((proposal) => `${proposal.propAssetKey}:${propAssetRecommendation(proposal)}:${proposal.sourceMappingStatus || "resolved"}`).join("|");
  const [customOpen, setCustomOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  useEffect(() => {
    setSelectedKeys(proposals.filter((proposal) => proposal.sourceMappingStatus !== "needs_review" && propAssetRecommendation(proposal) === "required").map((proposal) => proposal.propAssetKey));
    setCustomOpen(false);
  }, [recommendationSignature]);
  const productionProposals = proposals.filter((proposal) => proposal.selectedForProduction !== false);
  const completedImageKeys = new Set(images.filter((image) => image.status === "complete" && image.imageUrl).map((image) => image.propAssetKey));
  const completedImageCount = productionProposals.filter((proposal) => completedImageKeys.has(proposal.propAssetKey)).length;
  const runningImageKeys = new Set(imageRequestKeys);
  const readyToGeneratePropKeys = productionProposals.filter((proposal) => !completedImageKeys.has(proposal.propAssetKey) && !runningImageKeys.has(proposal.propAssetKey)).map((proposal) => proposal.propAssetKey);
  const waitingSelectedImageCount = productionProposals.filter((proposal) => !completedImageKeys.has(proposal.propAssetKey)).length;
  const imageAdvice = imageError.startsWith("优化建议：");
  const imageMessage = imageAdvice ? imageError.slice("优化建议：".length) : imageError;
  const displayedError = error === "文字Agent本轮处理失败，现有问答已保留，可以重新请求。"
    ? "当前失败记录缺少可定位诊断；剧本与场景资产已保留，系统未自动重试。后续请求会显示具体失败环节。"
    : error;
  return <div className="step-card-wrap prop-design-step"><p className="eyebrow">场景资产已锁定</p><h1>道具设计</h1>
    {status === "idle" && <><div className="notice-box"><span>◇</span><p><strong>Agent 将先判断道具资产需求</strong><br />根据剧情作用、连续性和特写价值给出默认选择。</p></div><button className="primary-button" onClick={onStart}>继续</button></>}
    {status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>道具设计师正在核对剧本中的物品与状态</strong><small>当前只生成视觉提案。</small></div>}
    {status === "failed" && <><div className="agent-error"><strong>道具视觉提案没有完成</strong><span>{rejectedIssues.length > 0 ? "结构化提案已保留，可查看具体问题或在下方调整。" : displayedError}</span>{rejectedIssues.length > 0 && <details className="scene-failure-diagnostics"><summary>查看 {rejectedIssues.length} 条具体问题与请求诊断</summary><span>{displayedError}</span><ul className="agent-validation-issues">{rejectedIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></details>}</div>{rejectedDraft && <section className="rejected-agent-draft"><strong>结构化提案（高级）</strong><small>通常无需修改；保存后只在本机重新校验，不会调用 Agent。</small><textarea value={rejectedDraft} onChange={(event) => onRejectedDraft(event.target.value)} spellCheck={false} /><button className="primary-button" disabled={!rejectedDraft.trim()} onClick={onValidateRejectedDraft}>保存并本地校验</button></section>}<StageFinalActions className="scene-failure-recovery"><div className="notice-box"><span>↺</span><p><strong>选择接下来的处理方式</strong><br />可以调整结构化提案、跳过道具阶段或重新生成；前面已确认的内容会继续保留。</p></div><button className="secondary-button optional-skip-button" onClick={onSkip}>跳过道具设计，进入分镜</button><button className="primary-button" onClick={onStart}>重新生成道具提案</button></StageFinalActions></>}
    {status === "complete" && proposalApproval !== "approved" && <StageFinalActions>{error && <StageFeedback messages={error} />}<div className="asset-recommendation-summary"><strong>{selectedKeys.length > 0 ? `Agent 建议保留 ${selectedKeys.length} 件固定道具` : "Agent 建议本段不准备固定道具"}</strong><span>{selectedKeys.length > 0 ? "其余物品随分镜生成。" : "全部物品随分镜生成。"}</span></div><div className="asset-recommendation-actions"><button className="primary-button" onClick={() => onApprove(selectedKeys)}>继续</button><button className="secondary-button" aria-expanded={customOpen} onClick={() => setCustomOpen((current) => !current)}>自定义</button></div>{customOpen && <div className="asset-custom-list" aria-label="自定义固定道具"><p>选择需要保留为固定资产的道具</p>{proposals.length > 0 ? proposals.map((proposal) => { const selected = selectedKeys.includes(proposal.propAssetKey); const mappingNeedsReview = proposal.sourceMappingStatus === "needs_review"; return <label key={proposal.propAssetKey} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} disabled={mappingNeedsReview} onChange={() => setSelectedKeys((current) => selected ? current.filter((key) => key !== proposal.propAssetKey) : [...current, proposal.propAssetKey])} /><span><strong>{proposal.name}</strong><small>{mappingNeedsReview ? "剧本归属待确认 · 暂按文字随分镜生成" : `出现于 ${new Set(proposal.sourceSceneKeys).size} 个场次 · ${propAssetRecommendation(proposal) === "required" ? "建议保留" : "无需固定资产"}`}</small><em>{mappingNeedsReview ? proposal.sourceMappingNote || "确认剧本归属后可再建立固定资产。" : proposal.assetRecommendationReason || "可在对应分镜中直接完成。"}</em></span></label>}) : <span className="asset-custom-empty">没有识别到需要单独制作的道具。</span>}</div>}</StageFinalActions>}
    {status === "complete" && proposalApproval === "approved" && proposals.length === 0 && assetsApproval !== "approved" && <StageFinalActions><button className="primary-button" onClick={onApproveAssets}>跳过道具图片，进入分镜设计</button></StageFinalActions>}
    {status === "complete" && proposalApproval === "approved" && productionProposals.length > 0 && assetsApproval !== "approved" && <StageFinalActions><AssetBatchActions label="道具" state={batch} onGenerate={() => onGenerateBatch()} onRetry={() => onGenerateBatch(true)} /><div className="notice-box"><span>{completedImageCount}/{productionProposals.length}</span><p><strong>准备已选道具图</strong><br />右侧只显示已选资产，其余物品保留文字设定并随分镜生成。</p></div>{imageRequestKeys.length > 0 && <div className="agent-loading"><ThinkingOrbs /><strong>{imageRequestKeys.length} 张道具图正在处理</strong><small>{readyToGeneratePropKeys.length > 0 ? `还有 ${readyToGeneratePropKeys.length} 张已选资产可继续生成。` : "已选资产均已开始生成。"}</small></div>}{imageAdvice && <StageFeedback messages={imageMessage} />}{imageStatus === "failed" && !imageAdvice && <div className="agent-error"><strong>部分道具图需要处理</strong><span>{imageMessage}</span><span>完整文字设定与成功图片都已保留。</span></div>}<button className={waitingSelectedImageCount === 0 ? "primary-button" : "secondary-button"} disabled={imageRequestKeys.length > 0} onClick={onApproveAssets}>确认当前道具参考，进入分镜设计</button><button className="secondary-button optional-skip-button" disabled={imageRequestKeys.length > 0} onClick={onSkip}>使用文字设定，进入分镜设计</button></StageFinalActions>}
    {assetsApproval === "approved" && <div className="notice-box"><span>✓</span><p><strong>道具资产阶段已完成</strong><br />右侧已建立分镜设计下一阶段节点。</p></div>}
    <DirectVideoChoice busy={directVideoBusy} error={directVideoError} onDirectVideo={onDirectVideo} />
  </div>;
}

function StoryboardDesignStep({ durationSec, panelCount, status, segments, warnings, error, approval, boardStatus, boardError, rejectedDraft, rejectedIssues, plans, prompts, boards, assetsApproval, directVideoBusy, directVideoError, onDuration, onPanelCount, onStart, onApprove, onPrepare, onRecover, onGenerate, onApproveAssets, onDirectVideo }: { durationSec: number; panelCount: StoryboardBoardPanelCount; status: SceneStageStatus; segments: StoryboardSegment[]; warnings: string[]; error: string; approval: ScriptApproval; boardStatus: SceneStageStatus; boardError: string; rejectedDraft: string; rejectedIssues: string[]; plans: StoryboardBoardPlan[]; prompts: StoryboardBoardPrompt[]; boards: StoryboardBoardResult[]; assetsApproval: ScriptApproval; directVideoBusy: boolean; directVideoError: string; onDuration: (value: number) => void; onPanelCount: (value: StoryboardBoardPanelCount) => void; onStart: () => void; onApprove: () => void; onPrepare: () => void; onRecover: () => void; onGenerate: () => void; onApproveAssets: () => void; onDirectVideo: () => void }) {
  const plansReady = segments.length > 0 && segments.every((segment) => plans.some((item) => item.segmentKey === segment.segmentKey && storyboardPlanPanelCount(item) === panelCount) && prompts.some((item) => item.segmentKey === segment.segmentKey && storyboardPromptPanelCount(item) === panelCount));
  const completedBoardCount = segments.filter((segment) => boards.some((item) => item.segmentKey === segment.segmentKey && storyboardBoardResultPanelCount(item) === panelCount && !item.stale && item.status === "complete" && item.imageUrl)).length;
  const boardAdvice = boardError.startsWith("优化建议：");
  const boardMessage = boardAdvice ? boardError.slice("优化建议：".length) : boardError;
  const boardLabel = storyboardBoardLabel(panelCount);
  return <div className="step-card-wrap storyboard-design-step"><p className="eyebrow">角色、场景与可选道具已锁定</p><h1>分镜设计</h1>
    <ChoiceGroup title="本项目故事板规格" compact>{([3, 4, 6, 9] as StoryboardBoardPanelCount[]).map((value) => <ChoiceButton key={value} selected={panelCount === value} disabled={boardStatus === "running"} onClick={() => onPanelCount(value)}><strong>{storyboardBoardLabel(value)}</strong></ChoiceButton>)}</ChoiceGroup>
    {status === "idle" && <><ChoiceGroup title="固定每段时长" compact>{[5, 10, 15].map((value) => <ChoiceButton key={value} selected={durationSec === value} onClick={() => onDuration(value)}><strong>{value}秒</strong></ChoiceButton>)}</ChoiceGroup><button className="primary-button" onClick={onStart}>生成文字分镜</button></>}
    {status === "running" && <div className="agent-loading" role="status" aria-live="polite"><ThinkingOrbs /><strong>分镜 Agent 正在编写并自检文字分镜</strong><small>逐段保存返回草稿；数据问题会保留供你处理，可单独修复对应分镜。</small></div>}
    {status === "failed" && <><div className="agent-error"><strong>文字分镜没有完成</strong><span>{error}</span></div><button className="primary-button" onClick={onStart}>让 Agent 修复并写入文字分镜</button><ChoiceGroup title="重新选择固定时长" compact>{[5, 10, 15].map((value) => <ChoiceButton key={value} selected={durationSec === value} onClick={() => onDuration(value)}><strong>{value}秒</strong></ChoiceButton>)}</ChoiceGroup><button className="secondary-button" onClick={onStart}>按 {durationSec} 秒重新生成完整文字分镜</button></>}
    {status === "complete" && approval !== "approved" && <StageFinalActions><div className="storyboard-segment-list">{segments.map((segment) => <section key={segment.segmentKey}><b>{segment.segmentKey} · {segment.title}</b><small>{segment.durationSec}秒 · {segment.characters.length ? segment.characters.join("、") : "无人物"}</small><p>{humanReadableStoryboardText(segment.storyboardText)}</p></section>)}</div>{warnings.length > 0 && <StageFeedback messages={warnings} />}<button className="primary-button" onClick={onApprove}>确认文字分镜</button><button className="secondary-button" onClick={onStart}>重新生成文字分镜</button></StageFinalActions>}
    {approval === "approved" && !plansReady && <StageFinalActions className="storyboard-planning-actions"><div className="notice-box"><span>✓</span><p><strong>文字分镜已确认</strong><br />下一步准备结构化{panelCount}格规划与图片提示词。</p></div>{rejectedDraft ? <><button className="primary-button" disabled={boardStatus === "running"} onClick={onRecover}>{boardStatus === "running" ? "正在本地恢复…" : "本地恢复已返回的规划"}</button><button className="secondary-button" disabled={boardStatus === "running"} onClick={onPrepare}>重新请求 Agent</button></> : <button className="primary-button" disabled={boardStatus === "running"} onClick={onPrepare}>{boardStatus === "running" ? `正在准备${panelCount}格规划…` : `准备${panelCount}格规划与图片提示词`}</button>}{boardError && <>{boardAdvice ? <StageFeedback messages={boardMessage} /> : <div className="agent-error"><strong>部分{panelCount}格规划需要处理</strong><span>{boardMessage}</span>{rejectedIssues.length > 0 && <ul className="agent-validation-issues">{rejectedIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}</div>}</>}{rejectedDraft && <details className="rejected-agent-draft"><summary>高级：查看 Agent 已返回内容</summary><textarea value={rejectedDraft} readOnly spellCheck={false} /></details>}</StageFinalActions>}
    {approval === "approved" && plansReady && assetsApproval !== "approved" && <StageFinalActions className="storyboard-generation-actions">
      <div className="notice-box"><span>{completedBoardCount}/{segments.length}</span><p><strong>{boardLabel}图片按需生成</strong><br />可一键生成全部{boardLabel}，也可在右侧逐段生成；完成后确认分镜，进入视频提示词。</p></div>
      {completedBoardCount < segments.length && <button className="primary-button" disabled={boardStatus === "running"} onClick={onGenerate}>{boardStatus === "running" ? `正在生成${boardLabel}…` : `生成${completedBoardCount === 0 ? "全部" : "剩余"}${boardLabel}（${segments.length - completedBoardCount}张）`}</button>}
      <button className={completedBoardCount < segments.length ? "secondary-button" : "primary-button"} disabled={boardStatus === "running"} onClick={onApproveAssets}>确认当前分镜，进入视频提示词</button>
      {boardError && <>{boardAdvice ? <StageFeedback messages={boardMessage} /> : <div className="agent-error"><strong>部分{boardLabel}图片未完成</strong><span>{boardMessage}</span><span>已保留文字分镜、规划和成功图片。</span></div>}</>}
    </StageFinalActions>}
    {assetsApproval === "approved" && <div className="notice-box"><span>✓</span><p><strong>分镜资产已确认</strong><br />右侧已建立视频提示词下一阶段节点。</p></div>}
    <DirectVideoChoice busy={directVideoBusy} error={directVideoError} onDirectVideo={onDirectVideo} />
  </div>;
}

function VideoPromptDesignStep({ segments, status, prompts, error, approval, onGenerate, onOpenPrompt, onRepairPrompt, onRepairProblems, onApprove, onContinueReady }: { segments: StoryboardSegment[]; status: SceneStageStatus; prompts: VideoPromptResult[]; error: string; approval: ScriptApproval; onGenerate: () => void; onOpenPrompt: (segmentKey: string) => void; onRepairPrompt: (segmentKey: string) => void; onRepairProblems: () => void; onApprove: () => void; onContinueReady: () => void }) {
  const completeCount = segments.filter((segment) => prompts.some((item) => item.segmentKey === segment.segmentKey && item.status === "complete" && item.prompt.trim())).length;
  const runningCount = segments.filter((segment) => prompts.some((item) => item.segmentKey === segment.segmentKey && item.status === "running")).length;
  const problemSegments = segments.flatMap((segment) => {
    const prompt = prompts.find((item) => item.segmentKey === segment.segmentKey);
    if (prompt?.status === "needs_revision" && prompt.prompt.trim()) return [{ segment, prompt, issues: prompt.validationIssues?.length ? prompt.validationIssues : [prompt.error || "本段提示词需要处理。"] }];
    if (!prompt?.prompt.trim() || prompt.status === "failed" || prompt.status === "stale") return [{ segment, prompt, issues: [prompt?.error || "本段尚无可用视频提示词。"] }];
    return [];
  });
  const revisionCount = problemSegments.filter(({ prompt }) => prompt?.status === "needs_revision" && prompt.prompt.trim()).length;
  const missingCount = segments.filter((segment) => {
    const item = prompts.find((candidate) => candidate.segmentKey === segment.segmentKey);
    return !item?.prompt.trim() || item.status === "failed" || item.status === "stale";
  }).length;
  return <div className="step-card-wrap video-prompt-design-step"><p className="eyebrow">分镜资产已锁定</p><h1>视频提示词设计</h1>
    {status === "idle" && <><div className="notice-box"><span>{segments.length}</span><p><strong>{segments.length} 段分镜已准备好</strong><br />每批最多3段；先返回的批次会立即显示在右侧卡片中。</p></div><button className="primary-button" onClick={onGenerate}>生成全部视频提示词</button></>}
    {status === "running" && <><div className="notice-box"><span>{completeCount}/{segments.length}</span><p><strong>{runningCount} 段视频提示词正在生成或校正</strong><br />已完成卡片可立即查看；其余卡片显示独立生成动效。</p></div><div className="agent-loading"><ThinkingOrbs /><strong>视频提示词导演正在编排镜头并自检</strong></div></>}
    {status === "failed" && <><div className="notice-box"><span>{problemSegments.length}</span><p><strong>{problemSegments.length} 段需要处理</strong><br />问题已按分段列出；已完成段落不会被重写。</p></div><div className="video-prompt-problem-list">{problemSegments.map(({ segment, prompt, issues }) => <section key={segment.segmentKey}><button type="button" className="video-prompt-problem-main" disabled={!prompt?.prompt.trim()} onClick={() => onOpenPrompt(segment.segmentKey)}><span><b>{segment.segmentKey} · {segment.title}</b><small>{prompt?.prompt.trim() ? `${issues.length} 项需要处理` : "尚无可用草稿"}</small></span><p>{issues.slice(0, 2).join("；")}{issues.length > 2 ? `；另有 ${issues.length - 2} 项` : ""}</p></button><div>{prompt?.prompt.trim() && <button type="button" onClick={() => onOpenPrompt(segment.segmentKey)}>查看 / 编辑</button>}{prompt?.status === "needs_revision" && prompt.prompt.trim() && <button type="button" className="primary-button" onClick={() => onRepairPrompt(segment.segmentKey)}>让 Agent 修复本段</button>}</div></section>)}</div>{revisionCount > 0 && <button className="primary-button" onClick={onRepairProblems}>让 Agent 修复 {revisionCount} 个问题段</button>}{missingCount > 0 && <button className={revisionCount > 0 ? "secondary-button" : "primary-button"} onClick={onGenerate}>生成缺失的 {missingCount} 段</button>}{completeCount > 0 && <button className="secondary-button" onClick={onContinueReady}>暂留问题段，确认 {completeCount} 段并继续</button>}{error && <details className="video-prompt-repair-error video-prompt-stage-error"><summary>查看技术详情</summary><p>{error}</p></details>}</>}
    {status === "complete" && approval !== "approved" && <StageFinalActions><div className="notice-box"><span>{completeCount}/{segments.length}</span><p><strong>逐段视频提示词已生成</strong><br />请在右侧逐卡查看和修改；每段都可单独重新生成提示词或视频。</p></div><button className="primary-button" onClick={onApprove}>确认全部视频提示词</button></StageFinalActions>}
    {approval === "approved" && <div className="notice-box"><span>✓</span><p><strong>视频提示词已确认</strong><br />可在视频设置中选择本机 H3、MiniMax 或 Seedance，确认参数后提交镜头。</p></div>}
  </div>;
}

function LocalVideoGenerationStep({ segments, readySegmentKeys, tasks, continuityModes, connection, settings, approval, batchSubmitting, onGenerateNext, onGenerateRemaining, onContinuityMode, onModifyPrompt, onRefresh, onStart, onApprove }: { segments: StoryboardSegment[]; readySegmentKeys: string[]; tasks: ShotVideoTask[]; continuityModes: Record<string, ShotContinuityMode>; connection: H3Connection; settings: H3GenerationSettings; approval: ScriptApproval; batchSubmitting: boolean; onGenerateNext: () => void; onGenerateRemaining: () => void; onContinuityMode: (segmentKey: string, mode: ShotContinuityMode) => void; onModifyPrompt: (segmentKey: string) => void; onRefresh: () => void; onStart: () => void; onApprove: () => void }) {
  const cloud = usesCloudVideo(settings);
  const completedCount = segments.filter((segment) => tasks.some((task) => task.segmentKey === segment.segmentKey && task.status === "awaiting_review")).length;
  const activeCount = tasks.filter((task) => ["submitting", "queued", "running"].includes(task.status)).length;
  const waitingCount = tasks.filter((task) => task.status === "waiting_dependency").length;
  const failedCount = tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length;
  const unstarted = segments.filter((segment) => readySegmentKeys.includes(segment.segmentKey) && !tasks.some((task) => task.segmentKey === segment.segmentKey));
  const nextSegment = unstarted[0];
  const hasStarted = tasks.length > 0;
  const allReady = segments.length > 0 && completedCount === segments.length;
  const online = cloud || connection.status === "online";
  const taskLabel = (task?: ShotVideoTask) => task?.stale ? "参考已更新 · 待复核" : !task ? "尚未提交" : task.status === "waiting_dependency" ? "等待前段完成" : task.status === "submitting" ? "正在提交" : task.status === "queued" ? "队列等待" : task.status === "running" ? "正在生成" : task.status === "awaiting_review" ? "已生成 · 待验收" : task.status === "failed" ? "生成失败" : "已取消";
  return <div className="step-card-wrap local-video-generation-step">
    <p className="eyebrow">视频提示词已确认</p><h1>视频生成</h1>
    {!cloud && <div className={`agent-h3-summary ${connection.status}`}><span className="h3-status-dot" /><div><strong>{online ? "PRISM H3 已连接" : connection.status === "checking" ? "正在检查连接" : connection.status === "starting" ? "正在启动PRISM H3" : "PRISM H3 未连接"}</strong><small>{connection.health?.message || connection.error || "生成前先启动或检查本机引擎。"}</small></div></div>}
    {!online && <div className="question-actions"><button className="primary-button" disabled={connection.status === "starting"} onClick={onStart}>启动并连接</button><button className="secondary-button" disabled={connection.status === "checking"} onClick={onRefresh}>重新检查</button></div>}
    <div className="video-generation-progress"><div><strong>{completedCount}/{segments.length} 已生成</strong><span>{activeCount} 个视频任务 · {waitingCount} 个等待前段 · {unstarted.length} 个未开始</span></div><i><b style={{ width: `${segments.length ? Math.round(completedCount / segments.length * 100) : 0}%` }} /></i></div>
    <div className="video-generation-list">{segments.map((segment, index) => {
      const task = tasks.find((item) => item.segmentKey === segment.segmentKey);
      const active = Boolean(task && ["waiting_dependency", "submitting", "queued", "running"].includes(task.status));
      return <section key={segment.segmentKey} className={task?.status || "idle"}><header><div><b>{segment.segmentKey} · {segment.title}</b><small>{taskLabel(task)}</small></div><button disabled={active} onClick={() => onModifyPrompt(segment.segmentKey)}>{task?.status === "waiting_dependency" ? "已排队" : active ? "生成中" : "修改提示词"}</button></header>{!cloud && <ShotContinuityControl segment={segment} index={index} segments={segments} tasks={tasks} mode={continuityModes[segment.segmentKey] || "independent"} disabled={active} onChange={onContinuityMode} compact />}</section>;
    })}</div>
    {unstarted.length > 0 && <div className="local-video-agent-actions"><button className="primary-button" disabled={!online || batchSubmitting} onClick={onGenerateNext}>{batchSubmitting ? "正在按顺序提交…" : hasStarted ? `继续生成下一段 · ${nextSegment?.segmentKey}` : `先生成第一段 · ${nextSegment?.segmentKey}`}</button><button className="secondary-button" disabled={!online || batchSubmitting || unstarted.length < 2} onClick={onGenerateRemaining}>{batchSubmitting ? "批量提交进行中" : hasStarted ? `生成剩余全部 · ${unstarted.length}段` : `生成全部视频 · ${unstarted.length}段`}</button></div>}
    {cloud ? <div className="video-settings-reminder"><strong>{videoEngineLabel(settings.engine)}</strong><span>{settings.mode === "reference" ? "多图参考" : "文生视频"} · {settings.cloudResolution?.toUpperCase()}</span><small>各段独立生成，使用画布视频面板中的接口配置与当前分段时长。</small></div> : <div className="video-settings-reminder"><strong>当前参数</strong><span>{settings.mode === "reference" ? "全能参考" : "文生视频"} · {settings.resolution.toUpperCase()} · {settings.qualityPreset === "fast" ? `极速 ${settings.inferenceSteps}步` : settings.qualityPreset === "balanced" ? `均衡 ${settings.inferenceSteps}步` : settings.qualityPreset === "standard" ? `标准 ${settings.inferenceSteps}步` : `自定义 ${settings.inferenceSteps}步`}</span><small>可在画布主竖线左侧的H3面板修改；只影响之后明确提交的镜头。</small></div>}
    {activeCount > 0 && <div className="agent-loading"><ThinkingOrbs /><strong>{activeCount} 个镜头正在提交或生成</strong><small>可以等待完成，也可把尚未开始的镜头加入队列。</small></div>}
    {waitingCount > 0 && <div className="notice-box"><span>↳</span><p><strong>{waitingCount} 个续接镜头正在等待前段</strong><br />前段成功返回Herrgotts结果后会按已保存参数自动提交；前段失败时保持等待，不会改参或重试前段。</p></div>}
    {failedCount > 0 && <div className="agent-error"><strong>{failedCount} 个镜头失败或已取消</strong><span>系统没有自动重试。请在右侧对应镜头卡查看错误并决定是否重新提交。</span></div>}
    {allReady && approval !== "approved" && <StageFinalActions><div className="notice-box"><span>✓</span><p><strong>全部镜头视频已返回</strong><br />请逐段播放验收；确认只更新本地审核状态。</p></div><button className="primary-button" onClick={onApprove}>确认全部镜头视频</button></StageFinalActions>}
    {approval === "approved" && <div className="notice-box"><span>✓</span><p><strong>全部镜头视频已确认</strong><br />生成结果、参数和任务编号均已保留，可进入后续合成阶段。</p></div>}
  </div>;
}

function ShotContinuityControl({ segment, index, segments, tasks, mode, disabled, onChange, compact = false }: { segment: StoryboardSegment; index: number; segments: StoryboardSegment[]; tasks: ShotVideoTask[]; mode: ShotContinuityMode; disabled: boolean; onChange: (segmentKey: string, mode: ShotContinuityMode) => void; compact?: boolean }) {
  const sourceSegment = index > 0 ? segments[index - 1] : undefined;
  const sourceTask = sourceSegment ? tasks.find((task) => task.segmentKey === sourceSegment.segmentKey) : undefined;
  const sourceContinuity = sourceTask?.parameters?.continuity as { engine?: string; chainId?: string; segmentIndex?: number } | undefined;
  const sourceReady = sourceTask?.status === "awaiting_review" && sourceContinuity?.engine === "herrgotts";
  const queued = tasks.some((task) => task.segmentKey === segment.segmentKey && task.status === "waiting_dependency");
  const selectedMode = mode;
  const sourceBlocked = sourceTask?.status === "failed" || sourceTask?.status === "cancelled";
  const chainMode: ShotContinuityMode = sourceReady ? "continue" : "start_chain";
  const canStartChain = index < segments.length - 1;
  const hint = selectedMode === "continue"
    ? queued
      ? sourceBlocked
        ? `已排队；${sourceSegment?.segmentKey} 当前失败或取消，重新生成成功后自动继续`
        : `已排队；${sourceSegment?.segmentKey} 完成后自动提交`
      : sourceReady
        ? `续接自 ${sourceSegment?.segmentKey} · Herrgotts`
        : `可先排队，等待 ${sourceSegment?.segmentKey} 完成`
    : selectedMode === "start_chain"
      ? "从本段明确建立Herrgotts连续链"
      : "作为独立的单段视频保存";
  return <div className={`shot-continuity-control mode-${selectedMode} ${compact ? "compact" : ""}`}><div role="group" aria-label={`${segment.segmentKey}生成衔接方式`}><button type="button" className={selectedMode === "independent" ? "selected" : ""} disabled={disabled} onClick={() => onChange(segment.segmentKey, "independent")}>独立生成</button><button type="button" className={selectedMode !== "independent" ? "selected" : ""} disabled={disabled || (!sourceReady && !canStartChain)} onClick={() => onChange(segment.segmentKey, chainMode)}>{sourceReady ? "续接上一段" : "建立连续链"}</button></div><small className={queued ? "queued" : selectedMode === "continue" && !sourceReady ? "warning" : ""}>{hint}</small></div>;
}

function PostProductionStep({ segments, state, localMusicConnection, onGenerateRoughCut, onApproveRoughCut, onSkipSoundDesign, onPlan, onGenerateMusicPrompt, onUpdateMusicPrompt, onMusicSeed, onMusicSettings, onApproveMusicPrompt, onGenerateLocalMusic, onRefreshLocalMusic, onSkipMusicDesign, onGenerateFinalComposition, onModifyPrompt }: { segments: StoryboardSegment[]; state: PostProductionState; localMusicConnection: LocalMusicConnection; onGenerateRoughCut: () => void; onApproveRoughCut: () => void; onSkipSoundDesign: () => void; onPlan: (patch: Partial<Pick<PostProductionState, "view" | "audioMode" | "subtitles">>) => void; onGenerateMusicPrompt: () => void; onUpdateMusicPrompt: (value: string) => void; onMusicSeed: (value: number) => void; onMusicSettings: (patch: Partial<Pick<PostProductionState, "musicBpm" | "musicKeyScale" | "musicTimeSignature" | "musicInferenceSteps" | "musicThinking">>) => void; onApproveMusicPrompt: () => void; onGenerateLocalMusic: () => void; onRefreshLocalMusic: () => void; onSkipMusicDesign: () => void; onGenerateFinalComposition: () => void; onModifyPrompt: (segmentKey: string) => void }) {
  const roughCut = state.roughCut;
  const audioLabel = state.audioMode === "native" ? "只保留H3原声" : state.audioMode === "native_with_music" ? "原声 + 配乐" : state.audioMode === "music_only" ? "仅配乐" : "尚未决定";
  const subtitleLabel = state.subtitles === "none" ? "不加字幕" : state.subtitles === "burned" ? "烧录字幕" : "尚未决定";
  return <div className="step-card-wrap post-production-step">
    <p className="eyebrow">全部镜头视频已确认</p><h1>粗剪与声音方案</h1>
    {state.agentReply && <div className="post-agent-reply"><span>后期导演</span><p>{state.agentReply}</p></div>}

    {state.view === "overview" && <>
      <div className="post-production-actions">
        <button className="primary-button" disabled={roughCut.status === "running"} onClick={onGenerateRoughCut}>{roughCut.status === "running" ? "正在生成本地粗剪…" : roughCut.status === "complete" || roughCut.status === "stale" ? "重新生成无配乐粗剪" : "生成无配乐粗剪（推荐）"}</button>
        <button className="secondary-button" onClick={() => onPlan({ view: "discussion" })}>讨论声音 / 配乐 / 字幕方案</button>
        <button className="secondary-button" onClick={() => onPlan({ view: "shots" })}>返回修改镜头</button>
      </div>
    </>}

    {state.view === "shots" && <>
      <div className="video-generation-list post-shot-list">{segments.map((segment) => <section key={segment.segmentKey}><div><b>{segment.segmentKey} · {segment.title}</b><small>{segment.durationSec}秒</small></div><button onClick={() => onModifyPrompt(segment.segmentKey)}>修改提示词</button></section>)}</div>
      <button className="secondary-button" onClick={() => onPlan({ view: "overview" })}>返回后期方案</button>
    </>}

    {state.view === "discussion" && <>
      <div className="post-plan-block"><strong>声音方案</strong><div>
        <button className={state.audioMode === "native" ? "selected" : ""} onClick={() => onPlan({ audioMode: "native" })}>保留原声，跳过配乐</button>
        <button className={state.audioMode === "native_with_music" ? "selected" : ""} onClick={() => onPlan({ audioMode: "native_with_music" })}>原声 + 配乐</button>
        <button className={state.audioMode === "music_only" ? "selected" : ""} onClick={() => onPlan({ audioMode: "music_only" })}>仅配乐</button>
      </div></div>
      <div className="post-plan-block"><strong>字幕方案</strong><div>
        <button className={state.subtitles === "none" ? "selected" : ""} onClick={() => onPlan({ subtitles: "none" })}>跳过字幕（不加字幕）</button>
        <button className={state.subtitles === "burned" ? "selected" : ""} onClick={() => onPlan({ subtitles: "burned" })}>烧录字幕</button>
      </div></div>
      <div className="video-settings-reminder"><strong>当前方案</strong><span>{audioLabel} · {subtitleLabel}</span><small>选择只写入当前项目。配乐生成和最终合成仍需后续明确点击。</small></div>
      <button className="primary-button" onClick={onSkipSoundDesign}>跳过声音设计，使用原声粗剪</button>
      <button className="secondary-button" onClick={() => onPlan({ view: "overview" })}>返回粗剪</button>
    </>}

    {roughCut.status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>本机正在拼接并校验粗剪</strong><small>会检查文件、FFprobe信息和完整解码；不会调用模型。</small></div>}
    {roughCut.status === "failed" && <div className="agent-error"><strong>本地粗剪没有完成</strong><span>{roughCut.error}</span><button onClick={onGenerateRoughCut}>手动重新生成粗剪</button></div>}
    {roughCut.status === "stale" && <div className="agent-error"><strong>已有粗剪需要更新</strong><span>镜头在粗剪后发生过变化，旧文件仍保留，但不能继续确认。</span></div>}
    {roughCut.status === "complete" && roughCut.mediaUrl && <div className="rough-cut-ready-summary">
      <div><strong>粗剪播放器已放到画布</strong><small>在分镜卡下方的“09 · 粗剪”节点播放和检查。</small></div>
      <p>{roughCut.clipCount}段 · {roughCut.durationSec?.toFixed(2)}秒 · {roughCut.width}×{roughCut.height} · {roughCut.audioPresent ? "保留原声" : "无音轨"}</p>
      {state.roughCutApproval !== "approved" ? <div className="rough-cut-approval-actions"><button className="primary-button" onClick={onApproveRoughCut}>确认粗剪，选择声音 / 字幕</button><button className="secondary-button optional-skip-button" onClick={onSkipSoundDesign}>确认粗剪，跳过声音 / 配乐 / 字幕</button></div> : <div className="notice-box"><span>✓</span><p><strong>粗剪已确认</strong><br />当前声音方案：{audioLabel}；字幕：{subtitleLabel}。</p></div>}
    </div>}
    {state.roughCutApproval === "approved" && ["native_with_music", "music_only"].includes(state.audioMode) && <div className="post-next-stage music-design-stage">
      <strong>下一步：配乐设计</strong>
      <p>先由文字Agent生成可编辑的ACE-Step 1.5配乐方案；确认后才开放本机音乐生成。两次模型调用完全分开。</p>
      <button className="secondary-button optional-skip-button" disabled={state.music.status === "running"} onClick={onSkipMusicDesign}>跳过配乐设计，保留原声</button>
      {["idle", "stale"].includes(state.musicPrompt.status) && <button className="primary-button" disabled={state.subtitles === "undecided"} onClick={onGenerateMusicPrompt}>{state.musicPrompt.status === "stale" ? "重新生成配乐方案与提示词" : "生成配乐方案与提示词"}</button>}
      {state.subtitles === "undecided" && <small>请先确定字幕方案，再生成配乐设计。</small>}
      {state.musicPrompt.status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>文字Agent正在设计配乐</strong><small>只生成草稿，不调用ACE-Step。</small></div>}
      {state.musicPrompt.status === "failed" && <div className="agent-error music-prompt-failure"><strong>文字Agent没有返回可编辑草稿</strong><span>{state.musicPrompt.error}</span><div className="music-prompt-recovery-actions"><button className="primary-button" onClick={onGenerateMusicPrompt}>重新生成配乐方案</button><button className="secondary-button" onClick={() => onUpdateMusicPrompt("")}>建立本地可编辑草稿</button></div></div>}
      {state.musicPrompt.status === "stale" && state.musicPrompt.error && <small className="music-stale-note">{state.musicPrompt.error}</small>}
      {["complete", "needs_revision"].includes(state.musicPrompt.status) && state.musicPrompt.plan && <div className="music-prompt-plan">
        {state.musicPrompt.status === "needs_revision" && <div className="music-validation-guidance"><strong>Agent草稿已返回，还需修改以下内容</strong><ul>{state.musicPrompt.validationIssues?.map((issue, index) => <li key={index}>{issue}</li>)}</ul><small>{state.musicPrompt.repairAttempted ? "系统已自动校正一次。直接编辑下方提示词即可。" : "直接编辑下方提示词即可。"}</small></div>}
        {!!state.musicPrompt.validationWarnings?.length && <StageFeedback messages={state.musicPrompt.validationWarnings} />}
        <div className="music-direction"><b>{state.musicPrompt.plan.title}</b><p>{state.musicPrompt.plan.creativeDirection}</p></div>
        <div className="music-canvas-reminder"><b>详细方案已放到右侧画布</b><span>在“10 · 配乐设计”查看全部{state.musicPrompt.plan.cues.length}段音乐节点、混音说明和完整提示词。</span></div>
        <label className="music-prompt-editor"><span>ACE-Step 1.5提示词（可编辑）</span><textarea value={state.musicPrompt.plan.minimaxPrompt} onChange={(event) => onUpdateMusicPrompt(event.target.value)} /><small className={state.musicPrompt.plan.minimaxPrompt.length > 2000 ? "over-limit" : ""}>{state.musicPrompt.plan.minimaxPrompt.length}/2000</small></label>
        {state.musicPromptApproval !== "approved" ? <button className="primary-button" disabled={state.musicPrompt.status !== "complete" || !state.musicPrompt.plan.minimaxPrompt.trim() || state.musicPrompt.plan.minimaxPrompt.length > 2000} onClick={onApproveMusicPrompt}>{state.musicPrompt.status === "needs_revision" ? "修改提示词后可确认" : "确认配乐提示词"}</button> : <div className="notice-box"><span>✓</span><p><strong>配乐提示词已确认</strong><br />尚未开始生成配乐。</p></div>}
        {state.musicPromptApproval === "approved" && <div className={`local-music-engine-card ${localMusicConnection.status}`}>
          <div><span className="local-music-status-dot" /><p><strong>本机 ACE-Step 1.5</strong><small>{localMusicConnection.status === "checking" ? "正在检查E盘运行时与模型…" : localMusicConnection.health?.message || localMusicConnection.error || "尚未检查本机引擎。"}</small></p><b>{localMusicConnection.status === "ready" ? "Turbo + 0.6B · 就绪" : localMusicConnection.status === "checking" ? "检查中" : "不可用"}</b></div>
          {localMusicConnection.status !== "ready" && <button className="secondary-button" disabled={localMusicConnection.status === "checking"} onClick={onRefreshLocalMusic}>重新检查本机引擎</button>}
          <div className="ace-music-controls">
            <label className="local-music-seed-control"><span><b>Seed</b><small>相同模型、提示词和参数用于复现。</small></span><input type="number" min={0} max={2_147_483_647} step={1} value={state.musicSeed} disabled={state.music.status === "running"} onChange={(event) => onMusicSeed(Number(event.target.value))} aria-label="ACE-Step Seed" /></label>
            <label><span>BPM</span><input type="number" min={30} max={300} step={1} value={state.musicBpm} disabled={state.music.status === "running"} onChange={(event) => onMusicSettings({ musicBpm: Number(event.target.value) })} aria-label="ACE-Step BPM" /></label>
            <label><span>调性</span><input type="text" maxLength={80} value={state.musicKeyScale} disabled={state.music.status === "running"} onChange={(event) => onMusicSettings({ musicKeyScale: event.target.value })} aria-label="ACE-Step 调性" /></label>
            <label><span>拍号</span><select value={state.musicTimeSignature} disabled={state.music.status === "running"} onChange={(event) => onMusicSettings({ musicTimeSignature: event.target.value as PostProductionState["musicTimeSignature"] })} aria-label="ACE-Step 拍号"><option value="2">2/4</option><option value="3">3/4</option><option value="4">4/4</option><option value="6">6/8</option></select></label>
            <label><span>Turbo步数</span><input type="number" min={1} max={20} step={1} value={state.musicInferenceSteps} disabled={state.music.status === "running"} onChange={(event) => onMusicSettings({ musicInferenceSteps: Number(event.target.value) })} aria-label="ACE-Step 推理步数" /></label>
            <label className="ace-thinking-toggle"><input type="checkbox" checked={state.musicThinking} disabled={state.music.status === "running"} onChange={(event) => onMusicSettings({ musicThinking: event.target.checked })} /><span><b>Thinking</b><small>使用0.6B LM规划音乐结构</small></span></label>
          </div>
          <small>纯音乐标记固定为[Instrumental]；按目标约1.25倍生成，确认有效音乐足够后裁切并淡出。生成前要求H3队列为空，不会自动停H3、换Seed、改参或重试。</small>
        </div>}
        {state.musicPromptApproval === "approved" && state.music.status !== "running" && <div className="music-generation-actions">
          <button className="primary-button" disabled={localMusicConnection.status !== "ready"} onClick={onGenerateLocalMusic}>{(["complete", "stale", "unqualified"].includes(state.music.status)) && state.music.provider === "acestep-1.5" ? "重新生成配乐 · ACE-Step" : state.music.status === "failed" && state.music.provider === "acestep-1.5" ? "手动重新生成配乐 · ACE-Step" : "本机生成配乐 · ACE-Step 1.5"}</button>
        </div>}
        {state.music.status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>本机 ACE-Step 1.5正在生成</strong><small>生成较长版本，检查尾部静音后裁切并完整解码；完成后释放显存，不会自动重试。</small></div>}
        {state.music.status === "failed" && <div className="agent-error"><strong>配乐没有完成</strong><span>{state.music.error}</span></div>}
        {state.music.status === "unqualified" && <div className="agent-warning"><strong>时长未达标，但结果可试听</strong><span>{state.music.error}</span><small>播放器位于右侧“10 · 配乐设计”；该结果不会进入最终合成。</small></div>}
        {state.music.status === "stale" && <small className="music-stale-note">{state.music.error || "旧配乐仍保留，但提示词已变化。"}</small>}
        {state.music.status === "complete" && <div className="notice-box"><span>✓</span><p><strong>配乐已保存到E盘</strong><br />请在右侧画布试听；尚未进入最终合成。</p></div>}
        {state.music.status === "complete" && state.finalComposition.status !== "running" && <button className="primary-button" onClick={onGenerateFinalComposition}>{state.finalComposition.status === "complete" || state.finalComposition.status === "stale" ? "重新确认配乐并生成最终成片" : "确认配乐，生成最终成片"}</button>}
        {state.finalComposition.status === "running" && <div className="agent-loading"><ThinkingOrbs /><strong>正在本机生成最终成片</strong><small>混合原声与配乐、烧录已批准字幕并完整解码校验；不会调用模型。</small></div>}
        {state.finalComposition.status === "failed" && <div className="agent-error"><strong>最终合成没有完成</strong><span>{state.finalComposition.error}</span><button onClick={onGenerateFinalComposition}>手动重新合成</button></div>}
        {state.finalComposition.status === "complete" && state.finalComposition.mediaUrl && <div className="final-composition-summary"><strong>成片与配乐已合并到画布同一验收区</strong><small>左侧播放器可开启或关闭配乐，右侧配乐简介可打开完整设计详情。</small><a href={state.finalComposition.mediaUrl} download={state.finalComposition.filename}>下载最终成片</a></div>}
      </div>}
      <small>ACE-Step结果保存为48kHz WAV；原始长版与裁切版都写入E盘项目目录，再由本机完成淡出和原声混音。</small>
    </div>}
    {state.roughCutApproval === "approved" && state.audioMode === "native" && state.subtitles === "none" && roughCut.mediaUrl && <div className="post-next-stage direct-rough-cut-delivery"><strong>当前原声粗剪可直接作为成片</strong><p>已保留现有原声，配乐与字幕均已跳过，不需要再次合成。</p><a href={roughCut.mediaUrl} download={roughCut.filename}>下载当前成片</a><button className="secondary-button" disabled={state.finalComposition.status === "running"} onClick={onGenerateFinalComposition}>{state.finalComposition.status === "running" ? "正在本地重新封装…" : "需要精修时再生成新成片"}</button></div>}
    {state.roughCutApproval === "approved" && state.audioMode === "native" && state.subtitles !== "none" && <div className="post-next-stage"><strong>下一步：字幕与最终合成</strong><p>当前方案不生成配乐，将保留H3原声并进入本地合成。</p><button className="primary-button" disabled={state.subtitles === "undecided" || state.finalComposition.status === "running"} onClick={onGenerateFinalComposition}>{state.finalComposition.status === "running" ? "正在本地生成最终成片…" : state.finalComposition.status === "complete" || state.finalComposition.status === "stale" ? "重新生成最终成片 · 本地合成" : state.finalComposition.status === "failed" ? "手动重新生成最终成片" : "生成最终成片 · 本地合成"}</button>{state.subtitles === "undecided" && <small>可选择跳过字幕，直接使用原声粗剪。</small>}{state.finalComposition.status === "failed" && <small className="music-stale-note">{state.finalComposition.error}</small>}{state.finalComposition.status === "complete" && state.finalComposition.mediaUrl && <a href={state.finalComposition.mediaUrl} download={state.finalComposition.filename}>下载最终成片</a>}</div>}
  </div>;
}

function SceneScreenplay({ scene, index }: { scene: IdeaScript["scenes"][number]; index: number }) {
  return <section className="screenplay-scene">
    <b>场景{index + 1}：{scene.location} · {humanReadableSceneTime(scene.time)}</b>
    <p>{scene.summary}</p>
    {scene.blocks?.length ? scene.blocks.map((block, blockIndex) => {
      if (block.type === "dialogue" || block.type === "os") return <blockquote key={blockIndex}><strong>{block.speaker}{block.delivery ? `（${block.delivery}）` : block.type === "os" ? "（内心OS）" : ""}：</strong>{block.text}</blockquote>;
      if (block.type === "sfx") return <p className="script-sfx" key={blockIndex}>音效：“{block.text}”</p>;
      if (block.type === "transition") return <p className="script-transition" key={blockIndex}>{block.text}</p>;
      return <p key={blockIndex}>{block.text}</p>;
    }) : <><ul>{scene.beats.map((beat, beatIndex) => <li key={beatIndex}>{beat}</li>)}</ul>{scene.dialogue.map((line, lineIndex) => <blockquote key={lineIndex}><strong>{line.speaker}：</strong>{line.line}</blockquote>)}</>}
  </section>;
}

function NovelStep(props: {
  novelText: string;
  novelName: string;
  onNovelText: (value: string) => void;
  onNovelName: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const hasNovel = props.novelText.trim().length >= 20;

  async function readNovelFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    props.onNovelName(file.name);
    props.onNovelText(text);
  }

  return (
    <div className="step-card-wrap">
      <button className="text-back" onClick={props.onBack}>← 返回创作方式</button>
      <p className="eyebrow">创建影视项目</p>
      <h1>先提交文本素材</h1>
      <p className="muted">上传TXT或直接粘贴正文、资料、脚本或产品说明。内容只进入当前本地项目，不会因为选择文件而自动调用任何模型。</p>

      <label className="novel-upload">
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={(event) => void readNovelFile(event.target.files?.[0])}
        />
        <span className="upload-icon">＋</span>
        <strong>{props.novelName || "上传文本文件"}</strong>
        <small>{props.novelName ? "已读取到本地草稿，可继续编辑" : "支持 TXT、Markdown"}</small>
      </label>

      <div className="or-divider"><span>或</span></div>

      <label className="novel-paste">
        <span>粘贴文本内容</span>
        <textarea
          value={props.novelText}
          onChange={(event) => {
            props.onNovelText(event.target.value);
            if (!event.target.value) props.onNovelName("");
          }}
          placeholder="从这里粘贴正文、资料、脚本或产品说明，后续处理会保留源文本证据……"
        />
        <small>{props.novelText.length.toLocaleString()} 字符</small>
      </label>



      <div className="sticky-action">
        <button className="primary-button" disabled={!hasNovel} onClick={props.onContinue}>确认素材，选择方向与形式</button>
      </div>
    </div>
  );
}

function FormatStep({ creationSource, workType, creativeDirection, onWorkType, onCreativeDirection, onContinue, onBack }: { creationSource: CreationSource; workType: WorkType; creativeDirection: CreativeDirection; onWorkType: (value: WorkType) => void; onCreativeDirection: (value: CreativeDirection) => void; onContinue: () => void; onBack: () => void }) {
  return (
    <div className="step-card-wrap">
      <button className="text-back" onClick={onBack}>← 返回{creationSource === "idea" ? "创作想法" : "素材内容"}</button>
      <p className="eyebrow">第 2 步 · 方向与形式</p>
      <h1>先确定作品方向</h1>
      <p className="muted">方向决定内容结构和后续提问；单条或系列作为独立形式选择。</p>
      <fieldset className="format-section"><legend>作品方向</legend><div className="format-grid creative-direction-grid">
        {creativeDirections.map((item) => <button key={item.id} className={`format-card ${creativeDirection === item.id ? "selected" : ""}`} onClick={() => onCreativeDirection(item.id)}>
          <span>{item.icon}</span><div><strong>{item.label}</strong><small>{item.description}</small></div>
        </button>)}
      </div></fieldset>
      <fieldset className="format-section"><legend>内容形式</legend><div className="format-grid work-type-grid">
        <button className={`format-card ${workType === "single" ? "selected" : ""}`} onClick={() => onWorkType("single")}>
          <span>▤</span><div><strong>单条作品</strong><small>在当前时长内完成一条独立作品。</small></div>
        </button>
        <button className={`format-card ${workType === "series" ? "selected" : ""}`} onClick={() => onWorkType("series")}>
          <span>▦</span><div><strong>系列连载</strong><small>先建立完整系列规划，再按集推进制作。</small></div>
        </button>
      </div></fieldset>
      <div className="sticky-action"><button className="primary-button" onClick={onContinue}>确认方向与形式，设置参数</button></div>
    </div>
  );
}

function ParameterStep(props: {
  workType: WorkType;
  creativeDirection: CreativeDirection;
  duration: string;
  customDurationSec: string;
  episodeCountMode: "agent" | "fixed";
  episodeCount: string;
  ratio: string;
  language: string;
  onDuration: (value: string) => void;
  onCustomDurationSec: (value: string) => void;
  onEpisodeCountMode: (value: "agent" | "fixed") => void;
  onEpisodeCount: (value: string) => void;
  onRatio: (value: string) => void;
  onLanguage: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const usesShortPresets = props.workType === "single" && usesShortDurationPresets(props.creativeDirection);
  const isNonStoryDirection = props.creativeDirection !== "story";
  return (
    <div className="step-card-wrap">
      <button className="text-back" onClick={props.onBack}>← 返回修改方向与形式</button>
      <p className="eyebrow">初始化项目</p>
      <h1>先确认影片参数</h1>
      <p className="muted">{usesShortPresets ? "时长决定信息数量、展示节奏和片尾收束方式。" : props.workType === "single" && !isNonStoryDirection ? "时长决定这个故事能容纳多少冲突与转折。" : props.workType === "single" ? "时长决定内容层次、信息密度和完整表达空间。" : "单集时长控制每集密度，预计集数控制整个系列的展开空间。"}</p>

      <ChoiceGroup title={props.workType === "single" ? "成片时长" : "单集时长"}>
        {(usesShortPresets
          ? [["10秒", "短版表达"], ["15秒", "标准短广告"], ["30秒", "完整展示"], ["60秒", "长版表达"], ["自定义", "5—600秒"]]
          : props.workType === "single"
            ? [["30秒", "极短叙事"], ["60秒", "标准短视频"], ["90秒", "完整转折"], ["180秒", "长故事"], ["自定义", "15—600秒"]]
          : [["60秒", "快节奏"], ["90秒", "标准单集"], ["120秒", "内容展开"], ["180秒", "长单集"], ["自定义", "15—600秒"]]
        ).map(([value, note]) => (
          <ChoiceButton key={value} selected={props.duration === value} onClick={() => props.onDuration(value)}>
            <strong>{value}</strong><small>{note}</small>
          </ChoiceButton>
        ))}
      </ChoiceGroup>

      {props.duration === "自定义" && <label className="custom-field compact-input"><span>自定义时长（秒）</span><input type="number" min={props.workType === "single" && isNonStoryDirection ? 5 : 15} max="600" value={props.customDurationSec} onChange={(event) => props.onCustomDurationSec(event.target.value)} /></label>}

      {props.workType === "series" && <>
        <ChoiceGroup title="预计集数" compact>
          <ChoiceButton selected={props.episodeCountMode === "agent"} onClick={() => props.onEpisodeCountMode("agent")}><strong>由 Agent 建议</strong><small>根据素材体量规划</small></ChoiceButton>
          {[4, 8, 12].map((count) => <ChoiceButton key={count} selected={props.episodeCountMode === "fixed" && props.episodeCount === String(count)} onClick={() => { props.onEpisodeCountMode("fixed"); props.onEpisodeCount(String(count)); }}><strong>{count}集</strong></ChoiceButton>)}
          <ChoiceButton selected={props.episodeCountMode === "fixed" && !["4", "8", "12"].includes(props.episodeCount)} onClick={() => { props.onEpisodeCountMode("fixed"); if (["4", "8", "12"].includes(props.episodeCount)) props.onEpisodeCount("6"); }}><strong>自定义</strong></ChoiceButton>
        </ChoiceGroup>
        {props.episodeCountMode === "fixed" && !["4", "8", "12"].includes(props.episodeCount) && <label className="custom-field compact-input"><span>自定义集数</span><input type="number" min="2" max="30" value={props.episodeCount} onChange={(event) => props.onEpisodeCount(event.target.value)} /></label>}
      </>}

      <ChoiceGroup title="影片比例">
        {[["16:9", "▭"], ["9:16", "▯"], ["3:4", "▯"]].map(([value, icon]) => (
          <ChoiceButton key={value} selected={props.ratio === value} onClick={() => props.onRatio(value)}>
            <span className="ratio-icon">{icon}</span><strong>{value}</strong>
          </ChoiceButton>
        ))}
      </ChoiceGroup>

      <ChoiceGroup title="对白语言" compact>
        {["中文", "英文", "日文"].map((value) => (
          <ChoiceButton key={value} selected={props.language === value} onClick={() => props.onLanguage(value)}>
            <strong>{value}</strong>
          </ChoiceButton>
        ))}
      </ChoiceGroup>

      <div className="sticky-action"><button className="primary-button" onClick={props.onContinue}>确认参数，让 Agent 推荐{props.creativeDirection === "story" ? "情绪" : "气质"}</button></div>
    </div>
  );
}

function EmotionStep(props: {
  brief: Brief;
  creationSource: CreationSource;
  emotion: string;
  customEmotion: string;
  emotionRecommendations: ToneOption[];
  emotionRecommendationBusy: boolean;
  emotionRecommendationError: string;
  onRetryEmotionRecommendations: () => void;
  onEmotion: (value: string) => void;
  onCustomEmotion: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const isStoryDirection = props.brief.creativeDirection === "story";
  const hasAgentRecommendations = props.emotionRecommendations.length > 0;
  const toneOptions = hasAgentRecommendations ? props.emotionRecommendations : toneOptionsForDirection(props.brief.creativeDirection);
  return (
    <div className="step-card-wrap">
      <button className="text-back" onClick={props.onBack}>← 返回影片参数</button>
      <p className="eyebrow">参数已确认 · {props.brief.duration} · {props.brief.ratio} · {props.brief.language}</p>
      <h1>{isStoryDirection ? "选择本集主情绪" : "选择作品表达气质"}</h1>
      <p className="muted">{isStoryDirection ? "编剧导演会从完整情绪范围中判断最适合当前内容的方向，用来控制节奏、对白语气和人物反应。" : "编剧导演会结合当前内容推荐最合适的表达气质，用来控制画面质感与展示节奏。"}</p>

      <div className="emotion-recommendation-head">
        <div><strong>{props.emotionRecommendationBusy ? "Agent 正在分析" : hasAgentRecommendations ? "Agent 推荐" : "常用备选"}</strong><small>{props.emotionRecommendationBusy ? "正在结合素材和影片参数筛选方向…" : hasAgentRecommendations ? "按适配度排序，第一项为首选" : "你仍可直接选择或输入自己的方向"}</small></div>
        {props.emotionRecommendationError && <button type="button" onClick={props.onRetryEmotionRecommendations}>重新推荐</button>}
      </div>

      {props.emotionRecommendationError && <p className="emotion-recommendation-error" role="alert">{props.emotionRecommendationError}</p>}

      <div className={`emotion-grid ${props.emotionRecommendationBusy ? "loading" : ""}`} aria-busy={props.emotionRecommendationBusy}>
        {props.emotionRecommendationBusy ? Array.from({ length: 4 }, (_, index) => <div className="emotion-card-placeholder" key={index}><i /><span /><small /></div>) : toneOptions.map((item, index) => (
          <button
            key={item.name}
            className={`emotion-card ${item.tone} ${!props.customEmotion && props.emotion === item.name ? "selected" : ""}`}
            onClick={() => props.onEmotion(item.name)}
          >
            <span>{item.name}{hasAgentRecommendations && index === 0 && <em>最推荐</em>}</span>
            <small>{item.note}</small>
          </button>
        ))}
      </div>

      <label className="custom-field">
        <span>{isStoryDirection ? "自定义情绪" : "自定义气质"}</span>
        <input
          value={props.customEmotion}
          onChange={(event) => props.onCustomEmotion(event.target.value)}
          placeholder={isStoryDirection ? "例如：宿命感、克制的愤怒" : "例如：高端热烈、清爽可信"}
          maxLength={18}
        />
      </label>

      <div className="emotion-summary">
        <span>将锁定为</span><strong>{props.customEmotion.trim() || props.emotion}</strong>
        <small>后续可修订，新版本会明确标记受影响的下游阶段。</small>
      </div>

      <div className="sticky-action"><button className="primary-button" onClick={props.onContinue} disabled={props.emotionRecommendationBusy}>{props.emotionRecommendationBusy ? "Agent 正在推荐…" : props.creationSource === "idea" ? `${isStoryDirection ? "确认情绪" : "确认气质"}，交给编剧导演` : `${isStoryDirection ? "确认情绪" : "确认气质"}，进入项目`}</button></div>
    </div>
  );
}

function ReadyStep({ brief, onBack, busy, error, onSubmit }: { brief: Brief; onBack: () => void; busy: boolean; error: string; onSubmit: () => void }) {
  const isSingle = brief.workType === "single";
  const directionLabel = creativeDirectionLabel(brief.creativeDirection);
  const formLabel = workTypeLabel(brief.workType);
  const isStoryDirection = brief.creativeDirection === "story";
  return (
    <div className="step-card-wrap ready-copy">
      <p className="eyebrow">项目设定完成</p>
      <h1>素材、方向与参数已确认</h1>
      <p>{isSingle ? isStoryDirection ? `下一步根据素材、${brief.duration}时长和“${brief.emotion}”主情绪，形成一条完整的${directionLabel}脚本。` : `下一步根据素材、${brief.duration}时长和“${brief.emotion}”表达气质，形成完整的${directionLabel}执行脚本。` : `下一步按${directionLabel}建立完整系列规划，再生成第1集执行脚本。`}</p>
      <div className="summary-list">
        <div><span>作品方向</span><strong>{directionLabel}</strong></div>
        <div><span>内容形式</span><strong>{formLabel}</strong></div>
        <div><span>影片长度</span><strong>{brief.duration}</strong></div>
        {brief.workType === "series" && <div><span>预计集数</span><strong>{brief.episodeCount}</strong></div>}
        <div><span>画面比例</span><strong>{brief.ratio}</strong></div>
        <div><span>对白语言</span><strong>{brief.language}</strong></div>
        <div><span>{isStoryDirection ? "主情绪" : "表达气质"}</span><strong>{brief.emotion}</strong></div>
      </div>
      <div className="notice-box"><span>✓</span><p><strong>安全门禁已开启</strong><br />页面操作只更新本地草稿；所有模型与视频生成仍需单独明确授权。</p></div>
      <div className={`next-stage-card ${busy ? "prepared" : ""}`}>
        <div><span className="next-index">下一步</span><strong>{isSingle ? `${brief.duration}${directionLabel}脚本` : "系列规划"}</strong><small>{isSingle ? "生成后会先进入脚本确认，不会提前创建角色或分镜资产。" : "先确认系列母板，再逐集生成正式执行脚本。"}</small></div>
        <button onClick={onSubmit} disabled={busy} aria-busy={busy}>{busy ? <><ThinkingOrbs className="planning-button-orbs" />{isSingle ? "正在生成剧本…" : "正在智能拆集…"}</> : isSingle ? "生成剧本" : "开始智能拆集"}</button>
      </div>
      {busy && <div className="series-planning-progress" role="status" aria-live="polite"><span className="series-planning-orbit" aria-hidden="true"><i /><b /></span><div><strong>{isSingle ? "编剧导演正在生成执行脚本" : "编剧导演正在读取素材并规划分集"}</strong><small>{isSingle ? "正在整理场景、动作与声音结构，请保持页面开启。" : "正在建立系列母板、各集梗概与第1集执行脚本，请保持页面开启。"}</small></div></div>}
      <p className="gate-message">{isSingle ? "点击按钮后开始生成剧本；失败后不会自动重试。" : "系列规划作为独立任务接入，确认后再进入逐集制作。"}</p>
      {error && <div className="agent-error" role="alert"><strong>{isSingle ? "剧本生成没有完成" : "智能拆集没有完成"}</strong><span>{error}</span><button onClick={onSubmit} disabled={busy}>{isSingle ? "重新提交" : "重新智能拆集"}</button></div>}
      <button className="secondary-button" onClick={onBack}>返回修改{isStoryDirection ? "情绪" : "表达气质"}</button>
    </div>
  );
}

function ChoiceGroup({ title, compact, children }: { title: string; compact?: boolean; children: React.ReactNode }) {
  return <fieldset className={`choice-group ${compact ? "compact" : ""}`}><legend>{title}</legend><div>{children}</div></fieldset>;
}

function ChoiceButton({ selected, disabled = false, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`choice-button ${selected ? "selected" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

function Workspace({ onOpenCharacterLibrary, onRemoveCharacter, stage, activeStage, navigationRequest, directorUiPreview, brief, script, seriesMotherScript, episodeScripts, scriptApproval, characterStatus, characterProfiles, characterError, characterApproval, selectedStyle, characterImageStatus, characterImages, characterImagePrompts, characterImageRequestKeys, characterAssetsApproval, characterTurnarounds, sceneStatus, sceneProposals, sceneProposalApproval, sceneImageStatus, sceneImagePrompts, sceneImages, sceneImageRequestKeys, sceneMainApproval, sceneViews, sceneAssetsApproval, sceneAssetsSkipped, propStatus, propProposals, propProposalApproval, propImageStatus, propImagePrompts, propImages, propImageRequestKeys, propAssetsApproval, storyboardStatus, storyboardSegments, storyboardBoardPanelCount, storyboardBoardStatus, storyboardBoardPrompts, storyboardBoards, storyboardAssetsApproval, videoPromptStatus, videoPrompts, videoPromptsApproval, h3Connection, h3GenerationSettings, shotVideoTasks, shotContinuityModes, shotVideosApproval, postProduction, projectName, canvasView, onCanvasView, onOpenScript, onOpenSeriesPlan, onOpenEpisodeScript, onOpenEpisodeProduction, episodeOpening, episodeProductionError, onGenerateEpisode, onEditPrompt, onRegenerateImage, onGenerateTurnaround, onViewImage, onSaveAsset, onOpenAssetLibrary, onEditScenePrompt, onRegenerateScene, onGenerateSceneView, onRecoverSceneViewCandidates, onSelectSceneViewCandidate, onEditPropPrompt, onRegenerateProp, onOpenStoryboardText, onEditStoryboardPrompt, onRegenerateStoryboard, onSelectStoryboardCandidate, onEditVideoPrompt, onRegenerateVideoPrompt, onRepairVideoPrompt, onRefreshH3, onStartH3, onH3Settings, onShotContinuityMode, onSubmitShotVideo, onCancelShotVideo, onApproveShotVideos, onGenerateMusicPrompt, onUpdateMusicPrompt, onApproveMusicPrompt }: { onOpenCharacterLibrary: (profileKey?: string) => void; onRemoveCharacter: (profileKey: string) => void; stage: SetupStep; activeStage: string; navigationRequest: number; directorUiPreview: boolean; brief: Brief; script: IdeaScript | null; seriesMotherScript: IdeaScript | null; episodeScripts: EpisodeScriptRecord[]; scriptApproval: ScriptApproval; characterStatus: CharacterStageStatus; characterProfiles: CharacterProfile[]; characterError: string; characterApproval: ScriptApproval; selectedStyle: StylePreset | null; characterImageStatus: CharacterImageStatus; characterImages: CharacterImageResult[]; characterImagePrompts: CharacterImagePrompt[]; characterImageRequestKeys: string[]; characterAssetsApproval: ScriptApproval; characterTurnarounds: CharacterTurnaroundResult[]; sceneStatus: SceneStageStatus; sceneProposals: SceneVisualProposal[]; sceneProposalApproval: ScriptApproval; sceneImageStatus: SceneStageStatus; sceneImagePrompts: SceneImagePrompt[]; sceneImages: SceneImageResult[]; sceneImageRequestKeys: string[]; sceneMainApproval: ScriptApproval; sceneViews: SceneViewResult[]; sceneAssetsApproval: ScriptApproval; sceneAssetsSkipped: boolean; propStatus: SceneStageStatus; propProposals: PropVisualProposal[]; propProposalApproval: ScriptApproval; propImageStatus: SceneStageStatus; propImagePrompts: PropImagePrompt[]; propImages: PropImageResult[]; propImageRequestKeys: string[]; propAssetsApproval: ScriptApproval; storyboardStatus: SceneStageStatus; storyboardSegments: StoryboardSegment[]; storyboardBoardPanelCount: StoryboardBoardPanelCount; storyboardBoardStatus: SceneStageStatus; storyboardBoardPrompts: StoryboardBoardPrompt[]; storyboardBoards: StoryboardBoardResult[]; storyboardAssetsApproval: ScriptApproval; videoPromptStatus: SceneStageStatus; videoPrompts: VideoPromptResult[]; videoPromptsApproval: ScriptApproval; h3Connection: H3Connection; h3GenerationSettings: H3GenerationSettings; shotVideoTasks: ShotVideoTask[]; shotContinuityModes: Record<string, ShotContinuityMode>; shotVideosApproval: ScriptApproval; postProduction: PostProductionState; projectName: string; canvasView: CanvasView; onCanvasView: React.Dispatch<React.SetStateAction<CanvasView>>; onOpenScript: () => void; onOpenSeriesPlan: () => void; onOpenEpisodeScript: (episodeNumber: number) => void; onOpenEpisodeProduction: (episodeNumber: number) => void; episodeOpening: boolean; episodeProductionError: string; onGenerateEpisode: (episodeNumber: number) => void; onEditPrompt: (profileKey: string) => void; onRegenerateImage: (profileKey: string) => void; onGenerateTurnaround: (profileKey: string) => void; onViewImage: (src: string, title: string) => void; onSaveAsset: (input: AssetLibraryInput) => Promise<void>; onOpenAssetLibrary: () => void; onEditScenePrompt: (sceneAssetKey: string) => void; onRegenerateScene: (sceneAssetKey: string) => void; onGenerateSceneView: (sceneAssetKey: string) => void; onRecoverSceneViewCandidates: (sceneAssetKey: string) => void; onSelectSceneViewCandidate: (sceneAssetKey: string, imageUrl: string) => void; onEditPropPrompt: (propAssetKey: string) => void; onRegenerateProp: (propAssetKey: string) => void; onOpenStoryboardText: (segmentKey: string) => void; onEditStoryboardPrompt: (segmentKey: string) => void; onRegenerateStoryboard: (segmentKey: string) => void; onSelectStoryboardCandidate: (segmentKey: string, imageUrl: string) => void; onEditVideoPrompt: (segmentKey: string) => void; onRegenerateVideoPrompt: (segmentKey: string) => void; onRepairVideoPrompt: (segmentKey: string) => void; onRefreshH3: () => void; onStartH3: () => void; onH3Settings: (patch: Partial<H3GenerationSettings>) => void; onShotContinuityMode: (segmentKey: string, mode: ShotContinuityMode) => void; onSubmitShotVideo: (segmentKey: string) => void; onCancelShotVideo: (segmentKey: string) => void; onApproveShotVideos: () => void; onGenerateMusicPrompt: () => void; onUpdateMusicPrompt: (value: string) => void; onApproveMusicPrompt: () => void }) {
  const setupVisible = !["start", "novel", "idea", "format"].includes(stage);
  const setupComplete = ["idea-questions", "idea-script", "workspace"].includes(stage);
  const scriptVisible = Boolean(script);
  const scriptApproved = scriptVisible && scriptApproval === "approved";
  const assetStageVisible = stage === "workspace" && scriptApproved;
  const dragRef = useRef<null | { kind: "canvas"; pointerId: number; startX: number; startY: number; view: CanvasView }>(null);
  const flowCanvasRef = useRef<HTMLDivElement>(null);
  const navigationRunRef = useRef(0);
  const [panning, setPanning] = useState(false);
  const [musicDetailsOpen, setMusicDetailsOpen] = useState(false);
  const [sceneCopyRowHeight, setSceneCopyRowHeight] = useState(0);
  const [sceneMediaViewByKey, setSceneMediaViewByKey] = useState<Record<string, "main" | "views">>({});
  const [storyboardNodeHeights, setStoryboardNodeHeights] = useState<Record<string, number>>({});
  const storyboardPanelCount = storyboardBoardPanelCount;
  const sceneStageSkipped = sceneAssetsSkipped || sceneAssetsApproval === "approved" && sceneProposals.length === 0;

  function cancelCanvasNavigation() {
    navigationRunRef.current += 1;
  }

  function beginCanvasDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".node-card,button")) return;
    cancelCanvasNavigation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "canvas", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view: canvasView };
    setPanning(true);
  }

  function beginNodeDrag() {
    // 制作节点使用固定阶段行布局；只允许整体画布平移和缩放。
  }

  function continueDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    onCanvasView({ ...drag.view, x: drag.view.x + deltaX, y: drag.view.y + deltaY });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }

  useEffect(() => {
    function handleApplicationCtrlWheel(event: WheelEvent) {
      const canvas = flowCanvasRef.current;
      if (!event.ctrlKey || !canvas) return;
      event.preventDefault();
      event.stopPropagation();
      navigationRunRef.current += 1;
      const rect = canvas.getBoundingClientRect();
      const pointerInsideCanvas = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const pointerX = pointerInsideCanvas ? event.clientX - rect.left : rect.width / 2;
      const pointerY = pointerInsideCanvas ? event.clientY - rect.top : rect.height / 2;
      onCanvasView((current) => {
        const nextZoom = stepZoom(current.zoom, event.deltaY < 0 ? 1 : -1);
        const worldX = (pointerX - current.x) / current.zoom;
        const worldY = (pointerY - current.y) / current.zoom;
        return { ...current, zoom: nextZoom, x: Math.round(pointerX - worldX * nextZoom), y: Math.round(pointerY - worldY * nextZoom) };
      });
    }
    window.addEventListener("wheel", handleApplicationCtrlWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handleApplicationCtrlWheel, { capture: true });
  }, [onCanvasView]);

  function handleCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey) return;
    event.preventDefault();
    cancelCanvasNavigation();
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaScale = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? rect.height : 1;
    const horizontalDelta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
    onCanvasView((current) => {
      return {
        ...current,
        x: Math.round(current.x - horizontalDelta * deltaScale),
        y: Math.round(current.y - (event.shiftKey ? 0 : event.deltaY * deltaScale)),
      };
    });
  }

  const rowStartX = 240;
  const stageSpineX = 165;
  const seriesLayoutOffset = brief.workType === "series" ? 240 : 0;
  const briefPosition = { x: rowStartX, y: 80 };
  const scriptPosition = { x: rowStartX, y: 420 };
  const episodeScriptsPosition = { x: rowStartX + 820, y: 420 };
  const assetPosition = { x: rowStartX, y: 940 + seriesLayoutOffset };
  const characterNodes = characterStatus === "complete" ? characterProfiles.map((profile, index) => {
    const nodeId = `character-${profile.profileKey}`;
    const position = { x: rowStartX + index * 1240, y: assetPosition.y };
    return { profile, nodeId, position, image: characterImages.find((item) => item.profileKey === profile.profileKey), prompt: characterImagePrompts.find((item) => item.profileKey === profile.profileKey), turnaround: characterTurnarounds.find((item) => item.profileKey === profile.profileKey), generating: characterImageRequestKeys.includes(profile.profileKey) };
  }) : [];
  const scenePosition = { x: rowStartX, y: 1900 + seriesLayoutOffset };
  const sceneNodes = sceneProposals.filter((proposal) => proposal.selectedForProduction !== false).map((proposal, index) => {
    const nodeId = `scene-${proposal.sceneAssetKey}`;
    return { proposal, nodeId, position: { x: scenePosition.x + index * 820, y: scenePosition.y }, prompt: sceneImagePrompts.find((item) => item.sceneAssetKey === proposal.sceneAssetKey), image: sceneImages.find((item) => item.sceneAssetKey === proposal.sceneAssetKey), view: sceneViews.find((item) => item.sceneAssetKey === proposal.sceneAssetKey), generating: sceneImageRequestKeys.includes(proposal.sceneAssetKey) };
  });

  useLayoutEffect(() => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const copyContents = Array.from(canvas.querySelectorAll<HTMLElement>(".scene-proposal-copy-content"));
    if (copyContents.length === 0) {
      setSceneCopyRowHeight(0);
      return;
    }
    const synchronizeRowHeight = () => {
      const nextHeight = Math.max(...copyContents.map((element) => element.offsetHeight));
      setSceneCopyRowHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
    };
    synchronizeRowHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(synchronizeRowHeight);
    copyContents.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sceneProposals]);
  const propPosition = { x: rowStartX, y: 3100 + seriesLayoutOffset };
  const propNodes = propProposals.filter((proposal) => proposal.selectedForProduction !== false).map((proposal, index) => { const nodeId = `prop-${proposal.propAssetKey}`; return { proposal, nodeId, position: { x: propPosition.x + index * 820, y: propPosition.y }, prompt: propImagePrompts.find((item) => item.propAssetKey === proposal.propAssetKey), image: propImages.find((item) => item.propAssetKey === proposal.propAssetKey), generating: propImageRequestKeys.includes(proposal.propAssetKey) }; });
  const h3SettingsVisible = assetStageVisible || storyboardAssetsApproval === "approved" || videoPrompts.length > 0 || shotVideoTasks.length > 0 || shotVideosApproval === "approved";
  const storyboardPosition = { x: rowStartX, y: 4500 + seriesLayoutOffset };
  const storyboardColumnCount = 3;
  const storyboardColumnGap = 680;
  const storyboardHasIntegratedVideo = storyboardAssetsApproval === "approved" || videoPrompts.length > 0 || shotVideoTasks.length > 0;
  const storyboardSegmentHasExpandedMedia = (segmentKey: string) => {
    const board = storyboardBoards.find((item) => item.segmentKey === segmentKey && storyboardBoardResultPanelCount(item) === storyboardPanelCount);
    return Boolean(board && (board.imageUrl || board.videoUrl || board.status === "running" || (board.status === "needs_selection" && board.imageUrls?.length)));
  };
  const storyboardRowCount = Math.max(1, Math.ceil(storyboardSegments.length / storyboardColumnCount));
  const storyboardRowHeights = Array.from({ length: storyboardRowCount }, (_, row) => {
    const rowSegments = storyboardSegments.slice(row * storyboardColumnCount, (row + 1) * storyboardColumnCount);
    const measuredHeights = rowSegments.map((segment) => storyboardNodeHeights[`storyboard-${segment.segmentKey}`]).filter((height): height is number => Number.isFinite(height) && height > 0);
    if (measuredHeights.length === rowSegments.length) return Math.max(...measuredHeights);
    return Math.max(490, ...rowSegments.map((segment) => storyboardTextCardHeight(segment.storyboardText)));
  });
  const storyboardRowOffsets = storyboardRowHeights.map((_, row) => storyboardRowHeights.slice(0, row).reduce((total, height) => total + height + 40, 0));
  const storyboardCardHeight = Math.max(...storyboardRowHeights);
  const storyboardNodes = storyboardSegments.map((segment, index) => {
    const nodeId = `storyboard-${segment.segmentKey}`;
    const column = index % storyboardColumnCount;
    const row = Math.floor(index / storyboardColumnCount);
    const board = storyboardBoards.find((item) => item.segmentKey === segment.segmentKey && storyboardBoardResultPanelCount(item) === storyboardPanelCount);
    return { segment, nodeId, expandedMedia: storyboardSegmentHasExpandedMedia(segment.segmentKey), position: { x: storyboardPosition.x + column * storyboardColumnGap, y: storyboardPosition.y + storyboardRowOffsets[row] }, prompt: storyboardBoardPrompts.find((item) => item.segmentKey === segment.segmentKey && storyboardPromptPanelCount(item) === storyboardPanelCount), board, videoPrompt: videoPrompts.find((item) => item.segmentKey === segment.segmentKey), videoTask: shotVideoTasks.find((item) => item.segmentKey === segment.segmentKey) };
  });
  const storyboardNodeSignature = storyboardNodes.map((item) => item.nodeId).join("|");

  useLayoutEffect(() => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const nodes = Array.from(canvas.querySelectorAll<HTMLElement>(".storyboard-segment-node[data-node-id]"));
    if (nodes.length === 0) {
      setStoryboardNodeHeights({});
      return;
    }
    const measure = () => {
      const next = Object.fromEntries(nodes.map((node) => [node.dataset.nodeId!, Math.ceil(Math.max(node.offsetHeight, node.scrollHeight))]));
      setStoryboardNodeHeights((current) => {
        const currentKeys = Object.keys(current);
        const nextKeys = Object.keys(next);
        return currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === next[key]) ? current : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [storyboardNodeSignature]);
  const storyboardBlockHeight = storyboardRowHeights.reduce((total, height) => total + height, 0) + Math.max(0, storyboardRowCount - 1) * 40;
  const shotVideoPosition = { x: stageSpineX - 850 - 45, y: storyboardPosition.y };
  const roughCutPosition = { x: storyboardPosition.x, y: storyboardPosition.y + storyboardBlockHeight + 160 };
  const musicDesignVisible = postProduction.roughCutApproval === "approved" && ["native_with_music", "music_only"].includes(postProduction.audioMode);
  const musicDesignPosition = { x: roughCutPosition.x, y: roughCutPosition.y + 980 };
  const finalCompositionVisible = postProduction.finalComposition.status !== "idle";
  const finalCompositionPosition = { x: roughCutPosition.x, y: musicDesignVisible ? musicDesignPosition.y + 1220 : roughCutPosition.y + 980 };
  const compactFinalReview = postProduction.roughCut.status === "complete" && postProduction.music.status === "complete" && postProduction.finalComposition.status === "complete";
  const musicSummaryPosition = { x: roughCutPosition.x + 1260, y: roughCutPosition.y };
  const plannedEpisodes = script?.workType === "series" ? script.seriesPlan || [] : [];
  const completedEpisodeCount = episodeScripts.filter((item) => item.status === "complete" && item.script).length;
  const flowRows = [
    { key: "brief", label: "01 · 项目设定", visible: setupVisible, positions: [briefPosition] },
    { key: "script", label: brief.workType === "series" ? "02 · 系列规划 / 分集脚本" : "02 · 剧本", visible: scriptVisible, positions: brief.workType === "series" ? [scriptPosition, episodeScriptsPosition] : [scriptPosition] },
    { key: "characters", label: "03 · 角色设计", visible: assetStageVisible, positions: characterNodes.length ? characterNodes.map((item) => item.position) : [assetPosition] },
    { key: "scenes", label: "04 · 场景设计", visible: characterAssetsApproval === "approved", positions: sceneNodes.length ? sceneNodes.map((item) => item.position) : [scenePosition] },
    { key: "props", label: "05 · 道具设计 · 可选", visible: sceneAssetsApproval === "approved", positions: propNodes.length ? propNodes.map((item) => item.position) : [propPosition] },
    { key: "storyboards", label: storyboardHasIntegratedVideo ? "06-08 · 视频设置 / 分镜 / 提示词 / 镜头视频" : "06 · 分镜设计", visible: propAssetsApproval === "approved", positions: h3SettingsVisible ? [shotVideoPosition, ...storyboardNodes.map((item) => item.position)] : storyboardNodes.length ? storyboardNodes.map((item) => item.position) : [storyboardPosition] },
    { key: "rough-cut", label: compactFinalReview ? "09-11 · 成片与配乐验收" : "09 · 粗剪播放与验收", visible: shotVideosApproval === "approved", positions: compactFinalReview ? [roughCutPosition, musicSummaryPosition] : [roughCutPosition] },
    { key: "music-design", label: "10 · 配乐设计与生成", visible: musicDesignVisible && !compactFinalReview, positions: [musicDesignPosition] },
    { key: "final-composition", label: "11 · 最终成片播放与验收", visible: finalCompositionVisible && !compactFinalReview, positions: [finalCompositionPosition] },
  ].filter((row) => row.visible);
  const flowCanvasWidth = Math.max(5000, ...flowRows.flatMap((row) => row.positions.map((position) => position.x + 720)));
  const flowCanvasHeight = compactFinalReview ? roughCutPosition.y + 980 : finalCompositionVisible ? finalCompositionPosition.y + 1150 : musicDesignVisible ? musicDesignPosition.y + 1220 : shotVideosApproval === "approved" ? roughCutPosition.y + 960 : storyboardPosition.y + storyboardBlockHeight + 420;

  useEffect(() => {
    if (navigationRequest === 0 || !flowCanvasRef.current) return;
    const runId = ++navigationRunRef.current;
    const rect = flowCanvasRef.current.getBoundingClientRect();
    const viewport = { width: rect.width, height: rect.height };
    const rowCenterX = (positions: CanvasPoint[], cardWidth: number, fallback: number) => {
      if (positions.length === 0) return fallback;
      const xValues = positions.map((position) => position.x);
      return (Math.min(...xValues) + Math.max(...xValues) + cardWidth) / 2;
    };
    const characterCardWidth = characterNodes.some((item) => Boolean(item.turnaround)) ? 1180 : 820;
    const characterCenterX = rowCenterX(characterNodes.map((item) => item.position), characterCardWidth, assetPosition.x + characterCardWidth / 2);
    const sceneCenterX = rowCenterX(sceneNodes.map((item) => item.position), 760, scenePosition.x + 300);
    const propCenterX = rowCenterX(propNodes.map((item) => item.position), 760, propPosition.x + 300);
    const storyboardCenterX = rowCenterX(storyboardNodes.map((item) => item.position), 600, storyboardPosition.x + 300);
    const storyboardRightX = storyboardNodes.length ? Math.max(...storyboardNodes.map((item) => item.position.x + 600)) : storyboardPosition.x + 600;
    const videoWorkspaceCenterX = (shotVideoPosition.x + storyboardRightX) / 2;
    const targetByStage: Record<string, { x: number; y: number; zoom: number }> = directorUiPreview ? {
      "总览": { x: 940, y: 720, zoom: 0.5 },
      "剧本": { x: scriptPosition.x + (brief.workType === "series" ? 390 : 300), y: scriptPosition.y + 250, zoom: brief.workType === "series" ? 0.7 : 0.88 },
      "角色": { x: (characterNodes[0]?.position.x ?? assetPosition.x) + characterCardWidth / 2, y: assetPosition.y + 350, zoom: characterCardWidth > 900 ? 0.72 : 0.84 },
      "场景": { x: (sceneNodes[0]?.position.x ?? scenePosition.x) + 380, y: scenePosition.y + 360, zoom: 0.84 },
      "道具": { x: (propNodes[0]?.position.x ?? propPosition.x) + 380, y: propPosition.y + 340, zoom: 0.84 },
      "分镜": { x: (storyboardNodes[0]?.position.x ?? storyboardPosition.x) + 300, y: storyboardPosition.y + Math.min(420, storyboardCardHeight / 2), zoom: 0.8 },
      "视频": { x: shotVideoPosition.x + 425, y: shotVideoPosition.y + 350, zoom: 0.78 },
    } : {
      "总览": { x: 940, y: 720, zoom: 0.5 },
      "剧本": { x: scriptPosition.x + (brief.workType === "series" ? 760 : 180), y: scriptPosition.y + 240, zoom: brief.workType === "series" ? 0.5 : 0.8 },
      "角色": { x: characterCenterX, y: assetPosition.y + 350, zoom: 0.65 },
      "场景": { x: sceneCenterX, y: scenePosition.y + 620, zoom: 0.65 },
      "道具": { x: propCenterX, y: propPosition.y + 460, zoom: 0.65 },
      "分镜": { x: storyboardCenterX, y: storyboardPosition.y + Math.min(620, storyboardCardHeight / 2), zoom: 0.65 },
      "视频": { x: videoWorkspaceCenterX, y: storyboardPosition.y + 430, zoom: 0.5 },
    };
    const videoParametersTarget = { x: shotVideoPosition.x + 425, y: shotVideoPosition.y + 350, zoom: 0.72 };
    const destination = navigationRequest < 0 && h3SettingsVisible ? videoParametersTarget : targetByStage[activeStage] || targetByStage["总览"];
    const centeredView = (point: { x: number; y: number }, zoom: number): CanvasView => ({
      x: Math.round(viewport.width / 2 - point.x * zoom),
      y: Math.round(viewport.height / 2 - point.y * zoom),
      zoom,
      nodes: {},
    });
    const currentCenter = {
      x: (viewport.width / 2 - canvasView.x) / canvasView.zoom,
      y: (viewport.height / 2 - canvasView.y) / canvasView.zoom,
    };
    const overviewAtCurrent = centeredView(currentCenter, 0.35);
    const overviewAtTarget = centeredView(destination, 0.35);
    const finalView = centeredView(destination, destination.zoom);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      onCanvasView(finalView);
      return;
    }
    const ease = (value: number) => value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
    const animateView = (from: CanvasView, to: CanvasView, duration: number) => new Promise<boolean>((resolve) => {
      const startedAt = performance.now();
      const frame = (now: number) => {
        if (navigationRunRef.current !== runId) { resolve(false); return; }
        const progress = Math.min(1, (now - startedAt) / duration);
        const amount = ease(progress);
        onCanvasView({
          x: Math.round(from.x + (to.x - from.x) * amount),
          y: Math.round(from.y + (to.y - from.y) * amount),
          zoom: from.zoom + (to.zoom - from.zoom) * amount,
          nodes: {},
        });
        if (progress < 1) window.requestAnimationFrame(frame);
        else resolve(true);
      };
      window.requestAnimationFrame(frame);
    });
    void (async () => {
      if (!await animateView(canvasView, overviewAtCurrent, 260)) return;
      if (!await animateView(overviewAtCurrent, overviewAtTarget, 420)) return;
      await animateView(overviewAtTarget, finalView, activeStage === "总览" ? 220 : 340);
    })();
    return () => { navigationRunRef.current += 1; };
  }, [navigationRequest]);

  return (
    <section className="workspace" aria-label="制作画布">
      <div ref={flowCanvasRef} className={`flow-canvas ${panning ? "panning" : ""}`} onPointerDown={beginCanvasDrag} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={handleCanvasWheel}>
        <div className="flow-pan" style={{ transform: `translate3d(${Math.round(canvasView.x)}px, ${Math.round(canvasView.y)}px, 0)` }}>
        <div className={`flow-content fixed-stage-layout ${semanticZoomClass(canvasView.zoom)} ${activeStage === "剧本" && brief.workType === "series" ? "series-script-focus" : ""}`} data-active-stage={directorUiPreview ? activeStage : undefined} style={{ zoom: canvasView.zoom, width: flowCanvasWidth, height: flowCanvasHeight }}>
        {!setupVisible && <div className="canvas-empty"><span>✦</span><h3>从左侧开始创建项目</h3><p>选择素材来源后，项目节点会按照真实制作进度依次出现在这里。</p></div>}
        {flowRows.map((row) => <div key={row.key} className={`stage-row-guide ${directorUiPreview && ({ "总览": "brief", "剧本": "script", "角色": "characters", "场景": "scenes", "道具": "props", "分镜": "storyboards", "视频": "storyboards" } as Record<string, string>)[activeStage] === row.key ? "studio-current-row" : ""}`} style={{ top: row.positions[0].y - 54, width: flowCanvasWidth - 80 }}><span title={row.label}>{row.label}</span><i /></div>)}
        {flowRows.length > 0 && <svg className="connection-layer fixed-stage-connections" width={flowCanvasWidth} height={flowCanvasHeight} aria-hidden="true">
          <path className="stage-spine" d={`M ${stageSpineX} ${flowRows[0].positions[0].y + 96} V ${flowRows[flowRows.length - 1].positions[0].y + 96}`} />
          {flowRows.flatMap((row) => row.positions.map((position, index) => <path key={`${row.key}-${index}`} d={`M ${stageSpineX} ${position.y + 96} H ${position.x}`} />))}
        </svg>}
        {propAssetsApproval === "approved" && storyboardNodes.length > 0 && <div className="storyboard-grid-backdrop" style={{ left: storyboardPosition.x - 24, top: storyboardPosition.y - 18, width: storyboardColumnCount * storyboardColumnGap - 16, height: storyboardBlockHeight + 36 }} aria-hidden="true" />}
        {setupVisible && <NodeCard nodeId="brief" position={briefPosition} onPointerDown={beginNodeDrag} className="brief-node" badge="01 · 项目设定" title={`${workTypeLabel(brief.workType)} · ${creativeDirectionLabel(brief.creativeDirection)}`} status={setupComplete ? "已确认" : "设置中"}>
          <div className="brief-pills"><span>{brief.duration}</span>{brief.workType === "series" && <span>{brief.episodeCount}</span>}<span>{brief.ratio}</span><span>{brief.language}</span><span className="pink">{brief.emotion}</span></div>
          <p>主情绪或表达气质作为正式上游输入，并由后续分镜和视频提示词继承。</p>
        </NodeCard>}

        {scriptVisible && script && brief.workType !== "series" && <NodeCard nodeId="script" position={scriptPosition} onPointerDown={beginNodeDrag} className="script-node" badge="02 · 剧本" title={`《${script.title}》`} status={scriptApproved ? "已确认" : "草稿待确认"}>
          <div className="script-lines"><i /><i /><i /><i className="short" /></div>
          <div className="node-meta"><span>{script.scenes.length}场</span><span>{script.durationSec}秒</span><span>{brief.creativeDirection === "story" ? "完整故事" : "完整执行脚本"}</span></div>
          <div className="script-node-summary">
            <span>{brief.creativeDirection === "story" ? "剧情简介" : "内容简介"}</span>
            <p>{script.logline}</p>
            <div>{script.scenes.slice(0, 3).map((scene, index) => <section key={scene.id}><b>场景{index + 1} · {scene.location}</b><small>{scene.summary}</small></section>)}</div>
          </div>
          <button className="node-detail-button" onClick={onOpenScript}>查看完整剧本 →</button>
        </NodeCard>}

        {scriptVisible && script && brief.workType === "series" && <NodeCard nodeId="series-plan" position={scriptPosition} onPointerDown={beginNodeDrag} className="script-node series-plan-node" badge="02A · 系列规划" title={`《${(seriesMotherScript || script).title}》系列规划`} status="规划已生成">
          <div className="node-meta"><span>{script.plannedEpisodeCount || plannedEpisodes.length}集</span><span>系列主线</span><span>独立板块</span></div>
          <div className="script-node-summary"><span>系列梗概</span><p>{(seriesMotherScript || script).logline}</p></div>
          <div className="series-plan-preview">{plannedEpisodes.slice(0, 4).map((episode) => <section key={episode.episodeNumber}><b>第{episode.episodeNumber}集 · {episode.title}</b><small>{episode.summary}</small></section>)}</div>
          {plannedEpisodes.length > 4 && <small className="more-episodes">另有 {plannedEpisodes.length - 4} 集规划</small>}
          <button className="node-detail-button" onClick={onOpenSeriesPlan}>查看系列规划 →</button>
        </NodeCard>}

        {scriptVisible && script && brief.workType === "series" && <NodeCard nodeId="episode-scripts" position={episodeScriptsPosition} onPointerDown={beginNodeDrag} className="script-node episode-scripts-node" badge="02B · 分集剧本" title="分集剧本库" status={`${completedEpisodeCount}/${plannedEpisodes.length}集已生成`}>
          <p className="episode-library-note">当前制作第{script.episodeNumber || 1}集。生成分集剧本后，进入本集制作；各集的素材、分镜和视频独立保存，可从项目目录打开。</p>{episodeProductionError && <p role="alert">{episodeProductionError}</p>}
          <div className="episode-script-list">{plannedEpisodes.map((episode) => {
            const record = episodeScripts.find((item) => item.episodeNumber === episode.episodeNumber);
            const hasScript = Boolean(record?.script);
            return <section key={episode.episodeNumber} className={`episode-script-row status-${record?.status || "idle"}`}>
              <div><b>{record?.scriptKey || `EP${String(episode.episodeNumber).padStart(3, "0")}`} · 第{episode.episodeNumber}集</b><small>{record?.script?.title || episode.title}{record?.version ? ` · v${record.version}` : ""}</small>{record?.error && <em>{record.error}</em>}</div>
              <div className="episode-row-actions">{hasScript && <button disabled={episodeOpening || record?.status === "running" || episode.episodeNumber === (script.episodeNumber || 1)} onClick={() => onOpenEpisodeProduction(episode.episodeNumber)}>{episode.episodeNumber === (script.episodeNumber || 1) ? "当前制作集" : episodeOpening ? "正在打开…" : "进入本集制作"}</button>}{hasScript && <button onClick={() => onOpenEpisodeScript(episode.episodeNumber)}>查看</button>}<button disabled={record?.status === "running"} onClick={() => onGenerateEpisode(episode.episodeNumber)}>{record?.status === "running" ? "生成中…" : hasScript ? "生成新版本" : "生成本集"}</button></div>
            </section>;
          })}</div>
          <small className="episode-library-footnote">新版本成功后版本号递增；失败时旧版本继续保留，系统不会自动重试。</small>
        </NodeCard>}

        {assetStageVisible && activeStage === "角色" && <div className="canvas-character-add"><button onClick={() => onOpenCharacterLibrary()}>＋ 添加角色</button></div>}
        {assetStageVisible && characterNodes.length === 0 && <NodeCard nodeId="asset" position={assetPosition} onPointerDown={beginNodeDrag} className={`asset-node character-node character-${characterStatus}`} badge="03 · 角色设计" title="主要角色简介" status={characterStatus === "running" ? "生成中" : characterStatus === "failed" ? "失败" : "等待开始"}>
          {characterStatus === "running" && <div className="canvas-character-loading"><ThinkingOrbs /><p>角色设计师正在阅读已锁定剧本</p><i /><i /><i className="short" /></div>}
          {characterStatus === "failed" && <div className="canvas-character-error"><strong>本次生成未写入</strong><p>{characterError || "可从左侧手动重新提交，系统不会自动重试。"}</p></div>}
          {characterStatus === "idle" && <p>剧本已锁定。由左侧明确启动后，这里会显示生成进度与主要角色简介。</p>}
        </NodeCard>}
        {assetStageVisible && characterNodes.map(({ profile, nodeId, position, image, prompt, turnaround, generating }) => <NodeCard key={nodeId} nodeId={nodeId} position={position} onPointerDown={beginNodeDrag} className={`character-result-node ${turnaround ? "turnaround-expanded" : "turnaround-collapsed"} image-${generating ? "running" : image?.status || "idle"}`} badge="03 · 角色设计" title={profile.name} status={characterAssetsApproval === "approved" ? image?.status === "complete" ? "图片与文字参考已确认" : "文字参考已确认" : turnaround?.status === "running" ? "正在生成三视图" : generating ? "正在生成角色图" : turnaround?.status === "complete" ? "主图与三视图已生成" : turnaround?.status === "failed" ? "三视图失败" : image?.status === "complete" ? "角色图已生成" : image?.status === "failed" ? "图片失败 · 使用文字参考" : characterApproval === "approved" ? "文字设定已确认" : "简介待确认"}>
          <div className="character-result-copy">
            <strong>{profile.storyRole || profile.identity}</strong>
            <span>{profile.identity}</span>
            <p>{profile.introduction}</p>
          </div>
          <div className="character-result-layout">
            <div className={`character-image-slot ${generating ? "running" : image?.status || "idle"}`}>
              {image?.status === "complete" && image.imageUrl ? <><button className="image-preview-button" onClick={() => onViewImage(image.imageUrl!, `${profile.name} · 角色主图`)}><img src={image.imageUrl} alt={`${profile.name}角色主图`} /><span>查看角色主图大图</span></button>{generating && <div className="character-image-regenerating" role="status"><span aria-hidden="true">✦</span><strong>正在生成新版本</strong><small>当前图片会保留到新图完成</small><i aria-hidden="true"><b /></i></div>}</> : generating ? <div className="character-image-generating" role="status"><div className="character-generation-stage character-main-generation-stage" aria-hidden="true"><img src="/assets/ui/character-generation-loading-v1.png" alt="" /></div><strong>人物形象正在成形</strong><small>{profile.name} · {selectedStyle?.name || "统一画风"}</small><div className="character-generation-track" aria-hidden="true"><i /></div></div> : <div className="character-image-placeholder"><strong>{image?.status === "failed" ? "角色图未完成" : "生成角色图"}</strong><small>{image?.status === "failed" ? image.error || "可以保留文字设定并手动重新生成" : selectedStyle ? `使用完整人物设定与${selectedStyle.name}` : "先在左侧选择全片画风"}</small><button type="button" className="canvas-character-generate" disabled={!selectedStyle} title={selectedStyle ? `生成${profile.name}角色图` : "请先选择全片画风"} onClick={() => onRegenerateImage(profile.profileKey)}><span aria-hidden="true">✦</span>{image?.status === "failed" ? "重新生成角色图" : "生成角色图"}</button></div>}
            </div>
          </div>
          {turnaround && <div className={`character-turnaround-preview ${turnaround.status}`}>
            {turnaround.status === "complete" && turnaround.imageUrl ? <button className="image-preview-button" onClick={() => onViewImage(turnaround.imageUrl!, `${profile.name} · 角色三视图`)}><img src={turnaround.imageUrl} alt={`${profile.name}角色三视图`} /><span>查看角色三视图大图</span></button> : turnaround.status === "running" ? <div className="character-image-generating character-turnaround-generating" role="status"><div className="character-generation-stage character-turnaround-generation-stage" aria-hidden="true"><img src="/assets/ui/character-turnaround-loading-v1.png" alt="" /></div><strong>正在生成角色三视图</strong><small>{profile.name} · 正面、侧面与背面</small><div className="character-generation-track" aria-hidden="true"><i /></div></div> : <div className="character-turnaround-state failed"><span>!</span><strong>三视图生成失败</strong><small>{turnaround.error || "本次结果未写入，系统没有自动重试。"}</small></div>}
          </div>}
          {(prompt || image?.imageUrl) && <div className="character-prompt-actions">{prompt && <button disabled={generating} onClick={() => onEditPrompt(profile.profileKey)}>查看 / 编辑提示词</button>}{image?.imageUrl && <button disabled={generating} onClick={() => onRegenerateImage(profile.profileKey)}>{generating ? "正在重新生成主图…" : "重新生成角色主图"}</button>}{image?.imageUrl && <button className="turnaround-generate-button" disabled={turnaround?.status === "running"} onClick={() => onGenerateTurnaround(profile.profileKey)}>{turnaround?.status === "running" ? "正在生成三视图……" : turnaround ? "重新生成角色三视图" : "生成角色三视图"}</button>}</div>}
          <div className="character-result-actions"><button onClick={() => onOpenCharacterLibrary(profile.profileKey)}>造型与版本</button><button disabled={characterImageRequestKeys.length > 0} onClick={() => onRemoveCharacter(profile.profileKey)}>移出本集</button>{characterAssetsApproval === "approved" && <span className="muted">已保存到人物库</span>}</div>
        </NodeCard>)}
        {characterAssetsApproval === "approved" && sceneNodes.length === 0 && <NodeCard nodeId="scene-stage" position={scenePosition} onPointerDown={beginNodeDrag} className={`asset-node scene-stage-node ${sceneStageSkipped ? "scene-skipped" : ""}`} badge="04 · 场景设计" title={sceneStageSkipped ? "场景按需生成" : "场景视觉提案"} status={sceneStageSkipped ? "已跳过" : sceneStatus === "running" ? "整理中" : sceneStatus === "failed" ? "未完成" : "等待开始"}><div className="scene-empty-frame"><span aria-hidden="true">{sceneStatus === "running" ? "◌" : "◇"}</span><strong>{sceneStageSkipped ? "本片不建立固定场景" : sceneStatus === "running" ? "正在归并场景" : "场景参考图"}</strong><small>{sceneStageSkipped ? "分镜会按镜头需要描述空间" : "视觉提案确认后在这里呈现"}</small></div></NodeCard>}
        {characterAssetsApproval === "approved" && sceneNodes.map(({ proposal, nodeId, position, prompt, image, view, generating }) => {
          const canUseSceneMedia = image?.status === "complete" && Boolean(image.imageUrl);
          const selectedSceneMedia = canUseSceneMedia ? sceneMediaViewByKey[proposal.sceneAssetKey] || (view ? "views" : "main") : "main";
          const showSceneViews = selectedSceneMedia === "views" && canUseSceneMedia;
          const selectSceneMedia = (nextView: "main" | "views") => setSceneMediaViewByKey((current) => ({ ...current, [proposal.sceneAssetKey]: nextView }));
          const generateSceneViews = () => {
            selectSceneMedia("views");
            onGenerateSceneView(proposal.sceneAssetKey);
          };
          return <NodeCard key={nodeId} nodeId={nodeId} position={position} onPointerDown={beginNodeDrag} className="scene-proposal-node" badge="04 · 场景设计" title={proposal.name} status={sceneAssetsApproval === "approved" ? image?.status === "complete" ? view?.status === "complete" ? "图片与文字参考已确认" : "主图与文字参考已确认" : "文字参考已确认" : view?.status === "complete" ? "多角度已生成" : generating ? "正在生成场景图" : image?.status === "complete" ? "场景图已生成" : image?.status === "failed" ? "图片失败 · 使用文字参考" : sceneProposalApproval === "approved" ? "文字提案已确认" : "提案待确认"}>
          <div className="scene-proposal-copy" style={sceneCopyRowHeight > 0 ? { minHeight: `${sceneCopyRowHeight}px` } : undefined}><div className="scene-proposal-copy-content"><SceneUsageSummary proposal={proposal} compact /><p>{proposal.visualDesignProposal.locationIdentity}</p><dl><div><dt>空间</dt><dd>{proposal.visualDesignProposal.spatialLayout}</dd></div><div><dt>光色</dt><dd>{proposal.visualDesignProposal.lightingAndColor}</dd></div><div><dt>固定地标</dt><dd>{proposal.visualDesignProposal.fixedLandmarks.join("、")}</dd></div></dl></div></div>
          <div className="scene-media-shell">
            <div className="scene-media-tabs" role="tablist" aria-label={`${proposal.name}场景图片`}>
              <button type="button" role="tab" aria-selected={!showSceneViews} className={!showSceneViews ? "active" : ""} onClick={() => selectSceneMedia("main")}>主图</button>
              <button type="button" role="tab" aria-selected={showSceneViews} className={showSceneViews ? "active" : ""} disabled={!canUseSceneMedia} onClick={() => selectSceneMedia("views")}>多角度{view?.status === "complete" ? <small>已生成</small> : view?.status === "running" ? <small>生成中</small> : null}</button>
            </div>
            <div className="scene-media-viewport">
              {!showSceneViews ? <div className={`scene-main-image-frame ${generating ? "running" : image?.status || "idle"}`}>{image?.status === "complete" && image.imageUrl ? <><button className="image-preview-button" onClick={() => onViewImage(image.imageUrl!, `${proposal.name} · 场景主图`)}><img src={image.imageUrl} alt={`${proposal.name}场景主图`} /><span>查看大图</span></button>{generating && <div className="character-image-regenerating" role="status"><span aria-hidden="true">✦</span><strong>正在生成新版本</strong><small>当前图片会保留到新图完成</small><i aria-hidden="true"><b /></i></div>}</> : generating ? <div className="character-image-generating" role="status"><div className="character-generation-stage scene-generation-stage" aria-hidden="true"><img src="/assets/ui/scene-generation-loading-v1.png" alt="" /></div><strong>正在生成场景图</strong><small>{proposal.name} · 16:9 主图</small><div className="character-generation-track" aria-hidden="true"><i /></div></div> : <div className="character-image-placeholder"><strong>{image?.status === "failed" ? "场景图未完成" : "16:9 场景主图"}</strong><small>{image?.status === "failed" ? image.error || "可以保留文字设定并手动重新生成" : "完整场景文字设定已保留"}</small><button type="button" className="canvas-character-generate" disabled={sceneProposalApproval !== "approved"} onClick={() => onRegenerateScene(proposal.sceneAssetKey)}><span aria-hidden="true">✦</span>{image?.status === "failed" ? "重新生成场景图" : "生成场景图"}</button></div>}</div> : view ? <div className={`scene-view-preview ${view.status}`}>{view.status === "complete" && view.imageUrl ? <button className="image-preview-button" onClick={() => onViewImage(view.imageUrl!, `${proposal.name} · 四宫格多角度图`)}><img src={view.imageUrl} alt={`${proposal.name}四宫格多角度图`} /><span>查看多角度大图</span></button> : view.status === "running" ? <div className="scene-view-generating" role="status"><div className="scene-view-generation-grid" aria-hidden="true">{["左前视角", "右前视角", "左后视角", "右后视角"].map((label) => <i key={label}><img src={image!.imageUrl} alt="" /></i>)}</div><strong>正在生成场景多角度图</strong><small>正在分析空间、透视与固定地标</small><div className="scene-view-generation-track" aria-hidden="true"><i /></div></div> : view.status === "needs_selection" && view.imageUrls?.length ? <><p>{view.error}</p><div className="scene-view-candidates">{view.imageUrls.map((url, index) => <article key={url}><button className="image-preview-button" onClick={() => onViewImage(url, `${proposal.name} · 多角度候选${index + 1}`)}><img src={url} alt={`${proposal.name}多角度候选${index + 1}`} /><span>查看大图</span></button><button onClick={() => onSelectSceneViewCandidate(proposal.sceneAssetKey, url)}>选择候选{index + 1}</button></article>)}</div></> : <><p>{view.error || "多角度图生成失败，没有自动重试。"}</p>{view.error?.includes("image_count_mismatch") || view.error?.includes("returned 2") ? <button onClick={() => onRecoverSceneViewCandidates(proposal.sceneAssetKey)}>读取已保留的候选图</button> : <button onClick={generateSceneViews}>重新生成多角度图</button>}</>}</div> : <button type="button" className="scene-view-generate" aria-label={`生成${proposal.name}场景多角度图`} onClick={generateSceneViews}><span className="scene-view-generate-copy"><strong>生成场景多角度图</strong><small>使用当前主图，点击即生成四宫格</small></span></button>}
            </div>
          </div>
          {(prompt || image?.imageUrl) && <div className="scene-node-actions"><button onClick={onOpenAssetLibrary}>从资产库选择 / 上传</button>{prompt && <button disabled={generating} onClick={() => onEditScenePrompt(proposal.sceneAssetKey)}>查看 / 编辑提示词</button>}{image?.imageUrl && <button disabled={generating} onClick={() => onRegenerateScene(proposal.sceneAssetKey)}>{generating ? "正在重新生成主图…" : "重新生成主图"}</button>}<button disabled={!image?.imageUrl || sceneAssetsApproval !== "approved"} title={sceneAssetsApproval === "approved" ? "保存为跨项目可复用资产" : "确认场景参考后才能加入资产库"} onClick={() => image?.imageUrl && void onSaveAsset({ type: "scene", name: proposal.name, sourceAssetKey: proposal.sceneAssetKey, description: proposal.visualDesignProposal.locationIdentity, tags: proposal.sourceSceneKeys, prompt: prompt?.prompt, media: { mainImageUrl: image.imageUrl, auxiliaryImageUrl: view?.imageUrl, referenceImageUrls: [image.imageUrl, view?.imageUrl].filter(Boolean) as string[] } }).catch((error) => window.alert(error instanceof Error ? error.message : "资产没有保存。"))}>＋ 加入资产库</button></div>}
        </NodeCard>;
        })}
        {sceneAssetsApproval === "approved" && propNodes.length === 0 && <div className={`prop-stage-inline-status ${propStatus} ${propAssetsApproval === "approved" ? "complete" : ""}`} style={{ left: propPosition.x, top: propPosition.y }} role="status"><strong>{propStatus === "running" ? "正在整理道具" : propAssetsApproval === "approved" ? "本片无需独立道具" : propStatus === "failed" ? "道具整理未完成" : propStatus === "complete" ? "未发现需要独立制作的道具" : "等待整理道具"}</strong><small>{propStatus === "running" ? "正在核对剧本中的物品与状态" : propAssetsApproval === "approved" ? "选择已保留，可继续后续制作" : propStatus === "failed" ? "可在左侧重新整理或直接跳过" : propStatus === "complete" ? "可在左侧确认并继续" : "场景参考完成后开始"}</small></div>}
        {sceneAssetsApproval === "approved" && propNodes.map(({ proposal, nodeId, position, prompt, image, generating }) => <NodeCard key={nodeId} nodeId={nodeId} position={position} onPointerDown={beginNodeDrag} className={`prop-proposal-node recommendation-${propAssetRecommendation(proposal)}`} badge="05 · 道具设计 · 可选" title={proposal.name} status={propAssetsApproval === "approved" ? image?.status === "complete" ? "图片与文字参考已确认" : "文字参考已确认" : generating ? "正在生成道具图" : image?.status === "complete" ? "道具图已生成" : image?.status === "failed" ? "图片失败 · 使用文字参考" : propProposalApproval === "approved" ? propAssetRecommendationCopy(proposal) : "提案待确认"}>
          <div className="prop-proposal-copy"><div className={`prop-asset-recommendation ${propAssetRecommendation(proposal)}`}><strong>{propAssetRecommendationCopy(proposal)}</strong><small>{proposal.assetRecommendationReason || "旧版提案未记录制作判断，可按实际镜头需要选择。"}</small></div><p>{proposal.visualDesignProposal.objectIdentity}</p><dl><div><dt>形制</dt><dd>{proposal.visualDesignProposal.silhouetteAndProportions}</dd></div><div><dt>材质</dt><dd>{proposal.visualDesignProposal.materialsAndSurface}</dd></div><div><dt>识别锚点</dt><dd>{proposal.visualDesignProposal.repeatableAnchors.join("、")}</dd></div></dl>{proposal.stateVariants.length > 0 && <div className="prop-state-list"><span>剧情状态</span>{proposal.stateVariants.map((variant) => <small key={variant.stateKey}>{variant.stateDescription}</small>)}</div>}</div>
          <div className={`prop-main-image-frame ${generating ? "running" : image?.status || "idle"}`}>{image?.status === "complete" && image.imageUrl ? <><button className="image-preview-button" onClick={() => onViewImage(image.imageUrl!, `${proposal.name} · 道具主图`)}><img src={image.imageUrl} alt={`${proposal.name}道具主图`} /><span>查看大图</span></button>{generating && <div className="character-image-regenerating" role="status"><span aria-hidden="true">✦</span><strong>正在生成新版本</strong><small>当前图片会保留到新图完成</small><i aria-hidden="true"><b /></i></div>}</> : generating ? <div className="character-image-generating" role="status"><div className="character-generation-stage prop-generation-stage" aria-hidden="true"><img src="/assets/ui/prop-generation-loading-v1.png" alt="" /></div><strong>正在生成道具图</strong><small>{proposal.name} · 3:2 资产板</small><div className="character-generation-track" aria-hidden="true"><i /></div></div> : <div className="character-image-placeholder prop-image-placeholder"><img className="prop-generation-preview" src="/assets/ui/prop-generation-loading-v1.png" alt="" aria-hidden="true" /><div className="prop-image-placeholder-copy"><strong>{image?.status === "failed" ? "道具图未完成" : propAssetRecommendation(proposal) === "text_only" ? "使用完整文字设定" : "3:2 道具资产板"}</strong><small>{image?.status === "failed" ? image.error || "可以保留文字设定并手动重新生成" : propAssetRecommendation(proposal) === "text_only" ? "这件道具默认在对应分镜中生成" : "完整道具文字设定已保留"}</small>{propAssetRecommendation(proposal) !== "text_only" && <button type="button" className="canvas-character-generate" disabled={propProposalApproval !== "approved"} onClick={() => onRegenerateProp(proposal.propAssetKey)}><span aria-hidden="true">✦</span>{image?.status === "failed" ? "重新生成道具图" : propAssetRecommendation(proposal) === "required" ? "生成建议道具图" : "按需生成道具图"}</button>}</div></div>}</div>
          {(prompt || image?.imageUrl) && <div className="prop-node-actions"><button onClick={onOpenAssetLibrary}>从资产库选择 / 上传</button>{prompt && <button disabled={generating} onClick={() => onEditPropPrompt(proposal.propAssetKey)}>查看 / 编辑提示词</button>}{image?.imageUrl && <button disabled={generating} onClick={() => onRegenerateProp(proposal.propAssetKey)}>{generating ? "正在重新生成主图…" : "重新生成主图"}</button>}<button disabled={!image?.imageUrl || propAssetsApproval !== "approved"} title={propAssetsApproval === "approved" ? "保存为跨项目可复用资产" : "确认道具参考后才能加入资产库"} onClick={() => image?.imageUrl && void onSaveAsset({ type: "prop", name: proposal.name, sourceAssetKey: proposal.propAssetKey, description: proposal.visualDesignProposal.objectIdentity, tags: proposal.aliases, prompt: prompt?.prompt, media: { mainImageUrl: image.imageUrl, referenceImageUrls: [image.imageUrl] } }).catch((error) => window.alert(error instanceof Error ? error.message : "资产没有保存。"))}>＋ 加入资产库</button></div>}
        </NodeCard>)}
        {propAssetsApproval === "approved" && storyboardNodes.length === 0 && <NodeCard nodeId="storyboard-stage" position={storyboardPosition} onPointerDown={beginNodeDrag} className="asset-node storyboard-stage-node" badge="06 · 分镜设计" title="文字分镜与故事板" status={storyboardStatus === "running" ? "正在拆分" : storyboardStatus === "failed" ? "未完成" : "等待开始"}><div className="storyboard-empty-frame"><span aria-hidden="true">{storyboardStatus === "running" ? "◌" : "◇"}</span><strong>{storyboardStatus === "running" ? "正在生成文字分镜" : "故事板预览"}</strong><small>完成文字分镜后在这里呈现</small></div></NodeCard>}
        {propAssetsApproval === "approved" && storyboardNodes.map(({ segment, nodeId, expandedMedia, position, prompt, board, videoPrompt, videoTask }) => <NodeCard key={nodeId} nodeId={nodeId} position={position} onPointerDown={beginNodeDrag} className={`storyboard-segment-node ${storyboardHasIntegratedVideo ? "media-integrated" : expandedMedia ? "media-expanded" : "text-only"} ${videoPrompt?.status === "running" ? "video-prompt-updating" : ""}`} badge={`06 · 分镜 ${segment.order}`} title={segment.title} status={integratedStoryboardStatus({ board, boardStatus: storyboardBoardStatus, storyboardAssetsApproval, videoPrompt, videoPromptsApproval, videoTask, shotVideosApproval })}>
          {(board || prompt || videoPrompt || videoTask) ? <StoryboardMediaPanel segment={segment} segments={storyboardSegments} tasks={shotVideoTasks} continuityMode={shotContinuityModes[segment.segmentKey] || "independent"} onContinuityMode={onShotContinuityMode} board={board || { segmentKey: segment.segmentKey, title: segment.title, status: "idle" }} boardStatus={storyboardBoardStatus} storyboardPrompt={prompt ? { ...prompt, panelCount: prompt.panelCount || storyboardPanelCount } : undefined} videoWorkspaceEnabled={storyboardAssetsApproval === "approved"} videoPrompt={videoPrompt} videoPromptStatus={videoPromptStatus} videoPromptsApproval={videoPromptsApproval} videoTask={videoTask} connection={h3Connection} settings={h3GenerationSettings} onViewImage={onViewImage} onSelectCandidate={onSelectStoryboardCandidate} onOpenStoryboardText={onOpenStoryboardText} onEditStoryboardPrompt={onEditStoryboardPrompt} onRegenerateStoryboard={onRegenerateStoryboard} onEditVideoPrompt={onEditVideoPrompt} onRegenerateVideoPrompt={onRegenerateVideoPrompt} onRepairVideoPrompt={onRepairVideoPrompt} onSubmitShotVideo={onSubmitShotVideo} onCancelShotVideo={onCancelShotVideo} /> : <StoryboardCardCopy segment={segment} />}
        </NodeCard>)}
        {h3SettingsVisible && <H3ControlNode position={shotVideoPosition} onPointerDown={beginNodeDrag} connection={h3Connection} settings={h3GenerationSettings} tasks={shotVideoTasks} approval={shotVideosApproval} segmentCount={storyboardSegments.length} onRefresh={onRefreshH3} onStart={onStartH3} onSettings={onH3Settings} onApprove={onApproveShotVideos} />}
        {shotVideosApproval === "approved" && (compactFinalReview ? <CombinedFinalReviewNode position={roughCutPosition} onPointerDown={beginNodeDrag} state={postProduction} /> : <RoughCutNode position={roughCutPosition} onPointerDown={beginNodeDrag} state={postProduction} />)}
        {compactFinalReview && <MusicSummaryNode position={musicSummaryPosition} onPointerDown={beginNodeDrag} state={postProduction} onOpenDetails={() => setMusicDetailsOpen(true)} />}
        {musicDesignVisible && !compactFinalReview && <MusicDesignNode position={musicDesignPosition} onPointerDown={beginNodeDrag} state={postProduction} onGeneratePrompt={onGenerateMusicPrompt} onUpdatePrompt={onUpdateMusicPrompt} onApprovePrompt={onApproveMusicPrompt} />}
        {finalCompositionVisible && !compactFinalReview && <FinalCompositionNode position={finalCompositionPosition} onPointerDown={beginNodeDrag} state={postProduction} />}
        </div>
        </div>
      </div>
      {musicDetailsOpen && <MusicDetailsDialog state={postProduction} onClose={() => setMusicDetailsOpen(false)} onGeneratePrompt={onGenerateMusicPrompt} onUpdatePrompt={onUpdateMusicPrompt} onApprovePrompt={onApproveMusicPrompt} />}
    </section>
  );
}

function RoughCutNode({ position, onPointerDown, state }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; state: PostProductionState }) {
  const roughCut = state.roughCut;
  const statusLabel = roughCut.status === "complete" ? state.roughCutApproval === "approved" ? "已确认" : "结果待验收" : roughCut.status === "running" ? "正在生成" : roughCut.status === "failed" ? "生成失败" : roughCut.status === "stale" ? "需要更新" : "等待生成";
  return <NodeCard nodeId="rough-cut-stage" position={position} onPointerDown={onPointerDown} className={`rough-cut-stage-node ${roughCut.status}`} badge="09 · 粗剪" title="整集无配乐粗剪" status={statusLabel}>
    {roughCut.status === "complete" && roughCut.mediaUrl ? <>
      <div className="rough-cut-canvas-player"><video controls preload="metadata" src={roughCut.mediaUrl} /></div>
      <div className="rough-cut-canvas-meta"><strong>{roughCut.filename || "无配乐粗剪"}</strong><span>{roughCut.clipCount}段 · {roughCut.durationSec?.toFixed(2)}秒 · {roughCut.width}×{roughCut.height} · {roughCut.fps || "24fps"} · {roughCut.audioPresent ? "保留原声" : "无音轨"}</span><small>{state.roughCutApproval === "approved" ? "粗剪已确认，可回到左侧继续声音与字幕方案。" : "请完整播放检查镜头顺序、节奏和衔接，再到左侧确认。"}</small></div>
    </> : roughCut.status === "running" ? <div className="rough-cut-canvas-placeholder running" role="status" aria-live="polite" aria-label="正在本机编排镜头并校验粗剪">
      <div className="rough-cut-generation-visual" aria-hidden="true">
        <div className="rough-cut-generation-monitor">
          <div className="rough-cut-generation-frames">{Array.from({ length: 4 }, (_, index) => <i key={index}><span /><b /></i>)}</div>
          <div className="rough-cut-generation-scan" />
          <div className="rough-cut-generation-ruler"><span>00:00</span><i /><span>MEDIA CHECK</span></div>
        </div>
        <div className="rough-cut-generation-timeline">{Array.from({ length: 6 }, (_, index) => <i key={index}><span /></i>)}<b /></div>
      </div>
      <strong>正在编排镜头并校验媒体</strong>
      <small>本机正在按分镜顺序拼接、探测并完整解码；任务完成后原位切换为粗剪播放器。</small>
    </div> : <div className={`rough-cut-canvas-placeholder ${roughCut.status}`}><span>{roughCut.status === "failed" ? "!" : roughCut.status === "stale" ? "↻" : "▶"}</span><strong>{roughCut.status === "failed" ? "粗剪生成失败" : roughCut.status === "stale" ? "镜头已变化，需要更新粗剪" : "等待生成无配乐粗剪"}</strong><small>{roughCut.error || "在左侧选择生成；这里只显示播放器和验收信息。"}</small></div>}
  </NodeCard>;
}

function CombinedFinalReviewNode({ position, onPointerDown, state }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; state: PostProductionState }) {
  const [musicEnabled, setMusicEnabled] = useState(true);
  const final = state.finalComposition;
  const roughCut = state.roughCut;
  const selected = musicEnabled ? final : roughCut;
  const mediaUrl = selected.mediaUrl || "";
  const filename = selected.filename || (musicEnabled ? "最终成片" : "原声版");
  return <NodeCard nodeId="final-review-stage" position={position} onPointerDown={onPointerDown} className="combined-final-review-node" badge="09-11 · 成片验收" title="整集成片" status="待人工验收">
    <div className="final-review-toolbar"><div><strong>{musicEnabled ? "配乐版" : "原声版"}</strong><small>{musicEnabled ? "原声、配乐与最终字幕" : "关闭配乐，播放技术原声粗剪"}</small></div><button type="button" className={musicEnabled ? "music-on" : "music-off"} aria-pressed={musicEnabled} onClick={() => setMusicEnabled((current) => !current)}><span>♪</span> 配乐 {musicEnabled ? "开启" : "关闭"}</button></div>
    <div className="final-composition-canvas-player"><video key={mediaUrl} controls preload="metadata" src={mediaUrl} aria-label="成片验收播放器" /></div>
    <div className="final-composition-canvas-meta"><div><strong>{filename}</strong><span>{selected.durationSec?.toFixed(2)}秒 · {selected.width}×{selected.height} · {selected.fps || "24fps"} · {musicEnabled ? `${final.subtitleCount || 0}条字幕 · 原声 + 配乐` : "保留原声 · 无配乐"}</span></div><a href={mediaUrl} download={filename}>下载当前版本</a><small>{musicEnabled ? "请检查对白与配乐平衡、字幕时序、镜头衔接和片尾字。" : "当前播放的是合成前原声粗剪，因此不含最终烧录字幕；再次点击配乐开关即可恢复最终成片。"}</small></div>
  </NodeCard>;
}

function MusicSummaryNode({ position, onPointerDown, state, onOpenDetails }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; state: PostProductionState; onOpenDetails: () => void }) {
  const plan = state.musicPrompt.plan;
  const music = state.music;
  return <NodeCard nodeId="music-summary-stage" position={position} onPointerDown={onPointerDown} className="music-summary-canvas-node" badge="配乐" title="配乐简介" status="已用于成片">
    <div className="music-summary-icon">♪</div>
    <p>{plan?.creativeDirection || "配乐已确认并用于最终成片。"}</p>
    <dl><div><dt>音乐文件</dt><dd>{music.filename || "已保存"}</dd></div><div><dt>时长</dt><dd>{music.durationSec?.toFixed(2) || "—"}秒</dd></div><div><dt>结构</dt><dd>{plan?.cues.length || 0}个音乐节点</dd></div><div><dt>来源</dt><dd>{music.provider === "acestep-1.5" ? "本机 ACE-Step 1.5" : music.provider === "audiocpp-minimax-music-3" ? "旧版本机 Music 3" : music.provider === "minimax-music-3" ? "旧版MiniMax云端" : "已记录"}</dd></div></dl>
    {music.mediaUrl && <audio controls preload="metadata" src={music.mediaUrl} />}
    <button type="button" className="music-details-button" onClick={onOpenDetails}>查看配乐详情</button>
  </NodeCard>;
}

function MusicDetailsDialog({ state, onClose, onGeneratePrompt, onUpdatePrompt, onApprovePrompt }: { state: PostProductionState; onClose: () => void; onGeneratePrompt: () => void; onUpdatePrompt: (value: string) => void; onApprovePrompt: () => void }) {
  const prompt = state.musicPrompt;
  const plan = prompt.plan;
  const music = state.music;
  return <div className="music-details-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="music-details-dialog" role="dialog" aria-modal="true" aria-label="配乐详情"><header><div><span>10 · 配乐设计详情</span><h3>{plan?.title || "整集配乐方案"}</h3></div><button type="button" aria-label="关闭配乐详情" onClick={onClose}>×</button></header>{plan ? <div className="music-details-content">
    <section><b>总体音乐方向</b><p>{plan.creativeDirection}</p></section>
    <section className="music-details-cues"><b>逐段音乐节点</b><div>{plan.cues.map((cue) => <article key={cue.segmentKey}><strong>{cue.segmentKey} · {cue.startSec.toFixed(2)}–{cue.endSec.toFixed(2)}秒</strong><span>{cue.musicalFunction}</span><small>{cue.instrumentation}</small></article>)}</div></section>
    <section className="music-details-prompt"><b>ACE-Step 1.5提示词</b><textarea value={plan.minimaxPrompt} onChange={(event) => onUpdatePrompt(event.target.value)} spellCheck={false} aria-label="配乐详情提示词" /><small>{plan.minimaxPrompt.length}/2000 · 正向器乐描述</small><div><button type="button" onClick={onGeneratePrompt}>重新生成方案与提示词</button>{state.musicPromptApproval !== "approved" && <button type="button" disabled={prompt.status !== "complete" || !plan.minimaxPrompt.trim() || plan.minimaxPrompt.length > 2000} onClick={onApprovePrompt}>{prompt.status === "needs_revision" ? "修改后可确认" : "确认当前提示词"}</button>}</div></section>
    <section><b>本机混音执行</b><ul>{plan.mixGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
    {music.mediaUrl && <section className="music-details-audio"><b>{music.filename}</b><audio controls preload="metadata" src={music.mediaUrl} /></section>}
  </div> : <p>当前没有可展示的配乐方案。</p>}</section></div>;
}

function MusicGenerationProgress({ music, targetDurationSec }: { music: MusicGenerationResult; targetDurationSec: number }) {
  const startTime = useRef(Number.isFinite(Date.parse(music.startedAt || "")) ? Date.parse(music.startedAt || "") : Date.now());
  const [elapsedSec, setElapsedSec] = useState(() => Math.max(0, Math.floor((Date.now() - startTime.current) / 1000)));
  const isLocal = music.provider === "acestep-1.5";
  const stages = isLocal ? ["模型生成", "时长整理", "写入文件", "解码校验"] : ["提交云端", "等待生成", "下载文件", "媒体校验"];

  useEffect(() => {
    const updateElapsed = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startTime.current) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedLabel = elapsedSec < 60 ? `${elapsedSec}秒` : `${Math.floor(elapsedSec / 60)}分${String(elapsedSec % 60).padStart(2, "0")}秒`;
  return <div className="music-generation-progress" role="progressbar" aria-label="配乐生成进度" aria-valuetext="配乐正在生成，当前服务不提供实时百分比">
    <header>
      <div className="music-progress-signal" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
      <div><strong>{isLocal ? "本机 ACE-Step 1.5正在生成并校验" : "旧版配乐任务正在处理"}</strong><small>{isLocal ? `目标 ${targetDurationSec.toFixed(1)}秒 · Seed ${music.seed ?? "—"} · Turbo ${music.inferenceSteps ?? 8}步 · Thinking` : `目标 ${targetDurationSec.toFixed(1)}秒`}</small></div>
      <time>已用时 {elapsedLabel}</time>
    </header>
    <div className="music-progress-track" aria-hidden="true"><b /><i /></div>
    <ol>{stages.map((stage, index) => <li key={stage} className={index === 0 ? "active" : "queued"}><i /><span>{stage}</span><small>{index === 0 ? "处理中" : "随后自动执行"}</small></li>)}</ol>
    <p>当前生成接口不返回实时百分比，因此采用运行态进度轨，不显示虚假数值；完成、失败或校验结果会自动替换这里。</p>
  </div>;
}

function MusicDesignNode({ position, onPointerDown, state, onGeneratePrompt, onUpdatePrompt, onApprovePrompt }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; state: PostProductionState; onGeneratePrompt: () => void; onUpdatePrompt: (value: string) => void; onApprovePrompt: () => void }) {
  const prompt = state.musicPrompt;
  const music = state.music;
  const statusLabel = music.status === "complete" ? "配乐待验收" : music.status === "running" ? "正在生成" : music.status === "unqualified" ? "时长未达标 · 可试听" : music.status === "failed" ? "生成失败" : music.status === "stale" ? "旧配乐需更新" : prompt.status === "complete" ? state.musicPromptApproval === "approved" ? "提示词已确认" : "方案待确认" : prompt.status === "needs_revision" ? "草稿需修改" : prompt.status === "running" ? "正在设计" : prompt.status === "failed" ? "方案未完成" : "等待配乐方案";
  return <NodeCard nodeId="music-design-stage" position={position} onPointerDown={onPointerDown} className={`music-design-canvas-node ${prompt.status} music-${music.status}`} badge="10 · 配乐设计" title={prompt.plan?.title || "整集配乐方案"} status={statusLabel}>
    {prompt.plan ? <div className="music-canvas-layout">
      {prompt.status === "needs_revision" && <section className="music-validation-guidance music-canvas-validation"><strong>草稿未通过项</strong><ul>{prompt.validationIssues?.map((issue, index) => <li key={index}>{issue}</li>)}</ul><small>草稿和已通过内容均已保留；修改下方提示词后再确认。</small></section>}
      {!!prompt.validationWarnings?.length && <StageFeedback messages={prompt.validationWarnings} />}
      <section className="music-canvas-overview"><span>总体音乐方向</span><p>{prompt.plan.creativeDirection}</p><div><b>目标时长</b><strong>{prompt.plan.targetDurationSec.toFixed(2)}秒</strong><b>声音方案</b><strong>{state.audioMode === "native_with_music" ? "原声 + 配乐" : "仅配乐"}</strong><b>提示词状态</b><strong>{state.musicPromptApproval === "approved" ? "已确认" : "待确认"}</strong></div></section>
      <section className="music-canvas-cues"><header><b>逐段音乐节点</b><span>{prompt.plan.cues.length}段</span></header><div>{prompt.plan.cues.map((cue) => <article key={cue.segmentKey}><div><b>{cue.segmentKey}</b><span>{cue.startSec.toFixed(2)}–{cue.endSec.toFixed(2)}秒</span><i className={`energy-${cue.energy}`}>{cue.energy === "high" ? "高能量" : cue.energy === "medium" ? "中能量" : "低能量"}</i></div><h4>{cue.musicalFunction}</h4><p>{cue.instrumentation}</p><small>{cue.mixNote}</small></article>)}</div></section>
      <section className="music-canvas-prompt"><span>ACE-Step 1.5提示词 · 可编辑</span><textarea value={prompt.plan.minimaxPrompt} onChange={(event) => onUpdatePrompt(event.target.value)} spellCheck={false} aria-label="ACE-Step 1.5配乐提示词" /><small className={prompt.plan.minimaxPrompt.length > 2000 ? "over-limit" : ""}>{prompt.plan.minimaxPrompt.length}/2000 · 正向器乐描述 · 生成后仍需试听验收</small><div className="music-canvas-prompt-actions"><button className="secondary-button" disabled={prompt.status === "running"} onClick={onGeneratePrompt}>重新生成方案与提示词</button>{state.musicPromptApproval !== "approved" && <button className="primary-button" disabled={prompt.status !== "complete" || !prompt.plan.minimaxPrompt.trim() || prompt.plan.minimaxPrompt.length > 2000} onClick={onApprovePrompt}>{prompt.status === "needs_revision" ? "修改后可确认" : "确认当前提示词"}</button>}</div></section>
      <section className="music-canvas-mix"><span>本机混音执行</span><ul>{prompt.plan.mixGuidance.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
      <section className={`music-canvas-result ${music.status}`}>
        {["complete", "stale", "unqualified"].includes(music.status) && music.mediaUrl ? <><div><span>{music.status === "unqualified" ? "ACE-Step未达标结果（可试听）" : music.provider === "acestep-1.5" ? `ACE-Step ${music.status === "stale" ? "旧结果（需更新）" : "生成结果"}` : music.provider === "audiocpp-minimax-music-3" ? "旧版Music 3结果" : music.provider === "minimax-music-3" ? "旧版MiniMax云端结果" : "生成来源未记录"}</span><strong>{music.filename}</strong><small>{music.durationSec ? `${music.durationSec.toFixed(2)}秒` : "时长待读取"}{music.requestedDurationSec ? ` / 目标 ${music.requestedDurationSec.toFixed(2)}秒` : ""} · 已保存到E盘{music.inferenceSteps ? ` · ${music.inferenceSteps}步` : ""}{music.seed !== undefined ? ` · 种子 ${music.seed}` : ""} · 任务 {music.externalTaskId || "已记录"}</small></div><audio controls preload="metadata" src={music.mediaUrl} />{music.status === "stale" && <small>{music.error || "旧配乐仍保留，但不能进入最终合成。"}</small>}{music.status === "unqualified" && <small className="music-unqualified-note">{music.error || "有效音乐时长未达到目标；仅供试听，不能进入最终合成。"}</small>}</> : music.status === "running" ? <MusicGenerationProgress music={music} targetDurationSec={prompt.plan.targetDurationSec} /> : <div className="music-result-placeholder"><span>{music.status === "failed" ? "!" : music.status === "stale" ? "↻" : "♪"}</span><strong>{music.status === "failed" ? "本次配乐没有完成" : music.status === "stale" ? "旧配乐仍保留，提示词已变化" : "确认提示词后明确生成"}</strong><small>{music.error || "这里会显示本地音频播放器；不会自动进入最终合成。"}</small></div>}
      </section>
    </div> : <div className={`rough-cut-canvas-placeholder music-prompt-empty-state ${prompt.status}`}>{prompt.status === "running" ? <MusicThinkingWave /> : <span>♪</span>}<strong>{prompt.status === "running" ? "文字Agent正在设计配乐方案" : prompt.status === "failed" ? "本轮没有取得可编辑草稿" : "等待生成配乐方案"}</strong><small>{prompt.error || "可重新生成配乐方案，也可先建立本地草稿后手动编辑。"}</small>{prompt.status !== "running" && <div className="music-prompt-recovery-actions canvas"><button className="primary-button" onClick={onGeneratePrompt}>{prompt.status === "failed" ? "重新生成配乐方案" : "生成配乐方案"}</button><button className="secondary-button" onClick={() => onUpdatePrompt("")}>建立本地可编辑草稿</button></div>}</div>}
  </NodeCard>;
}

function FinalCompositionNode({ position, onPointerDown, state }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; state: PostProductionState }) {
  const final = state.finalComposition;
  const statusLabel = final.status === "complete" ? "待人工验收" : final.status === "running" ? "正在本机合成" : final.status === "failed" ? "合成失败" : "旧成片需更新";
  return <NodeCard nodeId="final-composition-stage" position={position} onPointerDown={onPointerDown} className={`final-composition-canvas-node ${final.status}`} badge="11 · 最终成片" title="整集最终成片" status={statusLabel}>
    {final.status === "complete" && final.mediaUrl ? <>
      <div className="final-composition-canvas-player"><video controls preload="metadata" src={final.mediaUrl} aria-label="最终成片播放器" /></div>
      <div className="final-composition-canvas-meta"><div><strong>{final.filename}</strong><span>{final.durationSec?.toFixed(2)}秒 · {final.width}×{final.height} · {final.fps || "24fps"} · {final.subtitleCount || 0}条字幕 · {final.audioMode === "native_with_music" ? "原声 + 配乐" : final.audioMode === "music_only" ? "仅配乐" : "保留原声"}</span></div><a href={final.mediaUrl} download={final.filename}>下载最终成片</a><small>请完整播放检查对白与配乐平衡、字幕时序、镜头衔接和片尾字。技术解码通过不等于人工内容验收。</small></div>
    </> : <div className={`final-composition-canvas-placeholder ${final.status}`}><span>{final.status === "running" ? "◌" : final.status === "failed" ? "!" : "↻"}</span><strong>{final.status === "running" ? "正在本机混音、烧录字幕并校验" : final.status === "failed" ? "最终成片没有完成" : "上游内容已变化，旧成片仍保留"}</strong><small>{final.error || "完成后将在这里显示大尺寸播放器。"}</small></div>}
  </NodeCard>;
}

function H3ControlNode({ position, onPointerDown, connection, settings, tasks, approval, segmentCount, onRefresh, onStart, onSettings, onApprove }: { position: CanvasPoint; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; connection: H3Connection; settings: H3GenerationSettings; tasks: ShotVideoTask[]; approval: ScriptApproval; segmentCount: number; onRefresh: () => void; onStart: () => void; onSettings: (patch: Partial<H3GenerationSettings>) => void; onApprove: () => void }) {
  const cloud = usesCloudVideo(settings);
  const readyCount = tasks.filter((task) => task.status === "awaiting_review").length;
  const activeCount = tasks.filter((task) => ["submitting", "queued", "running"].includes(task.status)).length;
  const waitingCount = tasks.filter((task) => task.status === "waiting_dependency").length;
  const connectionLabel = connection.status === "online" ? "已连接" : connection.status === "checking" ? "检查中" : connection.status === "starting" ? "启动中" : connection.status === "offline" ? "未连接" : "尚未检查";
  function selectQuality(value: H3GenerationSettings["qualityPreset"]) {
    if (value === "standard") onSettings({ qualityPreset: value, inferenceSteps: 20, accelerationModel: "none", spectrum: true });
    else if (value === "balanced") onSettings({ qualityPreset: value, inferenceSteps: 10, accelerationModel: "none", spectrum: true });
    else if (value === "fast") onSettings({ qualityPreset: value, inferenceSteps: 6, accelerationModel: "turbo4", spectrum: false });
    else onSettings({ qualityPreset: value });
  }
  return <NodeCard nodeId="local-video-stage" position={position} onPointerDown={onPointerDown} className="asset-node local-video-stage-node" badge="08 · 视频生成" title={videoEngineLabel(settings.engine)} status={cloud ? '在线生成' : connectionLabel}>
    <VideoEngineControls settings={settings} onChange={onSettings} />
    {!cloud && <>
    <div className={`h3-connection ${connection.status}`}><span className="h3-status-dot" /><div><strong>{connectionLabel}</strong><small>{connection.health?.message || connection.error || "先启动或检查PRISM H3；这两个操作都不会提交视频。"}</small></div></div>
    <div className="h3-connection-actions"><button onClick={onStart} disabled={connection.status === "starting"}>启动并连接</button><button onClick={onRefresh} disabled={connection.status === "checking"}>重新检查</button></div>
    <div className="h3-settings-grid">
      <label>生成模式<select value={settings.mode} onChange={(event) => onSettings({ mode: event.target.value as H3GenerationSettings["mode"] })}><option value="reference">全能参考</option><option value="text">文生视频</option></select></label>
      <label>画质预设<select value={settings.qualityPreset} onChange={(event) => selectQuality(event.target.value as H3GenerationSettings["qualityPreset"])}><option value="standard">标准 · 20步</option><option value="balanced">均衡 · 10步</option><option value="fast">极速 · Turbo 6步</option><option value="custom">自定义</option></select></label>
      <label>分辨率<select value={settings.resolution} onChange={(event) => onSettings({ resolution: event.target.value as H3GenerationSettings["resolution"] })}><option value="480p">480P · 稳妥起步</option><option value="720p">720P</option><option value="1080p">1080P</option></select></label>
      <label>固定种子<input type="number" min="0" max="2147483647" value={settings.seed} disabled={settings.randomSeed} onChange={(event) => onSettings({ seed: Number(event.target.value) })} /></label>
      {settings.qualityPreset === "custom" && <><label>采样步数<input type="number" min="4" max="30" value={settings.inferenceSteps} onChange={(event) => onSettings({ inferenceSteps: Number(event.target.value) })} /></label><label>加速模型<select value={settings.accelerationModel} onChange={(event) => onSettings({ accelerationModel: event.target.value as H3GenerationSettings["accelerationModel"] })}><option value="none">不加速</option><option value="turbo4">Turbo</option><option value="lightx2v-544p-v1">LightX2V 544P</option><option value="lightx2v-768p-v1">LightX2V 768P</option></select></label></>}
    </div>
    <div className="h3-switch-row">
      <label className="h3-switch h3-toggle"><input type="checkbox" checked={settings.randomSeed} onChange={(event) => onSettings({ randomSeed: event.target.checked })} /><span aria-hidden="true"><i /></span><strong>随机种子</strong></label>
      <label className="h3-switch"><input type="checkbox" checked={settings.sage} onChange={(event) => onSettings({ sage: event.target.checked })} /> SageAttention</label>
    </div>
    {settings.mode === "reference" && <p className="h3-safety-note">整张宫格作为镜头顺序与构图参考，与本段人物、场景、道具图一起交给H3。生成或修复视频提示词时，文字Agent会读取当前宫格；已有提示词可通过修复重新对齐画面。</p>}
    </>}
    <div className="h3-stage-summary"><span>{readyCount}/{segmentCount} 待人工验收</span><span>{activeCount} 个视频任务</span><span>{waitingCount} 个等待前段</span></div>
    <CanvasProgressEffect completed={readyCount} total={segmentCount} active={activeCount > 0 || waitingCount > 0} />
    {readyCount === segmentCount && segmentCount > 0 && approval !== "approved" && <button className="h3-approve-button" onClick={onApprove}>人工确认全部镜头视频</button>}
    {approval === "approved" && <div className="h3-approved"><ConfirmedIndicator label="全部镜头视频已人工确认" /></div>}
  </NodeCard>;
}

function integratedStoryboardStatus({ board, boardStatus, storyboardAssetsApproval, videoPrompt, videoPromptsApproval, videoTask, shotVideosApproval }: { board?: StoryboardBoardResult; boardStatus: SceneStageStatus; storyboardAssetsApproval: ScriptApproval; videoPrompt?: VideoPromptResult; videoPromptsApproval: ScriptApproval; videoTask?: ShotVideoTask; shotVideosApproval: ScriptApproval }) {
  if (shotVideosApproval === "approved" && videoTask?.status === "awaiting_review") return "镜头视频已确认";
  if (videoTask?.status === "waiting_dependency") return "已排队 · 等待前段";
  if (videoTask?.status === "submitting") return "正在提交视频";
  if (videoTask?.status === "queued") return "视频队列等待";
  if (videoTask?.status === "running") return "视频正在生成";
  if (videoTask?.status === "awaiting_review") return "视频结果待验收";
  if (videoTask?.status === "failed") return "视频生成失败";
  if (videoTask?.status === "cancelled") return "视频任务已取消";
  if (videoPromptsApproval === "approved") return "提示词已确认 · 可生成";
  if (videoPrompt?.status === "running") return "视频提示词生成中";
  if (videoPrompt?.status === "complete") return videoPrompt.approval === "approved" && !videoPrompt.stale ? "视频提示词已确认" : "视频提示词草稿待确认";
  if (videoPrompt?.status === "needs_revision") return "视频提示词草稿需修改";
  if (videoPrompt?.status === "failed") return "视频提示词未完成";
  if (videoPrompt?.status === "stale") return "视频提示词已过期";
  if (storyboardAssetsApproval === "approved") return "分镜已确认 · 等待视频提示词";
  if (board?.videoUrl) return "图片 / 视频可切换";
  if (board?.status === "complete") return "故事板已生成";
  if (board?.status === "needs_selection") return "待选择候选图";
  if (board?.status === "failed") return "图片未完成";
  if (board?.status === "idle") return "故事板图片可选";
  if (board?.status === "running") return board.queueState === "queued" ? "故事板已进入队列" : "故事板生成中";
  return boardStatus === "running" ? "正在准备画格规划" : "文字分镜待确认";
}

function StoryboardCardCopy({ segment }: { segment: StoryboardSegment }) {
  return <div className="storyboard-card-copy"><div><span>{segment.durationSec}秒</span><span>{(segment.sceneKeys?.length ? segment.sceneKeys : [segment.sceneKey]).join("→")}</span><span>{segment.characters.length ? segment.characters.join("、") : "无人物"}</span></div><p>{humanReadableStoryboardText(segment.storyboardText)}</p><small>转场：{segment.transition}</small></div>;
}

function StoryboardMediaPanel({ segment, segments, tasks, continuityMode, onContinuityMode, board, boardStatus, storyboardPrompt, videoWorkspaceEnabled, videoPrompt, videoPromptStatus, videoPromptsApproval, videoTask, connection, settings, onViewImage, onSelectCandidate, onOpenStoryboardText, onEditStoryboardPrompt, onRegenerateStoryboard, onEditVideoPrompt, onRegenerateVideoPrompt, onRepairVideoPrompt, onSubmitShotVideo, onCancelShotVideo }: { segment: StoryboardSegment; segments: StoryboardSegment[]; tasks: ShotVideoTask[]; continuityMode: ShotContinuityMode; onContinuityMode: (segmentKey: string, mode: ShotContinuityMode) => void; board: StoryboardBoardResult; boardStatus: SceneStageStatus; storyboardPrompt?: StoryboardBoardPrompt; videoWorkspaceEnabled: boolean; videoPrompt?: VideoPromptResult; videoPromptStatus: SceneStageStatus; videoPromptsApproval: ScriptApproval; videoTask?: ShotVideoTask; connection: H3Connection; settings: H3GenerationSettings; onViewImage: (src: string, title: string) => void; onSelectCandidate: (segmentKey: string, imageUrl: string) => void; onOpenStoryboardText: (segmentKey: string) => void; onEditStoryboardPrompt: (segmentKey: string) => void; onRegenerateStoryboard: (segmentKey: string) => void; onEditVideoPrompt: (segmentKey: string) => void; onRegenerateVideoPrompt: (segmentKey: string) => void; onRepairVideoPrompt: (segmentKey: string) => void; onSubmitShotVideo: (segmentKey: string) => void; onCancelShotVideo: (segmentKey: string) => void }) {
  const hasImage = Boolean(board.imageUrl);
  const hasVideoWorkspace = videoWorkspaceEnabled || Boolean(board.videoUrl || videoPrompt || videoTask);
  const isQueued = board.status === "running" && board.queueState === "queued";
  const isRunning = board.status === "running" && !isQueued;
  const hasCandidates = board.status === "needs_selection" && Boolean(board.imageUrls?.length);
  const imageState = isQueued ? "queued" : isRunning ? "generating" : hasCandidates ? "selection" : hasImage ? "ready" : board.status === "failed" ? "failed" : "idle";
  const panelCount = normalizeStoryboardBoardPanelCount(storyboardPrompt?.panelCount, 6);
  const boardLabel = storyboardBoardLabel(panelCount);
  const [mediaType, setMediaType] = useState<"image" | "video">(hasImage ? "image" : hasVideoWorkspace ? "video" : "image");

  useEffect(() => {
    if (mediaType === "video" && !hasVideoWorkspace) setMediaType("image");
    if (mediaType === "image" && !hasImage && hasVideoWorkspace) setMediaType("video");
  }, [hasImage, hasVideoWorkspace, mediaType]);

  useEffect(() => {
    if (videoPrompt?.status === "running" && hasVideoWorkspace) setMediaType("video");
    if (videoTask?.status === "awaiting_review" && hasVideoWorkspace) setMediaType("video");
  }, [hasVideoWorkspace, videoPrompt?.status, videoTask?.status]);

  return <div className={`storyboard-media-panel state-${imageState} ${hasVideoWorkspace ? "integrated" : ""}`} data-generation-state={imageState}>
    {(hasImage || hasVideoWorkspace) && <div className={`storyboard-media-tabs showing-${mediaType}`} role="tablist" aria-label={`${segment.title}媒体类型`}>
      <button type="button" role="tab" aria-selected={mediaType === "image"} className={mediaType === "image" ? "active" : ""} disabled={!hasImage} title={hasImage ? `查看${boardLabel}图片` : `${boardLabel}图片尚未生成`} onClick={() => setMediaType("image")}><span aria-hidden="true">▧</span><small>图片</small></button>
      <button type="button" role="tab" aria-selected={mediaType === "video"} className={mediaType === "video" ? "active" : ""} disabled={!hasVideoWorkspace} title={hasVideoWorkspace ? "切换到提示词与镜头视频" : "分镜确认后启用"} onClick={() => setMediaType("video")}><span aria-hidden="true">▶</span><small>视频</small></button>
    </div>}
    <div className={`storyboard-media-page storyboard-media-page-${mediaType}`}>
      {mediaType === "video" && hasVideoWorkspace ? <StoryboardVideoWorkspace segment={segment} segments={segments} tasks={tasks} continuityMode={continuityMode} onContinuityMode={onContinuityMode} board={board} prompt={videoPrompt} promptStatus={videoPromptStatus} promptsApproval={isReadyVideoPrompt(videoPrompt) && videoPrompt?.approval === "approved" ? "approved" : videoPromptsApproval} task={videoTask} connection={connection} settings={settings} onEditPrompt={onEditVideoPrompt} onRegeneratePrompt={onRegenerateVideoPrompt} onRepairPrompt={onRepairVideoPrompt} onSubmit={onSubmitShotVideo} onCancel={onCancelShotVideo} /> : <div className="storyboard-image-workspace">
      {hasImage || hasCandidates || isRunning || isQueued ? <div className={`storyboard-board-frame ${imageState}`} aria-live="polite">
        {board.imageUrl ? <button className="image-preview-button" onClick={() => onViewImage(board.imageUrl!, `${segment.segmentKey} · ${segment.title} · ${boardLabel}`)}><img src={board.imageUrl} alt={`${segment.title}${boardLabel}分镜图`} /><span>查看大图</span></button> : hasCandidates ? <><small>{board.error || "上游返回了多张候选图，请手动选择。"}</small><div className="storyboard-candidates">{board.imageUrls!.map((url, index) => <article key={url}><button className="image-preview-button" onClick={() => onViewImage(url, `${segment.segmentKey} · ${boardLabel}候选${index + 1}`)}><img src={url} alt={`${segment.title}${boardLabel}候选${index + 1}`} /><span>查看大图</span></button><button onClick={() => onSelectCandidate(segment.segmentKey, url)}>选择候选{index + 1}</button></article>)}</div></> : isQueued ? <><div className="storyboard-generation-visual queued" aria-hidden="true"><div className="storyboard-generation-grid" data-panel-count={panelCount}>{Array.from({ length: panelCount }, (_, index) => <i key={index}><span /></i>)}</div></div><strong>已加入{boardLabel}队列</strong><small>当前最多并行3张，轮到本段后自动开始</small></> : <><div className="storyboard-generation-visual" aria-hidden="true"><div className="storyboard-generation-grid" data-panel-count={panelCount}>{Array.from({ length: panelCount }, (_, index) => <i key={index}><span /></i>)}<em /></div><div className="storyboard-generation-track"><i /></div></div><strong>正在生成{boardLabel}</strong><small>逐格构图 · 校对人物、场景与动作连续性</small></>}
      </div> : board.status === "idle" ? <div className="storyboard-media-optional"><div><strong>{boardLabel}图片可选</strong><small>文字分镜与结构化{panelCount}格规划已经保留，可直接继续或按需生成本段图片。</small></div></div> : <div className="storyboard-media-error"><span>!</span><div><strong>{boardLabel}图片未完成</strong><small>{board.error || "本次结果未完成，系统不会自动重试。"}</small></div></div>}
      <StoryboardCardCopy segment={segment} />
      {storyboardPrompt && <div className="storyboard-node-actions storyboard-review-actions"><button type="button" onClick={() => onOpenStoryboardText(segment.segmentKey)}>查看 / 编辑分镜设定</button><button disabled={isRunning || isQueued} onClick={() => onEditStoryboardPrompt(segment.segmentKey)}>查看 / 编辑图片提示词</button><button className="storyboard-regenerate-action" disabled={isRunning || isQueued} onClick={() => onRegenerateStoryboard(segment.segmentKey)}>{isQueued ? "队列等待中" : isRunning ? `正在生成${boardLabel}` : board.status === "idle" ? `生成${boardLabel}` : `重新生成${boardLabel}`}</button></div>}
      </div>}
    </div>
  </div>;
}

function StoryboardVideoWorkspace({ segment, segments, tasks, continuityMode, onContinuityMode, board, prompt, promptStatus, promptsApproval, task, connection, settings, onEditPrompt, onRegeneratePrompt, onRepairPrompt, onSubmit, onCancel }: { segment: StoryboardSegment; segments: StoryboardSegment[]; tasks: ShotVideoTask[]; continuityMode: ShotContinuityMode; onContinuityMode: (segmentKey: string, mode: ShotContinuityMode) => void; board: StoryboardBoardResult; prompt?: VideoPromptResult; promptStatus: SceneStageStatus; promptsApproval: ScriptApproval; task?: ShotVideoTask; connection: H3Connection; settings: H3GenerationSettings; onEditPrompt: (segmentKey: string) => void; onRegeneratePrompt: (segmentKey: string) => void; onRepairPrompt: (segmentKey: string) => void; onSubmit: (segmentKey: string) => void; onCancel: (segmentKey: string) => void }) {
  const cloud = usesCloudVideo(settings);
  const taskIsCloud = task?.externalTaskId?.startsWith('cv-');
  const engineLabel = videoEngineLabel(String(task?.parameters?.videoEngine || settings.engine || 'local'));
  const active = Boolean(task && ["waiting_dependency", "submitting", "queued", "running"].includes(task.status));
  const taskStatus = !task ? "尚未提交视频" : task.status === "waiting_dependency" ? "等待前段完成" : task.status === "submitting" ? "正在提交" : task.status === "queued" ? "队列等待" : task.status === "running" ? "正在生成" : task.status === "awaiting_review" ? "结果待验收" : task.status === "failed" ? "生成失败" : "已取消";
  const taskMediaUrl = task?.status === "awaiting_review" && task.externalTaskId ? `/api/h3/media/${encodeURIComponent(task.externalTaskId)}` : !task && board.videoUrl ? board.videoUrl : "";
  const outputName = task?.outputPaths?.[0]?.split(/[\\/]/u).pop();
  const hasPrompt = Boolean(prompt?.prompt.trim());
  const promptGenerating = prompt?.status === "running" || (!prompt && promptStatus === "running");
  const h3Generating = Boolean(task && ["submitting", "queued", "running"].includes(task.status));
  const h3GeneratingDetail = task?.status === "submitting" ? `正在提交到${engineLabel}` : task?.status === "queued" ? "任务已进入生成队列" : "正在逐帧生成镜头，完成后会在这里直接显示视频";
  const promptState = promptsApproval === "approved" ? "提示词已确认" : prompt?.status === "running" ? hasPrompt ? `正在修复 ${segment.segmentKey}` : `正在生成 ${segment.segmentKey}` : prompt?.status === "complete" ? prompt.repairAttempted ? "AI逐段审校通过 · 待确认" : "提示词已生成 · 待确认" : prompt?.status === "needs_revision" ? prompt.repairAttempted ? "AI逐段审校后仍需修改" : "Agent草稿已返回 · 需修改" : prompt?.status === "failed" ? "提示词未完成" : prompt?.status === "stale" ? "提示词已过期" : "尚无视频提示词";
  const segmentIndex = segments.findIndex((item) => item.segmentKey === segment.segmentKey);
  const sourceSegment = segmentIndex > 0 ? segments[segmentIndex - 1] : undefined;
  const sourceTask = sourceSegment ? tasks.find((candidate) => candidate.segmentKey === sourceSegment.segmentKey) : undefined;
  const sourceContinuity = sourceTask?.parameters?.continuity as { engine?: string; chainId?: string } | undefined;
  const waitsForDependency = !cloud && continuityMode === "continue" && !(sourceTask?.status === "awaiting_review" && sourceContinuity?.engine === "herrgotts" && sourceContinuity.chainId);
  return <div className="storyboard-video-workspace">
    <div className="storyboard-video-toolbar"><div className="shot-video-meta"><span>{engineLabel}</span><span>{Number(task?.parameters?.durationSec || segment.durationSec)}秒</span><span>{(task?.parameters?.mode || settings.mode) === "reference" ? "多图参考" : "文生视频"}</span><span>{String(task?.parameters?.resolution || (cloud ? settings.cloudResolution : settings.resolution) || "").toUpperCase()}</span></div><small className={`video-prompt-state ${prompt?.status || "idle"}`}>{promptState}</small></div>
    {promptGenerating && <div className="video-prompt-running-banner" role="status" aria-live="polite"><span aria-hidden="true"><i /><i /><i /></span><div><strong>{hasPrompt ? `正在修复 ${segment.segmentKey} 视频提示词` : `正在生成 ${segment.segmentKey} 视频提示词`}</strong><small>Agent 只处理这一段，当前视频和草稿继续保留</small></div></div>}
    {!cloud && <ShotContinuityControl segment={segment} index={segmentIndex} segments={segments} tasks={tasks} mode={continuityMode} disabled={active} onChange={onContinuityMode} />}
    {taskMediaUrl ? <div className="storyboard-video-frame"><video src={taskMediaUrl} controls preload="metadata" aria-label={`${segment.title}镜头视频`} /><small>{outputName || task?.externalTaskId || "已生成视频"}</small></div> : promptGenerating ? <div className="video-prompt-generation" role="status" aria-label={`${segment.title}视频提示词正在生成`}><div className="video-prompt-generation-sheet" aria-hidden="true"><i /><i /><i /><i /><span /></div><strong>{hasPrompt ? "正在修复本段视频提示词" : "正在生成本段视频提示词"}</strong><small>{hasPrompt ? "当前草稿和具体问题已保留" : "本次生成内完成自检；返回后可查看、编辑或局部修改"}</small></div> : prompt?.status === "failed" ? <div className="shot-video-placeholder failed"><span>!</span><strong>没有取得可读取草稿</strong><small>{prompt.error || "可单独重新生成本段，成功分段不会重提。"}</small></div> : hasPrompt && promptsApproval !== "approved" ? <div className="video-prompt-ready"><span>✓</span><strong>{prompt?.status === "needs_revision" ? "视频提示词草稿已保留" : prompt?.repairAttempted ? "提示词已通过逐段AI审校" : "视频提示词已生成"}</strong><small>{prompt?.status === "needs_revision" ? "可在下方查看问题、编辑或让 Agent 只修复本段" : "可随时查看和编辑本段提示词"}</small></div> : h3Generating ? <div className={`shot-video-generating ${task?.status || "running"}`} role="status" aria-live="polite" aria-label={`${segment.title}${taskStatus}`}><div className="shot-video-generation-visual" aria-hidden="true"><div className="shot-video-generation-stage">{Array.from({ length: 3 }, (_, index) => <i key={index}><span /></i>)}<b /></div><div className="shot-video-generation-timeline"><span>00:00</span><i><b /></i><span>{segment.durationSec}秒</span></div></div><strong>{taskStatus}</strong><small>{h3GeneratingDetail}</small>{task?.externalTaskId && <small className="shot-video-task-id">任务 {task.externalTaskId}</small>}</div> : <div className={`shot-video-placeholder ${task?.status || "idle"}`}><span>{active ? "◌" : task?.status === "failed" ? "!" : "◇"}</span><strong>{taskStatus}</strong><small>{task?.status === "waiting_dependency" ? `已保存续接请求；${task.submissionIntent?.sourceSegmentKey || "前一段"}成功返回后自动提交给H3` : task?.externalTaskId ? `任务 ${task.externalTaskId}` : promptsApproval === "approved" ? `点击下方按钮后提交到${engineLabel}` : "先生成并确认本段视频提示词"}</small></div>}
    {prompt?.status === "needs_revision" && <div className="video-prompt-card-issues" role="alert"><strong>{prompt.validationIssues?.length || 1} 项需要处理</strong><small>{(prompt.validationIssues?.length ? prompt.validationIssues : [prompt.error || "本段提示词需要处理。"]).slice(0, 2).join("；")}{(prompt.validationIssues?.length || 0) > 2 ? `；另有 ${(prompt.validationIssues?.length || 0) - 2} 项` : ""}</small>{prompt.error && <details><summary>查看上次处理详情</summary><p>{prompt.error}</p></details>}</div>}
    {!!prompt?.validationWarnings?.length && <StageFeedback messages={prompt.validationWarnings} />}
    {task?.stale && <p className="muted">人物参考已更新，请复核本段已有视频。</p>}
    {taskIsCloud && task?.externalTaskId && <CloudVideoTaskActions taskId={task.externalTaskId} phase={task.parameters?.phase} />}
    {task?.error && <p className="shot-video-error">{task.error}</p>}
    <div className="storyboard-video-primary-actions">
      <button disabled={promptGenerating && !hasPrompt} onClick={() => hasPrompt ? onEditPrompt(segment.segmentKey) : onRegeneratePrompt(segment.segmentKey)}>{hasPrompt ? "查看 / 编辑视频提示词" : promptGenerating ? "正在生成本段提示词" : prompt?.status === "failed" ? "重新生成本段视频提示词" : "生成本段视频提示词"}</button>
      {prompt?.status === "needs_revision" && <button className="video-prompt-card-repair" disabled={promptGenerating} onClick={() => onRepairPrompt(segment.segmentKey)}>让 Agent 修复本段</button>}
      {promptsApproval === "approved" && (task?.status === "waiting_dependency" ? <button onClick={() => onCancel(segment.segmentKey)}>取消等待续接</button> : active && task?.externalTaskId && !taskIsCloud ? <button onClick={() => onCancel(segment.segmentKey)}>取消这个H3任务</button> : active ? <button disabled>{taskIsCloud ? "正在跟踪云端任务" : "正在提交本镜头"}</button> : <button disabled={!cloud && !waitsForDependency && connection.status !== "online"} onClick={() => onSubmit(segment.segmentKey)}>{waitsForDependency ? "加入续接队列 · 暂不调用H3" : task?.status === "failed" || task?.status === "cancelled" ? `重新提交本镜头 · ${videoEngineLabel(settings.engine)}` : task?.status === "awaiting_review" || taskMediaUrl ? `重新生成本镜头 · ${videoEngineLabel(settings.engine)}` : `生成本镜头 · ${videoEngineLabel(settings.engine)}`}</button>)}
    </div>
  </div>;
}

function connectionPath(from: CanvasPoint, to: CanvasPoint, fromWidth: number) {
  const startX = from.x + fromWidth;
  const startY = from.y + 96;
  const endX = to.x;
  const endY = to.y + 96;
  const control = Math.max(80, Math.abs(endX - startX) * 0.48);
  return `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`;
}

const ZOOM_STEPS = [0.2, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.8] as const;

function stepZoom(current: number, direction: 1 | -1) {
  if (direction > 0) return ZOOM_STEPS.find((value) => value > current + 0.001) ?? 1.8;
  return [...ZOOM_STEPS].reverse().find((value) => value < current - 0.001) ?? 0.2;
}

function semanticZoomClass(zoom: number) {
  if (zoom >= 1.25) return "zoom-detail";
  if (zoom <= 0.5) return "zoom-overview";
  return "zoom-normal";
}

function SeriesPlanModal({ script, brief, onClose }: { script: IdeaScript; brief: Brief; onClose: () => void }) {
  return <div className="script-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="script-modal" role="dialog" aria-modal="true" aria-label="系列规划">
      <header><div><span>系列母板 · 与分集脚本独立</span><h2>《{script.title}》系列规划</h2></div><button onClick={onClose} aria-label="关闭系列规划">×</button></header>
      <div className="script-modal-meta"><span>{creativeDirectionLabel(brief.creativeDirection)} · {script.plannedEpisodeCount || brief.episodeCount}</span><span>每集{script.durationSec}秒</span><span>{script.ratio}</span><span>{script.language}</span><span>{script.emotion}</span></div>
      <p className="script-logline"><strong>系列梗概：</strong>{script.logline}</p>
      <article className="script-document">
        <h3>系列出镜主体规划</h3>
        {script.characters.map((character) => <p key={character.name}><strong>{character.name}（{character.role}）：</strong>{character.goal}</p>)}
        <h3>逐集规划</h3>
        {(script.seriesPlan || []).map((episode) => <p key={episode.episodeNumber}><strong>第{episode.episodeNumber}集《{episode.title}》：</strong>{episode.summary}<br /><em>结尾收束：{episode.hook}</em></p>)}
      </article>
    </section>
  </div>;
}

function ScriptDetailsModal({ script, projectName, onProjectName, brief, scriptApproval, episodeNumber, onClose }: { script: IdeaScript; projectName: string; onProjectName: (value: string) => void; brief: Brief; scriptApproval: ScriptApproval; episodeNumber: number; onClose: () => void }) {
  return <div className="script-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="script-modal" role="dialog" aria-modal="true" aria-label="完整剧本">
      <header><div><span>分集剧本 · {scriptApproval === "approved" ? "已确认" : "草稿待确认"}</span><div className="script-modal-project-title">{brief.workType === "series" && <b>第{episodeNumber}集</b>}<EditableProjectName value={projectName} onCommit={onProjectName} /></div></div><button onClick={onClose} aria-label="关闭剧本详情">×</button></header>
      <div className="script-modal-meta"><span>{brief.workType === "single" ? `${workTypeLabel(brief.workType)} · ${creativeDirectionLabel(brief.creativeDirection)}` : `EP${String(episodeNumber).padStart(3, "0")} · 第${episodeNumber}集`}</span><span>{script.durationSec}秒</span><span>{script.ratio}</span><span>{script.language}</span><span>{script.emotion}</span></div>
      <p className="script-logline"><strong>{brief.workType === "series" ? "本集梗概：" : brief.creativeDirection === "story" ? "剧情梗概：" : "内容梗概："}</strong>{script.logline}</p>
      <article className="script-document">
        <h3>{brief.workType === "series" ? `第${episodeNumber}集正式剧本` : "正式剧本"}</h3>
        {script.scenes.map((scene, index) => <SceneScreenplay key={scene.id} scene={scene} index={index} />)}
        <section className="ending-hook"><b>结尾钩子</b><p>{script.endingHook}</p></section>
      </article>
    </section>
  </div>;
}

function CharacterProfileModal({ profile, onChange, onClose, onSave }: { profile: CharacterProfile; onChange: (patch: Partial<CharacterProfile>) => void; onClose: () => void; onSave: () => void }) {
  const lines = (value: string) => value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal character-profile-modal" role="dialog" aria-modal="true" aria-label="人物设定">
      <header><div><span>人物设定 · 可编辑</span><h2>{profile.profileKey} · {profile.name}</h2></div><button onClick={onClose} aria-label="关闭人物设定">×</button></header>
      <p>这里是人物本身的稳定设定。年龄、外貌、体态和服装应先在这里明确，再单独检查角色图片提示词。</p>
      <div className="character-profile-fields">
        <label><span>身份</span><input value={profile.identity} onChange={(event) => onChange({ identity: event.target.value })} /></label>
        <label><span>剧情定位</span><input value={profile.storyRole} onChange={(event) => onChange({ storyRole: event.target.value })} /></label>
        <label className="wide"><span>人物简介</span><textarea value={profile.introduction} onChange={(event) => onChange({ introduction: event.target.value })} /></label>
        <label><span>性格特点 · 每行一项</span><textarea value={profile.personality.join("\n")} onChange={(event) => onChange({ personality: lines(event.target.value) })} /></label>
        <label><span>核心动机</span><textarea value={profile.motivation} onChange={(event) => onChange({ motivation: event.target.value })} /></label>
        <label><span>年龄、外貌与体态 · 每行一项</span><textarea value={profile.physicalKnownFacts.join("\n")} onChange={(event) => onChange({ physicalKnownFacts: lines(event.target.value) })} /></label>
        <label><span>服装与配饰 · 每行一项</span><textarea value={profile.wardrobeKnownFacts.join("\n")} onChange={(event) => onChange({ wardrobeKnownFacts: lines(event.target.value) })} /></label>
        <label className="wide"><span>仍需确认的人设问题 · 每行一项</span><textarea value={profile.designOpenQuestions.join("\n")} onChange={(event) => onChange({ designOpenQuestions: lines(event.target.value) })} /></label>
      </div>
      <div className="prompt-modal-actions prompt-editor-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!profile.introduction.trim() || !profile.identity.trim()} onClick={onSave}>保存人物设定</button></div>
      <small>保存后人物设定会回到待确认状态，现有角色图片继续保留。</small>
    </section>
  </div>;
}

function CharacterPromptModal({ profile, value, busy, onChange, onClose, onSave, onRegenerate }: { profile?: CharacterProfile; value: string; busy: boolean; onChange: (value: string) => void; onClose: () => void; onSave: () => void; onRegenerate: () => void }) {
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal" role="dialog" aria-modal="true" aria-label="角色图片提示词">
      <header><div><span>角色图片提示词 · 可编辑</span><h2>{profile?.name || "角色"}</h2></div><button onClick={onClose} aria-label="关闭提示词编辑">×</button></header>
      <p>修改会保存在当前本机项目中；旧图会继续保留，直到你明确点击重新生成。直接使用原提示词也可以再次生成。</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${profile?.name || "角色"}图片提示词`} />
      <div className="prompt-modal-actions prompt-editor-actions"><button className="secondary-button" disabled={!value.trim() || busy} onClick={onSave}>仅保存提示词</button><button className="primary-button" disabled={!value.trim() || busy} onClick={onRegenerate}>{busy ? "正在生成……" : "使用当前提示词重新生成图片"}</button></div>
      <small>当前图片会保留到新图片生成成功；失败后不会自动重试。</small>
    </section>
  </div>;
}

function ScenePromptModal({ proposal, value, busy, onChange, onClose, onSave, onRegenerate }: { proposal?: SceneVisualProposal; value: string; busy: boolean; onChange: (value: string) => void; onClose: () => void; onSave: () => void; onRegenerate: () => void }) {
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal" role="dialog" aria-modal="true" aria-label="场景图片提示词">
      <header><div><span>场景主图提示词 · 可编辑</span><h2>{proposal?.name || "场景"}</h2></div><button onClick={onClose} aria-label="关闭场景提示词编辑">×</button></header>
      <p>修改只保存在当前本机项目中。当前图片会保留到新图片生成成功。</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${proposal?.name || "场景"}图片提示词`} />
      <div className="prompt-modal-actions prompt-editor-actions"><button className="secondary-button" disabled={!value.trim() || busy} onClick={onSave}>仅保存提示词</button><button className="primary-button" disabled={!value.trim() || busy} onClick={onRegenerate}>{busy ? "正在生成……" : "使用当前提示词重新生成图片"}</button></div>
      <small>主图发生变化后，已确认状态和旧多角度图会失效但不会删除，需要重新确认主图。</small>
    </section>
  </div>;
}

function PropPromptModal({ proposal, value, busy, onChange, onClose, onSave, onRegenerate }: { proposal?: PropVisualProposal; value: string; busy: boolean; onChange: (value: string) => void; onClose: () => void; onSave: () => void; onRegenerate: () => void }) {
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal" role="dialog" aria-modal="true" aria-label="道具图片提示词">
      <header><div><span>道具主图提示词 · 可编辑</span><h2>{proposal?.name || "道具"}</h2></div><button onClick={onClose} aria-label="关闭道具提示词编辑">×</button></header>
      <p>修改只保存在当前本机项目中。当前图片会保留到新图片生成成功。</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${proposal?.name || "道具"}图片提示词`} />
      <div className="prompt-modal-actions prompt-editor-actions"><button className="secondary-button" disabled={!value.trim() || busy} onClick={onSave}>仅保存提示词</button><button className="primary-button" disabled={!value.trim() || busy} onClick={onRegenerate}>{busy ? "正在生成……" : "使用当前提示词重新生成图片"}</button></div>
      <small>重新生成不会再次调用文字Agent；图片成功返回后需要重新确认道具资产，失败不会自动重试。</small>
    </section>
  </div>;
}

function StoryboardTextModal({ segment, value, onChange, onClose, onSave }: { segment?: StoryboardSegment; value: string; onChange: (value: string) => void; onClose: () => void; onSave: () => void }) {
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal" role="dialog" aria-modal="true" aria-label="文字分镜">
      <header><div><span>文字分镜 · 可编辑</span><h2>{segment ? `${segment.segmentKey} · ${segment.title}` : "分镜"}</h2></div><button onClick={onClose} aria-label="关闭文字分镜编辑">×</button></header>
      <p>保存只更新当前项目中的这一段文字分镜，并将相关图片与视频提示词恢复为待确认状态。</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${segment?.title || "分镜"}文字分镜`} />
      <div className="prompt-modal-actions prompt-editor-actions"><button className="primary-button" disabled={!value.trim()} onClick={onSave}>保存文字分镜</button></div>
    </section>
  </div>;
}

function StoryboardPromptModal({ segment, value, busy, onChange, onClose, onSave, onRegenerate }: { segment?: StoryboardSegment; value: string; busy: boolean; onChange: (value: string) => void; onClose: () => void; onSave: () => void; onRegenerate: () => void }) {
  return <div className="script-modal-backdrop prompt-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal" role="dialog" aria-modal="true" aria-label="故事板图片提示词">
      <header><div><span>故事板图片提示词 · 可编辑</span><h2>{segment ? `${segment.segmentKey} · ${segment.title}` : "分镜"}</h2></div><button onClick={onClose} aria-label="关闭故事板提示词编辑">×</button></header>
      <p>修改只保存在当前本机项目中。当前分镜图会保留到新图片生成成功。</p>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${segment?.title || "分镜"}故事板图片提示词`} />
      <div className="prompt-modal-actions prompt-editor-actions"><button className="secondary-button" disabled={!value.trim() || busy} onClick={onSave}>仅保存提示词</button><button className="primary-button" disabled={!value.trim() || busy} onClick={onRegenerate}>{busy ? "正在生成……" : "使用当前提示词重新生成分镜图"}</button></div>
      <small>如上游返回多张有效候选图，系统会全部保留并要求你手动选择，不会自动决定。</small>
    </section>
  </div>;
}

function VideoPromptModal({ segment, result, value, busy, videoTask, onChange, onClose, onSave, onSaveAndGenerate, onRepair, onRegenerate }: { segment?: StoryboardSegment; result?: VideoPromptResult; value: string; busy: boolean; videoTask?: ShotVideoTask; onChange: (value: string) => void; onClose: () => void; onSave: () => void; onSaveAndGenerate: () => void; onRepair: () => void; onRegenerate: () => void }) {
  const videoTaskActive = Boolean(videoTask && ["waiting_dependency", "submitting", "queued", "running"].includes(videoTask.status));
  const regenerationFailed = Boolean(!busy && result?.prompt.trim() && result.error && result.status !== "needs_revision");
  const canGenerateCurrentSegment = Boolean(value.trim());
  return <div className="script-modal-backdrop prompt-editor-backdrop video-prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-prompt-modal prompt-editor-modal video-prompt-modal" role="dialog" aria-modal="true" aria-label="视频提示词">
      <header><div><span>独立视频提示词 · 可编辑</span><h2>{segment ? `${segment.segmentKey} · ${segment.title} · ${segment.durationSec}秒` : "视频提示词"}</h2></div><button onClick={onClose} aria-label="关闭视频提示词编辑">×</button></header>
      <div className="video-prompt-modal-body">
        {regenerationFailed && <div className="video-prompt-regeneration-error" role="alert"><strong>新提示词生成未完成</strong><p>{result?.error}</p><small>当前显示并保留的是上一次可用提示词。你可以再次生成本段，新稿成功后会直接替换下方内容。</small></div>}
        {result?.status === "needs_revision" && <div className="video-prompt-validation"><strong>{result.repairAttempted ? "这份草稿已经过第二次逐段AI审校，以下项目仍需修改" : "这份Agent草稿已返回，以下项目需要修改"}</strong><ul>{(result.validationIssues?.length ? result.validationIssues : [result.error || "存在需要人工确认的校验项。"]).map((issue) => <li key={issue}>{issue}</li>)}</ul><small>可修改正文后保存确认；也可采用当前草稿，跳过本次校验。确认记录与原问题会保留。</small></div>}
        {!!result?.validationWarnings?.length && <StageFeedback messages={result.validationWarnings} />}
        {result?.repairAttempted && result.repairSourcePrompt && <details className="video-prompt-repair-history"><summary>查看自动校正前的草稿与首轮问题</summary><div><strong>首轮未通过项目</strong><ul>{(result.repairSourceValidationIssues || []).map((issue) => <li key={issue}>{issue}</li>)}</ul><pre>{result.repairSourcePrompt}</pre></div></details>}
        <p>{busy ? "Agent 正在重新生成这一段；完成后会直接更新下方提示词。" : "在这里校对完整提示词。关闭窗口时会自动保存实际修改；重新生成提示词只处理这一段。"}</p>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${segment?.title || "分镜"}视频提示词`} />
      </div>
      <div className="prompt-modal-actions prompt-editor-actions video-prompt-modal-actions"><button className="secondary-button video-prompt-confirm-draft" disabled={!segment || !value.trim() || busy} onClick={onSave}>{result?.status === "needs_revision" && value.trim() === result.prompt.trim() ? "采用当前草稿，跳过本次校验" : "保存并确认本段提示词"}</button><button className="secondary-button" disabled={!segment || busy} onClick={result?.status === "needs_revision" ? onRepair : onRegenerate}>{busy ? "正在处理本段……" : result?.status === "needs_revision" ? "让 Agent 修复当前草稿" : "重新生成本段提示词"}</button><button className="primary-button" title={!canGenerateCurrentSegment ? "请输入本段提示词" : videoTaskActive ? "当前视频任务仍在处理中" : "保存当前草稿并只提交本段H3视频生成"} disabled={!segment || !value.trim() || busy || !canGenerateCurrentSegment || videoTaskActive} onClick={onSaveAndGenerate}>{videoTask ? "保存并重新生成本段视频" : "保存并生成本段视频"}</button></div>
      <small>保存确认只更新提示词；点击生成视频才会提交本段 H3 任务。修复未通过时仍可编辑或采用当前草稿。</small>
    </section>
  </div>;
}

function ImageViewerModal({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return <div className="image-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-viewer-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button onClick={onClose} aria-label="关闭大图">×</button></header>
      <img src={src} alt={title} />
    </section>
  </div>;
}

function AssetLibraryModal({ refreshKey, targets, onApply, onImportCharacter, onUndo, onClose, onViewImage }: { onImportCharacter: (assetId: string, profileKey?: string) => Promise<void>; refreshKey: number; targets: AssetLibraryTarget[]; onApply: (asset: AssetLibraryItem, target: AssetLibraryTarget) => Promise<AssetReplacementUndo>; onUndo: (undoId: string) => Promise<void>; onClose: () => void; onViewImage: (src: string, title: string) => void }) {
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "character" | "scene" | "prop" | "style" | "image" | "video" | "audio">("all");
  const [folderFilter, setFolderFilter] = useState("__all__");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastUndo, setLastUndo] = useState<AssetReplacementUndo | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadDraft, setUploadDraft] = useState<{ type: "character" | "scene" | "prop" | "style" | "image" | "video" | "audio"; name: string; description: string; folder: string }>({ type: "character", name: "", description: "", folder: "" });
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [editDraft, setEditDraft] = useState({ name: "", description: "", folder: "" });
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  function requestClose() {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 320);
  }

  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);
  useEffect(() => {
    if (closing) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closing]);

  async function loadAssets() {
    setError("");
    try {
      const response = await fetch("/api/asset-library", { cache: "no-store" });
      const body = await readApiJson<{ assets?: AssetLibraryItem[]; folders?: string[]; undo?: AssetReplacementUndo | null; error?: string }>(response, "资产库");
      if (!response.ok) throw new Error(body.error || "资产库读取失败。");
      setAssets((body.assets ?? []).map((asset) => ({ ...asset, folder: asset.folder || "", favorite: asset.favorite === true, media: { ...asset.media, referenceImageUrls: asset.media.referenceImageUrls?.length ? asset.media.referenceImageUrls : [asset.media.mainImageUrl, asset.media.auxiliaryImageUrl].filter(Boolean) as string[] } })));
      setFolders(body.folders ?? []);
      setLastUndo(body.undo ?? null);
      setSelectedId((current) => current && body.assets?.some((item) => item.id === current) ? current : body.assets?.[0]?.id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产库读取失败。"); }
  }

  useEffect(() => { void loadAssets(); }, [refreshKey]);
  const filtered = useMemo(() => assets.filter((asset) => (filter === "all" || asset.type === filter)
    && (folderFilter === "__all__" || folderFilter === "__favorites__" ? folderFilter !== "__favorites__" || asset.favorite : asset.folder === folderFilter)
    && `${asset.name} ${asset.description} ${asset.tags.join(" ")} ${asset.sourceProjectName} ${asset.folder}`.toLowerCase().includes(query.trim().toLowerCase())), [assets, filter, folderFilter, query]);
  const selected = filtered.find((asset) => asset.id === selectedId) || filtered[0];
  const compatibleTargets = selected && !["style", "lora"].includes(selected.type) ? targets.filter((target) => target.type === selected.type) : [];
  const typeLabels: Record<AssetLibraryType, string> = { character: "人物", scene: "场景", prop: "道具", style: "风格", lora: "LoRA", text: "文本", image: "图片", video: "视频", audio: "音频" };

  useEffect(() => {
    setEditDraft({ name: selected?.name || "", description: selected?.description || "", folder: selected?.folder || "" });
    setTargetKey("");
  }, [selected?.id]);

  async function uploadMediaFiles(files: File[], expectedKind: "image" | "video" | "audio") {
    const urls: string[] = [];
    for (const file of files) {
      const response = await fetch("/api/free-canvas/imports", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || `上传的${typeLabels[expectedKind]}`) }, body: file });
      const responseBody = await readApiJson<{ asset?: { kind?: string; mediaUrl?: string }; kind?: string; mediaUrl?: string; error?: string }>(response, "资产文件上传");
      const body = { ...responseBody, ...(responseBody.asset || {}) };
      if (!response.ok || body.kind !== expectedKind || !body.mediaUrl) throw new Error(body.error || `${file.name}不是可用的${typeLabels[expectedKind]}文件。`);
      urls.push(body.mediaUrl);
    }
    return urls;
  }

  async function createUploadedAsset(event: React.FormEvent) {
    event.preventDefault();
    if (!uploadFiles.length) { setError("请选择要上传的资产文件。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const expectedKind = ["video", "audio"].includes(uploadDraft.type) ? uploadDraft.type as "video" | "audio" : "image";
      const allowedFiles = uploadFiles.slice(0, expectedKind === "image" && ["character", "scene", "prop", "style"].includes(uploadDraft.type) ? 10 : 1);
      const urls = await uploadMediaFiles(allowedFiles, expectedKind);
      const media = expectedKind === "image" ? { mainImageUrl: urls[0], auxiliaryImageUrl: urls[1], referenceImageUrls: urls }
        : expectedKind === "video" ? { videoUrl: urls[0] } : { audioUrl: urls[0] };
      const response = await fetch("/api/asset-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: uploadDraft.type, name: uploadDraft.name, description: uploadDraft.description, folder: uploadDraft.folder, tags: ["本机上传"], media }) });
      const body = await readApiJson<{ asset?: AssetLibraryItem; error?: string }>(response, "资产保存");
      if (!response.ok || !body.asset) throw new Error(body.error || "资产没有保存。");
      setUploadDraft({ type: "character", name: "", description: "", folder: "" }); setUploadFiles([]); setUploadOpen(false);
      setNotice(`“${body.asset.name}”已保存到资产库。`);
      await loadAssets(); setSelectedId(body.asset.id); setFilter(body.asset.type as typeof filter); setFolderFilter("__all__");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产没有上传。"); }
    finally { setBusy(false); }
  }

  async function updateAsset(asset: AssetLibraryItem, patch: Record<string, unknown>, successMessage = "资产已更新。") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/asset-library", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asset.id, patch }) });
      const body = await readApiJson<{ asset?: AssetLibraryItem; error?: string }>(response, "资产编辑");
      if (!response.ok || !body.asset) throw new Error(body.error || "资产没有更新。");
      setNotice(successMessage); await loadAssets(); setSelectedId(body.asset.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产没有更新。"); }
    finally { setBusy(false); }
  }

  async function addReferenceImages(files: File[]) {
    if (!selected || !files.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const existing = selected.media.referenceImageUrls || [selected.media.mainImageUrl, selected.media.auxiliaryImageUrl].filter(Boolean) as string[];
      const urls = await uploadMediaFiles(files, "image");
      const references = [...new Set([...existing, ...urls])];
      await updateAsset(selected, { media: { mainImageUrl: selected.media.mainImageUrl || references[0], auxiliaryImageUrl: references.find((url) => url !== (selected.media.mainImageUrl || references[0])) || "", referenceImageUrls: references } }, `已添加 ${urls.length} 张参考图。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参考图没有添加。"); setBusy(false); }
  }

  async function createFolder(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/asset-library/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newFolderName }) });
      const body = await readApiJson<{ folder?: string; folders?: string[]; error?: string }>(response, "资产文件夹");
      if (!response.ok || !body.folder) throw new Error(body.error || "文件夹没有创建。");
      setFolders(body.folders ?? []); setNewFolderName(""); setFolderCreateOpen(false); setFolderFilter(body.folder); setNotice(`文件夹“${body.folder}”已创建。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件夹没有创建。"); }
    finally { setBusy(false); }
  }

  async function renameFolder() {
    if (folderFilter.startsWith("__")) return;
    const nextName = window.prompt("新的文件夹名称", folderFilter)?.trim();
    if (!nextName || nextName === folderFilter) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/asset-library/folders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentName: folderFilter, nextName }) });
      const body = await readApiJson<{ folder?: string; error?: string }>(response, "资产文件夹");
      if (!response.ok || !body.folder) throw new Error(body.error || "文件夹没有重命名。");
      await loadAssets(); setFolderFilter(body.folder); setNotice(`文件夹已重命名为“${body.folder}”。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件夹没有重命名。"); }
    finally { setBusy(false); }
  }

  async function removeFolder() {
    if (folderFilter.startsWith("__") || !window.confirm(`删除文件夹“${folderFilter}”？其中的资产会移回“全部资产”。`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/asset-library/folders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: folderFilter }) });
      const body = await readApiJson<{ removedFolder?: string; error?: string }>(response, "资产文件夹");
      if (!response.ok || !body.removedFolder) throw new Error(body.error || "文件夹没有删除。");
      setFolderFilter("__all__"); await loadAssets(); setNotice(`文件夹“${body.removedFolder}”已删除，资产仍保留在库中。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件夹没有删除。"); }
    finally { setBusy(false); }
  }

  async function deleteAsset(asset: AssetLibraryItem) {
    if (!window.confirm(`从资产库移除“${asset.name}”？原始媒体文件会保留。`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/asset-library", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asset.id }) });
      const body = await readApiJson<{ removed?: AssetLibraryItem; error?: string }>(response, "资产移除");
      if (!response.ok || !body.removed) throw new Error(body.error || "资产没有移出资产库。");
      setSelectedId(""); await loadAssets(); setNotice(`“${body.removed.name}”已移出资产库，原始媒体文件仍然保留。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产没有移出资产库。"); }
    finally { setBusy(false); }
  }

  async function removeReferenceImage(asset: AssetLibraryItem, url: string, references: string[]) {
    if (references.length <= 1) return;
    const nextReferences = references.filter((item) => item !== url);
    const mainImageUrl = asset.media.mainImageUrl === url ? nextReferences[0] : asset.media.mainImageUrl;
    const auxiliaryImageUrl = nextReferences.find((item) => item !== mainImageUrl) || "";
    await updateAsset(asset, { media: { mainImageUrl, auxiliaryImageUrl, referenceImageUrls: nextReferences } }, "参考图已移除。");
  }

  async function importSelectedCharacter() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await onImportCharacter(selected.id, targetKey || undefined); setNotice("人物及所选造型已加入本集，请确认角色设定。"); await loadAssets(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "人物没有加入本集。"); }
    finally { setBusy(false); }
  }

  async function applySelected() {
    const target = compatibleTargets.find((item) => item.key === targetKey);
    if (!selected || !target) return;
    setBusy(true); setError(""); setNotice("");
    try { const undo = await onApply(selected, target); setLastUndo(undo); setNotice(`已将“${selected.name}”应用到“${target.name}”，可在这里撤回整次替换。`); await loadAssets(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "资产没有应用。"); }
    finally { setBusy(false); }
  }

  async function undoLastReplacement() {
    if (!lastUndo) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const restoredTarget = lastUndo.targetName;
      await onUndo(lastUndo.id);
      setNotice(`已撤回“${restoredTarget}”的资产替换，替换前资产与审批状态均已恢复。`);
      await loadAssets();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产替换没有撤回。"); }
    finally { setBusy(false); }
  }

  const references = selected?.media.referenceImageUrls?.length ? selected.media.referenceImageUrls : [selected?.media.mainImageUrl, selected?.media.auxiliaryImageUrl].filter(Boolean) as string[];

  return <div className={`asset-library-backdrop ${closing ? "closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section className="asset-library-modal" role="dialog" aria-modal="true" aria-label="跨项目资产库">
    <header><div><span>GLOBAL ASSET LIBRARY</span><h2>跨项目资产库</h2><p>集中保存人物、场景、道具、风格和媒体，随时用于其他项目。</p></div><div><button className="register-lora-button" onClick={() => { setUploadOpen((current) => !current); setFolderCreateOpen(false); }}>＋ 上传资产</button><button className="asset-library-secondary-button" onClick={() => { setFolderCreateOpen((current) => !current); setUploadOpen(false); }}>新建文件夹</button><button className="asset-library-close" onClick={requestClose} aria-label="关闭资产库">×</button></div></header>
    {uploadOpen && <form className="asset-library-upload-form" onSubmit={createUploadedAsset}><label>资产类型<select value={uploadDraft.type} onChange={(event) => { setUploadDraft({ ...uploadDraft, type: event.target.value as typeof uploadDraft.type }); setUploadFiles([]); }}><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option><option value="style">风格</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></label><label>名称<input required maxLength={200} value={uploadDraft.name} onChange={(event) => setUploadDraft({ ...uploadDraft, name: event.target.value })} placeholder="例如：小宝" /></label><label>文件夹<input list="asset-library-folders" value={uploadDraft.folder} onChange={(event) => setUploadDraft({ ...uploadDraft, folder: event.target.value })} placeholder="可选" /></label><label className="asset-library-upload-description">简介<textarea value={uploadDraft.description} onChange={(event) => setUploadDraft({ ...uploadDraft, description: event.target.value })} placeholder="可选，填写角色或素材说明" /></label><label className="asset-library-upload-files">选择文件<input required type="file" multiple={["character", "scene", "prop", "style"].includes(uploadDraft.type)} accept={["video", "audio"].includes(uploadDraft.type) ? `${uploadDraft.type}/*` : "image/*"} onChange={(event) => setUploadFiles(Array.from(event.target.files || []))} /><small>{["character", "scene", "prop", "style"].includes(uploadDraft.type) ? "可同时上传多张参考图，第一张作为封面。" : "选择一份本机文件。"}</small></label><button disabled={busy || !uploadFiles.length}>保存到资产库</button></form>}
    {folderCreateOpen && <form className="asset-library-folder-form" onSubmit={createFolder}><input required maxLength={200} value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="输入文件夹名称" /><button disabled={busy}>创建文件夹</button></form>}
    <datalist id="asset-library-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
    <div className="asset-library-toolbar"><div>{(["all", "character", "scene", "prop", "style", "image", "video", "audio"] as const).map((type) => <button key={type} className={filter === type ? "active" : ""} onClick={() => setFilter(type)}>{type === "all" ? "全部" : typeLabels[type]}</button>)}</div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、文件夹或来源项目" /></div>
    <div className="asset-library-organizer"><button className={folderFilter === "__all__" ? "active" : ""} onClick={() => setFolderFilter("__all__")}>全部资产</button><button className={folderFilter === "__favorites__" ? "active" : ""} onClick={() => setFolderFilter("__favorites__")}>★ 收藏</button>{folders.map((folder) => <button key={folder} className={folderFilter === folder ? "active" : ""} onClick={() => setFolderFilter(folder)}>▰ {folder}</button>)}{!folderFilter.startsWith("__") && <><i /><button onClick={() => void renameFolder()}>重命名</button><button className="danger" onClick={() => void removeFolder()}>删除文件夹</button></>}</div>
    {(error || notice) && <div className={`asset-library-message ${error ? "error" : "success"}`}>{error || notice}</div>}
    {lastUndo && <div className="asset-library-undo"><div><strong>可撤回最近一次替换</strong><span>“{lastUndo.assetName}” → “{lastUndo.targetName}”</span></div><button disabled={busy} onClick={() => void undoLastReplacement()}>撤回刚才替换</button></div>}
    <div className="asset-library-body"><div className="asset-library-grid">{filtered.map((asset) => <button key={asset.id} className={`${selected?.id === asset.id ? "selected" : ""} ${asset.favorite ? "favorite" : ""}`} onClick={() => { setSelectedId(asset.id); setTargetKey(""); setNotice(""); }}><div>{asset.media.mainImageUrl ? <img src={asset.media.mainImageUrl} alt="" /> : asset.media.videoUrl ? <video src={asset.media.videoUrl} muted preload="metadata" /> : <span className="lora-asset-icon">{asset.type === "audio" ? "♫" : asset.type === "text" ? "T" : "◇"}</span>}</div><strong>{asset.name}</strong><small>{asset.favorite ? "★ " : ""}{typeLabels[asset.type]}</small><em>{asset.folder || asset.sourceProjectName}</em></button>)}{filtered.length === 0 && <p className="asset-library-empty">这里还没有符合条件的资产。</p>}</div>
      <aside className="asset-library-detail">{selected ? <><div className="asset-detail-preview">{selected.media.mainImageUrl ? <button onClick={() => onViewImage(selected.media.mainImageUrl!, selected.name)}><img src={selected.media.mainImageUrl} alt={`${selected.name}资产预览`} /><span>查看大图</span></button> : selected.media.videoUrl ? <video src={selected.media.videoUrl} controls preload="metadata" /> : <span className="lora-asset-icon">{selected.type === "audio" ? "♫" : selected.type === "text" ? "T" : "◇"}</span>}</div><div className="asset-detail-heading"><span>{typeLabels[selected.type]}</span><h3>{selected.name}</h3><small>{selected.folder ? `文件夹：${selected.folder} · ` : ""}来源：{selected.sourceProjectName}</small></div>
        {references.length > 1 && <div className="asset-reference-gallery">{references.map((url, index) => <article key={url} className={url === selected.media.mainImageUrl ? "main" : ""}><button onClick={() => void updateAsset(selected, { media: { mainImageUrl: url, auxiliaryImageUrl: references.find((item) => item !== url) || "", referenceImageUrls: [url, ...references.filter((item) => item !== url)] } }, `已将参考图${index + 1}设为封面。`)}><img src={url} alt={`${selected.name}参考图${index + 1}`} /><span>{url === selected.media.mainImageUrl ? "封面" : `参考${index + 1}`}</span></button><button className="remove" disabled={busy} aria-label={`移除${selected.name}参考图${index + 1}`} onClick={() => void removeReferenceImage(selected, url, references)}>×</button></article>)}</div>}
        {!selected.managedCharacter && <div className="asset-detail-actions"><button disabled={busy} onClick={() => void updateAsset(selected, { favorite: !selected.favorite }, selected.favorite ? "已取消收藏。" : "已加入收藏。")}>{selected.favorite ? "★ 已收藏" : "☆ 收藏"}</button>{["character", "scene", "prop", "style", "image"].includes(selected.type) && <><input ref={referenceInputRef} hidden type="file" multiple accept="image/*" onChange={(event) => { const files = Array.from(event.target.files || []); event.currentTarget.value = ""; void addReferenceImages(files); }} /><button disabled={busy || references.length >= 10} onClick={() => referenceInputRef.current?.click()}>＋ 添加参考图</button></>}</div>}
        {!selected.managedCharacter && <form className="asset-detail-edit" onSubmit={(event) => { event.preventDefault(); void updateAsset(selected, editDraft, "资产资料已保存。"); }}><label>名称<input required value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} /></label><label>文件夹<input list="asset-library-folders" value={editDraft.folder} onChange={(event) => setEditDraft({ ...editDraft, folder: event.target.value })} placeholder="未分类" /></label><label>简介<textarea value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} /></label><div><button disabled={busy || !editDraft.name.trim()}>保存修改</button><button type="button" className="danger" disabled={busy || selected.usages.length > 0} title={selected.usages.length > 0 ? "正在被项目使用，不能移除" : "从资产库移除，原始媒体文件会保留"} onClick={() => void deleteAsset(selected)}>从资产库移除</button></div></form>}
        {selected.type === "text" && selected.content && <pre className="asset-library-text-content">{selected.content}</pre>}{selected.media.audioUrl && <audio src={selected.media.audioUrl} controls preload="metadata" />}<section className="asset-usage-list"><strong>使用项目 · {selected.usages.length}</strong>{selected.usages.slice().reverse().map((usage) => <span key={`${usage.projectId}-${usage.targetKey}`}>{usage.projectName} → {usage.targetName}</span>)}{selected.usages.length === 0 && <small>尚未应用到导演项目</small>}</section>{selected.type === "character" ? <div className="asset-apply-controls"><select value={targetKey} onChange={event => setTargetKey(event.target.value)}><option value="">添加为本集角色</option>{compatibleTargets.filter(target => target.name === selected.name).map(target => <option key={target.key} value={target.key}>{target.name} · 使用此版本</option>)}</select><button disabled={busy} onClick={() => void importSelectedCharacter()}>加入本集</button><small>人物资料、主图与辅助图会作为一个版本使用。</small></div> : compatibleTargets.length > 0 ? <div className="asset-apply-controls"><select value={targetKey} onChange={(event) => setTargetKey(event.target.value)}><option value="">选择当前项目中的目标</option>{compatibleTargets.map((target) => <option key={target.key} value={target.key}>{target.name}</option>)}</select><button disabled={busy || !targetKey} onClick={() => void applySelected()}>用于当前项目</button><small>选择对应人物、场景或道具后，当前项目会进入待确认状态。</small></div> : <div className="lora-integration-note">可以从自由画布资产库直接拖入或加入画布。</div>}</> : <p className="asset-library-empty">选择一项资产查看详情。</p>}</aside>
    </div>
  </section></div>;
}

function ProjectManagerModal({ projects, busy, error, onClose, onCreate, onSelect, onRename }: { projects: ProjectSummary[]; busy: boolean; error: string; onClose: () => void; onCreate: () => void; onSelect: (id: string) => void; onRename: (id: string, name: string) => void }) {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  useEffect(() => setDraftNames(Object.fromEntries(projects.map((project) => [project.id, project.name]))), [projects]);
  const commitName = (project: ProjectSummary) => {
    const name = (draftNames[project.id] ?? project.name).trim();
    if (!name) { setDraftNames((current) => ({ ...current, [project.id]: project.name })); return; }
    if (name !== project.name) onRename(project.id, name);
  };
  return <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="project-manager-modal" role="dialog" aria-modal="true" aria-label="项目管理">
      <header><div><span>本机项目</span><h2>项目管理</h2><p>画布、流程、提示词、审批与生成记录按项目独立保存。</p></div><button disabled={busy} onClick={onClose} aria-label="关闭项目管理">×</button></header>
      <div className="project-manager-body">
        <button className="new-project-card" disabled={busy} onClick={onCreate}><span>{busy ? "…" : "＋"}</span><div><strong>{busy ? "正在保存当前项目" : "新建项目"}</strong><small>先完整保存当前画布，再开始一条新的创作流程</small></div></button>
        {error && <p className="project-manager-error" role="alert">{error}</p>}
        <div className="project-list">
          {projects.length === 0 && <p className="project-empty">正在读取本机项目……</p>}
          {projects.map((project) => {
            const draftName = draftNames[project.id] ?? project.name;
            const changed = draftName.trim() !== project.name;
            return <article key={project.id} className={project.active ? "active" : ""}>
              <div><input aria-label={`${project.name}项目名`} value={draftName} maxLength={120} disabled={busy} onChange={(event) => setDraftNames((current) => ({ ...current, [project.id]: event.target.value }))} onBlur={() => commitName(project)} onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === "Escape") setDraftNames((current) => ({ ...current, [project.id]: project.name }));
              }} /><small>{project.episodeNumber ? `第${project.episodeNumber}集 · ` : ""}{project.status} · {new Date(project.updatedAt).toLocaleString("zh-CN", { hour12: false })}</small></div>
              {changed ? <button disabled={busy || !draftName.trim()} onMouseDown={(event) => event.preventDefault()} onClick={() => commitName(project)}>保存名称</button> : project.active ? <span>当前项目</span> : <button disabled={busy} onClick={() => onSelect(project.id)}>打开</button>}
            </article>;
          })}
        </div>
      </div>
    </section>
  </div>;
}

function isConfirmedNodeStatus(status: string) {
  return /已确认|已批准|已完成|已用于|已跳过|已留存|已记录/u.test(status);
}

type CanvasNodeEffect = "idle" | "active" | "result" | "confirmed";

function canvasNodeEffect(status: string): CanvasNodeEffect {
  if (isConfirmedNodeStatus(status)) return "confirmed";
  if (/正在|生成中|整理中|检查中|启动中|队列等待|等待前段|已排队|提交中/u.test(status)) return "active";
  if (/已生成|待确认|待验收|可生成|提示词已确认|草稿待确认|主图已确认|多角度已生成|结果待验收/u.test(status)) return "result";
  return "idle";
}

function ThinkingOrbs({ className = "" }: { className?: string }) {
  return <span className={`thinking-orbs ${className}`.trim()} aria-hidden="true"><i /><i /><i /></span>;
}

function MusicThinkingWave() {
  return <div className="music-thinking-wave" aria-hidden="true"><i /><i /><i /><i /><i /></div>;
}

function CanvasProgressEffect({ completed, total, active }: { completed: number; total: number; active: boolean }) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : 0;
  const complete = total > 0 && completed >= total;
  return <div className={`canvas-generation-progress ${active ? "active" : ""} ${complete ? "complete" : ""}`} role="progressbar" aria-label="镜头生成完成度" aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={completed}>
    <div><span>镜头生成完成度</span><strong>{percentage}%</strong></div>
    <i><b style={{ width: `${percentage}%` }} /><em /></i>
  </div>;
}

function ConfirmedIndicator({ label, className = "" }: { label: string; className?: string }) {
  return <span className={`confirmed-indicator ${className}`.trim()} aria-label={label} title={label}><span className="confirmed-indicator-dot" aria-hidden="true" /></span>;
}

function NodeCard({ nodeId, position, height, onPointerDown, className, badge, title, status, muted, children }: { nodeId: string; position: CanvasPoint; height?: number; onPointerDown: (nodeId: string, event: React.PointerEvent<HTMLElement>) => void; className: string; badge: string; title: string; status: string; muted?: boolean; children: React.ReactNode }) {
  const confirmed = isConfirmedNodeStatus(status);
  const effect = canvasNodeEffect(status);
  return (
    <article className={`node-card ${className} node-effect-${effect} ${muted ? "muted-node" : ""}`} data-node-id={nodeId} data-effect-state={effect} style={{ left: position.x, top: position.y, ...(height ? { height } : {}) }} onPointerDown={(event) => onPointerDown(nodeId, event)}>
      {effect !== "idle" && <span className="node-motion-effect" aria-hidden="true"><i /><i /></span>}
      <div className="node-head"><span>{badge}</span>{confirmed ? <ConfirmedIndicator label={status} className="node-status" /> : <span className="node-status">{status}</span>}</div>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function CanvasTools({ onOpenAssets }: { onOpenAssets: () => void }) {
  return <div className="canvas-tools" aria-label="跨项目资产"><button className="asset-library-trigger" onClick={onOpenAssets} title="打开跨项目资产库"><span>▦</span><strong>资产库</strong></button></div>;
}

function TaskStatus({ hidden = false, children, step, scriptPlanningBusy = false, emotionBusy = false, episodeBusyCount = 0, seriesPlanning = false, characterStatus, characterImageStatus, characterImageRequestCount, characterTurnaroundRunningCount = 0, sceneStatus, sceneImageStatus, sceneImageRequestCount, sceneViewRunningCount, propStatus, propImageStatus, propImageRequestCount, storyboardStatus = "idle", storyboardBoardStatus = "idle", storyboardBoardRequestCount = 0, storyboardPlansReady = false, videoPromptStatus = "idle", videoPromptRunningCount = 0, h3RunningCount = 0 }: { hidden?: boolean; children?: React.ReactNode; step: SetupStep; scriptPlanningBusy?: boolean; emotionBusy?: boolean; episodeBusyCount?: number; seriesPlanning?: boolean; characterStatus: CharacterStageStatus; characterImageStatus: CharacterImageStatus; characterImageRequestCount: number; characterTurnaroundRunningCount?: number; sceneStatus: SceneStageStatus; sceneImageStatus: SceneStageStatus; sceneImageRequestCount: number; sceneViewRunningCount: number; propStatus: SceneStageStatus; propImageStatus: SceneStageStatus; propImageRequestCount: number; storyboardStatus?: SceneStageStatus; storyboardBoardStatus?: SceneStageStatus; storyboardBoardRequestCount?: number; storyboardPlansReady?: boolean; videoPromptStatus?: SceneStageStatus; videoPromptRunningCount?: number; h3RunningCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const activeTasks = [
    { key: "emotion", active: emotionBusy, label: "情绪推荐", summary: "文字Agent正在推荐情绪", detail: "正在结合素材与影片参数筛选表达方向", count: 1 },
    { key: "episode", active: episodeBusyCount > 0, label: "分集剧本", summary: "文字Agent正在生成分集剧本", detail: "正在生成所选集的执行脚本", count: episodeBusyCount },
    { key: "script-planning", active: scriptPlanningBusy, label: seriesPlanning ? "智能拆集" : "剧本生成", summary: seriesPlanning ? "文字Agent正在规划系列分集" : "文字Agent正在生成执行脚本", detail: seriesPlanning ? "正在整理系列母板与第1集脚本" : "正在整理场景、动作与声音结构", count: 1 },
    { key: "h3", active: h3RunningCount > 0, label: "视频生成", summary: "正在处理已提交的视频任务", detail: `${h3RunningCount} 个镜头任务`, count: h3RunningCount },
    { key: "video-prompts", active: videoPromptStatus === "running", label: "视频提示词", summary: "正在生成逐段视频提示词", detail: `${Math.max(videoPromptRunningCount, 1)} 段正在整理`, count: Math.max(videoPromptRunningCount, 1) },
    { key: "storyboard-images", active: storyboardBoardStatus === "running", label: storyboardPlansReady ? "分镜图片" : "画格规划", summary: storyboardPlansReady ? "正在生成故事板分镜图" : "正在准备画格规划", detail: storyboardPlansReady ? `${Math.max(storyboardBoardRequestCount, 1)} 张故事板图片正在并行或排队` : "正在整理结构化镜头规划与图片提示词", count: storyboardPlansReady ? Math.max(storyboardBoardRequestCount, 1) : 1 },
    { key: "storyboard-text", active: storyboardStatus === "running", label: "文字分镜", summary: "正在生成文字分镜", detail: "正在拆分镜头与时序", count: 1 },
    { key: "prop-images", active: propImageStatus === "running" || propImageRequestCount > 0, label: "道具图片", summary: "正在生成道具图片", detail: `${Math.max(propImageRequestCount, 1)} 张道具图`, count: Math.max(propImageRequestCount, 1) },
    { key: "prop-design", active: propStatus === "running", label: "道具设计", summary: "正在生成道具视觉提案", detail: "正在整理道具文字设定", count: 1 },
    { key: "scene-views", active: sceneViewRunningCount > 0, label: "场景多角度图", summary: "正在生成场景多角度图", detail: `${sceneViewRunningCount} 张多角度图`, count: sceneViewRunningCount },
    { key: "scene-images", active: sceneImageStatus === "running" || sceneImageRequestCount > 0, label: "场景图片", summary: "正在生成场景图片", detail: `${Math.max(sceneImageRequestCount, 1)} 张场景图`, count: Math.max(sceneImageRequestCount, 1) },
    { key: "scene-design", active: sceneStatus === "running", label: "场景设计", summary: "正在生成场景视觉提案", detail: "正在整理场景文字设定", count: 1 },
    { key: "character-turnaround", active: characterTurnaroundRunningCount > 0, label: "角色三视图", summary: "正在生成角色三视图", detail: `${characterTurnaroundRunningCount} 张三视图`, count: characterTurnaroundRunningCount },
    { key: "character-images", active: characterImageStatus === "running" || characterImageRequestCount > 0, label: "角色图片", summary: "正在生成角色图片", detail: `${Math.max(characterImageRequestCount, 1)} 张角色图`, count: Math.max(characterImageRequestCount, 1) },
    { key: "character-design", active: characterStatus === "running", label: "角色设计", summary: "正在生成主要角色简介", detail: "正在整理角色文字设定", count: 1 },
  ].filter((task) => task.active);
  const runningCount = activeTasks.reduce((total, task) => total + task.count, 0);
  const running = runningCount > 0;
  const runningLabel = runningCount > 1 ? `${runningCount} 项任务正在运行` : activeTasks[0]?.summary;
  return <section className={`task-status ${running ? "running" : ""} ${expanded ? "expanded" : "collapsed"}`} aria-label="任务列表" hidden={hidden}>
    <div className="task-status-summary"><span>{running ? <ThinkingOrbs className="task-thinking-orbs" /> : step === "workspace" ? <ConfirmedIndicator label="当前无运行任务" /> : "◌"}</span><div><strong>任务列表</strong><small>{running ? runningLabel : step === "workspace" ? "当前无运行任务" : "等待完成前置设置"}</small></div><button type="button" className="task-status-toggle" aria-label={expanded ? "收起任务列表" : "展开任务列表"} aria-expanded={expanded} aria-controls="task-status-detail" onClick={() => setExpanded((current) => !current)}><DisclosureChevron expanded={expanded} /></button></div>
    <div className="task-status-detail" id="task-status-detail" hidden={!expanded}><header><strong>{running ? "正在运行" : "任务状态"}</strong><span>{running ? `${runningCount} 项` : "空闲"}</span></header>{activeTasks.length > 0 ? <ul>{activeTasks.map((task) => <li key={task.key}><span aria-hidden="true" /><div><strong>{task.label}</strong><small>{task.detail}</small></div><b>{task.count}</b></li>)}</ul> : <div className="task-status-empty"><strong>{step === "workspace" ? "当前没有运行任务" : "尚未进入制作阶段"}</strong><small>{step === "workspace" ? "新任务开始后会自动显示在这里" : "完成前置设置后可开始制作"}</small></div>}{children}</div>
  </section>;
}

function ZoomControl({ zoom, onChange, onReset }: { zoom: number; onChange: (zoom: number) => void; onReset: () => void }) {
  return <div className="zoom-control"><button aria-label="缩小画布" onClick={() => onChange(stepZoom(zoom, -1))}>−</button><button className="zoom-value" title="重置画布视角" onClick={onReset}>{Math.round(zoom * 100)}%</button><button aria-label="放大画布" onClick={() => onChange(stepZoom(zoom, 1))}>＋</button></div>;
}

function SettingsModal({ onClose, onProvidersChange, onCreativeDefaults }: { onClose: () => void; onProvidersChange: (providers: ProviderPublicStatus[]) => void; onCreativeDefaults: (defaults: AppCreativeDefaults) => void }) {
  const [section, setSection] = useState<SettingsSection>("connections");
  const [providers, setProviders] = useState<ProviderPublicStatus[]>([]);
  const [activeKind, setActiveKind] = useState<ProviderKind>("agent");
  const [drafts, setDrafts] = useState<Record<ProviderKind, { profileName: string; apiKey: string; baseUrl: string; model: string; protocol: TextProviderProtocol; capabilities?: TextCapabilities }>>(() =>
    Object.fromEntries(providerDefinitions.map((provider) => [provider.kind, {
      profileName: provider.kind === "h3" ? "本机 PRISM H3" : "",
      apiKey: "",
      baseUrl: provider.defaultBaseUrl,
      model: provider.defaultModel,
      protocol: "auto",
    }])) as Record<ProviderKind, { profileName: string; apiKey: string; baseUrl: string; model: string; protocol: TextProviderProtocol; capabilities?: TextCapabilities }>,
  );
  const [editingProfileIds, setEditingProfileIds] = useState<Partial<Record<ProviderKind, string>>>({});
  const [newProfileKinds, setNewProfileKinds] = useState<Partial<Record<ProviderKind, boolean>>>({});
  const [testResults, setTestResults] = useState<Partial<Record<ProviderKind, ProviderTestResult>>>({});
  const [customProviderKinds, setCustomProviderKinds] = useState<Partial<Record<ProviderKind, boolean>>>({});
  const [busy, setBusy] = useState<"save" | "test" | "" | null>(null);
  const [error, setError] = useState("");
  const [appStatus, setAppStatus] = useState<AppSettingsStatus | null>(null);
  const [creativeDraft, setCreativeDraft] = useState<AppCreativeDefaults>(defaultAppCreativeDefaults);
  const [creativeSaveState, setCreativeSaveState] = useState<"" | "saving" | "saved">("");
  const [runtimeChecks, setRuntimeChecks] = useState<Array<{ label: string; status: "checking" | "ok" | "offline"; message: string }>>([]);
  const [desktopInfo, setDesktopInfo] = useState<PrismDesktopInfo | null>(null);
  const [desktopNotice, setDesktopNotice] = useState("");
  const settingsContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/provider-settings/status", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("provider settings unavailable"))),
      fetch("/api/app-settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error("app settings unavailable"))),
    ])
      .then(([providerBody, settingsBody]: [{ providers: ProviderPublicStatus[] }, AppSettingsStatus]) => {
        const normalizedProviders = normalizeProviderStatuses(providerBody.providers);
        setProviders(normalizedProviders);
        onProvidersChange(normalizedProviders);
        setAppStatus(settingsBody);
        setCreativeDraft(normalizeAppCreativeDefaults(settingsBody.settings.creativeDefaults));
        setDrafts((current) => {
          const next = { ...current };
          for (const provider of normalizedProviders) {
            if (!provider.configured) continue;
            const activeProfile = provider.profiles.find((profile) => profile.id === provider.activeProfileId);
            if (!activeProfile) continue;
            next[provider.kind] = {
              ...next[provider.kind],
              profileName: activeProfile.name,
              baseUrl: activeProfile.baseUrl,
              model: activeProfile.model,
              protocol: activeProfile.protocol || "auto", capabilities: activeProfile.capabilities,
            };
          }
          return next;
        });
        setEditingProfileIds(Object.fromEntries(normalizedProviders.filter((provider) => provider.activeProfileId).map((provider) => [provider.kind, provider.activeProfileId])));
      })
      .catch(() => setError("本地设置服务未启动，请重新启动网页服务。"));
  }, []);

  useEffect(() => {
    if (!window.prismDesktop) return;
    void window.prismDesktop.getInfo().then(setDesktopInfo).catch(() => setDesktopNotice("客户端信息暂时无法读取。"));
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    settingsContentRef.current?.scrollTo({ top: 0 });
  }, [section, activeKind]);

  useEffect(() => {
    if (section !== "diagnostics") return;
    setRuntimeChecks([
      { label: "PRISM H3", status: "checking", message: "正在读取本机状态" },
      { label: "本机音乐", status: "checking", message: "正在读取本机状态" },
    ]);
    void Promise.allSettled([
      fetch("/api/h3/status", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/postproduction/local-music/status", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([h3, music]) => {
      const h3Body = h3.status === "fulfilled" ? h3.value as { health?: H3Health } : null;
      const musicBody = music.status === "fulfilled" ? music.value as { health?: H3Health } : null;
      setRuntimeChecks([
        { label: "PRISM H3", status: h3Body?.health?.status === "ok" || h3Body?.health?.status === "queue_busy" ? "ok" : "offline", message: h3Body?.health?.message || "当前无法读取本机视频后端" },
        { label: "本机音乐", status: musicBody?.health?.status === "ok" || musicBody?.health?.status === "queue_busy" ? "ok" : "offline", message: musicBody?.health?.message || "当前无法读取本机音乐运行时" },
      ]);
    });
  }, [section]);

  const definition = providerDefinitions.find((provider) => provider.kind === activeKind)!;
  const draft = drafts[activeKind];
  const providerStatus = providers.find((provider) => provider.kind === activeKind);
  const selectedProfile = providerStatus?.profiles.find((profile) => profile.id === editingProfileIds[activeKind]);
  const testResult = testResults[activeKind];
  const presets = providerPresets[activeKind];
  const selectedPreset = customProviderKinds[activeKind] ? undefined : presets.find((preset) => matchesProviderPreset(draft, preset));
  const modelIsPresetControlled = Boolean(selectedPreset?.model);
  const canReuseActiveKey = Boolean(newProfileKinds[activeKind] && providerStatus?.configured && draft.baseUrl.trim().replace(/\/$/u, "") === providerStatus.baseUrl.replace(/\/$/u, ""));
  const canSaveProvider = Boolean(draft.baseUrl.trim())
    && (activeKind === "h3" || Boolean(draft.model.trim()))
    && (activeKind === "h3" || Boolean(draft.profileName.trim()))
    && (!definition.needsKey || Boolean(draft.apiKey.trim()) || Boolean(selectedProfile?.configured) || canReuseActiveKey);

  function updateDraft(field: "profileName" | "apiKey" | "baseUrl" | "model" | "protocol", value: string) {
    setDrafts((current) => ({ ...current, [activeKind]: { ...current[activeKind], [field]: value } }));
  }

  function selectSavedProfile(profile: ProviderProfilePublic) {
    setEditingProfileIds((current) => ({ ...current, [activeKind]: profile.id }));
    setNewProfileKinds((current) => ({ ...current, [activeKind]: false }));
    setDrafts((current) => ({ ...current, [activeKind]: { profileName: profile.name, apiKey: "", baseUrl: profile.baseUrl, model: profile.model, protocol: profile.protocol || "auto", capabilities: profile.capabilities } }));
    setTestResults((current) => ({ ...current, [activeKind]: undefined }));
    setError("");
  }

  function startNewProfile() {
    const activeProfile = providerStatus?.profiles.find((profile) => profile.active);
    setEditingProfileIds((current) => ({ ...current, [activeKind]: "" }));
    setNewProfileKinds((current) => ({ ...current, [activeKind]: true }));
    setDrafts((current) => ({ ...current, [activeKind]: { profileName: "", apiKey: "", baseUrl: activeProfile?.baseUrl || definition.defaultBaseUrl, model: "", protocol: "auto" } }));
    setTestResults((current) => ({ ...current, [activeKind]: undefined }));
    setError("");
  }

  function selectProviderPreset(preset: ProviderPreset) {
    setDrafts((current) => ({
      ...current,
      [activeKind]: {
        ...current[activeKind],
        baseUrl: preset.baseUrl,
        model: preset.model ?? current[activeKind].model,
        protocol: preset.protocol ?? current[activeKind].protocol,
      },
    }));
    setCustomProviderKinds((current) => ({ ...current, [activeKind]: false }));
    setTestResults((current) => ({ ...current, [activeKind]: undefined }));
    setError("");
  }

  async function testConnection() {
    setBusy("test");
    setError("");
    try {
      const response = await fetch("/api/provider-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activeKind, profileId: editingProfileIds[activeKind] || undefined }),
      });
      const body = await response.json() as { result?: ProviderTestResult; error?: string };
      if (!response.ok || !body.result) throw new Error(body.error || "连接测试失败。");
      setTestResults((current) => ({ ...current, [activeKind]: body.result }));
      if (body.result.details?.resolvedBaseUrl) setDrafts(current => ({ ...current, [activeKind]: { ...current[activeKind], baseUrl: body.result!.details!.resolvedBaseUrl! } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接测试失败。");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndTestConnection() {
    setBusy("save");
    setError("");
    setTestResults((current) => ({ ...current, [activeKind]: undefined }));
    try {
      const configureResponse = await fetch("/api/provider-settings/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activeKind, profileId: editingProfileIds[activeKind] || undefined, createNew: Boolean(newProfileKinds[activeKind]), ...draft }),
      });
      const configured = await configureResponse.json() as { provider?: ProviderPublicStatus; error?: string };
      if (!configureResponse.ok || !configured.provider) throw new Error(configured.error || "配置保存失败。");
      const nextProviders = [...providers.filter((provider) => provider.kind !== activeKind), configured.provider!];
      setProviders(nextProviders);
      onProvidersChange(nextProviders);
      setEditingProfileIds((current) => ({ ...current, [activeKind]: configured.provider!.activeProfileId }));
      setNewProfileKinds((current) => ({ ...current, [activeKind]: false }));
      setDrafts((current) => ({
        ...current,
        [activeKind]: {
          ...current[activeKind],
          apiKey: "",
          profileName: configured.provider!.profiles.find((profile) => profile.active)?.name || current[activeKind].profileName,
          baseUrl: configured.provider!.baseUrl,
          model: configured.provider!.model,
        },
      }));
      setBusy("test");
      const testResponse = await fetch("/api/provider-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activeKind, profileId: configured.provider.activeProfileId }),
      });
      const tested = await testResponse.json() as { result?: ProviderTestResult; error?: string };
      if (!testResponse.ok || !tested.result) throw new Error(tested.error || "连接检查失败。");
      setTestResults((current) => ({ ...current, [activeKind]: tested.result }));
      if (tested.result.details?.resolvedBaseUrl) setDrafts(current => ({ ...current, [activeKind]: { ...current[activeKind], baseUrl: tested.result!.details!.resolvedBaseUrl! } }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存或连接检查失败。");
    } finally {
      setBusy(null);
    }
  }

  async function activateSavedProfile(profileId: string) {
    setBusy("save");
    setError("");
    try {
      const response = await fetch("/api/provider-settings/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: activeKind, profileId }) });
      const body = await response.json() as { provider?: ProviderPublicStatus; error?: string };
      if (!response.ok || !body.provider) throw new Error(body.error || "当前模型没有切换成功。");
      const nextProviders = [...providers.filter((provider) => provider.kind !== activeKind), body.provider];
      setProviders(nextProviders);
      onProvidersChange(nextProviders);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "当前模型没有切换成功。");
    } finally {
      setBusy(null);
    }
  }

  async function removeSavedProfile(profileId: string) {
    setBusy("save");
    setError("");
    try {
      const response = await fetch("/api/provider-settings/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: activeKind, profileId }) });
      const body = await response.json() as { provider?: ProviderPublicStatus; error?: string };
      if (!response.ok || !body.provider) throw new Error(body.error || "模型配置没有移除成功。");
      const nextProviders = [...providers.filter((provider) => provider.kind !== activeKind), body.provider];
      setProviders(nextProviders);
      onProvidersChange(nextProviders);
      const nextProfile = body.provider.profiles.find((profile) => profile.active);
      if (nextProfile) selectSavedProfile(nextProfile); else startNewProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型配置没有移除成功。");
    } finally {
      setBusy(null);
    }
  }

  async function saveCreativeDefaults() {
    setCreativeSaveState("saving");
    setError("");
    try {
      const response = await fetch("/api/app-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creativeDefaults: creativeDraft }) });
      const body = await response.json() as AppSettingsStatus & { error?: string };
      if (!response.ok || !body.settings?.creativeDefaults) throw new Error(body.error || "创作默认值保存失败。");
      setAppStatus(body);
      const normalizedDefaults = normalizeAppCreativeDefaults(body.settings.creativeDefaults);
      setCreativeDraft(normalizedDefaults);
      onCreativeDefaults(normalizedDefaults);
      setCreativeSaveState("saved");
      window.setTimeout(() => setCreativeSaveState(""), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创作默认值保存失败。");
      setCreativeSaveState("");
    }
  }

  async function chooseProjectLibrary() {
    if (!window.prismDesktop) return;
    setDesktopNotice("");
    try {
      const result = await window.prismDesktop.chooseProjectLibrary();
      if (result.canceled || !result.dataRoot) return;
      setDesktopInfo((current) => current ? { ...current, dataRoot: result.dataRoot! } : current);
      setDesktopNotice(result.restartRequired ? "新位置已保存，重启客户端后启用。" : "当前已使用这个项目库。"
      );
    } catch {
      setDesktopNotice("项目库位置保存失败，请稍后再试。" );
    }
  }

  async function openProjectLibrary() {
    if (!window.prismDesktop) return;
    const result = await window.prismDesktop.openProjectLibrary();
    if (!result.ok) setDesktopNotice(result.error || "项目库无法打开。" );
  }

  async function chooseH3Installation() {
    if (!window.prismDesktop) return;
    setDesktopNotice("");
    try {
      const result = await window.prismDesktop.chooseH3Installation();
      if (result.canceled || !result.executable) return;
      setDesktopInfo((current) => current ? {
        ...current,
        components: result.components || current.components.map((component) => component.id === "prism-h3" ? {
          ...component,
          status: "installed",
          path: result.executable!,
          message: "已找到PRISM H3，正在启动并连接。",
        } : component),
      } : current);
      setDesktopNotice("PRISM H3位置已立即启用，正在启动并连接。" );
      const response = await fetch("/api/h3/start", { method: "POST" });
      const body = await readApiJson<{ connected?: boolean; pending?: boolean; message?: string; error?: string }>(response, "启动并连接PRISM H3");
      if (!response.ok) throw new Error(body.error || "PRISM H3没有成功启动。");
      setDesktopNotice(body.connected ? "PRISM H3已连接。" : body.message || "PRISM H3正在启动，客户端会继续自动连接。" );
    } catch (caught) {
      setDesktopNotice(caught instanceof Error ? caught.message : "PRISM H3位置保存失败。" );
    }
  }

  async function chooseAceStepInstallation() {
    if (!window.prismDesktop) return;
    setDesktopNotice("");
    try {
      const result = await window.prismDesktop.chooseAceStepInstallation();
      if (result.canceled || !result.executable || !result.projectRoot) return;
      setDesktopInfo((current) => current ? {
        ...current,
        components: current.components.map((component) => component.id === "ace-step" ? {
          ...component,
          status: "ready",
          path: result.projectRoot!,
          message: "已保存ACE-Step 1.5位置，重启客户端后启用本机音乐。",
        } : component),
      } : current);
      setDesktopNotice(result.restartRequired ? "ACE-Step 1.5位置已保存，重启客户端后启用。" : "当前已使用这个ACE-Step 1.5位置。" );
    } catch (caught) {
      setDesktopNotice(caught instanceof Error ? caught.message : "ACE-Step 1.5位置保存失败。" );
    }
  }

  const sections: Array<{ id: SettingsSection; icon: string; label: string; description: string }> = [
    { id: "connections", icon: "⌁", label: "连接与模型", description: "在线模型与本机生成后端" },
    { id: "creative", icon: "✦", label: "创作默认", description: "新项目的高频初始值" },
    { id: "storage", icon: "▱", label: "文件与存储", description: "项目、素材与成片位置" },
    { id: "diagnostics", icon: "◉", label: "系统与诊断", description: "版本与本机运行状态" },
  ];

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <section className="settings-modal">
        <header className="settings-head">
          <div><span className="eyebrow">PRISM STORY STUDIO</span><h2>设置</h2><p>连接、创作默认值、本机文件与运行状态。</p></div>
          <button onClick={onClose} aria-label="关闭设置">×</button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            {sections.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => { setSection(item.id); setError(""); }}><span aria-hidden="true">{item.icon}</span><div><strong>{item.label}</strong><small>{item.description}</small></div></button>)}
          </nav>

          <div className="settings-content" ref={settingsContentRef}>
            {section === "connections" && <div className="settings-section provider-form">
              <div className="settings-section-title"><div><span>CONNECTIONS</span><h3>连接与模型</h3><p>分别配置文字、图片、音乐与本机视频服务。</p></div><b>{providers.filter((provider) => provider.configured).length}/{providers.length} 已配置</b></div>
              <div className="provider-tabs" role="tablist" aria-label="生成服务">
                {providerDefinitions.map((provider) => {
                  const status = providers.find((item) => item.kind === provider.kind);
                  const result = testResults[provider.kind];
                  return <button key={provider.kind} role="tab" aria-selected={activeKind === provider.kind} className={activeKind === provider.kind ? "active" : ""} onClick={() => { setActiveKind(provider.kind); setError(""); }}><span className={`provider-dot ${result?.status === "ok" ? "ok" : status?.configured ? "configured" : ""}`} /><strong>{provider.name}</strong><small>{result?.status === "ok" ? "连接正常" : status?.configured ? "已保存" : "未配置"}</small></button>;
                })}
              </div>
              <div className="provider-title"><div><h3>{definition.name}</h3><p>{definition.description}</p></div><span>{selectedProfile?.configured ? selectedProfile.keyHint || "本地" : providerStatus?.configured ? `${providerStatus.profiles.length} 个模型` : "未配置"}</span></div>

              <div className="provider-profile-list" aria-label={`${definition.name}已保存模型`}>
                {providerStatus?.profiles.map((profile) => <button type="button" key={profile.id} className={`${editingProfileIds[activeKind] === profile.id ? "selected " : ""}${profile.active ? "active" : ""}`.trim()} onClick={() => selectSavedProfile(profile)}><span><strong>{profile.name}</strong><small>{profile.model || "本机服务"}</small></span>{profile.active && <b>当前</b>}</button>)}
                {activeKind !== "h3" && <button type="button" className={`provider-profile-add ${newProfileKinds[activeKind] ? "selected" : ""}`} onClick={startNewProfile}><span aria-hidden="true">＋</span><strong>添加模型</strong></button>}
              </div>

              {selectedProfile && !selectedProfile.active && <div className="provider-profile-actions"><button type="button" onClick={() => void activateSavedProfile(selectedProfile.id)} disabled={Boolean(busy)}>设为当前模型</button><button type="button" className="danger" onClick={() => void removeSavedProfile(selectedProfile.id)} disabled={Boolean(busy)}>移除配置</button></div>}

              <div className="provider-setup-steps" aria-label="连接设置步骤"><span><b>1</b>选择服务商</span><span><b>2</b>{definition.needsKey ? "粘贴令牌" : "确认本机服务"}</span><span><b>3</b>保存并检查</span></div>

              <fieldset className="provider-presets"><legend>你使用哪一家服务？</legend><div>{presets.map((preset) => <button type="button" key={preset.id} className={selectedPreset?.id === preset.id ? "selected" : ""} onClick={() => selectProviderPreset(preset)}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}<button type="button" className={!selectedPreset ? "selected" : ""} onClick={() => { setCustomProviderKinds((current) => ({ ...current, [activeKind]: true })); setError(""); }}><strong>其他兼容服务</strong><small>手动填写服务商给出的信息</small></button></div></fieldset>

              {activeKind !== "h3" && <label><span>配置名称</span><input maxLength={80} value={draft.profileName} onChange={(event) => updateDraft("profileName", event.target.value)} placeholder="例如：主力写作、快速草稿、备用线路" /><small className="field-help">用于在对话、图片参数和自由画布中快速识别。</small></label>}
              {definition.needsKey && <label><span>访问令牌</span><input type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => updateDraft("apiKey", event.target.value)} placeholder={selectedProfile?.configured ? `已安全保存 ${selectedProfile.keyHint}；不更换可留空` : canReuseActiveKey ? `沿用当前连接 ${providerStatus?.keyHint}` : "粘贴从服务商令牌页面复制的密钥"} spellCheck={false} /><small className="field-help">同一服务新增模型可沿用当前令牌；密钥只保存在这台电脑，不会写入项目文件。</small></label>}
              {definition.kind !== "h3" && !modelIsPresetControlled && <label><span>模型</span><input value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} placeholder="从服务商的模型列表复制模型名" spellCheck={false} /><small className="field-help">请输入支持当前功能的精确模型名。</small></label>}

              {activeKind === "agent" && <label><span>文字接口协议</span><select value={draft.protocol} onChange={(event) => updateDraft("protocol", event.target.value)}><option value="auto">自动识别</option><option value="responses">OpenAI Responses</option><option value="chat-completions">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option></select><small className="field-help">官方预设会自动选择；第三方文字接口由开源 Vercel AI SDK 统一适配结构化输出，仍需填写服务商实际开放的模型名。</small></label>}
              {activeKind === "agent" && <details><summary>模型输出与兼容设置</summary><p className="field-help">填写服务商实际额度。留空沿用任务预算；返回名称只接受这里明确填写的名称。</p>{([['maxOutputTokens', '最大输出 Token'], ['contextWindowTokens', '上下文 Token']] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="256" value={draft.capabilities?.[key] ?? ''} onChange={event => setDrafts(current => ({ ...current, [activeKind]: { ...current[activeKind], capabilities: { ...current[activeKind].capabilities, [key]: event.target.value ? Number(event.target.value) : undefined } } }))} /></label>)}<label><span>允许的返回模型名称（逗号分隔）</span><input value={draft.capabilities?.allowedReturnedModels?.join(', ') ?? ''} onChange={event => setDrafts(current => ({ ...current, [activeKind]: { ...current[activeKind], capabilities: { ...current[activeKind].capabilities, allowedReturnedModels: event.target.value.split(/[,，]/).map(x => x.trim()).filter(Boolean) } } }))} /></label><small>连接检查只验证服务连通性；最近实际生成的结构与内容结果可在制作任务中查看。</small></details>}


              {selectedPreset && <div className="provider-ready-summary"><span>✓</span><div><strong>连接信息已自动填写</strong><small>{selectedPreset.name}{selectedPreset.model ? ` · ${selectedPreset.model}` : ""}</small></div></div>}

              <details className="provider-advanced" open={!selectedPreset}><summary>高级设置</summary><label><span>服务地址</span><input value={draft.baseUrl} onChange={(event) => updateDraft("baseUrl", event.target.value)} placeholder="例如 https://api.example.com/v1" spellCheck={false} /><small className="field-help">可粘贴服务根地址或完整接口地址，保存时会自动整理。</small></label>{definition.kind !== "h3" && modelIsPresetControlled && <label><span>模型</span><input value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} spellCheck={false} /></label>}</details>

              <div className="settings-note"><span>i</span><p>{definition.kind === "music" ? "连接测试只读取服务状态，不提交音乐生成任务。" : "连接测试只查询模型或本机服务状态，不生成文字、图片、音乐或视频。"}</p></div>

              {testResult && <div className={`connection-result ${testResult.status === "ok" ? "ok" : testResult.status === "configured" ? "configured" : "failed"}`}><strong>{testResult.status === "ok" ? "连接正常" : testResult.status === "configured" ? "配置已保存 · 生成权限待验证" : "连接未通过"}</strong><span>{testResult.message}</span></div>}
              {error && <div className="settings-error">{error}</div>}

              <div className="settings-actions guided"><button className="secondary-button" onClick={saveAndTestConnection} disabled={!canSaveProvider || Boolean(busy)}>{busy === "save" ? "正在保存…" : busy === "test" ? "正在检查连接…" : "保存并检查连接"}</button>{providerStatus?.configured && <button className="primary-button" onClick={testConnection} disabled={Boolean(busy)}>仅重新检查</button>}</div>
            </div>}

            {section === "creative" && <div className="settings-section creative-defaults">
              <div className="settings-section-title"><div><span>NEW PROJECT DEFAULTS</span><h3>创作默认</h3><p>创建新项目时自动带入，项目内仍可单独调整。</p></div></div>
              <SettingsChoice title="默认分镜段长" description="新项目会按所选时长固定切分；只有整片结尾不足时使用剩余时长。" value={String(creativeDraft.storyboardSegmentDurationSec)} options={[['5', '5秒'], ['10', '10秒'], ['15', '15秒']]} onChange={(value) => setCreativeDraft((current) => ({ ...current, storyboardSegmentDurationSec: Number(value) as 5 | 10 | 15 }))} />
              <SettingsChoice title="默认故事板规格" description="保存后同步当前项目，后续新项目也沿用。" value={String(creativeDraft.storyboardBoardPanelCount)} options={[["3", "三宫格"], ["4", "四宫格"], ["6", "六宫格"], ["9", "九宫格"]]} onChange={(value) => setCreativeDraft((current) => ({ ...current, storyboardBoardPanelCount: Number(value) as StoryboardBoardPanelCount }))} />
              <SettingsChoice title="H3画质预设" description="标准20步、均衡10步、极速Turbo 6步。" value={creativeDraft.h3QualityPreset} options={[["standard", "标准"], ["balanced", "均衡"], ["fast", "极速"]]} onChange={(value) => setCreativeDraft((current) => ({ ...current, h3QualityPreset: value as AppCreativeDefaults["h3QualityPreset"] }))} />
              <SettingsChoice title="H3分辨率" description="本机生成建议从480P开始。" value={creativeDraft.h3Resolution} options={[["480p", "480P"], ["720p", "720P"], ["1080p", "1080P"]]} onChange={(value) => setCreativeDraft((current) => ({ ...current, h3Resolution: value as AppCreativeDefaults["h3Resolution"] }))} />
              <SettingsChoice title="成片字幕" description="选择“每个项目决定”会在后期阶段继续询问。" value={creativeDraft.subtitles} options={[["ask", "每个项目决定"], ["none", "不加字幕"], ["burned", "烧录字幕"]]} onChange={(value) => setCreativeDraft((current) => ({ ...current, subtitles: value as AppCreativeDefaults["subtitles"] }))} />
              <SettingsChoice title="声音方案" description="作为新项目后期方案的初始选择。" value={creativeDraft.audioMode} options={[["ask", "每个项目决定"], ["native", "保留原声"], ["native_with_music", "原声加配乐"], ["music_only", "仅配乐"]]} onChange={(value) => setCreativeDraft((current) => ({ ...current, audioMode: value as AppCreativeDefaults["audioMode"] }))} />
              {error && <div className="settings-error">{error}</div>}
              <div className="settings-single-action"><button onClick={() => void saveCreativeDefaults()} disabled={creativeSaveState === "saving"}>{creativeSaveState === "saving" ? "正在保存…" : creativeSaveState === "saved" ? "已保存" : "保存创作默认值"}</button></div>
            </div>}

            {section === "storage" && <div className="settings-section storage-settings">
              <div className="settings-section-title"><div><span>LOCAL STORAGE</span><h3>文件与存储</h3><p>项目记录、生成素材和成片都保存在本机。</p></div></div>
              {desktopInfo && <section className="desktop-library-card"><div><span>客户端项目库</span><strong>{desktopInfo.dataRoot}</strong><small>项目记录、素材、成片和应用设置均在此目录下管理。</small></div><div><button type="button" onClick={() => void openProjectLibrary()}>打开目录</button><button type="button" className="primary" onClick={() => void chooseProjectLibrary()}>更改位置</button></div></section>}
              {desktopNotice && <div className="settings-note neutral"><span>i</span><p>{desktopNotice}</p></div>}
              <div className="storage-list">{(appStatus?.storage || []).map((location) => <section key={location.id}><span className={location.available ? "available" : "pending"} aria-hidden="true" /><div><strong>{location.label}</strong><code>{location.path}</code></div><b>{location.available ? "可用" : "尚未建立"}</b></section>)}</div>
              <div className="settings-note neutral"><span>i</span><p>目录会在首次产生对应内容时自动建立。项目文件与连接密钥分别保存。</p></div>
            </div>}

            {section === "diagnostics" && <div className="settings-section diagnostics-settings">
              <div className="settings-section-title"><div><span>SYSTEM STATUS</span><h3>系统与诊断</h3><p>只读检查本机服务，不会提交任何生成任务。</p></div><b>v{appStatus?.diagnostics.appVersion || "0.1.0"}</b></div>
              <div className="diagnostic-summary"><section><span className="ok" /><div><strong>PRISM Story Studio 本地服务</strong><small>运行正常 · {appStatus?.diagnostics.nodeVersion || "Node.js"}</small></div></section><section><span className="ok" /><div><strong>Provider配置</strong><small>{appStatus?.diagnostics.configuredProviders ?? providers.filter((provider) => provider.configured).length}/{appStatus?.diagnostics.totalProviders ?? providers.length} 项已保存</small></div></section>{runtimeChecks.map((check) => <section key={check.label}><span className={check.status} /><div><strong>{check.label}</strong><small>{check.message}</small></div></section>)}</div>
              {desktopInfo?.components?.length ? <><div className="component-summary-title"><strong>本机组件</strong><small>小型工具随客户端提供，大型模型按需复用或安装。</small></div><div className="component-summary">{desktopInfo.components.map((component) => <section key={component.id}><span className={component.status} aria-hidden="true" /><div><strong>{component.label}</strong><small>{component.message}</small>{component.path && <code>{component.path}</code>}</div><b>{component.status === "ready" ? "可用" : component.status === "installed" ? "已安装" : component.status === "incomplete" ? "待补齐" : component.category === "optional-large" ? "可选" : "缺失"}</b>{component.id === "prism-h3" && component.status !== "ready" && <button type="button" onClick={() => void chooseH3Installation()}>定位H3</button>}{component.id === "ace-step" && component.status !== "ready" && <button type="button" onClick={() => void chooseAceStepInstallation()}>定位ACE</button>}</section>)}</div></> : null}
              {desktopNotice && <div className="settings-note neutral"><span>i</span><p>{desktopNotice}</p></div>}
              <div className="system-meta"><span>运行平台</span><code>{appStatus?.diagnostics.platform || "正在读取"}</code></div>
            </div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsChoice({ title, description, value, options, onChange }: { title: string; description: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <section className="settings-choice"><div><strong>{title}</strong><small>{description}</small></div><div>{options.map(([id, label]) => <button key={id} className={value === id ? "selected" : ""} onClick={() => onChange(id)}>{label}</button>)}</div></section>;
}
