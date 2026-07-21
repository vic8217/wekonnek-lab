'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface RecentDelivery {
  id: string;
  pickup: string;
  dropoff: string;
  status: string;
  fare: number;
  vehicle: string;
  date: string;
}

const PACKAGE_SIZES = [
  { id: 'small', label: 'Small', desc: 'Documents & Envelopes', icon: '📄', maxWeight: '1 kg' },
  { id: 'medium', label: 'Medium', desc: 'Boxes & Parcels', icon: '📦', maxWeight: '10 kg' },
  { id: 'large', label: 'Large', desc: 'Furniture & Appliances', icon: '🪑', maxWeight: '50 kg' },
];

const VEHICLE_TYPES = [
  { id: 'motorcycle', label: 'Motorcycle', icon: '🏍️', desc: 'Up to 20kg', baseFare: 49 },
  { id: 'car', label: 'Car', icon: '🚗', desc: 'Up to 100kg', baseFare: 149 },
  { id: 'van', label: 'Van', icon: '🚐', desc: 'Up to 300kg', baseFare: 349 },
];

const MOCK_DELIVERIES: RecentDelivery[] = [
  { id: '1', pickup: 'SM City Cebu', dropoff: 'IT Park, Cebu City', status: 'delivered', fare: 85, vehicle: 'motorcycle', date: '2026-06-25T10:00:00Z' },
  { id: '2', pickup: 'Ayala Center Cebu', dropoff: 'Mandaue City', status: 'delivered', fare: 120, vehicle: 'motorcycle', date: '2026-06-24T15:30:00Z' },
  { id: '3', pickup: 'Carbon Market', dropoff: 'Talisay City', status: 'cancelled', fare: 195, vehicle: 'car', date: '2026-06-23T09:15:00Z' },
];

