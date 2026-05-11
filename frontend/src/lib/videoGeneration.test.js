import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoTaskPollingState,
  getSeedanceCreditsPerSecond,
  getVideoUrlOrThrow,
  isSeedanceModel,
  normalizeSeedanceResolution,
  normalizeSeedanceVideoMode,
  normalizeVideoDurationSeconds,
  resolveSeedanceVideoMode,
} from './videoGeneration.js';

test('isSeedanceModel detects the Seedance video option only', () => {
  assert.equal(isSeedanceModel('seedance-2.0'), true);
  assert.equal(isSeedanceModel('nano-banana-2'), false);
});

test('getVideoUrlOrThrow returns content video_url from task responses', () => {
  const url = getVideoUrlOrThrow({
    status: 'succeeded',
    video_url: 'https://cdn.example.com/video.mp4',
  });

  assert.equal(url, 'https://cdn.example.com/video.mp4');
});

test('buildVideoTaskPollingState recognizes terminal and in-progress statuses', () => {
  assert.deepEqual(buildVideoTaskPollingState({ status: 'succeeded' }), {
    isTerminal: true,
    isSuccess: true,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'failed' }), {
    isTerminal: true,
    isSuccess: false,
  });
  assert.deepEqual(buildVideoTaskPollingState({ status: 'running' }), {
    isTerminal: false,
    isSuccess: false,
  });
});

test('normalizeVideoDurationSeconds clamps user input to 5-15 whole seconds', () => {
  assert.equal(normalizeVideoDurationSeconds('4'), 5);
  assert.equal(normalizeVideoDurationSeconds('6.8'), 6);
  assert.equal(normalizeVideoDurationSeconds('15'), 15);
  assert.equal(normalizeVideoDurationSeconds('16'), 15);
  assert.equal(normalizeVideoDurationSeconds('abc'), 5);
});

test('Seedance resolution defaults and pricing match billing rules', () => {
  assert.equal(normalizeSeedanceResolution('480p'), '480p');
  assert.equal(normalizeSeedanceResolution('720p'), '720p');
  assert.equal(normalizeSeedanceResolution('1080p'), '1080p');
  assert.equal(normalizeSeedanceResolution('2K'), '720p');
  assert.equal(getSeedanceCreditsPerSecond('480p'), 200);
  assert.equal(getSeedanceCreditsPerSecond('720p'), 250);
  assert.equal(getSeedanceCreditsPerSecond('1080p'), 300);
});

test('Seedance video mode resolves official v3 image roles by image count', () => {
  assert.equal(normalizeSeedanceVideoMode('first_frame'), 'first_frame');
  assert.equal(normalizeSeedanceVideoMode('reference_image'), 'reference_image');
  assert.equal(normalizeSeedanceVideoMode('first_last_frame'), 'first_last_frame');
  assert.equal(normalizeSeedanceVideoMode('unknown'), 'auto');
  assert.equal(resolveSeedanceVideoMode('auto', 0), 'standard');
  assert.equal(resolveSeedanceVideoMode('auto', 1), 'first_frame');
  assert.equal(resolveSeedanceVideoMode('auto', 2), 'first_last_frame');
  assert.equal(resolveSeedanceVideoMode('auto', 3), 'reference_image');
  assert.equal(resolveSeedanceVideoMode('reference_image', 2), 'reference_image');
});
