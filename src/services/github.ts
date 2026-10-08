import type { GitHubUser, GitHubRepo, GitHubEvent, RateLimitInfo } from '../types/github';

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubApiResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

export class GitHubApiError extends Error {
  status: number;
  rateLimit?: RateLimitInfo;
  resetDate?: Date;

  constructor(message: string, status: number, rateLimit?: RateLimitInfo) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.rateLimit = rateLimit;
    if (rateLimit?.reset) {
      this.resetDate = new Date(rateLimit.reset * 1000);
    }
  }
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const limit = parseInt(headers.get('x-ratelimit-limit') || '60', 10);
  const remaining = parseInt(headers.get('x-ratelimit-remaining') || '60', 10);
  const reset = parseInt(headers.get('x-ratelimit-reset') || '0', 10);
  const used = parseInt(headers.get('x-ratelimit-used') || '0', 10);
  const resetMinutes = reset > 0 ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 60;

  return {
    limit,
    remaining,
    reset,
    used,
    resetMinutes,
  };
}

// In-memory cache for recent responses to avoid wasting precious rate limit calls
const responseCache = new Map<string, { data: any; rateLimit: RateLimitInfo; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export async function fetchGitHubUser(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubUser>> {
  const cleanUsername = username.trim().toLowerCase();
  const cacheKey = `user:${cleanUsername}:${token ? 'auth' : 'anon'}`;
  const cached = responseCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { data: cached.data, rateLimit: cached.rateLimit };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}/users/${encodeURIComponent(cleanUsername)}`, {
    headers,
  });

  const rateLimit = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubApiError(`GitHub user "${cleanUsername}" was not found. Please check the spelling.`, 404, rateLimit);
    }
    if (response.status === 403) {
      const resetMinutes = rateLimit.reset ? Math.max(1, Math.round((rateLimit.reset * 1000 - Date.now()) / 60000)) : 60;
      throw new GitHubApiError(
        `GitHub API rate limit exceeded (${rateLimit.remaining}/${rateLimit.limit} remaining). Resets in ~${resetMinutes} min. Tip: Add a personal GitHub token in the header settings for 5,000 req/hr.`,
        403,
        rateLimit
      );
    }
    throw new GitHubApiError(`GitHub API error (${response.status}): ${response.statusText}`, response.status, rateLimit);
  }

  const data: GitHubUser = await response.json();
  responseCache.set(cacheKey, { data, rateLimit, timestamp: Date.now() });

  return { data, rateLimit };
}

export async function fetchGitHubRepos(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubRepo[]>> {
  const cleanUsername = username.trim().toLowerCase();
  const cacheKey = `repos:${cleanUsername}:${token ? 'auth' : 'anon'}`;
  const cached = responseCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { data: cached.data, rateLimit: cached.rateLimit };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  // Fetch up to 100 repositories, sorted by most recently updated
  const response = await fetch(
    `${GITHUB_API_BASE}/users/${encodeURIComponent(cleanUsername)}/repos?per_page=100&sort=updated&direction=desc`,
    { headers }
  );

  const rateLimit = parseRateLimitHeaders(response.headers);

  if (!response.ok) {
    if (response.status === 403) {
      const resetMinutes = rateLimit.reset ? Math.max(1, Math.round((rateLimit.reset * 1000 - Date.now()) / 60000)) : 60;
      throw new GitHubApiError(
        `GitHub API rate limit exceeded when fetching repositories. Resets in ~${resetMinutes} min.`,
        403,
        rateLimit
      );
    }
    throw new GitHubApiError(`Failed to fetch repositories (${response.status}): ${response.statusText}`, response.status, rateLimit);
  }

  const data: GitHubRepo[] = await response.json();
  responseCache.set(cacheKey, { data, rateLimit, timestamp: Date.now() });

  return { data, rateLimit };
}

export async function fetchGitHubEvents(
  username: string,
  token?: string
): Promise<GitHubApiResponse<GitHubEvent[]>> {
  const cleanUsername = username.trim().toLowerCase();
  const cacheKey = `events:${cleanUsername}:${token ? 'auth' : 'anon'}`;
  const cached = responseCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { data: cached.data, rateLimit: cached.rateLimit };
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
      return { data: [], rateLimit };
    }

    const data: GitHubEvent[] = await response.json();
    responseCache.set(cacheKey, { data, rateLimit, timestamp: Date.now() });
    return { data, rateLimit };
  } catch {
    // Graceful fallback: events are non-critical
    return {
      data: [],
      rateLimit: { limit: 60, remaining: 50, reset: Math.floor(Date.now() / 1000) + 3600, used: 10, resetMinutes: 60 },
    };
  }
}

export async function checkRateLimit(token?: string): Promise<RateLimitInfo> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  try {
    const response = await fetch(`${GITHUB_API_BASE}/rate_limit`, { headers });
    if (response.ok) {
      const data = await response.json();
      const reset = data.rate.reset;
      const resetMinutes = reset > 0 ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : 60;
      return {
        limit: data.rate.limit,
        remaining: data.rate.remaining,
        reset,
        used: data.rate.used,
        resetMinutes,
      };
    }
  } catch {
    // Ignore network error on status check
  }

  return { limit: 60, remaining: 60, reset: Math.floor(Date.now() / 1000) + 3600, used: 0, resetMinutes: 60 };
}
