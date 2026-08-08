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
  House,
  type LucideIcon,
} from 'lucide-react';

interface Service {
  name: string;
  icon: LucideIcon;
  href: string;
  /** Tailwind classes for the icon tile background + icon color. */
  bg: string;
  color: string;
  details: string;
  stat: string;
  badge?: string;
  /** Rider-dependent services aren't live yet — show a "Soon" badge and disable. */
  comingSoon?: boolean;
}

// Top-level WeKonnek services shown as a quick-access grid on the customer
// home. Every tile is a public route, so guests can browse before signing in.
const SERVICES: Service[] = [
  { name: 'Food', icon: UtensilsCrossed, href: '/customer/explore/food', bg: 'bg-gradient-to-br from-orange-400 to-red-500', color: 'text-white', details: 'Restaurants · Cafes', stat: '324 nearby', badge: 'Trending' },
  { name: 'Mart', icon: ShoppingBasket, href: '/customer/explore/groceries', bg: 'bg-gradient-to-br from-emerald-400 to-green-600', color: 'text-white', details: 'Fresh · Pantry', stat: '86 stores' },
  { name: 'Express', icon: Truck, href: '/customer/explore/express', bg: 'bg-gradient-to-br from-orange-400 to-amber-600', color: 'text-white', details: 'Fast local delivery', stat: '12 riders nearby', badge: 'New' },
  { name: 'Dine Out', icon: CalendarClock, href: '/customer/explore/restaurants', bg: 'bg-gradient-to-br from-blue-400 to-indigo-600', color: 'text-white', details: 'Book · Reserve', stat: '128 available', badge: 'Popular' },
  { name: 'Deals', icon: Gift, href: '/customer/explore/deals', bg: 'bg-gradient-to-br from-violet-500 to-purple-700', color: 'text-white', details: 'Promos · Offers', stat: '35 on promo', badge: 'VIP' },
  { name: 'Vouchers', icon: Ticket, href: '/customer/explore/vouchers', bg: 'bg-gradient-to-br from-pink-400 to-rose-600', color: 'text-white', details: 'Save as you shop', stat: '24 active' },
  { name: 'Scan', icon: QrCode, href: '/customer/explore/scan-discover', bg: 'bg-gradient-to-br from-cyan-400 to-teal-600', color: 'text-white', details: 'Scan store codes', stat: 'Open scanner' },
  { name: 'Bazaar', icon: LayoutGrid, href: '/customer/explore/bazaar', bg: 'bg-gradient-to-br from-slate-500 to-slate-700', color: 'text-white', details: 'Explore local finds', stat: '96 listings' },
  { name: 'Property', icon: House, href: '/property', bg: 'bg-gradient-to-br from-blue-500 to-indigo-700', color: 'text-white', details: 'Homes · Condos · Lots', stat: 'Near you', badge: 'New' },
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
        {SERVICES.map(({ name, icon: Icon, href, bg, color, details, stat, badge, comingSoon }) => {
          const inner = (
            <>
              <div className={`w-14 h-14 ${bg} rounded-full flex items-center justify-center`}>
                <Icon className={`w-7 h-7 ${color}`} strokeWidth={1.9} />
              </div>
              <span className="text-sm font-semibold text-gray-800">{name}</span>
              <span className="text-xs text-slate-500">{details}</span>
              <span className="text-sm font-bold text-blue-700">{stat}</span>
              {badge && <span className="absolute right-3 top-3 rounded-full bg-slate-950 px-2 py-1 text-[9px] font-bold uppercase text-white">{badge}</span>}
              {comingSoon && (
                <span className="absolute top-3 right-3 bg-gray-800 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
                  SOON
                </span>
              )}
            </>
          );
          const base =
            'relative flex min-h-56 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#edf2f7] bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,.07)] transition-all duration-200 ease-out';
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
            <Link key={name} href={href} className={`${base} group hover:-translate-y-1.5 hover:shadow-[0_20px_42px_rgba(15,23,42,.14)] [&>div]:group-hover:scale-110`}>
              {inner}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <section className={`px-4 ${className}`}>
      <div className="grid grid-cols-4 gap-x-2 gap-y-7 py-2">
        {SERVICES.map(({ name, icon: Icon, href, bg, color, badge, comingSoon }) => {
          const inner = (
            <>
              <div
                className={`relative mb-3 flex size-16 items-center justify-center rounded-[22px] ${bg} shadow-[0_10px_20px_rgba(15,23,42,.16)] transition-transform duration-200 group-active:scale-110 sm:size-[72px]`}
              >
                <Icon className={`size-8 ${color} sm:size-9`} strokeWidth={1.8} />
                {comingSoon && (
                  <span className="absolute -top-1.5 -right-1.5 bg-gray-800 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    SOON
                  </span>
                )}
              </div>
              {badge && <span className="absolute left-1/2 top-0 z-10 ml-2 -translate-y-1/3 rounded-full bg-orange-500 px-2 py-0.5 text-[8px] font-black uppercase text-white shadow-sm sm:text-[9px]">{badge}</span>}
              <span className="text-center text-[13px] font-semibold leading-tight text-gray-900 sm:text-[15px]">
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
                className="relative flex min-h-[108px] min-w-0 flex-col items-center justify-start text-center opacity-60"
              >
                {inner}
              </button>
            );
          }
          return (
            <Link key={name} href={href} className="group relative flex min-h-[108px] min-w-0 flex-col items-center justify-start text-center transition-all duration-200 active:scale-[.94]">
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
