import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC,
  buildStoryboardEvidenceCatalog,
  buildStoryboardSegmentRepairRequest,
  buildStoryboardPromptRequest,
  buildStoryboardSegmentPlan,
  collectStoryboardValidationWarnings,
  generateStoryboardPromptsWithRepair,
  normalizeStoryboardPromptDraft,
  validateStoryboardPromptDraft
} from '../src/storyboards/storyboard-prompt-generation.ts';
import { materializeStoryboardPromptSet } from '../src/storyboards/storyboard-prompt-versioning.ts';
import { TEXT_TOKEN_BUDGETS } from '../src/providers/token-budgets.ts';

const scene = (sceneKey, order, durationSec) => ({
  sceneKey, order, heading: sceneKey, location: '荒野山道', timeOfDay: '夜晚', interiorExterior: 'exterior',
  sourceSegmentIds: [`seg-${sceneKey}`], sourceStart: 0, sourceEnd: 10, sourceEvidence: ['原文'], purpose: '推进剧情', durationSec,
  action: Array.from({ length: 8 }, (_, index) => `${sceneKey}动作${index + 1}。`).join(''),
  dialogue: [{ kind: 'dialogue', speakerName: order === 1 ? '张浩然' : '林无双', text: `${sceneKey}对白`, delivery: '冷静' }],
  soundCues: ['暴雨声'], transitionOut: order === 1 ? 'continuous' : 'fade_to_black', id: `script-1-${sceneKey.toLowerCase()}`
});

const script = {
  id: 'script-1', version: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', approval: 'approved',
  episodeId: 'episode-1', episodeVersion: 1, documentId: 'doc-1', documentVersion: 1,
  title: '测试', logline: '测试', synopsis: '测试', targetDurationSec: 105, estimatedDurationSec: 105,
  openingHook: '开始', endingHook: '结束', scenes: [scene('S01', 1, 60), scene('S02', 2, 45)], adaptationNotes: [], continuityOut: '结束'
};
const styleSelection = {
  id: 'style-1', version: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', approval: 'approved',
  characterProfileSetId: 'profiles-1', characterProfileSetVersion: 1, source: 'user_selected', presetId: '3d-fantasy', name: '3D玄幻', stylePrompt: '东方玄幻三维动画电影风格。', referenceImagePaths: []
};
const asset = (assetId, assetKind, extra = {}) => ({ assetId, version: 1, approval: 'approved', assetKind, label: assetId, description: `${assetId}参考`, ...extra });
const assets = [
  asset('zhang-main', 'character', { characterName: '张浩然' }),
  asset('lin-main', 'character', { characterName: '林无双' }),
  asset('scene-reverse', 'scene', { sceneAssetKey: 'L01', viewKey: 'reverse' }),
  asset('prop-dormant', 'prop', { propAssetKey: 'R01', stateKey: 'dormant' }),
  asset('prop-activated', 'prop', { propAssetKey: 'R01', stateKey: 'activated' })
];

function validSegments() {
  const actionGroups = [[1, 2], [3, 4], [5, 6], [7, 8], [1, 2, 3], [4, 5, 6], [7, 8]];
  return buildStoryboardSegmentPlan(script).map((plan, index) => {
    const sceneKey = plan.sceneKey;
    const character = sceneKey === 'S01' ? '张浩然' : '林无双';
    const local = sceneKey === 'S01' ? index : index - 4;
    const hasDialogue = local === 0;
    return {
      segmentKey: plan.segmentKey,
      sceneKey,
      order: plan.order,
      title: `分镜${index + 1}`,
      durationSec: plan.targetDurationSec,
      characters: [character],
      sceneViewKey: 'reverse',
      propStateKey: sceneKey === 'S01' ? 'none' : 'activated',
      actionEvidenceIds: actionGroups[index].map((number) => `B-${sceneKey}-A${String(number).padStart(2, '0')}`),
      dialogueEvidenceIds: hasDialogue ? [`B-${sceneKey}-D01`] : [],
      soundCueIds: [`B-${sceneKey}-S01`],
      storyboardText: `夜晚荒野山道，${character}完成本段动作。${hasDialogue ? `${character}：“${sceneKey}对白”` : ''}`,
      transition: index === 3 ? 'continuous' : index === 6 ? 'fade_to_black' : 'cut'
    };
  });
}

