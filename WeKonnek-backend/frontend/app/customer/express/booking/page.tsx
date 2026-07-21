'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import AuthGateModal from '@/components/AuthGateModal';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const VEHICLE_LABELS: Record<string, { label: string; icon: string }> = {
  motorcycle: { label: 'Motorcycle', icon: '🏍️' },
  car: { label: 'Car', icon: '🚗' },
  van: { label: 'Van', icon: '🚐' },
};

const SIZE_LABELS: Record<string, { label: string; icon: string }> = {
  small: { label: 'Small (Envelope)', icon: '📄' },
  medium: { label: 'Medium (Box)', icon: '📦' },
  large: { label: 'Large (Furniture)', icon: '🪑' },
};

function BookingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const pickup = searchParams.get('pickup') || '';
  const dropoff = searchParams.get('dropoff') || '';
  const size = searchParams.get('size') || 'small';
  const vehicle = searchParams.get('vehicle') || 'motorcycle';
  const fare = Number(searchParams.get('fare')) || 99;

  const baseFare = Math.round(fare * 0.6);
  const distanceFare = fare - baseFare;

  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [bookingId, setBookingId] = useState('');
  const [showAuthGate, setShowAuthGate] = useState(false);

  const canSubmit = senderName && senderPhone && receiverName && receiverPhone && pickup && dropoff;

  const handleConfirm = async () => {
    if (!canSubmit) return;

    const token = getToken();
    if (!token) {
      setShowAuthGate(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/express/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickup_address: pickup,
          dropoff_address: dropoff,
          package_size: size,
          vehicle_type: vehicle,
          sender_name: senderName,
          sender_phone: senderPhone,
          receiver_name: receiverName,
          receiver_phone: receiverPhone,
          notes,
          estimated_fare: fare,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setBookingId(data.id || data.booking_id || 'EX' + Date.now().toString().slice(-6));
        setShowSuccess(true);
      } else {
        throw new Error('Booking failed');
      }
    } catch {
      toast.error('Booking failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm mx-auto">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Booking Confirmed!</h2>
          <p className="text-gray-500 text-sm mb-1">Your delivery has been booked</p>
          <p className="text-xs text-gray-400 font-mono mb-6">Booking ID: {bookingId}</p>
          <div className="bg-gray-50 rounded-2xl p-4 text-left mb-6 border border-gray-100">
            <div className="text-xs space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-gray-600">{pickup}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-[#DB0002] rounded-full" />
                <span className="text-gray-600">{dropoff}</span>
              </div>
              <hr className="border-gray-200" />
              <div className="flex justify-between">
                <span className="text-gray-500">Total Fare</span>
                <span className="font-bold text-gray-900">₱{fare.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push('/customer/express')}
              className="px-6 py-2.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold"
            >
              Back to Express
            </button>
            <button
              onClick={() => router.push('/customer/orders')}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold"
            >
              My Orders
            </button>
          </div>
        </div>
      </div>
    );
  }

  const vehicleData = VEHICLE_LABELS[vehicle] || VEHICLE_LABELS.motorcycle;
  const sizeData = SIZE_LABELS[size] || SIZE_LABELS.small;

  return (
    <>
      <AuthGateModal
        open={showAuthGate}
        onClose={() => setShowAuthGate(false)}
        onAuthenticated={() => { setShowAuthGate(false); handleConfirm(); }}
        title="Sign in to book"
        subtitle="Your delivery details are saved — just sign in to confirm."
      />

      {/* ========== MOBILE BOOKING ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50 pb-24">
        {/* Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <button onClick={() => router.back()} className="p-1 -ml-1 active:bg-gray-100 rounded-lg transition-colors">
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">Confirm Booking</h1>
          </div>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Map Placeholder */}
          <div className="relative bg-gradient-to-br from-blue-50 to-green-50 rounded-2xl h-40 overflow-hidden border border-gray-200">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <span className="text-4xl">🗺️</span>
                <p className="text-xs text-gray-500 mt-1">Route Preview</p>
              </div>
            </div>
            <div className="absolute top-3 left-3 bg-white rounded-lg px-2.5 py-1.5 shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-[10px] text-gray-600 font-medium truncate max-w-[120px]">{pickup}</span>
            </div>
            <div className="absolute bottom-3 right-3 bg-white rounded-lg px-2.5 py-1.5 shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 bg-[#DB0002] rounded-full" />
              <span className="text-[10px] text-gray-600 font-medium truncate max-w-[120px]">{dropoff}</span>
            </div>
          </div>

          {/* Route Details */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Route Details</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Pickup</p>
                  <p className="text-sm text-gray-800 font-medium">{pickup || 'Not set'}</p>
                </div>
              </div>
              <div className="ml-3 border-l-2 border-dashed border-gray-200 h-3" />
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="w-2 h-2 bg-[#DB0002] rounded-full" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Drop-off</p>
                  <p className="text-sm text-gray-800 font-medium">{dropoff || 'Not set'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Package & Vehicle */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Package Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                <span className="text-xl">{sizeData.icon}</span>
                <p className="text-[11px] font-bold text-gray-700 mt-0.5">{sizeData.label}</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                <span className="text-xl">{vehicleData.icon}</span>
                <p className="text-[11px] font-bold text-gray-700 mt-0.5">{vehicleData.label}</p>
              </div>
            </div>
          </div>

          {/* Fare Breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Fare Breakdown</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Base Fare</span>
                <span className="font-medium text-gray-800">₱{baseFare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Distance Fare</span>
                <span className="font-medium text-gray-800">₱{distanceFare.toFixed(2)}</span>
              </div>
              <hr className="border-gray-100" />
              <div className="flex justify-between">
                <span className="font-bold text-gray-900">Total</span>
                <span className="text-lg font-black text-[#DB0002]">₱{fare.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <h3 className="text-sm font-bold text-gray-900">Sender Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Full name"
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
              <input
                type="tel"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="Phone number"
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
            </div>

            <h3 className="text-sm font-bold text-gray-900 pt-1">Receiver Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Full name"
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
              <input
                type="tel"
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                placeholder="Phone number"
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery notes (optional)"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 safe-area-bottom lg:hidden">
          <button
            onClick={handleConfirm}
            disabled={!canSubmit || submitting}
            className="w-full py-3.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold disabled:opacity-40 disabled:bg-gray-300 active:scale-[0.98] transition-all shadow-lg shadow-red-200/50"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Confirming...
              </span>
            ) : (
              `Confirm Booking — ₱${fare.toFixed(2)}`
            )}
          </button>
        </div>
      </div>

      {/* ========== DESKTOP BOOKING ========== */}
      <div className="hidden lg:block space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Confirm Booking</h1>
            <p className="text-gray-600">Review your delivery details before confirming</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Map Placeholder */}
            <div className="relative bg-gradient-to-br from-blue-50 to-green-50 rounded-2xl h-48 border border-gray-200 flex items-center justify-center">
              <div className="text-center">
                <span className="text-5xl">🗺️</span>
                <p className="text-sm text-gray-500 mt-2">Route Preview</p>
              </div>
              <div className="absolute top-4 left-4 bg-white rounded-lg px-3 py-2 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                <span className="text-xs text-gray-700 font-medium">{pickup}</span>
              </div>
              <div className="absolute bottom-4 right-4 bg-white rounded-lg px-3 py-2 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-[#DB0002] rounded-full" />
                <span className="text-xs text-gray-700 font-medium">{dropoff}</span>
              </div>
            </div>

            {/* Contact Forms */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">Sender Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="Enter sender name"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      placeholder="+63 9XX XXX XXXX"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                    />
                  </div>
                </div>
              </div>

              <hr className="border-gray-100" />

              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">Receiver Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      placeholder="Enter receiver name"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={receiverPhone}
                      onChange={(e) => setReceiverPhone(e.target.value)}
                      placeholder="+63 9XX XXX XXXX"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special instructions (optional)"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
              </div>
            </div>
          </div>

          {/* Right: Summary */}
          <div className="lg:sticky lg:top-6 self-start space-y-4">
            {/* Package Info */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Delivery Summary</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Pickup</p>
                    <p className="text-gray-800 font-medium">{pickup}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-[#DB0002] rounded-full mt-1.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase">Drop-off</p>
                    <p className="text-gray-800 font-medium">{dropoff}</p>
                  </div>
                </div>
                <hr className="border-gray-100" />
                <div className="flex justify-between">
                  <span className="text-gray-500">Package</span>
                  <span className="font-medium">{sizeData.icon} {sizeData.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Vehicle</span>
                  <span className="font-medium">{vehicleData.icon} {vehicleData.label}</span>
                </div>
              </div>
            </div>

            {/* Fare */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Fare Breakdown</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Base Fare</span>
                  <span className="font-medium">₱{baseFare.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Distance Fare</span>
                  <span className="font-medium">₱{distanceFare.toFixed(2)}</span>
                </div>
                <hr className="border-gray-100" />
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="text-xl font-black text-[#DB0002]">₱{fare.toFixed(2)}</span>
                </div>
              </div>
              <button
                onClick={handleConfirm}
                disabled={!canSubmit || submitting}
                className="w-full mt-5 py-3.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold disabled:opacity-40 disabled:bg-gray-300 hover:bg-[#b80002] transition-colors"
              >
                {submitting ? 'Confirming...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function BookingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BookingContent />
    </Suspense>
  );
}
