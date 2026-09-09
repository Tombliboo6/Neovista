import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSeriesEpisodeScript } from '../src/scripts/series-episode-script.ts';

const seriesScript = {
  title: '重生资本', logline: '林然重回资本局，逐步夺回被掠走的一切。', genre: '都市商战', durationSec: 60, ratio: '9:16', language: '中文', emotion: '冲突',
  workType: 'series', plannedEpisodeCount: 3, episodeNumber: 1,
  seriesPlan: [
    { episodeNumber: 1, title: '回到签约夜', summary: '林然识破合同陷阱。', hook: '她留下隐藏证据。' },
    { episodeNumber: 2, title: '证据开价', summary: '林然用证据迫使陈曜让步。', hook: '苏蔓拿出另一份账本。' },
    { episodeNumber: 3, title: '账本背面', summary: '三人围绕账本正面对决。', hook: '真正出资人现身。' },
  ],
  characters: [
    { name: '林然', role: '主角', goal: '夺回公司' },
    { name: '陈曜', role: '对手', goal: '控制交易' },
    { name: '苏蔓', role: '暗线角色', goal: '保住账本' },
  ],
  scenes: [{ id: 'E01-SC001', location: '会议室', time: '夜', summary: '林然拒绝签字。', beats: ['推开合同'], dialogue: [{ speaker: '林然', line: '这份合同作废。' }], blocks: [{ type: 'dialogue', speaker: '林然', delivery: '冷静', text: '这份合同作废。' }] }],
  endingHook: '林然留下隐藏证据。',
};

test('series episode generation expands only the selected episode and preserves the series contract', async () => {
  let captured;
  const provider = {
    id: 'fake-agent', health: async () => ({}),
    generate: async (request) => {
      captured = request;
      return { output: {
        episodeNumber: 2, title: '证据开价', logline: '林然在一次谈判中用证据换回主动权。',
        scenes: [{ id: 'E02-SC001', location: '办公室', time: '日', summary: '林然亮出证据。', beats: ['放下录音笔'], dialogue: [{ speaker: '林然', line: '现在轮到我开价。' }], blocks: [{ type: 'action', speaker: '', delivery: '', text: '林然把录音笔放在桌面中央。' }, { type: 'dialogue', speaker: '林然', delivery: '克制', text: '现在轮到我开价。' }] }],
        endingHook: '苏蔓拿出另一份账本。',
      }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };

  const sourceText = '林然先放下录音笔，再播放录音。';
  const output = await generateSeriesEpisodeScript(provider, { seriesScript, episodeNumber: 2, priorEpisodeScript: seriesScript, sourceText });
  assert.equal(captured.input.sourceText, sourceText);
  assert.deepEqual(captured.outputSchema.properties.episodeNumber.enum, [2]);
  assert.match(captured.instructions, /原文的具体事实优先/);
  assert.equal(captured.operation, 'generate-series-episode-script');
  assert.equal(captured.input.targetEpisode.episodeNumber, 2);
  assert.equal(captured.input.nextEpisodeBoundary.episodeNumber, 3);
  assert.equal(captured.input.series.seriesPlan, undefined);
  assert.match(captured.instructions, /不得提前消费后续集/);
  assert.equal(output.episodeNumber, 2);
  assert.equal(output.title, '证据开价');
  assert.equal(output.seriesPlan.length, 3);
  assert.equal(output.durationSec, 60);
  assert.equal(output.scenes[0].id, 'E02-SC001');
});

test('invalid target episode is rejected before the provider is called', async () => {
  let called = false;
  const provider = { id: 'fake-agent', health: async () => ({}), generate: async () => { called = true; } };
  await assert.rejects(() => generateSeriesEpisodeScript(provider, { seriesScript, episodeNumber: 9 }), /没有目标集/);
  assert.equal(called, false);
});
