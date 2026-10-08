import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression tests for the Vite dev server's GitHub proxy. Development serves /api/github/* with
// the production request handler, so an unauthenticated request on the dev port must never be
// able to use the developer's server-side token to read private data.
//
// All credentials here are synthetic. The fake upstream below plays GitHub and, like GitHub,
// reveals private data to a sufficiently privileged token: the tests prove the proxy never asks.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PRIVILEGED = 'synthetic_privileged_server_token_1';
const CLASSIC_REPO_SCOPE = 'synthetic_classic_repo_scope_token_2';
const SECRET_README = 'TOP SECRET LAUNCH PLAN';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function request(port, target, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

let upstream;
let upstreamPort;
let received = [];
const running = [];

async function startVite(extraEnv = {}) {
  const port = await getFreePort();
  const output = [];
  const child = spawn(process.execPath, [VITE_BIN, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    // GITHUB_TOKEN is set explicitly (empty by default) so a developer's own .env.local is never used by tests
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`, GITHUB_TOKEN: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => output.push(c.toString()));
  child.stderr.on('data', (c) => output.push(c.toString()));
  running.push(child);

  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`vite exited early with code ${child.exitCode}: ${output.join('').slice(-400)}`);
    try {
      const res = await request(port, '/api/github/rate_limit');
      if (res.status === 200) {
        received = [];
        return { port, output };
      }
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error('vite dev server did not start');
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const url = req.url || '';
    const auth = req.headers.authorization;
    received.push({ url, authorization: auth, clientTokenHeader: req.headers['x-github-token'] });

    const privileged = auth === `Bearer ${PRIVILEGED}` || auth === `Bearer ${CLASSIC_REPO_SCOPE}`;
    const headers = { 'Content-Type': 'application/json', 'x-ratelimit-limit': auth ? '5000' : '60', 'x-ratelimit-remaining': auth ? '4990' : '50' };
    if (auth === `Bearer ${CLASSIC_REPO_SCOPE}`) headers['x-oauth-scopes'] = 'repo, read:user';
    const send = (status, payload) => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(payload));
    };
    const file = (p, size) => ({ path: p, mode: '100644', type: 'blob', sha: 'f'.repeat(40), size });

    if (url === '/rate_limit') return send(200, { rate: { limit: auth ? 5000 : 60, remaining: auth ? 4990 : 50, reset: 1900000000, used: 10 }, resources: { core: {} } });

    // A privileged token sees more than the public does, exactly as on GitHub
    if (url.startsWith('/users/owner/repos')) {
      const repos = [{ id: 1, name: 'public-repo', private: false, visibility: 'public', description: 'ok', permissions: { admin: privileged } }];
      if (privileged) repos.push({ id: 2, name: 'secret-repo', private: true, visibility: 'private', description: 'launch plans' });
      return send(200, repos);
    }
    if (url === '/users/owner') {
      return send(200, { login: 'owner', id: 1, name: 'Owner', public_repos: 1, ...(privileged ? { plan: { name: 'pro' }, total_private_repos: 7, two_factor_authentication: true } : {}) });
    }
    if (/^\/users\/[^/]+\/repos/.test(url)) return send(200, [{ id: 3, name: 'hello-world', private: false, visibility: 'public' }]);
    if (/^\/users\/[^/]+$/.test(url)) return send(200, { login: url.split('/')[2], id: 5 });

    const meta = /^\/repos\/owner\/([^/?]+)$/.exec(url);
    if (meta) {
      if (meta[1] === 'secret-repo') return privileged ? send(200, { full_name: 'owner/secret-repo', private: true, visibility: 'private' }) : send(404, { message: 'Not Found' });
      return send(200, { full_name: `owner/${meta[1]}`, private: false, visibility: 'public' });
    }
    if (url.includes('/git/ref/heads/')) return send(200, { ref: 'refs/heads/x', object: { type: 'commit', sha: 'b'.repeat(40) } });
    if (url.includes('/git/trees/')) {
      if (url.includes('/secret-repo/') && !privileged) return send(404, { message: 'Not Found' });
      return send(200, { sha: 'a'.repeat(40), truncated: false, tree: [file('README.md', 40), file('src/main.py', 10), file('plans/launch.md', 99)] });
    }
    if (url.includes('/contents/')) {
      const secret = url.includes('/secret-repo/');
      if (secret && !privileged) return send(404, { message: 'Not Found' });
      const repo = url.split('/')[3];
      const text = secret ? SECRET_README : '# Public README\n\n## Usage\n\nRun it.\n';
      return send(200, { type: 'file', path: 'README.md', size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64'), html_url: `https://github.com/owner/${repo}/blob/main/README.md` });
    }
    return send(404, { message: 'Not Found' });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamPort = upstream.address().port;
});

afterEach(() => {
  while (running.length) running.pop().kill('SIGKILL');
  received = [];
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

const repoDataCalls = () => received.filter((r) => r.url.includes('/git/') || r.url.includes('/contents/'));

describe('Vite dev proxy: privacy with a privileged server-side token', () => {
  it('never lets an unauthenticated request read a private file listing or README', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });

    const tree = await request(vite.port, '/api/github/tree/owner/secret-repo?ref=main');
    const treeNoRef = await request(vite.port, '/api/github/tree/owner/secret-repo');
    const treeSlash = await request(vite.port, '/api/github/tree/owner/secret-repo?ref=feature%2Fx');
    const readme = await request(vite.port, '/api/github/readme/owner/secret-repo?ref=main&path=README.md');
    for (const res of [tree, treeNoRef, treeSlash, readme]) {
      expect(res.status).toBe(404);
      expect(res.body).not.toMatch(/launch|plans|README\.md|TOP SECRET/i);
    }

    // The decisive check: the private repository's listing and file were never even requested
    expect(repoDataCalls().filter((c) => c.url.includes('secret-repo'))).toEqual([]);
    expect(vite.output.join('')).not.toContain(PRIVILEGED);
  }, 40000);

  it('strips private profile fields and private repositories from what an unauthenticated request receives', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });

    const user = await request(vite.port, '/api/github/user/owner');
    const repos = await request(vite.port, '/api/github/repos/owner');
    expect(JSON.parse(user.body)).toEqual({ login: 'owner', id: 1, name: 'Owner', public_repos: 1 });
    expect(JSON.parse(repos.body)).toEqual([{ id: 1, name: 'public-repo', private: false, visibility: 'public', description: 'ok' }]);
    expect(user.body + repos.body).not.toMatch(/plan|total_private_repos|two_factor|secret-repo|launch|permissions/);
  }, 40000);

  it('still serves public repositories, and marks every answer as not storable', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });

    const tree = await request(vite.port, '/api/github/tree/owner/public-repo?ref=main');
    const readme = await request(vite.port, '/api/github/readme/owner/public-repo?ref=main&path=README.md');
    expect(tree.status).toBe(200);
    expect(JSON.parse(tree.body).tree.map((e) => e.path)).toEqual(['README.md', 'plans/launch.md', 'src/main.py']);
    expect(JSON.parse(readme.body)).toEqual({ path: 'README.md', size: 35, text: '# Public README\n\n## Usage\n\nRun it.\n' });

    for (const res of [tree, readme, await request(vite.port, '/api/github/user/owner'), await request(vite.port, '/api/github/nope')]) {
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.vary).toMatch(/x-github-token/i);
    }
  }, 40000);

  it('never sends a private-capable classic token for repository data at all', async () => {
    const vite = await startVite({ GITHUB_TOKEN: CLASSIC_REPO_SCOPE });

    await request(vite.port, '/api/github/tree/owner/public-repo?ref=main');
    await request(vite.port, '/api/github/readme/owner/public-repo?ref=main&path=README.md');
    const secret = await request(vite.port, '/api/github/readme/owner/secret-repo?ref=main&path=README.md');

    expect(repoDataCalls().length).toBeGreaterThan(0);
    for (const call of repoDataCalls()) expect(call.authorization, call.url).toBeUndefined();
    expect(secret.status).toBe(404);
    expect(secret.body).not.toContain(SECRET_README);
  }, 40000);
});

