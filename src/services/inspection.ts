import type { GitHubRepo } from '../types/github';
import {
  EVIDENCE_CATEGORIES,
  type EvidenceCategory,
  type EvidenceConfidence,
  type EvidenceCoverage,
  type EvidenceFinding,
  type EvidenceStrength,
  type NotInspectedReason,
  type PortfolioEvidence,
  type RepoInspection,
  type RepoTree,
  type RepoTreeEntry,
  type RuleMatch,
  type StackMarker,
} from '../types/evidence';

// Deterministic, path-based repository inspection. No file contents are read and nothing here
// performs I/O: every function maps a file listing to findings, so results are reproducible.

export const INSPECTION_LIMITS = {
  /** Repositories inspected per audit (one GitHub request each) */
  maxRepos: 6,
  /** File paths considered per repository */
  maxEntriesPerRepo: 2000,
  /** Longest path considered; longer ones are ignored */
  maxPathLength: 300,
  /** Paths quoted per finding */
  maxSourcePaths: 5,
  /** README-named files remembered per repository */
  maxReadmeCandidates: 10,
} as const;

// Third-party or generated directories. Evidence inside them says nothing about the author's own work.
// Keep in sync with IGNORED_TREE_DIRS in server.js.
export const IGNORED_DIRS = [
  'node_modules',
  'vendor',
  'third_party',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  'site-packages',
  '__pycache__',
  '.git',
  '.ipynb_checkpoints',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'coverage',
  'Pods',
];

const IGNORED_DIR_SET = new Set(IGNORED_DIRS);

function depthOf(path: string): number {
  let depth = 1;
  for (let i = 0; i < path.length; i++) if (path.charCodeAt(i) === 47) depth++;
  return depth;
}

function isIgnoredPath(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_DIR_SET.has(segment));
}

/**
 * Reduces any GitHub git-tree payload (raw or already compacted by our proxy) to a bounded,
 * deterministic listing: vendored paths removed, shallowest paths first, capped in count.
 */
export function normalizeRepoTree(payload: unknown): RepoTree {
  const raw = payload as { tree?: unknown; truncated?: unknown } | null;
  const list = raw && Array.isArray(raw.tree) ? raw.tree : [];
  let truncated = Boolean(raw && raw.truncated === true);

  const entries: RepoTreeEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as { path?: unknown; type?: unknown; size?: unknown };
    if (typeof entry.path !== 'string' || (entry.type !== 'blob' && entry.type !== 'tree')) continue;
    if (entry.path.length === 0 || entry.path.length > INSPECTION_LIMITS.maxPathLength) continue;
    if (isIgnoredPath(entry.path)) continue;
    entries.push({
      path: entry.path,
      type: entry.type,
      ...(entry.type === 'blob' && typeof entry.size === 'number' ? { size: entry.size } : {}),
    });
  }

  entries.sort((a, b) => depthOf(a.path) - depthOf(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (entries.length > INSPECTION_LIMITS.maxEntriesPerRepo) {
    entries.length = INSPECTION_LIMITS.maxEntriesPerRepo;
    truncated = true;
  }

  return { entries, truncated };
}

interface PathInfo {
  path: string;
  lower: string;
  base: string; // lower-cased file name
  rawBase: string; // file name in its original case
  stem: string; // lower-cased file name without its last extension
  ext: string; // lower-cased last extension without the dot, '' if none
  dirs: string[]; // lower-cased parent directory names
  depth: number;
  isFile: boolean;
  size?: number;
  /** Inside a test, fixture or mock directory */
  inTestContext: boolean;
  /** Inside application source or static-asset directories */
  inAppContext: boolean;
}

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress', 'playwright', 'integration_tests', 'testing']);
const FIXTURE_DIRS = new Set(['fixtures', '__fixtures__', 'mocks', '__mocks__', 'mock', 'stubs', 'testdata', 'test_data', 'seeds', 'seed']);
const APP_ROOT_DIRS = new Set(['src', 'app', 'lib', 'public', 'static', 'assets', 'web', 'client', 'frontend', 'www', 'pages', 'components']);
const DOCS_DIRS = new Set(['docs', 'doc', 'documentation', 'wiki']);
const DEPLOY_DIRS = new Set(['k8s', 'kubernetes', 'helm', 'charts', 'manifests', 'deploy', 'deployment', 'infra', 'infrastructure', 'terraform']);
const DATA_ROOT_DIRS = new Set(['data', 'datasets', 'dataset']);

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy',
  'cs', 'fs', 'php', 'swift', 'dart', 'ex', 'exs', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'r', 'jl', 'lua', 'sh', 'zig', 'gleam', 'ml', 'hs', 'clj',
]);
// Tabular or array data formats. JSON and YAML are left out on purpose: they are mostly configuration.
const DATA_EXTENSIONS = new Set(['csv', 'tsv', 'parquet', 'feather', 'arrow', 'jsonl', 'ndjson', 'xlsx', 'xls', 'sav', 'dta', 'npy', 'npz', 'orc', 'avro']);
// Formats that are, in practice, only used for trained model weights
const MODEL_EXTENSIONS = new Set(['pt', 'pth', 'onnx', 'h5', 'hdf5', 'keras', 'safetensors', 'ckpt', 'tflite', 'gguf', 'mlmodel', 'pmml']);
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'rst', 'adoc', 'txt']);
const YAML = /\.ya?ml$/;

