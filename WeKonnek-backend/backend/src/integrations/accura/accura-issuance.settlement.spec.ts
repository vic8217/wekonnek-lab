/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/only-throw-error, @typescript-eslint/require-await */
import { readFileSync } from 'fs';
import { join } from 'path';
import { AccuraIssuanceJobStatus } from '@prisma/client';
import { OrdersService } from '../../orders/orders.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';
import { AccuraIssuanceProcessorService } from './accura-issuance.processor';

function createPaidStore() {
  const order = {
    id: 88,
    orderCode: 'WK-ORDER-88',
    status: 'pending',
    paymentMethod: 'qrph',
    paymentStatus: 'pending',
    transactionFeeAmount: 8.5,
    deliveryFee: 20,
    transactionFeeRate: 0.05,
    transactionFeeBasisNetOfVat: 170,
  };
  const jobs: any[] = [];
  const audits: any[] = [];
  const invoices: any[] = [];

  const prisma: any = {
    wkOrder: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        if (where.id !== order.id) return null;
        return {
          ...order,
          accuraInvoice: include?.accuraInvoice
            ? (invoices[0] ?? null)
            : undefined,
          accuraIssuanceJob: include?.accuraIssuanceJob
            ? (jobs[0] ?? null)
            : undefined,
        };
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(order, data);
        return { ...order };
      }),
    },
    accuraIssuanceJob: {
      create: jest.fn(async ({ data }: any) => {
        if (jobs.some((row) => row.wkOrderId === data.wkOrderId)) {
          throw { code: 'P2002' };
        }
        const job = {
          id: 'job-88',
          attemptCount: 0,
          status: AccuraIssuanceJobStatus.PENDING,
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
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const issuance = new AccuraIssuanceJobsService(prisma);
  const orders = new OrdersService(
    prisma,
    {} as never,
    { notify: jest.fn() } as never,
    {} as never,
    {} as never,
    { recordOrder: jest.fn() } as never,
    {} as never,
    { ensureForWkOrder: jest.fn() } as never,
    issuance,
  );
  return { prisma, order, jobs, audits, orders, issuance };
}

describe('ACCURA issuance post-payment settlement', () => {
  it('does not import Accura HTTP from PayCools settlement', () => {
    const src = readFileSync(
      join(__dirname, '../../payment-partners/order-paycools.service.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/AccuraClientService|issueInvoiceForOrder/);
  });

  it('creates one issuance job after verified paid settlement without ACCURA HTTP', async () => {
    const accura = { issueInvoiceForOrder: jest.fn() };
    const { orders, order, jobs, prisma } = createPaidStore();
    await orders.markPaidByGateway('88', 'completed');
    expect(order.paymentStatus).toBe('paid');
    expect(order.status).toBe('processing');
    expect(order.transactionFeeAmount).toBe(8.5);
    expect(order.deliveryFee).toBe(20);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe(AccuraIssuanceJobStatus.PENDING);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(accura.issueInvoiceForOrder).not.toHaveBeenCalled();
  });

  it('does not fail settlement when ACCURA is later unavailable; job retries', async () => {
    const { orders, order, jobs, prisma } = createPaidStore();
    await orders.markPaidByGateway('88', 'completed');
    const job = jobs[0];
    const now = new Date('2026-09-01T12:00:00.000Z');
    job.nextAttemptAt = now;
    prisma.accuraIssuanceJob.findMany = jest.fn(async () => [{ id: job.id }]);
    prisma.accuraIssuanceJob.updateMany = jest.fn(async ({ data }: any) => {
      job.status = data.status;
      job.attemptCount += 1;
      job.processingStartedAt = data.processingStartedAt;
      return { count: 1 };
    });
    prisma.accuraIssuanceJob.findUnique = jest.fn(async () => ({ ...job }));
    prisma.accuraIssuanceJob.update = jest.fn(async ({ data }: any) => {
      Object.assign(job, data);
      return job;
    });
    prisma.wkOrderAccuraInvoice = {
      findUnique: jest.fn(async () => null),
    };
    const processor = new AccuraIssuanceProcessorService(
      prisma,
      {
        issueInvoiceForOrder: jest.fn(async () => ({
          ok: false,
          category: 'TIMEOUT',
          retryable: true,
          wkOrderId: 88,
          orderCode: 'WK-ORDER-88',
          message: 'ACCURA issuance timed out',
        })),
      } as never,
      { get: () => undefined } as never,
      () => now,
    );
    await processor.processDueJobs(now);
    expect(order.paymentStatus).toBe('paid');
    expect(order.transactionFeeAmount).toBe(8.5);
    expect(job.status).toBe(AccuraIssuanceJobStatus.RETRY_SCHEDULED);
    expect(jobs).toHaveLength(1);
  });

  it('keeps a single job across duplicate paid callbacks', async () => {
    const { orders, jobs } = createPaidStore();
    await orders.markPaidByGateway('88', 'completed');
    await orders.markPaidByGateway('88', 'completed');
    expect(jobs).toHaveLength(1);
  });

  it('does not enqueue on failed payment or unpaid order creation', async () => {
    const failed = createPaidStore();
    await failed.orders.markPaidByGateway('88', 'failed');
    expect(failed.order.paymentStatus).toBe('failed');
    expect(failed.jobs).toHaveLength(0);

    const unpaid = createPaidStore();
    expect(unpaid.order.paymentStatus).toBe('pending');
    expect(unpaid.jobs).toHaveLength(0);
  });
});
