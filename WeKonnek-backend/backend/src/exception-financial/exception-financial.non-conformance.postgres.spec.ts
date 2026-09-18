/**
 * Stage 12 Trust Trade non-conformance amendment — permanent regressions A–M.
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
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
  CustodyEventType,
  DeliveryAttemptCustomerResponse,
  DeliveryAttemptOutcome,
  DeliveryFailureReasonCode,
  ExceptionClaimStatus,
  ExceptionClaimType,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  GoodsNonConformanceReasonCode,
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

const describeIf = STAGE12_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();
const ALLOWED_DB_USERS = stage12AllowedDbUsers(EXPECTED_DB);

function errCode(err: unknown): string | undefined {
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
  productName: string;
};

describeIf(
  `Stage 12 Trust Trade non-conformance (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage12AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 12 non-conformance',
      );
      if (
        STAGE12_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Non-conformance tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seedRecovery(opts?: {
      totalAmount?: string;
      deliveryFee?: string;
      productName?: string;
      quantity?: number;
      withRiderAdvance?: boolean;
      withCustomerReceived?: boolean;
      paymentStatus?: string;
      trigger?: OperationsRecoveryTrigger;
    }): Promise<SeedIds> {
      const tag = randomUUID();
      const productName = opts?.productName ?? `Item-A-${tag.slice(0, 6)}`;
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s12nc-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `S12NC${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const rider = await mkUser(UserRole.rider, 'r');
      const admin = await mkUser(UserRole.admin, 'a');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S12NC ${tag}`,
          slug: `s12nc-${tag}`,
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

      const goods = new Prisma.Decimal(opts?.totalAmount ?? '800.00');
      const fee = new Prisma.Decimal(opts?.deliveryFee ?? '0.00');
      const order = await prisma.wkOrder.create({
        data: {
          orderCode: `WK-S12NC-${tag.slice(0, 8)}`,
          userId: customer.id,
          merchantId: merchant.id,
          status: 'pending',
          orderType: 'delivery',
          totalAmount: goods.add(fee),
          deliveryFee: fee,
          transactionFeeAmount: new Prisma.Decimal(0),
          paymentMethod: 'cash',
          paymentStatus: opts?.paymentStatus ?? 'pending',
          merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
          deliveryAddress: '123 NonConformance St',
          orderItems: {
            create: [
              {
                productName,
                quantity: opts?.quantity ?? 1,
                price: goods,
                subtotal: goods,
              },
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
          status: opts?.withCustomerReceived
            ? FulfillmentStatus.delivered
            : FulfillmentStatus.delivery_failed,
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

      if (opts?.withCustomerReceived) {
        await prisma.custodyEvent.create({
          data: {
            id: randomUUID(),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            eventType: CustodyEventType.CUSTOMER_RECEIVED,
            fromPartyRole: 'RIDER',
            toPartyRole: 'CUSTOMER',
            fromUserId: rider.id,
            toUserId: customer.id,
            actorUserId: customer.id,
            correlationId: `s12nc-recv-${tag.slice(0, 8)}`,
            occurredAt: new Date(),
          },
        });
      } else {
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
            correlationId: `s12nc-fail-${tag.slice(0, 8)}`,
            idempotencyKey: `s12nc-fail-${tag}`,
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
            termsSnapshot: { kind: 's12nc_test' },
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
            authorizedMaximumAmount: goods,
            actualAdvanceAmount: goods,
            reimbursementPrincipal: goods,
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
          openingTriggerCode:
            opts?.trigger ??
            OperationsRecoveryTrigger.CUSTOMER_REFUSED_NON_CONFORMANCE,
          openedByActorType: 'SYSTEM_ADMIN',
          openedByActorId: admin.id,
          correlationId: `s12nc-rec-${tag.slice(0, 8)}`,
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
        productName,
      };
    }

    async function openNcClaim(
      fx: SeedIds,
      opts?: {
        reason?: GoodsNonConformanceReasonCode;
        claimedAmount?: string | null;
      },
    ) {
      return exceptions.openClaimFromRecovery({
        operationsRecoveryId: fx.recoveryId,
        actorUserId: fx.adminId,
        claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
        nonConformanceReasonCode:
          opts?.reason ?? GoodsNonConformanceReasonCode.WRONG_ITEM,
        subjectRef: `order-nonconformance:${fx.orderId}`,
        claimedAmount: opts?.claimedAmount ?? null,
        correlationId: `s12nc-open-${randomUUID().slice(0, 8)}`,
      });
    }

    async function addVerifiedEvidence(
      fx: SeedIds,
      claimId: string,
      notes: string,
      kind: ClaimEvidenceKind = ClaimEvidenceKind.PHOTO_REFERENCE,
      metadata?: Prisma.InputJsonValue,
    ) {
      const evidence = await exceptions.addEvidence({
        claimId,
        actorUserId: fx.adminId,
        evidenceKind: kind,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes,
        metadata,
        correlationId: `s12nc-ev-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.verifyEvidence({
        claimId,
        evidenceId: evidence.evidenceId,
        actorUserId: fx.adminId,
        verificationStatus: ClaimVerificationStatus.VERIFIED,
        correlationId: `s12nc-vf-${randomUUID().slice(0, 8)}`,
      });
      return evidence.evidenceId;
    }

    it('A: WRONG_ITEM allegation alone creates no merchant liability / obligation', async () => {
      const fx = await seedRecovery();
      const opened = await openNcClaim(fx);
      expect(opened.claim.status).toBe(ExceptionClaimStatus.OPEN);
      expect(opened.claim.nonConformanceReasonCode).toBe(
        GoodsNonConformanceReasonCode.WRONG_ITEM,
      );
      expect(opened.claim.claimType).toBe(
        ExceptionClaimType.GOODS_NON_CONFORMANCE,
      );

      const obligations = await prisma.exceptionFinancialObligation.findMany({
        where: { exceptionClaimId: opened.claim.id },
      });
      expect(obligations).toHaveLength(0);

      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.MERCHANT,
              partyMerchantId: fx.merchantId,
              amount: '800.00',
            },
          ],
          correlationId: `s12nc-det-${randomUUID().slice(0, 8)}`,
        }),
        'VERIFIED_FACT_REQUIRED',
      );
    });

    it('B: Item A ordered / Item B presented — refuse before handoff; no CUSTOMER_RECEIVED / delivered', async () => {
      const fx = await seedRecovery({ productName: 'Item-A-Authoritative' });
      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(fulfillment.status).toBe(FulfillmentStatus.delivery_failed);
      const received = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      });
      expect(received).toBe(0);

      const attempt = await prisma.deliveryAttempt.findFirst({
        where: { fulfillmentId: fx.fulfillmentId },
      });
      expect(attempt?.failureReasonCode).toBe(
        DeliveryFailureReasonCode.CUSTOMER_REFUSED_ITEM_NOT_AS_ORDERED,
      );

      const opened = await openNcClaim(fx);
      const terms = await exceptions.attachOrderTermsEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        correlationId: `s12nc-terms-${randomUUID().slice(0, 8)}`,
      });
      expect(terms.evidenceId).toBeTruthy();
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Presented goods are Item-B, not Item-A',
      );
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement:
          'Authoritative order Item-A; presented goods evidenced as Item-B',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-fact-${randomUUID().slice(0, 8)}`,
      });
      expect(fact.verifiedFactId).toBeTruthy();

      const still = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(still.status).toBe(FulfillmentStatus.delivery_failed);
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillmentId,
            eventType: CustodyEventType.CUSTOMER_RECEIVED,
          },
        }),
      ).toBe(0);
    });

    it('C: conformance verified after WRONG_ITEM allegation — no merchant obligation', async () => {
      const fx = await seedRecovery();
      const opened = await openNcClaim(fx);
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'SKU/barcode matches authoritative order terms',
      );
      await expectCode(
        exceptions.concludeVerifiedFact({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          factType: VerifiedFactType.GOODS_CONFORMANCE_CONFIRMED,
          statement: 'Presented goods match order terms',
          attributedPartyType: ExceptionLiablePartyType.MERCHANT,
          attributedMerchantId: fx.merchantId,
          supportingEvidenceId: evidenceId,
          correlationId: `s12nc-conf-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_ATTRIBUTION_FORBIDDEN',
      );

      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_CONFORMANCE_CONFIRMED,
        statement: 'Presented goods match order terms',
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-conf2-${randomUUID().slice(0, 8)}`,
      });

      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.MERCHANT,
              partyMerchantId: fx.merchantId,
              amount: '800.00',
              verifiedFactId: fact.verifiedFactId,
            },
          ],
          correlationId: `s12nc-det-c-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED',
      );
    });

    it('D: wrong quantity verified — partial compensable amount supported', async () => {
      const fx = await seedRecovery({
        totalAmount: '800.00',
        quantity: 2,
        productName: 'Widget',
      });
      const opened = await openNcClaim(fx, {
        reason: GoodsNonConformanceReasonCode.WRONG_QUANTITY,
        claimedAmount: '400.00',
      });
      expect(opened.economicLoss.compensableAmount).toBe('400.00');
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Only 1 of 2 units present',
      );
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Quantity mismatch vs authoritative order',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-qty-${randomUUID().slice(0, 8)}`,
      });
      const det = await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '400.00',
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12nc-det-d-${randomUUID().slice(0, 8)}`,
      });
      expect(det.determination.totalLiabilityAmount).toBe('400.00');
    });

    it('E: rider proven custodian during allegation — no automatic rider liability', async () => {
      const fx = await seedRecovery();
      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(fulfillment.physicalCustodianRiderId).toBe(fx.riderId);

      const opened = await openNcClaim(fx);
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Allegation only; no verified mismatch',
      );
      await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.NON_CONFORMANCE_ALLEGATION_UNSUPPORTED,
        statement: 'Customer allegation unsupported by evidence',
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-e-${randomUUID().slice(0, 8)}`,
      });

      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.RIDER,
              partyUserId: fx.riderId,
              amount: '800.00',
            },
          ],
          correlationId: `s12nc-det-e-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED',
      );
    });

    it('F: merchant release evidence of wrong SKU is usable by VerifiedFact', async () => {
      const fx = await seedRecovery({ productName: 'SKU-AAA' });
      const opened = await openNcClaim(fx);
      await exceptions.attachOrderTermsEvidence({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        correlationId: `s12nc-f-terms-${randomUUID().slice(0, 8)}`,
      });
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Merchant release photo shows SKU-BBB',
        ClaimEvidenceKind.DOCUMENT_REFERENCE,
        {
          merchantReleaseSku: 'SKU-BBB',
          authoritativeSku: 'SKU-AAA',
        },
      );
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Merchant released non-conforming SKU',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-f-fact-${randomUUID().slice(0, 8)}`,
        metadata: { source: 'merchant_release_evidence' },
      });
      expect(fact.code).toBe('VERIFIED_FACT_CONCLUDED');
    });

    it('G: merchant released correct SKU but later wrong SKU appears — no auto merchant blame', async () => {
      const fx = await seedRecovery({ productName: 'SKU-CORRECT' });
      const opened = await openNcClaim(fx);
      const releaseEvidence = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Merchant release shows SKU-CORRECT',
        ClaimEvidenceKind.DOCUMENT_REFERENCE,
        { merchantReleaseSku: 'SKU-CORRECT' },
      );
      await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.NON_CONFORMANCE_ALLEGATION_UNSUPPORTED,
        statement:
          'Release evidence matches order; later mismatch not attributed to merchant release',
        supportingEvidenceId: releaseEvidence,
        correlationId: `s12nc-g-${randomUUID().slice(0, 8)}`,
        metadata: { custodyEvidenceRetained: true },
      });

      await expectCode(
        exceptions.createDetermination({
          claimId: opened.claim.id,
          actorUserId: fx.adminId,
          allocations: [
            {
              partyType: ExceptionLiablePartyType.MERCHANT,
              partyMerchantId: fx.merchantId,
              amount: '800.00',
            },
          ],
          correlationId: `s12nc-det-g-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED',
      );
    });

    it('H: COD/unpaid + verified wrong item — no fictitious refund', async () => {
      const fx = await seedRecovery({ paymentStatus: 'pending' });
      const order = await prisma.wkOrder.findUniqueOrThrow({
        where: { id: fx.orderId },
      });
      expect(order.paymentStatus).toBe('pending');

      const opened = await openNcClaim(fx);
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Wrong item verified; customer unpaid COD',
      );
      await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Non-conformance verified on unpaid order',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-h-${randomUUID().slice(0, 8)}`,
      });

      // No fabricated customer refund / payment-recovery obligation merely from refusal.
      const customerPaymentObligations =
        await prisma.exceptionFinancialObligation.count({
          where: {
            wkOrderId: fx.orderId,
            creditorUserId: fx.customerId,
          },
        });
      expect(customerPaymentObligations).toBe(0);
      expect(order.paymentStatus).toBe('pending');
    });

    it('I: Rider Advance ₱800 + wrong item refusal — no automatic customer/merchant liability before determination', async () => {
      const fx = await seedRecovery({
        totalAmount: '800.00',
        withRiderAdvance: true,
      });
      const ra = await prisma.riderAdvance.findFirstOrThrow({
        where: { wkOrderId: fx.orderId },
      });
      expect(ra.riderId).toBe(fx.riderId);
      expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('800.00');

      const opened = await openNcClaim(fx);
      expect(
        await prisma.exceptionFinancialObligation.count({
          where: { exceptionClaimId: opened.claim.id },
        }),
      ).toBe(0);
      expect(
        await prisma.returnFinancialDetermination.count({
          where: { wkOrderId: fx.orderId },
        }),
      ).toBe(0);
    });

    it('J: RA scenario + Stage12 determination after verified non-conformance — no duplicate rider recovery from allegation alone', async () => {
      const fx = await seedRecovery({
        totalAmount: '800.00',
        withRiderAdvance: true,
      });
      const opened = await openNcClaim(fx);

      // Prove non-conformance determination does not invent Stage5B settlement rows.
      const settlementsBefore = await prisma.riderAdvanceSettlement.count({
        where: { riderAdvance: { wkOrderId: fx.orderId } },
      });
      const evidenceId = await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Merchant non-conformance verified',
      );
      const fact = await exceptions.concludeVerifiedFact({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        factType: VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
        statement: 'Merchant supplied non-conforming goods',
        attributedPartyType: ExceptionLiablePartyType.MERCHANT,
        attributedMerchantId: fx.merchantId,
        supportingEvidenceId: evidenceId,
        correlationId: `s12nc-j-${randomUUID().slice(0, 8)}`,
      });
      await exceptions.createDetermination({
        claimId: opened.claim.id,
        actorUserId: fx.adminId,
        allocations: [
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: fx.merchantId,
            amount: '800.00',
            verifiedFactId: fact.verifiedFactId,
          },
        ],
        correlationId: `s12nc-det-j-${randomUUID().slice(0, 8)}`,
      });

      const settlementsAfter = await prisma.riderAdvanceSettlement.count({
        where: { riderAdvance: { wkOrderId: fx.orderId } },
      });
      expect(settlementsAfter).toBe(settlementsBefore);

      const ra = await prisma.riderAdvance.findFirstOrThrow({
        where: { wkOrderId: fx.orderId },
      });
      expect(ra.riderId).toBe(fx.riderId);
    });

    it('K: customer refuses then merchant securely receives return — Stage6 RETURN_RECEIVED remains authoritative', async () => {
      const fx = await seedRecovery();
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
          occurredAt: new Date(),
          correlationId: `s12nc-k-${randomUUID().slice(0, 8)}`,
        },
      });

      const returns = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.RETURN_RECEIVED,
        },
      });
      expect(returns).toBe(1);
      const opened = await openNcClaim(fx);
      expect(opened.claim.status).toBe(ExceptionClaimStatus.OPEN);
    });

    it('L: customer refuses and merchant refuses return — Stage11 recovery required (trigger present)', async () => {
      const fx = await seedRecovery({
        trigger: OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED,
      });
      const recovery = await prisma.operationsRecovery.findUniqueOrThrow({
        where: { id: fx.recoveryId },
      });
      expect(recovery.openingTriggerCode).toBe(
        OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED,
      );
      expect(recovery.currentDisposition).toBe(
        OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
      );
      const opened = await openNcClaim(fx);
      expect(opened.claim.operationsRecoveryId).toBe(fx.recoveryId);
    });

    it('M: post-handoff complaint — prior CUSTOMER_RECEIVED custody remains immutable', async () => {
      const fx = await seedRecovery({ withCustomerReceived: true });
      const before = await prisma.custodyEvent.findMany({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      });
      expect(before).toHaveLength(1);
      const beforeId = before[0]!.id;

      const opened = await openNcClaim(fx);
      await addVerifiedEvidence(
        fx,
        opened.claim.id,
        'Post-delivery complaint of wrong item',
      );

      const after = await prisma.custodyEvent.findMany({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      });
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(beforeId);

      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(fulfillment.status).toBe(FulfillmentStatus.delivered);
    });

    it('reason code required for GOODS_NON_CONFORMANCE and forbidden otherwise', async () => {
      const fx = await seedRecovery();
      await expectCode(
        exceptions.openClaimFromRecovery({
          operationsRecoveryId: fx.recoveryId,
          actorUserId: fx.adminId,
          claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
          subjectRef: `order-nonconformance:${fx.orderId}`,
          correlationId: `s12nc-noreason-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_REASON_REQUIRED',
      );
      await expectCode(
        exceptions.openClaimFromRecovery({
          operationsRecoveryId: fx.recoveryId,
          actorUserId: fx.adminId,
          claimType: ExceptionClaimType.GOODS_LOSS,
          nonConformanceReasonCode: GoodsNonConformanceReasonCode.WRONG_ITEM,
          subjectRef: `order-goods:${fx.orderId}`,
          correlationId: `s12nc-badreason-${randomUUID().slice(0, 8)}`,
        }),
        'EXCEPTION_NON_CONFORMANCE_REASON_FORBIDDEN',
      );
    });
  },
);
