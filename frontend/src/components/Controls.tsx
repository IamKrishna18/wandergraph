import { Accessibility, Clock, Coins, MapPin, RotateCcw, Sparkles, Sun, Users, Volume1, Wand2, X, type LucideIcon } from 'lucide-react';
import { CITY_META, COMPANIONS, GROUP_ICONS, GROUP_LABELS, money } from '../meta';
import type { FilterGroup, Interpretation, Preferences } from '../types';

interface ChipDef {
  key: string;
  label: string;
  icon: LucideIcon;
  patch: Partial<Preferences>;
}

export function constraintChips(p: Preferences): ChipDef[] {
  const sym = CITY_META[p.city].symbol;
  const out: ChipDef[] = [];
  if (p.locality) out.push({ key: 'locality', label: p.locality, icon: MapPin, patch: { locality: null } });
  if (p.companion_type) out.push({ key: 'companion', label: `With ${p.companion_type}`, icon: Users, patch: { companion_type: null } });
  if (p.budget_max != null)
    out.push({ key: 'budget', label: p.budget_max === 0 ? 'Free only' : `Up to ${money(p.budget_max, sym)} each`, icon: Coins, patch: { budget_max: null } });
  for (const g of p.interests) out.push({ key: `int-${g}`, label: GROUP_LABELS[g] ?? g, icon: GROUP_ICONS[g] ?? Sparkles, patch: { interests: p.interests.filter((x) => x !== g) } });
  for (const a of p.atmosphere) out.push({ key: `atm-${a}`, label: a[0].toUpperCase() + a.slice(1), icon: Sparkles, patch: { atmosphere: p.atmosphere.filter((x) => x !== a) } });
  if (p.preferred_time) out.push({ key: 'time', label: p.preferred_time[0].toUpperCase() + p.preferred_time.slice(1), icon: Clock, patch: { preferred_time: null } });
  if (p.indoor_outdoor) out.push({ key: 'io', label: p.indoor_outdoor === 'indoor' ? 'Indoors' : 'Outdoors', icon: Sun, patch: { indoor_outdoor: null } });
  if (p.crowd_preference) out.push({ key: 'crowd', label: p.crowd_preference === 'quiet' ? 'Fewer crowds' : 'Buzzing', icon: Volume1, patch: { crowd_preference: null } });
  if (p.accessibility_requirements.length) out.push({ key: 'wheel', label: 'Wheelchair access', icon: Accessibility, patch: { accessibility_requirements: [] } });
  for (const a of p.desired_activities) out.push({ key: `act-${a}`, label: a.replace(/_/g, ' '), icon: Wand2, patch: { desired_activities: p.desired_activities.filter((x) => x !== a) } });
  return out;
}

export function Understanding({ interpretation, prefs, onPatch, onReset }: {
  interpretation: Interpretation | null;
  prefs: Preferences | null;
  onPatch: (patch: Partial<Preferences>) => void;
  onReset: () => void;
}) {
  if (!prefs) return null;
  const chips = constraintChips(prefs);
  const corrections = interpretation?.corrections ?? [];
  if (!chips.length && !corrections.length) return null;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {corrections.length > 0 && (
        <p className="text-sm text-sand-dim">
          Read{' '}
          {corrections.map((c, i) => (
            <span key={c.from}>
              {i > 0 && ', '}
              <s className="text-sand-faint">{c.from}</s> as <strong className="text-accent">{c.to}</strong>
            </span>
          ))}
          .
        </p>
      )}
      {interpretation?.budget_note && prefs.budget_max != null && (
        <p className="text-sm text-sand-dim">
          Read “{CITY_META[prefs.city].symbol}{interpretation.budget_note}” as up to <strong className="text-accent">{money(prefs.budget_max, CITY_META[prefs.city].symbol)} each</strong>.
        </p>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mr-1">Looking for</span>
          {chips.map(({ key, label, icon: Icon, patch }) => (
            <button key={key} type="button" className="chip chip-on group" onClick={() => onPatch(patch)} aria-label={`Remove ${label}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span>{label}</span>
              <X className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" aria-hidden />
            </button>
          ))}
          <button type="button" onClick={onReset} className="ml-1 inline-flex items-center gap-1 text-sm text-sand-faint underline-offset-4 hover:text-sand hover:underline">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export function FilterRail({ filters, prefs, onCategory, onCompanion, onBudget }: {
  filters: FilterGroup[];
  prefs: Preferences | null;
  onCategory: (id: string | null) => void;
  onCompanion: (c: Preferences['companion_type']) => void;
  onBudget: (b: number | null) => void;
}) {
  const city = prefs?.city ?? 'hyderabad';
  const sym = CITY_META[city].symbol;
  const active = prefs?.category ?? null;
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin lg:mx-0 lg:flex-wrap lg:px-0">
        <button type="button" className={`chip shrink-0 ${active === null ? 'chip-on' : ''}`} aria-pressed={active === null} onClick={() => onCategory(null)}>
          Everything
        </button>
        {filters.map((f) => {
          const Icon = GROUP_ICONS[f.id] ?? Sparkles;
          const on = active === f.id;
          return (
            <button key={f.id} type="button" className={`chip shrink-0 ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => onCategory(on ? null : f.id)}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Who's coming" className="flex items-center gap-0.5 rounded-lg border border-sand/10 bg-white/[0.02] p-0.5">
          {COMPANIONS.map((c) => {
            const on = prefs?.companion_type === c.id;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => onCompanion(on ? null : c.id)}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${on ? 'bg-white/[0.09] text-sand' : 'text-sand-faint hover:text-sand'}`}>
                {c.label}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Budget per person" className="flex items-center gap-0.5 rounded-lg border border-sand/10 bg-white/[0.02] p-0.5">
          {CITY_META[city].budgetTiers.map((b) => {
            const on = prefs?.budget_max === b;
            return (
              <button key={b} type="button" aria-pressed={on} onClick={() => onBudget(on ? null : b)}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${on ? 'bg-white/[0.09] text-sand' : 'text-sand-faint hover:text-sand'}`}>
                {b === 0 ? 'Free' : `≤ ${money(b, sym)}`}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
