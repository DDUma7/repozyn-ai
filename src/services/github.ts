import type { GitHubUser, GitHubRepo, GitHubEvent, RateLimitInfo } from '../types/github';
import type { ReadmeFetchResult, RepoTree, RepoTreeResult } from '../types/evidence';
import { normalizeRepoTree } from './inspection';
import { isReadmePath, README_LIMITS } from './readmeAnalysis';
import { quotaMessage } from '../utils/quota';

const GITHUB_API_BASE = 'https://api.github.com';
const LOCAL_PROXY_BASE = '/api/github';

export interface GitHubApiResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
  source?: 'proxy' | 'direct' | 'cache';
}

export class GitHubApiError extends Error {
  status: number;
  rateLimit?: RateLimitInfo;
  resetDate?: Date;
  isRateLimit: boolean;
  resetMinutes?: number;
  resetTimeFormatted?: string;

  constructor(message: string, status: number, rateLimit?: RateLimitInfo, isRateLimit = false) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.rateLimit = rateLimit;
    this.isRateLimit = isRateLimit || (status === 403 && rateLimit?.limitKind !== 'permission');
    if (rateLimit?.reset) {
      this.resetDate = new Date(rateLimit.reset * 1000);
      this.resetMinutes = rateLimit.resetMinutes;
      this.resetTimeFormatted = rateLimit.resetTimeFormatted;
    }
  }
}

