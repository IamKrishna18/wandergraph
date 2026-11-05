/**
 * Client for the WanderGraph backend API (unchanged v1 endpoints).
 * `adapter.ts` turns these raw responses into what the UI shows.
 */
import type { CitiesMap, GraphData, Health } from './types';

export function resolveApiBase(envUrl: string | undefined = import.meta.env.VITE_API_BASE_URL): string {
  if (!envUrl || envUrl.trim() === '') return '/api';
  let clean = envUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(clean) && !clean.startsWith('/')) clean = `https://${clean}`;
  return clean.endsWith('/api') ? clean : `${clean}/api`;
}

const API_BASE = resolveApiBase();

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers || {}) } : init?.headers,
    });
  } catch {
    throw new ApiError("Can't reach the WanderGraph server. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === 'string' ? body.detail : undefined;
    if (res.status === 429) throw new ApiError(detail || 'Too many requests. Wait a minute and try again.', 429);
    if (res.status >= 500) throw new ApiError('The server ran into a problem. Try again in a moment.', res.status);
    throw new ApiError(detail || `Request failed (${res.status}).`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Photo URLs are absolute (Wikipedia, Unsplash) or relative to the API (/api/places/photo…). */
export function photoUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/')) return `${API_BASE}${url.slice(4)}`;
  return url;
}

/* ---------- raw backend shapes (only the fields the UI uses) ---------- */

export interface RawPreferences {
  session_id: string;
  city: string;
  locality?: string | null;
  budget_max?: number | null;
  currency: string;
  companion_type?: string | null;
  interests: string[];
  desired_activities: string[];
  atmosphere: string[];
  indoor_outdoor?: string | null;
  preferred_time?: string | null;
  accessibility_requirements: string[];
}

export interface RawPlace {
  id: string;
  name: string;
  city: string;
  locality?: string | null;
  formatted_address?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  primary_type?: string | null;
  types: string[];
  rating?: number | null;
  user_ratings_total?: number | null;
  price_level?: number | null;
  approx_cost?: number | null;
  currency?: string | null;
  price_estimate?: {
    spending_range_text: string;
    admission_text: string;
    currency: string;
    estimate_type: string;
    min_spend: number | null;
    max_spend: number | null;
    is_free: boolean;
    methodology_note: string;
  } | null;
  opening_hours_text?: string | null;
  is_open_now?: boolean | null;
  photos: { name: string; proxy_url?: string | null; attributions: { display_name: string; uri?: string | null; photo_uri?: string | null }[] }[];
  provenance: Record<string, any>;
  website_uri?: string | null;
  national_phone_number?: string | null;
  editorial_summary?: string | null;
}

export interface RawRecommendation {
  place: RawPlace;
  total_score: number;
  matched_reasons: string[];
  unverified_attributes: string[];
  explanation: string;
  match_confidence: 'high' | 'moderate' | 'potential';
}

export interface RawInterpretation {
  original_query?: string | null;
  detected_city?: string | null;
  detected_locality?: string | null;
  detected_category?: string | null;
  detected_atmospheres: string[];
  detected_companion?: string | null;
  detected_budget?: number | null;
  was_corrected: boolean;
}

export interface RawSearchResponse {
  session_id: string;
  preferences: RawPreferences;
  results: RawRecommendation[];
  total_found: number;
  next_page_token?: string | null;
  interpreted_criteria?: RawInterpretation | null;
  locality_expansion_suggested: boolean;
  provider_status: Health['provider_status'];
}

export interface RawItinerary {
  session_id: string;
  city: string;
  title: string;
  theme: string;
  date_or_day: string;
  total_estimated_spend: string;
  travel_feasibility_note: string;
  stops: {
    stop_index: number;
    time_slot: string;
    place: RawPlace;
    duration_minutes: number;
    visit_purpose: string;
    estimated_cost: string;
    opening_hours_note: string;
    replacement_options: { id: string; name: string; primary_type?: string | null; rating?: number | null }[];
  }[];
  conversation_history: { role: string; content: string }[];
}

export interface RawSearchRequest {
  query: string;
  session_id: string;
  city: string;
  locality?: string | null;
  category?: string | null;
  limit?: number;
  page_token?: string | null;
}

export const api = {
  health: () => request<Omit<Health, 'ai_planner'>>('/health').then((h) => ({ ...h, ai_planner: false }) as Health),
  cities: () => request<CitiesMap>('/cities'),
  search: (body: RawSearchRequest) => request<RawSearchResponse>('/search', { method: 'POST', body: JSON.stringify(body) }),
  updatePreferences: (sessionId: string, update: { user_message?: string; direct_updates?: Record<string, unknown> }) =>
    request<{ preferences: RawPreferences }>('/preferences/update', { method: 'POST', body: JSON.stringify({ session_id: sessionId, ...update }) }),
  resetPreferences: (sessionId: string) => request<{ preferences: RawPreferences }>(`/preferences/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  removePreference: (sessionId: string, field: string) =>
    request<{ preferences: RawPreferences }>(`/preferences/${encodeURIComponent(sessionId)}/field/${encodeURIComponent(field)}`, { method: 'DELETE' }),
  place: (id: string) => request<{ place: RawPlace; graph_connections: Record<string, any> }>(`/places/${encodeURIComponent(id)}`),
  photoLookup: (name: string, city: string, lat?: number | null, lng?: number | null) => {
    const q = new URLSearchParams({ name, city });
    if (lat != null && lng != null) {
      q.set('lat', String(lat));
      q.set('lng', String(lng));
    }
    return request<{ photos: RawPlace['photos']; source: string | null; reason: string }>(`/places/photo-lookup?${q}`);
  },
  graph: (city: string) => request<GraphData>(`/graph?city=${encodeURIComponent(city)}`),
  graphNode: (nodeId: string, depth = 1) => request<GraphData>(`/graph/node/${encodeURIComponent(nodeId)}?depth=${depth}`),
  itineraryMessage: (sessionId: string, message: string, city: string) =>
    request<RawItinerary>('/itinerary/message', { method: 'POST', body: JSON.stringify({ session_id: sessionId, message, city }) }),
  replaceStop: (sessionId: string, stopIndex: number, replacementPlaceId?: string, preferenceNote?: string) =>
    request<RawItinerary>('/itinerary/replace-stop', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, stop_index: stopIndex, replacement_place_id: replacementPlaceId, preference_note: preferenceNote }),
    }),
  resetItinerary: (sessionId: string) => request<unknown>(`/itinerary/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
};
