import { useEffect, useState } from 'react';
import { Github, Network, Route } from 'lucide-react';
import { CITY_META, CITY_ORDER } from '../meta';
import type { CityId } from '../types';

interface Props {
  city: CityId;
  onCity: (c: CityId) => void;
  onGraph: () => void;
  onPlanner: () => void;
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".5">
        <path d="M9 22 16 10l7 11" />
        <path d="M9 22h14" />
      </g>
      <circle cx="16" cy="10" r="3.4" fill="#FF6A3D" />
      <circle cx="9" cy="22" r="2.6" fill="currentColor" />
      <circle cx="23" cy="21" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function TopBar({ city, onCity, onGraph, onPlanner }: Props) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header className={`sticky top-0 z-40 border-b transition-colors duration-300 ${scrolled ? 'border-sand/10 bg-ink/80 backdrop-blur-xl' : 'border-transparent bg-ink/0'}`}>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="flex shrink-0 items-center gap-2 text-sand" aria-label="WanderGraph home">
          <Logo className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">WanderGraph</span>
        </a>

        <nav aria-label="City" className="ml-4 hidden items-center rounded-lg border border-sand/10 bg-white/[0.02] p-0.5 md:flex">
          {CITY_ORDER.map((id) => {
            const on = city === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onCity(id)}
                aria-current={on ? 'page' : undefined}
                className={`relative rounded-md px-3 py-1 text-sm transition-colors ${on ? 'bg-white/[0.08] text-sand' : 'text-sand-faint hover:text-sand'}`}
              >
                {CITY_META[id].name}
              </button>
            );
          })}
        </nav>

        <label className="sr-only" htmlFor="city-select">
          City
        </label>
        <select
          id="city-select"
          aria-label="City"
          value={city}
          onChange={(e) => onCity(e.target.value as CityId)}
          className="ml-1 min-w-0 rounded-md border border-sand/10 bg-river px-2 py-1 text-sm text-sand md:hidden"
        >
          {CITY_ORDER.map((id) => (
            <option key={id} value={id}>
              {CITY_META[id].name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <a href="#results" className="hidden rounded-md px-3 py-1.5 text-sm text-sand-faint transition-colors hover:text-sand lg:inline">
            Results
          </a>
          <a href="#graph" onClick={(e) => { e.preventDefault(); onGraph(); }} className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-sand-faint transition-colors hover:text-sand sm:inline-flex">
            <Network className="h-4 w-4" aria-hidden /> Graph
          </a>
          <a
            href="https://github.com/codeMaster60/wandergraph"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md p-2 text-sand-faint transition-colors hover:text-sand sm:inline-flex"
            aria-label="Source code on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <button type="button" onClick={onPlanner} className="btn-primary ml-1 px-3 py-1.5">
            <Route className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Plan a day</span>
            <span className="sr-only sm:hidden">Plan a day</span>
          </button>
        </div>
      </div>
    </header>
  );
}
