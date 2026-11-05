/**
 * Turns raw backend responses into what the UI shows, and fixes on the client
 * side what the API leaves loose:
 *
 * - location searches keep only places whose address is in the named area;
 *   the rest are shown separately as "elsewhere", sorted by distance;
 * - a named type of place ("parks") is required, after checking the word was
 *   really in the query (so "banjara" isn't read as "bar");
 * - every result gets a per-constraint fit checklist;
 * - curated data is labelled as curated, not "verified"; landmark fees that
 *   leaked onto restaurants are dropped; "open now" is only shown for live data;
 * - itinerary stops are checked against their listed hours and real distances.
 */
import type { RawInterpretation, RawItinerary, RawPlace, RawPreferences, RawRecommendation, RawSearchResponse } from './api';
import type { CityId, FitItem, Interpretation, Itinerary, ItineraryStop, LocalityArea, Place, PlacePhoto, Preferences, PriceEstimate, Reason, Recommendation } from './types';

/* ---------------- text ---------------- */

export function normalize(text: string): string {
  return (text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
export const tokenize = (text: string) => normalize(text).match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [];
const singular = (t: string) => (t.length > 4 && t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

/** Whole-word phrase match (plural allowed on the last word). */
export function hasPhrase(text: string, phrase: string): boolean {
  const w = tokenize(text);
  const t = tokenize(phrase);
  if (!t.length) return false;
  for (let i = 0; i + t.length <= w.length; i++) {
    let ok = true;
    for (let j = 0; j < t.length - 1; j++) if (w[i + j] !== t[j]) ok = false;
    const a = w[i + t.length - 1];
    const b = t[t.length - 1];
    if (ok && (a === b || singular(a) === singular(b))) return true;
  }
  return false;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] !== b[j] ? 1 : 0)));
    prev = cur;
  }
  return prev[b.length];
}

/* ---------------- vocabulary of the backend's query parser ---------------- */

/** Words the backend's parser reacts to, per preference. Used to (a) verify a
 *  detected category really was asked for and (b) strip a removed constraint's
 *  words from the query so the backend doesn't add it straight back. */
export const PARSER_WORDS = {
  interests: {
    cafe: ['coffee', 'cafe', 'cafes', 'espresso', 'latte', 'cappuccino', 'bakery', 'tea house'],
    bar_nightlife: ['beer', 'pub', 'bar', 'brewery', 'craft beer', 'cocktails', 'nightlife', 'club'],
    restaurant: ['dinner', 'lunch', 'food', 'eat', 'restaurant', 'dining', 'cuisine', 'breakfast', 'biryani', 'ramen', 'sushi'],
    culture_history: ['monument', 'temple', 'shrine', 'historic', 'heritage', 'museum', 'culture', 'sightseeing', 'palace', 'fort', 'castle'],
    nature_outdoors: ['park', 'garden', 'lake', 'nature', 'walk', 'greenery', 'outdoors', 'outdoor', 'bamboo', 'hills'],
    shopping: ['shopping', 'market', 'bazaar', 'mall', 'souvenir', 'crafts', 'textiles'],
  } as Record<string, string[]>,
  atmosphere: {
    peaceful: ['peaceful', 'quiet', 'calm', 'serene', 'tranquil', 'not too crowded', 'peace', 'relaxing', 'zen'],
    romantic: ['romantic', 'intimate', 'candlelight', 'cozy', 'date', 'sunset view'],
    lively: ['lively', 'vibrant', 'energetic', 'buzzing', 'busy', 'crowded', 'happening'],
    scenic: ['scenic', 'view', 'panoramic', 'skyline', 'lake view', 'landscape', 'vista'],
    spiritual: ['spiritual', 'sacred', 'holy', 'devotional', 'temple', 'shrine'],
    cultural: ['cultural', 'traditional', 'ancient', 'historical', 'heritage'],
    adventurous: ['adventurous', 'thrill', 'hiking', 'trekking', 'adventure'],
  } as Record<string, string[]>,
  companion_type: ['girlfriend', 'boyfriend', 'partner', 'wife', 'husband', 'couples', 'couple', 'date', 'romantic', 'family', 'parents', 'kids', 'children', 'relatives', 'friends', 'buddies', 'gang', 'group', 'colleagues', 'solo', 'alone', 'myself', 'single', 'business'],
  preferred_time: ['late night', 'morning', 'sunrise', 'afternoon', 'lunch', 'evening', 'sunset', 'night'],
  indoor_outdoor: ['open air', 'outdoor', 'outside', 'alfresco', 'indoor', 'inside'],
  accessibility_requirements: ['wheelchair', 'accessible'],
};

