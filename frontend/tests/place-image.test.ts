import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreName, findWikiPhoto, isGooglePhoto, isStockPhoto, pickCommonsPhoto, pickWikiPhoto, resolvePlacePhoto, wikiPageMatches } from '../src/placeImage';

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
  const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });

  it('uses a Google photo already on the result', async () => {
    const g = await resolvePlacePhoto({ name: 'X', city: 'tokyo', photos: [{ name: 'places/a/photos/b', proxy_url: '/api/places/photo?name=places/a', attributions: [{ display_name: 'Aiko' }] }] });
    expect(g).toMatchObject({ kind: 'google', credit: 'Aiko on Google Maps' });
  });

  it('asks the backend to find the place on Google before trying Wikipedia', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
      String(u).includes('/places/photo-lookup')
        ? json({ photos: [{ name: 'places/q/photos/1', proxy_url: '/api/places/photo?name=places/q/photos/1', attributions: [{ display_name: 'Meera' }] }], source: 'google', reason: 'ok' })
        : json({ query: { pages: [] } }),
    );
    const p = await resolvePlacePhoto({ name: 'Qutb Shahi Tombs', city: 'hyderabad', coordinates: { latitude: 17.39, longitude: 78.39 }, photos: [{ name: 'mock_photos/q_1', proxy_url: 'https://images.unsplash.com/photo-1' }] });
    expect(p).toMatchObject({ kind: 'google', credit: 'Meera on Google Maps' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/places/photo-lookup?name=Qutb+Shahi+Tombs&city=hyderabad&lat=17.39&lng=78.39');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('wikipedia'))).toBe(false);
  });

  it('falls back to Wikipedia, then nothing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
      String(u).includes('/places/photo-lookup')
        ? json({ photos: [], source: null, reason: 'no_api_key' })
        : json({ query: { pages: [page('Golconda Fort', 'A fortified citadel in Hyderabad, India.')] } }),
    );
    const w = await resolvePlacePhoto({ name: 'Golconda Fort', city: 'hyderabad', photos: [{ name: 'mock_photos/hyd_golconda_1', proxy_url: 'https://images.unsplash.com/photo-1' }] });
    expect(w?.kind).toBe('wikipedia');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('origin=*'))).toBe(true);

    fetchMock.mockImplementation(async () => json({ query: { pages: [] } }));
    expect(await findWikiPhoto('Roastery Coffee House', 'hyderabad')).toBeNull();
  });
});

describe('geotagged Commons photos', () => {
  const file = (title: string, mime = 'image/jpeg', index = 1) => ({ title, index, imageinfo: [{ thumburl: `https://upload.wikimedia.org/x/${encodeURIComponent(title)}`, mime, descriptionurl: 'https://commons.wikimedia.org/wiki/x' }] });
  it('keeps nearby photos whose file name names the place', () => {
    expect(pickCommonsPhoto([file('File:Street scene 2019.jpg', 'image/jpeg', 1), file('File:Cafe Niloufer, Lakdikapul.jpg', 'image/jpeg', 2)], 'Cafe Niloufer Himayatnagar', 'hyderabad')?.src).toContain('Niloufer');
  });
  it('ignores unrelated, logo and map files', () => {
    expect(pickCommonsPhoto([file('File:Hyderabad street.jpg')], 'Bawarchi Restaurant', 'hyderabad')).toBeNull();
    expect(pickCommonsPhoto([file('File:Bawarchi logo.png', 'image/png')], 'Bawarchi Restaurant', 'hyderabad')).toBeNull();
    expect(pickCommonsPhoto([file('File:Bawarchi.svg', 'image/svg+xml')], 'Bawarchi Restaurant', 'hyderabad')).toBeNull();
  });
});

describe('long official names', () => {
  it('matches "ISKCON Hyderabad" for a long temple name, but not a loose article', () => {
    expect(wikiPageMatches(page('ISKCON Hyderabad', 'ISKCON Hyderabad is a temple in Abids, Hyderabad.'), 'ISKCON-Sri Sri Radha Madanmohan Mandir', 'hyderabad')).toBe(true);
    expect(wikiPageMatches(page('Paradise Food Court', 'A food court in Secunderabad.'), 'Paradise Biryani (Original)', 'hyderabad')).toBe(false);
  });
  it('accepts a one-word Commons match only for a photo taken right there', () => {
    const f = (dist: number) => ({ title: 'File:Niloufer cafe front.jpg', index: 1, coordinates: [{ dist }], imageinfo: [{ thumburl: 'https://upload.wikimedia.org/n.jpg', mime: 'image/jpeg' }] });
    expect(pickCommonsPhoto([f(60)], 'Cafe Niloufer Himayatnagar Branch Office', 'hyderabad')).not.toBeNull();
    expect(pickCommonsPhoto([f(390)], 'Cafe Niloufer Himayatnagar Branch Office', 'hyderabad')).toBeNull();
  });
});

describe('OpenStreetMap places', () => {
  it('uses the photo tagged on the map object before anything else', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const p = await resolvePlacePhoto({ name: 'Charminar', city: 'hyderabad', photos: [{ name: 'osm-photo:File:Charminar.jpg', proxy_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Charminar.jpg?width=900', attributions: [{ display_name: 'Wikimedia Commons', uri: 'https://commons.wikimedia.org/wiki/File:Charminar.jpg' }] }] });
    expect(p).toMatchObject({ kind: 'wikipedia', src: expect.stringContaining('Special:FilePath/Charminar.jpg') });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses the exact Wikipedia article the map names', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) =>
      String(u).includes('rest_v1/page/summary/Salar_Jung_Museum')
        ? new Response(JSON.stringify({ title: 'Salar Jung Museum', thumbnail: { source: 'https://upload.wikimedia.org/x/thumb/a/b/S.jpg/320px-S.jpg' }, originalimage: { source: 'https://upload.wikimedia.org/x/a/b/S.jpg', width: 4000 }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Salar_Jung_Museum' } } }), { status: 200 })
        : new Response(JSON.stringify({ photos: [], reason: 'no_api_key' }), { status: 200 }),
    );
    const p = await resolvePlacePhoto({ name: 'Salar Jung Museum', city: 'hyderabad', wikipedia: 'en:Salar Jung Museum' });
    expect(p?.src).toBe('https://upload.wikimedia.org/x/thumb/a/b/S.jpg/900px-S.jpg');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('en.wikipedia.org/api/rest_v1'))).toBe(true);
  });
});
