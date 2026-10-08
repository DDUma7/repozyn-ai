import type {
  CriterionSource,
  CriterionStatus,
  EvidenceAction,
  EvidenceAssessment,
  EvidenceCategory,
  EvidenceConfidence,
  PortfolioEvidence,
  RepoInspection,
  RoleAssessment,
  RoleCriterionResult,
  RoleId,
} from '../types/evidence';

// Role-aware reading of the inspection evidence. Everything here is a fixed, published rubric:
// each role lists its criteria and weights, and every result names the repositories and paths
// behind it. It is independent of the portfolio health score, roasts and simulator.
//
// Scope rule: results describe the INSPECTED repositories only. "Not observed" never means the
// developer lacks something; it means it was not seen in the listings that were read.

interface EvidenceCriterion {
  kind: 'evidence';
  id: string;
  label: string;
  rationale: string;
  weight: number;
  category: EvidenceCategory;
}

interface MarkerCriterion {
  kind: 'marker';
  id: string;
  label: string;
  rationale: string;
  weight: number;
  /** Met when any of these stack markers is present in an inspected repository */
  anyOf: string[];
}

type Criterion = EvidenceCriterion | MarkerCriterion;

interface RoleDefinition {
  role: RoleId;
  label: string;
  criteria: Criterion[];
}

const ev = (id: string, category: EvidenceCategory, weight: number, label: string, rationale: string): EvidenceCriterion => ({
  kind: 'evidence',
  id,
  category,
  weight,
  label,
  rationale,
});

const mk = (id: string, anyOf: string[], weight: number, label: string, rationale: string): MarkerCriterion => ({
  kind: 'marker',
  id,
  anyOf,
  weight,
  label,
  rationale,
});

/** The complete rubric. Weights within each role sum to 100. */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: 'ai-ml',
    label: 'AI/ML Engineer',
    criteria: [
      mk('ml-work', ['ml-training', 'ml-evaluation', 'ml-inference', 'ml-models'], 25, 'Model training, evaluation or model files', 'Training, evaluation, inference or model-weight files show hands-on ML work.'),
      mk('python-env', ['python-project'], 15, 'Reproducible Python environment', 'A dependency manifest lets others re-run the work.'),
      mk('experiments', ['notebooks', 'datasets', 'data-pipeline'], 10, 'Experiments or data assets', 'Notebooks, datasets and pipelines show how results were produced.'),
      ev('tests', 'tests', 15, 'Automated tests', 'Tests around data and model code signal engineering discipline.'),
      ev('readme', 'readme', 15, 'README present', 'A README is where results, usage and limitations are explained.'),
      ev('deployment', 'deployment', 10, 'Deployment or packaging', 'Containers or deployment config show a path from experiment to service.'),
      ev('ci', 'ci', 10, 'CI automation', 'Automated checks keep training and inference code working.'),
    ],
  },
  {
    role: 'data-science',
    label: 'Data Scientist',
    criteria: [
      mk('notebooks', ['notebooks'], 25, 'Analysis notebooks', 'Notebooks are the usual way analysis and findings are presented.'),
      mk('data-assets', ['datasets', 'data-pipeline'], 20, 'Datasets or data pipelines', 'Visible data sources and pipelines make an analysis traceable.'),
      mk('python-env', ['python-project'], 15, 'Reproducible Python environment', 'A dependency manifest lets others re-run the analysis.'),
      ev('readme', 'readme', 20, 'README present', 'A README carries the question, method and conclusions.'),
      ev('documentation', 'documentation', 10, 'Additional documentation', 'Write-ups beyond the README show communication of findings.'),
      ev('tests', 'tests', 10, 'Automated tests', 'Tests on data transformations guard against silent errors.'),
    ],
  },
  {
    role: 'full-stack',
    label: 'Full-Stack Engineer',
    criteria: [
      mk('frontend', ['frontend-app'], 20, 'Frontend application code', 'Component or framework files show client-side work.'),
      mk('backend', ['backend-service', 'api-spec'], 15, 'Backend or API code', 'Server routes or an API definition show the other half of the stack.'),
      mk('database', ['database'], 10, 'Database schema or migrations', 'Schema files show data modelling.'),
      ev('tests', 'tests', 15, 'Automated tests', 'Tests show the application is verified, not only written.'),
      ev('deployment', 'deployment', 15, 'Deployment configuration', 'Deployment config shows the app was taken to a running state.'),
      ev('ci', 'ci', 10, 'CI automation', 'Automated checks on each change.'),
      ev('readme', 'readme', 15, 'README present', 'A README explains what the product does and how to run it.'),
    ],
  },
  {
    role: 'backend',
    label: 'Backend Engineer',
    criteria: [
      mk('service', ['backend-service'], 20, 'Service or API code structure', 'Routes, handlers or a server entry point show service work.'),
      mk('database', ['database'], 15, 'Database schema or migrations', 'Schema and migration files show data modelling and change management.'),
      mk('api-contract', ['api-spec'], 10, 'API specification', 'An OpenAPI, protobuf or GraphQL schema documents the contract.'),
      ev('tests', 'tests', 20, 'Automated tests', 'Backend behaviour is hard to check by eye, so tests carry extra weight.'),
      ev('ci', 'ci', 10, 'CI automation', 'Automated checks on each change.'),
      ev('deployment', 'deployment', 10, 'Deployment configuration', 'Containers or platform config show the service can be run.'),
      ev('documentation', 'documentation', 10, 'Additional documentation', 'Architecture or contributor docs help others operate the service.'),
      ev('readme', 'readme', 5, 'README present', 'A README explains setup and usage.'),
    ],
  },
  {
    role: 'devops',
    label: 'DevOps Engineer',
    criteria: [
      ev('ci', 'ci', 25, 'CI automation', 'Pipelines are the core artefact of this role.'),
      mk('containers', ['containers'], 20, 'Container definitions', 'Dockerfiles or compose files show packaging of services.'),
      mk('infrastructure', ['infrastructure'], 20, 'Infrastructure as code', 'Terraform, Helm or Kubernetes manifests show managed infrastructure.'),
      mk('operations', ['ops-scripts'], 10, 'Operational scripts or monitoring', 'Makefiles, scripts and monitoring config show day-to-day operations.'),
      ev('deployment', 'deployment', 10, 'Deployment configuration', 'Any deployment config across the inspected repositories.'),
      ev('documentation', 'documentation', 10, 'Additional documentation', 'Runbooks and contributor docs make operations repeatable.'),
      ev('readme', 'readme', 5, 'README present', 'A README explains how to run and deploy.'),
    ],
  },
];

