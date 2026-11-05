import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreName, findWikiPhoto, isGooglePhoto, isStockPhoto, pickWikiPhoto, resolvePlacePhoto, wikiPageMatches } from '../src/placeImage';

const photo = (file = 'Charminar_Hyderabad_1.jpg') => ({ thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/x/${file}/900px-${file}` }, pageimage: file });
const page = (title: string, extract: string, extra: Record<string, unknown> = {}) => ({ title, extract, ...photo(), ...extra });

afterEach(() => vi.restoreAllMocks());

describe('which photos count as the place', () => {
  it('treats backend category photos as stock and Google photos as real', () => {
    expect(isStockPhoto({ name: 'mock_photos/hyd_charminar_1', proxy_url: 'https://images.unsplash.com/photo-1' })).toBe(true);
    expect(isStockPhoto({ name: 'fallback:cafe', proxy_url: 'https://images.unsplash.com/photo-2' })).toBe(true);
    expect(isGooglePhoto({ name: 'places/abc/photos/def', proxy_url: '/api/places/photo?name=places/abc' })).toBe(true);
  });
  it('trims curated names to the part that names the place', () => {
    expect(coreName('Paradise Biryani (Original)')).toBe('Paradise Biryani');
    expect(coreName('Hussain Sagar Lake & Buddha Statue')).toBe('Hussain Sagar Lake');
  });
});

describe('matching a Wikipedia article to a place', () => {
  it('accepts the article about the place, in the right city', () => {
    expect(wikiPageMatches(page('Charminar', 'The Charminar is a monument in Hyderabad, Telangana, India.'), 'Charminar', 'hyderabad')).toBe(true);
    expect(wikiPageMatches(page('Sensō-ji', 'Sensō-ji is an ancient Buddhist temple in Asakusa, Tokyo.'), 'Senso-ji Temple', 'tokyo')).toBe(true);
    expect(wikiPageMatches(page('Meiji Shrine', 'Meiji Jingu is a Shinto shrine in Shibuya, Tokyo.'), 'Meiji Jingu Shrine', 'tokyo')).toBe(true);
    expect(wikiPageMatches(page('Birla Mandir, Hyderabad', 'Birla Mandir is a Hindu temple in Hyderabad.'), 'Birla Mandir', 'hyderabad')).toBe(true);
  });
  it('rejects same-named things that are not this place', () => {
    // a film with the same name
    expect(wikiPageMatches(page('Bawarchi', 'Bawarchi is a 1972 Indian Hindi-language comedy film.'), 'Bawarchi Restaurant', 'hyderabad')).toBe(false);
    // the same name in another city
    expect(wikiPageMatches(page('Birla Mandir, Delhi', 'Birla Mandir is a temple in Delhi. Another stands in Hyderabad.'), 'Birla Mandir', 'hyderabad')).toBe(false);
    // the city's own article for a place named after the city
    expect(wikiPageMatches(page('Tokyo', 'Tokyo is the capital of Japan.'), 'Tokyo Tower', 'tokyo')).toBe(false);
    expect(wikiPageMatches(page('Tokyo Tower', 'Tokyo Tower is a tower in Minato, Tokyo.'), 'Tokyo Tower', 'tokyo')).toBe(true);
    // a loosely related article
    expect(wikiPageMatches(page('Paradise Food Court', 'A food court in Secunderabad.'), 'Paradise Biryani (Original)', 'hyderabad')).toBe(false);
    // disambiguation pages, logos and maps
    expect(wikiPageMatches(page('Charminar', 'x Hyderabad', { description: 'Topics referred to by the same term' }), 'Charminar', 'hyderabad')).toBe(false);
    expect(wikiPageMatches({ ...page('Toit', 'Toit is a brewpub in Bengaluru.'), ...photo('Toit_logo.png') }, 'Toit Brewpub', 'bengaluru')).toBe(false);
    expect(wikiPageMatches({ ...page('Charminar', 'in Hyderabad'), ...photo('Charminar_map.svg') }, 'Charminar', 'hyderabad')).toBe(false);
  });
  it('picks the best-ranked matching article and credits it', () => {
    const hit = pickWikiPhoto(
      [
        { ...page('Charminar (film)', 'A film set in Hyderabad.'), index: 2 },
        { ...page('Charminar', 'A monument in Hyderabad.'), index: 1 },
      ],
      'Charminar',
      'hyderabad',
    );
    expect(hit?.credit).toContain('“Charminar”');
    expect(hit?.href).toContain('commons.wikimedia.org');
  });
});

describe('resolving a photo', () => {
  it('prefers Google, otherwise looks up Wikipedia, otherwise gives none', async () => {
    const g = await resolvePlacePhoto({ name: 'X', city: 'tokyo', photos: [{ name: 'places/a/photos/b', proxy_url: '/api/places/photo?name=places/a', attributions: [{ display_name: 'Aiko' }] }] });
    expect(g).toMatchObject({ kind: 'google', credit: 'Aiko on Google Maps' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ query: { pages: [page('Golconda Fort', 'A fortified citadel in Hyderabad, India.')] } }), { status: 200 }));
    const w = await resolvePlacePhoto({ name: 'Golconda Fort', city: 'hyderabad', photos: [{ name: 'mock_photos/hyd_golconda_1', proxy_url: 'https://images.unsplash.com/photo-1' }] });
    expect(w?.kind).toBe('wikipedia');
    expect(String(fetchMock.mock.calls[0][0])).toContain('origin=*');

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ query: { pages: [] } }), { status: 200 }));
    expect(await findWikiPhoto('Roastery Coffee House', 'hyderabad')).toBeNull();
  });
});
