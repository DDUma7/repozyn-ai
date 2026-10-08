import React, { useState } from 'react';
import {
  FileText,
  Lightbulb,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Info,
  Shield,
} from 'lucide-react';
import type { HealthScoreBreakdown } from '../types/analysis';

interface HealthScoreSectionProps {
  scoring: HealthScoreBreakdown;
}

export const HealthScoreSection: React.FC<HealthScoreSectionProps> = ({ scoring }) => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const toggleExpand = (label: string) => {
    setExpandedCategory(expandedCategory === label ? null : label);
  };

  const categories = [
    {
      data: scoring.documentation,
      icon: FileText,
      color: 'from-blue-500 to-cyan-500',
      bgColor: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    },
    {
      data: scoring.originality,
      icon: Lightbulb,
      color: 'from-amber-500 to-yellow-500',
      bgColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    },
    {
      data: scoring.maintenance,
      icon: Clock,
      color: 'from-purple-500 to-indigo-500',
      bgColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    },
    {
      data: scoring.hygiene,
      icon: Sparkles,
      color: 'from-emerald-500 to-teal-500',
      bgColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-950/40 border border-indigo-700/50 text-indigo-300">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              TRANSPARENT 4-PILLAR RUBRIC
            </span>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">Portfolio Health Breakdown</h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Every point is deterministically calculated from your public repository metadata. No black-box guessing.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
          <Info className="w-3.5 h-3.5 text-slate-400" />
          <span>4 Pillars × 25 pts = 100 max</span>
        </div>
      </div>

      {/* 4 Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map(({ data, icon: Icon, color, bgColor }) => {
          const isExpanded = expandedCategory === data.label;
          const percentage = Math.round((data.score / data.maxScore) * 100);

          return (
            <div
              key={data.label}
              className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 shadow-lg hover:border-slate-700 transition"
            >
              {/* Pillar Header */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl border ${bgColor}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-white">{data.label}</h4>
                    <p className="text-[11px] text-slate-400">{data.explanation}</p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-base text-white">
                    {data.score} <span className="text-xs text-slate-500">/ {data.maxScore}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{percentage}%</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden mb-3">
                <div
                  className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Toggle details */}
              <button
                onClick={() => toggleExpand(data.label)}
                className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 transition pt-2 border-t border-slate-800/80 font-medium"
              >
                <span>{isExpanded ? 'Hide point breakdown' : 'View mathematical rubric'}</span>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-3 pt-2 space-y-2 border-t border-slate-800">
                  {data.details.map((detail, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200">{detail.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{detail.reason}</div>
                      </div>
                      <div className="font-mono font-bold text-indigo-400 shrink-0 text-xs">
                        +{detail.earned} / {detail.max}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
