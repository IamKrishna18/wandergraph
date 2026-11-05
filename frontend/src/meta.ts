import {
  Coffee,
  Flame,
  Landmark,
  ShoppingBag,
  Sparkles,
  Trees,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import type { CityId } from './types';

export interface CityMeta {
  id: CityId;
  name: string;
  native: string;
  nativeLang: string;
  country: string;
  tagline: string;
  symbol: '₹' | '¥';
  center: [number, number];
  prompts: string[];
  /** Longer example searches that the hero types out to show the parser at work. */
  demos: string[];
  budgetTiers: number[];
  timeZone: string;
  code: string;
}

export const CITY_META: Record<CityId, CityMeta> = {
  hyderabad: {
    id: 'hyderabad',
    name: 'Hyderabad',
    native: 'హైదరాబాద్',
    nativeLang: 'te',
    country: 'India',
    tagline: 'Minarets at dawn, biryani at midnight.',
    symbol: '₹',
    center: [17.385, 78.4867],
    prompts: ['Old City heritage walk', 'Romantic lakeside evening', 'Biryani under ₹500', 'Quiet gardens in the morning'],
    budgetTiers: [0, 500, 1500],
    demos: ['peaceful parks in Uppal with my family', 'romantic cafes in Banjara Hills under ₹1000', 'biryani in the Old City tonight', 'heritage walk in Golconda this morning'],
    timeZone: 'Asia/Kolkata',
    code: 'HYD',
  },
  bengaluru: {
    id: 'bengaluru',
    name: 'Bengaluru',
    native: 'ಬೆಂಗಳೂರು',
    nativeLang: 'kn',
    country: 'India',
    tagline: 'Gardens by day, brewpubs by night.',
    symbol: '₹',
    center: [12.9716, 77.5946],
    prompts: ['Craft beer in Indiranagar', 'Filter coffee and tiffin', 'Lalbagh for a slow morning', 'Palaces with the family'],
    budgetTiers: [0, 500, 1500],
    demos: ['craft beer in Indiranagar with friends', 'quiet gardens in Jayanagar this morning', 'filter coffee in Basavanagudi under ₹300', 'palaces for a family afternoon'],
    timeZone: 'Asia/Kolkata',
    code: 'BLR',
  },
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo',
    native: '東京',
    nativeLang: 'ja',
    country: 'Japan',
    tagline: 'Shrines hiding between the neon.',
    symbol: '¥',
    center: [35.6812, 139.7671],
    prompts: ['Shrines and gardens in Shibuya', 'Night views for couples', 'Free things to do', 'Ramen and alleyway bars'],
    budgetTiers: [0, 1500, 4000],
    demos: ['shrines in Asakusa early morning', 'night views in Roppongi for couples', 'free parks in Shibuya with kids', 'ramen in Shinjuku under ¥1500'],
    timeZone: 'Asia/Tokyo',
    code: 'TYO',
  },
  kyoto: {
    id: 'kyoto',
    name: 'Kyoto',
    native: '京都',
    nativeLang: 'ja',
    country: 'Japan',
    tagline: 'A thousand gates and one quiet morning.',
    symbol: '¥',
    center: [35.0116, 135.7681],
    prompts: ['Zen temples, no crowds', 'Evening in Gion', 'Arashiyama bamboo and river', 'Family day under ¥3,000'],
    budgetTiers: [0, 1500, 4000],
    demos: ['zen temples in Higashiyama, no crowds', 'evening in Gion for two', 'bamboo walk in Arashiyama this morning', 'family day under ¥3000'],
    timeZone: 'Asia/Tokyo',
    code: 'KYO',
  },
};

export const CITY_ORDER: CityId[] = ['hyderabad', 'bengaluru', 'tokyo', 'kyoto'];

export const GROUP_ICONS: Record<string, LucideIcon> = {
  heritage: Landmark,
  spiritual: Flame,
  nature: Trees,
  food: UtensilsCrossed,
  cafe: Coffee,
  nightlife: Wine,
  shopping: ShoppingBag,
  fun: Sparkles,
};

export const GROUP_LABELS: Record<string, string> = {
  heritage: 'Heritage',
  spiritual: 'Temples & Shrines',
  nature: 'Nature & Views',
  food: 'Food',
  cafe: 'Cafes',
  nightlife: 'Nightlife',
  shopping: 'Markets & Shopping',
  fun: 'Fun & Experiences',
};

/** Plural nouns for sentences like "No parks found inside Uppal". */
export const GROUP_NOUNS: Record<string, string> = {
  heritage: 'heritage sites',
  spiritual: 'temples or shrines',
  nature: 'parks or nature spots',
  food: 'restaurants',
  cafe: 'cafes',
  nightlife: 'bars or pubs',
  shopping: 'markets or shops',
  fun: 'experiences',
};

export const COMPANIONS = [
  { id: 'couples', label: 'Couple' },
  { id: 'family', label: 'Family' },
  { id: 'friends', label: 'Friends' },
  { id: 'solo', label: 'Solo' },
] as const;

export function money(amount: number, symbol: string): string {
  return `${symbol}${Math.round(amount).toLocaleString('en-IN')}`;
}

export function typeLabel(t?: string | null): string {
  if (!t) return 'Place';
  return t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Tidy the raw graph labels ("Park Nature", "Awe_inspiring") for display. */
const NODE_LABELS: Record<string, string> = {
  'Food Drink': 'Food & drink',
  'Park Nature': 'Parks & nature',
  'Historical Monuments': 'Monuments',
  'Market Shopping': 'Markets',
  'Religious Site': 'Temples & shrines',
  'Scenic Spot': 'Scenic spots',
  'Cultural Center': 'Cultural centres',
  'Free (₹0 / ¥0)': 'Free',
  'Upscale / Premium': 'Upscale',
};
export function nodeLabel(label?: string | null): string {
  if (!label) return '';
  const l = NODE_LABELS[label] ?? label.replace(/_/g, ' ');
  return l.charAt(0).toUpperCase() + l.slice(1);
}
