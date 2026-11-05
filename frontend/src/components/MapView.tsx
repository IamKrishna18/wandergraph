import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  dim?: boolean;
}

interface Props {
  points: MapPoint[];
  center: [number, number];
  area?: { latitude: number; longitude: number; radius_km: number; name: string } | null;
  route?: boolean;
  onSelect?: (id: string) => void;
  className?: string;
  ariaLabel: string;
}

/** Dark Leaflet map with numbered pins; optional route line in visiting order. */
const ACCENT = '#FF6A3D';

export function MapView({ points, center, area, route = false, onSelect, className = '', ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(center, 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    const latlngs: L.LatLngExpression[] = [];
    for (const p of points) {
      const icon = L.divIcon({ className: '', html: `<div class="wg-pin${p.dim ? ' dim' : ''}"><span>${p.label}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker([p.lat, p.lng], { icon, title: p.title, keyboard: true, alt: p.title }).addTo(lg);
      marker.bindTooltip(p.title, { direction: 'top', offset: [0, -14] });
      marker.on('click', () => select.current?.(p.id));
      latlngs.push([p.lat, p.lng]);
    }
    if (area) {
      L.circle([area.latitude, area.longitude], {
        radius: area.radius_km * 1000,
        color: ACCENT,
        weight: 2,
        fillOpacity: 0.08,
        dashArray: '4 6',
      })
        .bindTooltip(area.name, { permanent: true, direction: 'center', className: 'wg-area-label' })
        .addTo(lg);
      latlngs.push([area.latitude, area.longitude]);
    }
    if (route && latlngs.length > 1) {
      L.polyline(latlngs, { color: ACCENT, weight: 2.5, dashArray: '6 8', opacity: 0.9 }).addTo(lg);
    }
    if (latlngs.length) m.fitBounds(L.latLngBounds(latlngs as L.LatLngTuple[]).pad(0.25), { maxZoom: 15 });
    else m.setView(center, 12);
    setTimeout(() => m.invalidateSize(), 50);
  }, [points, route, center, area]);

  return <div ref={el} role="region" aria-label={ariaLabel} className={`overflow-hidden rounded-xl border border-sand/10 ${className}`} />;
}
