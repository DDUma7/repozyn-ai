import type { GitHubRepo } from '../types/github';
import type { NotInspectedReason, PortfolioEvidence, RepoInspection, RepoTreeResult } from '../types/evidence';
import { INSPECTION_LIMITS, inspectRepoTree, notInspected, selectReposForInspection, summarizeEvidence } from './inspection';

export type RepoTreeFetcher = (owner: string, repo: string, defaultBranch: string) => Promise<RepoTreeResult>;

export interface InspectPortfolioOptions {
  fetchTree: RepoTreeFetcher;
  /** Repositories to inspect; never above INSPECTION_LIMITS.maxRepos */
  maxRepos?: number;
  /** Simultaneous requests; 1 to 3 */
  concurrency?: number;
  /** Lets the caller abandon the run, for example when another profile is selected */
  isCancelled?: () => boolean;
}

const MAX_CONCURRENCY = 3;

/** Evidence for a profile that must not trigger any network request (demo personas, or no quota) */
export function buildUninspectedEvidence(
  repos: GitHubRepo[],
  reason: Extract<NotInspectedReason, 'demo_data' | 'rate_limited'>
): PortfolioEvidence {
  const { selected, skipped, eligibleCount } = selectReposForInspection(repos);
  const inspections = [
    ...selected.map((repo) => notInspected(repo, reason)),
    ...skipped.map(({ repo, reason: skipReason }) => notInspected(repo, skipReason)),
  ];
  return summarizeEvidence(inspections, eligibleCount, selected.length, reason === 'demo_data' ? 'sample' : 'github');
}

/**
 * Inspects a bounded number of repositories with bounded concurrency. One request per selected
 * repository at most; as soon as GitHub reports a rate limit, no further requests are started.
 */
export async function inspectPortfolio(owner: string, repos: GitHubRepo[], options: InspectPortfolioOptions): Promise<PortfolioEvidence> {
  const { selected, skipped, eligibleCount } = selectReposForInspection(repos, options.maxRepos ?? INSPECTION_LIMITS.maxRepos);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, MAX_CONCURRENCY));
  const results: RepoInspection[] = new Array(selected.length);

  let next = 0;
  let rateLimited = false;

  const worker = async () => {
    while (next < selected.length) {
      const index = next++;
      const repo = selected[index];

      if (rateLimited || options.isCancelled?.()) {
        results[index] = notInspected(repo, rateLimited ? 'rate_limited' : 'error');
        continue;
      }

      let outcome: RepoTreeResult;
      try {
        outcome = await options.fetchTree(owner, repo.name, repo.default_branch);
      } catch {
        outcome = { ok: false, reason: 'error' };
      }

      if (outcome.ok) {
        results[index] = inspectRepoTree(repo, outcome.tree);
      } else {
        if (outcome.reason === 'rate_limited') rateLimited = true;
        results[index] = notInspected(repo, outcome.reason);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));

  const inspections = [...results, ...skipped.map(({ repo, reason }) => notInspected(repo, reason))];
  return summarizeEvidence(inspections, eligibleCount, selected.length);
}

/**
 * Builds evidence for a demo persona from synthetic file listings shipped with the app.
 * No network request is made and the result is marked as sample data.
 */
export function inspectSampleListings(repos: GitHubRepo[], listings: Record<string, string[]>): PortfolioEvidence {
  const { selected, skipped, eligibleCount } = selectReposForInspection(repos);
  const inspections = [
    ...selected.map((repo) => {
      const paths = listings[repo.name];
      if (!paths) return notInspected(repo, 'demo_data');
      return inspectRepoTree(repo, {
        truncated: false,
        entries: paths.map((entry) => {
          const [path, size] = entry.split('|');
          return { path, type: 'blob' as const, size: size ? Number(size) : 200 };
        }),
      });
    }),
    ...skipped.map(({ repo, reason }) => notInspected(repo, reason)),
  ];
  return summarizeEvidence(inspections, eligibleCount, selected.length, 'sample');
}
