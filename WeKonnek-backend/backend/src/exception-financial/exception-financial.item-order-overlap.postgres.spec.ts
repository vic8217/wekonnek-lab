/**
 * STAGE12_ITEM_LEVEL_STAGE9_ORDER_LEVEL_DOUBLE_RECOVERY — permanent regressions.
 *
 * Stage 9 is WHOLE_ORDER financial authority. Positive effective Stage 12
 * coverage on any economically contained sub-scope (order-item / quantity /
 * non-conformance item) must block Stage 9 whole-order finalize — no auto-net.
 *
 * Default: .env.stage12.test; override via WEKONNEK_ACCEPTANCE_DATABASE_URL.
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
  EconomicLossKind,
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
import {
  buildStage9EconomicScope,
  effectiveStage12CoverageAmount,
} from './exception-financial.policy';
import { ExceptionFinancialService } from './exception-financial.service';

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(360_000);

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
  goodsAmount: string;
};

describeIf(
  `STAGE12_ITEM_LEVEL_STAGE9_ORDER_LEVEL_DOUBLE_RECOVERY (${EXPECTED_DB})`,
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
        'Stage 12 item/order overlap',
      );
      if (
        STAGE12_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Item/order overlap tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
      await terms.ensureSeededTerms();
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seedOrder(opts?: {
      withRiderAdvance?: boolean;
      principal?: string;
      goodsAmount?: string;
      withReturnReceived?: boolean;
      reimbursed?: string;
    }): Promise<SeedIds> {
      const tag = randomUUID();
      const goods = new Prisma.Decimal(opts?.goodsAmount ?? '800.00');
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s12io-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `IO${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const rider = await mkUser(UserRole.rider, 'r');
      const admin = await mkUser(UserRole.admin, 'a');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S12IO ${tag}`,
          slug: `s12io-${tag}`,
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
          orderCode: `WK-IO-${tag.slice(0, 8)}`,
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
          status: opts?.withReturnReceived
            ? FulfillmentStatus.returned
            : FulfillmentStatus.delivery_failed,
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
          correlationId: `s12io-fail-${tag.slice(0, 8)}`,
          idempotencyKey: `s12io-fail-${tag}`,
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
            termsSnapshot: { kind: 's12io_test' },
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
        if (opts?.reimbursed && Number(opts.reimbursed) > 0) {
          await prisma.riderAdvanceSettlement.create({
            data: {
              id: randomUUID(),
              riderAdvanceId: raId,
              wkOrderId: order.id,
              customerId: customer.id,
              creditorRiderId: rider.id,
              method: 'CASH',
              status: 'ACKNOWLEDGED',
              claimedAmount: new Prisma.Decimal(opts.reimbursed),
              acknowledgedAmount: new Prisma.Decimal(opts.reimbursed),
              claimedAt: new Date(),
              acknowledgedAt: new Date(),
              claimedByUserId: rider.id,
              acknowledgedByUserId: rider.id,
            },
          });
        }
      }

      if (opts?.withReturnReceived) {
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
            correlationId: `s12io-ret-${tag.slice(0, 8)}`,
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
          correlationId: `s12io-rec-${tag.slice(0, 8)}`,
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
        goodsAmount: goods.toFixed(2),
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
          correlationId: `s12io-late-ret-${randomUUID().slice(0, 8)}`,
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

    async function openItemGoodsLoss(
      fx: SeedIds,
      subjectRef: string,
      claimedAmount: string,
    ) {
      return exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.GOODS_LOSS,
        subjectRef,
        claimedAmount,
        correlationId: `s12io-open-${randomUUID().slice(0, 8)}`,
      });
    }

    async function driveItemLossToProposed(
      fx: SeedIds,
      claimId: string,
      amount: string,
    ) {
      const evidence = await exceptions.addEvidence({
        claimId,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'item-level loss evidence',
        correlationId: `s12io-ev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12io-vf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Item-level goods loss confirmed',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12io-fact-${randomUUID().slice(0, 8)}`,
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
        correlationId: `s12io-det-${randomUUID().slice(0, 8)}`,
      });
    }

    async function finalizeItemStage12(
      fx: SeedIds,
      subjectRef: string,
      amount: string,
    ) {
      const opened = await openItemGoodsLoss(fx, subjectRef, amount);
      const created = await driveItemLossToProposed(
        fx,
        opened.claim.id,
        amount,
      );
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-fin-${randomUUID().slice(0, 8)}`,
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

    async function combinedAuthorityForOrder(fx: SeedIds) {
      const losses = await prisma.economicLoss.findMany({
        where: { wkOrderId: fx.orderId },
        include: { coverages: true },
      });
      let stage12Effective = new Prisma.Decimal(0);
      for (const loss of losses) {
        if (loss.lossKind === EconomicLossKind.OTHER) continue;
        stage12Effective = stage12Effective.add(
          effectiveStage12CoverageAmount(loss.coverages),
        );
      }
      const s9 = await prisma.returnFinancialDetermination.findFirst({
        where: {
          wkOrderId: fx.orderId,
          status: ReturnFinancialDeterminationStatus.FINALIZED,
        },
        include: { obligations: true },
      });
      let stage9Principal = new Prisma.Decimal(0);
      for (const o of s9?.obligations ?? []) {
        stage9Principal = stage9Principal.add(o.principal);
      }
      return {
        stage12Effective,
        stage9Principal,
        combined: stage12Effective.add(stage9Principal),
        goodsAmount: new Prisma.Decimal(fx.goodsAmount),
      };
    }

    // ─── Named Terra defect ──────────────────────────────────

    it('STAGE12_ITEM_LEVEL_STAGE9_ORDER_LEVEL_DOUBLE_RECOVERY: Item A ₱500 then Stage9 ₱800 BLOCK', async () => {
      const fx = await seedOrder({ goodsAmount: '800.00', principal: '800.00' });
      await finalizeItemStage12(fx, `order-item:A-${fx.orderId}`, '500.00');
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
      expect(side.status).not.toBe(ReturnFinancialDeterminationStatus.FINALIZED);
      expect(side.obligations).toBe(0);
      const auth = await combinedAuthorityForOrder(fx);
      expect(auth.stage12Effective.toFixed(2)).toBe('500.00');
      expect(auth.stage9Principal.toFixed(2)).toBe('0.00');
      expect(auth.combined.lte(auth.goodsAmount)).toBe(true);
    });

    it('1: Stage12 Item A ₱500 FINALIZED → Stage9 whole-order BLOCK', async () => {
      const fx = await seedOrder();
      await finalizeItemStage12(fx, `order-item:A-${fx.orderId}`, '500.00');
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

    it('2: Stage12 Item A claim only → Stage9 allowed', async () => {
      const fx = await seedOrder();
      await openItemGoodsLoss(fx, `order-item:A-${fx.orderId}`, '500.00');
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

    it('3: Stage12 Item A evidence only → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '500.00',
      );
      await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'allegation only',
        correlationId: `s12io-ev3-${randomUUID().slice(0, 8)}`,
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

    it('4: Stage12 Item A VerifiedFact only → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '500.00',
      );
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'fact only',
        correlationId: `s12io-ev4-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12io-vf4-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Confirmed item loss',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12io-fact4-${randomUUID().slice(0, 8)}`,
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

    it('5: Stage12 Item A draft/proposed → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '500.00',
      );
      await driveItemLossToProposed(fx, opened.claim.id, '500.00');
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

    it('6: Stage12 Item A finalized zero coverage → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '500.00',
      );
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
          compensableAmountSnapshot: new Prisma.Decimal(500),
          priorCoverageAmountSnapshot: new Prisma.Decimal(0),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          finalizedAt: new Date(),
          finalizedByActorType: 'SYSTEM_ADMIN',
          finalizedByActorId: fx.adminId,
          correlationId: `s12io-zero-${randomUUID().slice(0, 8)}`,
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

    it('7: Stage12 Item A +₱500 then −₱500 effective zero → Stage9 allowed', async () => {
      const fx = await seedOrder({ goodsAmount: '1600.00' });
      // Compensable 1000 so +500 Stage12 + 500 write-off fits the ceiling.
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '1000.00',
      );
      const created = await driveItemLossToProposed(
        fx,
        opened.claim.id,
        '500.00',
      );
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-fin7-${randomUUID().slice(0, 8)}`,
      });
      await prisma.economicLossCoverage.create({
        data: {
          id: randomUUID(),
          economicLossId: opened.claim.economicLossId,
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          sourceRef: `wo-${randomUUID()}`,
          subjectRefSnapshot: `order-item:A-${fx.orderId}`,
          amount: new Prisma.Decimal('500.00'),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          correlationId: `s12io-wo-${randomUUID().slice(0, 8)}`,
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

    it('8: Stage12 Item A effective ₱300 → Stage9 whole-order blocked', async () => {
      const fx = await seedOrder({ goodsAmount: '1600.00' });
      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '1000.00',
      );
      const created = await driveItemLossToProposed(
        fx,
        opened.claim.id,
        '500.00',
      );
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-fin8-${randomUUID().slice(0, 8)}`,
      });
      await prisma.economicLossCoverage.create({
        data: {
          id: randomUUID(),
          economicLossId: opened.claim.economicLossId,
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          sourceRef: `wo-${randomUUID()}`,
          subjectRefSnapshot: `order-item:A-${fx.orderId}`,
          amount: new Prisma.Decimal('200.00'),
          currency: 'PHP',
          createdByActorType: 'SYSTEM_ADMIN',
          createdByActorId: fx.adminId,
          correlationId: `s12io-wo2-${randomUUID().slice(0, 8)}`,
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

    it('9: Stage12 OTHER loss outside Stage9 scope → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const opened = await exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.OTHER,
        subjectRef: `external-event:${fx.orderId}`,
        claimedAmount: '200.00',
        correlationId: `s12io-other-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'outside formula',
        correlationId: `s12io-oev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12io-ovf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.OTHER,
        statement: 'Outside Stage9 formula',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12io-ofact-${randomUUID().slice(0, 8)}`,
      });
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '200.00',
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12io-odet-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-ofin-${randomUUID().slice(0, 8)}`,
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

    it('10: Stage12 loss on different order → Stage9 allowed', async () => {
      const fx = await seedOrder();
      const other = await seedOrder();
      await finalizeItemStage12(
        other,
        `order-item:A-${other.orderId}`,
        '500.00',
      );
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

    it('11: Partial quantity Stage12 coverage contained → Stage9 blocked', async () => {
      const fx = await seedOrder({ goodsAmount: '800.00' });
      // Qty encoding: one unit of Item A (₱250 of ₱500 line).
      await finalizeItemStage12(
        fx,
        `order-item:A-${fx.orderId}:unit:1`,
        '250.00',
      );
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const auth = await combinedAuthorityForOrder(fx);
      expect(auth.stage12Effective.toFixed(2)).toBe('250.00');
      expect(auth.stage9Principal.toFixed(2)).toBe('0.00');
    });

    it('12: Item-level non-conformance Stage12 + later full return → Stage9 blocked', async () => {
      const fx = await seedOrder();
      const opened = await exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
        nonConformanceReasonCode: GoodsNonConformanceReasonCode.WRONG_ITEM,
        subjectRef: `order-item:A-${fx.orderId}`,
        claimedAmount: '500.00',
        correlationId: `s12io-nc-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.attachOrderTermsEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-nct-${randomUUID().slice(0, 8)}`,
      });
      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'wrong item A',
        correlationId: `s12io-ncev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12io-ncvf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Item A wrong',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12io-ncfact-${randomUUID().slice(0, 8)}`,
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
        correlationId: `s12io-ncdet-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12io-ncfin-${randomUUID().slice(0, 8)}`,
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

    it('13: Item-level Stage12 + Stage9 RA economics — no duplicate principal', async () => {
      const fx = await seedOrder({ principal: '800.00', goodsAmount: '800.00' });
      await finalizeItemStage12(fx, `order-item:A-${fx.orderId}`, '500.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const ra = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: fx.raId! },
      });
      expect(ra.riderId).toBe(fx.riderId);
      expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('800.00');
      const auth = await combinedAuthorityForOrder(fx);
      expect(auth.combined.toFixed(2)).toBe('500.00');
    });

    it('14: Normal Stage9 P800/R300 with no Stage12 overlap unchanged', async () => {
      const fx = await seedOrder({
        principal: '800.00',
        goodsAmount: '800.00',
        reimbursed: '300.00',
        withReturnReceived: true,
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
      const result = await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });
      expect(result.determination.merchantToRiderAmount?.toFixed(2)).toBe(
        '500.00',
      );
      expect(result.determination.merchantToCustomerAmount?.toFixed(2)).toBe(
        '300.00',
      );
      const types = result.obligations.map((o) => o.type).sort();
      expect(types).toEqual(
        [
          ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
          ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
        ].sort(),
      );
    });

    it('15: Stage9 first → later Stage12 item-level cannot duplicate', async () => {
      const fx = await seedOrder({
        withReturnReceived: true,
        principal: '800.00',
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
      await stage9.finalize({
        determinationId,
        actorUserId: fx.merchantUserId,
      });

      const opened = await openItemGoodsLoss(
        fx,
        `order-item:A-${fx.orderId}`,
        '500.00',
      );
      const created = await driveItemLossToProposed(
        fx,
        opened.claim.id,
        '500.00',
      );
      await expectCode(
        exceptions.finalizeDetermination({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          correlationId: `s12io-s9first-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NOTHING_REMAINING_TO_RECOVER',
      );
      const stage12Obl = await prisma.exceptionFinancialObligation.count({
        where: { liabilityDeterminationId: created.determination.id },
      });
      expect(stage12Obl).toBe(0);
      // Import may roll back with NOTHING_REMAINING — Stage9 authority alone
      // must still bound the order goods principal.
      const auth = await combinedAuthorityForOrder(fx);
      expect(auth.stage9Principal.toFixed(2)).toBe('800.00');
      expect(auth.combined.lte(auth.goodsAmount.add(auth.stage9Principal))).toBe(
        true,
      );
    });

    it('16: Stage12 item-level first → Stage9 order-level cannot duplicate', async () => {
      const fx = await seedOrder();
      await finalizeItemStage12(fx, `order-item:A-${fx.orderId}`, '500.00');
      await makeReturnEligible(fx);
      const determinationId = await proposeAndAckStage9(fx);
      await expectCode(
        stage9.finalize({
          determinationId,
          actorUserId: fx.merchantUserId,
        }),
        'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
      );
      const auth = await combinedAuthorityForOrder(fx);
      expect(auth.combined.toFixed(2)).toBe('500.00');
      expect(auth.combined.lte(auth.goodsAmount)).toBe(true);
    });

    it('17: True concurrent item-level vs order-level finalize', async () => {
      for (let i = 0; i < 6; i++) {
        const fx = await seedOrder();
        const opened = await openItemGoodsLoss(
          fx,
          `order-item:A-${fx.orderId}`,
          '500.00',
        );
        const created = await driveItemLossToProposed(
          fx,
          opened.claim.id,
          '500.00',
        );

        const stage12Promise = exceptions.finalizeDetermination({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          correlationId: `s12io-c12-${i}-${randomUUID().slice(0, 8)}`,
        });
        const stage9Promise = (async () => {
          await makeReturnEligible(fx);
          const determinationId = await proposeAndAckStage9(fx);
          return stage9.finalize({
            determinationId,
            actorUserId: fx.merchantUserId,
            correlationId: `s12io-c9-${i}-${randomUUID().slice(0, 8)}`,
          });
        })();

        await Promise.allSettled([stage12Promise, stage9Promise]);
        const auth = await combinedAuthorityForOrder(fx);
        // Never ₱500 + ₱800 for ₱800 goods.
        expect(auth.combined.lte(auth.goodsAmount)).toBe(true);
        if (auth.stage12Effective.gt(0) && auth.stage9Principal.gt(0)) {
          throw new Error(
            `overlapping authorities: s12=${auth.stage12Effective} s9=${auth.stage9Principal}`,
          );
        }
      }
    });

    it('18: Phantom insert race — Stage9 scan before Stage12 item loss insert', async () => {
      /**
       * Stage 9 EconomicLoss predicate scan runs before Stage 12 inserts
       * item-level coverage. Required invariant: never both overlapping
       * authorities. Production Stage 9 holds orders FOR UPDATE before the
       * scan (blocking Stage 12's order-first chain). This barrier test keeps
       * the EconomicLoss predicate open across Stage 12 finalize, then proves
       * the later Stage 9 service path still refuses.
       */
      let protectionSeen = false;

      for (let i = 0; i < 8; i++) {
        const fx = await seedOrder(); // not returned — Stage12 finalize allowed
        const scanned = deferred();
        const inserted = deferred();
        const scope = buildStage9EconomicScope({
          wkOrderId: fx.orderId,
          path: 'RIDER_ADVANCE',
          grossPrincipal: '800.00',
          merchantToRiderAmount: '800.00',
          merchantToCustomerAmount: '0.00',
          riderAdvanceId: fx.raId,
        });

        const txA = prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM "economic_losses"
              WHERE wk_order_id = ${fx.orderId}
                AND loss_kind::text IN (${Prisma.join(scope.includedLossKinds)})
              ORDER BY id
              FOR UPDATE
            `;
            scanned.resolve();
            await inserted.promise;
            // Touch orders so Serializable must reconcile with B's writes.
            await tx.$executeRaw`
              UPDATE "orders" SET updated_at = CURRENT_TIMESTAMP
              WHERE id = ${fx.orderId}
            `;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        const txB = (async () => {
          await scanned.promise;
          try {
            await finalizeItemStage12(
              fx,
              `order-item:A-${fx.orderId}`,
              '500.00',
            );
          } finally {
            inserted.resolve();
          }
        })();

        const [a, b] = await Promise.allSettled([txA, txB]);

        const auth = await combinedAuthorityForOrder(fx);
        if (auth.stage12Effective.gt(0) && auth.stage9Principal.gt(0)) {
          throw new Error(
            `phantom race allowed overlap s12=${auth.stage12Effective} s9=${auth.stage9Principal}`,
          );
        }
        expect(auth.combined.lte(auth.goodsAmount)).toBe(true);

        const aSerialized =
          a.status === 'rejected' &&
          /could not serialize|40001|40P01|P2034|serialization|concurrent update|deadlock/i.test(
            String(a.reason),
          );
        if (aSerialized || (b.status === 'fulfilled' && auth.stage12Effective.gt(0))) {
          protectionSeen = true;
        }

        await makeReturnEligible(fx);
        const determinationId = await proposeAndAckStage9(fx);
        await expectCode(
          stage9.finalize({
            determinationId,
            actorUserId: fx.merchantUserId,
          }),
          'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
        );
        const after = await combinedAuthorityForOrder(fx);
        expect(after.stage9Principal.toFixed(2)).toBe('0.00');
        expect(after.stage12Effective.gt(0)).toBe(true);
      }

      expect(protectionSeen).toBe(true);
    });

    it('18b: Reverse phantom — Stage12 item begins interleaved with Stage9', async () => {
      for (let i = 0; i < 6; i++) {
        const fx = await seedOrder();
        const opened = await openItemGoodsLoss(
          fx,
          `order-item:A-${fx.orderId}`,
          '500.00',
        );
        const created = await driveItemLossToProposed(
          fx,
          opened.claim.id,
          '500.00',
        );

        const results = await Promise.allSettled([
          exceptions.finalizeDetermination({
            determinationId: created.determination.id,
            actorUserId: fx.adminId,
            correlationId: `s12io-rp12-${i}-${randomUUID().slice(0, 8)}`,
          }),
          (async () => {
            await makeReturnEligible(fx);
            const determinationId = await proposeAndAckStage9(fx);
            return stage9.finalize({
              determinationId,
              actorUserId: fx.merchantUserId,
              correlationId: `s12io-rp9-${i}-${randomUUID().slice(0, 8)}`,
            });
          })(),
        ]);
        void results;

        const auth = await combinedAuthorityForOrder(fx);
        expect(auth.combined.lte(auth.goodsAmount)).toBe(true);
        if (auth.stage12Effective.gt(0) && auth.stage9Principal.gt(0)) {
          throw new Error('reverse phantom allowed overlap');
        }
      }
    });
  },
);
