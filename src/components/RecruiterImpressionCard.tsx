import React from 'react';
import {
  Briefcase,
  CheckCircle,
  AlertTriangle,
  UserCheck,
  Quote,
  HelpCircle,
} from 'lucide-react';
import type { RecruiterImpression } from '../types/analysis';

interface RecruiterImpressionCardProps {
  recruiter: RecruiterImpression;
}

export const RecruiterImpressionCard: React.FC<RecruiterImpressionCardProps> = ({
  recruiter,
}) => {
  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden">
      {/* Category Tag */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-950/40 border border-purple-700/50 text-purple-300">
            <UserCheck className="w-3.5 h-3.5 text-purple-400" />
            HEURISTIC RECRUITER ASSESSMENT
          </span>
          <span className="text-xs text-slate-500 hidden sm:inline">
            The 10-Second Scan Simulation
          </span>
        </div>

        {/* Hireability Badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Signal:</span>
          <span
            className={`px-3 py-1 rounded-xl text-xs font-bold border ${recruiter.hireabilityBadgeColor}`}
          >
            {recruiter.hireabilitySignal}
          </span>
        </div>
      </div>

      {/* Main Archetype & Verdict */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              {recruiter.archetype}
            </h3>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            {recruiter.archetypeDescription}
          </p>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-sm text-slate-300">
            <span className="font-semibold text-white block mb-1">
              ⚡ 10-Second Scan Verdict:
            </span>
            <p className="text-slate-400 text-xs sm:text-sm">{recruiter.tenSecondVerdict}</p>
          </div>
        </div>

        {/* Manager Quote */}
        <div className="lg:col-span-5 p-5 rounded-2xl bg-indigo-950/20 border border-indigo-900/40 relative flex flex-col justify-between">
          <Quote className="w-8 h-8 text-indigo-500/20 absolute top-4 right-4" />
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
              Hiring Manager Inner Monologue
            </span>
            <p className="text-xs sm:text-sm italic text-indigo-200/90 leading-relaxed">
              "{recruiter.firstImpressionQuote}"
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-indigo-900/40 flex items-center justify-between text-[11px] text-indigo-300/70">
            <span>Engineering Lead Review</span>
            <span title="Simulated recruiter perception">
              <HelpCircle className="w-3.5 h-3.5 opacity-60" />
            </span>
          </div>
        </div>
      </div>

      {/* Green Flags & Red Flags */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Green Flags */}
        <div className="rounded-2xl bg-emerald-950/15 border border-emerald-900/30 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>Recruiter Green Flags ({recruiter.greenFlags.length})</span>
          </div>
          {recruiter.greenFlags.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No strong green flags detected yet.</p>
          ) : (
            <div className="space-y-2.5">
              {recruiter.greenFlags.map((flag, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                  <div className="text-xs font-semibold text-emerald-300 mb-0.5">{flag.title}</div>
                  <div className="text-[11px] text-slate-400 leading-snug">{flag.evidence}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Red Flags */}
        <div className="rounded-2xl bg-rose-950/15 border border-rose-900/30 p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Recruiter Friction Points ({recruiter.redFlags.length})</span>
          </div>
          {recruiter.redFlags.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No glaring red flags detected!</p>
          ) : (
            <div className="space-y-2.5">
              {recruiter.redFlags.map((flag, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80">
                  <div className="text-xs font-semibold text-rose-300 mb-0.5">{flag.title}</div>
                  <div className="text-[11px] text-slate-400 leading-snug">{flag.evidence}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
