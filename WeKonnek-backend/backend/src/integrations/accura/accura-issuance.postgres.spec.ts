import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AccuraIssuanceJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';
import { AccuraIssuanceProcessorService } from './accura-issuance.processor';

jest.setTimeout(30_000);

const LOCAL_DB_HOST = /localhost|127\.0\.0\.1/;

describe('ACCURA issuance jobs PostgreSQL', () => {
  const prisma = new PrismaService();
  const jobs = new AccuraIssuanceJobsService(prisma);
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!LOCAL_DB_HOST.test(url)) {
      throw new Error(
        'ACCURA issuance postgres tests refuse non-local DATABASE_URL',
      );
    }
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    const database = target[0]?.database ?? '';
    if (/prod/i.test(database)) {
      throw new Error(`Refusing to run ACCURA tests against ${database}`);
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function createPaidOrder() {
    const token = randomUUID();
    const buyer = await prisma.user.create({
      data: {
        phone: `+63${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
          0,
          20,
        ),
        email: `accura-job-${token}@test.invalid`,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        name: `ACCURA job ${token}`,
        slug: `accura-job-${token}`,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-JOB-${token.slice(0, 8)}`,
        userId: buyer.id,
        merchantId: merchant.id,
        totalAmount: 250,
        paymentMethod: 'qrph',
        paymentStatus: 'paid',
        status: 'processing',
      },
    });
    cleanup = async () => {
      await prisma.accuraIssuanceAuditEvent.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.accuraIssuanceJob.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.wkOrderAccuraInvoice.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.wkOrder.deleteMany({ where: { id: order.id } });
      await prisma.merchant.deleteMany({ where: { id: merchant.id } });
      await prisma.user.deleteMany({ where: { id: buyer.id } });
    };
    return { order, buyer, merchant };
  }

  it('enforces one issuance job per WkOrder', async () => {
    const { order } = await createPaidOrder();
    const first = await prisma.$transaction(async (tx) =>
      jobs.enqueueForSettledOrder(tx, order.id),
    );
    const second = await prisma.$transaction(async (tx) =>
      jobs.enqueueForSettledOrder(tx, order.id),
    );
    expect(first.enqueued).toBe(true);
    expect(second).toMatchObject({ enqueued: false, reason: 'job_exists' });
    await expect(
      prisma.accuraIssuanceJob.create({
        data: {
          wkOrderId: order.id,
          status: AccuraIssuanceJobStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.accuraIssuanceJob.count({ where: { wkOrderId: order.id } }),
    ).toBe(1);
  });

  it('lets only one worker claim a due job', async () => {
    const { order } = await createPaidOrder();
    await prisma.$transaction(async (tx) =>
      jobs.enqueueForSettledOrder(tx, order.id),
    );
    const now = new Date();
    const issueInvoiceForOrder = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        ok: true,
        category: 'ISSUED' as const,
        retryable: false as const,
        wkOrderId: order.id,
        orderCode: order.orderCode,
        invoiceId: 'inv-pg',
        officialNumber: 'ER-PG',
        status: 'ISSUED',
        issuedAt: now.toISOString(),
        documentHash: 'h'.repeat(64),
        externalOrderId: String(order.id),
        externalOrderCode: order.orderCode,
        httpStatus: 201,
      };
    });
    const config = {
      get: (key: string) =>
        key === 'ACCURA_ISSUANCE_BATCH_SIZE' ? '1' : undefined,
    } as unknown as ConfigService;
    const p1 = new AccuraIssuanceProcessorService(
      prisma,
      { issueInvoiceForOrder } as never,
      config,
      () => now,
    );
    const p2 = new AccuraIssuanceProcessorService(
      prisma,
      { issueInvoiceForOrder } as never,
      config,
      () => now,
    );
    await Promise.all([p1.processDueJobs(now), p2.processDueJobs(now)]);
    expect(issueInvoiceForOrder).toHaveBeenCalledTimes(1);
    const stored = await prisma.accuraIssuanceJob.findUniqueOrThrow({
      where: { wkOrderId: order.id },
    });
    expect(stored.status).toBe(AccuraIssuanceJobStatus.SUCCEEDED);
  });
});
