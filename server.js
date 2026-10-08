import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
const PROXY_MAX_UPSTREAM_BYTES = envInt('PROXY_MAX_UPSTREAM_BYTES', 4 * 1024 * 1024);
// Largest README that will be read. Its size is known from the file listing before any content is requested.
const README_MAX_BYTES = envInt('PROXY_README_MAX_BYTES', 100 * 1024);
// How recent the repository's own "this is public" answer must be before the server token reads content
const REPO_VISIBILITY_MAX_AGE_MS = envInt('PROXY_REPO_VISIBILITY_MAX_AGE_MS', 60 * 1000);
// README text is kept for a shorter time than metadata
const README_CACHE_TTL_MS = 5 * 60 * 1000;

// Repository file listings are reduced to this many path entries before being cached or returned
const TREE_MAX_ENTRIES = 2000;
const TREE_MAX_PATH_LENGTH = 300;
// Third-party or generated directories. Keep in sync with IGNORED_DIRS in src/services/inspection.ts.
const IGNORED_TREE_DIRS = new Set([
  'node_modules', 'vendor', 'third_party', 'bower_components', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.venv', 'venv', 'site-packages', '__pycache__', '.git',
  '.ipynb_checkpoints', '.pytest_cache', '.mypy_cache', '.tox', 'coverage', 'Pods',
]);
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
const GITHUB_REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;
const GIT_SHA_REGEX = /^[0-9a-f]{40,64}$/;

// Optional server-side GitHub token. It is read once, kept only in this module, sent only to
// GitHub in an Authorization header, and never written to logs, responses, errors or cache keys.
const RAW_SERVER_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const SERVER_TOKEN = GITHUB_TOKEN_REGEX.test(RAW_SERVER_TOKEN) ? RAW_SERVER_TOKEN : '';
const SERVER_TOKEN_MALFORMED = RAW_SERVER_TOKEN !== '' && SERVER_TOKEN === '';
// Not needed in the environment after this point; removing it keeps it out of anything that dumps env
delete process.env.GITHUB_TOKEN;

// If GitHub rejects the server token (revoked or expired), stop sending it for a while and
// serve unauthenticated instead of failing every request.
const SERVER_TOKEN_REJECTION_COOLDOWN_MS = 10 * 60 * 1000;
let serverTokenDisabledUntil = 0;

function activeServerToken() {
  return SERVER_TOKEN && Date.now() >= serverTokenDisabledUntil ? SERVER_TOKEN : '';
}

// Chooses credentials for one request. Priority: the caller's own token, then the server token,
// then none. A caller's token is never replaced by, or mixed with, the server token.
function resolveAuth(clientToken) {
  if (clientToken) return { token: clientToken, source: 'client' };
  const serverToken = activeServerToken();
  if (serverToken) return { token: serverToken, source: 'server' };
  return { token: '', source: 'none' };
}

// What is known about the server token's reach. A classic token carrying the "repo" scope can
// read private repositories, so it is never used for repository file listings.
// null = not yet observed; [] = no classic scopes reported (fine-grained token or no scopes).
let serverTokenScopes = null;
let serverTokenProbe = null;

function recordServerTokenScopes(scopeHeader) {
  if (serverTokenScopes !== null || scopeHeader === null) return;
  serverTokenScopes = scopeHeader.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (serverTokenScopes.includes('repo')) {
    console.warn(
      '[Repozyn AI] GITHUB_TOKEN can read private repositories ("repo" scope). It will not be used for repository file listings. Replace it with a token limited to public data.'
    );
  }
}

function serverTokenCanReadPrivateRepos() {
  return Array.isArray(serverTokenScopes) && serverTokenScopes.includes('repo');
}

// Fail closed: the server token is used for repository listings and file content only once its
// reach is known and does not include private repositories. If that could not be established
// (for example the probe failed), those requests are made without credentials instead.
function serverTokenUsableForRepoContent() {
  return serverTokenScopes !== null && !serverTokenCanReadPrivateRepos();
}

// Fields of a GitHub user profile that are public and that the app uses. GitHub adds private
// fields (plan, private repository counts, two-factor status...) when a token asks about its own
// account; an allowlist keeps those from ever reaching a visitor or the shared cache.
const PUBLIC_USER_FIELDS = [
  'login', 'id', 'avatar_url', 'html_url', 'name', 'company', 'blog', 'location', 'hireable',
  'bio', 'twitter_username', 'public_repos', 'public_gists', 'followers', 'following', 'created_at', 'updated_at', 'type',
];
// Likewise for repositories: no "permissions" (which describe the token owner), no private entries.
const PUBLIC_REPO_FIELDS = [
  'id', 'name', 'full_name', 'html_url', 'description', 'fork', 'created_at', 'updated_at', 'pushed_at', 'homepage',
  'size', 'stargazers_count', 'watchers_count', 'language', 'forks_count', 'archived', 'disabled', 'open_issues_count',
  'topics', 'has_issues', 'has_projects', 'has_wiki', 'has_pages', 'default_branch', 'private', 'visibility',
];
const PUBLIC_LICENSE_FIELDS = ['key', 'name', 'spdx_id', 'url'];

