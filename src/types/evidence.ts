// Evidence Intelligence data model: what was looked at inside a repository, what was seen,
// and how sure we are. Absence of a match is never reported as proof of absence.

export type EvidenceCategory = 'readme' | 'tests' | 'ci' | 'deployment' | 'documentation';

export const EVIDENCE_CATEGORIES: EvidenceCategory[] = ['readme', 'tests', 'ci', 'deployment', 'documentation'];

/**
 * found      - at least one matching path was seen
 * not_found  - the complete file listing was inspected and nothing matched (may still exist under an unconventional name)
 * unknown    - the listing was incomplete or the repository was not inspected, so no conclusion is drawn
 */
export type EvidenceStatus = 'found' | 'not_found' | 'unknown';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

/**
 * Where a finding comes from.
 * file-path - a file or directory name matched a rule; the file's contents were not read
 * content   - a file's contents were read and checked (reserved for bounded content analysis)
 * none      - nothing was inspected
 */
export type EvidenceProvenance = 'file-path' | 'content' | 'none';

/**
 * strong - the name is a recognised convention that rarely means anything else
 * weak   - the name is suggestive but commonly used for other things; counted at half weight
 */
export type EvidenceStrength = 'strong' | 'weak';

/** One detection rule that fired, with the paths it fired on */
export interface RuleMatch {
  ruleId: string;
  /** What the rule looks for, in plain words */
  description: string;
  strength: EvidenceStrength;
  paths: string[];
  matchCount: number;
}

export interface EvidenceFinding {
  category: EvidenceCategory;
  status: EvidenceStatus;
  confidence: EvidenceConfidence;
  /** Human-readable statement of exactly what was observed */
  summary: string;
  /** Repository-relative paths that back the finding (bounded) */
  sourcePaths: string[];
  /** Total number of matching paths, which can exceed sourcePaths.length */
  matchCount: number;
  /** Stable ids of the rules that matched, for explainable scoring */
  signals: string[];
  provenance: EvidenceProvenance;
  /** Strongest rule that matched, or null when nothing matched */
  strength: EvidenceStrength | null;
  /** Every rule that fired, with its own paths */
  matches: RuleMatch[];
  /** What this finding does NOT establish */
  limitations: string[];
}

export type InspectionState = 'inspected' | 'partial' | 'not_inspected';

export type NotInspectedReason =
  | 'not_selected' // outside the per-audit repository budget
  | 'fork'
  | 'empty'
  | 'demo_data' // synthetic persona: there is no real repository to inspect
  | 'rate_limited'
  | 'too_large'
  | 'not_found'
  | 'error';

/** A technology or structure marker seen in the file listing, used later for role-aware assessment */
export interface StackMarker {
  id: string;
  label: string;
  sourcePaths: string[];
  matchCount: number;
  provenance: EvidenceProvenance;
  strength: EvidenceStrength;
  matches: RuleMatch[];
  /** What this marker does NOT establish */
  limitations: string[];
  /**
   * False for context markers that explain why something was NOT counted
   * (for example application mock data that is not a dataset).
   */
  countsAsEvidence: boolean;
}

export interface RepoInspection {
  repo: string; // owner/name
  repoName: string;
  repoUrl: string;
  state: InspectionState;
  reason?: NotInspectedReason;
  /** Number of file paths the findings are based on */
  entriesInspected: number;
  /** True when the listing was cut short, in which case missing evidence is reported as unknown */
  truncated: boolean;
  findings: Record<EvidenceCategory, EvidenceFinding>;
  markers: StackMarker[];
  /** README-named files seen in the listing (bounded), kept so one can be chosen for content analysis */
  readmeCandidates: ReadmeCandidate[];
}

export interface ReadmeCandidate {
  path: string;
  size: number | null;
}

export interface EvidenceCoverage {
  found: number;
  notFound: number;
  unknown: number;
}

export interface PortfolioEvidence {
  repos: RepoInspection[];
  /** Repositories that could be inspected (non-fork, non-empty) */
  eligibleCount: number;
  /** Repositories selected for inspection under the budget */
  selectedCount: number;
  /** Repositories whose file listing was actually read (fully or partially) */
  inspectedCount: number;
  coverage: Record<EvidenceCategory, EvidenceCoverage>;
  limits: {
    maxRepos: number;
    maxEntriesPerRepo: number;
  };
  /** What kind of data the findings rest on, stated for the reader */
  method: 'file-paths-only';
  /** 'sample' marks synthetic listings for demo personas; they are never real GitHub inspection results */
  source: 'github' | 'sample';
}

/** One entry of a repository file listing, reduced to what inspection needs */
export interface RepoTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface RepoTree {
  entries: RepoTreeEntry[];
  /** True if GitHub or our own caps cut the listing short */
  truncated: boolean;
}

