/**
 * Groups a city's places into sectors (by theme, by who they suit, or by neighbourhood)
 * and lays the graph out in rings:
 *   centre: the city
 *   ring 1: one hub per sector (or each neighbourhood)
 *   ring 2: the places, fanned out inside their sector's wedge
 *   ring 3: what describes the places (category, mood, who it suits, time, price),
 *           ordered so each sits near the places it describes
 */
import type { GraphData } from './types';

export type GroupBy = 'theme' | 'audience' | 'area';

export interface SectorDef {
  id: string;
  label: string;
  color: string;
}

export const THEME_SECTORS: SectorDef[] = [
  { id: 'heritage', label: 'Heritage & history', color: '#F5B941' },
  { id: 'spiritual', label: 'Temples & shrines', color: '#FF8A4C' },
  { id: 'nature', label: 'Nature & views', color: '#3DD68C' },
  { id: 'food', label: 'Food & drink', color: '#FF6B6B' },
  { id: 'arts', label: 'Arts & culture', color: '#E879F9' },
  { id: 'tech', label: 'Modern & tech', color: '#38BDF8' },
  { id: 'shopping', label: 'Shopping', color: '#F472B6' },
  { id: 'fun', label: 'Fun & entertainment', color: '#A78BFA' },
];

export const AUDIENCE_SECTORS: SectorDef[] = [
  { id: 'family', label: 'Family places', color: '#3DD68C' },
  { id: 'couples', label: 'Couple spots', color: '#FF6B9A' },
  { id: 'friends', label: 'Friends hangouts', color: '#FFB547' },
  { id: 'solo', label: 'Solo trips', color: '#7DD3FC' },
];

export const GROUP_BY_LABEL: Record<GroupBy, string> = { theme: 'Theme', audience: "Who it's for", area: 'Area' };

export interface PlaceFacts {
  category: string;
  primaryType: string;
  moods: string[];
  /** in the order the curated data lists them; the first is treated as the best fit */
  companions: string[];
  hood: string | null;
}

export function placeFacts(g: GraphData): Map<string, PlaceFacts> {
  const node = new Map(g.nodes.map((n) => [n.data.id, n.data]));
  const out = new Map<string, PlaceFacts>();
  for (const n of g.nodes) {
    if (n.data.type !== 'Place') continue;
    const p = n.data.properties ?? {};
    out.set(n.data.id, { category: p.category ?? '', primaryType: p.primary_type ?? '', moods: [], companions: [], hood: null });
  }
  for (const e of g.edges) {
    const f = out.get(e.data.source ?? '');
    const t = node.get(e.data.target ?? '');
    if (!f || !t) continue;
    const label = String(t.label ?? '').toLowerCase();
    if (e.data.relation === 'HAS_ATMOSPHERE') f.moods.push(label);
    else if (e.data.relation === 'SUITABLE_FOR') f.companions.push(label);
    else if (e.data.relation === 'IN_NEIGHBORHOOD') f.hood = t.id;
  }
  return out;
}

/** Which theme a place belongs to. Futuristic places and science museums count as "modern & tech". */
export function themeOf(f: PlaceFacts): string {
  const t = f.primaryType;
  const modern = f.moods.includes('modern');
  if (t === 'science_museum' || f.moods.includes('futuristic')) return 'tech';
  if (f.category === 'religious_site' || /temple|shrine|mosque|church/.test(t) || (f.category === 'historical_monument' && f.moods.includes('spiritual'))) return 'spiritual';
  switch (f.category) {
    case 'historical_monument':
      return 'heritage';
    case 'museum':
    case 'cultural_center':
      return 'arts';
    case 'park_nature':
      return 'nature';
    case 'scenic_spot':
      return modern ? 'tech' : 'nature';
    case 'food_drink':
      return 'food';
    case 'market_shopping':
      return 'shopping';
    case 'entertainment':
      return t === 'shopping_mall' ? 'shopping' : 'fun';
    default:
      return 'fun';
  }
}

export function audienceOf(f: PlaceFacts): string {
  const first = f.companions[0] ?? '';
  if (first.startsWith('famil')) return 'family';
  if (first.startsWith('coupl')) return 'couples';
  if (first.startsWith('friend')) return 'friends';
  if (first.startsWith('solo')) return 'solo';
  return 'family';
}

export interface Sector extends SectorDef {
  hub: string;
  start: number;
  end: number;
  places: string[];
}

export interface Layout {
  pos: Record<string, { x: number; y: number; a: number }>;
  sectors: Sector[];
  /** synthetic hub nodes and their links (theme / audience modes) */
  hubs: { id: string; label: string; color: string; count: number }[];
  hubEdges: { source: string; target: string }[];
  /** colour to paint each place with in this mode */
  placeColor: Record<string, string>;
  rings: { r1: number; r2: number; r3: number };
}

const ATTRIBUTE_TYPES = ['Category', 'CompanionType', 'TimeOfDay', 'PriceRange', 'Atmosphere'];