function pick(source, fields) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  return out;
}

function sanitizeUserBody(body) {
  return JSON.stringify(pick(JSON.parse(body), PUBLIC_USER_FIELDS));
}

function sanitizeReposBody(body) {
  const parsed = JSON.parse(body);
  const repos = Array.isArray(parsed) ? parsed : [];
  return JSON.stringify(
    repos
      .filter((r) => r && typeof r === 'object' && r.private !== true && (r.visibility === undefined || r.visibility === 'public'))
      .map((r) => {
        const repo = pick(r, PUBLIC_REPO_FIELDS);
        if (Object.prototype.hasOwnProperty.call(r, 'license')) {
          repo.license = r.license && typeof r.license === 'object' ? pick(r.license, PUBLIC_LICENSE_FIELDS) : null;
        }
        return repo;
      })
  );
}

function sanitizeRateLimitBody(body) {
  const rate = pick(JSON.parse(body).rate, ['limit', 'remaining', 'reset', 'used']);
  return JSON.stringify({ rate });
}

// GitHub error bodies can name the authenticated account (for example "API rate limit exceeded
// for user ID ..."), so they are never forwarded. Callers only need the status code.
const GENERIC_UPSTREAM_ERRORS = {
  401: 'GitHub rejected the supplied credentials',
  403: 'GitHub refused the request or its rate limit was reached',
  404: 'Not Found',
  409: 'Repository is empty',
  429: 'GitHub rate limit reached',
};

// Conservative subset of git's branch-name rules. Anything outside it is treated as "no ref given".
// Keep in sync with isValidBranchName in src/services/github.ts and vite.config.ts.
function isValidBranchName(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return false;
  if (ref.includes('..') || ref.includes('//') || ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.startsWith('-') || ref.endsWith('.')) return false;
  return ref.split('/').every((segment) => !segment.startsWith('.') && !segment.endsWith('.lock'));
}

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

// Takes `amount` units from a window, or none at all if they do not all fit
function consumeRateLimit(key, max, windowMs, amount = 1) {
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
  if (entry.count + amount > max) {
    return { allowed: false, limit: max, resetAt: entry.resetAt };
  }
  entry.count += amount;
  return { allowed: true, limit: max, resetAt: entry.resetAt };
}

setInterval(() => sweepRateLimitWindows(Date.now()), 60 * 1000).unref();

function sendRateLimited(res, result, message, source) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  // These counters describe our budget, not GitHub's primary quota.
  sendJson(res, 429, { error: message }, {
    'Retry-After': String(retryAfterSeconds),
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(Math.ceil(result.resetAt / 1000)),
    'x-repozyn-quota-source': source,
  });
}

function getCachedResponse(cacheKey) {
  const cached = apiCache.get(cacheKey);
  if (!cached) return null;
  const ttl = cached.ttlMs || (cached.status === 200 ? API_CACHE_TTL_MS : API_NEGATIVE_CACHE_TTL_MS);
  if (Date.now() - cached.timestamp >= ttl) {
    apiCache.delete(cacheKey);
    return null;
  }
  return cached;
}

class UpstreamTooLargeError extends Error {
  constructor() {
    super('Upstream response exceeds the proxy size limit');
    this.name = 'UpstreamTooLargeError';
  }
}

