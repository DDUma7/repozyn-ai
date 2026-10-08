import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function envInt(name, fallback) {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
const DIST_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, 'dist'));
const GITHUB_API_BASE = (process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/+$/, '');

// Cloud Run appends the real client IP as the last X-Forwarded-For entry. Only trust the
// header when running behind that proxy, otherwise it is trivially spoofable.
const TRUST_PROXY = process.env.TRUST_PROXY
  ? process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
  : Boolean(process.env.K_SERVICE);

// GitHub proxy abuse limits (all overridable via environment variables)
const PROXY_RATE_LIMIT_MAX = envInt('PROXY_RATE_LIMIT_MAX', 120); // requests per IP per window
const PROXY_RATE_LIMIT_WINDOW_MS = envInt('PROXY_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const PROXY_UPSTREAM_IP_MAX = envInt('PROXY_UPSTREAM_IP_MAX', 60); // uncached GitHub calls per IP per window
const PROXY_UPSTREAM_IP_WINDOW_MS = envInt('PROXY_UPSTREAM_IP_WINDOW_MS', 10 * 60 * 1000);
const PROXY_UPSTREAM_GLOBAL_MAX = envInt('PROXY_UPSTREAM_GLOBAL_MAX', 2000); // uncached GitHub calls on the server quota per window
const PROXY_UPSTREAM_GLOBAL_WINDOW_MS = envInt('PROXY_UPSTREAM_GLOBAL_WINDOW_MS', 60 * 60 * 1000);
const PROXY_MAX_CONCURRENT = envInt('PROXY_MAX_CONCURRENT', 8);
const PROXY_UPSTREAM_TIMEOUT_MS = envInt('PROXY_UPSTREAM_TIMEOUT_MS', 8000);
const RATE_LIMIT_MAX_KEYS = 5000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block',
};

// In-memory cache for GitHub API proxy to conserve rate limits across all clients
const apiCache = new Map();
const API_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const API_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for "user not found"
const API_CACHE_MAX_ENTRIES = 200;
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_TOKEN_REGEX = /^[A-Za-z0-9_]{1,255}$/;

// Identical uncached lookups share a single upstream request
const inFlightUpstream = new Map();
let activeUpstreamRequests = 0;

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded || '';
    const hops = raw.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window counters keyed by client, bounded so the map itself cannot be used to exhaust memory
const rateLimitWindows = new Map();

function sweepRateLimitWindows(now) {
  for (const [key, entry] of rateLimitWindows) {
    if (entry.resetAt <= now) rateLimitWindows.delete(key);
  }
}

function consumeRateLimit(key, max, windowMs) {
  const now = Date.now();
  let entry = rateLimitWindows.get(key);
  if (!entry || entry.resetAt <= now) {
    if (!entry && rateLimitWindows.size >= RATE_LIMIT_MAX_KEYS) {
      sweepRateLimitWindows(now);
      if (rateLimitWindows.size >= RATE_LIMIT_MAX_KEYS) {
        const oldest = rateLimitWindows.keys().next().value;
        if (oldest) rateLimitWindows.delete(oldest);
      }
    }
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitWindows.set(key, entry);
  }
  if (entry.count >= max) {
    return { allowed: false, limit: max, resetAt: entry.resetAt };
  }
  entry.count += 1;
  return { allowed: true, limit: max, resetAt: entry.resetAt };
}

setInterval(() => sweepRateLimitWindows(Date.now()), 60 * 1000).unref();

function sendRateLimited(res, result, message) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  // Mirror GitHub's rate-limit headers so the client can show an accurate reset time
  sendJson(res, 429, { error: message }, {
    'Retry-After': String(retryAfterSeconds),
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.ceil(result.resetAt / 1000)),
  });
}

function getCachedResponse(cacheKey) {
  const cached = apiCache.get(cacheKey);
  if (!cached) return null;
  const ttl = cached.status === 200 ? API_CACHE_TTL_MS : API_NEGATIVE_CACHE_TTL_MS;
  if (Date.now() - cached.timestamp >= ttl) {
    apiCache.delete(cacheKey);
    return null;
  }
  return cached;
}

