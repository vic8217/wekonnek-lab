'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, useRequireAuth } from '@/hooks/use-auth';
import MerchantSidebar from '@/components/MerchantSidebar';
import MerchantHeader from '@/components/MerchantHeader';
import MerchantMobileBottomNav from '@/components/MerchantMobileBottomNav';
import PortalBackButton from '@/components/PortalBackButton';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === '/merchant' || pathname === '/merchant/reset-password') return children;
  return <ProtectedMerchantLayout>{children}</ProtectedMerchantLayout>;
}

function ProtectedMerchantLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(['merchant'], '/merchant');
  const pathname = usePathname();
  const router = useRouter();
  const [subscriptionTier, setSubscriptionTier] = useState<string | null>(null);

  const isPlatinumFeature =
    pathname === '/merchant/qr-codes' ||
    pathname?.startsWith('/merchant/qr-codes/') ||
    pathname === '/merchant/reservations' ||
    pathname?.startsWith('/merchant/reservations/');

  useEffect(() => {
    if (!loading && user?.mustChangePassword && pathname !== '/merchant/settings/security') {
      router.replace('/merchant/settings/security');
    }
  }, [loading, pathname, router, user]);

  useEffect(() => {
    if (loading || !user) return;

    const loadSubscription = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const response = await fetch(`${API}/api/merchants/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          setSubscriptionTier('basic');
          return;
        }
        const merchant = await response.json();
        setSubscriptionTier(String(merchant.subscription_tier || 'basic').toLowerCase());
      } catch {
        setSubscriptionTier('basic');
      }
    };

    loadSubscription();
  }, [loading, user]);

  useEffect(() => {
    if (subscriptionTier && subscriptionTier !== 'platinum' && isPlatinumFeature) {
      router.replace('/merchant/subscription/upgrade?required=platinum');
    }
  }, [isPlatinumFeature, router, subscriptionTier]);

  if (loading || !user || subscriptionTier === null) {
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

  if (
    (user.mustChangePassword && pathname !== '/merchant/settings/security') ||
    (subscriptionTier !== 'platinum' && isPlatinumFeature)
  ) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MerchantHeader />
      <div className="flex">
        <div className="hidden lg:block">
          <MerchantSidebar subscriptionTier={subscriptionTier} />
        </div>
        <main className="flex-1 p-3 pb-20 lg:p-6 lg:pb-6">
          <PortalBackButton />
          {children}
        </main>
      </div>
      <MerchantMobileBottomNav subscriptionTier={subscriptionTier} />
    </div>
  );
}
