import { AccuraIssuanceJobStatus } from '@prisma/client';
import {
  ACCURA_ISSUANCE_RETRY_DELAYS_MS,
  accuraInvoiceVisibility,
  nextAccuraIssuanceRetryAt,
} from './accura-issuance.types';

describe('ACCURA issuance retry policy', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');

  it('uses the documented delay ladder and stops after max attempts', () => {
    expect(ACCURA_ISSUANCE_RETRY_DELAYS_MS).toEqual([
      60_000, 300_000, 900_000, 3_600_000, 21_600_000,
    ]);
    expect(nextAccuraIssuanceRetryAt(now, 1, 6)?.toISOString()).toBe(
      '2026-09-01T00:01:00.000Z',
    );
    expect(nextAccuraIssuanceRetryAt(now, 2, 6)?.toISOString()).toBe(
      '2026-09-01T00:05:00.000Z',
    );
    expect(nextAccuraIssuanceRetryAt(now, 3, 6)?.toISOString()).toBe(
      '2026-09-01T00:15:00.000Z',
    );
    expect(nextAccuraIssuanceRetryAt(now, 4, 6)?.toISOString()).toBe(
      '2026-09-01T01:00:00.000Z',
    );
    expect(nextAccuraIssuanceRetryAt(now, 5, 6)?.toISOString()).toBe(
      '2026-09-01T06:00:00.000Z',
    );
    expect(nextAccuraIssuanceRetryAt(now, 6, 6)).toBeNull();
  });

  it('maps job plus webhook association to operator visibility', () => {
    expect(
      accuraInvoiceVisibility({
        jobStatus: AccuraIssuanceJobStatus.PENDING,
        hasInvoice: false,
      }),
    ).toBe('INVOICE_PENDING');
    expect(
      accuraInvoiceVisibility({
        jobStatus: AccuraIssuanceJobStatus.FAILED,
        hasInvoice: false,
      }),
    ).toBe('INVOICE_FAILED');
    expect(
      accuraInvoiceVisibility({
        jobStatus: AccuraIssuanceJobStatus.PROCESSING,
        hasInvoice: true,
      }),
    ).toBe('INVOICE_ISSUED');
  });
});
