'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface OrderItem {
  id: number;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface OrderRow {
  id: number;
  order_code: string;
  status: string;
  total_amount: number;
  delivery_fee: number;
  delivery_address: string | null;
  delivery_zone_name: string | null;
  customer_barangay: string | null;
  table_number: string | null;
  order_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  merchant_id: number;
  merchants: {
    name: string;
    slug: string;
    city: string | null;
    phone: string | null;
    logo_url: string | null;
  } | null;
  order_items: OrderItem[];
}

interface TimelineStep {
  key: string;
  label: string;
  icon: string;
  state: 'done' | 'current' | 'upcoming' | 'cancelled';
}

const DELIVERY_FLOW = [
  'pending',
  'processing',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
];

const PICKUP_FLOW = [
  'pending',
  'processing',
  'preparing',
  'ready',
  'completed',
];

const DINE_IN_FLOW = [
  'pending',
  'processing',
  'preparing',
  'ready',
  'bill_out',
  'completed',
];

const STATUS_META: Record<
  string,
  { label: string; icon: string; tone: string }
> = {
  pending: { label: 'Placed', icon: '🧾', tone: 'bg-amber-100 text-amber-700' },
  processing: {
    label: 'Confirmed',
    icon: '✅',
    tone: 'bg-blue-100 text-blue-700',
  },
  preparing: {
    label: 'Preparing',
    icon: '👨‍🍳',
    tone: 'bg-blue-100 text-blue-700',
  },
  ready: { label: 'Ready', icon: '🛍️', tone: 'bg-green-100 text-green-700' },
  out_for_delivery: {
    label: 'Out for Delivery',
    icon: '🚚',
    tone: 'bg-indigo-100 text-indigo-700',
  },
  bill_out: { label: 'Bill Out', icon: '💳', tone: 'bg-purple-100 text-purple-700' },
  completed: {
    label: 'Completed',
    icon: '🎉',
    tone: 'bg-emerald-100 text-emerald-700',
  },
  cancelled: { label: 'Cancelled', icon: '❌', tone: 'bg-red-100 text-red-700' },
};

function formatDate(input: string | null | undefined): string {
  if (!input) return '';
  try {
    return new Date(input).toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return input;
  }
}

