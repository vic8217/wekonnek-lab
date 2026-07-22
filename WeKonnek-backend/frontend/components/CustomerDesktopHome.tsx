'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell, CalendarDays, ChevronDown, Heart, Home, LayoutGrid, MapPin, Mic, Package, Pill, QrCode, Search, ShoppingBag, SlidersHorizontal, Sparkles, Store, Tag, Tickets, Truck, UserRound, UtensilsCrossed, Wrench, X } from 'lucide-react';
import { useUserLocation } from '@/hooks/use-geolocation';

const categories = [
  { icon: UtensilsCrossed, name: 'Food', details: 'Restaurants · Cafes', stat: '324 nearby', href: '/customer/explore/food', gradient: 'from-orange-400 to-red-500', badge: 'Trending' },
  { icon: Store, name: 'Restaurants', details: 'Asian · Italian · Seafood', stat: '128 available', href: '/customer/explore/restaurants', gradient: 'from-red-500 to-rose-600', badge: 'Popular' },
  { icon: ShoppingBag, name: 'Groceries', details: 'Fresh · Pantry · Local', stat: '86 stores', href: '/customer/explore/groceries', gradient: 'from-emerald-400 to-green-600' },
  { icon: Pill, name: 'Pharmacy', details: 'Medicine · Wellness', stat: '42 open now', href: '/customer/explore/pharmacy', gradient: 'from-green-400 to-teal-600' },
  { icon: Wrench, name: 'Services', details: 'Home · Repair · Care', stat: '211 providers', href: '/customer/explore/services', gradient: 'from-blue-400 to-indigo-600', badge: 'New' },
  { icon: Tag, name: 'Deals', details: 'Vouchers · Promos', stat: '35 on promo', href: '/customer/explore/deals', gradient: 'from-violet-500 to-purple-700', badge: 'VIP' },
  { icon: CalendarDays, name: 'Events', details: 'Local · Tickets · Live', stat: '18 this week', href: '/customer/explore/events', gradient: 'from-pink-400 to-rose-600' },
  { icon: Sparkles, name: 'Wellness', details: 'Spa · Fitness · Beauty', stat: '74 nearby', href: '/customer/explore/wellness', gradient: 'from-cyan-400 to-teal-600' },
  { icon: Truck, name: 'Express', details: 'Pickup · Delivery · Courier', stat: 'Fast delivery', href: '/customer/explore/express', gradient: 'from-amber-400 to-orange-600' },
  { icon: Tickets, name: 'Vouchers', details: 'Rewards · Savings · Passes', stat: '24 active', href: '/customer/explore/vouchers', gradient: 'from-fuchsia-400 to-purple-600' },
  { icon: QrCode, name: 'Scan & Discover', details: 'Stores · Menus · Rewards', stat: 'Open scanner', href: '/customer/explore/scan-discover', gradient: 'from-sky-400 to-blue-600' },
  { icon: LayoutGrid, name: 'Bazaar', details: 'Local · Handmade · Finds', stat: '96 listings', href: '/customer/explore/bazaar', gradient: 'from-slate-500 to-slate-700' },
];

const partners = [
  { name: 'Green Market', kind: 'FRESH PRODUCE', meta: 'organic  •  0.5 km', rating: '4.6', image: '/images/partner-green-market.png' },
  { name: 'Wellness Spa', kind: 'RELAXATION', meta: 'spa  •  2.1 km', rating: '4.7', image: '/images/partner-wellness-spa.png' },
  { name: 'Sakura Garden', kind: 'DINING', meta: 'japanese  •  0.8 km', rating: '4.8', image: '/images/partner-sakura-garden.png' },
  { name: 'Le Petit Bistro', kind: 'BISTRO', meta: 'french  •  1.2 km', rating: '4.9', image: '/images/partner-le-petit-bistro.png' },
  { name: 'Daily Fresh', kind: 'GROCERY', meta: 'market  •  1.4 km', rating: '4.7', image: '/images/merchantPickupOrder.png' },
  { name: 'Corner Cafe', kind: 'CAFE', meta: 'coffee  •  0.9 km', rating: '4.8', image: '/images/merchantReservedImage.png' },
  { name: 'Home Essentials', kind: 'RETAIL', meta: 'home  •  2.5 km', rating: '4.5', image: '/images/merchantTakeOutOrder.png' },
  { name: 'City Services', kind: 'SERVICES', meta: 'local  •  1.8 km', rating: '4.6', image: '/images/weKonnekPickupOrders.png' },
];

const nav = [
  [Home, 'Home', '/customer/dashboard'], [MapPin, 'Explore Map', '/customer/map'],
  [Tag, 'Vouchers & Deals', '/customer/deals'], [Package, 'My Orders', '/customer/orders'],
  [ShoppingBag, 'Bazaar', '/customer/categories'], [UserRound, 'More', '/customer/menu'],
] as const;

