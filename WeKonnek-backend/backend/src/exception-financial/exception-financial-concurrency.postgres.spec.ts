/**
 * Stage 12 exception financial liability — concurrency races A–E.
 *
 * A: two concurrent opens for the same EconomicLoss (distinct idempotency keys)
 * B: two concurrent opens with the SAME idempotency key (replay, not duplicate)
 * C: two concurrent finalizes of the same determination
 * D: two concurrent finalizes of sibling claims against one EconomicLoss
 *    (coverage ceiling must hold)
 * E: Stage 12 finalize racing a Stage 9 determination that is still deciding
 *
 * Cleanup policy: unique-UUID fixtures are left orphaned on the disposable DB.
 * Stage 12 history is append-only — never DISABLE TRIGGER, never DELETE
 * protected rows.
 *
 * DB target: WEKONNEK_ACCEPTANCE_DATABASE_URL override, else .env.stage12.test.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
  stage12AllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE12_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE12_ENV_PRESENT = loadStageTestEnv('.env.stage12.test');

import {
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  ExceptionClaimStatus,
  ExceptionClaimType,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  LiabilityDeterminationStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  Prisma,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { buildEconomicLossKey } from './exception-financial.policy';
import { ExceptionFinancialService } from './exception-financial.service';

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();
const ALLOWED_DB_USERS = stage12AllowedDbUsers(EXPECTED_DB);

type SeedIds = {
  customerId: string;
  riderId: string;
  adminId: string;
  merchantUserId: string;
  merchantId: number;
  orderId: number;
  fulfillmentId: string;
  recoveryId: string;
};

function reasonCode(reason: unknown): string | undefined {
  const r = reason as { getResponse?: () => unknown; message?: string };
  if (typeof r?.getResponse === 'function') {
    const body = r.getResponse() as { code?: string };
    if (body && typeof body === 'object' && body.code) return body.code;
  }
  return r?.message;
}

describeIf(`Stage 12 Exception Financial concurrency (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();
  const exceptions = new ExceptionFinancialService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    const identity = await assertPrismaConnectedToStage12AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 12 concurrency',
    );
    if (
      STAGE12_FORBIDDEN_DATABASES.has(identity.database) ||
      !ALLOWED_DB_USERS.has(identity.user)
    ) {
      throw new Error(
        `Stage 12 concurrency tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
      );
    }
    await exceptions.ensureSeededPolicy();
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedRecovery(opts?: {
    fulfillmentStatus?: FulfillmentStatus;
  }): Promise<SeedIds> {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s12c-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S12C${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');

    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S12C ${tag}`,
        slug: `s12c-${tag}`,
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
        orderCode: `WK-S12C-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage12 Race St',
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
        status: opts?.fulfillmentStatus ?? FulfillmentStatus.delivery_failed,
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
        correlationId: `s12c-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage 12 concurrency fixture',
      },
    });

    return {
      customerId: customer.id,
      riderId: rider.id,
      adminId: admin.id,
      merchantUserId: merchantUser.id,
      merchantId: merchant.id,
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      recoveryId: recovery.id,
    };
  }

  async function driveToDetermination(
    fx: SeedIds,
    claimId: string,
    amount: string,
  ) {
    const evidence = await exceptions.addEvidence({
      claimId,
      actorUserId: fx.adminId,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
      correlationId: `s12c-ev-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.verifyEvidence({
      claimId,
      evidenceId: evidence.evidenceId,
      actorUserId: fx.adminId,
      verificationStatus: ClaimVerificationStatus.VERIFIED,
      correlationId: `s12c-vf-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: fx.adminId,
      factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
      statement: 'Goods confirmed lost in rider custody',
      attributedPartyType: ExceptionLiablePartyType.RIDER,
      attributedPartyUserId: fx.riderId,
      supportingEvidenceId: evidence.evidenceId,
      correlationId: `s12c-fact-${randomUUID().slice(0, 8)}`,
    });
    const determination = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.RIDER,
          partyUserId: fx.riderId,
          amount,
        },
      ],
      reason: 'rider custody negligence',
      correlationId: `s12c-det-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.proposeDetermination({
      determinationId: determination.determination.id,
      actorUserId: fx.adminId,
      correlationId: `s12c-prop-${randomUUID().slice(0, 8)}`,
    });
    return determination.determination.id;
  }

  // ─── Race A ─────────────────────────────────────────────

  it('Race A: concurrent opens for one EconomicLoss yield exactly one active claim', async () => {
    const fx = await seedRecovery();
    const subjectRef = `order-goods:${fx.orderId}`;

    const results = await Promise.allSettled(
      [0, 1].map((i) =>
        exceptions.openClaimFromRecovery({
          operationsRecoveryId: fx.recoveryId,
          actorUserId: fx.adminId,
          claimType: ExceptionClaimType.GOODS_LOSS,
          subjectRef,
          correlationId: `s12c-raceA-${i}-${randomUUID().slice(0, 8)}`,
          idempotencyKey: `raceA-${i}-${randomUUID()}`,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(reasonCode(rejected[0].reason)).toMatch(
      /EXCEPTION_CLAIM_ALREADY_ACTIVE|IDEMPOTENCY|SERIALIZ/i,
    );

    const lossKey = buildEconomicLossKey({
      wkOrderId: fx.orderId,
      lossKind: EconomicLossKind.GOODS_LOST,
      subjectRef,
    });
    const loss = await prisma.economicLoss.findUnique({
      where: { economicLossKey: lossKey },
      include: { claims: true },
    });
    expect(loss).not.toBeNull();
    const active = loss!.claims.filter(
      (c) =>
        c.status === ExceptionClaimStatus.OPEN ||
        c.status === ExceptionClaimStatus.EVIDENCE_REVIEW ||
        c.status === ExceptionClaimStatus.VERIFIED ||
        c.status === ExceptionClaimStatus.DETERMINATION_PROPOSED,
    );
    expect(active).toHaveLength(1);
  });

  // ─── Race B ─────────────────────────────────────────────

  it('Race B: concurrent opens sharing one idempotency key replay the same claim', async () => {
    const fx = await seedRecovery();
    const idempotencyKey = `raceB-${randomUUID()}`;
    const subjectRef = `order-goods:${fx.orderId}`;

    const results = await Promise.allSettled(
      [0, 1, 2].map(() =>
        exceptions.openClaimFromRecovery({
          operationsRecoveryId: fx.recoveryId,
          actorUserId: fx.adminId,
          claimType: ExceptionClaimType.GOODS_LOSS,
          subjectRef,
          correlationId: `s12c-raceB-${randomUUID().slice(0, 8)}`,
          idempotencyKey,
        }),
      ),
    );

    const ids = new Set(
      results.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value.claim.id] : [],
      ),
    );
    expect(ids.size).toBe(1);

    const claims = await prisma.exceptionClaim.findMany({
      where: { wkOrderId: fx.orderId },
    });
    expect(claims).toHaveLength(1);
    // A replay never appends a duplicate OPENED event.
    const opened = await prisma.exceptionClaimEvent.count({
      where: { exceptionClaimId: claims[0].id, eventType: 'CLAIM_OPENED' },
    });
    expect(opened).toBe(1);
  });

  // ─── Race C ─────────────────────────────────────────────

  it('Race C: concurrent finalizes of one determination settle money exactly once', async () => {
    const fx = await seedRecovery();
    const opened = await exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${fx.orderId}`,
      correlationId: `s12c-raceC-${randomUUID().slice(0, 8)}`,
    });
    const determinationId = await driveToDetermination(
      fx,
      opened.claim.id,
      '400.00',
    );

    const results = await Promise.allSettled(
      [0, 1].map((i) =>
        exceptions.finalizeDetermination({
          determinationId,
          actorUserId: fx.adminId,
          correlationId: `s12c-fin-${i}-${randomUUID().slice(0, 8)}`,
        }),
      ),
    );
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const determination = await prisma.liabilityDetermination.findUnique({
      where: { id: determinationId },
    });
    expect(determination?.status).toBe(LiabilityDeterminationStatus.FINALIZED);

    const obligations = await prisma.exceptionFinancialObligation.findMany({
      where: { liabilityDeterminationId: determinationId },
    });
    expect(obligations).toHaveLength(1);
    expect(obligations[0].principal.toFixed(2)).toBe('400.00');

    const coverages = await prisma.economicLossCoverage.findMany({
      where: { economicLossId: determination!.economicLossId },
    });
    const stage12Coverage = coverages.filter(
      (c) => c.sourceRef === determinationId,
    );
    expect(stage12Coverage).toHaveLength(1);

    const claim = await prisma.exceptionClaim.findUnique({
      where: { id: opened.claim.id },
    });
    expect(claim?.status).toBe(ExceptionClaimStatus.FINALIZED);
  });

  // ─── Race D ─────────────────────────────────────────────

  it('Race D: a concurrent external coverage write cannot breach the ceiling', async () => {
    const fx = await seedRecovery();
    const subjectRef = `order-goods:${fx.orderId}`;

    const opened = await exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef,
      correlationId: `s12c-raceD-${randomUUID().slice(0, 8)}`,
    });
    // Drive far enough that the EconomicLoss exists with compensable=1000.
    await driveToDetermination(fx, opened.claim.id, '400.00');

    const lossKey = buildEconomicLossKey({
      wkOrderId: fx.orderId,
      lossKind: EconomicLossKind.GOODS_LOST,
      subjectRef,
    });
    const loss = await prisma.economicLoss.findUniqueOrThrow({
      where: { economicLossKey: lossKey },
    });
    expect(loss.compensableAmount.toFixed(2)).toBe('1000.00');

    // Two concurrent coverage inserts of 600 against a 1000 ceiling — exactly
    // one must be refused by stage12_coverage_ceiling (EconomicLoss FOR UPDATE).
    const results = await Promise.allSettled([
      prisma.$executeRawUnsafe(
        `INSERT INTO economic_loss_coverages
           (id, economic_loss_id, source_kind, source_ref, subject_ref_snapshot,
            amount, currency, created_by_actor_type, created_by_actor_id)
         VALUES ($1::uuid, $2::uuid, 'EXTERNAL_RECOVERY', $3, $4,
                 600.00, $5, 'SYSTEM_ADMIN', $6::uuid)`,
        randomUUID(),
        loss.id,
        `external-a-${randomUUID()}`,
        loss.subjectRef,
        loss.currency,
        fx.adminId,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO economic_loss_coverages
           (id, economic_loss_id, source_kind, source_ref, subject_ref_snapshot,
            amount, currency, created_by_actor_type, created_by_actor_id)
         VALUES ($1::uuid, $2::uuid, 'EXTERNAL_RECOVERY', $3, $4,
                 600.00, $5, 'SYSTEM_ADMIN', $6::uuid)`,
        randomUUID(),
        loss.id,
        `external-b-${randomUUID()}`,
        loss.subjectRef,
        loss.currency,
        fx.adminId,
      ),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const coverages = await prisma.economicLossCoverage.findMany({
      where: { economicLossId: loss.id },
    });
    const covered = coverages.reduce(
      (acc, c) => acc.add(c.amount),
      new Prisma.Decimal(0),
    );
    expect(covered.toFixed(2)).toBe('600.00');
    expect(covered.lte(loss.compensableAmount)).toBe(true);
  });

  // ─── Race E ─────────────────────────────────────────────

  it('Race E: Stage 12 finalize refuses while a Stage 9 determination is still deciding', async () => {
    const fx = await seedRecovery({
      fulfillmentStatus: FulfillmentStatus.returned,
    });

    const custodyEvent = await prisma.custodyEvent.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        eventType: 'RETURN_RECEIVED',
        fromPartyRole: 'RIDER',
        toPartyRole: 'MERCHANT',
        fromUserId: fx.riderId,
        toUserId: fx.merchantUserId,
        actorUserId: fx.merchantUserId,
        correlationId: `s12c-ret-${randomUUID().slice(0, 8)}`,
        occurredAt: new Date(),
      },
    });

    const opened = await exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${fx.orderId}`,
      correlationId: `s12c-raceE-${randomUUID().slice(0, 8)}`,
    });
    const determinationId = await driveToDetermination(
      fx,
      opened.claim.id,
      '400.00',
    );

    // Return-money-eligible with no FINALIZED Stage 9 determination yet.
    const beforeStage9 = await exceptions
      .finalizeDetermination({
        determinationId,
        actorUserId: fx.adminId,
        correlationId: `s12c-raceE-f1-${randomUUID().slice(0, 8)}`,
      })
      .then(() => null)
      .catch((e: unknown) => reasonCode(e));
    expect(beforeStage9).toBe('STAGE9_RETURN_MONEY_PENDING');

    // Stage 9 starts deciding (PENDING) — Stage 12 still refuses, now on the
    // in-progress gate. Stage 9 rows are written directly; Stage 9 services are
    // never called or modified by Stage 12.
    const stage9 = await prisma.returnFinancialDetermination.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        returnCustodyEventId: custodyEvent.id,
        status: ReturnFinancialDeterminationStatus.PENDING,
        path: 'RIDER_ADVANCE',
        outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
      },
    });

    const duringStage9 = await exceptions
      .finalizeDetermination({
        determinationId,
        actorUserId: fx.adminId,
        correlationId: `s12c-raceE-f2-${randomUUID().slice(0, 8)}`,
      })
      .then(() => null)
      .catch((e: unknown) => reasonCode(e));
    expect(duringStage9).toBe('STAGE9_DETERMINATION_IN_PROGRESS');

    // Nothing was written by either refusal.
    const obligations = await prisma.exceptionFinancialObligation.count({
      where: { liabilityDeterminationId: determinationId },
    });
    expect(obligations).toBe(0);
    const stillProposed = await prisma.liabilityDetermination.findUnique({
      where: { id: determinationId },
    });
    expect(stillProposed?.status).toBe(LiabilityDeterminationStatus.PROPOSED);

    // Stage 9 concludes; Stage 12 may now finalize on the remaining amount.
    await prisma.returnFinancialDetermination.update({
      where: { id: stage9.id },
      data: {
        status: ReturnFinancialDeterminationStatus.FINALIZED,
        finalizedAt: new Date(),
        finalizedByActorType: 'MERCHANT_OWNER',
        finalizedByActorId: fx.merchantUserId,
      },
    });

    const settled = await exceptions.finalizeDetermination({
      determinationId,
      actorUserId: fx.adminId,
      correlationId: `s12c-raceE-f3-${randomUUID().slice(0, 8)}`,
    });
    expect(settled.determination.status).toBe(
      LiabilityDeterminationStatus.FINALIZED,
    );
    expect(settled.obligations).toHaveLength(1);
  });
});
