import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { STORYBOARD_TEXT_REASONING_EFFORT, TEXT_AGENT_REASONING_EFFORT, TEXT_AGENT_TRANSIENT_RETRY_COUNT, VIDEO_PROMPT_BATCH_SIZE, VIDEO_PROMPT_CONCURRENCY, VIDEO_PROMPT_REPAIR_CONCURRENCY, WORKFLOW_STAGE_BY_MUTATION_ROUTE, WorkflowDependencyError, buildFreeCanvasAudioGenerationRequest, buildFreeCanvasH3GenerationRequest, buildHerrgottsRoughCutPlan, buildWebEditorRenderRequest, buildWebFinalCompositionRequest, buildWebH3GenerationRequest, buildWebMusicGenerationRequest, buildWebRoughCutRequest, classifyFreeCanvasImportedMedia, connectPrismH3Console, createAppSettingsStore, createAssetLibraryStore, createAssetReplacementUndoStore, createCreativeSessionStore, createProviderSettingsStore, ideaAgentRuntimeProfile, ideaBlockSpeechKind, launchPrismH3Console, localizeMusicPromptValidationIssues, localizeStructuredAgentValidationIssues, mapWithConcurrencyOrdered, musicTaskResult, normalizeAndValidateVideoPromptBatchItems, prepareH3MemoryForLocalGpuTask, recoverInterruptedImageState, recoverPreservedShortMusic, requireWorkflowDependenciesForRoute, resolveStoredH3MediaPath, runLocalEditorRender, runLocalGpuTask, runLocalRoughCut, safeCharacterAgentMessage, safeFreeCanvasPromptMessage, safeH3Message, safeIdeaAgentMessage, safeImageMessage, safePropAgentMessage, safeSceneAgentMessage, safeStoryboardAgentMessage, structuredInputError, toApprovedDomainScript, upgradeStoredAgentValidationError } from '../local-api.mjs';
import { CharacterAssetPromptValidationError } from '../../src/characters/asset-prompt-generation.ts';
import { IdeaAgentValidationError } from '../../src/ideas/idea-agent.ts';
import { OpenAIImagesProviderError } from '../../src/providers/openai-images.ts';
import { OpenAIResponsesProviderError } from '../../src/providers/openai-responses.ts';
import { LocalGpuCoordinator } from '../../src/providers/local-gpu-coordinator.ts';
import { PrismH3ProviderError } from '../../src/providers/prism-h3.ts';
import { SceneAssetPromptValidationError } from '../../src/scenes/scene-prompt-generation.ts';
import { PropAssetPromptValidationError } from '../../src/props/prop-prompt-generation.ts';
import { StoryboardPromptValidationError } from '../../src/storyboards/storyboard-prompt-generation.ts';
import { deriveWorkflowSnapshot } from '../../src/workflow/runtime.ts';

function makeDirectorPanels({ durationSec, owner, camera, visualPrefix }) {
  return Array.from({ length: 6 }, (_, index) => {
    const secondShot = index >= 3;
    return {
      panelKey: `P${String(index + 1).padStart(2, '0')}`, order: index + 1, startSec: index * durationSec / 6, endSec: (index + 1) * durationSec / 6,
      shotGroupKey: secondShot ? 'SH02' : 'SH01', transitionFromPrevious: index === 0 ? 'initial' : index === 3 ? 'cut' : 'continuous', cutTrigger: index === 0 ? 'initial' : index === 3 ? 'attention-shift' : 'none',
      startState: `状态${index}`, actionUnitKey: secondShot ? 'AU02' : 'AU01', actionOwner: owner, actionSummary: secondShot ? `${owner}回应变化` : `${owner}向前行动`, actionPhase: index % 3 === 0 ? 'setup' : index % 3 === 1 ? 'progress' : 'complete', endState: `状态${index + 1}`,
      shotSize: '中景', camera, visual: `${owner}${visualPrefix}${index + 1}`, characters: [owner], visibleProps: [],
    };
  });
}

test('free canvas local media import accepts recognized image, video and audio formats', () => {
  assert.deepEqual(classifyFreeCanvasImportedMedia('frame.PNG', 'image/png'), { kind: 'image', extension: '.png' });
  assert.deepEqual(classifyFreeCanvasImportedMedia('shot.mp4', 'application/octet-stream'), { kind: 'video', extension: '.mp4' });
  assert.deepEqual(classifyFreeCanvasImportedMedia('voice.wav', 'audio/wav'), { kind: 'audio', extension: '.wav' });
  assert.throws(() => classifyFreeCanvasImportedMedia('archive.zip', 'application/zip'), /只能导入/u);
});

test('interrupted image stages become explicit failures once after local service recreation', () => {
  const interruptedAt = '2026-08-31T01:00:00.000Z';
  const recoveredAt = '2026-08-31T01:05:00.000Z';
  const state = {
    step: 'workspace', projectName: '中断恢复', characterImageStatus: 'running', characterImages: [{ profileKey: 'C01', name: '人物', status: 'complete', imageUrl: '/api/generated-images/kept.png' }],
    sceneImageStatus: 'running', sceneImages: [], propImageStatus: 'running', propImages: [], storyboardBoardStatus: 'running', storyboardBoards: [{ segmentKey: 'SEG001', title: '镜头', status: 'running', imageUrl: '/api/generated-images/old.png' }],
    characterTurnarounds: [{ profileKey: 'C01', name: '人物', status: 'running' }], sceneViews: [{ sceneAssetKey: 'S01', name: '场景', status: 'running' }],
  };
  const session = { schemaVersion: 2, id: 'image-recovery', revision: 7, updatedAt: interruptedAt, state, workflow: deriveWorkflowSnapshot(state, undefined, interruptedAt) };
  const recovered = recoverInterruptedImageState(session, recoveredAt);
  assert.equal(recovered.revision, 8);
  assert.equal(recovered.state.characterImageStatus, 'failed');
  assert.equal(recovered.state.sceneImageStatus, 'failed');
  assert.equal(recovered.state.propImageStatus, 'failed');
  assert.equal(recovered.state.storyboardBoardStatus, 'failed');
  assert.equal(recovered.state.storyboardBoards[0].status, 'failed');
  assert.equal(recovered.state.storyboardBoards[0].imageUrl, '/api/generated-images/old.png');
  assert.equal(recovered.state.characterTurnarounds[0].status, 'failed');
  assert.equal(recovered.state.sceneViews[0].status, 'failed');
  assert.match(recovered.state.characterImageError, /最后项目更新时间：2026-08-31T01:00:00\.000Z/u);
  assert.match(recovered.state.characterImageError, /任务编号：未取得/u);
  assert.match(recovered.state.characterImageError, /没有自动重试/u);
  assert.equal(recoverInterruptedImageState(recovered, '2026-08-31T01:06:00.000Z'), recovered);
});

test('saved H3 output remains playable after the backend forgets the task', () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'autodrama-saved-h3-media-'));
  const directorPath = join(outputDirectory, 'director.mp4');
  const canvasPath = join(outputDirectory, 'canvas.mp4');
  writeFileSync(directorPath, 'director-video');
  writeFileSync(canvasPath, 'canvas-video');
  const saved = { state: {
    shotVideoTasks: [{ externalTaskId: 'director-task', outputPaths: [directorPath] }],
    freeCanvas: { nodes: [{ generation: { externalTaskId: 'canvas-task', outputPaths: [canvasPath] } }] },
  } };
  assert.equal(resolveStoredH3MediaPath(saved, 'director-task'), directorPath);
  assert.equal(resolveStoredH3MediaPath(saved, 'canvas-task'), canvasPath);
  assert.equal(resolveStoredH3MediaPath(saved, 'missing-task'), '');
  rmSync(outputDirectory, { recursive: true, force: true });
});

test('local GPU admission releases idle H3 memory before the exclusive task starts', async () => {
  const events = [];
  const h3Provider = { async releaseMemoryIfIdle() { events.push('release-h3'); return { status: 'released' }; } };
  const coordinator = new LocalGpuCoordinator();
  const result = await runLocalGpuTask(coordinator, { kind: 'image-upscale', taskId: 'upscale-1', label: 'Real-ESRGAN图片超分' }, async () => {
    await prepareH3MemoryForLocalGpuTask(h3Provider);
    events.push('upscale');
    return 'complete';
  });
  assert.equal(result, 'complete');
  assert.deepEqual(events, ['release-h3', 'upscale']);
  assert.deepEqual(coordinator.status(), { busy: false });
});

test('text tasks use explicit reasoning profiles while output budgets scale by task', () => {
  assert.equal(TEXT_AGENT_REASONING_EFFORT, 'high');
  assert.equal(STORYBOARD_TEXT_REASONING_EFFORT, 'medium');
  assert.equal(TEXT_AGENT_TRANSIENT_RETRY_COUNT, 0);
  assert.deepEqual(ideaAgentRuntimeProfile({ answers: [] }), { reasoningEffort: 'high', maxOutputTokens: 16_000 });
  assert.deepEqual(ideaAgentRuntimeProfile({ answers: [{}] }), { reasoningEffort: 'high', maxOutputTokens: 16_000 });
  assert.deepEqual(ideaAgentRuntimeProfile({ answers: [{}, {}] }), { reasoningEffort: 'high', maxOutputTokens: 32_000 });
  assert.deepEqual(ideaAgentRuntimeProfile({ answers: [], forceScript: true }), { reasoningEffort: 'high', maxOutputTokens: 32_000 });
});

test('project manager route adapter sends one command-planning text request with the saved project context', async () => {
  let capturedRequest;
  let capturedProfile;
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      capturedProfile = profile;
      return {
        id: 'fixture-manager-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          capturedRequest = request;
          return {
            providerId: 'fixture-manager-agent', model: 'manager-test', status: 'completed', completedAt: '2026-08-30T10:00:00.000Z', elapsedMs: 8,
            output: {
              replyZh: '剧本已确认，当前停在角色设定。', intent: 'status', diagnosisZh: '角色设定尚未完成。',
              targetStages: ['character-profiles'], targetArtifacts: [],
              proposedActions: [{ order: 1, stageId: 'character-profiles', actionType: 'navigate', summaryZh: '打开角色设定', requiresConfirmation: false, providerImpact: 'none' }],
              downstreamImpact: [],
            },
          };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'manager-test' });
  const state = { step: 'workspace', projectName: '总管测试项目', ideaScript: { title: '第一集' }, scriptApproval: 'approved', characterProfiles: [], activeStage: '角色' };
  const session = { id: 'manager-session', state, workflow: deriveWorkflowSnapshot(state, undefined, '2026-08-30T09:00:00.000Z') };

  const result = await store.runProjectManagerTurn(session, { message: '现在卡在哪里？', reasoningEffort: 'medium', history: [{ role: 'user', text: '先看全局' }] });
  const turn = result.turn;

  assert.deepEqual(capturedProfile, { reasoningEffort: 'medium', maxOutputTokens: 16_000 });
  assert.equal(capturedRequest.operation, 'project-manager-command-turn');
  assert.equal(capturedRequest.input.projectContext.project.name, '总管测试项目');
  assert.equal(capturedRequest.input.projectContext.safety.projectMutationAllowed, true);
  assert.equal(turn.projectChanged, false);
  assert.equal(turn.providerCallsStarted, false);
  assert.equal(result.commands[0].kind, 'navigate');
});

test('H3 migrates a legacy whole storyboard to Ref2VA while preserving asset tag numbers', () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-h3-assets-'));
  writeFileSync(join(generatedImageDirectory, 'board.png'), 'board');
  writeFileSync(join(generatedImageDirectory, 'character.png'), 'character');
  writeFileSync(join(generatedImageDirectory, 'scene.png'), 'scene');
  const state = {
    ratio: '16:9', videoPromptsApproval: 'approved',
    storyboardSegments: [{ segmentKey: 'SEG001', title: '穿过密林', durationSec: 5 }],
    videoPrompts: [{
      segmentKey: 'SEG001', status: 'complete', prompt: '参考输入：SEG001整张六宫格、阿岚角色主图、密林场景主图\n建议时长：5秒\n\n基础设定\n<Subject 1>是<Picture 1>中的阿岚；<Picture 2>控制密林空间。\n\n画面内容与镜头执行\n<Subject 1>穿过<Picture 2>中的密林，参考<Picture 3>第1至6格。',
      referenceLabels: ['SEG001整张六宫格', '阿岚角色主图', '密林场景主图'],
      referenceImageUrls: ['/api/generated-images/board.png', '/api/generated-images/character.png', '/api/generated-images/scene.png'],
    }],
  };
  const request = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'reference', qualityPreset: 'balanced', seed: 9 }, { generatedImageDirectory });
  assert.deepEqual(request.referenceLabels, ['阿岚角色主图', '密林场景主图', 'SEG001整张六宫格']);
  assert.deepEqual(request.referenceMediaPaths.map((value) => value.split(/[\\/]/u).at(-1)), ['character.png', 'scene.png', 'board.png']);
  assert.match(request.prompt, /<Picture 3>是本段整张6宫格/u);
  assert.match(request.prompt, /<Subject 1>是<Picture 1>中的阿岚/u);
  assert.equal(request.inferenceSteps, 10);
  assert.equal(request.mode, 'reference');
  assert.equal(request.confirmRisk, true);

  const withoutBoard = structuredClone(state);
  withoutBoard.videoPrompts[0].prompt = withoutBoard.videoPrompts[0].prompt.replace('，参考<Picture 3>第1至6格', '');
  withoutBoard.videoPrompts[0].prompt = '参考输入：阿岚角色主图、密林场景主图\n基础设定\n<Subject 1>是<Picture 1>中的阿岚；<Picture 2>控制密林空间。\n画面内容与镜头执行\n<Subject 1>穿过<Picture 2>中的密林。';
  withoutBoard.videoPrompts[0].referenceLabels = ['阿岚角色主图', '密林场景主图'];
  withoutBoard.videoPrompts[0].referenceImageUrls = ['/api/generated-images/character.png', '/api/generated-images/scene.png'];
  const withoutBoardRequest = buildWebH3GenerationRequest({ state: withoutBoard }, { segmentKey: 'SEG001', mode: 'reference' }, { generatedImageDirectory });
  assert.deepEqual(withoutBoardRequest.referenceLabels, ['阿岚角色主图', '密林场景主图']);
  assert.deepEqual(withoutBoardRequest.referenceMediaPaths.map((value) => value.split(/[\\/]/u).at(-1)), ['character.png', 'scene.png']);

  const missingBinding = structuredClone(state);
  missingBinding.videoPrompts[0].prompt = missingBinding.videoPrompts[0].prompt.replaceAll('<Picture 2>', '密林场景');
  assert.throws(() => buildWebH3GenerationRequest({ state: missingBinding }, { segmentKey: 'SEG001', mode: 'reference' }, { generatedImageDirectory }), /缺少<Picture 2>/u);
});

test('H3 request is blocked before approval and first-frame mode cannot reuse a six-grid', () => {
  assert.throws(() => buildWebH3GenerationRequest({ state: { videoPromptsApproval: 'draft' } }, { segmentKey: 'SEG001' }), /SEG001.*尚未确认/);
  const state = { videoPromptsApproval: 'approved', storyboardSegments: [{ segmentKey: 'SEG001', title: '镜头', durationSec: 5 }], videoPrompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: '提示词', referenceLabels: [], referenceImageUrls: [] }] };
  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'first' }), /不能把故事板冒充H3首帧/);
});

test('H3 locks the approved prompt preset at submission and uses its aspect ratio', () => {
  const previousPreset = { id: 'project-generation-preset', version: 1, styleId: 'ancient-live-action', aspectRatio: '16:9', imageResolution: '1k', createdAt: '2026-08-30T00:00:00.000Z' };
  const currentPreset = { ...previousPreset, version: 2, aspectRatio: '9:16', createdAt: '2026-08-30T00:01:00.000Z' };
  const state = {
    ratio: '16:9', generationPreset: currentPreset, videoPromptsApproval: 'approved',
    storyboardSegments: [{ segmentKey: 'SEG001', title: '镜头', durationSec: 5 }],
    videoPrompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: '竖屏镜头提示词', referenceLabels: [], referenceImageUrls: [], generationPreset: previousPreset }],
  };
  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'text', generationPreset: currentPreset }), /请先按当前预设 v2 重新生成并确认提示词/u);
  state.videoPrompts[0].generationPreset = currentPreset;
  const request = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'text', generationPreset: currentPreset, resolution: '480p' });
  assert.equal(request.aspectRatio, '9:16');
  assert.equal(request.width, 480);
  assert.equal(request.height, 864);
  assert.deepEqual(request.generationPreset, currentPreset);
});

test('free canvas H3 request resolves @ image and video references through the provider contract', () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-h3-assets-'));
  const imagePath = join(generatedImageDirectory, 'frame.png');
  const videoPath = join(generatedImageDirectory, 'motion.mp4');
  writeFileSync(imagePath, 'image');
  writeFileSync(videoPath, 'video');
  const request = buildFreeCanvasH3GenerationRequest({
    nodeId: 'video-node-1', taskId: 'free-video-task-1', title: '吃饭镜头', prompt: '人物自然吃饭，保持@图片1构图，参考@视频1动作。',
    references: [
      { id: 'text-1', kind: 'text', title: '提示词', content: '人物自然吃饭。' },
      { id: 'image-1', kind: 'image', title: '角色首图', mediaUrl: '/api/generated-images/frame.png', content: '' },
      { id: 'video-1', kind: 'video', title: '动作参考', mediaUrl: '/api/h3/media/old', content: '', mediaDurationSec: 7, videoSettings: { durationSec: 5 }, generation: { outputPaths: [videoPath] } },
    ],
    settings: { mode: 'auto', resolution: '480p', aspectRatio: '16:9', durationSec: 5, inferenceSteps: 20, accelerationModel: 'none', spectrum: true, sage: true, seed: 12 },
  }, { generatedImageDirectory });
  assert.equal(request.prompt, '人物自然吃饭，保持<Picture 1>构图，参考<Video 1>动作。');
  assert.equal(request.mode, 'reference');
  assert.deepEqual(request.referenceMedia.map((item) => item.kind), ['image', 'video']);
  assert.equal(request.referenceMedia[1].frames, 168);
  assert.equal(request.referenceMedia[1].useAudio, true);
  assert.equal(request.seed, 12);
  assert.equal(request.confirmRisk, true);
  assert.throws(() => buildFreeCanvasH3GenerationRequest({
    nodeId: 'video-node-1', taskId: 'free-video-task-invalid-reference', title: '吃饭镜头', prompt: '使用@图片2',
    references: [{ id: 'image-1', kind: 'image', title: '角色首图', mediaUrl: '/api/generated-images/frame.png', content: '' }],
    settings: { mode: 'reference' },
  }, { generatedImageDirectory }), /当前只有1项图片参考/u);
});

test('free canvas video failures preserve the H3 reason', () => {
  const message = safeH3Message(new PrismH3ProviderError('PRISM H3参考视频无法读取。', {
    code: 'invalid_references', status: 400,
  }));
  assert.equal(message, 'PRISM H3参考视频无法读取。 系统没有自动重试。');
});

test('free canvas H3 submission blocks unrequested quoted copy before provider access', () => {
  assert.throws(() => buildFreeCanvasH3GenerationRequest({
    nodeId: 'video-node-silent-copy', taskId: 'free-video-task-silent-copy', title: '餐饮镜头',
    prompt: '声音总则\n无背景音乐、无对白、无旁白。\n\n氛围、画质与摄影风格\n暖色商业摄影。\n\n画面内容与镜头执行\n最终形成“热气腾腾、丰盛共享”的广告收束。\n\n负面词\n文字水印。',
    references: [], settings: { mode: 'text' },
  }), /不能包含引号内容/u);
});

test('free canvas routes current-video editing and extension through Ref2VA using the source duration', () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-h3-extension-'));
  const videoPath = join(generatedImageDirectory, 'current.mp4');
  writeFileSync(videoPath, 'video');
  const request = buildFreeCanvasH3GenerationRequest({
    nodeId: 'video-node-current', taskId: 'free-video-task-extension', title: '当前视频', prompt: '@视频1作为续写来源，从原片结束状态自然延续。',
    references: [{ id: 'video-node-current', kind: 'video', title: '当前视频', mediaUrl: '/api/h3/media/current', content: '', mediaDurationSec: 5, videoSettings: { durationSec: 8 }, generation: { outputPaths: [videoPath] } }],
    settings: { mode: 'auto', durationSec: 8 },
  }, { generatedImageDirectory });
  assert.equal(request.mode, 'reference');
  assert.equal(request.prompt, '<Video 1>作为续写来源，从原片结束状态自然延续。');
  assert.equal(request.durationSec, 8);
  assert.equal(request.referenceMedia[0].frames, 120);
  assert.throws(() => buildFreeCanvasH3GenerationRequest({
    nodeId: 'video-node-current', taskId: 'free-video-task-missing-duration', title: '当前视频', prompt: '@视频1继续',
    references: [{ id: 'video-node-current', kind: 'video', title: '当前视频', mediaUrl: '/api/h3/media/current', content: '', generation: { outputPaths: [videoPath] } }], settings: { mode: 'auto', durationSec: 8 },
  }, { generatedImageDirectory }), /必须先读取到2至15秒/u);
});

test('H3 keeps independent shots out of Herrgotts history and only chains explicit choices', () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-herrgotts-assets-'));
  writeFileSync(join(generatedImageDirectory, 'board.png'), 'board');
  writeFileSync(join(generatedImageDirectory, 'character.png'), 'character');
  const segments = [
    { segmentKey: 'SEG001', title: '起步', durationSec: 5 },
    { segmentKey: 'SEG002', title: '继续走', durationSec: 5 },
  ];
  const prompts = segments.map((segment) => ({ segmentKey: segment.segmentKey, status: 'complete', prompt: '基础设定\n<Subject 1>是<Picture 1>中的人物。\n声音总则\n自然环境声。\n画面内容与镜头执行\n0—5秒：按<Picture 2>第1至6格，<Subject 1>向前走。', referenceLabels: ['六宫格', '人物主图'], referenceImageUrls: ['/api/generated-images/board.png', '/api/generated-images/character.png'] }));
  const state = { ratio: '16:9', videoPromptsApproval: 'approved', storyboardSegments: segments, videoPrompts: prompts, shotVideoTasks: [] };
  const independent = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'reference', continuityMode: 'independent' }, { generatedImageDirectory });
  assert.equal(independent.continuity, undefined);

  const first = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG001', mode: 'reference', continuityMode: 'start_chain' }, { generatedImageDirectory });
  assert.equal(first.continuity.engine, 'herrgotts');
  assert.equal(first.continuity.segmentIndex, 1);
  assert.equal(first.continuity.segmentCount, 2);

  assert.throws(() => buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG002', mode: 'reference', continuityMode: 'continue', sourceSegmentKey: 'SEG001' }, { generatedImageDirectory }), /前一段 SEG001 尚未生成完成/u);
  state.shotVideoTasks = [{ segmentKey: 'SEG001', status: 'awaiting_review', parameters: { continuity: first.continuity } }];
  const second = buildWebH3GenerationRequest({ state }, { segmentKey: 'SEG002', mode: 'reference', continuityMode: 'continue', sourceSegmentKey: 'SEG001' }, { generatedImageDirectory });
  assert.deepEqual(second.continuity, { engine: 'herrgotts', chainId: first.continuity.chainId, segmentIndex: 2, segmentCount: 2, sourceSegmentId: 'SEG001' });
});

test('rough cut request requires approved returned clips and preserves SEG order', () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'autodrama-rough-cut-'));
  const second = join(outputDirectory, 'second.mp4');
  const first = join(outputDirectory, 'first.mp4');
  writeFileSync(first, 'first');
  writeFileSync(second, 'second');
  const saved = { id: 'project-test', state: {
    shotVideosApproval: 'approved',
    storyboardSegments: [{ segmentKey: 'SEG002', order: 2, title: '二' }, { segmentKey: 'SEG001', order: 1, title: '一' }],
    shotVideoTasks: [{ segmentKey: 'SEG002', status: 'awaiting_review', outputPaths: [second] }, { segmentKey: 'SEG001', status: 'awaiting_review', outputPaths: [first] }],
  } };
  const request = buildWebRoughCutRequest(saved, { outputDirectory });
  assert.deepEqual(request.clips.map((clip) => clip.segmentKey), ['SEG001', 'SEG002']);
  assert.deepEqual(request.clips.map((clip) => clip.path), [first, second]);
  assert.equal(request.outputDirectory, outputDirectory);
  assert.throws(() => buildWebRoughCutRequest({ state: { ...saved.state, shotVideosApproval: 'draft' } }), /确认全部镜头视频/u);
  assert.throws(() => buildWebRoughCutRequest({ state: { ...saved.state, shotVideoTasks: [{ segmentKey: 'SEG001', status: 'running', outputPaths: [first] }] } }), /还没有可验收/u);
});

