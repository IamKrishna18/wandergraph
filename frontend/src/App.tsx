import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Info, LayoutGrid, Loader2, Map as MapIcon, Sparkles } from 'lucide-react';
import { useCityGraph, useDiscovery, useReveal, useSpotlight } from './hooks';
import { CITY_META, GROUP_NOUNS } from './meta';
import type { CityId, FilterGroup, Recommendation } from './types';
import { TopBar } from './components/TopBar';
import { Hero } from './components/Hero';
import { FilterRail, Understanding } from './components/Controls';
import { PlaceCard, SkeletonCard } from './components/PlaceCard';
import { PlaceDrawer } from './components/PlaceDrawer';
import { GraphExplorer } from './components/GraphExplorer';
import { Planner, STARTERS } from './components/Planner';
import { MapView } from './components/MapView';
import { CityStrip, Faq, Footer, PlanTeaser, PromptMarquee, SectionHead } from './components/Sections';

const FILTERS: FilterGroup[] = [
  { id: 'heritage', label: 'Heritage', icon: 'Landmark' },
  { id: 'spiritual', label: 'Temples & Shrines', icon: 'Flame' },
  { id: 'nature', label: 'Nature & Views', icon: 'Trees' },
  { id: 'food', label: 'Food', icon: 'UtensilsCrossed' },
  { id: 'cafe', label: 'Cafes', icon: 'Coffee' },
  { id: 'nightlife', label: 'Nightlife', icon: 'Wine' },
  { id: 'shopping', label: 'Markets & Shopping', icon: 'ShoppingBag' },
  { id: 'fun', label: 'Fun & Experiences', icon: 'Sparkles' },
];