/** Backend interest key → UI category group */
const INTEREST_TO_GROUP: Record<string, string> = {
  cafe: 'cafe',
  bar_nightlife: 'nightlife',
  restaurant: 'food',
  culture_history: 'heritage',
  nature_outdoors: 'nature',
  shopping: 'shopping',
};

/** Words added to the query when a category filter is on (work for both Google and curated search). */
export const CATEGORY_QUERY: Record<string, string> = {
  heritage: 'historical monument',
  spiritual: 'temple shrine',
  nature: 'park garden',
  food: 'restaurant',
  cafe: 'cafe',
  nightlife: 'bar pub',
  shopping: 'market shopping',
  fun: 'amusement',
};

const PLURALS: Record<string, string> = {
  temples: 'temple', parks: 'park', cafes: 'cafe', museums: 'museum', gardens: 'garden', shrines: 'shrine', monuments: 'monument',
  palaces: 'palace', forts: 'fort', markets: 'market', restaurants: 'restaurant', lakes: 'lake', bars: 'bar', pubs: 'pub',
  breweries: 'brewery', bakeries: 'bakery', malls: 'mall', bazaars: 'bazaar', castles: 'castle', galleries: 'gallery',
  beaches: 'beach', viewpoints: 'viewpoint', tombs: 'tomb', mosques: 'mosque', churches: 'church', zoos: 'zoo',
};

/** The text sent to the API: place nouns in the singular (the curated search matches "temple" but not "temples"),
 *  plus the active category's words. */
export function toServerQuery(query: string, category: string | null): string {
  const q = query.replace(/\b[a-z]+\b/gi, (w) => PLURALS[w.toLowerCase()] ?? w);
  return [q, category ? CATEGORY_QUERY[category] : ''].filter(Boolean).join(' ').trim() || 'popular places';
}

/** Remove the words that made the backend add a constraint. */
export function stripConstraint(query: string, field: string, value?: string | number | null): string {
  let q = ` ${normalize(query)} `;
  const drop = (words: string[]) => {
    for (const w of [...words].sort((a, b) => b.length - a.length)) q = q.replace(new RegExp(`\\b${esc(w)}s?\\b`, 'g'), ' ');
  };
  if (field === 'atmosphere' && typeof value === 'string') drop(PARSER_WORDS.atmosphere[value] ?? [value]);
  else if (field === 'interests' && typeof value === 'string') drop(PARSER_WORDS.interests[value] ?? []);
  else if (field === 'locality' && typeof value === 'string') drop([normalize(value)]);
  else if (field === 'budget_max') {
    q = q.replace(/(?:under|below|within|budget of|<|less than)\s*[₹¥$]?\s*[0-9]+(?:,[0-9]+)*(?:\s*(?:for two|for 2))?/g, ' ');
    drop(['free', 'zero cost']);
  } else if (field in PARSER_WORDS) drop((PARSER_WORDS as any)[field] as string[]);
  // tidy up words left dangling by the removal ("parks in" → "parks"), but keep "with my family"
  q = q.replace(/\b(in|with|for|near|around)\s+(?=\b(in|with|for|near|around|and)\b|\s*$)/g, ' ');
  q = q.replace(/\b(my|the|a)\s+(?=\b(in|with|for|near|around|and)\b|\s*$)/g, ' ');
  return q.replace(/\s+/g, ' ').trim().replace(/^(in|with|for|near|and)\s+/, '').replace(/\s+(in|with|for|near|and)$/, '');
}

/* ---------------- categories ---------------- */

const SEED_GROUPS: Record<string, string[]> = {
  historical_monument: ['heritage'],
  museum: ['heritage'],
  cultural_center: ['heritage'],
  religious_site: ['spiritual'],
  park_nature: ['nature'],
  scenic_spot: ['nature'],
  market_shopping: ['shopping'],
  entertainment: ['fun'],
};
const TYPE_GROUPS: [string, string[]][] = [
  ['heritage', ['historical_landmark', 'historical_place', 'monument', 'museum', 'art_gallery', 'cultural_landmark', 'castle', 'science_museum', 'cultural_center']],
  ['spiritual', ['place_of_worship', 'hindu_temple', 'buddhist_temple', 'shinto_shrine', 'mosque', 'church', 'synagogue']],
  ['nature', ['park', 'national_park', 'botanical_garden', 'garden', 'hiking_area', 'zoo', 'beach', 'observation_deck', 'state_park', 'wildlife_park', 'lake']],
  ['food', ['restaurant', 'meal_takeaway', 'meal_delivery', 'food_court', 'market']],
  ['cafe', ['cafe', 'coffee_shop', 'bakery', 'tea_house', 'cat_cafe', 'dessert_shop']],
  ['nightlife', ['bar', 'pub', 'night_club', 'wine_bar', 'brewery', 'cocktail_bar', 'lounge_bar']],
  ['shopping', ['shopping_mall', 'market', 'store', 'clothing_store', 'book_store', 'department_store', 'gift_shop']],
  ['fun', ['amusement_park', 'amusement_center', 'aquarium', 'movie_theater', 'video_arcade', 'bowling_alley', 'water_park']],
];

