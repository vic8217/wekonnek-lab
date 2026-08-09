import Link from 'next/link';
import { Home, Package } from 'lucide-react';
import InquiryBadge from './InquiryBadge';

type ListingType = 'bazaar' | 'property';

export default function ListingSummaryCard({ type, activeCount, expiredCount, unreadInquiryCount, loading = false }: {
  type: ListingType; activeCount: number; expiredCount: number; unreadInquiryCount: number; loading?: boolean;
}) {
  const bazaar = type === 'bazaar';
  const Icon = bazaar ? Package : Home;
  const manageHref = `/my/listings?type=${type}`;
  const inquiryHref = `/my/inquiries?type=${type}`;
  return (
    <article className={`min-w-0 rounded-2xl border p-3.5 ${bazaar ? 'border-red-100 bg-red-50/60' : 'border-blue-100 bg-blue-50/60'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border bg-white ${bazaar ? 'border-red-200 text-[#DB0002]' : 'border-blue-200 text-blue-600'}`}>
          <Icon size={20} strokeWidth={2} />
        </span>
        <h3 className="text-sm font-bold text-slate-900">{bazaar ? 'Bazaar Listings' : 'Property Listings'}</h3>
      </div>
      <div className="mt-3 flex items-end gap-2">
        {loading ? <span className="h-8 w-10 animate-pulse rounded bg-slate-200" /> : <strong className="text-3xl leading-none text-slate-950">{activeCount}</strong>}
        <span className="pb-0.5 text-xs font-bold text-slate-900">Active</span>
      </div>
      <p className="mt-1 text-xs text-slate-600"><strong className="text-slate-950">{loading ? '—' : expiredCount}</strong> Expired</p>
      <div className="mt-2 min-h-4"><InquiryBadge count={unreadInquiryCount} /></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link href={manageHref} className="flex min-h-10 items-center justify-center rounded-lg border border-[#DB0002] px-2 text-center text-[11px] font-bold text-[#DB0002]">Manage</Link>
        <Link href={inquiryHref} className="relative flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-2 text-center text-[11px] font-bold text-[#DB0002]">
          Inquiries
          {unreadInquiryCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#DB0002] px-1 text-[9px] text-white">{unreadInquiryCount > 99 ? '99+' : unreadInquiryCount}</span>}
        </Link>
      </div>
    </article>
  );
}
