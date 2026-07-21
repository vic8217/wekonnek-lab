'use client';

import { useEffect } from 'react';
import { useRequireAuth } from '@/hooks/use-auth';
import MerchantSidebar from '@/components/MerchantSidebar';
import MerchantHeader from '@/components/MerchantHeader';
import MerchantMobileBottomNav from '@/components/MerchantMobileBottomNav';
import PortalBackButton from '@/components/PortalBackButton';

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, refreshAuth } = useRequireAuth(['merchant']);

  useEffect(() => {
    if (!loading && !user) refreshAuth();
  }, [loading, user, refreshAuth]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <img src="/logo/weKonnekLogov1.png" alt="WeKonnek" className="w-24 h-16 mx-auto mb-4 animate-pulse object-contain" />
          <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MerchantHeader />
      <div className="flex">
        <div className="hidden lg:block">
          <MerchantSidebar />
        </div>
        <main className="flex-1 p-3 pb-20 lg:p-6 lg:pb-6">
          <PortalBackButton />
          {children}
        </main>
      </div>
      <MerchantMobileBottomNav />
    </div>
  );
}