function toPathInfo(entry: RepoTreeEntry): PathInfo {
  const lower = entry.path.toLowerCase();
  const segments = lower.split('/');
  const base = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);
  const dot = base.lastIndexOf('.');
  return {
    path: entry.path,
    lower,
    base,
    rawBase: entry.path.slice(entry.path.lastIndexOf('/') + 1),
    stem: dot > 0 ? base.slice(0, dot) : base,
    ext: dot > 0 ? base.slice(dot + 1) : '',
    dirs,
    depth: segments.length,
    isFile: entry.type === 'blob',
    size: entry.size,
    inTestContext: dirs.some((d) => TEST_DIRS.has(d) || FIXTURE_DIRS.has(d)),
    inAppContext: dirs.length > 0 && APP_ROOT_DIRS.has(dirs[0]),
  };
}

interface PathRule {
  /** Stable id recorded on findings and markers */
  id: string;
  /** What the rule looks for, shown to the user */
  description: string;
  strength: EvidenceStrength;
  test: (p: PathInfo) => boolean;
}

const rule = (id: string, strength: EvidenceStrength, description: string, test: (p: PathInfo) => boolean): PathRule => ({
  id,
  strength,
  description,
  test: (p) => p.isFile && test(p),
});

const isCode = (p: PathInfo) => CODE_EXTENSIONS.has(p.ext);

// ---- Tests -------------------------------------------------------------------------------

const isTestFileBySuffix = (p: PathInfo) =>
  /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|py|rb|php|dart)$/.test(p.base);

const isTestFileByLanguageConvention = (p: PathInfo) =>
  /_test\.(go|py|rb|dart|exs?|rs|cc|cpp|c)$/.test(p.base) ||
  /^test_.+\.py$/.test(p.base) ||
  /_spec\.rb$/.test(p.base) ||
  // Case-sensitive on purpose: "UserTest.java" is a test, "Latest.java" and "contest.cs" are not
  /[a-z0-9](Test|Tests|Spec)\.(java|kt|cs|scala|groovy|php|swift)$/.test(p.rawBase);

const TEST_RULES: PathRule[] = [
  rule('test-file-suffix', 'strong', 'File named *.test.* or *.spec.* with a source-code extension', isTestFileBySuffix),
  rule('test-file-language-convention', 'strong', 'File following a language test-naming convention (for example *_test.go, test_*.py, *Test.java)', isTestFileByLanguageConvention),
  rule(
    'test-runner-config',
    'strong',
    'Test runner configuration file',
    (p) =>
      /^(jest|vitest|playwright|cypress|karma|wdio)\.config\.[a-z]+$/.test(p.base) ||
      /^vitest\.workspace\.[a-z]+$/.test(p.base) ||
      /^\.mocharc(\.[a-z]+)?$/.test(p.base) ||
      ['pytest.ini', 'tox.ini', 'noxfile.py', 'conftest.py', 'phpunit.xml', 'phpunit.xml.dist', '.rspec', 'karma.conf.js'].includes(p.base)
  ),
  rule(
    'test-directory-convention',
    'strong',
    'Source file in a directory reserved for tests by its ecosystem (__tests__, src/test/<language>, Cargo tests/)',
    (p) =>
      isCode(p) &&
      (p.dirs.includes('__tests__') ||
        /(^|\/)src\/test\/(java|kotlin|scala|groovy)\//.test(p.lower) ||
        (p.ext === 'rs' && p.dirs.length === 1 && p.dirs[0] === 'tests'))
  ),
  rule(
    'test-directory-name',
    'weak',
    'Source file inside a directory named like a test folder (test, tests, spec, e2e)',
    (p) => isCode(p) && p.dirs.some((d) => TEST_DIRS.has(d))
  ),
];

// ---- CI ----------------------------------------------------------------------------------

const isWorkflowFile = (p: PathInfo) => p.depth === 3 && p.lower.startsWith('.github/workflows/') && YAML.test(p.base);
const CI_WORKFLOW_NAME = /(^|[-_.])(ci|test|tests|testing|build|lint|check|checks|verify|validate|qa|unit|integration|e2e|pytest|coverage|quality|codeql)([-_.]|$)/;
const DEPLOY_WORKFLOW_NAME = /(^|[-_.])(deploy|deployment|pages|cd|gh-pages)([-_.]|$)/;

