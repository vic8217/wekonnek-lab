'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getToken, getUser } from '@/hooks/use-auth';

// Authentication is forwarded through the same-origin Next.js auth proxy.
const API = '';

export default function AdminSidebar({
  mobileOpen = false,
  onClose,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const [userType, setUserType] = useState<'admin' | 'staff' | null>(null);
  const settingsActive = ['/admin/subscriptions', '/admin/categories', '/admin/zones', '/admin/payments', '/admin/social-login-providers', '/admin/delivery-partners'].some(isPath => pathname === isPath || pathname?.startsWith(`${isPath}/`));
  const [settingsExpanded, setSettingsExpanded] = useState(settingsActive);

  useEffect(() => {
    const checkUserType = async () => {
      const cachedType = getUser()?.userType;
      if (cachedType === 'admin' || cachedType === 'staff') {
        setUserType(cachedType);
      }

      try {
        const token = getToken();
        if (!token) return;

        const res = await fetch(`${API}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const profile = await res.json();
        const profileType = profile?.userType ?? profile?.user_type ?? profile?.role;
        if (profileType === 'admin' || profileType === 'staff') {
          setUserType(profileType);
        }
      } catch (error) {
        console.error('Error checking user type:', error);
      }
    };
    checkUserType();
  }, []);

  useEffect(() => {
    if (settingsActive) setSettingsExpanded(true);
  }, [settingsActive]);

  const isActive = (path: string) => {
    return pathname === path || pathname?.startsWith(path + '/');
  };

  const navContent =
    userType === null ? (
      <div className="px-4 py-8 text-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    ) : (
      <nav className="px-4 py-2 space-y-2" onClick={onClose}>
        <Link
          href="/admin/dashboard"
          className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
            isActive('/admin/dashboard')
              ? 'bg-[#DB0002] text-white'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span className="font-medium">
            {userType === 'admin' ? 'Admin Dashboard' : 'Staff Dashboard'}
          </span>
        </Link>

        <Link
          href="/admin/bazaar-listings"
          className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
            (isActive('/admin/bazaar-listings') || isActive('/admin/bazaar-promos')) ? 'bg-[#DB0002] text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <span className="flex w-5 justify-center text-lg">🛡️</span>
          <span className="font-medium">Bazaar Management</span>
        </Link>

        <Link
          href="/admin/property"
          className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
            isActive('/admin/property') ? 'bg-[#DB0002] text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <span className="flex w-5 justify-center text-lg">🏠</span>
          <span className="font-medium">Property Management</span>
        </Link>

        {/* Admin-only menu items */}
        {userType === 'admin' ? (
          <>
            <Link
              href="/admin/merchants"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/merchants')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="font-medium">Merchant Management</span>
            </Link>

            <Link
              href="/admin/riders"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/riders')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
              <span className="font-medium">Rider Management</span>
            </Link>

            <Link
              href="/admin/coordinators"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                (isActive('/admin/coordinators') || isActive('/admin/coordinator-resources'))
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H2v-2a4 4 0 014-4h3m6 6H9v-2a4 4 0 018 0v2zM8 11a4 4 0 100-8 4 4 0 000 8zm8 1a3 3 0 100-6 3 3 0 000 6z" />
              </svg>
              <span className="font-medium">Coordinator Management</span>
            </Link>

            <div>
              <button type="button" onClick={(event) => { event.stopPropagation(); setSettingsExpanded(value => !value); }} aria-expanded={settingsExpanded} className={`flex w-full items-center space-x-3 rounded-lg px-4 py-3 text-left transition-colors ${settingsActive ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-100'}`}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317a1.724 1.724 0 013.35 0 1.724 1.724 0 002.573 1.066 1.724 1.724 0 012.37 2.37 1.724 1.724 0 001.066 2.573 1.724 1.724 0 010 3.35 1.724 1.724 0 00-1.066 2.573 1.724 1.724 0 01-2.37 2.37 1.724 1.724 0 00-2.573 1.066 1.724 1.724 0 01-3.35 0 1.724 1.724 0 00-2.573-1.066 1.724 1.724 0 01-2.37-2.37 1.724 1.724 0 00-1.066-2.573 1.724 1.724 0 010-3.35 1.724 1.724 0 001.066-2.573 1.724 1.724 0 012.37-2.37 1.724 1.724 0 002.573-1.066z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                <span className="flex-1 font-medium">Settings</span><span className={`text-xs transition-transform ${settingsExpanded ? 'rotate-180' : ''}`}>⌄</span>
              </button>
              {settingsExpanded && <div className="ml-4 space-y-1 border-l border-gray-200 pl-3">
                {[
                  ['/admin/subscriptions', 'Subscription Tier'],
                  ['/admin/categories', 'Categories'],
                  ['/admin/zones', 'Zones'],
                  ['/admin/payments', 'Payments'],
                  ['/admin/delivery-partners', 'Delivery Partners'],
                  ['/admin/social-login-providers', 'Social Login Providers'],
                ].map(([href, label]) => <Link key={href} href={href} className={`block rounded-lg px-3 py-2 text-sm transition-colors ${isActive(href) ? 'bg-[#DB0002] font-medium text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</Link>)}
              </div>}
            </div>

            {false && <>
            <Link
              href="/admin/subscriptions"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/subscriptions')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              <span className="font-medium">Subscription Management</span>
            </Link>

            <Link
              href="/admin/payments"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/payments')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 8.25h19.5m-18 0v9A2.25 2.25 0 006 19.5h12a2.25 2.25 0 002.25-2.25v-9m-16.5 0v-1.5A2.25 2.25 0 016 4.5h12a2.25 2.25 0 012.25 2.25v1.5M6.75 15h2.25" />
              </svg>
              <span className="font-medium">Payments</span>
            </Link>

            <Link
              href="/admin/categories"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/categories')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="font-medium">Category Management</span>
            </Link>

            <Link
              href="/admin/orders"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/orders')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span className="font-medium">Order Monitoring</span>
            </Link>

            <Link
              href="/admin/zones"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/zones')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-medium">Coordinator Zones</span>
            </Link>
            </>}

            <Link
              href="/admin/users"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/users')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="font-medium">User Management</span>
            </Link>
          </>
        ) : (
          <>
            {/* Staff-only menu items */}
            <Link
              href="/admin/merchants/register"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/merchants/register')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="font-medium">Merchant Registration</span>
            </Link>

            <Link
              href="/admin/posts/create"
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive('/admin/posts/create')
                  ? 'bg-[#DB0002] text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium">Create Post</span>
            </Link>
          </>
        )}
      </nav>
    );

  return (
    <>
      {/* Desktop static sidebar */}
      <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto bg-white border-r border-gray-200 lg:block">
        {navContent}
      </aside>

      {/* Mobile slide-in drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[80%] bg-white border-r border-gray-200 shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="font-bold text-gray-900">Menu</span>
              <button onClick={onClose} className="p-1 text-gray-500" aria-label="Close menu">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
