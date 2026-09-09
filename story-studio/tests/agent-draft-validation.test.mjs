import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionAgentDraftValidationIssues } from '../src/validation/agent-draft-validation.ts';

test('only data contracts block video drafts', () => {
  const hard = ['segment key mismatch', 'shot execution must preserve dialogue D01', 'timeline beat 2 time range mismatch', 'video prompt references unavailable <Picture 9>'];
  const report = partitionAgentDraftValidationIssues('video-prompt', [...hard, 'timeline beat 3 must name action owner 正午日光/热浪', 'negative terms must contain 5 to 8 items']);
  assert.deepEqual(report.blockingIssues, hard);
  assert.deepEqual(report.warnings, []);
});

test('editorial language, timing density and actor labels belong to AI self-review', () => {
  for (const stage of ['storyboard-board', 'video-prompt', 'music-prompt', 'character-asset-prompt', 'scene-asset-prompt', 'prop-asset-prompt']) {
    const report = partitionAgentDraftValidationIssues(stage, ['timeline beat 2 must name action owner 热浪', 'negativeTerms must contain 5 to 8 items', 'minimaxPrompt must use positive instrumental-only language without vocal concepts', 'P02 start state must exactly match previous end state']);
    assert.deepEqual(report.issues, []);
  }
});

test('data provenance advice and instrumental execution mode remain visible', () => {
  const report = partitionAgentDraftValidationIssues('music-prompt', ['instrumental must be true', 'SEG002 time boundary changed']);
  assert.deepEqual(report.blockingIssues, ['instrumental must be true']);
  assert.deepEqual(report.warnings, ['SEG002 time boundary changed']);
  assert.match(report.issues[1].code, /timeline/);
});
