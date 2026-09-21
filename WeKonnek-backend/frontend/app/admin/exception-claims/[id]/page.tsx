'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
} from '@/lib/financial-reconciliation-api';
import {
  fetchExceptionClaim,
  type ExceptionClaimRecord,
} from '@/lib/authoritative-domain-api';
import {
  coverageSourceLabel,
  determinationRoleLabel,
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
      <h1 className="text-2xl font-bold text-gray-900">Liability claim</h1>
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Access denied. System admin only.
      </p>
    </div>
  );
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> =>
      typeof row === 'object' && row !== null,
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

export default function ExceptionClaimReadPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!admin) return <AccessDenied />;
  return <ClaimBody />;
}

function ClaimBody() {
  const params = useParams();
  const search = useSearchParams();
  const id = String(params.id ?? '');
  const expectedWkOrderId = search.get('expectedWkOrderId');
  const generationRef = useRef(0);
  const [claim, setClaim] = useState<ExceptionClaimRecord | null>(null);
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
    setHttpStatus(null);
    setOrderMismatch(false);
    setClaim(null);
    void (async () => {
      try {
        const next = await fetchExceptionClaim(id, controller.signal);
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (!next) {
          setError('Liability claim not found.');
          return;
        }
        if (!expectedOrderMatches(expectedWkOrderId, next.wkOrderId)) {
          setOrderMismatch(true);
          setClaim(null);
          return;
        }
        setClaim(next);
      } catch (err) {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (isAbortError(err)) return;
        const apiError = err instanceof FinancialReconciliationApiError ? err : null;
        setHttpStatus(apiError?.status ?? null);
        setError(
          apiError?.message ??
            (err instanceof Error ? err.message : 'Unable to load liability claim.'),
        );
      } finally {
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, expectedWkOrderId]);

  const currency = displayServerField(claim?.currency);
  const loss =
    claim?.economicLoss && typeof claim.economicLoss === 'object'
      ? (claim.economicLoss as Record<string, unknown>)
      : null;
  const coverages = asRecords(loss?.coverages);
  const determinations = asRecords(claim?.determinations);
  const allocationsByDet = determinations.map((det) => ({
    det,
    allocations: asRecords(det.allocations),
  }));
  const obligations = asRecords(claim?.obligations);
  const evidence = asRecords(claim?.evidence);
  const verifications = asRecords(claim?.verifications);
  const facts = asRecords(claim?.verifiedFacts);
  const events = asRecords(claim?.events);

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation/reviews" className="text-sm font-medium text-[#DB0002]">
        Back to follow-ups
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Liability claim</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only inspection. This page does not settle, acknowledge, finalize, or change coverage.
        </p>
      </header>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {httpStatus === 403
            ? 'Access denied. System admin only.'
            : httpStatus === 404
              ? 'Liability claim not found.'
              : error}
        </p>
      )}
      {orderMismatch && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This claim does not belong to the follow-up order.
        </p>
      )}
      {!loading && !error && !orderMismatch && !claim && (
        <p className="text-sm text-gray-600">No liability claim to display.</p>
      )}

      {claim && (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="claim-heading">
            <h2 id="claim-heading" className="text-lg font-semibold text-gray-900">Claim</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Status" value={displayServerField(claim.status)} />
              <Field label="Type" value={displayServerField(claim.claimType)} />
              <Field label="Order" value={`#${displayServerField(claim.wkOrderId)}`} />
              <Field label="Recovery reference" value={displayServerField(claim.operationsRecoveryId)} />
              <Field label="Policy version" value={displayServerField(claim.policyVersionId)} />
              <Field label="Policy hash" value={displayServerField(claim.policyHash)} />
              <Field label="Subject" value={displayServerField(claim.subjectRef)} />
              <Field label="Currency" value={currency} />
            </dl>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                href={`/admin/financial-reconciliation/${claim.wkOrderId}`}
                className="text-sm font-medium text-[#DB0002]"
              >
                Open order reconciliation
              </Link>
              <Link
                href={`/admin/wk-orders/${claim.wkOrderId}/return-financial`}
                className="text-sm font-medium text-[#DB0002]"
              >
                View return financial resolution
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="loss-heading">
            <h2 id="loss-heading" className="text-lg font-semibold text-gray-900">Economic loss</h2>
            {loss ? (
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Loss kind" value={displayServerField(loss.lossKind)} />
                <Field
                  label="Compensable amount"
                  value={displayServerAmount(loss.compensableAmount, loss.currency ?? claim.currency)}
                />
                <Field label="Subject" value={displayServerField(loss.subjectRef)} />
              </dl>
            ) : (
              <p className="mt-2 text-sm text-gray-600">No economic loss on this claim.</p>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="text-lg font-semibold text-gray-900">Coverage</h2>
            <p className="mt-1 text-sm text-gray-600">
              Coverage is not settlement. These rows are read-only coverage source records.
            </p>
            {coverages.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No coverage rows.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {coverages.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `coverage-${index}`} className="rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="font-medium text-gray-900">{coverageSourceLabel(row.sourceKind)}</p>
                    <p className="text-gray-700">Covered amount: {displayServerAmount(row.amount, row.currency ?? claim.currency)}</p>
                    <p className="text-gray-600">Coverage source: {displayServerField(row.sourceKind)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="evidence-heading">
            <h2 id="evidence-heading" className="text-lg font-semibold text-gray-900">Evidence</h2>
            {evidence.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No evidence.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-gray-800">
                {evidence.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `evidence-${index}`}>
                    {displayServerField(row.evidenceKind)} · {displayServerField(row.visibility)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="verify-heading">
            <h2 id="verify-heading" className="text-lg font-semibold text-gray-900">Evidence verifications</h2>
            {verifications.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No verifications.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-gray-800">
                {verifications.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `verify-${index}`}>
                    {displayServerField(row.outcome ?? row.result ?? row.status)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="facts-heading">
            <h2 id="facts-heading" className="text-lg font-semibold text-gray-900">Verified facts</h2>
            {facts.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No verified facts.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-gray-800">
                {facts.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `fact-${index}`}>
                    {displayServerField(row.factType ?? row.kind)} · {displayServerField(row.statement ?? row.body)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="dets-heading">
            <h2 id="dets-heading" className="text-lg font-semibold text-gray-900">Determinations</h2>
            {allocationsByDet.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No determinations.</p>
            ) : (
              <ul className="mt-3 space-y-4">
                {allocationsByDet.map(({ det, allocations }, index) => (
                  <li key={displayServerField(det.id) !== '—' ? displayServerField(det.id) : `det-${index}`} className="rounded-lg border border-gray-100 p-3">
                    <p className="font-medium text-gray-900">{determinationRoleLabel(det)}</p>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <Field label="Status" value={displayServerField(det.status)} />
                      <Field
                        label="Total liability amount"
                        value={displayServerAmount(det.totalLiabilityAmount, det.currency ?? claim.currency)}
                      />
                      <Field
                        label="Remaining snapshot"
                        value={displayServerAmount(det.remainingAmountSnapshot, det.currency ?? claim.currency)}
                      />
                      <Field label="Reason" value={displayServerField(det.reason)} />
                    </dl>
                    <h3 className="mt-3 text-sm font-semibold text-gray-900">Allocations</h3>
                    {allocations.length === 0 ? (
                      <p className="text-sm text-gray-600">No allocations.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-sm text-gray-800">
                        {allocations.map((row, allocIndex) => (
                          <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `alloc-${index}-${allocIndex}`}>
                            {partyRoleLabel(row.partyType)} · {displayServerAmount(row.amount, row.currency ?? claim.currency)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="obls-heading">
            <h2 id="obls-heading" className="text-lg font-semibold text-gray-900">Obligations</h2>
            {obligations.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No obligations.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {obligations.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `obl-${index}`} className="rounded-lg bg-gray-50 p-3 text-sm">
                    <p>{partyRoleLabel(row.debtorType)} → {partyRoleLabel(row.creditorType)}</p>
                    <p>Principal: {displayServerAmount(row.principal, row.currency ?? claim.currency)}</p>
                    <p>Status: {displayServerField(row.status)}</p>
                    {typeof row.id === 'string' && (
                      <Link
                        href={`/admin/exception-financial-obligations/${row.id}?expectedWkOrderId=${claim.wkOrderId}`}
                        className="mt-1 inline-block font-medium text-[#DB0002]"
                      >
                        View exception obligation
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="events-heading">
            <h2 id="events-heading" className="text-lg font-semibold text-gray-900">Domain events</h2>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600">No domain events.</p>
            ) : (
              <ol className="mt-3 space-y-1 text-sm text-gray-800">
                {events.map((row, index) => (
                  <li key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `event-${index}`}>
                    {displayServerField(row.eventType ?? row.type)}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
