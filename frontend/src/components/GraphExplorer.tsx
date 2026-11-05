import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import cytoscape, { type Core, type ElementDefinition, type NodeSingular } from 'cytoscape';
import { ImageOff, Maximize2, Minus, Plus, Scan, Search, Star, X } from 'lucide-react';
import { groupForCategoryNode } from '../adapter';
import { useEscape } from '../hooks';
import { CITY_META, nodeLabel } from '../meta';
import { GROUP_BY_LABEL, radialLayout, wedgePath, type GroupBy, type Layout } from '../graphLayout';
import { usePlacePhotos, type NodePhoto } from '../photos';
import type { CityId, GraphData } from '../types';

export { radialLayout } from '../graphLayout';

export const TYPE_META: Record<string, { label: string; color: string; size: number }> = {
  City: { label: 'City', color: '#EDEDEF', size: 40 },
  Sector: { label: 'Groups', color: '#EDEDEF', size: 17 },
  Neighborhood: { label: 'Neighbourhoods', color: '#A1A1AA', size: 15 },
  Place: { label: 'Places', color: '#FF6A3D', size: 21 },
  Category: { label: 'Categories', color: '#7DD3FC', size: 13 },
  Atmosphere: { label: 'Moods', color: '#C4B5FD', size: 11 },
  CompanionType: { label: 'Who it suits', color: '#3DD68C', size: 13 },
  TimeOfDay: { label: 'Time of day', color: '#FDA4AF', size: 13 },
  PriceRange: { label: 'Price', color: '#F5B941', size: 13 },
};
const TYPE_ORDER = Object.keys(TYPE_META);
const RELATION: Record<string, string> = {
  LOCATED_IN: 'in',
  IN_NEIGHBORHOOD: 'neighbourhood',
  HAS_CATEGORY: 'category',
  HAS_ATMOSPHERE: 'mood',
  SUITABLE_FOR: 'suits',
  RECOMMENDED_FOR: 'best time',
  HAS_PRICE_RANGE: 'price',
  NEARBY_TO: 'nearby',
  GROUP: 'group',
};

function elements(g: GraphData, L: Layout, groupBy: GroupBy): ElementDefinition[] {
  const type = new Map(g.nodes.map((n) => [n.data.id, n.data.type ?? '']));
  const hasHood = new Set(g.edges.filter((e) => e.data.relation === 'IN_NEIGHBORHOOD').map((e) => e.data.source));
  const grouped = groupBy !== 'area';
  const side = (id: string, t: string) => {
    const a = L.pos[id]?.a ?? 0;
    const right = Math.cos(a) > 1e-6 || (Math.abs(Math.cos(a)) <= 1e-6 && Math.sin(a) < 0);
    return t === 'City' ? 'lbl-bottom' : right ? 'lbl-right' : 'lbl-left';
  };
  const nodes: ElementDefinition[] = g.nodes.map((n) => {
    const t = n.data.type ?? '';
    return {
      group: 'nodes',
      data: { ...n.data, label: nodeLabel(n.data.label), color: L.placeColor[n.data.id] ?? TYPE_META[t]?.color ?? '#80808A', size: TYPE_META[t]?.size ?? 8 },
      position: { x: L.pos[n.data.id].x, y: L.pos[n.data.id].y },
      classes: `${side(n.data.id, t)} t-${t}${grouped && t === 'Neighborhood' ? ' gone' : ''}`,
    };
  });
  for (const h of L.hubs) {
    nodes.push({
      group: 'nodes',
      data: { id: h.id, label: `${h.label} · ${h.count}`, name: h.label, type: 'Sector', color: h.color, size: TYPE_META.Sector.size, count: h.count },
      position: { x: L.pos[h.id].x, y: L.pos[h.id].y },
      classes: `${side(h.id, 'Sector')} t-Sector`,
    });
  }
  const edges: ElementDefinition[] = g.edges
    // a place is already tied to the city through its neighbourhood or group
    .filter((e) => !(e.data.relation === 'LOCATED_IN' && type.get(e.data.source!) === 'Place' && (grouped || hasHood.has(e.data.source))))
    .map((e) => {
      const rel = e.data.relation ?? '';
      const tree = rel === 'LOCATED_IN' || rel === 'IN_NEIGHBORHOOD';
      const kind = rel === 'NEARBY_TO' ? 'e-near' : tree ? 'e-tree' : 'e-attr';
      return { group: 'edges', data: { ...e.data, rel: RELATION[rel] ?? rel.toLowerCase() }, classes: `${kind}${grouped && tree ? ' gone' : ''}` };
    });
  for (const e of L.hubEdges) edges.push({ group: 'edges', data: { id: `grp:${e.source}->${e.target}`, source: e.source, target: e.target, relation: 'GROUP', rel: 'group' }, classes: 'e-tree' });
  return [...nodes, ...edges];
}

