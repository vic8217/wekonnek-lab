/**
 * Stage 7 secure rider custody handoff — PostgreSQL acceptance.
 * Requires backend/.env.stage7.test and database wekonnek_stage7_test,
 * or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 + wekonnek_stage8_regression_test.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  isCurrentSchemaRegressionMode,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from '../test-support/test-database-guard';

const STAGE7_ENV_PRESENT = loadStageTestEnv('.env.stage7.test');

import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  RiderAdvanceStatus,
  RiderCustodyHandoffTokenStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { DeliveryHandoffService } from '../delivery-handoff/delivery-handoff.service';
import { PickupHandoffService } from '../pickup-handoff/pickup-handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { ReturnHandoffService } from '../return-handoff/return-handoff.service';
import { RiderCustodyHandoffService } from './rider-custody-handoff.service';

const describeIf = STAGE7_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const EXPECTED_DB = isCurrentSchemaRegressionMode()
  ? STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE
  : STAGE7_ACCEPTANCE_DATABASE;
const ALLOWED_DB_USERS = new Set([
  'victor',
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);
const FORBIDDEN_DBS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);

describeIf(
  `Stage 7 Rider Custody Handoff PostgreSQL (${EXPECTED_DB})`,
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
    const delivery = new DeliveryHandoffService(
      prisma,
      events,
      custody,
      transitions,
      config,
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
        FORBIDDEN_DBS.has(database) ||
        database !== EXPECTED_DB ||
        !user ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 7 tests require ${EXPECTED_DB} identity; got database=${database} user=${user}`,
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
            email: `s7-${prefix}-${tag}@test.invalid`,
            role,
            firstName: `S7${prefix}`,
          },
        });
      const customer = await mkUser(UserRole.customer, 'c');
      const riderA = await mkUser(UserRole.rider, 'a');
      const riderB = await mkUser(UserRole.rider, 'b');
      const riderC = await mkUser(UserRole.rider, 'c-rider');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S7 ${tag}`,
          slug: `s7-${tag}`,
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
          orderCode: `WK-S7-${tag.slice(0, 8)}`,
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
        riderId: riderA.id,
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
        await prisma.riderCustodyHandoffToken.updateMany({
          where: { wkOrderId: order.id },
          data: {
            releaseCustodyEventId: null,
            receiptCustodyEventId: null,
          },
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
          where: { merchantId: merchant.id },
        });
        await prisma.merchant.deleteMany({ where: { id: merchant.id } });
        await prisma.user.deleteMany({
          where: {
            id: {
              in: [
                customer.id,
                riderA.id,
                riderB.id,
                riderC.id,
                merchantUser.id,
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
        merchant,
        order,
        fulfillment: refreshed,
      };
    }

    async function advanceToInTransit(
      fx: Awaited<ReturnType<typeof seed>>,
      riderId?: string,
    ) {
      const active = riderId ?? fx.riderA.id;
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
        reason: 's7_in_transit',
      });
      return prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
    }

    async function advanceToReturning(
      fx: Awaited<ReturnType<typeof seed>>,
      riderId?: string,
    ) {
      await advanceToInTransit(fx, riderId);
      const active = riderId ?? fx.riderA.id;
      await transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'delivery_failed',
        // Stage 8: marketplace delivery_failed is INTERNAL_SERVICE (report path).
        actor: { id: active, type: 'INTERNAL_SERVICE' },
        reason: 's7_failed',
      });
      await transitions.transition({
        fulfillmentId: fx.fulfillment.id,
        targetStatus: 'returning',
        actor: { id: active, type: 'RIDER' },
        reason: 's7_returning',
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
        reason: 's7_pending_custody',
      });
      expect(pending.pendingCustodyTransfer).toBe(true);
      const mid = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(mid.activeRiderId).toBe(outgoingId);
      expect(mid.pendingCustodyIncomingRiderId).toBe(incomingId);

      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: outgoingId,
      });
      expect(issued.qrPayload).toMatch(/^WKRR1\./);

      const confirmed = await custodyHandoff.confirm({
        actorUserId: incomingId,
        qrPayload: issued.qrPayload,
        correlationId: 's7-custody-confirm',
      });
      expect(confirmed.ok).toBe(true);
      return { issued, confirmed };
    }

    it('pre-pickup reassignment: no rider transfer custody; stale pickup revoked', async () => {
      const fx = await seed({ allowRA: false });
      const oldPickup = await pickup.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const beforeTransfer = await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: {
            in: [
              CustodyEventType.RIDER_TRANSFER_RELEASED,
              CustodyEventType.RIDER_TRANSFER_RECEIVED,
            ],
          },
        },
      });

      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's7_pre_pickup',
      });

      const afterTransfer = await prisma.custodyEvent.count({
        where: {
          wkOrderId: fx.order.id,
          eventType: {
            in: [
              CustodyEventType.RIDER_TRANSFER_RELEASED,
              CustodyEventType.RIDER_TRANSFER_RECEIVED,
            ],
          },
        },
      });
      expect(afterTransfer).toBe(beforeTransfer);

      const stale = await pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: oldPickup.qrPayload,
      });
      expect(stale.ok).toBe(false);

      const fresh = await pickup.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      const ok = await pickup.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: fresh.qrPayload,
      });
      expect(ok.ok).toBe(true);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.activeRiderId).toBe(fx.riderB.id);
    });

    it('mid-possession pending: incoming blocked until outgoing issues WKRR1 confirm', async () => {
      const fx = await seed({ allowRA: true });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderA.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's7_ra_creditor',
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

      await advanceToInTransit(fx, fx.riderA.id);
      const paymentBefore = await prisma.wkOrder.findUniqueOrThrow({
        where: { id: fx.order.id },
      });
      const raBefore = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: auth.riderAdvance.id },
      });

      const pending = await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's7_mid_to_B',
      });
      expect(pending.pendingCustodyTransfer).toBe(true);

      await expect(
        delivery.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderB.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const handoff = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const confirmed = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        qrPayload: handoff.qrPayload,
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;

      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillment.id,
            eventType: CustodyEventType.RIDER_TRANSFER_RELEASED,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillment.id,
            eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
          },
        }),
      ).toBe(1);

      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.activeRiderId).toBe(fx.riderB.id);
      expect(ful.physicalCustodianRiderId).toBe(fx.riderB.id);
      expect(ful.pendingCustodyIncomingRiderId).toBeNull();

      const raAfter = await prisma.riderAdvance.findUniqueOrThrow({
        where: { id: auth.riderAdvance.id },
      });
      expect(raAfter.riderId).toBe(fx.riderA.id);
      expect(raAfter.reimbursementPrincipal?.toFixed(2)).toBe(
        raBefore.reimbursementPrincipal?.toFixed(2),
      );
      const paymentAfter = await prisma.wkOrder.findUniqueOrThrow({
        where: { id: fx.order.id },
      });
      expect(paymentAfter.merchantPaymentStatus).toBe(
        paymentBefore.merchantPaymentStatus,
      );

      const deliveryCap = await delivery.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderB.id,
      });
      expect(deliveryCap.tokenId).toBeTruthy();
    });

    it('return reassignment E2E: B→C custody then return to merchant', async () => {
      const fx = await seed({ allowRA: false });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's7_delivery_rider_B',
      });
      await advanceToReturning(fx, fx.riderB.id);

      await confirmCustodyTransfer(fx, fx.riderB.id, fx.riderC.id);

      const cReturn = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderC.id,
      });
      const ok = await returns.confirm({
        actorUserId: fx.merchantUser.id,
        qrPayload: cReturn.qrPayload,
        correlationId: 's7-return-confirm',
      });
      expect(ok.ok).toBe(true);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.status).toBe(FulfillmentStatus.returned);
      expect(ful.activeRiderId).toBe(fx.riderC.id);
    });

    it('delivery reassignment E2E: in_transit pending C then delivery capability', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await confirmCustodyTransfer(fx, fx.riderA.id, fx.riderC.id);

      const issued = await delivery.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderC.id,
      });
      const confirmed = await delivery.confirm({
        actorUserId: fx.customer.id,
        qrPayload: issued.qrPayload,
      });
      expect(confirmed.ok).toBe(true);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.status).toBe(FulfillmentStatus.delivered);
      expect(ful.activeRiderId).toBe(fx.riderC.id);
    });

    it('OTP lock applies on confirm only; validate preview does not increment', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });

      for (let i = 0; i < 3; i++) {
        const preview = await custodyHandoff.validate({
          actorUserId: fx.riderB.id,
          otp: '0000',
          orderId: fx.order.id,
        });
        expect(preview.ok).toBe(false);
        if (!preview.ok) expect(preview.code).toBe('OTP_INVALID');
      }
      const rowAfterPreview =
        await prisma.riderCustodyHandoffToken.findUniqueOrThrow({
          where: { id: issued.tokenId },
        });
      expect(rowAfterPreview.otpFailedAttempts).toBe(0);

      for (let i = 0; i < 5; i++) {
        const fail = await custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          otp: '0000',
          orderId: fx.order.id,
        });
        expect(fail.ok).toBe(false);
      }
      const locked = await prisma.riderCustodyHandoffToken.findUniqueOrThrow({
        where: { id: issued.tokenId },
      });
      expect(locked.otpFailedAttempts).toBeGreaterThanOrEqual(5);
      expect(locked.otpLockedUntil).toBeTruthy();

      const lockedOtpConfirm = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        otp: '0000',
        orderId: fx.order.id,
      });
      expect(lockedOtpConfirm.ok).toBe(false);
      if (!lockedOtpConfirm.ok) expect(lockedOtpConfirm.code).toBe('OTP_LOCKED');
    });

    it('database rejects OTP attempt counts above the configured maximum', async () => {
      const fx = await seed();
      await advanceToInTransit(fx);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 's7_otp_constraint',
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });

      await expect(
        prisma.$executeRaw`
          UPDATE "rider_custody_handoff_tokens"
          SET "otp_failed_attempts" = 6
          WHERE id = ${issued.tokenId}::uuid
        `,
      ).rejects.toBeDefined();
    });

    it('double confirm is idempotent; token CONSUMED once', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const first = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        qrPayload: issued.qrPayload,
        idempotencyKey: `s7-double-${randomUUID()}`,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.idempotent).toBe(false);

      const second = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        qrPayload: issued.qrPayload,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.idempotent).toBe(true);

      const token = await prisma.riderCustodyHandoffToken.findUniqueOrThrow({
        where: { id: issued.tokenId },
      });
      expect(token.status).toBe(RiderCustodyHandoffTokenStatus.CONSUMED);
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillment.id,
            eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
          },
        }),
      ).toBe(1);
    });

    it('outgoing rider cannot self-confirm custody handoff', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const denied = await custodyHandoff.confirm({
        actorUserId: fx.riderA.id,
        qrPayload: issued.qrPayload,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.code).toBe('WRONG_INCOMING_RIDER');
    });

    it('foreign rider cannot confirm pending custody handoff', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const denied = await custodyHandoff.confirm({
        actorUserId: fx.riderC.id,
        qrPayload: issued.qrPayload,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.code).toBe('WRONG_INCOMING_RIDER');
    });

    it('concurrent issuance keeps one ACTIVE capability; reissue replaces prior', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const settled = await Promise.allSettled([
        custodyHandoff.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderA.id,
        }),
        custodyHandoff.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderA.id,
        }),
      ]);
      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const active = await prisma.riderCustodyHandoffToken.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          status: RiderCustodyHandoffTokenStatus.ACTIVE,
        },
      });
      expect(active).toBe(1);

      const reissued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const stillActive = await prisma.riderCustodyHandoffToken.findMany({
        where: {
          fulfillmentId: fx.fulfillment.id,
          status: RiderCustodyHandoffTokenStatus.ACTIVE,
        },
      });
      expect(stillActive).toHaveLength(1);
      expect(stillActive[0].id).toBe(reissued.tokenId);
    });

    it('expired capability cannot confirm', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      await prisma.riderCustodyHandoffToken.update({
        where: { id: issued.tokenId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const denied = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        qrPayload: issued.qrPayload,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.code).toBe('RIDER_CUSTODY_TOKEN_EXPIRED');
    });

    it('QR vs OTP confirmation race yields one coherent custodian', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const settled = await Promise.allSettled([
        custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          qrPayload: issued.qrPayload,
        }),
        custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          otp: issued.otp,
          orderId: fx.order.id,
        }),
      ]);
      expect(settled.some((s) => s.status === 'fulfilled')).toBe(true);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.activeRiderId).toBe(fx.riderB.id);
      expect(ful.physicalCustodianRiderId).toBe(fx.riderB.id);
      expect(ful.pendingCustodyIncomingRiderId).toBeNull();
      expect(
        await prisma.custodyEvent.count({
          where: {
            fulfillmentId: fx.fulfillment.id,
            eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
          },
        }),
      ).toBe(1);
    });

    it('race A: delivery confirm vs Stage 7 transfer confirm — one physical destination', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const custodyIssued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const deliveryIssued = await delivery.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      await Promise.allSettled([
        delivery.confirm({
          actorUserId: fx.customer.id,
          qrPayload: deliveryIssued.qrPayload,
        }),
        custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          qrPayload: custodyIssued.qrPayload,
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      const customerReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.CUSTOMER_RECEIVED,
        },
      });
      const transferReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        },
      });
      const incomingCustodian =
        ful.physicalCustodianRiderId === fx.riderB.id &&
        ful.pendingCustodyIncomingRiderId == null &&
        transferReceived > 0;
      // Never both CUSTOMER_RECEIVED and incoming rider custodian.
      expect(customerReceived > 0 && incomingCustodian).toBe(false);
      expect(customerReceived + (incomingCustodian ? 1 : 0)).toBeLessThanOrEqual(
        1,
      );
      expect(
        ful.status === FulfillmentStatus.delivered ||
          ful.status === FulfillmentStatus.in_transit,
      ).toBe(true);
    });

    it('race B: merchant return confirm vs Stage 7 transfer confirm — one destination', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToReturning(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const custodyIssued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      const returnIssued = await returns.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      await Promise.allSettled([
        returns.confirm({
          actorUserId: fx.merchantUser.id,
          qrPayload: returnIssued.qrPayload,
        }),
        custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          qrPayload: custodyIssued.qrPayload,
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      const returnReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RETURN_RECEIVED,
        },
      });
      const transferReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        },
      });
      const incomingCustodian =
        ful.physicalCustodianRiderId === fx.riderB.id &&
        ful.pendingCustodyIncomingRiderId == null &&
        transferReceived > 0;
      expect(returnReceived > 0 && incomingCustodian).toBe(false);
    });

    it('race C: second reassignment vs Stage 7 confirmation stays coherent', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      await Promise.allSettled([
        assignments.assign({
          fulfillmentId: fx.fulfillment.id,
          riderId: fx.riderC.id,
          actor: { type: 'SYSTEM' },
          allowReassignment: true,
          reason: 's7_race_second_reassign',
        }),
        custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          qrPayload: issued.qrPayload,
        }),
      ]);
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      const transferReceived = await prisma.custodyEvent.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        },
      });
      if (transferReceived > 0) {
        expect(ful.activeRiderId).toBe(fx.riderB.id);
        expect(ful.physicalCustodianRiderId).toBe(fx.riderB.id);
        expect(ful.pendingCustodyIncomingRiderId).toBeNull();
      } else {
        expect(ful.activeRiderId).toBe(fx.riderA.id);
        expect(
          ful.pendingCustodyIncomingRiderId === fx.riderB.id ||
            ful.pendingCustodyIncomingRiderId === fx.riderC.id,
        ).toBe(true);
      }
    });

    it('race D: expiry vs confirmation — expired cannot become custodian', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      const issued = await custodyHandoff.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.riderA.id,
      });
      await prisma.riderCustodyHandoffToken.update({
        where: { id: issued.tokenId },
        data: { expiresAt: new Date(Date.now() - 5) },
      });
      const confirmed = await custodyHandoff.confirm({
        actorUserId: fx.riderB.id,
        qrPayload: issued.qrPayload,
      });
      expect(confirmed.ok).toBe(false);
      if (!confirmed.ok) {
        expect(confirmed.code).toBe('RIDER_CUSTODY_TOKEN_EXPIRED');
      }
      const ful = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillment.id },
      });
      expect(ful.activeRiderId).toBe(fx.riderA.id);
      expect(ful.physicalCustodianRiderId).toBe(fx.riderA.id);
      expect(ful.pendingCustodyIncomingRiderId).toBe(fx.riderB.id);
    });

    it('RA timing: pending reassignment preserves creditor across RA lifecycle points', async () => {
      const points: Array<{
        label: string;
        setup: (fx: Awaited<ReturnType<typeof seed>>) => Promise<{
          raId: string;
          creditorId: string;
        }>;
      }> = [
        {
          label: 'pre-expenditure',
          setup: async (fx) => {
            const auth = await riderAdvance.authorize({
              wkOrderId: fx.order.id,
              actorUserId: fx.customer.id,
              maximumAuthorizedAdvance: '500.00',
            });
            await riderAdvance.accept({
              riderAdvanceId: auth.riderAdvance.id,
              actorUserId: fx.riderA.id,
            });
            return { raId: auth.riderAdvance.id, creditorId: fx.riderA.id };
          },
        },
        {
          label: 'ADVANCE_RECORDED without merchant ack',
          setup: async (fx) => {
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
            return { raId: auth.riderAdvance.id, creditorId: fx.riderA.id };
          },
        },
        {
          label: 'REIMBURSEMENT_DUE',
          setup: async (fx) => {
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
            return { raId: auth.riderAdvance.id, creditorId: fx.riderA.id };
          },
        },
      ];

      for (const point of points) {
        const fx = await seed({ allowRA: true });
        await advanceToInTransit(fx, fx.riderA.id);
        const { raId, creditorId } = await point.setup(fx);
        const before = await prisma.riderAdvance.findUniqueOrThrow({
          where: { id: raId },
        });
        await assignments.assign({
          fulfillmentId: fx.fulfillment.id,
          riderId: fx.riderB.id,
          actor: { type: 'SYSTEM' },
          allowReassignment: true,
          reason: `s7_ra_${point.label}`,
        });
        const pending = await prisma.riderAdvance.findUniqueOrThrow({
          where: { id: raId },
        });
        // Custody pending must not transfer creditor by itself.
        expect(pending.riderId).toBe(creditorId);
        expect(pending.status).toBe(before.status);
        const issued = await custodyHandoff.issueForOrder({
          wkOrderId: fx.order.id,
          actorUserId: fx.riderA.id,
        });
        const confirmed = await custodyHandoff.confirm({
          actorUserId: fx.riderB.id,
          qrPayload: issued.qrPayload,
        });
        expect(confirmed.ok).toBe(true);
        const after = await prisma.riderAdvance.findUniqueOrThrow({
          where: { id: raId },
        });
        // Custody transfer never transfers creditor; status follows frozen Stage 4/5A rules.
        expect(after.riderId).toBe(creditorId);
        if (
          before.status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
          before.status === RiderAdvanceStatus.VENDOR_ACKNOWLEDGED ||
          before.status === RiderAdvanceStatus.REIMBURSED
        ) {
          expect(after.status).toBe(before.status);
        } else if (before.status === RiderAdvanceStatus.ADVANCE_RECORDED) {
          expect(after.status).toBe(RiderAdvanceStatus.DISPUTED);
        } else {
          expect(after.status).toBe(RiderAdvanceStatus.CANCELLED);
        }
      }
    });

    it('generic public custody.record cannot forge RIDER_TRANSFER_* (Terra fix 1)', async () => {
      const fx = await seed({ allowRA: false });
      await advanceToInTransit(fx, fx.riderA.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
      });
      await expect(
        custody.record({
          actorUserId: fx.riderA.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RELEASED,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillment.id,
          fromPartyRole: 'RIDER',
          toPartyRole: 'RIDER',
          fromUserId: fx.riderA.id,
          toUserId: fx.riderB.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        custody.record({
          actorUserId: fx.riderB.id,
          eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillment.id,
          fromPartyRole: 'RIDER',
          toPartyRole: 'RIDER',
          fromUserId: fx.riderA.id,
          toUserId: fx.riderB.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  },
);
