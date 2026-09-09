import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSemanticEpisodeSplitRequest,
  EPISODE_SPLIT_SCHEMA_NAME,
  SemanticSplitValidationError,
  splitNovelSemantically,
  validateSemanticEpisodeSplitOutput
} from '../src/episodes/semantic-split.ts';

const segments = [
  {
    id: 'segment-1',
    documentId: 'novel-1',
    documentVersion: 1,
    order: 1,
    sourceStart: 0,
    sourceEnd: 8,
    text: '人物收到密信。',
    characterCount: 8
  },
  {
    id: 'segment-2',
    documentId: 'novel-1',
    documentVersion: 1,
    order: 2,
    sourceStart: 8,
    sourceEnd: 17,
    text: '他决定连夜赴约。',
    characterCount: 9
  }
];

const input = {
  documentId: 'novel-1',
  documentVersion: 1,
  segments,
  preferences: { targetDurationSec: 90, minimumEpisodes: 1, maximumEpisodes: 2 }
};

const validOutput = {
  globalAnalysis: {
    premise: '一封密信迫使主角做出选择。',
    centralConflict: '主角必须在安全与真相之间取舍。',
    mainCharacters: [
      { name: '主角', role: '行动者', goal: '查明真相', initialState: '尚未行动' }
    ],
    majorTurningPoints: ['收到密信', '决定赴约'],
    continuityRisks: ['密信内容尚未揭示']
  },
  episodes: [
    {
      episodeNumber: 1,
      title: '密信之夜',
      sourceSegmentIds: ['segment-1', 'segment-2'],
      sourceStart: 0,
      sourceEnd: 17,
      synopsis: '主角收到神秘密信并决定连夜赴约。',
      openingHook: '密信突然出现。',
      openingHookEvidence: '人物收到密信。',
      endingHook: '主角踏入夜色，赴约结果未知。',
      endingHookEvidence: '他决定连夜赴约。',
      targetDurationSec: 90,
      keyCharacters: ['主角'],
      dramaticArc: {
        setup: '主角收到密信。',
        escalation: '密信要求立即行动。',
        turningPoint: '主角决定冒险赴约。',
        payoff: '主角正式出发。'
      },
      continuityIn: '主角尚未得知密信。',
      continuityOut: '主角正在赴约，密信内容待揭示。',
      boundaryReason: '行动决定形成完整的小节并留下赴约悬念。'
    }
  ]
};

test('semantic splitting builds an intelligent structured request', () => {
  const request = buildSemanticEpisodeSplitRequest(input);

  assert.equal(request.operation, 'split-novel-into-episodes');
  assert.equal(request.schemaName, EPISODE_SPLIT_SCHEMA_NAME);
  assert.equal(request.input, input);
  assert.match(request.instructions, /不能只按章节数量或字数平均切分/);
  assert.match(request.instructions, /targetDurationSec 是单集目标成片时长/);
  assert.match(request.instructions, /自动决定集数/);
  assert.equal(request.outputSchema.type, 'object');
});

test('semantic splitting rejects segments from another document version', () => {
  assert.throws(
    () => buildSemanticEpisodeSplitRequest({ ...input, documentVersion: 2 }),
    /document version/
  );
});

test('semantic output must cover every source segment exactly once and in order', () => {
  assert.doesNotThrow(() => validateSemanticEpisodeSplitOutput(validOutput, input));

  const invalidOutput = structuredClone(validOutput);
  invalidOutput.episodes[0].sourceSegmentIds = ['segment-2'];
  invalidOutput.episodes[0].sourceStart = 8;

  assert.throws(
    () => validateSemanticEpisodeSplitOutput(invalidOutput, input),
    SemanticSplitValidationError
  );
});

test('hook evidence must exist inside the episode assigned source', () => {
  const invalidOutput = structuredClone(validOutput);
  invalidOutput.episodes[0].endingHookEvidence = '门外突然响起枪声。';

  assert.throws(
    () => validateSemanticEpisodeSplitOutput(invalidOutput, input),
    /endingHookEvidence is not in assigned source/
  );
});

test('semantic splitting validates the structured result returned by the provider', async () => {
  const fakeProvider = {
    id: 'fake-agent',
    async health() {
      return { status: 'ok', message: 'ready', checkedAt: '2026-08-21T00:00:00.000Z' };
    },
    async generate() {
      return {
        output: validOutput,
        providerId: 'fake-agent',
        model: 'fake-model',
        status: 'completed',
        completedAt: '2026-08-21T00:00:00.000Z',
        elapsedMs: 1
      };
    }
  };

  const result = await splitNovelSemantically(fakeProvider, input);
  assert.equal(result.output.episodes[0].endingHook, validOutput.episodes[0].endingHook);
});
