import { describe, it, expect } from 'vitest';
import {
  sanitizeMarkdownText,
  sanitizeUrl,
  getLanguageBadge,
  generateProfileReadme,
} from './profileMakeover';
import type { PortfolioFacts } from '../types/analysis';
import type { GitHubRepo } from '../types/github';

describe('GitHub Profile Makeover Generator', () => {
  const baseMockFacts: PortfolioFacts = {
    username: 'octocat',
    name: 'The Octocat',
    avatarUrl: 'https://github.com/octocat.png',
    profileUrl: 'https://github.com/octocat',
    bio: 'Building awesome open source tools for the world.',
    company: 'GitHub Inc.',
    location: 'San Francisco, CA',
    website: 'https://octocat.io',
    hasBio: true,
    hasLocation: true,
    hasWebsite: true,
    accountAgeYears: 5,
    createdAtFormatted: 'Jan 2021',
    followersCount: 1337,
    followingCount: 42,
    totalPublicRepos: 12,
    analyzedReposCount: 12,
    originalReposCount: 10,
    forkedReposCount: 2,
    archivedReposCount: 0,
    totalStarsEarned: 520,
    totalForksCount: 88,
    languagesBreakdown: {
      TypeScript: { count: 6, percentage: 50 },
      Python: { count: 4, percentage: 33 },
    },
    topLanguages: ['TypeScript', 'Python'],
    reposWithDescriptionCount: 11,
    reposWithDescriptionPercentage: 92,
    reposWithLicenseCount: 10,
    reposWithLicensePercentage: 100,
    reposWithDemoUrlCount: 3,
    reposWithDemoUrlPercentage: 25,
    reposWithTopicsCount: 8,
    daysSinceLastPush: 2,
    recentPushesCount30d: 8,
    staleReposCount: 1,
    topStarredRepos: [],
    allRepos: [
      {
        id: 101,
        name: 'super-engine',
        full_name: 'octocat/super-engine',
        html_url: 'https://github.com/octocat/super-engine',
        description: 'Blazing fast computation engine for data pipelines',
        fork: false,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        pushed_at: '2026-10-06T00:00:00Z',
        homepage: 'https://super-engine.io',
        size: 1024,
        stargazers_count: 350,
        watchers_count: 350,
        language: 'TypeScript',
        forks_count: 45,
        archived: false,
        disabled: false,
        open_issues_count: 2,
        license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: null },
        topics: ['engine', 'typescript'],
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        has_pages: true,
        default_branch: 'main',
      },
    ],
  };

  describe('Sanitization & Security', () => {
    it('strips dangerous HTML script and iframe tags from untrusted text', () => {
      const malicious = 'Great project <script>alert("pwned")</script> <iframe src="evil.com"></iframe>';
      const clean = sanitizeMarkdownText(malicious);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('alert');
      expect(clean).not.toContain('iframe');
    });

    it('strips inline HTML event handlers (onload, onerror)', () => {
      const xss = 'My repo <img src=x onerror=alert(1)> description';
      const clean = sanitizeMarkdownText(xss);
      expect(clean).not.toContain('onerror');
      expect(clean).not.toContain('alert');
    });

    it('escapes pipe characters to avoid corrupting Markdown tables', () => {
      const textWithPipes = 'Column A | Column B | Exploit';
      const clean = sanitizeMarkdownText(textWithPipes);
      expect(clean).toContain('\\|');
      expect(clean).toBe('Column A \\| Column B \\| Exploit');
    });

    it('escapes markdown brackets and backticks to prevent link hijacking', () => {
      const malicious = '[Injected Link](http://evil.com) and `code`';
      const clean = sanitizeMarkdownText(malicious);
      expect(clean).toContain('\\[Injected Link\\]');
      expect(clean).toContain('\\`code\\`');
    });

    it('neutralizes malicious javascript:, data:, vbscript:, or malformed URLs', () => {
      expect(sanitizeUrl('javascript:alert(document.cookie)')).toBe('#');
      expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('#');
      expect(sanitizeUrl('vbscript:msgbox("xss")')).toBe('#');
      expect(sanitizeUrl('file:///etc/passwd')).toBe('#');
      expect(sanitizeUrl('blob:https://example.com/uuid')).toBe('#');
      expect(sanitizeUrl('https://evil.com" onmouseover="alert(1) ')).toBe('#');
      expect(sanitizeUrl('https://validportfolio.com')).toBe('https://validportfolio.com');
      expect(sanitizeUrl('myblog.dev')).toBe('https://myblog.dev');
    });
  });

  describe('Full Verified Data Generation', () => {
    it('generates a personalized profile README using exclusively verified data', () => {
      const result = generateProfileReadme(baseMockFacts);
      const md = result.markdown;

      // Greeting & verified bio
      expect(md).toContain('# Hi there, I\'m The Octocat 👋');
      expect(md).toContain('> "Building awesome open source tools for the world."');

      // Verified work & location
      expect(md).toContain('GitHub Inc.');
      expect(md).toContain('San Francisco, CA');
      expect(md).toContain('https://octocat.io');

      // Verified languages
      expect(md).toContain('TypeScript');
      expect(md).toContain('Python');

      // Verified real featured project
      expect(md).toContain('### 🚀 [super-engine](https://github.com/octocat/super-engine)');
      expect(md).toContain('Blazing fast computation engine for data pipelines');
      expect(md).toContain('⭐ 350 stars');
      expect(md).toContain('⚖️ MIT');
      expect(md).toContain('https://super-engine.io');

      // Verified statistics table
      expect(md).toContain('| 📦 **Public Repositories** |');
      expect(md).toContain('| ⭐ **Community Stars** |');
      expect(md).toContain('520');
      // No unvetted third-party endpoint
      expect(md).not.toContain('github-readme-stats.vercel.app');

      // Zero missing critical suggestions when facts are complete
      expect(result.missingSuggestions.some((s) => s.field === 'bio')).toBe(false);
      expect(result.missingSuggestions.some((s) => s.field === 'website')).toBe(false);
    });

    it('generates official language badges for detected technologies', () => {
      const tsBadge = getLanguageBadge('TypeScript');
      expect(tsBadge).toContain('TypeScript-3178C6');
      expect(tsBadge).toContain('logo=typescript');

      const pyBadge = getLanguageBadge('Python');
      expect(pyBadge).toContain('Python-3776AB');
      expect(pyBadge).toContain('logo=python');
    });
  });

  describe('Missing Information & Suggestion Handling (Never Fabricates Data)', () => {
    it('labels missing bio with suggestion and records it in missingSuggestions', () => {
      const factsWithoutBio: PortfolioFacts = {
        ...baseMockFacts,
        bio: null,
        hasBio: false,
      };

      const result = generateProfileReadme(factsWithoutBio);

      expect(result.markdown).toContain('<!-- 💡 Suggestion: Add a 1-sentence headline bio');
      expect(result.missingSuggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'bio',
            label: 'Profile Bio is Empty',
          }),
        ])
      );
    });

    it('labels missing company and location without inventing jobs or cities', () => {
      const factsWithoutLocationOrCompany: PortfolioFacts = {
        ...baseMockFacts,
        company: null,
        location: null,
        website: null,
        hasLocation: false,
        hasWebsite: false,
      };

      const result = generateProfileReadme(factsWithoutLocationOrCompany);

      expect(result.markdown).toContain('<!-- 💡 Suggestion: Add your current affiliation');
      expect(result.markdown).toContain('<!-- 💡 Suggestion: Add your location');
      expect(result.markdown).toContain('<!-- 💡 Suggestion: Link your portfolio website');

      expect(result.missingSuggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'company' }),
          expect.objectContaining({ field: 'location' }),
          expect.objectContaining({ field: 'website' }),
        ])
      );
    });

    it('gracefully handles user with zero public repositories without hallucinating projects', () => {
      const zeroReposFacts: PortfolioFacts = {
        ...baseMockFacts,
        totalPublicRepos: 0,
        analyzedReposCount: 0,
        originalReposCount: 0,
        forkedReposCount: 0,
        totalStarsEarned: 0,
        topLanguages: [],
        languagesBreakdown: {},
        allRepos: [],
      };

      const result = generateProfileReadme(zeroReposFacts);

      expect(result.markdown).toContain('<!-- 💡 Suggestion: Publish 2-3 original open-source projects');
      expect(result.markdown).toContain('<!-- 💡 Suggestion: Publish public repositories');
      expect(result.missingSuggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'projects' }),
          expect.objectContaining({ field: 'languages' }),
        ])
      );
    });

    it('flags repository missing description with clear suggestion comment', () => {
      const repoWithoutDesc: GitHubRepo = {
        ...baseMockFacts.allRepos[0],
        name: 'mystery-box',
        description: null,
        homepage: null,
      };

      const facts: PortfolioFacts = {
        ...baseMockFacts,
        allRepos: [repoWithoutDesc],
      };

      const result = generateProfileReadme(facts);

      expect(result.markdown).toContain('<!-- 💡 Suggestion: Add a 1-sentence description on GitHub');
      expect(result.missingSuggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'desc_mystery-box',
            label: '"mystery-box" Missing Description',
          }),
        ])
      );
    });
  });
});
