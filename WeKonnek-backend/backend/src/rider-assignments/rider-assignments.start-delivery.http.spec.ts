import { FulfillmentStatus } from '@prisma/client';
import request from 'supertest';
import {
  authHeader,
  bootUce2App,
  cleanupOrder,
  describeUce2Live,
  seedActors,
  seedOrder,
  UCE2_LIVE,
} from './uce2-live.harness';

jest.setTimeout(180_000);

const denied = [
  'rider_assigned',
  'delivered',
  'returned',
  'cancelled',
  'delivery_failed',
  'returning',
] as const;

describeUce2Live('UCE-2 start delivery', () => {
  let live: Awaited<ReturnType<typeof bootUce2App>>;

  beforeAll(async () => {
    if (!UCE2_LIVE) return;
    live = await bootUce2App();
  });
  afterAll(async () => {
    await live?.close();
  });

  it('starts only for the active custodian and leaves custody and money unchanged', async () => {
    const actors = await seedActors(live.prisma);
    const ready = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const before = await live.prisma.wkOrder.findUniqueOrThrow({
      where: { id: ready.order.id },
      select: {
        paymentStatus: true,
        merchantPaymentStatus: true,
        transactionFeeAmount: true,
      },
    });
    const advancesBefore = await live.prisma.riderAdvance.count({
      where: { wkOrderId: ready.order.id },
    });

    const started = await request(live.app.getHttpServer())
      .post(`/rider/assignments/${ready.order.id}/start-delivery`)
      .set(authHeader(actors.rider))
      .expect(200);
    expect(started.body.idempotent).toBe(false);
    expect(started.body.assignment.fulfillment.status).toBe('in_transit');

    const replay = await request(live.app.getHttpServer())
      .post(`/rider/assignments/${ready.order.id}/start-delivery`)
      .set(authHeader(actors.rider))
      .expect(200);
    expect(replay.body.idempotent).toBe(true);

    const row = await live.prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: ready.fulfillment.id },
    });
    expect(row.status).toBe(FulfillmentStatus.in_transit);
    expect(row.physicalCustodianRiderId).toBe(actors.rider.id);
    expect(
      await live.prisma.custodyEvent.count({ where: { wkOrderId: ready.order.id } }),
    ).toBe(0);
    expect(
      await live.prisma.wkOrder.findUniqueOrThrow({
        where: { id: ready.order.id },
        select: {
          paymentStatus: true,
          merchantPaymentStatus: true,
          transactionFeeAmount: true,
        },
      }),
    ).toEqual(before);
    expect(
      await live.prisma.riderAdvance.count({ where: { wkOrderId: ready.order.id } }),
    ).toBe(advancesBefore);

    const noCustody = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: null,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${noCustody.order.id}/start-delivery`)
      .set(authHeader(actors.rider))
      .expect(403);

    const custodianOnly = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${custodianOnly.order.id}/start-delivery`)
      .set(authHeader(actors.rider))
      .expect(403);

    const incoming = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.riderB.id,
      pendingCustodyIncomingRiderId: actors.rider.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${incoming.order.id}/start-delivery`)
      .set(authHeader(actors.rider))
      .expect(403);

    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${ready.order.id}/start-delivery`)
      .set(authHeader(actors.riderB))
      .expect(403);

    for (const status of denied) {
      const terminal = await seedOrder(live.prisma, actors, {
        status: status as FulfillmentStatus,
        activeRiderId: actors.rider.id,
        physicalCustodianRiderId: actors.rider.id,
      });
      await request(live.app.getHttpServer())
        .post(`/rider/assignments/${terminal.order.id}/start-delivery`)
        .set(authHeader(actors.rider))
        .expect(400);
      await cleanupOrder(live.prisma, terminal.order.id, terminal.fulfillment.id);
    }

    await cleanupOrder(live.prisma, ready.order.id, ready.fulfillment.id);
    await cleanupOrder(live.prisma, noCustody.order.id, noCustody.fulfillment.id);
    await cleanupOrder(
      live.prisma,
      custodianOnly.order.id,
      custodianOnly.fulfillment.id,
    );
    await cleanupOrder(live.prisma, incoming.order.id, incoming.fulfillment.id);
    await live.prisma.merchant.deleteMany({
      where: { id: { in: [actors.merchant.id, actors.otherMerchant.id] } },
    });
    await live.prisma.user.deleteMany({
      where: { email: { contains: actors.tag } },
    });
  });

  it('concurrent starts leave one in_transit without a raw 500', async () => {
    const actors = await seedActors(live.prisma);
    const ready = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const [a, b] = await Promise.all([
      request(live.app.getHttpServer())
        .post(`/rider/assignments/${ready.order.id}/start-delivery`)
        .set(authHeader(actors.rider)),
      request(live.app.getHttpServer())
        .post(`/rider/assignments/${ready.order.id}/start-delivery`)
        .set(authHeader(actors.rider)),
    ]);
    expect([a.status, b.status].every((status) => status !== 500)).toBe(true);
    expect([a.status, b.status]).toContain(200);
    const row = await live.prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: ready.fulfillment.id },
    });
    expect(row.status).toBe(FulfillmentStatus.in_transit);
    expect(row.physicalCustodianRiderId).toBe(actors.rider.id);
    expect(
      await live.prisma.custodyEvent.count({ where: { wkOrderId: ready.order.id } }),
    ).toBe(0);
    const finance = await live.prisma.wkOrder.findUniqueOrThrow({
      where: { id: ready.order.id },
      select: { paymentStatus: true, merchantPaymentStatus: true },
    });
    expect(finance.paymentStatus).toBe('pending');
    expect(finance.merchantPaymentStatus).toBe('AWAITING_PAYMENT');
    await cleanupOrder(live.prisma, ready.order.id, ready.fulfillment.id);
    await live.prisma.merchant.deleteMany({
      where: { id: { in: [actors.merchant.id, actors.otherMerchant.id] } },
    });
    await live.prisma.user.deleteMany({
      where: { email: { contains: actors.tag } },
    });
  });
});
