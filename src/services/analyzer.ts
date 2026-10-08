import type { GitHubUser, GitHubRepo, GitHubEvent } from '../types/github';
import type {
  PortfolioFacts,
  HealthScoreBreakdown,
  RecruiterImpression,
  RoastItem,
  RoadmapActionItem,
  PortfolioReport,
  RoastTone,
} from '../types/analysis';

export function extractPortfolioFacts(
  user: GitHubUser,
  repos: GitHubRepo[],
  _events: GitHubEvent[] = []
): PortfolioFacts {
  const analyzedReposCount = repos.length;
  const originalRepos = repos.filter((r) => !r.fork);
  const originalReposCount = originalRepos.length;
  const forkedReposCount = repos.filter((r) => r.fork).length;
  const archivedReposCount = repos.filter((r) => r.archived).length;

  const totalStarsEarned = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const totalForksCount = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);

  // Languages breakdown
  const languageCounts: Record<string, number> = {};
  for (const repo of repos) {
    if (repo.language) {
      languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
    }
  }

  const totalWithLang = Object.values(languageCounts).reduce((a, b) => a + b, 0) || 1;
  const languagesBreakdown: Record<string, { count: number; percentage: number }> = {};
  for (const [lang, count] of Object.entries(languageCounts)) {
    languagesBreakdown[lang] = {
      count,
      percentage: Math.round((count / totalWithLang) * 100),
    };
  }

  const topLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang)
    .slice(0, 5);

  const reposWithDescriptionCount = repos.filter(
    (r) => r.description && r.description.trim().length > 0
  ).length;
  const reposWithDescriptionPercentage =
    analyzedReposCount > 0
      ? Math.round((reposWithDescriptionCount / analyzedReposCount) * 100)
      : 0;

  const reposWithLicenseCount = originalRepos.filter((r) => r.license !== null).length;
  const reposWithLicensePercentage =
    originalReposCount > 0
      ? Math.round((reposWithLicenseCount / originalReposCount) * 100)
      : 0;

  const reposWithDemoUrlCount = originalRepos.filter(
    (r) => (r.homepage && r.homepage.trim().length > 0) || r.has_pages
  ).length;
  const reposWithDemoUrlPercentage =
    originalReposCount > 0
      ? Math.round((reposWithDemoUrlCount / originalReposCount) * 100)
      : 0;

  const reposWithTopicsCount = repos.filter((r) => r.topics && r.topics.length > 0).length;

  // Timestamps and activity
  const now = Date.now();
  const pushTimes = repos
    .map((r) => (r.pushed_at ? new Date(r.pushed_at).getTime() : 0))
    .filter((t) => t > 0);
  const mostRecentPush = pushTimes.length > 0 ? Math.max(...pushTimes) : 0;
  const daysSinceLastPush =
    mostRecentPush > 0 ? Math.max(0, Math.floor((now - mostRecentPush) / (1000 * 60 * 60 * 24))) : 999;

  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const recentPushesCount30d = pushTimes.filter((t) => t >= thirtyDaysAgo).length;

  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const staleReposCount = repos.filter((r) => {
    const pushTime = r.pushed_at ? new Date(r.pushed_at).getTime() : 0;
    return pushTime < oneYearAgo;
  }).length;

  const userCreatedTime = new Date(user.created_at).getTime();
  const accountAgeYears = Math.max(0.1, Number(((now - userCreatedTime) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)));

  const createdAtFormatted = new Date(user.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const topStarredRepos = [...repos]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 6);

  return {
    username: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    bio: user.bio,
    company: user.company,
    location: user.location,
    website: user.blog,
    hasBio: Boolean(user.bio && user.bio.trim().length > 0),
    hasLocation: Boolean(user.location && user.location.trim().length > 0),
    hasWebsite: Boolean(user.blog && user.blog.trim().length > 0),
    accountAgeYears,
    createdAtFormatted,
    followersCount: user.followers,
    followingCount: user.following,
    totalPublicRepos: user.public_repos,
    analyzedReposCount,
    originalReposCount,
    forkedReposCount,
    archivedReposCount,
    totalStarsEarned,
    totalForksCount,
    languagesBreakdown,
    topLanguages,
    reposWithDescriptionCount,
    reposWithDescriptionPercentage,
    reposWithLicenseCount,
    reposWithLicensePercentage,
    reposWithDemoUrlCount,
    reposWithDemoUrlPercentage,
    reposWithTopicsCount,
    daysSinceLastPush,
    recentPushesCount30d,
    staleReposCount,
    topStarredRepos,
    allRepos: repos,
  };
}

