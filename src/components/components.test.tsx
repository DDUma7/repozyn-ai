import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchHero } from './SearchHero';
import { RecruiterImpressionCard } from './RecruiterImpressionCard';
import { RoastSection } from './RoastSection';
import { RescueRoadmapSection } from './RescueRoadmapSection';
import { MarkdownReportModal } from './MarkdownReportModal';
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
    expect(screen.getByText(/10-Second Scan Verdict/i)).toBeInTheDocument();
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
    const report = analyzePortfolio(sampleMock.user, sampleMock.repos, [], true);

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
});
