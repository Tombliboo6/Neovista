import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReviewDecision,
  requireApprovedVersion
} from '../src/workflow/approvals.ts';
import {
  invalidateReadyDownstreamStages,
  STAGE_IDS
} from '../src/workflow/stages.ts';

const entity = {
  id: 'script-1',
  version: 2,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'reviewing'
};

const approval = {
  id: 'review-1',
  entityId: 'script-1',
  entityVersion: 2,
  action: 'approve',
  createdAt: '2026-08-21T01:00:00.000Z'
};

test('review decisions only apply to the exact entity version', () => {
  const approved = applyReviewDecision(entity, approval);
  assert.equal(approved.approval, 'approved');
  assert.equal(requireApprovedVersion(approved, [approval]), approval);

  assert.throws(
    () => applyReviewDecision(entity, { ...approval, entityVersion: 1 }),
    /does not match/
  );
  assert.throws(
    () => requireApprovedVersion({ ...approved, version: 3 }, [approval]),
    /is not approved/
  );
});

test('requesting changes rejects only the reviewed version', () => {
  const rejected = applyReviewDecision(entity, {
    ...approval,
    action: 'request_changes',
    comment: '需要加强结尾卡点'
  });
  assert.equal(rejected.approval, 'rejected');
});

test('upstream changes mark only ready downstream stages stale', () => {
  const states = Object.fromEntries(STAGE_IDS.map((stage) => [stage, 'empty']));
  states.script = 'ready';
  states['character-profiles'] = 'ready';
  states['style-selection'] = 'ready';
  states['character-images'] = 'reviewing';
  states.scenes = 'ready';
  states.composition = 'ready';

  const result = invalidateReadyDownstreamStages(states, 'script');

  assert.equal(result.states.script, 'ready');
  assert.equal(result.states['character-profiles'], 'stale');
  assert.equal(result.states['style-selection'], 'stale');
  assert.equal(result.states.scenes, 'stale');
  assert.equal(result.states.composition, 'stale');
  assert.equal(result.states['character-images'], 'reviewing');
  assert.deepEqual(result.invalidated, [
    'character-profiles',
    'style-selection',
    'scenes',
    'composition'
  ]);
});
