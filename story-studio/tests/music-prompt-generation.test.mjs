import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMusicPromptRepairRequest,
  buildMusicPromptRequest,
  collectMusicPromptValidationWarnings,
  generateMusicPromptPlan,
  MusicPromptValidationError,
  validateMusicPromptPlan,
} from '../src/postproduction/music-prompt-generation.ts';

const input = {
  projectTitle: '侏罗纪·生',
  logline: '一个男人在原始丛林中逃出生天。',
  targetDurationSec: 60.783,
  audioMode: 'native_with_music',
  subtitles: 'burned',
  segments: [
    { segmentKey: 'SEG001', title: '苏醒', durationSec: 15, storyboardText: '男人在泥地中苏醒。', transition: 'cut' },
    { segmentKey: 'SEG002', title: '脚步', durationSec: 15, storyboardText: '他听见危险逼近。', transition: 'cut' },
    { segmentKey: 'SEG003', title: '追逐', durationSec: 15, storyboardText: '男人在密林中逃跑。', transition: 'cut' },
    { segmentKey: 'SEG004', title: '藏身', durationSec: 15, storyboardText: '他躲入岩缝。', transition: 'cut' },
    { segmentKey: 'SEG005', title: '喘息', durationSec: 15, storyboardText: '男人屏住呼吸。', transition: 'cut' },
    { segmentKey: 'SEG006', title: '继续走', durationSec: 15, storyboardText: '危险远去，他继续前进。', transition: 'fade_to_black' },
  ],
};

function validPlan() {
  const request = buildMusicPromptRequest(input);
  return {
    title: '原始丛林求生配乐',
    creativeDirection: '以低频脉冲和稀疏弦乐推动求生压力，结尾保留微弱希望。',
    minimaxPrompt: '纯器乐电影配乐，低频脉冲、克制弦乐与原始打击乐承担全部主题，从压抑苏醒逐步推进至追逐高峰，随后收束为微弱希望；保持中频疏朗和充足动态留白。',
    instrumental: true,
    targetDurationSec: input.targetDurationSec,
    cues: request.input.timeline.map((item, index) => ({
      segmentKey: item.segmentKey, startSec: item.startSec, endSec: item.endSec,
      musicalFunction: `段落${index + 1}`, energy: index === 2 ? 'high' : 'low', instrumentation: '弦乐与打击乐', mixNote: '为原声让位',
    })),
    mixGuidance: ['对白与动作声出现时自动压低配乐', '片头片尾各做短淡入淡出'],
  };
}

test('music prompt request fixes the approved rough-cut timeline and instrumental policy', () => {
  const request = buildMusicPromptRequest(input, { maxOutputTokens: 32000 });
  assert.equal(request.operation, 'design-rough-cut-background-score');
  assert.equal(request.maxOutputTokens, 32000);
  assert.equal(request.input.timeline.length, 6);
  assert.equal(request.input.timeline[0].startSec, 0);
  assert.equal(request.input.timeline.at(-1).endSec, 60.783);
  assert.match(request.instructions, /instrumental必须为true/u);
  assert.match(request.instructions, /首句必须明确“纯器乐电影配乐”/u);
  assert.equal(request.outputSchema.properties.minimaxPrompt.maxLength, undefined);
  assert.equal(request.outputSchema.properties.mixGuidance.minItems, undefined);
  assert.equal(request.outputSchema.properties.mixGuidance.maxItems, undefined);
});

test('music prompt generation returns a validated editable plan', async () => {
  const plan = validPlan();
  const provider = {
    id: 'fake-agent',
    async health() { throw new Error('not used'); },
    async generate(request) {
      assert.equal(request.input.audioMode, 'native_with_music');
      return { output: plan, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };
  assert.deepEqual(await generateMusicPromptPlan(provider, input), plan);
});

test('music prompt validation blocks timing or vocals and advises on optional wording quality', () => {
  const changedTiming = validPlan();
  changedTiming.cues[1].startSec += 1;
  assert.deepEqual(validateMusicPromptPlan(changedTiming, input), changedTiming);
  assert.deepEqual(collectMusicPromptValidationWarnings(changedTiming, input), ['SEG002 time boundary changed']);
  const vocals = { ...validPlan(), instrumental: false };
  assert.throws(() => validateMusicPromptPlan(vocals, input), /instrumental must be true/u);
  const negativeVocalWording = { ...validPlan(), minimaxPrompt: '纯器乐电影配乐，低频弦乐与钢琴承担全部主题，并明确要求无人声、无歌词、保持动态留白。' };
  assert.doesNotThrow(() => validateMusicPromptPlan(negativeVocalWording, input));
  const missingInstrumentOwnership = { ...validPlan(), minimaxPrompt: '纯器乐电影配乐，以悬疑氛围逐渐推进到追逐高峰，随后自然收束，保持中频疏朗和充足动态留白。' };
  assert.deepEqual(validateMusicPromptPlan(missingInstrumentOwnership, input), missingInstrumentOwnership);
  assert.deepEqual(collectMusicPromptValidationWarnings(missingInstrumentOwnership, input), []);
});

test('music prompt validation accepts clear semantic instrument ownership without one fixed phrase', () => {
  const semanticOwnership = {
    ...validPlan(),
    minimaxPrompt: '纯器乐电影配乐，以钢琴与低音弦乐作为全片旋律核心，克制打击乐负责主要节奏和情绪推进；音乐从压抑苏醒逐步抵达追逐高峰，随后自然收束，保留疏朗中频与动态空间。',
  };
  assert.deepEqual(validateMusicPromptPlan(semanticOwnership, input), semanticOwnership);
});

test('music prompt repair request keeps the rejected draft and exact issues for one bounded correction', () => {
  const draft = { ...validPlan(), minimaxPrompt: '纯器乐电影配乐，以悬疑氛围逐渐推进到追逐高峰，随后自然收束，保持中频疏朗和充足动态留白。' };
  const request = buildMusicPromptRepairRequest(input, { draft, validationIssues: ['没有明确指定由哪些乐器完整承担旋律与主题。'] });
  assert.equal(request.operation, 'repair-rough-cut-background-score');
  assert.equal(request.schemaName, 'music_prompt_plan_repair_v1');
  assert.deepEqual(request.input.repairContext.previousDraft, draft);
  assert.match(request.instructions, /唯一一次自动校正/u);
  assert.match(request.instructions, /只修正这些问题/u);
});