test('local rough cut normalizes mixed source ratios to the fixed project canvas with black bars', async () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'autodrama-rough-cut-runner-'));
  const clips = [join(outputDirectory, 'one.mp4'), join(outputDirectory, 'two.mp4')];
  clips.forEach((path) => writeFileSync(path, 'fixture'));
  const calls = [];
  const processRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') {
      const source = String(args.at(-1));
      const dimensions = source.endsWith('two.mp4') ? { width: 480, height: 864 } : source.endsWith('one.mp4') ? { width: 864, height: 480 } : { width: 854, height: 480 };
      return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', ...dimensions, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '32000' }], format: { duration: '5.0' } }), stderr: '' };
    }
    if (command === 'ffmpeg' && args.includes('-filter_complex')) writeFileSync(args.at(-1), 'rough-cut');
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = await runLocalRoughCut({ id: 'runner-test', state: {
    shotVideosApproval: 'approved', storyboardSegments: [{ segmentKey: 'SEG001', order: 1 }, { segmentKey: 'SEG002', order: 2 }],
    shotVideoTasks: clips.map((path, index) => ({ segmentKey: `SEG00${index + 1}`, status: 'awaiting_review', outputPaths: [path] })),
  } }, { outputDirectory, processRunner });
  assert.equal(result.status, 'complete');
  assert.equal(result.clipCount, 2);
  assert.equal(result.audioPresent, true);
  assert.equal(calls.filter((call) => call.command === 'ffprobe').length, 3);
  assert.equal(calls.filter((call) => call.command === 'ffmpeg').length, 2);
  const renderCall = calls.find((call) => call.command === 'ffmpeg' && call.args.includes('-filter_complex'));
  const filter = renderCall.args[renderCall.args.indexOf('-filter_complex') + 1];
  assert.match(filter, /scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:\(ow-iw\)\/2:\(oh-ih\)\/2:black/u);
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.assemblyMode, 'normalized-black-bars');
  assert.equal(manifest.projectAspectRatio, '16:9');
  assert.ok(manifest.sourceClips.some((clip) => clip.segmentKey === 'SEG001'));
});

function writeSafeTensorMetadata(filePath, metadata) {
  const header = Buffer.from(JSON.stringify({ __metadata__: metadata }), 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length));
  writeFileSync(filePath, Buffer.concat([prefix, header]));
}

test('Herrgotts rough cut reads dynamic handover metadata and removes repeated continuation frames', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-herrgotts-rough-cut-'));
  const latentRoot = join(root, 'latents');
  const chainDirectory = join(latentRoot, 'chain-a');
  mkdirSync(chainDirectory, { recursive: true });
  const clips = [join(root, 'one.mp4'), join(root, 'two.mp4')];
  clips.forEach((path) => writeFileSync(path, 'fixture'));
  writeSafeTensorMetadata(join(chainDirectory, 'clip_00001.safetensors'), {
    frame_count: '362', fps: '24.0', head_context_frames: '0',
    handover_json: JSON.stringify({ available: true, frame_count: 362, handover_end_frame: 340, landing_tail_frames: 21 }),
  });
  writeSafeTensorMetadata(join(chainDirectory, 'clip_00002.safetensors'), {
    frame_count: '362', fps: '24.0', head_context_frames: '35',
    handover_json: JSON.stringify({ available: true, frame_count: 362, handover_end_frame: 352, landing_tail_frames: 9 }),
  });
  const sourceClips = clips.map((path, index) => ({
    segmentKey: `SEG00${index + 1}`, path,
    continuity: { engine: 'herrgotts', chainId: 'chain-a', segmentIndex: index + 1 },
  }));
  const plan = buildHerrgottsRoughCutPlan(sourceClips, { herrgottsLatentRoot: latentRoot });
  assert.equal(plan.hasContinuity, true);
  assert.deepEqual(plan.clips.map((clip) => [clip.headTrimFrames, clip.tailTrimFrames, clip.crossfadeFrames]), [[0, 21, 0], [35, 0, 4]]);
  assert.equal(plan.clips[0].effectiveDurationSec, 341 / 24);
  assert.equal(plan.clips[1].effectiveDurationSec, 327 / 24);

  const calls = [];
  const processRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '32000' }], format: { duration: args.at(-1).includes('rough-cut-') ? String(664 / 24) : String(362 / 24) } }), stderr: '' };
    if (command === 'ffmpeg' && args.includes('-filter_complex')) writeFileSync(args.at(-1), 'rough-cut');
    return { code: 0, stdout: '', stderr: '' };
  };
  const saved = { id: 'herrgotts-runner', state: {
    shotVideosApproval: 'approved', storyboardSegments: [{ segmentKey: 'SEG001', order: 1 }, { segmentKey: 'SEG002', order: 2 }],
    shotVideoTasks: clips.map((path, index) => ({ segmentKey: `SEG00${index + 1}`, status: 'awaiting_review', outputPaths: [path], parameters: { continuity: sourceClips[index].continuity } })),
  } };
  const result = await runLocalRoughCut(saved, { outputDirectory: root, herrgottsLatentRoot: latentRoot, processRunner });
  const ffmpeg = calls.find((call) => call.command === 'ffmpeg' && call.args.includes('-filter_complex'));
  assert.ok(ffmpeg);
  assert.match(ffmpeg.args[ffmpeg.args.indexOf('-filter_complex') + 1], /trim=start_frame=0:end_frame=341/u);
  assert.match(ffmpeg.args[ffmpeg.args.indexOf('-filter_complex') + 1], /trim=start_frame=31:end_frame=35/u);
  assert.match(ffmpeg.args[ffmpeg.args.indexOf('-filter_complex') + 1], /blend=all_expr='A\*\(1-N\/3\)\+B\*\(N\/3\)'/u);
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.assemblyMode, 'herrgotts-metadata-seam-v2');
  assert.match(ffmpeg.args[ffmpeg.args.indexOf('-filter_complex') + 1], /pad=854:480:\(ow-iw\)\/2:\(oh-ih\)\/2:black/u);
  assert.deepEqual(manifest.sourceMedia.map((media) => media.durationSec), [341 / 24, 327 / 24]);
});

test('final composition request requires completed local inputs and builds approved subtitles', () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-final-request-'));
  const roughCut = join(root, 'rough.mp4');
  const music = join(root, 'music.wav');
  const manifest = join(root, 'rough.json');
  writeFileSync(roughCut, 'rough');
  writeFileSync(music, 'music');
  writeFileSync(manifest, JSON.stringify({ sourceClips: [{ segmentKey: 'SEG001' }], sourceMedia: [{ durationSec: 5 }] }));
  const saved = { id: 'final-test', state: {
    ideaScript: { scenes: [{ blocks: [{ type: 'dialogue', text: '活下去' }] }] },
    videoPrompts: [{ segmentKey: 'SEG001', plan: { videoPromptSections: { shotExecution: '1-3秒：对白：“活下去”。' } } }],
    postProduction: { roughCutApproval: 'approved', roughCut: { status: 'complete', outputPath: roughCut, manifestPath: manifest, durationSec: 5 }, audioMode: 'native_with_music', subtitles: 'burned', music: { status: 'complete', outputPath: music } },
  } };
  const request = buildWebFinalCompositionRequest(saved, { outputDirectory: root });
  assert.equal(request.musicPath, music);
  assert.deepEqual(request.subtitleCues.map((cue) => cue.text), ['活下去']);
  assert.throws(() => buildWebFinalCompositionRequest({ state: { postProduction: { ...saved.state.postProduction, music: { status: 'failed' } } } }), /完成并试听配乐/u);
});

test('editor render request keeps source files immutable and validates timeline ranges', () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-editor-request-'));
  const clipPath = join(root, 'clip.mp4');
  writeFileSync(clipPath, 'clip');
  const saved = { id: 'editor-test', state: {
    shotVideoTasks: [{ externalTaskId: 'h3-clip-1', outputPaths: [clipPath] }], freeCanvas: { nodes: [] },
    editor: { clips: [{ id: 'clip-1', assetId: 'asset-1', title: '镜头一', mediaUrl: '/api/h3/media/h3-clip-1', sourceInSec: 1, sourceOutSec: 4.5, nativeVolume: 0.8, transition: 'fade', fadeDurationSec: 0.3 }], nativeVolume: 0.9, musicVolume: 0.2, subtitles: [{ id: 's1', text: '继续走', startSec: 0.5, endSec: 2, enabled: true }] },
  } };
  const request = buildWebEditorRenderRequest(saved, { outputDirectory: root });
  assert.equal(request.clips[0].path, clipPath);
  assert.equal(request.clips[0].durationSec, 3.5);
  assert.equal(request.clips[0].transition, 'fade');
  assert.equal(request.subtitles[0].text, '继续走');
  assert.equal(readFileSync(clipPath, 'utf8'), 'clip');
  assert.throws(() => buildWebEditorRenderRequest({ ...saved, state: { ...saved.state, editor: { ...saved.state.editor, clips: [{ ...saved.state.editor.clips[0], sourceOutSec: 0.5 }] } } }), /入出点无效/u);
});

test('local editor render trims, mixes, subtitles and writes a new validated version once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-editor-render-'));
  const clipPath = join(root, 'clip.mp4'); writeFileSync(clipPath, 'source-video');
  const calls = [];
  const processRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }], format: { duration: args.at(-1).includes('edit-') ? '3.5' : '6.0' } }), stderr: '' };
    if (command === 'ffmpeg' && args.includes('-filter_complex')) writeFileSync(args.at(-1), 'edited-video');
    return { code: 0, stdout: '', stderr: '' };
  };
  const saved = { id: 'editor-runner', state: { shotVideoTasks: [{ externalTaskId: 'h3-1', outputPaths: [clipPath] }], freeCanvas: { nodes: [] }, editor: { clips: [{ id: 'c1', assetId: 'a1', title: '镜头', mediaUrl: '/api/h3/media/h3-1', sourceInSec: 1, sourceOutSec: 4.5, nativeVolume: 1, transition: 'cut', fadeDurationSec: 0.25 }], nativeVolume: 1, musicVolume: 0.25, subtitles: [{ id: 's1', text: '字幕', startSec: 0.5, endSec: 2, enabled: true }] } } };
  const result = await runLocalEditorRender(saved, { outputDirectory: root, processRunner });
  assert.equal(result.status, 'complete');
  assert.equal(result.clipCount, 1);
  assert.equal(result.subtitleCount, 1);
  assert.equal(readFileSync(clipPath, 'utf8'), 'source-video');
  assert.equal(calls.filter((call) => call.command === 'ffmpeg').length, 2);
  const renderCall = calls.find((call) => call.command === 'ffmpeg' && call.args.includes('-filter_complex'));
  assert.match(renderCall.args[renderCall.args.indexOf('-filter_complex') + 1], /trim=start=1\.000000:end=4\.500000/u);
  assert.match(readFileSync(result.manifestPath, 'utf8'), /"automaticRetry": false/u);
});

test('local editor render trims, positions and mixes independently controlled audio clips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-editor-audio-'));
  const clipPath = join(root, 'clip.mp4'); writeFileSync(clipPath, 'source-video');
  const audioFilename = `editor-audio-${process.pid}.wav`;
  const audioDirectory = new URL('../../runtime-data/generated-audio/', import.meta.url); mkdirSync(audioDirectory, { recursive: true });
  const audioPath = new URL(audioFilename, audioDirectory); writeFileSync(audioPath, 'source-audio');
  const calls = [];
  const processRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe') return { code: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 864, height: 480, r_frame_rate: '24/1' }, { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }], format: { duration: args.at(-1).includes('edit-') ? '5.0' : '8.0' } }), stderr: '' };
    if (command === 'ffmpeg' && args.includes('-filter_complex')) writeFileSync(args.at(-1), 'edited-video');
    return { code: 0, stdout: '', stderr: '' };
  };
  const saved = { id: 'editor-audio-runner', state: { shotVideoTasks: [{ externalTaskId: 'h3-audio-1', outputPaths: [clipPath] }], freeCanvas: { nodes: [] }, editor: {
    clips: [{ id: 'c1', assetId: 'a1', title: '镜头', mediaUrl: '/api/h3/media/h3-audio-1', sourceInSec: 0, sourceOutSec: 5, nativeVolume: 0.8, transition: 'cut', fadeDurationSec: 0.25 }], nativeVolume: 0.75,
    audioClips: [{ id: 'ac1', assetId: 'music-1', title: '配乐片段', mediaUrl: `/api/postproduction/music-media/${audioFilename}`, sourceInSec: 1, sourceOutSec: 4, timelineStartSec: 0.75, volume: 0.4, fadeInSec: 0.2, fadeOutSec: 0.3 }], subtitles: [],
  } } };
  try {
    const request = buildWebEditorRenderRequest(saved, { outputDirectory: root });
    assert.equal(request.audioClips[0].timelineStartSec, 0.75);
    assert.equal(request.audioClips[0].volume, 0.4);
    const result = await runLocalEditorRender(saved, { outputDirectory: root, processRunner });
    assert.equal(result.audioClipCount, 1);
    const renderCall = calls.find((call) => call.command === 'ffmpeg' && call.args.includes('-filter_complex'));
    const filter = renderCall.args[renderCall.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /atrim=start=1\.000000:end=4\.000000/u);
    assert.match(filter, /volume=0\.400000/u);
    assert.match(filter, /afade=t=in:st=0:d=0\.200000/u);
    assert.match(filter, /afade=t=out:st=2\.700000:d=0\.300000/u);
    assert.match(filter, /adelay=750\|750/u);
    assert.match(filter, /amix=inputs=2:duration=first:normalize=0/u);
  } finally { rmSync(audioPath, { force: true }); }
});

test('starting PRISM H3 is a separate explicit action and never submits a generation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autodrama-prism-console-'));
  const executablePath = join(root, 'PRISM H3 控制台.exe');
  writeFileSync(executablePath, 'fixture');
  const calls = [];
  const result = await launchPrismH3Console({ executablePath, spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return { unref() { calls.push({ unref: true }); } }; } });
  assert.equal(result.status, 'starting');
  assert.equal(result.automaticSubmission, false);
  assert.equal(calls[0].file, executablePath);
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[1], { unref: true });
});

test('starting PRISM H3 recognizes the bridge while a customer backend is still warming up', async () => {
  const healthSequence = [
    { status: 'backend_offline', message: '尚未发现控制台', details: {} },
    { status: 'backend_offline', message: '后端启动中', details: { prismVersion: '0.4.47' } },
  ];
  let healthIndex = 0;
  let launches = 0;
  let clock = 0;
  const result = await connectPrismH3Console({
    provider: { health: async () => healthSequence[Math.min(healthIndex++, healthSequence.length - 1)] },
    launch: async () => { launches += 1; return { status: 'starting', automaticSubmission: false }; },
    timeoutMs: 5_000,
    pollIntervalMs: 1_000,
    now: () => clock,
    wait: async (milliseconds) => { clock += milliseconds; },
  });
  assert.equal(result.connected, false);
  assert.equal(result.bridgeConnected, true);
  assert.equal(result.health.status, 'backend_offline');
  assert.match(result.message, /工作台已连接/u);
  assert.equal(launches, 1);
  assert.equal('taskId' in result, false);
});

test('starting PRISM H3 keeps automatic discovery active when the bridge takes longer', async () => {
  let clock = 0;
  const result = await connectPrismH3Console({
    provider: { health: async () => ({ status: 'backend_offline', message: '控制台启动中', details: {} }) },
    launch: async () => ({ status: 'starting', automaticSubmission: false }),
    timeoutMs: 2_000,
    pollIntervalMs: 1_000,
    now: () => clock,
    wait: async (milliseconds) => { clock += milliseconds; },
  });
  assert.equal(result.connected, false);
  assert.equal(result.pending, true);
  assert.match(result.message, /继续自动发现并连接/u);
});

test('approved web script distinguishes audible dialogue from inner voice and voiceover', () => {
  const domain = toApprovedDomainScript({
    title: '短片', logline: '角色在黑暗中决定继续前行。', durationSec: 5, endingHook: '眼神仍然明亮。',
    scenes: [{
      location: '岩缝内', time: '黄昏', summary: '角色作出决定。', beats: [], dialogue: [],
      blocks: [
        { type: 'action', speaker: '', delivery: '', text: '角色抬起头。' },
        { type: 'os', speaker: '角色', delivery: '内心，一字一顿', text: '走，继续走。' },
        { type: 'transition', speaker: '', delivery: '', text: '硬切至黑场。字幕浮现：“活着，就是使命。”' },
      ],
    }],
  });
  assert.equal(domain.scenes[0].dialogue[0].kind, 'internal_monologue');
  assert.equal(domain.scenes[0].transitionDirection, '硬切至黑场。字幕浮现：“活着，就是使命。”');
  assert.equal(ideaBlockSpeechKind({ type: 'os', delivery: '咬牙，挤出的声音' }), 'dialogue');
  assert.equal(ideaBlockSpeechKind({ type: 'os', delivery: '画外，声音逐渐远去' }), 'voiceover');
  assert.equal(ideaBlockSpeechKind({ type: 'dialogue', delivery: '低声喘息' }), 'dialogue');
});

test('approved series episode script excludes the global story plan from downstream stages', () => {
  const domain = toApprovedDomainScript({
    title: '重生资本', logline: '全剧最终追查到尚未出场的赵东来。', workType: 'series', durationSec: 60, endingHook: '复仇名单，第一个是陈曜。',
    characters: [{ name: '林然', role: '女主', goal: '完成全剧复仇' }, { name: '赵东来', role: '终极反派', goal: '后续登场' }],
    seriesPlan: [{ episodeNumber: 12, title: '终局', summary: '赵东来落网。', hook: '全剧结束。' }],
    scenes: [{ location: '办公室', time: '白天', summary: '林然重生后锁定本集目标陈曜。', beats: ['林然撤掉陈曜的广告。'], dialogue: [], blocks: [] }],
  });

  assert.equal(domain.logline, '林然重生后锁定本集目标陈曜。');
  assert.equal(domain.synopsis, domain.logline);
  assert.doesNotMatch(JSON.stringify(domain), /赵东来|全剧最终|第12集/);
});

test('video prompt batch preserves every factual segment and marks pacing-only drift as advisory', () => {
  const makeInput = (segmentKey) => ({
    segment: {
      id: `video-${segmentKey}`, segmentKey, sceneKey: 'S01', order: Number(segmentKey.slice(3)), title: segmentKey, durationSec: 5,
      characters: ['阿岚'], sceneAssetKey: 'L01', sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: [], dialogueEvidenceIds: [], soundCueIds: [], referenceAssetIds: [], storyboardText: `${segmentKey}短镜头`, transition: 'cut', groundedEvidence: [],
    },
    boardPlan: {
      semanticDecision: { visibleCharacters: ['阿岚'], characterStates: [{ characterName: '阿岚', state: '警觉' }], visibleProps: [], sceneState: '密林', excludedElements: [], decisionBasis: ['剧本'] },
      referenceRequirements: { characters: ['阿岚'], sceneRequired: true, props: [], decisionBasis: ['人物与场景'] },
      panels: makeDirectorPanels({ durationSec: 5, owner: '阿岚', camera: '连续跟拍', visualPrefix: '动作' }),
    },
    styleName: '古风3D漫剧', sceneAssetKey: 'L01',
  });
  const makePlan = (segmentKey, execution) => ({
    segmentKey, durationSec: 5,
    referenceRequirements: { storyboardBoardRequired: true, characters: [{ characterName: '阿岚', role: '锁定身份' }], scene: { required: true, sceneAssetKey: 'L01', role: '锁定空间' }, props: [], decisionBasis: ['已确认规划'] },
    videoPromptSections: { basicSetting: '密林短镜头。', soundPolicy: '全片零人声，无背景音乐、无对白、无旁白；音轨仅保留持续风声与树叶摩擦声。', atmosphereQualityPhotography: '写实光影。', shotExecution: execution, negativeTerms: ['身份漂移', '场景漂移', '动作跳变', '多余人物', '字幕水印'] },
  });
  const inputs = ['SEG001', 'SEG002', 'SEG003'].map(makeInput);
  const valid = '0-1.2秒（P01-P02）。1.2-2.5秒（P03）。2.5-4秒（P04-P05）。4-5秒（P06）。';
  const invalid = '0-0.83秒（P01）。0.83-1.67秒（P02）。1.67-2.5秒（P03）。2.5-3.33秒（P04）。3.33-4.17秒（P05）。4.17-5秒（P06）。';
  const checked = normalizeAndValidateVideoPromptBatchItems({ items: [
    { segmentKey: 'SEG001', plan: makePlan('SEG001', valid) },
    { segmentKey: 'SEG002', plan: makePlan('SEG002', invalid) },
    { segmentKey: 'SEG003', plan: makePlan('SEG003', valid) },
  ] }, inputs);
  assert.deepEqual(checked.items.map((item) => item.segmentKey), ['SEG001', 'SEG002', 'SEG003']);
  assert.equal(checked.errors.length, 0);
  assert.equal(checked.revisions.length, 0);
  const advisory = checked.items.find((item) => item.segmentKey === 'SEG002');
  assert.equal(advisory.validationWarnings.join('；'), '');
  assert.ok(advisory.plan.videoPromptSections.shotExecution.includes('P06'));
});

test('dialogue pacing returns a visible advisory on the first pass instead of spending a repair call', () => {
  const longDialogue = '我已经把所有事情都安排好了，你不用担心，沿着这条路一直往前走就可以了。';
  const panels = makeDirectorPanels({ durationSec: 15, owner: '阿岚', camera: '连续跟拍', visualPrefix: '动作' });
  const input = {
    segment: {
      id: 'video-SEG001', segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '告别', durationSec: 15,
      characters: ['阿岚'], sceneAssetKey: 'L01', sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: [], dialogueEvidenceIds: ['B-S01-D01'], soundCueIds: [], referenceAssetIds: [], storyboardText: '阿岚说完长句后离开。', transition: 'cut',
      groundedEvidence: [{ evidenceId: 'B-S01-D01', kind: 'dialogue', speechKind: 'dialogue', speakerName: '阿岚', text: longDialogue, delivery: '平静' }],
    },
    boardPlan: {
      semanticDecision: { visibleCharacters: ['阿岚'], characterStates: [{ characterName: '阿岚', state: '平静' }], visibleProps: [], sceneState: '密林', excludedElements: [], decisionBasis: ['剧本'] },
      referenceRequirements: { characters: ['阿岚'], sceneRequired: true, props: [], decisionBasis: ['人物与场景'] },
      panels,
    },
    styleName: '真人电影写实', sceneAssetKey: 'L01',
  };
  const plan = {
    segmentKey: 'SEG001', durationSec: 15,
    referenceRequirements: { storyboardBoardRequired: true, characters: [{ characterName: '阿岚', role: '锁定身份' }], scene: { required: true, sceneAssetKey: 'L01', role: '锁定空间' }, props: [], decisionBasis: ['已确认规划'] },
    videoPromptSections: {
      basicSetting: '密林中的告别。', soundPolicy: '无背景音乐、无新增旁白。', atmosphereQualityPhotography: '真人电影写实。',
      timelineBeats: [
        { panelKeys: ['P01', 'P02'], execution: '阿岚停在原地，抬眼看向前方。' },
        { panelKeys: ['P03'], execution: `阿岚平静地说：“${longDialogue}”` },
        { panelKeys: ['P04', 'P05', 'P06'], execution: '阿岚说完后转身离开，身影消失在密林深处。' },
      ],
      negativeTerms: ['身份漂移', '场景漂移', '动作跳变', '多余人物', '字幕水印'],
    },
  };
  const accepted = normalizeAndValidateVideoPromptBatchItems({ items: [{ segmentKey: 'SEG001', plan }] }, [input]);
  assert.equal(accepted.revisions.length, 0);
  assert.equal(accepted.items[0].segmentKey, 'SEG001');
  assert.equal(accepted.items[0].validationWarnings.join('；'), '');
  assert.ok(accepted.items[0].plan.videoPromptSections.timelineBeats[1].execution.includes(longDialogue));
});

test('provider settings never expose the API key', () => {
  const store = createProviderSettingsStore({ fetchImpl: async () => new Response('{}') });
  const configured = store.configure({
    kind: 'agent',
    apiKey: 'test-super-secret-1234',
    baseUrl: 'https://example.test/v1/',
    model: 'model-a',
  });

  assert.equal(configured.configured, true);
  assert.equal(configured.keyHint, '••••1234');
  assert.equal(JSON.stringify(configured).includes('super-secret'), false);
  assert.equal(JSON.stringify(store.status()).includes('super-secret'), false);
});

test('provider settings keep multiple named models and switch the active profile', () => {
  const store = createProviderSettingsStore({ fetchImpl: async () => new Response('{}') });
  const first = store.configure({ kind: 'agent', profileName: '主力模型', createNew: true, apiKey: 'secret-key-1111', baseUrl: 'https://example.test/v1', model: 'model-a' });
  const second = store.configure({ kind: 'agent', profileName: '备用模型', createNew: true, apiKey: 'secret-key-2222', baseUrl: 'https://example.test/v1', model: 'model-b' });

  assert.equal(second.profiles.length, 2);
  assert.equal(second.model, 'model-b');
  assert.equal(second.profiles.find((profile) => profile.active)?.name, '备用模型');
  const activated = store.activate('agent', first.activeProfileId);
  assert.equal(activated.model, 'model-a');
  assert.equal(activated.profiles.find((profile) => profile.active)?.name, '主力模型');
  assert.equal(JSON.stringify(activated).includes('secret-key'), false);
});

