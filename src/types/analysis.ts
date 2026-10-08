import type { GitHubRepo } from './github';

export interface PortfolioFacts {
  username: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  website: string | null;
  hasBio: boolean;
  hasLocation: boolean;
  hasWebsite: boolean;
  accountAgeYears: number;
  createdAtFormatted: string;
  followersCount: number;
  followingCount: number;
  totalPublicRepos: number;
  analyzedReposCount: number;
  originalReposCount: number;
  forkedReposCount: number;
  archivedReposCount: number;
  totalStarsEarned: number;
  totalForksCount: number;
  languagesBreakdown: Record<string, { count: number; percentage: number }>;
  topLanguages: string[];
  reposWithDescriptionCount: number;
  reposWithDescriptionPercentage: number;
  reposWithLicenseCount: number;
  reposWithLicensePercentage: number;
  reposWithDemoUrlCount: number;
  reposWithDemoUrlPercentage: number;
  reposWithTopicsCount: number;
  daysSinceLastPush: number;
  recentPushesCount30d: number;
  staleReposCount: number; // No push for > 365 days
  topStarredRepos: GitHubRepo[];
  allRepos: GitHubRepo[];
}

export interface ScoreCategory {
  score: number;
  maxScore: number;
  label: string;
  explanation: string;
  details: {
    name: string;
    earned: number;
    max: number;
    reason: string;
  }[];
}

export interface HealthScoreBreakdown {
  totalScore: number; // 0 to 100
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  gradeColor: string;
  summary: string;
  documentation: ScoreCategory;
  originality: ScoreCategory;
  maintenance: ScoreCategory;
  hygiene: ScoreCategory;
}

export interface RecruiterFlag {
  title: string;
  evidence: string;
  impact: 'positive' | 'warning' | 'critical';
}

export interface RecruiterImpression {
  archetype: string;
  archetypeBadge: string;
  archetypeDescription: string;
  tenSecondVerdict: string;
  hireabilitySignal: 'Strong' | 'Promising' | 'Caution' | 'Needs Overhaul';
  hireabilityBadgeColor: string;
  hireabilityReason: string;
  greenFlags: RecruiterFlag[];
  redFlags: RecruiterFlag[];
  firstImpressionQuote: string;
}

export type RoastTone = 'mild' | 'medium' | 'spicy';

export interface RoastItem {
  id: string;
  title: string;
  roast: string;
  evidence: string;
  severity: RoastTone;
  category: 'repo-hygiene' | 'commit-habits' | 'stack-identity' | 'social-presence';
}

export type RoadmapPriority = 'critical' | 'high' | 'medium' | 'low';
export type RoadmapEffort = '< 15 mins' | '1-2 hours' | 'Weekend project';

export interface RoadmapActionItem {
  id: string;
  title: string;
  description: string;
  priority: RoadmapPriority;
  effort: RoadmapEffort;
  impactScore: number; // 1 to 10
  category: 'Quick Fix' | 'Documentation' | 'Credibility' | 'Showcase';
  actionStep: string;
  templateSnippet?: {
    filename: string;
    content: string;
  };
}

export interface PortfolioReport {
  facts: PortfolioFacts;
  scoring: HealthScoreBreakdown;
  recruiter: RecruiterImpression;
  roasts: RoastItem[];
  roadmap: RoadmapActionItem[];
  analyzedAt: string;
  isMockData?: boolean;
}
