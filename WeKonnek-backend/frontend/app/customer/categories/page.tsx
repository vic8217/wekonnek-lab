'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import {
  ArrowRight, CalendarDays, Grid2X2, PackageSearch, Pill, Search,
  ShoppingBag, Sparkles, Store, Tag, Truck, UtensilsCrossed, Wrench,
} from 'lucide-react';
import type { MerchantCategory } from '@/lib/api';
import { fetchCustomerCategories } from '@/lib/customer-categories';

type CategoryStyle = { icon: ComponentType<{ size?: number; className?: string }>; colors: string };
const styles: CategoryStyle[] = [
  { icon: UtensilsCrossed, colors: 'from-orange-400 to-red-500' },
  { icon: Store, colors: 'from-red-500 to-rose-600' },
  { icon: ShoppingBag, colors: 'from-emerald-400 to-green-600' },
  { icon: Pill, colors: 'from-green-400 to-teal-600' },
  { icon: Wrench, colors: 'from-blue-400 to-indigo-600' },
  { icon: Tag, colors: 'from-violet-500 to-purple-700' },
  { icon: CalendarDays, colors: 'from-pink-400 to-rose-600' },
  { icon: Sparkles, colors: 'from-cyan-400 to-teal-600' },
  { icon: Truck, colors: 'from-amber-400 to-orange-600' },
];

export default function CustomerCategoriesPage() {
  const [categories, setCategories] = useState<MerchantCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchCustomerCategories(controller.signal)
      .then(setCategories)
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const shown = categories.filter(category =>
    !normalizedQuery || category.name.toLowerCase().includes(normalizedQuery)
      || category.description?.toLowerCase().includes(normalizedQuery)
      || category.subCategories?.some(item => item.name.toLowerCase().includes(normalizedQuery)),
  );

  return <main className="min-h-screen bg-[#f7f9fc] pb-12">
    <section className="bg-gradient-to-r from-[#ff0719] to-[#df0012] px-4 py-8 text-white sm:px-8 lg:px-12 lg:py-10">
      <div className="mx-auto max-w-[1380px]">
        <div className="flex items-center gap-3 text-sm font-black uppercase tracking-[.18em] text-red-100"><Grid2X2 size={19}/>Marketplace</div>
        <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Explore all categories</h1><p className="mt-2 max-w-2xl text-sm text-red-50 sm:text-base">Find local merchants, products, and services across every WeKonnek business category.</p></div>
          <label className="relative block w-full lg:max-w-md"><span className="sr-only">Search categories</span><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search categories or services" className="h-12 w-full rounded-xl border-0 bg-white pl-12 pr-4 text-sm font-semibold text-slate-800 shadow-lg outline-none ring-offset-2 focus:ring-4 focus:ring-red-200"/></label>
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-[1380px] px-4 py-7 sm:px-8 lg:px-12 lg:py-10">
      <div className="mb-6 flex items-end justify-between gap-4"><div><h2 className="text-xl font-black text-[#12192b] sm:text-2xl">Business categories</h2><p className="mt-1 text-sm text-slate-500">{loading ? 'Loading categories…' : `${shown.length} ${shown.length === 1 ? 'category' : 'categories'} available`}</p></div><Link href="/customer/dashboard" className="text-sm font-black text-[#ff0719] hover:underline">Back to home</Link></div>

      {loading ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-slate-200"/>)}</div>
      : failed ? <Empty icon={PackageSearch} title="Categories are temporarily unavailable" text="Please refresh the page or try again shortly." />
      : shown.length === 0 ? <Empty icon={Search} title="No matching categories" text="Try another category, product, or service name." />
      : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{shown.map((category, index) => {
        const style = styles[index % styles.length];
        const Icon = style.icon;
        const subCategories = (category.subCategories || []).filter(item => item.isActive !== false);
        const href = category.slug === 'property' ? '/property' : `/customer/explore/${category.slug}`;
        return <Link key={category.id} href={href} className="group flex min-h-56 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-red-200 hover:shadow-[0_16px_35px_rgba(30,41,59,.12)] sm:p-6">
          <div className="flex items-start justify-between gap-4"><span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${style.colors} text-white shadow-lg`} >{category.icon?.trim() ? <span className="text-2xl">{category.icon}</span> : <Icon size={25}/>}</span><ArrowRight className="mt-2 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#ff0719]" size={21}/></div>
          <h3 className="mt-5 text-lg font-black text-[#12192b] transition group-hover:text-[#e60012]">{category.name}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-500">{category.description?.trim() || subCategories.slice(0, 3).map(item => item.name).join(', ') || 'Explore local merchants and listings.'}</p>
          <div className="mt-auto flex items-center justify-between gap-3 pt-5"><span className="text-xs font-black text-[#075cff]">{subCategories.length} {subCategories.length === 1 ? 'subcategory' : 'subcategories'}</span><span className="text-xs font-bold text-slate-400 group-hover:text-[#ff0719]">Explore</span></div>
        </Link>;
      })}</div>}
    </section>
  </main>;
}

function Empty({ icon: Icon, title, text }: { icon: ComponentType<{ size?: number; className?: string }>; title: string; text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><Icon size={42} className="mx-auto text-slate-300"/><h2 className="mt-4 text-lg font-black text-slate-800">{title}</h2><p className="mt-1 text-sm text-slate-500">{text}</p></div>;
}
