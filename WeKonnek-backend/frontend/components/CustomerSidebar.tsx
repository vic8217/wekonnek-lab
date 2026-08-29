"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, SVGProps } from "react";

type NavIcon = "home" | "map" | "tag" | "store" | "star" | "qr" | "package" | "clipboard";
function SidebarIcon({ icon, ...props }: SVGProps<SVGSVGElement> & { icon: NavIcon }) {
  const paths: Record<NavIcon, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" /></>,
    map: <><path d="m9 18-5-2.5V4l5 2.5L15 4l5 2.5V18l-5-2.5Z" /><path d="M9 6.5V18m6-14v11.5" /></>,
    tag: <><path d="M20 13 13 20 4 11V4h7Z" /><circle cx="8.5" cy="8.5" r="1" /></>,
    store: <><path d="M3 9h18v11H3Z" /><path d="m4 9 1.5-5h13L20 9M8 20v-6h4v6m4-6h3" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
    qr: <><path d="M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Z" /><path d="M14 14h3v3h-3Zm3 3h3v3h-3Zm0-3h3v-3" /></>,
    package: <><path d="m3 7 9-4 9 4v10l-9 4-9-4Z" /><path d="m3 7 9 4 9-4m-9 4v10" /></>,
    clipboard: <><path d="M8 5h8M9 3h6v4H9Z" /><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" /><path d="M9 12h6M9 16h4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[icon]}</svg>;
}

const navItems = [
  { href: "/customer/dashboard", label: "Home", icon: "home" as const, matches: ["/customer/dashboard"] },
  { href: "/customer/map", label: "Explore Map", icon: "map" as const, matches: ["/customer/map"] },
  { href: "/customer/deals", label: "Deals & Vouchers", icon: "tag" as const, matches: ["/customer/deals", "/customer/vouchers", "/customer/promotions"] },
  { href: "/customer/featured-merchants", label: "Featured Merchants", icon: "store" as const, matches: ["/customer/featured-merchants"] },
  { href: "/customer/reviews", label: "Reviews", icon: "star" as const, matches: ["/customer/reviews"] },
];

const routeMatches = (pathname: string, routes: string[]) => routes.some(route => pathname === route || pathname.startsWith(`${route}/`));

export default function CustomerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-[calc(100vh-65px)] min-h-0 w-[244px] shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <nav className="min-h-0 space-y-2 overflow-y-auto">
        {navItems.map(({ href, label, icon, matches }) => {
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
              <SidebarIcon icon={icon} width={19} height={19} />
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
          <SidebarIcon icon="qr" width={19} height={19} />
          Scan QR
        </Link>
        <Link
          href="/customer/orders"
          aria-current={routeMatches(pathname, ["/customer/orders"]) ? "page" : undefined}
          className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-colors ${routeMatches(pathname, ["/customer/orders"]) ? "bg-[#ff0719] text-white shadow-lg shadow-red-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
        >
          <SidebarIcon icon="package" width={19} height={19} />
          My Orders
        </Link>
        <Link
          href="/customer/rfq"
          aria-current={routeMatches(pathname, ["/customer/rfq"]) ? "page" : undefined}
          className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold transition-colors ${routeMatches(pathname, ["/customer/rfq"]) ? "bg-[#ff0719] text-white shadow-lg shadow-red-200" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
        >
          <SidebarIcon icon="clipboard" width={19} height={19} />
          My RFQs
        </Link>
      </div>
    </aside>
  );
}
