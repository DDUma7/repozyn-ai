import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// HTTP-level regression tests for the production server (server.js).
// Each test talks to a real `node server.js` child process over the network, with a
// local fake standing in for api.github.com.

const SERVER_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js');
const SECRET = 'TOP-SECRET-OUTSIDE-STATIC-ROOT';
const INDEX_HTML = '<!doctype html><title>spa-index</title>';
const FAKE_SERVER_TOKEN = 'test_server_token_123';

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

// Sends the request target exactly as given (no client-side URL normalisation)
function request(port, target, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Writes raw bytes to the socket, for requests no well-behaved HTTP client would produce
function rawRequest(port, payload) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.on('data', (c) => (data += c.toString('utf8')));
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
    socket.setTimeout(2000, () => socket.destroy());
  });
}

let tmpRoot;
let distDir;
let upstream;
let upstreamPort;
let upstreamCalls = [];
let upstreamActive = 0;
let upstreamPeak = 0;
const running = [];

async function startServer(extraEnv = {}) {
  const port = await getFreePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      STATIC_DIR: distDir,
      GITHUB_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      GITHUB_TOKEN: FAKE_SERVER_TOKEN,
      TRUST_PROXY: '1',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  running.push(child);

  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await request(port, '/health');
      if (res.status === 200) return { port, child };
    } catch {
      // not listening yet
    }
    await sleep(50);
  }
  throw new Error('server did not become healthy');
}

async function expectAlive({ port, child }) {
  const health = await request(port, '/health');
  expect(health.status).toBe(200);
  expect(child.exitCode).toBeNull();
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repozyn-server-test-'));
  distDir = path.join(tmpRoot, 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("app")');
  fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), SECRET);
  fs.symlinkSync(path.join(tmpRoot, 'secret.txt'), path.join(distDir, 'leak.txt'));

  upstream = http.createServer((req, res) => {
    upstreamCalls.push({ url: req.url, authorization: req.headers.authorization });
    upstreamActive += 1;
    upstreamPeak = Math.max(upstreamPeak, upstreamActive);
    res.on('close', () => (upstreamActive -= 1));

    const rateHeaders = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1900000000', 'x-ratelimit-used': '1' };
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...rateHeaders });
      res.end(JSON.stringify(payload));
    };

    if (req.url === '/rate_limit') return send(200, { rate: { limit: 5000, remaining: 4999, reset: 1900000000, used: 1 } });

    const match = /^\/users\/([^/?]+)(\/repos)?/.exec(req.url || '');
    if (!match) return send(404, { message: 'Not Found' });
    const [, login, isRepos] = match;

    if (login.startsWith('hang')) return undefined; // never answers
    if (login.startsWith('ghost')) return send(404, { message: 'Not Found' });
    const payload = isRepos ? [{ id: 1, name: `${login}-repo` }] : { login, id: 1 };
    if (login.startsWith('slow')) return void setTimeout(() => send(200, payload), 300);
    return send(200, payload);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamPort = upstream.address().port;
});

