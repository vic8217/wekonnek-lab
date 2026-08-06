'use client';

import Link from 'next/link';
import { Category, MerchantCategory } from '@/lib/api';

interface CategoryCardProps {
  category: Category | MerchantCategory;
}

export default function CategoryCard({ category }: CategoryCardProps) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group relative overflow-hidden rounded-lg bg-white p-6 shadow-sm transition-all hover:shadow-md border border-gray-100"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {category.name}
          </h3>
          {category.description && (
            <p className="mt-2 text-sm text-gray-600 line-clamp-2">
              {category.description}
            </p>
          )}
          {category.subCategories && category.subCategories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {category.subCategories.slice(0, 3).map((subCat) => (
                <span
                  key={subCat.id}
                  className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                >
                  {subCat.name}
                </span>
              ))}
              {category.subCategories.length > 3 && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  +{category.subCategories.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
        {category.icon && (
          <div className="ml-4 text-3xl">{category.icon}</div>
        )}
      </div>
    </Link>
  );
}