test('a second model on the same service reuses the encrypted key and becomes the request model', async () => {
  let requestedUrl = '';
  let authorization = '';
  const store = createProviderSettingsStore({
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      authorization = init?.headers?.Authorization || '';
      return Response.json({ id: 'model-b' });
    },
  });
  store.configure({ kind: 'agent', profileName: '主力', createNew: true, apiKey: 'shared-secret-1234', baseUrl: 'https://example.test/v1', model: 'model-a' });
  const second = store.configure({ kind: 'agent', profileName: '备用', createNew: true, apiKey: '', baseUrl: 'https://example.test/v1', model: 'model-b' });
  await store.test('agent', second.activeProfileId);

  assert.equal(second.profiles.length, 2);
  assert.equal(requestedUrl, 'https://example.test/v1/models/model-b');
  assert.equal(authorization, 'Bearer shared-secret-1234');
});

test('provider settings persist locally and restore without exposing the key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-provider-settings-'));
  const filePath = join(directory, 'provider-settings.json');
  const first = createProviderSettingsStore({ filePath, fetchImpl: async () => new Response('{}') });
  first.configure({ kind: 'agent', apiKey: 'deepseek-secret-9876', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' });

  const restored = createProviderSettingsStore({ filePath, fetchImpl: async () => new Response('{}') });
  const publicAgent = restored.status().find((provider) => provider.kind === 'agent');

  assert.equal(publicAgent.configured, true);
  assert.equal(publicAgent.model, 'deepseek-v4-flash');
  assert.equal(publicAgent.keyHint, '••••9876');
  assert.equal(publicAgent.profiles[0].protocol, 'auto');
  assert.equal(JSON.stringify(publicAgent).includes('deepseek-secret'), false);
  assert.equal(readFileSync(filePath, 'utf8').includes('deepseek-secret-9876'), true);
});

test('provider settings retain an explicit text protocol and infer it from a full endpoint', () => {
  const store = createProviderSettingsStore({ fetchImpl: async () => new Response('{}') });
  const explicit = store.configure({ kind: 'agent', profileName: 'Claude', createNew: true, apiKey: 'claude-secret-1234', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', protocol: 'anthropic-messages' });
  const inferred = store.configure({ kind: 'agent', profileName: '兼容接口', createNew: true, apiKey: 'chat-secret-1234', baseUrl: 'https://router.example/v1/chat/completions', model: 'custom-model' });

  assert.equal(explicit.profiles.find((profile) => profile.name === 'Claude').protocol, 'anthropic-messages');
  assert.equal(inferred.baseUrl, 'https://router.example/v1');
  assert.equal(inferred.profiles.find((profile) => profile.name === '兼容接口').protocol, 'chat-completions');
});

test('Anthropic connection checks use Messages authentication headers without generating text', async () => {
  let requestedUrl = '';
  let requestedHeaders;
  const store = createProviderSettingsStore({
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedHeaders = init.headers;
      return Response.json({ id: 'claude-sonnet-4-6' });
    },
  });
  const configured = store.configure({ kind: 'agent', profileName: 'Claude', createNew: true, apiKey: 'claude-secret-1234', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', protocol: 'anthropic-messages' });

  const result = await store.test('agent', configured.activeProfileId);

  assert.equal(result.status, 'ok');
  assert.equal(requestedUrl, 'https://api.anthropic.com/v1/models/claude-sonnet-4-6');
  assert.equal(requestedHeaders['x-api-key'], 'claude-secret-1234');
  assert.equal(requestedHeaders['anthropic-version'], '2023-06-01');
  assert.equal('Authorization' in requestedHeaders, false);
});

test('provider settings migrate the single-profile schema without losing the saved connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-provider-migration-'));
  const filePath = join(directory, 'provider-settings.json');
  writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, providers: [{ kind: 'image', apiKey: 'image-secret-1234', baseUrl: 'https://example.test/v1', model: 'image-a' }] }));
  const store = createProviderSettingsStore({ filePath, fetchImpl: async () => new Response('{}') });
  const image = store.status().find((provider) => provider.kind === 'image');

  assert.equal(image.configured, true);
  assert.equal(image.profiles.length, 1);
  assert.equal(image.profiles[0].active, true);
  assert.equal(image.profiles[0].model, 'image-a');
});

test('app settings persist conservative new-project defaults and expose local storage paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-app-settings-'));
  const filePath = join(directory, 'app-settings.json');
  const first = createAppSettingsStore({ filePath });
  const updated = first.update({ creativeDefaults: { storyboardSegmentDurationSec: 10, storyboardBoardPanelCount: 9, h3QualityPreset: 'balanced', h3Resolution: '720p', subtitles: 'none', audioMode: 'native' } });
  assert.equal(updated.settings.creativeDefaults.storyboardSegmentDurationSec, 10);
  assert.equal(updated.settings.creativeDefaults.storyboardBoardPanelCount, 9);
  assert.equal(updated.settings.creativeDefaults.h3QualityPreset, 'balanced');
  assert.ok(updated.storage.some((location) => location.id === 'compositions' && location.path.endsWith('runtime-data\\compositions')));

  const restored = createAppSettingsStore({ filePath }).status();
  assert.deepEqual(restored.settings.creativeDefaults, updated.settings.creativeDefaults);
  const sanitized = first.update({ creativeDefaults: { storyboardSegmentDurationSec: 99, storyboardBoardPanelCount: 8, h3QualityPreset: 'unknown', h3Resolution: '4k', subtitles: 'always', audioMode: 'mute' } });
  assert.equal(sanitized.settings.creativeDefaults.storyboardSegmentDurationSec, 15);
  assert.equal(sanitized.settings.creativeDefaults.storyboardBoardPanelCount, 3);
  assert.equal(sanitized.settings.creativeDefaults.h3Resolution, '480p');
});

test('free canvas prompt optimizer is an explicit single high-reasoning text call', async () => {
  const localApiSource = readFileSync(new URL('../local-api.mjs', import.meta.url), 'utf8');
  assert.match(localApiSource, /startsWith\('\/api\/free-canvas'\)/);
  const calls = [];
  const profiles = [];
  const store = createProviderSettingsStore({
    fetchImpl: async () => new Response('{}'),
    agentProviderFactory: (_configuration, profile) => ({
      id: 'fixture-agent',
      async health() { throw new Error('not used'); },
      async generate(request) {
        profiles.push(profile);
        calls.push(request);
        return { output: { basicSetting: '清晨城市天台。', soundPolicy: '无背景音乐、无对白、无旁白。', atmosphereQualityPhotography: '清冷晨光。', visualExecution: '人物停在天台边缘。', negativeTerms: '文字水印。' }, providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
      },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'agent-test' });
  const optimized = await store.runFreeCanvasPromptOptimization({ kind: 'video', prompt: '清晨城市天台' });
  assert.match(optimized, /画面内容与镜头执行/u);
  assert.deepEqual(profiles, [{ reasoningEffort: 'high', maxOutputTokens: 12_000 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'optimize-free-canvas-prompt');
});

test('free canvas prompt failures expose the real safe cause instead of a settings-service error', () => {
  assert.equal(safeFreeCanvasPromptMessage(new Error('文字Agent返回的生产提示词缺少必要分段，原文已保留。')), '文字Agent返回的生产提示词缺少必要分段，原文已保留。 系统没有自动重试。');
  assert.match(safeFreeCanvasPromptMessage(new OpenAIResponsesProviderError('network', { code: 'network_error' })), /文字Agent连接失败[\s\S]*network_error[\s\S]*没有自动重试/u);
});

test('text request deadline explains the waiting limit and preserves manual resubmission', () => {
  const message = safeIdeaAgentMessage(new OpenAIResponsesProviderError('Request aborted', {
    code: 'request_timeout',
    diagnostics: { operation: 'adapt-novel-to-series-plan', timeoutMs: 300_000, elapsedMs: 300_012, attemptCount: 1, retryCount: 0 },
  }));
  assert.match(message, /文字Agent请求超时/u);
  assert.match(message, /失败步骤：智能拆集/u);
  assert.match(message, /等待上限：300秒/u);
  assert.match(message, /等待时间：300秒/u);
  assert.match(message, /现有内容已保留/u);
  assert.match(message, /系统没有自动重试/u);
  assert.doesNotMatch(message, /连接失败|检查网络/u);
});

test('free canvas image count splits into parallel single-image tasks and can use upstream text', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-canvas-image-'));
  const outputPaths = [join(generatedImageDirectory, 'free-result-01.webp'), join(generatedImageDirectory, 'free-result-02.webp')];
  outputPaths.forEach((outputPath) => writeFileSync(outputPath, 'fixture'));
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    imageProviderFactory: () => ({
      id: 'fixture-image', async health() {},
      async submit(request) {
        calls.push(request);
        const callIndex = calls.length - 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { id: request.taskId, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approval: 'draft', kind: 'image', provider: 'fixture-image', sourceEntityIds: request.sourceEntityIds, status: 'awaiting_review', parameters: {}, outputPaths: [outputPaths[callIndex]] };
      },
    }),
  });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://images.example.test/v1', model: 'image-test' });
  const result = await store.runFreeCanvasImageGeneration({
    nodeId: 'node-image-1', taskId: 'free-canvas-image-1', prompt: '',
    references: [{ id: 'node-text-1', kind: 'text', title: '人物动作', content: '御坂美琴吃饭' }],
    settings: { width: 2048, height: 2048, resolution: '2k', quality: 'medium', count: 2, outputFormat: 'webp' },
  });
  assert.equal(calls.length, 2);
  assert.equal(maxActive, 2);
  assert.equal(calls[0].prompt, '御坂美琴吃饭');
  assert.deepEqual(calls[0].sourceEntityIds, ['node-image-1', 'node-text-1']);
  assert.deepEqual(calls.map((call) => call.taskId), ['free-canvas-image-1-01', 'free-canvas-image-1-02']);
  assert.deepEqual({ width: calls[0].width, height: calls[0].height, count: calls[0].count, quality: calls[0].quality, outputFormat: calls[0].outputFormat }, { width: 2048, height: 2048, count: 1, quality: 'medium', outputFormat: 'webp' });
  assert.deepEqual(result.imageUrls, ['/api/generated-images/free-result-01.webp', '/api/generated-images/free-result-02.webp']);
  assert.equal(result.status, 'complete');
});

test('free canvas image settings reject unsupported size before provider access', async () => {
  let providerCalls = 0;
  const store = createProviderSettingsStore({ imageProviderFactory: () => ({ id: 'fixture-image', async health() {}, async submit() { providerCalls += 1; } }) });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://images.example.test/v1', model: 'image-test' });
  await assert.rejects(() => store.runFreeCanvasImageGeneration({ nodeId: 'node-image-1', taskId: 'free-canvas-image-invalid', prompt: '测试', references: [], settings: { width: 1600, height: 900, quality: 'high', count: 1, outputFormat: 'png' } }), /必须使用参数选择器提供的1K、2K或4K规格/u);
  assert.equal(providerCalls, 0);
});

test('free canvas image editing resolves @ image mentions and validates them before provider access', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-canvas-image-reference-'));
  const referencePath = join(generatedImageDirectory, 'reference.png');
  const outputPath = join(generatedImageDirectory, 'edited.png');
  writeFileSync(referencePath, 'reference');
  writeFileSync(outputPath, 'edited');
  const calls = [];
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    imageEditProviderFactory: () => ({
      id: 'fixture-image-edit', async health() {}, async submit(request) {
        calls.push(request);
        return { id: request.taskId, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approval: 'draft', kind: 'image', provider: 'fixture-image-edit', sourceEntityIds: request.sourceEntityIds, status: 'awaiting_review', parameters: {}, outputPaths: [outputPath] };
      },
    }),
  });
  store.configure({ kind: 'image-edit', apiKey: 'image-edit-key-123456', baseUrl: 'https://images.example.test/v1', model: 'image-edit-test' });
  const references = [{ id: 'node-image-source', kind: 'image', title: '上一张图片', content: '', mediaUrl: '/api/generated-images/reference.png' }];
  const result = await store.runFreeCanvasImageGeneration({
    nodeId: 'node-image-edit', taskId: 'free-canvas-image-edit', prompt: '@图片1把食物换成汉堡', references,
    settings: { width: 1024, height: 1024, quality: 'high', count: 1, outputFormat: 'png' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, '参考图1把食物换成汉堡');
  assert.deepEqual(calls[0].referenceMediaPaths, [referencePath]);
  assert.deepEqual(calls[0].referenceAssetIds, ['node-image-source']);
  assert.deepEqual(result.imageUrls, ['/api/generated-images/edited.png']);
  await assert.rejects(() => store.runFreeCanvasImageGeneration({
    nodeId: 'node-image-edit', taskId: 'free-canvas-image-edit-invalid', prompt: '@图片2把食物换成汉堡', references,
    settings: { width: 1024, height: 1024, quality: 'high', count: 1, outputFormat: 'png' },
  }), /当前只有1项图片参考/u);
  assert.equal(calls.length, 1);
});

test('free canvas image editing submits every connected image reference', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-canvas-many-references-'));
  const references = Array.from({ length: 5 }, (_, index) => {
    const filename = `reference-${index + 1}.png`;
    writeFileSync(join(generatedImageDirectory, filename), `reference ${index + 1}`);
    return { id: `node-image-${index + 1}`, kind: 'image', title: `参考${index + 1}`, content: '', mediaUrl: `/api/generated-images/${filename}` };
  });
  references[1].purpose = 'character';
  const outputPath = join(generatedImageDirectory, 'edited-many.png');
  writeFileSync(outputPath, 'edited');
  let submitted;
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    imageEditProviderFactory: () => ({ id: 'fixture-image-edit', async health() {}, async submit(request) {
      submitted = request;
      return { id: request.taskId, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approval: 'draft', kind: 'image', provider: 'fixture-image-edit', sourceEntityIds: request.sourceEntityIds, status: 'awaiting_review', parameters: {}, outputPaths: [outputPath] };
    } }),
  });
  store.configure({ kind: 'image-edit', apiKey: 'image-edit-key-123456', baseUrl: 'https://images.example.test/v1', model: 'image-edit-test' });

  await store.runFreeCanvasImageGeneration({
    nodeId: 'node-image-edit', taskId: 'free-canvas-image-edit-many', prompt: '@图片5作为构图参考', references,
    settings: { width: 1024, height: 1024, quality: 'high', count: 1, outputFormat: 'png' },
  });

  assert.match(submitted.prompt, /输入图片2：用于人物身份/);
  assert.equal(submitted.referenceMediaPaths.length, 5);
  assert.deepEqual(submitted.referenceAssetIds, references.map((item) => item.id));
});

test('free canvas image batch keeps successful single-image results when one parallel task fails', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'autodrama-free-canvas-partial-'));
  const outputPath = join(generatedImageDirectory, 'partial-result.png');
  writeFileSync(outputPath, 'fixture');
  let calls = 0;
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    imageProviderFactory: () => ({
      id: 'fixture-image', async health() {},
      async submit(request) {
        calls += 1;
        if (request.taskId.endsWith('-02')) throw new Error('fixture second task failed');
        return { id: request.taskId, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approval: 'draft', kind: 'image', provider: 'fixture-image', sourceEntityIds: request.sourceEntityIds, status: 'awaiting_review', parameters: {}, outputPaths: [outputPath] };
      },
    }),
  });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://images.example.test/v1', model: 'image-test' });
  const result = await store.runFreeCanvasImageGeneration({ nodeId: 'node-image-partial', taskId: 'free-canvas-image-partial', prompt: '测试', references: [], settings: { width: 1024, height: 1024, quality: 'high', count: 2, outputFormat: 'png' } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.imageUrls, ['/api/generated-images/partial-result.png']);
  assert.match(result.warning, /已生成1\/2张[\s\S]*没有自动重试/u);
});

test('saved provider key survives a model-only update and official Music 3 is normalized', () => {
  const store = createProviderSettingsStore({ fetchImpl: async () => new Response('{}') });
  store.configure({ kind: 'music', apiKey: 'minimax-secret-1234', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3' });
  const updated = store.configure({ kind: 'music', apiKey: '', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3.0' });

  assert.equal(updated.model, 'music-3.0');
  assert.equal(updated.keyHint, '••••1234');
  assert.equal(JSON.stringify(updated).includes('minimax-secret'), false);
});

test('health check uses the configured model endpoint and bearer key', async () => {
  let request;
  const store = createProviderSettingsStore({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ id: 'gpt-image-test' });
    },
  });

  store.configure({
    kind: 'image',
    apiKey: 'image-key-123456',
    baseUrl: 'https://images.example.test/v1',
    model: 'gpt-image-test',
  });
  const health = await store.test('image');

  assert.equal(health.status, 'ok');
  assert.equal(request.url, 'https://images.example.test/v1/models/gpt-image-test');
  assert.equal(request.init.headers.Authorization, 'Bearer image-key-123456');
});

test('provider setup accepts a pasted full image endpoint and stores its service root', () => {
  const store = createProviderSettingsStore({ fetchImpl: async () => new Response('{}') });
  const configured = store.configure({
    kind: 'image-edit',
    apiKey: 'image-key-123456',
    baseUrl: 'https://api.apiyi.com/v1/images/generations?source=console',
    model: 'gpt-image-2-all',
  });

  assert.equal(configured.baseUrl, 'https://api.apiyi.com/v1');
  assert.equal(configured.model, 'gpt-image-2-all');
});

test('health check falls back to the read-only model list when model detail is unsupported', async () => {
  const requests = [];
  const store = createProviderSettingsStore({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith('/models/gpt-image-2-all')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2-all' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  store.configure({ kind: 'image-edit', apiKey: 'image-key-123456', baseUrl: 'https://api.apiyi.com/v1', model: 'gpt-image-2-all' });

  const health = await store.test('image-edit');

  assert.equal(health.status, 'ok');
  assert.deepEqual(requests, ['https://api.apiyi.com/v1/models/gpt-image-2-all', 'https://api.apiyi.com/v1/models']);
  assert.match(health.message, /gpt-image-2-all/u);
});

test('MiniMax Music health check uses the official non-generating models endpoint', async () => {
  let request;
  const store = createProviderSettingsStore({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'music-3.0' }] }), { status: 200 });
    },
  });

  store.configure({
    kind: 'music',
    apiKey: 'minimax-key-123456',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'music-3.0',
  });
  const health = await store.test('music');

  assert.equal(health.status, 'ok');
  assert.equal(request.url, 'https://api.minimaxi.com/v1/models');
  assert.equal(request.init.headers.Authorization, 'Bearer minimax-key-123456');
  assert.match(health.message, /未调用音乐生成/u);
  assert.match(health.message, /实际生成权限尚未验证/u);
});

test('H3 health check does not require or send a key', async () => {
  let request;
  const store = createProviderSettingsStore({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response('{}', { status: 200 });
    },
  });

  store.configure({ kind: 'h3', baseUrl: 'http://127.0.0.1:8188' });
  const health = await store.test('h3');

  assert.equal(health.status, 'ok');
  assert.equal(request.url, 'http://127.0.0.1:8188/system_stats');
  assert.equal(request.init.headers, undefined);
});

test('invalid configuration is rejected before any network access', async () => {
  let calls = 0;
  const store = createProviderSettingsStore({ fetchImpl: async () => { calls += 1; } });
  assert.throws(
    () => store.configure({ kind: 'agent', apiKey: 'short', baseUrl: 'not-a-url', model: '' }),
    /服务地址|模型名|访问密钥/,
  );
  assert.equal(calls, 0);
});

test('image failures retain safe technical diagnostics with Chinese guidance', () => {
  const message = safeImageMessage(new OpenAIImagesProviderError('Upstream worker unavailable', {
    status: 500,
    code: 'worker_unavailable',
    diagnostics: { requestId: 'req-safe-123' },
  }));

  assert.match(message, /HTTP 500/);
  assert.match(message, /图片服务暂时异常/);
  assert.match(message, /处理建议/);
  assert.match(message, /worker_unavailable/);
  assert.match(message, /req-safe-123/);
  assert.doesNotMatch(message, /Upstream worker unavailable/);
  assert.match(message, /没有自动重试/);
});

test('image moderation failures are explained in Chinese with an actionable suggestion', () => {
  const message = safeImageMessage(new OpenAIImagesProviderError('Your request was rejected by the safety system.', {
    status: 400,
    code: 'moderation_blocked',
    diagnostics: { requestId: 'req-moderation-123' },
  }));

  assert.match(message, /安全审核拦截/u);
  assert.match(message, /处理建议/u);
  assert.match(message, /非接触、非伤害/u);
  assert.match(message, /moderation_blocked/u);
  assert.match(message, /req-moderation-123/u);
  assert.doesNotMatch(message, /Your request was rejected by the safety system/u);
  assert.match(message, /没有自动重试/u);
});

test('Seedream request guards explain unsupported settings without suggesting an automatic retry', () => {
  const cases = [
    ['seedream_single_output_only', /只生成1张/u],
    ['seedream_output_format_unsupported', /PNG或JPEG/u],
    ['seedream_dimensions_unsupported', /1K、1\.5K或2K/u],
    ['seedream_reference_too_large', /30MB/u],
  ];
  for (const [code, expected] of cases) {
    const message = safeImageMessage(new OpenAIImagesProviderError('fixture', { code }));
    assert.match(message, expected);
    assert.match(message, /手动提交/u);
    assert.match(message, /没有自动重试/u);
  }
});

test('text failures retain safe response diagnostics without raw output', () => {
  const message = safeIdeaAgentMessage(new OpenAIResponsesProviderError('Responses API result did not contain output text.', {
    status: 200,
    code: 'missing_output_text',
    diagnostics: {
      responseStatus: 'completed',
      externalTaskId: 'resp-safe-456',
      rawOutputText: 'private draft text',
      outputItemSummary: [
        { type: 'reasoning', contentTypes: ['reasoning_text'] },
        { type: 'message', contentTypes: [] },
      ],
    },
  }));

  assert.match(message, /成功状态/);
  assert.match(message, /missing_output_text/);
  assert.match(message, /completed/);
  assert.match(message, /resp-safe-456/);
  assert.match(message, /返回内容类型：reasoning\(reasoning_text\)、message\(empty\)/);
  assert.doesNotMatch(message, /private draft text/);
  assert.match(message, /没有自动重试/);
});

test('idea validation failures expose the exact field, model, request id and recovery advice', () => {
  const error = new IdeaAgentValidationError([{
    code: 'question_repeated',
    field: 'question',
    messageZh: 'Agent重复了已经回答的问题。',
    suggestionZh: '直接生成剧本，或重新请求一个新的问题。',
  }], { status: 'question', question: '重复问题', options: [], script: null }, {
    output: { status: 'question', question: '重复问题', options: [], script: null },
    providerId: 'openai-responses', model: 'gpt-5.6-terra', externalTaskId: 'req-idea-validation', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 2_345,
  });

  const message = safeIdeaAgentMessage(error);
  const structured = structuredInputError(error);
  assert.match(message, /失败步骤：编剧导演剧本校验/u);
  assert.match(message, /涉及字段：question/u);
  assert.match(message, /gpt-5\.6-terra/u);
  assert.match(message, /req-idea-validation/u);
  assert.match(message, /直接生成剧本/u);
  assert.equal(structured.code, 'idea_agent_validation_failed');
  assert.equal(structured.issues[0].field, 'question');
  assert.match(structured.returnedDraft, /重复问题/u);
});

test('storyboard planning upstream failures identify the failed text step and affected segments', () => {
  const message = safeIdeaAgentMessage(new OpenAIResponsesProviderError('Temporary upstream gateway failure.', {
    status: 502,
    code: 'upstream_error',
    diagnostics: {
      operation: 'plan-storyboard-board-panels-batch',
      targetKeys: ['SEG001', 'SEG002', 'SEG003'],
      requestedModel: 'gpt-5.6-terra',
      externalTaskId: 'req-storyboard-502',
      elapsedMs: 12_340,
      attemptCount: 3,
      retryCount: 2,
      transientFailures: [
        { attempt: 1, status: 502, code: 'upstream_error', externalTaskId: 'req-storyboard-500-a', elapsedMs: 200, retryDelayMs: 1_000 },
        { attempt: 2, status: 503, code: 'upstream_error', externalTaskId: 'req-storyboard-500-b', elapsedMs: 300, retryDelayMs: 2_000 },
      ],
    },
  }));

  assert.match(message, /画格规划与故事板图片提示词/u);
  assert.match(message, /SEG001、SEG002、SEG003/u);
  assert.match(message, /HTTP 502/u);
  assert.match(message, /upstream_error/u);
  assert.match(message, /Temporary upstream gateway failure/u);
  assert.match(message, /gpt-5\.6-terra/u);
  assert.match(message, /req-storyboard-502/u);
  assert.match(message, /图片生成尚未开始/u);
  assert.match(message, /已使用相同设置重试2次/u);
  assert.match(message, /恢复记录：第1次 HTTP 502，请求ID req-storyboard-500-a；第2次 HTTP 503，请求ID req-storyboard-500-b/u);
  assert.match(message, /仍未取得结果/u);
});

