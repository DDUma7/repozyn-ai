import { useState } from 'react';
import type React from 'react';
import { Loader2, Sparkles, AlertCircle, ArrowRight, ShieldCheck, Flame } from 'lucide-react';
import { MOCK_PROFILES, type MockProfile } from '../data/mockProfiles';

interface SearchHeroProps {
  onSearch: (username: string) => void;
  onSelectMock: (profile: MockProfile) => void;
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
}

const POPULAR_HANDLES = ['torvalds', 'gaearon', 'shadcn', 'sindresorhus'];

export const SearchHero: React.FC<SearchHeroProps> = ({
  onSearch,
  onSelectMock,
  isLoading,
  error,
  onClearError,
}) => {
  const [inputVal, setInputVal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim() && !isLoading) {
      onSearch(inputVal.trim());
    }
  };

  return (
    <div className="relative py-12 md:py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-center">
      {/* Background radial gradient accent */}
      <div className="absolute inset-0 -z-10 flex items-center justify-center">
        <div className="w-[500px] h-[300px] bg-gradient-to-r from-rose-600/15 via-indigo-600/15 to-amber-600/15 blur-3xl rounded-full opacity-70" />
      </div>

      {/* Pill Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/60 shadow-inner mb-6 text-xs text-slate-300">
        <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
        <span className="font-semibold text-rose-400">Hackathon Challenge</span>
        <span className="text-slate-600">•</span>
        <span>GitHub Roast & Rescue</span>
      </div>

      {/* Headline */}
      <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white mb-4">
        Audit Your Portfolio.{' '}
        <span className="bg-gradient-to-r from-rose-400 via-amber-300 to-indigo-400 bg-clip-text text-transparent">
          Face the Truth.
        </span>
      </h1>

      <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mb-8 font-normal leading-relaxed">
        Enter any public GitHub username to receive an honest recruiter first impression, a transparent
        health score, evidence-based roasts, and a step-by-step rescue roadmap.
      </p>

      {/* Search Input Box */}
      <form onSubmit={handleSubmit} role="search" aria-label="GitHub user search" className="max-w-2xl mx-auto mb-6">
        <div className="relative flex items-center shadow-2xl rounded-2xl bg-slate-900/90 border border-slate-700/80 p-1.5 focus-within:border-indigo-500/80 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
          <label htmlFor="github-username-input" className="pl-4 pr-2 text-slate-400 font-mono text-base select-none">
            @
          </label>
          <input
            id="github-username-input"
            type="text"
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              if (error) onClearError();
            }}
            placeholder="Enter GitHub username (e.g. torvalds, gaearon)"
            aria-label="GitHub username"
            disabled={isLoading}
            className="w-full bg-transparent px-2 py-3 text-base text-white placeholder-slate-500 focus:outline-none disabled:opacity-50"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
          />
          <button
            type="submit"
            aria-label="Roast and audit GitHub portfolio"
            disabled={isLoading || !inputVal.trim()}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-rose-600/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Auditing...</span>
              </>
            ) : (
              <>
                <span>Roast Me</span>
                <Flame className="w-4 h-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Error message */}
      {error && (
        <div role="alert" aria-live="assertive" className="max-w-2xl mx-auto mb-6 p-4 rounded-xl bg-rose-950/60 border border-rose-800/80 text-left flex items-start gap-3 shadow-lg">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm text-rose-200">
            <p className="font-semibold mb-1">Analysis Error</p>
            <p className="text-rose-300/90 text-xs sm:text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Quick Pills */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-400 mb-8">
        <span className="font-medium text-slate-500">Quick explore:</span>
        <div className="flex flex-wrap items-center justify-center gap-2">
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

      {/* Demo Personas Box */}
      <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800/60 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Try Instant Hackathon Personas (No API calls needed)</span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MOCK_PROFILES.map((p) => (
            <button
              key={p.id}
              data-testid={`mock-persona-${p.id}`}
              onClick={() => onSelectMock(p)}
              disabled={isLoading}
              className="p-3 text-left rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-800/60 transition group flex flex-col justify-between"
            >
              <div>
                <span className="block text-xs font-bold text-slate-200 group-hover:text-indigo-300">
                  {p.name.split(' ')[0]}
                </span>
                <span className="text-[11px] text-slate-400 line-clamp-2 mt-1">{p.tagline}</span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[10px] text-indigo-400 font-medium">
                <span>View Persona</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transparency Guarantee */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Real GitHub REST API Facts
        </span>
        <span>•</span>
        <span>Transparent 0-100 Mathematical Rubric</span>
        <span>•</span>
        <span>Zero Fabricated AI Claims</span>
        <span>•</span>
        <span>100% Client-Side Private</span>
      </div>
    </div>
  );
};
