import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentInputSource = readFileSync(new URL('./AgentChatInput.jsx', import.meta.url), 'utf8');
const chatHistorySource = readFileSync(new URL('./ChatHistory.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../../store/useAppStore.js', import.meta.url), 'utf8');
const videoGenerationSource = readFileSync(new URL('../../lib/videoGeneration.js', import.meta.url), 'utf8');

test('AgentChatInput exposes Seedance 2.0 and routes it to video generation', () => {
  assert.match(agentInputSource, /<option value="seedance-2\.0">Seedance 2\.0 视频<\/option>/);
  assert.match(agentInputSource, /const generateVideo = useAppStore\(\(s\) => s\.generateVideo\);/);
  assert.match(agentInputSource, /if \(isSeedanceModel\(selectedModel\)\)/);
  assert.match(agentInputSource, /generateVideo\(userInput,\s*referenceImages\)/);
});

test('AgentChatInput lets users type any Seedance duration from 5 to 15 seconds', () => {
  assert.match(agentInputSource, /type="number"/);
  assert.match(agentInputSource, /min=\{5\}/);
  assert.match(agentInputSource, /max=\{15\}/);
  assert.match(agentInputSource, /step=\{1\}/);
  assert.doesNotMatch(agentInputSource, /<option value=\{10\}>10秒<\/option>/);
});

test('AgentChatInput exposes Seedance resolution choices and per-second pricing', () => {
  assert.match(agentInputSource, /videoResolution/);
  assert.match(videoGenerationSource, /480p/);
  assert.match(videoGenerationSource, /720p/);
  assert.match(videoGenerationSource, /1080p/);
  assert.match(agentInputSource, /点\/秒/);
});

test('AgentChatInput exposes Seedance video mode choices', () => {
  assert.match(agentInputSource, /videoFrameMode/);
  assert.match(agentInputSource, /SEEDANCE_VIDEO_MODE_OPTIONS/);
  assert.match(videoGenerationSource, /first_frame/);
  assert.match(videoGenerationSource, /reference_image/);
  assert.match(videoGenerationSource, /first_last_frame/);
});

test('useAppStore creates and polls Seedance video tasks', () => {
  assert.match(storeSource, /generateVideo:\s*async\s*\(userParams,\s*imageDatas\)\s*=>/);
  assert.match(storeSource, /const VIDEO_MAX_POLL_ATTEMPTS = 600;/);
  assert.match(storeSource, /fetch\(`\$\{API_BASE\}\/v1\/video\/generate`/);
  assert.match(storeSource, /fetch\(`\$\{API_BASE\}\/v1\/video\/tasks\/\$\{taskId\}`/);
  assert.match(storeSource, /duration_seconds:\s*normalizeVideoDurationSeconds\(videoDurationSeconds\)/);
  assert.match(storeSource, /resolution:\s*normalizeSeedanceResolution\(videoResolution\)/);
  assert.match(storeSource, /video_mode:\s*resolveSeedanceVideoMode\(videoFrameMode,\s*normalizedImages\.length\)/);
  assert.match(storeSource, /任务 ID：\$\{taskId\}/);
  assert.match(storeSource, /videoUrl:/);
});

test('ChatHistory renders generated videos with native controls', () => {
  assert.match(chatHistorySource, /msg\.videoUrl/);
  assert.match(chatHistorySource, /<video[\s\S]*controls[\s\S]*src=\{msg\.videoUrl\}/);
});
