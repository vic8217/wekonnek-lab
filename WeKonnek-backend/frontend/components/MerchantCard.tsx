'use client';

import Link from 'next/link';
import { Merchant } from '@/lib/api';

interface MerchantCardProps {
  merchant: Merchant;
}

const businessTypeLabels = {
  storefront: 'Storefront',
  mobile_cart: 'Mobile Cart',
  home_based: 'Home Based',
};

export default function MerchantCard({ merchant }: MerchantCardProps) {
  return (
    <Link
      href={`/merchants/${merchant.slug}`}
      className="group block overflow-hidden rounded-lg bg-white shadow-sm transition-all hover:shadow-md border border-gray-100"
    >
      {merchant.coverImageUrl && (
        <div className="aspect-video w-full overflow-hidden bg-gray-200">
          <img
            src={merchant.coverImageUrl}
            alt={merchant.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                {merchant.name}
              </h3>
              {merchant.isVerified && (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Verified
                </span>
              )}
            </div>
            {merchant.category && (
              <p className="mt-1 text-sm text-gray-500">
                {merchant.category.name}
                {merchant.subCategory && ` • ${merchant.subCategory.name}`}
              </p>
            )}
            <p className="mt-2 text-xs font-medium text-gray-600">
              {businessTypeLabels[merchant.businessType]}
            </p>
            {merchant.description && (
              <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                {merchant.description}
              </p>
            )}
            {merchant.city && (
              <p className="mt-2 text-sm text-gray-500">
                📍 {merchant.city}
                {merchant.state && `, ${merchant.state}`}
              </p>
            )}
            {Number(merchant.rating) > 0 && (
              <div className="mt-2 flex items-center gap-1">
                <span className="text-sm font-medium text-gray-900">
                  ⭐ {Number(merchant.rating).toFixed(1)}
                </span>
                <span className="text-sm text-gray-500">
                  ({merchant.totalReviews} reviews)
                </span>
              </div>
            )}
          </div>
          {merchant.logoUrl && (
            <div className="ml-4 h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
              <img
                src={merchant.logoUrl}
                alt={merchant.name}
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
