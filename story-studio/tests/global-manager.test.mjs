import assert from 'node:assert/strict';
import test from 'node:test';

import { runProjectManagerTurn } from '../src/manager/global-manager.ts';
import { compileProjectManagerCommands, restoreProjectManagerCommands } from '../src/manager/manager-commands.ts';
import { buildProjectManagerContext, getProjectOverview, getStageDetails, searchProjectArtifacts } from '../src/manager/project-inspector.ts';
import { deriveWorkflowSnapshot } from '../src/workflow/runtime.ts';

function projectSession() {
  const state = {
    step: 'workspace', projectName: '雾港来信', workType: 'single', creativeDirection: 'story', duration: '60秒', ratio: '16:9', language: '中文', emotion: '悬疑', activeStage: '分镜',
    ideaScript: { id: 'SCRIPT-01', title: '雾港来信' }, scriptApproval: 'approved',
    characterStatus: 'complete', characterProfiles: [{ profileKey: 'CHAR-01', name: '林岚' }], characterApproval: 'approved',
    selectedStyleId: 'ancient-live-action', characterImageStatus: 'complete', characterImages: [{ status: 'complete' }], characterAssetsApproval: 'approved',
    sceneImageStatus: 'complete', sceneProposals: [{ sceneAssetKey: 'SCENE-01', name: '旧码头' }], sceneImages: [{ status: 'complete' }], sceneMainApproval: 'approved', sceneAssetsApproval: 'approved',
    propProposals: [{ propAssetKey: 'PROP-01', name: '铜制信盒' }], propAssetsApproval: 'approved',
    storyboardStatus: 'complete', storyboardSegments: [{ segmentKey: 'SEG-01', title: '信盒落水' }], storyboardApproval: 'approved',
    storyboardBoardStatus: 'failed', storyboardBoards: [{ segmentKey: 'SEG-01', status: 'failed' }], storyboardAssetsApproval: 'draft',
    videoPrompts: [{ segmentKey: 'SEG-01', title: '信盒落水', status: 'complete', prompt: '完整视频提示词' }], shotVideoTasks: [], postProduction: {},
  };
  return { id: 'project-01', state, workflow: deriveWorkflowSnapshot(state, undefined, '2026-08-30T10:00:00.000Z') };
}

test('global manager inspector exposes stable project entities with allowlisted command authority', () => {
  const context = buildProjectManagerContext(projectSession());
  const overview = getProjectOverview(context);
  assert.equal(context.project.name, '雾港来信');
  assert.equal(context.safety.mode, 'allowlisted_commands');
  assert.equal(context.safety.projectMutationAllowed, true);
  assert.equal(context.safety.providerSubmissionAllowed, 'explicit_user_command_only');
  assert.ok(overview.artifactCount >= 5);
  assert.equal(getStageDetails(context, 'scenes').artifacts[0].id, 'SCENE-01');
  assert.equal(searchProjectArtifacts(context, '铜制信盒')[0].id, 'PROP-01');
});

test('global manager sees only explicit preferences saved in the current project', () => {
  const session = projectSession();
  session.state.managerMemory = { explicitPreferences: [{ id: 'pref-1', text: '默认使用三宫格', createdAt: '2026-08-31T10:00:00.000Z' }] };
  const context = buildProjectManagerContext(session);
  assert.deepEqual(context.projectPreferences, [{ id: 'pref-1', text: '默认使用三宫格', createdAt: '2026-08-31T10:00:00.000Z' }]);
});

