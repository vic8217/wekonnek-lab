'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api';
import { getToken } from '@/hooks/use-auth';

type RfqSnapshot = {
  product?: { id?: number; name?: string; sku?: string; imageUrl?: string };
  variant?: { id?: number; sku?: string } | null;
  merchant?: { id?: number; name?: string };
  shop?: { id?: number; name?: string };
};

type BuyerQuotation = {
  id: string;
  quotationNumber?: string;
  version: number;
  status: string;
};

type BuyerRfq = {
  id: string;
  rfqNumber: string;
  merchantId: number;
  shopId: number;
  productId: number;
  quantity: number;
  status: string;
  snapshot?: RfqSnapshot | null;
  createdAt: string;
  quotations?: BuyerQuotation[];
};

const RFQ_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Open',
  VIEWED: 'Open',
  QUOTED: 'Quoted',
  REVISED: 'Revision Requested',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CONVERTED_TO_ORDER: 'Converted to Order',
  CANCELLED: 'Cancelled',
};

const QUOTATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  REVISED: 'Revised',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CONVERTED_TO_ORDER: 'Converted to Order',
  CANCELLED: 'Cancelled',
};

function statusLabel(status: string, labels: Record<string, string>): string {
  return labels[status] || status.replaceAll('_', ' ');
}

function statusClass(status: string): string {
  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
    case 'VIEWED':
      return 'bg-blue-100 text-blue-700';
    case 'QUOTED':
    case 'SENT':
      return 'bg-amber-100 text-amber-800';
    case 'REVISED':
      return 'bg-indigo-100 text-indigo-700';
    case 'ACCEPTED':
    case 'CONVERTED_TO_ORDER':
      return 'bg-emerald-100 text-emerald-700';
    case 'DECLINED':
    case 'CANCELLED':
      return 'bg-red-100 text-red-700';
    case 'EXPIRED':
      return 'bg-gray-100 text-gray-600';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function snapshotOf(rfq: BuyerRfq): RfqSnapshot {
  const raw = rfq.snapshot;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function latestQuotation(rfq: BuyerRfq): BuyerQuotation | null {
  return rfq.quotations?.[0] || null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function publicApiMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
  if (response?.status === 401) return 'Please sign in to view your quote requests.';
  const raw = response?.data?.message;
  const message = Array.isArray(raw) ? raw.filter(item => typeof item === 'string').join(', ') : raw;
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed && trimmed.length <= 280 && !trimmed.includes('\n') && !/at\s+\S+\s+\(/.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

export default function BuyerRfqListPage() {
  const [rfqs, setRfqs] = useState<BuyerRfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      if (!getToken()) {
        setError('Please sign in to view your quote requests.');
        setLoading(false);
        return;
      }
      try {
        const response = await apiClient.get<BuyerRfq[]>('/backend/rfqs/mine');
        if (cancelled) return;
        setRfqs(Array.isArray(response.data) ? response.data : []);
      } catch (caught) {
        if (cancelled) return;
        const message = publicApiMessage(caught, 'Unable to load your quote requests. Please try again.');
        setError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-[#DB0002] border-t-transparent" />
          <p className="text-sm text-gray-400">Loading quote requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 lg:bg-transparent">
      <div className="px-4 pt-4 pb-3 lg:px-0 lg:pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 lg:text-3xl">My RFQs</h1>
            <p className="mt-1 text-sm text-gray-500 lg:text-gray-600">Quote requests you have sent to merchants</p>
          </div>
          <Link
            href="/customer/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#DB0002] px-4 text-sm font-semibold text-white active:bg-[#B80002]"
          >
            Request a Quote
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-2 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm text-red-800 lg:mx-0">
          {error}
        </div>
      ) : rfqs.length === 0 ? (
        <div className="px-4 py-16 text-center lg:px-0">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
            <svg className="h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v14l-7-3-7 3V6a2 2 0 012-2z" />
            </svg>
          </div>
          <p className="font-medium text-gray-500">You don&apos;t have any quote requests yet.</p>
          <p className="mt-1 text-xs text-gray-400">Open a product and tap Request a Quote to get started.</p>
          <Link href="/customer/dashboard" className="mt-4 inline-block rounded-full bg-[#DB0002] px-5 py-2 text-sm font-semibold text-white">
            Browse products
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3 px-4 pb-6 lg:hidden">
            {rfqs.map(rfq => (
              <RfqCard key={rfq.id} rfq={rfq} />
            ))}
          </div>
          <div className="hidden lg:block">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_80px_140px_minmax(0,1fr)_88px] gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
                <span>RFQ</span>
                <span>Product / Merchant</span>
                <span>Qty</span>
                <span>Created</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
              {rfqs.map(rfq => (
                <RfqRow key={rfq.id} rfq={rfq} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RfqCard({ rfq }: { rfq: BuyerRfq }) {
  const snapshot = snapshotOf(rfq);
  const quote = latestQuotation(rfq);
  const productName = snapshot.product?.name;
  const merchantName = snapshot.merchant?.name;
  const shopName = snapshot.shop?.name;

  return (
    <article className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-gray-400">{rfq.rfqNumber}</p>
          <h2 className="truncate text-sm font-bold text-gray-900">{productName || `Product #${rfq.productId}`}</h2>
          {(merchantName || shopName) && (
            <p className="truncate text-[11px] text-gray-400">
              {[merchantName, shopName].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(rfq.status)}`}>
          {statusLabel(rfq.status, RFQ_STATUS_LABELS)}
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-gray-50 px-4 py-2.5 text-xs text-gray-500">
        <span>Qty {rfq.quantity}</span>
        <span>{formatDate(rfq.createdAt)}</span>
      </div>
      {quote && (
        <p className="px-4 pb-2 text-[11px] text-gray-400">
          Quotation v{quote.version}: {statusLabel(quote.status, QUOTATION_STATUS_LABELS)}
        </p>
      )}
      <div className="border-t border-gray-50 px-4 py-3">
        <Link
          href={`/customer/rfq/${rfq.id}`}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#DB0002] px-4 text-sm font-semibold text-white"
        >
          View
        </Link>
      </div>
    </article>
  );
}

function RfqRow({ rfq }: { rfq: BuyerRfq }) {
  const snapshot = snapshotOf(rfq);
  const quote = latestQuotation(rfq);
  const productName = snapshot.product?.name;
  const merchantName = snapshot.merchant?.name;
  const shopName = snapshot.shop?.name;

  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_80px_140px_minmax(0,1fr)_88px] items-center gap-3 border-b border-gray-100 px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="font-mono text-xs text-gray-400">{rfq.rfqNumber}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-gray-900">{productName || `Product #${rfq.productId}`}</p>
        {(merchantName || shopName) && (
          <p className="truncate text-xs text-gray-500">{[merchantName, shopName].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <p className="text-sm text-gray-700">{rfq.quantity}</p>
      <p className="text-sm text-gray-500">{formatDate(rfq.createdAt)}</p>
      <div className="min-w-0">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(rfq.status)}`}>
          {statusLabel(rfq.status, RFQ_STATUS_LABELS)}
        </span>
        {quote && (
          <p className="mt-1 truncate text-xs text-gray-400">
            Quote v{quote.version}: {statusLabel(quote.status, QUOTATION_STATUS_LABELS)}
          </p>
        )}
      </div>
      <div className="text-right">
        <Link
          href={`/customer/rfq/${rfq.id}`}
          className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#DB0002] px-3 text-sm font-semibold text-white"
        >
          View
        </Link>
      </div>
    </div>
  );
}
