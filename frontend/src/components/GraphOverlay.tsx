import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { Expand, LocateFixed, Search, X } from 'lucide-react';
import { api } from '../api';
import { groupForCategoryNode } from '../adapter';
import { useEscape } from '../hooks';
import { CITY_META } from '../meta';
import type { CityId, GraphData, GraphElement } from '../types';

const TYPE_LABEL: Record<string, string> = {
  Place: 'Places',
  City: 'City',
  Neighborhood: 'Neighbourhoods',
  Category: 'Categories',
  CompanionType: 'Who it suits',
  Atmosphere: 'Atmosphere',
  PriceRange: 'Price',
  TimeOfDay: 'Time of day',
  AccessibilityFeature: 'Accessibility',
  Activity: 'Activities',
  Interest: 'Interests',
  Amenity: 'Amenities',
};
const LAYOUTS = [
  { id: 'cose', label: 'Organic' },
  { id: 'concentric', label: 'Rings' },
  { id: 'breadthfirst', label: 'Tree' },
  { id: 'circle', label: 'Circle' },
];

interface Props {
  open: boolean;
  city: CityId;
  focus: string | null;
  onClose: () => void;
  onOpenPlace: (id: string) => void;
  onFilterCategory: (groupId: string) => void;
}

function layoutOptions(name: string, animate: boolean): any {
  if (name === 'cose')
    return { name, animate, animationDuration: 600, padding: 40, nodeRepulsion: () => 600000, idealEdgeLength: () => 120, edgeElasticity: () => 80, gravity: 0.25, numIter: 2000, nodeDimensionsIncludeLabels: true, randomize: true };
  if (name === 'concentric')
    return { name, animate, padding: 40, minNodeSpacing: 18, concentric: (n: any) => (n.data('type') === 'City' ? 3 : n.data('type') === 'Place' ? 2 : 1), levelWidth: () => 1 };
  return { name, animate, padding: 40, spacingFactor: 1.2 };
}

const TYPE_COLOR: Record<string, string> = {
  Place: '#F97316', City: '#FACC15', Neighborhood: '#EF4444', Category: '#22D3EE', Activity: '#38BDF8', Interest: '#A78BFA',
  CompanionType: '#FB7185', Atmosphere: '#2DD4BF', PriceRange: '#84CC16', TimeOfDay: '#FBBF24', AccessibilityFeature: '#4ADE80', Amenity: '#94A3B8',
};

function toElements(g: GraphData): ElementDefinition[] {
  return [...g.nodes, ...g.edges].map((e: GraphElement) => ({ data: { ...e.data, ...(e.data.type ? { color: TYPE_COLOR[e.data.type] ?? e.data.color } : {}) } }));
}

