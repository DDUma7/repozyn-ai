import { describe, it, expect } from 'vitest';
import {
  getAvailableSimulatorActions,
  simulatePortfolioImprovements,
} from './simulator';
import type { PortfolioFacts } from '../types/analysis';

describe('Portfolio Rescue Simulator Engine', () => {
  const mockFacts: PortfolioFacts = {
    username: 'dev-learner',
    name: 'Dev Learner',
    avatarUrl: 'https://example.com/avatar.png',
    profileUrl: 'https://github.com/dev-learner',
    bio: null,
    company: null,
    location: null,
    website: null,
    hasBio: false,
    hasLocation: false,
    hasWebsite: false,
    accountAgeYears: 2,
    createdAtFormatted: 'Jan 2024',
    followersCount: 5,
    followingCount: 10,
    totalPublicRepos: 10,
    analyzedReposCount: 10,
    originalReposCount: 8,
    forkedReposCount: 2,
    archivedReposCount: 0,
    totalStarsEarned: 2,
    totalForksCount: 1,
    languagesBreakdown: { JavaScript: { count: 8, percentage: 80 } },
    topLanguages: ['JavaScript'],
    reposWithDescriptionCount: 2,
    reposWithDescriptionPercentage: 20, // Low (< 25%, earns only 2/10 pts)
    reposWithLicenseCount: 1,
    reposWithLicensePercentage: 12, // Low (< 15%, earns only 1/12 pts)
    reposWithDemoUrlCount: 0,
    reposWithDemoUrlPercentage: 0, // 0%, earns 1/13 pts
    reposWithTopicsCount: 1,
    daysSinceLastPush: 45, // > 30d, earns 8/15 pts
    recentPushesCount30d: 0,
    staleReposCount: 6, // 60% stale, earns 4/10 pts
    topStarredRepos: [],
    allRepos: [],
  };

  it('evaluates available simulator actions and calculates potential point gains', () => {
    const actions = getAvailableSimulatorActions(mockFacts);
    expect(actions.length).toBe(6);

    const descAction = actions.find((a) => a.id === 'complete_descriptions');
    expect(descAction).toBeDefined();
    expect(descAction?.alreadySatisfied).toBe(false);
    expect(descAction?.estimatedPointsGain).toBeGreaterThan(0);

    const licAction = actions.find((a) => a.id === 'add_licenses');
    expect(licAction).toBeDefined();
    expect(licAction?.alreadySatisfied).toBe(false);
    expect(licAction?.estimatedPointsGain).toBeGreaterThan(0);

    const profileAction = actions.find((a) => a.id === 'complete_profile');
    expect(profileAction?.alreadySatisfied).toBe(false);
    expect(profileAction?.estimatedPointsGain).toBe(10); // Bio(5) + Web(3) + Loc(2)
  });

  it('returns zero score delta when no simulator actions are selected', () => {
    const result = simulatePortfolioImprovements(mockFacts, []);

    expect(result.scoreDelta).toBe(0);
    expect(result.baselineScore).toBe(result.simulatedScore);
    expect(result.baselineGrade).toBe(result.simulatedGrade);
    expect(result.activeActionCount).toBe(0);
  });

  it('recalculates hypothetical score deterministically when individual actions are toggled', () => {
    // 1. Toggle descriptions
    const descResult = simulatePortfolioImprovements(mockFacts, ['complete_descriptions']);
    expect(descResult.scoreDelta).toBeGreaterThan(0);
    expect(descResult.pillars.documentation.delta).toBeGreaterThan(0);
    // Other pillars must remain unchanged
    expect(descResult.pillars.hygiene.delta).toBe(0);
    expect(descResult.pillars.maintenance.delta).toBe(0);
    expect(descResult.pillars.originality.delta).toBe(0);

    // 2. Toggle licenses
    const licResult = simulatePortfolioImprovements(mockFacts, ['add_licenses']);
    expect(licResult.pillars.hygiene.delta).toBeGreaterThan(0);
    expect(licResult.pillars.documentation.delta).toBe(0);
  });

  it('re-runs exact rubric and respects pillar maximums when all actions are simulated', () => {
    const allActionIds = getAvailableSimulatorActions(mockFacts).map((a) => a.id);
    const result = simulatePortfolioImprovements(mockFacts, allActionIds);

    // Score must have increased significantly
    expect(result.simulatedScore).toBeGreaterThan(result.baselineScore);
    expect(result.scoreDelta).toBe(result.simulatedScore - result.baselineScore);

    // Strict ceiling: No pillar may exceed 25 points, total cannot exceed 100
    expect(result.pillars.documentation.simulated).toBeLessThanOrEqual(25);
    expect(result.pillars.hygiene.simulated).toBeLessThanOrEqual(25);
    expect(result.pillars.maintenance.simulated).toBeLessThanOrEqual(25);
    expect(result.pillars.originality.simulated).toBeLessThanOrEqual(25);
    expect(result.simulatedScore).toBeLessThanOrEqual(100);
  });

  it('does NOT artificially inflate organic stars or original creation ratios (anti-fabrication check)', () => {
    const allActionIds = getAvailableSimulatorActions(mockFacts).map((a) => a.id);
    const result = simulatePortfolioImprovements(mockFacts, allActionIds);

    // Originality pillar delta must be 0 because cosmetic hygiene does not create original repos or stars!
    expect(result.pillars.originality.delta).toBe(0);
    expect(result.pillars.originality.baseline).toBe(result.pillars.originality.simulated);

    // Must include explicit assumption limitations
    expect(result.assumptionsAndLimits.some((s) => s.includes('Community Stars'))).toBe(true);
    expect(result.assumptionsAndLimits.some((s) => s.includes('Original Project Ratio'))).toBe(true);
  });

  it('handles 0-repository profiles with realistic preconditions (no phantom repo gains)', () => {
    const zeroRepoFacts: PortfolioFacts = {
      ...mockFacts,
      analyzedReposCount: 0,
      totalPublicRepos: 0,
      originalReposCount: 0,
      forkedReposCount: 0,
      reposWithDescriptionCount: 0,
      reposWithDescriptionPercentage: 0,
      reposWithLicenseCount: 0,
      reposWithLicensePercentage: 0,
      reposWithDemoUrlCount: 0,
      reposWithDemoUrlPercentage: 0,
      reposWithTopicsCount: 0,
      daysSinceLastPush: 999,
      staleReposCount: 0,
    };

    const actions = getAvailableSimulatorActions(zeroRepoFacts);
    const descAction = actions.find((a) => a.id === 'complete_descriptions');
    const licAction = actions.find((a) => a.id === 'add_licenses');
    const profileAction = actions.find((a) => a.id === 'complete_profile');

    expect(descAction?.estimatedPointsGain).toBe(0);
    expect(descAction?.targetStatus).toContain('Requires at least 1 repository');
    expect(licAction?.estimatedPointsGain).toBe(0);
    // Profile completeness can still gain points!
    expect(profileAction?.estimatedPointsGain).toBeGreaterThan(0);

    // Simulating all actions on 0 repos does not inflate repo stats
    const simResult = simulatePortfolioImprovements(zeroRepoFacts, ['complete_descriptions', 'add_licenses']);
    expect(simResult.pillars.documentation.delta).toBe(0);
    expect(simResult.assumptionsAndLimits.some((s) => s.includes('0 public repositories'))).toBe(true);
  });

  it('handles fork-only profiles without allowing relicensing of upstream forks', () => {
    const forkOnlyFacts: PortfolioFacts = {
      ...mockFacts,
      analyzedReposCount: 5,
      totalPublicRepos: 5,
      originalReposCount: 0,
      forkedReposCount: 5,
      reposWithLicenseCount: 0,
      reposWithLicensePercentage: 0,
    };

    const actions = getAvailableSimulatorActions(forkOnlyFacts);
    const licAction = actions.find((a) => a.id === 'add_licenses');

    expect(licAction?.estimatedPointsGain).toBe(0);
    expect(licAction?.currentStatus).toContain('all existing repos are forks');

    const simResult = simulatePortfolioImprovements(forkOnlyFacts, ['add_licenses']);
    expect(simResult.pillars.hygiene.delta).toBe(0);
    expect(simResult.assumptionsAndLimits.some((s) => s.includes('All repositories are forks'))).toBe(true);
  });
});
