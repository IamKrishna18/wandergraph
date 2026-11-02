import { describe, expect, it } from 'vitest';
import recorded from './api-recorded.json';
import {
  classify,
  cleanPrice,
  openWindows,
  processItinerary,
  processSearch,
  stripConstraint,
  toInterpretation,
  toPlace,
  toServerQuery,
  verifiedInterests,
} from '../src/adapter';
import type { RawItinerary, RawPlace, RawSearchResponse } from '../src/api';

const R = recorded as unknown as Record<string, any>;

describe('search clean-up (recorded responses from the current backend)', () => {
  it('ignores categories the backend read from the area name ("hills" in "Banjara Hills")', () => {
    const raw = R.banjara as RawSearchResponse;
    expect(raw.preferences.interests).toContain('nature_outdoors'); // what the backend says
    const out = processSearch(raw, { query: 'romantic places in banjara hills', category: null, suppressedInterests: [] });
    expect(out.preferences.interests).toEqual([]); // not a nightlife search
    expect(out.results.map((r) => r.place.name)).toContain('Roastery Coffee House');
  });

  it('keeps only places inside the named area, with a fit checklist', () => {
    const out = processSearch(R.banjara, { query: 'romantic places in banjara hills', category: null, suppressedInterests: [] });
    for (const r of out.results) {
      expect(r.in_locality).toBe(true);
      expect(r.fit.find((f) => f.key === 'location')?.status).toBe('met');
      expect(r.fit.find((f) => f.key === 'mood')).toBeTruthy();
    }
  });

  it('is honest when nothing is inside the area', () => {
    const out = processSearch(R.uppal, { query: 'peaceful parks in uppal', category: null, suppressedInterests: [] });
    expect(out.preferences.locality).toBe('Uppal');
    expect(out.preferences.interests).toEqual(['nature']);
    expect(out.results).toEqual([]);
  });

  it('requires the type of place that was asked for', () => {
    const out = processSearch(R.parks_city, { query: 'peaceful park', category: null, suppressedInterests: [] });
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r) => r.place.groups.includes('nature'))).toBe(true);
  });

  it('labels curated data honestly and never claims "open now" for it', () => {
    const out = processSearch(R.kyoto, { query: 'temples in kyoto', category: null, suppressedInterests: [] });
    for (const r of out.results) {
      expect(r.place.provenance.verification_status).toBe('curated');
      expect(r.place.is_open_now).toBeNull();
      expect(r.place.price_estimate?.estimate_type).not.toBe('verified');
      expect(r.graph_node_id).toBe(`place:${r.place.id}`);
    }
    expect(out.preferences.interests).toEqual(['spiritual', 'heritage']);
  });

  it('rewrites reasons into plain phrases', () => {
    const out = processSearch(R.banjara, { query: 'romantic places in banjara hills', category: null, suppressedInterests: [] });
    const reasons = out.results[0].matched_reasons.join(' | ');
    expect(reasons).not.toMatch(/Located directly|atmosphere$|INR/);
    expect(out.results[0].explanation.startsWith("Why it's here")).toBe(true);
  });
});

