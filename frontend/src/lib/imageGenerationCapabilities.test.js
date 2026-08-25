import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImageCapabilityModel,
  normalizeImageAspectRatio,
  normalizeImageResolution,
  parseImageCapabilities,
} from './imageGenerationCapabilities.js';

const payload = {
  enabled: true,
  default_model: 'nano-banana-2',
  max_num_images: 1,
  models: [
    {
      id: 'nano-banana-2',
      label: 'Nano 2',
      provider_model: 'gemini-2-image',
      resolution_semantics: 'pixel_size',
      resolutions: [
        { value: '1K', label: '1K', credits: 30 },
        { value: '2K', label: '2K', credits: 50 },
      ],
      aspect_ratios: ['1:1', '16:9'],
      supports_reference_images: true,
    },
    {
      id: 'gpt-image-2',
      label: 'GPT Image 2.0',
      provider_model: 'gpt-image-2',
      resolution_semantics: 'quality',
      resolutions: [
        { value: '1K', label: '低质量', credits: 30 },
        { value: '2K', label: '中质量', credits: 50 },
      ],
      aspect_ratios: ['1:1'],
      supports_reference_images: true,
    },
  ],
};

test('strictly parses server-owned image model, resolution, and price options', () => {
  const capabilities = parseImageCapabilities(payload);

  assert.equal(capabilities.enabled, true);
  assert.equal(capabilities.maxNumImages, 1);
  assert.equal(getImageCapabilityModel(capabilities, 'gpt-image-2').resolutionSemantics, 'quality');
  assert.equal(getImageCapabilityModel(capabilities, 'gpt-image-2').resolutions[1].label, '中质量');
  assert.equal(normalizeImageResolution(capabilities, 'nano-banana-2', '2K'), '2K');
  assert.equal(normalizeImageResolution(capabilities, 'nano-banana-2', 'missing'), '1K');
  assert.equal(normalizeImageAspectRatio(capabilities, 'nano-banana-2', '16:9'), '16:9');
  assert.equal(normalizeImageAspectRatio(capabilities, 'gpt-image-2', '16:9'), '1:1');
});

test('fails closed on malformed models, prices, and defaults', () => {
  assert.throws(() => parseImageCapabilities({ ...payload, models: [] }), /不完整/);
  assert.throws(() => parseImageCapabilities({ ...payload, default_model: 'missing' }), /不完整/);
  assert.throws(() => parseImageCapabilities({
    ...payload,
    models: [{ ...payload.models[0], resolutions: [{ value: '1K', label: '1K' }] }],
  }), /不完整/);
});

test('accepts Nano Pro only when the server advertises a distinct provider mapping', () => {
  const nanoPro = {
    ...payload.models[0],
    id: 'nano-banana-pro',
    label: 'Nano Pro',
    provider_model: 'cn-relay-nano-pro',
  };
  const parsed = parseImageCapabilities({
    ...payload,
    default_model: 'nano-banana-pro',
    models: [nanoPro],
  });
  assert.equal(parsed.models[0].id, 'nano-banana-pro');
  assert.equal(parsed.models[0].providerModel, 'cn-relay-nano-pro');
});

test('accepts an explicit disabled response without inventing fallback models', () => {
  const capabilities = parseImageCapabilities({ enabled: false, models: [] });
  assert.equal(capabilities.enabled, false);
  assert.deepEqual(capabilities.models, []);
});
