'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import { publicAssetUrl } from '@/lib/public-asset-url';

type Listing = {
  id: string; title: string; description: string; price: string; imageUrls: string[]; thumbnailUrls?: string[]; status: string; paymentStatus: string;
  paymentGateway?: string; paymentMethod?: string; paymentRef?: string; publishedAt?: string; expiresAt?: string; createdAt: string;
  suspendedAt?: string; suspensionReason?: string; subCategoryName: string;
  seller: { id: string; firstName?: string; lastName?: string; email?: string; phone: string; isActive: boolean };
};

const statusClass: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700', suspended: 'bg-red-100 text-red-700', expired: 'bg-slate-200 text-slate-700',
  draft: 'bg-amber-100 text-amber-700', payment_pending: 'bg-blue-100 text-blue-700', payment_failed: 'bg-rose-100 text-rose-700',
};
const paymentClass: Record<string, string> = { paid: 'bg-emerald-100 text-emerald-700', pending: 'bg-blue-100 text-blue-700', failed: 'bg-red-100 text-red-700', unpaid: 'bg-slate-100 text-slate-600' };
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function BazaarListingsAdminPage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [selected, setSelected] = useState<Listing | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ status, paymentStatus }); if (search.trim()) params.set('search', search.trim());
    try {
      const response = await fetch(`/api/backend/bazaar-listings/admin?${params}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'Unable to load Bazaar listings.');
      setItems(body.items || []); setCounts(body.counts || {});
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load Bazaar listings.'); }
    finally { setLoading(false); }
  }, [status, paymentStatus, search]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const suspend = async () => {
    if (!selected || reason.trim().length < 5) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/backend/bazaar-listings/admin/${selected.id}/suspend`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ reason }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'Unable to suspend listing.');
      setSelected(null); setReason(''); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to suspend listing.'); }
    finally { setSaving(false); }
  };

  const reinstate = async (listing: Listing) => {
    if (!window.confirm(`Reinstate “${listing.title}”?`)) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/backend/bazaar-listings/admin/${listing.id}/reinstate`, { method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` } });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'Unable to reinstate listing.'); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to reinstate listing.'); }
    finally { setSaving(false); }
  };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-black text-slate-950 sm:text-3xl">Bazaar Listings Management</h1><p className="mt-1 text-sm text-slate-500">Monitor paid postings, validity periods, sellers, and policy violations.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[['All',total],['Active',counts.active||0],['Pending',counts.payment_pending||0],['Suspended',counts.suspended||0],['Expired',counts.expired||0]].map(([label,value]) => <div key={String(label)} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>)}</div>
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_180px_180px]"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search item, seller, email, or phone" className="rounded-lg border px-3 py-2.5 text-sm"/><select value={status} onChange={event => setStatus(event.target.value)} className="rounded-lg border bg-white px-3 py-2.5 text-sm"><option value="all">All listing statuses</option>{['active','draft','payment_pending','payment_failed','suspended','expired'].map(value => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select><select value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)} className="rounded-lg border bg-white px-3 py-2.5 text-sm"><option value="all">All payments</option>{['paid','pending','failed','unpaid'].map(value => <option key={value}>{value}</option>)}</select></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Posting</th><th className="p-4">Posted by</th><th className="p-4">Payment</th><th className="p-4">Status</th><th className="p-4">Validity</th><th className="p-4">Action</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={6} className="p-10 text-center text-slate-500">Loading Bazaar postings…</td></tr> : !items.length ? <tr><td colSpan={6} className="p-10 text-center text-slate-500">No postings match these filters.</td></tr> : items.map(item => <tr key={item.id} className="align-top hover:bg-slate-50/70"><td className="p-4"><div className="flex gap-3"><img src={publicAssetUrl(item.thumbnailUrls?.[0] || item.imageUrls?.[0]) || ''} alt="" className="size-14 rounded-lg border bg-slate-100 object-cover"/><div><p className="font-black text-slate-900">{item.title}</p><p className="text-xs text-slate-500">{item.subCategoryName} · ₱{Number(item.price).toLocaleString()}</p><p className="mt-1 max-w-xs line-clamp-2 text-xs text-slate-500">{item.description}</p></div></div></td><td className="p-4"><p className="font-bold">{[item.seller.firstName,item.seller.lastName].filter(Boolean).join(' ') || 'Unnamed customer'}</p><p className="text-xs text-slate-500">{item.seller.phone}</p><p className="text-xs text-slate-500">{item.seller.email || 'No email'}</p></td><td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${paymentClass[item.paymentStatus] || paymentClass.unpaid}`}>{item.paymentStatus}</span><p className="mt-2 text-xs text-slate-500">{item.paymentGateway || '—'} {item.paymentMethod ? `· ${item.paymentMethod}` : ''}</p><p className="max-w-40 truncate text-[10px] text-slate-400" title={item.paymentRef}>{item.paymentRef || ''}</p></td><td className="p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusClass[item.status] || 'bg-slate-100 text-slate-700'}`}>{item.status.replaceAll('_',' ')}</span>{item.suspensionReason && <p className="mt-2 max-w-48 text-xs font-semibold text-red-600">{item.suspensionReason}</p>}</td><td className="p-4 text-xs"><p><b>Start:</b> {formatDate(item.publishedAt)}</p><p className="mt-1"><b>End:</b> {formatDate(item.expiresAt)}</p><p className="mt-2 text-slate-400">Posted {formatDate(item.createdAt)}</p></td><td className="p-4">{item.status === 'suspended' ? <button disabled={saving} onClick={() => void reinstate(item)} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50">Reinstate</button> : <button disabled={saving} onClick={() => { setSelected(item); setReason(''); }} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50">Suspend</button>}</td></tr>)}</tbody></table></div></div>
    {selected && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">Suspend Bazaar posting</h2><p className="mt-2 text-sm text-slate-600">“{selected.title}” will immediately stop appearing to customers.</p><label className="mt-5 block text-sm font-bold">Policy violation reason<textarea rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the prohibited item or policy violation" className="mt-2 w-full rounded-xl border p-3 font-normal"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={() => setSelected(null)} className="rounded-lg border px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || reason.trim().length < 5} onClick={() => void suspend()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{saving ? 'Suspending…' : 'Suspend posting'}</button></div></section></div>}
  </div>;
}