// Reads the upstream body but gives up as soon as it exceeds the byte budget
async function readBodyWithLimit(upstreamRes, maxBytes) {
  const declared = parseInt(upstreamRes.headers.get('content-length') || '0', 10);
  if (declared > maxBytes) {
    await upstreamRes.body?.cancel().catch(() => {});
    throw new UpstreamTooLargeError();
  }
  if (!upstreamRes.body) return '';

  const chunks = [];
  let received = 0;
  const reader = upstreamRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UpstreamTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Reduces a GitHub git-tree response to paths, types and sizes: no SHAs or URLs, no vendored
// directories, shallowest paths first, bounded in count. Keeps responses and the cache small.
function compactTreeBody(body) {
  const parsed = JSON.parse(body);
  const source = Array.isArray(parsed.tree) ? parsed.tree : [];
  let truncated = parsed.truncated === true;

  const entries = [];
  for (const item of source) {
    if (!item || typeof item.path !== 'string' || (item.type !== 'blob' && item.type !== 'tree')) continue;
    if (item.path.length === 0 || item.path.length > TREE_MAX_PATH_LENGTH) continue;
    if (item.path.split('/').some((segment) => IGNORED_TREE_DIRS.has(segment))) continue;
    const entry = { path: item.path, type: item.type };
    if (item.type === 'blob' && typeof item.size === 'number') entry.size = item.size;
    // Git mode 120000 is a symbolic link; it is flagged so its target is never read as content
    if (item.mode === '120000') entry.symlink = true;
    entries.push(entry);
  }

  const depth = (p) => p.split('/').length;
  entries.sort((a, b) => depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (entries.length > TREE_MAX_ENTRIES) {
    entries.length = TREE_MAX_ENTRIES;
    truncated = true;
  }

  return JSON.stringify({ truncated, tree: entries });
}

async function fetchUpstream(targetUrl, auth, transform) {
  const result = await fetchUpstreamOnce(targetUrl, auth.token, transform, auth.source === 'none' ? 'anonymous' : auth.source);
  if (result.status === 401 && auth.source === 'server') {
    if (serverTokenDisabledUntil <= Date.now()) {
      console.warn('[Repozyn AI] GitHub rejected the configured GITHUB_TOKEN (401). Continuing unauthenticated; check or rotate the token.');
    }
    serverTokenDisabledUntil = Date.now() + SERVER_TOKEN_REJECTION_COOLDOWN_MS;
    return fetchUpstreamOnce(targetUrl, '', transform, 'anonymous');
  }
  return result;
}

// Only quota metadata is retained here, never response data or raw credential keys.
// One bounded cooldown per effective credential prevents retries or endpoint changes from
// ignoring GitHub's primary/secondary backoff. Anonymous traffic shares its own bucket.
const upstreamCooldowns = new Map();
let overflowCooldownUntil = 0;

function quotaAuthHeaders(authSource) {
  const repositorySource = authSource !== 'server' ? authSource
    : serverTokenScopes === null ? 'unknown'
    : serverTokenUsableForRepoContent() ? 'server' : 'anonymous';
  return { 'x-repozyn-quota-source': 'github', 'x-repozyn-auth-source': authSource, 'x-repozyn-repository-auth-source': repositorySource };
}

async function fetchUpstreamOnce(targetUrl, authToken, transform, authSource = authToken ? 'server' : 'anonymous') {
  const now = Date.now();
  const cooldownKey = authToken ? `credential:${createHash('sha256').update(authToken).digest('hex')}` : 'anonymous';
  const cooldown = upstreamCooldowns.get(cooldownKey);
  if (cooldown && cooldown.until <= now) upstreamCooldowns.delete(cooldownKey);
  if (cooldown && cooldown.until > now) {
    return { status: 429, body: JSON.stringify({ message: 'GitHub requests paused until the retry time' }), headers: { ...cooldown.headers, ...quotaAuthHeaders(authSource), 'Retry-After': String(Math.ceil((cooldown.until - now) / 1000)) } };
  }
  if (overflowCooldownUntil > now) {
    return { status: 503, body: JSON.stringify({ message: 'Proxy is busy. Retry later.' }), headers: { 'x-repozyn-quota-source': 'proxy-concurrency', 'Retry-After': String(Math.ceil((overflowCooldownUntil - now) / 1000)) } };
  }
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
    let body = await readBodyWithLimit(upstreamRes, PROXY_MAX_UPSTREAM_BYTES);
    if (authToken && authToken === SERVER_TOKEN && upstreamRes.ok) {
      recordServerTokenScopes(upstreamRes.headers.get('x-oauth-scopes'));
    }
    const headers = { ...quotaAuthHeaders(authSource), 'x-repozyn-observed-at': String(Date.now()) };
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used', 'x-ratelimit-resource', 'retry-after']) {
      const val = upstreamRes.headers.get(h);
      if (val) headers[h] = val;
    }
    if (upstreamRes.status === 403 || upstreamRes.status === 429) {
      let message = '';
      try { message = String(JSON.parse(body).message || ''); } catch { /* Error bodies are never forwarded. */ }
      const primary = upstreamRes.headers.get('x-ratelimit-remaining') === '0';
      const secondary = upstreamRes.status === 429 || upstreamRes.headers.has('retry-after') || /secondary rate limit|abuse detection/i.test(message);
      headers['x-repozyn-limit-kind'] = primary ? 'primary' : secondary ? 'secondary' : 'permission';
      if (primary || secondary) {
        const retry = Number(upstreamRes.headers.get('retry-after'));
        const reset = Number(upstreamRes.headers.get('x-ratelimit-reset')) * 1000;
        const seconds = Math.max(Number.isFinite(retry) && retry > 0 ? retry : primary && reset > Date.now() ? 0 : 60, primary && reset > Date.now() ? Math.ceil((reset - Date.now()) / 1000) : 0);
        headers['retry-after'] = String(Math.ceil(seconds));
        const until = Date.now() + seconds * 1000;
        for (const [key, entry] of upstreamCooldowns) if (entry.until <= Date.now()) upstreamCooldowns.delete(key);
        if (upstreamCooldowns.has(cooldownKey) || upstreamCooldowns.size < RATE_LIMIT_MAX_KEYS) upstreamCooldowns.set(cooldownKey, { until, headers });
        else overflowCooldownUntil = Math.max(overflowCooldownUntil, until);
      }
    }
    if (upstreamRes.status === 200) {
      // Every successful body passes through an allowlisting transform; nothing is relayed verbatim
      body = transform(body);
    } else {
      body = JSON.stringify({ message: GENERIC_UPSTREAM_ERRORS[upstreamRes.status] || 'GitHub request failed' });
    }

    return { status: upstreamRes.status, headers, body };
  } finally {
    activeUpstreamRequests -= 1;
  }
}

