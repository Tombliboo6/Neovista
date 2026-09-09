import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('故事板整批提交给持久任务，页面不保留未提交分段', () => {
  assert.match(source, /postWorkflowRequest[^]*"\/api\/storyboards\/boards", \{ \.\.\.payload, requestedSegmentKeys \}/u);
  assert.doesNotMatch(source, /storyboardBoardQueueRef\.current\.push/u);
});

test('运行中的单段不会锁住其他故事板卡片', () => {
  assert.match(source, /const isQueued = board\.status === "running" && board\.queueState === "queued";/u);
  assert.match(source, /<button className="storyboard-regenerate-action" disabled=\{isRunning \|\| isQueued\} onClick=\{\(\) => onRegenerateStoryboard/u);
  assert.doesNotMatch(source, /<button disabled=\{boardStatus === "running"\} onClick=\{\(\) => onRegenerateStoryboard/u);
});

test('并发返回按稳定段号合并并保留已有图片', () => {
  const state = fs.readFileSync(new URL('../src/production-state.ts', import.meta.url), 'utf8');
  assert.match(state, /mergeByStableKey/);
  assert.match(state, /old\?\.imageUrl/);
});
