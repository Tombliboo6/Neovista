import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkflowTransitionError,
  applyWorkflowCommand,
  createEmptyWorkflowSnapshot,
  deriveWorkflowSnapshot,
  sanitizeWorkflowSnapshot,
  unresolvedDependencies,
} from '../src/workflow/runtime.ts';

const blockingIssue = {
  code: 'dialogue_mismatch',
  severity: 'blocking',
  source: 'fact',
  messageZh: '对白与已批准剧本不一致。',
  suggestionZh: '从剧本逐字复制对应对白。',
};

test('asset image progress and review are independent of approved text proposals', () => {
  const state = {step:'workspace',ideaScript:{title:'修钟'},propStatus:'complete',propProposals:[{propAssetKey:'R01'}],propProposalApproval:'approved',propAssetsApproval:'draft',propImageStatus:'running',sceneStatus:'running',sceneImageStatus:'idle'};
  const running=deriveWorkflowSnapshot(state);
  assert.equal(running.stages.props.status,'running');
  assert.equal(running.stages.scenes.status,'running');
  const returned=deriveWorkflowSnapshot({...state,propImageStatus:'complete',propImages:[{status:'complete'}]});
  assert.equal(returned.stages.props.status,'review_required');
  const approved=deriveWorkflowSnapshot({...state,propImageStatus:'complete',propImages:[{status:'complete'}],propAssetsApproval:'approved'});
  assert.equal(approved.stages.props.status,'ready');
  const turnaround=deriveWorkflowSnapshot({...state,characterAssetsApproval:'approved',characterImageStatus:'complete',characterImages:[{status:'complete'}],characterTurnarounds:[{status:'running'}]});
  assert.equal(turnaround.stages['character-images'].status,'running');
});

test('a blank project keeps its default preset without claiming that style selection was completed', () => {
  const snapshot = deriveWorkflowSnapshot({
    step: 'start',
    selectedStyleId: 'ancient-live-action',
  }, undefined, '2026-08-30T10:00:00.000Z');

  assert.equal(snapshot.stages['style-selection'].status, 'idle');
  assert.equal(snapshot.stages['style-selection'].artifactCount, 0);
  assert.deepEqual(snapshot.history, []);
});

test('a blank project removes the legacy synthetic style-completion record without adding a reverse event', () => {
  const polluted = createEmptyWorkflowSnapshot('2026-08-30T10:01:00.000Z');
  polluted.revision = 1;
  polluted.stages['style-selection'] = {
    ...polluted.stages['style-selection'],
    status: 'ready',
    revision: 1,
    artifactCount: 1,
  };
  polluted.history = [{
    id: 'workflow-style-selection-2026-08-30T10:01:00.000Z-idle-ready',
    kind: 'stage_status_changed',
    stageId: 'style-selection',
    fromStatus: 'idle',
    toStatus: 'ready',
    createdAt: '2026-08-30T10:01:00.000Z',
    summaryZh: '视觉风格：未开始 → 已确认',
  }];

  const cleaned = deriveWorkflowSnapshot({
    step: 'start',
    selectedStyleId: 'ancient-live-action',
  }, polluted, '2026-08-30T10:02:00.000Z');

  assert.equal(cleaned.stages['style-selection'].status, 'idle');
  assert.equal(cleaned.stages['style-selection'].artifactCount, 0);
  assert.deepEqual(cleaned.history, []);
});

test('an idea-stage failure is persisted as a script issue and default style remains unresolved', () => {
  const snapshot = deriveWorkflowSnapshot({
    step: 'idea-questions',
    selectedStyleId: 'ancient-live-action',
    ideaError: '编剧导演剧本校验发现时长字段需要处理。修改建议：检查创作设定后重新生成剧本。',
  }, undefined, '2026-09-01T08:00:00.000Z');

  assert.equal(snapshot.stages.script.status, 'failed');
  assert.match(snapshot.stages.script.issues[0].messageZh, /时长字段/u);
  assert.equal(snapshot.stages.script.issues[0].suggestionZh, '检查创作设定后重新生成剧本。');
  assert.equal(snapshot.stages['style-selection'].status, 'idle');
  assert.deepEqual(snapshot.stages.script.recoveryActions.slice(0, 3).map((action) => action.type), ['inspect', 'edit', 'retry']);
});

