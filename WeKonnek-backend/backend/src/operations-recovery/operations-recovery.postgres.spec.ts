/**
 * Stage 11 operations recovery — PostgreSQL acceptance (items 1–28).
 * Requires backend/.env.stage11.test → wekonnek_stage11_test
 * (or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → wekonnek_stage11_regression_test).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertLegacyPostgresSuiteIdentity,
  resolveStage12ExpectedDatabase
} from '../test-support/acceptance-database';
import {
  isCurrentSchemaRegressionMode,
  STAGE11_ACCEPTANCE_DATABASE
} from '../test-support/test-database-guard';

const STAGE11_ENV_PRESENT = loadStageTestEnv('.env.stage11.test');

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgreementStatus,
  AgreementType,
  CommerceDomain,
  CustomerDeliveryHandoffTokenStatus,
  DeliveryAttemptOutcome,
  DeliveryFailureReasonCode,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationalCaseStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryEvidenceKind,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  OperationsRecoveryVerificationCode,
  Prisma,
  RedeliveryAuthorizationStatus,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { DeliveryFailureService } from '../delivery-failure/delivery-failure.service';
import { DeliveryHandoffService } from '../delivery-handoff/delivery-handoff.service';
import { AuthActorService } from '../fulfillment/auth-actor.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { FULFILLMENT_TRANSITIONS } from '../fulfillment/fulfillment-state-machine';
import { OrderOperationalStateService } from '../order-operational-state/order-operational-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderCustodyHandoffService } from '../rider-custody-handoff/rider-custody-handoff.service';
import {
  evaluateRedeliveryAttemptCollectibility,
  MAX_DELIVERY_ATTEMPTS,
} from '../redelivery/redelivery.policy';
import { RedeliveryService } from '../redelivery/redelivery.service';
import { ReturnHandoffService } from '../return-handoff/return-handoff.service';
import { RiderAdvanceCollectibilityService } from '../return-financial/rider-advance-collectibility.service';
import { ReturnFinancialDeterminationService } from '../return-financial/return-financial-determination.service';
import { ReturnFinancialTermsService } from '../return-financial/return-financial-terms.service';
import { OperationsRecoveryService } from './operations-recovery.service';

const describeIf = STAGE11_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = isCurrentSchemaRegressionMode()
  ? resolveStage12ExpectedDatabase()
  : STAGE11_ACCEPTANCE_DATABASE;

function errCode(e: unknown): string | undefined {
  if (
    e instanceof ForbiddenException ||
    e instanceof BadRequestException ||
    e instanceof ConflictException
  ) {
    const r = e.getResponse() as { code?: string };
    return typeof r === 'object' ? r.code : undefined;
  }
  return undefined;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
  Ctor:
    | typeof ForbiddenException
    | typeof BadRequestException
    | typeof ConflictException = ForbiddenException,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${Ctor.name} ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected ')) throw e;
    expect(e).toBeInstanceOf(Ctor);
    expect(errCode(e)).toBe(code);
  }
}

function windowTimes(opts?: {
  startOffsetMs?: number;
  durationMs?: number;
}): { windowStart: Date; windowEnd: Date } {
  const startOffsetMs = opts?.startOffsetMs ?? 2 * 60 * 60 * 1000;
  const durationMs = opts?.durationMs ?? 2 * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() + startOffsetMs);
  const windowEnd = new Date(windowStart.getTime() + durationMs);
  return { windowStart, windowEnd };
}

type SeedIds = {
  customerId: string;
  riderId: string;
  riderBId: string;
  adminId: string;
  merchantUserId: string;
  foreignId: string;
  merchantId: number;
  orderId: number;
  fulfillmentId: string;
  tokenId: string;
  attemptId: string | undefined;
  caseId: string | undefined;
  raId: string | null;
  assignmentId: string;
};

describeIf(`Stage 11 Operations Recovery PostgreSQL (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const riderAdvance = new RiderAdvanceService(prisma, events);
  const assignments = new RiderAssignmentService(prisma, events, riderAdvance);
  const transitions = new FulfillmentTransitionService(
    prisma,
    events,
    assignments,
  );
  const authActors = new AuthActorService(prisma);
  const failures = new DeliveryFailureService(
    prisma,
    events,
    transitions,
    authActors,
  );
  const redelivery = new RedeliveryService(
    prisma,
    events,
    transitions,
    authActors,
  );
  const operational = new OrderOperationalStateService(prisma);
  const custody = new CustodyEventService(prisma, events);
  const config = {
    get: (key: string) => {
      if (key === 'DELIVERY_HANDOFF_TTL_SECONDS') return '300';
      if (key === 'RIDER_CUSTODY_HANDOFF_TTL_SECONDS') return '300';
      if (key === 'RETURN_HANDOFF_TTL_SECONDS') return '300';
      return undefined;
    },
  } as ConfigService;
  const delivery = new DeliveryHandoffService(
    prisma,
    events,
    custody,
    transitions,
    config,
  );
  const custodyHandoff = new RiderCustodyHandoffService(
    prisma,
    events,
    custody,
    assignments,
    config,
  );
  const returns = new ReturnHandoffService(
    prisma,
    events,
    custody,
    transitions,
    config,
  );
  const collectibility = new RiderAdvanceCollectibilityService(prisma);
  const terms = new ReturnFinancialTermsService(prisma);
  const determinations = new ReturnFinancialDeterminationService(
    prisma,
    events,
    collectibility,
    terms,
  );
  const recovery = new OperationsRecoveryService(prisma);

  const cleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    await prisma.$connect();
    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 11 operations recovery',
      historicalDatabases: [STAGE11_ACCEPTANCE_DATABASE],
      historicalUsers: new Set(['victor', STAGE11_ACCEPTANCE_DATABASE]),
    });
  });

  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  afterAll(async () => prisma.onModuleDestroy());

  function registerCleanup(ids: {
    orderId: number;
    fulfillmentId: string;
    merchantId: number;
    userIds: string[];
  }) {
    // Prefer disposable DB / unique fixture IDs over deleting append-only history.
    // Ordinary application privileges must never DELETE delivery_attempts.
    cleanups.push(async () => {
      void ids;
      return;
    });
  }

  async function seedFailed(opts?: {
    pendingCustody?: boolean;
    returning?: boolean;
    returnedWithCustody?: boolean;
    hollowReturned?: boolean;
    withRa?: boolean;
    /** Stay in_transit with ACTIVE delivery token; skip Stage 8 failure. */
    skipFailure?: boolean;
  }): Promise<SeedIds> {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s11-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S11${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const riderB = await mkUser(UserRole.rider, 'b');
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const foreign = await mkUser(UserRole.customer, 'f');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S11 ${tag}`,
        slug: `s11-${tag}`,
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
        orderCode: `WK-S11-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1000,
        deliveryFee: 50,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: '123 Stage11 St, Manila',
        customerBarangay: 'Test Brgy',
        orderItems: {
          create: [
            {
              productName: 'item',
              quantity: 1,
              price: 1000,
              subtotal: 1000,
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
        status: FulfillmentStatus.in_transit,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
        pendingCustodyIncomingRiderId: opts?.pendingCustody ? riderB.id : null,
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

    let raId: string | null = null;
    if (opts?.withRa) {
      const agreementId = randomUUID();
      const versionId = randomUUID();
      await prisma.agreement.create({
        data: {
          id: agreementId,
          wkOrderId: order.id,
          agreementType: AgreementType.RIDER_ADVANCE,
          status: AgreementStatus.ACTIVE,
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
          termsSnapshot: { kind: 's11_test' },
          termsHash: randomUUID().replace(/-/g, ''),
        },
      });
      await prisma.agreement.update({
        where: { id: agreementId },
        data: { currentVersionId: versionId },
      });
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
          authorizedMaximumAmount: new Prisma.Decimal('800.00'),
          actualAdvanceAmount: new Prisma.Decimal('800.00'),
          reimbursementPrincipal: new Prisma.Decimal('800.00'),
          status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
        },
      });
    }

    const token = await prisma.customerDeliveryHandoffToken.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        customerId: customer.id,
        deliveryRiderId: rider.id,
        riderAssignmentId: assignment.id,
        assignmentVersion: 1,
        purpose: 'CUSTOMER_DELIVERY_HANDOFF',
        tokenHash: `hash-${tag}`,
        otpHash: `otp-${tag}`,
        status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 600_000),
        createdByUserId: rider.id,
      },
    });

    let failResult: Awaited<ReturnType<typeof failures.reportFailure>> | null =
      null;
    if (!opts?.pendingCustody && !opts?.skipFailure) {
      failResult = await failures.reportFailure({
        wkOrderId: order.id,
        actorUserId: rider.id,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        correlationId: `fail-${tag}`,
      });
    }

    if (opts?.returning || opts?.returnedWithCustody || opts?.hollowReturned) {
      await prisma.orderFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          status: opts.returnedWithCustody || opts.hollowReturned
            ? FulfillmentStatus.returned
            : FulfillmentStatus.returning,
        },
      });
      if (opts.returnedWithCustody) {
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
            correlationId: `ret-${tag}`,
            occurredAt: new Date(),
          },
        });
      }
    }

    const ids: SeedIds = {
      customerId: customer.id,
      riderId: rider.id,
      riderBId: riderB.id,
      adminId: admin.id,
      merchantUserId: merchantUser.id,
      foreignId: foreign.id,
      merchantId: merchant.id,
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      tokenId: token.id,
      attemptId: failResult?.attempt?.id,
      caseId: failResult?.case?.id,
      raId,
      assignmentId: assignment.id,
    };

    registerCleanup({
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      merchantId: merchant.id,
      userIds: [
        customer.id,
        rider.id,
        riderB.id,
        admin.id,
        merchantUser.id,
        foreign.id,
      ],
    });

    return ids;
  }

  async function seedExhausted(
    opts?: Parameters<typeof seedFailed>[0],
  ): Promise<SeedIds> {
    const fx = await seedFailed(opts);
    for (const attemptNumber of [2, 3] as const) {
      await prisma.deliveryAttempt.create({
        data: {
          id: randomUUID(),
          wkOrderId: fx.orderId,
          fulfillmentId: fx.fulfillmentId,
          attemptNumber,
          riderId: fx.riderId,
          riderAssignmentId: fx.assignmentId,
          assignmentVersion: 1,
          physicalCustodianRiderId: fx.riderId,
          outcome: DeliveryAttemptOutcome.FAILED,
          failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
          occurredAt: new Date(),
          reportedByActorType: 'RIDER',
          reportedByActorId: fx.riderId,
          correlationId: `exh-${attemptNumber}-${randomUUID()}`,
        },
      });
    }
    return fx;
  }

  async function seedMinimalDetermination(
    fx: SeedIds,
    status: ReturnFinancialDeterminationStatus,
  ) {
    const custodyEv = await prisma.custodyEvent.create({
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
        correlationId: `det-custody-${randomUUID()}`,
        occurredAt: new Date(),
      },
    });
    return prisma.returnFinancialDetermination.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        returnCustodyEventId: custodyEv.id,
        status,
        path: 'RIDER_ADVANCE',
        operationalCaseId: fx.caseId ?? null,
        deliveryAttemptId: fx.attemptId ?? null,
        outcome:
          ReturnFinancialDeterminationOutcome.OPERATIONS_RECOVERY_REQUIRED,
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
  }

  async function openRecovery(
    fx: SeedIds,
    trigger: OperationsRecoveryTrigger,
    opts?: { notes?: string; idempotencyKey?: string; correlationId?: string },
  ) {
    return recovery.open({
      wkOrderId: fx.orderId,
      actorUserId: fx.adminId,
      openingTriggerCode: trigger,
      correlationId: opts?.correlationId ?? `open-${randomUUID()}`,
      notes: opts?.notes,
      idempotencyKey: opts?.idempotencyKey,
    });
  }

  async function investigateAndSelect(
    recoveryId: string,
    adminId: string,
    disposition: OperationsRecoveryDisposition,
  ) {
    await recovery.startInvestigation({
      recoveryId,
      actorUserId: adminId,
      correlationId: `inv-${randomUUID()}`,
    });
    return recovery.selectDisposition({
      recoveryId,
      actorUserId: adminId,
      disposition,
      reason: `select-${disposition}`,
      correlationId: `disp-${randomUUID()}`,
    });
  }

  async function closeNoFurther(recoveryId: string, adminId: string) {
    return recovery.close({
      recoveryId,
      actorUserId: adminId,
      reason: 'No further fulfillment — Stage 11 acceptance',
      correlationId: `close-${randomUUID()}`,
      explicitConclusionAcknowledged: true,
    });
  }

  // ─── 1 + 19: returning sticky / Stage 6 no RETURN_RECEIVED ───

  it('1+19: returning sticky — close NO_FURTHER keeps returning, no RETURN_RECEIVED', async () => {
    const fx = await seedFailed({ returning: true });
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.RETURN_BLOCKED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );
    await closeNoFurther(opened.recovery.id, fx.adminId);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(ful.status).toBe(FulfillmentStatus.returning);
    const rr = await prisma.custodyEvent.count({
      where: { fulfillmentId: fx.fulfillmentId, eventType: 'RETURN_RECEIVED' },
    });
    expect(rr).toBe(0);
  });

  // ─── 2: hollow returned + Stage 9 financially ineligible ───

  it('2: hollow returned → Stage9 RETURN_NOT_FINANCIALLY_ELIGIBLE + HOLLOW flag; no RETURN_COMPLETED', async () => {
    const fx = await seedFailed({ hollowReturned: true });
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.CUSTODY_UNCONFIRMED,
    );
    expect(opened.recovery.status).toBe(OperationsRecoveryStatus.OPEN);

    const ops = await operational.getForOrder(fx.orderId, fx.adminId);
    expect(ops.flags).toContain('HOLLOW_RETURNED_WITHOUT_MERCHANT_CUSTODY');
    expect(ops.flags).toContain('OPERATIONS_RECOVERY_OPEN');
    expect(ops.flags).not.toContain('RETURN_COMPLETED');

    const rr = await prisma.custodyEvent.count({
      where: { fulfillmentId: fx.fulfillmentId, eventType: 'RETURN_RECEIVED' },
    });
    expect(rr).toBe(0);

    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
        correlationId: `hollow-s9-${randomUUID()}`,
      }),
      'RETURN_NOT_FINANCIALLY_ELIGIBLE',
    );

    const dets = await prisma.returnFinancialDetermination.count({
      where: { wkOrderId: fx.orderId },
    });
    expect(dets).toBe(0);
  });

  // ─── 3 + 4 + 21: attempt budget / adminActivate cannot bypass ───

  it('3+4+21: exhausted blocks request + adminActivate; collectibility rejects target 4', async () => {
    const fx = await seedExhausted();
    const failedCount = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    expect(failedCount).toBe(MAX_DELIVERY_ATTEMPTS);

    const budget = evaluateRedeliveryAttemptCollectibility(failedCount);
    expect(budget.allowed).toBe(false);
    expect(budget.code).toBe('REDELIVERY_ATTEMPT_LIMIT_REACHED');

    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        correlationId: `req-exh-${randomUUID()}`,
      }),
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
    );

    await openRecovery(
      fx,
      OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
    );

    const authId = randomUUID();
    const { windowStart: ws, windowEnd: we } = windowTimes();
    const orderRow = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    await prisma.redeliveryAuthorization.create({
      data: {
        id: authId,
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        customerId: fx.customerId,
        merchantId: fx.merchantId,
        targetAttemptNumber: 4,
        addressSnapshot: {
          mode: 'SAME_AS_ORDER',
          deliveryAddress: orderRow.deliveryAddress,
          customerBarangay: orderRow.customerBarangay,
          deliveryZoneName: orderRow.deliveryZoneName,
        },
        windowStart: ws,
        windowEnd: we,
        status: RedeliveryAuthorizationStatus.REQUESTED,
        requestedByActorType: 'CUSTOMER',
        requestedByActorId: fx.customerId,
        priorOperationalCaseId: fx.caseId ?? null,
        correlationId: `auth4-${randomUUID()}`,
      },
    });

    try {
      await redelivery.adminActivate({
        authorizationId: authId,
        actorUserId: fx.adminId,
        reason: 'try bypass',
        correlationId: `admin-act-${randomUUID()}`,
      });
      throw new Error('Expected adminActivate to be blocked');
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Expected ')) throw e;
      // Active Stage11 exclusivity, limit, or attempt mismatch — all prove no attempt 4.
      expect([
        'OPERATIONS_RECOVERY_ACTIVE',
        'REDELIVERY_ATTEMPT_LIMIT_REACHED',
        'REDELIVERY_ATTEMPT_CONFLICT',
      ]).toContain(errCode(e));
    }
  });

  // ─── 5–8: pending clear preserves custodian / no fabricated transfer ───

  it('5-8: CLEAR_PENDING clears intent only — no transfer events, custodian preserved', async () => {
    const fx = await seedFailed({ pendingCustody: true });
    const beforeCustodian = (
      await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      })
    ).physicalCustodianRiderId;
    const assignmentCountBefore = await prisma.riderAssignment.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    const transferCustodyBefore = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: {
          in: ['RIDER_TRANSFER_RECEIVED', 'RIDER_TRANSFER_RELEASED'],
        },
      },
    });

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER,
    );

    const cleared = await recovery.clearPendingCustodyTransferIntent({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      reason: 'abandon pending transfer',
      correlationId: `clear-${randomUUID()}`,
    });
    expect(cleared.pendingCustodyIncomingRiderId).toBeNull();
    expect(cleared.physicalCustodianRiderId).toBe(beforeCustodian);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(ful.pendingCustodyIncomingRiderId).toBeNull();
    expect(ful.physicalCustodianRiderId).toBe(beforeCustodian);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: fx.fulfillmentId },
      }),
    ).toBe(assignmentCountBefore);
    expect(
      await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: {
            in: ['RIDER_TRANSFER_RECEIVED', 'RIDER_TRANSFER_RELEASED'],
          },
        },
      }),
    ).toBe(transferCustodyBefore);

    const domainActions = await prisma.orderDomainEvent.findMany({
      where: {
        wkOrderId: fx.orderId,
        action: {
          in: ['RIDER_TRANSFER_RECEIVED', 'RIDER_TRANSFER_RELEASED'],
        },
      },
    });
    expect(domainActions).toHaveLength(0);

    await closeNoFurther(opened.recovery.id, fx.adminId);
  });

  // ─── 9: report != verified ───

  it('9: STATEMENT evidence alone is not GOODS_LOST_VERIFIED', async () => {
    const fx = await seedFailed();
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
    );
    await recovery.addEvidence({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      evidenceKind: OperationsRecoveryEvidenceKind.STATEMENT,
      notes: 'rider reported lost',
      correlationId: `ev-${randomUUID()}`,
    });
    const verBefore = await prisma.operationsRecoveryVerification.count({
      where: {
        operationsRecoveryId: opened.recovery.id,
        verificationCode: OperationsRecoveryVerificationCode.GOODS_LOST_VERIFIED,
      },
    });
    expect(verBefore).toBe(0);

    await recovery.addVerification({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      verificationCode: OperationsRecoveryVerificationCode.GOODS_LOST_VERIFIED,
      notes: 'ops verified',
      correlationId: `ver-${randomUUID()}`,
    });
    const verAfter = await prisma.operationsRecoveryVerification.count({
      where: {
        operationsRecoveryId: opened.recovery.id,
        verificationCode: OperationsRecoveryVerificationCode.GOODS_LOST_VERIFIED,
      },
    });
    expect(verAfter).toBe(1);
  });

  // ─── 10–13 + 26: CLOSED does not deliver / custody / money mutate ───

  it('10-13+26: close NO_FURTHER leaves fulfillment/custody/money unchanged', async () => {
    const fx = await seedFailed({ withRa: true, returning: true });
    const fulBefore = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const orderBefore = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    const raBefore = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: fx.raId! },
    });
    const custodyBefore = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: {
          in: ['RETURN_RECEIVED', 'CUSTOMER_RECEIVED'],
        },
      },
    });

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );
    await closeNoFurther(opened.recovery.id, fx.adminId);

    const fulAfter = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(fulAfter.status).toBe(fulBefore.status);
    expect(fulAfter.status).not.toBe(FulfillmentStatus.delivered);

    const custodyAfter = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: {
          in: ['RETURN_RECEIVED', 'CUSTOMER_RECEIVED'],
        },
      },
    });
    expect(custodyAfter).toBe(custodyBefore);

    const orderAfter = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    expect(orderAfter.merchantPaymentStatus).toBe(
      orderBefore.merchantPaymentStatus,
    );
    expect(Number(orderAfter.transactionFeeAmount)).toBe(
      Number(orderBefore.transactionFeeAmount),
    );
    expect(orderAfter.paymentStatus).toBe(orderBefore.paymentStatus);

    const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: fx.raId! },
    });
    expect(raAfter.status).toBe(raBefore.status);
    expect(String(raAfter.reimbursementPrincipal)).toBe(
      String(raBefore.reimbursementPrincipal),
    );
    expect(raAfter.riderId).toBe(raBefore.riderId);
  });

  // ─── 14: Stage 9 vocabulary separate ───

  it('14: Stage9 OPERATIONS_RECOVERY_REQUIRED outcome ≠ OperationsRecoveryStatus', async () => {
    expect(
      ReturnFinancialDeterminationOutcome.OPERATIONS_RECOVERY_REQUIRED,
    ).toBe('OPERATIONS_RECOVERY_REQUIRED');
    expect(OperationsRecoveryStatus.OPEN).toBe('OPEN');
    expect(OperationsRecoveryStatus.CLOSED).toBe('CLOSED');
    expect(
      Object.values(OperationsRecoveryStatus),
    ).not.toContain('OPERATIONS_RECOVERY_REQUIRED');
    expect(
      Object.values(ReturnFinancialDeterminationOutcome),
    ).not.toContain(OperationsRecoveryStatus.OPEN);
  });

  // ─── 15: cannot reset Stage 10 attempts ───

  it('15: Stage11 ops do not reset failed delivery attempt count', async () => {
    const fx = await seedExhausted();
    const before = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    expect(before).toBe(MAX_DELIVERY_ATTEMPTS);

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );
    await closeNoFurther(opened.recovery.id, fx.adminId);

    const after = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    expect(after).toBe(before);
  });

  // ─── 16: cross-order idempotency ───

  it('16: same open idempotency key on different order → IDEMPOTENCY_CROSS_ORDER_CONFLICT', async () => {
    const a = await seedFailed();
    const b = await seedFailed();
    const key = `cross-${randomUUID()}`;
    // Same actor must own both opens — key is scoped to openedByActorId.
    await recovery.open({
      wkOrderId: a.orderId,
      actorUserId: a.adminId,
      openingTriggerCode: OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
      correlationId: `cross-a-${randomUUID()}`,
      idempotencyKey: key,
    });
    await expectCode(
      recovery.open({
        wkOrderId: b.orderId,
        actorUserId: a.adminId,
        openingTriggerCode: OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
        correlationId: `cross-b-${randomUUID()}`,
        idempotencyKey: key,
      }),
      'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
      ConflictException,
    );
  });

  // ─── 17: auth-before-cache ───

  it('17: non-admin open / foreign get denied before disclosure', async () => {
    const fx = await seedFailed();
    await expectCode(
      recovery.open({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        openingTriggerCode: OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
        correlationId: `forbid-${randomUUID()}`,
      }),
      'OPERATIONS_RECOVERY_FORBIDDEN',
    );

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await expectCode(
      recovery.getById(opened.recovery.id, fx.foreignId),
      'OPERATIONS_RECOVERY_FORBIDDEN',
    );
  });

  // ─── 18: Stage 5A success vs Stage 11 open race ───

  it('18: race Stage5A customer confirm vs Stage11 open — exclusive coherent DB', async () => {
    const fx = await seedFailed({ skipFailure: true });
    const fulBefore = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(fulBefore.status).toBe(FulfillmentStatus.in_transit);

    const issued = await delivery.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `s5a-iss-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      delivery.confirm({
        actorUserId: fx.customerId,
        qrPayload: issued.qrPayload,
        correlationId: `s5a-ok-${randomUUID()}`,
      }),
      openRecovery(fx, OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED, {
        correlationId: `s11-open-${randomUUID()}`,
        idempotencyKey: `s11-open-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const customerReceived = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: 'CUSTOMER_RECEIVED',
      },
    });
    const activeRecovery = await prisma.operationsRecovery.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            OperationsRecoveryStatus.OPEN,
            OperationsRecoveryStatus.INVESTIGATING,
            OperationsRecoveryStatus.DISPOSITION_SELECTED,
          ],
        },
      },
    });

    const successPath =
      ful.status === FulfillmentStatus.delivered && customerReceived > 0;
    const recoveryWithoutInventedSuccess =
      activeRecovery === 1 &&
      ful.status !== FulfillmentStatus.delivered &&
      customerReceived === 0;

    // Exclusive: delivered+CUSTOMER_RECEIVED XOR recovery-open without invented success.
    // (delivered+recovery-open via real Stage 5A counts as successPath.)
    expect(successPath || recoveryWithoutInventedSuccess).toBe(true);
    expect(successPath && recoveryWithoutInventedSuccess).toBe(false);

    // Stage 11 never invents customer success custody.
    const recoveryEvents = await prisma.operationsRecoveryEvent.count({
      where: {
        operationsRecovery: { fulfillmentId: fx.fulfillmentId },
      },
    });
    if (recoveryWithoutInventedSuccess) {
      expect(customerReceived).toBe(0);
      expect(ful.status).toBe(FulfillmentStatus.in_transit);
    }
    if (successPath) {
      expect(customerReceived).toBe(1);
      expect(ful.status).toBe(FulfillmentStatus.delivered);
    }
    void recoveryEvents;
  });

  // ─── 19: Stage 6 RETURN_RECEIVED vs Stage 11 open race ───

  it('19: race Stage6 RETURN_RECEIVED confirm vs Stage11 open — coherent custody', async () => {
    const fx = await seedFailed({ returning: true });
    const issued = await returns.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `s6-iss-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      returns.confirm({
        actorUserId: fx.merchantUserId,
        qrPayload: issued.qrPayload,
        correlationId: `s6-ok-${randomUUID()}`,
      }),
      openRecovery(fx, OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED, {
        correlationId: `s11-s6-${randomUUID()}`,
        idempotencyKey: `s11-s6-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const returnReceived = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: 'RETURN_RECEIVED',
      },
    });
    const activeRecovery = await prisma.operationsRecovery.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            OperationsRecoveryStatus.OPEN,
            OperationsRecoveryStatus.INVESTIGATING,
            OperationsRecoveryStatus.DISPOSITION_SELECTED,
          ],
        },
      },
    });

    const returnPath =
      ful.status === FulfillmentStatus.returned && returnReceived > 0;
    const recoveryWithoutInventedReturn =
      activeRecovery === 1 && returnReceived === 0;

    expect(returnPath || recoveryWithoutInventedReturn).toBe(true);
    expect(returnPath && recoveryWithoutInventedReturn).toBe(false);
    // Stage 11 open never fabricates RETURN_RECEIVED.
    if (recoveryWithoutInventedReturn) {
      expect(ful.status).toBe(FulfillmentStatus.returning);
    }
  });

  // ─── 18 + 23: concurrent opens → one active ───

  it('23: concurrent opens → exactly one active recovery', async () => {
    const fx = await seedFailed();
    const results = await Promise.allSettled([
      openRecovery(fx, OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED, {
        correlationId: `race-a-${randomUUID()}`,
        idempotencyKey: `race-a-${randomUUID()}`,
      }),
      openRecovery(fx, OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED, {
        correlationId: `race-b-${randomUUID()}`,
        idempotencyKey: `race-b-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(errCode((rejected[0] as PromiseRejectedResult).reason)).toBe(
      'OPERATIONS_RECOVERY_ALREADY_ACTIVE',
    );

    const active = await prisma.operationsRecovery.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            OperationsRecoveryStatus.OPEN,
            OperationsRecoveryStatus.INVESTIGATING,
            OperationsRecoveryStatus.DISPOSITION_SELECTED,
          ],
        },
      },
    });
    expect(active).toBe(1);
  });

  // ─── 20: Stage7 confirm vs pending-clear race ───

  it('20: race Stage7 custody confirm vs Stage11 clearPending — coherent pending/custodian', async () => {
    const fx = await seedFailed({ skipFailure: true });
    await assignments.assign({
      fulfillmentId: fx.fulfillmentId,
      riderId: fx.riderBId,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 's11_pending_custody_race',
    });
    const mid = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(mid.pendingCustodyIncomingRiderId).toBe(fx.riderBId);
    const custodianBefore = mid.physicalCustodianRiderId;

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER,
    );

    const issued = await custodyHandoff.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `s7-iss-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      custodyHandoff.confirm({
        actorUserId: fx.riderBId,
        qrPayload: issued.qrPayload,
        correlationId: `s7-ok-${randomUUID()}`,
      }),
      recovery.clearPendingCustodyTransferIntent({
        recoveryId: opened.recovery.id,
        actorUserId: fx.adminId,
        reason: 'clear-vs-confirm',
        correlationId: `clr-s7-${randomUUID()}`,
        idempotencyKey: `clr-s7-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(ful.pendingCustodyIncomingRiderId).toBeNull();

    const transferReceived = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: 'RIDER_TRANSFER_RECEIVED',
      },
    });
    const confirmWon =
      ful.physicalCustodianRiderId === fx.riderBId && transferReceived > 0;
    const clearWon =
      ful.physicalCustodianRiderId === custodianBefore &&
      transferReceived === 0;

    expect(confirmWon || clearWon).toBe(true);
    expect(confirmWon && clearWon).toBe(false);
    // Stage 11 clear never fabricates RIDER_TRANSFER_*.
    if (clearWon) {
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillmentId,
            eventType: {
              in: ['RIDER_TRANSFER_RECEIVED', 'RIDER_TRANSFER_RELEASED'],
            },
          },
        }),
      ).toBe(0);
    }
  });

  // ─── 21: Stage10↔11 mutual exclusivity races ───

  it('21A: race Stage10 confirm autoActivate vs Stage11 ordinary open — exactly one authority', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-21a-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      redelivery.confirm({
        authorizationId: req.authorization.id,
        actorUserId: fx.customerId,
        autoActivate: true,
        correlationId: `conf-21a-${randomUUID()}`,
      }),
      openRecovery(fx, OperationsRecoveryTrigger.OTHER, {
        notes: 'ordinary open race',
        correlationId: `open-21a-${randomUUID()}`,
        idempotencyKey: `open-21a-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const activeRecovery = await prisma.operationsRecovery.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            OperationsRecoveryStatus.OPEN,
            OperationsRecoveryStatus.INVESTIGATING,
            OperationsRecoveryStatus.DISPOSITION_SELECTED,
          ],
        },
      },
    });

    const activated =
      auth.status === RedeliveryAuthorizationStatus.ACTIVATED &&
      ful.status === FulfillmentStatus.in_transit;
    const recoveryOpen = activeRecovery === 1;
    expect(activated !== recoveryOpen).toBe(true);
    expect(activated && recoveryOpen).toBe(false);
    if (activated) {
      expect(activeRecovery).toBe(0);
    } else {
      expect(auth.status).not.toBe(RedeliveryAuthorizationStatus.ACTIVATED);
      expect(ful.status).toBe(FulfillmentStatus.delivery_failed);
      expect(activeRecovery).toBe(1);
    }
  });

  it('21B: race Stage10 adminActivate vs Stage11 ordinary open — exactly one authority', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-race-${randomUUID()}`,
    });
    await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: false,
      correlationId: `conf-race-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      redelivery.adminActivate({
        authorizationId: req.authorization.id,
        actorUserId: fx.adminId,
        reason: 'race_vs_s11',
        correlationId: `act-s11-${randomUUID()}`,
      }),
      openRecovery(fx, OperationsRecoveryTrigger.OTHER, {
        notes: 'ordinary exclusivity race',
        correlationId: `open-act-${randomUUID()}`,
        idempotencyKey: `open-act-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const activeRecovery = await prisma.operationsRecovery.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            OperationsRecoveryStatus.OPEN,
            OperationsRecoveryStatus.INVESTIGATING,
            OperationsRecoveryStatus.DISPOSITION_SELECTED,
          ],
        },
      },
    });

    const activated =
      auth.status === RedeliveryAuthorizationStatus.ACTIVATED &&
      ful.status === FulfillmentStatus.in_transit;
    const recoveryOpen = activeRecovery === 1;
    expect(activated !== recoveryOpen).toBe(true);
    expect(activated && recoveryOpen).toBe(false);
  });

  it('21C: investigative Stage11 open while ACTIVATED redelivery — no second attempt', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-21c-${randomUUID()}`,
    });
    await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: true,
      correlationId: `conf-21c-${randomUUID()}`,
    });
    const fulBefore = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(fulBefore.status).toBe(FulfillmentStatus.in_transit);
    const attemptsBefore = await prisma.deliveryAttempt.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });

    await expectCode(
      openRecovery(fx, OperationsRecoveryTrigger.OTHER, {
        notes: 'blocked ordinary',
        correlationId: `ord-${randomUUID()}`,
        idempotencyKey: `ord-${randomUUID()}`,
      }),
      'REDELIVERY_ACTIVE',
    );

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
      {
        correlationId: `inv-${randomUUID()}`,
        idempotencyKey: `inv-${randomUUID()}`,
      },
    );
    expect(opened.recovery.status).toBe(OperationsRecoveryStatus.OPEN);

    const attemptsAfter = await prisma.deliveryAttempt.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    expect(attemptsAfter).toBe(attemptsBefore);
    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    expect(auth.status).toBe(RedeliveryAuthorizationStatus.ACTIVATED);
    // Already ACTIVATED: adminActivate is idempotent success without new attempt.
    const again = await redelivery.adminActivate({
      authorizationId: req.authorization.id,
      actorUserId: fx.adminId,
      reason: 'already_activated',
      correlationId: `act-dup-${randomUUID()}`,
    });
    expect(again.authorization.status).toBe(
      RedeliveryAuthorizationStatus.ACTIVATED,
    );
    const afterDup = await prisma.deliveryAttempt.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    expect(afterDup).toBe(attemptsBefore);
  });

  it('21D: Stage11 CLOSED does not permanently block Stage10; attempt ceiling absolute', async () => {
    const fx = await seedFailed();
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );
    await closeNoFurther(opened.recovery.id, fx.adminId);
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-21d-${randomUUID()}`,
    });
    const conf = await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: true,
      correlationId: `conf-21d-${randomUUID()}`,
    });
    expect(conf.activated).toBe(true);
    expect(conf.authorization.status).toBe(
      RedeliveryAuthorizationStatus.ACTIVATED,
    );

    // Exhaust remaining budget then prove attempt 4 still impossible
    await failures.reportFailure({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      correlationId: `fail2-21d-${randomUUID()}`,
    });
    // After attempt 2 fail, one more redelivery (attempt 3) then block
    const { windowStart: ws2, windowEnd: we2 } = windowTimes();
    const req2 = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart: ws2,
      windowEnd: we2,
      correlationId: `req2-21d-${randomUUID()}`,
    });
    await redelivery.confirm({
      authorizationId: req2.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: true,
      correlationId: `conf2-21d-${randomUUID()}`,
    });
    await failures.reportFailure({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      correlationId: `fail3-21d-${randomUUID()}`,
    });
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: windowTimes().windowStart,
        windowEnd: windowTimes().windowEnd,
        correlationId: `req4-${randomUUID()}`,
      }),
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
    );
  });

  it('21E: active Stage11 blocks adminActivate with zero side-effects', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-21e-${randomUUID()}`,
    });
    await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: false,
      correlationId: `conf-21e-${randomUUID()}`,
    });
    await openRecovery(fx, OperationsRecoveryTrigger.OTHER, {
      notes: 'block activate',
      correlationId: `open-21e-${randomUUID()}`,
      idempotencyKey: `open-21e-${randomUUID()}`,
    });

    const beforeAuth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const beforeAttempts = await prisma.deliveryAttempt.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    const beforeFul = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });

    await expectCode(
      redelivery.adminActivate({
        authorizationId: req.authorization.id,
        actorUserId: fx.adminId,
        reason: 'must_fail',
        correlationId: `act-21e-${randomUUID()}`,
        idempotencyKey: `act-21e-${randomUUID()}`,
      }),
      'OPERATIONS_RECOVERY_ACTIVE',
    );

    const afterAuth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const afterAttempts = await prisma.deliveryAttempt.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    const afterFul = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(afterAuth.status).toBe(beforeAuth.status);
    expect(afterAuth.status).toBe(RedeliveryAuthorizationStatus.CONFIRMED);
    expect(afterAttempts).toBe(beforeAttempts);
    expect(afterFul.status).toBe(beforeFul.status);
    expect(afterFul.status).toBe(FulfillmentStatus.delivery_failed);
  });

  // ─── 22: Stage9 finalize vs Stage11 close — history immutable ───

  it('22: Stage9 finalize vs Stage11 close — determination history immutable', async () => {
    const fx = await seedFailed({
      withRa: true,
      returnedWithCustody: true,
    });
    const det = await seedMinimalDetermination(
      fx,
      ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
    );
    const beforeSnap = await prisma.returnFinancialDetermination.findUniqueOrThrow(
      {
        where: { id: det.id },
      },
    );

    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );

    const results = await Promise.allSettled([
      determinations.finalize({
        determinationId: det.id,
        actorUserId: fx.merchantUserId,
        correlationId: `fin-s11-${randomUUID()}`,
      }),
      closeNoFurther(opened.recovery.id, fx.adminId),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const after = await prisma.returnFinancialDetermination.findUniqueOrThrow({
      where: { id: det.id },
    });
    // Stage 11 close never deletes or fabricates Stage 9 rows.
    expect(
      await prisma.returnFinancialDetermination.count({
        where: { wkOrderId: fx.orderId },
      }),
    ).toBe(1);
    expect(after.id).toBe(beforeSnap.id);
    expect(after.wkOrderId).toBe(beforeSnap.wkOrderId);
    expect(after.fulfillmentId).toBe(beforeSnap.fulfillmentId);
    expect(after.returnCustodyEventId).toBe(beforeSnap.returnCustodyEventId);
    expect(after.path).toBe(beforeSnap.path);
    expect(after.outcome).toBe(beforeSnap.outcome);

    // If finalize won, FINALIZED fields stick; Stage 11 cannot reopen mutate.
    if (after.status === ReturnFinancialDeterminationStatus.FINALIZED) {
      expect(after.finalizedAt).not.toBeNull();
      await expect(
        prisma.$executeRaw`
          UPDATE return_financial_determinations
          SET outcome = 'QUALIFYING_FULL_RETURN'
          WHERE id = ${after.id}::uuid
        `,
      ).rejects.toThrow(/immutable/i);
    } else {
      // Close-only path: ACKNOWLEDGED history unchanged by Stage 11.
      expect(after.status).toBe(ReturnFinancialDeterminationStatus.ACKNOWLEDGED);
      expect(after.finalizedAt).toBeNull();
    }

    const recoveryRow = await prisma.operationsRecovery.findUniqueOrThrow({
      where: { id: opened.recovery.id },
    });
    // Close may succeed or lose the race; never invent Stage 9 success via Stage 11.
    expect(
      recoveryRow.status === OperationsRecoveryStatus.CLOSED ||
        recoveryRow.status === OperationsRecoveryStatus.DISPOSITION_SELECTED,
    ).toBe(true);
  });

  // ─── 24: terminal immutable ───

  it('24: CLOSED is terminal — prisma status update + cancel blocked', async () => {
    const fx = await seedFailed();
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await investigateAndSelect(
      opened.recovery.id,
      fx.adminId,
      OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
    );
    await closeNoFurther(opened.recovery.id, fx.adminId);

    await expect(
      prisma.operationsRecovery.update({
        where: { id: opened.recovery.id },
        data: { status: OperationsRecoveryStatus.OPEN },
      }),
    ).rejects.toThrow(/terminal_immutable|terminal recovery/i);

    await expectCode(
      recovery.cancel({
        recoveryId: opened.recovery.id,
        actorUserId: fx.adminId,
        reason: 'cannot cancel closed',
        correlationId: `cancel-${randomUUID()}`,
      }),
      'OPERATIONS_RECOVERY_TERMINAL',
      ConflictException,
    );
  });

  // ─── 25: append-only children ───

  it('25: DELETE evidence/events throws append-only', async () => {
    const fx = await seedFailed();
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    const ev = await recovery.addEvidence({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      evidenceKind: OperationsRecoveryEvidenceKind.NOTE,
      notes: 'append-only probe',
      correlationId: `ao-${randomUUID()}`,
    });
    const eventRow = await prisma.operationsRecoveryEvent.findFirstOrThrow({
      where: { operationsRecoveryId: opened.recovery.id },
    });

    await expect(
      prisma.operationsRecoveryEvidence.delete({
        where: { id: ev.evidenceId },
      }),
    ).rejects.toThrow(/append_only/i);
    await expect(
      prisma.operationsRecoveryEvent.delete({ where: { id: eventRow.id } }),
    ).rejects.toThrow(/append_only/i);
  });

  // ─── 27: triggers exist (production-role covered separately) ───

  it('27: Stage11 append-only / terminal triggers exist', async () => {
    const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'stage11_operations_recovery_append_only_del_trg',
          'stage11_operations_recovery_terminal_immutable_trg',
          'stage11_ore_events_append_only_del_trg',
          'stage11_ore_evidence_append_only_del_trg',
          'stage11_ore_verifications_append_only_del_trg'
        )
    `;
    const names = new Set(rows.map((r) => r.tgname));
    expect(names.has('stage11_operations_recovery_append_only_del_trg')).toBe(
      true,
    );
    expect(names.has('stage11_operations_recovery_terminal_immutable_trg')).toBe(
      true,
    );
    expect(names.has('stage11_ore_events_append_only_del_trg')).toBe(true);
    expect(names.has('stage11_ore_evidence_append_only_del_trg')).toBe(true);
    expect(names.has('stage11_ore_verifications_append_only_del_trg')).toBe(
      true,
    );
  });

  // ─── 28: architecture delivery_failed exits ───

  it('28: FULFILLMENT_TRANSITIONS.delivery_failed includes in_transit', async () => {
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toEqual(
      expect.arrayContaining(['returning', 'in_transit']),
    );
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toContain('in_transit');
  });

  // ─── Extra policy paths required by acceptance narrative ───

  it('startInvestigation + CONTACT_* needs evidence; HOLD cannot close; CLEAR_PENDING needs clear', async () => {
    const fx = await seedFailed();
    const opened = await openRecovery(
      fx,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    const inv = await recovery.startInvestigation({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      correlationId: `inv-path-${randomUUID()}`,
    });
    expect(inv.recovery.status).toBe(OperationsRecoveryStatus.INVESTIGATING);

    await recovery.selectDisposition({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      disposition: OperationsRecoveryDisposition.CONTACT_CUSTOMER,
      reason: 'need contact',
      correlationId: `contact-${randomUUID()}`,
    });
    await expectCode(
      recovery.close({
        recoveryId: opened.recovery.id,
        actorUserId: fx.adminId,
        reason: 'missing evidence',
        correlationId: `close-contact-${randomUUID()}`,
        explicitConclusionAcknowledged: true,
      }),
      'OPERATIONS_RECOVERY_CONTACT_EVIDENCE_REQUIRED',
    );
    await recovery.addEvidence({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      evidenceKind: OperationsRecoveryEvidenceKind.CONTACT_ATTEMPT,
      notes: 'called customer',
      correlationId: `contact-ev-${randomUUID()}`,
    });
    await recovery.close({
      recoveryId: opened.recovery.id,
      actorUserId: fx.adminId,
      reason: 'contact done',
      correlationId: `close-contact-ok-${randomUUID()}`,
      explicitConclusionAcknowledged: true,
    });

    // HOLD_FOR_REVIEW on a fresh order
    const fx2 = await seedFailed();
    const o2 = await openRecovery(
      fx2,
      OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
    );
    await investigateAndSelect(
      o2.recovery.id,
      fx2.adminId,
      OperationsRecoveryDisposition.HOLD_FOR_REVIEW,
    );
    await expectCode(
      recovery.close({
        recoveryId: o2.recovery.id,
        actorUserId: fx2.adminId,
        reason: 'cannot hold-close',
        correlationId: `hold-${randomUUID()}`,
        explicitConclusionAcknowledged: true,
      }),
      'OPERATIONS_RECOVERY_HOLD_CANNOT_CLOSE',
    );

    // CLEAR_PENDING close without clear action
    const fx3 = await seedFailed({ pendingCustody: true });
    const o3 = await openRecovery(
      fx3,
      OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
    );
    await investigateAndSelect(
      o3.recovery.id,
      fx3.adminId,
      OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER,
    );
    await expectCode(
      recovery.close({
        recoveryId: o3.recovery.id,
        actorUserId: fx3.adminId,
        reason: 'forgot clear',
        correlationId: `pending-close-${randomUUID()}`,
        explicitConclusionAcknowledged: true,
      }),
      'OPERATIONS_RECOVERY_PENDING_NOT_CLEARED',
    );
  });

  it('ops flags: OPERATIONS_RECOVERY_OPEN; DELIVERY_DISPOSITION_REQUIRED suppressed while Stage11 active', async () => {
    const fx = await seedFailed();
    const opCase = await prisma.operationalCase.findFirstOrThrow({
      where: { wkOrderId: fx.orderId },
    });
    expect(opCase.status).toBe(OperationalCaseStatus.OPEN);

    const before = await operational.getForOrder(fx.orderId, fx.adminId);
    expect(before.flags).toContain('DELIVERY_DISPOSITION_REQUIRED');

    await openRecovery(fx, OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED);
    const after = await operational.getForOrder(fx.orderId, fx.adminId);
    expect(after.flags).toContain('OPERATIONS_RECOVERY_OPEN');
    expect(after.flags).not.toContain('DELIVERY_DISPOSITION_REQUIRED');
  });
});
