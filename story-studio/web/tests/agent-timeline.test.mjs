import assert from 'node:assert/strict';
import test from 'node:test';

import { latestTimelineTimestamp, orderAgentTimeline } from '../src/agent-timeline.ts';

const at = (second) => `2026-09-01T10:00:${String(second).padStart(2, '0')}.000Z`;

test('a workflow result created after an earlier chat is the final timeline item', () => {
  const ordered = orderAgentTimeline([
    { id: 'chat', kind: 'manager', createdAt: at(10), value: 'earlier chat' },
    { id: 'workflow', kind: 'workflow', createdAt: at(20), value: 'new choices' },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ['chat', 'workflow']);
});

test('a new chat created after existing workflow choices is the final timeline item', () => {
  const ordered = orderAgentTimeline([
    { id: 'workflow', kind: 'workflow', createdAt: at(10), value: 'existing choices' },
    { id: 'chat', kind: 'manager', createdAt: at(20), value: 'new chat' },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ['workflow', 'chat']);
});

test('a completed command result is ordered by completion time instead of its original reply time', () => {
  const commandCreatedAt = latestTimelineTimestamp([at(10), at(30)]);
  const ordered = orderAgentTimeline([
    { id: 'reply', kind: 'manager', createdAt: at(10), value: 'reply' },
    { id: 'workflow', kind: 'workflow', createdAt: at(20), value: 'current workflow' },
    { id: 'command', kind: 'manager-command', createdAt: commandCreatedAt, value: 'completed result' },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ['reply', 'workflow', 'command']);
});

test('items with identical timestamps keep actions after the message that produced them', () => {
  const ordered = orderAgentTimeline([
    { id: 'workflow', kind: 'workflow', createdAt: at(10), value: 'choices' },
    { id: 'manager', kind: 'manager', createdAt: at(10), value: 'reply' },
    { id: 'agent', kind: 'agent', createdAt: at(10), value: 'question' },
    { id: 'command', kind: 'manager-command', createdAt: at(10), value: 'commands' },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ['agent', 'manager', 'workflow', 'command']);
});
