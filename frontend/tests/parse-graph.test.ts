import { describe, expect, it } from 'vitest';
import { parseFacets } from '../src/parse';
import { radialLayout } from '../src/components/GraphExplorer';
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
    const pos = radialLayout(g);
    expect(r(pos.city)).toBe(0);
    expect(r(pos.h1)).toBe(r(pos.h2));
    expect(r(pos.p1)).toBe(r(pos.p3));
    expect(r(pos.a1)).toBe(r(pos.c1));
    expect(r(pos.h1)).toBeLessThan(r(pos.p1));
    expect(r(pos.p1)).toBeLessThan(r(pos.a1));
  });
  it("keeps places next to their neighbourhood", () => {
    const pos = radialLayout(g);
    const ang = (id: string) => Math.atan2(pos[id].y, pos[id].x);
    const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(gap(ang('p1'), ang('h1'))).toBeLessThan(gap(ang('p1'), ang('h2')));
    expect(gap(ang('p3'), ang('h2'))).toBeLessThan(gap(ang('p3'), ang('h1')));
  });
});
