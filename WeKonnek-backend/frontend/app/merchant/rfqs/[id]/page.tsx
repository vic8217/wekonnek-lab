'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api';

type RfqSnapshot = {
  product?: { id?: number; name?: string; sku?: string; imageUrl?: string };
  variant?: { id?: number; sku?: string } | null;
  shop?: { id?: number; name?: string };
};

type MerchantQuotation = {
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
  acceptedAt?: string | null;
  declinedAt?: string | null;
  convertedAt?: string | null;
  createdAt?: string;
};

type MerchantRfqDetail = {
  id: string;
  rfqNumber: string;
  buyerId: string;
  productId: number;
  productVariantId?: number | null;
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
  viewedAt?: string | null;
  acceptedAt?: string | null;
  declinedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  quotations?: MerchantQuotation[];
};

/** Matches backend QuoteInput. Merchant/buyer ids and version are resolved server-side. */
type QuoteInput = {
  unitPrice: number;
  discount?: number;
  tax?: number;
  deliveryCharge?: number;
  otherCharges?: number;
  leadTime?: string;
  promisedDate?: string;
  validUntil: string;
  paymentTerms?: string;
  merchantNotes?: string;
  returnCancellationTerms?: string;
  send?: boolean;
};

type QuoteFormFields = {
  unitPrice: string;
  discount: string;
  tax: string;
  deliveryCharge: string;
  otherCharges: string;
  validUntil: string;
  leadTime: string;
  promisedDate: string;
  paymentTerms: string;
  merchantNotes: string;
  returnCancellationTerms: string;
};

type LoadState = 'loading' | 'ready' | 'forbidden' | 'notfound' | 'failure';
type QuoteAction = 'create' | 'revise';

const QUOTEABLE_RFQ_STATUSES = new Set(['SUBMITTED', 'VIEWED', 'QUOTED', 'REVISED']);
const TERMINAL_RFQ_STATUSES = new Set(['CANCELLED', 'DECLINED', 'EXPIRED', 'CONVERTED_TO_ORDER', 'ACCEPTED']);
const AWAITING_BUYER_QUOTATION_STATUSES = new Set(['SENT', 'ACCEPTED']);

const RFQ_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  VIEWED: 'Viewed',
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

const fieldClass =
  'w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-[#DB0002]/20 disabled:bg-gray-50';

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

function snapshotOf(rfq: MerchantRfqDetail): RfqSnapshot {
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

function shortBuyerId(buyerId: string): string {
  const compact = buyerId.replaceAll('-', '');
  return compact.slice(0, 8).toUpperCase() || buyerId;
}

function hasAmount(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function amountString(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '';
  return String(value);
}

function toDatetimeLocal(value?: string | null): string {
  const date = value ? new Date(value) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseAmount(raw: string, label: string, required: boolean): { value: number; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (required) return { value: 0, error: `${label} is required.` };
    return { value: 0 };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: 0, error: `${label} must be a valid amount.` };
  if (value < 0) return { value, error: 'Quotation amounts cannot be negative.' };
  return { value };
}

function previewNumber(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 0;
}

function emptyQuoteForm(): QuoteFormFields {
  return {
    unitPrice: '',
    discount: '',
    tax: '',
    deliveryCharge: '',
    otherCharges: '',
    validUntil: toDatetimeLocal(),
    leadTime: '',
    promisedDate: '',
    paymentTerms: '',
    merchantNotes: '',
    returnCancellationTerms: '',
  };
}

function quoteFormFrom(quotation: MerchantQuotation | null): QuoteFormFields {
  if (!quotation) return emptyQuoteForm();
  return {
    unitPrice: quotation.unitPrice == null || quotation.unitPrice === '' ? '' : String(quotation.unitPrice),
    discount: amountString(quotation.discount),
    tax: amountString(quotation.tax),
    deliveryCharge: amountString(quotation.deliveryCharge),
    otherCharges: amountString(quotation.otherCharges),
    validUntil: toDatetimeLocal(quotation.validUntil),
    leadTime: quotation.leadTime || '',
    promisedDate: toDateInput(quotation.promisedDate),
    paymentTerms: quotation.paymentTerms || '',
    merchantNotes: quotation.merchantNotes || '',
    returnCancellationTerms: quotation.returnCancellationTerms || '',
  };
}

function quoteActionFor(rfq: MerchantRfqDetail, current: MerchantQuotation | null): QuoteAction | null {
  if (TERMINAL_RFQ_STATUSES.has(rfq.status)) return null;
  if (!QUOTEABLE_RFQ_STATUSES.has(rfq.status)) return null;
  if (rfq.quotations?.some(quotation => quotation.wkOrderId != null || quotation.status === 'CONVERTED_TO_ORDER')) {
    return null;
  }
  if (current && AWAITING_BUYER_QUOTATION_STATUSES.has(current.status)) return null;

  const buyerRequestedRevision = Boolean(current?.revisionRequest?.trim()) || current?.status === 'REVISED' || rfq.status === 'REVISED';
  if (buyerRequestedRevision && current) return 'revise';
  if (!current || current.status === 'DRAFT' || current.status === 'DECLINED' || current.status === 'EXPIRED' || current.status === 'CANCELLED') {
    return 'create';
  }
  return null;
}

function publicApiMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
  if (response?.status === 401) return 'Please sign in as a merchant to continue.';
  if (response?.status === 403) return 'This account cannot quote this request.';
  if (response?.status === 404) return 'This quote request is not available.';
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

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold text-gray-900">{value}</span>
    </div>
  );
}

