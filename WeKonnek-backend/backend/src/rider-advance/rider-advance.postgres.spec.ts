/**
 * Stage 4A PostgreSQL concurrency / integrity suite.
 * Requires backend/.env.stage4.test and database wekonnek_stage4_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage7_regression_test.
 * Does NOT fall back to stage0/stage1/stage2/stage3 databases.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE4_ENV_PRESENT = loadStageTestEnv('.env.stage4.test');

import { ConfigService } from '@nestjs/config';
import {
  CommerceDomain,
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
import { RiderAdvanceService } from './rider-advance.service';

const describeIf = STAGE4_ENV_PRESENT ? describe : describe.skip;

jest.setTimeout(180_000);

describeIf('Stage 4A Rider Advance PostgreSQL (wekonnek_stage4_test)', () => {
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
      database === 'wekonnek_stage4_test' && user === 'wekonnek_stage4_test';
    const okRegression =
      isCurrentSchemaRegressionMode() &&
      database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE &&
      (user === 'victor' || user === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE);
    if (!okHistorical && !okRegression) {
      throw new Error(
        `Stage 4 tests require wekonnek_stage4_test or stage7 regression identity; got database=${database} user=${user}`,
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
        email: `s4a-c-${tag}@test.invalid`,
        role: UserRole.customer,
      },
    });
    const rider = await prisma.user.create({
      data: {
        phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s4a-r-${tag}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const riderB = await prisma.user.create({
      data: {
        phone: `+6393${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s4a-rb-${tag}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+6394${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s4a-m-${tag}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S4A ${tag}`,
        slug: `s4a-${tag}`,
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
        orderCode: `WK-S4A-${tag.slice(0, 8)}`,
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
      const tokens = await prisma.pickupHandoffToken.findMany({
        where: { wkOrderId: order.id },
      });
      const custodyIds = tokens
        .map((t) => t.custodyEventId)
        .filter(Boolean) as string[];
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
      // RiderAdvance FKs block agreement_version delete — remove first.
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

  async function paymentSnapshot(orderId: number) {
    const order = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        paymentStatus: true,
        paymentMethod: true,
        paymentRef: true,
        merchantPaymentStatus: true,
        totalAmount: true,
        deliveryFee: true,
        transactionFeeAmount: true,
      },
    });
    const allocations = await prisma.orderPaymentAllocation.findMany({
      where: { wkOrderId: orderId },
      orderBy: { component: 'asc' },
    });
    const evidence = await prisma.merchantPaymentEvidence.findMany({
      where: { wkOrderId: orderId },
      orderBy: { createdAt: 'asc' },
    });
    return { order, allocations, evidence };
  }

  it('1) simultaneous customer authorization yields one active Rider Advance', async () => {
    const fx = await seed();
    const results = await Promise.allSettled([
      riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: '1000.00',
      }),
      riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: '1000.00',
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    const active = await prisma.riderAdvance.findMany({
      where: {
        wkOrderId: fx.order.id,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
    });
    expect(active).toHaveLength(1);
    const agreements = await prisma.agreement.findMany({
      where: { wkOrderId: fx.order.id, agreementType: 'RIDER_ADVANCE' },
    });
    expect(agreements).toHaveLength(1);
  });

  it('2) concurrent rider acceptance is idempotent (one accept evidence path)', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    const key = `accept-race-${fx.order.id}`;
    const results = await Promise.all([
      riderAdvance.accept({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.rider.id,
        idempotencyKey: key,
      }),
      riderAdvance.accept({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.rider.id,
        idempotencyKey: key,
      }),
    ]);
    expect(results.every((r) => r.riderAdvance.id === auth.riderAdvance.id)).toBe(
      true,
    );
    expect(
      results.filter((r) => r.riderAdvance.status === RiderAdvanceStatus.RIDER_ACCEPTED)
        .length,
    ).toBe(2);
    const row = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
    expect(row.status).toBe(RiderAdvanceStatus.RIDER_ACCEPTED);
    expect(row.assignmentVersion).toBe(fx.fulfillment.assignmentVersion);
    expect(row.riderId).toBe(fx.rider.id);
    const riderAccepts = await prisma.agreementAcceptance.findMany({
      where: {
        agreementVersionId: row.agreementVersionId,
        partyRole: 'RIDER',
      },
    });
    expect(riderAccepts).toHaveLength(1);
  });

  it('3) actual advance retry with same idempotency key is authoritative', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1100.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });
    const key = `rec-${fx.order.id}`;
    const a = await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
      actualAdvanceAmount: '980.00',
      idempotencyKey: key,
    });
    const b = await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
      actualAdvanceAmount: '980.00',
      idempotencyKey: key,
    });
    expect(b.idempotent).toBe(true);
    expect(b.riderAdvance.id).toBe(a.riderAdvance.id);
    const proofs = await prisma.agreementEvidence.findMany({
      where: {
        agreementId: auth.riderAdvance.agreementId,
        evidenceType: 'PAYMENT_PROOF',
      },
    });
    expect(proofs).toHaveLength(1);
  });

  it('4) maximum enforcement at app and PostgreSQL CHECK level', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });
    await expect(
      riderAdvance.recordAdvance({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.rider.id,
        actualAdvanceAmount: '1000.01',
      }),
    ).rejects.toThrow(/EXCEEDS_AUTHORIZED_MAXIMUM|exceeds authorized/i);
    const still = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
    expect(still.status).toBe(RiderAdvanceStatus.RIDER_ACCEPTED);
    expect(still.actualAdvanceAmount).toBeNull();

    // DB integrity: CHECK rejects over-max even via raw update
    await expect(
      prisma.$executeRaw`
        UPDATE "rider_advances"
        SET "actual_advance_amount" = 1000.01
        WHERE id = ${auth.riderAdvance.id}::uuid
      `,
    ).rejects.toThrow(/rider_advances_actual_lte_max_check|check constraint/i);

    const valid = await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
      actualAdvanceAmount: '980.00',
    });
    expect(valid.riderAdvance.actualAdvanceAmount?.toFixed(2)).toBe('980.00');
  });

  it('5) maximum amendment vs actual advance race keeps one consistent version', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });

    const results = await Promise.allSettled([
      riderAdvance.amendMaximum({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: '1200.00',
      }),
      riderAdvance.recordAdvance({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.rider.id,
        actualAdvanceAmount: '980.00',
      }),
    ]);

    const row = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
    const versions = await prisma.agreementVersion.findMany({
      where: { agreementId: row.agreementId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.length).toBeGreaterThanOrEqual(1);

    if (row.status === RiderAdvanceStatus.ADVANCE_RECORDED) {
      expect(row.actualAdvanceAmount!.lte(row.authorizedMaximumAmount)).toBe(
        true,
      );
      expect(Number(row.actualAdvanceAmount)).toBeLessThanOrEqual(
        Number(row.authorizedMaximumAmount),
      );
    } else if (row.status === RiderAdvanceStatus.CUSTOMER_AUTHORIZED) {
      // Amend won first and reset rider acceptance; record should have failed or not stuck
      expect(row.authorizedMaximumAmount.toFixed(2)).toBe('1200.00');
      expect(row.actualAdvanceAmount).toBeNull();
    } else if (row.status === RiderAdvanceStatus.RIDER_ACCEPTED) {
      // Amend may have failed after record path; still consistent
      expect(row.actualAdvanceAmount).toBeNull();
    }

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    // Never leave actual > authorized
    if (row.actualAdvanceAmount) {
      expect(row.actualAdvanceAmount.lte(row.authorizedMaximumAmount)).toBe(
        true,
      );
    }
  });

  it('6) actual advance vs reassignment race preserves history / denies stale rider', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });

    const results = await Promise.allSettled([
      riderAdvance.recordAdvance({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.rider.id,
        actualAdvanceAmount: '900.00',
      }),
      assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      }),
    ]);

    const row = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
    // Rider B never inherits Rider A acceptance as active authorization
    expect(row.riderId).toBe(fx.rider.id);

    if (row.status === RiderAdvanceStatus.CANCELLED) {
      expect(row.cancelReason).toMatch(/reassign/i);
      expect(row.actualAdvanceAmount).toBeNull();
    } else if (row.status === RiderAdvanceStatus.ADVANCE_RECORDED) {
      expect(row.actualAdvanceAmount?.toFixed(2)).toBe('900.00');
    } else if (row.status === RiderAdvanceStatus.DISPUTED) {
      expect(row.actualAdvanceAmount).not.toBeNull();
    }

    // Stale rider cannot record again after cancel/reassign
    if (row.status === RiderAdvanceStatus.CANCELLED) {
      await expect(
        riderAdvance.recordAdvance({
          riderAdvanceId: auth.riderAdvance.id,
          actorUserId: fx.rider.id,
          actualAdvanceAmount: '900.00',
        }),
      ).rejects.toThrow();
    }

    expect(results.length).toBe(2);
  });

  it('7) cancellation before vs racing with actual advance', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });

    // Before expenditure: cancel clears obligation
    const cancelBefore = await riderAdvance.cancel({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.customer.id,
      reason: 'cancelled_before_advance',
    });
    expect(cancelBefore.preservedObligation).toBe(false);
    expect(cancelBefore.riderAdvance.status).toBe(RiderAdvanceStatus.CANCELLED);
    expect(cancelBefore.riderAdvance.reimbursementPrincipal).toBeNull();

    // Race on second fixture
    const fx2 = await seed();
    const auth2 = await riderAdvance.authorize({
      wkOrderId: fx2.order.id,
      actorUserId: fx2.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth2.riderAdvance.id,
      actorUserId: fx2.rider.id,
    });
    await Promise.allSettled([
      riderAdvance.recordAdvance({
        riderAdvanceId: auth2.riderAdvance.id,
        actorUserId: fx2.rider.id,
        actualAdvanceAmount: '850.00',
      }),
      riderAdvance.cancel({
        riderAdvanceId: auth2.riderAdvance.id,
        actorUserId: fx2.customer.id,
        reason: 'cancel_race',
      }),
    ]);
    const raced = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth2.riderAdvance.id },
    });
    if (raced.status === RiderAdvanceStatus.CANCELLED) {
      expect(raced.actualAdvanceAmount).toBeNull();
      expect(raced.reimbursementPrincipal).toBeNull();
    } else if (
      raced.status === RiderAdvanceStatus.ADVANCE_RECORDED ||
      raced.status === RiderAdvanceStatus.DISPUTED
    ) {
      // Expenditure (or cancel-after) preserved amount; no destructive delete
      expect(raced.actualAdvanceAmount?.toFixed(2) ?? null).not.toBeNull();
      const stillThere = await prisma.riderAdvance.findUnique({
        where: { id: auth2.riderAdvance.id },
      });
      expect(stillThere).not.toBeNull();
    }
  });

  it('8–12) vendor ack concurrency, mismatch, principal, duplicate obligation, post-cancel', async () => {
    const fx = await seed();
    const beforePay = await paymentSnapshot(fx.order.id);
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
      actualAdvanceAmount: '980.00',
    });

    const key = `ack-${fx.order.id}`;
    const [a, b] = await Promise.all([
      riderAdvance.vendorAcknowledge({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.merchantUser.id,
        acknowledgedAmount: '980.00',
        idempotencyKey: key,
      }),
      riderAdvance.vendorAcknowledge({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.merchantUser.id,
        acknowledgedAmount: '980.00',
        idempotencyKey: key,
      }),
    ]);
    expect(a.mismatch || b.mismatch).toBe(false);
    const due = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: auth.riderAdvance.id },
    });
    expect(due.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    expect(due.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
    expect(due.authorizedMaximumAmount.toFixed(2)).toBe('1100.00');
    expect(due.actualAdvanceAmount?.toFixed(2)).toBe('980.00');

    const dueEvents = await prisma.orderDomainEvent.findMany({
      where: {
        wkOrderId: fx.order.id,
        action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
      },
    });
    expect(dueEvents).toHaveLength(1);

    const afterPay = await paymentSnapshot(fx.order.id);
    expect(afterPay.order).toEqual(beforePay.order);
    expect(afterPay.allocations).toEqual(beforePay.allocations);
    expect(afterPay.evidence).toEqual(beforePay.evidence);

    // Post-advance cancellation preserves obligation
    await prisma.wkOrder.update({
      where: { id: fx.order.id },
      data: { status: 'cancelled' },
    });
    const cancelAfter = await riderAdvance.cancel({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.customer.id,
      reason: 'order_cancelled_after_ack',
    });
    expect(cancelAfter.preservedObligation).toBe(true);
    expect(cancelAfter.riderAdvance.status).toBe(RiderAdvanceStatus.DISPUTED);
    expect(cancelAfter.riderAdvance.reimbursementPrincipal?.toFixed(2)).toBe(
      '980.00',
    );
    expect(cancelAfter.riderAdvance.actualAdvanceAmount?.toFixed(2)).toBe(
      '980.00',
    );

    // Mismatch path on separate order
    const fx2 = await seed();
    const auth2 = await riderAdvance.authorize({
      wkOrderId: fx2.order.id,
      actorUserId: fx2.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth2.riderAdvance.id,
      actorUserId: fx2.rider.id,
    });
    await riderAdvance.recordAdvance({
      riderAdvanceId: auth2.riderAdvance.id,
      actorUserId: fx2.rider.id,
      actualAdvanceAmount: '1000.00',
    });
    const mismatch = await riderAdvance.vendorAcknowledge({
      riderAdvanceId: auth2.riderAdvance.id,
      actorUserId: fx2.merchantUser.id,
      acknowledgedAmount: '950.00',
    });
    expect(mismatch.mismatch).toBe(true);
    expect(mismatch.riderAdvance.status).toBe(RiderAdvanceStatus.DISPUTED);
    expect(mismatch.riderAdvance.actualAdvanceAmount?.toFixed(2)).toBe(
      '1000.00',
    );
    expect(mismatch.riderAdvance.reimbursementPrincipal).toBeNull();
  });

  it('13) agreement/evidence immutability and no silent rider party rewrite', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    const v1 = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: auth.riderAdvance.agreementVersionId },
    });
    const snap1 = JSON.stringify(v1.termsSnapshot);
    const hash1 = v1.termsHash;

    await riderAdvance.amendMaximum({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1150.00',
    });
    const v1After = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: v1.id },
    });
    expect(JSON.stringify(v1After.termsSnapshot)).toBe(snap1);
    expect(v1After.termsHash).toBe(hash1);
    expect(v1After.status).toBe('SUPERSEDED');

    const versions = await prisma.agreementVersion.findMany({
      where: { agreementId: auth.riderAdvance.agreementId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[1].versionNumber).toBe(2);

    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
    });
    const evidenceBefore = await prisma.agreementEvidence.count({
      where: { agreementId: auth.riderAdvance.agreementId },
    });
    await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: fx.rider.id,
      actualAdvanceAmount: '900.00',
    });
    const evidenceAfter = await prisma.agreementEvidence.count({
      where: { agreementId: auth.riderAdvance.agreementId },
    });
    expect(evidenceAfter).toBeGreaterThan(evidenceBefore);

    const parties = await prisma.agreementParty.findMany({
      where: { agreementId: auth.riderAdvance.agreementId },
    });
    const riderParty = parties.find((p) => p.role === 'RIDER');
    expect(riderParty?.userId).toBe(fx.rider.id);

    await assignments.assign({
      fulfillmentId: fx.fulfillment.id,
      riderId: fx.riderB.id,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
    });
    const partiesAfter = await prisma.agreementParty.findMany({
      where: { agreementId: auth.riderAdvance.agreementId },
    });
    expect(partiesAfter.find((p) => p.role === 'RIDER')?.userId).toBe(
      fx.rider.id,
    );
  });

  it('14–15) Stage 3 pickup guard for RA orders; non-RA pickup unchanged', async () => {
    // Non-RA
    const nonRa = await seed({ allowRA: false });
    const issued = await pickup.issueForOrder({
      wkOrderId: nonRa.order.id,
      actorUserId: nonRa.rider.id,
    });
    const confirmed = await pickup.confirm({
      actorUserId: nonRa.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.fulfillmentStatus).toBe('picked_up');
    }

    // RA before vendor ack — deny confirm
    const ra = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: ra.order.id,
      actorUserId: ra.customer.id,
      maximumAuthorizedAdvance: '1000.00',
    });
    await riderAdvance.accept({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: ra.rider.id,
    });
    await riderAdvance.recordAdvance({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: ra.rider.id,
      actualAdvanceAmount: '1000.00',
    });
    const issuedRa = await pickup.issueForOrder({
      wkOrderId: ra.order.id,
      actorUserId: ra.rider.id,
    });
    const denied = await pickup.confirm({
      actorUserId: ra.merchantUser.id,
      qrPayload: issuedRa.qrPayload,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe('RIDER_ADVANCE_VENDOR_ACK_REQUIRED');
    }
    expect(
      (await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: ra.fulfillment.id },
      })).status,
    ).toBe('rider_assigned');

    // After vendor ack — allow
    await riderAdvance.vendorAcknowledge({
      riderAdvanceId: auth.riderAdvance.id,
      actorUserId: ra.merchantUser.id,
      acknowledgedAmount: '1000.00',
    });
    // Prior token may still be ACTIVE; re-issue or reuse
    const tokenStill = await prisma.pickupHandoffToken.findUniqueOrThrow({
      where: { id: issuedRa.tokenId },
    });
    expect(tokenStill.status).toBe('ACTIVE');
    const allowed = await pickup.confirm({
      actorUserId: ra.merchantUser.id,
      qrPayload: issuedRa.qrPayload,
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.fulfillmentStatus).toBe('picked_up');
    }
  });

  it('16) schema invariants present on wekonnek_stage4_test', async () => {
    const checks = await prisma.$queryRaw<
      Array<{ conname: string }>
    >`SELECT conname FROM pg_constraint WHERE conrelid = 'rider_advances'::regclass AND contype = 'c'`;
    const names = checks.map((c) => c.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        'rider_advances_actual_lte_max_check',
        'rider_advances_authorized_maximum_nonneg_check',
        'rider_advances_actual_nonneg_check',
        'rider_advances_vendor_ack_nonneg_check',
      ]),
    );
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'rider_advances'
        AND indexname = 'rider_advances_active_wk_order_id_key'
    `;
    expect(idx).toHaveLength(1);
  });

  it('authorizes happy path and denies when Allow Rider Advance is OFF', async () => {
    const fx = await seed();
    const auth = await riderAdvance.authorize({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      maximumAuthorizedAdvance: '1050.00',
      idempotencyKey: `auth-${fx.order.id}`,
    });
    expect(auth.riderAdvance.status).toBe(RiderAdvanceStatus.CUSTOMER_AUTHORIZED);

    const fxOff = await seed({ allowRA: false });
    await expect(
      riderAdvance.authorize({
        wkOrderId: fxOff.order.id,
        actorUserId: fxOff.customer.id,
        maximumAuthorizedAdvance: '1000.00',
      }),
    ).rejects.toThrow(/RIDER_ADVANCE_DISABLED|not enabled/i);
  });
});

describe('Stage 4A PostgreSQL environment gate', () => {
  it('requires .env.stage4.test for database-backed acceptance', () => {
    expect(STAGE4_ENV_PRESENT).toBe(true);
  });
});
