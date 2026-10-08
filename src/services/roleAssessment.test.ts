import { describe, it, expect } from 'vitest';
import type { GitHubRepo } from '../types/github';
import type { RepoInspection, RepoTree, RoleId } from '../types/evidence';
import { inspectRepoTree, notInspected, summarizeEvidence } from './inspection';
import { inspectSampleListings } from './inspectionRunner';
import { assessEvidence, describeEvidenceLimits, LIMITED_COVERAGE_PERCENT, ROLE_DEFINITIONS } from './roleAssessment';
import { analyzePortfolio } from './analyzer';
import { MOCK_PROFILES } from '../data/mockProfiles';
import { getSampleListings, SAMPLE_REPO_LISTINGS } from '../data/mockRepoTrees';

const repo = (name: string): GitHubRepo => ({
  ...MOCK_PROFILES[1].repos[0],
  name,
  full_name: `dev/${name}`,
  html_url: `https://github.com/dev/${name}`,
  fork: false,
  size: 10,
});

const listing = (paths: string[], truncated = false): RepoTree => ({
  truncated,
  entries: paths.map((path) => ({ path, type: 'blob' as const, size: 2000 })),
});

const inspect = (name: string, paths: string[], truncated = false) => inspectRepoTree(repo(name), listing(paths, truncated));
const evidenceOf = (inspections: RepoInspection[], eligible = inspections.length) =>
  summarizeEvidence(inspections, eligible, inspections.filter((i) => i.reason !== 'not_selected').length);
const roleOf = (assessment: ReturnType<typeof assessEvidence>, id: RoleId) => assessment.roles.find((r) => r.role === id)!;

