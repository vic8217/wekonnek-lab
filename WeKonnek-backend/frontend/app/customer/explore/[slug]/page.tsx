'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Heart, Home, LayoutGrid, Map, MapPin, Mic, Package, Pill, QrCode, Search, ShoppingBag, SlidersHorizontal, Sparkles, Store, Tag, Tickets, Truck, UserRound, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react';

const configs: Record<string, { name: string; icon: string; description: string; specialties: string[]; merchants: string[] }> = {
  food: { name: 'Food', icon: '🍔', description: 'For ordering meals, drinks, and quick food discovery.', specialties: ['All', 'Filipino', 'Fast Food', 'Pizza', 'Asian', 'Desserts', 'Coffee', 'Healthy'], merchants: ['Brew & Beans', 'Kusina ni Juan', 'Burger Barn', 'Green Bites', 'Pizza House', 'Tokyo Bites', 'Sweet Delights', 'Pasta Express'] },
  restaurants: { name: 'Restaurants', icon: '🍽️', description: 'Reserve tables and discover memorable dining experiences.', specialties: ['All', 'Asian', 'Italian', 'Seafood', 'Filipino', 'Fine Dining', 'Casual', 'Cafes'], merchants: ['Sakura Garden', 'Le Petit Bistro', 'Harbor Table', 'Casa Manila', 'Olive Kitchen', 'Seoul House', 'The Grill Room', 'Sunday Cafe'] },
  groceries: { name: 'Groceries', icon: '🛒', description: 'Fresh produce, pantry essentials, and everyday needs.', specialties: ['All', 'Fresh', 'Organic', 'Pantry', 'Frozen', 'Drinks', 'Household', 'Local'], merchants: ['Green Market', 'Daily Fresh', 'City Grocer', 'Local Harvest', 'Pantry Plus', 'Fresh Basket', 'Neighborhood Mart', 'Good Goods'] },
  pharmacy: { name: 'Pharmacy', icon: '💊', description: 'Health essentials and trusted neighborhood pharmacies.', specialties: ['All', 'Medicine', 'Vitamins', 'Personal Care', 'Baby Care', 'Wellness', 'First Aid'], merchants: ['Care Pharmacy', 'Health Plus', 'MediCorner', 'Good Life Drug', 'Family Health', 'Well Pharmacy', 'City Care', 'Health Hub'] },
  services: { name: 'Services', icon: '🔧', description: 'Book reliable professionals for home and personal needs.', specialties: ['All', 'Home Repair', 'Cleaning', 'Beauty', 'Automotive', 'Laundry', 'Professional'], merchants: ['QuickFix Home', 'Clean Crew', 'Handy Local', 'Prime Auto', 'Fresh Laundry', 'Beauty Room', 'Tech Assist', 'City Works'] },
  deals: { name: 'Deals', icon: '🏷️', description: 'Discover the best local promotions, vouchers, and savings.', specialties: ['All', 'Food', 'Shopping', 'Services', 'Wellness', 'Events', 'Limited Time'], merchants: ['Deal Central', 'Save More', 'Local Steals', 'Promo Place', 'Value Hub', 'Daily Deals', 'Bonus Market', 'VIP Offers'] },
  events: { name: 'Events', icon: '📅', description: 'Find local events, activities, workshops, and experiences.', specialties: ['All', 'Today', 'Weekend', 'Music', 'Workshops', 'Family', 'Community'], merchants: ['City Live', 'Local Stage', 'Community Hub', 'Weekend Market', 'Arts Corner', 'Music Hall', 'Family Park', 'Workshop Lab'] },
  wellness: { name: 'Wellness', icon: '✨', description: 'Feel your best with fitness, beauty, spa, and self-care.', specialties: ['All', 'Spa', 'Fitness', 'Beauty', 'Massage', 'Yoga', 'Nutrition'], merchants: ['Wellness Spa', 'Flow Studio', 'Fit Local', 'Glow Room', 'Serene Massage', 'Balance Club', 'Healthy You', 'The Beauty Bar'] },
  express: { name: 'Express', icon: '🚚', description: 'Fast local pickup, courier, and delivery services.', specialties: ['All', 'Same Day', 'Documents', 'Parcels', 'Food', 'Business'], merchants: ['WeKonnek Express', 'Quick Courier', 'City Rider', 'Fast Track', 'Local Dash', 'Go Parcel', 'Direct Drop', 'Swift Send'] },
  vouchers: { name: 'Vouchers', icon: '🎟️', description: 'Use rewards and vouchers at trusted local partners.', specialties: ['All', 'Food', 'Retail', 'Services', 'New', 'Expiring Soon'], merchants: ['Rewards Hub', 'Food Pass', 'Shop Saver', 'Local Rewards', 'Bonus Club', 'Value Pass', 'Treat Card', 'City Perks'] },
  'scan-discover': { name: 'Scan & Discover', icon: '▦', description: 'Scan store codes to open menus, rewards, and experiences.', specialties: ['All', 'Menus', 'Rewards', 'Tables', 'Stores', 'Events'], merchants: ['QR Dining', 'Smart Store', 'Scan & Save', 'Table Menu', 'Reward Spot', 'Quick Access', 'Local Link', 'Discover Hub'] },
  bazaar: { name: 'Bazaar', icon: '🛍️', description: 'Explore unique local products and community sellers.', specialties: ['All', 'Handmade', 'Fashion', 'Home', 'Gifts', 'Local Finds'], merchants: ['Maker Market', 'Local Finds', 'Craft Corner', 'The Bazaar', 'Homegrown', 'Gift Street', 'Artisan Lane', 'Community Shop'] },
};

