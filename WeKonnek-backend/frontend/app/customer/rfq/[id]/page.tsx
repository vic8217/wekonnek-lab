'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
  wkOrderId?: number | null;
  version: number;
  status: string;
  unitPrice?: string | number;
  subtotal?: string | number;
  discount?: string | number;
  tax?: string | number;
  deliveryCharge?: string | number;
  otherCharges?: string | number;
  total?: string | number;
  leadTime?: string | null;
  promisedDate?: string | null;
  validUntil?: string;
  paymentTerms?: string | null;
  merchantNotes?: string | null;
  returnCancellationTerms?: string | null;
  revisionRequest?: string | null;
  sentAt?: string | null;
  declinedAt?: string | null;
  convertedAt?: string | null;
  createdAt?: string;
};

type BuyerRfqDetail = {
  id: string;
  rfqNumber: string;
  merchantId: number;
  shopId: number;
  productId: number;
  quantity: number;
  specifications?: string | null;
  size?: string | null;
  color?: string | null;
  customization?: string | null;
  requiredDate?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  snapshot?: RfqSnapshot | null;
  status: string;
  submittedAt?: string | null;
  cancelledAt?: string | null;
  declinedAt?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  quotations?: BuyerQuotation[];
};

type LoadState = 'loading' | 'ready' | 'unauthorized' | 'forbidden' | 'notfound' | 'failure';

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
  CONVERTED_TO_ORDER: 'Converted',
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

function snapshotOf(rfq: BuyerRfqDetail): RfqSnapshot {
  const raw = rfq.snapshot;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function money(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TERMINAL_RFQ_STATUSES = new Set(['CANCELLED', 'CONVERTED_TO_ORDER', 'DECLINED', 'EXPIRED', 'ACCEPTED']);
const CANCELLABLE_RFQ_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'VIEWED', 'QUOTED', 'REVISED']);
const REVISION_NOTE_MAX = 2000;

function isQuotationExpired(quotation: BuyerQuotation): boolean {
  if (!quotation.validUntil) return quotation.status === 'EXPIRED';
  return quotation.status === 'EXPIRED' || new Date(quotation.validUntil) <= new Date();
}

function isCurrentQuotationActionable(rfq: BuyerRfqDetail, quotation: BuyerQuotation, isLatest: boolean): boolean {
  if (!isLatest) return false;
  if (quotation.status !== 'SENT') return false;
  if (quotation.wkOrderId != null) return false;
  if (TERMINAL_RFQ_STATUSES.has(rfq.status)) return false;
  if (isQuotationExpired(quotation)) return false;
  return true;
}

function canCancelRfq(rfq: BuyerRfqDetail): boolean {
  if (!CANCELLABLE_RFQ_STATUSES.has(rfq.status)) return false;
  if (rfq.quotations?.some(quotation => quotation.wkOrderId != null || quotation.status === 'CONVERTED_TO_ORDER')) {
    return false;
  }
  return true;
}

function publicApiMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
  if (response?.status === 401) return 'Please sign in to continue.';
  if (response?.status === 403) return 'You cannot change this quotation.';
  if (response?.status === 404) return 'This quotation is no longer available.';
  if (response?.status === 409) return 'This quotation has already changed. The latest details are shown.';
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

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="rfq-action-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="rfq-action-title" className="text-lg font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 text-right font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/customer/rfq" className="inline-flex items-center gap-1 text-sm font-medium text-[#DB0002] hover:underline">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to My RFQs
    </Link>
  );
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 text-center">
      <BackLink />
      <p className="mt-6 font-medium text-gray-800">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
      <Link href="/customer/rfq" className="mt-4 inline-block rounded-full bg-[#DB0002] px-5 py-2 text-sm font-semibold text-white">
        Back to My RFQs
      </Link>
    </div>
  );
}

