import type { GitHubRepo } from '../types/github';
import {
  README_DIMENSIONS,
  type EvidenceConfidence,
  type PortfolioEvidence,
  type ReadmeCandidate,
  type ReadmeDimension,
  type ReadmeDimensionFinding,
  type ReadmeDimensionStatus,
  type ReadmeFetchResult,
  type ReadmeNotAnalyzedReason,
  type ReadmeReport,
  type ReadmeSectionEvidence,
  type RepoInspection,
} from '../types/evidence';

// Deterministic README content analysis.
//
// README text is UNTRUSTED DATA. It is only ever measured (headings, word counts, code lines,
// list items). It is never executed, never rendered as markup, never used to decide what the
// application does, and no link in it is followed. Nothing a README says can change a score.

export const README_LIMITS = {
  /** README files read per run */
  maxReadmes: 3,
  /** Largest single README, in bytes (the proxy enforces the same limit) */
  maxFileBytes: 100 * 1024,
  /** Total bytes read per run */
  maxTotalBytes: 200 * 1024,
  /** Characters and lines analysed per file */
  maxAnalyzedChars: 120_000,
  maxAnalyzedLines: 4000,
  /** GitHub requests one README can cost: a visibility check plus the file itself */
  maxRequestsPerReadme: 2,
} as const;

const README_NAME = /^readme([._-][a-z0-9_-]+)*$/;
const README_EXTENSION_ORDER = ['md', 'markdown', 'mdx', 'rst', 'adoc', 'asciidoc', 'txt', '', 'org', 'rdoc', 'pod', 'textile'];

/**
 * True for a README-named document at most three levels deep made of plain path segments.
 * Keep in sync with isSafeReadmePath in server.js and vite.config.ts.
 */
export function isReadmePath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 200) return false;
  const segments = path.split('/');
  if (segments.length > 3) return false;
  for (const segment of segments) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(segment) || segment === '.' || segment === '..') return false;
  }
  const base = segments[segments.length - 1].toLowerCase();
  const dot = base.lastIndexOf('.');
  return README_NAME.test(base) && README_EXTENSION_ORDER.includes(dot > 0 ? base.slice(dot + 1) : '');
}

export interface ReadmeChoice {
  path: string;
  size: number | null;
  /** Plain-language reason this file was chosen */
  reason: string;
}

/**
 * Picks one README per repository, deterministically:
 * root before nested; plain "README" before localized variants (English first);
 * Markdown before other formats; then alphabetical.
 */
export function selectReadmeCandidate(candidates: ReadmeCandidate[]): ReadmeChoice | null {
  const usable = candidates.filter((c) => isReadmePath(c.path));
  if (usable.length === 0) return null;

  const rank = (candidate: ReadmeCandidate) => {
    const segments = candidate.path.split('/');
    const base = segments[segments.length - 1].toLowerCase();
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1) : '';
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const locale = stem.replace(/^readme[._-]?/, '');
    const depth = segments.length;
    const firstDir = depth > 1 ? segments[0].toLowerCase() : '';
    const location = depth === 1 ? 0 : firstDir === '.github' || firstDir === 'docs' ? depth : depth + 2;
    const localized = locale === '' ? 0 : locale === 'en' || locale.startsWith('en-') || locale.startsWith('en_') ? 1 : 2;
    return { location, localized, ext: README_EXTENSION_ORDER.indexOf(ext), depth };
  };

  const ordered = [...usable].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra.location - rb.location || ra.localized - rb.localized || ra.ext - rb.ext || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });

  const chosen = ordered[0];
  const chosenRank = rank(chosen);
  let reason = 'Root README.';
  if (chosenRank.depth > 1) reason = 'No README at the repository root; the nearest nested README was used.';
  else if (chosenRank.localized > 0) reason = 'No plain root README; a localized root README was used.';
  if (ordered.length > 1) reason += ` ${ordered.length - 1} other README file${ordered.length === 2 ? ' was' : 's were'} not read.`;

  return { path: chosen.path, size: chosen.size, reason };
}

export interface ReadmeTarget {
  inspection: RepoInspection;
  choice: ReadmeChoice;
}

export interface ReadmePlan {
  targets: ReadmeTarget[];
  skipped: Array<{ inspection: RepoInspection; reason: Extract<ReadmeNotAnalyzedReason, 'no_readme' | 'too_large' | 'over_limit'>; choice?: ReadmeChoice }>;
  totalBytes: number;
}

/**
 * Decides which READMEs a run may read: inspected repositories only, in inspection order, one
 * README each, within the per-file, per-run count and per-run byte limits. No network access.
 */
