import type { PortfolioFacts, HealthScoreBreakdown } from '../types/analysis';
import { calculateHealthScore } from './analyzer';

export type SimulatorActionId =
  | 'complete_descriptions'
  | 'add_licenses'
  | 'add_demo_links'
  | 'complete_profile'
  | 'tag_repo_topics'
  | 'refresh_cadence';

export interface SimulatorAction {
  id: SimulatorActionId;
  pillar: 'Documentation' | 'Hygiene' | 'Maintenance';
  title: string;
  shortDescription: string;
  actionableStep: string;
  whyItMatters: string;
  currentStatus: string;
  targetStatus: string;
  estimatedPointsGain: number;
  alreadySatisfied: boolean;
}

export interface PillarComparison {
  name: string;
  baseline: number;
  simulated: number;
  delta: number;
  max: number;
}

export interface SimulationResult {
  baselineScore: number;
  simulatedScore: number;
  scoreDelta: number;
  baselineGrade: HealthScoreBreakdown['grade'];
  simulatedGrade: HealthScoreBreakdown['grade'];
  baselineGradeColor: string;
  simulatedGradeColor: string;
  pillars: {
    documentation: PillarComparison;
    originality: PillarComparison;
    maintenance: PillarComparison;
    hygiene: PillarComparison;
  };
  assumptionsAndLimits: string[];
  activeActionCount: number;
}

/**
 * Generates the list of realistic simulator actions tailored to the user's verified facts.
 * Determines how many points each specific action would yield under the existing rubric.
 */
