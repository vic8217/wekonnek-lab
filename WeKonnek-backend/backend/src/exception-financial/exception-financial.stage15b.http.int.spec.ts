/**
 * Stage15B HTTP: allocation membership enforcement.
 * Dedicated wekonnek_stage15b_* disposable DB only.
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from '../test-support/acceptance-database';
import { isStage15bAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15B_ENV_PRESENT = loadStageTestEnv('.env.stage15b.test');

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
import { EXCEPTION_FINANCIAL_CODES } from './exception-financial.policy';

const describeIf = STAGE15B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

describeIf('Stage15B liability party membership HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: ExceptionFinancialService;
  let admin: { id: string; role: UserRole };
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let foreign: { id: string; role: UserRole };
  let order: { id: number };
  let merchantId: number;
  let claimId: string;

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
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing after Stage15B env load');
    const expected = parseAcceptanceDatabaseUrl(url).database;
    if (
      !isStage15bAcceptanceDatabase(expected) ||
      !isRecognizedCurrentSchemaDisposableName(expected)
    ) {
      throw new Error(`Stage15B HTTP refused database ${expected}`);
    }
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
    const identity = await prisma.$queryRaw<
      Array<{ database: string }>
    >`SELECT current_database() AS database`;
    if (identity[0]?.database !== expected) {
      throw new Error('Stage15B HTTP current_database mismatch');
    }
    await exceptions.ensureSeededPolicy();

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15bh-${p}-${tag}@test.invalid`,
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
        name: `S15BH ${tag}`,
        slug: `s15bh-${tag}`,
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
        orderCode: `WK-S15BH-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage15B HTTP St',
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 1000, subtotal: 1000 },
          ],
        },
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
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
        correlationId: `s15bh-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15B HTTP fixture',
      },
    });
    const opened = await request(app.getHttpServer())
      .post(`/operations-recoveries/${recovery.id}/exception-claims`)
      .set(auth(admin))
      .send({
        claimType: ExceptionClaimType.GOODS_LOSS,
        subjectRef: `order-goods:${order.id}`,
        correlationId: `s15bh-open-${randomUUID()}`,
        idempotencyKey: `s15bh-idem-${randomUUID()}`,
      });
    if (opened.status >= 400) {
      throw new Error(`Stage15B HTTP open failed status=${opened.status}`);
    }
    claimId = opened.body.claim.id as string;
    const evidence = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence`)
      .set(auth(admin))
      .send({
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        notes: 'photo',
        correlationId: `s15bh-ev-${randomUUID()}`,
      });
    const evidenceId = evidence.body.evidenceId as string;
    await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence/${evidenceId}/verify`)
      .set(auth(admin))
      .send({
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s15bh-vf-${randomUUID()}`,
      });
    await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/verified-facts`)
      .set(auth(admin))
      .send({
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Goods lost',
        supportingEvidenceId: evidenceId,
        correlationId: `s15bh-fact-${randomUUID()}`,
      });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('SYSTEM_ADMIN cannot allocate a foreign CUSTOMER over HTTP', async () => {
    const before = await prisma.liabilityDetermination.count({
      where: { exceptionClaimId: claimId },
    });
    const res = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/determinations`)
      .set(auth(admin))
      .send({
        allocations: [
          { partyType: 'CUSTOMER', partyUserId: foreign.id, amount: '400.00' },
        ],
        correlationId: `s15bh-fc-${randomUUID()}`,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe(EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID);
    expect(
      await prisma.liabilityDetermination.count({
        where: { exceptionClaimId: claimId },
      }),
    ).toBe(before);
  });

  it('SYSTEM_ADMIN cannot allocate RIDER over HTTP', async () => {
    const res = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/determinations`)
      .set(auth(admin))
      .send({
        allocations: [
          { partyType: 'RIDER', partyUserId: rider.id, amount: '400.00' },
        ],
        correlationId: `s15bh-r-${randomUUID()}`,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe(
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
  });

  it('SYSTEM_ADMIN can allocate canonical CUSTOMER over HTTP', async () => {
    const res = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/determinations`)
      .set(auth(admin))
      .send({
        allocations: [
          {
            partyType: 'CUSTOMER',
            partyUserId: customer.id,
            amount: '400.00',
          },
        ],
        correlationId: `s15bh-ok-${randomUUID()}`,
      });
    expect(res.status).toBeLessThan(400);
    expect(res.body.code).toBe('LIABILITY_DETERMINATION_CREATED');
    void merchantId;
  });
});
