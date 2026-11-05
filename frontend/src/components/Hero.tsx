import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react';
import { CITY_META } from '../meta';
import { useCityClock, usePrefersReducedMotion } from '../hooks';
import { FACET_COLOR, FACET_LABEL, FACET_ORDER, parseFacets, type Facet, type FacetKey } from '../parse';
import type { CityId, ProviderStatus } from '../types';

interface Props {
  city: CityId;
  loading: boolean;
  provider: ProviderStatus | null;
  areas: string[];
  graphSize: { nodes: number; edges: number } | null;
  onSearch: (q: string) => void;
}

/** Types out the city's example searches while the box is empty and unfocused. */
function useTypewriter(lines: string[], paused: boolean, reduced: boolean) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(reduced ? lines[0]?.length ?? 0 : 0);
  const [dir, setDir] = useState<1 | -1>(1);
  useEffect(() => {
    setI(0);
    setN(reduced ? lines[0]?.length ?? 0 : 0);
    setDir(1);
  }, [lines, reduced]);
  useEffect(() => {
    if (paused || reduced || !lines.length) return;
    const line = lines[i % lines.length];
    let wait = dir === 1 ? 42 + Math.random() * 40 : 16;
    if (dir === 1 && n >= line.length) wait = 2600;
    if (dir === -1 && n <= 0) wait = 350;
    const t = setTimeout(() => {
      if (dir === 1 && n >= line.length) setDir(-1);
      else if (dir === -1 && n <= 0) {
        setDir(1);
        setI((x) => (x + 1) % lines.length);
      } else setN((x) => x + dir);
    }, wait);
    return () => clearTimeout(t);
  }, [i, n, dir, paused, reduced, lines]);
  const line = lines[i % Math.max(lines.length, 1)] ?? '';
  return { text: line.slice(0, n), full: line, done: n >= line.length };
}

