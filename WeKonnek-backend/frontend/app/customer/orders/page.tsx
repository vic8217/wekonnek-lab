'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Order {
  id: number;
  order_code: string;
  merchant_name: string;
  merchant_location: string;
  status: string;
  total_amount: number;
  items: string[];
  created_at: string;
}

type OrderFilter = 'open' | 'pending' | 'completed';
const PENDING_STATUSES = new Set(['pending']);
const COMPLETED_STATUSES = new Set(['completed', 'delivered', 'cancelled']);

export default function CustomerOrdersPage() {
  const { user: authUser } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'reservations'>('orders');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('open');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authUser) fetchOrders();
  }, [authUser]);

  useEffect(() => {
    setOrders(allOrders.filter(order => {
      const status = String(order.status).toLowerCase();
      if (orderFilter === 'pending') return PENDING_STATUSES.has(status);
      if (orderFilter === 'completed') return COMPLETED_STATUSES.has(status);
      return !PENDING_STATUSES.has(status) && !COMPLETED_STATUSES.has(status);
    }));
  }, [orderFilter, allOrders]);

  const fetchOrders = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch orders');
      const ordersData = await res.json();

      const transformed: Order[] = (Array.isArray(ordersData) ? ordersData : ordersData.data || []).map((order: any) => ({
        id: order.id,
        order_code: order.order_code || order.orderCode,
        merchant_name: order.merchants?.name || order.merchant?.name || 'Unknown Merchant',
        merchant_location: order.merchants?.city || order.merchant?.city || order.merchants?.state || '',
        status: order.status,
        total_amount: order.total_amount || order.totalAmount || 0,
        items: (order.order_items || order.orderItems || []).map((item: any) => `${item.quantity}x ${item.product_name || item.productName}`),
        created_at: order.created_at || order.createdAt,
      }));

      setAllOrders(transformed);

      try {
        const resReservations = await fetch(`${API}/api/reservations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resReservations.ok) {
          const resData = await resReservations.json();
          setReservations(Array.isArray(resData) ? resData : resData.data || []);
        }
      } catch {
        setReservations([]);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
      setAllOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-700';
      case 'processing': case 'preparing': return 'bg-blue-100 text-blue-700';
      case 'ready': return 'bg-green-100 text-green-700';
      case 'out_for_delivery': return 'bg-indigo-100 text-indigo-700';
      case 'bill_out': return 'bg-purple-100 text-purple-700';
      case 'completed': return 'bg-emerald-100 text-emerald-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'processing': case 'preparing': return '👨‍🍳';
      case 'ready': return '✅';
      case 'out_for_delivery': return '🚚';
      case 'bill_out': return '💳';
      case 'completed': return '🎉';
      case 'cancelled': return '❌';
      default: return '📋';
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };

  const pendingCount = allOrders.filter(order => PENDING_STATUSES.has(String(order.status).toLowerCase())).length;
  const completedCount = allOrders.filter(order => COMPLETED_STATUSES.has(String(order.status).toLowerCase())).length;
  const openCount = allOrders.length - pendingCount - completedCount;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-400">Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ========== MOBILE ORDERS ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="px-4 pt-4 pb-2">
            <h1 className="text-lg font-bold text-gray-900">My Orders</h1>
          </div>

          {/* Primary Tabs */}
          <div className="flex px-4 gap-1">
            <button
              onClick={() => setActiveTab('orders')}
              className={`flex-1 py-2.5 text-center text-sm font-semibold rounded-t-xl transition-colors ${
                activeTab === 'orders'
                  ? 'text-[#DB0002] border-b-2 border-[#DB0002] bg-red-50/50'
                  : 'text-gray-400'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('reservations')}
              className={`flex-1 py-2.5 text-center text-sm font-semibold rounded-t-xl transition-colors ${
                activeTab === 'reservations'
                  ? 'text-[#DB0002] border-b-2 border-[#DB0002] bg-red-50/50'
                  : 'text-gray-400'
              }`}
            >
              Reservations
            </button>
          </div>

          {/* Sub-filter for orders */}
          {activeTab === 'orders' && (
            <div className="flex gap-2 px-4 py-2.5 border-b border-gray-100">
              <button
                onClick={() => setOrderFilter('open')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                  orderFilter === 'open'
                    ? 'bg-[#DB0002] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                Open ({openCount})
              </button>
              <button
                onClick={() => setOrderFilter('pending')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                  orderFilter === 'pending'
                    ? 'bg-[#DB0002] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                Pending ({pendingCount})
              </button>
              <button
                onClick={() => setOrderFilter('completed')}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${orderFilter === 'completed' ? 'bg-[#DB0002] text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}
              >
                Completed ({completedCount})
              </button>
            </div>
          )}
        </div>

        {/* Orders Tab Content */}
        {activeTab === 'orders' && (
          <div className="px-4 py-3 space-y-3 mobile-scroll">
            {orders.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium">No {orderFilter} orders</p>
                <p className="text-xs text-gray-400 mt-1">Your orders will appear here</p>
                <Link href="/customer/dashboard" className="inline-block mt-4 px-5 py-2 bg-[#DB0002] text-white text-sm font-semibold rounded-full">
                  Browse Stores
                </Link>
              </div>
            ) : (
              orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/customer/orders/${order.id}`}
                  className="block bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 mobile-press active:bg-gray-50 transition-all"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-gradient-to-br from-orange-100 to-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-lg">{getStatusIcon(order.status)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-gray-900 truncate">{order.merchant_name}</h3>
                        <p className="text-[11px] text-gray-400">{getTimeAgo(order.created_at)}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold capitalize ${getStatusColor(order.status)}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {/* Items */}
                  <div className="px-4 py-2 border-t border-gray-50">
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {order.items.length > 0 ? order.items.join(' • ') : 'No items'}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/50">
                    <span className="text-[11px] text-gray-400 font-mono">{order.order_code}</span>
                    {order.total_amount > 0 && (
                      <span className="text-sm font-bold text-gray-900">₱{Number(order.total_amount).toFixed(2)}</span>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        )}

        {/* Reservations Tab Content */}
        {activeTab === 'reservations' && (
          <div className="px-4 py-3 space-y-3 mobile-scroll">
            {reservations.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-gray-500 font-medium">No reservations yet</p>
                <p className="text-xs text-gray-400 mt-1">Book a table at your favourite restaurant</p>
              </div>
            ) : (
              reservations.map((res: any) => (
                <div key={res.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
      <div>
                        <h3 className="text-sm font-bold text-gray-900">{res.merchants?.name || 'Restaurant'}</h3>
                        <p className="text-[11px] text-gray-400">{res.reservation_code}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold capitalize ${getStatusColor(res.status)}`}>
                      {res.status}
                    </span>
                  </div>
                  <div className="px-4 py-2 border-t border-gray-50 flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {res.reservation_date ? new Date(res.reservation_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : 'TBD'}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {res.reservation_time || 'TBD'}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {res.party_size || res.guests || '?'} guests
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ========== DESKTOP ORDERS ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Orders & Reservations</h1>
          <p className="text-gray-600">Track your orders and manage reservations</p>
        </div>

      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-6 py-3 font-medium transition-colors border-b-2 ${
              activeTab === 'orders' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Orders
        </button>
        <button
          onClick={() => setActiveTab('reservations')}
          className={`px-6 py-3 font-medium transition-colors border-b-2 ${
              activeTab === 'reservations' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Reservations
        </button>
      </div>

      {activeTab === 'orders' && (
        <>
          <div className="flex space-x-2">
            <button
              onClick={() => setOrderFilter('open')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  orderFilter === 'open' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
                Open ({openCount})
            </button>
            <button
              onClick={() => setOrderFilter('pending')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  orderFilter === 'pending' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
                Pending ({pendingCount})
            </button>
            <button
              onClick={() => setOrderFilter('completed')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${orderFilter === 'completed' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
                Completed ({completedCount})
            </button>
          </div>
          <div className="space-y-4">
              {orders.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <p className="text-gray-500">No {orderFilter} orders found</p>
              </div>
            ) : (
              orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/customer/orders/${order.id}`}
                    className="block bg-white rounded-lg p-6 border border-gray-200 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">{order.merchant_name}</h3>
                      <p className="text-sm text-gray-500">{order.merchant_location}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(order.status)}`}>
                        {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mb-3">
                      <span className="font-mono">{order.order_code}</span>
                      <span>•</span>
                      <span>{new Date(order.created_at).toLocaleDateString()}</span>
                      {order.total_amount > 0 && (
                        <>
                          <span>•</span>
                          <span className="font-bold text-gray-900">₱{Number(order.total_amount).toFixed(2)}</span>
                        </>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{order.items.join(' • ')}</p>
                  </Link>
                ))
              )}
            </div>
          </>
        )}

        {activeTab === 'reservations' && (
          <div className="space-y-4">
            {reservations.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <p className="text-gray-500">No reservations yet</p>
              </div>
            ) : (
              reservations.map((res: any) => (
                <div key={res.id} className="bg-white rounded-lg p-6 border border-gray-200">
                  <div className="flex items-start justify-between">
                  <div>
                      <h3 className="text-lg font-bold text-gray-900">{res.merchants?.name || 'Restaurant'}</h3>
                      <p className="text-sm text-gray-500">{res.reservation_code} • {res.reservation_date} at {res.reservation_time}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(res.status)}`}>
                      {res.status}
                    </span>
                  </div>
                </div>
              ))
            )}
        </div>
      )}
    </div>
    </>
  );
}
