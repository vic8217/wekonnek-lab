'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function MerchantMobileBottomNav({ subscriptionTier }: { subscriptionTier: string }) {
  const pathname = usePathname();
  const hasPlatinum = subscriptionTier === 'platinum';
  const [orderCount, setOrderCount] = useState(0);
  const [reservationCount, setReservationCount] = useState(0);

  const fetchCounts = useCallback(async () => {
    if (!hasPlatinum) return;
    try {
      const token = getToken();
      if (!token) return;

      const merchantRes = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!merchantRes.ok) return;
      const merchant = await merchantRes.json();
      if (!merchant?.id) return;

      const [ordersRes, resRes] = await Promise.all([
        fetch(`${API}/api/orders?merchantId=${merchant.id}&status=pending,processing&countOnly=true`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/reservations?merchantId=${merchant.id}&status=pending,confirmed&countOnly=true`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrderCount(data.count ?? (Array.isArray(data) ? data.length : 0));
      }
      if (resRes.ok) {
        const data = await resRes.json();
        setReservationCount(data.count ?? (Array.isArray(data) ? data.length : 0));
      }
    } catch (error) {
      console.error('Error fetching nav counts:', error);
    }
  }, [hasPlatinum]);

  useEffect(() => {
    const initialFetch = setTimeout(fetchCounts, 0);
    const interval = setInterval(fetchCounts, 30000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchCounts]);

  const isActive = (path: string) => {
    if (path === '/merchant/dashboard') return pathname === '/merchant/dashboard';
    return pathname?.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-gray-200/80 z-50 lg:hidden safe-area-bottom no-select">
      <div className="flex items-center justify-around h-16 px-1 max-w-lg mx-auto">
        {/* Dashboard */}
        <Link
          href="/merchant/dashboard"
          className={`flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200 ${isActive('/merchant/dashboard') ? 'scale-105' : ''}`}
        >
          <div className={`p-1 rounded-xl transition-colors duration-200 ${isActive('/merchant/dashboard') ? 'bg-red-50' : ''}`}>
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isActive('/merchant/dashboard') ? 'text-[#DB0002]' : 'text-gray-400'}`}
              fill={isActive('/merchant/dashboard') ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive('/merchant/dashboard') ? 0 : 1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <span className={`text-[9px] mt-0.5 font-semibold transition-colors duration-200 ${isActive('/merchant/dashboard') ? 'text-[#DB0002]' : 'text-gray-400'}`}>
            Home
          </span>
        </Link>

        {/* Orders */}
        <Link
          href={hasPlatinum ? '/merchant/orders' : '/merchant/orders?tab=delivery'}
          className={`flex flex-col items-center justify-center flex-1 py-1 relative mobile-press transition-all duration-200 ${isActive('/merchant/orders') ? 'scale-105' : ''}`}
        >
          <div className={`p-1 rounded-xl transition-colors duration-200 relative ${isActive('/merchant/orders') ? 'bg-red-50' : ''}`}>
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isActive('/merchant/orders') ? 'text-[#DB0002]' : 'text-gray-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            {orderCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] font-bold flex items-center justify-center animate-pulse">
                {orderCount > 9 ? '9+' : orderCount}
              </span>
            )}
          </div>
          <span className={`text-[9px] mt-0.5 font-semibold transition-colors duration-200 ${isActive('/merchant/orders') ? 'text-[#DB0002]' : 'text-gray-400'}`}>
            Orders
          </span>
        </Link>

        {/* Reservations - Center Fab */}
        <div className="flex flex-col items-center justify-center flex-1 py-1 relative">
          <Link
            href={hasPlatinum ? '/merchant/reservations' : '/merchant/subscription/upgrade?required=platinum'}
            className={`w-14 h-14 rounded-2xl flex items-center justify-center -mt-7 shadow-lg relative mobile-press transition-all duration-200 ${
              isActive('/merchant/reservations')
                ? 'bg-[#B80002] shadow-red-400/40 scale-110'
                : 'bg-[#DB0002] shadow-red-300/40'
            }`}
          >
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {reservationCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 text-gray-900 rounded-full text-[9px] font-black flex items-center justify-center border-2 border-white animate-pulse">
                {reservationCount > 9 ? '9+' : reservationCount}
              </span>
            )}
          </Link>
        </div>

        {/* Analytics */}
        <Link
          href="/merchant/analytics"
          className={`flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200 ${isActive('/merchant/analytics') ? 'scale-105' : ''}`}
        >
          <div className={`p-1 rounded-xl transition-colors duration-200 ${isActive('/merchant/analytics') ? 'bg-red-50' : ''}`}>
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isActive('/merchant/analytics') ? 'text-[#DB0002]' : 'text-gray-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span className={`text-[9px] mt-0.5 font-semibold transition-colors duration-200 ${isActive('/merchant/analytics') ? 'text-[#DB0002]' : 'text-gray-400'}`}>
            Analytics
          </span>
        </Link>

        {/* More */}
        <Link
          href="/merchant/profile"
          className={`flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200 ${isActive('/merchant/profile') ? 'scale-105' : ''}`}
        >
          <div className={`p-1 rounded-xl transition-colors duration-200 ${isActive('/merchant/profile') ? 'bg-red-50' : ''}`}>
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isActive('/merchant/profile') ? 'text-[#DB0002]' : 'text-gray-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
          <span className={`text-[9px] mt-0.5 font-semibold transition-colors duration-200 ${isActive('/merchant/profile') ? 'text-[#DB0002]' : 'text-gray-400'}`}>
            More
          </span>
        </Link>
      </div>
    </nav>
  );
}
