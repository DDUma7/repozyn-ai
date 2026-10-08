import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Microscope, Loader2, AlertTriangle, Clock, FileSearch, FileText, Sparkles, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import type { GitHubRepo, RateLimitInfo } from '../types/github';
import {
  EVIDENCE_CATEGORIES,
  type CriterionStatus,
  type EvidenceCategory,
  type EvidenceStatus,
  type NotInspectedReason,
  type PortfolioEvidence,
  type ReadmeDimensionStatus,
  type ReadmeNotAnalyzedReason,
  type ReadmeReport,
  type RoleId,
  README_DIMENSIONS,
} from '../types/evidence';
import { fetchReadmeContent, fetchRepoTree, isValidBranchName } from '../services/github';
import { selectReposForInspection } from '../services/inspection';
import { inspectPortfolio, inspectSampleListings } from '../services/inspectionRunner';
import { assessEvidence, describeEvidenceLimits } from '../services/roleAssessment';
import { analyzeReadmes, analyzeSampleReadmes, planReadmeAnalysis, README_LIMITS } from '../services/readmeAnalysis';
import { getSampleListings, getSampleReadmes } from '../data/mockRepoTrees';
import { canInspectWithQuota, quotaDeadline, quotaIsFresh, quotaLabel, quotaMessage, repositoryQuotaMatches } from '../utils/quota';

interface EvidenceIntelligenceSectionProps {
  username: string;
  repos: GitHubRepo[];
  isMockData?: boolean;
  token?: string;
  rateLimit?: RateLimitInfo | null;
  /** Called after a live inspection so the caller can refresh the quota indicator */
  onInspectionComplete?: () => void;
}

const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  readme: 'README',
  tests: 'Tests',
  ci: 'CI',
  deployment: 'Deployment',
  documentation: 'Docs',
};