// Fetches a repository's file listing for one branch using only fixed GitHub API paths:
//  - plain branch name:      git/trees/<branch>
//  - branch with slashes:    git/ref/heads/<branch> -> commit SHA -> git/trees/<sha>
//    (a slash inside the tree path segment is ambiguous, so the name is resolved to a SHA first)
//  - no usable branch name:  git/trees/HEAD as a last resort
async function fetchRepoTreeUpstream(repoApiBase, branch, auth) {
  let treeish = 'HEAD';
  if (branch) {
    if (!branch.includes('/')) {
      treeish = encodeURIComponent(branch);
    } else {
      const refPath = branch.split('/').map(encodeURIComponent).join('/');
      const refRes = await fetchUpstream(`${repoApiBase}/git/ref/heads/${refPath}`, auth, pickRefSha);
      if (refRes.status !== 200) return refRes;

      let sha = '';
      try {
        sha = JSON.parse(refRes.body).object.sha;
      } catch {
        sha = '';
      }
      if (!GIT_SHA_REGEX.test(sha)) {
        return { status: 502, headers: refRes.headers, body: JSON.stringify({ error: 'Unexpected branch reference response' }) };
      }
      treeish = sha;
    }
  }
  return fetchUpstream(`${repoApiBase}/git/trees/${treeish}?recursive=1`, auth, compactTreeBody);
}

function publicReposUrl(owner) {
  return `${GITHUB_API_BASE}/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated&direction=desc`;
}

function storeCachedResponse(cacheKey, upstream, replace = false, ttlMs = 0) {
  if (upstream.status !== 200 && upstream.status !== 404) return;
  if (apiCache.has(cacheKey)) {
    if (!replace) return;
    apiCache.delete(cacheKey);
  }
  if (apiCache.size >= API_CACHE_MAX_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest) apiCache.delete(oldest);
  }
  const entry = { status: upstream.status, headers: upstream.headers, body: upstream.body, timestamp: Date.now() };
  if (ttlMs > 0) entry.ttlMs = ttlMs;
  apiCache.set(cacheKey, entry);
}

// Keeps only the commit SHA of a git ref lookup
function pickRefSha(body) {
  const parsed = JSON.parse(body);
  const sha = parsed && parsed.object && typeof parsed.object.sha === 'string' ? parsed.object.sha : '';
  return JSON.stringify({ object: { sha } });
}

// Learns the server token's classic scopes with one request that does not count against the
// GitHub quota. Runs at most once successfully; failures leave the scopes unknown.
async function probeServerToken() {
  if (serverTokenScopes !== null || !activeServerToken()) return;
  if (!serverTokenProbe) {
    serverTokenProbe = fetchUpstreamOnce(`${GITHUB_API_BASE}/rate_limit`, SERVER_TOKEN, sanitizeRateLimitBody)
      .then((res) => {
        if (res.status === 401) serverTokenDisabledUntil = Date.now() + SERVER_TOKEN_REJECTION_COOLDOWN_MS;
        // A token that answers without reporting classic scopes is treated as having none
        else if (res.status === 200 && serverTokenScopes === null) serverTokenScopes = [];
        return res;
      })
      .catch(() => {})
      .finally(() => {
        serverTokenProbe = null;
      });
  }
  return await serverTokenProbe;
}

function probeWasThrottled(result) {
  return result && ['primary', 'secondary'].includes(result.headers?.['x-repozyn-limit-kind']);
}

// The public-list check must be recent: a repository made private should stop being readable quickly
const PUBLIC_LIST_MAX_AGE_MS = envInt('PROXY_PUBLIC_LIST_MAX_AGE_MS', 2 * 60 * 1000);

function freshPublicList(owner) {
  const listing = getCachedResponse(`repos:${owner.toLowerCase()}`);
  return listing && Date.now() - listing.timestamp <= PUBLIC_LIST_MAX_AGE_MS ? listing : null;
}