describe('Vite dev proxy: same rules as production', () => {
  it('forwards a visitor token as Authorization, uses only that token, and keeps it out of logs', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });
    const token = 'ghp_devUserToken123';

    const rate = await request(vite.port, '/api/github/rate_limit', { 'x-github-token': token });
    // This is what the token dialog checks to accept a token
    expect(JSON.parse(rate.body).rate.limit).toBe(5000);
    await request(vite.port, '/api/github/user/octocat', { 'x-github-token': token });
    await request(vite.port, '/api/github/tree/octocat/hello-world?ref=main', { 'x-github-token': token });

    expect(received.map((r) => r.url)).toEqual(['/rate_limit', '/users/octocat', '/repos/octocat/hello-world/git/trees/main?recursive=1']);
    for (const call of received) {
      expect(call.authorization).toBe(`Bearer ${token}`);
      expect(call.clientTokenHeader).toBeUndefined();
    }
    expect(vite.output.join('')).not.toContain(token);
    expect(vite.output.join('')).not.toContain(PRIVILEGED);
  }, 40000);

  it('rejects malformed visitor tokens instead of substituting the server token', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });

    for (const target of ['/api/github/user/octocat', '/api/github/tree/owner/public-repo?ref=feature/x', '/api/github/readme/owner/public-repo?path=README.md']) {
      const res = await request(vite.port, target, { 'x-github-token': 'bad token;' });
      expect(res.status, target).toBe(400);
    }
    expect(received).toHaveLength(0);
  }, 40000);

  it('sends no credentials when none are configured', async () => {
    const vite = await startVite();
    await request(vite.port, '/api/github/user/octocat');
    await request(vite.port, '/api/github/tree/octocat/hello-world?ref=main');
    expect(received.length).toBeGreaterThanOrEqual(2);
    for (const call of received) expect(call.authorization).toBeUndefined();
  }, 40000);

  it('forwards only the supported lookups and validates identifiers, branches and paths', async () => {
    const vite = await startVite({ GITHUB_TOKEN: PRIVILEGED });

    const blocked = [
      '/api/github/search/users?q=x',
      '/api/github/repos/octocat/hello-world/contents/.env',
      '/api/github/user/-bad-',
      '/api/github/tree/octocat/..',
      '/api/github/tree/octocat/repo/extra',
      '/api/github/tree/octocat/hello-world?ref=..%2F..%2Fusers%2Foctocat',
      '/api/github/readme/owner/public-repo?path=src%2Fmain.py',
      '/api/github/readme/owner/public-repo?path=..%2FREADME.md',
      '/api/github/gists',
    ];
    for (const target of blocked) {
      const res = await request(vite.port, target);
      expect([400, 404], target).toContain(res.status);
    }
    expect(received).toHaveLength(0);
  }, 40000);

  it('resolves a branch containing slashes to a commit SHA first, exactly as production does', async () => {
    const vite = await startVite();

    const res = await request(vite.port, '/api/github/tree/octocat/hello-world?ref=feature%2Fnew-ui');
    expect(res.status).toBe(200);
    expect(received.map((r) => r.url)).toEqual([
      '/repos/octocat/hello-world/git/ref/heads/feature/new-ui',
      `/repos/octocat/hello-world/git/trees/${'b'.repeat(40)}?recursive=1`,
    ]);
  }, 40000);

  it('does not expose the server token through anything the dev server serves to the browser', async () => {
    const sentinel = 'sentinel_dev_token_5d81e0aa';
    const vite = await startVite({ GITHUB_TOKEN: sentinel });

    const served = [];
    for (const target of ['/', '/src/main.tsx', '/src/App.tsx', '/src/services/github.ts', '/@vite/client', '/@vite/env', '/vite.config.ts', '/server.js', '/.env.local', '/.env', '/api/github/rate_limit', '/api/github/user/octocat']) {
      const res = await request(vite.port, target);
      served.push(res.body + JSON.stringify(res.headers));
    }
    expect(served.join('\n')).not.toContain(sentinel);
    expect(vite.output.join('')).not.toContain(sentinel);
  }, 40000);
});
