'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletCards, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface MerchantData {
  id: number;
  name: string;
  subscription_tier: string;
  subscription_plan: string;
  subscription_amount: number;
  subscription_status?: string;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  auto_renew?: boolean;
  status: string;
  is_active: boolean;
  wallet_balance?: number;
  plan_fee?: number;
  add_on_fee?: number;
  daily_subscription_fee?: number;
  funded_days?: number;
  active_through?: string | null;
  rating?: number;
  followers?: number;
  response_rate?: number;
  total_sales?: number;
}

interface MerchantOrder {
  status?: string;
  order_type?: string;
  delivery_address?: string | null;
  table_number?: string | null;
  created_at?: string;
  createdAt?: string;
}

interface OrderCounts {
  delivery: number;
  pickup: number;
  inStore: number;
  completed: number;
}

interface BillingRecord {
  id: number;
  tier: string;
  plan: string;
  amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  period_end?: string | null;
}

interface SubscriptionCoverage {
  wallet_balance: number;
  plan_fee: number;
  add_on_fee: number;
  daily_subscription_fee: number;
  funded_days: number;
  active_through: string | null;
  account_active?: boolean;
}

interface ReloadPayment {
  paymentId: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  paymentUrl?: string | null;
  qrData?: string | null;
  expiresAt?: string | Date | null;
}

interface ActiveShop {
  id: number;
  name: string;
  branch_name?: string;
  shop_id: string;
  merchant_name?: string;
  is_default?: boolean;
  is_active?: boolean;
  isActive?: boolean;
}

interface InventoryAlertSummary {
  totals: { shopsNeedingRestock: number; lowStockItems: number; outOfStockItems: number };
  shops: Array<{ id: number; name: string; lowStockCount: number; outOfStockCount: number }>;
}

const PLAN_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annual: 365 };

const TIER_FEATURES: Record<string, string[]> = {
  basic: ['10 Product listings', 'Standard support', 'Basic analytics', 'Standard placement'],
  gold: [
    '20 Product listings',
    'Priority email support',
    'Promotional badges',
    'Advanced analytics',
    'Featured placement 2x/week',
    'Customer insights',
  ],
  platinum: [
    'Unlimited Product listings',
    '24/7 priority support',
    'Promotional badges',
    'Premium analytics',
    'Daily featured placement',
    'Customer insights',
    'Dedicated account manager',
  ],
};