test('invalid structured schema failures explain the compatibility cause without retrying', () => {
  const message = safeIdeaAgentMessage(new OpenAIResponsesProviderError('uniqueItems is not permitted', {
    status: 400,
    code: 'invalid_json_schema',
  }));

  assert.match(message, /结构化输出规则与当前接口不兼容/u);
  assert.match(message, /invalid_json_schema/u);
  assert.match(message, /没有自动重试/u);
  assert.match(message, /接口说明：uniqueItems is not permitted/u);
});

test('character prompt validation returns Chinese causes and repair guidance', () => {
  const message = safeCharacterAgentMessage(new CharacterAssetPromptValidationError([
    'prompt 1 must use promptKey CP01',
    'prompt 1 does not match the approved character profile',
    'prompt 1 has incomplete prompt sections',
  ]));

  assert.match(message, /角色生图提示词/u);
  assert.match(message, /稳定ID或顺序/u);
  assert.match(message, /补齐/u);
  assert.match(message, /没有自动重试/u);
  assert.doesNotMatch(message, /promptKey CP01/u);
});

test('stored validation failures gain actionable guidance without rerunning an Agent', () => {
  const oldMessage = '文字分镜没有完成：文字结果已经返回，但文字分镜的对白逐字保留与说话人未通过本地校验；1项问题均未写入。系统没有自动重试。';
  const upgraded = upgradeStoredAgentValidationError(oldMessage, '文字分镜');

  assert.match(upgraded, /必要事实或结构校验/u);
  assert.match(upgraded, /修改建议/u);
  assert.match(upgraded, /逐字复制对白/u);
});

test('creative session preserves non-blocking music validation warnings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-music-warning-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    store.save({ state: { step: 'start', postProduction: { musicPrompt: { status: 'complete', validationWarnings: ['配器职责可以写得更明确。'] } } } });
    const restored = createCreativeSessionStore({ filePath }).load();
    assert.deepEqual(restored.state.postProduction.musicPrompt.validationWarnings, ['配器职责可以写得更明确。']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session preserves scene and prop rejected drafts for recovery after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-rejected-drafts-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    store.save({
      state: {
        step: 'workspace',
        sceneStatus: 'failed',
        sceneRejectedDraft: '{"proposals":[{"sceneAssetKey":"L01"}]}',
        sceneRejectedIssues: ['场景提案缺少固定地标。'],
        propStatus: 'failed',
        propRejectedDraft: '{"proposals":[{"propAssetKey":"R01"}]}',
        propRejectedIssues: ['道具提案缺少识别锚点。'],
      },
    });
    const restored = createCreativeSessionStore({ filePath }).load();
    assert.equal(restored.state.sceneRejectedDraft, '{"proposals":[{"sceneAssetKey":"L01"}]}');
    assert.deepEqual(restored.state.sceneRejectedIssues, ['场景提案缺少固定地标。']);
    assert.equal(restored.state.propRejectedDraft, '{"proposals":[{"propAssetKey":"R01"}]}');
    assert.deepEqual(restored.state.propRejectedIssues, ['道具提案缺少识别锚点。']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session separates a long storyboard draft from its saved error summary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-storyboard-rejected-draft-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const returnedDraft = `{"items":["${'画格'.repeat(3_000)}"]}`;
    const saved = store.save({ state: {
      step: 'workspace',
      storyboardBoardStatus: 'failed',
      storyboardBoardError: `故事板规划没有完成。\n\n未通过原因：\n1. JSON结构无法读取。\n\nAgent 已返回的正文：\n${returnedDraft}`,
    } });
    assert.equal(saved.state.storyboardBoardError, '故事板规划没有完成。\n\n未通过原因：\n1. JSON结构无法读取。');
    assert.equal(saved.state.storyboardBoardRejectedDraft, returnedDraft);
    const updated = store.save({ expectedRevision: saved.revision, state: { ...saved.state, managerTranscript: [{ role: 'user', text: '发生了什么？' }] } });
    assert.equal(updated.state.managerTranscript[0].text, '发生了什么？');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session migrates schema v1 to a revisioned workflow snapshot without losing state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-session-v2-migration-'));
  const filePath = join(directory, 'session.json');
  try {
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 1,
      id: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-08-29T00:00:00.000Z',
      state: { step: 'workspace', ideaScript: { title: '旧项目' }, scriptApproval: 'approved' },
    }));
    const restored = createCreativeSessionStore({ filePath }).load();
    assert.equal(restored.schemaVersion, 2);
    assert.equal(restored.revision, 0);
    assert.equal(restored.state.ideaScript.title, '旧项目');
    assert.equal(restored.workflow.stages.script.status, 'ready');
    assert.ok(restored.workflow.history.some((event) => event.stageId === 'script'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session rejects stale full-state writes and preserves the newer revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-session-revision-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const first = store.save({ state: { step: 'idea', ideaText: '第一版' } });
    const second = store.save({ expectedRevision: first.revision, state: { step: 'idea', ideaText: '第二版' } });
    assert.equal(second.revision, first.revision + 1);
    assert.throws(
      () => store.save({ expectedRevision: first.revision, state: { step: 'idea', ideaText: '过期覆盖' } }),
      (error) => error.code === 'creative_session_revision_conflict' && error.session.revision === second.revision,
    );
    assert.equal(store.load().state.ideaText, '第二版');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session repairs a persisted missing storyboard grid label without discarding results', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-session-storyboard-grid-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const saved = store.save({
      state: {
        step: 'workspace',
        storyboardBoardPanelCount: 3,
        storyboardBoardError: '当前项目已切换为undefined宫格；请重新准备undefined格规划。',
        propProposals: [{ propAssetKey: 'R01', name: '充电盒' }, { propAssetKey: 'R02', name: '耳机' }],
        propImages: [{ propAssetKey: 'R01', status: 'complete', imageUrl: '/api/generated-images/case.png' }, { propAssetKey: 'R02', status: 'complete', imageUrl: '/api/generated-images/earbuds.png' }],
        storyboardBoardPlans: [{ segmentKey: 'SEG001', plan: { panelCount: 6, semanticDecision: { visibleProps: [{ propName: '充电盒', state: '打开' }, { propName: '耳机', state: '升起' }] }, panels: [], referenceRequirements: { characters: [], sceneRequired: false, props: [{ propName: '充电盒', state: 'dormant' }], decisionBasis: ['已准备产品参考'] } } }],
        storyboardBoardPrompts: [{ segmentKey: 'SEG001', title: '黑场显形', prompt: '参考图：充电盒\n分镜来源：SEG001「黑场显形」' }],
        storyboardBoards: [{ segmentKey: 'SEG001', status: 'complete', imageUrl: '/api/generated-images/legacy-board.png' }],
        videoPrompts: [{ segmentKey: 'SEG001', status: 'complete', prompt: '参考输入：SEG001整张undefined宫格\n基础设定', referenceLabels: ['SEG001整张undefined宫格'], referenceImageUrls: ['/api/generated-images/legacy-board.png'], repairSourcePrompt: '参考输入：SEG001整张undefined宫格' }],
      },
    });
    assert.equal(saved.state.storyboardBoardPanelCount, 3);
    assert.equal(saved.state.storyboardBoardError, '当前项目已切换为3宫格；请重新准备3格规划。');
    assert.equal(saved.state.storyboardBoardPlans.length, 1);
    assert.deepEqual(saved.state.storyboardBoardPlans[0].plan.referenceRequirements.props, [{ propName: '充电盒', state: 'dormant' }, { propName: '耳机', state: 'dormant' }]);
    assert.match(saved.state.storyboardBoardPrompts[0].prompt, /^参考图：充电盒、耳机$/mu);
    assert.match(saved.state.videoPrompts[0].prompt, /SEG001整张6宫格/u);
    assert.deepEqual(saved.state.videoPrompts[0].referenceLabels, ['SEG001整张6宫格']);
    assert.match(saved.state.videoPrompts[0].repairSourcePrompt, /SEG001整张6宫格/u);
    assert.doesNotMatch(JSON.stringify(saved.state.videoPrompts[0]), /undefined(?:宫格|格)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session reclassifies stored semantic video feedback without another Agent call', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-session-video-autonomy-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const saved = store.save({
      state: {
        step: 'workspace',
        storyboardSegments: [{ segmentKey: 'SEG001' }],
        videoPromptStatus: 'failed',
        videoPromptError: '旧的语义校验失败',
        videoPrompts: [{
          segmentKey: 'SEG001',
          status: 'needs_revision',
          prompt: '已由 Agent 完成的视频提示词',
          plan: { videoPromptSections: {} },
          validationCodes: ['timeline beat 2 must name action owner 年轻女性'],
          validationIssues: ['第2个时间段没有明确写出动作执行者“年轻女性”'],
          error: '旧错误',
        }],
      },
    });
    assert.equal(saved.state.videoPromptStatus, 'complete');
    assert.equal(saved.state.videoPromptError, '');
    assert.equal(saved.state.videoPrompts[0].status, 'complete');
    assert.deepEqual(saved.state.videoPrompts[0].validationWarningCodes, []);
    assert.deepEqual(saved.state.videoPrompts[0].validationWarnings, []);
    assert.equal(saved.state.videoPrompts[0].error, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creative session clears the obsolete scene-count slot failure without submitting work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-session-storyboard-slot-migration-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const saved = store.save({
      state: {
        step: 'workspace',
        storyboardSegmentDurationSec: 15,
        storyboardStatus: 'failed',
        storyboardError: '文字Agent本轮处理失败，现有问答已保留，可以重新请求。',
        storyboardSegments: [],
        ideaScript: {
          title: '六场广告', durationSec: 60,
          scenes: Array.from({ length: 6 }, (_, index) => ({ id: `S${index + 1}`, location: `地点${index + 1}`, time: '白天', summary: `场次${index + 1}` })),
        },
      },
    });
    assert.equal(saved.state.storyboardStatus, 'idle');
    assert.equal(saved.state.storyboardError, '');
    assert.deepEqual(saved.state.storyboardSegments, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('generation mutation routes use the saved workflow as an authoritative dependency guard', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-workflow-guard-'));
  const filePath = join(directory, 'session.json');
  try {
    const store = createCreativeSessionStore({ filePath });
    const incomplete = store.save({ state: { step: 'workspace' } });
    assert.equal(WORKFLOW_STAGE_BY_MUTATION_ROUTE['/api/characters/profiles'], 'character-profiles');
    assert.equal(WORKFLOW_STAGE_BY_MUTATION_ROUTE['/api/characters/revise-design'], 'character-images');
    assert.equal(WORKFLOW_STAGE_BY_MUTATION_ROUTE['/api/props/revise-design'], 'props');
    assert.equal(WORKFLOW_STAGE_BY_MUTATION_ROUTE['/api/videos/prompts/repair'], 'video-prompts');
    assert.throws(
      () => requireWorkflowDependenciesForRoute(incomplete, '/api/characters/profiles'),
      (error) => error instanceof WorkflowDependencyError
        && error.code === 'workflow_dependencies_unresolved'
        && error.dependencies.includes('script')
        && structuredInputError(error).issues[0].suggestionZh.includes('成功内容不会被删除'),
    );
    assert.equal(requireWorkflowDependenciesForRoute(incomplete, '/api/scenes/views'), 'scene-views');

    const ready = store.save({
      expectedRevision: incomplete.revision,
      state: { step: 'workspace', ideaScript: { title: '已批准剧本' }, scriptApproval: 'approved' },
    });
    assert.equal(requireWorkflowDependenciesForRoute(ready, '/api/characters/profiles'), 'character-profiles');
    assert.equal(requireWorkflowDependenciesForRoute(ready, '/api/free-canvas/generate-image'), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scene validation failures expose safe rejected fields and request diagnostics', () => {
  const error = new SceneAssetPromptValidationError([
    'scene proposals must cover every script scene exactly once and in order',
    'proposal L01 sourceFacts evidenceId E-S02-404 is not in the evidence catalog',
    'proposal L01 fixedLandmarks must contain at least three items',
  ]);
  Object.defineProperty(error, 'diagnostics', {
    enumerable: false,
    value: {
      externalTaskId: 'scene-response-safe-789', elapsedMs: 12_345,
      usage: { inputTokens: 800, outputTokens: 1200 },
      invalidDraft: { privateStoryText: 'private model draft' },
    },
  });

  const message = safeSceneAgentMessage(error);

  assert.match(message, /文字结果已经返回/);
  assert.match(message, /场次覆盖与顺序/);
  assert.match(message, /剧本证据/);
  assert.match(message, /固定地标/);
  assert.match(message, /3项问题/);
  assert.match(message, /scene-response-safe-789/);
  assert.match(message, /12\.3秒/);
  assert.match(message, /输入800、输出1200/);
  assert.doesNotMatch(message, /private model draft|privateStoryText|E-S02-404/);
  assert.match(message, /没有自动重试/);
});

test('scene state-variant diagnostics distinguish invalid placement from wrong-scene evidence', () => {
  const messages = localizeStructuredAgentValidationIssues('场景视觉提案', [
    'prompt 1 has an invalid state variant',
    'prompt 2 selected invalid state-variant evidence IDs',
  ]);
  assert.match(messages[0], /基础场次、重复场次或未绑定场次/u);
  assert.match(messages[1], /其他场次或不存在的证据/u);
});

test('scene provider failures retain the existing specific provider diagnosis', () => {
  const message = safeSceneAgentMessage(new OpenAIResponsesProviderError('rate limited', {
    status: 429,
    code: 'rate_limited',
    diagnostics: { externalTaskId: 'scene-rate-limit-1' },
  }));

  assert.match(message, /限流或额度不足/);
  assert.match(message, /rate_limited/);
  assert.match(message, /scene-rate-limit-1/);
});

test('prop validation failures expose safe rejected fields and request diagnostics', () => {
  const error = new PropAssetPromptValidationError([
    'proposal 1 must use R01',
    'prompt 1 selected invalid source evidence',
    'proposal 1 has an invalid state variant',
    'proposal 1 has an incomplete visual design proposal',
  ]);
  Object.defineProperty(error, 'diagnostics', {
    enumerable: false,
    value: {
      externalTaskId: 'prop-response-safe-321', elapsedMs: 8_765,
      usage: { inputTokens: 700, outputTokens: 900 },
      invalidDraft: { privateStoryText: 'private prop draft', evidenceId: 'E-S03-404' },
    },
  });

  const message = safePropAgentMessage(error);

  assert.match(message, /文字结果已经返回/);
  assert.match(message, /编号与道具身份/);
  assert.match(message, /剧本证据/);
  assert.match(message, /剧情状态变化/);
  assert.match(message, /视觉提案字段/);
  assert.match(message, /4项问题/);
  assert.match(message, /prop-response-safe-321/);
  assert.match(message, /8\.8秒/);
  assert.match(message, /输入700、输出900/);
  assert.doesNotMatch(message, /private prop draft|privateStoryText|E-S03-404/);
  assert.match(message, /没有自动重试/);
});

test('prop provider failures retain the existing specific provider diagnosis', () => {
  const message = safePropAgentMessage(new OpenAIResponsesProviderError('rate limited', {
    status: 429,
    code: 'rate_limited',
    diagnostics: { externalTaskId: 'prop-rate-limit-1' },
  }));

  assert.match(message, /限流或额度不足/);
  assert.match(message, /rate_limited/);
  assert.match(message, /prop-rate-limit-1/);
});

test('scene reasoning-only responses report the missing final body without exposing private reasoning', () => {
  const message = safeSceneAgentMessage(new OpenAIResponsesProviderError('Responses API result did not contain output text.', {
    status: 200,
    code: 'missing_output_text',
    diagnostics: {
      responseStatus: 'completed',
      externalTaskId: 'scene-reasoning-only-1',
      rawOutputText: 'private reasoning trace',
      outputItemSummary: [{ type: 'reasoning', contentTypes: ['reasoning_text'] }],
    },
  }));

  assert.match(message, /成功状态/);
  assert.match(message, /没有可读取的正文/);
  assert.match(message, /missing_output_text/);
  assert.match(message, /reasoning\(reasoning_text\)/);
  assert.match(message, /scene-reasoning-only-1/);
  assert.doesNotMatch(message, /private reasoning trace/);
  assert.match(message, /没有自动重试/);
});

test('scene structured-output failures explain that returned text could not be adapted', () => {
  const error = new OpenAIResponsesProviderError('Structured response could not be parsed.', {
    status: 200,
    code: 'invalid_structured_output',
    diagnostics: {
      responseStatus: 'completed',
      externalTaskId: 'scene-structured-safe-1',
      rawOutputText: 'private scene draft',
      outputItemSummary: [
        { type: 'reasoning', contentTypes: ['reasoning_text'] },
        { type: 'message', contentTypes: ['output_text'] },
      ],
    },
  });
  const message = safeSceneAgentMessage(error);
  const structured = structuredInputError(error);

  assert.match(message, /已经返回正文/);
  assert.match(message, /场景提案所需的结构字段/);
  assert.match(message, /输出适配失败/);
  assert.match(message, /不是用户的创作需求有问题/);
  assert.match(message, /completed/);
  assert.match(message, /message\(output_text\)/);
  assert.match(message, /scene-structured-safe-1/);
  assert.doesNotMatch(message, /private scene draft/);
  assert.match(message, /没有自动重试/);
  assert.equal(structured.returnedDraft, 'private scene draft');
  assert.deepEqual(structured.validationIssues, ['Agent最终正文不是有效的JSON结构，系统无法读取所需字段。']);
});

test('storyboard planning validation failures are distinguished from token and image failures', () => {
  const message = safeIdeaAgentMessage(new Error('Storyboard board batch SEG004 validation failed: plan.panels must be an array; plan.referenceRequirements is invalid; private model draft'));

  assert.match(message, /已经返回SEG004的故事板规划/);
  assert.match(message, /画格列表或画格数量/);
  assert.match(message, /参考资产要求/);
  assert.match(message, /本地结构校验/);
  assert.match(message, /问题位于故事板规划阶段/);
  assert.doesNotMatch(message, /private model draft/);
  assert.match(message, /没有自动重试/);
});

test('storyboard segment validation failures retain safe field and response diagnostics', () => {
  const message = safeStoryboardAgentMessage(new StoryboardPromptValidationError([
    'segments must contain exactly 6 items',
    'segment 2 must match SEG002 plan',
    'SEG003 must preserve dialogue D-S02-1 verbatim',
    'SEG006 final transition must match script',
  ], {
    externalTaskId: 'storyboard-response-safe-654',
    elapsedMs: 12_300,
    usage: { inputTokens: 1_200, outputTokens: 2_100 },
    draft: { privateStoryText: 'private storyboard draft' },
  }));

  assert.match(message, /分段数量/);
  assert.match(message, /分段顺序、场次或时长/);
  assert.match(message, /对白逐字保留与说话人/);
  assert.match(message, /场末转场/);
  assert.match(message, /4项问题/);
  assert.match(message, /storyboard-response-safe-654/);
  assert.match(message, /12\.3秒/);
  assert.match(message, /输入1200、输出2100/);
  assert.doesNotMatch(message, /private storyboard draft|privateStoryText|D-S02-1/);
  assert.match(message, /可点击修复继续处理/);
  assert.match(message, /不会启动图片或视频生成/);
});

test('storyboard local planning failures explain the pre-provider cause', () => {
  const message = safeStoryboardAgentMessage(new Error('Fixed storyboard slots must be at least the number of script scenes.'));

  assert.match(message, /分镜段少于剧本场次数/u);
  assert.match(message, /没有调用文字模型/u);
  assert.doesNotMatch(message, /文字Agent本轮处理失败/u);
});

test('storyboard provider failures retain the existing specific provider diagnosis', () => {
  const message = safeStoryboardAgentMessage(new OpenAIResponsesProviderError('timed out', {
    status: 200,
    code: 'response_body_timeout',
    diagnostics: { externalTaskId: 'storyboard-timeout-987' },
  }));

  assert.match(message, /读取正文超过/);
  assert.match(message, /response_body_timeout/);
  assert.match(message, /storyboard-timeout-987/);
});

test('video prompt validation failures name the rejected production fields', () => {
  const message = safeIdeaAgentMessage(new Error('Segment video prompt validation failed: character reference requirements mismatch semantic decision; sound policy must not contain timed events; silent video positive prompt must not contain quoted or slogan-like text'));
  assert.match(message, /人物参考/);
  assert.match(message, /声音总则/);
  assert.match(message, /引号、宣传语或可朗读总结/);
  assert.match(message, /没有自动重试/);
  assert.doesNotMatch(message, /semantic decision/);
});

test('unknown text agent failures retain a bounded actionable cause', () => {
  const message = safeIdeaAgentMessage(new TypeError('Cannot read properties of undefined (reading videoPromptSections)'));
  assert.match(message, /TypeError/u);
  assert.match(message, /videoPromptSections/u);
  assert.match(message, /现有内容已保留/u);
  assert.match(message, /没有自动重试/u);
});

test('response body timeouts have a specific safe message', () => {
  const message = safeIdeaAgentMessage(new OpenAIResponsesProviderError('The operation was aborted due to timeout', {
    status: 200,
    code: 'response_body_timeout',
  }));

  assert.match(message, /已建立响应/);
  assert.match(message, /读取正文超过/);
  assert.match(message, /response_body_timeout/);
  assert.match(message, /没有自动重试/);
});

test('ordered worker helper honors its supplied bound and preserves order', async () => {
  let active = 0;
  let maximumActive = 0;
  const completed = await mapWithConcurrencyOrdered(['SEG001', 'SEG002', 'SEG003', 'SEG004', 'SEG005', 'SEG006'], 2, async (segmentKey, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, (6 - index) * 2));
    active -= 1;
    return segmentKey;
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(completed, ['SEG001', 'SEG002', 'SEG003', 'SEG004', 'SEG005', 'SEG006']);
});

test('video prompt batches use two workers with one segment per request', () => {
  assert.equal(VIDEO_PROMPT_BATCH_SIZE, 1);
  assert.equal(VIDEO_PROMPT_CONCURRENCY, 2);
  assert.equal(VIDEO_PROMPT_REPAIR_CONCURRENCY, 2);
});

test('video prompt review jobs use at most two workers and preserve segment order', async () => {
  let active = 0;
  let maximumActive = 0;
  const completed = await mapWithConcurrencyOrdered(
    ['SEG001', 'SEG002', 'SEG003', 'SEG004', 'SEG005', 'SEG006'],
    VIDEO_PROMPT_REPAIR_CONCURRENCY,
    async (segmentKey, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, (6 - index) * 2));
      active -= 1;
      return segmentKey;
    },
  );
  assert.equal(maximumActive, 2);
  assert.deepEqual(completed, ['SEG001', 'SEG002', 'SEG003', 'SEG004', 'SEG005', 'SEG006']);
});

test('creative session survives store recreation and contains no provider credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-creative-session-'));
  const filePath = join(directory, 'session.json');
  const state = {
    step: 'idea-questions', creationSource: 'idea', workType: 'series', creativeDirection: 'knowledge', novelText: '', novelName: '', splitPrepared: false,
    duration: '90秒', customDurationSec: '120', episodeCountMode: 'fixed', episodeCount: '8', ratio: '9:16', language: '中文', emotion: '悬疑', customEmotion: '', activeStage: '剧本',
    ideaText: '末日列车上的女孩发现时间正在倒流。',
    ideaAnswers: [{ question: '你更想看哪类冲突？', answer: '人物关系与生存选择' }],
    ideaAnswer: '', ideaQuestion: '结局更接近希望还是代价？',
    ideaOptions: [{ id: 'hope', label: '微光', description: '付出代价后仍留下希望' }], ideaScript: null,
    agentTranscript: [
      { id: 'turn-source', role: 'user', kind: 'source', text: '末日列车上的女孩发现时间正在倒流。', createdAt: '2026-08-28T00:00:00.000Z' },
      { id: 'turn-question', role: 'assistant', kind: 'question', text: '你更想看哪类冲突？', options: [{ id: 'survival', label: '生存选择', description: '关系在危机中发生变化' }, { id: 'mystery', label: '时间谜题', description: '追查倒流的真实原因' }], createdAt: '2026-08-28T00:00:01.000Z' },
      { id: 'turn-answer', role: 'user', kind: 'answer', text: '生存选择：关系在危机中发生变化', selectedOptionId: 'survival', selectedOptionIds: ['survival'], createdAt: '2026-08-28T00:00:02.000Z' },
      { id: 'turn-action', role: 'user', kind: 'action', text: '提交文字分镜：每段 5 秒', createdAt: '2026-08-28T00:00:03.000Z' },
      { id: 'turn-event', role: 'assistant', kind: 'event', text: '文字分镜没有完成：读取正文超时', createdAt: '2026-08-28T00:00:04.000Z' },
    ],
    episodeScripts: [{ scriptKey: 'EP002', episodeNumber: 2, version: 3, status: 'failed', approval: 'draft', script: { title: '第二集旧稿', episodeNumber: 2, scenes: [] }, error: '新版本失败，旧稿保留。' }],
    characterApproval: 'approved', selectedStyleId: '3d-fantasy', characterImageStatus: 'failed',
    characterImages: [{ profileKey: 'C01', name: '阿岚', status: 'complete', imageUrl: '/api/generated-images/a.png' }], characterImageError: '第二个角色未完成',
    characterImagePrompts: [{ profileKey: 'C01', name: '阿岚', styleId: '3d-fantasy', prompt: '高品质东方玄幻三维动画电影风格，写实比例与风格化角色塑造兼容，精细角色建模，真实布料和金属材质，电影级体积光，冷暖层次清晰，克制而精致的能量特效。\n使用Oii式人物主资产图。' }],
    characterAssetsApproval: 'approved',
    characterTurnarounds: [{ profileKey: 'C01', name: '阿岚', status: 'complete', imageUrl: '/api/generated-images/a-turnaround.png' }],
    propStatus: 'complete', propProposals: [{ propAssetKey: 'R01', name: '罗盘' }], propError: '', propProposalApproval: 'approved',
    propImageStatus: 'complete', propImagePrompts: [{ propAssetKey: 'R01', name: '罗盘', styleId: '3d-fantasy', prompt: '五段式道具提示词' }], propImages: [{ propAssetKey: 'R01', name: '罗盘', status: 'complete', imageUrl: '/api/generated-images/compass.png' }], propImageError: '', propAssetsApproval: 'approved',
    videoPromptStatus: 'complete', videoPrompts: [{ segmentKey: 'SEG001', title: '密林穿行', durationSec: 15, status: 'complete', prompt: '参考输入：SEG001整张六宫格\n建议时长：15秒\n\n基础设定\n密林穿行。', referenceLabels: ['SEG001整张六宫格'], referenceImageUrls: ['/api/generated-images/board.png'] }], videoPromptError: '', videoPromptsApproval: 'draft',
    h3GenerationSettings: { mode: 'reference', qualityPreset: 'balanced', resolution: '480p', inferenceSteps: 10, accelerationModel: 'none', spectrum: true, sage: true, randomSeed: false, seed: 99 },
    shotVideoTasks: [
      { segmentKey: 'SEG001', status: 'running', externalTaskId: 'prompt-abc', outputPaths: [], parameters: { automaticRetry: false }, updatedAt: '2026-08-23T00:00:00.000Z' },
      { segmentKey: 'SEG002', status: 'waiting_dependency', outputPaths: [], parameters: {}, submissionIntent: { continuityMode: 'continue', sourceSegmentKey: 'SEG001', settings: { mode: 'reference', qualityPreset: 'fast', resolution: '480p', inferenceSteps: 6, accelerationModel: 'turbo4', spectrum: false, sage: true, seed: 123 }, queuedAt: '2026-08-23T00:01:00.000Z' }, updatedAt: '2026-08-23T00:01:00.000Z' },
    ], shotVideosApproval: 'draft',
    canvasView: { x: -160, y: 84, zoom: 0.72, nodes: { brief: { x: 80, y: 40 }, script: { x: 560, y: 120 }, asset: { x: 920, y: 90 }, 'character-C01': { x: 1200, y: 180 } } },
    canvasMode: 'free',
    freeCanvas: { view: { x: 25, y: -40, zoom: 0.5 }, preferences: { showConnections: false, showMiniMap: true, snapToGrid: true }, mediaHistory: [
      { id: 'history-audio-1', kind: 'audio', title: '旧配乐', mediaUrl: '/api/postproduction/music-media/old.wav', prompt: '舒缓配乐', provider: 'acestep-1.5', createdAt: '2026-08-25T00:01:00.000Z' },
    ], nodes: [
      { id: 'free-1', kind: 'image', title: '角色参考', content: '试验副本', x: 30, y: 60, mediaUrl: '/api/generated-images/b.png', mediaUrls: ['/api/generated-images/b.png', '/api/generated-images/a.png'], imageSettings: { width: 1536, height: 1024, quality: 'high', count: 2, outputFormat: 'png' }, generation: { status: 'complete', taskId: 'free-image-task-1', provider: 'fixture', updatedAt: '2026-08-26T00:02:00.000Z' }, libraryAssetRef: { assetId: 'asset-free-1', name: '角色参考', version: 3 }, sourceRef: { type: 'character', stableId: 'C01', label: '阿岚', version: 2 }, createdAt: '2026-08-26T00:00:00.000Z' },
      { id: 'free-2', kind: 'text', title: '镜头想法', content: '低机位推进', textOptimizationTarget: 'video', x: 430, y: 100, createdAt: '2026-08-26T00:01:00.000Z' },
      { id: 'free-3', kind: 'video', title: '镜头生成', content: '五段式视频提示词', x: 760, y: 100, videoSettings: { aspectRatio: '9:16', resolution: '720p', durationSec: 12, qualityPreset: 'custom', inferenceSteps: 18, accelerationModel: 'lightx2v-768p-v1', spectrum: false, sage: true }, generation: { status: 'running', taskId: 'free-video-task-1', provider: 'prism-h3', externalTaskId: 'prompt-free-abc', outputPaths: ['E:\\outputs\\pending.mp4'], updatedAt: '2026-08-26T00:03:00.000Z' }, createdAt: '2026-08-26T00:02:00.000Z' },
      { id: 'free-4', kind: 'video', title: '已完成镜头', content: '结果回写', x: 1060, y: 100, mediaUrl: '   ', generation: { status: 'complete', taskId: 'free-video-task-2', provider: 'prism-h3', externalTaskId: 'prompt-free-done', outputPaths: ['E:\\outputs\\done.mp4'], updatedAt: '2026-08-26T00:04:00.000Z' }, createdAt: '2026-08-26T00:03:00.000Z' },
    ], edges: [{ id: 'edge-1', fromNodeId: 'free-1', toNodeId: 'free-2' }, { id: 'bad-edge', fromNodeId: 'missing', toNodeId: 'free-2' }] },
    editor: { clips: [], audioClips: [{ id: 'audio-1', assetId: 'free:history-audio-1', title: '旧配乐', mediaUrl: '/api/postproduction/music-media/old.wav', sourceInSec: 1, sourceOutSec: 9.5, timelineStartSec: 0.75, volume: 0.4, fadeInSec: 0.2, fadeOutSec: 0.3 }] },
  };

  createCreativeSessionStore({ filePath }).save({ state });
  const restored = createCreativeSessionStore({ filePath }).load();

  assert.equal(restored.state.ideaAnswers[0].answer, '人物关系与生存选择');
  assert.equal(restored.state.ideaQuestion, '结局更接近希望还是代价？');
  assert.equal(restored.state.agentTranscript[0].text, '末日列车上的女孩发现时间正在倒流。');
  assert.equal(restored.state.agentTranscript[1].options.length, 1);
  assert.equal(restored.state.agentTranscript[1].options[0].id, 'survival');
  assert.equal(restored.state.agentTranscript[2].selectedOptionId, 'survival');
  assert.deepEqual(restored.state.agentTranscript[2].selectedOptionIds, ['survival']);
  assert.equal(restored.state.agentTranscript[3].kind, 'action');
  assert.equal(restored.state.agentTranscript[4].kind, 'event');
  assert.equal(restored.state.workType, 'series');
  assert.equal(restored.state.creativeDirection, 'knowledge');
  assert.equal(restored.state.episodeCount, '8');
  assert.equal(restored.state.freeCanvas.nodes.find((node) => node.id === 'free-2').textOptimizationTarget, 'video');
  assert.equal(restored.state.scriptApproval, 'draft');
  assert.equal(restored.state.episodeScripts[0].scriptKey, 'EP002');
  assert.equal(restored.state.episodeScripts[0].version, 3);
  assert.equal(restored.state.episodeScripts[0].script.title, '第二集旧稿');
  assert.equal(restored.state.characterApproval, 'approved');
  assert.equal(restored.state.selectedStyleId, '3d-fantasy');
  assert.equal(restored.state.characterImages[0].profileKey, 'C01');
  assert.equal(restored.state.characterImagePrompts[0].styleId, '3d-fantasy');
  assert.match(restored.state.characterImagePrompts[0].prompt, /影视级写实CG画风/);
  assert.doesNotMatch(restored.state.characterImagePrompts[0].prompt, /oii/i);
  assert.equal(restored.state.characterAssetsApproval, 'approved');
  assert.equal(restored.state.characterTurnarounds[0].status, 'complete');
  assert.equal(restored.state.propProposalApproval, 'approved');
  assert.equal(restored.state.propImagePrompts[0].propAssetKey, 'R01');
  assert.equal(restored.state.propImages[0].imageUrl, '/api/generated-images/compass.png');
  assert.equal(restored.state.propAssetsApproval, 'approved');
  assert.equal(restored.state.videoPromptStatus, 'complete');
  assert.equal(restored.state.videoPrompts[0].segmentKey, 'SEG001');
  assert.equal(restored.state.videoPromptsApproval, 'draft');
  assert.equal(restored.state.h3GenerationSettings.qualityPreset, 'balanced');
  assert.equal(restored.state.h3GenerationSettings.randomSeed, false);
  assert.equal(restored.state.shotVideoTasks[0].externalTaskId, 'prompt-abc');
  assert.equal(restored.state.shotVideoTasks[0].parameters.automaticRetry, false);
  assert.equal(restored.state.shotVideoTasks[1].status, 'waiting_dependency');
  assert.equal(restored.state.shotVideoTasks[1].submissionIntent.sourceSegmentKey, 'SEG001');
  assert.equal(restored.state.shotVideoTasks[1].submissionIntent.settings.qualityPreset, 'fast');
  assert.equal(restored.state.shotVideoTasks[1].submissionIntent.settings.randomSeed, true);
  assert.equal(restored.state.shotVideosApproval, 'draft');
  assert.deepEqual(restored.state.canvasView, state.canvasView);
  assert.equal(restored.state.canvasMode, 'free');
  assert.equal(restored.state.freeCanvas.nodes.length, 4);
  assert.equal(restored.state.freeCanvas.nodes[0].sourceRef.stableId, 'C01');
  assert.deepEqual(restored.state.freeCanvas.nodes[0].mediaUrls, ['/api/generated-images/b.png', '/api/generated-images/a.png']);
  assert.equal(restored.state.freeCanvas.nodes[0].imageSettings.count, 2);
  assert.equal(restored.state.freeCanvas.nodes[0].imageSettings.resolution, '1k');
  assert.equal(restored.state.freeCanvas.nodes[0].generation.taskId, 'free-image-task-1');
  assert.deepEqual(restored.state.freeCanvas.nodes[0].libraryAssetRef, { assetId: 'asset-free-1', name: '角色参考', version: 3 });
  assert.deepEqual(restored.state.freeCanvas.nodes[2].videoSettings, { mode: 'auto', aspectRatio: '9:16', resolution: '720p', durationSec: 12, qualityPreset: 'custom', inferenceSteps: 18, accelerationModel: 'lightx2v-768p-v1', spectrum: false, sage: true });
  assert.equal(restored.state.freeCanvas.nodes[2].generation.status, 'running');
  assert.equal(restored.state.freeCanvas.nodes[2].generation.externalTaskId, 'prompt-free-abc');
  assert.deepEqual(restored.state.freeCanvas.nodes[2].generation.outputPaths, ['E:\\outputs\\pending.mp4']);
  assert.equal(restored.state.freeCanvas.nodes[3].mediaUrl, '/api/h3/media/prompt-free-done');
  assert.deepEqual(restored.state.freeCanvas.edges, [{ id: 'edge-1', fromNodeId: 'free-1', toNodeId: 'free-2' }]);
  assert.deepEqual(restored.state.freeCanvas.preferences, { showConnections: false, showMiniMap: true, snapToGrid: true });
  assert.equal(restored.state.freeCanvas.mediaHistory.length, 4);
  assert.deepEqual(new Set(restored.state.freeCanvas.mediaHistory.map((item) => item.kind)), new Set(['image', 'video', 'audio']));
  assert.equal(restored.state.freeCanvas.mediaHistory.find((item) => item.id === 'history-audio-1').title, '旧配乐');
  assert.equal(restored.state.freeCanvas.mediaHistory.some((item) => item.mediaUrl === '/api/h3/media/prompt-free-done'), true);
  assert.deepEqual(restored.state.editor.audioClips[0], { id: 'audio-1', assetId: 'free:history-audio-1', title: '旧配乐', mediaUrl: '/api/postproduction/music-media/old.wav', sourceInSec: 1, sourceOutSec: 9.5, timelineStartSec: 0.75, volume: 0.4, fadeInSec: 0.2, fadeOutSec: 0.3 });
  assert.equal(readFileSync(filePath, 'utf8').includes('apiKey'), false);
});

