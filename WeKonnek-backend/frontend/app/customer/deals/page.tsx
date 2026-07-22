'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Flame, Gift, Star, Ticket, Zap, type LucideIcon } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type DealTab = 'flash' | 'daily' | 'vouchers' | 'loyalty';

interface FlashSale {
  id: string;
  name: string;
  image: string;
  originalPrice: number;
  salePrice: number;
  endsAt: string;
  soldPercent: number;
}

interface DailyDeal {
  id: string;
  title: string;
  description: string;
  discount: string;
  gradient: string;
  merchantName: string;
}

interface LoyaltyData {
  points: number;
  tier: string;
  nextTier: string;
  pointsToNext: number;
  progress: number;
  history: { date: string; description: string; points: number }[];
}

const MOCK_FLASH_SALES: FlashSale[] = [
  { id: '1', name: 'Chickenjoy 2pc + Drink', image: '/images/menu-family-meal.png', originalPrice: 169, salePrice: 99, endsAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), soldPercent: 72 },
  { id: '2', name: 'Large Pepperoni Pizza', image: '/images/menu-house-pasta.png', originalPrice: 499, salePrice: 299, endsAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString(), soldPercent: 45 },
  { id: '3', name: 'Milk Tea Bundle (3 cups)', image: '/images/menu-caramel-macchiato.png', originalPrice: 297, salePrice: 199, endsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), soldPercent: 88 },
  { id: '4', name: 'Sushi Platter (12pc)', image: '/images/menu-club-sandwich.png', originalPrice: 650, salePrice: 399, endsAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(), soldPercent: 31 },
];

const MOCK_DAILY_DEALS: DailyDeal[] = [
  { id: '1', title: '50% Off Breakfast', description: 'All breakfast items until 10 AM', discount: '50%', gradient: 'from-orange-400 to-red-500', merchantName: 'McDonald\'s' },
  { id: '2', title: 'Free Delivery', description: 'On orders above ₱200', discount: 'FREE', gradient: 'from-blue-400 to-indigo-500', merchantName: 'GrabFood Partner' },
  { id: '3', title: 'Buy 1 Get 1', description: 'Selected beverages all day', discount: 'B1G1', gradient: 'from-green-400 to-teal-500', merchantName: 'Starbucks' },
  { id: '4', title: '₱99 Meals', description: 'Budget-friendly combos', discount: '₱99', gradient: 'from-purple-400 to-pink-500', merchantName: 'Jollibee' },
];

const MOCK_LOYALTY: LoyaltyData = {
  points: 1250,
  tier: 'Silver',
  nextTier: 'Gold',
  pointsToNext: 3750,
  progress: 62,
  history: [
    { date: '2026-06-25', description: 'Order #WK-20260625-003', points: 50 },
    { date: '2026-06-24', description: 'Order #WK-20260624-001', points: 120 },
    { date: '2026-06-22', description: 'Referral Bonus', points: 200 },
    { date: '2026-06-20', description: 'Order #WK-20260620-002', points: 75 },
    { date: '2026-06-18', description: 'Welcome Bonus', points: 500 },
  ],
};

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Bronze: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  Silver: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300' },
  Gold: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-400' },
  Platinum: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
};

function FlashCountdown({ target }: { target: string }) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, new Date(target).getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTime(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [target]);
  return <span>{time}</span>;
}