const categoryIcons: Record<string, { icon: LucideIcon; gradient: string }> = {
  food: { icon: UtensilsCrossed, gradient: 'from-orange-400 to-red-500' },
  restaurants: { icon: Store, gradient: 'from-red-500 to-rose-600' },
  groceries: { icon: ShoppingBag, gradient: 'from-emerald-400 to-green-600' },
  pharmacy: { icon: Pill, gradient: 'from-green-400 to-teal-600' },
  services: { icon: Wrench, gradient: 'from-blue-400 to-indigo-600' },
  deals: { icon: Tag, gradient: 'from-violet-500 to-purple-700' },
  events: { icon: CalendarDays, gradient: 'from-pink-400 to-rose-600' },
  wellness: { icon: Sparkles, gradient: 'from-cyan-400 to-teal-600' },
  express: { icon: Truck, gradient: 'from-amber-400 to-orange-600' },
  vouchers: { icon: Tickets, gradient: 'from-fuchsia-400 to-purple-600' },
  'scan-discover': { icon: QrCode, gradient: 'from-sky-400 to-blue-600' },
  bazaar: { icon: LayoutGrid, gradient: 'from-slate-500 to-slate-700' },
};

const photos = ['/assets/homepage-section-7/image-1.png','/assets/homepage-section-7/image-2.png','/assets/homepage-section-7/image-3.png','/assets/homepage-section-7/image-4.png'];
const sidebarNav = [
  { icon: Home, label: 'Home', href: '/customer/dashboard' },
  { icon: Map, label: 'Explore Map', href: '/customer/map' },
  { icon: Tag, label: 'Vouchers & Deals', href: '/customer/deals' },
  { icon: Package, label: 'My Orders', href: '/customer/orders' },
  { icon: UserRound, label: 'More', href: '/customer/menu' },
];

