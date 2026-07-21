'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { merchantsApi, categoriesApi, type Merchant, type Category } from '@/lib/api';
import VoiceSearchButton from '@/components/VoiceSearchButton';

const FILTER_TABS = [
  { label: 'All', emoji: '🛒' },
  { label: 'Supermarket', emoji: '🏬' },
  { label: 'Pharmacy', emoji: '💊' },
  { label: 'Convenience', emoji: '🏪' },
];

const MART_EMOJIS: Record<string, string> = {
  supermarket: '🏬',
  grocery: '🛒',
  pharmacy: '💊',
  convenience: '🏪',
  default: '🛍️',
};

function getMartEmoji(merchant: Merchant): string {
  const cat = (merchant.category?.name || merchant.subCategory?.name || '').toLowerCase();
  for (const [key, emoji] of Object.entries(MART_EMOJIS)) {
    if (cat.includes(key)) return emoji;
  }
  return MART_EMOJIS.default;
}

const SAMPLE_MERCHANTS: Merchant[] = [
  { id: 10, name: 'SM Supermarket', slug: 'sm-supermarket', rating: 4.6, totalReviews: 1234, isVerified: true, address: 'SM Makati, Makati City', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 11, name: 'Mercury Drug', slug: 'mercury-drug', rating: 4.4, totalReviews: 890, isVerified: true, address: 'Ayala Ave, Makati City', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 12, name: 'Mini Stop', slug: 'mini-stop', rating: 4.2, totalReviews: 456,isVerified: false, address: 'Salcedo Village, Makati', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 13, name: 'Robinsons Supermarket', slug: 'robinsons-supermarket', rating: 4.5, totalReviews: 678, isVerified: true, address: 'Robinsons Place, Ermita', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
  { id: 14, name: 'Watsons', slug: 'watsons', rating: 4.3, totalReviews: 345, isVerified: true, address: 'Greenbelt 1, Makati', isActive: true, country: 'PH', businessType: 'storefront', createdAt: '', updatedAt: '' },
];

export default function MartHomePage() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, result] = await Promise.all([
        categoriesApi.getAll().catch(() => []),
        merchantsApi.getAll().catch(() => []),
      ]);
      setCategories(cats);

      const nonFood = result.filter((m) => {
        const catId = m.categoryId;
        if (!catId) return true;
        return catId !== 1;
      });
      setMerchants(nonFood.length > 0 ? nonFood : SAMPLE_MERCHANTS);
    } catch {
      setMerchants(SAMPLE_MERCHANTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = merchants.filter((m) => {
    const matchSearch = !search || 
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.address?.toLowerCase().includes(search.toLowerCase());

    if (!matchSearch) return false;
    if (activeFilter === 'All') return true;

    const catName = (m.category?.name || m.subCategory?.name || '').toLowerCase();
    return catName.includes(activeFilter.toLowerCase());
  });

  const martCategories = categories.filter((c) => {
    const slug = c.slug.toLowerCase();
    return slug.includes('mart') || slug.includes('grocery') || slug.includes('pharmacy') || slug.includes('convenience') || slug.includes('supermarket');
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
            <h1 className="text-lg font-bold text-gray-900">Mart & Grocery</h1>
            <p className="text-xs text-gray-400">Daily essentials delivered fast</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-28">
        {/* Banner */}
        <div className="mt-4 rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-500 to-teal-600 p-5 relative">
          <div className="relative z-10 text-white">
            <h2 className="text-xl font-bold leading-tight">Daily Essentials<br />Delivered Fast</h2>
            <p className="text-sm text-white/80 mt-1">From nearby stores</p>
          </div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-6xl opacity-30">🛒</div>
        </div>

        {/* Quick Categories from API */}
        {martCategories.length > 0 && (
          <div className="mt-5">
            <h3 className="text-base font-bold text-gray-900 mb-3">Categories</h3>
            <div className="grid grid-cols-3 gap-3">
              {martCategories.map((cat) => {
                const emoji = MART_EMOJIS[cat.slug.toLowerCase()] || '🛍️';
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveFilter(cat.name)}
                    className="bg-white rounded-xl p-4 border border-gray-100 flex flex-col items-center gap-2 shadow-sm hover:shadow-md transition-all active:scale-95"
                  >
                    <span className="text-3xl">{emoji}</span>
                    <span className="text-xs font-medium text-gray-700 text-center truncate w-full">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mt-4 relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search stores, pharmacies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-12 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all"
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
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-base">{tab.emoji}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Section title */}
        <div className="flex items-center justify-between mt-6 mb-3">
          <h2 className="text-lg font-bold text-gray-900">Nearby Stores</h2>
          <span className="text-xs text-gray-400">{filtered.length} stores</span>
        </div>

        {/* Merchant list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-3">🏪</div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">No stores found</h3>
            <p className="text-sm text-gray-500 mb-4">Try adjusting your search or filters.</p>
            <button
              onClick={() => { setSearch(''); setActiveFilter('All'); }}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm active:bg-emerald-700 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filtered.map((merchant) => (
              <Link
                key={merchant.id}
                href={`/customer/mart/${merchant.slug}`}
                className="group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-all"
              >
                {/* Cover */}
                <div className="aspect-[4/3] relative overflow-hidden">
                  {merchant.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={merchant.coverImageUrl}
                      alt={merchant.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center">
                      <span className="text-4xl">{getMartEmoji(merchant)}</span>
                    </div>
                  )}
                  {merchant.isVerified && (
                    <span className="absolute top-2 left-2 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      VERIFIED
                    </span>
                  )}
                </div>
                {/* Info */}
                <div className="p-3">
                  <h3 className="font-semibold text-sm text-gray-900 truncate group-hover:text-emerald-600 transition-colors">
                    {merchant.name}
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {merchant.category?.name || merchant.subCategory?.name || 'Store'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-0.5">
                      <span className="text-xs">⭐</span>
                      <span className="text-xs font-semibold text-gray-800">
                        {Number(merchant.rating).toFixed(1)}
                      </span>
                    </div>
                    {merchant.city && (
                      <>
                        <span className="text-gray-300 text-xs">|</span>
                        <span className="text-xs text-gray-400 truncate">{merchant.city}</span>
                      </>
                    )}
                  </div>
                  <button className="mt-2 w-full py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg active:bg-emerald-700 transition-colors">
                    Shop Now
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