export function GraphOverlay({ open, city, focus, onClose, onOpenPlace, onFilterCategory }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [neighbors, setNeighbors] = useState<{ id: string; label: string; relation: string }[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set(['Interest', 'Activity', 'Amenity', 'Atmosphere']));
  const [layout, setLayout] = useState('cose');
  const [query, setQuery] = useState('');
  const close = useCallback(() => onClose(), [onClose]);
  useEscape(open, close);

  // Load the city graph (plus the focused node's neighbourhood when it's outside it)
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const g = await api.graph(city);
        if (focus && !g.nodes.some((n) => n.data.id === focus)) {
          const extra = await api.graphNode(focus, 1);
          const ids = new Set(g.nodes.map((n) => n.data.id));
          const eids = new Set(g.edges.map((e) => e.data.id));
          g.nodes.push(...extra.nodes.filter((n) => !ids.has(n.data.id)));
          g.edges.push(...extra.edges.filter((e) => !eids.has(e.data.id)));
        }
        if (live) setData(g);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, city, focus]);

  const describe = useCallback((id: string) => {
    const c = cy.current;
    if (!c) return;
    const n = c.getElementById(id);
    if (!n.length) return;
    setSelected(n.data());
    setNeighbors(
      n
        .connectedEdges()
        .map((e) => {
          const other = e.source().id() === id ? e.target() : e.source();
          return { id: other.id(), label: other.data('label'), relation: e.data('label') };
        })
        .slice(0, 40),
    );
  }, []);

  const focusOn = useCallback(
    (id: string) => {
      const c = cy.current;
      if (!c) return;
      const n = c.getElementById(id);
      if (!n.length) return;
      c.elements().removeClass('faded hl lbl');
      const hood = n.closedNeighborhood();
      c.elements().not(hood).addClass('faded');
      hood.addClass('hl');
      if (hood.edges().length <= 16) hood.edges().addClass('lbl');
      c.animate({ center: { eles: n }, zoom: Math.max(c.zoom(), 1.3) }, { duration: 450 });
      describe(id);
    },
    [describe],
  );

  // Build cytoscape
  useEffect(() => {
    if (!open || !data || !box.current) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().split(/\s+/).join(',');
    const c = cytoscape({
      container: box.current,
      elements: toElements(data),
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#EBDDBF',
            'font-family': 'Hind Guntur, sans-serif',
            'font-size': 10,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-outline-color': '#08111F',
            'text-outline-width': 2,
            'text-opacity': 0,
            width: 14,
            height: 14,
            'border-width': 0,
          },
        },
        { selector: 'node[type = "Neighborhood"], node[type = "CompanionType"], node[type = "TimeOfDay"], node[type = "PriceRange"], node[type = "AccessibilityFeature"]', style: { 'text-opacity': 0.75 } },
        { selector: 'node[type = "Place"]', style: { width: 24, height: 24, 'font-size': 12, 'font-weight': 600, 'text-opacity': 1 } },
        { selector: 'node[type = "City"]', style: { width: 46, height: 46, 'font-size': 16, shape: 'star' } },
        { selector: 'node[type = "Category"]', style: { shape: 'round-diamond', width: 22, height: 22, 'text-opacity': 1, color: '#22D3EE' } },
        { selector: 'node.hl', style: { 'text-opacity': 1 } },
        { selector: 'edge', style: { width: 1, 'line-color': 'rgba(235,221,191,0.14)', 'curve-style': 'haystack' } },
        { selector: 'edge[relation = "NEARBY_TO"]', style: { 'line-style': 'dashed', 'line-color': `rgba(${accent},0.45)` } },
        { selector: '.faded', style: { opacity: 0.12 } },
        { selector: 'edge.hl', style: { 'line-color': `rgb(${accent})`, width: 2 } },
        { selector: 'edge.lbl', style: { label: 'data(label)', 'font-size': 8, color: '#B9AC90', 'text-rotation': 'autorotate', 'text-outline-color': '#08111F', 'text-outline-width': 2 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': `rgb(${accent})` } },
      ],
      layout: { name: 'preset' },
    });
    cy.current = c;
    c.nodes().forEach((n) => {
      if (hidden.has(n.data('type'))) n.style('display', 'none');
    });
    c.layout(layoutOptions(layout, false)).run();
    c.on('tap', 'node', (e) => focusOn(e.target.id()));
    c.on('tap', (e) => {
      if (e.target === c) {
        c.elements().removeClass('faded hl lbl');
        setSelected(null);
      }
    });
    c.on('dbltap', 'node', async (e) => {
      const id = e.target.id();
      try {
        const extra = await api.graphNode(id, 1);
        const add = toElements(extra).filter((el) => !c.getElementById(String(el.data.id)).length);
        if (add.length) {
          c.add(add);
          c.layout({ name: 'cose', animate: true, animationDuration: 500, fit: false } as any).run();
        }
      } catch {
        /* expanding is best-effort */
      }
    });
    if (focus && c.getElementById(focus).length) setTimeout(() => focusOn(focus), 60);
    else c.fit(undefined, 30);
    return () => {
      c.destroy();
      cy.current = null;
    };
    // layout and hidden are applied below without rebuilding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, focus, focusOn]);

  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.nodes().forEach((n) => {
      n.style('display', hidden.has(n.data('type')) ? 'none' : 'element');
    });
  }, [hidden]);

  const runLayout = (name: string) => {
    setLayout(name);
    cy.current?.layout(layoutOptions(name, true)).run();
  };

  const counts = useMemo(() => {
    const m: Record<string, { n: number; color: string }> = {};
    data?.nodes.forEach((n) => {
      const t = n.data.type || 'Other';
      m[t] = { n: (m[t]?.n ?? 0) + 1, color: n.data.color || '#94A3B8' };
    });
    return m;
  }, [data]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const c = cy.current;
    if (!c || !query.trim()) return;
    const q = query.trim().toLowerCase();
    const hit = c.nodes().filter((n) => String(n.data('label') || '').toLowerCase().includes(q)).first();
    if (hit.length) {
      if (hidden.has(hit.data('type'))) setHidden((h) => new Set([...h].filter((t) => t !== hit.data('type'))));
      focusOn(hit.id());
    }
  };

  if (!open) return null;
  const selType = selected?.type as string | undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink" role="dialog" aria-modal="true" aria-label={`Knowledge graph for ${CITY_META[city].name}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-sand/10 px-4 py-3 sm:px-6">
        <h2 className="font-display text-2xl text-sand">{CITY_META[city].name}, as a graph</h2>
        <form onSubmit={search} className="flex min-w-[200px] flex-1 items-center gap-2 rounded-full border border-sand/15 bg-river px-3 sm:max-w-xs">
          <Search className="h-4 w-4 text-sand-faint" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node" aria-label="Find a node" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm focus:outline-none" />
        </form>
        <div role="group" aria-label="Layout" className="flex rounded-full border border-sand/10 bg-river p-1">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" onClick={() => runLayout(l.id)} aria-pressed={layout === l.id}
              className={`rounded-full px-3 py-1 text-xs ${layout === l.id ? 'bg-accent text-ink' : 'text-sand-dim hover:text-sand'}`}>
              {l.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => cy.current?.fit(undefined, 30)}>
          <LocateFixed className="h-4 w-4" aria-hidden /> Fit
        </button>
        <button type="button" onClick={onClose} className="ml-auto rounded-full p-2 text-sand hover:text-accent" aria-label="Close graph">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div ref={box} className="min-h-0 flex-1" aria-label="Interactive graph canvas. Click a node to inspect it, double-click to expand it." />
        {loading && <p className="absolute left-6 top-6 text-sand-dim">Drawing the graph…</p>}
        {error && <p className="absolute left-6 top-6 text-ember">{error}</p>}

        <div className="absolute bottom-4 left-4 max-w-[calc(100%-2rem)] rounded-2xl border border-sand/10 bg-river/90 p-3 backdrop-blur">
          <p className="mb-2 text-xs text-sand-faint">Show or hide node types</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(counts).map(([t, { n, color }]) => {
              const off = hidden.has(t);
              return (
                <button key={t} type="button" aria-pressed={!off}
                  onClick={() => setHidden((h) => { const s = new Set(h); if (off) s.delete(t); else s.add(t); return s; })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${off ? 'border-sand/10 text-sand-faint' : 'border-sand/20 text-sand'}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? 'transparent' : color, border: `1px solid ${color}` }} />
                  {TYPE_LABEL[t] ?? t} <span className="text-sand-faint">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {selected && (
          <aside className="absolute right-4 top-4 flex max-h-[calc(100%-2rem)] w-[min(340px,calc(100%-2rem))] flex-col rounded-2xl border border-sand/10 bg-river/95 p-4 backdrop-blur" aria-label="Selected node">
            <p className="text-xs text-accent">{TYPE_LABEL[selType ?? ''] ?? selType}</p>
            <h3 className="font-display text-2xl text-sand">{selected.label}</h3>
            {selType === 'Place' && selected.properties?.neighborhood && <p className="text-sm text-sand-dim">{selected.properties.neighborhood}</p>}
            {selType === 'Place' && <p className="mt-1 text-xs text-sand-faint">Curated data, not independently verified</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {selType === 'Place' && (
                <button type="button" className="btn-accent px-3 py-1 text-xs" onClick={() => onOpenPlace(String(selected.id).replace(/^place:/, ''))}>
                  Open place
                </button>
              )}
              {selType === 'Category' && groupForCategoryNode(String(selected.id)) && (
                <button type="button" className="btn-accent px-3 py-1 text-xs" onClick={() => { onFilterCategory(groupForCategoryNode(String(selected.id))!); onClose(); }}>
                  Show these places
                </button>
              )}
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => cy.current?.getElementById(selected.id).emit('dbltap')}>
                <Expand className="h-3.5 w-3.5" aria-hidden /> Expand
              </button>
            </div>
            <p className="mt-4 text-xs text-sand-faint">{neighbors.length} connections</p>
            <ul className="mt-1 flex-1 space-y-0.5 overflow-y-auto text-sm scrollbar-thin">
              {neighbors.map((n) => (
                <li key={`${n.id}-${n.relation}`}>
                  <button type="button" className="flex w-full justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-ink/50" onClick={() => focusOn(n.id)}>
                    <span className="truncate text-sand">{n.label}</span>
                    <span className="shrink-0 text-xs text-sand-faint">{n.relation}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
