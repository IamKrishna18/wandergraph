import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import recorded from './api-recorded.json';

vi.mock('../src/components/MapView', () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock('../src/components/GraphExplorer', () => ({ GraphExplorer: () => null }));

import App from '../src/App';

const R = recorded as any;
let calls: { method: string; url: string; body: any }[] = [];

function searchReply(body: any) {
  if (body.query.includes('kyoto')) return body.city === 'kyoto' ? R.kyoto : R.kyoto_redirect;
  if (body.query.includes('uppal')) return R.uppal;
  if (body.locality === '') return R.parks_city;
  if (body.query.includes('banjara')) return R.banjara;
  return R.parks_city;
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const ok = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (url.endsWith('/search')) return ok(searchReply(body));
    if (url.includes('/preferences')) return ok({ session_id: 's', preferences: R.parks_city.preferences });
    return new Response('{}', { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

const searchCalls = () => calls.filter((c) => c.url.endsWith('/search'));

describe('App against the current backend API', () => {
  it('starts each new search clean (reset, then search)', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/), { target: { value: 'romantic places in banjara hills' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: 'Roastery Coffee House' });
    const i = calls.findIndex((c) => c.body?.query === 'romantic places in banjara hills');
    expect(calls[i - 1]).toMatchObject({ method: 'DELETE' });
    expect(calls[i - 1].url).toMatch(/\/preferences\/wg-[a-z0-9]+$/);
    expect(calls[i].body.session_id).toMatch(/^wg-/);
  });

  it('follows a city named in the text', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/), { target: { value: 'temples in kyoto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Search Kyoto/ })).toBeInTheDocument());
    const kyoto = searchCalls().filter((c) => c.body.query === 'temple in kyoto');
    expect(kyoto.map((c) => c.body.city)).toEqual(['hyderabad', 'kyoto']);
  });

  it('shows an honest empty state plus places elsewhere for an area with no matches', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/), { target: { value: 'peaceful parks in uppal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No parks or nature spots found inside Uppal');
    await screen.findByRole('heading', { name: 'Elsewhere in Hyderabad' });
    const wide = searchCalls().find((c) => c.body.locality === '');
    expect(wide?.body.query).toBe('peaceful park');
    // the area is put back on the session afterwards
    expect(calls.some((c) => c.url.endsWith('/preferences/update') && c.body.direct_updates?.locality === 'Uppal')).toBe(true);
  });

  it('removing a chip deletes it on the server and drops its words from the query', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    fireEvent.change(screen.getByLabelText(/Describe what you want to do/), { target: { value: 'romantic places in banjara hills' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('heading', { name: 'Roastery Coffee House' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Romantic' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/field/atmosphere'))).toBe(true));
    // the main search (the wider look-around afterwards sends locality: '')
    await waitFor(() => expect(searchCalls().filter((c) => c.body.locality !== '').at(-1)?.body.query).toBe('places in banjara hills'));
  });

  it('category buttons add the category words to the search', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    const group = screen.getByRole('group', { name: 'Category' });
    fireEvent.click(within(group).getByRole('button', { name: /Nature & Views/ }));
    await waitFor(() => expect(searchCalls().at(-1)?.body.query).toBe('park garden'));
  });

  it('refine updates the session and searches with both texts', async () => {
    render(<App />);
    await waitFor(() => expect(searchCalls().length).toBe(1));
    fireEvent.change(screen.getByLabelText('Refine these results'), { target: { value: 'for my family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/preferences/update') && c.body.user_message === 'for my family')).toBe(true));
    await waitFor(() => expect(searchCalls().at(-1)?.body.query).toBe('for my family'));
  });
});
