export type CityId = 'hyderabad' | 'bengaluru' | 'tokyo' | 'kyoto';
export type Element = 'fire' | 'water';
export type SearchMode = 'new' | 'refine' | 'apply';

export interface CityInfo {
  id: CityId;
  name: string;
  country: string;
  currency: string;
  currency_symbol: string;
  coordinates: { latitude: number; longitude: number };
  popular_neighborhoods: string[];
}
export type CitiesMap = Record<string, CityInfo>;

export interface FilterGroup {
  id: string;
  label: string;
  icon: string;
}

export interface PriceEstimate {
  spending_range_text: string;
  admission_text: string;
  currency: string;
  estimate_type: 'listed_fee' | 'curated' | 'estimated_by_price_level' | 'typically_free' | 'unknown';
  min_spend: number | null;
  max_spend: number | null;
  is_free: boolean;
  methodology_note: string;
}

export interface PhotoAttribution {
  display_name: string;
  uri?: string | null;
  photo_uri?: string | null;
}

export interface PlacePhoto {
  name: string;
  proxy_url?: string | null;
  source: 'google' | 'wikipedia' | 'stock' | 'unknown';
  attributions: PhotoAttribution[];
}

export interface Place {
  id: string;
  name: string;
  city: CityId;
  locality?: string | null;
  formatted_address?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  primary_type?: string | null;
  types: string[];
  groups: string[];
  rating?: number | null;
  user_ratings_total?: number | null;
  price_level?: number | null;
  currency?: string | null;
  price_estimate?: PriceEstimate | null;
  opening_hours_text?: string | null;
  is_open_now?: boolean | null;
  accessibility: { wheelchair_accessible_entrance?: boolean | null; source: string };
  photos: PlacePhoto[];
  provenance: Record<string, any>;
  website_uri?: string | null;
  national_phone_number?: string | null;
  editorial_summary?: string | null;
  maps_uri?: string | null;
}

export interface Reason {
  text: string;
  source: 'curated' | 'live' | 'inferred' | 'computed';
}

export interface FitItem {
  key: string;
  label: string;
  wanted: string;
  status: 'met' | 'unmet' | 'unknown';
  detail: string;
  source?: Reason['source'] | null;
}

export interface LocalityArea {
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  source: 'google' | 'curated';
}

export interface Recommendation {
  place: Place;
  total_score: number;
  matched_reasons: string[];
  reasons: Reason[];
  unverified_attributes: string[];
  fit: FitItem[];
  explanation: string;
  match_confidence: 'high' | 'moderate' | 'potential';
  graph_node_id?: string | null;
  attribute_source?: string | null;
  distance_from_locality_km?: number | null;
  in_locality?: boolean | null;
}

export interface Preferences {
  city: CityId;
  locality?: string | null;
  category?: string | null;
  budget_max?: number | null;
  currency: string;
  companion_type?: 'couples' | 'family' | 'friends' | 'solo' | 'business' | null;
  interests: string[];
  desired_activities: string[];
  atmosphere: string[];
  indoor_outdoor?: 'indoor' | 'outdoor' | null;
  preferred_time?: 'morning' | 'afternoon' | 'evening' | 'night' | null;
  accessibility_requirements: string[];
  crowd_preference?: 'quiet' | 'busy' | null;
  search_query?: string | null;
}

export interface Interpretation {
  original_query?: string | null;
  corrected_query?: string | null;
  corrections: { from: string; to: string }[];
  detected_city?: string | null;
  detected_locality?: string | null;
  locality_candidate?: string | null;
  detected_categories: string[];
  detected_atmospheres: string[];
  detected_companion?: string | null;
  detected_budget?: number | null;
  budget_note?: string | null;
  detected_time?: string | null;
  was_corrected: boolean;
}

export interface ProviderStatus {
  provider_name: string;
  is_live: boolean;
  api_key_configured: boolean;
  status_message: string;
}

export interface SearchResponse {
  preferences: Preferences;
  results: Recommendation[];
  nearby_results: Recommendation[];
  total_found: number;
  next_page_token?: string | null;
  interpreted_criteria?: Interpretation | null;
  locality_expansion_suggested: boolean;
  locality_area?: LocalityArea | null;
  notice?: string | null;
  provider_status: ProviderStatus;
}

export interface Health {
  status: string;
  version: string;
  provider_status: ProviderStatus;
  ai_planner: boolean;
}

export interface GraphElement {
  data: { id: string; label?: string; type?: string; color?: string; source?: string; target?: string; relation?: string; properties?: Record<string, any>; provenance?: any };
}
export interface GraphData {
  nodes: GraphElement[];
  edges: GraphElement[];
  stats?: { total_nodes: number; total_edges: number; nodes_by_type: Record<string, number> };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TravelLeg {
  distance_km: number;
  minutes: number;
  mode_note: string;
}

export interface ItineraryStop {
  stop_index: number;
  slot_kind: 'sight' | 'meal' | 'evening' | 'night';
  slot_label: string;
  time_slot: string;
  start_minute: number;
  end_minute: number;
  place: Place;
  duration_minutes: number;
  visit_purpose: string;
  estimated_cost: string;
  opening_hours_note: string;
  hours_status: 'open' | 'closed' | 'unknown';
  travel_from_previous?: TravelLeg | null;
  replacement_options: { id: string; name: string; primary_type?: string | null; rating?: number | null; reason?: string | null }[];
}

export interface Itinerary {
  city: CityId;
  title: string;
  theme: string;
  date_or_day: string;
  weekday: number;
  day_shape: 'full' | 'half' | 'morning' | 'evening';
  total_estimated_spend: string;
  travel_feasibility_note: string;
  planner: 'gemini' | 'rules' | 'unknown';
  notes: string[];
  stops: ItineraryStop[];
  conversation_history: ChatMessage[];
  candidate_pool: Place[];
  preferences?: Preferences | null;
}
