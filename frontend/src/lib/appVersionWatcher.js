const INDEX_HTML_FETCH_PATH = '/index.html';
const ENTRY_SCRIPT_SELECTOR = 'script[type="module"][src]';
export const VERSION_CHECK_INTERVAL_MS = 60_000;

export function extractEntryScriptPath(html) {
  if (typeof html !== 'string') {
    return null;
  }

  const match = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

export function hasNewDeployedBundle(currentEntryScriptPath, deployedEntryScriptPath) {
  if (!currentEntryScriptPath || !deployedEntryScriptPath) {
    return false;
  }

  return currentEntryScriptPath !== deployedEntryScriptPath;
}

function resolveCurrentEntryScriptPath(documentObj) {
  const scriptSrc = documentObj?.querySelector?.(ENTRY_SCRIPT_SELECTOR)?.src;
  if (!scriptSrc) {
    return null;
  }

  try {
    return new URL(scriptSrc).pathname;
  } catch {
    return scriptSrc;
  }
}

export function startAppVersionWatcher({
  intervalMs = VERSION_CHECK_INTERVAL_MS,
  documentObj = globalThis.document,
  fetchImpl = globalThis.fetch,
  locationObj = globalThis.location,
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  onUpdateAvailable,
} = {}) {
  if (!documentObj || typeof fetchImpl !== 'function' || typeof onUpdateAvailable !== 'function') {
    return () => {};
  }

  const currentEntryScriptPath = resolveCurrentEntryScriptPath(documentObj);
  if (!currentEntryScriptPath) {
    return () => {};
  }

  let hasNotified = false;

  const checkForUpdate = async () => {
    if (hasNotified) {
      return;
    }

    try {
      const response = await fetchImpl(`${INDEX_HTML_FETCH_PATH}?v=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const html = await response.text();
      const deployedEntryScriptPath = extractEntryScriptPath(html);

      if (hasNewDeployedBundle(currentEntryScriptPath, deployedEntryScriptPath)) {
        hasNotified = true;
        onUpdateAvailable(() => {
          locationObj?.reload?.();
        });
      }
    } catch {
      // Ignore transient fetch failures and retry on the next interval.
    }
  };

  void checkForUpdate();

  if (typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function') {
    return () => {};
  }

  const intervalId = setIntervalFn(() => {
    void checkForUpdate();
  }, intervalMs);

  return () => {
    clearIntervalFn(intervalId);
  };
}
