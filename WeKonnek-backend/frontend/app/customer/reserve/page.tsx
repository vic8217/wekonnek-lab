'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import AuthGateModal from '@/components/AuthGateModal';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

function ReserveForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const merchantId = searchParams.get('merchant');

  const [merchant, setMerchant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [guests, setGuests] = useState(2);
  const [contactPhone, setContactPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!merchantId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API}/api/merchants/${merchantId}`);
        if (res.ok) setMerchant(await res.json());
      } catch {
        /* non-critical */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [merchantId]);

  const submit = async () => {
    if (!merchantId) {
      alert('No merchant selected');
      return;
    }
    if (!date) {
      alert('Please pick a date');
      return;
    }

    const token = await getToken();
    if (!token) {
      setShowAuthGate(true);
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`${API}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          merchant_id: parseInt(merchantId),
          reservation_date: date,
          reservation_time: time,
          number_of_guests: guests,
          contact_phone: contactPhone || null,
          special_requests: specialRequests || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create reservation');
      }
      const reservation = await res.json();
      alert(
        `Reservation requested! Code: ${reservation.reservation_code}. The merchant will confirm shortly.`,
      );
      router.push('/customer/orders?tab=reservations');
    } catch (e: any) {
      alert(e.message || 'Failed to create reservation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <AuthGateModal
        open={showAuthGate}
        onClose={() => setShowAuthGate(false)}
        onAuthenticated={() => { setShowAuthGate(false); submit(); }}
        title="Sign in to reserve"
        subtitle="Your reservation details are saved — just sign in to confirm."
      />
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg" title="Go back">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reserve a Table</h1>
          {merchant && <p className="text-sm text-gray-500">{merchant.name}</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Date</label>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Number of Guests</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setGuests((g) => Math.max(1, g - 1))}
              className="w-9 h-9 rounded-lg border border-gray-200 text-gray-600"
            >
              −
            </button>
            <span className="w-10 text-center font-bold text-gray-900">{guests}</span>
            <button
              onClick={() => setGuests((g) => g + 1)}
              className="w-9 h-9 rounded-lg bg-[#DB0002] text-white"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Contact Phone</label>
          <input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+63..."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Special Requests</label>
          <textarea
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            rows={3}
            placeholder="Window seat, birthday setup, etc."
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none resize-none"
          />
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-3.5 bg-[#DB0002] text-white rounded-2xl font-bold disabled:opacity-50 active:bg-[#B80002] transition-colors"
        >
          {submitting ? 'Reserving...' : 'Request Reservation'}
        </button>
      </div>
    </div>
  );
}

export default function ReservePage() {
  return (
    <Suspense fallback={null}>
      <ReserveForm />
    </Suspense>
  );
}