export function calculateHealthScore(facts: PortfolioFacts): HealthScoreBreakdown {
  // 1. Documentation & Clarity (Max 25)
  let docPoints = 0;
  const docDetails: { name: string; earned: number; max: number; reason: string }[] = [];

  // Description coverage (10 pts)
  let descEarned = 0;
  if (facts.reposWithDescriptionPercentage >= 80) descEarned = 10;
  else if (facts.reposWithDescriptionPercentage >= 50) descEarned = 7;
  else if (facts.reposWithDescriptionPercentage >= 25) descEarned = 4;
  else if (facts.reposWithDescriptionPercentage > 0) descEarned = 2;
  docPoints += descEarned;
  docDetails.push({
    name: 'Repo Descriptions',
    earned: descEarned,
    max: 10,
    reason: `${facts.reposWithDescriptionPercentage}% of repositories have descriptions (${facts.reposWithDescriptionCount}/${facts.analyzedReposCount})`,
  });

  // Topics and discovery tags (5 pts)
  const topicsRatio = facts.analyzedReposCount > 0 ? facts.reposWithTopicsCount / facts.analyzedReposCount : 0;
  let topicsEarned = 0;
  if (topicsRatio >= 0.4) topicsEarned = 5;
  else if (topicsRatio >= 0.15) topicsEarned = 3;
  else if (topicsRatio > 0) topicsEarned = 1;
  docPoints += topicsEarned;
  docDetails.push({
    name: 'Topics & Tags',
    earned: topicsEarned,
    max: 5,
    reason: `${facts.reposWithTopicsCount} repos tagged with GitHub search topics`,
  });

  // Profile completeness (10 pts: Bio 5, Blog 3, Location 2)
  let profileEarned = 0;
  if (facts.hasBio) profileEarned += 5;
  if (facts.hasWebsite) profileEarned += 3;
  if (facts.hasLocation) profileEarned += 2;
  docPoints += profileEarned;
  docDetails.push({
    name: 'Profile Completeness',
    earned: profileEarned,
    max: 10,
    reason: `Bio: ${facts.hasBio ? '✓' : '✗'}, Website/Blog: ${facts.hasWebsite ? '✓' : '✗'}, Location: ${facts.hasLocation ? '✓' : '✗'}`,
  });

  // 2. Originality & Independence (Max 25)
  let origPoints = 0;
  const origDetails: { name: string; earned: number; max: number; reason: string }[] = [];

  // Original vs Fork ratio (15 pts)
  const origRatio = facts.analyzedReposCount > 0 ? facts.originalReposCount / facts.analyzedReposCount : 1;
  const hasRepos = facts.analyzedReposCount > 0;
  let ratioEarned = 0;
  if (!hasRepos) ratioEarned = 0;
  else if (origRatio >= 0.75) ratioEarned = 15;
  else if (origRatio >= 0.5) ratioEarned = 10;
  else if (origRatio >= 0.25) ratioEarned = 5;
  else ratioEarned = 2;
  origPoints += ratioEarned;
  origDetails.push({
    name: 'Non-Fork Repositories Ratio',
    earned: ratioEarned,
    max: 15,
    reason: hasRepos
      ? `${Math.round(origRatio * 100)}% of repos are not forks (${facts.originalReposCount} non-fork vs ${facts.forkedReposCount} forks)`
      : 'No public repositories yet, so there is nothing to assess',
  });

  // Traction & Stars (10 pts)
  let tractionEarned = 0;
  if (facts.totalStarsEarned >= 50) tractionEarned = 10;
  else if (facts.totalStarsEarned >= 15) tractionEarned = 7;
  else if (facts.totalStarsEarned >= 3) tractionEarned = 5;
  else if (facts.totalStarsEarned >= 1) tractionEarned = 3;
  else tractionEarned = 1;
  origPoints += tractionEarned;
  origDetails.push({
    name: 'Community Validation & Stars',
    earned: tractionEarned,
    max: 10,
    reason: `${facts.totalStarsEarned} total stars earned across public projects`,
  });

  // 3. Maintenance & Cadence (Max 25)
  let maintPoints = 0;
  const maintDetails: { name: string; earned: number; max: number; reason: string }[] = [];

  // Push recency (15 pts)
  let recencyEarned = 0;
  if (facts.daysSinceLastPush <= 7) recencyEarned = 15;
  else if (facts.daysSinceLastPush <= 30) recencyEarned = 12;
  else if (facts.daysSinceLastPush <= 90) recencyEarned = 8;
  else if (facts.daysSinceLastPush <= 180) recencyEarned = 4;
  else recencyEarned = 1;
  maintPoints += recencyEarned;
  maintDetails.push({
    name: 'Commit Recency',
    earned: recencyEarned,
    max: 15,
    reason: `Last push was ${facts.daysSinceLastPush === 999 ? 'never detected' : `${facts.daysSinceLastPush} days ago`} (${facts.recentPushesCount30d} repos updated in last 30d)`,
  });

  // Stale project management (10 pts)
  const staleRatio = facts.analyzedReposCount > 0 ? facts.staleReposCount / facts.analyzedReposCount : 0;
  let staleEarned = 0;
  if (!hasRepos) staleEarned = 0;
  else if (staleRatio <= 0.25) staleEarned = 10;
  else if (staleRatio <= 0.5) staleEarned = 7;
  else if (staleRatio <= 0.75) staleEarned = 4;
  else staleEarned = 2;
  maintPoints += staleEarned;
  maintDetails.push({
    name: 'Active vs Stale Ratio',
    earned: staleEarned,
    max: 10,
    reason: hasRepos
      ? `${facts.staleReposCount} of ${facts.analyzedReposCount} repos untouched for > 1 year (${Math.round(staleRatio * 100)}% stale)`
      : 'No public repositories yet, so there is nothing to assess',
  });

  // 4. Professional Hygiene (Max 25)
  let hygienePoints = 0;
  const hygieneDetails: { name: string; earned: number; max: number; reason: string }[] = [];

  // Open-source licenses (12 pts)
  let licenseEarned = 0;
  if (facts.reposWithLicensePercentage >= 70) licenseEarned = 12;
  else if (facts.reposWithLicensePercentage >= 40) licenseEarned = 8;
  else if (facts.reposWithLicensePercentage >= 15) licenseEarned = 4;
  else licenseEarned = 1;
  hygienePoints += licenseEarned;
  hygieneDetails.push({
    name: 'Open-Source Licenses',
    earned: licenseEarned,
    max: 12,
    reason: `${facts.reposWithLicensePercentage}% of original repos have an SPDX license (${facts.reposWithLicenseCount}/${Math.max(1, facts.originalReposCount)})`,
  });

  // Live demos & deployments (13 pts)
  let demoEarned = 0;
  if (facts.reposWithDemoUrlPercentage >= 40) demoEarned = 13;
  else if (facts.reposWithDemoUrlPercentage >= 20) demoEarned = 9;
  else if (facts.reposWithDemoUrlCount >= 1) demoEarned = 5;
  else demoEarned = 1;
  hygienePoints += demoEarned;
  hygieneDetails.push({
    name: 'Live Demo Previews',
    earned: demoEarned,
    max: 13,
    reason: `${facts.reposWithDemoUrlCount} projects have live URLs or GitHub Pages (${facts.reposWithDemoUrlPercentage}%)`,
  });

  const totalScore = Math.min(100, Math.max(0, docPoints + origPoints + maintPoints + hygienePoints));

  let grade: HealthScoreBreakdown['grade'] = 'F';
  let gradeColor = 'text-rose-500';

  if (totalScore >= 92) {
    grade = 'A+';
    gradeColor = 'text-emerald-400';
  } else if (totalScore >= 82) {
    grade = 'A';
    gradeColor = 'text-emerald-400';
  } else if (totalScore >= 74) {
    grade = 'B+';
    gradeColor = 'text-cyan-400';
  } else if (totalScore >= 66) {
    grade = 'B';
    gradeColor = 'text-cyan-400';
  } else if (totalScore >= 56) {
    grade = 'C+';
    gradeColor = 'text-amber-400';
  } else if (totalScore >= 48) {
    grade = 'C';
    gradeColor = 'text-amber-400';
  } else if (totalScore >= 38) {
    grade = 'D';
    gradeColor = 'text-orange-400';
  } else {
    grade = 'F';
    gradeColor = 'text-rose-500';
  }

  let summary = '';
  if (totalScore >= 80) {
    summary = 'Strong on every measured signal: descriptions, licenses, live links and recent activity.';
  } else if (totalScore >= 65) {
    summary = 'Solid foundation with clear strengths, but needs key documentation and demo links to maximize recruiter interest.';
  } else if (totalScore >= 45) {
    summary = 'Moderate health. Good raw coding activity, but held back by unorganized repositories, missing descriptions, and lack of live previews.';
  } else {
    summary = 'High friction for recruiters. Repositories lack context, licenses, and recent commits. Urgent cleanup recommended.';
  }

  return {
    totalScore,
    grade,
    gradeColor,
    summary,
    documentation: {
      score: docPoints,
      maxScore: 25,
      label: 'Documentation & Clarity',
      explanation: 'Evaluates descriptions, topics, and profile completeness.',
      details: docDetails,
    },
    originality: {
      score: origPoints,
      maxScore: 25,
      label: 'Own Work & Traction',
      explanation: 'Share of repositories that are not forks, and stars received. Does not judge whether code is original.',
      details: origDetails,
    },
    maintenance: {
      score: maintPoints,
      maxScore: 25,
      label: 'Maintenance & Cadence',
      explanation: 'Measures recent push activity and ratio of active to stale repos.',
      details: maintDetails,
    },
    hygiene: {
      score: hygienePoints,
      maxScore: 25,
      label: 'Professional Hygiene',
      explanation: 'Assesses open-source licenses, live preview links, and polish.',
      details: hygieneDetails,
    },
  };
}