/** Graph category node ("category:park_nature") → UI category group, if there is one. */
export function groupForCategoryNode(nodeId: string): string | null {
  const key = nodeId.replace(/^category:/, '');
  if (SEED_GROUPS[key]) return SEED_GROUPS[key][0];
  if (TYPE_GROUPS.some(([g]) => g === key)) return key;
  const hit = TYPE_GROUPS.find(([, list]) => list.includes(key));
  return hit ? hit[0] : key === 'food_drink' ? 'food' : null;
}

export function classify(types: string[], primaryType?: string | null): string[] {
  const t = new Set([...(types || []), primaryType || ''].map((x) => x.toLowerCase()).filter(Boolean));
  const out = new Set<string>();
  t.forEach((x) => (SEED_GROUPS[x] ?? []).forEach((g) => out.add(g)));
  for (const [g, list] of TYPE_GROUPS) if (list.some((x) => t.has(x))) out.add(g);
  if ([...t].some((x) => x.endsWith('_restaurant'))) out.add('food');
  if (t.has('food_drink') && !['food', 'cafe', 'nightlife'].some((g) => out.has(g))) out.add('food');
  return TYPE_GROUPS.map(([g]) => g).filter((g) => out.has(g));
}

/* ---------------- places ---------------- */

const SYMBOL: Record<string, string> = { INR: '₹', JPY: '¥' };
const PRICE_RANGES: Record<string, [number, number][]> = {
  INR: [[0, 0], [200, 500], [500, 1200], [1200, 2500], [2500, 5000]],
  JPY: [[0, 0], [800, 1800], [1800, 4000], [4000, 9000], [9000, 20000]],
};
export const currencyFor = (city: string) => (city === 'tokyo' || city === 'kyoto' ? 'JPY' : 'INR');
const money = (n: number, cur: string) => `${SYMBOL[cur] ?? ''}${Math.round(n).toLocaleString('en-IN')}`;
const COMMERCIAL = new Set(['food', 'cafe', 'nightlife', 'shopping']);

function priceFromLevel(level: number | null | undefined, currency: string): PriceEstimate {
  if (level == null || level < 0 || level > 4) {
    return { spending_range_text: 'Price not listed', admission_text: 'No price information', currency, estimate_type: 'unknown', min_spend: null, max_spend: null, is_free: false, methodology_note: 'No price was returned for this place. Check on-site.' };
  }
  const [lo, hi] = PRICE_RANGES[currency][level];
  return {
    spending_range_text: level === 0 ? 'Free' : level === 4 ? `${money(lo, currency)}+ per person` : `${money(lo, currency)} – ${money(hi, currency)} per person`,
    admission_text: `Price level ${level}/4`, currency, estimate_type: 'estimated_by_price_level', min_spend: lo, max_spend: hi, is_free: level === 0,
    methodology_note: `Estimated from the price level ${level}/4 mapped to typical ${currency} spend.`,
  };
}

/** Make the price honest: right currency, no landmark fee on a restaurant, curated ≠ verified. */
/** Live data comes from Google ("gplaces:…") or OpenStreetMap ("osm:…"); everything else is curated. */
export const isGoogleId = (id: string) => id.startsWith('gplaces:');
export const isOsmId = (id: string) => id.startsWith('osm:');
export const isLiveId = (id: string) => isGoogleId(id) || isOsmId(id);

