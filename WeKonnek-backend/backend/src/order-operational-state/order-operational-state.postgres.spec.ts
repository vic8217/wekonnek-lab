/**
 * Stage 6 OrderOperationalStateService — real PostgreSQL matrix.
 * Requires backend/.env.stage6.test and database wekonnek_stage6_test.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const STAGE6_ENV = resolve(__dirname, '../../.env.stage6.test');
const STAGE6_ENV_PRESENT = existsSync(STAGE6_ENV);

if (STAGE6_ENV_PRESENT) {
  loadEnv({ path: STAGE6_ENV, override: true });
}

import { ForbiddenException } from '@nestjs/common';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { truncateSettlementsForStage5bTest } from '../rider-advance-settlement/stage5b-test-cleanup';
import { OrderOperationalStateService } from './order-operational-state.service';

const describeIf = STAGE6_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set(['victor', 'wekonnek_stage6_test']);
const FORBIDDEN_DB_USERS = new Set([
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
]);

describeIf(
  'Stage 6 Operational State PostgreSQL (wekonnek_stage6_test)',
  () => {
    const prisma = new PrismaService();
    const events = new OrderDomainEventService(prisma);
    const riderAdvance = new RiderAdvanceService(prisma, events);
    const assignments = new RiderAssignmentService(prisma, events, riderAdvance);
    const operational = new OrderOperationalStateService(prisma);
    let cleanup: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      await prisma.$connect();
      const target = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
      const database = target[0]?.database;
      const user = target[0]?.user;
      if (
        database !== 'wekonnek_stage6_test' ||
        !user ||
        FORBIDDEN_DB_USERS.has(user) ||
        !ALLOWED_DB_USERS.has(user)
      ) {
        throw new Error(
          `Stage 6 ops-state tests require wekonnek_stage6_test; got database=${database} user=${user}`,
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
            email: `s6ops-${prefix}-${tag}@test.invalid`,
            role,
          },
        });
      const customer = await mkUser(UserRole.customer, 'cust');
      const riderA = await mkUser(UserRole.rider, 'ra');
      const riderB = await mkUser(UserRole.rider, 'rb');
      const riderC = await mkUser(UserRole.rider, 'rc');
      const merchantUser = await mkUser(UserRole.merchant, 'm');
      const foreignMerchantUser = await mkUser(UserRole.merchant, 'fm');
      const coordinator = await mkUser(UserRole.coordinator, 'coord');
      const merchant = await prisma.merchant.create({
        data: {
          userId: merchantUser.id,
          name: `S6OPS ${tag}`,
          slug: `s6ops-${tag}`,
          commerceDomain: CommerceDomain.NON_FOOD,
          allowRiderAdvance: opts?.allowRA ?? true,
        },
      });
      const foreignMerchant = await prisma.merchant.create({
        data: {
          userId: foreignMerchantUser.id,
          name: `S6OPSF ${tag}`,
          slug: `s6opsf-${tag}`,
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
          orderCode: `WK-S6O-${tag.slice(0, 8)}`,
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
        await prisma.merchantReturnHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.customerDeliveryHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.pickupHandoffToken.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
        await truncateSettlementsForStage5bTest(prisma);
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
          where: {
            merchantId: { in: [merchant.id, foreignMerchant.id] },
          },
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
                coordinator.id,
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
        coordinator,
        merchant,
        foreignMerchant,
        order,
        fulfillment: refreshed,
      };
    }

    async function setPhysical(
      fulfillmentId: string,
      status: FulfillmentStatus,
      activeRiderId?: string | null,
    ) {
      return prisma.orderFulfillment.update({
        where: { id: fulfillmentId },
        data: {
          status,
          ...(activeRiderId !== undefined ? { activeRiderId } : {}),
        },
      });
    }

    async function addCustody(
      fx: Awaited<ReturnType<typeof seed>>,
      eventType: CustodyEventType,
    ) {
      return prisma.custodyEvent.create({
        data: {
          id: randomUUID(),
          eventType,
          wkOrderId: fx.order.id,
          fulfillmentId: fx.fulfillment.id,
          actorUserId: fx.customer.id,
          occurredAt: new Date(),
        },
      });
    }

    async function toDue(
      fx: Awaited<ReturnType<typeof seed>>,
      amount: string = '400.00',
    ) {
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderA.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_creditor',
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

    it('A delivered + CUSTOMER_RECEIVED + non-RA + payment resolved => COMPLETE', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('COMPLETE');
    });

    it('B delivered + CUSTOMER_RECEIVED + RA REIMBURSED => COMPLETE', async () => {
      const fx = await seed({ allowRA: true });
      const ra = await toDue(fx, '400.00');
      await prisma.riderAdvanceSettlement.create({
        data: {
          id: randomUUID(),
          riderAdvanceId: ra.id,
          wkOrderId: fx.order.id,
          customerId: fx.customer.id,
          creditorRiderId: fx.riderA.id,
          method: 'CASH',
          status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
          currency: 'PHP',
          claimedAmount: 400,
          acknowledgedAmount: 400,
          acknowledgedAt: new Date(),
        },
      });
      await prisma.riderAdvance.update({
        where: { id: ra.id },
        data: {
          status: RiderAdvanceStatus.REIMBURSED,
          reimbursedAt: new Date(),
        },
      });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_delivery',
      });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered, fx.riderB.id);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('COMPLETE');
    });

    it('C delivered + RA REIMBURSEMENT_DUE => FINANCIALLY_PENDING', async () => {
      const fx = await seed({ allowRA: true });
      await toDue(fx, '400.00');
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_c',
      });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered, fx.riderB.id);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('FINANCIALLY_PENDING');
      expect(ops.flags).toContain('RIDER_ADVANCE_REIMBURSEMENT_DUE');
    });

    it('D RA REIMBURSED + in_transit => ACTIVE', async () => {
      const fx = await seed({ allowRA: true });
      const ra = await toDue(fx, '400.00');
      await prisma.riderAdvanceSettlement.create({
        data: {
          id: randomUUID(),
          riderAdvanceId: ra.id,
          wkOrderId: fx.order.id,
          customerId: fx.customer.id,
          creditorRiderId: fx.riderA.id,
          method: 'CASH',
          status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
          currency: 'PHP',
          claimedAmount: 400,
          acknowledgedAmount: 400,
          acknowledgedAt: new Date(),
        },
      });
      await prisma.riderAdvance.update({
        where: { id: ra.id },
        data: {
          status: RiderAdvanceStatus.REIMBURSED,
          reimbursedAt: new Date(),
        },
      });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_d',
      });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.in_transit, fx.riderB.id);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('ACTIVE');
    });

    it('E delivery_failed => EXCEPTION', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivery_failed);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
    });

    it('F returning => EXCEPTION + RETURN_IN_PROGRESS', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.returning);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RETURN_IN_PROGRESS');
    });

    it('G returned + RETURN_RECEIVED => EXCEPTION + RETURN_COMPLETED', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.returned);
      await addCustody(fx, CustodyEventType.RETURN_RECEIVED);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RETURN_COMPLETED');
    });

    it('H returned without RETURN_RECEIVED => EXCEPTION + RETURN_CUSTODY_UNCONFIRMED', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.returned);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RETURN_CUSTODY_UNCONFIRMED');
    });

    it('I delivered without CUSTOMER_RECEIVED => EXCEPTION + CUSTOMER_CUSTODY_UNCONFIRMED', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('CUSTOMER_CUSTODY_UNCONFIRMED');
    });

    it('J cancelled without debt => CANCELLED', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.cancelled);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('CANCELLED');
    });

    it('K cancelled with preserved principal => CANCELLED + financial flag', async () => {
      const fx = await seed({ allowRA: true });
      await toDue(fx, '400.00');
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.cancelled);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('CANCELLED');
      expect(ops.flags).toContain('RIDER_ADVANCE_REIMBURSEMENT_DUE');
    });

    it('L ordinary cash delivered payment unresolved => FINANCIALLY_PENDING', async () => {
      const fx = await seed({ allowRA: false });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('FINANCIALLY_PENDING');
    });

    it('M RA REIMBURSED but settlement total != principal => integrity EXCEPTION', async () => {
      const fx = await seed({ allowRA: true });
      const ra = await toDue(fx, '400.00');
      await prisma.riderAdvanceSettlement.create({
        data: {
          id: randomUUID(),
          riderAdvanceId: ra.id,
          wkOrderId: fx.order.id,
          customerId: fx.customer.id,
          creditorRiderId: fx.riderA.id,
          method: 'CASH',
          status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
          currency: 'PHP',
          claimedAmount: 100,
          acknowledgedAmount: 100,
          acknowledgedAt: new Date(),
        },
      });
      await prisma.riderAdvance.update({
        where: { id: ra.id },
        data: {
          status: RiderAdvanceStatus.REIMBURSED,
          reimbursedAt: new Date(),
        },
      });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_m',
      });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered, fx.riderB.id);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RA_REIMBURSED_TOTAL_MISMATCH');
    });

    it('N RA due with null principal => integrity EXCEPTION', async () => {
      const fx = await seed({ allowRA: true });
      const ra = await toDue(fx, '400.00');
      await prisma.riderAdvance.update({
        where: { id: ra.id },
        data: { reimbursementPrincipal: null },
      });
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderB.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_n',
      });
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.delivered, fx.riderB.id);
      await addCustody(fx, CustodyEventType.CUSTOMER_RECEIVED);
      await prisma.wkOrder.update({
        where: { id: fx.order.id },
        data: { merchantPaymentStatus: MerchantPaymentStatus.VERIFIED },
      });
      const ops = await operational.getForOrder(fx.order.id, fx.customer.id);
      expect(ops.operationalState).toBe('EXCEPTION');
      expect(ops.flags).toContain('RA_DUE_WITHOUT_PRINCIPAL');
    });

    it('privacy: merchant strips settlement proof; rider C minimal; creditor strips merchant payment; coordinator denied', async () => {
      const fx = await seed({ allowRA: true });
      const ra = await toDue(fx, '400.00');
      await setPhysical(fx.fulfillment.id, FulfillmentStatus.returning, fx.riderC.id);
      await assignments.assign({
        fulfillmentId: fx.fulfillment.id,
        riderId: fx.riderC.id,
        actor: { type: 'SYSTEM' },
        allowReassignment: true,
        reason: 'ops_privacy',
      });

      const merchantView = await operational.getForOrder(
        fx.order.id,
        fx.merchantUser.id,
      );
      expect(merchantView.merchantPaymentStatus).toBeDefined();
      expect(
        (merchantView.reimbursement as { principal?: unknown } | null)?.principal,
      ).toBeUndefined();

      const creditorView = await operational.getForOrder(
        fx.order.id,
        fx.riderA.id,
      );
      expect(
        (creditorView as { merchantPaymentStatus?: unknown }).merchantPaymentStatus,
      ).toBeUndefined();
      expect(
        (creditorView.reimbursement as { creditorRiderId: string }).creditorRiderId,
      ).toBe(fx.riderA.id);

      const riderCView = await operational.getForOrder(fx.order.id, fx.riderC.id);
      expect(
        (riderCView as { reimbursement?: unknown }).reimbursement,
      ).toBeUndefined();
      expect(
        (riderCView as { merchantPaymentStatus?: unknown }).merchantPaymentStatus,
      ).toBeUndefined();

      await expect(
        operational.getForOrder(fx.order.id, fx.coordinator.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        operational.getForOrder(fx.order.id, fx.foreignMerchantUser.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ra.id).toBeTruthy();
    });
  },
);
