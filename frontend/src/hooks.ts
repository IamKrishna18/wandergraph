import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { buildFit, km, processItinerary, processSearch, stripConstraint, toServerQuery } from './adapter';
import type { ChatMessage, CityId, GraphData, Interpretation, Itinerary, LocalityArea, Preferences, ProviderStatus, Recommendation } from './types';

/* ---------------- storage ---------------- */

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; preference just won't persist */
  }
}

/* ---------------- page effects ---------------- */

/** Fade sections in as they scroll into view. Content stays visible where IntersectionObserver is missing. */
export function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const root = document.documentElement;
    root.classList.add('reveal-on');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    const watch = () => document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      root.classList.remove('reveal-on');
    };
  }, []);
}

/** One pointer listener drives the spotlight on every `.spot` card. */
export function useSpotlight() {
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('.spot') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--x', `${e.clientX - r.left}px`);
      el.style.setProperty('--y', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
}

/** Current time in a city, refreshed every 30 seconds. */
export function useCityClock(timeZone: string): string {
  const fmt = () => {
    try {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date());
    } catch {
      return '';
    }
  };
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);
  return t;
}

const graphCache = new Map<string, Promise<GraphData>>();
/** The city's knowledge graph, fetched once per city and shared by the hero and the explorer. */
export function useCityGraph(city: CityId) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    let p = graphCache.get(city);
    if (!p) {
      p = api.graph(city);
      graphCache.set(city, p);
      p.catch(() => graphCache.delete(city));
    }
    p.then((g) => live && setData(g)).catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [city]);
  return { data, error };
}

/* ---------------- discovery (search) ---------------- */

function sessionId(): string {
  try {
    const existing = localStorage.getItem('wandergraph_session_id');
    if (existing) return existing;
    const id = 'wg-' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem('wandergraph_session_id', id);
    return id;
  } catch {
    return 'wg-' + Math.random().toString(36).slice(2, 11);
  }
}

