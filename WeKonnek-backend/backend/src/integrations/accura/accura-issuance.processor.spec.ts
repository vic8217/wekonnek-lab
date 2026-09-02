/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { AccuraIssuanceJobStatus, Prisma } from '@prisma/client';
import { AccuraClientService } from './accura-client.service';
import { accuraInvoiceIdempotencyKey } from './accura-client.types';
import { AccuraIssuanceProcessorService } from './accura-issuance.processor';
import type { AccuraIssuanceOutcome } from './accura-client.types';

const ORDER_ID = 42;
const ORDER_CODE = 'WK-ACC-42';
const JOB_ID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-01T12:00:00.000Z');

function issuedOutcome(): AccuraIssuanceOutcome {
  return {
    ok: true,
    category: 'ISSUED',
    retryable: false,
    wkOrderId: ORDER_ID,
    orderCode: ORDER_CODE,
    invoiceId: 'inv-1',
    officialNumber: 'ER-000001',
    status: 'ISSUED',
    issuedAt: '2026-09-01T12:00:00.000Z',
    documentHash: 'a'.repeat(64),
    externalOrderId: String(ORDER_ID),
    externalOrderCode: ORDER_CODE,
    httpStatus: 201,
  };
}

function failedOutcome(
  category: Extract<AccuraIssuanceOutcome, { ok: false }>['category'],
  retryable: boolean,
  httpStatus?: number,
): AccuraIssuanceOutcome {
  return {
    ok: false,
    category,
    retryable,
    wkOrderId: ORDER_ID,
    orderCode: ORDER_CODE,
    message: category,
    httpStatus,
  };
}

function applyData(row: any, data: any) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] += (value as { increment: number }).increment;
    } else {
      row[key] = value;
    }
  }
}

function matchesOr(job: any, clause: any) {
  if (clause.status?.in) {
    return (
      clause.status.in.includes(job.status) &&
      job.nextAttemptAt.getTime() <= clause.nextAttemptAt.lte.getTime()
    );
  }
  if (clause.status === AccuraIssuanceJobStatus.PROCESSING) {
    return (
      job.status === AccuraIssuanceJobStatus.PROCESSING &&
      job.processingStartedAt &&
      job.processingStartedAt.getTime() <=
        clause.processingStartedAt.lte.getTime()
    );
  }
  return false;
}

function createStore(options?: {
  status?: AccuraIssuanceJobStatus;
  attemptCount?: number;
  nextAttemptAt?: Date;
  processingStartedAt?: Date | null;
  invoice?: boolean;
  paymentStatus?: string;
  transactionFeeAmount?: number;
}) {
  const order = {
    id: ORDER_ID,
    orderCode: ORDER_CODE,
    userId: '11111111-1111-1111-1111-111111111111',
    paymentStatus: options?.paymentStatus ?? 'paid',
    paymentMethod: 'qrph',
    status: 'processing',
    transactionFeeAmount: options?.transactionFeeAmount ?? 8.5,
    deliveryFee: 20,
    shopId: 7,
    merchantId: 11,
    discountAmount: new Prisma.Decimal(0),
    paymentRef: 'PAY-1',
    deliveryAddress: null,
    orderItems: [
      {
        productName: 'Coffee',
        quantity: 1,
        price: new Prisma.Decimal('120.00'),
        productId: 3,
      },
    ],
    shop: {
      id: 7,
      name: 'Cafe',
      merchantId: 11,
      accuraBranchMapping: {
        merchantId: 11,
        accuraBranchId: 'accura-branch-1',
      },
    },
  };
  const job = {
    id: JOB_ID,
    wkOrderId: ORDER_ID,
    status: options?.status ?? AccuraIssuanceJobStatus.PENDING,
    attemptCount: options?.attemptCount ?? 0,
    nextAttemptAt: options?.nextAttemptAt ?? NOW,
    processingStartedAt: options?.processingStartedAt ?? null,
    lastAttemptAt: null as Date | null,
    lastErrorCategory: null as string | null,
    lastHttpStatus: null as number | null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null as Date | null,
  };
  const jobs = [job];
  const audits: any[] = [];
  const invoices = options?.invoice
    ? [{ wkOrderId: ORDER_ID, accuraInvoiceId: 'inv-webhook' }]
    : [];

  const prisma = {
    accuraIssuanceJob: {
      findMany: jest.fn(async ({ where, take }: any) => {
        return jobs
          .filter((row) =>
            (where.OR ?? []).some((clause: any) => matchesOr(row, clause)),
          )
          .slice(0, take)
          .map((row) => ({ id: row.id }));
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = jobs.find((jobRow) => jobRow.id === where.id);
        if (!row) return { count: 0 };
        const ok = (where.OR ?? []).some((clause: any) =>
          matchesOr(row, clause),
        );
        if (!ok) return { count: 0 };
        applyData(row, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = jobs.find((jobRow) => jobRow.id === where.id);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = jobs.find((jobRow) => jobRow.id === where.id);
        if (!row) return null;
        applyData(row, data);
        return { ...row };
      }),
    },
    accuraIssuanceAuditEvent: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
    wkOrderAccuraInvoice: {
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          invoices.find((row) => row.wkOrderId === where.wkOrderId) ?? null
        );
      }),
    },
    wkOrder: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id !== order.id) return null;
        return { ...order };
      }),
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Ana',
        lastName: 'Cruz',
        email: 'ana@test.invalid',
        phone: '+639170000001',
      })),
    },
  };

  return { prisma, jobs, job, audits, invoices, order };
}

