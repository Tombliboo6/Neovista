import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrangeCanvasSelection } from '../src/free-canvas-alignment.ts';
import { referenceInputError, referencePurposeContext } from '../../src/free-canvas/reference-contract.ts';
import { createCreativeSessionStore, buildFreeCanvasH3GenerationRequest, buildFreeCanvasAudioGenerationRequest } from '../local-api.mjs';
import { FreeCanvasHistory } from '../src/free-canvas-history.ts';
import { copyCanvasSelection, pasteCanvasSelection } from '../src/free-canvas-clipboard.ts';

const nodes = [
  {id:'a',kind:'image',title:'角色',content:'人物',x:20,y:60,width:100,height:300,mediaUrl:'/api/generated-images/a.png'},
  {id:'b',kind:'image',title:'首帧',content:'画面',x:270,y:40,width:200,height:100},
  {id:'c',kind:'video',title:'视频',content:'镜头',x:900,y:550,width:160,height:200},
  {id:'outside',kind:'text',title:'其他',content:'保留',x:-300,y:-200},
];
const ids = new Set(['a','b','c']);
test('align uses visible boundaries and leaves unselected nodes out of the change',()=>{
  const positions=arrangeCanvasSelection(nodes,[],ids,'right');
  for(const node of nodes.slice(0,3)) assert.equal(positions.get(node.id).x+node.width,1060);
  assert.equal(positions.has('outside'),false);
  assert.equal(positions.get('a').y,60);
});
test('distribution gives equal gaps to unequal-sized cards and avoids negative gaps',()=>{
  const positions=arrangeCanvasSelection(nodes,[],ids,'horizontal');
  assert.equal(positions.get('b').x-positions.get('a').x-100,positions.get('c').x-positions.get('b').x-200);
  const crowded=nodes.map(n=>({...n,x:0}));
  const packed=arrangeCanvasSelection(crowded,[],ids,'horizontal');
  assert.equal(packed.get('b').x-packed.get('a').x-100,24);
  assert.equal(arrangeCanvasSelection(nodes,[],new Set(['a','b']),'horizontal').size,0);
});
test('organize selection preserves its origin and respects measured tall cards',()=>{
  const positions=arrangeCanvasSelection(nodes,[],ids,'organize');
  assert.equal(Math.min(...[...positions.values()].map(p=>p.x)),20);
  assert.equal(Math.min(...[...positions.values()].map(p=>p.y)),40);
  assert.equal(positions.size,3);
});
test('reference contract rejects unsupported types, empty media, first-frame conflicts and mode changes',()=>{
  const reference={kind:'image',title:'角色',mediaUrl:'/api/generated-images/a.png',purpose:'character'};
  assert.equal(referenceInputError({kind:'image'},[reference],true),'');
  assert.match(referenceInputError({kind:'audio'},[reference]),/不兼容/);
  assert.match(referenceInputError({kind:'image'},[{...reference,mediaUrl:''}],true),/没有媒体/);
  assert.match(referenceInputError({kind:'video',videoSettings:{mode:'text'}},[reference]),/文生视频/);
  assert.match(referenceInputError({kind:'video'},[{...reference,purpose:'first'},reference]),/一张图片/);
  assert.match(referenceInputError({kind:'video',videoSettings:{mode:'reference'}},[{...reference,purpose:'first'}]),/自动或首帧/);
  assert.match(referenceInputError({kind:'video'},Array(10).fill(reference)),/9张图片/);
  assert.match(referenceInputError({kind:'video'},[null],true),/格式无效/);
});
test('purpose instructions follow actual media order and only add explicit control roles',()=>{
  const references=[{kind:'text',content:'脚本'},{kind:'image',mediaUrl:'own.png'},{kind:'image',mediaUrl:'a.png',purpose:'character'},{kind:'image',mediaUrl:'s.png',purpose:'scene'}];
  assert.match(referencePurposeContext(references),/输入图片2：用于人物身份/);
  assert.match(referencePurposeContext(references),/输入图片3：用于场景空间/);
  assert.equal(referencePurposeContext([{kind:'image',mediaUrl:'own.png'}]),'');
});
test('purpose and incompatible legacy edges survive save and reopen',()=>{
  const filePath=join(mkdtempSync(join(tmpdir(),'prism-canvas-purpose-')),'session.json');
  const store=createCreativeSessionStore({filePath});
  store.save({state:{step:'start',freeCanvas:{nodes,edges:[{id:'ab',fromNodeId:'a',toNodeId:'b',purpose:'character'},{id:'ca',fromNodeId:'c',toNodeId:'a',purpose:'video'}]}}});
  const saved=createCreativeSessionStore({filePath}).load().state.freeCanvas;
  assert.equal(saved.edges[0].purpose,'character');assert.equal(saved.edges[1].purpose,'video');assert.equal(saved.nodes[0].mediaUrl,nodes[0].mediaUrl);
});
test('purpose edits undo independently of new results and survive selection copying',()=>{
  const before={nodes,edges:[{id:'ab',fromNodeId:'a',toNodeId:'b',purpose:'image'}]};
  const after={...before,edges:[{...before.edges[0],purpose:'character'}]};
  const history=new FreeCanvasHistory();history.record(before,after,1);
  const current={...after,nodes:after.nodes.map(n=>n.id==='b'?{...n,mediaUrl:'new.png'}:n)};
  const undone=history.undo(current);assert.equal(undone.edges[0].purpose,'image');assert.equal(undone.nodes[1].mediaUrl,'new.png');
  const copied=copyCanvasSelection(after.nodes,after.edges,new Set(['a','b']));assert.equal(copied.edges[0].purpose,'character');
  let index=0;const pasted=pasteCanvasSelection(copied,{x:500,y:600},()=>`new-${index++}`,'now');assert.equal(pasted.edges[0].purpose,'character');assert.equal(pasted.edges[0].fromNodeId,pasted.nodes[0].id);
});
test('backend builders reject bad contracts before media access or generation',()=>{
  assert.throws(()=>buildFreeCanvasH3GenerationRequest({nodeId:'v',taskId:'t',prompt:'镜头',settings:{mode:'text'},references:[{kind:'image',mediaUrl:'missing.png'}]}),/文生视频/);
  assert.throws(()=>buildFreeCanvasAudioGenerationRequest({nodeId:'a',taskId:'t',prompt:'音乐',references:[{kind:'video',mediaUrl:'missing.mp4'}]}),/不兼容/);
});

test('H3 request carries role guidance and uses the explicit first-frame contract',()=>{
  const generatedImageDirectory=mkdtempSync(join(tmpdir(),'prism-role-request-'));writeFileSync(join(generatedImageDirectory,'a.png'),'fixture');
  const request=buildFreeCanvasH3GenerationRequest({nodeId:'v',taskId:'t',prompt:'镜头缓慢推近。',settings:{mode:'auto',seed:123},references:[{id:'i',kind:'image',title:'角色图',mediaUrl:'/api/generated-images/a.png',purpose:'character'}]}, {generatedImageDirectory});
  assert.match(request.prompt,/输入图片1：用于人物身份/);
  assert.equal(request.mode,'first');assert.equal(request.referenceMedia.length,1);
});
