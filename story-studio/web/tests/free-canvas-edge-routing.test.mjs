import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreeCanvasEdgeRoute } from '../src/free-canvas-edge-routing.ts';

test('free canvas routes split near the source and merge near the target', () => {
  const route = buildFreeCanvasEdgeRoute({ sourceX: 100, sourceY: 200, targetX: 500, targetY: 360 });
  assert.equal(route.forward, true);
  assert.equal(route.sourceBranchX, 136);
  assert.equal(route.targetMergeX, 464);
  assert.equal(route.points[0].x, 100);
  assert.equal(route.points.at(-1).x, 500);
  assert.match(route.path, /^M 100 200/u);
  assert.match(route.path, /L 500 360$/u);
});

test('sibling connections keep the same near-card junctions but receive separate middle lanes', () => {
  const upper = buildFreeCanvasEdgeRoute({ sourceX: 100, sourceY: 200, targetX: 500, targetY: 360, sourceLane: -0.5 });
  const lower = buildFreeCanvasEdgeRoute({ sourceX: 100, sourceY: 200, targetX: 500, targetY: 360, sourceLane: 0.5 });
  assert.equal(upper.sourceBranchX, lower.sourceBranchX);
  assert.equal(upper.targetMergeX, lower.targetMergeX);
  assert.notEqual(upper.middleY, lower.middleY);
});

test('reverse-positioned nodes use an outer lane while keeping both endpoints exact', () => {
  const route = buildFreeCanvasEdgeRoute({ sourceX: 500, sourceY: 320, targetX: 180, targetY: 240, targetLane: 1 });
  assert.equal(route.forward, false);
  assert.ok(route.middleY < 240);
  assert.deepEqual(route.points[0], { x: 500, y: 320 });
  assert.deepEqual(route.points.at(-1), { x: 180, y: 240 });
});

test('subpixel-aligned cards do not create tiny routing elbows', () => {
  const route = buildFreeCanvasEdgeRoute({ sourceX: 100, sourceY: 200, targetX: 500, targetY: 200.4 });
  assert.doesNotMatch(route.path, / Q /u);
  assert.equal(route.path, 'M 100 200 L 500 200.4');
});
