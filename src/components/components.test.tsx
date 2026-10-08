import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchHero } from './SearchHero';
import { RecruiterImpressionCard } from './RecruiterImpressionCard';
import { RoastSection } from './RoastSection';
import { RescueRoadmapSection } from './RescueRoadmapSection';
import { MarkdownReportModal } from './MarkdownReportModal';
import { ProfileMakeoverModal } from './ProfileMakeoverModal';
import { TokenModal } from './TokenModal';
import { PortfolioSimulatorSection } from './PortfolioSimulatorSection';
import { formatReportToMarkdown } from '../utils/markdownReport';
import { App } from '../App';
import { MOCK_PROFILES } from '../data/mockProfiles';
import { analyzePortfolio } from '../services/analyzer';

describe('UI Components and Dashboard', () => {
  it('renders SearchHero with input, buttons, and handles search triggers', () => {
    const handleSearch = vi.fn();
    const handleSelectMock = vi.fn();
    const handleClearError = vi.fn();

    render(
      <SearchHero
        onSearch={handleSearch}
        onSelectMock={handleSelectMock}
        isLoading={false}
        error={null}
        onClearError={handleClearError}
      />
    );

    const input = screen.getByPlaceholderText(/Enter GitHub username/i);
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'testuser' } });
    fireEvent.submit(input.closest('form')!);

    expect(handleSearch).toHaveBeenCalledWith('testuser');

    // Click a popular handle
    const torvaldsBtn = screen.getByText('@torvalds');
    fireEvent.click(torvaldsBtn);
    expect(handleSearch).toHaveBeenCalledWith('torvalds');
  });

  it('renders RecruiterImpressionCard with archetype, flags, and verdict', () => {
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    render(<RecruiterImpressionCard recruiter={report.recruiter} />);

    expect(screen.getByText(report.recruiter.archetype)).toBeInTheDocument();
    expect(screen.getByText(report.recruiter.hireabilitySignal)).toBeInTheDocument();
    expect(screen.getByText(/Quick-Scan Verdict/i)).toBeInTheDocument();
  });

  it('renders RoastSection and switches tones between mild, medium, and savage', () => {
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    render(<RoastSection roasts={report.roasts} />);

    expect(screen.getByText(/The Honest Roast/i)).toBeInTheDocument();

    const mildTab = screen.getByText(/Mild/i);
    const savageTab = screen.getByText(/Savage/i);

    fireEvent.click(mildTab);
    expect(mildTab).toBeInTheDocument();

    fireEvent.click(savageTab);
    expect(savageTab).toBeInTheDocument();
  });

  it('renders RescueRoadmapSection and toggles checklist items', () => {
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    render(<RescueRoadmapSection roadmap={report.roadmap} />);

    expect(screen.getByText(/Your Rescue Roadmap/i)).toBeInTheDocument();
    expect(screen.getByText(/Rescue Progress/i)).toBeInTheDocument();

    // Check first action item
    const checkButtons = screen.getAllByTitle(/Mark as done/i);
    expect(checkButtons.length).toBeGreaterThan(0);

    fireEvent.click(checkButtons[0]);
    // The button title changes to Mark as incomplete
    expect(screen.getByTitle(/Mark as incomplete/i)).toBeInTheDocument();
  });

  it('formats markdown report with complete sections and handles modal', () => {
    const sampleMock = MOCK_PROFILES[1];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], false);

    const md = formatReportToMarkdown(report);
    expect(md).toContain('# 🚀 Repozyn AI: GitHub Portfolio Audit & Roast');
    expect(md).toContain('Verified GitHub Facts');
    expect(md).toContain('Recruiter First Impression');
    expect(md).toContain('Evidence-Based Roasts');
    expect(md).toContain('Actionable Rescue Roadmap');

    const handleClose = vi.fn();
    render(<MarkdownReportModal isOpen={true} onClose={handleClose} report={report} />);

    expect(screen.getByText(/Export Audit Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy Markdown/i)).toBeInTheDocument();
  });

  it('renders full App and loads a mock persona seamlessly', async () => {
    render(<App />);

    expect(screen.getAllByText(/Repozyn AI/i)[0]).toBeInTheDocument();
    expect(screen.getByText(/Audit Your Portfolio/i)).toBeInTheDocument();

    // Find and click the first instant persona
    const personaButton = screen.getByTestId('mock-persona-tutorial-hoarder');
    fireEvent.click(personaButton);
    // Wait for analysis to show
    const usernameElements = await screen.findAllByText('@alex-tutorial-hoarder');
    expect(usernameElements.length).toBeGreaterThan(0);

    // Verify all 4 sections render
    expect(screen.getByText(/Portfolio Health Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/The Honest Roast/i)).toBeInTheDocument();
    expect(screen.getByText(/Your Rescue Roadmap/i)).toBeInTheDocument();
    expect(screen.getByText(/Repository Health Explorer/i)).toBeInTheDocument();
  });

  it('complies with accessibility requirements (ARIA roles, dialogs, labels, and landmarks)', () => {
    const handleClose = vi.fn();
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    // 1. Modal Accessibility
    const { unmount: unmountModal } = render(
      <MarkdownReportModal isOpen={true} onClose={handleClose} report={report} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'report-modal-title');
    expect(screen.getByLabelText(/Close export dialog/i)).toBeInTheDocument();
    unmountModal();

    // 2. Search Accessibility
    const { unmount: unmountHero } = render(
      <SearchHero
        onSearch={vi.fn()}
        onSelectMock={vi.fn()}
        isLoading={false}
        error="Sample error"
        onClearError={vi.fn()}
      />
    );
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText(/GitHub username/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Sample error/i);
    unmountHero();

    // 3. Roadmap Checkbox Accessibility
    render(<RescueRoadmapSection roadmap={report.roadmap} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('renders ProfileMakeoverModal with editable markdown, tab switching, and actions', () => {
    const handleClose = vi.fn();
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], false);

    render(
      <ProfileMakeoverModal isOpen={true} onClose={handleClose} report={report} />
    );

    // Dialog exists and is accessible
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Title and verified badge
    expect(screen.getByText(/GitHub Profile Makeover/i)).toBeInTheDocument();
    expect(screen.getByText(/VERIFIED DATA ONLY/i)).toBeInTheDocument();

    // Editable textarea exists
    const textarea = screen.getByLabelText(/Editable GitHub Profile README Markdown/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toContain('# Hi there');

    // User can edit the markdown
    fireEvent.change(textarea, { target: { value: '# Custom User Edit' } });
    expect(textarea.value).toBe('# Custom User Edit');

    // Reset button appears and restores original template
    const resetBtn = screen.getByText(/Reset/i);
    fireEvent.click(resetBtn);
    expect(textarea.value).toContain('# Hi there');

    // Tab switching to Live Preview
    const previewTab = screen.getByRole('button', { name: /Live Preview/i });
    fireEvent.click(previewTab);
    expect(screen.getByText(/Previewing rendered GitHub Profile README/i)).toBeInTheDocument();

    // Tab switching back to editor
    const editorTab = screen.getByRole('button', { name: /Editable Markdown/i });
    fireEvent.click(editorTab);
    expect(screen.getByLabelText(/Editable GitHub Profile README Markdown/i)).toBeInTheDocument();

    // Action buttons
    expect(screen.getByText(/Download README.md/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy README.md/i)).toBeInTheDocument();
  });

  it('renders PortfolioSimulatorSection, models improvements, and resets state', () => {
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    render(<PortfolioSimulatorSection facts={report.facts} />);

    // Section title and baseline score
    expect(
      screen.getByText(/Before & After Portfolio Rescue Simulator/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Verified Baseline/i)).toBeInTheDocument();
    expect(screen.getByText(/Projected Score/i)).toBeInTheDocument();

    // Verify baseline score appears
    expect(screen.getAllByText(report.scoring.totalScore.toString()).length).toBeGreaterThanOrEqual(1);

    // Initial state: +0 pts
    expect(screen.getByText('+0')).toBeInTheDocument();

    // Click "Simulate All Fixes"
    const simulateAllBtn = screen.getByRole('button', { name: /Simulate All Fixes/i });
    fireEvent.click(simulateAllBtn);

    // Delta should now be greater than 0
    expect(screen.queryByText('+0')).not.toBeInTheDocument();

    // Reset button should now be visible
    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);

    // Reset should bring delta back to +0 pts
    expect(screen.getByText('+0')).toBeInTheDocument();
  });

  it('closes TokenModal and MarkdownReportModal on Escape key and exposes accessible attributes', () => {
    const handleCloseToken = vi.fn();
    const handleSaveToken = vi.fn();
    const handleClearToken = vi.fn();
    const handleRateLimitUpdate = vi.fn();

    const { unmount } = render(
      <TokenModal
        isOpen={true}
        onClose={handleCloseToken}
        savedToken=""
        onSaveToken={handleSaveToken}
        onClearToken={handleClearToken}
        onRateLimitUpdate={handleRateLimitUpdate}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleCloseToken).toHaveBeenCalledTimes(1);
    unmount();

    // MarkdownReportModal Escape
    const handleCloseReport = vi.fn();
    const sampleMock = MOCK_PROFILES[0];
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

    render(
      <MarkdownReportModal
        isOpen={true}
        onClose={handleCloseReport}
        report={report}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleCloseReport).toHaveBeenCalledTimes(1);
  });

  it('exposes accessible aria-pressed attributes on roast tone selectors', () => {
    const roasts = [
      {
        id: 'r1',
        title: 'Mild Roast',
        roast: 'Needs work',
        severity: 'mild' as const,
        pillar: 'Documentation' as const,
        category: 'repo-hygiene' as const,
        evidence: 'No readme',
      },
      {
        id: 'r2',
        title: 'Spicy Roast',
        roast: 'Disaster',
        severity: 'spicy' as const,
        pillar: 'Hygiene' as const,
        category: 'repo-hygiene' as const,
        evidence: 'No license',
      },
    ];

    render(<RoastSection roasts={roasts} />);

    const mildBtn = screen.getByRole('button', { name: /Mild/i });
    const medBtn = screen.getByRole('button', { name: /Medium/i });
    const savageBtn = screen.getByRole('button', { name: /Savage/i });

    // Medium is default
    expect(medBtn).toHaveAttribute('aria-pressed', 'true');
    expect(mildBtn).toHaveAttribute('aria-pressed', 'false');

    // Click Mild
    fireEvent.click(mildBtn);
    expect(mildBtn).toHaveAttribute('aria-pressed', 'true');
    expect(medBtn).toHaveAttribute('aria-pressed', 'false');

    // Click Savage
    fireEvent.click(savageBtn);
    expect(savageBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
