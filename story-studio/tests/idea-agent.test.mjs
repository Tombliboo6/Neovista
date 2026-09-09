import assert from 'node:assert/strict';
import test from 'node:test';

import { runIdeaAgentTurn } from '../src/ideas/idea-agent.ts';

test('idea agent uses a screenwriter-director role and may ask one dynamic question', async () => {
  let captured;
  const provider = {
    id: 'fake-agent',
    health: async () => ({ status: 'ok', message: 'ok', checkedAt: new Date().toISOString() }),
    generate: async (request) => {
      captured = request;
      return { output: { status: 'question', question: '你更想把故事发展成哪种体验？', options: [
        { id: 'mystery', label: '悬疑推理', description: '围绕有限预知逐步发现真相。' },
        { id: 'emotion', label: '情感抉择', description: '让预知成为人物关系的考验。' },
        { id: 'survival', label: '生存行动', description: '突出倒计时和即时决策。' }
      ], script: null }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    }
  };
  const turn = await runIdeaAgentTurn(provider, { idea: '末日列车上，一个女孩只能预知十分钟未来。', answers: [] });
  assert.equal(turn.status, 'question');
  assert.match(captured.instructions, /编剧导演/);
  assert.match(captured.instructions, /少量差异明确的推荐方向/);
  assert.match(captured.instructions, /先发散、后收敛/);
  assert.match(captured.instructions, /不得追问能力次数/);
  assert.deepEqual(captured.outputSchema.properties.status.enum, ['question', 'script']);
  assert.equal(captured.outputSchema.properties.options.maxItems, 4);
  assert.equal(captured.input.forceScript, false);
  assert.equal(captured.maxOutputTokens, 16_000);
});

test('third answered round forces the agent to return a structured script', async () => {
  let captured;
  const script = {
    title: '十分钟之后', logline: '女孩在末日列车上对抗伪装者。', genre: '末日悬疑', durationSec: 60, ratio: '9:16', language: '中文', emotion: '紧张',
    characters: [{ name: '林夏', role: '主角', goal: '救下乘客' }],
    scenes: [{ id: 'SC001', location: '列车车厢', time: '夜', summary: '异变发生。', beats: ['灯光熄灭'], dialogue: [{ speaker: '林夏', line: '别开门。' }] }],
    endingHook: '车窗倒影里出现第二个林夏。'
  };
  const provider = {
    id: 'fake-agent',
    health: async () => ({ status: 'ok', message: 'ok', checkedAt: new Date().toISOString() }),
    generate: async (request) => {
      captured = request;
      return { output: { status: 'script', question: '', options: [], script }, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    }
  };
  const answers = [1, 2, 3].map((number) => ({ question: `问题${number}`, answer: `回答${number}` }));
  const turn = await runIdeaAgentTurn(provider, { idea: '末日列车上，一个女孩只能预知十分钟未来。', answers });
  assert.equal(captured.input.forceScript, true);
  assert.equal(captured.outputSchema.properties.status.enum[0], 'script');
  assert.equal(captured.outputSchema.properties.script.properties.scenes.items.properties.blocks.minItems, 1);
  assert.equal(captured.maxOutputTokens, 32_000);
  assert.equal(turn.script.title, '十分钟之后');
});

test('formal script normalization preserves candidate entities for director review', async () => {
  const script = {
    title: '早餐时刻', logline: '一家人在早餐中建立温暖联系。', genre: '家庭广告', durationSec: 60, ratio: '9:16', language: '中文', emotion: '温暖',
    characters: [
      { name: '妈妈', role: '家庭成员', goal: '准备早餐' },
      { name: '环境', role: '空间氛围', goal: '衬托生活感' },
      { name: '厨房场景', role: '地点', goal: '承载情节' },
    ],
    scenes: [{ id: 'SC001', location: '厨房', time: '清晨', summary: '妈妈准备早餐。', beats: ['妈妈拿起酸奶'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '妈妈拿起酸奶。' }] }],
    endingHook: '一家人相视而笑。'
  };
  const provider = { id: 'fake', health: async () => ({}), generate: async () => ({ output: { status: 'script', question: '', options: [], script }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }) };
  const answers = [1, 2, 3].map((number) => ({ question: `问题${number}`, answer: `回答${number}` }));

  const turn = await runIdeaAgentTurn(provider, {
    idea: '一家人在清晨厨房分享酸奶和早餐。',
    answers,
    production: { workType: 'single', creativeDirection: 'commercial', durationSec: 60, episodeCountMode: 'agent', episodeCount: null, ratio: '9:16', language: '中文', emotion: '温暖' }
  });

  assert.deepEqual(turn.script.characters.map((character) => character.name), ['妈妈', '环境', '厨房场景']);
});

test('locked production metadata is normalized without discarding an otherwise usable script', async () => {
  const script = {
    title: '早餐时刻', logline: '一家人在早餐中建立温暖联系。', genre: '家庭广告', durationSec: 15, ratio: '1:1', language: '英文', emotion: '紧张', workType: 'series', plannedEpisodeCount: 2,
    characters: [{ name: '妈妈', role: '家庭成员', goal: '准备早餐' }],
    scenes: [{ id: 'SC001', location: '厨房', time: '清晨', summary: '妈妈准备早餐。', beats: ['妈妈拿起酸奶'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '妈妈拿起酸奶。' }] }],
    endingHook: '一家人相视而笑。'
  };
  const provider = { id: 'fake', health: async () => ({}), generate: async () => ({ output: { status: 'script', question: '', options: [], script }, providerId: 'fake', model: 'gpt-5.6-terra', externalTaskId: 'req-script-locks', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }) };
  const answers = [1, 2, 3].map((number) => ({ question: `问题${number}`, answer: `回答${number}` }));

  const turn = await runIdeaAgentTurn(provider, {
    idea: '一家人在清晨厨房分享酸奶和早餐。',
    answers,
    production: { workType: 'single', creativeDirection: 'commercial', durationSec: 60, episodeCountMode: 'agent', episodeCount: null, ratio: '16:9', language: '中文', emotion: '温暖' }
  });

  assert.equal(turn.script.durationSec, 60);
  assert.equal(turn.script.ratio, '16:9');
  assert.equal(turn.script.language, '中文');
  assert.equal(turn.script.emotion, '温暖');
  assert.equal(turn.script.workType, 'single');
  assert.equal(turn.script.scenes[0].summary, '妈妈准备早餐。');
});