const MAX_SOURCE_REPOS = 3;
const MAX_ACTIONS_PER_ROLE = 6;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function repoCount(count: number): string {
  return count === 1 ? '1 inspected repository' : `${count} inspected repositories`;
}

/** Weak evidence (a suggestive name that often means something else) earns half of a criterion's weight */
export const WEAK_EVIDENCE_CREDIT = 0.5;

function evaluateEvidenceCriterion(criterion: EvidenceCriterion, inspected: RepoInspection[]): RoleCriterionResult {
  const sources: CriterionSource[] = [];
  let found = 0;
  let weakOnly = 0;
  let notFound = 0;

  for (const repo of inspected) {
    const finding = repo.findings[criterion.category];
    if (finding.status === 'found') {
      found++;
      if (finding.strength === 'weak') weakOnly++;
      if (sources.length < MAX_SOURCE_REPOS) sources.push({ repo: repo.repoName, paths: finding.sourcePaths.slice(0, 2) });
    } else if (finding.status === 'not_found') {
      notFound++;
    }
  }

  const assessable = found + notFound;
  const base = { ...pickCriterionFields(criterion), sources, supportingRepos: found, assessableRepos: assessable };

  if (assessable === 0) {
    return {
      ...base,
      status: 'unknown',
      ratio: null,
      earned: null,
      explanation: inspected.length === 0
        ? 'No repository was inspected, so this could not be assessed.'
        : 'The inspected listings were incomplete, so this could not be assessed.',
    };
  }

  const credit = found - weakOnly + weakOnly * WEAK_EVIDENCE_CREDIT;
  const ratio = credit / assessable;
  const status: CriterionStatus = ratio === 1 ? 'met' : ratio > 0 ? 'partial' : 'not_observed';
  const unknownNote = inspected.length > assessable ? ` ${inspected.length - assessable} more could not be assessed and are not counted.` : '';
  const weakNote = weakOnly > 0 ? ` In ${weakOnly} of them only a weak signal matched, counted at half weight.` : '';
  const explanation =
    found > 0
      ? `Observed in ${found} of ${repoCount(assessable)}.${weakNote}${unknownNote}`
      : `Not observed in ${repoCount(assessable)} (file names only). It may exist under an unconventional name.${unknownNote}`;

  return { ...base, status, ratio, earned: round1(criterion.weight * ratio), explanation };
}

