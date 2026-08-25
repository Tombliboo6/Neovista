import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchTemplatePromptPreview } from './templatePromptPreview.js';

test('fetchTemplatePromptPreview sends auth and structured parameters', async () => {
  let captured;
  const result = await fetchTemplatePromptPreview({
    templateId: '1.1.1',
    token: 'token-123',
    parameters: { title: '成都' },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        json: async () => ({ effective_prompt: '标题：成都', prompt_structure: { p0_text: '标题：成都' } }),
      };
    },
  });

  assert.equal(captured.url, '/api/v1/templates/1.1.1/prompt-preview');
  assert.equal(captured.options.headers.Authorization, 'Bearer token-123');
  assert.deepEqual(JSON.parse(captured.options.body).parameters, { title: '成都' });
  assert.equal(result.effectivePrompt, '标题：成都');
  assert.deepEqual(result.promptStructure, { p0_text: '标题：成都' });
});

test('fetchTemplatePromptPreview surfaces backend errors', async () => {
  await assert.rejects(
    fetchTemplatePromptPreview({
      templateId: 'missing',
      token: 'token-123',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ detail: '模版不存在' }),
      }),
    }),
    /模版不存在/,
  );
});
