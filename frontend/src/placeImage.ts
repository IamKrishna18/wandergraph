/**
 * Picks a photo that actually shows the place, best source first:
 *
 * 1. Google Places photos already attached to a live result.
 * 2. Google Places, looked up by name and position through the backend
 *    (so curated places get Google photos too; the key stays on the server).
 * 3. Wikipedia: the article's lead image, only if the article is clearly about
 *    this place (its title matches the name and its text mentions the city).
 * 4. Wikimedia Commons: photos geotagged within a few hundred metres whose file
 *    name mentions the place.
 * 5. Otherwise no photo. The backend's category stock photos
 *    (the same picture for every monument, every cafe…) are never shown.
 */
import { useEffect, useState } from 'react';
import { api, photoUrl } from './api';

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
    const common = want.filter((w) => title.includes(w));
    const shared = common.length;
    // the article's name has to be about this place: most of its distinctive words appear in the place's name,
    // and it covers most of ours, or shares a long, telling word ("ISKCON Hyderabad" for a long temple name)
    const telling = common.some((w) => w.length >= 5);
    if (shared === 0 || shared / title.length < 0.5 || (shared / want.length < 0.5 && !telling)) return false;
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
const STORE = 'wg-wiki-photos-v2';
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

function fromGoogle(p: PhotoLike): RelevantPhoto {
  const a = p.attributions?.[0];
  return { src: photoUrl(p.proxy_url)!, credit: a?.display_name ? `${a.display_name} on Google Maps` : 'Google Maps', href: a?.uri ?? undefined, kind: 'google' };
}

const googleMemory = new Map<string, Promise<RelevantPhoto | null>>();
/** Ask the backend to find the place on Google and return its photo. */
export function findGooglePhoto(name: string, city: string, coords?: { latitude: number; longitude: number } | null): Promise<RelevantPhoto | null> {
  const key = `${city}|${norm(name)}`;
  let p = googleMemory.get(key);
  if (!p) {
    p = api
      .photoLookup(name, city, coords?.latitude, coords?.longitude)
      .then((r) => {
        const g = r.photos?.find(isGooglePhoto);
        return g ? fromGoogle(g) : null;
      })
      .catch(() => {
        googleMemory.delete(key);
        return null;
      });
    googleMemory.set(key, p);
  }
  return p;
}

interface CommonsPage {
  title: string;
  index?: number;
  imageinfo?: { thumburl?: string; url?: string; mime?: string; descriptionurl?: string }[];
  coordinates?: { dist?: number }[];
}

/** A geotagged Commons photo near the place whose file name names the place. */
export function pickCommonsPhoto(pages: CommonsPage[], placeName: string, city: string): RelevantPhoto | null {
  const cityWords = CITY_WORDS[city] ?? [city];
  const want = distinctive(coreName(placeName)).filter((w) => !cityWords.includes(w));
  if (!want.length) return null;
  const sorted = [...pages].sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  for (const pg of sorted) {
    const info = pg.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;
    const file = pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    if (/logo|map|flag|locator|icon|seal|emblem|diagram|plan\b/i.test(file)) continue;
    const have = distinctive(file);
    const common = want.filter((w) => have.includes(w));
    const dist = pg.coordinates?.[0]?.dist ?? Infinity;
    // most of the name in the file name, or one long telling word for a photo taken right there
    const ok = common.length / want.length >= 0.5 || (common.some((w) => w.length >= 5) && dist <= 150);
    if (ok) return { src: info.thumburl, credit: 'Wikimedia Commons', href: info.descriptionurl, kind: 'wikipedia' };
  }
  return null;
}

