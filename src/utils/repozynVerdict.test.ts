import { describe, expect, it } from 'vitest';
import { analyzePortfolio } from '../services/analyzer';
import { MOCK_PROFILES } from '../data/mockProfiles';
import type { PortfolioFacts } from '../types/analysis';
import { buildRepozynVerdict, recommendRepository } from './repozynVerdict';

const persona = MOCK_PROFILES[1];
const facts = analyzePortfolio(persona.user, persona.repos, [], false).facts;
const repo = persona.repos[0];

describe('Repozyn Verdict: observed facts and honest limits', () => {
  it('summarises real audit facts without mutating the audit or copying its roadmap', () => {
    const report = analyzePortfolio(MOCK_PROFILES[0].user, MOCK_PROFILES[0].repos, [], false);
    const before = JSON.stringify(report);
    const verdict = buildRepozynVerdict(report.facts);
    expect(verdict.strength).toBe(`${report.facts.reposWithDescriptionCount} of ${report.facts.analyzedReposCount} analysed repositories include a description.`);
    expect(verdict.weakness).toMatch(/profile bio is empty/);
    expect(verdict.observedWeakness).toBe(true);
    expect(verdict.nextAction).toMatch(/one-line bio/);
    expect(verdict.overview.split(/\.\s+/)).toHaveLength(2);
    expect(JSON.stringify(report)).toBe(before);
    expect(report.roadmap.map((item) => item.actionStep)).not.toContain(verdict.nextAction);
    expect(buildRepozynVerdict(report.facts)).toEqual(verdict);
  });

  it('calls listed links a strength without pretending they work or proving code quality', () => {
    const verdict = buildRepozynVerdict(facts);
    expect(verdict.strength).toBe(`${facts.reposWithDemoUrlCount} of ${facts.originalReposCount} non-fork repositories list a demo or website link.`);
    expect(verdict.observedWeakness).toBe(false);
    expect(verdict.weakness).toMatch(/cannot confirm code quality or whether listed links work/);
  });

  it('uses a missing-description count as the supporting fact and gives one specific next action', () => {
    const verdict = buildRepozynVerdict({ ...facts, reposWithDescriptionCount: 1 });
    expect(verdict.weakness).toBe(`${facts.analyzedReposCount - 1} of ${facts.analyzedReposCount} analysed repositories have no description.`);
    expect(verdict.nextAction).toBe('Add a short description to one project you want a reviewer to open first.');
  });

  it('only reports missing preview links when both the denominator and zero coverage are known', () => {
    const verdict = buildRepozynVerdict({ ...facts, reposWithDemoUrlCount: 0 });
    expect(verdict.weakness).toBe(`None of the ${facts.originalReposCount} analysed non-fork repositories list a demo or website link.`);
    expect(verdict.nextAction).toMatch(/demo or documentation link/);
    expect(buildRepozynVerdict({ ...facts, reposWithDemoUrlCount: undefined }).observedWeakness).toBe(false);
  });

  it('handles a truly empty profile without inventing strengths or negative activity', () => {
    const empty = analyzePortfolio({ ...persona.user, bio: null, public_repos: 0 }, [], [], false).facts;
    const verdict = buildRepozynVerdict(empty);
    expect(verdict.strength).toBeUndefined();
    expect(verdict.weakness).toMatch(/0 public repositories/);
    expect(verdict.nextAction).toMatch(/Publish one small project/);
    expect(JSON.stringify(verdict)).not.toMatch(/999|days ago|NaN|undefined|Infinity|abandon|archive|lazy/i);
  });

  it.each([{}, { analyzedReposCount: 0 }, { analyzedReposCount: 0, totalPublicRepos: 8 }, { analyzedReposCount: 0, totalPublicRepos: 0, allRepos: [repo] }])('does not equate unavailable or inconsistent metadata with an empty profile: %j', (partial) => {
    const verdict = buildRepozynVerdict(partial);
    expect(verdict.observedWeakness).toBe(false);
    expect(verdict.strength).toBeUndefined();
    expect(verdict.weakness).toMatch(/does not establish that your profile is empty/);
    expect(verdict.nextAction).toMatch(/Retry the audit/);
  });

  it('discloses sampling in both the overview and evidence scope, including below the API cap', () => {
    for (const analysed of [3, 100]) {
      const verdict = buildRepozynVerdict({ analyzedReposCount: analysed, totalPublicRepos: 240 });
      expect(verdict.overview).toContain(`${analysed} of your 240 public repositories`);
      expect(verdict.scope).toContain(`${analysed} of 240 repositories analysed; this verdict covers only that sample`);
    }
  });

  it('keeps missing or malformed coverage unknown, with no fabricated zero-coverage gap', () => {
    const partial: Partial<PortfolioFacts> = { analyzedReposCount: 3, totalPublicRepos: 3, reposWithDescriptionCount: Number.NaN, originalReposCount: -1, reposWithDemoUrlCount: Infinity };
    const verdict = buildRepozynVerdict(partial);
    expect(verdict.strength).toBeUndefined();
    expect(verdict.observedWeakness).toBe(false);
    expect(verdict.weakness).toMatch(/coverage is unknown/);
    expect(JSON.stringify(verdict)).not.toMatch(/NaN|undefined|Infinity|no description|bio is empty/);
    expect(buildRepozynVerdict({ ...partial, reposWithDescriptionCount: 4 }).strength).toBeUndefined();
  });

  it('treats contradictory public totals as unknown and can use a supplied listing count', () => {
    expect(buildRepozynVerdict({ analyzedReposCount: 3, totalPublicRepos: 1 }).scope).toMatch(/total public repository count unknown/);
    expect(buildRepozynVerdict({ allRepos: [repo], totalPublicRepos: 1 }).overview).toContain('1 repository in this audit');
  });

  it('labels demo data explicitly without calling it verified GitHub evidence', () => {
    const verdict = buildRepozynVerdict(facts, true);
    expect(verdict.scope).toContain('Demo persona · synthetic sample metadata');
    expect(JSON.stringify(verdict)).not.toMatch(/verified|real GitHub/i);
  });
});

