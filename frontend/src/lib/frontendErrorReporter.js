const recentErrors = new Map();
const THROTTLE_WINDOW_MS = 60_000;

function shouldReport(key) {
  const now = Date.now();
  const lastSeenAt = recentErrors.get(key) || 0;
  if (now - lastSeenAt < THROTTLE_WINDOW_MS) {
    return false;
  }

  recentErrors.set(key, now);
  return true;
}

function postFrontendError(payload) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  fetch('/api/v1/frontend-errors', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((error) => {
    console.error('frontend error report failed', error);
  });
}

function sanitizeStack(value) {
  if (!value) {
    return null;
  }

  return String(value).slice(0, 4000);
}

function reportError({ message, stack }) {
  const route = window.location.pathname;
  const key = `${route}:${message}`;

  if (!shouldReport(key)) {
    return;
  }

  postFrontendError({
    route,
    message: String(message).slice(0, 500),
    stack: sanitizeStack(stack),
    user_agent: navigator.userAgent,
  });
}

function handleWindowError(event) {
  reportError({
    message: event.message || 'Unknown window error',
    stack: event.error?.stack,
  });
}

function handleUnhandledRejection(event) {
  reportError({
    message: event.reason?.message || String(event.reason || 'Unhandled promise rejection'),
    stack: event.reason?.stack,
  });
}

export function installFrontendErrorReporter() {
  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}