async function fetchUpstream(targetUrl, authToken) {
  const upstreamHeaders = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Repozyn-AI-CloudRun-Proxy',
  };
  if (authToken) {
    upstreamHeaders.Authorization = `Bearer ${authToken}`;
  }

  activeUpstreamRequests += 1;
  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'error',
      signal: AbortSignal.timeout(PROXY_UPSTREAM_TIMEOUT_MS),
    });
    const body = await upstreamRes.text();

    const headers = {};
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used']) {
      const val = upstreamRes.headers.get(h);
      if (val) headers[h] = val;
    }
    return { status: upstreamRes.status, headers, body };
  } finally {
    activeUpstreamRequests -= 1;
  }
}

async function handleGitHubProxy(req, res, pathname) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET' });
    return;
  }

  const clientIp = getClientIp(req);
  const requestLimit = consumeRateLimit(`req:${clientIp}`, PROXY_RATE_LIMIT_MAX, PROXY_RATE_LIMIT_WINDOW_MS);
  if (!requestLimit.allowed) {
    sendRateLimited(res, requestLimit, 'Too many requests. Please slow down and retry shortly.');
    return;
  }

  // Token priority: Client header > Server environment variable (never leaked to browser)
  const rawClientToken = req.headers['x-github-token'];
  let clientToken = '';
  if (rawClientToken !== undefined) {
    clientToken = String(rawClientToken).trim();
    if (clientToken && !GITHUB_TOKEN_REGEX.test(clientToken)) {
      sendJson(res, 400, { error: 'Invalid GitHub token format' });
      return;
    }
  }
  const serverToken = (process.env.GITHUB_TOKEN || '').trim();
  const authToken = clientToken || serverToken;

  let targetUrl = '';
  let cacheKey = '';

  if (pathname === '/api/github/rate_limit') {
    targetUrl = `${GITHUB_API_BASE}/rate_limit`;
  } else if (pathname.startsWith('/api/github/user/')) {
    const username = pathname.replace('/api/github/user/', '').trim();
    if (!GITHUB_USERNAME_REGEX.test(username)) {
      sendJson(res, 400, { error: 'Invalid GitHub username format' });
      return;
    }
    targetUrl = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`;
    cacheKey = `user:${username.toLowerCase()}`;
  } else if (pathname.startsWith('/api/github/repos/')) {
    const username = pathname.replace('/api/github/repos/', '').trim();
    if (!GITHUB_USERNAME_REGEX.test(username)) {
      sendJson(res, 400, { error: 'Invalid GitHub username format' });
      return;
    }
    targetUrl = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&direction=desc`;
    cacheKey = `repos:${username.toLowerCase()}`;
  } else {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  // Shared cache and request coalescing only apply when no private client token is involved
  const shareable = Boolean(cacheKey) && !clientToken;

  // Serve from memory cache if available and not using private client token
  if (shareable) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      res.writeHead(cached.status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...cached.headers,
        'x-cache': 'HIT',
      });
      res.end(cached.body);
      return;
    }
  }

  let pending = shareable ? inFlightUpstream.get(cacheKey) : undefined;

  if (!pending) {
    // Everything below spends real GitHub quota, so it is budgeted per client and globally
    const ipBudget = consumeRateLimit(`upstream:${clientIp}`, PROXY_UPSTREAM_IP_MAX, PROXY_UPSTREAM_IP_WINDOW_MS);
    if (!ipBudget.allowed) {
      sendRateLimited(res, ipBudget, 'Lookup budget exhausted for this client. Try a demo persona or retry later.');
      return;
    }
    if (!clientToken) {
      const globalBudget = consumeRateLimit('upstream:global', PROXY_UPSTREAM_GLOBAL_MAX, PROXY_UPSTREAM_GLOBAL_WINDOW_MS);
      if (!globalBudget.allowed) {
        sendRateLimited(res, globalBudget, 'Shared GitHub lookup budget exhausted. Try a demo persona or add a personal token.');
        return;
      }
    }
    if (activeUpstreamRequests >= PROXY_MAX_CONCURRENT) {
      sendJson(res, 503, { error: 'Proxy is busy. Please retry in a moment.' }, { 'Retry-After': '1' });
      return;
    }

    pending = fetchUpstream(targetUrl, authToken);
    if (shareable) {
      inFlightUpstream.set(cacheKey, pending);
      const clear = () => {
        if (inFlightUpstream.get(cacheKey) === pending) inFlightUpstream.delete(cacheKey);
      };
      pending.then(clear, clear);
    }
  }

  let upstream;
  try {
    upstream = await pending;
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      sendJson(res, 504, { error: 'Gateway Timeout: GitHub API did not respond in time' });
    } else {
      sendJson(res, 502, { error: 'Bad Gateway: Unable to communicate with upstream GitHub API' });
    }
    return;
  }

  // Cache successful responses, plus "not found" briefly so repeated typos cost no quota
  if (shareable && (upstream.status === 200 || upstream.status === 404) && !apiCache.has(cacheKey)) {
    if (apiCache.size >= API_CACHE_MAX_ENTRIES) {
      const oldest = apiCache.keys().next().value;
      if (oldest) apiCache.delete(oldest);
    }
    apiCache.set(cacheKey, {
      status: upstream.status,
      headers: upstream.headers,
      body: upstream.body,
      timestamp: Date.now(),
    });
  }

  res.writeHead(upstream.status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...upstream.headers,
    'x-cache': 'MISS',
  });
  res.end(upstream.body);
}

