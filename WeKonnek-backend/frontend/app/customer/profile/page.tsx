"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Heart,
  LogOut,
  MapPin,
  Pencil,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Ticket,
  WalletCards,
  ReceiptText,
} from "lucide-react";
import { getToken, useAuth } from "@/hooks/use-auth";
import ListingSummaryCard from "@/components/profile/ListingSummaryCard";

type Summary = {
  bazaar: { active: number; expired: number; unreadInquiries: number };
  property: { active: number; expired: number; unreadInquiries: number };
};
const EMPTY: Summary = {
  bazaar: { active: 0, expired: 0, unreadInquiries: 0 },
  property: { active: 0, expired: 0, unreadInquiries: 0 },
};

const metrics = [
  {
    label: "Orders",
    value: 0,
    icon: ShoppingBag,
    href: "/customer/orders",
    color: "text-red-500",
  },
  {
    label: "Reservations",
    value: 0,
    icon: CalendarDays,
    href: "/customer/bookings",
    color: "text-blue-500",
  },
  {
    label: "Favorites",
    value: 0,
    icon: Heart,
    href: "/property/saved",
    color: "text-pink-500",
  },
  {
    label: "Vouchers",
    value: 0,
    icon: Ticket,
    href: "/customer/vouchers",
    color: "text-purple-500",
  },
  {
    label: "Reviews",
    value: 0,
    icon: Star,
    href: "/customer/reviews",
    color: "text-emerald-500",
  },
];

const accountItems = [
  {
    label: "E-Receipts",
    detail: "View your saved electronic receipts",
    icon: ReceiptText,
    href: "/customer/e-receipts",
    color: "text-green-600 bg-green-50",
  },
  {
    label: "Addresses",
    detail: "Manage your saved addresses",
    icon: MapPin,
    href: "/customer/addresses",
    color: "text-red-500 bg-red-50",
  },
  {
    label: "Payment Methods",
    detail: "Cards, e-wallets and more",
    icon: WalletCards,
    href: "/customer/wallet",
    color: "text-blue-500 bg-blue-50",
  },
  {
    label: "Notifications",
    detail: "Manage your notification preferences",
    icon: Bell,
    href: "/customer/notifications",
    color: "text-amber-500 bg-amber-50",
  },
  {
    label: "Privacy & Security",
    detail: "Password, verification and privacy",
    icon: ShieldCheck,
    href: "/privacy",
    color: "text-emerald-500 bg-emerald-50",
  },
  {
    label: "Help & Support",
    detail: "FAQs, guides and contact us",
    icon: CircleHelp,
    href: "/contact",
    color: "text-purple-500 bg-purple-50",
  },
];