test('creative session migrates removed draft style ids without discarding saved prompts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-style-migration-'));
  const store = createCreativeSessionStore({ filePath: join(directory, 'session.json') });
  const saved = store.save({ state: {
    step: 'workspace',
    selectedStyleId: 'modern-social-realism',
    characterImagePrompts: [{ profileKey: 'C01', styleId: 'modern-social-realism', prompt: '已保存人物提示词' }],
    sceneImagePrompts: [{ sceneAssetKey: 'S01', styleId: 'modern-social-realism', prompt: '已保存场景提示词' }],
    propImagePrompts: [{ propAssetKey: 'R01', styleId: 'modern-social-realism', prompt: '已保存道具提示词' }],
  } });
  assert.equal(saved.state.selectedStyleId, 'ancient-live-action');
  assert.equal(saved.state.characterImagePrompts[0].styleId, 'ancient-live-action');
  assert.equal(saved.state.characterImagePrompts[0].prompt, '已保存人物提示词');
  assert.equal(saved.state.sceneImagePrompts[0].styleId, 'ancient-live-action');
  assert.equal(saved.state.propImagePrompts[0].styleId, 'ancient-live-action');
  rmSync(directory, { recursive: true, force: true });
});

test('project manager preserves drafts and switches the active local project', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-project-manager-'));
  const filePath = join(directory, 'creative-session.json');
  const store = createCreativeSessionStore({ filePath });
  const baseState = {
    step: 'idea', creationSource: 'idea', workType: 'single', novelText: '', novelName: '', splitPrepared: false,
    duration: '60秒', customDurationSec: '120', episodeCountMode: 'agent', episodeCount: '8', ratio: '9:16', language: '中文', emotion: '紧张', customEmotion: '', activeStage: '总览',
    ideaText: '第一个本机项目创意内容。', ideaAnswers: [], ideaAnswer: '', ideaQuestion: '', ideaOptions: [], ideaScript: null,
  };
  const first = store.save({ state: baseState });
  const second = store.create({ state: { ...baseState, step: 'idea-script', ideaText: '第二个本机项目创意内容。', ideaScript: { title: '自动生成的标题' } } });

  assert.equal(store.list().length, 2);
  assert.equal(store.list().find((project) => project.id === second.id).active, true);
  const renamedCurrent = store.rename(second.id, '第二项目正式名称');
  assert.equal(renamedCurrent.active, true);
  assert.equal(store.load().state.projectName, '第二项目正式名称');
  assert.equal(store.load().state.ideaScript.title, '第二项目正式名称');
  assert.equal(store.list().find((project) => project.id === second.id).name, '第二项目正式名称');
  const renamedArchived = store.rename(first.id, '第一项目正式名称');
  assert.equal(renamedArchived.active, false);
  assert.equal(store.list().find((project) => project.id === first.id).name, '第一项目正式名称');
  store.select(first.id);
  assert.equal(store.load().id, first.id);
  assert.equal(store.load().state.ideaText, '第一个本机项目创意内容。');
  assert.equal(store.load().state.projectName, '第一项目正式名称');
  assert.throws(() => store.rename(first.id, '   '), /项目名不能为空/u);
});

test('asset library persists approved media and LoRA metadata across projects without loading models', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-asset-library-'));
  const filePath = join(directory, 'asset-library.json');
  const store = createAssetLibraryStore({ filePath });
  const firstProject = { id: '11111111-1111-4111-8111-111111111111', updatedAt: '2026-08-24T00:00:00.000Z', state: { ideaScript: { title: '项目甲' }, step: 'workspace', scriptApproval: 'approved' } };
  const secondProject = { id: '22222222-2222-4222-8222-222222222222', updatedAt: '2026-08-24T00:00:00.000Z', state: { ideaScript: { title: '项目乙' }, step: 'workspace', scriptApproval: 'approved' } };
  const character = store.add({ type: 'character', name: '阿岚', sourceAssetKey: 'C01', media: { mainImageUrl: '/api/generated-images/alan.png', auxiliaryImageUrl: '/api/generated-images/alan-turnaround.png' }, prompt: '人物资产提示词' }, firstProject);
  const lora = store.add({ type: 'lora', name: '电影光影LoRA', modelResource: { filePath: 'E:\\AI\\ComfyUI-H3\\models\\loras\\cinematic.safetensors', backend: 'PRISM H3 / ComfyUI', baseModel: 'H3', defaultStrength: 0.7 } }, firstProject);
  const usage = store.recordUsage({ assetId: character.id, targetType: 'character', targetKey: 'C02', targetName: '项目乙角色' }, secondProject);
  const restored = createAssetLibraryStore({ filePath }).list();

  assert.equal(restored.length, 2);
  assert.equal(restored.find((item) => item.id === character.id).media.auxiliaryImageUrl, '/api/generated-images/alan-turnaround.png');
  assert.equal(usage.usages[0].projectName, '项目乙');
  assert.equal(lora.modelResource.integrationStatus, 'registered_only');
  assert.throws(() => store.recordUsage({ assetId: lora.id, targetType: 'lora', targetKey: 'h3' }, secondProject), /只登记/);
  assert.equal(readFileSync(filePath, 'utf8').includes('apiKey'), false);
});

test('shared asset library persists free-canvas text, image, video and audio assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-free-canvas-assets-'));
  const filePath = join(directory, 'asset-library.json');
  const store = createAssetLibraryStore({ filePath });
  const project = { id: '55555555-5555-4555-8555-555555555555', updatedAt: '2026-08-27T00:00:00.000Z', state: { ideaScript: { title: '自由画布项目' }, step: 'workspace', scriptApproval: 'approved' } };
  const textAsset = store.add({ type: 'text', name: '镜头意图', sourceAssetKey: 'node-text', content: '主角从雨中走进室内。' }, project);
  const imageAsset = store.add({ type: 'image', name: '参考图', sourceAssetKey: 'node-image', media: { mainImageUrl: '/api/free-canvas/imported-media/image.png' } }, project);
  const videoAsset = store.add({ type: 'video', name: '参考视频', sourceAssetKey: 'node-video', media: { videoUrl: '/api/h3/media/video-task' } }, project);
  const audioAsset = store.add({ type: 'audio', name: '配乐', sourceAssetKey: 'node-audio', media: { audioUrl: '/api/postproduction/music-media/music.wav' } }, project);
  const restored = createAssetLibraryStore({ filePath }).list();

  assert.equal(restored.length, 4);
  assert.equal(restored.find((item) => item.id === textAsset.id).content, '主角从雨中走进室内。');
  assert.equal(restored.find((item) => item.id === imageAsset.id).media.mainImageUrl, '/api/free-canvas/imported-media/image.png');
  assert.equal(restored.find((item) => item.id === videoAsset.id).media.videoUrl, '/api/h3/media/video-task');
  assert.equal(restored.find((item) => item.id === audioAsset.id).media.audioUrl, '/api/postproduction/music-media/music.wav');
  assert.throws(() => store.add({ type: 'video', name: '空视频' }, project), /必须包含可用媒体/);
});

test('asset library folders, favorites, editable references and removal persist locally', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-managed-assets-'));
  const filePath = join(directory, 'asset-library.json');
  const store = createAssetLibraryStore({ filePath });
  const project = { id: '66666666-6666-4666-8666-666666666666', updatedAt: '2026-08-29T00:00:00.000Z', state: { ideaScript: { title: '资产管理项目' }, step: 'workspace', scriptApproval: 'approved' } };
  const character = store.add({ type: 'character', name: '小宝', folder: '主要角色', favorite: true, media: { mainImageUrl: '/uploads/xiaobao-main.png', referenceImageUrls: ['/uploads/xiaobao-main.png', '/uploads/xiaobao-side.png'] } }, project);

  assert.deepEqual(store.listFolders(), ['主要角色']);
  assert.equal(character.favorite, true);
  assert.deepEqual(character.media.referenceImageUrls, ['/uploads/xiaobao-main.png', '/uploads/xiaobao-side.png']);

  store.addFolder({ name: '客户角色' });
  const updated = store.update({ id: character.id, patch: { name: '小宝·上学造型', folder: '客户角色', favorite: false, description: '用户上传的人物参考。', media: { mainImageUrl: '/uploads/xiaobao-side.png', auxiliaryImageUrl: '/uploads/xiaobao-main.png', referenceImageUrls: ['/uploads/xiaobao-side.png', '/uploads/xiaobao-main.png'] } } });
  assert.equal(updated.name, '小宝·上学造型');
  assert.equal(updated.folder, '客户角色');
  assert.equal(updated.favorite, false);
  assert.equal(updated.media.mainImageUrl, '/uploads/xiaobao-side.png');

  store.renameFolder({ currentName: '客户角色', nextName: '已确认人物' });
  assert.equal(store.list().find((asset) => asset.id === character.id).folder, '已确认人物');
  store.removeFolder({ name: '已确认人物' });
  assert.equal(store.list().find((asset) => asset.id === character.id).folder, '');
  assert.equal(store.remove({ id: character.id }).id, character.id);
  assert.equal(store.list().length, 0);
});

test('asset library preserves every supplied reference image', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-asset-many-references-'));
  const filePath = join(directory, 'asset-library.json');
  const store = createAssetLibraryStore({ filePath });
  const project = { id: '77777777-7777-4777-8777-777777777777', updatedAt: '2026-09-04T00:00:00.000Z', state: { ideaScript: { title: '多参考项目' }, step: 'workspace', scriptApproval: 'approved' } };
  const references = Array.from({ length: 12 }, (_, index) => `/uploads/reference-${index + 1}.png`);

  store.add({ type: 'character', name: '多参考角色', media: { mainImageUrl: references[0], referenceImageUrls: references } }, project);
  const restored = createAssetLibraryStore({ filePath }).list()[0];

  assert.deepEqual(restored.media.referenceImageUrls, references);
});

test('asset replacement undo keeps a persistent whole-project snapshot and consumes it once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prism-asset-undo-'));
  const store = createAssetReplacementUndoStore({ filePath: join(directory, 'asset-library-undo.json') });
  const session = {
    schemaVersion: 1,
    id: '33333333-3333-4333-8333-333333333333',
    updatedAt: '2026-08-26T00:00:00.000Z',
    state: { step: 'workspace', ideaText: '替换前', characterImages: [{ profileKey: 'C01', name: '林然', status: 'complete', imageUrl: '/before.png' }], characterAssetsApproval: 'approved', storyboardAssetsApproval: 'approved' },
  };
  const undo = store.create({ assetId: 'asset-1', assetName: '男人', targetType: 'character', targetKey: 'C01', targetName: '林然' }, session);

  assert.equal(store.latest(session).id, undo.id);
  assert.equal(store.get({ undoId: undo.id }, session).session.state.characterImages[0].imageUrl, '/before.png');
  assert.equal(store.get({ undoId: undo.id }, session).session.state.storyboardAssetsApproval, 'approved');
  assert.throws(() => store.get({ undoId: undo.id }, { ...session, id: '44444444-4444-4444-8444-444444444444' }), /不属于当前项目/);
  store.markRestored(undo.id);
  assert.equal(store.latest(session), null);
  assert.throws(() => store.get({ undoId: undo.id }, session), /已经撤回/);
});

test('single novel adaptation makes exactly one high-reasoning text request', async () => {
  let calls = 0;
  let receivedProfile;
  let receivedRequest;
  const script = {
    title: '雨夜来信', logline: '一封迟到的信改变两个人的选择。', genre: '剧情',
    durationSec: 60, ratio: '16:9', language: '中文', emotion: '使命', workType: 'single',
    plannedEpisodeCount: 1, episodeNumber: 1, seriesPlan: [],
    characters: [{ name: '阿岚', role: '信使', goal: '在天亮前送达信件' }],
    scenes: [{ id: 'scene-1', location: '旧街', time: '雨夜', summary: '阿岚奔向终点', beats: ['阿岚护住信件奔跑'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '阿岚护住信件奔跑。' }] }],
    endingHook: '信封背面浮出另一个名字。',
  };
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      receivedProfile = profile;
      return {
        id: 'fake-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          calls += 1;
          receivedRequest = request;
          return { output: script, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });

  const result = await store.runNovelAdaptation({
    novelText: '雨水沿着旧街屋檐落下。阿岚把信藏进怀里，朝街尾亮着灯的门奔去。',
    sourceName: '雨夜来信.txt',
    production: { workType: 'single', durationSec: 60, episodeCountMode: 'agent', episodeCount: null, ratio: '16:9', language: '中文', emotion: '使命' },
  });

  assert.equal(calls, 1);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 32_000 });
  assert.equal(receivedRequest.operation, 'adapt-novel-to-single-short-video');
  assert.equal(receivedRequest.maxOutputTokens, 32_000);
  assert.equal(result.title, '雨夜来信');
});

