import React, { useState } from 'react';
import {
  ExternalLink,
  MapPin,
  Building,
  Link as LinkIcon,
  Calendar,
  Users,
  CheckCircle2,
  Copy,
  Check,
  Share2,
  Sparkles,
} from 'lucide-react';
import type { PortfolioReport } from '../types/analysis';

interface ProfileHeaderProps {
  report: PortfolioReport;
  onOpenReportModal: () => void;
  onOpenMakeoverModal: () => void;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  report,
  onOpenReportModal,
  onOpenMakeoverModal,
}) => {
  const { facts, scoring, isMockData } = report;
  const [copiedLink, setCopiedLink] = useState(false);

  // The URL carries ?user= / ?demo= for the audit on screen, so the copied link reopens it
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard unavailable: leave the label unchanged rather than claim success
    }
  };

  return (
    <div className="premium-panel profile-panel rounded-3xl bg-slate-900/70 border border-slate-700/70 p-5 sm:p-6 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-indigo-500/10 via-rose-500/10 to-transparent blur-3xl pointer-events-none" />

      {/* Verified Data Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          {isMockData ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-950/40 border border-amber-700/50 text-amber-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              DEMO PERSONA • SAMPLE DATA, NOT A REAL GITHUB PROFILE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/40 border border-emerald-700/50 text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              VERIFIED GITHUB FACTS
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenMakeoverModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition hover:scale-[1.02] active:scale-[0.98]"
            title="Generate a personalized, copy-ready GitHub profile README"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Profile Makeover</span>
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copied!' : 'Share Audit'}</span>
          </button>
          <button
            onClick={onOpenReportModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        {/* Profile Info */}
        <div className="lg:col-span-8 flex flex-row items-start sm:items-center gap-4">
          <div className="relative shrink-0">
            <img
              src={facts.avatarUrl}
              alt={facts.username}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-2 ring-indigo-500/30 shadow-xl"
            />
            <a
              href={facts.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -bottom-2 -right-2 p-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-400 hover:text-white transition shadow-lg"
              title="Open GitHub Profile"
              aria-label={`Open ${facts.username} on GitHub (opens in a new tab)`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="space-y-2 flex-1 min-w-0">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words">
                  {facts.name || facts.username}
                </h2>
                <a
                  href={facts.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs sm:text-sm font-mono text-indigo-300 hover:text-indigo-200 break-all"
                >
                  @{facts.username}
                </a>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-xl line-clamp-2 leading-relaxed">
                {facts.bio || <span className="italic text-slate-400">No profile bio provided</span>}
              </p>
            </div>

            <details className="analysis-disclosure text-xs">
              <summary className="cursor-pointer py-1 text-slate-300">Profile details</summary>
            {/* Badges / Metadata */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400 font-medium">
              {facts.company && (
                <div className="flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>{facts.company}</span>
                </div>
              )}
              {facts.location && (
                <div className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>{facts.location}</span>
                </div>
              )}
              {facts.website && (
                <div className="flex items-center gap-1">
                  <LinkIcon className="w-3.5 h-3.5 text-slate-400" />
                  <a
                    href={facts.website.startsWith('http') ? facts.website : `https://${facts.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-indigo-400 underline-offset-2 hover:underline truncate max-w-[150px]"
                  >
                    {facts.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Joined {facts.createdAtFormatted} ({facts.accountAgeYears}y)</span>
              </div>
              <div className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  <strong>{facts.followersCount}</strong> followers • <strong>{facts.followingCount}</strong> following
                </span>
              </div>
            </div>
            </details>
          </div>
        </div>

        {/* Health Score Summary Card */}
        <div className="lg:col-span-4 rounded-2xl bg-slate-950/80 border border-slate-800 p-4 flex flex-col justify-between relative shadow-inner">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Portfolio Health Score
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
              Rubric 0-100
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black text-white font-mono tracking-tight">
                  {scoring.totalScore}
                </span>
                <span className="text-sm text-slate-400 font-mono">/ 100</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                {scoring.summary}
              </p>
            </div>

            {/* Score arc complements the numeric value and the accessible progress bar. */}
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
              <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-800" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" pathLength="100" strokeDasharray={`${scoring.totalScore} 100`} className="score-arc text-indigo-300" />
              </svg>
              <span className={`text-3xl font-semibold font-mono ${scoring.gradeColor}`}>{scoring.grade}</span>
            </div>
          </div>

          {/* Mini progress bar */}
          <div className="mt-3 pt-3 border-t border-slate-800/80">
            <div
              role="progressbar"
              aria-label="Portfolio health score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scoring.totalScore}
              className="w-full h-2 rounded-full bg-slate-800 overflow-hidden"
            >
              <div
                className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 rounded-full transition-all duration-1000"
                style={{ width: `${scoring.totalScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
