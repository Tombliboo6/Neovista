import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  OpenAIResponsesAgentProvider,
  OpenAIResponsesProviderError,
  resolveTextProviderProtocol
} from '../src/providers/openai-responses.ts';

const originalFetch = globalThis.fetch;

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages']) {
  test(`${protocol} preserves an unsupported image error without retrying as text`, async () => {
    let calls = 0;
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=';
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', code: 'unsupported_image', message: 'This model does not support image input.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = new OpenAIResponsesAgentProvider({ apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', model: 'text-only', protocol });
    await assert.rejects(provider.generate({ ...request, images: [{ id: 'SEG001-storyboard', description: '本段故事板', mediaType: 'image/png', data }] }), error => {
      assert.equal(error.status, 400);
      assert.match(error.message, /does not support image/u);
      assert.equal(JSON.stringify(error.diagnostics).includes(data), false);
      return true;
    });
    assert.equal(calls, 1);
  });

  test(`${protocol} sends actual storyboard bytes as image parts with a segment label`, async () => {
    const image = { id: 'SEG009-storyboard', description: 'SEG009整张3宫格，本段<Picture 2>', mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=' };
    let body, calls = 0;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(init.body); calls++;
      const output = protocol === 'responses'
        ? { id: 'resp-vision', model: 'vision-model', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] }
        : protocol === 'chat-completions'
          ? { id: 'chat-vision', model: 'vision-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }] }
          : { id: 'msg-vision', model: 'vision-model', type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 4 } };
      return new Response(JSON.stringify(output), { headers: { 'Content-Type': 'application/json' } });
    };
    const provider = new OpenAIResponsesAgentProvider({ apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', model: 'vision-model', protocol });
    const result = await provider.generate({ ...request, images: [image] });
    assert.equal(result.output.ok, true);
    assert.equal(calls, 1);
    const parts = protocol === 'responses' ? body.input[0].content : body.messages.find(message => message.role === 'user').content;
    assert.deepEqual(JSON.parse(parts[0].text), request.input);
    assert.match(parts[1].text, /SEG009-storyboard.*SEG009整张3宫格/u);
    if (protocol === 'responses') assert.deepEqual(parts[2], { type: 'input_image', image_url: `data:image/png;base64,${image.data}`, detail: 'high' });
    else if (protocol === 'chat-completions') assert.equal(parts[2].image_url.url, `data:image/png;base64,${image.data}`);
    else assert.deepEqual(parts[2].source, { type: 'base64', media_type: 'image/png', data: image.data });
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = {
  operation: 'test-operation',
  input: { value: 1 },
  schemaName: 'test_schema',
  instructions: 'Return the requested schema.',
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { ok: { type: 'boolean' } },
    required: ['ok']
  }
};

test('text protocol auto-detection covers official OpenAI, DeepSeek, Kimi, GLM and Anthropic endpoints', () => {
  assert.equal(resolveTextProviderProtocol('https://api.openai.com/v1', 'gpt-5.6-terra'), 'responses');
  assert.equal(resolveTextProviderProtocol('https://api.deepseek.com', 'deepseek-v4-flash'), 'chat-completions');
  assert.equal(resolveTextProviderProtocol('https://api.moonshot.cn/v1', 'kimi-k3'), 'chat-completions');
  assert.equal(resolveTextProviderProtocol('https://open.bigmodel.cn/api/paas/v4', 'glm-5.3'), 'chat-completions');
  assert.equal(resolveTextProviderProtocol('https://api.anthropic.com/v1', 'claude-sonnet-4-6'), 'anthropic-messages');
  assert.equal(resolveTextProviderProtocol('https://router.example/v1', 'deepseek-v4-flash'), 'chat-completions');
  assert.equal(resolveTextProviderProtocol('https://router.example/v1', 'custom-model', 'chat-completions'), 'chat-completions');
  assert.equal(resolveTextProviderProtocol('https://router.example/v1', 'deepseek-v4-flash', 'responses'), 'responses');
});

test('DeepSeek official profiles use one Chat Completions request and parse final JSON content', async () => {
  let requestedUrl = '';
  let requestedHeaders;
  let submittedBody;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedHeaders = init.headers;
    submittedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: 'chatcmpl-deepseek', model: 'deepseek-v4-flash',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', reasoning_content: 'private', content: '{"ok":true}' } }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'deepseek-secret', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
  });

  const generated = await provider.generate(request);

  assert.equal(provider.id, 'openai-chat-completions');
  assert.equal(requestedUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(new Headers(requestedHeaders).get('authorization'), 'Bearer deepseek-secret');
  assert.deepEqual(submittedBody.response_format, { type: 'json_object' });
  assert.equal(submittedBody.max_tokens, 32_000);
  assert.equal(submittedBody.messages[0].role, 'system');
  assert.match(submittedBody.messages[0].content, /JSON Schema/u);
  assert.deepEqual(generated.output, { ok: true });
  assert.equal(generated.externalTaskId, 'chatcmpl-deepseek');
  assert.equal(generated.usage.accountingConsistent, true);
});

test('Kimi and GLM official profiles share the verified Chat Completions contract', async () => {
  const cases = [
    { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', endpoint: 'https://api.moonshot.cn/v1/chat/completions' },
    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
  ];
  for (const item of cases) {
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        id: `chat-${item.model}`, model: item.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = new OpenAIResponsesAgentProvider({ apiKey: 'provider-secret', baseUrl: item.baseUrl, model: item.model });
    const generated = await provider.generate(request);
    assert.equal(requestedUrl, item.endpoint);
    assert.deepEqual(generated.output, { ok: true });
  }
});

test('Anthropic official profiles use Messages headers and parse text blocks', async () => {
  let requestedUrl = '';
  let requestedHeaders;
  let submittedBody;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedHeaders = init.headers;
    submittedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: 'msg-claude', model: 'claude-sonnet-4-6', type: 'message', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 9, output_tokens: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'anthropic-secret', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6',
  });

  const generated = await provider.generate(request);

  assert.equal(provider.id, 'anthropic-messages');
  assert.equal(requestedUrl, 'https://api.anthropic.com/v1/messages');
  assert.equal(new Headers(requestedHeaders).get('x-api-key'), 'anthropic-secret');
  assert.equal(new Headers(requestedHeaders).get('anthropic-version'), '2023-06-01');
  assert.equal(new Headers(requestedHeaders).has('authorization'), false);
  assert.equal(submittedBody.system[0].text.includes('JSON Schema'), true);
  assert.equal(submittedBody.messages[0].content[0].text, '{"value":1}');
  assert.equal(submittedBody.output_config.format.type, 'json_schema');
  assert.deepEqual(generated.output, { ok: true });
  assert.equal(generated.usage.calculatedTotalTokens, 13);
});

test('compatible text protocols never resubmit a failed generation automatically', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: { type: 'upstream_error', message: 'Unavailable' } }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-chat-once' },
    });
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', transientRetryCount: 2,
  });

  await assert.rejects(() => provider.generate(request), (error) => {
    assert.ok(error instanceof OpenAIResponsesProviderError);
    assert.equal(error.status, 503);
    assert.equal(error.diagnostics.externalTaskId, 'req-chat-once');
    return true;
  });
  assert.equal(attempts, 1);
});

