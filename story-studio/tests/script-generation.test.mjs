import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEpisodeScriptRequest,
  generateEpisodeScript,
  SCRIPT_DRAFT_SCHEMA_NAME,
  ScriptDraftValidationError,
  validateEpisodeScriptDraft
} from '../src/scripts/script-generation.ts';
import { materializeScriptVersion } from '../src/scripts/script-versioning.ts';

const segments = [
  {
    id: 'segment-1',
    documentId: 'novel-1',
    documentVersion: 1,
    order: 1,
    sourceStart: 0,
    sourceEnd: 8,
    text: '雨夜里，主角收到密信。',
    characterCount: 12
  },
  {
    id: 'segment-2',
    documentId: 'novel-1',
    documentVersion: 1,
    order: 2,
    sourceStart: 8,
    sourceEnd: 18,
    text: '他烧掉密信，决定连夜赴约。',
    characterCount: 14
  }
];

const episode = {
  id: 'episode-1',
  version: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  approval: 'approved',
  episodeNumber: 1,
  title: '密信之夜',
  sourceSegmentIds: ['segment-1', 'segment-2'],
  sourceStart: 0,
  sourceEnd: 18,
  synopsis: '主角收到密信并决定连夜赴约。',
  openingHook: '雨夜密信突然出现。',
  openingHookEvidence: '主角收到密信',
  endingHook: '主角决定赴约。',
  endingHookEvidence: '决定连夜赴约',
  targetDurationSec: 90,
  keyCharacters: ['主角'],
  dramaticArc: {
    setup: '主角收到密信。',
    escalation: '密信迫使他选择。',
    turningPoint: '他烧掉密信。',
    payoff: '他决定赴约。'
  },
  continuityIn: '主角尚未见到密信。',
  continuityOut: '主角已经出发，赴约结果未知。',
  boundaryReason: '行动决定形成集尾悬念。'
};

const input = {
  documentId: 'novel-1',
  documentVersion: 1,
  episode,
  segments,
  preferences: { language: 'zh-CN', durationToleranceSec: 15 }
};

const validDraft = {
  title: '密信之夜',
  logline: '一封雨夜密信迫使主角踏上未知赴约之路。',
  synopsis: '主角收到密信，权衡后烧掉信件并冒险赴约。',
  targetDurationSec: 90,
  estimatedDurationSec: 90,
  openingHook: '密信在雨夜突然出现。',
  endingHook: '主角消失在雨幕中，赴约结果未知。',
  scenes: [
    {
      sceneKey: 'S01',
      order: 1,
      heading: '外景·屋檐下·雨夜',
      location: '旧屋屋檐下',
      timeOfDay: '夜',
      interiorExterior: 'exterior',
      sourceSegmentIds: ['segment-1'],
      sourceStart: 0,
      sourceEnd: 8,
      sourceEvidence: ['主角收到密信'],
      purpose: '建立密信钩子。',
      durationSec: 35,
      action: '主角在雨中发现并拆开密信，神情由警觉转为凝重。',
      dialogue: [],
      soundCues: ['持续雨声', '纸张展开声'],
      transitionOut: 'cut'
    },
    {
      sceneKey: 'S02',
      order: 2,
      heading: '内景·旧屋·雨夜',
      location: '旧屋',
      timeOfDay: '夜',
      interiorExterior: 'interior',
      sourceSegmentIds: ['segment-2'],
      sourceStart: 8,
      sourceEnd: 18,
      sourceEvidence: ['决定连夜赴约'],
      purpose: '完成行动选择并留下悬念。',
      durationSec: 55,
      action: '主角将密信投入火盆，披衣推门进入雨夜。',
      dialogue: [
        {
          kind: 'internal_monologue',
          speakerName: '主角',
          text: '既然你要我去，我就去看看。',
          delivery: '压低声音，保持警惕'
        }
      ],
      soundCues: ['纸张燃烧声', '木门开启声'],
      transitionOut: 'fade_to_black'
    }
  ],
  adaptationNotes: ['把原文决定转化为可见的烧信与出门动作。'],
  continuityOut: '主角已离开旧屋前往约定地点，密信内容仍未公开。'
};

