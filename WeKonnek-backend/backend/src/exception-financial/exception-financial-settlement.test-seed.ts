/**
 * Shared Stage 13A settlement acceptance seed helpers.
 * Unique-UUID fixtures are left orphaned (append-only).
 */
import {
  ClaimEvidenceKind,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CommerceDomain,
  ExceptionClaimType,
  ExceptionFinancialObligationStatus,
  ExceptionLiablePartyType,
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
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';

export type Stage13aSettlementSeed = {
  tag: string;
  customerId: string;
  riderId: string;
  adminId: string;
  merchantUserId: string;
  foreignId: string;
  foreignMerchantUserId: string;
  foreignMerchantId: number;
  merchantId: number;
  orderId: number;
  fulfillmentId: string;
  recoveryId: string;
  claimId: string;
  economicLossId: string;
  determinationId: string;
  obligationId: string;
  principal: string;
};

export function errCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'getResponse' in e) {
    const r = (e as { getResponse: () => unknown }).getResponse() as {
      code?: string;
    };
    if (r && typeof r === 'object' && typeof r.code === 'string') return r.code;
  }
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { code?: string } }).response;
    if (r && typeof r.code === 'string') return r.code;
  }
  return undefined;
}

export async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected rejection with code ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected rejection')) {
      throw e;
    }
    expect(errCode(e)).toBe(code);
  }
}

/**
 * Seeds an OPEN ExceptionFinancialObligation with principal 800.00,
 * debtor=CUSTOMER, creditor=MERCHANT (merchant owner), currency PHP.
 * Also creates foreign customer, foreign merchant, admin, and rider for auth tests.
 */