test('Responses provider parses structured output and audits inconsistent usage', async () => {
  let submittedBody;
  globalThis.fetch = async (_url, init) => {
    submittedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: 'resp-fixture',
        status: 'completed',
        model: 'gpt-5.6-terra',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '{"ok":true}' }]
          }
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 12,
          output_tokens_details: { reasoning_tokens: 2 }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.invalid/v1',
    model: 'gpt-5.6-terra'
  });
  const result = await provider.generate(request);

  assert.deepEqual(result.output, { ok: true });
  assert.deepEqual(submittedBody.reasoning, { effort: 'high' });
  assert.equal(result.externalTaskId, 'resp-fixture');
  assert.equal(result.usage.accountingConsistent, false);
  assert.equal(result.usage.calculatedTotalTokens, 15);
});

test('Responses provider removes unsupported uniqueItems recursively without mutating the domain schema', async () => {
  let submittedBody;
  globalThis.fetch = async (_url, init) => {
    submittedBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: 'resp-schema-fixture', status: 'completed', model: 'gpt-5.6-terra',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"values":["one"]}' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const outputSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      values: { type: 'array', uniqueItems: true, items: { type: 'string' } },
    },
    required: ['values'],
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'gpt-5.6-terra',
    transientRetryCount: 0,
  });

  const result = await provider.generate({ ...request, outputSchema });

  assert.deepEqual(result.output, { values: ['one'] });
  assert.equal(outputSchema.properties.values.uniqueItems, true, 'the domain schema must remain available for local validation');
  assert.equal('uniqueItems' in submittedBody.text.format.schema.properties.values, false);
  assert.equal(submittedBody.text.format.strict, true);
});