test('default storyboard plan uses selectable 15-second segments', () => {
  assert.equal(DEFAULT_STORYBOARD_SEGMENT_DURATION_SEC, 15);
  assert.deepEqual(buildStoryboardSegmentPlan(script).map((item) => item.targetDurationSec), [15, 15, 15, 15, 15, 15, 15]);
  assert.equal(buildStoryboardSegmentPlan(script, 10).length, 11);
  assert.throws(() => buildStoryboardSegmentPlan(script, 20), /5 to 15 seconds/);
});

test('selected duration creates fixed slots and assigns complete scenes without short fragments', () => {
  const unevenScript = {
    ...script,
    targetDurationSec: 30,
    estimatedDurationSec: 30,
    scenes: [scene('S01', 1, 7), scene('S02', 2, 7), scene('S03', 3, 7), scene('S04', 4, 9)]
  };
  const plan = buildStoryboardSegmentPlan(unevenScript, 5);
  assert.deepEqual(plan.map((item) => item.targetDurationSec), [5, 5, 5, 5, 5, 5]);
  assert.deepEqual(plan.map((item) => item.sceneKeys), [
    ['S01'], ['S01'], ['S02'], ['S03'], ['S04'], ['S04']
  ]);
  assert.deepEqual(plan.map((item) => [item.startSec, item.endSec]), [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30]]);
  const request = buildStoryboardPromptRequest({ script: unevenScript, styleSelection, assets: [], segmentDurationSec: 5 });
  assert.match(request.instructions, /不得因场次原估时长另拆出2秒、4秒等短尾段/u);
  assert.match(request.instructions, /一个固定时长段可以包含自然硬切和多个连续场次/u);
  assert.equal(request.outputSchema.properties.segments.minItems, 6);
});

test('more scenes than fixed slots are grouped in order instead of blocking generation', () => {
  const commercialScript = {
    ...script,
    targetDurationSec: 60,
    estimatedDurationSec: 60,
    scenes: Array.from({ length: 6 }, (_, index) => scene(`S${String(index + 1).padStart(2, '0')}`, index + 1, 10))
  };
  const plan = buildStoryboardSegmentPlan(commercialScript, 15);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.flatMap((item) => item.sceneKeys), commercialScript.scenes.map((item) => item.sceneKey));
  assert.ok(plan.some((item) => item.sceneKeys.length > 1));
  assert.deepEqual(plan.map((item) => item.targetDurationSec), [15, 15, 15, 15]);
  const request = buildStoryboardPromptRequest({ script: commercialScript, styleSelection, assets: [], segmentDurationSec: 15 });
  assert.deepEqual(request.input.segmentSlots.map((item) => item.sceneKeys), plan.map((item) => item.sceneKeys));
});

test('only the final episode remainder may be shorter than the selected duration', () => {
  const remainderScript = { ...script, targetDurationSec: 31, estimatedDurationSec: 31, scenes: [scene('S01', 1, 31)] };
  assert.deepEqual(buildStoryboardSegmentPlan(remainderScript, 5).map((item) => item.targetDurationSec), [5, 5, 5, 5, 5, 5, 1]);
});

test('fixed slots keep each segment inside one scene and move transitions to segment boundaries', () => {
  const crossoverScript = { ...script, targetDurationSec: 10, estimatedDurationSec: 10, scenes: [scene('S01', 1, 7), scene('S02', 2, 3)] };
  const draft = {
    segments: [
      {
        segmentKey: 'SEG001', sceneKey: 'S01', order: 1, title: '前场推进', durationSec: 5, characters: ['张浩然'],
        sceneAssetKey: 'none', sceneViewKey: 'text-only', propStateKey: 'none', actionEvidenceIds: ['B-S01-A01'], dialogueEvidenceIds: ['B-S01-D01'], soundCueIds: ['B-S01-S01'],
        storyboardText: '夜晚荒野山道，张浩然推进动作并说：“S01对白”', transition: 'cut'
      },
      {
        segmentKey: 'SEG002', sceneKey: 'S02', order: 2, title: '后场承接', durationSec: 5, characters: ['林无双'],
        sceneAssetKey: 'none', sceneViewKey: 'text-only', propStateKey: 'none', actionEvidenceIds: ['B-S02-A01'], dialogueEvidenceIds: ['B-S02-D01'], soundCueIds: ['B-S02-S01'],
        storyboardText: '夜晚荒野山道，林无双继续行动并说：“S02对白”', transition: 'cut'
      }
    ]
  };
  const input = { script: crossoverScript, styleSelection, assets: [], segmentDurationSec: 5 };
  const normalized = normalizeStoryboardPromptDraft(draft, input);
  assert.deepEqual(normalized.segments[1].sceneKeys, ['S02']);
  assert.deepEqual(normalized.segments[1].actionEvidenceIds, ['B-S02-A01']);
  assert.deepEqual(normalized.segments[1].dialogueEvidenceIds, ['B-S02-D01']);
  assert.equal(normalized.segments[0].transition, 'continuous');
  assert.equal(normalized.segments[1].transition, 'fade_to_black');
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, input));
});

