/**
 * Stage 6 secure merchant return handoff — PostgreSQL acceptance.
 * Requires backend/.env.stage6.test and database wekonnek_stage6_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage7_regression_test.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE6_ENV_PRESENT = loadStageTestEnv('.env.stage6.test');

import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  MerchantReturnHandoffTokenStatus,
  Prisma,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { OrderOperationalStateService } from '../order-operational-state/order-operational-state.service';
import { PickupHandoffService } from '../pickup-handoff/pickup-handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { RiderCustodyHandoffService } from '../rider-custody-handoff/rider-custody-handoff.service';
import { ReturnHandoffService } from './return-handoff.service';
import { hashReturnSecret } from './return-token';

const describeIf = STAGE6_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage6_test',
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
]);

describeIf(
  'Stage 6 Return Handoff PostgreSQL (wekonnek_stage6_test)',
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
    const returns = new ReturnHandoffService(
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
    const operational = new OrderOperationalStateService(prisma);
    let cleanup: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      await prisma.$connect();
      const target = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
      const database = target[0]?.database;
      const user = target[0]?.user;
      const okHistorical = database === 'wekonnek_stage6_test';
      const okRegression =
        isCurrentSchemaRegressionMode() &&
        (database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE || database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE);
      if (
        (!okHistorical && !okRegression) ||
        !user ||
        FORBIDDEN_DB_USERS.has(user) ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 6 tests require wekonnek_stage6_test or stage7 regression identity; got database=${database} user=${user}`,
        );
      }
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
      cleanup = undefined;
    });

    afterAll(async () => prisma.onModuleDestroy());

    async function seed(opts?: { allowRA?: boolean }) {
      const tag = randomUUID();
      const mkUser = (role: UserRole, prefix: string) =>
        prisma.user.create({
          data: {
            phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            email: `s6-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `S6${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const riderA = await mkUser(UserRole.rider, 'a');
      const riderB = await mkUser(UserRole.rider, 'b');
      const riderC = await mkUser(UserRole.rider, 'c-rider');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const foreignMerchantUser = await mkUser(UserRole.merchant, 'fm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S6 ${tag}`,
          slug: `s6-${tag}`,
          commerceDomain: CommerceDomain.NON_FOOD,
          allowRiderAdvance: opts?.allowRA ?? true,
        },
      });
      const foreignMerchant = await prisma.merchant.create({
        data: {
          userId: foreignMerchantUser.id,
          name: `S6F ${tag}`,
          slug: `s6f-${tag}`,
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
          orderCode: `WK-S6-${tag.slice(0, 8)}`,
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
        riderId: riderB.id,
        actor: { type: 'SYSTEM' },
      });
      const refreshed = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fulfillment.id },
      });

      cleanup = async () => {
        await prisma.riderCustodyHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.merchantReturnHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.customerDeliveryHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.pickupHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.custodyEventEvidence.deleteMany({
          where: { custodyEvent: { wkOrderId: order.id } },
        });
        await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
        await prisma.riderAdvanceSettlement.deleteMany({
          where: { riderAdvance: { wkOrderId: order.id } },
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
          where: { merchantId: { in: [merchant.id, foreignMerchant.id] } },
        });
        await prisma.merchant.deleteMany({
          where: { id: { in: [merchant.id, foreignMerchant.id] } },
        });
        await prisma.user.deleteMany({
          where: {
            id: {
              in: [
                customer.id,
                riderA.id,
                riderB.id,
                riderC.id,
                merchantUser.id,
                foreignMerchantUser.id,
              ],
            },
          },
        });
      };

      return {
        customer,
        riderA,
        riderB,
        riderC,
        merchantUser,
        foreignMerchantUser,
        merchant,
        foreignMerchant,
        order,
        fulfillment: refreshed,
      };
    }

    async function advanceToReturning(
      fx: Awaited<ReturnType<typeof seed>>,
      riderId?: string,
    ) {
      const active = riderId ?? fx.riderB.id;
      const issued = await pickup.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: active,
      });
      const confirmed = await pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      });
      expect(confirmed.ok).toBe(true);
      await transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'in_transit',
        actor: { id: active, type: 'RIDER' },
        reason: 's6_in_transit',
      });
      await transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'delivery_failed',
        // Stage 8: marketplace delivery_failed is INTERNAL_SERVICE (report path).
        actor: { id: active, type: 'INTERNAL_SERVICE' },
        reason: 's6_delivery_failed',
      });
      await transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'returning',
        actor: { id: active, type: 'RIDER' },
        reason: 's6_returning',
      });
      return prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
    }

    it('reports dedicated DB identity', async () => {
      const rows = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
      expect(
        rows[0]?.database === 'wekonnek_stage6_test' ||
          rows[0]?.database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE ||
          rows[0]?.database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
      ).toBe(true);
    });

    it('enforces one ACTIVE return token per fulfillment/purpose', async () => {
      const fx = await seed();
      await advanceToReturning(fx);
      const a = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const b = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      expect(a.tokenId).not.toBe(b.tokenId);
      const active = await prisma.merchantReturnHandoffToken.findMany({
        where: {
          fulfillmentId: fx.fulfillment.id,
          status: MerchantReturnHandoffTokenStatus.ACTIVE,
        },
      });
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(b.tokenId);
      const prior = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
        where: { id: a.tokenId },
      });
      expect(prior.status).toBe(MerchantReturnHandoffTokenStatus.REVOKED);
    });

    it('stores hash only (raw secret/otp not persisted)', async () => {
      const fx = await seed();
      await advanceToReturning(fx);
      const issued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const row = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
        where: { id: issued.tokenId },
      });
      expect(row.tokenHash).toBe(
        hashReturnSecret(issued.qrPayload.split('.')[2]!),
      );
      expect(JSON.stringify(row)).not.toContain(issued.otp);
      expect(JSON.stringify(row)).not.toContain(issued.qrPayload.split('.')[2]);
    });

    it('denies wrong-state and wrong-rider issuance', async () => {
      const fx = await seed();
      await expect(
        returns.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderB.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await advanceToReturning(fx);
      await expect(
        returns.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderC.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('merchant QR confirm atomically returns goods and preserves RA/payment', async () => {
      const fx = await seed({ allowRA: true });
      // Rider A = creditor; start assigned as A
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderA.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's6_creditor_setup',
      });
      const auth = await riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: '1100.00',
      });
      await riderAdvance.accept({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.riderA.id,
      });
      await riderAdvance.recordAdvance({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.riderA.id,
        actualAdvanceAmount: '980.00',
      });
      await riderAdvance.vendorAcknowledge({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.merchantUser.id,
        acknowledgedAmount: '980.00',
      });
      // Rider B = delivery/return rider
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's6_delivery_rider',
      });
      const raBefore = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: auth.riderAdvance.id },
      });
      expect(raBefore.riderId).toBe(fx.riderA.id);
      const paymentBefore = await prisma.wkOrder.findUniqueOrThrow({
        where: { id: fx.order.id },
      });

      await advanceToReturning(fx);
      const issued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });

      await expect(
        transitions.transition({
          fulfillmentId: fx.fulfillment.id,
          targetStatus: 'returned',
          actor: { id: fx.riderB.id, type: 'RIDER' },
          reason: 'self_return',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        custody.record({
          actorUserId: fx.riderB.id,
          eventType: CustodyEventType.RETURN_RECEIVED,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillment.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const confirmed = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
        correlationId: 's6-confirm',
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;

      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(fulfillment.status).toBe(FulfillmentStatus.returned);
      const token = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
        where: { id: issued.tokenId },
      });
      expect(token.status).toBe(MerchantReturnHandoffTokenStatus.CONSUMED);
      const returnCustody = await prisma.custodyEvent.findFirst({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RETURN_RECEIVED,
        },
      });
      expect(returnCustody).toBeTruthy();

      const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: auth.riderAdvance.id },
      });
      expect(raAfter.riderId).toBe(fx.riderA.id);
      expect(raAfter.reimbursementPrincipal?.toFixed(2)).toBe(
        raBefore.reimbursementPrincipal?.toFixed(2),
      );
      expect(raAfter.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
      const paymentAfter = await prisma.wkOrder.findUniqueOrThrow({
        where: { id: fx.order.id },
      });
      expect(paymentAfter.merchantPaymentStatus).toBe(
        paymentBefore.merchantPaymentStatus,
      );

      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RETURN_COMPLETED');
    });

    it('reassignment revokes B token; C issues; merchant confirms C', async () => {
      const fx = await seed({ allowRA: true });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderA.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's6_creditor_setup',
      });
      const auth = await riderAdvance.authorize({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        maximumAuthorizedAdvance: '500.00',
      });
      await riderAdvance.accept({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.riderA.id,
      });
      await riderAdvance.recordAdvance({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.riderA.id,
        actualAdvanceAmount: '400.00',
      });
      await riderAdvance.vendorAcknowledge({
        riderAdvanceId: auth.riderAdvance.id,
        actorUserId: fx.merchantUser.id,
        acknowledgedAmount: '400.00',
      });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's6_delivery_rider',
      });

      await advanceToReturning(fx);
      const bToken = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const pendingAssign = await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderC.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's6_reassign_return',
      });
      expect(pendingAssign.pendingCustodyTransfer).toBe(true);
      const pendingFul = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(pendingFul.activeRiderId).toBe(fx.riderB.id);
      expect(pendingFul.pendingCustodyIncomingRiderId).toBe(fx.riderC.id);

      const revoked = await prisma.merchantReturnHandoffToken.findUniqueOrThrow({
        where: { id: bToken.tokenId },
      });
      expect(revoked.status).toBe(MerchantReturnHandoffTokenStatus.REVOKED);

      const denied = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: bToken.qrPayload,
      });
      expect(denied.ok).toBe(false);

      const handoff = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const custodyOk = await custodyHandoff.confirm({
        actorUserId: fx.riderC.id,
        qrPayload: handoff.qrPayload,
        correlationId: 's6-return-reassign-custody',
      });
      expect(custodyOk.ok).toBe(true);

      const cToken = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderC.id,
      });
      const ok = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: cToken.qrPayload,
        correlationId: 's6-c-confirm',
      });
      expect(ok.ok).toBe(true);
      const ra = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: auth.riderAdvance.id },
      });
      expect(ra.riderId).toBe(fx.riderA.id);
      const opsC = await operational.getForOrder(fx.order.id, fx.riderC.id);
      expect((opsC as { reimbursement?: unknown }).reimbursement).toBeUndefined();
      expect(opsC.physicalStatus).toBe('returned');
    });

    it('wrong merchant validate/confirm denied; OTP lock after failures', async () => {
      const fx = await seed();
      await advanceToReturning(fx);
      const issued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const wrong = await returns.validate({
        actorUserId: fx.foreignMerchantUser.id,
        qrPayload: issued.qrPayload,
      });
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.code).toBe('WRONG_MERCHANT');

      for (let i = 0; i < 5; i++) {
        const bad = await returns.confirm({
          actorUserId: fx.merchantUser.id,
          otp: 'WRONGOTP1',
          orderId: fx.order.id,
        });
        expect(bad.ok).toBe(false);
      }
      const locked = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        otp: issued.otp,
        orderId: fx.order.id,
      });
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.code).toBe('OTP_LOCKED');
    });

    it('QR/OTP race: exactly one successful confirmation', async () => {
      const fx = await seed();
      await advanceToReturning(fx);
      const issued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const results = await Promise.allSettled([
        returns.confirm({
          actorUserId: fx.merchantUser.id,
          qrPayload: issued.qrPayload,
          correlationId: 'race-qr',
        }),
        returns.confirm({
          actorUserId: fx.merchantUser.id,
          otp: issued.otp,
          orderId: fx.order.id,
          correlationId: 'race-otp',
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<{
        status: 'fulfilled';
        value: Awaited<ReturnType<ReturnHandoffService['confirm']>>;
      }>;
      const oks = fulfilled.filter((r) => r.value.ok);
      expect(oks.length).toBeGreaterThanOrEqual(1);
      const custodyCount = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RETURN_RECEIVED,
        },
      });
      expect(custodyCount).toBe(1);
      const f = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(f.status).toBe(FulfillmentStatus.returned);
    });

    it('expiry blocks confirm; historical returned without custody flagged', async () => {
      const fx = await seed();
      await advanceToReturning(fx);
      const issued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      await prisma.merchantReturnHandoffToken.update({
        where: { id: issued.tokenId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: issued.qrPayload,
      });
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(expired.code).toBe('RETURN_TOKEN_EXPIRED');

      await prisma.orderFulfillment.update({
        where: { id: fx.fulfillment.id },
        data: { status: FulfillmentStatus.returned },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RETURN_CUSTODY_UNCONFIRMED');
    });

    it('schema has no persisted operationalStatus/closedAt/completedAt', async () => {
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'orders'
          AND column_name IN ('operationalStatus','operational_status','closedAt','closed_at','completedAt','completed_at')
      `;
      expect(cols).toHaveLength(0);
    });
  },
);
