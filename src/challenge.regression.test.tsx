import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { GitHubRepo, GitHubUser } from './types/github';
import { MOCK_PROFILES } from './data/mockProfiles';
import { analyzePortfolio, selectTopRescuePriorities } from './services/analyzer';
import { simulatePortfolioImprovements, getAvailableSimulatorActions } from './services/simulator';
import { formatReportToMarkdown } from './utils/markdownReport';

vi.mock('./services/github', async (importActual) => {
  const actual = await importActual<typeof import('./services/github')>();
  return { ...actual, fetchGitHubUser: vi.fn(), fetchGitHubRepos: vi.fn(), fetchRepoTree: vi.fn(), fetchReadmeContent: vi.fn(), checkRateLimit: vi.fn() };
});

import { App } from './App';
import { checkRateLimit, fetchGitHubRepos, fetchGitHubUser, fetchRepoTree } from './services/github';

// Alignment with the challenge "GitHub Roast and Rescue": a username in, the truth out, in a form
// the owner will listen to. These tests pin the core experience, including for an empty profile.

const RATE_LIMIT = { limit: 60, remaining: 42, reset: 0, used: 18, resetMinutes: 30, resetTimeFormatted: '' };
const emptyUser = (overrides: Partial<GitHubUser> = {}): GitHubUser => ({
  ...MOCK_PROFILES[0].user,
  login: 'new-student',
  name: null,
  bio: null,
  blog: '',
  location: null,
  public_repos: 0,
  followers: 0,
  following: 0,
  ...overrides,
});
const UNSUPPORTED = /999|0 out of 0|0 of 0|NaN|undefined|Infinity/;

describe('empty profile: honest feedback instead of invented findings', () => {
  const report = analyzePortfolio(emptyUser(), [], [], false);
  const everything = JSON.stringify({ ...report, facts: undefined }) + formatReportToMarkdown(report);

  it('says nothing that the data does not support', () => {
    expect(everything).not.toMatch(UNSUPPORTED);
    expect(everything).not.toMatch(/days ago|Dormant|Mystery Box|Carbon-Dating|Established profile/);
  });

  it('gives no credit for ratios that have nothing to measure', () => {
    const originality = report.scoring.originality.details.find((d) => d.name === 'Non-Fork Repositories Ratio')!;
    const stale = report.scoring.maintenance.details.find((d) => d.name === 'Active vs Stale Ratio')!;
    expect(originality).toMatchObject({ earned: 0, reason: 'No public repositories yet, so there is nothing to assess' });
    expect(stale).toMatchObject({ earned: 0, reason: 'No public repositories yet, so there is nothing to assess' });
    expect(report.scoring.totalScore).toBeLessThan(10);
    expect(report.scoring.grade).toBe('F');
  });

  it('describes what a recruiter would actually see', () => {
    expect(report.recruiter.archetype).toBe('The Blank Slate');
    expect(report.recruiter.tenSecondVerdict).toMatch(/nothing to look at yet/);
    expect(report.recruiter.redFlags.map((f) => f.title)).toEqual(['Missing Bio / Target Role', 'No Public Repositories']);
    expect(report.recruiter.greenFlags).toEqual([]);
  });

  it('roasts gently, with evidence, and never cruelly', () => {
    expect(report.roasts.map((r) => r.id)).toEqual(['roast-empty', 'roast-bio']);
    expect(report.roasts[0]).toMatchObject({ title: 'The Blank Canvas', severity: 'mild', evidence: '0 public repositories on the profile' });
    expect(report.roasts[0].roast).toMatch(/your first project is automatically your best one/);
    expect(report.roasts.every((r) => r.severity !== 'spicy')).toBe(true);
    expect(JSON.stringify(report.roasts)).not.toMatch(/\b(stupid|lazy|worthless|pathetic|useless|idiot|loser|failure|hopeless|embarrassing)\b/i);
  });

  it('starts the rescue with a first project a student can realistically finish', () => {
    const top = selectTopRescuePriorities(report.roadmap, 3);
    expect(top[0]).toMatchObject({ id: 'action-first-project', priority: 'critical', evidence: 'The profile has 0 public repositories.' });
    expect(report.roadmap.map((i) => i.id)).toEqual(['action-first-project', 'action-profile-readme']);
    expect(top.every((item) => item.evidence && item.actionStep.length > 30)).toBe(true);
  });

  it('keeps the phantom-developer evidence truthful about location', () => {
    const withLocation = analyzePortfolio(emptyUser({ location: 'Chennai' }), [], [], false);
    expect(withLocation.roasts.find((r) => r.id === 'roast-bio')!.evidence).toBe('Bio is empty, Website is empty');
    const withBio = analyzePortfolio(emptyUser({ bio: 'CS student' }), [], [], false);
    expect(withBio.roasts.map((r) => r.id)).toEqual(['roast-empty']);
  });

  it('simulates improvement without errors or impossible numbers', () => {
    const actions = getAvailableSimulatorActions(report.facts);
    const result = simulatePortfolioImprovements(report.facts, actions.map((a) => a.id));
    expect(result.baselineScore).toBe(report.scoring.totalScore);
    expect(result.simulatedScore).toBeGreaterThanOrEqual(result.baselineScore);
    expect(result.simulatedScore).toBeLessThanOrEqual(100);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });
});

