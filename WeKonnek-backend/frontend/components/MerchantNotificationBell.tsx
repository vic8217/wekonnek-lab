'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import { portalNotificationDestination, safeNotificationDestination } from '@/lib/notification-destination';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  data?: Record<string, string> | null;
  createdAt: string;
}

interface MerchantNotificationBellProps {
  /** Visual variant — `light` for the red mobile header, `dark` for the white desktop header. */
  variant?: 'light' | 'dark';
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function iconFor(type: string, kind?: string): { bg: string; color: string; path: string } {
  if (type === 'inventory_alert' || kind === 'low_stock' || kind === 'out_of_stock') {
    return {
      bg: 'bg-red-100',
      color: 'text-red-600',
      path: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    };
  }
  if (kind === 'new_booking' || type === 'reservation') {
    return {
      bg: 'bg-purple-100',
      color: 'text-purple-600',
      path: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    };
  }
  if (type === 'order_update' || kind === 'new_order') {
    return {
      bg: 'bg-blue-100',
      color: 'text-blue-600',
      path: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',
    };
  }
  return {
    bg: 'bg-gray-100',
    color: 'text-gray-600',
    path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };
}

function destinationFor(n: ApiNotification): string {
  const supplied = n.data?.url;
  const safe = safeNotificationDestination(supplied);
  if (safe) return safe;
  const kind = n.data?.kind;
  if (n.type === 'inventory_alert' || kind === 'low_stock' || kind === 'out_of_stock') {
    return '/merchant/inventory?filter=low_stock';
  }
  if (kind === 'new_booking' || n.type === 'reservation') return '/merchant/bookings';
  if (n.type === 'order_update' || kind === 'new_order') return '/merchant/orders';
  return '/merchant/notifications';
}

export default function MerchantNotificationBell({ variant = 'dark' }: MerchantNotificationBellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/notifications?limit=8`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const list: ApiNotification[] = Array.isArray(data) ? data : data.data || [];
      setItems(list);
      setUnread(typeof data.unreadCount === 'number' ? data.unreadCount : list.filter((n) => !n.isRead).length);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 45_000);
    const refresh = () => void fetchNotifications();
    window.addEventListener('wk:notifications-updated', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('wk:notifications-updated', refresh);
    };
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await fetchNotifications();
      setLoading(false);
    }
  };

  const handleItemClick = async (n: ApiNotification) => {
    setOpen(false);
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      const token = getToken();
      if (token) {
        fetch(`${API_URL}/api/notifications/${n.id}/read`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
      }
    }
    const destination = destinationFor(n);
    router.push(portalNotificationDestination(destination, pathname) || '/merchant/notifications');
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnread(0);
    const token = getToken();
    if (token) {
      fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  };

  const bellColor = variant === 'light' ? 'text-white' : 'text-gray-600';
  const hoverBg = variant === 'light' ? 'hover:bg-white/10' : 'hover:bg-gray-100';

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={toggleOpen}
        className={`relative p-2 rounded-full transition-colors ${hoverBg}`}
        title="Notifications"
        aria-label="Notifications"
      >
        <svg className={`w-5 h-5 ${bellColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span
            className={`absolute top-0.5 right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold px-0.5 ${
              variant === 'light'
                ? 'bg-yellow-400 text-red-900 border-2 border-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs font-semibold text-[#DB0002] hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-6 h-6 border-2 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 px-4">
                <p className="text-sm text-gray-500 font-medium">No notifications</p>
                <p className="text-xs text-gray-400 mt-1">You&apos;re all caught up!</p>
              </div>
            ) : (
              items.map((n) => {
                const ic = iconFor(n.type, n.data?.kind);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      !n.isRead ? 'bg-red-50/40' : ''
                    }`}
                  >
                    <div className={`w-9 h-9 ${ic.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
                      <svg className={`w-4.5 h-4.5 ${ic.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ic.path} />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm truncate flex-1 ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {n.title}
                        </p>
                        {!n.isRead && <span className="w-2 h-2 bg-[#DB0002] rounded-full flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              router.push('/merchant/notifications');
            }}
            className="w-full text-center py-3 text-sm font-semibold text-[#DB0002] hover:bg-gray-50 border-t border-gray-100 transition-colors"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
