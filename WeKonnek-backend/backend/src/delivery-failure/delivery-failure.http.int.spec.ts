/**
 * Stage 8 delivery failure HTTP acceptance.
 * Historical: wekonnek_stage8_test.
 * Current-schema: centralized disposable identity (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const STAGE8_ENV_PRESENT = loadStageTestEnv('.env.stage8.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  DeliveryFailureReasonCode,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationalDisposition,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE8_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';

const describeIf = STAGE8_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const STAGE8_HISTORICAL_DATABASES = [STAGE8_ACCEPTANCE_DATABASE] as const;
const STAGE8_HISTORICAL_USERS = new Set(['victor', STAGE8_ACCEPTANCE_DATABASE]);

describeIf('Stage 8 Delivery Failure HTTP (wekonnek_stage8_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let riderB: { id: string; role: UserRole };
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
      label: 'Stage 8 HTTP',
      historicalDatabases: STAGE8_HISTORICAL_DATABASES,
      historicalUsers: STAGE8_HISTORICAL_USERS,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const user = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s8h-${tag}-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customer = await user(UserRole.customer);
    rider = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    admin = await user(UserRole.admin);
    merchantUser = await user(UserRole.merchant);
    foreign = await user(UserRole.customer);
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S8H ${tag}`,
        slug: `s8h-${tag}`,
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
        orderCode: `WK-S8H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 500,
        deliveryFee: 40,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        orderItems: {
          create: [
            {
              productName: 'item',
              quantity: 1,
              price: 500,
              subtotal: 500,
            },
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
        status: FulfillmentStatus.in_transit,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
      },
    });
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: rider.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
        assignedByType: 'SYSTEM',
      },
    });
  });

  it('actor matrix: rider reports; foreign forbidden; admin disposition/resolve; privacy', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(foreign))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(customer))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      })
      .expect(403);

    const reported = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(rider))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        customerResponse: 'UNREACHABLE',
        idempotencyKey: `http-${randomUUID()}`,
        correlationId: `corr-${randomUUID()}`,
        evidences: [
          {
            evidenceKind: 'PHOTO',
            storageReference: 'private://photo-1',
          },
        ],
      })
      .expect(201);

    expect(reported.body.code).toBe('DELIVERY_FAILURE_RECORDED');
    expect(reported.body.attempt.attemptNumber).toBe(1);

    // Spoof riderId
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(rider))
      .send({
        riderId: riderB.id,
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `spoof-${randomUUID()}`,
      })
      .expect(403);

    const riderAttempts = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-attempts`)
      .set(auth(rider))
      .expect(200);
    expect(riderAttempts.body.attempts[0].evidences[0].storageReference).toBe(
      'private://photo-1',
    );

    const customerAttempts = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-attempts`)
      .set(auth(customer))
      .expect(200);
    expect(
      customerAttempts.body.attempts[0].evidences[0].storageReference,
    ).toBeUndefined();
    expect(customerAttempts.body.attempts[0].locationLatitude).toBeUndefined();

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-attempts`)
      .set(auth(foreign))
      .expect(403);

    const caseView = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-case`)
      .set(auth(admin))
      .expect(200);
    expect(caseView.body.case.id).toBe(reported.body.case.id);

    await request(app.getHttpServer())
      .post(`/operational-cases/${reported.body.case.id}/disposition`)
      .set(auth(rider))
      .send({
        disposition: OperationalDisposition.HOLD_FOR_REVIEW,
        reason: 'nope',
        correlationId: `c-${randomUUID()}`,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/operational-cases/${reported.body.case.id}/disposition`)
      .set(auth(admin))
      .send({
        disposition: OperationalDisposition.HOLD_FOR_REVIEW,
        reason: 'hold for ops',
        correlationId: `c-${randomUUID()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/operational-cases/${reported.body.case.id}/resolve`)
      .set(auth(admin))
      .send({
        reason: 'closed after review',
        correlationId: `c-${randomUUID()}`,
      })
      .expect(201);
  });

  it('pending incoming / former rider / coordinator denied; merchant limited GET', async () => {
    const coordinator = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s8h-coord-${randomUUID()}@test.invalid`,
        role: UserRole.coordinator,
      },
    });

    // Set pending custody transfer — active rider still A but pending B
    await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: { pendingCustodyIncomingRiderId: riderB.id },
    });

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(rider))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `pend-${randomUUID()}`,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(riderB))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `incom-${randomUUID()}`,
      })
      .expect(403);

    await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: { pendingCustodyIncomingRiderId: null },
    });

    // Former rider: swap active to B, keep A as prior
    await prisma.orderFulfillment.update({
      where: { id: fulfillment.id },
      data: {
        activeRiderId: riderB.id,
        physicalCustodianRiderId: riderB.id,
        assignmentVersion: 2,
      },
    });
    await prisma.riderAssignment.updateMany({
      where: { fulfillmentId: fulfillment.id, riderId: rider.id },
      data: { status: RiderAssignmentStatus.SUPERSEDED },
    });
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: riderB.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 2,
        assignedByType: 'SYSTEM',
      },
    });

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(rider))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `former-${randomUUID()}`,
      })
      .expect(403);

    const reported = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(riderB))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        idempotencyKey: `b-ok-${randomUUID()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-failures`)
      .set(auth(coordinator))
      .send({
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `coord-${randomUUID()}`,
      })
      .expect(403);

    const merchantCase = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-case`)
      .set(auth(merchantUser))
      .expect(200);
    expect(merchantCase.body.case.id).toBe(reported.body.case.id);
    expect(merchantCase.body.case.events).toBeUndefined();

    await request(app.getHttpServer())
      .post(`/operational-cases/${reported.body.case.id}/disposition`)
      .set(auth(merchantUser))
      .send({
        disposition: OperationalDisposition.HOLD_FOR_REVIEW,
        reason: 'merchant cannot',
        correlationId: `c-${randomUUID()}`,
      })
      .expect(403);

    const customerCase = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-case`)
      .set(auth(customer))
      .expect(200);
    expect(customerCase.body.case.id).toBe(reported.body.case.id);
  });

  it('REST marketplace rider delivery_failed via FulfillmentTransitionService blocked', async () => {
    // Modules/orders + tracking gateway are orderV2-oriented. Marketplace wkOrder
    // bypass is closed on FulfillmentTransitionService (used by gateway/REST).
    const transitions = app.get(FulfillmentTransitionService);
    await expect(
      transitions.transition({
        wkOrderId: order.id,
        targetStatus: 'delivery_failed',
        actor: { id: rider.id, type: 'RIDER' },
      }),
    ).rejects.toBeDefined();
    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(ful.status).toBe(FulfillmentStatus.in_transit);
  });
});