function evaluateMarkerCriterion(criterion: MarkerCriterion, inspected: RepoInspection[]): RoleCriterionResult {
  const sources: CriterionSource[] = [];
  const weakRules = new Set<string>();
  let supporting = 0;
  let strongSupport = false;
  let fullyInspected = 0;

  for (const repo of inspected) {
    if (repo.state === 'inspected') fullyInspected++;
    // Context markers (what was deliberately NOT counted) never support a criterion
    const hits = repo.markers.filter((m) => m.countsAsEvidence && criterion.anyOf.includes(m.id));
    if (hits.length === 0) continue;
    supporting++;
    if (hits.some((m) => m.strength === 'strong')) strongSupport = true;
    for (const hit of hits) for (const match of hit.matches) if (match.strength === 'weak') weakRules.add(match.description);
    if (sources.length < MAX_SOURCE_REPOS) sources.push({ repo: repo.repoName, paths: hits.flatMap((m) => m.sourcePaths).slice(0, 2) });
  }

  const base = { ...pickCriterionFields(criterion), sources, supportingRepos: supporting, assessableRepos: inspected.length };

  if (supporting > 0 && strongSupport) {
    return {
      ...base,
      status: 'met',
      ratio: 1,
      earned: criterion.weight,
      explanation: `Observed in ${supporting} of ${repoCount(inspected.length)}.`,
    };
  }

  if (supporting > 0) {
    const first = [...weakRules][0];
    return {
      ...base,
      status: 'partial',
      ratio: WEAK_EVIDENCE_CREDIT,
      earned: round1(criterion.weight * WEAK_EVIDENCE_CREDIT),
      explanation: `Weak signal only in ${supporting} of ${repoCount(inspected.length)}, counted at half weight: ${first.charAt(0).toLowerCase()}${first.slice(1)}.`,
    };
  }

  // Absence only counts when at least one complete listing was read
  if (fullyInspected === 0) {
    return {
      ...base,
      assessableRepos: 0,
      status: 'unknown',
      ratio: null,
      earned: null,
      explanation: inspected.length === 0
        ? 'No repository was inspected, so this could not be assessed.'
        : 'The inspected listings were incomplete, so this could not be assessed.',
    };
  }

  return {
    ...base,
    assessableRepos: fullyInspected,
    status: 'not_observed',
    ratio: 0,
    earned: 0,
    explanation: `Not observed in ${repoCount(fullyInspected)} (file names only).`,
  };
}

function pickCriterionFields(criterion: Criterion) {
  return { id: criterion.id, label: criterion.label, rationale: criterion.rationale, kind: criterion.kind, weight: criterion.weight };
}

