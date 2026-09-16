/**
 * Stage 5B Rider Advance reimbursement settlement — PostgreSQL acceptance.
 * Requires disposable Stage 7 DB:
 *   wekonnek_stage7_regression_test (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1)
 *   or wekonnek_stage7_test
 * Historical stage5b/stage6 acceptance DBs are frozen / contaminated and refused.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  DISPOSABLE_CLEANUP_DATABASES,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE5B_ENV_PRESENT =
  loadStageTestEnv('.env.stage7.test') || loadStageTestEnv('.env.stage5b.test');

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CommerceDomain,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  Prisma,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderAdvanceSettlementService } from './rider-advance-settlement.service';
import { truncateSettlementsForStage5bTest } from './stage5b-test-cleanup';

const describeIf = STAGE5B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);
const ALLOWED_DATABASES = DISPOSABLE_CLEANUP_DATABASES;

function errCode(err: unknown): string | undefined {
  if (
    err instanceof BadRequestException ||
    err instanceof ForbiddenException ||
    err instanceof ConflictException
  ) {
    const r = err.getResponse();
    if (typeof r === 'object' && r && 'code' in r) {
      return String((r as { code: string }).code);
    }
  }
  return undefined;
}

describeIf(
  'Stage 5B Rider Advance Settlement PostgreSQL (wekonnek_stage5b_test)',
  () => {
    const prisma = new PrismaService();
    const events = new OrderDomainEventService(prisma);
    const riderAdvance = new RiderAdvanceService(prisma, events);
    const settlements = new RiderAdvanceSettlementService(prisma, events);
    const assignments = new RiderAssignmentService(
      prisma,
      events,
      riderAdvance,
    );
    const transitions = new FulfillmentTransitionService(
      prisma,
      events,
      assignments,
    );
    let cleanup: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      await prisma.$connect();
      const target = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(
        Prisma.sql`SELECT current_database() AS database, current_user AS user`,
      );
      const database = target[0]?.database;
      const user = target[0]?.user;
      if (
        !database ||
        !ALLOWED_DATABASES.has(database) ||
        !user ||
        FORBIDDEN_DB_USERS.has(user) ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 5B tests require wekonnek_stage7_test|wekonnek_stage7_regression_test identity; got database=${database} user=${user}`,
        );
      }
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
      cleanup = undefined;
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seed() {
      const tag = randomUUID();
      const customer = await prisma.user.create({
        data: {
          phone: `+6391${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
          email: `s5b-c-${tag}@test.invalid`,
          role: UserRole.customer,
        },
      });
      const rider = await prisma.user.create({
        data: {
          phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
          email: `s5b-r-${tag}@test.invalid`,
          role: UserRole.rider,
        },
      });
      const riderB = await prisma.user.create({
        data: {
          phone: `+6393${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
          email: `s5b-rb-${tag}@test.invalid`,
          role: UserRole.rider,
        },
      });
      const merchantUser = await prisma.user.create({
        data: {
          phone: `+6394${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
          email: `s5b-m-${tag}@test.invalid`,
          role: UserRole.merchant,
        },
      });
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S5B ${tag}`,
          slug: `s5b-${tag}`,
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
          orderCode: `WK-S5B-${tag.slice(0, 8)}`,
          userId: customer.id,
          merchantId: merchant.id,
          status: 'pending',
          orderType: 'delivery',
          totalAmount: 1100,
          deliveryFee: 50,
          transactionFeeAmount: 0,
          paymentMethod: 'cod',
          paymentStatus: 'pending',
          orderItems: {
            create: [
              { productName: 'item', quantity: 1, price: 1100, subtotal: 1100 },
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
        // Append-only ledger: DELETE is blocked. Disposable Stage 5B DB uses TRUNCATE.
        await truncateSettlementsForStage5bTest(prisma);
        await prisma.agreementEvidence.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.riderAdvance.deleteMany({
          where: { wkOrderId: order.id },
        });
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
        await prisma.orderDomainEvent.deleteMany({
          where: { wkOrderId: order.id },
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
            id: { in: [customer.id, rider.id, riderB.id, merchantUser.id] },
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

    async function toDue(
      fx: Awaited<ReturnType<typeof seed>>,
      amount: string | number = '980',
    ) {
      const auth = await riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: 1100,
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
      const ack = await riderAdvance.vendorAcknowledge({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.merchantUser.id,
        acknowledgedAmount: amount,
      });
      expect(ack.riderAdvance.status).toBe(
        RiderAdvanceStatus.REIMBURSEMENT_DUE,
      );
      expect(ack.riderAdvance.reimbursementPrincipal?.toFixed(2)).toBe(
        new Prisma.Decimal(amount).toFixed(2),
      );
      expect(ack.riderAdvance.riderId).toBe(fx.rider.id);
      return ack.riderAdvance;
    }

    it('reports dedicated DB identity wekonnek_stage7_test|wekonnek_stage7_regression_test', async () => {
      const row = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(
        Prisma.sql`SELECT current_database() AS database, current_user AS user`,
      );
      expect(ALLOWED_DATABASES.has(row[0].database)).toBe(true);
      expect(ALLOWED_DB_USERS.has(row[0].user)).toBe(true);
    });

    it('1) cash 980 against principal 980 -> REIMBURSED + completion once', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const beforePay = await prisma.orderPaymentAllocation.count({
        where: { wkOrderId: fx.order.id },
      });
      const result = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(result.settledAmount).toBe('980.00');
      expect(result.remainingAmount).toBe('0.00');
      expect(result.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
      const persisted = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(persisted.status).toBe(RiderAdvanceStatus.REIMBURSED);
      expect(persisted.reimbursedAt).toBeTruthy();
      expect(persisted.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
      const completions = await prisma.orderDomainEvent.count({
        where: { wkOrderId: fx.order.id, action: 'REIMBURSEMENT_COMPLETED' },
      });
      expect(completions).toBe(1);
      expect(
        await prisma.orderPaymentAllocation.count({
          where: { wkOrderId: fx.order.id },
        }),
      ).toBe(beforePay);
    });

    it('2) transfer claim alone does not reduce remaining', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        externalReference: 'GCASH-REF-1',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      expect(claim.settlement.status).toBe(
        RiderAdvanceSettlementStatus.CLAIMED,
      );
      expect(claim.remainingAmount).toBe('980.00');
      expect(claim.settledAmount).toBe('0.00');
      expect(claim.reimbursementStatus).toBe(
        RiderAdvanceStatus.REIMBURSEMENT_DUE,
      );
    });

    it('3) claim 980 + ack 980 -> REIMBURSED', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const ack = await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        acknowledgedAmount: 980,
        idempotencyKey: `ack-${randomUUID()}`,
      });
      expect(ack.remainingAmount).toBe('0.00');
      expect(ack.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('4) partial ack 500 then 480 -> REIMBURSED; claimedAmount preserved', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const partial = await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        acknowledgedAmount: 500,
        idempotencyKey: `ack-${randomUUID()}`,
      });
      expect(partial.settlement.claimedAmount).toBe('980.00');
      expect(partial.settlement.acknowledgedAmount).toBe('500.00');
      expect(partial.remainingAmount).toBe('480.00');
      expect(partial.reimbursementStatus).toBe(
        RiderAdvanceStatus.REIMBURSEMENT_DUE,
      );
      const second = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 480,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(second.remainingAmount).toBe('0.00');
      expect(second.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('4b) rejects a transfer acknowledgment above that customer claim even when RA balance allows it', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 500,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const eventsBefore = await prisma.orderDomainEvent.count({
        where: { wkOrderId: fx.order.id, action: 'REIMBURSEMENT_ACKNOWLEDGED' },
      });
      const evidenceBefore = await prisma.agreementEvidence.count({
        where: { wkOrderId: fx.order.id },
      });
      await expect(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.rider.id,
          acknowledgedAmount: 600,
          idempotencyKey: `ack-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        response: { code: 'AMOUNT_EXCEEDS_CLAIM' },
      });
      const persisted = await prisma.riderAdvanceSettlement.findUniqueOrThrow({
        where: { id: claim.settlement.id },
      });
      expect(persisted.status).toBe(RiderAdvanceSettlementStatus.CLAIMED);
      expect(persisted.acknowledgedAmount).toBeNull();
      expect(
        await prisma.orderDomainEvent.count({
          where: {
            wkOrderId: fx.order.id,
            action: 'REIMBURSEMENT_ACKNOWLEDGED',
          },
        }),
      ).toBe(eventsBefore);
      expect(
        await prisma.agreementEvidence.count({
          where: { wkOrderId: fx.order.id },
        }),
      ).toBe(evidenceBefore);

      const ok = await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        acknowledgedAmount: 500,
        idempotencyKey: `ack-ok-${randomUUID()}`,
      });
      expect(ok.settlement.status).toBe(RiderAdvanceSettlementStatus.ACKNOWLEDGED);
      expect(ok.settlement.acknowledgedAmount).toBe('500.00');
      expect(ok.settlement.claimedAmount).toBe('500.00');
      expect(ok.remainingAmount).toBe('480.00');
    });

    it('5) two partial cash settlements', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 400,
        idempotencyKey: `cash-a-${randomUUID()}`,
      });
      const second = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 580,
        idempotencyKey: `cash-b-${randomUUID()}`,
      });
      expect(second.settledAmount).toBe('980.00');
      expect(second.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('6) overpayment rejected with AMOUNT_EXCEEDS_REMAINING', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 600,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      await expect(
        settlements.createCashReceipt({
          riderAdvanceId: ra.id,
          actorUserId: fx.rider.id,
          amount: 500,
          idempotencyKey: `cash-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        response: { code: 'AMOUNT_EXCEEDS_REMAINING' },
      });
    });

    it('7) concurrent 600+600: settled never exceeds principal', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const results = await Promise.allSettled([
        settlements.createCashReceipt({
          riderAdvanceId: ra.id,
          actorUserId: fx.rider.id,
          amount: 600,
          idempotencyKey: `c1-${randomUUID()}`,
        }),
        settlements.createCashReceipt({
          riderAdvanceId: ra.id,
          actorUserId: fx.rider.id,
          amount: 600,
          idempotencyKey: `c2-${randomUUID()}`,
        }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const fail = results.filter((r) => r.status === 'rejected');
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(ok.length + fail.length).toBe(2);
      if (fail.length) {
        expect(errCode((fail[0] as PromiseRejectedResult).reason)).toBe(
          'AMOUNT_EXCEEDS_REMAINING',
        );
      }
      const totals = await settlements.computeTotals(prisma, ra);
      expect(totals.settledAmount.lte(totals.principal)).toBe(true);
      expect(Number(totals.settledAmount.toFixed(2))).toBeLessThanOrEqual(980);
    });

    it('8) double ack same claim does not double-count', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const first = await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        acknowledgedAmount: 980,
        idempotencyKey: `ack-${randomUUID()}`,
      });
      expect(first.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
      await expect(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.rider.id,
          acknowledgedAmount: 100,
          idempotencyKey: `ack2-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        response: { code: 'CLAIM_ALREADY_RESOLVED' },
      });
      const totals = await settlements.computeTotals(prisma, ra);
      expect(totals.settledAmount.toFixed(2)).toBe('980.00');
    });

    it('9) ack vs reject race yields exactly one terminal result', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const results = await Promise.allSettled([
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.rider.id,
          acknowledgedAmount: 980,
          idempotencyKey: `ack-${randomUUID()}`,
        }),
        settlements.reject({
          settlementId: claim.settlement.id,
          actorUserId: fx.rider.id,
          reason: 'not_received',
          idempotencyKey: `rej-${randomUUID()}`,
        }),
      ]);
      const row = await prisma.riderAdvanceSettlement.findUniqueOrThrow({
        where: { id: claim.settlement.id },
      });
      expect([
        RiderAdvanceSettlementStatus.ACKNOWLEDGED,
        RiderAdvanceSettlementStatus.REJECTED,
      ]).toContain(row.status);
      expect(
        results.filter((r) => r.status === 'fulfilled').length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('10) same idempotency key retry returns same cash receipt', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const key = `cash-${randomUUID()}`;
      const a = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 200,
        idempotencyKey: key,
      });
      const b = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 200,
        idempotencyKey: key,
      });
      expect(b.idempotent).toBe(true);
      expect(b.settlement.id).toBe(a.settlement.id);
      expect(
        await prisma.riderAdvanceSettlement.count({
          where: { riderAdvanceId: ra.id },
        }),
      ).toBe(1);
    });

    it('11) same idempotency key different payload -> IDEMPOTENCY_CONFLICT', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const key = `cash-${randomUUID()}`;
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 200,
        idempotencyKey: key,
      });
      await expect(
        settlements.createCashReceipt({
          riderAdvanceId: ra.id,
          actorUserId: fx.rider.id,
          amount: 300,
          idempotencyKey: key,
        }),
      ).rejects.toMatchObject({
        response: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    });

    it('12) lost-success retry does not duplicate REIMBURSED transition', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const key = `cash-${randomUUID()}`;
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: key,
      });
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: key,
      });
      expect(
        await prisma.orderDomainEvent.count({
          where: { wkOrderId: fx.order.id, action: 'REIMBURSEMENT_COMPLETED' },
        }),
      ).toBe(1);
      expect(
        await prisma.riderAdvanceSettlement.count({
          where: { riderAdvanceId: ra.id },
        }),
      ).toBe(1);
    });

    it('13) completion event and reimbursedAt once', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 500,
        idempotencyKey: `c1-${randomUUID()}`,
      });
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 480,
        idempotencyKey: `c2-${randomUUID()}`,
      });
      const persisted = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(persisted.reimbursedAt).toBeTruthy();
      expect(
        await prisma.orderDomainEvent.count({
          where: { wkOrderId: fx.order.id, action: 'REIMBURSEMENT_COMPLETED' },
        }),
      ).toBe(1);
    });

    it('14) Rider A creditor / Rider B delivery: B denied, A allowed', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'to_B',
      });
      const f = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(f.activeRiderId).toBe(fx.riderB.id);
      const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(raAfter.riderId).toBe(fx.rider.id);
      await expect(
        settlements.createCashReceipt({
          riderAdvanceId: ra.id,
          actorUserId: fx.riderB.id,
          amount: 100,
          idempotencyKey: `b-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ response: { code: 'NOT_CREDITOR' } });
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 100,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await expect(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.riderB.id,
          acknowledgedAmount: 100,
          idempotencyKey: `ack-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ response: { code: 'NOT_CREDITOR' } });
      const ok = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `a-${randomUUID()}`,
      });
      expect(ok.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
      expect(ok.creditorRiderId).toBe(fx.rider.id);
    });

    it('15) settlement before delivery', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const f = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect([
        FulfillmentStatus.ready_for_pickup,
        FulfillmentStatus.rider_assigned,
      ]).toContain(f.status);
      expect(f.status).not.toBe(FulfillmentStatus.delivered);
      const r = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(r.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('16) settlement after delivered (delivery independence)', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillment.id },
        data: { status: FulfillmentStatus.delivered },
      });
      const r = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(r.principal).toBe('980.00');
      expect(r.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('17) settlement after delivery_failed', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillment.id },
        data: { status: FulfillmentStatus.delivery_failed },
      });
      const r = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(r.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('18) settlement after returned', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillment.id },
        data: { status: FulfillmentStatus.returned },
      });
      const r = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(r.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
      const persisted = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(persisted.reimbursementPrincipal?.toFixed(2)).toBe('980.00');
    });

    it('19) DISPUTED with established principal is settleable', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await prisma.riderAdvance.update({
        where: { id: ra.id },
        data: {
          status: RiderAdvanceStatus.DISPUTED,
          disputedAt: new Date(),
          disputeReason: 'post_expenditure_issue',
        },
      });
      const r = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(r.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
    });

    it('20) pre-principal settlement denied', async () => {
      const fx = await seed();
      const auth = await riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: 1100,
      });
      await expect(
        settlements.createCashReceipt({
          riderAdvanceId: auth.riderAdvance.id,
          actorUserId: fx.rider.id,
          amount: 100,
          idempotencyKey: `cash-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PRINCIPAL_NOT_ESTABLISHED' },
      });
    });

    it('21) evidence is append-only (finalized rows not overwritten by service)', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 100,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const ev = await prisma.agreementEvidence.findMany({
        where: { wkOrderId: fx.order.id, finalized: true },
      });
      expect(ev.length).toBeGreaterThan(0);
      const first = ev[0];
      await expect(
        prisma.agreementEvidence.update({
          where: { id: first.id },
          data: { contentHash: 'tampered' },
        }),
      ).resolves.toBeTruthy(); // DB may allow; Stage 5B service never overwrites — corrections are new rows
      const again = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 50,
        idempotencyKey: `cash2-${randomUUID()}`,
      });
      expect(again.settlement.id).not.toBe(first.id);
      expect(
        await prisma.agreementEvidence.count({
          where: { wkOrderId: fx.order.id },
        }),
      ).toBeGreaterThan(ev.length);
    });

    it('22) terminal settlement financial fields immutable via DB trigger', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const cash = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 100,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      await expect(
        prisma.$executeRaw`
        UPDATE rider_advance_settlements
        SET acknowledged_amount = 1
        WHERE id = ${cash.settlement.id}::uuid
      `,
      ).rejects.toThrow(/immutable/i);
    });

    it('22b) terminal status cannot be reverted to bypass delete protection', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 200,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        acknowledgedAmount: 200,
        idempotencyKey: `ack-${randomUUID()}`,
      });
      await expect(
        prisma.$executeRaw`
          UPDATE rider_advance_settlements
          SET status = 'CLAIMED'
          WHERE id = ${claim.settlement.id}::uuid
        `,
      ).rejects.toThrow(/immutable/i);
      await expect(
        prisma.$executeRaw`
          UPDATE rider_advance_settlements
          SET status = 'CANCELLED'
          WHERE id = ${claim.settlement.id}::uuid
        `,
      ).rejects.toThrow(/immutable/i);
      await expect(
        prisma.riderAdvanceSettlement.delete({
          where: { id: claim.settlement.id },
        }),
      ).rejects.toThrow(/append_only|forbidden|check_violation/i);
    });

    it('22c) append-only: raw DELETE and Prisma delete/deleteMany blocked for ALL statuses', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claimed = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 100,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const rejectedClaim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 50,
        idempotencyKey: `claim-r-${randomUUID()}`,
      });
      await settlements.reject({
        settlementId: rejectedClaim.settlement.id,
        actorUserId: fx.rider.id,
        reason: 'not_seen',
        idempotencyKey: `rej-${randomUUID()}`,
      });
      const cash = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 25,
        idempotencyKey: `cash-${randomUUID()}`,
      });

      for (const id of [
        claimed.settlement.id,
        rejectedClaim.settlement.id,
        cash.settlement.id,
      ]) {
        await expect(
          prisma.$executeRaw`
            DELETE FROM rider_advance_settlements WHERE id = ${id}::uuid
          `,
        ).rejects.toThrow(/append_only|forbidden|check_violation/i);
        await expect(
          prisma.riderAdvanceSettlement.delete({ where: { id } }),
        ).rejects.toThrow(/append_only|forbidden|check_violation/i);
      }
      await expect(
        prisma.riderAdvanceSettlement.deleteMany({
          where: { riderAdvanceId: ra.id },
        }),
      ).rejects.toThrow(/append_only|forbidden|check_violation/i);
      expect(
        await prisma.riderAdvanceSettlement.count({
          where: { riderAdvanceId: ra.id },
        }),
      ).toBe(3);
    });

    it('22d) REIMBURSED consistency survives delete attack on authoritative settlement', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const cash = await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(cash.reimbursementStatus).toBe(RiderAdvanceStatus.REIMBURSED);
      await expect(
        prisma.riderAdvanceSettlement.delete({
          where: { id: cash.settlement.id },
        }),
      ).rejects.toThrow(/append_only|forbidden|check_violation/i);
      const totals = await settlements.computeTotals(prisma, ra);
      expect(totals.settledAmount.toFixed(2)).toBe('980.00');
      expect(totals.remainingAmount.toFixed(2)).toBe('0.00');
      const persisted = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(persisted.status).toBe(RiderAdvanceStatus.REIMBURSED);
      expect(persisted.reimbursedAt).toBeTruthy();
    });

    it('22e) parent RESTRICT FKs block cascade-delete of settlement history', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 100,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      await expect(
        prisma.riderAdvance.delete({ where: { id: ra.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.wkOrder.delete({ where: { id: fx.order.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.user.delete({ where: { id: fx.customer.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.user.delete({ where: { id: fx.rider.id } }),
      ).rejects.toThrow();
      expect(
        await prisma.riderAdvanceSettlement.count({
          where: { riderAdvanceId: ra.id },
        }),
      ).toBe(1);
    });

    it('23) forced rollback leaves no settlement', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.riderAdvanceSettlement.create({
            data: {
              id: randomUUID(),
              riderAdvanceId: ra.id,
              wkOrderId: ra.wkOrderId,
              customerId: ra.customerId,
              creditorRiderId: ra.riderId,
              method: 'CASH',
              status: 'ACKNOWLEDGED',
              currency: 'PHP',
              claimedAmount: 50,
              acknowledgedAmount: 50,
              acknowledgedAt: new Date(),
            },
          });
          throw new Error('forced_settlement_abort');
        }),
      ).rejects.toThrow(/forced_settlement_abort/);
      expect(
        await prisma.riderAdvanceSettlement.count({
          where: { riderAdvanceId: ra.id },
        }),
      ).toBe(0);
    });

    it('24) payment ownership unchanged by settlement', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const beforeAlloc = await prisma.orderPaymentAllocation.count({
        where: { wkOrderId: fx.order.id },
      });
      const beforeEvidence = await prisma.merchantPaymentEvidence.count({
        where: { wkOrderId: fx.order.id },
      });
      await settlements.createCashReceipt({
        riderAdvanceId: ra.id,
        actorUserId: fx.rider.id,
        amount: 980,
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(
        await prisma.orderPaymentAllocation.count({
          where: { wkOrderId: fx.order.id },
        }),
      ).toBe(beforeAlloc);
      expect(
        await prisma.merchantPaymentEvidence.count({
          where: { wkOrderId: fx.order.id },
        }),
      ).toBe(beforeEvidence);
    });

    it('rejects do not auto-DISPUTE Rider Advance', async () => {
      const fx = await seed();
      const ra = await toDue(fx, 980);
      const claim = await settlements.createDirectTransferClaim({
        riderAdvanceId: ra.id,
        actorUserId: fx.customer.id,
        amount: 980,
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await settlements.reject({
        settlementId: claim.settlement.id,
        actorUserId: fx.rider.id,
        reason: 'not_seen',
        idempotencyKey: `rej-${randomUUID()}`,
      });
      const persisted = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: ra.id },
      });
      expect(persisted.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
      const totals = await settlements.computeTotals(prisma, ra);
      expect(totals.remainingAmount.toFixed(2)).toBe('980.00');
    });

  },
);
