'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { getToken } from '@/hooks/use-auth';

type MappedArea = { code: string; name: string; latitude?: number; longitude?: number };
type Boundary = { name: string; geojson: unknown };

export default function GeographicAreaMap({ city, district, areas, selectedAreaCodes }: { city: string; district: string; areas: MappedArea[]; selectedAreaCodes: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const areaLayerRef = useRef<L.LayerGroup | null>(null);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setBoundaries([]);
    if (!areas.length) return () => controller.abort();
    const token = getToken();
    const orderedAreas = selectedAreaCodes.length
      ? [...areas.filter(area => selectedAreaCodes.includes(area.code)), ...areas.filter(area => !selectedAreaCodes.includes(area.code))]
      : areas;
    fetch(`/api/backend/management-zones/geographic-boundaries?city=${encodeURIComponent(city)}&areas=${encodeURIComponent(orderedAreas.map(area => area.name.replace(/ \((western|eastern) portion\)/, '')).join(','))}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
    }).then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load boundaries')))
      .then(setBoundaries)
      .catch(error => { if (error.name !== 'AbortError') setBoundaries([]); });
    return () => controller.abort();
  }, [areas, city, selectedAreaCodes]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [14.5995, 120.9842], zoom: 13, scrollWheelZoom: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20,
    }).addTo(map);
    areaLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resizeTimers = [0, 150, 500].map((delay) => window.setTimeout(() => map.invalidateSize(), delay));
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);
    return () => { resizeTimers.forEach(window.clearTimeout); resizeObserver.disconnect(); map.remove(); mapRef.current = null; areaLayerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = areaLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const mapped = areas.filter((area) => area.latitude !== undefined && area.longitude !== undefined);
    const showAllAsSelected = selectedAreaCodes.length === 0;
    const viewBounds = L.latLngBounds([]);
    boundaries.forEach((boundary) => {
      const area = areas.find(item => item.name.replace(/ \((western|eastern) portion\)/, '') === boundary.name);
      const selected = showAllAsSelected || Boolean(area && selectedAreaCodes.includes(area.code));
      const polygon = L.geoJSON(boundary.geojson as never, {
        style: {
          color: selected ? '#dc2626' : '#64748b',
          fillColor: selected ? '#ef4444' : '#cbd5e1',
          fillOpacity: selected ? 0.28 : 0.12,
          weight: selected ? 3 : 1.5,
        },
      }).bindTooltip(boundary.name, { sticky: true }).addTo(layer);
      const polygonBounds = polygon.getBounds();
      if (polygonBounds.isValid()) viewBounds.extend(polygonBounds);
    });
    mapped.forEach((area) => {
      const selected = showAllAsSelected || selectedAreaCodes.includes(area.code);
      L.circleMarker([area.latitude!, area.longitude!], {
        radius: selected ? 13 : 9,
        color: selected ? '#dc2626' : '#94a3b8',
        fillColor: selected ? '#ef4444' : '#cbd5e1',
        fillOpacity: selected ? 0.72 : 0.35,
        weight: selected ? 3 : 2,
      }).bindTooltip(area.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'area-map-label' }).addTo(layer);
    });
    if (viewBounds.isValid()) {
      map.fitBounds(viewBounds.pad(0.08), { maxZoom: 15, animate: true });
    } else if (mapped.length) {
      const bounds = L.latLngBounds(mapped.map((area) => [area.latitude!, area.longitude!] as [number, number]));
      map.fitBounds(bounds.pad(mapped.length === 1 ? 0.7 : 0.3), { maxZoom: mapped.length === 1 ? 14 : 15, animate: true });
    }
  }, [areas, selectedAreaCodes, district, boundaries]);

  return <div ref={containerRef} className="w-full bg-slate-100" style={{ height: 256, minHeight: 256, width: '100%', position: 'relative', zIndex: 0 }} role="img" aria-label={`Map of ${district} geographic areas`} />;
}
