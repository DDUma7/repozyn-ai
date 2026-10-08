import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
const DIST_DIR = path.join(__dirname, 'dist');

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
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

async function handleGitHubProxy(req, res, pathname) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-github-token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  // Token priority: Client header > Server environment variable (never leaked to browser)
  const clientToken = req.headers['x-github-token'];
  const serverToken = process.env.GITHUB_TOKEN;
  const authToken = clientToken || serverToken;

  let targetUrl = '';
  let cacheKey = '';

  if (pathname === '/api/github/rate_limit') {
    targetUrl = 'https://api.github.com/rate_limit';
  } else if (pathname.startsWith('/api/github/user/')) {
    const username = pathname.replace('/api/github/user/', '').trim();
    if (!GITHUB_USERNAME_REGEX.test(username)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid GitHub username format' }));
      return;
    }
    targetUrl = `https://api.github.com/users/${encodeURIComponent(username)}`;
    cacheKey = `user:${username.toLowerCase()}`;
  } else if (pathname.startsWith('/api/github/repos/')) {
    const username = pathname.replace('/api/github/repos/', '').trim();
    if (!GITHUB_USERNAME_REGEX.test(username)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid GitHub username format' }));
      return;
    }
    targetUrl = `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&direction=desc`;
    cacheKey = `repos:${username.toLowerCase()}`;
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  // Serve from memory cache if available and not using private client token
  if (cacheKey && !clientToken) {
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < API_CACHE_TTL_MS) {
      res.setHeader('x-cache', 'HIT');
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v);
      }
      res.writeHead(cached.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(cached.body);
      return;
    }
  }

  try {
    const upstreamHeaders = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Repozyn-AI-CloudRun-Proxy',
    };
    if (authToken && String(authToken).trim()) {
      upstreamHeaders.Authorization = `Bearer ${String(authToken).trim()}`;
    }

    const upstreamRes = await fetch(targetUrl, { headers: upstreamHeaders });
    const body = await upstreamRes.text();

    const forwardHeaders = {};
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used']) {
      const val = upstreamRes.headers.get(h);
      if (val) {
        res.setHeader(h, val);
        forwardHeaders[h] = val;
      }
    }
    res.setHeader('x-cache', 'MISS');

    // Cache successful responses
    if (cacheKey && upstreamRes.status === 200 && !clientToken) {
      if (apiCache.size > 200) {
        const oldest = apiCache.keys().next().value;
        if (oldest) apiCache.delete(oldest);
      }
      apiCache.set(cacheKey, {
        status: upstreamRes.status,
        headers: forwardHeaders,
        body,
        timestamp: Date.now(),
      });
    }

    res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway: Unable to communicate with upstream GitHub API' }));
  }
}

const server = http.createServer(async (req, res) => {
  // Add security headers to all responses
  for (const [header, val] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, val);
  }

  // Cloud Run Health Check Endpoint
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'repozyn-ai', port: PORT }));
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // GitHub API Proxy endpoint
  if (pathname.startsWith('/api/github/')) {
    await handleGitHubProxy(req, res, pathname);
    return;
  }

  // Sanitize against directory traversal
  if (pathname.includes('\0')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  let filePath = path.join(DIST_DIR, pathname);

  // If path is a directory or points directly to root, serve index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // If file doesn't exist, SPA fallback to /index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Cache headers
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

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