describe('role rubric', () => {
  it('covers the five roles with transparent weights that sum to 100', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.role)).toEqual(['ai-ml', 'data-science', 'full-stack', 'backend', 'devops']);
    for (const definition of ROLE_DEFINITIONS) {
      expect(definition.criteria.reduce((sum, c) => sum + c.weight, 0), definition.role).toBe(100);
      expect(new Set(definition.criteria.map((c) => c.id)).size).toBe(definition.criteria.length);
      for (const criterion of definition.criteria) {
        expect(criterion.weight).toBeGreaterThan(0);
        expect(criterion.label.length).toBeGreaterThan(3);
        expect(criterion.rationale.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('assessEvidence scoring', () => {
  const fullStackRepo = inspect('shop', [
    'README.md',
    'package.json',
    'src/App.tsx',
    'server/routes/orders.ts',
    'prisma/schema.prisma',
    'src/cart.test.ts',
    'Dockerfile',
    '.github/workflows/ci.yml',
  ]);

  it('scores a role from observed evidence and names the repositories and paths behind each criterion', () => {
    const assessment = assessEvidence(evidenceOf([fullStackRepo]));
    const fullStack = roleOf(assessment, 'full-stack');

    expect(fullStack.score).toBe(100);
    expect(fullStack.coveragePercent).toBe(100);
    expect(fullStack.criteria.every((c) => c.status === 'met')).toBe(true);
    expect(fullStack.criteria.reduce((sum, c) => sum + (c.earned ?? 0), 0)).toBe(100);

    const tests = fullStack.criteria.find((c) => c.id === 'tests')!;
    expect(tests.sources).toEqual([{ repo: 'shop', paths: ['src/cart.test.ts'] }]);
    expect(tests.explanation).toBe('Observed in 1 of 1 inspected repository.');

    // The same evidence reads differently for a role it does not match
    const dataScience = roleOf(assessment, 'data-science');
    expect(dataScience.score).toBeLessThan(50);
    expect(dataScience.criteria.find((c) => c.id === 'notebooks')!.status).toBe('not_observed');
    expect(assessment.strongestRole).toBe('full-stack');
  });

  it('uses the share of assessable repositories for evidence criteria', () => {
    const assessment = assessEvidence(
      evidenceOf([inspect('a', ['README.md', 'a.test.ts']), inspect('b', ['README.md', 'main.ts']), inspect('c', ['main.ts']), inspect('d', ['main.ts'])])
    );
    const backend = roleOf(assessment, 'backend');
    const tests = backend.criteria.find((c) => c.id === 'tests')!;
    const readme = backend.criteria.find((c) => c.id === 'readme')!;

    expect(tests).toMatchObject({ status: 'partial', ratio: 0.25, earned: 5, supportingRepos: 1, assessableRepos: 4 });
    expect(readme).toMatchObject({ status: 'partial', ratio: 0.5, earned: 2.5 });
    expect(tests.explanation).toBe('Observed in 1 of 4 inspected repositories.');
  });

  it('treats unknown findings neutrally: excluded from the score and reported as reduced coverage', () => {
    const complete = inspect('complete', ['README.md', '.github/workflows/ci.yml', 'Dockerfile', 'infra/main.tf', 'monitoring/alerts.yml', 'docs/runbook.md']);
    const assessedAlone = roleOf(assessEvidence(evidenceOf([complete])), 'devops');
    expect(assessedAlone.score).toBe(100);

    // A second repository whose listing was cut short shows nothing: it must not lower the score
    const truncated = inspect('huge', ['src/a.c', 'src/b.c'], true);
    const withUnknown = roleOf(assessEvidence(evidenceOf([complete, truncated])), 'devops');
    expect(withUnknown.score).toBe(100);
    const ci = withUnknown.criteria.find((c) => c.id === 'ci')!;
    expect(ci).toMatchObject({ status: 'met', assessableRepos: 1 });
    expect(ci.explanation).toMatch(/1 more could not be assessed and are not counted/);

    // Only truncated listings: nothing is concluded at all
    const onlyUnknown = roleOf(assessEvidence(evidenceOf([truncated])), 'devops');
    expect(onlyUnknown.score).toBeNull();
    expect(onlyUnknown.coveragePercent).toBe(0);
    expect(onlyUnknown.confidence).toBe('low');
    expect(onlyUnknown.criteria.every((c) => c.status === 'unknown' && c.earned === null)).toBe(true);
  });

  it('counts evidence that was seen in a partial listing while leaving its gaps unknown', () => {
    const partial = inspect('partial', ['README.md', 'train.py'], true);
    const aiMl = roleOf(assessEvidence(evidenceOf([partial])), 'ai-ml');

    expect(aiMl.criteria.find((c) => c.id === 'readme')!.status).toBe('met');
    expect(aiMl.criteria.find((c) => c.id === 'ml-work')!.status).toBe('met');
    expect(aiMl.criteria.find((c) => c.id === 'tests')!.status).toBe('unknown');
    expect(aiMl.criteria.find((c) => c.id === 'python-env')!.status).toBe('unknown');
    // 15 (readme) + 25 (ml-work) assessed out of 100
    expect(aiMl.coveragePercent).toBe(40);
    expect(aiMl.score).toBe(100);
    expect(aiMl.confidence).toBe('low');
  });

  it('returns no score, no strongest role and no actions when nothing was inspected', () => {
    const evidence = evidenceOf([notInspected(repo('a'), 'rate_limited'), notInspected(repo('b'), 'error')], 2);
    const assessment = assessEvidence(evidence);

    expect(assessment.strongestRole).toBeNull();
    expect(assessment.scope).toMatchObject({ inspectedRepos: 0, eligibleRepos: 2, uninspectedEligibleRepos: 2 });
    for (const role of assessment.roles) {
      expect(role.score).toBeNull();
      expect(role.summary).toMatch(/not assessed/i);
      expect(assessment.actionsByRole[role.role]).toEqual([]);
    }
  });

  it('never reports high confidence while eligible repositories remain uninspected', () => {
    const inspections = [1, 2, 3].map((i) => inspect(`r${i}`, ['README.md', 'a.test.ts', '.github/workflows/ci.yml', 'Dockerfile', 'docs/x.md', 'infra/main.tf', 'Makefile']));
    expect(roleOf(assessEvidence(evidenceOf(inspections, 3)), 'devops').confidence).toBe('high');

    const limited = assessEvidence(evidenceOf(inspections, 9));
    expect(roleOf(limited, 'devops').confidence).toBe('medium');
    expect(roleOf(limited, 'devops').summary).toMatch(/6 other repositories were not inspected/);
    expect(limited.scope.uninspectedEligibleRepos).toBe(6);
  });

  it('is deterministic and does not depend on repository order for scores', () => {
    const a = inspect('a', ['README.md', 'notebooks/eda.ipynb', 'requirements.txt', 'data/raw.csv']);
    const b = inspect('b', ['main.go', 'go.mod', 'api/handlers.go', 'api/handlers_test.go']);
    const forward = assessEvidence(evidenceOf([a, b]));
    const again = assessEvidence(evidenceOf([a, b]));
    const reversed = assessEvidence(evidenceOf([b, a]));

    expect(again).toEqual(forward);
    expect(reversed.roles.map((r) => [r.role, r.score, r.coveragePercent])).toEqual(forward.roles.map((r) => [r.role, r.score, r.coveragePercent]));
    expect(reversed.strongestRole).toBe(forward.strongestRole);
  });
});

describe('evidence-linked actions', () => {
  it('creates actions only for observed gaps, quoting the finding and naming the repositories', () => {
    const assessment = assessEvidence(evidenceOf([inspect('api', ['README.md', 'server/routes/users.ts', 'package.json']), inspect('worker', ['main.py'])]));
    const actions = assessment.actionsByRole.backend;

    const tests = actions.find((a) => a.criterionId === 'tests')!;
    expect(tests.title).toBe('Add automated tests to api and worker');
    expect(tests.repos).toEqual(['api', 'worker']);
    expect(tests.evidence).toBe('api: No automated tests found in the 3 inspected file paths. It may exist under an unconventional name.');
    expect(tests.steps.length).toBeGreaterThan(0);
    expect(tests.verification).toMatch(/re-run the inspection/i);

    // README exists in "api" only, so the action targets just the repository without one
    // (checked on a role where README carries enough weight to stay within the action cap)
    const readme = assessment.actionsByRole['data-science'].find((a) => a.criterionId === 'readme')!;
    expect(readme.repos).toEqual(['worker']);
    expect(readme.title).toBe('Add a README to worker');

    // Observed criteria never produce an action
    expect(actions.find((a) => a.criterionId === 'service')).toBeUndefined();
  });

  it('orders actions by impact (weight x unmet share), caps them and assigns priority from impact', () => {
    const assessment = assessEvidence(evidenceOf([inspect('bare', ['main.py'])]));

    for (const role of assessment.roles) {
      const actions = assessment.actionsByRole[role.role];
      expect(actions.length).toBeLessThanOrEqual(6);
      const impacts = actions.map((a) => a.impact);
      expect(impacts).toEqual([...impacts].sort((x, y) => y - x));
      for (const action of actions) {
        const criterion = role.criteria.find((c) => c.id === action.criterionId)!;
        expect(action.impact).toBe(criterion.weight);
        expect(action.priority).toBe(action.impact >= 15 ? 'high' : action.impact >= 8 ? 'medium' : 'low');
        expect(action.verification.length).toBeGreaterThan(20);
      }
    }

    const devops = assessment.actionsByRole.devops;
    expect(devops[0].criterionId).toBe('ci');
    expect(devops[0].priority).toBe('high');
  });

  it('does not turn unknown or not-inspected findings into actions', () => {
    const truncated = inspect('huge', ['src/a.c'], true);
    const assessment = assessEvidence(evidenceOf([truncated, notInspected(repo('skipped'), 'not_selected')], 2));
    for (const role of assessment.roles) {
      expect(assessment.actionsByRole[role.role]).toEqual([]);
    }
  });

  it('words stack-marker gaps as "not observed" with an explicit escape for uninspected repositories', () => {
    const assessment = assessEvidence(evidenceOf([inspect('site', ['README.md', 'index.html'])]));
    const action = assessment.actionsByRole['data-science'].find((a) => a.criterionId === 'notebooks')!;

    expect(action.repos).toEqual([]);
    expect(action.evidence).toMatch(/Not observed in 1 inspected repository \(file names only\)/);
    expect(action.evidence).toMatch(/not inspected, no action is needed/);
    expect(JSON.stringify(assessment)).not.toMatch(/lacks|has no|missing skills|does not have/i);
  });
});

describe('demo persona sample listings', () => {
  it('exist only for repositories in the persona fixtures', () => {
    for (const persona of MOCK_PROFILES) {
      const listings = getSampleListings(persona.user.login)!;
      expect(listings, persona.id).toBeDefined();
      const eligible = persona.repos.filter((r) => !r.fork && r.size > 0).map((r) => r.name);
      expect(Object.keys(listings).sort()).toEqual([...eligible].sort());
    }
    expect(Object.keys(SAMPLE_REPO_LISTINGS).sort()).toEqual(MOCK_PROFILES.map((p) => p.user.login).sort());
    expect(getSampleListings('torvalds')).toBeUndefined();
    expect(getSampleListings('constructor')).toBeUndefined();
  });

  it('produce evidence marked as sample data that matches each persona story', () => {
    const byId = (id: string) => MOCK_PROFILES.find((p) => p.id === id)!;
    const evidenceFor = (id: string) => {
      const persona = byId(id);
      return inspectSampleListings(persona.repos, getSampleListings(persona.user.login)!);
    };

    const alex = evidenceFor('tutorial-hoarder');
    expect(alex.source).toBe('sample');
    expect(alex.inspectedCount).toBe(2);
    expect(alex.repos.filter((r) => r.reason === 'fork')).toHaveLength(5);
    expect(alex.coverage.tests).toEqual({ found: 0, notFound: 2, unknown: 0 });

    const sarah = evidenceFor('open-source-chad');
    expect(sarah.source).toBe('sample');
    expect(sarah.coverage.ci.found).toBe(3);
    expect(sarah.coverage.readme.found).toBe(3);
    const sarahAssessment = assessEvidence(sarah);
    expect(roleOf(sarahAssessment, 'backend').score!).toBeGreaterThan(roleOf(assessEvidence(alex), 'backend').score!);

    const devon = evidenceFor('framework-hopper');
    expect(devon.inspectedCount).toBe(4);
    expect(devon.coverage.ci).toEqual({ found: 0, notFound: 4, unknown: 0 });
  });
});

describe('independence from the portfolio health score', () => {
  it('leaves analyzePortfolio output untouched and carries no evidence fields', () => {
    const persona = MOCK_PROFILES[1];
    const before = analyzePortfolio(persona.user, persona.repos, [], true);
    assessEvidence(inspectSampleListings(persona.repos, getSampleListings(persona.user.login)!));
    const after = analyzePortfolio(persona.user, persona.repos, [], true);

    expect(after.scoring).toEqual(before.scoring);
    expect(after.recruiter).toEqual(before.recruiter);
    expect(after.roasts).toEqual(before.roasts);
    expect(after.roadmap).toEqual(before.roadmap);
    expect(Object.keys(after).sort()).toEqual(['analyzedAt', 'facts', 'isMockData', 'recruiter', 'roadmap', 'roasts', 'scoring']);
  });
});

describe('describeEvidenceLimits', () => {
  const complete = ['README.md', 'a.test.ts', '.github/workflows/ci.yml', 'Dockerfile', 'docs/x.md', 'infra/main.tf', 'Makefile'];

  it('returns nothing when every eligible repository was fully inspected', () => {
    const assessment = assessEvidence(evidenceOf([inspect('a', complete), inspect('b', complete)], 2));
    expect(describeEvidenceLimits(roleOf(assessment, 'devops'), assessment.scope)).toEqual([]);
  });

  it('names each reason a score is provisional', () => {
    const single = assessEvidence(evidenceOf([inspect('only', complete)], 1));
    expect(describeEvidenceLimits(roleOf(single, 'devops'), single.scope)).toEqual(['The score rests on a single repository.']);

    const uninspected = assessEvidence(evidenceOf([inspect('a', complete), inspect('b', complete)], 5));
    expect(describeEvidenceLimits(roleOf(uninspected, 'devops'), uninspected.scope)).toEqual([
      '3 eligible repositories were not inspected and may contain evidence this score does not reflect.',
    ]);

    const partial = assessEvidence(evidenceOf([inspect('a', ['README.md', 'train.py'], true), inspect('b', ['README.md'], true)], 2));
    const aiMl = roleOf(partial, 'ai-ml');
    expect(aiMl.coveragePercent).toBeLessThan(LIMITED_COVERAGE_PERCENT);
    const limits = describeEvidenceLimits(aiMl, partial.scope);
    expect(limits[0]).toBe(`Only ${aiMl.coveragePercent}% of this role's criteria could be assessed; the rest are unknown and left out of the score.`);
    expect(limits).toContain('2 file listings were only partly read.');

    const nothing = assessEvidence(evidenceOf([inspect('huge', ['a.c'], true)], 1));
    expect(describeEvidenceLimits(roleOf(nothing, 'backend'), nothing.scope)).toEqual(['No criterion could be assessed, so there is no score for this role.']);
  });
});
