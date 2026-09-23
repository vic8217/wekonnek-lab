'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import {
  failurePresentation,
  interpretConfirmResponse,
  interpretValidateResponse,
  pickupHandoffBody,
  pickupHandoffUrl,
  quantityLabel,
  retainPickupPayload,
  type FailurePresentation,
  type PublicChecklist,
  type ReleasePhase,
} from '@/lib/pickup-release';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type CameraState = 'idle' | 'pending' | 'denied' | 'unavailable' | 'missing' | 'unsupported' | 'scanning';

type ReleaseView =
  | { phase: 'scan' }
  | { phase: 'validating' }
  | { phase: 'review'; checklist: PublicChecklist }
  | { phase: 'confirm-dialog'; checklist: PublicChecklist }
  | { phase: 'confirming'; checklist: PublicChecklist }
  | { phase: 'checking'; checklist: PublicChecklist | null }
  | { phase: 'released'; checklist: PublicChecklist; idempotent: boolean }
  | { phase: 'failure'; failure: FailurePresentation }
  | { phase: 'network' }
  | { phase: 'session' }
  | { phase: 'advance-blocked' };

type QrDetector = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
};

function createQrDetector(): QrDetector | null {
  const detector = (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => QrDetector })
    .BarcodeDetector;
  if (!detector) return null;
  return new detector({ formats: ['qr_code'] });
}

function cameraMessage(state: CameraState): string | null {
  if (state === 'pending') return 'Requesting camera access…';
  if (state === 'denied') return 'Camera permission denied. Allow camera access, or enter the code manually.';
  if (state === 'missing') return 'No camera was found on this device. Enter the code manually.';
  if (state === 'unavailable') return 'The camera is unavailable. Enter the code manually.';
  if (state === 'unsupported') return 'This browser cannot scan QR codes. Enter the code manually.';
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col gap-4 px-4 py-4">
      {children}
    </main>
  );
}

function ChecklistCard({ checklist }: { checklist: PublicChecklist }) {
  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Order</p>
        <p className="text-2xl font-black text-gray-900">#{checklist.orderCode}</p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Rider</p>
        <p className="text-lg font-semibold text-gray-900">{checklist.riderName}</p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Merchant</p>
        <p className="text-base text-gray-900">{checklist.merchantName}</p>
      </div>
      {checklist.pickupName || checklist.pickupAddress ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Pickup location</p>
          {checklist.pickupName ? <p className="text-base font-semibold text-gray-900">{checklist.pickupName}</p> : null}
          {checklist.pickupAddress ? (
            <p className="text-sm text-gray-700" data-pickup-address="true">
              {checklist.pickupAddress}
            </p>
          ) : null}
        </div>
      ) : null}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Items to release</p>
        {checklist.items.length === 0 ? (
          <p className="text-sm text-gray-600">Confirm against the goods in front of you. Item lines were not included in this validation result.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {checklist.items.map((item, index) => (
              <li key={`${item.productName}-${index}`} className="text-base text-gray-900">
                {item.quantity} × {item.productName}
              </li>
            ))}
          </ul>
        )}
      </div>
      {checklist.itemCount > 0 ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Total quantity</p>
          <p className="text-lg font-black text-gray-900">{quantityLabel(checklist.itemCount)}</p>
        </div>
      ) : null}
    </section>
  );
}

function FailureCard({ failure, onScanAgain }: { failure: FailurePresentation; onScanAgain: () => void }) {
  return (
    <Shell>
      <h1 className="text-2xl font-black text-gray-900">{failure.title}</h1>
      <p className="text-base text-gray-700">{failure.body}</p>
      <button type="button" onClick={onScanAgain} className="min-h-12 rounded-xl bg-gray-900 px-4 font-bold text-white">
        SCAN AGAIN
      </button>
      <Link href="/merchant/orders?tab=delivery" className="text-center text-sm font-semibold text-gray-600">
        Back to deliveries
      </Link>
    </Shell>
  );
}