export default function MerchantDashboardPage() {
  const pathname = usePathname();
  const isShopPortal = pathname.startsWith('/shop');
  const portalBase = isShopPortal ? '/shop' : '/merchant';
  const { user } = useAuth();
  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'features' | 'billing'>('features');
  const [billing, setBilling] = useState<BillingRecord[]>([]);
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [coverage, setCoverage] = useState<SubscriptionCoverage | null>(null);
  const [showWalletReload, setShowWalletReload] = useState(false);
  const [reloadAmount, setReloadAmount] = useState('');
  const [reloadError, setReloadError] = useState('');
  const [reloading, setReloading] = useState(false);
  const [reloadPayment, setReloadPayment] = useState<ReloadPayment | null>(null);
  const [reloadChecking, setReloadChecking] = useState(false);
  const [listingCount, setListingCount] = useState(0);
  const [monthlyOrderCount, setMonthlyOrderCount] = useState(0);
  const [totalOrderCount, setTotalOrderCount] = useState(0);
  const [activeShop, setActiveShop] = useState<ActiveShop | null>(null);
  const [merchantShops, setMerchantShops] = useState<ActiveShop[]>([]);
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlertSummary | null>(null);
  const [orderCounts, setOrderCounts] = useState<OrderCounts>({
    delivery: 0,
    pickup: 0,
    inStore: 0,
    completed: 0,
  });

  useEffect(() => {
    if (!isShopPortal) return;
    try {
      const stored = sessionStorage.getItem('wk_active_shop');
      setActiveShop(stored ? JSON.parse(stored) : null);
    } catch {
      setActiveShop(null);
    }
  }, [isShopPortal]);

  useEffect(() => {
    const fetchMerchantData = async () => {
      try {
        const token = getToken();
        if (!token) return;

        const headers = { Authorization: `Bearer ${token}` };
        const [res, coverageRes] = await Promise.all([
          fetch(`${API}/api/merchants/me`, { headers, cache: 'no-store' }),
          fetch(`${API}/api/merchants/me/subscription-coverage`, { headers, cache: 'no-store' }),
        ]);
        if (!res.ok) return;
        const merchantData = await res.json();
        setMerchant(merchantData);
        const [ordersRes, productsRes, shopsRes, inventoryRes] = await Promise.all([
          fetch(`${API}/api/orders?merchantId=${merchantData.id}`, { headers }),
          fetch(`${API}/api/products?merchantId=${merchantData.id}`, { headers }),
          fetch(`${API}/api/merchants/${merchantData.id}/branches`, { headers }),
          isShopPortal ? Promise.resolve(null) : fetch(`${API}/api/inventory/summary`, { headers }),
        ]);
        if (inventoryRes?.ok) setInventoryAlerts(await inventoryRes.json());
        if (shopsRes.ok) {
          const shopsData = await shopsRes.json();
          setMerchantShops(Array.isArray(shopsData) ? shopsData : shopsData?.data || []);
        }
        if (productsRes.ok) {
          const productsData = await productsRes.json();
          const products = Array.isArray(productsData) ? productsData : productsData?.data || [];
          setListingCount(products.length);
        }
        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          const orders: MerchantOrder[] = Array.isArray(ordersData)
            ? ordersData
            : Array.isArray(ordersData?.data)
              ? ordersData.data
              : [];
          setTotalOrderCount(orders.length);
          const orderType = (order: MerchantOrder) =>
            order.order_type ||
            (order.delivery_address ? 'delivery' : order.table_number ? 'in_store' : 'pickup');
          setOrderCounts({
            delivery: orders.filter((order) => orderType(order) === 'delivery').length,
            pickup: orders.filter((order) => orderType(order) === 'pickup').length,
            inStore: orders.filter((order) => ['in_store', 'dine_in'].includes(orderType(order))).length,
            completed: orders.filter((order) => order.status?.toLowerCase() === 'completed').length,
          });
          const monthStart = new Date();
          monthStart.setDate(1);
          monthStart.setHours(0, 0, 0, 0);
          setMonthlyOrderCount(orders.filter((order) => {
            const createdAt = order.created_at || order.createdAt;
            return createdAt ? new Date(createdAt) >= monthStart : false;
          }).length);
        }
        setCoverage({
          wallet_balance: Number(merchantData.wallet_balance || 0),
          plan_fee: Number(merchantData.plan_fee ?? merchantData.subscription_amount ?? 0),
          add_on_fee: Number(merchantData.add_on_fee || 0),
          daily_subscription_fee: Number(
            merchantData.daily_subscription_fee ?? merchantData.subscription_amount ?? 0,
          ),
          funded_days: Number(merchantData.funded_days || 0),
          active_through: merchantData.active_through || null,
          account_active: merchantData.account_active,
        });
        if (coverageRes.ok) setCoverage(await coverageRes.json());
      } catch (error) {
        console.error('Error fetching merchant data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMerchantData();
  }, [user]);

  useEffect(() => {
    const refreshWallet = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const response = await fetch(`${API}/api/merchants/me/subscription-coverage`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (response.ok) setCoverage(await response.json());
      } catch {
        // Preserve the last known balance during a temporary connection failure.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshWallet();
    };
    const interval = window.setInterval(() => void refreshWallet(), 15000);
    window.addEventListener('focus', refreshWallet);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWallet);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const refreshCoverageFromBackend = async () => {
    const token = getToken();
    if (!token) return;
    const response = await fetch(`${API}/api/merchants/me/subscription-coverage`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.ok) setCoverage(await response.json());
  };

  const closeWalletReload = () => {
    setShowWalletReload(false);
    setReloadError('');
    setReloading(false);
    setReloadChecking(false);
    setReloadPayment(null);
    setReloadAmount('');
  };

  useEffect(() => {
    if (!reloadPayment?.paymentId) return;
    if (reloadPayment.status === 'PAID' || reloadPayment.status === 'FAILED') return;
    let cancelled = false;
    const poll = async (fromBrowserReturn = false) => {
      const token = getToken();
      if (!token) return;
      if (fromBrowserReturn) setReloadChecking(true);
      try {
        const res = await fetch(`${API}/api/wallet/reloads/${reloadPayment.paymentId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ReloadPayment;
        if (cancelled) return;
        setReloadPayment(data);
        if (data.status === 'PAID') {
          await refreshCoverageFromBackend();
        }
      } finally {
        if (!cancelled && fromBrowserReturn) setReloadChecking(false);
      }
    };
    void poll(false);
    const interval = window.setInterval(() => void poll(false), 3000);
    const onFocus = () => void poll(true);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [reloadPayment?.paymentId, reloadPayment?.status]);

  useEffect(() => {
    if (activeTab !== 'billing' || billingLoaded) return;
    const fetchBilling = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API}/api/subscriptions/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setBilling(await res.json());
      } catch (error) {
        console.error('Error fetching billing history:', error);
      } finally {
        setBillingLoaded(true);
      }
    };
    fetchBilling();
  }, [activeTab, billingLoaded]);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const subscriptionTier = merchant?.subscription_tier || 'basic';
  const subscriptionPlan = merchant?.subscription_plan || 'monthly';
  const isActive = coverage?.account_active ?? merchant?.is_active ?? false;
  const subscriptionStatus = merchant?.subscription_status || 'active';
  const planDays = PLAN_DAYS[subscriptionPlan] || 30;

  const startDate = merchant?.subscription_started_at
    ? new Date(merchant.subscription_started_at)
    : null;
  const renewalDate = merchant?.subscription_expires_at
    ? new Date(merchant.subscription_expires_at)
    : null;

  const daysRemaining = renewalDate
    ? Math.max(
        0,
        Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      )
    : 0;
  const isExpired = renewalDate ? renewalDate.getTime() < Date.now() : false;
  const isDailyPlan = subscriptionPlan.toLowerCase() === 'daily';
  const walletFunded = !isDailyPlan || Boolean(coverage?.account_active);
  const activeThrough = coverage?.active_through ? new Date(coverage.active_through) : null;
  const shopsForStatus = isShopPortal
    ? activeShop ? [activeShop] : []
    : merchantShops;
  const onlineShopCount = shopsForStatus.filter(
    shop => (shop.is_active ?? shop.isActive) !== false && isActive,
  ).length;
  const hasInStoreOrdering = subscriptionTier.toLowerCase() === 'platinum';
  const listingLimit = subscriptionTier.toLowerCase() === 'basic'
    ? 10
    : subscriptionTier.toLowerCase() === 'gold'
      ? 20
      : null;
  const listingUsage = listingLimit ? Math.min(100, (listingCount / listingLimit) * 100) : 0;

  const orderCards = [
    {
      label: 'Orders for Delivery',
      count: orderCounts.delivery,
      href: `${portalBase}/operation-summary?view=delivery`,
      color: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Orders for Pickup',
      count: orderCounts.pickup,
      href: `${portalBase}/operation-summary?view=pickup`,
      color: 'bg-amber-50 text-amber-700',
    },
    {
      label: 'In-Store Orders',
      count: hasInStoreOrdering ? orderCounts.inStore : 0,
      href: `${portalBase}/operation-summary?view=in_store`,
      color: 'bg-purple-50 text-purple-700',
    },
    {
      label: 'Completed Orders',
      count: orderCounts.completed,
      href: `${portalBase}/operation-summary?view=completed`,
      color: 'bg-green-50 text-green-700',
    },
  ];

  const reloadWallet = async () => {
    const amount = Number(reloadAmount);
    if (!Number.isFinite(amount) || amount < 50 || amount > 50000) {
      setReloadError('Enter an amount from ₱50 to ₱50,000.');
      return;
    }
    setReloading(true);
    setReloadError('');
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/wallet/reload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount,
          provider: 'paycools',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to start wallet reload.');
      setReloadPayment(data);
    } catch (error) {
      setReloadError(error instanceof Error ? error.message : 'Unable to start wallet reload.');
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Gradient Background */}
      <div className="bg-gradient-to-r from-red-600 to-purple-600 rounded-lg p-8 text-white relative">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">
              {isShopPortal
                ? `${activeShop?.merchant_name || merchant?.name || 'Shop'} · ${activeShop?.branch_name || activeShop?.name || 'Branch'}`
                : 'Merchant Dashboard'}
            </h1>
            <p className="text-red-100">
              {isShopPortal
                ? `Shop Dashboard${activeShop?.shop_id ? ` · ${activeShop.shop_id}` : ''}`
                : "Welcome back! Here's your subscription overview"}
            </p>
          </div>
          {!isShopPortal && <Link
            href="/merchant/subscription/upgrade"
            className="bg-white text-red-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Upgrade Plan
          </Link>}
        </div>
      </div>

      {isShopPortal && <section>
        <div className="mb-4"><h2 className="text-xl font-bold text-gray-900">Shop Performance</h2><p className="text-sm text-gray-600">Catalogue and customer activity for this shop.</p></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {[
            { label: 'Total Products', value: listingCount, icon: '📦' },
            { label: 'Total Sales', value: Number(merchant?.total_sales ?? totalOrderCount).toLocaleString(), icon: '🛒' },
            { label: 'Shop Rating', value: Number(merchant?.rating ?? 0).toFixed(1), icon: '⭐' },
            { label: 'Response Rate', value: `${Number(merchant?.response_rate ?? 0)}%`, icon: '💬' },
            { label: 'Followers', value: Number(merchant?.followers ?? 0).toLocaleString(), icon: '👥' },
          ].map(stat => <article key={stat.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm"><p className="text-2xl">{stat.icon}</p><p className="mt-1 text-2xl font-black text-gray-900">{stat.value}</p><p className="text-xs font-bold uppercase tracking-wide text-gray-500">{stat.label}</p></article>)}
        </div>
      </section>}

      {/* Merchant-wide operations summary. Branch operations live in My Shop. */}
      {!isShopPortal && <section>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">Shop(s) Operation Summary</h2>
          <p className="text-sm text-gray-600">Monitor orders across all of your shops.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {orderCards.map((card) => (
            <article key={card.label} className="flex min-h-44 flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${card.color}`}>
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-6 0a3 3 0 006 0m-6 7h6m-6 4h4" />
                </svg>
              </div>
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-600">{card.label}</p>
                  <p className="mt-1 text-3xl font-black text-gray-900">{card.count}</p>
                </div>
              </div>
              <Link
                href={card.href}
                className="mt-auto inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-red-600 hover:bg-red-50 hover:text-red-600"
              >
                View Details
              </Link>
            </article>
          ))}
        </div>
      </section>}

      {!isShopPortal && inventoryAlerts && <Link href="/merchant/inventory-summary" className={`block rounded-xl border p-5 shadow-sm transition hover:shadow-md ${inventoryAlerts.totals.shopsNeedingRestock ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className={`text-sm font-bold uppercase tracking-wide ${inventoryAlerts.totals.shopsNeedingRestock ? 'text-amber-700' : 'text-emerald-700'}`}>Inventory Health</p><h2 className="mt-1 text-xl font-black text-gray-900">{inventoryAlerts.totals.shopsNeedingRestock ? `${inventoryAlerts.totals.shopsNeedingRestock} shop${inventoryAlerts.totals.shopsNeedingRestock === 1 ? '' : 's'} need restocking` : 'All shops are sufficiently stocked'}</h2><p className="mt-1 text-sm text-gray-600">{inventoryAlerts.totals.lowStockItems} low-stock item{inventoryAlerts.totals.lowStockItems === 1 ? '' : 's'} · {inventoryAlerts.totals.outOfStockItems} out-of-stock item{inventoryAlerts.totals.outOfStockItems === 1 ? '' : 's'}</p></div><div className="flex flex-wrap gap-2">{inventoryAlerts.shops.filter(shop => shop.lowStockCount + shop.outOfStockCount > 0).slice(0, 4).map(shop => <span key={shop.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-amber-800 shadow-sm">{shop.name}: {shop.lowStockCount + shop.outOfStockCount}</span>)}<span className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white">View Inventory →</span></div></div></Link>}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Quick Actions</h2>
        <p className="text-gray-600 mb-4">Access frequently used features</p>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <Link
            href={`${portalBase}/products/new`}
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Add Product/Service
          </Link>
          <Link
            href={`${portalBase}/orders`}
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            View Orders
          </Link>
          <Link
            href={`${portalBase}/discounts`}
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Manage Discounts
          </Link>
          <Link
            href={isShopPortal ? '/shop/inventory' : '/merchant/inventory-summary'}
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Inventory
          </Link>
          <Link
            href={`${portalBase}/keywords`}
            className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 transition-colors text-center font-medium"
          >
            Keywords
          </Link>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className={`grid grid-cols-1 gap-6 ${isShopPortal ? '' : 'lg:grid-cols-2'}`}>
        {/* Left Column */}
        {!isShopPortal && <div className="space-y-6">
          {/* Subscription Plan Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 8h10M5 8V5m14 0v3m-2-3h-6m6 0v3m-2 0h-6m6 0v3m-2 0h-6" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 capitalize">{subscriptionTier} Plan</h3>
                  <p className="text-sm text-gray-600 capitalize">{subscriptionPlan} subscription</p>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
                  (!isDailyPlan && (isExpired || subscriptionStatus === 'expired')) || !walletFunded
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800'
                }`}
              >
                {isDailyPlan
                  ? walletFunded ? 'Active' : 'Reload needed'
                  : isExpired ? 'Expired' : subscriptionStatus}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Start Date:</span>
                <span className="font-medium">
                  {startDate ? startDate.toLocaleDateString() : '—'}
                </span>
              </div>
              {isDailyPlan ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Wallet balance</p>
                      <p className="mt-1 text-xl font-bold text-gray-900">
                        ₱{Number(coverage?.wallet_balance || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Daily subscription fee</p>
                      <p className="mt-1 text-xl font-bold text-gray-900">
                        {coverage
                          ? `₱${Number(coverage.daily_subscription_fee).toLocaleString()}`
                          : 'Loading...'}
                      </p>
                    </div>
                  </div>
                  {coverage && coverage.add_on_fee > 0 && (
                    <p className="text-xs text-gray-500">
                      Includes ₱{coverage.plan_fee.toLocaleString()} plan fee and ₱
                      {coverage.add_on_fee.toLocaleString()} add-ons.
                    </p>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Funded days:</span>
                    <span className="font-medium">{coverage?.funded_days || 0} days</span>
                  </div>
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="text-gray-600">Store remains open until:</span>
                    <span className="font-medium">
                      {activeThrough
                        ? activeThrough.toLocaleString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZone: 'Asia/Manila',
                            timeZoneName: 'short',
                          })
                        : 'Wallet reload required'}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Link
                      href="/merchant/wallet"
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-600 py-2.5 font-semibold text-red-600 transition-colors hover:bg-red-50"
                    >
                      <WalletCards className="h-5 w-5" />
                      View Wallet
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setReloadError('');
                        setReloadPayment(null);
                        setReloadChecking(false);
                        setShowWalletReload(true);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      <WalletCards className="h-5 w-5" />
                      Reload Wallet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Renewal Date:</span>
                    <span className="font-medium">
                      {renewalDate ? renewalDate.toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-600">Days Remaining</span>
                      <span className="font-medium">{daysRemaining} days</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-blue-600'}`}
                        style={{ width: `${Math.min(100, (daysRemaining / planDays) * 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Auto-renewal</span>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        merchant?.auto_renew ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {merchant?.auto_renew ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </>
              )}
              {!isDailyPlan && (isExpired || daysRemaining <= 7) && (
                <Link
                  href="/merchant/subscription/upgrade"
                  className="block text-center bg-red-600 text-white py-2 rounded-lg font-medium hover:bg-red-700 transition-colors mt-2"
                >
                  {isExpired ? 'Renew Now' : 'Renew / Upgrade'}
                </Link>
              )}
            </div>
          </div>

          {/* Ad Visibility Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Ad Visibility</h3>
              <span className={`${isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'} px-3 py-1 rounded-full text-sm font-medium`}>
                {isActive ? 'Visible' : 'Hidden'}
              </span>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Impressions</span>
                  <span className="text-lg font-bold text-gray-900">0</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Clicks</span>
                  <span className="text-lg font-bold text-gray-900">0</span>
                </div>
              </div>
            </div>
          </div>
        </div>}

        {/* Right Column */}
        <div className={isShopPortal ? 'grid gap-6 lg:grid-cols-3' : 'space-y-6'}>
          {/* Shop Status Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Shop Status</h3>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                {onlineShopCount} of {shopsForStatus.length} online
              </span>
            </div>
            <div className="space-y-3">
              {shopsForStatus.map(shop => {
                const online = (shop.is_active ?? shop.isActive) !== false && isActive;
                return (
                  <div key={shop.id} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{shop.branch_name || shop.name}</p>
                      {shop.shop_id && <p className="mt-0.5 truncate font-mono text-xs text-gray-500">{shop.shop_id}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${online ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                );
              })}
              {!shopsForStatus.length && (
                <p className="rounded-lg bg-gray-50 px-4 py-5 text-center text-sm text-gray-500">No shops found.</p>
              )}
              {isDailyPlan && !walletFunded && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Wallet balance is insufficient.</p>
                  <p className="mt-1">Reload your wallet to put your shops back online and resume customer orders.</p>
                </div>
              )}
            </div>
          </div>

          {/* Listings Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Listings</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Used</span>
                <span className="text-lg font-bold text-gray-900">{listingCount} / {listingLimit ?? 'Unlimited'}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-red-600 h-2 rounded-full" style={{ width: `${listingUsage}%` }}></div>
              </div>
              <p className="text-sm text-gray-600">{listingLimit ? `${Math.round(listingUsage)}% used` : `${listingCount} active listing${listingCount === 1 ? '' : 's'}`}</p>
            </div>
          </div>

          {/* This Month Card */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">This Month</h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Views</span>
                  <span className="text-lg font-bold text-gray-900">0</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Orders</span>
                  <span className="text-lg font-bold text-gray-900">{monthlyOrderCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Features Section */}
      {!isShopPortal && <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <div className="flex space-x-4 px-6">
            <button
              onClick={() => setActiveTab('features')}
              className={`px-4 py-3 font-medium ${
                activeTab === 'features'
                  ? 'text-red-600 border-b-2 border-red-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Plan Features
            </button>
            <button
              onClick={() => setActiveTab('billing')}
              className={`px-4 py-3 font-medium ${
                activeTab === 'billing'
                  ? 'text-red-600 border-b-2 border-red-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Billing History
            </button>
          </div>
        </div>

        {activeTab === 'features' && (
          <div className="p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-2">Your Plan Features</h3>
            <p className="text-gray-600 mb-6">Available features with your {subscriptionTier} subscription</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(TIER_FEATURES[subscriptionTier] || TIER_FEATURES.basic).map((feature) => (
                <div key={feature} className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-700">{feature}</span>
                </div>
              ))}
            </div>
            {subscriptionTier !== 'platinum' && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <p className="text-gray-700">
                  Want more features?{' '}
                  <Link href="/merchant/subscription/upgrade" className="text-red-600 font-semibold hover:underline">
                    Upgrade your plan
                  </Link>{' '}
                  for more listings and premium support.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Billing History</h3>
            {!billingLoaded ? (
              <p className="text-gray-500">Loading...</p>
            ) : billing.length === 0 ? (
              <p className="text-gray-500">No billing records yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Plan</th>
                      <th className="py-2 pr-4">Method</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.map((b) => (
                      <tr key={b.id} className="border-b border-gray-100">
                        <td className="py-3 pr-4">{new Date(b.created_at).toLocaleDateString()}</td>
                        <td className="py-3 pr-4 capitalize">{b.tier} · {b.plan}</td>
                        <td className="py-3 pr-4 capitalize">{b.payment_method}</td>
                        <td className="py-3 pr-4">₱{Number(b.amount).toLocaleString()}</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                              b.status === 'paid'
                                ? 'bg-green-100 text-green-800'
                                : b.status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {b.status === 'paid' ? 'Paid' : b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>}

      {showWalletReload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Reload wallet</h2>
                <p className="mt-1 text-sm text-gray-600">Add funds for daily subscription charges.</p>
              </div>
              <button
                type="button"
                onClick={closeWalletReload}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close wallet reload"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {reloadPayment ? (
              <div className="space-y-4">
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  {reloadPayment.status === 'PAID'
                    ? 'Wallet credited'
                    : reloadPayment.status === 'FAILED'
                      ? 'Payment failed'
                      : reloadChecking
                        ? 'Checking payment status...'
                        : 'Pending Payment'}
                </p>
                <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                  <p>
                    Amount: ₱{Number(reloadPayment.amount).toLocaleString()} {reloadPayment.currency}
                  </p>
                  <p>Provider: PayCools</p>
                  <p>Reference: {reloadPayment.reference}</p>
                </div>
                {reloadPayment.paymentUrl && reloadPayment.status === 'PENDING' && (
                  <a
                    href={reloadPayment.paymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setReloadChecking(true)}
                    className="block w-full rounded-lg bg-red-600 py-2.5 text-center font-semibold text-white hover:bg-red-700"
                  >
                    Open PayCools payment
                  </a>
                )}
                {reloadPayment.qrData && reloadPayment.status === 'PENDING' && (
                  <div>
                    <p className="mb-1 text-sm font-medium text-gray-700">PayCools QR</p>
                    <textarea
                      readOnly
                      value={reloadPayment.qrData}
                      className="h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700"
                    />
                  </div>
                )}
                {reloadPayment.status === 'PENDING' && !reloadChecking && (
                  <p className="text-sm text-gray-500">Waiting for PayCools to confirm payment. This page will not credit your wallet from the browser.</p>
                )}
              </div>
            ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-gray-700">Amount (₱)</span>
                <input
                  type="number"
                  min="50"
                  max="50000"
                  step="1"
                  value={reloadAmount}
                  onChange={(event) => setReloadAmount(event.target.value)}
                  placeholder="500"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
              </label>
              <p className="text-sm text-gray-600">Payment provider: PayCools</p>
              {reloadError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{reloadError}</p>
              )}
              <button
                type="button"
                onClick={reloadWallet}
                disabled={reloading}
                className="w-full rounded-lg bg-red-600 py-2.5 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reloading ? 'Creating payment...' : 'Continue to PayCools'}
              </button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
