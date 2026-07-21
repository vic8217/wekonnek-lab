'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const STEPS = ['Placed', 'Confirmed', 'Preparing', 'Picked Up', 'Delivered'] as const;
type OrderStatus = typeof STEPS[number];

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Rider {
  name: string;
  phone: string;
  vehicle: string;
  plateNumber: string;
}

interface TrackingData {
  id: string;
  orderCode: string;
  status: OrderStatus;
  merchantName: string;
  items: OrderItem[];
  totalAmount: number;
  rider: Rider | null;
  estimatedArrival: string;
  placedAt: string;
}

const MOCK_TRACKING: TrackingData = {
  id: '1',
  orderCode: 'WK-20260626-001',
  status: 'Preparing',
  merchantName: 'Jollibee - SM City Cebu',
  items: [
    { name: 'Chickenjoy Bucket (6pc)', quantity: 1, price: 499 },
    { name: 'Jolly Spaghetti Family', quantity: 1, price: 199 },
    { name: 'Peach Mango Pie', quantity: 3, price: 120 },
  ],
  totalAmount: 818,
  rider: {
    name: 'Mark Santos',
    phone: '+639171234567',
    vehicle: 'Honda Click 150i',
    plateNumber: 'ABC 1234',
  },
  estimatedArrival: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  placedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
};

function getStepIndex(status: OrderStatus): number {
  return STEPS.indexOf(status);
}

function Countdown({ target }: { target: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, new Date(target).getTime() - Date.now());
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}m ${s.toString().padStart(2, '0')}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [target]);

  return <span>{remaining}</span>;
}

export default function OrderTrackingPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetchTracking();
  }, [orderId]);

  const fetchTracking = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');

      const res = await fetch(`${API}/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      const order = data.data || data;

      const statusMap: Record<string, OrderStatus> = {
        pending: 'Placed',
        confirmed: 'Confirmed',
        processing: 'Confirmed',
        preparing: 'Preparing',
        ready: 'Preparing',
        out_for_delivery: 'Picked Up',
        delivered: 'Delivered',
        completed: 'Delivered',
      };

      setTracking({
        id: order.id?.toString() ?? orderId,
        orderCode: order.order_code || order.orderCode || `WK-${orderId}`,
        status: statusMap[order.status] || 'Placed',
        merchantName: order.merchants?.name || order.merchant?.name || 'Merchant',
        items: (order.order_items || order.orderItems || []).map((i: any) => ({
          name: i.product_name || i.productName || 'Item',
          quantity: i.quantity || 1,
          price: parseFloat(i.subtotal || i.price || 0),
        })),
        totalAmount: parseFloat(order.total_amount || order.totalAmount || 0),
        rider: order.rider
          ? {
              name: order.rider.name,
              phone: order.rider.phone,
              vehicle: order.rider.vehicle || 'Motorcycle',
              plateNumber: order.rider.plate_number || '',
            }
          : MOCK_TRACKING.rider,
        estimatedArrival:
          order.estimated_arrival || new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        placedAt: order.created_at || order.createdAt || new Date().toISOString(),
      });
    } catch {
      setTracking({ ...MOCK_TRACKING, id: orderId });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setCancelling(true);
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error('Failed to cancel');
      toast.success('Order cancelled');
      router.push('/customer/orders');
    } catch {
      toast.error('Failed to cancel order. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!tracking) return null;

  const currentStep = getStepIndex(tracking.status);
  const canCancel = currentStep <= 1;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Order Tracking</h1>
          <p className="text-sm text-gray-500">{tracking.orderCode}</p>
        </div>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between relative">
          {/* Progress line */}
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-200 mx-8" />
          <div
            className="absolute top-4 left-0 h-0.5 bg-[#DB0002] mx-8 transition-all duration-700"
            style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%`, maxWidth: 'calc(100% - 4rem)' }}
          />

          {STEPS.map((step, i) => {
            const isCompleted = i < currentStep;
            const isActive = i === currentStep;
            return (
              <div key={step} className="flex flex-col items-center z-10 relative">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-[#DB0002] text-white ring-4 ring-red-100 animate-pulse'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-[10px] sm:text-xs mt-2 font-medium text-center w-14 sm:w-16 ${
                    isCompleted ? 'text-green-600' : isActive ? 'text-[#DB0002]' : 'text-gray-400'
                  }`}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ETA */}
      <div className="bg-gradient-to-r from-[#DB0002] to-red-700 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm opacity-90">Estimated Arrival</p>
            <p className="text-2xl font-bold mt-1">
              <Countdown target={tracking.estimatedArrival} />
            </p>
          </div>
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Map Placeholder */}
      <div className="bg-gradient-to-br from-green-100 via-blue-50 to-green-50 rounded-2xl h-48 sm:h-64 flex flex-col items-center justify-center relative overflow-hidden border border-gray-100">
        <div className="absolute inset-0 opacity-10">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="absolute border border-green-300 rounded-full"
              style={{
                width: `${60 + i * 40}px`,
                height: `${60 + i * 40}px`,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </div>
        <div className="w-12 h-12 bg-[#DB0002] rounded-full flex items-center justify-center shadow-lg mb-3 z-10">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h.01M8 11h.01M12 7h.01M12 11h.01M16 7h.01M16 11h.01M21 12a9 9 0 11-2.636-6.364M21 12H17" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-600 z-10">Live Map</p>
        <p className="text-xs text-gray-400 z-10">Rider is on the way</p>
      </div>

      {/* Rider Info */}
      {tracking.rider && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Your Rider</h3>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-bold text-gray-900">{tracking.rider.name}</p>
              <p className="text-sm text-gray-500">{tracking.rider.vehicle} &middot; {tracking.rider.plateNumber}</p>
            </div>
            <a
              href={`tel:${tracking.rider.phone}`}
              className="w-11 h-11 bg-green-50 text-green-600 rounded-full flex items-center justify-center hover:bg-green-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Order Summary */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Order Summary</h3>
        <p className="text-sm text-gray-600 mb-3">{tracking.merchantName}</p>
        <div className="space-y-3">
          {tracking.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">
                {item.quantity}x {item.name}
              </span>
              <span className="text-sm font-medium text-gray-900">₱{item.price.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t pt-3 flex items-center justify-between">
            <span className="font-bold text-gray-900">Total</span>
            <span className="font-bold text-[#DB0002] text-lg">₱{tracking.totalAmount.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <Link
          href={`/customer/chat/${orderId}`}
          className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#DB0002] text-white font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.671 1.09-.085 2.17-.207 3.238-.364 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
          Chat with Rider
        </Link>

        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full py-3.5 border-2 border-gray-200 text-gray-600 font-semibold rounded-xl hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Order'}
          </button>
        )}
      </div>
    </div>
  );
}
