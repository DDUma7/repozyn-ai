import type { PortfolioFacts } from '../types/analysis';

export interface ProfileMakeoverSuggestion {
  field: string;
  label: string;
  suggestion: string;
  severity: 'recommended' | 'optional';
}

export interface ProfileMakeoverResult {
  markdown: string;
  missingSuggestions: ProfileMakeoverSuggestion[];
}

/**
 * Escapes characters that break Markdown formatting or tables,
 * and strips dangerous HTML tags from untrusted user/repo data.
 */
export function sanitizeMarkdownText(text: string | null | undefined): string {
  if (!text) return '';

  return (
    text
      // Strip dangerous HTML script, iframe, and event handler tags
      .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*(?:iframe|embed|object|form|input|style)[^>]*>[\s\S]*?<\s*\/\s*(?:iframe|embed|object|form|input|style)\s*>/gi, '')
      .replace(/<[^>]*on\w+\s*=[^>]*>/gi, '')
      // Strip generic angle brackets to avoid raw HTML injection while preserving text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Escape brackets to prevent hijacking markdown link anchors [text](url)
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      // Escape backticks to avoid broken code blocks
      .replace(/`/g, '\\`')
      // Escape pipes for markdown tables
      .replace(/\|/g, '\\|')
      // Collapse excessive blank lines
      .replace(/\r\n/g, '\n')
      .trim()
  );
}

/**
 * Safely sanitizes external URLs to ensure only valid http/https schemes are rendered.
 * Blocks javascript:, data:, file:, vbscript:, blob:, and dangerous characters.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  // Reject spaces, quotes, angle brackets, or control characters
  if (/[\s"'<>\\]/.test(trimmed)) {
    return '#';
  }
  if (/^(?:javascript|data|file|vbscript|blob):/i.test(trimmed)) {
    return '#';
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  // If bare domain (e.g. portfolio.dev), prepend https://
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return '#';
}

const LANGUAGE_BADGES: Record<string, { color: string; logo: string; logoColor: string }> = {
  TypeScript: { color: '3178C6', logo: 'typescript', logoColor: 'white' },
  JavaScript: { color: 'F7DF1E', logo: 'javascript', logoColor: 'black' },
  Python: { color: '3776AB', logo: 'python', logoColor: 'white' },
  Rust: { color: '000000', logo: 'rust', logoColor: 'white' },
  Go: { color: '00ADD8', logo: 'go', logoColor: 'white' },
  Java: { color: 'ED8B00', logo: 'openjdk', logoColor: 'white' },
  'C++': { color: '00599C', logo: 'c%2B%2B', logoColor: 'white' },
  'C#': { color: '239120', logo: 'csharp', logoColor: 'white' },
  C: { color: 'A8B9CC', logo: 'c', logoColor: 'white' },
  HTML: { color: 'E34F26', logo: 'html5', logoColor: 'white' },
  CSS: { color: '1572B6', logo: 'css3', logoColor: 'white' },
  PHP: { color: '777BB4', logo: 'php', logoColor: 'white' },
  Ruby: { color: 'CC342D', logo: 'ruby', logoColor: 'white' },
  Swift: { color: 'F05138', logo: 'swift', logoColor: 'white' },
  Kotlin: { color: '7F52FF', logo: 'kotlin', logoColor: 'white' },
  Shell: { color: '121011', logo: 'gnu-bash', logoColor: 'white' },
  Vue: { color: '4FC08D', logo: 'vuedotjs', logoColor: 'white' },
  Dart: { color: '0175C2', logo: 'dart', logoColor: 'white' },
};

export function getLanguageBadge(lang: string): string {
  const badgeInfo = LANGUAGE_BADGES[lang];
  if (badgeInfo) {
    return `![${lang}](https://img.shields.io/badge/${encodeURIComponent(lang)}-${badgeInfo.color}?style=for-the-badge&logo=${badgeInfo.logo}&logoColor=${badgeInfo.logoColor})`;
  }
  return `![${lang}](https://img.shields.io/badge/${encodeURIComponent(lang)}-4F46E5?style=for-the-badge)`;
}

/**
 * Generates a personalized, copy-ready GitHub Profile README.md
 * using STRICTLY verified GitHub REST API facts. Never invents data.
 */
