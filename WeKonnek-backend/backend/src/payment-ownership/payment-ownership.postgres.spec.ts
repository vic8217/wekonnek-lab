import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { isCurrentSchemaRegressionMode } from '../test-support/test-database-guard';

if (isCurrentSchemaRegressionMode()) {
  loadStageTestEnv('.env.stage7.regression.test');
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
}
import {
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { MerchantPaymentConfigService } from './merchant-payment-config.service';
import { MerchantPaymentEvidenceService } from './merchant-payment-evidence.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { PaymentRoutingService } from './payment-routing.service';
import { OrderPayCoolsService } from '../payment-partners/order-paycools.service';
import { PaymentLifecycleService } from '../payment-partners/payment-lifecycle.service';

jest.setTimeout(60_000);

const LOCAL_DB_HOST = /localhost|127\.0\.0\.1/;

describe('Stage 1A payment ownership (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const routing = new PaymentRoutingService();
  const allocations = new PaymentAllocationService();
  const config = new MerchantPaymentConfigService(prisma);
  const evidence = new MerchantPaymentEvidenceService(
    prisma,
    events,
    config,
    routing,
  );
  const orderPayCools = new OrderPayCoolsService(
    prisma,
    {} as never,
    { recordOrder: jest.fn() } as never,
    {} as never,
    new PaymentLifecycleService(prisma),
    {
      isSourceOperational: async () => true,
      getActiveProvider: async () => ({ defaultQrExpirySeconds: 600 }),
    } as never,
    { createPayment: jest.fn() } as never,
    routing,
    events,
  );

  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!LOCAL_DB_HOST.test(url)) {
      throw new Error('Stage 1A postgres tests refuse non-local DATABASE_URL');
    }
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    if (/prod/i.test(target[0]?.database ?? '')) {
      throw new Error('Refusing Stage 1A tests against production DB');
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedOrderPair() {
    const token = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+6396${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s1a-c-${token}@test.invalid`,
      },
    });
    const merchantUserA = await prisma.user.create({
      data: {
        phone: `+6397${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s1a-ma-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchantUserB = await prisma.user.create({
      data: {
        phone: `+6398${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s1a-mb-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchantA = await prisma.merchant.create({
      data: {
        userId: merchantUserA.id,
        name: `S1A A ${token}`,
        slug: `s1a-a-${token}`,
      },
    });
    const merchantB = await prisma.merchant.create({
      data: {
        userId: merchantUserB.id,
        name: `S1A B ${token}`,
        slug: `s1a-b-${token}`,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S1A-${token.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchantA.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 910,
        deliveryFee: 50,
        transactionFeeAmount: 10,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        orderItems: {
          create: [
            {
              productName: 'Test Item',
              quantity: 1,
              price: 850,
              subtotal: 850,
            },
          ],
        },
      },
    });
    await allocations.persistForOrder(prisma, {
      id: order.id,
      merchantId: order.merchantId,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      transactionFeeAmount: order.transactionFeeAmount,
    });

    cleanup = async () => {
      await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.merchantPaymentEvidence.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.orderPaymentAllocation.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.merchantPaymentMethod.deleteMany({
        where: { merchantId: { in: [merchantA.id, merchantB.id] } },
      });
      await prisma.wkOrder.delete({ where: { id: order.id } });
      await prisma.merchant.deleteMany({
        where: { id: { in: [merchantA.id, merchantB.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [customer.id, merchantUserA.id, merchantUserB.id] },
        },
      });
    };

    return { customer, merchantUserA, merchantUserB, merchantA, merchantB, order };
  }

  it('blocks WeKonnek PayCools for merchant orders including COD context', async () => {
    const { customer, order } = await seedOrderPair();
    await expect(
      orderPayCools.createForOrder(order.id, customer.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const forbidden = await prisma.orderDomainEvent.findFirst({
      where: {
        wkOrderId: order.id,
        action: 'FORBIDDEN_MERCHANT_ORDER_PAYCOOLS_ATTEMPT',
      },
    });
    expect(forbidden).toBeTruthy();
  });

  it('returns only merchant payment options with MERCHANT beneficiary', async () => {
    const { customer, order, merchantA, merchantUserA } = await seedOrderPair();
    const qr = await config.create(merchantUserA.id, merchantA.id, {
      kind: MerchantPaymentMethodKind.MERCHANT_QR,
      displayName: 'GCash QR',
      qrAssetUrl: 'https://cdn.example/qr.png',
    });
    const options = await evidence.getPaymentOptions(order.id, customer.id);
    expect(options.beneficiary).toBe('MERCHANT');
    expect(options.wekonnekPayCoolsAllowed).toBe(false);
    expect(options.authoritativeAmount).toBe(910);
    expect(options.paymentOptions.some((o) => o.id === qr.id)).toBe(true);
    expect(
      options.paymentOptions.every((o) => o.merchantId === merchantA.id),
    ).toBe(true);
  });

  it('isolates merchant B from merchant A configuration and verification', async () => {
    const { customer, merchantUserA, merchantUserB, merchantA, merchantB, order } =
      await seedOrderPair();
    const method = await config.create(merchantUserA.id, merchantA.id, {
      kind: MerchantPaymentMethodKind.BANK_TRANSFER,
      displayName: 'BDO',
      accountName: 'Shop A',
      accountReference: '123',
    });
    await expect(
      config.listForOperator(merchantUserB.id, merchantA.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const submitted = await evidence.submitProof({
      orderId: order.id,
      userId: customer.id,
      merchantPaymentMethodId: method.id,
      declaredAmount: 9999,
      customerReference: 'REF-1',
      idempotencyKey: `idem-${order.id}`,
    });
    expect(Number(submitted.declaredAmount)).toBe(9999);

    await expect(
      evidence.verify({
        evidenceId: submitted.id,
        actorUserId: merchantUserB.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const verified = await evidence.verify({
      evidenceId: submitted.id,
      actorUserId: merchantUserA.id,
    });
    expect(verified.evidence.status).toBe(MerchantPaymentStatus.VERIFIED);

    const fresh = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.paymentStatus).toBe('paid');
    expect(fresh.merchantPaymentStatus).toBe(MerchantPaymentStatus.VERIFIED);
    expect(fresh.status).toBe('pending'); // fulfillment unchanged
    expect(Number(fresh.totalAmount)).toBe(910); // amount integrity
  });

  it('prevents customer verification and supports idempotent proof submit', async () => {
    const { customer, merchantUserA, merchantA, order } = await seedOrderPair();
    const method = await config.create(merchantUserA.id, merchantA.id, {
      kind: MerchantPaymentMethodKind.MERCHANT_QR,
      displayName: 'QR',
      qrAssetUrl: 'https://cdn.example/q.png',
    });
    const key = `idem2-${order.id}`;
    const first = await evidence.submitProof({
      orderId: order.id,
      userId: customer.id,
      merchantPaymentMethodId: method.id,
      idempotencyKey: key,
    });
    const second = await evidence.submitProof({
      orderId: order.id,
      userId: customer.id,
      merchantPaymentMethodId: method.id,
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);

    await expect(
      evidence.verify({
        evidenceId: first.id,
        actorUserId: customer.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('coalesces concurrent evidence submits with one idempotency key', async () => {
    const { customer, merchantUserA, merchantA, order } = await seedOrderPair();
    const method = await config.create(merchantUserA.id, merchantA.id, {
      kind: MerchantPaymentMethodKind.BANK_TRANSFER,
      displayName: 'Concurrent bank',
      accountReference: 'concurrent',
    });
    const idempotencyKey = `concurrent-${order.id}-${randomUUID().slice(0, 8)}`;
    const [one, two] = await Promise.all([
      evidence.submitProof({
        orderId: order.id,
        userId: customer.id,
        merchantPaymentMethodId: method.id,
        idempotencyKey,
      }),
      evidence.submitProof({
        orderId: order.id,
        userId: customer.id,
        merchantPaymentMethodId: method.id,
        idempotencyKey,
      }),
    ]);
    expect(one.id).toBe(two.id);
    expect(
      await prisma.merchantPaymentEvidence.count({ where: { idempotencyKey } }),
    ).toBe(1);
  });

  it('handles concurrent verify vs reject deterministically', async () => {
    const { customer, merchantUserA, merchantA, order } = await seedOrderPair();
    const method = await config.create(merchantUserA.id, merchantA.id, {
      kind: MerchantPaymentMethodKind.BANK_TRANSFER,
      displayName: 'Bank',
      accountReference: '99',
    });
    const submitted = await evidence.submitProof({
      orderId: order.id,
      userId: customer.id,
      merchantPaymentMethodId: method.id,
    });

    const results = await Promise.allSettled([
      evidence.verify({
        evidenceId: submitted.id,
        actorUserId: merchantUserA.id,
        expectedVersion: 0,
      }),
      evidence.reject({
        evidenceId: submitted.id,
        actorUserId: merchantUserA.id,
        expectedVersion: 0,
        reason: 'bad proof',
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);

    const final = await prisma.merchantPaymentEvidence.findUniqueOrThrow({
      where: { id: submitted.id },
    });
    expect(
      [MerchantPaymentStatus.VERIFIED, MerchantPaymentStatus.REJECTED].includes(
        final.status,
      ),
    ).toBe(true);
  });

  it('records payment allocations with mixed beneficiaries', async () => {
    const { order, merchantA } = await seedOrderPair();
    const rows = await prisma.orderPaymentAllocation.findMany({
      where: { wkOrderId: order.id },
    });
    expect(rows).toHaveLength(3);
    expect(
      rows.find((r) => r.component === 'PLATFORM_FEE')?.beneficiaryType,
    ).toBe('PLATFORM');
    expect(
      rows.find((r) => r.component === 'MERCHANDISE')?.beneficiaryId,
    ).toBe(String(merchantA.id));
  });
});
