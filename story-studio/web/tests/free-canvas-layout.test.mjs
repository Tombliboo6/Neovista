import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeFreeCanvas } from '../src/free-canvas-layout.ts';

test('organizeFreeCanvas assigns branches and merges to stable left-to-right layers', () => {
  const positions = organizeFreeCanvas([
    { id: 'source', x: 103, y: 91 },
    { id: 'upper', x: 811, y: 20 },
    { id: 'lower', x: 511, y: 540 },
    { id: 'result', x: 1300, y: 280 },
  ], [
    { fromNodeId: 'source', toNodeId: 'upper' },
    { fromNodeId: 'source', toNodeId: 'lower' },
    { fromNodeId: 'upper', toNodeId: 'result' },
    { fromNodeId: 'lower', toNodeId: 'result' },
  ]);

  assert.equal(positions.get('upper').x, positions.get('lower').x);
  assert.equal(positions.get('upper').x - positions.get('source').x, 462);
  assert.equal(positions.get('result').x - positions.get('upper').x, 462);
  assert.ok(positions.get('upper').y < positions.get('lower').y);
  positions.forEach(({ x, y }) => { assert.equal(x % 22, 0); assert.equal(y % 22, 0); });
});

test('organizeFreeCanvas keeps a cycle in one column and advances its downstream node', () => {
  const positions = organizeFreeCanvas([
    { id: 'cycle-a', x: 40, y: 80 },
    { id: 'cycle-b', x: 500, y: 200 },
    { id: 'downstream', x: 900, y: 140 },
  ], [
    { fromNodeId: 'cycle-a', toNodeId: 'cycle-b' },
    { fromNodeId: 'cycle-b', toNodeId: 'cycle-a' },
    { fromNodeId: 'cycle-b', toNodeId: 'downstream' },
  ]);

  assert.equal(positions.get('cycle-a').x, positions.get('cycle-b').x);
  assert.equal(positions.get('downstream').x - positions.get('cycle-a').x, 462);
  assert.notEqual(positions.get('cycle-a').y, positions.get('cycle-b').y);
});

test('organizeFreeCanvas is deterministic and ignores invalid edges', () => {
  const nodes = [{ id: 'b', x: -17, y: 22 }, { id: 'a', x: 40, y: -5 }];
  const edges = [{ fromNodeId: 'missing', toNodeId: 'a' }, { fromNodeId: 'a', toNodeId: 'a' }];
  assert.deepEqual([...organizeFreeCanvas(nodes, edges)], [...organizeFreeCanvas(nodes, edges)]);
});
