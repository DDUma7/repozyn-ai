import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Privacy copy and deployment ignore files', () => {
  it('README describes the proxy instead of claiming client-side-only processing', () => {
    const readme = read('README.md');
    expect(readme).not.toMatch(/100% in the user's browser/i);
    expect(readme).not.toMatch(/transmitted solely to/i);
    expect(readme).not.toMatch(/client-side privacy/i);
    expect(readme).toMatch(/x-github-token/);
    expect(readme).toMatch(/proxy/i);
  });

  it.each(['.dockerignore', '.gcloudignore'])('%s excludes secrets, VCS data, dependencies and build output', (file) => {
    const lines = read(file).split('\n').map((l) => l.trim());
    for (const required of ['.git', 'node_modules', 'dist', '.env', '.env.*']) {
      expect(lines, `${file} should list ${required}`).toContain(required);
    }
    expect(lines.some((l) => l.endsWith('*credentials*.json'))).toBe(true);
    expect(lines.some((l) => l.endsWith('*.pem'))).toBe(true);
    expect(lines.some((l) => l.endsWith('*.key'))).toBe(true);
    // Files the container build needs must not be excluded
    for (const needed of ['src', 'public', 'server.js', 'package.json', 'package-lock.json', 'Dockerfile', 'index.html']) {
      expect(lines, `${file} must not exclude ${needed}`).not.toContain(needed);
    }
  });
});
