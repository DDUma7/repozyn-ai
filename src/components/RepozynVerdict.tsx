import type { PortfolioFacts } from '../types/analysis';
import { buildRepozynVerdict } from '../utils/repozynVerdict';

interface RepozynVerdictProps {
  facts: Partial<PortfolioFacts>;
  isMockData?: boolean;
}

export function RepozynVerdict({ facts, isMockData = false }: RepozynVerdictProps) {
  const verdict = buildRepozynVerdict(facts, isMockData);
  return (
    <section aria-label="Repozyn Verdict — Your GitHub in 30 Seconds" className="rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">30-Second Verdict · Metadata only</p>
      <h4 className="text-base font-semibold tracking-tight text-white">Repozyn Verdict <span className="font-normal text-slate-300">— Your GitHub in 30 Seconds</span></h4>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{verdict.overview}</p>
      <dl className="mt-3 space-y-2 text-xs leading-relaxed">
        {verdict.strength && <div><dt className="inline font-semibold text-emerald-300">Observed strength: </dt><dd className="inline text-slate-300">{verdict.strength}</dd></div>}
        <div><dt className="inline font-semibold text-rose-300">{verdict.observedWeakness ? 'Main gap: ' : 'Assessment limit: '}</dt><dd className="inline text-slate-300">{verdict.weakness}</dd></div>
        <div className="border-t border-indigo-400/20 pt-2"><dt className="inline font-semibold text-indigo-300">Next action: </dt><dd className="inline text-slate-200">{verdict.nextAction}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{verdict.scope}</p>
    </section>
  );
}
