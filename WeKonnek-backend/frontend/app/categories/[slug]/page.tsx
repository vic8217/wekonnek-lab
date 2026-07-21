'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { categoriesApi, merchantsApi, Category, Merchant } from '@/lib/api';
import MerchantCard from '@/components/MerchantCard';
import Link from 'next/link';

export default function CategoryDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [category, setCategory] = useState<Category | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [categoryData, merchantsData] = await Promise.all([
          categoriesApi.getBySlug(slug),
          merchantsApi.search({ categoryId: undefined }),
        ]);

        setCategory(categoryData);
        // Filter merchants by category
        const filteredMerchants = merchantsData.data.filter(
          (m) => m.categoryId === categoryData.id,
        );
        setMerchants(filteredMerchants);
      } catch (err) {
        setError('Failed to load category. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      fetchData();
    }
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !category) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-red-50 p-4">
            <p className="text-red-800">{error || 'Category not found'}</p>
            <Link href="/categories" className="mt-4 text-blue-600 hover:underline">
              ← Back to Categories
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Link
          href="/categories"
          className="mb-6 inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
        >
          ← Back to Categories
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{category.name}</h1>
          {category.description && (
            <p className="mt-2 text-gray-600">{category.description}</p>
          )}
        </div>

        {category.subCategories && category.subCategories.length > 0 && (
          <div className="mb-8">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Sub-Categories</h2>
            <div className="flex flex-wrap gap-2">
              {category.subCategories.map((subCat) => (
                <Link
                  key={subCat.id}
                  href={`/categories/${category.slug}?subCategory=${subCat.id}`}
                  className="inline-flex items-center rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  {subCat.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Merchants</h2>
          {merchants.length === 0 ? (
            <div className="rounded-lg bg-white p-8 text-center shadow-sm">
              <p className="text-gray-600">No merchants found in this category.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {merchants.map((merchant) => (
                <MerchantCard key={merchant.id} merchant={merchant} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