function BackToRfqs({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/merchant/rfqs"
      className={`inline-flex items-center gap-1 text-sm font-medium text-[#DB0002] hover:underline ${className}`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to RFQs
    </Link>
  );
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <BackToRfqs />
      <p className="mt-6 font-medium text-gray-800">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
      <Link
        href="/merchant/rfqs"
        className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#DB0002] px-5 text-sm font-semibold text-white"
      >
        Back to RFQs
      </Link>
    </div>
  );
}

function NoteBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-4 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">{value}</p>
    </div>
  );
}

function QuotationTerms({ quotation, quantity }: { quotation: MerchantQuotation; quantity: number }) {
  return (
    <div className="min-w-0 divide-y divide-gray-50">
      <DetailRow label="Version" value={`Version ${quotation.version}`} />
      {quotation.quotationNumber && <DetailRow label="Quotation" value={quotation.quotationNumber} />}
      <div className="flex justify-between gap-4 py-2 text-sm">
        <span className="text-gray-500">Status</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(quotation.status)}`}>
          {statusLabel(quotation.status, QUOTATION_STATUS_LABELS)}
        </span>
      </div>
      <DetailRow label="Quantity" value={quantity} />
      {hasAmount(quotation.unitPrice) && <DetailRow label="Quoted unit price" value={money(quotation.unitPrice)} />}
      {hasAmount(quotation.subtotal) && <DetailRow label="Subtotal" value={money(quotation.subtotal)} />}
      {hasAmount(quotation.discount) && Number(quotation.discount) !== 0 && (
        <DetailRow label="Discount" value={money(quotation.discount)} />
      )}
      {hasAmount(quotation.tax) && <DetailRow label="Tax" value={money(quotation.tax)} />}
      {hasAmount(quotation.deliveryCharge) && Number(quotation.deliveryCharge) !== 0 && (
        <DetailRow label="Delivery charge" value={money(quotation.deliveryCharge)} />
      )}
      {hasAmount(quotation.otherCharges) && <DetailRow label="Other charges" value={money(quotation.otherCharges)} />}
      <div className="flex justify-between gap-4 py-3 text-sm">
        <span className="font-semibold text-gray-700">Total</span>
        <span className="text-lg font-bold text-gray-900">{money(quotation.total) || '—'}</span>
      </div>
      <DetailRow label="Valid until" value={formatDateTime(quotation.validUntil)} />
      <DetailRow label="Lead time" value={quotation.leadTime} />
      <DetailRow label="Promised date" value={formatDate(quotation.promisedDate)} />
      <DetailRow label="Payment terms" value={quotation.paymentTerms} />
      <DetailRow label="Merchant note" value={quotation.merchantNotes} />
      <DetailRow label="Return / cancellation terms" value={quotation.returnCancellationTerms} />
      <DetailRow label="Sent" value={formatDateTime(quotation.sentAt)} />
      <DetailRow label="Accepted" value={formatDateTime(quotation.acceptedAt)} />
      <DetailRow label="Declined" value={formatDateTime(quotation.declinedAt)} />
      <DetailRow label="Converted" value={formatDateTime(quotation.convertedAt)} />
    </div>
  );
}

function QuoteForm({
  quantity,
  mode,
  fields,
  submitting,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  quantity: number;
  mode: QuoteAction;
  fields: QuoteFormFields;
  submitting: boolean;
  error: string;
  onChange: (patch: Partial<QuoteFormFields>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const unitPrice = previewNumber(fields.unitPrice);
  const discount = previewNumber(fields.discount);
  const tax = previewNumber(fields.tax);
  const deliveryCharge = previewNumber(fields.deliveryCharge);
  const otherCharges = previewNumber(fields.otherCharges);
  const subtotal = unitPrice * quantity;
  const previewTotal = subtotal - discount + tax + deliveryCharge + otherCharges;
  const submitLabel = mode === 'revise' ? 'Create Revised Quote' : 'Create Quote';

  return (
    <form className="mt-4 min-w-0 space-y-4 border-t border-gray-100 pt-4" onSubmit={onSubmit}>
      <p className="text-sm font-semibold text-gray-900">{submitLabel}</p>
      <p className="text-xs text-gray-500">
        Quantity is taken from the RFQ and cannot be changed here. The server calculates the quotation total.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-gray-700">
          Quantity
          <input value={quantity} disabled className={`${fieldClass} mt-1.5`} />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Unit price
          <input
            required
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fields.unitPrice}
            disabled={submitting}
            onChange={event => onChange({ unitPrice: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Tax
          <input
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fields.tax}
            disabled={submitting}
            onChange={event => onChange({ tax: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Other charges
          <input
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fields.otherCharges}
            disabled={submitting}
            onChange={event => onChange({ otherCharges: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Discount
          <input
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fields.discount}
            disabled={submitting}
            onChange={event => onChange({ discount: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Delivery charge
          <input
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fields.deliveryCharge}
            disabled={submitting}
            onChange={event => onChange({ deliveryCharge: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="0.00"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
          Valid until
          <input
            required
            type="datetime-local"
            value={fields.validUntil}
            disabled={submitting}
            onChange={event => onChange({ validUntil: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Lead time
          <input
            maxLength={255}
            value={fields.leadTime}
            disabled={submitting}
            onChange={event => onChange({ leadTime: event.target.value })}
            className={`${fieldClass} mt-1.5`}
            placeholder="e.g. 5–7 business days"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700">
          Promised date
          <input
            type="date"
            value={fields.promisedDate}
            disabled={submitting}
            onChange={event => onChange({ promisedDate: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
          Payment terms
          <input
            value={fields.paymentTerms}
            disabled={submitting}
            onChange={event => onChange({ paymentTerms: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
          Merchant note
          <textarea
            rows={3}
            value={fields.merchantNotes}
            disabled={submitting}
            onChange={event => onChange({ merchantNotes: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
          Return / cancellation terms
          <textarea
            rows={3}
            value={fields.returnCancellationTerms}
            disabled={submitting}
            onChange={event => onChange({ returnCancellationTerms: event.target.value })}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
      </div>

      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Commercial summary</p>
        <p className="mt-1 text-xs text-amber-700">Preview only. The quoted total is calculated by the server.</p>
        <div className="mt-2 divide-y divide-amber-100">
          <DetailRow label="Quantity" value={quantity} />
          <DetailRow label="Subtotal" value={money(subtotal)} />
          <DetailRow label="Tax" value={money(tax)} />
          <DetailRow label="Other charges" value={money(otherCharges)} />
          {discount !== 0 && <DetailRow label="Discount" value={money(discount)} />}
          {deliveryCharge !== 0 && <DetailRow label="Delivery charge" value={money(deliveryCharge)} />}
          <div className="flex justify-between gap-4 py-3 text-sm">
            <span className="font-semibold text-amber-900">Preview total</span>
            <span className="text-lg font-bold text-amber-950">{money(previewTotal) || '—'}</span>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="min-h-10 flex-1 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="min-h-10 flex-1 rounded-lg bg-[#DB0002] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Sending…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function MerchantRfqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const [rfq, setRfq] = useState<MerchantRfqDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fields, setFields] = useState<QuoteFormFields>(emptyQuoteForm);

  const refreshRfq = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    try {
      const response = await apiClient.get<MerchantRfqDetail>(`/backend/rfqs/merchant/${id}`);
      setRfq(response.data);
      setState('ready');
      return true;
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) setState('forbidden');
      else if (status === 404) setState('notfound');
      toast.error(publicApiMessage(error, 'Unable to refresh this quote request.'));
      return false;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;

    async function load() {
      try {
        const response = await apiClient.get<MerchantRfqDetail>(`/backend/rfqs/merchant/${id}`);
        if (cancelled) return;
        setRfq(response.data);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) setState('forbidden');
        else if (status === 404) setState('notfound');
        else setState('failure');
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [id]);

  const quotations = useMemo(
    () => [...(rfq?.quotations || [])].sort((a, b) => b.version - a.version),
    [rfq],
  );
  const current = quotations[0] || null;
  const quoteAction = rfq ? quoteActionFor(rfq, current) : null;

  const openForm = (mode: QuoteAction) => {
    setFormError('');
    setFields(mode === 'revise' ? quoteFormFrom(current) : emptyQuoteForm());
    setFormOpen(true);
  };

  const submitQuote = async (event: FormEvent) => {
    event.preventDefault();
    if (!rfq || !quoteAction || submitting) return;

    const unitPrice = parseAmount(fields.unitPrice, 'Unit price', true);
    const discount = parseAmount(fields.discount, 'Discount', false);
    const tax = parseAmount(fields.tax, 'Tax', false);
    const deliveryCharge = parseAmount(fields.deliveryCharge, 'Delivery charge', false);
    const otherCharges = parseAmount(fields.otherCharges, 'Other charges', false);
    const amountError = unitPrice.error || discount.error || tax.error || deliveryCharge.error || otherCharges.error;
    if (amountError) {
      setFormError(amountError);
      return;
    }

    const validUntilDate = fields.validUntil ? new Date(fields.validUntil) : null;
    if (!validUntilDate || Number.isNaN(validUntilDate.getTime())) {
      setFormError('Valid until is required.');
      return;
    }

    const payload: QuoteInput = {
      unitPrice: unitPrice.value,
      discount: discount.value,
      tax: tax.value,
      deliveryCharge: deliveryCharge.value,
      otherCharges: otherCharges.value,
      validUntil: validUntilDate.toISOString(),
      send: true,
    };
    const leadTime = optionalText(fields.leadTime);
    const promisedDate = optionalText(fields.promisedDate);
    const paymentTerms = optionalText(fields.paymentTerms);
    const merchantNotes = optionalText(fields.merchantNotes);
    const returnCancellationTerms = optionalText(fields.returnCancellationTerms);
    if (leadTime) payload.leadTime = leadTime;
    if (promisedDate) payload.promisedDate = promisedDate;
    if (paymentTerms) payload.paymentTerms = paymentTerms;
    if (merchantNotes) payload.merchantNotes = merchantNotes;
    if (returnCancellationTerms) payload.returnCancellationTerms = returnCancellationTerms;

    setSubmitting(true);
    setFormError('');
    try {
      await apiClient.post(`/backend/rfqs/merchant/${rfq.id}/quotations`, payload);
      toast.success(quoteAction === 'revise' ? 'Revised quotation sent.' : 'Quotation sent.');
      setFormOpen(false);
      await refreshRfq();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const message = publicApiMessage(error, 'Unable to send this quotation. Please try again.');
      setFormError(message);
      toast.error(message);
      if (status === 404) setState('notfound');
      else if (status === 401 || status === 403) setState('forbidden');
      else if (status === 400) await refreshRfq();
    } finally {
      setSubmitting(false);
    }
  };

  if (!id) {
    return (
      <ErrorState
        title="Quote request not found"
        body="This quote request may have been removed or does not belong to your shops."
      />
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#DB0002] border-t-transparent" />
          <p className="text-sm text-gray-600">Loading quote request...</p>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <ErrorState
        title="You cannot view this quote request"
        body="This quote request is not available on your merchant account."
      />
    );
  }
  if (state === 'notfound') {
    return (
      <ErrorState
        title="Quote request not found"
        body="This quote request may have been removed or does not belong to your shops."
      />
    );
  }
  if (state === 'failure' || !rfq) {
    return (
      <ErrorState
        title="Unable to load this quote request"
        body="Please try again in a moment."
      />
    );
  }

  const snapshot = snapshotOf(rfq);
  const history = quotations.slice(1);
  const convertedQuote = quotations.find(quotation => quotation.wkOrderId != null || quotation.status === 'CONVERTED_TO_ORDER') || null;
  const revisionQuote = quotations.find(quotation => Boolean(quotation.revisionRequest?.trim())) || null;
  const productName = snapshot.product?.name;
  const shopName = snapshot.shop?.name;
  const requested = formatDateTime(rfq.submittedAt || rfq.createdAt);

  return (
    <div className="min-w-0 space-y-4 lg:space-y-6">
      <BackToRfqs />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs text-gray-400">{rfq.rfqNumber}</p>
          <h1 className="truncate text-2xl font-bold text-gray-900 lg:text-3xl">
            {productName || `Product #${rfq.productId}`}
          </h1>
          {shopName && <p className="mt-1 truncate text-sm text-gray-500">{shopName}</p>}
        </div>
        <span className={`inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusClass(rfq.status)}`}>
          {statusLabel(rfq.status, RFQ_STATUS_LABELS)}
        </span>
      </header>

      {rfq.status === 'EXPIRED' && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          This quote request has expired.
        </p>
      )}
      {rfq.status === 'CANCELLED' && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          This quote request was cancelled{rfq.cancelledAt ? ` on ${formatDateTime(rfq.cancelledAt)}` : ''}.
        </p>
      )}
      {rfq.status === 'DECLINED' && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          This quote request was declined{rfq.declinedAt ? ` on ${formatDateTime(rfq.declinedAt)}` : ''}.
        </p>
      )}
      {rfq.status === 'CONVERTED_TO_ORDER' && !convertedQuote && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Converted to Order
        </p>
      )}

      {revisionQuote && (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-indigo-800">Buyer Requested Revision</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-indigo-950">{revisionQuote.revisionRequest}</p>
          <p className="mt-2 text-xs text-indigo-700">
            Version {revisionQuote.version}
            {' · '}
            {statusLabel(revisionQuote.status, QUOTATION_STATUS_LABELS)}
          </p>
        </section>
      )}

      {convertedQuote && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-800">Converted to Order</h2>
          <div className="mt-2 min-w-0 divide-y divide-emerald-100">
            {convertedQuote.wkOrderId != null && <DetailRow label="WkOrder ID" value={convertedQuote.wkOrderId} />}
            <DetailRow label="Accepted quotation" value={`Version ${convertedQuote.version}`} />
            {hasAmount(convertedQuote.total) && <DetailRow label="Frozen total" value={money(convertedQuote.total)} />}
            <DetailRow label="Converted" value={formatDateTime(convertedQuote.convertedAt)} />
          </div>
        </section>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Request</h2>
          <div className="mt-3 flex min-w-0 gap-4">
            {snapshot.product?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={snapshot.product.imageUrl}
                alt={productName || 'Product'}
                className="h-20 w-20 shrink-0 rounded-xl object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1 divide-y divide-gray-50">
              <DetailRow label="RFQ" value={rfq.rfqNumber} />
              <div className="flex justify-between gap-4 py-2 text-sm">
                <span className="text-gray-500">Status</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(rfq.status)}`}>
                  {statusLabel(rfq.status, RFQ_STATUS_LABELS)}
                </span>
              </div>
              <DetailRow label="Buyer" value={shortBuyerId(rfq.buyerId)} />
              <DetailRow label="Product" value={productName || `Product #${rfq.productId}`} />
              <DetailRow label="SKU" value={snapshot.product?.sku || snapshot.variant?.sku} />
              <DetailRow label="Shop" value={shopName} />
              <DetailRow label="Quantity" value={rfq.quantity} />
              <DetailRow label="Requested" value={requested} />
              <DetailRow label="Size" value={rfq.size} />
              <DetailRow label="Color" value={rfq.color} />
              <DetailRow label="Required date" value={formatDate(rfq.requiredDate)} />
              <DetailRow label="Viewed" value={formatDateTime(rfq.viewedAt)} />
            </div>
          </div>
          <NoteBlock label="Specifications" value={rfq.specifications} />
          <NoteBlock label="Customization" value={rfq.customization} />
          <NoteBlock label="Buyer note" value={rfq.notes} />
          <NoteBlock label="Delivery address" value={rfq.deliveryAddress} />
        </section>

        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Current / latest quotation</h2>
          {current ? (
            <div className="mt-3">
              <QuotationTerms quotation={current} quantity={rfq.quantity} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">No quotation has been sent yet.</p>
          )}

          {quoteAction && !formOpen && (
            <button
              type="button"
              onClick={() => openForm(quoteAction)}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#DB0002] px-4 text-sm font-semibold text-white sm:w-auto"
            >
              {quoteAction === 'revise' ? 'Create Revised Quote' : 'Create Quote'}
            </button>
          )}

          {quoteAction && formOpen && (
            <QuoteForm
              quantity={rfq.quantity}
              mode={quoteAction}
              fields={fields}
              submitting={submitting}
              error={formError}
              onChange={patch => setFields(currentFields => ({ ...currentFields, ...patch }))}
              onCancel={() => { if (!submitting) { setFormOpen(false); setFormError(''); } }}
              onSubmit={event => void submitQuote(event)}
            />
          )}
        </section>
      </div>

      {history.length > 0 && (
        <section className="min-w-0 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Quotation history</h2>
          {history.map(quotation => (
            <article key={quotation.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-bold text-gray-900">Version {quotation.version}</h3>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass(quotation.status)}`}>
                  {statusLabel(quotation.status, QUOTATION_STATUS_LABELS)}
                </span>
              </div>
              <QuotationTerms quotation={quotation} quantity={rfq.quantity} />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