test('global manager context preserves exact provider failure evidence for diagnosis', () => {
  const session = projectSession();
  session.state.storyboardBoardError = '文字Agent在“画格规划与故事板图片提示词”处理时收到上游服务错误（HTTP 502）。失败步骤：画格规划与故事板图片提示词；影响范围：SEG001、SEG002；错误代码：upstream_error。本次停止在画格规划与图片提示词阶段，图片生成尚未开始。';
  session.workflow = deriveWorkflowSnapshot(session.state, undefined, '2026-08-30T10:02:00.000Z');
  const context = buildProjectManagerContext(session);
  const issue = getStageDetails(context, 'storyboard-images').issues[0];

  assert.equal(issue.source, undefined);
  assert.match(issue.messageZh, /HTTP 502/u);
  assert.match(issue.messageZh, /影响范围：SEG001、SEG002/u);
  assert.match(issue.messageZh, /图片生成尚未开始/u);
});

test('global manager sees the exact storyboard order and missing prepared prop reference', () => {
  const session = projectSession();
  session.state.propProposals = [
    { propAssetKey: 'R01', name: '充电盒', aliases: ['耳机盒'] },
    { propAssetKey: 'R02', name: '耳机', aliases: ['无线耳机'] },
  ];
  session.state.propImages = [
    { propAssetKey: 'R01', status: 'complete', imageUrl: '/generated/charging-case.png' },
    { propAssetKey: 'R02', status: 'complete', imageUrl: '/generated/earbuds.png' },
  ];
  session.state.storyboardSegments = [{ segmentKey: 'SEG001', order: 1, title: '黑场显形' }];
  session.state.storyboardBoardPlans = [{ segmentKey: 'SEG001', plan: {
    panelCount: 3,
    semanticDecision: { visibleProps: [{ propName: '充电盒' }, { propName: '耳机' }] },
    referenceRequirements: { props: [{ propName: '充电盒', state: '打开' }] },
    panels: [{ visibleProps: ['充电盒'] }, { visibleProps: ['充电盒'] }, { visibleProps: ['充电盒', '耳机'] }],
  } }];
  session.state.storyboardBoardPrompts = [{ segmentKey: 'SEG001', panelCount: 3, prompt: '参考图：充电盒\n基础设定' }];
  session.state.storyboardBoards = [{ segmentKey: 'SEG001', panelCount: 3, status: 'complete', imageUrl: '/generated/board.png' }];
  session.workflow = deriveWorkflowSnapshot(session.state, undefined, '2026-09-02T10:00:00.000Z');

  const context = buildProjectManagerContext(session);
  assert.deepEqual(context.storyboardReferenceBindings, [{
    order: 1,
    segmentKey: 'SEG001',
    title: '黑场显形',
    panelCount: 3,
    boardStatus: 'complete',
    visiblePreparedProps: [{ propAssetKey: 'R01', propName: '充电盒' }, { propAssetKey: 'R02', propName: '耳机' }],
    requiredPropReferences: [{ propAssetKey: 'R01', propName: '充电盒' }],
    generatedPropReferences: [],
    promptReferenceLabels: ['充电盒'],
    missingPreparedReferences: [{ propAssetKey: 'R02', propName: '耳机', missingFrom: ['plan', 'prompt'] }],
    status: 'missing_prepared_reference',
  }]);
});

