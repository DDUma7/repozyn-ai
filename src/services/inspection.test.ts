import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GitHubRepo } from '../types/github';
import type { RepoTree, RepoTreeEntry, RepoTreeResult } from '../types/evidence';
import { EVIDENCE_CATEGORIES } from '../types/evidence';
import {
  INSPECTION_LIMITS,
  inspectRepoTree,
  normalizeRepoTree,
  notInspected,
  selectReposForInspection,
  summarizeEvidence,
} from './inspection';
import { buildUninspectedEvidence, inspectPortfolio } from './inspectionRunner';
import { fetchRepoTree, clearApiCache, getLastObservedRateLimit, isValidBranchName } from './github';
import { MOCK_PROFILES } from '../data/mockProfiles';

const file = (path: string, size = 100): RepoTreeEntry => ({ path, type: 'blob', size });
const tree = (paths: Array<string | RepoTreeEntry>, truncated = false): RepoTree => ({
  entries: paths.map((p) => (typeof p === 'string' ? file(p) : p)),
  truncated,
});

const repo = (name: string, overrides: Partial<GitHubRepo> = {}): GitHubRepo => ({
  ...MOCK_PROFILES[1].repos[0],
  id: name.length,
  name,
  full_name: `dev/${name}`,
  html_url: `https://github.com/dev/${name}`,
  fork: false,
  size: 100,
  stargazers_count: 0,
  pushed_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

const REPO = repo('sample');

describe('normalizeRepoTree', () => {
  it('keeps only path, type and size, drops vendored and malformed entries, and orders shallowest first', () => {
    const result = normalizeRepoTree({
      truncated: false,
      tree: [
        { path: 'src/deep/a.ts', type: 'blob', size: 5, sha: 'abc', url: 'https://example.invalid' },
        { path: 'README.md', type: 'blob', size: 900 },
        { path: 'src', type: 'tree', size: 4 },
        { path: 'node_modules/pkg/index.js', type: 'blob' },
        { path: 'app/vendor/lib.js', type: 'blob' },
        { path: 'sub', type: 'commit' },
        { path: 42, type: 'blob' },
        { path: 'x'.repeat(INSPECTION_LIMITS.maxPathLength + 1), type: 'blob' },
        null,
      ],
    });

    expect(result).toEqual({
      truncated: false,
      entries: [
        { path: 'README.md', type: 'blob', size: 900 },
        { path: 'src', type: 'tree' },
        { path: 'src/deep/a.ts', type: 'blob', size: 5 },
      ],
    });
  });

  it('caps the listing and marks it truncated', () => {
    const many = Array.from({ length: INSPECTION_LIMITS.maxEntriesPerRepo + 50 }, (_, i) => ({ path: `a/b/f${i}.txt`, type: 'blob' }));
    const result = normalizeRepoTree({ tree: [...many, { path: 'README.md', type: 'blob' }] });
    expect(result.entries).toHaveLength(INSPECTION_LIMITS.maxEntriesPerRepo);
    expect(result.truncated).toBe(true);
    expect(result.entries[0].path).toBe('README.md');
  });

  it('tolerates junk input without throwing', () => {
    for (const junk of [null, undefined, 'text', 7, {}, { tree: 'nope' }]) {
      expect(normalizeRepoTree(junk)).toEqual({ entries: [], truncated: false });
    }
    expect(normalizeRepoTree({ tree: [], truncated: true }).truncated).toBe(true);
  });
});

describe('inspectRepoTree', () => {
  it('reports found evidence with source paths, signals and high confidence', () => {
    const result = inspectRepoTree(
      REPO,
      tree([
        file('README.md', 4096),
        'package.json',
        'src/App.tsx',
        'src/utils/math.test.ts',
        'vitest.config.ts',
        '.github/workflows/ci.yml',
        '.github/workflows/deploy.yml',
        'Dockerfile',
        'docs/architecture.md',
        'CONTRIBUTING.md',
      ])
    );

    expect(result.state).toBe('inspected');
    expect(result.entriesInspected).toBe(10);

    expect(result.findings.readme).toMatchObject({ status: 'found', confidence: 'high', sourcePaths: ['README.md'] });
    expect(result.findings.readme.summary).toContain('4.0 KB');
    expect(result.findings.readme.summary).toMatch(/contents were not read/i);
    expect(result.findings.readme.signals).toEqual(expect.arrayContaining(['readme-root', 'readme-substantial']));

    expect(result.findings.tests).toMatchObject({ status: 'found', confidence: 'high', matchCount: 2 });
    expect(result.findings.tests.sourcePaths).toEqual(expect.arrayContaining(['src/utils/math.test.ts', 'vitest.config.ts']));

    expect(result.findings.ci).toMatchObject({ status: 'found', confidence: 'high', matchCount: 2 });
    expect(result.findings.ci.signals).toContain('gha-ci-workflow');
    expect(result.findings.ci.summary).toMatch(/whether they pass was not checked/i);

    expect(result.findings.deployment.status).toBe('found');
    expect(result.findings.deployment.signals).toEqual(expect.arrayContaining(['container-definition', 'deploy-workflow']));
    expect(result.findings.deployment.sourcePaths[0]).toBe('Dockerfile');

    expect(result.findings.documentation).toMatchObject({ status: 'found', confidence: 'high' });
    expect(result.findings.documentation.sourcePaths).toEqual(expect.arrayContaining(['docs/architecture.md', 'CONTRIBUTING.md']));

    expect(result.markers.map((m) => m.id)).toEqual(expect.arrayContaining(['node-project', 'frontend-app', 'containers', 'automation']));
  });

  it('says "not found in inspected paths" with at most medium confidence when the full listing has no match', () => {
    const result = inspectRepoTree(REPO, tree(['main.py', 'utils/helpers.py', 'LICENSE']));

    for (const category of EVIDENCE_CATEGORIES) {
      const finding = result.findings[category];
      expect(finding.status).toBe('not_found');
      expect(finding.confidence).not.toBe('high');
      expect(finding.sourcePaths).toEqual([]);
      expect(finding.summary).toMatch(/found in the 3 inspected file paths/);
      expect(finding.summary).toMatch(/may exist under an unconventional name/i);
    }
  });

  it('reports unknown, never not_found, when the listing was truncated', () => {
    const result = inspectRepoTree(REPO, tree(['README.md', 'src/index.js'], true));

    expect(result.state).toBe('partial');
    expect(result.truncated).toBe(true);
    // Evidence that was seen still counts
    expect(result.findings.readme.status).toBe('found');
    for (const category of ['tests', 'ci', 'deployment', 'documentation'] as const) {
      expect(result.findings[category].status).toBe('unknown');
      expect(result.findings[category].confidence).toBe('low');
      expect(result.findings[category].summary).toMatch(/inconclusive/i);
    }
  });

  it('uses medium confidence when only a directory name suggests the evidence', () => {
    const result = inspectRepoTree(REPO, tree(['README.md', 'tests/helpers.py']));
    expect(result.findings.tests).toMatchObject({ status: 'found', confidence: 'medium', strength: 'weak', signals: ['test-directory-name'] });
    expect(result.findings.tests.summary).toMatch(/Weak signal only/i);
  });

  it('recognises test conventions across languages without matching look-alike names', () => {
    const positives = ['pkg/server_test.go', 'tests/test_api.py', 'spec/models/user_spec.rb', 'src/test/java/UserTest.java', 'app/Feature.spec.ts', 'conftest.py'];
    for (const path of positives) {
      expect(inspectRepoTree(REPO, tree([path])).findings.tests.status, path).toBe('found');
    }

    const negatives = ['src/Latest.java', 'src/contest.cs', 'src/audit.kt', 'latest.py', 'src/attestation.ts', 'protest.md'];
    expect(inspectRepoTree(REPO, tree(negatives)).findings.tests.status).toBe('not_found');
  });

  it('distinguishes GitHub Actions from other CI providers and ignores non-workflow files', () => {
    const other = inspectRepoTree(REPO, tree(['.gitlab-ci.yml', 'app.py']));
    expect(other.findings.ci.status).toBe('found');
    expect(other.findings.ci.signals).toEqual(['other-ci-provider']);
    expect(other.findings.ci.summary).toMatch(/no GitHub Actions CI workflow/i);

    const notWorkflows = inspectRepoTree(REPO, tree(['.github/ISSUE_TEMPLATE/bug.yml', '.github/dependabot.yml', '.github/workflows/README.md']));
    expect(notWorkflows.findings.ci.status).toBe('not_found');
  });

  it('recognises deployment configuration types and does not mistake unrelated workflows for deployment', () => {
    for (const path of ['vercel.json', 'netlify.toml', 'docker-compose.yml', 'infra/main.tf', 'k8s/deployment.yaml', 'Procfile', 'api/Dockerfile.prod']) {
      expect(inspectRepoTree(REPO, tree([path])).findings.deployment.status, path).toBe('found');
    }
    const lintOnly = inspectRepoTree(REPO, tree(['.github/workflows/lint.yml', '.github/workflows/abcd.yml', 'app.json']));
    expect(lintOnly.findings.deployment.status).toBe('not_found');
  });

  it('does not count the README or a license as additional documentation', () => {
    const result = inspectRepoTree(REPO, tree(['README.md', 'LICENSE', 'src/main.rs']));
    expect(result.findings.documentation.status).toBe('not_found');
  });

  it('notes a missing root README separately from nested ones', () => {
    const result = inspectRepoTree(REPO, tree(['packages/core/README.md', 'packages/core/index.ts']));
    expect(result.findings.readme).toMatchObject({ status: 'found', confidence: 'medium', signals: ['readme-nested'] });
    expect(result.findings.readme.summary).toMatch(/No README at the repository root/);
  });

  it('ignores evidence inside vendored directories', () => {
    const result = inspectRepoTree(REPO, tree(['index.js', 'node_modules/lib/README.md', 'node_modules/lib/lib.test.js', 'vendor/tool/Dockerfile']));
    expect(result.entriesInspected).toBe(1);
    for (const category of EVIDENCE_CATEGORIES) {
      expect(result.findings[category].status).toBe('not_found');
    }
  });

  it('bounds the quoted source paths while keeping the true match count', () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/module${i}.test.ts`);
    const result = inspectRepoTree(REPO, tree(many));
    expect(result.findings.tests.matchCount).toBe(40);
    expect(result.findings.tests.sourcePaths).toHaveLength(INSPECTION_LIMITS.maxSourcePaths);
  });

  it('records neutral stack markers with their source paths', () => {
    const result = inspectRepoTree(
      REPO,
      tree(['notebooks/eda.ipynb', 'requirements.txt', 'train.py', 'models/model.onnx', 'data/raw.csv', 'migrations/001_init.sql', 'openapi.yaml', 'infra/main.tf', 'Makefile'])
    );
    const ids = result.markers.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['notebooks', 'python-project', 'ml-training', 'ml-models', 'datasets', 'database', 'api-spec', 'infrastructure', 'ops-scripts']));
    expect(result.markers.find((m) => m.id === 'notebooks')).toMatchObject({ sourcePaths: ['notebooks/eda.ipynb'], matchCount: 1 });
  });

  it('is deterministic regardless of input order', () => {
    const paths = ['README.md', 'src/a.test.ts', '.github/workflows/ci.yml', 'Dockerfile', 'docs/guide.md', 'src/b.test.ts'];
    const forward = inspectRepoTree(REPO, tree(paths));
    const reversed = inspectRepoTree(REPO, tree([...paths].reverse()));
    expect(reversed).toEqual(forward);
  });

  it('treats a repository with no files as not inspected rather than as lacking everything', () => {
    const result = inspectRepoTree(REPO, tree([]));
    expect(result).toMatchObject({ state: 'not_inspected', reason: 'empty' });
    expect(result.findings.tests.status).toBe('unknown');
  });
});

describe('selectReposForInspection and summarizeEvidence', () => {
  it('skips forks and empty repositories and ranks the rest by stars, then recency, then name', () => {
    const repos = [
      repo('fork-popular', { fork: true, stargazers_count: 999 }),
      repo('empty', { size: 0 }),
      repo('old-quiet', { pushed_at: '2020-01-01T00:00:00Z' }),
      repo('starred', { stargazers_count: 50 }),
      repo('recent-quiet', { pushed_at: '2025-06-01T00:00:00Z' }),
      repo('b-tie', { pushed_at: '2022-01-01T00:00:00Z' }),
      repo('a-tie', { pushed_at: '2022-01-01T00:00:00Z' }),
    ];

    const result = selectReposForInspection(repos, 3);
    expect(result.selected.map((r) => r.name)).toEqual(['starred', 'recent-quiet', 'a-tie']);
    expect(result.eligibleCount).toBe(5);
    expect(result.skipped.map((s) => `${s.repo.name}:${s.reason}`)).toEqual([
      'fork-popular:fork',
      'empty:empty',
      'b-tie:not_selected',
      'old-quiet:not_selected',
    ]);
    expect(selectReposForInspection([...repos].reverse(), 3).selected.map((r) => r.name)).toEqual(['starred', 'recent-quiet', 'a-tie']);
  });

  it('never selects more than the hard repository limit', () => {
    const repos = Array.from({ length: 30 }, (_, i) => repo(`r${i}`));
    expect(selectReposForInspection(repos, 500).selected).toHaveLength(INSPECTION_LIMITS.maxRepos);
    expect(selectReposForInspection(repos, -4).selected).toHaveLength(0);
  });

  it('counts coverage only over repositories that were actually inspected', () => {
    const inspections = [
      inspectRepoTree(repo('full'), tree(['README.md', 'a.test.ts'])),
      inspectRepoTree(repo('bare'), tree(['main.c'])),
      inspectRepoTree(repo('partial'), tree(['main.c'], true)),
      notInspected(repo('skipped'), 'not_selected'),
      notInspected(repo('limited'), 'rate_limited'),
    ];
    const summary = summarizeEvidence(inspections, 5, 4);

    expect(summary.inspectedCount).toBe(3);
    expect(summary.coverage.tests).toEqual({ found: 1, notFound: 1, unknown: 1 });
    expect(summary.coverage.readme).toEqual({ found: 1, notFound: 1, unknown: 1 });
    expect(summary.method).toBe('file-paths-only');
    expect(summary.limits).toEqual({ maxRepos: INSPECTION_LIMITS.maxRepos, maxEntriesPerRepo: INSPECTION_LIMITS.maxEntriesPerRepo });
  });
});

describe('inspectPortfolio runner', () => {
  const ok = (paths: string[]): RepoTreeResult => ({ ok: true, tree: tree(paths) });

  it('makes at most one request per selected repository and respects the concurrency bound', async () => {
    const repos = Array.from({ length: 12 }, (_, i) => repo(`r${String(i).padStart(2, '0')}`, { stargazers_count: 12 - i }));
    let active = 0;
    let peak = 0;
    const fetchTree = vi.fn(async (_owner: string, name: string, _branch: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return ok(['README.md', `${name}.test.ts`]);
    });

    const evidence = await inspectPortfolio('dev', repos, { fetchTree, concurrency: 2 });

    expect(fetchTree).toHaveBeenCalledTimes(INSPECTION_LIMITS.maxRepos);
    expect(new Set(fetchTree.mock.calls.map((c) => c[1])).size).toBe(INSPECTION_LIMITS.maxRepos);
    expect(fetchTree.mock.calls.every((c) => c[0] === 'dev')).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(evidence.selectedCount).toBe(INSPECTION_LIMITS.maxRepos);
    expect(evidence.inspectedCount).toBe(INSPECTION_LIMITS.maxRepos);
    expect(evidence.repos).toHaveLength(12);
    expect(evidence.repos.filter((r) => r.reason === 'not_selected')).toHaveLength(6);
    expect(evidence.coverage.tests.found).toBe(INSPECTION_LIMITS.maxRepos);
  });

  it('clamps concurrency to a safe maximum', async () => {
    const repos = Array.from({ length: 6 }, (_, i) => repo(`r${i}`));
    let active = 0;
    let peak = 0;
    const fetchTree = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return ok(['README.md']);
    };
    await inspectPortfolio('dev', repos, { fetchTree, concurrency: 50 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('stops requesting as soon as a rate limit is reported and marks the rest as not inspected', async () => {
    const repos = Array.from({ length: 6 }, (_, i) => repo(`r${i}`, { stargazers_count: 6 - i }));
    const fetchTree = vi
      .fn<(owner: string, name: string, branch: string) => Promise<RepoTreeResult>>()
      .mockResolvedValueOnce(ok(['README.md']))
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      .mockResolvedValue(ok(['README.md']));

    const evidence = await inspectPortfolio('dev', repos, { fetchTree, concurrency: 1 });

    expect(fetchTree).toHaveBeenCalledTimes(2);
    expect(evidence.inspectedCount).toBe(1);
    const limited = evidence.repos.filter((r) => r.reason === 'rate_limited');
    expect(limited).toHaveLength(5);
    for (const r of limited) {
      expect(r.findings.tests.status).toBe('unknown');
      expect(r.findings.tests.summary).toMatch(/not inspected/i);
    }
  });

  it('turns fetch failures into explicit not-inspected states without failing the audit', async () => {
    const repos = [repo('boom', { stargazers_count: 3 }), repo('big', { stargazers_count: 2 }), repo('fine', { stargazers_count: 1 })];
    const fetchTree = vi
      .fn<(owner: string, name: string, branch: string) => Promise<RepoTreeResult>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: false, reason: 'too_large' })
      .mockResolvedValueOnce(ok(['README.md']));

    const evidence = await inspectPortfolio('dev', repos, { fetchTree, concurrency: 1 });
    expect(evidence.repos.map((r) => `${r.repoName}:${r.state}:${r.reason ?? '-'}`)).toEqual([
      'boom:not_inspected:error',
      'big:not_inspected:too_large',
      'fine:inspected:-',
    ]);
  });

  it('never touches the network for demo personas', () => {
    const persona = MOCK_PROFILES[0];
    const evidence = buildUninspectedEvidence(persona.repos, 'demo_data');

    expect(evidence.inspectedCount).toBe(0);
    expect(evidence.repos).toHaveLength(persona.repos.length);
    expect(evidence.repos.every((r) => r.state === 'not_inspected')).toBe(true);
    expect(evidence.repos.filter((r) => r.reason === 'fork')).toHaveLength(persona.repos.filter((r) => r.fork).length);
    expect(evidence.repos.some((r) => r.reason === 'demo_data')).toBe(true);
    for (const category of EVIDENCE_CATEGORIES) {
      expect(evidence.coverage[category]).toEqual({ found: 0, notFound: 0, unknown: 0 });
    }
  });
});

describe('fetchRepoTree', () => {
  const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearApiCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the fixed proxy route, forwards the user token as a header and normalises the listing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [{ path: 'README.md', type: 'blob', size: 12, sha: 'x' }] }));

    const result = await fetchRepoTree('octocat', 'hello-world', 'ghp_userToken1', 'main');

    expect(result).toEqual({ ok: true, tree: { truncated: false, entries: [{ path: 'README.md', type: 'blob', size: 12 }] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/github/tree/octocat/hello-world?ref=main');
    expect(init.headers['x-github-token']).toBe('ghp_userToken1');
    expect(url).not.toContain('ghp_userToken1');
  });

  it('remembers the quota counters from the data response itself', async () => {
    expect(getLastObservedRateLimit()).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse({ tree: [] }, 200, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4964', 'x-ratelimit-used': '36', 'x-ratelimit-reset': '1900000000' }));
    await fetchRepoTree('octocat', 'counted', undefined, 'main');
    expect(getLastObservedRateLimit()).toMatchObject({ limit: 5000, remaining: 4964, used: 36 });

    // A response without counters does not overwrite them with defaults
    fetchMock.mockResolvedValueOnce(jsonResponse({ tree: [] }));
    await fetchRepoTree('octocat', 'uncounted', undefined, 'main');
    expect(getLastObservedRateLimit()).toMatchObject({ remaining: 4964 });
  });

  it('encodes a default branch containing slashes as a single query value', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tree: [] }));
    await fetchRepoTree('octocat', 'hello-world', undefined, 'release/2024.1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/github/tree/octocat/hello-world?ref=release%2F2024.1');
  });

  it('drops an unusable branch name instead of sending it', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ tree: [] }));
    const unusable = ['../../users/octocat', 'main?x=1', 'a b', '-rf', 'a//b', '.git', 'x.lock', '', null, undefined];
    for (const [i, branch] of unusable.entries()) {
      await fetchRepoTree('octocat', `repo-${i}`, undefined, branch);
      expect(fetchMock.mock.calls[i][0]).toBe(`/api/github/tree/octocat/repo-${i}`);
    }
  });

  it('validates branch names with the same rules everywhere', () => {
    for (const good of ['main', 'master', 'develop', 'feature/new-ui', 'release/2024.1', 'v1.2.3', 'user_name/fix-123']) {
      expect(isValidBranchName(good), good).toBe(true);
    }
    for (const bad of ['', '..', 'a/../b', '/a', 'a/', 'a//b', '-a', 'a.', '.a', 'a/.b', 'a.lock', 'a b', 'a?b', 'a#b', 'a@{1}', 'a\\b', 'a:b', 'x'.repeat(201), 42, null]) {
      expect(isValidBranchName(bad), String(bad)).toBe(false);
    }
  });

  it('serves repeat lookups from memory and keeps listings out of sessionStorage', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tree: [{ path: 'a.txt', type: 'blob' }] }));

    await fetchRepoTree('octocat', 'hello-world', undefined, 'main');
    await fetchRepoTree('OctoCat', 'Hello-World', undefined, 'main');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(sessionStorage).filter((k) => k.includes('tree:'))).toEqual([]);
  });

  it('rejects malformed identifiers without any request', async () => {
    const bad: Array<[string, string]> = [
      ['octocat', '../../users/octocat'],
      ['octocat', 'repo/contents'],
      ['octocat', '..'],
      ['octocat', 'repo?ref=x'],
      ['-bad-', 'repo'],
      ['evil.example.com', 'repo'],
      ['octocat', ''],
    ];
    for (const [owner, name] of bad) {
      expect(await fetchRepoTree(owner, name)).toEqual({ ok: false, reason: 'error' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'rate_limited'],
    [403, 'rate_limited'],
    [404, 'not_found'],
    [409, 'empty'],
    [413, 'too_large'],
    [400, 'error'],
    [502, 'error'],
    [503, 'error'],
  ] as const)('maps proxy status %i to "%s"', async (status, reason) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'x' }, status));

    expect(await fetchRepoTree('octocat', `repo-${status}`)).toEqual({ ok: false, reason });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never calls GitHub directly, even when the proxy is unreachable or failing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('proxy down'));
    expect(await fetchRepoTree('octocat', 'offline', 'ghp_userToken1', 'main')).toEqual({ ok: false, reason: 'error' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad gateway' }, 502));
    expect(await fetchRepoTree('octocat', 'flaky', 'ghp_userToken1', 'main')).toEqual({ ok: false, reason: 'error' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith('/api/github/tree/')).toBe(true);
      expect(String(url)).not.toContain('api.github.com');
    }
  });
});
