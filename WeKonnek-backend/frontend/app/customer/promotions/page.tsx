'use client';

import { useState, useEffect } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Promotion {
  id: number;
  title: string;
  category: string;
  description: string;
  min_price: number;
  max_price: number;
  location: string;
  posted_date: string;
  expires_date: string;
  responses: number;
  status: string;
}

export default function CustomerPromotionsPage() {
  const { user: authUser } = useAuth();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authUser) fetchPromotions();
  }, [activeFilter, authUser]);

  const fetchPromotions = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams();
      if (activeFilter !== 'all') params.set('status', activeFilter);

      const res = await fetch(`${API}/api/promotions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch promotions');
      const promotionsData = await res.json();

      const list = Array.isArray(promotionsData) ? promotionsData : promotionsData.data || [];
      const transformed: Promotion[] = list.map((promo: any) => ({
        id: promo.id,
        title: promo.title,
        category: promo.categories?.name || promo.category?.name || promo.sub_categories?.name || 'Uncategorized',
        description: promo.description,
        min_price: parseFloat(promo.min_price || promo.minPrice) || 0,
        max_price: parseFloat(promo.max_price || promo.maxPrice) || 0,
        location: promo.barangay ? `${promo.barangay}, ${promo.city}` : promo.city || promo.location || '',
        posted_date: promo.posted_date || promo.postedDate || promo.created_at?.split('T')[0] || promo.createdAt?.split('T')[0] || '',
        expires_date: promo.expires_date || promo.expiresDate || '',
        responses: promo.responses_count || promo.responsesCount || 0,
        status: promo.status,
      }));

      setPromotions(transformed);
    } catch (error) {
      console.error('Error fetching promotions:', error);
      setPromotions([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700';
      case 'pending': return 'bg-amber-100 text-amber-700';
      case 'closed': return 'bg-gray-100 text-gray-600';
      case 'draft': return 'bg-gray-100 text-gray-500';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return '🟢';
      case 'pending': return '🟡';
      case 'closed': return '⚫';
      default: return '📋';
    }
  };

  const counts = {
    all: promotions.length,
    active: promotions.filter(p => p.status === 'active').length,
    pending: promotions.filter(p => p.status === 'pending').length,
    closed: promotions.filter(p => p.status === 'closed').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <>
      {/* ========== MOBILE PROMOTIONS ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">My Ads</h1>
              <p className="text-[11px] text-gray-400">&quot;Looking For&quot; advertisements</p>
            </div>
            <Link
              href="/customer/promotions/new"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#DB0002] text-white text-xs font-semibold rounded-full shadow-sm mobile-press"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Post Ad
            </Link>
          </div>

          {/* Filter Chips */}
          <div className="flex gap-2 px-4 py-2.5 overflow-x-auto no-scrollbar border-b border-gray-100">
            {[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'active', label: 'Active', count: counts.active },
              { id: 'pending', label: 'Pending', count: counts.pending },
              { id: 'closed', label: 'Closed', count: counts.closed },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                  activeFilter === tab.id
                    ? 'bg-[#DB0002] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>

        {/* Promotions List */}
        <div className="px-4 py-3 space-y-3 mobile-scroll">
          {promotions.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">No ads posted yet</p>
              <p className="text-xs text-gray-400 mt-1">Post what you&apos;re looking for and get merchant responses</p>
              <Link href="/customer/promotions/new" className="inline-block mt-4 px-5 py-2 bg-[#DB0002] text-white text-sm font-semibold rounded-full">
                Post Your First Ad
              </Link>
            </div>
          ) : (
            promotions.map((promo) => (
              <div
                key={promo.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mobile-press active:bg-gray-50 transition-all"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-bold text-gray-900 flex-1">{promo.title}</h3>
                    <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold capitalize ${getStatusColor(promo.status)}`}>
                      {promo.status}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 line-clamp-2 mb-3">{promo.description}</p>

                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg">
                      <span>🏷️</span> {promo.category}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg">
                      <span>💰</span> ₱{promo.min_price.toLocaleString()} - ₱{promo.max_price.toLocaleString()}
                    </span>
                    {promo.location && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg">
                        <span>📍</span> {promo.location}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/70 border-t border-gray-100">
                  <span className="text-[11px] text-gray-400">
                    {promo.responses} response{promo.responses !== 1 ? 's' : ''}
                  </span>
                  <button className="text-[#DB0002] text-xs font-semibold">
                    View Details →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ========== DESKTOP PROMOTIONS ========== */}
      <div className="hidden lg:block space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Promotions</h1>
            <p className="text-gray-600">Manage your &quot;Looking For&quot; advertisements</p>
          </div>
          <Link
            href="/customer/promotions/new"
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Post New Ad
          </Link>
        </div>

        <div className="flex space-x-2">
          {[
            { id: 'all', label: 'All', count: counts.all },
            { id: 'active', label: 'Active', count: counts.active },
            { id: 'pending', label: 'Pending', count: counts.pending },
            { id: 'closed', label: 'Closed', count: counts.closed },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeFilter === tab.id
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {promotions.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <p className="text-gray-500">No promotions found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {promotions.map((promo) => (
              <div key={promo.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(promo.status)}`}>
                    {promo.status}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{promo.title}</h3>
                <p className="text-sm text-gray-500 mb-4">{promo.category}</p>
                <p className="text-gray-700 mb-4">{promo.description}</p>
                <div className="space-y-2 mb-4 text-sm text-gray-600">
                  <p>💰 ₱{promo.min_price.toLocaleString()} - ₱{promo.max_price.toLocaleString()}</p>
                  {promo.location && <p>📍 {promo.location}</p>}
                  <p>📅 {promo.posted_date} → {promo.expires_date}</p>
                  <p>💬 {promo.responses} responses</p>
                </div>
                <div className="flex space-x-2">
                  <button className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium">
                    View Responses
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
