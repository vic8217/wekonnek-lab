"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken, useRequireAuth } from "@/hooks/use-auth";
import MerchantHeader from "@/components/MerchantHeader";
import MerchantSidebar from "@/components/MerchantSidebar";
import {
  hasPlatinumAccess,
  merchantSubscriptionFromProfile,
  type MerchantSubscription,
} from "@/lib/merchant-subscription";

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/shop") return children;
  return <ProtectedShopLayout>{children}</ProtectedShopLayout>;
}

function ProtectedShopLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(["merchant"], "/shop");
  const pathname = usePathname();
  const router = useRouter();
  const [subscription, setSubscription] = useState<MerchantSubscription | null>(
    null,
  );
  const platinumRoutes = [
    "/shop/digital-menu",
    "/shop/table-configuration",
    "/shop/qr-codes",
    "/shop/reservations",
    "/shop/invoices",
  ];
  const requiresPlatinum = platinumRoutes.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  useEffect(() => {
    if (loading || !user) return;
    const load = async () => {
      try {
        const token = getToken();
        if (!token) return setSubscription({ tier: "basic", active: false });
        const response = await fetch("/api/backend/merchants/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok)
          return setSubscription({ tier: "basic", active: false });
        setSubscription(merchantSubscriptionFromProfile(await response.json()));
      } catch {
        setSubscription({ tier: "basic", active: false });
      }
    };
    void load();
  }, [loading, user]);

  useEffect(() => {
    if (subscription && requiresPlatinum && !hasPlatinumAccess(subscription))
      router.replace("/shop/shop");
  }, [requiresPlatinum, router, subscription]);

  if (
    loading ||
    !user ||
    !subscription ||
    (requiresPlatinum && !hasPlatinumAccess(subscription))
  )
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-9 animate-spin rounded-full border-3 border-[#DB0002] border-t-transparent" />
      </div>
    );
  return (
    <div className="min-h-screen bg-gray-50">
      <MerchantHeader />
      <div className="flex">
        <div className="hidden lg:block">
          <MerchantSidebar
            subscriptionTier={subscription.tier}
            subscriptionActive={subscription.active}
            basePath="/shop"
          />
        </div>
        <main className="flex-1 p-3 pb-20 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
