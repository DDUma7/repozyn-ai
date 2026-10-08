import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Flame, Key, RefreshCw, ExternalLink, Sparkles } from 'lucide-react';
import type { RateLimitInfo } from '../types/github';
import { MOCK_PROFILES, type MockProfile } from '../data/mockProfiles';

interface NavbarProps {
  rateLimit: RateLimitInfo | null;
  onSelectMock: (profile: MockProfile) => void;
  onOpenTokenModal: () => void;
  hasToken: boolean;
  onReset: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  rateLimit,
  onSelectMock,
  onOpenTokenModal,
  hasToken,
  onReset,
}) => {
  const resetMinutes = rateLimit?.resetMinutes ?? 60;
  const [isPersonaMenuOpen, setIsPersonaMenuOpen] = useState(false);
  const personaMenuRef = useRef<HTMLDivElement>(null);
  const personaToggleRef = useRef<HTMLButtonElement>(null);

  // Close the persona menu on Escape or when interacting anywhere outside it
  useEffect(() => {
    if (!isPersonaMenuOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (personaMenuRef.current && !personaMenuRef.current.contains(e.target as Node)) {
        setIsPersonaMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPersonaMenuOpen(false);
        personaToggleRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPersonaMenuOpen]);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <button
          onClick={onReset}
          aria-label="Repozyn AI Home - Reset Search"
          className="flex items-center gap-3 group text-left transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 p-[1.5px] shadow-lg shadow-rose-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Flame className="w-5 h-5 text-rose-500 group-hover:rotate-12 transition-transform duration-300" aria-hidden="true" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent whitespace-nowrap">
                Repozyn AI
              </span>
              <span className="hidden sm:inline-block text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 whitespace-nowrap">
                Roast & Rescue
              </span>
            </div>
            <p className="hidden sm:block text-xs text-slate-400 font-medium truncate">GitHub Portfolio Intelligence</p>
          </div>
        </button>

        {/* Right Actions */}
        <nav aria-label="Quick actions" className="flex items-center gap-2 sm:gap-4">
          {/* Mock Personas Dropdown */}
          <div className="relative" ref={personaMenuRef}>
            <button
              ref={personaToggleRef}
              type="button"
              onClick={() => setIsPersonaMenuOpen((open) => !open)}
              aria-expanded={isPersonaMenuOpen}
              aria-controls="demo-persona-menu"
              aria-label="Select demo persona"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              <span className="hidden sm:inline">Demo Personas</span>
              <span className="sm:hidden">Demos</span>
            </button>
            {isPersonaMenuOpen && (
            <div
              id="demo-persona-menu"
              className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50"
            >
              <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Sample Demo Profiles
              </div>
              {MOCK_PROFILES.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    setIsPersonaMenuOpen(false);
                    onSelectMock(profile);
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-800/80 transition flex flex-col gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="text-xs font-semibold text-slate-200">{profile.name}</span>
                  <span className="text-[11px] text-slate-400 line-clamp-1">{profile.tagline}</span>
                </button>
              ))}
            </div>
            )}
          </div>

          {/* Rate Limit Badge */}
          {rateLimit && (
            <div
              role="status"
              aria-live="polite"
              className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition ${
                rateLimit.remaining < 10
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-300'
              }`}
              title={`API Limit: ${rateLimit.remaining}/${rateLimit.limit} requests left. Resets in ${resetMinutes} min`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin-slow" aria-hidden="true" />
              <span>
                API: <strong className="text-white">{rateLimit.remaining}</strong>/{rateLimit.limit}
              </span>
            </div>
          )}

          {/* Token Modal Button */}
          <button
            onClick={onOpenTokenModal}
            aria-label="Open GitHub personal access token settings"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              hasToken
                ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
            }`}
            title="Configure GitHub Personal Access Token (Increases rate limit to 5000/hr)"
          >
            <Key className={`w-3.5 h-3.5 ${hasToken ? 'text-emerald-400' : 'text-slate-400'}`} aria-hidden="true" />
            <span className="hidden sm:inline">{hasToken ? 'Token Active' : 'Add Token'}</span>
          </button>

          {/* GitHub Source Link */}
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit GitHub official site"
            className="p-2 text-slate-400 hover:text-white transition rounded-lg hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            title="GitHub REST API"
          >
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </a>
        </nav>
      </div>
    </header>
  );
};
