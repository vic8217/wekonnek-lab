'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
  type FinancialObligationDto,
  type FinancialReconciliationDetailDto,
  fetchOrderFinancialReconciliation,
} from '@/lib/financial-reconciliation-api';
import {
  FINANCIAL_RAILS,
  attentionBadges,
  directionLabel,
  financialStateLabel,
  findingExplanation,
  findingTitle,
  formatMoneyDisplay,
  formatSourceActivity,
  isAbortError,
  isCurrentGeneration,
  isFinancialReconciliationAdmin,
  nextGeneration,
  obligationAnchorId,
  railLabel,
  relationLabel,
  stateLabel,
} from '@/lib/financial-reconciliation-presentation';

function AccessDenied() {
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">Financial Reconciliation</h1>
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Access denied. System admin only.
      </p>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  const tone = label === 'Needs review'
    ? 'bg-red-50 text-red-700'
    : label === 'Outstanding'
      ? 'bg-amber-50 text-amber-800'
      : label === 'Disputed'
        ? 'bg-slate-100 text-slate-800'
        : 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function PartyLine({
  debtor,
  creditor,
}: {
  debtor: FinancialObligationDto['debtor'];
  creditor: FinancialObligationDto['creditor'];
}) {
  const hasTechnical =
    Boolean(debtor.userId) ||
    debtor.merchantId != null ||
    Boolean(creditor.userId) ||
    creditor.merchantId != null;
  return (
    <div>
      <p className="font-medium text-gray-900">{directionLabel(debtor.type, creditor.type)}</p>
      {hasTechnical && (
        <details className="mt-1 text-xs text-gray-500">
          <summary className="cursor-pointer">Technical details</summary>
          {debtor.userId ? <p>Debtor user {debtor.userId}</p> : null}
          {debtor.merchantId != null ? <p>Debtor merchant {debtor.merchantId}</p> : null}
          {creditor.userId ? <p>Creditor user {creditor.userId}</p> : null}
          {creditor.merchantId != null ? <p>Creditor merchant {creditor.merchantId}</p> : null}
        </details>
      )}
    </div>
  );
}

function ObligationCard({ item }: { item: FinancialObligationDto }) {
  const flags: string[] = [];
  if (item.flags?.collectionRestricted) flags.push('Collection restricted');
  if (item.flags?.disputed) flags.push('Disputed');
  if (item.flags?.nonExecutable) flags.push('Non-executable');
  if (item.flags?.reconciliationRequired) flags.push('Reconciliation required');

  return (
    <article
      id={obligationAnchorId(item.obligationId)}
      className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-5 space-y-3"
    >
      <h3 className="font-semibold text-gray-900">{railLabel(item.rail)}</h3>
      <PartyLine debtor={item.debtor} creditor={item.creditor} />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Original</dt>
          <dd className="font-medium text-gray-900">{formatMoneyDisplay(item.originalPrincipal, item.currency)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Settled</dt>
          <dd className="font-medium text-gray-900">{formatMoneyDisplay(item.settledAmount, item.currency)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Remaining obligation</dt>
          <dd className="font-medium text-gray-900">{formatMoneyDisplay(item.remainingAmount, item.currency)}</dd>
        </div>
        {item.collectibleRemaining != null && (
          <div>
            <dt className="text-gray-500">Currently collectible</dt>
            <dd className="font-medium text-gray-900">{formatMoneyDisplay(item.collectibleRemaining, item.currency)}</dd>
          </div>
        )}
        <div>
          <dt className="text-gray-500">Financial state</dt>
          <dd>{financialStateLabel(item.financialState)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Reconciliation</dt>
          <dd>{stateLabel(item.reconciliationState)}</dd>
        </div>
      </dl>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((flag) => <Badge key={flag} label={flag} />)}
        </div>
      )}
      {item.reasonCode && <p className="text-sm text-gray-600">Reason {item.reasonCode}</p>}
    </article>
  );
}

export default function FinancialReconciliationDetailPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (!admin) return <AccessDenied />;
  return <DetailBody />;
}

