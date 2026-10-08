import { useState, useMemo } from 'react';
import type React from 'react';
import {
  TrendingUp,
  RotateCcw,
  ArrowRight,
  Info,
  Check,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { PortfolioFacts } from '../types/analysis';
import {
  getAvailableSimulatorActions,
  simulatePortfolioImprovements,
  type SimulatorActionId,
} from '../services/simulator';

interface PortfolioSimulatorSectionProps {
  facts: PortfolioFacts;
  isMockData?: boolean;
}

export const PortfolioSimulatorSection: React.FC<PortfolioSimulatorSectionProps> = ({
  facts,
  isMockData = false,
}) => {
  const availableActions = useMemo(() => getAvailableSimulatorActions(facts), [facts]);

  // Selected action IDs state
  const [selectedActionIds, setSelectedActionIds] = useState<SimulatorActionId[]>([]);

  // Selections belong to one profile: start clean whenever a different portfolio is shown
  const [factsForSelection, setFactsForSelection] = useState(facts);
  if (factsForSelection !== facts) {
    setFactsForSelection(facts);
    setSelectedActionIds([]);
  }

  // Calculate simulation result
  const simulation = useMemo(
    () => simulatePortfolioImprovements(facts, selectedActionIds),
    [facts, selectedActionIds]
  );

  const toggleAction = (id: SimulatorActionId) => {
    setSelectedActionIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const allActionIds = availableActions
      .filter((a) => !a.alreadySatisfied)
      .map((a) => a.id);
    setSelectedActionIds(allActionIds);
  };

  const handleReset = () => {
    setSelectedActionIds([]);
  };

  return (
    <section
      aria-label="Portfolio Rescue Simulator"
      className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden"
    >
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-emerald-500/10 via-indigo-500/10 to-transparent blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              Before & After Portfolio Rescue Simulator
            </h3>
            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-950/60 border border-indigo-700/50 text-indigo-300 font-mono">
              ESTIMATED PROJECTION
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Model the score impact of high-ROI portfolio improvements. All calculations strictly follow the existing 4-pillar rubric.
          </p>
        </div>

        {/* Header Controls */}
        <div className="flex items-center gap-2">
          {selectedActionIds.length > 0 && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
              title="Reset all simulated actions"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-300 text-xs font-semibold transition"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Simulate All Fixes</span>
          </button>
        </div>
      </div>

      {/* Comparative Scoreboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Baseline Card */}
        <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between shadow-inner">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isMockData ? 'Sample Baseline' : 'Verified Baseline'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-400 font-mono">
              {isMockData ? 'SAMPLE' : 'ACTUAL'}
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-4xl font-black font-mono text-white tracking-tight">
                {simulation.baselineScore}
              </span>
              <span className="text-xs text-slate-400 font-mono ml-1">/ 100</span>
            </div>
            <div className={`text-3xl font-black font-mono ${simulation.baselineGradeColor}`}>
              {simulation.baselineGrade}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {isMockData
              ? 'Synthetic demo persona — not real GitHub data'
              : 'Verified GitHub REST API portfolio audit'}
          </p>
        </div>

        {/* Score Delta Transition */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-emerald-950/40 border border-emerald-500/30 flex flex-col justify-center items-center text-center shadow-lg">
          <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider mb-1">
            Simulated Growth
          </span>
          <div className="flex items-center gap-2 my-1">
            <span className="text-3xl sm:text-4xl font-extrabold text-emerald-400 font-mono">
              +{simulation.scoreDelta}
            </span>
            <span className="text-xs text-emerald-300 font-semibold font-mono">pts</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-300 mt-1">
            <span className={simulation.baselineGradeColor}>{simulation.baselineGrade}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className={`font-bold ${simulation.simulatedGradeColor}`}>
              {simulation.simulatedGrade}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-2">
            {simulation.activeActionCount} improvement{simulation.activeActionCount === 1 ? '' : 's'} toggled
          </span>
        </div>

        {/* Simulated Projected Card */}
        <div className="p-5 rounded-2xl bg-slate-950/80 border border-emerald-600/40 flex flex-col justify-between shadow-inner relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Projected Score
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 font-mono font-semibold">
              ESTIMATED
            </span>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <div>
              <span className="text-4xl font-black font-mono text-emerald-400 tracking-tight">
                {simulation.simulatedScore}
              </span>
              <span className="text-xs text-slate-400 font-mono ml-1">/ 100</span>
            </div>
            <div className={`text-3xl font-black font-mono ${simulation.simulatedGradeColor}`}>
              {simulation.simulatedGrade}
            </div>
          </div>
          <p className="text-[11px] text-emerald-300/80 mt-2">
            If selected actions are applied & pushed to GitHub
          </p>
        </div>
      </div>

      {/* 4-Pillar Before vs After Progress Comparison */}
      <div className="mb-8 p-5 rounded-2xl bg-slate-950/60 border border-slate-800">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center justify-between">
          <span>Pillar Comparison: Baseline vs Estimated</span>
          <span className="text-[11px] font-mono text-slate-400 font-normal">Max 25 pts each</span>
        </h4>
        <div className="space-y-4">
          {Object.values(simulation.pillars).map((pillar) => {
            const baselinePct = (pillar.baseline / pillar.max) * 100;
            const simulatedPct = (pillar.simulated / pillar.max) * 100;
            const deltaPct = Math.max(0, simulatedPct - baselinePct);

            return (
              <div key={pillar.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">{pillar.name}</span>
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-slate-400">{pillar.baseline}</span>
                    {pillar.delta > 0 && (
                      <span className="text-emerald-400 font-bold">
                        +{pillar.delta} → {pillar.simulated}
                      </span>
                    )}
                    <span className="text-slate-400">/ {pillar.max}</span>
                  </div>
                </div>

                {/* Comparative progress bar */}
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                  {/* Baseline solid bar */}
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${baselinePct}%` }}
                  />
                  {/* Projected gained bar */}
                  {deltaPct > 0 && (
                    <div
                      className="h-full bg-emerald-400 transition-all duration-300 animate-pulse"
                      style={{ width: `${deltaPct}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Realistic Improvements Checklist */}
      <div className="space-y-3 mb-6">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
          Select Realistic Actions to Simulate
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {availableActions.map((action) => {
            const isSelected = selectedActionIds.includes(action.id);

            return (
              <div
                key={action.id}
                onClick={() => !action.alreadySatisfied && toggleAction(action.id)}
                className={`p-4 rounded-2xl border transition cursor-pointer select-none flex flex-col justify-between ${
                  action.alreadySatisfied
                    ? 'bg-slate-950/40 border-slate-800/50 opacity-60 cursor-default'
                    : isSelected
                    ? 'bg-emerald-950/30 border-emerald-500/60 shadow-lg shadow-emerald-950/20'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {/* Checkbox / Switch Indicator */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isSelected || action.alreadySatisfied}
                        aria-label={action.title}
                        disabled={action.alreadySatisfied}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!action.alreadySatisfied) toggleAction(action.id);
                        }}
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition shrink-0 ${
                          action.alreadySatisfied
                            ? 'bg-slate-800 border-slate-700 text-slate-400'
                            : isSelected
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        {(isSelected || action.alreadySatisfied) && (
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        )}
                      </button>
                      <span className="text-xs font-bold text-slate-200">
                        {action.title}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold shrink-0 ${
                        action.alreadySatisfied
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-emerald-950/80 border border-emerald-600/50 text-emerald-300'
                      }`}
                    >
                      {action.alreadySatisfied ? 'Already Satisfied' : `+${action.estimatedPointsGain} pts`}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                    {action.shortDescription}
                  </p>
                </div>

                {/* Practical Action Steps */}
                <div className="pt-2 border-t border-slate-800/80 text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-slate-400 font-mono text-[11px]">
                    <span>Current: {action.currentStatus}</span>
                    <span>Target: {action.targetStatus}</span>
                  </div>
                  <p className="text-slate-400 font-sans mt-1">
                    <strong className="text-slate-300">Action:</strong> {action.actionableStep}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Assumptions & Rubric Transparency Box */}
      <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-300">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          <span>Scoring Transparency & Hard Rubric Limits</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400/90 leading-relaxed pl-1">
          {simulation.assumptionsAndLimits.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
        <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-1">
          <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>
            Repozyn AI never fabricates metrics. Estimated scores are calculated using the active 4-pillar rubric.
          </span>
        </div>
      </div>
    </section>
  );
};