describe('repository recommendation labels', () => {
  const candidate = { ...repo, fork: false, archived: false, disabled: false, size: 20, description: 'A small API service', homepage: 'https://example.test/demo', has_pages: false };

  it('requires concrete metadata for a showcase candidate and discloses verification limits', () => {
    expect(recommendRepository(candidate)).toEqual({ label: 'Showcase candidate', reason: expect.stringContaining('Code and link availability are not verified') });
    expect(recommendRepository({ ...candidate, homepage: null, has_pages: true })?.label).toBe('Showcase candidate');
  });

  it('suggests improving a known missing description, with its supporting fact', () => {
    expect(recommendRepository({ ...candidate, description: null })).toEqual({ label: 'Improve first', reason: expect.stringContaining('has no description') });
    expect(recommendRepository({ ...candidate, description: '  ' })?.label).toBe('Improve first');
  });

  it.each([{ fork: true }, { archived: true }, { disabled: true }, { size: 0 }, { size: Infinity }, { description: undefined }, { homepage: 'javascript:alert(1)' }, { homepage: 'invalid-url' }])('does not recommend unsupported candidates: %j', (override) => {
    expect(recommendRepository({ ...candidate, ...override })).toBeNull();
  });

  it('does not turn old activity or missing fields into an archive recommendation', () => {
    expect(recommendRepository({ ...candidate, pushed_at: '2001-01-01T00:00:00Z' })?.label).toBe('Showcase candidate');
    expect(recommendRepository({})).toBeNull();
    expect(JSON.stringify(recommendRepository(candidate))).not.toMatch(/should be archived|abandon|production-ready/i);
  });
});
