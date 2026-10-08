import { describe, it, expect } from 'vitest';
import {
  extractPortfolioFacts,
  calculateHealthScore,
  determineRecruiterImpression,
  generateEvidenceBasedRoasts,
  generatePersonalizedRoadmap,
  analyzePortfolio,
} from './analyzer';
import { MOCK_PROFILES } from '../data/mockProfiles';
import type { GitHubUser, GitHubRepo } from '../types/github';

const mockBaseUser: GitHubUser = {
  login: 'testdev',
  id: 12345,
  avatar_url: 'https://example.com/avatar.png',
  html_url: 'https://github.com/testdev',
  name: 'Test Developer',
  company: 'Acme Corp',
  blog: 'https://testdev.com',
  location: 'New York, NY',
  email: 'test@example.com',
  hireable: true,
  bio: 'Full stack TypeScript dev passionate about web standards',
  twitter_username: 'testdev',
  public_repos: 5,
  public_gists: 1,
  followers: 45,
  following: 20,
  created_at: '2021-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockBaseRepos: GitHubRepo[] = [
  {
    id: 1,
    name: 'app-one',
    full_name: 'testdev/app-one',
    html_url: 'https://github.com/testdev/app-one',
    description: 'Production-ready web application',
    fork: false,
    created_at: '2022-01-01T00:00:00Z',
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    pushed_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    homepage: 'https://app-one.vercel.app',
    size: 1200,
    stargazers_count: 25,
    watchers_count: 25,
    language: 'TypeScript',
    forks_count: 3,
    archived: false,
    disabled: false,
    open_issues_count: 0,
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: null },
    topics: ['react', 'vite'],
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_pages: false,
    default_branch: 'main',
  },
  {
    id: 2,
    name: 'app-two',
    full_name: 'testdev/app-two',
    html_url: 'https://github.com/testdev/app-two',
    description: 'CLI tool for developers',
    fork: false,
    created_at: '2022-06-01T00:00:00Z',
    updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    pushed_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    homepage: null,
    size: 800,
    stargazers_count: 12,
    watchers_count: 12,
    language: 'TypeScript',
    forks_count: 1,
    archived: false,
    disabled: false,
    open_issues_count: 0,
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: null },
    topics: ['cli', 'node'],
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_pages: false,
    default_branch: 'main',
  },
  {
    id: 3,
    name: 'upstream-tool',
    full_name: 'testdev/upstream-tool',
    html_url: 'https://github.com/testdev/upstream-tool',
    description: 'Forked tool to test a bug',
    fork: true,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-02T00:00:00Z',
    pushed_at: '2023-01-02T00:00:00Z',
    homepage: null,
    size: 3000,
    stargazers_count: 0,
    watchers_count: 0,
    language: 'JavaScript',
    forks_count: 0,
    archived: false,
    disabled: false,
    open_issues_count: 0,
    license: null,
    topics: [],
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_pages: false,
    default_branch: 'master',
  },
];

describe('analyzer service', () => {
  it('extracts verified portfolio facts accurately', () => {
    const facts = extractPortfolioFacts(mockBaseUser, mockBaseRepos);

    expect(facts.username).toBe('testdev');
    expect(facts.analyzedReposCount).toBe(3);
    expect(facts.originalReposCount).toBe(2);
    expect(facts.forkedReposCount).toBe(1);
    expect(facts.totalStarsEarned).toBe(37); // 25 + 12 + 0
    expect(facts.reposWithLicenseCount).toBe(2);
    expect(facts.reposWithLicensePercentage).toBe(100); // 2/2 original repos
    expect(facts.reposWithDescriptionPercentage).toBe(100); // 3/3 repos have descriptions
    expect(facts.reposWithDemoUrlCount).toBe(1);
    expect(facts.hasBio).toBe(true);
    expect(facts.hasWebsite).toBe(true);
    expect(facts.hasLocation).toBe(true);
    expect(facts.topLanguages).toContain('TypeScript');
  });

  it('calculates transparent health scores with complete rubrics', () => {
    const facts = extractPortfolioFacts(mockBaseUser, mockBaseRepos);
    const score = calculateHealthScore(facts);

    expect(score.totalScore).toBeGreaterThanOrEqual(0);
    expect(score.totalScore).toBeLessThanOrEqual(100);
    expect(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']).toContain(score.grade);

    // Check all 4 categories exist and have maxScore 25
    expect(score.documentation.maxScore).toBe(25);
    expect(score.originality.maxScore).toBe(25);
    expect(score.maintenance.maxScore).toBe(25);
    expect(score.hygiene.maxScore).toBe(25);

    // Sum of maxScores must be 100
    expect(
      score.documentation.maxScore +
        score.originality.maxScore +
        score.maintenance.maxScore +
        score.hygiene.maxScore
    ).toBe(100);

    // Details must provide reasons
    expect(score.documentation.details.length).toBeGreaterThan(0);
    expect(score.documentation.details[0].reason).toBeDefined();
  });

  it('generates recruiter impressions with flags', () => {
    const facts = extractPortfolioFacts(mockBaseUser, mockBaseRepos);
    const recruiter = determineRecruiterImpression(facts);

    expect(recruiter.archetype).toBeDefined();
    expect(recruiter.tenSecondVerdict).toBeDefined();
    expect(['Strong', 'Promising', 'Caution', 'Needs Overhaul']).toContain(
      recruiter.hireabilitySignal
    );
    expect(recruiter.greenFlags.length).toBeGreaterThan(0);
  });

  it('produces humorous evidence-based roasts citing verified facts', () => {
    const facts = extractPortfolioFacts(mockBaseUser, mockBaseRepos);
    const roasts = generateEvidenceBasedRoasts(facts);

    expect(roasts.length).toBeGreaterThan(0);
    for (const roast of roasts) {
      expect(roast.title).toBeDefined();
      expect(roast.roast).toBeDefined();
      expect(roast.evidence).toBeDefined();
      expect(roast.evidence.length).toBeGreaterThan(5);
    }
  });

  it('produces actionable rescue roadmap items with templates', () => {
    const facts = extractPortfolioFacts(mockBaseUser, mockBaseRepos);
    const roadmap = generatePersonalizedRoadmap(facts);

    expect(roadmap.length).toBeGreaterThan(0);
    for (const item of roadmap) {
      expect(item.title).toBeDefined();
      expect(item.actionStep).toBeDefined();
      expect(item.effort).toBeDefined();
      expect(item.priority).toBeDefined();
    }
  });

  it('analyzes all built-in mock personas successfully', () => {
    for (const mock of MOCK_PROFILES) {
      const report = analyzePortfolio(mock.user, mock.repos, [], true);
      expect(report.facts.username).toBe(mock.user.login);
      expect(report.scoring.totalScore).toBeGreaterThanOrEqual(0);
      expect(report.scoring.totalScore).toBeLessThanOrEqual(100);
      expect(report.roasts.length).toBeGreaterThan(0);
      expect(report.roadmap.length).toBeGreaterThan(0);
    }
  });
});
