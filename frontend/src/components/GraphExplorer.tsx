import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape';
import { Maximize2, Minus, Plus, Scan, Search, X } from 'lucide-react';
import { groupForCategoryNode } from '../adapter';
import { useEscape } from '../hooks';
import { CITY_META, nodeLabel } from '../meta';
import type { CityId, GraphData } from '../types';

export const TYPE_META: Record<string, { label: string; color: string; size: number }> = {
  City: { label: 'City', color: '#EDEDEF', size: 40 },
  Neighborhood: { label: 'Neighbourhoods', color: '#A1A1AA', size: 15 },
  Place: { label: 'Places', color: '#FF6A3D', size: 21 },
  Category: { label: 'Categories', color: '#7DD3FC', size: 13 },
  Atmosphere: { label: 'Moods', color: '#C4B5FD', size: 11 },
  CompanionType: { label: 'Who it suits', color: '#3DD68C', size: 13 },
  TimeOfDay: { label: 'Time of day', color: '#FDA4AF', size: 13 },
  PriceRange: { label: 'Price', color: '#F5B941', size: 13 },
};
const ATTRIBUTE_TYPES = ['Category', 'CompanionType', 'TimeOfDay', 'PriceRange', 'Atmosphere'];
const RELATION: Record<string, string> = {
  LOCATED_IN: 'in',
  IN_NEIGHBORHOOD: 'neighbourhood',
  HAS_CATEGORY: 'category',
  HAS_ATMOSPHERE: 'mood',
  SUITABLE_FOR: 'suits',
  RECOMMENDED_FOR: 'best time',
  HAS_PRICE_RANGE: 'price',
  NEARBY_TO: 'nearby',
};

type Pos = Record<string, { x: number; y: number; a: number }>;

/**
 * A fixed radial layout, so the graph reads the same way every time:
 * city in the centre, neighbourhoods on the first ring, each neighbourhood's places
 * fanned out behind it, and the attributes (category, mood, who it suits, time, price)
 * on the outer ring, ordered so each sits close to the places it describes.
 */
