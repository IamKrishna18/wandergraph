/**
 * A quick, client-side reading of a search, used to show the query being understood as you type.
 * The backend still does the real parsing; this mirrors its vocabulary so the preview is honest.
 */
import { PARSER_WORDS, normalize } from './adapter';
import { CITY_META } from './meta';

export type FacetKey = 'area' | 'type' | 'mood' | 'with' | 'budget' | 'when';

export interface Facet {
  key: FacetKey;
  value: string;
  /** character range in the original text, for highlighting */
  start: number;
  end: number;
}

export const FACET_ORDER: FacetKey[] = ['area', 'type', 'mood', 'with', 'budget', 'when'];
export const FACET_LABEL: Record<FacetKey, string> = {
  area: 'Area',
  type: 'Type',
  mood: 'Mood',
  with: 'With',
  budget: 'Budget',
  when: 'When',
};
export const FACET_COLOR: Record<FacetKey, string> = {
  area: '#FF6A3D',
  type: '#EDEDEF',
  mood: '#C4B5FD',
  with: '#7DD3FC',
  budget: '#3DD68C',
  when: '#F5B941',
};

const TYPE_WORDS: [string, string[]][] = [
  ['Temples & shrines', ['temple', 'shrine', 'mosque', 'church', 'mandir', 'dargah']],
  ['Parks & nature', ['park', 'garden', 'lake', 'nature', 'bamboo', 'hike', 'forest', 'river', 'beach', 'greenery']],
  ['Cafes', ['cafe', 'coffee', 'tea', 'bakery', 'dessert']],
  ['Nightlife', ['bar', 'pub', 'brewery', 'brewpub', 'beer', 'cocktail', 'club', 'nightlife']],
  ['Food', ['restaurant', 'food', 'biryani', 'ramen', 'sushi', 'dinner', 'lunch', 'breakfast', 'tiffin', 'street food', 'dosa']],
  ['Heritage', ['heritage', 'fort', 'palace', 'museum', 'monument', 'history', 'historic', 'tomb', 'castle']],
  ['Markets', ['market', 'bazaar', 'shopping', 'mall', 'souvenir']],
  ['Views', ['view', 'views', 'viewpoint', 'skyline', 'tower', 'sunset']],
];

const WITH_LABEL: [string, string[]][] = [
  ['Couple', ['girlfriend', 'boyfriend', 'partner', 'wife', 'husband', 'couples', 'couple', 'date', 'for two']],
  ['Family', ['family', 'parents', 'kids', 'children', 'relatives']],
  ['Friends', ['friends', 'buddies', 'gang', 'group', 'colleagues']],
  ['Solo', ['solo', 'alone', 'myself']],
];

const WHEN_LABEL: [string, string[]][] = [
  ['Morning', ['morning', 'sunrise', 'early morning', 'breakfast']],
  ['Afternoon', ['afternoon', 'lunch']],
  ['Evening', ['evening', 'sunset']],
  ['Night', ['night', 'tonight', 'late night']],
];

const STOP = new Set(['the', 'a', 'my', 'with', 'for', 'and', 'under', 'below', 'this', 'tonight', 'today', 'tomorrow', 'morning', 'evening', 'night', 'afternoon', 'early']);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** First whole-word match of any phrase, allowing a plural "s"; returns its range in the original text. */
function find(text: string, phrases: string[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const p of [...phrases].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`\\b${esc(p)}(?:e?s)?\\b`, 'i').exec(text);
    if (m && (!best || m.index < best.start)) best = { start: m.index, end: m.index + m[0].length };
  }
  return best;
}

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function parseFacets(text: string, cityId: string, areas: string[] = []): Facet[] {
  const out: Facet[] = [];
  if (!text.trim()) return out;
  const meta = CITY_META[cityId as keyof typeof CITY_META];

  // Area: a known neighbourhood (typos allowed), else the words after "in / near / around"
  let area: Facet | null = null;
  const words = [...text.matchAll(/[\p{L}\p{N}'-]+/gu)].map((m) => ({ w: m[0], i: m.index ?? 0 }));
  for (const name of [...areas].sort((a, b) => b.length - a.length)) {
    const n = normalize(name).split(' ').length;
    for (let i = 0; i + n <= words.length; i++) {
      const chunk = words.slice(i, i + n);
      const said = normalize(chunk.map((c) => c.w).join(' '));
      const target = normalize(name);
      const close = said === target || (target.length >= 6 && lev(said, target) <= 2);
      if (close) {
        const end = chunk[n - 1].i + chunk[n - 1].w.length;
        area = { key: 'area', value: name, start: chunk[0].i, end };
        break;
      }
    }
    if (area) break;
  }
  if (!area) {
    const m = /\b(?:in|near|around|at)\s+(?:the\s+)?([\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]+)?)/iu.exec(text);
    if (m) {
      const parts = m[1].split(/\s+/).filter((w) => !STOP.has(w.toLowerCase()));
      const cityWord = meta && parts.some((w) => normalize(w) === normalize(meta.name));
      if (parts.length && !cityWord) {
        const phrase = parts.join(' ');
        const start = (m.index ?? 0) + m[0].indexOf(parts[0]);
        const value = phrase.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
        area = { key: 'area', value, start, end: start + phrase.length };
      }
    }
  }
  if (area) out.push(area);

  const overlaps = (r: { start: number; end: number }) => out.some((f) => r.start < f.end && f.start < r.end);
  const add = (key: FacetKey, table: [string, string[]][]) => {
    for (const [label, phrases] of table) {
      const r = find(text, phrases);
      if (r && !overlaps(r)) {
        out.push({ key, value: label, ...r });
        return;
      }
    }
  };

  add('type', TYPE_WORDS);
  const moods = Object.entries(PARSER_WORDS.atmosphere as Record<string, string[]>).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), [k, ...v]] as [string, string[]]);
  moods.push(['Quiet', ['quiet', 'no crowds', 'calm']]);
  add('mood', moods);
  add('with', WITH_LABEL);
  add('when', WHEN_LABEL);

  const money = /\b(?:under|below|within|less than|upto|up to)\s*([₹¥$])?\s*([0-9][0-9,]*)/i.exec(text);
  if (money) {
    const sym = money[1] ?? meta?.symbol ?? '';
    const r = { start: money.index, end: money.index + money[0].length };
    if (!overlaps(r)) out.push({ key: 'budget', value: `≤ ${sym}${money[2]}`, ...r });
  } else {
    const r = find(text, ['free', 'no cost']);
    if (r && !overlaps(r)) out.push({ key: 'budget', value: 'Free', ...r });
  }
  return out.sort((a, b) => FACET_ORDER.indexOf(a.key) - FACET_ORDER.indexOf(b.key));
}