export function ReleaseStage({
  view,
  onScanAgain,
  onCancel,
  onAskConfirm,
  onDismissConfirm,
  onSubmitConfirm,
  onRetryConfirm,
  onDone,
}: {
  view: ReleaseView;
  onScanAgain: () => void;
  onCancel: () => void;
  onAskConfirm: () => void;
  onDismissConfirm: () => void;
  onSubmitConfirm: () => void;
  onRetryConfirm: () => void;
  onDone: () => void;
}) {
  if (view.phase === 'validating') {
    return (
      <Shell>
        <h1 className="text-2xl font-black">CHECKING PICKUP QR</h1>
        <p className="text-gray-700">Verifying this rider pickup. Nothing has been released.</p>
      </Shell>
    );
  }
  if (view.phase === 'network') {
    return (
      <Shell>
        <h1 className="text-2xl font-black">NETWORK FAILURE</h1>
        <p className="text-gray-700">The pickup QR could not be checked. Nothing has been released.</p>
        <button type="button" onClick={onScanAgain} className="min-h-12 rounded-xl bg-gray-900 px-4 font-bold text-white">
          SCAN AGAIN
        </button>
      </Shell>
    );
  }
  if (view.phase === 'session') {
    return (
      <Shell>
        <h1 className="text-2xl font-black">SIGN IN REQUIRED</h1>
        <p className="text-gray-700">Sign in with the merchant account that should release this pickup.</p>
        <Link href="/merchant" className="min-h-12 rounded-xl bg-gray-900 px-4 py-3 text-center font-bold text-white">
          Go to merchant sign in
        </Link>
      </Shell>
    );
  }
  if (view.phase === 'failure') {
    return <FailureCard failure={view.failure} onScanAgain={onScanAgain} />;
  }
  if (view.phase === 'advance-blocked') {
    const failure = failurePresentation('RIDER_ADVANCE_VENDOR_ACK_REQUIRED');
    return (
      <Shell>
        <h1 className="text-2xl font-black">{failure.title}</h1>
        <p className="text-gray-700">{failure.body}</p>
        <p className="text-sm text-gray-600">The order stays unreleased. This screen does not acknowledge Rider Advance.</p>
        <button type="button" onClick={onScanAgain} className="min-h-12 rounded-xl bg-gray-900 px-4 font-bold text-white">
          BACK
        </button>
      </Shell>
    );
  }
  if (view.phase === 'checking') {
    return (
      <Shell>
        <h1 className="text-2xl font-black">CHECKING RELEASE STATUS</h1>
        <p className="text-gray-700">
          The release request was sent, but the result did not come back. Do not hand the goods over again until this check finishes.
        </p>
        {view.checklist ? <ChecklistCard checklist={view.checklist} /> : null}
        <button type="button" onClick={onRetryConfirm} className="min-h-12 rounded-xl bg-[#DB0002] px-4 font-bold text-white">
          CHECK AGAIN
        </button>
      </Shell>
    );
  }
  if (view.phase === 'released') {
    return (
      <Shell>
        <h1 className="text-2xl font-black">PICKUP RELEASED</h1>
        <p className="text-gray-800">
          Order #{view.checklist.orderCode} has been released to {view.checklist.riderName}.
        </p>
        <p className="text-gray-700">The backend recorded the handoff. The rider can now proceed with the delivery.</p>
        {view.idempotent ? (
          <p className="text-sm text-gray-600">This pickup was already released. No second handoff was created.</p>
        ) : null}
        <button type="button" onClick={onDone} className="min-h-12 rounded-xl bg-gray-900 px-4 font-bold text-white">
          DONE
        </button>
      </Shell>
    );
  }
  if (view.phase === 'review' || view.phase === 'confirm-dialog' || view.phase === 'confirming') {
    const busy = view.phase === 'confirming';
    const verified = view.phase === 'review';
    return (
      <Shell>
        <h1 className="text-2xl font-black text-green-800">{busy ? 'CONFIRMING RELEASE' : 'PICKUP VERIFIED'}</h1>
        <p className="text-sm text-gray-600">
          {verified
            ? 'Validated only. Goods are not released until you confirm.'
            : 'Confirm only after these items have physically been handed to the rider.'}
        </p>
        <ChecklistCard checklist={view.checklist} />
        <button
          type="button"
          disabled={busy}
          onClick={onAskConfirm}
          className="min-h-12 rounded-xl bg-[#DB0002] px-4 font-black text-white disabled:opacity-60"
        >
          {busy ? 'CONFIRMING RELEASE...' : 'CONFIRM RELEASE TO RIDER'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl border border-gray-300 px-4 font-bold text-gray-800">
          CANCEL
        </button>
        {view.phase === 'confirm-dialog' || busy ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true">
            <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 shadow-xl">
              <h2 className="text-lg font-black">Release these items to {view.checklist.riderName}?</h2>
              <p className="text-sm text-gray-600">This records the handoff for order #{view.checklist.orderCode} only.</p>
              <button
                type="button"
                disabled={busy}
                onClick={onSubmitConfirm}
                className="min-h-12 w-full rounded-xl bg-[#DB0002] font-black text-white disabled:opacity-60"
              >
                {busy ? 'CONFIRMING RELEASE...' : 'YES, CONFIRM RELEASE'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDismissConfirm}
                className="min-h-12 w-full rounded-xl border border-gray-300 font-bold"
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : null}
      </Shell>
    );
  }
  return null;
}

export function RiderPickupRelease() {
  const [view, setView] = useState<ReleaseView>({ phase: 'scan' });
  const [camera, setCamera] = useState<CameraState>('idle');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const payloadRef = useRef<string | null>(null);
  const checklistRef = useRef<PublicChecklist | null>(null);
  const inFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<QrDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const acceptedRef = useRef(false);

  const rememberPayload = (value: string | null, phase: ReleasePhase) => {
    payloadRef.current = retainPickupPayload(phase) ? value : null;
    if (!retainPickupPayload(phase)) checklistRef.current = null;
  };

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera('idle');
  }, []);

  useEffect(() => {
    return () => {
      scanningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const resetScan = useCallback(() => {
    stopCamera();
    acceptedRef.current = false;
    inFlightRef.current = false;
    payloadRef.current = null;
    checklistRef.current = null;
    setManualCode('');
    setManualOpen(false);
    setView({ phase: 'scan' });
  }, [stopCamera]);

  const applyValidate = useCallback((status: number | null, body: unknown, transportFailed: boolean) => {
    inFlightRef.current = false;
    const result = interpretValidateResponse({ transportFailed, status, body });
    if (result.outcome === 'accepted') {
      checklistRef.current = result.checklist;
      rememberPayload(payloadRef.current, 'review');
      setView({ phase: 'review', checklist: result.checklist });
      return;
    }
    payloadRef.current = null;
    if (result.outcome === 'denied') {
      if (result.failure.group === 'advance') {
        setView({ phase: 'advance-blocked' });
        return;
      }
      setView({ phase: 'failure', failure: result.failure });
      return;
    }
    if (result.outcome === 'session') {
      setView({ phase: 'session' });
      return;
    }
    setView({ phase: 'network' });
  }, []);

  const validatePayload = useCallback(
    async (raw: string) => {
      const qrPayload = raw.trim();
      if (!qrPayload) {
        setView({ phase: 'failure', failure: failurePresentation('EMPTY_PAYLOAD') });
        return;
      }
      if (inFlightRef.current) return;
      stopCamera();
      acceptedRef.current = true;
      inFlightRef.current = true;
      payloadRef.current = qrPayload;
      setView({ phase: 'validating' });
      const token = getToken();
      if (!token) {
        inFlightRef.current = false;
        payloadRef.current = null;
        setView({ phase: 'session' });
        return;
      }
      try {
        const response = await fetch(pickupHandoffUrl(API, 'validate'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(pickupHandoffBody(qrPayload)),
        });
        const body = await response.json().catch(() => null);
        applyValidate(response.status, body, false);
      } catch {
        applyValidate(null, null, true);
      }
    },
    [applyValidate, stopCamera],
  );

  const startCamera = async () => {
    if (view.phase !== 'scan') return;
    setCamera('pending');
    const detector = createQrDetector();
    detectorRef.current = detector;
    if (!detector) {
      setCamera('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      scanningRef.current = true;
      acceptedRef.current = false;
      setCamera('scanning');
      const scanFrame = async () => {
        if (!scanningRef.current || acceptedRef.current || !videoRef.current) return;
        const activeDetector = detectorRef.current;
        if (activeDetector && videoRef.current.readyState >= 2) {
          try {
            const codes = await activeDetector.detect(videoRef.current);
            const value = codes[0]?.rawValue;
            if (value && !acceptedRef.current) {
              acceptedRef.current = true;
              scanningRef.current = false;
              void validatePayload(value);
              return;
            }
          } catch {
            /* ignore a single bad frame */
          }
        }
        if (scanningRef.current) rafRef.current = requestAnimationFrame(() => void scanFrame());
      };
      rafRef.current = requestAnimationFrame(() => void scanFrame());
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setCamera('denied');
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setCamera('missing');
      else setCamera('unavailable');
    }
  };

  const submitConfirm = async () => {
    const checklist = checklistRef.current;
    const qrPayload = payloadRef.current;
    if (!checklist || !qrPayload) {
      setView({ phase: 'failure', failure: failurePresentation(undefined) });
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setView({ phase: 'confirming', checklist });
    const token = getToken();
    if (!token) {
      inFlightRef.current = false;
      setView({ phase: 'session' });
      return;
    }
    try {
      const response = await fetch(pickupHandoffUrl(API, 'confirm'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(pickupHandoffBody(qrPayload)),
      });
      const body = await response.json().catch(() => null);
      const result = interpretConfirmResponse({ transportFailed: false, status: response.status, body });
      inFlightRef.current = false;
      if (result.outcome === 'released') {
        payloadRef.current = null;
        setView({ phase: 'released', checklist, idempotent: result.idempotent });
        return;
      }
      if (result.outcome === 'unknown') {
        rememberPayload(qrPayload, 'checking');
        checklistRef.current = checklist;
        setView({ phase: 'checking', checklist });
        return;
      }
      payloadRef.current = null;
      if (result.outcome === 'session') {
        setView({ phase: 'session' });
        return;
      }
      if (result.failure.group === 'advance') {
        setView({ phase: 'advance-blocked' });
        return;
      }
      setView({ phase: 'failure', failure: result.failure });
    } catch {
      inFlightRef.current = false;
      rememberPayload(qrPayload, 'checking');
      checklistRef.current = checklist;
      setView({ phase: 'checking', checklist });
    }
  };

  if (view.phase !== 'scan') {
    return (
      <ReleaseStage
        view={view}
        onScanAgain={resetScan}
        onCancel={resetScan}
        onAskConfirm={() => {
          if (view.phase === 'review' && !inFlightRef.current) {
            setView({ phase: 'confirm-dialog', checklist: view.checklist });
          }
        }}
        onDismissConfirm={() => {
          if (view.phase === 'confirm-dialog' && checklistRef.current && !inFlightRef.current) {
            setView({ phase: 'review', checklist: checklistRef.current });
          }
        }}
        onSubmitConfirm={() => void submitConfirm()}
        onRetryConfirm={() => void submitConfirm()}
        onDone={resetScan}
      />
    );
  }

  const message = cameraMessage(camera);
  return (
    <Shell>
      <h1 className="text-2xl font-black">PICKUP VERIFICATION</h1>
      <p className="text-gray-700">Scan the QR shown on the rider&apos;s WeKonnek app.</p>
      <p className="text-sm text-gray-500">This is rider delivery handoff, not customer pick-up.</p>
      <video
        ref={videoRef}
        className={`aspect-square w-full rounded-2xl bg-black object-cover ${camera === 'scanning' || camera === 'pending' ? '' : 'hidden'}`}
        muted
        playsInline
      />
      {camera === 'scanning' || camera === 'pending' ? null : (
        <button type="button" onClick={() => void startCamera()} className="min-h-14 rounded-xl bg-[#DB0002] px-4 text-lg font-black text-white">
          CAMERA SCANNER
        </button>
      )}
      {message ? <p className="text-sm text-gray-700">{message}</p> : null}
      {camera === 'scanning' ? <p className="text-sm font-semibold text-gray-600">Scanning…</p> : null}
      <button type="button" onClick={() => setManualOpen(true)} className="text-left text-sm font-semibold text-gray-700 underline">
        Having trouble scanning? Enter code manually
      </button>
      {manualOpen ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void validatePayload(manualCode);
          }}
        >
          <label className="block text-sm font-semibold text-gray-800" htmlFor="pickup-qr-payload">
            Pickup QR payload
          </label>
          <textarea
            id="pickup-qr-payload"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-300 p-3 text-sm"
            autoComplete="off"
          />
          <button type="submit" className="min-h-12 w-full rounded-xl bg-gray-900 font-bold text-white">
            ENTER CODE MANUALLY
          </button>
        </form>
      ) : null}
      <Link href="/merchant/orders?tab=delivery" className="text-center text-sm font-semibold text-gray-600">
        Cancel
      </Link>
    </Shell>
  );
}
