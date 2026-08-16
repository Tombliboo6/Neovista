import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareGenerationRequest,
  createGenerationRequestDto,
  createImmutableGenerationRequest,
  createReferenceSignature,
  getVideoModelCapabilities,
  isUsableVideoCapabilities,
} from './canvasGenerationDraft.js';

const capabilities = {
  enabled: true,
  min_duration_seconds: 5,
  max_duration_seconds: 15,
  default_resolution: '720p',
  resolution_credits_per_second: { '720p': 250, '1080p': 300, '4k': 600 },
  aspect_ratios: ['16:9', '9:16'],
  max_reference_images: 9,
};

const multiModelCapabilities = {
  ...capabilities,
  model: 'seedance-2.0',
  models: [
    {
      id: 'seedance-2.0',
      label: 'Seedance 2.0',
      min_duration_seconds: 4,
      max_duration_seconds: 15,
      default_resolution: '720p',
      resolution_credits_per_second: { '720p': 250, '1080p': 300, '4k': 600 },
      aspect_ratios: ['16:9', '9:16'],
      max_reference_images: 9,
      supports_reference_video: true,
      max_reference_video_duration_seconds: 15,
    },
    {
      id: 'seedance-2.5',
      label: 'Seedance 2.5',
      min_duration_seconds: 2,
      max_duration_seconds: 30,
      default_resolution: '720p',
      resolution_credits_per_second: { '720p': 275, '1080p': 330, '4k': 660 },
      aspect_ratios: ['16:9', '9:16'],
      max_reference_images: 9,
      supports_reference_video: true,
      max_reference_video_duration_seconds: 30,
    },
  ],
};

test('selects model-specific Seedance 2.5 limits and pricing', () => {
  const selected = getVideoModelCapabilities(multiModelCapabilities, 'seedance-2.5');
  assert.equal(selected.max_duration_seconds, 30);
  assert.equal(isUsableVideoCapabilities(multiModelCapabilities, 'seedance-2.5'), true);

  const request = createGenerationRequestDto({
    model: 'seedance-2.5',
    prompt: '连续产品运镜',
    duration: 30,
    resolution: '1080p',
    aspectRatio: '16:9',
    frameMode: 'standard',
    capabilities: multiModelCapabilities,
  });
  assert.equal(request.duration, 30);
  assert.equal(request.creditsPerSecond, 330);
  assert.equal(request.estimatedCredits, 9900);
});

test('creates a normalized immutable request DTO from server capabilities', () => {
  const compiled = createImmutableGenerationRequest({
    model: 'seedance-2.0',
    prompt: '  雨夜广场  ',
    duration: '99',
    resolution: 'unknown',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceImages: ['data:image/png;base64,one', 'data:image/png;base64,two'],
    capabilities,
  });

  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled.request), true);
  assert.deepEqual(compiled.request, {
    model: 'seedance-2.0',
    prompt: '雨夜广场',
    duration: 15,
    resolution: '720p',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceCount: 2,
    referenceSignature: createReferenceSignature([
      'data:image/png;base64,one',
      'data:image/png;base64,two',
    ]),
    hasReferenceVideo: false,
    referenceVideoSignature: null,
    creditsPerSecond: 250,
    estimatedCredits: 3750,
  });
  assert.match(compiled.fingerprint, /^REQ-[A-F0-9]{32}$/);
});

test('two semantic references stay reference images instead of becoming first/last frames', () => {
  const request = createGenerationRequestDto({
    prompt: '角色走入场景',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceImages: ['character', 'scene'],
    capabilities,
  });

  assert.equal(request.frameMode, 'reference_image');
});

test('reference video becomes part of the immutable request and mode fingerprint', () => {
  const request = createGenerationRequestDto({
    prompt: '跟随参考视频的镜头运动',
    duration: 5,
    resolution: '1080p',
    aspectRatio: '16:9',
    frameMode: 'auto',
    hasReferenceVideo: true,
    referenceVideoSignature: 'video:abc123',
    capabilities,
  });

  assert.equal(request.frameMode, 'reference_video');
  assert.equal(request.hasReferenceVideo, true);
  assert.equal(request.referenceVideoSignature, 'video:abc123');
  assert.deepEqual(
    compareGenerationRequest(request, { ...request, referenceVideoSignature: 'video:def456' }).changedFields,
    ['referenceVideoSignature'],
  );
});

test('detects every send-affecting field and reference order as stale', () => {
  const original = createGenerationRequestDto({
    prompt: '角色走入场景',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceImages: ['character', 'scene'],
    capabilities,
  });
  const modified = createGenerationRequestDto({
    prompt: '角色跑入场景',
    duration: 6,
    resolution: '4k',
    aspectRatio: '9:16',
    frameMode: 'first_last_frame',
    referenceImages: ['scene', 'character'],
    capabilities,
  });
  const comparison = compareGenerationRequest(original, modified);

  assert.equal(comparison.stale, true);
  assert.deepEqual(comparison.changedFields, [
    'prompt',
    'duration',
    'resolution',
    'aspectRatio',
    'frameMode',
    'referenceSignature',
    'creditsPerSecond',
    'estimatedCredits',
  ]);
});

test('price changes invalidate a compiled request before submission', () => {
  const original = createGenerationRequestDto({
    prompt: '镜头',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceImages: ['character'],
    capabilities,
  });
  const repriced = createGenerationRequestDto({
    prompt: '镜头',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    frameMode: 'reference_image',
    referenceImages: ['character'],
    capabilities: {
      ...capabilities,
      resolution_credits_per_second: { ...capabilities.resolution_credits_per_second, '720p': 300 },
    },
  });

  assert.deepEqual(compareGenerationRequest(original, repriced).changedFields, [
    'creditsPerSecond',
    'estimatedCredits',
  ]);
});

test('capabilities are fail-closed when pricing or bounds are missing', () => {
  assert.equal(isUsableVideoCapabilities(capabilities), true);
  assert.equal(isUsableVideoCapabilities(null), false);
  assert.equal(isUsableVideoCapabilities({ enabled: true }), false);
  assert.equal(isUsableVideoCapabilities({ ...capabilities, resolution_credits_per_second: {} }), false);
});
