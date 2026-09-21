'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { getUser, useAuth } from '@/hooks/use-auth';
import {
  FinancialReconciliationApiError,
  fetchOrderFinancialReconciliation,
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
import {
  addEvidence,
  captureOrderTermsEvidence,
  createDetermination,
  createVerifiedFact,
  proposeDetermination,
  recordLiabilityDetermination,
  createAdjustment,
  verifyEvidence,
} from '@/lib/exception-liability-admin-api';
import {
  COVERAGE_INVESTIGATION_COPY,
  asRecordList,
  canCreateLiabilityDraft,
  canSubmitEligibleLiabilityDraft,
  claimWorkspacePanelKey,
  collectAuthoritativeDebtorOptions,
  collectFinalizationDebtorOptions,
  collectAuthoritativeFactAttributionOptions,
  mutateAfterOwnedPreflight,
  createCorrelationId,
  decidePostMutationRefreshOutcome,
  isCreateDeterminationProven,
  isEligibleDraftReviewProven,
  isOriginalLiabilityRecordingProven,
  isSuccessorAdjustmentProven,
  isSuccessorLiabilityRecordingProven,
  canRecordOriginalLiability,
  canCreateSuccessorAdjustment,
  canRecordSuccessorLiability,
  analyzeSuccessorTopology,
  reconHasSuccessorSourceInconsistency,
  findRowByIdempotencyKey,
  isAmbiguousMutationFailure,
  isCurrentClaimOwner,
  mayAbortRouteLoad,
  normalizeExpectedWkOrderId,
  ownedResultDecision,
  stringField,
  type ClaimOwner,
  type MutationPhase,
} from '@/lib/exception-liability-admin-presentation';
import { ClaimEvidencePanel } from './claim-evidence-panel';
import { VerifiedFactsPanel } from './verified-facts-panel';
import { LiabilityDeterminationPanel } from './liability-determination-panel';
import { ClaimEventTimeline } from './claim-event-timeline';

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
  const normalizedExpectedWkOrderId = normalizeExpectedWkOrderId(expectedWkOrderId);
  const generationRef = useRef(0);
  const routeEpochRef = useRef(0);
  const routeClaimIdRef = useRef(id);
  const routeExpectedWkOrderIdRef = useRef(normalizedExpectedWkOrderId);
  const loadAbortRef = useRef<AbortController | null>(null);
  routeClaimIdRef.current = id;
  routeExpectedWkOrderIdRef.current = normalizedExpectedWkOrderId;
  const [claim, setClaim] = useState<ExceptionClaimRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderMismatch, setOrderMismatch] = useState(false);
  const [evidencePhase, setEvidencePhase] = useState<MutationPhase>('idle');
  const [orderTermsPhase, setOrderTermsPhase] = useState<MutationPhase>('idle');
  const [verifyPhase, setVerifyPhase] = useState<MutationPhase>('idle');
  const [factPhase, setFactPhase] = useState<MutationPhase>('idle');
  const [createDetPhase, setCreateDetPhase] = useState<MutationPhase>('idle');
  const [draftReviewPhase, setDraftReviewPhase] = useState<MutationPhase>('idle');
  const [originalRecordPhase, setOriginalRecordPhase] = useState<MutationPhase>('idle');
  const [adjustmentPhase, setAdjustmentPhase] = useState<MutationPhase>('idle');
  const [successorRecordPhase, setSuccessorRecordPhase] = useState<MutationPhase>('idle');
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [orderTermsError, setOrderTermsError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [factError, setFactError] = useState<string | null>(null);
  const [createDetError, setCreateDetError] = useState<string | null>(null);
  const [draftReviewError, setDraftReviewError] = useState<string | null>(null);
  const [originalRecordError, setOriginalRecordError] = useState<string | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [successorRecordError, setSuccessorRecordError] = useState<string | null>(null);

  const loadClaim = async (
    claimId: string,
    generation: number,
    controller: AbortController,
  ) => {
    const next = await fetchExceptionClaim(claimId, controller.signal);
    if (!isCurrentGeneration(generationRef.current, generation)) return null;
    return next;
  };

  useEffect(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    routeEpochRef.current += 1;
    const loadOwner: ClaimOwner = {
      claimId: id,
      expectedWkOrderId: normalizeExpectedWkOrderId(expectedWkOrderId),
      epoch: routeEpochRef.current,
    };
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    setHttpStatus(null);
    setOrderMismatch(false);
    setClaim(null);
    setEvidencePhase('idle');
    setOrderTermsPhase('idle');
    setVerifyPhase('idle');
    setFactPhase('idle');
    setCreateDetPhase('idle');
    setDraftReviewPhase('idle');
    setOriginalRecordPhase('idle');
    setAdjustmentPhase('idle');
    setSuccessorRecordPhase('idle');
    setEvidenceError(null);
    setOrderTermsError(null);
    setVerifyError(null);
    setFactError(null);
    setCreateDetError(null);
    setDraftReviewError(null);
    setOriginalRecordError(null);
    setAdjustmentError(null);
    setSuccessorRecordError(null);
    void (async () => {
      try {
        const next = await loadClaim(id, generation, controller);
        if (!ownerIsCurrent(loadOwner)) return;
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (!next) {
          setError('Liability claim not found.');
          return;
        }
        if (!expectedOrderMatches(loadOwner.expectedWkOrderId, next.wkOrderId)) {
          setOrderMismatch(true);
          setClaim(null);
          return;
        }
        setClaim(next);
      } catch (err) {
        if (!ownerIsCurrent(loadOwner)) return;
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        if (isAbortError(err)) return;
        const apiError = err instanceof FinancialReconciliationApiError ? err : null;
        setHttpStatus(apiError?.status ?? null);
        setError(
          apiError?.message ??
            (err instanceof Error ? err.message : 'Unable to load liability claim.'),
        );
      } finally {
        if (!ownerIsCurrent(loadOwner)) return;
        if (!isCurrentGeneration(generationRef.current, generation)) return;
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [id, expectedWkOrderId]);

  const currentOwner = (): ClaimOwner => ({
    claimId: routeClaimIdRef.current,
    expectedWkOrderId: routeExpectedWkOrderIdRef.current,
    epoch: routeEpochRef.current,
  });

  const ownerIsCurrent = (owner: ClaimOwner) =>
    isCurrentClaimOwner({
      owner,
      routeClaimId: routeClaimIdRef.current,
      routeExpectedWkOrderId: routeExpectedWkOrderIdRef.current,
      routeEpoch: routeEpochRef.current,
    });

  const inspectLiveRecon = async (latest: ExceptionClaimRecord) => {
    const orderId = latest.wkOrderId;
    if (typeof orderId !== 'number') {
      return 'Live reconciliation could not be loaded. The action was not sent.';
    }
    try {
      const recon = await fetchOrderFinancialReconciliation(orderId);
      if (reconHasSuccessorSourceInconsistency(recon.findings)) {
        return 'Live reconciliation reports an inconsistent successor topology. The action was not sent.';
      }
      return null;
    } catch {
      return 'Live reconciliation could not be loaded. The action was not sent.';
    }
  };

  const refreshAfterMutation = async (
    owner: ClaimOwner,
  ): Promise<ExceptionClaimRecord | null | 'discarded'> => {
    if (!ownerIsCurrent(owner)) return 'discarded';
    if (
      mayAbortRouteLoad({
        owner: {
          claimId: owner.claimId,
          expectedWkOrderId: owner.expectedWkOrderId,
        },
        route: {
          claimId: routeClaimIdRef.current,
          expectedWkOrderId: routeExpectedWkOrderIdRef.current,
        },
      })
    ) {
      loadAbortRef.current?.abort();
    }
    if (!ownerIsCurrent(owner)) return 'discarded';
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const generation = nextGeneration(generationRef.current);
    generationRef.current = generation;
    const next = await loadClaim(owner.claimId, generation, controller);
    if (
      ownedResultDecision({
        owner,
        routeClaimId: routeClaimIdRef.current,
        routeExpectedWkOrderId: routeExpectedWkOrderIdRef.current,
        routeEpoch: routeEpochRef.current,
        loadGeneration: generationRef.current,
        responseGeneration: generation,
      }) === 'ignore'
    ) {
      return 'discarded';
    }
    if (next && !expectedOrderMatches(owner.expectedWkOrderId, next.wkOrderId)) {
      setOrderMismatch(true);
      setClaim(null);
      return null;
    }
    if (next) setClaim(next);
    return next;
  };

  const runMutation = async (input: {
    setPhase: (phase: MutationPhase) => void;
    setError: (message: string | null) => void;
    mutate: (signal: AbortSignal) => Promise<unknown>;
    confirm: (latest: ExceptionClaimRecord) => boolean;
    preflight?: (
      latest: ExceptionClaimRecord,
    ) => string | null | Promise<string | null>;
    requireAuthoritativeProof?: boolean;
  }): Promise<'success' | 'unproven' | 'error' | 'discarded'> => {
    const owner = currentOwner();
    if (!ownerIsCurrent(owner)) return 'discarded';
    input.setPhase('submitting');
    input.setError(null);
    const controller = new AbortController();
    const applyRefreshOutcome = (
      latest: ExceptionClaimRecord | null | 'discarded',
      requireAuthoritativeProof: boolean,
    ): 'success' | 'unproven' | 'error' | 'discarded' => {
      const discarded = latest === 'discarded' || !ownerIsCurrent(owner);
      const hasLatest = latest != null && latest !== 'discarded';
      const confirmed =
        hasLatest && input.confirm(latest as ExceptionClaimRecord);
      const outcome = decidePostMutationRefreshOutcome({
        discarded,
        hasLatest,
        requireAuthoritativeProof,
        confirmed,
      });
      if (outcome === 'discarded') return 'discarded';
      if (outcome === 'success') {
        input.setPhase('success');
        input.setError(null);
        return 'success';
      }
      if (outcome === 'unproven') {
        input.setPhase('error');
        return 'unproven';
      }
      input.setPhase('error');
      return 'error';
    };
    try {
      if (input.preflight) {
        const latest = await refreshAfterMutation(owner);
        if (latest === 'discarded' || !ownerIsCurrent(owner)) return 'discarded';
        if (!latest) {
          input.setPhase('error');
          input.setError('The claim could not be reloaded.');
          return 'error';
        }
        const gated = await mutateAfterOwnedPreflight({
          ownerIsCurrent: () => ownerIsCurrent(owner),
          runPreflight: () => Promise.resolve(input.preflight!(latest)),
          mutate: () => input.mutate(controller.signal),
        });
        if (gated.status === 'discarded') return 'discarded';
        if (gated.status === 'blocked') {
          input.setPhase('error');
          input.setError(gated.message);
          return 'error';
        }
      } else {
        if (!ownerIsCurrent(owner)) return 'discarded';
        await input.mutate(controller.signal);
      }
      if (!ownerIsCurrent(owner)) return 'discarded';
      if (input.requireAuthoritativeProof) {
        input.setPhase('reconciling');
      }
      const latest = await refreshAfterMutation(owner);
      const outcome = applyRefreshOutcome(
        latest,
        Boolean(input.requireAuthoritativeProof),
      );
      if (outcome === 'unproven') {
        input.setError(
          'The server accepted the request, but this claim does not yet prove the same action. Retry the same request.',
        );
      }
      return outcome;
    } catch (err) {
      if (!ownerIsCurrent(owner)) return 'discarded';
      if (isAbortError(err)) return 'discarded';
      const apiError = err instanceof FinancialReconciliationApiError ? err : null;
      const status = apiError?.status ?? null;
      if (status === 409 || isAmbiguousMutationFailure(status)) {
        input.setPhase('reconciling');
        try {
          const latest = await refreshAfterMutation(owner);
          const outcome = applyRefreshOutcome(latest, true);
          if (outcome === 'unproven' || outcome === 'error') {
            input.setError(
              apiError?.message ??
                (err instanceof Error ? err.message : 'The claim was not changed.'),
            );
          }
          return outcome;
        } catch (refreshErr) {
          if (!ownerIsCurrent(owner)) return 'discarded';
          input.setPhase('error');
          input.setError(
            refreshErr instanceof Error ? refreshErr.message : 'Unable to reload the claim.',
          );
          return 'unproven';
        }
      }
      input.setPhase('error');
      input.setError(
        apiError?.message ??
          (err instanceof Error ? err.message : 'The claim was not changed.'),
      );
      return 'error';
    }
  };

  const currency = displayServerField(claim?.currency);
  const loss =
    claim?.economicLoss && typeof claim.economicLoss === 'object'
      ? (claim.economicLoss as Record<string, unknown>)
      : null;
  const coverages = asRecordList(loss?.coverages);
  const determinations = asRecordList(claim?.determinations);
  const obligations = asRecordList(claim?.obligations);
  const evidence = asRecordList(claim?.evidence);
  const verifications = asRecordList(claim?.verifications);
  const facts = asRecordList(claim?.verifiedFacts);
  const events = asRecordList(claim?.events);

  return (
    <div className="w-full space-y-6">
      <Link href="/admin/financial-reconciliation/reviews" className="text-sm font-medium text-[#DB0002]">
        Back to follow-ups
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Liability claim</h1>
        <p className="mt-1 text-sm text-gray-600">
          Authoritative inspection. Evidence, verification, verified facts, and a liability
          draft may be recorded on an active claim. Proposal of an eligible draft is still
          a review state. This page does not settle, acknowledge, finalize, adjust, import
          coverage, or open a claim. Return to the follow-up and refresh live reconciliation
          there. This page does not close the follow-up.
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
            <h2 id="claim-heading" className="text-lg font-semibold text-gray-900">Claim overview</h2>
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

          <ClaimEvidencePanel
            key={claimWorkspacePanelKey(id, expectedWkOrderId, 'evidence')}
            claimId={claim.id}
            status={claim.status}
            evidence={evidence}
            verifications={verifications}
            evidencePhase={evidencePhase}
            orderTermsPhase={orderTermsPhase}
            verifyPhase={verifyPhase}
            evidenceError={evidenceError ?? verifyError}
            orderTermsError={orderTermsError}
            onRecordEvidence={(input) =>
              runMutation({
                setPhase: setEvidencePhase,
                setError: setEvidenceError,
                mutate: (signal) =>
                  addEvidence(
                    claim.id,
                    {
                      ...input,
                      correlationId: createCorrelationId(),
                    },
                    signal,
                  ),
                confirm: (latest) =>
                  Boolean(
                    findRowByIdempotencyKey(asRecordList(latest.evidence), input.idempotencyKey),
                  ),
              })
            }
            onCaptureOrderTerms={(idempotencyKey) =>
              runMutation({
                setPhase: setOrderTermsPhase,
                setError: setOrderTermsError,
                mutate: (signal) =>
                  captureOrderTermsEvidence(
                    claim.id,
                    { correlationId: createCorrelationId(), idempotencyKey },
                    signal,
                  ),
                confirm: (latest) =>
                  Boolean(
                    findRowByIdempotencyKey(asRecordList(latest.evidence), idempotencyKey),
                  ),
              })
            }
            onRecordVerification={(input) =>
              runMutation({
                setPhase: setVerifyPhase,
                setError: setVerifyError,
                mutate: (signal) =>
                  verifyEvidence(
                    claim.id,
                    input.evidenceId,
                    {
                      verificationStatus: input.verificationStatus,
                      notes: input.notes,
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                confirm: (latest) =>
                  Boolean(
                    findRowByIdempotencyKey(
                      asRecordList(latest.verifications),
                      input.idempotencyKey,
                    ),
                  ),
              })
            }
          />

          <VerifiedFactsPanel
            key={claimWorkspacePanelKey(id, expectedWkOrderId, 'facts')}
            status={claim.status}
            facts={facts}
            evidence={evidence}
            verifications={verifications}
            attributionOptions={collectAuthoritativeFactAttributionOptions(
              claim as Record<string, unknown>,
            )}
            phase={factPhase}
            error={factError}
            onConcludeFact={(input) =>
              runMutation({
                setPhase: setFactPhase,
                setError: setFactError,
                mutate: (signal) =>
                  createVerifiedFact(
                    claim.id,
                    {
                      ...input,
                      correlationId: createCorrelationId(),
                    },
                    signal,
                  ),
                confirm: (latest) =>
                  Boolean(
                    findRowByIdempotencyKey(
                      asRecordList(latest.verifiedFacts),
                      input.idempotencyKey,
                    ),
                  ),
              })
            }
          />

          <LiabilityDeterminationPanel
            key={claimWorkspacePanelKey(id, expectedWkOrderId, 'determination')}
            claimId={claim.id}
            claimStatus={claim.status}
            claimType={claim.claimType}
            currency={claim.currency}
            loss={loss}
            facts={facts}
            determinations={determinations}
            determinationRoleLabel={determinationRoleLabel}
            debtorOptions={collectAuthoritativeDebtorOptions(
              claim as Record<string, unknown>,
            )}
            finalizationDebtorOptions={collectFinalizationDebtorOptions(
              claim as Record<string, unknown>,
            )}
            createPhase={createDetPhase}
            proposePhase={draftReviewPhase}
            originalRecordPhase={originalRecordPhase}
            adjustmentPhase={adjustmentPhase}
            successorRecordPhase={successorRecordPhase}
            createError={createDetError}
            proposeError={draftReviewError}
            originalRecordError={originalRecordError}
            adjustmentError={adjustmentError}
            successorRecordError={successorRecordError}
            onCreateDraft={(input) =>
              runMutation({
                setPhase: setCreateDetPhase,
                setError: setCreateDetError,
                preflight: (latest) => {
                  const ok = canCreateLiabilityDraft({
                    claimStatus: latest.status,
                    facts: asRecordList(latest.verifiedFacts),
                    determinations: asRecordList(latest.determinations),
                    debtorOptions: collectAuthoritativeDebtorOptions(
                      latest as Record<string, unknown>,
                    ),
                  });
                  return ok
                    ? null
                    : 'The claim is no longer eligible for a new draft. Reload before continuing.';
                },
                mutate: (signal) =>
                  createDetermination(
                    claim.id,
                    {
                      allocations: input.allocations,
                      reason: input.reason,
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                requireAuthoritativeProof: true,
                confirm: (latest) =>
                  isCreateDeterminationProven({
                    claimId: latest.id,
                    determinations: asRecordList(latest.determinations),
                    createIdempotencyKey: input.idempotencyKey,
                  }),
              })
            }
            onSubmitDraftForReview={(input) =>
              runMutation({
                setPhase: setDraftReviewPhase,
                setError: setDraftReviewError,
                preflight: (latest) => {
                  const row =
                    asRecordList(latest.determinations).find(
                      (item) => stringField(item, 'id') === input.determinationId,
                    ) ?? null;
                  const ok = canSubmitEligibleLiabilityDraft({
                    claimId: latest.id,
                    claimStatus: latest.status,
                    determination: row,
                  });
                  return ok
                    ? null
                    : 'The determination is no longer an eligible draft. Reload before continuing.';
                },
                mutate: (signal) =>
                  proposeDetermination(
                    input.determinationId,
                    {
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                requireAuthoritativeProof: true,
                confirm: (latest) =>
                  isEligibleDraftReviewProven({
                    claimId: latest.id,
                    determinationId: input.determinationId,
                    determinations: asRecordList(latest.determinations),
                    proposeIdempotencyKey: input.idempotencyKey,
                  }),
              })
            }
            onRecordOriginalLiability={(input) =>
              runMutation({
                setPhase: setOriginalRecordPhase,
                setError: setOriginalRecordError,
                preflight: async (latest) => {
                  const row =
                    asRecordList(latest.determinations).find(
                      (item) => stringField(item, 'id') === input.determinationId,
                    ) ?? null;
                  const ok = canRecordOriginalLiability({
                    claimId: latest.id,
                    determination: row,
                    debtorOptions: collectFinalizationDebtorOptions(
                      latest as Record<string, unknown>,
                    ),
                  });
                  if (!ok) {
                    return 'The determination is no longer eligible. Reload before continuing.';
                  }
                  return inspectLiveRecon(latest);
                },
                mutate: (signal) =>
                  recordLiabilityDetermination(
                    input.determinationId,
                    {
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                requireAuthoritativeProof: true,
                confirm: (latest) =>
                  isOriginalLiabilityRecordingProven({
                    claimId: latest.id,
                    determinationId: input.determinationId,
                    determinations: asRecordList(latest.determinations),
                    finalizeIdempotencyKey: input.idempotencyKey,
                  }),
              })
            }
            onCreateAdjustment={(input) =>
              runMutation({
                setPhase: setAdjustmentPhase,
                setError: setAdjustmentError,
                preflight: async (latest) => {
                  const determinations = asRecordList(latest.determinations);
                  const ok = canCreateSuccessorAdjustment({
                    facts: asRecordList(latest.verifiedFacts),
                    determinations,
                    debtorOptions: collectFinalizationDebtorOptions(
                      latest as Record<string, unknown>,
                    ),
                  });
                  const topology = analyzeSuccessorTopology(determinations);
                  if (!ok || topology.tipId !== input.parentDeterminationId) {
                    return 'The claim is no longer eligible for an adjustment. Reload before continuing.';
                  }
                  return inspectLiveRecon(latest);
                },
                mutate: (signal) =>
                  createAdjustment(
                    input.parentDeterminationId,
                    {
                      allocations: input.allocations,
                      reason: input.reason,
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                requireAuthoritativeProof: true,
                confirm: (latest) =>
                  isSuccessorAdjustmentProven({
                    claimId: latest.id,
                    parentDeterminationId: input.parentDeterminationId,
                    determinations: asRecordList(latest.determinations),
                    createIdempotencyKey: input.idempotencyKey,
                  }),
              })
            }
            onRecordSuccessorLiability={(input) =>
              runMutation({
                setPhase: setSuccessorRecordPhase,
                setError: setSuccessorRecordError,
                preflight: async (latest) => {
                  const row =
                    asRecordList(latest.determinations).find(
                      (item) => stringField(item, 'id') === input.determinationId,
                    ) ?? null;
                  const ok = canRecordSuccessorLiability({
                    claimId: latest.id,
                    determination: row,
                    determinations: asRecordList(latest.determinations),
                    debtorOptions: collectFinalizationDebtorOptions(
                      latest as Record<string, unknown>,
                    ),
                  });
                  if (!ok) {
                    return 'The successor is no longer eligible. Reload before continuing.';
                  }
                  return inspectLiveRecon(latest);
                },
                mutate: (signal) =>
                  recordLiabilityDetermination(
                    input.determinationId,
                    {
                      correlationId: createCorrelationId(),
                      idempotencyKey: input.idempotencyKey,
                    },
                    signal,
                  ),
                requireAuthoritativeProof: true,
                confirm: (latest) =>
                  isSuccessorLiabilityRecordingProven({
                    claimId: latest.id,
                    successorId: input.determinationId,
                    parentDeterminationId: input.parentDeterminationId,
                    determinations: asRecordList(latest.determinations),
                    finalizeIdempotencyKey: input.idempotencyKey,
                  }),
              })
            }
          />

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="loss-heading">
            <h2 id="loss-heading" className="text-lg font-semibold text-gray-900">Economic loss & coverage</h2>
            <p className="mt-1 text-sm text-gray-600">{COVERAGE_INVESTIGATION_COPY}</p>
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
            <h3 className="mt-4 text-sm font-semibold text-gray-900">Coverage</h3>
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

          <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="obls-heading">
            <h2 id="obls-heading" className="text-lg font-semibold text-gray-900">Obligations</h2>
            <p className="mt-1 text-sm text-gray-600">
              Read-only. System Admin cannot claim, acknowledge, reject, record cash, or mark WRITTEN_OFF here.
            </p>
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

          <ClaimEventTimeline events={events} />
        </>
      )}
    </div>
  );
}
