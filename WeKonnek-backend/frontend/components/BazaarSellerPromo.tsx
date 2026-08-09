'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Megaphone, PhilippinePeso, TrendingUp, X, Zap } from 'lucide-react';
import AuthGateModal from '@/components/AuthGateModal';
import { getToken, useAuth } from '@/hooks/use-auth';

type Promo = { id: number; title: string; subtitle: string; ctaHeading: string; ctaText: string };
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const benefits = [
  [Megaphone, 'Reach More Buyers', 'Be discovered by people searching for products near you.'],
  [PhilippinePeso, 'Affordable Listing', 'Only ₱15 for 7 days.'],
  [Zap, 'Post in Minutes', 'Create your listing quickly without needing a website.'],
  [TrendingUp, 'Increase Sales', 'Stay visible instead of getting buried in chat groups.'],
] as const;

export default function BazaarSellerPromo() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [promo, setPromo] = useState<Promo | null>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [learnMore, setLearnMore] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    fetch('/api/bazaar-promos?activeOnly=true', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : [])
      .then((cards: Promo[]) => {
        if (!cards.length) return;
        setPromo(cards[Math.floor(Date.now() / SEVEN_DAYS) % cards.length]);
        requestAnimationFrame(() => setVisible(true));
      })
      .catch(() => {});
  }, []);

  const post = () => {
    if (authLoading) return;
    if (user?.userType === 'customer' && getToken()) router.push('/bazaar/post');
    else setAuthOpen(true);
  };

  if (!promo) return null;
  return <>
    {!expanded && <button type="button" onClick={() => setExpanded(true)} aria-expanded="false" className={`mx-4 my-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-red-100 bg-gradient-to-r from-white to-red-50 px-4 py-3 text-left shadow-sm transition-all duration-300 ${visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600"><Megaphone size={19} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[10px] font-black uppercase tracking-wider text-red-600">Seller Opportunity</span><span className="block truncate text-sm font-black text-slate-950">{promo.title} <span className="font-medium text-slate-500">Post locally from ₱15.</span></span></span>
      <ChevronDown className="shrink-0 text-red-600" size={20} />
    </button>}
    {expanded &&
    <section aria-label="Sell on WEKONNEK Bazaar" className={`relative m-4 overflow-hidden rounded-2xl border border-red-100 bg-gradient-to-br from-white via-white to-red-50 p-5 shadow-[0_12px_35px_rgba(185,28,28,.10)] transition-all duration-300 md:p-7 ${visible ? 'translate-y-0 opacity-100' : 'translate-y-2.5 opacity-0'}`}>
      <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse Bazaar seller opportunity" className="absolute right-3 top-3 z-10 rounded-full p-2 text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><X size={19} /></button>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.8fr)] lg:items-center">
        <div><p className="text-xs font-black uppercase tracking-[.15em] text-red-600">WEKONNEK Seller Opportunity</p><h2 className="mt-2 pr-8 text-2xl font-black text-slate-950">{promo.title}</h2><p className="mt-1 text-slate-600">{promo.subtitle}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">{benefits.map(([Icon, title, description]) => <div key={title} className="rounded-xl border border-red-100/80 bg-white/90 p-3"><Icon className="text-red-600" size={21} /><h3 className="mt-2 text-sm font-black">{title}</h3><p className="mt-1 text-[11px] leading-4 text-slate-500">{description}</p></div>)}</div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-600">{['Safe Community','Easy Chat with Buyers','No Hidden Fees'].map(item => <span key={item} className="flex items-center gap-1"><Check size={15} className="text-emerald-600" />{item}</span>)}</div>
        </div>
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row"><div aria-hidden="true" className="w-36 shrink-0 rounded-[24px] border-[6px] border-slate-900 bg-white p-2 shadow-xl"><div className="aspect-[3/4] rounded-[14px] bg-gradient-to-b from-red-500 to-red-50 p-2"><span className="rounded bg-white px-2 py-1 text-[8px] font-black text-red-600">BAZAAR</span><div className="mt-10 rounded-lg bg-white p-2 shadow"><div className="h-12 rounded bg-amber-100" /><b className="mt-2 block text-[9px]">Local handmade item</b><span className="text-[9px] text-red-600">₱299</span></div></div></div>
          <div className="text-center sm:text-left lg:text-center xl:text-left"><h3 className="text-xl font-black">{promo.ctaHeading}</h3><p className="mt-2 text-sm text-slate-600">{promo.ctaText}</p><button type="button" onClick={post} className="mt-4 min-h-11 rounded-xl bg-red-600 px-6 font-black text-white shadow-lg transition duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2">+ Post an Item</button><button type="button" onClick={() => setLearnMore(true)} className="mt-3 block w-full text-sm font-bold text-red-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Learn How It Works</button></div>
        </div>
      </div>
    </section>}
    {learnMore && <div role="presentation" onMouseDown={event => event.target === event.currentTarget && setLearnMore(false)} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"><section role="dialog" aria-modal="true" aria-labelledby="bazaar-learn-title" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl"><div className="flex justify-between gap-4"><h2 id="bazaar-learn-title" className="text-2xl font-black">Why Sell on WEKONNEK Bazaar?</h2><button onClick={() => setLearnMore(false)} aria-label="Close" className="rounded-full p-2 hover:bg-slate-100"><X /></button></div><ul className="mt-5 space-y-3 text-sm text-slate-700">{['Your listing stays searchable.','Buyers can find products by category.','Nearby buyers can discover your items.','Share your listing to Facebook, Messenger, and Viber.','Receive inquiries directly through WEKONNEK.','Perfect for home businesses, resellers, hobbyists, and community sellers.'].map(item => <li key={item} className="flex gap-2"><Check className="shrink-0 text-emerald-600" size={19} />{item}</li>)}</ul></section></div>}
    <AuthGateModal open={authOpen} onClose={() => setAuthOpen(false)} onAuthenticated={() => { setAuthOpen(false); router.push('/bazaar/post'); }} title="Sign in to post an item" subtitle="Sign in or register, then you’ll continue to your Bazaar listing." />
  </>;
}
