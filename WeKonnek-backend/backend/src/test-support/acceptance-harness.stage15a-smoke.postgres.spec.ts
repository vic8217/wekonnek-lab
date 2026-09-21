/**
 * Stage15A provenance smoke on an approved Stage15B current-schema DB.
 * Harness-only. Does not rewrite frozen Stage15A suites.
 */
import { loadStageTestEnv } from './load-stage-test-env';
import {
  isApprovedStage15bOverrideDatabase,
  isExplicitAcceptanceDbOverrideRequested,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import { ClaimEvidenceKind, ClaimEvidenceProvenance, ClaimEvidenceVisibility, CommerceDomain, ExceptionClaimEventType, ExceptionClaimType, FulfillmentStatus, MerchantPaymentMethodKind, MerchantPaymentStatus, OperationsRecoveryDisposition, OperationsRecoveryStatus, OperationsRecoveryTrigger, Prisma, RiderAssignmentStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from '../exception-financial/exception-financial.service';
import {
  CLAIM_EVIDENCE_PROVENANCE_API,
  EXCEPTION_FINANCIAL_CODES,
} from '../exception-financial/exception-financial.policy';

const loaded = loadStageTestEnv('.env.stage15b.test');
const url = process.env.DATABASE_URL ?? '';
let db = '';
try {
  db = parseAcceptanceDatabaseUrl(url).database;
} catch {
  db = '';
}
const enabled =
  loaded &&
  isExplicitAcceptanceDbOverrideRequested() &&
  isApprovedStage15bOverrideDatabase(db);

const describeIf = enabled ? describe : describe.skip;
jest.setTimeout(120_000);

describeIf('Stage15A smoke on Stage15B current-schema override DB', () => {
  const prisma = new PrismaService();
  const exceptions = new ExceptionFinancialService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    if (identity[0]?.database !== db) {
      throw new Error(
        `Stage15A smoke refused: current_database=${identity[0]?.database} expected=${db}`,
      );
    }
    await exceptions.ensureSeededPolicy();
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seed() {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15a-smoke-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S15Asmoke${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15Asmoke ${tag}`,
        slug: `s15asmoke-${tag}`,
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
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S15ASM-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: new Prisma.Decimal('1060.00'),
        deliveryFee: new Prisma.Decimal('50.00'),
        transactionFeeAmount: new Prisma.Decimal('10.00'),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: '123 Smoke St, Manila',
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 1000, subtotal: 1000 },
          ],
        },
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
      data: {
        wkOrderId: order.id,
        status: FulfillmentStatus.failed,
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
        correlationId: `s15asmoke-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15A smoke fixture',
      },
    });
    const opened = await exceptions.openClaimFromRecovery({
      operationsRecoveryId: recovery.id,
      actorUserId: admin.id,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${order.id}`,
      correlationId: `s15asmoke-open-${randomUUID().slice(0, 8)}`,
    });
    return { adminId: admin.id, orderId: order.id, merchantId: merchant.id, claimId: opened.claim.id as string };
  }

  it('generic ORDER_TERMS_SNAPSHOT is reserved', async () => {
    const fx = await seed();
    try {
      await exceptions.addEvidence({
        claimId: fx.claimId,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        metadata: { merchantId: 'foreign-merchant' },
        correlationId: `s15asmoke-forge-${randomUUID().slice(0, 8)}`,
      });
      throw new Error('expected reserved kind');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: EXCEPTION_FINANCIAL_CODES.EVIDENCE_KIND_RESERVED,
        }),
      );
    }
    expect(
      await prisma.exceptionClaimEvent.count({
        where: {
          exceptionClaimId: fx.claimId,
          eventType: ExceptionClaimEventType.EVIDENCE_ADDED,
        },
      }),
    ).toBe(0);
  });

  it('specialized snapshot stores SERVER_ATTESTED_ORDER_TERMS', async () => {
    const fx = await seed();
    const added = await exceptions.attachOrderTermsEvidence({
      claimId: fx.claimId,
      actorUserId: fx.adminId,
      correlationId: `s15asmoke-terms-${randomUUID().slice(0, 8)}`,
    });
    const row = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: added.evidenceId },
    });
    expect(row?.provenance).toBe(
      ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS,
    );
  });

  it('NULL provenance remains LEGACY_UNVERIFIED', async () => {
    const fx = await seed();
    const historicalId = randomUUID();
    await prisma.exceptionClaimEvidence.create({
      data: {
        id: historicalId,
        exceptionClaimId: fx.claimId,
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'pre-Stage15A snapshot',
        metadata: {
          kind: 'ORDER_TERMS_SNAPSHOT',
          wkOrderId: fx.orderId,
          merchantId: 999999,
        },
        provenance: null,
        submittedByActorType: 'SYSTEM_ADMIN',
        submittedByActorId: fx.adminId,
      },
    });
    const read = await exceptions.getClaim(fx.claimId, fx.adminId);
    const evidence = (
      read as {
        claim: { evidence: Array<{ id: string; provenance: string }> };
      }
    ).claim.evidence.find((e) => e.id === historicalId);
    expect(evidence?.provenance).toBe(
      CLAIM_EVIDENCE_PROVENANCE_API.LEGACY_UNVERIFIED,
    );
  });
});
