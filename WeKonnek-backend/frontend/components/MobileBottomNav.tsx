"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { QrCode } from "lucide-react";
import { getToken, getUser, useAuth } from "@/hooks/use-auth";

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { user: authUser } = useAuth();
  const [hasStoredCustomerSession, setHasStoredCustomerSession] =
    useState(false);
  const [openOrderCount, setOpenOrderCount] = useState(0);

  useEffect(() => {
    const syncSession = () => {
      const storedUser = getUser();
      setHasStoredCustomerSession(
        Boolean(getToken() && storedUser?.userType === "customer"),
      );
    };
    syncSession();
    window.addEventListener("wekonnek-auth-changed", syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener("wekonnek-auth-changed", syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const isCustomerSignedIn =
    authUser?.userType === "customer" || hasStoredCustomerSession;

  useEffect(() => {
    if (!isCustomerSignedIn) {
      setOpenOrderCount(0);
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const token = getToken();
        const response = await fetch("/api/backend/orders", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        const rows = Array.isArray(body) ? body : body.data || [];
        const terminal = new Set(["completed", "delivered", "cancelled"]);
        setOpenOrderCount(
          rows.filter(
            (order: { status?: string }) =>
              !terminal.has(String(order.status || "").toLowerCase()),
          ).length,
        );
      } catch {
        /* Keep navigation usable when orders are unavailable. */
      }
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, [isCustomerSignedIn, pathname]);

  const isActive = (path: string) => {
    if (path === "/customer/dashboard") {
      return pathname === "/customer/dashboard";
    }
    return pathname?.startsWith(path);
  };
  const isProfileSection =
    isActive("/customer/profile") || isActive("/customer/edit-profile");

  const profileHref = isCustomerSignedIn ? "/customer/profile" : "/auth/login";

  const ordersHref = isCustomerSignedIn
    ? "/customer/orders"
    : `/auth/login?redirect=${encodeURIComponent("/customer/orders")}`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50 xl:hidden safe-area-bottom no-select shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
      <div className="mx-auto flex h-20 max-w-3xl items-center justify-around px-2 pt-4">
        {/* Home */}
        <Link
          href="/customer/dashboard"
          className="flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200"
        >
          <svg
            className={`w-6 h-6 transition-colors duration-200 ${isActive("/customer/dashboard") ? "text-[#DB0002]" : "text-gray-400"}`}
            fill={isActive("/customer/dashboard") ? "currentColor" : "none"}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={isActive("/customer/dashboard") ? 0 : 1.8}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <span
            className={`text-[10px] mt-0.5 font-semibold transition-colors duration-200 ${isActive("/customer/dashboard") ? "text-[#DB0002]" : "text-gray-400"}`}
          >
            Home
          </span>
        </Link>

        {/* Orders */}
        <Link
          href={ordersHref}
          className="flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200"
        >
          <span className="relative">
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${isActive("/customer/orders") ? "text-[#DB0002]" : "text-gray-400"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
            {openOrderCount > 0 && (
              <span className="absolute -right-2 -top-2 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-[#DB0002] px-1 text-[9px] font-black text-white">
                {openOrderCount > 99 ? "99+" : openOrderCount}
              </span>
            )}
          </span>
          <span
            className={`text-[10px] mt-0.5 font-semibold transition-colors duration-200 ${isActive("/customer/orders") ? "text-[#DB0002]" : "text-gray-400"}`}
          >
            Orders
          </span>
        </Link>

        {/* Scan QR - Center Fab */}
        <Link
          href="/customer/scan"
          className="flex flex-col items-center justify-center flex-1 py-1 relative mobile-press"
          title="Scan QR code"
        >
          <div className="relative w-14 h-14 rounded-full bg-[#DB0002] flex items-center justify-center -mt-7 shadow-lg shadow-red-300/50 transition-all duration-200 active:scale-95">
            <QrCode className="w-7 h-7 text-white" strokeWidth={2} />
          </div>
          <span className="text-[10px] mt-0.5 font-semibold text-[#DB0002]">
            Scan
          </span>
        </Link>

        {/* Deals */}
        <Link
          href="/customer/deals"
          className="flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200"
        >
          <svg
            className={`w-6 h-6 transition-colors duration-200 ${isActive("/customer/deals") ? "text-[#DB0002]" : "text-gray-400"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
            />
          </svg>
          <span
            className={`text-[10px] mt-0.5 font-semibold transition-colors duration-200 ${isActive("/customer/deals") ? "text-[#DB0002]" : "text-gray-400"}`}
          >
            Deals
          </span>
        </Link>

        {/* Profile */}
        <Link
          href={profileHref}
          className="flex flex-col items-center justify-center flex-1 py-1 mobile-press transition-all duration-200"
        >
          <svg
            className={`w-6 h-6 transition-colors duration-200 ${isProfileSection ? "text-[#DB0002]" : "text-gray-400"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span
            className={`text-[10px] mt-0.5 font-semibold transition-colors duration-200 ${isProfileSection ? "text-[#DB0002]" : "text-gray-400"}`}
          >
            {isCustomerSignedIn ? "Profile" : "Sign In"}
          </span>
        </Link>
      </div>
    </nav>
  );
}
