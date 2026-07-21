'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import ChangePasswordModal from './ChangePasswordModal';
import VoiceSearchButton from './VoiceSearchButton';
import { getTotalCartCount, getActiveCartMerchantIds, onCartChange } from '@/lib/cart';

export default function CustomerHeader() {
  const router = useRouter();
  const { user: authUser, signOut } = useAuth();
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cartCount, setCartCount] = useState(0);
  const [hasCartItems, setHasCartItems] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setCartCount(getTotalCartCount());
      setHasCartItems(getActiveCartMerchantIds().length > 0);
    };
    refresh();
    return onCartChange(refresh);
  }, []);

  const goToCart = () => router.push(hasCartItems ? '/customer/cart' : '/merchants');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.settings-dropdown') && !target.closest('.settings-button')) {
        setShowSettingsDropdown(false);
      }
    };

    if (showSettingsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsDropdown]);

  const fullName = authUser ? `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim() || 'User' : 'User';
  const userType = authUser?.role || 'Customer';

  return (
    <>
      {/* ========== MOBILE HEADER ========== */}
      <header className="lg:hidden bg-white">
        {/* Top bar - White with logo and search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <Link href="/customer/dashboard" className="flex items-center space-x-2">
              <div className="w-9 h-9 bg-gradient-to-br from-[#DB0002] to-[#FF6B35] rounded-xl flex items-center justify-center shadow-sm">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              </div>
              <span className="text-lg font-bold text-gray-900">WeKonnek</span>
            </Link>
            <div className="flex items-center">
              <button className="p-2" title="Search" onClick={() => setShowMobileSearch(!showMobileSearch)}>
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button onClick={goToCart} className="relative p-2" title={hasCartItems ? 'View cart' : 'Browse shops'}>
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DB0002] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Search / Location Bar */}
        <div className="px-4 pb-2">
          <form onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) router.push(`/customer/search?q=${searchQuery}`); }} className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search merchants, products..."
              className="w-full pl-11 pr-20 py-3 rounded-full bg-gray-100 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#DB0002]/20 border border-gray-200"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <VoiceSearchButton onResult={(text) => setSearchQuery(text)} />
              <button
                type="button"
                onClick={() => {
                  if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                      (pos) => router.push(`/customer/map?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`),
                      () => router.push('/customer/map')
                    );
                  } else {
                    router.push('/customer/map');
                  }
                }}
                className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center active:bg-gray-300 transition-colors"
                title="Current location"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06z" />
                </svg>
              </button>
            </div>
          </form>
        </div>

        {/* Expandable Mobile Search */}
        {showMobileSearch && (
          <div className="px-4 pb-3">
            <form onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) { router.push(`/customer/search?q=${searchQuery}`); setShowMobileSearch(false); } }} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for food, services..."
                className="w-full pl-4 pr-12 py-3 rounded-xl bg-gray-100 text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#DB0002]/20 border border-gray-200"
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <VoiceSearchButton onResult={(text) => setSearchQuery(text)} />
              </div>
            </form>
          </div>
        )}
      </header>

      {/* ========== DESKTOP HEADER ========== */}
      <header className="hidden lg:block bg-white text-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/logo/weKonnekLogov1.png"
              alt="WeKonnek Logo"
              width={48}
              height={32}
              className="w-12 h-8 object-contain"
            />
            <span className="text-xl font-bold text-gray-900">WeKonnek</span>
          </Link>
          <div className="flex items-center space-x-4">
            {authUser ? (
              <>
                <div className="relative settings-button">
                  <button
                    onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
                    className="p-2 hover:bg-gray-700 rounded-full transition-colors"
                    title="Settings"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  {showSettingsDropdown && (
                    <div className="settings-dropdown absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                      <button
                        onClick={() => {
                          setShowSettingsDropdown(false);
                          setShowChangePasswordModal(true);
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        Change Password
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                    {fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">{fullName || 'Loading...'}</span>
                    <span className="text-xs text-gray-600 capitalize">{userType}</span>
                  </div>
                  <button
                    onClick={() => signOut('/customer/dashboard')}
                    className="ml-2 p-1 hover:bg-gray-700 rounded transition-colors"
                    title="Sign Out"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-3">
                <button onClick={goToCart} className="relative p-2" title={hasCartItems ? 'View cart' : 'Browse shops'}>
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DB0002] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                      {cartCount > 99 ? '99+' : cartCount}
                    </span>
                  )}
                </button>
                <Link
                  href="/auth/login"
                  className="px-4 py-2 bg-[#DB0002] text-white text-sm font-semibold rounded-lg hover:bg-[#B80002] transition-colors"
                >
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <ChangePasswordModal
        isOpen={showChangePasswordModal}
        onClose={() => setShowChangePasswordModal(false)}
      />
    </>
  );
}