function QuotationTerms({ quotation, quantity }: { quotation: BuyerQuotation; quantity: number }) {
  const unitPrice = money(quotation.unitPrice);
  const subtotal = money(quotation.subtotal);
  const discount = money(quotation.discount);
  const tax = money(quotation.tax);
  const deliveryCharge = money(quotation.deliveryCharge);
  const otherCharges = money(quotation.otherCharges);
  const total = money(quotation.total);

  return (
    <div className="divide-y divide-gray-50">
      <DetailRow label="Version" value={`Version ${quotation.version}`} />
      {quotation.quotationNumber && <DetailRow label="Quotation" value={quotation.quotationNumber} />}
      <div className="flex justify-between gap-4 py-2 text-sm">
        <span className="text-gray-500">Status</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(quotation.status)}`}>
          {statusLabel(quotation.status, QUOTATION_STATUS_LABELS)}
        </span>
      </div>
      <DetailRow label="Quantity" value={quantity} />
      <DetailRow label="Unit price" value={unitPrice} />
      <DetailRow label="Subtotal" value={subtotal} />
      {discount && Number(quotation.discount) !== 0 && <DetailRow label="Discount" value={discount} />}
      <DetailRow label="Tax" value={tax} />
      {deliveryCharge && Number(quotation.deliveryCharge) !== 0 && <DetailRow label="Delivery charge" value={deliveryCharge} />}
      <DetailRow label="Other charges" value={otherCharges} />
      <div className="flex justify-between gap-4 py-3 text-sm">
        <span className="font-semibold text-gray-700">Total</span>
        <span className="text-lg font-bold text-gray-900">{total || '—'}</span>
      </div>
      <DetailRow label="Valid until" value={formatDateTime(quotation.validUntil)} />
      <DetailRow label="Lead time" value={quotation.leadTime} />
      <DetailRow label="Promised date" value={formatDate(quotation.promisedDate)} />
      <DetailRow label="Payment terms" value={quotation.paymentTerms} />
      <DetailRow label="Merchant note" value={quotation.merchantNotes} />
      <DetailRow label="Return / cancellation terms" value={quotation.returnCancellationTerms} />
      <DetailRow label="Revision request" value={quotation.revisionRequest} />
    </div>
  );
}

export default function BuyerRfqDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [rfq, setRfq] = useState<BuyerRfqDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [pendingAction, setPendingAction] = useState<'accept' | 'decline' | 'revision' | 'cancel' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'decline' | 'cancel' | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');

  const refreshRfq = useCallback(async () => {
    if (!id) return;
    if (!getToken()) {
      setState('unauthorized');
      return;
    }
    try {
      const response = await apiClient.get<BuyerRfqDetail>(`/backend/rfqs/mine/${id}`);
      setRfq(response.data);
      setState('ready');
    } catch (error) {
      toast.error(publicApiMessage(error, 'Unable to refresh this quote request.'));
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;

    async function load() {
      if (!getToken()) {
        if (!cancelled) setState('unauthorized');
        return;
      }
      try {
        const response = await apiClient.get<BuyerRfqDetail>(`/backend/rfqs/mine/${id}`);
        if (cancelled) return;
        setRfq(response.data);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401) setState('unauthorized');
        else if (status === 403) setState('forbidden');
        else if (status === 404) setState('notfound');
        else setState('failure');
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [id]);

  const runCancel = async () => {
    if (!rfq || pendingAction) return;
    if (!canCancelRfq(rfq)) {
      toast.error('This quote request cannot be cancelled.');
      await refreshRfq();
      return;
    }
    setPendingAction('cancel');
    try {
      await apiClient.patch(`/backend/rfqs/mine/${rfq.id}/cancel`);
      toast.success('Quote request cancelled.');
      setConfirmAction(null);
      await refreshRfq();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      toast.error(publicApiMessage(error, 'Unable to cancel this quote request. Please try again.'));
      if (status === 400 || status === 403 || status === 404 || status === 409) {
        setConfirmAction(null);
        if (status === 404) setState('notfound');
        else await refreshRfq();
      }
    } finally {
      setPendingAction(null);
    }
  };

  const runAction = async (action: 'accept' | 'decline' | 'revision') => {
    if (!rfq || pendingAction) return;
    const quotations = [...(rfq.quotations || [])].sort((a, b) => b.version - a.version);
    const current = quotations[0];
    if (!current || !isCurrentQuotationActionable(rfq, current, true)) {
      toast.error('This quotation is no longer available.');
      await refreshRfq();
      return;
    }
    if (action === 'revision') {
      const note = revisionNote.trim();
      if (!note || note.length > REVISION_NOTE_MAX) {
        toast.error('A revision request of up to 2,000 characters is required.');
        return;
      }
    }
    setPendingAction(action);
    try {
      if (action === 'accept') {
        await apiClient.post(`/backend/rfqs/quotations/${current.id}/accept`);
        toast.success('Quote accepted. An order was created from this quotation.');
      } else if (action === 'decline') {
        await apiClient.post(`/backend/rfqs/quotations/${current.id}/decline`);
        toast.success('Quote declined.');
      } else {
        await apiClient.post(`/backend/rfqs/quotations/${current.id}/request-revision`, { note: revisionNote.trim() });
        toast.success('Revision requested.');
      }
      setConfirmAction(null);
      setRevisionOpen(false);
      setRevisionNote('');
      await refreshRfq();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      toast.error(publicApiMessage(error, 'Unable to update this quotation. Please try again.'));
      if (status === 400 || status === 403 || status === 404 || status === 409) {
        setConfirmAction(null);
        setRevisionOpen(false);
        await refreshRfq();
      }
    } finally {
      setPendingAction(null);
    }
  };

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-[#DB0002] border-t-transparent" />
          <p className="text-sm text-gray-400">Loading quote request...</p>
        </div>
      </div>
    );
  }

  if (state === 'unauthorized') {
    return <ErrorState title="Please sign in" body="Sign in to view this quote request." />;
  }
  if (state === 'forbidden') {
    return <ErrorState title="You cannot view this quote request" body="This quote request is not available on your account." />;
  }
  if (state === 'notfound') {
    return <ErrorState title="Quote request not found" body="This quote request may have been removed or does not belong to your account." />;
  }
  if (state === 'failure' || !rfq) {
    return <ErrorState title="Unable to load this quote request" body="Please try again in a moment." />;
  }

  const snapshot = snapshotOf(rfq);
  const quotations = [...(rfq.quotations || [])].sort((a, b) => b.version - a.version);
  const current = quotations[0] || null;
  const history = quotations.slice(1);
  const convertedQuote = quotations.find(quotation => quotation.wkOrderId != null || quotation.status === 'CONVERTED_TO_ORDER') || null;
  const productName = snapshot.product?.name;
  const merchantName = snapshot.merchant?.name;
  const shopName = snapshot.shop?.name;
  const actionsEnabled = Boolean(current && isCurrentQuotationActionable(rfq, current, true));
  const cancelEnabled = canCancelRfq(rfq);
  const busy = pendingAction !== null;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-4 lg:bg-transparent lg:px-0 lg:py-0">
      <BackLink />

      <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs text-gray-400">{rfq.rfqNumber}</p>
          <h1 className="text-xl font-bold text-gray-900 lg:text-3xl">{productName || `Product #${rfq.productId}`}</h1>
          {(merchantName || shopName) && (
            <p className="mt-1 text-sm text-gray-500">{[merchantName, shopName].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${statusClass(rfq.status)}`}>
          {statusLabel(rfq.status, RFQ_STATUS_LABELS)}
        </span>
      </header>

      {rfq.status === 'EXPIRED' && (
        <p className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">This quote request has expired.</p>
      )}
      {rfq.status === 'CANCELLED' && (
        <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          This quote request was cancelled{rfq.cancelledAt ? ` on ${formatDateTime(rfq.cancelledAt)}` : ''}.
        </p>
      )}
      {rfq.status === 'DECLINED' && (
        <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          This quote request was declined{rfq.declinedAt ? ` on ${formatDateTime(rfq.declinedAt)}` : ''}.
        </p>
      )}

      {convertedQuote && (
        <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-800">Converted to Order</h2>
          <div className="mt-2 divide-y divide-emerald-100">
            {convertedQuote.wkOrderId != null && <DetailRow label="WkOrder ID" value={convertedQuote.wkOrderId} />}
            <DetailRow label="Accepted quotation" value={`Version ${convertedQuote.version}`} />
            <DetailRow label="Frozen total" value={money(convertedQuote.total)} />
          </div>
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Request</h2>
        <div className="mt-3 flex gap-4">
          {snapshot.product?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={snapshot.product.imageUrl} alt={productName || 'Product'} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0 flex-1 divide-y divide-gray-50">
            <DetailRow label="Quantity" value={rfq.quantity} />
            <DetailRow label="Created" value={formatDateTime(rfq.createdAt)} />
            <DetailRow label="SKU" value={snapshot.product?.sku || snapshot.variant?.sku} />
            <DetailRow label="Size" value={rfq.size} />
            <DetailRow label="Color" value={rfq.color} />
            <DetailRow label="Required date" value={formatDate(rfq.requiredDate)} />
          </div>
        </div>
        {rfq.specifications && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Specifications</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{rfq.specifications}</p>
          </div>
        )}
        {rfq.customization && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customization</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{rfq.customization}</p>
          </div>
        )}
        {rfq.notes && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Buyer note</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{rfq.notes}</p>
          </div>
        )}
        {rfq.deliveryAddress && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Delivery address</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{rfq.deliveryAddress}</p>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Current / latest quotation</h2>
        {current ? (
          <div className="mt-3">
            <QuotationTerms quotation={current} quantity={rfq.quantity} />
            {actionsEnabled && (
              <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAction('accept')}
                  className="flex-1 rounded-2xl bg-[#DB0002] py-3 text-sm font-semibold text-white active:bg-[#B80002] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingAction === 'accept' ? 'Accepting…' : 'Accept Quote'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRevisionOpen(true)}
                  className="flex-1 rounded-2xl border-2 border-[#DB0002] py-3 text-sm font-semibold text-[#DB0002] active:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Request Revision
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmAction('decline')}
                  className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 active:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingAction === 'decline' ? 'Declining…' : 'Decline Quote'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No quotation has been sent yet.</p>
        )}
      </section>

      {cancelEnabled && (
        <div className="mt-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmAction('cancel')}
            className="w-full rounded-2xl border border-red-200 py-3 text-sm font-semibold text-red-700 active:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-6"
          >
            Cancel RFQ
          </button>
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-4 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Quotation history</h2>
          {history.map(quotation => (
            <article key={quotation.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-bold text-gray-900">Version {quotation.version}</h3>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(quotation.status)}`}>
                  {statusLabel(quotation.status, QUOTATION_STATUS_LABELS)}
                </span>
              </div>
              <QuotationTerms quotation={quotation} quantity={rfq.quantity} />
            </article>
          ))}
        </section>
      )}

      {confirmAction === 'accept' && (
        <Dialog title="Accept this quote?" onClose={() => !busy && setConfirmAction(null)}>
          <p className="mt-3 text-sm text-gray-600">This quotation will be accepted. An order will be created from the accepted quotation, and the quoted commercial terms will become the order terms.</p>
          {current && <p className="mt-3 text-sm font-semibold text-gray-900">Total {money(current.total) || '—'}</p>}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy} onClick={() => setConfirmAction(null)} className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void runAction('accept')} className="flex-1 rounded-2xl bg-[#DB0002] py-3 text-sm font-semibold text-white disabled:opacity-40">
              {pendingAction === 'accept' ? 'Accepting…' : 'Confirm accept'}
            </button>
          </div>
        </Dialog>
      )}

      {confirmAction === 'cancel' && (
        <Dialog title="Cancel this quote request?" onClose={() => !busy && setConfirmAction(null)}>
          <p className="mt-3 text-sm text-gray-600">This quote request will be cancelled. It will remain in your RFQ history, and quotation actions will no longer be available.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy} onClick={() => setConfirmAction(null)} className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40">
              Keep request
            </button>
            <button type="button" disabled={busy} onClick={() => void runCancel()} className="flex-1 rounded-2xl bg-[#DB0002] py-3 text-sm font-semibold text-white disabled:opacity-40">
              {pendingAction === 'cancel' ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          </div>
        </Dialog>
      )}
      {confirmAction === 'decline' && (
        <Dialog title="Decline this quote?" onClose={() => !busy && setConfirmAction(null)}>
          <p className="mt-3 text-sm text-gray-600">This quotation will be declined. No order will be created.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy} onClick={() => setConfirmAction(null)} className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void runAction('decline')} className="flex-1 rounded-2xl bg-[#DB0002] py-3 text-sm font-semibold text-white disabled:opacity-40">
              {pendingAction === 'decline' ? 'Declining…' : 'Confirm decline'}
            </button>
          </div>
        </Dialog>
      )}

      {revisionOpen && (
        <Dialog title="Request revision" onClose={() => !busy && setRevisionOpen(false)}>
          <form
            className="mt-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void runAction('revision');
            }}
          >
            <label className="block text-sm font-semibold text-gray-900">
              Revision note
              <textarea
                required
                maxLength={REVISION_NOTE_MAX}
                value={revisionNote}
                onChange={event => setRevisionNote(event.target.value)}
                rows={4}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-[#DB0002]/20"
                placeholder="Tell the merchant what to change"
              />
            </label>
            <p className="mt-1 text-right text-xs text-gray-400">{revisionNote.trim().length}/{REVISION_NOTE_MAX}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" disabled={busy} onClick={() => setRevisionOpen(false)} className="flex-1 rounded-2xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40">
                Cancel
              </button>
              <button type="submit" disabled={busy || !revisionNote.trim()} className="flex-1 rounded-2xl bg-[#DB0002] py-3 text-sm font-semibold text-white disabled:opacity-40">
                {pendingAction === 'revision' ? 'Sending…' : 'Send revision request'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
