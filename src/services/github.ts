import type { GitHubUser, GitHubRepo, GitHubEvent, RateLimitInfo } from '../types/github';

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
    this.isRateLimit = isRateLimit || status === 403;
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
  const limit = parseInt(headers.get('x-ratelimit-limit') || '60', 10);
  const remaining = parseInt(headers.get('x-ratelimit-remaining') || '60', 10);
  const reset = parseInt(headers.get('x-ratelimit-reset') || '0', 10);
  const used = parseInt(headers.get('x-ratelimit-used') || '0', 10);
  const resetMinutes = reset > 0 ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 60;
  const resetTimeFormatted = reset > 0 ? formatResetTime(reset) : '';

  return {
    limit,
    remaining,
    reset,
    used,
    resetMinutes,
    resetTimeFormatted,
  };
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

function setCache<T>(key: string, data: T, rateLimit: RateLimitInfo) {
  const entry = { data, rateLimit, timestamp: Date.now() };
  responseCache.set(key, entry);
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
  token?: string
): Promise<{ data: T; rateLimit: RateLimitInfo; source: 'proxy' | 'direct' }> {
  // 1. Attempt backend proxy (Cloud Run / Vite Dev Server)
  try {
    const proxyHeaders: Record<string, string> = {
      Accept: 'application/json',
    };
    if (token && token.trim()) {
      proxyHeaders['x-github-token'] = token.trim();
    }

    const proxyRes = await fetch(`${LOCAL_PROXY_BASE}${proxyPath}`, {
      headers: proxyHeaders,
    });

    if (proxyRes.ok) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      const data = await proxyRes.json();
      return { data, rateLimit, source: 'proxy' };
    }

    // Rate-limit 403 or 429 from proxy — explicitly block fallback to unauthenticated direct requests
    if (proxyRes.status === 403 || proxyRes.status === 429) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      const resetMsg = rateLimit.resetTimeFormatted ? ` (at ${rateLimit.resetTimeFormatted})` : '';
      throw new GitHubApiError(
        `GitHub API rate limit exceeded (${rateLimit.remaining}/${rateLimit.limit} remaining). Resets in ~${rateLimit.resetMinutes} min${resetMsg}. Tip: Try instant Demo Personas or add a free personal token in settings.`,
        proxyRes.status,
        rateLimit,
        true
      );
    }

    if (proxyRes.status === 400) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      throw new GitHubApiError(`Invalid GitHub username format. Please check the spelling.`, 400, rateLimit);
    }

    if (proxyRes.status === 404) {
      const rateLimit = parseRateLimitHeaders(proxyRes.headers);
      throw new GitHubApiError(`GitHub user was not found. Please verify the username.`, 404, rateLimit);
    }
  } catch (err: any) {
    if (err instanceof GitHubApiError) throw err;
    // Proxy not available or failed network, fall through to direct GitHub API
  }

  // 2. Direct GitHub REST API fallback
  const directHeaders: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token && token.trim()) {
    directHeaders.Authorization = `Bearer ${token.trim()}`;
  }

  const directRes = await fetch(`${GITHUB_API_BASE}${directPath}`, {
    headers: directHeaders,
  });

  const rateLimit = parseRateLimitHeaders(directRes.headers);

  if (!directRes.ok) {
    if (directRes.status === 404) {
      throw new GitHubApiError(`GitHub user was not found. Please check the spelling.`, 404, rateLimit);
    }
    if (directRes.status === 403) {
      const resetMsg = rateLimit.resetTimeFormatted ? ` (at ${rateLimit.resetTimeFormatted})` : '';
      throw new GitHubApiError(
        `GitHub API rate limit exceeded (${rateLimit.remaining}/${rateLimit.limit} remaining). Resets in ~${rateLimit.resetMinutes} min${resetMsg}. Tip: Try instant Demo Personas or add a free personal token in settings.`,
        403,
        rateLimit,
        true
      );
    }
    throw new GitHubApiError(
      `GitHub API error (${directRes.status}): ${directRes.statusText}`,
      directRes.status,
      rateLimit
    );
  }

  const data: T = await directRes.json();
  return { data, rateLimit, source: 'direct' };
}

export async function fetchGitHubUser(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubUser>> {
  const cleanUsername = username.trim().toLowerCase();
  const cacheKey = `user:${cleanUsername}:${token ? 'auth' : 'anon'}`;

  const cached = getCached<GitHubUser>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: cached.rateLimit, source: 'cache' };
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
        token
      );
      setCache(cacheKey, res.data, res.rateLimit);
      return { data: res.data, rateLimit: res.rateLimit, source: res.source };
    } finally {
      inFlightRequests.delete(cacheKey);
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
  const cacheKey = `repos:${cleanUsername}:${token ? 'auth' : 'anon'}`;

  const cached = getCached<GitHubRepo[]>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: cached.rateLimit, source: 'cache' };
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
        token
      );
      setCache(cacheKey, res.data, res.rateLimit);
      return { data: res.data, rateLimit: res.rateLimit, source: res.source };
    } finally {
      inFlightRequests.delete(cacheKey);
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
  const cacheKey = `events:${cleanUsername}:${token ? 'auth' : 'anon'}`;

  const cached = getCached<GitHubEvent[]>(cacheKey);
  if (cached) {
    return { data: cached.data, rateLimit: cached.rateLimit, source: 'cache' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/users/${encodeURIComponent(cleanUsername)}/events/public?per_page=30`,
      { headers }
    );
    const rateLimit = parseRateLimitHeaders(response.headers);

    if (!response.ok) {
      return { data: [], rateLimit, source: 'direct' };
    }

    const data: GitHubEvent[] = await response.json();
    setCache(cacheKey, data, rateLimit);
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

export async function checkRateLimit(token?: string): Promise<RateLimitInfo> {
  // Try proxy first
  try {
    const proxyHeaders: Record<string, string> = {};
    if (token && token.trim()) proxyHeaders['x-github-token'] = token.trim();
    const proxyRes = await fetch(`${LOCAL_PROXY_BASE}/rate_limit`, { headers: proxyHeaders });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      const reset = data.rate?.reset || 0;
      const resetMinutes = reset > 0 ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 60;
      return {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset,
        used: data.rate.used,
        resetMinutes,
        resetTimeFormatted: formatResetTime(reset),
      };
    }
  } catch {
    // Fallback to direct
  }

  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (token && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const directRes = await fetch(`${GITHUB_API_BASE}/rate_limit`, { headers });
    if (directRes.ok) {
      const data = await directRes.json();
      const reset = data.rate?.reset || 0;
      const resetMinutes = reset > 0 ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 60;
      return {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset,
        used: data.rate.used,
        resetMinutes,
        resetTimeFormatted: formatResetTime(reset),
      };
    }
  } catch {
    // Ignore error on status check
  }

  return {
    limit: 60,
    remaining: 60,
    reset: Math.floor(Date.now() / 1000) + 3600,
    used: 0,
    resetMinutes: 60,
    resetTimeFormatted: '',
  };
}
