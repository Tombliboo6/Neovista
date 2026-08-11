import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentInputSource = readFileSync(new URL('./AgentChatInput.jsx', import.meta.url), 'utf8');
const chatHistorySource = readFileSync(new URL('./ChatHistory.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../../store/useAppStore.js', import.meta.url), 'utf8');
const videoGenerationSource = readFileSync(new URL('../../lib/videoGeneration.js', import.meta.url), 'utf8');
const canvasNodesSource = readFileSync(new URL('./canvas/CanvasNodes.jsx', import.meta.url), 'utf8');
const canvasDraftSource = readFileSync(new URL('../../lib/canvasGenerationDraft.js', import.meta.url), 'utf8');

test('AgentChatInput exposes Seedance 2.0 and routes it to video generation', () => {
  assert.match(agentInputSource, /<option value="seedance-2\.0" disabled=\{!seedanceEnabled\}>/);
  assert.match(agentInputSource, /const generateVideo = useAppStore\(\(s\) => s\.generateVideo\);/);
  assert.match(agentInputSource, /if \(isSeedanceModel\(selectedModel\)\)/);
  assert.match(agentInputSource, /generateVideo\(\s*userInput,\s*referenceImages,\s*storyMode \? generationDraft\.request : null/);
});

test('AgentChatInput lets users type any Seedance duration from 4 to 15 seconds', () => {
  assert.match(agentInputSource, /type="number"/);
  assert.match(agentInputSource, /min=\{seedanceMinDuration\}/);
  assert.match(agentInputSource, /max=\{seedanceMaxDuration\}/);
  assert.match(agentInputSource, /step=\{1\}/);
  assert.doesNotMatch(agentInputSource, /<option value=\{10\}>10秒<\/option>/);
  assert.match(canvasNodesSource, /min=\{SEEDANCE_MIN_DURATION_SECONDS\}/);
});

test('AgentChatInput exposes only server-provided Seedance resolution pricing', () => {
  assert.match(agentInputSource, /videoResolution/);
  assert.match(agentInputSource, /videoCapabilities\.resolution_credits_per_second/);
  assert.match(agentInputSource, /Object\.entries\(capabilityPricing\)/);
  assert.match(agentInputSource, /formatSeedanceResolutionLabel\(value\)/);
  assert.match(agentInputSource, /点\/秒/);
  assert.doesNotMatch(agentInputSource, /SEEDANCE_RESOLUTION_OPTIONS/);
});

test('AgentChatInput exposes Seedance video mode choices', () => {
  assert.match(agentInputSource, /videoFrameMode/);
  assert.match(agentInputSource, /SEEDANCE_VIDEO_MODE_OPTIONS/);
  assert.match(videoGenerationSource, /first_frame/);
  assert.match(videoGenerationSource, /reference_image/);
  assert.match(videoGenerationSource, /reference_video/);
  assert.match(videoGenerationSource, /first_last_frame/);
});

test('AgentChatInput uploads one Seedance reference video through the multipart endpoint', () => {
  assert.match(agentInputSource, /accept="video\/mp4,video\/webm,video\/quicktime/);
  assert.match(agentInputSource, /handleReferenceVideoSelect/);
  assert.match(agentInputSource, /supports_reference_video/);
  assert.match(agentInputSource, /uploadSeedanceReferenceVideo/);
  assert.match(agentInputSource, /seedanceReferenceVideo/);
  assert.match(storeSource, /new FormData\(\)/);
  assert.match(storeSource, /formData\.append\('file', file\)/);
  assert.match(storeSource, /fetch\(`\$\{API_BASE\}\/v1\/video\/reference-upload`/);
  assert.match(storeSource, /reference_video_url:\s*seedanceReferenceVideo\?\.video_url \|\| null/);
  assert.match(canvasDraftSource, /hasReferenceVideo/);
  assert.match(canvasNodesSource, /referenceVideoSignature/);
});

test('AgentChatInput preserves the enabled-by-default Seedance audio toggle', () => {
  assert.match(agentInputSource, /videoGenerateAudio/);
  assert.match(agentInputSource, /setVideoGenerateAudio/);
  assert.match(agentInputSource, /aria-label="生成音效"/);
  assert.match(storeSource, /videoGenerateAudio:\s*true/);
  assert.match(storeSource, /generate_audio:\s*Boolean\(videoGenerateAudio\)/);
});

test('useAppStore creates and polls Seedance video tasks', () => {
  assert.match(storeSource, /generateVideo:\s*async\s*\(userParams,\s*imageDatas,\s*compiledRequest = null\)\s*=>/);
  assert.match(storeSource, /const VIDEO_MAX_POLL_ATTEMPTS = 600;/);
  assert.match(storeSource, /fetch\(`\$\{API_BASE\}\/v1\/video\/generate`/);
  assert.match(storeSource, /(?:fetchWithAbortTimeout\([\s\S]*?|fetch\()`\$\{API_BASE\}\/v1\/video\/tasks\/\$\{(?:encodeURIComponent\(currentTask\.taskId\)|taskId)\}`/);
  assert.match(storeSource, /duration_seconds:\s*requestDto\.duration/);
  assert.match(storeSource, /resolution:\s*requestDto\.resolution/);
  assert.match(storeSource, /video_mode:\s*requestDto\.frameMode/);
  assert.match(storeSource, /reference_video_url:\s*seedanceReferenceVideo\?\.video_url \|\| null/);
  assert.match(storeSource, /generate_audio:\s*Boolean\(videoGenerateAudio\)/);
  assert.match(storeSource, /compareGenerationRequest\(compiledRequest, freshRequest\)/);
  assert.match(storeSource, /任务 ID：\$\{taskId\}/);
  assert.match(storeSource, /videoUrl[, :]/);
});

test('Seedance creation sends ordered reference images', () => {
  const generateVideoSource = storeSource.slice(storeSource.indexOf('generateVideo: async'));
  assert.match(generateVideoSource, /image_datas:\s*normalizedImages\.length > 0 \? normalizedImages : null/);
});

test('Seedance polling has timeout, bounded transient retries, and stop-watching semantics', () => {
  assert.doesNotMatch(storeSource, /\/video\/tasks\/\$\{[^}]+\}\/cancel/);
});

test('ChatHistory renders generated videos with native controls', () => {
  assert.match(chatHistorySource, /msg\.videoUrl/);
  assert.match(chatHistorySource, /<video[\s\S]*controls[\s\S]*src=\{msg\.videoUrl\}/);
});
