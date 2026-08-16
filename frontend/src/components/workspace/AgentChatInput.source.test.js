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

test('AgentChatInput renders only server-advertised image models', () => {
  assert.match(source, /imageModels\.map\(\(model\) =>/);
  assert.match(source, /<option key=\{model\.id\} value=\{model\.id\}>\{model\.label\}<\/option>/);
  assert.doesNotMatch(source, /<option value="nano-banana-pro">/);
});

test('AgentChatInput derives aspect ratios from validated model capabilities', () => {
  assert.match(source, /selectedImageModel\?\.aspectRatios/);
  assert.match(source, /activeVideoCapabilities\?\.aspect_ratios/);
  assert.match(source, /value === 'auto' \? '跟随模型' : value/);
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
  assert.match(source, /const activeSeedanceEnabled = isUsableVideoCapabilities\(videoCapabilities, selectedModel\)/);
  assert.match(source, /void loadVideoCapabilities\(\)/);
  assert.match(source, /const seedanceUnavailable = isSeedanceModel\(selectedModel\) && !activeSeedanceEnabled/);
  assert.match(source, /if \(!activeSeedanceEnabled\)/);
  assert.match(source, /sendButtonState\.disabled \|\| seedanceUnavailable \|\| imageUnavailable \|\| canvasDraftBlocked/);
});

test('AgentChatInput blocks stale canvas requests and clears a valid draft after send', () => {
  assert.match(source, /compareGenerationRequest/);
  assert.match(source, /markGenerationDraftStale/);
  assert.match(source, /canvasDraftBlocked/);
  assert.match(source, /clearGenerationDraft\(\)/);
});
