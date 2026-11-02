import { Droplets, Flame, Network, Route } from 'lucide-react';
import { CITY_META, CITY_ORDER } from '../meta';
import { useElement } from '../hooks';
import type { CityId, ProviderStatus } from '../types';

interface Props {
  city: CityId;
  onCity: (c: CityId) => void;
  onGraph: () => void;
  onPlanner: () => void;
  provider: ProviderStatus | null;
}

export function ElementToggle() {
  const { element, setElement } = useElement();
  const fire = element === 'fire';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!fire}
      aria-label={fire ? 'Fire theme on. Switch to water' : 'Water theme on. Switch to fire'}
      onClick={() => setElement(fire ? 'water' : 'fire')}
      className="group relative flex h-9 w-[76px] items-center rounded-full border border-sand/15 bg-ink/70 p-1"
      title="Fire or water: changes the mood of the whole app"
    >
      <span
        className="absolute top-1 h-7 w-7 rounded-full bg-accent shadow-[0_0_16px_rgb(var(--glow)/0.7)] transition-all duration-500"
        style={{ left: fire ? 4 : 42 }}
      />
      <Flame className={`relative z-10 ml-[6px] h-4 w-4 transition-colors ${fire ? 'text-ink' : 'text-sand-faint'}`} />
      <Droplets className={`relative z-10 ml-auto mr-[6px] h-4 w-4 transition-colors ${fire ? 'text-sand-faint' : 'text-ink'}`} />
    </button>
  );
}

export function TopBar({ city, onCity, onGraph, onPlanner, provider }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-sand/10 bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <a href="#top" className="flex shrink-0 items-baseline gap-2" aria-label="WanderGraph home">
          <span className="font-display text-lg leading-none text-sand sm:text-2xl">WanderGraph</span>
        </a>

        <nav aria-label="City" className="ml-2 hidden items-center gap-1 rounded-full border border-sand/10 bg-river/60 p-1 md:flex">
          {CITY_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onCity(id)}
              aria-current={city === id ? 'page' : undefined}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                city === id ? 'bg-accent text-ink' : 'text-sand-dim hover:text-sand'
              }`}
            >
              {CITY_META[id].name}
            </button>
          ))}
        </nav>

        <select
          aria-label="City"
          value={city}
          onChange={(e) => onCity(e.target.value as CityId)}
          className="min-w-0 rounded-full border border-sand/15 bg-river px-2 py-1.5 text-sm md:hidden"
        >
          {CITY_ORDER.map((id) => (
            <option key={id} value={id}>
              {CITY_META[id].name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {provider && (
            <span
              className="hidden items-center gap-1.5 text-xs text-sand-dim lg:flex"
              title={provider.status_message}
            >
              <span className={`h-2 w-2 rounded-full ${provider.is_live ? 'bg-jal' : 'bg-saffron'}`} />
              {provider.is_live ? 'Live Google data' : 'Curated places'}
            </span>
          )}
          <ElementToggle />
          <button type="button" onClick={onGraph} className="btn-ghost hidden sm:inline-flex" aria-label="Open the knowledge graph">
            <Network className="h-4 w-4" />
            <span>Graph</span>
          </button>
          <button type="button" onClick={onPlanner} className="btn-accent">
            <Route className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Plan a day</span>
            <span className="sr-only sm:hidden">Plan a day</span>
          </button>
        </div>
      </div>
    </header>
  );
}
