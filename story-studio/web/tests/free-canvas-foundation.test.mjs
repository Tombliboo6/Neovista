import test from 'node:test';
import assert from 'node:assert/strict';
import { FreeCanvasHistory, applyCanvasGraphChange } from '../src/free-canvas-history.ts';
import { copyCanvasSelection, pasteCanvasSelection } from '../src/free-canvas-clipboard.ts';
import { organizeFreeCanvas } from '../src/free-canvas-layout.ts';
import { freeCanvasCapacityError, freeCanvasCapacityNotice } from '../../src/free-canvas/capacity.ts';

const node = (id, x=0, y=0) => ({ id, kind:'image', title:id, content:'prompt', x, y, createdAt:'2026-09-09T00:00:00Z' });
const edge = (id,fromNodeId,toNodeId) => ({ id,fromNodeId,toNodeId,sourceHandle:'right',targetHandle:'left' });
const graph = (...nodes) => ({nodes,edges:[]});

test('undo and redo a layout retain an independently completed result', () => {
  const history = new FreeCanvasHistory();
  const before = graph(node('a'),node('b'));
  const moved = {...before,nodes:before.nodes.map(n=>({...n,x:n.x+462}))};
  history.record(before,moved,1);
  const result = {status:'complete',taskId:'task-b',updatedAt:'now'};
  const completed = {...moved,nodes:moved.nodes.map(n=>n.id==='b'?{...n,mediaUrl:'new.png',generation:result}:n)};
  const undone = history.undo(completed);
  assert.equal(undone.nodes[0].x,0);
  assert.equal(undone.nodes[1].mediaUrl,'new.png');
  assert.deepEqual(undone.nodes[1].generation,result);
  const redone = history.redo(undone);
  assert.equal(redone.nodes[1].x,462);
  assert.equal(redone.nodes[1].mediaUrl,'new.png');
});

test('undo edits only changed fields and preserves later async content', () => {
  const h=new FreeCanvasHistory();const before=graph(node('a'));
  const after=graph({...before.nodes[0],content:'user text',x:44});h.record(before,after,1);
  const updated=graph({...after.nodes[0],content:'AI returned text',title:'renamed elsewhere'});
  const undone=h.undo(updated);
  assert.equal(undone.nodes[0].x,0);
  assert.equal(undone.nodes[0].content,'AI returned text');
  assert.equal(undone.nodes[0].title,'renamed elsewhere');
});

test('a grouped multi-node move and its edges undo in one step',()=>{
  const h=new FreeCanvasHistory();const before=graph(node('a'),node('b',300));
  const first=graph({...before.nodes[0],x:20},before.nodes[1]);
  const second=graph(first.nodes[0],{...first.nodes[1],x:320});
  h.record(before,first,1);h.record(first,second,1);
  assert.deepEqual(h.undo(second),before);assert.equal(h.canUndo,false);
  assert.deepEqual(h.redo(before),second);
});

test('editing a previously missing field retains undefined as its undo baseline',()=>{
  const h=new FreeCanvasHistory();const before=graph(node('a'));
  const one=graph({...before.nodes[0],mediaUrl:'one.png'});const two=graph({...one.nodes[0],mediaUrl:'two.png'});
  h.record(before,one,1);h.record(one,two,1);const undone=h.undo(two);
  assert.equal(Object.hasOwn(undone.nodes[0],'mediaUrl'),false);
});

test('a completed result survives undo and redo of node creation',()=>{
  const h=new FreeCanvasHistory();const before=graph();const added=graph(node('a'));h.record(before,added,1);
  const completed=graph({...added.nodes[0],mediaUrl:'complete.png',generation:{status:'complete',taskId:'a'}});
  const undone=h.undo(completed);assert.equal(undone.nodes.length,0);
  assert.equal(h.redo(undone).nodes[0].mediaUrl,'complete.png');
});

test('undoing an edit does not resurrect a node removed by another operation',()=>{
  const h=new FreeCanvasHistory();const before=graph(node('a'));h.record(before,graph({...before.nodes[0],x:20}),1);
  assert.equal(h.undo(graph()).nodes.length,0);
});

