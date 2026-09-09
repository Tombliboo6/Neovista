const { createReadStream, existsSync, statSync } = require('node:fs');
const http = require('node:http');
const { extname, join, normalize, resolve, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
].join('; ');

async function startDesktopServer(options) {
  const runtimeRoot = resolve(options.runtimeRoot);
  const webRoot = resolve(runtimeRoot, 'web');
  const apiBundle = resolve(runtimeRoot, 'local-api.mjs');
  if (!existsSync(resolve(webRoot, 'index.html'))) throw new Error(`客户端网页文件缺失：${webRoot}`);
  if (!existsSync(apiBundle)) throw new Error(`客户端本地服务文件缺失：${apiBundle}`);

  process.env.PRISM_STORY_STUDIO_DATA_ROOT = resolve(options.dataRoot);
  process.env.PRISM_STORY_STUDIO_RESOURCE_ROOT = runtimeRoot;
  const apiModule = await import(`${pathToFileURL(apiBundle).href}?desktop=${Date.now()}`);
  const apiRuntime = apiModule.createLocalApiRuntime({
    providerSettingsStorage: options.providerSettingsStorage,
    promptMasterProviderSettingsStorage: options.promptMasterProviderSettingsStorage,
  });
  const sessionToken = randomBytes(32).toString('hex');
  const cookieName = 'prism_story_session';
  let origin = '';

  const server = http.createServer(async (request, response) => {
    try {
      const host = String(request.headers.host || '');
      if (!origin || host !== new URL(origin).host) return sendJson(response, 421, { error: 'invalid_host' });
      const requestUrl = new URL(request.url || '/', origin);
      if (requestUrl.pathname.startsWith('/api/')) {
        if (!authorizedRequest(request, origin, cookieName, sessionToken)) return sendJson(response, 403, { error: 'desktop_session_required' });
        const handled = await apiRuntime.handle(request, response);
        if (!handled && !response.headersSent) sendJson(response, 404, { error: 'api_route_not_found' });
        return;
      }
      serveStatic(webRoot, requestUrl.pathname, request, response, cookieName, sessionToken);
    } catch (error) {
      options.log?.(`desktop server request failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
      if (!response.headersSent) sendJson(response, 500, { error: 'desktop_server_error' });
      else response.destroy();
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('客户端本地服务没有取得可用端口。');
  origin = `http://127.0.0.1:${address.port}`;
  options.log?.(`desktop server ready: ${origin}`);

  return {
    origin,
    port: address.port,
    close: () => { apiRuntime.close?.(); return new Promise((resolveClose) => server.close(() => resolveClose())); },
  };
}

function authorizedRequest(request, origin, cookieName, sessionToken) {
  const originHeader = String(request.headers.origin || '');
  if (originHeader && originHeader !== origin) return false;
  const cookies = new Map(String(request.headers.cookie || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  return cookies.get(cookieName) === sessionToken;
}

function serveStatic(webRoot, pathname, request, response, cookieName, sessionToken) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendJson(response, 400, { error: 'invalid_path' }); }
  const relative = decoded === '/' ? 'index.html' : normalize(decoded.replace(/^\/+/, ''));
  let target = resolve(webRoot, relative);
  if (!target.startsWith(`${webRoot}${sep}`) && target !== webRoot) return sendJson(response, 404, { error: 'not_found' });
  if (!existsSync(target) || !statSync(target).isFile()) target = resolve(webRoot, 'index.html');
  const extension = extname(target).toLowerCase();
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES.get(extension) || 'application/octet-stream');
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (extension === '.html') {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', `${cookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
  } else {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  if (request.method === 'HEAD') return response.end();
  createReadStream(target).pipe(response);
}

function sendJson(response, status, body) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

module.exports = { CONTENT_SECURITY_POLICY, startDesktopServer };
