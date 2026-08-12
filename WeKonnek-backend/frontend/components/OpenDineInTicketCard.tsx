'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clock3, ReceiptText } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

type OpenTicket = {
  id: number;
  order_code?: string;
  order_type?: string;
  status?: string;
  table_number?: string;
  total_amount?: number;
  created_at?: string;
  payment_method?: string;
  merchants?: { name?: string } | null;
  merchant?: { name?: string } | null;
};

const CLOSED = new Set(['completed', 'cancelled', 'delivered']);
const STATUS_LABELS: Record<string, string> = {
  pending: 'Order placed',
  processing: 'Order accepted',
  preparing: 'Preparing',
  ready: 'Served',
  bill_out: 'Bill-out requested',
  payment_pending: 'Payment pending',
};

export default function OpenDineInTicketCard() {
  const pathname = usePathname();
  const [ticket, setTicket] = useState<OpenTicket | null>(null);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return setTicket(null);
    try {
      const response = await fetch('/api/backend/orders/my-orders', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const body = await response.json();
      const rows: OpenTicket[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      const open = rows
        .filter(order => ['dine_in', 'in_store'].includes(order.order_type || '') && !CLOSED.has((order.status || '').toLowerCase()))
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0];
      setTicket(open || null);
    } catch {
      // Keep navigation unobtrusive when the background refresh is unavailable.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  if (!ticket || pathname.startsWith(`/customer/orders/${ticket.id}`)) return null;

  const status = (ticket.status || 'pending').toLowerCase();
  const manual = status === 'payment_pending' && ticket.payment_method === 'cash';
  const label = manual ? 'Manual payment · Waiting for crew' : STATUS_LABELS[status] || status.replaceAll('_', ' ');
  const merchantName = ticket.merchants?.name || ticket.merchant?.name || 'Dine-in order';

  return <Link href={`/customer/orders/${ticket.id}`} className="fixed bottom-24 left-3 right-3 z-40 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl transition hover:-translate-y-0.5 hover:shadow-xl xl:bottom-6 xl:left-auto xl:right-6 xl:w-96">
    <div className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-red-600 text-white"><ReceiptText className="size-5"/></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2"><b className="truncate text-sm">Open dine-in ticket</b><span className="shrink-0 rounded-full bg-red-50 px-2 py-1 text-[10px] font-black text-red-700">OPEN</span></span>
        <span className="mt-0.5 block truncate text-xs text-slate-600">{merchantName} · {ticket.table_number || 'Table'}</span>
        <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-800"><Clock3 className="size-3"/>{label}</span>
      </span>
      <span className="shrink-0 text-sm font-black text-red-600">View →</span>
    </div>
  </Link>;
}
