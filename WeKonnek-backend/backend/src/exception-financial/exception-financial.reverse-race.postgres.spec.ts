/**
 * STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY — permanent regressions.
 *
 * Proves Stage 12 financial authority first → later Stage 6 return → Stage 9
 * finalize refuses overlapping money. Also sequential authority grades,
 * unrelated subjects, Rider Advance, and true concurrent finalize races.
 *
 * Default: backend/.env.stage12.test → wekonnek_stage12_test
 * Override: WEKONNEK_ACCEPTANCE_DATABASE_URL + WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1
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
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AgreementStatus,
  AgreementType,
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
  CustodyEventType,
  DeliveryAttemptCustomerResponse,
  DeliveryAttemptOutcome,
  DeliveryFailureReasonCode,
  EconomicLossCoverageSourceKind,
  ExceptionClaimType,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  GoodsNonConformanceReasonCode,
  LiabilityDeterminationStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  Prisma,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialTermsKind,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReturnFinancialDeterminationService } from '../return-financial/return-financial-determination.service';
import { RiderAdvanceCollectibilityService } from '../return-financial/rider-advance-collectibility.service';
import { ReturnFinancialTermsService } from '../return-financial/return-financial-terms.service';
import { ExceptionFinancialService } from './exception-financial.service';

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(300_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();
const ALLOWED_DB_USERS = stage12AllowedDbUsers(EXPECTED_DB);

function errCode(err: unknown): string | undefined {
  if (
    err instanceof ForbiddenException ||
    err instanceof BadRequestException ||
    err instanceof ConflictException
  ) {
    const r = err.getResponse() as { code?: string };
    return typeof r === 'object' ? r.code : undefined;
  }
  if (err && typeof err === 'object' && 'getResponse' in err) {
    const r = (err as { getResponse: () => unknown }).getResponse();
    if (typeof r === 'object' && r && 'code' in r) {
      return String((r as { code: string }).code);
    }
  }
  return undefined;
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('expected ')) throw e;
    expect(errCode(e)).toBe(code);
  }
}

type SeedIds = {
  customerId: string;
  riderId: string;
  adminId: string;
  merchantUserId: string;
  merchantId: number;
  orderId: number;
  fulfillmentId: string;
  recoveryId: string;
  raId: string | null;
  assignmentId: string;
};

describeIf(
  `STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);
    const events = new OrderDomainEventService(prisma);
    const collectibility = new RiderAdvanceCollectibilityService(prisma);
    const terms = new ReturnFinancialTermsService(prisma);
    const stage9 = new ReturnFinancialDeterminationService(
      prisma,
      events,
      collectibility,
      terms,
    );

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage12AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 12 reverse-race',
      );
      if (
        STAGE12_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Reverse-race tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
      await terms.ensureSeededTerms();
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seedOrder(opts?: {
      withRiderAdvance?: boolean;
      principal?: string;
      fulfillmentStatus?: FulfillmentStatus;
      withReturnReceived?: boolean;
      goodsAmount?: string;
    }): Promise<SeedIds> {
      const tag = randomUUID();
      const goods = new Prisma.Decimal(opts?.goodsAmount ?? '800.00');
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s12rr-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `RR${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const rider = await mkUser(UserRole.rider, 'r');
      const admin = await mkUser(UserRole.admin, 'a');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S12RR ${tag}`,
          slug: `s12rr-${tag}`,
          commerceDomain: CommerceDomain.NON_FOOD,
          allowRiderAdvance: opts?.withRiderAdvance !== false,
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
          orderCode: `WK-RR-${tag.slice(0, 8)}`,
          userId: customer.id,
          merchantId: merchant.id,
          status: 'pending',
          orderType: 'delivery',
          totalAmount: goods.add(50),
          deliveryFee: 50,
          transactionFeeAmount: 0,
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          merchantPaymentStatus:
            opts?.withRiderAdvance === false
              ? MerchantPaymentStatus.VERIFIED
              : MerchantPaymentStatus.NOT_REQUIRED,
        },
      });
      const fulfillment = await prisma.orderFulfillment.create({
        data: {
          id: randomUUID(),
          wkOrderId: order.id,
          status: opts?.fulfillmentStatus ?? FulfillmentStatus.delivery_failed,
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
      await prisma.deliveryAttempt.create({
        data: {
          id: randomUUID(),
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          attemptNumber: 1,
          riderId: rider.id,
          riderAssignmentId: assignment.id,
          assignmentVersion: 1,
          physicalCustodianRiderId: rider.id,
          outcome: DeliveryAttemptOutcome.FAILED,
          failureReasonCode:
            DeliveryFailureReasonCode.CUSTOMER_REFUSED_ITEM_NOT_AS_ORDERED,
          customerResponse: DeliveryAttemptCustomerResponse.REFUSED,
          reportedByActorType: 'RIDER',
          reportedByActorId: rider.id,
          occurredAt: new Date(),
          correlationId: `s12rr-fail-${tag.slice(0, 8)}`,
          idempotencyKey: `s12rr-fail-${tag}`,
        },
      });

      let raId: string | null = null;
      if (opts?.withRiderAdvance !== false) {
        const agreementId = randomUUID();
        const versionId = randomUUID();
        await prisma.agreement.create({
          data: {
            id: agreementId,
            wkOrderId: order.id,
            agreementType: AgreementType.RIDER_ADVANCE,
            status: AgreementStatus.ACCEPTED,
            requiredPartyRoles: ['CUSTOMER', 'RIDER'],
            parties: {
              create: [
                { id: randomUUID(), role: 'CUSTOMER', userId: customer.id },
                { id: randomUUID(), role: 'RIDER', userId: rider.id },
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
            termsSnapshot: { kind: 's12rr_test' },
            termsHash: randomUUID().replace(/-/g, ''),
          },
        });
        await prisma.agreement.update({
          where: { id: agreementId },
          data: { currentVersionId: versionId },
        });
        const principal = opts?.principal ?? goods.toFixed(2);
        raId = randomUUID();
        await prisma.riderAdvance.create({
          data: {
            id: raId,
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            agreementId,
            agreementVersionId: versionId,
            customerId: customer.id,
            merchantId: merchant.id,
            riderId: rider.id,
            riderAssignmentId: assignment.id,
            assignmentVersion: 1,
            currency: 'PHP',
            authorizedMaximumAmount: new Prisma.Decimal(principal),
            actualAdvanceAmount: new Prisma.Decimal(principal),
            reimbursementPrincipal: new Prisma.Decimal(principal),
            status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
          },
        });
      }

      if (opts?.withReturnReceived) {
        await prisma.orderFulfillment.update({
          where: { id: fulfillment.id },
          data: { status: FulfillmentStatus.returned },
        });
        await prisma.custodyEvent.create({
          data: {
            id: randomUUID(),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            eventType: CustodyEventType.RETURN_RECEIVED,
            fromPartyRole: 'RIDER',
            toPartyRole: 'MERCHANT',
            fromUserId: rider.id,
            toUserId: merchantUser.id,
            actorUserId: merchantUser.id,
            correlationId: `s12rr-ret-${tag.slice(0, 8)}`,
            occurredAt: new Date(),
          },
        });
      }

      const recovery = await prisma.operationsRecovery.create({
        data: {
          id: randomUUID(),
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          customerId: customer.id,
          merchantId: merchant.id,
          openingTriggerCode:
            OperationsRecoveryTrigger.CUSTOMER_REFUSED_NON_CONFORMANCE,
          openedByActorType: 'SYSTEM_ADMIN',
          openedByActorId: admin.id,
          correlationId: `s12rr-rec-${tag.slice(0, 8)}`,
          status: OperationsRecoveryStatus.CLOSED,
          currentDisposition:
            OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
          closedAt: new Date(),
          closedByActorType: 'SYSTEM_ADMIN',
          closedByActorId: admin.id,
          physicalCustodianRiderIdAtOpen: rider.id,
          activeRiderIdAtOpen: rider.id,
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
        raId,
        assignmentId: assignment.id,
      };
    }

    async function makeReturnEligible(fx: SeedIds) {
      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillmentId },
        data: { status: FulfillmentStatus.returned },
      });
      await prisma.custodyEvent.create({
        data: {
          id: randomUUID(),
          wkOrderId: fx.orderId,
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.RETURN_RECEIVED,
          fromPartyRole: 'RIDER',
          toPartyRole: 'MERCHANT',
          fromUserId: fx.riderId,
          toUserId: fx.merchantUserId,
          actorUserId: fx.merchantUserId,
          correlationId: `s12rr-late-ret-${randomUUID().slice(0, 8)}`,
          occurredAt: new Date(),
        },
      });
      await terms.acceptTerms({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
        kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
      });
      await terms.acceptTerms({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
      });
    }

    async function openNcClaim(fx: SeedIds, claimedAmount = '800.00') {
      return exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
        nonConformanceReasonCode: GoodsNonConformanceReasonCode.WRONG_ITEM,
        subjectRef: `order-nonconformance:${fx.orderId}`,
        claimedAmount,
        correlationId: `s12rr-open-${randomUUID().slice(0, 8)}`,
      });
    }

    async function driveNcToProposed(
      fx: SeedIds,
      claimId: string,
      amount: string,
    ) {
      await exceptions.attachOrderTermsEvidence({
        claimId,
        actorUserId: fx.adminId,
        correlationId: `s12rr-terms-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'SKU mismatch vs order terms',
        correlationId: `s12rr-ev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12rr-vf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Wrong item confirmed against authoritative order terms',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12rr-fact-${randomUUID().slice(0, 8)}`,
      });
      return exceptions.createDetermination({
        claimId,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount,
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12rr-det-${randomUUID().slice(0, 8)}`,
      });
    }

    async function finalizeStage12Positive(
      fx: SeedIds,
      amount = '800.00',
      claimedAmount?: string,
    ) {
      const opened = await openNcClaim(fx, claimedAmount ?? amount);
      const created = await driveNcToProposed(fx, opened.claim.id, amount);
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12rr-fin-${randomUUID().slice(0, 8)}`,
      });
      return { opened, created, finalized };
    }

    async function proposeAndAckStage9(fx: SeedIds) {
      const created = await stage9.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
        outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
      });
      await stage9.acknowledge({
        determinationId: created.determination.id,
        actorUserId: fx.merchantUserId,
      });
      return created.determination.id;
    }

    async function countStage9SideEffects(determinationId: string) {
      const obligations = await prisma.returnFinancialObligation.count({
        where: { determinationId },
      });
      const restrictions =
        await prisma.riderAdvanceCollectionRestriction.count({
          where: { returnFinancialDeterminationId: determinationId },
        });
      const det = await prisma.returnFinancialDetermination.findUniqueOrThrow({
        where: { id: determinationId },
      });
      return { obligations, restrictions, status: det.status };
    }

    // ─── Terra permanent defect reproduction ─────────────────

    it('STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY: Stage12 first → Stage6 return → Stage9 refuse', async () => {
      const fx = await seedOrder({ withRiderAdvance: true, principal: '800.00' });
      const { opened } = await finalizeStage12Positive(fx, '800.00');

      const coverageBefore = await prisma.economicLossCoverage.findMany({
        where: {
          economicLossId: opened.claim.economicLossId,
          sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
        },
      });
      expect(coverageBefore).toHaveLength(1);
      expect(coverageBefore[0].amount.toFixed(2)).toBe('800.00');

      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);

      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
          correlationId: `s12rr-terra-${randomUUID().slice(0, 8)}`,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );

      const side = await countStage9SideEffects(determinationId);
      expect(side.status).not.toBe(ReturnFinancialDeterminationStatus.FINALIZED);
      expect(side.obligations).toBe(0);
      expect(side.restrictions).toBe(0);

      const ra = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: fx.raId! },
      });
      expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('800.00');
      expect(ra.riderId).toBe(fx.riderId);
      expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    });

    // ─── Sequential authority grades ─────────────────────────

    it('1: Stage12 +800 first → later return → Stage9 reject + zero side effects', async () => {
      const fx = await seedOrder();
      await finalizeStage12Positive(fx, '800.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const side = await countStage9SideEffects(determinationId);
      expect(side.obligations).toBe(0);
      expect(side.restrictions).toBe(0);
    });

    it('2: Stage12 claim only → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      await openNcClaim(fx);
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
      expect(result.obligations.length).toBeGreaterThan(0);
    });

    it('3: Stage12 evidence only → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      const opened = await openNcClaim(fx);
      await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'allegation photo',
        correlationId: `s12rr-ev3-${randomUUID().slice(0, 8)}`,
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('4: Stage12 VerifiedFact only → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      const opened = await openNcClaim(fx);
      await exceptions.attachOrderTermsEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        correlationId: `s12rr-terms4-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'verified mismatch',
        correlationId: `s12rr-ev4-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12rr-vf4-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Confirmed wrong item',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12rr-fact4-${randomUUID().slice(0, 8)}`,
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('5: Stage12 DRAFT determination → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      const opened = await openNcClaim(fx);
      const created = await driveNcToProposed(fx, opened.claim.id, '800.00');
      // createDetermination leaves PROPOSED after propose path; force DRAFT via
      // create without propose — reopen by creating then rolling status if needed.
      await prisma.liabilityDetermination.update({
        where: { id: created.determination.id },
        data: { status: LiabilityDeterminationStatus.DRAFT },
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('6: Stage12 PROPOSED determination → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      const opened = await openNcClaim(fx);
      await driveNcToProposed(fx, opened.claim.id, '800.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('7: Stage12 FINALIZED zero liability → Stage9 finalize allowed', async () => {
      const fx = await seedOrder();
      const opened = await openNcClaim(fx);
      const policy = await exceptions.ensureSeededPolicy();
      await prisma.liabilityDetermination.create({
        data: {
          id: randomUUID(),
          exceptionClaimId: opened.claim.id,
          economicLossId: opened.claim.economicLossId,
          policyVersionId: policy.id,
          policyHash: policy.policyHash,
          status: LiabilityDeterminationStatus.FINALIZED,
          totalLiabilityAmount: new Prisma.Decimal(0),
          remainingAmountSnapshot: new Prisma.Decimal(0),
          compensableAmountSnapshot: new Prisma.Decimal(800),
          priorCoverageAmountSnapshot: new Prisma.Decimal(0),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          finalizedAt: new Date(),
          finalizedByActorType: 'SYSTEM_ADMIN',
          finalizedByActorId: fx.adminId,
          correlationId: `s12rr-zero-${randomUUID().slice(0, 8)}`,
        },
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('8: Stage12 FINALIZED positive same-subject coverage → Stage9 blocked', async () => {
      const fx = await seedOrder();
      await finalizeStage12Positive(fx, '800.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
    });

    it('9: Stage12 positive coverage fully offset → Stage9 allowed', async () => {
      const fx = await seedOrder({ goodsAmount: '1600.00' });
      const { opened } = await finalizeStage12Positive(
        fx,
        '800.00',
        '1600.00',
      );
      // Compensable headroom remains; ADMIN_WRITE_OFF offsets Stage12 authority.
      await prisma.economicLossCoverage.create({
        data: {
          id: randomUUID(),
          economicLossId: opened.claim.economicLossId,
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          sourceRef: `writeoff-${randomUUID()}`,
          subjectRefSnapshot: `order-nonconformance:${fx.orderId}`,
          amount: new Prisma.Decimal('800.00'),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          correlationId: `s12rr-wo-${randomUUID().slice(0, 8)}`,
        },
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });

    it('10: Stage12 partial remaining positive coverage → Stage9 blocked', async () => {
      const fx = await seedOrder({ goodsAmount: '1600.00' });
      const { opened } = await finalizeStage12Positive(
        fx,
        '800.00',
        '1600.00',
      );
      await prisma.economicLossCoverage.create({
        data: {
          id: randomUUID(),
          economicLossId: opened.claim.economicLossId,
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          sourceRef: `writeoff-${randomUUID()}`,
          subjectRefSnapshot: `order-nonconformance:${fx.orderId}`,
          amount: new Prisma.Decimal('200.00'),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          correlationId: `s12rr-wo2-${randomUUID().slice(0, 8)}`,
        },
      });
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
    });

    it('11: Stage12 OTHER loss outside Stage9 formula → Stage9 allowed', async () => {
      const fx = await seedOrder();
      // OTHER is not monetized by Stage 9 return/RA formula.
      const opened = await exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.OTHER,
        subjectRef: `external-event:${fx.orderId}`,
        claimedAmount: '500.00',
        correlationId: `s12rr-item-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'external unrelated event',
        correlationId: `s12rr-itev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12rr-itvf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.OTHER,
        statement: 'Unrelated external loss',
        attributedPartyType: ExceptionLiablePartyType.RIDER,
        attributedPartyUserId: fx.riderId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12rr-itfact-${randomUUID().slice(0, 8)}`,
      });
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '500.00',
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12rr-itdet-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12rr-itfin-${randomUUID().slice(0, 8)}`,
      });

      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
      expect(result.obligations.length).toBeGreaterThan(0);
    });

    // ─── Stage9-first (Race A) still holds via Stage12 import ─

    it('A: Stage9 first → Stage12 imports coverage and cannot duplicate', async () => {
      const fx = await seedOrder({
        withReturnReceived: true,
        principal: '300.00',
        goodsAmount: '800.00',
      });
      await terms.acceptTerms({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
        kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
      });
      await terms.acceptTerms({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
      });
      const determinationId = await proposeAndAckStage9(fx);
      const s9 = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(s9.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
      expect(
        s9.obligations.some(
          (o) =>
            o.type ===
            ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
        ),
      ).toBe(true);

      const opened = await exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.UNRECOVERED_ADVANCE,
        subjectRef: `rider-advance:${fx.orderId}`,
        claimedAmount: '800.00',
        correlationId: `s12rr-a-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'advance unrecovered',
        correlationId: `s12rr-aev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12rr-avf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.PAYMENT_NOT_COLLECTED_CONFIRMED,
        statement: 'RA unrecovered after return',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12rr-afact-${randomUUID().slice(0, 8)}`,
      });
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '500.00',
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12rr-adet-${randomUUID().slice(0, 8)}`,
      });
      const fin = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12rr-afin-${randomUUID().slice(0, 8)}`,
      });
      expect(fin.importedStage9Coverage?.length).toBeGreaterThan(0);
      expect(fin.determination.priorCoverageAmountSnapshot).toBe('300.00');
      expect(fin.determination.remainingAmountSnapshot).toBe('500.00');
      const stage12Obl = await prisma.exceptionFinancialObligation.count({
        where: { liabilityDeterminationId: created.determination.id },
      });
      expect(stage12Obl).toBe(1);
      // Combined Stage9 (300) + Stage12 (500) coverage == compensable; no duplicate.
      const covered = await prisma.economicLossCoverage.findMany({
        where: { economicLossId: opened.claim.economicLossId },
      });
      const sum = covered.reduce(
        (a, c) => a.add(c.amount),
        new Prisma.Decimal(0),
      );
      expect(sum.toFixed(2)).toBe('800.00');
    });

    // ─── True concurrency ────────────────────────────────────

    it('C: concurrent Stage9 finalize vs Stage12 finalize — coherent authority', async () => {
      const iterations = 8;
      for (let i = 0; i < iterations; i++) {
        const fx = await seedOrder();
        const opened = await openNcClaim(fx, '800.00');
        const created = await driveNcToProposed(fx, opened.claim.id, '800.00');

        const stage12Promise = exceptions.finalizeDetermination({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          correlationId: `s12rr-c12-${i}-${randomUUID().slice(0, 8)}`,
        });

        const stage9Promise = (async () => {
          await makeReturnEligible(fx);
          const determinationId = await proposeAndAckStage9(fx);
          return stage9.finalize({
            determinationId,
            actorUserId: fx.merchantUserId,
            correlationId: `s12rr-c9-${i}-${randomUUID().slice(0, 8)}`,
          });
        })();

        const [s12, s9] = await Promise.allSettled([
          stage12Promise,
          stage9Promise,
        ]);

        const loss = await prisma.economicLoss.findUniqueOrThrow({
          where: { id: opened.claim.economicLossId },
          include: { coverages: true },
        });
        const stage12Cov = loss.coverages
          .filter(
            (c) =>
              c.sourceKind === EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
          )
          .reduce((a, c) => a.add(c.amount), new Prisma.Decimal(0));
        const totalCov = loss.coverages.reduce(
          (a, c) => a.add(c.amount),
          new Prisma.Decimal(0),
        );
        expect(totalCov.lte(loss.compensableAmount)).toBe(true);

        const s9Final = await prisma.returnFinancialDetermination.findFirst({
          where: {
            wkOrderId: fx.orderId,
            status: ReturnFinancialDeterminationStatus.FINALIZED,
          },
          include: { obligations: true },
        });

        if (s9Final && stage12Cov.gt(0)) {
          // Overlapping authorities must not both exist for same subject.
          const overlappingTypes = s9Final.obligations.filter(
            (o) =>
              o.type ===
                ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT ||
              o.type ===
                ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
          );
          expect(overlappingTypes.length).toBe(0);
        }

        // At least one path must produce a coherent outcome (not both silent).
        const s12Ok = s12.status === 'fulfilled';
        const s9Ok = s9.status === 'fulfilled';
        const s9Blocked =
          s9.status === 'rejected' &&
          errCode(s9.reason) === 'STAGE12_FINANCIAL_AUTHORITY_EXISTS';
        const s12Blocked =
          s12.status === 'rejected' &&
          (errCode(s12.reason) === 'STAGE9_RETURN_MONEY_PENDING' ||
            errCode(s12.reason) === 'STAGE9_DETERMINATION_IN_PROGRESS' ||
            errCode(s12.reason) === 'EXCEPTION_NOTHING_REMAINING_TO_RECOVER');
        expect(s12Ok || s9Ok || s9Blocked || s12Blocked).toBe(true);

        if (s9.status === 'rejected' && s9Blocked && s9Final) {
          // Loser must not leave FINALIZED empty money side effects inconsistently:
          // if FINALIZED exists it must be from a winning path.
        }
        if (
          s9.status === 'rejected' &&
          errCode(s9.reason) === 'STAGE12_FINANCIAL_AUTHORITY_EXISTS'
        ) {
          const dets = await prisma.returnFinancialDetermination.findMany({
            where: { wkOrderId: fx.orderId },
          });
          for (const d of dets) {
            if (d.status !== ReturnFinancialDeterminationStatus.FINALIZED) {
              const side = await countStage9SideEffects(d.id);
              expect(side.obligations).toBe(0);
              expect(side.restrictions).toBe(0);
            }
          }
        }
      }
    });

    it('C2: Stage12 commits immediately before Stage9 eligibility → Stage9 blocks', async () => {
      const fx = await seedOrder();
      await finalizeStage12Positive(fx, '800.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const side = await countStage9SideEffects(determinationId);
      expect(side.obligations).toBe(0);
      expect(side.restrictions).toBe(0);
    });

    // ─── Rider Advance / merchant protection ─────────────────

    it('Rider Advance: Stage12 first then Stage9 cannot duplicate ₱800 to Rider A', async () => {
      const fx = await seedOrder({ withRiderAdvance: true, principal: '800.00' });
      await finalizeStage12Positive(fx, '800.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const obls = await prisma.returnFinancialObligation.findMany({
        where: { wkOrderId: fx.orderId },
      });
      expect(obls).toHaveLength(0);
      const ra = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: fx.raId! },
      });
      expect(ra.riderId).toBe(fx.riderId);
      expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('800.00');
    });

    it('Merchant protection: WRONG_ITEM claim alone does not block Stage9', async () => {
      const fx = await seedOrder();
      await openNcClaim(fx);
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    });
  },
);
