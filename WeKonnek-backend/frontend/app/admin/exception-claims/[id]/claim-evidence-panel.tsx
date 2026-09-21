'use client';

import { useMemo, useState } from 'react';
import {
  displayServerField,
} from '@/lib/authoritative-domain-presentation';
import {
  ADMIN_ONLY_VISIBILITY_COPY,
  CLAIM_EVIDENCE_VISIBILITIES,
  DEFAULT_EVIDENCE_VISIBILITY,
  MANUAL_EVIDENCE_KINDS,
  SENSITIVE_INFORMATION_COPY,
  asRecordList,
  completeGesture,
  isActiveClaimStatus,
  markGestureAmbiguous,
  stringField,
  submitGesture,
  type ActiveGesture,
  type MutationPhase,
} from '@/lib/exception-liability-admin-presentation';
import { EvidenceVerificationPanel } from './evidence-verification-panel';

type Props = {
  claimId: string;
  status: unknown;
  evidence: Array<Record<string, unknown>>;
  verifications: Array<Record<string, unknown>>;
  evidencePhase: MutationPhase;
  orderTermsPhase: MutationPhase;
  verifyPhase: MutationPhase;
  evidenceError: string | null;
  orderTermsError: string | null;
  onRecordEvidence: (input: {
    evidenceKind: string;
    visibility: string;
    notes?: string;
    storageReference?: string;
    contentHash?: string;
    contentType?: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onCaptureOrderTerms: (
    idempotencyKey: string,
  ) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
  onRecordVerification: (input: {
    evidenceId: string;
    verificationStatus: string;
    notes?: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
};

function evidenceFingerprint(input: {
  evidenceKind: string;
  visibility: string;
  notes: string;
  storageReference: string;
  contentHash: string;
  contentType: string;
}): string {
  return [
    input.evidenceKind,
    input.visibility,
    input.notes,
    input.storageReference,
    input.contentHash,
    input.contentType,
  ].join('\u0001');
}

export function ClaimEvidencePanel({
  status,
  evidence,
  verifications,
  evidencePhase,
  orderTermsPhase,
  verifyPhase,
  evidenceError,
  orderTermsError,
  onRecordEvidence,
  onCaptureOrderTerms,
  onRecordVerification,
}: Props) {
  const active = isActiveClaimStatus(status);
  const busy = evidencePhase === 'submitting' || evidencePhase === 'reconciling';
  const orderBusy =
    orderTermsPhase === 'submitting' || orderTermsPhase === 'reconciling';
  const [evidenceKind, setEvidenceKind] = useState<string>('STATEMENT');
  const [visibility, setVisibility] = useState<string>(DEFAULT_EVIDENCE_VISIBILITY);
  const [notes, setNotes] = useState('');
  const [storageReference, setStorageReference] = useState('');
  const [contentType, setContentType] = useState('');
  const [contentHash, setContentHash] = useState('');
  const [evidenceGesture, setEvidenceGesture] = useState<ActiveGesture | null>(null);
  const [orderTermsGesture, setOrderTermsGesture] = useState<ActiveGesture | null>(null);

  const verificationsByEvidence = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const row of verifications) {
      const evidenceId = stringField(row, 'evidenceId');
      if (!evidenceId) continue;
      const list = map.get(evidenceId) ?? [];
      list.push(row);
      map.set(evidenceId, list);
    }
    return map;
  }, [verifications]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading" className="text-lg font-semibold text-gray-900">Evidence</h2>
      <p className="mt-1 text-sm text-gray-600">
        Evidence is append-only. There is no edit, replace, or delete control.
        Presence of a row is not authenticity.
      </p>
      <p className="mt-2 text-sm text-amber-800">{SENSITIVE_INFORMATION_COPY}</p>
      <p className="mt-2 text-sm text-gray-600">{ADMIN_ONLY_VISIBILITY_COPY}</p>

      {evidence.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No evidence.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {evidence.map((row, index) => {
            const id = displayServerField(row.id);
            const history = asRecordList(
              typeof row.id === 'string' ? verificationsByEvidence.get(row.id) : [],
            );
            return (
              <li
                key={id !== '—' ? id : `evidence-${index}`}
                className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800"
              >
                <p className="font-medium text-gray-900">
                  {displayServerField(row.evidenceKind)} · {displayServerField(row.visibility)}
                </p>
                <p>Identifier: {id}</p>
                <p>Created: {displayServerField(row.createdAt)}</p>
                <p>
                  Added by: {displayServerField(row.submittedByActorType)}{' '}
                  {displayServerField(row.submittedByActorId)}
                </p>
                <p>Reference: {displayServerField(row.storageReference)} (reference, not an uploaded attachment)</p>
                <p>Content type: {displayServerField(row.contentType)}</p>
                <p>Content hash: {displayServerField(row.contentHash)}</p>
                <p>Notes: {displayServerField(row.notes)}</p>
                <h3 className="mt-2 text-sm font-semibold text-gray-900">Verification history</h3>
                {history.length === 0 ? (
                  <p className="text-sm text-gray-600">No verification conclusions yet.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {history.map((item, verifyIndex) => (
                      <li key={displayServerField(item.id) !== '—' ? displayServerField(item.id) : `v-${index}-${verifyIndex}`}>
                        {displayServerField(item.verificationStatus)} ·{' '}
                        {displayServerField(item.createdAt)} · verified by{' '}
                        {displayServerField(item.verifiedByActorId)}
                      </li>
                    ))}
                  </ul>
                )}
                {active && typeof row.id === 'string' && (
                  <EvidenceVerificationPanel
                    evidenceId={row.id}
                    evidenceKind={displayServerField(row.evidenceKind)}
                    evidenceActorId={row.submittedByActorId}
                    latestVerificationActorId={history.at(-1)?.verifiedByActorId}
                    phase={verifyPhase}
                    disabled={busy || orderBusy}
                    onRecordVerification={onRecordVerification}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {active ? (
        <div className="mt-5 space-y-5 border-t border-gray-100 pt-4">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const fingerprint = evidenceFingerprint({
                evidenceKind,
                visibility,
                notes,
                storageReference,
                contentHash,
                contentType,
              });
              const next = submitGesture(evidenceGesture, fingerprint);
              setEvidenceGesture(next.active);
              void (async () => {
                const outcome = await onRecordEvidence({
                  evidenceKind,
                  visibility,
                  notes: notes.trim() || undefined,
                  storageReference: storageReference.trim() || undefined,
                  contentHash: contentHash.trim() || undefined,
                  contentType: contentType.trim() || undefined,
                  idempotencyKey: next.active.key,
                });
                if (outcome === 'success') {
                  setEvidenceGesture(completeGesture(next.active));
                  setNotes('');
                  setStorageReference('');
                  setContentType('');
                  setContentHash('');
                  setVisibility(DEFAULT_EVIDENCE_VISIBILITY);
                  setEvidenceKind('STATEMENT');
                } else if (outcome === 'discarded') {
                  return;
                } else {
                  setEvidenceGesture(markGestureAmbiguous(next.active));
                }
              })();
            }}
          >
            <h3 className="text-sm font-semibold text-gray-900">Record evidence</h3>
            <label className="block text-sm text-gray-700">
              Evidence type
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={evidenceKind}
                onChange={(event) => setEvidenceKind(event.target.value)}
              >
                {MANUAL_EVIDENCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              Visibility
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                {CLAIM_EVIDENCE_VISIBILITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-gray-600">
              Visibility is an explicit choice. Default is ADMIN_ONLY. ALL_ORDER_PARTIES
              may appear on party GET. Do not use party visibility for internal investigation notes.
            </p>
            <label className="block text-sm text-gray-700">
              Reference
              <input
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={storageReference}
                onChange={(event) => setStorageReference(event.target.value)}
                placeholder="Storage or record reference. Not a file upload."
              />
            </label>
            <label className="block text-sm text-gray-700">
              Content type
              <input
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
              />
            </label>
            <label className="block text-sm text-gray-700">
              Content hash
              <input
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={contentHash}
                onChange={(event) => setContentHash(event.target.value)}
              />
            </label>
            <label className="block text-sm text-gray-700">
              Notes
              <textarea
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            {evidenceKind === 'STATEMENT' && (
              <p className="text-xs text-gray-600">
                A statement is evidence only. Recording it does not conclude a verified fact.
              </p>
            )}
            {evidenceError && (
              <p role="alert" className="text-sm text-red-700">{evidenceError}</p>
            )}
            {evidencePhase === 'success' && (
              <p className="text-sm text-green-800">Evidence recorded. Claim reloaded from the server.</p>
            )}
            {evidencePhase === 'reconciling' && (
              <p className="text-sm text-gray-700">Checking whether the server already recorded this action…</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? 'Recording…' : 'Record evidence'}
            </button>
          </form>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Order terms</h3>
            <p className="text-sm text-gray-600">
              Captures the current authoritative order terms into Stage12 evidence.
              Do not retype items, prices, or agreement terms. This does not mutate the order.
            </p>
            {orderTermsError && (
              <p role="alert" className="text-sm text-red-700">{orderTermsError}</p>
            )}
            {orderTermsPhase === 'success' && (
              <p className="text-sm text-green-800">Order terms snapshot recorded. Claim reloaded from the server.</p>
            )}
            <button
              type="button"
              disabled={orderBusy || busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-60"
              onClick={() => {
                if (orderBusy) return;
                const next = submitGesture(orderTermsGesture, 'order-terms-capture');
                setOrderTermsGesture(next.active);
                void (async () => {
                  const outcome = await onCaptureOrderTerms(next.active.key);
                  if (outcome === 'success') {
                    setOrderTermsGesture(completeGesture(next.active));
                  } else if (outcome === 'discarded') {
                    return;
                  } else {
                    setOrderTermsGesture(markGestureAmbiguous(next.active));
                  }
                })();
              }}
            >
              {orderBusy ? 'Capturing…' : 'Capture Order Terms Snapshot'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600">
          This claim is not in an active investigation state. Append evidence is not offered here.
          The backend remains authority if a request is sent anyway.
        </p>
      )}
    </section>
  );
}
