import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MOCK_PROFILES } from './data/mockProfiles';
import { analyzePortfolio } from './services/analyzer';
import { getAvailableSimulatorActions } from './services/simulator';
import { formatReportToMarkdown } from './utils/markdownReport';
import { generateProfileReadme } from './utils/profileMakeover';

vi.mock('./services/github', async (importActual) => {
  const actual = await importActual<typeof import('./services/github')>();
  return { ...actual, fetchGitHubUser: vi.fn(), fetchGitHubRepos: vi.fn(), checkRateLimit: vi.fn() };
});

import { App } from './App';
import { fetchGitHubUser, fetchGitHubRepos, checkRateLimit } from './services/github';

const RATE_LIMIT = { limit: 60, remaining: 42, reset: 0, used: 18, resetMinutes: 30, resetTimeFormatted: '' };

describe('Demo persona fixtures match what the app says about them', () => {
  const reportFor = (id: string) => {
    const persona = MOCK_PROFILES.find((p) => p.id === id)!;
    return { persona, report: analyzePortfolio(persona.user, persona.repos, [], true) };
  };

  it.each(MOCK_PROFILES.map((p) => [p.id, p] as const))('%s: profile repo count equals its fixture repos', (_id, persona) => {
    expect(persona.user.public_repos).toBe(persona.repos.length);
    for (const repo of persona.repos) {
      expect(repo.full_name).toBe(`${persona.user.login}/${repo.name}`);
    }
  });

  it('Alex: tagline, fork counts and archetype agree with the data', () => {
    const { persona, report } = reportFor('tutorial-hoarder');
    const { facts } = report;
    expect(persona.tagline).toContain(`${facts.forkedReposCount} of ${facts.analyzedReposCount} repos are tutorial forks`);
    expect(facts.forkedReposCount).toBe(5);
    expect(facts.hasBio).toBe(false);
    expect(facts.reposWithLicenseCount).toBe(0);
    expect(facts.reposWithDemoUrlCount).toBe(0);
    expect(report.recruiter.archetype).toMatch(/Fork Collector/);
    expect(report.roasts.map((r) => r.id)).toContain('roast-forks');
  });

  it('Sarah: tagline numbers and archetype agree with the data', () => {
    const { persona, report } = reportFor('open-source-chad');
    const { facts } = report;
    expect(persona.tagline).toContain(`${facts.originalReposCount} original repos`);
    expect(persona.tagline).toContain(`${facts.totalStarsEarned.toLocaleString('en-US')} stars`);
    expect(persona.tagline).toContain(`${facts.reposWithDemoUrlCount} with live demos`);
    expect(facts.forkedReposCount).toBe(0);
    expect(facts.reposWithLicensePercentage).toBe(100);
    expect(report.recruiter.archetype).toMatch(/Open Source Trailblazer/);
  });

  it('Devon: tagline numbers and archetype agree with the data', () => {
    const { persona, report } = reportFor('framework-hopper');
    const { facts } = report;
    const languages = Object.keys(facts.languagesBreakdown).length;
    expect(persona.tagline).toContain(`${facts.analyzedReposCount} experiments in ${languages} languages`);
    expect(persona.tagline).toContain('none deployed');
    expect(facts.reposWithDemoUrlCount).toBe(0);
    const lastPushYear = Math.max(...persona.repos.map((r) => new Date(r.pushed_at).getFullYear()));
    expect(persona.tagline).toContain(`last push in ${lastPushYear}`);
    expect(report.recruiter.archetype).toMatch(/Dormant Veteran/);
  });
});

