'use client';

import { useEffect, useState } from 'react';
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

export default function CustomerCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch(`${API}/api/categories`);
        if (!res.ok) throw new Error('Failed to fetch categories');
        const data = await res.json();
        setCategories(data || []);
      } catch (error) {
        console.error('Error fetching categories:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCategories();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Mobile skeleton */}
        <div className="lg:hidden px-4 pt-4">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4 animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
        {/* Desktop skeleton */}
        <div className="hidden lg:block max-w-7xl mx-auto p-6">
          <div className="h-10 bg-gray-200 rounded w-64 mb-6 animate-pulse" />
          <div className="grid grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-40 bg-gray-200 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ========== MOBILE VIEW ========== */}
      <div className="lg:hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-xl font-bold text-gray-900">Browse Categories</h1>
          <p className="text-xs text-gray-500 mt-0.5">Discover local merchants by category</p>
        </div>

        {/* Category list — card style */}
        <div className="px-4 pb-6 space-y-2.5">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={cat.slug === 'property' ? '/property' : `/customer/categories/${cat.slug}`}
              className="flex items-center bg-white rounded-2xl p-3.5 shadow-sm border border-gray-100 active:scale-[0.98] transition-all duration-150"
            >
              {/* Icon circle */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-2xl">{cat.icon || '📁'}</span>
              </div>
              {/* Info */}
              <div className="ml-3 flex-1 min-w-0">
                <h3 className="text-sm font-bold text-gray-900">{cat.name}</h3>
                {cat.description && (
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{cat.description}</p>
                )}
                {cat.sub_categories && cat.sub_categories.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 overflow-hidden">
                    {cat.sub_categories.slice(0, 3).map((sub) => (
                      <span
                        key={sub.id}
                        className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full flex-shrink-0"
                      >
                        {sub.name}
                      </span>
                    ))}
                    {cat.sub_categories.length > 3 && (
                      <span className="text-[9px] text-gray-400 flex-shrink-0">
                        +{cat.sub_categories.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {/* Arrow */}
              <svg className="w-5 h-5 text-gray-300 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>

      {/* ========== DESKTOP VIEW ========== */}
      <div className="hidden lg:block max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Browse Categories</h1>
          <p className="mt-2 text-gray-600">
            Discover local merchants by category
          </p>
        </div>

        {categories.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm">
            <p className="text-gray-600">No categories available at the moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={cat.slug === 'property' ? '/property' : `/customer/categories/${cat.slug}`}
                className="group relative overflow-hidden rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md border border-gray-100"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#DB0002] transition-colors">
                      {cat.name}
                    </h3>
                    {cat.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                        {cat.description}
                      </p>
                    )}
                    {cat.sub_categories && cat.sub_categories.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {cat.sub_categories.slice(0, 4).map((sub) => (
                          <span
                            key={sub.id}
                            className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-[#DB0002]"
                          >
                            {sub.icon} {sub.name}
                          </span>
                        ))}
                        {cat.sub_categories.length > 4 && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                            +{cat.sub_categories.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 text-4xl">{cat.icon || '📁'}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
