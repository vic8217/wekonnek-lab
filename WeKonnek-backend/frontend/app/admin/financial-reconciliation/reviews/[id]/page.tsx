'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
  fetchOrderFinancialReconciliation,
} from '@/lib/financial-reconciliation-api';
import {
  fetchExceptionClaimsForOrder,
  fetchReturnFinancialResolution,
} from '@/lib/authoritative-domain-api';
import {
  resolveAuthoritativeWorkflow,
  type AuthoritativeWorkflowView,
} from '@/lib/financial-reconciliation-workflow';
import {
  findingExplanation,
  findingTitle,
  isAbortError,
  isCurrentGeneration,
  isFinancialReconciliationAdmin,
  nextGeneration,
  partyLabel,
  reviewRouteLabel,
  reviewStatusLabel,
} from '@/lib/financial-reconciliation-presentation';
import {
  addFinancialReconciliationReviewNote,
  assignFinancialReconciliationReview,
  closeFinancialReconciliationReview,
  escalateFinancialReconciliationReview,
  getFinancialReconciliationReview,
  refreshFinancialReconciliationReview,
  waitFinancialReconciliationReview,
  type ReviewDetail,
} from '@/lib/financial-reconciliation-review-api';

function AccessDenied() {
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">Reconciliation follow-up</h1>
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Access denied. System admin only.
      </p>
    </div>
  );
}

export default function FinancialReconciliationReviewDetailPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!admin) return <AccessDenied />;
  return <ReviewDetailBody adminUserId={user.id} />;
}