export function getAvailableSimulatorActions(facts: PortfolioFacts): SimulatorAction[] {
  const hasRepos = facts.analyzedReposCount > 0;
  const hasOriginal = facts.originalReposCount > 0;
  const totalRepos = Math.max(1, facts.analyzedReposCount);
  const originalRepos = Math.max(1, facts.originalReposCount);

  // 1. Descriptions: Rubric gives 10 pts for >=80%, 7 for >=50%, 4 for >=25%, 2 for >0%, 0 for 0%
  const currentDescPct = facts.reposWithDescriptionPercentage;
  let currentDescEarned = 0;
  if (currentDescPct >= 80) currentDescEarned = 10;
  else if (currentDescPct >= 50) currentDescEarned = 7;
  else if (currentDescPct >= 25) currentDescEarned = 4;
  else if (currentDescPct > 0) currentDescEarned = 2;
  const descPotentialGain = hasRepos ? Math.max(0, 10 - currentDescEarned) : 0;

  // 2. Licenses: Rubric gives 12 pts for >=70%, 8 for >=40%, 4 for >=15%, 1 for <15%
  const currentLicPct = facts.reposWithLicensePercentage;
  let currentLicEarned = 0;
  if (currentLicPct >= 70) currentLicEarned = 12;
  else if (currentLicPct >= 40) currentLicEarned = 8;
  else if (currentLicPct >= 15) currentLicEarned = 4;
  else currentLicEarned = 1;
  const licPotentialGain = hasRepos && hasOriginal ? Math.max(0, 12 - currentLicEarned) : 0;

  // 3. Demo URLs: Rubric gives 13 pts for >=40%, 9 for >=20%, 5 for >=1, 1 for 0
  const currentDemoPct = facts.reposWithDemoUrlPercentage;
  let currentDemoEarned = 0;
  if (currentDemoPct >= 40) currentDemoEarned = 13;
  else if (currentDemoPct >= 20) currentDemoEarned = 9;
  else if (facts.reposWithDemoUrlCount >= 1) currentDemoEarned = 5;
  else currentDemoEarned = 1;
  const demoPotentialGain = hasRepos ? Math.max(0, 13 - currentDemoEarned) : 0;

  // 4. Profile completeness: Bio (5), Blog (3), Location (2) = 10 pts max
  let currentProfileEarned = 0;
  if (facts.hasBio) currentProfileEarned += 5;
  if (facts.hasWebsite) currentProfileEarned += 3;
  if (facts.hasLocation) currentProfileEarned += 2;
  const profilePotentialGain = Math.max(0, 10 - currentProfileEarned);

  // 5. Topics: >=40% gives 5 pts, >=15% gives 3 pts, >0% gives 1 pt
  const topicsRatio = facts.reposWithTopicsCount / totalRepos;
  let currentTopicsEarned = 0;
  if (topicsRatio >= 0.4) currentTopicsEarned = 5;
  else if (topicsRatio >= 0.15) currentTopicsEarned = 3;
  else if (topicsRatio > 0) currentTopicsEarned = 1;
  const topicsPotentialGain = hasRepos ? Math.max(0, 5 - currentTopicsEarned) : 0;

  // 6. Maintenance cadence: Push <=7d gives 15 pts, <=30d gives 12, <=90d gives 8, <=180d gives 4, else 1
  let currentRecencyEarned = 0;
  if (facts.daysSinceLastPush <= 7) currentRecencyEarned = 15;
  else if (facts.daysSinceLastPush <= 30) currentRecencyEarned = 12;
  else if (facts.daysSinceLastPush <= 90) currentRecencyEarned = 8;
  else if (facts.daysSinceLastPush <= 180) currentRecencyEarned = 4;
  else currentRecencyEarned = 1;

  // Stale ratio: <=25% gives 10 pts, <=50% gives 7, <=75% gives 4, else 2
  const staleRatio = facts.staleReposCount / totalRepos;
  let currentStaleEarned = 0;
  if (staleRatio <= 0.25) currentStaleEarned = 10;
  else if (staleRatio <= 0.5) currentStaleEarned = 7;
  else if (staleRatio <= 0.75) currentStaleEarned = 4;
  else currentStaleEarned = 2;

  const cadencePotentialGain = hasRepos
    ? Math.max(0, 15 - currentRecencyEarned) + Math.max(0, 10 - currentStaleEarned)
    : 0;

  return [
    {
      id: 'complete_descriptions',
      pillar: 'Documentation',
      title: 'Add Missing Repository Descriptions',
      shortDescription: 'Ensure 100% of public repositories have concise 1-sentence descriptions.',
      actionableStep: hasRepos
        ? 'Open your repository settings or run `gh repo edit --description "..."` on repos with empty descriptions.'
        : 'Create and publish at least 1 repository first before adding descriptions.',
      whyItMatters: 'Reviewers skim repository titles and descriptions quickly; blank descriptions read as incomplete work.',
      currentStatus: hasRepos
        ? `${facts.reposWithDescriptionPercentage}% coverage (${facts.reposWithDescriptionCount}/${facts.analyzedReposCount})`
        : '0 public repositories found',
      targetStatus: hasRepos ? '100% coverage (10/10 pts)' : 'Requires at least 1 repository',
      estimatedPointsGain: descPotentialGain,
      alreadySatisfied: hasRepos && currentDescPct >= 80,
    },
    {
      id: 'add_licenses',
      pillar: 'Hygiene',
      title: 'Add Open-Source SPDX Licenses',
      shortDescription: 'Attach an open-source license (e.g. MIT, Apache-2.0) to all original repositories.',
      actionableStep: !hasRepos
        ? 'Create and publish at least 1 repository first before adding licenses.'
        : !hasOriginal
        ? 'Forks retain upstream licenses. Create an original repository to apply your own open-source license.'
        : 'Add a `LICENSE` file via GitHub web editor (choose "Add file > Create new file", type LICENSE, pick MIT template).',
      whyItMatters: 'Repositories without licenses are legally unusable by teams and signal missing open-source hygiene.',
      currentStatus: !hasRepos
        ? '0 public repositories found'
        : !hasOriginal
        ? '0 original repositories (all existing repos are forks)'
        : `${facts.reposWithLicensePercentage}% coverage (${facts.reposWithLicenseCount}/${originalRepos})`,
      targetStatus: hasRepos && hasOriginal ? '100% coverage (12/12 pts)' : 'Requires original repository',
      estimatedPointsGain: licPotentialGain,
      alreadySatisfied: hasRepos && hasOriginal && currentLicPct >= 70,
    },
    {
      id: 'add_demo_links',
      pillar: 'Hygiene',
      title: 'Deploy Live Previews for Top Projects',
      shortDescription: 'Add working web previews (Vercel, Netlify, or GitHub Pages) to featured projects.',
      actionableStep: hasRepos
        ? 'Deploy your frontend/API and paste the live URL in the repo "About > Website" field.'
        : 'Publish a project before linking live previews.',
      whyItMatters: 'Engineering managers rarely clone and install unknown repositories locally; a live demo provides instant proof of skill.',
      currentStatus: hasRepos
        ? `${facts.reposWithDemoUrlCount} live projects (${facts.reposWithDemoUrlPercentage}%)`
        : '0 public repositories found',
      targetStatus: hasRepos ? '40%+ projects with live URLs (13/13 pts)' : 'Requires at least 1 repository',
      estimatedPointsGain: demoPotentialGain,
      alreadySatisfied: hasRepos && currentDemoPct >= 40,
    },
    {
      id: 'complete_profile',
      pillar: 'Documentation',
      title: 'Complete Profile Details (Bio, Location, Website)',
      shortDescription: 'Fill in your GitHub bio headline, geographical location, and personal portfolio link.',
      actionableStep: 'Go to GitHub Settings > Public profile and add a bio, location, and your portfolio/LinkedIn URL.',
      whyItMatters: 'A complete profile provides hiring managers immediate context on your seniority, specialty, and timezone.',
      currentStatus: `Bio: ${facts.hasBio ? '✓' : '✗'}, Website: ${facts.hasWebsite ? '✓' : '✗'}, Location: ${facts.hasLocation ? '✓' : '✗'}`,
      targetStatus: 'Complete profile (10/10 pts)',
      estimatedPointsGain: profilePotentialGain,
      alreadySatisfied: facts.hasBio && facts.hasWebsite && facts.hasLocation,
    },
    {
      id: 'tag_repo_topics',
      pillar: 'Documentation',
      title: 'Tag Repositories with Discovery Topics',
      shortDescription: 'Add 3-5 GitHub topic tags (e.g. `react`, `typescript`, `rest-api`) to your repositories.',
      actionableStep: hasRepos
        ? 'Click the ⚙️ icon next to "About" on your repository page and type relevant framework and domain tags.'
        : 'Publish a project before tagging repository topics.',
      whyItMatters: 'Topics enable GitHub search indexing and immediately communicate the architectural stack to reviewers.',
      currentStatus: hasRepos
        ? `${facts.reposWithTopicsCount} of ${totalRepos} repos tagged (${Math.round(topicsRatio * 100)}%)`
        : '0 public repositories found',
      targetStatus: hasRepos ? '40%+ repos tagged (5/5 pts)' : 'Requires at least 1 repository',
      estimatedPointsGain: topicsPotentialGain,
      alreadySatisfied: hasRepos && topicsRatio >= 0.4,
    },
    {
      id: 'refresh_cadence',
      pillar: 'Maintenance',
      title: 'Refresh Commit Cadence & Archive Stale Repos',
      shortDescription: 'Push an active update within 7 days and archive dead/abandoned experiments.',
      actionableStep: hasRepos
        ? 'Commit dependency updates or documentation polish to your top project, and archive obsolete test repos.'
        : 'Publish a project and start regular commit cadence.',
      whyItMatters: 'Active push timestamps prove that you are currently coding, while archived repos show deliberate housekeeping.',
      currentStatus: hasRepos
        ? `Last push: ${facts.daysSinceLastPush === 999 ? 'Unknown' : `${facts.daysSinceLastPush}d ago`}, ${facts.staleReposCount} stale repos`
        : '0 public repositories found',
      targetStatus: hasRepos ? 'Push within 7 days, <=25% stale (25/25 pts)' : 'Requires at least 1 repository',
      estimatedPointsGain: cadencePotentialGain,
      alreadySatisfied: hasRepos && facts.daysSinceLastPush <= 7 && staleRatio <= 0.25,
    },
  ];
}

