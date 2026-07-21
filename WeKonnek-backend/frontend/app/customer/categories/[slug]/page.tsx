'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  display_order: number;
  sub_categories?: SubCategory[];
}

interface SubCategory {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  display_order: number;
}

interface MerchantRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  category_id: number;
  sub_category_id: number;
  address: string;
  city: string;
  logo_url: string;
  cover_image_url: string;
  rating: number;
  total_reviews: number;
  is_active: boolean;
  is_verified: boolean;
}

export default function CustomerCategoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug as string;

  const [category, setCategory] = useState<Category | null>(null);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantsLoading, setMerchantsLoading] = useState(false);
  const [selectedSubCategory, setSelectedSubCategory] = useState<number | null>(null);

  useEffect(() => {
    const fetchCategory = async () => {
      try {
        setLoading(true);
        let data: Category | null = null;

        const res = await fetch(`${API}/api/categories/slug/${slug}`);
        if (res.ok) {
          data = await res.json();
        } else {
          // Fallback: the slug may not match the DB exactly (e.g. "food" vs
          // "food-beverages"). Resolve against the live category list by slug
          // prefix or name match so the page still works.
          const allRes = await fetch(`${API}/api/categories`);
          if (allRes.ok) {
            const all: Category[] = await allRes.json();
            const term = slug.toLowerCase();
            data =
              all.find((c) => c.slug === term) ||
              all.find((c) => c.slug.startsWith(term) || term.startsWith(c.slug.split('-')[0])) ||
              all.find((c) => c.name.toLowerCase().includes(term) || term.includes(c.name.toLowerCase().split(' ')[0])) ||
              null;
          }
        }

        if (!data) throw new Error('Category not found');
        setCategory(data);

        const subParam = searchParams.get('sub');
        if (subParam) {
          setSelectedSubCategory(parseInt(subParam));
        }
      } catch (error) {
        console.error('Error fetching category:', error);
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchCategory();
  }, [slug, searchParams]);

  useEffect(() => {
    if (!category) return;

    const fetchMerchants = async () => {
      try {
        setMerchantsLoading(true);
        const params = new URLSearchParams({
          categoryId: String(category.id),
          limit: '50',
        });
        if (selectedSubCategory) {
          params.set('subCategoryId', String(selectedSubCategory));
        }
        const res = await fetch(`${API}/api/merchants/search?${params}`);
        if (!res.ok) throw new Error('Failed to fetch merchants');
        const json = await res.json();
        setMerchants(json.data || json || []);
      } catch (error) {
        console.error('Error fetching merchants:', error);
      } finally {
        setMerchantsLoading(false);
      }
    };

    fetchMerchants();
  }, [category, selectedSubCategory]);

  const handleSubCategoryClick = (subId: number | null) => {
    setSelectedSubCategory(subId);
  };

  const getSubCategoryName = (subId: number) => {
    return category?.sub_categories?.find(s => s.id === subId)?.name || '';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Mobile skeleton */}
        <div className="lg:hidden px-4 pt-4">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4 animate-pulse" />
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
        {/* Desktop skeleton */}
        <div className="hidden lg:block max-w-7xl mx-auto p-6">
          <div className="h-10 bg-gray-200 rounded w-64 mb-6 animate-pulse" />
          <div className="flex flex-wrap gap-3 mb-8">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 bg-gray-200 rounded-full w-28 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-gray-600 mb-1">We couldn&apos;t find that category</p>
          <p className="text-xs text-gray-400 mb-4">Try browsing all shops or pick another category.</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link href="/customer/categories" className="px-4 py-2 rounded-full border border-gray-200 text-gray-700 text-sm font-medium">
              Browse Categories
            </Link>
            <Link href="/merchants" className="px-4 py-2 rounded-full bg-[#DB0002] text-white text-sm font-semibold">
              Browse All Shops
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const sortedSubCategories = category.sub_categories
    ?.filter(s => s.is_active)
    ?.sort((a, b) => a.display_order - b.display_order) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ========== MOBILE VIEW ========== */}
      <div className="lg:hidden">
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              title="Go back"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{category.icon}</span>
              <div>
                <h1 className="text-base font-bold text-gray-900">{category.name}</h1>
                <p className="text-[10px] text-gray-500">{sortedSubCategories.length} subcategories</p>
              </div>
            </div>
          </div>
        </div>

        {/* Subcategory Grid — Mobile (3 columns like the user's mockup) */}
        {sortedSubCategories.length > 0 && (
          <section className="px-4 pt-4 pb-2">
            <div className="grid grid-cols-3 gap-2">
              {/* "All" button */}
              <button
                onClick={() => handleSubCategoryClick(null)}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-150 active:scale-95 ${
                  selectedSubCategory === null
                    ? 'bg-[#DB0002] border-[#DB0002] text-white shadow-md shadow-red-200'
                    : 'bg-white border-gray-100 text-gray-700 shadow-sm'
                }`}
              >
                <span className="text-lg">🔥</span>
                <span className="text-[10px] font-semibold mt-0.5 leading-tight text-center">All</span>
              </button>

              {sortedSubCategories.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSubCategoryClick(sub.id === selectedSubCategory ? null : sub.id)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-150 active:scale-95 ${
                    selectedSubCategory === sub.id
                      ? 'bg-[#DB0002] border-[#DB0002] text-white shadow-md shadow-red-200'
                      : 'bg-white border-gray-100 text-gray-700 shadow-sm'
                  }`}
                >
                  <span className="text-lg">{sub.icon || '📁'}</span>
                  <span className="text-[10px] font-semibold mt-0.5 leading-tight text-center line-clamp-2">
                    {sub.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Active filter indicator */}
        {selectedSubCategory && (
          <div className="px-4 py-2">
            <div className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-2">
              <span className="text-xs text-[#DB0002] font-medium">
                Showing: {getSubCategoryName(selectedSubCategory)}
              </span>
              <button
                onClick={() => setSelectedSubCategory(null)}
                className="ml-auto text-[#DB0002] hover:text-red-700"
                title="Clear filter"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Merchant results */}
        <section className="px-4 py-3 pb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">
              {selectedSubCategory ? getSubCategoryName(selectedSubCategory) : 'All'} Merchants
            </h2>
            <span className="text-[10px] text-gray-400">{merchants.length} found</span>
          </div>

          {merchantsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : merchants.length > 0 ? (
            <div className="space-y-2.5">
              {merchants.map((merchant) => (
                <Link
                  key={merchant.id}
                  href={`/merchants/${merchant.slug}`}
                  className="flex bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 active:scale-[0.98] transition-all duration-150"
                >
                  {/* Image */}
                  <div className="w-24 h-24 flex-shrink-0">
                    {merchant.cover_image_url ? (
                      <img
                        src={merchant.cover_image_url}
                        alt={merchant.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-red-100 to-orange-100 flex items-center justify-center">
                        <span className="text-3xl">{category.icon || '🏪'}</span>
                      </div>
                    )}
                  </div>
                  {/* Details */}
                  <div className="flex-1 p-2.5 flex flex-col justify-center min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-gray-900 truncate">{merchant.name}</h3>
                      {merchant.is_verified && (
                        <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <svg className="w-3 h-3 text-yellow-400 fill-current flex-shrink-0" viewBox="0 0 20 20">
                        <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-700">
                        {merchant.rating > 0 ? Number(merchant.rating).toFixed(1) : 'New'}
                      </span>
                      {merchant.total_reviews > 0 && (
                        <>
                          <span className="text-[10px] text-gray-400">•</span>
                          <span className="text-[10px] text-gray-500">{merchant.total_reviews} reviews</span>
                        </>
                      )}
                    </div>
                    {merchant.city && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-[10px] text-gray-500 truncate">{merchant.city}</span>
                      </div>
                    )}
                  </div>
                  {/* Arrow */}
                  <div className="flex items-center pr-3 flex-shrink-0">
                    <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
              <span className="text-4xl mb-3 block">{category.icon}</span>
              <p className="text-gray-500 text-sm">No merchants found</p>
              <p className="text-gray-400 text-xs mt-1">
                {selectedSubCategory
                  ? 'Try selecting a different subcategory'
                  : 'Merchants will appear here once they register'}
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ========== DESKTOP VIEW ========== */}
      <div className="hidden lg:block max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/customer/dashboard" className="hover:text-[#DB0002]">Home</Link>
          <span>/</span>
          <Link href="/customer/categories" className="hover:text-[#DB0002]">Categories</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{category.name}</span>
        </div>

        {/* Category Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center shadow-sm">
            <span className="text-4xl">{category.icon}</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{category.name}</h1>
            {category.description && (
              <p className="mt-1 text-gray-600">{category.description}</p>
            )}
          </div>
        </div>

        {/* Subcategory filter pills */}
        {sortedSubCategories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Subcategories</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleSubCategoryClick(null)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  selectedSubCategory === null
                    ? 'bg-[#DB0002] text-white shadow-md'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                🔥 All
              </button>
              {sortedSubCategories.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSubCategoryClick(sub.id === selectedSubCategory ? null : sub.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    selectedSubCategory === sub.id
                      ? 'bg-[#DB0002] text-white shadow-md'
                      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {sub.icon} {sub.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Merchant Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {selectedSubCategory ? getSubCategoryName(selectedSubCategory) + ' ' : ''}Merchants
            </h2>
            <span className="text-sm text-gray-500">{merchants.length} found</span>
          </div>

          {merchantsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-56 bg-gray-200 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : merchants.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {merchants.map((merchant) => (
                <Link
                  key={merchant.id}
                  href={`/merchants/${merchant.slug}`}
                  className="group block overflow-hidden rounded-xl bg-white shadow-sm transition-all hover:shadow-md border border-gray-100"
                >
                  {/* Cover image */}
                  <div className="h-40 overflow-hidden bg-gray-200">
                    {merchant.cover_image_url ? (
                      <img
                        src={merchant.cover_image_url}
                        alt={merchant.name}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-red-100 to-orange-100 flex items-center justify-center">
                        <span className="text-5xl">{category.icon || '🏪'}</span>
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#DB0002] transition-colors">
                        {merchant.name}
                      </h3>
                      {merchant.is_verified && (
                        <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    {merchant.description && (
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">{merchant.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      {merchant.rating > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-yellow-400">⭐</span>
                          <span className="text-sm font-medium text-gray-900">{Number(merchant.rating).toFixed(1)}</span>
                          <span className="text-sm text-gray-500">({merchant.total_reviews})</span>
                        </div>
                      )}
                      {merchant.city && (
                        <span className="text-sm text-gray-500">📍 {merchant.city}</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-white p-12 text-center shadow-sm border border-gray-100">
              <span className="text-5xl mb-4 block">{category.icon}</span>
              <p className="text-gray-600 font-medium">No merchants found</p>
              <p className="text-gray-400 text-sm mt-2">
                {selectedSubCategory
                  ? 'Try selecting a different subcategory'
                  : 'Merchants will appear here once they register'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
