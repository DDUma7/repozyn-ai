import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MOCK_PROFILES } from '../data/mockProfiles';
import { analyzePortfolio } from '../services/analyzer';
import { RepozynVerdict } from './RepozynVerdict';
import { RecruiterImpressionCard } from './RecruiterImpressionCard';
import { RepositoryExplorer } from './RepositoryExplorer';

describe('Repozyn Verdict presentation', () => {
  it('integrates with recruiter assessment while replacing the previous verdict paragraph', () => {
    const persona = MOCK_PROFILES[0];
    const report = analyzePortfolio(persona.user, persona.repos, [], true);
    render(<RecruiterImpressionCard recruiter={report.recruiter} facts={report.facts} isMockData />);
    const region = screen.getByRole('region', { name: 'Repozyn Verdict — Your GitHub in 30 Seconds' });
    expect(within(region).getByRole('heading', { level: 4 })).toHaveTextContent('Repozyn Verdict');
    expect(region).toHaveTextContent('Observed strength:');
    expect(region).toHaveTextContent('Main gap:');
    expect(region).toHaveTextContent('Next action:');
    expect(region).toHaveTextContent('synthetic sample metadata');
    expect(screen.queryByText(report.recruiter.tenSecondVerdict)).not.toBeInTheDocument();
    expect(screen.getByText(/Explore the recruiter reasoning/)).toBeInTheDocument();
  });

  it('omits the strength row for an empty profile without supported positive evidence', () => {
    render(<RepozynVerdict facts={{ analyzedReposCount: 0, totalPublicRepos: 0, bio: null }} />);
    expect(screen.queryByText('Observed strength:')).not.toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('0 public repositories');
    expect(screen.getByRole('region')).toHaveTextContent('Publish one small project');
  });

  it('shows assessment limits and partial-sample disclosure without asserting an observed weakness', () => {
    render(<RepozynVerdict facts={{ analyzedReposCount: 100, totalPublicRepos: 240 }} />);
    expect(screen.queryByText('Main gap:')).not.toBeInTheDocument();
    expect(screen.getByText('Assessment limit:')).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('this verdict covers only that sample');
  });

  it('renders grounded repository labels with accessible explanations and excludes archived repositories', () => {
    const repo = MOCK_PROFILES[1].repos[0];
    render(<RepositoryExplorer repos={[
      { ...repo, id: 1, fork: false, archived: false, disabled: false, size: 10, description: 'An API service', homepage: 'https://example.test/demo' },
      { ...repo, id: 2, fork: false, archived: false, disabled: false, size: 10, description: null },
      { ...repo, id: 3, fork: false, archived: true, disabled: false, size: 10, description: null },
    ]} />);
    expect(screen.getAllByText('Showcase candidate')).toHaveLength(1);
    expect(screen.getAllByText('Improve first')).toHaveLength(1);
    expect(screen.getByText(/Code and link availability are not verified/)).toBeInTheDocument();
  });
});
