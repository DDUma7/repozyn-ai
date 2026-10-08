import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseRateLimitHeaders,
  formatResetTime,
  fetchGitHubUser,
  fetchGitHubRepos,
  GitHubApiError,
  clearApiCache,
} from './github';

describe('GitHub Service & Rate Limit Reliability', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearApiCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('parseRateLimitHeaders', () => {
    it('correctly parses standard GitHub rate-limit headers', () => {
      const futureReset = Math.floor(Date.now() / 1000) + 1800; // 30 mins in future
      const headers = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': futureReset.toString(),
        'x-ratelimit-used': '60',
      });

      const info = parseRateLimitHeaders(headers);

      expect(info.limit).toBe(60);
      expect(info.remaining).toBe(0);
      expect(info.used).toBe(60);
      expect(info.reset).toBe(futureReset);
      expect(info.resetMinutes).toBeGreaterThanOrEqual(29);
      expect(info.resetMinutes).toBeLessThanOrEqual(31);
      expect(info.resetTimeFormatted).toBeTruthy();
    });

    it('falls back gracefully when rate-limit headers are missing', () => {
      const headers = new Headers();
      const info = parseRateLimitHeaders(headers);

      expect(info.limit).toBe(60);
      expect(info.remaining).toBe(60);
      expect(info.used).toBe(0);
    });
  });

  describe('formatResetTime', () => {
    it('formats unix timestamp to locale time string', () => {
      const formatted = formatResetTime(1791441350);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });

    it('returns empty string on zero or missing timestamp', () => {
      expect(formatResetTime(0)).toBe('');
    });
  });

  describe('fetchGitHubUser error handling and recovery', () => {
    it('throws custom GitHubApiError on 403 rate limit with actionable guidance', async () => {
      const futureReset = Math.floor(Date.now() / 1000) + 2400; // 40 mins
      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': futureReset.toString(),
        'x-ratelimit-used': '60',
      });

      // Mock both proxy and direct calls returning 403 rate limit
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: mockHeaders,
        json: async () => ({ message: 'API rate limit exceeded' }),
      } as Response);

      await expect(fetchGitHubUser('torvalds')).rejects.toThrow(GitHubApiError);

      try {
        await fetchGitHubUser('torvalds');
      } catch (err: any) {
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.status).toBe(403);
        expect(err.isRateLimit).toBe(true);
        expect(err.message).toContain('rate limit exceeded');
        expect(err.message).toContain('Demo Personas');
        expect(err.rateLimit?.remaining).toBe(0);
      }
    });

    it('does not trigger fallback unauthenticated requests when proxy returns 403 rate limit', async () => {
      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1800000000',
        'x-ratelimit-used': '60',
      });

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: mockHeaders,
        json: async () => ({ message: 'Rate limit exceeded' }),
      } as Response);

      globalThis.fetch = fetchSpy;

      try {
        await fetchGitHubUser('torvalds');
      } catch (err: any) {
        expect(err).toBeInstanceOf(GitHubApiError);
        expect(err.isRateLimit).toBe(true);
      }

      // Must have called proxy only once and NOT made a second request to api.github.com
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain('/api/github/user/torvalds');
    });

    it('throws helpful 404 error when user does not exist', async () => {
      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '45',
        'x-ratelimit-reset': '0',
        'x-ratelimit-used': '15',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: mockHeaders,
        json: async () => ({ message: 'Not Found' }),
      } as Response);

      await expect(fetchGitHubUser('nonexistent-user-12345')).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('Caching & Request Deduplication', () => {
    it('reuses cache and does not repeat network call within TTL', async () => {
      const mockUser = {
        login: 'testuser',
        id: 12345,
        avatar_url: 'https://example.com/avatar.png',
        html_url: 'https://github.com/testuser',
        name: 'Test User',
        public_repos: 5,
        followers: 10,
        following: 5,
      };

      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '59',
        'x-ratelimit-reset': '1800000000',
        'x-ratelimit-used': '1',
      });

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => mockUser,
      } as Response);

      globalThis.fetch = fetchSpy;

      // First call -> hits network (calls proxy)
      const res1 = await fetchGitHubUser('testuser');
      expect(res1.data.login).toBe('testuser');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call -> should hit cache, NOT network
      const res2 = await fetchGitHubUser('testuser');
      expect(res2.data.login).toBe('testuser');
      expect(res2.source).toBe('cache');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent in-flight requests for the same user', async () => {
      const mockUser = {
        login: 'concurrent-user',
        id: 9999,
        public_repos: 1,
      };

      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '50',
        'x-ratelimit-reset': '1800000000',
        'x-ratelimit-used': '10',
      });

      let resolvePromise: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const fetchSpy = vi.fn().mockImplementation(() =>
        delayedPromise.then(() => ({
          ok: true,
          status: 200,
          headers: mockHeaders,
          json: async () => mockUser,
        }))
      );

      globalThis.fetch = fetchSpy;

      // Trigger two concurrent requests simultaneously
      const req1 = fetchGitHubUser('concurrent-user');
      const req2 = fetchGitHubUser('concurrent-user');

      // Resolve the network response
      resolvePromise!(true);

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1.data.login).toBe('concurrent-user');
      expect(res2.data.login).toBe('concurrent-user');
      // Only 1 fetch call was initiated!
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchGitHubRepos fallback and caching', () => {
    it('caches repos and avoids duplicate calls', async () => {
      const mockRepos = [
        {
          id: 1,
          name: 'cool-project',
          stargazers_count: 42,
          fork: false,
          topics: ['react', 'ai'],
        },
      ];

      const mockHeaders = new Headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '58',
        'x-ratelimit-reset': '1800000000',
        'x-ratelimit-used': '2',
      });

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: mockHeaders,
        json: async () => mockRepos,
      } as Response);

      globalThis.fetch = fetchSpy;

      const res1 = await fetchGitHubRepos('repouser');
      expect(res1.data.length).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const res2 = await fetchGitHubRepos('repouser');
      expect(res2.data.length).toBe(1);
      expect(res2.source).toBe('cache');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
