'use client';

import { useAuth } from '@/hooks/use-auth';
import Link from 'next/link';
import Image from 'next/image';

export default function CustomerMenuPage() {
  const { user: authUser, loading, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut('/customer/dashboard');
  };

  const fullName = authUser ? `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim() || 'User' : 'User';
  const initials = fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  const menuItems = [
    {
      label: 'Browse Categories',
      href: '/customer/categories',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
      description: 'Food, Restaurants, Shops & more',
    },
    {
      label: 'My Profile',
      href: '/customer/profile',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      description: 'Manage your personal information',
    },
    {
      label: 'Orders & Reservations',
      href: '/customer/orders',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      description: 'View your orders and bookings',
    },
    {
      label: 'My Vouchers',
      href: '/customer/vouchers',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
      ),
      description: 'Claim and use discount vouchers',
    },
    {
      label: 'Promotions / Post Ads',
      href: '/customer/promotions',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      ),
      description: 'Manage your "Looking For" ads',
    },
    {
      label: 'Notifications',
      href: '/customer/notifications',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
      description: 'View your notifications',
    },
    {
      label: 'My Reviews',
      href: '/customer/reviews',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
      description: 'Rate your purchases',
    },
    {
      label: 'Scan QR Code',
      href: '/customer/scan',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
      ),
      description: 'Scan merchant QR codes',
    },
    {
      label: 'Explore Map',
      href: '/customer/map',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
      description: 'Find merchants near you',
    },
    {
      label: 'Favorites',
      href: '/customer/profile',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      ),
      description: 'Your saved merchants and products',
    },
  ];

  const settingsItems = [
    {
      label: 'Notifications',
      href: '/customer/profile',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
    {
      label: 'Help & Support',
      href: '/customer/dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'About WeKonnek',
      href: '/',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <>
      {/* ========== MOBILE MENU PAGE ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* User Profile Card */}
        <div className="bg-white px-4 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 bg-gradient-to-br from-[#DB0002] to-purple-600 rounded-full flex items-center justify-center text-white text-lg font-bold">
              {initials}
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-gray-900">{fullName}</h2>
              <p className="text-xs text-gray-500">{authUser?.email}</p>
              <span className="text-[10px] bg-red-100 text-[#DB0002] px-2 py-0.5 rounded-full font-medium capitalize mt-0.5 inline-block">
                {authUser?.userType || 'Customer'}
              </span>
            </div>
            <Link href="/customer/profile" className="p-2 text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Main Menu Items */}
        <div className="bg-white mt-2">
          <div className="px-4 py-2">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Account</p>
          </div>
          {menuItems.map((item, idx) => (
            <Link
              key={idx}
              href={item.href}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors"
            >
              <div className="w-9 h-9 bg-red-50 rounded-full flex items-center justify-center text-[#DB0002]">
                {item.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                <p className="text-[11px] text-gray-400">{item.description}</p>
              </div>
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>

        {/* Settings */}
        <div className="bg-white mt-2">
          <div className="px-4 py-2">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Settings</p>
          </div>
          {settingsItems.map((item, idx) => (
            <Link
              key={idx}
              href={item.href}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors"
            >
              <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                {item.icon}
              </div>
              <p className="flex-1 text-sm font-medium text-gray-900">{item.label}</p>
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>

        {/* Sign Out */}
        <div className="bg-white mt-2 mb-4">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-red-50 transition-colors"
          >
            <div className="w-9 h-9 bg-red-50 rounded-full flex items-center justify-center text-[#DB0002]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#DB0002]">Sign Out</p>
          </button>
        </div>

        {/* App Version */}
        <div className="text-center pb-6">
          <p className="text-[10px] text-gray-400">WeKonnek v1.0.0</p>
        </div>
      </div>

      {/* ========== DESKTOP - Redirect to profile ========== */}
      <div className="hidden lg:block">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Menu</h1>
            <p className="text-gray-600">Quick access to all features</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {menuItems.map((item, idx) => (
              <Link
                key={idx}
                href={item.href}
                className="bg-white rounded-lg shadow-sm p-5 border border-gray-200 hover:shadow-md transition-shadow flex items-center gap-4"
              >
                <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center text-[#DB0002]">
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{item.label}</h3>
                  <p className="text-sm text-gray-500">{item.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