export interface DiscoveryState {
  city: CityId;
  query: string;
  category: string | null;
  prefs: Preferences | null;
  results: Recommendation[];
  nearby: Recommendation[];
  area: LocalityArea | null;
  nextPageToken: string | null;
  interpretation: Interpretation | null;
  notice: string | null;
  localityExpansion: boolean;
  provider: ProviderStatus | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const BACKEND_INTEREST: Record<string, string> = {
  cafe: 'cafe', nightlife: 'bar_nightlife', food: 'restaurant', heritage: 'culture_history', nature: 'nature_outdoors', shopping: 'shopping',
};

export function useDiscovery(initialCity: CityId) {
  const sid = useRef(sessionId());
  const [state, setState] = useState<DiscoveryState>({
    city: readStored('wg-city', ['hyderabad', 'bengaluru', 'tokyo', 'kyoto'] as const, initialCity),
    query: '',
    category: null,
    prefs: null,
    results: [],
    nearby: [],
    area: null,
    nextPageToken: null,
    interpretation: null,
    notice: null,
    localityExpansion: false,
    provider: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  const latest = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const suppressed = useRef<string[]>([]);

  /** One search round-trip, with the client-side clean-up from adapter.ts. */
  const fetchResults = useCallback(async (opts: { query: string; city: CityId; category: string | null; prepare?: () => Promise<unknown> }) => {
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null, query: opts.query, category: opts.category }));
    try {
      if (opts.prepare) await opts.prepare();
      const serverQuery = toServerQuery(opts.query, opts.category);
      const limit = opts.category || opts.query ? 20 : 12;
      let raw = await api.search({ query: serverQuery, session_id: sid.current, city: opts.city, limit });
      // The API keeps the selected city even when the text names another one ("temples in kyoto"); follow the text.
      const named = raw.interpreted_criteria?.detected_city;
      if (named && named !== opts.city && ['hyderabad', 'bengaluru', 'tokyo', 'kyoto'].includes(named)) {
        raw = await api.search({ query: serverQuery, session_id: sid.current, city: named, limit });
      }
      if (id !== latest.current) return;
      const out = processSearch(raw, { query: opts.query, category: opts.category, suppressedInterests: suppressed.current });
      const loc = out.preferences.locality;
      if (loc && out.results.length < 3) {
        // Few or no places inside the area: look across the city once, show those separately, then restore the area.
        try {
          const q2 = stripConstraint(opts.query, 'locality', loc);
          const raw2 = await api.search({ query: toServerQuery(q2, opts.category), session_id: sid.current, city: out.preferences.city, limit: 20, locality: '' });
          await api.updatePreferences(sid.current, { direct_updates: { locality: loc } });
          const wide = processSearch(raw2, { query: q2, category: opts.category, suppressedInterests: suppressed.current });
          const shown = new Set([...out.results, ...out.nearby].map((r) => r.place.id));
          const extra = wide.results
            .filter((r) => !shown.has(r.place.id))
            .map((r) => {
              const d = out.area && r.place.coordinates ? Math.round(km(out.area, r.place.coordinates) * 100) / 100 : null;
              return {
                ...r,
                in_locality: false,
                distance_from_locality_km: d,
                match_confidence: 'potential' as const,
                fit: buildFit(r.place, out.preferences, r.matched_reasons, r.unverified_attributes, false, d),
              };
            });
          out.nearby = [...out.nearby, ...extra]
            .sort((a, b) => (a.distance_from_locality_km ?? 1e9) - (b.distance_from_locality_km ?? 1e9) || b.total_score - a.total_score)
            .slice(0, 6);
        } catch {
          /* the wider look is optional */
        }
        if (id !== latest.current) return;
      }
      store('wg-city', out.preferences.city);
      setState((s) => ({
        ...s,
        city: out.preferences.city,
        prefs: out.preferences,
        results: out.results,
        nearby: out.nearby,
        area: out.area,
        nextPageToken: raw.next_page_token ?? null,
        interpretation: out.interpretation,
        notice: out.notice,
        localityExpansion: !!out.preferences.locality && out.results.length < 3,
        provider: raw.provider_status,
        loading: false,
      }));
    } catch (e) {
      if (id !== latest.current) return;
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  const cur = () => stateRef.current;

  /** A fresh search from the search box: clears earlier filters (except the category button). */
  const search = useCallback((query: string, city?: CityId) => {
    suppressed.current = [];
    return fetchResults({ query, city: city ?? cur().city, category: cur().category, prepare: () => api.resetPreferences(sid.current) });
  }, [fetchResults]);

  /** A follow-up that keeps what's already set. */
  const refine = useCallback((text: string) => {
    const q = [cur().query, text].filter(Boolean).join(' ');
    return fetchResults({ query: q, city: cur().city, category: cur().category, prepare: () => api.updatePreferences(sid.current, { user_message: text }) });
  }, [fetchResults]);

  const setCategory = useCallback((category: string | null) => fetchResults({ query: cur().query, city: cur().city, category }), [fetchResults]);

  /** Remove (or change) constraints. Removed ones are deleted on the server and their words taken out of the query. */
  const applyPrefs = useCallback((patch: Partial<Preferences>, category?: string | null) => {
    const s = cur();
    const prev = s.prefs;
    let query = s.query;
    const steps: (() => Promise<unknown>)[] = [];
    for (const [key, value] of Object.entries(patch) as [keyof Preferences, any][]) {
      const old = prev ? (prev as any)[key] : null;
      if (key === 'interests') {
        const removed = ((old as string[]) ?? []).filter((g) => !(value as string[]).includes(g));
        removed.forEach((g) => {
          const k = g === 'spiritual' ? 'culture_history' : BACKEND_INTEREST[g];
          if (k) {
            suppressed.current = [...suppressed.current, k];
            query = stripConstraint(query, 'interests', k);
          }
        });
      } else if (key === 'atmosphere') {
        const removed = ((old as string[]) ?? []).filter((a) => !(value as string[]).includes(a));
        removed.forEach((a) => (query = stripConstraint(query, 'atmosphere', a)));
        steps.push(() => (value as string[]).length ? api.updatePreferences(sid.current, { direct_updates: { atmosphere: value } }) : api.removePreference(sid.current, 'atmosphere'));
      } else if (value === null || (Array.isArray(value) && value.length === 0)) {
        query = stripConstraint(query, key, old);
        steps.push(() => api.removePreference(sid.current, key));
      } else {
        steps.push(() => api.updatePreferences(sid.current, { direct_updates: { [key]: value } }));
      }
    }
    return fetchResults({
      query,
      city: s.city,
      category: category === undefined ? s.category : category || null,
      prepare: async () => {
        for (const step of steps) await step();
      },
    });
  }, [fetchResults]);

  const switchCity = useCallback((city: CityId) => {
    suppressed.current = [];
    return fetchResults({ query: '', city, category: null, prepare: () => api.resetPreferences(sid.current) });
  }, [fetchResults]);

  const resetAll = useCallback(() => {
    suppressed.current = [];
    return fetchResults({ query: '', city: cur().city, category: null, prepare: () => api.resetPreferences(sid.current) });
  }, [fetchResults]);

  const loadMore = useCallback(async () => {
    const s = cur();
    if (!s.nextPageToken || s.loadingMore || !s.prefs) return;
    const id = latest.current;
    setState((x) => ({ ...x, loadingMore: true }));
    try {
      const raw = await api.search({ query: toServerQuery(s.query, s.category), session_id: sid.current, city: s.city, limit: 20, page_token: s.nextPageToken });
      if (id !== latest.current) return;
      const out = processSearch(raw, { query: s.query, category: s.category, suppressedInterests: suppressed.current });
      setState((x) => {
        const seen = new Set([...x.results, ...x.nearby].map((r) => r.place.id));
        return {
          ...x,
          results: [...x.results, ...out.results.filter((r) => !seen.has(r.place.id))],
          nearby: [...x.nearby, ...out.nearby.filter((r) => !seen.has(r.place.id))].slice(0, 12),
          nextPageToken: raw.next_page_token ?? null,
          loadingMore: false,
        };
      });
    } catch (e) {
      setState((x) => ({ ...x, loadingMore: false, error: (e as Error).message }));
    }
  }, []);

  return { state, search, refine, setCategory, applyPrefs, switchCity, resetAll, loadMore, sessionId: sid.current };
}

/* ---------------- planner ---------------- */

export function usePlanner(sessionIdValue?: string) {
  const sid = useRef(sessionIdValue ?? sessionId());
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<'plan' | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const friendly = (e: unknown) => {
    const msg = (e as Error).message;
    return /No active itinerary/i.test(msg) ? 'The server no longer has this plan (it restarts from time to time). Ask for the plan again.' : msg;
  };

  const plan = useCallback(async (message: string, city: CityId) => {
    setBusy('plan');
    setError(null);
    setHistory((h) => [...h, { role: 'user', content: message }]);
    try {
      const res = processItinerary(await api.itineraryMessage(sid.current, message, city));
      setItinerary(res);
      setHistory(res.conversation_history);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const swap = useCallback(async (stopIndex: number, replacementId?: string, note?: string) => {
    setBusy(stopIndex);
    setError(null);
    try {
      const res = processItinerary(await api.replaceStop(sid.current, stopIndex, replacementId, note));
      setItinerary(res);
      setHistory(res.conversation_history);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const reset = useCallback(() => {
    api.resetItinerary(sid.current).catch(() => undefined);
    setItinerary(null);
    setHistory([]);
    setError(null);
  }, []);

  return { itinerary, history, busy, error, plan, swap, reset };
}

/* ---------------- misc ---------------- */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onEscape();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onEscape]);
}