test('global manager collapses a known missing storyboard reference into one repair-and-regenerate command', async () => {
  const session = projectSession();
  session.state.propProposals = [{ propAssetKey: 'R02', name: '耳机', aliases: [] }];
  session.state.propImages = [{ propAssetKey: 'R02', status: 'complete', imageUrl: '/generated/earbuds.png' }];
  session.state.storyboardSegments = [{ segmentKey: 'SEG001', order: 1, title: '黑场显形' }];
  session.state.storyboardBoardPlans = [{ segmentKey: 'SEG001', plan: { panelCount: 3, semanticDecision: { visibleProps: [{ propName: '耳机' }] }, referenceRequirements: { props: [] }, panels: [{ visibleProps: ['耳机'] }] } }];
  session.state.storyboardBoardPrompts = [{ segmentKey: 'SEG001', panelCount: 3, prompt: '参考图：充电盒\n基础设定' }];
  session.state.storyboardBoards = [{ segmentKey: 'SEG001', panelCount: 3, status: 'complete', imageUrl: '/generated/board.png' }];
  session.workflow = deriveWorkflowSnapshot(session.state, undefined, '2026-09-02T10:00:00.000Z');
  const context = buildProjectManagerContext(session);
  let capturedRequest;
  const provider = {
    id: 'fake-agent', async health() { throw new Error('not used'); },
    async generate(request) {
      capturedRequest = request;
      return { providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-09-02T10:01:00.000Z', elapsedMs: 5, output: {
        replyZh: '建议逐项排查。', intent: 'diagnose', diagnosisZh: '需要进一步查看。', targetStages: ['props', 'storyboard-images'],
        targetArtifacts: [
          { kind: 'prop', id: 'R02', label: '耳机', stageId: 'props', status: 'approved' },
          { kind: 'storyboard', id: 'SEG001', label: '黑场显形', stageId: 'storyboard-prompts', status: 'approved' },
        ],
        proposedActions: [
          { order: 1, stageId: 'props', actionType: 'navigate', summaryZh: '打开 R02', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
          { order: 2, stageId: 'storyboard-images', actionType: 'navigate', summaryZh: '打开提示词', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
          { order: 3, stageId: 'storyboard-prompts', actionType: 'navigate', summaryZh: '打开文字分镜', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
        ],
        downstreamImpact: [],
      } };
    },
  };

  const turn = await runProjectManagerTurn(provider, { message: '第一个三宫格里的耳机不是准备好的道具，帮我解决。', context });
  assert.match(capturedRequest.instructions, /missingPreparedReferences/u);
  assert.match(capturedRequest.instructions, /只保留一个主动作/u);
  assert.match(turn.replyZh, /SEG001.*R02.*耳机/u);
  assert.equal(turn.proposedActions.length, 1);
  assert.deepEqual(turn.proposedActions[0], {
    order: 1,
    stageId: 'storyboard-images',
    actionType: 'regenerate',
    summaryZh: '修复 SEG001 对 R02「耳机」 的参考绑定，并使用当前提示词重新生成3宫格图。',
    requiresConfirmation: true,
    providerImpact: 'image-edit',
    preferenceText: '',
  });
  const commands = compileProjectManagerCommands(turn, context, '2026-09-02T10:02:00.000Z');
  assert.deepEqual(commands.map((command) => command.kind), ['regenerate_storyboard_image']);
  assert.equal(commands[0].targetArtifact.id, 'SEG001');
});

test('global manager returns a normalized diagnosis plan and cannot claim project changes', async () => {
  let capturedRequest;
  const provider = {
    id: 'fake-agent',
    async health() { throw new Error('not used'); },
    async generate(request) {
      capturedRequest = request;
      return {
        providerId: 'fake-agent', model: 'fake-model', status: 'completed', completedAt: '2026-08-30T10:01:00.000Z', elapsedMs: 5,
        output: {
          replyZh: '问题出在分镜图片阶段，先检查失败项，再决定是否重新生成。',
          intent: 'diagnose', diagnosisZh: 'SEG-01 的分镜图片未完成。', targetStages: ['storyboard-images'],
          targetArtifacts: [
            { kind: 'storyboard', id: 'SEG-01', label: '信盒落水', stageId: 'storyboard-prompts', status: 'approved' },
            { kind: 'storyboard', id: 'UNKNOWN', label: '虚构项', stageId: 'storyboard-prompts', status: 'complete' },
          ],
          proposedActions: [
            { order: 8, stageId: 'storyboard-images', actionType: 'inspect', summaryZh: '查看 SEG-01 的失败信息', requiresConfirmation: false, providerImpact: 'none' },
            { order: 9, stageId: 'storyboard-images', actionType: 'regenerate', summaryZh: '重新生成 SEG-01 六宫格', requiresConfirmation: false, providerImpact: 'image-edit' },
          ],
          downstreamImpact: ['video-prompts', 'intake'],
        },
      };
    },
  };

  const context = buildProjectManagerContext(projectSession());
  const turn = await runProjectManagerTurn(provider, { message: '这一步哪里有问题？', history: [{ role: 'user', text: '帮我看项目' }], context });

  assert.equal(capturedRequest.operation, 'project-manager-command-turn');
  assert.match(capturedRequest.instructions, /失败步骤、影响范围、HTTP状态、错误代码、请求ID/u);
  assert.match(capturedRequest.instructions, /不得把“画格规划与图片提示词”的文字请求失败说成图片生成失败/u);
  assert.match(capturedRequest.instructions, /自动恢复次数或恢复记录/u);
  assert.equal(capturedRequest.input.projectContext.safety.providerSubmissionAllowed, 'explicit_user_command_only');
  assert.equal(turn.mode, 'command_plan');
  assert.equal(turn.projectChanged, false);
  assert.equal(turn.providerCallsStarted, false);
  assert.deepEqual(turn.targetArtifacts.map((artifact) => artifact.id), ['SEG-01']);
  assert.deepEqual(turn.proposedActions.map((action) => action.order), [1]);
  assert.equal(turn.proposedActions[0].actionType, 'regenerate');
  assert.equal(turn.proposedActions[0].requiresConfirmation, true);
  assert.deepEqual(turn.downstreamImpact, ['video-prompts']);
});

test('global manager compiles only uniquely bound allowlisted commands', () => {
  const context = buildProjectManagerContext(projectSession());
  const commands = compileProjectManagerCommands({
    mode: 'read_only', replyZh: '处理分镜。', intent: 'change_plan', diagnosisZh: '单段失败。', targetStages: ['storyboard-images'],
    targetArtifacts: context.artifacts.filter((artifact) => artifact.id === 'SEG-01'),
    proposedActions: [
      { order: 1, stageId: 'storyboard-images', actionType: 'navigate', summaryZh: '打开分镜', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
      { order: 2, stageId: 'video-prompts', actionType: 'navigate', summaryZh: '打开视频提示词', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
      { order: 3, stageId: 'storyboard-images', actionType: 'regenerate', summaryZh: '重新生成当前分镜图', requiresConfirmation: true, providerImpact: 'image-edit', preferenceText: '' },
      { order: 4, stageId: 'storyboard-images', actionType: 'remember_preference', summaryZh: '记住分镜偏好', requiresConfirmation: true, providerImpact: 'none', preferenceText: '默认使用三宫格' },
    ],
    downstreamImpact: ['video-prompts'], projectChanged: false, providerCallsStarted: false,
  }, context, '2026-08-31T10:00:00.000Z');

  assert.deepEqual(commands.map((command) => command.kind), ['navigate', 'navigate', 'regenerate_storyboard_image', 'remember_preference']);
  assert.equal(commands[0].status, 'ready');
  assert.equal(commands[0].targetArtifact.kind, 'storyboard');
  assert.equal(commands[1].targetArtifact.kind, 'video-prompt');
  assert.equal(commands[2].status, 'awaiting_confirmation');
  assert.equal(commands[2].targetArtifact.id, 'SEG-01');
  assert.equal(commands[3].preferenceText, '默认使用三宫格');
});

test('character profile and character image prompt navigation remain separate commands', () => {
  const context = buildProjectManagerContext(projectSession());
  const targetArtifacts = context.artifacts.filter((artifact) => artifact.id === 'CHAR-01');
  const commands = compileProjectManagerCommands({
    mode: 'read_only', replyZh: '分别检查人物设定与图片提示词。', intent: 'change_plan', diagnosisZh: '年龄锚点需要确认。', targetStages: ['character-profiles', 'character-images'],
    targetArtifacts,
    proposedActions: [
      { order: 1, stageId: 'character-profiles', actionType: 'navigate', summaryZh: '查看人物设定', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
      { order: 2, stageId: 'character-images', actionType: 'navigate', summaryZh: '查看角色图片提示词', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
    ],
    downstreamImpact: [], projectChanged: false, providerCallsStarted: false,
  }, context, '2026-08-31T11:00:00.000Z');

  assert.deepEqual(commands.map((command) => command.stageId), ['character-profiles', 'character-images']);
  assert.deepEqual(commands.map((command) => command.targetArtifact?.id), ['CHAR-01', 'CHAR-01']);
  assert.deepEqual(commands.map((command) => command.status), ['ready', 'ready']);
});

test('character edit drafts compile into one prompt-first revision before image generation', () => {
  const context = buildProjectManagerContext(projectSession());
  const targetArtifacts = context.artifacts.filter((artifact) => artifact.id === 'CHAR-01');
  const turn = {
    mode: 'read_only', replyZh: '同步修改人物和图片提示词。', intent: 'change_plan', diagnosisZh: '年龄需要调整。', targetStages: ['character-profiles', 'character-images'],
    targetArtifacts,
    proposedActions: [
      { order: 1, stageId: 'character-profiles', actionType: 'navigate', summaryZh: '查看人物设定', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
      { order: 2, stageId: 'character-images', actionType: 'navigate', summaryZh: '查看图片提示词', requiresConfirmation: false, providerImpact: 'none', preferenceText: '' },
      { order: 3, stageId: 'character-profiles', actionType: 'edit_draft', summaryZh: '把年龄明确为六十岁。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' },
      { order: 4, stageId: 'character-images', actionType: 'edit_draft', summaryZh: '同步强化六十岁外貌特征。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' },
      { order: 5, stageId: 'character-images', actionType: 'regenerate', summaryZh: '使用新提示词重新生成图片。', requiresConfirmation: true, providerImpact: 'image', preferenceText: '' },
    ],
    downstreamImpact: [], projectChanged: false, providerCallsStarted: false,
  };
  const commands = compileProjectManagerCommands(turn, context, '2026-08-31T12:00:00.000Z');

  assert.deepEqual(commands.map((command) => command.kind), ['navigate', 'navigate', 'revise_character_design', 'regenerate_character_image']);
  assert.match(commands[2].instructionZh, /六十岁/u);
  assert.equal(commands[2].providerImpact, 'agent');
  assert.equal(commands[3].providerImpact, 'image');

  const restored = restoreProjectManagerCommands(turn, [commands[0], commands[1], commands[3]]);
  assert.deepEqual(restored.map((command) => command.kind), ['navigate', 'navigate', 'revise_character_design', 'regenerate_character_image']);
  assert.equal(new Set(restored.map((command) => command.id)).size, restored.length);

  const completedImageCommand = commands.find((command) => command.kind === 'regenerate_character_image');
  const restoredCompleted = restoreProjectManagerCommands(turn, commands.map((command) => command === completedImageCommand ? { ...command, status: 'completed', resultZh: '旧完成提示' } : command));
  assert.equal(restoredCompleted.find((command) => command.kind === 'regenerate_character_image')?.resultZh, '新的角色图片已生成。可以保留更新返回主线，也可以检查并同步后续内容。');
});

test('failed character-profile stage compiles a whole-stage retry without a nonexistent character target', () => {
  const original = buildProjectManagerContext(projectSession());
  const context = {
    ...original,
    artifacts: original.artifacts.filter((artifact) => artifact.kind !== 'character'),
    stages: original.stages.map((stage) => stage.stageId === 'character-profiles' ? { ...stage, status: 'failed', artifactCount: 0 } : stage),
  };
  const commands = compileProjectManagerCommands({
    mode: 'read_only', replyZh: '重新整理角色档案。', intent: 'change_plan', diagnosisZh: '角色档案尚未写入。', targetStages: ['character-profiles'],
    targetArtifacts: [],
    proposedActions: [{ order: 1, stageId: 'character-profiles', actionType: 'regenerate', summaryZh: '依据当前剧本重新整理角色档案。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' }],
    downstreamImpact: ['style-selection'], projectChanged: false, providerCallsStarted: false,
  }, context, '2026-09-03T20:30:00.000Z');

  assert.deepEqual(commands.map((command) => command.kind), ['retry_character_profiles']);
  assert.equal(commands[0].targetArtifact, undefined);
  assert.equal(commands[0].providerImpact, 'agent');
});

test('failed storyboard text stage compiles a write-capable Agent repair without an existing segment target', () => {
  const original = buildProjectManagerContext(projectSession());
  const context = {
    ...original,
    artifacts: original.artifacts.filter((artifact) => artifact.kind !== 'storyboard'),
    stages: original.stages.map((stage) => stage.stageId === 'storyboard-prompts' ? { ...stage, status: 'failed', artifactCount: 0 } : stage),
  };
  const commands = compileProjectManagerCommands({
    mode: 'command_plan', replyZh: '正在修复文字分镜。', intent: 'change_plan', diagnosisZh: '对白归属需要校正。', targetStages: ['storyboard-prompts'],
    targetArtifacts: [],
    proposedActions: [{ order: 1, stageId: 'storyboard-prompts', actionType: 'regenerate', summaryZh: '修复并写入文字分镜。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' }],
    downstreamImpact: ['storyboard-images'], projectChanged: false, providerCallsStarted: false,
  }, context, '2026-09-04T20:30:00.000Z');

  assert.deepEqual(commands.map((command) => command.kind), ['retry_storyboard_segments']);
  assert.equal(commands[0].targetArtifact, undefined);
  assert.equal(commands[0].providerImpact, 'agent');
});

test('explicit prop changes compile into prompt-first commands for every named prop before image regeneration', () => {
  const baseContext = buildProjectManagerContext(projectSession());
  const firstProp = baseContext.artifacts.find((artifact) => artifact.id === 'PROP-01');
  const secondProp = { ...firstProp, id: 'PROP-02', label: '耳机' };
  const context = { ...baseContext, artifacts: [...baseContext.artifacts, secondProp] };
  const turn = {
    mode: 'read_only', replyZh: '已准备好修改命令，请在下方确认。', intent: 'change_plan', diagnosisZh: '两项道具设定和提示词需要同步。', targetStages: ['props'],
    targetArtifacts: [firstProp, secondProp],
    proposedActions: [
      { order: 1, stageId: 'props', actionType: 'edit_draft', summaryZh: 'PROP-01 充电盒改为黑红配色，正面预留Logo区域。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' },
      { order: 2, stageId: 'props', actionType: 'edit_draft', summaryZh: 'PROP-02 耳机改为黑红配色，触控区预留Logo区域。', requiresConfirmation: true, providerImpact: 'agent', preferenceText: '' },
      { order: 3, stageId: 'props', actionType: 'regenerate', summaryZh: '使用新提示词重新生成 PROP-01 道具图。', requiresConfirmation: true, providerImpact: 'image', preferenceText: '' },
      { order: 4, stageId: 'props', actionType: 'regenerate', summaryZh: '使用新提示词重新生成 PROP-02 道具图。', requiresConfirmation: true, providerImpact: 'image', preferenceText: '' },
    ],
    downstreamImpact: ['storyboard-prompts'], projectChanged: false, providerCallsStarted: false,
  };
  const commands = compileProjectManagerCommands(turn, context, '2026-09-01T12:00:00.000Z');

  assert.deepEqual(commands.map((command) => command.kind), ['revise_prop_design', 'revise_prop_design', 'regenerate_prop_image', 'regenerate_prop_image']);
  assert.deepEqual(commands.map((command) => command.targetArtifact?.id), ['PROP-01', 'PROP-02', 'PROP-01', 'PROP-02']);
  assert.match(commands[0].instructionZh, /充电盒.*黑红/u);
  assert.match(commands[1].instructionZh, /耳机.*Logo/u);
  assert.ok(commands.every((command) => command.status === 'awaiting_confirmation'));
});
