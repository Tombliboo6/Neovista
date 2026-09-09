import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import {
  OpenAIImagesProvider,
  OpenAIImagesProviderError
} from '../src/providers/openai-images.ts';

const originalFetch = globalThis.fetch;
const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/px5XAAAAAElFTkSuQmCC';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function request(overrides = {}) {
  return {
    taskId: 'image-task-1',
    prompt: '基础设定：测试图像。',
    sourceEntityIds: ['profiles-1', 'style-1'],
    referenceAssetIds: [],
    referenceMediaPaths: [],
    width: 1536,
    height: 1024,
    count: 1,
    quality: 'medium',
    outputFormat: 'png',
    ...overrides
  };
}

async function provider(overrides = {}) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-images-provider-'));
  return new OpenAIImagesProvider({
    apiKey: 'test-image-secret',
    baseUrl: 'https://relay.example.invalid/v1',
    model: 'gpt-image-2',
    outputDirectory,
    ...overrides
  });
}

test('Images provider sends one OpenAI-compatible generation request and saves Base64 output', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://relay.example.invalid/v1/images/generations');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-image-secret');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      model: 'gpt-image-2',
      prompt: '基础设定：测试图像。',
      n: 1,
      size: '1536x1024',
      quality: 'medium',
      output_format: 'png'
    });
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'image-request-fixture'
        }
      }
    );
  };

  const result = await (await provider()).submit(request());
  assert.equal(calls, 1);
  assert.equal(result.id, 'image-task-1');
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.approval, 'draft');
  assert.equal(result.externalTaskId, 'image-request-fixture');
  assert.equal(result.outputPaths.length, 1);
  assert.equal(existsSync(result.outputPaths[0]), true);
  assert.equal(result.parameters.model, 'gpt-image-2');
  assert.equal(result.parameters.operation, 'generation');
  assert.equal(result.parameters.dimensionsMatch, true);
  assert.deepEqual(result.parameters.outputMedia[0].actualWidth, 1536);
  assert.deepEqual(result.parameters.outputMedia[0].actualHeight, 1024);
  assert.equal(result.parameters.automaticRetry, false);
  assert.deepEqual(result.parameters.sourceEntityVersions, {});
  assert.deepEqual(result.parameters.referenceAssetVersions, {});
  assert.match(result.parameters.promptSha256, /^[a-f0-9]{64}$/);
});

test('Images provider preserves exact source and reference versions in task parameters', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  const result = await (await provider()).submit(
    request({
      sourceEntityIds: ['profile-1'],
      sourceEntityVersions: { 'profile-1': 2 },
      referenceAssetVersions: {}
    })
  );
  assert.deepEqual(result.parameters.sourceEntityVersions, { 'profile-1': 2 });
  assert.deepEqual(result.parameters.referenceAssetVersions, {});
});

test('Images provider defaults omitted quality to high', async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.quality, 'high');
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await (await provider()).submit(request({ quality: undefined }));
  assert.equal(result.parameters.quality, 'high');
});

test('Images provider blocks reference-image calls until relay edits are verified', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called');
  };
  await assert.rejects(
    () =>
      provider().then((value) =>
        value.submit(
          request({
            referenceAssetIds: ['character-1'],
            referenceMediaPaths: ['runtime-data/character-1.png']
          })
        )
      ),
    (error) => {
      assert.ok(error instanceof OpenAIImagesProviderError);
      assert.equal(error.code, 'image_edit_not_verified');
      return true;
    }
  );
});

test('Images provider sends one controlled multipart reference edit request', async () => {
  const referenceDirectory = await mkdtemp(join(tmpdir(), 'prism-reference-image-'));
  const referencePath = join(referenceDirectory, 'character-main.png');
  await writeFile(referencePath, Buffer.from(onePixelPng, 'base64'));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://relay.example.invalid/v1/images/edits');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-image-secret');
    assert.equal(options.headers['Content-Type'], undefined);
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('model'), 'gpt-image-2');
    assert.equal(options.body.get('prompt'), '基础设定：测试图像。');
    assert.equal(options.body.get('n'), '1');
    assert.equal(options.body.get('size'), '1536x1024');
    assert.equal(options.body.get('quality'), 'medium');
    assert.equal(options.body.get('output_format'), 'png');
    assert.ok(options.body.get('image[]') instanceof Blob);
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await (
    await provider({ referenceEditMode: 'probe' })
  ).submit(
    request({
      referenceAssetIds: ['character-main-1'],
      referenceAssetVersions: { 'character-main-1': 1 },
      referenceMediaPaths: [referencePath]
    })
  );
  assert.equal(calls, 1);
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.parameters.operation, 'edit');
  assert.equal(result.parameters.referenceEditMode, 'probe');
  assert.equal(result.parameters.referenceImageCount, 1);
  assert.equal(result.parameters.maxReferenceImages, undefined);
});

