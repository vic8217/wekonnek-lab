/**
 * Stage 3A PostgreSQL concurrency / atomicity suite.
 * Requires backend/.env.stage3.test and database wekonnek_stage3_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage7_regression_test.
 * Does NOT fall back to stage0/stage1/stage2 databases.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE3_ENV_PRESENT = loadStageTestEnv('.env.stage3.test');

import { ConfigService } from '@nestjs/config';
import {
  AgreementProvenance,
  AgreementStatus,
  AgreementType,
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  PickupHandoffPurpose,
  PickupHandoffTokenStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AgreementService } from '../agreements/agreement.service';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { PickupHandoffService } from './pickup-handoff.service';
import {
  encodePickupQrPayload,
  generatePickupSecret,
  hashPickupSecret,
} from './pickup-token';

const describeIf = STAGE3_ENV_PRESENT ? describe : describe.skip;

jest.setTimeout(120_000);

describeIf('Stage 3A pickup handoff PostgreSQL (wekonnek_stage3_test)', () => {
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
  const agreements = new AgreementService(prisma, events);
  const config = {
    get: (key: string) =>
      key === 'PICKUP_HANDOFF_TTL_SECONDS' ? '300' : undefined,
  } as ConfigService;
  const pickup = new PickupHandoffService(
    prisma,
    events,
    custody,
    transitions,
    config,
    riderAdvance,
  );
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    const database = target[0]?.database;
    const user = target[0]?.user;
    const okHistorical =
      database === 'wekonnek_stage3_test' && user === 'wekonnek_stage3_test';
    const okRegression =
      isCurrentSchemaRegressionMode() &&
      (database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE || database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE) &&
      (user === 'victor' || user === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE || user === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE);
    if (!okHistorical && !okRegression) {
      throw new Error(
        `Stage 3 tests require wekonnek_stage3_test or stage7 regression identity; got database=${database} user=${user}`,
      );
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedReadyPickup(options?: { withAgreement?: boolean }) {
    const token = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+6391${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s3a-c-${token}@test.invalid`,
      },
    });
    const rider = await prisma.user.create({
      data: {
        phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s3a-r-${token}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const riderB = await prisma.user.create({
      data: {
        phone: `+6393${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s3a-rb-${token}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+6394${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s3a-m-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const otherMerchantUser = await prisma.user.create({
      data: {
        phone: `+6395${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s3a-om-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S3A ${token}`,
        slug: `s3a-${token}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const otherMerchant = await prisma.merchant.create({
      data: {
        userId: otherMerchantUser.id,
        name: `S3A-O ${token}`,
        slug: `s3a-o-${token}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S3A-${token.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        merchantPaymentStatus: 'AWAITING_PAYMENT',
        orderItems: {
          create: [
            {
              productName: 'Item',
              quantity: 1,
              price: 100,
              subtotal: 100,
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

    let agreementId: string | undefined;
    if (options?.withAgreement) {
      const ag = await agreements.offerMerchantTradeForOrder(order.id, {
        provenance: AgreementProvenance.LEGACY_SNAPSHOT,
      });
      agreementId = ag.id;
    }

    cleanup = async () => {
      const ags = await prisma.agreement.findMany({
        where: { wkOrderId: order.id },
      });
      for (const ag of ags) {
        await prisma.agreementAcceptance.deleteMany({
          where: { agreementVersion: { agreementId: ag.id } },
        });
        await prisma.agreementEvidence.deleteMany({
          where: { agreementId: ag.id },
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
        await prisma.agreement.delete({ where: { id: ag.id } });
      }
      await prisma.pickupHandoffToken.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.custodyEventEvidence.deleteMany({
        where: { custodyEvent: { wkOrderId: order.id } },
      });
      await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.orderDomainEvent.deleteMany({
        where: {
          OR: [{ wkOrderId: order.id }, { fulfillmentId: fulfillment.id }],
        },
      });
      await prisma.orderPaymentAllocation.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.merchantPaymentEvidence.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.riderAssignment.deleteMany({
        where: { fulfillmentId: fulfillment.id },
      });
      await prisma.orderFulfillment.delete({ where: { id: fulfillment.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.wkOrder.delete({ where: { id: order.id } });
      await prisma.merchant.deleteMany({
        where: { id: { in: [merchant.id, otherMerchant.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [
              customer.id,
              rider.id,
              riderB.id,
              merchantUser.id,
              otherMerchantUser.id,
            ],
          },
        },
      });
    };

    const refreshed = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });

    return {
      customer,
      rider,
      riderB,
      merchantUser,
      otherMerchantUser,
      merchant,
      otherMerchant,
      order,
      fulfillmentId: fulfillment.id,
      assignmentVersion: refreshed.assignmentVersion,
      agreementId,
    };
  }

  it('1) simultaneous confirmation yields one authoritative handoff', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    const results = await Promise.allSettled([
      pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      }),
      pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<{
      status: 'fulfilled';
      value: Awaited<ReturnType<PickupHandoffService['confirm']>>;
    }>;
    const authoritative = fulfilled.filter(
      (r) => r.value.ok && !('idempotent' in r.value && r.value.idempotent),
    );
    const idempotent = fulfilled.filter(
      (r) => r.value.ok && 'idempotent' in r.value && r.value.idempotent,
    );
    expect(authoritative.length + idempotent.length).toBeGreaterThanOrEqual(1);
    expect(authoritative.length).toBeLessThanOrEqual(1);

    expect(
      await prisma.pickupHandoffToken.count({
        where: {
          wkOrderId: fx.order.id,
          status: PickupHandoffTokenStatus.CONSUMED,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.MERCHANT_RELEASED,
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillmentId },
        })
      ).status,
    ).toBe(FulfillmentStatus.picked_up);
  });

  it('2) confirmation racing reassignment: old assignment token cannot authorize', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    const results = await Promise.allSettled([
      pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      }),
      assignments.assign({
        fulfillmentId: fx.fulfillmentId,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      }),
    ]);

    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    const consumed = await prisma.pickupHandoffToken.findFirst({
      where: {
        id: issued.tokenId,
        status: PickupHandoffTokenStatus.CONSUMED,
      },
    });
    const custodyCount = await prisma.custodyEvent.count({
      where: {
        wkOrderId: fx.order.id,
        eventType: CustodyEventType.MERCHANT_RELEASED,
      },
    });

    if (consumed) {
      // Confirm won before reassignment became authoritative.
      expect(fulfillment.status).toBe(FulfillmentStatus.picked_up);
      expect(custodyCount).toBe(1);
      expect(fulfillment.activeRiderId).toBe(fx.rider.id);
    } else {
      // Reassignment won: old token must not produce pickup.
      expect(fulfillment.activeRiderId).toBe(fx.riderB.id);
      expect(fulfillment.status).toBe(FulfillmentStatus.rider_assigned);
      expect(custodyCount).toBe(0);
      const retry = await pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      });
      expect(retry.ok).toBe(false);
    }
    expect(results.length).toBe(2);
  });

  it('3) confirmation racing cancellation: no cancelled+picked_up contradiction', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });

    await Promise.allSettled([
      pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      }),
      transitions.transition({
        fulfillmentId: fx.fulfillmentId,
        targetStatus: 'cancelled',
        actor: { type: 'SYSTEM' },
        reason: 'race_cancel',
      }),
    ]);

    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect([
      FulfillmentStatus.picked_up,
      FulfillmentStatus.cancelled,
    ]).toContain(fulfillment.status);
    expect(fulfillment.status === FulfillmentStatus.picked_up && fulfillment.cancelledAt != null).toBe(
      false,
    );
    if (fulfillment.status === FulfillmentStatus.cancelled) {
      expect(
        await prisma.custodyEvent.count({
          where: {
            wkOrderId: fx.order.id,
            eventType: CustodyEventType.MERCHANT_RELEASED,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.pickupHandoffToken.count({
          where: {
            id: issued.tokenId,
            status: PickupHandoffTokenStatus.CONSUMED,
          },
        }),
      ).toBe(0);
    }
  });

  it('4) expired token confirmation creates no custody or picked_up', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await prisma.pickupHandoffToken.update({
      where: { id: issued.tokenId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOKEN_EXPIRED');
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillmentId },
        })
      ).status,
    ).toBe(FulfillmentStatus.rider_assigned);
  });

  it('5) regeneration revokes prior QR; superseded token cannot authorize', async () => {
    const fx = await seedReadyPickup();
    const first = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const second = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    expect(second.tokenId).not.toBe(first.tokenId);
    expect(
      (
        await prisma.pickupHandoffToken.findUniqueOrThrow({
          where: { id: first.tokenId },
        })
      ).status,
    ).toBe(PickupHandoffTokenStatus.REVOKED);
    expect(
      await prisma.pickupHandoffToken.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
          status: PickupHandoffTokenStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    const replay = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: first.qrPayload,
    });
    expect(replay.ok).toBe(false);
  });

  it('6) duplicate confirmation is idempotent without duplicate custody/events', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const first = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.idempotent).toBe(false);

    const second = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.idempotent).toBe(true);

    expect(
      await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: CustodyEventType.MERCHANT_RELEASED,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          fulfillmentId: fx.fulfillmentId,
          action: 'PICKUP_HANDOFF_CONFIRMED',
        },
      }),
    ).toBe(1);
  });

  it('7) successful atomic handoff: consumed + one custody + picked_up + audit', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const result = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
      correlationId: `corr-${fx.order.id}`,
    });
    expect(result.ok).toBe(true);

    const token = await prisma.pickupHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(token.status).toBe(PickupHandoffTokenStatus.CONSUMED);
    expect(token.custodyEventId).toBeTruthy();
    expect(token.merchantConfirmedByUserId).toBe(fx.merchantUser.id);

    const custodyRows = await prisma.custodyEvent.findMany({
      where: {
        wkOrderId: fx.order.id,
        eventType: CustodyEventType.MERCHANT_RELEASED,
      },
    });
    expect(custodyRows).toHaveLength(1);
    expect(custodyRows[0].toUserId).toBe(fx.rider.id);

    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.picked_up);

    const audit = await prisma.orderDomainEvent.findMany({
      where: {
        fulfillmentId: fx.fulfillmentId,
        action: {
          in: [
            'PICKUP_TOKEN_ISSUED',
            'PICKUP_HANDOFF_CONFIRMED',
            'FULFILLMENT_STATUS_CHANGED',
            'CUSTODY_EVENT_RECORDED',
          ],
        },
      },
    });
    expect(audit.some((e) => e.action === 'PICKUP_HANDOFF_CONFIRMED')).toBe(
      true,
    );
    expect(audit.some((e) => e.action === 'FULFILLMENT_STATUS_CHANGED')).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain(issued.qrPayload.split('.')[2]);
  });

  it('8) failure atomicity: mid-txn abort rolls back token/custody/fulfillment', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const secret = issued.qrPayload.split('.')[2];

    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "pickup_handoff_tokens" WHERE id = ${issued.tokenId}::uuid FOR UPDATE
          `;
          await custody.record({
            tx,
            actorUserId: fx.merchantUser.id,
            eventType: CustodyEventType.MERCHANT_RELEASED,
            wkOrderId: fx.order.id,
            fulfillmentId: fx.fulfillmentId,
            fromPartyRole: 'MERCHANT',
            toPartyRole: 'RIDER',
            toUserId: fx.rider.id,
            metadata: { forcedAbortProbe: true },
          });
          await transitions.transitionInTx(
            tx,
            {
              fulfillmentId: fx.fulfillmentId,
              targetStatus: 'picked_up',
              actor: { id: fx.merchantUser.id, type: 'INTERNAL_SERVICE' },
              reason: 'forced_abort_probe',
              expectedVersion: fx.assignmentVersion,
            },
            'picked_up',
          );
          await tx.pickupHandoffToken.update({
            where: { id: issued.tokenId },
            data: {
              status: PickupHandoffTokenStatus.CONSUMED,
              consumedAt: new Date(),
              consumedByUserId: fx.merchantUser.id,
              merchantConfirmedAt: new Date(),
              merchantConfirmedByUserId: fx.merchantUser.id,
            },
          });
          // Force abort after all handoff writes — must roll back together.
          throw new Error('forced_handoff_abort');
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ).rejects.toThrow(/forced_handoff_abort/);

    const token = await prisma.pickupHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(token.status).toBe(PickupHandoffTokenStatus.ACTIVE);
    expect(token.consumedAt).toBeNull();
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillmentId },
        })
      ).status,
    ).toBe(FulfillmentStatus.rider_assigned);

    // Real confirm still works after aborted probe.
    const recovered = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: encodePickupQrPayload({
        tokenId: issued.tokenId,
        secret,
      }),
    });
    expect(recovered.ok).toBe(true);
  });

  it('9) payment separation: pickup does not mutate payment fields/allocations/evidence', async () => {
    const fx = await seedReadyPickup();
    const before = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.order.id },
    });
    const allocBefore = await prisma.orderPaymentAllocation.count({
      where: { wkOrderId: fx.order.id },
    });
    const evidenceBefore = await prisma.merchantPaymentEvidence.count({
      where: { wkOrderId: fx.order.id },
    });

    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });

    const after = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: fx.order.id },
    });
    expect(after.paymentStatus).toBe(before.paymentStatus);
    expect(after.merchantPaymentStatus).toBe(before.merchantPaymentStatus);
    expect(after.paymentMethod).toBe(before.paymentMethod);
    expect(
      await prisma.orderPaymentAllocation.count({
        where: { wkOrderId: fx.order.id },
      }),
    ).toBe(allocBefore);
    expect(
      await prisma.merchantPaymentEvidence.count({
        where: { wkOrderId: fx.order.id },
      }),
    ).toBe(evidenceBefore);
  });

  it('10) agreement separation: no MERCHANT_TRADE accept / no RIDER_ADVANCE', async () => {
    const fx = await seedReadyPickup({ withAgreement: true });
    const before = await prisma.agreement.findUniqueOrThrow({
      where: { id: fx.agreementId! },
      include: { versions: true, parties: true },
    });
    expect(before.status).toBe(AgreementStatus.OFFERED);
    expect(before.provenance).toBe(AgreementProvenance.LEGACY_SNAPSHOT);

    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });

    const after = await prisma.agreement.findUniqueOrThrow({
      where: { id: fx.agreementId! },
      include: {
        versions: { include: { acceptances: true } },
        parties: true,
      },
    });
    expect(after.status).toBe(before.status);
    expect(after.provenance).toBe(before.provenance);
    expect(after.versions[0].termsHash).toBe(before.versions[0].termsHash);
    expect(after.parties).toHaveLength(before.parties.length);
    expect(after.versions[0].acceptances).toHaveLength(0);
    expect(
      await prisma.agreement.count({
        where: {
          wkOrderId: fx.order.id,
          agreementType: AgreementType.RIDER_ADVANCE,
        },
      }),
    ).toBe(0);
  });

  it('11) assignment-version binding: version N token fails after N+1', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    expect(issued.assignmentVersion).toBe(fx.assignmentVersion);

    await assignments.assign({
      fulfillmentId: fx.fulfillmentId,
      riderId: fx.riderB.id,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
    });
    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillmentId },
    });
    expect(after.assignmentVersion).toBe(fx.assignmentVersion + 1);

    const result = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Stage 3: assignment-version mismatch. Stage 7+ also revokes ACTIVE pickup
      // tokens on reassignment (TOKEN_REVOKED) — both prove capability unusable.
      expect(result.code).toMatch(/ASSIGNMENT|TOKEN_REVOKED/);
    }
    expect(
      (
        await prisma.orderFulfillment.findUniqueOrThrow({
          where: { id: fx.fulfillmentId },
        })
      ).status,
    ).toBe(FulfillmentStatus.rider_assigned);
  });

  it('12) wrong merchant denied; DB enforces unique tokenHash and one ACTIVE', async () => {
    const fx = await seedReadyPickup();
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const denied = await pickup.validate({
      actorUserId: fx.otherMerchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.message).not.toMatch(/WK-S3A/);
    }

    const row = await prisma.pickupHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    await expect(
      prisma.pickupHandoffToken.create({
        data: {
          id: randomUUID(),
          tokenHash: row.tokenHash,
          purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
          status: PickupHandoffTokenStatus.REVOKED,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillmentId,
          merchantId: fx.merchant.id,
          riderId: fx.rider.id,
          riderAssignmentId: row.riderAssignmentId,
          assignmentVersion: row.assignmentVersion,
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: fx.rider.id,
        },
      }),
    ).rejects.toThrow(/Unique constraint|P2002/i);

    await expect(
      prisma.pickupHandoffToken.create({
        data: {
          id: randomUUID(),
          tokenHash: hashPickupSecret(generatePickupSecret()),
          purpose: PickupHandoffPurpose.MERCHANT_PICKUP_HANDOFF,
          status: PickupHandoffTokenStatus.ACTIVE,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillmentId,
          merchantId: fx.merchant.id,
          riderId: fx.rider.id,
          riderAssignmentId: row.riderAssignmentId,
          assignmentVersion: row.assignmentVersion,
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: fx.rider.id,
        },
      }),
    ).rejects.toThrow(/Unique constraint|P2002/i);
  });

  it('rejects rider spoof on issue', async () => {
    const fx = await seedReadyPickup();
    await expect(
      pickup.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.rider.id,
        riderId: fx.riderB.id,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RIDER_SPOOF_REJECTED' }),
    });
  });
});

describe('Stage 3A PostgreSQL environment gate', () => {
  it('requires .env.stage3.test for gated suite', () => {
    expect(STAGE3_ENV_PRESENT).toBe(true);
  });
});
