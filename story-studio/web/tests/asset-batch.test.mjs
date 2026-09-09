import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import { productionAssetBatch } from '../src/asset-batch.ts';
for(const [kind,field] of [['character','profileKey'],['scene','sceneAssetKey'],['prop','propAssetKey']]){
 const assets=['1','2','3','4','5'].map(key=>({[field]:key}));
 test(`${kind} batch excludes complete and active images, separates failures for explicit retry`,()=>{
  const images=[{[field]:'1',status:'complete',imageUrl:'existing.png'},{[field]:'2',status:'failed',error:'preserved'},{[field]:'3',status:'queued'}];
  const original=structuredClone(images);const b=productionAssetBatch(kind,assets,images,['4']);
  assert.deepEqual(b.readyKeys,['5']);assert.deepEqual(b.failedKeys,['2']);assert.equal(b.completed,1);assert.equal(b.running,2);assert.deepEqual(images,original);
 });
 test(`${kind} batch generates all missing selected assets and can fill stale images`,()=>{
  const b=productionAssetBatch(kind,[...assets,{[field]:'6',selectedForProduction:false}], [{[field]:'1',status:'complete',imageUrl:'old.png',stale:true}]);
  assert.deepEqual(b.readyKeys,['1','2','3','4','5']);assert.equal(b.total,5);
 });
 test(`${kind} completed batch remains empty after reload`,()=>{
  const images=assets.map(a=>({...a,status:'complete',imageUrl:a[field]+'.png'}));
  const b=productionAssetBatch(kind,JSON.parse(JSON.stringify(assets)),JSON.parse(JSON.stringify(images)));
  assert.deepEqual(b.readyKeys,[]);assert.deepEqual(b.failedKeys,[]);assert.equal(b.completed,5);
 });
}
test('character batch skips voice, mention and unresolved identity selection',()=>{
 const b=productionAssetBatch('character',[{profileKey:'A',participation:'voice'},{profileKey:'B',participation:'candidate'},{profileKey:'C',libraryBinding:{selectionNeeded:true}},{profileKey:'D',libraryBinding:{reused:true}}],[{profileKey:'D',status:'complete',imageUrl:'reused.png'}]);
 assert.deepEqual(b.readyKeys,[]);assert.deepEqual(b.blockedKeys,['C']);assert.equal(b.total,2);assert.equal(b.completed,1);
});
test('batch dispatcher submits one exact key list and guards double click and unapproved state',async()=>{
 const src=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');const fn=src.slice(src.indexOf('  async function generateAssetBatch('),src.indexOf('  async function generateCharacterImages(')).replace('kind: AssetBatchKind','kind');
 const create=new Function('productionAssetBatch',`return async function(){
 let characterApproval='approved', sceneProposalApproval='approved',propProposalApproval='approved',selectedStyleId='style';
 const characterProfiles=[{profileKey:'C01'},{profileKey:'C02'},{profileKey:'C03'}],sceneProposals=[],propProposals=[],sceneImages=[],propImages=[];
 const characterImages=[{profileKey:'C01',status:'complete',imageUrl:'ok.png'},{profileKey:'C03',status:'failed'}];
 const characterImageRequestKeysRef={current:new Set()},sceneImageRequestKeysRef={current:new Set()},propImageRequestKeysRef={current:new Set()};
 const calls=[];let release;const wait=new Promise(r=>release=r);
 async function generateCharacterImages(keys){calls.push(keys);keys.forEach(k=>characterImageRequestKeysRef.current.add(k));await wait;characterImageRequestKeysRef.current.clear();}
 async function generateSceneImages(){};async function generatePropImages(){};
 ${fn}
 const first=generateAssetBatch('character');await generateAssetBatch('character');release();await first;
 await generateAssetBatch('character',true);characterApproval='draft';await generateAssetBatch('character');
 return calls;
 }`)(productionAssetBatch);
 assert.deepEqual(await create(),[['C02'],['C03']]);
});
