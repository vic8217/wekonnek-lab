/**
 * Stage13B-1 postgres fixture helpers. Test-only. Unique-UUID rows left orphaned.
 */
import {
  CommerceDomain,
  EconomicLossCoverageSourceKind,
  ExceptionFinancialObligationStatus,
  ExceptionFinancialSettlementMethod,
  ExceptionFinancialSettlementStatus,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OrderDomainActorType,
  Prisma,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialPartyType,
  RiderAdvanceCollectionRestrictionEffect,
  RiderAdvanceCollectionRestrictionStatus,
  RiderAdvanceSettlementMethod,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { toMoney } from './financial-reconciliation.policy';

export type Stage13b1OrderSeed = {
  tag: string;
  customerId: string;
  riderAId: string;
  riderBId: string;
  merchantUserId: string;
  merchantId: number;
  orderId: number;
  fulfillmentId: string;
  assignmentId: string;
};

export async function seedOrderParties(
  prisma: PrismaService,
): Promise<Stage13b1OrderSeed> {
  const tag = randomUUID();
  const mkUser = (role: UserRole, prefix: string) =>
    prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s13b1-${prefix}-${tag}@test.invalid`,
        role,
        firstName: `S13B1${prefix}`,
      },
    });
  const customer = await mkUser(UserRole.customer, 'c');
  const riderA = await mkUser(UserRole.rider, 'ra');
  const riderB = await mkUser(UserRole.rider, 'rb');
  const merchantUser = await mkUser(UserRole.merchant, 'm');
  const merchant = await prisma.merchant.create({
    data: {
      userId: merchantUser.id,
      name: `S13B1 ${tag}`,
      slug: `s13b1-${tag}`,
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
      orderCode: `WK-S13B1-${tag.slice(0, 8)}`,
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
      deliveryAddress: '123 Stage13B1 St, Manila',
      orderItems: {
        create: [{ productName: 'item', quantity: 1, price: 1000, subtotal: 1000 }],
      },
    },
  });
  const fulfillment = await prisma.orderFulfillment.create({
    data: {
      id: randomUUID(),
      wkOrderId: order.id,
      merchantId: merchant.id,
      customerId: customer.id,
      status: FulfillmentStatus.returned,
      assignmentVersion: 1,
      activeRiderId: riderB.id,
      physicalCustodianRiderId: riderB.id,
    },
  });
  const assignment = await prisma.riderAssignment.create({
    data: {
      id: randomUUID(),
      fulfillmentId: fulfillment.id,
      riderId: riderA.id,
      status: RiderAssignmentStatus.ACTIVE,
      assignmentVersion: 1,
    },
  });
  return {
    tag,
    customerId: customer.id,
    riderAId: riderA.id,
    riderBId: riderB.id,
    merchantUserId: merchantUser.id,
    merchantId: merchant.id,
    orderId: order.id,
    fulfillmentId: fulfillment.id,
    assignmentId: assignment.id,
  };
}

export async function insertRiderAdvance(
  prisma: PrismaService,
  fx: Stage13b1OrderSeed,
  opts: {
    riderId: string;
    principal?: Prisma.Decimal.Value | null;
    status?: RiderAdvanceStatus;
    createdAt?: Date;
    currency?: string;
  },
): Promise<string> {
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
          { id: randomUUID(), role: 'RIDER', userId: opts.riderId },
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
      termsSnapshot: { kind: 's13b1_test' },
      termsHash: randomUUID().replace(/-/g, ''),
    },
  });
  await prisma.agreement.update({
    where: { id: agreementId },
    data: { currentVersionId: versionId },
  });
  const id = randomUUID();
  await prisma.riderAdvance.create({
    data: {
      id,
      wkOrderId: fx.orderId,
      fulfillmentId: fx.fulfillmentId,
      agreementId,
      agreementVersionId: versionId,
      customerId: fx.customerId,
      merchantId: fx.merchantId,
      riderId: opts.riderId,
      riderAssignmentId: fx.assignmentId,
      assignmentVersion: 1,
      currency: opts.currency ?? 'PHP',
      authorizedMaximumAmount: toMoney(opts.principal ?? 800),
      actualAdvanceAmount:
        opts.principal == null ? null : toMoney(opts.principal),
      reimbursementPrincipal:
        opts.principal == null ? null : toMoney(opts.principal),
      status: opts.status ?? RiderAdvanceStatus.REIMBURSEMENT_DUE,
      createdAt: opts.createdAt,
    },
  });
  return id;
}

export async function insertRiderAdvanceAck(
  prisma: PrismaService,
  fx: Stage13b1OrderSeed,
  riderAdvanceId: string,
  amount: Prisma.Decimal.Value,
  creditorRiderId: string = fx.riderAId,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await prisma.riderAdvanceSettlement.create({
    data: {
      id,
      riderAdvanceId,
      wkOrderId: fx.orderId,
      customerId: fx.customerId,
      creditorRiderId,
      method: RiderAdvanceSettlementMethod.CASH,
      status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
      currency: 'PHP',
      claimedAmount: toMoney(amount),
      acknowledgedAmount: toMoney(amount),
      claimedAt: now,
      acknowledgedAt: now,
    },
  });
  return id;
}

export async function insertActiveRestriction(
  prisma: PrismaService,
  fx: Stage13b1OrderSeed,
  riderAdvanceId: string,
  determinationId: string,
  amount: Prisma.Decimal.Value,
  status: RiderAdvanceCollectionRestrictionStatus = RiderAdvanceCollectionRestrictionStatus.ACTIVE,
): Promise<string> {
  const id = randomUUID();
  await prisma.riderAdvanceCollectionRestriction.create({
    data: {
      id,
      riderAdvanceId,
      wkOrderId: fx.orderId,
      returnFinancialDeterminationId: determinationId,
      restrictedAmount: toMoney(amount),
      effect:
        RiderAdvanceCollectionRestrictionEffect.TRANSFER_OUTSTANDING_TO_MERCHANT_RETURN_RESOLUTION,
      status,
      createdByActorType: OrderDomainActorType.SYSTEM,
      createdByActorId: fx.merchantUserId,
    },
  });
  return id;
}

export async function insertFinalizedReturnDetermination(
  prisma: PrismaService,
  fx: Stage13b1OrderSeed,
  opts: {
    riderAdvanceId: string | null;
    merchantToRider: Prisma.Decimal.Value;
    merchantToCustomer: Prisma.Decimal.Value;
    status?: ReturnFinancialDeterminationStatus;
    snapshotPrincipal?: Prisma.Decimal.Value;
    snapshotReimbursed?: Prisma.Decimal.Value;
    creditorRiderId?: string;
    path?: string;
    currency?: string;
  },
): Promise<{ determinationId: string; riderObligationId: string; customerObligationId: string }> {
  const custody = await prisma.custodyEvent.create({
    data: {
      id: randomUUID(),
      wkOrderId: fx.orderId,
      fulfillmentId: fx.fulfillmentId,
      eventType: 'RETURN_RECEIVED',
      fromPartyRole: 'RIDER',
      toPartyRole: 'MERCHANT',
      fromUserId: fx.riderAId,
      toUserId: fx.merchantUserId,
      actorUserId: fx.merchantUserId,
      correlationId: `s13b1-ret-${fx.tag.slice(0, 8)}`,
      occurredAt: new Date(),
    },
  });
  const status = opts.status ?? ReturnFinancialDeterminationStatus.FINALIZED;
  const determination = await prisma.returnFinancialDetermination.create({
    data: {
      id: randomUUID(),
      wkOrderId: fx.orderId,
      fulfillmentId: fx.fulfillmentId,
      returnCustodyEventId: custody.id,
      riderAdvanceId: opts.riderAdvanceId,
      status,
      path: opts.path ?? 'RIDER_ADVANCE',
      outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
      currency: opts.currency ?? 'PHP',
      snapshotPrincipal: toMoney(opts.snapshotPrincipal ?? 800),
      snapshotReimbursed: toMoney(
        opts.snapshotReimbursed ?? opts.merchantToCustomer,
      ),
      merchantToRiderAmount: toMoney(opts.merchantToRider),
      merchantToCustomerAmount: toMoney(opts.merchantToCustomer),
      finalizedAt:
        status === ReturnFinancialDeterminationStatus.FINALIZED ? new Date() : null,
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
  let riderObligationId = '';
  if (toMoney(opts.merchantToRider).gt(0)) {
    const riderObligation = await prisma.returnFinancialObligation.create({
      data: {
        id: randomUUID(),
        determinationId: determination.id,
        wkOrderId: fx.orderId,
        merchantId: fx.merchantId,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
        debtorType: ReturnFinancialPartyType.MERCHANT,
        debtorMerchantId: fx.merchantId,
        creditorType: ReturnFinancialPartyType.RIDER,
        creditorUserId: opts.creditorRiderId ?? fx.riderAId,
        principal: toMoney(opts.merchantToRider),
        reason: 'Stage 9 P−R merchant→rider repayment',
      },
    });
    riderObligationId = riderObligation.id;
  }
  let customerObligationId = '';
  if (toMoney(opts.merchantToCustomer).gt(0)) {
    const customerObligation = await prisma.returnFinancialObligation.create({
      data: {
        id: randomUUID(),
        determinationId: determination.id,
        wkOrderId: fx.orderId,
        merchantId: fx.merchantId,
        type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
        debtorType: ReturnFinancialPartyType.MERCHANT,
        debtorMerchantId: fx.merchantId,
        creditorType: ReturnFinancialPartyType.CUSTOMER,
        creditorUserId: fx.customerId,
        principal: toMoney(opts.merchantToCustomer),
        reason: 'Stage 9 R merchant→customer refund',
      },
    });
    customerObligationId = customerObligation.id;
  }
  return {
    determinationId: determination.id,
    riderObligationId,
    customerObligationId,
  };
}

export async function insertExceptionAck(
  prisma: PrismaService,
  input: {
    obligationId: string;
    wkOrderId: number;
    amount: Prisma.Decimal.Value;
    debtorType: ExceptionLiablePartyType;
    debtorUserId: string | null;
    debtorMerchantId: number | null;
    creditorType: ExceptionLiablePartyType;
    creditorUserId: string | null;
    creditorMerchantId: number | null;
    actorId: string;
  },
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await prisma.exceptionFinancialSettlement.create({
    data: {
      id,
      obligationId: input.obligationId,
      wkOrderId: input.wkOrderId,
      debtorTypeSnapshot: input.debtorType,
      debtorUserIdSnapshot: input.debtorUserId,
      debtorMerchantIdSnapshot: input.debtorMerchantId,
      creditorTypeSnapshot: input.creditorType,
      creditorUserIdSnapshot: input.creditorUserId,
      creditorMerchantIdSnapshot: input.creditorMerchantId,
      method: ExceptionFinancialSettlementMethod.CASH,
      status: ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
      currency: 'PHP',
      claimedAmount: toMoney(input.amount),
      acknowledgedAmount: toMoney(input.amount),
      claimedAt: now,
      claimedByType: OrderDomainActorType.SYSTEM_ADMIN,
      claimedById: input.actorId,
      acknowledgedAt: now,
      acknowledgedByType: OrderDomainActorType.SYSTEM_ADMIN,
      acknowledgedById: input.actorId,
    },
  });
  return id;
}

export async function insertStage12Coverage(
  prisma: PrismaService,
  input: {
    economicLossId: string;
    obligationId: string;
    amount: Prisma.Decimal.Value;
    actorId: string;
    subjectRef: string;
  },
): Promise<string> {
  const id = randomUUID();
  await prisma.economicLossCoverage.create({
    data: {
      id,
      economicLossId: input.economicLossId,
      sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
      sourceRef: input.obligationId,
      subjectRefSnapshot: input.subjectRef,
      amount: toMoney(input.amount),
      createdByActorType: OrderDomainActorType.SYSTEM_ADMIN,
      createdByActorId: input.actorId,
    },
  });
  return id;
}

export async function insertStage9Coverage(
  prisma: PrismaService,
  input: {
    economicLossId: string;
    obligationId: string;
    amount: Prisma.Decimal.Value;
    actorId: string;
    subjectRef: string;
    currency?: string;
    sourceRef?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await prisma.economicLossCoverage.create({
    data: {
      id,
      economicLossId: input.economicLossId,
      sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
      sourceRef: input.sourceRef ?? input.obligationId,
      stage9ObligationId: input.obligationId,
      subjectRefSnapshot: input.subjectRef,
      amount: toMoney(input.amount),
      currency: input.currency ?? 'PHP',
      createdByActorType: OrderDomainActorType.SYSTEM_ADMIN,
      createdByActorId: input.actorId,
    },
  });
  return id;
}

export { ExceptionFinancialObligationStatus, ExceptionLiablePartyType };
