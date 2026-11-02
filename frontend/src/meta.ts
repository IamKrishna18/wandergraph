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
  budgetTiers: number[];
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
