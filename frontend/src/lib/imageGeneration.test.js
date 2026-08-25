import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyImageTask,
  clearPendingImageSubmission,
  createImageRequestFingerprint,
  loadPendingImageSubmission,
  persistPendingImageSubmission,
} from './imageGeneration.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('image request fingerprint is stable across object key order without storing payload', () => {
  const first = createImageRequestFingerprint('/v1/generate', { prompt: 'x', options: { b: 2, a: 1 } });
  const second = createImageRequestFingerprint('/v1/generate', { options: { a: 1, b: 2 }, prompt: 'x' });
  assert.equal(first, second);
  assert.match(first, /^v1-[a-f0-9]{8}$/);
});

test('pending image submission is owner scoped and prevents request-id replacement', () => {
  const storage = createStorage();
  const marker = {
    requestId: 'image-request-1',
    ownerUserId: '7',
    endpoint: '/v1/generate',
    requestFingerprint: 'v1-1234abcd',
    createdAt: Date.now(),
  };
  assert.deepEqual(persistPendingImageSubmission(marker, storage), marker);
  assert.equal(loadPendingImageSubmission(storage, '8'), null);
  assert.equal(persistPendingImageSubmission({ ...marker, requestId: 'image-request-2' }, storage), null);
  assert.equal(loadPendingImageSubmission(storage, '7').requestId, 'image-request-1');
  assert.equal(clearPendingImageSubmission(storage, 'wrong-request', '7'), false);
  assert.equal(clearPendingImageSubmission(storage, 'image-request-1', '7'), true);
  assert.equal(loadPendingImageSubmission(storage, '7'), null);
});

test('image task classification requires settlement consistency', () => {
  assert.equal(classifyImageTask({
    status: 'succeeded', settlement_status: 'CAPTURED', image_url: 'data:image/png;base64,x',
  }).isSuccess, true);
  assert.equal(classifyImageTask({ status: 'succeeded', settlement_status: 'PENDING' }).isSuccess, false);
  assert.equal(classifyImageTask({ status: 'failed', settlement_status: 'REFUNDED' }).isFailed, true);
  assert.equal(classifyImageTask({ status: 'submit_unknown', settlement_status: 'REVIEW_REQUIRED' }).requiresReview, true);
});
