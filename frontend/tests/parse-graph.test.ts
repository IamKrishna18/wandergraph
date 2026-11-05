import { describe, expect, it } from 'vitest';
import { parseFacets } from '../src/parse';
import { audienceOf, radialLayout, themeOf, type PlaceFacts } from '../src/graphLayout';
import type { GraphData } from '../src/types';

const val = (q: string, city = 'hyderabad', areas: string[] = []) => Object.fromEntries(parseFacets(q, city, areas).map((f) => [f.key, f.value]));

describe('live search reading', () => {
  it('picks out area, type, mood, company, budget and time', () => {
    expect(val('peaceful parks in Uppal with my family this morning')).toEqual({ area: 'Uppal', type: 'Parks & nature', mood: 'Peaceful', with: 'Family', when: 'Morning' });
    expect(val('romantic cafes in banjra hills under ₹1000', 'hyderabad', ['Banjara Hills'])).toEqual({ area: 'Banjara Hills', type: 'Cafes', mood: 'Romantic', budget: '≤ ₹1000' });
  });
  it('does not treat the city name as an area, and uses the city currency', () => {
    expect(val('temples in kyoto under 3000', 'kyoto')).toEqual({ type: 'Temples & shrines', budget: '≤ ¥3000' });
    expect(val('free things to do', 'tokyo')).toEqual({ budget: 'Free' });
  });
  it('returns ranges that point at the matched words', () => {
    const q = 'craft beer in Indiranagar';
    const f = parseFacets(q, 'bengaluru', ['Indiranagar']);
    for (const x of f) expect(q.slice(x.start, x.end).length).toBeGreaterThan(0);
    expect(f.find((x) => x.key === 'area')).toMatchObject({ value: 'Indiranagar', start: 14, end: 25 });
  });
});

describe('graph layout', () => {
  const n = (id: string, type: string) => ({ data: { id, label: id, type } });
  const e = (s: string, t: string, relation: string) => ({ data: { id: `${s}-${t}`, source: s, target: t, relation } });
  const g: GraphData = {
    nodes: [n('city', 'City'), n('h1', 'Neighborhood'), n('h2', 'Neighborhood'), n('p1', 'Place'), n('p2', 'Place'), n('p3', 'Place'), n('a1', 'Atmosphere'), n('c1', 'Category')],
    edges: [e('h1', 'city', 'LOCATED_IN'), e('h2', 'city', 'LOCATED_IN'), e('p1', 'h1', 'IN_NEIGHBORHOOD'), e('p2', 'h1', 'IN_NEIGHBORHOOD'), e('p3', 'h2', 'IN_NEIGHBORHOOD'), e('p1', 'a1', 'HAS_ATMOSPHERE'), e('p3', 'c1', 'HAS_CATEGORY')],
  };
  const r = (p: { x: number; y: number }) => Math.round(Math.hypot(p.x, p.y));
  it('puts each node type on its own ring', () => {
    const { pos } = radialLayout(g, 'area');
    expect(r(pos.city)).toBe(0);
    expect(r(pos.h1)).toBe(r(pos.h2));
    expect(r(pos.p1)).toBe(r(pos.p3));
    expect(r(pos.a1)).toBe(r(pos.c1));
    expect(r(pos.h1)).toBeLessThan(r(pos.p1));
    expect(r(pos.p1)).toBeLessThan(r(pos.a1));
  });
  it("keeps places next to their neighbourhood", () => {
    const { pos } = radialLayout(g, 'area');
    const ang = (id: string) => Math.atan2(pos[id].y, pos[id].x);
    const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(gap(ang('p1'), ang('h1'))).toBeLessThan(gap(ang('p1'), ang('h2')));
    expect(gap(ang('p3'), ang('h2'))).toBeLessThan(gap(ang('p3'), ang('h1')));
  });
});

describe('graph sectors', () => {
  const f = (o: Partial<PlaceFacts>): PlaceFacts => ({ category: '', primaryType: '', moods: [], companions: [], hood: null, ...o });
  it('sorts places into themes', () => {
    expect(themeOf(f({ category: 'historical_monument', moods: ['grand'] }))).toBe('heritage');
    expect(themeOf(f({ category: 'historical_monument', moods: ['spiritual'] }))).toBe('spiritual');
    expect(themeOf(f({ category: 'historical_monument', primaryType: 'buddhist_temple' }))).toBe('spiritual');
    expect(themeOf(f({ category: 'museum', primaryType: 'science_museum' }))).toBe('tech');
    expect(themeOf(f({ category: 'scenic_spot', moods: ['futuristic'] }))).toBe('tech');
    expect(themeOf(f({ category: 'entertainment', primaryType: 'amusement_park' }))).toBe('fun');
    expect(themeOf(f({ category: 'entertainment', primaryType: 'shopping_mall' }))).toBe('shopping');
    expect(themeOf(f({ category: 'food_drink', moods: ['modern'] }))).toBe('food');
  });
  it('uses the first companion the data lists', () => {
    expect(audienceOf(f({ companions: ['couples', 'friends'] }))).toBe('couples');
    expect(audienceOf(f({ companions: ['family'] }))).toBe('family');
  });
  it('builds one hub per non-empty sector and keeps its places inside the wedge', () => {
    const n = (id: string, type: string, properties: Record<string, string> = {}) => ({ data: { id, label: id, type, properties } });
    const e = (s: string, t: string, relation: string) => ({ data: { id: `${s}-${t}`, source: s, target: t, relation } });
    const g: GraphData = {
      nodes: [n('city', 'City'), n('p1', 'Place', { category: 'food_drink' }), n('p2', 'Place', { category: 'food_drink' }), n('p3', 'Place', { category: 'park_nature' }), n('fam', 'CompanionType')],
      edges: [e('p1', 'city', 'LOCATED_IN'), e('p1', 'fam', 'SUITABLE_FOR')],
    };
    const L = radialLayout(g, 'theme');
    expect(L.hubs.map((h) => [h.id, h.count])).toEqual([['sector:nature', 1], ['sector:food', 2]]);
    const food = L.sectors.find((s) => s.id === 'food')!;
    for (const p of food.places) expect(L.pos[p].a).toBeGreaterThanOrEqual(food.start);
    for (const p of food.places) expect(L.pos[p].a).toBeLessThanOrEqual(food.end);
    expect(L.hubEdges).toContainEqual({ source: 'sector:food', target: 'p1' });
    expect(L.placeColor.p3).toBe('#3DD68C');
  });
});