function assessRole(definition: RoleDefinition, inspected: RepoInspection[], uninspectedEligible: number): RoleAssessment {
  const criteria = definition.criteria.map((c) => (c.kind === 'evidence' ? evaluateEvidenceCriterion(c, inspected) : evaluateMarkerCriterion(c, inspected)));

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const assessed = criteria.filter((c) => c.earned !== null);
  const assessedWeight = assessed.reduce((sum, c) => sum + c.weight, 0);
  const earned = assessed.reduce((sum, c) => sum + (c.earned ?? 0), 0);

  // Unknown criteria are left out of both sides, so they neither help nor hurt
  const score = assessedWeight > 0 ? Math.round((earned / assessedWeight) * 100) : null;
  const coveragePercent = totalWeight > 0 ? Math.round((assessedWeight / totalWeight) * 100) : 0;

  let confidence: EvidenceConfidence = 'low';
  if (coveragePercent >= 80 && inspected.length >= 3 && uninspectedEligible === 0) confidence = 'high';
  else if (coveragePercent >= 50 && inspected.length >= 2) confidence = 'medium';

  let summary: string;
  if (score === null) {
    summary = 'Not assessed: no repository evidence is available yet.';
  } else {
    const met = criteria.filter((c) => c.status === 'met').length;
    const partial = criteria.filter((c) => c.status === 'partial').length;
    const notObserved = criteria.filter((c) => c.status === 'not_observed').length;
    const unknown = criteria.filter((c) => c.status === 'unknown').length;
    summary =
      `${met} of ${criteria.length} criteria observed` +
      (partial ? `, ${partial} partly` : '') +
      (notObserved ? `, ${notObserved} not observed` : '') +
      (unknown ? `, ${unknown} not assessable` : '') +
      ` across ${repoCount(inspected.length)}.` +
      (uninspectedEligible > 0 ? ` ${uninspectedEligible} other ${uninspectedEligible === 1 ? 'repository was' : 'repositories were'} not inspected.` : '');
  }

  return { role: definition.role, label: definition.label, score, coveragePercent, confidence, criteria, summary };
}

interface ActionTemplate {
  title: (repos: string[]) => string;
  steps: string[];
  verification: string;
}

const EVIDENCE_ACTIONS: Record<EvidenceCategory, ActionTemplate> = {
  readme: {
    title: (repos) => `Add a README to ${listRepos(repos)}`,
    steps: [
      'Create README.md at the repository root.',
      'Cover what the project does, how to run it, and one example of the output or a screenshot.',
    ],
    verification: 'README.md is listed at the repository root and renders on the repository page. Re-run the inspection: README should read "found".',
  },
  tests: {
    title: (repos) => `Add automated tests to ${listRepos(repos)}`,
    steps: [
      'Pick the test runner that matches the stack (for example Vitest or Jest, pytest, go test).',
      'Cover one core behaviour first, in a file the runner discovers by name (for example *.test.ts, test_*.py, *_test.go).',
    ],
    verification: 'The test command passes locally and a test file is visible in the repository. Re-run the inspection: tests should read "found" with that file as the source path.',
  },
  ci: {
    title: (repos) => `Add a CI workflow to ${listRepos(repos)}`,
    steps: [
      'Add .github/workflows/ci.yml that installs dependencies and runs lint and tests on push and pull request.',
      'Push a commit and open the Actions tab to confirm the run.',
    ],
    verification: 'The Actions tab shows a completed run for the latest commit, and .github/workflows/ contains the workflow file. Re-run the inspection: CI should read "found".',
  },
  deployment: {
    title: (repos) => `Add deployment configuration to ${listRepos(repos)}`,
    steps: [
      'Choose one target that fits the project: a Dockerfile, or a platform file such as vercel.json, netlify.toml or fly.toml.',
      'Deploy once and put the live URL in the repository "About" website field.',
    ],
    verification: 'The configuration file is in the repository and the live URL opens. Re-run the inspection: deployment should read "found".',
  },
  documentation: {
    title: (repos) => `Add documentation beyond the README to ${listRepos(repos)}`,
    steps: [
      'Add a docs/ folder or a CONTRIBUTING.md / ARCHITECTURE.md describing structure, decisions and how to contribute.',
      'Link it from the README.',
    ],
    verification: 'The new file is listed in the repository and linked from the README. Re-run the inspection: documentation should read "found".',
  },
};

