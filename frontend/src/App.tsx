import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Info, LayoutGrid, Loader2, Map as MapIcon, MessageSquarePlus, Network } from 'lucide-react';
import { ElementContext, useDiscovery, useElementState } from './hooks';
import { CITY_META, GROUP_NOUNS } from './meta';
import type { CityId, FilterGroup, Recommendation } from './types';
import { TopBar } from './components/TopBar';
import { Hero } from './components/Hero';
import { FilterRail, Understanding } from './components/Controls';
import { PlaceCard, SkeletonCard } from './components/PlaceCard';
import { PlaceDrawer } from './components/PlaceDrawer';
import { GraphOverlay } from './components/GraphOverlay';
import { Planner } from './components/Planner';
import { MapView } from './components/MapView';

const FALLBACK_FILTERS: FilterGroup[] = [
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
  const elementState = useElementState();
  const { state, search: runSearch, refine: runRefine, setCategory, applyPrefs, switchCity: runSwitchCity, resetAll, loadMore, sessionId } = useDiscovery('hyderabad');
  const filters: FilterGroup[] = FALLBACK_FILTERS;
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [refine, setRefine] = useState('');

  useEffect(() => {
    void runSearch('', state.city);
    // first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const city = state.city;
  const meta = CITY_META[city];

  const switchCity = useCallback(
    (c: CityId) => {
      if (c === city) return;
      void runSwitchCity(c);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [city, runSwitchCity],
  );

  const search = useCallback((q: string) => {
    void runSearch(q);
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [runSearch]);

  const submitRefine = (e: FormEvent) => {
    e.preventDefault();
    if (!refine.trim()) return;
    void runRefine(refine.trim());
    setRefine('');
  };

  const openGraph = useCallback((focus: string | null) => setGraph({ open: true, focus }), []);
  const openPlace = useCallback((id: string) => {
    setGraph((g) => ({ ...g, open: false }));
    setDetailId(id);
  }, []);
  const openRec = useCallback((r: Recommendation) => setDetailId(r.place.id), []);

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
    ? `For “${state.prefs.search_query.replace(/ · /g, ', ')}”`
    : state.prefs?.category
      ? `${filters.find((f) => f.id === state.prefs?.category)?.label ?? 'Places'} in ${meta.name}`
      : `Where to start in ${meta.name}`;

  return (
    <ElementContext.Provider value={elementState}>
      <a href="#results" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-ink">
        Skip to results
      </a>
      <TopBar city={city} onCity={switchCity} onGraph={() => openGraph(`city:${city}`)} onPlanner={() => setPlannerOpen(true)} provider={state.provider} />
      <main>
        <Hero key={city} city={city} loading={state.loading} onSearch={search} />

        <section id="results" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-32 pt-8 sm:px-6">
          <div className="flex flex-col gap-5">
            <FilterRail
              filters={filters}
              prefs={state.prefs}
              onCategory={(id) => setCategory(id)}
              onCompanion={(c) => applyPrefs({ companion_type: c })}
              onBudget={(b) => applyPrefs({ budget_max: b })}
            />
            <Understanding
              interpretation={state.interpretation}
              prefs={state.prefs}
              onPatch={(patch) => applyPrefs(patch)}
              onReset={() => resetAll()}
            />
          </div>

          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="line-clamp-2 max-w-4xl font-display text-3xl text-sand sm:text-5xl">{heading}</h2>
              {!state.loading && (
                <p className="mt-1 text-base text-sand-dim" aria-live="polite">
                  {locality
                    ? state.results.length
                      ? `${state.results.length} ${state.results.length === 1 ? 'place' : 'places'} inside ${locality}, best match first`
                      : `Nothing inside ${locality} yet`
                    : `${state.results.length} place${state.results.length === 1 ? '' : 's'}, best match first`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div role="group" aria-label="View" className="flex rounded-full border border-sand/10 bg-river p-1">
                <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${view === 'grid' ? 'bg-accent text-ink' : 'text-sand-dim'}`}>
                  <LayoutGrid className="h-4 w-4" aria-hidden /> Cards
                </button>
                <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${view === 'map' ? 'bg-accent text-ink' : 'text-sand-dim'}`}>
                  <MapIcon className="h-4 w-4" aria-hidden /> Map
                </button>
              </div>
              <button type="button" className="btn-ghost sm:hidden" onClick={() => openGraph(`city:${city}`)} aria-label="Open the knowledge graph">
                <Network className="h-4 w-4" />
              </button>
            </div>
          </div>

          {(state.notice || (state.localityExpansion && locality && state.results.length > 0)) && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-saffron/30 bg-saffron/10 px-4 py-3 text-sm text-sand">
              <Info className="h-4 w-4 shrink-0 text-saffron" aria-hidden />
              <span className="flex-1">{state.notice ?? `Only ${state.results.length} ${state.results.length === 1 ? 'match' : 'matches'} inside ${locality}. ${state.nearby.length ? 'Nearby options are listed below.' : ''}`}</span>
              {state.localityExpansion && locality && state.results.length > 0 && (
                <button type="button" className="btn-accent px-3 py-1 text-xs" onClick={() => applyPrefs({ locality: null })}>
                  Search all of {meta.name}
                </button>
              )}
            </div>
          )}

          {state.error && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-ember/40 bg-ember/10 px-4 py-3 text-sm" role="alert">
              <span className="flex-1 text-sand">{state.error}</span>
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => applyPrefs({})}>
                Try again
              </button>
            </div>
          )}

          <div className="mt-6" aria-busy={state.loading}>
            {state.loading ? (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : state.results.length === 0 && locality ? (
              <div className="rounded-3xl border border-sand/10 bg-river/60 px-6 py-12 text-center">
                <h3 className="font-display text-3xl text-sand">No {wantedLabel} found inside {locality}</h3>
                <p className="mx-auto mt-2 max-w-lg text-sand-dim">
                  {state.provider?.is_live
                    ? `Google Places has nothing matching inside ${locality} right now.`
                    : `WanderGraph's curated list has no ${wantedLabel} in ${locality}. Add a Google Places key to search every place in ${locality}.`}{' '}
                  {state.nearby.length > 0 ? (nearbyHasDistances ? 'The closest ones are below.' : `Here are ${wantedLabel} elsewhere in ${meta.name}.`) : ''}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-accent" onClick={() => applyPrefs({ locality: null })}>
                    Search all of {meta.name}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => document.getElementById('nearby')?.scrollIntoView({ behavior: 'smooth' })} disabled={!state.nearby.length}>
                    See nearby
                  </button>
                </div>
              </div>
            ) : state.results.length === 0 ? (
              <div className="rounded-3xl border border-sand/10 bg-river/60 px-6 py-14 text-center">
                <h3 className="font-display text-3xl text-sand">Nothing fits all of that</h3>
                <p className="mx-auto mt-2 max-w-md text-sand-dim">Remove a constraint above, widen the budget, or try a different neighbourhood.</p>
                <button type="button" className="btn-accent mt-5" onClick={() => resetAll()}>
                  Show top places in {meta.name}
                </button>
              </div>
            ) : view === 'map' ? (
              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <MapView points={points} center={meta.center} area={state.area} onSelect={setDetailId} className="h-[560px]" ariaLabel={`Map of results in ${meta.name}`} />
                <ol className="max-h-[560px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {state.results.map((r, i) => (
                    <li key={r.place.id}>
                      <button type="button" onClick={() => setDetailId(r.place.id)} className="flex w-full items-start gap-3 rounded-xl border border-sand/10 bg-river p-3 text-left hover:border-accent/50">
                        <span className="font-display text-xl text-accent">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-sand">{r.place.name}</span>
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
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {state.results.map((r, i) => (
                  <PlaceCard key={r.place.id} rec={r} rank={i + 1} feature={i === 0} localityName={locality} onOpen={openRec} onGraph={openGraph} />
                ))}
              </div>
            )}
          </div>

          {!state.loading && locality && state.nearby.length > 0 && view === 'grid' && (
            <section id="nearby" className="mt-12 scroll-mt-24" aria-labelledby="nearby-h">
              <h2 id="nearby-h" className="font-display text-3xl text-sand">
                {nearbyHasDistances ? `Just outside ${locality}` : `Elsewhere in ${meta.name}`}
              </h2>
              <p className="mt-1 text-base text-sand-dim">
                {nearbyHasDistances ? `Not inside ${locality}; sorted by distance from its centre.` : `These ${wantedLabel} are not in ${locality}.`}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {state.nearby.map((r, i) => (
                  <PlaceCard key={r.place.id} rec={r} rank={i + 1} localityName={locality} onOpen={openRec} onGraph={openGraph} />
                ))}
              </div>
            </section>
          )}

          {state.nextPageToken && !state.loading && (
            <div className="mt-10 text-center">
              <button type="button" className="btn-ghost px-6 py-3" onClick={loadMore} disabled={state.loadingMore}>
                {state.loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {state.loadingMore ? 'Loading more' : 'Show more places'}
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Refine bar: follow-ups keep what's already set */}
      <form onSubmit={submitRefine} className="fixed inset-x-0 bottom-0 z-30 border-t border-sand/10 bg-ink/85 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <MessageSquarePlus className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          <label htmlFor="refine" className="sr-only">Refine these results</label>
          <input id="refine" value={refine} onChange={(e) => setRefine(e.target.value)} placeholder="Refine: make it quieter, for my parents, in the evening…" className="min-w-0 flex-1 bg-transparent py-2 text-sand placeholder:text-sand-faint focus:outline-none" />
          <button type="submit" className="btn-accent" disabled={!refine.trim() || state.loading}>
            Refine
          </button>
        </div>
      </form>

      <footer className="border-t border-sand/10 px-4 pb-28 pt-8 text-center text-sm text-sand-faint">
        <p>
          WanderGraph. Curated places are hand-compiled and not independently verified; live places come from Google Places. Always check hours and prices before you go.
        </p>
      </footer>

      <PlaceDrawer placeId={detailId} match={match} localityName={locality} city={city} onClose={() => setDetailId(null)} onOpen={setDetailId} onGraph={(id) => { setDetailId(null); openGraph(id); }} />
      <GraphOverlay open={graph.open} city={city} focus={graph.focus} onClose={() => setGraph({ open: false, focus: null })} onOpenPlace={openPlace}
        onFilterCategory={(g) => { setCategory(g); document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }); }} />
      <Planner open={plannerOpen} city={city} sessionId={sessionId} onClose={() => setPlannerOpen(false)} onOpenPlace={(id) => { setPlannerOpen(false); setDetailId(id); }} />
    </ElementContext.Provider>
  );
}
