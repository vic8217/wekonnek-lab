'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Reservation {
  id: number;
  reservation_code: string;
  customer_name: string;
  reservation_date: string;
  reservation_time: string;
  number_of_guests: number;
  status: string;
  table_number?: string;
  special_requests?: string;
  contact_phone?: string;
  advance_orders?: number;
  total_amount: number;
  created_at: string;
}

export default function MerchantReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'confirmed' | 'checked_in' | 'completed'>('all');
  const [newReservationAlert, setNewReservationAlert] = useState(false);

  const fetchReservations = useCallback(async (mId?: number) => {
    const id = mId || merchantId;
    if (!id) return;

    try {
      const token = getToken();
      const statusParam = activeFilter === 'all' ? 'pending,confirmed,checked_in' : activeFilter;
      const res = await fetch(`${API}/api/reservations?merchantId=${id}&status=${statusParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch reservations');
      const reservationsData = await res.json();

      const transformedReservations: Reservation[] = (Array.isArray(reservationsData) ? reservationsData : reservationsData.data || []).map((reservation: any) => {
        const customerName = reservation.customer_name
          || (reservation.users ? `${reservation.users.first_name || ''} ${reservation.users.last_name || ''}`.trim() : '')
          || 'Guest';

        return {
          id: reservation.id,
          reservation_code: reservation.reservation_code,
          customer_name: customerName,
          reservation_date: reservation.reservation_date,
          reservation_time: reservation.reservation_time,
          number_of_guests: reservation.number_of_guests,
          status: reservation.status,
          table_number: reservation.table_number,
          special_requests: reservation.special_requests,
          contact_phone: reservation.contact_phone,
          total_amount: 0,
          created_at: reservation.created_at,
        };
      });

      setReservations(transformedReservations);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  }, [merchantId, activeFilter]);

  useEffect(() => {
    const init = async () => {
      try {
        const token = getToken();
        if (!token) return;

        const res = await fetch(`${API}/api/merchants/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const merchant = await res.json();

        if (merchant) {
          setMerchantId(merchant.id);
          await fetchReservations(merchant.id);
        }
      } catch (error) {
        console.error('Error initializing:', error);
      }
    };

    init();
  }, []);

  // Refetch when filter changes
  useEffect(() => {
    if (merchantId) {
      fetchReservations();
    }
  }, [activeFilter, fetchReservations, merchantId]);

  // Poll for new reservations (replaces realtime subscription)
  useEffect(() => {
    if (!merchantId) return;
    const interval = setInterval(() => {
      fetchReservations();
    }, 30000);
    return () => clearInterval(interval);
  }, [merchantId, fetchReservations]);

  const updateReservationStatus = async (id: number, newStatus: string) => {
    try {
      const token = getToken();
      await fetch(`${API}/api/reservations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchReservations();
    } catch (error) {
      console.error('Error updating reservation:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending': return 'bg-orange-500 text-white';
      case 'confirmed': return 'bg-green-500 text-white';
      case 'checked_in': return 'bg-blue-500 text-white';
      case 'completed': return 'bg-gray-500 text-white';
      case 'cancelled': return 'bg-red-500 text-white';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'confirmed': return 'bg-green-100 text-green-800 border-green-200';
      case 'checked_in': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'completed': return 'bg-gray-100 text-gray-600 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getTimeAgo = (dateString: string): string => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const statusCounts = {
    all: reservations.length,
    pending: reservations.filter(r => r.status === 'pending').length,
    confirmed: reservations.filter(r => r.status === 'confirmed').length,
    checked_in: reservations.filter(r => r.status === 'checked_in').length,
    completed: reservations.filter(r => r.status === 'completed').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading reservations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* New Reservation Alert */}
      {newReservationAlert && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-3 animate-pulse">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">New Reservation Request!</p>
            <p className="text-xs text-green-600">A customer just made a reservation. Check it out below.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl lg:text-3xl font-bold text-gray-900">Reservations</h1>
          <p className="text-xs lg:text-sm text-gray-600">Manage customer reservation requests in real-time</p>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
          </span>
          <span className="text-xs font-semibold text-green-700">Live Updates</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:gap-3">
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
          <p className="text-2xl lg:text-3xl font-black text-orange-600">{statusCounts.pending}</p>
          <p className="text-[10px] lg:text-xs font-bold text-orange-500 uppercase tracking-wider">Pending</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-2xl lg:text-3xl font-black text-green-600">{statusCounts.confirmed}</p>
          <p className="text-[10px] lg:text-xs font-bold text-green-500 uppercase tracking-wider">Confirmed</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
          <p className="text-2xl lg:text-3xl font-black text-blue-600">{statusCounts.checked_in}</p>
          <p className="text-[10px] lg:text-xs font-bold text-blue-500 uppercase tracking-wider">Checked In</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-2xl lg:text-3xl font-black text-gray-600">{statusCounts.completed}</p>
          <p className="text-[10px] lg:text-xs font-bold text-gray-500 uppercase tracking-wider">Completed</p>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex flex-wrap gap-1.5 lg:gap-2">
        {[
          { key: 'all' as const, label: 'All Active' },
          { key: 'pending' as const, label: 'Pending' },
          { key: 'confirmed' as const, label: 'Confirmed' },
          { key: 'checked_in' as const, label: 'Checked In' },
          { key: 'completed' as const, label: 'Completed' },
        ].map((filter) => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-3 py-1.5 lg:px-4 lg:py-2 rounded-lg font-medium text-xs lg:text-sm transition-colors ${
              activeFilter === filter.key
                ? 'bg-red-600 text-white shadow-md'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {filter.label} ({statusCounts[filter.key]})
          </button>
        ))}
      </div>

      {/* Reservations Grid */}
      {reservations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 lg:p-12 text-center border border-gray-200">
          <span className="text-5xl mb-4 block">📅</span>
          <p className="text-gray-700 text-lg font-semibold">No reservations found</p>
          <p className="text-gray-400 text-sm mt-2">
            Reservations from customers will appear here automatically.
            <br />Keep this page open to receive real-time updates.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all overflow-hidden">
              {/* Status Header Bar */}
              <div className={`px-4 py-2 ${getStatusColor(reservation.status)} flex items-center justify-between`}>
                <span className="text-xs font-bold uppercase tracking-wider">
                  {reservation.status.replace('_', ' ')}
                </span>
                <span className="text-[10px] opacity-80">{getTimeAgo(reservation.created_at)}</span>
              </div>

              <div className="p-3 lg:p-4">
                {/* Reservation Info */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-sm lg:text-base font-bold text-gray-900">{reservation.reservation_code}</h3>
                    <p className="text-xs text-gray-500">{reservation.customer_name}</p>
                  </div>
                  {reservation.table_number && (
                    <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-semibold">
                      Table #{reservation.table_number}
                    </span>
                  )}
                </div>
                
                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs">{formatDate(reservation.reservation_date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs">{formatTime(reservation.reservation_time)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-600">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="text-xs">{reservation.number_of_guests} Guests</span>
                  </div>
                  {reservation.contact_phone && (
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span className="text-xs">{reservation.contact_phone}</span>
                    </div>
                  )}
                </div>

                {/* Special Requests */}
                {reservation.special_requests && (
                  <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-2 mb-3">
                    <p className="text-[10px] font-bold text-yellow-700 uppercase mb-0.5">Special Request</p>
                    <p className="text-xs text-yellow-800">{reservation.special_requests}</p>
                  </div>
                )}

                {/* Action Buttons */}
                {reservation.status === 'pending' && (
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => updateReservationStatus(reservation.id, 'confirmed')}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                    >
                      ✓ Confirm
                    </button>
                    <button
                      onClick={() => updateReservationStatus(reservation.id, 'cancelled')}
                      className="flex-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-200 transition-colors"
                    >
                      ✕ Decline
                    </button>
                  </div>
                )}
                {reservation.status === 'confirmed' && (
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => updateReservationStatus(reservation.id, 'checked_in')}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                    >
                      Check In
                    </button>
                    <button
                      onClick={() => updateReservationStatus(reservation.id, 'cancelled')}
                      className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {reservation.status === 'checked_in' && (
                  <div className="pt-2 border-t border-gray-100">
                    <button
                      onClick={() => updateReservationStatus(reservation.id, 'completed')}
                      className="w-full px-3 py-2 bg-gray-600 text-white rounded-lg text-xs font-semibold hover:bg-gray-700 transition-colors"
                    >
                      Mark Complete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
