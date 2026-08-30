'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, getToken, setAuth, type AuthUser } from '@/hooks/use-auth';
import { calculateDeliveryFee, getAllBarangays, DeliveryFeeResult } from '@/lib/delivery-zones';
import toast from 'react-hot-toast';
import OrderFlowStepper from '@/components/OrderFlowStepper';
import {
  getCart,
  setCart as persistCart,
  clearCart,
  onCartChange,
  type CartItem,
} from '@/lib/cart';
import PayWithQrph, { type PayCoolsPaymentDto } from '@/components/PayWithQrph';

// Authentication always uses the same-origin proxy so it shares the exact
// customer session scope used by the main login page and navigation.
const API = '';

interface MerchantInfo {
  id: number;
  name: string;
  slug: string;
  logo_url?: string | null;
  is_verified?: boolean;
  address: string;
  city: string;
  delivery_zone_id: number | null;
  barangay: string | null;
  branches?: Array<{ id: number; isDefault?: boolean; isActive?: boolean; is_active?: boolean }>;
}

interface BarangayOption {
  area_name: string;
  zone_name: string;
  city: string;
}

function CheckoutAuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { refreshAuth } = useAuth();
  const [mode, setMode] = useState<'signin' | 'phone'>('signin');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Invalid credentials');

      const { access_token, user: apiUser } = body;
      const authUser: AuthUser = {
        id: apiUser.id,
        email: apiUser.email ?? undefined,
        phone: apiUser.phone ?? undefined,
        firstName: apiUser.firstName ?? apiUser.first_name ?? null,
        lastName: apiUser.lastName ?? apiUser.last_name ?? null,
        role: apiUser.role ?? apiUser.user_type ?? 'customer',
        userType: (apiUser.role ?? apiUser.user_type ?? 'customer') as AuthUser['userType'],
      };
      setAuth(access_token, authUser);
      await refreshAuth();
      toast.success('Signed in successfully!');
      onAuthenticated();
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sign in');
      toast.error(err.message || 'Failed to sign in');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!phone.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to send OTP');
      }
      setOtpSent(true);
      toast.success('OTP sent to your phone!');
    } catch (err: any) {
      setAuthError(err.message || 'Failed to send OTP');
      toast.error(err.message || 'Failed to send OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otp }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Invalid OTP');

      const { access_token, user: apiUser } = body;
      const authUser: AuthUser = {
        id: apiUser.id,
        email: apiUser.email ?? undefined,
        phone: apiUser.phone ?? undefined,
        firstName: apiUser.firstName ?? apiUser.first_name ?? null,
        lastName: apiUser.lastName ?? apiUser.last_name ?? null,
        role: apiUser.role ?? apiUser.user_type ?? 'customer',
        userType: (apiUser.role ?? apiUser.user_type ?? 'customer') as AuthUser['userType'],
      };
      setAuth(access_token, authUser);
      await refreshAuth();
      toast.success('Signed in successfully!');
      onAuthenticated();
    } catch (err: any) {
      setAuthError(err.message || 'Invalid OTP');
      toast.error(err.message || 'Invalid OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Sign in to complete your order</h2>
          <p className="text-sm text-gray-500 mt-1">Your cart items are saved and ready to checkout</p>
        </div>

        {/* OTP is registration-only; checkout accepts the established account password. */}
        <div className="hidden bg-gray-100 rounded-xl p-1 mb-5">
          <button
            onClick={() => { setMode('signin'); setAuthError(null); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mode === 'signin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Email
          </button>
          <button
            onClick={() => { setMode('phone'); setAuthError(null); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mode === 'phone' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Phone OTP
          </button>
        </div>

        {authError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{authError}</div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div>
              <label htmlFor="checkout-identifier" className="block text-sm font-medium text-gray-700 mb-1">
                Email or mobile number
              </label>
              <input
                id="checkout-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                inputMode="text"
                autoComplete="username"
                placeholder="juan@example.com or 0917 123 4567"
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-[#DB0002] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors"
            >
              {authLoading ? 'Signing in...' : 'Sign In & Checkout'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+63 9XX XXX XXXX"
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
                {!otpSent && (
                  <button
                    onClick={handleSendOtp}
                    disabled={authLoading || !phone.trim()}
                    className="px-4 py-3 bg-[#DB0002] text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors whitespace-nowrap"
                  >
                    {authLoading ? '...' : 'Send OTP'}
                  </button>
                )}
              </div>
            </div>
            {otpSent && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    maxLength={6}
                    required
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-center tracking-widest font-mono focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 bg-[#DB0002] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors"
                >
                  {authLoading ? 'Verifying...' : 'Verify & Checkout'}
                </button>
                <button
                  type="button"
                  onClick={() => { setOtpSent(false); setOtp(''); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700"
                >
                  Resend OTP
                </button>
              </form>
            )}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Don&apos;t have an account?{' '}
            <a href="/auth/login" className="text-[#DB0002] font-semibold hover:underline">Register here</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: authUser, refreshAuth } = useAuth();
  const merchantId = searchParams.get('merchant');
  // Table tag forwarded from a scanned dine-in QR code (e.g. "Table 5").
  const tableParam = searchParams.get('table');
  const hasEstablishedDineIn = Boolean(tableParam);
  const [authGatePassed, setAuthGatePassed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'delivery' | 'pickup' | 'dine_in'>(
    tableParam ? 'dine_in' : 'delivery',
  );
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [customerBarangay, setCustomerBarangay] = useState('');
  const [barangaySearch, setBarangaySearch] = useState('');
  const [showBarangayList, setShowBarangayList] = useState(false);
  const [barangayOptions, setBarangayOptions] = useState<BarangayOption[]>([]);
  const [tableNumber, setTableNumber] = useState(tableParam ?? '');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'gcash' | 'maya' | 'card' | 'qrph'>('cod');
  const [qrphAvailable, setQrphAvailable] = useState(false);
  const [qrphPayment, setQrphPayment] = useState<PayCoolsPaymentDto | null>(null);
  const [qrphStatus, setQrphStatus] = useState<'CREATING' | PayCoolsPaymentDto['status'] | null>(null);
  const [qrphOrderId, setQrphOrderId] = useState<number | null>(null);

  // Map a chosen payment method to the backend gateway that fulfils it.
  const gatewayFor = (method: string): string | undefined => {
    if (method === 'maya') return 'maya';
    if (method === 'gcash' || method === 'card') return 'xendit';
    return undefined; // COD / QRPH
  };

  const checkoutPaymentMethods = [
    { value: 'cod', label: 'Cash on Delivery / Counter', icon: '💵' },
    { value: 'gcash', label: 'GCash', icon: '📱' },
    { value: 'maya', label: 'Maya', icon: '🟢' },
    { value: 'card', label: 'Credit / Debit Card', icon: '💳' },
    ...(qrphAvailable
      ? [{ value: 'qrph', label: 'Pay with QRPH', icon: '▣', hint: 'Scan the QR code using your supported banking or e-wallet app.' }]
      : []),
  ];

  // Zone-based delivery fee
  const [deliveryFeeResult, setDeliveryFeeResult] = useState<DeliveryFeeResult>({
    fee: 49.00,
    type: 'unknown',
    merchantZone: null,
    customerZone: null,
    label: 'Standard delivery',
  });
  const [calculatingFee, setCalculatingFee] = useState(false);

  useEffect(() => {
    loadCheckoutData();
    loadBarangays();
  }, [merchantId]);

  // Re-sync cart if it changes in another tab or page
  useEffect(() => {
    if (!merchantId) return;
    return onCartChange(() => {
      setCartItems(getCart(merchantId));
    });
  }, [merchantId]);

  const loadBarangays = async () => {
    const data = await getAllBarangays();
    setBarangayOptions(data);
  };

  const loadCheckoutData = async () => {
    try {
      if (merchantId) {
        setCartItems(getCart(merchantId));
      }

      if (merchantId) {
        try {
          const res = await fetch(`/api/backend/merchants/${merchantId}`);
          if (res.ok) {
            const data = await res.json();
            if (data) setMerchant(data);
          }
        } catch { /* non-critical */ }
      }

      const token = await getToken();
      if (token) {
        try {
          const res = await fetch(`/api/backend/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const profile = await res.json();
            if (profile?.address) setDeliveryAddress(profile.address);
          }
        } catch { /* non-critical */ }
      }
    } catch (error) {
      console.error('Error loading checkout data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Recalculate fee when barangay or merchant changes
  const recalculateFee = useCallback(async () => {
    if (orderType !== 'delivery' || !merchant?.delivery_zone_id || !customerBarangay) {
      setDeliveryFeeResult({
        fee: orderType === 'delivery' ? 49.00 : 0,
        type: 'unknown',
        merchantZone: null,
        customerZone: null,
        label: orderType === 'delivery' ? 'Standard delivery' : 'No delivery fee',
      });
      return;
    }

    setCalculatingFee(true);
    try {
      const result = await calculateDeliveryFee(merchant.delivery_zone_id, customerBarangay);
      setDeliveryFeeResult(result);
    } catch (error) {
      console.error('Error calculating fee:', error);
    } finally {
      setCalculatingFee(false);
    }
  }, [merchant, customerBarangay, orderType]);

  useEffect(() => {
    recalculateFee();
  }, [recalculateFee]);

  useEffect(() => {
    if (!merchantId || orderType === 'dine_in') {
      setQrphAvailable(false);
      if (paymentMethod === 'qrph') setPaymentMethod('cod');
      return;
    }
    let cancelled = false;
    const loadAvailability = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(
          `/api/backend/payments/paycools/availability?merchantId=${encodeURIComponent(merchantId)}&orderType=${encodeURIComponent(orderType)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const available = Boolean(res.ok && body.available);
        setQrphAvailable(available);
        if (!available && paymentMethod === 'qrph') setPaymentMethod('cod');
      } catch {
        if (!cancelled) {
          setQrphAvailable(false);
          if (paymentMethod === 'qrph') setPaymentMethod('cod');
        }
      }
    };
    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [merchantId, orderType, paymentMethod]);

  useEffect(() => {
    if (!qrphOrderId || !qrphPayment?.paymentId) return;
    if (qrphStatus === 'PAID' || qrphStatus === 'FAILED' || qrphStatus === 'EXPIRED') return;
    let cancelled = false;
    const poll = async () => {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/backend/orders/${qrphOrderId}/paycools-payment`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as PayCoolsPaymentDto;
      if (cancelled) return;
      setQrphPayment(data);
      setQrphStatus(data.status);
      if (data.status === 'PAID') {
        router.replace(`/customer/orders/${qrphOrderId}?placed=1`);
      }
    };
    const interval = window.setInterval(() => { void poll(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [qrphOrderId, qrphPayment?.paymentId, qrphStatus, router]);

  const retryQrph = async () => {
    if (!qrphOrderId) return;
    setQrphStatus('CREATING');
    try {
      const token = await getToken();
      const res = await fetch(`/api/backend/orders/${qrphOrderId}/paycools-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payment = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payment.message || 'Unable to create a new QR code');
      setQrphPayment(payment);
      setQrphStatus(payment.status || 'PENDING');
    } catch (error) {
      setQrphStatus('FAILED');
      toast.error(error instanceof Error ? error.message : 'Unable to create a new QR code');
    }
  };

  const deliveryFee = orderType === 'delivery' ? deliveryFeeResult.fee : 0;
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + deliveryFee;
  const digitalMenuHref = merchant?.slug
    ? `/merchants/${merchant.slug}${tableParam ? `?table=${encodeURIComponent(tableParam)}` : ''}`
    : '/customer/scan';

  const filteredBarangays = barangaySearch.length > 0
    ? barangayOptions.filter(b =>
        b.area_name.toLowerCase().includes(barangaySearch.toLowerCase()) ||
        b.city.toLowerCase().includes(barangaySearch.toLowerCase())
      ).slice(0, 10)
    : [];

  const selectBarangay = (b: BarangayOption) => {
    setCustomerBarangay(b.area_name);
    setBarangaySearch(b.area_name);
    setShowBarangayList(false);
  };

  const updateQuantity = (productId: number, delta: number) => {
    if (!merchantId) return;
    setCartItems(prev => {
      const updated = prev.map(item =>
        item.product_id === productId
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item
      );
      persistCart(merchantId, updated);
      return updated;
    });
  };

  const removeItem = (productId: number) => {
    if (!merchantId) return;
    setCartItems(prev => {
      const updated = prev.filter(item => item.product_id !== productId);
      persistCart(merchantId, updated);
      return updated;
    });
  };

  const placeOrder = async () => {
    if (cartItems.length === 0) { alert('Your cart is empty'); return; }
    if (orderType === 'delivery' && !deliveryAddress.trim()) { alert('Please enter a delivery address'); return; }
    if (orderType === 'dine_in' && !tableNumber.trim()) { alert('Please enter your table number'); return; }

    try {
      setPlacing(true);
      const token = await getToken();
      if (!token) { router.push('/auth/login'); return; }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const orderItems = cartItems.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        variant_id: item.variant_id,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
      }));
      const cartShopId = cartItems.find(item => item.shop_id)?.shop_id;
      const availableBranches = merchant?.branches?.filter(
        branch => branch.isActive !== false && branch.is_active !== false,
      ) || [];
      const checkoutShopId = availableBranches.find(branch => branch.id === cartShopId)?.id
        || availableBranches.find(branch => branch.isDefault)?.id
        || availableBranches[0]?.id
        || (!merchant?.branches?.length ? cartShopId : undefined);

      if (!checkoutShopId) {
        toast.error('This merchant has no available shop for the order. Return to the digital menu and try again.');
        return;
      }

      const res = await fetch(`/api/backend/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          merchant_id: parseInt(merchantId || '0'),
          shop_id: checkoutShopId,
          order_type: orderType,
          total_amount: total,
          delivery_address: orderType === 'delivery' ? deliveryAddress : null,
          delivery_fee: deliveryFee,
          delivery_zone_id: orderType === 'delivery' ? (deliveryFeeResult.merchantZone?.id || null) : null,
          delivery_zone_name: orderType === 'delivery' ? (deliveryFeeResult.merchantZone?.name || null) : null,
          customer_barangay: orderType === 'delivery' ? customerBarangay : null,
          table_number: orderType === 'dine_in' ? tableNumber : null,
          notes: notes || null,
          // Dine-in payment is collected later when the merchant moves the
          // ticket to Bill Out; order placement must never launch a gateway.
          payment_method: orderType === 'dine_in' ? 'cod' : paymentMethod,
          gateway: orderType === 'dine_in' ? undefined : gatewayFor(paymentMethod),
          items: orderItems,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = Array.isArray(err.message) ? err.message.join(', ') : err.message;
        toast.error(message || 'Failed to place order. Please try again.');
        return;
      }

      const order = await res.json();

      if (merchantId) clearCart(merchantId);

      if (orderType !== 'dine_in' && paymentMethod === 'qrph') {
        setQrphOrderId(order.id);
        setQrphStatus('CREATING');
        const payRes = await fetch(`/api/backend/orders/${order.id}/paycools-payment`, {
          method: 'POST',
          headers,
        });
        const payment = await payRes.json().catch(() => ({}));
        if (!payRes.ok) {
          toast.error(payment.message || 'Order placed, but QRPH could not start. Open the order to retry.');
          router.replace(`/customer/orders/${order.id}?placed=1`);
          return;
        }
        setQrphPayment(payment);
        setQrphStatus(payment.status || 'PENDING');
        return;
      }

      // Online payment → send the customer to the gateway checkout page.
      if (order.payment_url) {
        window.location.href = order.payment_url;
        return;
      }

      if (order.payment_error) {
        alert(
          `Order placed, but online payment could not start (${order.payment_error}). You can pay via Cash on Delivery.`,
        );
      }

      router.replace(`/customer/orders/${order.id}?placed=1`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to place order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  // Delivery zone info badge
  const ZoneBadge = () => {
    if (orderType !== 'delivery') return null;
    if (!customerBarangay) return null;

    const colors = {
      same_zone: 'bg-green-50 text-green-700 border-green-200',
      cross_zone: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      cross_city: 'bg-red-50 text-red-700 border-red-200',
      unknown: 'bg-gray-50 text-gray-600 border-gray-200',
    };

    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${colors[deliveryFeeResult.type]}`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>{calculatingFee ? 'Calculating...' : deliveryFeeResult.label}</span>
        <span className="font-bold ml-auto">₱{deliveryFee.toFixed(2)}</span>
      </div>
    );
  };

  const isAuthenticated = authUser?.userType === 'customer' && Boolean(getToken());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated && !authGatePassed) {
    return (
      <CheckoutAuthGate onAuthenticated={() => setAuthGatePassed(true)} />
    );
  }

  return (
    <>
      {/* ========== MOBILE CHECKOUT ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Dine-in merchant header */}
        <div className="px-4 pt-3">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-4 text-white shadow-lg">
            <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px]" />
            <button onClick={() => router.push(digitalMenuHref)} className="relative z-10 mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-white/90 mobile-press" title="Back to digital menu">
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to digital menu
            </button>
            <div className="relative z-10 flex items-center gap-3">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-white bg-white text-xl font-black text-gray-500">
                {merchant?.logo_url ? <img src={merchant.logo_url} alt="" className="size-full object-cover" /> : merchant?.name?.charAt(0)}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-black">{merchant?.name || 'Review your order'}</h1>
                <p className="mt-1 text-xs text-white/80">Dine-in{tableParam ? ` · ${tableParam}` : ''}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3 mobile-scroll pb-64">
          <OrderFlowStepper currentStep={2} menuHref={digitalMenuHref} />
          {/* Order Type */}
          {!hasEstablishedDineIn && <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Order Type</h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'delivery', label: 'Delivery', icon: '🚚' },
                { value: 'pickup', label: 'Pick-up', icon: '🏪' },
                { value: 'dine_in', label: 'Dine-in', icon: '🍽️' },
              ].map((type) => (
                <button
                  key={type.value}
                  onClick={() => setOrderType(type.value as any)}
                  className={`py-3 rounded-xl text-center transition-all duration-200 mobile-press ${
                    orderType === type.value
                      ? 'bg-red-50 border-2 border-[#DB0002] shadow-sm'
                      : 'bg-gray-50 border-2 border-transparent'
                  }`}
                >
                  <span className="text-xl block mb-0.5">{type.icon}</span>
                  <span className="text-[11px] font-semibold text-gray-700">{type.label}</span>
                </button>
              ))}
            </div>
          </div>}

          {/* Delivery Address + Barangay */}
          {orderType === 'delivery' && (
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
              <h2 className="text-sm font-bold text-gray-900">Delivery Address</h2>

              {/* Barangay Selector */}
              <div className="relative">
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Barangay / Area</label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <input
                    type="text"
                    value={barangaySearch}
                    onChange={(e) => {
                      setBarangaySearch(e.target.value);
                      setShowBarangayList(true);
                      if (e.target.value === '') setCustomerBarangay('');
                    }}
                    onFocus={() => setShowBarangayList(true)}
                    placeholder="Search barangay (e.g. Binondo, Cubao)"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                {showBarangayList && filteredBarangays.length > 0 && (
                  <div className="absolute z-30 w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 max-h-48 overflow-y-auto">
                    {filteredBarangays.map((b, i) => (
                      <button
                        key={`${b.area_name}-${b.city}-${i}`}
                        onClick={() => selectBarangay(b)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
                      >
                        <div>
                          <span className="text-sm font-medium text-gray-900">{b.area_name}</span>
                          <span className="text-[10px] text-gray-400 block">{b.zone_name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400">{b.city}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Zone Info Badge */}
              <ZoneBadge />

              {/* Full Address */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Full Address</label>
                <textarea
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="House/Bldg no., Street, Landmark..."
                  rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Table Number */}
          {orderType === 'dine_in' && (
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 mb-2">Table Number</h2>
              <input
                type="text"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="e.g. Table 5"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
              {tableParam && (
                <p className="mt-1.5 text-[11px] text-green-700 flex items-center gap-1">
                  <span>✓</span> Detected from the QR code at your table
                </p>
              )}
            </div>
          )}

          {/* Cart Items */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 mb-3">
              Items ({cartItems.reduce((s, i) => s + i.quantity, 0)})
            </h2>
            {cartItems.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-6">Your cart is empty</p>
            ) : (
              <div className="space-y-3">
                {cartItems.map((item) => (
                  <div key={item.product_id} className="flex items-center gap-3">
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.product_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg">🍽️</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">{item.product_name}</h3>
                      {item.variant_name && <p className="truncate text-[11px] text-gray-500">{item.variant_name}</p>}
                      <p className="text-xs text-gray-400">₱{item.price.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => updateQuantity(item.product_id, -1)}
                        className="w-7 h-7 border border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-500 mobile-press"
                      >−</button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product_id, 1)}
                        className="w-7 h-7 bg-[#DB0002] text-white rounded-lg flex items-center justify-center text-sm mobile-press"
                      >+</button>
                    </div>
                    <button
                      onClick={() => removeItem(item.product_id)}
                      className="p-1 text-gray-300"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Notes</h2>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Special instructions..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
            />
          </div>

          {/* Payment Method */}
          {orderType !== 'dine_in' ? <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Payment</h2>
            <div className="space-y-2">
              {checkoutPaymentMethods.map((method: any) => (
                <button
                  key={method.value}
                  onClick={() => !method.badge && setPaymentMethod(method.value as any)}
                  disabled={!!method.badge}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                    paymentMethod === method.value
                      ? 'border-[#DB0002] bg-red-50'
                      : method.badge
                      ? 'border-gray-100 bg-gray-50 opacity-50'
                      : 'border-gray-100 active:bg-gray-50'
                  }`}
                >
                  <span className="text-lg">{method.icon}</span>
                  <span className="text-sm font-medium text-gray-700 flex-1">
                    {method.label}
                    {method.hint && <span className="block text-[11px] font-normal text-gray-500">{method.hint}</span>}
                  </span>
                  {method.badge && (
                    <span className="px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] rounded-full font-semibold">{method.badge}</span>
                  )}
                  {!method.badge && paymentMethod === method.value && (
                    <div className="w-5 h-5 bg-[#DB0002] rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div> : (
            <div className="rounded-2xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-900">
              <p className="font-bold">Payment at bill out</p>
              <p className="mt-1 text-xs text-purple-700">Place your order now. Payment will be collected when you request the bill.</p>
            </div>
          )}
        </div>

        {/* Fixed Bottom - Order Summary */}
        <div className="fixed bottom-20 left-0 right-0 z-30 border-t border-gray-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.08)] lg:hidden">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-1.5 text-sm">
              <span className="text-gray-500">Subtotal ({cartItems.reduce((s, i) => s + i.quantity, 0)} items)</span>
              <span className="text-gray-700">₱{subtotal.toFixed(2)}</span>
            </div>
            {orderType === 'delivery' && (
              <div className="flex items-center justify-between mb-1.5 text-sm">
                <span className="text-gray-500 flex items-center gap-1">
                  Delivery
                  {deliveryFeeResult.type !== 'unknown' && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                      deliveryFeeResult.type === 'same_zone' ? 'bg-green-100 text-green-700' :
                      deliveryFeeResult.type === 'cross_zone' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {deliveryFeeResult.type === 'same_zone' ? 'Same Zone' : deliveryFeeResult.type === 'cross_zone' ? 'Cross Zone' : 'Cross City'}
                    </span>
                  )}
                </span>
                <span className="text-gray-700">₱{deliveryFee.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <span className="text-base font-bold text-gray-900">Total</span>
              <span className="text-lg font-bold text-[#DB0002]">₱{total.toFixed(2)}</span>
            </div>
            <button
              onClick={placeOrder}
              disabled={placing || cartItems.length === 0}
              className="w-full py-3.5 bg-[#DB0002] text-white rounded-2xl font-bold text-base disabled:opacity-50 mobile-press active:bg-[#B80002] transition-colors"
            >
              {placing ? 'Placing Order...' : 'Confirm & Place Order'}
            </button>
          </div>
        </div>
      </div>

      {/* ========== DESKTOP CHECKOUT ========== */}
      <div className="hidden lg:block max-w-4xl mx-auto space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-7 text-white shadow-xl">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px]" />
          <button onClick={() => router.push(digitalMenuHref)} className="relative z-10 mb-5 inline-flex items-center gap-2 text-sm font-bold text-white/90" title="Back to digital menu">
            <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to digital menu
          </button>
          <div className="relative z-10 flex items-center gap-5">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-white text-3xl font-black text-gray-500">
              {merchant?.logo_url ? <img src={merchant.logo_url} alt="" className="size-full object-cover" /> : merchant?.name?.charAt(0)}
            </div>
            <div>
              <h1 className="text-2xl font-black">{merchant?.name || 'Review your order'}</h1>
              <p className="mt-1 text-sm text-white/80">Dine-in{tableParam ? ` · ${tableParam}` : ''}</p>
            </div>
          </div>
        </div>
        <OrderFlowStepper currentStep={2} menuHref={digitalMenuHref} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Order Type */}
            {!hasEstablishedDineIn && <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-4">Order Type</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'delivery', label: 'Delivery', icon: '🚚' },
                  { value: 'pickup', label: 'Pick-up', icon: '🏪' },
                  { value: 'dine_in', label: 'Dine-in', icon: '🍽️' },
                ].map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setOrderType(type.value as any)}
                    className={`p-4 rounded-lg border-2 text-center transition-colors ${
                      orderType === type.value ? 'border-[#DB0002] bg-red-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-2xl block mb-1">{type.icon}</span>
                    <span className="text-sm font-medium">{type.label}</span>
                  </button>
                ))}
              </div>
            </div>}

            {orderType === 'delivery' && (
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 space-y-4">
                <h2 className="font-bold text-gray-900">Delivery Address</h2>

                {/* Barangay Selector */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Barangay / Area</label>
                  <input
                    type="text"
                    value={barangaySearch}
                    onChange={(e) => {
                      setBarangaySearch(e.target.value);
                      setShowBarangayList(true);
                      if (e.target.value === '') setCustomerBarangay('');
                    }}
                    onFocus={() => setShowBarangayList(true)}
                    placeholder="Search barangay (e.g. Binondo, Cubao, Poblacion)"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                  />
                  {showBarangayList && filteredBarangays.length > 0 && (
                    <div className="absolute z-30 w-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-60 overflow-y-auto">
                      {filteredBarangays.map((b, i) => (
                        <button
                          key={`${b.area_name}-${b.city}-${i}`}
                          onClick={() => selectBarangay(b)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between border-b border-gray-100 last:border-0"
                        >
                          <div>
                            <span className="font-medium text-gray-900">{b.area_name}</span>
                            <span className="text-xs text-gray-400 block">{b.zone_name}</span>
                          </div>
                          <span className="text-xs text-gray-400">{b.city}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Zone Fee Info */}
                {customerBarangay && (
                  <div className={`flex items-center gap-3 p-3 rounded-lg border ${
                    deliveryFeeResult.type === 'same_zone' ? 'bg-green-50 border-green-200' :
                    deliveryFeeResult.type === 'cross_zone' ? 'bg-yellow-50 border-yellow-200' :
                    deliveryFeeResult.type === 'cross_city' ? 'bg-red-50 border-red-200' :
                    'bg-gray-50 border-gray-200'
                  }`}>
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{deliveryFeeResult.label}</p>
                      {deliveryFeeResult.customerZone && (
                        <p className="text-xs text-gray-500">Your zone: {deliveryFeeResult.customerZone.name}</p>
                      )}
                    </div>
                    <span className="text-lg font-bold text-gray-900">₱{deliveryFee.toFixed(2)}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Complete Address</label>
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="House/Bldg no., Street, Landmark..."
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {orderType === 'dine_in' && (
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <h2 className="font-bold text-gray-900 mb-4">Table Number</h2>
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="Enter your table number"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                />
                {tableParam && (
                  <p className="mt-2 text-xs text-green-700 flex items-center gap-1">
                    <span>✓</span> Detected from the QR code at your table
                  </p>
                )}
              </div>
            )}

            {/* Cart Items */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-4">Order Items ({cartItems.length})</h2>
              {cartItems.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Your cart is empty</p>
              ) : (
                <div className="space-y-4">
                  {cartItems.map((item) => (
                    <div key={item.product_id} className="flex items-center justify-between gap-4 border-b border-gray-100 pb-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                          {item.image_url ? <img src={item.image_url} alt={item.product_name} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xl">🍽️</div>}
                        </div>
                        <div className="min-w-0">
                        <h3 className="truncate font-medium text-gray-900">{item.product_name}</h3>
                        {item.variant_name && <p className="truncate text-xs text-gray-500">{item.variant_name}</p>}
                        <p className="text-sm text-gray-500">₱{item.price.toFixed(2)} each</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => updateQuantity(item.product_id, -1)} className="w-8 h-8 border border-gray-300 rounded-full flex items-center justify-center hover:bg-gray-100 text-sm">-</button>
                          <span className="w-8 text-center font-medium">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.product_id, 1)} className="w-8 h-8 border border-gray-300 rounded-full flex items-center justify-center hover:bg-gray-100 text-sm">+</button>
                        </div>
                        <p className="font-medium text-gray-900 w-20 text-right">₱{(item.price * item.quantity).toFixed(2)}</p>
                        <button onClick={() => removeItem(item.product_id)} className="text-red-500 hover:text-red-700 p-1" title="Remove item">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payment Method */}
            {orderType !== 'dine_in' ? <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h2 className="font-bold text-gray-900 mb-4">Payment Method</h2>
              <div className="space-y-3">
                {checkoutPaymentMethods.map((method: any) => (
                  <button
                    key={method.value}
                    onClick={() => !method.badge && setPaymentMethod(method.value as any)}
                    disabled={!!method.badge}
                    className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-colors text-left ${
                      paymentMethod === method.value
                        ? 'border-[#DB0002] bg-red-50'
                        : method.badge
                        ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xl">{method.icon}</span>
                    <span className="font-medium text-gray-900 flex-1">
                      {method.label}
                      {method.hint && <span className="block text-xs font-normal text-gray-500">{method.hint}</span>}
                    </span>
                    {method.badge && (
                      <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full">{method.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div> : (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 text-purple-900 shadow-sm">
                <h2 className="font-bold">Payment at bill out</h2>
                <p className="mt-1 text-sm text-purple-700">Confirm the order now. Payment will be collected when you request the bill.</p>
              </div>
            )}
          </div>

          {/* Right Column - Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 sticky top-6">
              <h2 className="font-bold text-gray-900 mb-4">Order Summary</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal ({cartItems.reduce((sum, i) => sum + i.quantity, 0)} items)</span>
                  <span>₱{subtotal.toFixed(2)}</span>
                </div>
                {orderType === 'delivery' && (
                  <div className="flex justify-between text-gray-600">
                    <span className="flex items-center gap-1.5">
                      Delivery Fee
                      {deliveryFeeResult.type !== 'unknown' && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                          deliveryFeeResult.type === 'same_zone' ? 'bg-green-100 text-green-700' :
                          deliveryFeeResult.type === 'cross_zone' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {deliveryFeeResult.type === 'same_zone' ? 'Same Zone' : deliveryFeeResult.type === 'cross_zone' ? 'Cross Zone' : 'Cross City'}
                        </span>
                      )}
                    </span>
                    <span>₱{deliveryFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-3 flex justify-between font-bold text-lg text-gray-900">
                  <span>Total</span>
                  <span className="text-[#DB0002]">₱{total.toFixed(2)}</span>
                </div>
              </div>
              <button
                onClick={placeOrder}
                disabled={placing || cartItems.length === 0}
                className="w-full mt-6 py-4 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {placing ? 'Placing Order...' : `Confirm & Place Order • ₱${total.toFixed(2)}`}
              </button>
              <p className="text-xs text-gray-400 text-center mt-3">
                By placing an order, you agree to our terms and conditions.
              </p>
            </div>
          </div>
        </div>
      </div>
      {qrphStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md">
            <PayWithQrph
              payment={qrphPayment}
              status={qrphStatus}
              onRetry={qrphStatus === 'FAILED' || qrphStatus === 'EXPIRED' ? retryQrph : undefined}
            />
          </div>
        </div>
      )}
    </>
  );
}
