import test from 'node:test';
import assert from 'node:assert/strict';

import { runPromptDirector } from '../src/prompt-master/prompt-director.ts';

function providerWith(output) {
  const calls = [];
  return {
    id: 'prompt-director-fixture',
    calls,
    health: async () => ({ status: 'ok', message: 'ok', checkedAt: new Date().toISOString() }),
    generate: async (request) => {
      calls.push(request);
      return { output, providerId: 'fixture', model: 'fixture-model', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };
}

test('prompt director creates the complete Chinese video five-section format once', async () => {
  const prompt = ['基础设定', '16:9雨夜码头。', '声音总则', '零人声，保留雨声。', '氛围、画质与摄影风格', '冷色电影光。', '画面内容与镜头执行', '0—5秒：男人奔跑后滑倒，最后撑起上身。', '负面词', '身份漂移、动作倒序、镜头越轴'].join('\n\n');
  const provider = providerWith({ prompt, replyZh: '已整理成完整五段式并锁定动作因果。' });
  const result = await runPromptDirector(provider, { mediaType: 'video', format: 'five-section-zh', idea: '雨夜码头追船', durationSec: 5, aspectRatio: '16:9' });
  assert.equal(result.prompt, prompt);
  assert.equal(provider.calls.length, 1);
  assert.match(provider.calls[0].instructions, /项目统一提示词规范/u);
});

test('prompt director creates the Chinese static-image five-section format without a sound section', async () => {
  const prompt = ['基础设定', '16:9雨夜码头。', '氛围、画质与摄影风格', '冷色电影光。', '画面内容与布局', '男人位于画面左侧，远处小船正在离岸。', '摄影机与成像', '35mm中景，低机位。', '负面词', '身份漂移、肢体错误、文字水印'].join('\n\n');
  const provider = providerWith({ prompt, replyZh: '已整理为静态图片五段式。' });
  const result = await runPromptDirector(provider, { mediaType: 'image', format: 'five-section-zh', idea: '雨夜码头上的男人与远处小船', aspectRatio: '16:9' });
  assert.equal(result.prompt, prompt);
  assert.match(provider.calls[0].instructions, /静态图片/u);
  assert.doesNotMatch(result.prompt, /声音总则/u);
});

test('prompt director creates a structured text-task prompt', async () => {
  const prompt = ['角色定位', '你是专业短剧编剧。', '任务目标', '创作一份都市悬疑短剧。', '已知信息', '仅使用用户提供的人物与剧情事实。', '执行要求', '按场次写动作、对白和事件结果。', '输出格式', '简体中文短剧本。'].join('\n\n');
  const provider = providerWith({ prompt, replyZh: '已整理为可直接使用的文字任务提示词。' });
  const result = await runPromptDirector(provider, { mediaType: 'text', textTarget: 'script', format: 'five-section-zh', idea: '写一个都市悬疑短剧' });
  assert.equal(result.prompt, prompt);
  assert.match(provider.calls[0].instructions, /短剧本/u);
});

test('text prompt targets distinguish synopsis, short script and storyboard', async () => {
  const prompt = ['角色定位', '你是影视创作者。', '任务目标', '完成指定文字创作。', '已知信息', '使用用户提供的剧情。', '执行要求', '保持剧情因果。', '输出格式', '简体中文。'].join('\n\n');
  for (const [textTarget, expected] of [['synopsis', /故事梗概/u], ['script', /短剧本/u], ['storyboard', /分镜脚本/u]]) {
    const provider = providerWith({ prompt, replyZh: '已整理影视文字创作提示词。' });
    await runPromptDirector(provider, { mediaType: 'text', textTarget, format: 'five-section-zh', idea: '都市悬疑故事' });
    assert.match(provider.calls[0].instructions, expected);
    assert.equal(provider.calls[0].input.textTarget, textTarget);
  }
});

test('prompt director creates a structured music prompt', async () => {
  const prompt = ['基础设定', '60秒家庭短片纯音乐。', '风格与情绪', '温暖、克制并逐渐明亮。', '乐器与声音设计', '木吉他与轻柔钢琴。', '结构与时间线', '0至15秒简洁引子，15至45秒逐步发展，45至60秒自然收束。', '负面词', '突兀转调、刺耳高频、过度压缩、结构断裂、意外人声'].join('\n\n');
  const provider = providerWith({ prompt, replyZh: '已整理为完整音乐生成提示词。' });
  const result = await runPromptDirector(provider, { mediaType: 'music', format: 'five-section-zh', idea: '家庭短片温暖配乐', durationSec: 60 });
  assert.equal(result.prompt, prompt);
  assert.match(provider.calls[0].instructions, /音乐生成模型/u);
});

test('prompt director creates English H3 output with a separate negative prompt', async () => {
  const prompt = 'Prompt: A rain-soaked dock at night. From 0 to 5 seconds, a man runs toward a departing boat, slips on a wet rope, and ends propped on both hands while looking toward the water. Low tracking camera, cold rim light, rain and footstep sync sound, no music, no dialogue, no narration.\n\nNegative prompt: identity drift, reversed causality, voluntary fall, axis crossing, unreadable anatomy';
  const provider = providerWith({ prompt, replyZh: '已生成H3标准英文格式。' });
  const result = await runPromptDirector(provider, { mediaType: 'video', format: 'h3-en', idea: '雨夜码头追船', durationSec: 5 });
  assert.equal(result.prompt, prompt);
  assert.match(provider.calls[0].instructions, /PRISM H3/u);
  assert.doesNotMatch(result.prompt, /\p{Script=Han}/u);
});

test('H3 English format is reserved for video prompts', async () => {
  const provider = providerWith({ prompt: 'unused', replyZh: 'unused' });
  await assert.rejects(() => runPromptDirector(provider, { mediaType: 'image', format: 'h3-en', idea: '雨夜码头' }), /H3标准英文格式仅用于视频提示词/u);
  await assert.rejects(() => runPromptDirector(provider, { mediaType: 'music', format: 'h3-en', idea: '温暖配乐' }), /H3标准英文格式仅用于视频提示词/u);
  assert.equal(provider.calls.length, 0);
});

test('prompt director revision preserves the current prompt and sends the user instruction once', async () => {
  const currentPrompt = 'Prompt: A man walks through rain.\n\nNegative prompt: identity drift';
  const nextPrompt = 'Prompt: A man runs quickly through rain and keeps the same direction.\n\nNegative prompt: identity drift, axis crossing';
  const provider = providerWith({ prompt: nextPrompt, replyZh: '已加快动作并保持方向。' });
  await runPromptDirector(provider, { format: 'h3-en', currentPrompt, instruction: '动作更快，不要改变方向。' });
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].input.currentPrompt, currentPrompt);
  assert.equal(provider.calls[0].input.instruction, '动作更快，不要改变方向。');
  assert.match(provider.calls[0].instructions, /只改变用户明确提出的内容/u);
});