function ReviewDetailBody({ adminUserId }: { adminUserId: string }) {
  const params = useParams();
  const id = String(params.id ?? '');
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [waitingParty, setWaitingParty] = useState<'CUSTOMER' | 'MERCHANT' | 'RIDER'>('CUSTOMER');
  const [busy, setBusy] = useState(false);
  const [workflow, setWorkflow] = useState<AuthoritativeWorkflowView | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const reviewGenerationRef = useRef(0);
  const workflowGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = nextGeneration(reviewGenerationRef.current);
    reviewGenerationRef.current = generation;
    try {
      const next = await getFinancialReconciliationReview(id);
      if (!isCurrentGeneration(reviewGenerationRef.current, generation)) return;
      setReview(next);
      setError(null);
    } catch (err) {
      if (!isCurrentGeneration(reviewGenerationRef.current, generation)) return;
      setError(err instanceof FinancialReconciliationApiError ? err.message : 'Unable to load follow-up.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!review) {
      setWorkflow(null);
      return;
    }
    const controller = new AbortController();
    const generation = nextGeneration(workflowGenerationRef.current);
    workflowGenerationRef.current = generation;
    setWorkflowLoading(true);
    setWorkflowError(null);
    void (async () => {
      try {
        if (review.needsRefresh || review.stale) {
          const view = resolveAuthoritativeWorkflow({
            review,
            liveReconciliation: {
              wkOrderId: review.wkOrderId,
              items: [],
              findings: [],
              relatedItems: [],
              hasOutstanding: false,
              hasDispute: false,
              hasReconciliationIssue: false,
            },
          });
          if (!isCurrentGeneration(workflowGenerationRef.current, generation)) return;
          setWorkflow(view);
          return;
        }
        const live = await fetchOrderFinancialReconciliation(
          review.wkOrderId,
          controller.signal,
        );
        const needsStage12 = [
          'STAGE9_COVERAGE_MISSING',
          'STAGE9_COVERAGE_AMOUNT_MISMATCH',
          'COVERAGE_WRONG_LOSS',
          'SUBJECT_MATCH_UNKNOWN',
          'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
          'SUCCESSOR_REVIEW_REQUIRED',
        ].includes(review.findingCode);
        const needsStage9 =
          review.findingCode === 'RA_RETURN_RESTRICTION_MISSING' ||
          review.findingCode === 'RA_RETURN_DOUBLE_COLLECTIBLE';
        const claims = needsStage12
          ? await fetchExceptionClaimsForOrder(review.wkOrderId, controller.signal)
          : [];
        let stage9ReturnFinancialStatus: string | null = null;
        if (needsStage9) {
          const resolution = await fetchReturnFinancialResolution(
            review.wkOrderId,
            controller.signal,
          );
          stage9ReturnFinancialStatus = resolution.returnFinancialStatus ?? null;
        }
        const view = resolveAuthoritativeWorkflow({
          review,
          liveReconciliation: live,
          domainContext: { claims, stage9ReturnFinancialStatus },
        });
        if (!isCurrentGeneration(workflowGenerationRef.current, generation)) return;
        setWorkflow(view);
      } catch (err) {
        if (!isCurrentGeneration(workflowGenerationRef.current, generation)) return;
        if (isAbortError(err)) return;
        setWorkflow(null);
        setWorkflowError(
          err instanceof FinancialReconciliationApiError
            ? err.message
            : 'Unable to resolve authoritative workflow.',
        );
      } finally {
        if (!isCurrentGeneration(workflowGenerationRef.current, generation)) return;
        setWorkflowLoading(false);
      }
    })();
    return () => controller.abort();
  }, [review]);

  const run = async (fn: () => Promise<ReviewDetail | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) setReview(next);
      else await load();
    } catch (err) {
      setError(err instanceof FinancialReconciliationApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!review && !error) return <p className="text-sm text-gray-500">Loading…</p>;

  const closed = review != null && review.status.startsWith('CLOSED_');
  const blockClose = Boolean(review?.needsRefresh);

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation/reviews" className="text-sm font-medium text-[#DB0002]">
        Back to follow-ups
      </Link>
      {review && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Follow-up for order #{review.wkOrderId}</h1>
            <p className="mt-1 font-medium text-gray-900">{findingTitle(review.findingCode)}</p>
            <p className="mt-1 text-sm text-gray-700">{findingExplanation(review.findingCode)}</p>
            <p className="mt-2 text-sm text-gray-600">Status: {reviewStatusLabel(review.status)}</p>
            <p className="text-sm text-gray-600">
              Assignee: {review.assignedAdminUserId ? 'Assigned to a system admin' : 'Unassigned'}
            </p>
            {review.routeClassification && (
              <p className="text-sm text-gray-600">
                Routing: {reviewRouteLabel(review.routeClassification)}
                {review.waitingPartyType ? ` · ${partyLabel(review.waitingPartyType)}` : ''}
              </p>
            )}
            <p className="text-sm text-gray-600">
              Finding {review.findingActive ? 'is still active' : 'is no longer present on live reconciliation'}.
            </p>
            {review.stale && !closed && (
              <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Financial reconciliation changed since this review was opened. Refresh live reconciliation before closing or escalating.
              </p>
            )}
          </div>
          <Link
            href={`/admin/financial-reconciliation/${review.wkOrderId}`}
            className="text-sm font-medium text-[#DB0002]"
          >
            Open order reconciliation
          </Link>
        </header>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {review && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3" aria-labelledby="workflow-heading">
          <h2 id="workflow-heading" className="text-lg font-semibold text-gray-900">Authoritative workflow</h2>
          <p className="text-sm text-gray-600">
            Opening a domain page does not settle, acknowledge, or close this follow-up.
          </p>
          {workflowLoading && <p className="text-sm text-gray-500">Loading workflow…</p>}
          {workflowError && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {workflowError}
            </p>
          )}
          {workflow && (
            <>
              <p
                role="status"
                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-800"
              >
                {workflow.liveStatus}
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500">Workflow</dt>
                  <dd className="font-medium text-gray-900">{workflow.title}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Finding</dt>
                  <dd className="font-medium text-gray-900">{findingTitle(review.findingCode)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Required actor</dt>
                  <dd className="font-medium text-gray-900">{workflow.requiredActor}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Recommended next step</dt>
                  <dd className="font-medium text-gray-900">{workflow.safeAction}</dd>
                </div>
              </dl>
              {workflow.blockedReason && (
                <p className="text-sm text-amber-900">{workflow.blockedReason}</p>
              )}
              {workflow.notes.map((item) => (
                <p key={item} className="text-sm text-gray-700">{item}</p>
              ))}
              {workflow.destinationHref && workflow.destinationLabel && !workflow.blocked ? (
                <Link
                  href={workflow.destinationHref}
                  className="inline-flex rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white"
                >
                  {workflow.destinationLabel}
                </Link>
              ) : (
                <p className="text-sm text-gray-600">No money action.</p>
              )}
            </>
          )}
        </section>
      )}

      {review && !closed && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4" aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="text-lg font-semibold text-gray-900">Follow-up actions</h2>
          <p className="text-sm text-gray-600">
            These actions do not settle, mark paid, change balances, or remove the detector finding.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void run(() => refreshFinancialReconciliationReview(review.id))}
            >
              Refresh live reconciliation
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={() =>
                void run(() =>
                  assignFinancialReconciliationReview(review.id, {
                    assignedAdminUserId: adminUserId,
                    expectedVersion: review.rowVersion,
                  }),
                )
              }
            >
              Assign to me
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={() =>
                void run(() =>
                  assignFinancialReconciliationReview(review.id, {
                    assignedAdminUserId: null,
                    expectedVersion: review.rowVersion,
                  }),
                )
              }
            >
              Unassign
            </button>
          </div>
          {review.allowedRouteClassifications.includes('WAITING_ON_PARTY') && (
            <>
          <label className="block text-sm text-gray-700">
            Waiting on party type
            <select
              className="mt-1 w-full max-w-xs rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={waitingParty}
              onChange={(event) => setWaitingParty(event.target.value as typeof waitingParty)}
            >
              <option value="CUSTOMER">Customer</option>
              <option value="MERCHANT">Merchant</option>
              <option value="RIDER">Rider</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || blockClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={() =>
              void run(() =>
                waitFinancialReconciliationReview(review.id, {
                  waitingPartyType: waitingParty,
                  expectedVersion: review.rowVersion,
                  reason: reason || undefined,
                }),
              )
            }
          >
            Mark waiting on party
          </button>
            </>
          )}
          <label className="block text-sm text-gray-700">
            Reason
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim() || blockClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={() =>
                void run(() =>
                  escalateFinancialReconciliationReview(review.id, {
                    reason,
                    expectedVersion: review.rowVersion,
                  }),
                )
              }
            >
              Escalate to engineering
            </button>
            <button
              type="button"
              disabled={busy || !reason.trim() || blockClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              onClick={() =>
                void run(() =>
                  closeFinancialReconciliationReview(review.id, {
                    mode: 'CONDITION_CLEARED',
                    reason,
                    expectedVersion: review.rowVersion,
                  }),
                )
              }
            >
              Close — condition cleared
            </button>
            {review.reviewOnlyClosePermitted && (
              <button
                type="button"
                disabled={busy || !reason.trim() || blockClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                onClick={() =>
                  void run(() =>
                    closeFinancialReconciliationReview(review.id, {
                      mode: 'REVIEW_ONLY',
                      reason,
                      expectedVersion: review.rowVersion,
                    }),
                  )
                }
              >
                Close — review only
              </button>
            )}
          </div>
          {review.reviewOnlyClosePermitted && (
            <p className="text-sm text-amber-800">
              Closing this follow-up does not remove the reconciliation finding.
            </p>
          )}
          {blockClose && (
            <p className="text-sm text-amber-800">
              Refresh live reconciliation before closing or escalating.
            </p>
          )}
        </section>
      )}

      {review && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3" aria-labelledby="notes-heading">
          <h2 id="notes-heading" className="text-lg font-semibold text-gray-900">Notes</h2>
          {review.notes.map((item) => (
            <article key={item.id} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
              {item.body}
              <p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
            </article>
          ))}
          {!closed && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                void run(async () => {
                  await addFinancialReconciliationReviewNote(review.id, {
                    body: note,
                    idempotencyKey: crypto.randomUUID(),
                  });
                  setNote('');
                  return getFinancialReconciliationReview(review.id);
                });
              }}
            >
              <label className="block text-sm text-gray-700">
                Add note
                <textarea
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={busy || !note.trim()}
                className="rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Add note
              </button>
            </form>
          )}
        </section>
      )}

      {review && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2" aria-labelledby="audit-heading">
          <h2 id="audit-heading" className="text-lg font-semibold text-gray-900">Audit timeline</h2>
          <ol className="space-y-2 text-sm text-gray-700">
            {review.events.map((event) => (
              <li key={event.id}>
                {event.type} · {new Date(event.createdAt).toLocaleString()}
              </li>
            ))}
          </ol>
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer">Technical details</summary>
            <p>Opening fingerprint {review.openingFingerprint}</p>
            <p>Current fingerprint {review.currentFingerprint}</p>
            <p>Finding key {review.findingKey}</p>
          </details>
        </section>
      )}
    </div>
  );
}