const CI_RULES: PathRule[] = [
  rule('gha-ci-workflow', 'strong', 'GitHub Actions workflow named for build, test or lint', (p) => isWorkflowFile(p) && CI_WORKFLOW_NAME.test(p.stem)),
  rule(
    'other-ci-provider',
    'strong',
    'Configuration file of another CI system',
    (p) =>
      [
        '.gitlab-ci.yml',
        '.circleci/config.yml',
        'azure-pipelines.yml',
        '.travis.yml',
        'jenkinsfile',
        'bitbucket-pipelines.yml',
        '.drone.yml',
        '.cirrus.yml',
        'appveyor.yml',
        '.appveyor.yml',
        '.woodpecker.yml',
        '.buildkite/pipeline.yml',
        '.buildkite/pipeline.yaml',
        '.semaphore/semaphore.yml',
        '.teamcity/settings.kts',
      ].includes(p.lower) ||
      (p.depth === 2 && (p.dirs[0] === '.woodpecker' || p.dirs[0] === '.azure-pipelines') && YAML.test(p.base))
  ),
  rule(
    'gha-workflow-unclassified',
    'weak',
    'GitHub Actions workflow whose purpose cannot be told from its file name',
    (p) => isWorkflowFile(p) && !CI_WORKFLOW_NAME.test(p.stem)
  ),
];

// ---- Deployment --------------------------------------------------------------------------

const isContainerFile = (p: PathInfo) =>
  p.depth <= 3 &&
  (p.base === 'dockerfile' || p.base.startsWith('dockerfile.') || p.base.endsWith('.dockerfile') || /^(docker-)?compose(\.[a-z0-9-]+)?\.ya?ml$/.test(p.base));

const isInfrastructureFile = (p: PathInfo) =>
  p.ext === 'tf' ||
  p.base === 'chart.yaml' ||
  /^kustomization\.ya?ml$/.test(p.base) ||
  (YAML.test(p.base) && p.dirs.some((d) => d === 'k8s' || d === 'kubernetes' || d === 'helm' || d === 'charts'));

const DEPLOYMENT_RULES: PathRule[] = [
  rule('container-definition', 'strong', 'Dockerfile or Compose file', isContainerFile),
  rule(
    'platform-config',
    'strong',
    'Hosting platform configuration file',
    (p) =>
      p.depth <= 2 &&
      [
        'vercel.json',
        'netlify.toml',
        'fly.toml',
        'render.yaml',
        'procfile',
        'app.yaml',
        'cloudbuild.yaml',
        'cloudbuild.yml',
        'serverless.yml',
        'serverless.yaml',
        'firebase.json',
        'wrangler.toml',
        'railway.json',
        'heroku.yml',
        'skaffold.yaml',
      ].includes(p.base)
  ),
  rule('infrastructure-as-code', 'strong', 'Terraform, Helm, Kustomize or Kubernetes manifest', isInfrastructureFile),
  rule('deploy-workflow', 'weak', 'GitHub Actions workflow named for deployment', (p) => isWorkflowFile(p) && DEPLOY_WORKFLOW_NAME.test(p.stem)),
  rule(
    'deploy-directory',
    'weak',
    'Configuration or script inside a directory named for deployment or infrastructure',
    (p) => p.depth <= 3 && p.dirs.length > 0 && DEPLOY_DIRS.has(p.dirs[0]) && /\.(ya?ml|json|sh|tf)$/.test(p.base)
  ),
];

// ---- README and documentation ------------------------------------------------------------

// README, README.md, readme.rst, README.en.md, README-zh.md ...
// ... but not readme.ts or README.md.bak: the last extension must be absent or a document format
const README_EXTENSIONS = new Set(['', 'md', 'mdx', 'markdown', 'rst', 'txt', 'adoc', 'asciidoc', 'org', 'rdoc', 'pod', 'textile']);
const isReadmeName = (p: PathInfo) => /^readme([._-][a-z0-9_-]+)*$/.test(p.base) && README_EXTENSIONS.has(p.ext);

const README_RULES: PathRule[] = [
  rule('readme-root', 'strong', 'README file at the repository root', (p) => p.depth === 1 && isReadmeName(p)),
  rule('readme-nested', 'weak', 'README file in a subdirectory only', (p) => p.depth > 1 && p.depth <= 3 && isReadmeName(p)),
];

const DOCUMENTATION_RULES: PathRule[] = [
  rule('docs-directory', 'strong', 'Written document inside a docs directory', (p) => p.dirs.length > 0 && DOCS_DIRS.has(p.dirs[0]) && DOC_EXTENSIONS.has(p.ext) && !isReadmeName(p)),
  rule(
    'docs-site-config',
    'strong',
    'Documentation site configuration',
    (p) =>
      p.depth <= 2 &&
      (/^mkdocs\.ya?ml$/.test(p.base) || /^\.readthedocs\.ya?ml$/.test(p.base) || /^docusaurus\.config\.[a-z]+$/.test(p.base) || (p.base === 'conf.py' && p.dirs.some((d) => DOCS_DIRS.has(d))))
  ),
  rule(
    'project-docs',
    'strong',
    'Contributor, change-log, architecture or model-card document',
    (p) => p.depth <= 2 && /^(contributing|changelog|code_of_conduct|security|architecture|history|releases|roadmap|model_card|modelcard|datasheet|dataset_card)(\.[a-z0-9]+)?$/.test(p.base)
  ),
  rule('docs-directory-other', 'weak', 'Non-text file inside a docs directory', (p) => p.dirs.length > 0 && DOCS_DIRS.has(p.dirs[0]) && !DOC_EXTENSIONS.has(p.ext)),
];