// The server token may be able to see more than the public can (for example the deployer's
// private repositories). Before it is used to read a repository's file listing on behalf of an
// anonymous visitor, the repository must be explicitly marked public ("private": false) in a
// recent copy of the owner's PUBLIC repository list.
// Returns null when the repository is public, otherwise the response to send instead.
async function refuseUnlessPublicRepo(owner, repo, auth) {
  const listKey = `repos:${owner.toLowerCase()}`;
  let listing = freshPublicList(owner);
  if (!listing) {
    let pending = inFlightUpstream.get(listKey);
    if (!pending) {
      pending = fetchUpstream(publicReposUrl(owner), auth, sanitizeReposBody);
      inFlightUpstream.set(listKey, pending);
      const clear = () => {
        if (inFlightUpstream.get(listKey) === pending) inFlightUpstream.delete(listKey);
      };
      pending.then(clear, clear);
    }
    listing = await pending;
    storeCachedResponse(listKey, listing, true);
  }

  const notFound = { status: 404, headers: listing.headers || {}, body: JSON.stringify({ message: 'Not Found' }) };
  if (listing.status === 404) return notFound;
  if (listing.status !== 200) return { status: listing.status, headers: listing.headers || {}, body: listing.body };

  try {
    const repos = JSON.parse(listing.body);
    const wanted = repo.toLowerCase();
    const isPublic =
      Array.isArray(repos) &&
      repos.some(
        (r) =>
          r &&
          typeof r.name === 'string' &&
          r.name.toLowerCase() === wanted &&
          r.private === false &&
          (r.visibility === undefined || r.visibility === 'public')
      );
    return isPublic ? null : notFound;
  } catch {
    return notFound;
  }
}

// ---- README content (the only file content this proxy ever reads) --------------------------

const README_NAME_REGEX = /^readme([._-][a-z0-9_-]+)*$/;
const README_EXTENSIONS = new Set(['', 'md', 'mdx', 'markdown', 'rst', 'txt', 'adoc', 'asciidoc', 'org', 'rdoc', 'pod', 'textile']);

// A path is acceptable only if it is a README-named document at most three levels deep, made of
// plain path segments. This is what keeps the route from becoming a general file reader.
// Keep in sync with isReadmePath in src/services/readmeAnalysis.ts and vite.config.ts.
function isSafeReadmePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 200) return false;
  const segments = filePath.split('/');
  if (segments.length > 3) return false;
  for (const segment of segments) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(segment) || segment === '.' || segment === '..') return false;
  }
  const base = segments[segments.length - 1].toLowerCase();
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  return README_NAME_REGEX.test(base) && README_EXTENSIONS.has(ext);
}

function sanitizeRepoVisibilityBody(body) {
  return JSON.stringify(pick(JSON.parse(body), ['full_name', 'private', 'visibility']));
}

const UPSTREAM_NOT_FOUND = { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) };

// Asks GitHub about this exact repository and requires an explicit, recent "public" answer under
// the same owner and name. A repository that was made private, renamed or transferred fails this
// (redirects are refused), so the server token never reads content it should not show a visitor.
// Returns null when confirmed public, otherwise the response to send instead.
async function refuseUnlessConfirmedPublic(owner, repo, auth) {
  const key = `visibility:${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let meta = getCachedResponse(key);
  if (meta && Date.now() - meta.timestamp > REPO_VISIBILITY_MAX_AGE_MS) meta = null;
  if (!meta) {
    meta = await fetchUpstream(`${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, auth, sanitizeRepoVisibilityBody);
    storeCachedResponse(key, meta, true);
  }
  if (meta.status === 404) return UPSTREAM_NOT_FOUND;
  if (meta.status !== 200) return { status: meta.status, headers: meta.headers || {}, body: meta.body };

  try {
    const info = JSON.parse(meta.body);
    const sameRepo = typeof info.full_name === 'string' && info.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase();
    const isPublic = info.private === false && (info.visibility === undefined || info.visibility === 'public');
    return sameRepo && isPublic ? null : UPSTREAM_NOT_FOUND;
  } catch {
    return UPSTREAM_NOT_FOUND;
  }
}

function hasFreshVisibility(owner, repo) {
  const meta = getCachedResponse(`visibility:${owner.toLowerCase()}/${repo.toLowerCase()}`);
  return Boolean(meta && Date.now() - meta.timestamp <= REPO_VISIBILITY_MAX_AGE_MS);
}

// Decodes README bytes as text, or returns null when the file is not text.
// Handles UTF-8 (with or without BOM) and UTF-16 with a BOM; anything containing NUL bytes or
// many undecodable sequences is treated as binary.
function decodeReadmeBytes(buffer) {
  let text;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(buffer.subarray(2));
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    text = new TextDecoder('utf-16be').decode(buffer.subarray(2));
  } else {
    text = new TextDecoder('utf-8').decode(buffer);
  }
  if (text.includes('\u0000')) return null;
  let undecodable = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) undecodable++;
  if (text.length > 0 && undecodable / text.length > 0.02) return null;
  return text;
}

