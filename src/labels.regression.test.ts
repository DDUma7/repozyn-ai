import { describe, it, expect } from 'vitest';
import { MOCK_PROFILES } from './data/mockProfiles';
import { analyzePortfolio } from './services/analyzer';
import { formatReportToMarkdown } from './utils/markdownReport';
import { generateProfileReadme } from './utils/profileMakeover';

describe('Synthetic persona labelling in generated Markdown', () => {
  const persona = MOCK_PROFILES[0];

  it('marks exported audit reports for demo personas as sample data', () => {
    const md = formatReportToMarkdown(analyzePortfolio(persona.user, persona.repos, [], true));
    expect(md).toMatch(/Sample Persona Data/);
    expect(md).toMatch(/synthetic sample data, not a real GitHub profile/i);
    expect(md).not.toMatch(/verified/i);
    expect(md).not.toMatch(/Real REST API Data/);
  });

  it('keeps the verified heading for real profile reports', () => {
    const md = formatReportToMarkdown(analyzePortfolio(persona.user, persona.repos, [], false));
    expect(md).toContain('Verified GitHub Facts (Real REST API Data)');
    expect(md).not.toMatch(/sample/i);
  });

  it('marks generated profile READMEs for demo personas as sample data', () => {
    const { facts } = analyzePortfolio(persona.user, persona.repos, [], true);
    const sample = generateProfileReadme(facts, { isMockData: true }).markdown;
    expect(sample).toMatch(/not real GitHub data/i);
    expect(sample).toContain('Portfolio Highlights (Sample Demo Data)');
    expect(sample).toContain('Sample Persona Data');
    expect(sample).not.toMatch(/verified/i);

    const real = generateProfileReadme(facts).markdown;
    expect(real).toContain('Verified Portfolio Highlights');
    expect(real).not.toMatch(/sample/i);
  });
});