test('Responses provider recovers transient gateway failures with the identical request', async () => {
  const submittedBodies = [];
  let attempt = 0;
  globalThis.fetch = async (_url, init) => {
    submittedBodies.push(init.body);
    attempt += 1;
    if (attempt === 1) {
      return new Response(JSON.stringify({
        error: { type: 'upstream_error', code: 'upstream_error', message: 'Temporary upstream gateway failure.' },
      }), { status: 502, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-recovery-1' } });
    }
    if (attempt === 2) {
      return new Response('<html>gateway unavailable</html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html', 'x-request-id': 'req-recovery-2' },
      });
    }
    return new Response(JSON.stringify({
      id: 'resp-recovered', status: 'completed', model: 'gpt-5.6-terra',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'gpt-5.6-terra',
    transientRetryCount: 2, retryBaseDelayMs: 0,
  });

  const result = await provider.generate({
    ...request,
    operation: 'plan-storyboard-board-panels-batch',
    input: { segments: [{ segmentKey: 'SEG001' }, { segmentKey: 'SEG002' }] },
  });

  assert.deepEqual(result.output, { ok: true });
  assert.equal(attempt, 3);
  assert.equal(new Set(submittedBodies).size, 1, 'recovery must not change the request body');
  assert.equal(result.recovery.attemptCount, 3);
  assert.equal(result.recovery.retryCount, 2);
  assert.equal(result.recovery.recoveredAfterTransientFailure, true);
  assert.deepEqual(result.recovery.transientFailures.map((item) => item.status), [502, 503]);
  assert.deepEqual(result.recovery.transientFailures.map((item) => item.externalTaskId), ['req-recovery-1', 'req-recovery-2']);
});

test('Responses provider stops after two bounded gateway recovery attempts and retains every request id', async () => {
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    return new Response(JSON.stringify({
      error: { type: 'upstream_error', code: 'upstream_error', message: 'Temporary upstream gateway failure.' },
    }), { status: 502, headers: { 'Content-Type': 'application/json', 'x-request-id': `req-terminal-${attempt}` } });
  };
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'gpt-5.6-terra',
    transientRetryCount: 2, retryBaseDelayMs: 0,
  });

  await assert.rejects(
    () => provider.generate({
      ...request,
      operation: 'plan-storyboard-board-panels-batch',
      input: { segments: [{ segmentKey: 'SEG001' }] },
    }),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(attempt, 3);
      assert.equal(error.diagnostics.attemptCount, 3);
      assert.equal(error.diagnostics.retryCount, 2);
      assert.deepEqual(error.diagnostics.transientFailures.map((item) => item.externalTaskId), ['req-terminal-1', 'req-terminal-2']);
      assert.equal(error.diagnostics.externalTaskId, 'req-terminal-3');
      return true;
    },
  );
});

test('Responses provider accepts JSON wrapped in a single markdown fence', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-fenced-fixture',
        status: 'completed',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '\n```json\n{"ok":true}\n```\n' }]
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });
  const result = await provider.generate(request);

  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.externalTaskId, 'resp-fenced-fixture');
});

