import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, Minus, Plus } from 'lucide-react';
import { CITY_META, CITY_ORDER } from '../meta';
import { useCityClock } from '../hooks';
import type { CityId, Recommendation } from '../types';
import { Logo } from './TopBar';

export function SectionHead({ n, kicker, title, sub, right }: { n: string; kicker: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="reveal flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        <p className="label flex items-center gap-3">
          <span className="text-accent">{n}</span>
          <span className="h-px w-8 bg-sand/15" aria-hidden />
          {kicker}
        </p>
        <h2 className="mt-4 text-[clamp(1.9rem,4vw,3rem)] text-sand">{title}</h2>
        {sub && <p className="mt-3 max-w-2xl text-base leading-relaxed text-sand-dim sm:text-lg">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------------- cities ---------------- */

function CityTile({ id, active, onPick }: { id: CityId; active: boolean; onPick: (c: CityId) => void }) {
  const m = CITY_META[id];
  const time = useCityClock(m.timeZone);
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={active}
      className={`spot group flex min-h-[150px] flex-col justify-between rounded-xl border p-4 text-left transition-colors sm:p-5 ${
        active ? 'border-accent/50 bg-accent/[0.06]' : 'border-sand/10 bg-river hover:border-sand/25'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="label">{m.code}</span>
        <span className="font-mono text-xs text-sand-faint">{time}</span>
      </div>
      <div>
        <p lang={m.nativeLang} className="text-sm text-sand-faint" aria-hidden>
          {m.native}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-sand sm:text-2xl">
          {m.name}
          {active ? <Check className="h-4 w-4 text-accent" aria-hidden /> : <ArrowRight className="h-4 w-4 -translate-x-1 text-sand-faint opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden />}
        </p>
        <p className="mt-1 line-clamp-1 text-sm text-sand-dim">{m.tagline}</p>
      </div>
    </button>
  );
}

export function CityStrip({ city, onPick }: { city: CityId; onPick: (c: CityId) => void }) {
  return (
    <div className="reveal grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Choose a city">
      {CITY_ORDER.map((id) => (
        <CityTile key={id} id={id} active={id === city} onPick={onPick} />
      ))}
    </div>
  );
}

/* ---------------- example searches, scrolling ---------------- */

export function PromptMarquee({ city, onSearch }: { city: CityId; onSearch: (q: string) => void }) {
  const m = CITY_META[city];
  const items = [...m.demos, ...m.prompts];
  return (
    <div className="marquee-mask relative overflow-hidden border-y border-sand/10 py-3" aria-label="Example searches">
      <div className="marquee-track flex w-max animate-marquee gap-3">
        {[...items, ...items].map((p, i) => (
          <button
            key={`${p}-${i}`}
            type="button"
            tabIndex={i >= items.length ? -1 : 0}
            aria-hidden={i >= items.length}
            onClick={() => onSearch(p)}
            className="inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[13px] text-sand-faint transition-colors hover:bg-white/[0.04] hover:text-sand"
          >
            <span className="text-accent">↳</span>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- planner teaser ---------------- */

const SLOTS = ['09:00', '11:30', '14:00', '17:30'];

export function PlanTeaser({ city, starters, stops, onStart }: { city: CityId; starters: string[]; stops: Recommendation[]; onStart: (prompt?: string) => void }) {
  const m = CITY_META[city];
  const preview = stops.slice(0, 4);
  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="reveal flex flex-col gap-3">
        {starters.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => onStart(s)}
            className="spot group flex items-center gap-4 rounded-xl border border-sand/10 bg-river px-4 py-4 text-left transition-colors hover:border-sand/25"
            style={{ ['--d' as any]: `${i * 60}ms` }}
          >
            <span className="font-mono text-xs text-sand-faint">0{i + 1}</span>
            <span className="flex-1 text-sand">{s}</span>
            <ArrowUpRight className="h-4 w-4 text-sand-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
          </button>
        ))}
        <button type="button" onClick={() => onStart()} className="btn-ghost mt-1 self-start">
          Write your own plan
        </button>
      </div>

      <div className="reveal rounded-xl border border-sand/10 bg-river p-5" style={{ ['--d' as any]: '120ms' }} aria-label="Example day plan built from the current results">
        <div className="flex items-center justify-between">
          <p className="label">Sample day · {m.name}</p>
          <p className="font-mono text-xs text-sand-faint">{preview.length} stops</p>
        </div>
        {preview.length === 0 ? (
          <p className="mt-6 text-sm text-sand-dim">Search above and a sample day appears here.</p>
        ) : (
          <ol className="relative mt-5 space-y-3 before:absolute before:bottom-3 before:left-[55px] before:top-3 before:w-px before:bg-sand/10">
            {preview.map((r, i) => {
              const hours = r.place.opening_hours_text;
              return (
                <li key={r.place.id} className="relative grid grid-cols-[44px_22px_1fr] items-start gap-2">
                  <span className="pt-0.5 font-mono text-xs text-sand-faint">{SLOTS[i]}</span>
                  <span className="relative z-10 mt-1 grid h-3.5 w-3.5 place-items-center rounded-full border border-accent/60 bg-ink" aria-hidden>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  </span>
                  <div className="min-w-0 rounded-lg border border-sand/[0.07] bg-ink/50 px-3 py-2">
                    <p className="truncate text-sm font-medium text-sand">{r.place.name}</p>
                    <p className="truncate text-xs text-sand-faint">{hours ? `Listed hours: ${hours}` : 'Hours not listed, planner will flag it'}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sand/10 pt-4">
          <p className="text-xs text-sand-faint">Each stop is checked against its listed hours for the day.</p>
          <button type="button" onClick={() => onStart(starters[0])} className="btn-primary px-3 py-1.5 text-xs">
            Plan this day <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- FAQ ---------------- */

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Why does it say "nothing inside" an area sometimes?',
    a: "Because that's the truth. If you ask for parks in Uppal and none of the places WanderGraph knows are in Uppal, you'll be told so, and the closest matches elsewhere in the city are listed separately with their distance. Results are never padded with places from the other side of the city.",
  },
  {
    q: 'Where does the data come from?',
    a: 'Two sources, and every place is labelled with which one. About 20 places per city are hand-curated into the knowledge graph. With a Google Places key, live Google results are added and their photos, ratings and opening status come straight from Google.',
  },
  {
    q: 'What does the checklist on each card mean?',
    a: 'One line for each thing you asked for: area, type of place, mood, who is coming, budget, time. A tick means the data confirms it, a cross means it does not, and a question mark means nobody knows yet, so check before you go.',
  },
  {
    q: 'How does the day planner check a plan?',
    a: "Every stop's listed opening hours are compared with the time slot for that day of the week, distances between stops are worked out from coordinates, and a meal slot at a place that doesn't serve food is flagged. You can swap any stop.",
  },
  {
    q: 'What is the knowledge graph?',
    a: 'Each city is a network: the city, its neighbourhoods, the places in them, and what describes those places (category, mood, who it suits, time of day, price). Searches are matched against those links, and you can explore the graph yourself below.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="reveal divide-y divide-sand/10 rounded-xl border border-sand/10">
      {FAQ.map((f, i) => {
        const on = open === i;
        return (
          <div key={f.q}>
            <h3>
              <button
                type="button"
                aria-expanded={on}
                aria-controls={`faq-${i}`}
                id={`faq-q-${i}`}
                onClick={() => setOpen(on ? null : i)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left text-base font-medium tracking-[-0.01em] text-sand transition-colors hover:bg-white/[0.02]"
              >
                <span className="font-mono text-xs text-sand-faint">0{i + 1}</span>
                <span className="flex-1">{f.q}</span>
                {on ? <Minus className="h-4 w-4 text-accent" aria-hidden /> : <Plus className="h-4 w-4 text-sand-faint" aria-hidden />}
              </button>
            </h3>
            <div id={`faq-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className={`grid transition-[grid-template-rows] duration-300 ${on ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <p className="px-5 pb-5 pl-[3.25rem] text-sand-dim">{f.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- footer ---------------- */

export function Footer({ onSearchFocus }: { onSearchFocus: () => void }) {
  return (
    <footer className="relative overflow-hidden border-t border-sand/10">
      <div className="mx-auto max-w-7xl px-4 pb-32 pt-16 sm:px-6">
        <div className="reveal flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div>
            <h2 className="max-w-xl text-[clamp(1.9rem,4vw,3rem)] text-sand">Where to next?</h2>
            <p className="mt-3 max-w-md text-sand-dim">Describe it in a sentence. WanderGraph does the rest, and tells you what it couldn't confirm.</p>
          </div>
          <button type="button" className="btn-primary px-5 py-2.5" onClick={onSearchFocus}>
            Start a search <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mt-16 grid gap-8 border-t border-sand/10 pt-8 text-sm sm:grid-cols-[1fr_auto_auto]">
          <div className="flex items-start gap-3">
            <Logo className="h-7 w-7 shrink-0 text-sand" />
            <p className="max-w-sm text-sand-faint">
              Curated places are hand-compiled and not independently verified. Live places come from Google Places. Always check hours and prices before you go.
            </p>
          </div>
          <ul className="space-y-2 text-sand-dim">
            <li className="label mb-3">Explore</li>
            <li><a className="hover:text-sand" href="#results">Results</a></li>
            <li><a className="hover:text-sand" href="#plan">Day planner</a></li>
            <li><a className="hover:text-sand" href="#graph">Knowledge graph</a></li>
          </ul>
          <ul className="space-y-2 text-sand-dim">
            <li className="label mb-3">Project</li>
            <li><a className="hover:text-sand" href="https://github.com/codeMaster60/wandergraph" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a className="hover:text-sand" href="https://github.com/codeMaster60/wandergraph/blob/main/docs/api.md" target="_blank" rel="noreferrer">API reference</a></li>
          </ul>
        </div>
      </div>
      <p aria-hidden className="pointer-events-none absolute -bottom-[0.22em] left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[18vw] font-semibold leading-none tracking-[-0.06em] text-white/[0.025]">
        WanderGraph
      </p>
    </footer>
  );
}
