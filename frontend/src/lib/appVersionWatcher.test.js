import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEntryScriptPath,
  hasNewDeployedBundle,
  startAppVersionWatcher,
} from './appVersionWatcher.js';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('extractEntryScriptPath reads the hashed Vite entry script from html', () => {
  const html = `
    <html>
      <head>
        <script type="module" crossorigin src="/assets/index-NEW123.js"></script>
      </head>
    </html>
  `;

  assert.equal(extractEntryScriptPath(html), '/assets/index-NEW123.js');
});

test('hasNewDeployedBundle only returns true when the deployed entry script changed', () => {
  assert.equal(hasNewDeployedBundle('/assets/index-OLD.js', '/assets/index-OLD.js'), false);
  assert.equal(hasNewDeployedBundle('/assets/index-OLD.js', '/assets/index-NEW.js'), true);
  assert.equal(hasNewDeployedBundle('/assets/index-OLD.js', null), false);
});

test('startAppVersionWatcher notifies once when a new deployed bundle is detected', async () => {
  const intervalCallbacks = [];
  const notifications = [];
  let reloadCount = 0;

  const stopWatching = startAppVersionWatcher({
    intervalMs: 1_000,
    documentObj: {
      querySelector: () => ({ src: 'https://neotest.site/assets/index-OLD.js' }),
    },
    fetchImpl: async () => ({
      async text() {
        return '<script type="module" crossorigin src="/assets/index-NEW.js"></script>';
      },
    }),
    locationObj: {
      reload() {
        reloadCount += 1;
      },
    },
    setIntervalFn(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    clearIntervalFn() {},
    onUpdateAvailable(reload) {
      notifications.push(reload);
    },
  });

  await flushMicrotasks();
  assert.equal(notifications.length, 1);
  notifications[0]();
  assert.equal(reloadCount, 1);

  await intervalCallbacks[0]();
  assert.equal(notifications.length, 1);

  stopWatching();
});