const MARKER_ACTIONS: Record<string, { title: string; steps: string[]; verification: string }> = {
  'ml-work': {
    title: 'Publish model or training code',
    steps: ['Add the training or inference script for one project (for example train.py) with the configuration used.', 'Describe the dataset, metric and result in the README.'],
    verification: 'The script is in the repository and runs from a clean checkout using the documented command. Re-run the inspection: "Model or training code" should be observed.',
  },
  'python-env': {
    title: 'Pin the Python environment',
    steps: ['Add requirements.txt or pyproject.toml listing the dependencies actually used.', 'Document the install and run commands in the README.'],
    verification: 'A fresh virtual environment installs from the file and the project runs. Re-run the inspection: the manifest should be listed as a source path.',
  },
  experiments: {
    title: 'Publish an experiment notebook or dataset reference',
    steps: ['Add a notebook that reproduces one headline result.', 'Include a small sample dataset or a documented link to the data source.'],
    verification: 'The notebook opens on GitHub and runs top to bottom. Re-run the inspection: it should be listed as a source path.',
  },
  notebooks: {
    title: 'Publish an analysis notebook',
    steps: ['Add a notebook that states the question, shows the analysis and ends with the conclusion.', 'Clear noisy output and keep the narrative in Markdown cells.'],
    verification: 'The notebook renders on GitHub and runs top to bottom. Re-run the inspection: "Analysis notebooks" should be observed.',
  },
  'data-assets': {
    title: 'Make the data source visible',
    steps: ['Add a small sample dataset under data/, or a documented script that downloads it.', 'State the source and licence of the data in the README.'],
    verification: 'The data file or download script is in the repository and the analysis runs against it. Re-run the inspection to confirm.',
  },
  frontend: {
    title: 'Publish a frontend application',
    steps: ['Add or pin a project with client-side code (for example a React, Vue or Svelte app).', 'Include a screenshot and run instructions in its README.'],
    verification: 'Component files are visible in the repository and the app starts with the documented command. Re-run the inspection to confirm.',
  },
  backend: {
    title: 'Publish backend or API code',
    steps: ['Add a service with clear route or handler structure, or an OpenAPI definition for an existing one.', 'Document one request and response in the README.'],
    verification: 'The service starts locally and the documented request returns the documented response. Re-run the inspection to confirm.',
  },
  service: {
    title: 'Publish a service with clear structure',
    steps: ['Organise one project into routes or handlers, business logic and data access.', 'Document how to start it and one example request.'],
    verification: 'The service starts locally and answers the documented request. Re-run the inspection: "Service or API code structure" should be observed.',
  },
  database: {
    title: 'Commit the database schema or migrations',
    steps: ['Add migration files or a schema definition (for example a migrations/ folder or schema.prisma).', 'Document how to apply them.'],
    verification: 'Applying the migrations to an empty database succeeds. Re-run the inspection: the files should be listed as source paths.',
  },
  'api-contract': {
    title: 'Add an API specification',
    steps: ['Describe the existing endpoints in openapi.yaml (or a .proto / .graphql schema).', 'Link it from the README.'],
    verification: 'The specification validates in an OpenAPI or schema linter. Re-run the inspection: it should be listed as a source path.',
  },
  containers: {
    title: 'Containerise one service',
    steps: ['Add a Dockerfile that builds and runs the project as a non-root user.', 'Document the build and run commands.'],
    verification: 'docker build and docker run succeed from a clean checkout. Re-run the inspection: the Dockerfile should be listed as a source path.',
  },
  infrastructure: {
    title: 'Publish infrastructure as code',
    steps: ['Describe one environment in Terraform, Helm or Kubernetes manifests, with secrets kept out of the repository.', 'Document how to plan and apply it.'],
    verification: 'A validate or plan command succeeds without errors. Re-run the inspection: the files should be listed as source paths.',
  },
  operations: {
    title: 'Add operational tooling',
    steps: ['Add a Makefile or scripts/ folder for the routine tasks (build, test, release).', 'Reference those commands from the README.'],
    verification: 'Each documented command runs from a clean checkout. Re-run the inspection to confirm.',
  },
};

function listRepos(repos: string[]): string {
  if (repos.length <= 2) return repos.join(' and ');
  return `${repos.slice(0, 2).join(', ')} and ${repos.length - 2} more`;
}