test('Responses provider repairs a complete storyboard batch with misplaced semantic closers', async () => {
  const malformed = '{"items":[{"segmentKey":"SEG001","plan":{"semanticDecision":{"excludedElements":["文字"]},"decisionBasis":["剧本依据"]},"referenceRequirements":{"characters":[]},"panels":[],"imagePromptSections":{}}}]}]';
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp-repaired-structure', status: 'completed', model: 'deepseek-v4-flash',
    output: [{ type: 'message', content: [{ type: 'output_text', text: malformed }] }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://api.deepseek.invalid', model: 'deepseek-v4-flash', protocol: 'responses',
  });

  const strings = { type: 'array', items: { type: 'string' } };
  const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
  const result = await provider.generate({ ...request, outputSchema: object({ items: { type: 'array', items: object({
    segmentKey: { type: 'string' }, plan: object({
      semanticDecision: object({ excludedElements: strings, decisionBasis: strings }),
      referenceRequirements: object({ characters: strings }), panels: { type: 'array', items: object({}) }, imagePromptSections: object({}),
    }),
  }) } }) });

  assert.equal(result.output.items[0].segmentKey, 'SEG001');
  assert.deepEqual(result.output.items[0].plan.semanticDecision.decisionBasis, ['剧本依据']);
  assert.deepEqual(result.output.items[0].plan.referenceRequirements.characters, []);
});

test('Responses provider extracts one valid JSON value from surrounding explanation text', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-explained-fixture',
        status: 'completed',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '以下是本轮结果：\n```json\n{"ok":true}\n```\n请查收。' }]
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });
  const result = await provider.generate(request);

  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.externalTaskId, 'resp-explained-fixture');
});

test('Responses provider rejects ambiguous output containing multiple valid JSON values', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-ambiguous-fixture',
        status: 'completed',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '候选一：{"ok":true}\n候选二：{"ok":false}' }]
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.code, 'invalid_structured_output');
      assert.equal(error.diagnostics.externalTaskId, 'resp-ambiguous-fixture');
      return true;
    }
  );
});

test('Responses provider retains invalid output diagnostics without printing source content', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-invalid-fixture',
        status: 'completed',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'not-json test-secret' }]
          }
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 7,
          total_tokens: 27,
          output_tokens_details: { reasoning_tokens: 3 }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'invalid_structured_output');
      assert.equal(error.diagnostics.externalTaskId, 'resp-invalid-fixture');
      assert.equal(error.diagnostics.returnedModel, 'deepseek-v4-flash');
      assert.equal(error.diagnostics.usage.inputTokens, 20);
      assert.equal(error.diagnostics.rawOutputText, 'not-json [REDACTED]');
      assert.equal(Object.keys(error).includes('diagnostics'), false);
      assert.doesNotMatch(JSON.stringify(error), /not-json|test-secret/);
      return true;
    }
  );
});

test('Responses provider retains incomplete response reason and partial output diagnostics', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-incomplete-fixture',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: '{"ok":' }]
          }
        ],
        usage: {
          input_tokens: 30,
          output_tokens: 100,
          total_tokens: 130,
          output_tokens_details: { reasoning_tokens: 90 }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'incomplete_response');
      assert.match(error.message, /max_output_tokens/);
      assert.equal(error.diagnostics.externalTaskId, 'resp-incomplete-fixture');
      assert.equal(error.diagnostics.responseStatus, 'incomplete');
      assert.equal(error.diagnostics.incompleteReason, 'max_output_tokens');
      assert.equal(error.diagnostics.usage.reasoningTokens, 90);
      assert.equal(error.diagnostics.rawOutputText, '{"ok":');
      assert.equal(Object.keys(error).includes('diagnostics'), false);
      return true;
    }
  );
});

