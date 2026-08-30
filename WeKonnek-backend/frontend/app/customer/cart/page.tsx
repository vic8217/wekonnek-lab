'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getActiveCartMerchantIds,
  getCart,
  updateQuantity,
  removeFromCart,
  onCartChange,
  type CartItem,
} from '@/lib/cart';
import { merchantsApi } from '@/lib/api';
import { getToken } from '@/hooks/use-auth';
import { publicAssetUrl } from '@/lib/public-asset-url';

interface MerchantCart {
  merchantId: string;
  merchantName: string;
  merchantSlug?: string;
  logoUrl?: string;
  items: CartItem[];
  subtotal: number;
}

type PendingQrphPayment = {
  orderId: number;
  orderCode: string;
  merchantName: string;
  amount: number;
  status: 'PENDING' | 'FAILED' | 'EXPIRED';
};

type OrderForRecovery = {
  id: number;
  order_code?: string;
  orderCode?: string;
  payment_method?: string;
  paymentMethod?: string;
  payment_status?: string;
  paymentStatus?: string;
  status?: string;
  merchants?: { name?: string };
  merchant?: { name?: string };
};

export default function CartPage() {
  const router = useRouter();
  const [carts, setCarts] = useState<MerchantCart[]>([]);
  const [pendingPayments, setPendingPayments] = useState<PendingQrphPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);

  const loadCarts = useCallback(async () => {
    const ids = getActiveCartMerchantIds();
    const result = await Promise.all(
      ids.map(async (id) => {
        const items = getCart(id);
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        try {
          const merchant = await merchantsApi.getById(Number(id));
          return {
            merchantId: id,
            merchantName: merchant.name,
            merchantSlug: merchant.slug,
            logoUrl: publicAssetUrl(merchant.logoUrl),
            items,
            subtotal,
          } as MerchantCart;
        } catch {
          // Ignore obsolete/sample carts that are not tied to a real merchant.
          return null;
        }
      }),
    );
    setCarts(
      result.filter(
        (cart): cart is MerchantCart => Boolean(cart && cart.items.length > 0),
      ),
    );
    setLoading(false);
  }, []);

  const loadPendingPayments = useCallback(async () => {
    const token = getToken();
    if (!token) return setPendingPayments([]);
    try {
      const ordersResponse = await fetch('/api/backend/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      if (!ordersResponse.ok) throw new Error('Unable to load order recovery');
      const rows = await ordersResponse.json() as OrderForRecovery[];
      const candidates = (Array.isArray(rows) ? rows : []).filter(order => {
        const method = order.payment_method || order.paymentMethod;
        const paymentStatus = (order.payment_status || order.paymentStatus || '').toLowerCase();
        return method === 'qrph' && paymentStatus !== 'paid' && order.status !== 'cancelled';
      });
      const recovered = await Promise.all(candidates.map(async order => {
        const response = await fetch(`/api/backend/orders/${order.id}/paycools-payment`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
        });
        if (!response.ok) return null;
        const payment = await response.json() as { amount: number; status: PendingQrphPayment['status'] };
        if (!['PENDING', 'FAILED', 'EXPIRED'].includes(payment.status)) return null;
        return {
          orderId: order.id,
          orderCode: order.order_code || order.orderCode || `#${order.id}`,
          merchantName: order.merchants?.name || order.merchant?.name || 'Merchant',
          amount: Number(payment.amount),
          status: payment.status,
        };
      }));
      setPendingPayments(recovered.filter((payment): payment is PendingQrphPayment => payment !== null));
    } catch {
      // Recovery is additive; retain the normal cart experience if it cannot load.
      setPendingPayments([]);
    }
  }, []);

  useEffect(() => {
    loadCarts();
    void loadPendingPayments();
    return onCartChange(() => loadCarts());
  }, [loadCarts, loadPendingPayments]);

  const cancelPendingPayment = async (orderId: number) => {
    if (!window.confirm('Cancel this QRPH transaction? Your order will remain in My Orders.')) return;
    const token = getToken();
    if (!token) return router.push('/auth/login');
    setCancellingOrderId(orderId);
    try {
      const response = await fetch(`/api/backend/orders/${orderId}/paycools-payment/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to cancel this payment');
      await loadPendingPayments();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to cancel this payment');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const changeQty = (
    merchantId: string,
    productId: number,
    variantId: number | undefined,
    delta: number,
  ) => {
    const current = getCart(merchantId).find(
      (item) =>
        item.product_id === productId &&
        (item.variant_id ?? null) === (variantId ?? null),
    );
    if (!current) return;
    updateQuantity(merchantId, productId, current.quantity + delta, variantId);
  };

  const remove = (merchantId: string, productId: number, variantId?: number) => {
    removeFromCart(merchantId, productId, variantId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalItems = carts.reduce(
    (s, c) => s + c.items.reduce((a, i) => a + i.quantity, 0),
    0,
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-28">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg" title="Go back">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900">My Cart</h1>
        {totalItems > 0 && (
          <span className="ml-1 text-sm text-gray-400">({totalItems} items)</span>
        )}
      </div>

      {carts.length === 0 ? (
        <div className="space-y-5">
          {pendingPayments.map(payment => (
            <section key={payment.orderId} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <p className="text-sm font-black text-amber-900">{payment.status === 'PENDING' ? 'Payment pending' : payment.status === 'EXPIRED' ? 'Payment expired' : 'Payment needs attention'}</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">{payment.merchantName}</h2>
              <div className="mt-3 space-y-1 text-sm text-slate-700"><p>Order: <b>{payment.orderCode}</b></p><p>Amount: <b>₱{payment.amount.toFixed(2)}</b></p><p>Payment method: <b>QRPH</b></p><p>Status: <b>{payment.status === 'PENDING' ? 'Awaiting Payment' : payment.status === 'EXPIRED' ? 'Expired' : 'Retry available on order details'}</b></p></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <Link href={`/customer/orders/${payment.orderId}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#DB0002] px-4 text-sm font-bold text-white">{payment.status === 'PENDING' ? 'Resume Payment' : 'View Payment'}</Link>
                <Link href={`/customer/orders/${payment.orderId}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800">View Order</Link>
                {payment.status === 'PENDING' && <button type="button" disabled={cancellingOrderId === payment.orderId} onClick={() => void cancelPendingPayment(payment.orderId)} className="min-h-11 rounded-xl border border-red-300 bg-white px-4 text-sm font-bold text-red-700 disabled:opacity-60">{cancellingOrderId === payment.orderId ? 'Cancelling...' : 'Cancel Transaction'}</button>}
              </div>
            </section>
          ))}
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <div className="text-5xl mb-3">🛒</div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 mb-5">Browse local shops and add items to get started.</p>
          <Link
            href="/merchants"
            className="inline-block px-5 py-3 bg-[#DB0002] text-white rounded-xl font-semibold active:bg-[#B80002] transition-colors"
          >
            Browse Shops
          </Link>
        </div></div>
      ) : (
        <div className="space-y-5">
          {carts.length > 1 && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              You have items from {carts.length} shops. Orders are placed per shop.
            </p>
          )}

          {carts.map((cart) => (
            <div
              key={cart.merchantId}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
            >
              {/* Merchant header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {cart.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cart.logoUrl} alt={cart.merchantName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg">🏪</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {cart.merchantSlug ? (
                    <Link href={`/merchants/${cart.merchantSlug}`} className="font-semibold text-gray-900 hover:text-[#DB0002] truncate block">
                      {cart.merchantName}
                    </Link>
                  ) : (
                    <span className="font-semibold text-gray-900 truncate block">{cart.merchantName}</span>
                  )}
                </div>
              </div>

              {/* Items */}
              <div className="divide-y divide-gray-50">
                {cart.items.map((item) => (
                  <div key={`${item.product_id}:${item.variant_id ?? 'base'}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {item.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image_url} alt={item.product_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg">🍽️</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">{item.product_name}</h3>
                      {item.variant_name && (
                        <p className="text-xs font-medium text-gray-500">{item.variant_name}</p>
                      )}
                      <p className="text-xs text-gray-400">₱{item.price.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => changeQty(cart.merchantId, item.product_id, item.variant_id, -1)}
                        className="w-7 h-7 border border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-500"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(cart.merchantId, item.product_id, item.variant_id, 1)}
                        className="w-7 h-7 bg-[#DB0002] text-white rounded-lg flex items-center justify-center text-sm"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => remove(cart.merchantId, item.product_id, item.variant_id)}
                      className="p-1 text-gray-300 hover:text-red-500"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <div className="text-sm">
                  <span className="text-gray-500">Subtotal: </span>
                  <span className="font-bold text-gray-900">₱{cart.subtotal.toFixed(2)}</span>
                </div>
                <button
                  onClick={() => router.push(`/customer/checkout?merchant=${cart.merchantId}`)}
                  className="px-5 py-2.5 bg-[#DB0002] text-white rounded-xl font-semibold text-sm active:bg-[#B80002] transition-colors"
                >
                  Checkout
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
