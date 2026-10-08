import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canInspectWithQuota, mergeQuotaObservation, quotaMessage, quotaIsFresh } from '../utils/quota';
import { checkRateLimit, clearApiCache, fetchGitHubUser, fetchReadmeContent, fetchRepoTree, getLastObservedRateLimit, parseRateLimitHeaders } from './github';

const response = (status: number, headers: Record<string, string> = {}, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const primary = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600), 'x-repozyn-quota-source': 'github', 'x-repozyn-auth-source': 'anonymous', 'x-repozyn-limit-kind': 'primary', 'retry-after': '3600' };
const local = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-repozyn-quota-source': 'proxy-ip', 'retry-after': '600' };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { clearApiCache(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('quota reporting and safe fallback regressions', () => {
  it('late positive or cached observations cannot erase an active cooldown or newer response', () => {
    const paused = parseRateLimitHeaders(new Headers(primary));
    const positive = { ...paused, remaining: 50, retryAt: undefined, limitKind: undefined, observedAt: Date.now() + 1 };
    expect(mergeQuotaObservation(paused, positive)).toBe(paused);
    expect(mergeQuotaObservation(positive, { ...positive, cached: true, remaining: 0 })).toBe(positive);
    expect(mergeQuotaObservation(positive, { ...positive, observedAt: Date.now() - 1 })).toBe(positive);
  });
  it('distinguishes an app per-IP budget from a GitHub primary quota with identical numeric limits', () => {
    const app = parseRateLimitHeaders(new Headers(local));
    const github = parseRateLimitHeaders(new Headers(primary));
    expect(app.source).toBe('proxy-ip'); expect(github.source).toBe('github');
    expect(quotaMessage(app)).toMatch(/App per-IP lookup budget.*10 min/);
    expect(quotaMessage(app)).not.toContain('GitHub API rate limit exceeded');
    expect(quotaMessage(github)).toMatch(/Anonymous GitHub quota rate limit exceeded/);
  });
  it('reports unknown/malformed quota instead of inventing a fresh 60-request allowance', () => {
    for (const headers of [new Headers(), new Headers({ 'x-ratelimit-limit': 'NaN', 'x-ratelimit-remaining': '999' })]) {
      const info = parseRateLimitHeaders(headers); expect(info.known).toBe(false);
      expect(quotaIsFresh(info)).toBe(false); expect(quotaMessage(info)).toContain('unknown');
      expect(canInspectWithQuota(info, 3)).toBe(true);
    }
  });
  it('does not treat cached zero counters or counters from another credential pool as current repository quota', () => {
    const cached = parseRateLimitHeaders(new Headers({ ...primary, 'retry-after': '0', 'x-cache': 'HIT' }));
    expect(cached.cached).toBe(true); expect(canInspectWithQuota(cached, 3)).toBe(true);
    const wrongPool = parseRateLimitHeaders(new Headers({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-repozyn-auth-source': 'server', 'x-repozyn-repository-auth-source': 'anonymous' }));
    expect(canInspectWithQuota(wrongPool, 3)).toBe(true);
  });
  it.each([401, 403, 429, 503])('never switches to direct GitHub after a proxy HTTP %i denial during quota checking', async (status) => {
    fetchMock.mockResolvedValue(response(status, local)); await checkRateLimit('synthetic_client');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][0])).toBe('/api/github/rate_limit');
  });
  it.each([401, 503])('does not bypass a proxy HTTP %i by falling back during profile lookup', async (status) => {
    fetchMock.mockResolvedValue(response(status, { 'retry-after': '1' }));
    await expect(fetchGitHubUser('dev', 'synthetic_client')).rejects.toThrow(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('permits public direct fallback only when the proxy is unavailable, and reports unknown quota if both fail', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network unavailable')).mockResolvedValueOnce(response(200, {}, { rate: { limit: 60, remaining: 42, reset: 0, used: 18 } }));
    expect((await checkRateLimit()).remaining).toBe(42);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.github.com/rate_limit');
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await checkRateLimit()).toMatchObject({ known: false, source: 'unknown', remaining: 0 });
  });
  it('uses authoritative response headers when /rate_limit body disagrees, and rejects misleading 401 counters', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0' }, { rate: { limit: 5000, remaining: 4999 } }));
    expect((await checkRateLimit()).remaining).toBe(0);
    fetchMock.mockResolvedValueOnce(response(401, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999' }));
    expect(await checkRateLimit('synthetic_bad')).toMatchObject({ known: false, limit: 0, limitKind: 'permission' });
  });
  it('retains failure quota and reset metadata for both tree and README requests', async () => {
    fetchMock.mockResolvedValueOnce(response(403, primary));
    expect(await fetchRepoTree('dev', 'work', undefined, 'main')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(getLastObservedRateLimit()).toMatchObject({ source: 'github', authSource: 'anonymous', remaining: 0, limitKind: 'primary' });
    clearApiCache(); fetchMock.mockResolvedValueOnce(response(429, local));
    expect(await fetchReadmeContent('dev', 'work', undefined, 'main', 'README.md')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(getLastObservedRateLimit()).toMatchObject({ source: 'proxy-ip', remaining: 0 });
  });
  it('honours secondary retry time without claiming the primary quota is zero, then allows a user-triggered retry', () => {
    vi.useFakeTimers();
    const info = parseRateLimitHeaders(new Headers({ 'x-repozyn-quota-source': 'github', 'x-repozyn-limit-kind': 'secondary', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4900', 'retry-after': '75' }));
    expect(quotaMessage(info)).toMatch(/secondary rate limiting.*2 min.*4900/);
    expect(canInspectWithQuota(info, 3)).toBe(false);
    vi.advanceTimersByTime(75_001); expect(canInspectWithQuota(info, 3)).toBe(true);
  });
  it('does not misclassify explicit permission denial as exhausted quota', async () => {
    fetchMock.mockResolvedValue(response(403, { 'x-repozyn-quota-source': 'github', 'x-repozyn-limit-kind': 'permission', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999' }));
    expect(await fetchRepoTree('dev', 'work')).toEqual({ ok: false, reason: 'error' });
    await expect(fetchGitHubUser('dev')).rejects.toMatchObject({ isRateLimit: false });
  });
  it('a later successful parallel response cannot erase a confirmed cooldown', async () => {
    fetchMock.mockResolvedValueOnce(response(403, primary)).mockResolvedValueOnce(response(200, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '10' }, { tree: [] }));
    await fetchRepoTree('dev', 'one'); await fetchRepoTree('dev', 'two');
    expect(getLastObservedRateLimit()).toMatchObject({ remaining: 0, limitKind: 'primary' });
  });
});