// Turns a GitHub "contents" response into { path, size, text }, or a marker describing why the
// file is refused. Nothing from the upstream body is relayed other than the decoded text.
function makeReadmeTransform(owner, repo, filePath) {
  return (body) => {
    const parsed = JSON.parse(body);
    const refuse = (reason) => JSON.stringify({ refused: reason });

    // A directory listing (array), a symlink, a submodule or anything else is not a README file
    if (!parsed || Array.isArray(parsed) || parsed.type !== 'file') return refuse('not_a_file');
    if (typeof parsed.path !== 'string' || parsed.path !== filePath) return refuse('path_mismatch');
    const expectedPrefix = `https://github.com/${owner}/${repo}/`.toLowerCase();
    if (typeof parsed.html_url !== 'string' || !parsed.html_url.toLowerCase().startsWith(expectedPrefix)) return refuse('repository_mismatch');
    if (typeof parsed.size !== 'number' || parsed.size > README_MAX_BYTES) return refuse('too_large');
    if (parsed.encoding !== 'base64' || typeof parsed.content !== 'string') return refuse('unsupported_encoding');

    const bytes = Buffer.from(parsed.content, 'base64');
    if (bytes.length > README_MAX_BYTES) return refuse('too_large');
    const text = decodeReadmeBytes(bytes);
    if (text === null) return refuse('binary');

    return JSON.stringify({ path: filePath, size: bytes.length, text });
  };
}

const README_REFUSALS = {
  too_large: { status: 413, message: 'README is larger than the size limit' },
  binary: { status: 415, message: 'README is not a text file' },
  unsupported_encoding: { status: 415, message: 'README is not a text file' },
  not_a_file: { status: 404, message: 'Not Found' },
  path_mismatch: { status: 404, message: 'Not Found' },
  repository_mismatch: { status: 404, message: 'Not Found' },
};

// Reads one README. Order matters: visibility first, then the file must exist in the validated
// file listing as a regular file within the size limit, and only then is its content requested.
async function fetchReadme(owner, repo, branch, filePath, requestAuth, shareable, cacheKey) {
  let auth = requestAuth;
  if (auth.source !== 'client') {
    const probe = await probeServerToken();
    if (probeWasThrottled(probe)) return probe;
    auth = resolveAuth('');
    if (auth.source === 'server' && !serverTokenUsableForRepoContent()) auth = { token: '', source: 'none' };
    if (auth.source === 'server') {
      const refusal = await refuseUnlessConfirmedPublic(owner, repo, auth);
      if (refusal) return refusal;
    }
  }

  // Visibility has just been confirmed (or GitHub enforces it itself), so cached text may be reused
  if (shareable) {
    const cachedText = getCachedResponse(cacheKey);
    if (cachedText) return cachedText;
  }

  const repoApiBase = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const treeKey = `tree:${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}`;
  let tree = shareable ? getCachedResponse(treeKey) : null;
  if (!tree) {
    tree = await fetchRepoTreeUpstream(repoApiBase, branch, auth);
    if (shareable) storeCachedResponse(treeKey, tree);
  }
  if (tree.status !== 200) return { status: tree.status, headers: tree.headers || {}, body: tree.body };

  let entry;
  try {
    entry = JSON.parse(tree.body).tree.find((item) => item.path === filePath);
  } catch {
    entry = undefined;
  }
  const refused = (reason, headers = {}) => ({ status: README_REFUSALS[reason].status, headers, body: JSON.stringify({ message: README_REFUSALS[reason].message }) });
  if (!entry || entry.type !== 'blob') return UPSTREAM_NOT_FOUND;
  if (entry.symlink === true) return refused('not_a_file');
  if (typeof entry.size !== 'number' || entry.size > README_MAX_BYTES) return refused('too_large');

  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const content = await fetchUpstream(`${repoApiBase}/contents/${encodedPath}${refQuery}`, auth, makeReadmeTransform(owner, repo, filePath));
  if (content.status !== 200) return content;

  const result = JSON.parse(content.body);
  if (result.refused) return refused(result.refused, content.headers);
  return content;
}

// File listing for a visitor without their own token. The server token is used only when it
// cannot read private repositories and the repository is confirmed public; otherwise the
// request is made without credentials, where GitHub itself only serves public data.
async function fetchTreeForAnonymousVisitor(owner, repo, repoApiBase, branch, cacheKey) {
  const probe = await probeServerToken();
  if (probeWasThrottled(probe)) return probe;
  const auth = resolveAuth('');
  if (auth.source !== 'server' || !serverTokenUsableForRepoContent()) {
    return getCachedResponse(cacheKey) || fetchRepoTreeUpstream(repoApiBase, branch, { token: '', source: 'none' });
  }
  const refusal = await refuseUnlessPublicRepo(owner, repo, auth);
  if (refusal) return refusal;
  // Visibility has just been confirmed, so a cached listing may be reused
  return getCachedResponse(cacheKey) || fetchRepoTreeUpstream(repoApiBase, branch, auth);
}

