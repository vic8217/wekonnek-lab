/**
 * Stage 9 Return Financial HTTP actor matrix.
 * Historical: wekonnek_stage9_test.
 * Current-schema: centralized disposable identity (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const STAGE9_ENV_PRESENT = loadStageTestEnv('.env.stage9.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AgreementStatus,
  AgreementType,
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  ReturnFinancialTermsKind,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE9_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';
import { ReturnFinancialTermsService } from './return-financial-terms.service';

const describeIf = STAGE9_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const STAGE9_HISTORICAL_DATABASES = [STAGE9_ACCEPTANCE_DATABASE] as const;
const STAGE9_HISTORICAL_USERS = new Set(['victor', STAGE9_ACCEPTANCE_DATABASE]);

describeIf('Stage 9 Return Financial HTTP (wekonnek_stage9_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let terms: ReturnFinancialTermsService;
  let customer: { id: string; role: UserRole };
  let creditor: { id: string; role: UserRole };
  let returnRider: { id: string; role: UserRole };
  let deliveryRider: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let foreignMerchantUser: { id: string; role: UserRole };
  let foreign: { id: string; role: UserRole };
  let coordinator: { id: string; role: UserRole };
  let orderId: number;
  let fulfillmentId: string;
  let raId: string;
  let merchantId: number;
  let foreignMerchantId: number;
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
    terms = app.get(ReturnFinancialTermsService);

    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 9 HTTP',
      historicalDatabases: STAGE9_HISTORICAL_DATABASES,
      historicalUsers: STAGE9_HISTORICAL_USERS,
    });

    await terms.ensureSeededTerms();

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s9h-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    creditor = await mk(UserRole.rider, 'cr');
    returnRider = await mk(UserRole.rider, 'rr');
    deliveryRider = await mk(UserRole.rider, 'dr');
    merchantUser = await mk(UserRole.merchant, 'm');
    foreignMerchantUser = await mk(UserRole.merchant, 'fm');
    foreign = await mk(UserRole.customer, 'f');
    coordinator = await mk(UserRole.coordinator, 'co');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S9H ${tag}`,
        slug: `s9h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    merchantId = merchant.id;
    const foreignMerchant = await prisma.merchant.create({
      data: {
        userId: foreignMerchantUser.id,
        name: `S9H-FM ${tag}`,
        slug: `s9h-fm-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: false,
      },
    });
    foreignMerchantId = foreignMerchant.id;
    await prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId: merchant.id,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash',
        enabled: true,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S9H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 800,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.NOT_REQUIRED,
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 800, subtotal: 800 },
          ],
        },
      },
    });
    orderId = order.id;
    const ful = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.returned,
        assignmentVersion: 1,
        activeRiderId: returnRider.id,
      },
    });
    fulfillmentId = ful.id;
    const assignment = await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: ful.id,
        riderId: creditor.id,
        status: RiderAssignmentStatus.SUPERSEDED,
        assignmentVersion: 1,
        assignedByType: 'SYSTEM',
      },
    });
    await prisma.custodyEvent.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: ful.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
        actorUserId: merchantUser.id,
      },
    });
    const agreementId = randomUUID();
    const versionId = randomUUID();
    await prisma.agreement.create({
      data: {
        id: agreementId,
        wkOrderId: order.id,
        agreementType: AgreementType.RIDER_ADVANCE,
        status: AgreementStatus.ACTIVE,
        requiredPartyRoles: ['CUSTOMER', 'RIDER'],
        parties: {
          create: [
            { id: randomUUID(), role: 'CUSTOMER', userId: customer.id },
            { id: randomUUID(), role: 'RIDER', userId: creditor.id },
          ],
        },
      },
    });
    await prisma.agreementVersion.create({
      data: {
        id: versionId,
        agreementId,
        versionNumber: 1,
        canonicalSchema: 'rider_advance.v1',
        termsSnapshot: { kind: 's9h' },
        termsHash: randomUUID().replace(/-/g, ''),
      },
    });
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { currentVersionId: versionId },
    });
    raId = randomUUID();
    await prisma.riderAdvance.create({
      data: {
        id: raId,
        wkOrderId: order.id,
        fulfillmentId: ful.id,
        agreementId,
        agreementVersionId: versionId,
        customerId: customer.id,
        merchantId: merchant.id,
        riderId: creditor.id,
        riderAssignmentId: assignment.id,
        assignmentVersion: 1,
        currency: 'PHP',
        authorizedMaximumAmount: 800,
        actualAdvanceAmount: 800,
        reimbursementPrincipal: 800,
        status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      },
    });

    await terms.acceptTerms({
      wkOrderId: orderId,
      actorUserId: merchantUser.id,
      kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
    });
    await terms.acceptTerms({
      wkOrderId: orderId,
      actorUserId: customer.id,
      kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
    });
  });

  afterAll(async () => {
    // Stage 9 financial history is append-only / terminal-immutable. Do not
    // DISABLE TRIGGER or DELETE protected rows; leave suite fixtures orphaned.
    void orderId;
    void fulfillmentId;
    void merchantId;
    void foreignMerchantId;
    await app?.close();
  });

  it('actor matrix: foreign denied; merchant proposes/acks/finalizes; resolution privacy', async () => {
    await request(app.getHttpServer())
      .get(`/orders/${orderId}/return-financial-resolution`)
      .set(auth(foreign))
      .expect(403);

    const proposed = await request(app.getHttpServer())
      .post(`/orders/${orderId}/return-financial-determinations`)
      .set(auth(merchantUser))
      .send({ outcome: 'QUALIFYING_FULL_RETURN' })
      .expect(201);
    const detId = proposed.body.determination.id;

    await request(app.getHttpServer())
      .post(`/return-financial-determinations/${detId}/acknowledge`)
      .set(auth(returnRider))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/return-financial-determinations/${detId}/acknowledge`)
      .set(auth(merchantUser))
      .expect(201);

    const finalized = await request(app.getHttpServer())
      .post(`/return-financial-determinations/${detId}/finalize`)
      .set(auth(merchantUser))
      .expect(201);
    expect(finalized.body.determination.status).toBe('FINALIZED');

    const merchantView = await request(app.getHttpServer())
      .get(`/orders/${orderId}/return-financial-resolution`)
      .set(auth(merchantUser))
      .expect(200);
    expect(merchantView.body.merchantToRiderRepayment).toBeTruthy();

    const customerView = await request(app.getHttpServer())
      .get(`/orders/${orderId}/return-financial-resolution`)
      .set(auth(customer))
      .expect(200);
    expect(customerView.body.merchantToRiderRepayment).toBeNull();

    const creditorView = await request(app.getHttpServer())
      .get(`/orders/${orderId}/return-financial-resolution`)
      .set(auth(creditor))
      .expect(200);
    expect(creditorView.body.merchantToRiderRepayment).toBeTruthy();
    expect(creditorView.body.merchantToCustomerRefund).toBeNull();
  });

  it('denies return rider, delivery rider, coordinator, foreign merchant/customer on determination', async () => {
    // Order already FINALIZED from prior test — use propose deny before any new state:
    // create a second returned order inline for denial checks
    const tag = randomUUID();
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S9HD-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 400,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.NOT_REQUIRED,
        orderItems: {
          create: [
            { productName: 'deny', quantity: 1, price: 400, subtotal: 400 },
          ],
        },
      },
    });
    const ful = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId,
        customerId: customer.id,
        status: FulfillmentStatus.returned,
        assignmentVersion: 1,
        activeRiderId: returnRider.id,
      },
    });
    await prisma.custodyEvent.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: ful.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
        actorUserId: merchantUser.id,
      },
    });
    await terms.acceptTerms({
      wkOrderId: order.id,
      actorUserId: merchantUser.id,
      kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
    });
    await terms.acceptTerms({
      wkOrderId: order.id,
      actorUserId: customer.id,
      kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
    });

    for (const actor of [returnRider, deliveryRider, coordinator, foreignMerchantUser, foreign]) {
      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/return-financial-determinations`)
        .set(auth(actor))
        .send({ outcome: 'QUALIFYING_FULL_RETURN' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/return-financial-resolution`)
      .set(auth(coordinator))
      .expect(403);

    await request(app.getHttpServer())
      .get(`/orders/${order.id}/return-financial-resolution`)
      .set(auth(foreignMerchantUser))
      .expect(403);

    // cleanup denial order
    await prisma.returnFinancialTermsAcceptance.deleteMany({
      where: { wkOrderId: order.id },
    });
    await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
    await prisma.orderFulfillment.delete({ where: { id: ful.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.wkOrder.delete({ where: { id: order.id } });
  });

  it('Stage5B cash receipt HTTP fails after collection restriction', async () => {
    // Primary order already FINALIZED with restriction (P=800 R=0)
    const res = await request(app.getHttpServer())
      .post(`/rider-advances/${raId}/cash-receipts`)
      .set(auth(creditor))
      .send({ amount: '100.00', idempotencyKey: `http-5b-${randomUUID()}` });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = res.body;
    const code =
      body?.code ||
      body?.message?.code ||
      (typeof body?.message === 'object' ? body.message.code : undefined);
    expect(code).toBe('CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED');
  });
});