function configFor(values: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    ACCURA_ISSUANCE_BATCH_SIZE: '10',
    ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS: '300',
    ACCURA_ISSUANCE_MAX_ATTEMPTS: '6',
    ACCURA_ISSUANCE_WORKER_POLL_MS: '20',
    ACCURA_API_BASE_URL: 'https://accura-sandbox.example.test',
    ACCURA_PLATFORM_CLIENT_ID: 'acc_platform',
    ACCURA_PLATFORM_CLIENT_SECRET: 'accura-platform-secret-value',
    ACCURA_INTEGRATION_CLIENT_ID: 'acc_testclientid',
    ACCURA_INTEGRATION_CLIENT_SECRET: 'accura-machine-secret-value',
    ACCURA_BRANCH_ID: 'accura-branch-1',
    ACCURA_SERIES_ID: 'accura-series-1',
    ACCURA_API_TIMEOUT_MS: '10000',
  };
  return {
    get: (key: string) => ({ ...defaults, ...values })[key],
  } as unknown as ConfigService;
}

describe('AccuraIssuanceProcessorService', () => {
  it('retries timeout then 500 then succeeds with the same idempotency key', async () => {
    const store = createStore();
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      )
      .mockResolvedValueOnce({
        status: 500,
        json: async () => ({ error: 'UNAVAILABLE' }),
      })
      .mockResolvedValueOnce({
        status: 201,
        json: async () => ({
          invoiceId: 'inv-1',
          officialNumber: 'ER-000001',
          status: 'ISSUED',
          issuedAt: '2026-09-01T12:00:00.000Z',
          documentHash: 'a'.repeat(64),
          externalOrderId: String(ORDER_ID),
          externalOrderCode: ORDER_CODE,
        }),
      });
    const accura = new AccuraClientService(
      store.prisma as never,
      configFor(),
      fetchImpl,
    );
    let now = NOW;
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      accura,
      configFor(),
      () => now,
    );

    await processor.processDueJobs(now);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.RETRY_SCHEDULED);
    expect(store.job.lastErrorCategory).toBe('TIMEOUT');
    expect(store.order.paymentStatus).toBe('paid');

    now = new Date(now.getTime() + 61_000);
    await processor.processDueJobs(now);
    expect(store.job.lastErrorCategory).toBe('SERVER');
    expect(store.job.lastHttpStatus).toBe(500);

    now = new Date(now.getTime() + 5 * 60_000 + 1);
    await processor.processDueJobs(now);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
    expect(store.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const keys = fetchImpl.mock.calls.map(
      (call) => (call[1] as RequestInit).headers,
    );
    for (const headers of keys) {
      expect((headers as Record<string, string>)['Idempotency-Key']).toBe(
        accuraInvoiceIdempotencyKey(ORDER_ID),
      );
    }
    expect(accuraInvoiceIdempotencyKey(ORDER_ID)).toBe(
      'wekonnek:wkorder:42:accura-invoice',
    );
  });

  it('schedules retry on 429 without mutating payment fields', async () => {
    const store = createStore();
    const accura = {
      issueInvoiceForOrder: jest.fn(async () =>
        failedOutcome('RATE_LIMITED', true, 429),
      ),
    };
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      accura as never,
      configFor(),
      () => NOW,
    );
    await processor.processDueJobs(NOW);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.RETRY_SCHEDULED);
    expect(store.job.lastErrorCategory).toBe('RATE_LIMITED');
    expect(store.job.lastHttpStatus).toBe(429);
    expect(store.order.paymentStatus).toBe('paid');
    expect(store.order.transactionFeeAmount).toBe(8.5);
    expect(store.order.deliveryFee).toBe(20);
    expect(store.prisma.wkOrder.update).toBeUndefined();
  });

  it('fails terminally on 401/403 and permanent 4xx', async () => {
    const auth = createStore();
    const authProcessor = new AccuraIssuanceProcessorService(
      auth.prisma as never,
      {
        issueInvoiceForOrder: jest.fn(async () =>
          failedOutcome('AUTH', false, 401),
        ),
      } as never,
      configFor(),
      () => NOW,
    );
    await authProcessor.processDueJobs(NOW);
    expect(auth.job.status).toBe(AccuraIssuanceJobStatus.FAILED);
    expect(auth.job.lastErrorCategory).toBe('AUTH');
    expect(auth.order.paymentStatus).toBe('paid');

    const rejected = createStore();
    const rejectedProcessor = new AccuraIssuanceProcessorService(
      rejected.prisma as never,
      {
        issueInvoiceForOrder: jest.fn(async () =>
          failedOutcome('REJECTED', false, 400),
        ),
      } as never,
      configFor(),
      () => NOW,
    );
    await rejectedProcessor.processDueJobs(NOW);
    expect(rejected.job.status).toBe(AccuraIssuanceJobStatus.FAILED);
    expect(rejected.job.lastErrorCategory).toBe('REJECTED');
  });

  it('lets only one of two concurrent processors call ACCURA', async () => {
    const store = createStore();
    const issueInvoiceForOrder = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return issuedOutcome();
    });
    const p1 = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder } as never,
      configFor({ ACCURA_ISSUANCE_BATCH_SIZE: '1' }),
      () => NOW,
    );
    const p2 = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder } as never,
      configFor({ ACCURA_ISSUANCE_BATCH_SIZE: '1' }),
      () => NOW,
    );
    await Promise.all([p1.processDueJobs(NOW), p2.processDueJobs(NOW)]);
    expect(issueInvoiceForOrder).toHaveBeenCalledTimes(1);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
  });

  it('reclaims a stale PROCESSING lease and processes once', async () => {
    const store = createStore({
      status: AccuraIssuanceJobStatus.PROCESSING,
      attemptCount: 1,
      processingStartedAt: new Date(NOW.getTime() - 400_000),
      nextAttemptAt: new Date(NOW.getTime() - 400_000),
    });
    const issueInvoiceForOrder = jest.fn(async () => issuedOutcome());
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder } as never,
      configFor(),
      () => NOW,
    );
    await processor.processDueJobs(NOW);
    expect(issueInvoiceForOrder).toHaveBeenCalledTimes(1);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
    expect(store.job.attemptCount).toBe(2);
  });

  it('marks a job complete when WkOrderAccuraInvoice already exists without ACCURA HTTP', async () => {
    const store = createStore({ invoice: true });
    const issueInvoiceForOrder = jest.fn();
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder } as never,
      configFor(),
      () => NOW,
    );
    await processor.processDueJobs(NOW);
    expect(issueInvoiceForOrder).not.toHaveBeenCalled();
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
    expect(store.audits[0].result).toBe('ALREADY_COMPLETED');
    expect(store.invoices).toHaveLength(1);
  });

  it('does not issue a second invoice after webhook-completed crash before SUCCEEDED', async () => {
    const store = createStore({
      status: AccuraIssuanceJobStatus.PROCESSING,
      attemptCount: 1,
      processingStartedAt: new Date(NOW.getTime() - 400_000),
      invoice: true,
    });
    const issueInvoiceForOrder = jest.fn();
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder } as never,
      configFor(),
      () => NOW,
    );
    await processor.processDueJobs(NOW);
    expect(issueInvoiceForOrder).not.toHaveBeenCalled();
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
    expect(store.invoices).toHaveLength(1);
  });

  it('fails after retry exhaustion', async () => {
    const store = createStore({
      status: AccuraIssuanceJobStatus.RETRY_SCHEDULED,
      attemptCount: 5,
      nextAttemptAt: NOW,
    });
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      {
        issueInvoiceForOrder: jest.fn(async () =>
          failedOutcome('SERVER', true, 500),
        ),
      } as never,
      configFor(),
      () => NOW,
    );
    await processor.processDueJobs(NOW);
    expect(store.job.status).toBe(AccuraIssuanceJobStatus.FAILED);
    expect(store.job.attemptCount).toBe(6);
  });

  it('stops the poll loop on SIGTERM-equivalent requestStop', async () => {
    const store = createStore({
      status: AccuraIssuanceJobStatus.SUCCEEDED,
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
    });
    const processor = new AccuraIssuanceProcessorService(
      store.prisma as never,
      { issueInvoiceForOrder: jest.fn() } as never,
      configFor(),
      () => NOW,
    );
    const running = processor.runUntilStopped();
    await new Promise((resolve) => setTimeout(resolve, 5));
    processor.requestStop();
    await running;
    expect(store.prisma.accuraIssuanceJob.findMany).toHaveBeenCalled();
  });
});