async function handleGitHubProxy(req, res, pathname, searchParams) {
  // Proxy answers depend on the credentials sent with the request, so no browser or intermediary
  // may store them or reuse one visitor's answer for another. The proxy does its own caching.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'x-github-token');

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET' });
    return;
  }

  const clientIp = getClientIp(req);
  const requestLimit = consumeRateLimit(`req:${clientIp}`, PROXY_RATE_LIMIT_MAX, PROXY_RATE_LIMIT_WINDOW_MS);
  if (!requestLimit.allowed) {
    sendRateLimited(res, requestLimit, 'Too many requests. Please slow down and retry shortly.', 'proxy-request');
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
  const auth = resolveAuth(clientToken);

  let targetUrl = '';
  let cacheKey = '';
  // How many GitHub requests this lookup can spend, and how to perform it
  let upstreamCost = 1;
  let cacheTtlMs = 0;
  // Set when a cached answer may only be served after a visibility re-check
  let cacheNeedsVisibilityCheck = false;
  let transform = sanitizeRateLimitBody;
  let runUpstream = () => fetchUpstream(targetUrl, auth, transform);

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
    transform = sanitizeUserBody;
  } else if (pathname.startsWith('/api/github/repos/')) {
    const username = pathname.replace('/api/github/repos/', '').trim();
    if (!GITHUB_USERNAME_REGEX.test(username)) {
      sendJson(res, 400, { error: 'Invalid GitHub username format' });
      return;
    }
    targetUrl = publicReposUrl(username);
    cacheKey = `repos:${username.toLowerCase()}`;
    transform = sanitizeReposBody;
  } else if (pathname.startsWith('/api/github/tree/')) {
    // File listing of one branch of a repository. Host and path shape are fixed here; only a
    // validated owner, repository name and (optionally) branch name come from the client.
    const parts = pathname.replace('/api/github/tree/', '').split('/');
    const [owner, repo] = parts;
    if (
      parts.length !== 2 ||
      !GITHUB_USERNAME_REGEX.test(owner) ||
      !GITHUB_REPO_NAME_REGEX.test(repo) ||
      repo === '.' ||
      repo === '..'
    ) {
      sendJson(res, 400, { error: 'Invalid repository identifier' });
      return;
    }
    const rawRef = searchParams.get('ref');
    if (rawRef !== null && !isValidBranchName(rawRef)) {
      sendJson(res, 400, { error: 'Invalid branch name' });
      return;
    }
    const branch = rawRef || '';
    const repoApiBase = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    cacheKey = `tree:${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}`;
    upstreamCost = branch.includes('/') ? 2 : 1;
    if (auth.source === 'client') {
      // The caller's own token, for the caller's own eyes: never cached or shared
      runUpstream = () => fetchRepoTreeUpstream(repoApiBase, branch, auth);
    } else {
      // One more request when a recent copy of the owner's public repository list is not at hand
      if (auth.source === 'server' && !serverTokenCanReadPrivateRepos() && !freshPublicList(owner)) upstreamCost += 1;
      // On the server token a cached listing is only served while the public confirmation is fresh
      cacheNeedsVisibilityCheck = auth.source === 'server' && !serverTokenCanReadPrivateRepos() && !freshPublicList(owner);
      if (cacheNeedsVisibilityCheck && getCachedResponse(cacheKey)) upstreamCost = 1;
      const treeCacheKey = cacheKey;
      runUpstream = () => fetchTreeForAnonymousVisitor(owner, repo, repoApiBase, branch, treeCacheKey);
    }
  } else if (pathname.startsWith('/api/github/readme/')) {
    // Text of one README file. Only a validated owner, repository, branch and README path are
    // accepted; the path must also exist in the repository's file listing (checked in fetchReadme).
    const parts = pathname.replace('/api/github/readme/', '').split('/');
    const [owner, repo] = parts;
    if (parts.length !== 2 || !GITHUB_USERNAME_REGEX.test(owner) || !GITHUB_REPO_NAME_REGEX.test(repo) || repo === '.' || repo === '..') {
      sendJson(res, 400, { error: 'Invalid repository identifier' });
      return;
    }
    const rawRef = searchParams.get('ref');
    if (rawRef !== null && !isValidBranchName(rawRef)) {
      sendJson(res, 400, { error: 'Invalid branch name' });
      return;
    }
    const filePath = searchParams.get('path') || '';
    if (!isSafeReadmePath(filePath)) {
      sendJson(res, 400, { error: 'Only README files can be read' });
      return;
    }
    const branch = rawRef || '';
    cacheKey = `readme:${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}:${filePath}`;
    const shareableRead = !clientToken;
    upstreamCost = 1;
    if (!(shareableRead && getCachedResponse(`tree:${owner.toLowerCase()}/${repo.toLowerCase()}@${branch}`))) upstreamCost += branch.includes('/') ? 2 : 1;
    if (auth.source === 'server' && !serverTokenCanReadPrivateRepos() && !hasFreshVisibility(owner, repo)) upstreamCost += 1;
    cacheTtlMs = README_CACHE_TTL_MS;
    // On the server token, cached README text is only served while the "public" answer is fresh
    cacheNeedsVisibilityCheck = auth.source === 'server' && !serverTokenCanReadPrivateRepos() && !hasFreshVisibility(owner, repo);
    if (cacheNeedsVisibilityCheck && getCachedResponse(cacheKey)) upstreamCost = 1;
    const readmeCacheKey = cacheKey;
    runUpstream = () => fetchReadme(owner, repo, branch, filePath, auth, shareableRead, readmeCacheKey);
  } else {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  // Shared cache and request coalescing only apply when no private client token is involved
  const shareable = Boolean(cacheKey) && !clientToken;

  // Serve from memory cache if available and not using private client token
  if (shareable && !cacheNeedsVisibilityCheck) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      res.writeHead(cached.status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...cached.headers,
        'x-cache': 'HIT',
        'x-repozyn-quota-cached': '1',
      });
      res.end(cached.body);
      return;
    }
  }

  let pending = shareable ? inFlightUpstream.get(cacheKey) : undefined;

  if (!pending) {
    // Everything below spends real GitHub quota, so it is budgeted per client and globally
    // A lookup that needs several requests is charged in full or not at all
    const ipBudget = consumeRateLimit(`upstream:${clientIp}`, PROXY_UPSTREAM_IP_MAX, PROXY_UPSTREAM_IP_WINDOW_MS, upstreamCost);
    if (!ipBudget.allowed) {
      sendRateLimited(res, ipBudget, 'Lookup budget exhausted for this client. Try a demo persona or retry later.', 'proxy-ip');
      return;
    }
    if (!clientToken) {
      const globalBudget = consumeRateLimit('upstream:global', PROXY_UPSTREAM_GLOBAL_MAX, PROXY_UPSTREAM_GLOBAL_WINDOW_MS, upstreamCost);
      if (!globalBudget.allowed) {
        sendRateLimited(res, globalBudget, 'Shared lookup budget exhausted. Try a demo persona or retry later.', 'proxy-global');
        return;
      }
    }
    if (activeUpstreamRequests >= PROXY_MAX_CONCURRENT) {
      sendJson(res, 503, { error: 'Proxy is busy. Please retry in a moment.' }, { 'Retry-After': '1', 'x-repozyn-quota-source': 'proxy-concurrency' });
      return;
    }

    pending = runUpstream();
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
    if (err && err.name === 'UpstreamTooLargeError') {
      sendJson(res, 413, { error: 'Upstream response is too large to process' });
    } else if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      sendJson(res, 504, { error: 'Gateway Timeout: GitHub API did not respond in time' });
    } else {
      sendJson(res, 502, { error: 'Bad Gateway: Unable to communicate with upstream GitHub API' });
    }
    return;
  }

  // Cache successful responses, plus "not found" briefly so repeated typos cost no quota.
  // Responses obtained with a caller's own token never enter this shared cache.
  if (shareable) storeCachedResponse(cacheKey, upstream, false, cacheTtlMs);

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
  let searchParams;
  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    pathname = decodeURIComponent(parsedUrl.pathname);
    searchParams = parsedUrl.searchParams;
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  // GitHub API Proxy endpoint
  if (pathname.startsWith('/api/github/')) {
    await handleGitHubProxy(req, res, pathname, searchParams);
    return;
  }

  await handleStatic(req, res, pathname);
}

// The same proxy code serves production and the Vite dev server. Returns false when the request
// is not for the GitHub proxy, so the caller can handle it.
export async function handleGitHubApiRequest(req, res) {
  let pathname;
  let searchParams;
  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    pathname = decodeURIComponent(parsedUrl.pathname);
    searchParams = parsedUrl.searchParams;
  } catch {
    return false;
  }
  if (!pathname.startsWith('/api/github/')) return false;

  for (const [header, val] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, val);
  }
  await handleGitHubProxy(req, res, pathname, searchParams);
  return true;
}

function startServer() {
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
    if (SERVER_TOKEN_MALFORMED) {
      console.warn('[Repozyn AI] GITHUB_TOKEN is set but is not a valid token format; it is being ignored.');
    }
    console.log(`[Repozyn AI] GitHub API authentication: ${SERVER_TOKEN ? 'server token configured' : 'unauthenticated (no server token)'}`);
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
}

// Start listening only when this file is the program being run (node server.js), not when it is
// imported for its request handler.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
