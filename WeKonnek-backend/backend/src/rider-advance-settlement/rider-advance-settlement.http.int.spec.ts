/**
 * Stage 5B Rider Advance reimbursement settlement — HTTP acceptance.
 * Requires backend/.env.stage5b.test and database wekonnek_stage5b_test.
 */
import { config as loadEnv } from 'dotenv';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const STAGE5B_ENV = resolve(__dirname, '../../.env.stage5b.test');
const STAGE5B_ENV_PRESENT = existsSync(STAGE5B_ENV);

if (STAGE5B_ENV_PRESENT) {
  loadEnv({ path: STAGE5B_ENV, override: true });
}

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  Prisma,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { truncateSettlementsForStage5bTest } from './stage5b-test-cleanup';

const describeIf = STAGE5B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
]);
const ALLOWED_DATABASES = new Set([
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);

describeIf('Stage 5B Rider Advance Settlement HTTP (stage5b|stage6)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignments: RiderAssignmentService;
  let customer: any;
  let customerB: any;
  let riderA: any;
  let riderB: any;
  let merchantUser: any;
  let coordinator: any;
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

    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    const database = target[0]?.database;
    const user = target[0]?.user;
    if (
      !database ||
      !ALLOWED_DATABASES.has(database) ||
      !user ||
      FORBIDDEN_DB_USERS.has(user) ||
      !ALLOWED_DB_USERS.has(user)
    ) {
      throw new Error(
        `Stage 5B HTTP tests require wekonnek_stage5b_test|wekonnek_stage6_test identity; got database=${database} user=${user}`,
      );
    }
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
          email: `s5b-http-${tag}-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customer = await user(UserRole.customer);
    customerB = await user(UserRole.customer);
    riderA = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    merchantUser = await user(UserRole.merchant);
    coordinator = await user(UserRole.coordinator);
    merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S5B HTTP ${tag}`,
        slug: `s5b-http-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
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
        orderCode: `WK-S5BH-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1100,
        deliveryFee: 50,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 1100, subtotal: 1100 },
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
  });

  afterEach(async () => {
    if (!order?.id) return;
    // Append-only ledger: DELETE blocked. Disposable Stage 5B DB uses TRUNCATE.
    await truncateSettlementsForStage5bTest(prisma);
    await prisma.agreementEvidence.deleteMany({
      where: { wkOrderId: order.id },
    });
    await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order.id } });
    const ags = await prisma.agreement.findMany({
      where: { wkOrderId: order.id },
    });
    for (const ag of ags) {
      await prisma.agreementAcceptance.deleteMany({
        where: { agreementVersion: { agreementId: ag.id } },
      });
      await prisma.agreementParty.deleteMany({ where: { agreementId: ag.id } });
      await prisma.agreement.update({
        where: { id: ag.id },
        data: { currentVersionId: null },
      });
      await prisma.agreementVersion.deleteMany({
        where: { agreementId: ag.id },
      });
    }
    await prisma.agreement.deleteMany({ where: { wkOrderId: order.id } });
    await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: order.id } });
    await prisma.riderAssignment.deleteMany({
      where: { fulfillmentId: fulfillment.id },
    });
    await prisma.orderFulfillment.deleteMany({ where: { id: fulfillment.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.wkOrder.deleteMany({ where: { id: order.id } });
    await prisma.merchantPaymentMethod.deleteMany({
      where: { merchantId: merchant.id },
    });
    await prisma.merchant.deleteMany({ where: { id: merchant.id } });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            customer.id,
            customerB.id,
            riderA.id,
            riderB.id,
            merchantUser.id,
            coordinator.id,
          ],
        },
      },
    });
  });

  async function toDue(amount: number | string = 980) {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customer))
      .send({ maximumAuthorizedAdvance: 1100 })
      .expect(201);
    const id = created.body.riderAdvance.id;
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: amount })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: amount })
      .expect(201);
    return id;
  }

  it('reports DB identity wekonnek_stage5b_test|wekonnek_stage6_test', async () => {
    const row = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(ALLOWED_DATABASES.has(row[0].database)).toBe(true);
  });

  it('CUSTOMER own GET succeeds; foreign GET denied; anonymous denied', async () => {
    await toDue(980);
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .set(auth(customer))
      .expect(200)
      .expect((res) => {
        expect(res.body.principal).toBe('980.00');
        expect(res.body.remainingAmount).toBe('980.00');
        expect(res.body.creditor.id).toBe(riderA.id);
      });
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .set(auth(customerB))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .expect(401);
  });

  it('CUSTOMER DIRECT_TRANSFER claim succeeds; spoof fields ignored; remaining unchanged', async () => {
    const id = await toDue(980);
    const claim = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customer))
      .send({
        amount: 980,
        creditorRiderId: riderB.id,
        customerId: customerB.id,
        principal: 1,
        acknowledgedAmount: 980,
        externalReference: 'REF-1',
        idempotencyKey: `claim-${randomUUID()}`,
      })
      .expect(201);
    expect(claim.body.settlement.status).toBe('CLAIMED');
    expect(claim.body.remainingAmount).toBe('980.00');
    expect(claim.body.settledAmount).toBe('0.00');
    expect(claim.body.creditorRiderId).toBe(riderA.id);
  });

  it('foreign customer claim denied', async () => {
    const id = await toDue(980);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customerB))
      .send({ amount: 100, idempotencyKey: `claim-${randomUUID()}` })
      .expect(403);
  });

  it('CREDITOR A: GET, cash, ack, partial ack, reject', async () => {
    const id = await toDue(980);
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .set(auth(riderA))
      .expect(200);

    const cash = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 200, idempotencyKey: `cash-${randomUUID()}` })
      .expect(201);
    expect(cash.body.remainingAmount).toBe('780.00');

    const claim = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customer))
      .send({ amount: 500, idempotencyKey: `claim-${randomUUID()}` })
      .expect(201);

    const partial = await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim.body.settlement.id}/acknowledge`)
      .set(auth(riderA))
      .send({
        acknowledgedAmount: 300,
        idempotencyKey: `ack-${randomUUID()}`,
      })
      .expect(201);
    expect(partial.body.settlement.claimedAmount).toBe('500.00');
    expect(partial.body.settlement.acknowledgedAmount).toBe('300.00');
    expect(partial.body.remainingAmount).toBe('480.00');

    const claim2 = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customer))
      .send({ amount: 100, idempotencyKey: `claim2-${randomUUID()}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim2.body.settlement.id}/reject`)
      .set(auth(riderA))
      .send({ reason: 'not_received', idempotencyKey: `rej-${randomUUID()}` })
      .expect(201);
  });

  it('MERCHANT and COORDINATOR settlement mutations denied', async () => {
    const id = await toDue(980);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(merchantUser))
      .send({ amount: 100, idempotencyKey: `m-${randomUUID()}` })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(coordinator))
      .send({ amount: 100, idempotencyKey: `c-${randomUUID()}` })
      .expect(403);
  });

  it('invalid amounts: zero, negative, exceeds remaining', async () => {
    const id = await toDue(980);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 0, idempotencyKey: `z-${randomUUID()}` })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: -5, idempotencyKey: `n-${randomUUID()}` })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 2000, idempotencyKey: `x-${randomUUID()}` })
      .expect(400);
  });

  it('idempotency replay and conflict', async () => {
    const id = await toDue(980);
    const key = `cash-${randomUUID()}`;
    const a = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 100, idempotencyKey: key })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 100, idempotencyKey: key })
      .expect(201);
    expect(b.body.idempotent).toBe(true);
    expect(b.body.settlement.id).toBe(a.body.settlement.id);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 200, idempotencyKey: key })
      .expect(409);
  });

  it('claim already resolved on second ack', async () => {
    const id = await toDue(980);
    const claim = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customer))
      .send({ amount: 980, idempotencyKey: `claim-${randomUUID()}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim.body.settlement.id}/acknowledge`)
      .set(auth(riderA))
      .send({
        acknowledgedAmount: 980,
        idempotencyKey: `ack-${randomUUID()}`,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim.body.settlement.id}/acknowledge`)
      .set(auth(riderA))
      .send({
        acknowledgedAmount: 10,
        idempotencyKey: `ack2-${randomUUID()}`,
      })
      .expect(409);
  });

  it('wrong RA / settlement ids and enumeration denied', async () => {
    await toDue(980);
    const fakeRa = randomUUID();
    const fakeSettlement = randomUUID();
    await request(app.getHttpServer())
      .post(`/rider-advances/${fakeRa}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 10, idempotencyKey: `x-${randomUUID()}` })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${fakeSettlement}/acknowledge`)
      .set(auth(riderA))
      .send({
        acknowledgedAmount: 10,
        idempotencyKey: `x-${randomUUID()}`,
      })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/orders/${order.id + 99999}/rider-advance/reimbursement`)
      .set(auth(customer))
      .expect(404);
  });

  it('MANDATORY Rider A creditor / Rider B delivery HTTP separation', async () => {
    const beforeAlloc = await prisma.orderPaymentAllocation.count({
      where: { wkOrderId: order.id },
    });
    const id = await toDue(980);
    const summary = await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .set(auth(customer))
      .expect(200);
    expect(summary.body.principal).toBe('980.00');
    expect(summary.body.creditor.id).toBe(riderA.id);
    expect(summary.body.reimbursementStatus).toBe(
      RiderAdvanceStatus.REIMBURSEMENT_DUE,
    );

    await assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: riderB.id,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 'http_to_B',
    });
    const f = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    expect(f.activeRiderId).toBe(riderB.id);

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance/reimbursement`)
      .set(auth(riderB))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderB))
      .send({ amount: 100, idempotencyKey: `b-cash-${randomUUID()}` })
      .expect(403);

    const claim = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/reimbursements`)
      .set(auth(customer))
      .send({ amount: 980, idempotencyKey: `claim-${randomUUID()}` })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim.body.settlement.id}/acknowledge`)
      .set(auth(riderB))
      .send({
        acknowledgedAmount: 980,
        idempotencyKey: `b-ack-${randomUUID()}`,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/rider-advance-settlements/${claim.body.settlement.id}/reject`)
      .set(auth(riderB))
      .send({ reason: 'nope', idempotencyKey: `b-rej-${randomUUID()}` })
      .expect(403);

    const done = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 980, idempotencyKey: `a-cash-${randomUUID()}` })
      .expect(201);
    expect(done.body.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    expect(done.body.principal).toBe('980.00');
    expect(done.body.creditorRiderId).toBe(riderA.id);

    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.riderId).toBe(riderA.id);
    expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
    expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSED);

    expect(
      await prisma.orderPaymentAllocation.count({
        where: { wkOrderId: order.id },
      }),
    ).toBe(beforeAlloc);
  });

  it('concurrent final payment cannot over-settle via HTTP', async () => {
    const id = await toDue(980);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cash-receipts`)
      .set(auth(riderA))
      .send({ amount: 500, idempotencyKey: `pre-${randomUUID()}` })
      .expect(201);
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/rider-advances/${id}/cash-receipts`)
        .set(auth(riderA))
        .send({ amount: 480, idempotencyKey: `f1-${randomUUID()}` }),
      request(app.getHttpServer())
        .post(`/rider-advances/${id}/cash-receipts`)
        .set(auth(riderA))
        .send({ amount: 480, idempotencyKey: `f2-${randomUUID()}` }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain(201);
    expect(statuses[0] === 201 || statuses[1] === 201).toBe(true);
    const settled = await prisma.riderAdvanceSettlement.findMany({
      where: { riderAdvanceId: id, status: 'ACKNOWLEDGED' },
    });
    const sum = settled.reduce(
      (acc, s) => acc + Number(s.acknowledgedAmount?.toString() ?? 0),
      0,
    );
    expect(sum).toBeLessThanOrEqual(980);
  });
});
