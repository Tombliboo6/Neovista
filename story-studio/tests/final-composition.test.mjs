import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFinalSubtitleCues, ffmpegFilterPath, renderFinalSrt } from '../src/postproduction/final-composition.ts';

test('final subtitle cues use approved dialogue and actual segment offsets', () => {
  const cues = buildFinalSubtitleCues({
    ideaScript: { scenes: [{ blocks: [
      { type: 'dialogue', text: '第一句' },
      { type: 'os', text: '第二句' },
      { type: 'transition', text: '硬切至黑场。字幕浮现：“片尾字。”' },
    ] }] },
    videoPrompts: [
      { segmentKey: 'SEG001', plan: { videoPromptSections: { shotExecution: '0-2秒：他说：“第一句”。2-5秒：没有台词。' } } },
      { segmentKey: 'SEG002', plan: { videoPromptSections: { timelineBeats: [{ startSec: 1, endSec: 2, execution: '内心声：“第二句”。' }] } } },
    ],
    segmentDurations: [{ segmentKey: 'SEG001', durationSec: 5.167 }, { segmentKey: 'SEG002', durationSec: 5.083 }],
    totalDurationSec: 10.25,
  });
  assert.deepEqual(cues.map(({ startSec, endSec, text, source }) => ({ startSec, endSec, text, source })), [
    { startSec: 0, endSec: 2, text: '第一句', source: 'SEG001' },
    { startSec: 6.167, endSec: 7.167, text: '第二句', source: 'SEG002' },
    { startSec: 8.75, endSec: 10.17, text: '片尾字。', source: 'ending-title' },
  ]);
  assert.match(renderFinalSrt(cues), /00:00:06,167 --> 00:00:07,167\n第二句/u);
  assert.equal(ffmpegFilterPath('E:\\制作\\成片.srt'), 'E\\:/制作/成片.srt');
});
