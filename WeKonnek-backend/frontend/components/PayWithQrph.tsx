'use client';

import { useEffect, useMemo, useState } from 'react';

export type PayCoolsPaymentDto = {
  paymentId: string;
  reference: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  qrcodeContent: string | null;
  qrLink: string | null;
  qrImageDataUrl: string | null;
  expiresAt: string | null;
};

type DisplayStatus = 'CREATING' | PayCoolsPaymentDto['status'];

export function formatPeso(amount: number) {
  return `₱${Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function useCountdown(expiresAt: string | null, status: DisplayStatus) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt || status !== 'PENDING') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, status]);
  return useMemo(() => {
    if (!expiresAt || status !== 'PENDING') return null;
    const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [expiresAt, now, status]);
}

export default function PayWithQrph({
  payment,
  status,
  onClose,
}: {
  payment: PayCoolsPaymentDto | null;
  status: DisplayStatus;
  onClose?: () => void;
}) {
  const countdown = useCountdown(payment?.expiresAt || null, status);
  const heading =
    status === 'PAID'
      ? 'Payment Successful'
      : status === 'FAILED'
        ? 'Payment failed'
        : status === 'EXPIRED'
          ? 'QR Expired'
          : status === 'CREATING'
            ? 'Creating QR code…'
            : 'Waiting for payment';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">Pay with QRPH</h2>
      <p className="mt-1 text-sm text-slate-600">
        Complete payment using your supported banking or e-wallet app.
      </p>
      <p className="mt-4 text-sm font-bold text-slate-800">{heading}</p>
      {status === 'CREATING' && (
        <p className="mt-4 text-sm text-slate-500">Generating a secure QR code…</p>
      )}
      {payment?.qrImageDataUrl && status === 'PENDING' && (
        <img
          src={payment.qrImageDataUrl}
          alt="QRPH payment QR code"
          className="mx-auto mt-4 size-56 max-w-full rounded-xl border bg-white p-2"
        />
      )}
      {payment?.qrImageDataUrl && status === 'PENDING' && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-center text-sm text-slate-700">
          <p className="font-bold text-slate-900">Another device</p>
          <p className="mt-0.5">Using another phone? Scan the QR code above.</p>
        </div>
      )}
      {payment && (
        <div className="mt-4 space-y-1 text-sm text-slate-700">
          <p>
            Amount: <b>{formatPeso(payment.amount)}</b>
          </p>
          <p>
            Reference: <b>{payment.reference}</b>
          </p>
          {countdown && (
            <p>
              Expires in: <b>{countdown}</b>
            </p>
          )}
        </div>
      )}
      {payment?.qrLink && status === 'PENDING' && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-bold text-slate-900">Same device</p>
          <a
            href={payment.qrLink}
            target="_blank"
            rel="noreferrer"
            aria-label="Pay on this phone using PayCools"
            className="mt-2 block w-full rounded-xl bg-[#DB0002] py-2.5 text-center text-sm font-black text-white transition hover:bg-[#B80002] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#DB0002]"
          >
            Pay on this phone
          </a>
          <p className="mt-2 text-xs text-slate-600">
            Use this if your banking or e-wallet app is on this device.
          </p>
        </div>
      )}
      {status === 'PENDING' && (
        <p className="mt-3 text-xs text-slate-500">
          Opening the payment page or returning to this screen does not confirm
          payment. We wait for the bank or e-wallet to confirm.
        </p>
      )}
      {(status === 'FAILED' || status === 'EXPIRED') && (
        <p className="mt-4 text-sm text-slate-600">
          This order is no longer eligible for QR payment. Review the order to choose an available next step.
        </p>
      )}
      {(status === 'FAILED' || status === 'EXPIRED') && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-black text-white"
        >
          Close
        </button>
      )}
    </section>
  );
}
