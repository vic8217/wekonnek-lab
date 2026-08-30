'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import ChangePasswordModal from './ChangePasswordModal';
import VoiceSearchButton from './VoiceSearchButton';
import { getTotalCartCount, getActiveCartMerchantIds, onCartChange } from '@/lib/cart';
import NotificationInboxBell from './NotificationInboxBell';

export default function CustomerHeader({
  hideMobileSearch = false,
  showCart = false,
}: {
  hideMobileSearch?: boolean;
  showCart?: boolean;
}) {
  const router = useRouter();
  const { user: authUser, signOut } = useAuth();
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
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
      if (!target.closest('.account-dropdown') && !target.closest('.account-button')) setShowAccountDropdown(false);
    };

    if (showSettingsDropdown || showAccountDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsDropdown, showAccountDropdown]);

  const fullName = authUser ? `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim() || 'User' : 'User';
  const userType = authUser?.role || 'Customer';
  // Merchant pages may always offer a cart shortcut, while every customer
  // page must surface a pending cart as soon as it contains an item.
  const shouldShowCart = showCart || hasCartItems;

  return (
    <>
      {/* ========== MOBILE HEADER ========== */}
      <header className="xl:hidden bg-white">
        {/* Top bar - White with logo and search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <Link href="/customer/dashboard" className="flex items-center space-x-2">
              <Image
                src="/images/weKonnekLogov1.png"
                alt="WeKonnek"
                width={48}
                height={48}
                priority
                className="size-11 object-contain"
              />
              <span className="text-lg font-black tracking-tight">
                <span className="text-[#075cff]">WE</span>
                <span className="text-[#ff0719]">KONNEK</span>
              </span>
            </Link>
            <div className="flex items-center">
              {authUser && <NotificationInboxBell />}
              {authUser && <Link href="/customer/profile" aria-label="Open customer profile" className="ml-1 flex size-9 items-center justify-center rounded-full bg-purple-500 text-sm font-bold text-white">{fullName.charAt(0).toUpperCase()}</Link>}
              {shouldShowCart && <button onClick={goToCart} className="relative p-2" title={hasCartItems ? 'View pending cart' : 'Browse shops'}>
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DB0002] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                )}
              </button>}
            </div>
          </div>
        </div>

        {/* Search / Location Bar */}
        {!hideMobileSearch && <div className="px-4 pb-2">
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
        </div>}

      </header>

      {/* ========== DESKTOP HEADER ========== */}
      <header className="hidden xl:block bg-white text-white border-b border-gray-200 px-6 py-4">
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
                <NotificationInboxBell />
                {shouldShowCart && <button onClick={goToCart} className="relative rounded-full p-2 hover:bg-gray-100" title={hasCartItems ? 'View pending cart' : 'Browse shops'} aria-label={hasCartItems ? `View pending cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Browse shops'}>
                  <svg className="size-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
                  {cartCount > 0 && <span className="absolute right-0 top-0 flex size-[18px] items-center justify-center rounded-full border-2 border-white bg-[#DB0002] px-1 text-[10px] font-black text-white">{cartCount > 99 ? '99+' : cartCount}</span>}
                </button>}
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
                <div className="relative">
                  <button type="button" onClick={() => setShowAccountDropdown(value => !value)} aria-expanded={showAccountDropdown} aria-haspopup="menu" className="account-button flex items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-gray-100">
                    <span className="flex size-9 items-center justify-center rounded-full bg-purple-500 font-semibold text-white">{fullName.charAt(0).toUpperCase()}</span>
                    <span className="flex flex-col"><span className="text-sm font-medium text-gray-900">{fullName || 'Loading...'}</span><span className="text-xs capitalize text-gray-600">{userType}</span></span>
                    <svg className="size-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {showAccountDropdown && <div role="menu" className="account-dropdown absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-2 shadow-xl">
                    <Link role="menuitem" href="/customer/profile" onClick={() => setShowAccountDropdown(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100">My Profile</Link>
                    <Link role="menuitem" href="/customer/addresses" onClick={() => setShowAccountDropdown(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Saved Addresses</Link>
                    <Link role="menuitem" href="/customer/notifications" onClick={() => setShowAccountDropdown(false)} className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Notifications</Link>
                    <button role="menuitem" type="button" onClick={() => { setShowAccountDropdown(false); setShowChangePasswordModal(true); }} className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100">Change Password</button>
                    <button role="menuitem" type="button" onClick={() => signOut('/customer/dashboard')} className="block w-full border-t border-gray-100 px-4 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Sign Out</button>
                  </div>}
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-3">
                {shouldShowCart && <button onClick={goToCart} className="relative p-2" title={hasCartItems ? 'View pending cart' : 'Browse shops'}>
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                  {cartCount > 0 && (
                    <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DB0002] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                      {cartCount > 99 ? '99+' : cartCount}
                    </span>
                  )}
                </button>}
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
