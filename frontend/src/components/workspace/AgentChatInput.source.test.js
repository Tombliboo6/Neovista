import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentChatInput.jsx', import.meta.url), 'utf8');

test('AgentChatInput supports cumulative multi-image uploads and clipboard paste', () => {
  assert.match(source, /const uploadedImages = useAppStore\(\(s\) => s\.uploadedImages\);/);
  assert.match(source, /const setUploadedImages = useAppStore\(\(s\) => s\.setUploadedImages\);/);
  assert.match(source, /const removeUploadedImageAt = useAppStore\(\(s\) => s\.removeUploadedImageAt\);/);
  assert.match(source, /mergeReferenceImages/);
  assert.match(source, /onPaste=\{handlePaste\}/);
  assert.match(source, /type="file"/);
  assert.match(source, /multiple/);
});

test('AgentChatInput resolves request payloads from plural reference images', () => {
  assert.match(source, /const resolveImageDataList = \(\) =>/);
  assert.match(source, /workspaceChat\(userInput,\s*resolveImageDataList\(\)\)/);
  assert.match(source, /directChat\(userInput,\s*resolveImageDataList\(\)\)/);
  assert.match(source, /generateImage\(userInput,\s*null,\s*null,\s*resolveImageDataList\(\)\)/);
});

test('AgentChatInput safely exports selected canvas images', () => {
  assert.match(source, /import \{ safeCanvasToDataUrl \} from '..\/..\/lib\/canvasExport\.js';/);
  assert.match(source, /return safeCanvasToDataUrl\(activeObj,\s*\{\s*format: 'jpeg',\s*quality: 0\.85,\s*multiplier: 1,\s*\}\);/);
});

test('AgentChatInput exposes GPT Image 2.0 as a generation model option', () => {
  assert.match(source, /<option value="gpt-image-2">GPT Image 2\.0<\/option>/);
});

test('AgentChatInput exposes follow-model aspect ratio as the first option', () => {
  assert.match(source, /const ratios = \[\s*\{ value: 'auto', label: '跟随模型' \}/);
  assert.match(source, /<option key=\{ratio\.value\} value=\{ratio\.value\}>\{ratio\.label\}<\/option>/);
});

test('AgentChatInput adapts its prompt language to narrative video work', () => {
  assert.match(source, /useCanvasGraphStore/);
  assert.match(source, /先在分镜表编译镜头，再检查并发送 Seedance 请求/);
  assert.match(source, /if \(storyMode && agentMode\) setAgentMode\(false\)/);
  assert.match(source, /!storyMode && \(/);
  assert.match(source, /aria-label=\{inputPlaceholder\}/);
});

test('AgentChatInput blocks unavailable Seedance submissions', () => {
  assert.match(source, /const supportsVideoCapabilities = typeof loadVideoCapabilities === 'function'/);
  assert.match(source, /const seedanceEnabled = !supportsVideoCapabilities \|\| videoCapabilities\?\.enabled === true/);
  assert.match(source, /if \(supportsVideoCapabilities\) void loadVideoCapabilities\(\)/);
  assert.match(source, /const seedanceUnavailable = isSeedanceModel\(selectedModel\) && !seedanceEnabled/);
  assert.match(source, /if \(!seedanceEnabled\)/);
  assert.match(source, /sendButtonState\.disabled \|\| seedanceUnavailable/);
});