export async function seedOpenObligation(
  prisma: PrismaService,
  exceptions: ExceptionFinancialService,
  opts?: { principal?: string },
): Promise<Stage13aSettlementSeed> {
  const principal = opts?.principal ?? '800.00';
  const tag = randomUUID();
  const mkUser = (role: UserRole, prefix: string) =>
    prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s13a-${prefix}-${tag}@test.invalid`,
        role,
        firstName: `S13A${prefix}`,
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
      name: `S13A ${tag}`,
      slug: `s13a-${tag}`,
      commerceDomain: CommerceDomain.NON_FOOD,
      allowRiderAdvance: true,
    },
  });
  const foreignMerchant = await prisma.merchant.create({
    data: {
      userId: foreignMerchantUser.id,
      name: `S13A-F ${tag}`,
      slug: `s13a-f-${tag}`,
      commerceDomain: CommerceDomain.NON_FOOD,
      allowRiderAdvance: false,
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
      orderCode: `WK-S13A-${tag.slice(0, 8)}`,
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
      deliveryAddress: '123 Stage13A St, Manila',
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
      correlationId: `s13a-rec-${tag.slice(0, 8)}`,
      status: OperationsRecoveryStatus.CLOSED,
      currentDisposition:
        OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
      closedAt: new Date(),
      closedByActorType: 'SYSTEM_ADMIN',
      closedByActorId: admin.id,
      closeReason: 'Stage 13A settlement acceptance fixture',
    },
  });

  const opened = await exceptions.openClaimFromRecovery({
    operationsRecoveryId: recovery.id,
    actorUserId: admin.id,
    claimType: ExceptionClaimType.GOODS_LOSS,
    subjectRef: `order-goods:${order.id}`,
    claimedAmount: null,
    correlationId: `s13a-open-${tag.slice(0, 8)}`,
  });

  const evidence = await exceptions.addEvidence({
    claimId: opened.claim.id,
    actorUserId: admin.id,
    evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
    visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
    notes: 'customer liability fixture',
    correlationId: `s13a-ev-${tag.slice(0, 8)}`,
  });
  await exceptions.verifyEvidence({
    claimId: opened.claim.id,
    evidenceId: evidence.evidenceId,
    actorUserId: admin.id,
    verificationStatus: ClaimVerificationStatus.VERIFIED,
    correlationId: `s13a-vf-${tag.slice(0, 8)}`,
  });
  await exceptions.concludeVerifiedFact({
    claimId: opened.claim.id,
    actorUserId: admin.id,
    factType: VerifiedFactType.GOODS_LOST_CONFIRMED,
    statement: 'Customer-liable goods loss fixture for Stage13A settlement',
    attributedPartyType: ExceptionLiablePartyType.CUSTOMER,
    attributedPartyUserId: customer.id,
    supportingEvidenceId: evidence.evidenceId,
    correlationId: `s13a-fact-${tag.slice(0, 8)}`,
  });

  const created = await exceptions.createDetermination({
    claimId: opened.claim.id,
    actorUserId: admin.id,
    allocations: [
      {
        partyType: ExceptionLiablePartyType.CUSTOMER,
        partyUserId: customer.id,
        amount: principal,
      },
    ],
    correlationId: `s13a-det-${tag.slice(0, 8)}`,
  });
  await exceptions.proposeDetermination({
    determinationId: created.determination.id,
    actorUserId: admin.id,
    correlationId: `s13a-prop-${tag.slice(0, 8)}`,
  });
  const finalized = await exceptions.finalizeDetermination({
    determinationId: created.determination.id,
    actorUserId: admin.id,
    reason: 'Stage13A settlement seed finalize',
    correlationId: `s13a-fin-${tag.slice(0, 8)}`,
  });

  expect(finalized.obligations).toHaveLength(1);
  const obligation = finalized.obligations[0];
  expect(obligation.debtorType).toBe(ExceptionLiablePartyType.CUSTOMER);
  expect(obligation.debtorUserId).toBe(customer.id);
  expect(obligation.creditorType).toBe(ExceptionLiablePartyType.MERCHANT);
  expect(obligation.creditorMerchantId).toBe(merchant.id);
  expect(obligation.principal).toBe(principal);
  expect(obligation.status).toBe(ExceptionFinancialObligationStatus.OPEN);

  return {
    tag,
    customerId: customer.id,
    riderId: rider.id,
    adminId: admin.id,
    merchantUserId: merchantUser.id,
    foreignId: foreign.id,
    foreignMerchantUserId: foreignMerchantUser.id,
    foreignMerchantId: foreignMerchant.id,
    merchantId: merchant.id,
    orderId: order.id,
    fulfillmentId: fulfillment.id,
    recoveryId: recovery.id,
    claimId: opened.claim.id,
    economicLossId: opened.claim.economicLossId,
    determinationId: created.determination.id,
    obligationId: obligation.id,
    principal,
  };
}

/** Insert a FINALIZED successor adjustment determination (no economic effect). */
export async function insertFinalizedSuccessorAdjustment(
  prisma: PrismaService,
  seed: Stage13aSettlementSeed,
): Promise<string> {
  const source = await prisma.liabilityDetermination.findUniqueOrThrow({
    where: { id: seed.determinationId },
  });
  const id = randomUUID();
  await prisma.liabilityDetermination.create({
    data: {
      id,
      exceptionClaimId: source.exceptionClaimId,
      economicLossId: source.economicLossId,
      policyVersionId: source.policyVersionId,
      policyHash: source.policyHash,
      status: 'FINALIZED',
      currency: source.currency,
      totalLiabilityAmount: new Prisma.Decimal('1.00'),
      compensableAmountSnapshot: source.compensableAmountSnapshot,
      priorCoverageAmountSnapshot: source.priorCoverageAmountSnapshot,
      remainingAmountSnapshot: new Prisma.Decimal('1.00'),
      adjustmentOfDeterminationId: source.id,
      reason: 'Stage13A RECONCILIATION_REQUIRED fixture',
      createdByActorType: 'SYSTEM_ADMIN',
      createdByActorId: seed.adminId,
      finalizedByActorType: 'SYSTEM_ADMIN',
      finalizedByActorId: seed.adminId,
      finalizedAt: new Date(),
      correlationId: `s13a-adj-${seed.tag.slice(0, 8)}`,
    },
  });
  return id;
}