export function determineRecruiterImpression(facts: PortfolioFacts): RecruiterImpression {
  const origRatio = facts.analyzedReposCount > 0 ? facts.originalReposCount / facts.analyzedReposCount : 1;
  const langCount = Object.keys(facts.languagesBreakdown).length;

  let archetype = 'The Emerging Full-Stack Builder';
  let archetypeBadge = 'Builder';
  let archetypeDescription = 'Shows a diverse mix of learning experiments and working repositories.';
  let firstImpressionQuote = 'Looks like a developer who writes code consistently, but could present their best work with greater intention.';

  const isEmptyProfile = facts.analyzedReposCount === 0;

  if (isEmptyProfile) {
    archetype = 'The Blank Slate';
    archetypeBadge = 'Getting Started';
    archetypeDescription = 'There are no public repositories yet, so a reviewer has nothing to evaluate.';
    firstImpressionQuote = 'I cannot tell what this person builds yet. One finished, documented project would change that.';
  } else if (origRatio < 0.4 && facts.forkedReposCount >= 5) {
    archetype = 'The Fork Collector / Tutorial Hoarder';
    archetypeBadge = 'Tutorial Collector';
    archetypeDescription = 'Portfolio is overwhelmed by forks and walkthrough starters with little visible independent architecture.';
    firstImpressionQuote = 'I see plenty of repositories, but I struggle to separate what they coded from what was cloned from a bootcamp video.';
  } else if (facts.daysSinceLastPush > 180 && facts.accountAgeYears >= 2) {
    archetype = 'The Dormant Veteran (Ghost Mode)';
    archetypeBadge = 'Dormant';
    archetypeDescription = 'Established profile with solid history, but public activity has flatlined for months.';
    firstImpressionQuote = 'They probably have real skills, but their public GitHub looks abandoned. Are they currently coding?';
  } else if (langCount >= 7 && facts.analyzedReposCount >= 10 && facts.reposWithDemoUrlCount <= 1) {
    archetype = 'The Tech Tourist / Framework Hopper';
    archetypeBadge = 'Framework Hopper';
    archetypeDescription = 'Jumping between different languages and stacks without taking projects across the deployment finish line.';
    firstImpressionQuote = 'Curious mind, but lacks depth in a single core stack. Lots of exploratory hello-worlds with zero live demos.';
  } else if (facts.totalStarsEarned >= 200 && origRatio >= 0.7 && facts.reposWithLicensePercentage >= 60) {
    archetype = 'The Open Source Trailblazer';
    archetypeBadge = 'OSS Leader';
    archetypeDescription = 'Many stars, mostly non-fork repositories and consistent licensing: the public signals reviewers look for first.';
    firstImpressionQuote = 'This profile gets a closer look: other people clearly use this work, and it is presented with care.';
  } else if (facts.reposWithDemoUrlCount >= 2 && ['TypeScript', 'JavaScript'].some((l) => facts.topLanguages.includes(l))) {
    archetype = 'The Product Crafter';
    archetypeBadge = 'Product Focused';
    archetypeDescription = 'Focuses on building clickable, usable applications with visible live previews.';
    firstImpressionQuote = 'Terrific signal! I can click and test what they built right away without cloning anything.';
  }

  // Recruiter signals
  let hireabilitySignal: RecruiterImpression['hireabilitySignal'] = 'Promising';
  let hireabilityBadgeColor = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
  let hireabilityReason = 'Clear engineering potential with minor presentation gaps.';

  if (isEmptyProfile) {
    hireabilitySignal = 'Needs Overhaul';
    hireabilityBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    hireabilityReason = 'There is no public work to review yet.';
  } else if (facts.totalStarsEarned >= 50 && facts.daysSinceLastPush <= 30 && facts.reposWithDemoUrlCount >= 2) {
    hireabilitySignal = 'Strong';
    hireabilityBadgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    hireabilityReason = 'Recent activity, starred non-fork repositories and live demo links.';
  } else if (facts.daysSinceLastPush > 180 && facts.reposWithDescriptionPercentage < 30) {
    hireabilitySignal = 'Needs Overhaul';
    hireabilityBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    hireabilityReason = 'High barrier to entry for recruiters due to stale activity and undocumented mystery repositories.';
  } else if (origRatio < 0.35 || facts.daysSinceLastPush > 90) {
    hireabilitySignal = 'Caution';
    hireabilityBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    hireabilityReason = 'Mostly forked repositories, or a long gap since the last public push.';
  }

  // Green Flags & Red Flags
  const greenFlags: RecruiterImpression['greenFlags'] = [];
  const redFlags: RecruiterImpression['redFlags'] = [];

  if (facts.hasBio && facts.bio) {
    greenFlags.push({
      title: 'Professional Profile Bio',
      evidence: `Bio is populated: "${facts.bio.slice(0, 60)}${facts.bio.length > 60 ? '...' : ''}"`,
      impact: 'positive',
    });
  } else {
    redFlags.push({
      title: 'Missing Bio / Target Role',
      evidence: 'Profile bio is blank. Recruiters cannot tell your target role or seniority at a glance.',
      impact: 'warning',
    });
  }

  if (facts.hasWebsite) {
    greenFlags.push({
      title: 'Linked Portfolio / Socials',
      evidence: `External link provided: ${facts.bio ? 'portfolio/blog link' : 'website'}.`,
      impact: 'positive',
    });
  }

  if (isEmptyProfile) {
    redFlags.push({
      title: 'No Public Repositories',
      evidence: 'The profile has 0 public repositories, so there is no code, README or demo to look at.',
      impact: 'critical',
    });
  } else if (facts.daysSinceLastPush <= 14) {
    greenFlags.push({
      title: 'Active Coding Cadence',
      evidence: `Pushed code ${facts.daysSinceLastPush} days ago. Demonstrates current engagement.`,
      impact: 'positive',
    });
  } else if (facts.daysSinceLastPush > 90) {
    redFlags.push({
      title: 'Dormant Commit Activity',
      evidence: `No public push in ${facts.daysSinceLastPush} days. Gives impression of an inactive developer.`,
      impact: 'warning',
    });
  }

  if (facts.reposWithDemoUrlCount > 0) {
    greenFlags.push({
      title: 'Deployed Live Applications',
      evidence: `${facts.reposWithDemoUrlCount} project(s) provide a live demo or GitHub Pages link.`,
      impact: 'positive',
    });
  } else if (facts.originalReposCount > 0) {
    redFlags.push({
      title: 'Zero Live Deployments',
      evidence: `0 out of ${facts.originalReposCount} original repos have a demo URL. Recruiters rarely clone code locally.`,
      impact: 'critical',
    });
  }

  if (isEmptyProfile) {
    // Nothing to document yet: neither a strength nor a gap
  } else if (facts.reposWithDescriptionPercentage < 50) {
    redFlags.push({
      title: 'Undocumented Repositories',
      evidence: `${facts.analyzedReposCount - facts.reposWithDescriptionCount} out of ${facts.analyzedReposCount} repos lack a 1-sentence description.`,
      impact: 'critical',
    });
  } else {
    greenFlags.push({
      title: 'Descriptive Repository Naming',
      evidence: `${facts.reposWithDescriptionPercentage}% of repositories have helpful summary descriptions.`,
      impact: 'positive',
    });
  }

  if (origRatio < 0.5 && facts.analyzedReposCount >= 5) {
    redFlags.push({
      title: 'Excessive Fork Clutter',
      evidence: `${facts.forkedReposCount} out of ${facts.analyzedReposCount} repositories (${Math.round((1 - origRatio) * 100)}%) are forks.`,
      impact: 'warning',
    });
  }

  if (facts.reposWithLicensePercentage === 0 && facts.originalReposCount >= 3) {
    redFlags.push({
      title: 'Missing Open-Source Licenses',
      evidence: `None of the ${facts.originalReposCount} original repositories have a LICENSE file.`,
      impact: 'warning',
    });
  }

  const tenSecondVerdict = isEmptyProfile
    ? 'A recruiter has nothing to look at yet and will move on. One finished, documented project changes that.'
    : hireabilitySignal === 'Strong'
      ? 'A recruiter will immediately see active, starred projects with live demos to click. Code quality itself is not assessed here.'
      : hireabilitySignal === 'Promising'
      ? 'A recruiter will see genuine engineering capability, but might hesitate to click deeper without live demos and concise descriptions.'
      : 'A recruiter is likely to move on to the next candidate because the portfolio requires too much detective work to evaluate.';

  return {
    archetype,
    archetypeBadge,
    archetypeDescription,
    tenSecondVerdict,
    hireabilitySignal,
    hireabilityBadgeColor,
    hireabilityReason,
    greenFlags,
    redFlags,
    firstImpressionQuote,
  };
}