export function cleanPrice(raw: RawPlace, city: string, groups: string[]): PriceEstimate | null {
  const currency = currencyFor(city);
  const pe = raw.price_estimate;
  if (!pe) return priceFromLevel(raw.price_level, currency);
  const isLandmarkFee = /landmark admission fee/i.test(pe.methodology_note);
  if ((isLandmarkFee && groups.some((g) => COMMERCIAL.has(g))) || pe.currency !== currency) return priceFromLevel(raw.price_level, currency);
  const curated = !isLiveId(raw.id);
  if (pe.estimate_type === 'verified') {
    return {
      ...pe,
      estimate_type: isLandmarkFee ? 'listed_fee' : 'curated',
      methodology_note: isLandmarkFee
        ? 'Admission fee from WanderGraph’s landmark list. Confirm on the official site before visiting.'
        : curated
          ? 'Average spend hand-compiled in WanderGraph’s curated data; not independently verified.'
          : pe.methodology_note,
    };
  }
  if (pe.estimate_type === 'estimated_by_price_level' && pe.is_free && !raw.price_level) {
    return { ...pe, estimate_type: 'typically_free', is_free: false, spending_range_text: 'Usually free', methodology_note: 'Parks and places of worship are usually free. Not confirmed.' };
  }
  return pe as PriceEstimate;
}

function photoSource(name: string): PlacePhoto['source'] {
  if (name.startsWith('places/')) return 'google';
  if (name.startsWith('wiki:')) return 'wikipedia';
  if (name.startsWith('fallback:') || name.startsWith('mock_photos')) return 'stock';
  return 'unknown';
}

export function toPlace(raw: RawPlace, cityHint?: string): Place {
  const google = isGoogleId(raw.id);
  const osm = isOsmId(raw.id);
  const live = google || osm;
  const city = (raw.city || cityHint || 'hyderabad') as CityId;
  const groups = classify(raw.types, raw.primary_type);
  return {
    id: raw.id,
    name: raw.name,
    city,
    // The API stamps Google results with the searched locality, so for those we only trust the address.
    // OpenStreetMap areas come from the map itself (or measured distance to the area's centre).
    locality: google ? null : raw.locality ?? null,
    formatted_address: raw.formatted_address ?? null,
    coordinates: raw.coordinates ?? null,
    primary_type: raw.primary_type ?? null,
    types: raw.types ?? [],
    groups,
    rating: raw.rating ?? null,
    user_ratings_total: raw.user_ratings_total ?? null,
    price_level: raw.price_level ?? null,
    currency: currencyFor(city),
    price_estimate: cleanPrice(raw, city, groups),
    opening_hours_text: raw.opening_hours_text ?? null,
    is_open_now: live ? raw.is_open_now ?? null : null,
    accessibility: { wheelchair_accessible_entrance: null, source: 'unknown' },
    photos: (raw.photos ?? []).map((p) => ({ name: p.name, proxy_url: p.proxy_url, source: photoSource(p.name), attributions: p.attributions ?? [] })),
    provenance: google
      ? { source: 'Google Places API (New)', verification_status: 'source_returned' }
      : osm
        ? { source: 'OpenStreetMap contributors', verification_status: 'source_returned', wikipedia: raw.provenance?.wikipedia ?? null, osm_id: raw.provenance?.osm_id ?? null }
        : { source: 'WanderGraph curated seed dataset', verification_status: 'curated' },
    website_uri: raw.website_uri ?? null,
    national_phone_number: raw.national_phone_number ?? null,
    editorial_summary: google ? raw.editorial_summary ?? null : null, // curated summaries are generated, not real
    maps_uri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${raw.name} ${cap(city)}`)}`,
  };
}

/* ---------------- preferences & interpretation ---------------- */

/**
 * Interests the backend detected that are really in the query as whole words.
 * The area name is masked first, so "Banjara Hills" does not read as a nature search.
 */
export function verifiedInterests(rawInterests: string[], query: string, locality?: string | null): string[] {
  let q = normalize(query);
  if (locality) q = q.replace(new RegExp(`\\b${esc(normalize(locality))}\\b`, 'g'), ' ');
  return rawInterests.filter((k) => (PARSER_WORDS.interests[k] ?? []).some((w) => hasPhrase(q, w)));
}

export function toPreferences(raw: RawPreferences, query: string, category: string | null, suppressed: string[] = []): Preferences {
  const interests = verifiedInterests(raw.interests ?? [], query, raw.locality)
    .filter((k) => !suppressed.includes(k))
    .flatMap((k) => {
      // "temples" asks for places of worship, which the data files under heritage or temples & shrines
      if (k === 'culture_history' && ['temple', 'shrine'].some((w) => hasPhrase(query, w))) return ['spiritual', 'heritage'];
      return [INTEREST_TO_GROUP[k]];
    })
    .filter(Boolean);
  return {
    city: (raw.city || 'hyderabad') as CityId,
    locality: raw.locality ?? null,
    category,
    budget_max: raw.budget_max ?? null,
    currency: currencyFor(raw.city),
    companion_type: (raw.companion_type as Preferences['companion_type']) ?? null,
    interests: [...new Set(interests)],
    desired_activities: [],
    atmosphere: raw.atmosphere ?? [],
    indoor_outdoor: (raw.indoor_outdoor as Preferences['indoor_outdoor']) ?? null,
    preferred_time: (raw.preferred_time as Preferences['preferred_time']) ?? null,
    accessibility_requirements: raw.accessibility_requirements ?? [],
    crowd_preference: null,
    search_query: query || null,
  };
}

