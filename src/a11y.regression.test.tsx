import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('./services/github', async (importActual) => {
  const actual = await importActual<typeof import('./services/github')>();
  return { ...actual, fetchGitHubUser: vi.fn(), fetchGitHubRepos: vi.fn(), fetchRepoTree: vi.fn(), fetchReadmeContent: vi.fn(), checkRateLimit: vi.fn() };
});

import { App } from './App';
import { checkRateLimit, fetchGitHubUser, GitHubApiError } from './services/github';

// Automated accessibility checks that run on the rendered application in each of its main states.
// They cover names, labels, headings, landmarks, focus order and state attributes. Colour
// contrast and focus styling are checked statically in a11y.static.test.js.

const RATE_LIMIT = { limit: 60, remaining: 42, reset: 0, used: 18, resetMinutes: 30, resetTimeFormatted: '' };
const INTERACTIVE_ROLES = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'switch'] as const;

function expectAccessibleBasics(container: HTMLElement = document.body) {
  // Every interactive control has an accessible name
  for (const role of INTERACTIVE_ROLES) {
    for (const element of within(container).queryAllByRole(role)) {
      expect(element, `${role}: ${element.outerHTML.slice(0, 120)}`).toHaveAccessibleName();
    }
  }
  // Every form field is labelled, not just given a placeholder
  for (const field of container.querySelectorAll<HTMLElement>('input, select, textarea')) {
    const labelled = field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || (field.id && container.querySelector(`label[for="${field.id}"]`));
    expect(Boolean(labelled), `unlabelled field: ${field.outerHTML.slice(0, 120)}`).toBe(true);
  }
  // Images carry alternative text
  for (const image of container.querySelectorAll('img')) {
    expect(image.hasAttribute('alt'), image.outerHTML.slice(0, 120)).toBe(true);
  }
  // Nothing forces its own place in the tab order
  for (const element of container.querySelectorAll<HTMLElement>('[tabindex]')) {
    expect(Number(element.getAttribute('tabindex')), element.outerHTML.slice(0, 80)).toBeLessThanOrEqual(0);
  }
  // Click handlers live on real controls, apart from the documented simulator cards that wrap a switch
  for (const element of container.querySelectorAll<HTMLElement>('[role="button"]')) {
    expect(element.tabIndex).toBeGreaterThanOrEqual(0);
  }
}

function expectHeadingOrder() {
  const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++) {
    expect(levels[i] - levels[i - 1], `heading level jump at index ${i}: ${levels.join(',')}`).toBeLessThanOrEqual(1);
  }
}

describe('accessibility of the main application states', () => {
  beforeEach(() => {
    vi.mocked(checkRateLimit).mockReset().mockResolvedValue(RATE_LIMIT);
    vi.mocked(fetchGitHubUser).mockReset();
    window.history.replaceState(null, '', '/');
  });

  it('landing page: landmarks, one page heading, labelled search and a working skip link', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub username')).toBeInTheDocument();

    // The skip link is the first focusable element and points at the main region
    const firstFocusable = document.querySelector<HTMLElement>('a[href], button, input, select, textarea');
    expect(firstFocusable).toHaveTextContent('Skip to main content');
    expect(firstFocusable).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');

    expectAccessibleBasics();
    expectHeadingOrder();
  });

  it('announces audit progress and errors to assistive technology', async () => {
    let fail!: (reason: unknown) => void;
    vi.mocked(fetchGitHubUser).mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));

    render(<App />);
    const status = screen.getByTestId('audit-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('');

    const input = screen.getByLabelText('GitHub username');
    fireEvent.change(input, { target: { value: 'someone' } });
    fireEvent.submit(input.closest('form')!);
    expect(status).toHaveTextContent('Auditing GitHub profile');

    fail(new GitHubApiError('GitHub user was not found. Please verify the username.', 404));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not found/i);
    expect(status).toHaveTextContent('');
  });

  it('dashboard: names, labels, heading order and state attributes on every toggle', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Portfolio audit for alex-tutorial-hoarder');
    expect(screen.getByTestId('audit-status')).toHaveTextContent('Audit ready for alex-tutorial-hoarder.');
    expect(screen.getByLabelText('GitHub username to audit next')).toBeInTheDocument();
    expectAccessibleBasics();
    expectHeadingOrder();

    // Expand/collapse controls expose their state
    const rubricToggles = screen.getAllByRole('button', { name: /point breakdown for/i });
    expect(rubricToggles).toHaveLength(4);
    expect(rubricToggles[0]).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rubricToggles[0]);
    expect(screen.getAllByRole('button', { name: /point breakdown for/i })[0]).toHaveAttribute('aria-expanded', 'true');

    const menuToggle = within(screen.getByRole('banner')).getByRole('button', { name: /Select demo persona/i });
    expect(menuToggle).toHaveAttribute('aria-expanded', 'false');

    // Toggle groups expose which option is active
    for (const name of [/Mild/, /Medium/, /Savage/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed');
    }
    const filters = screen.getAllByRole('button', { name: /^(All|Not Forks|Forks|Missing Description|Live Demos) \(/ });
    expect(filters).toHaveLength(5);
    expect(filters.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);

    // Roadmap checkboxes and simulator switches are real, stateful controls
    for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveAttribute('aria-checked');
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toHaveAttribute('aria-checked');

    // Progress bars carry their values, not just a coloured width
    const bars = screen.getAllByRole('progressbar');
    expect(bars.length).toBeGreaterThanOrEqual(6);
    for (const bar of bars) {
      expect(bar).toHaveAccessibleName();
      expect(bar).toHaveAttribute('aria-valuenow');
      expect(bar).toHaveAttribute('aria-valuemax');
    }
  });

  it('dashboard with Evidence Intelligence results and README findings stays accessible', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-open-source-chad'));
    await screen.findAllByText('@sarah-oss-architect');

    const region = screen.getByRole('region', { name: /Evidence Intelligence/i });
    fireEvent.click(within(region).getByRole('button', { name: 'Inspect Sample Repository Evidence' }));
    await screen.findByText(/Role-aware assessment/i);
    fireEvent.click(within(region).getByRole('button', { name: /Backend Engineer/ }));
    fireEvent.click(within(region).getByRole('button', { name: 'Analyze Sample README Content' }));
    await screen.findAllByText('SAMPLE CONTENT');

    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(within(region).getByRole('group', { name: 'Target role' })).toBeInTheDocument();
    expect(within(region).getByRole('group', { name: 'Evidence summary' })).toBeInTheDocument();
    // Disclosures are native elements, so they are keyboard-operable without extra scripting
    const disclosures = region.querySelectorAll('details');
    expect(disclosures.length).toBeGreaterThanOrEqual(5);
    for (const disclosure of disclosures) {
      expect(disclosure.querySelector(':scope > summary')?.textContent?.trim().length).toBeGreaterThan(3);
    }
    expectAccessibleBasics();
    expectHeadingOrder();
  });

  it.each([
    ['token settings', /Open GitHub personal access token settings/i],
    ['profile makeover', /Profile Makeover/i],
    ['export report', /Export Report/i],
  ])('%s dialog: labelled, modal, closes on Escape and returns focus', async (_name, trigger) => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-persona-tutorial-hoarder'));
    await screen.findAllByText('@alex-tutorial-hoarder');

    const opener = screen.getByRole('button', { name: trigger });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
    // Focus moves into the dialog shortly after it opens
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expectAccessibleBasics(dialog);

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });
});
