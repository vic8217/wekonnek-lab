/**
 * Stage15A HTTP: generic reserved kind vs specialized order-terms writer.
 * Dedicated wekonnek_stage15a_* disposable DB only.
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from '../test-support/acceptance-database';
import { isStage15aAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15A_ENV_PRESENT = loadStageTestEnv('.env.stage15a.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ClaimEvidenceKind,
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
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import {
  CLAIM_EVIDENCE_PROVENANCE_API,
  EXCEPTION_FINANCIAL_CODES,
} from './exception-financial.policy';

const describeIf = STAGE15A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

describeIf('Stage15A trusted evidence provenance HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: ExceptionFinancialService;
  let admin: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let order: { id: number };
  let merchantId: number;
  let recoveryId: string;
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
    if (!url) throw new Error('DATABASE_URL missing after Stage15A env load');
    const expected = parseAcceptanceDatabaseUrl(url).database;
    if (
      !isStage15aAcceptanceDatabase(expected) ||
      !isRecognizedCurrentSchemaDisposableName(expected)
    ) {
      throw new Error(`Stage15A HTTP refused database ${expected}`);
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
      throw new Error(
        `Stage15A HTTP current_database mismatch expected=${expected}`,
      );
    }
    await exceptions.ensureSeededPolicy();

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15ah-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    rider = await mk(UserRole.rider, 'r');
    admin = await mk(UserRole.admin, 'a');
    staff = await mk(UserRole.staff, 's');
    merchantUser = await mk(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15AH ${tag}`,
        slug: `s15ah-${tag}`,
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
        orderCode: `WK-S15AH-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage15A HTTP St',
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
        correlationId: `s15ah-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15A HTTP fixture',
      },
    });
    recoveryId = recovery.id;

    const opened = await request(app.getHttpServer())
      .post(`/operations-recoveries/${recoveryId}/exception-claims`)
      .set(auth(admin))
      .send({
        claimType: ExceptionClaimType.GOODS_LOSS,
        subjectRef: `order-goods:${order.id}`,
        correlationId: `s15ah-open-${randomUUID()}`,
        idempotencyKey: `s15ah-idem-${randomUUID()}`,
      });
    if (opened.status >= 400) {
      throw new Error(`Stage15A HTTP open failed status=${opened.status}`);
    }
    claimId = opened.body.claim.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('generic HTTP ORDER_TERMS_SNAPSHOT is reserved even with foreign metadata', async () => {
    const before = await prisma.exceptionClaimEvidence.count({
      where: { exceptionClaimId: claimId },
    });
    const res = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence`)
      .set(auth(admin))
      .send({
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        metadata: { merchantId: 'foreign-merchant' },
        provenance: 'SERVER_ATTESTED_ORDER_TERMS',
        sourceType: 'SERVER_ATTESTED_ORDER_TERMS',
        serverAttested: true,
        correlationId: `s15ah-forge-${randomUUID()}`,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe(EXCEPTION_FINANCIAL_CODES.EVIDENCE_KIND_RESERVED);
    const after = await prisma.exceptionClaimEvidence.count({
      where: { exceptionClaimId: claimId },
    });
    expect(after).toBe(before);
  });

  it('staff cannot use specialized or generic evidence mutations', async () => {
    const generic = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/evidence`)
      .set(auth(staff))
      .send({
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        correlationId: `s15ah-staff-${randomUUID()}`,
      });
    expect(generic.status).toBeGreaterThanOrEqual(400);
    const specialized = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/order-terms-evidence`)
      .set(auth(staff))
      .send({ correlationId: `s15ah-staff-ot-${randomUUID()}` });
    expect(specialized.status).toBeGreaterThanOrEqual(400);
  });

  it('specialized HTTP ignores caller order identity and attests claim order', async () => {
    const res = await request(app.getHttpServer())
      .post(`/exception-claims/${claimId}/order-terms-evidence`)
      .set(auth(admin))
      .send({
        correlationId: `s15ah-ot-${randomUUID()}`,
        wkOrderId: 999999,
        merchantId: 888888,
        metadata: { merchantId: 777777 },
        provenance: 'LEGACY_UNVERIFIED',
      });
    expect(res.status).toBeLessThan(400);
    const row = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: res.body.evidenceId },
    });
    const meta = row?.metadata as { wkOrderId?: number; merchantId?: number };
    expect(meta.wkOrderId).toBe(order.id);
    expect(meta.merchantId).toBe(merchantId);
    const get = await request(app.getHttpServer())
      .get(`/exception-claims/${claimId}`)
      .set(auth(admin));
    const evidence = get.body.claim.evidence.find(
      (e: { id: string }) => e.id === res.body.evidenceId,
    );
    expect(evidence.provenance).toBe(
      CLAIM_EVIDENCE_PROVENANCE_API.SERVER_ATTESTED_ORDER_TERMS,
    );
    expect(evidence.isTrustedOrderTermsSnapshot).toBe(true);
  });
});