describe('rescue priorities', () => {
  it('attaches the observed evidence to every roadmap action on every demo profile', () => {
    for (const persona of MOCK_PROFILES) {
      const { roadmap, facts } = analyzePortfolio(persona.user, persona.repos, [], true);
      expect(roadmap.length).toBeGreaterThan(0);
      for (const item of roadmap) {
        expect(item.evidence, `${persona.id}/${item.id}`).toMatch(/\d|No repository named|A repository named/);
        expect(item.evidence).not.toMatch(UNSUPPORTED);
      }
      // The numbers quoted are the ones in the analysed data
      const descriptions = roadmap.find((i) => i.id === 'action-descriptions');
      if (descriptions) {
        expect(descriptions.evidence).toBe(
          `${facts.analyzedReposCount - facts.reposWithDescriptionCount} of ${facts.analyzedReposCount} repositories have no description (${facts.reposWithDescriptionPercentage}% have one).`
        );
      }
    }
  });

  it('picks at most three, most urgent first, then highest impact, deterministically', () => {
    const alex = analyzePortfolio(MOCK_PROFILES[0].user, MOCK_PROFILES[0].repos, [], true).roadmap;
    const top = selectTopRescuePriorities(alex, 3);
    expect(top).toHaveLength(3);
    expect(top.map((i) => i.id)).toEqual(['action-deploy-demo', 'action-descriptions', 'action-profile-readme']);
    expect(selectTopRescuePriorities([...alex].reverse(), 3).map((i) => i.priority)).toEqual(top.map((i) => i.priority));
    expect(selectTopRescuePriorities(alex, 0)).toEqual([]);
    expect(selectTopRescuePriorities([], 3)).toEqual([]);
  });

  it('checks for a profile repository instead of assuming one is missing', () => {
    const persona = MOCK_PROFILES[1];
    const without = analyzePortfolio(persona.user, persona.repos, [], false).roadmap.find((i) => i.id === 'action-profile-readme')!;
    expect(without.evidence).toMatch(/No repository named "sarah-oss-architect" was found among the 3 analysed repositories/);

    const profileRepo: GitHubRepo = { ...persona.repos[0], id: 999, name: 'Sarah-OSS-Architect', full_name: 'sarah-oss-architect/Sarah-OSS-Architect' };
    const withRepo = analyzePortfolio(persona.user, [...persona.repos, profileRepo], [], false).roadmap.find((i) => i.id === 'action-profile-readme')!;
    expect(withRepo.evidence).toMatch(/A repository named "sarah-oss-architect" exists\. Its README was not read/);
  });
});

describe('the core experience on screen', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(fetchRepoTree).mockReset();
    window.history.replaceState(null, '', '/');
  });

  const audit = async (username: string) => {
    render(<App />);
    const input = screen.getByLabelText('GitHub username');
    fireEvent.change(input, { target: { value: username } });
    fireEvent.submit(input.closest('form')!);
    await screen.findAllByText(`@${username}`);
  };

  it('leads with recruiter impression, roast and rescue; deeper evidence and simulation come after', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: { ...MOCK_PROFILES[0].user, login: 'weak-profile' }, rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: MOCK_PROFILES[0].repos, rateLimit: RATE_LIMIT });
    await audit('weak-profile');

    const text = screen.getByRole('main').textContent!;
    const order = ['What a recruiter notices in 30 seconds', 'The Honest Roast', 'Your Rescue Roadmap', 'Portfolio Health Breakdown', 'Repository Evidence', 'Portfolio Rescue Simulator', 'Repository Health Explorer'].map((label) =>
      text.indexOf(label)
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // The deeper inspection is offered, not started
    expect(fetchRepoTree).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Inspect Repository Evidence' })).toBeInTheDocument();
  });

  it('shows three rescue priorities, each with the evidence behind it and a first step', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: { ...MOCK_PROFILES[0].user, login: 'weak-profile' }, rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: MOCK_PROFILES[0].repos, rateLimit: RATE_LIMIT });
    await audit('weak-profile');

    const priorities = screen.getByRole('group', { name: 'Top rescue priorities' });
    expect(priorities).toHaveTextContent('Start here: your top 3 rescue priorities');
    const cards = within(priorities).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card).toHaveTextContent(/Because:/);
      expect(card).toHaveTextContent(/First step:/);
    }
    expect(cards[0]).toHaveTextContent(/0 of 2 original repositories have a live demo or website link/);
    expect(screen.getByText(/30-Second Verdict/)).toBeInTheDocument();
  });

  it('gives a complete, truthful result for a real-looking empty profile', async () => {
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: emptyUser(), rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: [], rateLimit: RATE_LIMIT });
    await audit('new-student');

    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('The Blank Slate');
    expect(main).toHaveTextContent('The Blank Canvas');
    expect(main).toHaveTextContent('Publish Your First Project');
    expect(main).toHaveTextContent('Start here: your top 2 rescue priorities');
    expect(main).toHaveTextContent(/No repositories to inspect/);
    expect(main.textContent).not.toMatch(UNSUPPORTED);
    expect(main.textContent).not.toMatch(/days ago/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
