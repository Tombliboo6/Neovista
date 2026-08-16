import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEEDANCE_REFERENCE_VIDEO_MAX_BYTES,
  validateSeedanceReferenceVideoDuration,
  validateSeedanceReferenceVideoFile,
} from './referenceVideo.js';

function createFile({ name = 'motion.mp4', type = 'video/mp4', size = 1024 } = {}) {
  return { name, type, size };
}

test('Seedance reference video accepts MP4, WebM, and MOV files within 24 MiB', () => {
  assert.equal(validateSeedanceReferenceVideoFile(createFile()).name, 'motion.mp4');
  assert.equal(validateSeedanceReferenceVideoFile(createFile({ name: 'motion.webm', type: 'video/webm' })).type, 'video/webm');
  assert.equal(validateSeedanceReferenceVideoFile(createFile({ name: 'motion.mov', type: 'video/quicktime' })).type, 'video/quicktime');
  assert.equal(
    validateSeedanceReferenceVideoFile(createFile({ size: SEEDANCE_REFERENCE_VIDEO_MAX_BYTES })).size,
    SEEDANCE_REFERENCE_VIDEO_MAX_BYTES,
  );
});

test('Seedance reference video rejects unsupported or oversized files', () => {
  assert.throws(
    () => validateSeedanceReferenceVideoFile(createFile({ name: 'motion.avi', type: 'video/x-msvideo' })),
    /MP4、WebM 或 MOV/,
  );
  assert.throws(
    () => validateSeedanceReferenceVideoFile(createFile({ size: SEEDANCE_REFERENCE_VIDEO_MAX_BYTES + 1 })),
    /24MB/,
  );
});

test('Seedance reference video duration must be no longer than 15 seconds', () => {
  assert.equal(validateSeedanceReferenceVideoDuration(0.1), 0.1);
  assert.equal(validateSeedanceReferenceVideoDuration(15), 15);
  assert.throws(() => validateSeedanceReferenceVideoDuration(15.01), /15 秒/);
  assert.throws(() => validateSeedanceReferenceVideoDuration(Number.NaN), /读取参考视频时长/);
});

test('Seedance 2.5 reference video validation accepts the server-provided 30 second limit', () => {
  assert.equal(validateSeedanceReferenceVideoDuration(30, 30), 30);
  assert.throws(() => validateSeedanceReferenceVideoDuration(30.01, 30), /30 秒/);
});