export default function App() {
  const { state, search: runSearch, refine: runRefine, setCategory, applyPrefs, switchCity: runSwitchCity, resetAll, loadMore, sessionId } = useDiscovery('hyderabad');
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [graphFull, setGraphFull] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  const [planner, setPlanner] = useState<{ open: boolean; starter: { text: string; n: number } | null }>({ open: false, starter: null });
  const [refine, setRefine] = useState('');
  const [refineVisible, setRefineVisible] = useState(typeof IntersectionObserver === 'undefined');
  const resultsRef = useRef<HTMLElement>(null);
  useReveal();
  useSpotlight();

  useEffect(() => {
    void runSearch('', state.city);
    // first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the refine bar follows you while the results are on screen
  useEffect(() => {
    const el = resultsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setRefineVisible(e.isIntersecting), { rootMargin: '-30% 0px -30% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const city = state.city;
  const meta = CITY_META[city];
  const graph = useCityGraph(city);
  const areas = useMemo(() => graph.data?.nodes.filter((n) => n.data.type === 'Neighborhood').map((n) => n.data.label ?? '').filter(Boolean) ?? [], [graph.data]);
  const graphSize = graph.data ? { nodes: graph.data.nodes.length, edges: graph.data.edges.length } : null;

  const toResults = () => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const switchCity = useCallback(
    (c: CityId) => {
      if (c === city) return;
      void runSwitchCity(c);
    },
    [city, runSwitchCity],
  );

  const search = useCallback(
    (q: string) => {
      void runSearch(q);
      toResults();
    },
    [runSearch],
  );

  const submitRefine = (e: FormEvent) => {
    e.preventDefault();
    if (!refine.trim()) return;
    void runRefine(refine.trim());
    setRefine('');
  };

  const openGraph = useCallback((focus: string | null) => setGraphFull({ open: true, focus }), []);
  const openPlace = useCallback((id: string) => {
    setGraphFull((g) => ({ ...g, open: false }));
    setDetailId(id);
  }, []);
  const openRec = useCallback((r: Recommendation) => setDetailId(r.place.id), []);
  const startPlan = useCallback((text?: string) => setPlanner((p) => ({ open: true, starter: text ? { text, n: (p.starter?.n ?? 0) + 1 } : p.starter })), []);
  const filterCategory = useCallback(
    (g: string) => {
      setGraphFull({ open: false, focus: null });
      void setCategory(g);
      toResults();
    },
    [setCategory],
  );

  const points = useMemo(
    () => [
      ...state.results
        .filter((r) => r.place.coordinates)
        .map((r, i) => ({ id: r.place.id, lat: r.place.coordinates!.latitude, lng: r.place.coordinates!.longitude, label: String(i + 1), title: `${i + 1}. ${r.place.name}` })),
      ...state.nearby
        .filter((r) => r.place.coordinates)
        .map((r) => ({ id: r.place.id, lat: r.place.coordinates!.latitude, lng: r.place.coordinates!.longitude, label: '•', title: `${r.place.name} (outside ${state.prefs?.locality ?? 'the area'})`, dim: true })),
    ],
    [state.results, state.nearby, state.prefs?.locality],
  );
  const locality = state.prefs?.locality ?? null;
  const match = useMemo(() => [...state.results, ...state.nearby].find((r) => r.place.id === detailId) ?? null, [state.results, state.nearby, detailId]);
  const wantedLabel = useMemo(() => {
    const ids = state.prefs?.category ? [state.prefs.category] : state.prefs?.interests ?? [];
    const labels = ids.map((g) => GROUP_NOUNS[g]).filter(Boolean);
    return labels.length ? labels.join(' or ') : 'places';
  }, [state.prefs]);
  const nearbyHasDistances = state.nearby.some((r) => r.distance_from_locality_km != null);

  const heading = state.prefs?.search_query
    ? `“${state.prefs.search_query.replace(/ · /g, ', ')}”`
    : state.prefs?.category
      ? `${FILTERS.find((f) => f.id === state.prefs?.category)?.label ?? 'Places'} in ${meta.name}`
      : `Where to start in ${meta.name}`;
  const countLine = state.loading
    ? 'Searching…'
    : locality
      ? state.results.length
        ? `${state.results.length} ${state.results.length === 1 ? 'place' : 'places'} inside ${locality}, best match first.`
        : `Nothing inside ${locality} yet.`
      : `${state.results.length} place${state.results.length === 1 ? '' : 's'}, best match first.`;

  return (
    <>
      <a href="#results" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-sand focus:px-4 focus:py-2 focus:text-ink">
        Skip to results
      </a>
      <TopBar city={city} onCity={switchCity} onGraph={() => openGraph(`city:${city}`)} onPlanner={() => startPlan()} />

      <main>
        <Hero key={city} city={city} loading={state.loading} provider={state.provider} areas={areas} graphSize={graphSize} onSearch={search} />
        <PromptMarquee city={city} onSearch={search} />

        <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6" aria-label="Cities">
          <CityStrip city={city} onPick={switchCity} />
        </section>

        {/* 01: results */}
        <section id="results" ref={resultsRef} className="mx-auto max-w-7xl scroll-mt-16 px-4 pt-20 sm:px-6">
          <SectionHead
            n="01"
            kicker="Results"
            title={<span className="line-clamp-2">{heading}</span>}
            sub={<span aria-live="polite">{countLine}</span>}
            right={
              <div role="group" aria-label="View" className="flex rounded-lg border border-sand/10 bg-white/[0.02] p-0.5">
                <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors ${view === 'grid' ? 'bg-white/[0.09] text-sand' : 'text-sand-faint hover:text-sand'}`}>
                  <LayoutGrid className="h-4 w-4" aria-hidden /> Cards
                </button>
                <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors ${view === 'map' ? 'bg-white/[0.09] text-sand' : 'text-sand-faint hover:text-sand'}`}>
                  <MapIcon className="h-4 w-4" aria-hidden /> Map
                </button>
              </div>
            }
          />

          <div className="mt-8 flex flex-col gap-4 rounded-xl border border-sand/10 bg-river/50 p-3 sm:p-4">
            <FilterRail
              filters={FILTERS}
              prefs={state.prefs}
              onCategory={(id) => setCategory(id)}
              onCompanion={(c) => applyPrefs({ companion_type: c })}
              onBudget={(b) => applyPrefs({ budget_max: b })}
            />
            <Understanding interpretation={state.interpretation} prefs={state.prefs} onPatch={(patch) => applyPrefs(patch)} onReset={() => resetAll()} />
          </div>

          {(state.notice || (state.localityExpansion && locality && state.results.length > 0)) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-saffron/25 bg-saffron/[0.06] px-4 py-3 text-sm text-sand">
              <Info className="h-4 w-4 shrink-0 text-saffron" aria-hidden />
              <span className="flex-1">{state.notice ?? `Only ${state.results.length} ${state.results.length === 1 ? 'match' : 'matches'} inside ${locality}. ${state.nearby.length ? 'Nearby options are listed below.' : ''}`}</span>
              {state.localityExpansion && locality && state.results.length > 0 && (
                <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => applyPrefs({ locality: null })}>
                  Search all of {meta.name}
                </button>
              )}
            </div>
          )}

          {state.error && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-ember/30 bg-ember/[0.07] px-4 py-3 text-sm" role="alert">
              <span className="flex-1 text-sand">{state.error}</span>
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => applyPrefs({})}>
                Try again
              </button>
            </div>
          )}

          <div className="mt-6" aria-busy={state.loading}>
            {state.loading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : state.results.length === 0 && locality ? (
              <div className="dot-bg rounded-xl border border-dashed border-sand/15 px-6 py-14 text-center">
                <p className="label">0 results inside {locality}</p>
                <h3 className="mt-3 text-2xl text-sand sm:text-3xl">No {wantedLabel} found inside {locality}</h3>
                <p className="mx-auto mt-3 max-w-lg text-sand-dim">
                  {state.provider?.is_live
                    ? `Google Places has nothing matching inside ${locality} right now.`
                    : `WanderGraph's curated list has no ${wantedLabel} in ${locality}. Add a Google Places key to search every place in ${locality}.`}{' '}
                  {state.nearby.length > 0 ? (nearbyHasDistances ? 'The closest ones are below.' : `Here are ${wantedLabel} elsewhere in ${meta.name}.`) : ''}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-primary" onClick={() => applyPrefs({ locality: null })}>
                    Search all of {meta.name}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => document.getElementById('nearby')?.scrollIntoView({ behavior: 'smooth' })} disabled={!state.nearby.length}>
                    See nearby
                  </button>
                </div>
              </div>
            ) : state.results.length === 0 ? (
              <div className="dot-bg rounded-xl border border-dashed border-sand/15 px-6 py-14 text-center">
                <h3 className="text-2xl text-sand sm:text-3xl">Nothing fits all of that</h3>
                <p className="mx-auto mt-3 max-w-md text-sand-dim">Remove a constraint above, widen the budget, or try a different neighbourhood.</p>
                <button type="button" className="btn-primary mt-6" onClick={() => resetAll()}>
                  Show top places in {meta.name}
                </button>
              </div>
            ) : view === 'map' ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                <MapView points={points} center={meta.center} area={state.area} onSelect={setDetailId} className="h-[560px]" ariaLabel={`Map of results in ${meta.name}`} />
                <ol className="max-h-[560px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {state.results.map((r, i) => (
                    <li key={r.place.id}>
                      <button type="button" onClick={() => setDetailId(r.place.id)} className="flex w-full items-start gap-3 rounded-lg border border-sand/10 bg-river p-3 text-left transition-colors hover:border-sand/25">
                        <span className="pt-0.5 font-mono text-xs text-accent">{String(i + 1).padStart(2, '0')}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-sand">{r.place.name}</span>
                          <span className="block truncate text-sm text-sand-dim">
                            {r.distance_from_locality_km != null && locality ? `${r.distance_from_locality_km.toFixed(1)} km from ${locality}. ` : ''}
                            {r.matched_reasons.slice(0, 2).join(', ') || r.place.locality}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {state.results.map((r, i) => (
                  <PlaceCard key={r.place.id} rec={r} rank={i + 1} feature={i === 0 && state.results.length > 2} localityName={locality} onOpen={openRec} onGraph={openGraph} />
                ))}
              </div>
            )}
          </div>

          {!state.loading && locality && state.nearby.length > 0 && view === 'grid' && (
            <section id="nearby" className="mt-14 scroll-mt-20" aria-labelledby="nearby-h">
              <div className="flex items-end justify-between gap-4 border-b border-sand/10 pb-4">
                <div>
                  <p className="label">Outside the area</p>
                  <h2 id="nearby-h" className="mt-2 text-2xl text-sand">
                    {nearbyHasDistances ? `Just outside ${locality}` : `Elsewhere in ${meta.name}`}
                  </h2>
                  <p className="mt-1 text-sand-dim">{nearbyHasDistances ? `Not inside ${locality}; sorted by distance from its centre.` : `These ${wantedLabel} are not in ${locality}.`}</p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {state.nearby.map((r, i) => (
                  <PlaceCard key={r.place.id} rec={r} rank={i + 1} localityName={locality} onOpen={openRec} onGraph={openGraph} />
                ))}
              </div>
            </section>
          )}

          {state.nextPageToken && !state.loading && (
            <div className="mt-10 text-center">
              <button type="button" className="btn-ghost px-6 py-2.5" onClick={loadMore} disabled={state.loadingMore}>
                {state.loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {state.loadingMore ? 'Loading more' : 'Show more places'}
              </button>
            </div>
          )}
        </section>

        {/* 02: plan */}
        <section id="plan" className="mx-auto max-w-7xl scroll-mt-16 px-4 pt-28 sm:px-6">
          <SectionHead
            n="02"
            kicker="Day planner"
            title="Turn it into a day."
            sub="Pick a starting point or describe your own. Every stop is checked against its opening hours for that day, distances are measured, and you can swap anything."
          />
          <div className="mt-10">
            <PlanTeaser city={city} starters={STARTERS[city].slice(0, 3)} stops={state.results.length ? state.results : state.nearby} onStart={startPlan} />
          </div>
        </section>

        {/* 03: graph */}
        <section id="graph" className="mx-auto max-w-7xl scroll-mt-16 px-4 pt-28 sm:px-6">
          <SectionHead
            n="03"
            kicker="Knowledge graph"
            title={`How ${meta.name} is connected.`}
            sub="The city sits in the middle, neighbourhoods around it, their places beyond, and what describes those places on the outer ring. Hover anything to trace its links; click to inspect."
            right={
              <button type="button" className="btn-ghost" onClick={() => openGraph(`city:${city}`)}>
                <Sparkles className="h-4 w-4" aria-hidden /> Full screen
              </button>
            }
          />
          <div className="reveal mt-10">
            {!graphFull.open && (
              <GraphExplorer key={city} city={city} data={graph.data} error={graph.error} variant="inline" onOpenPlace={openPlace} onFilterCategory={filterCategory} onExpand={() => openGraph(null)} />
            )}
          </div>
        </section>

        {/* 04: questions */}
        <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-24 pt-28 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHead n="04" kicker="Questions" title="How it works, plainly." sub="What WanderGraph checks, what it can't, and where the data comes from." />
          <Faq />
        </section>
      </main>

      <Footer
        onSearchFocus={() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setTimeout(() => document.getElementById('hero-search')?.focus(), 400);
        }}
      />

      {/* refine bar: follow-ups keep what's already set */}
      <form
        onSubmit={submitRefine}
        className={`fixed inset-x-0 bottom-4 z-30 px-4 transition-[opacity,transform] duration-300 ${refineVisible || refine ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}`}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border border-sand/15 bg-river/90 p-1.5 pl-4 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl focus-within:border-accent/60">
          <span className="label hidden text-accent sm:inline">Refine</span>
          <label htmlFor="refine" className="sr-only">
            Refine these results
          </label>
          <input
            id="refine"
            value={refine}
            onChange={(e) => setRefine(e.target.value)}
            placeholder="make it quieter, for my parents, in the evening…"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-sand placeholder:text-sand-faint focus:outline-none"
          />
          <button type="submit" className="btn-primary px-3 py-1.5" disabled={!refine.trim() || state.loading}>
            Refine
          </button>
        </div>
      </form>

      <PlaceDrawer placeId={detailId} match={match} localityName={locality} city={city} onClose={() => setDetailId(null)} onOpen={setDetailId} onGraph={(id) => { setDetailId(null); openGraph(id); }} />
      {graphFull.open && (
        <GraphExplorer city={city} data={graph.data} error={graph.error} focus={graphFull.focus} variant="full" onClose={() => setGraphFull({ open: false, focus: null })} onOpenPlace={openPlace} onFilterCategory={filterCategory} />
      )}
      <Planner open={planner.open} city={city} sessionId={sessionId} starter={planner.starter} onClose={() => setPlanner((p) => ({ ...p, open: false }))} onOpenPlace={(id) => { setPlanner((p) => ({ ...p, open: false })); setDetailId(id); }} />
    </>
  );
}
