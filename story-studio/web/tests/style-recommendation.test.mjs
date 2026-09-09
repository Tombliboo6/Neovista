import test from 'node:test';
import assert from 'node:assert/strict';
import { rankStylePresets } from '../src/style-recommendation.ts';

test('recommended styles use an explicit production priority', () => {
  const presets = [
    { id: 'watercolor', recommendationPriority: 90 },
    { id: 'live-action', recommendationPriority: 10 },
    { id: 'webtoon', recommendationPriority: 30 },
  ];
  assert.deepEqual(rankStylePresets(presets).map((preset) => preset.id), ['live-action', 'webtoon', 'watercolor']);
});

test('equal recommendation priorities preserve library order', () => {
  const presets = [
    { id: 'first', recommendationPriority: 20 },
    { id: 'second', recommendationPriority: 20 },
  ];
  assert.deepEqual(rankStylePresets(presets).map((preset) => preset.id), ['first', 'second']);
});
