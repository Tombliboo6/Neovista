import assert from 'node:assert/strict';
import test from 'node:test';

import {
  materializeStyleSelectionDraft,
  requireCharacterImagePrerequisites
} from '../src/styles/style-selection.ts';
import { applyReviewDecision } from '../src/workflow/approvals.ts';

const profileSet = {
  id: 'profiles-script-1',
  version: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved',
  scriptId: 'script-1',
  scriptVersion: 2,
  profiles: []
};

test('style selection requires approved character profiles and a user choice', () => {
  assert.throws(
    () =>
      materializeStyleSelectionDraft({
        selectionId: 'style-1',
        characterProfileSet: { ...profileSet, approval: 'reviewing' },
        source: 'style-library',
        name: '古风3D漫剧',
        stylePrompt: '古风玄幻3D漫剧视觉风格',
        selectedBy: 'user',
        timestamp: '2026-08-21T01:00:00.000Z'
      }),
    /profiles must be approved/
  );

  assert.throws(
    () =>
      materializeStyleSelectionDraft({
        selectionId: 'style-1',
        characterProfileSet: profileSet,
        source: 'recommended-preset',
        name: '古风3D漫剧',
        stylePrompt: '古风玄幻3D漫剧视觉风格',
        selectedBy: 'agent',
        timestamp: '2026-08-21T01:00:00.000Z'
      }),
    /must be selected by the user/
  );
});

test('a user selection stays draft until the exact version is approved and locked', () => {
  const selection = materializeStyleSelectionDraft({
    selectionId: 'style-1',
    characterProfileSet: profileSet,
    source: 'style-library',
    name: '古风3D漫剧',
    stylePrompt: '古风玄幻3D漫剧视觉风格',
    selectedBy: 'user',
    timestamp: '2026-08-21T01:00:00.000Z'
  });
  assert.equal(selection.approval, 'draft');
  assert.equal(selection.selectedBy, 'user');
  assert.throws(
    () => requireCharacterImagePrerequisites(profileSet, selection),
    /style must be selected and approved/
  );

  const locked = applyReviewDecision(selection, {
    id: 'review-style-1-v1',
    entityId: selection.id,
    entityVersion: selection.version,
    action: 'approve',
    createdAt: '2026-08-21T01:01:00.000Z'
  });
  assert.equal(locked.approval, 'approved');
  assert.doesNotThrow(() => requireCharacterImagePrerequisites(profileSet, locked));
  assert.throws(
    () =>
      requireCharacterImagePrerequisites(
        { ...profileSet, version: 2 },
        locked
      ),
    /does not match/
  );
});

test('uploaded style references are explicit and style versions keep a stable ID', () => {
  assert.throws(
    () =>
      materializeStyleSelectionDraft({
        selectionId: 'style-1',
        characterProfileSet: profileSet,
        source: 'reference-image',
        name: '用户参考风格',
        stylePrompt: '遵循用户上传参考图的材质与色彩体系',
        selectedBy: 'user',
        timestamp: '2026-08-21T01:00:00.000Z'
      }),
    /requires at least one reference image/
  );

  const first = materializeStyleSelectionDraft({
    selectionId: 'style-1',
    characterProfileSet: profileSet,
    source: 'reference-image',
    name: '用户参考风格',
    stylePrompt: '遵循用户上传参考图的材质与色彩体系',
    referenceMediaPaths: ['runtime-data/style-reference.png'],
    selectedBy: 'user',
    timestamp: '2026-08-21T01:00:00.000Z'
  });
  const second = materializeStyleSelectionDraft({
    selectionId: 'style-1',
    characterProfileSet: profileSet,
    source: 'custom-text',
    name: '用户自定义风格',
    stylePrompt: '东方玄幻写实动画，冷雨夜色',
    selectedBy: 'user',
    previousSelection: first,
    timestamp: '2026-08-21T02:00:00.000Z'
  });
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.equal(second.approval, 'draft');
});
