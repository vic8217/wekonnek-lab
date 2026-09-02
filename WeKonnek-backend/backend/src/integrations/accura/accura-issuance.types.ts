import { AccuraIssuanceJobStatus } from '@prisma/client';

export const ACCURA_ISSUANCE_CLOCK = 'ACCURA_ISSUANCE_CLOCK';

export const DEFAULT_ACCURA_ISSUANCE_WORKER_POLL_MS = 2_000;
export const DEFAULT_ACCURA_ISSUANCE_BATCH_SIZE = 10;
export const DEFAULT_ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS = 300;
export const DEFAULT_ACCURA_ISSUANCE_MAX_ATTEMPTS = 6;

/** Delay after a failed attempt before the next attempt. Index 0 = after attempt 1. */
export const ACCURA_ISSUANCE_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

export type AccuraIssuanceClock = () => Date;

export type AccuraInvoiceVisibility =
  'INVOICE_PENDING' | 'INVOICE_ISSUED' | 'INVOICE_FAILED';

export const ACCURA_ISSUANCE_CLAIMABLE: AccuraIssuanceJobStatus[] = [
  AccuraIssuanceJobStatus.PENDING,
  AccuraIssuanceJobStatus.RETRY_SCHEDULED,
];

export function nextAccuraIssuanceRetryAt(
  now: Date,
  failedAttemptCount: number,
  maxAttempts: number,
): Date | null {
  if (failedAttemptCount >= maxAttempts) return null;
  const delay =
    ACCURA_ISSUANCE_RETRY_DELAYS_MS[failedAttemptCount - 1] ??
    ACCURA_ISSUANCE_RETRY_DELAYS_MS[ACCURA_ISSUANCE_RETRY_DELAYS_MS.length - 1];
  return new Date(now.getTime() + delay);
}

export function accuraInvoiceVisibility(input: {
  jobStatus: AccuraIssuanceJobStatus;
  hasInvoice: boolean;
}): AccuraInvoiceVisibility {
  if (
    input.hasInvoice ||
    input.jobStatus === AccuraIssuanceJobStatus.SUCCEEDED
  ) {
    return 'INVOICE_ISSUED';
  }
  if (input.jobStatus === AccuraIssuanceJobStatus.FAILED) {
    return 'INVOICE_FAILED';
  }
  return 'INVOICE_PENDING';
}

export function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
