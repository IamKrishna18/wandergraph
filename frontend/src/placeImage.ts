/**
 * Picks a photo that actually shows the place.
 *
 * 1. A Google Places photo (live data) is always of the place itself.
 * 2. Otherwise, look the place up on Wikipedia and use the article's lead image,
 *    but only if the article is clearly about this place: its title must match
 *    the place's name and its text must mention the city.
 * 3. Otherwise, show no photo. The backend's category stock photos
 *    (the same picture for every monument, every cafe…) are never shown.
 */
import { useEffect, useState } from 'react';
import { photoUrl } from './api';

export interface RelevantPhoto {
  src: string;
  credit: string;
  href?: string;
  kind: 'google' | 'wikipedia';
}

export interface PhotoLike {
  name?: string;
  proxy_url?: string | null;
  attributions?: { display_name?: string; uri?: string | null }[];
}

const CITY_WORDS: Record<string, string[]> = {
  hyderabad: ['hyderabad', 'secunderabad', 'telangana'],
  bengaluru: ['bengaluru', 'bangalore', 'karnataka'],
  tokyo: ['tokyo'],
  kyoto: ['kyoto'],
};
const CITY_NAME: Record<string, string> = { hyderabad: 'Hyderabad', bengaluru: 'Bengaluru', tokyo: 'Tokyo', kyoto: 'Kyoto' };

/** Words that say what kind of place it is rather than which one. */
const GENERIC = new Set([
  'the', 'of', 'and', 'a', 'an', 'in', 'at', 'on', 'to', 's',
  'temple', 'shrine', 'park', 'garden', 'gardens', 'lake', 'museum', 'palace', 'fort', 'market', 'street', 'road',
  'restaurant', 'cafe', 'coffee', 'house', 'bar', 'pub', 'brewpub', 'hotel', 'centre', 'center', 'national', 'district',
  'original', 'city', 'old', 'new', 'tower', 'castle', 'hall', 'square', 'area', 'bazaar', 'mall', 'gallery', 'art', 'arts',
]);

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const words = (s: string) => norm(s).split(' ').filter(Boolean);
const distinctive = (s: string) => words(s).filter((w) => !GENERIC.has(w) && w.length > 1);

/** The part of a curated name that names the place: "Paradise Biryani (Original)" → "Paradise Biryani". */
export function coreName(name: string): string {
  return name.split('(')[0].split(/\s[&–-]\s|,/)[0].trim();
}

/** Photos the backend fills in by category; they don't show the place. */
export function isStockPhoto(p: PhotoLike | undefined | null): boolean {
  if (!p?.proxy_url) return true;
  const name = p.name ?? '';
  if (name.startsWith('mock_photos/') || name.startsWith('fallback:') || name.startsWith('stock:')) return true;
  return /images\.unsplash\.com/.test(p.proxy_url);
}

export function isGooglePhoto(p: PhotoLike | undefined | null): boolean {
  if (!p?.proxy_url) return false;
  return (p.name ?? '').startsWith('places/') || /\/places\/photo|googleusercontent\.com|maps\.googleapis\.com/.test(p.proxy_url);
}

interface WikiPage {
  title: string;
  index?: number;
  description?: string;
  extract?: string;
  pageimage?: string;
  thumbnail?: { source: string; width?: number; height?: number };
}

/** Does this Wikipedia article describe this place, in this city, with a real photo? */
export function wikiPageMatches(page: WikiPage, placeName: string, city: string): boolean {
  if (!page.thumbnail?.source) return false;
  const file = (page.pageimage ?? page.thumbnail.source).toLowerCase();
  // logos, maps, flags, diagrams and icons are not photos of the place
  if (/\.svg|logo|map|flag|locator|location|icon|seal|emblem|diagram|plan\b/.test(file)) return false;

  const cityWords = CITY_WORDS[city] ?? [city];
  const desc = norm(page.description ?? '');
  if (/disambiguation|topics referred to|may refer to/.test(desc)) return false;

  // "Birla Mandir, Delhi" is a different Birla Mandir
  const [base, qualifier] = page.title.replace(/\s*\(.*\)\s*$/, '').split(/,\s*/);
  if (qualifier && !cityWords.some((w) => norm(qualifier).includes(w))) return false;

  const notCity = (w: string) => !cityWords.includes(w);
  const want = distinctive(coreName(placeName)).filter(notCity);
  const title = distinctive(base).filter(notCity);
  if (!want.length) {
    // names like "Tokyo Tower" or "Bangalore Palace": only the article with exactly that name will do
    if (norm(base) !== norm(coreName(placeName))) return false;
  } else {
    if (!title.length) return false;
    const shared = want.filter((w) => title.includes(w)).length;
    // the article's name has to be about this place: most of its distinctive words appear in the place's name
    if (shared === 0 || shared / title.length < 0.5 || shared / want.length < 0.5) return false;
  }

  const text = norm(`${page.title} ${page.description ?? ''} ${page.extract ?? ''}`);
  return cityWords.some((w) => text.includes(w));
}

