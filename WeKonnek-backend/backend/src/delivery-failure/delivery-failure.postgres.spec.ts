/**
 * Stage 8 delivery failure / operational case — PostgreSQL acceptance.
 * Requires backend/.env.stage8.test and database wekonnek_stage8_test
 * (defaults). With WEKONNEK_CURRENT_SCHEMA_REGRESSION=1, loadStageTestEnv
 * points at wekonnek_stage8_regression_test instead.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_FORBIDDEN_DATABASES,
  isCurrentSchemaRegressionMode,
} from '../test-support/test-database-guard';

const STAGE8_ENV_PRESENT = loadStageTestEnv('.env.stage8.test');

import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgreementStatus,
  AgreementType,
  CommerceDomain,
  CustodyEventType,
  DeliveryAttemptCustomerResponse,
  DeliveryAttemptEvidenceKind,
  DeliveryAttemptLocationProvenance,
  DeliveryAttemptOutcome,
  DeliveryFailureReasonCode,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationalCaseStatus,
  OperationalDisposition,
  Prisma,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { DeliveryHandoffService } from '../delivery-handoff/delivery-handoff.service';
import { AuthActorService } from '../fulfillment/auth-actor.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { OrderOperationalStateService } from '../order-operational-state/order-operational-state.service';
import { PickupHandoffService } from '../pickup-handoff/pickup-handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderCustodyHandoffService } from '../rider-custody-handoff/rider-custody-handoff.service';
import { DeliveryFailureService } from './delivery-failure.service';

const describeIf = STAGE8_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage8_test',
  'wekonnek_stage8_regression_test',
  'wekonnek_stage9_regression_test',
  'wekonnek_stage10_regression_test',
]);
const EXPECTED_DB = isCurrentSchemaRegressionMode()
  ? STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE
  : STAGE8_ACCEPTANCE_DATABASE;

function errCode(e: unknown): string | undefined {
  if (e instanceof ForbiddenException) {
    const r = e.getResponse() as { code?: string };
    return typeof r === 'object' ? r.code : undefined;
  }
  return undefined;
}

async function expectForbiddenCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ForbiddenException ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected ForbiddenException')) {
      throw e;
    }
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(errCode(e)).toBe(code);
  }
}

describeIf(
  `Stage 8 Delivery Failure PostgreSQL (${EXPECTED_DB})`,
  () => {
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
    const operational = new OrderOperationalStateService(prisma);
    const custody = new CustodyEventService(prisma, events);
    const config = {
      get: (key: string) => {
        if (key === 'RETURN_HANDOFF_TTL_SECONDS') return '300';
        if (key === 'PICKUP_HANDOFF_TTL_SECONDS') return '300';
        if (key === 'DELIVERY_HANDOFF_TTL_SECONDS') return '300';
        if (key === 'RIDER_CUSTODY_HANDOFF_TTL_SECONDS') return '300';
        return undefined;
      },
    } as ConfigService;
    const pickup = new PickupHandoffService(
      prisma,
      events,
      custody,
      transitions,
      config,
      riderAdvance,
    );
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
    let cleanup: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      await prisma.$connect();
      const target = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
      const database = target[0]?.database;
      const user = target[0]?.user;
      if (
        !database ||
        STAGE8_FORBIDDEN_DATABASES.has(database) ||
        database !== EXPECTED_DB ||
        !user ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 8 tests require ${EXPECTED_DB} identity; got database=${database} user=${user}`,
        );
      }
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
      cleanup = undefined;
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seedInTransit(opts?: { allowRA?: boolean }) {
      const tag = randomUUID();
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s8-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `S8${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const rider = await mkUser(UserRole.rider, 'r');
      const riderB = await mkUser(UserRole.rider, 'b');
      const admin = await mkUser(UserRole.admin, 'a');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S8 ${tag}`,
          slug: `s8-${tag}`,
          commerceDomain: CommerceDomain.NON_FOOD,
          allowRiderAdvance: opts?.allowRA ?? true,
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
          orderCode: `WK-S8-${tag.slice(0, 8)}`,
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
        },
      });
      const assignment = await prisma.riderAssignment.create({
        data: {
          id: randomUUID(),
          fulfillmentId: fulfillment.id,
          riderId: rider.id,
          status: RiderAssignmentStatus.ACTIVE,
          assignmentVersion: 1,
          assignedByType: 'SYSTEM',
        },
      });

      const ids = {
        orderId: order.id,
        fulfillmentId: fulfillment.id,
        customerId: customer.id,
        riderId: rider.id,
        riderBId: riderB.id,
        adminId: admin.id,
        merchantUserId: merchantUser.id,
        merchantId: merchant.id,
        assignmentId: assignment.id,
      };

      cleanup = async () => {
        // Append-only triggers block DELETE; disable Stage 8/5B guards for disposable fixture cleanup.
        await prisma.$executeRawUnsafe(`
          ALTER TABLE operational_case_events DISABLE TRIGGER USER;
          ALTER TABLE delivery_attempt_evidences DISABLE TRIGGER USER;
          ALTER TABLE delivery_attempts DISABLE TRIGGER USER;
          ALTER TABLE rider_advance_settlements DISABLE TRIGGER USER;
        `);
        try {
          await prisma.operationalCaseEvent.deleteMany({
            where: { operationalCase: { wkOrderId: order.id } },
          });
          await prisma.operationalCase.deleteMany({ where: { wkOrderId: order.id } });
          await prisma.deliveryAttemptEvidence.deleteMany({
            where: { deliveryAttempt: { wkOrderId: order.id } },
          });
          await prisma.deliveryAttempt.deleteMany({ where: { wkOrderId: order.id } });
          await prisma.customerDeliveryHandoffToken.deleteMany({
            where: { wkOrderId: order.id },
          });
          await prisma.riderCustodyHandoffToken.deleteMany({
            where: { wkOrderId: order.id },
          });
          await prisma.pickupHandoffToken.deleteMany({
            where: { wkOrderId: order.id },
          });
          await prisma.merchantReturnHandoffToken.deleteMany({
            where: { wkOrderId: order.id },
          });
          await prisma.custodyEventEvidence.deleteMany({
            where: { custodyEvent: { wkOrderId: order.id } },
          });
          await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
          await prisma.riderAdvanceSettlement.deleteMany({
            where: { wkOrderId: order.id },
          });
          await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order.id } });
          const agreements = await prisma.agreement.findMany({
            where: { wkOrderId: order.id },
            select: { id: true },
          });
          for (const ag of agreements) {
            await prisma.agreement.update({
              where: { id: ag.id },
              data: { currentVersionId: null },
            });
            await prisma.agreementAcceptance.deleteMany({
              where: { agreementVersion: { agreementId: ag.id } },
            });
            await prisma.agreementEvidence.deleteMany({
              where: { agreementId: ag.id },
            });
            await prisma.agreementParty.deleteMany({
              where: { agreementId: ag.id },
            });
            await prisma.agreementVersion.deleteMany({
              where: { agreementId: ag.id },
            });
          }
          await prisma.agreement.deleteMany({ where: { wkOrderId: order.id } });
          await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: order.id } });
          await prisma.riderAssignment.deleteMany({
            where: { fulfillmentId: fulfillment.id },
          });
          await prisma.orderFulfillment.delete({ where: { id: fulfillment.id } });
          await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
          await prisma.wkOrder.delete({ where: { id: order.id } });
          await prisma.merchantPaymentMethod.deleteMany({
            where: { merchantId: merchant.id },
          });
          await prisma.merchant.delete({ where: { id: merchant.id } });
          await prisma.user.deleteMany({
            where: {
              id: {
                in: [
                  customer.id,
                  rider.id,
                  riderB.id,
                  admin.id,
                  merchantUser.id,
                ],
              },
            },
          });
        } finally {
          await prisma.$executeRawUnsafe(`
            ALTER TABLE delivery_attempts ENABLE TRIGGER USER;
            ALTER TABLE delivery_attempt_evidences ENABLE TRIGGER USER;
            ALTER TABLE operational_case_events ENABLE TRIGGER USER;
            ALTER TABLE rider_advance_settlements ENABLE TRIGGER USER;
          `);
        }
      };

      return { ...ids, customer, rider, riderB, admin, merchantUser, order, fulfillment, assignment };
    }

    it('records failure atomically: attempt + case + delivery_failed', async () => {
      const fx = await seedInTransit();
      const mpBefore = (
        await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
      ).merchantPaymentStatus;

      const result = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
        customerResponse: DeliveryAttemptCustomerResponse.UNREACHABLE,
        correlationId: `corr-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        evidences: [
          {
            evidenceKind: DeliveryAttemptEvidenceKind.PHOTO,
            storageReference: 's3://bucket/proof.jpg',
          },
        ],
        locationLatitude: 14.5995,
        locationLongitude: 120.9842,
      });

      expect(result.code).toBe('DELIVERY_FAILURE_RECORDED');
      expect(result.attempt.attemptNumber).toBe(1);
      expect(result.attempt.outcome).toBe(DeliveryAttemptOutcome.FAILED);
      expect(result.case?.status).toBe(OperationalCaseStatus.OPEN);

      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(ful.status).toBe(FulfillmentStatus.delivery_failed);

      const mpAfter = (
        await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
      ).merchantPaymentStatus;
      expect(mpAfter).toBe(mpBefore);

      const ra = await prisma.riderAdvance.findFirst({
        where: { wkOrderId: fx.orderId },
      });
      expect(ra).toBeNull();

      const ops = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(ops.flags).toEqual(
        expect.arrayContaining([
          'DELIVERY_FAILURE_CASE_OPEN',
          'DELIVERY_DISPOSITION_REQUIRED',
        ]),
      );
    });

    it('rejects spoof, non-custodian, pending custody, wrong state', async () => {
      const fx = await seedInTransit();

      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          riderId: fx.riderBId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        }),
        'RIDER_SPOOF_REJECTED',
      );

      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderBId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        }),
        'NOT_ACTIVE_RIDER',
      );

      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillmentId },
        data: { pendingCustodyIncomingRiderId: fx.riderBId },
      });
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        }),
        'CUSTODY_TRANSFER_PENDING',
      );

      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillmentId },
        data: {
          pendingCustodyIncomingRiderId: null,
          physicalCustodianRiderId: fx.riderBId,
        },
      });
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        }),
        'NOT_PHYSICAL_CUSTODIAN',
      );
    });

    it('rejects rider generic transition with USE_DELIVERY_FAILURE_REPORT', async () => {
      const fx = await seedInTransit();
      await expectForbiddenCode(
        transitions.transition({
          fulfillmentId: fx.fulfillmentId,
          targetStatus: 'delivery_failed',
          actor: { id: fx.riderId, type: 'RIDER' },
        }),
        'USE_DELIVERY_FAILURE_REPORT',
      );
    });

    it('idempotency: same key returns prior; conflict on payload; foreign no cache', async () => {
      const fx = await seedInTransit();
      const key = `idem-${randomUUID()}`;
      const first = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
        customerResponse: DeliveryAttemptCustomerResponse.REFUSED,
        idempotencyKey: key,
        notes: 'refused at door',
      });
      const second = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
        customerResponse: DeliveryAttemptCustomerResponse.REFUSED,
        idempotencyKey: key,
        notes: 'refused at door',
      });
      expect(second.idempotent).toBe(true);
      expect(second.attempt.id).toBe(first.attempt.id);

      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
          idempotencyKey: key,
        }),
        'IDEMPOTENCY_PAYLOAD_CONFLICT',
      );

      // Foreign actor must not get cached result (and is not active rider)
      await expect(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderBId,
          failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
          customerResponse: DeliveryAttemptCustomerResponse.REFUSED,
          idempotencyKey: key,
          notes: 'refused at door',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not disclose a cached failure across orders with the same rider key', async () => {
      const firstOrder = await seedInTransit();
      const otherOrder = await seedInTransit();
      const key = `cross-order-${randomUUID()}`;
      await failures.reportFailure({
        wkOrderId: firstOrder.orderId,
        actorUserId: firstOrder.riderId,
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: key,
      });

      // The rider is not assigned to otherOrder; a cached firstOrder result
      // must never bypass that authority check or disclose its identifiers.
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: otherOrder.orderId,
          actorUserId: firstOrder.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
          idempotencyKey: key,
        }),
        'IDEMPOTENCY_PAYLOAD_CONFLICT',
      );
    });

    it('OTHER requires notes; all reason codes accepted with notes for OTHER', async () => {
      const fx = await seedInTransit();
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.OTHER,
        }),
        'DELIVERY_FAILURE_NOTES_REQUIRED',
      );

      // First succeed with OTHER + notes
      const ok = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.OTHER,
        notes: 'misc',
        idempotencyKey: `other-${randomUUID()}`,
      });
      expect(ok.attempt.failureReasonCode).toBe(DeliveryFailureReasonCode.OTHER);
    });

    it('enumerates remaining reason codes on fresh fulfillments', async () => {
      const codes = Object.values(DeliveryFailureReasonCode).filter(
        (c) => c !== DeliveryFailureReasonCode.OTHER,
      );
      for (const code of codes) {
        const fx = await seedInTransit();
        const result = await failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: code,
          idempotencyKey: `rc-${code}-${randomUUID()}`,
        });
        expect(result.attempt.failureReasonCode).toBe(code);
        if (cleanup) await cleanup();
        cleanup = undefined;
      }
    });

    it('RETURN_TO_MERCHANT → returning without RETURN_RECEIVED; reschedule no auto redelivery', async () => {
      const fx = await seedInTransit();
      const reported = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
        idempotencyKey: `ret-${randomUUID()}`,
      });

      const disp = await failures.selectDisposition({
        caseId: reported.case!.id,
        actorUserId: fx.adminId,
        disposition: OperationalDisposition.RETURN_TO_MERCHANT,
        reason: 'return goods',
        correlationId: `corr-${randomUUID()}`,
      });
      expect(disp.case.status).toBe(OperationalCaseStatus.DISPOSITION_SELECTED);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(ful.status).toBe(FulfillmentStatus.returning);
      const custody = await prisma.custodyEvent.count({
        where: { fulfillmentId: fx.fulfillmentId, eventType: 'RETURN_RECEIVED' },
      });
      expect(custody).toBe(0);

      const ops = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(ops.flags).toEqual(
        expect.arrayContaining([
          'RETURN_IN_PROGRESS',
          'RETURN_MERCHANT_CONFIRMATION_PENDING',
        ]),
      );

      // Fresh for reschedule
      if (cleanup) await cleanup();
      cleanup = undefined;
      const fx2 = await seedInTransit();
      const r2 = await failures.reportFailure({
        wkOrderId: fx2.orderId,
        actorUserId: fx2.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REQUESTED_RESCHEDULE,
        idempotencyKey: `rs-${randomUUID()}`,
      });
      await failures.selectDisposition({
        caseId: r2.case!.id,
        actorUserId: fx2.adminId,
        disposition: OperationalDisposition.RESCHEDULE_REQUESTED,
        reason: 'customer asked later',
        correlationId: `corr-${randomUUID()}`,
      });
      const ful2 = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx2.fulfillmentId },
      });
      expect(ful2.status).toBe(FulfillmentStatus.delivery_failed);
      const tokens = await prisma.customerDeliveryHandoffToken.count({
        where: { fulfillmentId: fx2.fulfillmentId },
      });
      expect(tokens).toBe(0);
      const ops2 = await operational.getForOrder(fx2.orderId, fx2.adminId);
      expect(ops2.flags).toContain('RESCHEDULE_PENDING');
    });

    it('resolve does not fabricate custody/payment/RA; append-only enforced', async () => {
      const fx = await seedInTransit();
      const reported = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.SAFETY_ISSUE,
        idempotencyKey: `res-${randomUUID()}`,
      });
      const mpBefore = (
        await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
      ).merchantPaymentStatus;

      await failures.resolveCase({
        caseId: reported.case!.id,
        actorUserId: fx.adminId,
        reason: 'ops closed',
        correlationId: `corr-${randomUUID()}`,
      });

      const mpAfter = (
        await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
      ).merchantPaymentStatus;
      expect(mpAfter).toBe(mpBefore);
      expect(
        await prisma.custodyEvent.count({
          where: { fulfillmentId: fx.fulfillmentId },
        }),
      ).toBe(0);
      expect(
        await prisma.riderAdvance.count({ where: { wkOrderId: fx.orderId } }),
      ).toBe(0);

      await expect(
        prisma.deliveryAttempt.update({
          where: { id: reported.attempt.id },
          data: { notes: 'tamper' },
        }),
      ).rejects.toBeTruthy();

      await expect(
        prisma.deliveryAttempt.delete({ where: { id: reported.attempt.id } }),
      ).rejects.toBeTruthy();
    });

    it('partial unique: one open DELIVERY_FAILURE case per fulfillment', async () => {
      const fx = await seedInTransit();
      await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.GOODS_DAMAGED,
        idempotencyKey: `uq-${randomUUID()}`,
      });
      await expect(
        prisma.operationalCase.create({
          data: {
            id: randomUUID(),
            wkOrderId: fx.orderId,
            fulfillmentId: fx.fulfillmentId,
            caseType: 'DELIVERY_FAILURE',
            status: OperationalCaseStatus.OPEN,
            openedByActorType: 'SYSTEM_ADMIN',
            openedByActorId: fx.adminId,
          },
        }),
      ).rejects.toBeTruthy();
    });

    it('attempt numbering concurrency under lock', async () => {
      const fx = await seedInTransit();
      // Simulate two serialized numbering reads under lock by sequential creates
      // after first failure, second report should hit ATTEMPT_ALREADY_RECORDED
      await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.VEHICLE_OR_TRANSPORT_FAILURE,
        idempotencyKey: `n1-${randomUUID()}`,
      });
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.VEHICLE_OR_TRANSPORT_FAILURE,
          idempotencyKey: `n2-${randomUUID()}`,
        }),
        'ATTEMPT_ALREADY_RECORDED',
      );

      const attempts = await prisma.deliveryAttempt.findMany({
        where: { fulfillmentId: fx.fulfillmentId },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0].attemptNumber).toBe(1);
    });

    it('flags DELIVERY_FAILED_WITHOUT_ATTEMPT for hollow admin transition', async () => {
      const fx = await seedInTransit();
      await transitions.transition({
        fulfillmentId: fx.fulfillmentId,
        targetStatus: 'delivery_failed',
        actor: { id: fx.adminId, type: 'SYSTEM_ADMIN' },
        reason: 'admin recovery hollow',
        correlationId: `corr-${randomUUID()}`,
      });
      const ops = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(ops.flags).toContain('DELIVERY_FAILED_WITHOUT_ATTEMPT');
    });

    it('assignment statuses remain ACTIVE after failure; no RA fabricated', async () => {
      const fx = await seedInTransit({ allowRA: true });
      await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.MERCHANT_REQUESTED_RETURN,
        idempotencyKey: `ra-${randomUUID()}`,
      });
      const asg = await prisma.riderAssignment.findUniqueOrThrow({
        where: { id: fx.assignmentId },
      });
      expect(asg.status).toBe(RiderAssignmentStatus.ACTIVE);
      expect(
        await prisma.riderAdvance.count({ where: { wkOrderId: fx.orderId } }),
      ).toBe(0);
    });

    it('DB CHECK: OTHER without notes rejected at SQL layer', async () => {
      const fx = await seedInTransit();
      await expect(
        prisma.$executeRaw`
          INSERT INTO delivery_attempts (
            id, wk_order_id, fulfillment_id, attempt_number, rider_id,
            rider_assignment_id, assignment_version, physical_custodian_rider_id,
            outcome, failure_reason_code, customer_response, occurred_at,
            reported_by_actor_type, reported_by_actor_id
          ) VALUES (
            ${randomUUID()}::uuid, ${fx.orderId}, ${fx.fulfillmentId}::uuid, 99,
            ${fx.riderId}::uuid, ${fx.assignmentId}::uuid, 1, ${fx.riderId}::uuid,
            'FAILED', 'OTHER', 'NONE', NOW(), 'RIDER', ${fx.riderId}::uuid
          )
        `,
      ).rejects.toBeTruthy();
    });

    it('atomicity injection: mid-txn abort rolls back attempt/case/status', async () => {
      const fx = await seedInTransit();
      await expect(
        prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM "order_fulfillments" WHERE id = ${fx.fulfillmentId}::uuid FOR UPDATE
            `;
            const attemptId = randomUUID();
            const caseId = randomUUID();
            await tx.deliveryAttempt.create({
              data: {
                id: attemptId,
                wkOrderId: fx.orderId,
                fulfillmentId: fx.fulfillmentId,
                attemptNumber: 1,
                riderId: fx.riderId,
                riderAssignmentId: fx.assignmentId,
                assignmentVersion: 1,
                physicalCustodianRiderId: fx.riderId,
                outcome: DeliveryAttemptOutcome.FAILED,
                failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
                occurredAt: new Date(),
                reportedByActorType: 'RIDER',
                reportedByActorId: fx.riderId,
              },
            });
            await tx.operationalCase.create({
              data: {
                id: caseId,
                wkOrderId: fx.orderId,
                fulfillmentId: fx.fulfillmentId,
                deliveryAttemptId: attemptId,
                caseType: 'DELIVERY_FAILURE',
                status: OperationalCaseStatus.OPEN,
                openedByActorType: 'RIDER',
                openedByActorId: fx.riderId,
              },
            });
            await transitions.transitionInTx(
              tx,
              {
                fulfillmentId: fx.fulfillmentId,
                targetStatus: 'delivery_failed',
                actor: { id: fx.riderId, type: 'INTERNAL_SERVICE' },
                reason: 'forced_abort_probe',
              },
              'delivery_failed',
            );
            throw new Error('forced_delivery_failure_abort');
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      ).rejects.toThrow(/forced_delivery_failure_abort/);

      expect(
        await prisma.deliveryAttempt.count({
          where: { fulfillmentId: fx.fulfillmentId },
        }),
      ).toBe(0);
      expect(
        await prisma.operationalCase.count({
          where: { fulfillmentId: fx.fulfillmentId },
        }),
      ).toBe(0);
      expect(
        (
          await prisma.orderFulfillment.findUniqueOrThrow({
            where: { id: fx.fulfillmentId },
          })
        ).status,
      ).toBe(FulfillmentStatus.in_transit);

      const recovered = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
        idempotencyKey: `recover-${randomUUID()}`,
      });
      expect(recovered.code).toBe('DELIVERY_FAILURE_RECORDED');
    });

    it('race: failure vs Stage 5A delivery confirm — exclusive terminal', async () => {
      const fx = await seedInTransit();
      const issued = await delivery.issueForOrder({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
      });
      await Promise.allSettled([
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
          idempotencyKey: `race-del-${randomUUID()}`,
        }),
        delivery.confirm({
          actorUserId: fx.customerId,
          qrPayload: issued.qrPayload,
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      const failedAttempts = await prisma.deliveryAttempt.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          outcome: DeliveryAttemptOutcome.FAILED,
        },
      });
      const customerReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      });
      const deliveredOk =
        ful.status === FulfillmentStatus.delivered && customerReceived > 0;
      const failedOk =
        ful.status === FulfillmentStatus.delivery_failed && failedAttempts === 1;
      expect(deliveredOk && failedOk).toBe(false);
      expect(deliveredOk || failedOk).toBe(true);
    });

    it('race: failure vs Stage 7 custody confirm — coherent custodian', async () => {
      const fx = await seedInTransit();
      await assignments.assign({
        fulfillmentId: fx.fulfillmentId,
        riderId: fx.riderBId,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's8_pending_custody_race',
      });
      const mid = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(mid.pendingCustodyIncomingRiderId).toBe(fx.riderBId);
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
      });
      await Promise.allSettled([
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.RIDER_OPERATIONAL_FAILURE,
          idempotencyKey: `race-c-${randomUUID()}`,
        }),
        custodyHandoff.confirm({
          actorUserId: fx.riderBId,
          qrPayload: issued.qrPayload,
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      const failed = await prisma.deliveryAttempt.findMany({
        where: { fulfillmentId: fx.fulfillmentId },
      });
      const transferReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        },
      });
      if (failed.length > 0) {
        expect(ful.status).toBe(FulfillmentStatus.delivery_failed);
        expect(failed[0].riderId).toBe(fx.riderId);
        // Never attribute failure to A while B is proven custodian incompatibly
        expect(
          ful.physicalCustodianRiderId === fx.riderBId && transferReceived > 0,
        ).toBe(false);
      } else {
        expect(ful.status).toBe(FulfillmentStatus.in_transit);
        expect(ful.physicalCustodianRiderId).toBe(fx.riderBId);
        expect(ful.pendingCustodyIncomingRiderId).toBeNull();
        expect(transferReceived).toBe(1);
      }
    });

    it('race: failure vs reassignment stays coherent', async () => {
      const fx = await seedInTransit();
      await Promise.allSettled([
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.SAFETY_ISSUE,
          idempotencyKey: `race-re-${randomUUID()}`,
        }),
        assignments.assign({
          fulfillmentId: fx.fulfillmentId,
          riderId: fx.riderBId,
          actor: { type: 'SYSTEM' },
          allowReassignment: true,
          reason: 's8_race_reassign',
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      const attempts = await prisma.deliveryAttempt.count({
        where: { fulfillmentId: fx.fulfillmentId },
      });
      if (attempts > 0) {
        expect(ful.status).toBe(FulfillmentStatus.delivery_failed);
        expect(attempts).toBe(1);
      } else {
        expect(ful.status).toBe(FulfillmentStatus.in_transit);
        expect(
          ful.activeRiderId === fx.riderBId ||
            ful.pendingCustodyIncomingRiderId === fx.riderBId,
        ).toBe(true);
      }
    });

    it('two concurrent different idempotency keys → at most one FAILED', async () => {
      const fx = await seedInTransit();
      const settled = await Promise.allSettled([
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.GOODS_DAMAGED,
          idempotencyKey: `k1-${randomUUID()}`,
        }),
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.GOODS_LOST,
          idempotencyKey: `k2-${randomUUID()}`,
        }),
      ]);
      const ok = settled.filter((r) => r.status === 'fulfilled');
      expect(ok.length).toBe(1);
      expect(
        await prisma.deliveryAttempt.count({
          where: { fulfillmentId: fx.fulfillmentId },
        }),
      ).toBe(1);
      expect(
        await prisma.operationalCase.count({
          where: {
            fulfillmentId: fx.fulfillmentId,
            status: {
              in: [
                OperationalCaseStatus.OPEN,
                OperationalCaseStatus.DISPOSITION_SELECTED,
              ],
            },
          },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.orderFulfillment.findUniqueOrThrow({
            where: { id: fx.fulfillmentId },
          })
        ).status,
      ).toBe(FulfillmentStatus.delivery_failed);
    });

    it('provenance: rider-reported REFUSED + GPS RIDER_DEVICE_REPORTED', async () => {
      const fx = await seedInTransit();
      const result = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
        customerResponse: DeliveryAttemptCustomerResponse.REFUSED,
        locationLatitude: 14.6,
        locationLongitude: 120.98,
        locationProvenance: DeliveryAttemptLocationProvenance.RIDER_DEVICE_REPORTED,
        evidences: [
          {
            evidenceKind: DeliveryAttemptEvidenceKind.NOTES,
            storageReference: 'note://refused',
          },
        ],
        idempotencyKey: `prov-${randomUUID()}`,
      });
      expect(result.attempt.customerResponse).toBe(
        DeliveryAttemptCustomerResponse.REFUSED,
      );
      expect(result.attempt.locationProvenance).toBe(
        DeliveryAttemptLocationProvenance.RIDER_DEVICE_REPORTED,
      );
      const ev = await prisma.orderDomainEvent.findFirst({
        where: {
          fulfillmentId: fx.fulfillmentId,
          action: 'DELIVERY_ATTEMPT_FAILED',
        },
      });
      const meta = (ev?.metadata ?? {}) as Record<string, unknown>;
      expect(meta.customerResponseProvenance).toBe('RIDER_REPORTED');
      expect(meta.customerResponse).toBe('REFUSED');
      const evidence = await prisma.deliveryAttemptEvidence.findFirst({
        where: { deliveryAttemptId: result.attempt.id },
      });
      const em = (evidence?.metadata ?? {}) as Record<string, unknown>;
      expect(em.reportedBy).toBe('RIDER');
      expect(em.customerResponseProvenance).toBe('RIDER_REPORTED');
    });

    async function seedRa(
      fx: Awaited<ReturnType<typeof seedInTransit>>,
      status: RiderAdvanceStatus,
      opts?: { principal?: string; settled?: boolean },
    ) {
      const agreementId = randomUUID();
      const versionId = randomUUID();
      await prisma.agreement.create({
        data: {
          id: agreementId,
          wkOrderId: fx.orderId,
          agreementType: AgreementType.RIDER_ADVANCE,
          status: AgreementStatus.ACTIVE,
          requiredPartyRoles: ['CUSTOMER', 'RIDER'],
          parties: {
            create: [
              {
                id: randomUUID(),
                role: 'CUSTOMER',
                userId: fx.customerId,
              },
              {
                id: randomUUID(),
                role: 'RIDER',
                userId: fx.riderId,
              },
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
          termsSnapshot: { kind: 's8_test' },
          termsHash: randomUUID().replace(/-/g, ''),
        },
      });
      await prisma.agreement.update({
        where: { id: agreementId },
        data: { currentVersionId: versionId },
      });
      const raId = randomUUID();
      await prisma.riderAdvance.create({
        data: {
          id: raId,
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
          authorizedMaximumAmount: 500,
          actualAdvanceAmount:
            status === RiderAdvanceStatus.CUSTOMER_AUTHORIZED
              ? null
              : new Prisma.Decimal(480),
          reimbursementPrincipal: opts?.principal
            ? new Prisma.Decimal(opts.principal)
            : status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
                status === RiderAdvanceStatus.REIMBURSED
              ? new Prisma.Decimal(480)
              : null,
          status,
        },
      });
      if (opts?.settled) {
        await prisma.riderAdvanceSettlement.create({
          data: {
            id: randomUUID(),
            riderAdvanceId: raId,
            wkOrderId: fx.orderId,
            customerId: fx.customerId,
            creditorRiderId: fx.riderId,
            method: 'CASH',
            status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
            claimedAmount: new Prisma.Decimal(200),
            acknowledgedAmount: new Prisma.Decimal(200),
          },
        });
      }
      return raId;
    }

    it('RA matrix: failure does not mutate RA fields across statuses', async () => {
      const matrix: Array<{
        label: string;
        status?: RiderAdvanceStatus;
        principal?: string;
        settled?: boolean;
      }> = [
        { label: 'no_ra' },
        { label: 'authorized', status: RiderAdvanceStatus.CUSTOMER_AUTHORIZED },
        { label: 'recorded', status: RiderAdvanceStatus.ADVANCE_RECORDED },
        {
          label: 'due',
          status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
          principal: '480.00',
        },
        {
          label: 'partial',
          status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
          principal: '480.00',
          settled: true,
        },
        {
          label: 'reimbursed',
          status: RiderAdvanceStatus.REIMBURSED,
          principal: '480.00',
        },
      ];

      for (const row of matrix) {
        const fx = await seedInTransit({ allowRA: true });
        let before: Record<string, unknown> | null = null;
        if (row.status) {
          const raId = await seedRa(fx, row.status, {
            principal: row.principal,
            settled: row.settled,
          });
          const snap = await prisma.riderAdvance.findUniqueOrThrow({
            where: { id: raId },
          });
          before = {
            status: snap.status,
            authorizedMaximumAmount: snap.authorizedMaximumAmount?.toFixed(2),
            actualAdvanceAmount: snap.actualAdvanceAmount?.toFixed(2) ?? null,
            reimbursementPrincipal:
              snap.reimbursementPrincipal?.toFixed(2) ?? null,
            riderId: snap.riderId,
          };
        }
        await failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
          idempotencyKey: `ra-${row.label}-${randomUUID()}`,
        });
        if (!row.status) {
          expect(
            await prisma.riderAdvance.count({ where: { wkOrderId: fx.orderId } }),
          ).toBe(0);
        } else {
          const after = await prisma.riderAdvance.findFirstOrThrow({
            where: { wkOrderId: fx.orderId },
          });
          expect({
            status: after.status,
            authorizedMaximumAmount: after.authorizedMaximumAmount?.toFixed(2),
            actualAdvanceAmount: after.actualAdvanceAmount?.toFixed(2) ?? null,
            reimbursementPrincipal:
              after.reimbursementPrincipal?.toFixed(2) ?? null,
            riderId: after.riderId,
          }).toEqual(before);
        }
        if (cleanup) await cleanup();
        cleanup = undefined;
      }
    });

    it('merchant payment matrix: failure does not mutate merchantPaymentStatus', async () => {
      for (const status of [
        MerchantPaymentStatus.AWAITING_PAYMENT,
        MerchantPaymentStatus.VERIFIED,
        MerchantPaymentStatus.REJECTED,
      ]) {
        const fx = await seedInTransit();
        await prisma.wkOrder.update({
          where: { id: fx.orderId },
          data: { merchantPaymentStatus: status },
        });
        await failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
          idempotencyKey: `mp-${status}-${randomUUID()}`,
        });
        const after = await prisma.wkOrder.findUniqueOrThrow({
          where: { id: fx.orderId },
        });
        expect(after.merchantPaymentStatus).toBe(status);
        if (cleanup) await cleanup();
        cleanup = undefined;
      }
    });

    it('merchant refuse return stays exceptional without Stage 6 confirm', async () => {
      const fx = await seedInTransit();
      const reported = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_REFUSED,
        idempotencyKey: `refuse-${randomUUID()}`,
      });
      await failures.selectDisposition({
        caseId: reported.case!.id,
        actorUserId: fx.adminId,
        disposition: OperationalDisposition.RETURN_TO_MERCHANT,
        reason: 'return without merchant confirm',
        correlationId: `corr-${randomUUID()}`,
      });
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(ful.status).toBe(FulfillmentStatus.returning);
      expect(ful.physicalCustodianRiderId).toBe(fx.riderId);
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillmentId,
            eventType: CustodyEventType.RETURN_RECEIVED,
          },
        }),
      ).toBe(0);
      const opCase = await prisma.operationalCase.findUniqueOrThrow({
        where: { id: reported.case!.id },
      });
      expect(opCase.status).not.toBe(OperationalCaseStatus.RESOLVED);
      const ops = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toEqual(
        expect.arrayContaining([
          'RETURN_IN_PROGRESS',
          'RETURN_MERCHANT_CONFIRMATION_PENDING',
        ]),
      );
      expect(
        (
          await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
        ).merchantPaymentStatus,
      ).toBe(MerchantPaymentStatus.AWAITING_PAYMENT);
    });

    it('OPERATIONS_RECOVERY_REQUIRED disposition sets ops flag', async () => {
      const fx = await seedInTransit();
      const reported = await failures.reportFailure({
        wkOrderId: fx.orderId,
        actorUserId: fx.riderId,
        failureReasonCode: DeliveryFailureReasonCode.GOODS_LOST,
        idempotencyKey: `ops-${randomUUID()}`,
      });
      await failures.selectDisposition({
        caseId: reported.case!.id,
        actorUserId: fx.adminId,
        disposition: OperationalDisposition.OPERATIONS_RECOVERY_REQUIRED,
        reason: 'ops recovery',
        correlationId: `corr-${randomUUID()}`,
      });
      const ops = await operational.getForOrder(fx.orderId, fx.adminId);
      expect(ops.flags).toContain('OPERATIONS_RECOVERY_REQUIRED');
      expect(
        (
          await prisma.orderFulfillment.findUniqueOrThrow({
            where: { id: fx.fulfillmentId },
          })
        ).status,
      ).toBe(FulfillmentStatus.delivery_failed);
    });

    it('INVALID_FULFILLMENT_STATE when not in_transit', async () => {
      const fx = await seedInTransit();
      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillmentId },
        data: { status: FulfillmentStatus.picked_up },
      });
      await expectForbiddenCode(
        failures.reportFailure({
          wkOrderId: fx.orderId,
          actorUserId: fx.riderId,
          failureReasonCode: DeliveryFailureReasonCode.ADDRESS_ISSUE,
          idempotencyKey: `badstate-${randomUUID()}`,
        }),
        'INVALID_FULFILLMENT_STATE',
      );
    });

    it('marketplace FulfillmentTransitionService rider delivery_failed bypass closed', async () => {
      const fx = await seedInTransit();
      await expectForbiddenCode(
        transitions.transition({
          wkOrderId: fx.orderId,
          targetStatus: 'delivery_failed',
          actor: { id: fx.riderId, type: 'RIDER' },
        }),
        'USE_DELIVERY_FAILURE_REPORT',
      );
      // Tracking gateway is orderV2-only; wkOrder marketplace path is the
      // authoritative surface and must remain closed for riders.
      expect(
        (
          await prisma.orderFulfillment.findUniqueOrThrow({
            where: { id: fx.fulfillmentId },
          })
        ).status,
      ).toBe(FulfillmentStatus.in_transit);
    });
  },
);
