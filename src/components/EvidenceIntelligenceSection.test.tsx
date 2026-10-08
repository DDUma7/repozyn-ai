import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { GitHubRepo } from '../types/github';
import type { RepoTreeResult } from '../types/evidence';
import { MOCK_PROFILES } from '../data/mockProfiles';

vi.mock('../services/github', async (importActual) => {
  const actual = await importActual<typeof import('../services/github')>();
  return { ...actual, fetchRepoTree: vi.fn(), fetchReadmeContent: vi.fn(), fetchGitHubUser: vi.fn(), fetchGitHubRepos: vi.fn(), checkRateLimit: vi.fn() };
});

import { EvidenceIntelligenceSection } from './EvidenceIntelligenceSection';
import { TokenModal } from './TokenModal';
import { App } from '../App';
import { fetchRepoTree, fetchReadmeContent, fetchGitHubUser, fetchGitHubRepos, checkRateLimit } from '../services/github';

const RATE_LIMIT = { limit: 60, remaining: 40, reset: 0, used: 20, resetMinutes: 12, resetTimeFormatted: '' };

const repo = (name: string, overrides: Partial<GitHubRepo> = {}): GitHubRepo => ({
  ...MOCK_PROFILES[1].repos[0],
  id: name.length * 7,
  name,
  full_name: `real-dev/${name}`,
  html_url: `https://github.com/real-dev/${name}`,
  fork: false,
  size: 50,
  stargazers_count: 0,
  default_branch: 'main',
  ...overrides,
});

const tree = (paths: string[]): RepoTreeResult => ({
  ok: true,
  tree: { truncated: false, entries: paths.map((path) => ({ path, type: 'blob' as const, size: 3000 })) },
});

const REPOS = [
  repo('api-server', { stargazers_count: 9, default_branch: 'main' }),
  repo('web-app', { stargazers_count: 5, default_branch: 'release/2024' }),
  repo('some-fork', { fork: true, stargazers_count: 99 }),
];

const section = () => screen.getByRole('region', { name: /Evidence Intelligence/i });

