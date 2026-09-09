import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCreativeSessionStore} from '../local-api.mjs';
const nodes=count=>Array.from({length:count},(_,i)=>({id:`n${i}`,kind:'text',title:`节点${i}`,content:'内容',x:i*20,y:0,createdAt:'2026-09-09T00:00:00Z'}));

test('capacity-rejected save and project creation leave original session bytes intact',()=>{
  const filePath=join(mkdtempSync(join(tmpdir(),'prism-canvas-capacity-')),'session.json');
  const store=createCreativeSessionStore({filePath});const saved=store.save({state:{step:'start',freeCanvas:{nodes:nodes(499),edges:[]}}});
  const before=readFileSync(filePath,'utf8');
  assert.throws(()=>store.save({expectedRevision:saved.revision,state:{...saved.state,freeCanvas:{nodes:nodes(502),edges:[]}}}),/剩余 1/);
  assert.equal(readFileSync(filePath,'utf8'),before);
  assert.throws(()=>store.create({state:{step:'start',freeCanvas:{nodes:nodes(501),edges:[]}}}),/500/);
  assert.equal(readFileSync(filePath,'utf8'),before);
});

test('legacy over-limit sessions load and save all nodes and edges without truncation',()=>{
  const filePath=join(mkdtempSync(join(tmpdir(),'prism-canvas-legacy-')),'session.json');
  const store=createCreativeSessionStore({filePath});const saved=store.save({state:{step:'start'}});
  const legacyNodes=nodes(501);const edges=Array.from({length:1001},(_,i)=>({id:`e${i}`,fromNodeId:`n${i%501}`,toNodeId:`n${(i%501+1+Math.floor(i/501))%501}`}));
  writeFileSync(filePath,JSON.stringify({...saved,state:{...saved.state,freeCanvas:{nodes:legacyNodes,edges}}}));
  const loaded=createCreativeSessionStore({filePath}).load();assert.equal(loaded.state.freeCanvas.nodes.length,501);assert.equal(loaded.state.freeCanvas.edges.length,1001);
  const updated=store.save({expectedRevision:loaded.revision,state:{...loaded.state,projectName:'已编辑'}});
  assert.equal(updated.state.freeCanvas.nodes.length,501);assert.equal(updated.state.freeCanvas.edges.length,1001);
  assert.equal(createCreativeSessionStore({filePath}).load().state.freeCanvas.nodes.length,501);
});

test('oversized graph fields explicitly fail saving rather than clearing the canvas',()=>{
  const filePath=join(mkdtempSync(join(tmpdir(),'prism-canvas-size-')),'session.json');
  const store=createCreativeSessionStore({filePath});const saved=store.save({state:{step:'start',freeCanvas:{nodes:nodes(1),edges:[]}}});
  const before=readFileSync(filePath,'utf8');
  assert.throws(()=>store.save({expectedRevision:saved.revision,state:{...saved.state,freeCanvas:{nodes:[{...nodes(1)[0],content:'x'.repeat(4_000_001)}],edges:[]}}}),/保存大小/);
  assert.equal(readFileSync(filePath,'utf8'),before);
});