export function planReadmeAnalysis(evidence: PortfolioEvidence): ReadmePlan {
  const plan: ReadmePlan = { targets: [], skipped: [], totalBytes: 0 };

  for (const inspection of evidence.repos) {
    if (inspection.state === 'not_inspected') continue;
    const choice = selectReadmeCandidate(inspection.readmeCandidates);
    if (!choice) {
      plan.skipped.push({ inspection, reason: 'no_readme' });
      continue;
    }
    // A file whose size is unknown is assumed to be as large as allowed
    const size = choice.size ?? README_LIMITS.maxFileBytes;
    if (size > README_LIMITS.maxFileBytes) {
      plan.skipped.push({ inspection, reason: 'too_large', choice });
      continue;
    }
    if (plan.targets.length >= README_LIMITS.maxReadmes || plan.totalBytes + size > README_LIMITS.maxTotalBytes) {
      plan.skipped.push({ inspection, reason: 'over_limit', choice });
      continue;
    }
    plan.targets.push({ inspection, choice });
    plan.totalBytes += size;
  }

  return plan;
}

// ---- Parsing -----------------------------------------------------------------------------

interface Section {
  heading: string | null;
  normalized: string;
  level: number;
  line: number;
  words: number;
  codeLines: number;
  listItems: number;
  commands: number;
  tableRows: number;
  metricMentions: number;
  /** First few words of prose, lower-cased, used only to recognise placeholders */
  opening: string;
}

