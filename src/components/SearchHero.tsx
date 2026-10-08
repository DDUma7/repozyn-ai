import { useState } from 'react';
import type React from 'react';
import { Loader2, Sparkles, AlertCircle, ArrowRight, ShieldCheck, Flame, Clock, Key, LifeBuoy, WandSparkles, Terminal } from 'lucide-react';
import { MOCK_PROFILES, type MockProfile } from '../data/mockProfiles';
import type { RateLimitInfo } from '../types/github';

interface SearchHeroProps {
  onSearch: (username: string) => void;
  onSelectMock: (profile: MockProfile) => void;
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
  onOpenTokenModal?: () => void;
  rateLimit?: RateLimitInfo | null;
}

const POPULAR_HANDLES = ['torvalds', 'gaearon', 'shadcn', 'sindresorhus'];

export const SearchHero: React.FC<SearchHeroProps> = ({
  onSearch,
  onSelectMock,
  isLoading,
  error,
  onClearError,
  onOpenTokenModal,
  rateLimit,
}) => {
  const [inputVal, setInputVal] = useState('');
  const isRateLimitError = Boolean(
    error && (error.toLowerCase().includes('rate limit') || error.includes('403'))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim() && !isLoading) {
      onSearch(inputVal.trim());
    }
  };

  return (
    <div className="landing-shell relative mx-auto w-full py-6 sm:py-10 lg:py-14">
      <div className="hero-grid grid items-center gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-16">
        <div className="min-w-0">
          <div className="mb-6 flex items-center gap-3 text-xs font-medium text-slate-300">
            <span className="h-px w-8 bg-rose-400" aria-hidden="true" />
            <span className="tracking-[0.18em] uppercase">Audit Your Portfolio</span>
            <span className="hidden sm:inline-flex rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300">GitHub Roast & Rescue</span>
          </div>
          <h1 className="hero-title mb-5 text-4xl font-semibold leading-[1.06] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl">
            Your code speaks.<br />
            <span className="text-rose-300">Make it count.</span>
          </h1>
          <p className="mb-7 max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg">
            See your GitHub through a recruiter's eyes. Get an honest roast,
            a practical rescue plan, and a stronger first impression.
          </p>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label htmlFor="github-username-input" className="text-sm font-semibold text-white">Start with your GitHub username</label>
            <span className="hidden text-xs text-slate-400 sm:block">No sign-up needed</span>
          </div>
          {/* Search Input Box */}
          <form onSubmit={handleSubmit} role="search" aria-label="GitHub user search" className="mb-4 w-full">
            <div className="search-command relative flex flex-wrap items-center gap-y-2 rounded-2xl border border-slate-600 bg-slate-900 p-2 shadow-xl shadow-indigo-950/30 transition-all focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/15">
              <span aria-hidden="true" className="pl-3 pr-1 font-mono text-lg text-rose-300">@</span>
              <input
                id="github-username-input"
                type="text"
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  if (error) onClearError();
                }}
                placeholder="Enter GitHub username"
                aria-label="GitHub username"
                disabled={isLoading}
                className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base text-white placeholder-slate-400 focus:outline-none disabled:opacity-50"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
              />
              <button
                type="submit"
                aria-label="Roast and audit GitHub portfolio"
                disabled={isLoading || !inputVal.trim()}
                className="hero-submit flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Auditing...</span>
                  </>
                ) : (
                  <>
                    <span>Roast my profile</span>
                    <Flame className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Error message / Rate Limit Recovery Banner */}
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className={`max-w-2xl mx-auto mb-6 p-4 sm:p-5 rounded-2xl text-left shadow-xl transition-all ${
                isRateLimitError
                  ? 'bg-amber-950/40 border border-amber-600/50'
                  : 'bg-rose-950/60 border border-rose-800/80'
              }`}
            >
              {isRateLimitError ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="font-semibold text-amber-200 text-sm">
                          GitHub request limit reached
                        </p>
                        <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-amber-900/60 text-amber-300 border border-amber-700/50">
                          Resets {rateLimit?.resetMinutes ? `in ~${rateLimit.resetMinutes} min` : 'soon'}
                          {rateLimit?.resetTimeFormatted ? ` (${rateLimit.resetTimeFormatted})` : ''}
                        </span>
                      </div>
                      <p className="text-amber-200/80 text-xs mt-1.5 leading-relaxed">
                        GitHub has paused these requests. Try an instant demo, or retry when the request limit resets.
                      </p>
                    </div>
                  </div>

                  {/* Action recovery options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {/* Option 1: Demo profiles */}
                    <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700/60 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-white mb-1">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <span>1-Click Offline Personas</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                          Explore full portfolios instantly with zero API consumption.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {MOCK_PROFILES.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              onClearError();
                              onSelectMock(p);
                            }}
                            className="px-2 py-1 text-[11px] font-medium rounded-lg bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 border border-indigo-700/50 transition flex items-center gap-1"
                          >
                            <span>{p.user.login}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Option 2: Add personal token */}
                    {onOpenTokenModal && (
                      <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700/60 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-white mb-1">
                            <Key className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Add Personal Token</span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                            A read-only GitHub token can increase your personal request budget.
                          </p>
                        </div>
                        <button
                          onClick={onOpenTokenModal}
                          className="w-full py-1.5 px-3 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 text-[11px] font-medium transition text-center"
                        >
                          Configure Free Token
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-sm text-rose-200">
                    <p className="font-semibold mb-1">Analysis Error</p>
                    <p className="text-rose-300/90 text-xs sm:text-sm">{error}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-0">
            <span className="font-medium text-slate-400">Quick explore:</span>
            <div className="flex flex-wrap items-center gap-2">
              {POPULAR_HANDLES.map((handle) => (
                <button
                  key={handle}
                  onClick={() => {
                    setInputVal(handle);
                    onSearch(handle);
                  }}
                  disabled={isLoading}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition"
                >
                  @{handle}
                </button>
              ))}
            </div>
          </div>

        </div>

        <aside className="journey-panel relative rounded-3xl border border-slate-700/70 bg-slate-900/60 p-5 sm:p-7" aria-label="Roast, Rescue, Reinvent">
          <div className="mb-6 flex items-center justify-between border-b border-slate-700/70 pb-4">
            <span className="flex items-center gap-2 text-xs font-mono text-slate-300"><Terminal className="h-4 w-4 text-indigo-300" aria-hidden="true" /> THE PORTFOLIO RESET</span>
            <span className="flex gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-rose-300" /><span className="h-2 w-2 rounded-full bg-amber-300" /><span className="h-2 w-2 rounded-full bg-emerald-300" /></span>
          </div>
          <ol className="space-y-6">
            {[
              { title: 'Roast', subtitle: 'The truth, with a little heat.', description: 'A recruiter-style verdict and honest feedback grounded in your public profile.', Icon: Flame, color: 'text-rose-300', background: 'bg-rose-500/10 border-rose-400/20' },
              { title: 'Rescue', subtitle: 'Less guesswork. A clear next step.', description: 'Your highest-priority improvements, with evidence and practical first steps.', Icon: LifeBuoy, color: 'text-emerald-300', background: 'bg-emerald-500/10 border-emerald-400/20' },
              { title: 'Reinvent', subtitle: 'Put your best work forward.', description: 'Preview improvements and create a copy-ready profile README.', Icon: WandSparkles, color: 'text-indigo-300', background: 'bg-indigo-500/10 border-indigo-400/20' },
            ].map(({ title, subtitle, description, Icon, color, background }, index) => (
              <li key={title} className="flex items-start gap-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${background} ${color}`}><Icon className="h-5 w-5" aria-hidden="true" /></div>
                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-3"><h2 className={`text-lg font-semibold tracking-tight ${color}`}>{title}</h2><span className="font-mono text-[11px] text-slate-400">0{index + 1}</span></div>
                  <p className="mb-1 text-sm font-medium text-white">{subtitle}</p>
                  <p className="text-xs leading-relaxed text-slate-400">{description}</p>
                </div>
              </li>
            ))}
          </ol>
          {isLoading && (
            <div className="mt-6 border-t border-slate-700 pt-4" aria-hidden="true">
              <p className="mb-3 flex items-center gap-2 text-xs text-indigo-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your public profile…</p>
              <div className="space-y-2"><div className="skeleton-line h-2 w-full rounded bg-slate-700" /><div className="skeleton-line h-2 w-3/4 rounded bg-slate-700" /></div>
            </div>
          )}
        </aside>
      </div>

      {/* Demo Personas Box */}
      <div className="mt-10 border-t border-slate-800 pt-6 sm:mt-14">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Take a test drive • demo personas, no API calls</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MOCK_PROFILES.map((p) => (
            <button
              key={p.id}
              data-testid={`mock-persona-${p.id}`}
              onClick={() => onSelectMock(p)}
              disabled={isLoading}
              className="demo-card p-4 text-left rounded-2xl bg-slate-900/60 border border-slate-700/70 hover:border-indigo-400/60 hover:bg-slate-900 transition group flex flex-col justify-between"
            >
              <div>
                <span className="block text-xs font-bold text-slate-200 group-hover:text-indigo-300">
                  {p.name}
                </span>
                <span className="text-xs text-slate-400 leading-relaxed mt-1">{p.tagline}</span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-indigo-400 font-medium">
                <span>View Persona</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transparency Guarantee */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Real GitHub REST API Facts
        </span>
        <span>•</span>
        <span>Transparent 0-100 Mathematical Rubric</span>
        <span>•</span>
        <span>Zero Fabricated AI Claims</span>
        <span>•</span>
        <span>No Sign-Up • No Database</span>
      </div>
    </div>
  );
};
