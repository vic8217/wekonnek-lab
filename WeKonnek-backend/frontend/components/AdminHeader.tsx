'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import Link from 'next/link';
import Image from 'next/image';
import ChangePasswordModal from './ChangePasswordModal';
import NotificationInboxBell from './NotificationInboxBell';

export default function AdminHeader({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user: authUser, signOut } = useAuth();
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);

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
  const userType = authUser?.role || 'Admin';

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/" className="flex items-center space-x-2 min-w-0">
            <Image
              src="/logo/weKonnekLogov1.png"
              alt="WeKonnek Logo"
              width={48}
              height={32}
              className="w-12 h-8 object-contain flex-shrink-0"
            />
            <span className="text-lg sm:text-xl font-bold text-gray-900 truncate">WeKonnek</span>
          </Link>
        </div>
        <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
          <NotificationInboxBell />
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
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white font-semibold">
              {fullName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:flex flex-col">
              <span className="text-sm font-medium text-gray-900">{fullName || 'Loading...'}</span>
              <span className="text-xs text-gray-500 capitalize">{userType}</span>
            </div>
            <button
              onClick={() => signOut('/admin/login')}
              className="ml-2 p-1 hover:bg-gray-100 rounded transition-colors"
              title="Sign Out"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
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
