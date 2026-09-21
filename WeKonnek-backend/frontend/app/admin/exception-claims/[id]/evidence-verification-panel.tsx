'use client';

import { useState } from 'react';
import {
  CLAIM_VERIFICATION_STATUSES,
  completeGesture,
  markGestureAmbiguous,
  submitGesture,
  verificationIndependenceNote,
  type ActiveGesture,
  type MutationPhase,
} from '@/lib/exception-liability-admin-presentation';

type Props = {
  evidenceId: string;
  evidenceKind: string;
  evidenceActorId: unknown;
  latestVerificationActorId: unknown;
  phase: MutationPhase;
  disabled: boolean;
  onRecordVerification: (input: {
    evidenceId: string;
    verificationStatus: string;
    notes?: string;
    idempotencyKey: string;
  }) => Promise<'success' | 'unproven' | 'error' | 'discarded'>;
};

export function EvidenceVerificationPanel({
  evidenceId,
  evidenceKind,
  evidenceActorId,
  latestVerificationActorId,
  phase,
  disabled,
  onRecordVerification,
}: Props) {
  const [status, setStatus] = useState('VERIFIED');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [gesture, setGesture] = useState<ActiveGesture | null>(null);
  const busy = phase === 'submitting' || phase === 'reconciling';

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
      <h4 className="text-sm font-semibold text-gray-900">Record verification</h4>
      <p className="mt-1 text-xs text-gray-600">
        Verification is an append-only Stage12 evidence conclusion. It does not
        settle, acknowledge, or mark anyone paid.
      </p>
      <p className="mt-1 text-xs text-gray-600">
        {verificationIndependenceNote(evidenceActorId, latestVerificationActorId)}
      </p>
      {!confirming ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
        >
          <label className="block text-sm text-gray-700">
            Verification status
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {CLAIM_VERIFICATION_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Notes
            <textarea
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={disabled || busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900 disabled:opacity-60"
          >
            Review verification
          </button>
        </form>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p>Evidence identifier: {evidenceId}</p>
          <p>Evidence kind: {evidenceKind}</p>
          <p>Selected verification status: {status}</p>
          <p>Notes: {notes.trim() || '—'}</p>
          {phase === 'reconciling' && (
            <p className="text-gray-700">Checking whether the server already recorded this verification…</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || busy}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              onClick={() => {
                if (busy) return;
                const next = submitGesture(
                  gesture,
                  `${evidenceId}:${status}:${notes}`,
                );
                setGesture(next.active);
                void (async () => {
                  const outcome = await onRecordVerification({
                    evidenceId,
                    verificationStatus: status,
                    notes: notes.trim() || undefined,
                    idempotencyKey: next.active.key,
                  });
                  if (outcome === 'success') {
                    setGesture(completeGesture(next.active));
                    setNotes('');
                    setConfirming(false);
                    setStatus('VERIFIED');
                  } else if (outcome === 'discarded') {
                    return;
                  } else {
                    setGesture(markGestureAmbiguous(next.active));
                  }
                })();
              }}
            >
              {busy ? 'Recording…' : 'Record Verification'}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900"
              onClick={() => setConfirming(false)}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
