import type { Itinerary, Place, Preferences, Recommendation, SearchResponse } from '../src/types';

export const prefs = (over: Partial<Preferences> = {}): Preferences => ({
  city: 'hyderabad',
  currency: 'INR',
  interests: [],
  desired_activities: [],
  atmosphere: [],
  accessibility_requirements: [],
  ...over,
});

export const place = (over: Partial<Place> = {}): Place => ({
  id: 'hyd_charminar',
  name: 'Charminar',
  city: 'hyderabad',
  locality: 'Old City',
  formatted_address: 'Charminar Rd, Hyderabad',
  coordinates: { latitude: 17.36, longitude: 78.47 },
  primary_type: 'tourist_attraction',
  types: ['tourist_attraction'],
  groups: ['heritage'],
  rating: 4.5,
  user_ratings_total: 142000,
  price_estimate: {
    spending_range_text: 'Entry ₹25',
    admission_text: '₹25',
    currency: 'INR',
    estimate_type: 'listed_fee',
    min_spend: 25,
    max_spend: 25,
    is_free: false,
    methodology_note: 'Curated fee',
  },
  opening_hours_text: '09:30 - 17:30 daily',
  is_open_now: null,
  accessibility: { wheelchair_accessible_entrance: false, source: 'curated' },
  photos: [],
  provenance: { verification_status: 'curated' },
  ...over,
});

export const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  place: place(),
  total_score: 10,
  matched_reasons: ['Good for family', 'Heritage'],
  reasons: [
    { text: 'Good for family', source: 'curated' },
    { text: 'Heritage', source: 'computed' },
  ],
  unverified_attributes: [],
  fit: [
    { key: 'company', label: "Who's coming", wanted: 'Family', status: 'met', detail: 'Suits family', source: 'curated' },
    { key: 'interest', label: 'Type of place', wanted: 'Heritage', status: 'met', detail: 'Heritage', source: 'curated' },
  ],
  explanation: "Why it's here: Good for family; Heritage.",
  match_confidence: 'moderate',
  graph_node_id: 'place:hyd_charminar',
  attribute_source: 'curated',
  ...over,
});

export const searchResponse = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  preferences: prefs(),
  results: [rec(), rec({ place: place({ id: 'hyd_golconda_fort', name: 'Golconda Fort' }), graph_node_id: null })],
  nearby_results: [],
  total_found: 2,
  next_page_token: null,
  interpreted_criteria: null,
  locality_expansion_suggested: false,
  notice: null,
  provider_status: { provider_name: 'Curated', is_live: false, api_key_configured: false, status_message: '' },
  ...over,
});

export const itinerary = (): Itinerary => ({
  city: 'hyderabad',
  title: 'Full-day Hyderabad',
  theme: 'Heritage',
  date_or_day: 'Today (Monday)',
  weekday: 1,
  day_shape: 'full',
  total_estimated_spend: '₹75 – ₹75 per person',
  travel_feasibility_note: '1 hop, about 9.0 km in total.',
  planner: 'rules',
  notes: ['Skipped lunch: nothing fits.'],
  stops: [
    {
      stop_index: 0, slot_kind: 'sight', slot_label: 'Morning', time_slot: '09:30 – 11:30', start_minute: 570, end_minute: 690,
      place: place(), duration_minutes: 120, visit_purpose: 'Explore the history and architecture', estimated_cost: 'Entry ₹25',
      opening_hours_note: 'Open 09:30–17:30 on Monday', hours_status: 'open', travel_from_previous: null,
      replacement_options: [{ id: 'hyd_golconda_fort', name: 'Golconda Fort', rating: 4.6, reason: '9.0 km from previous stop' }],
    },
  ],
  conversation_history: [
    { role: 'user', content: 'heritage day' },
    { role: 'assistant', content: "Here's a full-day plan." },
  ],
  candidate_pool: [],
  preferences: prefs(),
});
