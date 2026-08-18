"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, Package, QrCode, Star, Store, Tag } from "lucide-react";

const navItems = [
  { href: "/customer/dashboard", label: "Home", icon: Home, matches: ["/customer/dashboard"] },
  { href: "/customer/map", label: "Explore Map", icon: Map, matches: ["/customer/map"] },
  { href: "/customer/deals", label: "Deals & Vouchers", icon: Tag, matches: ["/customer/deals", "/customer/vouchers", "/customer/promotions"] },
  { href: "/customer/featured-merchants", label: "Featured Merchants", icon: Store, matches: ["/customer/featured-merchants"] },
  { href: "/customer/reviews", label: "Reviews", icon: Star, matches: ["/customer/reviews"] },
];

const routeMatches = (pathname: string, routes: string[]) => routes.some(route => pathname === route || pathname.startsWith(`${route}/`));

export default function CustomerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-[calc(100vh-65px)] min-h-0 w-[244px] shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <nav className="min-h-0 space-y-2 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon, matches }) => {
          const active = routeMatches(pathname, matches);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-colors ${
                active
                  ? "bg-[#ff0719] text-white shadow-lg shadow-red-200"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon size={19} strokeWidth={1.9} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 space-y-2 pt-5">
        <Link
          href="/customer/scan"
          aria-label="Scan QR code"
          aria-current={routeMatches(pathname, ["/customer/scan"]) ? "page" : undefined}
          className="flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
        >
          <QrCode size={19} />
          Scan QR
        </Link>
        <Link
          href="/customer/orders"
          aria-current={routeMatches(pathname, ["/customer/orders"]) ? "page" : undefined}
          className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-colors ${routeMatches(pathname, ["/customer/orders"]) ? "bg-[#ff0719] text-white shadow-lg shadow-red-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
        >
          <Package size={19} strokeWidth={1.9} />
          My Orders
        </Link>
      </div>
    </aside>
  );
}
