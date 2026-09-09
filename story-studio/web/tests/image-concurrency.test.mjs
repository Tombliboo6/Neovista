import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderSettingsStore } from '../local-api.mjs';
import { RequestScheduler } from '../../src/providers/request-scheduler.ts';
for (const limit of [1, 2, 3, 4]) test(`character and canvas batches share configured ${limit} request capacity`, async () => {
 const scheduler = new RequestScheduler(); scheduler.configure({ imageConcurrency: limit });
 let active = 0, peak = 0, calls = 0, release;
 const gate = new Promise(resolve => { release = resolve; });
 const store = createProviderSettingsStore({ requestScheduler: scheduler, imageProviderFactory: () => ({ id: 'fixture', async health() {}, async submit(request) {
 calls++; active++; peak = Math.max(peak, active); await gate; active--;
 return { taskId: request.taskId, status: 'awaiting_review', outputPaths: ['E:/fixture/image.png'] };
 } }) });
 for (const kind of ['agent', 'image']) store.configure({ kind, apiKey: 'fixture-key-1234', baseUrl: 'https://fixture.invalid/v1', model: 'fixture' });
 const profiles = Array.from({ length: 6 }, (_, i) => ({ profileKey: `C0${i + 1}`, name: `角色${i + 1}` }));
 const prompts = profiles.map(item => ({ ...item, styleId: '3d-fantasy', prompt: '基础设定\n人物站立。' }));
 const pending = store.runCharacterImages({ profiles, prompts, styleId: '3d-fantasy' });
 const canvas = store.runFreeCanvasImageGeneration({ nodeId: 'fixture', taskId: 'canvas', prompt: '人物站立', references: [], settings: { width: 1024, height: 1024, quality: 'high', count: 3, outputFormat: 'png' } });
 try {
 await new Promise(resolve => setTimeout(resolve, 30));
 assert.equal(calls, limit); assert.equal(scheduler.status().lanes.image.queued, 9 - limit);
 } finally { release(); }
 const [result] = await Promise.all([pending, canvas]);
 assert.equal(peak, limit); assert.equal(calls, 9);
 assert.deepEqual(result.images.map(item => item.profileKey), profiles.map(item => item.profileKey));
 assert.ok(result.images.every(item => item.status === 'complete'));
});
