import assert from 'node:assert/strict';
import test from 'node:test';

import { downstreamStages, invalidateReadyDownstreamStages, isStageResolved, OPTIONAL_STAGE_IDS, STAGE_IDS } from '../src/workflow/stages.ts';

test('script changes invalidate all dependent creative and final stages', () => {
  const affected = downstreamStages('script');

  for (const expected of [
    'character-profiles',
    'style-selection',
    'character-images',
    'scenes',
    'scene-views',
    'props',
    'storyboard-prompts',
    'storyboard-images',
    'video-prompts',
    'shot-videos',
    'music',
    'composition'
  ]) {
    assert.ok(affected.includes(expected), `${expected} should be invalidated`);
  }

  assert.equal(affected.includes('intake'), false);
  assert.equal(affected.includes('episode-plan'), false);
});

test('character profiles precede user style selection and character images', () => {
  assert.deepEqual(downstreamStages('character-profiles'), [
    'style-selection',
    'character-images',
    'scenes',
    'scene-views',
    'props',
    'storyboard-prompts',
    'storyboard-images',
    'video-prompts',
    'shot-videos',
    'music',
    'composition'
  ]);
  assert.equal(downstreamStages('style-selection').includes('character-profiles'), false);
  assert.equal(downstreamStages('style-selection').includes('character-images'), true);
});

test('approved scene main assets precede reference-grounded scene views and props', () => {
  assert.deepEqual(downstreamStages('scenes'), [
    'scene-views',
    'props',
    'storyboard-prompts',
    'storyboard-images',
    'video-prompts',
    'shot-videos',
    'music',
    'composition'
  ]);
  assert.deepEqual(downstreamStages('scene-views'), [
    'props',
    'storyboard-prompts',
    'storyboard-images',
    'video-prompts',
    'shot-videos',
    'music',
    'composition'
  ]);
});

test('storyboard image changes only invalidate video and final output stages', () => {
  assert.deepEqual(downstreamStages('storyboard-images'), [
    'video-prompts',
    'shot-videos',
    'music',
    'composition'
  ]);
});

test('music changes only invalidate composition', () => {
  assert.deepEqual(downstreamStages('music'), ['composition']);
});

test('scene views, props and music can be explicitly skipped without making required stages optional', () => {
  assert.deepEqual(OPTIONAL_STAGE_IDS, ['scene-views', 'props', 'music']);
  assert.equal(isStageResolved('scene-views', 'skipped'), true);
  assert.equal(isStageResolved('props', 'skipped'), true);
  assert.equal(isStageResolved('music', 'skipped'), true);
  assert.equal(isStageResolved('scenes', 'skipped'), false);
  assert.equal(isStageResolved('character-images', 'skipped'), false);
});

test('an upstream change invalidates prior optional skip decisions', () => {
  const states = Object.fromEntries(STAGE_IDS.map((stage) => [stage, 'empty']));
  states['scene-views'] = 'skipped';
  states.props = 'skipped';
  const result = invalidateReadyDownstreamStages(states, 'scenes');
  assert.equal(result.states['scene-views'], 'stale');
  assert.equal(result.states.props, 'stale');
});