describe('EvidenceIntelligenceSection', () => {
  beforeEach(() => {
    vi.mocked(fetchRepoTree).mockReset();
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    window.history.replaceState(null, '', '/');
  });

  it('fetches nothing until the user starts the inspection, and states the API cost first', () => {
    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} token="" />);

    expect(fetchRepoTree).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeEnabled();
    // One request per repository, plus one more for the branch name that contains a slash
    expect(section()).toHaveTextContent(/Uses up to 3 GitHub API requests of the 40 last observed remaining/);
    expect(section()).toHaveTextContent(/paths and sizes, never file contents/);
    expect(section()).toHaveTextContent('api-server, web-app');
    expect(section()).not.toHaveTextContent('some-fork');
    expect(section()).toHaveTextContent(/Nothing is fetched until you start it/);
  });

  it('inspects on request through the proxy client with each default branch and the user token', async () => {
    vi.mocked(fetchRepoTree).mockImplementation(async (_owner, name) =>
      name === 'api-server'
        ? tree(['README.md', 'server/routes/users.ts', 'tests/users.test.ts', '.github/workflows/ci.yml', 'Dockerfile', 'migrations/001.sql'])
        : tree(['README.md', 'src/App.tsx', 'package.json'])
    );
    const onComplete = vi.fn();

    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} token="ghp_userToken9" onInspectionComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));

    expect(screen.getByRole('status')).toHaveTextContent(/Reading file listings for 2 repositories/);
    expect(section()).toHaveAttribute('aria-busy', 'true');

    await screen.findByText(/Role-aware assessment/i);
    expect(section()).toHaveAttribute('aria-busy', 'false');

    expect(vi.mocked(fetchRepoTree).mock.calls).toEqual([
      ['real-dev', 'api-server', 'ghp_userToken9', 'main'],
      ['real-dev', 'web-app', 'ghp_userToken9', 'release/2024'],
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(section().textContent).not.toContain('ghp_userToken9');

    // Scope, honesty notes and no sample label for real data
    expect(section()).toHaveTextContent(/file listings of 2 of 2 eligible repositories/);
    expect(section()).toHaveTextContent(/file contents were not read and CI results were not checked/);
    expect(section()).toHaveTextContent(/not that it does not exist/);
    expect(section()).not.toHaveTextContent(/SAMPLE|SYNTHETIC/i);

    // Five roles, strongest preselected, criteria show weights and source paths
    const roles = within(screen.getByRole('group', { name: /Target role/i })).getAllByRole('button');
    expect(roles.map((b) => b.textContent)).toEqual([
      expect.stringContaining('AI/ML Engineer'),
      expect.stringContaining('Data Scientist'),
      expect.stringContaining('Full-Stack Engineer'),
      expect.stringContaining('Backend Engineer'),
      expect.stringContaining('DevOps Engineer'),
    ]);
    // No role is preselected: the user has to choose, and nothing role-specific shows until then
    expect(roles.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
    expect(section()).toHaveTextContent(/Select your target role above/);
    expect(section()).not.toHaveTextContent(/Evidence-linked actions/);
    expect(section()).not.toHaveTextContent(/ pts/);
    // Coverage is visible on every role card before a choice is made
    for (const card of roles) expect(card).toHaveTextContent(/Coverage \d+%/);

    fireEvent.click(screen.getByRole('button', { name: /Backend Engineer/ }));
    expect(screen.getByRole('button', { name: /Backend Engineer/ })).toHaveAttribute('aria-pressed', 'true');
    expect(section()).not.toHaveTextContent(/Select your target role above/);
    expect(section()).toHaveTextContent(/Evidence score/);
    expect(section()).toHaveTextContent(/Evidence coverage100 %/);
    expect(section()).toHaveTextContent(/2 of 2 eligible repositories inspected/);
    expect(section()).toHaveTextContent(/ pts/);
    expect(section()).toHaveTextContent(/api-server: tests\/users\.test\.ts/);

    // Switching role changes the rubric and its actions
    fireEvent.click(screen.getByRole('button', { name: /Data Scientist/ }));
    expect(screen.getByRole('button', { name: /Data Scientist/ })).toHaveAttribute('aria-pressed', 'true');
    expect(section()).toHaveTextContent(/Analysis notebooks/);
    expect(section()).toHaveTextContent(/Evidence-linked actions for Data Scientist/);
    expect(section()).toHaveTextContent(/Verify:/);

    // Per-repository findings include the skipped fork with its reason
    expect(section()).toHaveTextContent(/Findings per repository \(3\)/);
    expect(section()).toHaveTextContent(/Not inspected: fork/);
  });

  it('shows a rate-limit state instead of findings when nothing could be inspected', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue({ ok: false, reason: 'rate_limited' });

    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/GitHub request limit reached/);
    expect(alert).toHaveTextContent(/nothing is concluded about this profile/i);
    expect(screen.queryByText(/Role-aware assessment/i)).not.toBeInTheDocument();
    // Stopped after the first refusal rather than hammering the API
    expect(fetchRepoTree).toHaveBeenCalledTimes(2);

    vi.mocked(fetchRepoTree).mockResolvedValue(tree(['README.md']));
    fireEvent.click(within(alert).getByRole('button', { name: /Try again/i }));
    await screen.findByText(/Role-aware assessment/i);
  });

  it('shows an error state with the reason when listings cannot be retrieved', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValueOnce({ ok: false, reason: 'too_large' }).mockResolvedValueOnce({ ok: false, reason: 'error' });

    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Inspection could not be completed/);
    expect(alert).toHaveTextContent(/file listing too large/);
    expect(alert).toHaveTextContent(/could not be retrieved/);
  });

  it('reports partially failed inspections next to the results', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValueOnce(tree(['README.md', 'main.go'])).mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));

    await screen.findByText(/Role-aware assessment/i);
    expect(section()).toHaveTextContent(/file listings of 1 of 2 eligible repositories/);
    expect(section()).toHaveTextContent(/Not inspected: web-app \(file listing not found\)/);
  });

  it('warns when a score rests on limited evidence and stays quiet when it does not', async () => {
    // Eight eligible repositories, only six inspected, one of them with a truncated listing
    const many = Array.from({ length: 8 }, (_, i) => repo(`svc-${i}`, { stargazers_count: 20 - i }));
    vi.mocked(fetchRepoTree).mockImplementation(async (_owner, name) =>
      name === 'svc-0'
        ? { ok: true, tree: { truncated: true, entries: [{ path: 'README.md', type: 'blob', size: 10 }] } }
        : tree(['README.md', 'main.go'])
    );

    const view = render(<EvidenceIntelligenceSection username="real-dev" repos={many} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    expect(screen.queryByRole('note', { name: /Limited evidence/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /DevOps Engineer/ }));
    const warning = screen.getByRole('note', { name: /Limited evidence/i });
    expect(warning).toHaveTextContent(/treat this score as provisional/);
    expect(warning).toHaveTextContent(/2 eligible repositories were not inspected/);
    expect(warning).toHaveTextContent(/1 file listing was only partly read/);
    expect(section()).toHaveTextContent(/6 of 8 eligible repositories inspected/);
    view.unmount();

    // Complete listings of every eligible repository: no warning
    vi.mocked(fetchRepoTree).mockResolvedValue(tree(['README.md', 'main.go']));
    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    fireEvent.click(screen.getByRole('button', { name: /DevOps Engineer/ }));
    expect(screen.queryByRole('note', { name: /Limited evidence/i })).not.toBeInTheDocument();
  });

  it('warns when the score rests on a single repository', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(tree(['README.md']));
    render(<EvidenceIntelligenceSection username="real-dev" repos={[REPOS[0]]} rateLimit={RATE_LIMIT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    fireEvent.click(screen.getByRole('button', { name: /Full-Stack Engineer/ }));
    expect(screen.getByRole('note', { name: /Limited evidence/i })).toHaveTextContent(/rests on a single repository/);
  });

  it('includes branch-resolution requests in the stated request estimate', () => {
    const repos = [
      repo('a', { default_branch: 'main' }),
      repo('b', { default_branch: 'release/2024' }),
      repo('c', { default_branch: 'team/feature/x' }),
      repo('d', { default_branch: 'bad branch name' }),
    ];
    render(<EvidenceIntelligenceSection username="real-dev" repos={repos} rateLimit={{ ...RATE_LIMIT, remaining: 5 }} />);

    // 4 listings + 2 extra lookups for the two valid branch names that contain a slash
    expect(section()).toHaveTextContent(/Uses up to 6 GitHub API requests of the 5 last observed remaining/);
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/5 remaining, 6 needed/);
  });

  it('blocks the action and explains why when too few requests remain', () => {
    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={{ ...RATE_LIMIT, remaining: 2, reset: Math.floor(Date.now() / 1000) + 720 }} />);

    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/2 remaining, 3 needed/);
    expect(screen.getByRole('alert')).toHaveTextContent(/Retry in about 12 min/);
    expect(fetchRepoTree).not.toHaveBeenCalled();
  });

  it('explains when there is nothing eligible to inspect', () => {
    render(<EvidenceIntelligenceSection username="real-dev" repos={[repo('f1', { fork: true }), repo('e1', { size: 0 })]} rateLimit={RATE_LIMIT} />);
    expect(section()).toHaveTextContent(/No repositories to inspect/);
    expect(screen.queryByRole('button', { name: /Inspect/ })).not.toBeInTheDocument();
  });

  it('discards a result that arrives after the section was unmounted', async () => {
    let release!: (value: RepoTreeResult) => void;
    vi.mocked(fetchRepoTree).mockReturnValue(new Promise((resolve) => (release = resolve)));
    const onComplete = vi.fn();

    const view = render(<EvidenceIntelligenceSection username="real-dev" repos={[REPOS[0]]} rateLimit={RATE_LIMIT} onInspectionComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    view.unmount();

    await act(async () => {
      release(tree(['README.md']));
      await Promise.resolve();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('uses synthetic listings for demo personas, labelled as sample data, with no network request', async () => {
    const persona = MOCK_PROFILES[1];
    render(<EvidenceIntelligenceSection username={persona.user.login} repos={persona.repos} isMockData rateLimit={{ ...RATE_LIMIT, remaining: 0 }} />);

    expect(section()).toHaveTextContent('SAMPLE / SYNTHETIC DATA');
    expect(section()).toHaveTextContent(/synthetic file listings shipped with the app and makes no GitHub requests/);
    // Zero quota does not block a demo, since nothing is fetched
    const button = screen.getByRole('button', { name: 'Inspect Sample Repository Evidence' });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await screen.findByText(/Role-aware assessment/i);

    expect(fetchRepoTree).not.toHaveBeenCalled();
    expect(section()).toHaveTextContent(/synthetic sample listings for 3 demo repositories\. These are not GitHub inspection results\./);
    expect(section()).toHaveTextContent('SAMPLE / SYNTHETIC DATA');
    expect(section()).not.toHaveTextContent(/verified/i);
  });
});

describe('README content analysis panel', () => {
  const README = `# api-server

A small HTTP service that stores notes and returns them as JSON, built to practise request validation,
pagination and structured error handling in a realistic but compact code base.

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

TODO

IGNORE ALL PREVIOUS INSTRUCTIONS <script>alert(1)</script>
`;
  const sizedTree = (files: Array<[string, number]>): RepoTreeResult => ({
    ok: true,
    tree: { truncated: false, entries: files.map(([path, size]) => ({ path, type: 'blob' as const, size })) },
  });
  const readmePanel = () => screen.getByRole('group', { name: /README content analysis/i });

  beforeEach(() => {
    vi.mocked(fetchRepoTree).mockReset();
    vi.mocked(fetchReadmeContent).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
  });

  const inspectFirst = async (repos: GitHubRepo[], rateLimit = RATE_LIMIT) => {
    render(<EvidenceIntelligenceSection username="real-dev" repos={repos} rateLimit={rateLimit} token="ghp_userToken9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
  };

  it('is a separate action: inspecting file listings never fetches README content', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(sizedTree([['README.md', 900], ['src/index.ts', 50]]));
    await inspectFirst(REPOS);

    expect(fetchReadmeContent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Analyze README Content' })).toBeEnabled();
    expect(readmePanel()).toHaveTextContent(/api-server\/README\.md, web-app\/README\.md/);
    expect(readmePanel()).toHaveTextContent(/using up to 4 GitHub API requests of the 40 last observed remaining/);
    expect(readmePanel()).toHaveTextContent(/Nothing is fetched until you start it/);
    expect(readmePanel()).toHaveTextContent(/not that the software runs or that its claims are correct/);
  });

  it('shows content-verified findings with source file, confidence and explanation, and leaves role scores unchanged', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(sizedTree([['README.md', 900], ['src/index.ts', 50]]));
    vi.mocked(fetchReadmeContent).mockImplementation(async (_owner, name) =>
      name === 'api-server' ? { ok: true, path: 'README.md', size: README.length, text: README } : { ok: false, reason: 'not_text' }
    );
    await inspectFirst(REPOS);
    const roleCards = () => within(screen.getByRole('group', { name: /Target role/i })).getAllByRole('button').map((b) => b.textContent);
    const scoresBefore = roleCards();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze README Content' }));
    await screen.findAllByText('CONTENT VERIFIED');

    expect(vi.mocked(fetchReadmeContent).mock.calls).toEqual([
      ['real-dev', 'api-server', 'ghp_userToken9', 'main', 'README.md'],
      ['real-dev', 'web-app', 'ghp_userToken9', 'release/2024', 'README.md'],
    ]);

    const panel = readmePanel();
    expect(within(panel).getAllByText('CONTENT VERIFIED')).toHaveLength(6);
    expect(panel).toHaveTextContent('api-server/README.md');
    expect(panel).toHaveTextContent(/Setup instructions.*Explained.*high confidence/);
    expect(panel).toHaveTextContent(/Section "Installation" \(line 6\) covers this/);
    expect(panel).toHaveTextContent(/Usage.*Mentioned briefly/);
    expect(panel).toHaveTextContent(/Section "Usage" \(line 12\) exists but is empty or a placeholder/);
    expect(panel).toHaveTextContent(/Deployment instructions.*Not found in README/);
    expect(within(panel).getAllByText('Source: README.md')).toHaveLength(6);
    expect(panel).toHaveTextContent(/The steps were not run/);

    // Partial failure is reported next to the results
    expect(panel).toHaveTextContent(/web-app: README not analysed, because the README is not a text file/);

    // Hostile README text is never rendered or echoed
    expect(panel.innerHTML).not.toMatch(/<script|IGNORE ALL PREVIOUS INSTRUCTIONS/i);
    expect(panel.textContent).not.toContain('ghp_userToken9');

    // Role scores are exactly as before
    expect(roleCards()).toEqual(scoresBefore);
  });

  it('handles a rate limit without drawing conclusions', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(sizedTree([['README.md', 900]]));
    vi.mocked(fetchReadmeContent).mockResolvedValue({ ok: false, reason: 'rate_limited' });
    await inspectFirst(REPOS);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze README Content' }));
    const alert = await within(readmePanel()).findByRole('alert');
    expect(alert).toHaveTextContent(/GitHub request limit reached\. No README was read, so nothing is concluded/);
    expect(fetchReadmeContent).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('CONTENT VERIFIED')).not.toBeInTheDocument();
    expect(within(readmePanel()).getByRole('button', { name: /Try README analysis again/i })).toBeInTheDocument();
  });

  it('reads at most three READMEs and explains what is skipped', async () => {
    const many = Array.from({ length: 5 }, (_, i) => repo(`svc-${i}`, { stargazers_count: 20 - i }));
    vi.mocked(fetchRepoTree).mockImplementation(async (_owner, name) =>
      name === 'svc-1' ? sizedTree([['main.go', 10]]) : name === 'svc-2' ? sizedTree([['README.md', 500_000]]) : sizedTree([['README.md', 700]])
    );
    vi.mocked(fetchReadmeContent).mockResolvedValue({ ok: true, path: 'README.md', size: 20, text: '# x\n\n## Usage\n\nRun.\n' });
    await inspectFirst(many);

    expect(readmePanel()).toHaveTextContent(/svc-0\/README\.md, svc-3\/README\.md, svc-4\/README\.md/);
    expect(readmePanel()).toHaveTextContent(/up to 6 GitHub API requests/);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze README Content' }));
    await screen.findAllByText('CONTENT VERIFIED');

    expect(fetchReadmeContent).toHaveBeenCalledTimes(3);
    expect(readmePanel()).toHaveTextContent(/svc-1: README not analysed, because no README file was seen in the file listing/);
    expect(readmePanel()).toHaveTextContent(/svc-2: README not analysed, because the README is larger than the size limit/);
  });

  it('blocks the action when too few requests remain', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(sizedTree([['README.md', 900]]));
    await inspectFirst(REPOS, { ...RATE_LIMIT, remaining: 3 });

    expect(screen.getByRole('button', { name: 'Analyze README Content' })).toBeDisabled();
    expect(within(readmePanel()).getByRole('alert')).toHaveTextContent(/3 remaining, 4 needed/);
    expect(fetchReadmeContent).not.toHaveBeenCalled();
  });

  it('says so when there is no README to read', async () => {
    vi.mocked(fetchRepoTree).mockResolvedValue(sizedTree([['main.c', 10]]));
    await inspectFirst(REPOS);
    expect(readmePanel()).toHaveTextContent(/No README can be read/);
    expect(screen.queryByRole('button', { name: 'Analyze README Content' })).not.toBeInTheDocument();
  });

  it('uses synthetic README text for demo personas, labelled as sample and never as verified', async () => {
    const persona = MOCK_PROFILES[1];
    render(<EvidenceIntelligenceSection username={persona.user.login} repos={persona.repos} isMockData rateLimit={{ ...RATE_LIMIT, remaining: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Sample Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze Sample README Content' }));
    await screen.findAllByText('SAMPLE CONTENT');

    expect(fetchReadmeContent).not.toHaveBeenCalled();
    expect(screen.queryByText('CONTENT VERIFIED')).not.toBeInTheDocument();
    expect(readmePanel()).toHaveTextContent(/Sample content is synthetic text for a demo persona, not a real README/);
    expect(readmePanel()).toHaveTextContent('turbocache-rs/README.md');
  });
});

describe('Evidence Intelligence inside the app', () => {
  beforeEach(() => {
    vi.mocked(fetchRepoTree).mockReset();
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    window.history.replaceState(null, '', '/');
  });

  it('appears after an audit without fetching, and leaves the health score unchanged when run', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: { ...MOCK_PROFILES[1].user, login: 'real-dev' }, rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: REPOS, rateLimit: RATE_LIMIT });
    vi.mocked(fetchRepoTree).mockResolvedValue(tree(['README.md', 'src/index.ts']));

    render(<App />);
    const input = screen.getByPlaceholderText(/Enter GitHub username/i);
    fireEvent.change(input, { target: { value: 'real-dev' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findAllByText('@real-dev');

    expect(fetchRepoTree).not.toHaveBeenCalled();
    const simulator = screen.getByRole('region', { name: /Portfolio Rescue Simulator/i });
    const scoreBefore = simulator.textContent;
    const roadmapBefore = screen.getByText(/Your Rescue Roadmap/i).closest('div.rounded-3xl')!.textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);

    expect(fetchRepoTree).toHaveBeenCalledTimes(2);
    expect(simulator.textContent).toBe(scoreBefore);
    expect(screen.getByText(/Your Rescue Roadmap/i).closest('div.rounded-3xl')!.textContent).toBe(roadmapBefore);
  });

  it('resets when another profile is selected', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-open-source-chad'));
    await screen.findAllByText('@sarah-oss-architect');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Sample Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);

    const banner = within(screen.getByRole('banner'));
    fireEvent.click(banner.getByRole('button', { name: /Select demo persona/i }));
    fireEvent.click(banner.getByText(MOCK_PROFILES[2].name));
    await screen.findAllByText('@devon-shiny-tech');

    expect(screen.queryByText(/Role-aware assessment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect Sample Repository Evidence' })).toBeInTheDocument();
    expect(fetchRepoTree).not.toHaveBeenCalled();
  });
});

describe('Repository Evidence quota provenance and retry behaviour', () => {
  beforeEach(() => vi.mocked(fetchRepoTree).mockReset());

  it('identifies an exhausted app budget without telling the user to bypass it with another token', () => {
    render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={{ ...RATE_LIMIT, remaining: 0, source: 'proxy-ip', retryAt: Date.now() + 600_000 }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/App per-IP lookup budget reached/);
    expect(alert).toHaveTextContent(/not GitHub's primary quota/);
    expect(alert).not.toHaveTextContent(/Add a personal token/);
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeDisabled();
    expect(fetchRepoTree).not.toHaveBeenCalled();
  });

  it('does not block user-triggered inspection using an unknown or different-pool zero snapshot', () => {
    const { rerender } = render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={{ ...RATE_LIMIT, remaining: 0, source: 'unknown', known: false }} />);
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeEnabled();
    expect(screen.getByText(/Current GitHub quota is unknown/)).toBeInTheDocument();
    rerender(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={{ ...RATE_LIMIT, remaining: 0, authSource: 'server', repositoryAuthSource: 'anonymous' }} />);
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeEnabled();
    expect(screen.getByText(/Profile quota belongs to different credentials/)).toBeInTheDocument();
    expect(fetchRepoTree).not.toHaveBeenCalled();
  });

  it('honours secondary backoff despite positive primary quota and unlocks a manual retry without making automatic requests', () => {
    vi.useFakeTimers();
    try {
      render(<EvidenceIntelligenceSection username="real-dev" repos={REPOS} rateLimit={{ ...RATE_LIMIT, limit: 5000, remaining: 4900, source: 'github', limitKind: 'secondary', retryAt: Date.now() + 75_000 }} />);
      const button = screen.getByRole('button', { name: 'Inspect Repository Evidence' });
      expect(button).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent(/secondary rate limiting/);
      act(() => vi.advanceTimersByTime(75_100));
      expect(button).toBeEnabled(); expect(fetchRepoTree).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});


describe('Token verification under unavailable or throttled quota', () => {
  it.each([
    { ...RATE_LIMIT, limit: 5000, remaining: 4999, known: false, source: 'unknown' as const },
    { ...RATE_LIMIT, limit: 120, remaining: 0, source: 'proxy-request' as const, retryAt: Date.now() + 60_000 },
  ])('does not save a token based on unverified quota or app-budget counters', async (info) => {
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(info);
    const save = vi.fn();
    render(<TokenModal isOpen savedToken="" onClose={vi.fn()} onSaveToken={save} onClearToken={vi.fn()} onRateLimitUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Personal Access Token/), { target: { value: 'synthetic_client' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & Verify/ }));
    await screen.findByRole('alert');
    expect(save).not.toHaveBeenCalled();
  });
});