export function formatResetTime(resetUnixSeconds: number): string {
  if (!resetUnixSeconds) return '';
  const date = new Date(resetUnixSeconds * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const number = (name: string) => {
    const raw = headers.get(name);
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const limit = number('x-ratelimit-limit');
  const remaining = number('x-ratelimit-remaining');
  const reset = number('x-ratelimit-reset') || 0;
  const cached = headers.get('x-repozyn-quota-cached') === '1' || headers.get('x-cache') === 'HIT';
  const declaredSource = headers.get('x-repozyn-quota-source');
  const sources = ['github', 'proxy-request', 'proxy-ip', 'proxy-global', 'proxy-concurrency', 'unknown'];
  const source = (declaredSource && sources.includes(declaredSource) ? declaredSource : limit !== null && remaining !== null ? 'github' : 'unknown') as RateLimitInfo['source'];
  const auth = headers.get('x-repozyn-auth-source');
  const repoAuth = headers.get('x-repozyn-repository-auth-source');
  const kind = headers.get('x-repozyn-limit-kind');
  const retry = number('retry-after');
  return {
    limit: limit || 0, remaining: remaining ?? 0, used: number('x-ratelimit-used') || 0, reset,
    resetMinutes: reset ? Math.max(0, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0,
    resetTimeFormatted: reset ? formatResetTime(reset) : '',
    source, known: limit !== null && limit > 0 && remaining !== null && remaining <= limit && !cached,
    cached,
    authSource: auth && ['server', 'client', 'anonymous'].includes(auth) ? auth as RateLimitInfo['authSource'] : undefined,
    repositoryAuthSource: repoAuth && ['server', 'client', 'anonymous', 'unknown'].includes(repoAuth) ? repoAuth as RateLimitInfo['repositoryAuthSource'] : undefined,
    limitKind: kind && ['primary', 'secondary', 'permission'].includes(kind) ? kind as RateLimitInfo['limitKind'] : undefined,
    observedAt: number('x-repozyn-observed-at') || Date.now(),
    retryAt: retry !== null && retry > 0 ? Date.now() + retry * 1000 : undefined,
  };
}

async function quotaError(response: Response): Promise<GitHubApiError> {
  const info = parseRateLimitHeaders(response.headers);
  if (!info.limitKind && (response.status === 403 || response.status === 429)) {
    let message = '';
    try { message = String((await response.json()).message || ''); } catch { /* Never echo upstream errors. */ }
    info.limitKind = info.known && info.remaining === 0 ? 'primary'
      : response.status === 429 || info.retryAt || /secondary rate limit|abuse detection/i.test(message) ? 'secondary' : 'permission';
    if (info.limitKind === 'secondary' && !info.retryAt) info.retryAt = Date.now() + 60_000;
  }
  return new GitHubApiError(quotaMessage(info), response.status, info, response.status === 429 || info.limitKind === 'primary' || info.limitKind === 'secondary');
}

// ---- Credential scope -----------------------------------------------------------------------
//
// Everything fetched is tied to the credentials in force when the request STARTED. The token
// itself is never part of a cache key: a counter ("epoch") that changes whenever the credentials
// change is used instead. When the credentials change, every cache is emptied, outstanding
// requests are aborted, and anything that still finishes under the old credentials is discarded
// instead of being cached or returned.

/** How long a single request may take before it is abandoned */
export const REQUEST_TIMEOUT_MS = 15_000;

let activeToken = '';
let authEpoch = 0;
const activeControllers = new Set<AbortController>();

interface CredentialScope {
  epoch: number;
  /** Cache-key suffix. Contains no credential material. */
  key: string;
  /** Only responses fetched without a personal token may be written to sessionStorage */
  persist: boolean;
}

/**
 * Declares which personal token (if any) is now in use. Changing it invalidates every
 * credential-dependent cache and cancels requests still in flight.
 */
export function setGitHubAuthContext(token: string | null | undefined): void {
  const next = (token || '').trim();
  if (next === activeToken) return;
  activeToken = next;
  authEpoch += 1;

  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
  purgeCaches();
}

/** A number that changes whenever the credentials change. Safe to use in React keys. */
export function getGitHubAuthEpoch(): number {
  return authEpoch;
}

function scopeFor(token: string | null | undefined): CredentialScope {
  // A request made with a different token IS a credential change, whoever forgot to announce it
  setGitHubAuthContext(token);
  return { epoch: authEpoch, key: `c${authEpoch}`, persist: activeToken === '' };
}

const isCurrent = (scope: CredentialScope) => scope.epoch === authEpoch;

class StaleCredentialsError extends Error {
  constructor() {
    super('The request was cancelled because the GitHub credentials changed.');
    this.name = 'StaleCredentialsError';
  }
}

/** fetch with a timeout, cancelled automatically if the credentials change while it is pending */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

// In-memory cache + sessionStorage persistence (15 minutes TTL)
const responseCache = new Map<string, { data: any; rateLimit: RateLimitInfo; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// In-flight request deduplication map to prevent multiple identical requests
const inFlightRequests = new Map<string, Promise<any>>();

function getCached<T>(key: string): { data: T; rateLimit: RateLimitInfo } | null {
  // Check memory cache first
  const mem = responseCache.get(key);
  if (mem && Date.now() - mem.timestamp < CACHE_TTL_MS) {
    return { data: mem.data, rateLimit: mem.rateLimit };
  }

  // Check sessionStorage
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(`repozyn_cache:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          responseCache.set(key, parsed);
          return { data: parsed.data, rateLimit: parsed.rateLimit };
        } else {
          sessionStorage.removeItem(`repozyn_cache:${key}`);
        }
      }
    }
  } catch {
    // SessionStorage may fail in private mode or non-browser environments
  }

  return null;
}

function setCache<T>(key: string, data: T, rateLimit: RateLimitInfo, scope: CredentialScope, persist = true) {
  // A response that finished after the credentials changed must not repopulate the cache
  if (!isCurrent(scope)) return;
  const entry = { data, rateLimit, timestamp: Date.now() };
  responseCache.set(key, entry);
  // Data fetched with a personal token stays in memory only
  if (!persist || !scope.persist) return;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`repozyn_cache:${key}`, JSON.stringify(entry));
    }
  } catch {
    // Ignore quota or disabled storage
  }
}

/**
 * Resets the in-memory and session cache (primarily used in tests)
 */
export function clearApiCache() {
  activeToken = '';
  purgeCaches();
}

function purgeCaches() {
  lastObservedRateLimit = null;
  responseCache.clear();
  inFlightRequests.clear();
  try {
    if (typeof sessionStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('repozyn_cache:')) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => sessionStorage.removeItem(k));
    }
  } catch {
    // Ignore
  }
}

async function fetchWithFallback<T>(
  proxyPath: string,
  directPath: string,
  token: string | undefined,
  scope: CredentialScope
): Promise<{ data: T; rateLimit: RateLimitInfo; source: 'proxy' | 'direct' }> {
  // 1. Attempt backend proxy (Cloud Run / Vite Dev Server)
  try {
    const proxyHeaders: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token && token.trim()) {
      proxyHeaders['x-github-token'] = token.trim();
    }

    const proxyRes = await apiFetch(`${LOCAL_PROXY_BASE}${proxyPath}`, {
      headers: proxyHeaders,
    });
    if (!isCurrent(scope)) throw new StaleCredentialsError();

    if (proxyRes.ok) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      const data = await proxyRes.json();
      if (!isCurrent(scope)) throw new StaleCredentialsError();
      return { data, rateLimit, source: 'proxy' };
    }

    // Rate-limit 403 or 429 from proxy — explicitly block fallback to unauthenticated direct requests
    if (proxyRes.status === 403 || proxyRes.status === 429) {
      throw await quotaError(proxyRes);
    }

    if (proxyRes.status === 400) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      throw new GitHubApiError(`Invalid GitHub username format. Please check the spelling.`, 400, rateLimit);
    }

    if (proxyRes.status === 404) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      throw new GitHubApiError(`GitHub user was not found. Please verify the username.`, 404, rateLimit);
    }
    throw new GitHubApiError(proxyRes.status === 401 ? 'GitHub rejected the supplied credentials. Check the token before retrying.' : 'The proxy could not complete this request. Please retry later.', proxyRes.status, parseRateLimitHeaders(proxyRes.headers));
  } catch (err: any) {
    if (err instanceof GitHubApiError || err instanceof StaleCredentialsError) throw err;
    // Credentials changed while the proxy request was pending: do not start another request
    if (!isCurrent(scope)) throw new StaleCredentialsError();
    // Proxy not available or failed network, fall through to direct GitHub API
  }

  // 2. Direct GitHub REST API fallback
  const directHeaders: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token && token.trim()) {
    directHeaders.Authorization = `Bearer ${token.trim()}`;
  }

  let directRes: Response;
  try {
    directRes = await apiFetch(`${GITHUB_API_BASE}${directPath}`, {
      headers: directHeaders,
    });
  } catch (err: any) {
    if (!isCurrent(scope)) throw new StaleCredentialsError();
    if (err && err.name === 'AbortError') {
      throw new GitHubApiError('GitHub did not respond in time. Please try again.', 0);
    }
    throw err;
  }
  if (!isCurrent(scope)) throw new StaleCredentialsError();

  const rateLimit = parseRateLimitHeaders(directRes.headers);

  if (!directRes.ok) {
    if (directRes.status === 404) {
      throw new GitHubApiError(`GitHub user was not found. Please check the spelling.`, 404, rateLimit);
    }
    if (directRes.status === 403 || directRes.status === 429) throw await quotaError(directRes);
    throw new GitHubApiError(
      `GitHub API error (${directRes.status}): ${directRes.statusText}`,
      directRes.status,
      rateLimit
    );
  }

  const data: T = await directRes.json();
  if (!isCurrent(scope)) throw new StaleCredentialsError();
  return { data, rateLimit, source: 'direct' };
}

export async function fetchGitHubUser(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubUser>> {
  const cleanUsername = username.trim().toLowerCase();
  const scope = scopeFor(token);
  const cacheKey = `user:${cleanUsername}:${scope.key}`;

  const cached = getCached<GitHubUser>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: { ...cached.rateLimit, known: false, cached: true }, source: 'cache' };
  }

  // In-flight deduplication
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const res = await fetchWithFallback<GitHubUser>(
        `/user/${encodeURIComponent(cleanUsername)}`,
        `/users/${encodeURIComponent(cleanUsername)}`,
        token,
        scope
      );
      setCache(cacheKey, res.data, res.rateLimit, scope);
      return { data: res.data, rateLimit: res.rateLimit, source: res.source };
    } finally {
      if (isCurrent(scope)) inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchGitHubRepos(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubRepo[]>> {
  const cleanUsername = username.trim().toLowerCase();
  const scope = scopeFor(token);
  const cacheKey = `repos:${cleanUsername}:${scope.key}`;

  const cached = getCached<GitHubRepo[]>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: { ...cached.rateLimit, known: false, cached: true }, source: 'cache' };
  }

  // In-flight deduplication
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const res = await fetchWithFallback<GitHubRepo[]>(
        `/repos/${encodeURIComponent(cleanUsername)}`,
        `/users/${encodeURIComponent(cleanUsername)}/repos?per_page=100&sort=updated&direction=desc`,
        token,
        scope
      );
      setCache(cacheKey, res.data, res.rateLimit, scope);
      return { data: res.data, rateLimit: res.rateLimit, source: res.source };
    } finally {
      if (isCurrent(scope)) inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchGitHubEvents(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubEvent[]>> {
  const cleanUsername = username.trim().toLowerCase();
  const scope = scopeFor(token);
  const cacheKey = `events:${cleanUsername}:${scope.key}`;

  const cached = getCached<GitHubEvent[]>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: { ...cached.rateLimit, known: false, cached: true }, source: 'cache' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const response = await apiFetch(
      `${GITHUB_API_BASE}/users/${encodeURIComponent(cleanUsername)}/events/public?per_page=30`,
      { headers }
    );
    const rateLimit = parseRateLimitHeaders(response.headers);

    if (!response.ok) {
      return { data: [], rateLimit, source: 'direct' };
    }

    const data: GitHubEvent[] = await response.json();
    setCache(cacheKey, data, rateLimit, scope);
    return { data, rateLimit, source: 'direct' };
  } catch {
    return {
      data: [],
      rateLimit: {
        limit: 60,
        remaining: 50,
        reset: Math.floor(Date.now() / 1000) + 3600,
        used: 10,
        resetMinutes: 60,
        resetTimeFormatted: '',
      },
      source: 'direct',
    };
  }
}

// The quota counters seen on the most recent repository-data response. GitHub's own /rate_limit
// endpoint can report a different (fresh) window for some token types, so after an inspection the
// counters from the actual data requests are the ones worth showing.
let lastObservedRateLimit: RateLimitInfo | null = null;

function recordObservedRateLimit(headers: Headers) {
  const info = parseRateLimitHeaders(headers);
  if (info.cached || (info.source === 'unknown' && !info.retryAt)) return;
  if (lastObservedRateLimit?.retryAt && lastObservedRateLimit.retryAt > Date.now() && (!info.retryAt || info.retryAt < lastObservedRateLimit.retryAt)) return;
  lastObservedRateLimit = info;
}

export function getLastObservedRateLimit(): RateLimitInfo | null {
  return lastObservedRateLimit;
}

const GITHUB_OWNER_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_REPO_NAME_REGEX = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Conservative subset of git's branch-name rules. A name outside it is not sent at all.
 * Keep in sync with isValidBranchName in server.js and vite.config.ts.
 */
export function isValidBranchName(ref: unknown): ref is string {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return false;
  if (ref.includes('..') || ref.includes('//') || ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.startsWith('-') || ref.endsWith('.')) return false;
  return ref.split('/').every((segment) => !segment.startsWith('.') && !segment.endsWith('.lock'));
}

function treeFailureForStatus(status: number): Extract<RepoTreeResult, { ok: false }> {
  if (status === 403 || status === 429) return { ok: false, reason: 'rate_limited' };
  if (status === 404) return { ok: false, reason: 'not_found' };
  if (status === 409) return { ok: false, reason: 'empty' }; // GitHub: "Git Repository is empty"
  if (status === 413) return { ok: false, reason: 'too_large' };
  return { ok: false, reason: 'error' };
}

/**
 * Fetches the file listing (paths and sizes only, never file contents) of one branch of a
 * repository, normally the default branch taken from the repository metadata already loaded.
 *
 * Requests go through the app's proxy only. There is deliberately no direct-to-GitHub fallback:
 * the proxy is what enforces identifier validation, size caps, caching and request budgets.
 * Failures are returned as values so one unreadable repository never fails a whole audit.
 */
export async function fetchRepoTree(owner: string, repo: string, token?: string, branch?: string | null): Promise<RepoTreeResult> {
  if (!GITHUB_OWNER_REGEX.test(owner) || !GITHUB_REPO_NAME_REGEX.test(repo) || repo === '.' || repo === '..') {
    return { ok: false, reason: 'error' };
  }
  // An unusable branch name is dropped; the proxy then falls back to the repository HEAD
  const ref = isValidBranchName(branch) ? branch : '';

  const scope = scopeFor(token);
  const cacheKey = `tree:${owner.toLowerCase()}/${repo.toLowerCase()}@${ref}:${scope.key}`;
  const cached = getCached<RepoTree>(cacheKey);
  if (cached) return { ok: true, tree: cached.data };

  if (inFlightRequests.has(cacheKey)) return inFlightRequests.get(cacheKey)!;

  const promise = (async (): Promise<RepoTreeResult> => {
    try {
      const proxyHeaders: Record<string, string> = { Accept: 'application/json' };
      if (token && token.trim()) proxyHeaders['x-github-token'] = token.trim();

      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const proxyRes = await apiFetch(
        `${LOCAL_PROXY_BASE}/tree/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${query}`,
        { headers: proxyHeaders }
      );
      if (!isCurrent(scope)) return { ok: false, reason: 'error' };
      recordObservedRateLimit(proxyRes.headers);
      if (!proxyRes.ok) return proxyRes.headers.get('x-repozyn-limit-kind') === 'permission' ? { ok: false, reason: 'error' } : treeFailureForStatus(proxyRes.status);
      const tree = normalizeRepoTree(await proxyRes.json());
      // Finished under credentials that are no longer in force: discard rather than return or cache
      if (!isCurrent(scope)) return { ok: false, reason: 'error' };
      // Listings can be large: keep them in memory only, never in sessionStorage
      setCache(cacheKey, tree, parseRateLimitHeaders(proxyRes.headers), scope, false);
      return { ok: true, tree };
    } catch {
      return { ok: false, reason: 'error' };
    }
  })().finally(() => {
    if (isCurrent(scope)) inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Fetches the text of one README file through the app's proxy. The proxy only serves README-named
 * files that exist in the repository's validated file listing, within the size limit, and only
 * from repositories it has confirmed are public. There is no direct-to-GitHub fallback.
 * The returned text is untrusted data and must only be analysed, never rendered or acted on.
 */
export async function fetchReadmeContent(owner: string, repo: string, token: string | undefined, branch: string | null | undefined, path: string): Promise<ReadmeFetchResult> {
  if (!GITHUB_OWNER_REGEX.test(owner) || !GITHUB_REPO_NAME_REGEX.test(repo) || repo === '.' || repo === '..' || !isReadmePath(path)) {
    return { ok: false, reason: 'error' };
  }
  const ref = isValidBranchName(branch) ? branch : '';

  const scope = scopeFor(token);
  const cacheKey = `readme:${owner.toLowerCase()}/${repo.toLowerCase()}@${ref}:${path}:${scope.key}`;
  const cached = getCached<{ path: string; size: number; text: string }>(cacheKey);
  if (cached) return { ok: true, ...cached.data };

  if (inFlightRequests.has(cacheKey)) return inFlightRequests.get(cacheKey)!;

  const promise = (async (): Promise<ReadmeFetchResult> => {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token && token.trim()) headers['x-github-token'] = token.trim();

      const query = new URLSearchParams();
      if (ref) query.set('ref', ref);
      query.set('path', path);
      const res = await apiFetch(`${LOCAL_PROXY_BASE}/readme/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${query.toString()}`, { headers });

      if (!isCurrent(scope)) return { ok: false, reason: 'error' };
      recordObservedRateLimit(res.headers);
      if (res.headers.get('x-repozyn-limit-kind') === 'permission') return { ok: false, reason: 'error' };
      if (res.status === 403 || res.status === 429) return { ok: false, reason: 'rate_limited' };
      if (res.status === 404) return { ok: false, reason: 'not_found' };
      if (res.status === 413) return { ok: false, reason: 'too_large' };
      if (res.status === 415) return { ok: false, reason: 'not_text' };
      if (!res.ok) return { ok: false, reason: 'error' };

      const payload = (await res.json()) as { path?: unknown; size?: unknown; text?: unknown };
      if (typeof payload.text !== 'string' || typeof payload.size !== 'number' || payload.path !== path) return { ok: false, reason: 'error' };
      if (payload.size > README_LIMITS.maxFileBytes || payload.text.length > README_LIMITS.maxFileBytes) return { ok: false, reason: 'too_large' };

      const data = { path, size: payload.size, text: payload.text };
      if (!isCurrent(scope)) return { ok: false, reason: 'error' };
      // Memory only: README text is never written to sessionStorage
      setCache(cacheKey, data, parseRateLimitHeaders(res.headers), scope, false);
      return { ok: true, ...data };
    } catch {
      return { ok: false, reason: 'error' };
    }
  })().finally(() => {
    if (isCurrent(scope)) inFlightRequests.delete(cacheKey);
  });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

export async function checkRateLimit(token?: string): Promise<RateLimitInfo> {
  const readQuota = async (response: Response) => {
    if (!response.ok) {
      const info = (await quotaError(response)).rateLimit!;
      return response.status === 401 ? { ...info, known: false, limit: 0, remaining: 0, limitKind: 'permission' as const } : info;
    }
    const data = await response.json();
    const headers = new Headers(response.headers);
    // Response headers are authoritative. The body is used only if counters were omitted.
    for (const key of ['limit', 'remaining', 'reset', 'used']) {
      if (!headers.has(`x-ratelimit-${key}`) && typeof data.rate?.[key] === 'number') headers.set(`x-ratelimit-${key}`, String(data.rate[key]));
    }
    return parseRateLimitHeaders(headers);
  };
  try {
    const headers: Record<string, string> = {};
    if (token?.trim()) headers['x-github-token'] = token.trim();
    const response = await apiFetch(`${LOCAL_PROXY_BASE}/rate_limit`, { headers });
    return await readQuota(response);
  } catch {
    // Only an unavailable proxy permits direct public quota checking; an HTTP denial does not.
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    return await readQuota(await apiFetch(`${GITHUB_API_BASE}/rate_limit`, { headers }));
  } catch {
    return { limit: 0, remaining: 0, reset: 0, used: 0, resetMinutes: 0, resetTimeFormatted: '', source: 'unknown', known: false };
  }
}