test('Images provider uploads all supplied references without a client-side maximum', async () => {
  const referenceDirectory = await mkdtemp(join(tmpdir(), 'prism-multi-reference-'));
  const characterPath = join(referenceDirectory, 'character.png');
  const scenePath = join(referenceDirectory, 'scene.png');
  await Promise.all([
    writeFile(characterPath, Buffer.from(onePixelPng, 'base64')),
    writeFile(scenePath, Buffer.from(onePixelPng, 'base64'))
  ]);
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    assert.equal(options.body.getAll('image[]').length, 2);
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await (
    await provider({ referenceEditMode: 'probe' })
  ).submit(request({
    referenceAssetIds: ['character-1', 'scene-1'],
    referenceAssetVersions: { 'character-1': 1, 'scene-1': 1 },
    referenceMediaPaths: [characterPath, scenePath]
  }));
  assert.equal(calls, 1);
  assert.equal(result.parameters.referenceImageCount, 2);
  assert.equal(result.parameters.maxReferenceImages, undefined);
});

test('Volcengine Seedream text-to-image uses the Ark JSON contract without OpenAI-only fields', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-seedream-output-'));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-image-secret');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: '基础设定：测试图像。',
      size: '1536x1024',
      response_format: 'url',
      output_format: 'png',
      watermark: false
    });
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'x-tt-logid': 'seedream-text-fixture' } }
    );
  };
  const seedream = new OpenAIImagesProvider({
    apiKey: 'test-image-secret',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-5-0-pro-260628',
    outputDirectory
  });

  const result = await seedream.submit(request());

  assert.equal(calls, 1);
  assert.equal(result.provider, 'volcengine-seedream');
  assert.equal(result.externalTaskId, 'seedream-text-fixture');
  assert.equal(result.parameters.protocol, 'volcengine-ark-image-generation');
  assert.equal(result.parameters.operation, 'generation');
});

test('Volcengine Seedream reference generation sends Base64 references in one Ark JSON request', async () => {
  const referenceDirectory = await mkdtemp(join(tmpdir(), 'prism-seedream-reference-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-seedream-edit-output-'));
  const referencePaths = await Promise.all(['character.png', 'scene.png'].map(async (name) => {
    const path = join(referenceDirectory, name);
    await writeFile(path, Buffer.from(onePixelPng, 'base64'));
    return path;
  }));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.equal(Array.isArray(body.image), true);
    assert.equal(body.image.length, 2);
    assert.match(body.image[0], /^data:image\/png;base64,/u);
    assert.equal(Object.hasOwn(body, 'n'), false);
    assert.equal(Object.hasOwn(body, 'quality'), false);
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  const seedream = new OpenAIImagesProvider({
    apiKey: 'test-image-secret',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-5-0-pro-260628',
    outputDirectory,
    referenceEditMode: 'probe'
  });

  const result = await seedream.submit(request({
    referenceAssetIds: ['character-1', 'scene-1'],
    referenceAssetVersions: { 'character-1': 1, 'scene-1': 1 },
    referenceMediaPaths: referencePaths
  }));

  assert.equal(calls, 1);
  assert.equal(result.parameters.operation, 'edit');
  assert.equal(result.parameters.referenceImageCount, 2);
});

test('Volcengine Seedream rejects unsupported output count, format, and dimensions before network access', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-seedream-guards-'));
  const seedream = new OpenAIImagesProvider({
    apiKey: 'test-image-secret',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-5-0-pro-260628',
    outputDirectory
  });
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called');
  };

  await assert.rejects(() => seedream.submit(request({ count: 2 })), (error) => error.code === 'seedream_single_output_only');
  await assert.rejects(() => seedream.submit(request({ outputFormat: 'webp' })), (error) => error.code === 'seedream_output_format_unsupported');
  await assert.rejects(() => seedream.submit(request({ width: 512, height: 512 })), (error) => error.code === 'seedream_dimensions_unsupported');
});

