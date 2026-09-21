'use client';

import { useState } from 'react';
import { displayServerField } from '@/lib/authoritative-domain-presentation';
import {
  SENSITIVE_INFORMATION_COPY,
  SUBJECT_MATCH_INVESTIGATION_COPY,
  VERIFIED_FACT_TYPES,
  attributionFromOptionKey,
  completeGesture,
  factTypeForbidsAttribution,
  isActiveClaimStatus,
  markGestureAmbiguous,
  stringField,
  submitGesture,
  verifiedSupportingEvidence,
  type ActiveGesture,
  type FactAttributionOption,
  type MutationPhase,
} from '@/lib/exception-liability-admin-presentation';

type Props = {
  status: unknown;
  facts: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  verifications: Array<Record<string, unknown>>;
  attributionOptions: FactAttributionOption[];
  phase: MutationPhase;
  error: string | null;
  onConcludeFact: (input: {
    factType: string;
    statement: string;
    supportingEvidenceId: string;
    attributedPartyType?: string | null;
    attributedPartyUserId?: string | null;
    attributedMerchantId?: number | null;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
};

function factFingerprint(input: {
  factType: string;
  statement: string;
  supportingEvidenceId: string;
  attributionKey: string;
}): string {
  return [
    input.factType,
    input.statement,
    input.supportingEvidenceId,
    input.attributionKey,
  ].join('\u0001');
}

export function VerifiedFactsPanel({
  status,
  facts,
  evidence,
  verifications,
  attributionOptions,
  phase,
  error,
  onConcludeFact,
}: Props) {
  const active = isActiveClaimStatus(status);
  const busy = phase === 'submitting' || phase === 'reconciling';
  const supporting = verifiedSupportingEvidence(evidence, verifications);
  const [factType, setFactType] = useState('GOODS_LOST_CONFIRMED');
  const [statement, setStatement] = useState('');
  const [supportingEvidenceId, setSupportingEvidenceId] = useState('');
  const [attributionKey, setAttributionKey] = useState('');
  const [gesture, setGesture] = useState<ActiveGesture | null>(null);
  const forbidsAttribution = factTypeForbidsAttribution(factType);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="facts-heading">
      <h2 id="facts-heading" className="text-lg font-semibold text-gray-900">Verified facts</h2>
      <p className="mt-1 text-sm text-gray-600">
        A verified fact is an administrative factual conclusion supported by verified evidence.
        Facts are append-only. Competing facts are all shown. There is no latest-wins rule.
      </p>
      <p className="mt-2 text-sm text-gray-700">{SUBJECT_MATCH_INVESTIGATION_COPY}</p>
      <p className="mt-2 text-sm text-amber-800">{SENSITIVE_INFORMATION_COPY}</p>
      {facts.length > 1 && (
        <p className="mt-2 text-sm text-amber-800">
          Multiple verified facts may require further review.
        </p>
      )}

      {facts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No verified facts.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {facts.map((row, index) => (
            <li
              key={displayServerField(row.id) !== '—' ? displayServerField(row.id) : `fact-${index}`}
              className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800"
            >
              <p className="font-medium text-gray-900">{displayServerField(row.factType)}</p>
              <p>Statement: {displayServerField(row.statement)}</p>
              <p>Subject: {displayServerField(row.subjectRef)}</p>
              <p>
                Attribution: {displayServerField(row.attributedPartyType)}{' '}
                {displayServerField(row.attributedPartyUserId ?? row.attributedMerchantId)}
              </p>
              <p>Supporting evidence: {displayServerField(row.supportingEvidenceId)}</p>
              <p>
                Concluded by: {displayServerField(row.concludedByActorType)}{' '}
                {displayServerField(row.concludedByActorId)}
              </p>
              <p>Created: {displayServerField(row.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <form
          className="mt-5 space-y-3 border-t border-gray-100 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !statement.trim() || !supportingEvidenceId) return;
            const selected = forbidsAttribution
              ? null
              : attributionFromOptionKey(attributionKey, attributionOptions);
            const next = submitGesture(
              gesture,
              factFingerprint({
                factType,
                statement: statement.trim(),
                supportingEvidenceId,
                attributionKey: selected ? attributionKey : '',
              }),
            );
            setGesture(next.active);
            void (async () => {
              const outcome = await onConcludeFact({
                factType,
                statement: statement.trim(),
                supportingEvidenceId,
                attributedPartyType: selected?.partyType ?? null,
                attributedPartyUserId: selected?.partyUserId ?? null,
                attributedMerchantId: selected?.partyMerchantId ?? null,
                idempotencyKey: next.active.key,
              });
              if (outcome === 'success') {
                setGesture(completeGesture(next.active));
                setStatement('');
                setSupportingEvidenceId('');
                setAttributionKey('');
                setFactType('GOODS_LOST_CONFIRMED');
              } else if (outcome === 'discarded') {
                return;
              } else {
                setGesture(markGestureAmbiguous(next.active));
              }
            })();
          }}
        >
          <h3 className="text-sm font-semibold text-gray-900">Conclude verified fact</h3>
          <label className="block text-sm text-gray-700">
            Fact type
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={factType}
              onChange={(event) => setFactType(event.target.value)}
            >
              {VERIFIED_FACT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Supporting verified evidence
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={supportingEvidenceId}
              onChange={(event) => setSupportingEvidenceId(event.target.value)}
              required
            >
              <option value="">Select VERIFIED evidence</option>
              {supporting.map((row) => {
                const id = stringField(row, 'id');
                if (!id) return null;
                return (
                  <option key={id} value={id}>
                    {id} · {displayServerField(row.evidenceKind)}
                  </option>
                );
              })}
            </select>
          </label>
          {supporting.length === 0 && (
            <p className="text-sm text-gray-600">
              A verified fact requires evidence that already has a VERIFIED verification
              on this claim. Unverified evidence is not offered.
            </p>
          )}
          <label className="block text-sm text-gray-700">
            Statement
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={3}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              required
            />
          </label>
          <p className="text-xs text-gray-600">
            State the factual conclusion supported by the selected verified evidence.
            Attribution identifies the party referenced by the conclusion. It does not
            assign financial liability, select a debtor or creditor, or create an obligation.
          </p>
          {!forbidsAttribution && attributionOptions.length > 0 && (
            <label className="block text-sm text-gray-700">
              Optional party attribution
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={attributionKey}
                onChange={(event) => setAttributionKey(event.target.value)}
              >
                <option value="">None</option>
                {attributionOptions.map((item) => (
                  <option key={item.optionKey} value={item.optionKey}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!forbidsAttribution && attributionOptions.length === 0 && (
            <p className="text-sm text-gray-600">
              No authoritative customer, merchant, or rider identity is present on this
              claim GET. Attribution is omitted rather than accepting a typed party id.
            </p>
          )}
          {forbidsAttribution && (
            <p className="text-sm text-gray-600">
              This fact type cannot attribute a party. Attribution fields are omitted.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {phase === 'success' && (
            <p className="text-sm text-green-800">Verified fact concluded. Claim reloaded from the server.</p>
          )}
          {phase === 'reconciling' && (
            <p className="text-sm text-gray-700">Checking whether the server already recorded this fact…</p>
          )}
          <button
            type="submit"
            disabled={busy || supporting.length === 0}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? 'Recording…' : 'Conclude verified fact'}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          This claim is not in an active investigation state. Concluding a verified fact is not offered here.
        </p>
      )}
    </section>
  );
}
