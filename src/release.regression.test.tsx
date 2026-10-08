import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { GitHubRepo, GitHubUser } from './types/github';
import type { RepoTreeResult } from './types/evidence';
import { MOCK_PROFILES } from './data/mockProfiles';
import { analyzePortfolio } from './services/analyzer';
import { formatReportToMarkdown } from './utils/markdownReport';
import { generateProfileReadme } from './utils/profileMakeover';

vi.mock('./services/github', async (importActual) => {
  const actual = await importActual<typeof import('./services/github')>();
  return { ...actual, fetchGitHubUser: vi.fn(), fetchGitHubRepos: vi.fn(), fetchRepoTree: vi.fn(), fetchReadmeContent: vi.fn(), checkRateLimit: vi.fn() };
});

import { App } from './App';
import { TokenModal } from './components/TokenModal';
import { checkRateLimit, fetchGitHubRepos, fetchGitHubUser, fetchRepoTree, getGitHubAuthEpoch } from './services/github';

// Release-blocker regressions: token changes in the UI, disclosure of sampling, wording that
// metadata cannot support, dialog focus stability, announcements and keyboard navigation.

const ANON = { limit: 60, remaining: 42, reset: 0, used: 18, resetMinutes: 30, resetTimeFormatted: '' };
const AUTHED = { limit: 5000, remaining: 4990, reset: 0, used: 10, resetMinutes: 30, resetTimeFormatted: '' };
const TOKEN_A = 'ghp_syntheticTokenAAAA';
const TOKEN_B = 'ghp_syntheticTokenBBBB';

const liveUser = (login: string, overrides: Partial<GitHubUser> = {}): GitHubUser => ({ ...MOCK_PROFILES[1].user, login, ...overrides });
const tree = (paths: string[]): RepoTreeResult => ({ ok: true, tree: { truncated: false, entries: paths.map((path) => ({ path, type: 'blob' as const, size: 900 })) } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

async function saveToken(token: string) {
  fireEvent.click(screen.getByRole('button', { name: /Open GitHub personal access token settings/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/Personal Access Token/i), { target: { value: token } });
  fireEvent.click(within(dialog).getByRole('button', { name: /Save & Verify/i }));
  await within(dialog).findByText(/Token verified/i);
  fireEvent.click(within(dialog).getByRole('button', { name: /^Close$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

function submitLanding(username: string) {
  const input = screen.getByLabelText('GitHub username');
  fireEvent.change(input, { target: { value: username } });
  fireEvent.submit(input.closest('form')!);
}

describe('token changes in the application', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(fetchRepoTree).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockImplementation(async (token?: string) => (token ? AUTHED : ANON));
  });

  it('ignores an audit that was started with the previous credentials', async () => {
    const slow = deferred<{ data: GitHubUser; rateLimit: typeof ANON }>();
    vi.mocked(fetchGitHubUser).mockReturnValue(slow.promise);
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: MOCK_PROFILES[1].repos, rateLimit: ANON });

    render(<App />);
    submitLanding('started-anonymous');
    expect(fetchGitHubUser).toHaveBeenCalledWith('started-anonymous', '');

    const epochBefore = getGitHubAuthEpoch();
    await saveToken(TOKEN_A);
    expect(getGitHubAuthEpoch()).toBe(epochBefore + 1);

    // The old request now answers. It must not produce a report, an error, or a stuck spinner.
    await act(async () => {
      slow.resolve({ data: liveUser('started-anonymous'), rateLimit: ANON });
      await Promise.resolve();
    });
    expect(screen.queryByText('@started-anonymous')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchGitHubRepos).not.toHaveBeenCalled();
    expect(screen.getByLabelText('GitHub username')).not.toBeDisabled();
    expect(screen.getByText(/Audit Your Portfolio/i)).toBeInTheDocument();
  });

  it('uses the new token for the next audit and resets credential-dependent evidence', async () => {
    const repos: GitHubRepo[] = [{ ...MOCK_PROFILES[1].repos[0], name: 'api', full_name: 'dev/api', default_branch: 'main' }];
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: liveUser('dev'), rateLimit: AUTHED });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: repos, rateLimit: AUTHED });
    vi.mocked(fetchRepoTree).mockResolvedValue(tree(['README.md', 'docs/private-plans-q3.md']));

    render(<App />);
    await saveToken(TOKEN_A);
    submitLanding('dev');
    await screen.findAllByText('@dev');
    expect(vi.mocked(fetchGitHubUser).mock.calls.at(-1)).toEqual(['dev', TOKEN_A]);

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    expect(vi.mocked(fetchRepoTree).mock.calls.at(-1)).toEqual(['dev', 'api', TOKEN_A, 'main']);
    expect(screen.getByRole('main').textContent).toContain('docs/private-plans-q3.md');

    // Switching to another token: what was read with token A is no longer on screen
    await saveToken(TOKEN_B);
    expect(screen.queryByText(/Role-aware assessment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toContain('docs/private-plans-q3.md');
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    expect(vi.mocked(fetchRepoTree).mock.calls.at(-1)).toEqual(['dev', 'api', TOKEN_B, 'main']);

    // The token is never written anywhere but its own session entry, and never rendered
    expect(sessionStorage.getItem('repozyn_token')).toBe(TOKEN_B);
    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(document.body.textContent).not.toContain(TOKEN_B);
  });

  it('does not show a quota answer that belongs to credentials no longer in force', async () => {
    const lateAnonymous = deferred<typeof ANON>();
    vi.mocked(checkRateLimit).mockImplementation((token?: string) => (token ? Promise.resolve(AUTHED) : lateAnonymous.promise));

    render(<App />);
    await saveToken(TOKEN_A);
    await act(async () => {
      lateAnonymous.resolve({ ...ANON, remaining: 7 });
      await Promise.resolve();
    });

    const badge = within(screen.getByRole('banner')).getByRole('status');
    expect(badge).toHaveTextContent(/4990\s*\/\s*5000/);
    expect(badge).not.toHaveTextContent(/7\s*\/\s*60/);
  });
});

