'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { getToken, useAuth } from '@/hooks/use-auth';

type Notification = { id: string; title: string; body: string; type: string; data?: { url?: string }; isRead: boolean; createdAt: string };
const PAGE_SIZE = 20;
const safePath = (value?: string) => value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : undefined;

export default function CustomerNotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (offset = 0) => {
    const token = getToken(); if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/backend/notifications?limit=${PAGE_SIZE}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load notifications');
      const body = await response.json(); setItems(current => offset ? [...current, ...(body.data || [])] : body.data || []); setTotal(body.total || 0); setUnread(body.unreadCount || 0);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) void load(); }, [load, user]);
  const open = async (item: Notification) => {
    const token = getToken();
    if (token && !item.isRead) await fetch(`/api/backend/notifications/${item.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
    setItems(current => current.map(value => value.id === item.id ? { ...value, isRead: true } : value)); setUnread(value => Math.max(0, value - (item.isRead ? 0 : 1)));
    const target = safePath(item.data?.url); if (target) router.push(target);
  };
  const readAll = async () => {
    const token = getToken(); if (!token) return;
    await fetch('/api/backend/notifications/read-all', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
    setItems(current => current.map(item => ({ ...item, isRead: true }))); setUnread(0);
  };
  return <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8"><div className="mb-5 flex items-start justify-between gap-3"><div><h1 className="text-2xl font-black text-slate-900">Notifications</h1><p className="text-sm text-slate-500">{unread} unread</p></div><button type="button" disabled={!unread} onClick={() => void readAll()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40"><CheckCheck size={17}/>Mark all read</button></div><section className="overflow-hidden rounded-2xl border bg-white shadow-sm">{items.map(item => <button key={item.id} type="button" onClick={() => void open(item)} className={`flex w-full gap-3 border-b p-4 text-left last:border-0 ${item.isRead ? 'bg-white' : 'bg-red-50'}`}><span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${item.isRead ? 'bg-slate-100 text-slate-500' : 'bg-red-600 text-white'}`}><Bell size={17}/></span><span className="min-w-0 flex-1"><span className="block font-bold text-slate-900">{item.title}</span><span className="mt-1 block text-sm text-slate-600">{item.body}</span><span className="mt-1 block text-xs text-slate-400">{new Date(item.createdAt).toLocaleString('en-PH')}</span></span></button>)}{!loading && !items.length && <div className="p-12 text-center text-sm text-slate-500"><Bell className="mx-auto mb-3"/>No notifications yet.</div>}{loading && <p className="p-8 text-center text-sm text-slate-500">Loading…</p>}</section>{items.length < total && <div className="mt-4 text-center"><button type="button" disabled={loading} onClick={() => void load(items.length)} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold">Load more</button></div>}</div>;
}