test('legacy project state projects into one canonical workflow snapshot and keeps every transition', () => {
  const first = deriveWorkflowSnapshot({
    step: 'workspace',
    ideaScript: { title: '第一集' },
    scriptApproval: 'approved',
    characterStatus: 'complete',
    characterProfiles: [{ profileKey: 'C01' }],
    characterApproval: 'approved',
    selectedStyleId: 'ancient-live-action',
    characterImageStatus: 'complete',
    characterImages: [{ status: 'complete' }],
    characterAssetsApproval: 'approved',
  }, undefined, '2026-08-29T01:00:00.000Z');

  assert.equal(first.stages.script.status, 'ready');
  assert.equal(first.stages['character-profiles'].status, 'ready');
  assert.equal(first.stages['style-selection'].status, 'ready');
  assert.equal(first.stages['character-images'].status, 'ready');
  assert.ok(first.history.some((event) => event.stageId === 'script' && event.toStatus === 'ready'));

  const second = deriveWorkflowSnapshot({
    step: 'workspace',
    ideaScript: { title: '第一集' },
    scriptApproval: 'approved',
    characterStatus: 'complete',
    characterProfiles: [{ profileKey: 'C01' }],
    characterApproval: 'approved',
    selectedStyleId: 'ancient-live-action',
    characterImageStatus: 'failed',
    characterImages: [{ status: 'complete' }, { status: 'failed' }],
    characterAssetsApproval: 'draft',
  }, first, '2026-08-29T01:01:00.000Z');

  assert.equal(second.stages['character-images'].status, 'partial');
  assert.equal(second.stages['character-images'].artifactCount, 1);
  assert.ok(second.history.length > first.history.length);
  assert.equal(second.history.at(-1).fromStatus, 'ready');
  assert.equal(second.history.at(-1).toStatus, 'partial');
});

test('workflow engine blocks a stage until every dependency is resolved', () => {
  const empty = createEmptyWorkflowSnapshot('2026-08-29T02:00:00.000Z');
  assert.deepEqual(unresolvedDependencies(empty, 'video-prompts'), [
    'storyboard-images', 'character-images', 'scenes', 'scene-views', 'props',
  ]);
  assert.throws(
    () => applyWorkflowCommand(empty, { type: 'start', stageId: 'video-prompts' }),
    (error) => error instanceof WorkflowTransitionError && error.code === 'workflow_dependencies_unresolved',
  );
});

test('partial results expose inspect, edit, one-item retry and continue actions without automatic retry', () => {
  let snapshot = deriveWorkflowSnapshot({
    step: 'workspace', ideaScript: {}, scriptApproval: 'approved',
    characterStatus: 'complete', characterProfiles: [{}], characterApproval: 'approved',
    selectedStyleId: 'ancient-live-action', characterImageStatus: 'complete', characterImages: [{ status: 'complete' }], characterAssetsApproval: 'approved',
    sceneImageStatus: 'complete', sceneImages: [{ status: 'complete' }], sceneMainApproval: 'approved', sceneAssetsApproval: 'approved',
    propAssetsApproval: 'approved', storyboardStatus: 'complete', storyboardSegments: [{}], storyboardApproval: 'approved',
    storyboardBoardStatus: 'complete', storyboardBoards: [{ status: 'complete' }], storyboardAssetsApproval: 'approved',
  }, undefined, '2026-08-29T03:00:00.000Z');
  snapshot = applyWorkflowCommand(snapshot, { type: 'start', stageId: 'video-prompts' }, '2026-08-29T03:01:00.000Z');
  snapshot = applyWorkflowCommand(snapshot, { type: 'fail', stageId: 'video-prompts', artifactCount: 5, issues: [blockingIssue] }, '2026-08-29T03:02:00.000Z');

  const outcome = snapshot.stages['video-prompts'];
  assert.equal(outcome.status, 'partial');
  assert.deepEqual(outcome.recoveryActions.map((action) => action.type), ['inspect', 'edit', 'retry', 'continue_partial', 'revert']);
  assert.equal(outcome.recoveryActions.find((action) => action.type === 'retry').paid, true);
  assert.equal(outcome.issues[0].suggestionZh, '从剧本逐字复制对应对白。');
});