describe('token dialog: announcements and stable focus', () => {
  const baseProps = { isOpen: true, savedToken: '', onSaveToken: vi.fn(), onClearToken: vi.fn(), onRateLimitUpdate: vi.fn() };

  beforeEach(() => {
    vi.mocked(checkRateLimit).mockReset();
  });

  it('announces verification progress, success and failure', async () => {
    const pending = deferred<typeof AUTHED>();
    vi.mocked(checkRateLimit).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ANON);

    render(<TokenModal {...baseProps} onClose={() => {}} />);
    const status = screen.getByTestId('token-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('');

    const input = screen.getByLabelText(/Personal Access Token/i);
    fireEvent.change(input, { target: { value: TOKEN_A } });
    const save = screen.getByRole('button', { name: /Save & Verify|Verifying/i });
    fireEvent.click(save);
    expect(status).toHaveTextContent('Verifying token with GitHub');
    expect(save).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      pending.resolve(AUTHED);
      await Promise.resolve();
    });
    expect(status).toHaveTextContent(/Token verified with 4990\/5000 requests available/);
    expect(within(status).queryByRole('alert')).not.toBeInTheDocument();

    // A token that does not raise the limit is announced assertively
    fireEvent.click(screen.getByRole('button', { name: /Save & Verify/i }));
    expect(await within(status).findByRole('alert')).toHaveTextContent(/did not increase rate limit/i);
    // Neither message echoes the token
    expect(status.textContent).not.toContain(TOKEN_A);
  });

  it('keeps focus where the user is typing when the page re-renders in the background', async () => {
    const view = render(<TokenModal {...baseProps} onClose={() => {}} />);
    const input = screen.getByLabelText(/Personal Access Token/i);
    await waitFor(() => expect(input).toHaveFocus());

    const close = screen.getByRole('button', { name: /^Close$/ });
    close.focus();
    expect(close).toHaveFocus();

    // The parent re-renders (new callback identities, new quota numbers) while the dialog is open
    for (let i = 0; i < 3; i++) {
      view.rerender(<TokenModal {...baseProps} onClose={() => {}} onRateLimitUpdate={vi.fn()} />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(close).toHaveFocus();
    }

    // Escape still closes, using the latest callback
    const latestClose = vi.fn();
    view.rerender(<TokenModal {...baseProps} onClose={latestClose} />);
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(latestClose).toHaveBeenCalledTimes(1);
  });
});

describe('sampling disclosure', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(ANON);
  });

  const hundredRepos = Array.from({ length: 100 }, (_, i) => ({ ...MOCK_PROFILES[1].repos[0], id: i + 1, name: `repo-${i}`, full_name: `prolific/repo-${i}` }));

  it('says when only the 100 most recently updated repositories were analysed', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: liveUser('prolific', { public_repos: 1234 }), rateLimit: ANON });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: hundredRepos, rateLimit: ANON });

    render(<App />);
    submitLanding('prolific');
    await screen.findAllByText('@prolific');

    const note = screen.getByText(/Sample: the 100 most recently updated of 1234 public repositories/);
    expect(note).toHaveAttribute('role', 'note');
    expect(note).toHaveTextContent(/Scores and findings describe this sample only/);

    const report = analyzePortfolio(liveUser('prolific', { public_repos: 1234 }), hundredRepos, [], false);
    expect(formatReportToMarkdown(report)).toMatch(/covers the 100 most recently updated of 1234 public repositories/);
  });

  it('stays silent when every public repository was analysed', async () => {
    const repos = hundredRepos.slice(0, 3);
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: liveUser('tidy', { public_repos: 3 }), rateLimit: ANON });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: repos, rateLimit: ANON });

    render(<App />);
    submitLanding('tidy');
    await screen.findAllByText('@tidy');
    expect(screen.queryByText(/Sample: the/)).not.toBeInTheDocument();
    expect(formatReportToMarkdown(analyzePortfolio(liveUser('tidy', { public_repos: 3 }), repos, [], false))).not.toMatch(/Sample:/);
  });
});

