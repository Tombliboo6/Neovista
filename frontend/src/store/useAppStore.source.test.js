import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storeSource = readFileSync(new URL('./useAppStore.js', import.meta.url), 'utf8');

test('generateImage initializes generation request state before calling fetch', () => {
  const generateImageBlockMatch = storeSource.match(
    /generateImage:\s*async[\s\S]*?const response = await fetch\(`\$\{API_BASE\}\/v1\/generate`/,
  );

  assert.ok(generateImageBlockMatch, 'expected to find generateImage fetch block');

  const generateImageBlock = generateImageBlockMatch[0];
  assert.match(
    generateImageBlock,
    /const generationRequest = createGenerationRequestState\(\);/,
  );
  assert.match(
    generateImageBlock,
    /const clearRequestState = clearGenerationRequestState\(\);/,
  );
});

test('both image entrypoints persist a stable request id before fetch and recover by request id', () => {
  const confirmBlock = storeSource.match(
    /confirmGenerate:\s*async[\s\S]*?\n\s*dismissGenerate:/,
  )?.[0];
  const generateBlock = storeSource.match(
    /generateImage:\s*async[\s\S]*?\n\s*generateVideo:/,
  )?.[0];
  assert.ok(confirmBlock, 'expected confirmGenerate durable request block');
  assert.ok(generateBlock, 'expected generateImage durable request block');
  for (const [block, endpoint] of [
    [confirmBlock, '/generate_diagram'],
    [generateBlock, '/v1/generate'],
  ]) {
    const persistIndex = block.indexOf('persistPendingImageSubmission({');
    const fetchIndex = block.indexOf(`const response = await fetch(\`\${API_BASE}${endpoint}\``);
    assert.ok(persistIndex >= 0 && persistIndex < fetchIndex, 'request marker must persist before fetch');
    assert.match(block, /const requestId = storedPending\?\.requestId \|\| createClientRequestId\(\);/);
    assert.match(block, /request_id: requestId,/);
    assert.doesNotMatch(block, /request_id:\s*createClientRequestId\(\)/);
  }
  assert.match(storeSource, /\/v1\/image\/tasks\/by-request\/\$\{encodeURIComponent\(normalizedRequestId\)\}/);
  assert.match(storeSource, /已停止等待生图响应；这不代表云端生成已取消/);
});

test('useAppStore loads fabric lazily so the home page does not pay for workspace code', () => {
  assert.doesNotMatch(storeSource, /import \* as fabric from 'fabric';/);
  assert.match(storeSource, /const loadFabric = \(\) => import\('fabric'\);/);
  assert.match(storeSource, /const \{ FabricImage \} = await loadFabric\(\);/);
});

test('useAppStore loads generated images with cross-origin-safe fabric options', () => {
  assert.match(storeSource, /import \{[\s\S]*createCanvasSafeFabricImage,[\s\S]*safeCanvasToDataUrl,[\s\S]*\} from '..\/lib\/canvasExport\.js';/);
  assert.match(storeSource, /const img = await createCanvasSafeFabricImage\(FabricImage,\s*imageUrl\);/);
});

test('useAppStore guards every canvas export that can be triggered by user actions', () => {
  assert.match(storeSource, /safeCanvasToDataUrl\(canvas,\s*'image\/jpeg',\s*quality\)/);
  assert.match(storeSource, /safeCanvasToDataUrl\(activeObject,\s*\{/);
  assert.match(storeSource, /safeCanvasToDataUrl\(fabricInstance,\s*\{\s*format: 'png',\s*quality: 0\.8,\s*\}\)/);
});

test('bootstrapAuth restores the logged-in user from a persisted token', () => {
  assert.match(storeSource, /bootstrapAuth:\s*async\s*\(\)\s*=>/);
  assert.match(storeSource, /fetch\(`\$\{API_BASE\}\/v1\/auth\/me`/);
  assert.match(storeSource, /'Authorization':\s*`Bearer \$\{token\}`/);
});

test('generateImage success clears stale ready state and exits agent mode', () => {
  const generateImageSuccessMatch = storeSource.match(
    /generatedImage:\s*\{[\s\S]*?isGenerating:\s*false,[\s\S]*?chatInput:\s*'',[\s\S]*?canvasDataUrl:\s*null,[\s\S]*?\}\);/,
  );

  assert.ok(generateImageSuccessMatch, 'expected to find generateImage success state update');

  const generateImageSuccessBlock = generateImageSuccessMatch[0];
  assert.match(generateImageSuccessBlock, /readyToGenerate:\s*false,/);
  assert.match(generateImageSuccessBlock, /suggestedParams:\s*null,/);
  assert.match(generateImageSuccessBlock, /suggestedTemplateId:\s*null,/);
  assert.match(generateImageSuccessBlock, /agentMode:\s*false,/);
});

test('useAppStore tracks plural uploaded images instead of a single uploaded image', () => {
  assert.match(storeSource, /uploadedImages:\s*\[\],/);
  assert.match(storeSource, /setUploadedImages:\s*\(images\)\s*=>\s*set\(\{\s*uploadedImages:\s*images\s*\}\)/);
  assert.match(storeSource, /removeUploadedImageAt:\s*\(index\)\s*=>/);
});

test('useAppStore stores asset usage confirmation for upload controls', () => {
  assert.match(storeSource, /assetUsageConfirmed:\s*false,/);
  assert.match(storeSource, /setAssetUsageConfirmed:\s*\(confirmed\)\s*=>\s*set\(\{\s*assetUsageConfirmed:\s*confirmed\s*\}\)/);
});

test('useAppStore centralizes auth gating for model actions', () => {
  assert.match(storeSource, /ensureAuthenticatedForModelAction:\s*\(actionLabel\s*=\s*'当前操作'\)\s*=>\s*\{/);
  assert.match(storeSource, /if\s*\(!token\)\s*\{[\s\S]*setShowAuthModal\(true\);[\s\S]*return false;\s*\}/);
  assert.match(storeSource, /return true;/);
});

test('useAppStore stores auth modal context for blocked model actions', () => {
  assert.match(storeSource, /authModalContext:\s*null,/);
  assert.match(storeSource, /setAuthModalContext:\s*\(context\)\s*=>\s*set\(\{\s*authModalContext:\s*context\s*\}\)/);
  assert.match(storeSource, /setShowAuthModal:\s*\(show\)\s*=>\s*set\(\(state\)\s*=>\s*\(\{\s*showAuthModal:\s*show,\s*authModalContext:\s*show\s*\?\s*state\.authModalContext\s*:\s*null,\s*\}\)\)/);
  assert.match(storeSource, /setAuthModalContext\(\{\s*actionLabel,\s*message:\s*`登录后可继续\$\{actionLabel\}`\s*\}\)/);
});

test('directChat requires auth before sending model requests', () => {
  const directChatBlockMatch = storeSource.match(
    /directChat:\s*async\s*\(message,\s*imageDatas\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*workspaceChat:/,
  );

  assert.ok(directChatBlockMatch, 'expected to find directChat block');
  const directChatBlock = directChatBlockMatch[0];
  assert.match(directChatBlock, /const\s*\{\s*workspaceChatMessages,\s*token,\s*ensureAuthenticatedForModelAction\s*\}\s*=\s*get\(\);/);
  assert.match(directChatBlock, /if\s*\(!ensureAuthenticatedForModelAction\('继续对话'\)\)\s*\{\s*return;\s*\}/);
  assert.match(directChatBlock, /const userMsg = \{ role: 'user', content: message, imageDatas: \[\.\.\.normalizedImages\] \};/);
  assert.match(directChatBlock, /const apiMessages = prepareMessagesForAPI\(updated,\s*10,\s*4000\);/);
  assert.match(directChatBlock, /messages:\s*apiMessages,/);
  assert.match(directChatBlock, /'Authorization':\s*`Bearer \$\{token\}`/);
});

test('workspaceChat requires auth before sending agent requests', () => {
  const workspaceChatBlockMatch = storeSource.match(
    /workspaceChat:\s*async\s*\(message,\s*imageDatas\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*confirmGenerate:/,
  );

  assert.ok(workspaceChatBlockMatch, 'expected to find workspaceChat block');
  const workspaceChatBlock = workspaceChatBlockMatch[0];
  assert.match(workspaceChatBlock, /ensureAuthenticatedForModelAction/);
  assert.match(workspaceChatBlock, /if\s*\(!ensureAuthenticatedForModelAction\('继续 Agent 对话'\)\)\s*\{\s*return;\s*\}/);
  assert.match(workspaceChatBlock, /const userMsg = \{ role: 'user', content: message, imageDatas: \[\.\.\.normalizedImages\] \};/);
  assert.match(workspaceChatBlock, /'Authorization':\s*`Bearer \$\{token\}`/);
});

test('prepareMessagesForAPI keeps API payload text-only and trims long history by count and total chars', () => {
  const prepareBlockMatch = storeSource.match(
    /const prepareMessagesForAPI = \(messages, maxMessages = 10, maxTotalChars = 4000\) => \{[\s\S]*?return trimmedMessages\.map\(msg => \(\{\s*role: msg\.role,\s*content: msg\.content\s*\}\)\);\s*\};/
  );

  assert.ok(prepareBlockMatch, 'expected to find prepareMessagesForAPI block');
  const prepareBlock = prepareBlockMatch[0];
  assert.doesNotMatch(prepareBlock, /imageDatas/);
  assert.match(prepareBlock, /if \(apiMessages.length > maxMessages\)/);
  assert.match(prepareBlock, /while \(trimmedMessages.length > 1 && totalChars > maxTotalChars\)/);
});

test('triggerTemplateAdjustParams requires auth before calling the model', () => {
  const triggerAdjustBlockMatch = storeSource.match(
    /triggerTemplateAdjustParams:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*\/\/ 进入模板调参模式/,
  );

  assert.ok(triggerAdjustBlockMatch, 'expected to find triggerTemplateAdjustParams block');
  const triggerAdjustBlock = triggerAdjustBlockMatch[0];
  assert.match(triggerAdjustBlock, /ensureAuthenticatedForModelAction/);
  assert.match(triggerAdjustBlock, /if\s*\(!ensureAuthenticatedForModelAction\('调整模板参数'\)\)\s*\{\s*return;\s*\}/);
  assert.match(triggerAdjustBlock, /'Authorization':\s*`Bearer \$\{token\}`/);
});

test('workspace initialization authenticates the first Agent request', () => {
  const initBlockMatch = storeSource.match(
    /initWorkspaceWithMessage:\s*async\s*\(initMessage,\s*sessionId\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\n\s*directChat:/,
  );
  assert.ok(initBlockMatch, 'expected to find initWorkspaceWithMessage block');
  const initBlock = initBlockMatch[0];
  assert.match(initBlock, /ensureAuthenticatedForModelAction\('初始化工作区对话'\)/);
  assert.match(initBlock, /'Authorization':\s*`Bearer \$\{token\}`/);
});

test('useAppStore defaults generation aspect ratio to follow-model auto', () => {
  assert.match(storeSource, /aspectRatio:\s*'auto',\s*\/\/ 生图比例/);
});

test('image generation fails closed on server capabilities and is single-image only', () => {
  assert.match(storeSource, /loadImageCapabilities:\s*async\s*\(\)\s*=>/);
  assert.match(storeSource, /\$\{API_BASE\}\/v1\/image\/capabilities/);
  assert.match(storeSource, /parseImageCapabilities\(data\)/);
  assert.match(storeSource, /getImageCapabilityModel\(imageCapabilities, currentModel\)/);
  assert.match(storeSource, /num_images:\s*1/);
  assert.doesNotMatch(storeSource, /num_images:\s*numImages/);
  assert.match(storeSource, /当前版本已停用批量生图，本次只提交 1 张/);
});
