'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from '@/lib/financial-reconciliation-api';
import {
  fetchExceptionObligationSettlementSummary,
  type ExceptionSettlementSummaryDto,
} from '@/lib/authoritative-domain-api';
import {
  displayServerAmount,
  displayServerField,
  expectedOrderMatches,
  partyRoleLabel,
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
      <h1 className="text-2xl font-bold text-gray-900">Exception obligation</h1>
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

export default function ExceptionObligationReadPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!admin) return <AccessDenied />;
  return <Body />;
}

function Body() {
  const params = useParams();
  const search = useSearchParams();
  const id = String(params.id ?? '');
  const expectedWkOrderId = search.get('expectedWkOrderId');
  const generationRef = useRef(0);
  const [detail, setDetail] = useState<ExceptionSettlementSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderMismatch, setOrderMismatch] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    setOrderMismatch(false);
    setDetail(null);
    void (async () => {
      try {
        const next = await fetchExceptionObligationSettlementSummary(id, controller.signal);
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        const obligation = next.obligation ?? null;
        const actualOrder = obligation && typeof obligation === 'object' ? obligation.wkOrderId : undefined;
        if (!expectedOrderMatches(expectedWkOrderId, actualOrder)) {
          setOrderMismatch(true);
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
            (err instanceof Error ? err.message : 'Unable to load obligation settlement.'),
        );
      } finally {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, expectedWkOrderId]);

  const obligation =
    detail?.obligation && typeof detail.obligation === 'object' ? detail.obligation : null;
  const currency = displayServerField(obligation?.currency);
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
        <h1 className="text-2xl font-bold text-gray-900">Exception obligation</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only settlement status. System Admin cannot claim, acknowledge, reject, or record cash.
        </p>
      </header>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {httpStatus === 403 ? 'Access denied. System admin only.' : httpStatus === 404 ? 'Exception obligation not found.' : error}
        </p>
      )}
      {orderMismatch && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This obligation does not belong to the follow-up order.
        </p>
      )}
      {detail && obligation && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Obligation</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Status" value={displayServerField(obligation.status)} />
            <Field label="Derived settlement state" value={displayServerField(detail.derivedState)} />
            <Field label="Debtor" value={partyRoleLabel(obligation.debtorType)} />
            <Field label="Creditor" value={partyRoleLabel(obligation.creditorType)} />
            <Field label="Principal" value={displayServerAmount(detail.principal ?? obligation.principal, obligation.currency)} />
            <Field label="Acknowledged" value={displayServerAmount(detail.settledAmount, obligation.currency)} />
            <Field label="Remaining" value={displayServerAmount(detail.remainingAmount, obligation.currency)} />
            <Field label="Currency" value={currency} />
          </dl>
          {typeof obligation.exceptionClaimId === 'string' && (
            <Link
              href={`/admin/exception-claims/${obligation.exceptionClaimId}?expectedWkOrderId=${displayServerField(obligation.wkOrderId)}`}
              className="inline-block text-sm font-medium text-[#DB0002]"
            >
              Open liability claim
            </Link>
          )}
          <h3 className="text-sm font-semibold text-gray-900">Settlement history</h3>
          {settlements.length === 0 ? (
            <p className="text-sm text-gray-600">No settlements.</p>
          ) : (
            <ul className="space-y-3">
              {settlements.map((row, index) => {
                const evidence = Array.isArray(row.evidence)
                  ? row.evidence.filter(
                      (item): item is Record<string, unknown> =>
                        typeof item === 'object' && item !== null,
                    )
                  : [];
                return (
                  <li
                    key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `s-${index}`}
                    className="rounded-lg bg-gray-50 p-3 text-sm"
                  >
                    <p>{displayServerField(row.method)} · {displayServerField(row.status)}</p>
                    <p>Claimed: {displayServerAmount(row.claimedAmount, obligation.currency)}</p>
                    <p>Acknowledged: {displayServerAmount(row.acknowledgedAmount, obligation.currency)}</p>
                    {evidence.length > 0 && (
                      <p>Evidence records: {`${evidence.length}`}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