function DetailBody() {
  const params = useParams();
  const wkOrderId = Number(params.wkOrderId);
  const [detail, setDetail] = useState<FinancialReconciliationDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;

    if (!Number.isInteger(wkOrderId) || wkOrderId <= 0) {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setError('Invalid order.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchOrderFinancialReconciliation(wkOrderId, controller.signal);
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setDetail(next);
      setUpdatedAt(new Date().toLocaleString());
      setError(null);
    } catch (err) {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      if (isAbortError(err)) return;
      const apiError = err instanceof FinancialReconciliationApiError ? err : null;
      setError(apiError?.message ?? (err instanceof Error ? err.message : 'Unable to load order reconciliation.'));
    } finally {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setLoading(false);
    }
  }, [wkOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const headerBadges = detail
    ? attentionBadges({
        hasOutstanding: detail.hasOutstanding,
        hasDispute: detail.hasDispute,
        hasReconciliationIssue: detail.hasReconciliationIssue,
      })
    : [];

  const rails = Array.from(new Set((detail?.items ?? []).map((item) => item.rail)));

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation" className="inline-block text-sm font-medium text-[#DB0002]">
        Back to Reconciliation
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order #{Number.isInteger(wkOrderId) ? wkOrderId : '—'}</h1>
          {rails.length > 0 && (
            <p className="mt-1 text-sm text-gray-600">{rails.map(railLabel).join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {headerBadges.map((badge) => <Badge key={badge.label} label={badge.label} />)}
          </div>
          {updatedAt && <p className="mt-2 text-xs text-gray-500">Updated just now · {updatedAt}</p>}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Refresh
        </button>
      </header>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {loading && (
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-2xl bg-gray-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
        </div>
      )}

      {!loading && detail && detail.items.length === 0 && (
        <p className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-600">
          No financial obligations are available for this order.
        </p>
      )}

      {!loading && detail && detail.findings.length > 0 && (
        <section className="space-y-3" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="text-lg font-semibold text-gray-900">Reconciliation Findings</h2>
          {detail.findings.map((finding) => (
            <article key={finding.findingKey} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-2">
              <h3 className="font-semibold text-gray-900">{findingTitle(finding.code)}</h3>
              <p className="text-sm text-gray-700">{findingExplanation(finding.code)}</p>
              <p className="text-sm text-gray-600">Detected state: {stateLabel(finding.reconciliationState)}</p>
              {finding.involvedItems.length > 0 && (
                <ul className="text-sm text-gray-700">
                  {finding.involvedItems.map((involved) => (
                    <li key={`${involved.rail}-${involved.obligationId}`}>
                      <a className="text-[#DB0002]" href={`#${obligationAnchorId(involved.obligationId)}`}>
                        {railLabel(involved.rail)} obligation
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer">Technical code</summary>
                <p>{finding.code}</p>
              </details>
            </article>
          ))}
        </section>
      )}

      {!loading && detail && detail.relatedItems.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2" aria-labelledby="related-heading">
          <h2 id="related-heading" className="text-lg font-semibold text-gray-900">Related obligations</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {detail.relatedItems.map((related, index) => (
              <li key={`${related.obligationId}-${related.relation}-${index}`}>
                {relationLabel(related.relation)}
                {' · '}
                <a className="text-[#DB0002]" href={`#${obligationAnchorId(related.obligationId)}`}>
                  {railLabel(related.rail)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && detail && detail.items.length > 0 && (
        <div className="space-y-8">
          {FINANCIAL_RAILS.map((rail) => {
            const group = detail.items.filter((item) => item.rail === rail);
            if (group.length === 0) return null;
            return (
              <section key={rail} className="space-y-3" aria-labelledby={`rail-${rail}`}>
                <h2 id={`rail-${rail}`} className="text-lg font-semibold text-gray-900">{railLabel(rail)}</h2>
                {group.map((item) => (
                  <ObligationCard key={item.obligationId} item={item} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