test('APIYI reverse image edit submits every supplied reference without a client cap', async () => {
  const referenceDirectory = await mkdtemp(join(tmpdir(), 'prism-apiyi-multi-reference-'));
  const referencePaths = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const path = join(referenceDirectory, `reference-${index + 1}.png`);
    await writeFile(path, Buffer.from(onePixelPng, 'base64'));
    return path;
  }));
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://api.apiyi.com/v1/images/edits');
    assert.equal(options.body.get('model'), 'gpt-image-2-all');
    assert.equal(options.body.getAll('image').length, 5);
    assert.equal(options.body.getAll('image[]').length, 0);
    assert.equal(options.body.get('n'), null);
    assert.equal(options.body.get('size'), null);
    assert.equal(options.body.get('quality'), null);
    assert.equal(options.body.get('output_format'), null);
    return new Response(
      JSON.stringify({ data: [{ b64_json: `data:image/png;base64,${pngWithDimensions(1280, 853)}` }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-apiyi-edit-output-'));
  const apiYiProvider = new OpenAIImagesProvider({
    apiKey: 'test-image-secret',
    baseUrl: 'https://api.apiyi.com/v1',
    model: 'gpt-image-2-all',
    outputDirectory,
    referenceEditMode: 'probe',
  });

  const result = await apiYiProvider.submit(request({
    referenceAssetIds: ['character-1', 'character-2', 'scene-1', 'prop-1', 'prop-2'],
    referenceAssetVersions: { 'character-1': 1, 'character-2': 1, 'scene-1': 1, 'prop-1': 1, 'prop-2': 1 },
    referenceMediaPaths: referencePaths,
  }));

  assert.equal(calls, 1);
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.parameters.referenceImageCount, 5);
  assert.equal(result.parameters.maxReferenceImages, undefined);
  assert.equal(result.parameters.dimensionsMatch, false);
  assert.equal(result.parameters.dimensionsAccepted, true);
});

test('Images provider can isolate reference edits on dedicated environment settings', async () => {
  const referenceDirectory = await mkdtemp(join(tmpdir(), 'prism-edit-environment-'));
  const referencePath = join(referenceDirectory, 'scene-main.png');
  const outputDirectory = await mkdtemp(join(tmpdir(), 'prism-edit-output-'));
  await writeFile(referencePath, Buffer.from(onePixelPng, 'base64'));
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://edit-relay.example.invalid/v1/images/edits');
    assert.equal(options.headers.Authorization, 'Bearer edit-only-secret');
    assert.equal(options.body.get('model'), 'gpt-image-2');
    return new Response(
      JSON.stringify({ data: [{ b64_json: pngWithDimensions(1536, 1024) }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const editProvider = OpenAIImagesProvider.fromEditEnvironment(
    {
      IMAGE_EDIT_API_KEY: 'edit-only-secret',
      IMAGE_EDIT_API_BASE_URL: 'https://edit-relay.example.invalid/v1',
      IMAGE_EDIT_API_MODEL: 'gpt-image-2',
      IMAGE_API_OUTPUT_DIR: outputDirectory
    },
    { referenceEditMode: 'probe' }
  );
  const result = await editProvider.submit(
    request({
      referenceAssetIds: ['scene-main-1'],
      referenceAssetVersions: { 'scene-main-1': 1 },
      referenceMediaPaths: [referencePath]
    })
  );
  assert.equal(result.status, 'awaiting_review');
  assert.equal(result.parameters.operation, 'edit');
  assert.equal(result.parameters.referenceEditMode, 'probe');
});

test('Images provider records dimension mismatch as a failed task with preserved output', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: onePixelPng }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  const result = await (await provider()).submit(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'image_dimensions_mismatch');
  assert.equal(result.outputPaths.length, 1);
  assert.equal(result.parameters.dimensionsMatch, false);
  assert.equal(result.parameters.outputMedia[0].actualWidth, 1);
  assert.equal(result.parameters.outputMedia[0].actualHeight, 1);
});

test('Images provider preserves upstream errors without exposing credentials or retrying', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Rejected credential test-image-secret'
        }
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  };

  await assert.rejects(
    () => provider().then((value) => value.submit(request())),
    (error) => {
      assert.ok(error instanceof OpenAIImagesProviderError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /test-image-secret/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('Images provider validates counts before network access', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch must not be called');
  };
  await assert.rejects(
    () => provider().then((value) => value.submit(request({ count: 5 }))),
    /between 1 and 4/
  );
});

function pngWithDimensions(width, height) {
  const bytes = Buffer.from(onePixelPng, 'base64');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

test('generation timeout retains phase and elapsed diagnostics without retrying', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  const images = await provider({ timeoutMs: 300000 });
  await assert.rejects(images.submit(request()), error => {
    assert.equal(error.code, 'image_request_timeout');
    assert.equal(error.diagnostics.phase, 'generation_request');
    assert.equal(error.diagnostics.timeoutMs, 300000);
    assert.ok(error.diagnostics.elapsedMs >= 0);
    return true;
  });
  assert.equal(calls, 1);
});

test('response body interruption retains request ID and original connection cause', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { status: 200, headers: new Headers({ 'x-request-id': 'fixture-response' }), async text() { throw new TypeError('terminated', { cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }) }); } };
  };
  await assert.rejects((await provider()).submit(request()), error => {
    assert.equal(error.code, 'network_error');
    assert.equal(error.diagnostics.phase, 'generation_response');
    assert.equal(error.diagnostics.transportCode, 'ECONNRESET');
    assert.equal(error.diagnostics.requestId, 'fixture-response');
    return true;
  });
  assert.equal(calls, 1);
});

test('image download timeout is distinguished from the completed generation request', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ data: [{ url: 'https://fixture.invalid/result.png' }] });
    throw new DOMException('timeout', 'TimeoutError');
  };
  await assert.rejects((await provider()).submit(request()), error => {
    assert.equal(error.code, 'image_request_timeout');
    assert.equal(error.diagnostics.phase, 'image_download');
    return true;
  });
  assert.equal(calls, 2);
});