/**
 * Re-runs the exact transparent 4-pillar health score rubric on hypothetical facts.
 * Never invents arbitrary weights or rewards cosmetic actions without corresponding rubric logic.
 */
export function simulatePortfolioImprovements(
  baselineFacts: PortfolioFacts,
  activeActionIds: SimulatorActionId[]
): SimulationResult {
  const baselineScoring = calculateHealthScore(baselineFacts);

  // Clone facts cleanly
  const simulatedFacts: PortfolioFacts = {
    ...baselineFacts,
  };

  const hasRepos = baselineFacts.analyzedReposCount > 0;
  const hasOriginal = baselineFacts.originalReposCount > 0;
  const totalRepos = Math.max(1, simulatedFacts.analyzedReposCount);
  const originalRepos = Math.max(1, simulatedFacts.originalReposCount);

  // Apply ONLY selected improvements if preconditions exist
  if (activeActionIds.includes('complete_descriptions') && hasRepos) {
    simulatedFacts.reposWithDescriptionCount = totalRepos;
    simulatedFacts.reposWithDescriptionPercentage = 100;
  }

  if (activeActionIds.includes('add_licenses') && hasRepos && hasOriginal) {
    simulatedFacts.reposWithLicenseCount = originalRepos;
    simulatedFacts.reposWithLicensePercentage = 100;
  }

  if (activeActionIds.includes('add_demo_links') && hasRepos) {
    const targetDemoCount = Math.max(
      simulatedFacts.reposWithDemoUrlCount,
      Math.ceil(totalRepos * 0.45)
    );
    simulatedFacts.reposWithDemoUrlCount = targetDemoCount;
    simulatedFacts.reposWithDemoUrlPercentage = Math.round((targetDemoCount / totalRepos) * 100);
  }

  if (activeActionIds.includes('complete_profile')) {
    simulatedFacts.hasBio = true;
    simulatedFacts.hasLocation = true;
    simulatedFacts.hasWebsite = true;
  }

  if (activeActionIds.includes('tag_repo_topics') && hasRepos) {
    const targetTopicCount = Math.max(
      simulatedFacts.reposWithTopicsCount,
      Math.ceil(totalRepos * 0.45)
    );
    simulatedFacts.reposWithTopicsCount = targetTopicCount;
  }

  if (activeActionIds.includes('refresh_cadence') && hasRepos) {
    simulatedFacts.daysSinceLastPush = 2; // Simulated recent push
    simulatedFacts.recentPushesCount30d = Math.max(1, simulatedFacts.recentPushesCount30d);
    // Simulated pruning brings stale ratio to <= 20%
    simulatedFacts.staleReposCount = Math.min(
      simulatedFacts.staleReposCount,
      Math.floor(totalRepos * 0.2)
    );
  }

  // Recalculate score using the exact production rubric
  const simulatedScoring = calculateHealthScore(simulatedFacts);

  const scoreDelta = simulatedScoring.totalScore - baselineScoring.totalScore;

  // Build transparent assumptions and limits
  const assumptionsAndLimits: string[] = [
    `Non-fork repository ratio (${Math.round((baselineFacts.originalReposCount / totalRepos) * 100)}%) and Community Stars (${baselineFacts.totalStarsEarned} ⭐) represent organic peer validation and cannot be simulated by hygiene toggles.`,
    'All simulated points are derived strictly from the Repozyn 4-pillar deterministic rubric (max 25 pts per pillar).',
    'Hypothetical projections require real code, configuration, or settings updates to be pushed to GitHub to take effect in actual audits.',
  ];

  if (!hasRepos) {
    assumptionsAndLimits.unshift(
      'Account has 0 public repositories. Repository-level actions (descriptions, licenses, demos, cadence) require creating and publishing projects first.'
    );
  } else if (!hasOriginal) {
    assumptionsAndLimits.push(
      'All repositories are forks. Open-source licensing requires an original repository, as forks retain upstream licenses.'
    );
  }

  return {
    baselineScore: baselineScoring.totalScore,
    simulatedScore: simulatedScoring.totalScore,
    scoreDelta,
    baselineGrade: baselineScoring.grade,
    simulatedGrade: simulatedScoring.grade,
    baselineGradeColor: baselineScoring.gradeColor,
    simulatedGradeColor: simulatedScoring.gradeColor,
    pillars: {
      documentation: {
        name: 'Documentation & Clarity',
        baseline: baselineScoring.documentation.score,
        simulated: simulatedScoring.documentation.score,
        delta: simulatedScoring.documentation.score - baselineScoring.documentation.score,
        max: 25,
      },
      originality: {
        name: 'Own Work & Traction',
        baseline: baselineScoring.originality.score,
        simulated: simulatedScoring.originality.score,
        delta: simulatedScoring.originality.score - baselineScoring.originality.score,
        max: 25,
      },
      maintenance: {
        name: 'Maintenance & Cadence',
        baseline: baselineScoring.maintenance.score,
        simulated: simulatedScoring.maintenance.score,
        delta: simulatedScoring.maintenance.score - baselineScoring.maintenance.score,
        max: 25,
      },
      hygiene: {
        name: 'Professional Hygiene',
        baseline: baselineScoring.hygiene.score,
        simulated: simulatedScoring.hygiene.score,
        delta: simulatedScoring.hygiene.score - baselineScoring.hygiene.score,
        max: 25,
      },
    },
    assumptionsAndLimits,
    activeActionCount: activeActionIds.length,
  };
}
