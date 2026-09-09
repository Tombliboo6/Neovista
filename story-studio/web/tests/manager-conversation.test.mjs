import assert from 'node:assert/strict';
import test from 'node:test';

import { activeManagerCommandEntry, managerLocalWorkflowIntent, managerMessageExecutionIntent } from '../src/manager-conversation.ts';

test('a confirmation message keeps the latest unfinished command available for execution', () => {
  const assistant = { role: 'assistant', commands: [{ id: 'old-command', status: 'awaiting_confirmation' }] };
  assert.equal(activeManagerCommandEntry([assistant]), assistant);
  assert.equal(activeManagerCommandEntry([assistant, { role: 'user', text: '确认修改' }]), assistant);
});

test('only commands attached to the newest assistant reply are shown', () => {
  const latest = { role: 'assistant', commands: [{ id: 'new-command', status: 'awaiting_confirmation' }] };
  assert.equal(activeManagerCommandEntry([{ role: 'assistant', commands: [{ id: 'old-command', status: 'completed' }] }, { role: 'user' }, latest]), latest);
});

test('manager recognizes explicit change authorization without treating questions as approval', () => {
  assert.equal(managerMessageExecutionIntent('确认修改'), 'confirm');
  assert.equal(managerMessageExecutionIntent('确认'), 'confirm');
  assert.equal(managerMessageExecutionIntent('按这个改'), 'confirm');
  assert.equal(managerMessageExecutionIntent('请把角色年龄改成六十岁'), 'change');
  assert.equal(managerMessageExecutionIntent('把错误的地方修改了'), 'change');
  assert.equal(managerMessageExecutionIntent('那你写入啊'), 'change');
  assert.equal(managerMessageExecutionIntent('你修改好了吗？'), null);
  assert.equal(managerMessageExecutionIntent('在修复了吗'), null);
  assert.equal(managerMessageExecutionIntent('这个要怎么改？'), null);
});

test('manager opens storyboard production locally for explicit return requests', () => {
  assert.equal(managerLocalWorkflowIntent('我想先补上分镜图'), 'workflow-back');
  assert.equal(managerLocalWorkflowIntent('返回分镜制作'), 'workflow-back');
  assert.equal(managerLocalWorkflowIntent('继续生成故事板图'), 'workflow-back');
  assert.equal(managerLocalWorkflowIntent('返回上一步'), 'workflow-back');
  assert.equal(managerLocalWorkflowIntent('为什么分镜图没有生成？'), null);
  assert.equal(managerLocalWorkflowIntent('这个阶段出了什么问题？'), null);
});
