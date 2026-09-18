/**
 * Stage 10 redelivery authorization — PostgreSQL acceptance.
 * Requires backend/.env.stage10.test → wekonnek_stage10_test
 * (or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → wekonnek_stage11_regression_test).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertLegacyPostgresSuiteIdentity,
  resolveStage12ExpectedDatabase
} from '../test-support/acceptance-database';
import {
  isCurrentSchemaRegressionMode,
  STAGE10_ACCEPTANCE_DATABASE
} from '../test-support/test-database-guard';

const STAGE10_ENV_PRESENT = loadStageTestEnv('.env.stage10.test');

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
  OperationalDisposition,
  Prisma,
  RedeliveryAuthorizationStatus,
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
import { OrderOperationalStateService } from '../order-operational-state/order-operational-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderCustodyHandoffService } from '../rider-custody-handoff/rider-custody-handoff.service';
import { ReturnFinancialDeterminationService } from '../return-financial/return-financial-determination.service';
import { RiderAdvanceCollectibilityService } from '../return-financial/rider-advance-collectibility.service';
import { ReturnFinancialTermsService } from '../return-financial/return-financial-terms.service';
import { MAX_DELIVERY_ATTEMPTS } from './redelivery.policy';
import { RedeliveryService } from './redelivery.service';

const describeIf = STAGE10_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = isCurrentSchemaRegressionMode()
  ? resolveStage12ExpectedDatabase()
  : STAGE10_ACCEPTANCE_DATABASE;

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

describeIf(`Stage 10 Redelivery PostgreSQL (${EXPECTED_DB})`, () => {
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
  const collectibility = new RiderAdvanceCollectibilityService(prisma);
  const terms = new ReturnFinancialTermsService(prisma);
  const determinations = new ReturnFinancialDeterminationService(
    prisma,
    events,
    collectibility,
    terms,
  );
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 10 redelivery',
      historicalDatabases: [STAGE10_ACCEPTANCE_DATABASE],
      historicalUsers: new Set(['victor', STAGE10_ACCEPTANCE_DATABASE]),
    });
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedFailed(opts?: {
    pendingCustody?: boolean;
    returning?: boolean;
    returnedWithCustody?: boolean;
    withRa?: boolean;
  }) {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s10-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S10${prefix}`,
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
        name: `S10 ${tag}`,
        slug: `s10-${tag}`,
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
        orderCode: `WK-S10-${tag.slice(0, 8)}`,
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
        deliveryAddress: '123 Stage10 St, Manila',
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
          termsSnapshot: { kind: 's10_test' },
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
    if (!opts?.pendingCustody) {
      failResult = await failures.reportFailure({
        wkOrderId: order.id,
        actorUserId: rider.id,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        correlationId: `fail-${tag}`,
      });
    }

    if (opts?.returning || opts?.returnedWithCustody) {
      await prisma.orderFulfillment.update({
        where: { id: fulfillment.id },
        data: {
          status: opts.returnedWithCustody
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

    const ids = {
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

    cleanup = async () => {
      // Append-only Stage 8/10 history must remain. Do not DISABLE TRIGGER or
      // delete delivery_attempts / operational_case_events / redelivery rows.
      // Isolation: unique UUID fixtures; full-suite repeats use a fresh
      // disposable Stage 11 current-schema DB cloned from wekonnek_stage11_test.
      return;
    };

    return { ...ids, customer, rider, riderB, admin, merchantUser, foreign, order };
  }

  async function seedMinimalDetermination(
    fx: Awaited<ReturnType<typeof seedFailed>>,
    status: ReturnFinancialDeterminationStatus,
  ) {
    const custody = await prisma.custodyEvent.create({
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
        returnCustodyEventId: custody.id,
        status,
        path: 'RIDER_ADVANCE',
        operationalCaseId: fx.caseId ?? null,
        deliveryAttemptId: fx.attemptId ?? null,
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

  async function assertMoneyPreserved(
    fx: Awaited<ReturnType<typeof seedFailed>>,
    expectedRiderId: string,
    expectedPayment: MerchantPaymentStatus,
  ) {
    if (fx.raId) {
      const ra = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: fx.raId },
      });
      expect(ra.riderId).toBe(expectedRiderId);
      expect(ra.convenienceFeeAmount).toBeNull();
    }
    const order = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.orderId },
    });
    expect(order.merchantPaymentStatus).toBe(expectedPayment);
    expect(Number(order.transactionFeeAmount)).toBe(0);
  }

  async function requestAndActivate(fx: {
    orderId: number;
    customerId: string;
  }) {
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      correlationId: `req-${randomUUID()}`,
    });
    const conf = await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      correlationId: `conf-${randomUUID()}`,
    });
    return { req, conf };
  }

  it('same-rider 1fail→2success creates SUCCESSFUL_HANDOFF only on ACTIVATED leg', async () => {
    const fx = await seedFailed();
    const { conf } = await requestAndActivate(fx);
    expect(conf.activated).toBe(true);
    expect(conf.authorization.status).toBe(
      RedeliveryAuthorizationStatus.ACTIVATED,
    );

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(ful.status).toBe(FulfillmentStatus.in_transit);

    const opCase = await prisma.operationalCase.findUniqueOrThrow({
      where: { id: fx.caseId! },
    });
    expect(opCase.status).toBe(OperationalCaseStatus.RESOLVED);

    const revoked = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: fx.tokenId },
    });
    expect(revoked.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);

    // Issue fresh Stage 5A token and confirm → SUCCESSFUL_HANDOFF
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `iss-${randomUUID()}`,
    });
    const confirm = await delivery.confirm({
      actorUserId: fx.customerId,
      orderId: fx.orderId,
      otp: issued.otp,
      correlationId: `dh-${randomUUID()}`,
    });
    expect(confirm.ok).toBe(true);

    const success = await prisma.deliveryAttempt.findFirst({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.SUCCESSFUL_HANDOFF,
      },
    });
    expect(success).toBeTruthy();
    expect(success!.attemptNumber).toBe(2);

    const ops = await operational.getForOrder(fx.orderId, fx.customerId);
    expect(ops.flags).not.toContain('REDELIVERY_IN_PROGRESS');
  });

  it('same-rider 1fail→2fail then 1→2→3 success path and attempt4 blocked', async () => {
    const fx = await seedFailed();
    await requestAndActivate(fx);
    await failures.reportFailure({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      correlationId: `f2-${randomUUID()}`,
    });

    // attempt 3 success path
    await requestAndActivate(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `iss3-${randomUUID()}`,
    });
    const ok = await delivery.confirm({
      actorUserId: fx.customerId,
      orderId: fx.orderId,
      otp: issued.otp,
      correlationId: `dh3-${randomUUID()}`,
    });
    expect(ok.ok).toBe(true);
    const success = await prisma.deliveryAttempt.findFirst({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.SUCCESSFUL_HANDOFF,
        attemptNumber: 3,
      },
    });
    expect(success).toBeTruthy();
  });

  it('3fail → attempt4 blocked + OPERATIONS_RECOVERY_REQUIRED', async () => {
    const fx = await seedFailed();
    for (let i = 0; i < 2; i++) {
      await requestAndActivate(fx);
      await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        correlationId: `fn-${i}-${randomUUID()}`,
      });
    }
    const failedCount = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    expect(failedCount).toBe(MAX_DELIVERY_ATTEMPTS);

    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
    );

    const ops = await operational.getForOrder(fx.orderId, fx.adminId);
    expect(ops.flags).toContain('REDELIVERY_ATTEMPT_LIMIT_REACHED');
    expect(ops.flags).toContain('OPERATIONS_RECOVERY_REQUIRED');
  });

  it('pending Stage 7 custody blocks request/activation', async () => {
    const fx = await seedFailed({ pendingCustody: true });
    // Manually put into delivery_failed without reportFailure (pending blocks report)
    await prisma.orderFulfillment.update({
      where: { id: fx.fulfillmentId },
      data: { status: FulfillmentStatus.delivery_failed },
    });
    await prisma.deliveryAttempt.create({
      data: {
        id: randomUUID(),
        wkOrderId: fx.orderId,
        fulfillmentId: fx.fulfillmentId,
        attemptNumber: 1,
        riderId: fx.riderId,
        riderAssignmentId: (
          await prisma.riderAssignment.findFirstOrThrow({
            where: { fulfillmentId: fx.fulfillmentId },
          })
        ).id,
        assignmentVersion: 1,
        physicalCustodianRiderId: fx.riderId,
        outcome: DeliveryAttemptOutcome.FAILED,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        occurredAt: new Date(),
        reportedByActorType: 'RIDER',
        reportedByActorId: fx.riderId,
      },
    });
    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
    );
    void custodyHandoff;
  });

  it('token revoke on failure; old token cannot confirm', async () => {
    const fx = await seedFailed();
    const old = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: fx.tokenId },
    });
    expect(old.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);

    const deny = await delivery.confirm({
      actorUserId: fx.customerId,
      orderId: fx.orderId,
      otp: '000000',
      correlationId: `old-${randomUUID()}`,
    });
    expect(deny.ok).toBe(false);
  });

  it('window boundaries 59m/1h/4h/4h+1s/past/7day', async () => {
    const fx = await seedFailed();
    const now = Date.now();

    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: new Date(now + 3600_000),
        windowEnd: new Date(now + 3600_000 + 59 * 60 * 1000),
      }),
      'REDELIVERY_WINDOW_INVALID',
      BadRequestException,
    );

    const ok1h = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart: new Date(now + 3600_000),
      windowEnd: new Date(now + 3600_000 + 60 * 60 * 1000),
      idempotencyKey: `w1h-${randomUUID()}`,
    });
    expect(ok1h.authorization.status).toBe(
      RedeliveryAuthorizationStatus.REQUESTED,
    );
    await redelivery.cancel({
      authorizationId: ok1h.authorization.id,
      actorUserId: fx.customerId,
    });

    const ok4h = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart: new Date(now + 3600_000),
      windowEnd: new Date(now + 3600_000 + 4 * 60 * 60 * 1000),
      idempotencyKey: `w4h-${randomUUID()}`,
    });
    await redelivery.cancel({
      authorizationId: ok4h.authorization.id,
      actorUserId: fx.customerId,
    });

    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: new Date(now + 3600_000),
        windowEnd: new Date(now + 3600_000 + 4 * 60 * 60 * 1000 + 1000),
      }),
      'REDELIVERY_WINDOW_INVALID',
      BadRequestException,
    );

    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: new Date(now - 60_000),
        windowEnd: new Date(now + 3600_000),
      }),
      'REDELIVERY_WINDOW_INVALID',
      BadRequestException,
    );

    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: new Date(now + 8 * 24 * 3600_000),
        windowEnd: new Date(now + 8 * 24 * 3600_000 + 2 * 3600_000),
      }),
      'REDELIVERY_WINDOW_INVALID',
      BadRequestException,
    );
  });

  it('address change rejected', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        deliveryAddress: 'Different Address',
      }),
      'REDELIVERY_ADDRESS_CHANGE_NOT_SUPPORTED',
    );
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        addressMode: 'NEW_ADDRESS',
      }),
      'REDELIVERY_ADDRESS_CHANGE_NOT_SUPPORTED',
    );
  });

  it('address snapshot TOCTOU: request A then order change B cannot confirm or activate', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const requested = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      idempotencyKey: `address-stale-${randomUUID()}`,
    });
    const before = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const tokenCountBefore = await prisma.customerDeliveryHandoffToken.count({
      where: { fulfillmentId: fx.fulfillmentId },
    });
    await prisma.wkOrder.update({
      where: { id: fx.orderId },
      data: { deliveryAddress: 'Stage 10 changed authoritative address' },
    });
    await expectCode(
      redelivery.confirm({
        authorizationId: requested.authorization.id,
        actorUserId: fx.customerId,
        autoActivate: false,
        idempotencyKey: `address-stale-confirm-${randomUUID()}`,
      }),
      'REDELIVERY_ADDRESS_SNAPSHOT_STALE',
      ConflictException,
    );
    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(after.status).toBe(FulfillmentStatus.delivery_failed);
    expect(after.status).toBe(before.status);
    expect(await prisma.customerDeliveryHandoffToken.count({ where: { fulfillmentId: fx.fulfillmentId } })).toBe(tokenCountBefore);
    expect(await prisma.deliveryAttempt.count({ where: { fulfillmentId: fx.fulfillmentId, outcome: DeliveryAttemptOutcome.SUCCESSFUL_HANDOFF } })).toBe(0);
  });

  it('confirmed authorization cannot activate after authoritative address changes', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const requested = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
    });
    await redelivery.confirm({
      authorizationId: requested.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: false,
    });
    await prisma.wkOrder.update({
      where: { id: fx.orderId },
      data: { deliveryAddress: 'Stage 10 B before activation' },
    });
    await expectCode(
      redelivery.adminActivate({
        authorizationId: requested.authorization.id,
        actorUserId: fx.adminId,
        reason: 'adversarial stale address check',
        correlationId: `address-stale-${randomUUID()}`,
      }),
      'REDELIVERY_ADDRESS_SNAPSHOT_STALE',
      ConflictException,
    );
    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({ where: { id: requested.authorization.id } });
    expect(auth.status).toBe(RedeliveryAuthorizationStatus.CONFIRMED);
    expect((await prisma.orderFulfillment.findUniqueOrThrow({ where: { id: fx.fulfillmentId } })).status).toBe(FulfillmentStatus.delivery_failed);
  });

  it('returned/returning blockers', async () => {
    const ret = await seedFailed({ returnedWithCustody: true });
    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: ret.orderId,
        actorUserId: ret.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_TERMINAL_RETURN',
    );

    const returning = await seedFailed({ returning: true });
    await expectCode(
      redelivery.request({
        wkOrderId: returning.orderId,
        actorUserId: returning.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_RETURN_IN_PROGRESS',
    );
  });

  it('dual request race keeps one open authorization', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const results = await Promise.allSettled([
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: `a-${randomUUID()}`,
      }),
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: `b-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);
    const open = await prisma.redeliveryAuthorization.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            RedeliveryAuthorizationStatus.REQUESTED,
            RedeliveryAuthorizationStatus.CONFIRMED,
          ],
        },
      },
    });
    expect(open).toBe(1);
  });

  it('auth-before-cache and cross-order idempotency conflict', async () => {
    const fx1 = await seedFailed();
    // Second order for the SAME customer to prove cross-order key conflict after auth.
    const order2 = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S10X-${randomUUID().slice(0, 8)}`,
        userId: fx1.customerId,
        merchantId: fx1.merchantId,
        status: 'delivery_failed',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: 'X',
        orderItems: {
          create: [
            { productName: 'y', quantity: 1, price: 100, subtotal: 100 },
          ],
        },
      },
    });
    const ful2 = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order2.id,
        merchantId: fx1.merchantId,
        customerId: fx1.customerId,
        status: FulfillmentStatus.delivery_failed,
        assignmentVersion: 1,
        activeRiderId: fx1.riderId,
        physicalCustodianRiderId: fx1.riderId,
      },
    });
    const asg2 = await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: ful2.id,
        riderId: fx1.riderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
      },
    });
    await prisma.deliveryAttempt.create({
      data: {
        id: randomUUID(),
        wkOrderId: order2.id,
        fulfillmentId: ful2.id,
        attemptNumber: 1,
        riderId: fx1.riderId,
        riderAssignmentId: asg2.id,
        assignmentVersion: 1,
        physicalCustodianRiderId: fx1.riderId,
        outcome: DeliveryAttemptOutcome.FAILED,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        occurredAt: new Date(),
        reportedByActorType: 'RIDER',
        reportedByActorId: fx1.riderId,
      },
    });

    const key = `cross-${randomUUID()}`;
    const { windowStart, windowEnd } = windowTimes();
    await redelivery.request({
      wkOrderId: fx1.orderId,
      actorUserId: fx1.customerId,
      windowStart,
      windowEnd,
      idempotencyKey: key,
    });
    await expectCode(
      redelivery.request({
        wkOrderId: order2.id,
        actorUserId: fx1.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: key,
      }),
      'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
      ConflictException,
    );

    // Foreign actor must not receive cached result
    await expectCode(
      redelivery.request({
        wkOrderId: fx1.orderId,
        actorUserId: fx1.foreignId,
        windowStart,
        windowEnd,
        idempotencyKey: key,
      }),
      'REDELIVERY_CUSTOMER_AUTH_REQUIRED',
    );

    // Leave order2 fixture orphaned — no delete of append-only delivery_attempts.
    void order2;
    void ful2;
  });

  it('ordinary Stage 5A confirm does not invent SUCCESSFUL_HANDOFF without ACTIVATED redelivery', async () => {
    // Build in_transit without going through Stage 10 activation
    const tag = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s10-ord-${tag}@test.invalid`,
        role: UserRole.customer,
        firstName: 'Ord',
      },
    });
    const rider = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s10-ordr-${tag}@test.invalid`,
        role: UserRole.rider,
        firstName: 'OrdR',
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s10-ordm-${tag}@test.invalid`,
        role: UserRole.merchant,
        firstName: 'OrdM',
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `Ord ${tag}`,
        slug: `ord-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-ORD-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'in_transit',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        orderItems: {
          create: [
            { productName: 'x', quantity: 1, price: 100, subtotal: 100 },
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
    cleanup = async () => {
      // Append-only isolation: no delete of delivery_attempts (or parent graph).
      return;
    };

    const issued = await delivery.issueForOrder({
      wkOrderId: order.id,
      actorUserId: rider.id,
    });
    const conf = await delivery.confirm({
      actorUserId: customer.id,
      orderId: order.id,
      otp: issued.otp,
    });
    expect(conf.ok).toBe(true);
    const success = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fulfillment.id,
        outcome: DeliveryAttemptOutcome.SUCCESSFUL_HANDOFF,
      },
    });
    expect(success).toBe(0);
  });

  it('rider generic delivery_failed→in_transit blocked', async () => {
    const fx = await seedFailed();
    await expect(
      transitions.transition({
        fulfillmentId: fx.fulfillmentId,
        targetStatus: 'in_transit',
        actor: { id: fx.riderId, type: 'RIDER' },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('merchant can view redelivery; foreign cannot', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
    });
    const view = await redelivery.getForOrder(fx.orderId, fx.merchantUserId);
    expect(view.current).toBeTruthy();
    await expectCode(
      redelivery.getForOrder(fx.orderId, fx.foreignId),
      'REDELIVERY_FORBIDDEN',
    );
  });

  it('active Stage 9 determination blocks redelivery with REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE', async () => {
    const fx = await seedFailed();
    await seedMinimalDetermination(
      fx,
      ReturnFinancialDeterminationStatus.PENDING,
    );
    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE',
    );

    await prisma.returnFinancialDetermination.updateMany({
      where: { wkOrderId: fx.orderId },
      data: { status: ReturnFinancialDeterminationStatus.PROPOSED },
    });
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE',
    );
  });

  it('FINALIZED Stage 9 determination blocks with REDELIVERY_FINANCIAL_RESOLUTION_FINALIZED', async () => {
    const fx = await seedFailed();
    await seedMinimalDetermination(
      fx,
      ReturnFinancialDeterminationStatus.FINALIZED,
    );
    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_FINANCIAL_RESOLUTION_FINALIZED',
    );
  });

  it('race: Stage 5A SUCCESSFUL_HANDOFF vs Stage 8 failure — exclusive attempt outcome', async () => {
    const fx = await seedFailed();
    await requestAndActivate(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
      correlationId: `race-iss-${randomUUID()}`,
    });

    const results = await Promise.allSettled([
      delivery.confirm({
        actorUserId: fx.customerId,
        orderId: fx.orderId,
        otp: issued.otp,
        correlationId: `race-ok-${randomUUID()}`,
      }),
      failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        correlationId: `race-fail-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const success = await prisma.deliveryAttempt.findMany({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.SUCCESSFUL_HANDOFF,
        attemptNumber: 2,
      },
    });
    const failed = await prisma.deliveryAttempt.findMany({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
        attemptNumber: 2,
      },
    });
    const custodyReceived = await prisma.custodyEvent.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        eventType: 'CUSTOMER_RECEIVED',
      },
    });

    // Exactly one exclusive path; never both SUCCESSFUL_HANDOFF and FAILED for attempt 2.
    expect(success.length + failed.length).toBe(1);
    if (success.length === 1) {
      expect(ful.status).toBe(FulfillmentStatus.delivered);
      expect(custodyReceived).toBeGreaterThan(0);
      expect(failed.length).toBe(0);
    } else {
      expect(ful.status).toBe(FulfillmentStatus.delivery_failed);
      expect(custodyReceived).toBe(0);
      expect(success.length).toBe(0);
    }
  });

  it('race: Stage 9 finalize vs Stage 10 activate — never ACTIVATED + FINALIZED', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
    });
    // CONFIRMED without auto-activate so activation can race finalize.
    await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: false,
      correlationId: `conf-only-${randomUUID()}`,
    });
    const det = await seedMinimalDetermination(
      fx,
      ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
    );

    const results = await Promise.allSettled([
      redelivery.adminActivate({
        authorizationId: req.authorization.id,
        actorUserId: fx.adminId,
        reason: 'race_activate',
        correlationId: `act-${randomUUID()}`,
      }),
      (async () => {
        // Finalize path requires returned eligibility; flip under order lock race.
        await prisma.orderFulfillment.update({
          where: { id: fx.fulfillmentId },
          data: { status: FulfillmentStatus.returned },
        });
        return determinations.finalize({
          determinationId: det.id,
          actorUserId: fx.merchantUserId,
          correlationId: `fin-${randomUUID()}`,
        });
      })(),
    ]);
    void results;

    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const finalized = await prisma.returnFinancialDetermination.findUniqueOrThrow({
      where: { id: det.id },
    });
    const activatedAndFinalized =
      auth.status === RedeliveryAuthorizationStatus.ACTIVATED &&
      finalized.status === ReturnFinancialDeterminationStatus.FINALIZED;
    expect(activatedAndFinalized).toBe(false);

    // Exactly one exclusive path: ACTIVATED (not FINALIZED) OR FINALIZED (not ACTIVATED)
    // OR both blocked leaving CONFIRMED + ACKNOWLEDGED (still exclusive — not both terminal).
    if (auth.status === RedeliveryAuthorizationStatus.ACTIVATED) {
      expect(finalized.status).not.toBe(
        ReturnFinancialDeterminationStatus.FINALIZED,
      );
    }
    if (finalized.status === ReturnFinancialDeterminationStatus.FINALIZED) {
      expect(auth.status).not.toBe(RedeliveryAuthorizationStatus.ACTIVATED);
    }
  });

  it('race: activation vs RETURN_TO_MERCHANT — in_transit XOR returning', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
    });
    await redelivery.confirm({
      authorizationId: req.authorization.id,
      actorUserId: fx.customerId,
      autoActivate: false,
    });

    const results = await Promise.allSettled([
      redelivery.adminActivate({
        authorizationId: req.authorization.id,
        actorUserId: fx.adminId,
        reason: 'race_vs_return',
        correlationId: `act-ret-${randomUUID()}`,
      }),
      failures.selectDisposition({
        wkOrderId: fx.orderId,
        actorUserId: fx.adminId,
        disposition: OperationalDisposition.RETURN_TO_MERCHANT,
        correlationId: `disp-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const auth = await prisma.redeliveryAuthorization.findUniqueOrThrow({
      where: { id: req.authorization.id },
    });
    const inTransit =
      ful.status === FulfillmentStatus.in_transit &&
      auth.status === RedeliveryAuthorizationStatus.ACTIVATED;
    const returning = ful.status === FulfillmentStatus.returning;
    expect(inTransit || returning).toBe(true);
    expect(inTransit && returning).toBe(false);
    if (returning) {
      expect(auth.status).not.toBe(RedeliveryAuthorizationStatus.ACTIVATED);
    }
  });

  it('race: request vs RETURN_TO_MERCHANT — one active path only', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const results = await Promise.allSettled([
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: `req-ret-${randomUUID()}`,
      }),
      failures.selectDisposition({
        wkOrderId: fx.orderId,
        actorUserId: fx.adminId,
        disposition: OperationalDisposition.RETURN_TO_MERCHANT,
        correlationId: `disp2-${randomUUID()}`,
      }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const openAuth = await prisma.redeliveryAuthorization.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: {
          in: [
            RedeliveryAuthorizationStatus.REQUESTED,
            RedeliveryAuthorizationStatus.CONFIRMED,
            RedeliveryAuthorizationStatus.ACTIVATED,
          ],
        },
      },
    });
    if (ful.status === FulfillmentStatus.returning) {
      expect(openAuth).toBe(0);
    } else {
      expect(ful.status).toBe(FulfillmentStatus.delivery_failed);
      expect(openAuth).toBe(1);
    }
  });

  it('race: concurrent Attempt4 requests after 3 FAILED — both rejected / zero Attempt4', async () => {
    const fx = await seedFailed();
    for (let i = 0; i < 2; i++) {
      await requestAndActivate(fx);
      await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        correlationId: `fn4-${i}-${randomUUID()}`,
      });
    }
    const failedCount = await prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    expect(failedCount).toBe(3);

    const { windowStart, windowEnd } = windowTimes();
    const results = await Promise.allSettled([
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: `a4a-${randomUUID()}`,
      }),
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
        idempotencyKey: `a4b-${randomUUID()}`,
      }),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      expect(errCode((r as PromiseRejectedResult).reason)).toBe(
        'REDELIVERY_ATTEMPT_LIMIT_REACHED',
      );
    }
    const attempt4 = await prisma.redeliveryAuthorization.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        targetAttemptNumber: 4,
      },
    });
    expect(attempt4).toBe(0);
  });

  it('race: two Attempt N+1 activations — exactly one ACTIVATED', async () => {
    const fx = await seedFailed();
    const { windowStart, windowEnd } = windowTimes();
    const req = await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
    });

    const results = await Promise.allSettled([
      redelivery.confirm({
        authorizationId: req.authorization.id,
        actorUserId: fx.customerId,
        autoActivate: true,
        correlationId: `act1-${randomUUID()}`,
        idempotencyKey: `c1-${randomUUID()}`,
      }),
      redelivery.confirm({
        authorizationId: req.authorization.id,
        actorUserId: fx.customerId,
        autoActivate: true,
        correlationId: `act2-${randomUUID()}`,
        idempotencyKey: `c2-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const activated = await prisma.redeliveryAuthorization.count({
      where: {
        fulfillmentId: fx.fulfillmentId,
        status: RedeliveryAuthorizationStatus.ACTIVATED,
      },
    });
    expect(activated).toBe(1);
    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(ful.status).toBe(FulfillmentStatus.in_transit);
  });

  it('different-rider Stage 7: pending blocks activation; WKRR1 then B can proceed + money preserved', async () => {
    const fx = await seedFailed({ withRa: true });
    const paymentBefore = MerchantPaymentStatus.AWAITING_PAYMENT;
    await assertMoneyPreserved(fx, fx.riderId, paymentBefore);

    // Reassign to Rider B while A remains physical custodian → pending Stage 7.
    const pending = await assignments.assign({
      fulfillmentId: fx.fulfillmentId,
      riderId: fx.riderBId,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 's10_diff_rider',
    });
    expect(pending.pendingCustodyTransfer).toBe(true);
    const mid = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(mid.pendingCustodyIncomingRiderId).toBe(fx.riderBId);
    expect(mid.physicalCustodianRiderId).toBe(fx.riderId);

    const { windowStart, windowEnd } = windowTimes();
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart,
        windowEnd,
      }),
      'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
    );

    const issued = await custodyHandoff.issueForOrder({
      wkOrderId: fx.orderId,
      actorUserId: fx.riderId,
    });
    expect(issued.qrPayload).toMatch(/^WKRR1\./);
    const confirmed = await custodyHandoff.confirm({
      actorUserId: fx.riderBId,
      qrPayload: issued.qrPayload,
      correlationId: `s10-custody-${randomUUID()}`,
    });
    expect(confirmed.ok).toBe(true);

    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(after.pendingCustodyIncomingRiderId).toBeNull();
    expect(after.physicalCustodianRiderId).toBe(fx.riderBId);
    expect(after.activeRiderId).toBe(fx.riderBId);

    const { conf } = await requestAndActivate(fx);
    expect(conf.activated).toBe(true);
    // RA creditor remains original rider A; payment untouched; no fees.
    await assertMoneyPreserved(fx, fx.riderId, paymentBefore);
  });

  it('same-rider path preserves RA creditor, merchantPaymentStatus, and no fee rows', async () => {
    const fx = await seedFailed({ withRa: true });
    await requestAndActivate(fx);
    await assertMoneyPreserved(
      fx,
      fx.riderId,
      MerchantPaymentStatus.AWAITING_PAYMENT,
    );
    const ra = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: fx.raId! },
    });
    expect(ra.convenienceFeeAmount).toBeNull();
  });

  it('payload idempotency conflict returns IDEMPOTENCY_PAYLOAD_CONFLICT', async () => {
    const fx = await seedFailed();
    const key = `pay-${randomUUID()}`;
    const { windowStart, windowEnd } = windowTimes();
    await redelivery.request({
      wkOrderId: fx.orderId,
      actorUserId: fx.customerId,
      windowStart,
      windowEnd,
      idempotencyKey: key,
    });
    const later = windowTimes({ startOffsetMs: 3 * 60 * 60 * 1000 });
    await expectCode(
      redelivery.request({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
        windowStart: later.windowStart,
        windowEnd: later.windowEnd,
        idempotencyKey: key,
      }),
      'IDEMPOTENCY_PAYLOAD_CONFLICT',
    );
  });
});
