import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../local-api.mjs', import.meta.url), 'utf8');

test('series canvas separates the full-series plan from independently generated episode scripts', () => {
  assert.match(appSource, /02A · 系列规划/);
  assert.match(appSource, /02B · 分集剧本/);
  assert.match(appSource, /nodeId="series-plan"/);
  assert.match(appSource, /nodeId="episode-scripts"/);
  assert.match(appSource, /生成本集/);
  assert.match(appSource, /生成新版本/);
  assert.match(appSource, /旧版本继续保留/);
  assert.match(appSource, /episodeScripts: EpisodeScriptRecord\[\]/);
});

test('one explicit episode action uses the dedicated text endpoint without advancing production stages', () => {
  assert.match(appSource, /fetch\("\/api\/script\/episode"/);
  assert.match(apiSource, /url\.pathname === '\/api\/script\/episode'/);
  const action = appSource.slice(appSource.indexOf('async function generateEpisodeFromSeriesPlan'), appSource.indexOf('function enterCharacterDesign'));
  assert.match(action, /setEpisodeScripts/);
  assert.doesNotMatch(action, /setCharacterStatus/);
  assert.doesNotMatch(action, /setSceneStatus/);
  assert.doesNotMatch(action, /setIdeaScript/);
});

test('novel series planning is actionable and exposes running and failure feedback', () => {
  assert.doesNotMatch(appSource, /disabled=\{busy \|\| !isSingle\}/);
  assert.match(appSource, /正在智能拆集/);
  assert.match(appSource, /正在读取素材并规划分集/);
  assert.match(appSource, /智能拆集没有完成/);
  assert.match(appSource, /无法连接PRISM本机服务/);
  assert.match(appSource, /系统没有自动重试/);
  assert.match(appSource, /scriptPlanningBusy=\{novelBusy \|\| ideaBusy\} emotionBusy=\{emotionRecommendationBusy\}/);
  assert.match(appSource, /label: seriesPlanning \? "智能拆集" : "剧本生成"/);
  assert.match(apiSource, /adaptNovelToSeriesPlan/);
});
