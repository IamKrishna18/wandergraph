import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { CITY_META } from '../meta';
import { useElement, usePrefersReducedMotion } from '../hooks';
import type { CityId } from '../types';
import { ElementField } from './ElementField';

interface Props {
  city: CityId;
  loading: boolean;
  onSearch: (q: string) => void;
}

export function Hero({ city, loading, onSearch }: Props) {
  const meta = CITY_META[city];
  const { element } = useElement();
  const reduced = usePrefersReducedMotion();
  const [q, setQ] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) onSearch(q.trim());
  };

  return (
    <section
      id="top"
      className="paper-grain element-wipe relative isolate overflow-hidden"
      style={{ background: 'linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 45%, #08111F 100%)' }}
    >
      <div className="rays absolute inset-x-[-20%] bottom-[-10%] top-[-30%] origin-bottom animate-rays" aria-hidden />
      {/* the sun (fire) or moon (water) sits on the horizon */}
      <div
        aria-hidden
        className="absolute bottom-[-180px] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full transition-all duration-1000"
        style={{
          background:
            element === 'fire'
              ? 'radial-gradient(circle, #FFD27A 0%, #F5A623 38%, rgba(210,56,30,0.55) 62%, transparent 72%)'
              : 'radial-gradient(circle, #E6F7F5 0%, #9AD9D4 30%, rgba(35,165,160,0.35) 58%, transparent 70%)',
        }}
      />
      <ElementField element={element} reduced={reduced} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-20">
        <p
          lang={meta.nativeLang}
          aria-hidden
          className="pointer-events-none absolute -top-2 right-2 select-none font-native text-[22vw] font-bold leading-none text-sand/[0.05] sm:text-[160px] lg:text-[210px]"
        >
          {meta.native}
        </p>

        <div className="relative max-w-3xl animate-rise">
          <p className="text-base text-sand-dim">Where to in {meta.country}?</p>
          <h1 key={city} className="mt-1 font-display text-[clamp(3.5rem,11vw,8.5rem)] text-sand drop-shadow-[0_4px_30px_rgb(var(--glow)/0.35)]">
            {meta.name}
          </h1>
          <p className="mt-2 max-w-xl text-lg text-sand/80">{meta.tagline}</p>
        </div>

        <form onSubmit={submit} className="relative mt-8 max-w-3xl animate-rise [animation-delay:150ms]" role="search">
          <label htmlFor="hero-search" className="sr-only">
            Describe what you want to do in {meta.name}
          </label>
          <div className="flex items-center gap-2 rounded-full border border-sand/20 bg-ink/75 p-2 pl-5 shadow-[0_10px_60px_rgb(var(--glow)/0.18)] backdrop-blur focus-within:border-accent">
            <Search className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <input
              id="hero-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={meta.symbol === '₹' ? 'Quiet temples with my parents, under ₹200…' : 'Quiet temples with my parents, under ¥1,000…'}
              className="min-w-0 flex-1 bg-transparent py-2 text-base text-sand placeholder:text-sand-faint focus:outline-none sm:text-lg"
              autoComplete="off"
            />
            <button type="submit" className="btn-accent px-5 py-2.5 text-base" disabled={loading || !q.trim()}>
              Search
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.prompts.map((p) => (
              <button
                key={p}
                type="button"
                className="chip hover:border-accent/60 hover:text-accent"
                onClick={() => {
                  setQ(p);
                  onSearch(p);
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-sand-faint">Typos are fine. Mention a neighbourhood, who you're with, a budget or a time of day.</p>
        </form>
      </div>
    </section>
  );
}
