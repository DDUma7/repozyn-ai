import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { GitHubUser, GitHubRepo } from './types/github';
import { MOCK_PROFILES } from './data/mockProfiles';

vi.mock('./services/github', async (importActual) => {
  const actual = await importActual<typeof import('./services/github')>();
  return {
    ...actual,
    fetchGitHubUser: vi.fn(),
    fetchGitHubRepos: vi.fn(),
    checkRateLimit: vi.fn(),
  };
});

import { App } from './App';
import { fetchGitHubUser, fetchGitHubRepos, checkRateLimit, GitHubApiError } from './services/github';

const RATE_LIMIT = { limit: 60, remaining: 42, reset: 0, used: 18, resetMinutes: 30, resetTimeFormatted: '' };

const liveUser = (login: string): GitHubUser => ({ ...MOCK_PROFILES[1].user, login, name: `Live ${login}` });
const liveRepos = (login: string): GitHubRepo[] =>
  MOCK_PROFILES[1].repos.map((r) => ({ ...r, full_name: `${login}/${r.name}` }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function submitLandingSearch(username: string) {
  const input = screen.getByPlaceholderText(/Enter GitHub username/i);
  fireEvent.change(input, { target: { value: username } });
  fireEvent.submit(input.closest('form')!);
}

function submitDashboardSearch(username: string) {
  const input = screen.getByPlaceholderText(/Audit another username/i);
  fireEvent.change(input, { target: { value: username } });
  fireEvent.submit(input.closest('form')!);
}

function selectPersonaFromNavbar(name: string) {
  const banner = within(screen.getByRole('banner'));
  fireEvent.click(banner.getByRole('button', { name: /Select demo persona/i }));
  fireEvent.click(banner.getByText(name));
}

describe('App profile switching, search errors and data labelling', () => {
  beforeEach(() => {
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    // Each test starts from the landing page, not a previously shared audit link
    window.history.replaceState(null, '', '/');
  });

  it('ignores a slow search response that arrives after a different profile was selected', async () => {
    const pendingUser = deferred<{ data: GitHubUser; rateLimit: typeof RATE_LIMIT }>();
    vi.mocked(fetchGitHubUser).mockReturnValue(pendingUser.promise);
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: liveRepos('slow-user'), rateLimit: RATE_LIMIT });

    render(<App />);
    submitLandingSearch('slow-user');
    expect(fetchGitHubUser).toHaveBeenCalledTimes(1);

    selectPersonaFromNavbar(MOCK_PROFILES[1].name);
    expect((await screen.findAllByText('@sarah-oss-architect')).length).toBeGreaterThan(0);

    await act(async () => {
      pendingUser.resolve({ data: liveUser('slow-user'), rateLimit: RATE_LIMIT });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getAllByText('@sarah-oss-architect').length).toBeGreaterThan(0));

    expect(screen.queryByText('@slow-user')).not.toBeInTheDocument();
    expect(fetchGitHubRepos).not.toHaveBeenCalled();
    // The newer selection also owns the loading state
    expect(screen.getByPlaceholderText(/Audit another username/i)).not.toBeDisabled();
  });

  it('ignores a slow search failure that arrives after a different profile was selected', async () => {
    const pendingUser = deferred<never>();
    vi.mocked(fetchGitHubUser).mockReturnValue(pendingUser.promise);

    render(<App />);
    submitLandingSearch('slow-user');
    selectPersonaFromNavbar(MOCK_PROFILES[0].name);
    await screen.findAllByText('@alex-tutorial-hoarder');

    await act(async () => {
      pendingUser.reject(new GitHubApiError('GitHub user was not found. Please verify the username.', 404));
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('@alex-tutorial-hoarder').length).toBeGreaterThan(0);
  });

  it('shows search errors on the dashboard and keeps the current report', async () => {
    vi.mocked(fetchGitHubUser).mockRejectedValue(
      new GitHubApiError('GitHub user was not found. Please verify the username.', 404)
    );

    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    submitDashboardSearch('no-such-user');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/GitHub user was not found/i);
    expect(alert).toHaveTextContent(/previous audit for @alex-tutorial-hoarder/i);
    expect(screen.getAllByText('@alex-tutorial-hoarder').length).toBeGreaterThan(0);

    // Typing a new username or dismissing clears the message
    fireEvent.click(screen.getByLabelText(/Dismiss error/i));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not carry simulator, roadmap or README state from one profile to the next', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');

    fireEvent.click(screen.getByRole('button', { name: /Simulate All Fixes/i }));
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Profile Makeover/i }));
    const alexDraft = screen.getByLabelText(/Editable GitHub Profile README Markdown/i) as HTMLTextAreaElement;
    expect(alexDraft.value).toContain("I'm Alex Morgan");
    fireEvent.change(alexDraft, { target: { value: '# Alex private draft' } });
    fireEvent.click(screen.getByLabelText(/Close Profile Makeover dialog/i));

    selectPersonaFromNavbar(MOCK_PROFILES[2].name);
    await screen.findAllByText('@devon-shiny-tech');

    expect(screen.getByText('+0')).toBeInTheDocument();
    expect(screen.getByText(/0 improvements toggled/i)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }

    fireEvent.click(screen.getByRole('button', { name: /Profile Makeover/i }));
    const devonDraft = screen.getByLabelText(/Editable GitHub Profile README Markdown/i) as HTMLTextAreaElement;
    expect(devonDraft.value).toContain("I'm Devon Vance");
    expect(devonDraft.value).not.toContain('Alex');
  });

  it('labels demo personas as sample data and never as verified', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');
    fireEvent.click(screen.getByRole('button', { name: /Savage/i }));

    expect(screen.getByText(/SAMPLE DATA, NOT A REAL GITHUB PROFILE/i)).toBeInTheDocument();
    expect(screen.getByText(/Sample Baseline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sample Evidence:/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Profile Makeover/i }));
    expect(screen.getByText('SAMPLE DEMO DATA')).toBeInTheDocument();
    const draft = screen.getByLabelText(/Editable GitHub Profile README Markdown/i) as HTMLTextAreaElement;
    expect(draft.value).toMatch(/not real GitHub data/i);
    expect(draft.value).not.toMatch(/verified/i);
    fireEvent.click(screen.getByLabelText(/Close Profile Makeover dialog/i));

    expect(document.body.textContent).not.toMatch(/verified (github|baseline|evidence|data only|repository facts)/i);
  });

  it('keeps the verified labels for real GitHub profiles', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: liveUser('real-dev'), rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: liveRepos('real-dev'), rateLimit: RATE_LIMIT });

    render(<App />);
    submitLandingSearch('real-dev');
    await screen.findAllByText('@real-dev');

    expect(screen.getByText('VERIFIED GITHUB FACTS')).toBeInTheDocument();
    expect(screen.getByText(/Verified Baseline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Verified Evidence:/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SAMPLE DATA/i)).not.toBeInTheDocument();
  });

  it('describes the token proxy and never claims client-side-only processing', () => {
    render(<App />);
    expect(document.body.textContent).not.toMatch(/client-side/i);
    expect(screen.getByText(/lightweight server proxy/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Open GitHub personal access token settings/i));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/sent with each lookup to the Repozyn server proxy/i);
    expect(dialog.textContent).not.toMatch(/no backend|only sent directly|privacy guarantee/i);
  });
});
