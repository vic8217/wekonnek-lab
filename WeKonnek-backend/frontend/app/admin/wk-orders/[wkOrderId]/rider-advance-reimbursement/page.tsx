'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from '@/lib/financial-reconciliation-api';
import {
  fetchRiderAdvanceReimbursement,
  type RiderAdvanceReimbursementDto,
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
      <h1 className="text-2xl font-bold text-gray-900">Rider Advance reimbursement</h1>
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

export default function RiderAdvanceReimbursementReadPage() {
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
  const [detail, setDetail] = useState<RiderAdvanceReimbursementDto | null>(null);
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
    setDetail(null);
    void (async () => {
      try {
        const next = await fetchRiderAdvanceReimbursement(wkOrderId, controller.signal);
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setDetail(next);
      } catch (err) {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (isAbortError(err)) return;
        const apiError = err instanceof FinancialReconciliationApiError ? err : null;
        setHttpStatus(apiError?.status ?? null);
        setError(
          apiError?.message ??
            (err instanceof Error ? err.message : 'Unable to load reimbursement.'),
        );
      } finally {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [wkOrderId]);

  const currency = displayServerField(detail?.currency);
  const settlements = Array.isArray(detail?.settlements)
    ? detail.settlements.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      )
    : [];

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation/reviews" className="text-sm font-medium text-[#DB0002]">
        Back to follow-ups
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Rider Advance reimbursement</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only inspection for order #{Number.isInteger(wkOrderId) ? wkOrderId : '—'}.
          System Admin cannot claim, acknowledge, reject, or record cash here.
        </p>
      </header>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {httpStatus === 403 ? 'Access denied. System admin only.' : httpStatus === 404 ? 'Reimbursement not found.' : error}
        </p>
      )}
      {detail && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Reimbursement status</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Status" value={displayServerField(detail.reimbursementStatus)} />
            <Field label="Principal" value={displayServerAmount(detail.principal, detail.currency)} />
            <Field label="Acknowledged amount" value={displayServerAmount(detail.settledAmount, detail.currency)} />
            <Field label="Remaining" value={displayServerAmount(detail.remainingAmount, detail.currency)} />
            <Field label="Currency" value={currency} />
            <Field label="Creditor" value="Rider" />
          </dl>
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer">Technical details</summary>
            <p>Creditor rider {displayServerField(detail.creditorRiderId ?? detail.creditor?.id)}</p>
          </details>
          <h3 className="text-sm font-semibold text-gray-900">Settlement history</h3>
          {settlements.length === 0 ? (
            <p className="text-sm text-gray-600">No settlements.</p>
          ) : (
            <ul className="space-y-3">
              {settlements.map((row, index) => (
                <li
                  key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `s-${index}`}
                  className="rounded-lg bg-gray-50 p-3 text-sm"
                >
                  <p>{displayServerField(row.method)} · {displayServerField(row.status)}</p>
                  <p>Claimed: {displayServerAmount(row.claimedAmount, detail.currency)}</p>
                  <p>Acknowledged: {displayServerAmount(row.acknowledgedAmount, detail.currency)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
