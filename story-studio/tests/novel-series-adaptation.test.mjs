import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptNovelToSeriesPlan } from '../src/novels/adapt-novel.ts';

const production = {
  workType: 'series',
  creativeDirection: 'story',
  durationSec: 90,
  episodeCountMode: 'fixed',
  episodeCount: 3,
  ratio: '16:9',
  language: '中文',
  emotion: '悲壮'
};

function validSeriesScript() {
  return {
    title: '雨夜余烬',
    logline: '三名旧友在一场雨夜事故后追查真相。',
    genre: '剧情悬疑',
    durationSec: 90,
    ratio: '16:9',
    language: '中文',
    emotion: '悲壮',
    workType: 'series',
    plannedEpisodeCount: 3,
    episodeNumber: 1,
    seriesPlan: [
      { episodeNumber: 1, title: '来信', summary: '主角收到失踪友人的来信。', hook: '信纸背面出现当天日期。' },
      { episodeNumber: 2, title: '旧桥', summary: '众人回到事故发生的旧桥。', hook: '河中浮出遗失的相机。' },
      { episodeNumber: 3, title: '余烬', summary: '相机影像揭开事故真相。', hook: '主角烧掉最后一封信。' }
    ],
    characters: [{ name: '林舟', role: '主角', goal: '查明旧友失踪真相' }],
    scenes: [{
      id: 'SC001', location: '旧屋', time: '雨夜', summary: '林舟收到来信。', beats: ['雨声中拆开信封'], dialogue: [],
      blocks: [{ type: 'action', speaker: '', delivery: '', text: '林舟擦去信封上的雨水，展开信纸。' }]
    }],
    endingHook: '信纸背面写着当天日期。'
  };
}

test('novel series adaptation requests a complete plan and the first episode script', async () => {
  let captured;
  const provider = {
    id: 'fake-agent',
    health: async () => ({ status: 'ok', message: 'ok', checkedAt: new Date().toISOString() }),
    generate: async (request) => {
      captured = request;
      return { output: validSeriesScript(), providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    }
  };

  const result = await adaptNovelToSeriesPlan(provider, {
    novelText: '雨夜里，林舟收到失踪旧友寄来的信。他循着线索回到旧桥，发现多年前事故留下的相机。相机中的影像最终揭开了真相。',
    sourceName: '雨夜余烬.txt',
    production
  });

  assert.equal(result.workType, 'series');
  assert.equal(result.seriesPlan.length, 3);
  assert.equal(result.episodeNumber, 1);
  assert.equal(captured.operation, 'adapt-novel-to-series-plan');
  assert.match(captured.instructions, /完整系列规划/);
  assert.match(captured.instructions, /seriesPlan必须恰好包含3项/);
  assert.deepEqual(captured.outputSchema.properties.emotion.enum, ['悲壮']);
  assert.deepEqual(captured.outputSchema.properties.durationSec.enum, [90]);
  assert.deepEqual(captured.outputSchema.properties.plannedEpisodeCount.enum, [3]);
});

test('novel production mismatch identifies the exact field and preserves the returned draft', async () => {
  const invalid=validSeriesScript();invalid.emotion='平静';let calls=0;
  await assert.rejects(()=>adaptNovelToSeriesPlan({id:'fixture',generate:async()=>{calls++;return{output:invalid};}}, {novelText:'修钟师在清晨修复一只停止的座钟，第二天终于听见均匀的滴答声。',sourceName:'fixture',production}), error=>{
    assert.match(error.message,/情绪要求“悲壮”，返回“平静”/);
    assert.equal(JSON.parse(error.returnedDraft).scenes[0].id,'SC001');return true;
  });assert.equal(calls,1);
});

test('novel series adaptation rejects an incomplete plan without retrying', async () => {
  const invalid = validSeriesScript();
  invalid.plannedEpisodeCount = 2;
  invalid.seriesPlan = invalid.seriesPlan.slice(0, 2);
  let calls = 0;
  const provider = {
    id: 'fake-agent',
    health: async () => ({}),
    generate: async () => {
      calls += 1;
      return { output: invalid, providerId: 'fake-agent', model: 'fake', status: 'completed', completedAt: new Date().toISOString(), elapsedMs: 1 };
    }
  };

  await assert.rejects(() => adaptNovelToSeriesPlan(provider, {
    novelText: '雨夜里，林舟收到失踪旧友寄来的信。他循着线索回到旧桥，发现多年前事故留下的相机。相机中的影像最终揭开了真相。',
    sourceName: '雨夜余烬.txt',
    production
  }), /没有遵循已确认的系列集数/);
  assert.equal(calls, 1);
});