export default function CustomerDesktopHome() {
  const { coords, status } = useUserLocation();
  const [deliveryLocation, setDeliveryLocation] = useState('Your City');
  const [showCategories, setShowCategories] = useState(false);
  const [showPartners, setShowPartners] = useState(false);

  useEffect(() => {
    if (!coords) return;

    const controller = new AbortController();
    fetch(`/api/routing/reverse?lat=${coords.lat}&lng=${coords.lng}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        const address = data?.address;
        setDeliveryLocation(address?.city || address?.municipality || address?.province || 'Your City');
      })
      .catch(() => {});

    return () => controller.abort();
  }, [coords]);

  useEffect(() => {
    if (!showCategories && !showPartners) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCategories(false);
        setShowPartners(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showCategories, showPartners]);

  return (
    <div className="hidden min-h-screen bg-white text-[#12192b] xl:grid xl:grid-cols-[254px_minmax(0,1fr)]">
      <aside className="flex min-h-screen flex-col border-r border-slate-200 bg-white px-5 py-7">
        <Link href="/customer/dashboard" className="flex items-center gap-3 px-1">
          <Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={72} height={72} className="size-16 object-contain" />
          <div><strong className="block text-base text-[#151cff]">WE<span className="text-red-600">KONNEK</span></strong><span className="block text-xs text-slate-500">Customer App</span></div>
        </Link>
        <nav className="mt-10 space-y-2">
          {nav.map(([Icon, label, href], index) => <Link key={label} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${index === 0 ? 'bg-[#ff0719] text-white shadow-lg shadow-red-200' : 'text-slate-600 hover:bg-slate-50'}`}><Icon size={19} />{label}</Link>)}
        </nav>
        <Link href="/customer/scan" className="mt-auto flex items-center justify-center gap-3 rounded-xl bg-[#ff0719] px-4 py-3 text-sm font-bold text-white"><QrCode size={19} /> Scan QR Code</Link>
        <Link href="/customer/profile" className="mt-4 flex items-center gap-3 px-3 text-sm font-semibold text-slate-600"><UserRound size={19} /> Account</Link>
      </aside>

      <main className="min-w-0">
        <header className="rounded-b-[22px] bg-[#ff0719] px-12 pb-10 pt-7 text-white shadow-[0_18px_35px_rgba(255,7,25,.18)]">
          <div className="flex items-center justify-between">
            <Link href="/customer/map" className="flex min-h-12 items-center gap-3 text-xl font-black"><MapPin size={27} /><span>{status === 'locating' ? 'Locating…' : deliveryLocation}</span><ChevronDown size={17} /></Link>
            <div className="flex items-center gap-4"><button className="relative p-2"><Bell size={26} /><span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-red-400 text-xs font-bold">3</span></button><Link href="/auth/login?redirect=/customer/dashboard" className="flex size-14 items-center justify-center rounded-xl bg-red-500"><UserRound size={28} /></Link></div>
          </div>
          <form action="/customer/search" className="relative mt-5"><Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" size={27} /><input name="q" placeholder="Search merchants, categories, and services" className="h-[78px] w-full rounded-[22px] bg-white pl-20 pr-48 text-lg font-medium text-slate-700 outline-none ring-0 transition focus:shadow-xl" /><div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1"><button type="button" aria-label="Voice search" className="flex size-11 items-center justify-center rounded-full text-red-600 hover:bg-red-50"><Mic size={22} /></button><Link href="/customer/map" aria-label="Search near me" className="flex size-11 items-center justify-center rounded-full text-blue-700 hover:bg-blue-50"><MapPin size={22} /></Link><button type="button" aria-label="Search filters" className="flex size-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"><SlidersHorizontal size={21} /></button></div></form>
        </header>

        <div className="px-12 py-11">
          <div className="mb-4 flex justify-end"><button type="button" onClick={() => setShowCategories(true)} className="min-h-12 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-bold text-red-600 transition hover:border-red-200 hover:bg-red-50">Show all categories</button></div>
          <section className="grid grid-cols-4 gap-5 2xl:grid-cols-8">
            {categories.slice(0, 8).map(({ icon: Icon, name, details, stat, href, gradient, badge }) => <Link key={name} href={href} className="group relative min-h-[218px] overflow-hidden rounded-[22px] border border-[#edf2f7] bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,.07)] transition-all duration-200 ease-out hover:-translate-y-1.5 hover:shadow-[0_20px_42px_rgba(15,23,42,.14)] active:scale-[.98]"><span className={`flex size-14 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white shadow-lg transition duration-200 group-hover:scale-110 group-hover:brightness-110`}><Icon size={28} strokeWidth={1.8} /></span>{badge && <span className="absolute right-3 top-3 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">{badge}</span>}<h3 className="mt-5 text-[17px] font-black">{name}</h3><p className="mt-1 min-h-9 text-xs leading-4 text-slate-500">{details}</p><p className="mt-4 text-sm font-bold text-blue-700">{stat}</p></Link>)}
          </section>

          <section className="mt-12"><div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-black">Featured Partners</h2><button type="button" onClick={() => setShowPartners(true)} className="min-h-12 px-2 font-bold text-red-600">See All ›</button></div><div className="grid grid-cols-4 gap-3">
            {partners.slice(0, 4).map((partner) => <Link href="/merchants" key={partner.name} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_25px_rgba(15,23,42,.08)] transition duration-200 hover:-translate-y-1 hover:shadow-xl"><div className="relative h-36 overflow-hidden p-3 text-white"><Image src={partner.image} alt={partner.name} fill sizes="25vw" className="object-cover transition duration-300 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" /><span className="relative rounded-xl bg-[#ff0719] px-3 py-2 text-xs font-bold">Featured</span><Heart className="absolute right-3 top-3 rounded-full bg-white p-2 text-red-600" size={42} /><p className="absolute bottom-12 text-xs font-bold">{partner.kind}</p><span className="absolute bottom-3 rounded-xl bg-[#ff0719] px-3 py-2 text-xs font-bold">15% OFF</span></div><div className="p-4"><h3 className="text-lg font-black">{partner.name}</h3><p className="mt-4 text-xs text-slate-500"><span className="text-amber-500">★</span> {partner.rating} &nbsp;•&nbsp; {partner.meta}</p></div></Link>)}
          </div></section>

          <section className="mt-12"><div className="mb-5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-2xl font-black"><Tag className="text-red-600" /> Exclusive Deals</h2><Link href="/customer/deals" className="font-bold text-red-600">See All ›</Link></div><div className="grid max-w-3xl grid-cols-2 gap-4">{[['₱50 OFF','drinksDiscount'],['5% OFF','5%onMain']].map(([discount, code]) => <Link href="/customer/deals" key={discount} className="rounded-2xl bg-[#ff0719] p-6 text-center text-white"><p className="flex items-center gap-2 text-left text-xs font-bold"><Tickets size={16} /> VOUCHER</p><h3 className="mt-5 text-3xl font-black">{discount}</h3><p className="mt-2">{code}</p></Link>)}</div></section>
        </div>
      </main>

      {showCategories && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCategories(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="all-categories-title" className="max-h-[88vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-[#fafbfc] p-7 shadow-2xl sm:p-9"><div className="flex items-start justify-between gap-5"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-blue-700">Explore WeKonnek</p><h2 id="all-categories-title" className="mt-1 text-3xl font-black">All categories</h2><p className="mt-2 text-sm text-slate-500">Discover nearby merchants, services, offers, and local experiences.</p></div><button type="button" onClick={() => setShowCategories(false)} aria-label="Close all categories" className="flex size-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"><X size={22} /></button></div><div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{categories.map(({ icon: Icon, name, details, stat, href, gradient, badge }) => <Link key={name} href={href} onClick={() => setShowCategories(false)} className="group relative min-h-[205px] rounded-[22px] border border-[#edf2f7] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,.07)] transition-all duration-200 ease-out hover:-translate-y-1.5 hover:shadow-[0_18px_38px_rgba(15,23,42,.14)]"><span className={`flex size-14 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white shadow-lg transition duration-200 group-hover:scale-110 group-hover:brightness-110`}><Icon size={27} strokeWidth={1.8} /></span>{badge && <span className="absolute right-4 top-4 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-bold uppercase text-white">{badge}</span>}<h3 className="mt-5 text-[17px] font-black">{name}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{details}</p><p className="mt-4 text-sm font-bold text-blue-700">{stat}</p></Link>)}</div></section></div>}
      {showPartners && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPartners(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="all-partners-title" className="max-h-[88vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-[#fafbfc] p-7 shadow-2xl sm:p-9"><div className="flex items-start justify-between gap-5"><div><p className="text-sm font-bold uppercase tracking-[.16em] text-red-600">Trusted local businesses</p><h2 id="all-partners-title" className="mt-1 text-3xl font-black">All featured partners</h2><p className="mt-2 text-sm text-slate-500">Explore standout merchants selected for quality, service, and community trust.</p></div><button type="button" onClick={() => setShowPartners(false)} aria-label="Close featured partners" className="flex size-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"><X size={22} /></button></div><div className="mt-8 grid grid-cols-2 gap-5 lg:grid-cols-4">{partners.map((partner) => <Link href="/merchants" key={partner.name} onClick={() => setShowPartners(false)} className="group overflow-hidden rounded-[22px] border border-[#edf2f7] bg-white shadow-[0_8px_24px_rgba(15,23,42,.07)] transition-all duration-200 hover:-translate-y-1.5 hover:shadow-xl"><div className="relative h-44 overflow-hidden"><Image src={partner.image} alt={partner.name} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover transition duration-300 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" /><span className="absolute left-3 top-3 rounded-full bg-[#ff0719] px-3 py-1.5 text-xs font-bold text-white">Featured</span><Heart className="absolute right-3 top-3 rounded-full bg-white p-2 text-red-600" size={42} /><p className="absolute bottom-4 left-4 text-xs font-bold text-white">{partner.kind}</p></div><div className="p-5"><h3 className="text-lg font-black">{partner.name}</h3><p className="mt-3 text-sm text-slate-500"><span className="text-amber-500">★</span> {partner.rating} &nbsp;•&nbsp; {partner.meta}</p><span className="mt-4 inline-flex rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600">15% OFF</span></div></Link>)}</div></section></div>}
    </div>
  );
}
