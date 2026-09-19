'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getUser, useAuth } from '@/hooks/use-auth';
import { FinancialReconciliationApiError, searchFinancialReconciliation } from '@/lib/financial-reconciliation-api';
import {
  DEFAULT_QUEUE_FILTERS,
  FINANCIAL_RAILS,
  RECONCILIATION_FINDING_CODES,
  RECONCILIATION_STATES,
  type PeriodPreset,
  type QueueFilterState,
  type QueueSearchItem,
  appendUniqueOrders,
  filterFingerprint,
  findingTitle,
  formatSourceActivity,
  hasDerivedQueueFilters,
  isAbortError,
  isCurrentGeneration,
  isFinancialReconciliationAdmin,
  nextGeneration,
  queueCardView,
  queueEmptyCopy,
  queueEmptyKind,
  railLabel,
  serializeQueueFilters,
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

export default function FinancialReconciliationQueuePage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);

  if (loading || !user) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (!admin) return <AccessDenied />;
  return <QueueBody />;
}

function QueueBody() {
  const [filters, setFilters] = useState<QueueFilterState>(DEFAULT_QUEUE_FILTERS);
  const [items, setItems] = useState<QueueSearchItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [lastBatchCount, setLastBatchCount] = useState(0);
  const [scanned, setScanned] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const serialized = useMemo(
    () => serializeQueueFilters(filters, new Date()),
    [filters],
  );
  const fingerprint = serialized.ok ? filterFingerprint(serialized.query) : '';

  const load = useCallback(async (mode: 'replace' | 'append', cursor: string | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;

    const parsed = serializeQueueFilters(filters, new Date());
    if (!parsed.ok) {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setInlineError(parsed.message);
      setLoading(false);
      setContinuing(false);
      return;
    }
    if (mode === 'replace') {
      setInlineError(null);
      setLoadError(null);
      setLoading(true);
      setContinuing(false);
    } else {
      setContinuing(true);
    }
    try {
      const response = await searchFinancialReconciliation(
        parsed.query,
        cursor,
        controller.signal,
      );
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setLastBatchCount(response.items.length);
      setNextCursor(response.nextCursor);
      setExhausted(response.exhausted);
      setScanned(response.scanned);
      setItems((current) =>
        mode === 'append'
          ? appendUniqueOrders(current, response.items).items
          : response.items,
      );
      setLoadError(null);
      setInlineError(null);
    } catch (err) {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      if (isAbortError(err)) return;
      const apiError = err instanceof FinancialReconciliationApiError ? err : null;
      if (apiError?.resetCursor) {
        toast.error(apiError.message);
        setNextCursor(null);
        setItems([]);
        try {
          const retry = await searchFinancialReconciliation(
            parsed.query,
            null,
            controller.signal,
          );
          if (!isCurrentGeneration(generationRef.current, generation)) return;
          setLastBatchCount(retry.items.length);
          setNextCursor(retry.nextCursor);
          setExhausted(retry.exhausted);
          setScanned(retry.scanned);
          setItems(retry.items);
          setLoadError(null);
        } catch (retryErr) {
          if (!isCurrentGeneration(generationRef.current, generation)) return;
          if (isAbortError(retryErr)) return;
          setLoadError(
            retryErr instanceof Error ? retryErr.message : 'Unable to load financial reconciliation.',
          );
        }
      } else if (apiError?.inlinePeriod) {
        setInlineError(apiError.message);
      } else {
        setLoadError(
          err instanceof Error ? err.message : 'Unable to load financial reconciliation.',
        );
      }
    } finally {
      if (!isCurrentGeneration(generationRef.current, generation)) return;
      setLoading(false);
      setContinuing(false);
    }
  }, [filters]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setExhausted(false);
    setLastBatchCount(0);
    void load('replace', null);
  }, [fingerprint, load]);

  const emptyKind = queueEmptyKind({
    accumulatedCount: items.length,
    lastBatchCount,
    nextCursor,
    exhausted,
    hasDerivedFilters: hasDerivedQueueFilters(filters),
  });
  const emptyCopy = !loading ? queueEmptyCopy(emptyKind) : null;

  const update = <K extends keyof QueueFilterState>(key: K, value: QueueFilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financial Reconciliation</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Discover orders with financial obligations or detected reconciliation issues.
            Amounts and parties open on the order review. Search is limited to 30 days.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load('replace', null)}
          className="rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={loading}
        >
          Refresh
        </button>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="filters-heading">
        <h2 id="filters-heading" className="text-sm font-semibold text-gray-900">Filters</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <label className="text-sm text-gray-700">
            Period
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.period}
              onChange={(event) => update('period', event.target.value as PeriodPreset)}
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="14d">Last 14 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {filters.period === 'custom' && (
            <>
              <label className="text-sm text-gray-700">
                From
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={filters.customFrom}
                  onChange={(event) => update('customFrom', event.target.value)}
                />
              </label>
              <label className="text-sm text-gray-700">
                To
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={filters.customTo}
                  onChange={(event) => update('customTo', event.target.value)}
                />
              </label>
            </>
          )}
          <label className="text-sm text-gray-700">
            Rail
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.rail}
              onChange={(event) => update('rail', event.target.value)}
            >
              <option value="">All</option>
              {FINANCIAL_RAILS.map((rail) => (
                <option key={rail} value={rail}>{railLabel(rail)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Review status
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.reviewStatus}
              onChange={(event) => update('reviewStatus', event.target.value as QueueFilterState['reviewStatus'])}
            >
              <option value="all">All</option>
              <option value="needs">Needs review</option>
              <option value="none">No detected issue</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Outstanding
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.outstanding}
              onChange={(event) => update('outstanding', event.target.value as QueueFilterState['outstanding'])}
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Disputed
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.disputed}
              onChange={(event) => update('disputed', event.target.value as QueueFilterState['disputed'])}
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Finding
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.findingCode}
              onChange={(event) => update('findingCode', event.target.value)}
            >
              <option value="">All</option>
              {RECONCILIATION_FINDING_CODES.map((code) => (
                <option key={code} value={code}>{findingTitle(code)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Reconciliation state
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={filters.reconciliationState}
              onChange={(event) => update('reconciliationState', event.target.value)}
            >
              <option value="">All</option>
              {RECONCILIATION_STATES.map((state) => (
                <option key={state} value={state}>{stateLabel(state)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Order ID
            <input
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={filters.wkOrderId}
              onChange={(event) => update('wkOrderId', event.target.value)}
            />
          </label>
          <label className="text-sm text-gray-700">
            Obligation ID
            <input
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={filters.obligationId}
              onChange={(event) => update('obligationId', event.target.value)}
              aria-describedby="obligation-hint"
            />
          </label>
        </div>
        <p id="obligation-hint" className="mt-2 text-xs text-gray-500">
          Obligation lookup requires a rail.
        </p>
        {inlineError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {inlineError}
          </p>
        )}
      </section>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {loading && (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
        </div>
      )}

      {!loading && emptyCopy && (
        <p className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-600">
          {emptyCopy}
        </p>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="grid gap-4 md:hidden">
            {items.map((item) => {
              const card = queueCardView(item);
              return (
                <article key={item.wkOrderId} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
                  <h2 className="font-semibold text-gray-900">Order #{card.wkOrderId}</h2>
                  <p className="text-sm text-gray-600">{card.railLabels.join(' · ')}</p>
                  <div className="flex flex-wrap gap-1">
                    {card.badges.map((badge) => <Badge key={badge.label} label={badge.label} />)}
                  </div>
                  {card.findingTitles.length > 0 && (
                    <ul className="text-sm text-gray-700">
                      {card.findingTitles.map((title) => <li key={title}>{title}</li>)}
                      {card.extraFindings > 0 && <li>+{card.extraFindings} more</li>}
                    </ul>
                  )}
                  <p className="text-xs text-gray-500">Source activity {formatSourceActivity(card.sourceActivityAt)}</p>
                  <Link
                    href={`/admin/financial-reconciliation/${card.wkOrderId}`}
                    className="inline-block text-sm font-medium text-[#DB0002]"
                  >
                    Open review
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Rails</th>
                  <th className="px-4 py-3">Attention</th>
                  <th className="px-4 py-3">Source activity</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const card = queueCardView(item);
                  return (
                    <tr key={item.wkOrderId} className="border-t border-gray-100 align-top">
                      <td className="px-4 py-3 font-medium text-gray-900">#{card.wkOrderId}</td>
                      <td className="px-4 py-3 text-gray-700">{card.railLabels.join(', ')}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {card.badges.map((badge) => <Badge key={badge.label} label={badge.label} />)}
                        </div>
                        {card.findingTitles.length > 0 && (
                          <p className="mt-1 text-xs text-gray-500">
                            {card.findingTitles.join(' · ')}
                            {card.extraFindings > 0 ? ` +${card.extraFindings} more` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatSourceActivity(card.sourceActivityAt)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/financial-reconciliation/${card.wkOrderId}`}
                          className="font-medium text-[#DB0002]"
                        >
                          Open review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {scanned != null && emptyKind === 'batch' && (
        <p className="text-xs text-gray-500">{scanned} candidate orders checked in this request.</p>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => void load('append', nextCursor)}
          disabled={continuing}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 disabled:opacity-50 sm:w-auto"
        >
          {continuing ? 'Searching…' : 'Continue search'}
        </button>
      )}
    </div>
  );
}