test('novel series planning makes one high-reasoning request and returns a complete plan', async () => {
  let calls = 0;
  let receivedProfile;
  let receivedRequest;
  const script = {
    title: '雨夜余烬', logline: '旧友沿着一封来信追查事故真相。', genre: '剧情悬疑',
    durationSec: 90, ratio: '16:9', language: '中文', emotion: '悲壮', workType: 'series',
    plannedEpisodeCount: 3, episodeNumber: 1,
    seriesPlan: [
      { episodeNumber: 1, title: '来信', summary: '林舟收到失踪旧友的来信。', hook: '信纸背面出现当天日期。' },
      { episodeNumber: 2, title: '旧桥', summary: '众人回到事故发生的旧桥。', hook: '河中浮出遗失的相机。' },
      { episodeNumber: 3, title: '余烬', summary: '相机影像揭开事故真相。', hook: '林舟烧掉最后一封信。' },
    ],
    characters: [{ name: '林舟', role: '主角', goal: '查明旧友失踪真相' }],
    scenes: [{ id: 'scene-1', location: '旧屋', time: '雨夜', summary: '林舟收到来信。', beats: ['林舟拆开信封'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '林舟擦去信封上的雨水，展开信纸。' }] }],
    endingHook: '信纸背面写着当天日期。',
  };
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      receivedProfile = profile;
      return {
        id: 'fake-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          calls += 1;
          receivedRequest = request;
          return { output: script, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });

  const result = await store.runNovelAdaptation({
    novelText: '雨夜里，林舟收到失踪旧友寄来的信。他循着线索回到旧桥，发现多年前事故留下的相机。相机中的影像最终揭开了真相。',
    sourceName: '雨夜余烬.txt',
    production: { workType: 'series', durationSec: 90, episodeCountMode: 'fixed', episodeCount: 3, ratio: '16:9', language: '中文', emotion: '悲壮' },
  });

  assert.equal(calls, 1);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 32_000, timeoutMs: 300_000 });
  assert.equal(receivedRequest.operation, 'adapt-novel-to-series-plan');
  assert.equal(result.seriesPlan.length, 3);
});

test('music design makes one text request and does not call the music provider', async () => {
  let calls = 0;
  let receivedProfile;
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      receivedProfile = profile;
      return {
        id: 'fake-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          calls += 1;
          const timeline = request.input.timeline;
          return {
            output: {
              title: '求生配乐', creativeDirection: '低频脉冲逐步推进，结尾收束。',
              minimaxPrompt: '纯器乐电影配乐，低频脉冲、钢琴与克制弦乐承担全部主题、旋律和节奏表达，从压抑逐步推进到追逐高峰，随后自然收束，保持中频疏朗和动态留白。', instrumental: true,
              targetDurationSec: request.input.targetDurationSec,
              cues: timeline.map((item) => ({ segmentKey: item.segmentKey, startSec: item.startSec, endSec: item.endSec, musicalFunction: '推进剧情', energy: 'medium', instrumentation: '弦乐与打击乐', mixNote: '为原声让位' })),
              mixGuidance: ['动作声出现时压低配乐', '片头片尾使用短淡入淡出'],
            },
            providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
          };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  const result = await store.runMusicPromptPlan({
    projectTitle: '侏罗纪·生', logline: '男人逃出原始丛林。', targetDurationSec: 10.2, audioMode: 'native_with_music', subtitles: 'burned',
    segments: [{ segmentKey: 'SEG001', title: '苏醒', durationSec: 5, storyboardText: '男人苏醒。', transition: 'cut' }, { segmentKey: 'SEG002', title: '逃生', durationSec: 5, storyboardText: '男人逃跑。', transition: 'fade_to_black' }],
  });
  assert.equal(calls, 1);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 32_000 });
  assert.equal(result.status, 'complete');
  assert.equal(result.plan.instrumental, true);
  assert.equal(result.plan.cues.at(-1).endSec, 10.2);
  assert.deepEqual(result.requestSummary, { initialCalls: 1, repairCalls: 0, totalCalls: 1 });
});

test('music design retains a usable draft with incomplete mix notes as review advice', async () => {
  let calls = 0;
  const store = createProviderSettingsStore({
    agentProviderFactory: () => ({
      id: 'fake-agent',
      async health() { throw new Error('not used'); },
      async generate(request) {
        calls += 1;
        const timeline = request.input.timeline;
        const base = {
          title: '克制告别', creativeDirection: '钢琴与弦乐逐步收束。', instrumental: true,
          targetDurationSec: request.input.targetDurationSec,
          cues: timeline.map((item) => ({ segmentKey: item.segmentKey, startSec: item.startSec, endSec: item.endSec, musicalFunction: '承接人物情绪', energy: 'low', instrumentation: '钢琴与低音弦乐', mixNote: '对白处降低密度' })),
          mixGuidance: ['对白出现时降低中频密度', '结尾使用短淡出'],
        };
        if (request.operation === 'design-rough-cut-background-score') return { output: { ...base, cues: base.cues.map((cue, index) => index === 0 ? { ...cue, mixNote: '' } : cue), minimaxPrompt: '纯器乐电影配乐，情绪从克制犹豫逐渐转为坚定，最终自然收束，保持疏朗空间和细腻动态。' } };
        assert.equal(request.operation, 'repair-rough-cut-background-score');
        return { output: { ...base, minimaxPrompt: '纯器乐电影配乐，以钢琴和低音弦乐作为全片旋律核心，克制打击乐负责主要节奏与情绪推进；从犹豫逐渐转为坚定，最终自然收束，保持疏朗空间和细腻动态。' } };
      },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  const result = await store.runMusicPromptPlan({
    projectTitle: '告别', logline: '两位老人告别。', targetDurationSec: 15, audioMode: 'native_with_music', subtitles: 'none',
    segments: [{ segmentKey: 'SEG001', title: '告别', durationSec: 15, storyboardText: '两位老人告别。', transition: 'fade_to_black' }],
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'complete');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.validationWarnings.join('\n'), '');
  assert.deepEqual(result.requestSummary, { initialCalls: 1, repairCalls: 0, totalCalls: 1 });
});

test('music design returns a quality-only draft once with Chinese non-blocking suggestions', async () => {
  let calls = 0;
  const store = createProviderSettingsStore({
    agentProviderFactory: () => ({
      id: 'fake-agent',
      async health() { throw new Error('not used'); },
      async generate(request) {
        calls += 1;
        const timeline = request.input.timeline;
        return { output: {
          title: '待修改配乐', creativeDirection: '克制推进。',
          minimaxPrompt: '纯器乐电影配乐，情绪从克制逐步推进，最后自然收束，保持疏朗空间、冷色质感与细腻动态。',
          instrumental: true, targetDurationSec: request.input.targetDurationSec,
          cues: timeline.map((item) => ({ segmentKey: item.segmentKey, startSec: item.startSec, endSec: item.endSec, musicalFunction: '推进', energy: 'low', instrumentation: '钢琴', mixNote: '降低密度' })),
          mixGuidance: ['对白处降低密度', '结尾淡出'],
        } };
      },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  const result = await store.runMusicPromptPlan({
    projectTitle: '告别', logline: '两位老人告别。', targetDurationSec: 15, audioMode: 'native_with_music', subtitles: 'none',
    segments: [{ segmentKey: 'SEG001', title: '告别', durationSec: 15, storyboardText: '两位老人告别。', transition: 'fade_to_black' }],
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'complete');
  assert.equal(result.plan.title, '待修改配乐');
  assert.deepEqual(result.validationWarnings, []);
  assert.deepEqual(result.requestSummary, { initialCalls: 1, repairCalls: 0, totalCalls: 1 });
});

test('music validation messages are localized with an actionable example', () => {
  const [message] = localizeMusicPromptValidationIssues(['minimaxPrompt must assign the complete melodic role to instruments']);
  assert.match(message, /不够明确/u);
  assert.match(message, /不会阻断/u);
  assert.doesNotMatch(message, /minimaxPrompt/u);
});

test('music provider failures are not retried as content repairs', async () => {
  let calls = 0;
  const store = createProviderSettingsStore({
    agentProviderFactory: () => ({
      id: 'fake-agent',
      async health() { throw new Error('not used'); },
      async generate() { calls += 1; throw new Error('network unavailable'); },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  await assert.rejects(() => store.runMusicPromptPlan({
    projectTitle: '告别', logline: '两位老人告别。', targetDurationSec: 15, audioMode: 'native_with_music', subtitles: 'none',
    segments: [{ segmentKey: 'SEG001', title: '告别', durationSec: 15, storyboardText: '两位老人告别。', transition: 'fade_to_black' }],
  }), /network unavailable/u);
  assert.equal(calls, 1);
});

test('music generation is gated by persisted rough-cut and prompt approvals', () => {
  const saved = { id: 'project-music', state: { postProduction: {
    audioMode: 'native_with_music', roughCutApproval: 'approved', roughCut: { status: 'complete', filename: 'rough-cut.mp4', durationSec: 60.78 },
    musicPromptApproval: 'approved', musicPrompt: { status: 'complete', plan: { minimaxPrompt: '纯器乐电影配乐，低频弦乐、钢琴和定音鼓承担全部主题、旋律与节奏表达，从压抑逐步推进到追逐高峰，随后自然收束并保持动态留白。', instrumental: true, targetDurationSec: 60.78 } },
  } } };
  assert.deepEqual(buildWebMusicGenerationRequest(saved, { stamp: '20260824010101', seed: 20260827 }), { taskId: 'music-project-music-20260824010101', sourceEntityIds: ['rough-cut.mp4'], prompt: '纯器乐电影配乐，低频弦乐、钢琴和定音鼓承担全部主题、旋律与节奏表达，从压抑逐步推进到追逐高峰，随后自然收束并保持动态留白。', durationSec: 60.78, instrumental: true, seed: 20260827, bpm: 84, keyScale: 'A Minor', timeSignature: '4', inferenceSteps: 8, thinking: true });
  assert.throws(() => buildWebMusicGenerationRequest(saved, { seed: 2_147_483_648 }), /Seed必须/u);
  assert.throws(() => buildWebMusicGenerationRequest(saved, { bpm: 301 }), /BPM必须/u);
  assert.throws(() => buildWebMusicGenerationRequest(saved, { inferenceSteps: 0 }), /步数必须/u);
  assert.throws(() => buildWebMusicGenerationRequest({ ...saved, state: { postProduction: { ...saved.state.postProduction, musicPromptApproval: 'draft' } } }), /确认配乐提示词/u);
  assert.throws(() => buildWebMusicGenerationRequest({ ...saved, state: { postProduction: { ...saved.state.postProduction, audioMode: 'native' } } }), /不包含配乐/u);
  assert.doesNotThrow(() => buildWebMusicGenerationRequest({ ...saved, state: { postProduction: { ...saved.state.postProduction, musicPrompt: { status: 'complete', plan: { minimaxPrompt: '纯音乐背景配乐，无人声、无歌词。', instrumental: true, targetDurationSec: 60.78 } } } } }));
});

test('free canvas audio builds independent ACE-Step instrumental and song requests', () => {
  const base = { nodeId: 'audio-node-1', taskId: 'free-canvas-audio-1', prompt: '明亮轻快的校园流行音乐。', references: [{ id: 'text-1', kind: 'text', content: '青春日常' }], settings: { mode: 'instrumental', durationSec: 30, bpm: 96, keyScale: 'C Major', timeSignature: '4', inferenceSteps: 8, seed: 20260827, thinking: true, lyrics: '', vocalLanguage: 'zh' } };
  assert.deepEqual(buildFreeCanvasAudioGenerationRequest(base), { taskId: 'free-canvas-audio-1', sourceEntityIds: ['audio-node-1', 'text-1'], prompt: '明亮轻快的校园流行音乐。', durationSec: 30, instrumental: true, seed: 20260827, bpm: 96, keyScale: 'C Major', timeSignature: '4', inferenceSteps: 8, thinking: true });
  const song = buildFreeCanvasAudioGenerationRequest({ ...base, settings: { ...base.settings, mode: 'song', lyrics: '[Verse]\n迎着晨光奔跑', vocalLanguage: 'zh' } });
  assert.equal(song.instrumental, false);
  assert.equal(song.vocalLanguage, 'zh');
  assert.match(song.lyrics, /晨光/u);
  assert.throws(() => buildFreeCanvasAudioGenerationRequest({ ...base, settings: { ...base.settings, mode: 'song', lyrics: '' } }), /歌曲模式需要/u);
  assert.throws(() => buildFreeCanvasAudioGenerationRequest({ ...base, prompt: '@视频1 配乐' }), /不接受媒体引用/u);
  assert.throws(() => buildFreeCanvasAudioGenerationRequest({ ...base, prompt: '音'.repeat(2_001) }), /最多2000字/u);
});

test('short local music remains an unqualified playable result and can be recovered by project id', () => {
  const generatedMusicDirectory = mkdtempSync(join(tmpdir(), 'autodrama-short-music-'));
  const projectId = '11111111-2222-3333-4444-555555555555';
  const taskId = `music-${projectId}-20260825125532`;
  const outputPath = join(generatedMusicDirectory, `${taskId}.raw.wav`);
  writeFileSync(outputPath, Buffer.alloc(64, 1));
  const task = {
    id: taskId, version: 1, createdAt: '2026-08-25T12:55:32.000Z', updatedAt: '2026-08-25T12:56:32.000Z', approval: 'draft', kind: 'music',
    provider: 'audiocpp-minimax-music-3', sourceEntityIds: [], status: 'failed', outputPaths: [outputPath], externalTaskId: taskId,
    errorCode: 'duration_too_short', errorMessage: '只生成了54.184秒；结果可试听。', parameters: { actualDurationSec: 54.183764, requestedDurationSec: 60.364339, inferenceSteps: 30, seed: 20260822 },
  };
  assert.deepEqual(musicTaskResult(task), {
    status: 'unqualified', provider: 'audiocpp-minimax-music-3', filename: `${taskId}.raw.wav`, outputPath,
    mediaUrl: `/api/postproduction/music-media/${taskId}.raw.wav`, durationSec: 54.183764, requestedDurationSec: 60.364339,
    inferenceSteps: 30, seed: 20260822, externalTaskId: taskId, error: '只生成了54.184秒；结果可试听。', createdAt: '2026-08-25T12:56:32.000Z',
  });
  writeFileSync(join(generatedMusicDirectory, `${taskId}.json`), JSON.stringify({
    status: 'failed', taskId, provider: 'audiocpp-minimax-music-3', createdAt: task.createdAt, failedAt: task.updatedAt,
    diagnostics: { actualDurationSec: 54.183764, requestedDurationSec: 60.364339, generatedOutputPath: outputPath },
  }));
  const session = { id: projectId, state: { postProduction: { musicApproval: 'draft', music: { status: 'failed', seed: 20260822 } } } };
  const recovered = recoverPreservedShortMusic(session, { generatedMusicDirectory });
  assert.equal(recovered.state.postProduction.music.status, 'unqualified');
  assert.equal(recovered.state.postProduction.music.mediaUrl, `/api/postproduction/music-media/${taskId}.raw.wav`);
  assert.equal(recovered.state.postProduction.music.durationSec, 54.183764);
  assert.equal(recovered.state.postProduction.music.requestedDurationSec, 60.364339);
});

test('music store calls only the configured music provider on explicit generation', async () => {
  let calls = 0;
  const store = createProviderSettingsStore({ musicProviderFactory: (configuration) => ({
    id: 'minimax-music-3', async health() { throw new Error('not used'); }, async submit(request) { calls += 1; assert.equal(configuration.model, 'music-3.0'); return { id: request.taskId, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), approval: 'draft', kind: 'music', provider: 'minimax-music-3', sourceEntityIds: request.sourceEntityIds, status: 'awaiting_review', parameters: {}, outputPaths: ['E:/music.mp3'] }; },
  }) });
  store.configure({ kind: 'music', apiKey: 'music-secret-1234', baseUrl: 'https://api.minimaxi.com/v1', model: 'music-3.0' });
  const result = await store.runMusicGeneration({ taskId: 'music-explicit', sourceEntityIds: ['rough-cut'], prompt: '纯音乐', durationSec: 10, instrumental: true });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'music');
});

test('script revision makes one authorized request and preserves locked production fields', async () => {
  let calls = 0;
  let receivedProfile;
  const currentScript = {
    title: '旧稿', logline: '旧简介', genre: '剧情', durationSec: 60, ratio: '9:16', language: '中文', emotion: '紧张', workType: 'single',
    plannedEpisodeCount: 1, episodeNumber: 1, seriesPlan: [],
    characters: [{ name: '阿杰', role: '主角', goal: '逃离危机' }],
    scenes: [{ id: 'scene-1', location: '旧街', time: '夜', summary: '阿杰奔跑', beats: ['奔跑'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '阿杰奔跑。' }] }],
    endingHook: '门后传来脚步声。',
  };
  const revisedScript = { ...currentScript, title: '新稿', logline: '冲突更强的新简介' };
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      receivedProfile = profile;
      return {
        id: 'fake-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          calls += 1;
          assert.equal(request.operation, 'revise-approved-draft-script');
          assert.equal(request.maxOutputTokens, 32_000);
          return { output: revisedScript, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });

  const result = await store.runScriptRevision({ currentScript, revisionRequest: '加强第一场冲突。', sourceContext: '阿杰在旧街被追赶。' });

  assert.equal(calls, 1);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 32_000 });
  assert.equal(result.title, '新稿');
});

test('character design performs self-review in one specialist call', async () => {
  let calls = 0;
  let receivedProfile;
  const receivedRequests = [];
  const currentScript = {
    title: '旧街来信', logline: '阿岚必须在天亮前把信交给秦叔。', genre: '剧情', durationSec: 60, ratio: '16:9', language: '中文', emotion: '使命', workType: 'single',
    plannedEpisodeCount: 1, episodeNumber: 1, seriesPlan: [],
    characters: [
      { name: '阿岚', role: '信使', goal: '在天亮前送达信件' },
      { name: '秦叔', role: '收信人', goal: '等到决定命运的消息' },
      { name: '顾总', role: '后续反派', goal: '在后续剧情阻止阿岚' },
    ],
    scenes: [{
      id: 'scene-1', location: '旧街', time: '雨夜', summary: '阿岚冒雨抵达秦叔门前。', beats: ['秦叔打开门接过信件。'],
      dialogue: [{ speaker: '阿岚', line: '秦叔，这封信必须由你亲手打开。' }, { speaker: '秦叔', line: '我等它很久了。' }],
    }],
    endingHook: '信封背面浮出另一个名字。',
  };
  const profiles = [
    { profileKey: 'C01', name: '阿岚', aliases: [], introduction: '冒雨送信的信使，必须在天亮前把决定命运的信交给秦叔。', identity: '信使', storyRole: '主角', personality: ['坚定'], motivation: '按时送达信件。', relationships: [{ targetName: '秦叔', relationship: '把关键信件交给对方。' }], physicalKnownFacts: [], wardrobeKnownFacts: [], designOpenQuestions: ['年龄与外形'], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '亲手送信给秦叔。', sceneKey: 'S01', evidence: '秦叔，这封信必须由你亲手打开。' }] },
    { profileKey: 'C02', name: '秦叔', aliases: [], introduction: '等待关键信件的收信人，终于在雨夜等到阿岚。', identity: '收信人', storyRole: '关键对象', personality: ['沉着'], motivation: '等到决定命运的消息。', relationships: [{ targetName: '阿岚', relationship: '从对方手中接收信件。' }], physicalKnownFacts: [], wardrobeKnownFacts: [], designOpenQuestions: ['年龄与外形'], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '等待这封信已久。', sceneKey: 'S01', evidence: '我等它很久了。' }] },
  ];
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, profile) => {
      receivedProfile = profile;
      return {
        id: 'fake-agent',
        async health() { throw new Error('not used'); },
        async generate(request) {
          calls += 1;
          receivedRequests.push(request);
          const output = request.operation === 'extract-character-profiles'
            ? { profiles }
            : { decision: 'approve', summary: '人物范围和档案可进入用户确认。', revisionInstructions: [], finalCharacterNames: ['阿岚', '秦叔'] };
          return { output, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        },
      };
    },
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });

  const result = await store.runCharacterProfiles({ script: currentScript });

  assert.equal(calls, 1);
  assert.match(receivedRequests[0].instructions, /本次生成内完成起草和一次自检/u);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 40_000 });
  assert.deepEqual(receivedRequests.map((request) => request.operation), ['extract-character-profiles']);
  assert.equal(receivedRequests[0].input.script.approval, 'approved');
  assert.deepEqual(receivedRequests[0].input.requiredCharacterNames, ['阿岚', '秦叔']);
  assert.deepEqual(result.profiles.map((profile) => profile.name), ['阿岚', '秦叔']);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.supervision.directorReviews.length, 0);
});