const COMMAND = /(^|\s|`|\$\s)(npm|yarn|pnpm|npx|pip3?|pipx|python3?|conda|poetry|uv|docker|docker-compose|git|make|cargo|go|mvn|gradle|bundle|dotnet|kubectl|gcloud|terraform|helm|brew|apt|apt-get)\s+[a-z-]/;
const METRIC = /\b(accuracy|precision|recall|f1|auc|rmse|mae|bleu|rouge|loss|latency|throughput|speedup|benchmark(s|ed)?)\b|\d+(\.\d+)?\s?(%|ms\b|x\b|fps\b|req\/s\b)/i;
const PLACEHOLDER = /^(todo|tbd|tba|wip|coming soon|to be (added|written|done|determined)|n\/a|none( yet)?|nothing( yet)?|work in progress|under construction|lorem ipsum)\b/;

function removeHtmlComments(text: string): string {
  let out = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf('<!--', index);
    if (start === -1) return out + text.slice(index);
    out += text.slice(index, start);
    const end = text.indexOf('-->', start + 4);
    if (end === -1) return out;
    index = end + 3;
  }
}

/** Reduces a line of Markdown, reStructuredText or HTML to the words a reader would see */
function visibleText(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images and badges
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text, never their target
    .replace(/<[^>]{0,200}>/g, ' ') // HTML tags
    .replace(/https?:\/\/\S+/g, ' ') // bare URLs are not prose
    .replace(/[`*_~>#|]/g, ' ');
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

function cleanHeading(raw: string): string {
  const text = visibleText(raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function normalizeHeading(heading: string): string {
  return ` ${heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
}

function parseSections(input: string): Section[] {
  const text = removeHtmlComments(input.slice(0, README_LIMITS.maxAnalyzedChars).replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
  const lines = text.split('\n').slice(0, README_LIMITS.maxAnalyzedLines);

  const sections: Section[] = [];
  const open = (heading: string | null, level: number, line: number): Section => {
    const section: Section = {
      heading,
      normalized: heading === null ? '' : normalizeHeading(heading),
      level,
      line,
      words: 0,
      codeLines: 0,
      listItems: 0,
      commands: 0,
      tableRows: 0,
      metricMentions: 0,
      opening: '',
    };
    sections.push(section);
    return section;
  };

  let current = open(null, 0, 1);
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].length > 2000 ? lines[i].slice(0, 2000) : lines[i];
    const trimmed = line.trim();

    // Fenced code: counted as code, never read as headings or prose
    const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
    if (fence) {
      if (fenceMatch && trimmed.startsWith(fence)) fence = null;
      else if (trimmed) {
        current.codeLines++;
        if (COMMAND.test(` ${trimmed.toLowerCase()}`)) current.commands++;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1].slice(0, 3);
      continue;
    }
    if (!trimmed) continue;

    // Headings: ATX, HTML, setext / reStructuredText underlines, and bold-only lines
    const atx = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const html = /^<h([1-6])[^>]{0,100}>(.{1,200}?)<\/h\1>\s*$/i.exec(trimmed);
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const underline = /^(={3,}|-{3,}|~{3,}|\^{3,}|"{3,}|\*{3,}|\+{3,})$/.test(next) && !/^[-=~^"*+|\s]+$/.test(trimmed) && trimmed.length <= 120;
    const bold = /^(\*\*|__)([^*_]{2,60})\1:?$/.exec(trimmed);

    if (atx && cleanHeading(atx[2])) {
      current = open(cleanHeading(atx[2]), atx[1].length, i + 1);
      continue;
    }
    if (html && cleanHeading(html[2])) {
      current = open(cleanHeading(html[2]), Number(html[1]), i + 1);
      continue;
    }
    if (underline && cleanHeading(trimmed)) {
      current = open(cleanHeading(trimmed), next[0] === '=' ? 1 : 2, i + 1);
      i++; // skip the underline itself
      continue;
    }
    if (bold) {
      current = open(cleanHeading(bold[2]), 7, i + 1);
      continue;
    }

    if (/^\s{4,}\S/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      // Indented code block
      current.codeLines++;
      if (COMMAND.test(` ${trimmed.toLowerCase()}`)) current.commands++;
      continue;
    }

    if (/^\|.*\|$/.test(trimmed)) {
      if (!/^[|:\-\s]+$/.test(trimmed)) current.tableRows++;
    }
    if (/^([-*+]|\d+[.)])\s+\S/.test(trimmed)) current.listItems++;
    if (/`[^`]+`/.test(trimmed) || trimmed.startsWith('$ ')) {
      if (COMMAND.test(` ${trimmed.toLowerCase()}`)) current.commands++;
    }
    if (METRIC.test(trimmed)) current.metricMentions++;

    const visible = visibleText(trimmed);
    const words = countWords(visible);
    current.words += words;
    if (current.opening.length < 80 && words > 0) current.opening = `${current.opening} ${visible.toLowerCase().replace(/\s+/g, ' ').trim()}`.trim();
  }

  return sections;
}

/** A section together with its sub-sections, so "## Install" counts what is under "### Linux" */
function withSubsections(sections: Section[], index: number): Section {
  const parent = sections[index];
  const total = { ...parent };
  for (let i = index + 1; i < sections.length; i++) {
    const child = sections[i];
    if (child.level <= parent.level) break;
    total.words += child.words;
    total.codeLines += child.codeLines;
    total.listItems += child.listItems;
    total.commands += child.commands;
    total.tableRows += child.tableRows;
    total.metricMentions += child.metricMentions;
    if (!total.opening) total.opening = child.opening;
  }
  return total;
}

// ---- Dimensions --------------------------------------------------------------------------

interface DimensionRule {
  label: string;
  /** Matched against the normalised heading, which is padded with spaces */
  heading: RegExp;
  isExplained: (s: Section) => boolean;
  limitation: string;
  noun: string;
}

const GENERAL_LIMITATION = 'Verifies what the README says. It does not show that the instructions work or that any claim is true.';

const DIMENSION_RULES: Record<ReadmeDimension, DimensionRule> = {
  purpose: {
    label: 'Project purpose',
    noun: 'what the project is for',
    heading: / (about|overview|introduction|intro|description|what is|motivation|background|summary|features|why) /,
    isExplained: (s) => s.words >= 25,
    limitation: GENERAL_LIMITATION,
  },
  setup: {
    label: 'Setup instructions',
    noun: 'how to set the project up',
    heading: / (install|installation|installing|setup|set up|getting started|get started|prerequisites|requirements|dependencies|build|building|quick start|quickstart|local development|configuration) /,
    isExplained: (s) => s.codeLines > 0 || s.commands > 0 || s.listItems >= 3 || s.words >= 25,
    limitation: 'Verifies that setup steps are written down. The steps were not run.',
  },
  usage: {
    label: 'Usage',
    noun: 'how to use the project',
    heading: / (usage|how to use|using|example|examples|quick start|quickstart|running|run|how to run|demo|commands|cli|tutorial|walkthrough|api reference) /,
    isExplained: (s) => s.codeLines > 0 || s.commands > 0 || s.words >= 25,
    limitation: 'Verifies that usage is described. The examples were not run.',
  },
  evaluation: {
    label: 'Evaluation or results',
    noun: 'evaluation or results',
    heading: / (evaluation|results|benchmark|benchmarks|performance|metrics|experiments|accuracy|validation|test results|testing|tests) /,
    isExplained: (s) => ((s.tableRows > 0 || s.metricMentions > 0) && s.words >= 8) || s.words >= 30,
    limitation: 'Verifies that results are reported. The figures were not reproduced or checked.',
  },
  limitations: {
    label: 'Limitations',
    noun: 'limitations or known issues',
    heading: / (limitations|limitation|known issues|known bugs|caveats|todo|to do|roadmap|future work|disclaimer|not supported|troubleshooting) /,
    isExplained: (s) => s.words >= 15 || s.listItems >= 2,
    limitation: GENERAL_LIMITATION,
  },
  deployment: {
    label: 'Deployment instructions',
    noun: 'how to deploy the project',
    heading: / (deploy|deployment|deploying|hosting|production|docker|kubernetes|cloud run|vercel|netlify|heroku|releasing|release) /,
    isExplained: (s) => s.codeLines > 0 || s.commands > 0 || s.words >= 20,
    limitation: 'Verifies that deployment is described. It does not show that anything is deployed or reachable.',
  },
};

function isPlaceholder(section: Section): boolean {
  if (section.codeLines > 0 || section.listItems > 1) return false;
  return section.words < 4 || PLACEHOLDER.test(section.opening);
}

function describe(section: Section): string {
  const parts = [`${section.words} word${section.words === 1 ? '' : 's'}`];
  if (section.codeLines > 0) parts.push(`${section.codeLines} line${section.codeLines === 1 ? '' : 's'} of code or commands`);
  if (section.listItems > 0) parts.push(`${section.listItems} list item${section.listItems === 1 ? '' : 's'}`);
  if (section.tableRows > 0) parts.push(`${section.tableRows} table row${section.tableRows === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function toEvidence(section: Section): ReadmeSectionEvidence {
  return { heading: section.heading, line: section.line, words: section.words, codeLines: section.codeLines, listItems: section.listItems };
}

/**
 * Measures one README against six documentation dimensions. Pure and deterministic:
 * the same text always yields the same findings, and the text is never interpreted as instructions.
 */
export function analyzeReadme(text: string, sourcePath: string): Record<ReadmeDimension, ReadmeDimensionFinding> {
  const sections = parseSections(typeof text === 'string' ? text : '');
  const findings = {} as Record<ReadmeDimension, ReadmeDimensionFinding>;

  // The opening text: everything before the first section below the title
  const firstSubsection = sections.findIndex((s, index) => index > 0 && s.level >= 2);
  const openingSections = sections.slice(0, firstSubsection === -1 ? Math.min(sections.length, 2) : firstSubsection);
  const opening: Section = openingSections.reduce(
    (acc, s) => ({ ...acc, words: acc.words + s.words, codeLines: acc.codeLines + s.codeLines, listItems: acc.listItems + s.listItems, commands: acc.commands + s.commands }),
    { ...sections[0], heading: null, line: 1, words: 0, codeLines: 0, listItems: 0, commands: 0 }
  );

  for (const dimension of README_DIMENSIONS) {
    const rule = DIMENSION_RULES[dimension];
    const matched = sections
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => s.heading !== null && rule.heading.test(s.normalized))
      .map(({ index }) => withSubsections(sections, index));

    const explained = matched.filter((s) => !isPlaceholder(s) && rule.isExplained(s));
    const thin = matched.filter((s) => !explained.includes(s));

    let status: ReadmeDimensionStatus = 'not_found';
    let confidence: EvidenceConfidence = 'medium';
    let explanation = `Nothing about ${rule.noun} was found in ${sourcePath}. It may be described under a heading this check does not recognise.`;
    let evidence: ReadmeSectionEvidence[] = [];

    if (explained.length > 0) {
      const best = explained[0];
      status = 'explained';
      confidence = 'high';
      explanation = `Section "${best.heading}" (line ${best.line}) covers this: ${describe(best)}.`;
      evidence = explained.slice(0, 3).map(toEvidence);
    } else if (dimension === 'purpose' && opening.words >= 25) {
      status = 'explained';
      confidence = 'medium';
      explanation = `The opening text describes the project (${opening.words} words before the first section).`;
      evidence = [toEvidence(opening)];
    } else if (thin.length > 0) {
      const first = thin[0];
      status = 'mentioned';
      confidence = 'medium';
      explanation = isPlaceholder(first)
        ? `Section "${first.heading}" (line ${first.line}) exists but is empty or a placeholder.`
        : `Section "${first.heading}" (line ${first.line}) exists but says little: ${describe(first)}.`;
      evidence = thin.slice(0, 3).map(toEvidence);
    } else if (dimension === 'purpose' && opening.words >= 8) {
      status = 'mentioned';
      confidence = 'low';
      explanation = `The opening text gives only a brief description (${opening.words} words).`;
      evidence = [toEvidence(opening)];
    } else if (dimension === 'setup' && sections.some((s) => s.commands > 0)) {
      const withCommand = sections.find((s) => s.commands > 0)!;
      status = 'mentioned';
      confidence = 'low';
      explanation = `Install or run commands appear near line ${withCommand.line}, but there is no setup section.`;
      evidence = [toEvidence(withCommand)];
    }

    findings[dimension] = {
      dimension,
      label: rule.label,
      status,
      confidence,
      explanation,
      provenance: 'content',
      sourcePath,
      evidence,
      limitations: [rule.limitation],
    };
  }

  return findings;
}

// ---- Runner ------------------------------------------------------------------------------

export type ReadmeFetcher = (owner: string, repo: string, branch: string, path: string) => Promise<ReadmeFetchResult>;

export interface AnalyzeReadmesOptions {
  fetchReadme: ReadmeFetcher;
  concurrency?: number;
  isCancelled?: () => boolean;
}

function notAnalyzed(inspection: RepoInspection, reason: ReadmeNotAnalyzedReason, source: ReadmeReport['source'], choice?: ReadmeChoice): ReadmeReport {
  return {
    repo: inspection.repo,
    repoName: inspection.repoName,
    state: 'not_analyzed',
    reason,
    source,
    ...(choice ? { path: choice.path, selection: choice.reason, ...(choice.size !== null ? { sizeBytes: choice.size } : {}) } : {}),
  };
}

function analyzed(inspection: RepoInspection, choice: ReadmeChoice, text: string, size: number, source: ReadmeReport['source']): ReadmeReport {
  return {
    repo: inspection.repo,
    repoName: inspection.repoName,
    state: 'analyzed',
    path: choice.path,
    sizeBytes: size,
    selection: choice.reason,
    dimensions: analyzeReadme(text, choice.path),
    source,
  };
}

/**
 * Reads and analyses the planned READMEs: at most three, one per repository, bounded
 * concurrency, and no further requests once GitHub reports a rate limit.
 */
export async function analyzeReadmes(owner: string, evidence: PortfolioEvidence, repos: GitHubRepo[], options: AnalyzeReadmesOptions): Promise<ReadmeReport[]> {
  const plan = planReadmeAnalysis(evidence);
  const branchOf = new Map(repos.map((r) => [r.full_name, r.default_branch]));
  const results: ReadmeReport[] = new Array(plan.targets.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 2));

  let next = 0;
  let rateLimited = false;
  let bytesRead = 0;

  const worker = async () => {
    while (next < plan.targets.length) {
      const index = next++;
      const { inspection, choice } = plan.targets[index];

      if (rateLimited || options.isCancelled?.()) {
        results[index] = notAnalyzed(inspection, rateLimited ? 'rate_limited' : 'error', 'github', choice);
        continue;
      }

      let outcome: ReadmeFetchResult;
      try {
        outcome = await options.fetchReadme(owner, inspection.repoName, branchOf.get(inspection.repo) ?? '', choice.path);
      } catch {
        outcome = { ok: false, reason: 'error' };
      }

      if (!outcome.ok) {
        if (outcome.reason === 'rate_limited') rateLimited = true;
        results[index] = notAnalyzed(inspection, outcome.reason, 'github', choice);
      } else if (outcome.size > README_LIMITS.maxFileBytes || bytesRead + outcome.size > README_LIMITS.maxTotalBytes) {
        // The listing under-reported the size: refuse rather than exceed the byte budget
        results[index] = notAnalyzed(inspection, outcome.size > README_LIMITS.maxFileBytes ? 'too_large' : 'over_limit', 'github', choice);
      } else {
        bytesRead += outcome.size;
        results[index] = analyzed(inspection, choice, outcome.text, outcome.size, 'github');
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, plan.targets.length) }, worker));

  return [...results, ...plan.skipped.map(({ inspection, reason, choice }) => notAnalyzed(inspection, reason, 'github', choice))];
}

/** Analyses synthetic README text for a demo persona. No network access; marked as sample. */
export function analyzeSampleReadmes(evidence: PortfolioEvidence, sampleTexts: Record<string, string>): ReadmeReport[] {
  const plan = planReadmeAnalysis(evidence);
  return [
    ...plan.targets.map(({ inspection, choice }) => {
      const text = Object.prototype.hasOwnProperty.call(sampleTexts, inspection.repoName) ? sampleTexts[inspection.repoName] : undefined;
      if (typeof text !== 'string') return notAnalyzed(inspection, 'no_sample', 'sample', choice);
      return analyzed(inspection, choice, text, new TextEncoder().encode(text).length, 'sample');
    }),
    ...plan.skipped.map(({ inspection, reason, choice }) => notAnalyzed(inspection, reason, 'sample', choice)),
  ];
}
