'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { merchantsApi, type Merchant } from '@/lib/api';
import VoiceSearchButton from '@/components/VoiceSearchButton';

const FILTER_TABS = [
  { label: 'All', emoji: '🍽️' },
  { label: 'Fast Food', emoji: '🍔' },
  { label: 'Filipino', emoji: '🍲' },
  { label: 'Chinese', emoji: '🥡' },
  { label: 'Japanese', emoji: '🍱' },
  { label: 'Coffee & Tea', emoji: '☕' },
];

const SAMPLE_MERCHANTS: Merchant[] = [
  { id: 1, name: 'Sisig ni Juan', slug: 'sisig-ni-juan', rating: 4.7, totalReviews: 342, isVerified: true, address: 'Makati Ave, Makati City', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 2, name: 'Lutong Bahay ni Aling Rosa', slug: 'aling-rosa', rating: 4.5, totalReviews: 128,isVerified: false, address: 'Poblacion, Makati', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 3, name: "Mang Kanor's BBQ", slug: 'mang-kanors', rating: 4.8, totalReviews: 567, isVerified: true, address: 'JP Rizal, Makati', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 4, name: 'Kuya J Restaurant', slug: 'kuya-j', rating: 4.6, totalReviews: 890, isVerified: true, address: 'Greenbelt 3, Makati', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 5, name: 'Kakanin Corner', slug: 'kakanin-corner', rating: 4.3, totalReviews: 76, isVerified: false, address: 'Legazpi Village, Makati', isActive: true, country: 'PH', businessType: 'home_based', createdAt: '', updatedAt: '' },
];

const CATEGORY_EMOJIS = ['🍔', '🍲', '🍕', '🍣', '🥗', '🍰', '☕', '🍜'];

function getDeliveryTime(index: number): string {
  return `${15 + index * 5}-${25 + index * 5} min`;
}

export default function FoodHomePage() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');

  const loadMerchants = useCallback(async () => {
    setLoading(true);
    try {
      const result = await merchantsApi.search({ categoryId: 1, limit: 30 });
      setMerchants(result.data.length > 0 ? result.data : SAMPLE_MERCHANTS);
    } catch {
      try {
        const all = await merchantsApi.getAll();
        setMerchants(all.length > 0 ? all : SAMPLE_MERCHANTS);
      } catch {
        setMerchants(SAMPLE_MERCHANTS);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMerchants();
  }, [loadMerchants]);

  const filtered = merchants.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.address?.toLowerCase().includes(q) ||
        m.category?.name.toLowerCase().includes(q)
      );
    }
    if (activeFilter === 'All') return true;
    const catName = m.category?.name || m.subCategory?.name || '';
    return catName.toLowerCase().includes(activeFilter.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-[#FFFAF3]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-gray-50 rounded-xl transition-colors"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-900">Food Delivery</h1>
            <p className="text-xs text-gray-400">Anong ulam mo today?</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-28">
        {/* Featured Banner */}
        <div className="mt-4 rounded-2xl overflow-hidden bg-gradient-to-br from-[#DB0002]/10 via-[#DB0002]/5 to-orange-50 p-5 relative">
          <div className="relative z-10">
            <span className="inline-block px-2 py-0.5 bg-[#DB0002] text-white text-[10px] font-bold rounded tracking-wide mb-2">
              FEATURED
            </span>
            <h2 className="text-xl font-bold text-gray-900">Cravings of the Day</h2>
            <p className="text-sm text-gray-500 mt-1">Perfect for sharing. Basta Salat!</p>
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-6xl opacity-30">🍔</div>
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search restaurants, cuisines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-12 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002]/40 transition-all"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <VoiceSearchButton onResult={(text) => setSearch(text)} />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mt-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-max pb-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.label}
                onClick={() => setActiveFilter(tab.label)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  activeFilter === tab.label
                    ? 'bg-[#DB0002] text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-base">{tab.emoji}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Section Title */}
        <div className="flex items-center justify-between mt-6 mb-3">
          <h2 className="text-lg font-bold text-gray-900">Salo-Salo Favorites</h2>
          <span className="text-xs text-gray-400">{filtered.length} restaurants</span>
        </div>

        {/* Restaurant Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-3">🍽️</div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">No restaurants found</h3>
            <p className="text-sm text-gray-500 mb-4">Try adjusting your search or filters.</p>
            <button
              onClick={() => { setSearch(''); setActiveFilter('All'); }}
              className="px-5 py-2.5 bg-[#DB0002] text-white rounded-xl font-semibold text-sm active:bg-[#B80002] transition-colors"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filtered.map((merchant, idx) => (
              <Link
                key={merchant.id}
                href={`/customer/food/${merchant.slug}`}
                className="group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-all"
              >
                {/* Cover Image */}
                <div className="aspect-[4/3] relative overflow-hidden">
                  {merchant.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={merchant.coverImageUrl}
                      alt={merchant.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#DB0002]/15 to-orange-100 flex items-center justify-center">
                      <span className="text-4xl">{CATEGORY_EMOJIS[idx % CATEGORY_EMOJIS.length]}</span>
                    </div>
                  )}
                  {merchant.isVerified && (
                    <span className="absolute top-2 left-2 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      VERIFIED
                    </span>
                  )}
                  <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-gray-700 px-2 py-0.5 rounded-full">
                    {getDeliveryTime(idx)}
                  </div>
                </div>
                {/* Info */}
                <div className="p-3">
                  <h3 className="font-semibold text-sm text-gray-900 truncate group-hover:text-[#DB0002] transition-colors">
                    {merchant.name}
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {merchant.category?.name || merchant.subCategory?.name || 'Restaurant'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-0.5">
                      <span className="text-xs">⭐</span>
                      <span className="text-xs font-semibold text-gray-800">
                        {Number(merchant.rating).toFixed(1)}
                      </span>
                    </div>
                    <span className="text-gray-300 text-xs">|</span>
                    <span className="text-xs text-gray-400">
                      {merchant.totalReviews} reviews
                    </span>
                  </div>
                  <button className="mt-2 w-full py-1.5 bg-[#DB0002] text-white text-xs font-semibold rounded-lg active:bg-[#B80002] transition-colors">
                    Order Now
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
