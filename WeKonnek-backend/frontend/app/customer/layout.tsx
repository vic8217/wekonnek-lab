"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, getToken, getUser } from "@/hooks/use-auth";
import CustomerSidebar from "@/components/CustomerSidebar";
import CustomerHeader from "@/components/CustomerHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import PortalBackButton from "@/components/PortalBackButton";

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
  const isGuest = !customerUser && !getToken();
  const onPublicRoute = isPublicRoute(pathname);
  const isDashboard = pathname === "/customer/dashboard";
  const isMap = pathname === "/customer/map";
  const isProfile = pathname === "/customer/profile";
  const isEditProfile = pathname === "/customer/edit-profile";
  const isScan = pathname === "/customer/scan";
  const isMarketplaceCategory = pathname.startsWith("/customer/explore/");
  const isMerchantDetail = /^\/customer\/explore\/[^/]+\/[^/]+/.test(pathname);
  const usesStandaloneDesktop = isDashboard || isMarketplaceCategory;

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
    <div className="min-h-screen bg-gray-50">
      <div className={usesStandaloneDesktop ? "xl:hidden" : ""}>
        <CustomerHeader
          hideMobileSearch={isMap || isProfile || isEditProfile || isScan}
          showCart={isMerchantDetail}
        />
      </div>

      {/* Desktop layout: sidebar + main */}
      <div className={usesStandaloneDesktop ? "hidden" : "hidden xl:flex"}>
        <CustomerSidebar />
        <main className="flex-1 p-6">
          {!isEditProfile && <PortalBackButton />}
          {children}
        </main>
      </div>

      {usesStandaloneDesktop && (
        <div className="hidden xl:block">{children}</div>
      )}

      {/* Mobile layout: full width content + bottom nav */}
      <div className="xl:hidden">
        <main className="pb-20">
          {!isMarketplaceCategory && !isEditProfile && (
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