const FINDING_STYLE: Record<EvidenceStatus, { label: string; className: string }> = {
  found: { label: 'Found', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  not_found: { label: 'Not found in inspected paths', className: 'bg-slate-800 text-slate-300 border-slate-600' },
  unknown: { label: 'Unknown', className: 'bg-slate-900 text-slate-400 border-slate-700 border-dashed' },
};

const CRITERION_STYLE: Record<CriterionStatus, { label: string; className: string }> = {
  met: { label: 'Observed', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  partial: { label: 'Partly observed', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  not_observed: { label: 'Not observed', className: 'bg-slate-800 text-slate-300 border-slate-600' },
  unknown: { label: 'Not assessed', className: 'bg-slate-900 text-slate-400 border-slate-700 border-dashed' },
};

const REASON_LABEL: Record<NotInspectedReason, string> = {
  not_selected: 'outside the inspection budget',
  fork: 'fork',
  empty: 'no files',
  demo_data: 'no sample listing',
  rate_limited: 'request budget ran out',
  too_large: 'file listing too large',
  not_found: 'file listing not found',
  error: 'could not be retrieved',
};

const README_STATUS_STYLE: Record<ReadmeDimensionStatus, { label: string; className: string }> = {
  explained: { label: 'Explained', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  mentioned: { label: 'Mentioned briefly', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  not_found: { label: 'Not found in README', className: 'bg-slate-800 text-slate-300 border-slate-600' },
};

const README_REASON_LABEL: Record<ReadmeNotAnalyzedReason, string> = {
  no_readme: 'no README file was seen in the file listing',
  too_large: 'the README is larger than the size limit',
  not_text: 'the README is not a text file',
  not_found: 'the README could not be found or the repository is not publicly readable',
  rate_limited: 'the GitHub request budget ran out',
  over_limit: 'outside the limit of README files or bytes read per run',
  no_sample: 'no sample README exists for this demo repository',
  error: 'it could not be retrieved',
};

const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

const PRIORITY_STYLE = {
  high: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  medium: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  low: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
} as const;

export const EvidenceIntelligenceSection: React.FC<EvidenceIntelligenceSectionProps> = ({
  username,
  repos,
  isMockData = false,
  token,
  rateLimit,
  onInspectionComplete,
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [evidence, setEvidence] = useState<PortfolioEvidence | null>(null);
  const [chosenRole, setChosenRole] = useState<RoleId | null>(null);
  // README content analysis is a second, separately started step
  const [readmeStatus, setReadmeStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [readmeReports, setReadmeReports] = useState<ReadmeReport[]>([]);

  // A run that finishes after this section is gone (or was restarted) must not write state
  const runIdRef = useRef(0);
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
    };
  }, []);

  const selection = useMemo(() => selectReposForInspection(repos), [repos]);
  // A default branch containing a slash needs one extra request to resolve it safely
  const requestCost = useMemo(
    () => selection.selected.reduce((sum, r) => sum + (isValidBranchName(r.default_branch) && r.default_branch.includes('/') ? 2 : 1), 0),
    [selection]
  );
  const assessment = useMemo(() => (evidence ? assessEvidence(evidence) : null), [evidence]);

  const hasQuota = isMockData || canInspectWithQuota(rateLimit, requestCost);
  const [, refreshQuota] = useState(0);
  useEffect(() => {
    if (!rateLimit) return;
    const delay = quotaDeadline(rateLimit) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => refreshQuota((value) => value + 1), Math.min(delay + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [rateLimit]);
  const quotaCounts = rateLimit && quotaIsFresh(rateLimit) && repositoryQuotaMatches(rateLimit)
    ? ` of the ${rateLimit.remaining} last observed remaining` : '';
  const quotaDetails = rateLimit ? quotaMessage(rateLimit) : 'Repository quota has not been observed yet.';
  const limitTitle = rateLimit?.source?.startsWith('proxy-') ? quotaLabel(rateLimit) + ' reached'
    : rateLimit?.limitKind === 'secondary' ? 'GitHub secondary rate limit reached' : 'GitHub request limit reached';

  const runInspection = async () => {
    if (status === 'loading' || selection.selected.length === 0) return;
    const runId = ++runIdRef.current;
    const isCancelled = () => runIdRef.current !== runId;
    setStatus('loading');

    let result: PortfolioEvidence;
    if (isMockData) {
      result = inspectSampleListings(repos, getSampleListings(username) ?? {});
    } else {
      result = await inspectPortfolio(username, repos, {
        fetchTree: (owner, repo, branch) => fetchRepoTree(owner, repo, token, branch),
        concurrency: 2,
        isCancelled,
      });
    }
    if (isCancelled()) return;

    setEvidence(result);
    setChosenRole(null);
    setReadmeStatus('idle');
    setReadmeReports([]);
    setStatus('done');
    if (!isMockData) onInspectionComplete?.();
  };

  const readmePlan = useMemo(() => (evidence ? planReadmeAnalysis(evidence) : null), [evidence]);
  const readmeRequestCost = (readmePlan?.targets.length ?? 0) * README_LIMITS.maxRequestsPerReadme;
  const hasReadmeQuota = isMockData || canInspectWithQuota(rateLimit, readmeRequestCost);

  const runReadmeAnalysis = async () => {
    if (!evidence || readmeStatus === 'loading' || !readmePlan || readmePlan.targets.length === 0) return;
    const runId = runIdRef.current;
    const isCancelled = () => runIdRef.current !== runId;
    setReadmeStatus('loading');

    const reports = isMockData
      ? analyzeSampleReadmes(evidence, getSampleReadmes(username))
      : await analyzeReadmes(username, evidence, repos, {
          fetchReadme: (owner, repo, branch, path) => fetchReadmeContent(owner, repo, token, branch, path),
          concurrency: 2,
          isCancelled,
        });
    if (isCancelled()) return;

    setReadmeReports(reports);
    setReadmeStatus('done');
    if (!isMockData) onInspectionComplete?.();
  };

  const analyzedReadmes = readmeReports.filter((r) => r.state === 'analyzed');
  const readmeFailures = readmeReports.filter((r) => r.state === 'not_analyzed' && r.reason !== 'no_readme' && r.reason !== 'over_limit');
  const readmeAllRateLimited = readmeStatus === 'done' && analyzedReadmes.length === 0 && readmeFailures.length > 0 && readmeFailures.every((r) => r.reason === 'rate_limited');

  // The target role is always the user's own choice; nothing is preselected from the scores
  const activeRoleId = chosenRole;
  const activeRole = assessment?.roles.find((r) => r.role === activeRoleId) ?? null;
  const evidenceLimits = activeRole && assessment ? describeEvidenceLimits(activeRole, assessment.scope) : [];
  const actions = activeRoleId && assessment ? assessment.actionsByRole[activeRoleId] : [];

  // Selected repositories whose listing could not be read, whatever the reason
  const selectedNames = new Set(selection.selected.map((r) => r.full_name));
  const failed = evidence ? evidence.repos.filter((r) => selectedNames.has(r.repo) && r.state === 'not_inspected') : [];
  const allRateLimited = Boolean(evidence) && evidence!.inspectedCount === 0 && failed.length > 0 && failed.every((r) => r.reason === 'rate_limited');
  const allFailed = Boolean(evidence) && evidence!.inspectedCount === 0 && failed.length > 0 && !allRateLimited;

  return (
    <section
      aria-label="Evidence Intelligence"
      aria-busy={status === 'loading'}
      className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-xl relative"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-950/40 border border-cyan-700/50 text-cyan-300">
              <Microscope className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
              EVIDENCE INTELLIGENCE
            </span>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">Repository Evidence</h3>
            {isMockData && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-950/40 border border-amber-700/50 text-amber-300">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                SAMPLE / SYNTHETIC DATA
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Looks inside repositories for a README, tests, CI, deployment configuration and documentation, then reads that
            evidence against five engineering roles. Separate from the Portfolio Health Score, which it does not change.
          </p>
        </div>
      </div>

      {/* Idle: user-triggered, with the cost stated up front */}
      {status === 'idle' && (
        <div className="rounded-2xl bg-slate-950/70 border border-slate-800 p-5">
          {selection.selected.length === 0 ? (
            <p className="text-sm text-slate-300">
              No repositories to inspect: forks and empty repositories are skipped, and none of the {repos.length} analysed
              repositories remain.
            </p>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <FileSearch className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm text-slate-300 space-y-1.5">
                  {isMockData ? (
                    <p>
                      This is a demo persona, so there is no real repository to read. Inspection will use{' '}
                      <strong className="text-amber-300">synthetic file listings</strong> shipped with the app and makes no
                      GitHub requests.
                    </p>
                  ) : (
                    <p>
                      Reads the <strong className="text-white">file listing</strong> (paths and sizes, never file contents) of{' '}
                      {selection.selected.length === 1 ? '1 repository' : `${selection.selected.length} repositories`}:{' '}
                      <span className="font-mono text-xs text-indigo-300">{selection.selected.map((r) => r.name).join(', ')}</span>.
                    </p>
                  )}
                  {!isMockData && (
                    <p className="text-xs text-slate-400">
                      Uses up to <strong className="text-slate-200">{requestCost} GitHub API request{requestCost === 1 ? '' : 's'}</strong>
                      {quotaCounts}. Nothing is fetched until you start it. Additional public-visibility checks may be needed.
                      {selection.eligibleCount > selection.selected.length &&
                        ` ${selection.eligibleCount - selection.selected.length} other eligible repositories are outside the per-audit budget and will be reported as not inspected.`}
                    </p>
                  )}
                </div>
              </div>

              {!isMockData && rateLimit && (
                <p className="mt-3 text-xs text-slate-400">
                  {repositoryQuotaMatches(rateLimit) ? quotaDetails : 'Profile quota belongs to different credentials. Repository quota is not yet known; the proxy will enforce the applicable public-request limits.'}
                </p>
              )}

              {!hasQuota && (
                <div role="alert" className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Not enough requests left ({rateLimit?.remaining ?? 0} remaining, {requestCost} needed). {quotaDetails}
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={runInspection}
                disabled={!hasQuota}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <Microscope className="w-4 h-4" aria-hidden="true" />
                <span>{isMockData ? 'Inspect Sample Repository Evidence' : 'Inspect Repository Evidence'}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Loading */}
      {status === 'loading' && (
        <div role="status" aria-live="polite" className="rounded-2xl bg-slate-950/70 border border-slate-800 p-5 flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" aria-hidden="true" />
          <span>
            Reading file listings for {selection.selected.length === 1 ? '1 repository' : `${selection.selected.length} repositories`}…
          </span>
        </div>
      )}

      {/* Finished with nothing inspected: rate limit or failure, never shown as "no evidence" */}
      {status === 'done' && evidence && (allRateLimited || allFailed) && (
        <div role="alert" className={`rounded-2xl p-5 border ${allRateLimited ? 'bg-amber-950/40 border-amber-600/50' : 'bg-rose-950/50 border-rose-800/70'}`}>
          <div className="flex items-start gap-3">
            {allRateLimited ? (
              <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <div className="text-sm">
              <p className={`font-semibold ${allRateLimited ? 'text-amber-200' : 'text-rose-200'}`}>
                {allRateLimited ? `Inspection stopped: ${limitTitle}` : 'Inspection could not be completed'}
              </p>
              <p className="text-xs text-slate-300 mt-1">
                No repository was inspected, so nothing is concluded about this profile.{' '}
                {allRateLimited
                  ? quotaDetails
                  : `Reason: ${[...new Set(failed.map((r) => REASON_LABEL[r.reason ?? 'error']))].join(', ')}.`}
              </p>
              <button
                type="button"
                onClick={runInspection}
                disabled={!hasQuota}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Try again</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {status === 'done' && evidence && assessment && evidence.inspectedCount > 0 && (
        <div className="space-y-6">
          {/* Compact summary: what was inspected, what was seen, what to do first */}
          <div role="group" aria-label="Evidence summary" className="rounded-2xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Repositories inspected</span>
                <span className="block font-mono text-2xl font-black text-white">
                  {assessment.scope.inspectedRepos}
                  <span className="text-sm text-slate-400 font-normal"> of {assessment.scope.eligibleRepos} eligible</span>
                </span>
                <span className="block text-xs text-slate-400">
                  {evidence.source === 'sample' ? 'synthetic sample listings' : 'file listings read from GitHub'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <span className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Evidence seen
                  <span className="px-1.5 py-0.5 rounded border bg-indigo-950/40 text-indigo-300 border-indigo-700/50 tracking-wide">
                    {evidence.source === 'sample' ? 'SAMPLE DATA' : 'PATH DETECTED'}
                  </span>
                </span>
                <ul className="mt-1 text-xs text-slate-300 space-y-0.5">
                  {EVIDENCE_CATEGORIES.map((category) => (
                    <li key={category} className="flex justify-between gap-2">
                      <span>{CATEGORY_LABEL[category]}</span>
                      <span className="font-mono text-slate-200">
                        {evidence.coverage[category].found} of {evidence.inspectedCount}
                        {evidence.coverage[category].unknown > 0 ? `, ${evidence.coverage[category].unknown} unknown` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                <span className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  README content
                  <span
                    className={`px-1.5 py-0.5 rounded border tracking-wide ${
                      analyzedReadmes.length > 0 ? 'bg-cyan-950/40 text-cyan-300 border-cyan-700/50' : 'bg-slate-900 text-slate-400 border-slate-700 border-dashed'
                    }`}
                  >
                    {analyzedReadmes.length === 0 ? 'NOT INSPECTED' : isMockData ? 'SAMPLE CONTENT' : 'CONTENT READ'}
                  </span>
                </span>
                <span className="block text-xs text-slate-300 mt-1">
                  {analyzedReadmes.length === 0
                    ? 'README text has not been read. Start it below if you want it.'
                    : `${analyzedReadmes.length} README file${analyzedReadmes.length === 1 ? '' : 's'} read; ${analyzedReadmes.reduce(
                        (sum, r) => sum + README_DIMENSIONS.filter((d) => r.dimensions![d].status === 'explained').length,
                        0
                      )} of ${analyzedReadmes.length * README_DIMENSIONS.length} documentation topics explained.`}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Top priorities</span>
              {!activeRole ? (
                <p className="text-xs text-slate-300">Select a target role below to see the highest-impact improvements for it.</p>
              ) : actions.length === 0 ? (
                <p className="text-xs text-slate-300">No gaps were observed for {activeRole.label} in the inspected repositories.</p>
              ) : (
                <ol className="text-xs text-slate-200 space-y-0.5 list-decimal list-inside">
                  {actions.slice(0, 3).map((action) => (
                    <li key={action.id}>{action.title}</li>
                  ))}
                </ol>
              )}
            </div>

            {(failed.length > 0 || assessment.scope.partialRepos > 0 || assessment.scope.uninspectedEligibleRepos > 0) && (
              <p role="note" aria-label="Partial coverage" className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Partial coverage.{' '}
                  {assessment.scope.uninspectedEligibleRepos > 0 &&
                    `${assessment.scope.uninspectedEligibleRepos} eligible ${assessment.scope.uninspectedEligibleRepos === 1 ? 'repository was' : 'repositories were'} not inspected. `}
                  {failed.length > 0 && `Not inspected: ${failed.map((r) => `${r.repoName} (${REASON_LABEL[r.reason ?? 'error']})`).join(', ')}. `}
                  {assessment.scope.partialRepos > 0 && `${assessment.scope.partialRepos} listing(s) were only partly read.`}
                </span>
              </p>
            )}

            <details>
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 rounded">How to read these results</summary>
              <div className="mt-2 text-xs text-slate-300 space-y-1">
                <p>
                  <strong className="text-white">Scope:</strong>{' '}
                  {evidence.source === 'sample'
                    ? `synthetic sample listings for ${assessment.scope.inspectedRepos} demo ${assessment.scope.inspectedRepos === 1 ? 'repository' : 'repositories'}. These are not GitHub inspection results.`
                    : `file listings of ${assessment.scope.inspectedRepos} of ${assessment.scope.eligibleRepos} eligible ${assessment.scope.eligibleRepos === 1 ? 'repository' : 'repositories'}.`}{' '}
                  Based on file paths only: file contents were not read and CI results were not checked.
                </p>
                <p className="text-slate-400">
                  “Not found” means not seen in the inspected paths, not that it does not exist. Unknown and not-inspected items are
                  left out of scores rather than counted against the profile. Evidence matched only by a suggestive name is
                  marked weak and counted at half weight.
                </p>
              </div>
            </details>
          </div>

          {/* Role selector */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Role-aware assessment</h4>
            <p className="text-xs text-slate-400 mb-2">
              Select the role you are aiming for to see its criteria and actions. No role is chosen for you, and a low score
              for a role you are not targeting is not a problem.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2" role="group" aria-label="Target role">
              {assessment.roles.map((role) => {
                const isActive = role.role === activeRoleId;
                return (
                  <button
                    key={role.role}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setChosenRole(role.role)}
                    className={`p-3 rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                      isActive ? 'bg-cyan-950/40 border-cyan-500/60' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span className="block text-xs font-semibold text-slate-200">{role.label}</span>
                    <span className="block font-mono text-lg font-bold text-white mt-0.5">
                      {role.score === null ? '—' : role.score}
                      <span className="text-xs text-slate-400 font-normal"> / 100</span>
                    </span>
                    <span className="block text-[11px] text-slate-300 mt-1">Coverage {role.coveragePercent}%</span>
                    <span className="block h-1 mt-1 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
                      <span className="block h-full bg-cyan-500" style={{ width: `${role.coveragePercent}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nothing role-specific is shown until the user picks a role */}
          {!activeRole && (
            <p role="status" className="p-4 rounded-2xl bg-slate-950/60 border border-dashed border-slate-700 text-sm text-slate-300">
              Select your target role above to see its evidence score, the criteria behind it and the recommended actions.
            </p>
          )}

          {/* Criteria for the active role */}
          {activeRole && (
            <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4 sm:p-5">
              <h4 className="text-sm font-bold text-white mb-3">{activeRole.label}</h4>

              {/* Score and coverage side by side: the score means little without the coverage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Evidence score</span>
                  <span className="block font-mono text-3xl font-black text-white">
                    {activeRole.score === null ? '—' : activeRole.score}
                    <span className="text-sm text-slate-400 font-normal"> / 100</span>
                  </span>
                  <span className="block text-xs text-slate-400">of the criteria that could be assessed</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">Evidence coverage</span>
                  <span className="block font-mono text-3xl font-black text-cyan-300">
                    {activeRole.coveragePercent}
                    <span className="text-sm text-slate-400 font-normal"> %</span>
                  </span>
                  <span className="block text-xs text-slate-400">
                    {assessment.scope.inspectedRepos} of {assessment.scope.eligibleRepos} eligible{' '}
                    {assessment.scope.eligibleRepos === 1 ? 'repository' : 'repositories'} inspected • confidence {activeRole.confidence}
                  </span>
                </div>
              </div>

              {evidenceLimits.length > 0 && (
                <div role="note" aria-label="Limited evidence" className="mb-3 p-3 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                    Limited evidence: treat this score as provisional
                  </p>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-amber-200/90">
                    {evidenceLimits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-slate-400 mb-3">{activeRole.summary}</p>

              <details>
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 rounded">Criteria and weights ({activeRole.criteria.length})</summary>
                <p className="text-xs text-slate-400 mt-2 mb-2">
                  Score = points earned ÷ points that could be assessed. Weights are fixed and shown per row.
                </p>
              <ul className="space-y-2">
                {activeRole.criteria.map((criterion) => {
                  const style = CRITERION_STYLE[criterion.status];
                  return (
                    <li key={criterion.id} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-200">{criterion.label}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${style.className}`}>{style.label}</span>
                        </div>
                        <span className="font-mono text-xs text-slate-300">
                          {criterion.earned === null ? '—' : criterion.earned} / {criterion.weight} pts
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {criterion.explanation} <span className="text-slate-400">{criterion.rationale}</span>
                      </p>
                      {criterion.sources.length > 0 && (
                        <p className="text-[11px] text-slate-400 mt-1.5 font-mono break-all">
                          {criterion.sources.map((s) => `${s.repo}: ${s.paths.join(', ')}`).join(' • ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              </details>
            </div>
          )}

          {/* Evidence-linked actions for the active role: titles are in the summary, detail on demand */}
          {activeRole && (
            <details className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 rounded">
                Evidence-linked actions for {activeRole.label} ({actions.length})
              </summary>
              <div className="mt-3">
              {actions.length === 0 ? (
                <p className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  No gaps were observed for this role in the inspected repositories.
                </p>
              ) : (
                <ol className="space-y-3">
                  {actions.map((action, index) => (
                    <li key={action.id} className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="font-mono text-xs text-slate-400">#{index + 1}</span>
                        <span className="text-sm font-bold text-white">{action.title}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border ${PRIORITY_STYLE[action.priority]}`}>
                          {action.priority}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">up to +{action.impact} pts</span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">
                        <strong className="text-slate-300">Evidence:</strong> {action.evidence}
                      </p>
                      <ul className="space-y-1 mb-2">
                        {action.steps.map((step) => (
                          <li key={step} className="flex items-start gap-2 text-xs text-slate-300">
                            <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-emerald-300/90">
                        <strong>Verify:</strong> {action.verification}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              </div>
            </details>
          )}

          {/* Per-repository findings with source paths */}
          <details className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 rounded">
              Findings per repository ({evidence.repos.length})
            </summary>
            <ul className="mt-3 space-y-3">
              {evidence.repos.map((repo) => (
                <li key={repo.repo} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold text-indigo-300">{repo.repoName}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span
                        className={`px-1.5 py-0.5 rounded border font-bold tracking-wide ${
                          repo.state === 'not_inspected' ? 'bg-slate-900 text-slate-400 border-slate-700 border-dashed' : 'bg-indigo-950/40 text-indigo-300 border-indigo-700/50'
                        }`}
                      >
                        {repo.state === 'not_inspected' ? 'NOT INSPECTED' : evidence.source === 'sample' ? 'SAMPLE DATA' : 'PATH DETECTED'}
                      </span>
                      {repo.state === 'not_inspected'
                        ? `Not inspected: ${REASON_LABEL[repo.reason ?? 'error']}`
                        : `${repo.entriesInspected} file paths ${repo.state === 'partial' ? '(partial listing)' : 'inspected'}`}
                    </span>
                  </div>
                  {repo.state !== 'not_inspected' && (
                    <dl className="space-y-1.5">
                      {EVIDENCE_CATEGORIES.map((category) => {
                        const finding = repo.findings[category];
                        const style = FINDING_STYLE[finding.status];
                        return (
                          <div key={category} className="text-xs">
                            <dt className="inline-flex items-center gap-2">
                              <span className="font-semibold text-slate-200 w-20">{CATEGORY_LABEL[category]}</span>
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${style.className}`}>{style.label}</span>
                              <span className="text-[11px] text-slate-400">{finding.confidence} confidence</span>
                            </dt>
                            <dd className="text-slate-400 mt-0.5">
                              {finding.summary}
                              {finding.sourcePaths.length > 0 && (
                                <span className="block font-mono text-[11px] text-slate-400 break-all">{finding.sourcePaths.join(', ')}</span>
                              )}
                              {finding.matches.length > 0 && (
                                <span className="block text-[11px] text-slate-400">
                                  Matched: {finding.matches.map((m) => `${m.description} (${m.strength})`).join('; ')}.
                                </span>
                              )}
                              {finding.limitations.length > 0 && <span className="block text-[11px] text-slate-400">Limit: {finding.limitations[0]}</span>}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                  {repo.markers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-800/80 text-xs">
                      <span className="font-semibold text-slate-200">Stack markers</span>
                      <ul className="mt-1 space-y-1">
                        {repo.markers.map((found) => (
                          <li key={found.id} className="text-slate-400">
                            <span className="text-slate-300">{found.label}</span>{' '}
                            <span className="text-[11px]">({found.countsAsEvidence ? found.strength : 'context only'})</span>
                            <span className="block font-mono text-[11px] break-all">{found.sourcePaths.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>

          {/* README content: a second, separately started step. It does not change any score. */}
          {readmePlan && (
            <div aria-label="README content analysis" role="group" aria-busy={readmeStatus === 'loading'} className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                <h4 className="text-sm font-bold text-white">README content</h4>
                {isMockData && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/40 border border-amber-700/50 text-amber-300">
                    SAMPLE / SYNTHETIC DATA
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Reads the text of up to {README_LIMITS.maxReadmes} README files and checks whether they explain the project&rsquo;s purpose,
                setup, usage, evaluation, limitations and deployment. This verifies what the documentation says, not that the software
                runs or that its claims are correct. It does not change any score above.
              </p>

              {readmeStatus === 'idle' &&
                (readmePlan.targets.length === 0 ? (
                  <p className="text-xs text-slate-300">
                    No README can be read: {readmePlan.skipped.length === 0 ? 'no repository was inspected' : 'none of the inspected repositories has a README within the size limit'}.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-slate-300">
                      {isMockData ? (
                        <>Uses synthetic README text shipped with the app and makes no GitHub requests.</>
                      ) : (
                        <>
                          Will read{' '}
                          <span className="font-mono text-indigo-300">
                            {readmePlan.targets.map((t) => `${t.inspection.repoName}/${t.choice.path}`).join(', ')}
                          </span>{' '}
                          ({formatSize(readmePlan.totalBytes)} in total), using up to{' '}
                          <strong className="text-slate-200">{readmeRequestCost} GitHub API requests</strong>
                          {quotaCounts}. Nothing is fetched until you start it. Additional public-visibility checks may be needed.
                        </>
                      )}
                    </p>
                    {!hasReadmeQuota && (
                      <div role="alert" className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200">
                        <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          Not enough requests left ({rateLimit?.remaining ?? 0} remaining, {readmeRequestCost} needed). {quotaDetails}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={runReadmeAnalysis}
                      disabled={!hasReadmeQuota}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      <FileText className="w-4 h-4" aria-hidden="true" />
                      <span>{isMockData ? 'Analyze Sample README Content' : 'Analyze README Content'}</span>
                    </button>
                  </>
                ))}

              {readmeStatus === 'loading' && (
                <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-slate-300">
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" aria-hidden="true" />
                  Reading {readmePlan.targets.length === 1 ? '1 README file' : `${readmePlan.targets.length} README files`}…
                </p>
              )}

              {readmeStatus === 'done' && (
                <div className="space-y-3">
                  {readmeAllRateLimited && (
                    <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-amber-950/40 border border-amber-600/50 text-xs text-amber-200">
                      <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        README analysis stopped: {limitTitle}. No README was read, so nothing is concluded about the documentation. {quotaDetails}
                      </span>
                    </div>
                  )}

                  {analyzedReadmes.map((report) => (
                    <details key={report.repo} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <summary className="cursor-pointer rounded">
                        <span className="font-mono text-xs font-semibold text-indigo-300 break-all">
                          {report.repoName}/{report.path}
                        </span>{' '}
                        <span className="text-[11px] text-slate-300">
                          {README_DIMENSIONS.filter((d) => report.dimensions![d].status === 'explained').length} of {README_DIMENSIONS.length} topics explained,{' '}
                          {README_DIMENSIONS.filter((d) => report.dimensions![d].status === 'mentioned').length} mentioned briefly •{' '}
                          {formatSize(report.sizeBytes ?? 0)} read
                        </span>
                      </summary>
                      {report.selection && <p className="text-[11px] text-slate-400 mt-2 mb-2">{report.selection}</p>}
                      <ul className="space-y-2">
                        {README_DIMENSIONS.map((dimension) => {
                          const finding = report.dimensions![dimension];
                          const style = README_STATUS_STYLE[finding.status];
                          return (
                            <li key={dimension} className="text-xs">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-200">{finding.label}</span>
                                <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${style.className}`}>{style.label}</span>
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide border bg-cyan-950/40 text-cyan-300 border-cyan-700/50">
                                  {report.source === 'sample' ? 'SAMPLE CONTENT' : 'CONTENT VERIFIED'}
                                </span>
                                <span className="text-[11px] text-slate-400">{finding.confidence} confidence</span>
                              </div>
                              <p className="text-slate-400 mt-0.5">
                                {finding.explanation} <span className="text-slate-400">{finding.limitations[0]}</span>
                              </p>
                              <p className="font-mono text-[11px] text-slate-400 break-all">Source: {finding.sourcePath}</p>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ))}

                  {readmeReports.filter((r) => r.state === 'not_analyzed').length > 0 && (
                    <ul className="text-xs text-slate-300 space-y-1">
                      {readmeReports
                        .filter((r) => r.state === 'not_analyzed')
                        .map((report) => (
                          <li key={report.repo}>
                            <span className="font-mono text-indigo-300">{report.repoName}</span>: README not analysed, because{' '}
                            {README_REASON_LABEL[report.reason ?? 'error']}.
                          </li>
                        ))}
                    </ul>
                  )}

                  <p className="text-[11px] text-slate-400">
                    {isMockData ? 'Sample content is synthetic text for a demo persona, not a real README. ' : ''}
                    “Content verified” means the README&rsquo;s text was read and measured (headings, words, code lines). README text is treated
                    as untrusted data: nothing in it is executed, followed or obeyed.
                  </p>

                  {(readmeAllRateLimited || readmeFailures.length > 0) && (
                    <button
                      type="button"
                      onClick={runReadmeAnalysis}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Try README analysis again</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={runInspection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Re-run inspection</span>
          </button>
        </div>
      )}
    </section>
  );
};