export default function CategoryMarketplacePage() {
  const slug = String(useParams().slug || 'food');
  const config = configs[slug] || configs.food;
  const categoryStyle = categoryIcons[slug] || categoryIcons.food;
  const CategoryIcon = categoryStyle.icon;
  const [specialty, setSpecialty] = useState('All');
  const [sort, setSort] = useState('Popular');
  const rows = useMemo(() => config.merchants.map((name, index) => ({ name, rating: (4.3 + (index % 6) / 10).toFixed(1), distance: `${(0.5 + index * .25).toFixed(1)} km`, offer: `${10 + (index % 4) * 5}% OFF`, image: photos[index % photos.length] })), [config]);

  return <div className="min-h-screen bg-white text-[#111827] xl:grid xl:grid-cols-[250px_minmax(0,1fr)]">
    <aside className="hidden min-h-screen border-r border-slate-200 bg-white p-5 xl:flex xl:flex-col"><Link href="/customer/dashboard" className="flex items-center gap-3"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={58} height={58} className="size-14 object-contain" /><div><b className="text-blue-700">WE<span className="text-red-600">KONNEK</span></b><p className="text-xs text-slate-500">Customer App</p></div></Link><div className="mt-10 rounded-2xl bg-red-50 p-4"><p className="text-xs font-bold text-red-600">BROWSING NEAR</p><p className="mt-2 font-black">Your City</p><p className="text-xs text-slate-500">Local shops and offers</p></div><nav className="mt-6 space-y-2">{sidebarNav.map(({ icon: Icon, label, href }) => <Link key={label} href={href} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Icon size={19} />{label}</Link>)}</nav><Link href="/customer/scan" className="mt-auto flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 text-sm font-bold text-white"><QrCode size={19} /> Scan QR</Link></aside>

    <main className="min-w-0"><header className="bg-[#ff0719] px-5 py-4 text-white shadow-[0_12px_25px_rgba(255,7,25,.2)] lg:px-8"><div className="flex items-center gap-4"><Link href="/customer/dashboard" className="hidden min-h-11 items-center gap-2 text-sm font-bold xl:flex"><ArrowLeft size={20} /> Back to home</Link><span className={`flex size-11 items-center justify-center rounded-full bg-gradient-to-br ${categoryStyle.gradient} shadow-lg`}><CategoryIcon size={24} strokeWidth={1.9} /></span><div className="min-w-0 flex-1"><h1 className="text-xl font-black">{config.name}</h1><p className="truncate text-xs text-white/90">{config.description}</p></div><Link href={`/customer/map?category=${encodeURIComponent(slug)}`} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-black text-[#ff0719] shadow-lg xl:hidden" aria-label={`View ${config.name} merchants on map`}><Map size={17} /> Map</Link></div><form action="/customer/search" className="relative mt-3"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} /><input name="q" placeholder={`Search ${config.name.toLowerCase()}, merchants, specialties...`} className="h-12 w-full rounded-xl bg-white pl-12 pr-12 text-sm text-slate-700 outline-none" /><Mic className="absolute right-4 top-1/2 -translate-y-1/2 text-red-600" size={19} /></form></header>

      <section className="border-b border-slate-200 bg-white px-4 py-3 lg:px-5"><div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">{config.specialties.map(item => <button key={item} onClick={() => setSpecialty(item)} className={`min-h-10 shrink-0 rounded-xl border px-4 text-sm font-semibold ${specialty === item ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 text-slate-600'}`}>{item}</button>)}</div><div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">{['Popular','Rating','Nearby','Offers','Open now'].map(item => <button key={item} onClick={() => setSort(item)} className={`min-h-9 shrink-0 rounded-full px-4 text-xs font-bold ${sort === item ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{item}</button>)}</div></section>

      <div className="grid min-h-[calc(100vh-190px)] xl:grid-cols-[390px_minmax(0,1fr)]"><section className="border-r border-slate-200"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-2"><div><b className="text-sm">{rows.length} merchants found</b><p className="text-[10px] font-semibold text-red-600">Shop discounts shown on every offer</p></div><SlidersHorizontal size={18} /></div>{rows.map((row) => <Link href={`/customer/explore/${slug}/${encodeURIComponent(row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))}`} key={row.name} className="flex gap-3 border-b border-slate-200 p-3 transition hover:bg-slate-50"><div className="relative size-24 shrink-0 overflow-hidden rounded-xl"><Image src={row.image} alt={row.name} fill sizes="96px" className="object-cover" /><span className="absolute left-1 top-1 rounded-md bg-red-600 px-2 py-1 text-[9px] font-bold text-white">{row.offer}</span></div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><h2 className="truncate text-sm font-black">{row.name}</h2><Heart size={17} className="shrink-0 text-slate-400" /></div><p className="mt-1 text-xs text-slate-500">{specialty === 'All' ? config.specialties[1] : specialty} · Local</p><p className="mt-2 text-xs"><span className="text-amber-500">★</span> {row.rating} · {row.distance}</p><p className="mt-1 text-[11px]"><span className="font-bold text-emerald-600">Open</span> · 8:00 AM – 10:00 PM</p><span className="mt-2 inline-block rounded bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600">{row.offer} on selected items</span></div></Link>)}</section>

        <section className="relative hidden overflow-hidden bg-[#e7f4ec] xl:block"><div className="absolute inset-0 opacity-30 [background-image:linear-gradient(35deg,transparent_45%,#93c5fd_46%,#93c5fd_49%,transparent_50%)] [background-size:140px_90px]" /><button className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-white px-5 py-3 text-xs font-bold shadow-lg">Search this area</button>{rows.slice(0,7).map((row,index) => <div key={row.name} className="absolute z-10 -translate-x-1/2" style={{ left: `${20 + (index * 13) % 70}%`, top: `${22 + (index * 17) % 60}%` }}><span className="mx-auto flex size-9 items-center justify-center rounded-full border-4 border-white bg-[#ff0719] text-sm text-white shadow-lg">{config.icon}</span><span className="mt-1 block whitespace-nowrap rounded-full bg-white px-2 py-1 text-[9px] font-bold shadow">{row.name}</span></div>)}<MapPin className="absolute left-1/2 top-1/2 text-blue-600" size={25} /><div className="absolute inset-x-4 bottom-4 rounded-2xl bg-white p-4 shadow-xl"><b className="text-sm">{config.name} specialties</b><p className="mt-2 text-xs text-slate-500">{config.specialties.slice(1).join('  ·  ')}</p></div><div className="absolute bottom-24 right-5 overflow-hidden rounded-xl bg-white shadow-lg"><button className="block size-11 text-xl font-bold">+</button><button className="block size-11 border-t text-xl font-bold">−</button></div></section>
      </div>
    </main>
  </div>;
}
