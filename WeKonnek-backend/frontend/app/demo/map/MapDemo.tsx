'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Circle,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons in Next.js
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const startIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const endIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const poiIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

type LatLng = { lat: number; lng: number };
type RouteInfo = {
  distance: string;
  duration: string;
  steps: { instruction: string; distance: string }[];
  geometry: [number, number][];
};
type POI = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  location: LatLng;
  distance: { text: string };
  address: string;
  brand: string | null;
};

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function MapClickHandler({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) });
  return null;
}

export default function MapDemo() {
  const [mode, setMode] = useState<'route' | 'nearby' | 'geocode'>('route');
  const [startPoint, setStartPoint] = useState<LatLng | null>(null);
  const [endPoint, setEndPoint] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [searchCenter, setSearchCenter] = useState<LatLng | null>(null);
  const [searchRadius, setSearchRadius] = useState(2000);
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [geocodeQuery, setGeocodeQuery] = useState('');
  const [geocodeResults, setGeocodeResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSteps, setShowSteps] = useState(false);
  const mapRef = useRef<any>(null);

  const handleMapClick = useCallback(
    (latlng: LatLng) => {
      if (mode === 'route') {
        if (!startPoint) {
          setStartPoint(latlng);
          setRoute(null);
        } else if (!endPoint) {
          setEndPoint(latlng);
        } else {
          setStartPoint(latlng);
          setEndPoint(null);
          setRoute(null);
        }
      } else if (mode === 'nearby') {
        setSearchCenter(latlng);
        setPois([]);
      }
    },
    [mode, startPoint, endPoint],
  );

  const fetchRoute = useCallback(async () => {
    if (!startPoint || !endPoint) return;
    setLoading(true);
    setError('');
    try {
      const coords = `${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}`;
      const res = await fetch(`/api/routing/route/v1/driving/${coords}?steps=true&overview=full&geometries=polyline`);
      const data = await res.json();
      if (data.status === 'ok' && data.routes?.length) {
        const r = data.routes[0];
        const geometry = typeof r.geometry === 'string' ? decodePolyline(r.geometry) : [];
        setRoute({
          distance: r.distance.text,
          duration: r.duration.text,
          steps: r.legs?.[0]?.steps?.map((s: any) => ({
            instruction: s.instruction,
            distance: s.distance.text,
          })) || [],
          geometry,
        });
      } else {
        setError(data.message || 'No route found');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch route');
    } finally {
      setLoading(false);
    }
  }, [startPoint, endPoint]);

  useEffect(() => {
    if (startPoint && endPoint) fetchRoute();
  }, [startPoint, endPoint, fetchRoute]);

  const fetchNearby = useCallback(async () => {
    if (!searchCenter) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        lat: String(searchCenter.lat),
        lng: String(searchCenter.lng),
        radius: String(searchRadius),
      });
      if (category) params.set('category', category);
      if (keyword) params.set('q', keyword);
      const res = await fetch(`/api/routing/nearby?${params}`);
      const data = await res.json();
      if (data.status === 'ok') {
        setPois(data.results || []);
        if (!data.results?.length) setError('No POIs found in this area');
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search');
    } finally {
      setLoading(false);
    }
  }, [searchCenter, searchRadius, category, keyword]);

  const fetchGeocode = useCallback(async () => {
    if (!geocodeQuery.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/routing/geocode?q=${encodeURIComponent(geocodeQuery)}`);
      const data = await res.json();
      if (data.status === 'ok') {
        setGeocodeResults(data.results || []);
        if (data.results?.length && mapRef.current) {
          const first = data.results[0];
          mapRef.current.setView([first.location.lat, first.location.lng], 15);
        }
        if (!data.results?.length) setError('No results found');
      } else {
        setError(data.error || 'Geocode failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to geocode');
    } finally {
      setLoading(false);
    }
  }, [geocodeQuery]);

  const clearAll = () => {
    setStartPoint(null);
    setEndPoint(null);
    setRoute(null);
    setPois([]);
    setSearchCenter(null);
    setGeocodeResults([]);
    setError('');
    setShowSteps(false);
  };

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <div className="w-96 flex flex-col border-r border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 bg-gray-900">
          <h1 className="text-xl font-bold text-emerald-400">WeKonnek Routing Demo</h1>
          <p className="text-xs text-gray-400 mt-1">Self-hosted Google Maps alternative</p>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-gray-800">
          {(['route', 'nearby', 'geocode'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); clearAll(); }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === m
                  ? 'text-emerald-400 border-b-2 border-emerald-400 bg-gray-900'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900/50'
              }`}
            >
              {m === 'route' ? 'Directions' : m === 'nearby' ? 'Nearby' : 'Search'}
            </button>
          ))}
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mode === 'route' && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
                  <div className="flex-1 text-sm bg-gray-800 rounded px-3 py-2">
                    {startPoint
                      ? `${startPoint.lat.toFixed(4)}, ${startPoint.lng.toFixed(4)}`
                      : 'Click map to set start'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
                  <div className="flex-1 text-sm bg-gray-800 rounded px-3 py-2">
                    {endPoint
                      ? `${endPoint.lat.toFixed(4)}, ${endPoint.lng.toFixed(4)}`
                      : 'Click map to set destination'}
                  </div>
                </div>
              </div>

              {/* Quick presets */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Quick test routes:</p>
                <div className="space-y-1.5">
                  {[
                    { label: 'Manila → Makati', s: { lat: 14.5995, lng: 120.9842 }, e: { lat: 14.5547, lng: 121.0244 } },
                    { label: 'Makati → BGC', s: { lat: 14.5547, lng: 121.0244 }, e: { lat: 14.5500, lng: 121.0454 } },
                    { label: 'QC → Manila', s: { lat: 14.6569, lng: 121.0295 }, e: { lat: 14.5995, lng: 120.9842 } },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setStartPoint(preset.s);
                        setEndPoint(preset.e);
                        setRoute(null);
                        mapRef.current?.fitBounds([
                          [preset.s.lat, preset.s.lng],
                          [preset.e.lat, preset.e.lng],
                        ], { padding: [50, 50] });
                      }}
                      className="w-full text-left px-3 py-2 text-sm rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {route && (
                <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-400 font-semibold text-lg">{route.distance}</span>
                    <span className="text-gray-300">{route.duration}</span>
                  </div>
                  {route.steps.length > 0 && (
                    <button
                      onClick={() => setShowSteps(!showSteps)}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      {showSteps ? 'Hide' : 'Show'} {route.steps.length} turn-by-turn steps
                    </button>
                  )}
                  {showSteps && (
                    <div className="space-y-1 mt-2 max-h-60 overflow-y-auto">
                      {route.steps.map((step, i) => (
                        <div key={i} className="flex gap-2 text-xs py-1 border-b border-gray-800 last:border-0">
                          <span className="text-gray-500 w-5 shrink-0">{i + 1}.</span>
                          <span className="flex-1 text-gray-300">{step.instruction}</span>
                          <span className="text-gray-500 shrink-0">{step.distance}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {mode === 'nearby' && (
            <>
              <p className="text-sm text-gray-400">Click the map to set search center, then press Search.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  >
                    <option value="">All categories</option>
                    <option value="food">Food & Drink</option>
                    <option value="shopping">Shopping</option>
                    <option value="health">Health</option>
                    <option value="transport">Transport</option>
                    <option value="finance">Finance</option>
                    <option value="education">Education</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Keyword (optional)</label>
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="e.g. Jollibee, Starbucks..."
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Radius: {searchRadius >= 1000 ? `${(searchRadius/1000).toFixed(1)} km` : `${searchRadius}m`}</label>
                  <input
                    type="range"
                    min={500}
                    max={10000}
                    step={500}
                    value={searchRadius}
                    onChange={(e) => setSearchRadius(Number(e.target.value))}
                    className="w-full mt-1"
                  />
                </div>
                <button
                  onClick={fetchNearby}
                  disabled={!searchCenter || loading}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium text-sm transition-colors"
                >
                  {loading ? 'Searching...' : `Search Nearby${searchCenter ? '' : ' (click map first)'}`}
                </button>
              </div>

              {/* Quick preset locations */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Quick locations:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Makati', lat: 14.5547, lng: 121.0244 },
                    { label: 'Manila', lat: 14.5995, lng: 120.9842 },
                    { label: 'BGC', lat: 14.5500, lng: 121.0454 },
                    { label: 'QC', lat: 14.6569, lng: 121.0295 },
                  ].map((loc) => (
                    <button
                      key={loc.label}
                      onClick={() => {
                        setSearchCenter({ lat: loc.lat, lng: loc.lng });
                        mapRef.current?.setView([loc.lat, loc.lng], 15);
                      }}
                      className="px-2.5 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      {loc.label}
                    </button>
                  ))}
                </div>
              </div>

              {pois.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-emerald-400">{pois.length} places found</p>
                  {pois.map((poi) => (
                    <div
                      key={poi.id}
                      onClick={() => mapRef.current?.setView([poi.location.lat, poi.location.lng], 17)}
                      className="bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-750 transition-colors border border-gray-700 hover:border-gray-600"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-sm">{poi.name}</p>
                          <p className="text-xs text-gray-400">{poi.subcategory} {poi.brand ? `· ${poi.brand}` : ''}</p>
                        </div>
                        <span className="text-xs text-emerald-400 shrink-0 ml-2">{poi.distance.text}</span>
                      </div>
                      {poi.address && <p className="text-xs text-gray-500 mt-1">{poi.address}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'geocode' && (
            <>
              <div className="flex gap-2">
                <input
                  value={geocodeQuery}
                  onChange={(e) => setGeocodeQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchGeocode()}
                  placeholder="Search for a place..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={fetchGeocode}
                  disabled={loading || !geocodeQuery.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 rounded text-sm font-medium transition-colors"
                >
                  {loading ? '...' : 'Go'}
                </button>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Try searching:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Jollibee Ayala', 'SM City Cebu', 'Makati Medical', 'Mercury Drug', 'Greenbelt'].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setGeocodeQuery(q); }}
                      className="px-2.5 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {geocodeResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-emerald-400">{geocodeResults.length} results</p>
                  {geocodeResults.map((r: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => mapRef.current?.setView([r.location.lat, r.location.lng], 16)}
                      className="bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-750 transition-colors border border-gray-700 hover:border-gray-600"
                    >
                      <p className="font-medium text-sm">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.display_name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {r.location.lat.toFixed(4)}, {r.location.lng.toFixed(4)}
                        {r.category ? ` · ${r.category}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded p-3 text-sm text-red-300">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-900">
          <button onClick={clearAll} className="w-full py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors">
            Clear All
          </button>
          <div className="flex justify-between mt-2 text-[10px] text-gray-600">
            <span>OSRM + PostGIS + Leaflet</span>
            <span>Routing API: localhost:3100</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[14.5995, 120.9842]}
          zoom={12}
          className="h-full w-full"
          ref={mapRef}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <MapClickHandler onMapClick={handleMapClick} />

          {startPoint && (
            <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon}>
              <Popup>Start Point</Popup>
            </Marker>
          )}
          {endPoint && (
            <Marker position={[endPoint.lat, endPoint.lng]} icon={endIcon}>
              <Popup>Destination</Popup>
            </Marker>
          )}

          {route?.geometry && (
            <Polyline positions={route.geometry} color="#10b981" weight={5} opacity={0.8} />
          )}

          {searchCenter && mode === 'nearby' && (
            <>
              <Marker position={[searchCenter.lat, searchCenter.lng]} icon={defaultIcon}>
                <Popup>Search Center</Popup>
              </Marker>
              <Circle
                center={[searchCenter.lat, searchCenter.lng]}
                radius={searchRadius}
                pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.08, weight: 1 }}
              />
            </>
          )}

          {pois.map((poi) => (
            <Marker key={poi.id} position={[poi.location.lat, poi.location.lng]} icon={poiIcon}>
              <Popup>
                <div className="text-sm">
                  <strong>{poi.name}</strong>
                  <br />
                  <span className="text-gray-500">{poi.subcategory} · {poi.distance.text}</span>
                  {poi.address && <><br /><span className="text-gray-500">{poi.address}</span></>}
                </div>
              </Popup>
            </Marker>
          ))}

          {geocodeResults.map((r: any, i: number) => (
            <Marker key={i} position={[r.location.lat, r.location.lng]} icon={poiIcon}>
              <Popup>
                <div className="text-sm">
                  <strong>{r.name}</strong>
                  <br />
                  <span className="text-gray-500">{r.display_name}</span>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {loading && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 rounded-full px-4 py-2 text-sm text-emerald-400 shadow-lg z-[1000]">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