function isInsideDir(rootDir, candidate) {
  return candidate === rootDir || candidate.startsWith(rootDir + path.sep);
}

// Maps a decoded request path to a file strictly inside DIST_DIR, or null if it would escape
function resolveStaticPath(pathname) {
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname.split('/').includes('..')) return null;

  const candidate = path.resolve(DIST_DIR, `.${path.posix.normalize(`/${pathname}`)}`);
  return isInsideDir(DIST_DIR, candidate) ? candidate : null;
}

async function statOrNull(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  let filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  // If path is a directory or points directly to root, serve index.html
  let stats = await statOrNull(filePath);
  if (stats && stats.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stats = await statOrNull(filePath);
  }

  if (!stats || !stats.isFile()) {
    // A missing build asset must not be answered (and cached) as the HTML shell
    if (pathname.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'no-store');
      sendText(res, 404, 'Not Found');
      return;
    }
    // Otherwise SPA fallback to /index.html
    filePath = path.join(DIST_DIR, 'index.html');
  }

  // Symlinks must not lead outside the static root either
  let data;
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(DIST_DIR),
      fs.promises.realpath(filePath),
    ]);
    if (!isInsideDir(realRoot, realFile)) {
      sendText(res, 404, 'Not Found');
      return;
    }
    data = await fs.promises.readFile(realFile);
  } catch {
    sendText(res, 500, '500 Internal Server Error');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Cache headers
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length });
  res.end(req.method === 'HEAD' ? undefined : data);
}

async function handleRequest(req, res) {
  // Add security headers to all responses
  for (const [header, val] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, val);
  }

  // Cloud Run Health Check Endpoint
  if (req.url === '/health' || req.url === '/healthz') {
    sendJson(res, 200, { status: 'ok', service: 'repozyn-ai', port: PORT });
    return;
  }

  // Request targets are attacker-controlled: malformed URLs or escapes must yield 400, never throw
  let pathname;
  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  // GitHub API Proxy endpoint
  if (pathname.startsWith('/api/github/')) {
    await handleGitHubProxy(req, res, pathname);
    return;
  }

  await handleStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    // Last line of defence: a failed request must never take the process down
    console.error(`[Repozyn AI] Request handling error: ${err && err.message ? err.message : 'unknown error'}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('500 Internal Server Error');
  });
});

// Unparseable HTTP from a client gets a 400 instead of an unhandled socket error
server.on('clientError', (_err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } else {
    socket.destroy();
  }
});

server.headersTimeout = 15 * 1000;
server.requestTimeout = 30 * 1000;

server.listen(PORT, HOST, () => {
  console.log(`[Repozyn AI] Production server listening on http://${HOST}:${PORT}`);
  console.log(`[Repozyn AI] Serving static files from ${DIST_DIR}`);
});

// Graceful termination handling for Google Cloud Run
const handleShutdown = (signal) => {
  console.log(`[Repozyn AI] Received ${signal}. Gracefully shutting down...`);
  server.close(() => {
    console.log('[Repozyn AI] Server stopped cleanly.');
    process.exit(0);
  });
  // Force exit after 10s if connections linger
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
