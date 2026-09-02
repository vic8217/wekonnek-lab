/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/only-throw-error, @typescript-eslint/require-await */
import { AccuraIssuanceJobStatus } from '@prisma/client';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';

function createStore(initial?: {
  paymentStatus?: string;
  paymentMethod?: string;
  status?: string;
  invoice?: boolean;
}) {
  const order = {
    id: 88,
    orderCode: 'WK-ORDER-88',
    paymentStatus: initial?.paymentStatus ?? 'paid',
    paymentMethod: initial?.paymentMethod ?? 'qrph',
    status: initial?.status ?? 'processing',
    transactionFeeAmount: 8.5,
    deliveryFee: 20,
  };
  const jobs: any[] = [];
  const audits: any[] = [];
  const invoices: any[] = initial?.invoice
    ? [{ wkOrderId: 88, accuraInvoiceId: 'inv-existing' }]
    : [];

  const db = {
    wkOrder: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        if (where.id !== order.id) return null;
        return {
          ...order,
          accuraInvoice: include?.accuraInvoice
            ? (invoices.find((row) => row.wkOrderId === order.id) ?? null)
            : undefined,
          accuraIssuanceJob: include?.accuraIssuanceJob
            ? (jobs.find((row) => row.wkOrderId === order.id) ?? null)
            : undefined,
        };
      }),
    },
    accuraIssuanceJob: {
      create: jest.fn(async ({ data }: any) => {
        if (jobs.some((row) => row.wkOrderId === data.wkOrderId)) {
          throw { code: 'P2002' };
        }
        const job = {
          id: 'job-1',
          status: AccuraIssuanceJobStatus.PENDING,
          attemptCount: 0,
          processingStartedAt: null,
          lastAttemptAt: null,
          lastErrorCategory: null,
          lastHttpStatus: null,
          completedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        jobs.push(job);
        return job;
      }),
    },
    accuraIssuanceAuditEvent: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
  };

  return {
    service: new AccuraIssuanceJobsService(db as never),
    db,
    order,
    jobs,
    audits,
  };
}

describe('AccuraIssuanceJobsService', () => {
  it('enqueues one PENDING job for a paid WkOrder without calling ACCURA', async () => {
    const { service, jobs, audits, db } = createStore();
    const result = await service.enqueueForSettledOrder(db as never, 88);
    expect(result).toMatchObject({ enqueued: true, reason: 'created' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].wkOrderId).toBe(88);
    expect(jobs[0].status).toBe(AccuraIssuanceJobStatus.PENDING);
    expect(audits[0]).toMatchObject({
      result: 'ENQUEUED',
      actorType: 'SYSTEM',
      wkOrderId: 88,
      orderCode: 'WK-ORDER-88',
    });
  });

  it('does not enqueue unpaid orders, already invoiced orders, or duplicates', async () => {
    const unpaid = createStore({ paymentStatus: 'pending' });
    await expect(
      unpaid.service.enqueueForSettledOrder(unpaid.db as never, 88),
    ).resolves.toMatchObject({ enqueued: false, reason: 'not_eligible' });

    const invoiced = createStore({ invoice: true });
    await expect(
      invoiced.service.enqueueForSettledOrder(invoiced.db as never, 88),
    ).resolves.toMatchObject({ enqueued: false, reason: 'already_invoiced' });

    const first = createStore();
    await first.service.enqueueForSettledOrder(first.db as never, 88);
    await expect(
      first.service.enqueueForSettledOrder(first.db as never, 88),
    ).resolves.toMatchObject({ enqueued: false, reason: 'job_exists' });
    expect(first.jobs).toHaveLength(1);
  });

  it('exposes PAID / INVOICE PENDING without inventing a payment status', () => {
    const { service } = createStore();
    const read = service.toReadModel({
      id: 'job-1',
      wkOrderId: 88,
      status: AccuraIssuanceJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      lastAttemptAt: null,
      lastErrorCategory: null,
      lastHttpStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      wkOrder: { orderCode: 'WK-ORDER-88', paymentStatus: 'paid' },
    });
    expect(read.displayStatus).toBe('PAID / INVOICE PENDING');
    expect(read.paymentStatus).toBe('paid');
    expect(read.invoiceVisibility).toBe('INVOICE_PENDING');
  });
});