export default function ExpressPage() {
  const router = useRouter();
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [packageSize, setPackageSize] = useState('small');
  const [vehicle, setVehicle] = useState('motorcycle');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [recentDeliveries, setRecentDeliveries] = useState<RecentDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDeliveries = async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('No token');
        const res = await fetch(`${API}/api/express/deliveries`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        setRecentDeliveries(Array.isArray(data) ? data : data.data || MOCK_DELIVERIES);
      } catch {
        setRecentDeliveries(MOCK_DELIVERIES);
      } finally {
        setLoading(false);
      }
    };
    fetchDeliveries();
  }, []);

  useEffect(() => {
    if (!pickup || !dropoff) {
      setEstimate(null);
      return;
    }

    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const token = getToken();
        const res = await fetch(
          `${API}/api/express/estimate?pickup=${encodeURIComponent(pickup)}&dropoff=${encodeURIComponent(dropoff)}&vehicle=${vehicle}&size=${packageSize}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        setEstimate(data.fare ?? data.estimate ?? null);
      } catch {
        const vehicleData = VEHICLE_TYPES.find((v) => v.id === vehicle);
        const sizeMultiplier = packageSize === 'small' ? 1 : packageSize === 'medium' ? 1.3 : 1.8;
        setEstimate(Math.round((vehicleData?.baseFare ?? 49) * sizeMultiplier + Math.random() * 50 + 20));
      } finally {
        setEstimating(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [pickup, dropoff, vehicle, packageSize]);

  const handleBookNow = () => {
    const params = new URLSearchParams({
      pickup,
      dropoff,
      size: packageSize,
      vehicle,
      fare: String(estimate ?? 0),
    });
    router.push(`/customer/express/booking?${params.toString()}`);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered': return 'bg-green-100 text-green-700';
      case 'in_transit': return 'bg-blue-100 text-blue-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <>
      {/* ========== MOBILE EXPRESS ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Header */}
        <div className="px-4 pt-2 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏍️</span>
            <h1 className="text-lg font-bold text-gray-900">Express Delivery</h1>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 ml-9">Fast & reliable same-day delivery</p>
        </div>

        {/* Send a Package Card */}
        <div className="px-4 pb-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-[#DB0002] to-[#ff4444] px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">📦</span>
                <h2 className="text-white font-bold text-sm">Send a Package</h2>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Pickup */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white shadow" />
                <input
                  type="text"
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder="Pickup location"
                  className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
              </div>

              {/* Connector Line */}
              <div className="flex items-center gap-3 pl-[17px]">
                <div className="w-px h-3 bg-gray-300" />
              </div>

              {/* Dropoff */}
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-[#DB0002] rounded-full border-2 border-white shadow" />
                <input
                  type="text"
                  value={dropoff}
                  onChange={(e) => setDropoff(e.target.value)}
                  placeholder="Drop-off location"
                  className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
              </div>
            </div>

            {/* Package Size */}
            <div className="px-4 pb-3">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Package Size</label>
              <div className="grid grid-cols-3 gap-2">
                {PACKAGE_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => setPackageSize(size.id)}
                    className={`flex flex-col items-center py-2.5 rounded-xl border transition-all ${
                      packageSize === size.id
                        ? 'border-[#DB0002] bg-red-50 ring-1 ring-[#DB0002]/20'
                        : 'border-gray-200 bg-white active:scale-95'
                    }`}
                  >
                    <span className="text-xl mb-0.5">{size.icon}</span>
                    <span className="text-[11px] font-bold text-gray-800">{size.label}</span>
                    <span className="text-[9px] text-gray-400">{size.maxWeight}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Vehicle Type */}
            <div className="px-4 pb-4">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Vehicle Type</label>
              <div className="grid grid-cols-3 gap-2">
                {VEHICLE_TYPES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVehicle(v.id)}
                    className={`flex flex-col items-center py-2.5 rounded-xl border transition-all ${
                      vehicle === v.id
                        ? 'border-[#DB0002] bg-red-50 ring-1 ring-[#DB0002]/20'
                        : 'border-gray-200 bg-white active:scale-95'
                    }`}
                  >
                    <span className="text-xl mb-0.5">{v.icon}</span>
                    <span className="text-[11px] font-bold text-gray-800">{v.label}</span>
                    <span className="text-[9px] text-gray-400">from ₱{v.baseFare}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Estimate */}
            {(estimate || estimating) && (
              <div className="mx-4 mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-green-800 font-medium">Estimated Fare</span>
                {estimating ? (
                  <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span className="text-lg font-black text-green-700">
                    ₱{estimate?.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            )}

            {/* Book Button */}
            <div className="px-4 pb-4">
              <button
                onClick={handleBookNow}
                disabled={!pickup || !dropoff}
                className="w-full py-3.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold disabled:opacity-40 disabled:bg-gray-300 active:scale-[0.98] transition-all shadow-lg shadow-red-200/50"
              >
                Book Now
              </button>
            </div>
          </div>
        </div>

        {/* Recent Deliveries */}
        <div className="px-4 pb-6">
          <h2 className="text-base font-bold text-gray-900 mb-3">Recent Deliveries</h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white rounded-2xl h-20 animate-pulse border border-gray-100" />
              ))}
            </div>
          ) : recentDeliveries.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
              <span className="text-4xl">📦</span>
              <p className="text-gray-500 font-medium text-sm mt-2">No deliveries yet</p>
              <p className="text-xs text-gray-400 mt-1">Your delivery history will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentDeliveries.map((d) => (
                <div key={d.id} className="bg-white rounded-2xl px-4 py-3.5 border border-gray-100 shadow-sm">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                        <span className="truncate">{d.pickup}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-600 mt-1">
                        <span className="w-1.5 h-1.5 bg-[#DB0002] rounded-full flex-shrink-0" />
                        <span className="truncate">{d.dropoff}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${getStatusBadge(d.status)}`}>
                        {d.status.replace(/_/g, ' ')}
                      </span>
                      <p className="text-sm font-bold text-gray-900 mt-1">₱{d.fare.toFixed(2)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} &bull; {d.vehicle}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ========== DESKTOP EXPRESS ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Express Delivery</h1>
          <p className="text-gray-600">Send packages anywhere in the city with same-day delivery</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Booking Form */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span className="text-xl">📦</span> Send a Package
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Pickup Location</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-green-500 rounded-full" />
                  <input
                    type="text"
                    value={pickup}
                    onChange={(e) => setPickup(e.target.value)}
                    placeholder="Enter pickup address"
                    className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Drop-off Location</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-[#DB0002] rounded-full" />
                  <input
                    type="text"
                    value={dropoff}
                    onChange={(e) => setDropoff(e.target.value)}
                    placeholder="Enter drop-off address"
                    className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Package Size</label>
              <div className="grid grid-cols-3 gap-3">
                {PACKAGE_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => setPackageSize(size.id)}
                    className={`flex flex-col items-center py-4 rounded-xl border-2 transition-all ${
                      packageSize === size.id
                        ? 'border-[#DB0002] bg-red-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-3xl mb-1">{size.icon}</span>
                    <span className="text-sm font-bold text-gray-800">{size.label}</span>
                    <span className="text-xs text-gray-500">{size.desc}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">Max {size.maxWeight}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Vehicle Type</label>
              <div className="grid grid-cols-3 gap-3">
                {VEHICLE_TYPES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVehicle(v.id)}
                    className={`flex flex-col items-center py-4 rounded-xl border-2 transition-all ${
                      vehicle === v.id
                        ? 'border-[#DB0002] bg-red-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-3xl mb-1">{v.icon}</span>
                    <span className="text-sm font-bold text-gray-800">{v.label}</span>
                    <span className="text-xs text-gray-500">{v.desc}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">From ₱{v.baseFare}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Estimate + Book */}
            <div className="flex items-center justify-between pt-2">
              {estimate ? (
                <div>
                  <p className="text-xs text-gray-500">Estimated Fare</p>
                  <p className="text-2xl font-black text-gray-900">
                    ₱{estimate.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ) : estimating ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Calculating...</span>
                </div>
              ) : (
                <p className="text-sm text-gray-400">Enter addresses to see estimate</p>
              )}
              <button
                onClick={handleBookNow}
                disabled={!pickup || !dropoff}
                className="px-8 py-3 bg-[#DB0002] text-white rounded-xl font-bold disabled:opacity-40 disabled:bg-gray-300 hover:bg-[#b80002] transition-colors"
              >
                Book Now
              </button>
            </div>
          </div>

          {/* Recent Deliveries */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Recent Deliveries</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {recentDeliveries.map((d) => (
                <div key={d.id} className="px-6 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${getStatusBadge(d.status)}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-bold text-gray-900">₱{d.fare.toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      <span className="truncate">{d.pickup}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-[#DB0002] rounded-full" />
                      <span className="truncate">{d.dropoff}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
