/**
 * Stage 5A PostgreSQL concurrency / integrity suite.
 * Requires backend/.env.stage5.test and database wekonnek_stage5_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage7_regression_test.
 * Does NOT fall back to stage2/stage3/stage4 databases.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE5_ENV_PRESENT = loadStageTestEnv('.env.stage5.test');

import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommerceDomain,
  CustodyEventType,
  CustomerDeliveryHandoffPurpose,
  CustomerDeliveryHandoffTokenStatus,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PickupHandoffService } from '../pickup-handoff/pickup-handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderCustodyHandoffService } from '../rider-custody-handoff/rider-custody-handoff.service';
import { DeliveryHandoffService } from './delivery-handoff.service';

const describeIf = STAGE5_ENV_PRESENT ? describe : describe.skip;

jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage5_test',
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
]);

describeIf('Stage 5A Delivery Handoff PostgreSQL (wekonnek_stage5_test)', () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const riderAdvance = new RiderAdvanceService(prisma, events);
  const assignments = new RiderAssignmentService(prisma, events, riderAdvance);
  const transitions = new FulfillmentTransitionService(
    prisma,
    events,
    assignments,
  );
  const custody = new CustodyEventService(prisma, events);
  const config = {
    get: (key: string) => {
      if (key === 'DELIVERY_HANDOFF_TTL_SECONDS') return '300';
      if (key === 'PICKUP_HANDOFF_TTL_SECONDS') return '300';
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
    const okHistorical = database === 'wekonnek_stage5_test';
    const okRegression =
      isCurrentSchemaRegressionMode() &&
      database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE;
    if (
      (!okHistorical && !okRegression) ||
      !user ||
      FORBIDDEN_DB_USERS.has(user) ||
      !ALLOWED_DB_USERS.has(user)
    ) {
      throw new Error(
        `Stage 5 tests require wekonnek_stage5_test or stage7 regression identity; got database=${database} user=${user}`,
      );
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seed(opts?: { allowRA?: boolean; cash?: boolean }) {
    const tag = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+6391${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s5a-c-${tag}@test.invalid`,
        role: UserRole.customer,
      },
    });
    const rider = await prisma.user.create({
      data: {
        phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s5a-r-${tag}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const riderB = await prisma.user.create({
      data: {
        phone: `+6393${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s5a-rb-${tag}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+6394${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s5a-m-${tag}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S5A ${tag}`,
        slug: `s5a-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: opts?.allowRA ?? true,
      },
    });
    if (opts?.cash !== false) {
      await prisma.merchantPaymentMethod.create({
        data: {
          id: randomUUID(),
          merchantId: merchant.id,
          kind: MerchantPaymentMethodKind.CASH,
          displayName: 'Cash',
          enabled: true,
        },
      });
    }
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S5A-${tag.slice(0, 8)}`,
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
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: rider.id,
      actor: { type: 'SYSTEM' },
    });
    const refreshed = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });

    cleanup = async () => {
      const deliveryTokens = await prisma.customerDeliveryHandoffToken.findMany({
        where: { wkOrderId: order.id },
      });
      const pickupTokens = await prisma.pickupHandoffToken.findMany({
        where: { wkOrderId: order.id },
      });
      const custodyIds = [
        ...deliveryTokens.map((t) => t.custodyEventId),
        ...pickupTokens.map((t) => t.custodyEventId),
      ].filter(Boolean) as string[];
      await prisma.riderCustodyHandoffToken.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.customerDeliveryHandoffToken.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.pickupHandoffToken.deleteMany({
        where: { wkOrderId: order.id },
      });
      if (custodyIds.length) {
        await prisma.custodyEventEvidence.deleteMany({
          where: { custodyEventId: { in: custodyIds } },
        });
        await prisma.custodyEvent.deleteMany({
          where: { id: { in: custodyIds } },
        });
      }
      await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.agreementEvidence.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order.id } });
      const ags = await prisma.agreement.findMany({
        where: { wkOrderId: order.id },
      });
      for (const ag of ags) {
        await prisma.agreementAcceptance.deleteMany({
          where: { agreementVersion: { agreementId: ag.id } },
        });
        await prisma.agreementParty.deleteMany({
          where: { agreementId: ag.id },
        });
        await prisma.agreement.update({
          where: { id: ag.id },
          data: { currentVersionId: null },
        });
        await prisma.agreementVersion.deleteMany({
          where: { agreementId: ag.id },
        });
      }
      await prisma.agreement.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.orderPaymentAllocation.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.merchantPaymentEvidence.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.orderDomainEvent.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.riderAssignment.deleteMany({
        where: { fulfillmentId: fulfillment.id },
      });
      await prisma.orderFulfillment.deleteMany({
        where: { id: fulfillment.id },
      });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.wkOrder.deleteMany({ where: { id: order.id } });
      await prisma.merchantPaymentMethod.deleteMany({
        where: { merchantId: merchant.id },
      });
      await prisma.merchant.deleteMany({ where: { id: merchant.id } });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [customer.id, rider.id, riderB.id, merchantUser.id],
          },
        },
      });
    };

    return {
      customer,
      rider,
      riderB,
      merchantUser,
      merchant,
      order,
      fulfillment: refreshed,
    };
  }

  async function advanceToInTransit(
    fx: Awaited<ReturnType<typeof seed>>,
    riderId?: string,
  ) {
    const activeRiderId = riderId ?? fx.rider.id;
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: activeRiderId,
    });
    const confirmed = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(confirmed.ok).toBe(true);
    await transitions.transition({
      fulfillmentId: fx.fulfillment.id,
      targetStatus: 'in_transit',
      actor: { id: activeRiderId, type: 'RIDER' },
      reason: 's5a_test_in_transit',
    });
    return prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillment.id },
    });
  }

  async function confirmCustodyTransfer(
    fx: Awaited<ReturnType<typeof seed>>,
    outgoingId: string,
    incomingId: string,
  ) {
    const pending = await assignments.assign({
      fulfillmentId: fx.fulfillment.id,
      riderId: incomingId,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 's5a_mid_custody',
    });
    expect(pending.pendingCustodyTransfer).toBe(true);
    const handoff = await custodyHandoff.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: outgoingId,
    });
    const ok = await custodyHandoff.confirm({
      actorUserId: incomingId,
      qrPayload: handoff.qrPayload,
    });
    expect(ok.ok).toBe(true);
  }

  async function completeRaToReimbursementDue(
    fx: Awaited<ReturnType<typeof seed>>,
    amount = '980.00',
  ) {
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1100.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });
    await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
      actualAdvanceAmount: amount,
    });
    await riderAdvance.vendorAcknowledge({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.merchantUser.id,
      acknowledgedAmount: amount,
    });
    return prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
  }

  it('1) reissue keeps a single ACTIVE delivery capability per fulfillment', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);

    const first = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const second = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    expect(second.tokenId).not.toBe(first.tokenId);

    const prior = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: first.tokenId },
    });
    expect(prior.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);
    expect(prior.revokeReason).toBe('superseded_by_reissue');

    expect(
      await prisma.customerDeliveryHandoffToken.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
          status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
        },
      }),
    ).toBe(1);

    const stale = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: first.qrPayload,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('TOKEN_REVOKED');
  });

  it('2) double confirm race → exactly one CUSTOMER_RECEIVED custody + delivered', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    const results = await Promise.allSettled([
      delivery.confirm({
        actorUserId: fx.customer.id,
        qrPayload: issued.qrPayload,
      }),
      delivery.confirm({
        actorUserId: fx.customer.id,
        qrPayload: issued.qrPayload,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<{
      status: 'fulfilled';
      value: Awaited<ReturnType<DeliveryHandoffService['confirm']>>;
    }>;
    const ok = fulfilled.filter((r) => r.value.ok);
    expect(ok.length).toBeGreaterThanOrEqual(1);

    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.delivered);
    expect(
      await prisma.customerDeliveryHandoffToken.count({
        where: {
          id: issued.tokenId,
          status: CustomerDeliveryHandoffTokenStatus.CONSUMED,
        },
      }),
    ).toBe(1);
  });

  it('3) reassignment invalidates ACTIVE delivery token', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    await confirmCustodyTransfer(fx, fx.rider.id, fx.riderB.id);

    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);

    const denied = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(denied.ok).toBe(false);

    const fresh = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.riderB.id,
    });
    const ok = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: fresh.qrPayload,
    });
    expect(ok.ok).toBe(true);
  });

  it('4) expiry denial creates no delivered custody', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await prisma.customerDeliveryHandoffToken.update({
      where: { id: issued.tokenId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOKEN_EXPIRED');

    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.in_transit);
  });

  it('5) atomic confirm: custody + delivered; rollback on failure path', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    const success = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
      correlationId: `corr-${fx.order.id}`,
    });
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.fulfillmentStatus).toBe('delivered');
      expect(success.custodyEventId).toBeTruthy();
    }
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.delivered);

    // Fresh fixture for forced abort / rollback probe (preserve both cleanups)
    const cleanSuccess = cleanup!;
    const fx2 = await seed({ allowRA: false });
    const cleanAbort = cleanup!;
    cleanup = async () => {
      await cleanAbort();
      await cleanSuccess();
    };
    const f2 = await advanceToInTransit(fx2);
    const issued2 = await delivery.issueForOrder({
      wkOrderId: fx2.order.id,
      actorUserId: fx2.rider.id,
    });

    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "customer_delivery_handoff_tokens" WHERE id = ${issued2.tokenId}::uuid FOR UPDATE
          `;
          await custody.record({
            tx,
            actorUserId: fx2.customer.id,
            eventType: CustodyEventType.CUSTOMER_RECEIVED,
            wkOrderId: fx2.order.id,
            fulfillmentId: f2.id,
            fromPartyRole: 'RIDER',
            toPartyRole: 'CUSTOMER',
            fromUserId: fx2.rider.id,
            toUserId: fx2.customer.id,
            metadata: { forcedAbortProbe: true },
          });
          await transitions.transitionInTx(
            tx,
            {
              fulfillmentId: f2.id,
              targetStatus: 'delivered',
              actor: {
                id: fx2.customer.id,
                type: 'INTERNAL_SERVICE',
              },
              reason: 'forced_abort_probe',
              expectedVersion: f2.assignmentVersion,
            },
            'delivered',
          );
          await tx.customerDeliveryHandoffToken.update({
            where: { id: issued2.tokenId },
            data: {
              status: CustomerDeliveryHandoffTokenStatus.CONSUMED,
              consumedAt: new Date(),
              consumedByUserId: fx2.customer.id,
              customerConfirmedAt: new Date(),
              customerConfirmedByUserId: fx2.customer.id,
            },
          });
          throw new Error('forced_delivery_handoff_abort');
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).rejects.toThrow(/forced_delivery_handoff_abort/);

    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued2.tokenId },
    });
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.ACTIVE);
    expect(token.consumedAt).toBeNull();
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx2.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: f2.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.in_transit);
  });

  it('6) Rider A creditor / Rider B delivery: RA preserved through reassign + customer confirm', async () => {
    const fx = await seed();
    const ra = await completeRaToReimbursementDue(fx, '980.00');
    expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
    expect(ra.riderId).toBe(fx.rider.id);

    await advanceToInTransit(fx, fx.rider.id);

    await confirmCustodyTransfer(fx, fx.rider.id, fx.riderB.id);

    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.riderB.id,
    });
    const confirmed = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(confirmed.ok).toBe(true);

    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillment.id },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.delivered);
    expect(fulfillment.activeRiderId).toBe(fx.riderB.id);

    const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: ra.id },
    });
    expect(raAfter.riderId).toBe(fx.rider.id);
    expect(raAfter.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    expect(raAfter.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
  });

  it('7) failed delivery transitions preserve Rider Advance', async () => {
    const fx = await seed();
    const ra = await completeRaToReimbursementDue(fx, '980.00');
    await advanceToInTransit(fx);

    await transitions.transition({
      fulfillmentId: fx.fulfillment.id,
      targetStatus: 'delivery_failed',
      actor: { id: fx.rider.id, type: 'RIDER' },
      reason: 's5a_delivery_failed',
    });
    await transitions.transition({
      fulfillmentId: fx.fulfillment.id,
      targetStatus: 'returning',
      actor: { id: fx.rider.id, type: 'RIDER' },
      reason: 's5a_returning',
    });
    // Stage 6: returned requires merchant-confirmed handoff (INTERNAL_SERVICE)
    await transitions.transition({
      fulfillmentId: fx.fulfillment.id,
      targetStatus: 'returned',
      actor: { id: fx.merchantUser.id, type: 'INTERNAL_SERVICE' },
      reason: 's5a_returned_via_secure_handoff',
      correlationId: 's5a-secure-return',
    });

    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillment.id },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.returned);

    const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: ra.id },
    });
    expect(raAfter.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    expect(raAfter.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
    expect(raAfter.riderId).toBe(fx.rider.id);
  });

  it('8) rider direct transition to delivered throws Forbidden', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);

    await expect(
      transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'delivered',
        actor: { id: fx.rider.id, type: 'RIDER' },
        reason: 'rider_self_deliver_blocked',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.in_transit);
  });

  it('9) QR confirm then OTP replay shares one capability (no second custody)', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const qr = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(qr.ok).toBe(true);
    const otpReplay = await delivery.confirm({
      actorUserId: fx.customer.id,
      otp: issued.otp,
      orderId: fx.order.id,
    });
    // Same capability: idempotent success or hard deny — never a second custody.
    if (otpReplay.ok) {
      expect(otpReplay.idempotent).toBe(true);
    } else {
      expect([
        'TOKEN_CONSUMED',
        'TOKEN_INVALID',
        'FULFILLMENT_NOT_DELIVERY_ELIGIBLE',
      ]).toContain(otpReplay.code);
    }
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(1);
  });

  it('10) OTP confirm then QR replay shares one capability (no second custody)', async () => {
    const fx = await seed({ allowRA: false });
    await advanceToInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const otp = await delivery.confirm({
      actorUserId: fx.customer.id,
      otp: issued.otp,
      orderId: fx.order.id,
    });
    expect(otp.ok).toBe(true);
    const qrReplay = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    // Consumed+same customer QR path returns idempotent success without new custody
    if (qrReplay.ok) {
      expect(qrReplay.idempotent).toBe(true);
    } else {
      expect(['TOKEN_CONSUMED', 'TOKEN_INVALID']).toContain(qrReplay.code);
    }
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillment.id },
        })
      ).status,
    ).toBe(FulfillmentStatus.delivered);
  });
});

describe('Stage 5A PostgreSQL environment gate', () => {
  it('requires .env.stage5.test for database-backed acceptance', () => {
    expect(STAGE5_ENV_PRESENT).toBe(true);
  });
});