test('request asks only for concise storyboard cards', () => {
  const request = buildStoryboardPromptRequest({ script, styleSelection, assets });
  assert.equal(request.operation, 'generate-concise-storyboard-segments');
  assert.equal(request.maxOutputTokens, TEXT_TOKEN_BUDGETS.storyboardSegments);
  assert.equal(request.input.segmentSlots.length, 7);
  assert.equal(request.outputSchema.properties.segments.minItems, 7);
  assert.equal(request.outputSchema.properties.segments.maxItems, 7);
  assert.match(request.instructions, /不写五段式生图提示词/);
  assert.match(request.instructions, /时间使用白天、夜晚等完整中文表达/);
  assert.doesNotMatch(JSON.stringify(request.outputSchema), /referenceAssetIds/);
});

test('web storyboard request derives character and scene choices from approved assets', () => {
  const webScript = { ...script, targetDurationSec: 15, estimatedDurationSec: 15, scenes: [{ ...scene('S01', 1, 15), dialogue: [], action: '探索者穿过密林。' }] };
  const webAssets = [
    asset('explorer-main', 'character', { characterName: '探索者' }),
    asset('jungle-main', 'scene', { sceneAssetKey: 'L-JUNGLE', sourceSceneKeys: ['S01'], viewKey: 'main' }),
  ];
  const request = buildStoryboardPromptRequest({ script: webScript, styleSelection, assets: webAssets });
  const serialized = JSON.stringify(request);
  assert.match(request.instructions, /探索者/);
  assert.match(request.instructions, /L-JUNGLE/);
  assert.deepEqual(request.outputSchema.properties.segments.items.properties.characters.items.enum, ['探索者']);
  assert.deepEqual(request.outputSchema.properties.segments.items.properties.sceneAssetKey.enum, ['none', 'L-JUNGLE']);
  assert.doesNotMatch(serialized, /张浩然|林无双|人皇印/);
});

test('all character scene and prop asset combinations remain optional without empty schema enums', () => {
  const categories = ['character', 'scene', 'prop'];
  const emptyEnums = (value, path = '$') => {
    if (!value || typeof value !== 'object') return [];
    const own = Array.isArray(value.enum) && value.enum.length === 0 ? [path] : [];
    return Object.entries(value).reduce((all, [key, child]) => [...all, ...emptyEnums(child, `${path}.${key}`)], own);
  };

  for (let mask = 0; mask < 8; mask += 1) {
    const optionalAssets = assets.filter((item) => categories.some((kind, index) => item.assetKind === kind && (mask & (1 << index))));
    const input = { script, styleSelection, assets: optionalAssets };
    const request = buildStoryboardPromptRequest(input);
    assert.deepEqual(emptyEnums(request.outputSchema), [], `mask ${mask} must not contain enum: []`);

    const normalized = normalizeStoryboardPromptDraft({ segments: validSegments() }, input);
    assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, input), `mask ${mask} must allow omitted asset categories`);
    if (!optionalAssets.some((item) => item.assetKind === 'scene')) {
      assert.ok(normalized.segments.every((segment) => !segment.sceneAssetKey && segment.sceneViewKey === 'text-only'));
    }
  }
});

test('program resolves semantic choices to approved asset IDs', () => {
  const normalized = normalizeStoryboardPromptDraft({ segments: validSegments() }, { script, styleSelection, assets });
  assert.deepEqual(normalized.segments[0].referenceAssetIds, ['zhang-main', 'scene-reverse']);
  assert.deepEqual(normalized.segments[4].referenceAssetIds, ['lin-main', 'scene-reverse', 'prop-activated']);
});

