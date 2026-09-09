import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCharacterTurnaroundRequest,
  CHARACTER_TURNAROUND_NEGATIVE_TERMS,
  CharacterTurnaroundValidationError,
  compileCharacterTurnaroundPrompt
} from '../src/characters/turnaround-generation.ts';

const mainAsset = {
  id: 'character-main-lin-wushuang',
  version: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved',
  kind: 'character',
  name: '林无双',
  description: '林无双Oii式人物主资产',
  promptAnchor: '已批准人物主资产提示词V2',
  mediaPaths: ['runtime-data/generated-images/character-main-lin-wushuang.png'],
  sourceEntityIds: ['profile-lin', 'style-episode-1'],
  characterProfileId: 'profile-lin',
  presentation: 'main-card'
};

const exactApproval = {
  id: 'review-character-main-lin-wushuang-v1',
  entityId: mainAsset.id,
  entityVersion: mainAsset.version,
  action: 'approve',
  createdAt: '2026-08-21T01:00:00.000Z'
};

function requestInput(overrides = {}) {
  return {
    taskId: 'character-turnaround-lin-wushuang-v1',
    mainAsset,
    mainAssetReviewDecisions: [exactApproval],
    referenceEditMode: 'verified',
    ...overrides
  };
}

test('turnaround prompt is a fixed five-section Chinese template without an Agent call', () => {
  const prompt = compileCharacterTurnaroundPrompt();
  for (const heading of [
    '基础设定',
    '氛围、画质与摄影风格',
    '画面内容与布局',
    '摄影机与成像',
    '负面词'
  ]) {
    assert.equal(prompt.split(heading).length - 1, 1, `${heading} should appear once`);
  }
  assert.match(prompt, /唯一身份、脸部、发型、体型、服装与画风参考/);
  assert.match(prompt, /当前上传的唯一图片/);
  assert.match(prompt, /完整正面、严格左侧面、完整背面/);
  assert.match(prompt, /自然下垂的空手站姿/);
  assert.match(prompt, /严格沿用主资产参考图已经呈现的画风/);
  assert.doesNotMatch(prompt, /林无双|张浩然|3D玄幻/);
  assert.doesNotMatch(prompt, /声音总则/);
  assert.equal(CHARACTER_TURNAROUND_NEGATIVE_TERMS.length, 8);
});

test('turnaround request binds one approved main asset and its exact version', () => {
  const request = buildCharacterTurnaroundRequest(requestInput());
  assert.equal(request.width, 1536);
  assert.equal(request.height, 1024);
  assert.equal(request.count, 1);
  assert.equal(request.quality, 'high');
  assert.equal(request.outputFormat, 'png');
  assert.deepEqual(request.sourceEntityIds, [mainAsset.id]);
  assert.deepEqual(request.sourceEntityVersions, { [mainAsset.id]: 1 });
  assert.deepEqual(request.referenceAssetIds, [mainAsset.id]);
  assert.deepEqual(request.referenceAssetVersions, { [mainAsset.id]: 1 });
  assert.deepEqual(request.referenceMediaPaths, mainAsset.mediaPaths);
});

test('turnaround request rejects a main asset without exact version approval', () => {
  assert.throws(
    () =>
      buildCharacterTurnaroundRequest(
        requestInput({
          mainAssetReviewDecisions: [{ ...exactApproval, entityVersion: 2 }]
        })
      ),
    (error) => {
      assert.ok(error instanceof CharacterTurnaroundValidationError);
      assert.equal(error.code, 'main_asset_not_approved');
      return true;
    }
  );
});

test('turnaround request remains disabled until reference editing is verified', () => {
  assert.throws(
    () =>
      buildCharacterTurnaroundRequest(
        requestInput({ referenceEditMode: 'disabled' })
      ),
    (error) => {
      assert.ok(error instanceof CharacterTurnaroundValidationError);
      assert.equal(error.code, 'image_edit_not_verified');
      return true;
    }
  );
});

test('turnaround request allows an explicit one-time probe without marking capability verified', () => {
  const request = buildCharacterTurnaroundRequest(
    requestInput({ referenceEditMode: 'probe' })
  );
  assert.equal(request.referenceMediaPaths.length, 1);
  assert.equal(request.count, 1);
});

test('turnaround request rejects derived assets and multiple reference images', () => {
  assert.throws(
    () =>
      buildCharacterTurnaroundRequest(
        requestInput({ mainAsset: { ...mainAsset, presentation: 'turnaround' } })
      ),
    /requires a character main-card asset/
  );
  assert.throws(
    () =>
      buildCharacterTurnaroundRequest(
        requestInput({
          mainAsset: {
            ...mainAsset,
            mediaPaths: [...mainAsset.mediaPaths, 'runtime-data/generated-images/extra.png']
          }
        })
      ),
    /exactly one approved main-asset reference image/
  );
});