export function pickWikiPhoto(pages: WikiPage[], placeName: string, city: string): RelevantPhoto | null {
  const hit = [...pages].sort((a, b) => (a.index ?? 99) - (b.index ?? 99)).find((p) => wikiPageMatches(p, placeName, city));
  if (!hit) return null;
  return {
    src: hit.thumbnail!.source,
    credit: `Wikimedia Commons, via the Wikipedia article “${hit.title}”`,
    href: hit.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(hit.pageimage)}` : `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    kind: 'wikipedia',
  };
}

const memory = new Map<string, Promise<RelevantPhoto | null>>();
const STORE = 'wg-wiki-photos-v1';
const WEEK = 7 * 24 * 3600 * 1000;

function readStore(): Record<string, { t: number; v: RelevantPhoto | null }> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function writeStore(key: string, v: RelevantPhoto | null) {
  try {
    const all = readStore();
    all[key] = { t: Date.now(), v };
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage full or blocked: the in-memory cache still works */
  }
}

async function queryWikipedia(search: string): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    redirects: '1',
    generator: 'search',
    gsrsearch: search,
    gsrlimit: '5',
    prop: 'pageimages|description|extracts',
    piprop: 'thumbnail|name',
    pithumbsize: '900',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '5',
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const data = await res.json();
  const pages = data?.query?.pages ?? [];
  return Array.isArray(pages) ? pages : Object.values(pages);
}

/** A Wikipedia photo of this exact place, or null. Cached for a week. */
export function findWikiPhoto(placeName: string, city: string): Promise<RelevantPhoto | null> {
  const key = `${city}|${norm(placeName)}`;
  let p = memory.get(key);
  if (p) return p;
  const stored = readStore()[key];
  if (stored && Date.now() - stored.t < WEEK) {
    p = Promise.resolve(stored.v);
    memory.set(key, p);
    return p;
  }
  p = (async () => {
    const core = coreName(placeName);
    const full = placeName.split('(')[0].trim();
    const cityName = CITY_NAME[city] ?? city;
    const searches = [...new Set([`${full} ${cityName}`, `${core} ${cityName}`, core])];
    for (const s of searches) {
      const hit = pickWikiPhoto(await queryWikipedia(s), placeName, city);
      if (hit) return hit;
    }
    return null;
  })()
    .then((v) => {
      writeStore(key, v);
      return v;
    })
    .catch(() => {
      // network trouble: try again next time rather than remembering "no photo"
      memory.delete(key);
      return null;
    });
  memory.set(key, p);
  return p;
}

/** Best photo for a place: Google's own, a matching Wikipedia photo, or nothing. */
export async function resolvePlacePhoto(place: { name: string; city: string; photos?: PhotoLike[] }): Promise<RelevantPhoto | null> {
  const google = place.photos?.find(isGooglePhoto);
  if (google) {
    const a = google.attributions?.[0];
    return { src: photoUrl(google.proxy_url)!, credit: a?.display_name ? `${a.display_name} on Google Maps` : 'Google Maps', href: a?.uri ?? undefined, kind: 'google' };
  }
  return findWikiPhoto(place.name, place.city);
}

/** React hook form of resolvePlacePhoto. `undefined` while looking, `null` when there is no matching photo. */
export function useRelevantPhoto(place: { name: string; city: string; photos?: PhotoLike[] } | null | undefined): RelevantPhoto | null | undefined {
  const google = place?.photos?.find(isGooglePhoto);
  const key = place ? `${place.city}|${place.name}|${google?.proxy_url ?? ''}` : '';
  const [state, setState] = useState<{ key: string; v: RelevantPhoto | null | undefined }>({ key: '', v: undefined });
  useEffect(() => {
    if (!place) return;
    let live = true;
    void resolvePlacePhoto(place).then((v) => live && setState({ key, v }));
    return () => {
      live = false;
    };
    // key captures everything that matters about place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.v : undefined;
}
