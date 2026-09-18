/**
 * Stage 12 exception financial liability HTTP + privacy acceptance.
 * Default: .env.stage12.test; override via WEKONNEK_ACCEPTANCE_DATABASE_URL.
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
  stage12AllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE12_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE12_ENV_PRESENT = loadStageTestEnv('.env.stage12.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ClaimEvidenceKind,
  ClaimVerificationStatus,
  CommerceDomain,
  ExceptionClaimType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();
const ALLOWED_DB_USERS = stage12AllowedDbUsers(EXPECTED_DB);

describeIf(`Stage 12 Exception Financial HTTP (${EXPECTED_DB})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: ExceptionFinancialService;
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let admin: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let foreign: { id: string; role: UserRole };
  let order: { id: number };
  let fulfillment: { id: string };
  let merchantId: number;
  let recoveryId: string;

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
    exceptions = app.get(ExceptionFinancialService);

    const identity = await assertPrismaConnectedToStage12AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 12 HTTP',
    );
    expect(STAGE12_FORBIDDEN_DATABASES.has(identity.database)).toBe(false);
    expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

    await exceptions.ensureSeededPolicy();

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s12h-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    rider = await mk(UserRole.rider, 'r');
    admin = await mk(UserRole.admin, 'a');
    staff = await mk(UserRole.staff, 's');
    merchantUser = await mk(UserRole.merchant, 'm');
    foreign = await mk(UserRole.customer, 'f');

    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S12H ${tag}`,
        slug: `s12h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    merchantId = merchant.id;
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
        orderCode: `WK-S12H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: new Prisma.Decimal('1050.00'),
        deliveryFee: new Prisma.Decimal('50.00'),
        transactionFeeAmount: new Prisma.Decimal('0.00'),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: '123 Stage12 HTTP St',
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 1000, subtotal: 1000 },
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
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: rider.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
      },
    });
    const recovery = await prisma.operationsRecovery.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        customerId: customer.id,
        merchantId: merchant.id,
        openingTriggerCode: OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
        openedByActorType: 'SYSTEM_ADMIN',
        openedByActorId: admin.id,
        correlationId: `s12h-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage 12 HTTP fixture',
      },
    });
    recoveryId = recovery.id;
  });

  afterAll(async () => {
    // Stage 11/12 history is append-only. Never DISABLE TRIGGER or DELETE
    // protected rows; leave suite fixtures orphaned on the acceptance DB.
    void order;
    void fulfillment;
    await app?.close();
  });

  it('admin drives the full claim lifecycle over HTTP', async () => {
    const open = await request(app.getHttpServer())
      .post(`/operations-recoveries/${recoveryId}/exception-claims`)
      .set(auth(admin))
      .send({
        claimType: ExceptionClaimType.GOODS_LOSS,
        subjectRef: `order-goods:${order.id}`,
        correlationId: `http-open-${randomUUID()}`,
        idempotencyKey: `http-idem-${randomUUID()}`,
      });
    expect(open.status).toBeLessThan(400);
    expect(open.body.code).toBe('EXCEPTION_CLAIM_OPENED');
    const claimId = open.body.claim.id as string;

    const evidence = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence`)
      .set(auth(admin))
      .send({
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: 'ADMIN_ONLY',
        notes: 'depot photo',
        correlationId: `http-ev-${randomUUID()}`,
      });
    expect(evidence.status).toBeLessThan(400);
    const evidenceId = evidence.body.evidenceId as string;

    const verify = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence/${evidenceId}/verify`)
      .set(auth(admin))
      .send({
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `http-vf-${randomUUID()}`,
      });
    expect(verify.status).toBeLessThan(400);

    const fact = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/verified-facts`)
      .set(auth(admin))
      .send({
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Goods lost in rider custody',
        supportingEvidenceId: evidenceId,
        correlationId: `http-fact-${randomUUID()}`,
      });
    expect(fact.status).toBeLessThan(400);

    const determination = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/determinations`)
      .set(auth(admin))
      .send({
        allocations: [
          { partyType: 'RIDER', partyUserId: rider.id, amount: '400.00' },
        ],
        reason: 'rider custody negligence',
        correlationId: `http-det-${randomUUID()}`,
      });
    expect(determination.status).toBeLessThan(400);
    const determinationId = determination.body.determination.id as string;

    const propose = await request(app.getHttpServer())
      .post(`/liability-determinations/${determinationId}/propose`)
      .set(auth(admin))
      .send({ correlationId: `http-prop-${randomUUID()}` });
    expect(propose.status).toBeLessThan(400);

    const finalize = await request(app.getHttpServer())
      .post(`/liability-determinations/${determinationId}/finalize`)
      .set(auth(admin))
      .send({ correlationId: `http-fin-${randomUUID()}` });
    expect(finalize.status).toBeLessThan(400);
    expect(finalize.body.determination.status).toBe('FINALIZED');
    expect(finalize.body.obligations).toHaveLength(1);
    expect(finalize.body.obligations[0].creditorMerchantId).toBe(merchantId);
  });

  it('party mutations are 403 while party reads stay minimal', async () => {
    for (const party of [customer, rider, merchantUser, foreign]) {
      const attempt = await request(app.getHttpServer())
        .post(`/operations-recoveries/${recoveryId}/exception-claims`)
        .set(auth(party))
        .send({
          claimType: ExceptionClaimType.GOODS_LOSS,
          subjectRef: `party-attempt:${party.id}`,
          correlationId: `http-party-${randomUUID()}`,
        });
      expect(attempt.status).toBe(403);
    }

    const list = await request(app.getHttpServer())
      .get(`/orders/${order.id}/exception-claims`)
      .set(auth(customer));
    expect(list.status).toBeLessThan(400);
    expect(Array.isArray(list.body.claims)).toBe(true);
    const claimId = list.body.claims[0]?.id as string;
    expect(claimId).toBeDefined();
    expect(list.body.claims[0].events).toBeUndefined();
    expect(list.body.claims[0].determinations).toBeUndefined();

    const partyGet = await request(app.getHttpServer())
      .get(`/exception-claims/${claimId}`)
      .set(auth(customer));
    expect(partyGet.status).toBeLessThan(400);
    expect(partyGet.body.claim.status).toBeDefined();
    expect(partyGet.body.claim.events).toBeUndefined();
    expect(partyGet.body.claim.verifiedFacts).toBeUndefined();
    // ADMIN_ONLY evidence is never projected to a party.
    expect(partyGet.body.claim.evidence).toEqual([]);

    const adminGet = await request(app.getHttpServer())
      .get(`/exception-claims/${claimId}`)
      .set(auth(admin));
    expect(adminGet.status).toBeLessThan(400);
    expect(adminGet.body.claim.events).toBeDefined();
    expect(adminGet.body.claim.verifiedFacts).toBeDefined();
    expect(adminGet.body.claim.determinations).toBeDefined();

    const foreignGet = await request(app.getHttpServer())
      .get(`/exception-claims/${claimId}`)
      .set(auth(foreign));
    expect(foreignGet.status).toBe(403);
  });

  it('staff may read but not mutate Stage 12 liability', async () => {
    const list = await request(app.getHttpServer())
      .get(`/orders/${order.id}/exception-claims`)
      .set(auth(staff));
    expect(list.status).toBeLessThan(400);

    const mutate = await request(app.getHttpServer())
      .post(`/operations-recoveries/${recoveryId}/exception-claims`)
      .set(auth(staff))
      .send({
        claimType: ExceptionClaimType.GOODS_DAMAGE,
        subjectRef: `staff-attempt:${randomUUID()}`,
        correlationId: `http-staff-${randomUUID()}`,
      });
    expect(mutate.status).toBe(403);
  });
});