export function radialLayout(g: GraphData): Pos {
  const type = new Map(g.nodes.map((n) => [n.data.id, n.data.type ?? '']));
  const hoodOf = new Map<string, string>();
  const links = new Map<string, Set<string>>();
  for (const e of g.edges) {
    const { source: s, target: t, relation } = e.data;
    if (!s || !t) continue;
    if (relation === 'IN_NEIGHBORHOOD') hoodOf.set(s, t);
    const [p, other] = type.get(s) === 'Place' ? [s, t] : type.get(t) === 'Place' ? [t, s] : [null, null];
    if (p && other && ATTRIBUTE_TYPES.includes(type.get(other) ?? '')) {
      if (!links.has(other)) links.set(other, new Set());
      links.get(other)!.add(p);
    }
  }
  const hoods = g.nodes.filter((n) => n.data.type === 'Neighborhood').map((n) => n.data.id);
  const places = g.nodes.filter((n) => n.data.type === 'Place').map((n) => n.data.id);
  const byHood = new Map<string, string[]>(hoods.map((h) => [h, []]));
  const loose: string[] = [];
  for (const p of places) {
    const h = hoodOf.get(p);
    if (h && byHood.has(h)) byHood.get(h)!.push(p);
    else loose.push(p);
  }
  // busiest neighbourhoods spread around the circle rather than bunched together
  const sorted = [...hoods].sort((a, b) => byHood.get(b)!.length - byHood.get(a)!.length || a.localeCompare(b));
  const order: string[] = [];
  sorted.forEach((h, i) => (i % 2 ? order.push(h) : order.unshift(h)));

  const pos: Pos = {};
  const R1 = 120 + hoods.length * 4;
  const R2 = R1 + 150;
  const R3 = R2 + 190;
  const weights = order.map((h) => Math.max(1, byHood.get(h)!.length));
  const sectors = [...order.map((h, i) => ({ h, w: weights[i] })), ...loose.map((p) => ({ h: `loose:${p}`, w: 1 }))];
  const W = sectors.reduce((s, x) => s + x.w, 0) || 1;
  let cursor = -Math.PI / 2;
  for (const { h, w } of sectors) {
    const span = (2 * Math.PI * w) / W;
    const mid = cursor + span / 2;
    const ps = h.startsWith('loose:') ? [h.slice(6)] : byHood.get(h)!;
    if (!h.startsWith('loose:')) pos[h] = { x: R1 * Math.cos(mid), y: R1 * Math.sin(mid), a: mid };
    ps.forEach((p, i) => {
      const a = ps.length === 1 ? mid : cursor + (span * (i + 0.5)) / ps.length;
      pos[p] = { x: R2 * Math.cos(a), y: R2 * Math.sin(a), a };
    });
    cursor += span;
  }

  // attributes: sort by the circular mean angle of their places, then space evenly
  const attrs = g.nodes.filter((n) => ATTRIBUTE_TYPES.includes(n.data.type ?? '')).map((n) => n.data.id);
  const mean = (id: string) => {
    const ps = [...(links.get(id) ?? [])].filter((p) => pos[p]);
    if (!ps.length) return null;
    const sx = ps.reduce((s, p) => s + Math.cos(pos[p].a), 0);
    const sy = ps.reduce((s, p) => s + Math.sin(pos[p].a), 0);
    return Math.atan2(sy, sx);
  };
  const withMean = attrs.map((id) => ({ id, m: mean(id) }));
  const known = withMean.filter((x) => x.m != null).sort((a, b) => a.m! - b.m!);
  const unknown = withMean.filter((x) => x.m == null);
  const ring = [...known, ...unknown];
  const step = (2 * Math.PI) / Math.max(ring.length, 1);
  // rotate the even spacing so it lines up with where the attributes "want" to be
  let sx = 0;
  let sy = 0;
  known.forEach((x, i) => {
    const d = x.m! - (i * step - Math.PI);
    sx += Math.cos(d);
    sy += Math.sin(d);
  });
  const rot = known.length ? Math.atan2(sy, sx) : 0;
  ring.forEach((x, i) => {
    const a = i * step - Math.PI + rot;
    pos[x.id] = { x: R3 * Math.cos(a), y: R3 * Math.sin(a), a };
  });

  for (const n of g.nodes) if (!pos[n.data.id]) pos[n.data.id] = { x: 0, y: 0, a: 0 };
  return pos;
}

function elements(g: GraphData, pos: Pos): ElementDefinition[] {
  const type = new Map(g.nodes.map((n) => [n.data.id, n.data.type ?? '']));
  const hasHood = new Set(g.edges.filter((e) => e.data.relation === 'IN_NEIGHBORHOOD').map((e) => e.data.source));
  const nodes: ElementDefinition[] = g.nodes.map((n) => {
    const t = n.data.type ?? '';
    const p = pos[n.data.id];
    // labels always point away from the centre, so neighbours near the top and bottom fan apart
    const right = Math.cos(p.a) > 1e-6 || (Math.abs(Math.cos(p.a)) <= 1e-6 && Math.sin(p.a) < 0);
    const side = t === 'City' ? 'lbl-bottom' : right ? 'lbl-right' : 'lbl-left';
    return {
      group: 'nodes',
      data: { ...n.data, label: nodeLabel(n.data.label), color: TYPE_META[t]?.color ?? '#80808A', size: TYPE_META[t]?.size ?? 8 },
      position: { x: p.x, y: p.y },
      classes: `${side} t-${t}`,
    };
  });
  const edges: ElementDefinition[] = g.edges
    // a place is already tied to the city through its neighbourhood
    .filter((e) => !(e.data.relation === 'LOCATED_IN' && type.get(e.data.source!) === 'Place' && hasHood.has(e.data.source)))
    .map((e) => {
      const rel = e.data.relation ?? '';
      const kind = rel === 'NEARBY_TO' ? 'e-near' : rel === 'LOCATED_IN' || rel === 'IN_NEIGHBORHOOD' ? 'e-tree' : 'e-attr';
      return { group: 'edges', data: { ...e.data, rel: RELATION[rel] ?? rel.toLowerCase() }, classes: kind };
    });
  return [...nodes, ...edges];
}

