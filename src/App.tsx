import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SearchHero } from './components/SearchHero';
import { ProfileHeader } from './components/ProfileHeader';
import { RecruiterImpressionCard } from './components/RecruiterImpressionCard';
import { HealthScoreSection } from './components/HealthScoreSection';
import { RoastSection } from './components/RoastSection';
import { RescueRoadmapSection } from './components/RescueRoadmapSection';
import { RepositoryExplorer } from './components/RepositoryExplorer';
import { TokenModal } from './components/TokenModal';
import { MarkdownReportModal } from './components/MarkdownReportModal';
import {
  fetchGitHubUser,
  fetchGitHubRepos,
  fetchGitHubEvents,
  checkRateLimit,
  GitHubApiError,
} from './services/github';
import { analyzePortfolio } from './services/analyzer';
import type { PortfolioReport } from './types/analysis';
import type { RateLimitInfo } from './types/github';
import type { MockProfile } from './data/mockProfiles';
import { Search, Flame, RefreshCw } from 'lucide-react';

export function App() {
  const [token, setToken] = useState<string>(() => {
    return sessionStorage.getItem('repozyn_token') || '';
  });
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Compact header search input when report is active
  const [compactSearch, setCompactSearch] = useState('');

  // Initial rate limit check
  useEffect(() => {
    checkRateLimit(token).then((info) => setRateLimit(info));
  }, [token]);

  const handleSaveToken = (newToken: string) => {
    setToken(newToken);
    sessionStorage.setItem('repozyn_token', newToken);
  };

  const handleClearToken = () => {
    setToken('');
    sessionStorage.removeItem('repozyn_token');
    checkRateLimit().then((info) => setRateLimit(info));
  };

  const handleSearch = async (username: string) => {
    if (!username.trim() || isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch user profile
      const userRes = await fetchGitHubUser(username, token);
      setRateLimit(userRes.rateLimit);

      // 2. Fetch public repos
      const reposRes = await fetchGitHubRepos(username, token);
      setRateLimit(reposRes.rateLimit);

      // 3. Fetch events (graceful fallback)
      let events: any[] = [];
      try {
        const eventsRes = await fetchGitHubEvents(username, token);
        events = eventsRes.data;
        if (eventsRes.rateLimit) setRateLimit(eventsRes.rateLimit);
      } catch {
        // Non-fatal
      }

      // 4. Run portfolio analyzer
      const analysis = analyzePortfolio(userRes.data, reposRes.data, events, false);
      setReport(analysis);
      setCompactSearch('');

      // Smooth scroll to top of report
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      if (err instanceof GitHubApiError) {
        setError(err.message);
        if (err.rateLimit) setRateLimit(err.rateLimit);
      } else {
        setError(err.message || 'An unexpected error occurred while analyzing this profile.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectMock = (mock: MockProfile) => {
    setError(null);
    const analysis = analyzePortfolio(mock.user, mock.repos, [], true);
    setReport(analysis);
    setCompactSearch('');
    setIsLoading(false);
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReset = () => {
    setReport(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500/30 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        rateLimit={rateLimit}
        onSelectMock={handleSelectMock}
        onOpenTokenModal={() => setIsTokenModalOpen(true)}
        hasToken={Boolean(token)}
        onReset={handleReset}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!report ? (
          /* Landing Search Hero */
          <SearchHero
            onSearch={handleSearch}
            onSelectMock={handleSelectMock}
            isLoading={isLoading}
            error={error}
            onClearError={() => setError(null)}
          />
        ) : (
          /* Active Portfolio Dashboard */
          <div className="space-y-8 animate-fadeIn">
            {/* Quick Re-Search Bar on top of dashboard */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-md">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Auditing:</span>
                <span className="font-mono text-indigo-400 font-bold">@{report.facts.username}</span>
                <span>•</span>
                <span>{report.facts.analyzedReposCount} repos analyzed</span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (compactSearch.trim()) handleSearch(compactSearch.trim());
                }}
                className="flex items-center gap-2 w-full sm:w-auto"
              >
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={compactSearch}
                    onChange={(e) => setCompactSearch(e.target.value)}
                    placeholder="Audit another username..."
                    disabled={isLoading}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !compactSearch.trim()}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition disabled:opacity-40"
                >
                  {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Audit'}
                </button>
              </form>
            </div>

            {/* 1. Profile Overview & Score Grade */}
            <ProfileHeader
              report={report}
              onOpenReportModal={() => setIsReportModalOpen(true)}
            />

            {/* 2. Recruiter 10-Second Impression Card */}
            <RecruiterImpressionCard recruiter={report.recruiter} />

            {/* 3. Transparent 4-Pillar Health Score Breakdown */}
            <HealthScoreSection scoring={report.scoring} />

            {/* 4. Humorous Evidence-Based Roast Station */}
            <RoastSection roasts={report.roasts} />

            {/* 5. Personalized Rescue Roadmap */}
            <RescueRoadmapSection roadmap={report.roadmap} />

            {/* 6. Repository Explorer Deep Dive */}
            <RepositoryExplorer repos={report.facts.allRepos} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-slate-800/80 bg-slate-950 py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <div className="flex items-center justify-center gap-2 font-medium text-slate-400">
            <Flame className="w-4 h-4 text-rose-500" />
            <span>Repozyn AI — University Hackathon Challenge: GitHub Roast & Rescue</span>
          </div>
          <p>
            Deterministic scoring rubric • No fabricated AI claims • 100% public REST API client-side execution.
          </p>
          <div className="pt-2 text-[11px] text-slate-600">
            Powered by React, TypeScript, Vite & Tailwind CSS.
          </div>
        </div>
      </footer>

      {/* Modals */}
      <TokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        savedToken={token}
        onSaveToken={handleSaveToken}
        onClearToken={handleClearToken}
        onRateLimitUpdate={(info) => setRateLimit(info)}
      />

      {report && (
        <MarkdownReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          report={report}
        />
      )}
    </div>
  );
}

export default App;
