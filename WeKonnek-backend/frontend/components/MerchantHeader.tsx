'use client';

import { useState, useEffect } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import ChangePasswordModal from './ChangePasswordModal';
import MerchantNotificationBell from './MerchantNotificationBell';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface MerchantInfo {
  name: string;
  logo_url: string | null;
  category_id: number | null;
  category?: { name?: string | null } | null;
}

interface ActiveShop {
  name: string;
  branch_name?: string;
  merchant_name?: string;
}

export default function MerchantHeader() {
  const pathname = usePathname();
  const isShopPortal = pathname.startsWith('/shop');
  const portalBase = isShopPortal ? '/shop' : '/merchant';
  const { user: authUser, signOut } = useAuth();
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [activeShop, setActiveShop] = useState<ActiveShop | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

  useEffect(() => {
    const fetchMerchant = async () => {
      const token = getToken();
      if (!token || !authUser) return;
      try {
        const res = await fetch(`${API_URL}/api/merchants/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setMerchant(data);
        }
      } catch {
        // merchant info not critical for header rendering
      }
    };
    fetchMerchant();
  }, [authUser]);

  useEffect(() => {
    if (!isShopPortal) return;
    try {
      const stored = sessionStorage.getItem('wk_active_shop');
      setActiveShop(stored ? JSON.parse(stored) : null);
    } catch {
      setActiveShop(null);
    }
  }, [isShopPortal]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.user-dropdown') && !target.closest('.user-button')) {
        setShowDropdown(false);
      }
      if (!target.closest('.settings-dropdown') && !target.closest('.settings-button')) {
        setShowSettingsDropdown(false);
      }
    };

    if (showDropdown || showSettingsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown, showSettingsDropdown]);

  const fullName = authUser ? `${authUser.firstName || ''} ${authUser.lastName || ''}`.trim() || 'User' : 'User';
  const userType = authUser?.role || 'Merchant';
  const categoryLabel = merchant?.category?.name?.trim() || 'Uncategorized';
  const displayName = isShopPortal ? activeShop?.branch_name || activeShop?.name || fullName : fullName;
  const displayRole = isShopPortal
    ? `Shop${activeShop?.merchant_name || merchant?.name ? ` · ${activeShop?.merchant_name || merchant?.name}` : ''}`
    : userType;

  return (
    <>
      {/* ============ MOBILE HEADER ============ */}
      <header className="lg:hidden bg-gradient-to-r from-[#DB0002] to-[#A50002] text-white px-3 py-2.5">
        <div className="flex items-center justify-between">
          {/* Left: Logo + Gateway Title */}
          <Link href={`${portalBase}/dashboard`} className="flex items-center gap-2">
            <Image
              src="/logo/weKonnekLogov1.png"
              alt="WeKonnek Logo"
              width={48}
              height={32}
              className="w-10 h-7 bg-white rounded-md p-0.5 object-contain"
            />
            <div>
              <p className="text-[8px] font-bold uppercase tracking-wider opacity-80 leading-tight">{isShopPortal ? 'Shop' : 'Merchant Admin'}</p>
              <p className="text-xs font-bold leading-tight">Gateway</p>
            </div>
          </Link>

          {/* Center: Business Type Badge */}
          <div className="bg-white/20 rounded-full px-3 py-1">
            <span className="text-[10px] font-bold uppercase tracking-wider">{categoryLabel}</span>
          </div>

          {/* Right: Store name + Actions */}
          <div className="flex items-center gap-1">
            {/* Notification Bell (stock alerts, new orders, bookings) */}
            <MerchantNotificationBell variant="light" />

            {/* Avatar */}
            <Link href={`${portalBase}/profile`} className="w-7 h-7 bg-white rounded-full flex items-center justify-center text-xs font-bold text-red-600">
              {displayName.charAt(0).toUpperCase()}
            </Link>
          </div>
        </div>

        {/* Mobile Merchant Name Bar */}
        <div className="flex items-center justify-between mt-1.5 bg-white/10 rounded-lg px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            {merchant?.logo_url ? (
              <Image
                src={merchant.logo_url}
                alt={merchant?.name || 'Store'}
                width={24}
                height={24}
                className="w-5 h-5 rounded"
              />
            ) : (
              <div className="w-5 h-5 bg-white/30 rounded flex items-center justify-center text-[8px] font-bold">
                {merchant?.name?.charAt(0) || 'M'}
              </div>
            )}
            <span className="text-xs font-semibold truncate max-w-[160px]">{isShopPortal ? displayName : merchant?.name || 'My Store'}</span>
          </div>
          <span className="text-[9px] bg-green-400 text-green-900 px-2 py-0.5 rounded-full font-bold">Active</span>
        </div>
      </header>

      {/* ============ DESKTOP HEADER ============ */}
      <header className="hidden lg:flex bg-white border-b border-gray-200 px-6 py-4 items-center justify-between">
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

        {/* Business Type Indicator */}
        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-1.5">
          <span className="text-sm font-medium text-gray-600">Category:</span>
          <span className="text-sm font-bold text-gray-900">{categoryLabel}</span>
        </div>

        <div className="flex items-center space-x-4">
          {/* Notification Bell (stock alerts, new orders, bookings) */}
          <MerchantNotificationBell variant="dark" />

          <div className="relative settings-button">
            <button
              onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
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
          <div className="relative user-button">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center space-x-3 hover:bg-gray-100 rounded-lg px-3 py-2 transition-colors"
            >
              <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col items-start">
                <span className="text-sm font-medium text-gray-900">{displayName || 'Loading...'}</span>
                <span className="text-xs text-gray-500 capitalize">{displayRole}</span>
              </div>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showDropdown && (
              <div className="user-dropdown absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <Link
                  href={`${portalBase}/profile`}
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => setShowDropdown(false)}
                >
                  Profile Settings
                </Link>
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    signOut(portalBase);
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Sign Out
                </button>
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
