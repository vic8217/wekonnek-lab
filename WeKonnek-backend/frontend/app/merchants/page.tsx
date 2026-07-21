'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { merchantsApi, Merchant, SearchMerchantsParams } from '@/lib/api';
import MerchantCard from '@/components/MerchantCard';
import { useUserLocation } from '@/hooks/use-geolocation';
import { distanceToMerchant, formatDistance, estimateEta } from '@/lib/geo';

const FAV_KEY = 'wk_favorite_merchants';

function readFavorites(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
  } catch {
    return [];
  }
}

type FilterKey = 'rating' | 'near';

export default function MerchantsPage() {
  const { coords } = useUserLocation();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const [favorites, setFavorites] = useState<number[]>([]);
  const [searchParams, setSearchParams] = useState<SearchMerchantsParams>({ page: 1, limit: 20 });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });

  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  useEffect(() => {
    const fetchMerchants = async () => {
      try {
        setLoading(true);
        const response = await merchantsApi.search(searchParams);
        setMerchants(response.data);
        setPagination(response.pagination);
      } catch (err) {
        setError('Failed to load shops. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchMerchants();
  }, [searchParams]);

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleFavorite = (id: number) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSearchParams({ ...searchParams, search, page: 1 });
  };

  const visibleMerchants = useMemo(() => {
    return merchants.filter((m) => {
      if (activeFilters.has('rating') && Number(m.rating) < 4.5) return false;
      if (activeFilters.has('near')) {
        const km = distanceToMerchant(coords, m);
        if (km == null || km > 2) return false;
      }
      return true;
    });
  }, [merchants, activeFilters, coords]);

  return (
    <>
      {/* ========== MOBILE SHOPS LIST ========== */}
      <div className="lg:hidden bg-white min-h-screen pb-24">
        {/* Search bar */}
        <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-2 border-b border-gray-100">
          <form onSubmit={handleSearch} className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shops, restaurants..."
              className="w-full bg-gray-100 rounded-full pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/20"
            />
          </form>

          {/* Filter chips */}
          <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              className="flex items-center gap-1 flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#DB0002] text-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Filter
            </button>
            <button
              type="button"
              onClick={() => toggleFilter('rating')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activeFilters.has('rating')
                  ? 'bg-[#DB0002] text-white border-[#DB0002]'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              Rating 4.5+
            </button>
            <button
              type="button"
              onClick={() => toggleFilter('near')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activeFilters.has('near')
                  ? 'bg-[#DB0002] text-white border-[#DB0002]'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              Under 2km
            </button>
          </div>
        </div>

        {error && (
          <div className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {loading && merchants.length === 0 ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-100 rounded-2xl h-60 animate-pulse" />
            ))}
          </div>
        ) : visibleMerchants.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            {activeFilters.size > 0 ? 'No shops match these filters.' : 'No shops found.'}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {visibleMerchants.map((merchant, idx) => {
              const km = distanceToMerchant(coords, merchant);
              const dist = formatDistance(km);
              const eta = estimateEta(km);
              const rating = Number(merchant.rating) || 0;
              const isFav = favorites.includes(merchant.id);
              const badge =
                rating >= 4.7 ? { text: 'TRENDING', color: 'bg-[#DB0002]' } : idx % 3 === 0 ? { text: 'NEW CHOICE', color: 'bg-green-600' } : null;
              return (
                <Link
                  key={merchant.id}
                  href={`/merchants/${merchant.slug}`}
                  className="block bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100"
                >
                  <div className="relative h-40">
                    {merchant.coverImageUrl ? (
                      <img src={merchant.coverImageUrl} alt={merchant.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-orange-100 to-red-100 flex items-center justify-center">
                        <span className="text-5xl">🏪</span>
                      </div>
                    )}
                    {badge && (
                      <span className={`absolute top-2 right-2 ${badge.color} text-white text-[9px] font-bold px-2 py-0.5 rounded-full`}>
                        {badge.text}
                      </span>
                    )}
                    {dist && (
                      <span className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-sm text-gray-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        {dist} away
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 truncate">{merchant.name}</h3>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">
                        {merchant.category?.name || 'Local Shop'}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-gray-500">
                        <span className="flex items-center gap-0.5 text-gray-800 font-semibold">
                          <svg className="w-3.5 h-3.5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                            <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                          </svg>
                          <span className="text-xs">{rating > 0 ? rating.toFixed(1) : 'New'}</span>
                        </span>
                        <span className="text-gray-300">•</span>
                        <span className="flex items-center gap-0.5 text-[11px]">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {eta}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleFavorite(merchant.id);
                      }}
                      className="flex-shrink-0 p-1.5 -m-1.5"
                    >
                      <svg
                        className={`w-5 h-5 ${isFav ? 'text-[#DB0002] fill-current' : 'text-gray-300'}`}
                        fill={isFav ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ========== DESKTOP MERCHANTS GRID ========== */}
      <div className="hidden lg:block min-h-screen bg-gray-50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Find Local Merchants</h1>
            <p className="mt-2 text-gray-600">
              Discover restaurants, cafés, salons, services, and more near you
            </p>
          </div>

          <form onSubmit={handleSearch} className="mb-8">
            <div className="flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search merchants..."
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Search
              </button>
            </div>
          </form>

          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {merchants.length === 0 ? (
            <div className="rounded-lg bg-white p-8 text-center shadow-sm">
              <p className="text-gray-600">No merchants found.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-sm text-gray-600">
                Showing {merchants.length} of {pagination.total} merchants
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {merchants.map((merchant) => (
                  <MerchantCard key={merchant.id} merchant={merchant} />
                ))}
              </div>

              {pagination.totalPages > 1 && (
                <div className="mt-8 flex justify-center gap-2">
                  <button
                    onClick={() => setSearchParams({ ...searchParams, page: pagination.page - 1 })}
                    disabled={pagination.page === 1}
                    className="rounded-lg border border-gray-300 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <span className="flex items-center px-4 text-gray-600">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setSearchParams({ ...searchParams, page: pagination.page + 1 })}
                    disabled={pagination.page >= pagination.totalPages}
                    className="rounded-lg border border-gray-300 px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