export function Hero({ city, loading, provider, areas, graphSize, onSearch }: Props) {
  const meta = CITY_META[city];
  const reduced = usePrefersReducedMotion();
  const clock = useCityClock(meta.timeZone);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const demo = useTypewriter(meta.demos, focused || q.length > 0, reduced);
  const shown = q || demo.text;
  const facets = useMemo(() => parseFacets(shown, city, areas), [shown, city, areas]);

  // "/" or Cmd/Ctrl+K jumps to the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) onSearch(q.trim());
  };
  const runDemo = () => {
    setQ(demo.full);
    onSearch(demo.full);
  };

  return (
    <section id="top" className="relative isolate overflow-hidden border-b border-sand/10">
      <div className="grid-bg pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-[-260px] -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.13] blur-[120px]" aria-hidden />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-10 lg:pb-28">
        <div className="animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-sand/10 bg-white/[0.03] py-1 pl-2 pr-3 text-xs text-sand-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${provider?.is_live ? 'animate-pulseDot bg-jal' : 'bg-saffron'}`} aria-hidden />
            {provider ? (provider.is_live ? (/OpenStreetMap/.test(provider.provider_name) ? 'Live OpenStreetMap' : 'Live Google Places') : 'Curated places') : 'Connecting'}
            <span className="text-sand-faint">·</span>
            <span className="font-mono">{meta.code} {clock}</span>
          </p>

          <h1 className="mt-6 text-[clamp(2.5rem,5.2vw,4.4rem)] font-semibold tracking-[-0.045em]">
            <span className="text-sheen">Search {meta.name}</span>{' '}
            <br />
            <span className="text-sand-faint">the way you'd say it.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-sand-dim">
            Say the area, the mood, who's coming and what you'll spend. WanderGraph keeps results inside the area you named, and shows what matched for each place.
          </p>

          <form onSubmit={submit} className="mt-8 max-w-2xl" role="search">
            <label htmlFor="hero-search" className="sr-only">
              Describe what you want to do in {meta.name}
            </label>
            <div className="group relative rounded-xl bg-gradient-to-b from-sand/20 to-sand/5 p-px transition-colors focus-within:from-accent/80 focus-within:to-accent/20">
              <div className="flex items-center gap-3 rounded-[11px] bg-river px-4 py-2.5">
                <Search className="h-5 w-5 shrink-0 text-sand-faint group-focus-within:text-accent" aria-hidden />
                <input
                  id="hero-search"
                  ref={input}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={`Try "${meta.demos[1] ?? meta.prompts[0]}"`}
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-sand placeholder:text-sand-faint focus:outline-none sm:text-lg"
                  autoComplete="off"
                />
                <span className="hidden items-center gap-1 sm:flex" aria-hidden>
                  {!q && <kbd className="kbd">/</kbd>}
                </span>
                <button type="submit" className="btn-primary shrink-0 px-3.5" disabled={loading || !q.trim()}>
                  <span className="hidden sm:inline">Search</span>
                  <CornerDownLeft className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </form>

          <div className="mt-5 flex max-w-2xl flex-wrap items-center gap-2">
            <span className="label mr-1">Try</span>
            {meta.prompts.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                onClick={() => {
                  setQ(p);
                  onSearch(p);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <ParseCard
          city={city}
          text={shown}
          typing={!q && !reduced}
          facets={facets}
          graphSize={graphSize}
          onRun={q ? () => onSearch(q.trim()) : runDemo}
          canRun={(q ? q.trim() : demo.full).length > 0 && !loading}
        />
      </div>
    </section>
  );
}

/* ---------------- the "watch it read your search" card ---------------- */

const CX = 230;
const CY = 118;
const SLOTS: Record<FacetKey, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = {
  area: { x: CX - 92, y: 42, anchor: 'end' },
  type: { x: CX + 92, y: 42, anchor: 'start' },
  mood: { x: CX + 124, y: CY, anchor: 'start' },
  with: { x: CX + 92, y: 194, anchor: 'start' },
  budget: { x: CX - 92, y: 194, anchor: 'end' },
  when: { x: CX - 124, y: CY, anchor: 'end' },
};

function Highlighted({ text, facets }: { text: string; facets: Facet[] }) {
  const parts: { t: string; f?: Facet }[] = [];
  let at = 0;
  for (const f of [...facets].sort((a, b) => a.start - b.start)) {
    if (f.start < at) continue;
    if (f.start > at) parts.push({ t: text.slice(at, f.start) });
    parts.push({ t: text.slice(f.start, f.end), f });
    at = f.end;
  }
  if (at < text.length) parts.push({ t: text.slice(at) });
  return (
    <>
      {parts.map((p, i) =>
        p.f ? (
          <mark key={i} className="rounded-[3px] bg-transparent px-0.5 text-sand" style={{ boxShadow: `inset 0 -2px 0 ${FACET_COLOR[p.f.key]}`, background: `${FACET_COLOR[p.f.key]}1f` }}>
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

function ParseCard({ city, text, typing, facets, graphSize, onRun, canRun }: {
  city: CityId;
  text: string;
  typing: boolean;
  facets: Facet[];
  graphSize: { nodes: number; edges: number } | null;
  onRun: () => void;
  canRun: boolean;
}) {
  const meta = CITY_META[city];
  const byKey = new Map(facets.map((f) => [f.key, f]));
  const area = byKey.get('area');
  const found = facets.length;

  return (
    <div className="spot animate-rise rounded-2xl border border-sand/10 bg-river/80 shadow-[0_30px_120px_-40px_rgba(255,106,61,0.35)] backdrop-blur [animation-delay:120ms]" aria-label="How WanderGraph reads a search">
      <div className="flex items-center gap-2 border-b border-sand/10 px-4 py-3">
        <span className="hidden gap-1.5 sm:flex" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-sand/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-sand/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-sand/15" />
        </span>
        <span className="label whitespace-nowrap sm:ml-2">Reading your search</span>
        <span className="label ml-auto whitespace-nowrap text-sand-dim">
          {found}/6<span className="hidden sm:inline"> understood</span>
        </span>
      </div>

      <div className="px-5 pt-5">
        <p className="min-h-[3.5rem] font-mono text-[15px] leading-7 text-sand-dim" aria-live="off">
          <span className="text-sand-faint">&gt; </span>
          <Highlighted text={text} facets={facets} />
          {typing && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-blink bg-accent" aria-hidden />}
        </p>
      </div>

      <svg viewBox="0 0 460 236" className="mx-auto block w-full max-w-[520px]" role="img" aria-label={`${found} parts of the search linked to ${meta.name}`}>
        <defs>
          <radialGradient id="hub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF6A3D" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FF6A3D" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r="62" fill="url(#hub)" />
        <circle cx={CX} cy={CY} r="88" fill="none" stroke="rgba(255,255,255,0.06)" strokeDasharray="2 5" />
        {FACET_ORDER.map((k) => {
          const s = SLOTS[k];
          const f = byKey.get(k);
          const c = FACET_COLOR[k];
          const dx = s.anchor === 'end' ? -10 : s.anchor === 'start' ? 10 : 0;
          return (
            <g key={k}>
              <line x1={CX} y1={CY} x2={s.x} y2={s.y} stroke="rgba(255,255,255,0.07)" />
              {f && (
                <line
                  key={`${k}-${f.value}`}
                  x1={CX}
                  y1={CY}
                  x2={s.x}
                  y2={s.y}
                  stroke={c}
                  strokeOpacity="0.8"
                  strokeWidth="1.5"
                  pathLength={1}
                  strokeDasharray="1"
                  className="animate-draw"
                />
              )}
              <circle cx={s.x} cy={s.y} r={f ? 5 : 3.5} fill={f ? c : '#09090B'} stroke={f ? c : 'rgba(255,255,255,0.25)'} />
              {f && <circle cx={s.x} cy={s.y} r="10" fill="none" stroke={c} strokeOpacity="0.35" className="animate-pop" style={{ transformOrigin: `${s.x}px ${s.y}px` }} />}
              <text x={s.x + dx} y={s.y - 4} textAnchor={s.anchor} className="fill-sand-faint font-mono" fontSize="8.5" letterSpacing="1.2">
                {FACET_LABEL[k].toUpperCase()}
              </text>
              <text x={s.x + dx} y={s.y + 9} textAnchor={s.anchor} fontSize="11.5" fontWeight="500" fill={f ? '#EDEDEF' : 'rgba(255,255,255,0.28)'}>
                {f ? (f.value.length > 16 ? `${f.value.slice(0, 15)}…` : f.value) : 'not set'}
              </text>
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r="20" fill="#09090B" stroke="#FF6A3D" strokeWidth="1.5" />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#EDEDEF" className="font-mono">
          {meta.code}
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-3 border-t border-sand/10 px-5 py-3.5">
        <p className="min-w-0 flex-1 text-sm text-sand-dim">
          {area ? (
            <>
              Results stay inside <span className="text-sand">{area.value}</span>
            </>
          ) : graphSize ? (
            <>
              Matched against a graph of <span className="font-mono text-sand">{graphSize.nodes}</span> nodes and <span className="font-mono text-sand">{graphSize.edges}</span> links
            </>
          ) : (
            'Name a neighbourhood to keep results inside it'
          )}
        </p>
        <button type="button" onClick={onRun} disabled={!canRun} className="btn-ghost px-3 py-1.5 text-xs">
          Run this search <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