test('program owns segment bookkeeping, final transitions and approved scene bindings', () => {
  const segments = validSegments();
  segments[0].segmentKey = 'SEG999';
  segments[0].order = 99;
  segments[0].durationSec = 9;
  segments[3].transition = 'cut';
  segments[6].transition = 'continuous';

  const normalized = normalizeStoryboardPromptDraft({ segments }, { script, styleSelection, assets });

  assert.deepEqual(normalized.segments.slice(0, 2).map(({ segmentKey, sceneKey, order, durationSec }) => ({ segmentKey, sceneKey, order, durationSec })), [
    { segmentKey: 'SEG001', sceneKey: 'S01', order: 1, durationSec: 15 },
    { segmentKey: 'SEG002', sceneKey: 'S01', order: 2, durationSec: 15 },
  ]);
  assert.equal(normalized.segments[3].transition, 'continuous');
  assert.equal(normalized.segments[6].transition, 'fade_to_black');
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script, styleSelection, assets }));
});

test('director may rebalance complete scenes across fixed slots while preserving order', () => {
  const directedScript = {
    ...script,
    targetDurationSec: 30,
    estimatedDurationSec: 30,
    scenes: [scene('S01', 1, 7), scene('S02', 2, 7), scene('S03', 3, 7), scene('S04', 4, 9)].map((item) => ({ ...item, dialogue: [], action: `${item.sceneKey}动作。` }))
  };
  const allocation = ['S01', 'S02', 'S02', 'S03', 'S04', 'S04'];
  const draft = {
    segments: allocation.map((sceneKey, index) => ({
      segmentKey: `SEG${String(index + 1).padStart(3, '0')}`, sceneKey, order: index + 1, title: `${sceneKey}段落${index + 1}`, durationSec: 5, characters: [],
      sceneAssetKey: 'none', sceneViewKey: 'text-only', propStateKey: 'none', actionEvidenceIds: [`B-${sceneKey}-A01`], dialogueEvidenceIds: [], soundCueIds: [],
      storyboardText: `${sceneKey}场景内完成当前固定时长动作。`, transition: 'cut'
    }))
  };
  const input = { script: directedScript, styleSelection, assets: [], segmentDurationSec: 5 };
  const normalized = normalizeStoryboardPromptDraft(draft, input);
  assert.deepEqual(normalized.segments.map((item) => item.sceneKey), allocation);
  assert.ok(normalized.segments.every((item) => item.sceneKeys.length === 1));
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, input));
});

test('program recovers dialogue evidence and live speakers from returned storyboard text', () => {
  const segments = validSegments();
  segments[0].dialogueEvidenceIds = [];
  segments[0].characters = [];
  segments[1].dialogueEvidenceIds = ['B-S01-D01', 'B-S99-D99'];

  const normalized = normalizeStoryboardPromptDraft({ segments }, { script, styleSelection, assets });

  assert.deepEqual(normalized.segments[0].dialogueEvidenceIds, ['B-S01-D01']);
  assert.deepEqual(normalized.segments[1].dialogueEvidenceIds, []);
  assert.deepEqual(normalized.segments[0].characters, ['张浩然']);
  assert.ok(normalized.segments[0].referenceAssetIds.includes('zhang-main'));
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script, styleSelection, assets }));
});

test('dialogue punctuation and quote formatting do not reject otherwise identical text', () => {
  const punctuationScript = structuredClone(script);
  punctuationScript.scenes[0].dialogue[0].text = '你，好……继续走！';
  const segments = validSegments();
  segments[0].storyboardText = '夜晚荒野山道，张浩然低声说：“你 好，继续走。”';

  const normalized = normalizeStoryboardPromptDraft({ segments }, { script: punctuationScript, styleSelection, assets });

  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script: punctuationScript, styleSelection, assets }));
});

test('valid seven segments cover evidence with exact scene boundaries', () => {
  const normalized = normalizeStoryboardPromptDraft({ segments: validSegments() }, { script, styleSelection, assets });
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script, styleSelection, assets }));
});

test('validation rejects rewritten dialogue and wrong duration', () => {
  const segments = validSegments();
  segments[0].storyboardText = '对白被删掉';
  segments[4].durationSec = 14;
  assert.throws(() => validateStoryboardPromptDraft({ segments }, { script, styleSelection, assets }), /must preserve dialogue|must match SEG005 plan/);
});

