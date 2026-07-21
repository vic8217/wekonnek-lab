'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type AddressLabel = 'home' | 'office' | 'other';

const LABELS: { value: AddressLabel; emoji: string; name: string }[] = [
  { value: 'home', emoji: '🏠', name: 'Home' },
  { value: 'office', emoji: '🏢', name: 'Office' },
  { value: 'other', emoji: '📍', name: 'Other' },
];

export default function AddressPickerPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<AddressLabel>('home');
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const handleUseCurrentLocation = () => {
    setLocating(true);
    if (!navigator.geolocation) {
      setResolvedAddress('Cebu City, Cebu, Philippines');
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          setResolvedAddress(data.display_name || `${latitude}, ${longitude}`);
        } catch {
          setResolvedAddress('Current Location (coordinates captured)');
        } finally {
          setLocating(false);
        }
      },
      () => {
        setResolvedAddress('Cebu City, Cebu, Philippines');
        setLocating(false);
      }
    );
  };

  const handleSearch = () => {
    if (search.trim()) {
      setResolvedAddress(search.trim());
    }
  };

  const handleConfirm = async () => {
    if (!resolvedAddress) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/addresses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: selectedLabel,
          address: resolvedAddress,
        }),
      });
      if (!res.ok) throw new Error('Failed to save address');
      toast.success('Address saved');
      router.back();
    } catch {
      toast.error('Failed to save address');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">Pick Address</h1>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search for an address..."
          className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] transition-all"
        />
      </div>

      {/* Map Placeholder */}
      <div className="bg-gradient-to-br from-green-100 via-emerald-50 to-blue-50 rounded-2xl h-56 sm:h-72 flex flex-col items-center justify-center relative overflow-hidden border border-gray-100">
        {/* Grid lines */}
        <div className="absolute inset-0 opacity-10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`h-${i}`} className="absolute w-full border-t border-green-400" style={{ top: `${(i + 1) * 16}%` }} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`v-${i}`} className="absolute h-full border-l border-green-400" style={{ left: `${(i + 1) * 16}%` }} />
          ))}
        </div>

        {/* Center Pin */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-10 h-10 bg-[#DB0002] rounded-full flex items-center justify-center shadow-lg -mb-1">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          </div>
          <div className="w-3 h-3 bg-[#DB0002]/30 rounded-full" />
        </div>
        <p className="text-sm font-medium text-gray-500 mt-4 z-10">Drag map to set location</p>
      </div>

      {/* Use Current Location */}
      <button
        onClick={handleUseCurrentLocation}
        disabled={locating}
        className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-gray-200 rounded-xl hover:border-[#DB0002]/30 hover:bg-red-50/30 transition-all"
      >
        <div className="w-9 h-9 bg-blue-50 rounded-full flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
        </div>
        <span className="text-sm font-medium text-gray-700">
          {locating ? 'Getting your location...' : 'Use Current Location'}
        </span>
        {locating && (
          <div className="ml-auto w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        )}
      </button>

      {/* Label Selector */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Save as</p>
        <div className="flex gap-3">
          {LABELS.map((label) => (
            <button
              key={label.value}
              onClick={() => setSelectedLabel(label.value)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                selectedLabel === label.value
                  ? 'border-[#DB0002] bg-red-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="text-lg">{label.emoji}</span>
              <span
                className={`text-xs font-semibold ${
                  selectedLabel === label.value ? 'text-[#DB0002]' : 'text-gray-500'
                }`}
              >
                {label.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Resolved Address */}
      {resolvedAddress && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-800">Selected Address</p>
              <p className="text-sm text-green-600 mt-0.5">{resolvedAddress}</p>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Button */}
      <button
        onClick={handleConfirm}
        disabled={!resolvedAddress || saving}
        className="w-full py-3.5 bg-[#DB0002] text-white font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Confirm Location'}
      </button>
    </div>
  );
}
