import { useState } from 'react';
import { ArrowUpRight, BookMarked, CircleHelp, Network, Radio, Sigma, Sparkles, Star, Wand2, type LucideIcon } from 'lucide-react';
import { photoUrl } from '../api';
import { GROUP_ICONS, GROUP_LABELS, typeLabel } from '../meta';
import type { FitItem, Reason, Recommendation } from '../types';
import { FitChips, fitSummary } from './FitList';

const SOURCE: Record<Reason['source'], { icon: LucideIcon; title: string }> = {
  curated: { icon: BookMarked, title: "From WanderGraph's curated data" },
  live: { icon: Radio, title: 'From live Google Places data' },
  inferred: { icon: Wand2, title: 'Inferred from the place type, so treat it as a hint' },
  computed: { icon: Sigma, title: 'Computed by WanderGraph' },
};

const CONFIDENCE = {
  high: { label: 'Strong match', cls: 'border-accent/40 bg-accent/10 text-accent' },
  moderate: { label: 'Good match', cls: 'border-sand/15 bg-white/[0.04] text-sand' },
  potential: { label: 'Worth a look', cls: 'border-sand/10 bg-transparent text-sand-dim' },
};

const SEG = { met: 'bg-jal', unmet: 'bg-ember', unknown: 'bg-sand/20' };

export function compactCount(n?: number | null): string {
  if (!n) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/** A segmented bar, one segment per thing you asked for. */
export function FitMeter({ fit }: { fit: FitItem[] }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {fit.map((f) => (
        <span key={`${f.key}-${f.wanted}`} className={`h-1 flex-1 rounded-full ${SEG[f.status]}`} />
      ))}
    </div>
  );
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
  const GroupIcon = (place.groups.length && GROUP_ICONS[place.groups[0]]) || Sparkles;
  const groupLabel = place.groups.length ? GROUP_LABELS[place.groups[0]] : typeLabel(place.primary_type);
  const live = place.provenance.verification_status === 'source_returned';

  return (
    <article
      className={`spot group flex flex-col overflow-hidden rounded-xl border border-sand/10 bg-river transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-sand/25 hover:shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] ${
        feature ? 'md:col-span-2 md:flex-row' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(rec)}
        className={`relative block shrink-0 overflow-hidden bg-ink text-left ${feature ? 'aspect-[16/10] md:aspect-auto md:min-h-[320px] md:w-[52%]' : 'aspect-[16/9]'}`}
        aria-label={`Open details for ${place.name}`}
      >
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover opacity-90 transition-[transform,opacity] duration-700 group-hover:scale-[1.03] group-hover:opacity-100" />
        ) : (
          <div className="dot-bg relative flex h-full w-full items-center justify-center bg-river-2">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,106,61,0.16),transparent_55%)]" aria-hidden />
            <GroupIcon className="relative h-10 w-10 text-sand/20" strokeWidth={1.25} aria-hidden />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-river/90 to-transparent" aria-hidden />
        <span className="absolute left-3 top-3 rounded-md border border-white/10 bg-ink/70 px-1.5 py-0.5 font-mono text-[11px] text-sand backdrop-blur" aria-label={`Rank ${rank}`}>
          {String(rank).padStart(2, '0')}
        </span>
        {photo?.source === 'stock' ? (
          <span className="absolute right-3 top-3 rounded-md bg-ink/70 px-1.5 py-0.5 text-[11px] text-sand-dim backdrop-blur">Representative photo</span>
        ) : (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-ink/70 px-1.5 py-0.5 text-[11px] text-sand-dim backdrop-blur">
            {live ? <Radio className="h-3 w-3 text-jal" aria-hidden /> : <BookMarked className="h-3 w-3" aria-hidden />}
            {live ? 'Google' : 'Curated'}
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-3.5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label flex items-center gap-1.5">
              <GroupIcon className="h-3 w-3" aria-hidden /> {groupLabel}
            </p>
            <h3 className={`mt-1.5 text-sand ${feature ? 'text-2xl' : 'text-lg'}`}>
              <button type="button" onClick={() => onOpen(rec)} className="text-left transition-colors hover:text-accent">
                {place.name}
              </button>
            </h3>
            <p className="mt-0.5 text-sm text-sand-dim">
              {place.locality}
              {localityName && rec.distance_from_locality_km != null && place.locality?.toLowerCase() !== localityName.toLowerCase() && (
                <span className={rec.in_locality ? 'text-jal' : 'text-saffron'}>
                  {place.locality ? ' · ' : ''}
                  {rec.distance_from_locality_km < 0.1 ? `in ${localityName}` : `${rec.distance_from_locality_km.toFixed(1)} km from ${localityName}`}
                </span>
              )}
            </p>
          </div>
          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${conf.cls}`}>{conf.label}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {place.rating != null && (
            <span className="inline-flex items-center gap-1 text-sand">
              <Star className="h-3.5 w-3.5 fill-saffron text-saffron" aria-hidden />
              {place.rating.toFixed(1)}
              {place.user_ratings_total ? <span className="text-sand-faint">({compactCount(place.user_ratings_total)})</span> : null}
            </span>
          )}
          {place.price_estimate && (
            <span className="text-sand-dim" title={place.price_estimate.methodology_note}>
              {place.price_estimate.spending_range_text}
            </span>
          )}
          {place.is_open_now != null && <span className={place.is_open_now ? 'text-jal' : 'text-ember'}>{place.is_open_now ? 'Open now' : 'Closed now'}</span>}
        </div>

        {rec.fit.length > 0 && (
          <div className="rounded-lg border border-sand/[0.07] bg-ink/40 p-3">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-sand-dim">{fitSummary(rec.fit)}</p>
            </div>
            <FitMeter fit={rec.fit} />
            <div className="mt-3">
              <FitChips fit={rec.fit} max={feature ? 6 : 3} />
            </div>
          </div>
        )}
        {rec.fit.length === 0 && rec.reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Why it matches">
            {rec.reasons.map((r) => {
              const S = SOURCE[r.source];
              return (
                <li key={r.text} title={S.title} className="inline-flex items-center gap-1 rounded-md border border-sand/[0.07] bg-ink/40 px-2 py-1 text-xs text-sand">
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

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-sand/[0.07] pt-3">
          <span className="truncate text-[11px] text-sand-faint" title={credit}>
            {credit ? `Photo: ${credit}` : ''}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {rec.graph_node_id && (
              <button type="button" onClick={() => onGraph(rec.graph_node_id!)} className="rounded-md p-1.5 text-sand-faint transition-colors hover:bg-white/5 hover:text-sand" aria-label={`Show ${place.name} in the graph`} title="Show in the graph">
                <Network className="h-4 w-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => onOpen(rec)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sand transition-colors hover:bg-white/5">
              Details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-sand/10 bg-river" aria-hidden>
      <div className="skeleton aspect-[16/9]" />
      <div className="space-y-3 p-5">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-5 w-3/4 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
        <div className="skeleton mt-4 h-16 w-full rounded-lg" />
      </div>
    </div>
  );
}