export function generateEvidenceBasedRoasts(facts: PortfolioFacts): RoastItem[] {
  const roasts: RoastItem[] = [];

  // An empty profile: one gentle, truthful roast. None of the repository-based ones apply.
  if (facts.analyzedReposCount === 0) {
    roasts.push({
      id: 'roast-empty',
      title: 'The Blank Canvas',
      category: 'repo-hygiene',
      severity: 'mild',
      evidence: '0 public repositories on the profile',
      roast: `Your GitHub is so clean it squeaks. Minimalism is a fine design philosophy, but reviewers were hoping for at least one thing to click on. The upside: with nothing to tidy up, your first project is automatically your best one.`,
    });
    if (!facts.hasBio && !facts.hasWebsite) {
      roasts.push({
        id: 'roast-bio',
        title: 'The Phantom Developer',
        category: 'social-presence',
        severity: 'medium',
        evidence: `Bio is empty, Website is empty${facts.hasLocation ? '' : ', Location is empty'}`,
        roast: `No repositories and no bio: your profile is giving "account created during a fire drill". Two sentences about what you want to build would already make it feel like a person lives here.`,
      });
    }
    return roasts;
  }

  // 1. Description roast
  if (facts.reposWithDescriptionPercentage < 60) {
    const missing = facts.analyzedReposCount - facts.reposWithDescriptionCount;
    roasts.push({
      id: 'roast-descriptions',
      title: 'The Mystery Box Collection',
      category: 'repo-hygiene',
      severity: 'spicy',
      evidence: `${missing} out of ${facts.analyzedReposCount} repositories have empty descriptions (${facts.reposWithDescriptionPercentage}% filled)`,
      roast: `You treat your repository list like an escape room where recruiters have to decipher what each repo does from the name alone. Is 'final-proj-v2' an AI drone controller or a 2-hour homework assignment? The world will never know.`,
    });
  } else {
    roasts.push({
      id: 'roast-descriptions-mild',
      title: 'The Modest Explainer',
      category: 'repo-hygiene',
      severity: 'mild',
      evidence: `${facts.reposWithDescriptionPercentage}% description coverage across ${facts.analyzedReposCount} repos`,
      roast:
        facts.reposWithDescriptionCount < facts.analyzedReposCount
          ? `You actually write descriptions, which is more than a lot of profiles manage. The other ${facts.analyzedReposCount - facts.reposWithDescriptionCount} ${facts.analyzedReposCount - facts.reposWithDescriptionCount === 1 ? 'repository is' : 'repositories are'} still sitting there like a book with a blank cover.`
          : `Every single repository has a description. Suspiciously organised. We checked twice for a catch and came back empty-handed.`,
    });
  }

  // 2. Forks roast
  if (facts.forkedReposCount >= 4 && facts.forkedReposCount > facts.originalReposCount) {
    roasts.push({
      id: 'roast-forks',
      title: 'The GitHub Bookmark Hoarder',
      category: 'stack-identity',
      severity: 'spicy',
      evidence: `${facts.forkedReposCount} out of ${facts.analyzedReposCount} repositories are forks (${Math.round((facts.forkedReposCount / Math.max(1, facts.analyzedReposCount)) * 100)}% forks)`,
      roast: `Your GitHub profile looks less like an engineering workshop and more like a browser bookmark folder that accidentally became public. Forking a repo is not a co-authorship agreement!`,
    });
  } else if (facts.forkedReposCount > 0) {
    roasts.push({
      id: 'roast-forks-mild',
      title: 'The Accidental Collector',
      category: 'stack-identity',
      severity: 'mild',
      evidence: `${facts.forkedReposCount} forked repos sitting alongside ${facts.originalReposCount} original repos`,
      roast: `You have a few forks sitting around like old gym memberships you forgot to cancel. Archive them or turn them into real pull requests!`,
    });
  }

  // 3. Stale activity / push recency
  if (facts.daysSinceLastPush > 120) {
    roasts.push({
      id: 'roast-recency',
      title: 'Carbon-Dating Required',
      category: 'commit-habits',
      severity: 'spicy',
      evidence: `Last public push was ${facts.daysSinceLastPush} days ago`,
      roast: `Your GitHub contribution graph looks like a deserted highway at 4 AM. Archaeologists are currently assembling an expedition to verify if your git credentials still function.`,
    });
  } else if (facts.daysSinceLastPush <= 3) {
    roasts.push({
      id: 'roast-recency-fresh',
      title: 'Terminal Still Warm',
      category: 'commit-habits',
      severity: 'mild',
      evidence: `Last push was ${facts.daysSinceLastPush === 0 ? 'today' : `${facts.daysSinceLastPush} day(s) ago`}`,
      roast: `Look at you pushing code recently! We can smell the coffee from here. Just make sure the commits aren't all titled 'fixed typo', 'wip', and 'pls work'.`,
    });
  } else {
    roasts.push({
      id: 'roast-recency-medium',
      title: 'The Weekend Warrior',
      category: 'commit-habits',
      severity: 'medium',
      evidence: `Last push was ${facts.daysSinceLastPush} days ago (${facts.recentPushesCount30d} repos pushed in past month)`,
      roast: `You commit in bursts like a solar flare, followed by weeks of absolute silence while bingeing sci-fi shows. Consistency beats heroic weekend sprints!`,
    });
  }

  // 4. Demo URLs / Live links
  if (facts.reposWithDemoUrlCount === 0 && facts.originalReposCount > 0) {
    roasts.push({
      id: 'roast-demos',
      title: 'The "Trust Me Bro, It Compiles" Defense',
      category: 'repo-hygiene',
      severity: 'spicy',
      evidence: `0 live demo URLs across all ${facts.originalReposCount} original repositories`,
      roast: `Expecting a tech recruiter to clone your repository, install node modules, configure local environment variables, and debug your node version just to see a button is peak optimism. Deploy to Vercel or Netlify—it only takes a few minutes!`,
    });
  }

  // 5. Licenses
  if (facts.reposWithLicensePercentage === 0 && facts.originalReposCount >= 2) {
    roasts.push({
      id: 'roast-licenses',
      title: 'The Legal Wild West',
      category: 'repo-hygiene',
      severity: 'medium',
      evidence: `0 out of ${facts.originalReposCount} original repositories have a LICENSE file`,
      roast: `Technically, without an open-source license, nobody has legal permission to use, fork, or study your code. Are you protecting trade secrets for a secret Mars colony, or did you just forget the MIT license toggle?`,
    });
  }

  // 6. Language hop
  const langCount = Object.keys(facts.languagesBreakdown).length;
  if (langCount >= 6 && facts.analyzedReposCount >= 8) {
    roasts.push({
      id: 'roast-languages',
      title: 'The All-You-Can-Eat Buffet Hacker',
      category: 'stack-identity',
      severity: 'medium',
      evidence: `${langCount} distinct programming languages detected across ${facts.analyzedReposCount} repos (${facts.topLanguages.join(', ')})`,
      roast: `You have sampled every single programming language on Hacker News like free samples at Costco. Pick two and build something that doesn't terminate at 'Hello World'!`,
    });
  }

  // 7. Bio & Social presence
  if (!facts.hasBio && !facts.hasWebsite) {
    roasts.push({
      id: 'roast-bio',
      title: 'The Phantom Developer',
      category: 'social-presence',
      severity: 'medium',
      evidence: `Bio is empty, Website is empty${facts.hasLocation ? '' : ', Location is empty'}`,
      roast: `Your GitHub profile is so anonymous you could apply for witness protection. Recruiters don't know your name, your favorite stack, or how to email you an offer letter.`,
    });
  }

  return roasts;
}

