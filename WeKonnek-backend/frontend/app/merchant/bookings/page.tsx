'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled';

interface StatusHistoryEntry {
  status: BookingStatus;
  timestamp: string;
  note?: string;
}

interface Booking {
  id: number;
  ref: string;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  partySize: number;
  status: BookingStatus;
  serviceType: string;
  tableOrRoom: string;
  specialRequests: string;
  statusHistory: StatusHistoryEntry[];
  createdAt: string;
}

const MOCK_BOOKINGS: Booking[] = [
  {
    id: 1, ref: 'BK-1001', customerName: 'Maria Santos', customerPhone: '+63 917 123 4567',
    date: '2026-06-29', time: '12:00', partySize: 4, status: 'confirmed',
    serviceType: 'Dine-In', tableOrRoom: 'Table 5',
    specialRequests: 'Birthday celebration, need a cake stand',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-28T10:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-28T10:30:00Z', note: 'Confirmed via SMS' },
    ],
    createdAt: '2026-06-28T10:00:00Z',
  },
  {
    id: 2, ref: 'BK-1002', customerName: 'Juan dela Cruz', customerPhone: '+63 918 234 5678',
    date: '2026-06-29', time: '18:30', partySize: 2, status: 'pending',
    serviceType: 'Dine-In', tableOrRoom: 'Table 3',
    specialRequests: 'Window seat preferred',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-29T08:00:00Z' },
    ],
    createdAt: '2026-06-29T08:00:00Z',
  },
  {
    id: 3, ref: 'BK-1003', customerName: 'Ana Reyes', customerPhone: '+63 919 345 6789',
    date: '2026-06-29', time: '11:00', partySize: 6, status: 'checked_in',
    serviceType: 'Private Room', tableOrRoom: 'Room A',
    specialRequests: 'Business meeting, need projector setup',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-27T14:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-27T15:00:00Z' },
      { status: 'checked_in', timestamp: '2026-06-29T10:50:00Z' },
    ],
    createdAt: '2026-06-27T14:00:00Z',
  },
  {
    id: 4, ref: 'BK-1004', customerName: 'Pedro Garcia', customerPhone: '+63 920 456 7890',
    date: '2026-06-29', time: '19:00', partySize: 8, status: 'confirmed',
    serviceType: 'Dine-In', tableOrRoom: 'Table 10 & 11',
    specialRequests: 'Lechon pre-order, anniversary dinner',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-26T09:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-26T09:45:00Z' },
    ],
    createdAt: '2026-06-26T09:00:00Z',
  },
  {
    id: 5, ref: 'BK-1005', customerName: 'Rosa Mendoza', customerPhone: '+63 921 567 8901',
    date: '2026-06-29', time: '13:00', partySize: 3, status: 'completed',
    serviceType: 'Dine-In', tableOrRoom: 'Table 7',
    specialRequests: '',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-28T18:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-28T18:15:00Z' },
      { status: 'checked_in', timestamp: '2026-06-29T12:55:00Z' },
      { status: 'completed', timestamp: '2026-06-29T14:10:00Z' },
    ],
    createdAt: '2026-06-28T18:00:00Z',
  },
  {
    id: 6, ref: 'BK-1006', customerName: 'Carlos Villanueva', customerPhone: '+63 922 678 9012',
    date: '2026-06-29', time: '20:00', partySize: 5, status: 'pending',
    serviceType: 'Private Room', tableOrRoom: 'Room B',
    specialRequests: 'Need high chair for toddler',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-29T09:30:00Z' },
    ],
    createdAt: '2026-06-29T09:30:00Z',
  },
  {
    id: 7, ref: 'BK-1007', customerName: 'Liza Aquino', customerPhone: '+63 923 789 0123',
    date: '2026-06-30', time: '12:30', partySize: 2, status: 'confirmed',
    serviceType: 'Dine-In', tableOrRoom: 'Table 2',
    specialRequests: 'Vegetarian menu options please',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-29T07:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-29T07:20:00Z' },
    ],
    createdAt: '2026-06-29T07:00:00Z',
  },
  {
    id: 8, ref: 'BK-1008', customerName: 'Roberto Tan', customerPhone: '+63 924 890 1234',
    date: '2026-06-28', time: '19:30', partySize: 4, status: 'cancelled',
    serviceType: 'Dine-In', tableOrRoom: 'Table 9',
    specialRequests: '',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-27T11:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-27T11:30:00Z' },
      { status: 'cancelled', timestamp: '2026-06-28T16:00:00Z', note: 'Customer cancelled' },
    ],
    createdAt: '2026-06-27T11:00:00Z',
  },
  {
    id: 9, ref: 'BK-1009', customerName: 'Teresa Bautista', customerPhone: '+63 925 901 2345',
    date: '2026-06-29', time: '17:00', partySize: 10, status: 'confirmed',
    serviceType: 'Events Hall', tableOrRoom: 'Main Hall',
    specialRequests: 'Debut celebration, balloon setup by 4 PM, sinigang buffet',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-20T10:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-20T14:00:00Z', note: 'Deposit received ₱5,000' },
    ],
    createdAt: '2026-06-20T10:00:00Z',
  },
  {
    id: 10, ref: 'BK-1010', customerName: 'Marco Ramos', customerPhone: '+63 926 012 3456',
    date: '2026-06-29', time: '14:00', partySize: 1, status: 'checked_in',
    serviceType: 'Salon', tableOrRoom: 'Station 3',
    specialRequests: 'Haircut + hot towel shave',
    statusHistory: [
      { status: 'pending', timestamp: '2026-06-29T12:00:00Z' },
      { status: 'confirmed', timestamp: '2026-06-29T12:05:00Z' },
      { status: 'checked_in', timestamp: '2026-06-29T13:55:00Z' },
    ],
    createdAt: '2026-06-29T12:00:00Z',
  },
];

