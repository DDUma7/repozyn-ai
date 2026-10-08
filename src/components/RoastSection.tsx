import { useState } from 'react';
import type React from 'react';
import { Flame, Copy, Check, Sparkles, Tag } from 'lucide-react';
import type { RoastItem, RoastTone } from '../types/analysis';

interface RoastSectionProps {
  roasts: RoastItem[];
  isMockData?: boolean;
}

export const RoastSection: React.FC<RoastSectionProps> = ({ roasts, isMockData = false }) => {
  const [tone, setTone] = useState<RoastTone>('medium');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredRoasts = roasts.filter((r) => {
    if (tone === 'mild') return r.severity === 'mild';
    if (tone === 'medium') return r.severity === 'mild' || r.severity === 'medium';
    return true; // spicy: show all
  });

  const handleCopyRoast = async (roast: RoastItem) => {
    const text = `🔥 Repozyn AI Roast: "${roast.title}"\n${roast.roast}\n\nEvidence: ${roast.evidence}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.focus();
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedId(roast.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard write error
    }
  };

  const renderRoast = (roast: RoastItem) => {
    const isCopied = copiedId === roast.id;
    const badgeColor =
      roast.severity === 'spicy'
        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
        : roast.severity === 'medium'
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

    return (
      <div
        key={roast.id}
        className="rounded-2xl bg-slate-950/80 border border-slate-800 p-4 flex flex-col justify-between hover:border-slate-700 transition group relative"
      >
        <div>
          {/* Card top */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border ${badgeColor}`}>
                {roast.severity}
              </span>
              <h4 className="font-bold text-sm sm:text-base text-white group-hover:text-rose-300 transition-colors">
                {roast.title}
              </h4>
            </div>

            <button
              onClick={() => handleCopyRoast(roast)}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition shrink-0"
              title="Copy roast text"
              aria-label="Copy this observation"
            >
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Roast body */}
          <p className="text-sm sm:text-base text-slate-200 leading-relaxed my-3 font-normal">
            "{roast.roast}"
          </p>
        </div>

        {/* Evidence Callout */}
        <div className="mt-3 pt-3 border-t border-slate-900/80">
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800/80 text-[11px] text-slate-400">
            <Tag className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-300">{isMockData ? 'Sample Evidence: ' : 'Verified Evidence: '}</span>
              <span>{roast.evidence}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="premium-panel roast-panel h-full rounded-3xl bg-slate-900/70 border border-slate-700/70 p-5 sm:p-6 relative">
      {/* Header and Tone Selector */}
      <div className="flex flex-col items-start gap-3 mb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-950/50 border border-rose-700/50 text-rose-300">
              <Flame className="w-3.5 h-3.5 text-rose-400" />
              01 / ROAST
            </span>
            <h3 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">The Honest Roast</h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {isMockData
              ? 'Observations grounded in this demo persona’s sample data.'
              : 'Public profile facts, with a little heat.'}
          </p>
        </div>

        {/* Tone Slider / Tabs */}
        <div
          role="group"
          aria-label="Roast intensity level"
          className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold"
        >
          <button
            type="button"
            aria-pressed={tone === 'mild'}
            onClick={() => setTone('mild')}
            className={`px-3 py-1.5 rounded-lg transition ${
              tone === 'mild'
                ? 'bg-emerald-500/20 text-emerald-300 shadow-sm border border-emerald-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🌱 Mild
          </button>
          <button
            type="button"
            aria-pressed={tone === 'medium'}
            onClick={() => setTone('medium')}
            className={`px-3 py-1.5 rounded-lg transition ${
              tone === 'medium'
                ? 'bg-amber-500/20 text-amber-300 shadow-sm border border-amber-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🔥 Medium
          </button>
          <button
            type="button"
            aria-pressed={tone === 'spicy'}
            onClick={() => setTone('spicy')}
            className={`px-3 py-1.5 rounded-lg transition ${
              tone === 'spicy'
                ? 'bg-rose-500/20 text-rose-300 shadow-sm border border-rose-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            💀 Savage
          </button>
        </div>
      </div>

      {/* Roasts Grid */}
      <div className="space-y-3">
        {filteredRoasts.length === 0 ? (
          <div className="p-5 text-center rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-400 text-sm">
            {roasts.length === 0 ? 'No roast observations for this profile. Explore the evidence and improvement simulator below.' : 'No roasts found at this spice level. Try switching to Medium or Savage!'}
          </div>
        ) : (
          <>
            {renderRoast(filteredRoasts[0])}
            {filteredRoasts.length > 1 && (
              <details className="analysis-disclosure border-t border-slate-700/70 pt-2">
                <summary className="cursor-pointer py-2 text-xs font-semibold text-rose-300">Read {filteredRoasts.length - 1} more {filteredRoasts.length === 2 ? 'observation' : 'observations'}</summary>
                <div className="space-y-3 pt-3">{filteredRoasts.slice(1).map(renderRoast)}</div>
              </details>
            )}
          </>
        )}
      </div>

      {/* Footer note */}
      <div className="mt-4 flex items-start gap-2 text-xs text-slate-400">
        <Sparkles className="w-3.5 h-3.5 text-rose-400" />
        <span>
          Turn the feedback into your next move.{' '}
          <a href="#rescue" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">
            Go to your rescue plan
          </a>
        </span>
      </div>
    </div>
  );
};