interface Props {
  city: CityId;
  data: GraphData | null;
  error?: string | null;
  focus?: string | null;
  variant: 'inline' | 'full';
  onOpenPlace: (id: string) => void;
  onFilterCategory: (groupId: string) => void;
  onExpand?: () => void;
  onClose?: () => void;
}

interface Selected {
  id: string;
  type: string;
  label: string;
  props: Record<string, any>;
  links: { id: string; label: string; type: string; rel: string }[];
}

export function GraphExplorer({ city, data, error, focus, variant, onOpenPlace, onFilterCategory, onExpand, onClose }: Props) {
  const full = variant === 'full';
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const pinned = useRef<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [hover, setHover] = useState<{ label: string; type: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set(full ? [] : ['Atmosphere']));
  const [attrLinks, setAttrLinks] = useState(true);
  const [nearLinks, setNearLinks] = useState(false);
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const close = useCallback(() => onClose?.(), [onClose]);
  useEscape(full, close);

  const layout = useMemo(() => (data ? radialLayout(data) : null), [data]);

  const describe = useCallback((n: NodeSingular): Selected => {
    const id = n.id();
    return {
      id,
      type: n.data('type'),
      label: n.data('label'),
      props: n.data('properties') ?? {},
      links: n
        .connectedEdges()
        .map((e) => {
          const o = e.source().id() === id ? e.target() : e.source();
          return { id: o.id(), label: o.data('label'), type: o.data('type'), rel: e.data('rel') };
        })
        // "nearby" links are stored in both directions; list each neighbour once
        .filter((l, i, all) => all.findIndex((x) => x.id === l.id && x.rel === l.rel) === i)
        .sort((a, b) => (TYPE_META[a.type] ? Object.keys(TYPE_META).indexOf(a.type) : 99) - (TYPE_META[b.type] ? Object.keys(TYPE_META).indexOf(b.type) : 99)),
    };
  }, []);

  const light = useCallback((id: string | null) => {
    const c = cy.current;
    if (!c) return;
    c.batch(() => {
      c.elements().removeClass('dim hl');
      if (!id) return;
      const n = c.getElementById(id);
      if (!n.length) return;
      let hood = n.closedNeighborhood();
      // a neighbourhood lights up its places and what they connect to
      if (n.data('type') === 'Neighborhood') hood = hood.union(hood.nodes('[type = "Place"]').closedNeighborhood());
      c.elements().not(hood).addClass('dim');
      hood.addClass('hl');
      n.addClass('hl');
    });
  }, []);

  const select = useCallback(
    (id: string | null, center = false) => {
      const c = cy.current;
      pinned.current = id;
      light(id);
      if (!c || !id) {
        setSelected(null);
        return;
      }
      const n = c.getElementById(id);
      if (!n.length) return;
      setSelected(describe(n));
      if (center) c.animate({ center: { eles: n }, zoom: Math.max(c.zoom(), full ? 1.1 : 0.9) }, { duration: 450, easing: 'ease-out-cubic' });
    },
    [describe, light, full],
  );

  // build once per graph
  useEffect(() => {
    if (!data || !layout || !box.current) return;
    const els = elements(data, layout);
    const c = cytoscape({
      container: box.current,
      elements: els.map((e) => (e.group === 'nodes' ? { ...e, position: { x: 0, y: 0 } } : e)),
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      userZoomingEnabled: full,
      // inline, the page keeps scrolling under your finger; use the buttons or go full screen to move around
      userPanningEnabled: full,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#A1A1AA',
            'font-family': '"Geist Variable", system-ui, sans-serif',
            'font-size': 15,
            'text-wrap': 'ellipsis',
            'text-max-width': '170px',
            'text-outline-color': '#0D0D10',
            'text-outline-width': 3,
            'text-opacity': 0.9,
            'border-width': 0,
            'transition-property': 'opacity, background-color, border-width',
            'transition-duration': 200,
          } as any,
        },
        { selector: '.lbl-right', style: { 'text-halign': 'right', 'text-valign': 'center', 'text-margin-x': 8 } },
        { selector: '.lbl-left', style: { 'text-halign': 'left', 'text-valign': 'center', 'text-margin-x': -8 } },
        { selector: '.lbl-top', style: { 'text-halign': 'center', 'text-valign': 'top', 'text-margin-y': -7 } },
        { selector: '.lbl-bottom', style: { 'text-halign': 'center', 'text-valign': 'bottom', 'text-margin-y': 8 } },
        { selector: '.t-City', style: { 'font-size': 22, 'font-weight': 600, color: '#EDEDEF', 'border-width': 8, 'border-color': '#FF6A3D', 'border-opacity': 0.3, 'background-color': '#FF6A3D' } as any },
        { selector: '.t-Place', style: { 'font-size': 17, 'font-weight': 500, color: '#EDEDEF', 'border-width': 4, 'border-color': '#0D0D10' } },
        { selector: '.t-Neighborhood', style: { 'font-size': 15, color: '#D4D4D8', shape: 'round-rectangle' } },
        { selector: '.t-Atmosphere, .t-Category, .t-CompanionType, .t-TimeOfDay, .t-PriceRange', style: { 'font-size': 14, 'text-opacity': 0.75 } },
        { selector: 'edge', style: { width: 1.2, 'curve-style': 'haystack', 'haystack-radius': 0, 'line-color': '#FFFFFF', 'line-opacity': 0.1, 'transition-property': 'opacity, line-color, line-opacity, width', 'transition-duration': 200 } as any },
        { selector: '.e-tree', style: { 'line-opacity': 0.22, width: 1.4 } as any },
        { selector: '.e-attr', style: { 'line-opacity': 0.06 } as any },
        { selector: '.e-near', style: { 'curve-style': 'bezier', 'line-style': 'dashed', 'line-dash-pattern': [6, 6], 'line-color': '#FF6A3D', 'line-opacity': 0.5 } as any },
        { selector: '.dim', style: { opacity: 0.1 } },
        { selector: 'node.hl', style: { 'text-opacity': 1, color: '#EDEDEF' } },
        { selector: 'edge.hl', style: { 'line-color': '#FF6A3D', 'line-opacity': 0.85, width: 2 } as any },
        { selector: 'edge.e-tree.hl', style: { 'line-color': '#FFFFFF', 'line-opacity': 0.6 } as any },
        { selector: 'node.sel', style: { 'border-width': 4, 'border-color': '#FF6A3D', 'border-opacity': 1 } as any },
        { selector: '.off', style: { display: 'none' } },
      ],
      layout: { name: 'preset' },
    });
    cy.current = c;

    // the graph unfolds from the centre
    const target = new Map(els.filter((e) => e.group === 'nodes').map((e) => [String(e.data.id), e.position!]));
    c.fit(undefined, 40);
    c.nodes().forEach((n) => {
      n.animate({ position: target.get(n.id())! }, { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900, easing: 'ease-out-cubic' });
    });
    setTimeout(() => {
      c.fit(undefined, full ? 50 : 24);
      if (focus && c.getElementById(focus).length) select(focus, true);
    }, 30);
    const fitLater = setTimeout(() => c.fit(undefined, full ? 50 : 24), 950);

    c.on('mouseover', 'node', (e) => {
      const n = e.target as NodeSingular;
      box.current && (box.current.style.cursor = 'pointer');
      setHover({ label: n.data('label'), type: n.data('type') });
      if (!pinned.current) light(n.id());
    });
    c.on('mouseout', 'node', () => {
      box.current && (box.current.style.cursor = 'default');
      setHover(null);
      light(pinned.current);
    });
    c.on('tap', 'node', (e) => {
      c.nodes().removeClass('sel');
      e.target.addClass('sel');
      select(e.target.id());
    });
    c.on('tap', (e) => {
      if (e.target === c) {
        c.nodes().removeClass('sel');
        select(null);
      }
    });
    let last = '';
    const ro = new ResizeObserver(([entry]) => {
      const key = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (key === last) return;
      last = key;
      c.resize();
      if (!pinned.current) c.fit(undefined, full ? 50 : 24);
    });
    if (box.current) ro.observe(box.current);
    return () => {
      clearTimeout(fitLater);
      ro.disconnect();
      c.destroy();
      cy.current = null;
      pinned.current = null;
      setSelected(null);
    };
    // focus is applied once per build
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layout, full]);

  // visibility toggles
  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.batch(() => {
      c.nodes().forEach((n) => {
        n.toggleClass('off', hidden.has(n.data('type')));
      });
      c.edges('.e-attr').toggleClass('off', !attrLinks);
      c.edges('.e-near').toggleClass('off', !nearLinks);
    });
  }, [hidden, attrLinks, nearLinks, data]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    data?.nodes.forEach((n) => (m[n.data.type ?? 'Other'] = (m[n.data.type ?? 'Other'] ?? 0) + 1));
    return m;
  }, [data]);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const c = cy.current;
    const q = query.trim().toLowerCase();
    if (!c || !q) return;
    const hit = c.nodes().filter((n) => String(n.data('label') ?? '').toLowerCase().includes(q)).first();
    setMiss(!hit.length);
    if (!hit.length) return;
    const t = hit.data('type');
    if (hidden.has(t)) setHidden((h) => new Set([...h].filter((x) => x !== t)));
    c.nodes().removeClass('sel');
    hit.addClass('sel');
    select(hit.id(), true);
  };

  const zoom = (k: number) => {
    const c = cy.current;
    if (!c) return;
    c.animate({ zoom: { level: Math.min(3, Math.max(0.15, c.zoom() * k)), renderedPosition: { x: c.width() / 2, y: c.height() / 2 } } }, { duration: 200 });
  };

  const meta = CITY_META[city];
  const groupId = selected?.type === 'Category' ? groupForCategoryNode(selected.id) : null;
  const linkGroups = useMemo(() => {
    const m = new Map<string, Selected['links']>();
    selected?.links.forEach((l) => {
      const k = TYPE_META[l.type]?.label ?? l.type;
      m.set(k, [...(m.get(k) ?? []), l]);
    });
    return [...m.entries()];
  }, [selected]);

  const topPlaces = useMemo(() => {
    if (!data) return [];
    const deg = new Map<string, number>();
    data.edges.forEach((e) => {
      deg.set(e.data.source!, (deg.get(e.data.source!) ?? 0) + 1);
      deg.set(e.data.target!, (deg.get(e.data.target!) ?? 0) + 1);
    });
    return data.nodes
      .filter((n) => n.data.type === 'Place')
      .map((n) => ({ id: n.data.id, label: n.data.label ?? '', hood: n.data.properties?.neighborhood as string | undefined, d: deg.get(n.data.id) ?? 0 }))
      .sort((x, y) => y.d - x.d)
      .slice(0, 6);
  }, [data]);

  const pick = (id: string) => {
    const c = cy.current;
    if (!c) return;
    c.nodes().removeClass('sel');
    c.getElementById(id).addClass('sel');
    select(id, true);
  };

  const canvas = (
    <div className="dot-bg relative min-h-[420px] overflow-hidden bg-[#0D0D10]">
      <div ref={box} className="absolute inset-0" aria-label={`Knowledge graph of ${meta.name}. Hover a node to see its links; click it to inspect it.`} role="img" />
      {!data && !error && <p className="absolute left-5 top-5 font-mono text-xs text-sand-faint">Loading graph…</p>}
      {error && <p className="absolute left-5 top-5 text-sm text-ember">Couldn't load the graph: {error}</p>}

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-sand/10 bg-ink/85 backdrop-blur">
        <button type="button" onClick={() => zoom(1.3)} className="p-2 text-sand-dim hover:bg-white/5 hover:text-sand" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => zoom(1 / 1.3)} className="border-t border-sand/10 p-2 text-sand-dim hover:bg-white/5 hover:text-sand" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => cy.current?.animate({ fit: { eles: cy.current.elements(':visible'), padding: full ? 50 : 24 } }, { duration: 300 })} className="border-t border-sand/10 p-2 text-sand-dim hover:bg-white/5 hover:text-sand" aria-label="Fit the whole graph">
          <Scan className="h-4 w-4" />
        </button>
        {!full && onExpand && (
          <button type="button" onClick={onExpand} className="border-t border-sand/10 p-2 text-sand-dim hover:bg-white/5 hover:text-sand" aria-label="Open the graph full screen">
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {hover && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-md border border-sand/10 bg-ink/90 px-2.5 py-1 text-xs text-sand backdrop-blur">
          <span className="mr-1.5 font-mono uppercase tracking-wider" style={{ color: TYPE_META[hover.type]?.color }}>{TYPE_META[hover.type]?.label ?? hover.type}</span>
          {hover.label}
        </p>
      )}
      {!full && (
        <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-sand-faint">
          {data ? `${data.nodes.length} nodes · ${data.edges.length} links` : ''}
        </p>
      )}
    </div>
  );

  const panel = (
    <aside className="flex max-h-[44vh] min-h-0 flex-col border-t border-sand/10 bg-river lg:max-h-none lg:border-l lg:border-t-0" aria-label={selected ? 'Selected node' : 'Graph controls'}>
      <form onSubmit={find} className="flex items-center gap-2 border-b border-sand/10 px-3" role="search">
        <Search className="h-4 w-4 shrink-0 text-sand-faint" aria-hidden />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMiss(false);
          }}
          placeholder="Find a place or area"
          aria-label="Find a node in the graph"
          className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
        />
        {miss && <span className="text-xs text-ember">No match</span>}
      </form>

      {selected ? (
        <div key={selected.id} className="flex min-h-0 flex-1 animate-rise flex-col [animation-duration:.3s]">
          <div className="flex items-start gap-2 border-b border-sand/10 p-4">
            <div className="min-w-0 flex-1">
              <p className="label" style={{ color: TYPE_META[selected.type]?.color }}>
                {TYPE_META[selected.type]?.label ?? selected.type}
              </p>
              <h3 className="mt-1 text-lg text-sand">{selected.label}</h3>
              {selected.type === 'Place' && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {selected.props.neighborhood && (<><dt className="text-sand-faint">Area</dt><dd className="text-sand-dim">{selected.props.neighborhood}</dd></>)}
                  {selected.props.rating != null && (<><dt className="text-sand-faint">Rating</dt><dd className="text-sand-dim">{selected.props.rating} ({Number(selected.props.user_ratings_total ?? 0).toLocaleString('en-IN')})</dd></>)}
                  {selected.props.opening_hours_text && (<><dt className="text-sand-faint">Hours</dt><dd className="text-sand-dim">{selected.props.opening_hours_text}</dd></>)}
                  <dt className="text-sand-faint">Source</dt>
                  <dd className="text-sand-dim">Curated data</dd>
                </dl>
              )}
            </div>
            <button type="button" onClick={() => { cy.current?.nodes().removeClass('sel'); select(null); }} className="rounded-md p-1 text-sand-faint hover:text-sand" aria-label="Close inspector">
              <X className="h-4 w-4" />
            </button>
          </div>
          {(selected.type === 'Place' || groupId) && (
            <div className="flex gap-2 border-b border-sand/10 px-4 py-3">
              {selected.type === 'Place' && (
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => onOpenPlace(String(selected.id).replace(/^place:/, ''))}>
                  Open place
                </button>
              )}
              {groupId && (
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => onFilterCategory(groupId)}>
                  Show these places
                </button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
            <p className="label px-2 pb-1 pt-1">{selected.links.length} {selected.links.length === 1 ? 'link' : 'links'}</p>
            {linkGroups.map(([group, items]) => (
              <div key={group} className="mb-2">
                <p className="px-2 py-1 text-[11px] text-sand-faint">{group}</p>
                <ul>
                  {items.map((l) => (
                    <li key={`${l.id}-${l.rel}`}>
                      <button type="button" onClick={() => pick(l.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-white/5">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TYPE_META[l.type]?.color ?? '#80808A' }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sand">{l.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-sand-faint">{l.rel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          <p className="label">Show</p>
          <ul className="mt-2 space-y-0.5">
            {Object.entries(TYPE_META)
              .filter(([t]) => counts[t])
              .map(([t, m]) => {
                const off = hidden.has(t);
                return (
                  <li key={t}>
                    <button
                      type="button"
                      aria-pressed={!off}
                      disabled={t === 'City'}
                      onClick={() => setHidden((h) => { const x = new Set(h); if (off) x.delete(t); else x.add(t); return x; })}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="h-2.5 w-2.5 rounded-full transition-colors" style={{ background: off ? 'transparent' : m.color, boxShadow: `inset 0 0 0 1.5px ${m.color}` }} aria-hidden />
                      <span className={`flex-1 ${off ? 'text-sand-faint' : 'text-sand'}`}>{m.label}</span>
                      <span className="font-mono text-[11px] text-sand-faint">{counts[t]}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
          <p className="label mt-5">Links</p>
          <div className="mt-2 space-y-0.5">
            <button type="button" aria-pressed={attrLinks} onClick={() => setAttrLinks((v) => !v)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5">
              <span className={`w-4 border-t ${attrLinks ? 'border-sand/60' : 'border-sand/20'}`} aria-hidden />
              <span className={attrLinks ? 'text-sand' : 'text-sand-faint'}>Place attributes</span>
            </button>
            <button type="button" aria-pressed={nearLinks} onClick={() => setNearLinks((v) => !v)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5">
              <span className={`w-4 border-t border-dashed ${nearLinks ? 'border-accent' : 'border-accent/30'}`} aria-hidden />
              <span className={nearLinks ? 'text-sand' : 'text-sand-faint'}>Places near each other</span>
            </button>
          </div>
          {topPlaces.length > 0 && (
            <>
              <p className="label mt-5">Most connected</p>
              <ol className="mt-2 space-y-0.5">
                {topPlaces.map((t, i) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => pick(t.id)}
                      onMouseEnter={() => !pinned.current && light(t.id)}
                      onMouseLeave={() => !pinned.current && light(null)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5"
                    >
                      <span className="font-mono text-[11px] text-sand-faint">{String(i + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1 truncate text-sand">{t.label}</span>
                      <span className="font-mono text-[11px] text-sand-faint">{t.d}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="mt-5 text-xs leading-relaxed text-sand-faint">Hover a node to trace its links. Click to pin it and see everything it connects to.</p>
        </div>
      )}
    </aside>
  );

  const body = (
    <div className={`grid overflow-hidden ${full ? 'min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[1fr_320px] lg:grid-rows-1' : 'rounded-xl border border-sand/10 lg:h-[680px] lg:grid-cols-[1fr_300px] [&>div:first-child]:h-[520px] lg:[&>div:first-child]:h-auto'}`}>
      {canvas}
      {panel}
    </div>
  );

  if (!full) return body;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink" role="dialog" aria-modal="true" aria-label={`Knowledge graph for ${meta.name}`}>
      <div className="flex items-center gap-3 border-b border-sand/10 px-4 py-3 sm:px-6">
        <p className="label">Knowledge graph</p>
        <h2 className="text-lg text-sand">{meta.name}</h2>
        {data?.stats && (
          <p className="hidden font-mono text-xs text-sand-faint sm:block">
            {data.nodes.length} nodes · {data.edges.length} links
          </p>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded-md p-2 text-sand-dim hover:bg-white/5 hover:text-sand" aria-label="Close graph">
          <X className="h-5 w-5" />
        </button>
      </div>
      {body}
    </div>
  );
}
