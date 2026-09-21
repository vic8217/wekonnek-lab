/**
 * Stage15C successor chain — PostgreSQL acceptance.
 * Dedicated disposable DB only: wekonnek_stage15c_*.
 * Never load frozen Stage12–15B historical parents as env authority.
 * Never access wekonnek_stage12_test.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  parseAcceptanceDatabaseUrl,
  redactDatabaseUrl,
} from '../test-support/acceptance-database';
import { isStage15cAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15C_ENV_PRESENT = loadStageTestEnv('.env.stage15c.test');

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
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
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import {
  EXCEPTION_FINANCIAL_CODES,
  isStage15COneChildUniqueViolation,
  isLiabilityCreateIdempotencyUniqueViolation,
  liabilityDeterminationUniqueViolationCode,
} from './exception-financial.policy';

const describeIf = STAGE15C_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

function expectedDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing after Stage15C env load');
  return parseAcceptanceDatabaseUrl(url).database;
}

function errCode(e: unknown): string | undefined {
  if (
    e instanceof ForbiddenException ||
    e instanceof BadRequestException ||
    e instanceof ConflictException ||
    e instanceof NotFoundException
  ) {
    const r = e.getResponse() as { code?: string };
    return typeof r === 'object' ? r.code : undefined;
  }
  return undefined;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected rejection with code ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected rejection'))
      throw e;
    expect(errCode(e)).toBe(code);
  }
}

type SeedIds = {
  customerId: string;
  riderId: string;
  adminId: string;
  admin2Id: string;
  merchantId: number;
  orderId: number;
  recoveryId: string;
};

describeIf('Stage15C successor chain PostgreSQL', () => {
  const prisma = new PrismaService();
  const exceptions = new ExceptionFinancialService(prisma);
  const EXPECTED_DB = expectedDatabase();

  beforeAll(async () => {
    if (!isStage15cAcceptanceDatabase(EXPECTED_DB)) {
      throw new Error(
        `Stage15C refused: ${EXPECTED_DB} is not wekonnek_stage15c_* disposable`,
      );
    }
    if (!isRecognizedCurrentSchemaDisposableName(EXPECTED_DB)) {
      throw new Error(
        `Stage15C refused: ${EXPECTED_DB} failed current-schema disposable grammar`,
      );
    }
    if (EXPECTED_DB === 'wekonnek_stage15c_topology_audit') {
      throw new Error('Stage15C refused: topology audit DB must not be mutated');
    }
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    const db = identity[0]?.database;
    const user = identity[0]?.user;
    if (db !== EXPECTED_DB) {
      throw new Error(
        `Stage15C refused: current_database=${db} expected=${EXPECTED_DB}`,
      );
    }
    if (
      user !== 'victor' &&
      user !== EXPECTED_DB &&
      !(user ?? '').startsWith('wekonnek_stage')
    ) {
      throw new Error(`Stage15C refused: unexpected current_user`);
    }
    void redactDatabaseUrl(process.env.DATABASE_URL ?? '');
    await exceptions.ensureSeededPolicy();
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedRecovery(): Promise<SeedIds> {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15c-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S15C${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const admin = await mkUser(UserRole.admin, 'a');
    const admin2 = await mkUser(UserRole.admin, 'a2');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15C ${tag}`,
        slug: `s15c-${tag}`,
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
        orderCode: `WK-S15C-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage15C St, Manila',
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
        correlationId: `s15c-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15C acceptance fixture',
      },
    });
    return {
      customerId: customer.id,
      riderId: rider.id,
      adminId: admin.id,
      admin2Id: admin2.id,
      merchantId: merchant.id,
      orderId: order.id,
      recoveryId: recovery.id,
    };
  }

  async function openClaim(fx: SeedIds) {
    return exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${fx.orderId}`,
      correlationId: `s15c-open-${randomUUID().slice(0, 8)}`,
    });
  }

  async function readyClaim(fx: SeedIds, claimId: string) {
    const evidence = await exceptions.addEvidence({
      claimId,
      actorUserId: fx.adminId,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
      notes: 'depot photo',
      correlationId: `s15c-ev-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.verifyEvidence({
      claimId,
      evidenceId: evidence.evidenceId,
      actorUserId: fx.adminId,
      verificationStatus: ClaimVerificationStatus.VERIFIED,
      correlationId: `s15c-vf-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: fx.adminId,
      factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
      statement: 'Goods confirmed lost',
      attributedPartyType: ExceptionLiablePartyType.RIDER,
      attributedPartyUserId: fx.riderId,
      supportingEvidenceId: evidence.evidenceId,
      correlationId: `s15c-fact-${randomUUID().slice(0, 8)}`,
    });
  }

  function customerAlloc(fx: SeedIds, amount: string) {
    return [
      {
        partyType: ExceptionLiablePartyType.CUSTOMER,
        partyUserId: fx.customerId,
        amount,
      },
    ];
  }

  async function finalizedRoot(fx: SeedIds, amount = '400.00') {
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    await readyClaim(fx, claimId);
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, amount),
      correlationId: `s15c-det-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.finalizeDetermination({
      determinationId: created.determination.id,
      actorUserId: fx.adminId,
      correlationId: `s15c-fin-${randomUUID().slice(0, 8)}`,
    });
    return { claimId, rootId: created.determination.id };
  }

  async function counts(claimId: string) {
    const [determinations, coverages, obligations] = await Promise.all([
      prisma.liabilityDetermination.count({
        where: { exceptionClaimId: claimId },
      }),
      prisma.economicLossCoverage.count({
        where: { economicLoss: { claims: { some: { id: claimId } } } },
      }),
      prisma.exceptionFinancialObligation.count({
        where: { exceptionClaimId: claimId },
      }),
    ]);
    return { determinations, coverages, obligations };
  }

  it('creates exactly one DRAFT successor of a FINALIZED parent with no child', async () => {
    const fx = await seedRecovery();
    const { claimId, rootId } = await finalizedRoot(fx);
    const before = await counts(claimId);
    const adj = await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '100.00'),
      reason: 'successor',
      correlationId: `s15c-adj-${randomUUID().slice(0, 8)}`,
    });
    expect(adj.determination.adjustmentOfDeterminationId).toBe(rootId);
    expect(adj.determination.status).toBe(LiabilityDeterminationStatus.DRAFT);
    expect(await counts(claimId)).toEqual({
      ...before,
      determinations: before.determinations + 1,
    });
  });

  it('rejects non-finalized source', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    await readyClaim(fx, claimId);
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '100.00'),
      correlationId: `s15c-draft-${randomUUID().slice(0, 8)}`,
    });
    await expectCode(
      exceptions.createAdjustment({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '50.00'),
        reason: 'from-draft',
        correlationId: `s15c-badsrc-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
  });

  it('rejects a second child of any status', async () => {
    const fx = await seedRecovery();
    const { claimId, rootId } = await finalizedRoot(fx);
    await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      reason: 'first-child',
      correlationId: `s15c-c1-${randomUUID().slice(0, 8)}`,
    });
    const before = await counts(claimId);
    await expectCode(
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '40.00'),
        reason: 'second-child',
        correlationId: `s15c-c2-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
    expect(await counts(claimId)).toEqual(before);
  });

  it('rejects cross-claim parent with no financial mutation', async () => {
    const fx1 = await seedRecovery();
    const fx2 = await seedRecovery();
    const a = await finalizedRoot(fx1);
    const b = await finalizedRoot(fx2);
    const before = await counts(b.claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId: b.claimId,
        actorUserId: fx2.adminId,
        allocations: customerAlloc(fx2, '50.00'),
        adjustmentOfDeterminationId: a.rootId,
        correlationId: `s15c-xclaim-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
    expect(await counts(b.claimId)).toEqual(before);
  });

  it('rejects active DRAFT conflict on a second root determination', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    await readyClaim(fx, claimId);
    await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      correlationId: `s15c-act-${randomUUID().slice(0, 8)}`,
    });
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '40.00'),
        correlationId: `s15c-act2-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.DETERMINATION_ALREADY_ACTIVE,
    );
  });

  it('requires a VerifiedFact before any determination', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    await expectCode(
      exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '50.00'),
        correlationId: `s15c-nf-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.FACT_REQUIRED,
    );
  });

  it('preserves headroom: successor cannot exceed remaining', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx, '990.00');
    await expectCode(
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '50.00'),
        reason: 'over-headroom',
        correlationId: `s15c-hr-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.REMAINING_EXCEEDED,
    );
  });

  it('preserves Stage15B membership on successors', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx);
    await expectCode(
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '50.00',
          },
        ],
        reason: 'rider',
        correlationId: `s15c-rid-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
    const ok = await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.MERCHANT,
          partyMerchantId: fx.merchantId,
          amount: '50.00',
        },
      ],
      reason: 'merchant-ok',
      correlationId: `s15c-mer-${randomUUID().slice(0, 8)}`,
    });
    expect(ok.code).toBe('LIABILITY_DETERMINATION_CREATED');
  });

  it('replays the same idempotency key after the parent has that child', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx);
    const key = `s15c-idem-${randomUUID()}`;
    const payload = {
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      reason: 'idem',
      correlationId: `s15c-idem-c-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    };
    const first = await exceptions.createAdjustment(payload);
    const replay = await exceptions.createAdjustment(payload);
    expect(replay.idempotent).toBe(true);
    expect(replay.determination.id).toBe(first.determination.id);
  });

  it('conflicts on same key with changed payload and does not add a child', async () => {
    const fx = await seedRecovery();
    const { claimId, rootId } = await finalizedRoot(fx);
    const key = `s15c-idc-${randomUUID()}`;
    await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      reason: 'orig',
      correlationId: `s15c-idc1-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    });
    const before = await counts(claimId);
    await expectCode(
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '40.00'),
        reason: 'changed',
        correlationId: `s15c-idc2-${randomUUID().slice(0, 8)}`,
        idempotencyKey: key,
      }),
      EXCEPTION_FINANCIAL_CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
    );
    expect(await counts(claimId)).toEqual(before);
  });

  it('rejects a different idempotency key after the parent already has a child', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx);
    await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      reason: 'first-key',
      correlationId: `s15c-dk1-${randomUUID().slice(0, 8)}`,
      idempotencyKey: `k1-${randomUUID()}`,
    });
    await expectCode(
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '40.00'),
        reason: 'second-key',
        correlationId: `s15c-dk2-${randomUUID().slice(0, 8)}`,
        idempotencyKey: `k2-${randomUUID()}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
  });

  it('concurrent successor attempts persist at most one child', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx);
    const results = await Promise.allSettled([
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.adminId,
        allocations: customerAlloc(fx, '30.00'),
        reason: 'conc-a',
        correlationId: `s15c-ca-${randomUUID().slice(0, 8)}`,
        idempotencyKey: `ca-${randomUUID()}`,
      }),
      exceptions.createAdjustment({
        determinationId: rootId,
        actorUserId: fx.admin2Id,
        allocations: customerAlloc(fx, '31.00'),
        reason: 'conc-b',
        correlationId: `s15c-cb-${randomUUID().slice(0, 8)}`,
        idempotencyKey: `cb-${randomUUID()}`,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1);
    const children = await prisma.liabilityDetermination.count({
      where: { adjustmentOfDeterminationId: rootId },
    });
    expect(children).toBe(1);
  });

  it('database unique index rejects a raw second child', async () => {
    const fx = await seedRecovery();
    const { rootId, claimId } = await finalizedRoot(fx);
    const child = await exceptions.createAdjustment({
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '50.00'),
      reason: 'bypass-src',
      correlationId: `s15c-bp-${randomUUID().slice(0, 8)}`,
    });
    const src = await prisma.liabilityDetermination.findUniqueOrThrow({
      where: { id: child.determination.id },
    });
    try {
      await prisma.liabilityDetermination.create({
        data: {
          id: randomUUID(),
          exceptionClaimId: claimId,
          economicLossId: src.economicLossId,
          policyVersionId: src.policyVersionId,
          policyHash: src.policyHash,
          status: LiabilityDeterminationStatus.CANCELLED,
          currency: src.currency,
          totalLiabilityAmount: new Prisma.Decimal('1.00'),
          createdByActorType: src.createdByActorType,
          createdByActorId: src.createdByActorId,
          adjustmentOfDeterminationId: rootId,
          correlationId: `s15c-raw-${randomUUID().slice(0, 8)}`,
        },
      });
      throw new Error('expected unique rejection');
    } catch (e) {
      if (e instanceof Error && e.message === 'expected unique rejection') throw e;
      expect(isStage15COneChildUniqueViolation(e)).toBe(true);
      expect(liabilityDeterminationUniqueViolationCode(e)).toBe(
        EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
      );
      expect(isLiabilityCreateIdempotencyUniqueViolation(e)).toBe(false);
    }
  });

  it('same-key concurrent successors persist one child and never misclassify idempotency as source-invalid', async () => {
    const fx = await seedRecovery();
    const { rootId } = await finalizedRoot(fx);
    const key = `same-${randomUUID()}`;
    const payload = {
      determinationId: rootId,
      actorUserId: fx.adminId,
      allocations: customerAlloc(fx, '33.00'),
      reason: 'same-key-conc',
      correlationId: `s15c-skc-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    };
    const results = await Promise.allSettled([
      exceptions.createAdjustment(payload),
      exceptions.createAdjustment({
        ...payload,
        correlationId: `s15c-skc2-${randomUUID().slice(0, 8)}`,
      }),
    ]);
    const codes = results.map((r) => {
      if (r.status === 'fulfilled') return 'OK';
      return errCode(r.reason) ?? (r.reason as Error)?.message ?? 'UNKNOWN';
    });
    expect(codes).not.toContain(
      EXCEPTION_FINANCIAL_CODES.ADJUSTMENT_SOURCE_INVALID,
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const children = await prisma.liabilityDetermination.findMany({
      where: { adjustmentOfDeterminationId: rootId },
    });
    expect(children).toHaveLength(1);
    const allocations = await prisma.liabilityAllocation.findMany({
      where: { liabilityDeterminationId: children[0].id },
    });
    expect(allocations.length).toBeGreaterThanOrEqual(1);
    const uniqueSets = new Set(allocations.map((a) => a.liabilityDeterminationId));
    expect(uniqueSets.size).toBe(1);
  });
});
