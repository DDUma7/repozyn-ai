import { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { SearchHero } from './components/SearchHero';
import { ProfileHeader } from './components/ProfileHeader';
import { RecruiterImpressionCard } from './components/RecruiterImpressionCard';
import { HealthScoreSection } from './components/HealthScoreSection';
import { RoastSection } from './components/RoastSection';
import { RescueRoadmapSection } from './components/RescueRoadmapSection';
import { PortfolioSimulatorSection } from './components/PortfolioSimulatorSection';
import { RepositoryExplorer } from './components/RepositoryExplorer';
import { TokenModal } from './components/TokenModal';
import { MarkdownReportModal } from './components/MarkdownReportModal';
import { ProfileMakeoverModal } from './components/ProfileMakeoverModal';
import {
  fetchGitHubUser,
  fetchGitHubRepos,
  checkRateLimit,
  GitHubApiError,
} from './services/github';
import { analyzePortfolio } from './services/analyzer';
import type { PortfolioReport } from './types/analysis';
import type { RateLimitInfo } from './types/github';
import { MOCK_PROFILES, type MockProfile } from './data/mockProfiles';
import { Search, Flame, RefreshCw, AlertCircle, X } from 'lucide-react';

const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

// Keeps the address bar in sync with the audit on screen so "Share Audit" copies a link that restores it
function syncShareUrl(param: 'user' | 'demo' | null, value = '') {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('user');
    url.searchParams.delete('demo');
    if (param) url.searchParams.set(param, value);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // History API unavailable (sandboxed frame): sharing simply falls back to the bare URL
  }
}

// A shared demo link (?demo=<persona id>) resolves to a built-in persona without any network call
function findSharedMock(): MockProfile | undefined {
  try {
    const demoId = new URLSearchParams(window.location.search).get('demo');
    return demoId ? MOCK_PROFILES.find((p) => p.id === demoId) : undefined;
  } catch {
    return undefined;
  }
}

export function App() {
  const [token, setToken] = useState<string>(() => {
    return sessionStorage.getItem('repozyn_token') || '';
  });
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [report, setReport] = useState<PortfolioReport | null>(() => {
    const sharedMock = findSharedMock();
    return sharedMock ? analyzePortfolio(sharedMock.user, sharedMock.repos, [], true) : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isMakeoverModalOpen, setIsMakeoverModalOpen] = useState(false);

  // Compact header search input when report is active
  const [compactSearch, setCompactSearch] = useState('');

  // Identifies the most recent profile selection so slower, older responses are discarded
  const latestRequestRef = useRef(0);

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
    const requestId = ++latestRequestRef.current;
    const isStale = () => latestRequestRef.current !== requestId;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch user profile (proxy -> direct fallback, cached)
      const userRes = await fetchGitHubUser(username, token);
      if (isStale()) return;
      setRateLimit(userRes.rateLimit);

      // 2. Fetch public repos (proxy -> direct fallback, cached)
      const reposRes = await fetchGitHubRepos(username, token);
      if (isStale()) return;
      setRateLimit(reposRes.rateLimit);

      // 3. Run deterministic portfolio analyzer with zero redundant API calls
      const analysis = analyzePortfolio(userRes.data, reposRes.data, [], false);
      setReport(analysis);
      setCompactSearch('');
      syncShareUrl('user', userRes.data.login);

      // Smooth scroll to top of report
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      if (isStale()) return;
      if (err instanceof GitHubApiError) {
        setError(err.message);
        if (err.rateLimit) setRateLimit(err.rateLimit);
      } else {
        setError(err.message || 'An unexpected error occurred while analyzing this profile.');
      }
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  };

  const handleSelectMock = (mock: MockProfile) => {
    latestRequestRef.current += 1;
    setError(null);
    const analysis = analyzePortfolio(mock.user, mock.repos, [], true);
    setReport(analysis);
    setCompactSearch('');
    syncShareUrl('demo', mock.id);
    setIsLoading(false);
    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReset = () => {
    latestRequestRef.current += 1;
    setIsLoading(false);
    setReport(null);
    setError(null);
    syncShareUrl(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Restore a shared real-profile link (?user=<login>) once on load; demo links are restored in initial state
  const didRestoreFromUrl = useRef(false);
  useEffect(() => {
    if (didRestoreFromUrl.current) return;
    didRestoreFromUrl.current = true;

    const params = new URLSearchParams(window.location.search);
    const sharedUser = params.get('user');
    if (findSharedMock()) return;

    if (sharedUser && GITHUB_USERNAME_REGEX.test(sharedUser)) {
      handleSearch(sharedUser);
    } else if (sharedUser || params.has('demo')) {
      syncShareUrl(null);
    }
    // Runs once on mount by design; later URL changes are written by the app itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            onOpenTokenModal={() => setIsTokenModalOpen(true)}
            rateLimit={rateLimit}
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
                    onChange={(e) => {
                      setCompactSearch(e.target.value);
                      if (error) setError(null);
                    }}
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

            {/* Search errors while a report is already on screen */}
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-3 p-4 rounded-2xl bg-rose-950/60 border border-rose-800/80 text-sm text-rose-200"
              >
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold mb-1">Could not audit that profile</p>
                  <p className="text-rose-300/90 text-xs sm:text-sm">{error}</p>
                  <p className="text-rose-300/70 text-xs mt-1">
                    Still showing the previous audit for @{report.facts.username}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="p-1.5 rounded-lg text-rose-300 hover:text-white hover:bg-rose-900/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* 1. Profile Overview & Score Grade */}
            <ProfileHeader
              report={report}
              onOpenReportModal={() => setIsReportModalOpen(true)}
              onOpenMakeoverModal={() => setIsMakeoverModalOpen(true)}
            />

            {/* 2. Recruiter Quick-Scan Impression Card */}
            <RecruiterImpressionCard recruiter={report.recruiter} />

            {/* 3. Transparent 4-Pillar Health Score Breakdown */}
            <HealthScoreSection scoring={report.scoring} />

            {/* 4. Humorous Evidence-Based Roast Station */}
            <RoastSection roasts={report.roasts} isMockData={report.isMockData} />

            {/* 5. Before & After Portfolio Rescue Simulator */}
            <PortfolioSimulatorSection facts={report.facts} isMockData={report.isMockData} />

            {/* 6. Personalized Rescue Roadmap */}
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
            Deterministic scoring rubric • No fabricated AI claims • Public GitHub REST data fetched through a lightweight server proxy.
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
        <>
          <MarkdownReportModal
            isOpen={isReportModalOpen}
            onClose={() => setIsReportModalOpen(false)}
            report={report}
          />
          <ProfileMakeoverModal
            isOpen={isMakeoverModalOpen}
            onClose={() => setIsMakeoverModalOpen(false)}
            report={report}
          />
        </>
      )}
    </div>
  );
}

export default App;
