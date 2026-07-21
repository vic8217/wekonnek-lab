'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { merchantsApi, Merchant } from '@/lib/api';

import 'leaflet/dist/leaflet.css';

const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), { ssr: false });

export default function CustomerMapPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState<[number, number]>([14.5995, 120.9842]);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const leafletRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('leaflet').then((L) => {
        delete (L.default.Icon.Default.prototype as any)._getIconUrl;
        L.default.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        });
        leafletRef.current = L.default;
        setLeafletLoaded(true);
      });
    }
  }, []);

  const createMerchantIcon = (color: string = '#DB0002') => {
    if (!leafletLoaded || !leafletRef.current) return null;
    return leafletRef.current.divIcon({
      className: 'custom-marker',
      html: `
        <div style="
          background-color: ${color};
          width: 30px;
          height: 30px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          <div style="
            transform: rotate(45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            color: white;
            font-weight: bold;
            font-size: 14px;
          ">📍</div>
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30],
    });
  };

  useEffect(() => {
    const fetchMerchants = async () => {
      try {
        setLoading(true);
        const response = await merchantsApi.search({ limit: 100, page: 1 });
        const allMerchants = response.data || [];
        const merchantsWithLocation = allMerchants.filter(
          (m) => m.latitude && m.longitude && !isNaN(Number(m.latitude)) && !isNaN(Number(m.longitude))
        );
        setMerchants(merchantsWithLocation);
        if (merchantsWithLocation.length > 0) {
          setMapCenter([Number(merchantsWithLocation[0].latitude), Number(merchantsWithLocation[0].longitude)]);
        }
      } catch (error) {
        console.error('Failed to fetch merchants:', error);
        setMerchants([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMerchants();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setMapCenter([position.coords.latitude, position.coords.longitude]);
        },
        () => console.log('Using default location')
      );
    }
  }, []);

  const filteredMerchants = searchQuery.trim()
    ? merchants.filter((m) =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.category?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.city?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : merchants;

  return (
    <div className="relative">
      {/* Mobile Map View */}
      <div className="lg:hidden">
        {/* Search overlay */}
        <div className="absolute top-2 left-3 right-3 z-[1000]">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search nearby merchants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white rounded-full text-sm shadow-lg border border-gray-200 outline-none focus:ring-2 focus:ring-[#DB0002]/30"
            />
          </div>
        </div>

        {/* Map */}
        <div style={{ height: 'calc(100vh - 180px)' }}>
          {loading || !leafletLoaded ? (
            <div className="flex items-center justify-center h-full bg-gray-100">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-500">Loading map...</p>
              </div>
            </div>
          ) : (
            <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', zIndex: 0 }} scrollWheelZoom={true}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {filteredMerchants.map((merchant) => {
                if (!merchant.latitude || !merchant.longitude) return null;
                const lat = Number(merchant.latitude);
                const lng = Number(merchant.longitude);
                if (isNaN(lat) || isNaN(lng)) return null;
                const icon = createMerchantIcon('#DB0002');
                if (!icon) return null;
                return (
                  <Marker key={merchant.id} position={[lat, lng]} icon={icon}>
                    <Popup>
                      <div className="p-1 min-w-[180px]">
                        <Link href={`/merchants/${merchant.slug}`}>
                          <h3 className="font-bold text-gray-900 text-sm hover:text-[#DB0002]">{merchant.name}</h3>
                        </Link>
                        {merchant.coverImageUrl && (
                          <img src={merchant.coverImageUrl} alt={merchant.name} className="w-full h-20 object-cover rounded mt-1 mb-1" />
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          {merchant.rating && Number(merchant.rating) > 0 && (
                            <span className="text-xs font-semibold text-[#DB0002]">⭐ {Number(merchant.rating).toFixed(1)}</span>
                          )}
                          {merchant.category && <span className="text-[10px] text-gray-500">{merchant.category.name}</span>}
                        </div>
                        {merchant.address && <p className="text-[10px] text-gray-500 mt-0.5">📍 {merchant.address}</p>}
                        <Link href={`/merchants/${merchant.slug}`} className="text-xs text-[#165BB8] hover:underline mt-1 block">
                          View Details →
                        </Link>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          )}
        </div>

        {/* Bottom merchant info cards (scrollable) */}
        {!loading && filteredMerchants.length > 0 && (
          <div className="absolute bottom-2 left-0 right-0 z-[1000]">
            <div className="flex gap-2 overflow-x-auto px-3 no-scrollbar">
              {filteredMerchants.slice(0, 8).map((merchant) => (
                <Link
                  key={merchant.id}
                  href={`/merchants/${merchant.slug}`}
                  className="flex-shrink-0 w-52 bg-white rounded-xl shadow-lg p-2.5 border border-gray-100"
                >
                  <div className="flex gap-2">
                    <div className="w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200">
                      {merchant.coverImageUrl ? (
                        <img src={merchant.coverImageUrl} alt={merchant.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg">🏪</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-gray-900 truncate">{merchant.name}</h4>
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <svg className="w-3 h-3 text-yellow-400 fill-current" viewBox="0 0 20 20">
                          <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                        </svg>
                        <span className="text-[10px] font-semibold">{merchant.rating && Number(merchant.rating) > 0 ? Number(merchant.rating).toFixed(1) : '4.8'}</span>
                      </div>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">{merchant.category?.name || 'Service'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Map View */}
      <div className="hidden lg:block">
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Explore Map</h1>
          <p className="text-gray-600">Find nearby merchants and services around you</p>
        </div>

        <div className="relative rounded-xl overflow-hidden shadow-md" style={{ height: '600px' }}>
          {loading || !leafletLoaded ? (
            <div className="flex items-center justify-center h-full bg-gray-100">
              <p className="text-gray-500">Loading map...</p>
            </div>
          ) : (
            <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', zIndex: 0 }} scrollWheelZoom={true}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {merchants.map((merchant) => {
                if (!merchant.latitude || !merchant.longitude) return null;
                const lat = Number(merchant.latitude);
                const lng = Number(merchant.longitude);
                if (isNaN(lat) || isNaN(lng)) return null;
                const icon = createMerchantIcon('#DB0002');
                if (!icon) return null;
                return (
                  <Marker key={merchant.id} position={[lat, lng]} icon={icon}>
                    <Popup>
                      <div className="p-2 min-w-[200px]">
                        <Link href={`/merchants/${merchant.slug}`}>
                          <h3 className="font-bold text-gray-900 mb-2 hover:text-[#DB0002]">{merchant.name}</h3>
                        </Link>
                        {merchant.coverImageUrl && (
                          <img src={merchant.coverImageUrl} alt={merchant.name} className="w-full h-24 object-cover rounded mb-2" />
                        )}
                        {merchant.description && <p className="text-sm text-gray-600 mb-2 line-clamp-2">{merchant.description}</p>}
                        <div className="flex items-center gap-2 mb-2">
                          {merchant.rating && Number(merchant.rating) > 0 && (
                            <span className="text-sm font-semibold text-[#DB0002]">⭐ {Number(merchant.rating).toFixed(1)}</span>
                          )}
                          {merchant.category && <span className="text-xs text-gray-500">{merchant.category.name}</span>}
                        </div>
                        {merchant.address && <p className="text-xs text-gray-500 mb-2">📍 {merchant.address}</p>}
                        <Link href={`/merchants/${merchant.slug}`} className="text-sm text-[#165BB8] hover:underline">View Details →</Link>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          )}
        </div>
      </div>
    </div>
  );
}
