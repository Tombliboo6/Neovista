import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPromptWritingStandard, optimizeFreeCanvasPrompt } from '../src/free-canvas/prompt-optimization.ts';

test('free canvas prompt optimization makes one bounded type-aware text request', async () => {
  const requests = [];
  const provider = {
    id: 'fixture-agent',
    async health() { throw new Error('not used'); },
    async generate(request) {
      requests.push(request);
      return { output: { basicSetting: '雨夜天台。', atmosphereQualityPhotography: '冷色电影感。', contentLayout: '人物位于画面左侧。', cameraImaging: '中景。', negativeTerms: '文字水印。' }, providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };
  const result = await optimizeFreeCanvasPrompt(provider, {
    kind: 'image',
    prompt: '',
    references: [{ kind: 'text', title: '人物意图', content: '雨夜天台上的人' }],
  });
  assert.match(result, /基础设定/u);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].operation, 'optimize-free-canvas-prompt');
  assert.match(requests[0].instructions, /静态图片/u);
  assert.match(requests[0].instructions, /本地程序固定编排/u);
  assert.match(requests[0].instructions, /minimum complete control/u);
  assert.deepEqual(requests[0].outputSchema.required, ['basicSetting', 'atmosphereQualityPhotography', 'contentLayout', 'cameraImaging', 'negativeTerms']);
  assert.equal(requests[0].input.prompt, '');
  assert.deepEqual(requests[0].input.references, [{ kind: 'text', title: '人物意图', content: '雨夜天台上的人' }]);
  assert.deepEqual(requests[0].input.referenceMentions, []);
  assert.equal(requests[0].input.intentMode, 'create');
  assert.equal(requests[0].input.promptStandardSource, 'docs/AI_GENERATION_PROMPT_STANDARD.md');
  assert.match(loadPromptWritingStandard(), /### Jimeng video prompt rules/u);
});

test('text node follows the selected script, image, or video optimization target', async () => {
  const requests = [];
  const provider = {
    id: 'fixture-agent',
    async health() {},
    async generate(request) {
      requests.push(request);
      const output = request.input.outputTarget === 'image'
        ? { basicSetting: '御坂美琴吃饭。', atmosphereQualityPhotography: '自然日常感。', contentLayout: '人物为视觉中心。', cameraImaging: '中景。', negativeTerms: '身份漂移。' }
        : request.input.outputTarget === 'video'
          ? { basicSetting: '御坂美琴吃饭。', soundPolicy: '无背景音乐、无对白、无旁白。', atmosphereQualityPhotography: '自然日常感。', visualExecution: '0—5秒：她拿起餐具并吃下一口饭。', negativeTerms: '动作跳变。' }
          : { optimizedPrompt: '场景一：御坂美琴坐在餐桌前，拿起餐具并吃下一口饭。' };
      return { output, providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };
  assert.match(await optimizeFreeCanvasPrompt(provider, { kind: 'text', prompt: '御坂美琴吃饭' }), /^场景一/u);
  assert.match(await optimizeFreeCanvasPrompt(provider, { kind: 'text', textTarget: 'image', prompt: '御坂美琴吃饭' }), /^基础设定/u);
  assert.match(await optimizeFreeCanvasPrompt(provider, { kind: 'text', textTarget: 'video', prompt: '5秒，御坂美琴吃饭' }), /^基础设定[\s\S]*声音总则/u);
  assert.deepEqual(requests.map((request) => request.input.outputTarget), ['script', 'image', 'video']);
  assert.match(requests[0].instructions, /不强行加入剧情/u);
  assert.match(requests[2].instructions, /连续覆盖到该总时长/u);
  assert.match(requests[2].instructions, /封闭声音白名单/u);
  assert.match(requests[2].instructions, /正向字段不使用引号或可朗读的宣传语/u);
});

test('silent free canvas video prompts reject quoted advertising copy before H3 submission', async () => {
  const provider = {
    id: 'fixture-agent', async health() {}, async generate() {
      return {
        output: {
          basicSetting: '现代中式餐饮商业短片。',
          soundPolicy: '全片零人声，无背景音乐、无对白、无旁白；音轨仅包含火锅沸腾声与碗碟轻碰声。',
          atmosphereQualityPhotography: '暖色商业摄影质感。',
          visualExecution: '0—5秒：四人安静用餐，结尾形成“热气腾腾、丰盛共享”的广告画面。',
          negativeTerms: '人声，文字水印，手部异常，锅体变形，过曝。',
        },
        providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };
  await assert.rejects(
    () => optimizeFreeCanvasPrompt(provider, { kind: 'video', prompt: '5秒，四个人安静吃火锅。无背景音乐、无对白、无旁白。' }),
    /不能包含引号内容/u,
  );
});

test('image and video outputs are compiled locally into the exact ordered Chinese five-section format', async () => {
  const provider = {
    id: 'fixture-agent',
    async health() {},
    async generate(request) {
      const output = request.input.kind === 'image'
        ? { basicSetting: '御坂美琴吃饭。', atmosphereQualityPhotography: '自然日常感。', contentLayout: '人物为视觉中心。', cameraImaging: '中景。', negativeTerms: '身份漂移。' }
        : { basicSetting: '御坂美琴吃饭。', soundPolicy: '无背景音乐、无对白、无旁白。', atmosphereQualityPhotography: '自然日常感。', visualExecution: '0—5秒：她拿起餐具并吃下一口饭。', negativeTerms: '动作跳变。' };
      return { output, providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    },
  };
  const image = await optimizeFreeCanvasPrompt(provider, { kind: 'image', prompt: '御坂美琴吃饭' });
  const video = await optimizeFreeCanvasPrompt(provider, { kind: 'video', prompt: '御坂美琴吃饭' });
  assert.match(image, /^基础设定[\s\S]*氛围、画质与摄影风格[\s\S]*画面内容与布局[\s\S]*摄影机与成像[\s\S]*负面词[\s\S]*身份漂移。$/u);
  assert.match(video, /^基础设定[\s\S]*声音总则[\s\S]*氛围、画质与摄影风格[\s\S]*画面内容与镜头执行[\s\S]*负面词[\s\S]*动作跳变。$/u);
});

test('reference-edit optimization preserves explicit media mentions and keeps the requested change scoped', async () => {
  const requests = [];
  const provider = {
    id: 'fixture-agent',
    async health() {},
    async generate(request) {
      requests.push(request);
      return {
        output: {
          basicSetting: '在参考视频基础上，仅将人物正在食用的食物替换为汉堡，其余既有内容保持一致。',
          soundPolicy: '沿用参考视频的声音状态，不新增对白、旁白或背景音乐。',
          atmosphereQualityPhotography: '保持参考视频的画风、光线、色彩与画质。',
          visualExecution: '保持原有构图、机位、镜头运动、动作节奏和时序，人物以匹配原动作的方式自然拿起并食用汉堡。',
          negativeTerms: '人物身份漂移，场景漂移，镜头时序改变，汉堡形变，手部异常，文字水印。',
        },
        providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };
  const result = await optimizeFreeCanvasPrompt(provider, {
    kind: 'video',
    prompt: '@视频1把视频里的食物换成汉堡',
    references: [{ kind: 'video', title: '上一段视频', content: '人物在餐桌前进食。' }],
  });
  assert.match(result, /^视频参考：@视频1\n\n基础设定/u);
  assert.equal(result.match(/@视频1/gu)?.length, 1);
  assert.match(result, /仅将人物正在食用的食物替换为汉堡/u);
  assert.deepEqual(requests[0].input.referenceMentions, ['@视频1']);
  assert.equal(requests[0].input.intentMode, 'reference_edit');
  assert.match(requests[0].instructions, /局部编辑任务/u);
  assert.match(requests[0].instructions, /不要提供地点、动作或风格备选项/u);
});

test('image reference editing keeps @ image binding in the optimized five-section prompt', async () => {
  const requests = [];
  const provider = {
    id: 'fixture-agent', async health() {}, async generate(request) {
      requests.push(request);
      return {
        output: {
          basicSetting: '保持参考图片中的人物身份和场景，只将食物替换为汉堡。',
          atmosphereQualityPhotography: '保持参考图片的画风、光线和色彩。',
          contentLayout: '保持原有构图与主体位置，汉堡出现在原食物位置。',
          cameraImaging: '保持原有景别、机位、角度和焦点。',
          negativeTerms: '人物漂移，场景重绘，构图改变，汉堡形变，手部异常，文字水印。',
        },
        providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1,
      };
    },
  };
  const result = await optimizeFreeCanvasPrompt(provider, {
    kind: 'image', prompt: '@图片1把食物换成汉堡', references: [{ kind: 'image', title: '上一张图片', content: '' }],
  });
  assert.match(result, /^图片参考：@图片1\n\n基础设定/u);
  assert.equal(result.match(/@图片1/gu)?.length, 1);
  assert.equal(requests[0].input.intentMode, 'reference_edit');
  assert.deepEqual(requests[0].input.referenceMentions, ['@图片1']);
});

test('reference-edit optimization rejects an unavailable mention before provider access', async () => {
  let calls = 0;
  const provider = { id: 'fixture-agent', async health() {}, async generate() { calls += 1; } };
  await assert.rejects(() => optimizeFreeCanvasPrompt(provider, {
    kind: 'video', prompt: '@视频2把食物换成汉堡', references: [{ kind: 'video', title: '上一段视频', content: '' }],
  }), /当前只有1项视频参考/u);
  assert.equal(calls, 0);
});

test('missing structured production section keeps the original node content', async () => {
  const provider = {
    id: 'fixture-agent', async health() {},
    async generate() { return { output: { basicSetting: '御坂美琴吃饭。' }, providerId: 'fixture-agent', model: 'fixture', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 }; },
  };
  await assert.rejects(() => optimizeFreeCanvasPrompt(provider, { kind: 'image', prompt: '御坂美琴吃饭' }), /缺少必要分段/u);
});

test('free canvas prompt optimization rejects empty and oversized drafts before provider access', async () => {
  let calls = 0;
  const provider = { id: 'fixture-agent', async health() {}, async generate() { calls += 1; } };
  await assert.rejects(() => optimizeFreeCanvasPrompt(provider, { kind: 'video', prompt: '  ' }), /1—10000字/u);
  await assert.rejects(() => optimizeFreeCanvasPrompt(provider, { kind: 'audio', prompt: '字'.repeat(10_001) }), /1—10000字/u);
  assert.equal(calls, 0);
});

test('explicit reference purposes reach prompt optimization as readable input metadata', async () => {
  let captured;
  const provider = { id:'fixture-agent', async generate(request) {
    captured=request;
    return {output:{basicSetting:'人物站立。',atmosphereQualityPhotography:'自然光。',contentLayout:'人物居中。',cameraImaging:'全景。',negativeTerms:'文字水印。'}};
  }};
  await optimizeFreeCanvasPrompt(provider,{kind:'image',prompt:'制作首帧',references:[{kind:'image',title:'人物资产',content:'身份参考',purpose:'character'}]});
  assert.equal(captured.input.references[0].purpose,'character');
  assert.equal(captured.input.references[0].purposeLabel,'角色参考');
});