export function filterRoastsByTone(roasts: RoastItem[], tone: RoastTone): RoastItem[] {
  if (tone === 'mild') {
    return roasts.filter((r) => r.severity === 'mild' || r.severity === 'medium');
  }
  if (tone === 'medium') {
    return roasts;
  }
  // spicy
  return roasts;
}

export function generatePersonalizedRoadmap(facts: PortfolioFacts): RoadmapActionItem[] {
  const items: RoadmapActionItem[] = [];
  const isEmptyProfile = facts.analyzedReposCount === 0;

  // 0. Nothing published yet: the first project comes before everything else
  if (isEmptyProfile) {
    items.push({
      id: 'action-first-project',
      title: 'Publish Your First Project',
      description: 'Pick one small thing you have built or are building (a class assignment, a script, a tiny website) and put it on GitHub. Finished and small beats ambitious and missing.',
      priority: 'critical',
      effort: 'Weekend project',
      impactScore: 10,
      category: 'Showcase',
      evidence: 'The profile has 0 public repositories.',
      actionStep: `On GitHub click "New repository", name it after what it does, tick "Add a README file", then upload or push your code and write three lines in the README: what it is, how to run it, what you learned.`,
    });
  }

  // 1. Descriptions
  if (!isEmptyProfile && facts.reposWithDescriptionPercentage < 80) {
    items.push({
      evidence: `${facts.analyzedReposCount - facts.reposWithDescriptionCount} of ${facts.analyzedReposCount} repositories have no description (${facts.reposWithDescriptionPercentage}% have one).`,
      id: 'action-descriptions',
      title: 'Add 1-Sentence Descriptions to Top Repositories',
      description: `Immediately update the 'About' section on your top repositories. State the problem solved and the primary stack.`,
      priority: 'critical',
      effort: '< 15 mins',
      impactScore: 9,
      category: 'Quick Fix',
      actionStep: `Go to your top 3 repos -> click the gear icon on the right side of the repo header -> add a clear description and 3-5 relevant topics (e.g., 'react', 'typescript', 'tailwind').`,
      templateSnippet: {
        filename: 'Repository About Formula',
        content: `A [adjective] [type of application] built with [Tech A] and [Tech B] that [solves specific user pain point]. Example: "A blazing fast Markdown note editor built with React, Vite, and IndexedDB with offline sync."`,
      },
    });
  }

  // 2. Live Demos
  if (facts.reposWithDemoUrlCount === 0 && facts.originalReposCount > 0) {
    items.push({
      evidence: `0 of ${facts.originalReposCount} original repositories have a live demo or website link.`,
      id: 'action-deploy-demo',
      title: 'Deploy Free Live Previews on Vercel or GitHub Pages',
      description: 'Reviewers skim profiles quickly. Give them a clickable live product immediately.',
      priority: 'critical',
      effort: '1-2 hours',
      impactScore: 10,
      category: 'Showcase',
      actionStep: `Connect your best project repository to Vercel (vercel.com) or Netlify, deploy with default build settings, and paste the URL into your GitHub repository homepage field.`,
    });
  }

  // 3. License Coverage
  if (facts.reposWithLicensePercentage < 50 && facts.originalReposCount > 0) {
    items.push({
      evidence: `${facts.reposWithLicenseCount} of ${facts.originalReposCount} original repositories have a license (${facts.reposWithLicensePercentage}%).`,
      id: 'action-add-license',
      title: 'Add MIT Open-Source Licenses',
      description: 'Give recruiters and collaborators clear legal permission to clone and run your public projects.',
      priority: 'high',
      effort: '< 15 mins',
      impactScore: 7,
      category: 'Quick Fix',
      actionStep: `In GitHub: Add file -> Create new file -> Type "LICENSE" -> Click the "Choose a license template" button -> Select MIT License -> Commit directly to main branch.`,
      templateSnippet: {
        filename: 'LICENSE',
        content: `MIT License

Copyright (c) ${new Date().getFullYear()} ${facts.name || facts.username}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.`,
      },
    });
  }

  // 4. Profile README
  const hasProfileRepo = facts.allRepos.some((r) => r.name.toLowerCase() === facts.username.toLowerCase());
  items.push({
    evidence: hasProfileRepo
      ? `A repository named "${facts.username}" exists. Its README was not read, so check that it introduces you and your best work.`
      : `No repository named "${facts.username}" was found among the ${facts.analyzedReposCount} analysed repositories, so the profile page shows no introduction.`,
    id: 'action-profile-readme',
    title: 'Create or Upgrade Profile README (`username/username`)',
    description: 'Transform your GitHub landing page into an interactive developer resume highlighting your best 2-3 projects and core strengths.',
    priority: facts.hasBio ? 'medium' : 'high',
    effort: '1-2 hours',
    impactScore: 8,
    category: 'Showcase',
    actionStep: `Create a public repository named exactly "${facts.username}" with a README.md file at root. GitHub will automatically render it as your profile banner.`,
    templateSnippet: {
      filename: 'README.md',
      content: `### Hi there, I'm ${facts.name || facts.username} 👋

🔭 Currently working on: Full-stack web applications with modern TypeScript & React
🌱 Currently learning: System design, cloud architecture, and testing
⚡ Core Stack: ${facts.topLanguages.slice(0, 3).join(', ') || 'TypeScript, React, Node.js'}

#### 🚀 Featured Projects
- **[Top Project Name](https://github.com/${facts.username})** - Description of the project, impact, and live demo link.
- **[Second Project Name](https://github.com/${facts.username})** - High-performance tool solving real developer problems.

📫 Reach me: [LinkedIn](https://linkedin.com) | [Portfolio](${facts.hasWebsite ? facts.profileUrl : 'https://yourwebsite.com'})`,
    },
  });

  // 5. Clean up forks & inactive repos
  if (facts.forkedReposCount >= 5) {
    items.push({
      evidence: `${facts.forkedReposCount} of ${facts.analyzedReposCount} repositories are forks.`,
      id: 'action-prune-forks',
      title: 'Pin Your Own Projects Above Forks',
      description: 'Make sure visitors see the repositories you started yourself before the ones you forked.',
      priority: 'high',
      effort: '< 15 mins',
      impactScore: 8,
      category: 'Credibility',
      actionStep: `Go to your profile -> Click 'Customize your pins' -> Explicitly pin your 4-6 best non-fork repositories so forks don't dominate your landing page.`,
    });
  }

  // 6. Cadence refresh
  if (!isEmptyProfile && facts.daysSinceLastPush > 45 && facts.daysSinceLastPush !== 999) {
    items.push({
      evidence: `The most recent public push was ${facts.daysSinceLastPush} days ago.`,
      id: 'action-push-momentum',
      title: 'Ignite Fresh Commit Momentum',
      description: 'Your contribution graph shows a quiet spell. Push a meaningful feature or refactor this week.',
      priority: 'high',
      effort: 'Weekend project',
      impactScore: 8,
      category: 'Credibility',
      actionStep: `Pick your favorite repo, open an issue for a feature or test suite, create a branch, write the code, and merge a pull request.`,
    });
  }

  return items;
}

export function analyzePortfolio(
  user: GitHubUser,
  repos: GitHubRepo[],
  events: GitHubEvent[] = [],
  isMockData = false
): PortfolioReport {
  const facts = extractPortfolioFacts(user, repos, events);
  const scoring = calculateHealthScore(facts);
  const recruiter = determineRecruiterImpression(facts);
  const roasts = generateEvidenceBasedRoasts(facts);
  const roadmap = generatePersonalizedRoadmap(facts);

  return {
    facts,
    scoring,
    recruiter,
    roasts,
    roadmap,
    analyzedAt: new Date().toISOString(),
    isMockData,
  };
}

const PRIORITY_RANK: Record<RoadmapActionItem['priority'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The few actions to start with: most urgent first, then highest impact, keeping the roadmap's
 * own order for ties. Pure and deterministic.
 */
export function selectTopRescuePriorities(roadmap: RoadmapActionItem[], count = 3): RoadmapActionItem[] {
  return roadmap
    .map((item, index) => ({ item, index }))
    .sort((a, b) => PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority] || b.item.impactScore - a.item.impactScore || a.index - b.index)
    .slice(0, Math.max(0, count))
    .map(({ item }) => item);
}

