import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendCreativeTones } from '../src/ideas/tone-recommendation.ts';

const input = {
  sourceText: '一个落魄厨师得到一本会说话的古菜谱，在家族宴席上重新找回尊严。',
  creationSource: 'idea',
  workType: 'single',
  creativeDirection: 'story',
  durationSec: 60,
  ratio: '16:9',
  language: '中文',
};

test('tone recommendation asks the Agent for four ranked content-specific directions', async () => {
  let captured;
  const recommendations = [
    { name: '克制翻涌', note: '前段压住委屈，关键反击时释放情绪力量', tone: 'red' },
    { name: '温暖释怀', note: '让人物关系逐渐松动并落到真诚和解', tone: 'gold' },
    { name: '冷峻宿命', note: '以疏离表演和冷色秩序强化命运压力', tone: 'cyan' },
    { name: '荒诞压迫', note: '用失衡节奏放大家族宴席中的窒息感', tone: 'violet' },
  ];
  const provider = { id: 'fake', health: async () => ({}), generate: async (request) => {
    captured = request;
    return { output: { recommendations }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
  } };

  assert.deepEqual(await recommendCreativeTones(provider, input), recommendations);
  assert.equal(captured.operation, 'recommend-creative-tones');
  assert.equal(captured.outputSchema.properties.recommendations.minItems, 4);
  assert.equal(captured.outputSchema.properties.recommendations.maxItems, 4);
  assert.match(captured.instructions, /不要从固定词表挑选/u);
  assert.match(captured.instructions, /第一项是你的首选/u);
  assert.deepEqual(captured.input, input);
});

test('tone recommendation rejects duplicate or incomplete Agent choices', async () => {
  const provider = { id: 'fake', health: async () => ({}), generate: async () => ({
    output: { recommendations: [
      { name: '温暖释怀', note: '让人物关系逐渐松动并落到真诚和解', tone: 'gold' },
      { name: '温暖释怀', note: '重复方向不能作为第二个候选', tone: 'cyan' },
      { name: '冷峻宿命', note: '以疏离表演和冷色秩序强化命运压力', tone: 'blue' },
      { name: '荒诞压迫', note: '用失衡节奏放大家族宴席中的窒息感', tone: 'violet' },
    ] }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
  }) };
  await assert.rejects(() => recommendCreativeTones(provider, input), /推荐结果不完整/u);
});

test('compound Chinese titles retain their full wording beyond eight characters', async () => {
  const names=['玄幻逆袭·高燃打斗','古墓秘境·悬疑肃杀','强者从容·爽感叙事','仙侠法阵·灵光视效'];
  const recommendations=names.map(name=>({name,note:'以完整的表演和视觉方向组织节奏',tone:'red'}));
  const provider={generate:async request=>{assert.equal(request.outputSchema.properties.recommendations.items.properties.name.maxLength,20);assert.match(request.instructions,/完整词语/);return {output:{recommendations}};}};
  assert.deepEqual((await recommendCreativeTones(provider,input)).map(x=>x.name),names);
  recommendations[0].name='完整标题'.repeat(6);
  await assert.rejects(()=>recommendCreativeTones(provider,input),/推荐结果不完整/);
});
