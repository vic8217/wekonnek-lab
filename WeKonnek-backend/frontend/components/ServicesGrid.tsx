'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchCustomerCategories } from '@/lib/customer-categories';
import type { MerchantCategory } from '@/lib/api';
import {
  UtensilsCrossed,
  ShoppingBasket,
  ShoppingBag,
  Pill,
  Wrench,
  Store,
  HeartPulse,
  CalendarDays,
  Building2,
  Sprout,
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
  id?: number;
  name: string;
  icon: LucideIcon;
  adminIcon?: string;
  href: string;
  /** Tailwind classes for the icon tile background + icon color. */
  bg: string;
  color: string;
  details: string;
  stat: string;
  badge?: string;
}

// Application features are intentionally separate from business categories.
// Every tile is a public route, so guests can browse before signing in.
const QUICK_ACCESS: Service[] = [
  { name: 'Express', icon: Truck, href: '/customer/explore/express', bg: 'bg-gradient-to-br from-orange-400 to-amber-600', color: 'text-white', details: 'Fast local delivery', stat: '12 riders nearby', badge: 'New' },
  { name: 'Dine Out', icon: CalendarClock, href: '/customer/explore/restaurants', bg: 'bg-gradient-to-br from-blue-400 to-indigo-600', color: 'text-white', details: 'Book · Reserve', stat: '128 available', badge: 'Popular' },
  { name: 'Deals', icon: Gift, href: '/customer/explore/deals', bg: 'bg-gradient-to-br from-violet-500 to-purple-700', color: 'text-white', details: 'Promos · Offers', stat: '35 on promo', badge: 'VIP' },
  { name: 'Vouchers', icon: Ticket, href: '/customer/explore/vouchers', bg: 'bg-gradient-to-br from-pink-400 to-rose-600', color: 'text-white', details: 'Save as you shop', stat: '24 active' },
  { name: 'Scan', icon: QrCode, href: '/customer/explore/scan-discover', bg: 'bg-gradient-to-br from-cyan-400 to-teal-600', color: 'text-white', details: 'Scan store codes', stat: 'Open scanner' },
  { name: 'Bazaar', icon: LayoutGrid, href: '/customer/explore/bazaar', bg: 'bg-gradient-to-br from-slate-500 to-slate-700', color: 'text-white', details: 'Explore local finds', stat: '96 listings' },
];

const CATEGORY_STYLES = [
  { icon: UtensilsCrossed, bg: 'bg-gradient-to-br from-orange-400 to-red-500' },
  { icon: ShoppingBasket, bg: 'bg-gradient-to-br from-emerald-400 to-green-600' },
  { icon: Wrench, bg: 'bg-gradient-to-br from-blue-400 to-indigo-600' },
  { icon: ShoppingBag, bg: 'bg-gradient-to-br from-violet-500 to-purple-700' },
  { icon: Pill, bg: 'bg-gradient-to-br from-green-400 to-teal-600' },
  { icon: House, bg: 'bg-gradient-to-br from-blue-500 to-indigo-700' },
];

const CATEGORY_VISUALS: Array<{ matches: string[]; icon: LucideIcon; bg: string }> = [
  { matches: ['farm-to-table', 'farm to table'], icon: Sprout, bg: 'bg-gradient-to-br from-emerald-400 to-green-600' },
  { matches: ['food', 'restaurant'], icon: UtensilsCrossed, bg: 'bg-gradient-to-br from-orange-400 to-red-500' },
  { matches: ['grocer'], icon: ShoppingBasket, bg: 'bg-gradient-to-br from-emerald-400 to-green-600' },
  { matches: ['service'], icon: Wrench, bg: 'bg-gradient-to-br from-blue-400 to-indigo-600' },
  { matches: ['pharmacy', 'pharmacies'], icon: Pill, bg: 'bg-gradient-to-br from-violet-500 to-purple-700' },
  { matches: ['shop', 'retail'], icon: Store, bg: 'bg-gradient-to-br from-cyan-400 to-teal-600' },
  { matches: ['wellness', 'health'], icon: HeartPulse, bg: 'bg-gradient-to-br from-blue-500 to-indigo-700' },
  { matches: ['deal', 'promo'], icon: Gift, bg: 'bg-gradient-to-br from-orange-400 to-red-500' },
  { matches: ['event'], icon: CalendarDays, bg: 'bg-gradient-to-br from-emerald-400 to-green-600' },
  { matches: ['bazaar', 'marketplace'], icon: LayoutGrid, bg: 'bg-gradient-to-br from-blue-400 to-indigo-600' },
  { matches: ['property', 'real-estate', 'real estate'], icon: Building2, bg: 'bg-gradient-to-br from-violet-500 to-purple-700' },
];

function categoryVisual(category: MerchantCategory, index: number) {
  const identity = `${category.slug} ${category.name}`.toLowerCase();
  const matched = CATEGORY_VISUALS.find(visual => visual.matches.some(value => identity.includes(value)));
  return matched ? { ...matched, managed: true } : { ...CATEGORY_STYLES[index % CATEGORY_STYLES.length], managed: false };
}

function managedService(category: MerchantCategory, index: number): Service {
  const style = categoryVisual(category, index);
  const subcategories = category.subCategories || [];
  return {
    id: category.id,
    name: category.name,
    icon: style.icon,
    // Known marketplace categories use semantic icons instead of positional
    // or stale admin emoji values. Custom categories may still use admin icons.
    adminIcon: style.managed ? undefined : category.icon?.trim(),
    href: category.slug === 'property' ? '/property' : `/customer/explore/${category.slug}`,
    bg: style.bg,
    color: 'text-white',
    details: category.description?.trim() || subcategories.slice(0, 3).map(item => item.name).join(' · ') || 'Explore local listings',
    stat: `${subcategories.length} ${subcategories.length === 1 ? 'subcategory' : 'subcategories'}`,
  };
}