interface Props {
  city: CityId;
  data: GraphData | null;
  error?: string | null;
  focus?: string | null;
  variant: 'inline' | 'full';
  groupBy?: GroupBy;
  onGroupBy?: (g: GroupBy) => void;
  onOpenPlace: (id: string) => void;
  onFilterCategory: (groupId: string) => void;
  onExpand?: () => void;
  onClose?: () => void;
}

interface Selected {
  id: string;
  type: string;
  label: string;
  color: string;
  props: Record<string, any>;
  places: string[];
  links: { id: string; label: string; type: string; rel: string }[];
}

interface Peek {
  id: string;
  type: string;
  label: string;
  color: string;
  props: Record<string, any>;
  places: string[];
  x: number;
  y: number;
}

/** Places directly linked to a node (for a place: itself). */
function placesOf(n: NodeSingular): string[] {
  if (n.data('type') === 'Place') return [n.id()];
  return n
    .neighborhood('node[type = "Place"]')
    .map((p) => p.id())
    .filter((id, i, all) => all.indexOf(id) === i);
}

function Photo({ photo, alt, className = '' }: { photo: NodePhoto | null | undefined; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (photo === undefined) return <div className={`skeleton ${className}`} aria-hidden />;
  if (!photo || broken)
    return (
      <div className={`dot-bg grid place-items-center bg-river-2 ${className}`} aria-hidden>
        <ImageOff className="h-5 w-5 text-sand/20" />
      </div>
    );
  return <img src={photo.src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
}

export function GraphExplorer({ city, data, error, focus, variant, groupBy: groupByProp, onGroupBy, onOpenPlace, onFilterCategory, onExpand, onClose }: Props) {
  const full = variant === 'full';
  const box = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const pinned = useRef<string | null>(null);
  const focusUsed = useRef(false);
  const [localGroup, setLocalGroup] = useState<GroupBy>(groupByProp ?? 'theme');
  const groupBy = groupByProp ?? localGroup;
  const setGroupBy = (g: GroupBy) => (onGroupBy ? onGroupBy(g) : setLocalGroup(g));
  const [selected, setSelected] = useState<Selected | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [activeSector, setActiveSector] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [wedgesOn, setWedgesOn] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set(full ? [] : ['Atmosphere']));
  const [attrLinks, setAttrLinks] = useState(true);
  const [nearLinks, setNearLinks] = useState(false);
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const close = useCallback(() => onClose?.(), [onClose]);
  useEscape(full, close);

  const layout = useMemo(() => (data ? radialLayout(data, groupBy) : null), [data, groupBy]);
  const placeIds = useMemo(() => data?.nodes.filter((n) => n.data.type === 'Place').map((n) => n.data.id) ?? [], [data]);
  const photos = usePlacePhotos(placeIds);
  const nameOf = useMemo(() => new Map(data?.nodes.map((n) => [n.data.id, n.data.label ?? '']) ?? []), [data]);
  const sectorOfPlace = useMemo(() => {
    const m = new Map<string, string>();
    layout?.sectors.forEach((s) => s.places.forEach((p) => m.set(p, s.hub)));
    return m;
  }, [layout]);

  const describe = useCallback((n: NodeSingular): Selected => {
    const id = n.id();
    return {
      id,
      type: n.data('type'),
      label: n.data('type') === 'Sector' ? n.data('name') : n.data('label'),
      color: n.data('color'),
      props: n.data('properties') ?? {},
      places: placesOf(n),
      links: n
        .connectedEdges(':visible')
        .map((e) => {
          const o = e.source().id() === id ? e.target() : e.source();
          return { id: o.id(), label: o.data('type') === 'Sector' ? o.data('name') : o.data('label'), type: o.data('type'), rel: e.data('rel') };
        })
        // "nearby" links are stored in both directions; list each neighbour once
        .filter((l, i, all) => all.findIndex((x) => x.id === l.id && x.rel === l.rel) === i)
        .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)),
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
      // only follow links that are on screen, so hidden "nearby" links don't light up other places
      const around = (eles: any): any => {
        const es = eles.connectedEdges(':visible');
        return eles.union(es).union(es.connectedNodes());
      };
      let hood = around(n);
      // a neighbourhood or group lights up its places and what they connect to
      if (['Neighborhood', 'Sector'].includes(n.data('type'))) hood = hood.union(around(hood.nodes('[type = "Place"]')));
      c.elements().not(hood).addClass('dim');
      hood.addClass('hl');
    });
  }, []);

  const sectorFor = useCallback((id: string | null) => (id ? (id.startsWith('sector:') ? id : sectorOfPlace.get(id) ?? null) : null), [sectorOfPlace]);

  const select = useCallback(
    (id: string | null, center = false) => {
      const c = cy.current;
      pinned.current = id;
      light(id);
      setActiveSector(sectorFor(id));
      c?.nodes().removeClass('sel');
      if (!c || !id) {
        setSelected(null);
        return;
      }
      const n = c.getElementById(id);
      if (!n.length) return;
      n.addClass('sel');
      setSelected(describe(n));
      setPeek(null);
      if (center) c.animate({ center: { eles: n }, zoom: Math.max(c.zoom(), full ? 1 : 0.85) }, { duration: 450, easing: 'ease-out-cubic' });
    },
    [describe, light, full, sectorFor],
  );

  // build per graph and grouping
  useEffect(() => {
    if (!data || !layout || !box.current) return;
    const els = elements(data, layout, groupBy);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
        { selector: '.lbl-bottom', style: { 'text-halign': 'center', 'text-valign': 'bottom', 'text-margin-y': 8 } },
        { selector: '.t-City', style: { 'font-size': 22, 'font-weight': 600, color: '#EDEDEF', 'border-width': 8, 'border-color': '#FF6A3D', 'border-opacity': 0.3, 'background-color': '#FF6A3D' } as any },
        { selector: '.t-Sector', style: { shape: 'round-rectangle', 'font-size': 17, 'font-weight': 600, color: 'data(color)', 'text-max-width': '220px', 'border-width': 5, 'border-color': '#0D0D10' } as any },
        { selector: '.t-Place', style: { 'font-size': 17, 'font-weight': 500, color: '#EDEDEF', 'border-width': 4, 'border-color': '#0D0D10' } },
        { selector: '.t-Neighborhood', style: { 'font-size': 15, color: '#D4D4D8', shape: 'round-rectangle' } },
        { selector: '.t-Atmosphere, .t-Category, .t-CompanionType, .t-TimeOfDay, .t-PriceRange', style: { 'font-size': 14, 'text-opacity': 0.75 } },
        { selector: 'edge', style: { width: 1.2, 'curve-style': 'haystack', 'haystack-radius': 0, 'line-color': '#FFFFFF', 'line-opacity': 0.1, 'transition-property': 'opacity, line-color, line-opacity, width', 'transition-duration': 200 } as any },
        { selector: '.e-tree', style: { 'line-opacity': 0.22, width: 1.4 } as any },
        { selector: '.e-attr', style: { 'line-opacity': 0.06 } as any },
        { selector: '.e-near', style: { 'curve-style': 'bezier', 'line-style': 'dashed', 'line-dash-pattern': [6, 6], 'line-color': '#FF6A3D', 'line-opacity': 0.5 } as any },
        { selector: '.dim', style: { opacity: 0.1 } },
        { selector: 'node.hl', style: { 'text-opacity': 1, color: '#EDEDEF' } },
        { selector: 'node.t-Sector.hl', style: { color: 'data(color)' } },
        { selector: 'edge.hl', style: { 'line-color': '#FF6A3D', 'line-opacity': 0.85, width: 2 } as any },
        { selector: 'edge.e-tree.hl', style: { 'line-color': '#FFFFFF', 'line-opacity': 0.6 } as any },
        { selector: 'node.sel', style: { 'border-width': 4, 'border-color': '#FF6A3D', 'border-opacity': 1 } as any },
        { selector: '.off, .gone', style: { display: 'none' } },
      ],
      layout: { name: 'preset' },
    });
    cy.current = c;
    setWedgesOn(false);

    const pad = full ? 50 : 24;
    const syncView = () => setView({ x: c.pan().x, y: c.pan().y, z: c.zoom() });
    c.on('viewport', syncView);

    // the graph unfolds from the centre
    const target = new Map(els.filter((e) => e.group === 'nodes').map((e) => [String(e.data.id), e.position!]));
    c.nodes().forEach((n) => {
      n.animate({ position: target.get(n.id())! }, { duration: reduced ? 0 : 850, easing: 'ease-out-cubic' });
    });
    const fitTo = () => c.fit(c.elements(':visible'), pad);
    // fit to where nodes are going, not where they start
    const t0 = setTimeout(() => {
      c.nodes().forEach((n) => {
        n.stop(true, true);
      });
      fitTo();
      syncView();
      setWedgesOn(true);
      if (focus && !focusUsed.current && c.getElementById(focus).length) {
        focusUsed.current = true;
        select(focus, true);
      }
    }, reduced ? 20 : 900);
    // a quick preview fit while the nodes travel
    c.fit(undefined, pad);

    c.on('mouseover', 'node', (e) => {
      const n = e.target as NodeSingular;
      if (box.current) box.current.style.cursor = 'pointer';
      const rp = n.renderedPosition();
      const t = n.data('type');
      if (t !== 'City')
        setPeek({ id: n.id(), type: t, label: t === 'Sector' ? n.data('name') : n.data('label'), color: n.data('color'), props: n.data('properties') ?? {}, places: placesOf(n), x: rp.x, y: rp.y });
      if (!pinned.current) {
        light(n.id());
        setActiveSector(sectorFor(n.id()));
      }
    });
    c.on('mouseout', 'node', () => {
      if (box.current) box.current.style.cursor = 'default';
      setPeek(null);
      light(pinned.current);
      setActiveSector(sectorFor(pinned.current));
    });
    c.on('tap', 'node', (e) => select(e.target.id()));
    c.on('tap', (e) => {
      if (e.target === c) select(null);
    });
    c.on('pan zoom', () => setPeek(null));
    let last = '';
    const ro = new ResizeObserver(([entry]) => {
      const key = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (key === last) return;
      last = key;
      c.resize();
      if (!pinned.current) fitTo();
    });
    if (box.current) ro.observe(box.current);
    return () => {
      clearTimeout(t0);
      ro.disconnect();
      c.destroy();
      cy.current = null;
      pinned.current = null;
      setSelected(null);
      setPeek(null);
      setActiveSector(null);
    };
    // focus is applied once; select/light are stable for a given layout
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
  }, [hidden, attrLinks, nearLinks, layout]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    data?.nodes.forEach((n) => (m[n.data.type ?? 'Other'] = (m[n.data.type ?? 'Other'] ?? 0) + 1));
    return m;
  }, [data]);

  const pick = (id: string) => select(id, true);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const c = cy.current;
    const q = query.trim().toLowerCase();
    if (!c || !q) return;
    const hit = c
      .nodes(':visible, .off')
      .filter((n) => !n.hasClass('gone') && String(n.data('name') ?? n.data('label') ?? '').toLowerCase().includes(q))
      .first();
    setMiss(!hit.length);
    if (!hit.length) return;
    const t = hit.data('type');
    if (hidden.has(t)) setHidden((h) => new Set([...h].filter((x) => x !== t)));
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
    return placeIds
      .map((id) => ({ id, label: nameOf.get(id) ?? '', d: deg.get(id) ?? 0 }))
      .sort((x, y) => y.d - x.d)
      .slice(0, 5);
  }, [data, placeIds, nameOf]);

  const groups = useMemo(() => {
    if (!layout) return [];
    const list = layout.sectors.filter((s) => s.places.length > 0);
    return groupBy === 'area' ? [...list].sort((a, b) => b.places.length - a.places.length).slice(0, 8) : list;
  }, [layout, groupBy]);

  /* ---------- pieces ---------- */

  const thumbs = (ids: string[], n: number, size: string) => (
    <span className="flex -space-x-1.5" aria-hidden>
      {ids.slice(0, n).map((id) => (
        <span key={id} className={`overflow-hidden rounded-md border-2 border-river ${size}`}>
          <Photo photo={photos[id]} alt="" className="h-full w-full" />
        </span>
      ))}
    </span>
  );

  const peekCard = peek && box.current && (() => {
    const W = box.current.clientWidth;
    const H = box.current.clientHeight;
    const cw = 264;
    const ch = peek.type === 'Place' ? 252 : 214;
    const left = peek.x + 22 + cw > W ? Math.max(8, peek.x - cw - 22) : peek.x + 22;
    const top = Math.min(Math.max(8, peek.y - ch / 2), Math.max(8, H - ch - 8));
    const sector = layout?.sectors.find((s) => s.hub === sectorOfPlace.get(peek.id));
    return (
      <div className="pointer-events-none absolute z-20 w-[264px] animate-pop overflow-hidden rounded-xl border border-sand/15 bg-ink/95 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur [animation-duration:.18s]" style={{ left, top }} role="tooltip">
        {peek.type === 'Place' ? (
          <>
            <Photo photo={photos[peek.id]} alt={peek.label} className="aspect-[16/9] w-full" />
            <div className="p-3">
              {sector && groupBy !== 'area' && (
                <p className="label" style={{ color: sector.color }}>
                  {sector.label}
                </p>
              )}
              <p className="mt-0.5 font-medium leading-snug text-sand">{peek.label}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-sand-dim">
                {peek.props.neighborhood && <span>{peek.props.neighborhood}</span>}
                {peek.props.rating != null && (
                  <span className="inline-flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-saffron text-saffron" aria-hidden /> {peek.props.rating}
                  </span>
                )}
              </p>
              {photos[peek.id]?.credit && <p className="mt-1 truncate text-[10px] text-sand-faint">Photo: {photos[peek.id]!.credit}</p>}
            </div>
          </>
        ) : (
          <div className="p-3">
            <p className="label" style={{ color: peek.color }}>
              {TYPE_META[peek.type]?.label ?? peek.type}
            </p>
            <p className="mt-0.5 font-medium text-sand">{peek.label}</p>
            <p className="mt-0.5 text-xs text-sand-faint">
              {peek.places.length} {peek.places.length === 1 ? 'place' : 'places'}
            </p>
            {peek.places.length > 0 && (
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {peek.places.slice(0, 6).map((id) => (
                  <div key={id} className="overflow-hidden rounded-md">
                    <Photo photo={photos[id]} alt={nameOf.get(id) ?? ''} className="aspect-square w-full" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  })();

  const wedges = layout && groupBy !== 'area' && (
    <svg className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500 ${wedgesOn ? 'opacity-100' : 'opacity-0'}`} aria-hidden>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
        {layout.sectors.map((s) => {
          const on = activeSector === s.hub;
          return (
            <path
              key={s.id}
              d={wedgePath(layout.rings.r1 - 46, layout.rings.r2 + 40, s.start, s.end)}
              fill={s.color}
              fillOpacity={on ? 0.16 : activeSector ? 0.03 : 0.07}
              stroke={s.color}
              strokeOpacity={on ? 0.6 : 0.22}
              strokeWidth={1.2 / view.z}
              style={{ transition: 'fill-opacity .25s, stroke-opacity .25s' }}
            />
          );
        })}
      </g>
    </svg>
  );

  const canvas = (
    <div className="dot-bg relative min-h-[420px] overflow-hidden bg-[#0D0D10]">
      {wedges}
      <div ref={box} className="absolute inset-0" aria-label={`Knowledge graph of ${meta.name}, grouped by ${GROUP_BY_LABEL[groupBy].toLowerCase()}. Hover a node to preview it; click it to inspect it.`} role="img" />
      {!data && !error && <p className="absolute left-5 top-5 font-mono text-xs text-sand-faint">Loading graph…</p>}
      {error && <p className="absolute left-5 top-5 text-sm text-ember">Couldn't load the graph: {error}</p>}
      {peekCard}

      <div role="group" aria-label="Group places by" className="absolute left-3 top-3 flex rounded-lg border border-sand/10 bg-ink/85 p-0.5 backdrop-blur">
        {(['theme', 'audience', 'area'] as GroupBy[]).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={groupBy === g}
            onClick={() => setGroupBy(g)}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${groupBy === g ? 'bg-white/[0.1] text-sand' : 'text-sand-faint hover:text-sand'}`}
          >
            {GROUP_BY_LABEL[g]}
          </button>
        ))}
      </div>

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

      {!full && (
        <p className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-sand-faint">
          {data ? `${data.nodes.length} nodes · ${data.edges.length} links` : ''}
        </p>
      )}
    </div>
  );

  const inspector = selected && (
    <div key={selected.id} className="flex min-h-0 flex-1 animate-rise flex-col [animation-duration:.3s]">
      {selected.type === 'Place' && <Photo photo={photos[selected.id]} alt={selected.label} className="aspect-[16/9] w-full shrink-0" />}
      <div className="flex items-start gap-2 border-b border-sand/10 p-4">
        <div className="min-w-0 flex-1">
          <p className="label" style={{ color: selected.type === 'Sector' || selected.type === 'Place' ? selected.color : TYPE_META[selected.type]?.color }}>
            {selected.type === 'Place' && groupBy !== 'area' ? layout?.sectors.find((s) => s.hub === sectorOfPlace.get(selected.id))?.label : TYPE_META[selected.type]?.label ?? selected.type}
          </p>
          <h3 className="mt-1 text-lg text-sand">{selected.label}</h3>
          {selected.type === 'Place' && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {selected.props.neighborhood && (<><dt className="text-sand-faint">Area</dt><dd className="text-sand-dim">{selected.props.neighborhood}</dd></>)}
              {selected.props.rating != null && (<><dt className="text-sand-faint">Rating</dt><dd className="text-sand-dim">{selected.props.rating} ({Number(selected.props.user_ratings_total ?? 0).toLocaleString('en-IN')})</dd></>)}
              {selected.props.opening_hours_text && (<><dt className="text-sand-faint">Hours</dt><dd className="text-sand-dim">{selected.props.opening_hours_text}</dd></>)}
              <dt className="text-sand-faint">Source</dt>
              <dd className="text-sand-dim">Curated data{photos[selected.id]?.credit ? ` · photo ${photos[selected.id]!.credit}` : ''}</dd>
            </dl>
          )}
          {selected.type !== 'Place' && (
            <p className="mt-1 text-xs text-sand-faint">
              {selected.places.length} {selected.places.length === 1 ? 'place' : 'places'}
            </p>
          )}
        </div>
        <button type="button" onClick={() => select(null)} className="rounded-md p-1 text-sand-faint hover:text-sand" aria-label="Close inspector">
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
        {selected.type !== 'Place' && selected.places.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 p-2">
            {selected.places.map((id) => (
              <button key={id} type="button" onClick={() => pick(id)} className="group overflow-hidden rounded-lg border border-sand/10 text-left transition-colors hover:border-sand/30">
                <Photo photo={photos[id]} alt="" className="aspect-[4/3] w-full transition-transform duration-500 group-hover:scale-[1.04]" />
                <span className="block truncate px-2 py-1.5 text-xs text-sand">{nameOf.get(id)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="label px-2 pb-1 pt-1">
          {selected.links.length} {selected.links.length === 1 ? 'link' : 'links'}
        </p>
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
  );

  const overview = (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
      <p className="label">{groupBy === 'area' ? 'Busiest neighbourhoods' : groupBy === 'theme' ? 'Sectors by theme' : "Sectors by who it's for"}</p>
      <ul className="mt-2 space-y-0.5">
        {groups.map((s) => (
          <li key={s.hub}>
            <button
              type="button"
              onClick={() => pick(s.hub)}
              onMouseEnter={() => {
                if (pinned.current) return;
                light(s.hub);
                setActiveSector(s.hub);
              }}
              onMouseLeave={() => {
                if (pinned.current) return;
                light(null);
                setActiveSector(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sand">{s.label}</span>
              {thumbs(s.places, 3, 'h-6 w-6')}
              <span className="w-5 text-right font-mono text-[11px] text-sand-faint">{s.places.length}</span>
            </button>
          </li>
        ))}
      </ul>
      {groupBy === 'audience' && <p className="mt-2 px-2 text-[11px] leading-relaxed text-sand-faint">Each place sits with the group the curated data lists first; most places suit several.</p>}

      <p className="label mt-5">Show</p>
      <ul className="mt-2 space-y-0.5">
        {Object.entries(TYPE_META)
          .filter(([t]) => counts[t] && t !== 'City' && !(groupBy !== 'area' && t === 'Neighborhood'))
          .map(([t, m]) => {
            const off = hidden.has(t);
            return (
              <li key={t}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => setHidden((h) => { const x = new Set(h); if (off) x.delete(t); else x.add(t); return x; })}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/5"
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
            {topPlaces.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => pick(t.id)}
                  onMouseEnter={() => !pinned.current && light(t.id)}
                  onMouseLeave={() => !pinned.current && light(null)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5"
                >
                  <span className="h-7 w-7 shrink-0 overflow-hidden rounded-md">
                    <Photo photo={photos[t.id]} alt="" className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sand">{t.label}</span>
                  <span className="font-mono text-[11px] text-sand-faint">{t.d}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-5 text-xs leading-relaxed text-sand-faint">Hover a node to preview it with photos. Click to pin it and see everything it connects to.</p>
    </div>
  );

  const panel = (
    <aside className="flex max-h-[48vh] min-h-0 flex-col border-t border-sand/10 bg-river lg:max-h-none lg:border-l lg:border-t-0" aria-label={selected ? 'Selected node' : 'Graph controls'}>
      <form onSubmit={find} className="flex items-center gap-2 border-b border-sand/10 px-3" role="search">
        <Search className="h-4 w-4 shrink-0 text-sand-faint" aria-hidden />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMiss(false);
          }}
          placeholder="Find a place, group or area"
          aria-label="Find a node in the graph"
          className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
        />
        {miss && <span className="text-xs text-ember">No match</span>}
      </form>
      {selected ? inspector : overview}
    </aside>
  );

  const body = (
    <div className={`grid overflow-hidden ${full ? 'min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[1fr_340px] lg:grid-rows-1' : 'rounded-xl border border-sand/10 lg:h-[720px] lg:grid-cols-[1fr_320px] [&>div:first-child]:h-[540px] lg:[&>div:first-child]:h-auto'}`}>
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
        {data && (
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
