import { Check, CircleHelp, X } from 'lucide-react';
import type { FitItem } from '../types';

const STATUS = {
  met: { icon: Check, cls: 'bg-jal/20 text-jal', word: 'Yes' },
  unmet: { icon: X, cls: 'bg-ember/20 text-[#FF8A73]', word: 'No' },
  unknown: { icon: CircleHelp, cls: 'bg-sand/10 text-sand-dim', word: 'Unknown' },
} as const;

const SOURCE: Record<string, string> = {
  curated: 'Curated data',
  live: 'Google Places',
  computed: 'Calculated',
  inferred: 'Guessed from type',
};

export function fitSummary(fit: FitItem[]): string | null {
  if (!fit.length) return null;
  const met = fit.filter((f) => f.status === 'met').length;
  const unknown = fit.filter((f) => f.status === 'unknown').length;
  return `Matches ${met} of ${fit.length}${unknown ? `, ${unknown} unknown` : ''}`;
}

/** Compact checklist for cards: one line per thing the user asked for. */
export function FitChips({ fit, max = 5 }: { fit: FitItem[]; max?: number }) {
  if (!fit.length) return null;
  const shown = fit.slice(0, max);
  return (
    <ul className="flex flex-col gap-1" aria-label="How it fits your search">
      {shown.map((f) => {
        const S = STATUS[f.status];
        return (
          <li key={`${f.key}-${f.wanted}`} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${S.cls}`} aria-hidden>
              <S.icon className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <span className="min-w-0 text-sand">
              <span className="sr-only">{S.word}: </span>
              <span className="font-semibold">{f.wanted}</span>
              <span className="text-sand-dim">: {f.detail}</span>
            </span>
          </li>
        );
      })}
      {fit.length > max && <li className="pl-7 text-xs text-sand-dim">+{fit.length - max} more in details</li>}
    </ul>
  );
}

/** Full table for the details drawer. */
export function FitTable({ fit }: { fit: FitItem[] }) {
  if (!fit.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-sand/15">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="bg-ink/50 text-xs text-sand-dim">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">You asked for</th>
            <th scope="col" className="px-4 py-2 font-semibold">This place</th>
            <th scope="col" className="px-4 py-2 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sand/10">
          {fit.map((f) => {
            const S = STATUS[f.status];
            return (
              <tr key={`${f.key}-${f.wanted}`}>
                <td className="px-4 py-2.5 align-top">
                  <span className="block text-xs text-sand-dim">{f.label}</span>
                  <span className="font-semibold text-sand">{f.wanted}</span>
                </td>
                <td className="px-4 py-2.5 align-top">
                  <span className="flex items-start gap-2">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${S.cls}`} aria-hidden>
                      <S.icon className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="text-sand">
                      <span className="sr-only">{S.word}: </span>
                      {f.detail}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 align-top text-xs text-sand-dim">{f.source ? SOURCE[f.source] : 'No data'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
