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
  onRetry,
}: {
  payment: PayCoolsPaymentDto | null;
  status: DisplayStatus;
  onRetry?: () => void;
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
        Scan the QR code using your supported banking or e-wallet app.
      </p>
      <p className="mt-4 text-sm font-bold text-slate-800">{heading}</p>
      {status === 'CREATING' && (
        <p className="mt-4 text-sm text-slate-500">Generating a secure QR code…</p>
      )}
      {payment?.qrImageDataUrl && status === 'PENDING' && (
        <img
          src={payment.qrImageDataUrl}
          alt="QRPH payment QR code"
          className="mx-auto mt-4 size-56 rounded-xl border bg-white p-2"
        />
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
        <a
          href={payment.qrLink}
          target="_blank"
          rel="noreferrer"
          className="mt-4 block w-full rounded-xl border border-slate-300 py-2.5 text-center text-sm font-bold text-slate-800"
        >
          Open payment page
        </a>
      )}
      {status === 'PENDING' && (
        <p className="mt-3 text-xs text-slate-500">
          Opening the payment page or returning to this screen does not confirm
          payment. We wait for the bank or e-wallet to confirm.
        </p>
      )}
      {(status === 'FAILED' || status === 'EXPIRED') && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 w-full rounded-xl bg-[#DB0002] py-2.5 text-sm font-black text-white"
        >
          Generate a new QR code
        </button>
      )}
    </section>
  );
}
