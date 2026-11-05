import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiBase, photoUrl } from '../src/api';
import { constraintChips, Understanding } from '../src/components/Controls';
import { PlaceCard } from '../src/components/PlaceCard';
import { Planner } from '../src/components/Planner';
import { place, prefs, rec } from './fixtures';
import recorded from './api-recorded.json';

// Leaflet needs a real layout engine; the map itself is checked in the browser run.
vi.mock('../src/components/MapView', () => ({ MapView: () => <div data-testid="map" /> }));

afterEach(() => vi.restoreAllMocks());

describe('api helpers', () => {
  it('resolves the API base URL', () => {
    expect(resolveApiBase(undefined)).toBe('/api');
    expect(resolveApiBase('wandergraph.onrender.com')).toBe('https://wandergraph.onrender.com/api');
    expect(resolveApiBase('https://x.dev/api/')).toBe('https://x.dev/api');
  });
  it('keeps absolute photo URLs and maps API-relative ones', () => {
    expect(photoUrl('https://upload.wikimedia.org/a.jpg')).toBe('https://upload.wikimedia.org/a.jpg');
    expect(photoUrl('/api/places/photo?name=x')).toBe('/api/places/photo?name=x');
  });
});

describe('constraint chips', () => {
  it('builds a removable chip for each active constraint, in local currency', () => {
    const chips = constraintChips(prefs({ city: 'kyoto', currency: 'JPY', locality: 'Gion', budget_max: 3000, companion_type: 'couples', atmosphere: ['peaceful'] }));
    const labels = chips.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['Gion', 'With couples', 'Up to ¥3,000 each', 'Peaceful']));
    expect(chips.find((c) => c.key === 'budget')!.patch).toEqual({ budget_max: null });
  });
  it('removes a chip through onPatch', () => {
    const onPatch = vi.fn();
    render(<Understanding interpretation={null} prefs={prefs({ budget_max: 0 })} onPatch={onPatch} onReset={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Free only' }));
    expect(onPatch).toHaveBeenCalledWith({ budget_max: null });
  });
  it('shows typo corrections', () => {
    render(
      <Understanding
        interpretation={{ corrections: [{ from: 'hydrabad', to: 'Hyderabad' }], detected_categories: [], detected_atmospheres: [], was_corrected: true }}
        prefs={prefs()}
        onPatch={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(screen.getByText('Hyderabad')).toBeInTheDocument();
    expect(screen.getByText('hydrabad')).toBeInTheDocument();
  });
});

describe('PlaceCard', () => {
  it('shows how it fits the search, with the price', () => {
    render(<PlaceCard rec={rec()} rank={1} onOpen={() => undefined} onGraph={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Charminar' })).toBeInTheDocument();
    expect(screen.getByText('Entry ₹25')).toBeInTheDocument();
    expect(screen.getByText('Matches 2 of 2')).toBeInTheDocument();
    expect(screen.getByText(': Suits family')).toBeInTheDocument();
    expect(screen.queryByText('Open now')).not.toBeInTheDocument(); // curated data never claims open now
  });
  it('only offers the graph when the place is in it', () => {
    const onGraph = vi.fn();
    const { rerender } = render(<PlaceCard rec={rec()} rank={1} onOpen={() => undefined} onGraph={onGraph} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Charminar in the graph' }));
    expect(onGraph).toHaveBeenCalledWith('place:hyd_charminar');
    rerender(<PlaceCard rec={rec({ graph_node_id: null })} rank={1} onOpen={() => undefined} onGraph={onGraph} />);
    expect(screen.queryByRole('button', { name: 'Show Charminar in the graph' })).not.toBeInTheDocument();
  });
  it('never shows a category stock photo, and labels inferred reasons honestly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ query: { pages: [] } }), { status: 200 }));
    const r = rec({
      place: place({ name: 'Somewhere Unlisted', photos: [{ name: 'mock_photos/x_1', proxy_url: 'https://images.unsplash.com/x', source: 'stock', attributions: [{ display_name: 'A / Unsplash' }] }] }),
      reasons: [{ text: 'Good for friends', source: 'inferred' }],
      fit: [],
    });
    render(<PlaceCard rec={r} rank={2} onOpen={() => undefined} onGraph={() => undefined} />);
    expect(await screen.findByText('No photo of this place yet')).toBeInTheDocument();
    expect(document.querySelector('img[src*="unsplash"]')).toBeNull();
    expect(screen.getByText(/Inferred from the place type/)).toBeInTheDocument();
  });
});

describe('Locality results', () => {
  it('shows distance from the searched area and unmet location honestly', () => {
    const r = rec({
      distance_from_locality_km: 3.4,
      in_locality: false,
      fit: [{ key: 'location', label: 'Location', wanted: 'Uppal', status: 'unmet', detail: '3.4 km from Uppal', source: 'computed' }],
    });
    render(<PlaceCard rec={r} rank={1} localityName="Uppal" onOpen={() => undefined} onGraph={() => undefined} />);
    expect(screen.getByText(/3\.4 km from Uppal/, { selector: 'span.text-saffron' })).toBeInTheDocument();
    expect(screen.getByText('Matches 0 of 1')).toBeInTheDocument();
    expect(screen.getByText('No:')).toBeInTheDocument();
  });
});

describe('Planner', () => {
  it('sends a starter to the itinerary endpoint and shows checked hours and notes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify((recorded as any).itinerary), { status: 200 }));
    render(<Planner open city="hyderabad" sessionId="wg-test" onClose={() => undefined} onOpenPlace={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'A full day of Nizami heritage' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Stops in visiting order' })).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/itinerary\/message$/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ session_id: 'wg-test', message: 'A full day of Nizami heritage', city: 'hyderabad' });
    expect(screen.queryByText(/Verified open now/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/isn't a food place/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /Swap this stop/ })[0]);
    expect(screen.getByLabelText('Describe a replacement')).toBeInTheDocument();
  });

  it('explains when the server lost the plan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: 'No active itinerary found for session x' }), { status: 400 }));
    render(<Planner open city="kyoto" sessionId="wg-test" onClose={() => undefined} onOpenPlace={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Describe your day'), { target: { value: 'evening in gion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText(/no longer has this plan/)).toBeInTheDocument());
  });
});
