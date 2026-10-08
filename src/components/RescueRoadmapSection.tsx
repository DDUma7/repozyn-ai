import { useState } from 'react';
import type React from 'react';
import {
  LifeBuoy,
  Clock,
  ArrowRight,
  Copy,
  Check,
  Code2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { RoadmapActionItem } from '../types/analysis';
import confetti from 'canvas-confetti';

interface RescueRoadmapSectionProps {
  roadmap: RoadmapActionItem[];
}

export const RescueRoadmapSection: React.FC<RescueRoadmapSectionProps> = ({ roadmap }) => {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [expandedSnippetId, setExpandedSnippetId] = useState<string | null>(null);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);

  // Progress belongs to one profile: start clean whenever a different roadmap is shown
  const [roadmapForProgress, setRoadmapForProgress] = useState(roadmap);
  if (roadmapForProgress !== roadmap) {
    setRoadmapForProgress(roadmap);
    setCompletedIds(new Set());
    setExpandedSnippetId(null);
    setCopiedSnippetId(null);
  }

  const toggleComplete = (id: string) => {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // If all items completed, fire celebration confetti!
        if (next.size === roadmap.length) {
          try {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 },
            });
          } catch {
            // Ignore if canvas-confetti fails in SSR/test
          }
        }
      }
      return next;
    });
  };

  const handleCopySnippet = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedSnippetId(id);
    setTimeout(() => setCopiedSnippetId(null), 2000);
  };

  const completedCount = completedIds.size;
  const progressPercent = roadmap.length > 0 ? Math.round((completedCount / roadmap.length) * 100) : 0;

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-xl relative">
      {/* Header and Progress */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/40 border border-emerald-700/50 text-emerald-300">
              <LifeBuoy className="w-3.5 h-3.5 text-emerald-400" />
              ACTIONABLE RESCUE PLAN
            </span>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">Your Rescue Roadmap</h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Personalized, prioritized checklist to elevate your portfolio into recruiter-ready status.
          </p>
        </div>

        {/* Progress Tracker */}
        <div className="w-full sm:w-60 p-3 rounded-2xl bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-xs font-semibold mb-2">
            <span className="text-slate-300">Rescue Progress</span>
            <span className="text-emerald-400 font-mono">
              {completedCount} / {roadmap.length} ({progressPercent}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Checklist Grid */}
      <div className="space-y-4">
        {roadmap.map((item, index) => {
          const isDone = completedIds.has(item.id);
          const hasSnippet = Boolean(item.templateSnippet);
          const isSnippetExpanded = expandedSnippetId === item.id;
          const isSnippetCopied = copiedSnippetId === item.id;

          const priorityColor =
            item.priority === 'critical'
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              : item.priority === 'high'
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';

          return (
            <div
              key={item.id}
              className={`rounded-2xl border transition-all ${
                isDone
                  ? 'bg-emerald-950/10 border-emerald-800/40 opacity-75'
                  : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
              } p-5`}
            >
              <div className="flex items-start gap-4">
                {/* Interactive Checkbox */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`Task ${index + 1}: ${item.title}. ${isDone ? 'Completed' : 'Not completed'}`}
                  onClick={() => toggleComplete(item.id)}
                  className={`mt-1 w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                      : 'border-slate-700 hover:border-emerald-500/70 bg-slate-900 text-transparent'
                  }`}
                  title={isDone ? 'Mark as incomplete' : 'Mark as done'}
                >
                  <Check className="w-4 h-4 stroke-[3]" aria-hidden="true" />
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-mono text-xs text-slate-500">#{index + 1}</span>
                    <h4
                      className={`font-bold text-sm sm:text-base ${
                        isDone ? 'line-through text-slate-400' : 'text-white'
                      }`}
                    >
                      {item.title}
                    </h4>

                    {/* Badges */}
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${priorityColor}`}
                    >
                      {item.priority}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {item.effort}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-3">
                    {item.description}
                  </p>

                  {/* Action step card */}
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2">
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                    <span className="font-mono text-[11px] text-slate-300">{item.actionStep}</span>
                  </div>

                  {/* Optional Snippet / Template Drawer */}
                  {hasSnippet && item.templateSnippet && (
                    <div className="mt-3">
                      <button
                        onClick={() =>
                          setExpandedSnippetId(isSnippetExpanded ? null : item.id)
                        }
                        className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>
                          {isSnippetExpanded
                            ? 'Hide Starter Template'
                            : `View ${item.templateSnippet.filename} Template`}
                        </span>
                        {isSnippetExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>

                      {isSnippetExpanded && (
                        <div className="mt-2 rounded-xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs relative">
                          <div className="flex items-center justify-between mb-2 text-slate-400 pb-2 border-b border-slate-800 text-[11px]">
                            <span>{item.templateSnippet.filename}</span>
                            <button
                              onClick={() =>
                                handleCopySnippet(item.id, item.templateSnippet!.content)
                              }
                              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                            >
                              {isSnippetCopied ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>{isSnippetCopied ? 'Copied!' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="text-slate-300 whitespace-pre-wrap overflow-x-auto text-[11px] leading-relaxed max-h-56">
                            {item.templateSnippet.content}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
