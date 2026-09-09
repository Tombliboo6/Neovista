import { buildCharacterCatalog, catalogAsset, changeCharacterRoster, preserveCharacterHistory, characterScope, knownCharacterAnchors } from './character-library.mjs';
import { referenceInputError, referencePurposeContext } from "../src/free-canvas/reference-contract.ts";
import { assetBoardLayoutIssues } from '../src/validation/asset-board-validation.ts';
import { IdeaAgentValidationError, runIdeaAgentTurn } from '../src/ideas/idea-agent.ts';
import { recommendCreativeTones } from '../src/ideas/tone-recommendation.ts';
import { runProjectManagerTurn as runGlobalManagerTurn } from '../src/manager/global-manager.ts';
import { buildProjectManagerContext } from '../src/manager/project-inspector.ts';
import { compileProjectManagerCommands } from '../src/manager/manager-commands.ts';
import { generateCharacterProfilesWithDirector, generatePropVisualProposalsWithDirector, generateSceneVisualProposalsWithDirector, ProductionDirectorSupervisionError, ProductionDirectorStageError } from '../src/manager/production-director.ts';
import { optimizeFreeCanvasPrompt, validateVideoPromptLanguageSurface } from '../src/free-canvas/prompt-optimization.ts';
import { freeCanvasCapacityError } from '../src/free-canvas/capacity.ts';
import { runPromptDirector } from '../src/prompt-master/prompt-director.ts';
import { compileFreeCanvasImageReferenceMentions, compileFreeCanvasReferenceMentions } from './src/free-canvas-reference-mentions.ts';
import { adaptNovelToSeriesPlan, adaptNovelToSingleScript, NovelAdaptationValidationError } from '../src/novels/adapt-novel.ts';
import { CharacterProfileValidationError, validateCharacterProfileDraft } from '../src/characters/profile-extraction.ts';
import { CharacterAssetPromptValidationError, compileCharacterAssetPrompt, generateCharacterAssetPrompts, validateCharacterAssetPromptDraft } from '../src/characters/asset-prompt-generation.ts';
import { reviseCharacterDesign } from '../src/characters/character-design-revision.ts';
import { buildCharacterTurnaroundRequest } from '../src/characters/turnaround-generation.ts';
import { acceptSceneVisualProposalModelOutput, compileSceneAssetPrompt, generateScenePromptsFromProposals, SceneAssetPromptValidationError, validateSceneAssetPromptDraft, validateSceneVisualProposalDraft } from '../src/scenes/scene-prompt-generation.ts';
import { buildSceneViewRequest } from '../src/scenes/scene-view-generation.ts';
import { acceptReturnedPropVisualProposalDraft, PropAssetPromptValidationError, compilePropAssetPrompt, generatePropPromptsFromProposals, validatePropAssetPromptDraft, validatePropVisualProposalDraft } from '../src/props/prop-prompt-generation.ts';
import { revisePropDesign } from '../src/props/prop-design-revision.ts';
import { StoryboardPromptValidationError, collectStoryboardValidationWarnings, generateStoryboardPromptsWithRepair, groundStoryboardEvidence, validateStoryboardPromptDraft } from '../src/storyboards/storyboard-prompt-generation.ts';
import { compileStoryboardBoardImagePrompt, normalizeStoryboardBoardPlanReferences, validateStoryboardBoardPlan } from '../src/storyboards/storyboard-board-generation.ts';
import { acceptStoryboardBoardBatchPartial, generateStoryboardBoardBatchPartial } from '../src/storyboards/storyboard-board-batch.ts';
import { SegmentVideoPromptValidationError, buildEpisodeVideoPromptBatchRequest, buildEpisodeVideoPromptRepairRequest, compileSegmentVideoPrompt, compileSegmentVideoPromptDraft, normalizeSegmentVideoPromptBookkeeping, sanitizeCompiledVideoPrompt, validateSegmentVideoPromptPlan } from '../src/videos/video-prompt-generation.ts';
import { buildMusicPromptRepairRequest, buildMusicPromptRequest, collectMusicPromptValidationWarnings, hasCompleteInstrumentalMusicAssignment, MusicPromptValidationError, validateMusicPromptPlan } from '../src/postproduction/music-prompt-generation.ts';
import { buildFinalSubtitleCues, ffmpegFilterPath, renderFinalSrt } from '../src/postproduction/final-composition.ts';
import { getStylePreset, normalizeStylePresetId, STYLE_PRESETS } from '../src/styles/presets.ts';
import { applyGenerationPresetToPrompt, IMAGE_RESOLUTION_TIERS, imageRequestSizeForAspectRatio, isGenerationStyleCompatible, normalizeGenerationAspectRatio, normalizeGenerationPreset } from '../src/presets/generation-preset.ts';
import { TEXT_TOKEN_BUDGETS } from '../src/providers/token-budgets.ts';
import { parseStructuredOutput } from '../src/providers/openai-responses.ts';
import { deriveWorkflowSnapshot, sanitizeWorkflowSnapshot, unresolvedDependencies } from '../src/workflow/runtime.ts';
import { STAGE_IDS } from '../src/workflow/stages.ts';
import { stageLabelZh } from '../src/workflow/view-model.ts';
import { partitionAgentDraftValidationIssues } from '../src/validation/agent-draft-validation.ts';
import { createCreativeSessionRepository } from './creative-session-repository.mjs';
import { createProductionJobStore } from './production-jobs.mjs';
import { sharedRequestScheduler, scheduledAgent, scheduledImage } from '../src/providers/request-scheduler.ts';
import { normalizeTextCapabilities } from '../src/providers/model-capabilities.ts';
import { modelMetadataHealth, probeModelApi } from '../src/providers/model-health.ts';
import { productionCheckpoint } from '../src/workers/production-context.ts';
import { generateStoryboardPromptsBySegment, collectStoryboardOutlineIssues } from '../src/storyboards/storyboard-prompt-generation.ts';
import { normalizeStoryboardVideoReferences, withStoryboardVideoGuide } from '../src/videos/storyboard-video-references.ts';
import { videoReferenceIssues } from '../src/videos/video-reference-validation.ts';
import { CloudVideoProvider, VideoApiError, stableVideoSeed } from '../src/providers/cloud-video.mjs';
import { createVideoJobStore } from './video-jobs.mjs';

// Image providers enter the shared scheduler themselves. Enqueue every item
// here so an outer worker pool cannot override the user's active image limit.
export function mapImageRequests(items, work) {
  return Promise.all(items.map(work));
}
export const VIDEO_PROMPT_BATCH_SIZE = 1;
export const VIDEO_PROMPT_CONCURRENCY = 2;
export const VIDEO_PROMPT_REPAIR_CONCURRENCY = 2;
export const TEXT_AGENT_REASONING_EFFORT = 'high';
export const STORYBOARD_TEXT_REASONING_EFFORT = 'medium';
export const PROJECT_MANAGER_REASONING_EFFORTS = ['low', 'medium', 'high'];
const FREE_CANVAS_IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3'];
const FREE_CANVAS_IMAGE_SIZES = IMAGE_RESOLUTION_TIERS.flatMap((resolution) => FREE_CANVAS_IMAGE_ASPECT_RATIOS.map((aspectRatio) => ({
  resolution,
  aspectRatio,
  ...imageRequestSizeForAspectRatio(aspectRatio, resolution),
})));

function freeCanvasImageSize(width, height) {
  return FREE_CANVAS_IMAGE_SIZES.find((item) => item.width === Number(width) && item.height === Number(height));
}
export const TEXT_AGENT_TRANSIENT_RETRY_COUNT = 0;

export const WORKFLOW_STAGE_BY_MUTATION_ROUTE = Object.freeze({
  '/api/characters/profiles': 'character-profiles',
  '/api/characters/revise-design': 'character-images',
  '/api/characters/images': 'character-images',
  '/api/characters/turnaround': 'character-images',
  '/api/scenes/proposals': 'scenes',
  '/api/scenes/images': 'scenes',
  '/api/scenes/views': 'scene-views',
  '/api/props/proposals': 'props',
  '/api/props/revise-design': 'props',
  '/api/props/images': 'props',
  '/api/storyboards/segments': 'storyboard-prompts',
  '/api/storyboards/board-plans': 'storyboard-images',
  '/api/storyboards/boards': 'storyboard-images',
  '/api/videos/prompts': 'video-prompts',
  '/api/videos/prompts/repair': 'video-prompts',
  '/api/h3/generations': 'shot-videos',
  '/api/videos/generations': 'shot-videos',
  '/api/postproduction/music-prompt': 'music',
});

const PER_ITEM_PREREQUISITE_ROUTES = new Set([
  '/api/scenes/views',
  '/api/videos/prompts', '/api/videos/prompts/repair', '/api/h3/generations', '/api/videos/generations',
]);

export function requireWorkflowDependenciesForRoute(session, pathname) {
  const stageId = WORKFLOW_STAGE_BY_MUTATION_ROUTE[pathname];
  if (!stageId) return null;
  if (PER_ITEM_PREREQUISITE_ROUTES.has(pathname)) return stageId;
  if (!session?.workflow) {
    throw new WorkflowDependencyError(stageId, [], '当前项目还没有可用的工作流状态，请先保存项目后再继续。');
  }
  const dependencies = unresolvedDependencies(session.workflow, stageId);
  if (dependencies.length > 0) throw new WorkflowDependencyError(stageId, dependencies);
  return stageId;
}

export function requireSegmentApprovalForRoute(session, route, payload) {
  if (!['/api/videos/prompts', '/api/videos/prompts/repair'].includes(route)) return;
  const state = session?.state;
  if (!state) throw new InputError('请先保存当前项目。');
  const keys = payload?.requestedSegmentKeys ?? (payload?.segmentKey ? [payload.segmentKey] : state.storyboardSegments?.map(item => item.segmentKey));
  if (!Array.isArray(keys) || !keys.length) throw new InputError('请选择需要生成提示词的分镜。');
  for (const key of keys) {
    const board = state.storyboardBoards?.find(item => item.segmentKey === key);
    const plan = state.storyboardBoardPlans?.find(item => item.segmentKey === key && !item.stale);
    const approvedPlan = plan && (plan.approval === 'approved' || state.storyboardAssetsApproval === 'approved');
    const approvedBoard = board && !board.stale && board.status === 'complete' && board.imageUrl && (board.approval === 'approved' || state.storyboardAssetsApproval === 'approved');
    if (!approvedPlan && !approvedBoard) throw new InputError(`${key} 的分镜规划或故事板尚未确认或需要更新，请先审核这一段。`);
  }
}

export async function mapWithConcurrencyOrdered(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new InputError('并行数量必须是大于0的整数。');
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}
import { reviseIdeaScript } from '../src/scripts/revise-idea-script.ts';
import { generateSeriesEpisodeScript } from '../src/scripts/series-episode-script.ts';
import { selectEpisodeCharacters } from './src/episode-characters.ts';
import { OpenAIImagesProvider, OpenAIImagesProviderError } from '../src/providers/openai-images.ts';
import { OpenAIResponsesAgentProvider, OpenAIResponsesProviderError, resolveTextProviderProtocol } from '../src/providers/openai-responses.ts';
import { PrismH3Provider, PrismH3ProviderError } from '../src/providers/prism-h3.ts';
import { MiniMaxMusicProvider, MiniMaxMusicProviderError } from '../src/providers/minimax-music.ts';
import { AceStepMusicProvider, AceStepMusicProviderError } from '../src/providers/acestep-music.ts';
import { LocalImageToolsProvider, LocalImageToolsProviderError } from '../src/providers/local-image-tools.ts';
import { LocalGpuBusyError, LocalGpuCoordinator } from '../src/providers/local-gpu-coordinator.ts';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ALLOWED_KINDS = new Set(['agent', 'image', 'image-edit', 'music', 'h3', 'minimax-video', 'seedance-video']);
const ALLOWED_STEPS = new Set(['start', 'novel', 'idea', 'format', 'parameters', 'emotion', 'idea-questions', 'idea-script', 'workspace']);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_RESOURCE_ROOT = resolve(process.env.PRISM_STORY_STUDIO_RESOURCE_ROOT ?? REPOSITORY_ROOT);
const RUNTIME_DATA_ROOT = resolve(process.env.PRISM_STORY_STUDIO_DATA_ROOT ?? resolve(REPOSITORY_ROOT, 'runtime-data'));
const FREE_CANVAS_IMPORT_DIRECTORY = resolve(RUNTIME_DATA_ROOT, 'free-canvas-imports');
const FREE_CANVAS_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const FREE_CANVAS_IMPORT_EXTENSIONS = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']),
  video: new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']),
  audio: new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']),
};

const DEFAULT_APP_SETTINGS = Object.freeze({
  creativeDefaults: Object.freeze({
    storyboardSegmentDurationSec: 15,
    storyboardBoardPanelCount: 3,
    h3QualityPreset: 'standard',
    h3Resolution: '480p',
    subtitles: 'ask',
    audioMode: 'ask',
  }),
});

function normalizeAppSettings(input) {
  const source = input?.creativeDefaults && typeof input.creativeDefaults === 'object' ? input.creativeDefaults : {};
  const storyboardSegmentDurationSec = [5, 10, 15].includes(Number(source.storyboardSegmentDurationSec))
    ? Number(source.storyboardSegmentDurationSec)
    : DEFAULT_APP_SETTINGS.creativeDefaults.storyboardSegmentDurationSec;
  const storyboardBoardPanelCount = [3, 4, 6, 9].includes(Number(source.storyboardBoardPanelCount))
    ? Number(source.storyboardBoardPanelCount)
    : DEFAULT_APP_SETTINGS.creativeDefaults.storyboardBoardPanelCount;
  return {
    creativeDefaults: {
      storyboardSegmentDurationSec,
      storyboardBoardPanelCount,
      h3QualityPreset: ['standard', 'balanced', 'fast'].includes(source.h3QualityPreset) ? source.h3QualityPreset : DEFAULT_APP_SETTINGS.creativeDefaults.h3QualityPreset,
      h3Resolution: ['480p', '720p', '1080p'].includes(source.h3Resolution) ? source.h3Resolution : DEFAULT_APP_SETTINGS.creativeDefaults.h3Resolution,
      subtitles: ['ask', 'none', 'burned'].includes(source.subtitles) ? source.subtitles : DEFAULT_APP_SETTINGS.creativeDefaults.subtitles,
      audioMode: ['ask', 'native', 'native_with_music', 'music_only'].includes(source.audioMode) ? source.audioMode : DEFAULT_APP_SETTINGS.creativeDefaults.audioMode,
    },
  };
}

export function createAppSettingsStore(options = {}) {
  const filePath = options.filePath ?? resolve(RUNTIME_DATA_ROOT, 'web/app-settings.json');
  let settings = normalizeAppSettings(DEFAULT_APP_SETTINGS);
  if (existsSync(filePath)) {
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      if (saved?.schemaVersion === 1) settings = normalizeAppSettings(saved.settings);
    } catch {
      // A damaged preferences file falls back to conservative defaults.
    }
  }

  function publicStatus() {
    const locations = [
      { id: 'projects', label: '项目与资产记录', path: resolve(RUNTIME_DATA_ROOT, 'web') },
      { id: 'generated-media', label: '生成素材', path: RUNTIME_DATA_ROOT },
      { id: 'compositions', label: '成片输出', path: resolve(RUNTIME_DATA_ROOT, 'compositions') },
    ];
    return {
      settings: structuredClone(settings),
      storage: locations.map((location) => ({ ...location, available: existsSync(location.path) })),
      diagnostics: {
        appVersion: process.env.PRISM_STORY_STUDIO_VERSION ?? '0.1.0',
        localService: 'online',
        nodeVersion: process.version,
        platform: `${process.platform} ${process.arch}`,
      },
    };
  }

  return {
    status: publicStatus,
    update(input) {
      settings = normalizeAppSettings(input);
      writeJsonAtomically(filePath, { schemaVersion: 1, updatedAt: new Date().toISOString(), settings });
      return publicStatus();
    },
  };
}
const LEGACY_STYLE_ANCHORS = new Map([
  ['ancient-2d-drama', '高品质古风二维漫剧，清晰稳定的角色线稿，细腻赛璐璐明暗，东方服饰纹理与电影化场景层次。'],
  ['chinese-ink-wash', '当代国风水墨视觉，墨色浓淡与自然晕染，宣纸肌理，东方留白，人物与山水气韵统一。'],
  ['ethereal-gothic', '空灵哥特幻想，冷色月光、尖拱建筑与梦境薄雾，华丽但克制的暗色材质，神秘纤细的角色气质。'],
  ['ancient-3d-drama', '高品质古风三维漫剧，稳定的东方角色比例，精细服装建模与布料材质，电影级灯光和清晰叙事表演。'],
  ['classical-theatre-lighting', '古典戏剧情绪光影，舞台化空间层次，克制而强烈的明暗对比，人物表演感与绘画性光色统一。'],
  ['3d-fantasy', '高品质东方玄幻三维动画电影风格，写实比例与风格化角色塑造兼容，精细角色建模，真实布料和金属材质，电影级体积光，冷暖层次清晰，克制而精致的能量特效。'],
  ['eastern-classical-decoration', '东方古典装饰艺术，花鸟瑞兽与传统纹样形成有秩序的平面构成，典雅矿物色，壁画和织锦般的细节。'],
  ['ancient-live-action', '高品质古风真人影视，真实自然的亚洲人物面孔与皮肤质感，可信服化道，电影级布光、镜头和材质还原。'],
]);

export function createCreativeSessionStore(options = {}) {
  const filePath = options.filePath ?? resolve(RUNTIME_DATA_ROOT, 'web/creative-session.json');
  const projectDirectory = options.projectDirectory ?? resolve(dirname(filePath), 'projects');
  const repository = createCreativeSessionRepository({ filePath, projectDirectory, validate: validateSavedSession });
  let initialRecoveryPending = true;

  return {
    load() {
      const saved = repository.loadActive();
      if (!initialRecoveryPending) return saved;
      initialRecoveryPending = false;
      const recovered = recoverInterruptedImageState(saved);
      if (recovered && recovered !== saved) repository.write(recovered);
      return recovered;
    },

    save(input) {
      const previous = this.load();
      const expectedRevision = Number(input?.expectedRevision);
      if (previous && Number.isInteger(expectedRevision) && expectedRevision !== previous.revision) {
        throw new SessionRevisionConflict(previous);
      }
      validateFreeCanvasWrite(input?.state?.freeCanvas, previous?.state?.freeCanvas);
      let state = sanitizeCreativeState(input?.state);
      const sessionId = previous?.id ?? randomUUID();
      if (state.characterRosterVersion === 1 || previous?.state.characterRosterVersion === 1) state = preserveCharacterHistory(state, previous?.state, { id: sessionId, series: previous?.series, state });
      const session = {
        schemaVersion: 2,
        id: sessionId,
        ...(previous?.series ? { series: previous.series } : {}),
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        state,
        workflow: deriveWorkflowSnapshot(state, previous?.workflow),
      };
      repository.write(session);
      return session;
    },

    create(input) {
      validateFreeCanvasWrite(input?.state?.freeCanvas);
      const current = this.load();
      if (current) repository.archive(current);
      const state = sanitizeCreativeState(input?.state);
      const session = {
        schemaVersion: 2,
        id: randomUUID(),
        revision: 1,
        updatedAt: new Date().toISOString(),
        state,
        workflow: deriveWorkflowSnapshot(state),
      };
      repository.write(session);
      return session;
    },

    list() {
      const current = this.load();
      const sessions = new Map();
      for (const saved of repository.listArchived()) sessions.set(saved.id, saved);
      if (current) sessions.set(current.id, current);
      return [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((session) => projectSummary(session, session.id === current?.id));
    },

    select(id) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new InputError('项目ID无效。');
      const session = repository.readArchived(id);
      if (!session) throw new InputError('项目草稿已损坏，无法打开。');
      const current = this.load();
      if (current) repository.archive(current);
      repository.activate(session);
      return session;
    },

    characterCatalog(externalAssets = []) {
      const current = this.load();
      const sessions = repository.listArchived().filter(item => item.id !== current?.id);
      if (current) sessions.push(current);
      return buildCharacterCatalog(sessions, externalAssets);
    },

    changeCharacters(input, externalAssets = []) {
      const current = this.load();
      if (!current) throw new InputError('请先打开项目。');
      if (input?.projectId !== current.id || input?.expectedRevision !== current.revision) throw new SessionRevisionConflict(current);
      try {
        const state = changeCharacterRoster(current, input, this.characterCatalog(externalAssets));
        return this.save({ state, expectedRevision: current.revision });
      } catch (error) {
        if (error instanceof SessionRevisionConflict) throw error;
        throw new InputError(error instanceof Error ? error.message : '人物操作未完成。');
      }
    },

    openEpisode(input) {
      const current = this.load();
      if (!current) throw new InputError('请先打开系列项目。');
      if (input?.projectId !== current.id || input?.expectedRevision !== current.revision) throw new SessionRevisionConflict(current);
      const episodeNumber = Number(input?.episodeNumber);
      if (!Number.isInteger(episodeNumber) || !current.state.ideaScript?.seriesPlan?.some(item => item.episodeNumber === episodeNumber)) throw new InputError('系列规划中没有这一集。');
      const rootProjectId = current.series?.rootProjectId || current.id;
      const sessions = [current, ...repository.listArchived().filter(item => item.id !== current.id)];
      const existing = sessions.find(item => (item.series?.rootProjectId || item.id) === rootProjectId && (item.series?.episodeNumber || item.state.ideaScript?.episodeNumber || 1) === episodeNumber);
      if (existing) return existing.id === current.id ? current : this.select(existing.id);
      const record = current.state.episodeScripts?.find(item => item.episodeNumber === episodeNumber && item.status === 'complete' && item.script);
      if (!record) throw new InputError(`请先生成第${episodeNumber}集剧本，再进入本集制作。`);
      const sharedKeys = ['creationSource', 'workType', 'creativeDirection', 'ideaText', 'ideaAnswers', 'novelText', 'novelName', 'duration', 'customDurationSec', 'episodeCountMode', 'episodeCount', 'ratio', 'generationPreset', 'generationPresetHistory', 'language', 'emotion', 'customEmotion', 'selectedStyleId', 'storyboardSegmentDurationSec', 'storyboardBoardPanelCount', 'h3GenerationSettings'];
      const shared = Object.fromEntries(sharedKeys.map(key => [key, current.state[key]]));
      const title = current.series?.title || projectSummary(current, true).name;
      const seriesMotherScript = current.state.seriesMotherScript || sessions.find(item => item.id === rootProjectId)?.state.ideaScript || current.state.ideaScript;
      const state = sanitizeCreativeState({ ...shared, seriesMotherScript, step: 'workspace', activeStage: '剧本', projectName: `${title} · 第${episodeNumber}集`, ideaScript: { ...record.script, episodeNumber }, episodeScripts: current.state.episodeScripts, scriptApproval: 'draft' });
      const session = { schemaVersion: 2, id: randomUUID(), revision: 1, updatedAt: new Date().toISOString(), series: { rootProjectId, title, episodeNumber }, state, workflow: deriveWorkflowSnapshot(state) };
      repository.archive(current);
      repository.write(session);
      return session;
    },

    rename(id, value) {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new InputError('项目ID无效。');
      const name = requiredString(value, '项目名');
      if (name.length > 120) throw new InputError('项目名不能超过120个字符。');
      const current = this.load();
      const active = current?.id === id;
      const source = active ? current : repository.readArchived(id);
      if (!source) throw new InputError('没有找到这个本机项目。');
      const ideaScript = source.state.ideaScript && source.state.workType !== 'series'
        ? { ...source.state.ideaScript, title: name }
        : source.state.ideaScript;
      const session = {
        ...source,
        schemaVersion: 2,
        revision: (source.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        state: { ...source.state, projectName: name, ideaScript },
      };
      repository.archive(session);
      if (active) repository.activate(session);
      return { session, active };
    },
  };
}

export function recoverInterruptedImageState(session, recoveredAt = new Date().toISOString()) {
  if (!session?.state || typeof session.state !== 'object') return session;
  const state = session.state;
  const interruptedFields = [
    ['characterImageStatus', 'characterImageError', '角色图片', '已有角色图和提示词仍保留'],
    ['sceneImageStatus', 'sceneImageError', '场景图片', '已有场景图和提示词仍保留'],
    ['propImageStatus', 'propImageError', '道具图片', '已有道具图和提示词仍保留'],
    ['storyboardBoardStatus', 'storyboardBoardError', '故事板图片', '已有规划、提示词和图片仍保留'],
  ];
  const interrupted = interruptedFields.filter(([statusField]) => state[statusField] === 'running');
  const hasRunningBoards = Array.isArray(state.storyboardBoards) && state.storyboardBoards.some((item) => item?.status === 'running');
  const hasRunningTurnarounds = Array.isArray(state.characterTurnarounds) && state.characterTurnarounds.some((item) => item?.status === 'running');
  const hasRunningSceneViews = Array.isArray(state.sceneViews) && state.sceneViews.some((item) => item?.status === 'running');
  if (interrupted.length === 0 && !hasRunningBoards && !hasRunningTurnarounds && !hasRunningSceneViews) return session;

  const lastKnownAt = optionalBoundedString(session.updatedAt, 100) || '未知时间';
  const diagnostic = (label, preserved) => `${label}任务在本地服务重新载入时仍标记为运行中，已于${recoveredAt}转为明确失败。最后项目更新时间：${lastKnownAt}；任务编号：未取得；${preserved}。系统没有自动重试。`;
  const nextState = { ...state };
  interrupted.forEach(([statusField, errorField, label, preserved]) => {
    nextState[statusField] = 'failed';
    nextState[errorField] = diagnostic(label, preserved);
  });
  if (hasRunningBoards) nextState.storyboardBoards = state.storyboardBoards.map((item) => item?.status === 'running' ? { ...item, status: 'failed', error: diagnostic(`故事板 ${item.segmentKey || item.title || ''}`.trim(), '该段已有图片仍保留') } : item);
  if (hasRunningTurnarounds) nextState.characterTurnarounds = state.characterTurnarounds.map((item) => item?.status === 'running' ? { ...item, status: 'failed', error: diagnostic(`角色三视图 ${item.profileKey || item.name || ''}`.trim(), '角色主图仍保留') } : item);
  if (hasRunningSceneViews) nextState.sceneViews = state.sceneViews.map((item) => item?.status === 'running' ? { ...item, status: 'failed', error: diagnostic(`场景多角度 ${item.sceneAssetKey || item.name || ''}`.trim(), '场景主图仍保留') } : item);

  return {
    ...session,
    revision: Math.max(0, Number(session.revision) || 0) + 1,
    updatedAt: recoveredAt,
    state: nextState,
    workflow: deriveWorkflowSnapshot(nextState, session.workflow, recoveredAt),
  };
}

export function createAssetLibraryStore(options = {}) {
  const filePath = options.filePath ?? resolve(RUNTIME_DATA_ROOT, 'web/asset-library.json');
  const allowedTypes = new Set(['character', 'scene', 'prop', 'style', 'lora', 'text', 'image', 'video', 'audio']);

  function readLibrary() {
    if (!existsSync(filePath)) return { schemaVersion: 1, folders: [], assets: [] };
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      if (saved?.schemaVersion !== 1 || !Array.isArray(saved.assets)) return { schemaVersion: 1, folders: [], assets: [] };
      const folders = Array.isArray(saved.folders)
        ? saved.folders.map((folder) => optionalBoundedString(folder, 200)).filter(Boolean)
        : [];
      saved.assets.forEach((asset) => {
        asset.folder = optionalBoundedString(asset.folder, 200);
        asset.favorite = asset.favorite === true;
        asset.media = asset.media && typeof asset.media === 'object' ? asset.media : {};
        asset.media.referenceImageUrls = Array.isArray(asset.media.referenceImageUrls)
          ? asset.media.referenceImageUrls.map((url) => optionalBoundedString(url, 20_000)).filter(Boolean)
          : [asset.media.mainImageUrl, asset.media.auxiliaryImageUrl].filter(Boolean);
        if (asset.folder && !folders.includes(asset.folder)) folders.push(asset.folder);
      });
      return { schemaVersion: 1, folders, assets: saved.assets };
    } catch {
      return { schemaVersion: 1, folders: [], assets: [] };
    }
  }

  function normalizeFolder(value) {
    return optionalBoundedString(value, 200).trim();
  }

  function ensureFolder(library, value) {
    const folder = normalizeFolder(value);
    if (folder && !library.folders.includes(folder)) library.folders.push(folder);
    return folder;
  }

  function normalizeReferenceImages(media) {
    const explicit = Array.isArray(media?.referenceImageUrls) ? media.referenceImageUrls : [];
    return [...new Set([media?.mainImageUrl, media?.auxiliaryImageUrl, ...explicit]
      .map((url) => optionalBoundedString(url, 20_000)).filter(Boolean))];
  }

  function currentProject(session) {
    if (!session) throw new InputError('请先打开一个项目，再使用跨项目资产库。');
    return { id: session.id, name: projectSummary(session, true).name };
  }

  return {
    list() {
      return readLibrary().assets.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    listFolders() {
      return readLibrary().folders.slice().sort((a, b) => a.localeCompare(b, 'zh-CN'));
    },

    addFolder(input) {
      const library = readLibrary();
      const name = requiredString(input?.name, '文件夹名称').slice(0, 200).trim();
      if (!library.folders.some((folder) => folder.toLocaleLowerCase() === name.toLocaleLowerCase())) library.folders.push(name);
      writeJsonAtomically(filePath, library);
      return name;
    },

    renameFolder(input) {
      const library = readLibrary();
      const currentName = requiredString(input?.currentName, '原文件夹名称').slice(0, 200).trim();
      const nextName = requiredString(input?.nextName, '新文件夹名称').slice(0, 200).trim();
      if (!library.folders.includes(currentName)) throw new InputError('没有找到这个资产文件夹。');
      if (currentName !== nextName && library.folders.some((folder) => folder.toLocaleLowerCase() === nextName.toLocaleLowerCase())) throw new InputError('已经存在同名资产文件夹。');
      library.folders = library.folders.map((folder) => folder === currentName ? nextName : folder);
      library.assets.forEach((asset) => { if (asset.folder === currentName) asset.folder = nextName; });
      writeJsonAtomically(filePath, library);
      return nextName;
    },

    removeFolder(input) {
      const library = readLibrary();
      const name = requiredString(input?.name, '文件夹名称').slice(0, 200).trim();
      if (!library.folders.includes(name)) throw new InputError('没有找到这个资产文件夹。');
      library.folders = library.folders.filter((folder) => folder !== name);
      library.assets.forEach((asset) => { if (asset.folder === name) asset.folder = ''; });
      writeJsonAtomically(filePath, library);
      return name;
    },

    add(input, session) {
      const project = currentProject(session);
      const type = optionalBoundedString(input?.type, 30);
      if (!allowedTypes.has(type)) throw new InputError('资产类型无效。');
      const name = requiredString(input?.name, '资产名称');
      const sourceAssetKey = optionalBoundedString(input?.sourceAssetKey, 500);
      const familyKey = sourceAssetKey ? `${project.id}:${type}:${sourceAssetKey}` : `${project.id}:${type}:${randomUUID()}`;
      const library = readLibrary();
      const version = Math.max(0, ...library.assets.filter((item) => item.familyKey === familyKey).map((item) => Number(item.version) || 0)) + 1;
      const media = {
        mainImageUrl: optionalBoundedString(input?.media?.mainImageUrl, 20_000),
        auxiliaryImageUrl: optionalBoundedString(input?.media?.auxiliaryImageUrl, 20_000),
        videoUrl: optionalBoundedString(input?.media?.videoUrl, 20_000),
        audioUrl: optionalBoundedString(input?.media?.audioUrl, 20_000),
      };
      media.referenceImageUrls = normalizeReferenceImages({ ...input?.media, ...media });
      const modelResource = type === 'lora' ? {
        filePath: requiredString(input?.modelResource?.filePath, 'LoRA本机路径'),
        backend: optionalBoundedString(input?.modelResource?.backend, 200) || 'PRISM H3 / ComfyUI',
        baseModel: optionalBoundedString(input?.modelResource?.baseModel, 500),
        defaultStrength: Math.max(0, Math.min(2, Number(input?.modelResource?.defaultStrength) || 1)),
        sha256: optionalBoundedString(input?.modelResource?.sha256, 200),
        integrationStatus: 'registered_only',
      } : undefined;
      const content = optionalBoundedString(input?.content, 20_000);
      if (['character', 'scene', 'prop', 'style', 'image'].includes(type) && !media.mainImageUrl) throw new InputError('图片资产必须包含主图。');
      if (type === 'video' && !media.videoUrl) throw new InputError('视频资产必须包含可用媒体。');
      if (type === 'audio' && !media.audioUrl) throw new InputError('音频资产必须包含可用媒体。');
      if (type === 'text' && !content.trim()) throw new InputError('文本资产不能为空。');
      const now = new Date().toISOString();
      const asset = {
        id: randomUUID(), familyKey, version, type, name,
        description: optionalBoundedString(input?.description, 20_000),
        content,
        tags: Array.isArray(input?.tags) ? input.tags.slice(0, 20).map((tag) => optionalBoundedString(tag, 100)).filter(Boolean) : [],
        prompt: optionalBoundedString(input?.prompt, 100_000),
        media, modelResource,
        sourceProjectId: project.id, sourceProjectName: project.name, sourceAssetKey,
        folder: ensureFolder(library, input?.folder), favorite: input?.favorite === true,
        status: 'approved', usages: [], createdAt: now, updatedAt: now,
      };
      library.assets.push(asset);
      writeJsonAtomically(filePath, library);
      return asset;
    },

    update(input) {
      const library = readLibrary();
      const asset = library.assets.find((item) => item.id === input?.id);
      if (!asset) throw new InputError('没有找到这个资产。');
      const patch = input?.patch && typeof input.patch === 'object' ? input.patch : {};
      if (Object.hasOwn(patch, 'name')) asset.name = requiredString(patch.name, '资产名称');
      if (Object.hasOwn(patch, 'description')) asset.description = optionalBoundedString(patch.description, 20_000);
      if (Object.hasOwn(patch, 'content')) asset.content = optionalBoundedString(patch.content, 20_000);
      if (Object.hasOwn(patch, 'prompt')) asset.prompt = optionalBoundedString(patch.prompt, 100_000);
      if (Object.hasOwn(patch, 'folder')) asset.folder = ensureFolder(library, patch.folder);
      if (Object.hasOwn(patch, 'favorite')) asset.favorite = patch.favorite === true;
      if (Object.hasOwn(patch, 'tags')) asset.tags = Array.isArray(patch.tags) ? patch.tags.slice(0, 20).map((tag) => optionalBoundedString(tag, 100)).filter(Boolean) : asset.tags;
      if (patch.media && typeof patch.media === 'object') {
        const media = {
          ...asset.media,
          mainImageUrl: Object.hasOwn(patch.media, 'mainImageUrl') ? optionalBoundedString(patch.media.mainImageUrl, 20_000) : asset.media.mainImageUrl,
          auxiliaryImageUrl: Object.hasOwn(patch.media, 'auxiliaryImageUrl') ? optionalBoundedString(patch.media.auxiliaryImageUrl, 20_000) : asset.media.auxiliaryImageUrl,
          videoUrl: Object.hasOwn(patch.media, 'videoUrl') ? optionalBoundedString(patch.media.videoUrl, 20_000) : asset.media.videoUrl,
          audioUrl: Object.hasOwn(patch.media, 'audioUrl') ? optionalBoundedString(patch.media.audioUrl, 20_000) : asset.media.audioUrl,
        };
        media.referenceImageUrls = normalizeReferenceImages({ ...media, referenceImageUrls: patch.media.referenceImageUrls ?? asset.media.referenceImageUrls });
        if (['character', 'scene', 'prop', 'style', 'image'].includes(asset.type) && !media.mainImageUrl) throw new InputError('图片资产必须保留一张主图。');
        asset.media = media;
      }
      asset.updatedAt = new Date().toISOString();
      writeJsonAtomically(filePath, library);
      return asset;
    },

    remove(input) {
      const library = readLibrary();
      const index = library.assets.findIndex((item) => item.id === input?.id);
      if (index < 0) throw new InputError('没有找到这个资产。');
      const asset = library.assets[index];
      if (Array.isArray(asset.usages) && asset.usages.length > 0) throw new InputError('这个资产仍被项目使用，请先解除项目引用。');
      library.assets.splice(index, 1);
      writeJsonAtomically(filePath, library);
      return asset;
    },

    recordUsage(input, session) {
      const project = currentProject(session);
      const library = readLibrary();
      const asset = library.assets.find((item) => item.id === input?.assetId);
      if (!asset) throw new InputError('没有找到这个资产。');
      if (asset.type === 'lora') throw new InputError('LoRA目前只登记，不会在未确认后端兼容性时自动加载。');
      const targetType = optionalBoundedString(input?.targetType, 30);
      if (targetType !== asset.type) throw new InputError('资产类型与目标位置不匹配。');
      const targetKey = requiredString(input?.targetKey, '目标资产ID');
      const usage = { projectId: project.id, projectName: project.name, targetType, targetKey, targetName: optionalBoundedString(input?.targetName, 1_000), appliedAt: new Date().toISOString() };
      asset.usages = Array.isArray(asset.usages) ? asset.usages.filter((item) => !(item.projectId === project.id && item.targetType === targetType && item.targetKey === targetKey)) : [];
      asset.usages.push(usage);
      asset.updatedAt = usage.appliedAt;
      writeJsonAtomically(filePath, library);
      return asset;
    },

    removeUsage(input, session) {
      const project = currentProject(session);
      const library = readLibrary();
      const asset = library.assets.find((item) => item.id === input?.assetId);
      if (!asset) return null;
      const targetType = optionalBoundedString(input?.targetType, 30);
      const targetKey = requiredString(input?.targetKey, '目标资产ID');
      asset.usages = Array.isArray(asset.usages) ? asset.usages.filter((item) => !(item.projectId === project.id && item.targetType === targetType && item.targetKey === targetKey)) : [];
      asset.updatedAt = new Date().toISOString();
      writeJsonAtomically(filePath, library);
      return asset;
    },
  };
}

export function createAssetReplacementUndoStore(options = {}) {
  const filePath = options.filePath ?? resolve(RUNTIME_DATA_ROOT, 'web/asset-library-undo.json');

  function readLedger() {
    if (!existsSync(filePath)) return { schemaVersion: 1, entries: [] };
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      return saved?.schemaVersion === 1 && Array.isArray(saved.entries) ? saved : { schemaVersion: 1, entries: [] };
    } catch {
      return { schemaVersion: 1, entries: [] };
    }
  }

  function publicEntry(entry) {
    if (!entry) return null;
    return { id: entry.id, assetId: entry.assetId, assetName: entry.assetName, targetType: entry.targetType, targetKey: entry.targetKey, targetName: entry.targetName, createdAt: entry.createdAt };
  }

  return {
    create(input, session) {
      if (!session?.id || !session?.state) throw new InputError('当前项目尚未完成保存，不能建立资产替换撤回点。');
      const now = new Date().toISOString();
      const entry = {
        id: randomUUID(), projectId: session.id, assetId: requiredString(input?.assetId, '资产ID'),
        assetName: optionalBoundedString(input?.assetName, 1_000), targetType: requiredString(input?.targetType, '目标类型'),
        targetKey: requiredString(input?.targetKey, '目标资产ID'), targetName: optionalBoundedString(input?.targetName, 1_000),
        createdAt: now, status: 'ready', session: JSON.parse(JSON.stringify(session)),
      };
      const ledger = readLedger();
      ledger.entries.push(entry);
      writeJsonAtomically(filePath, ledger);
      return publicEntry(entry);
    },

    latest(session) {
      if (!session?.id) return null;
      const entry = readLedger().entries.filter((item) => item.projectId === session.id && item.status === 'ready').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      return publicEntry(entry);
    },

    get(input, session) {
      if (!session?.id) throw new InputError('请先打开一个项目。');
      const id = optionalBoundedString(input?.undoId, 100);
      const entry = readLedger().entries.find((item) => item.id === id);
      if (!entry || entry.status !== 'ready') throw new InputError('这次资产替换已经撤回，或撤回记录不存在。');
      if (entry.projectId !== session.id) throw new InputError('撤回记录不属于当前项目。');
      if (!validateSavedSession(entry.session)) throw new InputError('替换前快照已损坏，不能自动恢复。');
      return entry;
    },

    markRestored(id) {
      const ledger = readLedger();
      const entry = ledger.entries.find((item) => item.id === id);
      if (!entry) return;
      entry.status = 'restored';
      entry.restoredAt = new Date().toISOString();
      writeJsonAtomically(filePath, ledger);
    },
  };
}

export function createProviderSettingsStore(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const filePath = options.filePath ?? null;
  const persistence = options.persistence ?? null;
  const generatedImageDirectory = resolve(options.generatedImageDirectory ?? resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'));
  const generatedMusicDirectory = resolve(options.generatedMusicDirectory ?? resolve(RUNTIME_DATA_ROOT, 'generated-audio'));
  const makeAgentProvider = options.agentProviderFactory ?? ((configuration, profile) => new OpenAIResponsesAgentProvider({
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    protocol: configuration.protocol,
    capabilities: configuration.capabilities,
    reasoningEffort: profile.reasoningEffort,
    timeoutMs: profile.timeoutMs ?? 180_000,
    transientRetryCount: TEXT_AGENT_TRANSIENT_RETRY_COUNT,
    retryBaseDelayMs: 1_000,
  }));
  const makeImageProvider = options.imageProviderFactory ?? ((configuration) => new OpenAIImagesProvider({
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    outputDirectory: generatedImageDirectory,
    timeoutMs: 300_000,
  }));
  const makeImageEditProvider = options.imageEditProviderFactory ?? ((configuration) => new OpenAIImagesProvider({
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    outputDirectory: generatedImageDirectory,
    timeoutMs: 300_000,
    referenceEditMode: 'probe',
  }));
  const musicProviderFactory = options.musicProviderFactory ?? ((configuration) => new MiniMaxMusicProvider({
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    outputDirectory: generatedMusicDirectory,
    timeoutMs: 360_000,
    fetchImpl,
  }));
  const scheduler = options.requestScheduler ?? sharedRequestScheduler;
  const agentProviderFactory = (configuration, profile) => scheduledAgent(makeAgentProvider(configuration, profile), scheduler);
  const imageProviderFactory = configuration => scheduledImage(makeImageProvider(configuration), scheduler);
  const imageEditProviderFactory = configuration => scheduledImage(makeImageEditProvider(configuration), scheduler);
  const profilesByKind = new Map();
  const activeProfileIds = new Map();
  const videoConfigurationHistory = new Map();
  const scenePromptGenerationInFlight = new Map();
  const scenePromptGenerationCache = new Map();
  const propPromptGenerationInFlight = new Map();
  const propPromptGenerationCache = new Map();

  async function sharePromptGeneration(inFlight, cache, key, factory) {
    if (cache.has(key)) return cache.get(key);
    let promise = inFlight.get(key);
    if (!promise) {
      promise = Promise.resolve().then(factory);
      inFlight.set(key, promise);
    }
    try {
      const value = await promise;
      cache.set(key, value);
      if (cache.size > 24) cache.delete(cache.keys().next().value);
      return value;
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  }

  if (persistence?.load || (filePath && existsSync(filePath))) {
    try {
      const saved = persistence?.load ? persistence.load() : JSON.parse(readFileSync(filePath, 'utf8'));
      if (saved?.schemaVersion === 2 && Array.isArray(saved.providers)) {
        for (const candidate of saved.videoConfigurationHistory || []) {
          if (!['minimax-video', 'seedance-video'].includes(candidate?.kind) || !candidate.revision) continue;
          videoConfigurationHistory.set(candidate.revision, { ...validateConfiguration(candidate), profileId: candidate.profileId, revision: candidate.revision });
        }
        for (const candidate of saved.providers) {
          const configuration = validateConfiguration(candidate);
          const profileId = optionalBoundedString(candidate?.profileId, 100) || randomUUID();
          const profileName = optionalBoundedString(candidate?.profileName, 80) || configuration.model || '默认模型';
          const profiles = profilesByKind.get(configuration.kind) || new Map();
          const revision = candidate.revision || randomUUID();
          profiles.set(profileId, { ...configuration, profileId, profileName, revision });
          if (['minimax-video', 'seedance-video'].includes(configuration.kind)) videoConfigurationHistory.set(revision, { ...configuration, profileId, revision });
          profilesByKind.set(configuration.kind, profiles);
        }
        for (const [kind, profileId] of Object.entries(saved.activeProfiles || {})) {
          if (ALLOWED_KINDS.has(kind) && profilesByKind.get(kind)?.has(profileId)) activeProfileIds.set(kind, profileId);
        }
      } else if (saved?.schemaVersion === 1 && Array.isArray(saved.providers)) {
        for (const candidate of saved.providers) {
          const configuration = validateConfiguration(candidate);
          const profileId = randomUUID();
          const profileName = configuration.model || '默认模型';
          profilesByKind.set(configuration.kind, new Map([[profileId, { ...configuration, profileId, profileName }]]));
          activeProfileIds.set(configuration.kind, profileId);
        }
      }
    } catch {
      // A damaged private settings file must not prevent the local app starting.
    }
  }

  function persistConfigurations() {
    const payload = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      activeProfiles: Object.fromEntries(activeProfileIds),
      providers: [...profilesByKind.values()].flatMap((profiles) => [...profiles.values()]),
      videoConfigurationHistory: [...videoConfigurationHistory.values()],
    };
    if (persistence?.save) {
      persistence.save(payload);
      return;
    }
    if (filePath) writeJsonAtomically(filePath, payload);
  }

  function activeConfiguration(kind, requestedProfileId) {
    const profiles = profilesByKind.get(kind);
    if (!profiles?.size) return undefined;
    if (requestedProfileId && profiles.has(requestedProfileId)) return profiles.get(requestedProfileId);
    const activeProfileId = activeProfileIds.get(kind);
    return activeProfileId && profiles.has(activeProfileId) ? profiles.get(activeProfileId) : profiles.values().next().value;
  }

  function statusForKind(kind) {
    const profiles = profilesByKind.get(kind) || new Map();
    const active = activeConfiguration(kind);
    return {
      ...publicStatus(kind, active),
      activeProfileId: active?.profileId ?? '',
      profiles: [...profiles.values()].map((configuration) => publicProfile(configuration, configuration.profileId === active?.profileId)),
    };
  }

  return {
    videoConfiguration(kind, profileId, revision) {
      if (!['minimax-video', 'seedance-video'].includes(kind)) throw new InputError('视频接口类型无效。');
      const config = revision ? videoConfigurationHistory.get(revision) : profileId ? profilesByKind.get(kind)?.get(profileId) : activeConfiguration(kind);
      if (!config || config.kind !== kind || (profileId && config.profileId !== profileId)) throw new InputError('没有找到任务绑定的视频接口配置，请在设置中添加该接口。');
      return { ...config };
    },
    status() {
      return [...ALLOWED_KINDS].map((kind) => statusForKind(kind));
    },

    configure(input) {
      const kind = optionalBoundedString(input?.kind, 30);
      const profiles = ALLOWED_KINDS.has(kind) ? profilesByKind.get(kind) || new Map() : new Map();
      const requestedProfileId = optionalBoundedString(input?.profileId, 100);
      const existing = requestedProfileId ? profiles.get(requestedProfileId) : input?.createNew ? undefined : activeConfiguration(kind);
      const current = activeConfiguration(kind);
      if (existing && input.capabilities === undefined) input = { ...input, capabilities: existing.capabilities };
      const credentialSource = existing || (input?.createNew && current && !String(input?.apiKey || '').trim() && normalizeUrl(requiredString(input?.baseUrl, '服务地址'), kind) === current.baseUrl ? current : undefined);
      const configuration = validateConfiguration(credentialSource && !String(input?.apiKey || '').trim()
        ? { ...input, apiKey: credentialSource.apiKey }
        : input);
      const profileId = existing?.profileId || requestedProfileId || randomUUID();
      const profileName = optionalBoundedString(input?.profileName, 80) || existing?.profileName || configuration.model || '默认模型';
      const revision = randomUUID();
      profiles.set(profileId, { ...configuration, profileId, profileName, revision });
      if (['minimax-video', 'seedance-video'].includes(configuration.kind)) videoConfigurationHistory.set(revision, { ...configuration, profileId, revision });
      profilesByKind.set(configuration.kind, profiles);
      activeProfileIds.set(configuration.kind, profileId);
      persistConfigurations();
      return statusForKind(configuration.kind);
    },

    activate(kind, profileId) {
      if (!ALLOWED_KINDS.has(kind) || !profilesByKind.get(kind)?.has(profileId)) throw new InputError('没有找到这个模型配置。');
      activeProfileIds.set(kind, profileId);
      persistConfigurations();
      return statusForKind(kind);
    },

    remove(kind, profileId) {
      if (!ALLOWED_KINDS.has(kind)) throw new InputError('Provider类型无效。');
      const profiles = profilesByKind.get(kind);
      if (!profiles?.has(profileId)) throw new InputError('没有找到这个模型配置。');
      profiles.delete(profileId);
      if (!profiles.size) {
        profilesByKind.delete(kind);
        activeProfileIds.delete(kind);
      } else if (activeProfileIds.get(kind) === profileId) {
        activeProfileIds.set(kind, profiles.keys().next().value);
      }
      persistConfigurations();
      return statusForKind(kind);
    },

    async test(kind, profileId) {
      if (!ALLOWED_KINDS.has(kind)) {
        return result('not_configured', '未知的Provider类型。');
      }

      const configuration = activeConfiguration(kind, profileId);
      if (!configuration) {
        return result('not_configured', '请先填写并应用当前Provider配置。');
      }

      const checkedAt = new Date().toISOString();
      if (['minimax-video', 'seedance-video'].includes(kind)) {
        try { return await new CloudVideoProvider(kind.replace('-video', ''), configuration, { fetchImpl }).health(); }
        catch (error) { return result('down', error instanceof VideoApiError ? error.message : '视频接口查询失败。'); }
      }
      const textProtocol = configuration.kind === 'agent'
        ? resolveTextProviderProtocol(configuration.baseUrl, configuration.model, configuration.protocol)
        : undefined;
      const requestHeaders = configuration.apiKey
        ? textProtocol === 'anthropic-messages'
          ? { 'x-api-key': configuration.apiKey, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${configuration.apiKey}` }
        : undefined;
      const target = configuration.kind === 'h3'
        ? `${configuration.baseUrl}/system_stats`
        : configuration.kind === 'music'
          ? `${configuration.baseUrl}/models`
          : `${configuration.baseUrl}/models/${encodeURIComponent(configuration.model)}`;

      try {
        if (['agent', 'image', 'image-edit'].includes(configuration.kind)) {
          const checked = await probeModelApi({ baseUrl: configuration.baseUrl, model: configuration.model, headers: requestHeaders, fetchImpl });
          if (checked.resolvedBaseUrl && checked.resolvedBaseUrl !== configuration.baseUrl && activeConfiguration(kind, configuration.profileId) === configuration) {
            configuration.baseUrl = checked.resolvedBaseUrl;
            persistConfigurations();
            return { ...checked.health, message: `已识别并保存 API 地址 ${checked.resolvedBaseUrl}。${checked.health.message}`, details: { ...checked.health.details, resolvedBaseUrl: checked.resolvedBaseUrl } };
          }
          return checked.health;
        }
        const response = await fetchImpl(target, {
          headers: requestHeaders,
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          if (!['h3', 'music'].includes(configuration.kind)) return modelMetadataHealth(response, configuration.model);
          return {
            status: 'ok',
            message: configuration.kind === 'h3'
              ? 'PRISM H3本地服务可访问。'
              : configuration.kind === 'music'
                ? `MiniMax官方鉴权接口可访问；本次未调用音乐生成，模型 ${configuration.model} 的实际生成权限尚未验证。`
                : `鉴权成功，模型 ${configuration.model} 可访问。`,
            checkedAt,
          };
        }

        if (response.status === 404 && !['h3', 'music'].includes(configuration.kind)) {
          const modelListResponse = await fetchImpl(`${configuration.baseUrl}/models`, {
            headers: requestHeaders,
            signal: AbortSignal.timeout(30_000),
          });
          if (modelListResponse.ok) {
            return modelMetadataHealth(modelListResponse, configuration.model);
          }
        }

        return {
          status: statusForHttp(response.status),
          message: configuration.kind === 'music' && response.status === 404
            ? 'MiniMax模型列表返回404，请确认Base URL为 https://api.minimaxi.com/v1。'
            : safeHttpMessage(response.status),
          checkedAt,
        };
      } catch (error) {
        return {
          status: 'backend_offline',
          message: safeNetworkMessage(error),
          checkedAt,
        };
      }
    },

    async runIdeaTurn(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateIdeaTurnInput(input);
      const profile = ideaAgentRuntimeProfile(safeInput);
      const provider = agentProviderFactory(configuration, profile);
      return runIdeaAgentTurn(provider, safeInput, { maxOutputTokens: profile.maxOutputTokens });
    },

    async recommendIdeaTones(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateIdeaToneRecommendationInput(input);
      const provider = agentProviderFactory(configuration, { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: 4_000 });
      return recommendCreativeTones(provider, safeInput);
    },

    async runProjectManagerTurn(session, input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      if (!session?.workflow || !session?.state) throw new InputError('请先打开并保存一个项目。');
      const message = requiredString(input?.message, '总管消息');
      if (message.length > 2_000) throw new InputError('总管消息不能超过2000个字符。');
      const history = Array.isArray(input?.history) ? input.history.slice(-12) : [];
      const requestedReasoningEffort = input?.reasoningEffort;
      if (requestedReasoningEffort !== undefined && !PROJECT_MANAGER_REASONING_EFFORTS.includes(requestedReasoningEffort)) {
        throw new InputError('对话推理强度必须是低、中或高。');
      }
      const reasoningEffort = requestedReasoningEffort ?? TEXT_AGENT_REASONING_EFFORT;
      const profile = { reasoningEffort, maxOutputTokens: 16_000 };
      const provider = agentProviderFactory(configuration, profile);
      const context = buildProjectManagerContext(session);
      const turn = await runGlobalManagerTurn(provider, {
        message,
        history,
        context,
      }, { maxOutputTokens: profile.maxOutputTokens });
      return { turn, commands: compileProjectManagerCommands(turn, context) };
    },

    async runNovelAdaptation(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateNovelAdaptationInput(input);
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft,
        ...(safeInput.production.workType === 'series' ? { timeoutMs: 300_000 } : {}) };
      const provider = agentProviderFactory(configuration, profile);
      return safeInput.production.workType === 'series'
        ? adaptNovelToSeriesPlan(provider, safeInput, { maxOutputTokens: profile.maxOutputTokens })
        : adaptNovelToSingleScript(provider, safeInput, { maxOutputTokens: profile.maxOutputTokens });
    },

    async runScriptRevision(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateScriptRevisionInput(input);
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft };
      const provider = agentProviderFactory(configuration, profile);
      return reviseIdeaScript(provider, safeInput);
    },

    async runSeriesEpisodeScript(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft };
      const provider = agentProviderFactory(configuration, profile);
      return generateSeriesEpisodeScript(provider, {
        seriesScript: input?.seriesScript,
        episodeNumber: Number(input?.episodeNumber),
        priorEpisodeScript: input?.priorEpisodeScript ?? null,
        sourceText: input?.sourceText,
      });
    },

    async runFreeCanvasPromptOptimization(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: 12_000 };
      const provider = agentProviderFactory(configuration, profile);
      return optimizeFreeCanvasPrompt(provider, { kind: input?.kind, prompt: input?.prompt, references: input?.references, audioMode: input?.audioMode, textTarget: input?.textTarget });
    },

    async runPromptDirector(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先配置提示词导演自己的文字API。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: 12_000 };
      const provider = agentProviderFactory(configuration, profile);
      return runPromptDirector(provider, input);
    },

    async runFreeCanvasImageGeneration(input) {
      const nodeId = requiredString(input?.nodeId, '自由画布图片节点ID');
      const taskId = requiredString(input?.taskId, '自由画布图片任务ID');
      if (!/^[a-zA-Z0-9._-]{1,240}$/u.test(taskId)) throw new InputError('自由画布图片任务ID无效。');
      const references = Array.isArray(input?.references) ? input.references : [];
      const contractError = referenceInputError({ kind: "image", videoSettings: input?.settings }, references, true);
      if (contractError) throw new InputError(contractError);
      const ownPrompt = String(input?.prompt ?? '').trim();
      const upstreamText = references.map((reference) => String(reference?.content ?? '').trim()).filter(Boolean).join('\n\n');
      const draftPrompt = (ownPrompt || upstreamText).slice(0, 20_000);
      if (!draftPrompt) throw new InputError('请先填写图片提示词，或连接一个包含文字的上游节点。');
      const settings = input?.settings && typeof input.settings === 'object' ? input.settings : {};
      if (!freeCanvasImageSize(settings.width ?? 1536, settings.height ?? 1024)) throw new InputError('自由画布图片尺寸必须使用参数选择器提供的1K、2K或4K规格。');
      const width = Number(settings.width ?? 1536);
      const height = Number(settings.height ?? 1024);
      const quality = String(settings.quality ?? 'high');
      if (!['auto', 'low', 'medium', 'high'].includes(quality)) throw new InputError('自由画布图片画质参数无效。');
      const count = Number(settings.count ?? 1);
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new InputError('自由画布一次只能生成1到4张图片。');
      const outputFormat = String(settings.outputFormat ?? 'png');
      if (!['png', 'webp', 'jpeg'].includes(outputFormat)) throw new InputError('自由画布图片格式只支持PNG、WebP或JPEG。');
      const imageReferences = references.filter((reference) => reference?.kind === 'image' && String(reference?.mediaUrl ?? '').trim());
      let prompt = draftPrompt;
      try {
        prompt = referencePurposeContext(imageReferences) + compileFreeCanvasImageReferenceMentions(draftPrompt, imageReferences.length);
      } catch (cause) {
        throw new InputError(cause instanceof Error ? cause.message : '图片提示词中的参考素材编号无效。');
      }
      const referenceMediaPaths = imageReferences.map((reference) => freeCanvasReferenceMediaPath(String(reference.mediaUrl), 'image', generatedImageDirectory, '自由画布参考图'));
      const configurationKind = referenceMediaPaths.length ? 'image-edit' : 'image';
      const configuration = activeConfiguration(configurationKind);
      if (!configuration) throw new InputError(referenceMediaPaths.length ? '请先在设置中配置参考图编辑。' : '请先在设置中配置图片生成。');
      const imageProvider = referenceMediaPaths.length ? imageEditProviderFactory(configuration) : imageProviderFactory(configuration);
      const sourceEntityIds = [...new Set([nodeId, ...references.map((reference) => String(reference?.id ?? '').trim()).filter(Boolean)])];
      const attempts = await mapImageRequests(Array.from({ length: count }, (_, index) => index), async (index) => {
        try {
          const task = await imageProvider.submit({
            taskId: count === 1 ? taskId : `${taskId}-${String(index + 1).padStart(2, '0')}`,
            prompt,
            sourceEntityIds,
            referenceAssetIds: imageReferences.map((reference) => String(reference.id)),
            referenceAssetVersions: {},
            referenceMediaPaths,
            width,
            height,
            count: 1,
            quality,
            outputFormat,
          });
          if (task.status !== 'awaiting_review' || !task.outputPaths[0]) throw new Error(task.errorMessage || '图片任务返回但没有可用结果。');
          return { status: 'complete', task };
        } catch (error) {
          return { status: 'failed', error };
        }
      });
      const completed = attempts.filter((attempt) => attempt.status === 'complete');
      const failed = attempts.filter((attempt) => attempt.status === 'failed');
      if (!completed.length) throw failed[0].error;
      const warning = failed.length ? `已生成${completed.length}/${count}张；其余${failed.length}张失败且没有自动重试。 ${failed.map((attempt) => safeImageMessage(attempt.error)).join(' ')}` : undefined;
      return {
        taskId,
        provider: completed[0].task.provider,
        status: failed.length ? 'partial' : 'complete',
        imageUrls: completed.flatMap((attempt) => attempt.task.outputPaths.map((outputPath) => `/api/generated-images/${encodeURIComponent(basename(outputPath))}`)),
        ...(warning ? { warning } : {}),
      };
    },

    async runCharacterProfiles(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = { ...validateCharacterProfileInput(input), knownCharacters: options.knownCharacters?.() || [] };
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset };
      const provider = agentProviderFactory(configuration, profile);
      const result = await preserveUsableAssetDraft(() => generateCharacterProfilesWithDirector(provider, safeInput, { reviewMode: input?.reviewMode === 'director' ? 'director' : 'self' }));
      return {
        profiles: result.output.profiles,
        warnings: [...(result.reviewWarning ? [result.reviewWarning] : []), ...localizeCharacterProfileValidationWarnings(validateCharacterProfileDraft(result.output, safeInput), result.output.profiles)],
        supervision: result.supervision,
        ...(result.reviewWarning ? { complete: false, error: result.reviewWarning } : {}),
      };
    },

    async runCharacterImages(input) {
      const agentConfiguration = activeConfiguration('agent');
      const imageConfiguration = activeConfiguration('image');
      if (!agentConfiguration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateCharacterImageInput(input);
      const identityReferences = new Map();
      const editConfiguration = activeConfiguration('image-edit');
      for (const profile of safeInput.characterProfileSet.profiles) {
        const binding = profile.libraryBinding;
        if (binding?.identityImageUrl) {
          if (!editConfiguration) throw new InputError('这个造型需要沿用已有角色形象，请先配置参考图编辑服务。');
          identityReferences.set(profile.profileKey, { path: freeCanvasReferenceMediaPath(binding.identityImageUrl, 'image', generatedImageDirectory, '角色身份参考图'), assetId: binding.identityAssetId || binding.identityId });
        } else if (!imageConfiguration) throw new InputError('请先在设置中配置图片生成。');
      }
      let prompts = validateReusableCharacterPrompts(input?.prompts, safeInput);
      let validationWarnings = [];
      if (!prompts) {
        const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset };
        const agentProvider = agentProviderFactory(agentConfiguration, profile);
        const promptResult = await generateCharacterAssetPrompts(agentProvider, safeInput);
        validationWarnings = localizeAgentDraftValidationWarnings(validateCharacterAssetPromptDraft(promptResult.output, safeInput));
        prompts = promptResult.output.prompts.map((promptDraft, index) => ({
          profileKey: safeInput.characterProfileSet.profiles[index].profileKey,
          name: promptDraft.characterName,
          styleId: input.styleId,
          prompt: compileCharacterAssetPrompt(promptDraft, safeInput),
        }));
      }
      prompts = prompts.map((item) => ({ ...item, generationPreset: safeInput.generationPreset }));
      const requestedProfileKeys = validateRequestedProfileKeys(input?.requestedProfileKeys, prompts);
      const imageProvider = imageConfiguration ? imageProviderFactory(imageConfiguration) : null;
      const editProvider = identityReferences.size ? imageEditProviderFactory(editConfiguration) : null;
      const imageSize = imageRequestSizeForAspectRatio('3:2', safeInput.generationPreset.imageResolution);
      const images = await mapImageRequests(prompts.filter((item) => requestedProfileKeys.has(item.profileKey)), async (savedPrompt) => {
        try {
          const layoutIssues = assetBoardLayoutIssues(savedPrompt.prompt);
          if (layoutIssues.length) throw new InputError(layoutIssues.join(' '));
          const identityReference = identityReferences.get(savedPrompt.profileKey);
          const referencePrefix = '角色资产参考：图片1（锁定人物面部、体型与身份，衣着按当前造型说明绘制）';
          if (identityReference && !savedPrompt.prompt.startsWith(referencePrefix)) savedPrompt.prompt = `${referencePrefix}\n${savedPrompt.prompt}`;
          const task = await (identityReference ? editProvider : imageProvider).submit({
            taskId: `web-character-${savedPrompt.profileKey.toLowerCase()}-${Date.now()}`,
            prompt: savedPrompt.prompt,
            sourceEntityIds: [safeInput.characterProfileSet.id, safeInput.styleSelection.id],
            sourceEntityVersions: { [safeInput.characterProfileSet.id]: safeInput.characterProfileSet.version, [safeInput.styleSelection.id]: safeInput.styleSelection.version },
            referenceAssetIds: identityReference ? [identityReference.assetId] : [], referenceAssetVersions: {}, referenceMediaPaths: identityReference ? [identityReference.path] : [],
            ...imageSize, count: 1, quality: 'high', outputFormat: 'png',
          });
          const outputPath = task.outputPaths?.[0];
          if (!['awaiting_review', 'completed'].includes(task.status) || !outputPath) throw new InputError(task.errorMessage || '角色图片任务未返回可用文件。');
          return { profileKey: savedPrompt.profileKey, name: savedPrompt.name, status: 'complete', generationPreset: safeInput.generationPreset, imageUrl: `/api/generated-images/${encodeURIComponent(basename(outputPath))}` };
        } catch (error) {
          return { profileKey: savedPrompt.profileKey, name: savedPrompt.name, status: 'failed', generationPreset: safeInput.generationPreset, error: error instanceof InputError ? error.message : safeImageMessage(error) };
        }
      });
      return { images, prompts, validationWarnings };
    },

    async runCharacterDesignRevision(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const currentPrompt = requiredString(input?.currentPrompt, '当前角色图片提示词');
      const revisionRequest = requiredString(input?.revisionRequest, '人物修改要求');
      if (revisionRequest.length > 4_000) throw new InputError('人物修改要求不能超过4000字。');
      const safeInput = validateCharacterImageInput({
        profiles: [input?.profile],
        styleId: input?.styleId,
        generationPreset: input?.generationPreset,
      });
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: 16_000 };
      const provider = agentProviderFactory(configuration, profile);
      const revised = await reviseCharacterDesign(provider, {
        profile: safeInput.characterProfileSet.profiles[0],
        currentPrompt,
        revisionRequest,
        styleName: safeInput.styleSelection.name,
      });
      const { id: _id, ...revisedProfile } = revised.profile;
      return {
        profile: revisedProfile,
        prompt: {
          profileKey: revisedProfile.profileKey,
          name: revisedProfile.name,
          styleId: safeInput.generationPreset.styleId,
          generationPreset: safeInput.generationPreset,
          prompt: applyGenerationPresetToPrompt(sanitizeProductionPrompt(revised.prompt), safeInput.generationPreset),
        },
      };
    },

    async runCharacterTurnaround(input) {
      const configuration = activeConfiguration('image-edit');
      if (!configuration) throw new InputError('请先在设置中配置参考图编辑。');
      const profileKey = requiredString(input?.profileKey, '角色ID');
      const name = requiredString(input?.name, '角色名');
      const imageUrl = requiredString(input?.imageUrl, '角色主图');
      const mediaPath = generatedImagePath(imageUrl, generatedImageDirectory, '角色主图');
      const timestamp = new Date().toISOString();
      const mainAsset = {
        id: `web-character-main-${profileKey.toLowerCase()}`, version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'approved',
        kind: 'character', name, description: `${name}人物主资产`, promptAnchor: '当前本机项目已批准角色主图', mediaPaths: [mediaPath],
        sourceEntityIds: [`web-profile-${profileKey.toLowerCase()}`], characterProfileId: `web-profile-${profileKey.toLowerCase()}`, presentation: 'main-card',
      };
      const request = buildCharacterTurnaroundRequest({
        taskId: `web-character-turnaround-${profileKey.toLowerCase()}-${Date.now()}`,
        mainAsset,
        mainAssetReviewDecisions: [{ id: `web-review-${profileKey.toLowerCase()}`, entityId: mainAsset.id, entityVersion: 1, action: 'approve', createdAt: timestamp }],
        referenceEditMode: 'probe',
      });
      try {
        const task = await imageEditProviderFactory(configuration).submit(request);
        return { profileKey, name, status: 'complete', imageUrl: `/api/generated-images/${encodeURIComponent(basename(task.outputPaths[0]))}` };
      } catch (error) {
        return { profileKey, name, status: 'failed', error: safeImageMessage(error) };
      }
    },

    async runSceneProposals(input) {
      const safeInput = validateSceneGenerationInput(input);
      if (typeof input?.returnedDraft === 'string') {
        const returnedDraft = input.returnedDraft.slice(0, 200_000);
        let parsed;
        try {
          const trimmed = returnedDraft.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
          parsed = JSON.parse(trimmed);
        } catch {
          throw new ReturnedAgentDraftValidationError('修改后的正文仍不是有效的JSON结构。', returnedDraft, ['正文无法解析为JSON。请检查多余说明文字、引号、逗号、括号和代码块边界。']);
        }
        try {
          const accepted = acceptSceneVisualProposalModelOutput(parsed, safeInput);
          return {
            proposals: accepted.proposals,
            warnings: localizeAgentDraftValidationWarnings(validateSceneVisualProposalDraft(accepted, safeInput)),
          };
        } catch (error) {
          if (error instanceof SceneAssetPromptValidationError) {
            throw new ReturnedAgentDraftValidationError('修改后的正文仍未通过场景提案校验。', returnedDraft, localizeStructuredAgentValidationIssues('场景视觉提案', error.issues));
          }
          throw error;
        }
      }
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset, timeoutMs: 360_000 };
      const result = await preserveUsableAssetDraft(() => generateSceneVisualProposalsWithDirector(agentProviderFactory(configuration, profile), safeInput, { reviewMode: input?.reviewMode === 'director' ? 'director' : 'self' }));
      const finalDirectorReview = result.supervision.directorReviews.at(-1);
      const directorNotes = finalDirectorReview?.revisionInstructions?.length
        ? [`总导演建议在后续分镜中继续明确：${finalDirectorReview.revisionInstructions.join('；')}`]
        : finalDirectorReview?.decision === 'revise'
          ? [`场景提案已保留并进入用户确认；后续分镜需结合总导演意见继续明确：${finalDirectorReview.summary}`]
          : [];
      return {
        proposals: result.output.proposals,
        warnings: [...(result.reviewWarning ? [result.reviewWarning] : []), ...directorNotes, ...localizeAgentDraftValidationWarnings(validateSceneVisualProposalDraft(result.output, safeInput))],
        supervision: result.supervision,
        ...(result.reviewWarning ? { complete: false, error: result.reviewWarning } : {}),
      };
    },

    async runSceneImages(input) {
      const agentConfiguration = activeConfiguration('agent');
      const imageConfiguration = activeConfiguration('image');
      if (!imageConfiguration) throw new InputError('请先在设置中配置图片生成。');
      const safeInput = validateSceneGenerationInput(input);
      const proposals = validateSceneProposals(input?.proposals);
      let prompts = validateReusableScenePrompts(input?.prompts, proposals, input.styleId);
      let validationWarnings = [];
      if (!prompts) {
        if (!agentConfiguration) throw new InputError('请先在设置中配置文字Agent。');
        const promptKey = JSON.stringify({ scriptId: safeInput.script.id, scriptVersion: safeInput.script.version, styleId: input.styleId, proposals });
        prompts = await sharePromptGeneration(scenePromptGenerationInFlight, scenePromptGenerationCache, promptKey, async () => {
          const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset };
          const generated = await generateScenePromptsFromProposals(agentProviderFactory(agentConfiguration, profile), { ...safeInput, proposals });
          validationWarnings = localizeAgentDraftValidationWarnings(validateSceneAssetPromptDraft(generated.output, { ...safeInput, proposals }));
          return generated.output.prompts.map((draft) => ({
            sceneAssetKey: draft.sceneAssetKey,
            name: draft.name,
            styleId: input.styleId,
            prompt: compileSceneAssetPrompt(draft, safeInput),
          }));
        });
      }
      prompts = prompts.map((item) => ({ ...item, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(item.prompt, safeInput.generationPreset) }));
      const requestedSceneKeys = validateRequestedSceneKeys(input?.requestedSceneKeys, prompts);
      const imageProvider = imageProviderFactory(imageConfiguration);
      const imageSize = imageRequestSizeForAspectRatio(safeInput.generationPreset.aspectRatio, safeInput.generationPreset.imageResolution);
      const images = await mapImageRequests(prompts.filter((item) => requestedSceneKeys.has(item.sceneAssetKey)), async (savedPrompt) => {
        try {
          const task = await imageProvider.submit({
            taskId: `web-scene-${savedPrompt.sceneAssetKey.toLowerCase()}-${Date.now()}`,
            prompt: savedPrompt.prompt,
            sourceEntityIds: [safeInput.script.id, safeInput.styleSelection.id],
            sourceEntityVersions: { [safeInput.script.id]: safeInput.script.version, [safeInput.styleSelection.id]: safeInput.styleSelection.version },
            referenceAssetIds: [], referenceAssetVersions: {}, referenceMediaPaths: [],
            ...imageSize, count: 1, quality: 'high', outputFormat: 'png',
          });
          return { sceneAssetKey: savedPrompt.sceneAssetKey, name: savedPrompt.name, status: 'complete', generationPreset: safeInput.generationPreset, imageUrl: `/api/generated-images/${encodeURIComponent(basename(task.outputPaths[0]))}` };
        } catch (error) {
          return { sceneAssetKey: savedPrompt.sceneAssetKey, name: savedPrompt.name, status: 'failed', generationPreset: safeInput.generationPreset, error: safeImageMessage(error) };
        }
      });
      return { prompts, images, validationWarnings };
    },

    async runSceneView(input) {
      const configuration = activeConfiguration('image-edit');
      if (!configuration) throw new InputError('请先在设置中配置参考图编辑。');
      const sceneAssetKey = requiredString(input?.sceneAssetKey, '场景ID');
      const name = requiredString(input?.name, '场景名');
      const imageUrl = requiredString(input?.imageUrl, '场景主图');
      const filename = decodeURIComponent(imageUrl.replace(/^\/api\/generated-images\//, ''));
      if (imageUrl === filename || basename(filename) !== filename || !/\.(png|webp|jpe?g)$/i.test(filename)) throw new InputError('场景主图地址无效。');
      const mediaPath = resolve(generatedImageDirectory, filename);
      if (dirname(mediaPath) !== generatedImageDirectory || !existsSync(mediaPath)) throw new InputError('没有找到场景主图文件。');
      const fixedLandmarks = Array.isArray(input?.fixedLandmarks) ? input.fixedLandmarks.map((item) => requiredString(item, '固定地标')) : [];
      const spatialLayout = requiredString(input?.spatialLayout, '空间布局');
      const timestamp = new Date().toISOString();
      const mainAsset = {
        id: `web-scene-main-${sceneAssetKey.toLowerCase()}`, version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'draft',
        kind: 'scene', name, description: `${name}场景主资产`, promptAnchor: '当前卡片已有可用场景主图', mediaPaths: [mediaPath],
        sourceEntityIds: ['web-approved-script'],
      };
      const request = buildSceneViewRequest({
        taskId: `web-scene-view-${sceneAssetKey.toLowerCase()}-${Date.now()}`,
        mainAsset,
        referenceEditMode: 'probe', fixedLandmarks, spatialLayout,
      });
      try {
        const task = await imageEditProviderFactory(configuration).submit(request);
        return { sceneAssetKey, name, status: 'complete', imageUrl: `/api/generated-images/${encodeURIComponent(basename(task.outputPaths[0]))}` };
      } catch (error) {
        if (error instanceof OpenAIImagesProviderError && error.code === 'image_count_mismatch' && Array.isArray(error.diagnostics?.outputPaths) && error.diagnostics.outputPaths.length > 1) {
          return { sceneAssetKey, name, status: 'needs_selection', imageUrls: error.diagnostics.outputPaths.map((outputPath) => `/api/generated-images/${encodeURIComponent(basename(outputPath))}`), error: '上游返回了多张有效候选图，请选择一张作为当前多角度资产；请求数量参数仍记为不一致。' };
        }
        return { sceneAssetKey, name, status: 'failed', error: safeImageMessage(error) };
      }
    },

    recoverSceneViewCandidates(input) {
      const sceneAssetKey = requiredString(input?.sceneAssetKey, '场景ID');
      const name = requiredString(input?.name, '场景名');
      const prefix = `web-scene-view-${sceneAssetKey.toLowerCase()}-`;
      const matches = existsSync(generatedImageDirectory)
        ? readdirSync(generatedImageDirectory).filter((filename) => filename.startsWith(prefix) && /-[0-9]{2}\.(png|webp|jpe?g)$/i.test(filename))
        : [];
      const grouped = new Map();
      for (const filename of matches) {
        const taskPrefix = filename.replace(/-[0-9]{2}\.(png|webp|jpe?g)$/i, '');
        if (!grouped.has(taskPrefix)) grouped.set(taskPrefix, []);
        grouped.get(taskPrefix).push(filename);
      }
      const latest = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a))[0];
      if (!latest || latest[1].length < 2) throw new InputError('没有找到本次已保留的多角度候选图。');
      return { sceneAssetKey, name, status: 'needs_selection', imageUrls: latest[1].sort().map((filename) => `/api/generated-images/${encodeURIComponent(filename)}`), error: '已读取上游额外返回并保留的候选图；请选择一张作为当前多角度资产。' };
    },

    async runPropProposals(input) {
      const safeInput = validatePropGenerationInput(input);
      if (typeof input?.returnedDraft === 'string') {
        const returnedDraft = input.returnedDraft.slice(0, 200_000);
        let parsed;
        try {
          const trimmed = returnedDraft.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
          parsed = JSON.parse(trimmed);
        } catch {
          throw new ReturnedAgentDraftValidationError('修改后的正文仍不是有效的JSON结构。', returnedDraft, ['正文无法解析为JSON。请检查多余说明文字、引号、逗号、括号和代码块边界。']);
        }
        try {
          const accepted = acceptReturnedPropVisualProposalDraft(parsed, safeInput);
          return {
            proposals: accepted.proposals,
            warnings: localizeAgentDraftValidationWarnings(validatePropVisualProposalDraft(accepted, safeInput)),
          };
        } catch (error) {
          if (error instanceof PropAssetPromptValidationError) {
            throw new ReturnedAgentDraftValidationError('修改后的正文仍未通过道具提案校验。', returnedDraft, localizeStructuredAgentValidationIssues('道具视觉提案', error.issues));
          }
          throw error;
        }
      }
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset, timeoutMs: 360_000 };
      const result = await preserveUsableAssetDraft(() => generatePropVisualProposalsWithDirector(agentProviderFactory(configuration, profile), safeInput, { reviewMode: input?.reviewMode === 'director' ? 'director' : 'self' }));
      const finalDirectorReview = result.supervision.directorReviews.at(-1);
      const directorNotes = finalDirectorReview?.revisionInstructions?.length
        ? [`总导演建议在后续分镜中继续明确：${finalDirectorReview.revisionInstructions.join('；')}`]
        : finalDirectorReview?.decision === 'revise'
          ? [`道具提案已保留并进入用户确认；后续分镜需结合总导演意见继续明确：${finalDirectorReview.summary}`]
          : [];
      return {
        proposals: result.output.proposals,
        warnings: [...(result.reviewWarning ? [result.reviewWarning] : []), ...directorNotes, ...localizeAgentDraftValidationWarnings(validatePropVisualProposalDraft(result.output, safeInput))],
        supervision: result.supervision,
        ...(result.reviewWarning ? { complete: false, error: result.reviewWarning } : {}),
      };
    },

    async runPropImages(input) {
      const imageConfiguration = activeConfiguration('image');
      if (!imageConfiguration) throw new InputError('请先在设置中配置图片生成。');
      const safeInput = validatePropGenerationInput(input);
      const proposals = validatePropProposals(input?.proposals);
      const requestedPropKeys = validateRequestedPropKeys(input?.requestedPropKeys, proposals);
      const requestedProposals = proposals.filter((proposal) => requestedPropKeys.has(proposal.propAssetKey));
      let prompts = validateReusablePropPrompts(input?.prompts, proposals, input.styleId);
      const reusablePromptKeys = new Set(prompts.map((prompt) => prompt.propAssetKey));
      const missingPromptProposals = requestedProposals.filter((proposal) => !reusablePromptKeys.has(proposal.propAssetKey));
      let validationWarnings = [];
      if (missingPromptProposals.length > 0) {
        const configuration = activeConfiguration('agent');
        if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
        const promptKey = JSON.stringify({ scriptId: safeInput.script.id, scriptVersion: safeInput.script.version, styleId: input.styleId, proposals: missingPromptProposals });
        const generatedPrompts = await sharePromptGeneration(propPromptGenerationInFlight, propPromptGenerationCache, promptKey, async () => {
          const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.structuredAsset };
          const generated = await generatePropPromptsFromProposals(agentProviderFactory(configuration, profile), { ...safeInput, proposals: missingPromptProposals });
          const requiredProps = missingPromptProposals.map((proposal) => ({ propAssetKey: proposal.propAssetKey, canonicalName: proposal.name, aliases: proposal.aliases, requiredStateKeys: proposal.stateVariants.map((variant) => variant.stateKey) }));
          validationWarnings = localizeAgentDraftValidationWarnings(validatePropAssetPromptDraft(generated.output, { ...safeInput, requiredProps }));
          return generated.output.prompts.map((draft) => ({ propAssetKey: draft.propAssetKey, name: draft.name, styleId: input.styleId, prompt: compilePropAssetPrompt(draft, { ...safeInput, requiredProps }) }));
        });
        prompts = [...prompts, ...generatedPrompts];
      }
      prompts = prompts.map((item) => ({ ...item, generationPreset: safeInput.generationPreset }));
      const imageProvider = imageProviderFactory(imageConfiguration);
      const imageSize = imageRequestSizeForAspectRatio('3:2', safeInput.generationPreset.imageResolution);
      const images = await mapImageRequests(prompts.filter((item) => requestedPropKeys.has(item.propAssetKey)), async (savedPrompt) => {
        try {
          const layoutIssues = assetBoardLayoutIssues(savedPrompt.prompt, '道具');
          if (layoutIssues.length) throw new InputError(layoutIssues.join(' '));
          const task = await imageProvider.submit({ taskId: `web-prop-${savedPrompt.propAssetKey.toLowerCase()}-${Date.now()}`, prompt: savedPrompt.prompt, sourceEntityIds: [safeInput.script.id, safeInput.styleSelection.id], sourceEntityVersions: { [safeInput.script.id]: safeInput.script.version, [safeInput.styleSelection.id]: safeInput.styleSelection.version }, referenceAssetIds: [], referenceAssetVersions: {}, referenceMediaPaths: [], ...imageSize, count: 1, quality: 'high', outputFormat: 'png' });
          return { propAssetKey: savedPrompt.propAssetKey, name: savedPrompt.name, status: 'complete', generationPreset: safeInput.generationPreset, imageUrl: `/api/generated-images/${encodeURIComponent(basename(task.outputPaths[0]))}` };
        } catch (error) {
          return { propAssetKey: savedPrompt.propAssetKey, name: savedPrompt.name, status: 'failed', generationPreset: safeInput.generationPreset, error: error instanceof InputError ? error.message : safeImageMessage(error) };
        }
      });
      return { prompts, images, validationWarnings };
    },

    async runPropDesignRevision(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const currentPrompt = requiredString(input?.currentPrompt, '当前道具图片提示词');
      const revisionRequest = requiredString(input?.revisionRequest, '道具修改要求');
      if (revisionRequest.length > 4_000) throw new InputError('道具修改要求不能超过4000字。');
      const safeInput = validatePropGenerationInput(input);
      const proposal = validatePropProposals([input?.proposal])[0];
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: 16_000 };
      const provider = agentProviderFactory(configuration, profile);
      const revised = await revisePropDesign(provider, {
        proposal,
        currentPrompt,
        revisionRequest,
        styleName: safeInput.styleSelection.name,
      });
      return {
        proposal: revised.proposal,
        prompt: {
          propAssetKey: revised.proposal.propAssetKey,
          name: revised.proposal.name,
          styleId: safeInput.generationPreset.styleId,
          generationPreset: safeInput.generationPreset,
          prompt: applyGenerationPresetToPrompt(sanitizeProductionPrompt(revised.prompt), safeInput.generationPreset),
        },
      };
    },

    async runStoryboardSegments(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateStoryboardGenerationInput(input, generatedImageDirectory);
      const profile = {
        reasoningEffort: STORYBOARD_TEXT_REASONING_EFFORT,
        maxOutputTokens: TEXT_TOKEN_BUDGETS.storyboardSegments,
        timeoutMs: 360_000,
      };
      let saved;
      if (input?.repairOnly) {
        if (typeof input.returnedDraft !== 'string' || !input.returnedDraft.trim()) throw new InputError('当前项目没有保存可修复草稿，请使用生成文字分镜建立初稿。');
        saved = { ...parseStructuredOutput(input.returnedDraft), repairOnly: true };
      }
      return generateStoryboardPromptsBySegment(agentProviderFactory(configuration, profile), { ...safeInput, concurrency: sharedRequestScheduler.status().limits.textConcurrency }, saved);
    },

    async runStoryboardBoardPlans(input) {
      const safeInput = validateStoryboardGenerationInput(input, generatedImageDirectory);
      const segments = validateStoryboardSegments(input?.segments, safeInput);
      const allPlanInputs = buildWebStoryboardPlanInputs(segments, safeInput);
      const reusable = validateReusableStoryboardBoards(input?.plans, input?.prompts, segments, allPlanInputs, safeInput.assets);
      let plans = reusable?.plans ?? [];
      let prompts = reusable?.prompts ?? [];
      const plannedKeys = new Set(plans.map((item) => item.segmentKey));
      const requested = validateRequestedStoryboardKeys(input?.requestedSegmentKeys, segments);
      const missingPlanInputs = allPlanInputs.filter((item) => requested.has(item.segment.segmentKey) && !plannedKeys.has(item.segment.segmentKey));
      const validationErrors = [];
      const validationWarnings = [];
      if (missingPlanInputs.length > 0) {
        let generated;
        if (typeof input?.returnedDraft === 'string' && input.returnedDraft.trim()) {
          const returnedDraft = input.returnedDraft.slice(0, 200_000);
          try {
            const parsed = parseStructuredOutput(returnedDraft);
            generated = acceptStoryboardBoardBatchPartial(parsed, missingPlanInputs);
          } catch (error) {
            throw new ReturnedAgentDraftValidationError('已返回的故事板内容仍无法在本机恢复。', returnedDraft, [safeUnknownAgentErrorDetail(error)]);
          }
        } else {
          const configuration = activeConfiguration('agent');
          if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
          const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction, timeoutMs: 360_000 };
          const partials = await mapWithConcurrencyOrdered(missingPlanInputs, sharedRequestScheduler.status().limits.textConcurrency, async (planInput) => {
            try {
              const item = await generateStoryboardBoardBatchPartial(agentProviderFactory(configuration, profile), [planInput]);
              const accepted = item.output.items.map(entry => ({ segmentKey: entry.segmentKey, plan: entry.plan, generationPreset: safeInput.generationPreset }));
              const text = item.output.items.map(entry => ({ segmentKey: entry.segmentKey, title: segments.find(segment => segment.segmentKey === entry.segmentKey)?.title || entry.segmentKey, panelCount: entry.plan.panelCount, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(compileStoryboardBoardPromptForPlan(planInput, entry.plan, safeInput.assets), safeInput.generationPreset) }));
              productionCheckpoint({ plans: accepted, prompts: text });
              return item;
            } catch (error) {
              const diagnostic = preserveAgentFailureDiagnostic(error, options.agentDiagnosticDirectory);
              return { output: { items: [] }, validationErrors: [{ segmentKey: planInput.segment.segmentKey, message: safeIdeaAgentMessage(error), messageLocalized: true, ...diagnostic }] };
            }
          });
          generated = { output: { items: partials.flatMap(item => item.output.items) }, validationErrors: partials.flatMap(item => item.validationErrors) };
        }
        validationWarnings.push(...generated.output.items.flatMap((item) => localizeAgentDraftValidationWarnings(item.validationWarnings).map((message) => ({ segmentKey: item.segmentKey, message }))));
        plans = [...plans, ...generated.output.items.map((item) => ({ segmentKey: item.segmentKey, plan: item.plan, generationPreset: safeInput.generationPreset }))];
        prompts = [...prompts, ...generated.output.items.map((item) => {
          const planInput = missingPlanInputs.find((candidate) => candidate.segment.segmentKey === item.segmentKey);
          const segment = segments.find((candidate) => candidate.segmentKey === item.segmentKey);
          return { segmentKey: item.segmentKey, title: segment?.title || item.segmentKey, panelCount: item.plan.panelCount, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(compileStoryboardBoardPromptForPlan(planInput, item.plan, safeInput.assets), safeInput.generationPreset) };
        })];
        validationErrors.push(...generated.validationErrors.map((item) => ({
          segmentKey: item.segmentKey,
          message: item.messageLocalized ? item.message : safeIdeaAgentMessage(new Error(item.message)),
          ...(item.diagnosticId ? { diagnosticId: item.diagnosticId } : {}),
          ...(item.diagnosticSaveError ? { diagnosticSaveError: item.diagnosticSaveError } : {}),
        })));
      }
      plans = segments.map((segment) => plans.find((item) => item.segmentKey === segment.segmentKey)).filter(Boolean).map((item) => ({ ...item, generationPreset: safeInput.generationPreset }));
      prompts = segments.map((segment) => prompts.find((item) => item.segmentKey === segment.segmentKey)).filter(Boolean).map((item) => ({ ...item, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(item.prompt, safeInput.generationPreset) }));
      return {
        plans,
        prompts,
        validationErrors,
        validationWarnings,
        error: validationErrors.length
          ? `${validationErrors.length}段${safeInput.panelCount}宫格规划未完成；具体原因见对应分段错误。其他合格规划和提示词已保留。`
          : '',
      };
    },

    async runStoryboardBoards(input) {
      const imageConfiguration = activeConfiguration('image-edit');
      if (!imageConfiguration) throw new InputError('请先在设置中配置参考图编辑。');
      const safeInput = validateStoryboardGenerationInput(input, generatedImageDirectory);
      const segments = validateStoryboardSegments(input?.segments, safeInput);
      const allPlanInputs = buildWebStoryboardPlanInputs(segments, safeInput);
      const reusable = validateReusableStoryboardBoards(input?.plans, input?.prompts, segments, allPlanInputs, safeInput.assets);
      let plans = reusable?.plans ?? [];
      let prompts = reusable?.prompts ?? [];
      const planningFailures = [];
      const validationWarnings = [];
      const plannedKeys = new Set(plans.map((item) => item.segmentKey));
      const missingPlanInputs = allPlanInputs.filter((item) => !plannedKeys.has(item.segment.segmentKey));
      if (missingPlanInputs.length > 0) {
        const configuration = activeConfiguration('agent');
        if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
        const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction, timeoutMs: 360_000 };
        const parts = await mapWithConcurrencyOrdered(missingPlanInputs, sharedRequestScheduler.status().limits.textConcurrency, async (item) => {
          try { return await generateStoryboardBoardBatchPartial(agentProviderFactory(configuration, profile), [item]); }
          catch (error) { return { output: { items: [] }, validationErrors: [{ segmentKey: item.segment.segmentKey, message: safeIdeaAgentMessage(error) }] }; }
        });
        const generated = { output: { items: parts.flatMap(item => item.output.items) }, validationErrors: parts.flatMap(item => item.validationErrors) };
        validationWarnings.push(...generated.output.items.flatMap((item) => localizeAgentDraftValidationWarnings(item.validationWarnings).map((message) => ({ segmentKey: item.segmentKey, message }))));
        plans = [...plans, ...generated.output.items.map((item) => ({ segmentKey: item.segmentKey, plan: item.plan, generationPreset: safeInput.generationPreset }))];
        prompts = [...prompts, ...generated.output.items.map((item) => {
          const planInput = missingPlanInputs.find((candidate) => candidate.segment.segmentKey === item.segmentKey);
          const segment = segments.find((candidate) => candidate.segmentKey === item.segmentKey);
          return { segmentKey: item.segmentKey, title: segment?.title || item.segmentKey, panelCount: item.plan.panelCount, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(compileStoryboardBoardPromptForPlan(planInput, item.plan, safeInput.assets), safeInput.generationPreset) };
        })];
        planningFailures.push(...generated.validationErrors.map((item) => {
          const segment = segments.find((candidate) => candidate.segmentKey === item.segmentKey);
          return { segmentKey: item.segmentKey, title: segment?.title || item.segmentKey, status: 'failed', error: safeIdeaAgentMessage(new Error(item.message)) };
        }));
      }
      plans = segments.map((segment) => plans.find((item) => item.segmentKey === segment.segmentKey)).filter(Boolean).map((item) => ({ ...item, generationPreset: safeInput.generationPreset }));
      prompts = segments.map((segment) => prompts.find((item) => item.segmentKey === segment.segmentKey)).filter(Boolean).map((item) => ({ ...item, generationPreset: safeInput.generationPreset, prompt: applyGenerationPresetToPrompt(item.prompt, safeInput.generationPreset) }));
      const requested = validateRequestedStoryboardKeys(input?.requestedSegmentKeys, segments);
      const imageProvider = imageEditProviderFactory(imageConfiguration);
      const imageSize = imageRequestSizeForAspectRatio(safeInput.generationPreset.aspectRatio, safeInput.generationPreset.imageResolution);
      const requestedPrompts = prompts.filter((item) => requested.has(item.segmentKey));
      const boards = await mapImageRequests(requestedPrompts, async (savedPrompt) => {
        const segment = segments.find((item) => item.segmentKey === savedPrompt.segmentKey);
        const plan = plans.find((item) => item.segmentKey === savedPrompt.segmentKey)?.plan;
        if (!segment || !plan) throw new InputError('分镜提示词与画格规划不一致。');
        const referenceAssets = selectStoryboardReferenceAssets(segment, plan, safeInput.assets);
        if (referenceAssets.length === 0) {
          return { segmentKey: segment.segmentKey, title: segment.title, status: 'failed', error: '本段没有可用的已批准参考资产。' };
        }
        const referenceMediaPaths = referenceAssets.map((asset) => safeInput.assetMediaPaths[asset.assetId]).filter(Boolean);
        try {
          const task = await imageProvider.submit({
            taskId: `web-storyboard-${segment.segmentKey.toLowerCase()}-${Date.now()}`,
            targetKeys: [segment.segmentKey],
            prompt: savedPrompt.prompt,
            sourceEntityIds: [safeInput.script.id, safeInput.styleSelection.id],
            sourceEntityVersions: { [safeInput.script.id]: safeInput.script.version, [safeInput.styleSelection.id]: safeInput.styleSelection.version },
            referenceAssetIds: referenceAssets.map((asset) => asset.assetId),
            referenceAssetVersions: Object.fromEntries(referenceAssets.map((asset) => [asset.assetId, asset.version])),
            referenceMediaPaths,
            ...imageSize, count: 1, quality: 'high', outputFormat: 'png',
          });
          return { segmentKey: segment.segmentKey, title: segment.title, status: 'complete', generationPreset: safeInput.generationPreset, imageUrl: `/api/generated-images/${encodeURIComponent(basename(task.outputPaths[0]))}`, referenceAssetIds: referenceAssets.map((asset) => asset.assetId), referenceLabels: referenceAssets.map((asset) => asset.label) };
        } catch (error) {
          if (error instanceof OpenAIImagesProviderError && error.code === 'image_count_mismatch' && Array.isArray(error.diagnostics?.outputPaths) && error.diagnostics.outputPaths.length > 1) {
            return { segmentKey: segment.segmentKey, title: segment.title, status: 'needs_selection', imageUrls: error.diagnostics.outputPaths.map((outputPath) => `/api/generated-images/${encodeURIComponent(basename(outputPath))}`), referenceAssetIds: referenceAssets.map((asset) => asset.assetId), referenceLabels: referenceAssets.map((asset) => asset.label), error: `上游返回多张有效${safeInput.panelCount}宫格，请选择一张作为本段故事板。` };
          }
          return { segmentKey: segment.segmentKey, title: segment.title, status: 'failed', error: safeImageMessage(error) };
        }
      });
      const returnedBoards = segments.map((segment) => planningFailures.find((item) => item.segmentKey === segment.segmentKey) ?? boards.find((item) => item.segmentKey === segment.segmentKey)).filter(Boolean);
      return { plans, prompts, boards: returnedBoards, validationWarnings };
    },

    async runVideoPrompts(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateStoryboardGenerationInput(input, generatedImageDirectory);
      const segments = validateStoryboardSegments(input?.segments, safeInput);
      const boardPlans = validateVideoPromptBoardPlans(input?.plans, segments.filter(segment => validateRequestedVideoPromptKeys(input?.requestedSegmentKeys ?? (input?.segmentKey ? [input.segmentKey] : undefined), segments).has(segment.segmentKey)), safeInput.panelCount);
      const storyboardBoards = validateOptionalStoryboardBoards(input?.boards, segments, generatedImageDirectory);
      const requested = validateRequestedVideoPromptKeys(input?.requestedSegmentKeys, segments);
      const requestedSegments = segments.filter((segment) => requested.has(segment.segmentKey));
      const imageErrors = [];
      const videoInputs = buildWebVideoPromptInputs(requestedSegments, boardPlans, segments, safeInput, storyboardBoards, input).filter(videoInput => {
        try { attachStoryboardVideoImage(videoInput, generatedImageDirectory); return true; }
        catch (error) { imageErrors.push({ segmentKey: videoInput.segment.segmentKey, message: error.message }); return false; }
      });
      const profile = { reasoningEffort: 'medium', maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction, timeoutMs: 360_000 };
      const batches = [];
      for (let index = 0; index < videoInputs.length; index += VIDEO_PROMPT_BATCH_SIZE) batches.push(videoInputs.slice(index, index + VIDEO_PROMPT_BATCH_SIZE));
      const initialBatchResults = await mapWithConcurrencyOrdered(batches, VIDEO_PROMPT_CONCURRENCY, async (batchInputs) => {
        try {
          const provider = agentProviderFactory(configuration, profile);
          const generated = await provider.generate(buildEpisodeVideoPromptBatchRequest(batchInputs));
          const checked = normalizeAndValidateVideoPromptBatchItems(generated.output, batchInputs);
          return { inputs: batchInputs, items: checked.items, revisions: checked.revisions, errors: checked.errors };
        } catch (error) {
          return {
            inputs: batchInputs,
            items: [], revisions: [],
            errors: [{ segmentKey: batchInputs.map((item) => item.segment.segmentKey).join('/'), message: safeIdeaAgentMessage(error) }],
          };
        }
      });
      const repairJobs = (input?.autoRepair === true ? initialBatchResults : []).flatMap((batch, batchIndex) => batch.revisions.map((revision) => ({
        batchIndex,
        input: batch.inputs.find((candidate) => candidate.segment.segmentKey === revision.segmentKey),
        revision,
        repairSource: {
          plan: revision.plan,
          validationCodes: revision.validationCodes,
          validationIssues: revision.validationIssues,
        },
      })).filter((item) => item.input));
      const repairResults = await mapWithConcurrencyOrdered(repairJobs, VIDEO_PROMPT_REPAIR_CONCURRENCY, async (job) => {
        try {
          const provider = agentProviderFactory(configuration, profile);
          const repaired = await provider.generate(buildEpisodeVideoPromptRepairRequest([{
            input: job.input,
            draft: job.revision.plan,
            validationCodes: job.revision.validationCodes,
            validationIssues: job.revision.validationIssues,
          }]));
          const repairedOutput = normalizeSingleVideoPromptRepairOutput(repaired.output, job.revision.segmentKey);
          const checked = normalizeAndValidateVideoPromptBatchItems(repairedOutput, [job.input], { acceptPacingWarnings: true });
          return { ...job, checked };
        } catch (error) {
          return { ...job, error: safeIdeaAgentMessage(error) };
        }
      });
      const batchResults = initialBatchResults.map((batch, batchIndex) => {
        const currentRepairs = repairResults.filter((item) => item.batchIndex === batchIndex);
        const repairedKeys = new Set(currentRepairs.map((item) => item.revision.segmentKey));
        const items = [...batch.items];
        const revisions = batch.revisions.filter((item) => !repairedKeys.has(item.segmentKey));
        const errors = [...batch.errors];
        for (const repair of currentRepairs) {
          if (repair.error) {
            revisions.push({ ...repair.revision, repairAttempted: true, repairSource: repair.repairSource });
            errors.push({ segmentKey: repair.revision.segmentKey, message: `逐段审校请求没有完成：${repair.error}` });
            continue;
          }
          const repairedItem = repair.checked.items[0];
          const repairedRevision = repair.checked.revisions[0];
          if (repairedItem) items.push({ ...repairedItem, repairAttempted: true, repairSource: repair.repairSource });
          else if (repairedRevision) revisions.push({ ...repairedRevision, repairAttempted: true, repairSource: repair.repairSource });
          else revisions.push({ ...repair.revision, repairAttempted: true, repairSource: repair.repairSource });
          errors.push(...repair.checked.errors);
        }
        return { inputs: batch.inputs, items, revisions, errors, repairCalls: currentRepairs.length };
      });
      const prompts = [];
      for (const batch of batchResults) {
        [...batch.items.map((item) => ({ ...item, status: 'complete' })), ...batch.revisions.map((item) => ({ ...item, status: 'needs_revision' }))].forEach((item) => {
          const videoInput = batch.inputs.find((candidate) => candidate.segment.segmentKey === item.segmentKey);
          const segment = requestedSegments.find((candidate) => candidate.segmentKey === item.segmentKey);
          if (!segment || !videoInput) return;
          const references = resolveVideoPromptReferences(item.plan, segment, { ...input, panelCount: safeInput.panelCount, boards: storyboardBoards });
          prompts.push({
            segmentKey: segment.segmentKey,
            title: segment.title,
            durationSec: segment.durationSec,
            status: item.status,
            prompt: compileVideoPromptForDelivery(item, videoInput, references.labels.join('、'), safeInput.generationPreset),
            generationPreset: safeInput.generationPreset,
            referenceLabels: references.labels,
            referenceImageUrls: references.imageUrls,
            referenceLayoutVersion: 2,
            storyboardReference: videoInput.storyboardReference,
            storyboardVisionVersion: videoInput.storyboardImage ? 1 : undefined,
            plan: item.plan,
            validationIssues: item.validationIssues,
            validationCodes: item.validationCodes,
            validationWarnings: item.validationWarnings,
            validationWarningCodes: item.validationWarningCodes,
            repairAttempted: item.repairAttempted === true,
            repairSourcePrompt: item.repairSource?.plan ? safeCompileVideoPromptDraft(item.repairSource.plan, references.labels.join('、')) : undefined,
            repairSourceValidationIssues: item.repairSource?.validationIssues,
            repairSourceValidationCodes: item.repairSource?.validationCodes,
            error: item.status === 'needs_revision' ? `${item.repairAttempted ? '完成一次自动校正后仍' : ''}需要修改：${item.validationIssues.join('；')}。Agent草稿已保留，可直接打开修改。` : undefined,
          });
        });
      }
      const revisions = batchResults.flatMap((batch) => batch.revisions);
      const errors = [...imageErrors, ...batchResults.flatMap((batch) => batch.errors)];
      const repairCalls = batchResults.reduce((total, batch) => total + batch.repairCalls, 0);
      return {
        prompts,
        requestSummary: { initialCalls: batchResults.length, repairCalls, totalCalls: batchResults.length + repairCalls },
        error: [
          revisions.length ? `${revisions.length}段${revisions.some((item) => item.repairAttempted) ? '完成一次自动校正后仍' : '已返回草稿但'}需要修改：${revisions.map((item) => `${item.segmentKey}（${item.validationIssues.join('；')}）`).join('；')}` : '',
          errors.length ? `${errors.length}段或批次没有可读取草稿：${errors.map((item) => `${item.segmentKey}：${item.message}`).join('；')}` : '',
        ].filter(Boolean).join('。'),
      };
    },

    async repairVideoPrompt(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const safeInput = validateStoryboardGenerationInput(input, generatedImageDirectory);
      const segments = validateStoryboardSegments(input?.segments, safeInput);
      const boardPlans = validateVideoPromptBoardPlans(input?.plans, segments.filter(segment => validateRequestedVideoPromptKeys(input?.requestedSegmentKeys ?? (input?.segmentKey ? [input.segmentKey] : undefined), segments).has(segment.segmentKey)), safeInput.panelCount);
      const storyboardBoards = validateOptionalStoryboardBoards(input?.boards, segments, generatedImageDirectory);
      const segmentKey = typeof input?.segmentKey === 'string' ? input.segmentKey.trim() : '';
      const requested = validateRequestedVideoPromptKeys([segmentKey], segments);
      const segment = segments.find((candidate) => requested.has(candidate.segmentKey));
      const currentPrompt = typeof input?.currentPrompt === 'string' ? input.currentPrompt.trim() : '';
      const draft = input?.draft && typeof input.draft === 'object' ? input.draft : currentPrompt ? { shotExecution: currentPrompt } : undefined;
      const validationCodes = Array.isArray(input?.validationCodes) ? input.validationCodes.map((item) => String(item)).filter(Boolean) : [];
      const validationIssues = Array.isArray(input?.validationIssues) ? input.validationIssues.map((item) => String(item)).filter(Boolean) : [];
      if (currentPrompt && !validationIssues.length) validationIssues.push('请对照已批准剧本和分镜检查当前正文，修正本段未完成项并保留正确内容。');
      if (currentPrompt && !validationCodes.length) validationCodes.push('manual_draft_review');
      if (!segment || !draft || typeof draft !== 'object' || validationCodes.length === 0 || validationIssues.length === 0) {
        throw new InputError('当前分镜缺少可修复草稿或具体校验问题。');
      }
      const [videoInput] = buildWebVideoPromptInputs([segment], boardPlans, segments, safeInput, storyboardBoards, input);
      attachStoryboardVideoImage(videoInput, generatedImageDirectory);
      if (currentPrompt) videoInput.currentDraft = currentPrompt;
      const profile = { reasoningEffort: 'medium', maxOutputTokens: TEXT_TOKEN_BUDGETS.batchProduction, timeoutMs: 360_000 };
      const provider = agentProviderFactory(configuration, profile);
      const repaired = await provider.generate(buildEpisodeVideoPromptRepairRequest([{ input: videoInput, draft, validationCodes, validationIssues }]));
      const repairOutput = normalizeSingleVideoPromptRepairOutput(repaired.output, segment.segmentKey);
      const checked = normalizeAndValidateVideoPromptBatchItems(repairOutput, [videoInput], { acceptPacingWarnings: true });
      const item = checked.items[0] ? { ...checked.items[0], status: 'complete' } : checked.revisions[0] ? { ...checked.revisions[0], status: 'needs_revision' } : null;
      if (!item) throw new Error(checked.errors[0]?.message || 'Agent没有返回可读取的修复草稿。');
      const references = resolveVideoPromptReferences(item.plan, segment, { ...input, panelCount: safeInput.panelCount, boards: storyboardBoards });
      const prompt = {
        segmentKey: segment.segmentKey,
        title: segment.title,
        durationSec: segment.durationSec,
        status: item.status,
        prompt: compileVideoPromptForDelivery(item, videoInput, references.labels.join('、'), safeInput.generationPreset),
        generationPreset: safeInput.generationPreset,
        referenceLabels: references.labels,
        referenceImageUrls: references.imageUrls,
        referenceLayoutVersion: 2,
        storyboardReference: videoInput.storyboardReference,
        storyboardVisionVersion: videoInput.storyboardImage ? 1 : undefined,
        plan: item.plan,
        validationIssues: item.validationIssues,
        validationCodes: item.validationCodes,
        validationWarnings: item.validationWarnings,
        validationWarningCodes: item.validationWarningCodes,
        repairAttempted: true,
        repairSourcePrompt: currentPrompt || safeCompileVideoPromptDraft(draft, references.labels.join('、')),
        repairSourceValidationIssues: validationIssues,
        repairSourceValidationCodes: validationCodes,
        error: item.status === 'needs_revision' ? `仍需修改：${item.validationIssues.join('；')}。最新Agent草稿已保留，可继续修复或手动编辑。` : undefined,
      };
      return { prompt, requestSummary: { initialCalls: 0, repairCalls: 1, totalCalls: 1 }, error: prompt.error || '' };
    },

    async runMusicPromptPlan(input) {
      const configuration = activeConfiguration('agent');
      if (!configuration) throw new InputError('请先在设置中配置文字Agent。');
      const profile = { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft };
      const provider = agentProviderFactory(configuration, profile);
      const first = await provider.generate(buildMusicPromptRequest(input, { maxOutputTokens: profile.maxOutputTokens }));
      try {
        const plan = validateMusicPromptPlan(first.output, input);
        return {
          status: 'complete',
          plan,
          validationWarnings: localizeMusicPromptValidationIssues(collectMusicPromptValidationWarnings(first.output, input)),
          repairAttempted: false,
          requestSummary: { initialCalls: 1, repairCalls: 0, totalCalls: 1 },
        };
      } catch (error) {
        if (!(error instanceof MusicPromptValidationError)) throw error;
        const firstIssues = localizeMusicPromptValidationIssues(error.issues);
        if (input?.autoRepair !== true) {
          const plan = editableMusicPromptDraft(error.draft ?? first.output);
          if (!plan) throw error;
          return { status: 'needs_revision', plan, validationIssues: firstIssues, repairAttempted: false,
            requestSummary: { initialCalls: 1, repairCalls: 0, totalCalls: 1 } };
        }
        const repaired = await provider.generate(buildMusicPromptRepairRequest(input, {
          draft: error.draft ?? first.output,
          validationIssues: firstIssues,
        }, { maxOutputTokens: profile.maxOutputTokens }));
        try {
          const plan = validateMusicPromptPlan(repaired.output, input);
          return {
            status: 'complete',
            plan,
            validationWarnings: localizeMusicPromptValidationIssues(collectMusicPromptValidationWarnings(repaired.output, input)),
            repairAttempted: true,
            repairedIssues: firstIssues,
            requestSummary: { initialCalls: 1, repairCalls: 1, totalCalls: 2 },
          };
        } catch (repairError) {
          if (!(repairError instanceof MusicPromptValidationError)) throw repairError;
          const plan = editableMusicPromptDraft(repairError.draft ?? repaired.output)
            ?? editableMusicPromptDraft(error.draft ?? first.output);
          if (!plan) throw repairError;
          const validationIssues = localizeMusicPromptValidationIssues(repairError.issues);
          return {
            status: 'needs_revision',
            plan,
            validationIssues,
            repairAttempted: true,
            repairedIssues: firstIssues,
            requestSummary: { initialCalls: 1, repairCalls: 1, totalCalls: 2 },
          };
        }
      }
    },

    async runMusicGeneration(input) {
      const configuration = activeConfiguration('music');
      if (!configuration) throw new InputError('请先在设置中配置MiniMax Music。');
      return musicProviderFactory(configuration).submit(input);
    },
  };
}

export function normalizeSingleVideoPromptRepairOutput(output, segmentKey) {
  if (Array.isArray(output?.items)) return output;
  if (output?.item && typeof output.item === 'object') return { items: [output.item] };
  if (output?.plan && typeof output.plan === 'object') {
    return { items: [{ segmentKey: typeof output.segmentKey === 'string' ? output.segmentKey : segmentKey, plan: output.plan }] };
  }
  if (output?.videoPromptSections && typeof output.videoPromptSections === 'object') {
    return { items: [{ segmentKey, plan: output }] };
  }
  const error = new Error('Agent returned a video prompt repair without a readable plan.');
  Object.defineProperty(error, 'diagnostics', { value: { invalidDraft: output }, enumerable: false });
  throw error;
}

function compileVideoPromptForDelivery(item, input, references, preset) {
  const prompt = item.status === 'complete' ? compileSegmentVideoPrompt(input, item.plan, references) : safeCompileVideoPromptDraft(item.plan, references);
  return prompt?.trim() ? applyGenerationPresetToPrompt(withStoryboardVideoGuide(prompt, input.storyboardReference, item.plan), preset) : '';
}

function safeCompileVideoPromptDraft(plan, referenceLabel) {
  try {
    return compileSegmentVideoPromptDraft(plan, referenceLabel);
  } catch {
    return undefined;
  }
}

export function normalizeAndValidateVideoPromptBatchItems(output, batchInputs, options = {}) {
  if (!Array.isArray(output?.items) || output.items.length !== batchInputs.length) {
    throw new Error(`Expected ${batchInputs.length} episode video prompt items.`);
  }
  const items = [];
  const revisions = [];
  const errors = [];
  batchInputs.forEach((input, index) => {
    const expectedKey = input.segment.segmentKey;
    const item = output.items[index];
    try {
      if (item?.segmentKey !== expectedKey || !item?.plan) {
        throw new Error(`Episode video prompt item ${index + 1} must be ${expectedKey}.`);
      }
      const normalized = { ...item, plan: normalizeSegmentVideoPromptBookkeeping(item.plan, input) };
      try {
        const warningCodes = validateSegmentVideoPromptPlan(normalized.plan, input);
        items.push({
          ...normalized,
          validationWarnings: localizeVideoPromptValidationIssues(warningCodes),
          validationWarningCodes: warningCodes,
        });
      } catch (error) {
        if (!(error instanceof SegmentVideoPromptValidationError)) throw error;
        revisions.push({ ...normalized, validationIssues: localizeVideoPromptValidationIssues(error.issues), validationCodes: error.issues });
      }
    } catch (error) {
      const wrapped = new Error(`${expectedKey} ${error instanceof Error ? error.message : String(error)}`);
      if (item?.segmentKey === expectedKey && item?.plan && typeof item.plan === 'object') {
        revisions.push({
          segmentKey: expectedKey,
          plan: item.plan,
          validationCodes: ['agent_draft_structure_invalid'],
          validationIssues: [`Agent草稿结构不完整：${safeUnknownAgentErrorDetail(error)}`],
        });
      } else {
        errors.push({ segmentKey: expectedKey, message: safeIdeaAgentMessage(wrapped) });
      }
    }
  });
  return { items, revisions, errors };
}

export function localizeVideoPromptValidationIssues(issues) {
  return [...new Set((Array.isArray(issues) ? issues : []).map((issue) => {
    const value = String(issue);
    if (/agent_draft_structure_invalid/i.test(value)) return 'Agent草稿缺少可读取的必要结构，需要Agent补全后再校验';
    const beat = value.match(/timeline beat (\d+)/i)?.[1];
    const owner = value.match(/must name action owner (.+)$/i)?.[1];
    const transitionText = value.match(/required transition text:\s*(.+)$/i)?.[1];
    if (/segment key mismatch/i.test(value)) return '分段编号与当前卡片不一致';
    if (/duration mismatch/i.test(value)) return '分段时长与当前项目设定不一致';
    if (/storyboard board availability/i.test(value)) return '故事板参考图使用状态不一致';
    if (/character reference/i.test(value)) return '人物参考与已确认分镜不一致';
    if (/scene reference/i.test(value)) return '场景参考与已确认分镜不一致';
    if (/prop reference/i.test(value)) return '道具参考与已确认分镜不一致';
    if (/cover panel keys exactly once and in order/i.test(value)) return '时间线没有按P01至P06顺序完整覆盖且各出现一次';
    if (/must not merge panels across a shot cut/i.test(value)) return `第${beat || '?'}个时间段跨越了必须切镜的位置`;
    if (/time range mismatch|must end at segment duration/i.test(value)) return `第${beat || '末尾'}个时间段的起止时间不连续`;
    if (/shot group mismatch|cut contract mismatch/i.test(value)) return `第${beat || '?'}个时间段的镜头分组或切镜原因不一致`;
    if (/start state mismatch|end state mismatch|does not continue/i.test(value)) return `第${beat || '?'}个时间段的开始或结束状态接不上`;
    if (/action units mismatch/i.test(value)) return `第${beat || '?'}个时间段漏写或重复了行动单元`;
    if (owner) return `第${beat || '?'}个时间段没有明确写出动作执行者“${owner}”`;
    if (/must not expose internal bookkeeping fields/i.test(value)) return `第${beat || '?'}个时间段混入了P、SH、AU或英文账本字段；正文只保留自然中文镜头执行`;
    if (/execution must not repeat its time range/i.test(value)) return `第${beat || '?'}个时间段在正文里重复写了起止秒数；时间范围由系统统一生成`;
    if (/duplicates a sentence from timeline beat/i.test(value)) return `第${beat || '?'}个时间段重复了前面已经写过的完整句子；请只写本时段的新变化`;
    if (/repeats an action completed in timeline beat/i.test(value)) return `第${beat || '?'}个时间段重新执行了前面已经完成的动作；请改为保持结果或开始下一动作`;
    if (/dialogue .* exceeds its available speaking time/i.test(value)) return `第${beat || '?'}个时间段的对白按正常语速说不完；请提前开始对白、扩大该时间段或减少同段动作`;
    if (/shot execution must preserve dialogue/i.test(value)) return `没有逐字保留对白${value.match(/dialogue\s+([^;]+)/i)?.[1] ? `（${value.match(/dialogue\s+([^;]+)/i)[1]}）` : ''}`;
    if (/must explicitly have no lip movement/i.test(value)) return '内心声或画外音没有明确写出人物嘴唇闭合、无口型';
    if (/internal monologue must be an audible inner voice/i.test(value)) return '内心独白没有明确写成可听见的内心声';
    if (/voiceover must be presented as off-screen voice/i.test(value)) return '画外音没有明确写成画外声音';
    if (/must not use speaking lip action/i.test(value)) return '内心声或画外音误写成了人物开口说话';
    if (/4-6 second.*3 to 5 timeline beats|timeline beats count mismatch/i.test(value)) return '4至6秒镜头需要合并为3至5个时间段';
    if (transitionText) return `片尾转场缺少指定文字“${transitionText}”`;
    if (/render the required on-screen text/i.test(value)) return '片尾要求有屏幕文字，但执行时间线没有明确呈现';
    if (/preserve the required fade or black frame/i.test(value)) return '片尾要求渐黑或黑场，但执行时间线没有落实';
    if (/negative terms must not forbid required on-screen text/i.test(value)) return '负面词误把本段必须出现的片尾文字禁止了';
    if (/sound policy must not repeat dialogue/i.test(value)) return '声音总则重复了逐字对白，对白应只放在对应时间段';
    if (/sound policy must not contain timed events/i.test(value)) return '声音总则写入了具体时间事件，应移到对应时间段';
    if (/silent video sound policy must explicitly require zero human voice/i.test(value)) return '无语言镜头的声音总则没有明确全片零人声';
    if (/silent video sound policy must not introduce human voice ambience/i.test(value)) return '无语言镜头的声音总则包含交谈、笑声、广播或其他人声环境';
    if (/silent video positive prompt must not contain quoted or slogan-like text/i.test(value)) return '无语言镜头出现了引号、宣传语或可朗读总结；请改写为可见动作、物体状态、光线或最终构图';
    if (/all video prompt sections are required/i.test(value)) return '五段式提示词存在空白必填部分';
    if (/negative terms must contain 5 to 8 items/i.test(value)) return '负面词需要保留5至8项最高风险问题';
    if (/execution is required/i.test(value)) return `第${beat || '?'}个时间段缺少动作、镜头与同步声音说明`;
    return `结构校验项：${value.slice(0, 180)}`;
  }).filter(Boolean))];
}

export function localizeCharacterProfileValidationWarnings(issues, profiles = []) {
  const grouped = new Map();
  const fallback = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const value = String(issue || '');
    const match = value.match(/^profile (\d+) (.*)$/i);
    if (!match) { fallback.push(value); continue; }
    const name = profiles[Number(match[1]) - 1]?.name || `人物 ${match[1]}`;
    const details = grouped.get(name) || new Set();
    const reason = match[2];
    const scene = reason.match(/scene (S\d+)/i)?.[1];
    if (/evidence is not verbatim/i.test(reason)) details.add(`${scene || '对应场次'}的引用未匹配剧本原句`);
    else if (/references unknown evidence ID/i.test(reason)) details.add('所选原文编号不存在，需要重新绑定剧本依据');
    else if (/references unknown scene|sourceSceneKeys contain an unknown scene/i.test(reason)) details.add(`${scene || '所标场次'}不在当前剧本中`);
    else if (/requires at least one source fact/i.test(reason)) details.add('尚未提供支持人物设定的剧本引用');
    else if (/has an incomplete source fact/i.test(reason)) details.add('有一条依据缺少设定说明或引用原文');
    else if (/sourceSceneKeys/i.test(reason)) details.add('引用所标场次与人物出场场次列表不一致');
    else if (/has no current script character occurrence/i.test(reason)) details.add('当前剧本正文未找到此人物名称，请确认是否保留档案');
    else { fallback.push(value); continue; }
    grouped.set(name, details);
  }
  return [...grouped].map(([name, details]) => `${name}：${[...details].join('；')}。`).concat(localizeAgentDraftValidationWarnings(fallback));
}

function upgradeStoredCharacterValidationError(input) {
  const original = upgradeStoredAgentValidationError(input.characterError, '角色');
  const legacy = /^(?:第\d+项的剧本依据索引不完整；人物设定已保留，可继续审核，系统不会因此卡住角色阶段。[；\s]*)+$/u;
  if (!legacy.test(original) || !Array.isArray(input.characterProfiles) || !input.ideaScript) return original;
  try {
    const warnings = validateCharacterProfileDraft({ profiles: input.characterProfiles }, {
      script: toApprovedDomainScript(input.ideaScript),
      requiredCharacterNames: input.characterProfiles.map(profile => profile.name),
    });
    const currentNames = new Set(selectEpisodeCharacters(input.ideaScript).map(character => character.name));
    input.characterProfiles.forEach((profile, index) => {
      if (!currentNames.has(profile.name)) warnings.push(`profile ${index + 1} has no current script character occurrence`);
    });
    return localizeCharacterProfileValidationWarnings(warnings, input.characterProfiles).join('\n');
  } catch { return original; }
}

export function localizeAgentDraftValidationWarnings(issues) {
  return [...new Set((Array.isArray(issues) ? issues : []).map((issue) => {
    const value = String(issue || '');
    const position = value.match(/(?:profile|prompt|proposal) (\d+)/i)?.[1];
    if (/source mapping/i.test(value)) return `${position ? `第${position}项` : '当前道具'}的剧本场次归属需要确认；文字设定已保留，其他道具可以继续制作。`;
    if (/requires at least one source fact|requires sourceSceneKeys|evidence is not verbatim|references unknown scene|has an incomplete source fact|sourceSceneKeys (?:must be unique|contain an unknown scene|must follow script order|must match its evidence scenes)/i.test(value)) return `${position ? `第${position}项` : '当前角色'}的剧本依据索引不完整；人物设定已保留，可继续审核，系统不会因此卡住角色阶段。`;
    if (/negative terms must contain 5 to 8 items|negativeTerms must contain 5 to 8 items/i.test(value)) return `${position ? `第${position}项` : '当前提示词'}的负面词数量不是建议的5至8项；不会阻断，可在提交生图前按需精简。`;
    if (/incomplete visual design proposal/i.test(value)) return `${position ? `第${position}项` : '当前草稿'}的视觉设计细节不够完整；核心事实已保留，可继续审核或补充外形、材质、光色与空间细节。`;
    if (/requires concise storyboard text/i.test(value)) return `${value.match(/SEG\d{3}/i)?.[0] || '当前分镜'}文字较长；内容已经保留，可在确认前按需精简。`;
    if (/4-6 second storyboard may use at most two shot groups/i.test(value)) return '短分镜的切镜数量偏多；不会阻断，请人工确认节奏是否过碎。';
    if (/4-6 second.*3 to 5 timeline beats|timeline beats count mismatch/i.test(value)) return '短视频的时间段数量偏离3至5段建议；对白、动作和总时长有效时仍可继续。';
    if (/dialogue .* exceeds its available speaking time/i.test(value)) return '按常规语速估算对白较紧；原对白和时间线已经保留，请人工确认语速或调整该段时长。';
    if (/must not expose internal bookkeeping fields/i.test(value)) return '镜头正文带有少量制作账本标记；不会影响事实绑定，可在最终提交前删去P、SH或AU字段。';
    if (/execution must not repeat its time range/i.test(value)) return '镜头正文重复写了秒数；时间线仍有效，可在最终提交前精简。';
    if (/duplicates a sentence|repeats an action completed/i.test(value)) return '镜头执行存在重复表达；不会阻断，请人工确认是否需要精简。';
    if (/sound policy must not contain timed events/i.test(value)) return '声音总则写入了具体时点；不会阻断，可将该事件移到对应时间段。';
    return `可继续使用的质量建议：${value.slice(0, 180)}`;
  }).filter(Boolean))];
}

export function localizeStructuredAgentValidationIssues(stage, issues) {
  return [...new Set((Array.isArray(issues) ? issues : []).map((issue) => {
    const value = String(issue || '');
    if (stage === '文字分镜' && /[\u4e00-\u9fff]/u.test(value)) return value.slice(0, 2000);
    const itemNumber = value.match(/(?:profile|prompt|proposal|segment|item) (\d+)/i)?.[1];
    const segmentKey = value.match(/SEG\d{3}/i)?.[0]?.toUpperCase();
    const target = segmentKey || (itemNumber ? `第${itemNumber}项` : '当前草稿');
    if (/must be an object|must be an array|requires .* title and text|missing required introduction fields|incomplete prompt sections|incomplete visual design proposal/i.test(value)) return `${target}缺少必填结构或正文；请补齐该项要求的字段后再保存。`;
    if (/cover every|required .* exactly once|must exactly cover|count must match|expected \d+ (?:items|panels)|segments must contain exactly|proposal count|prompt sections must match/i.test(value)) return `返回数量或覆盖范围与本次任务不一致；请只返回本次要求的全部项目，每项一次，不增不漏。`;
    if (/profileKey|promptKey|sceneAssetKey|propAssetKey|identity\/order mismatch|must be SEG\d+|must match SEG\d+ plan|must use R\d+|must use promptKey|segmentKey must remain/i.test(value)) return `${target}的稳定ID或顺序被改动；请原样保留输入中的ID并按输入顺序返回。`;
    if (/evidence is not verbatim|source evidence is not verbatim|invalid source evidence|invalid state evidence|source facts|sourceFacts|story evidence|evidenceId|evidence catalog|evidence must be covered|unknown evidence|evidence .* kind|evidence .* scene/i.test(value)) return `${target}的剧本依据无法回查；请引用对应场次中真实存在的原文，并保持证据ID与场次一致。`;
    if (/unknown scene|unbound scene|valid ordered source scenes|sourceSceneKeys|source scenes exactly once and in order/i.test(value)) return `${target}的场次归属无法对应当前剧本；请检查场次ID和基础场次。`;
    if (/baseStateSceneKey|earliest base scene|requires a base state|base state/i.test(value)) return `${target}的基础状态不完整；请把最早出现的绑定场次设为基础状态，并写清当时可见状态。`;
    if (/selected invalid state-variant evidence IDs/i.test(value)) return `${target}的状态变化引用了其他场次或不存在的证据；请改用该状态实际发生场次中的证据ID。`;
    if (/has an invalid state variant/i.test(value)) return `${target}把基础场次、重复场次或未绑定场次写成了后续状态；只有同一地点在后续场次确实变化时才保留该项。`;
    if (/state variant|required states|stateVariants|state evidence|invalid state variant/i.test(value)) return `${target}的状态变化与剧本证据不一致；请按实际发生变化的场次补齐状态、场次和原文依据。`;
    if (/preserve dialogue|dialogue speaker|dialogue evidence/i.test(value)) return `${target}改动、遗漏或错配了对白；请逐字保留已批准对白，并绑定正确说话人和时间顺序。`;
    if (/character asset|scene asset|prop asset|referenceAssetIds|requires character|requires scene|requires prop|reference character|reference prop/i.test(value)) return `${target}引用了未批准、缺失或本段不可见的资产；请只选择本段实际需要且已批准的角色、场景和道具。`;
    if (/final transition|required transition|on-screen text|fade or black frame/i.test(value)) return `${target}的结尾转场或画面文字与剧本要求不一致；请原样保留已批准的结尾状态。`;
    if (/time range|panel timeline|duration mismatch|time boundary changed/i.test(value)) return `${target}的时间线不连续或改变了已确认时长；请从0秒连续排到本段结束，不能重叠、留空或改总时长。`;
    if (/visible shot content|atomic action states|action owner|action units|start state|same shot group|new shot group|concrete cut trigger|execute .* again|completes .* more than once/i.test(value)) return `${target}的动作主体、前后状态或切镜因果不完整；请写清“谁做什么、产生什么可见结果”，并让相邻画格连续。`;
    if (/semanticDecision|imagePromptSections|referenceRequirements|prompt sections|content layout/i.test(value)) return `${target}缺少故事板语义、参考要求或图片提示词结构；请补齐本段可见人物道具、画格布局和五段式提示词。`;
    if (/fixedLandmarks/i.test(value)) return `${target}的固定地标信息不足；请补充可在多角度中稳定复用的空间锚点。`;
    if (/positive instrumental-only language|instrumental must be true/i.test(value)) return `配乐方案包含人声概念或未启用纯器乐；请删除人声、歌词、对白和旁白词汇，并保持纯器乐开关开启。`;
    if (/cues must cover every segment|segmentKey must remain|time boundary changed|cue .* invalid|cue content is incomplete|energy is invalid/i.test(value)) return `配乐节点没有按粗剪完整覆盖；请保留每个SEG的原编号、顺序和时间边界，并补齐能量、配器与混音说明。`;
    return `${target}有一项${stage || '当前阶段'}必填内容无法安全确认；请按输入中的已批准事实补齐，不要改动ID、顺序或原文。`;
  }).filter(Boolean))];
}

export function ideaAgentRuntimeProfile(input) {
  const thirdRoundOrScript = input?.forceScript === true || (Array.isArray(input?.answers) && input.answers.length >= 2);
  return thirdRoundOrScript
    ? { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.formalDraft }
    : { reasoningEffort: TEXT_AGENT_REASONING_EFFORT, maxOutputTokens: TEXT_TOKEN_BUDGETS.directionQuestion };
}

export async function launchPrismH3Console(options = {}) {
  const executable = resolve(options.executablePath ?? process.env.PRISM_H3_CONSOLE_EXE ?? 'E:/Apps/PRISM H3 控制台/PRISM H3 控制台.exe');
  if (!existsSync(executable)) throw new InputError('没有找到已安装的PRISM H3控制台；请先手动启动，或配置PRISM_H3_CONSOLE_EXE。');
  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(executable, [], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
  child.unref?.();
  return { status: 'starting', executable: basename(executable), automaticSubmission: false };
}

export async function connectPrismH3Console(options = {}) {
  const provider = options.provider ?? new PrismH3Provider();
  const launch = options.launch ?? (() => launchPrismH3Console());
  const wait = options.wait ?? ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)));
  const now = options.now ?? Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, Number(options.timeoutMs)) : 30_000;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(50, Number(options.pollIntervalMs)) : 1_000;
  let health = await provider.health();
  const launchResult = await launch();
  if (health.status === 'ok' || health.status === 'queue_busy') return { connected: true, launched: true, launch: launchResult, health };
  if (health.details?.prismVersion) {
    return { connected: false, bridgeConnected: true, launched: true, launch: launchResult, health, pending: true, message: 'PRISM H3工作台已连接，视频后端仍在启动；客户端会继续自动检查。' };
  }
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    health = await provider.health();
    if (health.status === 'ok' || health.status === 'queue_busy') return { connected: true, launched: true, launch: launchResult, health };
    if (health.details?.prismVersion) {
      return { connected: false, bridgeConnected: true, launched: true, launch: launchResult, health, pending: true, message: 'PRISM H3工作台已连接，视频后端仍在启动；客户端会继续自动检查。' };
    }
  }
  return {
    connected: false,
    launched: true,
    launch: launchResult,
    health,
    pending: true,
    message: 'PRISM H3正在启动；客户端会继续自动发现并连接。',
  };
}

export function buildWebH3GenerationRequest(session, input, options = {}) {
  const state = session?.state;
  if (!state) throw new InputError('请先保存当前项目。');
  const segmentKey = requiredString(input?.segmentKey, '分段ID');
  const segment = state.storyboardSegments?.find((item) => item?.segmentKey === segmentKey);
  const segmentIndex = state.storyboardSegments?.findIndex((item) => item?.segmentKey === segmentKey) ?? -1;
  const prompt = state.videoPrompts?.find((item) => item?.segmentKey === segmentKey && item?.status === 'complete');
  if (!segment || !prompt || prompt.stale || (prompt.approval !== 'approved' && state.videoPromptsApproval !== 'approved')) throw new InputError(`${segmentKey} 的视频提示词尚未确认或需要更新，请先审核这一段。`);
  const generationPreset = normalizeGenerationPreset(input?.generationPreset, state.generationPreset || { styleId: state.selectedStyleId, aspectRatio: state.ratio });
  const promptPreset = prompt.generationPreset ? normalizeGenerationPreset(prompt.generationPreset, generationPreset) : generationPreset;
  if (promptPreset.styleId !== generationPreset.styleId || promptPreset.aspectRatio !== generationPreset.aspectRatio) throw new InputError(`当前视频提示词使用预设 v${promptPreset.version}，请先按当前预设 v${generationPreset.version} 重新生成并确认提示词。`);
  const mode = ['text', 'reference'].includes(input?.mode) ? input.mode : 'reference';
  if (input?.mode === 'first' || input?.mode === 'first-last') throw new InputError('当前项目还没有独立批准的单张首帧资产，不能把故事板冒充H3首帧。');
  const resolution = ['480p', '720p', '1080p', 'custom'].includes(input?.resolution) ? input.resolution : '480p';
  const aspectRatio = generationPreset.aspectRatio;
  const qualityPreset = ['standard', 'balanced', 'fast', 'custom'].includes(input?.qualityPreset) ? input.qualityPreset : 'standard';
  const preset = qualityPreset === 'fast'
    ? { inferenceSteps: 6, accelerationModel: 'turbo4', spectrum: false }
    : qualityPreset === 'balanced'
      ? { inferenceSteps: 10, accelerationModel: 'none', spectrum: true }
      : qualityPreset === 'custom'
        ? { inferenceSteps: Number(input?.inferenceSteps), accelerationModel: input?.accelerationModel ?? 'none', spectrum: input?.spectrum === true }
        : { inferenceSteps: 20, accelerationModel: 'none', spectrum: true };
  if (!Number.isInteger(preset.inferenceSteps) || preset.inferenceSteps < 4 || preset.inferenceSteps > 30) throw new InputError('H3采样步数必须是4至30的整数。');
  if (!['none', 'turbo4', 'lightx2v-544p-v1', 'lightx2v-768p-v1'].includes(preset.accelerationModel)) throw new InputError('H3加速模型选项无效。');
  if (!Number.isInteger(segment.durationSec) || segment.durationSec < 1 || segment.durationSec > 15) throw new InputError('当前分段时长不在H3的1至15秒范围内。');
  const normalized = normalizeStoryboardVideoReferences(prompt);
  const referenceUrls = mode === 'reference' ? normalized.referenceImageUrls ?? [] : [];
  const referenceLabels = mode === 'reference' ? normalized.referenceLabels ?? [] : [];
  if (mode === 'reference' && referenceUrls.length === 0) throw new InputError('当前分段没有可用于H3全能参考的故事板或资产图片。');
  if (referenceUrls.length > 9) throw new InputError('H3全能参考最多支持9张图片，请减少本段参考资产后更新提示词。');
  if (mode === 'reference' && normalized.storyboardReference && Array.isArray(state.storyboardBoards)) {
    const currentBoard = state.storyboardBoards.find(item => item.segmentKey === segmentKey);
    if (!currentBoard || currentBoard.status !== 'complete' || currentBoard.stale || currentBoard.imageUrl !== normalized.storyboardReference.imageUrl) {
      throw new InputError(`${segmentKey}的故事板已变化，请结合当前图片更新并确认这一段视频提示词。原有提示词和视频已保留。`);
    }
  }
  const promptText = withStoryboardVideoGuide(String(prompt.prompt).replace(/^参考输入：[^\n]*\n/mu, '').trim(), mode === 'reference' ? normalized.storyboardReference : undefined, prompt.plan);
  if (mode === 'reference') {
    let subjectNumber = 0;
    const bindings = referenceUrls.map((url, index) => {
      const character = state.characterImages?.some(item => item.imageUrl === url) || /(?:角色|人物)主图/u.test(referenceLabels[index] || '');
      return { pictureTag: `<Picture ${index + 1}>`, assetKind: normalized.storyboardReference?.imageUrl === url ? 'storyboard' : character ? 'character' : 'asset', ...(normalized.storyboardReference?.imageUrl === url ? { panelCount: normalized.storyboardReference.panelCount } : {}), ...(character ? { subjectTag: `<Subject ${++subjectNumber}>` } : {}) };
    });
    const referenceIssues = videoReferenceIssues(promptText, bindings);
    if (referenceIssues.length) throw new InputError(`当前提示词引用需要修正：${referenceIssues.join(' ')} 原有正文已保留，请修正并重新确认该段。`);
    for (let index = 0; index < referenceUrls.length; index += 1) {
      const pictureTag = `<Picture ${index + 1}>`;
      if (!promptText.includes(pictureTag)) throw new InputError(`当前提示词没有在正文中绑定${pictureTag}（${referenceLabels[index] || `参考图${index + 1}`}）；请让Agent重新生成并确认该段提示词。`);
    }
    const unavailableTag = [...promptText.matchAll(/<Picture\s+(\d+)>/giu)].map((match) => Number(match[1])).find((number) => number < 1 || number > referenceUrls.length);
    if (unavailableTag !== undefined) throw new InputError(`当前提示词引用了未上传的<Picture ${unavailableTag}>；请让Agent重新生成并确认该段提示词。`);
  }
  const generatedImageDirectory = resolve(options.generatedImageDirectory ?? resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'));
  const referenceMediaPaths = referenceUrls.map((imageUrl) => {
    if (typeof imageUrl !== 'string' || !/^\/api\/(?:generated-images|free-canvas\/imports)\//u.test(imageUrl)) throw new InputError('H3参考图不属于当前项目已批准的本地资产。');
    return generatedImagePath(imageUrl, generatedImageDirectory, 'H3参考图');
  });
  const { width, height } = h3FrameSize(resolution, aspectRatio, input);
  const seed = Number.isInteger(input?.seed) && input.seed >= 0 ? input.seed : Math.floor(Math.random() * 2_147_483_647);
  const referenceAssetIds = referenceMediaPaths.map((_, index) => `web-h3-reference-${segmentKey.toLowerCase()}-${index + 1}`);
  const continuityMode = input?.continuityMode === 'continue'
    ? 'continue'
    : input?.continuityMode === 'start_chain'
      ? 'start_chain'
      : 'independent';
  let continuity;
  if (continuityMode === 'continue') {
    if (segmentIndex < 1) throw new InputError('第一段不能续接上一段，请选择独立生成。');
    const sourceSegment = state.storyboardSegments[segmentIndex - 1];
    if (input?.sourceSegmentKey && input.sourceSegmentKey !== sourceSegment.segmentKey) throw new InputError('续接来源必须是当前分镜的上一段。');
    const sourceTask = state.shotVideoTasks?.find((task) => task?.segmentKey === sourceSegment.segmentKey);
    const sourceContinuity = sourceTask?.parameters?.continuity;
    if (sourceTask?.status !== 'awaiting_review') throw new InputError(`前一段 ${sourceSegment.segmentKey} 尚未生成完成，当前续接不能提交给Herrgotts。`);
    if (!sourceContinuity || sourceContinuity.engine !== 'herrgotts' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(String(sourceContinuity.chainId || ''))) throw new InputError(`前一段 ${sourceSegment.segmentKey} 不是可续接的Herrgotts链起点，请先选择“建立连续链”生成该段。`);
    const nextIndex = Number(sourceContinuity.segmentIndex) + 1;
    if (!Number.isInteger(nextIndex) || nextIndex > Number(sourceContinuity.segmentCount) || nextIndex > 8) throw new InputError('当前Herrgotts链已达到规划段数上限，请改为独立生成新链。');
    continuity = { engine: 'herrgotts', chainId: sourceContinuity.chainId, segmentIndex: nextIndex, segmentCount: Number(sourceContinuity.segmentCount), sourceSegmentId: sourceSegment.segmentKey };
  } else if (continuityMode === 'start_chain') {
    const remainingCount = Math.min(8, Math.max(0, state.storyboardSegments.length - segmentIndex));
    if (remainingCount < 2) throw new InputError('当前镜头之后没有可续接段落，请使用独立生成。');
    continuity = { engine: 'herrgotts', chainId: `autodrama-${segmentKey.toLowerCase()}-${Date.now().toString(36)}`, segmentIndex: 1, segmentCount: remainingCount };
  }
  return {
    taskId: `web-h3-${segmentKey.toLowerCase()}-${Date.now()}`,
    title: `${segmentKey} · ${segment.title}`,
    sourceEntityIds: [`web-storyboard-${segmentKey.toLowerCase()}`, `web-video-prompt-${segmentKey.toLowerCase()}`],
    prompt: promptText,
    referenceAssetIds,
    referenceAssetVersions: Object.fromEntries(referenceAssetIds.map((assetId) => [assetId, 1])),
    referenceLabels,
    referenceMediaPaths,
    width, height,
    durationSec: segment.durationSec,
    inferenceSteps: preset.inferenceSteps,
    precision: 'bf16',
    acceleration: [preset.accelerationModel, input?.sage === false ? '' : 'sage', preset.spectrum ? 'spectrum' : ''].filter(Boolean),
    mode, resolution, aspectRatio,
    generationPreset,
    frameFit: input?.frameFit === 'stretch' ? 'stretch' : 'cover',
    seed,
    sage: input?.sage !== false,
    spectrum: preset.spectrum,
    accelerationModel: preset.accelerationModel,
    turboLowVram: input?.turboLowVram === true,
    secondPass: input?.secondPass === true,
    rtxUpscale: input?.rtxUpscale === true,
    rtxUpscaleScale: [1, 1.5, 2, 3, 4].includes(input?.rtxUpscaleScale) ? input.rtxUpscaleScale : 2,
    rtxUpscaleQuality: ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].includes(input?.rtxUpscaleQuality) ? input.rtxUpscaleQuality : 'ULTRA',
    cropDelivery: input?.cropDelivery === true,
    confirmRisk: true,
    continuity,
  };
}

export function buildFreeCanvasH3GenerationRequest(input, options = {}) {
  const nodeId = requiredString(input?.nodeId, '自由画布视频节点ID');
  const taskId = requiredString(input?.taskId, '自由画布视频任务ID');
  if (!/^[a-zA-Z0-9._-]{1,240}$/u.test(taskId)) throw new InputError('自由画布视频任务ID无效。');
  const references = Array.isArray(input?.references) ? input.references : [];
  const contractError = referenceInputError({ kind: "video", videoSettings: input?.settings }, references, true);
  if (contractError) throw new InputError(contractError);
  const ownPrompt = String(input?.prompt ?? '').trim();
  const upstreamText = references.filter((reference) => reference?.kind === 'text').map((reference) => String(reference?.content ?? '').trim()).filter(Boolean).join('\n\n');
  const draftPrompt = (ownPrompt || upstreamText).slice(0, 20_000);
  if (!draftPrompt) throw new InputError('请先填写视频提示词，或连接一个包含文字的上游节点。');
  const settings = input?.settings && typeof input.settings === 'object' ? input.settings : {};
  const resolution = ['480p', '720p', '1080p'].includes(settings.resolution) ? settings.resolution : '480p';
  const aspectRatio = ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(settings.aspectRatio) ? settings.aspectRatio : '16:9';
  const durationSec = Number(settings.durationSec ?? 5);
  const inferenceSteps = Number(settings.inferenceSteps ?? 20);
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 15) throw new InputError('H3视频时长必须是1至15秒整数。');
  if (!Number.isInteger(inferenceSteps) || inferenceSteps < 4 || inferenceSteps > 30) throw new InputError('H3采样步数必须是4至30的整数。');
  const accelerationModel = ['none', 'turbo4', 'lightx2v-544p-v1', 'lightx2v-768p-v1'].includes(settings.accelerationModel) ? settings.accelerationModel : 'none';
  const generatedImageDirectory = resolve(options.generatedImageDirectory ?? resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'));
  const referenceMedia = references.flatMap((reference, index) => {
    const kind = String(reference?.kind ?? '');
    if (!['image', 'video', 'audio'].includes(kind)) return [];
    let mediaPath = '';
    const outputPath = Array.isArray(reference?.generation?.outputPaths) ? reference.generation.outputPaths[0] : '';
    if (typeof reference?.mediaUrl === 'string' && (reference.mediaUrl.startsWith('/api/generated-images/') || reference.mediaUrl.startsWith('/api/free-canvas/imports/'))) {
      mediaPath = freeCanvasReferenceMediaPath(String(reference.mediaUrl), kind, generatedImageDirectory, `自由画布参考${index + 1}`);
    } else if (typeof outputPath === 'string' && isAbsolute(outputPath) && existsSync(outputPath)) {
      mediaPath = resolve(outputPath);
    } else if (typeof reference?.mediaUrl === 'string' && isAbsolute(reference.mediaUrl) && existsSync(reference.mediaUrl)) {
      mediaPath = resolve(reference.mediaUrl);
    } else {
      throw new InputError(`${String(reference?.title || `参考${index + 1}`)}没有可供本机H3读取的本地媒体文件。`);
    }
    const extension = extname(mediaPath).toLowerCase();
    const allowed = kind === 'image' ? /\.(png|webp|jpe?g)$/iu : kind === 'video' ? /\.(mp4|mov|webm)$/iu : /\.(wav|mp3|flac)$/iu;
    if (!allowed.test(extension)) throw new InputError(`${String(reference?.title || `参考${index + 1}`)}的媒体格式不受H3参考输入支持。`);
    const mediaDurationSec = Number(reference?.mediaDurationSec || 0);
    if (kind === 'video' && (!Number.isFinite(mediaDurationSec) || mediaDurationSec < 2 || mediaDurationSec > 15)) throw new InputError(`${String(reference?.title || `参考${index + 1}`)}必须先读取到2至15秒的源视频时长。`);
    return [{
      path: mediaPath,
      kind,
      label: String(reference?.title ?? '').slice(0, 120),
      ...(kind === 'video' ? { frames: Math.max(48, Math.min(360, Math.round(mediaDurationSec * 24))), useAudio: true } : {}),
    }];
  });
  const imageCount = referenceMedia.filter((item) => item.kind === 'image').length;
  const videoCount = referenceMedia.filter((item) => item.kind === 'video').length;
  const audioCount = referenceMedia.filter((item) => item.kind === 'audio').length;
  if (imageCount > 9 || videoCount > 3 || audioCount > 3) throw new InputError('H3全能参考最多支持9张图片、3段视频和3段独立音频。');
  let prompt = draftPrompt;
  try {
    prompt = referencePurposeContext(references) + compileFreeCanvasReferenceMentions(draftPrompt, { image: imageCount, video: videoCount, audio: audioCount });
  } catch (cause) {
    throw new InputError(cause instanceof Error ? cause.message : '视频提示词中的参考素材编号无效。');
  }
  try {
    validateVideoPromptLanguageSurface(prompt);
  } catch (cause) {
    throw new InputError(cause instanceof Error ? cause.message : '视频提示词的声音与文案规则未通过校验。');
  }
  const requestedMode = ['auto', 'text', 'first', 'reference'].includes(settings.mode) ? settings.mode : 'auto';
  const mode = requestedMode === 'auto'
    ? (referenceMedia.length === 0 ? 'text' : referenceMedia.length === 1 && imageCount === 1 ? 'first' : 'reference')
    : requestedMode;
  if (mode === 'text' && referenceMedia.length) throw new InputError('文生视频模式不能携带媒体参考，请改为自动、首帧或全能参考。');
  if (mode === 'first' && (referenceMedia.length !== 1 || imageCount !== 1)) throw new InputError('首帧模式必须只引用一张图片。');
  if (mode === 'reference' && referenceMedia.length === 0) throw new InputError('全能参考模式至少需要@引用一张图片、一段视频或一段音频。');
  const { width, height } = h3FrameSize(resolution, aspectRatio, settings);
  const seed = Number.isInteger(settings.seed) && settings.seed >= 0 ? settings.seed : Math.floor(Math.random() * 2_147_483_647);
  return {
    taskId,
    title: String(input?.title || '自由画布视频').slice(0, 160),
    sourceEntityIds: [...new Set([nodeId, ...references.map((reference) => String(reference?.id ?? '').trim()).filter(Boolean)])],
    prompt,
    referenceAssetIds: referenceMedia.map((_, index) => `free-canvas-reference-${index + 1}`),
    referenceAssetVersions: {},
    referenceLabels: referenceMedia.map((item) => item.label || ''),
    referenceMediaPaths: referenceMedia.map((item) => item.path),
    referenceMedia,
    width, height, durationSec, inferenceSteps,
    precision: 'bf16',
    acceleration: [accelerationModel, settings.sage === false ? '' : 'sage', settings.spectrum === true ? 'spectrum' : ''].filter(Boolean),
    mode, resolution, aspectRatio,
    frameFit: 'cover',
    seed,
    sage: settings.sage !== false,
    spectrum: settings.spectrum === true,
    accelerationModel,
    turboLowVram: false,
    confirmRisk: true,
  };
}

function h3FrameSize(resolution, aspectRatio, input) {
  if (resolution === 'custom') {
    const width = Number(input?.customWidth);
    const height = Number(input?.customHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256) throw new InputError('H3自定义尺寸无效。');
    return { width, height };
  }
  const sizes = {
    '480p': { '16:9': [864, 480], '9:16': [480, 864], '1:1': [640, 640], '4:3': [768, 576], '3:4': [576, 768] },
    '720p': { '16:9': [1280, 736], '9:16': [736, 1280], '1:1': [960, 960], '4:3': [1152, 864], '3:4': [864, 1152] },
    '1080p': { '16:9': [1920, 1088], '9:16': [1088, 1920], '1:1': [1440, 1440], '4:3': [1664, 1248], '3:4': [1248, 1664] },
  };
  const [width, height] = sizes[resolution][aspectRatio];
  return { width, height };
}

export function safeH3Message(error) {
  if (error instanceof PrismH3ProviderError) return `${error.message} 系统没有自动重试。`;
  if (error instanceof Error && error.message) return `${error.message.slice(0, 500)} 系统没有自动重试。`;
  return 'PRISM H3本地任务失败，系统没有自动重试。';
}

export function safeMusicMessage(error) {
  if (error instanceof AceStepMusicProviderError) {
    const message = error.code === 'model_missing' || error.code === 'backend_offline'
      ? '本机 ACE-Step 1.5运行时或模型未就绪。'
      : error.code === 'timeout'
        ? 'ACE-Step配乐生成超时，任务证据已保留。'
        : error.code === 'invalid_audio' || error.code === 'missing_audio'
          ? '本机配乐没有通过文件与完整解码校验。'
          : error.code === 'output_exists'
            ? '本机配乐任务文件已存在，系统没有覆盖。'
            : `ACE-Step 1.5配乐生成失败（${error.code}）。`;
    return `${message} ${error.message.slice(0, 500)} 现有粗剪、配乐提示词和旧结果均已保留；系统没有自动重试。`;
  }
  if (error instanceof MiniMaxMusicProviderError) {
    const message = error.code === '1008'
      ? 'MiniMax Music余额不足，本次没有生成音乐。'
      : error.code === '1002' || error.status === 429
        ? 'MiniMax Music当前限流，本次没有自动重试。'
        : error.code === '1004' || error.code === '2049' || error.status === 401 || error.status === 403
          ? 'MiniMax Music鉴权失败，请检查连接设置。'
          : error.code === 'audio_download_error'
            ? '音乐已生成，但短期下载链接读取失败；系统没有自动重试。'
            : error.code === 'invalid_audio_bytes'
              ? '音乐返回文件无法通过本地MP3校验；文件未写入。'
              : `MiniMax Music生成失败${error.code ? `（${error.code}）` : ''}。`;
    return `${message} 现有粗剪、配乐提示词和旧结果均已保留。`;
  }
  return `MiniMax Music生成失败：${error instanceof Error ? error.message.slice(0, 500) : '未知错误'}。系统没有自动重试。`;
}

export function buildWebRoughCutRequest(savedSession, options = {}) {
  const state = savedSession?.state;
  if (!state || state.shotVideosApproval !== 'approved') throw new InputError('请先确认全部镜头视频，再生成粗剪。');
  const segments = Array.isArray(state.storyboardSegments) ? [...state.storyboardSegments].sort((a, b) => Number(a.order) - Number(b.order)) : [];
  if (segments.length === 0) throw new InputError('当前项目没有可用于粗剪的镜头。');
  const tasks = Array.isArray(state.shotVideoTasks) ? state.shotVideoTasks : [];
  const clips = segments.map((segment) => {
    const task = tasks.find((item) => item.segmentKey === segment.segmentKey);
    if (!task || task.status !== 'awaiting_review') throw new InputError(`${segment.segmentKey}还没有可验收的视频结果。`);
    const outputPath = Array.isArray(task.outputPaths) ? task.outputPaths.find((item) => typeof item === 'string' && item.trim()) : '';
    if (!outputPath || !existsSync(outputPath)) throw new InputError(`${segment.segmentKey}的视频文件不存在，不能生成粗剪。`);
    if (!['.mp4', '.mov', '.mkv', '.webm'].includes(extname(outputPath).toLowerCase())) throw new InputError(`${segment.segmentKey}的视频格式暂不支持粗剪。`);
    const continuity = task.parameters?.continuity?.engine === 'herrgotts'
      ? task.parameters.continuity
      : task.parameters?.chainId && task.parameters?.segmentIndex
        ? { engine: 'herrgotts', chainId: task.parameters.chainId, segmentIndex: task.parameters.segmentIndex }
        : undefined;
    return {
      segmentKey: segment.segmentKey, title: String(segment.title || segment.segmentKey), order: Number(segment.order), path: resolve(outputPath),
      ...(['minimax', 'seedance'].includes(task.parameters?.videoEngine) && task.parameters?.generateAudio === false ? { silentVideo: true } : {}),
      continuity: continuity ? {
        engine: 'herrgotts', chainId: String(continuity.chainId || ''), segmentIndex: Number(continuity.segmentIndex),
        sourceSegmentId: typeof continuity.sourceSegmentId === 'string' ? continuity.sourceSegmentId : undefined,
      } : undefined,
    };
  });
  const outputDirectory = resolve(options.outputDirectory ?? resolve(RUNTIME_DATA_ROOT, 'compositions'));
  return { projectId: String(savedSession.id || 'local-project'), clips, projectAspectRatio: normalizeGenerationAspectRatio(state.ratio), outputDirectory, herrgottsLatentRoot: options.herrgottsLatentRoot ? resolve(options.herrgottsLatentRoot) : undefined };
}

export function buildWebMusicGenerationRequest(savedSession, options = {}) {
  const state = savedSession?.state;
  const post = state?.postProduction;
  if (!post || post.roughCutApproval !== 'approved' || post.roughCut?.status !== 'complete') throw new InputError('请先确认可播放的粗剪。');
  if (!['native_with_music', 'music_only'].includes(post.audioMode)) throw new InputError('当前声音方案不包含配乐。');
  if (!post || post.musicPromptApproval !== 'approved' || post.musicPrompt?.status !== 'complete' || !post.musicPrompt.plan) throw new InputError('请先确认配乐提示词。');
  const prompt = requiredString(post.musicPrompt.plan.minimaxPrompt, '配乐提示词');
  if (prompt.length > 800 || post.musicPrompt.plan.instrumental !== true) {
    throw new InputError('配乐提示词需在800字符以内，并开启纯器乐选项。');
  }
  const durationSec = Number(post.roughCut?.durationSec ?? post.musicPrompt.plan.targetDurationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new InputError('粗剪时长无效，不能生成配乐。');
  const stamp = String(options.stamp ?? new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14));
  const projectId = String(savedSession.id || 'local-project').replace(/[^a-zA-Z0-9._-]/gu, '_');
  const request = {
    taskId: `music-${projectId}-${stamp}`,
    sourceEntityIds: [String(post.roughCut?.filename || `rough-cut-${projectId}`)],
    prompt,
    durationSec,
    instrumental: true,
  };
  if (options.seed !== undefined) {
    const seed = Number(options.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) throw new InputError('本机配乐Seed必须是0至2147483647之间的整数。');
    request.seed = seed;
  }
  const bpm = Number(options.bpm ?? post.musicBpm ?? 84);
  if (!Number.isInteger(bpm) || bpm < 30 || bpm > 300) throw new InputError('ACE-Step BPM必须是30至300之间的整数。');
  const inferenceSteps = Number(options.inferenceSteps ?? post.musicInferenceSteps ?? 8);
  if (!Number.isInteger(inferenceSteps) || inferenceSteps < 1 || inferenceSteps > 20) throw new InputError('ACE-Step Turbo步数必须是1至20之间的整数。');
  const keyScale = String(options.keyScale ?? post.musicKeyScale ?? 'A Minor').trim();
  if (!keyScale || keyScale.length > 80) throw new InputError('ACE-Step调性无效。');
  const timeSignature = String(options.timeSignature ?? post.musicTimeSignature ?? '4');
  if (!['2', '3', '4', '6'].includes(timeSignature)) throw new InputError('ACE-Step拍号只支持2/4、3/4、4/4或6/8。');
  request.bpm = bpm;
  request.keyScale = keyScale;
  request.timeSignature = timeSignature;
  request.inferenceSteps = inferenceSteps;
  request.thinking = options.thinking === undefined ? post.musicThinking !== false : options.thinking === true;
  return request;
}

export function buildFreeCanvasAudioGenerationRequest(input) {
  const nodeId = requiredString(input?.nodeId, '自由画布音频节点ID');
  const taskId = requiredString(input?.taskId, '自由画布音频任务ID');
  if (!/^[a-zA-Z0-9._-]{1,240}$/u.test(taskId)) throw new InputError('自由画布音频任务ID无效。');
  const references = Array.isArray(input?.references) ? input.references : [];
  const contractError = referenceInputError({ kind: "audio", videoSettings: input?.settings }, references, true);
  if (contractError) throw new InputError(contractError);
  const ownPrompt = String(input?.prompt ?? '').trim();
  const upstreamText = references.filter((reference) => reference?.kind === 'text').map((reference) => String(reference?.content ?? '').trim()).filter(Boolean).join('\n\n');
  const prompt = ownPrompt || upstreamText;
  if (!prompt) throw new InputError('请先填写音乐描述，或连接一个包含文字的上游节点。');
  if (prompt.length > 2_000) throw new InputError('ACE-Step音乐描述最多2000字。');
  if (/@(图片|视频|音频)\s*\d+/u.test(prompt)) throw new InputError('ACE-Step音乐节点不接受媒体引用标记，请使用文字描述音乐目标。');
  const settings = input?.settings && typeof input.settings === 'object' ? input.settings : {};
  const mode = settings.mode === 'song' ? 'song' : settings.mode === 'instrumental' ? 'instrumental' : '';
  if (!mode) throw new InputError('自由画布音频类型无效。');
  const durationSec = Number(settings.durationSec);
  if (!Number.isInteger(durationSec) || durationSec < 5 || durationSec > 300) throw new InputError('ACE-Step时长必须是5至300秒之间的整数。');
  const bpm = Number(settings.bpm);
  if (!Number.isInteger(bpm) || bpm < 30 || bpm > 300) throw new InputError('ACE-Step BPM必须是30至300之间的整数。');
  const inferenceSteps = Number(settings.inferenceSteps);
  if (!Number.isInteger(inferenceSteps) || inferenceSteps < 1 || inferenceSteps > 20) throw new InputError('ACE-Step Turbo步数必须是1至20之间的整数。');
  const seed = Number(settings.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) throw new InputError('ACE-Step Seed必须是0至2147483647之间的整数。');
  const keyScale = String(settings.keyScale ?? '').trim();
  if (!keyScale || keyScale.length > 80) throw new InputError('ACE-Step调性无效。');
  const timeSignature = String(settings.timeSignature ?? '4');
  if (!['2', '3', '4', '6'].includes(timeSignature)) throw new InputError('ACE-Step拍号只支持2/4、3/4、4/4或6/8。');
  const instrumental = mode === 'instrumental';
  const lyrics = String(settings.lyrics ?? '').trim();
  const vocalLanguage = String(settings.vocalLanguage ?? 'zh').trim();
  if (!instrumental && (!lyrics || lyrics.length > 4_096)) throw new InputError('歌曲模式需要1至4096字符的歌词。');
  if (!instrumental && !/^[a-z]{2,8}(?:-[A-Z]{2})?$/u.test(vocalLanguage)) throw new InputError('演唱语言代码无效。');
  return {
    taskId,
    sourceEntityIds: [nodeId, ...references.map((reference) => String(reference?.id ?? '').trim()).filter(Boolean)].slice(0, 30),
    prompt,
    durationSec,
    instrumental,
    ...(instrumental ? {} : { lyrics, vocalLanguage }),
    seed,
    bpm,
    keyScale,
    timeSignature,
    inferenceSteps,
    thinking: settings.thinking !== false,
  };
}

export function musicTaskResult(task) {
  const outputPath = task.outputPaths[0];
  if (!outputPath || !existsSync(outputPath)) throw new InputError('音乐任务没有返回可播放的本地文件。');
  const actualDurationMs = Number(task.parameters?.musicDurationMs);
  const actualDurationSec = Number(task.parameters?.actualDurationSec);
  const durationUnqualified = task.status === 'failed' && task.errorCode === 'duration_too_short';
  return {
    status: durationUnqualified ? 'unqualified' : task.status === 'failed' ? 'failed' : 'complete',
    provider: task.provider,
    filename: basename(outputPath),
    outputPath,
    mediaUrl: `/api/postproduction/music-media/${encodeURIComponent(basename(outputPath))}`,
    durationSec: Number.isFinite(actualDurationSec) && actualDurationSec > 0
      ? actualDurationSec
      : Number.isFinite(actualDurationMs) && actualDurationMs > 0 ? actualDurationMs / 1000 : undefined,
    requestedDurationSec: Number(task.parameters?.requestedDurationSec) || undefined,
    inferenceSteps: Number(task.parameters?.inferenceSteps) || undefined,
    seed: Number.isFinite(Number(task.parameters?.seed)) ? Number(task.parameters.seed) : undefined,
    externalTaskId: task.externalTaskId,
    error: task.errorMessage || undefined,
    createdAt: task.updatedAt,
  };
}

export function recoverPreservedShortMusic(session, options = {}) {
  const music = session?.state?.postProduction?.music;
  if (!session?.id || music?.status !== 'failed' || music?.mediaUrl) return session;
  const generatedMusicDirectory = resolve(options.generatedMusicDirectory ?? resolve(RUNTIME_DATA_ROOT, 'generated-audio'));
  if (!existsSync(generatedMusicDirectory)) return session;
  const prefix = `music-${session.id}-`;
  const manifests = readdirSync(generatedMusicDirectory).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort().reverse();
  for (const filename of manifests) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(generatedMusicDirectory, filename), 'utf8'));
      const parameters = manifest.parameters && typeof manifest.parameters === 'object' ? manifest.parameters : {};
      const diagnostics = manifest.diagnostics && typeof manifest.diagnostics === 'object' ? manifest.diagnostics : {};
      const errorCode = manifest.errorCode || (manifest.status === 'failed' && Number(diagnostics.actualDurationSec) < Number(diagnostics.requestedDurationSec) ? 'duration_too_short' : '');
      if (manifest.status !== 'failed' || errorCode !== 'duration_too_short') continue;
      const outputPath = resolve(String(manifest.outputPath || parameters.rawOutputPath || diagnostics.generatedOutputPath || ''));
      if (dirname(outputPath) !== generatedMusicDirectory || !existsSync(outputPath) || statSync(outputPath).size < 44) continue;
      const durationSec = Number(parameters.actualDurationSec ?? diagnostics.actualDurationSec);
      const requestedDurationSec = Number(parameters.requestedDurationSec ?? diagnostics.requestedDurationSec);
      if (!(durationSec > 0) || !(requestedDurationSec > durationSec)) continue;
      const error = manifest.errorMessage || `本机模型只生成了${durationSec.toFixed(3)}秒，短于目标${requestedDurationSec.toFixed(3)}秒；结果可试听，但不能进入最终合成。`;
      return {
        ...session,
        state: {
          ...session.state,
          postProduction: {
            ...session.state.postProduction,
            musicApproval: 'draft',
            music: {
              ...music, status: 'unqualified', provider: ['acestep-1.5', 'audiocpp-minimax-music-3'].includes(manifest.provider) ? manifest.provider : 'acestep-1.5',
              filename: basename(outputPath), outputPath, mediaUrl: `/api/postproduction/music-media/${encodeURIComponent(basename(outputPath))}`,
              durationSec, requestedDurationSec, inferenceSteps: Number(parameters.inferenceSteps) || music.inferenceSteps,
              seed: Number.isInteger(Number(parameters.seed)) ? Number(parameters.seed) : music.seed,
              externalTaskId: manifest.taskId || music.externalTaskId, error, createdAt: manifest.failedAt || manifest.createdAt || music.createdAt,
            },
          },
        },
      };
    } catch {
      // Ignore one damaged manifest and continue to an older preserved result for the same project.
    }
  }
  return session;
}

function ffmpegConcatPath(filePath) {
  return filePath.replace(/\\/gu, '/').replace(/'/gu, "'\\''");
}

async function runProcess(command, args) {
  return await new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', (chunk) => { if (stdoutBytes < 2_000_000) { stdout.push(chunk); stdoutBytes += chunk.length; } });
    child.stderr.on('data', (chunk) => { if (stderrBytes < 2_000_000) { stderr.push(chunk); stderrBytes += chunk.length; } });
    child.on('error', rejectProcess);
    child.on('close', (code) => {
      const result = { code: Number(code), stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (code === 0) resolveProcess(result);
      else rejectProcess(new Error(`${basename(command)}执行失败：${result.stderr.slice(-1_200) || `退出码${code}`}`));
    });
  });
}

function ffmpegVideoEncoderArgs() {
  if (process.env.PRISM_FFMPEG_VIDEO_ENCODER === 'h264_mf') {
    return ['-c:v', 'h264_mf', '-rate_control', 'quality', '-quality', '80', '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p'];
}

async function probeMedia(filePath, processRunner) {
  const result = await processRunner('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate', '-show_entries', 'format=duration', '-of', 'json', '--', filePath]);
  const parsed = JSON.parse(result.stdout || '{}');
  const video = Array.isArray(parsed.streams) ? parsed.streams.find((stream) => stream.codec_type === 'video') : null;
  const audio = Array.isArray(parsed.streams) ? parsed.streams.find((stream) => stream.codec_type === 'audio') : null;
  if (!video || !Number(video.width) || !Number(video.height)) throw new InputError(`视频文件无法读取画面信息：${basename(filePath)}`);
  return {
    codec: String(video.codec_name || ''), width: Number(video.width), height: Number(video.height), fps: String(video.r_frame_rate || ''),
    durationSec: Number(parsed.format?.duration || 0), audioCodec: String(audio?.codec_name || ''), audioChannels: Number(audio?.channels || 0), audioSampleRate: Number(audio?.sample_rate || 0), audioPresent: Boolean(audio),
  };
}

function findAncestorNamed(filePath, name) {
  let current = dirname(resolve(filePath));
  while (true) {
    if (basename(current).toLowerCase() === name.toLowerCase()) return current;
    const parent = dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

export function resolveHerrgottsLatentPath(clip, latentRoot) {
  const chainId = String(clip?.continuity?.chainId || '').trim();
  const segmentIndex = Number(clip?.continuity?.segmentIndex);
  if (!chainId || !Number.isInteger(segmentIndex) || segmentIndex < 1) return '';
  const root = latentRoot || (() => {
    const outputRoot = findAncestorNamed(clip.path, 'output');
    return outputRoot ? resolve(outputRoot, 'h3_continuous', 'prism-long') : '';
  })();
  return root ? resolve(root, chainId, `clip_${String(segmentIndex).padStart(5, '0')}.safetensors`) : '';
}

export function readHerrgottsReleaseMetadata(filePath) {
  if (!filePath || !existsSync(filePath)) throw new InputError(`Herrgotts续接元数据不存在：${filePath || '未能定位latent文件'}`);
  const descriptor = openSync(filePath, 'r');
  try {
    const lengthBytes = Buffer.alloc(8);
    if (readSync(descriptor, lengthBytes, 0, 8, 0) !== 8) throw new InputError(`Herrgotts latent头部损坏：${basename(filePath)}`);
    const headerLength = Number(lengthBytes.readBigUInt64LE());
    if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > 16 * 1024 * 1024) throw new InputError(`Herrgotts latent头部长度无效：${basename(filePath)}`);
    const headerBytes = Buffer.alloc(headerLength);
    if (readSync(descriptor, headerBytes, 0, headerLength, 8) !== headerLength) throw new InputError(`Herrgotts latent元数据不完整：${basename(filePath)}`);
    const metadata = JSON.parse(headerBytes.toString('utf8')).__metadata__;
    const handover = JSON.parse(String(metadata?.handover_json || '{}'));
    const frameCount = Number(metadata?.frame_count);
    const fps = Number(metadata?.fps);
    const headContextFrames = Number(metadata?.head_context_frames || 0);
    if (!Number.isInteger(frameCount) || frameCount < 1 || !Number.isFinite(fps) || fps <= 0 || !Number.isInteger(headContextFrames) || headContextFrames < 0) {
      throw new InputError(`Herrgotts latent缺少有效的帧数、帧率或续接头信息：${basename(filePath)}`);
    }
    return { frameCount, fps, headContextFrames, handover, latentPath: filePath };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`无法读取Herrgotts续接元数据：${basename(filePath)}（${error instanceof Error ? error.message : String(error)}）`);
  } finally {
    closeSync(descriptor);
  }
}

function continuityGroups(clips) {
  const groups = [];
  for (const clip of clips) {
    const previousGroup = groups.at(-1);
    const previousClip = previousGroup?.at(-1);
    const sameNextChain = previousClip?.continuity?.chainId
      && previousClip.continuity.chainId === clip.continuity?.chainId
      && Number(clip.continuity.segmentIndex) === Number(previousClip.continuity.segmentIndex) + 1;
    if (sameNextChain) previousGroup.push(clip);
    else groups.push([clip]);
  }
  return groups;
}

export function buildHerrgottsRoughCutPlan(clips, options = {}) {
  const crossfadeFrames = Number(options.crossfadeFrames ?? 4);
  const audioCrossfadeSec = Number(options.audioCrossfadeSec ?? 0.015);
  const groups = continuityGroups(clips);
  const hasContinuity = groups.some((group) => group.length > 1);
  if (!hasContinuity) return { hasContinuity: false, groups, clips: clips.map((clip) => ({ ...clip })) };
  const plannedClips = [];
  for (const group of groups) {
    if (group.length === 1) {
      plannedClips.push({ ...group[0], headTrimFrames: 0, tailTrimFrames: 0, crossfadeFrames: 0 });
      continue;
    }
    const metadata = group.map((clip) => readHerrgottsReleaseMetadata(resolveHerrgottsLatentPath(clip, options.herrgottsLatentRoot)));
    for (let index = 0; index < group.length; index += 1) {
      const meta = metadata[index];
      const hasNext = index < group.length - 1;
      const handoverEndFrame = Number(meta.handover?.handover_end_frame);
      const tailTrimFrames = hasNext ? meta.frameCount - (handoverEndFrame + 1) : 0;
      if ((hasNext && (meta.handover?.available !== true || !Number.isInteger(handoverEndFrame))) || tailTrimFrames < 0 || meta.headContextFrames + tailTrimFrames >= meta.frameCount) {
        throw new InputError(`${group[index].segmentKey}的Herrgotts handover元数据无效，已停止粗剪，未退回重复帧硬拼。`);
      }
      if (hasNext && Number(meta.handover?.landing_tail_frames) !== tailTrimFrames) throw new InputError(`${group[index].segmentKey}的Herrgotts handover边界不一致，已停止粗剪。`);
      const keptFrames = meta.frameCount - meta.headContextFrames - tailTrimFrames;
      const appliedCrossfadeFrames = index > 0 ? Math.min(crossfadeFrames, meta.headContextFrames) : 0;
      plannedClips.push({
        ...group[index], latentPath: meta.latentPath, frameCount: meta.frameCount, sourceFps: meta.fps,
        headTrimFrames: meta.headContextFrames, tailTrimFrames, keptFrames, crossfadeFrames: appliedCrossfadeFrames,
        effectiveDurationSec: keptFrames / meta.fps,
      });
    }
  }
  return { hasContinuity: true, groups: continuityGroups(plannedClips), clips: plannedClips, crossfadeFrames, audioCrossfadeSec };
}

function buildHerrgottsFilter(plan) {
  const filters = [];
  const groupOutputs = [];
  let clipOffset = 0;
  for (let groupIndex = 0; groupIndex < plan.groups.length; groupIndex += 1) {
    const group = plan.groups[groupIndex];
    const first = group[0];
    const firstEndFrame = first.frameCount ? first.frameCount - first.tailTrimFrames : undefined;
    const firstFps = Number(first.sourceFps || 24);
    const firstEndSec = firstEndFrame === undefined ? undefined : firstEndFrame / firstFps;
    let videoLabel = `gv${groupIndex}_0`;
    let audioLabel = `ga${groupIndex}_0`;
    filters.push(`[${clipOffset}:v]trim=start_frame=${first.headTrimFrames || 0}${firstEndFrame === undefined ? '' : `:end_frame=${firstEndFrame}`},setpts=PTS-STARTPTS,settb=AVTB[${videoLabel}]`);
    filters.push(`[${clipOffset}:a]atrim=start=${((first.headTrimFrames || 0) / firstFps).toFixed(9)}${firstEndSec === undefined ? '' : `:end=${firstEndSec.toFixed(9)}`},asetpts=PTS-STARTPTS[${audioLabel}]`);
    let accumulatedFrames = Number(first.keptFrames || Math.round(Number(first.durationSec || 0) * firstFps));
    for (let index = 1; index < group.length; index += 1) {
      const absoluteIndex = clipOffset + index;
      const clip = group[index];
      const fps = Number(clip.sourceFps || firstFps);
      const overlapFrames = Number(clip.crossfadeFrames || 0);
      const overlapSec = overlapFrames / fps;
      const audioOverlapSec = Math.min(Number(plan.audioCrossfadeSec), (clip.headTrimFrames || 0) / fps, accumulatedFrames / fps);
      const nextEndFrame = clip.frameCount - clip.tailTrimFrames;
      const nextEndSec = nextEndFrame / fps;
      const headSec = clip.headTrimFrames / fps;
      const nextVideoLabel = `gxv${groupIndex}_${index}`;
      const nextAudioLabel = `gxa${groupIndex}_${index}`;
      if (overlapFrames > 0) {
        const denominator = Math.max(1, overlapFrames - 1);
        filters.push(`[${videoLabel}]split=2[gpv${groupIndex}_${index}][gtv${groupIndex}_${index}]`);
        filters.push(`[gpv${groupIndex}_${index}]trim=end_frame=${accumulatedFrames - overlapFrames},setpts=PTS-STARTPTS[gpp${groupIndex}_${index}]`);
        filters.push(`[gtv${groupIndex}_${index}]trim=start_frame=${accumulatedFrames - overlapFrames},setpts=PTS-STARTPTS[gpt${groupIndex}_${index}]`);
        filters.push(`[${absoluteIndex}:v]split=2[gnov${groupIndex}_${index}][gnbv${groupIndex}_${index}]`);
        filters.push(`[gnov${groupIndex}_${index}]trim=start_frame=${clip.headTrimFrames - overlapFrames}:end_frame=${clip.headTrimFrames},setpts=PTS-STARTPTS,settb=AVTB[gno${groupIndex}_${index}]`);
        filters.push(`[gnbv${groupIndex}_${index}]trim=start_frame=${clip.headTrimFrames}:end_frame=${nextEndFrame},setpts=PTS-STARTPTS,settb=AVTB[gnb${groupIndex}_${index}]`);
        filters.push(`[gpt${groupIndex}_${index}][gno${groupIndex}_${index}]blend=all_expr='A*(1-N/${denominator})+B*(N/${denominator})':shortest=1[gbl${groupIndex}_${index}]`);
        filters.push(`[gpp${groupIndex}_${index}][gbl${groupIndex}_${index}][gnb${groupIndex}_${index}]concat=n=3:v=1:a=0[${nextVideoLabel}]`);
      } else {
        filters.push(`[${absoluteIndex}:v]trim=start_frame=${clip.headTrimFrames}:end_frame=${nextEndFrame},setpts=PTS-STARTPTS,settb=AVTB[gnb${groupIndex}_${index}]`);
        filters.push(`[${videoLabel}][gnb${groupIndex}_${index}]concat=n=2:v=1:a=0[${nextVideoLabel}]`);
      }
      const accumulatedSec = accumulatedFrames / fps;
      filters.push(`[${audioLabel}]asplit=2[gpa${groupIndex}_${index}][gta${groupIndex}_${index}]`);
      filters.push(`[gpa${groupIndex}_${index}]atrim=end=${(accumulatedSec - audioOverlapSec).toFixed(9)},asetpts=PTS-STARTPTS[gap${groupIndex}_${index}]`);
      filters.push(`[gta${groupIndex}_${index}]atrim=start=${(accumulatedSec - audioOverlapSec).toFixed(9)},asetpts=PTS-STARTPTS[gat${groupIndex}_${index}]`);
      filters.push(`[${absoluteIndex}:a]asplit=2[gnoa${groupIndex}_${index}][gnba${groupIndex}_${index}]`);
      filters.push(`[gnoa${groupIndex}_${index}]atrim=start=${(headSec - audioOverlapSec).toFixed(9)}:end=${headSec.toFixed(9)},asetpts=PTS-STARTPTS[gnao${groupIndex}_${index}]`);
      filters.push(`[gnba${groupIndex}_${index}]atrim=start=${headSec.toFixed(9)}:end=${nextEndSec.toFixed(9)},asetpts=PTS-STARTPTS[gnab${groupIndex}_${index}]`);
      filters.push(`[gat${groupIndex}_${index}][gnao${groupIndex}_${index}]acrossfade=d=${audioOverlapSec.toFixed(6)}:c1=tri:c2=tri[gabl${groupIndex}_${index}]`);
      filters.push(`[gap${groupIndex}_${index}][gabl${groupIndex}_${index}][gnab${groupIndex}_${index}]concat=n=3:v=0:a=1[${nextAudioLabel}]`);
      videoLabel = nextVideoLabel;
      audioLabel = nextAudioLabel;
      accumulatedFrames += clip.keptFrames;
    }
    const normalizedVideoLabel = `gnv${groupIndex}`;
    const normalizedAudioLabel = `gna${groupIndex}`;
    const frameNormalization = plan.outputWidth && plan.outputHeight ? `,scale=${plan.outputWidth}:${plan.outputHeight}:force_original_aspect_ratio=decrease,pad=${plan.outputWidth}:${plan.outputHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1` : '';
    filters.push(`[${videoLabel}]fps=${firstFps},setpts=N/(${firstFps}*TB)${frameNormalization}[${normalizedVideoLabel}]`);
    filters.push(`[${audioLabel}]apad,atrim=duration=${(accumulatedFrames / firstFps).toFixed(9)},asetpts=PTS-STARTPTS[${normalizedAudioLabel}]`);
    groupOutputs.push({ videoLabel: normalizedVideoLabel, audioLabel: normalizedAudioLabel });
    clipOffset += group.length;
  }
  if (groupOutputs.length === 1) return { filter: filters.join(';'), videoLabel: groupOutputs[0].videoLabel, audioLabel: groupOutputs[0].audioLabel };
  const concatInputs = groupOutputs.map(({ videoLabel, audioLabel }) => `[${videoLabel}][${audioLabel}]`).join('');
  filters.push(`${concatInputs}concat=n=${groupOutputs.length}:v=1:a=1[vout][aout]`);
  return { filter: filters.join(';'), videoLabel: 'vout', audioLabel: 'aout' };
}

export async function runLocalRoughCut(savedSession, options = {}) {
  const request = buildWebRoughCutRequest(savedSession, options);
  const processRunner = options.processRunner ?? runProcess;
  const createdAt = new Date().toISOString();
  const probes = [];
  for (const clip of request.clips) probes.push(await probeMedia(clip.path, processRunner));
  const mediaSignature = (probe) => [probe.codec, probe.width, probe.height, probe.fps, probe.audioCodec, probe.audioChannels, probe.audioSampleRate].join('|');
  const timelineSignature = (probe) => [probe.fps, probe.audioCodec, probe.audioChannels, probe.audioSampleRate].join('|');
  const hasSilentClips = probes.some((probe) => !probe.audioPresent);
  if (probes.some((probe, index) => !probe.audioPresent && !request.clips[index].silentVideo)) throw new InputError('检测到要求原声却缺少音轨的镜头，请先检查并确认声音要求。');
  const audibleProbes = probes.filter(probe => probe.audioPresent);
  if (probes.some(probe => probe.fps !== probes[0].fps) || audibleProbes.some(probe => timelineSignature(probe) !== timelineSignature(audibleProbes[0]))) throw new InputError('镜头的帧率或音频规格不一致，当前不能可靠拼接；系统没有自动改速或改音轨。');
  const seamPlan = buildHerrgottsRoughCutPlan(request.clips.map((clip, index) => ({ ...clip, durationSec: probes[index].durationSec })), { herrgottsLatentRoot: request.herrgottsLatentRoot });
  const frame = editorFrameSize(request.projectAspectRatio, probes[0]);
  seamPlan.outputWidth = frame.width;
  seamPlan.outputHeight = frame.height;
  mkdirSync(request.outputDirectory, { recursive: true });
  const stamp = createdAt.replace(/[-:.TZ]/gu, '').slice(0, 14);
  const baseName = `rough-cut-${request.projectId}-${stamp}`.replace(/[^a-zA-Z0-9._-]/gu, '_');
  const listPath = resolve(request.outputDirectory, `${baseName}.ffconcat.txt`);
  const outputPath = resolve(request.outputDirectory, `${baseName}.mp4`);
  const manifestPath = resolve(request.outputDirectory, `${baseName}.json`);
  let assemblyMode;
  if (seamPlan.hasContinuity) {
    const graph = buildHerrgottsFilter(seamPlan);
    const inputs = seamPlan.clips.flatMap((clip) => ['-i', clip.path]);
    await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-n', ...inputs, '-filter_complex', graph.filter, '-map', `[${graph.videoLabel}]`, '-map', `[${graph.audioLabel}]`, ...ffmpegVideoEncoderArgs(), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
    assemblyMode = 'herrgotts-metadata-seam-v2';
  } else if (!hasSilentClips && probes.every((probe) => mediaSignature(probe) === mediaSignature(probes[0])) && probes[0].width === frame.width && probes[0].height === frame.height) {
    writeFileSync(listPath, `ffconcat version 1.0\n${request.clips.map((clip) => `file '${ffmpegConcatPath(clip.path)}'`).join('\n')}\n`, 'utf8');
    await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-safe', '0', '-f', 'concat', '-i', listPath, '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', outputPath]);
    assemblyMode = 'lossless-concat';
  } else {
    const inputs = request.clips.flatMap((clip) => ['-i', clip.path]);
    const filters = [];
    request.clips.forEach((_, index) => {
      filters.push(`[${index}:v]scale=${frame.width}:${frame.height}:force_original_aspect_ratio=decrease,pad=${frame.width}:${frame.height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,setpts=PTS-STARTPTS[v${index}]`);
      filters.push(probes[index].audioPresent
        ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${index}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${probes[index].durationSec},asetpts=PTS-STARTPTS[a${index}]`);
    });
    filters.push(`${request.clips.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${request.clips.length}:v=1:a=1[vout][aout]`);
    await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-n', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', ...ffmpegVideoEncoderArgs(), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
    assemblyMode = hasSilentClips ? 'normalized-with-intentional-silence' : 'normalized-black-bars';
  }
  const outputProbe = await probeMedia(outputPath, processRunner);
  await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const result = {
    status: 'complete', filename: basename(outputPath), outputPath, mediaUrl: `/api/postproduction/media/${encodeURIComponent(basename(outputPath))}`,
    manifestPath, clipCount: request.clips.length, durationSec: outputProbe.durationSec, width: outputProbe.width, height: outputProbe.height,
    fps: outputProbe.fps, audioPresent: outputProbe.audioPresent, createdAt,
  };
  const sourceClips = seamPlan.clips;
  const sourceMedia = probes.map((probe, index) => seamPlan.hasContinuity
    ? { ...probe, originalDurationSec: probe.durationSec, durationSec: Number(sourceClips[index].effectiveDurationSec ?? probe.durationSec), headTrimFrames: sourceClips[index].headTrimFrames, tailTrimFrames: sourceClips[index].tailTrimFrames, crossfadeFrames: sourceClips[index].crossfadeFrames }
    : probe);
  writeFileSync(manifestPath, JSON.stringify({ ...result, assemblyMode, projectAspectRatio: request.projectAspectRatio, sourceClips, sourceMedia }, null, 2), 'utf8');
  return result;
}

export function buildWebFinalCompositionRequest(savedSession, options = {}) {
  const state = savedSession?.state;
  const post = state?.postProduction;
  if (!post || post.roughCutApproval !== 'approved' || post.roughCut?.status !== 'complete') throw new InputError('请先确认可播放的粗剪。');
  const roughCutPath = resolve(String(post.roughCut.outputPath || ''));
  if (!existsSync(roughCutPath)) throw new InputError('粗剪文件不存在，不能生成最终成片。');
  if (!['native', 'native_with_music', 'music_only'].includes(post.audioMode)) throw new InputError('请先确定最终声音方案。');
  let musicPath;
  if (post.audioMode !== 'native') {
    if (post.music?.status !== 'complete') throw new InputError('请先完成并试听配乐。');
    musicPath = resolve(String(post.music.outputPath || ''));
    if (!existsSync(musicPath)) throw new InputError('配乐文件不存在，不能生成最终成片。');
  }
  if (!['none', 'burned'].includes(post.subtitles)) throw new InputError('请先确定字幕方案。');
  const roughManifest = post.roughCut.manifestPath && existsSync(post.roughCut.manifestPath)
    ? JSON.parse(readFileSync(post.roughCut.manifestPath, 'utf8'))
    : null;
  const sourceClips = Array.isArray(roughManifest?.sourceClips) ? roughManifest.sourceClips : [];
  const sourceMedia = Array.isArray(roughManifest?.sourceMedia) ? roughManifest.sourceMedia : [];
  if (sourceClips.length === 0 || sourceClips.length !== sourceMedia.length) throw new InputError('粗剪清单缺少逐段时长，不能可靠定位字幕。');
  const totalDurationSec = Number(post.roughCut.durationSec);
  const subtitleCues = post.subtitles === 'burned' ? buildFinalSubtitleCues({
    ideaScript: state.ideaScript,
    videoPrompts: state.videoPrompts,
    segmentDurations: sourceClips.map((clip, index) => ({ segmentKey: clip.segmentKey, durationSec: Number(sourceMedia[index]?.durationSec) })),
    totalDurationSec,
  }) : [];
  if (post.subtitles === 'burned' && subtitleCues.length === 0) throw new InputError('已选择烧录字幕，但没有从已批准剧本和视频提示词中解析到字幕。');
  return {
    projectId: String(savedSession.id || 'local-project'), roughCutPath, musicPath, audioMode: post.audioMode, subtitles: post.subtitles,
    totalDurationSec, subtitleCues, outputDirectory: resolve(options.outputDirectory ?? resolve(RUNTIME_DATA_ROOT, 'compositions')),
  };
}

async function probeAudio(filePath, processRunner) {
  const result = await processRunner('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate', '-show_entries', 'format=duration', '-of', 'json', '--', filePath]);
  const parsed = JSON.parse(result.stdout || '{}');
  const audio = Array.isArray(parsed.streams) ? parsed.streams.find((stream) => stream.codec_type === 'audio') : null;
  if (!audio || !Number(parsed.format?.duration)) throw new InputError(`音频文件无法读取或时长无效：${basename(filePath)}`);
  return { codec: String(audio.codec_name || ''), channels: Number(audio.channels || 0), sampleRate: Number(audio.sample_rate || 0), durationSec: Number(parsed.format.duration) };
}

export async function runLocalFinalComposition(savedSession, options = {}) {
  const request = buildWebFinalCompositionRequest(savedSession, options);
  const processRunner = options.processRunner ?? runProcess;
  const createdAt = new Date().toISOString();
  const roughProbe = await probeMedia(request.roughCutPath, processRunner);
  if (!roughProbe.audioPresent && request.audioMode !== 'music_only') throw new InputError('最终声音方案需要原声，但粗剪没有音轨。');
  const musicProbe = request.musicPath ? await probeAudio(request.musicPath, processRunner) : undefined;
  if (musicProbe && Math.abs(musicProbe.durationSec - request.totalDurationSec) > 0.25) throw new InputError('配乐与粗剪时长偏差超过0.25秒，系统没有自动拉伸或截断。');
  mkdirSync(request.outputDirectory, { recursive: true });
  const stamp = createdAt.replace(/[-:.TZ]/gu, '').slice(0, 14);
  const baseName = `final-${request.projectId}-${stamp}`.replace(/[^a-zA-Z0-9._-]/gu, '_');
  const outputPath = resolve(request.outputDirectory, `${baseName}.mp4`);
  const subtitlePath = request.subtitles === 'burned' ? resolve(request.outputDirectory, `${baseName}.srt`) : undefined;
  const manifestPath = resolve(request.outputDirectory, `${baseName}.json`);
  if (subtitlePath) writeFileSync(subtitlePath, `\uFEFF${renderFinalSrt(request.subtitleCues)}`, 'utf8');
  const inputs = ['-i', request.roughCutPath];
  if (request.musicPath) inputs.push('-i', request.musicPath);
  const videoFilter = subtitlePath
    ? `[0:v]subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontName=Microsoft YaHei,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=1,Outline=2,Shadow=0,MarginV=28,Alignment=2'[vout]`
    : '[0:v]null[vout]';
  const duration = request.totalDurationSec.toFixed(6);
  const audioFilter = request.audioMode === 'native'
    ? `[0:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS,alimiter=limit=0.95[aout]`
    : request.audioMode === 'music_only'
      ? `[1:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.22,alimiter=limit=0.95[aout]`
      : `[0:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[native];[1:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.14[music];[music][native]sidechaincompress=threshold=0.035:ratio=6:attack=15:release=350[ducked];[native][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`;
  await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-n', ...inputs, '-filter_complex', `${videoFilter};${audioFilter}`, '-map', '[vout]', '-map', '[aout]', ...ffmpegVideoEncoderArgs(), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', duration, outputPath]);
  const outputProbe = await probeMedia(outputPath, processRunner);
  await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const result = {
    status: 'complete', filename: basename(outputPath), outputPath, mediaUrl: `/api/postproduction/media/${encodeURIComponent(basename(outputPath))}`,
    manifestPath, subtitlePath, subtitleCount: request.subtitleCues.length, durationSec: outputProbe.durationSec, width: outputProbe.width, height: outputProbe.height,
    fps: outputProbe.fps, audioPresent: outputProbe.audioPresent, audioMode: request.audioMode, createdAt,
  };
  writeFileSync(manifestPath, JSON.stringify({ ...result, roughCutPath: request.roughCutPath, musicPath: request.musicPath, roughMedia: roughProbe, musicMedia: musicProbe, subtitleCues: request.subtitleCues, mix: request.audioMode === 'native_with_music' ? { musicVolume: 0.14, sidechainThreshold: 0.035, ratio: 6, attackMs: 15, releaseMs: 350 } : null, automaticRetry: false }, null, 2), 'utf8');
  return result;
}

export function resolveStoredH3MediaPath(savedSession, externalTaskId) {
  const state = savedSession?.state || {};
  const directorTask = (Array.isArray(state.shotVideoTasks) ? state.shotVideoTasks : []).find((task) => task?.externalTaskId === externalTaskId);
  const freeNode = (Array.isArray(state.freeCanvas?.nodes) ? state.freeCanvas.nodes : []).find((node) => node?.generation?.externalTaskId === externalTaskId);
  const outputPaths = directorTask?.outputPaths || freeNode?.generation?.outputPaths || [];
  return outputPaths.map((item) => resolve(String(item))).find((item) => existsSync(item)) || '';
}

function resolveEditorMediaPath(savedSession, mediaUrl, expectedKind) {
  const value = requiredString(mediaUrl, '剪辑素材地址');
  const state = savedSession?.state || {};
  if (value.startsWith('/api/h3/media/')) {
    if (expectedKind !== 'video') throw new InputError('H3素材只能作为视频使用。');
    const externalTaskId = decodeURIComponent(value.slice('/api/h3/media/'.length));
    const mediaPath = resolveStoredH3MediaPath(savedSession, externalTaskId);
    if (!mediaPath) throw new InputError(`没有找到H3剪辑素材：${externalTaskId}`);
    return mediaPath;
  }
  if (value.startsWith('/api/free-canvas/imports/')) {
    const filename = decodeURIComponent(value.slice('/api/free-canvas/imports/'.length));
    if (basename(filename) !== filename) throw new InputError('导入剪辑素材地址无效。');
    const imported = classifyFreeCanvasImportedMedia(filename);
    if (expectedKind && imported.kind !== expectedKind) throw new InputError('导入剪辑素材类型不一致。');
    const mediaPath = resolve(FREE_CANVAS_IMPORT_DIRECTORY, filename);
    if (dirname(mediaPath) !== FREE_CANVAS_IMPORT_DIRECTORY || !existsSync(mediaPath)) throw new InputError('没有找到导入剪辑素材。');
    return mediaPath;
  }
  if (value.startsWith('/api/postproduction/media/')) {
    if (expectedKind !== 'video') throw new InputError('后期成片只能作为视频使用。');
    const filename = decodeURIComponent(value.slice('/api/postproduction/media/'.length));
    if (basename(filename) !== filename || !/\.mp4$/iu.test(filename)) throw new InputError('后期视频地址无效。');
    const mediaPath = resolve(RUNTIME_DATA_ROOT, 'compositions', filename);
    if (dirname(mediaPath) !== resolve(RUNTIME_DATA_ROOT, 'compositions') || !existsSync(mediaPath)) throw new InputError('没有找到后期视频素材。');
    return mediaPath;
  }
  if (value.startsWith('/api/postproduction/music-media/')) {
    if (expectedKind !== 'audio') throw new InputError('项目配乐只能作为音频使用。');
    const filename = decodeURIComponent(value.slice('/api/postproduction/music-media/'.length));
    if (basename(filename) !== filename || !/\.(mp3|wav)$/iu.test(filename)) throw new InputError('项目配乐地址无效。');
    const mediaPath = resolve(RUNTIME_DATA_ROOT, 'generated-audio', filename);
    if (dirname(mediaPath) !== resolve(RUNTIME_DATA_ROOT, 'generated-audio') || !existsSync(mediaPath)) throw new InputError('没有找到项目配乐。');
    return mediaPath;
  }
  throw new InputError('剪辑素材必须来自当前项目、自由画布导入或后期结果。');
}

function serveStoredH3Media(mediaPath, request, response) {
  const extension = extname(mediaPath).toLowerCase();
  const mime = extension === '.webm' ? 'video/webm' : extension === '.mov' ? 'video/quicktime' : extension === '.mkv' ? 'video/x-matroska' : 'video/mp4';
  const size = statSync(mediaPath).size;
  const range = request.headers.range;
  response.setHeader('Content-Type', mime);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match) throw new InputError('媒体Range请求无效。');
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || size));
    const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) throw new InputError('媒体Range超出文件范围。');
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(mediaPath, { start, end }).pipe(response);
    return;
  }
  response.setHeader('Content-Length', size);
  createReadStream(mediaPath).pipe(response);
}

export function buildWebEditorRenderRequest(savedSession, options = {}) {
  const editor = savedSession?.state?.editor;
  if (!editor || !Array.isArray(editor.clips) || editor.clips.length === 0) throw new InputError('请先把视频加入剪辑时间线。');
  const clips = editor.clips.slice(0, 500).map((clip, index) => {
    const sourceInSec = Number(clip.sourceInSec);
    const sourceOutSec = Number(clip.sourceOutSec);
    if (!Number.isFinite(sourceInSec) || !Number.isFinite(sourceOutSec) || sourceInSec < 0 || sourceOutSec - sourceInSec < 0.04) throw new InputError(`第${index + 1}个片段的入出点无效。`);
    return {
      id: optionalBoundedString(clip.id, 200) || `clip-${index + 1}`,
      assetId: optionalBoundedString(clip.assetId, 300), title: optionalBoundedString(clip.title, 160) || `片段 ${index + 1}`,
      mediaUrl: requiredString(clip.mediaUrl, `第${index + 1}个片段地址`), path: resolveEditorMediaPath(savedSession, clip.mediaUrl, 'video'),
      sourceInSec, sourceOutSec, durationSec: sourceOutSec - sourceInSec,
      nativeVolume: Math.max(0, Math.min(2, Number(clip.nativeVolume) || 0)),
      transition: clip.transition === 'fade' ? 'fade' : 'cut', fadeDurationSec: Math.max(0.05, Math.min(3, Number(clip.fadeDurationSec) || 0.25)),
    };
  });
  const totalDurationSec = clips.reduce((sum, clip) => sum + clip.durationSec, 0);
  if (totalDurationSec > 86_400) throw new InputError('剪辑时间线不能超过24小时。');
  const subtitles = (Array.isArray(editor.subtitles) ? editor.subtitles : []).filter((cue) => cue?.enabled !== false && String(cue?.text || '').trim()).slice(0, 2_000).map((cue, index) => {
    const startSec = Number(cue.startSec); const endSec = Number(cue.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || startSec >= totalDurationSec) throw new InputError(`第${index + 1}条字幕时间无效。`);
    return { startSec, endSec: Math.min(totalDurationSec, endSec), text: boundedString(cue.text, 2_000), source: 'editor' };
  });
  const audioClips = (Array.isArray(editor.audioClips) ? editor.audioClips : []).slice(0, 500).map((clip, index) => {
    const sourceInSec = Number(clip.sourceInSec); const sourceOutSec = Number(clip.sourceOutSec); const timelineStartSec = Number(clip.timelineStartSec);
    if (!Number.isFinite(sourceInSec) || !Number.isFinite(sourceOutSec) || sourceInSec < 0 || sourceOutSec - sourceInSec < 0.04) throw new InputError(`第${index + 1}个音频片段的入出点无效。`);
    if (!Number.isFinite(timelineStartSec) || timelineStartSec < 0 || timelineStartSec >= totalDurationSec) throw new InputError(`第${index + 1}个音频片段的时间线位置无效。`);
    const durationSec = sourceOutSec - sourceInSec;
    return {
      id: optionalBoundedString(clip.id, 200) || `audio-${index + 1}`,
      assetId: optionalBoundedString(clip.assetId, 300), title: optionalBoundedString(clip.title, 160) || `音频 ${index + 1}`,
      mediaUrl: requiredString(clip.mediaUrl, `第${index + 1}个音频片段地址`), path: resolveEditorMediaPath(savedSession, clip.mediaUrl, 'audio'),
      sourceInSec, sourceOutSec, durationSec, timelineStartSec, timelineDurationSec: Math.min(durationSec, totalDurationSec - timelineStartSec),
      volume: Math.max(0, Math.min(2, Number(clip.volume) || 0)),
      fadeInSec: Math.max(0, Math.min(30, Number(clip.fadeInSec) || 0)), fadeOutSec: Math.max(0, Math.min(30, Number(clip.fadeOutSec) || 0)),
    };
  });
  const musicPath = audioClips.length === 0 && editor.musicMediaUrl ? resolveEditorMediaPath(savedSession, editor.musicMediaUrl, 'audio') : undefined;
  return {
    projectId: String(savedSession.id || 'local-project'), clips, audioClips, totalDurationSec, subtitles, musicPath,
    projectAspectRatio: normalizeGenerationAspectRatio(savedSession?.state?.ratio),
    nativeVolume: Math.max(0, Math.min(2, Number(editor.nativeVolume) || 0)), musicVolume: Math.max(0, Math.min(2, Number(editor.musicVolume) || 0)),
    musicFadeInSec: Math.max(0, Math.min(30, Number(editor.musicFadeInSec) || 0)), musicFadeOutSec: Math.max(0, Math.min(30, Number(editor.musicFadeOutSec) || 0)),
    outputDirectory: resolve(options.outputDirectory ?? resolve(RUNTIME_DATA_ROOT, 'compositions')),
  };
}

export async function runLocalEditorRender(savedSession, options = {}) {
  const request = buildWebEditorRenderRequest(savedSession, options);
  const processRunner = options.processRunner ?? runProcess;
  const probes = await Promise.all(request.clips.map((clip) => probeMedia(clip.path, processRunner)));
  const audioProbes = await Promise.all(request.audioClips.map((clip) => probeMedia(clip.path, processRunner)));
  request.clips.forEach((clip, index) => {
    if (clip.sourceOutSec > probes[index].durationSec + 0.05) throw new InputError(`片段“${clip.title}”的出点超过源视频时长。`);
  });
  request.audioClips.forEach((clip, index) => {
    if (!audioProbes[index].audioPresent) throw new InputError(`音频片段“${clip.title}”没有可用音轨。`);
    if (clip.sourceOutSec > audioProbes[index].durationSec + 0.05) throw new InputError(`音频片段“${clip.title}”的出点超过源音频时长。`);
  });
  const { width, height } = editorFrameSize(request.projectAspectRatio, probes[0]);
  const createdAt = new Date().toISOString(); const duration = request.totalDurationSec.toFixed(6);
  mkdirSync(request.outputDirectory, { recursive: true });
  const stamp = createdAt.replace(/[-:.TZ]/gu, '').slice(0, 14); const baseName = `edit-${request.projectId}-${stamp}`.replace(/[^a-zA-Z0-9._-]/gu, '_');
  const outputPath = resolve(request.outputDirectory, `${baseName}.mp4`); const manifestPath = resolve(request.outputDirectory, `${baseName}.json`);
  const subtitlePath = request.subtitles.length ? resolve(request.outputDirectory, `${baseName}.srt`) : undefined;
  if (subtitlePath) writeFileSync(subtitlePath, `\uFEFF${renderFinalSrt(request.subtitles)}`, 'utf8');
  const inputArgs = request.clips.flatMap((clip) => ['-i', clip.path]);
  request.audioClips.forEach((clip) => inputArgs.push('-i', clip.path));
  if (request.musicPath) inputArgs.push('-i', request.musicPath);
  const filters = [];
  request.clips.forEach((clip, index) => {
    const clipDuration = clip.durationSec.toFixed(6); const fade = Math.min(clip.fadeDurationSec, Math.max(0.05, clip.durationSec / 2)).toFixed(6);
    const fadeFilter = clip.transition === 'fade' ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0, clip.durationSec - Number(fade)).toFixed(6)}:d=${fade}` : '';
    filters.push(`[${index}:v]trim=start=${clip.sourceInSec.toFixed(6)}:end=${clip.sourceOutSec.toFixed(6)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,format=yuv420p${fadeFilter}[v${index}]`);
    if (probes[index].audioPresent) filters.push(`[${index}:a]atrim=start=${clip.sourceInSec.toFixed(6)}:end=${clip.sourceOutSec.toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${(clip.nativeVolume * request.nativeVolume).toFixed(6)}[a${index}]`);
    else filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${clipDuration},asetpts=PTS-STARTPTS[a${index}]`);
  });
  filters.push(`${request.clips.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${request.clips.length}:v=1:a=1[joinedv][native]`);
  filters.push(subtitlePath ? `[joinedv]subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontName=Microsoft YaHei,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=1,Outline=2,Shadow=0,MarginV=28,Alignment=2'[vout]` : '[joinedv]null[vout]');
  const audioLabels = [];
  request.audioClips.forEach((clip, index) => {
    const inputIndex = request.clips.length + index; const clipDuration = clip.timelineDurationSec;
    const sourceEnd = clip.sourceInSec + clipDuration; const fadeIn = Math.min(clip.fadeInSec, clipDuration).toFixed(6); const fadeOut = Math.min(clip.fadeOutSec, clipDuration).toFixed(6); const fadeOutStart = Math.max(0, clipDuration - Number(fadeOut)).toFixed(6); const delayMs = Math.max(0, Math.round(clip.timelineStartSec * 1_000));
    const label = `audio${index}`; audioLabels.push(`[${label}]`);
    const fadeInFilter = Number(fadeIn) > 0 ? `,afade=t=in:st=0:d=${fadeIn}` : ''; const fadeOutFilter = Number(fadeOut) > 0 ? `,afade=t=out:st=${fadeOutStart}:d=${fadeOut}` : '';
    filters.push(`[${inputIndex}:a]atrim=start=${clip.sourceInSec.toFixed(6)}:end=${sourceEnd.toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${clip.volume.toFixed(6)}${fadeInFilter}${fadeOutFilter},adelay=${delayMs}|${delayMs},apad,atrim=duration=${duration}[${label}]`);
  });
  if (audioLabels.length) {
    filters.push(`[native]${audioLabels.join('')}amix=inputs=${audioLabels.length + 1}:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
  } else if (request.musicPath) {
    const musicIndex = request.clips.length + request.audioClips.length; const fadeIn = Math.min(request.musicFadeInSec, request.totalDurationSec).toFixed(6); const fadeOut = Math.min(request.musicFadeOutSec, request.totalDurationSec).toFixed(6); const fadeOutStart = Math.max(0, request.totalDurationSec - Number(fadeOut)).toFixed(6);
    filters.push(`[${musicIndex}:a]aresample=48000,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${request.musicVolume.toFixed(6)},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}[music]`);
    filters.push('[native][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]');
  } else filters.push('[native]alimiter=limit=0.95[aout]');
  await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-n', ...inputArgs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', ...ffmpegVideoEncoderArgs(), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', duration, outputPath]);
  const outputProbe = await probeMedia(outputPath, processRunner);
  await processRunner('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const result = { status: 'complete', filename: basename(outputPath), outputPath, mediaUrl: `/api/postproduction/media/${encodeURIComponent(basename(outputPath))}`, manifestPath, subtitlePath, clipCount: request.clips.length, audioClipCount: request.audioClips.length, subtitleCount: request.subtitles.length, durationSec: outputProbe.durationSec, width: outputProbe.width, height: outputProbe.height, fps: outputProbe.fps, audioPresent: outputProbe.audioPresent, createdAt };
  writeFileSync(manifestPath, JSON.stringify({ ...result, clips: request.clips, audioClips: request.audioClips, sourceMedia: probes, audioSourceMedia: audioProbes, musicPath: request.musicPath, mix: { nativeVolume: request.nativeVolume, musicVolume: request.musicVolume, musicFadeInSec: request.musicFadeInSec, musicFadeOutSec: request.musicFadeOutSec }, subtitles: request.subtitles, automaticRetry: false }, null, 2), 'utf8');
  return result;
}

export function editorFrameSize(aspectRatio, source = {}) {
  const longest = Math.max(Number(source.width) || 0, Number(source.height) || 0);
  const tier = longest > 1500 ? '1080p' : longest > 900 ? '720p' : '480p';
  const sizes = {
    '480p': { '16:9': [854, 480], '9:16': [480, 854], '1:1': [640, 640], '4:3': [640, 480], '3:4': [480, 640] },
    '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960], '4:3': [960, 720], '3:4': [720, 960] },
    '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] },
  };
  const [rawWidth, rawHeight] = sizes[tier][normalizeGenerationAspectRatio(aspectRatio)];
  return { width: rawWidth - rawWidth % 2, height: rawHeight - rawHeight % 2 };
}

function servePostProductionMedia(filename, request, response) {
  if (!/^[a-zA-Z0-9._-]+\.mp4$/u.test(filename)) throw new InputError('粗剪媒体路径无效。');
  const mediaPath = resolve(RUNTIME_DATA_ROOT, 'compositions', filename);
  if (!existsSync(mediaPath)) throw new InputError('没有找到这份粗剪视频。');
  const size = statSync(mediaPath).size;
  const range = request.headers.range;
  response.setHeader('Content-Type', 'video/mp4');
  response.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match) throw new InputError('媒体Range请求无效。');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) throw new InputError('媒体Range超出文件范围。');
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(mediaPath, { start, end }).pipe(response);
    return;
  }
  response.setHeader('Content-Length', size);
  createReadStream(mediaPath).pipe(response);
}

function serveGeneratedMusic(filename, request, response) {
  if (!/^[a-zA-Z0-9._-]+\.(mp3|wav)$/u.test(filename)) throw new InputError('配乐媒体路径无效。');
  const mediaPath = resolve(RUNTIME_DATA_ROOT, 'generated-audio', filename);
  if (dirname(mediaPath) !== resolve(RUNTIME_DATA_ROOT, 'generated-audio') || !existsSync(mediaPath)) throw new InputError('没有找到这份配乐文件。');
  const size = statSync(mediaPath).size;
  const range = request.headers.range;
  response.setHeader('Content-Type', extname(filename).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg');
  response.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match) throw new InputError('媒体Range请求无效。');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) throw new InputError('媒体Range超出文件范围。');
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(mediaPath, { start, end }).pipe(response);
    return;
  }
  response.setHeader('Content-Length', size);
  createReadStream(mediaPath).pipe(response);
}

export function classifyFreeCanvasImportedMedia(filename, contentType = '') {
  const extension = extname(String(filename || '')).toLowerCase();
  const normalizedType = String(contentType || '').trim().toLowerCase().split(';', 1)[0];
  const mimeKind = normalizedType.startsWith('image/') ? 'image' : normalizedType.startsWith('video/') ? 'video' : normalizedType.startsWith('audio/') ? 'audio' : '';
  const extensionKind = Object.entries(FREE_CANVAS_IMPORT_EXTENSIONS).find(([, extensions]) => extensions.has(extension))?.[0] || '';
  const kind = mimeKind || extensionKind;
  if (!kind || (mimeKind && extensionKind && mimeKind !== extensionKind)) throw new InputError('只能导入可识别的图片、视频或音频文件。');
  const mimeExtension = ({
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v', 'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/flac': '.flac',
  })[normalizedType];
  const safeExtension = mimeExtension || (extensionKind === kind ? extension : kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.wav');
  return { kind, extension: safeExtension };
}

function importedMediaContentType(filename) {
  const extension = extname(filename).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  })[extension] || 'application/octet-stream';
}

async function saveFreeCanvasImport(request) {
  const encodedName = String(request.headers['x-file-name'] || '');
  let originalName = 'local-media';
  try { originalName = decodeURIComponent(encodedName) || originalName; } catch { throw new InputError('导入文件名无效。'); }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > FREE_CANVAS_IMPORT_MAX_BYTES) throw new InputError('单个导入文件不能超过2GB。');
  const { kind, extension } = classifyFreeCanvasImportedMedia(originalName, request.headers['content-type']);
  mkdirSync(FREE_CANVAS_IMPORT_DIRECTORY, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  const mediaPath = resolve(FREE_CANVAS_IMPORT_DIRECTORY, filename);
  const descriptor = openSync(mediaPath, 'wx');
  let total = 0;
  try {
    for await (const chunk of request) {
      total += chunk.length;
      if (total > FREE_CANVAS_IMPORT_MAX_BYTES) throw new InputError('单个导入文件不能超过2GB。');
      writeSync(descriptor, chunk);
    }
  } catch (error) {
    closeSync(descriptor);
    if (existsSync(mediaPath)) unlinkSync(mediaPath);
    throw error;
  }
  closeSync(descriptor);
  if (total === 0) { unlinkSync(mediaPath); throw new InputError('导入文件为空。'); }
  return { kind, filename, originalName: originalName.slice(0, 500), size: total, mediaUrl: `/api/free-canvas/imports/${encodeURIComponent(filename)}` };
}

function serveFreeCanvasImport(filename, request, response) {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/iu.test(filename)) throw new InputError('导入媒体地址无效。');
  classifyFreeCanvasImportedMedia(filename);
  const mediaPath = resolve(FREE_CANVAS_IMPORT_DIRECTORY, filename);
  if (dirname(mediaPath) !== FREE_CANVAS_IMPORT_DIRECTORY || !existsSync(mediaPath)) throw new InputError('没有找到这份导入媒体。');
  const size = statSync(mediaPath).size;
  response.setHeader('Content-Type', importedMediaContentType(filename));
  response.setHeader('Accept-Ranges', 'bytes');
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match) throw new InputError('媒体Range请求无效。');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) throw new InputError('媒体Range超出文件范围。');
    response.statusCode = 206;
    response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.setHeader('Content-Length', end - start + 1);
    createReadStream(mediaPath, { start, end }).pipe(response);
    return;
  }
  response.setHeader('Content-Length', size);
  createReadStream(mediaPath).pipe(response);
}

export async function runLocalGpuTask(coordinator, input, task) {
  try {
    return await coordinator.runExclusive(input, task);
  } catch (error) {
    if (error instanceof LocalGpuBusyError) throw new InputError(error.message);
    throw error;
  }
}

export async function prepareH3MemoryForLocalGpuTask(h3Provider) {
  try {
    return await h3Provider.releaseMemoryIfIdle();
  } catch (error) {
    if (error instanceof PrismH3ProviderError && error.code === 'queue_busy') throw new InputError('PRISM H3当前仍有视频任务；请等待队列清空。');
    if (error instanceof PrismH3ProviderError) throw new InputError(`无法安全释放PRISM H3模型显存：${error.message}`);
    throw error;
  }
}

export async function preserveUsableAssetDraft(work) {
  try { return await work(); }
  catch (error) {
    if (!(error instanceof ProductionDirectorStageError)) throw error;
    const failure = error.failure;
    const diagnostics = failure?.diagnostics ?? {};
    const detail = [agentOperationLabel(diagnostics.operation), failure?.code, diagnostics.externalTaskId ? `请求ID：${diagnostics.externalTaskId}` : '', failure?.message].filter(Boolean).join('；');
    return { output: error.draft, reviewWarning: `提案已保留，待你确认。总导演复核未完成：${detail || '返回结果不可用'}。`, supervision: { stage: error.stage, status: 'incomplete', directorReviews: [], failure: { code: failure?.code, message: failure?.message, diagnostics } } };
  }
}

export async function executeProductionJob(store, route, payload) {
      const methods = { '/api/characters/profiles': 'runCharacterProfiles', '/api/scenes/proposals': 'runSceneProposals', '/api/props/proposals': 'runPropProposals', '/api/storyboards/segments': 'runStoryboardSegments', '/api/storyboards/board-plans': 'runStoryboardBoardPlans', '/api/storyboards/boards': 'runStoryboardBoards', '/api/videos/prompts': 'runVideoPrompts', '/api/videos/prompts/repair': 'repairVideoPrompt' };
      if (route === '/api/videos/prompts' || route === '/api/storyboards/boards') {
        const keys = payload.requestedSegmentKeys ?? payload.segments.map(item => item.segmentKey);
        const processSegment = async segmentKey => {
          try {
            const result = await store[methods[route]]({ ...payload, requestedSegmentKeys: [segmentKey] });
            productionCheckpoint(result); return result;
          } catch (error) { return { error: `${segmentKey}：${safeIdeaAgentMessage(error)}` }; }
        };
        const results = route === '/api/storyboards/boards'
          ? await mapImageRequests(keys, processSegment)
          : await mapWithConcurrencyOrdered(keys, sharedRequestScheduler.status().limits.textConcurrency, processSegment);
        return { plans: results.flatMap(result => result.plans ?? []), prompts: results.flatMap(result => result.prompts ?? []), boards: results.flatMap(result => result.boards ?? []), error: results.map(result => result.error).filter(Boolean).join('；') };
      }
      try { return await store[methods[route]](payload); }
      catch (error) {
        const message = route === '/api/props/proposals' ? safePropAgentMessage(error) : route === '/api/scenes/proposals' ? safeSceneAgentMessage(error) : route === '/api/characters/profiles' ? safeCharacterAgentMessage(error) : route === '/api/storyboards/segments' ? safeStoryboardAgentMessage(error) : safeIdeaAgentMessage(error);
        productionCheckpoint({ ...structuredInputError(error), complete: false, error: message });
        throw error;
      }
}

export function recoverStoryboardJobResult(job) {
  if (job.route !== '/api/storyboards/segments' || job.result?.outline?.length || job.result?.complete === true) return null;
  const call = [...(job.calls ?? [])].reverse().find(call => call.phase === 'completed' && ['plan-storyboard-evidence', 'repair-storyboard-evidence'].includes(call.operation) && Array.isArray(call.output?.items) && call.output.items.length);
  if (!call || !String(job.error ?? '').includes('Storyboard prompt validation failed')) return null;
  try {
    const outline = structuredClone(call.output.items);
    const issues = collectStoryboardOutlineIssues(outline, { script: toApprovedDomainScript(job.payload.script), segmentDurationSec: job.payload.segmentDurationSec });
    return { ...job.result, outline, segments: job.result?.segments ?? [], complete: false,
      recoveredFromCallId: call.callId, validationIssues: issues,
      error: issues.length ? `文字分镜规划未通过校验：${issues.join('；')}` : job.result?.error,
    };
  } catch { return null; }
}

export function createLocalApiRuntime(options = {}) {
  const store = createProviderSettingsStore({
    knownCharacters: () => knownCharacterAnchors(creativeSessions.load(), creativeSessions.characterCatalog()),
    filePath: options.providerSettingsStorage ? null : resolve(RUNTIME_DATA_ROOT, 'private/provider-settings.json'),
    persistence: options.providerSettingsStorage,
    generatedImageDirectory: resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'),
    generatedMusicDirectory: resolve(RUNTIME_DATA_ROOT, 'generated-audio'),
    ...(options.providerStoreOptions ?? {}),
  });
  const promptMasterStore = createProviderSettingsStore({
    filePath: options.promptMasterProviderSettingsStorage ? null : resolve(RUNTIME_DATA_ROOT, 'private/prompt-director-provider-settings.json'),
    persistence: options.promptMasterProviderSettingsStorage,
  });
  const appSettings = createAppSettingsStore({ filePath: resolve(RUNTIME_DATA_ROOT, 'web/app-settings.json') });
  if (!store.status().some((provider) => provider.kind === 'h3' && provider.configured)) {
    store.configure({ kind: 'h3', baseUrl: 'http://127.0.0.1:8188' });
  }
  const creativeSessions = createCreativeSessionStore();
  const productionSettingsPath = resolve(RUNTIME_DATA_ROOT, 'web/production-settings.json');
  if (existsSync(productionSettingsPath)) {
    try { sharedRequestScheduler.configure(JSON.parse(readFileSync(productionSettingsPath, 'utf8'))); } catch { /* Keep conservative defaults for damaged settings. */ }
  }
  const productionJobs = createProductionJobStore({
    directory: resolve(RUNTIME_DATA_ROOT, 'web/production-jobs'), sessions: creativeSessions,
    recoverResult: recoverStoryboardJobResult,
    execute: (route, payload) => executeProductionJob(store, route, payload),
  });
  const assetLibrary = createAssetLibraryStore();
  const assetReplacementUndo = createAssetReplacementUndoStore();
  const h3Provider = options.h3Provider ?? new PrismH3Provider();
  const videoJobs = options.videoJobs ?? createVideoJobStore({
    directory: resolve(RUNTIME_DATA_ROOT, 'web/video-jobs'),
    outputDirectory: resolve(RUNTIME_DATA_ROOT, 'generated-videos'),
    configuration: (kind, profileId, revision) => store.videoConfiguration(kind, profileId, revision),
    providerFactory: options.videoProviderFactory,
    probeMedia: async path => {
      const metadata = await probeMedia(path, runProcess);
      await runProcess('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
      return metadata;
    },
  });
  const localMusicProvider = options.localMusicProvider ?? new AceStepMusicProvider({
    projectDirectory: process.env.ACESTEP_PROJECT_ROOT ?? 'E:/AI/ACE-Step-1.5',
    executablePath: process.env.ACESTEP_API_EXECUTABLE ?? 'E:/AI/ACE-Step-1.5/.venv/Scripts/python.exe',
    outputDirectory: resolve(RUNTIME_DATA_ROOT, 'generated-audio'),
    seedFactory: () => 20260826,
    overGenerateRatio: 1.25,
    fadeOutSec: 1,
  });
  const localMusicRuntime = { provider: localMusicProvider, running: false };
  const localGpuCoordinator = options.localGpuCoordinator ?? new LocalGpuCoordinator();
  const localImageTools = options.localImageTools ?? new LocalImageToolsProvider({
    outputDirectory: resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'),
    realEsrganExecutable: process.env.REALESRGAN_EXECUTABLE ?? (existsSync('E:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe')
      ? 'E:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe'
      : 'D:/AI/Real-ESRGAN/runtime/realesrgan-ncnn-vulkan.exe'),
  });
  const launchPrism = options.launchPrism ?? launchPrismH3Console;
  const connectPrism = options.connectPrism ?? ((connectOptions = {}) => connectPrismH3Console({ provider: h3Provider, launch: launchPrism, ...connectOptions }));
  const createRoughCut = options.createRoughCut ?? runLocalRoughCut;
  const createFinalComposition = options.createFinalComposition ?? runLocalFinalComposition;
  const createEditorRender = options.createEditorRender ?? runLocalEditorRender;

  return {
    handle(request, response) {
      return handleRequest(store, promptMasterStore, appSettings, creativeSessions, assetLibrary, assetReplacementUndo, h3Provider, localMusicRuntime, localImageTools, localGpuCoordinator, launchPrism, createRoughCut, createFinalComposition, createEditorRender, request, response, productionJobs, productionSettingsPath, videoJobs);
    },
    close() { videoJobs.close?.(); },
  };
}

export function createLocalApiPlugin(options = {}) {
  const runtime = createLocalApiRuntime(options);
  const attachMiddleware = (server) => {
    server.middlewares.use(async (request, response, next) => {
      const handled = await runtime.handle(request, response);
      if (!handled) next();
    });
  };

  return {
    name: 'prism-local-provider-settings',
    configureServer: attachMiddleware,
    configurePreviewServer: attachMiddleware,
  };
}

async function handleRequest(store, promptMasterStore, appSettings, creativeSessions, assetLibrary, assetReplacementUndo, h3Provider, localMusicRuntime, localImageTools, localGpuCoordinator, launchPrism, createRoughCut, createFinalComposition, createEditorRender, request, response, productionJobs, productionSettingsPath, videoJobs) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/production-') && !url.pathname.startsWith('/api/prompt-master') && !url.pathname.startsWith('/api/app-settings') && !url.pathname.startsWith('/api/provider-settings') && !url.pathname.startsWith('/api/idea-agent') && !url.pathname.startsWith('/api/project-manager') && !url.pathname.startsWith('/api/novel-adaptation') && !url.pathname.startsWith('/api/script') && !url.pathname.startsWith('/api/free-canvas') && !url.pathname.startsWith('/api/characters') && !url.pathname.startsWith('/api/scenes') && !url.pathname.startsWith('/api/props') && !url.pathname.startsWith('/api/storyboards') && !url.pathname.startsWith('/api/videos') && !url.pathname.startsWith('/api/h3') && !url.pathname.startsWith('/api/postproduction') && !url.pathname.startsWith('/api/editor') && !url.pathname.startsWith('/api/style-presets') && !url.pathname.startsWith('/api/generated-images') && !url.pathname.startsWith('/api/creative-session') && !url.pathname.startsWith('/api/projects') && !url.pathname.startsWith('/api/asset-library')) return false;

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');

  try {
    if (request.method === 'POST' && WORKFLOW_STAGE_BY_MUTATION_ROUTE[url.pathname]) {
      requireWorkflowDependenciesForRoute(creativeSessions.load(), url.pathname);
    }
    if (url.pathname === '/api/production-settings') {
      if (request.method === 'PUT') {
        const input = await readJson(request);
        try { sharedRequestScheduler.configure(input); } catch (error) { throw new InputError(error.message); }
        writeJsonAtomically(productionSettingsPath, sharedRequestScheduler.status().limits);
      }
      response.end(JSON.stringify(sharedRequestScheduler.status())); return true;
    }
    if (url.pathname === '/api/production-jobs' && request.method === 'POST') {
      const input = await readJson(request, 12_000_000);
      requireWorkflowDependenciesForRoute(creativeSessions.load(), input.route);
      requireSegmentApprovalForRoute(creativeSessions.load(), input.route, input.payload);
      response.statusCode = 202;
      response.end(JSON.stringify({ job: productionJobs.submit(input) })); return true;
    }
    if (url.pathname === '/api/production-jobs' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId') || creativeSessions.load()?.id;
      response.end(JSON.stringify({ jobs: productionJobs.list(projectId), scheduler: sharedRequestScheduler.status() })); return true;
    }
    if (url.pathname.startsWith('/api/production-jobs/') && request.method === 'GET') {
      const id = url.pathname.slice('/api/production-jobs/'.length);
      const job = url.searchParams.get('diagnostics') === '1' ? productionJobs.diagnostic(id) : productionJobs.get(id);
      if (!job) throw new InputError('没有找到任务记录。');
      const current = creativeSessions.load();
      if (current?.id === job.projectId) job.stale = !productionJobs.matches(id, current.state);
      response.end(JSON.stringify({ job })); return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/style-presets') {
      response.end(JSON.stringify({ presets: STYLE_PRESETS.map(({ id, name, description, styleAnchor, category, recommendationPriority, previewPalette, previewLabel, previewMediaPath }) => ({ id, name, description, styleAnchor, category, recommendationPriority, previewPalette, previewLabel, imageUrl: `/api/style-presets/${encodeURIComponent(id)}` })) }));
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/style-presets/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/style-presets/'.length));
      const preset = getStylePreset(id);
      const previewPath = resolve(APP_RESOURCE_ROOT, preset.previewMediaPath);
      if (!existsSync(previewPath)) throw new InputError('没有找到这个画风的预览图。');
      response.setHeader('Content-Type', extname(previewPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg');
      response.end(readFileSync(previewPath));
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/generated-images/')) {
      const filename = basename(decodeURIComponent(url.pathname.slice('/api/generated-images/'.length)));
      if (!/^[a-zA-Z0-9._-]+\.(png|webp|jpe?g)$/i.test(filename)) throw new InputError('生成图片路径无效。');
      const imagePath = resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters', filename);
      if (!existsSync(imagePath)) throw new InputError('没有找到这张生成图片。');
      response.setHeader('Content-Type', extname(filename).toLowerCase() === '.png' ? 'image/png' : extname(filename).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg');
      response.end(readFileSync(imagePath));
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/api/app-settings') {
      const status = appSettings.status();
      const providerStatus = store.status();
      response.end(JSON.stringify({
        ...status,
        diagnostics: {
          ...status.diagnostics,
          configuredProviders: providerStatus.filter((provider) => provider.configured).length,
          totalProviders: providerStatus.length,
        },
      }));
      return true;
    }

    if (request.method === 'PUT' && url.pathname === '/api/app-settings') {
      const input = await readJson(request);
      response.end(JSON.stringify(appSettings.update(input)));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/provider-settings/status') {
      response.end(JSON.stringify({ providers: store.status() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-settings/configure') {
      const input = await readJson(request);
      response.end(JSON.stringify({ provider: store.configure(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-settings/activate') {
      const input = await readJson(request);
      response.end(JSON.stringify({ provider: store.activate(String(input.kind ?? ''), String(input.profileId ?? '')) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-settings/remove') {
      const input = await readJson(request);
      response.end(JSON.stringify({ provider: store.remove(String(input.kind ?? ''), String(input.profileId ?? '')) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/provider-settings/test') {
      const input = await readJson(request);
      response.end(JSON.stringify({ result: await store.test(String(input.kind ?? ''), optionalBoundedString(input.profileId, 100)) }));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/prompt-master/provider-settings/status') {
      response.end(JSON.stringify({ provider: promptMasterStore.status().find((item) => item.kind === 'agent') }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/prompt-master/provider-settings/configure') {
      const input = await readJson(request);
      response.end(JSON.stringify({ provider: promptMasterStore.configure({ ...input, kind: 'agent' }) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/prompt-master/provider-settings/test') {
      const input = await readJson(request);
      response.end(JSON.stringify({ result: await promptMasterStore.test('agent', optionalBoundedString(input.profileId, 100)) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/prompt-master/provider-settings/remove') {
      const input = await readJson(request);
      response.end(JSON.stringify({ provider: promptMasterStore.remove('agent', requiredString(input?.profileId, '模型配置ID')) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/prompt-master/generate') {
      const input = await readJson(request, 200_000);
      response.end(JSON.stringify({ result: await promptMasterStore.runPromptDirector(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/idea-agent/turn') {
      const input = await readJson(request);
      response.end(JSON.stringify({ turn: await store.runIdeaTurn(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/idea-agent/tones') {
      const input = await readJson(request, 50_000);
      response.end(JSON.stringify({ recommendations: await store.recommendIdeaTones(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/project-manager/turn') {
      const input = await readJson(request, 200_000);
      const session = creativeSessions.load();
      response.end(JSON.stringify(await store.runProjectManagerTurn(session, input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/novel-adaptation/script') {
      const input = await readJson(request, 500_000);
      response.end(JSON.stringify({ script: await store.runNovelAdaptation(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/script/revise') {
      const input = await readJson(request, 700_000);
      response.end(JSON.stringify({ script: await store.runScriptRevision(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/script/episode') {
      const input = await readJson(request, 700_000);
      response.end(JSON.stringify({ script: await store.runSeriesEpisodeScript(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/optimize-prompt') {
      const input = await readJson(request, 30_000);
      response.end(JSON.stringify({ optimizedPrompt: await store.runFreeCanvasPromptOptimization(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/imports') {
      response.end(JSON.stringify({ asset: await saveFreeCanvasImport(request) }));
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/free-canvas/imports/')) {
      const filename = basename(decodeURIComponent(url.pathname.slice('/api/free-canvas/imports/'.length)));
      serveFreeCanvasImport(filename, request, response);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/generate-image') {
      const input = await readJson(request, 80_000);
      response.end(JSON.stringify(await store.runFreeCanvasImageGeneration(input)));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/free-canvas/image-tools/status') {
      response.end(JSON.stringify({ health: await localImageTools.health() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/image-tools') {
      const input = await readJson(request, 30_000);
      const taskId = requiredString(input?.taskId, '图片工具任务ID');
      const mediaUrl = requiredString(input?.mediaUrl, '待处理图片');
      const operation = requiredString(input?.operation, '图片工具操作');
      const sourcePath = freeCanvasReferenceMediaPath(mediaUrl, 'image', resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters'), '待处理图片');
      const runImageTool = () => localImageTools.run({
        taskId, sourcePath, operation,
        upscaleScale: input?.upscaleScale === 4 ? 4 : 2,
        upscaleModel: input?.upscaleModel === 'anime' ? 'anime' : 'general',
      });
      const result = operation === 'upscale'
        ? await runLocalGpuTask(localGpuCoordinator, { kind: 'image-upscale', taskId, label: 'Real-ESRGAN图片超分' }, async () => {
          await prepareH3MemoryForLocalGpuTask(h3Provider);
          return await runImageTool();
        })
        : await runImageTool();
      response.end(JSON.stringify({
        taskId: result.taskId,
        provider: result.provider,
        operation: result.operation,
        imageUrl: `/api/generated-images/${encodeURIComponent(basename(result.outputPath))}`,
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
        parameters: result.parameters,
      }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/generate-video') {
      const input = await readJson(request, 180_000);
      const generationRequest = buildFreeCanvasH3GenerationRequest(input);
      if (['minimax', 'seedance'].includes(input.settings?.engine)) {
        const session = creativeSessions.load();
        if (!session || input.projectId !== session.id) throw new InputError('当前项目已切换，请回到这个视频节点所在项目再提交。');
        try {
          const task = await videoJobs.submit({ projectId: session.id, segmentKey: `free:${input.nodeId}`, engine: input.settings.engine,
            profileId: input.settings.profileId, requestId: input.taskId,
            request: { taskId: input.taskId, title: generationRequest.title, prompt: generationRequest.prompt,
              referenceMediaPaths: generationRequest.referenceMediaPaths, referenceLabels: generationRequest.referenceLabels,
              referenceMedia: generationRequest.referenceMedia, referenceAssetIds: generationRequest.referenceAssetIds,
              mode: generationRequest.mode, aspectRatio: generationRequest.aspectRatio, durationSec: generationRequest.durationSec,
              cloudResolution: input.settings.cloudResolution, generateAudio: input.settings.generateAudio === true,
              ...(input.settings.engine === 'seedance' ? { seed: Number.isInteger(input.settings.seed) ? input.settings.seed : stableVideoSeed(input.taskId) } : {}) },
          });
          response.statusCode = 202; response.end(JSON.stringify({ task })); return true;
        } catch (error) { throw new InputError(error.message); }
      }
      if (input.settings?.engine && input.settings.engine !== 'local') throw new InputError('视频生成方式无效。');
      const task = await runLocalGpuTask(localGpuCoordinator, { kind: 'h3-submit', taskId: generationRequest.taskId, label: 'PRISM H3视频提交' }, async () => await h3Provider.submit(generationRequest));
      response.end(JSON.stringify({ task }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/free-canvas/generate-audio') {
      const input = await readJson(request, 80_000);
      if (localMusicRuntime.running) throw new InputError('本机 ACE-Step 1.5已有一项音频任务在运行。');
      const generationRequest = buildFreeCanvasAudioGenerationRequest(input);
      const task = await runLocalGpuTask(localGpuCoordinator, { kind: 'ace-music', taskId: generationRequest.taskId, label: 'ACE-Step音乐生成' }, async () => {
        await prepareH3MemoryForLocalGpuTask(h3Provider);
        localMusicRuntime.running = true;
        try { return await localMusicRuntime.provider.submit(generationRequest); }
        finally { localMusicRuntime.running = false; }
      });
      response.end(JSON.stringify({ audio: musicTaskResult(task) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/characters/profiles') {
      const input = await readJson(request, 700_000);
      response.end(JSON.stringify(await store.runCharacterProfiles(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/characters/images') {
      const input = await readJson(request, 900_000);
      response.end(JSON.stringify(await store.runCharacterImages(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/characters/revise-design') {
      const input = await readJson(request, 800_000);
      response.end(JSON.stringify(await store.runCharacterDesignRevision(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/characters/turnaround') {
      const input = await readJson(request, 100_000);
      response.end(JSON.stringify({ turnaround: await store.runCharacterTurnaround(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenes/proposals') {
      const input = await readJson(request, 1_500_000);
      response.end(JSON.stringify(await store.runSceneProposals(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenes/images') {
      const input = await readJson(request, 2_500_000);
      response.end(JSON.stringify(await store.runSceneImages(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenes/views') {
      const input = await readJson(request, 200_000);
      response.end(JSON.stringify({ view: await store.runSceneView(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/scenes/view-candidates') {
      const input = await readJson(request, 20_000);
      response.end(JSON.stringify({ view: store.recoverSceneViewCandidates(input) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/props/proposals') {
      const input = await readJson(request, 1_500_000);
      response.end(JSON.stringify(await store.runPropProposals(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/props/images') {
      const input = await readJson(request, 2_500_000);
      response.end(JSON.stringify(await store.runPropImages(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/props/revise-design') {
      const input = await readJson(request, 1_500_000);
      response.end(JSON.stringify(await store.runPropDesignRevision(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/storyboards/segments') {
      const input = await readJson(request, 4_000_000);
      response.end(JSON.stringify(await store.runStoryboardSegments(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/storyboards/boards') {
      const input = await readJson(request, 8_000_000);
      response.end(JSON.stringify(await store.runStoryboardBoards(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/storyboards/board-plans') {
      const input = await readJson(request, 8_000_000);
      response.end(JSON.stringify(await store.runStoryboardBoardPlans(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/videos/prompts') {
      const input = await readJson(request, 10_000_000);
      requireSegmentApprovalForRoute(creativeSessions.load(), url.pathname, input);
      response.end(JSON.stringify(await store.runVideoPrompts(input)));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/videos/prompts/repair') {
      const input = await readJson(request, 10_000_000);
      requireSegmentApprovalForRoute(creativeSessions.load(), url.pathname, input);
      response.end(JSON.stringify(await store.repairVideoPrompt(input)));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/h3/status') {
      const health = await h3Provider.health();
      let presets = null;
      if (health.status === 'ok' || health.status === 'queue_busy') {
        try { presets = await h3Provider.presets(); } catch { /* Status remains useful when optional preset discovery fails. */ }
      }
      response.end(JSON.stringify({ health, presets, localGpu: localGpuCoordinator.status() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/h3/start') {
      const connection = await connectPrism();
      response.end(JSON.stringify(connection));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/videos/jobs') {
      response.end(JSON.stringify({ jobs: videoJobs.list(creativeSessions.load()?.id) })); return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/videos/generations') {
      const input = await readJson(request, 200_000);
      const session = creativeSessions.load();
      if (input.projectId && input.projectId !== session?.id) throw new InputError('当前项目已切换，请回到要生成的项目再提交。');
      const engine = input.engine || 'local';
      if (!['local', 'minimax', 'seedance'].includes(engine)) throw new InputError('请选择本机 H3、MiniMax 或 Seedance。');
      let task;
      if (engine === 'local') {
        const generationRequest = buildWebH3GenerationRequest(session, input);
        task = await runLocalGpuTask(localGpuCoordinator, { kind: 'h3-submit', taskId: generationRequest.taskId, label: 'PRISM H3视频提交' }, async () => h3Provider.submit(generationRequest));
      } else {
        const requestId = requiredString(input.requestId, '视频请求编号');
        const generationRequest = buildWebH3GenerationRequest(session, { ...input, qualityPreset: 'standard', resolution: '480p' });
        const common = {
          taskId: requestId, title: generationRequest.title, sourceEntityIds: generationRequest.sourceEntityIds,
          prompt: generationRequest.prompt, referenceAssetIds: generationRequest.referenceAssetIds,
          referenceAssetVersions: generationRequest.referenceAssetVersions, referenceLabels: generationRequest.referenceLabels,
          referenceMediaPaths: generationRequest.referenceMediaPaths, mode: generationRequest.mode,
          durationSec: generationRequest.durationSec, aspectRatio: generationRequest.aspectRatio,
          cloudResolution: input.cloudResolution, generateAudio: input.generateAudio === true,
          ...(engine === 'seedance' ? { seed: Number.isInteger(input.seed) ? input.seed : stableVideoSeed(requestId) } : {}),
          ...(generationRequest.continuity ? { continuity: generationRequest.continuity } : {}),
        };
        try { task = await videoJobs.submit({ projectId: session.id, segmentKey: input.segmentKey, engine, profileId: input.profileId, requestId, request: common }); }
        catch (error) { throw new InputError(error instanceof Error ? error.message : '视频提交未完成。'); }
      }
      response.statusCode = 202; response.end(JSON.stringify({ task })); return true;
    }

    if (url.pathname.startsWith('/api/videos/generations/')) {
      const match = /^\/api\/videos\/generations\/([^/]+)(?:\/(retry-download|reconcile|cancel))?$/u.exec(url.pathname);
      if (!match) throw new InputError('视频任务地址无效。');
      const id = decodeURIComponent(match[1]);
      const action = match[2];
      if (id.startsWith('cv-')) {
        const projectId = creativeSessions.load()?.id;
        try {
          if (request.method === 'GET' && !action) { response.end(JSON.stringify({ task: await videoJobs.status(projectId, id) })); return true; }
          if (request.method === 'POST' && action === 'retry-download') { response.end(JSON.stringify({ task: await videoJobs.retryDownload(projectId, id) })); return true; }
          if (request.method === 'POST' && action === 'reconcile') {
            const input = await readJson(request, 2_000);
            if (!input.remoteTaskId && input.confirmedNotSubmitted !== true) throw new InputError('请填写服务商任务号，或明确确认服务商未接单。');
            response.end(JSON.stringify({ task: await videoJobs.reconcile(projectId, id, input.remoteTaskId) })); return true;
          }
          if (action === 'cancel') throw new InputError('当前云端接口接入不支持安全取消已接单任务，请到服务商控制台处理；本地会继续查询结果。');
        } catch (error) { throw new InputError(error.message); }
      } else {
        if (request.method === 'GET' && !action) { response.end(JSON.stringify({ task: await h3Provider.status(id) })); return true; }
        if (request.method === 'POST' && action === 'cancel') { await h3Provider.cancel(id); response.end(JSON.stringify({ cancelled: true })); return true; }
      }
      throw new InputError('视频任务操作无效。');
    }

    if (request.method === 'POST' && url.pathname === '/api/h3/generations') {
      const input = await readJson(request, 200_000);
      const generationRequest = buildWebH3GenerationRequest(creativeSessions.load(), input);
      const task = await runLocalGpuTask(localGpuCoordinator, { kind: 'h3-submit', taskId: generationRequest.taskId, label: 'PRISM H3视频提交' }, async () => await h3Provider.submit(generationRequest));
      response.end(JSON.stringify({ task }));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/h3/jobs') {
      response.end(JSON.stringify({ jobs: await h3Provider.recoverableJobs() }));
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/h3/generations/')) {
      const promptId = decodeURIComponent(url.pathname.slice('/api/h3/generations/'.length));
      if (promptId.startsWith('cv-')) { response.end(JSON.stringify({ task: await videoJobs.status(creativeSessions.load()?.id, promptId) })); return true; }
      response.end(JSON.stringify({ task: await h3Provider.status(promptId) }));
      return true;
    }

    if (request.method === 'POST' && /^\/api\/h3\/generations\/[^/]+\/cancel$/u.test(url.pathname)) {
      const promptId = decodeURIComponent(url.pathname.slice('/api/h3/generations/'.length, -'/cancel'.length));
      if (promptId.startsWith('cv-')) throw new InputError('云端任务请在服务商控制台处理，不能使用本机 H3 的取消接口。');
      await h3Provider.cancel(promptId);
      response.end(JSON.stringify({ cancelled: true, promptId }));
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/h3/media/')) {
      const promptId = decodeURIComponent(url.pathname.slice('/api/h3/media/'.length));
      if (promptId.startsWith('cv-')) {
        const path = videoJobs.mediaPath(creativeSessions.load()?.id, promptId);
        if (!path) throw new InputError('视频尚未下载完成，请查看该镜头任务。');
        serveStoredH3Media(path, request, response); return true;
      }
      const storedMediaPath = resolveStoredH3MediaPath(creativeSessions.load(), promptId);
      if (storedMediaPath) {
        serveStoredH3Media(storedMediaPath, request, response);
        return true;
      }
      const media = await h3Provider.media(promptId, request.headers.range);
      response.statusCode = media.status;
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
        const value = media.headers.get(header);
        if (value) response.setHeader(header, value);
      }
      if (!media.body) { response.end(); return true; }
      pipeline(Readable.fromWeb(media.body), response, (error) => {
        if (error && !response.destroyed) response.destroy();
      });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/postproduction/rough-cut') {
      response.end(JSON.stringify({ roughCut: await createRoughCut(creativeSessions.load()) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/postproduction/music-prompt') {
      const input = await readJson(request, 1_000_000);
      response.end(JSON.stringify(await store.runMusicPromptPlan(input)));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/postproduction/local-music/status') {
      const health = await localMusicRuntime.provider.health();
      response.end(JSON.stringify({ health: localMusicRuntime.running ? { ...health, status: 'queue_busy', message: '本机 ACE-Step 1.5正在执行一项配乐任务。' } : health }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/postproduction/local-music') {
      const input = await readJson(request, 10_000);
      const seed = Number(input?.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) throw new InputError('本机配乐Seed必须是0至2147483647之间的整数。');
      if (localMusicRuntime.running) throw new InputError('本机 ACE-Step 1.5已有一项配乐任务在运行；系统没有重复提交。');
      const generationRequest = buildWebMusicGenerationRequest(creativeSessions.load(), {
          seed,
          bpm: input?.bpm,
          keyScale: input?.keyScale,
          timeSignature: input?.timeSignature,
          inferenceSteps: input?.inferenceSteps,
          thinking: input?.thinking,
        });
      const task = await runLocalGpuTask(localGpuCoordinator, { kind: 'ace-music', taskId: generationRequest.taskId, label: 'ACE-Step音乐生成' }, async () => {
        await prepareH3MemoryForLocalGpuTask(h3Provider);
        localMusicRuntime.running = true;
        try { return await localMusicRuntime.provider.submit(generationRequest); }
        finally { localMusicRuntime.running = false; }
      });
      response.end(JSON.stringify({ music: musicTaskResult(task) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/postproduction/music') {
      await readJson(request, 10_000);
      const task = await store.runMusicGeneration(buildWebMusicGenerationRequest(creativeSessions.load()));
      response.end(JSON.stringify({ music: musicTaskResult(task) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/postproduction/final-composition') {
      await readJson(request, 10_000);
      const saved = creativeSessions.load();
      try {
        const finalComposition = await createFinalComposition(saved);
        const postProduction = { ...saved.state.postProduction, musicApproval: saved.state.postProduction.audioMode === 'native' ? 'draft' : 'approved', finalComposition, agentReply: '最终成片已在本机完成并通过完整解码校验。粗剪、配乐、字幕和旧结果均已保留。' };
        const session = creativeSessions.save({ expectedRevision: saved.revision, state: { ...saved.state, postProduction } });
        response.end(JSON.stringify({ finalComposition, session }));
      } catch (error) {
        const finalComposition = { status: 'failed', error: error instanceof Error ? error.message.slice(0, 4_000) : '最终合成失败；系统没有自动重试。', createdAt: new Date().toISOString() };
        const session = creativeSessions.save({ expectedRevision: saved.revision, state: { ...saved.state, postProduction: { ...saved.state.postProduction, finalComposition, agentReply: '最终合成没有完成；所有输入与旧结果均已保留，系统没有自动重试。' } } });
        response.statusCode = 502;
        response.end(JSON.stringify({ error: `最终合成没有完成：${finalComposition.error}。系统没有自动重试。`, finalComposition, session }));
      }
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/editor/render') {
      await readJson(request, 10_000);
      const saved = creativeSessions.load();
      try {
        const render = await createEditorRender(saved);
        const editor = { ...saved.state.editor, renderStatus: 'idle', renderError: '', renders: [...(Array.isArray(saved.state.editor?.renders) ? saved.state.editor.renders : []), render].slice(-30) };
        const session = creativeSessions.save({ expectedRevision: saved.revision, state: { ...saved.state, canvasMode: 'editor', editor } });
        response.end(JSON.stringify({ render, editor, session }));
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 4_000) : '剪辑台合成失败；系统没有自动重试。';
        const editor = { ...saved.state.editor, renderStatus: 'failed', renderError: message };
        const session = creativeSessions.save({ expectedRevision: saved.revision, state: { ...saved.state, canvasMode: 'editor', editor } });
        response.statusCode = 502;
        response.end(JSON.stringify({ error: `剪辑台合成没有完成：${message}。系统没有自动重试。`, editor, session }));
      }
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/postproduction/music-media/')) {
      const filename = basename(decodeURIComponent(url.pathname.slice('/api/postproduction/music-media/'.length)));
      serveGeneratedMusic(filename, request, response);
      return true;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/postproduction/media/')) {
      const filename = basename(decodeURIComponent(url.pathname.slice('/api/postproduction/media/'.length)));
      servePostProductionMedia(filename, request, response);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/creative-session') {
      response.end(JSON.stringify({ session: recoverPreservedShortMusic(productionJobs.reconcile(creativeSessions.load())) }));
      return true;
    }

    if (request.method === 'PUT' && url.pathname === '/api/creative-session') {
      const input = await readJson(request, 20_000_000);
      response.end(JSON.stringify({ session: creativeSessions.save(input) }));
      return true;
    }

    if (request.method === 'POST' && ['/api/projects/create', '/api/projects/select', '/api/projects/episode'].includes(url.pathname)) {
      const lanes = sharedRequestScheduler.status().lanes;
      const current = creativeSessions.load();
      const busyState = Object.values(current?.state ?? {}).some(value => value === 'running') || ['episodeScripts', 'shotVideoTasks', 'characterTurnarounds', 'sceneViews', 'characterImages', 'sceneImages', 'propImages', 'storyboardBoards', 'videoPrompts'].some(key => current?.state?.[key]?.some(item => ['queued', 'running', 'submitting'].includes(item.status)));
      if (busyState || Object.values(lanes).some(lane => lane.active || lane.queued)) throw new InputError('当前生成任务仍在运行，请完成后再打开或新建其他制作项目。');
    }

    if (request.method === 'GET' && url.pathname === '/api/projects') {
      response.end(JSON.stringify({ projects: creativeSessions.list() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/projects/create') {
      const input = await readJson(request, 5_000_000);
      response.end(JSON.stringify({ session: creativeSessions.create(input), projects: creativeSessions.list() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/projects/select') {
      const input = await readJson(request);
      response.end(JSON.stringify({ session: recoverPreservedShortMusic(productionJobs.reconcile(creativeSessions.select(input?.id))), projects: creativeSessions.list() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/projects/episode') {
      const input = await readJson(request);
      response.end(JSON.stringify({ session: creativeSessions.openEpisode(input), projects: creativeSessions.list() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/projects/rename') {
      const input = await readJson(request);
      const renamed = creativeSessions.rename(input?.id, input?.name);
      response.end(JSON.stringify({ ...renamed, projects: creativeSessions.list() }));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/characters/library') {
      const session = creativeSessions.load();
      response.end(JSON.stringify({ entries: creativeSessions.characterCatalog(assetLibrary.list()), scopeId: session ? characterScope(session) : '', projectId: session?.id }));
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/characters/roster') {
      const input = await readJson(request, 20_000);
      const lanes = sharedRequestScheduler.status().lanes;
      if (Object.values(lanes).some(lane => lane.active || lane.queued)) throw new InputError('当前生成任务仍在运行，请完成后再调整人物。');
      const characterMediaRoot = resolve(RUNTIME_DATA_ROOT, 'generated-images/web-characters');
      if (input.imageUrl) generatedImagePath(input.imageUrl, characterMediaRoot, '角色图片');
      if (input.action === 'import') {
        const selected = creativeSessions.characterCatalog(assetLibrary.list()).find(entry => entry.id === input.assetId);
        if (selected?.image?.imageUrl) generatedImagePath(selected.image.imageUrl, characterMediaRoot, '角色主图');
        if (selected?.turnaround?.imageUrl) generatedImagePath(selected.turnaround.imageUrl, characterMediaRoot, '角色辅助图');
      }
      const session = creativeSessions.changeCharacters(input, assetLibrary.list());
      response.end(JSON.stringify({ session }));
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/asset-library') {
      const session = creativeSessions.load();
      response.end(JSON.stringify({ assets: [...assetLibrary.list(), ...creativeSessions.characterCatalog().map(catalogAsset)], folders: assetLibrary.listFolders(), currentProject: session ? projectSummary(session, true) : null, undo: assetReplacementUndo.latest(session) }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/asset-library') {
      const input = await readJson(request, 1_000_000);
      response.end(JSON.stringify({ asset: assetLibrary.add(input, creativeSessions.load()), assets: assetLibrary.list(), folders: assetLibrary.listFolders() }));
      return true;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/asset-library') {
      const input = await readJson(request, 1_000_000);
      response.end(JSON.stringify({ asset: assetLibrary.update(input), assets: assetLibrary.list(), folders: assetLibrary.listFolders() }));
      return true;
    }

    if (request.method === 'DELETE' && url.pathname === '/api/asset-library') {
      const input = await readJson(request);
      response.end(JSON.stringify({ removed: assetLibrary.remove(input), assets: assetLibrary.list(), folders: assetLibrary.listFolders() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/asset-library/folders') {
      const input = await readJson(request);
      response.end(JSON.stringify({ folder: assetLibrary.addFolder(input), folders: assetLibrary.listFolders() }));
      return true;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/asset-library/folders') {
      const input = await readJson(request);
      response.end(JSON.stringify({ folder: assetLibrary.renameFolder(input), folders: assetLibrary.listFolders(), assets: assetLibrary.list() }));
      return true;
    }

    if (request.method === 'DELETE' && url.pathname === '/api/asset-library/folders') {
      const input = await readJson(request);
      response.end(JSON.stringify({ removedFolder: assetLibrary.removeFolder(input), folders: assetLibrary.listFolders(), assets: assetLibrary.list() }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/asset-library/use') {
      const input = await readJson(request, 1_000_000);
      const session = creativeSessions.load();
      const asset = [...assetLibrary.list(), ...creativeSessions.characterCatalog().map(catalogAsset)].find((item) => item.id === input?.assetId);
      if (!asset) throw new InputError('没有找到这个资产。');
      const snapshotSession = input?.beforeState && session ? { ...session, state: sanitizeCreativeState(input.beforeState) } : session;
      const undo = assetReplacementUndo.create({ ...input, assetName: asset.name }, snapshotSession);
      response.end(JSON.stringify({ asset: asset.managedCharacter ? asset : assetLibrary.recordUsage(input, session), assets: assetLibrary.list(), undo }));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/asset-library/undo') {
      const input = await readJson(request);
      const currentSession = creativeSessions.load();
      const entry = assetReplacementUndo.get(input, currentSession);
      const restored = creativeSessions.save({ state: entry.session.state });
      assetLibrary.removeUsage(entry, restored);
      assetReplacementUndo.markRestored(entry.id);
      response.end(JSON.stringify({ session: restored, assets: assetLibrary.list(), undo: assetReplacementUndo.latest(restored) }));
      return true;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  } catch (error) {
    const isMusicPromptRequest = url.pathname === '/api/postproduction/music-prompt';
    const isMusicGenerationRequest = url.pathname === '/api/postproduction/music' || url.pathname === '/api/postproduction/local-music' || url.pathname === '/api/free-canvas/generate-audio';
    const isFreeCanvasPromptRequest = url.pathname === '/api/free-canvas/optimize-prompt';
    const isFreeCanvasImageRequest = url.pathname === '/api/free-canvas/generate-image' || url.pathname === '/api/free-canvas/image-tools';
    const isFreeCanvasVideoRequest = url.pathname === '/api/free-canvas/generate-video';
    const isCharacterRequest = url.pathname.startsWith('/api/characters');
    const isSceneRequest = url.pathname.startsWith('/api/scenes');
    const isPropRequest = url.pathname.startsWith('/api/props');
    const isStoryboardSegmentRequest = url.pathname === '/api/storyboards/segments';
    const isAgentRequest = url.pathname.startsWith('/api/prompt-master') || isMusicPromptRequest || isFreeCanvasPromptRequest || url.pathname.startsWith('/api/idea-agent') || url.pathname.startsWith('/api/project-manager') || url.pathname.startsWith('/api/novel-adaptation') || url.pathname.startsWith('/api/script') || isCharacterRequest || isSceneRequest || isPropRequest || url.pathname.startsWith('/api/storyboards') || url.pathname.startsWith('/api/videos');
    const isH3Request = url.pathname.startsWith('/api/h3');
    const isPostProductionRequest = url.pathname.startsWith('/api/postproduction');
    response.statusCode = error instanceof SessionRevisionConflict ? 409 : error instanceof InputError ? 400 : isAgentRequest || isFreeCanvasImageRequest || isFreeCanvasVideoRequest || isMusicGenerationRequest || isH3Request || isPostProductionRequest ? 502 : 500;
    response.end(JSON.stringify({ error: error instanceof InputError ? error.message : isMusicGenerationRequest ? safeMusicMessage(error) : isMusicPromptRequest && error instanceof MusicPromptValidationError ? `配乐方案没有通过必要校验：${localizeMusicPromptValidationIssues(error.issues).slice(0, 5).join('；')}。没有可安全展示的完整草稿，系统已停止后续生成。` : isFreeCanvasPromptRequest ? safeFreeCanvasPromptMessage(error) : isFreeCanvasImageRequest ? safeImageMessage(error) : isFreeCanvasVideoRequest ? safeH3Message(error) : isCharacterRequest ? safeCharacterAgentMessage(error) : isSceneRequest ? safeSceneAgentMessage(error) : isPropRequest ? safePropAgentMessage(error) : isStoryboardSegmentRequest ? safeStoryboardAgentMessage(error) : isAgentRequest ? safeIdeaAgentMessage(error) : isH3Request ? safeH3Message(error) : isPostProductionRequest ? `本地粗剪没有完成：${error instanceof Error ? error.message.slice(0, 800) : '未知错误'}。系统没有自动重试。` : '本地设置服务发生错误.', ...structuredInputError(error), ...(isAgentRequest ? preserveAgentFailureDiagnostic(error) : {}) }));
  }
  return true;
}

export function preserveAgentFailureDiagnostic(error, directory = resolve(RUNTIME_DATA_ROOT, 'private/agent-diagnostics')) {
  if (!(error instanceof OpenAIResponsesProviderError) || !error.diagnostics) return {};
  const diagnosticId = randomUUID();
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${diagnosticId}.json`), JSON.stringify({
      diagnosticId, createdAt: new Date().toISOString(), status: error.status, code: error.code,
      message: error.message, diagnostics: error.diagnostics,
    }, null, 2), { encoding: 'utf8', flag: 'wx' });
    return { diagnosticId };
  } catch {
    return { diagnosticSaveError: '本地诊断文件未能保存，请保留当前错误信息。' };
  }
}

export function safeIdeaAgentMessage(error) {
  if (error instanceof CharacterProfileValidationError) {
    return safeCharacterAgentMessage(error);
  }
  if (error instanceof IdeaAgentValidationError) {
    const details = error.issues.slice(0, 5).map((issue) => issue.messageZh);
    const suggestions = [...new Set(error.issues.slice(0, 5).map((issue) => issue.suggestionZh).filter(Boolean))];
    const diagnostics = [
      '失败步骤：编剧导演剧本校验',
      error.issues.some((issue) => issue.field) ? `涉及字段：${error.issues.map((issue) => issue.field).filter(Boolean).join('、')}` : '',
      error.diagnostics?.requestedModel ? `模型：${String(error.diagnostics.requestedModel).slice(0, 120)}` : '',
      error.diagnostics?.externalTaskId ? `请求ID：${String(error.diagnostics.externalTaskId).slice(0, 200)}` : '',
      Number.isFinite(Number(error.diagnostics?.elapsedMs)) ? `等待时间：${Math.max(0, Math.round(Number(error.diagnostics.elapsedMs) / 100) / 10)}秒` : '',
    ].filter(Boolean);
    return `文字Agent已经返回结果，但编剧导演校验发现${details.length}项需要处理的问题：${details.join('；')}。${diagnostics.join('；')}。${suggestions.length ? `处理建议：${suggestions.join('；')}。` : ''}现有问答已保留，问题已写入项目记录。`;
  }
  if (error instanceof OpenAIResponsesProviderError) {
    const operationLabel = agentOperationLabel(error.diagnostics?.operation);
    const isUpstreamFailure = Number(error.status) >= 500 || /upstream/iu.test(String(error.code || ''));
    const baseMessage = error.status === 401 || error.status === 403
      ? '文字Agent鉴权失败，请检查连接设置。'
      : error.status === 429
        ? '文字Agent当前限流或额度不足，请稍后再试。'
        : error.code === 'invalid_local_json_schema'
          ? '软件的结构化输出规则检查未通过，请更新客户端或提交诊断；本次尚未向文字服务发送请求。'
        : error.code === 'invalid_json_schema'
          ? '文字Agent的结构化输出规则与当前接口不兼容，本轮未写入。'
        : error.code === 'request_timeout'
          ? '文字Agent请求超时，已达到本轮等待上限。'
        : error.code === 'stream_incomplete'
          ? '文字Agent流式连接已结束，但未收到完整完成标记，已接收正文保留在诊断中。'
        : error.code === 'invalid_stream_event' || error.code === 'stream_response_failed' || error.code === 'stream_response_too_large'
          ? '文字Agent流式响应未能完成，已接收正文和错误保留在诊断中。'
        : error.code === 'response_body_timeout'
          ? '文字Agent已建立响应，但读取正文超过本轮等待时间。'
          : error.code === 'response_body_read_error'
            ? '文字Agent已建立响应，但连接在读取正文时中断。'
        : error.code === 'incomplete_response'
          ? '文字Agent本轮输出未完成，现有内容已保留。'
          : error.code === 'invalid_structured_output'
            ? '文字Agent没有按本轮要求返回可读取结果，本轮未写入。'
            : error.code === 'missing_output' || error.code === 'missing_output_text'
              ? '文字Agent返回成功状态，但没有可读取的正文，本轮未写入。'
              : error.code === 'invalid_response_body'
                ? '文字Agent返回了无法读取的响应正文，本轮未写入。'
                : error.code === 'model_mismatch'
                  ? '文字路由返回了不同模型，请检查模型设置。'
                  : error.code === 'network_error'
                    ? '文字Agent连接失败，请检查网络后重新请求。'
                    : isUpstreamFailure
                      ? `文字Agent在“${operationLabel}”处理时收到上游服务错误${error.status ? `（HTTP ${error.status}）` : ''}，本轮没有取得可写入结果。`
                      : `文字Agent在“${operationLabel}”处理时请求失败${error.status ? `（HTTP ${error.status}）` : ''}，现有内容已保留。`;
    const upstreamDetail = isUpstreamFailure ? safeProviderErrorDetail(error.message) : '';
    const schemaDetail = error.code === 'invalid_json_schema' ? safeProviderErrorDetail(error.message) : '';
    const targetKeys = Array.isArray(error.diagnostics?.targetKeys)
      ? error.diagnostics.targetKeys.map((value) => String(value).slice(0, 80)).filter(Boolean).slice(0, 24)
      : [];
    const diagnostics = [
      operationLabel ? `失败步骤：${operationLabel}` : '',
      targetKeys.length ? `影响范围：${targetKeys.join('、')}` : '',
      error.code ? `错误代码：${String(error.code).slice(0, 120)}` : '',
      error.code === 'invalid_local_json_schema' && Array.isArray(error.diagnostics?.schemaIssues) ? `规则位置：${error.diagnostics.schemaIssues.slice(0, 3).join('；')}` : '',
      upstreamDetail ? `上游说明：${upstreamDetail}` : '',
      schemaDetail ? `接口说明：${schemaDetail}` : '',
      error.diagnostics?.requestedModel ? `模型：${String(error.diagnostics.requestedModel).slice(0, 120)}` : '',
      error.diagnostics?.responseStatus ? `响应状态：${String(error.diagnostics.responseStatus).slice(0, 80)}` : '',
      error.diagnostics?.incompleteReason ? `未完成原因：${String(error.diagnostics.incompleteReason).slice(0, 160)}` : '',
      safeOutputItemTypeSummary(error.diagnostics?.outputItemSummary),
      Number(error.diagnostics?.retryCount) > 0 ? `自动恢复：已使用相同设置重试${Math.min(2, Math.max(0, Math.round(Number(error.diagnostics.retryCount))))}次` : '',
      safeAgentRecoveryHistory(error.diagnostics?.transientFailures),
      error.diagnostics?.externalTaskId ? `请求ID：${String(error.diagnostics.externalTaskId).slice(0, 200)}` : '',
      Number.isFinite(error.diagnostics?.timeoutMs) ? `等待上限：${Math.round(error.diagnostics.timeoutMs / 1000)}秒` : '',
      Number.isFinite(Number(error.diagnostics?.elapsedMs)) ? `等待时间：${Math.max(0, Math.round(Number(error.diagnostics.elapsedMs) / 100) / 10)}秒` : '',
    ].filter(Boolean);
    const phaseBoundary = error.diagnostics?.operation === 'plan-storyboard-board-panels-batch'
      ? '本次停止在画格规划与图片提示词阶段，图片生成尚未开始。'
      : '';
    const recoveryConclusion = Number(error.diagnostics?.retryCount) > 0
      ? '临时连接已按相同设置完成有限恢复尝试，仍未取得结果。'
      : error.diagnostics?.stream || ['request_timeout', 'response_body_timeout'].includes(error.code)
        ? '系统没有自动重试；可先核对服务商的请求记录，再决定是否重新提交。'
        : '本次问题不属于可安全自动恢复的临时网关故障，系统没有自动重试。';
    return `${baseMessage}${diagnostics.length ? ` ${diagnostics.join('；')}。` : ''}${phaseBoundary}现有内容已保留。${recoveryConclusion}`;
  }
  if (error instanceof Error && /^Storyboard board (batch|plan)/.test(error.message)) {
    const segmentKey = error.message.match(/SEG\d+/i)?.[0]?.toUpperCase();
    const fieldLabels = [
      [/plan\.panels|expected \d+ panels/i, '画格列表或画格数量'],
      [/identity\/order mismatch|batch item/i, '画格或分镜顺序'],
      [/time range|panel timeline/i, '画格时间线'],
      [/visible shot content/i, '画格可见内容'],
      [/semanticDecision|semantic decision/i, '语义判断'],
      [/referenceRequirements|reference requirements|reference character|reference prop/i, '参考资产要求'],
      [/imagePromptSections|prompt sections|content layout/i, '故事板提示词分段'],
    ].filter(([pattern]) => pattern.test(error.message)).map(([, label]) => label);
    const uniqueLabels = [...new Set(fieldLabels)];
    const rawIssues = error.message.replace(/^Storyboard board (?:batch )?(?:SEG\d+ )?(?:validation failed:\s*)?/i, '').split(/;\s*/u).filter(Boolean);
    const details = localizeStructuredAgentValidationIssues('故事板规划', rawIssues).slice(0, 3);
    return `文字Agent已经返回${segmentKey ? `${segmentKey}的` : ''}故事板规划，但${uniqueLabels.length ? uniqueLabels.join('、') : '格数、顺序、时间线或必需字段'}未通过本地结构校验中的必要项；问题位于故事板规划阶段，本轮未写入。具体问题：${details.join('；')} 系统没有自动重试。`;
  }
  if (error instanceof Error && /(?:Segment video prompt validation failed|episode video prompt)/i.test(error.message)) {
    const segmentKey = error.message.match(/SEG\d+/i)?.[0]?.toUpperCase();
    const fieldLabels = [
      [/segment key|item \d+ must be/i, '分镜顺序'],
      [/duration mismatch/i, '时长'],
      [/character reference/i, '人物参考'],
      [/scene reference/i, '场景参考'],
      [/prop reference/i, '道具参考'],
      [/reference binding|Picture\s+\d+|Subject\s+\d+/i, '全能参考绑定'],
      [/shot execution|preserve dialogue/i, '镜头时间线或对白'],
      [/internal_monologue|voiceover|lip movement/i, '内心声或画外音口型'],
      [/4-6 second shot execution|timeline beats/i, '5秒镜头节奏'],
      [/required transition|on-screen text|fade or black frame/i, '片尾字幕或转场'],
      [/sound policy/i, '声音总则'],
      [/silent video positive prompt/i, '无语言镜头文案'],
      [/negative terms|all video prompt sections/i, '五段式提示词字段'],
    ].filter(([pattern]) => pattern.test(error.message)).map(([, label]) => label);
    const uniqueLabels = [...new Set(fieldLabels)];
    const rawIssues = error.message.replace(/^(?:Segment video prompt validation failed|episode video prompt[^:]*):?\s*/i, '').split(/;\s*/u).filter(Boolean);
    const details = localizeVideoPromptValidationIssues(rawIssues).slice(0, 3);
    return `文字Agent已经返回${segmentKey ? `${segmentKey}的` : ''}视频提示词，但${uniqueLabels.length ? uniqueLabels.join('、') : '引用、时间线或五段式字段'}未通过本地结构校验；草稿未覆盖。${details.length ? `具体问题：${details.join('；')} ` : ''}系统没有自动重试。`;
  }
  if (error instanceof Error && /^Agent/.test(error.message)) return `${error.message} 本轮未写入，可以重新请求。`;
  if (error instanceof Error) {
    return `文字Agent处理没有完成：${safeUnknownAgentErrorDetail(error)}。现有内容已保留，本次没有自动重试。`;
  }
  return '文字Agent本轮处理失败，现有问答已保留，本次没有自动重试。';
}

function safeUnknownAgentErrorDetail(error) {
  const name = error instanceof Error && error.name && error.name !== 'Error' ? `${error.name}：` : '';
  const detail = safeProviderErrorDetail(error instanceof Error ? error.message : String(error || '未知错误'));
  return `${name}${detail || '未取得可读取的错误详情'}`.slice(0, 500);
}

function agentOperationLabel(operation) {
  const labels = {
    'adapt-novel-to-series-plan': '智能拆集',
    'plan-storyboard-board-panels-batch': '画格规划与故事板图片提示词',
    'plan-storyboard-board-panels': '单段画格规划与故事板图片提示词',
    'generate-concise-storyboard-segments': '文字分镜',
    'generate-episode-video-prompts-batch': '视频提示词',
    'repair-episode-video-prompts-batch': '视频提示词校正',
    'production-director-review-character-profiles': '总导演复核角色设定',
    'production-director-review-scene-proposals': '总导演复核场景提案',
    'production-director-review-prop-proposals': '总导演复核道具提案',
    'project-manager-command-turn': '项目诊断与执行规划',
  };
  const key = typeof operation === 'string' ? operation.trim() : '';
  return labels[key] || (key ? key.slice(0, 120) : '当前文字任务');
}

function safeProviderErrorDetail(value) {
  const text = typeof value === 'string'
    ? value.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  if (!text || /^Responses API failed with HTTP \d+\.?$/iu.test(text)) return '';
  return text.slice(0, 500);
}

function safeAgentRecoveryHistory(value) {
  if (!Array.isArray(value) || value.length === 0) return '';
  const items = value.slice(0, 2).map((item, index) => {
    const status = Number.isFinite(Number(item?.status)) ? `HTTP ${Math.round(Number(item.status))}` : '连接中断';
    const requestId = item?.externalTaskId ? `，请求ID ${String(item.externalTaskId).slice(0, 120)}` : '';
    return `第${Math.max(1, Math.round(Number(item?.attempt) || index + 1))}次 ${status}${requestId}`;
  });
  return items.length ? `恢复记录：${items.join('；')}` : '';
}

export function safeCharacterAgentMessage(error) {
  if (error instanceof ProductionDirectorSupervisionError) {
    return `总导演复核后仍认为角色结果需要调整：${String(error.review?.summary || '人物身份或设定仍存在歧义').slice(0, 500)}。本轮已停止，现有项目内容保持不变。`;
  }
  if (!(error instanceof CharacterProfileValidationError) && !(error instanceof CharacterAssetPromptValidationError)) return safeIdeaAgentMessage(error);
  const stageLabel = error instanceof CharacterAssetPromptValidationError ? '角色生图提示词' : '角色档案';
  const details = localizeStructuredAgentValidationIssues(stageLabel, error.issues).slice(0, 3);
  return `文字结果已经返回，但${stageLabel}有${error.issues.length}项必要事实或结构问题，未写入当前项目。具体问题：${details.join('；')} 系统没有自动重试。`;
}

export function localizeMusicPromptValidationIssues(issues) {
  const source = Array.isArray(issues) ? issues : [];
  return [...new Set(source.map((issue) => {
    const text = String(issue || '');
    if (/output must be an object/u.test(text)) return '文字Agent没有返回可读取的完整配乐方案；请重新生成方案。';
    if (/title is required/u.test(text)) return '方案标题为空；请补充一个简短的中文配乐标题。';
    if (/creativeDirection is required/u.test(text)) return '整体音乐方向为空；请说明主要配器、情绪弧线和收束方式。';
    if (/minimaxPrompt must contain 40 to 800 characters/u.test(text)) return 'ACE-Step提示词偏短或偏长；方案可继续使用，建议删减重复内容或补全必要配器与情绪发展。';
    if (/explicit instrumental film-score premise/u.test(text)) return '提示词没有使用推荐的“纯器乐电影配乐”开场；不会阻断，建议在首句明确器乐电影配乐方向。';
    if (/complete melodic role/u.test(text)) return '提示词对主奏乐器的职责写得不够明确；不会阻断，可补充“钢琴、低音弦乐和克制打击乐共同承担旋律、节奏与情绪表达”。';
    if (/positive instrumental-only language/u.test(text)) return '提示词出现了人声、歌词、歌唱、对白或旁白等概念；即使写成否定句也可能触发模型，请删除这些词，只保留正向器乐描述。';
    if (/instrumental must be true/u.test(text)) return '纯器乐开关没有设为true；请保持纯器乐模式。';
    if (/targetDurationSec must match/u.test(text)) return '目标时长与已确认粗剪不一致；请保持粗剪时长不变。';
    if (/cues must cover every segment/u.test(text)) return '逐段音乐节点没有完整覆盖全部分镜；请按原顺序为每个SEG保留一个节点。';
    const cue = text.match(/^cue (\d+) is invalid$/u);
    if (cue) return `第${cue[1]}个音乐节点结构不完整；请补齐该节点的时间、功能、能量、配器和混音说明。`;
    const segmentKey = text.match(/^(SEG\d{3}) /u)?.[1];
    if (/segmentKey must remain/u.test(text)) return `音乐节点顺序或SEG编号被改动；请按已确认分镜顺序原样保留。`;
    if (/time boundary changed/u.test(text)) return `${segmentKey || '某个分镜'}的时间边界被改动；请复制已确认粗剪中的起止时间。`;
    if (/cue content is incomplete/u.test(text)) return `${segmentKey || '某个分镜'}的音乐功能、配器或混音说明不完整；请补齐缺失项。`;
    if (/energy is invalid/u.test(text)) return `${segmentKey || '某个分镜'}的能量等级无效；请使用low、medium或high。`;
    if (/mixGuidance must contain/u.test(text)) return '本机混音建议数量不在推荐的2至6条范围；不会阻断，可补充或精简对白让位、动态控制与淡入淡出建议。';
    if (/projectTitle is required/u.test(text)) return '项目标题为空，无法生成配乐方案。';
    if (/logline is required/u.test(text)) return '故事梗概为空，无法判断配乐情绪方向。';
    if (/targetDurationSec must be positive/u.test(text)) return '粗剪目标时长无效，请先确认可播放的粗剪。';
    if (/audioMode must include music/u.test(text)) return '当前声音方案不包含配乐，请先选择“原声+配乐”或“仅配乐”。';
    if (/subtitles must be decided/u.test(text)) return '字幕方案尚未确定，请先选择字幕方案。';
    if (/segments are required/u.test(text)) return '没有可用于配乐设计的分镜段落。';
    return `配乐方案字段未通过校验：${text.slice(0, 240) || '未知字段问题'}。`;
  }))];
}

function editableMusicPromptDraft(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.title !== 'string' || typeof value.creativeDirection !== 'string' || typeof value.minimaxPrompt !== 'string') return undefined;
  if (!Number.isFinite(Number(value.targetDurationSec)) || !Array.isArray(value.cues) || !Array.isArray(value.mixGuidance)) return undefined;
  if (value.cues.some((cue) => !cue || typeof cue !== 'object' || typeof cue.segmentKey !== 'string' || !Number.isFinite(Number(cue.startSec)) || !Number.isFinite(Number(cue.endSec)) || typeof cue.musicalFunction !== 'string' || typeof cue.instrumentation !== 'string' || typeof cue.mixNote !== 'string')) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function safeSceneAgentMessage(error) {
  if (error instanceof ProductionDirectorSupervisionError) {
    return `总导演复核后仍认为场景结果需要调整：${String(error.review?.summary || '场景归并或空间连续性仍存在歧义').slice(0, 500)}。本轮已停止，现有项目内容保持不变。`;
  }
  if (error instanceof OpenAIResponsesProviderError && error.code === 'invalid_structured_output') {
    const diagnostics = error.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
    const outputItemSummary = Array.isArray(diagnostics.outputItemSummary) ? diagnostics.outputItemSummary : [];
    const outputTypes = outputItemSummary.map((item) => {
      const type = String(item?.type || 'unknown').slice(0, 80);
      const contentTypes = Array.isArray(item?.contentTypes) ? item.contentTypes.map((value) => String(value).slice(0, 80)).filter(Boolean) : [];
      return contentTypes.length ? `${type}(${contentTypes.join(',')})` : type;
    }).filter(Boolean);
    const details = [
      diagnostics.responseStatus ? `响应状态：${String(diagnostics.responseStatus).slice(0, 80)}` : '',
      outputTypes.length ? `返回内容类型：${outputTypes.join('、')}` : '',
      diagnostics.externalTaskId ? `请求ID：${String(diagnostics.externalTaskId).slice(0, 200)}` : '',
    ].filter(Boolean);
    return `文字Agent已经返回正文，但正文没有符合场景提案所需的结构字段，因此系统无法安全写入项目。这是输出适配失败，不是用户的创作需求有问题。${details.length ? ` ${details.join('；')}。` : ' '}系统没有自动重试。`;
  }
  if (!(error instanceof SceneAssetPromptValidationError)) return safeIdeaAgentMessage(error);
  const issues = Array.isArray(error.issues) ? error.issues : [];
  const fieldLabels = [
    [/proposals must be an array|proposal count|generated proposals/i, '提案列表'],
    [/sourceSceneKeys|cover every script scene|scene order|assigned more than once/i, '场次覆盖与顺序'],
    [/evidenceId|sourceFacts|evidence catalog|verbatim/i, '剧本证据'],
    [/baseStateSceneKey|earliest bound scene/i, '场景基础状态'],
    [/stateVariants|state variant/i, '剧情状态变化'],
    [/fixedLandmarks|fixed landmarks/i, '固定地标'],
    [/locationIdentity|spatialLayout|terrainAndArchitecture|materialsAndSurface|lightingAndColor|weatherAndAtmosphere|shotCoverage|openQuestions/i, '视觉提案字段'],
  ].filter(([pattern]) => issues.some((issue) => pattern.test(String(issue)))).map(([, label]) => label);
  const uniqueLabels = [...new Set(fieldLabels)];
  const diagnostics = error.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
  const usage = diagnostics.usage && typeof diagnostics.usage === 'object' ? diagnostics.usage : {};
  const diagnosticParts = [
    diagnostics.externalTaskId ? `请求ID：${String(diagnostics.externalTaskId).slice(0, 200)}` : '',
    Number.isFinite(diagnostics.elapsedMs) ? `耗时：${(Number(diagnostics.elapsedMs) / 1000).toFixed(1)}秒` : '',
    Number.isFinite(usage.totalTokens) ? `Token：${Number(usage.totalTokens)}` : Number.isFinite(usage.inputTokens) || Number.isFinite(usage.outputTokens) ? `Token：输入${Number(usage.inputTokens) || 0}、输出${Number(usage.outputTokens) || 0}` : '',
  ].filter(Boolean);
  const rejectedFields = uniqueLabels.length ? uniqueLabels.join('、') : '场景数量、场次归属或必需字段';
  const details = localizeStructuredAgentValidationIssues('场景视觉提案', issues).slice(0, 3);
  return `文字结果已经返回，但场景视觉提案的${rejectedFields}有${issues.length}项问题，涉及必要事实或结构，因此未写入当前项目。具体问题：${details.join('；')}${diagnosticParts.length ? ` ${diagnosticParts.join('；')}。` : ' '}系统没有自动重试。`;
}

export function safePropAgentMessage(error) {
  if (error instanceof ProductionDirectorSupervisionError) {
    return `总导演复核后仍认为道具结果需要调整：${String(error.review?.summary || '道具范围、状态或视觉设定仍存在歧义').slice(0, 500)}。本轮已停止，返回结果和现有项目内容均已保留。`;
  }
  if (!(error instanceof PropAssetPromptValidationError)) return safeIdeaAgentMessage(error);
  const issues = Array.isArray(error.issues) ? error.issues : [];
  const fieldLabels = [
    [/proposals must be an array|prompts must exactly cover|requiredProps|prompt sections must match/i, '提案列表'],
    [/must use R\d+|stable identity|identity does not match|aliases/i, '编号与道具身份'],
    [/ordered source scenes|unknown scene|valid ordered source scenes/i, '场次归属与顺序'],
    [/source facts|source evidence|evidence catalog|invalid source evidence/i, '剧本证据'],
    [/base state/i, '道具基础状态'],
    [/state variant|required states|state evidence/i, '剧情状态变化'],
    [/visual design proposal/i, '视觉提案字段'],
    [/incomplete prompt sections/i, '生图提示词字段'],
  ].filter(([pattern]) => issues.some((issue) => pattern.test(String(issue)))).map(([, label]) => label);
  const uniqueLabels = [...new Set(fieldLabels)];
  const diagnostics = error.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
  const usage = diagnostics.usage && typeof diagnostics.usage === 'object' ? diagnostics.usage : {};
  const diagnosticParts = [
    diagnostics.externalTaskId ? `请求ID：${String(diagnostics.externalTaskId).slice(0, 200)}` : '',
    Number.isFinite(diagnostics.elapsedMs) ? `耗时：${(Number(diagnostics.elapsedMs) / 1000).toFixed(1)}秒` : '',
    Number.isFinite(usage.totalTokens) ? `Token：${Number(usage.totalTokens)}` : Number.isFinite(usage.inputTokens) || Number.isFinite(usage.outputTokens) ? `Token：输入${Number(usage.inputTokens) || 0}、输出${Number(usage.outputTokens) || 0}` : '',
  ].filter(Boolean);
  const rejectedFields = uniqueLabels.length ? uniqueLabels.join('、') : '道具数量、场次归属或必需字段';
  const details = localizeStructuredAgentValidationIssues('道具视觉提案', issues).slice(0, 3);
  return `文字结果已经返回，但道具视觉提案的${rejectedFields}有${issues.length}项问题，涉及必要事实或结构，因此未写入当前项目。具体问题：${details.join('；')}${diagnosticParts.length ? ` ${diagnosticParts.join('；')}。` : ' '}系统没有自动重试。`;
}

export function safeStoryboardAgentMessage(error) {
  if (!(error instanceof StoryboardPromptValidationError)) {
    if (error instanceof Error) {
      const planningMessage = [
        [/Fixed storyboard slots must be at least the number of script scenes/i, '当前时长下的分镜段少于剧本场次数。系统应自动把连续场次编入同一段，但当前版本没有完成这一步。'],
        [/Storyboard segment duration must be an integer from 5 to 15 seconds/i, '当前项目保存的分镜时长无法读取。请选择页面提供的时长后重新提交。'],
        [/Storyboard board panel count must be 3, 4, 6, or 9/i, '当前项目保存的故事板格数无法读取。请选择3格、4格、6格或9格后重新提交。'],
        [/Storyboard board batch requires at least one segment|Reference requirement request needs at least one segment/i, '当前没有可处理的文字分镜。请先生成或恢复文字分镜内容。'],
        [/Storyboard board batch segment keys must be unique/i, '已保存的分镜编号发生重复。现有内容已保留，请返回文字分镜检查重复项。'],
        [/Script must be approved before storyboard generation/i, '当前项目没有可用于分镜的完整剧本状态。请先保存剧本内容。'],
        [/Style must be approved before storyboard generation/i, '当前项目没有可用于分镜的画面风格。请先选择一个画面风格。'],
        [/All supplied storyboard assets must be approved/i, '当前分镜引用中混入了尚未准备好的资产。系统没有提交文字模型，请检查对应资产状态。'],
      ].find(([pattern]) => pattern.test(error.message))?.[1];
      if (planningMessage) return `文字分镜在本地编排阶段停止：${planningMessage} 没有调用文字模型，现有内容保持不变。`;
    }
    return safeIdeaAgentMessage(error);
  }
  const issues = Array.isArray(error.issues) ? error.issues : [];
  const fieldLabels = [
    [/segments must contain exactly/i, '分段数量'],
    [/must match SEG\d+ plan/i, '分段顺序、场次或时长'],
    [/story evidence|evidence must be covered|unknown evidence|evidence .* kind|evidence .* scene/i, '剧本证据覆盖'],
    [/concise storyboard text/i, '分镜文字'],
    [/preserve dialogue|dialogue speaker|dialogue evidence/i, '对白逐字保留与说话人'],
    [/character asset|scene asset|prop asset|referenceAssetIds|requires character|requires scene|requires prop/i, '人物、场景或道具参考'],
    [/final transition/i, '场末转场'],
  ].filter(([pattern]) => issues.some((issue) => pattern.test(String(issue)))).map(([, label]) => label);
  const uniqueLabels = [...new Set(fieldLabels)];
  const diagnostics = error.diagnostics && typeof error.diagnostics === 'object' ? error.diagnostics : {};
  const usage = diagnostics.usage && typeof diagnostics.usage === 'object' ? diagnostics.usage : {};
  const diagnosticParts = [
    diagnostics.externalTaskId ? `请求ID：${String(diagnostics.externalTaskId).slice(0, 200)}` : '',
    Number.isFinite(diagnostics.elapsedMs) ? `耗时：${(Number(diagnostics.elapsedMs) / 1000).toFixed(1)}秒` : '',
    Number.isFinite(usage.totalTokens) ? `Token：${Number(usage.totalTokens)}` : Number.isFinite(usage.inputTokens) || Number.isFinite(usage.outputTokens) ? `Token：输入${Number(usage.inputTokens) || 0}、输出${Number(usage.outputTokens) || 0}` : '',
  ].filter(Boolean);
  const rejectedFields = uniqueLabels.length ? uniqueLabels.join('、') : '分段结构或必需字段';
  const details = localizeStructuredAgentValidationIssues('文字分镜', issues).slice(0, 3);
  const repairState = diagnostics.repairAttempted
    ? '本次修复仍有未通过项，已保留返回草稿和已有结果。'
    : '已保留返回草稿，可点击修复继续处理。';
  return `文字结果已经返回，但文字分镜的${rejectedFields}有${issues.length}项问题。${repairState}具体问题：${details.join('；')}${diagnosticParts.length ? ` ${diagnosticParts.join('；')}。` : ' '}系统不会启动图片或视频生成。`;
}

export function safeFreeCanvasPromptMessage(error) {
  if (error instanceof Error && /^文字Agent返回的生产提示词缺少必要分段/u.test(error.message)) return `${error.message} 系统没有自动重试。`;
  return safeIdeaAgentMessage(error).replace('现有问答已保留', '现有节点内容已保留');
}

function safeOutputItemTypeSummary(value) {
  if (!Array.isArray(value) || value.length === 0) return '';
  const items = value.slice(0, 8).map((item) => {
    if (!item || typeof item !== 'object') return '';
    const type = safeDiagnosticType(item.type) || 'unknown';
    const contentTypes = Array.isArray(item.contentTypes)
      ? item.contentTypes.slice(0, 8).map(safeDiagnosticType).filter(Boolean)
      : [];
    return `${type}(${contentTypes.length ? contentTypes.join(',') : 'empty'})`;
  }).filter(Boolean);
  return items.length ? `返回内容类型：${items.join('、')}` : '';
}

function safeDiagnosticType(value) {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80) : '';
}

function validateIdeaTurnInput(input) {
  const idea = requiredString(input.idea, '故事想法');
  if (idea.length > 2_000) throw new InputError('故事想法不能超过2000字。');
  if (!Array.isArray(input.answers) || input.answers.length > 3) throw new InputError('Agent问答记录无效。');
  const answers = input.answers.map((item) => ({
    question: requiredString(item?.question, 'Agent问题'),
    answer: requiredString(item?.answer, '用户回答'),
  }));
  const production = input.production ? validateProductionBrief(input.production) : undefined;
  return { idea, answers, forceScript: input.forceScript === true, production };
}

function validateIdeaToneRecommendationInput(input) {
  const sourceText = requiredString(input?.sourceText, '创作内容');
  if (sourceText.length > 20_000) throw new InputError('情绪推荐最多读取当前内容的前2万字。');
  const creationSource = input?.creationSource === 'novel' ? 'novel' : 'idea';
  const workType = input?.workType === 'series' ? 'series' : 'single';
  const creativeDirection = ['story', 'commercial', 'product', 'knowledge', 'documentary', 'music_visual'].includes(input?.creativeDirection) ? input.creativeDirection : 'story';
  const durationSec = Number(input?.durationSec);
  if (!Number.isInteger(durationSec) || durationSec < 5 || durationSec > 600) throw new InputError('影片时长无效。');
  return {
    sourceText,
    creationSource,
    workType,
    creativeDirection,
    durationSec,
    ratio: requiredString(input?.ratio, '画面比例'),
    language: requiredString(input?.language, '对白语言'),
  };
}

function validateNovelAdaptationInput(input) {
  const novelText = requiredString(input?.novelText, '小说原文');
  if (novelText.length > 120_000) throw new InputError('单次剧本改编最多读取12万字，请先选择要改编的章节。');
  const production = validateProductionBrief(input?.production);
  return {
    novelText,
    sourceName: typeof input?.sourceName === 'string' && input.sourceName.trim() ? input.sourceName.trim().slice(0, 1_000) : '粘贴小说原文',
    production,
  };
}

function validateScriptRevisionInput(input) {
  if (!input?.currentScript || typeof input.currentScript !== 'object' || JSON.stringify(input.currentScript).length > 500_000) throw new InputError('当前剧本无效。');
  const revisionRequest = requiredString(input.revisionRequest, '剧本修改意见');
  if (revisionRequest.length > 2_000) throw new InputError('剧本修改意见不能超过2000字。');
  const sourceContext = typeof input.sourceContext === 'string' ? input.sourceContext.slice(0, 120_000) : '';
  return { currentScript: JSON.parse(JSON.stringify(input.currentScript)), revisionRequest, sourceContext };
}

function validateCharacterProfileInput(input) {
  const ideaScript = input?.script;
  if (!ideaScript || typeof ideaScript !== 'object' || JSON.stringify(ideaScript).length > 500_000) throw new InputError('当前剧本无效。');
  const script = toApprovedDomainScript(ideaScript);
  const requiredCharacterNames = selectEpisodeCharacters(ideaScript).map((character) => character.name);
  if (requiredCharacterNames.length === 0) throw new InputError('当前集剧本场景中没有可设计的出场角色。');
  return { script, requiredCharacterNames, preferences: { language: optionalBoundedString(ideaScript.language, 100) || '中文' } };
}

function validateCharacterImageInput(input, options = {}) {
  if (!Array.isArray(input?.profiles) || (!options.allowEmptyProfiles && input.profiles.length === 0) || JSON.stringify(input.profiles).length > 500_000) throw new InputError('主要角色简介无效。');
  let preset;
  try { preset = getStylePreset(String(input?.styleId || '')); }
  catch { throw new InputError('请先选择一个有效的视觉风格。'); }
  const timestamp = new Date().toISOString();
  const inheritedGenerationPreset = input?.generationPreset
    || (Array.isArray(input?.prompts) ? input.prompts.find((item) => item?.generationPreset)?.generationPreset : undefined)
    || (Array.isArray(input?.plans) ? input.plans.find((item) => item?.generationPreset)?.generationPreset : undefined);
  const generationPreset = normalizeGenerationPreset(inheritedGenerationPreset, { styleId: preset.id, aspectRatio: input?.aspectRatio }, inheritedGenerationPreset ? timestamp : '1970-01-01T00:00:00.000Z');
  if (generationPreset.styleId !== preset.id) throw new InputError('当前生成预设与提交的视觉风格不一致。');
  const profiles = input.profiles.map((profile, index) => ({
    ...JSON.parse(JSON.stringify(profile)),
    id: `web-profile-${String(profile.profileKey || `C${index + 1}`).toLowerCase()}`,
  }));
  const characterProfileSet = {
    id: 'web-character-profiles', version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'approved',
    scriptId: 'web-approved-script', scriptVersion: 1, profiles,
  };
  const styleSelection = {
    id: `web-style-${preset.id}`, version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'approved',
    characterProfileSetId: characterProfileSet.id, characterProfileSetVersion: characterProfileSet.version,
    source: 'recommended-preset', name: preset.name, stylePrompt: preset.styleAnchor, referenceMediaPaths: [], selectedBy: 'user',
  };
  return { characterProfileSet, styleSelection, generationPreset, preferences: { language: '中文', requirements: ['人物主资产使用横版3:2中性摄影棚定妆板。剧情画幅不改变资产板比例。'] } };
}

function validateSceneGenerationInput(input) {
  const script = toApprovedDomainScript(input?.script);
  const characterInput = validateCharacterImageInput(input, { allowEmptyProfiles: true });
  return {
    script,
    styleSelection: characterInput.styleSelection,
    generationPreset: characterInput.generationPreset,
    preferences: { language: '中文', requirements: ['先保持纯环境空镜，人物和可移动剧情道具不进入场景主资产。', `目标画面比例为${characterInput.generationPreset.aspectRatio}。`] },
  };
}

function validateSceneProposals(input) {
  if (!Array.isArray(input) || input.length === 0 || JSON.stringify(input).length > 1_000_000) throw new InputError('已确认的场景视觉提案无效。');
  return JSON.parse(JSON.stringify(input));
}

function validateReusableScenePrompts(input, proposals, styleId) {
  if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) return null;
  if (!Array.isArray(input) || input.length !== proposals.length) throw new InputError('已保存的场景提示词与当前场景数量不一致。');
  return input.map((item, index) => {
    const proposal = proposals[index];
    const sceneAssetKey = requiredString(item?.sceneAssetKey, '场景提示词场景ID');
    const name = requiredString(item?.name, '场景提示词场景名');
    const promptStyleId = requiredString(item?.styleId, '场景提示词风格ID');
    const prompt = requiredString(item?.prompt, '场景图片提示词');
    if (sceneAssetKey !== proposal.sceneAssetKey || name !== proposal.name || promptStyleId !== styleId) throw new InputError('已保存的场景提示词与当前提案或画风不一致。');
    if (prompt.length > 100_000) throw new InputError('已保存的场景图片提示词过长。');
    return { sceneAssetKey, name, styleId: promptStyleId, prompt: sanitizeProductionPrompt(prompt) };
  });
}

function validateRequestedSceneKeys(input, prompts) {
  const allKeys = new Set(prompts.map((item) => item.sceneAssetKey));
  if (input === undefined || input === null) return allKeys;
  if (!Array.isArray(input) || input.length === 0) throw new InputError('没有需要生成图片的场景。');
  const requested = new Set(input.map((value) => requiredString(value, '待生成场景ID')));
  for (const key of requested) if (!allKeys.has(key)) throw new InputError('待生成场景不属于当前视觉提案。');
  return requested;
}

function validatePropGenerationInput(input) {
  const sceneInput = validateSceneGenerationInput(input);
  return { script: sceneInput.script, styleSelection: sceneInput.styleSelection, generationPreset: sceneInput.generationPreset, preferences: { language: '中文', requirements: ['只建立剧本需要反复识别或发生状态变化的关键可移动道具。', '道具资产板固定横版3:2，独立于剧情画幅。'] } };
}

function validatePropProposals(input) {
  if (!Array.isArray(input) || input.length === 0 || JSON.stringify(input).length > 1_000_000) throw new InputError('已确认的道具视觉提案无效。');
  return JSON.parse(JSON.stringify(input));
}

function validateReusablePropPrompts(input, proposals, styleId) {
  if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) return [];
  if (!Array.isArray(input) || input.length > proposals.length) throw new InputError('已保存的道具提示词与当前道具数量不一致。');
  const proposalsByKey = new Map(proposals.map((proposal) => [proposal.propAssetKey, proposal]));
  const seen = new Set();
  return input.map((item) => {
    const propAssetKey = requiredString(item?.propAssetKey, '道具提示词道具ID');
    const proposal = proposalsByKey.get(propAssetKey);
    const name = requiredString(item?.name, '道具提示词名称');
    const promptStyleId = requiredString(item?.styleId, '道具提示词风格ID');
    const prompt = requiredString(item?.prompt, '道具图片提示词');
    if (!proposal || seen.has(propAssetKey) || name !== proposal.name || promptStyleId !== styleId) throw new InputError('已保存的道具提示词与当前提案或画风不一致。');
    seen.add(propAssetKey);
    return { propAssetKey, name, styleId: promptStyleId, prompt: sanitizeProductionPrompt(prompt) };
  });
}

function validateRequestedPropKeys(input, prompts) {
  const allKeys = new Set(prompts.map((item) => item.propAssetKey));
  const unavailableKeys = new Set(prompts.filter((item) => item.sourceMappingStatus === 'needs_review' || !Array.isArray(item.sourceSceneKeys) || item.sourceSceneKeys.length === 0).map((item) => item.propAssetKey));
  if (input === undefined || input === null) return new Set([...allKeys].filter((key) => !unavailableKeys.has(key)));
  if (!Array.isArray(input) || input.length === 0) throw new InputError('没有需要生成图片的道具。');
  const requested = new Set(input.map((value) => requiredString(value, '待生成道具ID')));
  for (const key of requested) if (!allKeys.has(key)) throw new InputError('待生成道具不属于当前视觉提案。');
  for (const key of requested) if (unavailableKeys.has(key)) throw new InputError('该道具的剧本场次归属尚待确认，当前保留文字设定，不生成固定资产图。');
  return requested;
}

function validateStoryboardGenerationInput(input, generatedImageDirectory) {
  const sceneInput = validateSceneGenerationInput(input);
  const segmentDurationSec = Number(input?.segmentDurationSec ?? 15);
  if (!Number.isInteger(segmentDurationSec) || segmentDurationSec < 5 || segmentDurationSec > 15) throw new InputError('分镜分段时长必须是5到15秒的整数。');
  const panelCount = Number(input?.panelCount ?? 6);
  if (![3, 4, 6, 9].includes(panelCount)) throw new InputError('故事板规格必须是3、4、6或9宫格。');
  const profiles = Array.isArray(input?.profiles) ? JSON.parse(JSON.stringify(input.profiles)) : [];
  const characterImages = Array.isArray(input?.characterImages) ? input.characterImages.filter((item) => isGenerationStyleCompatible(item?.generationPreset, sceneInput.generationPreset)) : [];
  const sceneProposals = Array.isArray(input?.sceneProposals) ? input.sceneProposals : [];
  const sceneImages = Array.isArray(input?.sceneImages) ? input.sceneImages.filter((item) => isGenerationStyleCompatible(item?.generationPreset, sceneInput.generationPreset)) : [];
  const propProposals = Array.isArray(input?.propProposals) ? input.propProposals : [];
  const propImages = Array.isArray(input?.propImages) ? input.propImages.filter((item) => isGenerationStyleCompatible(item?.generationPreset, sceneInput.generationPreset)) : [];
  const assets = [];
  const assetMediaPaths = {};
  for (const profile of profiles) {
    const image = characterImages.find((item) => item?.profileKey === profile.profileKey && item.status === 'complete' && item.imageUrl);
    const assetId = `web-storyboard-character-${profile.profileKey.toLowerCase()}`;
    assets.push({ assetId, version: 1, approval: 'approved', assetKind: 'character', label: `${profile.name}主资产`, description: profile.introduction || profile.identity || profile.name, characterName: profile.name });
    if (image) assetMediaPaths[assetId] = generatedImagePath(image.imageUrl, generatedImageDirectory, '角色主图');
  }
  for (const proposal of sceneProposals) {
    const image = sceneImages.find((item) => item?.sceneAssetKey === proposal.sceneAssetKey && item.status === 'complete' && item.imageUrl);
    const assetId = `web-storyboard-scene-${proposal.sceneAssetKey.toLowerCase()}-main`;
    assets.push({ assetId, version: 1, approval: 'approved', assetKind: 'scene', label: `${proposal.name}场景主资产`, description: proposal.visualDesignProposal?.locationIdentity || proposal.name, sceneAssetKey: proposal.sceneAssetKey, sourceSceneKeys: proposal.sourceSceneKeys, viewKey: 'main' });
    if (image) assetMediaPaths[assetId] = generatedImagePath(image.imageUrl, generatedImageDirectory, '场景主图');
  }
  for (const proposal of propProposals) {
    const image = proposal.selectedForProduction === false ? undefined : propImages.find((item) => item?.propAssetKey === proposal.propAssetKey && !item.stale && item.status === 'complete' && item.imageUrl);
    const assetId = `web-storyboard-prop-${proposal.propAssetKey.toLowerCase()}-dormant`;
    assets.push({ assetId, version: 1, approval: 'approved', assetKind: 'prop', label: proposal.name, description: proposal.baseStateDescription || proposal.name, propAssetKey: proposal.propAssetKey, stateKey: 'dormant' });
    if (image) assetMediaPaths[assetId] = generatedImagePath(image.imageUrl, generatedImageDirectory, '道具主图');
  }
  return { ...sceneInput, assets, assetMediaPaths, profiles, segmentDurationSec, panelCount, preferences: { language: '中文', requirements: ['只输出简洁分镜卡，保持剧本证据、角色身份和已确认场景资产一致。', `目标画面比例为${sceneInput.generationPreset.aspectRatio}。`] } };
}

function generatedImagePath(imageUrl, generatedImageDirectory, label) {
  const value = requiredString(imageUrl, label);
  if (value.startsWith('/api/free-canvas/imports/')) return freeCanvasReferenceMediaPath(value, 'image', generatedImageDirectory, label);
  const filename = decodeURIComponent(value.replace(/^\/api\/generated-images\//, ''));
  if (value === filename || basename(filename) !== filename || !/\.(png|webp|jpe?g)$/i.test(filename)) throw new InputError(`${label}地址无效。`);
  const mediaPath = resolve(generatedImageDirectory, filename);
  if (dirname(mediaPath) !== generatedImageDirectory || !existsSync(mediaPath)) throw new InputError(`没有找到${label}文件。`);
  return mediaPath;
}

function freeCanvasReferenceMediaPath(mediaUrl, kind, generatedImageDirectory, label) {
  const value = requiredString(mediaUrl, label);
  if (kind === 'image' && value.startsWith('/api/generated-images/')) return generatedImagePath(value, generatedImageDirectory, label);
  if (!value.startsWith('/api/free-canvas/imports/')) throw new InputError(`${label}地址无效。`);
  const filename = decodeURIComponent(value.slice('/api/free-canvas/imports/'.length));
  if (basename(filename) !== filename) throw new InputError(`${label}地址无效。`);
  const imported = classifyFreeCanvasImportedMedia(filename);
  if (imported.kind !== kind) throw new InputError(`${label}类型与节点不一致。`);
  const mediaPath = resolve(FREE_CANVAS_IMPORT_DIRECTORY, filename);
  if (dirname(mediaPath) !== FREE_CANVAS_IMPORT_DIRECTORY || !existsSync(mediaPath)) throw new InputError(`没有找到${label}文件。`);
  return mediaPath;
}

function validateStoryboardSegments(input, safeInput) {
  if (!Array.isArray(input) || input.length === 0 || JSON.stringify(input).length > 2_000_000) throw new InputError('已确认的文字分镜无效。');
  const segments = JSON.parse(JSON.stringify(input));
  validateStoryboardPromptDraft({ segments }, safeInput);
  return segments;
}

function validateReusableStoryboardBoards(planInput, promptInput, segments, planInputs, assets) {
  const emptyPlans = planInput === undefined || planInput === null || (Array.isArray(planInput) && planInput.length === 0);
  const emptyPrompts = promptInput === undefined || promptInput === null || (Array.isArray(promptInput) && promptInput.length === 0);
  if (emptyPlans && emptyPrompts) return null;
  if (emptyPlans !== emptyPrompts || !Array.isArray(planInput) || !Array.isArray(promptInput) || planInput.length !== promptInput.length) throw new InputError('已保存的故事板规划或提示词数量不一致。');
  const plans = planInput.map((item) => {
    const segmentKey = requiredString(item?.segmentKey, '故事板规划分镜ID');
    const segment = segments.find((candidate) => candidate.segmentKey === segmentKey);
    const planContext = planInputs.find((candidate) => candidate.segment.segmentKey === segmentKey);
    if (!segment || !planContext) throw new InputError('已保存的故事板规划不属于当前文字分镜。');
    const plan = normalizeStoryboardBoardPlanReferences(JSON.parse(JSON.stringify(item.plan)), planContext);
    validateStoryboardBoardPlan(plan, segment.durationSec, planContext.panelCount, planContext.allowedReferenceContext);
    return { ...JSON.parse(JSON.stringify(item)), plan };
  });
  const prompts = promptInput.map((item) => {
    const segmentKey = requiredString(item?.segmentKey, '故事板提示词分镜ID');
    const segment = segments.find((candidate) => candidate.segmentKey === segmentKey);
    const title = requiredString(item?.title, '故事板提示词标题');
    const prompt = requiredString(item?.prompt, '故事板图片提示词');
    if (!segment || title !== segment.title || prompt.length > 100_000) throw new InputError('已保存的故事板提示词与当前分镜不一致。');
    const plan = plans.find((candidate) => candidate.segmentKey === segmentKey);
    const referenceLabels = plan ? selectStoryboardReferenceAssets(segment, plan.plan, assets).map((asset) => asset.label) : [];
    return { segmentKey, title, panelCount: plan?.plan?.panelCount, prompt: synchronizeStoryboardPromptReferences(sanitizeProductionPrompt(prompt), referenceLabels) };
  });
  const planKeys = plans.map((item) => item.segmentKey);
  const promptKeys = prompts.map((item) => item.segmentKey);
  if (new Set(planKeys).size !== planKeys.length || new Set(promptKeys).size !== promptKeys.length || planKeys.some((key) => !promptKeys.includes(key)) || promptKeys.some((key) => !planKeys.includes(key))) throw new InputError('已保存的故事板规划或提示词分镜不一致。');
  return { plans, prompts };
}

function validateRequestedStoryboardKeys(input, segments) {
  const allKeys = new Set(segments.map((item) => item.segmentKey));
  if (input === undefined || input === null) return allKeys;
  if (!Array.isArray(input) || input.length === 0) throw new InputError('没有需要生成故事板的分镜。');
  const requested = new Set(input.map((value) => requiredString(value, '待生成分镜ID')));
  for (const key of requested) if (!allKeys.has(key)) throw new InputError('待生成分镜不属于当前文字分镜。');
  return requested;
}

function validateVideoPromptBoardPlans(input, segments, panelCount) {
  if (!Array.isArray(input) || JSON.stringify(input).length > 3_000_000) throw new InputError('请先准备所选分镜的宫格规划。');
  return segments.map(segment => {
    const matches = input.filter(item => item?.segmentKey === segment.segmentKey && !item.stale);
    if (matches.length !== 1) throw new InputError(`${segment.segmentKey} 缺少当前版本的唯一宫格规划，请先准备这一段。`);
    validateStoryboardBoardPlan(matches[0].plan, segment.durationSec, panelCount);
    return structuredClone(matches[0]);
  });
}

function validateOptionalStoryboardBoards(input, segments, generatedImageDirectory) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > segments.length) throw new InputError('故事板图片记录与当前文字分镜不一致。');
  const allowedKeys = new Set(segments.map((segment) => segment.segmentKey));
  const seenKeys = new Set();
  for (const item of input) {
    const segmentKey = requiredString(item?.segmentKey, '故事板图片分镜ID');
    if (!allowedKeys.has(segmentKey) || seenKeys.has(segmentKey)) throw new InputError('故事板图片记录与当前文字分镜不一致。');
    seenKeys.add(segmentKey);
    if (item.status === 'complete') {
      if (!item.imageUrl) throw new InputError(`${segmentKey}故事板完成记录缺少图片。`);
      generatedImagePath(item.imageUrl, generatedImageDirectory, `${segmentKey}故事板`);
    }
  }
  return JSON.parse(JSON.stringify(input));
}

function validateRequestedVideoPromptKeys(input, segments) {
  const allKeys = new Set(segments.map((segment) => segment.segmentKey));
  if (input === undefined || input === null) return allKeys;
  if (!Array.isArray(input) || input.length === 0) throw new InputError('没有需要生成视频提示词的分镜。');
  const requested = new Set(input.map((value) => requiredString(value, '待生成视频提示词分镜ID')));
  for (const key of requested) if (!allKeys.has(key)) throw new InputError('待生成视频提示词不属于当前分镜。');
  return requested;
}

function buildWebVideoPromptInputs(requestedSegments, boardPlans, allSegments, safeInput, storyboardBoards = [], referenceSource = {}) {
  return requestedSegments.map((segment) => {
    const plan = boardPlans.find((item) => item.segmentKey === segment.segmentKey)?.plan;
    if (!plan) throw new InputError(`${segment.segmentKey}缺少已确认故事板规划。`);
    const sceneAsset = safeInput.assets.find((asset) => asset.assetKind === 'scene' && asset.sceneAssetKey === segment.sceneAssetKey)
      ?? safeInput.assets.find((asset) => asset.assetKind === 'scene' && asset.sourceSceneKeys?.includes(segment.sceneKey));
    const requiredCharacters = plan.referenceRequirements?.characters ?? plan.semanticDecision.visibleCharacters;
    for (const characterName of requiredCharacters) {
      if (safeInput.assets.some((asset) => asset.assetKind === 'character') && !safeInput.assets.some((asset) => asset.assetKind === 'character' && asset.characterName === characterName)) {
        throw new InputError(`${segment.segmentKey}要求的角色“${characterName}”不在已确认资产清单中。`);
      }
    }
    const requiredProps = plan.referenceRequirements?.props ?? plan.semanticDecision.visibleProps;
    for (const prop of requiredProps) {
      if (safeInput.assets.some((asset) => asset.assetKind === 'prop') && !safeInput.assets.some((asset) => asset.assetKind === 'prop' && asset.label === prop.propName)) {
        throw new InputError(`${segment.segmentKey}要求的道具“${prop.propName}”不在已确认资产清单中。`);
      }
    }
    const index = allSegments.findIndex((item) => item.segmentKey === segment.segmentKey);
    const sceneKeys = Array.isArray(segment.sceneKeys) && segment.sceneKeys.length ? segment.sceneKeys : [segment.sceneKey];
    const endingScene = safeInput.script.scenes.find((item) => item.sceneKey === sceneKeys.at(-1));
    const crossedSceneKeys = sceneKeys.slice(0, -1);
    if (endingScene && segment.transition === endingScene.transitionOut) crossedSceneKeys.push(endingScene.sceneKey);
    const requiredTransition = crossedSceneKeys
      .map((sceneKey) => safeInput.script.scenes.find((item) => item.sceneKey === sceneKey)?.transitionDirection)
      .filter(Boolean)
      .join('\n');
    return {
      segment: { ...segment, id: `web-video-${segment.segmentKey.toLowerCase()}`, groundedEvidence: groundStoryboardEvidence(segment, safeInput.script) },
      boardPlan: plan,
      styleName: safeInput.styleSelection.name,
      sceneAssetKey: sceneAsset?.sceneAssetKey || `text-scene-${segment.sceneKey}`,
      storyboardBoardAvailable: storyboardBoards.some((board) => board.segmentKey === segment.segmentKey && board.status === 'complete' && !board.stale && board.imageUrl),
      storyboardReference: resolveVideoPromptReferences(plan, segment, { ...referenceSource, boards: storyboardBoards }).storyboardReference,
      referenceBindings: resolveVideoPromptReferenceBindings(plan, segment, { ...referenceSource, boards: storyboardBoards }),
      continuityContext: { previous: allSegments[index - 1]?.storyboardText || '', next: allSegments[index + 1]?.storyboardText || '' },
      requiredTransition,
      revisionRequest: optionalBoundedString(referenceSource.revisionRequest, 4000),
      currentDraft: Array.isArray(referenceSource.currentDrafts) ? referenceSource.currentDrafts.find(item => item?.segmentKey === segment.segmentKey) ?? null : null,
    };
  });
}

function resolveVideoPromptReferenceBindings(plan, segment, input) {
  let subjectIndex = 1;
  return resolveVideoPromptReferenceEntries(plan, segment, input).map((entry, index) => ({
    pictureTag: `<Picture ${index + 1}>`,
    label: entry.label,
    assetKind: entry.assetKind,
    entityName: entry.entityName,
    role: entry.role,
    ...(entry.assetKind === 'character' ? { subjectTag: `<Subject ${subjectIndex++}>` } : {}),
  }));
}

function resolveVideoPromptReferenceEntries(plan, segment, input) {
  const entries = [];
  const seenUrls = new Set();
  const requirements = plan.referenceRequirements ?? {};
  const characterNames = (requirements.characters ?? []).map((item) => typeof item === 'string' ? item : item?.characterName).filter(Boolean);
  const propRequirements = requirements.props ?? [];
  const sceneRequired = requirements.sceneRequired !== false && requirements.scene?.required !== false;
  const sceneAssetKey = requirements.scene?.sceneAssetKey || segment.sceneAssetKey;
  const add = (assetKind, entityName, label, role, imageUrl) => {
    if (!imageUrl || seenUrls.has(imageUrl)) return;
    seenUrls.add(imageUrl);
    entries.push({ assetKind, entityName, label, role, imageUrl });
  };
  for (const characterName of characterNames) {
    const image = input.characterImages?.find((item) => item.name === characterName && item.status === 'complete' && item.imageUrl);
    add('character', characterName, `${characterName}角色主图`, '仅锁定人物身份、面部、发型、服装与外形一致性，不作为首帧', image?.imageUrl);
  }
  if (sceneRequired) {
    const image = input.sceneImages?.find((item) => item.sceneAssetKey === sceneAssetKey && item.status === 'complete' && item.imageUrl);
    add('scene', sceneAssetKey, `${image?.name || sceneAssetKey}场景主图`, '仅锁定空间布局、固定陈设、色彩与照明关系，不作为首帧', image?.imageUrl);
  }
  for (const prop of propRequirements) {
    const image = input.propImages?.find((item) => item.name === prop.propName && item.status === 'complete' && item.imageUrl);
    add('prop', prop.propName, `${prop.propName}道具图`, `仅锁定道具形制、材质与${prop.state}状态，不作为首帧`, image?.imageUrl);
  }
  const board = input.boards?.find(item => item.segmentKey === segment.segmentKey && item.status === 'complete' && !item.stale && item.imageUrl);
  if (board) add('storyboard', segment.segmentKey, `${segment.segmentKey}整张${board.panelCount || plan.panelCount || input.panelCount || 6}宫格`, '按从左到右、从上到下的画格顺序，控制对应镜头的视角、人物位置、构图、动作状态与连续性，作为分镜参考', board.imageUrl);
  return entries;
}

function resolveVideoPromptReferences(plan, segment, input) {
  const board = input.boards?.find((item) => item.segmentKey === segment.segmentKey && item.status === 'complete' && !item.stale && item.imageUrl);
  const panelCount = [3, 4, 6, 9].includes(Number(board?.panelCount))
    ? Number(board.panelCount)
    : [3, 4, 6, 9].includes(Number(input?.panelCount))
      ? Number(input.panelCount)
      : 6;
  const entries = resolveVideoPromptReferenceEntries(plan, segment, input);
  const labels = entries.map(entry => entry.label);
  const imageUrls = entries.map(entry => entry.imageUrl);
  const storyboardIndex = entries.findIndex(entry => entry.assetKind === 'storyboard');
  return { labels: labels.length ? labels : [`无图片参考，使用已确认文字分镜与结构化${panelCount}格规划`], imageUrls,
    storyboardReference: storyboardIndex >= 0 ? { imageUrl: imageUrls[storyboardIndex], pictureTag: `<Picture ${storyboardIndex + 1}>`, panelCount } : undefined };
}

export function attachStoryboardVideoImage(input, generatedImageDirectory) {
  if ((input.referenceBindings?.length ?? 0) > 9) throw new InputError(`${input.segment.segmentKey}含故事板共超过9张参考图，请减少本段参考资产。`);
  if (!input.storyboardReference) return input;
  const { imageUrl, pictureTag, panelCount } = input.storyboardReference;
  const path = generatedImagePath(imageUrl, generatedImageDirectory, `${input.segment.segmentKey}故事板`);
  if (statSync(path).size > 20 * 1024 * 1024) throw new InputError(`${input.segment.segmentKey}故事板超过20MB，请先缩小图片后再生成视频提示词。`);
  const bytes = readFileSync(path);
  const mediaType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
  if (!mediaType) throw new InputError(`${input.segment.segmentKey}故事板文件不是可读取的PNG、JPEG或WebP图片，请重新选择有效图片。`);
  input.storyboardImage = { id: `${input.segment.segmentKey}-storyboard`, description: `仅属于${input.segment.segmentKey}的整张${panelCount}宫格；本段H3标签为${pictureTag}，其他段的同名标签与此图无关。按从左到右、从上到下读图。`, mediaType, data: bytes.toString('base64') };
  return input;
}

function buildWebStoryboardPlanInputs(segments, safeInput) {
  return segments.map((segment, index) => {
    const characterNames = segment.characters ?? [];
    const characterAnchor = safeInput.profiles.filter((profile) => characterNames.includes(profile.name)).map((profile) => `${profile.name}：${profile.introduction || profile.identity}`).join('；') || '本段没有可见人物';
    const sceneKeys = Array.isArray(segment.sceneKeys) && segment.sceneKeys.length ? segment.sceneKeys : [segment.sceneKey];
    const sceneAsset = safeInput.assets.find((asset) => asset.assetKind === 'scene' && asset.sceneAssetKey === segment.sceneAssetKey) ?? safeInput.assets.find((asset) => asset.assetKind === 'scene' && asset.sourceSceneKeys?.some((key) => sceneKeys.includes(key)));
    const sceneAnchor = sceneKeys.map((sceneKey) => {
      const asset = safeInput.assets.find((item) => item.assetKind === 'scene' && item.sourceSceneKeys?.includes(sceneKey));
      const scene = safeInput.script.scenes.find((item) => item.sceneKey === sceneKey);
      return `${sceneKey}：${asset?.description || scene?.purpose || scene?.heading || ''}`;
    }).filter((value) => !value.endsWith('：')).join('；');
    const referenceAssets = segment.referenceAssetIds.map((assetId) => safeInput.assets.find((asset) => asset.assetId === assetId)).filter(Boolean);
    const preparedAssets = safeInput.assets.filter((asset) => Boolean(safeInput.assetMediaPaths[asset.assetId]));
    const allowedReferenceContext = {
      characters: preparedAssets.filter((asset) => asset.assetKind === 'character').map((asset) => asset.characterName).filter(Boolean),
      sceneRequired: preparedAssets.some((asset) => asset.assetKind === 'scene' && (asset.assetId === sceneAsset?.assetId || asset.sourceSceneKeys?.some((key) => sceneKeys.includes(key)))),
      props: preparedAssets.filter((asset) => asset.assetKind === 'prop').map((asset) => ({ propName: asset.label, state: asset.stateKey })).filter((prop) => prop.propName && prop.state),
    };
    return {
      segment: { ...segment, id: `web-storyboard-${segment.segmentKey.toLowerCase()}`, groundedEvidence: groundStoryboardEvidence(segment, safeInput.script) },
      panelCount: safeInput.panelCount,
      styleName: safeInput.styleSelection.name,
      characterAnchor,
      sceneAnchor: sceneAnchor || sceneAsset?.description || segment.storyboardText,
      referenceDescription: referenceAssets.map((asset) => asset.label).join('、') || '不使用固定角色、场景或道具资产，以已确认剧本和文字分镜为准',
      availableAssetContext: safeInput.assets.map(({ assetId: _assetId, version: _version, approval: _approval, ...asset }) => asset),
      allowedReferenceContext,
      continuityContext: { previous: segments[index - 1]?.storyboardText || '', next: segments[index + 1]?.storyboardText || '' },
    };
  });
}

function compileStoryboardBoardPromptForPlan(planInput, plan, assets) {
  const references = selectStoryboardReferenceAssets(planInput.segment, plan, assets);
  return compileStoryboardBoardImagePrompt({
    ...planInput,
    referenceDescription: references.map((asset) => asset.label).join('、') || '不使用固定角色、场景或道具资产，以已确认剧本和文字分镜为准',
  }, plan);
}

function synchronizeStoryboardPromptReferences(prompt, referenceLabels) {
  const referenceLine = `参考图：${referenceLabels.join('、') || '不使用固定角色、场景或道具资产，以已确认剧本和文字分镜为准'}`;
  if (/^参考图：.*$/mu.test(prompt)) return prompt.replace(/^参考图：.*$/mu, referenceLine);
  return `${referenceLine}\n${prompt}`;
}

function selectStoryboardReferenceAssets(segment, plan, assets) {
  const selected = [];
  const requirements = plan.referenceRequirements;
  const add = (asset) => { if (asset && !selected.some((item) => item.assetId === asset.assetId)) selected.push(asset); };
  for (const name of requirements?.characters ?? segment.characters ?? []) add(assets.find((asset) => asset.assetKind === 'character' && asset.characterName === name));
  if (requirements?.sceneRequired !== false) add(assets.find((asset) => asset.assetKind === 'scene' && asset.sceneAssetKey === segment.sceneAssetKey) ?? assets.find((asset) => asset.assetKind === 'scene' && asset.sourceSceneKeys?.includes(segment.sceneKey)));
  for (const prop of requirements?.props ?? []) add(assets.find((asset) => asset.assetKind === 'prop' && asset.label === prop.propName && (asset.stateKey === prop.state || prop.state === 'destroyed' && asset.stateKey === 'activated')));
  if (selected.length === 0) for (const assetId of segment.referenceAssetIds) add(assets.find((asset) => asset.assetId === assetId));
  return selected;
}

function validateReusableCharacterPrompts(input, safeInput) {
  if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) return null;
  if (!Array.isArray(input) || input.length !== safeInput.characterProfileSet.profiles.length) throw new InputError('已保存的角色提示词与当前人物数量不一致，请重新生成提示词。');
  return input.map((item, index) => {
    const profile = safeInput.characterProfileSet.profiles[index];
    const profileKey = requiredString(item?.profileKey, '角色提示词人物ID');
    const name = requiredString(item?.name, '角色提示词人物名');
    const styleId = requiredString(item?.styleId, '角色提示词风格ID');
    const prompt = requiredString(item?.prompt, '角色图片提示词');
    if (profileKey !== profile.profileKey || name !== profile.name || styleId !== safeInput.styleSelection.id.replace(/^web-style-/, '')) throw new InputError('已保存的角色提示词与当前人物或风格不一致，请重新生成提示词。');
    if (prompt.length > 100_000) throw new InputError('已保存的角色图片提示词过长。');
    return { profileKey, name, styleId, prompt: upgradeProductionPrompt(prompt, styleId) };
  });
}

function sanitizeProductionPrompt(value) {
  return value
    .replace(/OiiOii式/gi, '双栏')
    .replace(/Oii式/gi, '双栏')
    .replace(/OiiOii/gi, '')
    .replace(/Oii/gi, '');
}

function upgradeProductionPrompt(value, styleId) {
  const sanitized = sanitizeProductionPrompt(value);
  const legacyAnchor = LEGACY_STYLE_ANCHORS.get(styleId);
  const currentAnchor = STYLE_PRESETS.find((item) => item.id === normalizeStylePresetId(styleId))?.styleAnchor;
  return legacyAnchor && currentAnchor ? sanitized.replace(legacyAnchor, currentAnchor) : sanitized;
}

function validateRequestedProfileKeys(input, prompts) {
  const allKeys = new Set(prompts.map((item) => item.profileKey));
  if (input === undefined || input === null) return allKeys;
  if (!Array.isArray(input) || input.length === 0) throw new InputError('没有需要生成图片的角色。');
  const requested = new Set(input.map((value) => requiredString(value, '待生成角色ID')));
  for (const key of requested) if (!allKeys.has(key)) throw new InputError('待生成角色不属于当前人物简介。');
  return requested;
}

export function safeImageMessage(error) {
  if (error instanceof LocalImageToolsProviderError) return `${error.message} 没有自动重试，原图已保留。`;
  if (error instanceof OpenAIImagesProviderError) {
    const upstream = typeof error.message === 'string' ? error.message.trim().slice(0, 600) : '';
    const moderationBlocked = error.code === 'moderation_blocked' || /(?:rejected|blocked).*(?:safety|moderation)|(?:safety|moderation).*(?:rejected|blocked)/iu.test(upstream);
    const presentation = moderationBlocked
      ? {
          message: '图片请求被安全审核拦截。',
          suggestion: '处理建议：保留剧情目标，将可能涉及未成年人、威胁、伤害或其他敏感内容的动作改为非接触、非伤害表达，并检查参考图后再手动提交。',
        }
      : error.status === 401 || error.status === 403
        ? { message: '图片服务鉴权失败。', suggestion: '处理建议：检查服务地址、密钥、模型名称及当前账号的图片权限。' }
        : error.status === 429
          ? { message: '图片服务当前限流或额度不足。', suggestion: '处理建议：检查额度与并发限制，等待服务恢复后再手动提交。' }
          : error.code === 'image_request_timeout'
            ? { message: `${error.diagnostics?.phase === 'image_download' ? '结果图片下载' : error.diagnostics?.phase === 'generation_response' ? '图片生成响应读取' : '图片生成请求等待'}超时。`, suggestion: '处理建议：先到服务商后台核对本次请求是否已生成或扣费；确认结果后再决定是否重新提交。' }
            : error.code === 'network_error'
              ? { message: '图片生成请求连接中断。', suggestion: '处理建议：检查网络或代理，并到服务商后台核对本次请求的最终状态。' }
            : error.code === 'image_download_error'
              ? { message: '图片生成接口已返回，结果图片下载失败。', suggestion: '处理建议：检查结果下载地址和网络，并先从服务商后台尝试取回图片。' }
            : error.code === 'image_edit_not_verified'
              ? { message: '当前图片模型尚未确认支持参考图编辑。', suggestion: '处理建议：在连接设置中选择已验证的图片编辑模型。' }
              : error.code === 'invalid_reference_count'
                ? { message: '参考图数量不符合当前模型要求。', suggestion: '处理建议：按页面提示精简参考图，并确保每张图只承担一个明确作用。' }
                : error.code === 'reference_image_read_error' || error.code === 'invalid_reference_image'
                  ? { message: '参考图无法读取或格式不受支持。', suggestion: '处理建议：重新选择可正常打开的PNG、JPEG或WebP图片。' }
                  : error.code === 'invalid_image_dimensions'
                    ? { message: '图片已返回，但尺寸无法读取。', suggestion: '处理建议：检查返回文件是否完整，并确认图片服务输出了有效图片。' }
                    : error.code === 'dimension_mismatch'
                      ? { message: '图片已返回，但画幅与任务要求不一致。', suggestion: '处理建议：检查图片尺寸设置；已有结果会保留，可人工判断是否采用。' }
                      : error.code === 'image_count_mismatch'
                        ? { message: '图片服务返回的候选数量与请求不一致。', suggestion: '处理建议：先查看已保留的候选图，再决定是否手动重新提交。' }
                        : ['missing_image_data', 'missing_image_content', 'invalid_image_bytes', 'invalid_response_body'].includes(error.code || '')
                          ? { message: '图片服务没有返回可读取的图片结果。', suggestion: '处理建议：核对模型兼容性和服务状态，并保留请求ID用于排查。' }
                          : error.code === 'seedream_single_output_only'
                            ? { message: '当前Seedream适配每次请求只生成1张图片。', suggestion: '处理建议：把本次生成数量设为1，再手动提交。' }
                            : error.code === 'seedream_output_format_unsupported'
                              ? { message: 'Seedream不支持本次图片输出格式。', suggestion: '处理建议：选择PNG或JPEG，再手动提交。' }
                              : error.code === 'seedream_dimensions_unsupported'
                                ? { message: '当前图片尺寸超出Seedream 5.0 Pro支持范围。', suggestion: '处理建议：选择1K、1.5K或2K范围内的有效尺寸，再手动提交。' }
                                : error.code === 'seedream_reference_too_large'
                                  ? { message: 'Seedream参考图文件超过30MB。', suggestion: '处理建议：压缩对应参考图后再手动提交。' }
                          : error.status && error.status >= 500
                            ? { message: `图片服务暂时异常（HTTP ${error.status}）。`, suggestion: '处理建议：稍后确认服务恢复，再手动提交当前任务。' }
                            : error.status === 400
                              ? { message: '图片服务未接受本次请求（HTTP 400）。', suggestion: '处理建议：检查提示词、参考图及模型参数，按错误代码调整后再手动提交。' }
                              : { message: `图片生成失败${error.status ? `（HTTP ${error.status}）` : ''}。`, suggestion: '处理建议：根据错误代码检查图片服务设置和本次输入后再手动提交。' };
    const generic = !upstream || /^Images API failed with HTTP \d+\.?$/i.test(upstream);
    const chineseUpstream = !generic && /[\u3400-\u9fff]/u.test(upstream) ? upstream : '';
    const details = [
      chineseUpstream ? `上游说明：${chineseUpstream}` : '',
      error.code ? `错误代码：${String(error.code).slice(0, 120)}` : '',
      Number.isFinite(error.diagnostics?.elapsedMs) ? `已等待：${Math.round(error.diagnostics.elapsedMs / 1000)}秒` : '',
      Number.isFinite(error.diagnostics?.timeoutMs) ? `等待上限：${Math.round(error.diagnostics.timeoutMs / 1000)}秒` : '',
      error.diagnostics?.transportCode ? `连接代码：${error.diagnostics.transportCode}` : '',
      error.diagnostics?.requestId ? `请求ID：${String(error.diagnostics.requestId).slice(0, 200)}` : '',
    ].filter(Boolean);
    return `${presentation.message}${details.length ? ` ${details.join('；')}。` : ''}${presentation.suggestion}没有自动重试。`;
  }
  return '图片生成失败，已有结果已保留且没有自动重试。';
}

export function toApprovedDomainScript(ideaScript) {
  if (!Array.isArray(ideaScript.scenes) || ideaScript.scenes.length === 0) throw new InputError('剧本缺少场景内容。');
  const timestamp = new Date().toISOString();
  const totalDuration = Number.isFinite(Number(ideaScript.durationSec)) ? Math.max(1, Number(ideaScript.durationSec)) : 60;
  let sourceOffset = 0;
  const scenes = ideaScript.scenes.map((scene, index) => {
    const sceneKey = `S${String(index + 1).padStart(2, '0')}`;
    const blocks = Array.isArray(scene.blocks) ? scene.blocks : [];
    const dialogue = blocks.length > 0
      ? blocks.filter((block) => block?.type === 'dialogue' || block?.type === 'os').map((block) => ({
        kind: ideaBlockSpeechKind(block),
        speakerName: requiredString(block.speaker, '对白角色'),
        text: requiredString(block.text, '对白内容'),
        delivery: typeof block.delivery === 'string' ? block.delivery.trim() : '',
      }))
      : (Array.isArray(scene.dialogue) ? scene.dialogue : []).map((line) => ({
        kind: 'dialogue', speakerName: requiredString(line?.speaker, '对白角色'), text: requiredString(line?.line, '对白内容'), delivery: '',
      }));
    const beats = Array.isArray(scene.beats) ? scene.beats.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()) : [];
    const evidence = [scene.summary, ...beats, ...blocks.map((block) => block?.text), ...dialogue.flatMap((line) => [line.speakerName, line.text, line.delivery])]
      .filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
    const actionBlocks = blocks.filter((block) => block?.type === 'action').map((block) => block.text.trim()).filter(Boolean);
    const transitionBlocks = blocks.filter((block) => block?.type === 'transition').map((block) => block.text.trim()).filter(Boolean);
    const sourceStart = sourceOffset;
    const sourceText = evidence.join('\n');
    sourceOffset += Math.max(1, sourceText.length);
    const location = requiredString(scene.location, '场景地点');
    const timeOfDay = requiredString(scene.time, '场景时间');
    return {
      id: `web-script-scene-${index + 1}`,
      sceneKey,
      order: index + 1,
      heading: `${location} · ${timeOfDay}`,
      location,
      timeOfDay,
      interiorExterior: 'mixed',
      sourceSegmentIds: [`web-source-scene-${index + 1}`],
      sourceStart,
      sourceEnd: sourceOffset,
      sourceEvidence: evidence.length > 0 ? evidence : [location],
      purpose: typeof scene.summary === 'string' && scene.summary.trim() ? scene.summary.trim() : beats.join('；') || '推进剧情。',
      durationSec: Math.max(1, index === ideaScript.scenes.length - 1 ? totalDuration - Math.floor(totalDuration / ideaScript.scenes.length) * index : Math.floor(totalDuration / ideaScript.scenes.length)),
      action: actionBlocks.join('\n') || beats.join('\n') || requiredString(scene.summary, '场景内容'),
      dialogue,
      soundCues: blocks.filter((block) => block?.type === 'sfx').map((block) => block.text.trim()).filter(Boolean),
      transitionOut: index === ideaScript.scenes.length - 1 ? 'fade_to_black' : 'continuous',
      transitionDirection: transitionBlocks.join('\n'),
    };
  });
  const episodeSynopsis = scenes.map((scene) => scene.purpose).filter(Boolean).join('；');
  const approvedLogline = ideaScript.workType === 'series'
    ? episodeSynopsis || '当前集剧情以已确认场景为准。'
    : requiredString(ideaScript.logline, '剧本简介');
  return {
    id: 'web-approved-script', version: 1, createdAt: timestamp, updatedAt: timestamp, approval: 'approved',
    episodeId: 'web-episode-1', episodeVersion: 1, documentId: 'web-script-source', documentVersion: 1,
    title: requiredString(ideaScript.title, '剧本标题'),
    logline: approvedLogline,
    synopsis: approvedLogline,
    targetDurationSec: totalDuration,
    estimatedDurationSec: totalDuration,
    openingHook: scenes[0].purpose,
    endingHook: requiredString(ideaScript.endingHook, '结尾钩子'),
    scenes,
    adaptationNotes: [],
    continuityOut: requiredString(ideaScript.endingHook, '结尾钩子'),
  };
}

export function ideaBlockSpeechKind(block) {
  if (block?.type !== 'os') return 'dialogue';
  const delivery = typeof block.delivery === 'string' ? block.delivery : '';
  if (/内心|心声/u.test(delivery)) return 'internal_monologue';
  if (/画外|旁白/u.test(delivery)) return 'voiceover';
  return 'dialogue';
}

function validateProductionBrief(input) {
  const workType = input?.workType;
  const creativeDirection = input?.creativeDirection == null ? 'story' : input.creativeDirection;
  const episodeCountMode = input?.episodeCountMode;
  if (!['single', 'series'].includes(workType)) throw new InputError('作品形态无效。');
  if (!['story', 'commercial', 'product', 'knowledge', 'documentary', 'music_visual'].includes(creativeDirection)) throw new InputError('作品方向无效。');
  const minimumDurationSec = workType === 'single' && creativeDirection !== 'story' ? 5 : 15;
  if (!Number.isInteger(input.durationSec) || input.durationSec < minimumDurationSec || input.durationSec > 600) throw new InputError('影片时长无效。');
  if (!['agent', 'fixed'].includes(episodeCountMode)) throw new InputError('集数规划方式无效。');
  const episodeCount = workType === 'series' && episodeCountMode === 'fixed' ? Number(input.episodeCount) : null;
  if (workType === 'series' && episodeCountMode === 'fixed' && (!Number.isInteger(episodeCount) || episodeCount < 2 || episodeCount > 30)) throw new InputError('预计集数必须在2到30集之间。');
  return {
    workType,
    creativeDirection,
    durationSec: input.durationSec,
    episodeCountMode,
    episodeCount,
    ratio: requiredString(input.ratio, '画面比例'),
    language: requiredString(input.language, '对白语言'),
    emotion: requiredString(input.emotion, '主情绪'),
  };
}

function validateSavedSession(saved) {
  if (!saved || ![1, 2].includes(saved.schemaVersion) || typeof saved.id !== 'string' || typeof saved.updatedAt !== 'string') return null;
  try {
    const state = sanitizeCreativeState(saved.state);
    return {
      schemaVersion: 2,
      id: saved.id,
      ...(saved.series && typeof saved.series.rootProjectId === 'string' && /^[0-9a-f-]{36}$/iu.test(saved.series.rootProjectId) && Number.isInteger(saved.series.episodeNumber) && saved.series.episodeNumber >= 1 && saved.series.episodeNumber <= 30 ? { series: { rootProjectId: saved.series.rootProjectId, title: optionalBoundedString(saved.series.title, 120), episodeNumber: saved.series.episodeNumber } } : {}),
      revision: Math.max(0, Math.floor(Number(saved.revision) || 0)),
      updatedAt: saved.updatedAt,
      state,
      workflow: deriveWorkflowSnapshot(state, saved.workflow ? sanitizeWorkflowSnapshot(saved.workflow, saved.updatedAt) : undefined, saved.updatedAt),
    };
  } catch {
    return null;
  }
}

function writeJsonAtomically(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temporaryPath, filePath);
}

function projectSummary(session, active) {
  const state = session.state;
  const explicitName = typeof state.projectName === 'string' ? state.projectName.trim() : '';
  const scriptTitle = typeof state.ideaScript?.title === 'string' ? state.ideaScript.title.trim() : '';
  const novelTitle = state.novelName?.replace(/\.(txt|md)$/i, '').trim();
  const ideaTitle = state.ideaText?.trim().slice(0, 24);
  const name = explicitName || scriptTitle || novelTitle || ideaTitle || '未命名项目';
  const status = state.ideaScript && state.scriptApproval !== 'approved' ? '剧本待确认' : state.step === 'workspace' ? '制作中' : state.step === 'start' ? '未开始' : '创作中';
  return { id: session.id, name, status, updatedAt: session.updatedAt, active, ...(state.workType === 'series' && state.ideaScript ? { seriesProjectId: session.series?.rootProjectId || session.id, episodeNumber: session.series?.episodeNumber || state.ideaScript.episodeNumber || 1 } : {}) };
}

function sanitizeCreativeState(input) {
  if (!input || typeof input !== 'object' || !ALLOWED_STEPS.has(input.step)) throw new InputError('创作会话状态无效。');
  const sanitizeIdeaOptions = (value) => Array.isArray(value) ? value.slice(0, 4).map((item) => ({
    id: boundedString(item?.id, 200),
    label: boundedString(item?.label, 500),
    description: boundedString(item?.description, 2_000),
  })) : [];
  const answers = Array.isArray(input.ideaAnswers) ? input.ideaAnswers.slice(0, 3).map((item) => ({
    question: boundedString(item?.question, 2_000),
    answer: boundedString(item?.answer, 2_000),
  })) : [];
  const options = sanitizeIdeaOptions(input.ideaOptions);
  if (Array.isArray(input.agentTranscript) && (input.agentTranscript.length > 2_000 || JSON.stringify(input.agentTranscript).length > 8_000_000)) throw new InputError('完整对话记录过大，无法安全写入当前项目。');
  const sanitizedAgentTranscript = Array.isArray(input.agentTranscript) ? input.agentTranscript.map((item, index) => ({
    id: optionalBoundedString(item?.id, 200) || `turn-${index + 1}`,
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    kind: ['source', 'question', 'answer', 'revision', 'message', 'reply', 'action', 'event'].includes(item?.kind) ? item.kind : 'message',
    text: boundedString(item?.text, 4_000_000),
    options: sanitizeIdeaOptions(item?.options),
    selectedOptionId: optionalBoundedString(item?.selectedOptionId, 200) || undefined,
    selectedOptionIds: Array.isArray(item?.selectedOptionIds) ? item.selectedOptionIds.map((id) => boundedString(id, 200)) : undefined,
    createdAt: optionalBoundedString(item?.createdAt, 100),
  })) : [];
  const agentTranscript = sanitizedAgentTranscript.map((entry, index) => {
    if (entry.kind !== 'question' || entry.options.length === 0) return entry;
    const answer = sanitizedAgentTranscript[index + 1];
    const selectedIds = answer?.kind === 'answer' ? answer.selectedOptionIds || (answer.selectedOptionId ? [answer.selectedOptionId] : []) : [];
    return { ...entry, options: entry.options.filter((option) => selectedIds.includes(option.id)) };
  });
  if (Array.isArray(input.managerTranscript) && (input.managerTranscript.length > 200 || JSON.stringify(input.managerTranscript).length > 1_000_000)) throw new InputError('总管对话记录过大，无法安全写入当前项目。');
  const managerTranscript = Array.isArray(input.managerTranscript) ? input.managerTranscript.map((item, index) => {
    const turn = item?.turn && typeof item.turn === 'object' ? {
      mode: 'command_plan',
      replyZh: boundedString(item.turn.replyZh, 4_000),
      intent: ['status', 'diagnose', 'change_plan', 'explain'].includes(item.turn.intent) ? item.turn.intent : 'explain',
      diagnosisZh: boundedString(item.turn.diagnosisZh, 4_000),
      targetStages: Array.isArray(item.turn.targetStages) ? [...new Set(item.turn.targetStages.filter((stageId) => STAGE_IDS.includes(stageId)))].slice(0, 8) : [],
      targetArtifacts: Array.isArray(item.turn.targetArtifacts) ? item.turn.targetArtifacts.slice(0, 20).map((artifact) => ({
        kind: optionalBoundedString(artifact?.kind, 100), id: optionalBoundedString(artifact?.id, 200), label: optionalBoundedString(artifact?.label, 1_000),
        stageId: STAGE_IDS.includes(artifact?.stageId) ? artifact.stageId : 'intake', status: optionalBoundedString(artifact?.status, 100),
      })) : [],
      proposedActions: Array.isArray(item.turn.proposedActions) ? item.turn.proposedActions.slice(0, 12).map((action, actionIndex) => ({
        order: actionIndex + 1, stageId: STAGE_IDS.includes(action?.stageId) ? action.stageId : 'intake',
        actionType: ['inspect', 'navigate', 'edit_draft', 'review', 'regenerate', 'remember_preference'].includes(action?.actionType) ? action.actionType : 'inspect',
        summaryZh: boundedString(action?.summaryZh, 1_000), requiresConfirmation: action?.requiresConfirmation === true,
        providerImpact: ['none', 'agent', 'image', 'image-edit', 'h3', 'music'].includes(action?.providerImpact) ? action.providerImpact : 'none',
        preferenceText: optionalBoundedString(action?.preferenceText, 1_000),
      })) : [],
      downstreamImpact: Array.isArray(item.turn.downstreamImpact) ? [...new Set(item.turn.downstreamImpact.filter((stageId) => STAGE_IDS.includes(stageId)))].slice(0, 15) : [],
      projectChanged: false,
      providerCallsStarted: false,
    } : undefined;
    return {
      id: optionalBoundedString(item?.id, 200) || `manager-turn-${index + 1}`,
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: boundedString(item?.text, 4_000),
      createdAt: optionalBoundedString(item?.createdAt, 100),
      turn,
      commands: Array.isArray(item?.commands) ? item.commands.slice(0, 12).flatMap((command) => {
        const kind = ['navigate', 'revise_character_design', 'revise_prop_design', 'regenerate_character_image', 'regenerate_scene_image', 'regenerate_prop_image', 'regenerate_storyboard_image', 'regenerate_video_prompt', 'remember_preference'].includes(command?.kind) ? command.kind : '';
        if (!kind || !STAGE_IDS.includes(command?.stageId)) return [];
        const target = command?.targetArtifact && typeof command.targetArtifact === 'object' ? {
          kind: optionalBoundedString(command.targetArtifact.kind, 100), id: optionalBoundedString(command.targetArtifact.id, 200), label: optionalBoundedString(command.targetArtifact.label, 1_000),
          stageId: STAGE_IDS.includes(command.targetArtifact.stageId) ? command.targetArtifact.stageId : command.stageId, status: optionalBoundedString(command.targetArtifact.status, 100),
        } : undefined;
        return [{
          id: optionalBoundedString(command.id, 240) || `manager-command-${index + 1}`,
          kind, stageId: command.stageId, summaryZh: boundedString(command.summaryZh, 1_000),
          status: ['ready', 'awaiting_confirmation', 'running', 'completed', 'failed', 'cancelled'].includes(command.status) ? command.status : 'awaiting_confirmation',
          requiresConfirmation: command.requiresConfirmation === true,
          providerImpact: ['none', 'agent', 'image', 'image-edit', 'h3', 'music'].includes(command.providerImpact) ? command.providerImpact : 'none',
          targetArtifact: target,
          instructionZh: optionalBoundedString(command.instructionZh, 4_000) || undefined,
          preferenceText: optionalBoundedString(command.preferenceText, 1_000) || undefined,
          downstreamImpact: Array.isArray(command.downstreamImpact) ? [...new Set(command.downstreamImpact.filter((stageId) => STAGE_IDS.includes(stageId)))].slice(0, 15) : [],
          createdAt: optionalBoundedString(command.createdAt, 100), completedAt: optionalBoundedString(command.completedAt, 100) || undefined,
          resultZh: optionalBoundedString(command.resultZh, 2_000) || undefined, errorZh: optionalBoundedString(command.errorZh, 2_000) || undefined,
          followUpChoice: ['mainline', 'sync_downstream'].includes(command.followUpChoice) ? command.followUpChoice : undefined,
        }];
      }) : [],
    };
  }) : [];
  const managerMemory = {
    explicitPreferences: Array.isArray(input.managerMemory?.explicitPreferences) ? input.managerMemory.explicitPreferences.slice(-50).flatMap((item, index) => {
      const text = optionalBoundedString(item?.text, 1_000);
      if (!text) return [];
      return [{ id: optionalBoundedString(item?.id, 200) || `preference-${index + 1}`, text, sourceCommandId: optionalBoundedString(item?.sourceCommandId, 240), createdAt: optionalBoundedString(item?.createdAt, 100) }];
    }) : [],
  };
  const script = input.ideaScript === null || input.ideaScript === undefined
    ? null
    : JSON.parse(JSON.stringify(input.ideaScript));
  if (script && (typeof script !== 'object' || JSON.stringify(script).length > 500_000)) throw new InputError('剧本草稿状态无效。');
  const episodeScripts = Array.isArray(input.episodeScripts) && JSON.stringify(input.episodeScripts).length <= 5_000_000
    ? input.episodeScripts.slice(0, 30).flatMap((candidate) => {
      const episodeNumber = Math.floor(Number(candidate?.episodeNumber));
      if (episodeNumber < 1 || episodeNumber > 30) return [];
      const savedScript = candidate?.script && typeof candidate.script === 'object' ? JSON.parse(JSON.stringify(candidate.script)) : undefined;
      return [{
        scriptKey: `EP${String(episodeNumber).padStart(3, '0')}`,
        episodeNumber,
        version: Math.max(0, Math.floor(Number(candidate?.version) || (savedScript ? 1 : 0))),
        status: ['running', 'complete', 'failed'].includes(candidate?.status) ? candidate.status : 'idle',
        approval: candidate?.approval === 'approved' ? 'approved' : 'draft',
        script: savedScript,
        error: optionalBoundedString(candidate?.error, 4_000) || undefined,
      }];
    })
    : [];
  if (JSON.stringify(input.characterLibraryHistory || []).length > 8_000_000) throw new InputError('人物版本记录过大，当前保存未写入。');
  const characterProfiles = Array.isArray(input.characterProfiles) && JSON.stringify(input.characterProfiles).length <= 500_000 ? JSON.parse(JSON.stringify(input.characterProfiles)) : [];
  const availableCharacterKeys = new Set(characterProfiles.map((profile) => optionalBoundedString(profile?.profileKey, 200)).filter(Boolean));
  const characterAssetProfileKeys = Array.isArray(input.characterAssetProfileKeys)
    ? [...new Set(input.characterAssetProfileKeys.map((key) => optionalBoundedString(key, 200)).filter((key) => key && availableCharacterKeys.has(key)))]
    : [...availableCharacterKeys];
  const generationPreset = normalizeGenerationPreset(input.generationPreset, { styleId: input.selectedStyleId, aspectRatio: input.ratio });
  const generationPresetHistory = (Array.isArray(input.generationPresetHistory) ? input.generationPresetHistory : [])
    .slice(-500)
    .map((item) => normalizeGenerationPreset(item, generationPreset))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.version === item.version) === index);
  if (!generationPresetHistory.some((item) => item.version === generationPreset.version)) generationPresetHistory.push(generationPreset);
  const tracked = (items, limit) => {
    if (!Array.isArray(items)) return [];
    if (JSON.stringify(items).length > limit) throw new InputError('本次项目记录超过保存容量，已保留上次保存的项目；请导出历史版本后缩小本次记录。');
    return structuredClone(items).map(item => ({ ...item, generationPreset: item?.generationPreset ? normalizeGenerationPreset(item.generationPreset, generationPreset) : generationPreset }));
  };
  const storyboardSegmentDurationSec = [5, 10, 15].includes(Number(input.storyboardSegmentDurationSec)) ? Number(input.storyboardSegmentDurationSec) : 15;
  const storyboardBoardPanelCount = [3, 4, 6, 9].includes(Number(input.storyboardBoardPanelCount)) ? Number(input.storyboardBoardPanelCount) : 6;
  const legacyStoryboardSlotFailure = input.storyboardStatus === 'failed'
    && input.storyboardError === '文字Agent本轮处理失败，现有问答已保留，可以重新请求。'
    && (!Array.isArray(input.storyboardSegments) || input.storyboardSegments.length === 0)
    && Array.isArray(script?.scenes)
    && script.scenes.length > Math.ceil(Math.max(1, Number(script.durationSec) || 60) / storyboardSegmentDurationSec);
  const legacyBoardFailure = splitStoredStoryboardBoardFailure(input.storyboardBoardError);
  const storyboardBoardError = upgradeStoredAgentValidationError(legacyBoardFailure.summary, '故事板规划')
    .replaceAll('undefined宫格', `${storyboardBoardPanelCount}宫格`)
    .replaceAll('undefined格', `${storyboardBoardPanelCount}格`);
  const storyboardBoardRejectedDraft = optionalBoundedString(input.storyboardBoardRejectedDraft, 200_000) || legacyBoardFailure.returnedDraft;
  const storyboardBoardRejectedIssues = Array.isArray(input.storyboardBoardRejectedIssues)
    ? input.storyboardBoardRejectedIssues.slice(0, 20).map((item) => boundedString(item, 1_000))
    : [];
  const storedPropProposals = Array.isArray(input.propProposals) && JSON.stringify(input.propProposals).length <= 1_000_000 ? JSON.parse(JSON.stringify(input.propProposals)) : [];
  const storedPropImages = tracked(input.propImages, 500_000);
  const preparedPropNames = new Set(storedPropImages
    .filter((image) => image?.status === 'complete' && image?.imageUrl)
    .map((image) => storedPropProposals.find((proposal) => proposal?.propAssetKey === image?.propAssetKey)?.name)
    .filter(Boolean));
  const storyboardBoardPlans = tracked(input.storyboardBoardPlans, 3_000_000).map((item) => {
    const plan = item?.plan;
    if (!plan || typeof plan !== 'object' || preparedPropNames.size === 0) return item;
    const visiblePropNames = [...new Set([
      ...(Array.isArray(plan.semanticDecision?.visibleProps) ? plan.semanticDecision.visibleProps.map((prop) => prop?.propName) : []),
      ...(Array.isArray(plan.panels) ? plan.panels.flatMap((panel) => Array.isArray(panel?.visibleProps) ? panel.visibleProps : []) : []),
    ].filter((name) => typeof name === 'string' && preparedPropNames.has(name)))];
    if (visiblePropNames.length === 0) return item;
    const referenceRequirements = plan.referenceRequirements && typeof plan.referenceRequirements === 'object'
      ? plan.referenceRequirements
      : { characters: [], sceneRequired: false, props: [], decisionBasis: [] };
    const existingProps = Array.isArray(referenceRequirements.props) ? referenceRequirements.props : [];
    const referenceProps = [...existingProps];
    for (const propName of visiblePropNames) {
      if (!referenceProps.some((prop) => prop?.propName === propName)) referenceProps.push({ propName, state: 'dormant' });
    }
    return { ...item, plan: { ...plan, referenceRequirements: { ...referenceRequirements, props: referenceProps } } };
  });
  const storyboardBoardPrompts = tracked(input.storyboardBoardPrompts, 3_000_000).map((item) => {
    const plan = storyboardBoardPlans.find((candidate) => candidate?.segmentKey === item?.segmentKey)?.plan;
    const requiredPropNames = Array.isArray(plan?.referenceRequirements?.props)
      ? plan.referenceRequirements.props.map((prop) => prop?.propName).filter((name) => typeof name === 'string' && preparedPropNames.has(name))
      : [];
    if (typeof item?.prompt !== 'string' || requiredPropNames.length === 0) return item;
    const match = item.prompt.match(/^参考图：(.*)$/mu);
    if (!match) return { ...item, referenceBindingAddedProps: [...new Set([...(Array.isArray(item?.referenceBindingAddedProps) ? item.referenceBindingAddedProps : []), ...requiredPropNames])], prompt: `参考图：${[...new Set(requiredPropNames)].join('、')}\n${item.prompt}` };
    const existingLabels = /不使用固定角色、场景或道具资产/u.test(match[1]) ? [] : match[1].split('、').map((label) => label.trim()).filter(Boolean);
    const labels = [...new Set([...existingLabels, ...requiredPropNames])];
    const addedPropNames = requiredPropNames.filter((name) => !existingLabels.includes(name));
    return { ...item, ...(addedPropNames.length ? { referenceBindingAddedProps: [...new Set([...(Array.isArray(item?.referenceBindingAddedProps) ? item.referenceBindingAddedProps : []), ...addedPropNames])] } : {}), prompt: item.prompt.replace(/^参考图：.*$/mu, `参考图：${labels.join('、')}`) };
  });
  const storyboardBoards = tracked(input.storyboardBoards, 1_000_000).map(item => ({ ...item, approval: input.storyboardAssetsApproval === 'approved' && !item.stale && item.status === 'complete' ? 'approved' : item.approval ?? 'draft' }));
  const storedVideoPanelCount = (item) => {
    const firstReferenceUrl = Array.isArray(item?.referenceImageUrls) ? item.referenceImageUrls[0] : undefined;
    const board = storyboardBoards.find((candidate) => candidate?.segmentKey === item?.segmentKey && (!firstReferenceUrl || candidate?.imageUrl === firstReferenceUrl));
    if (board) return [3, 4, 6, 9].includes(Number(board.panelCount)) ? Number(board.panelCount) : 6;
    const plan = storyboardBoardPlans.find((candidate) => candidate?.segmentKey === item?.segmentKey)?.plan;
    return [3, 4, 6, 9].includes(Number(plan?.panelCount)) ? Number(plan.panelCount) : storyboardBoardPanelCount;
  };
  const repairStoredPanelReference = (value, panelCount) => typeof value === 'string'
    ? value.replaceAll('undefined宫格', `${panelCount}宫格`).replaceAll('undefined格', `${panelCount}格`)
    : value;
  const videoPrompts = tracked(input.videoPrompts, 4_000_000).map((value) => {
    const item = { ...value, approval: input.videoPromptsApproval === 'approved' && value.status === 'complete' && !value.stale ? 'approved' : value.approval ?? 'draft' };
    const panelCount = storedVideoPanelCount(item);
    const normalized = {
      ...item,
      prompt: typeof item?.prompt === 'string' ? repairStoredPanelReference(sanitizeCompiledVideoPrompt(item.prompt), panelCount) : item?.prompt,
      referenceLabels: Array.isArray(item?.referenceLabels) ? item.referenceLabels.map((label) => repairStoredPanelReference(label, panelCount)) : [],
      repairSourcePrompt: repairStoredPanelReference(item?.repairSourcePrompt, panelCount),
      validationWarnings: localizeVideoPromptValidationIssues(partitionAgentDraftValidationIssues('video-prompt', Array.isArray(item?.validationWarningCodes) ? item.validationWarningCodes : []).warnings),
      validationWarningCodes: partitionAgentDraftValidationIssues('video-prompt', Array.isArray(item?.validationWarningCodes) ? item.validationWarningCodes : []).warnings,
    };
    const storedCodes = Array.isArray(item?.validationCodes) ? item.validationCodes.map(String).filter(Boolean) : [];
    if (item?.status !== 'needs_revision' || !item?.plan || storedCodes.length === 0) return normalized;
    const report = partitionAgentDraftValidationIssues('video-prompt', storedCodes);
    if (report.blockingIssues.length > 0) return normalized;
    return {
      ...normalized,
      status: 'complete',
      validationIssues: undefined,
      validationCodes: undefined,
      validationWarnings: localizeVideoPromptValidationIssues(report.warnings),
      validationWarningCodes: report.warnings,
      error: undefined,
    };
  });
  const expectedVideoSegmentKeys = Array.isArray(input.storyboardSegments)
    ? input.storyboardSegments.map((item) => String(item?.segmentKey || '')).filter(Boolean)
    : [];
  const storedVideoPromptsComplete = expectedVideoSegmentKeys.length > 0
    && expectedVideoSegmentKeys.every((segmentKey) => videoPrompts.some((item) => item?.segmentKey === segmentKey && item?.status === 'complete' && String(item?.prompt || '').trim()));

  return {
    step: input.step,
    creationSource: String(input.step).startsWith('idea') || input.creationSource === 'idea' ? 'idea' : 'novel',
    workType: input.workType === 'series' ? 'series' : 'single',
    creativeDirection: ['story', 'commercial', 'product', 'knowledge', 'documentary', 'music_visual'].includes(input.creativeDirection) ? input.creativeDirection : 'story',
    novelText: optionalBoundedString(input.novelText, 4_000_000),
    novelName: optionalBoundedString(input.novelName, 1_000),
    duration: optionalBoundedString(input.duration, 100),
    customDurationSec: optionalBoundedString(input.customDurationSec, 10),
    episodeCountMode: input.episodeCountMode === 'fixed' ? 'fixed' : 'agent',
    episodeCount: optionalBoundedString(input.episodeCount, 10),
    ratio: optionalBoundedString(input.ratio, 100),
    generationPreset,
    generationPresetHistory: generationPresetHistory.sort((a, b) => a.version - b.version),
    language: optionalBoundedString(input.language, 100),
    emotion: optionalBoundedString(input.emotion, 200),
    customEmotion: optionalBoundedString(input.customEmotion, 500),
    emotionRecommendations: Array.isArray(input.emotionRecommendations) ? input.emotionRecommendations.slice(0, 4).flatMap((item) => {
      const name = optionalBoundedString(item?.name, 20).trim();
      const note = optionalBoundedString(item?.note, 120).trim();
      const tone = ['cyan', 'violet', 'blue', 'red', 'gold'].includes(item?.tone) ? item.tone : '';
      return name && note && tone ? [{ name, note, tone }] : [];
    }) : [],
    emotionRecommendationContext: optionalBoundedString(input.emotionRecommendationContext, 100),
    emotionRecommendationError: optionalBoundedString(input.emotionRecommendationError, 2_000),
    activeStage: optionalBoundedString(input.activeStage, 100),
    projectName: optionalBoundedString(input.projectName, 120),
    ideaText: optionalBoundedString(input.ideaText, 2_000),
    ideaAnswers: answers,
    ideaAnswer: optionalBoundedString(input.ideaAnswer, 2_000),
    ideaQuestion: optionalBoundedString(input.ideaQuestion, 2_000),
    ideaOptions: options,
    agentTranscript,
    managerTranscript,
    managerMemory,
    ideaScript: script,
    seriesMotherScript: input.seriesMotherScript && typeof input.seriesMotherScript === 'object' && JSON.stringify(input.seriesMotherScript).length <= 500_000 ? JSON.parse(JSON.stringify(input.seriesMotherScript)) : null,
    episodeScripts,
    scriptApproval: input.scriptApproval === 'approved' ? 'approved' : 'draft',
    scriptRevisionText: optionalBoundedString(input.scriptRevisionText, 2_000),
    characterStatus: ['running', 'complete', 'failed'].includes(input.characterStatus) ? input.characterStatus : 'idle',
    characterRosterVersion: input.characterRosterVersion === 1 ? 1 : undefined,
    characterLibraryHistory: Array.isArray(input.characterLibraryHistory) ? structuredClone(input.characterLibraryHistory) : [],
    characterProfiles,
    characterAssetProfileKeys,
    characterError: upgradeStoredCharacterValidationError(input),
    characterApproval: input.characterApproval === 'approved' ? 'approved' : 'draft',
    selectedStyleId: generationPreset.styleId,
    characterImageStatus: ['running', 'complete', 'failed'].includes(input.characterImageStatus) ? input.characterImageStatus : 'idle',
    characterImages: tracked(input.characterImages, 500_000),
    characterImagePrompts: tracked(input.characterImagePrompts, 1_500_000).map((item) => ({ ...item, styleId: normalizeStylePresetId(String(item.styleId || '')), prompt: upgradeProductionPrompt(String(item.prompt || ''), String(item.styleId || '')) })),
    characterAssetsApproval: input.characterAssetsApproval === 'approved' ? 'approved' : 'draft',
    characterTurnarounds: Array.isArray(input.characterTurnarounds) && JSON.stringify(input.characterTurnarounds).length <= 500_000 ? JSON.parse(JSON.stringify(input.characterTurnarounds)) : [],
    characterImageError: optionalBoundedString(input.characterImageError, 2_000),
    sceneStatus: ['running', 'complete', 'failed'].includes(input.sceneStatus) ? input.sceneStatus : 'idle',
    sceneProposals: Array.isArray(input.sceneProposals) && JSON.stringify(input.sceneProposals).length <= 1_000_000 ? JSON.parse(JSON.stringify(input.sceneProposals)) : [],
    sceneError: upgradeStoredAgentValidationError(input.sceneError, '场景'),
    sceneRejectedDraft: optionalBoundedString(input.sceneRejectedDraft, 200_000),
    sceneRejectedIssues: Array.isArray(input.sceneRejectedIssues) ? input.sceneRejectedIssues.slice(0, 20).map((item) => boundedString(item, 1_000)) : [],
    sceneProposalApproval: input.sceneProposalApproval === 'approved' ? 'approved' : 'draft',
    sceneImageStatus: ['running', 'complete', 'failed'].includes(input.sceneImageStatus) ? input.sceneImageStatus : 'idle',
    sceneImagePrompts: tracked(input.sceneImagePrompts, 1_500_000).map((item) => ({ ...item, styleId: normalizeStylePresetId(String(item.styleId || '')) })),
    sceneImages: tracked(input.sceneImages, 500_000),
    sceneImageError: optionalBoundedString(input.sceneImageError, 2_000),
    sceneMainApproval: input.sceneMainApproval === 'approved' ? 'approved' : 'draft',
    sceneViews: Array.isArray(input.sceneViews) && JSON.stringify(input.sceneViews).length <= 500_000 ? JSON.parse(JSON.stringify(input.sceneViews)) : [],
    sceneAssetsApproval: input.sceneAssetsApproval === 'approved' ? 'approved' : 'draft',
    sceneAssetsSkipped: input.sceneAssetsSkipped === true,
    propStatus: ['running', 'complete', 'failed'].includes(input.propStatus) ? input.propStatus : 'idle',
    propProposals: storedPropProposals,
    propError: upgradeStoredAgentValidationError(input.propError, '道具'),
    propRejectedDraft: optionalBoundedString(input.propRejectedDraft, 200_000),
    propRejectedIssues: Array.isArray(input.propRejectedIssues) ? input.propRejectedIssues.slice(0, 20).map((item) => boundedString(item, 1_000)) : [],
    propProposalApproval: input.propProposalApproval === 'approved' ? 'approved' : 'draft',
    propImageStatus: ['running', 'complete', 'failed'].includes(input.propImageStatus) ? input.propImageStatus : 'idle',
    propImagePrompts: tracked(input.propImagePrompts, 1_500_000).map((item) => ({ ...item, styleId: normalizeStylePresetId(String(item.styleId || '')) })),
    propImages: storedPropImages,
    propImageError: optionalBoundedString(input.propImageError, 2_000),
    propAssetsApproval: input.propAssetsApproval === 'approved' ? 'approved' : 'draft',
    storyboardSegmentDurationSec,
    storyboardBoardPanelCount,
    storyboardStatus: legacyStoryboardSlotFailure ? 'idle' : ['running', 'complete', 'failed'].includes(input.storyboardStatus) ? input.storyboardStatus : 'idle',
    storyboardSegments: Array.isArray(input.storyboardSegments) && JSON.stringify(input.storyboardSegments).length <= 2_000_000 ? JSON.parse(JSON.stringify(input.storyboardSegments)) : [],
    storyboardWarnings: Array.isArray(input.storyboardWarnings) ? input.storyboardWarnings.slice(0, 100).map((item) => boundedString(item, 2_000)) : [],
    storyboardError: legacyStoryboardSlotFailure ? '' : upgradeStoredAgentValidationError(input.storyboardError, '文字分镜'),
    storyboardRejectedDraft: optionalBoundedString(input.storyboardRejectedDraft, 2_500_000),
    storyboardRejectedIssues: Array.isArray(input.storyboardRejectedIssues) ? input.storyboardRejectedIssues.slice(0, 100).map(item => String(item).slice(0, 4000)) : [],
    productionAppliedJobs: input.productionAppliedJobs && typeof input.productionAppliedJobs === 'object' ? Object.fromEntries(Object.entries(input.productionAppliedJobs).filter(([key, value]) => /^[a-f0-9-]{36}$/i.test(key) && Number.isInteger(value)).slice(-500)) : {},
    storyboardApproval: input.storyboardApproval === 'approved' ? 'approved' : 'draft',
    storyboardBoardStatus: ['running', 'complete', 'failed'].includes(input.storyboardBoardStatus) ? input.storyboardBoardStatus : 'idle',
    storyboardBoardPlans,
    storyboardBoardPrompts,
    storyboardBoards,
    storyboardBoardError,
    storyboardBoardRejectedDraft,
    storyboardBoardRejectedIssues,
    storyboardAssetsApproval: input.storyboardAssetsApproval === 'approved' ? 'approved' : 'draft',
    videoPromptStatus: storedVideoPromptsComplete ? 'complete' : ['running', 'complete', 'failed'].includes(input.videoPromptStatus) ? input.videoPromptStatus : 'idle',
    videoPrompts: Array.isArray(input.videoPrompts) && JSON.stringify(input.videoPrompts).length <= 4_000_000 ? videoPrompts : [],
    videoPromptError: storedVideoPromptsComplete ? '' : upgradeStoredAgentValidationError(input.videoPromptError, '视频提示词'),
    videoPromptsApproval: input.videoPromptsApproval === 'approved' ? 'approved' : 'draft',
    h3GenerationSettings: sanitizeH3GenerationSettings(input.h3GenerationSettings),
    shotVideoTasks: sanitizeShotVideoTasks(input.shotVideoTasks).map((item) => ({ ...item, generationPreset: item.generationPreset ? normalizeGenerationPreset(item.generationPreset, generationPreset) : generationPreset, submissionIntent: item.submissionIntent ? { ...item.submissionIntent, generationPreset: item.submissionIntent.generationPreset ? normalizeGenerationPreset(item.submissionIntent.generationPreset, generationPreset) : generationPreset } : undefined })),
    shotContinuityModes: sanitizeShotContinuityModes(input.shotContinuityModes),
    shotVideosApproval: input.shotVideosApproval === 'approved' ? 'approved' : 'draft',
    postProduction: sanitizePostProduction(input.postProduction),
    canvasView: sanitizeCanvasView(input.canvasView),
    canvasMode: input.canvasMode === 'free' || input.canvasMode === 'editor' ? input.canvasMode : 'director',
    freeCanvas: sanitizeFreeCanvas(input.freeCanvas),
    editor: sanitizeEditor(input.editor),
  };
}

export function upgradeStoredAgentValidationError(value, stage) {
  const message = compactStoredDiagnostic(value, 4_000);
  if (!message || /具体问题：|修改建议：/u.test(message)) return message;
  if (!/未通过本地校验|validation failed|本地结构校验/u.test(message)) return message;
  const suggestions = [];
  if (/对白逐字保留|preserve dialogue|dialogue speaker/u.test(message)) suggestions.push('从已批准剧本逐字复制对白，并绑定正确说话人和时间顺序');
  if (/场次覆盖|场次归属|scene order|sourceSceneKeys/u.test(message)) suggestions.push('只使用输入中的场次ID，按剧本顺序每项覆盖一次');
  if (/剧本证据|evidence/u.test(message)) suggestions.push('引用对应场次中真实存在的原文，不改证据ID');
  if (/固定地标|fixedLandmarks/u.test(message)) suggestions.push('补充可在多角度中稳定复用的空间锚点');
  if (/状态变化|state variant/u.test(message)) suggestions.push('按发生变化的场次补齐可见状态和原文依据');
  if (/分段数量|格数|panels/u.test(message)) suggestions.push('按本次要求返回全部项目，每项一次，不增不漏');
  if (/时长|时间线|time range|duration/u.test(message)) suggestions.push('保持已确认总时长，并让时间段连续且不重叠');
  if (/参考|reference/u.test(message)) suggestions.push('只使用本段实际需要且已批准的角色、场景和道具');
  const advice = suggestions.length ? [...new Set(suggestions)].slice(0, 3).join('；') : `按输入中的已批准事实补齐${stage || '当前阶段'}必填结构，不改动ID、顺序或原文`;
  return `${message.replaceAll('未通过本地校验', '未通过必要事实或结构校验')} 修改建议：${advice}。`;
}

function splitStoredStoryboardBoardFailure(value) {
  const text = typeof value === 'string' ? value : '';
  const marker = '\n\nAgent 已返回的正文：\n';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return { summary: text, returnedDraft: '' };
  return {
    summary: text.slice(0, markerIndex).trim(),
    returnedDraft: text.slice(markerIndex + marker.length).trim().slice(0, 200_000),
  };
}

function compactStoredDiagnostic(value, maximumLength) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.length <= maximumLength) return text;
  const marker = '\n\nAgent 已返回的正文：\n';
  const summary = text.includes(marker) ? text.slice(0, text.indexOf(marker)).trim() : text;
  return summary.length <= maximumLength ? summary : `${summary.slice(0, Math.max(0, maximumLength - 12)).trimEnd()}…（详情已保留）`;
}

function sanitizeEditor(input) {
  const value = input && typeof input === 'object' ? input : {};
  const finite = (candidate, fallback, min, max) => Number.isFinite(Number(candidate)) ? Math.max(min, Math.min(max, Number(candidate))) : fallback;
  const assetKinds = new Set(['video', 'audio', 'image', 'subtitle', 'final']);
  const sources = new Set(['director', 'free', 'import', 'postproduction']);
  const importedAssets = Array.isArray(value.importedAssets) && JSON.stringify(value.importedAssets).length <= 4_000_000 ? value.importedAssets.slice(0, 2_000).flatMap((asset) => {
    const id = optionalBoundedString(asset?.id, 300); const title = optionalBoundedString(asset?.title, 160);
    if (!id || !title || !assetKinds.has(asset?.kind)) return [];
    return [{ id, kind: asset.kind, title, mediaUrl: optionalBoundedString(asset.mediaUrl, 20_000) || undefined, durationSec: Number.isFinite(Number(asset.durationSec)) ? finite(asset.durationSec, 0, 0, 86_400) : undefined, source: sources.has(asset.source) ? asset.source : 'import', segmentKey: optionalBoundedString(asset.segmentKey, 200) || undefined, familyKey: optionalBoundedString(asset.familyKey, 200) || undefined, version: Number.isInteger(Number(asset.version)) ? Math.max(1, Math.min(100_000, Number(asset.version))) : undefined, createdAt: optionalBoundedString(asset.createdAt, 100) || undefined }];
  }) : [];
  const clips = Array.isArray(value.clips) && JSON.stringify(value.clips).length <= 5_000_000 ? value.clips.slice(0, 500).flatMap((clip) => {
    const id = optionalBoundedString(clip?.id, 200); const mediaUrl = optionalBoundedString(clip?.mediaUrl, 20_000);
    if (!id || !mediaUrl) return [];
    const sourceInSec = finite(clip.sourceInSec, 0, 0, 86_400); const sourceOutSec = Math.max(sourceInSec + 0.04, finite(clip.sourceOutSec, sourceInSec + 5, sourceInSec + 0.04, 86_400));
    return [{ id, assetId: optionalBoundedString(clip.assetId, 300), title: optionalBoundedString(clip.title, 160) || '未命名片段', mediaUrl, sourceInSec, sourceOutSec, nativeVolume: finite(clip.nativeVolume, 1, 0, 2), transition: clip.transition === 'fade' ? 'fade' : 'cut', fadeDurationSec: finite(clip.fadeDurationSec, 0.25, 0.05, 3) }];
  }) : [];
  const audioClips = Array.isArray(value.audioClips) && JSON.stringify(value.audioClips).length <= 5_000_000 ? value.audioClips.slice(0, 500).flatMap((clip) => {
    const id = optionalBoundedString(clip?.id, 200); const mediaUrl = optionalBoundedString(clip?.mediaUrl, 20_000);
    if (!id || !mediaUrl) return [];
    const sourceInSec = finite(clip.sourceInSec, 0, 0, 86_400); const sourceOutSec = Math.max(sourceInSec + 0.04, finite(clip.sourceOutSec, sourceInSec + 5, sourceInSec + 0.04, 86_400));
    return [{ id, assetId: optionalBoundedString(clip.assetId, 300), title: optionalBoundedString(clip.title, 160) || '未命名音频', mediaUrl, sourceInSec, sourceOutSec, timelineStartSec: finite(clip.timelineStartSec, 0, 0, 86_400), volume: finite(clip.volume, 0.28, 0, 2), fadeInSec: finite(clip.fadeInSec, 0, 0, 30), fadeOutSec: finite(clip.fadeOutSec, 0, 0, 30) }];
  }) : [];
  const subtitles = Array.isArray(value.subtitles) && JSON.stringify(value.subtitles).length <= 4_000_000 ? value.subtitles.slice(0, 2_000).flatMap((cue) => {
    const id = optionalBoundedString(cue?.id, 200); if (!id) return [];
    return [{ id, text: optionalBoundedString(cue.text, 2_000), startSec: finite(cue.startSec, 0, 0, 86_400), endSec: finite(cue.endSec, 1, 0.04, 86_400), enabled: cue.enabled !== false }];
  }) : [];
  const renders = Array.isArray(value.renders) && JSON.stringify(value.renders).length <= 1_000_000 ? value.renders.slice(-30).flatMap((render) => {
    if (!render || !['running', 'complete', 'failed'].includes(render.status)) return [];
    return [{ status: render.status, filename: optionalBoundedString(render.filename, 500) || undefined, outputPath: optionalBoundedString(render.outputPath, 4_000) || undefined, mediaUrl: optionalBoundedString(render.mediaUrl, 4_000) || undefined, manifestPath: optionalBoundedString(render.manifestPath, 4_000) || undefined, subtitlePath: optionalBoundedString(render.subtitlePath, 4_000) || undefined, durationSec: Number.isFinite(Number(render.durationSec)) ? finite(render.durationSec, 0, 0, 86_400) : undefined, clipCount: Number.isInteger(Number(render.clipCount)) ? Math.max(0, Math.min(500, Number(render.clipCount))) : undefined, subtitleCount: Number.isInteger(Number(render.subtitleCount)) ? Math.max(0, Math.min(2_000, Number(render.subtitleCount))) : undefined, error: optionalBoundedString(render.error, 4_000) || undefined, createdAt: optionalBoundedString(render.createdAt, 100) || undefined }];
  }) : [];
  return { importedAssets, clips, audioClips, nativeVolume: finite(value.nativeVolume, 1, 0, 2), musicAssetId: optionalBoundedString(value.musicAssetId, 300) || undefined, musicMediaUrl: optionalBoundedString(value.musicMediaUrl, 20_000) || undefined, musicVolume: finite(value.musicVolume, 0.28, 0, 2), musicFadeInSec: finite(value.musicFadeInSec, 1, 0, 30), musicFadeOutSec: finite(value.musicFadeOutSec, 2, 0, 30), subtitles, renders, renderStatus: value.renderStatus === 'running' || value.renderStatus === 'failed' ? value.renderStatus : 'idle', renderError: optionalBoundedString(value.renderError, 4_000) || undefined };
}

function sanitizePostProduction(input) {
  const value = input && typeof input === 'object' ? input : {};
  const roughCutValue = value.roughCut && typeof value.roughCut === 'object' ? value.roughCut : {};
  const roughCutStatus = ['idle', 'running', 'complete', 'failed', 'stale'].includes(roughCutValue.status) ? roughCutValue.status : 'idle';
  const roughCut = {
    status: roughCutStatus,
    filename: optionalBoundedString(roughCutValue.filename, 500) || undefined,
    outputPath: optionalBoundedString(roughCutValue.outputPath, 4_000) || undefined,
    mediaUrl: optionalBoundedString(roughCutValue.mediaUrl, 4_000) || undefined,
    manifestPath: optionalBoundedString(roughCutValue.manifestPath, 4_000) || undefined,
    clipCount: Number.isInteger(Number(roughCutValue.clipCount)) ? Math.max(0, Math.min(200, Number(roughCutValue.clipCount))) : undefined,
    durationSec: Number.isFinite(Number(roughCutValue.durationSec)) ? Math.max(0, Math.min(100_000, Number(roughCutValue.durationSec))) : undefined,
    width: Number.isInteger(Number(roughCutValue.width)) ? Math.max(0, Math.min(16_384, Number(roughCutValue.width))) : undefined,
    height: Number.isInteger(Number(roughCutValue.height)) ? Math.max(0, Math.min(16_384, Number(roughCutValue.height))) : undefined,
    fps: optionalBoundedString(roughCutValue.fps, 100) || undefined,
    audioPresent: typeof roughCutValue.audioPresent === 'boolean' ? roughCutValue.audioPresent : undefined,
    error: optionalBoundedString(roughCutValue.error, 4_000) || undefined,
    createdAt: optionalBoundedString(roughCutValue.createdAt, 100) || undefined,
  };
  const musicPromptValue = value.musicPrompt && typeof value.musicPrompt === 'object' ? value.musicPrompt : {};
  const musicPromptStatus = ['idle', 'running', 'complete', 'needs_revision', 'failed', 'stale'].includes(musicPromptValue.status) ? musicPromptValue.status : 'idle';
  const musicPromptPlan = musicPromptValue.plan && typeof musicPromptValue.plan === 'object' && JSON.stringify(musicPromptValue.plan).length <= 300_000
    ? JSON.parse(JSON.stringify(musicPromptValue.plan))
    : undefined;
  const musicValue = value.music && typeof value.music === 'object' ? value.music : {};
  const musicStatus = ['idle', 'running', 'complete', 'failed', 'unqualified', 'stale'].includes(musicValue.status) ? musicValue.status : 'idle';
  const finalValue = value.finalComposition && typeof value.finalComposition === 'object' ? value.finalComposition : {};
  const finalStatus = ['idle', 'running', 'complete', 'failed', 'stale'].includes(finalValue.status) ? finalValue.status : 'idle';
  return {
    view: ['overview', 'discussion', 'shots'].includes(value.view) ? value.view : 'overview',
    audioMode: ['undecided', 'native', 'native_with_music', 'music_only'].includes(value.audioMode) ? value.audioMode : 'undecided',
    subtitles: ['undecided', 'none', 'burned'].includes(value.subtitles) ? value.subtitles : 'undecided',
    notes: Array.isArray(value.notes) ? value.notes.slice(-30).map((item) => boundedString(item, 2_000)) : [],
    agentReply: optionalBoundedString(value.agentReply, 2_000),
    musicSeed: Number.isInteger(Number(value.musicSeed)) ? Math.max(0, Math.min(2_147_483_647, Number(value.musicSeed))) : 20260826,
    musicBpm: Number.isInteger(Number(value.musicBpm)) ? Math.max(30, Math.min(300, Number(value.musicBpm))) : 84,
    musicKeyScale: optionalBoundedString(value.musicKeyScale, 80) || 'A Minor',
    musicTimeSignature: ['2', '3', '4', '6'].includes(String(value.musicTimeSignature)) ? String(value.musicTimeSignature) : '4',
    musicInferenceSteps: Number.isInteger(Number(value.musicInferenceSteps)) ? Math.max(1, Math.min(20, Number(value.musicInferenceSteps))) : 8,
    musicThinking: value.musicThinking !== false,
    roughCut,
    roughCutApproval: value.roughCutApproval === 'approved' ? 'approved' : 'draft',
    musicPrompt: {
      status: musicPromptStatus,
      plan: musicPromptPlan,
      error: optionalBoundedString(musicPromptValue.error, 4_000) || undefined,
      validationIssues: Array.isArray(musicPromptValue.validationIssues) ? musicPromptValue.validationIssues.slice(0, 20).map((item) => boundedString(item, 1_000)) : undefined,
      validationWarnings: Array.isArray(musicPromptValue.validationWarnings) ? musicPromptValue.validationWarnings.slice(0, 20).map((item) => boundedString(item, 1_000)) : undefined,
      repairAttempted: musicPromptValue.repairAttempted === true,
      updatedAt: optionalBoundedString(musicPromptValue.updatedAt, 100) || undefined,
    },
    musicPromptApproval: value.musicPromptApproval === 'approved' ? 'approved' : 'draft',
    music: {
      status: musicStatus,
      provider: ['acestep-1.5', 'audiocpp-minimax-music-3', 'minimax-music-3'].includes(musicValue.provider) ? musicValue.provider : undefined,
      filename: optionalBoundedString(musicValue.filename, 500) || undefined,
      outputPath: optionalBoundedString(musicValue.outputPath, 4_000) || undefined,
      mediaUrl: optionalBoundedString(musicValue.mediaUrl, 4_000) || undefined,
      durationSec: Number.isFinite(Number(musicValue.durationSec)) ? Math.max(0, Math.min(10_000, Number(musicValue.durationSec))) : undefined,
      requestedDurationSec: Number.isFinite(Number(musicValue.requestedDurationSec)) ? Math.max(0, Math.min(10_000, Number(musicValue.requestedDurationSec))) : undefined,
      inferenceSteps: Number.isInteger(Number(musicValue.inferenceSteps)) ? Math.max(1, Math.min(200, Number(musicValue.inferenceSteps))) : undefined,
      seed: Number.isInteger(Number(musicValue.seed)) ? Math.max(0, Math.min(2_147_483_647, Number(musicValue.seed))) : undefined,
      externalTaskId: optionalBoundedString(musicValue.externalTaskId, 500) || undefined,
      error: optionalBoundedString(musicValue.error, 4_000) || undefined,
      createdAt: optionalBoundedString(musicValue.createdAt, 100) || undefined,
    },
    musicApproval: value.musicApproval === 'approved' ? 'approved' : 'draft',
    finalComposition: {
      status: finalStatus,
      filename: optionalBoundedString(finalValue.filename, 500) || undefined,
      outputPath: optionalBoundedString(finalValue.outputPath, 4_000) || undefined,
      mediaUrl: optionalBoundedString(finalValue.mediaUrl, 4_000) || undefined,
      manifestPath: optionalBoundedString(finalValue.manifestPath, 4_000) || undefined,
      subtitlePath: optionalBoundedString(finalValue.subtitlePath, 4_000) || undefined,
      subtitleCount: Number.isInteger(Number(finalValue.subtitleCount)) ? Math.max(0, Math.min(1_000, Number(finalValue.subtitleCount))) : undefined,
      durationSec: Number.isFinite(Number(finalValue.durationSec)) ? Math.max(0, Math.min(100_000, Number(finalValue.durationSec))) : undefined,
      width: Number.isInteger(Number(finalValue.width)) ? Math.max(0, Math.min(16_384, Number(finalValue.width))) : undefined,
      height: Number.isInteger(Number(finalValue.height)) ? Math.max(0, Math.min(16_384, Number(finalValue.height))) : undefined,
      fps: optionalBoundedString(finalValue.fps, 100) || undefined,
      audioPresent: typeof finalValue.audioPresent === 'boolean' ? finalValue.audioPresent : undefined,
      audioMode: ['native', 'native_with_music', 'music_only'].includes(finalValue.audioMode) ? finalValue.audioMode : undefined,
      error: optionalBoundedString(finalValue.error, 4_000) || undefined,
      createdAt: optionalBoundedString(finalValue.createdAt, 100) || undefined,
    },
  };
}

function sanitizeH3GenerationSettings(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    ...(['minimax', 'seedance'].includes(value.engine) ? {
      engine: value.engine, profileId: optionalBoundedString(value.profileId, 100),
      cloudResolution: ['480p', '720p', '768p', '1080p'].includes(value.cloudResolution) ? value.cloudResolution : value.engine === 'minimax' ? '768p' : '720p',
      generateAudio: value.generateAudio === true,
    } : {}),
    mode: value.mode === 'text' ? 'text' : 'reference',
    qualityPreset: ['standard', 'balanced', 'fast', 'custom'].includes(value.qualityPreset) ? value.qualityPreset : 'standard',
    resolution: ['480p', '720p', '1080p'].includes(value.resolution) ? value.resolution : '480p',
    inferenceSteps: Number.isInteger(Number(value.inferenceSteps)) ? Math.max(4, Math.min(30, Number(value.inferenceSteps))) : 20,
    accelerationModel: ['none', 'turbo4', 'lightx2v-544p-v1', 'lightx2v-768p-v1'].includes(value.accelerationModel) ? value.accelerationModel : 'none',
    spectrum: value.spectrum !== false,
    sage: value.sage !== false,
    randomSeed: value.randomSeed !== false,
    seed: Number.isInteger(Number(value.seed)) ? Math.max(0, Math.min(2_147_483_647, Number(value.seed))) : 123456789,
  };
}

function sanitizeShotVideoTasks(input) {
  if (!Array.isArray(input) || JSON.stringify(input).length > 1_000_000) return [];
  const statuses = new Set(['waiting_dependency', 'submitting', 'queued', 'running', 'awaiting_review', 'failed', 'cancelled']);
  return input.slice(0, 200).flatMap((task) => {
    if (!task || typeof task !== 'object' || !statuses.has(task.status)) return [];
    const segmentKey = optionalBoundedString(task.segmentKey, 200);
    if (!segmentKey) return [];
    const submissionIntent = sanitizeShotVideoSubmissionIntent(task.submissionIntent);
    if (task.status === 'waiting_dependency' && !submissionIntent) return [];
    return [{
      segmentKey,
      status: task.status,
      ...(task.stale === true ? { stale: true, approval: 'draft' } : {}),
      externalTaskId: optionalBoundedString(task.externalTaskId, 500) || undefined,
      outputPaths: Array.isArray(task.outputPaths) ? task.outputPaths.slice(0, 10).map((item) => boundedString(item, 4_000)) : [],
      parameters: task.parameters && typeof task.parameters === 'object' && JSON.stringify(task.parameters).length <= 200_000 ? JSON.parse(JSON.stringify(task.parameters)) : {},
      generationPreset: task.generationPreset && typeof task.generationPreset === 'object' ? JSON.parse(JSON.stringify(task.generationPreset)) : undefined,
      submissionIntent,
      error: optionalBoundedString(task.error, 4_000) || undefined,
      updatedAt: optionalBoundedString(task.updatedAt, 100) || new Date().toISOString(),
    }];
  });
}

function sanitizeShotVideoSubmissionIntent(input) {
  if (!input || typeof input !== 'object') return undefined;
  const continuityMode = input.continuityMode === 'continue'
    ? 'continue'
    : input.continuityMode === 'start_chain'
      ? 'start_chain'
      : input.continuityMode === 'independent'
        ? 'independent'
        : undefined;
  if (!continuityMode) return undefined;
  const sourceSegmentKey = optionalBoundedString(input.sourceSegmentKey, 200) || undefined;
  if (continuityMode === 'continue' && !sourceSegmentKey) return undefined;
  return {
    ...(typeof input.requestId === 'string' ? { requestId: optionalBoundedString(input.requestId, 100) } : {}),
    continuityMode,
    sourceSegmentKey: continuityMode === 'continue' ? sourceSegmentKey : undefined,
    settings: sanitizeH3GenerationSettings(input.settings),
    generationPreset: input.generationPreset && typeof input.generationPreset === 'object' ? JSON.parse(JSON.stringify(input.generationPreset)) : undefined,
    queuedAt: optionalBoundedString(input.queuedAt, 100) || new Date().toISOString(),
  };
}

function sanitizeShotContinuityModes(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).slice(0, 200).flatMap(([segmentKey, mode]) => /^[a-zA-Z0-9_-]{1,200}$/u.test(segmentKey) && (mode === 'independent' || mode === 'start_chain' || mode === 'continue') ? [[segmentKey, mode]] : []));
}

function sanitizeCanvasView(input) {
  const defaults = { x: 0, y: 0, zoom: 1, nodes: { brief: { x: 42, y: 22 }, script: { x: 500, y: 60 }, asset: { x: 850, y: 60 } } };
  if (!input || typeof input !== 'object') return defaults;
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const point = (value, fallback) => ({
    x: Math.max(-10_000, Math.min(10_000, finite(value?.x, fallback.x))),
    y: Math.max(-10_000, Math.min(10_000, finite(value?.y, fallback.y))),
  });
  const nodes = { ...defaults.nodes };
  if (input.nodes && typeof input.nodes === 'object') {
    Object.entries(input.nodes).slice(0, 50).forEach(([nodeId, value]) => {
      if (/^[a-z0-9-]{1,100}$/i.test(nodeId)) nodes[nodeId] = point(value, nodes[nodeId] ?? { x: 0, y: 0 });
    });
  }
  return {
    x: Math.max(-10_000, Math.min(10_000, finite(input.x, defaults.x))),
    y: Math.max(-10_000, Math.min(10_000, finite(input.y, defaults.y))),
    zoom: Math.max(0.35, Math.min(1.8, finite(input.zoom, defaults.zoom))),
    nodes,
  };
}

function validateFreeCanvasWrite(value, previous) {
  const error = freeCanvasCapacityError(value, previous);
  if (error) throw new InputError(error);
  if (JSON.stringify(value?.nodes ?? []).length > 4_000_000 || JSON.stringify(value?.edges ?? []).length > 1_000_000) {
    throw new InputError('画布内容超过本次保存大小上限，请缩短节点内容或拆分画布。原项目未被覆盖。');
  }
}

function sanitizeFreeCanvas(input) {
  const value = input && typeof input === 'object' ? input : {};
  const finite = (number, fallback = 0) => Number.isFinite(Number(number)) ? Number(number) : fallback;
  const sourceTypes = new Set(['script', 'character', 'scene', 'prop', 'storyboard', 'video', 'postproduction']);
  const kinds = new Set(['text', 'image', 'video', 'audio', 'director']);
  const generationStatuses = new Set(['submitting', 'queued', 'running', 'complete', 'partial', 'failed']);
  const imageQualities = new Set(['auto', 'low', 'medium', 'high']);
  const imageFormats = new Set(['png', 'webp', 'jpeg']);
  const videoAspectRatios = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
  const videoResolutions = new Set(['480p', '720p', '1080p']);
  const videoQualityPresets = new Set(['standard', 'balanced', 'fast', 'custom']);
  const videoAccelerationModels = new Set(['none', 'turbo4', 'lightx2v-544p-v1', 'lightx2v-768p-v1']);
  const audioModes = new Set(['instrumental', 'song']);
  const textOptimizationTargets = new Set(['script', 'image', 'video']);
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes = rawNodes.flatMap((node) => {
    if (!node || typeof node !== 'object') return [];
    const id = optionalBoundedString(node.id, 160);
    if (!id || !kinds.has(node.kind)) return [];
    const source = node.sourceRef && typeof node.sourceRef === 'object' && sourceTypes.has(node.sourceRef.type) && optionalBoundedString(node.sourceRef.stableId, 300)
      ? { type: node.sourceRef.type, stableId: optionalBoundedString(node.sourceRef.stableId, 300), label: optionalBoundedString(node.sourceRef.label, 300), version: Number.isInteger(Number(node.sourceRef.version)) ? Math.max(1, Math.min(100_000, Number(node.sourceRef.version))) : undefined }
      : undefined;
    const mediaUrls = Array.isArray(node.mediaUrls) ? [...new Set(node.mediaUrls.map((url) => optionalBoundedString(url, 20_000)).filter(Boolean))].slice(0, 12) : undefined;
    const mediaDurationSec = node.kind === 'video' && Number.isFinite(Number(node.mediaDurationSec)) && Number(node.mediaDurationSec) > 0 ? Math.min(86_400, Number(node.mediaDurationSec)) : undefined;
    const normalizedImageSize = freeCanvasImageSize(node.imageSettings?.width, node.imageSettings?.height) ?? freeCanvasImageSize(1536, 1024);
    const imageSettings = node.kind === 'image' && node.imageSettings && typeof node.imageSettings === 'object'
      ? {
          width: normalizedImageSize.width,
          height: normalizedImageSize.height,
          resolution: normalizedImageSize.resolution,
          quality: imageQualities.has(node.imageSettings.quality) ? node.imageSettings.quality : 'high',
          count: [1, 2, 3, 4].includes(Number(node.imageSettings.count)) ? Number(node.imageSettings.count) : 1,
          outputFormat: imageFormats.has(node.imageSettings.outputFormat) ? node.imageSettings.outputFormat : 'png',
        }
      : undefined;
    const videoSettings = node.kind === 'video' && node.videoSettings && typeof node.videoSettings === 'object'
      ? {
          ...(['minimax', 'seedance'].includes(node.videoSettings.engine) ? { engine: node.videoSettings.engine, profileId: optionalBoundedString(node.videoSettings.profileId, 100), cloudResolution: ['480p', '720p', '768p', '1080p'].includes(node.videoSettings.cloudResolution) ? node.videoSettings.cloudResolution : node.videoSettings.engine === 'minimax' ? '768p' : '720p', generateAudio: node.videoSettings.generateAudio === true } : {}),
          mode: ['auto', 'text', 'first', 'reference'].includes(node.videoSettings.mode) ? node.videoSettings.mode : 'auto',
          ...(Number.isInteger(node.videoSettings.seed) ? { seed: node.videoSettings.seed } : {}),
          aspectRatio: videoAspectRatios.has(node.videoSettings.aspectRatio) ? node.videoSettings.aspectRatio : '16:9',
          resolution: videoResolutions.has(node.videoSettings.resolution) ? node.videoSettings.resolution : '480p',
          durationSec: Number.isInteger(Number(node.videoSettings.durationSec)) ? Math.max(1, Math.min(15, Number(node.videoSettings.durationSec))) : 5,
          qualityPreset: videoQualityPresets.has(node.videoSettings.qualityPreset) ? node.videoSettings.qualityPreset : 'standard',
          inferenceSteps: Number.isInteger(Number(node.videoSettings.inferenceSteps)) ? Math.max(4, Math.min(30, Number(node.videoSettings.inferenceSteps))) : 20,
          accelerationModel: videoAccelerationModels.has(node.videoSettings.accelerationModel) ? node.videoSettings.accelerationModel : 'none',
          spectrum: node.videoSettings.spectrum !== false,
          sage: node.videoSettings.sage !== false,
        }
      : undefined;
    const audioSettings = node.kind === 'audio' && node.audioSettings && typeof node.audioSettings === 'object'
      ? {
          mode: audioModes.has(node.audioSettings.mode) ? node.audioSettings.mode : 'instrumental',
          durationSec: Number.isInteger(Number(node.audioSettings.durationSec)) ? Math.max(5, Math.min(300, Number(node.audioSettings.durationSec))) : 30,
          bpm: Number.isInteger(Number(node.audioSettings.bpm)) ? Math.max(30, Math.min(300, Number(node.audioSettings.bpm))) : 84,
          keyScale: optionalBoundedString(node.audioSettings.keyScale, 80) || 'A Minor',
          timeSignature: ['2', '3', '4', '6'].includes(String(node.audioSettings.timeSignature)) ? String(node.audioSettings.timeSignature) : '4',
          inferenceSteps: Number.isInteger(Number(node.audioSettings.inferenceSteps)) ? Math.max(1, Math.min(20, Number(node.audioSettings.inferenceSteps))) : 8,
          seed: Number.isInteger(Number(node.audioSettings.seed)) ? Math.max(0, Math.min(2_147_483_647, Number(node.audioSettings.seed))) : 20260826,
          thinking: node.audioSettings.thinking !== false,
          lyrics: optionalBoundedString(node.audioSettings.lyrics, 4_096),
          vocalLanguage: /^[a-z]{2,8}(?:-[A-Z]{2})?$/u.test(String(node.audioSettings.vocalLanguage ?? 'zh')) ? String(node.audioSettings.vocalLanguage ?? 'zh') : 'zh',
        }
      : undefined;
    const generationOutputPaths = Array.isArray(node.generation?.outputPaths)
      ? [...new Set(node.generation.outputPaths.map((path) => optionalBoundedString(path, 20_000)).filter(Boolean))].slice(0, 12)
      : undefined;
    const generation = node.generation && typeof node.generation === 'object' && generationStatuses.has(node.generation.status) && optionalBoundedString(node.generation.taskId, 200)
      ? {
          status: node.generation.status,
          taskId: optionalBoundedString(node.generation.taskId, 200),
          provider: optionalBoundedString(node.generation.provider, 200) || undefined,
          externalTaskId: optionalBoundedString(node.generation.externalTaskId, 300) || undefined,
          outputPaths: generationOutputPaths,
          parameters: node.generation.parameters && typeof node.generation.parameters === 'object' && JSON.stringify(node.generation.parameters).length < 20_000 ? structuredClone(node.generation.parameters) : undefined,
          error: optionalBoundedString(node.generation.error, 4_000) || undefined,
          updatedAt: optionalBoundedString(node.generation.updatedAt, 100) || new Date().toISOString(),
        }
      : undefined;
    const candidateSource = node.candidateSource && typeof node.candidateSource === 'object' && optionalBoundedString(node.candidateSource.nodeId, 160) && Number.isInteger(Number(node.candidateSource.resultIndex))
      ? { nodeId: optionalBoundedString(node.candidateSource.nodeId, 160), taskId: optionalBoundedString(node.candidateSource.taskId, 200) || undefined, resultIndex: Math.max(0, Math.min(99, Number(node.candidateSource.resultIndex))) }
      : undefined;
    const libraryAssetRef = node.libraryAssetRef && typeof node.libraryAssetRef === 'object' && optionalBoundedString(node.libraryAssetRef.assetId, 200)
      ? { assetId: optionalBoundedString(node.libraryAssetRef.assetId, 200), name: optionalBoundedString(node.libraryAssetRef.name, 160) || '资产库资产', version: Math.max(1, Math.min(100_000, Math.round(finite(node.libraryAssetRef.version, 1)))) }
      : undefined;
    return [{
      id, kind: node.kind, title: optionalBoundedString(node.title, 160) || '未命名节点', content: optionalBoundedString(node.content, 20_000),
      x: Math.max(-100_000, Math.min(100_000, finite(node.x))), y: Math.max(-100_000, Math.min(100_000, finite(node.y))),
      mediaUrl: optionalBoundedString(node.mediaUrl, 20_000).trim()
        || (node.kind === 'video' && generation?.status === 'complete' && ['prism-h3', 'minimax', 'seedance'].includes(generation.provider) && generation.externalTaskId
          ? `/api/h3/media/${encodeURIComponent(generation.externalTaskId)}`
          : node.kind === 'audio' && ['complete', 'partial'].includes(generation?.status) && generation.provider === 'acestep-1.5' && generationOutputPaths?.[0]
            ? `/api/postproduction/music-media/${encodeURIComponent(basename(generationOutputPaths[0]))}`
          : undefined),
      mediaUrls, mediaDurationSec, imageSettings, videoSettings, audioSettings,
      textOptimizationTarget: node.kind === 'text' && textOptimizationTargets.has(node.textOptimizationTarget) ? node.textOptimizationTarget : node.kind === 'text' ? 'script' : undefined,
      generation, candidateSource, libraryAssetRef, sourceRef: source,
      createdAt: optionalBoundedString(node.createdAt, 100) || new Date().toISOString(),
    }];
  });
  const historyKinds = new Set(['image', 'video', 'audio']);
  const historyId = (kind, mediaUrl) => {
    let hash = 2166136261;
    for (const character of `${kind}:${mediaUrl}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return `media-${kind}-${(hash >>> 0).toString(36)}`;
  };
  const seenHistory = new Set();
  const rawMediaHistory = Array.isArray(value.mediaHistory) && JSON.stringify(value.mediaHistory).length <= 8_000_000 ? value.mediaHistory : [];
  const mediaHistory = rawMediaHistory.slice(0, 2_000).flatMap((item) => {
    if (!item || typeof item !== 'object' || !historyKinds.has(item.kind)) return [];
    const mediaUrl = optionalBoundedString(item.mediaUrl, 20_000).trim();
    const key = `${item.kind}:${mediaUrl}`;
    if (!mediaUrl || seenHistory.has(key)) return [];
    seenHistory.add(key);
    return [{
      id: optionalBoundedString(item.id, 200) || historyId(item.kind, mediaUrl), kind: item.kind,
      title: optionalBoundedString(item.title, 160) || `${item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '音频'}历史`,
      mediaUrl, prompt: optionalBoundedString(item.prompt, 20_000),
      createdAt: !Number.isNaN(Date.parse(item.createdAt)) ? String(item.createdAt) : new Date().toISOString(),
      sourceNodeId: optionalBoundedString(item.sourceNodeId, 200) || undefined,
      taskId: optionalBoundedString(item.taskId, 200) || undefined,
      provider: optionalBoundedString(item.provider, 200) || undefined,
      mediaDurationSec: Number.isFinite(Number(item.mediaDurationSec)) && Number(item.mediaDurationSec) > 0 ? Math.min(86_400, Number(item.mediaDurationSec)) : undefined,
    }];
  });
  for (const node of nodes) {
    if (!historyKinds.has(node.kind)) continue;
    const urls = [...new Set([...(node.mediaUrls || []), node.mediaUrl].filter(Boolean))];
    urls.forEach((mediaUrl, index) => {
      const key = `${node.kind}:${mediaUrl}`;
      if (seenHistory.has(key)) return;
      seenHistory.add(key);
      mediaHistory.push({
        id: historyId(node.kind, mediaUrl), kind: node.kind,
        title: urls.length > 1 ? `${node.title} · ${index + 1}` : node.title,
        mediaUrl, prompt: node.content, sourceNodeId: node.id,
        taskId: node.generation?.taskId, provider: node.generation?.provider,
        mediaDurationSec: node.kind === 'video' ? node.mediaDurationSec : undefined,
        createdAt: node.generation && ['complete', 'partial'].includes(node.generation.status) ? node.generation.updatedAt : node.createdAt,
      });
    });
  }
  mediaHistory.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (mediaHistory.length > 2_000) mediaHistory.length = 2_000;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const seen = new Set();
  const edges = rawEdges.flatMap((edge) => {
    if (!edge || typeof edge !== 'object') return [];
    const id = optionalBoundedString(edge.id, 160); const fromNodeId = optionalBoundedString(edge.fromNodeId, 160); const toNodeId = optionalBoundedString(edge.toNodeId, 160);
    const key = `${fromNodeId}>${toNodeId}`;
    if (!id || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId) || fromNodeId === toNodeId || seen.has(key)) return [];
    const sourceHandle = optionalBoundedString(edge.sourceHandle, 100); const targetHandle = optionalBoundedString(edge.targetHandle, 100);
    seen.add(key); return [{ ...(optionalBoundedString(edge.purpose, 80) ? { purpose: optionalBoundedString(edge.purpose, 80) } : {}), id, fromNodeId, toNodeId, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}) }];
  });
  const view = value.view && typeof value.view === 'object' ? value.view : {};
  const rawPreferences = value.preferences && typeof value.preferences === 'object' ? value.preferences : {};
  const preferences = {
    showConnections: typeof rawPreferences.showConnections === 'boolean' ? rawPreferences.showConnections : true,
    showMiniMap: typeof rawPreferences.showMiniMap === 'boolean' ? rawPreferences.showMiniMap : true,
    snapToGrid: typeof rawPreferences.snapToGrid === 'boolean' ? rawPreferences.snapToGrid : false,
  };
  return { view: { x: Math.max(-100_000, Math.min(100_000, finite(view.x))), y: Math.max(-100_000, Math.min(100_000, finite(view.y))), zoom: Math.max(.2, Math.min(1.8, finite(view.zoom, .75))) }, nodes, edges, preferences, mediaHistory };
}

function validateConfiguration(input) {
  const kind = requiredString(input.kind, 'Provider类型');
  if (!ALLOWED_KINDS.has(kind)) throw new InputError('Provider类型无效。');

  const submittedBaseUrl = requiredString(input.baseUrl, '服务地址');
  const baseUrl = normalizeUrl(submittedBaseUrl, kind);
  const requestedModel = kind === 'h3' ? '' : requiredString(input.model, '模型名');
  const model = kind === 'music' && baseUrl === 'https://api.minimaxi.com/v1' && requestedModel === 'music-3'
    ? 'music-3.0'
    : requestedModel;
  const apiKey = kind === 'h3' ? '' : requiredString(input.apiKey, '访问密钥');
  if (apiKey && apiKey.length < 8) throw new InputError('访问密钥长度明显不完整。');

  const protocol = kind === 'agent' ? normalizeTextProtocol(input.protocol, submittedBaseUrl) : undefined;

  const capabilities = kind === 'agent' ? normalizeTextCapabilities(input.capabilities) : undefined;
  return { kind, baseUrl, model, apiKey, ...(protocol ? { protocol } : {}), ...(capabilities ? { capabilities } : {}) };
}

function publicStatus(kind, configuration) {
  return {
    kind,
    configured: Boolean(configuration),
    baseUrl: configuration?.baseUrl ?? '',
    model: configuration?.model ?? '',
    keyHint: configuration?.apiKey ? `••••${configuration.apiKey.slice(-4)}` : '',
    protocol: configuration?.protocol ?? 'auto',
    capabilities: configuration?.capabilities ?? {},
  };
}

function publicProfile(configuration, active) {
  return {
    id: configuration.profileId,
    name: configuration.profileName,
    configured: true,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    keyHint: configuration.apiKey ? `••••${configuration.apiKey.slice(-4)}` : '',
    protocol: configuration.protocol ?? 'auto',
    capabilities: configuration.capabilities ?? {},
    active,
  };
}

function normalizeUrl(value, kind) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new InputError('服务地址不是有效网址。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new InputError('服务地址只允许HTTP或HTTPS。');
  if (parsed.username || parsed.password) throw new InputError('服务地址中不能包含账号或密码。');
  const endpointSuffix = kind === 'agent'
    ? /\/(?:responses|chat\/completions)\/?$/iu
    : kind === 'image' || kind === 'image-edit'
      ? /\/images\/(?:generations|edits)\/?$/iu
      : kind === 'music'
        ? /\/models\/?$/iu
        : /\/system_stats\/?$/iu;
  parsed.pathname = parsed.pathname.replace(endpointSuffix, '').replace(/\/models\/[^/]+\/?$/iu, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeTextProtocol(value, submittedBaseUrl) {
  if (['auto', 'responses', 'chat-completions', 'anthropic-messages'].includes(value)) return value;
  let path = '';
  try { path = new URL(submittedBaseUrl).pathname.toLowerCase(); } catch { return 'auto'; }
  if (/\/chat\/completions\/?$/u.test(path)) return 'chat-completions';
  if (/\/responses\/?$/u.test(path)) return 'responses';
  if (/\/messages\/?$/u.test(path)) return 'anthropic-messages';
  return 'auto';
}

function statusForHttp(status) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'model_missing';
  if (status === 429) return 'rate_limited';
  return 'down';
}

function safeHttpMessage(status) {
  if (status === 401 || status === 403) return `鉴权失败（HTTP ${status}），请检查Key权限。`;
  if (status === 404) return '服务未找到对应模型，请检查服务商与模型设置。';
  if (status === 429) return '接口限流或额度不足（HTTP 429）。';
  return `连接检查失败（HTTP ${status}）。`;
}

function safeNetworkMessage(error) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接超时，请检查地址、代理或本地服务状态。';
  return '无法连接到Provider，请检查地址、网络或本地服务状态。';
}

function result(status, message) {
  return { status, message, checkedAt: new Date().toISOString() };
}

async function readJson(request, maximumBytes = 32_768) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new InputError('请求内容过大。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('请求JSON无效。');
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(`${label}不能为空。`);
  return value.trim();
}

function boundedString(value, maximumLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumLength) throw new InputError('创作会话文本无效。');
  return value;
}

function optionalBoundedString(value, maximumLength) {
  if (typeof value !== 'string') return '';
  if (value.length > maximumLength) throw new InputError('创作会话文本过长。');
  return value;
}

class InputError extends Error {}

class ReturnedAgentDraftValidationError extends InputError {
  constructor(message, returnedDraft, validationIssues) {
    super(message);
    this.name = 'ReturnedAgentDraftValidationError';
    this.code = 'returned_agent_draft_validation_failed';
    this.returnedDraft = String(returnedDraft || '').slice(0, 200_000);
    this.validationIssues = Array.isArray(validationIssues) ? validationIssues.map((item) => String(item).slice(0, 1000)).slice(0, 20) : [];
  }
}

export class WorkflowDependencyError extends InputError {
  constructor(stageId, dependencies, message) {
    const dependencyNames = dependencies.map(stageLabelZh);
    super(message || `${stageLabelZh(stageId)}暂时不能开始：请先完成并确认${dependencyNames.join('、')}。`);
    this.name = 'WorkflowDependencyError';
    this.code = 'workflow_dependencies_unresolved';
    this.stageId = stageId;
    this.dependencies = dependencies;
    this.issues = [{
      code: this.code,
      severity: 'blocking',
      source: 'policy',
      messageZh: this.message,
      suggestionZh: dependencies.length > 0
        ? `回到${dependencyNames.join('、')}，确认已有结果或处理未完成项；成功内容不会被删除。`
        : '先保存当前项目，再重新提交本阶段。',
    }];
    this.recoveryActions = [{ type: 'inspect', labelZh: '查看未完成的前置环节', paid: false }];
  }
}

export function structuredInputError(error) {
  if (error instanceof NovelAdaptationValidationError) return { code: error.code, returnedDraft: error.returnedDraft, validationIssues: [error.message] };
  if (error instanceof SessionRevisionConflict) return { code: error.code, session: error.session };
  if (error instanceof ProductionDirectorSupervisionError) {
    let returnedDraft = '';
    try { returnedDraft = JSON.stringify(error.diagnostics?.invalidDraft, null, 2); } catch { returnedDraft = String(error.diagnostics?.invalidDraft || ''); }
    return {
      code: error.code,
      returnedDraft: returnedDraft.slice(0, 200_000),
      validationIssues: [
        String(error.review?.summary || '').trim(),
        ...(Array.isArray(error.review?.revisionInstructions) ? error.review.revisionInstructions : []),
      ].filter(Boolean).map((item) => String(item).slice(0, 1000)).slice(0, 20),
    };
  }
  if (error instanceof IdeaAgentValidationError) {
    let returnedDraft = '';
    try { returnedDraft = JSON.stringify(error.diagnostics.invalidDraft, null, 2); } catch { returnedDraft = String(error.diagnostics.invalidDraft); }
    return {
      code: error.code,
      issues: error.issues,
      returnedDraft: returnedDraft.slice(0, 200_000),
      validationIssues: error.issues.map((issue) => issue.messageZh).slice(0, 20),
    };
  }
  if (error instanceof ReturnedAgentDraftValidationError) {
    return {
      code: error.code,
      returnedDraft: error.returnedDraft,
      validationIssues: error.validationIssues,
    };
  }
  if (error instanceof StoryboardPromptValidationError) {
    const draft = error.diagnostics?.draft ?? { segments: [], outline: error.diagnostics?.outline ?? [] };
    let returnedDraft = '';
    try { returnedDraft = JSON.stringify(draft, null, 2); } catch { returnedDraft = String(draft); }
    return {
      ...(Array.isArray(draft?.outline) ? { outline: draft.outline } : {}),
      ...(Array.isArray(draft?.segments) ? { segments: draft.segments } : {}),
      code: error.diagnostics?.repairAttempted ? 'storyboard_repair_incomplete' : 'storyboard_validation_failed',
      returnedDraft: returnedDraft.slice(0, 200_000),
      validationIssues: localizeStructuredAgentValidationIssues('文字分镜', error.issues).slice(0, 20),
      repairAttempted: error.diagnostics?.repairAttempted === true,
      repairedSegmentKeys: Array.isArray(error.diagnostics?.repairedSegmentKeys) ? error.diagnostics.repairedSegmentKeys.slice(0, 20) : [],
    };
  }
  if (error instanceof WorkflowDependencyError) {
    return {
      code: error.code,
      stageId: error.stageId,
      dependencies: error.dependencies,
      issues: error.issues,
      recoveryActions: error.recoveryActions,
    };
  }
  if (error instanceof OpenAIResponsesProviderError && typeof error.diagnostics?.rawOutputText === 'string' && error.diagnostics.rawOutputText.trim()) {
    return {
      code: error.code,
      returnedDraft: error.diagnostics.rawOutputText.slice(0, 200_000),
      validationIssues: error.code === 'invalid_structured_output'
        ? ['Agent最终正文不是有效的JSON结构，系统无法读取所需字段。']
        : ['Agent已返回最终正文，但当前步骤没有成功写入。'],
    };
  }
  if (error?.diagnostics && typeof error.diagnostics === 'object' && error.diagnostics.invalidDraft !== undefined) {
    let returnedDraft = '';
    try { returnedDraft = JSON.stringify(error.diagnostics.invalidDraft, null, 2); } catch { returnedDraft = String(error.diagnostics.invalidDraft); }
    return {
      returnedDraft: returnedDraft.slice(0, 200_000),
      validationIssues: Array.isArray(error.issues) ? localizeStructuredAgentValidationIssues('文字Agent结果', error.issues).slice(0, 20) : [],
    };
  }
  return {};
}

export class SessionRevisionConflict extends InputError {
  constructor(session) {
    super('项目已在另一个保存请求中更新。为避免旧状态覆盖新状态，本次保存已停止；请刷新项目后继续。');
    this.name = 'SessionRevisionConflict';
    this.code = 'creative_session_revision_conflict';
    this.session = session;
  }
}
