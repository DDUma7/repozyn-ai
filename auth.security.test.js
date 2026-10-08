import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards against a GitHub token ever being shipped to browsers or committed to the repository.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

// Shapes of real GitHub credentials (classic, fine-grained, OAuth, app and refresh tokens)
const REAL_TOKEN_SHAPE = /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/;

describe('GitHub token hygiene', () => {
  it('keeps the server token out of the production browser bundle', () => {
    const sentinel = 'sentinel_server_token_7f3a9c21';
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repozyn-bundle-check-'));
    try {
      const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_TOKEN: sentinel },
        encoding: 'utf8',
      });
      expect(build.status, build.stderr).toBe(0);
      expect(build.stdout + build.stderr).not.toContain(sentinel);

      const built = listFiles(outDir);
      expect(built.length).toBeGreaterThan(1);
      for (const file of built) {
        expect(fs.readFileSync(file, 'utf8'), path.basename(file)).not.toContain(sentinel);
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120000);

  it('never references the server token from browser source code', () => {
    const sources = listFiles(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f));
    expect(sources.length).toBeGreaterThan(10);
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/GITHUB_TOKEN/);
      expect(text, file).not.toMatch(/VITE_[A-Z_]*(TOKEN|SECRET|KEY)/);
      expect(text, file).not.toMatch(/process\.env/);
    }
  });

  it('contains no real-looking GitHub credential anywhere in the repository files', () => {
    const files = listFiles(ROOT).filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|lockb)$/.test(f) && !f.endsWith('package-lock.json') && !/\.env(\.|$)/.test(path.basename(f)) );
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file)).not.toMatch(REAL_TOKEN_SHAPE);
    }
  });

  it('ships an example env file with no value and keeps real env files out of git, Docker and Cloud Build', () => {
    const example = read('.env.example');
    expect(example).toMatch(/^GITHUB_TOKEN=\s*$/m);
    expect(example).not.toMatch(REAL_TOKEN_SHAPE);

    for (const ignoreFile of ['.gitignore', '.dockerignore', '.gcloudignore']) {
      const lines = read(ignoreFile).split('\n').map((l) => l.trim());
      expect(lines, ignoreFile).toContain('.env');
      expect(lines, ignoreFile).toContain('.env.*');
    }

    // git itself agrees: local env files are ignored, the example is not
    const ignored = (file) => spawnSync('git', ['check-ignore', '-q', file], { cwd: ROOT }).status === 0;
    for (const file of ['.env', '.env.local', '.env.production', '.env.development.local']) {
      expect(ignored(file), file).toBe(true);
    }
    expect(ignored('.env.example')).toBe(false);
  });

  it('does not bake a token into the container image or pass one at build time', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).not.toMatch(/GITHUB_TOKEN/);
    expect(dockerfile).not.toMatch(/\bARG\b.*(TOKEN|SECRET)/i);
    expect(dockerfile).not.toMatch(/COPY\s+\.env/);
  });

  it('reads the server token once in server.js and never logs or returns it', () => {
    const server = read('server.js');
    expect(server.match(/process\.env\.GITHUB_TOKEN/g)).toHaveLength(2); // one read, one delete
    expect(server).toContain('delete process.env.GITHUB_TOKEN');
    for (const line of server.split('\n').filter((l) => /console\.|sendJson|sendText|res\.end|setHeader/.test(l))) {
      expect(line).not.toMatch(/SERVER_TOKEN\b(?!_MALFORMED)(?! \?)|auth\.token|clientToken\b(?! &&)(?!\))/);
    }
    // Cache keys are built from owner, repository and branch only
    for (const line of server.split('\n').filter((l) => /cacheKey = |listKey = /.test(l))) {
      expect(line).not.toMatch(/token/i);
    }
  });
});