function buildActions(role: RoleAssessment, definition: RoleDefinition, inspected: RepoInspection[]): EvidenceAction[] {
  const actions: EvidenceAction[] = [];

  for (const result of role.criteria) {
    // Only criteria with a concrete, observed gap produce an action. Unknown never does.
    if (result.ratio === null || result.ratio >= 1) continue;
    const criterion = definition.criteria.find((c) => c.id === result.id)!;
    const impact = round1(result.weight * (1 - result.ratio));

    if (criterion.kind === 'evidence') {
      const missing = inspected.filter((repo) => repo.findings[criterion.category].status === 'not_found');
      if (missing.length === 0) continue;
      const template = EVIDENCE_ACTIONS[criterion.category];
      const repos = missing.map((r) => r.repoName);
      actions.push({
        id: `${role.role}:${result.id}`,
        title: template.title(repos),
        priority: 'low',
        impact,
        criterionId: result.id,
        evidence: `${missing[0].repoName}: ${missing[0].findings[criterion.category].summary}`,
        repos,
        steps: template.steps,
        verification: template.verification,
      });
    } else {
      const template = MARKER_ACTIONS[criterion.id];
      if (!template) continue;
      actions.push({
        id: `${role.role}:${result.id}`,
        title: template.title,
        priority: 'low',
        impact,
        criterionId: result.id,
        evidence: `${result.label}: ${result.explanation} If it lives in a repository that was not inspected, no action is needed.`,
        repos: [],
        steps: template.steps,
        verification: template.verification,
      });
    }
  }

  // Highest impact first; ties broken by the rubric order, so output is stable
  const order = new Map(definition.criteria.map((c, index) => [c.id, index]));
  actions.sort((a, b) => b.impact - a.impact || (order.get(a.criterionId) ?? 0) - (order.get(b.criterionId) ?? 0));

  return actions.slice(0, MAX_ACTIONS_PER_ROLE).map((action) => ({
    ...action,
    priority: action.impact >= 15 ? 'high' : action.impact >= 8 ? 'medium' : 'low',
  }));
}

/** Deterministic role-aware assessment of the inspection evidence. Pure: same evidence, same result. */
export function assessEvidence(evidence: PortfolioEvidence): EvidenceAssessment {
  const inspected = evidence.repos.filter((r) => r.state !== 'not_inspected');
  const uninspectedEligible = Math.max(0, evidence.eligibleCount - inspected.length);

  const roles = ROLE_DEFINITIONS.map((definition) => assessRole(definition, inspected, uninspectedEligible));

  const actionsByRole = {} as Record<RoleId, EvidenceAction[]>;
  ROLE_DEFINITIONS.forEach((definition, index) => {
    actionsByRole[definition.role] = buildActions(roles[index], definition, inspected);
  });

  let strongestRole: RoleId | null = null;
  let best = -1;
  for (const role of roles) {
    // Strictly greater: on a tie the earlier role in the fixed order is kept
    if (role.score !== null && role.score > best) {
      best = role.score;
      strongestRole = role.role;
    }
  }

  return {
    roles,
    actionsByRole,
    strongestRole,
    scope: {
      inspectedRepos: inspected.length,
      partialRepos: inspected.filter((r) => r.state === 'partial').length,
      selectedRepos: evidence.selectedCount,
      eligibleRepos: evidence.eligibleCount,
      uninspectedEligibleRepos: uninspectedEligible,
    },
  };
}

/** Coverage below this share of a role's weights is called out as limited evidence */
export const LIMITED_COVERAGE_PERCENT = 70;

/**
 * Plain-language reasons why a role score should be read with caution. An empty list means the
 * score rests on complete listings of every eligible repository. Pure and deterministic.
 */
export function describeEvidenceLimits(role: RoleAssessment, scope: EvidenceAssessment['scope']): string[] {
  const limits: string[] = [];
  if (role.score === null) {
    limits.push('No criterion could be assessed, so there is no score for this role.');
    return limits;
  }
  if (role.coveragePercent < LIMITED_COVERAGE_PERCENT) {
    limits.push(`Only ${role.coveragePercent}% of this role's criteria could be assessed; the rest are unknown and left out of the score.`);
  }
  if (scope.inspectedRepos < 2) {
    limits.push(`The score rests on ${scope.inspectedRepos === 1 ? 'a single repository' : 'no repositories'}.`);
  }
  if (scope.uninspectedEligibleRepos > 0) {
    limits.push(
      `${scope.uninspectedEligibleRepos} eligible ${scope.uninspectedEligibleRepos === 1 ? 'repository was' : 'repositories were'} not inspected and may contain evidence this score does not reflect.`
    );
  }
  if (scope.partialRepos > 0) {
    limits.push(`${scope.partialRepos} file ${scope.partialRepos === 1 ? 'listing was' : 'listings were'} only partly read.`);
  }
  return limits;
}

