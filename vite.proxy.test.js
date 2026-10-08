import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression tests for the Vite dev-server GitHub proxy (vite.config.ts): a token the user
// enters in the app must reach GitHub as an Authorization header, exactly as in production.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
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
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => output.push(c.toString()));
  child.stderr.on('data', (c) => output.push(c.toString()));
  running.push(child);

  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`vite exited early with code ${child.exitCode}`);
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
    received.push({ url: req.url, authorization: req.headers.authorization, clientTokenHeader: req.headers['x-github-token'] });
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-ratelimit-limit': req.headers.authorization ? '5000' : '60' });
    res.end(JSON.stringify({ rate: { limit: req.headers.authorization ? 5000 : 60, remaining: 1, reset: 0, used: 0 } }));
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

describe('Vite dev proxy GitHub token forwarding', () => {
  it('forwards a user-provided token as Authorization and keeps it out of logs', async () => {
    const vite = await startVite();
    const token = 'ghp_devUserToken123';

    const rate = await request(vite.port, '/api/github/rate_limit', { 'x-github-token': token });
    expect(rate.status).toBe(200);
    // This is what TokenModal checks to accept a token
    expect(JSON.parse(rate.body).rate.limit).toBe(5000);

    await request(vite.port, '/api/github/user/octocat', { 'x-github-token': token });
    await request(vite.port, '/api/github/repos/octocat', { 'x-github-token': token });

    expect(received.map((r) => r.url)).toEqual([
      '/rate_limit',
      '/users/octocat',
      '/users/octocat/repos?per_page=100&sort=updated&direction=desc',
    ]);
    for (const call of received) {
      expect(call.authorization).toBe(`Bearer ${token}`);
      expect(call.clientTokenHeader).toBeUndefined();
    }
    expect(vite.output.join('')).not.toContain(token);
  }, 40000);

  it('sends no Authorization without a token and ignores malformed tokens', async () => {
    const vite = await startVite();

    await request(vite.port, '/api/github/user/octocat');
    await request(vite.port, '/api/github/user/octocat', { 'x-github-token': 'bad token;' });

    expect(received).toHaveLength(2);
    for (const call of received) {
      expect(call.authorization).toBeUndefined();
      expect(call.clientTokenHeader).toBeUndefined();
    }
  }, 40000);

  it('lets a user token take priority over the server-side GITHUB_TOKEN', async () => {
    const vite = await startVite({ GITHUB_TOKEN: 'server_env_token_1' });

    await request(vite.port, '/api/github/user/octocat');
    await request(vite.port, '/api/github/user/octocat', { 'x-github-token': 'ghp_userWins456' });

    expect(received.map((r) => r.authorization)).toEqual(['Bearer server_env_token_1', 'Bearer ghp_userWins456']);
  }, 40000);
});