interface ServicesGridProps {
  className?: string;
  /** `mobile` renders a compact 4-col icon grid; `desktop` renders larger cards. */
  variant?: 'mobile' | 'desktop';
}

export default function ServicesGrid({ className = '', variant = 'mobile' }: ServicesGridProps) {
  const [categories, setCategories] = useState<Service[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesFailed, setCategoriesFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchCustomerCategories(controller.signal)
      .then(data => setCategories(data.map(managedService)))
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setCategoriesFailed(true);
      })
      .finally(() => setCategoriesLoading(false));
    return () => controller.abort();
  }, []);

  if (variant === 'desktop') {
    if (categoriesLoading) {
      return <div className={`grid grid-cols-2 gap-4 md:grid-cols-4 ${className}`}>{[1, 2, 3, 4].map(item => <div key={item} className="min-h-56 animate-pulse rounded-[22px] bg-slate-100" />)}</div>;
    }
    return (
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}>
        {categories.length === 0 && <p className="col-span-full py-8 text-center text-sm text-slate-500">{categoriesFailed ? 'Categories are temporarily unavailable.' : 'No categories are available yet.'}</p>}
        {categories.map(({ id, name, icon: Icon, adminIcon, href, bg, color, details, stat, badge }) => {
          const inner = (
            <>
              <div className={`w-14 h-14 ${bg} rounded-full flex items-center justify-center`}>
                {adminIcon ? <span className="text-2xl" aria-hidden="true">{adminIcon}</span> : <Icon className={`w-7 h-7 ${color}`} strokeWidth={1.9} />}
              </div>
              <span className="text-sm font-semibold text-gray-800">{name}</span>
              <span className="text-xs text-slate-500">{details}</span>
              <span className="text-sm font-bold text-blue-700">{stat}</span>
              {badge && <span className="absolute right-3 top-3 rounded-full bg-slate-950 px-2 py-1 text-[9px] font-bold uppercase text-white">{badge}</span>}
            </>
          );
          const base =
            'relative flex min-h-56 flex-col items-center justify-center gap-3 rounded-[22px] border border-[#edf2f7] bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,.07)] transition-all duration-200 ease-out';
          return (
            <Link key={id || name} href={href} className={`${base} group hover:-translate-y-1.5 hover:shadow-[0_20px_42px_rgba(15,23,42,.14)] [&>div]:group-hover:scale-110`}>
              {inner}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <section className={`px-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Categories</h2>
        <Link href="/customer/categories" className="text-xs font-semibold text-[#DB0002]">Show All &gt;</Link>
      </div>
      <div className="grid grid-cols-4 gap-x-2 gap-y-7 py-2">
        {categoriesLoading
          ? [1, 2, 3, 4].map(item => <div key={item} className="mx-auto h-[108px] w-16 animate-pulse rounded-[22px] bg-slate-100" />)
          : categories.map(({ id, name, icon: Icon, adminIcon, href, bg, color, badge }) => {
          const inner = (
            <>
              <div
                className={`relative mb-3 flex size-16 items-center justify-center rounded-[22px] ${bg} shadow-[0_10px_20px_rgba(15,23,42,.16)] transition-transform duration-200 group-active:scale-110 sm:size-[72px]`}
              >
                {adminIcon ? <span className="text-3xl sm:text-4xl" aria-hidden="true">{adminIcon}</span> : <Icon className={`size-8 ${color} sm:size-9`} strokeWidth={1.8} />}
              </div>
              {badge && <span className="absolute left-1/2 top-0 z-10 ml-2 -translate-y-1/3 rounded-full bg-orange-500 px-2 py-0.5 text-[8px] font-black uppercase text-white shadow-sm sm:text-[9px]">{badge}</span>}
              <span className="text-center text-[13px] font-semibold leading-tight text-gray-900 sm:text-[15px]">
                {name}
              </span>
            </>
          );
          return (
            <Link key={id || name} href={href} className="group relative flex min-h-[108px] min-w-0 flex-col items-center justify-start text-center transition-all duration-200 active:scale-[.94]">
              {inner}
            </Link>
          );
        })}
      </div>
      {!categoriesLoading && categories.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-500">{categoriesFailed ? 'Categories are temporarily unavailable.' : 'No categories are available yet.'}</p>
      )}

      <h2 className="mb-3 mt-3 text-base font-bold text-gray-900">Quick Access</h2>
      <div className="grid grid-cols-4 gap-x-2 gap-y-7 py-2">
        {QUICK_ACCESS.map(({ name, icon: Icon, href, bg, color, badge }) => (
          <Link key={name} href={href} className="group relative flex min-h-[108px] min-w-0 flex-col items-center justify-start text-center transition-all duration-200 active:scale-[.94]">
            <div className={`relative mb-3 flex size-16 items-center justify-center rounded-[22px] ${bg} shadow-[0_10px_20px_rgba(15,23,42,.16)] transition-transform duration-200 group-active:scale-110 sm:size-[72px]`}>
              <Icon className={`size-8 ${color} sm:size-9`} strokeWidth={1.8} />
            </div>
            {badge && <span className="absolute left-1/2 top-0 z-10 ml-2 -translate-y-1/3 rounded-full bg-orange-500 px-2 py-0.5 text-[8px] font-black uppercase text-white shadow-sm sm:text-[9px]">{badge}</span>}
            <span className="text-center text-[13px] font-semibold leading-tight text-gray-900 sm:text-[15px]">{name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
