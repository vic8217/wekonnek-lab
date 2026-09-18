/**
 * Stage 12 exception financial liability — PostgreSQL acceptance.
 * Default: backend/.env.stage12.test → wekonnek_stage12_test
 * Override: WEKONNEK_ACCEPTANCE_DATABASE_URL + WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1
 * (or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → wekonnek_stage12_regression_test).
 *
 * Cleanup policy: unique-UUID fixtures are left orphaned on the disposable DB.
 * Stage 12 history is append-only — never DISABLE TRIGGER, never DELETE
 * protected rows.
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
  NotFoundException,
} from '@nestjs/common';
import {
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  ExceptionClaimStatus,
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
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialPartyType,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderOperationalStateService } from '../order-operational-state/order-operational-state.service';
import {
  buildEconomicLossKey,
  maxImportableCoverage,
} from './exception-financial.policy';
import { ExceptionFinancialService } from './exception-financial.service';

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();
const ALLOWED_DB_USERS = stage12AllowedDbUsers(EXPECTED_DB);

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
  orderId: number;
  fulfillmentId: string;
  recoveryId: string;
};

describeIf(
  `Stage 12 Exception Financial Liability PostgreSQL (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);
    const operational = new OrderOperationalStateService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage12AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 12 postgres acceptance',
      );
      if (
        STAGE12_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage 12 tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    // ─── seed helpers (unique UUIDs, orphan cleanup) ────────

    async function seedRecovery(opts?: {
      disposition?: OperationsRecoveryDisposition;
      status?: OperationsRecoveryStatus;
      fulfillmentStatus?: FulfillmentStatus;
      withReturnReceived?: boolean;
      withRiderAdvance?: boolean;
      totalAmount?: string;
      deliveryFee?: string;
      transactionFeeAmount?: string;
    }): Promise<SeedIds> {
      const tag = randomUUID();
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s12-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `S12${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const rider = await mkUser(UserRole.rider, 'r');
      const admin = await mkUser(UserRole.admin, 'a');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const foreign = await mkUser(UserRole.customer, 'f');

      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S12 ${tag}`,
          slug: `s12-${tag}`,
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
          orderCode: `WK-S12-${tag.slice(0, 8)}`,
          userId: customer.id,
          merchantId: merchant.id,
          status: 'pending',
          orderType: 'delivery',
          totalAmount: new Prisma.Decimal(opts?.totalAmount ?? '1060.00'),
          deliveryFee: new Prisma.Decimal(opts?.deliveryFee ?? '50.00'),
          transactionFeeAmount: new Prisma.Decimal(
            opts?.transactionFeeAmount ?? '10.00',
          ),
          paymentMethod: 'cash',
          paymentStatus: 'pending',
          merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
          deliveryAddress: '123 Stage12 St, Manila',
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
      const assignment = await prisma.riderAssignment.create({
        data: {
          id: randomUUID(),
          fulfillmentId: fulfillment.id,
          riderId: rider.id,
          status: RiderAssignmentStatus.ACTIVE,
          assignmentVersion: 1,
        },
      });

      if (opts?.withReturnReceived) {
        await prisma.custodyEvent.create({
          data: {
            id: randomUUID(),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            eventType: 'RETURN_RECEIVED',
            fromPartyRole: 'RIDER',
            toPartyRole: 'MERCHANT',
            fromUserId: rider.id,
            toUserId: merchantUser.id,
            actorUserId: merchantUser.id,
            correlationId: `s12-ret-${tag}`,
            occurredAt: new Date(),
          },
        });
      }

      if (opts?.withRiderAdvance) {
        const agreementId = randomUUID();
        const versionId = randomUUID();
        await prisma.agreement.create({
          data: {
            id: agreementId,
            wkOrderId: order.id,
            agreementType: 'RIDER_ADVANCE',
            status: 'ACCEPTED',
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
            termsSnapshot: { kind: 's12_test' },
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
            authorizedMaximumAmount: new Prisma.Decimal('800.00'),
            actualAdvanceAmount: new Prisma.Decimal('800.00'),
            reimbursementPrincipal: new Prisma.Decimal('800.00'),
            status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
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
          openingTriggerCode: OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
          openedByActorType: 'SYSTEM_ADMIN',
          openedByActorId: admin.id,
          correlationId: `s12-rec-${tag.slice(0, 8)}`,
          status: opts?.status ?? OperationsRecoveryStatus.CLOSED,
          currentDisposition:
            opts?.disposition ??
            OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
          closedAt:
            (opts?.status ?? OperationsRecoveryStatus.CLOSED) ===
            OperationsRecoveryStatus.CLOSED
              ? new Date()
              : null,
          closedByActorType:
            (opts?.status ?? OperationsRecoveryStatus.CLOSED) ===
            OperationsRecoveryStatus.CLOSED
              ? 'SYSTEM_ADMIN'
              : null,
          closedByActorId:
            (opts?.status ?? OperationsRecoveryStatus.CLOSED) ===
            OperationsRecoveryStatus.CLOSED
              ? admin.id
              : null,
          closeReason: 'Stage 12 acceptance fixture',
        },
      });

      return {
        customerId: customer.id,
        riderId: rider.id,
        adminId: admin.id,
        merchantUserId: merchantUser.id,
        foreignId: foreign.id,
        merchantId: merchant.id,
        orderId: order.id,
        fulfillmentId: fulfillment.id,
        recoveryId: recovery.id,
      };
    }

    async function seedStage9Determination(
      fx: SeedIds,
      status: ReturnFinancialDeterminationStatus,
      opts?: {
        obligations?: Array<{
          type: ReturnFinancialObligationType;
          principal: string;
        }>;
      },
    ) {
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
          correlationId: `s12-s9-${randomUUID().slice(0, 8)}`,
          occurredAt: new Date(),
        },
      });
      const determination = await prisma.returnFinancialDetermination.create({
        data: {
          id: randomUUID(),
          wkOrderId: fx.orderId,
          fulfillmentId: fx.fulfillmentId,
          returnCustodyEventId: custodyEvent.id,
          status,
          path: 'RIDER_ADVANCE',
          outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
          finalizedAt:
            status === ReturnFinancialDeterminationStatus.FINALIZED
              ? new Date()
              : null,
          finalizedByActorType:
            status === ReturnFinancialDeterminationStatus.FINALIZED
              ? 'MERCHANT_OWNER'
              : null,
          finalizedByActorId:
            status === ReturnFinancialDeterminationStatus.FINALIZED
              ? fx.merchantUserId
              : null,
        },
      });
      for (const o of opts?.obligations ?? []) {
        await prisma.returnFinancialObligation.create({
          data: {
            id: randomUUID(),
            determinationId: determination.id,
            wkOrderId: fx.orderId,
            merchantId: fx.merchantId,
            type: o.type,
            debtorType: ReturnFinancialPartyType.MERCHANT,
            debtorMerchantId: fx.merchantId,
            creditorType:
              o.type ===
              ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT
                ? ReturnFinancialPartyType.RIDER
                : ReturnFinancialPartyType.CUSTOMER,
            creditorUserId:
              o.type ===
              ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT
                ? fx.riderId
                : fx.customerId,
            principal: new Prisma.Decimal(o.principal),
          },
        });
      }
      return determination;
    }

    async function openClaim(
      fx: SeedIds,
      opts?: {
        claimType?: ExceptionClaimType;
        subjectRef?: string;
        claimedAmount?: string | null;
        idempotencyKey?: string;
      },
    ) {
      return exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: opts?.claimType ?? ExceptionClaimType.GOODS_LOSS,
        subjectRef: opts?.subjectRef ?? `order-goods:${fx.orderId}`,
        claimedAmount: opts?.claimedAmount ?? null,
        correlationId: `s12-open-${randomUUID().slice(0, 8)}`,
        idempotencyKey: opts?.idempotencyKey,
      });
    }

    /** Drives a claim to the point where a determination may be created. */
    async function claimWithVerifiedFact(fx: SeedIds, claimId: string) {
      const evidence = await exceptions.addEvidence({
        claimId,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'goods missing at depot',
        correlationId: `s12-ev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12-vf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Goods confirmed lost while in rider custody',
        attributedPartyType: ExceptionLiablePartyType.RIDER,
        attributedPartyUserId: fx.riderId,
        supportingEvidenceId: evidence.evidenceId,
        correlationId: `s12-fact-${randomUUID().slice(0, 8)}`,
      });
      return {
        evidenceId: evidence.evidenceId,
        verifiedFactId: fact.verifiedFactId,
      };
    }

    // ─── 1: eligibility ─────────────────────────────────────

    it('1: opens a claim only from FINANCIAL_REVIEW_REQUIRED Stage 11 lineage', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      expect(opened.code).toBe('EXCEPTION_CLAIM_OPENED');
      expect(opened.claim.status).toBe(ExceptionClaimStatus.OPEN);
      expect(opened.claim.operationsRecoveryId).toBe(fx.recoveryId);

      const ineligible = await seedRecovery({
        disposition: OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
      });
      await expectCode(
        openClaim(ineligible),
        'EXCEPTION_CLAIM_RECOVERY_NOT_ELIGIBLE',
      );

      const stillOpen = await seedRecovery({
        status: OperationsRecoveryStatus.OPEN,
        disposition: OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
      });
      await expectCode(
        openClaim(stillOpen),
        'EXCEPTION_CLAIM_RECOVERY_NOT_ELIGIBLE',
      );
    });

    it('1b: DISPOSITION_SELECTED + FINANCIAL_REVIEW_REQUIRED is also eligible', async () => {
      const fx = await seedRecovery({
        status: OperationsRecoveryStatus.DISPOSITION_SELECTED,
        disposition: OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
      });
      const opened = await openClaim(fx);
      expect(opened.claim.status).toBe(ExceptionClaimStatus.OPEN);
    });

    // ─── 2: economic loss identity + fee exclusion ──────────

    it('2: derives economicLossKey server-side and excludes fees from compensable', async () => {
      const fx = await seedRecovery({
        totalAmount: '1060.00',
        deliveryFee: '50.00',
        transactionFeeAmount: '10.00',
      });
      const subjectRef = `order-goods:${fx.orderId}`;
      const opened = await openClaim(fx, { subjectRef });

      const loss = await prisma.economicLoss.findUniqueOrThrow({
        where: { id: opened.claim.economicLossId },
      });
      expect(loss.economicLossKey).toBe(
        buildEconomicLossKey({
          wkOrderId: fx.orderId,
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef,
        }),
      );
      expect(loss.feeComponentAmount.toFixed(2)).toBe('60.00');
      expect(loss.compensableAmount.toFixed(2)).toBe('1000.00');
      expect(loss.compensableAmount.toFixed(2)).not.toBe(
        loss.grossLossAmount.add(loss.feeComponentAmount).toFixed(2),
      );
    });

    it('2b: reuses one EconomicLoss per (order, lossKind, subjectRef)', async () => {
      const fx = await seedRecovery();
      const subjectRef = `order-goods:${fx.orderId}`;
      const first = await openClaim(fx, { subjectRef });

      // Terminate the first claim so a second may open on the same loss.
      await prisma.exceptionClaim.update({
        where: { id: first.claim.id },
        data: {
          status: ExceptionClaimStatus.WITHDRAWN,
          terminalReason: 'superseded by acceptance re-open',
          withdrawnAt: new Date(),
        },
      });

      const second = await openClaim(fx, { subjectRef });
      expect(second.claim.economicLossId).toBe(first.claim.economicLossId);

      const count = await prisma.economicLoss.count({
        where: {
          wkOrderId: fx.orderId,
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef,
        },
      });
      expect(count).toBe(1);
    });

    // ─── 3: one active claim per economic loss ──────────────

    it('3: refuses a second active claim on the same economic loss', async () => {
      const fx = await seedRecovery();
      const subjectRef = `order-goods:${fx.orderId}`;
      await openClaim(fx, { subjectRef });
      await expectCode(
        openClaim(fx, { subjectRef }),
        'EXCEPTION_CLAIM_ALREADY_ACTIVE',
      );
    });

    // ─── 4: idempotency ─────────────────────────────────────

    it('4: open is idempotent per actor key and conflicts on payload change', async () => {
      const fx = await seedRecovery();
      const key = `s12-idem-${randomUUID()}`;
      const first = await openClaim(fx, { idempotencyKey: key });
      const replay = await openClaim(fx, { idempotencyKey: key });
      expect(replay.idempotent).toBe(true);
      expect(replay.claim.id).toBe(first.claim.id);

      await expectCode(
        openClaim(fx, { idempotencyKey: key, subjectRef: 'different-subject' }),
        'IDEMPOTENCY_PAYLOAD_CONFLICT',
      );
    });

    // ─── 5: authorization ───────────────────────────────────

    it('5: only UserRole.admin may mutate; parties get a minimal read', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);

      for (const partyId of [fx.customerId, fx.riderId, fx.merchantUserId]) {
        await expectCode(
          exceptions.openClaimFromRecovery({
            operationsRecoveryId: fx.recoveryId,
            actorUserId: partyId,
            claimType: ExceptionClaimType.GOODS_LOSS,
            subjectRef: `party-attempt:${partyId}`,
            correlationId: `s12-party-${randomUUID().slice(0, 8)}`,
          }),
          'EXCEPTION_FINANCIAL_FORBIDDEN',
        );
      }

      const adminView = await exceptions.getClaim(opened.claim.id, fx.adminId);
      expect((adminView.claim as { events?: unknown[] }).events).toBeDefined();

      const customerView = await exceptions.getClaim(
        opened.claim.id,
        fx.customerId,
      );
      expect(
        (customerView.claim as { events?: unknown[] }).events,
      ).toBeUndefined();
      expect(customerView.claim.status).toBe(ExceptionClaimStatus.OPEN);

      await expectCode(
        exceptions.getClaim(opened.claim.id, fx.foreignId),
        'EXCEPTION_FINANCIAL_FORBIDDEN',
      );
    });

    it('5b: parties only see evidence published to all order parties', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.STATEMENT,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'internal investigator note',
        correlationId: `s12-ev-${randomUUID().slice(0, 8)}`,
      });
      const shared = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.DOCUMENT_REFERENCE,
        visibility: ClaimEvidenceVisibility.ALL_ORDER_PARTIES,
        notes: 'shared receipt',
        correlationId: `s12-ev-${randomUUID().slice(0, 8)}`,
      });

      const view = await exceptions.getClaim(opened.claim.id, fx.customerId);
      const evidence = (view.claim as { evidence: Array<{ id: string }> })
        .evidence;
      expect(evidence).toHaveLength(1);
      expect(evidence[0].id).toBe(shared.evidenceId);
      expect(JSON.stringify(view.claim)).not.toContain('internal investigator');
    });

    // ─── 6: verified facts gate determinations ──────────────

    it('6: a verified fact requires VERIFIED evidence, and a determination requires a fact', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);

      const evidence = await exceptions.addEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
        correlationId: `s12-ev-${randomUUID().slice(0, 8)}`,
      });

      // Evidence exists but was never verified.
      await expectCode(
        exceptions.concludeVerifiedFact({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
          statement: 'premature conclusion',
          correlationId: `s12-fact-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_CLAIM_VERIFIED_EVIDENCE_REQUIRED',
      );

      // Determination without any verified fact.
      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.RIDER,
              partyUserId: fx.riderId,
              amount: '100.00',
            },
          ],
          correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
        }),
        'VERIFIED_FACT_REQUIRED',
      );

      await exceptions.verifyEvidence({
        claimId: opened.claim.id,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12-vf-${randomUUID().slice(0, 8)}`,
      });
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
        statement: 'Goods confirmed lost',
        correlationId: `s12-fact-${randomUUID().slice(0, 8)}`,
      });
      expect(fact.verifiedFactId).toBeDefined();

      const claim = await prisma.exceptionClaim.findUniqueOrThrow({
        where: { id: opened.claim.id },
      });
      expect(claim.status).toBe(ExceptionClaimStatus.VERIFIED);
    });

    // ─── 7: allocations ─────────────────────────────────────

    it('7: allocations must sum to the total and stay within remaining', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);

      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.RIDER,
              partyUserId: fx.riderId,
              amount: '5000.00',
            },
          ],
          correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_REMAINING_COMPENSABLE_EXCEEDED',
      );

      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '600.00',
          },
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '400.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      expect(created.determination.totalLiabilityAmount).toBe('1000.00');
      expect(created.determination.remainingAmountSnapshot).toBe('1000.00');
      expect(created.determination.status).toBe(
        LiabilityDeterminationStatus.DRAFT,
      );
    });

    it('7b: rejects a second active determination on the same claim', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const alloc = [
        {
          partyType: ExceptionLiablePartyType.RIDER,
          partyUserId: fx.riderId,
          amount: '100.00',
        },
      ];
      await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: alloc,
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: alloc,
          correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
        }),
        'LIABILITY_DETERMINATION_ALREADY_ACTIVE',
      );
    });

    // ─── 8: full happy path finalize ────────────────────────

    it('8: finalize writes allocations, coverage and obligations atomically', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '700.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.proposeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-prop-${randomUUID().slice(0, 8)}`,
      });
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        reason: 'rider negligence confirmed',
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      expect(finalized.determination.status).toBe(
        LiabilityDeterminationStatus.FINALIZED,
      );
      expect(finalized.obligations).toHaveLength(1);
      const obligation = finalized.obligations[0];
      expect(obligation.debtorType).toBe(ExceptionLiablePartyType.RIDER);
      expect(obligation.debtorUserId).toBe(fx.riderId);
      // Merchant bore the goods loss, so the merchant is the creditor.
      expect(obligation.creditorType).toBe(ExceptionLiablePartyType.MERCHANT);
      expect(obligation.creditorMerchantId).toBe(fx.merchantId);
      expect(obligation.principal).toBe('700.00');
      expect(obligation.status).toBe(ExceptionFinancialObligationStatus.OPEN);

      const coverage = await prisma.economicLossCoverage.findMany({
        where: { economicLossId: opened.claim.economicLossId },
      });
      expect(coverage).toHaveLength(1);
      expect(coverage[0].sourceKind).toBe(
        EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
      );
      expect(coverage[0].amount.toFixed(2)).toBe('700.00');

      const claim = await prisma.exceptionClaim.findUniqueOrThrow({
        where: { id: opened.claim.id },
      });
      expect(claim.status).toBe(ExceptionClaimStatus.FINALIZED);
    });

    it('8b: finalize is idempotent under the same key', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '250.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      const key = `s12-fin-idem-${randomUUID()}`;
      const correlationId = `s12-fin-${randomUUID().slice(0, 8)}`;
      const first = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId,
        idempotencyKey: key,
      });
      const replay = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId,
        idempotencyKey: key,
      });
      expect(replay.idempotent).toBe(true);
      expect(replay.obligations).toHaveLength(first.obligations.length);

      const coverage = await prisma.economicLossCoverage.count({
        where: { economicLossId: opened.claim.economicLossId },
      });
      expect(coverage).toBe(1);
    });

    // ─── 9: Stage 9 race gate ───────────────────────────────

    it('9: finalize refuses while a Stage 9 determination is undecided', async () => {
      for (const status of [
        ReturnFinancialDeterminationStatus.PENDING,
        ReturnFinancialDeterminationStatus.PROPOSED,
        ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
        ReturnFinancialDeterminationStatus.DISPUTED,
      ]) {
        const fx = await seedRecovery();
        const opened = await openClaim(fx);
        await claimWithVerifiedFact(fx, opened.claim.id);
        const created = await exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.RIDER,
              partyUserId: fx.riderId,
              amount: '100.00',
            },
          ],
          correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
        });
        await seedStage9Determination(fx, status);

        await expectCode(
          exceptions.finalizeDetermination({
            determinationId: created.determination.id,
            actorUserId: fx.adminId,
            correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
          }),
          'STAGE9_DETERMINATION_IN_PROGRESS',
        );

        // Zero side effects from a refused finalize.
        const coverage = await prisma.economicLossCoverage.count({
          where: { economicLossId: opened.claim.economicLossId },
        });
        expect(coverage).toBe(0);
        const obligations = await prisma.exceptionFinancialObligation.count({
          where: { exceptionClaimId: opened.claim.id },
        });
        expect(obligations).toBe(0);
      }
    });

    it('9b: finalize refuses while the order is Stage 9 return-money-eligible', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: true,
      });
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '100.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });

      await expectCode(
        exceptions.finalizeDetermination({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
        }),
        'STAGE9_RETURN_MONEY_PENDING',
      );
    });

    it('9c: hollow returned (no RETURN_RECEIVED) is not Stage 9 money-eligible', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: false,
      });
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '100.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });
      expect(finalized.determination.status).toBe(
        LiabilityDeterminationStatus.FINALIZED,
      );
    });

    // ─── 10: Stage 9 coverage import ────────────────────────

    it('10: imports same-subject Stage 9 coverage and recovers only the remainder', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: true,
        withRiderAdvance: true,
      });
      await seedStage9Determination(
        fx,
        ReturnFinancialDeterminationStatus.FINALIZED,
        {
          obligations: [
            {
              type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
              principal: '300.00',
            },
          ],
        },
      );

      const opened = await openClaim(fx, {
        claimType: ExceptionClaimType.UNRECOVERED_ADVANCE,
        subjectRef: `rider-advance:${fx.orderId}`,
      });
      await claimWithVerifiedFact(fx, opened.claim.id);

      const loss = await prisma.economicLoss.findUniqueOrThrow({
        where: { id: opened.claim.economicLossId },
      });
      expect(loss.compensableAmount.toFixed(2)).toBe('1000.00');

      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.customerId,
            amount: '700.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      expect(finalized.importedStage9Coverage).toHaveLength(1);
      expect(finalized.importedStage9Coverage![0].amount).toBe('300.00');
      expect(finalized.determination.priorCoverageAmountSnapshot).toBe(
        '300.00',
      );
      expect(finalized.determination.remainingAmountSnapshot).toBe('700.00');

      const coverage = await prisma.economicLossCoverage.findMany({
        where: { economicLossId: opened.claim.economicLossId },
        orderBy: { createdAt: 'asc' },
      });
      expect(coverage.map((c) => c.sourceKind)).toEqual([
        EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
        EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
      ]);
      const total = coverage.reduce(
        (acc, c) => acc.add(c.amount),
        new Prisma.Decimal(0),
      );
      // Never more than the compensable amount — this is the no-double-recovery proof.
      expect(total.toFixed(2)).toBe('1000.00');
      expect(total.lte(loss.compensableAmount)).toBe(true);
    });

    it('10b: does not import a Stage 9 obligation for an unrelated loss kind', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: true,
      });
      await seedStage9Determination(
        fx,
        ReturnFinancialDeterminationStatus.FINALIZED,
        {
          obligations: [
            {
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: '400.00',
            },
          ],
        },
      );

      // OTHER is outside Stage 9 return/RA goods economics (goods-class losses
      // ARE contained in Stage 9 WHOLE_ORDER money after the item/order repair).
      const opened = await openClaim(fx, {
        claimType: ExceptionClaimType.OTHER,
        subjectRef: `external-event:${fx.orderId}`,
      });
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '100.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });
      expect(finalized.importedStage9Coverage).toEqual([]);
      expect(finalized.determination.priorCoverageAmountSnapshot).toBe('0.00');
    });

    it('10c: caps an oversized Stage 9 import at the compensable ceiling', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: true,
        withRiderAdvance: true,
      });
      await seedStage9Determination(
        fx,
        ReturnFinancialDeterminationStatus.FINALIZED,
        {
          obligations: [
            {
              type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
              principal: '99999.00',
            },
          ],
        },
      );
      const opened = await openClaim(fx, {
        claimType: ExceptionClaimType.UNRECOVERED_ADVANCE,
      });
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.customerId,
            amount: '10.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });

      // Stage 9 already covers the whole loss, so nothing remains for Stage 12.
      // The import + reject happen in one Serializable txn: on NOTHING_REMAINING
      // the coverage rows roll back. Stage 9 obligations remain the authoritative
      // coverage source; the ceiling/cap is proven by maxImportableCoverage.
      await expectCode(
        exceptions.finalizeDetermination({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NOTHING_REMAINING_TO_RECOVER',
      );

      const coverage = await prisma.economicLossCoverage.findMany({
        where: { economicLossId: opened.claim.economicLossId },
      });
      expect(coverage).toHaveLength(0);
      expect(
        maxImportableCoverage({
          compensableAmount: new Prisma.Decimal('1000.00'),
          alreadyCoveredAmount: new Prisma.Decimal(0),
          candidateAmount: new Prisma.Decimal('99999.00'),
        }).toFixed(2),
      ).toBe('1000.00');
    });

    // ─── 11: DB-level integrity ─────────────────────────────

    it('11: coverage ceiling trigger rejects over-recovery at the database', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      const lossId = opened.claim.economicLossId;

      await prisma.$executeRawUnsafe(
        `INSERT INTO economic_loss_coverages
         (id, economic_loss_id, source_kind, source_ref, subject_ref_snapshot,
          amount, currency, created_by_actor_type, created_by_actor_id)
       VALUES ($1::uuid, $2::uuid, 'EXTERNAL_RECOVERY', $3, 'subject',
               900.00, 'PHP', 'SYSTEM_ADMIN', $4::uuid)`,
        randomUUID(),
        lossId,
        `ext-${randomUUID()}`,
        fx.adminId,
      );

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO economic_loss_coverages
           (id, economic_loss_id, source_kind, source_ref, subject_ref_snapshot,
            amount, currency, created_by_actor_type, created_by_actor_id)
         VALUES ($1::uuid, $2::uuid, 'EXTERNAL_RECOVERY', $3, 'subject',
                 200.00, 'PHP', 'SYSTEM_ADMIN', $4::uuid)`,
          randomUUID(),
          lossId,
          `ext-${randomUUID()}`,
          fx.adminId,
        ),
      ).rejects.toThrow(/coverage_ceiling|exceeds compensable/i);
    });

    it('11b: coverage rows are append-only', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      const coverageId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO economic_loss_coverages
         (id, economic_loss_id, source_kind, source_ref, subject_ref_snapshot,
          amount, currency, created_by_actor_type, created_by_actor_id)
       VALUES ($1::uuid, $2::uuid, 'EXTERNAL_RECOVERY', $3, 'subject',
               10.00, 'PHP', 'SYSTEM_ADMIN', $4::uuid)`,
        coverageId,
        opened.claim.economicLossId,
        `ext-${randomUUID()}`,
        fx.adminId,
      );
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE economic_loss_coverages SET amount = 1.00 WHERE id = $1::uuid`,
          coverageId,
        ),
      ).rejects.toThrow(/append_only|forbidden/i);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM economic_loss_coverages WHERE id = $1::uuid`,
          coverageId,
        ),
      ).rejects.toThrow(/append_only|forbidden/i);
    });

    it('11c: verified facts are immutable', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      const { verifiedFactId } = await claimWithVerifiedFact(
        fx,
        opened.claim.id,
      );

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE verified_facts SET statement = 'rewritten' WHERE id = $1::uuid`,
          verifiedFactId,
        ),
      ).rejects.toThrow(/immutable|forbidden/i);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM verified_facts WHERE id = $1::uuid`,
          verifiedFactId,
        ),
      ).rejects.toThrow(/immutable|forbidden/i);
    });

    it('11d: FINALIZED determinations, their allocations and obligations are frozen', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '120.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      const finalized = await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE liability_determinations SET total_liability_amount = 1.00 WHERE id = $1::uuid`,
          created.determination.id,
        ),
      ).rejects.toThrow(/finalized_immutable|immutable/i);

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO liability_allocations
           (id, liability_determination_id, party_type, party_user_id, amount, currency)
         VALUES ($1::uuid, $2::uuid, 'RIDER', $3::uuid, 5.00, 'PHP')`,
          randomUUID(),
          created.determination.id,
          fx.riderId,
        ),
      ).rejects.toThrow(/allocation_guard|immutable/i);

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM exception_financial_obligations WHERE id = $1::uuid`,
          finalized.obligations[0].id,
        ),
      ).rejects.toThrow(/no_delete|forbidden/i);
    });

    it('11e: terminal claims are immutable and never deleted', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '50.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE exception_claims SET claim_type = 'OTHER' WHERE id = $1::uuid`,
          opened.claim.id,
        ),
      ).rejects.toThrow(/terminal_immutable|immutable/i);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM exception_claims WHERE id = $1::uuid`,
          opened.claim.id,
        ),
      ).rejects.toThrow(/no_delete|forbidden/i);

      // The service refuses further work on a terminal claim before touching the DB.
      await expectCode(
        exceptions.addEvidence({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          evidenceKind: ClaimEvidenceKind.STATEMENT,
          correlationId: `s12-ev-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_CLAIM_TERMINAL',
      );
    });

    it('11f: allocations must resolve to a concrete merchant or user', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '10.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      // Unbound party: neither merchant nor user.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO liability_allocations
           (id, liability_determination_id, party_type, amount, currency)
         VALUES ($1::uuid, $2::uuid, 'RIDER', 5.00, 'PHP')`,
          randomUUID(),
          created.determination.id,
        ),
      ).rejects.toThrow(/party_binding|violates check/i);
    });

    it('11g: allocation sum must equal the total at finalize time', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '100.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });

      // Tamper with the total behind the service's back; the trigger must catch it.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE liability_determinations
            SET status = 'FINALIZED',
                total_liability_amount = 500.00,
                remaining_amount_snapshot = 1000.00,
                finalized_at = now(),
                finalized_by_actor_id = $2::uuid,
                finalized_by_actor_type = 'SYSTEM_ADMIN'
          WHERE id = $1::uuid`,
          created.determination.id,
          fx.adminId,
        ),
      ).rejects.toThrow(/allocation_sum/i);
    });

    // ─── 12: adjustments ────────────────────────────────────

    it('12: an adjustment creates a new bound determination and leaves the original intact', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '300.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      const adjustment = await exceptions.createAdjustment({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '200.00',
          },
        ],
        reason: 'reattributed after further review',
        correlationId: `s12-adj-${randomUUID().slice(0, 8)}`,
      });

      expect(adjustment.determination.adjustmentOfDeterminationId).toBe(
        created.determination.id,
      );
      // Remaining shrank by the already-covered 300.
      expect(adjustment.determination.remainingAmountSnapshot).toBe('700.00');

      const original = await prisma.liabilityDetermination.findUniqueOrThrow({
        where: { id: created.determination.id },
      });
      expect(original.status).toBe(LiabilityDeterminationStatus.FINALIZED);
      expect(original.totalLiabilityAmount.toFixed(2)).toBe('300.00');
    });

    it('12b: only a FINALIZED determination can be adjusted', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '10.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await expectCode(
        exceptions.createAdjustment({
          determinationId: created.determination.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.RIDER,
              partyUserId: fx.riderId,
              amount: '5.00',
            },
          ],
          reason: 'premature adjustment',
          correlationId: `s12-adj-${randomUUID().slice(0, 8)}`,
        }),
        'LIABILITY_ADJUSTMENT_SOURCE_INVALID',
      );
    });

    // ─── 13: derived operational flags ──────────────────────

    it('13: surfaces CLAIM_OPEN then LIABILITY_DETERMINED without changing Stage 11 flags', async () => {
      const fx = await seedRecovery();
      const before = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(before.flags).not.toContain('CLAIM_OPEN');
      expect(before.flags).toContain('FINANCIAL_REVIEW_REQUIRED');

      const opened = await openClaim(fx);
      const during = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(during.flags).toContain('CLAIM_OPEN');
      expect(during.flags).toContain('ECONOMIC_LOSS_UNCOVERED');
      expect(during.flags).not.toContain('LIABILITY_DETERMINED');
      // Stage 11 semantics preserved.
      expect(during.flags).toContain('FINANCIAL_REVIEW_REQUIRED');

      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '1000.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      const after = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(after.flags).toContain('LIABILITY_DETERMINED');
      expect(after.flags).toContain('EXCEPTION_OBLIGATION_PENDING');
      expect(after.flags).not.toContain('CLAIM_OPEN');
      // Fully covered now.
      expect(after.flags).not.toContain('ECONOMIC_LOSS_UNCOVERED');
      expect(after.flags).toContain('FINANCIAL_REVIEW_REQUIRED');
    });

    // ─── 14: audit trail ────────────────────────────────────

    it('14: records an append-only claim event trail and order domain events', async () => {
      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.RIDER,
            partyUserId: fx.riderId,
            amount: '80.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.proposeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-prop-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      const events = await prisma.exceptionClaimEvent.findMany({
        where: { exceptionClaimId: opened.claim.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.eventType)).toEqual(
        expect.arrayContaining([
          'CLAIM_OPENED',
          'EVIDENCE_ADDED',
          'EVIDENCE_VERIFIED',
          'FACT_CONCLUDED',
          'DETERMINATION_CREATED',
          'DETERMINATION_PROPOSED',
          'DETERMINATION_FINALIZED',
        ]),
      );
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM exception_claim_events WHERE id = $1::uuid`,
          events[0].id,
        ),
      ).rejects.toThrow(/append_only|forbidden/i);

      const domainEvents = await prisma.orderDomainEvent.findMany({
        where: {
          wkOrderId: fx.orderId,
          action: {
            in: ['EXCEPTION_CLAIM_OPENED', 'EXCEPTION_LIABILITY_FINALIZED'],
          },
        },
      });
      expect(domainEvents).toHaveLength(2);
    });

    // ─── 15: Stage 9 data is never mutated ──────────────────

    it('15: Stage 9 determinations and obligations are read-only from Stage 12', async () => {
      const fx = await seedRecovery({
        fulfillmentStatus: FulfillmentStatus.returned,
        withReturnReceived: true,
        withRiderAdvance: true,
      });
      const stage9 = await seedStage9Determination(
        fx,
        ReturnFinancialDeterminationStatus.FINALIZED,
        {
          obligations: [
            {
              type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
              principal: '200.00',
            },
          ],
        },
      );
      const before = await prisma.returnFinancialObligation.findMany({
        where: { determinationId: stage9.id },
      });

      const opened = await openClaim(fx, {
        claimType: ExceptionClaimType.UNRECOVERED_ADVANCE,
      });
      await claimWithVerifiedFact(fx, opened.claim.id);
      const created = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.CUSTOMER,
            partyUserId: fx.customerId,
            amount: '100.00',
          },
        ],
        correlationId: `s12-det-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.finalizeDetermination({
        determinationId: created.determination.id,
        actorUserId: fx.adminId,
        correlationId: `s12-fin-${randomUUID().slice(0, 8)}`,
      });

      const afterDet =
        await prisma.returnFinancialDetermination.findUniqueOrThrow({
          where: { id: stage9.id },
        });
      expect(afterDet.status).toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
      expect(afterDet.updatedAt.getTime()).toBe(stage9.updatedAt.getTime());

      const after = await prisma.returnFinancialObligation.findMany({
        where: { determinationId: stage9.id },
      });
      expect(after.map((o) => o.principal.toFixed(2))).toEqual(
        before.map((o) => o.principal.toFixed(2)),
      );
      expect(after.map((o) => o.status)).toEqual(before.map((o) => o.status));
    });

    // ─── 16: policy seeding ─────────────────────────────────

    it('16: ensureSeededPolicy is idempotent and binds a hash to every claim', async () => {
      const first = await exceptions.ensureSeededPolicy();
      const second = await exceptions.ensureSeededPolicy();
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('ACTIVE');

      const fx = await seedRecovery();
      const opened = await openClaim(fx);
      const claim = await prisma.exceptionClaim.findUniqueOrThrow({
        where: { id: opened.claim.id },
      });
      expect(claim.policyVersionId).toBe(first.id);
      expect(claim.policyHash).toBe(first.policyHash);
    });
  },
);
