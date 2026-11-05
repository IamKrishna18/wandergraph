import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeftRight, Bot, CheckCircle2, Clock, Footprints, HelpCircle, Loader2, Map as MapIcon, RotateCcw, Send, X } from 'lucide-react';
import { CITY_META } from '../meta';
import { useEscape, usePlanner } from '../hooks';
import type { CityId, Itinerary, ItineraryStop } from '../types';
import { MapView } from './MapView';

export const STARTERS: Record<CityId, string[]> = {
  hyderabad: ['A full day of Nizami heritage', 'Romantic evening by the lake', 'Half day with kids, under ₹500', 'Biryani and bazaars on Saturday'],
  bengaluru: ['Gardens in the morning, brewpub at night', 'Tiffin trail tomorrow morning', 'Family day out, free places only', 'Art and books for a rainy afternoon'],
  tokyo: ['First day in Tokyo, the classics', 'Evening of city views for two', 'Free shrines and parks', 'Half day around Shibuya'],
  kyoto: ['Zen temples on a quiet morning', 'Evening in Gion and Pontocho', 'Full day in Arashiyama', 'Budget day under ¥3,000'],
};

const HOURS_BADGE = {
  open: { icon: CheckCircle2, cls: 'text-jal', label: 'Open then' },
  closed: { icon: AlertTriangle, cls: 'text-ember', label: 'Check hours' },
  unknown: { icon: HelpCircle, cls: 'text-sand-faint', label: 'Hours unknown' },
};

interface Props {
  open: boolean;
  city: CityId;
  sessionId?: string;
  /** a prompt to send as soon as the planner opens; `n` changes for each new request */
  starter?: { text: string; n: number } | null;
  onClose: () => void;
  onOpenPlace: (id: string) => void;
}

