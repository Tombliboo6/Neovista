import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkflowSnapshot } from '../src/workflow/runtime.ts';
import { currentWorkflowStage, stageForWorkspaceSection, toStageViewModel } from '../src/workflow/view-model.ts';

test('阶段视图模型统一中文状态、问题和恢复动作', () => {
  const snapshot = createEmptyWorkflowSnapshot('2026-08-29T00:00:00.000Z');
  const outcome = {
    ...snapshot.stages['video-prompts'],
    status: 'partial',
    artifactCount: 5,
    issues: [{ code: 'missing_prompt', severity: 'blocking', source: 'schema', messageZh: 'SEG004 缺少提示词', suggestionZh: '只补齐 SEG004。' }],
    recoveryActions: [{ type: 'retry', labelZh: '手动重试失败项', paid: true, targetKey: 'SEG004' }],
  };
  const view = toStageViewModel(outcome);
  assert.equal(view.statusLabelZh, '部分完成');
  assert.equal(view.summaryZh, 'SEG004 缺少提示词');
  assert.equal(view.artifactCount, 5);
  assert.equal(view.recoveryActions[0].targetKey, 'SEG004');
});

test('画布栏目从工作流快照选择当前真实阶段', () => {
  const snapshot = createEmptyWorkflowSnapshot('2026-08-29T00:00:00.000Z');
  snapshot.stages['character-profiles'].status = 'ready';
  snapshot.stages['character-images'].status = 'review_required';
  assert.equal(stageForWorkspaceSection('角色', snapshot), 'character-images');
  assert.equal(currentWorkflowStage(snapshot), 'character-images');
});

test('skipping optional scene views preserves the confirmed scene section status', () => {
  const snapshot = createEmptyWorkflowSnapshot('2026-09-09T00:00:00.000Z');
  snapshot.stages.scenes.status = 'ready';
  snapshot.stages['scene-views'].status = 'skipped';
  assert.equal(stageForWorkspaceSection('场景', snapshot), 'scenes');
  assert.equal(currentWorkflowStage(snapshot), 'scenes');
  snapshot.stages['scene-views'].status = 'running';
  assert.equal(stageForWorkspaceSection('场景', snapshot), 'scene-views');
  assert.equal(currentWorkflowStage(snapshot), 'scene-views');
});
