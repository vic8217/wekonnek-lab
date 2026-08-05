'use client';

import { usePathname } from 'next/navigation';
import { useRequireAuth } from '@/hooks/use-auth';
import MerchantHeader from '@/components/MerchantHeader';
import MerchantSidebar from '@/components/MerchantSidebar';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/shop') return children;
  return <ProtectedShopLayout>{children}</ProtectedShopLayout>;
}

function ProtectedShopLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(['merchant'], '/shop');
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><div className="size-9 animate-spin rounded-full border-3 border-[#DB0002] border-t-transparent" /></div>;
  return <div className="min-h-screen bg-gray-50"><MerchantHeader /><div className="flex"><div className="hidden lg:block"><MerchantSidebar subscriptionTier="platinum" basePath="/shop" /></div><main className="flex-1 p-3 pb-20 lg:p-6">{children}</main></div></div>;
}