export default function CustomerOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = params.id as string;
  const justPlaced = searchParams.get('placed') === '1';

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          router.push('/auth/login');
          return;
        }

        const res = await fetch(`${API}/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load order');
        const data = await res.json();

        if (cancelled) return;
        setOrder(data as unknown as OrderRow);
      } catch (err: unknown) {
        console.error('Error loading order:', err);
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    // Poll for status changes every 15 seconds (real-time will be re-added later)
    const interval = setInterval(load, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, router]);

  const timeline = useMemo<TimelineStep[]>(() => {
    if (!order) return [];
    const flow =
      order.order_type === 'delivery'
        ? DELIVERY_FLOW
        : order.order_type === 'dine_in'
          ? DINE_IN_FLOW
          : PICKUP_FLOW;

    if (order.status === 'cancelled') {
      return [
        { key: 'pending', label: 'Placed', icon: '🧾', state: 'done' },
        {
          key: 'cancelled',
          label: 'Cancelled',
          icon: '❌',
          state: 'cancelled',
        },
      ];
    }

    const currentIdx = flow.indexOf(order.status);
    return flow.map((key, idx) => ({
      key,
      label: STATUS_META[key]?.label || key,
      icon: STATUS_META[key]?.icon || '•',
      state:
        currentIdx === -1
          ? 'upcoming'
          : idx < currentIdx
            ? 'done'
            : idx === currentIdx
              ? 'current'
              : 'upcoming',
    }));
  }, [order]);

  const subtotal = useMemo(() => {
    if (!order) return 0;
    return order.order_items.reduce(
      (s, it) => s + Number(it.subtotal || it.price * it.quantity),
      0,
    );
  }, [order]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-3">
        <div className="h-8 bg-gray-200 rounded animate-pulse w-40" />
        <div className="h-32 bg-gray-200 rounded-2xl animate-pulse" />
        <div className="h-48 bg-gray-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-gray-700 font-medium mb-1">Order not found</p>
        <p className="text-sm text-gray-500 mb-4">
          {error || 'This order may have been removed.'}
        </p>
        <Link
          href="/customer/orders"
          className="inline-block px-5 py-2 rounded-full bg-[#DB0002] text-white text-sm font-semibold"
        >
          Back to My Orders
        </Link>
      </div>
    );
  }

  const statusMeta = STATUS_META[order.status] || {
    label: order.status,
    icon: '•',
    tone: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 pb-24">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center"
          title="Back"
        >
          <svg
            className="w-4 h-4 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">
            Order {order.order_code}
          </h1>
          <p className="text-xs text-gray-500">{formatDate(order.created_at)}</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-bold ${statusMeta.tone}`}
        >
          {statusMeta.label}
        </span>
      </div>

      {/* "Just placed" banner */}
      {justPlaced && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center text-xl">
            ✓
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-green-900">Order placed!</h2>
            <p className="text-sm text-green-800">
              Your order reference is{' '}
              <span className="font-mono font-bold">{order.order_code}</span>.
              We&apos;ll notify you when the status changes.
            </p>
          </div>
        </div>
      )}

      {/* Merchant card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
            {order.merchants?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={order.merchants.logo_url}
                alt={order.merchants.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                🏪
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 truncate">
              {order.merchants?.name || 'Merchant'}
            </h2>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {order.merchants?.city && <span>📍 {order.merchants.city}</span>}
              {order.merchants?.phone && (
                <a
                  href={`tel:${order.merchants.phone}`}
                  className="text-[#DB0002] font-medium"
                >
                  📞 Call
                </a>
              )}
            </div>
          </div>
          {order.merchants?.slug && (
            <Link
              href={`/merchants/${order.merchants.slug}`}
              className="text-xs text-[#DB0002] font-semibold hover:underline"
            >
              Visit shop →
            </Link>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-4">Order Status</h2>
        <ol className="relative space-y-4">
          {timeline.map((step, idx) => {
            const isLast = idx === timeline.length - 1;
            const stateColor =
              step.state === 'done'
                ? 'bg-green-500 text-white'
                : step.state === 'current'
                  ? 'bg-[#DB0002] text-white animate-pulse'
                  : step.state === 'cancelled'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-200 text-gray-400';
            const textColor =
              step.state === 'upcoming'
                ? 'text-gray-400'
                : step.state === 'cancelled'
                  ? 'text-red-600'
                  : 'text-gray-900';
            return (
              <li key={step.key} className="flex items-start gap-3 relative">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${stateColor}`}
                  >
                    {step.icon}
                  </div>
                  {!isLast && (
                    <div
                      className={`w-0.5 flex-1 mt-1 min-h-[24px] ${
                        step.state === 'done' ? 'bg-green-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>
                <div className="flex-1 pb-2">
                  <p className={`text-sm font-semibold ${textColor}`}>
                    {step.label}
                  </p>
                  {step.state === 'current' && (
                    <p className="text-xs text-gray-500">
                      Updated {formatDate(order.updated_at)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Items */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">
          Items ({order.order_items.reduce((s, it) => s + it.quantity, 0)})
        </h2>
        <div className="divide-y divide-gray-100">
          {order.order_items.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No items recorded.</p>
          ) : (
            order.order_items.map((item) => (
              <div
                key={item.id}
                className="py-2 flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.product_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.quantity} × ₱{Number(item.price).toFixed(2)}
                  </p>
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  ₱
                  {Number(
                    item.subtotal || item.price * item.quantity,
                  ).toFixed(2)}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 space-y-1 text-sm">
          <div className="flex items-center justify-between text-gray-600">
            <span>Subtotal</span>
            <span>₱{subtotal.toFixed(2)}</span>
          </div>
          {Number(order.delivery_fee) > 0 && (
            <div className="flex items-center justify-between text-gray-600">
              <span>Delivery fee</span>
              <span>₱{Number(order.delivery_fee).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 font-bold text-gray-900">
            <span>Total</span>
            <span className="text-[#DB0002] text-lg">
              ₱{Number(order.total_amount).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Delivery / Dine-in / Notes */}
      {(order.order_type === 'delivery' ||
        order.order_type === 'dine_in' ||
        order.notes) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          {order.order_type === 'delivery' && order.delivery_address && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Delivery Address
              </p>
              <p className="text-sm text-gray-900">{order.delivery_address}</p>
              {(order.customer_barangay || order.delivery_zone_name) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {[order.customer_barangay, order.delivery_zone_name]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              )}
            </div>
          )}
          {order.order_type === 'dine_in' && order.table_number && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Table Number
              </p>
              <p className="text-sm text-gray-900">{order.table_number}</p>
            </div>
          )}
          {order.notes && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Notes
              </p>
              <p className="text-sm text-gray-900">{order.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
