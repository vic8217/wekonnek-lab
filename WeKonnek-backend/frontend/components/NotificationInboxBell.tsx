'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import { safeNotificationDestination } from '@/lib/notification-destination';

type Item = { id: string; title: string; body: string; isRead: boolean; data?: { url?: string }; createdAt: string };

export default function NotificationInboxBell({ light = false }: { light?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    const token = getToken(); if (!token) return;
    const response = await fetch('/api/backend/notifications?limit=8', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) return;
    const body = await response.json(); setItems(body.data || []); setUnread(body.unreadCount || 0);
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 45_000); const refresh = () => void load(); window.addEventListener('wk:notifications-updated', refresh); return () => { window.clearInterval(timer); window.removeEventListener('wk:notifications-updated', refresh); }; }, [load]);
  const select = async (item: Item) => {
    const token = getToken();
    if (token && !item.isRead) await fetch(`/api/backend/notifications/${item.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    setOpen(false); setUnread(value => Math.max(0, value - (item.isRead ? 0 : 1)));
    const target = safeNotificationDestination(item.data?.url); if (target) router.push(target);
  };
  return <div className="relative"><button type="button" onClick={() => setOpen(value => !value)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className={`relative rounded-full p-2 ${light ? 'text-white hover:bg-white/15' : 'text-slate-600 hover:bg-slate-100'}`}><Bell size={20}/>{unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-black text-white">{unread > 99 ? '99+' : unread}</span>}</button>{open && <div className="absolute right-0 z-[90] mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-white text-slate-900 shadow-2xl"><div className="flex items-center justify-between border-b px-4 py-2 font-black"><span>Notifications</span><button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="grid size-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18}/></button></div><div className="max-h-80 overflow-y-auto">{items.length ? items.map(item => <button key={item.id} type="button" onClick={() => void select(item)} className={`block w-full border-b px-4 py-3 text-left last:border-0 ${item.isRead ? 'bg-white' : 'bg-red-50'}`}><span className="block text-sm font-bold">{item.title}</span><span className="mt-0.5 block text-xs text-slate-600">{item.body}</span></button>) : <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>}</div></div>}</div>;
}
