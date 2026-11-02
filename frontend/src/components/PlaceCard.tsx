import { useState } from 'react';
import { BookMarked, CircleHelp, Network, Radio, Sigma, Star, Wand2, type LucideIcon } from 'lucide-react';
import { photoUrl } from '../api';
import { GROUP_ICONS, GROUP_LABELS, typeLabel } from '../meta';
import type { Reason, Recommendation } from '../types';
import { FitChips, fitSummary } from './FitList';

const SOURCE: Record<Reason['source'], { icon: LucideIcon; title: string }> = {
  curated: { icon: BookMarked, title: "From WanderGraph's curated data" },
  live: { icon: Radio, title: 'From live Google Places data' },
  inferred: { icon: Wand2, title: 'Inferred from the place type, so treat it as a hint' },
  computed: { icon: Sigma, title: 'Computed by WanderGraph' },
};

const CONFIDENCE = {
  high: { label: 'Strong match', cls: 'bg-accent text-ink' },
  moderate: { label: 'Good match', cls: 'bg-sand/15 text-sand' },
  potential: { label: 'Worth a look', cls: 'bg-sand/10 text-sand-dim' },
};

export function compactCount(n?: number | null): string {
  if (!n) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

interface Props {
  rec: Recommendation;
  rank: number;
  feature?: boolean;
  localityName?: string | null;
  onOpen: (rec: Recommendation) => void;
  onGraph: (nodeId: string) => void;
}

export function PlaceCard({ rec, rank, feature = false, localityName, onOpen, onGraph }: Props) {
  const { place } = rec;
  const [broken, setBroken] = useState(false);
  const photo = place.photos[0];
  const src = photoUrl(photo?.proxy_url);
  const credit = photo?.attributions[0]?.display_name;
  const conf = CONFIDENCE[rec.match_confidence];
  const GroupIcon = place.groups.length ? GROUP_ICONS[place.groups[0]] : undefined;
  const groupLabel = place.groups.length ? GROUP_LABELS[place.groups[0]] : typeLabel(place.primary_type);

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-[22px] border border-sand/10 bg-river transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/50 ${
        feature ? 'md:col-span-2 md:flex-row' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(rec)}
        className={`duotone relative block shrink-0 overflow-hidden text-left ${feature ? 'aspect-[16/10] md:aspect-auto md:w-[56%]' : 'aspect-[16/10]'}`}
        aria-label={`Open details for ${place.name}`}
      >
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
        ) : (
          <div className="relative flex h-full min-h-[180px] w-full items-end overflow-hidden bg-gradient-to-br from-river-3 via-river-2 to-ink">
            <div className="rays absolute inset-[-40%] opacity-70" aria-hidden />
            <div className="absolute -bottom-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-accent/40 blur-2xl" aria-hidden />
            {GroupIcon && <GroupIcon className="absolute right-5 top-12 h-16 w-16 text-sand/15" aria-hidden />}
            <span className="relative px-5 pb-4 font-display text-6xl leading-none text-sand/25">{place.name.slice(0, 1)}</span>
          </div>
        )}
        <span className="absolute left-3 top-3 z-10 font-display text-3xl text-sand drop-shadow" aria-label={`Rank ${rank}`}>
          {rank}
        </span>
        {photo?.source === 'stock' && (
          <span className="absolute right-3 top-3 z-10 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] text-sand-dim">Representative photo</span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-accent">{groupLabel}</p>
            <h3 className={`font-display text-sand ${feature ? 'text-3xl' : 'text-2xl'}`}>
              <button type="button" onClick={() => onOpen(rec)} className="text-left hover:text-accent">
                {place.name}
              </button>
            </h3>
            <p className="text-sm text-sand-dim">
              {place.locality}
              {localityName && rec.distance_from_locality_km != null && place.locality?.toLowerCase() !== localityName.toLowerCase() && (
                <span className={rec.in_locality ? 'text-jal' : 'text-saffron'}>
                  {place.locality ? ', ' : ''}
                  {rec.distance_from_locality_km < 0.1 ? `in ${localityName}` : `${rec.distance_from_locality_km.toFixed(1)} km from ${localityName}`}
                </span>
              )}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${conf.cls}`}>{conf.label}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {place.rating != null && (
            <span className="inline-flex items-center gap-1 text-sand">
              <Star className="h-4 w-4 fill-saffron text-saffron" aria-hidden />
              {place.rating.toFixed(1)}
              {place.user_ratings_total ? <span className="text-sand-faint">({compactCount(place.user_ratings_total)})</span> : null}
            </span>
          )}
          {place.price_estimate && (
            <span className="text-sand-dim" title={place.price_estimate.methodology_note}>
              {place.price_estimate.spending_range_text}
            </span>
          )}
          {place.is_open_now != null && (
            <span className={place.is_open_now ? 'text-jal' : 'text-ember'}>{place.is_open_now ? 'Open now' : 'Closed now'}</span>
          )}
        </div>

        {rec.fit.length > 0 && (
          <div className="rounded-xl bg-ink/50 p-3">
            <p className="mb-2 text-xs font-semibold text-sand-dim">{fitSummary(rec.fit)}</p>
            <FitChips fit={rec.fit} max={feature ? 6 : 4} />
          </div>
        )}
        {rec.fit.length === 0 && rec.reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Why it matches">
            {rec.reasons.map((r) => {
              const S = SOURCE[r.source];
              return (
                <li key={r.text} title={S.title} className="inline-flex items-center gap-1 rounded-md bg-ink/60 px-2 py-1 text-sm text-sand">
                  <S.icon className="h-3 w-3 text-accent" aria-hidden />
                  {r.text}
                  <span className="sr-only">({S.title})</span>
                </li>
              );
            })}
          </ul>
        )}
        {rec.fit.length === 0 && rec.unverified_attributes.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-sand-faint">
            <CircleHelp className="h-3.5 w-3.5" aria-hidden /> Not confirmed: {rec.unverified_attributes.join(', ').toLowerCase()}
          </p>
        )}
        {feature && place.formatted_address && <p className="text-sm text-sand-faint">{place.formatted_address}</p>}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="truncate text-[11px] text-sand-faint" title={credit}>
            {credit ? `Photo: ${credit}` : ''}
          </span>
          <div className="flex shrink-0 gap-2">
            {rec.graph_node_id && (
              <button type="button" onClick={() => onGraph(rec.graph_node_id!)} className="btn-ghost px-3 py-1 text-xs" aria-label={`Show ${place.name} in the graph`}>
                <Network className="h-3.5 w-3.5" aria-hidden /> Graph
              </button>
            )}
            <button type="button" onClick={() => onOpen(rec)} className="btn-ghost px-3 py-1 text-xs">
              Details
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-sand/10 bg-river" aria-hidden>
      <div className="skeleton aspect-[16/10]" />
      <div className="space-y-3 p-5">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-6 w-3/4 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}