async function findCommonsPhoto(placeName: string, city: string, coords: { latitude: number; longitude: number }): Promise<RelevantPhoto | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${coords.latitude}|${coords.longitude}`,
    ggsradius: '400',
    ggsnamespace: '6',
    ggslimit: '50',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|mime',
    iiurlwidth: '900',
    codistancefrompoint: `${coords.latitude}|${coords.longitude}`,
    colimit: '50',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const data = await res.json();
  return pickCommonsPhoto(data?.query?.pages ?? [], placeName, city);
}

/** Wikipedia first, then geotagged Commons photos. Cached for a week. */
export function findWikiPhoto(placeName: string, city: string, coords?: { latitude: number; longitude: number } | null): Promise<RelevantPhoto | null> {
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
    const lead = distinctive(core).sort((a, b) => b.length - a.length)[0];
    for (const s of [...new Set([`${full} ${cityName}`, `${core} ${cityName}`, core, ...(lead ? [`${lead} ${cityName}`] : [])])]) {
      const hit = pickWikiPhoto(await queryWikipedia(s), placeName, city);
      if (hit) return hit;
    }
    if (coords) return findCommonsPhoto(placeName, city, coords);
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

export interface PlaceForPhoto {
  name: string;
  city: string;
  photos?: PhotoLike[];
  coordinates?: { latitude: number; longitude: number } | null;
  /** the exact Wikipedia article, when the map data names it ("en:Charminar") */
  wikipedia?: string | null;
}

/** A photo tagged on the OpenStreetMap object itself, so it shows this exact place. */
export function isTaggedPhoto(p: PhotoLike | undefined | null): boolean {
  return Boolean(p?.proxy_url && (p.name ?? '').startsWith('osm-photo:'));
}

const articleMemory = new Map<string, Promise<RelevantPhoto | null>>();
/** Lead image of a named Wikipedia article ("en:Charminar"); the map data already says it is this place. */
export function findArticlePhoto(tag: string): Promise<RelevantPhoto | null> {
  let p = articleMemory.get(tag);
  if (!p) {
    const m = /^([a-z-]{2,12}):(.+)$/.exec(tag.trim());
    const lang = m ? m[1] : 'en';
    const title = (m ? m[2] : tag).trim().replace(/ /g, '_');
    p = fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // a 900px thumbnail when the original is big enough, otherwise the original itself
        const orig = d?.originalimage;
        const src = orig?.width && orig.width <= 1400 ? orig.source : d?.thumbnail?.source?.replace(/\/\d+px-/, '/900px-');
        if (!src || /\.svg/i.test(src)) return null;
        return { src, credit: `Wikimedia Commons, via the Wikipedia article “${d.title ?? title}”`, href: d?.content_urls?.desktop?.page, kind: 'wikipedia' as const };
      })
      .catch(() => {
        articleMemory.delete(tag);
        return null;
      });
    articleMemory.set(tag, p);
  }
  return p;
}

/** Best photo for a place: Google (attached or looked up), then Wikipedia / Commons, or nothing. */
export async function resolvePlacePhoto(place: PlaceForPhoto, opts: { skipGoogle?: boolean; noLookup?: boolean } = {}): Promise<RelevantPhoto | null> {
  // a photo tagged on the map object itself is of this exact place
  const tagged = place.photos?.find(isTaggedPhoto);
  if (tagged) return { src: tagged.proxy_url!, credit: 'Wikimedia Commons (tagged on OpenStreetMap)', href: tagged.attributions?.[0]?.uri ?? undefined, kind: 'wikipedia' };
  if (!opts.skipGoogle) {
    const attached = place.photos?.find(isGooglePhoto);
    if (attached) return fromGoogle(attached);
    // each lookup is a paid Google search, so bulk previews (the graph) skip it
    const looked = opts.noLookup ? null : await findGooglePhoto(place.name, place.city, place.coordinates);
    if (looked) return looked;
  }
  if (place.wikipedia) {
    const article = await findArticlePhoto(place.wikipedia);
    if (article) return article;
  }
  return findWikiPhoto(place.name, place.city, place.coordinates);
}

/**
 * React hook form of resolvePlacePhoto. The photo is `undefined` while looking and `null` when there is none.
 * Call `broken()` when the image fails to load: a failed Google photo falls back to Wikipedia / Commons.
 */
export function useRelevantPhoto(place: PlaceForPhoto | null | undefined): [RelevantPhoto | null | undefined, () => void] {
  const google = place?.photos?.find(isGooglePhoto);
  const [failed, setFailed] = useState<'none' | 'google' | 'all'>('none');
  const base = place ? `${place.city}|${place.name}|${google?.proxy_url ?? ''}|${place.photos?.find(isTaggedPhoto)?.proxy_url ?? ''}|${place.wikipedia ?? ''}` : '';
  const key = `${base}|${failed}`;
  const [state, setState] = useState<{ key: string; v: RelevantPhoto | null | undefined }>({ key: '', v: undefined });
  useEffect(() => setFailed('none'), [base]);
  useEffect(() => {
    if (!place) return;
    if (failed === 'all') {
      setState({ key, v: null });
      return;
    }
    let live = true;
    void resolvePlacePhoto(place, { skipGoogle: failed === 'google' }).then((v) => live && setState({ key, v }));
    return () => {
      live = false;
    };
    // key captures everything that matters about place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const photo = state.key === key ? state.v : undefined;
  const broken = () => setFailed(photo?.kind === 'google' ? 'google' : 'all');
  // (a tagged OpenStreetMap photo that fails to load simply leaves the placeholder)
  return [photo, broken];
}
