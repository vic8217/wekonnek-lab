'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import { publicAssetUrl } from '@/lib/public-asset-url';

type Filter = 'all' | 'bazaar' | 'property';
type Inquiry = { id: string; listingType: 'BAZAAR' | 'PROPERTY'; message: string; status: string; readAt: string | null; createdAt: string; inquirer: { firstName?: string; lastName?: string; avatar?: string }; listing: { id: string; title: string; status: string; imageUrls?: string[]; thumbnailUrls?: string[] } | null };

function InquiriesContent() {
  const params = useSearchParams();
  const requested = params.get('type');
  const [filter, setFilter] = useState<Filter>(requested === 'bazaar' || requested === 'property' ? requested : 'all');
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = getToken();
      const query = filter === 'all' ? '' : `?type=${filter}`;
      const response = await fetch(`/api/backend/listing-inquiries${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body.message || 'Unable to load inquiries');
      setRows(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load inquiries'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const openInquiry = async (inquiry: Inquiry) => {
    if (!inquiry.readAt) {
      const token = getToken();
      const response = await fetch(`/api/backend/listing-inquiries/${inquiry.id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setRows(current => current.map(row => row.id === inquiry.id ? { ...row, readAt: new Date().toISOString() } : row));
    }
  };

  return <main className="mx-auto min-h-screen max-w-3xl bg-slate-50 px-4 pb-24 pt-5 sm:px-6">
    <header className="flex items-center gap-3"><Link href="/customer/profile" className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#DB0002] shadow-sm"><ArrowLeft size={21} /></Link><div><h1 className="text-2xl font-extrabold">My Inquiries</h1><p className="text-sm text-slate-500">Messages about your Bazaar and Property listings</p></div></header>
    <div className="mt-5 flex gap-2 rounded-xl bg-white p-1 shadow-sm">{(['all','bazaar','property'] as Filter[]).map(item => <button key={item} onClick={() => setFilter(item)} className={`min-h-10 flex-1 rounded-lg text-xs font-bold capitalize ${filter === item ? 'bg-[#DB0002] text-white' : 'text-slate-600'}`}>{item}</button>)}</div>
    <section className="mt-4 space-y-3">
      {loading && [1,2,3].map(item => <div key={item} className="h-36 animate-pulse rounded-2xl bg-white" />)}
      {!loading && error && <div className="rounded-2xl border border-red-100 bg-white p-5 text-center text-sm text-red-600">{error}<button onClick={load} className="mt-3 block w-full font-bold">Try again</button></div>}
      {!loading && !error && rows.length === 0 && <div className="rounded-2xl bg-white px-6 py-16 text-center"><MessageCircle className="mx-auto text-slate-300" size={38} /><h2 className="mt-3 font-bold">No inquiries yet</h2><p className="mt-1 text-sm text-slate-500">New listing inquiries will appear here.</p></div>}
      {rows.map(inquiry => {
        const name = [inquiry.inquirer.firstName, inquiry.inquirer.lastName].filter(Boolean).join(' ') || 'WEKONNEK User';
        const href = inquiry.listingType === 'BAZAAR' ? `/bazaar/listings/${inquiry.listing?.id}` : `/property/listings/${inquiry.listing?.id}`;
        const image = publicAssetUrl(inquiry.listing?.thumbnailUrls?.[0] || inquiry.listing?.imageUrls?.[0]);
        return <article key={inquiry.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${!inquiry.readAt ? 'border-red-200' : 'border-slate-100'}`}>
          <div className="flex gap-3"><div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-red-50 font-bold text-[#DB0002]">{inquiry.inquirer.avatar ? <Image src={publicAssetUrl(inquiry.inquirer.avatar)!} alt="" fill sizes="44px" className="object-cover" /> : name[0]}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-sm">{name}</strong>{!inquiry.readAt && <span className="rounded-full bg-[#DB0002] px-2 py-0.5 text-[9px] font-bold text-white">NEW</span>}</div><p className="text-xs text-slate-500">Interested in <b>{inquiry.listing?.title || 'Unavailable listing'}</b></p></div>{image && <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg"><Image src={image} alt="" fill sizes="48px" className="object-cover" /></div>}</div>
          <p className="mt-3 line-clamp-2 text-sm text-slate-700">“{inquiry.message}”</p><div className="mt-2 flex items-center justify-between text-[11px] text-slate-400"><span>{new Date(inquiry.createdAt).toLocaleString()}</span><span className="capitalize">{inquiry.status.toLowerCase()}</span></div>
          <Link href={inquiry.listing ? href : '#'} onClick={() => openInquiry(inquiry)} className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-[#DB0002] text-xs font-bold text-[#DB0002]">View Inquiry</Link>
        </article>;
      })}
    </section>
  </main>;
}

export default function MyInquiriesPage() { return <Suspense fallback={<div className="min-h-screen bg-slate-50" />}><InquiriesContent /></Suspense>; }