export default function CustomerProfilePage() {
  const { user, loading, signOut } = useAuth();
  const [summary, setSummary] = useState(EMPTY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [voucherCount, setVoucherCount] = useState(0);

  useEffect(() => {
    if (loading || !user) {
      if (!loading) setSummaryLoading(false);
      return;
    }
    const controller = new AbortController();
    const token = getToken();
    fetch("/api/backend/listing-inquiries/profile-summary", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Summary unavailable")),
      )
      .then(setSummary)
      .catch((error) => {
        if (error.name !== "AbortError") setSummary(EMPTY);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [loading, user]);

  useEffect(() => {
    if (loading || !user) {
      if (!loading) setVoucherCount(0);
      return;
    }

    let active = true;
    const loadVoucherCount = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const response = await fetch('/api/backend/vouchers/customer/available', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const body = await response.json();
        const vouchers = Array.isArray(body) ? body : body.data || [];
        if (active) setVoucherCount(vouchers.length);
      } catch {
        // Keep the last known count when the wallet is temporarily unavailable.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadVoucherCount();
    };

    loadVoucherCount();
    window.addEventListener('focus', loadVoucherCount);
    window.addEventListener('pageshow', loadVoucherCount);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', loadVoucherCount);
      window.removeEventListener('pageshow', loadVoucherCount);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loading, user]);

  const profileMetrics = useMemo(
    () => metrics.map(metric => metric.label === 'Vouchers' ? { ...metric, value: voucherCount } : metric),
    [voucherCount],
  );

  const fullName = useMemo(
    () =>
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      "WEKONNEK User",
    [user],
  );
  const initials = fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const memberSince = "August 2026";

  if (loading)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-3 border-[#DB0002] border-t-transparent" />
      </div>
    );

  return (
    <div className="mx-auto min-h-screen max-w-4xl bg-white px-4 pb-8 pt-3 text-slate-900 sm:px-6 lg:rounded-3xl lg:border lg:border-slate-200 lg:p-8 lg:shadow-sm">
      <header className="flex min-h-12 items-center justify-between">
        <Link
          href="/customer/dashboard"
          aria-label="Back to dashboard"
          className="grid h-11 w-11 place-items-center text-[#DB0002]"
        >
          <ChevronLeft size={28} />
        </Link>
        <h1 className="text-xl font-extrabold">My Profile</h1>
        <Link
          href="/customer/edit-profile"
          aria-label="Profile settings"
          className="grid h-11 w-11 place-items-center text-[#DB0002]"
        >
          <Settings size={27} />
        </Link>
      </header>

      <section className="mt-5 grid grid-cols-[96px_1fr] gap-4 sm:grid-cols-[128px_1fr] sm:gap-6">
        <div className="relative h-24 w-24 sm:h-32 sm:w-32">
          {user?.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt={fullName}
              fill
              sizes="128px"
              className="rounded-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-red-100 to-red-200 text-2xl font-extrabold text-[#DB0002]">
              {initials}
            </div>
          )}
          <Link
            href="/customer/edit-profile"
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow"
          >
            <Camera size={19} />
          </Link>
        </div>
        <div className="min-w-0 pt-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-xl font-extrabold sm:text-2xl">
              {fullName}
            </h2>
            {user && (
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-500 text-xs font-bold text-white">
                ✓
              </span>
            )}
          </div>
          <span className="mt-1 inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600">
            ✓ Verified User
          </span>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            Member since {memberSince}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
            <span className="font-bold">⭐ 0.0</span>
            <span className="text-slate-300">|</span>
            <span>
              <b>0</b> Ratings
            </span>
            <span>•</span>
            <span>
              <b>0</b> Completed Deals
            </span>
          </div>
          <Link
            href="/customer/edit-profile"
            className="mt-4 flex min-h-11 max-w-xs items-center justify-center gap-2 rounded-xl border border-[#DB0002] font-bold text-[#DB0002]"
          >
            <Pencil size={17} /> Edit Profile
          </Link>
        </div>
      </section>

      <section className="mt-7 grid grid-cols-5 rounded-2xl border border-slate-200 bg-white px-1 py-4 shadow-sm">
        {profileMetrics.map(({ label, value, icon: Icon, href, color }, index) => (
          <Link
            key={label}
            href={href}
            className={`min-w-0 text-center ${index ? "border-l border-slate-100" : ""}`}
          >
            <Icon className={`mx-auto h-6 w-6 ${color}`} />
            <span className="mt-1 block truncate text-[9px] font-semibold sm:text-xs">
              {label}
            </span>
            <strong className="mt-1 block text-lg">{value}</strong>
          </Link>
        ))}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Sell &amp; List</h2>
          <Link
            href="/my/listings"
            className="text-xs font-semibold text-[#DB0002]"
          >
            View all
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ListingSummaryCard
            type="bazaar"
            activeCount={summary.bazaar.active}
            expiredCount={summary.bazaar.expired}
            unreadInquiryCount={summary.bazaar.unreadInquiries}
            loading={summaryLoading}
          />
          <ListingSummaryCard
            type="property"
            activeCount={summary.property.active}
            expiredCount={summary.property.expired}
            unreadInquiryCount={summary.property.unreadInquiries}
            loading={summaryLoading}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Link
            href="/bazaar/post"
            className="flex min-h-12 items-center justify-center rounded-xl bg-[#DB0002] px-2 text-center text-xs font-bold text-white sm:text-sm"
          >
            ＋ Post an Item
          </Link>
          <Link
            href="/property/post"
            className="flex min-h-12 items-center justify-center rounded-xl border border-[#DB0002] px-2 text-center text-xs font-bold text-[#DB0002] sm:text-sm"
          >
            ＋ List a Property
          </Link>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-extrabold">Account</h2>
        {accountItems.map(({ label, detail, icon: Icon, href, color }) => (
          <Link
            key={label}
            href={href}
            className="flex min-h-16 items-center gap-3 border-b border-slate-100 last:border-0"
          >
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${color}`}
            >
              <Icon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">{label}</strong>
              <span className="block truncate text-xs text-slate-500">
                {detail}
              </span>
            </span>
            <ChevronRight className="text-slate-400" size={19} />
          </Link>
        ))}
      </section>

      <button
        onClick={async () => {
          setLoggingOut(true);
          await signOut("/customer/dashboard");
        }}
        disabled={loggingOut}
        className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50/60 font-bold text-[#DB0002] disabled:opacity-60"
      >
        <LogOut size={21} />
        {loggingOut ? "Logging out…" : "Log Out"}
      </button>
    </div>
  );
}
