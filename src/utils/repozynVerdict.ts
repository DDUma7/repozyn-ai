import type { PortfolioFacts } from '../types/analysis';
import type { GitHubRepo } from '../types/github';

export interface RepozynVerdictData {
  overview: string;
  scope: string;
  strength?: string;
  weakness: string;
  observedWeakness: boolean;
  nextAction: string;
}

// Missing, malformed and contradictory counts stay unknown, rather than becoming zero.
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}

/** A presentation summary of existing audit facts; never scores or inspects repositories. */
export function buildRepozynVerdict(facts: Partial<PortfolioFacts>, isMockData = false): RepozynVerdictData {
  const declared = count(facts.analyzedReposCount);
  const listed = Array.isArray(facts.allRepos) ? facts.allRepos.length : null;
  const analysed = declared !== null && listed !== null && declared !== listed ? null : declared ?? listed;
  const publicCount = count(facts.totalPublicRepos);
  const total = publicCount !== null && (analysed === null || publicCount >= analysed) ? publicCount : null;
  const sampled = analysed !== null && total !== null && total > analysed;
  const source = isMockData ? 'Demo persona · synthetic sample metadata' : 'Public GitHub metadata';
  const scope = analysed === null
    ? `${source} · repository coverage unknown`
    : sampled
      ? `${source} · ${analysed} of ${total} repositories analysed; this verdict covers only that sample`
      : total === null
        ? `${source} · ${analysed} repositories analysed; total public repository count unknown`
        : `${source} · ${analysed} public ${analysed === 1 ? 'repository' : 'repositories'} analysed`;

  if (analysed === null || (analysed === 0 && total !== 0)) {
    return {
      overview: 'There is not enough repository data here for a fair first impression. Check the audit data before deciding what to change.',
      scope,
      weakness: 'Repository coverage is missing or inconsistent; that does not establish that your profile is empty.',
      observedWeakness: false,
      nextAction: 'Retry the audit to load your public repositories before choosing a project to improve.',
    };
  }

  const bioKnown = facts.bio === null || typeof facts.bio === 'string';
  const hasBio = typeof facts.bio === 'string' && facts.bio.trim().length > 0;
  const originals = count(facts.originalReposCount, analysed);
  const descriptions = count(facts.reposWithDescriptionCount, analysed);
  const demos = originals === null ? null : count(facts.reposWithDemoUrlCount, originals);
  const strength = demos !== null && demos > 0
    ? `${demos} of ${originals} non-fork repositories list a demo or website link.`
    : descriptions !== null && descriptions > 0
      ? `${descriptions} of ${analysed} analysed repositories include a description.`
      : hasBio ? 'Your profile includes a bio.' : undefined;

  if (analysed === 0) {
    return {
      overview: 'Your profile is a starting point, and that is okay. One small, clearly explained project can give a reviewer somewhere to begin.',
      scope,
      strength,
      weakness: 'The audit reports 0 public repositories, so there is no public project to review yet.',
      observedWeakness: true,
      nextAction: 'Publish one small project with a README explaining what it does and how to run it.',
    };
  }

  let weakness = 'This verdict uses metadata only; it cannot confirm code quality or whether listed links work.';
  let nextAction = 'Review the README of the project you want to showcase and check that its purpose and setup are clear.';
  let observedWeakness = false;

  if (bioKnown && !hasBio) {
    weakness = 'Your profile bio is empty, so a reviewer has no introduction to your work.';
    nextAction = 'Add a one-line bio naming what you build and the role you are working toward.';
    observedWeakness = true;
  } else if (descriptions !== null && descriptions < analysed) {
    weakness = `${analysed - descriptions} of ${analysed} analysed repositories have no description.`;
    nextAction = 'Add a short description to one project you want a reviewer to open first.';
    observedWeakness = true;
  } else if (originals !== null && originals > 0 && demos === 0) {
    weakness = `None of the ${originals} analysed non-fork repositories list a demo or website link.`;
    nextAction = 'Add a demo or documentation link to the project that best represents your work.';
    observedWeakness = true;
  } else if (descriptions === null || originals === null || demos === null) {
    weakness = 'Description or preview-link coverage is unknown, so presentation gaps cannot be assessed reliably.';
  }

  return {
    overview: sampled
      ? `We looked at ${analysed} of your ${total} public repositories in this audit. Make each project's purpose easy to spot, then guide a reviewer to the work you want them to explore.`
      : `We looked at ${analysed} ${analysed === 1 ? 'repository' : 'repositories'} in this audit. Make each project's purpose easy to spot, then guide a reviewer to the work you want them to explore.`,
    scope,
    strength,
    weakness,
    observedWeakness,
    nextAction,
  };
}

export interface RepositoryRecommendation {
  label: 'Showcase candidate' | 'Improve first';
  reason: string;
}

/** Candidates are metadata hints, not proof of quality; repository age is deliberately unused. */
export function recommendRepository(repo: Partial<GitHubRepo>): RepositoryRecommendation | null {
  if (repo.fork !== false || repo.archived !== false || repo.disabled !== false || typeof repo.size !== 'number' || !Number.isFinite(repo.size) || repo.size <= 0) return null;
  if (repo.description === null || (typeof repo.description === 'string' && !repo.description.trim())) {
    return { label: 'Improve first', reason: 'This non-fork repository has no description. Start by explaining its purpose.' };
  }
  let hasWebsiteLink = false;
  if (typeof repo.homepage === 'string' && repo.homepage.trim()) {
    try {
      hasWebsiteLink = ['https:', 'http:'].includes(new URL(repo.homepage.trim()).protocol);
    } catch {
      // An invalid or absent link is not evidence of a showcase candidate.
    }
  }
  if (typeof repo.description === 'string' && repo.description.trim() && (hasWebsiteLink || repo.has_pages === true)) {
    return { label: 'Showcase candidate', reason: 'Non-fork repository with a description and a website link or GitHub Pages flag. Code and link availability are not verified.' };
  }
  return null;
}
