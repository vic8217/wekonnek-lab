'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Image from 'next/image';
import Navigation from '@/components/Navigation';
import { merchantsApi, Merchant } from '@/lib/api';

// Dynamically import MapContainer to avoid SSR issues with Leaflet
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), {
  ssr: false,
});
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), {
  ssr: false,
});
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), {
  ssr: false,
});
const Popup = dynamic(() => import('react-leaflet').then((mod) => mod.Popup), {
  ssr: false,
});

// Import Leaflet CSS - this is safe in a client component
import 'leaflet/dist/leaflet.css';

export default function MapPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState<[number, number]>([14.5995, 120.9842]); // Default to Manila
  const [email, setEmail] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const leafletRef = useRef<any>(null);

  // Load Leaflet only on client
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Import Leaflet library
      import('leaflet').then((L) => {
        // Fix for default marker icons in Next.js
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

  // Custom marker icon for merchants
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
        
        // Filter merchants with valid coordinates
        const merchantsWithLocation = allMerchants.filter(
          (m) => m.latitude && m.longitude && !isNaN(Number(m.latitude)) && !isNaN(Number(m.longitude))
        );
        
        setMerchants(merchantsWithLocation);
        
        // Set map center to first merchant or default
        if (merchantsWithLocation.length > 0) {
          setMapCenter([
            Number(merchantsWithLocation[0].latitude),
            Number(merchantsWithLocation[0].longitude),
          ]);
        }
      } catch (error) {
        console.error('Failed to fetch merchants:', error);
        setMerchants([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMerchants();

    // Try to get user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setMapCenter([position.coords.latitude, position.coords.longitude]);
        },
        () => {
          // Use default location if geolocation fails
          console.log('Using default location');
        }
      );
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#FFFAF3]">
      <Navigation />

      {/* Map Section */}
      <section className="relative" style={{ height: 'calc(100vh - 80px)' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Loading map...</p>
          </div>
        ) : !leafletLoaded ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">Loading map...</p>
          </div>
        ) : (
          <MapContainer
            center={mapCenter}
            zoom={13}
            style={{ height: '100%', width: '100%', zIndex: 0 }}
            scrollWheelZoom={true}
          >
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
                <Marker
                  key={merchant.id}
                  position={[lat, lng]}
                  icon={icon}
                >
                  <Popup>
                    <div className="p-2 min-w-[200px]">
                      <Link href={`/merchants/${merchant.slug}`}>
                        <h3 className="font-bold text-gray-900 mb-2 hover:text-[#DB0002]">
                          {merchant.name}
                        </h3>
                      </Link>
                      {merchant.coverImageUrl && (
                        <img
                          src={merchant.coverImageUrl}
                          alt={merchant.name}
                          className="w-full h-24 object-cover rounded mb-2"
                        />
                      )}
                      {merchant.description && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {merchant.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        {merchant.rating && Number(merchant.rating) > 0 && (
                          <span className="text-sm font-semibold text-[#DB0002]">
                            ⭐ {Number(merchant.rating).toFixed(1)}
                          </span>
                        )}
                        {merchant.category && (
                          <span className="text-xs text-gray-500">
                            {merchant.category.name}
                          </span>
                        )}
                      </div>
                      {merchant.address && (
                        <p className="text-xs text-gray-500 mb-2">
                          📍 {merchant.address}
                        </p>
                      )}
                      <Link
                        href={`/merchants/${merchant.slug}`}
                        className="text-sm text-[#165BB8] hover:underline"
                      >
                        View Details →
                      </Link>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
      </section>

      {/* Newsletter Signup Section (Reused from Homepage) */}
      <section className="py-16 lg:py-20 bg-[#FFFAF3]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="bg-[#DB0002] rounded-xl p-8 lg:p-12">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              {/* Left: Text Content */}
              <div className="flex-1 text-center lg:text-left">
                <p className="text-white text-lg lg:text-xl mb-2">
                  <span className="font-bold">Knowledge is priceless</span> - so{' '}
                  <span className="font-bold">our cost guides are free.</span>
                </p>
                <p className="text-white text-base lg:text-lg">
                  Sign up to get free project cost info in your inbox.
                </p>
              </div>

              {/* Right: Form Inputs */}
              <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
                {/* Email Input */}
                <div className="relative flex-1 sm:flex-initial sm:w-64">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email Address"
                    className="w-full pl-10 pr-4 py-3 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/50"
                  />
                </div>

                {/* Zip Code Input */}
                <div className="relative flex-1 sm:flex-initial sm:w-48">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    placeholder="Zip Code"
                    className="w-full pl-10 pr-4 py-3 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white/50"
                  />
                </div>

                {/* Sign Up Button */}
                <button
                  onClick={() => {
                    if (email && zipCode) {
                      console.log('Sign up:', { email, zipCode });
                      alert('Thank you for signing up!');
                      setEmail('');
                      setZipCode('');
                    }
                  }}
                  className="bg-[#165BB8] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#124A94] transition-colors whitespace-nowrap"
                >
                  Sign me up
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights Section (Reused from Homepage) */}
      <section className="py-16 lg:py-20 bg-[#FFFAF3]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {/* Feature 1: Wide Selection */}
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-24 h-24 bg-pink-100 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                Wide Selection
              </h3>
              <p className="text-gray-700 leading-relaxed">
                Browse thousands of services and products from trusted providers
              </p>
            </div>

            {/* Feature 2: Fast Delivery */}
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-24 h-24 bg-pink-100 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                Fast Delivery
              </h3>
              <p className="text-gray-700 leading-relaxed">
                Quick and reliable delivery or pickup options for your convenience
              </p>
            </div>

            {/* Feature 3: Trusted Merchants */}
            <div className="text-center">
              <div className="flex justify-center mb-6">
                <div className="w-24 h-24 bg-pink-100 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                Trusted Merchants
              </h3>
              <p className="text-gray-700 leading-relaxed">
                All merchants are verified and rated by our community
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