afterEach(() => {
  while (running.length) running.pop().kill('SIGKILL');
  upstreamCalls = [];
  upstreamPeak = 0;
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('server.js static file containment', () => {
  it('rejects percent-encoded directory traversal out of the static root', async () => {
    const server = await startServer();
    const attacks = [
      '/..%2fsecret.txt',
      '/..%2Fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/%2e%2e%2Fsecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/assets%2f..%2f..%2fsecret.txt',
      '/..%5csecret.txt',
      '/%2e%2e%5csecret.txt',
      '/..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/%252e%252e%252fsecret.txt',
      '/assets/app.js%00/..%2f..%2fsecret.txt',
    ];

    for (const target of attacks) {
      const res = await request(server.port, target);
      expect(res.body, target).not.toContain(SECRET);
      expect(res.body, target).not.toContain('root:');
      expect([200, 400, 404], target).toContain(res.status);
      // Anything answered with 200 may only ever be the SPA shell
      if (res.status === 200) expect(res.body, target).toBe(INDEX_HTML);
    }

    const encodedSlash = await request(server.port, '/..%2fsecret.txt');
    expect(encodedSlash.status).toBe(400);
    await expectAlive(server);
  });

  it('does not follow symlinks that point outside the static root', async () => {
    const server = await startServer();
    const res = await request(server.port, '/leak.txt');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(SECRET);
  });

  it('still serves assets and falls back to index.html for SPA routes', async () => {
    const server = await startServer();

    const root = await request(server.port, '/');
    expect(root.status).toBe(200);
    expect(root.body).toBe(INDEX_HTML);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.headers['x-content-type-options']).toBe('nosniff');

    const route = await request(server.port, '/audit/some-user?tab=roast');
    expect(route.status).toBe(200);
    expect(route.body).toBe(INDEX_HTML);

    const asset = await request(server.port, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.body).toBe('console.log("app")');
    expect(asset.headers['content-type']).toContain('application/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    // A missing build asset is a real 404, never the HTML shell with a long-lived cache header
    const missingAsset = await request(server.port, '/assets/index-stale123.js');
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.body).not.toBe(INDEX_HTML);
    expect(missingAsset.headers['cache-control']).toBe('no-store');

    const head = await request(server.port, '/assets/app.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');

    const post = await request(server.port, '/', { method: 'POST' });
    expect(post.status).toBe(405);
  });
});

describe('server.js malformed request handling', () => {
  it('answers malformed URLs with 400 and keeps the process alive', async () => {
    const server = await startServer();
    const malformed = ['/%', '/%E0%A4%A', '/%zz/index.html', '/assets/%c0%af', '/api/github/user/%', '/api/github/repos/%E0%A4%A'];

    for (const target of malformed) {
      const res = await request(server.port, target);
      expect(res.status, target).toBe(400);
      await expectAlive(server);
    }
  });

  it('survives raw protocol garbage and hostile Host headers', async () => {
    const server = await startServer();

    const garbage = await rawRequest(server.port, 'NOT A VALID REQUEST\r\n\r\n');
    expect(garbage).toContain('400');
    await expectAlive(server);

    const badHost = await rawRequest(server.port, 'GET /audit HTTP/1.1\r\nHost: [not-a-host\r\nConnection: close\r\n\r\n');
    expect(badHost).toMatch(/^HTTP\/1\.1 (200|400)/);
    await expectAlive(server);

    const absolute = await rawRequest(server.port, 'GET http://[::bad/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(absolute).toMatch(/^HTTP\/1\.1 400/);
    await expectAlive(server);
  });
});

describe('server.js GitHub proxy abuse protection', () => {
  it('proxies legitimate lookups with the server token and caches them', async () => {
    const server = await startServer();

    const user = await request(server.port, '/api/github/user/octocat');
    expect(user.status).toBe(200);
    expect(JSON.parse(user.body)).toEqual({ login: 'octocat', id: 1 });
    expect(user.headers['x-cache']).toBe('MISS');
    expect(user.headers['x-ratelimit-limit']).toBe('5000');

    const repos = await request(server.port, '/api/github/repos/octocat');
    expect(repos.status).toBe(200);
    expect(JSON.parse(repos.body)).toEqual([{ id: 1, name: 'octocat-repo' }]);

    const rate = await request(server.port, '/api/github/rate_limit');
    expect(rate.status).toBe(200);
    expect(JSON.parse(rate.body).rate.limit).toBe(5000);

    const again = await request(server.port, '/api/github/user/OctoCat');
    expect(again.status).toBe(200);
    expect(again.headers['x-cache']).toBe('HIT');
    expect(again.body).toBe(user.body);

    expect(upstreamCalls.map((c) => c.url)).toEqual([
      '/users/octocat',
      '/users/octocat/repos?per_page=100&sort=updated&direction=desc',
      '/rate_limit',
    ]);
    expect(upstreamCalls.every((c) => c.authorization === `Bearer ${FAKE_SERVER_TOKEN}`)).toBe(true);
    // The server-side token must never be echoed back to the browser
    expect(user.body + repos.body + rate.body + JSON.stringify(user.headers)).not.toContain(FAKE_SERVER_TOKEN);
  });

  it('returns complete, valid JSON for repeated user and repos lookups (cache hits)', async () => {
    const server = await startServer();

    for (const [target, expected] of [
      ['/api/github/user/octocat', { login: 'octocat', id: 1 }],
      ['/api/github/repos/octocat', [{ id: 1, name: 'octocat-repo' }]],
    ]) {
      const first = await request(server.port, target);
      expect(first.headers['x-cache']).toBe('MISS');

      for (let i = 0; i < 3; i++) {
        const hit = await request(server.port, target);
        expect(hit.status).toBe(200);
        expect(hit.headers['x-cache']).toBe('HIT');
        expect(hit.headers['content-type']).toContain('application/json');
        expect(hit.headers['x-ratelimit-limit']).toBe('5000');
        expect(hit.body.length).toBeGreaterThan(0);
        expect(hit.body).toBe(first.body);
        expect(JSON.parse(hit.body)).toEqual(expected);
      }
    }
    expect(upstreamCalls).toHaveLength(2);
  });

  it('prefers a well-formed client token and rejects malformed ones', async () => {
    const server = await startServer();

    const ok = await request(server.port, '/api/github/user/octocat', { headers: { 'x-github-token': 'ghp_clientToken42' } });
    expect(ok.status).toBe(200);
    expect(upstreamCalls[0].authorization).toBe('Bearer ghp_clientToken42');

    const bad = await request(server.port, '/api/github/user/octocat', { headers: { 'x-github-token': 'abc def;' } });
    expect(bad.status).toBe(400);
    expect(upstreamCalls).toHaveLength(1);
  });

  it('rejects invalid usernames and unknown proxy paths without calling GitHub', async () => {
    const server = await startServer();

    expect((await request(server.port, '/api/github/user/-bad-')).status).toBe(400);
    expect((await request(server.port, '/api/github/user/a%2fb')).status).toBe(400);
    expect((await request(server.port, '/api/github/repos/x%2f..%2f..%2fgists')).status).toBe(400);
    expect((await request(server.port, '/api/github/search/users')).status).toBe(404);
    expect((await request(server.port, '/api/github/user/octocat', { method: 'POST' })).status).toBe(405);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('rate limits each client IP and cannot be bypassed by spoofing X-Forwarded-For', async () => {
    const server = await startServer({ PROXY_RATE_LIMIT_MAX: '5' });
    const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });

    for (let i = 0; i < 5; i++) {
      expect((await request(server.port, '/api/github/user/octocat', from('203.0.113.7'))).status).toBe(200);
    }

    const limited = await request(server.port, '/api/github/user/octocat', from('203.0.113.7'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');

    // Prepending a fake hop does not change the trusted (last) address
    const spoofed = await request(server.port, '/api/github/user/octocat', from('198.51.100.99, 203.0.113.7'));
    expect(spoofed.status).toBe(429);

    const otherClient = await request(server.port, '/api/github/user/octocat', from('203.0.113.8'));
    expect(otherClient.status).toBe(200);

    // The limiter only guards the proxy; the app itself keeps loading
    expect((await request(server.port, '/', from('203.0.113.7'))).status).toBe(200);
  });

  it('caps uncached GitHub lookups per client so one caller cannot drain the quota', async () => {
    const server = await startServer({ PROXY_UPSTREAM_IP_MAX: '3' });
    const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });

    for (const name of ['user-a', 'user-b', 'user-c']) {
      expect((await request(server.port, `/api/github/user/${name}`, from('203.0.113.7'))).status).toBe(200);
    }
    const drained = await request(server.port, '/api/github/user/user-d', from('203.0.113.7'));
    expect(drained.status).toBe(429);
    expect(upstreamCalls).toHaveLength(3);

    // Cached profiles stay available to the throttled client
    const cached = await request(server.port, '/api/github/user/user-a', from('203.0.113.7'));
    expect(cached.status).toBe(200);
    expect(cached.headers['x-cache']).toBe('HIT');
    expect(upstreamCalls).toHaveLength(3);
  });

  it('enforces a global budget on the shared server quota across many client IPs', async () => {
    const server = await startServer({ PROXY_UPSTREAM_GLOBAL_MAX: '2' });

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(server.port, `/api/github/user/botnet-${i}`, { headers: { 'x-forwarded-for': `198.51.100.${i}` } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
    expect(upstreamCalls).toHaveLength(2);
  });

  it('caches "not found" lookups so repeated typos cost no quota', async () => {
    const server = await startServer();

    expect((await request(server.port, '/api/github/user/ghost-user')).status).toBe(404);
    const second = await request(server.port, '/api/github/user/ghost-user');
    expect(second.status).toBe(404);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(upstreamCalls).toHaveLength(1);
  });

  it('coalesces identical in-flight lookups into one upstream request', async () => {
    const server = await startServer();

    const results = await Promise.all(Array.from({ length: 6 }, () => request(server.port, '/api/github/user/slow-same')));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(upstreamCalls).toHaveLength(1);
  });

  it('bounds concurrent upstream requests', async () => {
    const server = await startServer({ PROXY_MAX_CONCURRENT: '2' });

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => request(server.port, `/api/github/user/slow-${i}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(statuses.filter((s) => s === 503)).toHaveLength(4);
    expect(results.find((r) => r.status === 503).headers['retry-after']).toBe('1');
    expect(upstreamPeak).toBeLessThanOrEqual(2);
    expect(upstreamCalls).toHaveLength(2);

    // Capacity is released once the slow requests finish
    expect((await request(server.port, '/api/github/user/octocat')).status).toBe(200);
  });

  it('times out a hanging upstream instead of holding the connection open', async () => {
    const server = await startServer({ PROXY_UPSTREAM_TIMEOUT_MS: '250', PROXY_MAX_CONCURRENT: '1' });

    const startedAt = Date.now();
    const res = await request(server.port, '/api/github/user/hang-forever');
    expect(res.status).toBe(504);
    expect(Date.now() - startedAt).toBeLessThan(3000);

    // The concurrency slot is freed and the failure is not cached
    await expectAlive(server);
    expect((await request(server.port, '/api/github/user/octocat')).status).toBe(200);
  });

  it('returns 502 when GitHub is unreachable', async () => {
    const deadPort = await getFreePort();
    const server = await startServer({ GITHUB_API_BASE_URL: `http://127.0.0.1:${deadPort}` });

    const res = await request(server.port, '/api/github/user/octocat');
    expect(res.status).toBe(502);
    await expectAlive(server);
  });
});
