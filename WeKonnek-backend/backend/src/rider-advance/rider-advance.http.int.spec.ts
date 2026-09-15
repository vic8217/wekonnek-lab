import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  CommerceDomain,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  UserRole,
} from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';

describe('Stage 4B Rider Advance HTTP smoke', () => {
  let app: INestApplication,
    prisma: PrismaService,
    assignments: RiderAssignmentService;
  let customerA: any,
    customerB: any,
    riderA: any,
    riderB: any,
    merchantUser: any,
    merchantBUser: any,
    coordinator: any,
    merchant: any,
    merchantB: any,
    order: any,
    fulfillment: any;
  const runtimeI18n = join(process.cwd(), 'i18n'),
    sourceI18n = join(process.cwd(), 'src', 'i18n');
  const auth = (user: any) => ({
    Authorization: `Bearer ${sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '1h' })}`,
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
  });
  beforeEach(async () => {
    const user = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `${randomUUID()}@test.invalid`,
          role,
        },
      });
    customerA = await user(UserRole.customer);
    customerB = await user(UserRole.customer);
    riderA = await user(UserRole.rider);
    riderB = await user(UserRole.rider);
    merchantUser = await user(UserRole.merchant);
    merchantBUser = await user(UserRole.merchant);
    coordinator = await user(UserRole.coordinator);
    merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `RA ${randomUUID()}`,
        slug: `ra-${randomUUID()}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    merchantB = await prisma.merchant.create({
      data: {
        userId: merchantBUser.id,
        name: `RB ${randomUUID()}`,
        slug: `rb-${randomUUID()}`,
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
      },
    });
    order = await prisma.wkOrder.create({
      data: {
        orderCode: `RA-${randomUUID()}`,
        userId: customerA.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1100,
        deliveryFee: 0,
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
        customerId: customerA.id,
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
    const pickupTokens = await prisma.pickupHandoffToken.findMany({
      where: { wkOrderId: order?.id },
      select: { custodyEventId: true },
    });
    await prisma.pickupHandoffToken.deleteMany({
      where: { wkOrderId: order?.id },
    });
    const custodyIds = pickupTokens.flatMap((token) =>
      token.custodyEventId ? [token.custodyEventId] : [],
    );
    if (custodyIds.length) {
      await prisma.custodyEvent.deleteMany({
        where: { id: { in: custodyIds } },
      });
    }
    const advances = await prisma.riderAdvance.findMany({
      where: { wkOrderId: order?.id },
    });
    for (const advance of advances) {
      await prisma.agreementEvidence.deleteMany({
        where: { agreementId: advance.agreementId },
      });
      await prisma.agreementAcceptance.deleteMany({
        where: { agreementVersion: { agreementId: advance.agreementId } },
      });
      await prisma.agreementParty.deleteMany({
        where: { agreementId: advance.agreementId },
      });
      await prisma.agreement.update({
        where: { id: advance.agreementId },
        data: { currentVersionId: null },
      });
      await prisma.riderAdvance.delete({ where: { id: advance.id } });
      await prisma.agreementVersion.deleteMany({
        where: { agreementId: advance.agreementId },
      });
      await prisma.agreement.delete({ where: { id: advance.agreementId } });
    }
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
      where: {
        merchantId: { in: [merchant?.id, merchantB?.id].filter(Boolean) },
      },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [merchant?.id, merchantB?.id].filter(Boolean) } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            customerA?.id,
            customerB?.id,
            riderA?.id,
            riderB?.id,
            merchantUser?.id,
            merchantBUser?.id,
            coordinator?.id,
          ].filter(Boolean),
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (existsSync(runtimeI18n))
      rmSync(runtimeI18n, { recursive: true, force: true });
  });
  it('rejects anonymous authorization', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .send({ maximumAuthorizedAdvance: '1100.00' })
      .expect(401);
  });
  it('authorizes only the owning customer with server-derived parties and maximum', async () => {
    const res = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({
        maximumAuthorizedAdvance: '1100.00',
        customerId: customerB.id,
        riderId: customerB.id,
      })
      .expect(201);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: res.body.riderAdvance.id },
    });
    expect(ra.customerId).toBe(customerA.id);
    expect(ra.riderId).toBe(riderA.id);
    expect(ra.authorizedMaximumAmount.toString()).toBe('1100');
    expect(ra.actualAdvanceAmount).toBeNull();
    expect(ra.reimbursementPrincipal).toBeNull();
  });
  it('denies a foreign customer without a second authorization', async () => {
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerB))
      .send({ maximumAuthorizedAdvance: 1100 })
      .expect(403);
    expect(
      await prisma.riderAdvance.count({ where: { wkOrderId: order.id } }),
    ).toBe(0);
  });
  it('allows the current assigned rider to accept the HTTP-authorized advance', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: 1100 })
      .expect(201);
    const accepted = await request(app.getHttpServer())
      .post(`/rider-advances/${created.body.riderAdvance.id}/accept`)
      .set(auth(riderA))
      .send({ idempotencyKey: `accept-${randomUUID()}` })
      .expect(201);
    expect(accepted.body.riderAdvance.status).toBe('RIDER_ACCEPTED');
    expect(
      (
        await prisma.riderAdvance.findUniqueOrThrow({
          where: { id: created.body.riderAdvance.id },
        })
      ).riderAcceptedAt,
    ).toBeTruthy();
  });
  it('enforces persisted merchant eligibility rather than request-body claims', async () => {
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { allowRiderAdvance: false },
    });
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({
        maximumAuthorizedAdvance: 1000,
        allowRiderAdvance: true,
        paymentMethod: 'cash',
      })
      .expect(400);
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { allowRiderAdvance: true },
    });
    await prisma.merchantPaymentMethod.updateMany({
      where: { merchantId: merchant.id },
      data: { enabled: false },
    });
    await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: 1000, merchantEligibility: true })
      .expect(400);
  });
  it('creates reimbursement debt from exact acknowledged actual, never the maximum', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1100.00' })
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
      .send({
        actualAdvanceAmount: '980.00',
        idempotencyKey: `record-${randomUUID()}`,
      })
      .expect(201);
    const ack = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({
        acknowledgedAmount: '980.00',
        idempotencyKey: `ack-${randomUUID()}`,
      })
      .expect(201);
    expect(ack.body.riderAdvance.reimbursementPrincipal).toBe('980');
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.reimbursementPrincipal?.toString()).toBe('980');
    expect(persisted.reimbursementPrincipal?.toString()).not.toBe('1100');
  });
  it('records an amount below the inclusive customer ceiling without creating debt', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1000.00' })
      .expect(201);
    const id = created.body.riderAdvance.id;
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    const recorded = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: '999.99' })
      .expect(201);
    expect(recorded.body.riderAdvance.actualAdvanceAmount).toBe('999.99');
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.vendorAcknowledgedAmount).toBeNull();
    expect(persisted.reimbursementPrincipal).toBeNull();
  });
  it('includes the exact customer ceiling without creating debt', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1000.00' })
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
      .send({ actualAdvanceAmount: '1000.00' })
      .expect(201);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.actualAdvanceAmount?.toString()).toBe('1000');
    expect(persisted.vendorAcknowledgedAmount).toBeNull();
    expect(persisted.reimbursementPrincipal).toBeNull();
  });
  const assertRejectedOverage = async (amount: string) => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1000.00' })
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
      .expect(400);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.status).toBe('RIDER_ACCEPTED');
    expect(persisted.actualAdvanceAmount).toBeNull();
    expect(persisted.vendorAcknowledgedAmount).toBeNull();
    expect(persisted.reimbursementPrincipal).toBeNull();
    expect(
      await prisma.agreementEvidence.count({
        where: {
          agreementId: persisted.agreementId,
          evidenceType: 'PAYMENT_PROOF',
        },
      }),
    ).toBe(0);
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          wkOrderId: order.id,
          action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
        },
      }),
    ).toBe(0);
    expect(
      (await prisma.wkOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .paymentStatus,
    ).toBe('pending');
  };
  it('rejects the 1000.00 to 1000.01 rounding edge with zero financial side effects', async () => {
    await assertRejectedOverage('1000.01');
  });
  it('rejects the 1000.00 to 5000.00 material overage with zero financial side effects', async () => {
    await assertRejectedOverage('5000.00');
  });
  it('makes a same-key same-payload record retry idempotent without duplicate evidence', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1100.00' })
      .expect(201);
    const id = created.body.riderAdvance.id,
      key = 'RECORD-IDEM-1';
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: '980.00', idempotencyKey: key })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: '980.00', idempotencyKey: key })
      .expect(201);
    expect(retry.body.idempotent).toBe(true);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.actualAdvanceAmount?.toString()).toBe('980');
    expect(persisted.reimbursementPrincipal).toBeNull();
    expect(
      await prisma.agreementEvidence.count({
        where: {
          agreementId: persisted.agreementId,
          evidenceType: 'PAYMENT_PROOF',
        },
      }),
    ).toBe(1);
  });
  it('rejects a same-key different-payload record retry without changing the original', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1100.00' })
      .expect(201);
    const id = created.body.riderAdvance.id,
      key = 'RECORD-IDEM-2';
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: '980.00', idempotencyKey: key })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: '990.00', idempotencyKey: key })
      .expect(409);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.actualAdvanceAmount?.toString()).toBe('980');
    expect(persisted.reimbursementPrincipal).toBeNull();
    expect(
      await prisma.agreementEvidence.count({
        where: {
          agreementId: persisted.agreementId,
          evidenceType: 'PAYMENT_PROOF',
        },
      }),
    ).toBe(1);
  });
  it('records lower merchant evidence as a dispute, not customer debt', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1100.00' })
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
      .send({ actualAdvanceAmount: '980.00' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: '950.00' })
      .expect(201);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.status).toBe('DISPUTED');
    expect(persisted.actualAdvanceAmount?.toString()).toBe('980');
    expect(persisted.vendorAcknowledgedAmount?.toString()).toBe('950');
    expect(persisted.reimbursementPrincipal).toBeNull();
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          wkOrderId: order.id,
          action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
        },
      }),
    ).toBe(0);
  });
  it('records higher merchant evidence as a dispute, not customer debt', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: '1100.00' })
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
      .send({ actualAdvanceAmount: '980.00' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: '1050.00' })
      .expect(201);
    const persisted = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(persisted.status).toBe('DISPUTED');
    expect(persisted.actualAdvanceAmount?.toString()).toBe('980');
    expect(persisted.vendorAcknowledgedAmount?.toString()).toBe('1050');
    expect(persisted.reimbursementPrincipal).toBeNull();
    expect(persisted.reimbursementPrincipal?.toString()).not.toBe('980');
    expect(persisted.reimbursementPrincipal?.toString()).not.toBe('1050');
    expect(persisted.reimbursementPrincipal?.toString()).not.toBe('1100');
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          wkOrderId: order.id,
          action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
        },
      }),
    ).toBe(0);
  });
  const authorizeAccept = async (maximum = '1100.00') => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: maximum })
      .expect(201);
    const id = created.body.riderAdvance.id;
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    return id;
  };
  const reassign = () =>
    assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: riderB.id,
      allowReassignment: true,
      actor: { type: 'SYSTEM' },
    });
  it('denies new expenditure to both actors after reassignment and preserves historical rider identity', async () => {
    const id = await authorizeAccept();
    await reassign();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderB))
      .send({ actualAdvanceAmount: 980 })
      .expect(403);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.status).toBe('CANCELLED');
    expect(ra.riderId).toBe(riderA.id);
    expect(ra.actualAdvanceAmount).toBeNull();
  });
  it('turns a reassigned recorded claim into a preserved dispute, never Rider B debt', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    await reassign();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980 })
      .expect(400);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.status).toBe('DISPUTED');
    expect(ra.actualAdvanceAmount?.toString()).toBe('980');
    expect(ra.riderId).toBe(riderA.id);
    expect(ra.reimbursementPrincipal).toBeNull();
  });
  it('permits only the customer to amend and appends a new immutable agreement version', async () => {
    const id = await authorizeAccept('1000.00');
    const first = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    const v1 = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: first.agreementVersionId },
    });
    for (const actor of [customerB, riderA, merchantUser])
      await request(app.getHttpServer())
        .post(`/rider-advances/${id}/amend`)
        .set(auth(actor))
        .send({ maximumAuthorizedAdvance: 1200, customerId: customerA.id })
        .expect(403);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/amend`)
      .send({ maximumAuthorizedAdvance: 1200 })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/amend`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: 1200, riderId: riderB.id })
      .expect(201);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    const old = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: v1.id },
    });
    const v2 = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: ra.agreementVersionId },
    });
    expect(old.termsHash).toBe(v1.termsHash);
    expect(v2.versionNumber).toBe(2);
    expect(v2.supersedesVersionId).toBe(v1.id);
    expect(ra.status).toBe('CUSTOMER_AUTHORIZED');
  });
  it('requires re-acceptance and uses the amended lower ceiling instead of stale mobile state', async () => {
    const id = await authorizeAccept('1100.00');
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/amend`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: 900 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 950, assignmentVersion: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 950 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 900 })
      .expect(201);
  });
  it('enforces merchant-only acknowledgment and rejects acknowledgment before a rider claim', async () => {
    const id = await authorizeAccept();
    for (const actor of [merchantBUser, customerA, riderA, coordinator])
      await request(app.getHttpServer())
        .post(`/rider-advances/${id}/vendor-acknowledgment`)
        .set(auth(actor))
        .send({ acknowledgedAmount: 980 })
        .expect(403);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980 })
      .expect(400);
    let ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.actualAdvanceAmount).toBeNull();
    expect(ra.reimbursementPrincipal).toBeNull();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(riderA))
      .send({ acknowledgedAmount: 980 })
      .expect(403);
    ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.vendorAcknowledgedAmount).toBeNull();
  });
  it('makes acknowledgment idempotent and rejects a changed-payload retry without duplicate debt', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    const key = 'ACK-IDEM-2';
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980, idempotencyKey: key })
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980, idempotencyKey: key })
      .expect(201);
    expect(retry.body.idempotent).toBe(true);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 990, idempotencyKey: key })
      .expect(409);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.reimbursementPrincipal?.toString()).toBe('980');
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          wkOrderId: order.id,
          action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
        },
      }),
    ).toBe(1);
  });
  it('allows an active staff member of the owning merchant to acknowledge', async () => {
    const staff = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `${randomUUID()}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    await prisma.merchantStaff.create({
      data: { merchantId: merchant.id, userId: staff.id },
    });
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(staff))
      .send({ acknowledgedAmount: 980 })
      .expect(201);
    await prisma.user.delete({ where: { id: staff.id } });
  });
  it('ignores injected financial and party fields on every actor endpoint', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({
        maximumAuthorizedAdvance: 1000,
        actualAdvanceAmount: 999,
        reimbursementPrincipal: 999,
        status: 'REIMBURSED',
        riderId: riderB.id,
        merchantId: merchantB.id,
        assignmentVersion: 9,
        convenienceFeeAmount: 1,
      })
      .expect(201);
    const id = created.body.riderAdvance.id;
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({
        reimbursementPrincipal: 999,
        merchantId: merchantB.id,
        customerId: customerB.id,
        status: 'REIMBURSED',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({
        actualAdvanceAmount: 980,
        authorizedMaximumAmount: 1,
        reimbursementPrincipal: 1,
        vendorAcknowledgedAmount: 1,
        customerId: customerB.id,
        status: 'REIMBURSED',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({
        acknowledgedAmount: 980,
        actualAdvanceAmount: 1,
        authorizedMaximumAmount: 1,
        reimbursementPrincipal: 1,
        riderId: riderB.id,
        customerId: customerB.id,
        status: 'REIMBURSED',
      })
      .expect(201);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.riderId).toBe(riderA.id);
    expect(ra.customerId).toBe(customerA.id);
    expect(ra.merchantId).toBe(merchant.id);
    expect(ra.reimbursementPrincipal?.toString()).toBe('980');
  });
  it('does not throw HTTP 500 for omitted or empty accept bodies', async () => {
    const created = await request(app.getHttpServer())
      .post(`/orders/${order.id}/rider-advance/authorize`)
      .set(auth(customerA))
      .send({ maximumAuthorizedAdvance: 1000 })
      .expect(201);
    const id = created.body.riderAdvance.id;
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/accept`)
      .set(auth(riderA))
      .send({})
      .expect(201);
  });
  it('cancels only before expenditure and denies every unauthorized cancellation actor', async () => {
    const id = await authorizeAccept();
    for (const actor of [customerB, riderA, merchantUser]) {
      await request(app.getHttpServer())
        .post(`/rider-advances/${id}/cancel`)
        .set(auth(actor))
        .send({ reason: 'attack' })
        .expect(403);
    }
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cancel`)
      .send({ reason: 'attack' })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cancel`)
      .set(auth(customerA))
      .send({ reason: 'customer_cancelled' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(400);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.status).toBe('CANCELLED');
    expect(ra.actualAdvanceAmount).toBeNull();
    expect(ra.vendorAcknowledgedAmount).toBeNull();
    expect(ra.reimbursementPrincipal).toBeNull();
  });
  it('preserves claim, evidence, and acceptance history when cancelled after expenditure', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    const before = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    const acceptances = await prisma.agreementAcceptance.count({
      where: { agreementVersionId: before.agreementVersionId },
    });
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cancel`)
      .set(auth(customerA))
      .send({})
      .expect(201);
    const after = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id },
    });
    expect(after.status).toBe('DISPUTED');
    expect(after.actualAdvanceAmount?.toString()).toBe('980');
    expect(after.reimbursementPrincipal).toBeNull();
    expect(
      await prisma.agreementAcceptance.count({
        where: { agreementVersionId: before.agreementVersionId },
      }),
    ).toBe(acceptances);
    expect(
      await prisma.agreementEvidence.count({
        where: {
          agreementId: before.agreementId,
          evidenceType: 'PAYMENT_PROOF',
        },
      }),
    ).toBe(1);
  });
  it('preserves established reimbursement debt when cancelled after matching merchant acknowledgment', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/cancel`)
      .set(auth(customerA))
      .send({})
      .expect(201);
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.status).toBe('DISPUTED');
    expect(ra.actualAdvanceAmount?.toString()).toBe('980');
    expect(ra.vendorAcknowledgedAmount?.toString()).toBe('980');
    expect(ra.reimbursementPrincipal?.toString()).toBe('980');
  });
  it('keeps Rider Advance reads private and does not disclose guessed identifiers', async () => {
    await authorizeAccept();
    for (const actor of [customerA, riderA, merchantUser]) {
      await request(app.getHttpServer())
        .get(`/orders/${order.id}/rider-advance`)
        .set(auth(actor))
        .expect(200);
    }
    for (const actor of [customerB, riderB, merchantBUser, coordinator]) {
      await request(app.getHttpServer())
        .get(`/orders/${order.id}/rider-advance`)
        .set(auth(actor))
        .expect(403);
    }
    await request(app.getHttpServer())
      .get(`/orders/${order.id}/rider-advance`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders/999999999/rider-advance')
      .set(auth(customerB))
      .expect(404);
  });
  it('blocks the externally reachable generic agreement amendment bypass', async () => {
    const id = await authorizeAccept();
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    const response = await request(app.getHttpServer())
      .post(`/agreements/${ra.agreementId}/amendments`)
      .set(auth(customerA))
      .send({ reason: 'bypass' })
      .expect(400);
    expect(JSON.stringify(response.body)).toContain(
      'RIDER_ADVANCE_CONTROLLED_PATH_REQUIRED',
    );
  });
  it('denies pickup before merchant acknowledgment without consuming the token or changing financial state', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    const issued = await request(app.getHttpServer())
      .post(`/orders/${order.id}/pickup-token`)
      .set(auth(riderA))
      .expect(201);
    const denied = await request(app.getHttpServer())
      .post('/pickup-handoffs/confirm')
      .set(auth(merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(denied.body).toMatchObject({
      ok: false,
      code: 'RIDER_ADVANCE_VENDOR_ACK_REQUIRED',
    });
    expect(
      (
        await prisma.pickupHandoffToken.findUniqueOrThrow({
          where: { id: issued.body.tokenId },
        })
      ).status,
    ).toBe('ACTIVE');
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        })
      ).status,
    ).toBe('rider_assigned');
    expect(
      (await prisma.riderAdvance.findUniqueOrThrow({ where: { id } }))
        .reimbursementPrincipal,
    ).toBeNull();
  });
  it('allows pickup after matching acknowledgment without changing Rider Advance debt', async () => {
    const id = await authorizeAccept();
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/record-advance`)
      .set(auth(riderA))
      .send({ actualAdvanceAmount: 980 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/rider-advances/${id}/vendor-acknowledgment`)
      .set(auth(merchantUser))
      .send({ acknowledgedAmount: 980 })
      .expect(201);
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
    const ra = await prisma.riderAdvance.findUniqueOrThrow({ where: { id } });
    expect(ra.actualAdvanceAmount?.toString()).toBe('980');
    expect(ra.reimbursementPrincipal?.toString()).toBe('980');
    expect(
      (
        await prisma.pickupHandoffToken.findUniqueOrThrow({
          where: { id: issued.body.tokenId },
        })
      ).status,
    ).toBe('CONSUMED');
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: order.id, eventType: 'MERCHANT_RELEASED' },
      }),
    ).toBe(1);
  });
  it('leaves ordinary Stage 3 pickup behavior unchanged', async () => {
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
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fulfillment.id },
        })
      ).status,
    ).toBe('picked_up');
  });
});
