/**
 * Stage 5A delivery handoff HTTP acceptance.
 * Requires backend/.env.stage5.test and database wekonnek_stage5_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage7_regression_test.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const STAGE5_ENV_PRESENT = loadStageTestEnv('.env.stage5.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  CustodyEventType,
  CustomerDeliveryHandoffTokenStatus,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
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

const describeIf = STAGE5_ENV_PRESENT ? describe : describe.skip;

jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage5_test',
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
]);

describeIf('Stage 5A Delivery Handoff HTTP (wekonnek_stage5_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignments: RiderAssignmentService;
  let transitions: FulfillmentTransitionService;
  let customer: any;
  let customerB: any;
  let riderA: any;
  let riderB: any;
  let merchantUser: any;
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
    await app.init();
    prisma = app.get(PrismaService);
    assignments = app.get(RiderAssignmentService);
    transitions = app.get(FulfillmentTransitionService);

    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    const database = target[0]?.database;
    const user = target[0]?.user;
    const okHistorical = database === 'wekonnek_stage5_test';
    const okRegression =
      isCurrentSchemaRegressionMode() &&
      database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE;
    if (
      (!okHistorical && !okRegression) ||
      !user ||
      FORBIDDEN_DB_USERS.has(user) ||
      !ALLOWED_DB_USERS.has(user)
    ) {
      throw new Error(
        `Stage 5 HTTP tests require wekonnek_stage5_test or stage7 regression identity; got database=${database} user=${user}`,
      );
    }
  });

  beforeEach(async () => {
    const tag = randomUUID();
    const user = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s5b-${tag}-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customer = await user(UserRole.customer);
    customerB = await user(UserRole.customer);
    riderA = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    merchantUser = await user(UserRole.merchant);
    merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S5B ${tag}`,
        slug: `s5b-${tag}`,
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
        orderCode: `WK-S5B-${tag.slice(0, 8)}`,
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
    const deliveryTokens = await prisma.customerDeliveryHandoffToken.findMany({
      where: { wkOrderId: order?.id },
    });
    const pickupTokens = await prisma.pickupHandoffToken.findMany({
      where: { wkOrderId: order?.id },
    });
    const custodyIds = [
      ...deliveryTokens.map((t) => t.custodyEventId),
      ...pickupTokens.map((t) => t.custodyEventId),
    ].filter(Boolean) as string[];
    await prisma.customerDeliveryHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.pickupHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    if (custodyIds.length) {
      await prisma.custodyEventEvidence.deleteMany({
        where: { custodyEventId: { in: custodyIds } },
      });
      await prisma.custodyEvent.deleteMany({
        where: { id: { in: custodyIds } },
      });
    }
    await prisma.custodyEvent.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.agreementEvidence.deleteMany({
      where: { wkOrderId: order?.id },
    });
    await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order?.id } });
    const ags = await prisma.agreement.findMany({
      where: { wkOrderId: order?.id },
    });
    for (const ag of ags) {
      await prisma.agreementAcceptance.deleteMany({
        where: { agreementVersion: { agreementId: ag.id } },
      });
      await prisma.agreementParty.deleteMany({
        where: { agreementId: ag.id },
      });
      await prisma.agreement.update({
        where: { id: ag.id },
        data: { currentVersionId: null },
      });
      await prisma.agreementVersion.deleteMany({
        where: { agreementId: ag.id },
      });
    }
    await prisma.agreement.deleteMany({ where: { wkOrderId: order?.id } });
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
            customerB?.id,
            riderA?.id,
            riderB?.id,
            merchantUser?.id,
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

  async function advanceToInTransit() {
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/pickup-token`)
      .set(auth(riderA))
      .expect(201);
    await request(app.getHttpServer())
      .post('/pickup-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201)
      .expect((r) => expect(r.body.ok).toBe(true));
    await transitions.transition({
      fulfillmentId: fulfillment.id,
      targetStatus: 'in_transit',
      actor: { id: riderA.id, type: 'RIDER' },
      reason: 's5b_http_in_transit',
    });
    fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.in_transit);
  }

  it('denies anonymous issuance and confirmation', async () => {
    await advanceToInTransit();
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/delivery-handoffs/validate')
      .send({ qrPayload: 'garbage' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .send({ qrPayload: 'garbage' })
      .expect(401);
  });

  it('enforces assigned-rider issuance; body riderId/customerId spoof ineffective', async () => {
    await advanceToInTransit();

    const spoof = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .send({ riderId: riderB.id, customerId: customerB.id })
      .expect(403);
    expect(JSON.stringify(spoof.body)).toMatch(/Rider identity|RIDER_SPOOF/i);

    await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderB))
      .expect(403);

    const good = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .send({ riderId: riderA.id, customerId: customerB.id })
      .expect(201);
    expect(good.body.tokenId).toBeTruthy();
    expect(good.body.qrPayload).toMatch(/^WKDH1\./);
    expect(good.body.otp).toBeTruthy();

    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: good.body.tokenId },
    });
    expect(token.deliveryRiderId).toBe(riderA.id);
    expect(token.customerId).toBe(customer.id);
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.ACTIVE);
  });

  it('denies confirm for anonymous/rider/merchant/foreign customer; owning customer ok', async () => {
    await advanceToInTransit();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);

    await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .send({ qrPayload: issued.body.qrPayload })
      .expect(401);

    for (const actor of [riderA, merchantUser, customerB]) {
      const denied = await request(app.getHttpServer())
        .post('/delivery-handoffs/confirm')
        .set(auth(actor))
        .send({ qrPayload: issued.body.qrPayload })
        .expect(201);
      expect(denied.body.ok).toBe(false);
      expect(denied.body.code).toMatch(/CUSTOMER_UNAUTHORIZED|TOKEN_/);
    }

    const ok = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.fulfillmentStatus).toBe('delivered');
  });

  it('QR success + OTP fallback success', async () => {
    await advanceToInTransit();
    const qrIssue = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);
    const qrConfirm = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ qrPayload: qrIssue.body.qrPayload })
      .expect(201);
    expect(qrConfirm.body.ok).toBe(true);

    // Second order path for OTP — reseed via fresh in_transit after delivered is terminal,
    // so create a sibling order on the same merchant/customer/rider.
    const tag = randomUUID();
    const order2 = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S5B-OTP-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderItems: {
          create: [
            { productName: 'item2', quantity: 1, price: 100, subtotal: 100 },
          ],
        },
      },
    });
    const f2 = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order2.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await assignments.assign({
      fulfillmentId: f2.id,
      riderId: riderA.id,
      actor: { type: 'SYSTEM' },
    });
    const pickupIssued = await request(app.getHttpServer())
      .post(`/orders/${order2.id}/pickup-token`)
      .set(auth(riderA))
      .expect(201);
    await request(app.getHttpServer())
      .post('/pickup-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: pickupIssued.body.qrPayload })
      .expect(201);
    await transitions.transition({
      fulfillmentId: f2.id,
      targetStatus: 'in_transit',
      actor: { id: riderA.id, type: 'RIDER' },
    });
    const otpIssue = await request(app.getHttpServer())
      .post(`/orders/${order2.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);
    const otpConfirm = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ otp: otpIssue.body.otp, orderId: order2.id })
      .expect(201);
    expect(otpConfirm.body.ok).toBe(true);

    // Cleanup sibling (afterEach covers primary order)
    const dTokens = await prisma.customerDeliveryHandoffToken.findMany({
      where: { wkOrderId: order2.id },
    });
    const pTokens = await prisma.pickupHandoffToken.findMany({
      where: { wkOrderId: order2.id },
    });
    const cIds = [
      ...dTokens.map((t) => t.custodyEventId),
      ...pTokens.map((t) => t.custodyEventId),
    ].filter(Boolean) as string[];
    await prisma.customerDeliveryHandoffToken.deleteMany({
      where: { wkOrderId: order2.id },
    });
    await prisma.pickupHandoffToken.deleteMany({
      where: { wkOrderId: order2.id },
    });
    if (cIds.length) {
      await prisma.custodyEvent.deleteMany({ where: { id: { in: cIds } } });
    }
    await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order2.id } });
    await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: order2.id } });
    await prisma.riderAssignment.deleteMany({ where: { fulfillmentId: f2.id } });
    await prisma.orderFulfillment.deleteMany({ where: { id: f2.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order2.id } });
    await prisma.wkOrder.deleteMany({ where: { id: order2.id } });
  });

  it('OTP wrong attempts → OTP_LOCKED after 5', async () => {
    await advanceToInTransit();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);

    let last: { body: { ok: boolean; code?: string } } | undefined;
    for (let i = 0; i < 5; i++) {
      last = await request(app.getHttpServer())
        .post('/delivery-handoffs/confirm')
        .set(auth(customer))
        .send({ otp: 'WRONGOTP1', orderId: order.id })
        .expect(201);
      expect(last.body.ok).toBe(false);
    }
    expect(last!.body.code).toBe('OTP_LOCKED');

    const locked = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ otp: issued.body.otp, orderId: order.id })
      .expect(201);
    expect(locked.body.ok).toBe(false);
    expect(locked.body.code).toBe('OTP_LOCKED');

    const row = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.body.tokenId },
    });
    expect(row.otpFailedAttempts).toBeGreaterThanOrEqual(5);
    expect(row.otpLockedUntil).toBeTruthy();
  });

  it('preview does not mutate token or fulfillment', async () => {
    await advanceToInTransit();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);

    const preview = await request(app.getHttpServer())
      .post('/delivery-handoffs/validate')
      .set(auth(customer))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.preview.orderCode).toBe(order.orderCode);
    expect(preview.body.preview.eligible).toBe(true);

    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.body.tokenId },
    });
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.ACTIVE);
    expect(token.consumedAt).toBeNull();
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.in_transit);
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(0);
  });

  it('confirm replay is idempotent (same custody)', async () => {
    await advanceToInTransit();
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/delivery-token`)
      .set(auth(riderA))
      .expect(201);

    const first = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.idempotent).toBeFalsy();

    const replay = await request(app.getHttpServer())
      .post('/delivery-handoffs/confirm')
      .set(auth(customer))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(replay.body.ok).toBe(true);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.custodyEventId).toBe(first.body.custodyEventId);

    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(1);
  });

  it('rider self-delivered via FulfillmentTransitionService is Forbidden (WkOrder path)', async () => {
    await advanceToInTransit();
    await expect(
      transitions.transition({
        fulfillmentId: fulfillment.id,
        targetStatus: 'delivered',
        actor: { id: riderA.id, type: 'RIDER' },
        reason: 'http_companion_rider_self_deliver',
      }),
    ).rejects.toThrow(/Forbidden|not allowed|delivered/i);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.in_transit);
  });
});

describeIf(
  'Stage 5A WebSocket bypass (orders_v2 tracking → delivered denied)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let assignments: RiderAssignmentService;
    let base: string;
    let customer: any;
    let riderA: any;
    let order: any;
    const sockets: Socket[] = [];
    const runtimeI18n = join(process.cwd(), 'i18n');
    const token = (u: any) =>
      sign(
        { sub: u.id, role: u.role },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '1h' },
      );
    const connect = (jwt?: string) =>
      new Promise<Socket>((resolvePromise, reject) => {
        const s = io(`${base}/tracking`, {
          auth: jwt ? { token: jwt } : {},
          transports: ['websocket'],
          reconnection: false,
        });
        sockets.push(s);
        const timer = setTimeout(() => {
          s.disconnect();
          reject(new Error('timeout'));
        }, 2000);
        s.once('connect', () => {
          clearTimeout(timer);
          resolvePromise(s);
        });
        s.once('connect_error', () => {
          clearTimeout(timer);
          reject(new Error('connect_error'));
        });
      });
    const event = (s: Socket, name: string, body: any) =>
      new Promise<any>((resolvePromise, reject) => {
        s.once('exception', reject);
        s.emit(name, body, (r: any) => resolvePromise(r));
        setTimeout(() => resolvePromise(undefined), 400);
      });

    beforeAll(async () => {
      if (!existsSync(runtimeI18n)) {
        mkdirSync(runtimeI18n, { recursive: true });
        cpSync(join(process.cwd(), 'src', 'i18n'), runtimeI18n, {
          recursive: true,
        });
      }
      const mod = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = mod.createNestApplication();
      await app.listen(0);
      prisma = app.get(PrismaService);
      assignments = app.get(RiderAssignmentService);
      const addr: any = app.getHttpServer().address();
      base = `http://127.0.0.1:${addr.port}`;

      const target = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
      const database = target[0]?.database;
      const user = target[0]?.user;
      const okHistorical = database === 'wekonnek_stage5_test';
      const okRegression =
        isCurrentSchemaRegressionMode() &&
        database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE;
      if (
        (!okHistorical && !okRegression) ||
        !user ||
        FORBIDDEN_DB_USERS.has(user) ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 5 WS tests require wekonnek_stage5_test or stage7 regression identity; got database=${database} user=${user}`,
        );
      }
    });

    beforeEach(async () => {
      const u = async (role: UserRole) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `${randomUUID()}@test.invalid`,
            role,
          },
        });
      customer = await u(UserRole.customer);
      riderA = await u(UserRole.rider);
      order = await prisma.order.create({
        data: {
          orderNumber: `S5WS-${randomUUID()}`,
          type: OrderType.express,
          status: OrderStatus.ready_for_pickup,
          customerId: customer.id,
          items: [],
          pickupAddress: {},
          deliveryAddress: {},
          paymentMethod: PaymentMethod.cash,
          paymentStatus: PaymentStatus.pending_payment,
        },
      });
      await assignments.assign({
        orderV2Id: order.id,
        riderId: riderA.id,
        actor: { type: 'SYSTEM_ADMIN' },
      });
      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { orderV2Id: order.id },
      });
      // Move to in_transit via allowed rider transitions (picked_up then in_transit)
      await prisma.orderFulfillment.update({
        where: { id: fulfillment.id },
        data: { status: FulfillmentStatus.in_transit },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.in_transit },
      });
    });

    afterEach(async () => {
      sockets.splice(0).forEach((s) => s.disconnect());
      if (order?.id) {
        await prisma.riderLocation.deleteMany({ where: { orderId: order.id } });
        await prisma.orderDomainEvent.deleteMany({
          where: { orderV2Id: order.id },
        });
        await prisma.riderAssignment.deleteMany({
          where: { orderV2Id: order.id },
        });
        await prisma.orderFulfillment.deleteMany({
          where: { orderV2Id: order.id },
        });
        await prisma.order.deleteMany({ where: { id: order.id } });
      }
      await prisma.user.deleteMany({
        where: {
          id: { in: [customer?.id, riderA?.id].filter(Boolean) },
        },
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('rejects rider socket delivered from in_transit (Stage 5A closure)', async () => {
      const rider = await connect(token(riderA));
      await expect(
        event(rider, 'order-status-update', {
          orderId: order.id,
          status: 'delivered',
        }),
      ).rejects.toBeDefined();
      const f = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { orderV2Id: order.id },
      });
      expect(f.status).toBe(FulfillmentStatus.in_transit);
    });
  },
);

describe('Stage 5A HTTP environment gate', () => {
  it('requires .env.stage5.test for database-backed acceptance', () => {
    expect(STAGE5_ENV_PRESENT).toBe(true);
  });
});