/** The backend says "was corrected" but not what; find the typo in the query. */
export function toInterpretation(raw: RawInterpretation | null | undefined, query: string): Interpretation | null {
  if (!raw) return null;
  const corrections: { from: string; to: string }[] = [];
  const tokens = tokenize(query);
  const fix = (target: string) => {
    const t = normalize(target);
    if (!t || hasPhrase(query, target)) return;
    const n = t.split(' ').length;
    let best: string | null = null;
    let bestD = 99;
    for (let i = 0; i + n <= tokens.length; i++) {
      const cand = tokens.slice(i, i + n).join(' ');
      const d = levenshtein(cand, t);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    if (best && bestD <= Math.max(2, Math.floor(t.length / 3))) corrections.push({ from: best, to: target.replace(/\b\w/g, (c) => c.toUpperCase()) });
  };
  if (raw.detected_city) fix(raw.detected_city);
  if (raw.detected_locality) fix(raw.detected_locality);
  return {
    original_query: raw.original_query ?? query,
    corrected_query: null,
    corrections,
    detected_city: raw.detected_city ?? null,
    detected_locality: raw.detected_locality ?? null,
    detected_categories: [],
    detected_atmospheres: raw.detected_atmospheres ?? [],
    detected_companion: raw.detected_companion ?? null,
    detected_budget: raw.detected_budget ?? null,
    was_corrected: corrections.length > 0,
  };
}

/* ---------------- distance ---------------- */

export function km(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 6371;
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function inLocality(p: Place, locality: string): boolean {
  return [p.locality, p.formatted_address, p.name].some((f) => !!f && hasPhrase(f, locality));
}

/* ---------------- recommendations ---------------- */

const REASON_RULES: [RegExp, (m: RegExpMatchArray, cur: string) => string][] = [
  [/^Located directly in (.+)$/, (m) => `In ${m[1]}`],
  [/^Within budget \((?:INR|JPY) ([\d,]+)\)$/, (m, cur) => `Fits your budget (from ${SYMBOL[cur]}${m[1]})`],
  [/^Ideal for (.+)$/, (m) => `Good for ${m[1]}`],
  [/^(.+) atmosphere$/, (m) => `${m[1]} vibe`],
  [/^Great for (.+) visits$/, (m) => `Best in the ${m[1]}`],
  [/^Matches (.+) setting$/, (m) => `${cap(m[1])} setting`],
  [/^Free admission \/ no-cost entry$/, () => 'Free entry'],
  [/^Wheelchair accessible entrance verified$/, () => 'Wheelchair-accessible entrance'],
];

function cleanReason(text: string, cur: string): string {
  for (const [re, fn] of REASON_RULES) {
    const m = text.match(re);
    if (m) return fn(m, cur);
  }
  return text;
}

const GROUP_LABEL: Record<string, string> = {
  heritage: 'Heritage', spiritual: 'Temples & Shrines', nature: 'Nature & Views', food: 'Food', cafe: 'Cafes',
  nightlife: 'Nightlife', shopping: 'Markets & Shopping', fun: 'Fun & Experiences',
};

export function buildFit(p: Place, prefs: Preferences, reasons: string[], unverified: string[], inside: boolean | null, distance: number | null): FitItem[] {
  const fit: FitItem[] = [];
  const src: FitItem['source'] = isLiveId(p.id) ? 'live' : 'curated';
  const has = (re: RegExp) => reasons.some((r) => re.test(r));
  const add = (key: string, label: string, wanted: string, status: FitItem['status'], detail: string, source: FitItem['source'] = null) =>
    fit.push({ key, label, wanted, status, detail, source });

  if (prefs.locality) {
    if (inside) add('location', 'Location', prefs.locality, 'met', `In ${prefs.locality}`, src);
    else add('location', 'Location', prefs.locality, 'unmet', distance != null ? `${distance.toFixed(1)} km from the ${prefs.locality} results` : `Not in ${prefs.locality}`, 'computed');
  }
  const wantedGroups = prefs.category ? [prefs.category] : prefs.interests;
  if (wantedGroups.length) {
    const hit = wantedGroups.filter((g) => p.groups.includes(g));
    const wanted = wantedGroups.map((g) => GROUP_LABEL[g]).join(' or ');
    if (hit.length) add('interest', 'Type of place', wanted, 'met', hit.map((g) => GROUP_LABEL[g]).join(' & '), src);
    else add('interest', 'Type of place', wanted, 'unmet', `It's ${p.groups.map((g) => GROUP_LABEL[g]).join(', ') || 'something else'}`, 'computed');
  }
  if (prefs.budget_max != null) {
    const wanted = prefs.budget_max === 0 ? 'Free' : `Up to ${money(prefs.budget_max, prefs.currency)}`;
    const pe = p.price_estimate;
    if (prefs.budget_max === 0 && (pe?.is_free || has(/^Free entry$/))) add('budget', 'Budget', wanted, 'met', 'Free entry', src);
    else if (pe?.min_spend != null && pe.min_spend <= prefs.budget_max && prefs.budget_max > 0) add('budget', 'Budget', wanted, 'met', `From ${money(pe.min_spend, prefs.currency)} per person`, src);
    else if (has(/^Price level consistent/)) add('budget', 'Budget', wanted, 'met', 'Price level fits', 'live');
    else if (pe?.min_spend != null && pe.min_spend > prefs.budget_max) add('budget', 'Budget', wanted, 'unmet', `From ${money(pe.min_spend, prefs.currency)} per person`, src);
    else add('budget', 'Budget', wanted, 'unknown', 'Price not listed');
  }
  if (prefs.companion_type) {
    if (has(/^Good for /)) add('company', "Who's coming", cap(prefs.companion_type), 'met', `Suits ${prefs.companion_type}`, src);
    else add('company', "Who's coming", cap(prefs.companion_type), 'unknown', `Not listed as suiting ${prefs.companion_type}`);
  }
  for (const a of prefs.atmosphere) {
    if (reasons.some((r) => / vibe$/.test(r) && r.toLowerCase().includes(a))) add('mood', 'Mood', cap(a), 'met', `Known for a ${a} feel`, src);
    else add('mood', 'Mood', cap(a), 'unknown', `Not described as ${a}`);
  }
  if (prefs.preferred_time) {
    if (has(/^Best in the /)) add('time', 'Time of day', cap(prefs.preferred_time), 'met', `Recommended in the ${prefs.preferred_time}`, src);
    else add('time', 'Time of day', cap(prefs.preferred_time), 'unknown', `Not specifically a ${prefs.preferred_time} spot`);
  }
  if (prefs.indoor_outdoor) {
    if (has(/ setting$/)) add('setting', 'Setting', cap(prefs.indoor_outdoor), 'met', cap(prefs.indoor_outdoor), src);
    else add('setting', 'Setting', cap(prefs.indoor_outdoor), 'unknown', 'Not known');
  }
  if (prefs.accessibility_requirements.length) {
    if (has(/^Wheelchair-accessible/)) add('access', 'Wheelchair access', 'Accessible entrance', 'met', 'Accessible entrance', src);
    else add('access', 'Wheelchair access', 'Accessible entrance', 'unknown', unverified.some((u) => /wheelchair/i.test(u)) ? 'Not confirmed' : 'No accessibility data');
  }
  return fit;
}

export interface SearchContext {
  query: string;
  category: string | null;
  suppressedInterests: string[];
}

export interface ProcessedSearch {
  preferences: Preferences;
  results: Recommendation[];
  nearby: Recommendation[];
  area: LocalityArea | null;
  interpretation: Interpretation | null;
  notice: string | null;
  hidden: number; // results dropped because they weren't the type of place asked for
}

export function processSearch(raw: RawSearchResponse, ctx: SearchContext): ProcessedSearch {
  const prefs = toPreferences(raw.preferences, ctx.query, ctx.category, ctx.suppressedInterests);
  const required = prefs.category ? [prefs.category] : prefs.interests;
  let hidden = 0;

  const recs = raw.results.map((r: RawRecommendation): Recommendation | null => {
    const place = toPlace(r.place, prefs.city);
    if (required.length && !required.some((g) => place.groups.includes(g))) {
      hidden++;
      return null;
    }
    const cur = prefs.currency;
    const texts = r.matched_reasons.map((t) => cleanReason(t, cur));
    const live = isLiveId(place.id);
    const reasons: Reason[] = texts
      .filter((t) => !(prefs.locality && t === `In ${prefs.locality}`)) // locality is re-checked below
      .map((text) => ({ text, source: live ? 'live' : 'curated' }));
    return {
      place,
      total_score: r.total_score,
      matched_reasons: reasons.map((x) => x.text),
      reasons,
      unverified_attributes: r.unverified_attributes.map((u) => u.replace(/ unverified$/, ' not confirmed').replace(/classification /, '')),
      fit: [],
      explanation: '',
      match_confidence: r.match_confidence,
      graph_node_id: live ? null : `place:${place.id}`,
      attribute_source: live ? null : 'curated',
      distance_from_locality_km: null,
      in_locality: null,
    };
  }).filter((r): r is Recommendation => !!r);

  // Location: only places whose own address (or curated neighbourhood) is in the named area count as "in" it.
  let area: LocalityArea | null = null;
  if (prefs.locality) {
    const inside = recs.filter((r) => inLocality(r.place, prefs.locality!));
    const pts = inside.map((r) => r.place.coordinates).filter(Boolean) as { latitude: number; longitude: number }[];
    if (pts.length) {
      const c = { latitude: pts.reduce((a, p) => a + p.latitude, 0) / pts.length, longitude: pts.reduce((a, p) => a + p.longitude, 0) / pts.length };
      const spread = Math.max(0.8, ...pts.map((p) => km(c, p)));
      area = { name: prefs.locality, city: prefs.city, latitude: c.latitude, longitude: c.longitude, radius_km: Math.min(3, spread + 0.5), source: 'curated' };
    }
    for (const r of recs) {
      r.in_locality = inLocality(r.place, prefs.locality);
      if (area && r.place.coordinates) r.distance_from_locality_km = Math.round(km(area, r.place.coordinates) * 100) / 100;
      if (r.in_locality) r.reasons.unshift({ text: `In ${prefs.locality}`, source: isLiveId(r.place.id) ? 'live' : 'curated' });
      else r.match_confidence = 'potential';
      r.matched_reasons = r.reasons.map((x) => x.text);
    }
  }

  for (const r of recs) {
    r.fit = buildFit(r.place, prefs, r.matched_reasons, r.unverified_attributes, r.in_locality ?? null, r.distance_from_locality_km ?? null);
    r.explanation = r.matched_reasons.length ? `Why it's here: ${r.matched_reasons.join('; ')}.` : `A well-rated pick in ${cap(prefs.city)} for this search.`;
  }

  let results = recs;
  let nearby: Recommendation[] = [];
  if (prefs.locality) {
    results = recs.filter((r) => r.in_locality);
    nearby = recs
      .filter((r) => !r.in_locality)
      .sort((a, b) => (a.distance_from_locality_km ?? 1e9) - (b.distance_from_locality_km ?? 1e9) || b.total_score - a.total_score)
      .slice(0, 6);
  }

  const notice = hidden && !results.length && !nearby.length ? `The search found places, but none were ${required.map((g) => GROUP_LABEL[g].toLowerCase()).join(' or ')}.` : null;
  return { preferences: prefs, results, nearby, area, interpretation: toInterpretation(raw.interpreted_criteria, ctx.query), notice, hidden };
}

/* ---------------- itinerary ---------------- */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES = DAYS.map(cap);
const RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
function toMin(h: string, m?: string, ap?: string) {
  let hour = parseInt(h, 10) % 24;
  if (ap?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (ap?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return hour * 60 + parseInt(m || '0', 10);
}
/** Open windows for a weekday from free-text hours; [] = closed, null = unknown. */
export function openWindows(text: string | null | undefined, weekday: number): [number, number][] | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/(24 hours|24\/7|open 24)/.test(t)) return [[0, 1440]];
  if (new RegExp(`closed (?:on )?${DAYS[weekday]}s?`).test(t)) return [];
  const out: [number, number][] = [];
  for (const m of t.split(';')[0].matchAll(RANGE_RE)) {
    const s = toMin(m[1], m[2], m[3]);
    let e = toMin(m[4], m[5], m[6] || m[3]);
    if (e <= s) e += 1440;
    out.push([s, e]);
  }
  return out.length ? out : null;
}
const fmt = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function slotLabel(start: number): string {
  if (start < 11 * 60) return 'Morning';
  if (start < 13 * 60) return 'Late morning';
  if (start < 15 * 60) return 'Midday';
  if (start < 17 * 60 + 30) return 'Afternoon';
  if (start < 20 * 60) return 'Evening';
  return 'Night';
}
const PURPOSE: Record<string, string> = {
  heritage: 'Explore the history and architecture',
  spiritual: 'Visit quietly and take in the rituals (dress modestly)',
  nature: 'Walk, breathe and slow down outdoors',
  shopping: 'Browse the stalls and pick up something local',
  fun: 'Enjoy the experience',
  food: 'Eat like a local',
  cafe: 'Coffee break and a breather',
  nightlife: 'Drinks to close the night',
};

export function processItinerary(raw: RawItinerary, weekday = new Date().getDay()): Itinerary {
  const city = (raw.city || 'hyderabad') as CityId;
  const notes: string[] = [];
  let prev: Place | null = null;
  let closed = 0;
  let unknown = 0;
  const stops: ItineraryStop[] = raw.stops.map((s, i) => {
    const place = toPlace(s.place, city);
    const m = s.time_slot.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
    const start = m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 9 * 60 + i * 120;
    const end = m ? parseInt(m[3], 10) * 60 + parseInt(m[4], 10) : start + s.duration_minutes;
    const w = openWindows(place.opening_hours_text, weekday);
    let status: ItineraryStop['hours_status'] = 'unknown';
    let note = 'Hours not listed; check before you go';
    if (w !== null) {
      const fits = w.some(([a, b]) => a <= start && end <= b);
      const desc = !w.length ? 'closed' : w[0][0] === 0 && w[0][1] === 1440 ? 'open 24 hours' : w.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ');
      status = fits ? 'open' : 'closed';
      note = fits ? `Listed hours on ${DAY_NAMES[weekday]}: ${desc}` : `Listed hours on ${DAY_NAMES[weekday]}: ${desc}, so this slot falls outside them`;
    }
    if (status === 'closed') closed++;
    if (status === 'unknown') unknown++;
    let leg: ItineraryStop['travel_from_previous'] = null;
    if (prev?.coordinates && place.coordinates) {
      const d = km(prev.coordinates, place.coordinates);
      const mins = d <= 0.8 ? Math.max(5, Math.round((d / 4.5) * 60)) : Math.round(10 + (d / (city === 'bengaluru' ? 15 : 18)) * 60);
      const mode = d <= 0.8 ? 'walk' : city === 'hyderabad' || city === 'bengaluru' ? 'cab / metro' : 'train / taxi';
      leg = { distance_km: Math.round(d * 10) / 10, minutes: mins, mode_note: `~${mins} min by ${mode} (straight-line estimate)` };
    }
    prev = place;
    const isMealSlot = /lunch|dinner|culinary|breakfast/i.test(s.visit_purpose);
    const isFood = place.groups.some((g) => g === 'food' || g === 'cafe');
    if (isMealSlot && !isFood) notes.push(`Stop ${i + 1} (${place.name}) is planned around a meal, but it isn't a food place. Swap it for a restaurant if you want to eat there.`);
    return {
      stop_index: s.stop_index,
      slot_kind: 'sight',
      slot_label: slotLabel(start),
      time_slot: `${fmt(start)} – ${fmt(end)}`,
      start_minute: start,
      end_minute: end,
      place,
      duration_minutes: s.duration_minutes,
      visit_purpose: place.groups.map((g) => PURPOSE[g]).find(Boolean) ?? 'Explore at your own pace',
      estimated_cost: place.price_estimate?.spending_range_text ?? s.estimated_cost,
      opening_hours_note: note,
      hours_status: status,
      travel_from_previous: leg,
      replacement_options: s.replacement_options.map((o) => ({ ...o, reason: null })),
    };
  });
  if (closed) notes.unshift(`${closed} stop${closed > 1 ? 's fall' : ' falls'} outside the listed opening hours for ${DAY_NAMES[weekday]}. Swap ${closed > 1 ? 'them' : 'it'} or check before going.`);
  if (unknown) notes.push(`${unknown} stop${unknown > 1 ? 's have' : ' has'} no listed hours.`);
  const legs = stops.map((s) => s.travel_from_previous).filter(Boolean) as NonNullable<ItineraryStop['travel_from_previous']>[];
  const travel = legs.length
    ? `${legs.length} hops, about ${legs.reduce((a, l) => a + l.distance_km, 0).toFixed(1)} km in total; the longest is ${Math.max(...legs.map((l) => l.distance_km))} km. Distances are straight-line estimates.`
    : 'Distances unavailable for these stops.';
  return {
    city,
    title: raw.title,
    theme: raw.theme,
    date_or_day: `${DAY_NAMES[weekday]}`,
    weekday,
    day_shape: stops.length > 3 ? 'full' : 'half',
    total_estimated_spend: raw.total_estimated_spend,
    travel_feasibility_note: travel,
    planner: 'unknown',
    notes,
    stops,
    conversation_history: raw.conversation_history.filter((m) => m.role === 'user' || m.role === 'assistant') as Itinerary['conversation_history'],
    candidate_pool: [],
    preferences: null,
  };
}