test('idea agent accepts existing context beyond three answered rounds', async () => {
  let called = false;
  const script = {
    title: '完整剧本', logline: '沿用已有问答直接完成。', genre: '测试', durationSec: 60, ratio: '9:16', language: '中文', emotion: '紧张',
    characters: [], scenes: [{ id: 'SC001', location: '室内', time: '夜', summary: '完成。', beats: ['行动'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '行动完成。' }] }], endingHook: '结束。'
  };
  const provider = { id: 'fake', health: async () => ({}), generate: async () => { called = true; return { output: { status: 'script', question: '', options: [], script }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }; } };
  const answers = [1, 2, 3, 4].map((number) => ({ question: `问题${number}`, answer: `回答${number}` }));
  const turn = await runIdeaAgentTurn(provider, { idea: '这是一个足够长的原创短剧创意。', answers });
  assert.equal(turn.status, 'script');
  assert.equal(called, true);
});

test('a useful formal script is accepted without forcing extra question rounds', async () => {
  const script = {
    title: '过早剧本', logline: '不应被接受。', genre: '测试', durationSec: 60, ratio: '9:16', language: '中文', emotion: '紧张',
    characters: [{ name: '主角', role: '主角', goal: '完成目标' }], scenes: [{ id: 'SC001', location: '室内', time: '夜', summary: '测试。', beats: ['行动'], dialogue: [] }], endingHook: '结束。'
  };
  const provider = { id: 'fake', health: async () => ({}), generate: async () => ({ output: { status: 'script', question: '', options: [], script }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }) };
  const turn = await runIdeaAgentTurn(provider, { idea: '这是一个足够长的原创短剧创意。', answers: [] });
  assert.equal(turn.status, 'script');
});