function HeroCountdown() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const tick = () => {
      const diff = Math.max(0, endOfDay.getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTime(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex gap-1.5">
      {time.split(':').map((unit, i) => (
        <div key={i} className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-lg">
          <span className="text-xl font-bold text-white font-mono">{unit}</span>
        </div>
      ))}
    </div>
  );
}

export default function DealsPage() {
  const [activeTab, setActiveTab] = useState<DealTab>('flash');
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [loadingLoyalty, setLoadingLoyalty] = useState(false);

  useEffect(() => {
    if (activeTab === 'loyalty') fetchLoyalty();
  }, [activeTab]);

  const fetchLoyalty = async () => {
    setLoadingLoyalty(true);
    try {
      const token = getToken();
      if (!token) throw new Error('No token');
      const res = await fetch(`${API}/api/loyalty`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const d = data.data || data;
      setLoyalty({
        points: d.points || 0,
        tier: d.tier || 'Bronze',
        nextTier: d.next_tier || d.nextTier || 'Silver',
        pointsToNext: d.points_to_next || d.pointsToNext || 0,
        progress: d.progress || 0,
        history: (d.history || []).map((h: { date?: string; created_at?: string; description: string; points: number }) => ({
          date: h.date || h.created_at || new Date().toISOString(),
          description: h.description,
          points: h.points,
        })),
      });
    } catch {
      setLoyalty(MOCK_LOYALTY);
    } finally {
      setLoadingLoyalty(false);
    }
  };

  const tabs: { id: DealTab; label: string; icon: LucideIcon }[] = [
    { id: 'flash', label: 'Flash Sales', icon: Zap },
    { id: 'daily', label: 'Daily Deals', icon: Flame },
    { id: 'vouchers', label: 'Vouchers', icon: Ticket },
    { id: 'loyalty', label: 'Loyalty', icon: Star },
  ];

  return (
    <div className="box-border w-full px-5 py-5 sm:px-8 lg:px-10 xl:px-6 2xl:px-8">
      {/* Hero Banner */}
      <div className="relative min-h-56 overflow-hidden rounded-[28px] bg-gradient-to-r from-[#ed0712] via-[#d90010] to-[#8f0011] px-7 py-8 shadow-[0_18px_45px_rgba(219,0,2,.22)] lg:px-12 lg:py-10">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-6 -translate-x-6" />
        <div className="relative z-10 flex min-h-40 flex-col justify-center">
          <p className="text-red-200 text-sm font-medium">Limited Time Only</p>
          <h1 className="mt-1 text-3xl font-black text-white lg:text-5xl">Today&apos;s Deals</h1>
          <p className="text-red-100 text-sm mt-1 mb-4">Ends in</p>
          <HeroCountdown />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5 sm:grid-cols-4">
        {tabs.map((tab) => { const Icon = tab.icon; return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex min-h-14 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-white text-[#DB0002] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={18} />
            {tab.label}
          </button>
        )})}
      </div>

      <div className="py-6">
        {/* Flash Sales Tab */}
        {activeTab === 'flash' && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
            {MOCK_FLASH_SALES.map((item) => (
              <div key={item.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl">
                <div className="relative h-32 overflow-hidden bg-slate-100 sm:h-44 xl:h-52">
                  <Image src={item.image} alt={item.name} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover transition duration-300 group-hover:scale-105" />
                  <span className="absolute left-3 top-3 rounded-full bg-[#DB0002] px-3 py-1 text-[10px] font-black text-white">FLASH SALE</span>
                </div>
                <div className="p-4">
                  <p className="line-clamp-2 text-sm font-black leading-tight text-gray-800 sm:text-base">{item.name}</p>
                  <div className="flex items-baseline gap-1.5 mt-2">
                    <span className="text-sm font-bold text-[#DB0002]">₱{item.salePrice}</span>
                    <span className="text-xs text-gray-400 line-through">₱{item.originalPrice}</span>
                  </div>
                  {/* Stock bar */}
                  <div className="mt-2">
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#DB0002] to-orange-400 rounded-full transition-all"
                        style={{ width: `${item.soldPercent}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">{item.soldPercent}% sold</p>
                  </div>
                  <div className="text-[10px] text-orange-500 font-medium mt-1.5">
                    <FlashCountdown target={item.endsAt} />
                  </div>
                  <button className="mt-3 min-h-11 w-full rounded-xl bg-[#DB0002] text-sm font-bold text-white transition-colors hover:bg-red-700">
                    Buy Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Daily Deals Tab */}
        {activeTab === 'daily' && (
          <div className="grid gap-4 lg:grid-cols-2">
            {MOCK_DAILY_DEALS.map((deal) => (
              <div
                key={deal.id}
                className={`relative min-h-52 overflow-hidden rounded-2xl bg-gradient-to-r ${deal.gradient} p-7 text-white shadow-sm`}
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-4 translate-x-4" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/80 text-xs font-medium">{deal.merchantName}</p>
                      <h3 className="text-lg font-bold mt-0.5">{deal.title}</h3>
                      <p className="text-white/90 text-sm mt-1">{deal.description}</p>
                    </div>
                    <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                      <span className="text-lg font-black">{deal.discount}</span>
                    </div>
                  </div>
                  <button className="mt-3 px-4 py-2 bg-white/25 backdrop-blur-sm text-white text-xs font-bold rounded-lg hover:bg-white/35 transition-colors">
                    Claim Deal
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vouchers Tab */}
        {activeTab === 'vouchers' && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-red-50 text-[#DB0002]">
              <Gift size={36} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">My Vouchers</h3>
            <p className="text-sm text-gray-500 mt-1 text-center">View and manage your collected vouchers</p>
            <Link
              href="/customer/vouchers"
              className="mt-5 px-6 py-3 bg-[#DB0002] text-white font-semibold rounded-xl hover:bg-red-700 transition-colors"
            >
              Go to Vouchers
            </Link>
          </div>
        )}

        {/* Loyalty Tab */}
        {activeTab === 'loyalty' && (
          <div className="grid gap-5 xl:grid-cols-2">
            {loadingLoyalty ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : loyalty ? (
              <>
                {/* Points Card */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-12 translate-x-12" />
                  <div className="relative z-10">
                    <p className="text-gray-400 text-sm">Total Points</p>
                    <p className="text-4xl font-bold mt-1">{loyalty.points.toLocaleString()}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          TIER_COLORS[loyalty.tier]?.bg || 'bg-gray-100'
                        } ${TIER_COLORS[loyalty.tier]?.text || 'text-gray-600'}`}
                      >
                        {loyalty.tier} Member
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress to Next Tier */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-600">{loyalty.tier}</span>
                    <span className="text-sm font-medium text-gray-600">{loyalty.nextTier}</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#DB0002] to-orange-400 rounded-full transition-all duration-700"
                      style={{ width: `${loyalty.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    {loyalty.pointsToNext.toLocaleString()} points to {loyalty.nextTier}
                  </p>
                </div>

                {/* Points History */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Points History</h3>
                  <div className="space-y-3">
                    {loyalty.history.map((entry, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{entry.description}</p>
                          <p className="text-xs text-gray-400">{new Date(entry.date).toLocaleDateString()}</p>
                        </div>
                        <span className="text-sm font-bold text-green-500">+{entry.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
