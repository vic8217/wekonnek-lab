import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { isCurrentSchemaRegressionMode } from '../test-support/test-database-guard';

if (isCurrentSchemaRegressionMode()) {
  loadStageTestEnv('.env.stage7.regression.test');
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
}
import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  FulfillmentStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentTransitionService } from './fulfillment-transition.service';
import { OrderDomainEventService } from './order-domain-event.service';
import { RiderAssignmentService } from './rider-assignment.service';
import { FulfillmentService } from './fulfillment.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';

jest.setTimeout(60_000);

const LOCAL_DB_HOST = /localhost|127\.0\.0\.1/;

describe('Stage 0A fulfillment concurrency (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const riderAdvance = new RiderAdvanceService(prisma, events);
  const assignments = new RiderAssignmentService(prisma, events, riderAdvance);
  const transitions = new FulfillmentTransitionService(
    prisma,
    events,
    assignments,
  );
  const fulfillments = new FulfillmentService(prisma, events);

  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!LOCAL_DB_HOST.test(url)) {
      throw new Error(
        'Stage 0A postgres tests refuse non-local DATABASE_URL',
      );
    }
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    const database = target[0]?.database ?? '';
    if (/prod/i.test(database)) {
      throw new Error(`Refusing to run Stage 0A tests against ${database}`);
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedDeliveryOrder() {
    const token = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+6391${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s0a-c-${token}@test.invalid`,
        role: UserRole.customer,
      },
    });
    const riderA = await prisma.user.create({
      data: {
        phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s0a-ra-${token}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const riderB = await prisma.user.create({
      data: {
        phone: `+6393${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s0a-rb-${token}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `S0A-${token.slice(0, 8)}`,
        type: OrderType.express,
        status: OrderStatus.ready_for_pickup,
        customerId: customer.id,
        items: [],
        pickupAddress: { lat: 14.5, lng: 121.0 },
        deliveryAddress: { lat: 14.6, lng: 121.1 },
        paymentMethod: PaymentMethod.cash,
        paymentStatus: PaymentStatus.pending_payment,
        deliveryPin: '1234',
      },
    });

    cleanup = async () => {
      await prisma.orderDomainEvent.deleteMany({
        where: { OR: [{ orderV2Id: order.id }] },
      });
      await prisma.riderAssignment.deleteMany({
        where: { orderV2Id: order.id },
      });
      await prisma.orderFulfillment.deleteMany({
        where: { orderV2Id: order.id },
      });
      await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
      await prisma.user.deleteMany({
        where: { id: { in: [customer.id, riderA.id, riderB.id] } },
      });
    };

    return { customer, riderA, riderB, order };
  }

  it('prevents competing assignments from silently corrupting active rider', async () => {
    const { riderA, riderB, order } = await seedDeliveryOrder();

    const results = await Promise.allSettled([
      assignments.assign({
        orderV2Id: order.id,
        riderId: riderA.id,
        actor: { type: 'SYSTEM' },
        expectedVersion: 0,
      }),
      assignments.assign({
        orderV2Id: order.id,
        riderId: riderB.id,
        actor: { type: 'SYSTEM' },
        expectedVersion: 0,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      err instanceof ConflictException ||
        String(err?.message ?? err).toLowerCase().includes('conflict') ||
        String(err?.message ?? err).toLowerCase().includes('could not serialize'),
    ).toBe(true);

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.status).toBe(OrderStatus.rider_assigned);
    expect([riderA.id, riderB.id]).toContain(fresh.riderId);
    expect(fresh.assignmentVersion).toBe(1);

    const active = await prisma.riderAssignment.findMany({
      where: {
        orderV2Id: order.id,
        status: 'ACTIVE',
      },
    });
    expect(active).toHaveLength(1);
    expect(active[0].riderId).toBe(fresh.riderId);
  });

  it('treats duplicate transitions as idempotent', async () => {
    const { order } = await seedDeliveryOrder();
    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'confirmed',
      actor: { type: 'SYSTEM' },
    }).catch(() => undefined);

    // Move stepwise to confirmed from ready_for_pickup is illegal — reset path:
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.pending },
    });
    await prisma.orderFulfillment.deleteMany({ where: { orderV2Id: order.id } });

    const first = await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'confirmed',
      actor: { type: 'SYSTEM' },
    });
    expect(first.idempotent).toBe(false);

    const second = await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'confirmed',
      actor: { type: 'SYSTEM' },
    });
    expect(second.idempotent).toBe(true);

    const eventCount = await prisma.orderDomainEvent.count({
      where: {
        orderV2Id: order.id,
        action: {
          in: ['FULFILLMENT_STATUS_CHANGED', 'FULFILLMENT_TRANSITION_IDEMPOTENT'],
        },
      },
    });
    expect(eventCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects incompatible concurrent status changes', async () => {
    const { order } = await seedDeliveryOrder();
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.pending },
    });
    await prisma.orderFulfillment.deleteMany({ where: { orderV2Id: order.id } });

    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'confirmed',
      actor: { type: 'SYSTEM' },
    });

    await expect(
      transitions.transition({
        orderV2Id: order.id,
        targetStatus: 'delivered',
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('wins cancellation against a later illegal delivery attempt', async () => {
    const { order } = await seedDeliveryOrder();
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.preparing },
    });
    await prisma.orderFulfillment.deleteMany({ where: { orderV2Id: order.id } });

    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'cancelled',
      actor: { type: 'SYSTEM' },
    });

    await expect(
      transitions.transition({
        orderV2Id: order.id,
        targetStatus: 'ready_for_pickup',
        actor: { type: 'SYSTEM' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.status).toBe(OrderStatus.cancelled);
  });

  it('does not mark orders_v2 payment paid on delivered', async () => {
    const { riderA, order } = await seedDeliveryOrder();
    await assignments.assign({
      orderV2Id: order.id,
      riderId: riderA.id,
      actor: { type: 'SYSTEM' },
    });
    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'picked_up',
      actor: { id: riderA.id, type: 'RIDER' },
    });
    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'in_transit',
      actor: { id: riderA.id, type: 'RIDER' },
    });
    await transitions.transition({
      orderV2Id: order.id,
      targetStatus: 'delivered',
      // Stage 5A: rider cannot self-deliver; INTERNAL_SERVICE simulates secure handoff.
      actor: { id: riderA.id, type: 'INTERNAL_SERVICE' },
    });

    const fresh = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(fresh.status).toBe(OrderStatus.delivered);
    expect(fresh.paymentStatus).toBe(PaymentStatus.pending_payment);
  });

  it('creates marketplace fulfillment linked to WkOrder without breaking create', async () => {
    const token = randomUUID();
    const user = await prisma.user.create({
      data: {
        phone: `+6394${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s0a-wk-${token}@test.invalid`,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+6395${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s0a-m-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S0A ${token}`,
        slug: `s0a-${token}`,
      },
    });
    const wk = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S0A-${token.slice(0, 8)}`,
        userId: user.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 100,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
      },
    });

    cleanup = async () => {
      await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: wk.id } });
      await prisma.orderFulfillment.deleteMany({ where: { wkOrderId: wk.id } });
      await prisma.wkOrder.delete({ where: { id: wk.id } });
      await prisma.merchant.delete({ where: { id: merchant.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [user.id, merchantUser.id] } },
      });
    };

    const fulfillment = await fulfillments.ensureForWkOrder(wk.id);
    expect(fulfillment.wkOrderId).toBe(wk.id);
    expect(fulfillment.status).toBe(FulfillmentStatus.pending);

    const again = await fulfillments.ensureForWkOrder(wk.id);
    expect(again.id).toBe(fulfillment.id);
  });

  it('forbids unassigned rider transitions', async () => {
    const { riderA, riderB, order } = await seedDeliveryOrder();
    await assignments.assign({
      orderV2Id: order.id,
      riderId: riderA.id,
      actor: { type: 'SYSTEM' },
    });

    await expect(
      transitions.transition({
        orderV2Id: order.id,
        targetStatus: 'picked_up',
        actor: { id: riderB.id, type: 'RIDER' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