export function radialLayout(g: GraphData, groupBy: GroupBy = 'area'): Layout {
  const type = new Map(g.nodes.map((n) => [n.data.id, n.data.type ?? '']));
  const label = new Map(g.nodes.map((n) => [n.data.id, n.data.label ?? '']));
  const facts = placeFacts(g);
  const places = g.nodes.filter((n) => n.data.type === 'Place').map((n) => n.data.id);
  const city = g.nodes.find((n) => n.data.type === 'City')?.data.id;

  // 1. which sector each place goes in
  let defs: SectorDef[];
  const groupOf = new Map<string, string>();
  if (groupBy === 'area') {
    const hoods = g.nodes.filter((n) => n.data.type === 'Neighborhood').map((n) => n.data.id);
    defs = hoods.map((h) => ({ id: h, label: label.get(h) ?? h, color: '#A1A1AA' }));
    for (const p of places) {
      const h = facts.get(p)?.hood;
      groupOf.set(p, h && hoods.includes(h) ? h : `loose:${p}`);
    }
    for (const p of places) if (groupOf.get(p)!.startsWith('loose:')) defs.push({ id: groupOf.get(p)!, label: '', color: '#A1A1AA' });
  } else {
    defs = groupBy === 'theme' ? THEME_SECTORS : AUDIENCE_SECTORS;
    for (const p of places) groupOf.set(p, groupBy === 'theme' ? themeOf(facts.get(p)!) : audienceOf(facts.get(p)!));
  }
  const members = new Map<string, string[]>(defs.map((d) => [d.id, []]));
  for (const p of places) members.get(groupOf.get(p)!)?.push(p);
  for (const list of members.values()) list.sort((a, b) => (label.get(a) ?? '').localeCompare(label.get(b) ?? ''));

  // in area mode spread the busiest neighbourhoods around the circle; in sector modes keep the fixed order
  let order = defs.filter((d) => groupBy === 'area' || members.get(d.id)!.length > 0);
  if (groupBy === 'area') {
    const sorted = [...order].sort((a, b) => members.get(b.id)!.length - members.get(a.id)!.length || a.label.localeCompare(b.label));
    order = [];
    sorted.forEach((d, i) => (i % 2 ? order.push(d) : order.unshift(d)));
  }

  const n1 = order.length;
  const r1 = groupBy === 'area' ? 120 + n1 * 4 : 170;
  const r2 = r1 + (groupBy === 'area' ? 150 : 170);
  const r3 = r2 + 190;
  const pos: Layout['pos'] = {};
  const sectors: Sector[] = [];
  const gap = groupBy === 'area' ? 0 : 0.07;
  const weights = order.map((d) => Math.max(1, members.get(d.id)!.length));
  const W = weights.reduce((s, x) => s + x, 0) || 1;
  const usable = 2 * Math.PI - gap * order.length;
  let cursor = -Math.PI / 2;
  order.forEach((d, i) => {
    const span = (usable * weights[i]) / W;
    const start = cursor + gap / 2;
    const end = start + span;
    const mid = (start + end) / 2;
    const ps = members.get(d.id)!;
    const hub = groupBy === 'area' ? d.id : `sector:${d.id}`;
    if (!d.id.startsWith('loose:')) pos[hub] = { x: r1 * Math.cos(mid), y: r1 * Math.sin(mid), a: mid };
    ps.forEach((p, k) => {
      const a = ps.length === 1 ? mid : start + (span * (k + 0.5)) / ps.length;
      pos[p] = { x: r2 * Math.cos(a), y: r2 * Math.sin(a), a };
    });
    if (!d.id.startsWith('loose:')) sectors.push({ ...d, hub, start, end, places: ps });
    cursor = end + gap / 2;
  });
  if (city) pos[city] = { x: 0, y: 0, a: 0 };

  // 3. attributes on the outer ring, near the places they describe
  const links = new Map<string, Set<string>>();
  for (const e of g.edges) {
    const { source: s, target: t } = e.data;
    if (!s || !t) continue;
    const [p, other] = type.get(s) === 'Place' ? [s, t] : type.get(t) === 'Place' ? [t, s] : [null, null];
    if (p && other && ATTRIBUTE_TYPES.includes(type.get(other) ?? '')) {
      if (!links.has(other)) links.set(other, new Set());
      links.get(other)!.add(p);
    }
  }
  const attrs = g.nodes.filter((n) => ATTRIBUTE_TYPES.includes(n.data.type ?? '')).map((n) => n.data.id);
  const mean = (id: string) => {
    const ps = [...(links.get(id) ?? [])].filter((p) => pos[p]);
    if (!ps.length) return null;
    return Math.atan2(ps.reduce((s, p) => s + Math.sin(pos[p].a), 0), ps.reduce((s, p) => s + Math.cos(pos[p].a), 0));
  };
  const withMean = attrs.map((id) => ({ id, m: mean(id) }));
  const known = withMean.filter((x) => x.m != null).sort((a, b) => a.m! - b.m!);
  const ring = [...known, ...withMean.filter((x) => x.m == null)];
  const step = (2 * Math.PI) / Math.max(ring.length, 1);
  let sx = 0;
  let sy = 0;
  known.forEach((x, i) => {
    const d = x.m! - (i * step - Math.PI);
    sx += Math.cos(d);
    sy += Math.sin(d);
  });
  const rot = known.length ? Math.atan2(sy, sx) : 0;
  ring.forEach((x, i) => {
    const a = i * step - Math.PI + rot;
    pos[x.id] = { x: r3 * Math.cos(a), y: r3 * Math.sin(a), a };
  });
  for (const n of g.nodes) if (!pos[n.data.id]) pos[n.data.id] = { x: 0, y: 0, a: 0 };

  const hubs = groupBy === 'area' ? [] : sectors.map((s) => ({ id: s.hub, label: s.label, color: s.color, count: s.places.length }));
  const hubEdges = groupBy === 'area' ? [] : sectors.flatMap((s) => [...(city ? [{ source: city, target: s.hub }] : []), ...s.places.map((p) => ({ source: s.hub, target: p }))]);
  const placeColor: Record<string, string> = {};
  if (groupBy !== 'area') for (const s of sectors) for (const p of s.places) placeColor[p] = s.color;
  return { pos, sectors, hubs, hubEdges, placeColor, rings: { r1, r2, r3 } };
}

/** SVG path for a ring segment between two radii and two angles. */
export function wedgePath(rIn: number, rOut: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
  return `M ${p(rOut, a0)} A ${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)} Z`;
}
