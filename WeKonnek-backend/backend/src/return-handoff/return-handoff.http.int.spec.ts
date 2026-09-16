/**
 * Stage 6 secure merchant return handoff HTTP acceptance.
 * Requires backend/.env.stage6.test and database wekonnek_stage6_test.
 */
import { config as loadEnv } from 'dotenv';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const STAGE6_ENV = resolve(__dirname, '../../.env.stage6.test');
const STAGE6_ENV_PRESENT = existsSync(STAGE6_ENV);

if (STAGE6_ENV_PRESENT) {
  loadEnv({ path: STAGE6_ENV, override: true });
}

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  MerchantReturnHandoffTokenStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = STAGE6_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set(['victor', 'wekonnek_stage6_test']);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
]);

describeIf('Stage 6 Return Handoff HTTP (wekonnek_stage6_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignments: RiderAssignmentService;
  let transitions: FulfillmentTransitionService;
  let customer: any;
  let customerB: any;
  let riderA: any;
  let riderB: any;
  let riderC: any;
  let merchantUser: any;
  let foreignMerchantUser: any;
  let merchant: any;
  let foreignMerchant: any;
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

    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    const database = target[0]?.database;
    const user = target[0]?.user;
    if (
      database !== 'wekonnek_stage6_test' ||
      !user ||
      FORBIDDEN_DB_USERS.has(user) ||
      !ALLOWED_DB_USERS.has(user)
    ) {
      throw new Error(
        `Stage 6 HTTP tests require wekonnek_stage6_test identity; got database=${database} user=${user}`,
      );
    }
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const user = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s6h-${tag}-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customer = await user(UserRole.customer);
    customerB = await user(UserRole.customer);
    riderA = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    riderC = await user(UserRole.rider);
    merchantUser = await user(UserRole.merchant);
    foreignMerchantUser = await user(UserRole.merchant);
    merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S6H ${tag}`,
        slug: `s6h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: false,
      },
    });
    foreignMerchant = await prisma.merchant.create({
      data: {
        userId: foreignMerchantUser.id,
        name: `S6HF ${tag}`,
        slug: `s6hf-${tag}`,
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
        orderCode: `WK-S6H-${tag.slice(0, 8)}`,
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
      riderId: riderB.id,
      actor: { type: 'SYSTEM' },
    });
    fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
  });

  afterEach(async () => {
    await prisma.merchantReturnHandoffToken.deleteMany({
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
      where: { merchantId: { in: [merchant?.id, foreignMerchant?.id].filter(Boolean) } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchant?.id, foreignMerchant?.id].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            customer?.id,
            customerB?.id,
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

  async function advanceToReturning(rider = riderB) {
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
      reason: 's6h_in_transit',
    });
    await transitions.transition({
      fulfillmentId: fulfillment.id,
      targetStatus: 'delivery_failed',
      actor: { id: rider.id, type: 'RIDER' },
      reason: 's6h_failed',
    });
    await transitions.transition({
      fulfillmentId: fulfillment.id,
      targetStatus: 'returning',
      actor: { id: rider.id, type: 'RIDER' },
      reason: 's6h_returning',
    });
    fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.returning);
  }

  it('denies anonymous issue/validate/confirm', async () => {
    await advanceToReturning();
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/return-handoffs/validate')
      .send({ qrPayload: 'x' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .send({ qrPayload: 'x' })
      .expect(401);
  });

  it('rider issue success; customer/merchant/wrong rider denied', async () => {
    await advanceToReturning();
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(customer))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(merchantUser))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderC))
      .expect(403);
    const good = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);
    expect(good.body.qrPayload).toMatch(/^WKRH1\./);
    expect(good.body.otp).toBeTruthy();
  });

  it('merchant validate/confirm success; wrong merchant/rider/customer denied', async () => {
    await advanceToReturning();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);

    const preview = await request(app.getHttpServer())
      .post('/return-handoffs/validate')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.preview).toBe(true);

    const wrongM = await request(app.getHttpServer())
      .post('/return-handoffs/validate')
      .set(auth(foreignMerchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(wrongM.body.ok).toBe(false);
    expect(wrongM.body.code).toBe('WRONG_MERCHANT');

    for (const actor of [riderB, customer, customerB]) {
      const denied = await request(app.getHttpServer())
        .post('/return-handoffs/confirm')
        .set(auth(actor))
        .send({ qrPayload: issued.body.qrPayload })
        .expect(201);
      expect(denied.body.ok).toBe(false);
    }

    const ok = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({
        qrPayload: issued.body.qrPayload,
        correlationId: 's6h-confirm',
      })
      .expect(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.fulfillmentStatus).toBe('returned');

    const token = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
      where: { id: issued.body.tokenId },
    });
    expect(token.status).toBe(MerchantReturnHandoffTokenStatus.CONSUMED);
    const custody = await prisma.custodyEvent.findFirst({
      where: {
        fulfillmentId: fulfillment.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
      },
    });
    expect(custody).toBeTruthy();
  });

  it('keeps OTP validation preview read-only, including failed attempts', async () => {
    await advanceToReturning();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);
    const before = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
      where: { id: issued.body.tokenId },
    });

    const preview = await request(app.getHttpServer())
      .post('/return-handoffs/validate')
      .set(auth(merchantUser))
      .send({ orderId: order.id, otp: 'NOTTHEOTP' })
      .expect(201);
    expect(preview.body.ok).toBe(false);

    const after = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
      where: { id: issued.body.tokenId },
    });
    expect(after.otpFailedAttempts).toBe(before.otpFailedAttempts);
    expect(after.otpLockedUntil).toEqual(before.otpLockedUntil);
  });

  it('denies rider REST self-return and direct RETURN_RECEIVED', async () => {
    await advanceToReturning();
    await expect(
      transitions.transition({
        fulfillmentId: fulfillment.id,
        targetStatus: 'returned',
        actor: { id: riderB.id, type: 'RIDER' },
        reason: 'self_return',
      }),
    ).rejects.toBeDefined();

    await request(app.getHttpServer())
      .post('/custody-events')
      .set(auth(riderB))
      .send({
        eventType: 'RETURN_RECEIVED',
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
      })
      .expect(403);
  });

  it('denies rider WebSocket self-return to returned (canonical transition)', async () => {
    // Tracking gateway is Order V2–scoped; create a parallel V2 fulfillment in returning.
    const v2 = await prisma.order.create({
      data: {
        orderNumber: `S6WS-${randomUUID()}`,
        type: 'express',
        status: 'returning',
        customerId: customer.id,
        items: [],
        pickupAddress: {},
        deliveryAddress: {},
        paymentMethod: 'cash',
        paymentStatus: 'pending_payment',
      },
    });
    const f2 = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        orderV2Id: v2.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.returning,
        activeRiderId: riderB.id,
        assignmentVersion: 1,
      },
    });
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: f2.id,
        orderV2Id: v2.id,
        riderId: riderB.id,
        status: 'ACTIVE',
        assignmentVersion: 1,
      },
    });

    const addr = app.getHttpServer().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const jwt = sign(
      { sub: riderB.id, role: riderB.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    );
    const socket: Socket = io(`http://127.0.0.1:${port}/tracking`, {
      auth: { token: jwt },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (e) => reject(e));
      setTimeout(() => reject(new Error('socket connect timeout')), 10000);
    });
    await new Promise<void>((resolve) => {
      socket.once('exception', () => resolve());
      socket.emit('order-status-update', {
        orderId: v2.id,
        status: 'returned',
      });
      setTimeout(() => resolve(), 800);
    });
    socket.close();

    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: f2.id },
    });
    expect(after.status).toBe(FulfillmentStatus.returning);

    await prisma.riderAssignment.deleteMany({ where: { fulfillmentId: f2.id } });
    await prisma.orderDomainEvent.deleteMany({ where: { orderV2Id: v2.id } });
    await prisma.orderFulfillment.deleteMany({ where: { id: f2.id } });
    await prisma.order.deleteMany({ where: { id: v2.id } });
  });

  it('operational-state auth + privacy for own merchant/customer; foreign denied', async () => {
    await advanceToReturning();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);
    await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);

    const own = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .set(auth(customer))
      .expect(200);
    expect(own.body.operationalState).toBe('EXCEPTION');
    expect(own.body.physicalStatus).toBe('returned');

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .set(auth(customerB))
      .expect(403);

    const merchantView = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .set(auth(merchantUser))
      .expect(200);
    expect(merchantView.body.operationalState).toBe('EXCEPTION');

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .set(auth(foreignMerchantUser))
      .expect(403);
  });

  it('admin recovery for returned requires reason + correlationId', async () => {
    await advanceToReturning();
    const admin = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s6h-admin-${randomUUID()}@test.invalid`,
        role: UserRole.admin,
      },
    });
    try {
      await expect(
        transitions.transition({
          fulfillmentId: fulfillment.id,
          targetStatus: 'returned',
          actor: { id: admin.id, type: 'SYSTEM_ADMIN' },
        }),
      ).rejects.toBeDefined();
      const ok = await transitions.transition({
        fulfillmentId: fulfillment.id,
        targetStatus: 'returned',
        actor: { id: admin.id, type: 'SYSTEM_ADMIN' },
        reason: 'manual_secure_return_bypass',
        correlationId: 's6h-admin-bypass',
      });
      expect(ok.fulfillment.status).toBe(FulfillmentStatus.returned);
    } finally {
      await prisma.user.deleteMany({ where: { id: admin.id } });
    }
  });

  it('denies public RETURN_RECEIVED forge via secureReturnHandoffAuthorized for rider/merchant/customer', async () => {
    await advanceToReturning();
    const beforeCustody = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fulfillment.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
      },
    });
    for (const actor of [riderB, merchantUser, customer]) {
      for (const payload of [
        {
          eventType: 'RETURN_RECEIVED',
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          secureReturnHandoffAuthorized: true,
        },
        {
          eventType: 'RETURN_RECEIVED',
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          secureReturnHandoffAuthorized: 'true',
          metadata: { secureReturnHandoffAuthorized: true },
        },
        {
          eventType: 'RETURN_RECEIVED',
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          trustedSecureMerchantReturn: true,
        },
      ]) {
        await request(app.getHttpServer())
          .post('/custody-events')
          .set(auth(actor))
          .send(payload)
          .expect(403);
      }
    }
    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(after.status).toBe(FulfillmentStatus.returning);
    const afterCustody = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fulfillment.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
      },
    });
    expect(afterCustody).toBe(beforeCustody);
  });

  it('consumed confirm re-checks merchant authority; same merchant idempotent', async () => {
    await advanceToReturning();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);
    const idem = `s6-idem-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({
        qrPayload: issued.body.qrPayload,
        correlationId: 's6h-first',
        idempotencyKey: idem,
      })
      .expect(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.idempotent).toBeFalsy();
    const firstCustodyId = first.body.custodyEventId;
    const firstFulfillmentId = first.body.fulfillmentId;

    const foreign = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(foreignMerchantUser))
      .send({
        qrPayload: issued.body.qrPayload,
        idempotencyKey: idem,
      })
      .expect(201);
    expect(foreign.body.ok).toBe(false);
    expect(foreign.body.code).toBe('WRONG_MERCHANT');
    expect(foreign.body.custodyEventId).toBeUndefined();
    expect(foreign.body.fulfillmentId).toBeUndefined();
    expect(foreign.body.wkOrderId).toBeUndefined();
    expect(foreign.body.tokenId).toBeUndefined();

    for (const actor of [riderB, customer, customerB]) {
      const denied = await request(app.getHttpServer())
        .post('/return-handoffs/confirm')
        .set(auth(actor))
        .send({
          qrPayload: issued.body.qrPayload,
          idempotencyKey: idem,
        })
        .expect(201);
      expect(denied.body.ok).toBe(false);
      expect(denied.body.custodyEventId).toBeUndefined();
      expect(denied.body.fulfillmentId).toBeUndefined();
    }

    await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .send({
        qrPayload: issued.body.qrPayload,
        idempotencyKey: idem,
      })
      .expect(401);

    const replay = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({
        qrPayload: issued.body.qrPayload,
        idempotencyKey: idem,
      })
      .expect(201);
    expect(replay.body.ok).toBe(true);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.custodyEventId).toBe(firstCustodyId);
    expect(replay.body.fulfillmentId).toBe(firstFulfillmentId);
    expect(replay.body.fulfillmentStatus).toBe('returned');

    expect(
      await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fulfillment.id,
          eventType: CustodyEventType.RETURN_RECEIVED,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          fulfillmentId: fulfillment.id,
          action: 'RETURN_HANDOFF_CONFIRMED',
        },
      }),
    ).toBe(1);
  });

  it('rejects reuse of a consumed idempotency key with materially different capability payload', async () => {
    await advanceToReturning();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/return-token`)
      .set(auth(riderB))
      .expect(201);
    const idem = `s6-payload-bound-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload, idempotencyKey: idem })
      .expect(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.idempotent).toBe(false);

    // A cached success must never mask a changed (and invalid) capability.
    const altered = await request(app.getHttpServer())
      .post('/return-handoffs/confirm')
      .set(auth(merchantUser))
      .send({
        qrPayload: `${issued.body.qrPayload}altered`,
        idempotencyKey: idem,
      })
      .expect(201);
    expect(altered.body.ok).toBe(false);
    expect(altered.body.code).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('operational-state HTTP: assigned rider limited; anonymous/foreign denied', async () => {
    await advanceToReturning();
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .expect(401);

    const riderView = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operational-state`)
      .set(auth(riderB))
      .expect(200);
    expect(riderView.body.operationalState).toBe('EXCEPTION');
    expect(riderView.body.reimbursement).toBeUndefined();
    expect(riderView.body.merchantPaymentStatus).toBeUndefined();

    await request(app.getHttpServer())
      .get(`/orders/${999999001}/operational-state`)
      .set(auth(customer))
      .expect((res) => {
        // Enumeration-safe: missing order must not leak as authorized 200.
        expect([403, 404]).toContain(res.status);
      });

    const coordinator = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s6h-coord-${randomUUID()}@test.invalid`,
        role: UserRole.coordinator,
      },
    });
    try {
      await request(app.getHttpServer())
        .get(`/orders/${order.id}/operational-state`)
        .set(auth(coordinator))
        .expect(403);
    } finally {
      await prisma.user.deleteMany({ where: { id: coordinator.id } });
    }
  });
});
