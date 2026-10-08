import React from 'react';
import {
  Briefcase,
  CheckCircle,
  AlertTriangle,
  UserCheck,
  Quote,
  HelpCircle,
} from 'lucide-react';
import type { PortfolioFacts, RecruiterImpression } from '../types/analysis';
import { RepozynVerdict } from './RepozynVerdict';

interface RecruiterImpressionCardProps {
  recruiter: RecruiterImpression;
  facts?: PortfolioFacts;
  isMockData?: boolean;
}

export const RecruiterImpressionCard: React.FC<RecruiterImpressionCardProps> = ({
  recruiter,
  facts,
  isMockData,
}) => {
  return (
    <div className="premium-panel recruiter-panel h-full rounded-3xl border border-slate-700/70 bg-slate-900/70 p-5 sm:p-6 relative overflow-hidden">
      {/* Category Tag */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-950/40 border border-purple-700/50 text-purple-300">
            <UserCheck className="w-3.5 h-3.5 text-purple-400" />
            RECRUITER LENS
          </span>
          <span className="block text-xs leading-relaxed text-slate-400">
            What a recruiter notices in 30 seconds (rule-based simulation)
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
      <div className="space-y-4 mb-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-indigo-400" />
            <h3 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {recruiter.archetype}
            </h3>
          </div>


          {facts ? <RepozynVerdict facts={facts} isMockData={isMockData} /> : <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-400/20 text-sm text-slate-300">
            <span className="font-semibold text-white block mb-1">
              ⚡ 30-Second Verdict:
            </span>
            <p className="text-slate-200 text-sm leading-relaxed">{recruiter.tenSecondVerdict}</p>
          </div>}
        </div>

      </div>

      <details className="analysis-disclosure border-t border-slate-700/70 pt-3">
        <summary className="cursor-pointer py-2 text-xs font-semibold text-indigo-300">Explore the recruiter reasoning • {recruiter.greenFlags.length} green flags, {recruiter.redFlags.length} friction points</summary>
        <div className="space-y-4 pt-3">
              <p className="text-sm text-slate-300 leading-relaxed">
                {recruiter.archetypeDescription}
              </p>
            {/* Manager Quote */}
            <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-900/40 relative flex flex-col justify-between">
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

          {/* Green Flags & Red Flags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Green Flags */}
            <div className="rounded-2xl bg-emerald-950/15 border border-emerald-900/30 p-3 space-y-3">
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
            <div className="rounded-2xl bg-rose-950/15 border border-rose-900/30 p-3 space-y-3">
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
      </details>
    </div>
  );
};