type FilterTab = 'all' | BookingStatus;
type ViewMode = 'list' | 'calendar';

export default function MerchantBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split('T')[0]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const fetchBookings = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');
      const res = await fetch(`${API}/api/reservations?merchantId=me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const list: Booking[] = (Array.isArray(data) ? data : data.data || []).map((r: any) => ({
        id: r.id,
        ref: r.reservation_code || `BK-${r.id}`,
        customerName: r.customer_name || 'Guest',
        customerPhone: r.contact_phone || '',
        date: r.reservation_date,
        time: r.reservation_time,
        partySize: r.number_of_guests || 1,
        status: r.status as BookingStatus,
        serviceType: r.service_type || 'Dine-In',
        tableOrRoom: r.table_number ? `Table ${r.table_number}` : 'TBD',
        specialRequests: r.special_requests || '',
        statusHistory: r.status_history || [{ status: r.status, timestamp: r.created_at }],
        createdAt: r.created_at,
      }));
      setBookings(list);
    } catch {
      setBookings(MOCK_BOOKINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  useEffect(() => {
    const interval = setInterval(fetchBookings, 30000);
    return () => clearInterval(interval);
  }, [fetchBookings]);

  const handleStatusChange = async (id: number, newStatus: BookingStatus) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/reservations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update booking status');
      }

      setBookings(prev =>
        prev.map(b => b.id === id ? {
          ...b,
          status: newStatus,
          statusHistory: [...b.statusHistory, { status: newStatus, timestamp: new Date().toISOString() }],
        } : b)
      );
      if (selectedBooking?.id === id) {
        setSelectedBooking(prev => prev ? {
          ...prev,
          status: newStatus,
          statusHistory: [...prev.statusHistory, { status: newStatus, timestamp: new Date().toISOString() }],
        } : null);
      }
      toast.success('Booking status updated');
    } catch (err: any) {
      console.error('Failed to update booking status:', err);
      toast.error(err.message || 'Failed to update booking status');
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const todayBookings = bookings.filter(b => b.date === todayStr);
  const stats = {
    today: todayBookings.length,
    pending: bookings.filter(b => b.status === 'pending').length,
    checkedIn: bookings.filter(b => b.status === 'checked_in').length,
    revenue: todayBookings.filter(b => b.status === 'completed' || b.status === 'checked_in').length * 850,
  };

  const filtered = bookings.filter(b => {
    if (activeFilter !== 'all' && b.status !== activeFilter) return false;
    if (viewMode === 'list' && dateFilter) return b.date === dateFilter;
    return true;
  });

  const formatTime = (t: string) => {
    const [h, m] = t.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  const formatDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

  const statusColor: Record<BookingStatus, string> = {
    pending: 'bg-orange-100 text-orange-800 border-orange-200',
    confirmed: 'bg-green-100 text-green-800 border-green-200',
    checked_in: 'bg-blue-100 text-blue-800 border-blue-200',
    completed: 'bg-gray-100 text-gray-600 border-gray-200',
    cancelled: 'bg-red-100 text-red-700 border-red-200',
  };

  const statusLabel: Record<BookingStatus, string> = {
    pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked In',
    completed: 'Completed', cancelled: 'Cancelled',
  };

  // Calendar helpers
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const firstDayOfWeek = (y: number, m: number) => new Date(y, m, 1).getDay();

  const calDays = () => {
    const { year, month } = calendarMonth;
    const total = daysInMonth(year, month);
    const offset = firstDayOfWeek(year, month);
    const days: { day: number; dateStr: string }[] = [];
    for (let i = 1; i <= total; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, dateStr });
    }
    return { days, offset };
  };

  const bookingsForDate = (dateStr: string) => bookings.filter(b => b.date === dateStr);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading bookings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-3xl font-bold text-gray-900">Bookings Management</h1>
          <p className="text-xs lg:text-sm text-gray-500">Manage customer reservations and bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
          />
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'calendar' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        {[
          { label: "Today's Bookings", value: stats.today, icon: '📅', color: 'border-blue-200 bg-blue-50' },
          { label: 'Pending Confirmation', value: stats.pending, icon: '⏳', color: 'border-orange-200 bg-orange-50' },
          { label: 'Checked In', value: stats.checkedIn, icon: '✅', color: 'border-green-200 bg-green-50' },
          { label: 'Revenue Today', value: `₱${stats.revenue.toLocaleString()}`, icon: '💰', color: 'border-emerald-200 bg-emerald-50' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-3 lg:p-4 ${card.color}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-lg">{card.icon}</span>
            </div>
            <p className="text-xl lg:text-2xl font-black text-gray-900">{card.value}</p>
            <p className="text-[10px] lg:text-xs font-semibold text-gray-500 uppercase tracking-wider mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { key: 'all' as FilterTab, label: 'All' },
          { key: 'pending' as FilterTab, label: 'Pending' },
          { key: 'confirmed' as FilterTab, label: 'Confirmed' },
          { key: 'checked_in' as FilterTab, label: 'Checked In' },
          { key: 'completed' as FilterTab, label: 'Completed' },
          { key: 'cancelled' as FilterTab, label: 'Cancelled' },
        ]).map(tab => {
          const count = tab.key === 'all' ? bookings.length : bookings.filter(b => b.status === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg font-medium text-xs transition-colors ${
                activeFilter === tab.key
                  ? 'bg-[#DB0002] text-white shadow-md'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Calendar View */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCalendarMonth(p => {
                const d = new Date(p.year, p.month - 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })}
              className="p-1.5 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h3 className="text-sm lg:text-base font-bold text-gray-900">
              {new Date(calendarMonth.year, calendarMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              onClick={() => setCalendarMonth(p => {
                const d = new Date(p.year, p.month + 1, 1);
                return { year: d.getFullYear(), month: d.getMonth() };
              })}
              className="p-1.5 hover:bg-gray-100 rounded-lg"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-[10px] lg:text-xs font-bold text-gray-400 uppercase py-1">{d}</div>
            ))}
            {Array.from({ length: calDays().offset }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {calDays().days.map(({ day, dateStr }) => {
              const dayBookings = bookingsForDate(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <button
                  key={dateStr}
                  onClick={() => { setDateFilter(dateStr); setViewMode('list'); }}
                  className={`relative p-1 lg:p-2 rounded-lg text-xs lg:text-sm transition-colors min-h-[40px] lg:min-h-[56px] ${
                    isToday ? 'bg-[#DB0002]/10 font-bold text-[#DB0002] ring-1 ring-[#DB0002]/30'
                    : dayBookings.length > 0 ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="block">{day}</span>
                  {dayBookings.length > 0 && (
                    <span className="block text-[9px] lg:text-[10px] font-bold text-blue-600 mt-0.5">
                      {dayBookings.length} {dayBookings.length === 1 ? 'bkg' : 'bkgs'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl p-8 lg:p-12 text-center border border-gray-200 shadow-sm">
              <span className="text-5xl mb-4 block">📅</span>
              <p className="text-gray-700 text-lg font-semibold">No bookings found</p>
              <p className="text-gray-400 text-sm mt-2">
                {activeFilter !== 'all'
                  ? `No ${statusLabel[activeFilter as BookingStatus]?.toLowerCase()} bookings for this date.`
                  : 'No bookings for the selected date. Try changing the date filter.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {['Ref', 'Customer', 'Date & Time', 'Party', 'Service / Location', 'Status', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedBooking(b)}>
                        <td className="px-4 py-3 text-sm font-bold text-[#DB0002]">{b.ref}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-900">{b.customerName}</p>
                          <p className="text-xs text-gray-400">{b.customerPhone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-900">{formatDate(b.date)}</p>
                          <p className="text-xs text-gray-500">{formatTime(b.time)}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-semibold">{b.partySize}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-900">{b.serviceType}</p>
                          <p className="text-xs text-gray-500">{b.tableOrRoom}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusColor[b.status]}`}>
                            {statusLabel[b.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <ActionButtons booking={b} onStatusChange={handleStatusChange} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="lg:hidden space-y-2">
                {filtered.map(b => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBooking(b)}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#DB0002]">{b.ref}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor[b.status]}`}>
                            {statusLabel[b.status]}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 mt-0.5">{b.customerName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-gray-700">{formatTime(b.time)}</p>
                        <p className="text-[10px] text-gray-400">{formatDate(b.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {b.partySize} guests
                      </span>
                      <span>{b.serviceType}</span>
                      <span className="text-gray-400">{b.tableOrRoom}</span>
                    </div>
                    {b.specialRequests && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1 mb-2 line-clamp-1">
                        {b.specialRequests}
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                      <ActionButtons booking={b} onStatusChange={handleStatusChange} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end lg:items-center justify-center p-0 lg:p-4" onClick={() => setSelectedBooking(null)}>
          <div
            className="bg-white w-full lg:w-[520px] lg:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-base lg:text-lg font-bold text-gray-900">{selectedBooking.ref}</h2>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border mt-0.5 ${statusColor[selectedBooking.status]}`}>
                  {statusLabel[selectedBooking.status]}
                </span>
              </div>
              <button onClick={() => setSelectedBooking(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Customer Info */}
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Customer</p>
                <p className="text-sm font-bold text-gray-900">{selectedBooking.customerName}</p>
                <p className="text-xs text-gray-500">{selectedBooking.customerPhone}</p>
              </div>

              {/* Booking Details */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Date & Time</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDate(selectedBooking.date)}</p>
                  <p className="text-xs text-gray-500">{formatTime(selectedBooking.time)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Party Size</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedBooking.partySize} {selectedBooking.partySize === 1 ? 'guest' : 'guests'}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Service Type</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedBooking.serviceType}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Table / Room</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedBooking.tableOrRoom}</p>
                </div>
              </div>

              {/* Special Requests */}
              {selectedBooking.specialRequests && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">Special Requests</p>
                  <p className="text-sm text-amber-900">{selectedBooking.specialRequests}</p>
                </div>
              )}

              {/* Status History */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Status History</p>
                <div className="space-y-0">
                  {selectedBooking.statusHistory.map((entry, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                          entry.status === 'cancelled' ? 'bg-red-500' :
                          i === selectedBooking.statusHistory.length - 1 ? 'bg-[#DB0002]' : 'bg-gray-300'
                        }`} />
                        {i < selectedBooking.statusHistory.length - 1 && (
                          <div className="w-0.5 h-6 bg-gray-200" />
                        )}
                      </div>
                      <div className="pb-3">
                        <p className="text-xs font-semibold text-gray-900">{statusLabel[entry.status]}</p>
                        <p className="text-[10px] text-gray-400">{formatDateTime(entry.timestamp)}</p>
                        {entry.note && <p className="text-[10px] text-gray-500 mt-0.5">{entry.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <ActionButtons booking={selectedBooking} onStatusChange={handleStatusChange} fullWidth />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButtons({
  booking,
  onStatusChange,
  fullWidth = false,
}: {
  booking: Booking;
  onStatusChange: (id: number, status: BookingStatus) => void;
  fullWidth?: boolean;
}) {
  const btnBase = `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${fullWidth ? 'flex-1 py-2' : ''}`;

  switch (booking.status) {
    case 'pending':
      return (
        <>
          <button onClick={() => onStatusChange(booking.id, 'confirmed')} className={`${btnBase} bg-green-600 hover:bg-green-700 text-white`}>
            Confirm
          </button>
          <button onClick={() => onStatusChange(booking.id, 'cancelled')} className={`${btnBase} bg-red-100 hover:bg-red-200 text-red-700`}>
            Cancel
          </button>
        </>
      );
    case 'confirmed':
      return (
        <>
          <button onClick={() => onStatusChange(booking.id, 'checked_in')} className={`${btnBase} bg-blue-600 hover:bg-blue-700 text-white`}>
            Check In
          </button>
          <button onClick={() => onStatusChange(booking.id, 'cancelled')} className={`${btnBase} bg-red-100 hover:bg-red-200 text-red-700`}>
            Cancel
          </button>
        </>
      );
    case 'checked_in':
      return (
        <button onClick={() => onStatusChange(booking.id, 'completed')} className={`${btnBase} bg-gray-700 hover:bg-gray-800 text-white`}>
          Complete
        </button>
      );
    default:
      return <span className="text-xs text-gray-400 italic">No actions</span>;
  }
}