export function Planner({ open, city, sessionId, starter, onClose, onOpenPlace }: Props) {
  const { itinerary, history, busy, error, plan, swap, reset } = usePlanner(sessionId);
  const [input, setInput] = useState('');
  const [showMap, setShowMap] = useState(true);
  const logEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useEscape(open, close);
  const meta = CITY_META[city];

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, busy]);
  // A plan is for one city; start over when the city changes
  useEffect(() => {
    if (itinerary && itinerary.city !== city) reset();
  }, [city, itinerary, reset]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy === 'plan') return;
    setInput('');
    // follow-ups build on the current plan; a first message starts fresh
    void plan(t, city);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const sentStarter = useRef(0);
  useEffect(() => {
    if (open && starter && starter.n !== sentStarter.current) {
      sentStarter.current = starter.n;
      send(starter.text);
    }
    // send is stable enough for a one-shot trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, starter]);

  const points = useMemo(
    () =>
      (itinerary?.stops ?? [])
        .filter((s) => s.place.coordinates)
        .map((s) => ({ id: s.place.id, lat: s.place.coordinates!.latitude, lng: s.place.coordinates!.longitude, label: String(s.stop_index + 1), title: `${s.stop_index + 1}. ${s.place.name}` })),
    [itinerary],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Day planner">
      <button type="button" className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} aria-label="Close planner" />
      <aside className="relative flex h-full w-full max-w-3xl flex-col border-l border-sand/10 bg-river shadow-2xl animate-rise [animation-duration:.45s]">
        <header className="flex items-center gap-3 border-b border-sand/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-2xl text-sand">Plan a day in {meta.name}</h2>
            <p className="text-sm text-sand-dim">Tell me the mood, the company and the budget. I'll check hours and distances.</p>
          </div>
          {itinerary && (
            <button type="button" onClick={reset} className="btn-ghost ml-auto px-3 py-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Start over
            </button>
          )}
          <button type="button" onClick={onClose} className={`${itinerary ? '' : 'ml-auto'} rounded-md p-2 text-sand-dim hover:bg-white/5 hover:text-sand`} aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
          {!itinerary && history.length === 0 && (
            <div className="space-y-4">
              <p className="text-sand/90">Try one of these, or write your own:</p>
              <div className="flex flex-wrap gap-2">
                {STARTERS[city].map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <ol className="space-y-3" aria-label="Conversation">
              {history.map((m, i) => (
                <li key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <p className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-white/[0.09] text-sand' : 'border border-sand/10 bg-ink/40 text-sand'}`}>{m.content}</p>
                </li>
              ))}
              {busy === 'plan' && (
                <li className="flex items-center gap-2 text-sm text-sand-dim">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking hours, distances and budgets…
                </li>
              )}
            </ol>
          )}
          {error && <p className="mt-3 rounded-xl border border-ember/40 bg-ember/10 px-4 py-2 text-sm text-sand">{error}</p>}

          {itinerary && <ItineraryView it={itinerary} busy={busy} showMap={showMap} setShowMap={setShowMap} points={points} center={meta.center} onSwap={swap} onOpenPlace={onOpenPlace} />}
          <div ref={logEnd} />
        </div>

        <form onSubmit={submit} className="border-t border-sand/10 p-4">
          <label htmlFor="planner-input" className="sr-only">Describe your day</label>
          <div className="flex items-end gap-2 rounded-xl border border-sand/15 bg-ink/60 p-2 focus-within:border-accent/70">
            <textarea
              id="planner-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={itinerary ? 'Change it: make it cheaper, start later, add a cafe…' : 'Evening with my partner, something romantic…'}
              className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sand placeholder:text-sand-faint focus:outline-none"
            />
            <button type="submit" className="btn-accent h-11 px-4" disabled={!input.trim() || busy === 'plan'} aria-label="Send">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ItineraryView({ it, busy, showMap, setShowMap, points, center, onSwap, onOpenPlace }: {
  it: Itinerary;
  busy: 'plan' | number | null;
  showMap: boolean;
  setShowMap: (v: boolean) => void;
  points: { id: string; lat: number; lng: number; label: string; title: string }[];
  center: [number, number];
  onSwap: (i: number, id?: string, note?: string) => void;
  onOpenPlace: (id: string) => void;
}) {
  return (
    <section className="mt-6" aria-label="Itinerary">
      <div className="rounded-xl border border-sand/10 bg-ink/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-accent">{it.date_or_day}</p>
            <h3 className="text-2xl text-sand">{it.title}</h3>
            <p className="text-sm text-sand-dim">{it.theme}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md border border-sand/10 px-2 py-0.5 text-xs text-sand-dim" title="Opening hours and distances are checked in your browser against each stop's listed hours and coordinates">
            <Bot className="h-3.5 w-3.5" aria-hidden /> Hours and distances checked
          </span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-sand-faint">Estimated spend</dt>
            <dd className="text-sand">{it.total_estimated_spend}</dd>
          </div>
          <div>
            <dt className="text-xs text-sand-faint">Getting around</dt>
            <dd className="text-sm text-sand">{it.travel_feasibility_note}</dd>
          </div>
        </dl>
        {it.notes.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-saffron">
            {it.notes.map((n) => (
              <li key={n} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{n}</li>
            ))}
          </ul>
        )}
        {points.length > 1 && (
          <button type="button" onClick={() => setShowMap(!showMap)} className="btn-ghost mt-4 px-3 py-1.5 text-xs" aria-expanded={showMap}>
            <MapIcon className="h-4 w-4" aria-hidden /> {showMap ? 'Hide route map' : 'Show route map'}
          </button>
        )}
        {showMap && points.length > 1 && <MapView points={points} center={center} route onSelect={onOpenPlace} className="mt-3 h-64" ariaLabel="Route map of the itinerary" />}
      </div>

      <ol className="relative mt-6 space-y-0 border-l-2 border-dashed border-accent/40 pl-6" aria-label="Stops in visiting order">
        {it.stops.map((s) => (
          <StopRow key={`${s.stop_index}-${s.place.id}`} s={s} busy={busy === s.stop_index} onSwap={onSwap} onOpenPlace={onOpenPlace} />
        ))}
      </ol>
      {it.stops.length === 0 && <p className="text-sand-dim">No stops fit. Try fewer constraints.</p>}
    </section>
  );
}

function StopRow({ s, busy, onSwap, onOpenPlace }: { s: ItineraryStop; busy: boolean; onSwap: (i: number, id?: string, note?: string) => void; onOpenPlace: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const H = HOURS_BADGE[s.hours_status];
  return (
    <li className="relative pb-6">
      {s.travel_from_previous && (
        <p className="-mt-1 mb-3 flex items-center gap-1.5 text-xs text-sand-faint">
          <Footprints className="h-3.5 w-3.5" aria-hidden /> {s.travel_from_previous.distance_km} km, {s.travel_from_previous.mode_note.replace(/^~/, 'about ')}
        </p>
      )}
      <span className="absolute -left-[37px] top-0 grid h-7 w-7 place-items-center rounded-full border border-accent/60 bg-ink font-mono text-xs text-accent" aria-hidden>
        {s.stop_index + 1}
      </span>
      <div className="rounded-xl border border-sand/10 bg-ink/40 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm text-accent">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {s.time_slot} <span className="text-sand-faint">{s.slot_label}</span>
          </p>
          <span className={`inline-flex items-center gap-1 text-xs ${H.cls}`} title={s.opening_hours_note}>
            <H.icon className="h-3.5 w-3.5" aria-hidden /> {H.label}
          </span>
        </div>
        <h4 className="mt-1 text-lg text-sand">
          <button type="button" className="text-left hover:text-accent" onClick={() => onOpenPlace(s.place.id)}>
            {s.place.name}
          </button>
        </h4>
        <p className="text-sm text-sand/85">{s.visit_purpose}</p>
        <p className="mt-2 text-xs text-sand-dim">
          {s.estimated_cost}. {s.opening_hours_note}.
        </p>
        <div className="mt-3">
          <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpen(!open)} aria-expanded={open} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />} Swap this stop
          </button>
        </div>
        {open && (
          <div className="mt-3 space-y-2 rounded-xl border border-sand/10 bg-river p-3">
            {s.replacement_options.length > 0 ? (
              <ul className="space-y-1">
                {s.replacement_options.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink/50"
                      onClick={() => { setOpen(false); onSwap(s.stop_index, o.id); }}>
                      <span className="text-sand">{o.name}</span>
                      <span className="shrink-0 text-xs text-sand-faint">{o.reason ?? (o.rating ? `★ ${o.rating}` : '')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-sand-dim">No other candidate fits this time slot.</p>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { setOpen(false); onSwap(s.stop_index, undefined, note.trim()); setNote(''); } }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Or ask: a temple, somewhere cheaper…" aria-label="Describe a replacement" className="field py-1.5 text-sm" />
              <button type="submit" className="btn-accent px-3 py-1.5 text-xs" disabled={!note.trim()}>Swap</button>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}
