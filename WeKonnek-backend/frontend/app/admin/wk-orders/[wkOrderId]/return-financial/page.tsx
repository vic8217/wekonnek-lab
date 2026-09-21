'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from '@/lib/financial-reconciliation-api';
import {
  fetchReturnFinancialResolution,
  type ReturnFinancialResolutionDto,
} from '@/lib/authoritative-domain-api';
import {
  displayServerAmount,
  displayServerField,
} from '@/lib/authoritative-domain-presentation';
import {
  isAbortError,
  isCurrentGeneration,
  isFinancialReconciliationAdmin,
  nextGeneration,
} from '@/lib/financial-reconciliation-presentation';

function AccessDenied() {
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">Return financial resolution</h1>
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Access denied. System admin only.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="break-words font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function ObligationBlock({
  title,
  row,
  currency,
}: {
  title: string;
  row: Record<string, unknown> | null | undefined;
  currency: string;
}) {
  if (!row) {
    return (
      <div>
        <h3 className="font-medium text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">None on this resolution.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="font-medium text-gray-900">{title}</h3>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <Field label="Status" value={displayServerField(row.status)} />
        <Field label="Principal" value={displayServerAmount(row.principal, currency)} />
        <Field label="Settled (server)" value={displayServerAmount(row.settled, currency)} />
        <Field label="Remaining (server)" value={displayServerAmount(row.remaining, currency)} />
      </dl>
    </div>
  );
}

export default function ReturnFinancialReadPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!admin) return <AccessDenied />;
  return <Body />;
}

function Body() {
  const params = useParams();
  const wkOrderId = Number(params.wkOrderId);
  const generationRef = useRef(0);
  const [detail, setDetail] = useState<ReturnFinancialResolutionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!Number.isInteger(wkOrderId) || wkOrderId <= 0) {
      setError('Order not found.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    setHttpStatus(null);
    setDetail(null);
    void (async () => {
      try {
        const next = await fetchReturnFinancialResolution(wkOrderId, controller.signal);
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (next.wkOrderId != null && next.wkOrderId !== wkOrderId) {
          setError('This resolution does not belong to the requested order.');
          setDetail(null);
          return;
        }
        setDetail(next);
      } catch (err) {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (isAbortError(err)) return;
        const apiError = err instanceof FinancialReconciliationApiError ? err : null;
        setHttpStatus(apiError?.status ?? null);
        setError(
          apiError?.message ??
            (err instanceof Error ? err.message : 'Unable to load return financial resolution.'),
        );
      } finally {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [wkOrderId]);

  const currency = 'PHP';
  const repayment =
    detail?.merchantToRiderRepayment && typeof detail.merchantToRiderRepayment === 'object'
      ? detail.merchantToRiderRepayment
      : null;
  const refund =
    detail?.merchantToCustomerRefund && typeof detail.merchantToCustomerRefund === 'object'
      ? detail.merchantToCustomerRefund
      : null;

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation/reviews" className="text-sm font-medium text-[#DB0002]">
        Back to follow-ups
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Return financial resolution</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only inspection for order #{Number.isInteger(wkOrderId) ? wkOrderId : '—'}.
          This page does not propose, finalize, adjudicate, claim, or acknowledge settlement.
        </p>
      </header>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {httpStatus === 403 ? 'Access denied. System admin only.' : httpStatus === 404 ? 'Return financial resolution not found.' : error}
        </p>
      )}
      {detail && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Determination</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Status" value={displayServerField(detail.returnFinancialStatus)} />
            <Field label="Outcome" value={displayServerField(detail.outcome)} />
            <Field label="Path" value={displayServerField(detail.path)} />
            <Field
              label="Snapshot principal"
              value={displayServerAmount(detail.snapshotPrincipal, currency)}
            />
            <Field
              label="Snapshot reimbursed"
              value={displayServerAmount(detail.snapshotReimbursed, currency)}
            />
            <Field label="Collection status" value={displayServerField(detail.currentCollectionStatus)} />
            <Field
              label="Customer reimbursed (server)"
              value={displayServerAmount(detail.customerReimbursedAmount, currency)}
            />
            <Field
              label="Customer collectible remaining (server)"
              value={displayServerAmount(detail.customerCollectibleRemaining, currency)}
            />
          </dl>
          {Array.isArray(detail.financialBlockingReasons) && detail.financialBlockingReasons.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Blocking reasons</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                {detail.financialBlockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <ObligationBlock title="Merchant → rider repayment" row={repayment} currency={currency} />
          <ObligationBlock title="Merchant → customer refund" row={refund} currency={currency} />
          <Link
            href={`/admin/wk-orders/${wkOrderId}/rider-advance-reimbursement`}
            className="inline-block text-sm font-medium text-[#DB0002]"
          >
            View reimbursement status
          </Link>
        </section>
      )}
    </div>
  );
}
