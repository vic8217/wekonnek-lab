'use client';

import { useMemo, useState } from 'react';
import {
  displayServerAmount,
  displayServerField,
  partyRoleLabel,
} from '@/lib/authoritative-domain-presentation';
import {
  DETERMINATION_ADJUSTMENT_IMMUTABLE_COPY,
  DETERMINATION_ADJUSTMENT_SEMANTICS_COPY,
  DETERMINATION_CREDITOR_COPY,
  DETERMINATION_DRAFT_IMMUTABLE_COPY,
  DETERMINATION_PROPOSE_CONFIRM_COPY,
  DETERMINATION_RECORD_ORIGINAL_CONFIRM_COPY,
  DETERMINATION_RECORD_SUCCESSOR_CONFIRM_COPY,
  DETERMINATION_REVIEW_COPY,
  DETERMINATION_SELF_LIABILITY_COPY,
  DETERMINATION_SELF_LIABILITY_OBSERVATION_COPY,
  DETERMINATION_UNPROVABLE_ALLOCATION_COPY,
  allocationGroundingFacts,
  analyzeSuccessorTopology,
  asRecordList,
  attributionFromOptionKey,
  adjustmentGestureLocksPayload,
  canCreateLiabilityDraft,
  canCreateSuccessorAdjustment,
  canRecordOriginalLiability,
  canRecordSuccessorLiability,
  canSubmitEligibleLiabilityDraft,
  completeGesture,
  isPositiveMoneyString,
  isSuccessorDetermination,
  markGestureAmbiguous,
  resolveAdjustmentMutationPayload,
  storedAllocationsAreBounded,
  stringField,
  submitGesture,
  type ActiveGesture,
  type FactAttributionOption,
  type FrozenAdjustmentMutation,
  type MutationPhase,
} from '@/lib/exception-liability-admin-presentation';

type AllocationDraftRow = {
  rowId: string;
  optionKey: string;
  amount: string;
  verifiedFactId: string;
  basis: string;
};

