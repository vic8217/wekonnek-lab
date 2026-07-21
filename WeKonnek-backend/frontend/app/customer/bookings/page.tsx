'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type BookingTab = 'upcoming' | 'past' | 'browse';

interface Booking {
  id: string;
  reservationCode: string;
  merchantName: string;
  merchantId: string;
  date: string;
  time: string;
  guests: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string;
}

const BROWSE_CATEGORIES = [
  { name: 'Restaurants', emoji: '🍽️', description: 'Book a table' },
  { name: 'Spa & Wellness', emoji: '💆', description: 'Relax & unwind' },
  { name: 'Events', emoji: '🎪', description: 'Activities & shows' },
  { name: 'Services', emoji: '✂️', description: 'Appointments' },
];

const MOCK_BOOKINGS: Booking[] = [
  {
    id: '1',
    reservationCode: 'RES-20260628-001',
    merchantName: 'Anzani Mediterranean',
    merchantId: '101',
    date: '2026-06-28',
    time: '19:00',
    guests: 4,
    status: 'confirmed',
    notes: 'Window seat preferred',
  },
  {
    id: '2',
    reservationCode: 'RES-20260630-002',
    merchantName: 'The Spa at Cebu',
    merchantId: '102',
    date: '2026-06-30',
    time: '14:00',
    guests: 2,
    status: 'pending',
    notes: 'Couples massage',
  },
  {
    id: '3',
    reservationCode: 'RES-20260701-003',
    merchantName: 'Circa 1900 Restaurant',
    merchantId: '103',
    date: '2026-07-01',
    time: '12:30',
    guests: 6,
    status: 'pending',
    notes: 'Birthday celebration',
  },
  {
    id: '4',
    reservationCode: 'RES-20260620-004',
    merchantName: 'Maya Mexican Restaurant',
    merchantId: '104',
    date: '2026-06-20',
    time: '18:00',
    guests: 2,
    status: 'completed',
    notes: '',
  },
  {
    id: '5',
    reservationCode: 'RES-20260615-005',
    merchantName: 'Lantaw Floating Restaurant',
    merchantId: '105',
    date: '2026-06-15',
    time: '19:30',
    guests: 8,
    status: 'cancelled',
    notes: 'Weather cancellation',
  },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pending: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400', label: 'Pending' },
  confirmed: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-400', label: 'Confirmed' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-400', label: 'Cancelled' },
  completed: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400', label: 'Completed' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function BookingsPage() {
  const [activeTab, setActiveTab] = useState<BookingTab>('browse');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');

      const res = await fetch(`${API}/api/reservations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      const list = data.data || data;
      setBookings(
        (Array.isArray(list) ? list : []).map((b: any) => ({
          id: b.id?.toString(),
          reservationCode: b.reservation_code || b.reservationCode || `RES-${b.id}`,
          merchantName: b.merchant?.name || b.merchantName || b.merchant_name || 'Merchant',
          merchantId: b.merchant_id?.toString() || b.merchantId?.toString() || '',
          date: (b.date || b.reservation_date || b.created_at || '').slice(0, 10),
          time: b.time || b.reservation_time || '12:00',
          guests: b.guests || b.party_size || b.partySize || 2,
          status: b.status || 'pending',
          notes: b.notes || b.special_requests || '',
        }))
      );
    } catch {
      setBookings(MOCK_BOOKINGS);
    } finally {
      setLoading(false);
    }
  };

  const upcomingBookings = bookings.filter(
    (b) => b.status === 'pending' || b.status === 'confirmed'
  );
  const pastBookings = bookings.filter(
    (b) => b.status === 'completed' || b.status === 'cancelled'
  );

  const tabs: { id: BookingTab; label: string; count?: number }[] = [
    { id: 'browse', label: 'Browse' },
    { id: 'upcoming', label: 'Upcoming', count: upcomingBookings.length },
    { id: 'past', label: 'Past', count: pastBookings.length },
  ];

  const renderBookingCard = (booking: Booking) => {
    const style = STATUS_STYLES[booking.status] || STATUS_STYLES.pending;
    return (
      <div key={booking.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 transition-all hover:shadow-md">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-gray-900">{booking.merchantName}</h3>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{booking.reservationCode}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {style.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 py-3 border-y border-gray-50">
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-medium">Date</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{formatDate(booking.date)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-medium">Time</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{formatTime(booking.time)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-medium">Guests</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{booking.guests} {booking.guests === 1 ? 'person' : 'people'}</p>
          </div>
        </div>

        {booking.notes && (
          <p className="text-xs text-gray-400 mt-3 italic">&ldquo;{booking.notes}&rdquo;</p>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Bookings</h1>
        <p className="text-sm text-gray-500 mt-1">Reserve and manage your appointments</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-white text-[#DB0002] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-[#DB0002] text-white' : 'bg-gray-300 text-white'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Browse Tab */}
          {activeTab === 'browse' && (
            <div className="grid grid-cols-2 gap-3">
              {BROWSE_CATEGORIES.map((cat) => (
                <Link
                  key={cat.name}
                  href={`/customer/reserve?category=${encodeURIComponent(cat.name)}`}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-[#DB0002]/20 transition-all group"
                >
                  <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-2xl mb-3 group-hover:scale-110 transition-transform">
                    {cat.emoji}
                  </div>
                  <h3 className="font-bold text-gray-900 text-sm">{cat.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{cat.description}</p>
                </Link>
              ))}
            </div>
          )}

          {/* Upcoming Tab */}
          {activeTab === 'upcoming' && (
            <div className="space-y-3">
              {upcomingBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">📅</span>
                  </div>
                  <p className="text-gray-500 font-medium">No upcoming bookings</p>
                  <p className="text-sm text-gray-400 mt-1">Browse categories to make a reservation</p>
                  <button
                    onClick={() => setActiveTab('browse')}
                    className="mt-4 px-5 py-2.5 bg-[#DB0002] text-white font-semibold rounded-xl text-sm hover:bg-red-700 transition-colors"
                  >
                    Browse Now
                  </button>
                </div>
              ) : (
                upcomingBookings.map(renderBookingCard)
              )}
            </div>
          )}

          {/* Past Tab */}
          {activeTab === 'past' && (
            <div className="space-y-3">
              {pastBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <span className="text-3xl">📋</span>
                  </div>
                  <p className="text-gray-500 font-medium">No past bookings</p>
                  <p className="text-sm text-gray-400 mt-1">Your completed and cancelled bookings will appear here</p>
                </div>
              ) : (
                pastBookings.map(renderBookingCard)
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