test('failed storyboard dialogue is repaired once per affected segment and then written as a complete batch', async () => {
  const initial = validSegments();
  initial[0].storyboardText = '夜晚荒野山道，张浩然完成本段动作，但对白文字缺失。';
  const repaired = validSegments()[0];
  const requests = [];
  const provider = {
    id: 'storyboard-repair-test',
    async health() { return { status: 'ok', message: 'ok', checkedAt: new Date().toISOString() }; },
    async generate(request) {
      requests.push(request);
      return {
        output: request.operation === 'generate-concise-storyboard-segments' ? { segments: initial } : { segment: repaired },
        providerId: 'storyboard-repair-test', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };

  const input = { script, styleSelection, assets };
  const result = await generateStoryboardPromptsWithRepair(provider, input);
  assert.deepEqual(requests.map((request) => request.operation), ['generate-concise-storyboard-segments', 'repair-concise-storyboard-segment']);
  assert.equal(result.repairAttempted, true);
  assert.deepEqual(result.repairedSegmentKeys, ['SEG001']);
  assert.match(result.output.segments[0].storyboardText, /S01对白/u);
  assert.doesNotThrow(() => validateStoryboardPromptDraft(result.output, input));
  const repairRequest = buildStoryboardSegmentRepairRequest(input, { segments: initial }, 'SEG001', ['SEG001 must preserve dialogue B-S01-D01 verbatim']);
  assert.match(repairRequest.instructions, /只修改当前这一段/u);
  assert.equal(repairRequest.outputSchema.required[0], 'segment');
});

test('voiceover narrator is preserved without becoming an on-screen character reference', () => {
  const voiceoverScript = structuredClone(script);
  voiceoverScript.scenes[1].dialogue.push({ kind: 'voiceover', speakerName: '旁白', text: '并非死别，只是生离。', delivery: '画外音' });
  const segments = validSegments();
  segments[6].dialogueEvidenceIds.push('B-S02-D02');
  segments[6].storyboardText += ' 画外音：“并非死别，只是生离。”';

  const normalized = normalizeStoryboardPromptDraft({ segments }, { script: voiceoverScript, styleSelection, assets });

  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script: voiceoverScript, styleSelection, assets }));
  assert.doesNotMatch(normalized.segments[6].characters.join('、'), /旁白/);
});

test('action evidence order is normalized and coverage drift becomes a review warning', () => {
  const segments = validSegments();
  segments[0].actionEvidenceIds = ['B-S01-A02', 'B-S01-A01', 'B-S01-A01'];
  segments[1].actionEvidenceIds = ['B-S01-A04'];
  const normalized = normalizeStoryboardPromptDraft({ segments }, { script, styleSelection, assets });
  assert.deepEqual(normalized.segments[0].actionEvidenceIds, ['B-S01-A01', 'B-S01-A02']);
  assert.doesNotThrow(() => validateStoryboardPromptDraft(normalized, { script, styleSelection, assets }));
  assert.match(collectStoryboardValidationWarnings(normalized, { script, styleSelection, assets }).join('\n'), /B-S01-A03/);
});

test('versions preserve stable segment IDs and chosen duration', () => {
  const v1 = materializeStoryboardPromptSet({ promptSetId: 'storyboard-prompts-1', script, styleSelection, assets, segments: validSegments(), timestamp: '2026-01-01T00:00:00Z' });
  const v2 = materializeStoryboardPromptSet({ promptSetId: 'storyboard-prompts-1', script, styleSelection, assets, segments: validSegments(), previousPromptSet: v1, timestamp: '2026-01-02T00:00:00Z' });
  assert.equal(v1.segmentDurationSec, 15);
  assert.equal(v1.segments.length, 7);
  assert.equal(v2.segments[0].id, v1.segments[0].id);
  assert.equal(v2.version, 2);
});

test('evidence catalog preserves dialogue speaker and delivery', () => {
  const dialogue = buildStoryboardEvidenceCatalog(script).find((item) => item.evidenceId === 'B-S01-D01');
  assert.equal(dialogue.speakerName, '张浩然');
  assert.equal(dialogue.delivery, '冷静');
  assert.equal(dialogue.speechKind, 'dialogue');
});
