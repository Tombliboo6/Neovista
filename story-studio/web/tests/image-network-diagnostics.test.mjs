import assert from 'node:assert/strict';
import test from 'node:test';
import { safeImageMessage } from '../local-api.mjs';
import { OpenAIImagesProviderError } from '../../src/providers/openai-images.ts';
test('image timeout presents actual wait and asks to verify provider result before resubmitting', () => {
 const message=safeImageMessage(new OpenAIImagesProviderError('timeout',{code:'image_request_timeout',diagnostics:{phase:'generation_request',elapsedMs:300017,timeoutMs:300000}}));
 assert.match(message,/图片生成请求等待超时/);assert.match(message,/已等待：300秒/);assert.match(message,/等待上限：300秒/);assert.match(message,/是否已生成或扣费/);
});
test('image download failures identify the returned generation result', () => {
 const message=safeImageMessage(new OpenAIImagesProviderError('download failed',{code:'image_download_error'}));
 assert.match(message,/图片生成接口已返回，结果图片下载失败/);
});
