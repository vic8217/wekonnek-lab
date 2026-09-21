/**
 * Stage15C HTTP successor chain.
 * Dedicated wekonnek_stage15c_* disposable DB only.
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from '../test-support/acceptance-database';
import { isStage15cAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15C_ENV_PRESENT = loadStageTestEnv('.env.stage15c.test');

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

const describeIf = STAGE15C_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

describeIf('Stage15C successor chain HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: ExceptionFinancialService;
  let admin: { id: string; role: UserRole };
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let order: { id: number };
  let merchantId: number;
  let claimId: string;
  let rootId: string;

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
    if (!url) throw new Error('DATABASE_URL missing after Stage15C env load');
    const expected = parseAcceptanceDatabaseUrl(url).database;
    if (
      !isStage15cAcceptanceDatabase(expected) ||
      !isRecognizedCurrentSchemaDisposableName(expected)
    ) {
      throw new Error(`Stage15C HTTP refused database ${expected}`);
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
      throw new Error('Stage15C HTTP current_database mismatch');
    }
    await exceptions.ensureSeededPolicy();

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15ch-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    rider = await mk(UserRole.rider, 'r');
    admin = await mk(UserRole.admin, 'a');
    const merchantUser = await mk(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15CH ${tag}`,
        slug: `s15ch-${tag}`,
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
        orderCode: `WK-S15CH-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage15C HTTP St',
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
        correlationId: `s15ch-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15C HTTP fixture',
      },
    });
    const opened = await exceptions.openClaimFromRecovery({
      operationsRecoveryId: recovery.id,
      actorUserId: admin.id,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${order.id}`,
      correlationId: `s15ch-open-${randomUUID().slice(0, 8)}`,
    });
    claimId = opened.claim.id as string;
    const ev = await exceptions.addEvidence({
      claimId,
      actorUserId: admin.id,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      correlationId: `s15ch-ev-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.verifyEvidence({
      claimId,
      evidenceId: ev.evidenceId,
      actorUserId: admin.id,
      verificationStatus: ClaimVerificationStatus.VERIFIED,
      correlationId: `s15ch-vf-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: admin.id,
      factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
      statement: 'lost',
      supportingEvidenceId: ev.evidenceId,
      correlationId: `s15ch-fact-${randomUUID().slice(0, 8)}`,
    });
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: admin.id,
      allocations: [
        {
          partyType: 'CUSTOMER',
          partyUserId: customer.id,
          amount: '400.00',
        },
      ],
      correlationId: `s15ch-det-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.finalizeDetermination({
      determinationId: created.determination.id,
      actorUserId: admin.id,
      correlationId: `s15ch-fin-${randomUUID().slice(0, 8)}`,
    });
    rootId = created.determination.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a successor over HTTP and rejects a second child', async () => {
    const first = await request(app.getHttpServer())
      .post(`/liability-determinations/${rootId}/adjustments`)
      .set(auth(admin))
      .send({
        allocations: [
          {
            partyType: 'CUSTOMER',
            partyUserId: customer.id,
            amount: '50.00',
          },
        ],
        reason: 'http-successor',
        correlationId: `s15ch-adj-${randomUUID()}`,
      });
    expect(first.status).toBeLessThan(400);
    expect(first.body.determination.adjustmentOfDeterminationId).toBe(rootId);

    const second = await request(app.getHttpServer())
      .post(`/liability-determinations/${rootId}/adjustments`)
      .set(auth(admin))
      .send({
        allocations: [
          {
            partyType: 'CUSTOMER',
            partyUserId: customer.id,
            amount: '40.00',
          },
        ],
        reason: 'http-second',
        correlationId: `s15ch-adj2-${randomUUID()}`,
      });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.body.code).toBe(
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
    void merchantId;
    void claimId;
  });
});
