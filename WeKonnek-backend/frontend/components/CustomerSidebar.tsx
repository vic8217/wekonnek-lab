"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, Package, QrCode, Tag, UserRound } from "lucide-react";

const navItems = [
  { href: "/customer/dashboard", label: "Home", icon: Home },
  { href: "/customer/map", label: "Explore Map", icon: Map },
  { href: "/customer/deals", label: "Vouchers & Deals", icon: Tag },
  { href: "/customer/orders", label: "My Orders", icon: Package },
  { href: "/customer/profile", label: "Profile", icon: UserRound },
];

export default function CustomerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-[calc(100vh-109px)] w-[244px] shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <nav className="space-y-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
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

      <Link
        href="/customer/scan"
        className="mt-auto flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800"
      >
        <QrCode size={19} />
        Scan QR
      </Link>
      <Link
        href="/customer/profile"
        className="mt-4 flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        <UserRound size={19} />
        My Account
      </Link>
    </aside>
  );
}
