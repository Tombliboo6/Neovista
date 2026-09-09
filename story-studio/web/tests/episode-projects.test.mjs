import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCreativeSessionStore } from '../local-api.mjs';
import { createProviderSettingsStore } from '../local-api.mjs';
const script = number => ({ title: `测试第${number}集`, workType: 'series', plannedEpisodeCount: 2, episodeNumber: number, durationSec: 30, ratio: '16:9', language: '中文', emotion: '温暖', genre: '剧情', logline: '修理座钟', characters: [], scenes: [{ id: 'SC001', location: '工作室', time: '上午', summary: '修钟', beats: ['工作'], dialogue: [], blocks: [{ type: 'action', speaker: '', delivery: '', text: '座钟滴答作响。' }] }], endingHook: '座钟复原', seriesPlan: [1,2].map(episodeNumber=>({episodeNumber,title:`第${episodeNumber}集`,summary:'修钟',hook:'滴答'})) });
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'prism-episode-project-')); const filePath=join(root,'active.json');
  const store=createCreativeSessionStore({filePath});
  const first=store.save({state:{step:'workspace',projectName:'测试系列',workType:'series',ideaScript:script(1),scriptApproval:'approved',episodeScripts:[1,2].map(n=>({scriptKey:`EP00${n}`,episodeNumber:n,version:1,status:'complete',approval:'draft',script:script(n)})),videoPrompts:[{segmentKey:'SEG001',status:'complete',prompt:'第一集正文'}],shotVideoTasks:[{segmentKey:'SEG001',status:'awaiting_review',outputPaths:['first.mp4']}],freeCanvas:{nodes:[],edges:[]}}});
  return {root,filePath,store,first};
}
test('episode production creates independent state and returns to the exact first episode',()=>{
  const {store,first,filePath}=fixture();
  const second=store.openEpisode({projectId:first.id,expectedRevision:first.revision,episodeNumber:2});
  assert.notEqual(second.id,first.id);assert.equal(second.state.ideaScript.episodeNumber,2);
  assert.deepEqual(second.state.shotVideoTasks,[]);assert.deepEqual(second.state.videoPrompts,[]);assert.equal(second.state.scriptApproval,'draft');
  assert.equal(second.series.rootProjectId,first.id);
  assert.deepEqual(second.state.seriesMotherScript,first.state.ideaScript);
  assert.notEqual(second.state.seriesMotherScript.title,second.state.ideaScript.title);
  const updated=store.save({state:{...second.state,videoPrompts:[{segmentKey:'SEG001',status:'complete',prompt:'第二集正文'}]},expectedRevision:second.revision});
  const reloaded=createCreativeSessionStore({filePath});assert.equal(reloaded.load().series.rootProjectId,first.id);
  const back=reloaded.openEpisode({projectId:updated.id,expectedRevision:updated.revision,episodeNumber:1});
  assert.deepEqual(back,first);
  const resume=reloaded.openEpisode({projectId:back.id,expectedRevision:back.revision,episodeNumber:2});
  assert.equal(resume.id,second.id);assert.equal(resume.state.videoPrompts[0].prompt,'第二集正文');assert.equal(reloaded.list().length,2);
});
test('unavailable scripts and stale project requests do not create or switch projects',()=>{
  const {store,first}=fixture();
  assert.throws(()=>store.openEpisode({projectId:first.id,expectedRevision:0,episodeNumber:2}));
  assert.throws(()=>store.openEpisode({projectId:first.id,expectedRevision:first.revision,episodeNumber:3}),/没有这一集/);
  const changed=store.save({state:{...first.state,episodeScripts:first.state.episodeScripts.filter(r=>r.episodeNumber===1)},expectedRevision:first.revision});
  assert.throws(()=>store.openEpisode({projectId:changed.id,expectedRevision:changed.revision,episodeNumber:2}),/请先生成/);
  assert.equal(store.list().length,1);assert.equal(store.load().id,first.id);
});
test('production navigation and import controls use actual saved work',()=>{
  const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(source,/进入本集制作/);assert.match(source,/\/api\/projects\/episode/);
  assert.doesNotMatch(source,/此处仅建立前端流程状态/);
});

test('conflicting cached character framing is preserved and blocked before image submission',async()=>{
  let submissions=0;
  const store=createProviderSettingsStore({imageProviderFactory:()=>({id:'fake',async submit(){submissions++;throw Error('must not submit');}})});
  for(const kind of ['agent','image'])store.configure({kind,apiKey:'fixture-key-1234',baseUrl:'https://fixture.invalid/v1',model:'fixture'});
  const prompt='基础设定\n16:9剧情半身。\n画面内容与布局\n横版3:2资产板。\n负面词\n模糊';
  const result=await store.runCharacterImages({profiles:[{profileKey:'C01',name:'阿宁'}],styleId:'ancient-live-action',prompts:[{profileKey:'C01',name:'阿宁',styleId:'ancient-live-action',prompt}]});
  assert.equal(submissions,0);assert.equal(result.images[0].status,'failed');assert.match(result.images[0].error,/资产板使用3:2/);assert.equal(result.prompts[0].prompt,prompt);
});