export type RepoTreeResult =
  | { ok: true; tree: RepoTree }
  | { ok: false; reason: Extract<NotInspectedReason, 'rate_limited' | 'too_large' | 'not_found' | 'empty' | 'error'> };

// ---- Role-aware assessment (derived from the evidence above; independent of the health score) ----

export type RoleId = 'ai-ml' | 'data-science' | 'full-stack' | 'backend' | 'devops';

/**
 * met          - observed in every assessable inspected repository (or, for stack markers, observed at all)
 * partial      - observed in some assessable inspected repositories
 * not_observed - not seen in any fully inspected repository; says nothing about uninspected ones
 * unknown      - nothing assessable (not inspected, or listings incomplete); excluded from the score
 */
export type CriterionStatus = 'met' | 'partial' | 'not_observed' | 'unknown';

export interface CriterionSource {
  repo: string;
  paths: string[];
}

export interface RoleCriterionResult {
  id: string;
  label: string;
  /** Why this criterion matters for the role */
  rationale: string;
  kind: 'evidence' | 'marker';
  /** Points this criterion can contribute; a role's weights sum to 100 */
  weight: number;
  status: CriterionStatus;
  /** 0..1 share achieved, or null when unknown */
  ratio: number | null;
  /** weight x ratio, or null when unknown */
  earned: number | null;
  explanation: string;
  sources: CriterionSource[];
  supportingRepos: number;
  assessableRepos: number;
}

export interface RoleAssessment {
  role: RoleId;
  label: string;
  /** 0..100 over the criteria that could be assessed, or null when none could */
  score: number | null;
  /** Share of the role's total weight that could be assessed, 0..100 */
  coveragePercent: number;
  confidence: EvidenceConfidence;
  criteria: RoleCriterionResult[];
  summary: string;
}

export interface EvidenceAction {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  /** Deterministic ordering value: criterion weight x unmet share */
  impact: number;
  criterionId: string;
  /** The finding this action responds to, quoted from the inspection */
  evidence: string;
  /** Repositories the action applies to (may be empty for portfolio-level actions) */
  repos: string[];
  steps: string[];
  /** How to confirm the action worked */
  verification: string;
}

export interface EvidenceAssessment {
  roles: RoleAssessment[];
  actionsByRole: Record<RoleId, EvidenceAction[]>;
  /** Role with the highest assessable score, or null when nothing could be assessed */
  strongestRole: RoleId | null;
  scope: {
    inspectedRepos: number;
    partialRepos: number;
    selectedRepos: number;
    eligibleRepos: number;
    uninspectedEligibleRepos: number;
  };
}

// ---- README content analysis (separately triggered; does not feed any score) ----------------

export type ReadmeDimension = 'purpose' | 'setup' | 'usage' | 'evaluation' | 'limitations' | 'deployment';

export const README_DIMENSIONS: ReadmeDimension[] = ['purpose', 'setup', 'usage', 'evaluation', 'limitations', 'deployment'];

/**
 * explained - a section (or the opening text) covers the topic with real content
 * mentioned - a heading or passing mention exists, but with little or placeholder content
 * not_found - nothing about the topic was found in the file
 */
export type ReadmeDimensionStatus = 'explained' | 'mentioned' | 'not_found';

export interface ReadmeSectionEvidence {
  /** Heading text, cleaned and shortened; null for the opening text before any section */
  heading: string | null;
  line: number;
  words: number;
  codeLines: number;
  listItems: number;
}

export interface ReadmeDimensionFinding {
  dimension: ReadmeDimension;
  label: string;
  status: ReadmeDimensionStatus;
  confidence: EvidenceConfidence;
  explanation: string;
  /** Always 'content': the file's text was read */
  provenance: 'content';
  sourcePath: string;
  evidence: ReadmeSectionEvidence[];
  /** What this finding does NOT establish */
  limitations: string[];
}

export type ReadmeNotAnalyzedReason =
  | 'no_readme'
  | 'too_large'
  | 'not_text'
  | 'not_found'
  | 'rate_limited'
  | 'over_limit' // outside the per-run README or byte budget
  | 'no_sample' // demo persona without a synthetic README
  | 'error';

export interface ReadmeReport {
  repo: string;
  repoName: string;
  state: 'analyzed' | 'not_analyzed';
  reason?: ReadmeNotAnalyzedReason;
  path?: string;
  sizeBytes?: number;
  /** Why this file was the one read */
  selection?: string;
  dimensions?: Record<ReadmeDimension, ReadmeDimensionFinding>;
  /** 'sample' marks synthetic README text for demo personas */
  source: 'github' | 'sample';
}

export type ReadmeFetchResult =
  | { ok: true; path: string; size: number; text: string }
  | { ok: false; reason: Extract<ReadmeNotAnalyzedReason, 'rate_limited' | 'too_large' | 'not_text' | 'not_found' | 'error'> };