const RULES: Record<EvidenceCategory, PathRule[]> = {
  readme: README_RULES,
  tests: TEST_RULES,
  ci: CI_RULES,
  deployment: DEPLOYMENT_RULES,
  documentation: DOCUMENTATION_RULES,
};

const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  readme: 'README',
  tests: 'automated tests',
  ci: 'CI workflows',
  deployment: 'deployment configuration',
  documentation: 'documentation beyond the README',
};

/** What a file-path finding does not establish. Shown with every finding. */
const CATEGORY_LIMITATIONS: Record<EvidenceCategory, string[]> = {
  readme: ['File name and size only: the contents were not read, so nothing is known about their quality.'],
  tests: ['Shows that test files exist. It does not show that they run, pass, or cover the code.'],
  ci: ['Shows that workflow files exist. It does not show what they do, or that they run or pass.'],
  deployment: ['Shows configuration files. It does not show that anything is deployed or reachable.'],
  documentation: ['File names only: the contents were not read.'],
};

// ---- Stack markers -----------------------------------------------------------------------

interface MarkerDefinition {
  id: string;
  label: string;
  rules: PathRule[];
  limitations: string[];
  /** False for context markers that only explain what was NOT counted */
  countsAsEvidence?: boolean;
}

const ML_LIMITS = ['A file name does not show that a model was trained, evaluated, accurate, reproducible, secure or deployed.'];
const DATA_LIMITS = ['A file name does not show what the data contains, where it came from, or whether it may be shared.'];
const STRUCTURE_LIMITS = ['Shows project structure only: the code was not read or run.'];

const isNotebook = (p: PathInfo) => p.ext === 'ipynb' || p.ext === 'rmd' || p.ext === 'qmd';
const pyScript = (p: PathInfo, names: string) => p.ext === 'py' && new RegExp(`^(${names})([_-][a-z0-9_-]+)?$`).test(p.stem);
const isDataFile = (p: PathInfo) => DATA_EXTENSIONS.has(p.ext);
const inDataDirectory = (p: PathInfo) =>
  (p.dirs.length > 0 && DATA_ROOT_DIRS.has(p.dirs[0])) || /(^|\/)data\/(raw|processed|interim|external|clean|cleaned)\//.test(p.lower);
const inFixtureLikeDirectory = (p: PathInfo) => p.dirs.some((d) => FIXTURE_DIRS.has(d) || d === 'data' || d === 'datasets');
const isServiceStructureFile = (p: PathInfo) =>
  isCode(p) && !p.inTestContext && p.dirs.some((d) => ['routes', 'controllers', 'handlers', 'middleware', 'middlewares', 'routers', 'endpoints', 'resolvers'].includes(d));
const isServiceEntrypoint = (p: PathInfo) =>
  ['manage.py', 'wsgi.py', 'asgi.py', 'main.go'].includes(p.base) || (p.depth <= 2 && /^server\.(js|ts|mjs|cjs|py|go|rb)$/.test(p.base));