export function generateProfileReadme(
  facts: PortfolioFacts,
  options: { isMockData?: boolean } = {}
): ProfileMakeoverResult {
  // Synthetic demo personas must never be presented as verified GitHub data
  const isMockData = Boolean(options.isMockData);
  const missingSuggestions: ProfileMakeoverSuggestion[] = [];

  const displayName = sanitizeMarkdownText(facts.name || facts.username);

  // 1. Bio & Identity Suggestions
  let bioSection = '';
  if (facts.bio) {
    bioSection = `> "${sanitizeMarkdownText(facts.bio)}"\n`;
  } else {
    bioSection = `<!-- 💡 Suggestion: Add a 1-sentence headline bio in GitHub Settings > Public Profile (e.g. "Full-Stack Engineer building distributed systems") -->\n`;
    missingSuggestions.push({
      field: 'bio',
      label: 'Profile Bio is Empty',
      suggestion: 'Add a 1-sentence headline bio on GitHub to give recruiters instant context.',
      severity: 'recommended',
    });
  }

  // 2. Verified About Me Details
  const aboutItems: string[] = [];
  if (facts.company) {
    aboutItems.push(`- 🏢 Working at **${sanitizeMarkdownText(facts.company)}**`);
  } else {
    aboutItems.push(`<!-- 💡 Suggestion: Add your current affiliation, university, or independent status in GitHub settings -->`);
    missingSuggestions.push({
      field: 'company',
      label: 'Company / Affiliation Missing',
      suggestion: 'Specify your current role, university, or company to show professional presence.',
      severity: 'optional',
    });
  }

  if (facts.location) {
    aboutItems.push(`- 📍 Based in **${sanitizeMarkdownText(facts.location)}**`);
  } else {
    aboutItems.push(`<!-- 💡 Suggestion: Add your location (e.g. San Francisco, Remote) to unlock local and timezone-matched opportunities -->`);
    missingSuggestions.push({
      field: 'location',
      label: 'Location Missing',
      suggestion: 'Add your city or timezone to help recruiters match local/remote roles.',
      severity: 'optional',
    });
  }

  if (facts.website) {
    const cleanWeb = sanitizeUrl(facts.website);
    const label = sanitizeMarkdownText(facts.website.replace(/^https?:\/\//, ''));
    aboutItems.push(`- 🌐 Portfolio: [${label}](${cleanWeb})`);
  } else {
    aboutItems.push(`<!-- 💡 Suggestion: Link your portfolio website, blog, or resume in your GitHub settings -->`);
    missingSuggestions.push({
      field: 'website',
      label: 'Portfolio / Website Not Linked',
      suggestion: 'Link your portfolio, LinkedIn, or personal blog so hiring managers can inspect live work.',
      severity: 'recommended',
    });
  }

  aboutItems.push(`- ⚡ Active on GitHub since **${facts.createdAtFormatted}** with **${facts.totalPublicRepos} public repositories**`);

  // 3. Technologies & Stack (Only verified detected languages)
  let techStackSection = '';
  if (facts.topLanguages && facts.topLanguages.length > 0) {
    const badges = facts.topLanguages.map((lang) => getLanguageBadge(lang)).join(' ');
    techStackSection = `## 🛠️ Languages & Technologies\n\n${badges}\n`;
  } else {
    techStackSection = `## 🛠️ Languages & Technologies\n\n<!-- 💡 Suggestion: Publish public repositories with code to automatically detect your tech stack, or add badges here manually -->\n`;
    missingSuggestions.push({
      field: 'languages',
      label: 'No Languages Detected',
      suggestion: 'No primary languages detected across public repos. Publish code to highlight your skills.',
      severity: 'recommended',
    });
  }

  // 4. Featured Projects (Only verified top original or starred repos)
  let projectsSection = '';
  const originalRepos = facts.allRepos.filter((r) => !r.fork);
  const featuredRepos = originalRepos.length > 0 ? originalRepos.slice(0, 4) : facts.allRepos.slice(0, 4);

  if (featuredRepos.length > 0) {
    const projectBlocks = featuredRepos.map((repo) => {
      const safeName = sanitizeMarkdownText(repo.name);
      const safeDesc = repo.description
        ? sanitizeMarkdownText(repo.description)
        : '*<!-- 💡 Suggestion: Add a 1-sentence description on GitHub to describe what this project does -->*';

      if (!repo.description) {
        if (!missingSuggestions.some((s) => s.field === `desc_${repo.name}`)) {
          missingSuggestions.push({
            field: `desc_${repo.name}`,
            label: `"${repo.name}" Missing Description`,
            suggestion: `Add a clear "About" description in repository settings to explain its value.`,
            severity: 'recommended',
          });
        }
      }

      const metaPills: string[] = [];
      if (repo.language) metaPills.push(`\`${sanitizeMarkdownText(repo.language)}\``);
      metaPills.push(`⭐ ${repo.stargazers_count} stars`);
      if (repo.forks_count > 0) metaPills.push(`🍴 ${repo.forks_count} forks`);
      if (repo.license?.spdx_id) {
        metaPills.push(`⚖️ ${sanitizeMarkdownText(repo.license.spdx_id)}`);
      } else {
        metaPills.push(`<!-- ⚖️ Add open-source license -->`);
      }

      let demoLink = '';
      if (repo.homepage) {
        demoLink = `\n- 🔗 **Live Demo:** [${sanitizeUrl(repo.homepage)}](${sanitizeUrl(repo.homepage)})`;
      }

      return `### 🚀 [${safeName}](${sanitizeUrl(repo.html_url)})
${safeDesc}
- ${metaPills.join(' • ')}${demoLink}
`;
    });

    projectsSection = `## 🌟 Featured Projects\n\n${projectBlocks.join('\n')}`;
  } else {
    projectsSection = `## 🌟 Featured Projects\n\n<!-- 💡 Suggestion: Publish 2-3 original open-source projects or portfolio highlights to pin here -->\n`;
    missingSuggestions.push({
      field: 'projects',
      label: 'No Non-Fork Projects',
      suggestion: 'Create and pin repositories you started yourself, each with a README that explains it.',
      severity: 'recommended',
    });
  }

  // Check general documentation coverage suggestion
  if (facts.reposWithDescriptionPercentage < 80 && facts.analyzedReposCount > 0) {
    if (!missingSuggestions.some((s) => s.field === 'repo_descriptions_overall')) {
      missingSuggestions.push({
        field: 'repo_descriptions_overall',
        label: 'Low Repository Description Coverage',
        suggestion: `Only ${facts.reposWithDescriptionPercentage}% of repositories have descriptions. Aim for 90%+ for recruiter clarity.`,
        severity: 'recommended',
      });
    }
  }

  // Check license coverage suggestion
  if (facts.reposWithLicensePercentage < 50 && facts.originalReposCount > 0) {
    missingSuggestions.push({
      field: 'license_coverage',
      label: 'Low Open-Source License Coverage',
      suggestion: `Add standard open-source licenses (MIT, Apache 2.0) to your original repositories.`,
      severity: 'optional',
    });
  }

  // 5. Verified GitHub Stats Table (100% Native Markdown, zero unverified third-party endpoints)
  const statsSection = `## 📊 ${isMockData ? 'Portfolio Highlights (Sample Demo Data)' : 'Verified Portfolio Highlights'}

| Metric | ${isMockData ? 'Sample Persona Data' : 'Verified GitHub Data'} |
| :--- | :--- |
| 📦 **Public Repositories** | **${facts.totalPublicRepos}** (${facts.originalReposCount} not forked) |
| ⭐ **Community Stars** | **${facts.totalStarsEarned}** stars earned across public projects |
| 🛠️ **Primary Languages** | ${facts.topLanguages.join(', ') || 'None detected'} |
| 👥 **Followers & Community** | **${facts.followersCount}** followers • **${facts.followingCount}** following |
| 📅 **GitHub Tenure** | Member since **${facts.createdAtFormatted}** (${facts.accountAgeYears} years) |
`;

  // 6. Connect / Footer
  const connectItems: string[] = [
    `[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat&logo=github&logoColor=white)](${sanitizeUrl(facts.profileUrl)})`,
  ];
  if (facts.website) {
    connectItems.push(
      `[![Portfolio](https://img.shields.io/badge/Portfolio-2563EB?style=flat&logo=safari&logoColor=white)](${sanitizeUrl(
        facts.website
      )})`
    );
  }

  const connectSection = `## 📬 Connect With Me

${connectItems.join(' ')}

<!-- 💡 Suggestion: Add LinkedIn, Twitter/X, or email badges above to make outreach effortless for recruiters -->
`;

  // Assemble Complete Markdown
  const sampleNotice = isMockData
    ? `<!-- ⚠️ Sample README generated from a synthetic Repozyn demo persona. This is not real GitHub data. -->\n\n`
    : '';

  const markdown = `${sampleNotice}# Hi there, I'm ${displayName} 👋

${bioSection}
${aboutItems.join('\n')}

---

${techStackSection}
---

${projectsSection}
---

${statsSection}
---

${connectSection}
---
*Crafted with [Repozyn AI](https://github.com/DDUma7/repozyn-ai) — Honest GitHub Roast & Rescue*
`;

  return {
    markdown,
    missingSuggestions,
  };
}