test('Responses provider retains safe structure diagnostics when completed output has no text', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp-reasoning-only-fixture',
        status: 'completed',
        model: 'deepseek-v4-flash',
        output: [
          {
            type: 'reasoning',
            content: [{ type: 'reasoning_text', text: 'hidden reasoning' }]
          }
        ],
        usage: {
          input_tokens: 40,
          output_tokens: 12,
          total_tokens: 52,
          output_tokens_details: { reasoning_tokens: 12 }
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses'
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'missing_output_text');
      assert.equal(error.diagnostics.externalTaskId, 'resp-reasoning-only-fixture');
      assert.equal(error.diagnostics.responseStatus, 'completed');
      assert.equal(error.diagnostics.usage.reasoningTokens, 12);
      assert.deepEqual(error.diagnostics.outputItemSummary, [
        { type: 'reasoning', contentTypes: ['reasoning_text'] }
      ]);
      assert.equal(error.diagnostics.rawOutputText, undefined);
      assert.doesNotMatch(JSON.stringify(error), /hidden reasoning/);
      return true;
    }
  );
});

test('Responses provider redacts credentials from upstream errors', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Rejected credential test-secret'
        }
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://example.invalid/v1',
    model: 'gpt-5.6-terra'
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /test-secret/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test('Responses provider retains safe operation scope and request id for upstream failures', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { type: 'upstream_error', code: 'upstream_error', message: 'Temporary upstream gateway failure.' },
  }), { status: 502, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-upstream-502' } });
  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'gpt-5.6-terra',
    transientRetryCount: 0,
  });

  await assert.rejects(
    () => provider.generate({
      ...request,
      operation: 'plan-storyboard-board-panels-batch',
      input: { segments: [{ segmentKey: 'SEG001' }, { segmentKey: 'SEG002' }] },
    }),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'upstream_error');
      assert.equal(error.diagnostics.operation, 'plan-storyboard-board-panels-batch');
      assert.deepEqual(error.diagnostics.targetKeys, ['SEG001', 'SEG002']);
      assert.equal(error.diagnostics.requestedModel, 'gpt-5.6-terra');
      assert.equal(error.diagnostics.externalTaskId, 'req-upstream-502');
      assert.ok(Number.isFinite(error.diagnostics.elapsedMs));
      return true;
    },
  );
});

for (const protocol of ['responses', 'chat-completions', 'anthropic-messages']) {
  test(`${protocol} reports the local request deadline and submits only once`, async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        const watchdog = setTimeout(() => reject(new Error('Request deadline did not abort fetch')), 1000);
        const aborted = () => { clearTimeout(watchdog); reject(init.signal.reason); };
        if (init.signal.aborted) aborted();
        else init.signal.addEventListener('abort', aborted, { once: true });
      });
    };
    const provider = new OpenAIResponsesAgentProvider({
      apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'fixture-model',
      protocol, timeoutMs: 20,
    });
    await assert.rejects(() => provider.generate({ ...request, operation: 'adapt-novel-to-series-plan' }), error => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.code, 'request_timeout');
      assert.equal(error.diagnostics.timeoutMs, 20);
      assert.equal(error.diagnostics.operation, 'adapt-novel-to-series-plan');
      assert.equal(error.diagnostics.attemptCount, 1);
      assert.equal(error.diagnostics.retryCount, 0);
      assert.equal(error.status, undefined);
      return true;
    });
    assert.equal(calls, 1);
  });

  test(`${protocol} preserves a network failure before the request deadline`, async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
    const provider = new OpenAIResponsesAgentProvider({
      apiKey: 'test-secret', baseUrl: 'https://example.invalid/v1', model: 'fixture-model',
      protocol, timeoutMs: 300_000,
    });
    await assert.rejects(() => provider.generate(request), error => {
      assert.equal(error.code, 'network_error');
      assert.equal(error.diagnostics.timeoutMs, undefined);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('Responses provider classifies timeout while reading a started response body', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    async text() { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
  });

  const provider = new OpenAIResponsesAgentProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://api.deepseek.invalid',
    model: 'deepseek-v4-flash',
    protocol: 'responses',
    timeoutMs: 360_000,
  });

  await assert.rejects(
    () => provider.generate(request),
    (error) => {
      assert.ok(error instanceof OpenAIResponsesProviderError);
      assert.equal(error.status, 200);
      assert.equal(error.code, 'response_body_timeout');
      assert.doesNotMatch(error.message, /test-secret/);
      return true;
    },
  );
});
