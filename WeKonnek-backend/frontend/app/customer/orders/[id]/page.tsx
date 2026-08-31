'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';
import OrderFlowStepper from '@/components/OrderFlowStepper';
import PayWithQrph, { type PayCoolsPaymentDto } from '@/components/PayWithQrph';
import { RefreshCw } from 'lucide-react';

interface OrderItem {
  id: number;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
  image_url?: string | null;
  variant_name?: string | null;
  status?: 'preparing' | 'served' | null;
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
  payment_method?: string | null;
  payment_status?: string | null;
  payment_url?: string | null;
  discount_type?: string | null;
  discount_amount?: number | null;
  discount_details?: {
    totalDiners?: number;
    eligibleDiners?: number;
    vatExemption?: number;
    scPwdDiscount?: number;
  } | null;
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
  service_requests?: Array<{ id: number; type: string; details?: string | null; status: string; assigned_staff_name?: string | null; created_at: string }>;
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
  payment_pending: { label: 'Payment Pending', icon: '💳', tone: 'bg-purple-100 text-purple-700' },
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
  const [startingPayment, setStartingPayment] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [requestType, setRequestType] = useState('spoon_fork');
  const [requestDetails, setRequestDetails] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrphAvailable, setQrphAvailable] = useState(false);
  const [qrphPayment, setQrphPayment] = useState<PayCoolsPaymentDto | null>(null);
  const [qrphStatus, setQrphStatus] = useState<'CREATING' | PayCoolsPaymentDto['status'] | null>(null);

  const loadOrder = useCallback(async (initial = false) => {
    if (!orderId) return false;
    if (initial) setLoading(true);
    try {
      setError(null);
      const token = await getToken();
      if (!token) {
        router.push('/auth/login');
        return false;
      }
      const res = await fetch(`/api/backend/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load order');
      setOrder(await res.json() as OrderRow);
      return true;
    } catch (err: unknown) {
      console.error('Error loading order:', err);
      if (initial) setError(err instanceof Error ? err.message : 'Failed to load order');
      return false;
    } finally {
      if (initial) setLoading(false);
    }
  }, [orderId, router]);

  useEffect(() => {
    void loadOrder(true);

    const refreshOnReturn = () => { if (document.visibilityState === 'visible') void loadOrder(); };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void loadOrder(); }, 5000);
    window.addEventListener('focus', refreshOnReturn);
    window.addEventListener('pageshow', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnReturn);
      window.removeEventListener('pageshow', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [loadOrder]);

  useEffect(() => {
    if (!order || order.payment_status === 'paid') return;
    let cancelled = false;
    const loadQrph = async () => {
      const token = getToken();
      if (!token) return;
      if (order.order_type === 'dine_in' && order.status === 'payment_pending') {
        const availableRes = await fetch(`/api/backend/orders/${order.id}/paycools-availability`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const availableBody = await availableRes.json().catch(() => ({}));
        if (!cancelled) setQrphAvailable(Boolean(availableRes.ok && availableBody.available));
      }
      if (order.payment_method !== 'qrph') return;
      const res = await fetch(`/api/backend/orders/${order.id}/paycools-payment`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as PayCoolsPaymentDto;
      if (cancelled) return;
      setQrphPayment(data);
      setQrphStatus(data.status);
    };
    void loadQrph();
    return () => {
      cancelled = true;
    };
  }, [order]);

  useEffect(() => {
    if (!order || !qrphPayment?.paymentId) return;
    if (qrphStatus !== 'PENDING') return;
    let cancelled = false;
    const poll = async () => {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`/api/backend/orders/${order.id}/paycools-payment`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as PayCoolsPaymentDto;
      if (cancelled) return;
      setQrphPayment(data);
      setQrphStatus(data.status);
      if (data.status === 'PAID') void loadOrder();
    };
    const interval = window.setInterval(() => { void poll(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [order, qrphPayment?.paymentId, qrphStatus, loadOrder]);

  const manualRefresh = async () => {
    setRefreshing(true);
    const refreshed = await loadOrder();
    setRefreshing(false);
    if (refreshed) toast.success('Order refreshed');
    else toast.error('Unable to refresh order');
  };

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

  const submitServiceRequest = async () => {
    if (!order) return;
    setSendingRequest(true);
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/service-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ type: requestType, details: requestDetails.trim() || undefined }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to send request');
      setOrder(current => current ? { ...current, service_requests: [payload, ...(current.service_requests || [])] } : current);
      setRequestDetails(''); setShowRequest(false);
      toast.success('Request sent to the restaurant crew');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to send request'); }
    finally { setSendingRequest(false); }
  };

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
  const digitalMenuHref = order.merchants?.slug
    ? `/merchants/${order.merchants.slug}${order.order_type === 'dine_in' && order.table_number ? `?table=${encodeURIComponent(order.table_number)}` : ''}`
    : undefined;
  const dineInServingStatus = ['ready', 'bill_out', 'payment_pending', 'completed'].includes(order.status)
    ? 'Served'
    : 'Preparing';
  const savedTotalDiners = Number(order.discount_details?.totalDiners || 0);
  const savedEligibleDiners = Number(order.discount_details?.eligibleDiners || 0);
  const eligibleShare = savedTotalDiners > 0 ? subtotal * (savedEligibleDiners / savedTotalDiners) : 0;
  const vatExclusiveEligibleShare = eligibleShare / 1.12;
  const vatExemption = Number(order.discount_details?.vatExemption ?? (eligibleShare ? eligibleShare - vatExclusiveEligibleShare : 0));
  const scPwdDiscount = Number(order.discount_details?.scPwdDiscount ?? (eligibleShare ? vatExclusiveEligibleShare * 0.2 : 0));
  const savedDiscount = Number(order.discount_amount || 0);

  const chooseBillOutPayment = async (method: 'manual' | 'gcash' | 'maya' | 'card') => {
    setStartingPayment(method);
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/checkout-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ method }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to start payment');
      if (body.payment_url) return window.location.assign(body.payment_url);
      setOrder(body);
      if (method === 'manual') toast.success('Manual payment requested. Please wait for the crew to process your payment.');
    } catch (paymentError) {
      toast.error(paymentError instanceof Error ? paymentError.message : 'Unable to start payment');
    } finally {
      setStartingPayment(null);
    }
  };

  const startQrphPayment = async () => {
    setStartingPayment('qrph');
    setQrphStatus('CREATING');
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/paycools-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to start QRPH payment');
      setQrphPayment(body);
      setQrphStatus(body.status || 'PENDING');
    } catch (paymentError) {
      setQrphStatus('FAILED');
      toast.error(paymentError instanceof Error ? paymentError.message : 'Unable to start QRPH payment');
    } finally {
      setStartingPayment(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 pb-24">
      {/* Top bar */}
      <div className="flex items-center gap-3">
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
        <button onClick={() => void manualRefresh()} disabled={refreshing} title="Refresh order" aria-label="Refresh order" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 disabled:opacity-50">
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {justPlaced && <OrderFlowStepper currentStep={3} menuHref={digitalMenuHref} />}

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
      {order.order_type !== 'dine_in' && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
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
      </div>}

      {/* Items */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-900">Food items ({order.order_items.reduce((s, it) => s + it.quantity, 0)})</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {order.order_items.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No items recorded.</p>
          ) : (
            order.order_items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 py-3"
              >
                <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                  {item.image_url ? <img src={item.image_url} alt={item.product_name} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-lg">🍽️</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.product_name}
                  </p>
                  {item.variant_name && <p className="truncate text-xs text-gray-500">{item.variant_name}</p>}
                  <p className="text-xs text-gray-500">
                    {item.quantity} × ₱{Number(item.price).toFixed(2)}
                  </p>
                  {order.order_type === 'dine_in' && (
                    <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${item.status === 'served' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {item.status === 'served' ? 'Served' : 'Preparing'}
                    </span>
                  )}
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
          {order.discount_type === 'sc_pwd' && savedDiscount > 0 && (
            <div className="my-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
              <p className="font-black text-emerald-900">SC/PWD computation</p>
              <div className="mt-2 space-y-1.5 text-emerald-900">
                <div className="flex justify-between gap-3"><span>Eligible diners</span><b>{savedEligibleDiners} of {savedTotalDiners} pax</b></div>
                <div className="flex justify-between gap-3"><span>Eligible share</span><span>₱{subtotal.toFixed(2)} × {savedEligibleDiners}/{savedTotalDiners} = <b>₱{eligibleShare.toFixed(2)}</b></span></div>
                <div className="flex justify-between gap-3"><span>VAT-exclusive eligible sale</span><span>₱{eligibleShare.toFixed(2)} ÷ 1.12 = <b>₱{vatExclusiveEligibleShare.toFixed(2)}</b></span></div>
                <div className="flex justify-between gap-3"><span>Less: VAT exemption</span><b>−₱{vatExemption.toFixed(2)}</b></div>
                <div className="flex justify-between gap-3"><span>Less: 20% SC/PWD discount</span><b>−₱{scPwdDiscount.toFixed(2)}</b></div>
                <div className="flex justify-between gap-3 border-t border-emerald-200 pt-1.5"><span>Total reduction</span><b>−₱{savedDiscount.toFixed(2)}</b></div>
              </div>
            </div>
          )}
          {order.discount_type === 'voucher' && savedDiscount > 0 && <div className="my-3 flex justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><span>Voucher discount</span><b>−₱{savedDiscount.toFixed(2)}</b></div>}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 font-bold text-gray-900">
            <span>Total</span>
            <span className="text-[#DB0002] text-lg">
              ₱{Number(order.total_amount).toFixed(2)}
            </span>
          </div>
        </div>
        {order.order_type === 'dine_in' && digitalMenuHref && (
          <div className={`mt-4 grid gap-2 ${!['bill_out', 'payment_pending', 'completed'].includes(order.status) ? 'sm:grid-cols-2' : ''}`}>
            {!['bill_out', 'payment_pending', 'completed'].includes(order.status) && <Link href={digitalMenuHref} className="flex min-h-11 items-center justify-center rounded-xl border-2 border-[#DB0002] text-sm font-bold text-[#DB0002] transition-colors hover:bg-red-50">+ Add more items</Link>}
            {order.status === 'bill_out' ? (
              <button disabled className="min-h-11 rounded-xl bg-purple-100 text-sm font-bold text-purple-700">Bill-out requested</button>
            ) : order.status === 'payment_pending' ? (
              <button disabled className="min-h-11 rounded-xl bg-purple-100 text-sm font-bold text-purple-700">{order.payment_method === 'cash' ? 'Manual payment requested · Wait for crew' : 'Bill-out confirmed · Select payment below'}</button>
            ) : order.status === 'completed' ? (
              <button disabled className="min-h-11 rounded-xl bg-green-100 text-sm font-bold text-green-700">Transaction complete</button>
            ) : dineInServingStatus === 'Served' ? (
              <Link href={`/customer/orders/${order.id}/bill-out`} className="flex min-h-11 items-center justify-center rounded-xl bg-[#DB0002] text-sm font-bold text-white">Request bill-out</Link>
            ) : (
              <button disabled className="min-h-11 rounded-xl bg-gray-200 text-sm font-bold text-gray-500">Bill-out available when served</button>
            )}
          </div>
        )}
      </div>

      {order.order_type === 'dine_in' && !['bill_out', 'payment_pending', 'completed', 'cancelled'].includes(order.status) && (
        <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-black">Need table service?</h2><p className="mt-0.5 text-xs text-gray-500">Send a request directly to the restaurant crew.</p></div><button onClick={() => setShowRequest(value => !value)} className="min-h-10 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">{showRequest ? 'Close' : '+ Request'}</button></div>
          {showRequest && <div className="mt-4 space-y-3 rounded-xl bg-blue-50 p-3"><div className="grid grid-cols-2 gap-2">{[
            ['spoon_fork','Spoon & fork'],['water_cold','Cold water'],['water_hot','Hot water'],['condiments','Condiments'],['plates_saucers','Plates / saucers'],['other','Other']
          ].map(([value,label]) => <button key={value} onClick={() => setRequestType(value)} className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${requestType === value ? 'border-blue-600 bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>{label}</button>)}</div><textarea value={requestDetails} onChange={event => setRequestDetails(event.target.value.slice(0,250))} placeholder={requestType === 'other' ? 'Describe what you need (required)' : 'Additional details (optional)'} rows={2} className="w-full rounded-xl border bg-white px-3 py-2 text-sm"/><button disabled={sendingRequest || (requestType === 'other' && !requestDetails.trim())} onClick={() => void submitServiceRequest()} className="min-h-11 w-full rounded-xl bg-[#DB0002] text-sm font-black text-white disabled:bg-gray-300">{sendingRequest ? 'Sending…' : 'Send request'}</button></div>}
          {!!order.service_requests?.length && <div className="mt-4 space-y-2"><p className="text-[10px] font-black uppercase tracking-wide text-gray-400">Recent requests</p>{order.service_requests.slice(0,4).map(request => <div key={request.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-xs"><div><p className="font-bold">{{spoon_fork:'Spoon & fork',water_cold:'Cold water',water_hot:'Hot water',condiments:'Condiments',plates_saucers:'Plates / saucers',other:'Other'}[request.type] || request.type}</p>{request.details && <p className="text-gray-500">{request.details}</p>}</div><span className={`rounded-full px-2 py-1 font-bold ${request.status === 'completed' ? 'bg-green-100 text-green-700' : request.status === 'assigned' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>{request.status === 'assigned' && request.assigned_staff_name ? `Assigned · ${request.assigned_staff_name}` : request.status}</span></div>)}</div>}
        </section>
      )}

      {order.order_type === 'dine_in' && order.status === 'payment_pending' && (
        <section className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm">
          <h2 className="font-black text-purple-950">{order.payment_method === 'cash' ? 'Manual payment requested' : 'Choose payment'}</h2>
          <p className="mt-1 text-xs text-purple-700">{order.payment_method === 'cash' ? 'Please wait for a crew member to process and confirm your payment. This page will update automatically.' : 'The merchant confirmed your bill. Pay manually at the counter or use an online gateway.'}</p>
          {order.payment_method !== 'cash' && <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={startingPayment !== null} onClick={() => void chooseBillOutPayment('manual')} className="min-h-11 rounded-xl border border-purple-300 bg-white text-xs font-bold text-purple-800">Manual payment</button>
            <button disabled={startingPayment !== null} onClick={() => void chooseBillOutPayment('gcash')} className="min-h-11 rounded-xl bg-blue-600 text-xs font-bold text-white">GCash</button>
            <button disabled={startingPayment !== null} onClick={() => void chooseBillOutPayment('maya')} className="min-h-11 rounded-xl bg-green-600 text-xs font-bold text-white">Maya</button>
            <button disabled={startingPayment !== null} onClick={() => void chooseBillOutPayment('card')} className="min-h-11 rounded-xl bg-slate-900 text-xs font-bold text-white">Credit / Debit Card</button>
            {qrphAvailable && <button disabled={startingPayment !== null} onClick={() => void startQrphPayment()} className="min-h-11 rounded-xl bg-[#DB0002] text-xs font-bold text-white">Pay with QRPH</button>}
          </div>}
          {qrphStatus && (
            <div className="mt-4">
              <PayWithQrph
                payment={qrphPayment}
                status={qrphStatus}
                onClose={qrphStatus === 'FAILED' || qrphStatus === 'EXPIRED' ? () => { setQrphPayment(null); setQrphStatus(null); } : undefined}
              />
            </div>
          )}
          {order.payment_method === 'cash' && <div className="mt-3 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-900"><span className="size-3 animate-pulse rounded-full bg-blue-600"/><p className="text-xs font-bold">Waiting for crew to complete the transaction…</p></div>}
        </section>
      )}

      {order.order_type !== 'dine_in' && order.payment_method === 'qrph' && order.payment_status !== 'paid' && qrphStatus && (
        <PayWithQrph
          payment={qrphPayment}
          status={qrphStatus}
          onClose={qrphStatus === 'FAILED' || qrphStatus === 'EXPIRED' ? () => { setQrphPayment(null); setQrphStatus(null); } : undefined}
        />
      )}

      {order.order_type === 'dine_in' && order.status === 'completed' && <section className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center shadow-sm"><div className="mx-auto grid size-12 place-items-center rounded-full bg-green-500 text-2xl text-white">✓</div><h2 className="mt-3 font-black text-green-950">Transaction complete</h2><p className="mt-1 text-xs text-green-700">Your payment has been processed. Your e-receipt was saved to your profile.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Link href={`/customer/e-receipts?order=${order.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green-600 px-4 text-sm font-black text-white">Close and view e-receipt</Link><Link href={`/customer/orders/${order.id}/review`} className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-green-600 bg-white px-4 text-sm font-black text-green-700">Submit a review</Link></div></section>}

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
