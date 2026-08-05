'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, Search, Store } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Shop {
  id: number;
  name: string;
  shop_id?: string | null;
  store_id?: string | null;
  is_default?: boolean;
  isDefault?: boolean;
}

interface Order {
  status?: string;
  order_type?: string;
  orderType?: string;
  delivery_address?: string | null;
  table_number?: string | null;
  created_at?: string;
  createdAt?: string;
  branch_id?: number | null;
  branchId?: number | null;
  shop_id?: string | null;
  shopId?: string | null;
}

interface ShopSummary extends Shop {
  delivery: number;
  pickup: number;
  inStore: number;
  completed: number;
  total: number;
}

type SummaryView = 'delivery' | 'pickup' | 'in_store' | 'completed';

const VIEW_DETAILS: Record<SummaryView, { title: string; column: string; value: (shop: ShopSummary) => number }> = {
  delivery: { title: 'Orders for Delivery Summary', column: 'Delivery orders', value: (shop) => shop.delivery },
  pickup: { title: 'Orders for Pickup Summary', column: 'Pickup orders', value: (shop) => shop.pickup },
  in_store: { title: 'In-Store Orders Summary', column: 'In-store orders', value: (shop) => shop.inStore },
  completed: { title: 'Completed Orders Summary', column: 'Completed orders', value: (shop) => shop.completed },
};

const orderDate = (order: Order) => order.created_at || order.createdAt || '';
const orderType = (order: Order) =>
  order.order_type || order.orderType ||
  (order.delivery_address ? 'delivery' : order.table_number ? 'in_store' : 'pickup');

export default function MerchantOperationSummaryPage() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: SummaryView = requestedView && requestedView in VIEW_DETAILS
    ? requestedView as SummaryView
    : 'delivery';
  const viewDetails = VIEW_DETAILS[view];
  const [shops, setShops] = useState<Shop[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const token = getToken();
      if (!token) {
        setError('Please sign in to view the shop summary.');
        setLoading(false);
        return;
      }

      const headers = { Authorization: `Bearer ${token}` };
      try {
        const merchantResponse = await fetch(`${API}/api/merchants/me`, { headers });
        if (!merchantResponse.ok) throw new Error('Unable to load merchant information.');
        const merchant = await merchantResponse.json();

        const [shopsResponse, ordersResponse] = await Promise.all([
          fetch(`${API}/api/merchants/${merchant.id}/branches`, { headers }),
          fetch(`${API}/api/orders?merchantId=${merchant.id}`, { headers }),
        ]);
        if (!shopsResponse.ok || !ordersResponse.ok) throw new Error('Unable to load shop operations.');

        const shopsData = await shopsResponse.json();
        const ordersData = await ordersResponse.json();
        setShops(Array.isArray(shopsData) ? shopsData : shopsData?.data || []);
        setOrders(Array.isArray(ordersData) ? ordersData : ordersData?.data || []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load shop operations.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const summaries = useMemo<ShopSummary[]>(() => {
    const dateFilteredOrders = orders.filter((order) => !date || orderDate(order).slice(0, 10) === date);
    const defaultShop = shops.find((shop) => shop.is_default || shop.isDefault) || shops[0];

    return shops.map((shop) => {
      const shopCode = shop.shop_id || shop.store_id;
      const shopOrders = dateFilteredOrders.filter((order) => {
        const branchId = order.branch_id ?? order.branchId;
        const orderShopCode = order.shop_id ?? order.shopId;
        if (branchId != null) return Number(branchId) === shop.id;
        if (orderShopCode) return orderShopCode === shopCode;
        return defaultShop?.id === shop.id;
      });
      return {
        ...shop,
        delivery: shopOrders.filter((order) => orderType(order) === 'delivery').length,
        pickup: shopOrders.filter((order) => orderType(order) === 'pickup').length,
        inStore: shopOrders.filter((order) => ['in_store', 'dine_in'].includes(orderType(order))).length,
        completed: shopOrders.filter((order) => order.status?.toLowerCase() === 'completed').length,
        total: shopOrders.length,
      };
    });
  }, [date, orders, shops]);

  const filteredSummaries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return summaries;
    return summaries.filter((shop) =>
      shop.name.toLowerCase().includes(query) ||
      (shop.shop_id || shop.store_id || '').toLowerCase().includes(query),
    );
  }, [search, summaries]);

  if (loading) return <div className="py-12 text-center text-gray-600">Loading shop operations...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{viewDetails.title}</h1>
        <p className="mt-1 text-gray-600">Review {viewDetails.column.toLowerCase()} across all shops.</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <label className="relative block">
            <span className="sr-only">Search by shop name or shop ID</span>
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by shop name or shop ID" className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-gray-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </label>
          <label className="relative block">
            <span className="sr-only">Filter by date</span>
            <CalendarDays className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-gray-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          </label>
        </div>
        {(search || date) && <button onClick={() => { setSearch(''); setDate(''); }} className="mt-3 text-sm font-semibold text-red-600 hover:text-red-700">Clear filters</button>}
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{error}</div>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="font-bold text-gray-900">All shops</h2>
              <p className="text-sm text-gray-600">{filteredSummaries.length} of {shops.length} shops shown</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr><th className="px-5 py-3 font-semibold">Shop</th><th className="px-5 py-3 font-semibold">Shop ID</th><th className="px-5 py-3 text-center font-semibold">{viewDetails.column}</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSummaries.map((shop) => <tr key={shop.id} className="hover:bg-gray-50"><td className="px-5 py-4 font-semibold text-gray-900"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-red-600" />{shop.name}</span></td><td className="px-5 py-4 font-mono text-gray-600">{shop.shop_id || shop.store_id || `SHOP-${shop.id}`}</td><td className="px-5 py-4 text-center font-bold text-gray-900">{viewDetails.value(shop)}</td></tr>)}
                </tbody>
              </table>
            </div>
            {!filteredSummaries.length && <div className="px-5 py-12 text-center text-gray-500">No shops match the selected filters.</div>}
          </section>
        </>
      )}
    </div>
  );
}
