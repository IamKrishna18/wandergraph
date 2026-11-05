import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Accessibility, Clock, Coins, ExternalLink, Globe, MapPin, Network, Phone, ShieldCheck, Star, X } from 'lucide-react';
import { api } from '../api';
import { useRelevantPhoto } from '../placeImage';
import { toPlace } from '../adapter';
import { GROUP_LABELS } from '../meta';
import { useEscape } from '../hooks';
import type { CityId, Place, Recommendation } from '../types';
import { FitTable, fitSummary } from './FitList';
import { compactCount } from './PlaceCard';

const PROVENANCE: Record<string, string> = {
  source_returned: 'Live from Google Places',
  curated: 'Hand-curated by WanderGraph, not independently verified',
  derived: 'Computed by WanderGraph',
  inferred: 'Inferred from the place type',
};

interface Props {
  placeId: string | null;
  match?: Recommendation | null;
  localityName?: string | null;
  city: CityId;
  onClose: () => void;
  onOpen: (id: string) => void;
  onGraph: (nodeId: string) => void;
}

export function PlaceDrawer({ placeId, match, localityName, city, onClose, onOpen, onGraph }: Props) {
  const [data, setData] = useState<{ place: Place; graph_connections: Record<string, any> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const matchRef = useRef(match);
  matchRef.current = match;
  const close = useCallback(() => onClose(), [onClose]);
  useEscape(Boolean(placeId), close);

  useEffect(() => {
    if (!placeId) return;
    let live = true;
    setData(null);
    setError(null);
    setPartial(false);
    api
      .place(placeId)
      .then((d) => {
        if (!live) return;
        const fromSearch = matchRef.current?.place.id === placeId ? matchRef.current.place : null;
        const place = toPlace(d.place, city);
        // Google's details call leaves out a few things the search result has
        if (fromSearch) {
          place.locality ??= fromSearch.locality;
          if (!place.photos.length) place.photos = fromSearch.photos;
          place.is_open_now ??= fromSearch.is_open_now;
        }
        const gc = d.graph_connections ?? {};
        setData({ place, graph_connections: { ...gc, graph_node_id: place.id.startsWith('gplaces:') ? null : `place:${place.id}` } });
      })
      .catch((e) => {
        if (!live) return;
        // Google can refuse the details call (quota, outage); the search result still has the essentials
        const fromSearch = matchRef.current?.place.id === placeId ? matchRef.current.place : null;
        if (fromSearch) {
          setData({ place: fromSearch, graph_connections: { graph_node_id: fromSearch.id.startsWith('gplaces:') ? null : `place:${fromSearch.id}` } });
          setPartial(true);
        } else setError((e as Error).message.startsWith('Live details') ? (e as Error).message : "Couldn't load this place right now. Please try again in a moment.");
      });
    return () => {
      live = false;
    };
  }, [placeId, city]);

  // only a photo of this exact place: Google's own, or a matching Wikipedia photo
  const [photo, photoBroken] = useRelevantPhoto(data?.place && placeId ? { name: data.place.name, city: data.place.city, photos: data.place.photos, coordinates: data.place.coordinates } : null);

  if (!placeId) return null;
  const p = data?.place;
  const g = data?.graph_connections ?? {};
  const hours = p?.opening_hours_text?.split(/;\s*/).filter(Boolean) ?? [];
  const wheel = p?.accessibility.wheelchair_accessible_entrance;
  const attrSource = g.attribute_source === 'inferred' ? 'Inferred from the place type' : g.attribute_source ? 'From the curated knowledge graph' : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={p ? p.name : 'Place details'}>
      <button type="button" className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} aria-label="Close details" />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-sand/10 bg-river shadow-2xl scrollbar-thin animate-rise [animation-duration:.45s]">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-md bg-ink/70 p-2 text-sand hover:text-sand" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        {!p && !error && (
          <div className="space-y-4 p-6" aria-busy="true">
            <div className="skeleton aspect-[16/9] rounded-xl" />
            <div className="skeleton h-8 w-2/3 rounded" />
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>
        )}
        {error && <p className="p-8 text-ember">{error}</p>}

        {p && (
          <>
            <div className="relative aspect-[16/9] shrink-0 bg-ink">
              {photo === undefined && <div className="skeleton h-full w-full" aria-hidden />}
              {photo && <img src={photo.src} alt={`Photo of ${p.name}`} className="h-full w-full object-cover" onError={photoBroken} />}
              {photo === null && <div className="dot-bg h-full w-full bg-river-2" aria-hidden />}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-river via-river/50 to-transparent" aria-hidden />
            </div>
            <div className="-mt-16 space-y-6 p-6 pt-0">
              <div className="relative">
                <p className="label text-accent">{p.groups.map((x) => GROUP_LABELS[x] ?? x).join(', ') || 'Place'}</p>
                <h2 className="text-3xl text-sand">{p.name}</h2>
                {p.formatted_address && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-sand-dim">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {p.formatted_address}
                  </p>
                )}
                {photo && (
                  <p className="mt-1 text-[11px] text-sand-faint">
                    Photo:{' '}
                    {photo.href ? (
                      <a className="underline" href={photo.href} target="_blank" rel="noreferrer">
                        {photo.credit}
                      </a>
                    ) : (
                      photo.credit
                    )}
                  </p>
                )}
                {photo === null && <p className="mt-1 text-[11px] text-sand-faint">No photo of this place yet.</p>}
                {partial && (
                  <p className="mt-3 rounded-lg border border-saffron/25 bg-saffron/[0.06] px-3 py-2 text-xs text-sand-dim">
                    Google's full details aren't available right now, so this shows what the search returned.
                  </p>
                )}
              </div>

              {match && match.fit.length > 0 && (
                <section aria-labelledby="fit-h">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id="fit-h" className="text-lg text-sand">How it fits your search</h3>
                    <span className="text-sm text-accent">{fitSummary(match.fit)}</span>
                  </div>
                  <FitTable fit={match.fit} />
                  {localityName && match.distance_from_locality_km != null && match.distance_from_locality_km >= 0.15 && (
                    <p className="mt-2 text-sm text-sand-dim">
                      {match.in_locality ? 'Inside' : 'Outside'} {localityName}, {match.distance_from_locality_km.toFixed(1)} km from its centre (straight line).
                    </p>
                  )}
                </section>
              )}
              {match && match.fit.length === 0 && match.reasons.length > 0 && (
                <p className="rounded-xl bg-ink/40 p-3 text-sand">{match.explanation}</p>
              )}

              {p.editorial_summary && <p className="text-sand/90">{p.editorial_summary}</p>}

              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {p.rating != null && (
                  <Fact icon={Star} label="Rating">
                    {p.rating.toFixed(1)} from {compactCount(p.user_ratings_total) || 'some'} reviews
                  </Fact>
                )}
                {p.price_estimate && (
                  <Fact icon={Coins} label="Cost">
                    {p.price_estimate.spending_range_text}
                    <span className="block text-xs text-sand-faint">{p.price_estimate.admission_text}. {p.price_estimate.methodology_note}</span>
                  </Fact>
                )}
                <Fact icon={Accessibility} label="Wheelchair access">
                  {wheel === true ? 'Accessible entrance' : wheel === false ? 'No accessible entrance listed' : 'Not known'}
                  {wheel != null && <span className="block text-xs text-sand-faint">Source: {p.accessibility.source === 'google' ? 'Google Places' : 'curated data'}</span>}
                </Fact>
                <Fact icon={ShieldCheck} label="Data source">
                  {PROVENANCE[p.provenance?.verification_status] ?? 'Unknown'}
                </Fact>
              </dl>

              {hours.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 font-body text-base font-semibold text-sand">
                    <Clock className="h-4 w-4 text-accent" aria-hidden /> Hours
                  </h3>
                  <ul className="space-y-0.5 text-sm text-sand-dim">
                    {hours.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                  {p.is_open_now != null && <p className={`mt-2 text-sm ${p.is_open_now ? 'text-jal' : 'text-ember'}`}>{p.is_open_now ? 'Open right now' : 'Closed right now'}</p>}
                </section>
              )}

              {((g.connected_companions?.length ?? 0) > 0 || (g.connected_atmospheres?.length ?? 0) > 0) && (
                <section>
                  <h3 className="mb-2 font-body text-base font-semibold text-sand">Good for</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {[...(g.connected_companions ?? []), ...(g.connected_atmospheres ?? []), ...(g.connected_times_of_day ?? [])].map((t: string) => (
                      <span key={t} className="rounded-md bg-ink/60 px-2 py-0.5 text-xs capitalize text-sand/90">
                        {t}
                      </span>
                    ))}
                  </div>
                  {attrSource && <p className="mt-2 text-xs text-sand-faint">{attrSource}</p>}
                </section>
              )}

              {(g.nearby_places?.length ?? 0) > 0 && (
                <section>
                  <h3 className="mb-2 font-body text-base font-semibold text-sand">Within walking or a short ride</h3>
                  <ul className="divide-y divide-sand/10 rounded-xl border border-sand/10">
                    {g.nearby_places.slice(0, 6).map((n: { id: string; name: string; distance_km: number }) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onOpen(n.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-ink/40">
                          <span className="text-sand">{n.name}</span>
                          <span className="text-sand-faint">{n.distance_km} km</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex flex-wrap gap-2 pb-6">
                {g.graph_node_id && (
                  <button type="button" className="btn-accent" onClick={() => onGraph(g.graph_node_id)}>
                    <Network className="h-4 w-4" aria-hidden /> Show in graph
                  </button>
                )}
                {p.maps_uri && (
                  <a className="btn-ghost" href={p.maps_uri} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden /> Open in Google Maps
                  </a>
                )}
                {p.website_uri && (
                  <a className="btn-ghost" href={p.website_uri} target="_blank" rel="noreferrer">
                    <Globe className="h-4 w-4" aria-hidden /> Website
                  </a>
                )}
                {p.national_phone_number && (
                  <a className="btn-ghost" href={`tel:${p.national_phone_number.replace(/\s/g, '')}`}>
                    <Phone className="h-4 w-4" aria-hidden /> {p.national_phone_number}
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Fact({ icon: Icon, label, children }: { icon: typeof Star; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-ink/40 p-3">
      <dt className="flex items-center gap-1.5 text-xs text-sand-faint">
        <Icon className="h-3.5 w-3.5 text-accent" aria-hidden /> {label}
      </dt>
      <dd className="mt-1 text-sm text-sand">{children}</dd>
    </div>
  );
}
