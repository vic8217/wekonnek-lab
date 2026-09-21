/**
 * Stage15B liability party membership — PostgreSQL acceptance.
 * Dedicated disposable DB only: wekonnek_stage15b_*.
 * Never load frozen Stage12–15A historical parents.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  parseAcceptanceDatabaseUrl,
  redactDatabaseUrl,
} from '../test-support/acceptance-database';
import { isStage15bAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15B_ENV_PRESENT = loadStageTestEnv('.env.stage15b.test');

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
  DeliveryAttemptOutcome,
  ExceptionClaimType,
  ExceptionFinancialObligationStatus,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  LiabilityDeterminationStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  Prisma,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import { EXCEPTION_FINANCIAL_CODES } from './exception-financial.policy';

const describeIf = STAGE15B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

function expectedDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing after Stage15B env load');
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
  merchantUserId: string;
  foreignId: string;
  merchantId: number;
  foreignMerchantId: number;
  orderId: number;
  fulfillmentId: string;
  assignmentId: string;
  recoveryId: string;
};

describeIf('Stage15B liability party membership PostgreSQL', () => {
  const prisma = new PrismaService();
  const exceptions = new ExceptionFinancialService(prisma);
  const EXPECTED_DB = expectedDatabase();

  beforeAll(async () => {
    if (!isStage15bAcceptanceDatabase(EXPECTED_DB)) {
      throw new Error(
        `Stage15B refused: ${EXPECTED_DB} is not wekonnek_stage15b_* disposable`,
      );
    }
    if (!isRecognizedCurrentSchemaDisposableName(EXPECTED_DB)) {
      throw new Error(
        `Stage15B refused: ${EXPECTED_DB} failed current-schema disposable grammar`,
      );
    }
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    const db = identity[0]?.database;
    const user = identity[0]?.user;
    if (db !== EXPECTED_DB) {
      throw new Error(
        `Stage15B refused: current_database=${db} expected=${EXPECTED_DB}`,
      );
    }
    if (
      user !== 'victor' &&
      user !== EXPECTED_DB &&
      !(user ?? '').startsWith('wekonnek_stage')
    ) {
      throw new Error(`Stage15B refused: unexpected current_user`);
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
          email: `s15b-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S15B${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const foreign = await mkUser(UserRole.customer, 'f');
    const foreignMerchantUser = await mkUser(UserRole.merchant, 'fm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15B ${tag}`,
        slug: `s15b-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    const foreignMerchant = await prisma.merchant.create({
      data: {
        userId: foreignMerchantUser.id,
        name: `S15B-F ${tag}`,
        slug: `s15bf-${tag}`,
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
        orderCode: `WK-S15B-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage15B St, Manila',
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
    const assignment = await prisma.riderAssignment.create({
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
        correlationId: `s15b-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15B acceptance fixture',
      },
    });
    return {
      customerId: customer.id,
      riderId: rider.id,
      adminId: admin.id,
      merchantUserId: merchantUser.id,
      foreignId: foreign.id,
      merchantId: merchant.id,
      foreignMerchantId: foreignMerchant.id,
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      assignmentId: assignment.id,
      recoveryId: recovery.id,
    };
  }

  async function openClaim(fx: SeedIds) {
    return exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${fx.orderId}`,
      correlationId: `s15b-open-${randomUUID().slice(0, 8)}`,
    });
  }

  async function readyClaim(fx: SeedIds, claimId: string) {
    const evidence = await exceptions.addEvidence({
      claimId,
      actorUserId: fx.adminId,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
      notes: 'depot photo',
      correlationId: `s15b-ev-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.verifyEvidence({
      claimId,
      evidenceId: evidence.evidenceId,
      actorUserId: fx.adminId,
      verificationStatus: ClaimVerificationStatus.VERIFIED,
      correlationId: `s15b-vf-${randomUUID().slice(0, 8)}`,
    });
    const fact = await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: fx.adminId,
      factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
      statement: 'Goods confirmed lost',
      attributedPartyType: ExceptionLiablePartyType.RIDER,
      attributedPartyUserId: fx.riderId,
      supportingEvidenceId: evidence.evidenceId,
      correlationId: `s15b-fact-${randomUUID().slice(0, 8)}`,
    });
    return { evidenceId: evidence.evidenceId, verifiedFactId: fact.verifiedFactId };
  }

  async function counts(claimId: string) {
    const [determinations, coverages, obligations, claim] = await Promise.all([
      prisma.liabilityDetermination.count({ where: { exceptionClaimId: claimId } }),
      prisma.economicLossCoverage.count({
        where: { economicLoss: { claims: { some: { id: claimId } } } },
      }),
      prisma.exceptionFinancialObligation.count({
        where: { exceptionClaimId: claimId },
      }),
      prisma.exceptionClaim.findUniqueOrThrow({ where: { id: claimId } }),
    ]);
    return { determinations, coverages, obligations, status: claim.status };
  }

  it('rejects foreign CUSTOMER and does not create a determination', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const before = await counts(claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.foreignId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-fc-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
    expect(await counts(claimId)).toEqual(before);
  });

  it('accepts canonical CUSTOMER (userId only)', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.CUSTOMER,
          partyUserId: fx.customerId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-vc-${randomUUID().slice(0, 8)}`,
    });
    expect(created.code).toBe('LIABILITY_DETERMINATION_CREATED');
  });

  it('rejects malformed CUSTOMER (merchant id populated)', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.customerId,
            partyMerchantId: fx.merchantId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-mc-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
  });

  it('rejects foreign MERCHANT and accepts canonical MERCHANT', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.foreignMerchantId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-fm-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.MERCHANT,
          partyMerchantId: fx.merchantId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-vm-${randomUUID().slice(0, 8)}`,
    });
    expect(created.code).toBe('LIABILITY_DETERMINATION_CREATED');
  });

  it('snapshot metadata cannot authorize a foreign merchant', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    await exceptions.attachOrderTermsEvidence({
      claimId,
      actorUserId: fx.adminId,
      correlationId: `s15b-snap-${randomUUID().slice(0, 8)}`,
    });
    await prisma.exceptionClaimEvidence.create({
      data: {
        id: randomUUID(),
        exceptionClaimId: claimId,
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        metadata: { merchantId: fx.foreignMerchantId },
        provenance: null,
        submittedByActorType: 'SYSTEM_ADMIN',
        submittedByActorId: fx.adminId,
      },
    });
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.foreignMerchantId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-snapm-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
  });

  it('VerifiedFact attribution cannot authorize a foreign party', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    const ready = await readyClaim(fx, claimId);
    await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: fx.adminId,
      factType: VerifiedFactType.PARTY_NEGLIGENCE_CONFIRMED,
      statement: 'Attributed to a foreign user',
      attributedPartyType: ExceptionLiablePartyType.CUSTOMER,
      attributedPartyUserId: fx.foreignId,
      supportingEvidenceId: ready.evidenceId,
      correlationId: `s15b-attr-${randomUUID().slice(0, 8)}`,
    });
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.foreignId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-attrc-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
  });

  it('rejects RIDER from assignment, custodian, delivery, return, and advance creditor', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    await prisma.deliveryAttempt.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        attemptNumber: 1,
        riderId: fx.riderId,
        riderAssignmentId: fx.assignmentId,
        assignmentVersion: 1,
        physicalCustodianRiderId: fx.riderId,
        outcome: DeliveryAttemptOutcome.FAILED,
        failureReasonCode: 'CUSTOMER_UNREACHABLE',
        occurredAt: new Date(),
        reportedByActorType: 'SYSTEM_ADMIN',
        reportedByActorId: fx.adminId,
      },
    });
    await prisma.custodyEvent.create({
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
        correlationId: `s15b-ret-${randomUUID().slice(0, 8)}`,
        occurredAt: new Date(),
      },
    });
    const agreementId = randomUUID();
    const versionId = randomUUID();
    await prisma.agreement.create({
      data: {
        id: agreementId,
        wkOrderId: fx.orderId,
        agreementType: 'RIDER_ADVANCE',
        status: 'ACCEPTED',
        requiredPartyRoles: ['CUSTOMER', 'RIDER'],
        parties: {
          create: [
            { id: randomUUID(), role: 'CUSTOMER', userId: fx.customerId },
            { id: randomUUID(), role: 'RIDER', userId: fx.riderId },
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
        termsSnapshot: { kind: 's15b' },
        termsHash: randomUUID().replace(/-/g, ''),
      },
    });
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { currentVersionId: versionId },
    });
    await prisma.riderAdvance.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        agreementId,
        agreementVersionId: versionId,
        customerId: fx.customerId,
        merchantId: fx.merchantId,
        riderId: fx.riderId,
        riderAssignmentId: fx.assignmentId,
        assignmentVersion: 1,
        currency: 'PHP',
        authorizedMaximumAmount: new Prisma.Decimal('800.00'),
        actualAdvanceAmount: new Prisma.Decimal('800.00'),
        reimbursementPrincipal: new Prisma.Decimal('800.00'),
        status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      },
    });
    const before = await counts(claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-rider-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
    expect(await counts(claimId)).toEqual(before);
  });

  it('rejects RIDER even with PARTY_NEGLIGENCE_CONFIRMED', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    const ready = await readyClaim(fx, claimId);
    await exceptions.concludeVerifiedFact({
      claimId,
      actorUserId: fx.adminId,
      factType: VerifiedFactType.PARTY_NEGLIGENCE_CONFIRMED,
      statement: 'Rider negligence confirmed',
      attributedPartyType: ExceptionLiablePartyType.RIDER,
      attributedPartyUserId: fx.riderId,
      supportingEvidenceId: ready.evidenceId,
      correlationId: `s15b-neg-${randomUUID().slice(0, 8)}`,
    });
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '400.00',
          },
        ],
        correlationId: `s15b-negr-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
  });

  it('rejects mixed packs with no partial determination', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const before = await counts(claimId);
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.customerId,
            amount: '200.00',
          },
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.foreignMerchantId,
            amount: '200.00',
          },
        ],
        correlationId: `s15b-mix1-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
    await expectCode(
      exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '200.00',
          },
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '200.00',
          },
        ],
        correlationId: `s15b-mix2-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
    expect(await counts(claimId)).toEqual(before);
  });

  it('legacy valid CUSTOMER DRAFT can finalize; foreign/RIDER DRAFT cannot', async () => {
    const validFx = await seedRecovery();
    const validClaimId = (await openClaim(validFx)).claim.id as string;
    await readyClaim(validFx, validClaimId);
    const validCreated = await exceptions.createDetermination({
      claimId: validClaimId,
      actorUserId: validFx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.CUSTOMER,
          partyUserId: validFx.customerId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-legv-${randomUUID().slice(0, 8)}`,
    });
    const validFin = await exceptions.finalizeDetermination({
      determinationId: validCreated.determination.id,
      actorUserId: validFx.adminId,
      correlationId: `s15b-legvf-${randomUUID().slice(0, 8)}`,
    });
    expect(validFin.determination.status).toBe(
      LiabilityDeterminationStatus.FINALIZED,
    );

    const foreignFx = await seedRecovery();
    const foreignClaimId = (await openClaim(foreignFx)).claim.id as string;
    await readyClaim(foreignFx, foreignClaimId);
    const claim = await prisma.exceptionClaim.findUniqueOrThrow({
      where: { id: foreignClaimId },
    });
    const detId = randomUUID();
    await prisma.liabilityDetermination.create({
      data: {
        id: detId,
        exceptionClaimId: foreignClaimId,
        economicLossId: claim.economicLossId,
        policyVersionId: claim.policyVersionId,
        policyHash: claim.policyHash,
        status: LiabilityDeterminationStatus.DRAFT,
        currency: 'PHP',
        totalLiabilityAmount: new Prisma.Decimal('400.00'),
        compensableAmountSnapshot: new Prisma.Decimal('1000.00'),
        priorCoverageAmountSnapshot: new Prisma.Decimal('0.00'),
        remainingAmountSnapshot: new Prisma.Decimal('1000.00'),
        createdByActorType: 'SYSTEM_ADMIN',
        createdByActorId: foreignFx.adminId,
        correlationId: `s15b-legd-${randomUUID().slice(0, 8)}`,
      },
    });
    await prisma.liabilityAllocation.create({
      data: {
        id: randomUUID(),
        liabilityDeterminationId: detId,
        partyType: ExceptionLiablePartyType.CUSTOMER,
        partyUserId: foreignFx.foreignId,
        amount: new Prisma.Decimal('400.00'),
        currency: 'PHP',
      },
    });
    const beforeForeign = await counts(foreignClaimId);
    await expectCode(
      exceptions.finalizeDetermination({
        determinationId: detId,
        actorUserId: foreignFx.adminId,
        correlationId: `s15b-legdf-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
    );
    const afterForeign = await counts(foreignClaimId);
    expect(afterForeign.coverages).toBe(beforeForeign.coverages);
    expect(afterForeign.obligations).toBe(beforeForeign.obligations);
    expect(afterForeign.status).not.toBe('FINALIZED');
    const stillDraft = await prisma.liabilityDetermination.findUniqueOrThrow({
      where: { id: detId },
    });
    expect(stillDraft.status).toBe(LiabilityDeterminationStatus.DRAFT);

    const riderFx = await seedRecovery();
    const riderClaimId = (await openClaim(riderFx)).claim.id as string;
    await readyClaim(riderFx, riderClaimId);
    const riderClaim = await prisma.exceptionClaim.findUniqueOrThrow({
      where: { id: riderClaimId },
    });
    const riderDetId = randomUUID();
    await prisma.liabilityDetermination.create({
      data: {
        id: riderDetId,
        exceptionClaimId: riderClaimId,
        economicLossId: riderClaim.economicLossId,
        policyVersionId: riderClaim.policyVersionId,
        policyHash: riderClaim.policyHash,
        status: LiabilityDeterminationStatus.DRAFT,
        currency: 'PHP',
        totalLiabilityAmount: new Prisma.Decimal('400.00'),
        compensableAmountSnapshot: new Prisma.Decimal('1000.00'),
        priorCoverageAmountSnapshot: new Prisma.Decimal('0.00'),
        remainingAmountSnapshot: new Prisma.Decimal('1000.00'),
        createdByActorType: 'SYSTEM_ADMIN',
        createdByActorId: riderFx.adminId,
        correlationId: `s15b-legr-${randomUUID().slice(0, 8)}`,
      },
    });
    await prisma.liabilityAllocation.create({
      data: {
        id: randomUUID(),
        liabilityDeterminationId: riderDetId,
        partyType: ExceptionLiablePartyType.RIDER,
        partyUserId: riderFx.riderId,
        amount: new Prisma.Decimal('400.00'),
        currency: 'PHP',
      },
    });
    await expectCode(
      exceptions.finalizeDetermination({
        determinationId: riderDetId,
        actorUserId: riderFx.adminId,
        correlationId: `s15b-legrf-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
    expect(
      (
        await prisma.liabilityDetermination.findUniqueOrThrow({
          where: { id: riderDetId },
        })
      ).status,
    ).toBe(LiabilityDeterminationStatus.DRAFT);
    expect(
      await prisma.exceptionFinancialObligation.count({
        where: { exceptionClaimId: riderClaimId },
      }),
    ).toBe(0);
  });

  it('historical FINALIZED RIDER determination remains readable and is not rewritten', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const claim = await prisma.exceptionClaim.findUniqueOrThrow({
      where: { id: claimId },
    });
    const detId = randomUUID();
    await prisma.liabilityDetermination.create({
      data: {
        id: detId,
        exceptionClaimId: claimId,
        economicLossId: claim.economicLossId,
        policyVersionId: claim.policyVersionId,
        policyHash: claim.policyHash,
        status: LiabilityDeterminationStatus.DRAFT,
        currency: 'PHP',
        totalLiabilityAmount: new Prisma.Decimal('400.00'),
        compensableAmountSnapshot: new Prisma.Decimal('1000.00'),
        priorCoverageAmountSnapshot: new Prisma.Decimal('0.00'),
        remainingAmountSnapshot: new Prisma.Decimal('1000.00'),
        createdByActorType: 'SYSTEM_ADMIN',
        createdByActorId: fx.adminId,
        correlationId: `s15b-hist-${randomUUID().slice(0, 8)}`,
      },
    });
    await prisma.liabilityAllocation.create({
      data: {
        id: randomUUID(),
        liabilityDeterminationId: detId,
        partyType: ExceptionLiablePartyType.RIDER,
        partyUserId: fx.riderId,
        amount: new Prisma.Decimal('400.00'),
        currency: 'PHP',
      },
    });
    await prisma.liabilityDetermination.update({
      where: { id: detId },
      data: {
        status: LiabilityDeterminationStatus.FINALIZED,
        finalizedAt: new Date(),
        finalizedByActorType: 'SYSTEM_ADMIN',
        finalizedByActorId: fx.adminId,
      },
    });
    const got = await exceptions.getClaim(claimId, fx.adminId);
    const det = (
      got as {
        claim: {
          determinations: Array<{
            id: string;
            status: string;
            allocations: Array<{ partyType: string; partyUserId: string | null }>;
          }>;
        };
      }
    ).claim.determinations.find((d) => d.id === detId);
    expect(det?.status).toBe(LiabilityDeterminationStatus.FINALIZED);
    expect(det?.allocations[0]?.partyType).toBe(ExceptionLiablePartyType.RIDER);
    expect(det?.allocations[0]?.partyUserId).toBe(fx.riderId);
  });

  it('idempotent create/finalize replay does not mutate parties or duplicate money', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const createKey = `s15b-idem-c-${randomUUID()}`;
    const first = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.CUSTOMER,
          partyUserId: fx.customerId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-idem1-${randomUUID().slice(0, 8)}`,
      idempotencyKey: createKey,
    });
    const replayCreate = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.CUSTOMER,
          partyUserId: fx.customerId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-idem2-${randomUUID().slice(0, 8)}`,
      idempotencyKey: createKey,
    });
    expect(replayCreate.idempotent).toBe(true);
    expect(replayCreate.determination.id).toBe(first.determination.id);
    const finKey = `s15b-idem-f-${randomUUID()}`;
    const fin = await exceptions.finalizeDetermination({
      determinationId: first.determination.id,
      actorUserId: fx.adminId,
      correlationId: `s15b-idemf1-${randomUUID().slice(0, 8)}`,
      idempotencyKey: finKey,
    });
    const replayFin = await exceptions.finalizeDetermination({
      determinationId: first.determination.id,
      actorUserId: fx.adminId,
      correlationId: `s15b-idemf2-${randomUUID().slice(0, 8)}`,
      idempotencyKey: finKey,
    });
    expect(replayFin.idempotent).toBe(true);
    expect(
      await prisma.liabilityDetermination.count({
        where: { exceptionClaimId: claimId },
      }),
    ).toBe(1);
    expect(
      await prisma.exceptionFinancialObligation.count({
        where: {
          exceptionClaimId: claimId,
          status: ExceptionFinancialObligationStatus.OPEN,
        },
      }),
    ).toBe(
      await prisma.exceptionFinancialObligation.count({
        where: { exceptionClaimId: claimId },
      }),
    );
    expect(fin.determination.id).toBe(replayFin.determination.id);
  });

  it('adjustment applies the same membership gate', async () => {
    const fx = await seedRecovery();
    const claimId = (await openClaim(fx)).claim.id as string;
    await readyClaim(fx, claimId);
    const created = await exceptions.createDetermination({
      claimId,
      actorUserId: fx.adminId,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.CUSTOMER,
          partyUserId: fx.customerId,
          amount: '400.00',
        },
      ],
      correlationId: `s15b-adj1-${randomUUID().slice(0, 8)}`,
    });
    await exceptions.finalizeDetermination({
      determinationId: created.determination.id,
      actorUserId: fx.adminId,
      correlationId: `s15b-adjf-${randomUUID().slice(0, 8)}`,
    });
    await expectCode(
      exceptions.createAdjustment({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        reason: 'attempt rider successor',
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '100.00',
          },
        ],
        correlationId: `s15b-adjr-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.ALLOCATION_RIDER_NOT_ELIGIBLE,
    );
    const adj = await exceptions.createAdjustment({
      determinationId: created.determination.id,
      actorUserId: fx.adminId,
      reason: 'canonical merchant successor',
      allocations: [
        {
          partyType: ExceptionLiablePartyType.MERCHANT,
          partyMerchantId: fx.merchantId,
          amount: '100.00',
        },
      ],
      correlationId: `s15b-adjm-${randomUUID().slice(0, 8)}`,
    });
    expect(adj.code).toBe('LIABILITY_DETERMINATION_CREATED');
  });
});