describe('wording stays within what repository metadata can show', () => {
  const UNSUPPORTED = /clean code|code cleanliness|production[- ](ready|credibility|grade)|engineering rigor|well-documented codebases|verifiable (results|original)|original (code|creations|creative|creation)|tutorial clones?|cloned tutorials|genuine community|high credibility|top-tier/i;

  const strongRepos: GitHubRepo[] = Array.from({ length: 4 }, (_, i) => ({
    ...MOCK_PROFILES[1].repos[0],
    id: i + 1,
    name: `lib-${i}`,
    full_name: `strong/lib-${i}`,
    stargazers_count: 500,
    homepage: 'https://example.org',
    pushed_at: new Date().toISOString(),
  }));

  it.each([
    ['strong profile', liveUser('strong'), strongRepos],
    ['fork-heavy profile', MOCK_PROFILES[0].user, MOCK_PROFILES[0].repos],
    ['dormant profile', MOCK_PROFILES[2].user, MOCK_PROFILES[2].repos],
    ['empty profile', liveUser('empty', { public_repos: 0, bio: null }), [] as GitHubRepo[]],
  ])('%s: no claims about originality, code cleanliness or production readiness', (_name, user, repos) => {
    const report = analyzePortfolio(user as GitHubUser, repos as GitHubRepo[], [], false);
    const copy = JSON.stringify({ scoring: report.scoring, recruiter: report.recruiter, roasts: report.roasts, roadmap: report.roadmap }) + formatReportToMarkdown(report) + generateProfileReadme(report.facts).markdown;
    expect(copy).not.toMatch(UNSUPPORTED);
  });

  it('describes the second pillar as fork share and stars, and says what it does not judge', () => {
    const { scoring, recruiter } = analyzePortfolio(liveUser('strong'), strongRepos, [], false);
    expect(scoring.originality.label).toBe('Own Work & Traction');
    expect(scoring.originality.explanation).toMatch(/Does not judge whether code is original/);
    expect(scoring.originality.details[0].name).toBe('Non-Fork Repositories Ratio');
    expect(recruiter.hireabilitySignal).toBe('Strong');
    expect(recruiter.tenSecondVerdict).toMatch(/Code quality itself is not assessed here/);
  });
});

describe('keyboard path through recruiter impression, roast and rescue', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(ANON);
  });

  it('offers in-page links to each core section, in order, with focusable targets', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');

    const nav = screen.getByRole('navigation', { name: 'Audit sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Recruiter impression', 'Roast', 'Rescue plan', 'Repository evidence', 'Improvement simulator']);

    const positions: number[] = [];
    const all = [...document.querySelectorAll('main *')];
    for (const link of links) {
      const target = document.querySelector<HTMLElement>(link.getAttribute('href')!);
      expect(target, link.getAttribute('href')!).not.toBeNull();
      // Programmatically focusable, so following the link moves keyboard focus into the section
      expect(target!.getAttribute('tabindex')).toBe('-1');
      target!.focus();
      expect(document.activeElement).toBe(target);
      positions.push(all.indexOf(target!));
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // The roast hands over to the rescue plan with a real link, not an instruction to scroll
    const handover = within(document.getElementById('roast')!).getByRole('link', { name: /Go to your rescue plan/i });
    expect(handover).toHaveAttribute('href', '#rescue');
  });

  it('builds the roast and rescue sections from native, operable controls only', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');

    for (const id of ['recruiter-impression', 'roast', 'rescue']) {
      const section = document.getElementById(id)!;
      // Nothing clickable that a keyboard cannot reach
      expect(section.querySelectorAll('div[onclick], span[onclick]').length).toBe(0);
      for (const control of section.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')) {
        expect(control.tabIndex, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(0);
        expect(control).toHaveAccessibleName();
      }
    }

    // Tone, copy, checklist and template controls all respond to activation
    const roast = within(document.getElementById('roast')!);
    const savage = roast.getByRole('button', { name: /Savage/ });
    savage.focus();
    expect(savage).toHaveFocus();
    fireEvent.click(savage);
    expect(savage).toHaveAttribute('aria-pressed', 'true');

    const rescue = within(document.getElementById('rescue')!);
    const firstTask = rescue.getAllByRole('checkbox')[0];
    firstTask.focus();
    expect(firstTask).toHaveFocus();
    fireEvent.click(firstTask);
    expect(firstTask).toHaveAttribute('aria-checked', 'true');

    const template = rescue.getAllByRole('button', { name: /Template/i })[0];
    expect(template).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(template);
    expect(rescue.getAllByRole('button', { name: /Template/i })[0]).toHaveAttribute('aria-expanded', 'true');
  });
});
