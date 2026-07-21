'use client';

import { useState, useEffect } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Notification {
  id: string;
  type: 'order' | 'reservation' | 'promotion' | 'review' | 'system';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  link?: string;
}

export default function CustomerNotificationsPage() {
  const { user: authUser } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    if (authUser) fetchNotifications();
  }, [authUser]);

  const fetchNotifications = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const notifs: Notification[] = [];

      const statusMessages: Record<string, string> = {
        pending: 'Your order is being processed',
        processing: 'Your order has been confirmed',
        preparing: 'Your order is being prepared by the merchant',
        ready: 'Your order is ready for pickup/delivery!',
        out_for_delivery: 'Your order is on the way!',
        completed: 'Your order has been completed',
        cancelled: 'Your order has been cancelled',
        bill_out: 'Your bill is ready',
      };

      try {
        const ordersRes = await fetch(`${API}/api/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ordersRes.ok) {
          const ordersJson = await ordersRes.json();
          const orders = (Array.isArray(ordersJson) ? ordersJson : ordersJson.data || []).slice(0, 20);

          orders.forEach((order: any) => {
            const code = order.order_code || order.orderCode;
            const merchantName = order.merchants?.name || order.merchant?.name || 'Merchant';
            notifs.push({
              id: `order-${order.id}`,
              type: 'order',
              title: `Order ${code}`,
              message: `${statusMessages[order.status] || 'Order updated'} — ${merchantName}`,
              is_read: ['completed', 'cancelled'].includes(order.status),
              created_at: order.updated_at || order.updatedAt || order.created_at || order.createdAt,
              link: '/customer/orders',
            });
          });
        }
      } catch { /* non-critical */ }

      try {
        const resRes = await fetch(`${API}/api/reservations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resRes.ok) {
          const resJson = await resRes.json();
          const reservations = (Array.isArray(resJson) ? resJson : resJson.data || []).slice(0, 10);

          const resMessages: Record<string, string> = {
            pending: 'Your reservation is pending confirmation',
            confirmed: 'Your reservation has been confirmed!',
            checked_in: 'You have checked in',
            completed: 'Your reservation is complete',
            cancelled: 'Your reservation has been cancelled',
          };

          reservations.forEach((res: any) => {
            const code = res.reservation_code || res.reservationCode;
            const merchantName = res.merchants?.name || res.merchant?.name || 'Merchant';
            notifs.push({
              id: `reservation-${res.id}`,
              type: 'reservation',
              title: `Reservation ${code}`,
              message: `${resMessages[res.status] || 'Reservation updated'} — ${merchantName}`,
              is_read: ['completed', 'cancelled'].includes(res.status),
              created_at: res.updated_at || res.updatedAt || res.created_at || res.createdAt,
              link: '/customer/orders',
            });
          });
        }
      } catch { /* non-critical */ }

      try {
        const reviewsRes = await fetch(`${API}/api/reviews`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (reviewsRes.ok) {
          const reviewsJson = await reviewsRes.json();
          const reviews = (Array.isArray(reviewsJson) ? reviewsJson : reviewsJson.data || [])
            .filter((r: any) => r.response_text || r.responseText)
            .slice(0, 5);

          reviews.forEach((review: any) => {
            const responseText = review.response_text || review.responseText || '';
            const merchantName = review.merchants?.name || review.merchant?.name || 'A merchant';
            notifs.push({
              id: `review-${review.id}`,
              type: 'review',
              title: 'Merchant Replied to Your Review',
              message: `${merchantName} responded: "${responseText.substring(0, 60)}..."`,
              is_read: true,
              created_at: review.responded_at || review.respondedAt || review.created_at || review.createdAt,
              link: '/customer/reviews',
            });
          });
        }
      } catch { /* non-critical */ }

      notifs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setNotifications(notifs);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const getTypeIcon = (type: string) => {
    const iconMap: Record<string, { bg: string; emoji: string }> = {
      order: { bg: 'bg-blue-100', emoji: '🛍️' },
      reservation: { bg: 'bg-purple-100', emoji: '📅' },
      review: { bg: 'bg-yellow-100', emoji: '⭐' },
      promotion: { bg: 'bg-green-100', emoji: '📢' },
      system: { bg: 'bg-gray-100', emoji: '🔔' },
    };
    const config = iconMap[type] || iconMap.system;
    return (
      <div className={`w-10 h-10 ${config.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
        <span className="text-lg">{config.emoji}</span>
      </div>
    );
  };

  const getTimeAgo = (dateStr: string) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };

  const filtered = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;
  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <>
      {/* ========== MOBILE NOTIFICATIONS ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-[11px] text-gray-400">{unreadCount} unread</p>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[#DB0002] text-xs font-semibold mobile-press">
                Mark all read
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === 'all' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === 'unread' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>
        </div>

        {/* Notification List */}
        <div className="mobile-scroll">
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🔔</span>
              </div>
              <p className="text-gray-500 font-medium">No notifications</p>
              <p className="text-xs text-gray-400 mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            filtered.map((notif) => (
              <div
                key={notif.id}
                onClick={() => {
                  setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
                }}
                className={`flex items-start gap-3 px-4 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors ${
                  !notif.is_read ? 'bg-red-50/30' : 'bg-white'
                }`}
              >
                {getTypeIcon(notif.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-semibold truncate flex-1 ${!notif.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                      {notif.title}
                    </h3>
                    {!notif.is_read && (
                      <div className="w-2 h-2 bg-[#DB0002] rounded-full flex-shrink-0"></div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.message}</p>
                  <p className="text-[10px] text-gray-300 mt-1">{getTimeAgo(notif.created_at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ========== DESKTOP NOTIFICATIONS ========== */}
      <div className="hidden lg:block space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Notifications</h1>
            <p className="text-gray-600">{unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-[#DB0002] text-sm font-medium hover:underline">
              Mark all as read
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${filter === 'all' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${filter === 'unread' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-lg p-12 text-center border border-gray-200">
              <p className="text-gray-500 text-lg">No notifications</p>
              <p className="text-gray-400 text-sm mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            filtered.map((notif) => (
              <div
                key={notif.id}
                className={`bg-white rounded-lg p-4 border transition-colors cursor-pointer hover:bg-gray-50 ${
                  !notif.is_read ? 'border-[#DB0002]/30 bg-red-50/30' : 'border-gray-200'
                }`}
                onClick={() => {
                  setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
                }}
              >
                <div className="flex items-start gap-3">
                  {getTypeIcon(notif.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className={`font-medium truncate ${!notif.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                        {notif.title}
                      </h3>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{getTimeAgo(notif.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{notif.message}</p>
                  </div>
                  {!notif.is_read && (
                    <div className="w-2.5 h-2.5 bg-[#DB0002] rounded-full flex-shrink-0 mt-2"></div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
