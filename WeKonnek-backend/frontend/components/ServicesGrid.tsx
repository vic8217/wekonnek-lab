'use client';

import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  UtensilsCrossed,
  ShoppingBasket,
  Truck,
  CalendarClock,
  Gift,
  QrCode,
  Ticket,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';

interface Service {
  name: string;
  icon: LucideIcon;
  href: string;
  /** Tailwind classes for the icon tile background + icon color. */
  bg: string;
  color: string;
  /** Rider-dependent services aren't live yet — show a "Soon" badge and disable. */
  comingSoon?: boolean;
}

// Top-level WeKonnek services shown as a quick-access grid on the customer
// home. Every tile is a public route, so guests can browse before signing in.
const SERVICES: Service[] = [
  { name: 'Food', icon: UtensilsCrossed, href: '/customer/food', bg: 'bg-red-50', color: 'text-[#DB0002]' },
  { name: 'Mart', icon: ShoppingBasket, href: '/customer/mart', bg: 'bg-green-50', color: 'text-green-600' },
  { name: 'Express', icon: Truck, href: '/customer/express', bg: 'bg-orange-50', color: 'text-orange-500', comingSoon: true },
  { name: 'Dine Out', icon: CalendarClock, href: '/customer/reserve', bg: 'bg-blue-50', color: 'text-blue-600' },
  { name: 'Deals', icon: Gift, href: '/customer/deals', bg: 'bg-purple-50', color: 'text-purple-600' },
  { name: 'Vouchers', icon: Ticket, href: '/customer/vouchers', bg: 'bg-amber-50', color: 'text-amber-500' },
  { name: 'Scan', icon: QrCode, href: '/customer/scan', bg: 'bg-teal-50', color: 'text-teal-600' },
  { name: 'All', icon: LayoutGrid, href: '/customer/categories', bg: 'bg-gray-100', color: 'text-gray-600' },
];

const notifyComingSoon = (name: string) => toast(`${name} is coming soon!`, { icon: '🚧' });

interface ServicesGridProps {
  className?: string;
  /** `mobile` renders a compact 4-col icon grid; `desktop` renders larger cards. */
  variant?: 'mobile' | 'desktop';
}

export default function ServicesGrid({ className = '', variant = 'mobile' }: ServicesGridProps) {
  if (variant === 'desktop') {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}>
        {SERVICES.map(({ name, icon: Icon, href, bg, color, comingSoon }) => {
          const inner = (
            <>
              <div className={`w-14 h-14 ${bg} rounded-full flex items-center justify-center`}>
                <Icon className={`w-7 h-7 ${color}`} strokeWidth={1.9} />
              </div>
              <span className="text-sm font-semibold text-gray-800">{name}</span>
              {comingSoon && (
                <span className="absolute top-3 right-3 bg-gray-800 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                  SOON
                </span>
              )}
            </>
          );
          const base =
            'relative flex flex-col items-center justify-center gap-3 bg-white rounded-xl border border-gray-200 p-6 shadow-sm transition-all';
          if (comingSoon) {
            return (
              <button
                key={name}
                type="button"
                onClick={() => notifyComingSoon(name)}
                className={`${base} opacity-60 cursor-not-allowed`}
              >
                {inner}
              </button>
            );
          }
          return (
            <Link key={name} href={href} className={`${base} hover:shadow-md hover:-translate-y-0.5`}>
              {inner}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <section className={`px-4 ${className}`}>
      <div className="grid grid-cols-4 gap-y-4 gap-x-2">
        {SERVICES.map(({ name, icon: Icon, href, bg, color, comingSoon }) => {
          const inner = (
            <>
              <div
                className={`relative w-14 h-14 ${bg} rounded-2xl flex items-center justify-center mb-1.5 shadow-sm border border-gray-100 transition-transform group-active:scale-95`}
              >
                <Icon className={`w-7 h-7 ${color}`} strokeWidth={1.9} />
                {comingSoon && (
                  <span className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    SOON
                  </span>
                )}
              </div>
              <span className="text-[11px] text-gray-700 font-semibold text-center leading-tight">
                {name}
              </span>
            </>
          );
          if (comingSoon) {
            return (
              <button
                key={name}
                type="button"
                onClick={() => notifyComingSoon(name)}
                className="flex flex-col items-center group opacity-60"
              >
                {inner}
              </button>
            );
          }
          return (
            <Link key={name} href={href} className="flex flex-col items-center group">
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
