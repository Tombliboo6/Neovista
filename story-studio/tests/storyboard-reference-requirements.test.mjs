import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStoryboardReferenceRequirementRequest, validateStoryboardReferenceRequirements } from '../src/storyboards/storyboard-reference-requirements.ts';

const input = {
  segmentKey: 'SEG003', storyboardText: '张浩然咳出污血。',
  semanticDecision: { visibleCharacters: ['张浩然'], characterStates: [], visibleProps: [{ propName: '污血', state: '雨中稀释' }], sceneState: '雨夜', excludedElements: [], decisionBasis: ['剧本'] },
  approvedOptions: { characters: ['张浩然', '林无双'], sceneAssetKey: 'L01', props: [{ propName: '人皇印', state: 'activated' }] }
};

test('reference requirement task separates transient visible material from uploaded assets', () => {
  const request = buildStoryboardReferenceRequirementRequest([input]);
  assert.match(request.instructions, /血液.*不要求独立参考图/);
  assert.equal(request.maxOutputTokens, 60000);
  assert.doesNotThrow(() => validateStoryboardReferenceRequirements({ items: [{ segmentKey: 'SEG003', requirements: { characters: ['张浩然'], sceneRequired: true, props: [], decisionBasis: ['污血无需资产'] } }] }, [input]));
});

test('reference requirement validation rejects unapproved reference props', () => {
  assert.throws(() => validateStoryboardReferenceRequirements({ items: [{ segmentKey: 'SEG003', requirements: { characters: ['张浩然'], sceneRequired: true, props: [{ propName: '污血', state: '雨中稀释' }], decisionBasis: ['错误'] } }] }, [input]), /not approved/);
});
