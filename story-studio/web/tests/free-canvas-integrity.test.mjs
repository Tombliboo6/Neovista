import test from 'node:test';
import assert from 'node:assert/strict';
import { FreeCanvasHistory, applyCanvasGraphChange } from '../src/free-canvas-history.ts';
import { canvasRemovalError, hasActiveCanvasGeneration } from '../src/free-canvas-integrity.ts';
const node=id=>({id,kind:'image',title:id,content:'',x:0,y:0});
const nodes=['a','b','c','target'].map(node);
const edges=['a','b','c'].map(id=>({id,fromNodeId:id,toNodeId:'target'}));
const base={nodes,edges};
test('reference order survives deletion, undo, React rebase, redo and a second undo',()=>{
 const h=new FreeCanvasHistory();const removed={nodes,edges:[edges[2]]};h.record(base,removed,1);
 const undo=h.undo(removed);assert.deepEqual(undo.edges,edges);
 const applied=applyCanvasGraphChange(removed,removed,undo);assert.deepEqual(applied.edges,edges);
 const redo=h.redo(applied);assert.deepEqual(redo.edges,[edges[2]]);
 assert.deepEqual(h.undo(redo).edges,edges);
});
test('grouped deletions restore both node and reference ordering',()=>{
 const h=new FreeCanvasHistory();const one={nodes:nodes.slice(1),edges:edges.slice(1)};const two={nodes:nodes.slice(2),edges:edges.slice(2)};
 h.record(base,one,1);h.record(one,two,1);assert.deepEqual(h.undo(two),base);assert.deepEqual(h.redo(base),two);
});
test('pure ordering changes have a reversible history entry',()=>{
 const h=new FreeCanvasHistory();const after={nodes,edges:[...edges].reverse()};h.record(base,after,1);assert.deepEqual(h.undo(after),base);assert.deepEqual(h.redo(base),after);
});
test('pending results retain their node across delete, undo creation and redo deletion',()=>{
 for(const status of ['submitting','queued','running']){
  const pending={nodes:[{...node('a'),generation:{status,taskId:'task-a'}}],edges:[]};const empty={nodes:[],edges:[]};
  assert.equal(hasActiveCanvasGeneration(pending),true);assert.ok(canvasRemovalError(pending,empty));
  const h=new FreeCanvasHistory();h.record(empty,pending,1);
  assert.equal(h.undo(pending,next=>!canvasRemovalError(pending,next)),pending);assert.equal(h.canUndo,true);
  const done={nodes:[{...pending.nodes[0],mediaUrl:'result.png',generation:{status:'complete',taskId:'task-a'}}],edges:[]};
  assert.equal(canvasRemovalError(done,empty),null);assert.equal(h.undo(done).nodes.length,0);assert.equal(h.redo(empty).nodes[0].mediaUrl,'result.png');
  const deletion=new FreeCanvasHistory();deletion.record(done,empty,1);deletion.undo(empty);
  assert.equal(deletion.redo(pending,next=>!canvasRemovalError(pending,next)),pending);assert.equal(deletion.canRedo,true);
 }
});
test('pending nodes allow layout edits and removal of unrelated nodes',()=>{
 const pending={nodes:[{...node('a'),generation:{status:'running'}},node('b')],edges:[]};
 assert.equal(canvasRemovalError(pending,{nodes:[{...pending.nodes[0],x:100}]}),null);
});
import fs from 'node:fs';
import { transformSync } from 'esbuild';
const appSource=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
function appFunction(name,context){
 const start=appSource.indexOf(`  async function ${name}(`);assert.ok(start>=0);
 const rest=appSource.slice(start);const end=rest.slice(1).search(/\n  (?:async )?function /);
 const source=end<0?rest:rest.slice(0,end+1);
 const compiled=transformSync(source,{loader:'ts',format:'cjs'}).code;
 return new Function(...Object.keys(context),compiled+`;return ${name};`)(...Object.values(context));
}
test('all project transitions reject active canvas jobs before saving or selecting',async()=>{
 for(const name of ['createProject','selectProject','openEpisodeProduction']){
  let message='';const context={canvasProjectTransitionRef:{current:false},freeCanvasStateRef:{current:{nodes:[{...node('a'),generation:{status:'running'}}]}},hasActiveCanvasGeneration,setProjectManagerError:v=>message=v,setEpisodeProductionError:v=>message=v,episodeOpening:false};
  await appFunction(name,context)('B');assert.match(message,/任务正在执行/);assert.equal(context.canvasProjectTransitionRef.current,false);
 }
});
test('canvas providers cannot submit during a project transition',async()=>{
 for(const name of ['generateFreeCanvasImage','generateFreeCanvasVideo','generateFreeCanvasAudio','processFreeCanvasImage']){
  let calls=0;const fn=appFunction(name,{assertCanvasProjectReady:()=>{throw new Error('switch in progress');},fetch:()=>{calls++;}});
  await assert.rejects(fn(),/switch in progress/);assert.equal(calls,0);
 }
});
test('a rejected project transition releases its lock and exposes the error',async()=>{
 for(const name of ['createProject','selectProject','openEpisodeProduction']){
  let message='';const context={canvasProjectTransitionRef:{current:false},freeCanvasStateRef:{current:{nodes:[]}},hasActiveCanvasGeneration,setProjectManagerError:v=>message=v,setEpisodeProductionError:v=>message=v,episodeOpening:false,setEpisodeOpening:()=>{},setProjectManagerBusy:()=>{},setSessionHydrated:()=>{},persistCurrentProject:async()=>{throw new Error('save failed');}};
  await appFunction(name,context)('B');assert.equal(message,'save failed');assert.equal(context.canvasProjectTransitionRef.current,false);
 }
});