test('script generation requires an approved episode and builds a grounded request', () => {
  const request = buildEpisodeScriptRequest(input);

  assert.equal(request.operation, 'generate-episode-script');
  assert.equal(request.schemaName, SCRIPT_DRAFT_SCHEMA_NAME);
  assert.equal(request.maxOutputTokens, 40_000);
  assert.match(request.instructions, /不得引用下一集/);
  assert.match(request.instructions, /每个输入 segment ID 必须且只能分配给一个场次/);
  assert.equal(request.outputSchema.type, 'object');

  assert.throws(
    () => buildEpisodeScriptRequest({ ...input, episode: { ...episode, approval: 'draft' } }),
    /must be approved/
  );
});

test('valid script covers approved source once and preserves hook evidence boundaries', () => {
  assert.doesNotThrow(() => validateEpisodeScriptDraft(validDraft, input));
});

test('script validation rejects invented evidence and source coverage gaps', () => {
  const invented = structuredClone(validDraft);
  invented.scenes[1].sourceEvidence = ['门外突然响起枪声'];
  assert.throws(
    () => validateEpisodeScriptDraft(invented, input),
    /sourceEvidence is not in assigned source/
  );

  const missing = structuredClone(validDraft);
  missing.scenes = [missing.scenes[0]];
  missing.estimatedDurationSec = 35;
  assert.throws(
    () => validateEpisodeScriptDraft(missing, input),
    ScriptDraftValidationError
  );
});

test('script validation rejects duration accounting and tolerance drift', () => {
  const badTotal = structuredClone(validDraft);
  badTotal.estimatedDurationSec = 89;
  assert.throws(
    () => validateEpisodeScriptDraft(badTotal, input),
    /must equal the sum of scene durations/
  );

  const tooLong = structuredClone(validDraft);
  tooLong.scenes[1].durationSec = 90;
  tooLong.estimatedDurationSec = 125;
  assert.throws(
    () => validateEpisodeScriptDraft(tooLong, input),
    /exceeds the allowed tolerance/
  );
});

test('script validation enforces a no-narration preference', () => {
  assert.throws(
    () =>
      validateEpisodeScriptDraft(validDraft, {
        ...input,
        preferences: { ...input.preferences, allowNarration: false }
      }),
    /uses narration while allowNarration is false/
  );
});

test('provider output is validated before a generated script is accepted', async () => {
  const fakeProvider = {
    id: 'fake-agent',
    async health() {
      return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' };
    },
    async generate() {
      return {
        output: validDraft,
        providerId: 'fake-agent',
        model: 'fake-model',
        status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z',
        elapsedMs: 1
      };
    }
  };

  const result = await generateEpisodeScript(fakeProvider, input);
  assert.equal(result.output.scenes.length, 2);
});

test('script materialization preserves script and matching scene IDs across versions', () => {
  const first = materializeScriptVersion({
    scriptId: 'script-episode-1',
    documentId: 'novel-1',
    documentVersion: 1,
    episode,
    draft: validDraft,
    timestamp: '2026-08-21T01:00:00.000Z'
  });
  const revisedDraft = structuredClone(validDraft);
  revisedDraft.synopsis = '修改后的梗概。';
  const second = materializeScriptVersion({
    scriptId: 'script-episode-1',
    documentId: 'novel-1',
    documentVersion: 1,
    episode,
    draft: revisedDraft,
    previousScript: first,
    timestamp: '2026-08-21T02:00:00.000Z'
  });

  assert.equal(first.id, second.id);
  assert.equal(second.version, 2);
  assert.equal(second.approval, 'draft');
  assert.deepEqual(
    first.scenes.map((scene) => scene.id),
    second.scenes.map((scene) => scene.id)
  );
});
