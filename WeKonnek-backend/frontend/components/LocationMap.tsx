'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface LocationMapProps {
  selectedLocation: [number, number] | null;
  defaultCenter: [number, number];
  onMapClick: (lat: number, lng: number) => void;
  onMarkerDrag: (event: L.DragEndEvent) => void;
  selectedZoom?: number;
}

const pinIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:26px;height:26px;border:4px solid white;border-radius:50% 50% 50% 0;background:#ff0719;box-shadow:0 4px 12px rgba(15,23,42,.28);transform:rotate(-45deg)"><span style="display:block;width:6px;height:6px;margin:6px;border-radius:9999px;background:white"></span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

export default function LocationMap({
  selectedLocation,
  defaultCenter,
  onMapClick,
  onMarkerDrag,
  selectedZoom = 15,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const callbacksRef = useRef({ onMapClick, onMarkerDrag });
  const initialRef = useRef({ selectedLocation, defaultCenter, selectedZoom });

  useEffect(() => {
    callbacksRef.current = { onMapClick, onMarkerDrag };
  }, [onMapClick, onMarkerDrag]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const initial = initialRef.current;
    const map = L.map(container, {
      center: initial.selectedLocation ?? initial.defaultCenter,
      zoom: initial.selectedLocation ? initial.selectedZoom : 10,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 20,
    }).addTo(map);
    map.on('click', event => callbacksRef.current.onMapClick(event.latlng.lat, event.latlng.lng));
    mapRef.current = map;

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(resizeTimer);
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLocation) return;

    if (!markerRef.current) {
      const marker = L.marker(selectedLocation, { draggable: true, icon: pinIcon }).addTo(map);
      marker.on('dragend', event => callbacksRef.current.onMarkerDrag(event as L.DragEndEvent));
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(selectedLocation);
    }
    map.setView(selectedLocation, selectedZoom, { animate: true });
  }, [selectedLocation, selectedZoom]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Select coverage location on map" />;
}
