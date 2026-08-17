'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import MobileBottomNav from '@/components/MobileBottomNav';

/**
 * The merchants browse pages live outside the /customer route group, so they
 * don't get the customer layout's bottom nav. Show it here too for logged-in
 * customers (the "Shops" tab points here) while leaving the public marketing
 * experience untouched for signed-out visitors.
 */
export default function MerchantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showNav, setShowNav] = useState(false);

  useEffect(() => {
    setShowNav(!!getToken());
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className={`min-w-0 overflow-x-hidden ${showNav ? 'pb-20 lg:pb-0' : ''}`}>{children}</div>
      {showNav && <MobileBottomNav />}
    </div>
  );
}
