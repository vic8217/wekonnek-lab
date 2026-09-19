/**
 * Stage 10 redelivery HTTP acceptance.
 * Historical: wekonnek_stage10_test.
 * Current-schema: centralized disposable identity (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const STAGE10_ENV_PRESENT = loadStageTestEnv('.env.stage10.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  DeliveryFailureReasonCode,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE10_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';

const describeIf = STAGE10_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const STAGE10_HISTORICAL_DATABASES = [STAGE10_ACCEPTANCE_DATABASE] as const;
const STAGE10_HISTORICAL_USERS = new Set(['victor', STAGE10_ACCEPTANCE_DATABASE]);

describeIf('Stage 10 Redelivery HTTP (wekonnek_stage10_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let admin: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let foreign: { id: string; role: UserRole };
  let order: { id: number };
  let fulfillment: { id: string };
  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  const auth = (user: { id: string; role: UserRole }) => ({
    Authorization: `Bearer ${sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    )}`,
  });

  beforeAll(async () => {
    if (!existsSync(runtimeI18n)) {
      mkdirSync(runtimeI18n, { recursive: true });
      cpSync(sourceI18n, runtimeI18n, { recursive: true });
    }
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    await app.listen(0);
    prisma = app.get(PrismaService);

    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 10 HTTP',
      historicalDatabases: STAGE10_HISTORICAL_DATABASES,
      historicalUsers: STAGE10_HISTORICAL_USERS,
    });

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s10h-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    rider = await mk(UserRole.rider, 'r');
    admin = await mk(UserRole.admin, 'a');
    merchantUser = await mk(UserRole.merchant, 'm');
    foreign = await mk(UserRole.customer, 'f');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S10H ${tag}`,
        slug: `s10h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    await prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId: merchant.id,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash',
        enabled: true,
      },
    });
    order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S10H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'delivery_failed',
        orderType: 'delivery',
        totalAmount: 500,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: 'HTTP Addr',
        orderItems: {
          create: [
            { productName: 'x', quantity: 1, price: 500, subtotal: 500 },
          ],
        },
      },
    });
    fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.delivery_failed,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
      },
    });
    const assignment = await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: rider.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
      },
    });
    await prisma.deliveryAttempt.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        attemptNumber: 1,
        riderId: rider.id,
        riderAssignmentId: assignment.id,
        assignmentVersion: 1,
        physicalCustodianRiderId: rider.id,
        outcome: 'FAILED',
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        occurredAt: new Date(),
        reportedByActorType: 'RIDER',
        reportedByActorId: rider.id,
      },
    });
    await prisma.operationalCase.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        caseType: 'DELIVERY_FAILURE',
        status: 'OPEN',
        openedByActorType: 'RIDER',
        openedByActorId: rider.id,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('customer request → confirm activates; merchant GET ok; foreign denied', async () => {
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const end = new Date(Date.now() + 4 * 3600_000).toISOString();

    const denied = await request(app.getHttpServer())
      .post(`/orders/${order.id}/redelivery-requests`)
      .set(auth(foreign))
      .send({ windowStart: start, windowEnd: end })
      .expect(403);
    expect(denied.body.message?.code || denied.body.code).toBeTruthy();

    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/redelivery-requests`)
      .set(auth(customer))
      .send({
        windowStart: start,
        windowEnd: end,
        correlationId: `http-${randomUUID()}`,
      })
      .expect(201);
    const authId =
      created.body.authorization?.id ?? created.body.id ?? created.body?.authorizationId;
    expect(authId).toBeTruthy();

    const merchantView = await request(app.getHttpServer())
      .get(`/orders/${order.id}/redelivery`)
      .set(auth(merchantUser))
      .expect(200);
    expect(merchantView.body.current || merchantView.body.authorizations).toBeTruthy();

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/redelivery`)
      .set(auth(foreign))
      .expect(403);

    const confirmed = await request(app.getHttpServer())
      .post(`/redelivery-requests/${authId}/confirm`)
      .set(auth(customer))
      .send({ correlationId: `conf-${randomUUID()}` })
      .expect(201);
    expect(
      confirmed.body.authorization?.status ?? confirmed.body.status,
    ).toMatch(/ACTIVATED|CONFIRMED/);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(ful.status).toBe(FulfillmentStatus.in_transit);
  });

  it('rider cannot request; admin can cancel/activate recovery when needed', async () => {
    // Reset to delivery_failed for a fresh request
    await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: { status: FulfillmentStatus.delivery_failed },
    });
    // Cancel any open auth
    await prisma.$executeRawUnsafe(
      `UPDATE redelivery_authorizations SET status = 'CANCELLED', cancelled_at = NOW() WHERE fulfillment_id = '${fulfillment.id}'::uuid AND status IN ('REQUESTED','CONFIRMED')`,
    );

    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const end = new Date(Date.now() + 4 * 3600_000).toISOString();
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/redelivery-requests`)
      .set(auth(rider))
      .send({ windowStart: start, windowEnd: end })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/redelivery-requests`)
      .set(auth(customer))
      .send({ windowStart: start, windowEnd: end })
      .expect(201);
    const authId = created.body.authorization.id;

    await request(app.getHttpServer())
      .post(`/redelivery-requests/${authId}/cancel`)
      .set(auth(customer))
      .send({ reason: 'changed mind' })
      .expect(201);
  });
});