test('a repeated historical question remains visible instead of discarding the turn', async () => {
  let calls = 0;
  const repeatedQuestion = '商战交锋可以有不同的重心，你希望观众最揪心的冲突集中在哪一面？';
  const provider = {
    id: 'fake', health: async () => ({}), generate: async (request) => {
      calls += 1;
      assert.deepEqual(request.input.previousQuestions, [repeatedQuestion]);
      return { output: { status: 'question', question: ` ${repeatedQuestion} `, options: [
        { id: 'a', label: '外部对抗', description: '外部竞争。' },
        { id: 'b', label: '内部成长', description: '人物成长。' },
        { id: 'c', label: '秘密争夺', description: '秘密竞争。' },
      ], script: null }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    }
  };
  const turn = await runIdeaAgentTurn(provider, { idea: '落魄小厨师得到一本会说话的古菜谱，然后逆袭。', answers: [{ question: repeatedQuestion, answer: '外部对抗' }] });
  assert.equal(turn.status, 'question');
  assert.equal(calls, 1);
});

test('confirmed production format and emotion are passed into every agent turn', async () => {
  let captured;
  const provider = { id: 'fake', health: async () => ({}), generate: async (request) => {
    captured = request;
    return { output: { status: 'question', question: '第一集更希望从哪类事件切入？', options: [
      { id: 'a', label: '危机现场', description: '从正在发生的危机切入。' },
      { id: 'b', label: '人物日常', description: '从关系与日常切入。' },
      { id: 'c', label: '结果倒叙', description: '先展示结果再追溯原因。' },
    ], script: null }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
  } };
  const production = { workType: 'series', creativeDirection: 'story', durationSec: 90, episodeCountMode: 'fixed', episodeCount: 8, ratio: '9:16', language: '中文', emotion: '悬疑' };
  await runIdeaAgentTurn(provider, { idea: '落魄小厨师得到一本会说话的古菜谱，然后逆袭。', answers: [], production });
  assert.deepEqual(captured.input.production, production);
  assert.match(captured.instructions, /只写第1集/);
  assert.match(captured.instructions, /blocks/);
});

test('commercial direction accepts a 10-second brief without forcing a story question', async () => {
  let captured;
  const provider = { id: 'fake', health: async () => ({}), generate: async (request) => {
    captured = request;
    return { output: { status: 'question', question: '这支广告最需要观众记住哪一个卖点？', options: [
      { id: 'taste', label: '风味质感', description: '突出汤底色泽与香料层次。' },
      { id: 'speed', label: '使用便利', description: '突出快速完成一锅汤底。' },
      { id: 'quality', label: '原料品质', description: '突出可确认的原料与工艺。' },
    ], script: null }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
  } };
  await runIdeaAgentTurn(provider, { idea: '为火锅底料制作一支商业广告片。', answers: [], production: { workType: 'single', creativeDirection: 'commercial', durationSec: 10, episodeCountMode: 'agent', episodeCount: null, ratio: '16:9', language: '中文', emotion: '高端质感' } });
  assert.equal(captured.input.production.creativeDirection, 'commercial');
  assert.equal(captured.input.production.durationSec, 10);
  assert.match(captured.instructions, /不得默认要求剧情/u);
  assert.match(captured.instructions, /核心卖点/u);
});

test('series form preserves a non-story direction and all six direction branches are available', async () => {
  let captured;
  const provider = { id: 'fake', health: async () => ({}), generate: async (request) => {
    captured = request;
    return { output: { status: 'question', question: '这个知识系列首先服务哪类观众？', options: [
      { id: 'beginner', label: '零基础观众', description: '先建立基本概念。' },
      { id: 'practical', label: '实用需求观众', description: '围绕直接可用的方法。' },
      { id: 'advanced', label: '进阶观众', description: '提高信息密度与专业深度。' },
    ], script: null }, providerId: 'fake', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
  } };
  const production = { workType: 'series', creativeDirection: 'knowledge', durationSec: 60, episodeCountMode: 'fixed', episodeCount: 6, ratio: '16:9', language: '中文', emotion: '清晰理性' };
  await runIdeaAgentTurn(provider, { idea: '制作一个解释家用净水器工作原理的系列内容。', answers: [], production });
  assert.deepEqual(captured.input.production, production);
  assert.deepEqual(captured.outputSchema.properties.status.enum, ['question', 'script']);
  assert.match(captured.instructions, /knowledge/u);
  assert.match(captured.instructions, /documentary/u);
  assert.match(captured.instructions, /music_visual/u);
  assert.match(captured.instructions, /两个独立维度/u);
  assert.equal(captured.instructions.includes('series表示先建立与所选方向一致的完整系列规划'), true);
});
