import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

let upstream, child, base, calls, mode;
const request = async (path, headers = {}) => {
  const response = await fetch(base + path, { headers });
  return { status: response.status, headers: response.headers, body: await response.json() };
};
async function start(extra = {}) {
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { PATH: process.env.PATH, PORT: String(port), GITHUB_TOKEN: 'synthetic_public', GITHUB_API_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, TRUST_PROXY: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (data) => { output += data; });
  for (let i = 0; i < 100 && !output.includes('Production server listening'); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(output).toContain('Production server listening'); base = `http://127.0.0.1:${port}`;
}
beforeEach(async () => {
  calls = []; mode = 'normal';
  upstream = http.createServer((req, res) => {
    calls.push({ path: req.url, auth: req.headers.authorization });
    const authenticated = Boolean(req.headers.authorization);
    const limit = authenticated ? 5000 : 60;
    const headers = { 'content-type': 'application/json', 'x-ratelimit-limit': String(limit), 'x-ratelimit-remaining': String(limit - 1), 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600), 'x-oauth-scopes': req.headers.authorization === 'Bearer synthetic_private' ? 'repo' : '' };
    const send = (status, body, overrides = {}) => { res.writeHead(status, { ...headers, ...overrides }); res.end(JSON.stringify(body)); };
    if (mode === 'primary' || (mode === 'anonymous-empty' && !authenticated)) return send(403, { message: 'API rate limit exceeded for sensitive-account-id' }, { 'x-ratelimit-remaining': '0' });
    if (mode === 'secondary') return send(403, { message: 'You have exceeded a secondary rate limit. sensitive-account-id' }, { 'retry-after': '75' });
    if (mode === 'permission') return send(403, { message: 'Resource not accessible by integration' });
    if (req.url === '/rate_limit') return send(200, { rate: { limit, remaining: limit - 1, reset: Math.ceil(Date.now() / 1000) + 3600, used: 1 } });
    if (req.url.includes('/git/trees/')) return send(200, { tree: [{ path: 'README.md', type: 'blob', size: 10 }], truncated: false });
    return send(200, { login: 'dev', public_repos: 1 });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
});
afterEach(async () => {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await new Promise((resolve) => upstream.close(resolve));
});

describe('quota provenance and compliant backoff over real HTTP', () => {
  it.each(['primary', 'secondary'])('does not downgrade to anonymous when the credential-scope probe encounters %s throttling', async (throttle) => {
    await start(); mode = throttle;
    const tree = await request('/api/github/tree/dev/work?ref=main');
    expect(tree.status).toBe(403);
    expect(tree.headers.get('x-repozyn-limit-kind')).toBe(throttle);
    const readme = await request('/api/github/readme/dev/work?ref=main&path=README.md');
    expect(readme.status).toBe(429);
    expect(calls).toEqual([{ path: '/rate_limit', auth: 'Bearer synthetic_public' }]);
  });
  it.each([['proxy-request', { PROXY_RATE_LIMIT_MAX: '1' }], ['proxy-ip', { PROXY_UPSTREAM_IP_MAX: '1' }], ['proxy-global', { PROXY_UPSTREAM_GLOBAL_MAX: '1' }]])('identifies %s without presenting the application budget as GitHub quota', async (source, settings) => {
    await start(settings);
    expect((await request('/api/github/user/one')).status).toBe(200);
    const stopped = await request('/api/github/user/two');
    expect(stopped.status).toBe(429);
    expect(stopped.headers.get('x-repozyn-quota-source')).toBe(source);
    expect(Number(stopped.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
  it.each([['synthetic_public', 5000, 'server'], ['', 60, 'anonymous']])('reports a primary limit in the effective %s credential pool and never falls back to another identity', async (token, limit, auth) => {
    await start({ GITHUB_TOKEN: token }); mode = 'primary';
    const first = await request('/api/github/user/one');
    expect(first.status).toBe(403);
    expect(first.headers.get('x-repozyn-limit-kind')).toBe('primary');
    expect(first.headers.get('x-repozyn-auth-source')).toBe(auth);
    expect(first.headers.get('x-ratelimit-limit')).toBe(String(limit));
    expect(first.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(JSON.stringify(first.body)).not.toContain('sensitive-account-id');
    const second = await request('/api/github/user/two');
    expect(second.status).toBe(429); expect(calls).toHaveLength(1);
  });
  it('preserves nonzero primary quota during secondary throttling and honours Retry-After across endpoints', async () => {
    await start(); mode = 'secondary';
    const first = await request('/api/github/user/one');
    expect(first.headers.get('x-repozyn-limit-kind')).toBe('secondary');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('4999');
    expect(first.headers.get('retry-after')).toBe('75');
    const next = await request('/api/github/rate_limit');
    expect(next.status).toBe(429); expect(Number(next.headers.get('retry-after'))).toBeGreaterThanOrEqual(74);
    expect(calls).toHaveLength(1);
  });
  it('does not confuse ordinary permission denial with a rate limit or impose a credential cooldown', async () => {
    await start(); mode = 'permission';
    expect((await request('/api/github/user/one')).headers.get('x-repozyn-limit-kind')).toBe('permission');
    mode = 'normal'; expect((await request('/api/github/user/two')).status).toBe(200); expect(calls).toHaveLength(2);
  });
  it('reproduces authenticated profile quota alongside exhausted anonymous repository quota for a private-capable server token', async () => {
    await start({ GITHUB_TOKEN: 'synthetic_private' }); mode = 'anonymous-empty';
    const profile = await request('/api/github/user/dev');
    expect(profile.headers.get('x-ratelimit-limit')).toBe('5000');
    expect(profile.headers.get('x-repozyn-repository-auth-source')).toBe('anonymous');
    const tree = await request('/api/github/tree/dev/work?ref=main');
    expect(tree.status).toBe(403); expect(tree.headers.get('x-ratelimit-limit')).toBe('60');
    expect(tree.headers.get('x-repozyn-auth-source')).toBe('anonymous');
    expect(calls.map((call) => call.auth)).toEqual(['Bearer synthetic_private', undefined]);
  });
  it('marks cached quota as historical while retaining bounded public cache reuse', async () => {
    await start(); await request('/api/github/user/one');
    const cached = await request('/api/github/user/one');
    expect(cached.headers.get('x-cache')).toBe('HIT'); expect(cached.headers.get('x-repozyn-quota-cached')).toBe('1');
    expect(calls).toHaveLength(1);
  });
  it('isolates caller cooldowns from the shared server credential without substituting credentials', async () => {
    await start(); mode = 'secondary';
    await request('/api/github/user/one', { 'x-github-token': 'synthetic_client' });
    mode = 'normal'; expect((await request('/api/github/user/two')).status).toBe(200);
    const blocked = await request('/api/github/user/three', { 'x-github-token': 'synthetic_client' });
    expect(blocked.status).toBe(429);
    expect(calls.map((call) => call.auth)).toEqual(['Bearer synthetic_client', 'Bearer synthetic_public']);
  });
});