test('applying a queued graph change preserves concurrent fields and nodes',()=>{
  const before=graph(node('a'));const after=graph({...before.nodes[0],x:44});
  const current=graph({...before.nodes[0],mediaUrl:'late.png'},node('b'));
  const applied=applyCanvasGraphChange(current,before,after);
  assert.equal(applied.nodes[0].mediaUrl,'late.png');assert.equal(applied.nodes[0].x,44);assert.equal(applied.nodes.length,2);
});

test('selection copies internal edges with fresh IDs and no running task',()=>{
  const nodes=[node('a',30,50),{...node('b',400,200),generation:{status:'running',taskId:'active'},mediaUrl:'old-result.png'},node('outside')];
  const edges=[edge('inside','a','b'),edge('outside','outside','b')];
  const copied=copyCanvasSelection(nodes,edges,new Set(['a','b']));
  let id=0;const pasted=pasteCanvasSelection(copied,{x:100,y:100},kind=>`${kind}-${++id}`,'new date');
  assert.equal(pasted.nodes.length,2);assert.equal(pasted.edges.length,1);
  assert.equal(pasted.nodes[1].x-pasted.nodes[0].x,370);
  assert.equal(pasted.nodes[1].y-pasted.nodes[0].y,150);
  assert.equal(pasted.edges[0].fromNodeId,pasted.nodes[0].id);assert.equal(pasted.edges[0].toNodeId,pasted.nodes[1].id);
  assert.equal(pasted.nodes[1].generation,undefined);assert.equal(pasted.nodes[1].mediaUrl,'old-result.png');
  pasted.nodes[0].content='edited';assert.equal(nodes[0].content,'prompt');
  const h=new FreeCanvasHistory();const before={nodes,edges};const after={nodes:[...nodes,...pasted.nodes],edges:[...edges,...pasted.edges]};h.record(before,after,1);
  assert.deepEqual(h.undo(after),before);
});

test('layout packs mixed measured dimensions without overlap and is repeatable',()=>{
  const nodes=Array.from({length:20},(_,i)=>({...node(`n${i}`,i%4*462,Math.floor(i/4)*330),width:i%5===0?640:300,height:i%3===0?620:i%3===1?450:220}));
  const edges=nodes.slice(4).map((n,i)=>edge(`e${i}`,nodes[i].id,n.id));
  const positions=organizeFreeCanvas(nodes,edges);const arranged=nodes.map(n=>({...n,...positions.get(n.id)}));
  for(let i=0;i<arranged.length;i++)for(let j=i+1;j<arranged.length;j++){
    const a=arranged[i],b=arranged[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} intersects ${b.id}`);
  }
  assert.deepEqual([...organizeFreeCanvas(arranged,edges)],[...positions]);
});

test('capacity rejects an entire overflowing paste and retains legacy graphs',()=>{
  const current={nodes:Array(499),edges:[]};assert.match(freeCanvasCapacityError({nodes:Array(502),edges:[]},current),/剩余 1/);
  assert.equal(freeCanvasCapacityError({nodes:Array(500),edges:[]},current),null);
  const legacy={nodes:Array(501),edges:Array(1001)};assert.equal(freeCanvasCapacityError(legacy,legacy),null);
  assert.match(freeCanvasCapacityNotice(legacy),/完整保留/);
  assert.match(freeCanvasCapacityError({...legacy,edges:Array(1002)},legacy),/连线/);
});

test('a capacity-rejected undo retains the command until there is room',()=>{
  const h=new FreeCanvasHistory();const before=graph(node('removed'),node('kept'));const after=graph(before.nodes[1]);h.record(before,after,1);
  const rejected=h.undo(after,()=>false);assert.equal(rejected,after);assert.equal(h.canUndo,true);assert.equal(h.canRedo,false);
  assert.deepEqual(new Set(h.undo(after).nodes.map(n=>n.id)),new Set(['removed','kept']));
});

test('copy preserves fractional relative coordinates after a zoomed drag',()=>{
  const selection=graph(node('a',10.5,15.2),node('b',370.8,290.7));let id=0;
  const result=pasteCanvasSelection(selection,{x:50,y:50},()=>String(++id),'now');
  assert.ok(Math.abs((result.nodes[1].x-result.nodes[0].x)-360.3)<1e-9);
  assert.ok(Math.abs((result.nodes[1].y-result.nodes[0].y)-275.5)<1e-9);
});
