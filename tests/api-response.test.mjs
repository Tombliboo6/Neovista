import test from 'node:test';
import assert from 'node:assert/strict';

import { readApiResponse } from '../frontend/src/lib/api-response.js';

test('readApiResponse parses JSON payloads when content-type is json', async () => {
  const response = new Response(JSON.stringify({ detail: 'ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const result = await readApiResponse(response);

  assert.equal(result.isJson, true);
  assert.deepEqual(result.data, { detail: 'ok' });
  assert.equal(result.text, '');
});

test('readApiResponse preserves html error pages without throwing json parse errors', async () => {
  const response = new Response('<html><h1>504 Gateway Time-out</h1></html>', {
    status: 504,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const result = await readApiResponse(response);

  assert.equal(result.isJson, false);
  assert.equal(result.data, null);
  assert.match(result.text, /504 Gateway Time-out/);
});