type Props = {
  claimId: string;
  claimStatus: unknown;
  claimType: unknown;
  currency: unknown;
  loss: Record<string, unknown> | null;
  facts: Array<Record<string, unknown>>;
  determinations: Array<Record<string, unknown>>;
  determinationRoleLabel: (determination: Record<string, unknown>) => string;
  debtorOptions: FactAttributionOption[];
  finalizationDebtorOptions: FactAttributionOption[];
  createPhase: MutationPhase;
  proposePhase: MutationPhase;
  originalRecordPhase: MutationPhase;
  adjustmentPhase: MutationPhase;
  successorRecordPhase: MutationPhase;
  createError: string | null;
  proposeError: string | null;
  originalRecordError: string | null;
  adjustmentError: string | null;
  successorRecordError: string | null;
  onCreateDraft: (input: {
    allocations: Array<{
      partyType: string;
      partyUserId?: string | null;
      partyMerchantId?: number | null;
      amount: string;
      verifiedFactId?: string | null;
      basis?: string | null;
    }>;
    reason?: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onSubmitDraftForReview: (input: {
    determinationId: string;
    reason?: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onRecordOriginalLiability: (input: {
    determinationId: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onCreateAdjustment: (input: {
    parentDeterminationId: string;
    allocations: Array<{
      partyType: string;
      partyUserId?: string | null;
      partyMerchantId?: number | null;
      amount: string;
      verifiedFactId?: string | null;
      basis?: string | null;
    }>;
    reason: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onRecordSuccessorLiability: (input: {
    determinationId: string;
    parentDeterminationId: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
};

function emptyRow(): AllocationDraftRow {
  return {
    rowId: crypto.randomUUID(),
    optionKey: '',
    amount: '',
    verifiedFactId: '',
    basis: '',
  };
}

function createFingerprint(
  rows: AllocationDraftRow[],
  reason: string,
): string {
  return rows
    .map(
      (row) =>
        `${row.optionKey}\u0001${row.amount.trim()}\u0001${row.verifiedFactId}\u0001${row.basis.trim()}`,
    )
    .concat(reason.trim())
    .join('\u0002');
}

export function LiabilityDeterminationPanel({
  claimId,
  claimStatus,
  claimType,
  currency,
  loss,
  facts,
  determinations,
  determinationRoleLabel,
  debtorOptions,
  finalizationDebtorOptions,
  createPhase,
  proposePhase,
  originalRecordPhase,
  adjustmentPhase,
  successorRecordPhase,
  createError,
  proposeError,
  originalRecordError,
  adjustmentError,
  successorRecordError,
  onCreateDraft,
  onSubmitDraftForReview,
  onRecordOriginalLiability,
  onCreateAdjustment,
  onRecordSuccessorLiability,
}: Props) {
  const createBusy =
    createPhase === 'submitting' || createPhase === 'reconciling';
  const proposeBusy =
    proposePhase === 'submitting' || proposePhase === 'reconciling';
  const originalBusy =
    originalRecordPhase === 'submitting' || originalRecordPhase === 'reconciling';
  const adjustmentBusy =
    adjustmentPhase === 'submitting' || adjustmentPhase === 'reconciling';
  const successorBusy =
    successorRecordPhase === 'submitting' ||
    successorRecordPhase === 'reconciling';
  const anyBusy =
    createBusy || proposeBusy || originalBusy || adjustmentBusy || successorBusy;
  const [rows, setRows] = useState<AllocationDraftRow[]>([emptyRow()]);
  const [reason, setReason] = useState('');
  const [adjustmentRows, setAdjustmentRows] = useState<AllocationDraftRow[]>([
    emptyRow(),
  ]);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [createGesture, setCreateGesture] = useState<ActiveGesture | null>(null);
  const [proposeGesture, setProposeGesture] = useState<ActiveGesture | null>(
    null,
  );
  const [originalGesture, setOriginalGesture] = useState<ActiveGesture | null>(
    null,
  );
  const [adjustmentGesture, setAdjustmentGesture] =
    useState<ActiveGesture | null>(null);
  const [successorGesture, setSuccessorGesture] = useState<ActiveGesture | null>(
    null,
  );
  const [confirmingProposeId, setConfirmingProposeId] = useState<string | null>(
    null,
  );
  const [confirmingOriginalId, setConfirmingOriginalId] = useState<string | null>(
    null,
  );
  const [confirmingSuccessorId, setConfirmingSuccessorId] = useState<
    string | null
  >(null);
  const [confirmingAdjustment, setConfirmingAdjustment] = useState(false);
  const [frozenAdjustment, setFrozenAdjustment] =
    useState<FrozenAdjustmentMutation | null>(null);
  const adjustmentLocked = adjustmentGestureLocksPayload(adjustmentGesture);

  const mayCreate = canCreateLiabilityDraft({
    claimStatus,
    facts,
    determinations,
    debtorOptions,
  });
  const topology = analyzeSuccessorTopology(determinations);
  const mayAdjust = canCreateSuccessorAdjustment({
    facts,
    determinations,
    debtorOptions: finalizationDebtorOptions,
  });
  const usedAdjustmentKeys = useMemo(
    () => new Set(adjustmentRows.map((row) => row.optionKey).filter(Boolean)),
    [adjustmentRows],
  );

  const usedOptionKeys = useMemo(
    () => new Set(rows.map((row) => row.optionKey).filter(Boolean)),
    [rows],
  );

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white p-5"
      aria-labelledby="liability-det-heading"
    >
      <h2 id="liability-det-heading" className="text-lg font-semibold text-gray-900">
        Liability Determination
      </h2>
      <p className="mt-1 text-sm text-gray-600">{DETERMINATION_REVIEW_COPY}</p>
      <p className="mt-2 text-sm text-gray-600">{DETERMINATION_SELF_LIABILITY_COPY}</p>
      <p className="mt-2 text-sm text-gray-600">{DETERMINATION_CREDITOR_COPY}</p>
      <p className="mt-2 text-sm text-gray-600">
        {DETERMINATION_SELF_LIABILITY_OBSERVATION_COPY}
      </p>
      {(topology.reason === 'cycle' || topology.reason === 'branch') && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          Successor topology on this claim is inconsistent. Adjustment and successor
          recording are unavailable.
        </p>
      )}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Economic loss</h3>
      {loss ? (
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Loss kind</dt>
            <dd className="font-medium text-gray-900">
              {displayServerField(loss.lossKind)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Subject</dt>
            <dd className="font-medium text-gray-900">
              {displayServerField(loss.subjectRef)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Compensable amount</dt>
            <dd className="font-medium text-gray-900">
              {displayServerAmount(loss.compensableAmount, loss.currency ?? currency)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Currency</dt>
            <dd className="font-medium text-gray-900">
              {displayServerField(loss.currency ?? currency)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No economic loss on this claim.</p>
      )}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Verified facts</h3>
      {facts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          A liability determination requires at least one verified fact.
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm text-gray-800">
          {facts.map((row, index) => {
            const id = stringField(row, 'id');
            return (
              <li key={id ?? `fact-ctx-${index}`}>
                {displayServerField(row.factType)} · {displayServerField(row.statement)}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="mt-4 text-sm font-semibold text-gray-900">Current determinations</h3>
      {determinations.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No determinations.</p>
      ) : (
        <ul className="mt-2 space-y-4">
          {determinations.map((det, index) => {
            const detId = stringField(det, 'id');
            const allocations = asRecordList(det.allocations);
            const successor = isSuccessorDetermination(det);
            const proposeEligible = canSubmitEligibleLiabilityDraft({
              claimId,
              claimStatus,
              determination: det,
            });
            const originalEligible = canRecordOriginalLiability({
              claimId,
              determination: det,
              debtorOptions: finalizationDebtorOptions,
            });
            const successorEligible = canRecordSuccessorLiability({
              claimId,
              determination: det,
              determinations,
              debtorOptions: finalizationDebtorOptions,
            });
            const unprovableStored =
              Boolean(detId) &&
              ((stringField(det, 'status') === 'PROPOSED' &&
                !successor &&
                !storedAllocationsAreBounded(
                  allocations,
                  finalizationDebtorOptions,
                )) ||
                (stringField(det, 'status') === 'DRAFT' &&
                  successor &&
                  !storedAllocationsAreBounded(
                    allocations,
                    finalizationDebtorOptions,
                  )));
            return (
              <li
                key={detId ?? `det-${index}`}
                className="rounded-lg border border-gray-100 p-3"
              >
                <p className="font-medium text-gray-900">
                  {determinationRoleLabel(det)}
                  {successor ? ' · Successor' : ' · Original'}
                </p>
                <p className="text-sm text-gray-700">
                  Status: {displayServerField(det.status)}
                </p>
                <p className="text-sm text-gray-700">
                  Server total: {displayServerAmount(det.totalLiabilityAmount, det.currency ?? currency)}
                </p>
                <p className="text-sm text-gray-700">
                  Remaining snapshot:{' '}
                  {displayServerAmount(det.remainingAmountSnapshot, det.currency ?? currency)}
                </p>
                <p className="text-sm text-gray-700">
                  Reason: {displayServerField(det.reason)}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-gray-800">
                  {allocations.map((row, allocIndex) => (
                    <li
                      key={
                        stringField(row, 'id') ?? `${detId ?? index}-alloc-${allocIndex}`
                      }
                    >
                      {partyRoleLabel(row.partyType)} ·{' '}
                      {displayServerAmount(row.amount, row.currency ?? currency)}
                    </li>
                  ))}
                </ul>
                {stringField(det, 'status') === 'DRAFT' && !successor && (
                  <p className="mt-2 text-sm text-amber-800">
                    {DETERMINATION_DRAFT_IMMUTABLE_COPY}
                  </p>
                )}
                {stringField(det, 'status') === 'DRAFT' && successor && (
                  <p className="mt-2 text-sm text-amber-800">
                    {DETERMINATION_DRAFT_IMMUTABLE_COPY}
                  </p>
                )}
                {unprovableStored && (
                  <p className="mt-2 text-sm text-amber-800">
                    {DETERMINATION_UNPROVABLE_ALLOCATION_COPY}
                  </p>
                )}
                {proposeEligible && detId && confirmingProposeId !== detId && (
                  <button
                    type="button"
                    disabled={anyBusy}
                    className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    onClick={() => setConfirmingProposeId(detId)}
                  >
                    Review proposal
                  </button>
                )}
                {proposeEligible && detId && confirmingProposeId === detId && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-gray-700">
                      {DETERMINATION_PROPOSE_CONFIRM_COPY}
                    </p>
                    {proposeError && (
                      <p role="alert" className="text-sm text-red-700">{proposeError}</p>
                    )}
                    {proposePhase === 'success' && (
                      <p className="text-sm text-green-800">
                        Determination proposed. Claim reloaded from the server.
                      </p>
                    )}
                    {proposePhase === 'reconciling' && (
                      <p className="text-sm text-gray-700">
                        Checking whether the server already recorded this proposal…
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        onClick={() => {
                          if (anyBusy) return;
                          const next = submitGesture(proposeGesture, detId);
                          setProposeGesture(next.active);
                          void (async () => {
                            const outcome = await onSubmitDraftForReview({
                              determinationId: detId,
                              idempotencyKey: next.active.key,
                            });
                            if (outcome === 'success') {
                              setProposeGesture(completeGesture(next.active));
                              setConfirmingProposeId(null);
                            } else if (outcome === 'discarded') {
                              return;
                            } else {
                              setProposeGesture(markGestureAmbiguous(next.active));
                            }
                          })();
                        }}
                      >
                        {proposeBusy ? 'Recording…' : 'Confirm proposal'}
                      </button>
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
                        onClick={() => setConfirmingProposeId(null)}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
                {originalEligible && detId && confirmingOriginalId !== detId && (
                  <button
                    type="button"
                    disabled={anyBusy}
                    className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    onClick={() => setConfirmingOriginalId(detId)}
                  >
                    Record original liability
                  </button>
                )}
                {originalEligible && detId && confirmingOriginalId === detId && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-gray-700">
                      {DETERMINATION_RECORD_ORIGINAL_CONFIRM_COPY}
                    </p>
                    {originalRecordError && (
                      <p role="alert" className="text-sm text-red-700">
                        {originalRecordError}
                      </p>
                    )}
                    {originalRecordPhase === 'success' && (
                      <p className="text-sm text-green-800">
                        Liability recorded. Claim reloaded from the server. Return to
                        the follow-up and refresh live reconciliation there.
                      </p>
                    )}
                    {originalRecordPhase === 'reconciling' && (
                      <p className="text-sm text-gray-700">
                        Checking whether the server already recorded this action…
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        onClick={() => {
                          if (anyBusy) return;
                          const next = submitGesture(
                            originalGesture,
                            `finalize:${detId}`,
                          );
                          setOriginalGesture(next.active);
                          void (async () => {
                            const outcome = await onRecordOriginalLiability({
                              determinationId: detId,
                              idempotencyKey: next.active.key,
                            });
                            if (outcome === 'success') {
                              setOriginalGesture(completeGesture(next.active));
                              setConfirmingOriginalId(null);
                            } else if (outcome === 'discarded') {
                              return;
                            } else {
                              setOriginalGesture(markGestureAmbiguous(next.active));
                            }
                          })();
                        }}
                      >
                        {originalBusy ? 'Recording…' : 'Confirm original liability'}
                      </button>
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
                        onClick={() => setConfirmingOriginalId(null)}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
                {successorEligible && detId && confirmingSuccessorId !== detId && (
                  <button
                    type="button"
                    disabled={anyBusy}
                    className="mt-3 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    onClick={() => setConfirmingSuccessorId(detId)}
                  >
                    Record successor liability
                  </button>
                )}
                {successorEligible && detId && confirmingSuccessorId === detId && (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-gray-700">
                      {DETERMINATION_RECORD_SUCCESSOR_CONFIRM_COPY}
                    </p>
                    {successorRecordError && (
                      <p role="alert" className="text-sm text-red-700">
                        {successorRecordError}
                      </p>
                    )}
                    {successorRecordPhase === 'success' && (
                      <p className="text-sm text-green-800">
                        Successor liability recorded. Claim reloaded from the server.
                        Return to the follow-up and refresh live reconciliation there.
                      </p>
                    )}
                    {successorRecordPhase === 'reconciling' && (
                      <p className="text-sm text-gray-700">
                        Checking whether the server already recorded this action…
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                        onClick={() => {
                          if (anyBusy) return;
                          const parentId = stringField(
                            det,
                            'adjustmentOfDeterminationId',
                          );
                          if (!parentId) return;
                          const next = submitGesture(
                            successorGesture,
                            `finalize-successor:${detId}`,
                          );
                          setSuccessorGesture(next.active);
                          void (async () => {
                            const outcome = await onRecordSuccessorLiability({
                              determinationId: detId,
                              parentDeterminationId: parentId,
                              idempotencyKey: next.active.key,
                            });
                            if (outcome === 'success') {
                              setSuccessorGesture(completeGesture(next.active));
                              setConfirmingSuccessorId(null);
                            } else if (outcome === 'discarded') {
                              return;
                            } else {
                              setSuccessorGesture(
                                markGestureAmbiguous(next.active),
                              );
                            }
                          })();
                        }}
                      >
                        {successorBusy ? 'Recording…' : 'Confirm successor liability'}
                      </button>
                      <button
                        type="button"
                        disabled={anyBusy}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
                        onClick={() => setConfirmingSuccessorId(null)}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mayCreate ? (
        <form
          className="mt-5 space-y-3 border-t border-gray-100 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (anyBusy) return;
            const built = rows.flatMap((row) => {
              const selected = attributionFromOptionKey(row.optionKey, debtorOptions);
              if (!selected || !isPositiveMoneyString(row.amount)) return [];
              return [
                {
                  partyType: selected.partyType,
                  partyUserId: selected.partyUserId,
                  partyMerchantId: selected.partyMerchantId,
                  amount: row.amount.trim(),
                  verifiedFactId: row.verifiedFactId || null,
                  basis: row.basis.trim() || null,
                },
              ];
            });
            if (built.length === 0 || built.length !== rows.length) return;
            const next = submitGesture(
              createGesture,
              createFingerprint(rows, reason),
            );
            setCreateGesture(next.active);
            void (async () => {
              const outcome = await onCreateDraft({
                allocations: built,
                reason: reason.trim() || undefined,
                idempotencyKey: next.active.key,
              });
              if (outcome === 'success') {
                setCreateGesture(completeGesture(next.active));
                setRows([emptyRow()]);
                setReason('');
              } else if (outcome === 'discarded') {
                return;
              } else {
                setCreateGesture(markGestureAmbiguous(next.active));
              }
            })();
          }}
        >
          <h3 className="text-sm font-semibold text-gray-900">Create Draft</h3>
          <p className="text-sm text-gray-600">{DETERMINATION_DRAFT_IMMUTABLE_COPY}</p>
          {rows.map((row) => {
            const selected = attributionFromOptionKey(row.optionKey, debtorOptions);
            const grounding = allocationGroundingFacts({
              claimType,
              partyType: selected?.partyType ?? '',
              facts,
            });
            return (
              <div
                key={row.rowId}
                className="space-y-2 rounded-lg border border-gray-100 p-3"
              >
                <label className="block text-sm text-gray-700">
                  Debtor
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.optionKey}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? {
                                ...item,
                                optionKey: event.target.value,
                                verifiedFactId: '',
                              }
                            : item,
                        ),
                      )
                    }
                    required
                  >
                    <option value="">Select debtor</option>
                    {debtorOptions.map((option) => (
                      <option
                        key={option.optionKey}
                        value={option.optionKey}
                        disabled={
                          usedOptionKeys.has(option.optionKey) &&
                          option.optionKey !== row.optionKey
                        }
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-gray-700">
                  Amount
                  <input
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.amount}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Optional verified fact
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.verifiedFactId}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, verifiedFactId: event.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="">None</option>
                    {grounding.map((fact) => {
                      const id = stringField(fact, 'id');
                      if (!id) return null;
                      return (
                        <option key={id} value={id}>
                          {displayServerField(fact.factType)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="block text-sm text-gray-700">
                  Basis
                  <textarea
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    rows={2}
                    maxLength={2000}
                    value={row.basis}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, basis: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="text-sm font-medium text-gray-700"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((item) => item.rowId !== row.rowId),
                      )
                    }
                  >
                    Remove row
                  </button>
                )}
              </div>
            );
          })}
          {debtorOptions.length > rows.length && (
            <button
              type="button"
              className="text-sm font-medium text-gray-900"
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              Add allocation row
            </button>
          )}
          <label className="block text-sm text-gray-700">
            Reason
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {createError && (
            <p role="alert" className="text-sm text-red-700">{createError}</p>
          )}
          {createPhase === 'success' && (
            <p className="text-sm text-green-800">
              Draft recorded. Claim reloaded from the server.
            </p>
          )}
          {createPhase === 'reconciling' && (
            <p className="text-sm text-gray-700">
              Checking whether the server already recorded this draft…
            </p>
          )}
          <button
            type="submit"
            disabled={anyBusy}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {createBusy ? 'Recording…' : 'Create Draft'}
          </button>
        </form>
      ) : (
        <div className="mt-5 border-t border-gray-100 pt-4 text-sm text-gray-600">
          {debtorOptions.length === 0 && (
            <p>
              No authoritative debtor identity is currently available for this
              claim. If a merchant identity is missing, capture the Order Terms
              Snapshot in the evidence workspace. Customer and rider identities
              are not invented here.
            </p>
          )}
        </div>
      )}

      {mayAdjust && topology.tipId && (
        <form
          className="mt-5 space-y-3 border-t border-gray-100 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (anyBusy || !confirmingAdjustment) return;
            if (!topology.tipId) return;
            const built = adjustmentRows.flatMap((row) => {
              const selected = attributionFromOptionKey(
                row.optionKey,
                finalizationDebtorOptions,
              );
              if (!selected || !isPositiveMoneyString(row.amount)) return [];
              return [
                {
                  partyType: selected.partyType,
                  partyUserId: selected.partyUserId,
                  partyMerchantId: selected.partyMerchantId,
                  amount: row.amount.trim(),
                  verifiedFactId: row.verifiedFactId || null,
                  basis: row.basis.trim() || null,
                },
              ];
            });
            const live: FrozenAdjustmentMutation | null =
              built.length > 0 &&
              built.length === adjustmentRows.length &&
              adjustmentReason.trim()
                ? {
                    parentDeterminationId: topology.tipId,
                    allocations: built,
                    reason: adjustmentReason.trim(),
                  }
                : null;
            if (!frozenAdjustment && !live) return;
            const payload = resolveAdjustmentMutationPayload({
              frozen: frozenAdjustment,
              live: live ?? (frozenAdjustment as FrozenAdjustmentMutation),
            });
            if (!frozenAdjustment) setFrozenAdjustment(payload);
            const next = submitGesture(
              adjustmentGesture,
              `adjust:${payload.parentDeterminationId}`,
            );
            setAdjustmentGesture(next.active);
            void (async () => {
              const outcome = await onCreateAdjustment({
                parentDeterminationId: payload.parentDeterminationId,
                allocations: payload.allocations,
                reason: payload.reason,
                idempotencyKey: next.active.key,
              });
              if (outcome === 'success') {
                setAdjustmentGesture(completeGesture(next.active));
                setFrozenAdjustment(null);
                setAdjustmentRows([emptyRow()]);
                setAdjustmentReason('');
                setConfirmingAdjustment(false);
              } else if (outcome === 'discarded') {
                return;
              } else {
                setAdjustmentGesture(markGestureAmbiguous(next.active));
              }
            })();
          }}
        >
          <h3 className="text-sm font-semibold text-gray-900">Create Adjustment</h3>
          <p className="text-sm text-gray-600">{DETERMINATION_ADJUSTMENT_SEMANTICS_COPY}</p>
          <p className="text-sm text-amber-800">{DETERMINATION_ADJUSTMENT_IMMUTABLE_COPY}</p>
          {adjustmentLocked && (
            <p className="text-sm text-gray-700">
              This request is unresolved. Retry sends the same adjustment. Fields
              cannot change until it is proven.
            </p>
          )}
          {adjustmentRows.map((row) => {
            const selected = attributionFromOptionKey(
              row.optionKey,
              finalizationDebtorOptions,
            );
            const grounding = allocationGroundingFacts({
              claimType,
              partyType: selected?.partyType ?? '',
              facts,
            });
            return (
              <div
                key={row.rowId}
                className="space-y-2 rounded-lg border border-gray-100 p-3"
              >
                <label className="block text-sm text-gray-700">
                  Debtor
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.optionKey}
                    onChange={(event) =>
                      setAdjustmentRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? {
                                ...item,
                                optionKey: event.target.value,
                                verifiedFactId: '',
                              }
                            : item,
                        ),
                      )
                    }
                    required
                    disabled={adjustmentLocked}
                  >
                    <option value="">Select debtor</option>
                    {finalizationDebtorOptions.map((option) => (
                      <option
                        key={option.optionKey}
                        value={option.optionKey}
                        disabled={
                          usedAdjustmentKeys.has(option.optionKey) &&
                          option.optionKey !== row.optionKey
                        }
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-gray-700">
                  Amount
                  <input
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.amount}
                    onChange={(event) =>
                      setAdjustmentRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      )
                    }
                    inputMode="decimal"
                    required
                    disabled={adjustmentLocked}
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Optional verified fact
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    value={row.verifiedFactId}
                    onChange={(event) =>
                      setAdjustmentRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, verifiedFactId: event.target.value }
                            : item,
                        ),
                      )
                    }
                    disabled={adjustmentLocked}
                  >
                    <option value="">None</option>
                    {grounding.map((fact) => {
                      const id = stringField(fact, 'id');
                      if (!id) return null;
                      return (
                        <option key={id} value={id}>
                          {displayServerField(fact.factType)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="block text-sm text-gray-700">
                  Basis
                  <textarea
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    rows={2}
                    maxLength={2000}
                    value={row.basis}
                    onChange={(event) =>
                      setAdjustmentRows((current) =>
                        current.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, basis: event.target.value }
                            : item,
                        ),
                      )
                    }
                    disabled={adjustmentLocked}
                  />
                </label>
                {adjustmentRows.length > 1 && !adjustmentLocked && (
                  <button
                    type="button"
                    className="text-sm font-medium text-gray-700"
                    onClick={() =>
                      setAdjustmentRows((current) =>
                        current.filter((item) => item.rowId !== row.rowId),
                      )
                    }
                  >
                    Remove row
                  </button>
                )}
              </div>
            );
          })}
          {finalizationDebtorOptions.length > adjustmentRows.length &&
            !adjustmentLocked && (
            <button
              type="button"
              className="text-sm font-medium text-gray-900"
              onClick={() =>
                setAdjustmentRows((current) => [...current, emptyRow()])
              }
            >
              Add allocation row
            </button>
          )}
          <label className="block text-sm text-gray-700">
            Reason
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={3}
              maxLength={2000}
              value={adjustmentReason}
              onChange={(event) => setAdjustmentReason(event.target.value)}
              required
              disabled={adjustmentLocked}
            />
          </label>
          {adjustmentError && (
            <p role="alert" className="text-sm text-red-700">{adjustmentError}</p>
          )}
          {adjustmentPhase === 'success' && (
            <p className="text-sm text-green-800">
              Adjustment draft recorded. Claim reloaded from the server.
            </p>
          )}
          {adjustmentPhase === 'reconciling' && (
            <p className="text-sm text-gray-700">
              Checking whether the server already recorded this adjustment…
            </p>
          )}
          {!confirmingAdjustment ? (
            <button
              type="button"
              disabled={anyBusy}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              onClick={() => setConfirmingAdjustment(true)}
            >
              Review adjustment
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={anyBusy}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {adjustmentBusy
                  ? 'Recording…'
                  : adjustmentLocked
                    ? 'Retry same request'
                    : 'Confirm Create Adjustment'}
              </button>
              <button
                type="button"
                disabled={anyBusy || adjustmentLocked}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
                onClick={() => setConfirmingAdjustment(false)}
              >
                Back
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