describe('Final cleanup: offline personas, unsupported claims and project link', () => {
  it('demo persona avatars are embedded and need no network', () => {
    for (const persona of MOCK_PROFILES) {
      expect(persona.user.avatar_url.startsWith('data:image/svg+xml,')).toBe(true);
      const initials = persona.user.name!.split(' ').map((part) => part[0]).join('');
      expect(decodeURIComponent(persona.user.avatar_url)).toContain(`>${initials}</text>`);
    }
    expect(JSON.stringify(MOCK_PROFILES)).not.toMatch(/unsplash|https?:\/\/images\./i);
  });

  it('generated copy makes no numerical claims about recruiters or developer rankings', () => {
    const unsupported = /\d+\s*%\s+of\s+(developers|recruiters|profiles)|\d+\s*(-|to)\s*\d+\s+seconds|\b\d+\s+seconds\b|\d+-second/i;
    for (const persona of MOCK_PROFILES) {
      for (const isMock of [true, false]) {
        const report = analyzePortfolio(persona.user, persona.repos, [], isMock);
        const copy = [
          report.recruiter.tenSecondVerdict,
          report.recruiter.firstImpressionQuote,
          report.recruiter.archetypeDescription,
          ...report.roasts.map((r) => r.roast),
          ...report.roadmap.map((r) => `${r.title} ${r.description}`),
          ...getAvailableSimulatorActions(report.facts).map((a) => `${a.shortDescription} ${a.whyItMatters}`),
          // "30-Second Scan" is the challenge's own framing of the recruiter view, used as a section label
          formatReportToMarkdown(report).replace('(30-Second Scan)', ''),
        ].join('\n');
        expect(copy).not.toMatch(unsupported);
      }
    }
  });

  it('the generated README credits the project repository without a .git suffix', () => {
    const { facts } = analyzePortfolio(MOCK_PROFILES[1].user, MOCK_PROFILES[1].repos, [], false);
    const { markdown } = generateProfileReadme(facts);
    expect(markdown).toContain('[Repozyn AI](https://github.com/DDUma7/repozyn-ai)');
    expect(markdown).not.toContain('repozyn-ai.git');
  });
});

describe('Navbar demo persona menu and shareable audit links', () => {
  beforeEach(() => {
    vi.mocked(fetchGitHubUser).mockReset();
    vi.mocked(fetchGitHubRepos).mockReset();
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens by click, exposes its state, closes on Escape and outside press, and selects a persona', async () => {
    render(<App />);
    const banner = within(screen.getByRole('banner'));
    const toggle = banner.getByRole('button', { name: /Select demo persona/i });

    // Closed by default: no hover-only content hiding in the DOM
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(banner.queryByText(MOCK_PROFILES[0].name)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(banner.getByText(MOCK_PROFILES[0].name)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    fireEvent.touchStart(document.body);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    fireEvent.click(banner.getByText(MOCK_PROFILES[1].name).closest('button')!);
    expect((await screen.findAllByText('@sarah-oss-architect')).length).toBeGreaterThan(0);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts the selected audit in the URL and clears it on reset', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');
    expect(window.location.search).toBe('?demo=tutorial-hoarder');

    fireEvent.click(screen.getByLabelText(/Repozyn AI Home/i));
    expect(window.location.search).toBe('');
  });

  it('copies a link that restores a demo persona audit', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const first = render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-framework-hopper'));
    await screen.findAllByText('@devon-shiny-tech');
    fireEvent.click(screen.getByRole('button', { name: /Share Audit/i }));
    expect(await screen.findByText(/Link Copied!/i)).toBeInTheDocument();

    const sharedUrl = new URL(writeText.mock.calls[0][0]);
    expect(sharedUrl.searchParams.get('demo')).toBe('framework-hopper');
    first.unmount();

    // Opening the copied link in a fresh session lands on the same audit
    window.history.replaceState(null, '', `${sharedUrl.pathname}${sharedUrl.search}`);
    render(<App />);
    expect((await screen.findAllByText('@devon-shiny-tech')).length).toBeGreaterThan(0);
    expect(fetchGitHubUser).not.toHaveBeenCalled();
  });

  it('restores a real profile audit from ?user= and ignores malformed values', async () => {
    const sarah = MOCK_PROFILES[1];
    vi.mocked(fetchGitHubUser).mockResolvedValue({ data: { ...sarah.user, login: 'real-dev' }, rateLimit: RATE_LIMIT });
    vi.mocked(fetchGitHubRepos).mockResolvedValue({ data: sarah.repos, rateLimit: RATE_LIMIT });

    window.history.replaceState(null, '', '/?user=real-dev');
    const first = render(<App />);
    expect((await screen.findAllByText('@real-dev')).length).toBeGreaterThan(0);
    expect(fetchGitHubUser).toHaveBeenCalledWith('real-dev', '');
    expect(window.location.search).toBe('?user=real-dev');
    first.unmount();

    vi.mocked(fetchGitHubUser).mockClear();
    window.history.replaceState(null, '', '/?user=../../etc/passwd&demo=nope');
    render(<App />);
    expect(screen.getByText(/Audit Your Portfolio/i)).toBeInTheDocument();
    expect(fetchGitHubUser).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });
});
