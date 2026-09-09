import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkflowBack } from '../src/workflow-back.ts';

const approvedWorkspace = {
  step: 'workspace', creationSource: 'idea', scriptApproval: 'approved', characterApproval: 'approved', characterAssetsApproval: 'approved',
  sceneProposalApproval: 'approved', sceneMainApproval: 'approved', sceneAssetsApproval: 'approved', propProposalApproval: 'approved', propAssetsApproval: 'approved',
  storyboardApproval: 'approved', storyboardAssetsApproval: 'approved', videoPromptsApproval: 'approved', shotVideosApproval: 'approved',
};

test('global back walks through every completed production layer one step at a time', () => {
  assert.deepEqual(resolveWorkflowBack(approvedWorkspace), { activeStage: '视频', reopenApproval: 'shotVideosApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...approvedWorkspace, shotVideosApproval: 'draft' }), { activeStage: '视频', reopenApproval: 'videoPromptsApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...approvedWorkspace, shotVideosApproval: 'draft', videoPromptsApproval: 'draft' }), { activeStage: '分镜', reopenApproval: 'storyboardAssetsApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...approvedWorkspace, shotVideosApproval: 'draft', videoPromptsApproval: 'draft', storyboardAssetsApproval: 'draft' }), { activeStage: '分镜', reopenApproval: 'storyboardApproval' });
});

test('global back preserves stage order through props scenes characters and script', () => {
  const base = { ...approvedWorkspace, shotVideosApproval: 'draft', videoPromptsApproval: 'draft', storyboardAssetsApproval: 'draft', storyboardApproval: 'draft' };
  assert.deepEqual(resolveWorkflowBack(base), { activeStage: '道具', reopenApproval: 'propAssetsApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...base, propAssetsApproval: 'draft', propProposalApproval: 'draft' }), { activeStage: '场景', reopenApproval: 'sceneAssetsApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...base, propAssetsApproval: 'draft', propProposalApproval: 'draft', sceneAssetsApproval: 'draft', sceneMainApproval: 'draft', sceneProposalApproval: 'draft' }), { activeStage: '角色', reopenApproval: 'characterAssetsApproval' });
  assert.deepEqual(resolveWorkflowBack({ ...base, propAssetsApproval: 'draft', propProposalApproval: 'draft', sceneAssetsApproval: 'draft', sceneMainApproval: 'draft', sceneProposalApproval: 'draft', characterAssetsApproval: 'draft', characterApproval: 'draft' }), { activeStage: '剧本', reopenApproval: 'scriptApproval' });
});

test('global back also covers setup screens and the start boundary', () => {
  assert.deepEqual(resolveWorkflowBack({ ...approvedWorkspace, step: 'parameters' }), { step: 'format' });
  assert.deepEqual(resolveWorkflowBack({ ...approvedWorkspace, step: 'format', creationSource: 'novel' }), { step: 'novel' });
  assert.equal(resolveWorkflowBack({ ...approvedWorkspace, step: 'start' }), null);
});