test('upstream edits invalidate resolved descendants but preserve their artifacts and history', () => {
  const ready = deriveWorkflowSnapshot({
    step: 'workspace', ideaScript: {}, scriptApproval: 'approved',
    characterStatus: 'complete', characterProfiles: [{}], characterApproval: 'approved',
    selectedStyleId: 'ancient-live-action', characterImageStatus: 'complete', characterImages: [{ status: 'complete' }], characterAssetsApproval: 'approved',
    sceneImageStatus: 'complete', sceneImages: [{ status: 'complete' }], sceneMainApproval: 'approved', sceneAssetsApproval: 'approved',
    propAssetsApproval: 'approved', storyboardStatus: 'complete', storyboardSegments: [{}], storyboardApproval: 'approved',
    storyboardBoardStatus: 'complete', storyboardBoards: [{ status: 'complete' }], storyboardAssetsApproval: 'approved',
    videoPromptStatus: 'complete', videoPrompts: [{ status: 'complete' }], videoPromptsApproval: 'approved',
  }, undefined, '2026-08-29T04:00:00.000Z');
  const changed = applyWorkflowCommand(ready, { type: 'change_upstream', stageId: 'script' }, '2026-08-29T04:01:00.000Z');

  assert.equal(changed.stages['character-images'].status, 'stale');
  assert.equal(changed.stages['character-images'].artifactCount, 1);
  assert.equal(changed.stages['video-prompts'].status, 'stale');
  assert.ok(changed.history.some((event) => event.kind === 'stage_invalidated' && event.stageId === 'video-prompts'));
});

test('workflow snapshot sanitizer rejects unknown states and rebuilds recovery actions', () => {
  const clean = sanitizeWorkflowSnapshot({
    revision: 4,
    stages: {
      script: { status: 'made-up-status', revision: 3, artifactCount: 99 },
      props: { status: 'failed', revision: 2, artifactCount: 0, issues: [blockingIssue] },
    },
    history: [{ stageId: 'unknown', fromStatus: 'idle', toStatus: 'ready', createdAt: '2026-08-29T00:00:00.000Z' }],
  }, '2026-08-29T05:00:00.000Z');

  assert.equal(clean.stages.script.status, 'idle');
  assert.equal(clean.stages.props.status, 'failed');
  assert.ok(clean.stages.props.recoveryActions.some((action) => action.type === 'skip'));
  assert.deepEqual(clean.history, []);
});

test('native-audio projects resolve the optional music stage without blocking composition', () => {
  const snapshot = deriveWorkflowSnapshot({
    step: 'workspace',
    postProduction: { audioMode: 'native' },
  }, undefined, '2026-08-29T05:30:00.000Z');
  assert.equal(snapshot.stages.music.status, 'skipped');
  assert.equal(snapshot.stages.music.recoveryActions.some((action) => action.type === 'skip'), false);
});

test('an approved native rough cut without subtitles is a resolved deliverable without another composition run', () => {
  const snapshot = deriveWorkflowSnapshot({
    step: 'workspace',
    postProduction: {
      audioMode: 'native', subtitles: 'none', roughCutApproval: 'approved',
      roughCut: { status: 'complete', filename: 'rough-cut.mp4' },
      finalComposition: { status: 'idle' },
    },
  }, undefined, '2026-08-30T08:00:00.000Z');
  assert.equal(snapshot.stages.music.status, 'skipped');
  assert.equal(snapshot.stages.composition.status, 'ready');
  assert.equal(snapshot.stages.composition.artifactCount, 1);
});

test('legacy stage errors become structured Chinese issues with a safe recovery suggestion', () => {
  const snapshot = deriveWorkflowSnapshot({
    step: 'workspace',
    ideaScript: {},
    scriptApproval: 'approved',
    videoPromptStatus: 'failed',
    videoPromptError: '视频提示词没有完成：对白没有通过校验。修改建议：从已批准剧本逐字复制对白。',
  }, undefined, '2026-08-29T06:00:00.000Z');
  const outcome = snapshot.stages['video-prompts'];
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.issues[0].code, 'legacy_stage_error');
  assert.match(outcome.issues[0].messageZh, /对白没有通过校验/u);
  assert.equal(outcome.issues[0].suggestionZh, '从已批准剧本逐字复制对白。');
  assert.deepEqual(outcome.recoveryActions.slice(0, 3).map((action) => action.type), ['inspect', 'edit', 'retry']);
});