test('approved style action makes one prompt request and one image request per character', async () => {
  let agentCalls = 0;
  let imageCalls = 0;
  let receivedProfile;
  let imageRequest;
  const profile = {
    profileKey: 'C01', name: '阿岚', aliases: [], introduction: '冒雨送信的年轻信使。', identity: '信使', storyRole: '主角',
    personality: ['坚定'], motivation: '送达信件。', relationships: [], physicalKnownFacts: [], wardrobeKnownFacts: [],
    designOpenQuestions: ['年龄与外形'], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '冒雨送信。', sceneKey: 'S01', evidence: '阿岚冒雨送信。' }],
  };
  const prompt = {
    promptKey: 'P01', characterProfileId: 'incorrect-model-id', characterName: '阿 岚',
    visualDesignProposal: {
      ageRange: '二十至二十五岁', faceAndFeatures: '清晰眉眼与略显疲惫的面部轮廓', hair: '黑色短发', bodyAndProportions: '修长匀称',
      skinAndComplexion: '自然肤色', wardrobe: '深色信使长衣', footwear: '防滑短靴', accessories: ['信袋'],
      repeatableIdentityAnchors: ['左眉轻挑', '窄长脸型', '眼尾微垂'], naturalAsymmetry: ['左眉略高'],
    },
    sections: {
      basicSetting: '同一名东方年轻信使。', atmosphereQualityPhotography: '中性棚拍光，细节清晰。',
      contentSpecifics: '人物自然站立，服装与手部完整。', cameraImaging: '自然透视，清晰对焦人物。',
      negativeTerms: ['多人混入', '身份漂移', '服装不一致', '缺手缺脚', '重复面孔', '文字水印'],
    },
  };
  const store = createProviderSettingsStore({
    agentProviderFactory: (_configuration, runtimeProfile) => {
      receivedProfile = runtimeProfile;
      return {
        id: 'fake-agent', async health() { throw new Error('not used'); },
        async generate(request) {
          agentCalls += 1;
          assert.equal(request.operation, 'generate-character-asset-board-prompts');
          return { output: { prompts: [prompt] }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        },
      };
    },
    imageProviderFactory: () => ({
      id: 'fake-image', async health() { throw new Error('not used'); },
      async submit(request) {
        imageCalls += 1;
        imageRequest = request;
        return { taskId: request.taskId, providerId: 'fake-image', status: 'completed', outputPaths: ['E:/tmp/alan.png'], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://image.example.test/v1', model: 'gpt-image-test' });

  const generationPreset = { id: 'project-generation-preset', version: 1, styleId: '3d-fantasy', aspectRatio: '16:9', imageResolution: '4k', createdAt: '2026-09-01T00:00:00.000Z' };
  const result = await store.runCharacterImages({ profiles: [profile], styleId: '3d-fantasy', generationPreset });

  assert.equal(agentCalls, 1);
  assert.equal(imageCalls, 1);
  assert.deepEqual(receivedProfile, { reasoningEffort: 'high', maxOutputTokens: 40_000 });
  assert.equal(imageRequest.width, 3504);
  assert.equal(imageRequest.height, 2336);
  assert.doesNotMatch(imageRequest.prompt, /目标画面比例：16:9/);
  assert.equal(imageRequest.count, 1);
  assert.match(imageRequest.prompt, /影视级写实CG/);
  assert.deepEqual(result.images.map(({ generationPreset, ...image }) => image), [{ profileKey: 'C01', name: '阿岚', status: 'complete', imageUrl: '/api/generated-images/alan.png' }]);
  assert.equal(result.images[0].generationPreset.styleId, '3d-fantasy');
  assert.equal(result.images[0].generationPreset.aspectRatio, '16:9');
  assert.equal(result.images[0].generationPreset.imageResolution, '4k');
  assert.equal(result.prompts.length, 1);
  assert.equal(result.prompts[0].profileKey, 'C01');

  const retry = await store.runCharacterImages({ profiles: [profile], styleId: '3d-fantasy', generationPreset, prompts: result.prompts, requestedProfileKeys: ['C01'] });
  assert.equal(agentCalls, 1, 'saved prompts must skip the text Agent on an image-only retry');
  assert.equal(imageCalls, 2);
  assert.deepEqual(retry.prompts, result.prompts);
});

test('character turnaround uses the approved main image and only the image-edit provider', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'prism-character-turnaround-'));
  const mainImagePath = join(generatedImageDirectory, 'alan-main.png');
  writeFileSync(mainImagePath, 'test image placeholder');
  let editCalls = 0;
  let receivedRequest;
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    agentProviderFactory: () => { throw new Error('text Agent must not be created'); },
    imageProviderFactory: () => { throw new Error('text-to-image provider must not be created'); },
    imageEditProviderFactory: () => ({
      id: 'fake-image-edit', async health() { throw new Error('not used'); },
      async submit(request) {
        editCalls += 1;
        receivedRequest = request;
        return { taskId: request.taskId, providerId: 'fake-image-edit', status: 'completed', outputPaths: [join(generatedImageDirectory, 'alan-turnaround.png')], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
      },
    }),
  });
  store.configure({ kind: 'image-edit', apiKey: 'edit-key-123456', baseUrl: 'https://image.example.test/v1', model: 'gpt-image-test' });

  const result = await store.runCharacterTurnaround({ profileKey: 'C01', name: '阿岚', imageUrl: '/api/generated-images/alan-main.png' });

  assert.equal(editCalls, 1);
  assert.deepEqual(receivedRequest.referenceMediaPaths, [mainImagePath]);
  assert.match(receivedRequest.prompt, /三视图|正面|侧面|背面/);
  assert.deepEqual(result, { profileKey: 'C01', name: '阿岚', status: 'complete', imageUrl: '/api/generated-images/alan-turnaround.png' });
});

test('scene design keeps proposal and prompt-image calls as two explicit stages', async () => {
  const operations = [];
  const agentProfiles = [];
  let imageCalls = 0;
  let editCalls = 0;
  let markFirstImageStarted;
  let releaseFirstImage;
  const firstImageStarted = new Promise((resolve) => { markFirstImageStarted = resolve; });
  const firstImageGate = new Promise((resolve) => { releaseFirstImage = resolve; });
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'prism-scene-web-'));
  const mainImagePath = join(generatedImageDirectory, 'old-street.png');
  const script = {
    title: '旧街来信', logline: '阿岚冒雨抵达旧街。', genre: '剧情', durationSec: 60, ratio: '16:9', language: '中文', emotion: '使命',
    characters: [{ name: '阿岚', role: '信使', goal: '送达信件' }],
    scenes: [{ id: 'scene-1', location: '旧街', time: '雨夜', summary: '阿岚冒雨抵达旧街。', beats: ['旧街在雨中延伸。'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '旧街在雨中延伸。' }] }],
    endingHook: '远处门扉打开。',
  };
  const profiles = [];
  const proposal = {
    promptKey: 'L01', sceneAssetKey: 'L01', name: '雨夜旧街', sourceSceneKeys: ['S01'], baseStateSceneKey: 'S01',
    sourceFacts: [{ fact: '地点是旧街', sceneKey: 'S01', evidenceId: 'E-S01-LOCATION' }], stateVariants: [],
    visualDesignProposal: { locationIdentity: '潮湿狭长的旧街。', spatialLayout: '街道由前景通向远处门扉。', terrainAndArchitecture: '两侧低矮旧屋围合。', materialsAndSurfaces: '湿石板与旧木门。', fixedLandmarks: ['左侧雨棚', '右侧石阶', '远处门扉'], lightingAndColor: '冷蓝雨夜与暖色门灯。', weatherAndAtmosphere: '持续细雨和薄雾。', reusableCameraCoverage: '街口和门扉构成稳定轴线。', designDecisions: ['以远处门扉作为视觉终点。'] },
  };
  const sections = { basicSetting: '雨夜旧街基础状态。', atmosphereQualityPhotography: '冷暖克制，湿润材质清晰。', contentSpecifics: '前景石板、中景街道、背景门扉。', cameraImaging: '24毫米建立镜头，深景深。', negativeTerms: ['人物混入', '剧情道具', '空间混乱', '地标漂移', '文字水印', '透视错误'] };
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    agentProviderFactory: (_configuration, profile) => { agentProfiles.push(profile); return { id: 'fake-agent', async health() { throw new Error('not used'); }, async generate(request) {
      operations.push(request.operation);
      const output = request.operation === 'generate-scene-visual-proposals'
        ? { proposals: [proposal] }
        : request.operation === 'production-director-review-scene-proposals'
          ? { decision: 'approve', summary: '场景范围和复用关系可进入用户确认。', revisionInstructions: [] }
          : { prompts: [{ sceneAssetKey: 'L01', sections }] };
      return { output, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    } }; },
    imageProviderFactory: () => ({ id: 'fake-image', async health() { throw new Error('not used'); }, async submit(request) { imageCalls += 1; if (imageCalls === 1) { markFirstImageStarted(); await firstImageGate; } return { taskId: request.taskId, providerId: 'fake-image', status: 'completed', outputPaths: [mainImagePath], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() }; } }),
    imageEditProviderFactory: () => ({ id: 'fake-image-edit', async health() { throw new Error('not used'); }, async submit(request) { editCalls += 1; assert.deepEqual(request.referenceMediaPaths, [mainImagePath]); assert.match(request.prompt, /严格2列×2行四宫格/); return { taskId: request.taskId, providerId: 'fake-image-edit', status: 'completed', outputPaths: [join(generatedImageDirectory, 'old-street-views.png')], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() }; } }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://image.example.test/v1', model: 'gpt-image-test' });
  store.configure({ kind: 'image-edit', apiKey: 'edit-key-123456', baseUrl: 'https://edit.example.test/v1', model: 'gpt-image-edit-test' });

  const proposalResult = await store.runSceneProposals({ script, profiles, styleId: '3d-fantasy' });
  const proposals = proposalResult.proposals;
  assert.deepEqual(operations, ['generate-scene-visual-proposals']);
  assert.deepEqual(agentProfiles[0], { reasoningEffort: 'high', maxOutputTokens: 40_000, timeoutMs: 360_000 });
  assert.equal(imageCalls, 0);
  assert.equal('sections' in proposals[0], false);
  const locallyAccepted = await store.runSceneProposals({ script, profiles, styleId: '3d-fantasy', returnedDraft: JSON.stringify({ proposals: [proposal] }) });
  assert.deepEqual(locallyAccepted.proposals, proposals);
  assert.deepEqual(operations, ['generate-scene-visual-proposals'], 'editing and revalidating a returned draft must not call the Agent again');
  await assert.rejects(
    () => store.runSceneProposals({ script, profiles, styleId: '3d-fantasy', returnedDraft: '{"proposals": [' }),
    (error) => error?.code === 'returned_agent_draft_validation_failed' && error?.returnedDraft === '{"proposals": [' && error?.validationIssues?.some((issue) => issue.includes('无法解析为JSON')),
  );
  assert.deepEqual(operations, ['generate-scene-visual-proposals'], 'failed local revalidation must also avoid another Agent call');
  const firstResult = store.runSceneImages({ script, profiles, styleId: '3d-fantasy', proposals, requestedSceneKeys: ['L01'] });
  await firstImageStarted;
  const secondResult = store.runSceneImages({ script, profiles, styleId: '3d-fantasy', proposals, requestedSceneKeys: ['L01'] });
  releaseFirstImage();
  const [result, parallelResult] = await Promise.all([firstResult, secondResult]);
  assert.deepEqual(operations, ['generate-scene-visual-proposals', 'generate-scene-prompts-from-approved-proposals']);
  assert.deepEqual(agentProfiles[1], { reasoningEffort: 'high', maxOutputTokens: 40_000 });
  assert.equal(imageCalls, 2);
  assert.deepEqual(parallelResult.prompts, result.prompts, 'a later per-card request must reuse prompts after text generation has finished while the first image is still pending');
  assert.equal(result.prompts[0].sceneAssetKey, 'L01');
  assert.equal(result.images[0].imageUrl, '/api/generated-images/old-street.png');
  const retry = await store.runSceneImages({ script, profiles, styleId: '3d-fantasy', proposals, prompts: result.prompts, requestedSceneKeys: ['L01'] });
  assert.equal(operations.length, 2, 'edited saved scene prompts must skip the text Agent');
  assert.equal(imageCalls, 3);
  assert.deepEqual(retry.prompts, result.prompts);
  writeFileSync(mainImagePath, 'scene image placeholder');
  const view = await store.runSceneView({ sceneAssetKey: 'L01', name: '雨夜旧街', imageUrl: result.images[0].imageUrl, fixedLandmarks: proposal.visualDesignProposal.fixedLandmarks, spatialLayout: proposal.visualDesignProposal.spatialLayout });
  assert.equal(editCalls, 1);
  assert.equal(view.imageUrl, '/api/generated-images/old-street-views.png');
  writeFileSync(join(generatedImageDirectory, 'web-scene-view-l01-1787397755797-01.png'), 'candidate one');
  writeFileSync(join(generatedImageDirectory, 'web-scene-view-l01-1787397755797-02.png'), 'candidate two');
  const recovered = store.recoverSceneViewCandidates({ sceneAssetKey: 'L01', name: '雨夜旧街' });
  assert.equal(recovered.status, 'needs_selection');
  assert.deepEqual(recovered.imageUrls, ['/api/generated-images/web-scene-view-l01-1787397755797-01.png', '/api/generated-images/web-scene-view-l01-1787397755797-02.png']);
});

test('scene design returns a usable proposal with director advice after one repair round', async () => {
  const operations = [];
  const script = {
    title: '一杯热汤', logline: '一家人在厨房与餐桌间完成晚餐。', genre: '生活', durationSec: 60, ratio: '16:9', language: '中文', emotion: '温暖',
    characters: [{ name: '妈妈', role: '家人', goal: '准备晚餐' }],
    scenes: [{ id: 'scene-1', location: '家中厨房与餐区', time: '傍晚', summary: '妈妈从厨房端汤到餐桌。', beats: ['妈妈端汤走向餐桌。'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '妈妈从厨房端汤走向餐桌。' }] }],
    endingHook: '一家人围桌坐下。',
  };
  const proposal = {
    promptKey: 'L01', sceneAssetKey: 'L01', name: '家中厨房与餐区', sourceSceneKeys: ['S01'], baseStateSceneKey: 'S01',
    sourceFacts: [{ fact: '厨房与餐区属于同一家庭空间。', sceneKey: 'S01', evidenceId: 'E-S01-LOCATION' }], stateVariants: [],
    visualDesignProposal: { locationIdentity: '连通的家庭厨房与餐区。', spatialLayout: '厨房操作台连接餐桌动线。', terrainAndArchitecture: '开放式厨房与相邻餐区。', materialsAndSurfaces: '木质餐桌与浅色橱柜。', fixedLandmarks: ['厨房操作台', '餐桌', '窗边'], lightingAndColor: '傍晚暖色室内光。', weatherAndAtmosphere: '安静温暖。', reusableCameraCoverage: '可从厨房轴线覆盖餐桌。', designDecisions: ['把厨房与餐区作为一个可复用空间。'] },
  };
  let directorRound = 0;
  const store = createProviderSettingsStore({
    agentProviderFactory: () => ({
      id: 'fake-agent',
      async health() { throw new Error('not used'); },
      async generate(request) {
        operations.push(request.operation);
        if (request.operation === 'generate-scene-visual-proposals') {
          return { output: { proposals: [proposal] }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
        }
        directorRound += 1;
        return {
          output: { decision: 'revise', summary: `第${directorRound}轮仍建议补充。`, revisionInstructions: ['在具体分镜中明确窗边与餐桌的相对方向。'] },
          providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
        };
      },
    }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });

  const result = await store.runSceneProposals({ script, profiles: [], styleId: '3d-fantasy', reviewMode: 'director' });

  assert.equal(result.proposals.length, 1);
  assert.deepEqual(operations, [
    'generate-scene-visual-proposals',
    'production-director-review-scene-proposals',
    'generate-scene-visual-proposals',
    'production-director-review-scene-proposals',
  ]);
  assert.match(result.warnings.join('；'), /总导演建议在后续分镜中继续明确/u);
  assert.match(result.warnings.join('；'), /窗边与餐桌的相对方向/u);
  assert.equal(result.supervision.directorReviews.at(-1).decision, 'revise');
});

test('prop design keeps proposal approval separate and reuses edited prompts for one-item regeneration', async () => {
  const operations = [];
  let imageCalls = 0;
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'prism-prop-web-'));
  const propImagePath = join(generatedImageDirectory, 'bronze-compass.png');
  const script = {
    title: '密林坐标', logline: '阿岚借助罗盘穿过密林。', genre: '冒险', durationSec: 60, ratio: '16:9', language: '中文', emotion: '使命',
    characters: [{ name: '阿岚', role: '探索者', goal: '找到出口' }],
    scenes: [{ id: 'scene-1', location: '密林空地', time: '白天', summary: '阿岚在空地辨认方向。', beats: ['阿岚从怀中取出铜制罗盘，表盘指针轻微摆动。'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '阿岚从怀中取出铜制罗盘，表盘指针轻微摆动。' }] }],
    endingHook: '指针停在未知方向。',
  };
  const profiles = [{ profileKey: 'C01', name: '阿岚', aliases: [], introduction: '谨慎的探索者。', identity: '探索者', storyRole: '主角', personality: ['谨慎'], motivation: '找到出口。', relationships: [], physicalKnownFacts: [], wardrobeKnownFacts: [], designOpenQuestions: [], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '在密林辨认方向。', sceneKey: 'S01', evidence: '阿岚在空地辨认方向。' }] }];
  const proposal = {
    promptKey: 'R01', propAssetKey: 'R01', name: '铜制罗盘', aliases: ['铜制罗盘', '罗盘'], sourceSceneKeys: ['S01'], baseStateSceneKey: 'S01', baseStateDescription: '完整闭合、未被手持的铜制罗盘。',
    sourceFacts: [{ fact: '铜制罗盘的表盘指针会摆动', sceneKey: 'S01', evidenceId: 'E-S01-ACTION' }], stateVariants: [],
    visualDesignProposal: { objectIdentity: '便携式旧铜机械罗盘。', silhouetteAndProportions: '掌心大小的扁圆盒体。', materialsAndSurface: '磨旧黄铜与透明表镜。', constructionAndDetails: '翻盖、铰链、环形刻度与中心指针。', colorAndFinish: '低饱和旧铜色。', scaleAndHandling: '可单手稳定托持。', repeatableAnchors: ['翻盖边缘缺口', '不对称铰链', '深色中心指针'], designDecisions: ['刻度采用不可读抽象标记。'] },
  };
  const sections = { basicSetting: '完整闭合的掌心大小旧铜罗盘。', atmosphereQualityPhotography: '中性棚拍光，金属磨损清晰。', contentSpecifics: '主视图与结构视图呈现翻盖、铰链和指针。', cameraImaging: '85毫米产品摄影视角，结构清晰。', negativeTerms: ['人物或手', '发光特效', '可读文字', '现代电子屏', '结构漂移', '多余零件'] };
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    agentProviderFactory: () => ({ id: 'fake-agent', async health() { throw new Error('not used'); }, async generate(request) {
      operations.push(request.operation);
      const output = request.operation === 'generate-prop-visual-proposals'
        ? { proposals: [proposal] }
        : request.operation === 'production-director-review-prop-proposals'
          ? { decision: 'approve', summary: '道具资产范围与状态设计可支撑后续镜头复用。', revisionInstructions: [] }
          : { prompts: [{ propAssetKey: 'R01', sections }] };
      return { output, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    } }),
    imageProviderFactory: () => ({ id: 'fake-image', async health() { throw new Error('not used'); }, async submit(request) { imageCalls += 1; assert.equal(request.width, 1536); assert.equal(request.height, 1024); return { taskId: request.taskId, providerId: 'fake-image', status: 'completed', outputPaths: [propImagePath], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() }; } }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  store.configure({ kind: 'image', apiKey: 'image-key-123456', baseUrl: 'https://image.example.test/v1', model: 'gpt-image-test' });

  const proposalResult = await store.runPropProposals({ script, profiles, styleId: '3d-fantasy' });
  const proposals = proposalResult.proposals;
  assert.deepEqual(operations, ['generate-prop-visual-proposals']);
  assert.equal(proposalResult.supervision.stage, 'prop-proposals');
  assert.equal(imageCalls, 0);
  assert.equal('sections' in proposals[0], false);
  const groundedProposal = {
    ...proposal,
    sourceFacts: proposal.sourceFacts.map(({ evidenceId: _evidenceId, ...fact }) => ({ ...fact, evidence: script.scenes[0].blocks[0].text })),
    visualDesignProposal: Object.fromEntries(Object.entries(proposal.visualDesignProposal).filter(([key]) => key !== 'designDecisions')),
  };
  const revalidated = await store.runPropProposals({
    script,
    profiles,
    styleId: '3d-fantasy',
    returnedDraft: JSON.stringify({ proposals: [groundedProposal] }),
  });
  assert.equal(revalidated.proposals[0].propAssetKey, 'R01');
  assert.deepEqual(revalidated.proposals[0].visualDesignProposal.designDecisions, []);
  assert.deepEqual(operations, ['generate-prop-visual-proposals'], 'editing a saved prop draft must not call an Agent again');
  assert.deepEqual(revalidated.proposals[0].sourceSceneKeys, ['S01']);
  assert.equal(revalidated.proposals[0].baseStateSceneKey, 'S01');
  const locallyQuarantined = await store.runPropProposals({
    script,
    profiles,
    styleId: '3d-fantasy',
    returnedDraft: JSON.stringify({ proposals: [{
      ...groundedProposal,
      sourceSceneKeys: ['S99'],
      baseStateSceneKey: 'S99',
      sourceFacts: [{ fact: '无法定位的罗盘', sceneKey: 'S99', evidence: '不存在的内容' }],
    }] }),
  });
  assert.equal(locallyQuarantined.proposals[0].sourceMappingStatus, 'needs_review');
  assert.equal(locallyQuarantined.proposals[0].assetRecommendation, 'text_only');
  assert.deepEqual(locallyQuarantined.proposals[0].sourceSceneKeys, []);
  assert.match(locallyQuarantined.warnings.join('；'), /剧本场次归属需要确认|剧本依据索引不完整/u);
  assert.deepEqual(operations, ['generate-prop-visual-proposals'], 'unmapped props must remain local and must not call an Agent');
  await assert.rejects(
    () => store.runPropImages({ script, profiles, styleId: '3d-fantasy', proposals: locallyQuarantined.proposals, requestedPropKeys: ['R01'] }),
    /剧本场次归属尚待确认/u,
  );
  assert.deepEqual(operations, ['generate-prop-visual-proposals'], 'unmapped props must not reach prompt generation');
  await assert.rejects(
    () => store.runPropProposals({ script, profiles, styleId: '3d-fantasy', returnedDraft: '{"proposals":[' }),
    /不是有效的JSON结构/u,
  );
  assert.deepEqual(operations, ['generate-prop-visual-proposals'], 'failed local prop revalidation must also avoid another Agent call');
  const [result, parallelResult] = await Promise.all([
    store.runPropImages({ script, profiles, styleId: '3d-fantasy', proposals, requestedPropKeys: ['R01'] }),
    store.runPropImages({ script, profiles, styleId: '3d-fantasy', proposals, requestedPropKeys: ['R01'] }),
  ]);
  assert.deepEqual(operations, ['generate-prop-visual-proposals', 'generate-prop-prompts-from-approved-proposals']);
  assert.equal(imageCalls, 2);
  assert.deepEqual(parallelResult.prompts, result.prompts, 'parallel per-card requests must share the first prompt generation');
  assert.equal(result.prompts[0].propAssetKey, 'R01');
  assert.equal(result.images[0].imageUrl, '/api/generated-images/bronze-compass.png');
  const editedPrompts = result.prompts.map((item) => ({ ...item, prompt: `${item.prompt}\n本地审核补充：强化翻盖边缘缺口。` }));
  const retry = await store.runPropImages({ script, profiles, styleId: '3d-fantasy', proposals, prompts: editedPrompts, requestedPropKeys: ['R01'] });
  assert.equal(operations.length, 2, 'saved prop prompts must skip the text Agent');
  assert.equal(imageCalls, 3);
  assert.deepEqual(retry.prompts, editedPrompts);
});

