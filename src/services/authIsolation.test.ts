import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearApiCache,
  checkRateLimit,
  fetchGitHubRepos,
  fetchGitHubUser,
  fetchReadmeContent,
  fetchRepoTree,
  getGitHubAuthEpoch,
  GitHubApiError,
  REQUEST_TIMEOUT_MS,
  setGitHubAuthContext,
} from './github';

// Browser-side credential isolation: data fetched with one token must never be served to, merged
// with, or cached for another. All tokens here are synthetic.

const TOKEN_A = 'ghp_syntheticTokenAAAA';
const TOKEN_B = 'ghp_syntheticTokenBBBB';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999' } });

/** Which synthetic token a request carried, read from the header the client sent */
const tokenOf = (init: RequestInit | undefined) => (init?.headers as Record<string, string> | undefined)?.['x-github-token'] ?? 'none';

interface Pending {
  url: string;
  token: string;
  signal: AbortSignal;
  resolve: (response: Response) => void;
}

describe('browser credential isolation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearApiCache();
    sessionStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearApiCache();
  });

  /** Answers every request immediately with a body naming the credentials it was made with */
  const answerByToken = () =>
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const who = tokenOf(init);
      if (String(url).includes('/tree/')) return json({ truncated: false, tree: [{ path: `seen-by-${who}.md`, type: 'blob', size: 1 }] });
      if (String(url).includes('/readme/')) return json({ path: 'README.md', size: 5, text: `for ${who}` });
      if (String(url).includes('/repos/')) return json([{ id: 1, name: `repo-visible-to-${who}` }]);
      return json({ login: 'octocat', bio: `profile as seen by ${who}` });
    });

  /** Leaves every request pending until the test resolves it; rejects it if it is aborted */
  const holdRequests = () => {
    const pending: Pending[] = [];
    fetchMock.mockImplementation(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init!.signal as AbortSignal;
          pending.push({ url: String(url), token: tokenOf(init), signal, resolve });
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    return pending;
  };

  it('never serves data cached under one token to a request made with another', async () => {
    answerByToken();

    const asA = await fetchGitHubUser('octocat', TOKEN_A);
    const asB = await fetchGitHubUser('octocat', TOKEN_B);
    const anonymous = await fetchGitHubUser('octocat', '');
    const backToA = await fetchGitHubUser('octocat', TOKEN_A);

    expect(asA.data.bio).toBe(`profile as seen by ${TOKEN_A}`);
    expect(asB.data.bio).toBe(`profile as seen by ${TOKEN_B}`);
    expect(anonymous.data.bio).toBe('profile as seen by none');
    expect(backToA.data.bio).toBe(`profile as seen by ${TOKEN_A}`);
    // Four different credential states, four requests: nothing was reused across them
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([asA, asB, anonymous, backToA].every((r) => r.source !== 'cache')).toBe(true);

    // Within one credential state the cache still works
    const again = await fetchGitHubUser('octocat', TOKEN_A);
    expect(again.source).toBe('cache');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('isolates repository lists, file listings and README text the same way', async () => {
    answerByToken();

    const reposA = await fetchGitHubRepos('octocat', TOKEN_A);
    const treeA = await fetchRepoTree('octocat', 'private-notes', TOKEN_A, 'main');
    const readmeA = await fetchReadmeContent('octocat', 'private-notes', TOKEN_A, 'main', 'README.md');
    expect(reposA.data[0].name).toBe(`repo-visible-to-${TOKEN_A}`);

    const reposB = await fetchGitHubRepos('octocat', TOKEN_B);
    const treeB = await fetchRepoTree('octocat', 'private-notes', TOKEN_B, 'main');
    const readmeB = await fetchReadmeContent('octocat', 'private-notes', TOKEN_B, 'main', 'README.md');

    expect(reposB.data[0].name).toBe(`repo-visible-to-${TOKEN_B}`);
    expect(treeA.ok && treeA.tree.entries[0].path).toBe(`seen-by-${TOKEN_A}.md`);
    expect(treeB.ok && treeB.tree.entries[0].path).toBe(`seen-by-${TOKEN_B}.md`);
    expect(readmeA.ok && readmeA.text).toBe(`for ${TOKEN_A}`);
    expect(readmeB.ok && readmeB.text).toBe(`for ${TOKEN_B}`);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('does not merge a request made with one token into a pending request made with another', async () => {
    const pending = holdRequests();

    const asA = fetchGitHubUser('octocat', TOKEN_A);
    const asAAgain = fetchGitHubUser('octocat', TOKEN_A);
    expect(pending).toHaveLength(1); // same credentials: coalesced

    const asB = fetchGitHubUser('octocat', TOKEN_B);
    expect(pending.length).toBeGreaterThanOrEqual(2); // different credentials: its own request
    const forB = pending.find((p) => p.token === TOKEN_B)!;
    expect(forB).toBeDefined();
    forB.resolve(json({ login: 'octocat', bio: 'for B' }));

    expect((await asB).data.bio).toBe('for B');
    await expect(asA).rejects.toThrow();
    await expect(asAAgain).rejects.toThrow();
  });

  it('cancels outstanding requests when the credentials change', async () => {
    const pending = holdRequests();

    const user = fetchGitHubUser('octocat', TOKEN_A);
    const tree = fetchRepoTree('octocat', 'repo', TOKEN_A, 'main');
    const readme = fetchReadmeContent('octocat', 'repo', TOKEN_A, 'main', 'README.md');
    expect(pending).toHaveLength(3);
    expect(pending.every((p) => !p.signal.aborted)).toBe(true);

    setGitHubAuthContext(TOKEN_B);

    expect(pending.every((p) => p.signal.aborted)).toBe(true);
    await expect(user).rejects.toThrow(/credentials changed/);
    expect(await tree).toEqual({ ok: false, reason: 'error' });
    expect(await readme).toEqual({ ok: false, reason: 'error' });
    // The cancelled user lookup did not go on to try GitHub directly
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('discards a response that finishes after the credentials changed, and never caches it', async () => {
    // These requests ignore cancellation, as a response already on the wire would
    const resolvers: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));

    const userA = fetchGitHubUser('octocat', TOKEN_A);
    const treeA = fetchRepoTree('octocat', 'private-notes', TOKEN_A, 'main');
    const readmeA = fetchReadmeContent('octocat', 'private-notes', TOKEN_A, 'main', 'README.md');

    setGitHubAuthContext(TOKEN_B);

    // Token A's answers arrive late
    resolvers[0](json({ login: 'octocat', bio: 'PRIVATE VIEW FOR A' }));
    resolvers[1](json({ truncated: false, tree: [{ path: 'private-for-a.md', type: 'blob', size: 1 }] }));
    resolvers[2](json({ path: 'README.md', size: 9, text: 'SECRET A' }));

    await expect(userA).rejects.toThrow(/credentials changed/);
    expect(await treeA).toEqual({ ok: false, reason: 'error' });
    expect(await readmeA).toEqual({ ok: false, reason: 'error' });

    // Nothing from A was stored: token B triggers fresh requests and sees only its own data
    answerByToken();
    const before = fetchMock.mock.calls.length;
    const userB = await fetchGitHubUser('octocat', TOKEN_B);
    const treeB = await fetchRepoTree('octocat', 'private-notes', TOKEN_B, 'main');
    const readmeB = await fetchReadmeContent('octocat', 'private-notes', TOKEN_B, 'main', 'README.md');
    expect(fetchMock.mock.calls.length - before).toBe(3);
    expect(JSON.stringify([userB, treeB, readmeB])).not.toMatch(/PRIVATE VIEW FOR A|private-for-a|SECRET A/);

    // And going back to token A also starts from an empty cache
    const again = await fetchGitHubUser('octocat', TOKEN_A);
    expect(again.source).not.toBe('cache');
    expect(again.data.bio).toBe(`profile as seen by ${TOKEN_A}`);
  });

  it('never puts a token, or data fetched with one, into storage or cache keys', async () => {
    answerByToken();

    await fetchGitHubUser('octocat', '');
    const anonymousKeys = Object.keys(sessionStorage);
    expect(anonymousKeys.some((k) => k.startsWith('repozyn_cache:user:octocat'))).toBe(true);

    await fetchGitHubUser('octocat', TOKEN_A);
    await fetchGitHubRepos('octocat', TOKEN_A);
    await fetchRepoTree('octocat', 'repo', TOKEN_A, 'main');
    await fetchReadmeContent('octocat', 'repo', TOKEN_A, 'main', 'README.md');

    // Switching to a token purged what was stored before, and nothing fetched with the token was written
    const stored = Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`).join('\n');
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('repozyn_cache:'))).toEqual([]);
    expect(stored).not.toContain(TOKEN_A);
    expect(stored).not.toContain(`seen by ${TOKEN_A}`);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toContain(TOKEN_A);
  });

  it('changes the credential epoch on every change and only on a change', () => {
    const start = getGitHubAuthEpoch();
    setGitHubAuthContext(TOKEN_A);
    expect(getGitHubAuthEpoch()).toBe(start + 1);
    setGitHubAuthContext(`  ${TOKEN_A}  `);
    setGitHubAuthContext(TOKEN_A);
    expect(getGitHubAuthEpoch()).toBe(start + 1);
    setGitHubAuthContext(TOKEN_B);
    setGitHubAuthContext('');
    setGitHubAuthContext(null);
    expect(getGitHubAuthEpoch()).toBe(start + 3);
  });

  it('checking a candidate token does not disturb the credentials in force', async () => {
    answerByToken();
    await fetchGitHubUser('octocat', TOKEN_A);
    const epoch = getGitHubAuthEpoch();

    fetchMock.mockResolvedValueOnce(json({ rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 } }));
    await checkRateLimit(TOKEN_B);

    expect(getGitHubAuthEpoch()).toBe(epoch);
    expect((await fetchGitHubUser('octocat', TOKEN_A)).source).toBe('cache');
  });

  it('abandons a request that takes too long and says so', async () => {
    vi.useFakeTimers();
    const pending = holdRequests();

    const user = fetchGitHubUser('slowpoke', '');
    const outcome = user.then(
      () => 'resolved',
      (err: unknown) => err
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); // proxy attempt times out
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10); // direct attempt times out

    const error = await outcome;
    expect(error).toBeInstanceOf(GitHubApiError);
    expect((error as Error).message).toBe('GitHub did not respond in time. Please try again.');
    expect(pending.every((p) => p.signal.aborted)).toBe(true);

    const tree = fetchRepoTree('octocat', 'slow-repo', '', 'main');
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    expect(await tree).toEqual({ ok: false, reason: 'error' });
  });
});