const MARKERS: MarkerDefinition[] = [
  {
    id: 'notebooks',
    label: 'Notebooks',
    limitations: ['Shows that notebooks exist. It does not show that they run or what they conclude.'],
    rules: [rule('notebook-file', 'strong', 'Jupyter, R Markdown or Quarto notebook', isNotebook)],
  },
  {
    id: 'python-project',
    label: 'Python dependency manifest',
    limitations: ['Shows that dependencies are declared. It does not show that the environment installs or is pinned.'],
    rules: [
      rule(
        'python-manifest',
        'strong',
        'Python dependency or packaging file',
        (p) =>
          p.depth <= 2 &&
          (['pyproject.toml', 'setup.py', 'setup.cfg', 'pipfile', 'pipfile.lock', 'environment.yml', 'environment.yaml', 'conda.yaml', 'conda.yml', 'poetry.lock', 'uv.lock'].includes(p.base) ||
            /^requirements([-_.][a-z0-9_.-]+)?\.txt$/.test(p.base) ||
            (p.ext === 'txt' && p.dirs[p.dirs.length - 1] === 'requirements'))
      ),
    ],
  },
  {
    id: 'node-project',
    label: 'Node.js project manifest',
    limitations: STRUCTURE_LIMITS,
    rules: [rule('node-manifest', 'strong', 'package.json manifest', (p) => p.depth <= 3 && p.base === 'package.json')],
  },
  { id: 'go-project', label: 'Go module', limitations: STRUCTURE_LIMITS, rules: [rule('go-module', 'strong', 'go.mod module file', (p) => p.depth <= 2 && p.base === 'go.mod')] },
  { id: 'rust-project', label: 'Rust crate', limitations: STRUCTURE_LIMITS, rules: [rule('rust-manifest', 'strong', 'Cargo.toml manifest', (p) => p.depth <= 2 && p.base === 'cargo.toml')] },
  {
    id: 'jvm-project',
    label: 'JVM build file',
    limitations: STRUCTURE_LIMITS,
    rules: [rule('jvm-build-file', 'strong', 'Maven or Gradle build file', (p) => p.depth <= 2 && ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(p.base))],
  },
  {
    id: 'ml-training',
    label: 'Model training code',
    limitations: ML_LIMITS,
    rules: [
      rule('ml-training-script', 'strong', 'Python script named for training or fine-tuning (train.py, train_*.py, finetune.py)', (p) => !p.inTestContext && (pyScript(p, 'train|training|trainer|finetune|fine_tune|fine-tune') || (p.ext === 'py' && /_(train|training|trainer)$/.test(p.stem)))),
      rule('ml-training-notebook', 'strong', 'Notebook named for training or fine-tuning', (p) => isNotebook(p) && /(^|[-_ ])(train|training|finetune|fine[-_]tune|fine[-_]tuning)([-_ ]|$)/.test(p.stem)),
    ],
  },
  {
    id: 'ml-evaluation',
    label: 'Model evaluation code',
    limitations: ML_LIMITS,
    rules: [
      rule('ml-evaluation-script', 'strong', 'Python script named for evaluation (evaluate.py, eval_*.py)', (p) => !p.inTestContext && pyScript(p, 'eval|evaluate|evaluation')),
      rule('ml-evaluation-notebook', 'strong', 'Notebook named for evaluation', (p) => isNotebook(p) && /(^|[-_ ])(eval|evaluate|evaluation)([-_ ]|$)/.test(p.stem)),
    ],
  },
  {
    id: 'ml-inference',
    label: 'Model inference code',
    limitations: ML_LIMITS,
    rules: [rule('ml-inference-script', 'strong', 'Python script named for inference or prediction (predict.py, inference.py)', (p) => !p.inTestContext && pyScript(p, 'inference|infer|predict|prediction'))],
  },
  {
    id: 'ml-models',
    label: 'Model files',
    limitations: ML_LIMITS,
    rules: [
      rule('ml-model-file', 'strong', 'File in a model-weights format (.pt, .onnx, .safetensors, .h5 ...)', (p) => MODEL_EXTENSIONS.has(p.ext)),
      rule('ml-serialized-object', 'weak', 'Serialised Python object (.pkl, .joblib), which may or may not be a model', (p) => ['pkl', 'pickle', 'joblib'].includes(p.ext)),
      rule('ml-checkpoint-directory', 'weak', 'File inside a directory named checkpoints, weights or saved_models', (p) => p.dirs.some((d) => d === 'checkpoints' || d === 'weights' || d === 'saved_models') && !MODEL_EXTENSIONS.has(p.ext)),
    ],
  },
  {
    id: 'datasets',
    label: 'Datasets',
    limitations: DATA_LIMITS,
    rules: [
      rule('dataset-in-data-directory', 'strong', 'Data file (.csv, .parquet, .jsonl ...) in a top-level data directory or a data/raw-style layout', (p) => isDataFile(p) && inDataDirectory(p) && !p.inTestContext),
      rule('dataset-pointer', 'strong', 'Dataset pointer or description (*.dvc, dataset card, datasheet)', (p) => (p.ext === 'dvc' && !p.dirs.includes('.dvc')) || /^(dataset_card|datasheet)(\.[a-z0-9]+)?$/.test(p.base)),
      rule('data-file-elsewhere', 'weak', 'Data file outside a data directory, application source and test folders', (p) => isDataFile(p) && !inDataDirectory(p) && !p.inTestContext && !p.inAppContext),
    ],
  },
  {
    id: 'app-fixture-data',
    label: 'Application fixture, mock or test data (not counted as a dataset)',
    countsAsEvidence: false,
    limitations: ['Recorded only to explain why these files were not treated as datasets.'],
    rules: [
      rule(
        'fixture-source-file',
        'weak',
        'Source or configuration file in a data, fixtures or mocks directory (for example src/data/mockProfiles.ts)',
        (p) => inFixtureLikeDirectory(p) && (isCode(p) || ['json', 'yaml', 'yml'].includes(p.ext))
      ),
      rule('fixture-data-file', 'weak', 'Data file inside application source, static assets or test folders', (p) => isDataFile(p) && (p.inTestContext || p.inAppContext) && !inDataDirectory(p)),
    ],
  },
  {
    id: 'data-pipeline',
    label: 'Data pipeline tooling',
    limitations: ['Shows pipeline configuration. It does not show that the pipeline runs.'],
    rules: [
      rule('pipeline-config', 'strong', 'Pipeline definition (dbt, DVC, Snakemake, MLflow project, Airflow DAG)', (p) => ['dbt_project.yml', 'dvc.yaml', 'snakefile', 'mlproject'].includes(p.base) || (p.ext === 'py' && p.dirs.includes('dags'))),
      rule('pipeline-directory', 'weak', 'Source file in a directory named pipelines or etl', (p) => isCode(p) && !p.inTestContext && p.dirs.some((d) => d === 'pipelines' || d === 'pipeline' || d === 'etl')),
    ],
  },
  {
    id: 'frontend-app',
    label: 'Frontend application code',
    limitations: STRUCTURE_LIMITS,
    rules: [
      rule('frontend-component-file', 'strong', 'Component file (.tsx, .jsx, .vue, .svelte) that is not a test', (p) => ['tsx', 'jsx', 'vue', 'svelte'].includes(p.ext) && !isTestFileBySuffix(p) && !p.inTestContext),
      rule('frontend-framework-config', 'strong', 'Frontend framework configuration', (p) => /^(vite|next|nuxt|svelte|astro|angular|tailwind|remix|gatsby)\.config\.[a-z]+$/.test(p.base) || p.base === 'angular.json'),
      rule('static-site-entry', 'weak', 'index.html at the repository root (a static page, not necessarily an application)', (p) => p.depth === 1 && p.base === 'index.html'),
    ],
  },
  {
    id: 'backend-service',
    label: 'Backend service code',
    limitations: STRUCTURE_LIMITS,
    rules: [
      rule('service-structure-directory', 'strong', 'Source file in a routes, controllers, handlers, middleware or resolvers directory', isServiceStructureFile),
      rule('service-entrypoint', 'strong', 'Recognised server entry point (server.js, manage.py, wsgi.py, main.go)', isServiceEntrypoint),
      rule('api-directory-name', 'weak', 'Source file in a directory named api or server, which frontends also use for API clients', (p) => isCode(p) && !p.inTestContext && !isServiceStructureFile(p) && !isServiceEntrypoint(p) && p.dirs.some((d) => d === 'api' || d === 'server')),
    ],
  },
  {
    id: 'database',
    label: 'Database schema or migrations',
    limitations: ['Shows schema files. It does not show that migrations apply cleanly.'],
    rules: [
      rule('migrations-or-schema', 'strong', 'Migration directory or schema definition', (p) => p.dirs.some((d) => d === 'migrations' || d === 'alembic') || ['schema.prisma', 'schema.sql', 'alembic.ini'].includes(p.base)),
      rule('sql-file', 'weak', 'SQL file outside a migrations directory', (p) => p.ext === 'sql' && !p.inTestContext && p.base !== 'schema.sql' && !p.dirs.some((d) => d === 'migrations' || d === 'alembic')),
    ],
  },
  {
    id: 'api-spec',
    label: 'API specification',
    limitations: ['Shows a specification file. It does not show that the implementation matches it.'],
    rules: [rule('api-spec-file', 'strong', 'OpenAPI, protobuf or GraphQL schema', (p) => /^(openapi|swagger)\.(ya?ml|json)$/.test(p.base) || p.ext === 'proto' || p.ext === 'graphql' || p.ext === 'gql')],
  },
  { id: 'containers', label: 'Container definitions', limitations: CATEGORY_LIMITATIONS.deployment, rules: [rule('container-definition', 'strong', 'Dockerfile or Compose file', isContainerFile)] },
  { id: 'infrastructure', label: 'Infrastructure as code', limitations: CATEGORY_LIMITATIONS.deployment, rules: [rule('infrastructure-as-code', 'strong', 'Terraform, Helm, Kustomize or Kubernetes manifest', isInfrastructureFile)] },
  { id: 'automation', label: 'CI automation', limitations: CATEGORY_LIMITATIONS.ci, rules: CI_RULES },
  {
    id: 'ops-scripts',
    label: 'Operational tooling',
    limitations: ['Shows operational files. It does not show that they are used or work.'],
    rules: [
      rule('monitoring-or-config-management', 'strong', 'Monitoring or configuration-management files (Prometheus, Grafana, Ansible)', (p) => ['prometheus.yml', 'prometheus.yaml', 'alertmanager.yml'].includes(p.base) || p.dirs.some((d) => d === 'ansible' || d === 'monitoring' || d === 'grafana')),
      rule('build-automation-file', 'weak', 'Makefile, justfile or Taskfile, which are general build tools', (p) => p.depth <= 2 && ['makefile', 'justfile', 'taskfile.yml', 'taskfile.yaml'].includes(p.base)),
      rule('operations-shell-script', 'weak', 'Shell script in a scripts, ops or bin directory', (p) => p.ext === 'sh' && p.dirs.some((d) => d === 'scripts' || d === 'ops' || d === 'bin')),
    ],
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface RuleEvaluation {
  matches: RuleMatch[];
  /** Distinct matching paths, strongly matched ones first, then in listing order */
  paths: string[];
  hasStrong: boolean;
}

function evaluateRules(rules: PathRule[], infos: PathInfo[]): RuleEvaluation {
  const matches: RuleMatch[] = [];
  const pathStrength = new Map<string, boolean>();
  let hasStrong = false;

  for (const candidate of rules) {
    const paths: string[] = [];
    let matchCount = 0;
    for (const info of infos) {
      if (!candidate.test(info)) continue;
      matchCount++;
      if (paths.length < INSPECTION_LIMITS.maxSourcePaths) paths.push(info.path);
      const strong = candidate.strength === 'strong';
      pathStrength.set(info.path, (pathStrength.get(info.path) ?? false) || strong);
    }
    if (matchCount === 0) continue;
    if (candidate.strength === 'strong') hasStrong = true;
    matches.push({ ruleId: candidate.id, description: candidate.description, strength: candidate.strength, paths, matchCount });
  }

  const paths = [...pathStrength.entries()].sort((a, b) => Number(b[1]) - Number(a[1])).map(([path]) => path);
  return { matches, paths, hasStrong };
}

function buildFinding(category: EvidenceCategory, infos: PathInfo[], truncated: boolean): EvidenceFinding {
  const { matches, paths, hasStrong } = evaluateRules(RULES[category], infos);
  const label = CATEGORY_LABEL[category];
  const limitations = CATEGORY_LIMITATIONS[category];
  const inspectedCount = infos.length;

  if (paths.length === 0) {
    const none = { category, sourcePaths: [], matchCount: 0, signals: [], provenance: 'file-path' as const, strength: null, matches: [], limitations };
    if (truncated) {
      return {
        ...none,
        status: 'unknown',
        confidence: 'low',
        summary: `No ${label} seen, but only part of the file listing (${inspectedCount} paths) could be inspected, so this is inconclusive.`,
      };
    }
    return {
      ...none,
      status: 'not_found',
      // File names are the only evidence, so a miss is never certain
      confidence: 'medium',
      summary: `No ${label} found in the ${inspectedCount} inspected file paths. It may exist under an unconventional name.`,
    };
  }

  const signals = matches.map((m) => m.ruleId);
  const sourcePaths = paths.slice(0, INSPECTION_LIMITS.maxSourcePaths);
  const confidence: EvidenceConfidence = hasStrong ? 'high' : 'medium';
  const weakNote = hasStrong ? '' : ` Weak signal only: ${matches.map((m) => m.description.charAt(0).toLowerCase() + m.description.slice(1)).join('; ')}.`;

  let summary: string;
  if (category === 'readme') {
    const rootReadme = infos.find((i) => README_RULES[0].test(i));
    if (rootReadme) {
      const size = typeof rootReadme.size === 'number' ? ` (${formatBytes(rootReadme.size)})` : '';
      summary = `${rootReadme.path} found at the repository root${size}. Its contents were not read.`;
      if (typeof rootReadme.size === 'number') {
        signals.push(rootReadme.size >= 1500 ? 'readme-substantial' : rootReadme.size < 300 ? 'readme-stub' : 'readme-brief');
      }
    } else {
      summary = `No README at the repository root; ${paths.length} README file(s) found in subdirectories.`;
    }
  } else if (category === 'ci') {
    if (signals.includes('gha-ci-workflow')) {
      summary = `${paths.length} CI workflow file(s) found, including GitHub Actions. Whether they pass was not checked.`;
    } else if (signals.includes('other-ci-provider')) {
      summary = `CI configuration for another provider found (no GitHub Actions CI workflow). Whether it passes was not checked.`;
    } else {
      summary = `${paths.length} GitHub Actions workflow file(s) found, but none is named for build, test or lint, so it is unclear whether they are CI.`;
    }
  } else {
    summary = `${paths.length} file path(s) indicating ${label}.${weakNote}`;
  }

  return {
    category,
    status: 'found',
    confidence,
    summary,
    sourcePaths,
    matchCount: paths.length,
    signals,
    provenance: 'file-path',
    strength: hasStrong ? 'strong' : 'weak',
    matches,
    limitations,
  };
}

function buildMarkers(infos: PathInfo[]): StackMarker[] {
  const markers: StackMarker[] = [];
  for (const definition of MARKERS) {
    const { matches, paths, hasStrong } = evaluateRules(definition.rules, infos);
    if (paths.length === 0) continue;
    markers.push({
      id: definition.id,
      label: definition.label,
      sourcePaths: paths.slice(0, INSPECTION_LIMITS.maxSourcePaths),
      matchCount: paths.length,
      provenance: 'file-path',
      strength: hasStrong ? 'strong' : 'weak',
      matches,
      limitations: definition.limitations,
      countsAsEvidence: definition.countsAsEvidence !== false,
    });
  }
  return markers;
}

/** Every rule the engine can apply, for documentation and tests */
export function listDetectionRules(): Array<{ scope: string; ruleId: string; strength: EvidenceStrength; description: string }> {
  const out: Array<{ scope: string; ruleId: string; strength: EvidenceStrength; description: string }> = [];
  for (const category of EVIDENCE_CATEGORIES) {
    for (const r of RULES[category]) out.push({ scope: category, ruleId: r.id, strength: r.strength, description: r.description });
  }
  for (const marker of MARKERS) {
    for (const r of marker.rules) out.push({ scope: `marker:${marker.id}`, ruleId: r.id, strength: r.strength, description: r.description });
  }
  return out;
}

function unknownFindings(explanation: string): Record<EvidenceCategory, EvidenceFinding> {
  const findings = {} as Record<EvidenceCategory, EvidenceFinding>;
  for (const category of EVIDENCE_CATEGORIES) {
    findings[category] = {
      category,
      status: 'unknown',
      confidence: 'low',
      summary: explanation,
      sourcePaths: [],
      matchCount: 0,
      signals: [],
      provenance: 'none',
      strength: null,
      matches: [],
      limitations: [],
    };
  }
  return findings;
}

const NOT_INSPECTED_TEXT: Record<NotInspectedReason, string> = {
  not_selected: 'Not inspected: outside the per-audit repository budget.',
  fork: 'Not inspected: forks are skipped because their files are mostly not the author’s own work.',
  empty: 'Not inspected: the repository has no files.',
  demo_data: 'Not inspected: this is a synthetic demo persona with no real repository behind it.',
  rate_limited: 'Not inspected: the GitHub request budget ran out before this repository was reached.',
  too_large: 'Not inspected: the repository file listing exceeds the inspection size limit.',
  not_found: 'Not inspected: the repository file listing could not be found.',
  error: 'Not inspected: the file listing could not be retrieved.',
};

type RepoIdentity = Pick<GitHubRepo, 'name' | 'full_name' | 'html_url'>;

export function notInspected(repo: RepoIdentity, reason: NotInspectedReason): RepoInspection {
  return {
    repo: repo.full_name,
    repoName: repo.name,
    repoUrl: repo.html_url,
    state: 'not_inspected',
    reason,
    entriesInspected: 0,
    truncated: false,
    findings: unknownFindings(NOT_INSPECTED_TEXT[reason]),
    markers: [],
    readmeCandidates: [],
  };
}

/** Turns one repository file listing into evidence findings. Pure and deterministic. */
export function inspectRepoTree(repo: RepoIdentity, tree: RepoTree): RepoInspection {
  const normalized = normalizeRepoTree({ tree: tree.entries, truncated: tree.truncated });
  const files = normalized.entries.filter((e) => e.type === 'blob');
  if (files.length === 0 && !normalized.truncated) return notInspected(repo, 'empty');

  const infos = files.map(toPathInfo);
  const findings = {} as Record<EvidenceCategory, EvidenceFinding>;
  for (const category of EVIDENCE_CATEGORIES) {
    findings[category] = buildFinding(category, infos, normalized.truncated);
  }

  return {
    repo: repo.full_name,
    repoName: repo.name,
    repoUrl: repo.html_url,
    state: normalized.truncated ? 'partial' : 'inspected',
    entriesInspected: files.length,
    truncated: normalized.truncated,
    findings,
    markers: buildMarkers(infos),
    readmeCandidates: infos
      .filter((i) => i.isFile && i.depth <= 3 && isReadmeName(i))
      .slice(0, INSPECTION_LIMITS.maxReadmeCandidates)
      .map((i) => ({ path: i.path, size: typeof i.size === 'number' ? i.size : null })),
  };
}

export interface InspectionSelection {
  selected: GitHubRepo[];
  skipped: Array<{ repo: GitHubRepo; reason: Extract<NotInspectedReason, 'not_selected' | 'fork' | 'empty'> }>;
  eligibleCount: number;
}

/**
 * Chooses which repositories are worth one inspection request each: the author's own, non-empty
 * repositories, most starred first, then most recently pushed. Deterministic for a given input.
 */
export function selectReposForInspection(repos: GitHubRepo[], maxRepos: number = INSPECTION_LIMITS.maxRepos): InspectionSelection {
  const limit = Math.max(0, Math.min(maxRepos, INSPECTION_LIMITS.maxRepos));
  const skipped: InspectionSelection['skipped'] = [];
  const eligible: GitHubRepo[] = [];

  for (const repo of repos) {
    if (repo.fork) skipped.push({ repo, reason: 'fork' });
    else if (!repo.size || repo.disabled) skipped.push({ repo, reason: 'empty' });
    else eligible.push(repo);
  }

  const ranked = [...eligible].sort(
    (a, b) =>
      (b.stargazers_count || 0) - (a.stargazers_count || 0) ||
      new Date(b.pushed_at || 0).getTime() - new Date(a.pushed_at || 0).getTime() ||
      a.name.localeCompare(b.name)
  );

  const selected = ranked.slice(0, limit);
  for (const repo of ranked.slice(limit)) skipped.push({ repo, reason: 'not_selected' });

  return { selected, skipped, eligibleCount: eligible.length };
}

/** Aggregates per-repository inspections. Counts only; interpretation is left to later stages. */
export function summarizeEvidence(
  inspections: RepoInspection[],
  eligibleCount: number,
  selectedCount: number,
  source: PortfolioEvidence['source'] = 'github'
): PortfolioEvidence {
  const coverage = {} as Record<EvidenceCategory, EvidenceCoverage>;
  for (const category of EVIDENCE_CATEGORIES) {
    const tally: EvidenceCoverage = { found: 0, notFound: 0, unknown: 0 };
    for (const inspection of inspections) {
      if (inspection.state === 'not_inspected') continue;
      const status = inspection.findings[category].status;
      if (status === 'found') tally.found++;
      else if (status === 'not_found') tally.notFound++;
      else tally.unknown++;
    }
    coverage[category] = tally;
  }

  return {
    repos: inspections,
    eligibleCount,
    selectedCount,
    inspectedCount: inspections.filter((i) => i.state !== 'not_inspected').length,
    coverage,
    limits: { maxRepos: INSPECTION_LIMITS.maxRepos, maxEntriesPerRepo: INSPECTION_LIMITS.maxEntriesPerRepo },
    method: 'file-paths-only',
    source,
  };
}