describe('query helpers', () => {
  it('sends place nouns in the singular and adds category words', () => {
    expect(toServerQuery('temples in kyoto', null)).toBe('temple in kyoto');
    expect(toServerQuery('cafes with friends', null)).toBe('cafe with friends'); // companion words untouched
    expect(toServerQuery('', 'nature')).toBe('park garden');
    expect(toServerQuery('', null)).toBe('popular places');
  });

  it('strips a removed constraint so the backend does not add it back', () => {
    expect(stripConstraint('romantic cafes in banjara hills', 'atmosphere', 'romantic')).toBe('cafes in banjara hills');
    expect(stripConstraint('peaceful parks in uppal', 'locality', 'Uppal')).toBe('peaceful parks');
    expect(stripConstraint('dinner under 1,000 for two', 'budget_max', 1000)).toBe('dinner');
    expect(stripConstraint('free parks with my family', 'budget_max', 0)).toBe('parks with my family');
    expect(stripConstraint('parks with my family', 'companion_type', 'family')).toBe('parks');
  });

  it('only trusts whole-word categories', () => {
    expect(verifiedInterests(['bar_nightlife'], 'romantic places in banjara hills')).toEqual([]);
    expect(verifiedInterests(['nature_outdoors'], 'romantic places in banjara hills', 'Banjara Hills')).toEqual([]);
    expect(verifiedInterests(['nature_outdoors'], 'walks in the hills')).toEqual(['nature_outdoors']);
    expect(verifiedInterests(['restaurant'], 'great views')).toEqual([]);
    expect(verifiedInterests(['nature_outdoors', 'cafe'], 'parks and cafes')).toEqual(['nature_outdoors', 'cafe']);
  });

  it('works out what was corrected', () => {
    const i = toInterpretation({ detected_city: 'hyderabad', detected_locality: 'Banjara Hills', detected_atmospheres: [], was_corrected: true }, 'cafes in hydrabad banjra hills');
    expect(i?.corrections).toEqual([
      { from: 'hydrabad', to: 'Hyderabad' },
      { from: 'banjra hills', to: 'Banjara Hills' },
    ]);
  });
});

describe('places and prices', () => {
  const base: RawPlace = {
    id: 'gplaces:x', name: 'Charminar Biryani House', city: 'hyderabad', locality: 'Banjara Hills', formatted_address: 'Abids, Hyderabad',
    types: ['restaurant', 'food'], price_level: 2, photos: [], provenance: {},
    price_estimate: { spending_range_text: '₹25 – 225 typical spend', admission_text: 'Admission: ₹25', currency: 'INR', estimate_type: 'verified', min_spend: 25, max_spend: 225, is_free: false, methodology_note: 'Verified official landmark admission fee with estimated incidental expenditure.' },
  };

  it('drops a monument fee that leaked onto a restaurant', () => {
    const pe = cleanPrice(base, 'hyderabad', classify(base.types));
    expect(pe?.min_spend).toBe(500);
    expect(pe?.estimate_type).toBe('estimated_by_price_level');
  });

  it('fixes the yen-for-India currency bug', () => {
    const pe = cleanPrice({ ...base, types: ['museum'], price_estimate: { ...base.price_estimate!, currency: 'JPY', spending_range_text: '¥1,800' } }, 'hyderabad', ['heritage']);
    expect(pe?.currency).toBe('INR');
  });

  it('does not trust the locality the API stamps on live results', () => {
    const p = toPlace(base, 'hyderabad');
    expect(p.locality).toBeNull();
    expect(p.provenance.verification_status).toBe('source_returned');
  });
});

describe('itinerary checks', () => {
  it('parses listed hours', () => {
    expect(openWindows('10:00 - 17:00 (Closed Fridays)', 5)).toEqual([]);
    expect(openWindows('07:00 - 12:00, 15:00 - 21:00 daily', 2)).toEqual([[420, 720], [900, 1260]]);
    expect(openWindows('Open 24 hours daily', 0)).toEqual([[0, 1440]]);
    expect(openWindows(undefined, 0)).toBeNull();
  });

  it('flags closed stops, non-food meal stops, and computes real distances', () => {
    const it2 = processItinerary(R.itinerary as RawItinerary, 2);
    expect(it2.stops.length).toBe((R.itinerary as RawItinerary).stops.length);
    const salar = it2.stops.find((s) => s.place.name === 'Salar Jung Museum');
    if (salar && salar.start_minute >= 17 * 60) expect(salar.hours_status).toBe('closed');
    expect(it2.stops.some((s) => s.opening_hours_note.includes('Verified open now'))).toBe(false);
    expect(it2.notes.some((n) => /isn't a food place/.test(n))).toBe(true);
    expect(it2.stops.slice(1).every((s) => s.travel_from_previous && s.travel_from_previous.distance_km > 0)).toBe(true);
    expect(it2.travel_feasibility_note).toMatch(/km in total/);
  });
});
