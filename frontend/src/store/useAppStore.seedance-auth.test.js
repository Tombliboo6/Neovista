import test from 'node:test';
import assert from 'node:assert/strict';

function createMemoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const localStorage = createMemoryStorage();
globalThis.localStorage = localStorage;

const { useAppStore } = await import('./useAppStore.js');
const {
  loadActiveVideoTask,
  loadPendingVideoSubmission,
  persistActiveVideoTask,
  persistPendingVideoSubmission,
} = await import('../lib/videoGeneration.js');

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const enabledCapabilities = {
  enabled: true,
  model: 'seedance-2.0',
  min_duration_seconds: 5,
  max_duration_seconds: 15,
  default_resolution: '720p',
  resolution_credits_per_second: { '720p': 250 },
  aspect_ratios: ['16:9', '9:16'],
  max_reference_images: 9,
};

const waitFor = async (predicate, { attempts = 50, delayMs = 0 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('Timed out waiting for test condition');
};

const resetAsUser = (id, token, authEpoch) => {
  useAppStore.getState().activeGenerationController?.abort();
  localStorage.clear();
  localStorage.setItem('token', token);
  useAppStore.setState({
    user: { id, credits: 10000 },
    token,
    authEpoch,
    workspaceChatMessages: [],
    activeVideoTask: null,
    activeVideoPollingTaskId: null,
    activeGenerationController: null,
    isGenerationCancelable: false,
    isGenerating: false,
    isRecoveringVideoTask: false,
    videoCapabilities: null,
    isVideoCapabilitiesLoading: false,
    selectedModel: 'seedance-2.0',
    aspectRatio: '16:9',
    videoDurationSeconds: 5,
    videoResolution: '720p',
    videoFrameMode: 'auto',
  });
};

test('account switch during capability lookup prevents the old user submission', async () => {
  resetAsUser(1, 'token-a', 100);
  let resolveCapabilities;
  let generateCalls = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/capabilities')) {
      return new Promise((resolve) => {
        resolveCapabilities = resolve;
      });
    }
    if (url.includes('/v1/video/tasks?')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (url.endsWith('/v1/video/generate')) {
      generateCalls += 1;
      return Promise.resolve(jsonResponse({ task_id: 'must-not-submit' }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const generation = useAppStore.getState().generateVideo('A prompt', []);
  await waitFor(() => Boolean(resolveCapabilities));
  useAppStore.getState().logout();
  useAppStore.getState().setToken('token-b');
  useAppStore.getState().setUser({ id: 2, credits: 10000 });
  resolveCapabilities(jsonResponse(enabledCapabilities));
  await generation;

  assert.equal(generateCalls, 0);
  assert.equal(useAppStore.getState().user.id, 2);
  assert.equal(useAppStore.getState().isGenerating, false);
  assert.equal(loadPendingVideoSubmission(localStorage, 1), null);
});

test('delayed Seedance create response cannot mutate the next signed-in account', async () => {
  resetAsUser(1, 'token-a', 200);
  let resolveCreate;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/capabilities')) {
      return Promise.resolve(jsonResponse(enabledCapabilities));
    }
    if (url.endsWith('/v1/video/generate')) {
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    }
    if (url.includes('/v1/video/tasks?')) {
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const generation = useAppStore.getState().generateVideo('A delayed prompt', []);
  await waitFor(() => Boolean(resolveCreate));
  const pendingForA = loadPendingVideoSubmission(localStorage, 1);
  assert.ok(pendingForA?.requestId);

  useAppStore.getState().logout();
  useAppStore.getState().setToken('token-b');
  useAppStore.getState().setUser({ id: 2, credits: 9000 });
  resolveCreate(jsonResponse({
    task_id: 'task-a',
    request_id: pendingForA.requestId,
    status: 'submitted',
  }));
  await generation;

  assert.equal(useAppStore.getState().user.id, 2);
  assert.deepEqual(useAppStore.getState().workspaceChatMessages, []);
  assert.equal(useAppStore.getState().activeVideoTask, null);
  assert.equal(useAppStore.getState().activeGenerationController, null);
  assert.equal(useAppStore.getState().isGenerating, false);
  assert.equal(loadPendingVideoSubmission(localStorage, 1).requestId, pendingForA.requestId);
  assert.equal(loadPendingVideoSubmission(localStorage, 2), null);
  assert.equal(loadActiveVideoTask(localStorage, 2), null);
});

test('stale bootstrap response cannot restore a logged-out account over a new login', async () => {
  resetAsUser(1, 'token-a', 300);
  useAppStore.setState({ user: null });
  let resolveBootstrap;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/me')) {
      return new Promise((resolve) => {
        resolveBootstrap = resolve;
      });
    }
    if (url.includes('/v1/video/tasks?')) {
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const bootstrap = useAppStore.getState().bootstrapAuth();
  await waitFor(() => Boolean(resolveBootstrap));
  useAppStore.getState().logout();
  useAppStore.getState().setToken('token-b');
  useAppStore.getState().setUser({ id: 2, credits: 7000 });
  resolveBootstrap(jsonResponse({ id: 1, credits: 10000 }));
  await bootstrap;

  assert.equal(useAppStore.getState().token, 'token-b');
  assert.equal(useAppStore.getState().user.id, 2);
  assert.equal(localStorage.getItem('token'), 'token-b');
});

test('delayed billing refresh cannot overwrite the next account credits', async () => {
  resetAsUser(1, 'token-a', 400);
  let resolveBilling;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/billing/me')) {
      return new Promise((resolve) => {
        resolveBilling = resolve;
      });
    }
    if (url.includes('/v1/video/tasks?')) {
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const refresh = useAppStore.getState().refreshBilling();
  await waitFor(() => Boolean(resolveBilling));
  useAppStore.getState().logout();
  useAppStore.getState().setToken('token-b');
  useAppStore.getState().setUser({ id: 2, credits: 7000 });
  resolveBilling(jsonResponse({ credits: 1234, transactions: [] }));
  await refresh;

  assert.equal(useAppStore.getState().user.id, 2);
  assert.equal(useAppStore.getState().user.credits, 7000);
  assert.equal(useAppStore.getState().billingSummary, null);
});

test('creation-time 5xx unlocks only after repeated server-side absence confirmation', async () => {
  resetAsUser(1, 'token-a', 500);
  let byRequestCalls = 0;
  let listCalls = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/capabilities')) {
      return Promise.resolve(jsonResponse(enabledCapabilities));
    }
    if (url.endsWith('/v1/video/generate')) {
      return Promise.resolve(jsonResponse({ detail: 'temporary failure' }, 503));
    }
    if (url.includes('/v1/video/tasks/by-request/')) {
      byRequestCalls += 1;
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    }
    if (url.includes('/v1/video/tasks?')) {
      listCalls += 1;
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await useAppStore.getState().generateVideo('pre-intent failure', []);
  await waitFor(
    () => loadPendingVideoSubmission(localStorage, 1) === null
      && useAppStore.getState().isRecoveringVideoTask === false,
    { attempts: 80, delayMs: 50 },
  );

  assert.equal(byRequestCalls, 3);
  assert.equal(listCalls, 3);
  assert.match(
    useAppStore.getState().workspaceChatMessages.at(-1).content,
    /本地提交锁已解除/,
  );
});

test('malformed recovery response never clears an ambiguous pending submission', async () => {
  resetAsUser(1, 'token-a', 550);
  let listCalls = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/capabilities')) {
      return Promise.resolve(jsonResponse(enabledCapabilities));
    }
    if (url.endsWith('/v1/video/generate')) {
      return Promise.resolve(jsonResponse({ detail: 'temporary failure' }, 503));
    }
    if (url.includes('/v1/video/tasks/by-request/')) {
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    }
    if (url.includes('/v1/video/tasks?')) {
      listCalls += 1;
      return Promise.resolve(jsonResponse({ malformed: true }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  await useAppStore.getState().generateVideo('ambiguous response', []);
  await waitFor(() => listCalls === 1 && useAppStore.getState().isRecoveringVideoTask === false);

  assert.ok(loadPendingVideoSubmission(localStorage, 1)?.requestId);
  assert.doesNotMatch(
    useAppStore.getState().workspaceChatMessages.at(-1).content,
    /本地提交锁已解除/,
  );
});

test('stale active marker unlocks only after task and request are repeatedly absent', async () => {
  resetAsUser(1, 'token-a', 600);
  persistActiveVideoTask({
    taskId: 'stale-task',
    requestId: 'stale-request',
    ownerUserId: 1,
    status: 'submitted',
  }, localStorage);
  let taskCalls = 0;
  let byRequestCalls = 0;
  let listCalls = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/tasks/stale-task')) {
      taskCalls += 1;
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    }
    if (url.includes('/v1/video/tasks/by-request/stale-request')) {
      byRequestCalls += 1;
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    }
    if (url.includes('/v1/video/tasks?')) {
      listCalls += 1;
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.equal(useAppStore.getState().resumeActiveVideoTask(), true);
  await waitFor(
    () => loadActiveVideoTask(localStorage, 1) === null
      && useAppStore.getState().isGenerating === false,
    { attempts: 80, delayMs: 50 },
  );

  assert.equal(taskCalls, 3);
  assert.equal(byRequestCalls, 3);
  assert.equal(listCalls, 3);
  assert.match(
    useAppStore.getState().workspaceChatMessages.at(-1).content,
    /已解除本地恢复锁/,
  );
});

test('recovering an older request never replaces a newer active task marker', async () => {
  resetAsUser(1, 'token-a', 700);
  persistPendingVideoSubmission({
    requestId: 'request-a',
    ownerUserId: 1,
    createdAt: 100,
  }, localStorage);
  persistActiveVideoTask({
    taskId: 'task-b',
    requestId: 'request-b',
    ownerUserId: 1,
    createdAt: 200,
    status: 'running',
  }, localStorage);
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.endsWith('/v1/video/tasks/by-request/request-a')) {
      return Promise.resolve(jsonResponse({
        task_id: 'task-a',
        request_id: 'request-a',
        status: 'succeeded',
        settlement_status: 'CAPTURED',
        video_url: 'https://cdn.example.com/a.mp4',
      }));
    }
    if (url.endsWith('/v1/video/tasks/task-b')) {
      return Promise.resolve(jsonResponse({
        task_id: 'task-b',
        request_id: 'request-b',
        status: 'reconciliation_required',
        settlement_status: 'REVIEW_REQUIRED',
        error_message: 'manual review',
      }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.equal(
    await useAppStore.getState().recoverActiveVideoTask({ requestId: 'request-a' }),
    true,
  );
  await waitFor(() => useAppStore.getState().activeGenerationController === null);

  assert.equal(loadActiveVideoTask(localStorage, 1).taskId, 'task-b');
  assert.equal(loadPendingVideoSubmission(localStorage, 1).requestId, 'request-a');
});
