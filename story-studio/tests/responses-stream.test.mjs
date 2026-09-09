import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { OpenAIResponsesAgentProvider } from '../src/providers/openai-responses.ts';
import { readResponsesStream } from '../src/providers/responses-stream.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const request = { operation: 'stream-fixture', input: {}, schemaName: 'fixture', instructions: 'Return JSON.', outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
const provider = options => new OpenAIResponsesAgentProvider({ apiKey: 'fixture-secret', baseUrl: 'https://fixture.invalid/v1', model: 'test-model', ...options });
const envelope = (overrides = {}) => ({ id: 'resp-stream', model: 'test-model', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"text":"中文🙂"}' }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, ...overrides });
const event = (type, fields = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
function streamResponse(source, { chunkSize = 7, keepOpen = false, failAfter = false, onCancel = () => {} } = {}) {
  const bytes = new TextEncoder().encode(source); let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) { controller.enqueue(bytes.slice(offset, offset + chunkSize)); offset += chunkSize; }
      else if (failAfter) controller.error(new Error('read ECONNRESET'));
      else if (!keepOpen) controller.close();
    }, cancel: onCancel,
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'x-request-id': 'gateway-fixture' } });
}
const delta = text => event('response.output_text.delta', { output_index: 1, content_index: 0, delta: text });

test('Responses streams decode split UTF-8, ignore gateway metadata, and validate the completed envelope', async () => {
  let calls = 0;
  const source = ': heartbeat\r\n\r\n' + event('response.created', { response: envelope({ status: 'in_progress', output: [] }) })
    + event('codex.rate_limits', { rate_limits: {} }) + delta('{"text":"中文🙂"}')
    + event('response.output_text.done', { output_index: 1, text: '{"text":"中文🙂"}' })
    + event('response.completed', { response: envelope() });
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://fixture.invalid/v1/responses');
    const payload = JSON.parse(init.body); assert.equal(payload.stream, true); assert.equal(payload.text.format.type, 'json_schema');
    assert.match(init.headers.Accept, /text\/event-stream/);
    return streamResponse(source, { chunkSize: 1 });
  };
  const result = await provider().generate(request);
  assert.equal(calls, 1); assert.deepEqual(result.output, { text: '中文🙂' });
  assert.equal(result.externalTaskId, 'resp-stream'); assert.equal(result.usage.reportedTotalTokens, 15);
});

test('completion returns without waiting for gateway EOF and cancels the reader', async () => {
  let cancelled = false;
  const response = streamResponse(event('response.completed', { response: envelope() }) + 'data: [DONE]\n\n', { chunkSize: 10000, keepOpen: true, onCancel: () => { cancelled = true; } });
  assert.deepEqual(await readResponsesStream(response, new AbortController().signal, Date.now()), envelope());
  assert.equal(cancelled, true);
});

test('SSE supports multiline data, event field fallback, CR delimiters and EOF without a trailing blank line', async () => {
  const data = JSON.stringify({ response: envelope() }, null, 2).split('\n').map(line => `data: ${line}`).join('\r');
  const response = streamResponse(`event: response.completed\r${data}`, { chunkSize: 11 });
  assert.deepEqual(await readResponsesStream(response, new AbortController().signal, Date.now()), envelope());
});

for (const ending of ['', 'data: [DONE]\n\n']) test(`partial valid JSON with ${ending ? 'DONE' : 'EOF'} is never accepted or retried`, async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return streamResponse(delta('{"text":"draft fixture-secret"}') + ending); };
  await assert.rejects(provider().generate(request), error => {
    assert.equal(error.code, 'stream_incomplete'); assert.equal(error.diagnostics.externalTaskId, 'gateway-fixture');
    assert.match(error.diagnostics.rawOutputText, /draft/); assert.ok(!error.diagnostics.rawOutputText.includes('fixture-secret'));
    assert.ok(error.diagnostics.stream.receivedBytes > 0); assert.equal(error.diagnostics.stream.eventCount, 1); return true;
  });
  assert.equal(calls, 1);
});

test('connection reset retains partial text and response ID with one submission', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return streamResponse(event('response.created', { response: envelope({ status: 'in_progress', output: [] }) }) + delta('部分正文'), { failAfter: true }); };
  await assert.rejects(provider().generate(request), error => {
    assert.equal(error.code, 'response_body_read_error'); assert.equal(error.diagnostics.externalTaskId, 'resp-stream');
    assert.equal(error.diagnostics.rawOutputText, '部分正文'); return true;
  });
  assert.equal(calls, 1);
});

test('stalled stream respects the local timeout, cancels transport and retains draft', async () => {
  let cancelled = false;
  globalThis.fetch = async () => streamResponse(delta('部分正文'), { keepOpen: true, onCancel: () => { cancelled = true; } });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(provider({ timeoutMs: 40 }).generate(request), error => {
      assert.equal(error.code, 'response_body_timeout'); assert.equal(error.diagnostics.timeoutMs, 40);
      assert.equal(error.diagnostics.rawOutputText, '部分正文'); return true;
    });
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});

test('stream failure preserves upstream code, message, request and draft without retry', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return streamResponse(delta('正文') + event('response.failed', { response: envelope({ status: 'failed', error: { code: 'upstream_error', message: 'gateway failed' } }) })); };
  await assert.rejects(provider().generate(request), error => {
    assert.equal(error.code, 'upstream_error'); assert.match(error.message, /gateway failed/);
    assert.equal(error.diagnostics.rawOutputText, '正文'); assert.equal(error.diagnostics.responseStatus, 'failed'); return true;
  });
  assert.equal(calls, 1);
});

test('incomplete terminal envelope still fails with usage and truncation reason', async () => {
  globalThis.fetch = async () => streamResponse(event('response.incomplete', { response: envelope({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) }));
  await assert.rejects(provider().generate(request), error => {
    assert.equal(error.code, 'incomplete_response'); assert.equal(error.diagnostics.incompleteReason, 'max_output_tokens');
    assert.equal(error.diagnostics.usage.reportedTotalTokens, 15); return true;
  });
});

test('malformed events and contradictory completion status fail safely', async () => {
  for (const source of ['data: {broken}\n\n', event('response.completed', { response: envelope({ status: 'in_progress' }) }), event('response.incomplete', { response: envelope() })]) {
    globalThis.fetch = async () => streamResponse(source);
    await assert.rejects(provider().generate(request), error => error.code === 'invalid_stream_event');
  }
});

test('completed streams still enforce business JSON schema and returned model', async () => {
  for (const [response, code] of [
    [envelope({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"wrong":true}' }] }] }), 'schema_validation_failed'],
    [envelope({ model: 'other-model' }), 'model_mismatch'],
  ]) {
    globalThis.fetch = async () => streamResponse(event('response.completed', { response }));
    await assert.rejects(provider().generate(request), error => error.code === code);
  }
});

test('gateway JSON response to a streaming request is consumed once without another generation', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(JSON.parse(init.body).stream, true); return Response.json(envelope()); };
  assert.deepEqual((await provider().generate(request)).output, { text: '中文🙂' }); assert.equal(calls, 1);
});

test('provider health requires matching model metadata and rejects HTML success pages', async () => {
  for (const [body, status] of [['<html>Home</html>', 'backend_offline'], ['{}', 'backend_offline'], ['{"id":"other"}', 'model_missing'], ['{"id":"test-model"}', 'ok']]) {
    globalThis.fetch = async () => new Response(body);
    assert.equal((await provider().health()).status, status);
  }
});
