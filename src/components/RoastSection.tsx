import { useState } from 'react';
import type React from 'react';
import { Flame, Copy, Check, Sparkles, Tag } from 'lucide-react';
import type { RoastItem, RoastTone } from '../types/analysis';

interface RoastSectionProps {
  roasts: RoastItem[];
}

export const RoastSection: React.FC<RoastSectionProps> = ({ roasts }) => {
  const [tone, setTone] = useState<RoastTone>('medium');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredRoasts = roasts.filter((r) => {
    if (tone === 'mild') return r.severity === 'mild';
    if (tone === 'medium') return r.severity === 'mild' || r.severity === 'medium';
    return true; // spicy: show all
  });

  const handleCopyRoast = (roast: RoastItem) => {
    const text = `🔥 Repozyn AI Roast: "${roast.title}"\n${roast.roast}\n\nEvidence: ${roast.evidence}`;
    navigator.clipboard.writeText(text);
    setCopiedId(roast.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl p-6 sm:p-8 backdrop-blur-xl relative">
      {/* Header and Tone Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-950/50 border border-rose-700/50 text-rose-300">
              <Flame className="w-3.5 h-3.5 text-rose-400" />
              EVIDENCE-BASED ROAST STATION
            </span>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white">The Honest Roast</h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Humorous, data-backed observations grounded in verified repository facts.
          </p>
        </div>

        {/* Tone Slider / Tabs */}
        <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold">
          <button
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredRoasts.length === 0 ? (
          <div className="col-span-2 p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-400 text-sm">
            No roasts found at this spice level. Try switching to Medium or Savage!
          </div>
        ) : (
          filteredRoasts.map((roast) => {
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
                className="rounded-2xl bg-slate-950/80 border border-slate-800 p-5 flex flex-col justify-between hover:border-slate-700 transition group relative"
              >
                <div>
                  {/* Card top */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${badgeColor}`}>
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
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Roast body */}
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed my-3 font-normal">
                    "{roast.roast}"
                  </p>
                </div>

                {/* Evidence Callout */}
                <div className="mt-3 pt-3 border-t border-slate-900/80">
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800/80 text-[11px] text-slate-400">
                    <Tag className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-300">Verified Evidence: </span>
                      <span>{roast.evidence}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer note */}
      <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-slate-500 text-center">
        <Sparkles className="w-3.5 h-3.5 text-rose-400" />
        <span>We roast with love so you can rescue your portfolio with confidence. Scroll down for your custom roadmap!</span>
      </div>
    </div>
  );
};
