'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, WalletCards } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Coverage {
  wallet_balance: number;
  daily_subscription_fee: number;
  funded_days: number;
  active_through: string | null;
  account_active: boolean;
}

interface Shop {
  id: number;
  name: string;
  shop_id?: string | null;
  store_id?: string | null;
  is_active?: boolean;
  isActive?: boolean;
}

interface TransactionShop {
  id: number;
  name: string;
  shopId?: string | null;
}

interface WalletTransaction {
  id: string;
  referenceNumber: string;
  type: string;
  status: string;
  amount: number;
  fee: number;
  netAmount: number;
  description?: string | null;
  metadata?: {
    purpose?: string;
    billingDate?: string;
    shops?: TransactionShop[];
  } | null;
  createdAt: string;
}

const money = (value: number) => `₱${Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

export default function MerchantWalletPage() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const token = getToken();
      if (!token) {
        setError('Please sign in to view your wallet.');
        setLoading(false);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const merchantResponse = await fetch(`${API}/api/merchants/me`, { headers });
        if (!merchantResponse.ok) throw new Error('Unable to load merchant information.');
        const merchant = await merchantResponse.json();
        const [coverageResponse, shopsResponse, transactionsResponse] = await Promise.all([
          fetch(`${API}/api/merchants/me/subscription-coverage`, { headers }),
          fetch(`${API}/api/merchants/${merchant.id}/branches`, { headers }),
          fetch(`${API}/api/wallet/transactions?limit=100`, { headers }),
        ]);
        if (!coverageResponse.ok || !shopsResponse.ok || !transactionsResponse.ok) {
          throw new Error('Unable to load the wallet ledger.');
        }
        setCoverage(await coverageResponse.json());
        const shopData = await shopsResponse.json();
        const transactionData = await transactionsResponse.json();
        setShops(Array.isArray(shopData) ? shopData : shopData?.data || []);
        setTransactions(Array.isArray(transactionData) ? transactionData : transactionData?.data || []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load the wallet ledger.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const activeShops = useMemo(
    () => shops.filter(shop => shop.is_active ?? shop.isActive ?? true),
    [shops],
  );

  if (loading) return <div className="py-12 text-center text-gray-600">Loading wallet ledger...</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-gray-900">Merchant Wallet</h1>
        <p className="mt-1 text-gray-600">View your balance, daily subscription coverage, and complete ledger.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={<WalletCards className="h-5 w-5" />} label="Available balance" value={money(coverage?.wallet_balance || 0)} />
        <SummaryCard icon={<CalendarDays className="h-5 w-5" />} label="Daily subscription fee" value={money(coverage?.daily_subscription_fee || 0)} />
        <SummaryCard icon={<CalendarDays className="h-5 w-5" />} label="Funded future days" value={`${coverage?.funded_days || 0} days`} />
        <SummaryCard icon={<Building2 className="h-5 w-5" />} label="Shops covered" value={`${activeShops.length} of ${shops.length}`} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-5">
          <h2 className="font-bold text-gray-900">Shop coverage</h2>
          <p className="mt-1 text-sm text-gray-600">The merchant wallet and daily subscription charge cover the shops listed below.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="px-5 py-3">Shop name</th><th className="px-5 py-3">Shop ID</th><th className="px-5 py-3">Coverage</th><th className="px-5 py-3">Active through</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {shops.map(shop => {
                const active = shop.is_active ?? shop.isActive ?? true;
                return <tr key={shop.id}><td className="px-5 py-4 font-semibold text-gray-900">{shop.name}</td><td className="px-5 py-4 font-mono text-xs text-gray-600">{shop.shop_id || shop.store_id || `SHOP-${shop.id}`}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${active && coverage?.account_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{active && coverage?.account_active ? 'Covered' : 'Not covered'}</span></td><td className="px-5 py-4 text-gray-700">{coverage?.active_through ? new Date(coverage.active_through).toLocaleDateString() : 'Reload required'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-5">
          <h2 className="font-bold text-gray-900">Wallet ledger</h2>
          <p className="mt-1 text-sm text-gray-600">Daily fees, reloads, payments, and other wallet movements.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Details</th><th className="px-5 py-3">Shop coverage</th><th className="px-5 py-3">Reference</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map(transaction => {
                const isCredit = ['top_up', 'transfer_in', 'earning', 'refund'].includes(transaction.type);
                const transactionShops = transaction.metadata?.shops;
                const covered = transaction.metadata?.purpose === 'daily_subscription'
                  ? transactionShops?.length ? transactionShops : shops.map(shop => ({ id: shop.id, name: shop.name, shopId: shop.shop_id || shop.store_id }))
                  : [];
                return <tr key={transaction.id}><td className="whitespace-nowrap px-5 py-4 text-gray-700">{new Date(transaction.createdAt).toLocaleString()}</td><td className="px-5 py-4"><p className="font-semibold text-gray-900">{transaction.description || transaction.type.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs capitalize text-gray-500">{transaction.type.replaceAll('_', ' ')}</p></td><td className="px-5 py-4">{covered.length ? <div className="flex max-w-sm flex-wrap gap-1">{covered.map(shop => <span key={shop.id} title={shop.shopId || undefined} className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">{shop.name}</span>)}</div> : <span className="text-gray-400">—</span>}</td><td className="px-5 py-4 font-mono text-xs text-gray-600">{transaction.referenceNumber}</td><td className="px-5 py-4 capitalize">{transaction.status}</td><td className={`px-5 py-4 text-right font-bold ${isCredit ? 'text-green-700' : 'text-red-700'}`}>{isCredit ? '+' : '−'}{money(transaction.amount + (isCredit ? 0 : transaction.fee || 0))}</td></tr>;
              })}
              {!transactions.length && <tr><td colSpan={6} className="p-10 text-center text-gray-500">No wallet transactions recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">{icon}</div><p className="text-sm font-medium text-gray-500">{label}</p><p className="mt-1 text-2xl font-black text-gray-900">{value}</p></div>;
}
