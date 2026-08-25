"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, getToken, getUser } from "@/hooks/use-auth";
import CustomerSidebar from "@/components/CustomerSidebar";
import CustomerHeader from "@/components/CustomerHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import PortalBackButton from "@/components/PortalBackButton";
import OpenDineInTicketCard from "@/components/OpenDineInTicketCard";

const PUBLIC_PREFIXES = [
  "/customer/dashboard",
  "/customer/food",
  "/customer/mart",
  "/customer/express",
  "/customer/reserve",
  "/customer/search",
  "/customer/explore",
  "/customer/deals",
  "/customer/map",
  "/customer/cart",
  // Guests may reach checkout with a locally saved cart. The checkout page's
  // own auth gate then offers sign-in/registration without losing the cart.
  "/customer/checkout",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user?.userType === "customer") return;

    const cachedUser = getUser();
    const token = getToken();
    if (cachedUser && token) return;

    if (!isPublicRoute(pathname)) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

  const customerUser = user?.userType === "customer" ? user : undefined;
  // Do not read browser storage during render. `getToken()` is unavailable on
  // the server, so using it here makes the initial server and client trees
  // disagree for signed-in customers and triggers hydration errors. Auth
  // state is synchronized by `useAuth`; while it is loading we keep the
  // authenticated shell stable and let the effect-driven state update settle.
  const isGuest = !loading && !customerUser;
  const onPublicRoute = isPublicRoute(pathname);
  const isMap = pathname === "/customer/map";
  const isProfile = pathname === "/customer/profile";
  const isEditProfile = pathname === "/customer/edit-profile";
  const isScan = pathname === "/customer/scan";
  const isCart = pathname === "/customer/cart";
  const isCheckout = pathname === "/customer/checkout";
  const isEReceipt = pathname.startsWith("/customer/e-receipts");
  const isDineInOrderFlow = /^\/customer\/orders\/[^/]+(?:\/bill-out)?$/.test(pathname);
  const isMarketplaceCategory = pathname.startsWith("/customer/explore/");
  const isMerchantDetail = /^\/customer\/explore\/[^/]+\/[^/]+/.test(pathname);

  if (loading && !onPublicRoute) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <img
          src="/logo/weKonnekLogov1.png"
          alt="WeKonnek"
          className="w-24 h-16 mb-4 animate-pulse object-contain"
        />
        <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isGuest && !onPublicRoute) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <img
          src="/logo/weKonnekLogov1.png"
          alt="WeKonnek"
          className="w-24 h-16 mb-4 animate-pulse object-contain"
        />
        <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-gray-50">
      <div className="xl:sticky xl:top-0 xl:z-50"><CustomerHeader
        hideMobileSearch={isMap || isProfile || isEditProfile || isScan || isCart || isMarketplaceCategory || isCheckout || isDineInOrderFlow || isEReceipt}
        showCart={isMerchantDetail}
      /></div>

      {!isGuest && <OpenDineInTicketCard />}

      {/* Desktop layout: sidebar + main */}
      <div className="hidden min-w-0 xl:flex">
        <div className="sticky top-16 self-start"><CustomerSidebar /></div>
        <main className="min-w-0 flex-1 overflow-x-hidden p-6">
          {!isEditProfile && !isEReceipt && <PortalBackButton />}
          {children}
        </main>
      </div>

      {/* Mobile layout: full width content + bottom nav */}
      <div className="min-w-0 xl:hidden">
        <main className="min-w-0 overflow-x-hidden pb-20">
          {!isMarketplaceCategory && !isEditProfile && !isCheckout && !isEReceipt && (
            <div className="px-4 pt-3 empty:hidden">
              <PortalBackButton />
            </div>
          )}
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
