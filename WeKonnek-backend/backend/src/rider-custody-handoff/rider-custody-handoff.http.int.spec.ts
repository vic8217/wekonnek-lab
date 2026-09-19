/**
 * Stage 7 secure rider custody handoff HTTP acceptance.
 * Historical: wekonnek_stage7_test.
 * Current-schema: centralized disposable identity (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const STAGE7_ENV_PRESENT = loadStageTestEnv('.env.stage7.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = STAGE7_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const STAGE7_HISTORICAL_DATABASES = ['wekonnek_stage7_test'] as const;
const STAGE7_HISTORICAL_USERS = new Set(['victor', 'wekonnek_stage7_test']);

describeIf('Stage 7 Rider Custody Handoff HTTP (wekonnek_stage7_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignments: RiderAssignmentService;
  let transitions: FulfillmentTransitionService;
  let customer: any;
  let riderA: any;
  let riderB: any;
  let riderC: any;
  let merchantUser: any;
  let foreignMerchantUser: any;
  let merchant: any;
  let order: any;
  let fulfillment: any;
  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  const auth = (user: any) => ({
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
    assignments = app.get(RiderAssignmentService);
    transitions = app.get(FulfillmentTransitionService);

    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 7 HTTP',
      historicalDatabases: STAGE7_HISTORICAL_DATABASES,
      historicalUsers: STAGE7_HISTORICAL_USERS,
    });
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const user = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s7h-${tag}-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customer = await user(UserRole.customer);
    riderA = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    riderC = await user(UserRole.rider);
    merchantUser = await user(UserRole.merchant);
    foreignMerchantUser = await user(UserRole.merchant);
    merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S7H ${tag}`,
        slug: `s7h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: false,
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
        orderCode: `WK-S7H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 100, subtotal: 100 },
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
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: riderA.id,
      actor: { type: 'SYSTEM' },
    });
    fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
  });

  afterEach(async () => {
    await prisma.riderCustodyHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.customerDeliveryHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.pickupHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order?.id } });
    await prisma.orderDomainEvent.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.riderAssignment.deleteMany({
      where: { fulfillmentId: fulfillment?.id },
    });
    await prisma.orderFulfillment.deleteMany({
      where: { id: fulfillment?.id },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: order?.id } });
    await prisma.wkOrder.deleteMany({ where: { id: order?.id } });
    await prisma.merchantPaymentMethod.deleteMany({
      where: { merchantId: merchant?.id },
    });
    await prisma.merchant.deleteMany({ where: { id: merchant?.id } });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            customer?.id,
            riderA?.id,
            riderB?.id,
            riderC?.id,
            merchantUser?.id,
            foreignMerchantUser?.id,
          ].filter(Boolean),
        },
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    if (existsSync(runtimeI18n)) {
      rmSync(runtimeI18n, { recursive: true, force: true });
    }
  });

  async function advanceToInTransit(rider = riderA) {
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/pickup-token`)
      .set(auth(rider))
      .expect(201);
    await request(app.getHttpServer())
      .post('/pickup-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    await transitions.transition({
      fulfillmentId: fulfillment.id,
      targetStatus: 'in_transit',
      actor: { id: rider.id, type: 'RIDER' },
      reason: 's7h_in_transit',
    });
  }

  async function pendingTransferTo(incoming = riderB) {
    await assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: incoming.id,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 's7h_pending',
    });
  }

  it('denies anonymous issue/validate/confirm', async () => {
    await advanceToInTransit();
    await pendingTransferTo();
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/rider-handoffs/validate')
      .send({ qrPayload: 'x' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .send({ qrPayload: 'x' })
      .expect(401);
  });

  it('issue/validate/confirm auth matrix; outgoing cannot self-confirm', async () => {
    await advanceToInTransit();
    await pendingTransferTo(riderB);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(customer))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(merchantUser))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(riderB))
      .expect(403);

    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(riderA))
      .expect(201);
    expect(issued.body.qrPayload).toMatch(/^WKRR1\./);

    const preview = await request(app.getHttpServer())
      .post('/rider-handoffs/validate')
      .set(auth(riderB))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.preview).toBe(true);

    for (const actor of [riderA, riderC, customer, merchantUser]) {
      const denied = await request(app.getHttpServer())
        .post('/rider-handoffs/validate')
        .set(auth(actor))
        .send({ qrPayload: issued.body.qrPayload })
        .expect(201);
      expect(denied.body.ok).toBe(false);
    }

    const selfConfirm = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderA))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(selfConfirm.body.ok).toBe(false);
    expect(selfConfirm.body.code).toBe('WRONG_INCOMING_RIDER');

    const ok = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderB))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.activeRiderId).toBe(riderB.id);
  });

  it('consumed confirm re-checks incoming rider; authorized replay idempotent', async () => {
    await advanceToInTransit();
    await pendingTransferTo(riderB);
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(riderA))
      .expect(201);
    const idem = `s7h-idem-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderB))
      .send({
        qrPayload: issued.body.qrPayload,
        idempotencyKey: idem,
      })
      .expect(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.idempotent).toBeFalsy();
    const releaseId = first.body.releaseCustodyEventId;
    const receiptId = first.body.receiptCustodyEventId;

    const foreign = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderC))
      .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
      .expect(201);
    expect(foreign.body.ok).toBe(false);
    expect(foreign.body.code).toBe('WRONG_INCOMING_RIDER');

    for (const actor of [riderA, customer, merchantUser]) {
      const denied = await request(app.getHttpServer())
        .post('/rider-handoffs/confirm')
        .set(auth(actor))
        .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
        .expect(201);
      expect(denied.body.ok).toBe(false);
    }

    await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
      .expect(401);

    const replay = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderB))
      .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
      .expect(201);
    expect(replay.body.ok).toBe(true);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.releaseCustodyEventId).toBe(releaseId);
    expect(replay.body.receiptCustodyEventId).toBe(receiptId);

    expect(
      await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fulfillment.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        },
      }),
    ).toBe(1);
  });

  it('rejects consumed idempotency key with different capability payload', async () => {
    await advanceToInTransit();
    await pendingTransferTo(riderB);
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-handoffs`)
      .set(auth(riderA))
      .expect(201);
    const idem = `s7h-payload-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderB))
      .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
      .expect(201);

    const altered = await request(app.getHttpServer())
      .post('/rider-handoffs/confirm')
      .set(auth(riderB))
      .send({
        qrPayload: `${issued.body.qrPayload}altered`,
        idempotencyKey: idem,
      })
      .expect(201);
    expect(altered.body.ok).toBe(false);
    expect(altered.body.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('denies public generic custody transfer events without a secure handoff capability', async () => {
    await advanceToInTransit();
    await pendingTransferTo(riderB);

    await request(app.getHttpServer())
      .post('/custody-events')
      .set(auth(riderA))
      .send({
        eventType: 'RIDER_TRANSFER_RELEASED',
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        fromPartyRole: 'RIDER',
        toPartyRole: 'RIDER',
        fromUserId: riderA.id,
        toUserId: riderB.id,
      })
      .expect(403);

    expect(
      await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fulfillment.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RELEASED,
        },
      }),
    ).toBe(0);
  });
});