test('storyboard flow separates text approval, six-grid generation, and one-segment image-only regeneration', async () => {
  const operations = [];
  const runtimeProfiles = [];
  const videoRequests = [];
  let returnVideoDraftNeedingRevision = false;
  let repairVideoDraftStillInvalid = false;
  let returnMalformedVideoDraft = false;
  let editCalls = 0;
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'prism-storyboard-web-'));
  const characterPath = join(generatedImageDirectory, 'explorer.png');
  const scenePath = join(generatedImageDirectory, 'jungle.png');
  writeFileSync(characterPath, 'character placeholder');
  writeFileSync(scenePath, 'scene placeholder');
  const script = {
    title: '密林逃生', logline: '探索者穿过密林空地寻找出口。', genre: '冒险', durationSec: 15, ratio: '16:9', language: '中文', emotion: '紧张',
    characters: [{ name: '阿岚', role: '探索者', goal: '穿过密林' }],
    scenes: [{ id: 'scene-1', location: '密林空地', time: '白天', summary: '阿岚穿过密林空地。', beats: ['阿岚拨开蕨叶，快速穿过密林空地。'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '阿岚拨开蕨叶，快速穿过密林空地。' }, { type: 'transition', speaker: '', delivery: '', text: '硬切至黑场。字幕浮现：“继续前行。”' }] }],
    endingHook: '远处树影突然晃动。',
  };
  const profiles = [{ profileKey: 'C01', name: '阿岚', aliases: [], introduction: '谨慎敏捷的密林探索者。', identity: '探索者', storyRole: '主角', personality: ['谨慎'], motivation: '穿过密林。', relationships: [], physicalKnownFacts: [], wardrobeKnownFacts: [], designOpenQuestions: [], sourceSceneKeys: ['S01'], sourceFacts: [{ fact: '快速穿过密林。', sceneKey: 'S01', evidence: '阿岚拨开蕨叶，快速穿过密林空地。' }] }];
  const sceneProposal = { promptKey: 'L01', sceneAssetKey: 'L01', name: '密林空地', sourceSceneKeys: ['S01'], baseStateSceneKey: 'S01', sourceFacts: [], stateVariants: [], visualDesignProposal: { locationIdentity: '被巨树与蕨类包围的潮湿密林空地。', spatialLayout: '前景蕨叶、中景空地、背景密林出口。', terrainAndArchitecture: '湿润土路与巨树根系。', materialsAndSurfaces: '苔藓、树皮和潮湿泥土。', fixedLandmarks: ['巨树', '蕨叶带', '远处出口'], lightingAndColor: '斑驳日光与深绿色阴影。', weatherAndAtmosphere: '潮湿薄雾。', reusableCameraCoverage: '沿空地纵深轴线拍摄。', designDecisions: [] } };
  const segment = { segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '穿越空地', durationSec: 15, characters: ['阿岚'], sceneAssetKey: 'L01', sceneViewKey: 'main', propStateKey: 'none', actionEvidenceIds: ['B-S01-A01'], dialogueEvidenceIds: [], soundCueIds: [], storyboardText: '白天密林空地，阿岚拨开前景蕨叶，快速穿过空地并警惕望向远处树影。', transition: 'fade_to_black' };
  const plan = {
    panelCount: 6,
    semanticDecision: { visibleCharacters: ['阿岚'], characterStates: [{ characterName: '阿岚', state: '警惕穿行' }], visibleProps: [], sceneState: '白天密林空地', excludedElements: [], decisionBasis: ['剧本动作'] },
    referenceRequirements: { characters: ['阿岚'], sceneRequired: true, props: [], decisionBasis: ['人物与场景均需已批准参考'] },
    panels: makeDirectorPanels({ durationSec: 15, owner: '阿岚', camera: '沿空地轴线', visualPrefix: '穿越空地动作' }),
    imagePromptSections: { basicSetting: '同一阿岚与同一密林空地。', atmosphereQualityPhotography: '电影感斑驳日光。', contentLayout: '严格3列×2行六宫格，依次为P01、P02、P03、P04、P05、P06。', cameraImaging: '各格机位清晰连续。', negativeTerms: ['格数错误', '人物漂移', '场景漂移', '文字', '水印'] },
  };
  const videoPlan = {
    segmentKey: 'SEG001', durationSec: 15,
    referenceRequirements: {
      storyboardBoardRequired: true,
      characters: [{ characterName: '阿岚', role: '锁定人物身份与服装' }, { characterName: '迅猛龙', role: '错误新增角色资产' }],
      scene: { required: true, sceneAssetKey: '错误场景', role: '错误改写场景' },
      props: [{ propName: '泥浆', state: '脚边飞溅', role: '错误新增道具资产' }],
      decisionBasis: ['六宫格规划要求人物与场景参考'],
    },
    videoPromptSections: {
      basicSetting: '16:9，<Subject 1>是<Picture 1>中的阿岚，仅锁定人物身份与服装；<Picture 2>仅锁定密林空地的空间、固定陈设与光照，均不作为首帧。',
      soundPolicy: '无背景音乐、无对白、无旁白，保留持续的密林环境声。',
      atmosphereQualityPhotography: '电影感斑驳日光，潮湿深绿色层次。',
      shotExecution: 'P01 0-2.5秒，按<Picture 3>第1至6格，以<Picture 2>中的空间建立镜头，<Subject 1>拨开蕨叶。P02 2.5-5秒，<Subject 1>进入空地。P03 5-7.5秒，<Subject 1>加速穿行。P04 7.5-10秒，树影晃动。P05 10-12.5秒，<Subject 1>放慢脚步。P06 12.5-14秒，<Subject 1>警惕望向远处；14-15秒硬切至黑场，片尾字幕逐字浮现：“继续前行。”',
      negativeTerms: ['人物身份漂移', '场景结构漂移', '动作顺序错误', '多余人物', '片尾字幕错字'],
    },
  };
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    agentProviderFactory: (_configuration, profile) => { runtimeProfiles.push(profile); return { id: 'fake-agent', async health() { throw new Error('not used'); }, async generate(request) {
      operations.push(request.operation);
      if (request.operation === 'generate-episode-video-prompts-batch' || request.operation === 'repair-episode-video-prompts-batch') videoRequests.push(request);
      const returnedVideoPlan = structuredClone(videoPlan);
      if ((request.operation === 'generate-episode-video-prompts-batch' && returnVideoDraftNeedingRevision) || (request.operation === 'repair-episode-video-prompts-batch' && repairVideoDraftStillInvalid)) returnedVideoPlan.videoPromptSections.shotExecution = returnedVideoPlan.videoPromptSections.shotExecution.replace('片尾字幕逐字浮现：“继续前行。”', '画面停在黑场。');
      const output = request.operation === 'plan-storyboard-evidence' ? { items: [{ segmentKey: segment.segmentKey, actionEvidenceIds: segment.actionEvidenceIds, dialogueEvidenceIds: [], soundCueIds: [], intent: '穿越空地' }] } : request.operation === 'generate-storyboard-segment' ? { segment } : request.operation === 'generate-concise-storyboard-segments'
        ? { segments: [segment] }
        : request.operation === 'generate-episode-video-prompts-batch'
          ? { items: [{ segmentKey: 'SEG001', plan: returnMalformedVideoDraft ? { videoPromptSections: { basicSetting: '阿岚位于密林。' } } : returnedVideoPlan }] }
          : request.operation === 'repair-episode-video-prompts-batch'
            ? returnedVideoPlan
            : { items: [{ segmentKey: 'SEG001', plan }] };
      return { output, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    } }; },
    imageEditProviderFactory: () => ({ id: 'fake-image-edit', async health() { throw new Error('not used'); }, async submit(request) {
      editCalls += 1;
      assert.equal(request.width, 1536); assert.equal(request.height, 1024);
      assert.deepEqual(request.referenceMediaPaths, [characterPath, scenePath]);
      assert.match(request.prompt, /3列×2行|六宫格/);
      const outputPath = join(generatedImageDirectory, `board-${editCalls}.png`);
      writeFileSync(outputPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=', 'base64'));
      return { taskId: request.taskId, providerId: 'fake-image-edit', status: 'completed', outputPaths: [outputPath], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    } }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  store.configure({ kind: 'image-edit', apiKey: 'edit-key-123456', baseUrl: 'https://edit.example.test/v1', model: 'gpt-image-edit-test' });
  const baseInput = { script, profiles, styleId: '3d-fantasy', characterImages: [{ profileKey: 'C01', name: '阿岚', status: 'complete', imageUrl: '/api/generated-images/explorer.png' }], sceneProposals: [sceneProposal], sceneImages: [{ sceneAssetKey: 'L01', name: '密林空地', status: 'complete', imageUrl: '/api/generated-images/jungle.png' }], propProposals: [], propImages: [], segmentDurationSec: 15 };

  const textResult = await store.runStoryboardSegments(baseInput);
  assert.deepEqual(operations, ['plan-storyboard-evidence', 'generate-storyboard-segment']);
  assert.equal(runtimeProfiles[0].maxOutputTokens, 60_000);
  assert.equal(runtimeProfiles[0].timeoutMs, 360_000);
  assert.equal(runtimeProfiles[0].reasoningEffort, 'medium');
  assert.equal(editCalls, 0);
  assert.deepEqual(textResult.segments[0].referenceAssetIds, ['web-storyboard-character-c01', 'web-storyboard-scene-l01-main']);
  const planOnlyResult = await store.runStoryboardBoardPlans({ ...baseInput, segments: textResult.segments });
  assert.equal(runtimeProfiles[1].timeoutMs, 360_000);
  assert.equal(runtimeProfiles[1].reasoningEffort, 'high');
  assert.deepEqual(operations, ['plan-storyboard-evidence', 'generate-storyboard-segment', 'plan-storyboard-board-panels-batch']);
  assert.equal(editCalls, 0, 'plan-only validation must never call the image provider');
  assert.equal(planOnlyResult.validationErrors.length, 0);
  const malformedReturnedDraft = `${JSON.stringify({ items: [{ segmentKey: 'SEG001', plan }] }).replace('],"decisionBasis":', ']},"decisionBasis":')}]`;
  const operationCountBeforeRecovery = operations.length;
  const locallyRecovered = await store.runStoryboardBoardPlans({ ...baseInput, segments: textResult.segments, returnedDraft: malformedReturnedDraft });
  assert.equal(operations.length, operationCountBeforeRecovery, 'local recovery must not call the text Agent');
  assert.equal(locallyRecovered.validationErrors.length, 0);
  assert.equal(locallyRecovered.plans[0].segmentKey, 'SEG001');
  assert.deepEqual(locallyRecovered.plans[0].plan.semanticDecision.decisionBasis, ['剧本动作']);
  const boardResult = await store.runStoryboardBoards({ ...baseInput, segments: textResult.segments, plans: planOnlyResult.plans, prompts: planOnlyResult.prompts });
  assert.deepEqual(boardResult.plans[0].plan.referenceRequirements.characters, ['阿岚']);
  assert.equal(boardResult.plans[0].plan.referenceRequirements.sceneRequired, true);
  assert.deepEqual(boardResult.plans[0].plan.referenceRequirements.props, []);
  assert.equal(editCalls, 1);
  assert.equal(boardResult.boards[0].imageUrl, '/api/generated-images/board-1.png');
  assert.deepEqual(boardResult.boards[0].referenceLabels, ['阿岚主资产', '密林空地场景主资产']);
  assert.deepEqual(boardResult.boards[0].referenceAssetIds, ['web-storyboard-character-c01', 'web-storyboard-scene-l01-main']);
  const editedPrompts = boardResult.prompts.map((item) => ({ ...item, prompt: `${item.prompt}\n本地审核补充：强化动作方向。` }));
  const retry = await store.runStoryboardBoards({ ...baseInput, segments: textResult.segments, plans: boardResult.plans, prompts: editedPrompts, requestedSegmentKeys: ['SEG001'] });
  assert.equal(operations.length, 3, 'saved board plans and prompts must skip the text Agent');
  assert.equal(editCalls, 2);
  assert.deepEqual(retry.prompts, editedPrompts);
  const videoResult = await store.runVideoPrompts({ ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards, revisionRequest: '只修改最后一拍的机位', currentDrafts: [{ segmentKey: 'SEG001', prompt: '用户已编辑的当前正文' }] });
  assert.equal(videoRequests[0].input.segments[0].revisionRequest, '只修改最后一拍的机位');
  assert.equal(videoRequests[0].input.segments[0].currentDraft.prompt, '用户已编辑的当前正文');
  assert.deepEqual(operations, ['plan-storyboard-evidence', 'generate-storyboard-segment', 'plan-storyboard-board-panels-batch', 'generate-episode-video-prompts-batch']);
  assert.equal(runtimeProfiles[2].timeoutMs, 360_000);
  assert.equal(videoResult.prompts[0].segmentKey, 'SEG001');
  assert.equal(videoRequests[0].input.segments[0].panelCount, 6);
  assert.deepEqual(videoRequests[0].input.segments[0].referenceBindings, [
    { pictureTag: '<Picture 1>', label: '阿岚角色主图', assetKind: 'character', entityName: '阿岚', role: '仅锁定人物身份、面部、发型、服装与外形一致性，不作为首帧', subjectTag: '<Subject 1>' },
    { pictureTag: '<Picture 2>', label: '密林空地场景主图', assetKind: 'scene', entityName: 'L01', role: '仅锁定空间布局、固定陈设、色彩与照明关系，不作为首帧' },
    { pictureTag: '<Picture 3>', label: 'SEG001整张6宫格', assetKind: 'storyboard', entityName: 'SEG001', role: '按从左到右、从上到下的画格顺序，控制对应镜头的视角、人物位置、构图、动作状态与连续性，作为分镜参考' },
  ]);
  assert.equal(videoRequests[0].input.segments[0].requiredTransition, '硬切至黑场。字幕浮现：“继续前行。”');
  assert.match(videoResult.prompts[0].prompt, /声音总则/);
  assert.deepEqual(videoResult.prompts[0].plan.referenceRequirements.characters.map((item) => item.characterName), ['阿岚']);
  assert.equal(videoResult.prompts[0].plan.referenceRequirements.scene.sceneAssetKey, 'L01');
  assert.deepEqual(videoResult.prompts[0].plan.referenceRequirements.props, []);
  assert.deepEqual(videoResult.prompts[0].referenceImageUrls, ['/api/generated-images/explorer.png', '/api/generated-images/jungle.png', '/api/generated-images/board-1.png']);
  assert.equal(videoResult.prompts[0].referenceLabels[2], 'SEG001整张6宫格');
  assert.match(videoResult.prompts[0].prompt, /故事板参考：<Picture 3>是本段整张6宫格/u);
  assert.equal(videoRequests[0].images[0].id, 'SEG001-storyboard');
  assert.equal(videoRequests[0].images[0].mediaType, 'image/png');
  assert.equal(videoResult.prompts[0].storyboardVisionVersion, 1);
  assert.equal(JSON.stringify(videoResult).includes(videoRequests[0].images[0].data), false, 'image bytes stay out of saved results');
  assert.doesNotMatch(JSON.stringify(videoResult.prompts[0]), /undefined(?:宫格|格)/u);
  const optionalBoardVideoResult = await store.runVideoPrompts({ ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: [] });
  assert.equal(optionalBoardVideoResult.prompts[0].plan.referenceRequirements.storyboardBoardRequired, false);
  assert.doesNotMatch(optionalBoardVideoResult.prompts[0].referenceLabels.join('、'), /整张六宫格/u);
  assert.deepEqual(optionalBoardVideoResult.prompts[0].referenceImageUrls, ['/api/generated-images/explorer.png', '/api/generated-images/jungle.png']);
  assert.equal(videoRequests[1].input.segments[0].storyboardBoardAvailable, false);
  returnVideoDraftNeedingRevision = true;
  const correctedResult = await store.runVideoPrompts({ autoRepair: true, ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards });
  assert.equal(correctedResult.prompts[0].status, 'complete');
  assert.equal(correctedResult.prompts[0].repairAttempted, true);
  assert.match(correctedResult.prompts[0].prompt, /继续前行/u);
  assert.match(correctedResult.prompts[0].repairSourcePrompt, /画面停在黑场/u);
  assert.match(correctedResult.prompts[0].repairSourceValidationIssues.join('；'), /片尾转场缺少指定文字“继续前行。”/u);
  assert.deepEqual(correctedResult.requestSummary, { initialCalls: 1, repairCalls: 1, totalCalls: 2 });
  assert.equal(videoRequests[3].operation, 'repair-episode-video-prompts-batch');
  assert.equal(videoRequests[3].input.segments.length, 1, 'automatic review must isolate one failed segment per Agent request');
  assert.match(videoRequests[3].input.segments[0].repairContext.validationIssues.join('；'), /片尾转场缺少指定文字“继续前行。”/u);
  assert.match(videoRequests[3].input.segments[0].repairContext.previousDraft.shotExecution, /画面停在黑场/u);
  repairVideoDraftStillInvalid = true;
  const revisionResult = await store.runVideoPrompts({ autoRepair: true, ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards });
  assert.equal(revisionResult.prompts[0].status, 'needs_revision');
  assert.equal(revisionResult.prompts[0].repairAttempted, true);
  assert.match(revisionResult.prompts[0].prompt, /画面停在黑场/u);
  assert.match(revisionResult.prompts[0].repairSourcePrompt, /画面停在黑场/u);
  assert.match(revisionResult.prompts[0].validationIssues.join('；'), /片尾转场缺少指定文字“继续前行。”/u);
  assert.match(revisionResult.error, /完成一次自动校正后仍需要修改/u);
  assert.deepEqual(revisionResult.requestSummary, { initialCalls: 1, repairCalls: 1, totalCalls: 2 });
  repairVideoDraftStillInvalid = false;
  returnVideoDraftNeedingRevision = false;
  const requestCountBeforeExplicitRepair = videoRequests.length;
  const explicitRepairResult = await store.repairVideoPrompt({
    ...baseInput,
    segments: textResult.segments,
    plans: boardResult.plans,
    boards: boardResult.boards,
    segmentKey: 'SEG001',
    draft: revisionResult.prompts[0].plan,
    validationCodes: revisionResult.prompts[0].validationCodes,
    validationIssues: revisionResult.prompts[0].validationIssues,
  });
  assert.equal(videoRequests.length, requestCountBeforeExplicitRepair + 1, 'explicit repair must make exactly one Agent request');
  assert.equal(runtimeProfiles.at(-1).reasoningEffort, 'medium', 'explicit repair should reserve more output budget by using medium reasoning');
  assert.equal(videoRequests.at(-1).operation, 'repair-episode-video-prompts-batch');
  assert.equal(videoRequests.at(-1).images[0].data, videoRequests[0].images[0].data, 'repair reads the same selected storyboard');
  assert.deepEqual(videoRequests.at(-1).input.segments[0].repairContext.validationCodes, revisionResult.prompts[0].validationCodes);
  assert.equal(explicitRepairResult.prompt.status, 'complete');
  assert.match(explicitRepairResult.prompt.prompt, /继续前行/u);
  assert.deepEqual(explicitRepairResult.requestSummary, { initialCalls: 0, repairCalls: 1, totalCalls: 1 });
  const legacyDraftText = '基础设定\n用户已编辑的当前正文，保留这个道具。\n画面内容与镜头执行\n人物前行。';
  const beforeLegacyRepair = videoRequests.length;
  const legacyRepair = await store.repairVideoPrompt({
    ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards,
    segmentKey: 'SEG001', currentPrompt: legacyDraftText,
  });
  assert.equal(videoRequests.length, beforeLegacyRepair + 1);
  assert.equal(videoRequests.at(-1).input.segments[0].currentDraft, legacyDraftText);
  assert.deepEqual(videoRequests.at(-1).input.segments[0].repairContext.validationCodes, ['manual_draft_review']);
  assert.equal(legacyRepair.prompt.repairSourcePrompt, legacyDraftText);
  assert.equal(legacyRepair.prompt.status, 'complete');
  returnMalformedVideoDraft = true;
  const malformedDraftResult = await store.runVideoPrompts({ ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards });
  returnMalformedVideoDraft = false;
  assert.equal(malformedDraftResult.prompts[0].status, 'needs_revision');
  assert.equal(malformedDraftResult.prompts[0].repairAttempted, false);
  assert.ok(malformedDraftResult.prompts[0].plan);
  assert.ok(malformedDraftResult.prompts[0].validationCodes.includes('all video prompt sections are required'));
  assert.deepEqual(malformedDraftResult.requestSummary, { initialCalls: 1, repairCalls: 0, totalCalls: 1 });
  const beforeInvalidImage = videoRequests.length;
  writeFileSync(join(generatedImageDirectory, 'board-1.png'), 'corrupted image');
  const invalidImageResult = await store.runVideoPrompts({ ...baseInput, segments: textResult.segments, plans: boardResult.plans, boards: boardResult.boards });
  assert.equal(videoRequests.length, beforeInvalidImage, 'an unreadable image must not fall back to a text-only paid request');
  assert.equal(invalidImageResult.requestSummary.totalCalls, 0);
  assert.match(invalidImageResult.error, /SEG001.*不是可读取的/u);
  const unavailablePlans = structuredClone(boardResult.plans);
  unavailablePlans[0].plan.semanticDecision.visibleCharacters.push('迅猛龙');
  unavailablePlans[0].plan.semanticDecision.characterStates.push({ characterName: '迅猛龙', state: '远处警戒' });
  unavailablePlans[0].plan.panels.forEach((panel) => panel.characters.push('迅猛龙'));
  unavailablePlans[0].plan.referenceRequirements.characters.push('迅猛龙');
  const operationCount = operations.length;
  await assert.rejects(
    store.runVideoPrompts({ ...baseInput, segments: textResult.segments, plans: unavailablePlans, boards: boardResult.boards }),
    /角色“迅猛龙”不在已确认资产清单中/
  );
  assert.equal(operations.length, operationCount, 'missing approved assets must fail before the text Agent call');
  const textOnlyResult = await store.runStoryboardSegments({ ...baseInput, characterImages: [], sceneImages: [] });
  assert.deepEqual(textOnlyResult.segments[0].referenceAssetIds, ['web-storyboard-character-c01', 'web-storyboard-scene-l01-main']);
  assert.equal(operations.at(-1), 'generate-storyboard-segment', 'text-only character and scene references must remain valid storyboard assets');
  const textOnlyPropInput = {
    ...baseInput,
    propProposals: [{ propAssetKey: 'R01', name: '座钟', baseStateDescription: '闭合的座钟', selectedForProduction: false }],
    propImages: [{ propAssetKey: 'R01', status: 'complete', imageUrl: '/api/generated-images/missing-unselected-prop.png' }],
  };
  await store.runStoryboardSegments(textOnlyPropInput);
  assert.equal(textOnlyPropInput.propImages.length, 1, 'text-only selection preserves the existing image record while excluding its media reference');
  const assetlessInput = {
    ...baseInput,
    profiles: [], characterImages: [],
    sceneProposals: [], sceneImages: [],
    propProposals: [], propImages: [],
  };
  const assetlessResult = await store.runStoryboardSegments(assetlessInput);
  assert.deepEqual(assetlessResult.segments[0].referenceAssetIds, []);
  assert.equal(assetlessResult.segments[0].sceneAssetKey, undefined);
  assert.equal(assetlessResult.segments[0].sceneViewKey, 'text-only');
  assert.equal(assetlessResult.segments[0].propStateKey, 'none');
  const assetlessPlans = await store.runStoryboardBoardPlans({ ...assetlessInput, segments: assetlessResult.segments });
  assert.deepEqual(assetlessPlans.plans[0].plan.referenceRequirements.characters, []);
  assert.equal(assetlessPlans.plans[0].plan.referenceRequirements.sceneRequired, false);
  assert.deepEqual(assetlessPlans.plans[0].plan.referenceRequirements.props, []);
  const assetlessVideo = await store.runVideoPrompts({ ...assetlessInput, segments: assetlessResult.segments, plans: assetlessPlans.plans, boards: [] });
  assert.deepEqual(assetlessVideo.prompts[0].referenceImageUrls, []);
  assert.deepEqual(assetlessVideo.prompts[0].plan.referenceRequirements.characters, []);
  assert.deepEqual(assetlessVideo.prompts[0].plan.referenceRequirements.props, []);
});

test('storyboard boards bind every prepared prop that the director marks visible', async () => {
  const generatedImageDirectory = mkdtempSync(join(tmpdir(), 'prism-storyboard-props-'));
  const propNames = ['充电盒', '耳机', '数据线', '徽章', '收纳袋'];
  const propPaths = propNames.map((_, index) => join(generatedImageDirectory, `prop-${index + 1}.png`));
  propPaths.forEach((path, index) => writeFileSync(path, `prop ${index + 1} placeholder`));
  const operations = [];
  let imageRequest;
  const segment = {
    segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '黑场显形', durationSec: 5, characters: [],
    sceneViewKey: 'text-only', propStateKey: 'dormant', actionEvidenceIds: ['B-S01-A01'], dialogueEvidenceIds: [], soundCueIds: [],
    referenceAssetIds: ['web-storyboard-prop-r01-dormant'],
    storyboardText: '黑场中充电盒打开，一对耳机从盒内升起并保持与批准道具外形一致。', transition: 'fade_to_black',
  };
  const plan = {
    panelCount: 3,
    semanticDecision: {
      visibleCharacters: [], characterStates: [],
      visibleProps: propNames.map((propName) => ({ propName, state: '镜头中可见' })),
      sceneState: '纯黑产品展示空间', excludedElements: [], decisionBasis: ['两件批准道具都在画面中可见'],
    },
    referenceRequirements: {
      characters: [], sceneRequired: false,
      props: [{ propName: '充电盒', state: 'dormant' }],
      decisionBasis: ['需要锁定产品外形'],
    },
    panels: Array.from({ length: 3 }, (_, index) => ({
      startState: `产品状态${index}`,
      actionOwner: index === 2 ? '耳机' : '充电盒',
      actionSummary: index === 0 ? '充电盒显形' : index === 1 ? '充电盒打开' : '耳机从盒内升起',
      endState: `产品状态${index + 1}`,
      shotSize: index === 1 ? '中近景' : '中景', camera: '正视固定机位',
      visual: index === 0 ? '充电盒在黑场中显形' : index === 1 ? '充电盒自行打开并显露内腔' : '耳机从打开的充电盒中升起',
      characters: [], visibleProps: index === 2 ? ['充电盒', '耳机'] : ['充电盒'],
    })),
    imagePromptSections: {
      basicSetting: '纯黑产品展示空间。', atmosphereQualityPhotography: '冷白轮廓光，产品摄影。',
      contentLayout: '横版3:2画布，3列×1行三宫格，P01、P02、P03。', cameraImaging: '三格均为正视固定机位。',
      negativeTerms: ['产品漂移', '比例错误', '多余产品', '文字', '水印'],
    },
  };
  const script = {
    title: '耳机展示', logline: '展示充电盒与耳机。', genre: '产品广告', durationSec: 5, ratio: '16:9', language: '中文', emotion: '冷峻',
    characters: [], scenes: [{ id: 'scene-1', location: '产品棚', time: '夜晚', summary: segment.storyboardText, beats: [segment.storyboardText], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: segment.storyboardText }] }], endingHook: '耳机悬停在充电盒上方。',
  };
  const propProposals = propNames.map((name, index) => ({ propAssetKey: `R0${index + 1}`, name, sourceSceneKeys: ['S01'], baseStateDescription: `${name}视觉设定。` }));
  const baseInput = {
    script, profiles: [], styleId: '3d-fantasy', characterImages: [], sceneProposals: [], sceneImages: [],
    propProposals,
    propImages: propNames.map((_, index) => ({ propAssetKey: `R0${index + 1}`, status: 'complete', imageUrl: `/api/generated-images/prop-${index + 1}.png` })),
    segmentDurationSec: 5, panelCount: 3,
  };
  const store = createProviderSettingsStore({
    generatedImageDirectory,
    agentProviderFactory: () => ({ id: 'fake-agent', async health() { throw new Error('not used'); }, async generate(request) {
      operations.push(request.operation);
      return { output: { items: [{ segmentKey: 'SEG001', plan }] }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    } }),
    imageEditProviderFactory: () => ({ id: 'fake-image-edit', async health() { throw new Error('not used'); }, async submit(request) {
      imageRequest = request;
      const outputPath = join(generatedImageDirectory, 'board-with-two-props.png');
      writeFileSync(outputPath, 'board placeholder');
      return { taskId: request.taskId, providerId: 'fake-image-edit', status: 'completed', outputPaths: [outputPath], submittedAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    } }),
  });
  store.configure({ kind: 'agent', apiKey: 'agent-key-123456', baseUrl: 'https://agent.example.test/v1', model: 'writer-test' });
  store.configure({ kind: 'image-edit', apiKey: 'edit-key-123456', baseUrl: 'https://edit.example.test/v1', model: 'gpt-image-edit-test' });

  const planned = await store.runStoryboardBoardPlans({ ...baseInput, segments: [segment] });
  assert.deepEqual(planned.plans[0].plan.referenceRequirements.props, propNames.map((propName) => ({ propName, state: 'dormant' })));
  assert.match(planned.prompts[0].prompt, /^参考图：充电盒、耳机、数据线、徽章、收纳袋$/mu);

  const legacyPlans = structuredClone(planned.plans);
  legacyPlans[0].plan.referenceRequirements.props = [{ propName: '充电盒', state: 'dormant' }];
  const legacyPrompts = structuredClone(planned.prompts);
  legacyPrompts[0].prompt = legacyPrompts[0].prompt.replace(/^参考图：.*$/mu, '参考图：充电盒');
  const result = await store.runStoryboardBoards({ ...baseInput, segments: [segment], plans: legacyPlans, prompts: legacyPrompts, requestedSegmentKeys: ['SEG001'] });

  assert.deepEqual(operations, ['plan-storyboard-board-panels-batch'], 'legacy reference bindings should be repaired locally without another Agent call');
  assert.match(result.prompts[0].prompt, /^参考图：充电盒、耳机、数据线、徽章、收纳袋$/mu);
  assert.deepEqual(imageRequest.referenceAssetIds, propNames.map((_, index) => `web-storyboard-prop-r0${index + 1}-dormant`));
  assert.deepEqual(imageRequest.referenceMediaPaths, propPaths);
  assert.deepEqual(result.boards[0].referenceAssetIds, propNames.map((_, index) => `web-storyboard-prop-r0${index + 1}-dormant`));
  assert.deepEqual(result.boards[0].referenceLabels, propNames);
});
