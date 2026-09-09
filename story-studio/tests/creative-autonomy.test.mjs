import { mergeByStableKey } from '../web/src/production-state.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CREATIVE_SELF_REVIEW, withCreativeSelfReview } from '../src/providers/creative-review.ts';
import { scheduledAgent, RequestScheduler } from '../src/providers/request-scheduler.ts';
import { buildSegmentVideoPromptRequest, normalizeSegmentVideoPromptBookkeeping, validateSegmentVideoPromptPlan } from '../src/videos/video-prompt-generation.ts';
import { normalizeStoryboardBoardPlan } from '../src/storyboards/storyboard-board-generation.ts';
import { validateStructuredOutput } from '../src/providers/structured-output.ts';
import { normalizeAndValidateVideoPromptBatchItems } from '../web/local-api.mjs';

const source = readFileSync(new URL('./video-prompt-generation.test.mjs', import.meta.url), 'utf8');
const { input, plan } = new Function(`${source.slice(source.indexOf('const segment ='), source.indexOf("test('"))}; return { input, plan };`)();

test('shared generation self-review is idempotent and uses exactly one provider request', async () => {
  let calls = 0;
  const scheduler = new RequestScheduler();
  const provider = scheduledAgent({ id: 'fixture', async generate(request) {
    calls++;
    assert.equal(request.instructions.split(CREATIVE_SELF_REVIEW).length, 2);
    return { status: 'completed', output: { value: 'kept' } };
  } }, scheduler);
  const request = withCreativeSelfReview({ operation: 'design-rough-cut-background-score', instructions: '写作', input: {}, outputSchema: {}, schemaName: 'fixture' });
  assert.equal((await provider.generate(request)).output.value, 'kept');
  assert.equal(calls, 1);
  assert.equal(scheduler.status().lanes.text.active, 0);
});

test('AI controls video timing, cut and states without literal environment actor checks', () => {
  const local = structuredClone(input);
  local.segment.groundedEvidence = [];
  local.boardPlan.panels.forEach(panel => { panel.actionOwner = '正午日光/热浪'; });
  const sections = { ...plan.videoPromptSections, timelineBeats: [
    { panelKeys: ['P01', 'P02'], startSec: 0, endSec: 3, shotGroupKey: 'wide', transitionFromPrevious: 'initial', cutTrigger: 'initial', startState: '田野全景', endState: '视线转向水瓶', actionUnitKeys: [], execution: '田野上方空气轻微扭曲。' },
    { panelKeys: ['P03', 'P04', 'P05', 'P06'], startSec: 3, endSec: 15, shotGroupKey: 'bottle', transitionFromPrevious: 'cut', cutTrigger: 'shot-size-change', startState: '水瓶特写', endState: '瓶身静止', actionUnitKeys: [], execution: '切至陶瓶特写，瓶口高光缓慢移动。' },
  ] };
  delete sections.shotExecution;
  const draft = { videoPromptSections: sections };
  const request = buildSegmentVideoPromptRequest(local);
  validateStructuredOutput(draft, request.outputSchema);
  const normalized = normalizeSegmentVideoPromptBookkeeping(draft, local);
  assert.deepEqual(normalized.videoPromptSections, sections);
  assert.deepEqual(validateSegmentVideoPromptPlan(normalized, local), []);
  assert.deepEqual(draft.videoPromptSections, sections);
  const invalid = structuredClone(normalized);
  invalid.videoPromptSections.timelineBeats[1].startSec = 2;
  assert.throws(() => validateSegmentVideoPromptPlan(invalid, local), /time range mismatch/);
  invalid.videoPromptSections = { ...sections, basicSetting: '<Picture 99>中的瓶子' };
  assert.throws(() => validateSegmentVideoPromptPlan(invalid, local), /unavailable|invent picture/);
});

test('storyboard normalization preserves AI timing, static visual wording and state', () => {
  const board = structuredClone(input.boardPlan);
  const times = [0, 1, 3, 6, 10, 13, 15];
  board.panels.forEach((panel, index) => {
    panel.startSec = times[index]; panel.endSec = times[index + 1];
    panel.startState = `新构图${index}`; panel.actionOwner = '正午日光/热浪'; panel.visual = '瓶身静止，地面泛白。';
  });
  const normalized = normalizeStoryboardBoardPlan(board, { segment: input.segment, panelCount: 6, styleName: input.styleName, characterAnchor: '', sceneAnchor: '' });
  assert.deepEqual(normalized.panels.map(p => [p.startSec, p.endSec, p.startState, p.visual]), board.panels.map(p => [p.startSec, p.endSec, p.startState, p.visual]));
});

test('user revision context reaches the model and wrong-segment output cannot be reassigned', () => {
  const request = buildSegmentVideoPromptRequest({ ...input, revisionRequest: '只调整最后一拍的机位', currentDraft: { prompt: '已编辑正文', plan } });
  assert.equal(request.input.revisionRequest, '只调整最后一拍的机位');
  assert.equal(request.input.currentDraft.prompt, '已编辑正文');
  const result = normalizeAndValidateVideoPromptBatchItems({ items: [{ segmentKey: 'SEG999', plan }] }, [input]);
  assert.equal(result.items.length, 0);
  assert.equal(result.revisions.length, 0);
  assert.equal(result.errors.length, 1);
});

test('an unreadable revision retains the usable prompt and reports the failed attempt', () => {
  const old = { segmentKey: 'SEG001', status: 'complete', prompt: '用户确认的正文', approval: 'approved', plan: { version: 'old' } };
  const [next] = mergeByStableKey([old], [{ segmentKey: 'SEG001', status: 'needs_revision', prompt: '', plan: {}, error: '正文结构缺失' }]);
  assert.equal(next.prompt, old.prompt);
  assert.deepEqual(next.plan, old.plan);
  assert.equal(next.approval, 'approved');
  assert.equal(next.error, '正文结构缺失');
});
